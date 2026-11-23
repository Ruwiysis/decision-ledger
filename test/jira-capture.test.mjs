import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDecisionComment } from '../src/lib/comments.js';
import { adfToLines } from '../src/lib/adf.js';
import { captureComment, commentLines, siteFromSelf } from '../src/triggers/jira.js';

const para = (...parts) => ({ type: 'paragraph', content: parts.map((p) => (typeof p === 'string' ? { type: 'text', text: p } : p)) });
const doc = (...content) => ({ type: 'doc', version: 1, content });

test('parseDecisionComment: Because: on the same line', () => {
  assert.deepEqual(parseDecisionComment(['Decision: Use Moyasar for payments. Because: it supports mada']), {
    title: 'Use Moyasar for payments',
    rationale: 'it supports mada',
  });
});

test('parseDecisionComment: Because: on a later line, multi-line rationale', () => {
  assert.deepEqual(parseDecisionComment(['decision: Stay on PostgreSQL', 'Because: team knows it', 'and we need joins']), {
    title: 'Stay on PostgreSQL',
    rationale: 'team knows it and we need joins',
  });
});

test('parseDecisionComment: next line is the rationale when no Because:', () => {
  assert.deepEqual(parseDecisionComment(['Decision: Freeze the API on Dec 1', 'Partners need two weeks to test.']), {
    title: 'Freeze the API on Dec 1',
    rationale: 'Partners need two weeks to test.',
  });
});

test('parseDecisionComment: inline "because" without colon on a single line', () => {
  assert.deepEqual(parseDecisionComment(['Decision: Drop IE11 support because usage is under 0.1%']), {
    title: 'Drop IE11 support',
    rationale: 'usage is under 0.1%',
  });
});

test('parseDecisionComment: ignores comments that do not start with Decision:', () => {
  assert.equal(parseDecisionComment(['I think the decision: is unclear']), null);
  assert.equal(parseDecisionComment(['Looks good']), null);
  assert.equal(parseDecisionComment(['Decision:']), null);
  assert.equal(parseDecisionComment([]), null);
});

test('adfToLines keeps paragraphs and hard breaks as separate lines', () => {
  const lines = adfToLines(doc(para('Decision: Stay on ', { type: 'text', text: 'PostgreSQL', marks: [{ type: 'strong' }] }, { type: 'hardBreak' }, 'Because: joins'), para('second para')));
  assert.deepEqual(lines, ['Decision: Stay on PostgreSQL', 'Because: joins', 'second para']);
});

test('commentLines accepts ADF objects, ADF JSON strings and plain text', () => {
  const adf = doc(para('Decision: A'), para('B'));
  assert.deepEqual(commentLines(adf), ['Decision: A', 'B']);
  assert.deepEqual(commentLines(JSON.stringify(adf)), ['Decision: A', 'B']);
  assert.deepEqual(commentLines('Decision: A\nB'), ['Decision: A', 'B']);
  assert.deepEqual(commentLines(null), []);
});

test('siteFromSelf extracts the origin', () => {
  assert.equal(siteFromSelf('https://acme.atlassian.net/rest/api/3/project/10000'), 'https://acme.atlassian.net');
  assert.equal(siteFromSelf('nope'), null);
  assert.equal(siteFromSelf(undefined), null);
});

function fakeStore() {
  const upserts = [];
  const removals = [];
  return {
    upserts,
    removals,
    upsert: async (d) => (upserts.push(d), { id: 42, ...d }),
    removeStaleForSource: async (type, id, titles) => (removals.push({ type, id, titles }), titles.length ? 0 : 1),
  };
}

const event = (body, extra = {}) => ({
  eventType: 'avi:jira:commented:issue',
  atlassianId: 'acc-actor',
  issue: {
    key: 'PAY-12',
    fields: { summary: 'Payments vendor', project: { id: '10000', key: 'PAY', self: 'https://acme.atlassian.net/rest/api/3/project/10000' } },
  },
  comment: { id: '10039', author: { accountId: 'acc-author' }, created: '2026-03-01T12:00:00.000+0300', body, ...extra },
});

test('captureComment saves a decision with project, author, link and topics', async () => {
  const store = fakeStore();
  const result = await captureComment(event(doc(para('Decision: Use Moyasar for payments'), para('Because: mada support'))), { store });
  assert.equal(result.saved, 1);
  const d = store.upserts[0];
  assert.equal(d.sourceType, 'jira');
  assert.equal(d.sourceId, '10039');
  assert.equal(d.title, 'Use Moyasar for payments');
  assert.equal(d.rationale, 'mada support');
  assert.equal(d.spaceOrProject, 'PAY');
  assert.equal(d.containerId, '10000');
  assert.equal(d.decidedBy, 'acc-author');
  assert.equal(d.sourceUrl, 'https://acme.atlassian.net/browse/PAY-12?focusedCommentId=10039');
  assert.ok(d.topics.includes('moyasar'));
  assert.deepEqual(store.removals, [{ type: 'jira', id: '10039', titles: ['Use Moyasar for payments'] }]);
});

test('captureComment removes the decision when a comment is edited to no longer be one', async () => {
  const store = fakeStore();
  const result = await captureComment(event(doc(para('Never mind, still discussing'))), { store });
  assert.deepEqual(result, { saved: 0, removed: 1 });
  assert.equal(store.upserts.length, 0);
});

test('captureComment skips restricted comments and malformed events', async () => {
  const store = fakeStore();
  const restricted = event(doc(para('Decision: secret')), { visibility: { type: 'group', value: 'admins' } });
  assert.deepEqual(await captureComment(restricted, { store }), { skipped: 'restricted' });
  assert.deepEqual(await captureComment({}, { store }), { skipped: 'bad event' });
  assert.equal(store.upserts.length + store.removals.length, 0);
});

test('captureComment uses the fallback site URL when project.self is missing', async () => {
  const store = fakeStore();
  const ev = event(doc(para('Decision: X happens')));
  delete ev.issue.fields.project.self;
  await captureComment(ev, { store, siteUrl: 'https://fallback.atlassian.net' });
  assert.equal(store.upserts[0].sourceUrl, 'https://fallback.atlassian.net/browse/PAY-12?focusedCommentId=10039');
});
