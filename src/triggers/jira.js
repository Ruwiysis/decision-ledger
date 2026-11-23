import api, { route } from '@forge/api';
import { decisions as defaultStore } from '../db/decisions.js';
import { guardComments as defaultGuard } from '../db/guard.js';
import { adfToLines, parseAdf } from '../lib/adf.js';
import { parseDecisionComment } from '../lib/comments.js';
import { extractKeywords } from '../lib/keywords.js';
import { AUTO_COMMENT_MIN_SCORE, conflictSentence } from '../lib/conflict.js';
import { checkText, fetchIssue, issueText } from '../guard.js';

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
    // An ordinary new comment can't have left a decision behind: skip the DB entirely.
    // Only an EDITED comment (updated != created) may have had "Decision:" removed.
    const edited = comment.updated && comment.created && comment.updated !== comment.created;
    if (!edited) return { saved: 0, removed: 0 };
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

const text = (t, marks) => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });
const link = (t, href) => text(t, [{ type: 'link', attrs: { href } }]);

/**
 * Build the one-time conflict comment (ADF).
 * Privacy: a comment is visible to everyone who can see the work item, but the app cannot
 * check each of those readers. So it only quotes decisions logged in Rovo chat (team-wide by
 * design). Decisions from Confluence pages or other Jira work items may be restricted (page
 * restrictions, work item security levels), so they get a neutral pointer to the
 * permission-aware panel, which shows details only to people who may see them.
 */
export function buildConflictComment({ issueKey, hit }) {
  const d = hit.decision;
  const safeToQuote = d.sourceType === 'rovo';
  const content = [
    {
      type: 'paragraph',
      content: [text('⚠️ Decision Ledger: ', [{ type: 'strong' }]), text('this work item may go against a past team decision.')],
    },
  ];
  if (safeToQuote) {
    const p = { type: 'paragraph', content: [text(conflictSentence(d))] };
    if (d.sourceUrl) p.content.push(text(' '), link('View discussion', d.sourceUrl));
    content.push(p);
  } else {
    content.push({
      type: 'paragraph',
      content: [
        text(
          `The related decision was recorded in ${d.sourceType === 'jira' ? 'another Jira work item' : 'Confluence'}. Open the “Related decisions” panel on this work item to review it (you will only see decisions you have access to).`
        ),
      ],
    });
  }
  content.push({
    type: 'paragraph',
    content: [text(`Not sure? Ask Decision Keeper in Rovo: “Does ${issueKey} go against any past decision?”`, [{ type: 'em' }])],
  });
  return { type: 'doc', version: 1, content };
}

/**
 * avi:jira:created:issue -> run the guard; if the best conflict is strong, post ONE comment.
 * Pure apart from injected dependencies (tested with fakes).
 */
export async function guardNewIssue(event, deps = {}) {
  const {
    requester = api.asApp(),
    store = defaultStore,
    guard = defaultGuard,
    minScore = AUTO_COMMENT_MIN_SCORE,
  } = deps;
  const key = event?.issue?.key;
  const id = event?.issue?.id;
  if (!key || !id) return { skipped: 'bad event' };

  const issue = await fetchIssue(key, requester);
  if (!issue) return { skipped: 'issue not found' };
  const { related } = await checkText(issueText(issue), { store, limit: 3 });
  const best = related.find((r) => r.conflict);
  if (!best || best.conflictScore < minScore) {
    return { commented: false, best: best ? { id: best.decision.id, conflictScore: best.conflictScore } : null };
  }

  if (!(await guard.claim(id, key, best.decision.id))) return { commented: false, skipped: 'already commented' };
  try {
    const res = await requester.requestJira(route`/rest/api/3/issue/${key}/comment`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: buildConflictComment({ issueKey: key, hit: best }) }),
    });
    if (!res.ok) throw new Error(`POST comment failed: ${res.status}`);
    const comment = await res.json();
    await guard.recordComment(id, comment.id);
    return { commented: true, decisionId: best.decision.id, conflictScore: best.conflictScore, commentId: comment.id };
  } catch (err) {
    await guard.release(id).catch(() => {});
    throw err;
  }
}

/** Trigger: avi:jira:created:issue. */
export async function onJiraIssueCreated(event) {
  try {
    const result = await guardNewIssue(event);
    console.log(`[guard] created ${event?.issue?.key} ${JSON.stringify(result)}`);
  } catch (err) {
    console.error(`[guard] created ${event?.issue?.key} failed: ${err?.message}`);
  }
}
