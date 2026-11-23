import api, { route } from '@forge/api';
import { decisions as defaultStore } from '../db/decisions.js';
import { adfToLines, parseAdf } from '../lib/adf.js';
import { parseDecisionComment } from '../lib/comments.js';
import { extractKeywords } from '../lib/keywords.js';

/** "https://site.atlassian.net/rest/api/3/project/10000" -> "https://site.atlassian.net". */
export function siteFromSelf(self) {
  try {
    return self ? new URL(self).origin : null;
  } catch {
    return null;
  }
}

/** Jira gives comment bodies as ADF (object or JSON string) or, rarely, plain text. */
export function commentLines(body) {
  if (body == null) return [];
  if (typeof body === 'string') {
    const adf = parseAdf(body);
    return adf && adf.type === 'doc' ? adfToLines(adf) : body.split(/\r?\n/);
  }
  return adfToLines(body);
}

/**
 * Turn an avi:jira:commented:issue event into a ledger row (or remove one if the comment
 * was edited and no longer records a decision). Pure apart from the injected store.
 */
export async function captureComment(event, { store = defaultStore, siteUrl = null } = {}) {
  const { issue, comment } = event || {};
  if (!issue?.key || !comment?.id) return { skipped: 'bad event' };
  // Restricted comments only reach us with extra scopes we deliberately don't request;
  // skip any that do, so private discussion never lands in a team-wide ledger.
  if (comment.visibility) return { skipped: 'restricted' };

  const sourceId = String(comment.id);
  const parsed = parseDecisionComment(commentLines(comment.body));
  if (!parsed) {
    // Edited away from "Decision:", or an ordinary comment: make sure nothing is left behind.
    const removed = await store.removeStaleForSource('jira', sourceId, []);
    return { saved: 0, removed };
  }

  const project = issue.fields?.project || {};
  const site = siteUrl || siteFromSelf(project.self);
  const sourceUrl = site ? `${site}/browse/${issue.key}?focusedCommentId=${sourceId}` : null;
  const saved = await store.upsert({
    title: parsed.title,
    rationale: parsed.rationale,
    topics: [...extractKeywords(parsed.title).slice(0, 5), ...extractKeywords(issue.fields?.summary || '').slice(0, 2)],
    sourceType: 'jira',
    sourceId,
    sourceUrl,
    spaceOrProject: project.key || null,
    containerId: project.id ? String(project.id) : null,
    decidedBy: comment.author?.accountId || event.atlassianId || null,
    decidedAt: comment.created || new Date().toISOString(),
  });
  // One comment = one decision; drop an older title if the comment was edited.
  const removed = await store.removeStaleForSource('jira', sourceId, [parsed.title]);
  return { saved: saved ? 1 : 0, removed, id: saved?.id };
}

/** Fallback for the site URL when the event's project.self is missing. */
async function fetchSiteUrl() {
  const res = await api.asApp().requestJira(route`/rest/api/3/serverInfo`, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const info = await res.json();
  return info.baseUrl || null;
}

/** Trigger: avi:jira:commented:issue (created or edited). */
export async function onJiraComment(event) {
  try {
    const needsSite = !siteFromSelf(event?.issue?.fields?.project?.self);
    const siteUrl = needsSite ? await fetchSiteUrl() : null;
    const result = await captureComment(event, { siteUrl });
    if (result.saved || result.removed) {
      console.log(`[capture] jira issue=${event?.issue?.key} comment=${event?.comment?.id} ${JSON.stringify(result)}`);
    }
  } catch (err) {
    console.error(`[capture] jira comment on ${event?.issue?.key} failed: ${err?.message}`);
  }
}

// New Jira work item -> conflict check, comment once if score is high (step 2.5).
export async function onJiraIssueCreated(event) {
  console.log(`[guard] jira issue created ${event?.issue?.key}`);
}
