import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toActionDecision, parseCheckInput, validateLogInput } from '../src/lib/actions.js';

test('toActionDecision is compact, names the decider and hides placeholder rationale', () => {
  const d = {
    id: 7,
    title: 'Stay on PostgreSQL',
    rationale: 'the team knows it',
    status: 'active',
    decidedBy: 'acc-1',
    decidedAt: '2025-09-15T09:00:00.000Z',
    sourceType: 'confluence',
    spaceOrProject: 'NAKHLA',
    sourceUrl: 'https://x/wiki/p/1',
  };
  assert.deepEqual(toActionDecision(d, { 'acc-1': 'Sara Ali' }), {
    id: 7,
    decision: 'Stay on PostgreSQL',
    why: 'The team knows it',
    status: 'active',
    decidedBy: 'Sara Ali',
    decidedOn: '2025-09-15',
    source: 'Confluence page',
    space: 'NAKHLA',
    link: 'https://x/wiki/p/1',
  });
  const bare = toActionDecision({ ...d, rationale: 'Section: Database', spaceOrProject: '~abc', decidedBy: 'acc-2' });
  assert.equal(bare.why, 'No rationale was recorded.');
  assert.equal(bare.space, null);
  assert.equal(bare.decidedBy, 'a teammate');
});

test('parseCheckInput: bare key, lowercase key, URL, question, free text, context fallback', () => {
  assert.deepEqual(parseCheckInput('NP-1'), { issueKey: 'NP-1', text: '', extraText: '' });
  assert.equal(parseCheckInput('np-12').issueKey, 'NP-12');
  assert.equal(parseCheckInput('https://acme.atlassian.net/browse/NP-3?focusedCommentId=1').issueKey, 'NP-3');
  assert.deepEqual(parseCheckInput('Does NP-2 go against any past decision?'), { issueKey: 'NP-2', text: '', extraText: '' });
  assert.equal(parseCheckInput('Check NP-2 also we plan to drop Kafka next month').extraText, 'also we plan to drop Kafka next month');
  assert.deepEqual(parseCheckInput('Migrate reporting to MongoDB'), { issueKey: null, text: 'Migrate reporting to MongoDB', extraText: '' });
  assert.equal(parseCheckInput('', 'NP-9').issueKey, 'NP-9');
  assert.equal(parseCheckInput('', 'not a key').issueKey, null);
});

test('validateLogInput enforces title + rationale and only keeps https links', () => {
  assert.match(validateLogInput({ title: 'x', rationale: 'because' }).error, /at least 5/);
  assert.match(validateLogInput({ title: 'Use Rimal Pay', rationale: '' }).error, /why/);
  assert.match(validateLogInput({ title: 'a'.repeat(301), rationale: 'ok ok' }).error, /too long/);
  const ok = validateLogInput({ title: '  Use   Rimal Pay ', rationale: 'it supports local debit cards' });
  assert.deepEqual(ok, { title: 'Use Rimal Pay', rationale: 'it supports local debit cards', sourceUrl: null });
  assert.equal(validateLogInput({ title: 'Use Rimal Pay', rationale: 'why', sourceUrl: 'javascript:alert(1)' }).sourceUrl, null);
  assert.equal(validateLogInput({ title: 'Use Rimal Pay', rationale: 'why', sourceUrl: 'http://x.com' }).sourceUrl, null);
  assert.equal(validateLogInput({ title: 'Use Rimal Pay', rationale: 'why' }, 'https://acme.atlassian.net/browse/NP-1').sourceUrl, 'https://acme.atlassian.net/browse/NP-1');
});
