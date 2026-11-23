import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractKeywords, scoreDecision, rankDecisions, titleKey } from '../src/lib/keywords.js';

test('extractKeywords drops stopwords, short tokens and numbers, keeps order', () => {
  assert.deepEqual(
    extractKeywords('We should migrate the reporting DB to MongoDB in 2027'),
    ['migrate', 'reporting', 'database', 'mongodb']
  );
});

test('extractKeywords resolves aliases and light plurals', () => {
  assert.deepEqual(extractKeywords('Postgres vendors policies'), ['postgresql', 'vendor', 'policy']);
  assert.deepEqual(extractKeywords('k8s and Mongo'), ['kubernetes', 'mongodb']);
});

test('extractKeywords de-duplicates and handles empty input', () => {
  assert.deepEqual(extractKeywords('PostgreSQL postgres PG'), ['postgresql']);
  assert.deepEqual(extractKeywords(''), []);
  assert.deepEqual(extractKeywords(null), []);
});

test('scoreDecision weighs title > topics > rationale and reports matches', () => {
  const d = {
    title: 'Stay on PostgreSQL for the reporting database',
    topics: ['database', 'reporting'],
    rationale: 'Our team knows Postgres and MongoDB lacks the joins we need.',
  };
  const { score, matched } = scoreDecision(d, ['mongodb', 'postgresql', 'payments']);
  // postgresql: title(3) + rationale(1); mongodb: rationale(1)
  assert.equal(score, 5);
  assert.deepEqual(matched.sort(), ['mongodb', 'postgresql']);
});

test('rankDecisions sorts by score, drops zero, respects limit', () => {
  const list = [
    { id: 1, title: 'Use Moyasar for payments', topics: ['payments'], rationale: 'mada', decidedAt: '2026-01-01' },
    { id: 2, title: 'Stay on PostgreSQL', topics: ['database'], rationale: '', decidedAt: '2026-02-01' },
    { id: 3, title: 'Hire two backend engineers', topics: ['hiring'], rationale: '', decidedAt: '2026-03-01' },
  ];
  const ranked = rankDecisions(list, ['postgresql', 'database', 'payment'], { limit: 5 });
  assert.deepEqual(ranked.map((r) => r.decision.id), [2, 1]);
});

test('titleKey normalises case, whitespace and punctuation', () => {
  assert.equal(titleKey('  Stay on PostgreSQL!  '), titleKey('stay   on postgresql'));
  assert.equal(titleKey('x'.repeat(300)).length, 100);
});
