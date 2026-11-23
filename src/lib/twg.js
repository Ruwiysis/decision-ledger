// Teamwork Graph helpers (pure; unit-tested). The API is GraphQL; failures can arrive as
// HTTP 200 with an `errors` array, and a missing scope silently returns empty results.

export const CONNECTED_WORK_QUERY = `query DecisionLedger_ConnectedWork($id: ID!) {
  contributors: confluencePageContributors(id: $id, first: 8) {
    edges { node { __typename ... on AtlassianUser { accountId name } } }
  }
  linkedPages: confluencePageLinkedConfluencePages(id: $id, first: 6) {
    edges { node { __typename ... on ConfluencePage { title webUrl lastUpdatedAt } } }
  }
}`;

/** ARI for a Confluence page in Teamwork Graph. */
export function confluencePageAri(cloudId, pageId) {
  if (!cloudId || !/^\d+$/.test(String(pageId || ''))) return null;
  return `ari:cloud:confluence:${cloudId}:page/${pageId}`;
}

const nodes = (conn) => (conn?.edges || []).map((e) => e?.node).filter(Boolean);

/**
 * Turn a TWG GraphQL response into { status, people, pages }.
 * status: 'ok' (some data), 'empty' (nothing — or a scope the admin didn't grant), 'error'.
 */
export function parseConnectedWork(body, { excludeAccountIds = [] } = {}) {
  const data = body?.data || null;
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  if (!data && errors.length) return { status: 'error', people: [], pages: [], errors: errors.map((e) => e?.message).filter(Boolean) };

  const skip = new Set(excludeAccountIds.filter(Boolean));
  const seen = new Set();
  const people = [];
  for (const n of nodes(data?.contributors)) {
    if (!n.accountId || skip.has(n.accountId) || seen.has(n.accountId)) continue;
    seen.add(n.accountId);
    people.push({ accountId: n.accountId, name: n.name || null });
  }
  const pages = nodes(data?.linkedPages)
    .filter((n) => n.title && /^https:\/\//.test(String(n.webUrl || '')))
    .map((n) => ({ title: n.title, url: n.webUrl, updatedAt: n.lastUpdatedAt || null }));

  const status = people.length || pages.length ? 'ok' : 'empty';
  // Partial data with field errors still shows what we got.
  return { status, people, pages, errors: errors.map((e) => e?.message).filter(Boolean) };
}
