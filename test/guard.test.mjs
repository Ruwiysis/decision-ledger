import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectConflicts, findChangeSignals, conflictSentence, AUTO_COMMENT_MIN_SCORE } from '../src/lib/conflict.js';
import { issueText } from '../src/guard.js';
import { buildConflictComment, guardNewIssue } from '../src/triggers/jira.js';

const pg = {
  id: 1,
  title: 'Stay on PostgreSQL for the reporting database',
  rationale: 'the team knows it and reporting needs joins',
  topics: ['database', 'reporting'],
  status: 'active',
  sourceType: 'confluence',
  sourceId: '555',
  sourceUrl: 'https://acme.atlassian.net/wiki/spaces/ENG/pages/555',
  decidedAt: '2026-03-10T09:30:00.000Z',
};
const moyasar = { id: 2, title: 'Use Moyasar for payments', rationale: 'it supports mada', topics: ['payments'], status: 'active', sourceType: 'jira', containerId: '10000', sourceUrl: 'https://acme.atlassian.net/browse/PAY-1?focusedCommentId=9', decidedAt: '2026-02-01T00:00:00.000Z' };
const oldPg = { ...pg, id: 3, status: 'superseded' };

test('findChangeSignals spots phrases and nearby keywords', () => {
  const s = findChangeSignals('We should migrate the reporting DB to MongoDB next quarter');
  assert.equal(s.length, 1);
  assert.equal(s[0].phrase, 'migrate');
  assert.ok(s[0].near.has('reporting') && s[0].near.has('database') && s[0].near.has('mongodb'));
  assert.equal(findChangeSignals('Add a reporting dashboard')[0], undefined);
  assert.equal(findChangeSignals('Move away from Moyasar')[0].phrase, 'move away from');
});

test('detectConflicts flags a change near a matched keyword of an active decision', () => {
  const { related } = detectConflicts('Migrate reporting DB to MongoDB', [pg, moyasar]);
  assert.equal(related[0].decision.id, 1);
  assert.equal(related[0].conflict, true);
  assert.deepEqual(related[0].changeWords, ['migrate']);
  assert.ok(related[0].conflictScore >= AUTO_COMMENT_MIN_SCORE, `score ${related[0].conflictScore}`);
  assert.ok(!related.some((r) => r.decision.id === 2), 'unrelated decision not returned');
});

test('detectConflicts: related but no change words -> no conflict', () => {
  const { related } = detectConflicts('Add a new chart to the reporting database dashboard', [pg]);
  assert.equal(related[0].conflict, false);
});

test('detectConflicts: superseded decisions are related but never conflicts', () => {
  const { related } = detectConflicts('Migrate reporting DB to MongoDB', [oldPg]);
  assert.equal(related[0].conflict, false);
});

test('conflictSentence reads naturally and skips placeholder rationale', () => {
  assert.equal(
    conflictSentence(pg),
    'Possible conflict: on 2026-03-10 the team decided “Stay on PostgreSQL for the reporting database” because the team knows it and reporting needs joins.'
  );
  assert.equal(conflictSentence({ ...pg, rationale: 'Section: Database' }), 'Possible conflict: on 2026-03-10 the team decided “Stay on PostgreSQL for the reporting database”.');
});

test('issueText joins summary and ADF description', () => {
  const t = issueText({ fields: { summary: 'Migrate', description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'to MongoDB' }] }] } } });
  assert.equal(t, 'Migrate\nto MongoDB');
  assert.equal(issueText({ fields: { summary: 'Only summary' } }), 'Only summary');
});

const flat = (adf) => JSON.stringify(adf);

test('buildConflictComment quotes only Rovo-logged decisions; Jira/Confluence get a neutral pointer', () => {
  const rovoHit = { decision: { ...moyasar, sourceType: 'rovo', sourceUrl: null } };
  const quoted = flat(buildConflictComment({ issueKey: 'PAY-7', hit: rovoHit }));
  assert.ok(quoted.includes('Use Moyasar for payments'));
  const jiraComment = flat(buildConflictComment({ issueKey: 'PAY-7', hit: { decision: moyasar } }));
  assert.ok(!jiraComment.includes('Moyasar') && jiraComment.includes('another Jira work item'), 'Jira decision (maybe security-restricted) not quoted');
  const conf = flat(buildConflictComment({ issueKey: 'PAY-7', hit: { decision: pg } }));
  assert.ok(!conf.includes('PostgreSQL') && conf.includes('Related decisions'));
  assert.ok(conf.includes('Does PAY-7 go against any past decision?'));
});

function fakes({ issueBody, claimOk = true, postStatus = 201 } = {}) {
  const posted = [];
  const guardCalls = [];
  const requester = {
    requestJira: async (r, opts = {}) => {
      if (opts.method === 'POST') {
        posted.push(JSON.parse(opts.body));
        return { ok: postStatus < 300, status: postStatus, json: async () => ({ id: '777' }) };
      }
      return { ok: true, status: 200, json: async () => issueBody };
    },
  };
  const store = { search: async () => [pg, moyasar].map((d) => ({ decision: d, score: 1, matched: [] })) };
  const guard = {
    claim: async (...a) => (guardCalls.push(['claim', ...a]), claimOk),
    recordComment: async (...a) => guardCalls.push(['record', ...a]),
    release: async (...a) => guardCalls.push(['release', ...a]),
  };
  return { requester, store, guard, posted, guardCalls };
}

const created = { issue: { id: '10100', key: 'ENG-9', fields: { project: { id: '10000' } } } };
const conflicting = { fields: { summary: 'Migrate reporting DB to MongoDB', project: { id: '10000' } } };

test('guardNewIssue posts exactly one comment for a strong conflict and records it', async () => {
  const f = fakes({ issueBody: conflicting });
  const result = await guardNewIssue(created, f);
  assert.equal(result.commented, true);
  assert.equal(f.posted.length, 1);
  assert.deepEqual(f.guardCalls.map((c) => c[0]), ['claim', 'record']);
});

test('guardNewIssue does not comment twice (claim already taken)', async () => {
  const f = fakes({ issueBody: conflicting, claimOk: false });
  const result = await guardNewIssue(created, f);
  assert.deepEqual(result, { commented: false, skipped: 'already commented' });
  assert.equal(f.posted.length, 0);
});

test('guardNewIssue stays quiet when there is no strong conflict', async () => {
  const f = fakes({ issueBody: { fields: { summary: 'Add reporting chart', project: { id: '10000' } } } });
  const result = await guardNewIssue(created, f);
  assert.equal(result.commented, false);
  assert.equal(f.posted.length + f.guardCalls.length, 0);
});

test('guardNewIssue releases the claim if posting fails', async () => {
  const f = fakes({ issueBody: conflicting, postStatus: 500 });
  await assert.rejects(guardNewIssue(created, f), /POST comment failed/);
  assert.deepEqual(f.guardCalls.map((c) => c[0]), ['claim', 'release']);
});
