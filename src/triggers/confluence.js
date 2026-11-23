import api, { route } from '@forge/api';
import { decisions as defaultStore } from '../db/decisions.js';
import { extractDecisions, parseAdf } from '../lib/adf.js';
import { extractKeywords } from '../lib/keywords.js';

/**
 * Turn a Confluence v2 page (fetched with body-format=atlas_doc_format&include-labels=true)
 * into ledger rows: upsert every DECIDED decision, delete ones removed from the page.
 * Pure apart from the injected store, so it is unit-tested with an ADF fixture.
 */
export async function capturePage(page, { spaceKey, store = defaultStore } = {}) {
  if (!page || page.status !== 'current') return { skipped: 'not current', saved: 0, removed: 0 };
  const doc = parseAdf(page.body?.atlas_doc_format?.value);
  if (!doc) return { skipped: 'no body', saved: 0, removed: 0 };

  const found = extractDecisions(doc);
  const labels = (page.labels?.results || []).map((l) => l.name).filter(Boolean);
  const base = page._links?.base || '';
  const sourceUrl = page._links?.webui ? `${base}${page._links.webui}` : null;
  const decidedBy = page.version?.authorId || page.authorId || null;
  const decidedAt = page.version?.createdAt || page.createdAt || new Date().toISOString();

  let saved = 0;
  for (const d of found) {
    const topics = [
      ...labels,
      ...extractKeywords(d.title).slice(0, 4),
      ...extractKeywords(d.heading || '').slice(0, 2),
    ];
    await store.upsert({
      title: d.title,
      rationale: d.rationale,
      topics,
      sourceType: 'confluence',
      sourceId: String(page.id),
      sourceUrl,
      spaceOrProject: spaceKey || null,
      containerId: page.spaceId || null,
      decidedBy,
      decidedAt,
    });
    saved++;
  }
  // The page is the source of truth: drop decisions that were deleted or edited away.
  const removed = await store.removeStaleForSource('confluence', String(page.id), found.map((d) => d.title));
  return { saved, removed };
}

/** Fetch a page as the app (triggers have no user) in the ADF representation, with labels. */
async function fetchPage(pageId) {
  const res = await api
    .asApp()
    .requestConfluence(
      route`/wiki/api/v2/pages/${pageId}?body-format=atlas_doc_format&include-labels=true`,
      { headers: { Accept: 'application/json' } }
    );
  if (!res.ok) throw new Error(`GET page ${pageId} failed: ${res.status}`);
  return res.json();
}

/** Trigger: avi:confluence:created:page / avi:confluence:updated:page. */
export async function onConfluencePage(event) {
  const content = event?.content;
  if (!content?.id || content.type !== 'page') return;
  if (content.status && content.status !== 'current') return;
  try {
    const page = await fetchPage(content.id);
    const result = await capturePage(page, { spaceKey: content.space?.key });
    console.log(`[capture] confluence page=${content.id} space=${content.space?.key} ${JSON.stringify(result)}`);
    const raw = page?.body?.atlas_doc_format?.value || '';
    if (!result.saved && /decision/i.test(raw)) {
      // Diagnostic: the page mentions decisions but none were extracted — show node types seen.
      const types = [...new Set((raw.match(/"type":"[a-zA-Z]+"/g) || []).map((t) => t.slice(8, -1)))];
      console.warn(`[capture] confluence page=${content.id} had 0 decisions; node types: ${types.join(',')}`);
    }
  } catch (err) {
    // Log and swallow: retrying a malformed page forever helps nobody.
    console.error(`[capture] confluence page=${content.id} failed: ${err?.message}`);
  }
}
