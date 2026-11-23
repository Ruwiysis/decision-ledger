import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyVisibility, filterVisible, jiraIssueKey } from '../src/access.js';

const conf = (id, page) => ({ id, sourceType: 'confluence', sourceId: page });
const jira = (id, project, key = `NP-${id}`) => ({ id, sourceType: 'jira', sourceId: `c${id}`, containerId: project, sourceUrl: key ? `https://x.atlassian.net/browse/${key}?focusedCommentId=c${id}` : null });
const rovo = (id) => ({ id, sourceType: 'rovo', sourceId: `r${id}` });

test('applyVisibility: pages and projects must be visible; rovo always visible', () => {
  const list = [conf(1, '100'), conf(2, '200'), jira(3, '10000'), jira(4, '10001'), rovo(5)];
  const out = applyVisibility(list, { pages: new Set(['100']), projects: new Set(['10001']) });
  assert.deepEqual(out.map((d) => d.id), [1, 4, 5]);
});

test('applyVisibility fails closed when a check failed (null set) or data is missing', () => {
  const list = [conf(1, '100'), jira(2, '10000'), { ...jira(3, null) }, { id: 4, sourceType: 'slack' }];
  assert.deepEqual(applyVisibility(list, { pages: null, projects: null }).map((d) => d.id), []);
  assert.deepEqual(applyVisibility(list, { pages: new Set(['100']), projects: new Set(['10000']) }).map((d) => d.id), [1, 2]);
});

/** Fake asUser() requester returning canned API responses. */
function requester({ pages = [], projects = [], confluenceStatus = 200, jiraStatus = 200 } = {}) {
  const calls = [];
  const respond = (status, body) => ({ ok: status < 300, status, json: async () => body });
  return {
    calls,
    requestConfluence: async (r) => (calls.push(String(r?.value ?? r)), respond(confluenceStatus, { results: pages.map((id) => ({ id })) })),
    // bulkfetch: only the keys listed in `projects` (reused as visible work item keys) come back
    requestJira: async (r, opts) => {
      calls.push(String(r?.value ?? r));
      const asked = JSON.parse(opts?.body || '{}').issueIdsOrKeys || [];
      return respond(jiraStatus, { issues: asked.filter((k) => projects.includes(k)).map((key) => ({ key })) });
    },
  };
}

test('filterVisible batches checks and filters wrapped search results via pick', async () => {
  const items = [conf(1, '100'), conf(2, '200'), jira(3, '10000'), rovo(4)].map((d) => ({ decision: d, score: 1 }));
  const req = requester({ pages: ['200'], projects: ['NP-3'] });
  const out = await filterVisible(items, { pick: (x) => x.decision, requester: req });
  assert.deepEqual(out.map((x) => x.decision.id), [2, 3, 4]);
  assert.equal(req.calls.length, 2, 'one Confluence + one Jira call');
});

test('Jira decisions are checked per work item (security levels), not per space', async () => {
  // Same space 10000, but the user can only see NP-1: NP-2 has a security level.
  const list = [jira(1, '10000'), jira(2, '10000'), jira(3, '10000', null)];
  const out = await filterVisible(list, { requester: requester({ projects: ['NP-1'] }) });
  assert.deepEqual(out.map((d) => d.id), [1]);
  assert.equal(jiraIssueKey(jira(9, '1', 'ABC-12')), 'ABC-12');
  assert.equal(jiraIssueKey({ sourceUrl: 'https://x/wiki/p/1' }), null);
});

test('filterVisible hides a source type whose API check errors, keeps the rest', async () => {
  const list = [conf(1, '100'), jira(2, '10000'), rovo(3)];
  const out = await filterVisible(list, { requester: requester({ pages: ['100'], jiraStatus: 403 }) });
  assert.deepEqual(out.map((d) => d.id), [1, 3]);
});

test('filterVisible makes no API calls when only rovo decisions are present', async () => {
  const req = requester();
  const out = await filterVisible([rovo(1)], { requester: req });
  assert.equal(out.length, 1);
  assert.equal(req.calls.length, 0);
});
