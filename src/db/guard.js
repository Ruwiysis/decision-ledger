import { sql as forgeSql } from '@forge/sql';
import { ensureSchema as forgeEnsureSchema } from './migrations.js';

// Remembers which work items already got an automatic conflict comment, so each
// work item gets at most one — even if the trigger is delivered twice.
export function createGuardStore({ client = forgeSql, ensureSchema = forgeEnsureSchema } = {}) {
  const run = async (query, params = []) => {
    await ensureSchema();
    const stmt = client.prepare(query);
    return (params.length ? stmt.bindParams(...params) : stmt).execute();
  };

  /** Atomically claim the right to comment on an issue. Returns false if already claimed. */
  async function claim(issueId, issueKey, decisionId) {
    try {
      await run(`INSERT INTO guard_comments (issue_id, issue_key, decision_id) VALUES (?, ?, ?)`, [
        String(issueId),
        String(issueKey),
        Number(decisionId),
      ]);
      return true;
    } catch (err) {
      const dup = err?.debug?.code === 'ER_DUP_ENTRY' || /duplicate/i.test(err?.message || '') || /Duplicate/.test(JSON.stringify(err?.debug || ''));
      if (dup) return false;
      throw err;
    }
  }

  async function recordComment(issueId, commentId) {
    await run(`UPDATE guard_comments SET comment_id = ? WHERE issue_id = ?`, [String(commentId), String(issueId)]);
  }

  /** Release a claim if posting the comment failed, so a later retry can try again. */
  async function release(issueId) {
    await run(`DELETE FROM guard_comments WHERE issue_id = ? AND comment_id IS NULL`, [String(issueId)]);
  }

  return { claim, recordComment, release };
}

export const guardComments = createGuardStore();
