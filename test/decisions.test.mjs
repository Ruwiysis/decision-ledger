import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionStore, toSqlDateTime, fromRow } from '../src/db/decisions.js';
import { titleKey } from '../src/lib/keywords.js';

/**
 * Tiny in-memory stand-in for Forge SQL. It understands exactly the statements the
 * store issues (matched by prefix) and records every query + params for assertions.
 */
function fakeSql() {
  const rows = [];
  const calls = [];
  let nextId = 1;
  const match = (q) => q.replace(/\s+/g, ' ').trim();

  const exec = (query, params) => {
    const q = match(query);
    calls.push({ q, params });
    if (q.startsWith('INSERT INTO decisions')) {
      const [title, tkey, rationale, status, topics, stype, sid, surl, sop, cid, by, at] = params;
      const existing = rows.find((r) => r.source_type === stype && r.source_id === sid && r.title_key === tkey);
      if (existing) {
        Object.assign(existing, { title, rationale, topics, source_url: surl, space_or_project: sop, container_id: cid });
        return { rows: { affectedRows: 2, insertId: 0 } };
      }
      const row = {
        id: nextId++, title, title_key: tkey, rationale, status, topics, source_type: stype, source_id: sid,
        source_url: surl, space_or_project: sop, container_id: cid, decided_by: by, decided_at: at, superseded_by: null,
      };
      rows.push(row);
      return { rows: { affectedRows: 1, insertId: row.id } };
    }
    if (q.includes('WHERE source_type = ? AND source_id = ? AND title_key = ?')) {
      const [stype, sid, tkey] = params;
      return { rows: rows.filter((r) => r.source_type === stype && r.source_id === sid && r.title_key === tkey) };
    }
    if (q.includes('FROM decisions WHERE id = ?')) {
      return { rows: rows.filter((r) => r.id === params[0]) };
    }
    if (q.startsWith('DELETE FROM decisions')) {
      const [stype, sid, ...keep] = params;
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i];
        if (r.source_type === stype && r.source_id === sid && !keep.includes(r.title_key)) rows.splice(i, 1);
      }
      return { rows: { affectedRows: before - rows.length } };
    }
    if (q.startsWith('UPDATE decisions SET status')) {
      const [status, sup, id] = params;
      const r = rows.find((x) => x.id === id);
      if (r) Object.assign(r, { status, superseded_by: sup });
      return { rows: { affectedRows: r ? 1 : 0 } };
    }
    if (q.startsWith('SELECT') && q.includes('LIKE')) {
      // Emulate OR-of-LIKEs: any keyword substring in title/topics/rationale.
      const terms = params.filter((p) => typeof p === 'string' && p.startsWith('%')).map((p) => p.slice(1, -1).toLowerCase());
      return {
        rows: rows.filter((r) =>
          terms.some((t) => [r.title, r.topics, r.rationale].some((f) => String(f || '').toLowerCase().includes(t)))
        ),
      };
    }
    if (q.startsWith('SELECT')) return { rows: [...rows] };
    throw new Error(`fakeSql: unexpected query ${q}`);
  };

  const client = {
    prepare(query) {
      let bound = [];
      return {
        bindParams(...p) {
          bound = p;
          return this;
        },
        execute: async () => exec(query, bound),
      };
    },
  };
  return { client, rows, calls };
}

const newStore = () => {
  const fake = fakeSql();
  let schemaCalls = 0;
  const store = createDecisionStore({ client: fake.client, ensureSchema: async () => void schemaCalls++ });
  return { store, fake, schemaCalls: () => schemaCalls };
};

const pgDecision = {
  title: 'Stay on PostgreSQL for reporting',
  rationale: 'Team expertise; MongoDB lacks the joins we need.',
  topics: ['Database', 'reporting', 'database'],
  sourceType: 'confluence',
  sourceId: '12345',
  sourceUrl: 'https://example.atlassian.net/wiki/pages/12345',
  spaceOrProject: 'ENG',
  containerId: '98765',
  decidedBy: 'acc-1',
  decidedAt: '2026-03-10T09:30:00.000Z',
};

test('upsert inserts a decision and returns it mapped to camelCase', async () => {
  const { store, schemaCalls } = newStore();
  const saved = await store.upsert(pgDecision);
  assert.equal(saved.id, 1);
  assert.equal(saved.status, 'active');
  assert.deepEqual(saved.topics, ['database', 'reporting']); // lowercased + de-duplicated
  assert.equal(saved.decidedAt, '2026-03-10T09:30:00.000Z');
  assert.ok(schemaCalls() > 0, 'ensureSchema is awaited before queries');
});

test('upsert by source does not duplicate when the page is edited', async () => {
  const { store, fake } = newStore();
  await store.upsert(pgDecision);
  const again = await store.upsert({ ...pgDecision, title: '  stay on postgresql FOR reporting ', rationale: 'Updated why' });
  assert.equal(fake.rows.length, 1);
  assert.equal(again.id, 1);
  assert.equal(again.rationale, 'Updated why');
});

test('upsert keeps user-managed status on re-capture', async () => {
  const { store } = newStore();
  const saved = await store.upsert(pgDecision);
  await store.setStatus(saved.id, 'superseded', 7);
  const recaptured = await store.upsert({ ...pgDecision, rationale: 'edited' });
  assert.equal(recaptured.status, 'superseded');
  assert.equal(recaptured.supersededBy, 7);
});

test('upsert validates required fields', async () => {
  const { store } = newStore();
  await assert.rejects(store.upsert({ ...pgDecision, title: '  ' }), /title is required/);
  await assert.rejects(store.upsert({ ...pgDecision, sourceType: 'slack' }), /Invalid sourceType/);
  await assert.rejects(store.upsert({ ...pgDecision, sourceId: '' }), /sourceId is required/);
});

test('removeStaleForSource deletes decisions no longer on the page', async () => {
  const { store, fake } = newStore();
  await store.upsert(pgDecision);
  await store.upsert({ ...pgDecision, title: 'Use Moyasar for payments' });
  await store.upsert({ ...pgDecision, sourceId: 'other-page', title: 'Hire two engineers' });
  const removed = await store.removeStaleForSource('confluence', '12345', ['Stay on PostgreSQL for reporting']);
  assert.equal(removed, 1);
  assert.deepEqual(fake.rows.map((r) => r.title).sort(), ['Hire two engineers', 'Stay on PostgreSQL for reporting']);
});

test('search ranks by keyword overlap and escapes LIKE wildcards', async () => {
  const { store, fake } = newStore();
  await store.upsert(pgDecision);
  await store.upsert({ ...pgDecision, sourceId: 'p2', title: 'Use Moyasar for payments', topics: ['payments'], rationale: 'mada support' });
  const results = await store.search('Migrate reporting DB to MongoDB');
  assert.equal(results[0].decision.title, 'Stay on PostgreSQL for reporting');
  assert.ok(results[0].matched.includes('reporting'));
  // Free text is tokenised (no % or _ survive); keyword arrays pass through, so they must be escaped.
  await store.search(['100%_off']);
  const likeParams = fake.calls.at(-1).params.filter((p) => typeof p === 'string' && p.startsWith('%'));
  assert.ok(likeParams.includes('%100\\%\\_off%'), 'wildcards escaped');
});

test('search with no usable keywords returns [] without querying', async () => {
  const { store, fake } = newStore();
  const before = fake.calls.length;
  assert.deepEqual(await store.search('the and of'), []);
  assert.equal(fake.calls.length, before);
});

test('list builds filtered SQL and rejects bad status', async () => {
  const { store, fake } = newStore();
  await store.list({ status: 'active', spaceOrProject: 'ENG', from: '2026-01-01', limit: 9999 });
  const { q, params } = fake.calls.at(-1);
  assert.match(q, /WHERE status = \? AND space_or_project = \? AND decided_at >= \?/);
  assert.match(q, /LIMIT 500 OFFSET 0/);
  assert.deepEqual(params, ['active', 'ENG', '2026-01-01 00:00:00']);
  await assert.rejects(store.list({ status: 'deleted' }), /Invalid status/);
});

test('getById ignores non-numeric ids', async () => {
  const { store, fake } = newStore();
  const before = fake.calls.length;
  assert.equal(await store.getById('1 OR 1=1'), null);
  assert.equal(fake.calls.length, before);
});

test('helpers: toSqlDateTime and fromRow', () => {
  assert.equal(toSqlDateTime('2026-03-10T09:30:00.123Z'), '2026-03-10 09:30:00');
  assert.throws(() => toSqlDateTime('not a date'), /Invalid date/);
  const d = fromRow({ id: '4', title: 't', status: 'active', topics: '', source_type: 'rovo', source_id: 'x', decided_at: '2026-03-10 09:30:00', superseded_by: null });
  assert.equal(d.id, 4);
  assert.deepEqual(d.topics, []);
  assert.equal(d.decidedAt, '2026-03-10T09:30:00.000Z');
  assert.equal(titleKey(d.title), 't');
});
