import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confluencePageAri, parseConnectedWork } from '../src/lib/twg.js';

test('confluencePageAri builds a page ARI and rejects bad input', () => {
  assert.equal(confluencePageAri('c-1', '4031011'), 'ari:cloud:confluence:c-1:page/4031011');
  assert.equal(confluencePageAri(null, '1'), null);
  assert.equal(confluencePageAri('c-1', 'abc'), null);
});

test('parseConnectedWork: people (deduped, decider excluded) and https pages', () => {
  const body = {
    data: {
      contributors: { edges: [{ node: { accountId: 'a', name: 'A' } }, { node: { accountId: 'a', name: 'A' } }, { node: { accountId: 'me', name: 'Me' } }, { node: { accountId: 'b' } }] },
      linkedPages: { edges: [{ node: { title: 'Infra', webUrl: 'https://x/wiki/p/1' } }, { node: { title: 'Bad', webUrl: 'javascript:alert(1)' } }] },
    },
  };
  const out = parseConnectedWork(body, { excludeAccountIds: ['me'] });
  assert.equal(out.status, 'ok');
  assert.deepEqual(out.people, [{ accountId: 'a', name: 'A' }, { accountId: 'b', name: null }]);
  assert.deepEqual(out.pages, [{ title: 'Infra', url: 'https://x/wiki/p/1', updatedAt: null }]);
});

test('parseConnectedWork: empty data (e.g. scope not granted) is "empty", not an error', () => {
  assert.equal(parseConnectedWork({ data: { contributors: { edges: [] }, linkedPages: null } }).status, 'empty');
});

test('parseConnectedWork: HTTP-200 errors with no data become "error"; partial data still shows', () => {
  assert.equal(parseConnectedWork({ data: null, errors: [{ message: 'boom' }] }).status, 'error');
  const partial = parseConnectedWork({ data: { contributors: { edges: [{ node: { accountId: 'a' } }] } }, errors: [{ message: 'linkedPages failed' }] });
  assert.equal(partial.status, 'ok');
  assert.deepEqual(partial.errors, ['linkedPages failed']);
});
