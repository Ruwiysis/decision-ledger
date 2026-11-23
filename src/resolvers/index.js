import Resolver from '@forge/resolver';
import api from '@forge/api';
import { decisions, STATUSES } from '../db/decisions.js';
import { filterVisible, canSee } from '../access.js';
import { checkText, fetchIssue, issueText } from '../guard.js';
import { CONNECTED_WORK_QUERY, confluencePageAri, parseConnectedWork } from '../lib/twg.js';

// Backend for both UI modules (Confluence ledger page + Jira issue panel).
// Every response is filtered by what the *calling user* can access (see access.js);
// identity comes from req.context.accountId, never from the payload.
const resolver = new Resolver();

const ok = (data) => ({ ok: true, ...data });
const fail = (message) => ({ ok: false, error: message });

/** Apply the optional ledger filters to an already-loaded list (used after keyword search). */
function matchesFilters(d, { status, space, from, to }) {
  if (status && d.status !== status) return false;
  if (space && d.spaceOrProject !== space) return false;
  if (from && d.decidedAt && d.decidedAt < new Date(from).toISOString()) return false;
  if (to && d.decidedAt && d.decidedAt > new Date(`${to}T23:59:59.999Z`).toISOString()) return false;
  return true;
}

/**
 * Ledger listing. payload: { query?, status?, space?, from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD' }
 */
resolver.define('listDecisions', async ({ payload = {} }) => {
  try {
    const query = String(payload.query || '').trim().slice(0, 200);
    const filters = {
      status: STATUSES.includes(payload.status) ? payload.status : null,
      space: payload.space ? String(payload.space).slice(0, 255) : null,
      from: /^\d{4}-\d{2}-\d{2}$/.test(payload.from || '') ? payload.from : null,
      to: /^\d{4}-\d{2}-\d{2}$/.test(payload.to || '') ? payload.to : null,
    };
    let rows;
    if (query) {
      const hits = await decisions.search(query, { limit: 200 });
      // Hits arrive best-first. Drop weak tail matches (e.g. one word in a rationale) when
      // there are strong ones, so "payment gateway" doesn't list every page mentioning "payment".
      const top = hits[0]?.score || 0;
      const floor = Math.max(2, Math.ceil(top * 0.25));
      rows = hits
        .filter((h) => h.score >= floor)
        .map((h) => ({ ...h.decision, score: h.score, matched: h.matched }))
        .filter((d) => matchesFilters(d, filters));
    } else {
      rows = await decisions.list({
        status: filters.status,
        spaceOrProject: filters.space,
        from: filters.from,
        to: filters.to ? `${filters.to}T23:59:59Z` : null,
        limit: 500,
      });
    }
    const visible = await filterVisible(rows);
    console.log(`[ledger] list query=${query ? 'yes' : 'no'} found=${rows.length} visible=${visible.length}`);
    return ok({ decisions: visible, total: visible.length });
  } catch (err) {
    console.error(`[ledger] listDecisions failed: ${err?.message}`);
    return fail('Could not load decisions. Please try again.');
  }
});

/** Filter dropdown options: only spaces/projects the user can actually see decisions from. */
resolver.define('listFilters', async () => {
  try {
    const all = await decisions.list({ limit: 500 });
    const visible = await filterVisible(all);
    const spaces = [...new Map(visible.filter((d) => d.spaceOrProject).map((d) => [d.spaceOrProject, d.sourceType])).entries()]
      .map(([key, sourceType]) => ({ key, sourceType }))
      .sort((a, b) => a.key.localeCompare(b.key));
    return ok({ spaces });
  } catch (err) {
    console.error(`[ledger] listFilters failed: ${err?.message}`);
    return fail('Could not load filters.');
  }
});

resolver.define('getDecision', async ({ payload = {} }) => {
  try {
    const d = await decisions.getById(payload.id);
    if (!d || !(await canSee(d))) return fail('Decision not found.');
    return ok({ decision: d });
  } catch (err) {
    console.error(`[ledger] getDecision failed: ${err?.message}`);
    return fail('Could not load this decision.');
  }
});

/**
 * Teamwork Graph "Connected work" for a decision's source page: who contributed and which
 * pages it links to. Runs AS THE USER (Teamwork Graph never runs as the app), so results are
 * already permission-filtered. Never throws to the UI: returns ok / empty / unavailable.
 */
resolver.define('connectedWork', async ({ payload = {}, context }) => {
  try {
    const d = await decisions.getById(payload.id);
    if (!d || !(await canSee(d))) return fail('Decision not found.');
    if (d.sourceType !== 'confluence') return ok({ status: 'unsupported', people: [], pages: [] });
    const ari = confluencePageAri(context?.cloudId, d.sourceId);
    if (!ari) return ok({ status: 'unsupported', people: [], pages: [] });

    const res = await api.asUser().requestTeamworkGraph(CONNECTED_WORK_QUERY, { id: ari });
    const body = await res.json().catch(() => null);
    if (!res.ok && !body?.data) {
      console.warn(`[twg] connectedWork ${d.id} HTTP ${res.status}`);
      return ok({ status: 'unavailable', people: [], pages: [] });
    }
    const parsed = parseConnectedWork(body, { excludeAccountIds: [d.decidedBy] });
    if (parsed.errors.length) console.warn(`[twg] connectedWork ${d.id} errors: ${parsed.errors.slice(0, 3).join(' | ')}`);
    console.log(`[twg] connectedWork ${d.id} status=${parsed.status} people=${parsed.people.length} pages=${parsed.pages.length}`);
    return ok({ status: parsed.status === 'error' ? 'unavailable' : parsed.status, people: parsed.people, pages: parsed.pages });
  } catch (err) {
    console.error(`[twg] connectedWork failed: ${err?.message}`);
    return ok({ status: 'unavailable', people: [], pages: [] });
  }
});

/**
 * Change status. Allowed for anyone who can see the decision (and, for supersededBy,
 * the replacement too). Records who changed it in the logs.
 */
resolver.define('setStatus', async ({ payload = {}, context }) => {
  try {
    const status = payload.status;
    if (!STATUSES.includes(status)) return fail('Invalid status.');
    const d = await decisions.getById(payload.id);
    if (!d || !(await canSee(d))) return fail('Decision not found.');
    let supersededBy = null;
    if (status === 'superseded' && payload.supersededBy) {
      const replacement = await decisions.getById(payload.supersededBy);
      if (!replacement || replacement.id === d.id || !(await canSee(replacement))) return fail('Replacement decision not found.');
      supersededBy = replacement.id;
    }
    const updated = await decisions.setStatus(d.id, status, supersededBy);
    console.log(`[ledger] decision=${d.id} status ${d.status} -> ${status} by=${context?.accountId}`);
    return ok({ decision: updated });
  } catch (err) {
    console.error(`[ledger] setStatus failed: ${err?.message}`);
    return fail('Could not update the decision.');
  }
});

/**
 * Guard panel. The work item comes from the Forge context (not the payload) and is read
 * AS THE USER, and candidate decisions are filtered to what that user can see.
 */
resolver.define('relatedDecisions', async ({ context }) => {
  const issueKey = context?.extension?.issue?.key;
  if (!issueKey) return fail('Open this panel on a work item.');
  try {
    const issue = await fetchIssue(issueKey, api.asUser());
    if (!issue) return fail('This work item could not be read.');
    const { related, keywords } = await checkText(issueText(issue), { visible: (list) => filterVisible(list), limit: 3 });
    const conflict = related.find((r) => r.conflict) || null;
    return ok({
      issueKey,
      keywords: keywords.slice(0, 10),
      related: related.map((r) => ({ ...r.decision, score: r.score, matched: r.matched, conflict: r.conflict, changeWords: r.changeWords })),
      conflictId: conflict ? conflict.decision.id : null,
    });
  } catch (err) {
    console.error(`[guard] panel ${issueKey} failed: ${err?.message}`);
    return fail('Could not check related decisions. Please try again.');
  }
});

export const handler = resolver.getDefinitions();
export { handler as resolver };
