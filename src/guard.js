import { route } from '@forge/api';
import { decisions as defaultStore } from './db/decisions.js';
import { adfToLines } from './lib/adf.js';
import { detectConflicts } from './lib/conflict.js';

// Shared by the guard panel (as user), the issue-created trigger (as app) and the
// check-conflicts Rovo action (as user).

export const ISSUE_KEY = /^[A-Z][A-Z0-9_]{0,19}-\d{1,9}$/;

/** Summary + description of a Jira work item as plain text. */
export function issueText(issue) {
  const f = issue?.fields || {};
  const description = f.description && typeof f.description === 'object' ? adfToLines(f.description).join('\n') : String(f.description || '');
  return [f.summary || '', description].filter(Boolean).join('\n');
}

/** Fetch a work item's text fields. `requester` is api.asUser() or api.asApp(). Returns null if not visible. */
export async function fetchIssue(issueIdOrKey, requester) {
  const res = await requester.requestJira(
    route`/rest/api/3/issue/${issueIdOrKey}?fields=summary,description,project,status`,
    { headers: { Accept: 'application/json' } }
  );
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(`GET issue ${issueIdOrKey} failed: ${res.status}`);
  return res.json();
}

/**
 * Find decisions related to `text` and flag possible conflicts.
 * `visible` filters candidates to what the caller may see (pass identity for app-context use).
 */
export async function checkText(text, { store = defaultStore, visible = async (list) => list, limit = 3 } = {}) {
  const hits = await store.search(text, { limit: 50 });
  const candidates = await visible(hits.map((h) => h.decision));
  return detectConflicts(text, candidates, { limit });
}
