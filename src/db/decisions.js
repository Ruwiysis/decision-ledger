import { sql as forgeSql } from '@forge/sql';
import { ensureSchema as forgeEnsureSchema } from './migrations.js';
import { extractKeywords, rankDecisions, titleKey } from '../lib/keywords.js';

// Data access for the `decisions` table. Authorization is NOT done here: callers
// (resolvers, actions, triggers) filter results by what the current user can access.

export const STATUSES = ['active', 'superseded', 'reversed'];
export const SOURCE_TYPES = ['confluence', 'jira', 'rovo'];

const COLUMNS = `id, title, rationale, status, topics, source_type, source_id, source_url,
  space_or_project, container_id, decided_by, decided_at, superseded_by`;

/** "2026-11-23T10:00:00.000Z" | Date -> "2026-11-23 10:00:00" (Forge SQL DATETIME input). */
export function toSqlDateTime(value) {
  const d = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${value}`);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** DB row -> API object (camelCase, topics as array, ISO date). */
export function fromRow(row) {
  if (!row) return null;
  const decidedAt = row.decided_at ? new Date(String(row.decided_at).replace(' ', 'T') + (String(row.decided_at).endsWith('Z') ? '' : 'Z')) : null;
  return {
    id: Number(row.id),
    title: row.title,
    rationale: row.rationale || '',
    status: row.status,
    topics: row.topics ? row.topics.split(',').filter(Boolean) : [],
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceUrl: row.source_url || null,
    spaceOrProject: row.space_or_project || null,
    containerId: row.container_id || null,
    decidedBy: row.decided_by || null,
    decidedAt: decidedAt && !Number.isNaN(decidedAt.getTime()) ? decidedAt.toISOString() : null,
    supersededBy: row.superseded_by == null ? null : Number(row.superseded_by),
  };
}

/** Escape LIKE wildcards in user-provided text. */
function likeTerm(word) {
  return `%${String(word).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function normaliseTopics(topics) {
  const list = Array.isArray(topics) ? topics : String(topics || '').split(',');
  const clean = [...new Set(list.map((t) => String(t).trim().toLowerCase()).filter(Boolean))];
  // Keep within the VARCHAR(1000) column.
  let joined = '';
  for (const t of clean) {
    const next = joined ? `${joined},${t}` : t;
    if (next.length > 1000) break;
    joined = next;
  }
  return joined;
}

function validate(decision) {
  if (!decision || !String(decision.title || '').trim()) throw new Error('Decision title is required');
  if (!SOURCE_TYPES.includes(decision.sourceType)) throw new Error(`Invalid sourceType: ${decision.sourceType}`);
  if (!decision.sourceId) throw new Error('sourceId is required');
  if (decision.status && !STATUSES.includes(decision.status)) throw new Error(`Invalid status: ${decision.status}`);
}

/**
 * Build the store. `client` is anything with Forge SQL's `prepare(query).bindParams(...).execute()`
 * shape, so tests can pass a fake.
 */
export function createDecisionStore({ client = forgeSql, ensureSchema = forgeEnsureSchema } = {}) {
  const run = async (query, params = []) => {
    await ensureSchema();
    const stmt = client.prepare(query);
    return (params.length ? stmt.bindParams(...params) : stmt).execute();
  };

  async function getById(id) {
    const numeric = Number(id);
    if (!Number.isInteger(numeric) || numeric <= 0) return null;
    const { rows } = await run(`SELECT ${COLUMNS} FROM decisions WHERE id = ?`, [numeric]);
    return fromRow(rows[0]);
  }

  async function getBySourceKey(sourceType, sourceId, title) {
    const { rows } = await run(
      `SELECT ${COLUMNS} FROM decisions WHERE source_type = ? AND source_id = ? AND title_key = ?`,
      [sourceType, String(sourceId), titleKey(title)]
    );
    return fromRow(rows[0]);
  }

  /**
   * Insert, or update the existing row with the same (sourceType, sourceId, title).
   * Re-capturing never overwrites status/superseded_by, which users manage in the ledger,
   * and keeps the first decided_at unless `decidedAtExplicit` (a date written in the source).
   * Returns the stored decision.
   */
  async function upsert(decision) {
    validate(decision);
    const title = String(decision.title).trim().slice(0, 500);
    await run(
      `INSERT INTO decisions
        (title, title_key, rationale, status, topics, source_type, source_id, source_url,
         space_or_project, container_id, decided_by, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         title = VALUES(title),
         rationale = VALUES(rationale),
         topics = VALUES(topics),
         source_url = VALUES(source_url),
         space_or_project = VALUES(space_or_project),
         container_id = VALUES(container_id),
         decided_at = CASE WHEN ? = 1 THEN VALUES(decided_at) ELSE decided_at END,
         updated_at = CURRENT_TIMESTAMP`,
      [
        title,
        titleKey(title),
        decision.rationale ? String(decision.rationale).slice(0, 20000) : null,
        decision.status || 'active',
        normaliseTopics(decision.topics),
        decision.sourceType,
        String(decision.sourceId).slice(0, 128),
        decision.sourceUrl || null,
        decision.spaceOrProject || null,
        decision.containerId == null ? null : String(decision.containerId),
        decision.decidedBy || null,
        toSqlDateTime(decision.decidedAt),
        // Only an explicit date from the source (e.g. a Confluence /date) may change decided_at later.
        decision.decidedAtExplicit ? 1 : 0,
      ]
    );
    return getBySourceKey(decision.sourceType, decision.sourceId, title);
  }

  /**
   * After re-reading a source (e.g. an edited page), delete its decisions that no longer exist.
   * `currentTitles` are the decision titles still present on that source.
   */
  async function removeStaleForSource(sourceType, sourceId, currentTitles = []) {
    const keys = [...new Set(currentTitles.map(titleKey))];
    const notIn = keys.length ? ` AND title_key NOT IN (${keys.map(() => '?').join(', ')})` : '';
    const { rows } = await run(
      `DELETE FROM decisions WHERE source_type = ? AND source_id = ?${notIn}`,
      [sourceType, String(sourceId), ...keys]
    );
    return rows?.affectedRows ?? 0;
  }

  /**
   * Keyword search across title, topics and rationale. Pulls candidates with LIKE in SQL,
   * then ranks them in JS (title > topics > rationale). Returns [{ decision, score, matched }].
   */
  async function search(text, { limit = 5, statuses = null, candidateLimit = 300 } = {}) {
    const keywords = Array.isArray(text) ? text : extractKeywords(text, { max: 12 });
    if (keywords.length === 0) return [];
    const ors = [];
    const params = [];
    for (const k of keywords) {
      ors.push(`title LIKE ? OR topics LIKE ? OR rationale LIKE ?`);
      const t = likeTerm(k);
      params.push(t, t, t);
    }
    let where = `(${ors.join(' OR ')})`;
    if (statuses?.length) {
      where += ` AND status IN (${statuses.map(() => '?').join(', ')})`;
      params.push(...statuses);
    }
    const { rows } = await run(
      `SELECT ${COLUMNS} FROM decisions WHERE ${where} ORDER BY decided_at DESC LIMIT ${Math.min(Number(candidateLimit) || 300, 1000)}`,
      params
    );
    return rankDecisions(rows.map(fromRow), keywords, { limit });
  }

  /** Filtered, newest-first listing for the ledger page. */
  async function list({ status, spaceOrProject, sourceType, from, to, limit = 200, offset = 0 } = {}) {
    const where = [];
    const params = [];
    if (status) {
      if (!STATUSES.includes(status)) throw new Error(`Invalid status: ${status}`);
      where.push('status = ?');
      params.push(status);
    }
    if (spaceOrProject) {
      where.push('space_or_project = ?');
      params.push(spaceOrProject);
    }
    if (sourceType) {
      where.push('source_type = ?');
      params.push(sourceType);
    }
    if (from) {
      where.push('decided_at >= ?');
      params.push(toSqlDateTime(from));
    }
    if (to) {
      where.push('decided_at <= ?');
      params.push(toSqlDateTime(to));
    }
    const lim = Math.max(1, Math.min(Number(limit) || 200, 500));
    const off = Math.max(0, Number(offset) || 0);
    const { rows } = await run(
      `SELECT ${COLUMNS} FROM decisions${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
       ORDER BY decided_at DESC, id DESC LIMIT ${lim} OFFSET ${off}`,
      params
    );
    return rows.map(fromRow);
  }

  /** Distinct spaces/projects, for the ledger filter dropdown. */
  async function listContainers() {
    const { rows } = await run(
      `SELECT DISTINCT space_or_project, source_type FROM decisions WHERE space_or_project IS NOT NULL ORDER BY space_or_project`
    );
    return rows.map((r) => ({ key: r.space_or_project, sourceType: r.source_type }));
  }

  /** Change status (e.g. superseded by another decision, or reversed). */
  async function setStatus(id, status, supersededBy = null) {
    if (!STATUSES.includes(status)) throw new Error(`Invalid status: ${status}`);
    const sup = supersededBy == null ? null : Number(supersededBy);
    await run(`UPDATE decisions SET status = ?, superseded_by = ? WHERE id = ?`, [
      status,
      status === 'superseded' ? sup : null,
      Number(id),
    ]);
    return getById(id);
  }

  return { getById, getBySourceKey, upsert, removeStaleForSource, search, list, listContainers, setStatus };
}

// Default store wired to the real Forge SQL client.
export const decisions = createDecisionStore();
