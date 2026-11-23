// End-to-end (offline) check of the demo story: seed pages -> capture -> guard every work item.
// Guarantees the three intended conflicts fire (strong enough for the auto-comment) and
// the other work items stay quiet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAGES, ISSUES } from '../scripts/demo-data.mjs';
import { pageAdf } from '../scripts/seed-demo.mjs';
import { capturePage } from '../src/triggers/confluence.js';
import { detectConflicts, AUTO_COMMENT_MIN_SCORE } from '../src/lib/conflict.js';
import { extractKeywords } from '../src/lib/keywords.js';
import { parseDecisionComment } from '../src/lib/comments.js';

async function captureAll() {
  const saved = [];
  const store = {
    upsert: async (d) => {
      const row = { id: saved.length + 1, status: 'active', ...d, topics: (d.topics || []).map((x) => x.toLowerCase()) };
      saved.push(row);
      return row;
    },
    removeStaleForSource: async () => 0,
  };
  let pid = 1000;
  for (const page of PAGES) {
    await capturePage(
      {
        id: String(pid++),
        status: 'current',
        spaceId: '1',
        version: { authorId: 'acc', createdAt: '2026-06-01T00:00:00.000Z' },
        labels: { results: page.labels.map((name) => ({ name })) },
        body: { atlas_doc_format: { value: JSON.stringify(pageAdf(page)) } },
        _links: { base: 'https://x', webui: `/p/${pid}` },
      },
      { spaceKey: 'NAKHLA', store }
    );
  }
  return saved;
}

test('every demo decision is captured with its rationale', async () => {
  const saved = await captureAll();
  const expected = PAGES.flatMap((p) => p.sections.flatMap((s) => s.decisions));
  assert.equal(saved.length, expected.length);
  for (const d of expected) {
    const row = saved.find((r) => r.title === d.title);
    assert.ok(row, `captured: ${d.title}`);
    assert.equal(row.rationale, d.because, `rationale for ${d.title}`);
  }
});

test('the three conflicting work items trigger the guard strongly enough to auto-comment', async () => {
  const saved = await captureAll();
  for (const item of ISSUES.filter((i) => i.conflictsWith)) {
    const { related } = detectConflicts(`${item.summary}\n${item.description}`, saved);
    const best = related.find((r) => r.conflict);
    assert.ok(best, `conflict found for "${item.summary}"`);
    const expected = [].concat(item.conflictsWith);
    assert.ok(expected.includes(best.decision.title), `"${item.summary}" -> ${best.decision.title}`);
    for (const title of expected) assert.ok(related.some((r) => r.conflict && r.decision.title === title), `"${item.summary}" also flags ${title}`);
    assert.ok(best.conflictScore >= AUTO_COMMENT_MIN_SCORE, `"${item.summary}" score ${best.conflictScore}`);
  }
});

test('non-conflicting work items never reach the auto-comment threshold', async () => {
  const saved = await captureAll();
  for (const item of ISSUES.filter((i) => !i.conflictsWith)) {
    const { related } = detectConflicts(`${item.summary}\n${item.description}`, saved);
    const strong = related.find((r) => r.conflict && r.conflictScore >= AUTO_COMMENT_MIN_SCORE);
    assert.equal(strong, undefined, `"${item.summary}" unexpectedly conflicts with "${strong?.decision.title}" (${strong?.conflictScore})`);
  }
});

test('most non-conflicting work items still show at least one related decision', async () => {
  const saved = await captureAll();
  const quiet = ISSUES.filter((i) => !i.conflictsWith);
  const withRelated = quiet.filter((i) => detectConflicts(`${i.summary}\n${i.description}`, saved).related.length > 0);
  assert.ok(withRelated.length >= quiet.length - 2, `${withRelated.length}/${quiet.length} have related decisions`);
});

test('demo Decision comments parse', () => {
  for (const item of ISSUES.filter((i) => i.comment)) {
    const parsed = parseDecisionComment(item.comment);
    assert.ok(parsed && parsed.rationale, item.summary);
    assert.ok(extractKeywords(parsed.title).length > 0);
  }
});
