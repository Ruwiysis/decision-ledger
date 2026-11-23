import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractDecisions, adfToText, splitInlineRationale, parseAdf } from '../src/lib/adf.js';
import { capturePage } from '../src/triggers/confluence.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/architecture-review.adf.json', import.meta.url), 'utf8'));

test('extractDecisions returns only DECIDED, non-empty items, in document order', () => {
  const found = extractDecisions(fixture);
  assert.deepEqual(found.map((d) => d.localId), ['d-1', 'd-2', 'd-4', 'd-5']);
});

test('rationale: following paragraph (skipping empty ones, stripping "Because:")', () => {
  const [pg] = extractDecisions(fixture);
  assert.equal(pg.title, 'Stay on PostgreSQL for the reporting database');
  assert.equal(pg.rationale, 'our team already runs Postgres and reporting needs joins across ledgers.');
  assert.equal(pg.heading, 'Reporting database');
});

test('rationale: inline "because" clause wins and is split from the title', () => {
  const moyasar = extractDecisions(fixture).find((d) => d.localId === 'd-2');
  assert.equal(moyasar.title, 'Use Moyasar for card payments');
  assert.equal(moyasar.rationale, 'it supports mada');
});

test('rationale: falls back to the section heading when nothing follows', () => {
  const payouts = extractDecisions(fixture).find((d) => d.localId === 'd-4');
  assert.equal(payouts.rationale, 'Section: Payments provider');
});

test('decisions nested in panels are found, mentions become text, paragraph in panel is rationale', () => {
  const sso = extractDecisions(fixture).find((d) => d.localId === 'd-5');
  assert.equal(sso.title, 'Require SSO for all staff, owner @Sara');
  assert.equal(sso.rationale, 'Reduces account takeover risk flagged in the audit.');
  assert.equal(sso.heading, 'Security');
});

test('a /date inside a decision becomes decidedAt and is removed from the title', () => {
  const ts = String(Date.UTC(2025, 8, 15));
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'decisionList',
        content: [
          {
            type: 'decisionItem',
            attrs: { localId: 'x', state: 'DECIDED' },
            content: [{ type: 'text', text: 'Stay on PostgreSQL — ' }, { type: 'date', attrs: { timestamp: ts } }],
          },
        ],
      },
    ],
  };
  const [d] = extractDecisions(doc);
  assert.equal(d.title, 'Stay on PostgreSQL');
  assert.equal(d.decidedAt, '2025-09-15T00:00:00.000Z');
  assert.equal(extractDecisions(fixture)[0].decidedAt, null);
});

test('helpers: adfToText, splitInlineRationale, parseAdf', () => {
  assert.equal(adfToText({ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] }).trim(), 'a\nb');
  assert.deepEqual(splitInlineRationale('Delay launch due to compliance review'), { title: 'Delay launch', rationale: 'compliance review' });
  assert.deepEqual(splitInlineRationale('Ship it'), { title: 'Ship it', rationale: '' });
  assert.equal(parseAdf('{bad json'), null);
  assert.deepEqual(parseAdf('{"type":"doc"}'), { type: 'doc' });
});

function fakeStore() {
  const upserts = [];
  const removals = [];
  return {
    upserts,
    removals,
    upsert: async (d) => (upserts.push(d), { id: upserts.length, ...d }),
    removeStaleForSource: async (type, id, titles) => (removals.push({ type, id, titles }), 0),
  };
}

const page = {
  id: '555',
  status: 'current',
  spaceId: '777',
  authorId: 'acc-author',
  createdAt: '2026-02-01T10:00:00.000Z',
  version: { authorId: 'acc-editor', createdAt: '2026-03-10T09:30:00.000Z' },
  labels: { results: [{ name: 'architecture' }, { name: 'database' }] },
  body: { atlas_doc_format: { value: JSON.stringify(fixture) } },
  _links: { base: 'https://site.atlassian.net/wiki', webui: '/spaces/ENG/pages/555/Architecture+review' },
};

test('capturePage upserts each decision with source, labels+keywords as topics, and prunes stale', async () => {
  const store = fakeStore();
  const result = await capturePage(page, { spaceKey: 'ENG', store });
  assert.deepEqual(result, { saved: 4, removed: 0 });
  const pg = store.upserts[0];
  assert.equal(pg.sourceType, 'confluence');
  assert.equal(pg.sourceId, '555');
  assert.equal(pg.sourceUrl, 'https://site.atlassian.net/wiki/spaces/ENG/pages/555/Architecture+review');
  assert.equal(pg.spaceOrProject, 'ENG');
  assert.equal(pg.containerId, '777');
  assert.equal(pg.decidedBy, 'acc-editor');
  assert.equal(pg.decidedAt, '2026-03-10T09:30:00.000Z');
  assert.ok(pg.topics.includes('architecture') && pg.topics.includes('postgresql'));
  assert.deepEqual(store.removals, [{ type: 'confluence', id: '555', titles: store.upserts.map((u) => u.title) }]);
});

test('capturePage skips non-current pages and empty bodies; a page with no decisions prunes all', async () => {
  const store = fakeStore();
  assert.equal((await capturePage({ ...page, status: 'draft' }, { store })).skipped, 'not current');
  assert.equal((await capturePage({ ...page, body: {} }, { store })).skipped, 'no body');
  const empty = { ...page, body: { atlas_doc_format: { value: '{"type":"doc","version":1,"content":[]}' } } };
  assert.deepEqual(await capturePage(empty, { store }), { saved: 0, removed: 0 });
  assert.deepEqual(store.removals.at(-1).titles, []);
});
