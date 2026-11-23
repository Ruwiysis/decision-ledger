import api, { route } from '@forge/api';

// Who can see which decision. Every read path (ledger, guard panel, Rovo actions) goes
// through filterVisible(), and the checks run AS THE USER, so Atlassian's own permissions
// decide: Confluence page restrictions/space permissions, Jira "Browse projects".
// Fail closed: if a check errors, the affected decisions are hidden.

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/** Confluence: GET /wiki/api/v2/pages?id=... returns only pages the user can view (max 250 ids). */
export async function visibleConfluencePages(pageIds, requester = api.asUser()) {
  const ids = [...new Set(pageIds.map(String).filter((id) => /^\d+$/.test(id)))];
  const visible = new Set();
  for (const group of chunk(ids, 250)) {
    const params = new URLSearchParams({ id: group.join(','), limit: '250' });
    const res = await requester.requestConfluence(route`/wiki/api/v2/pages?${params}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Confluence visibility check failed: ${res.status}`);
    const body = await res.json();
    for (const p of body.results || []) visible.add(String(p.id));
  }
  return visible;
}

/** Jira: GET /rest/api/3/project/search?id=... returns only projects the user can browse (max 50 ids). */
export async function visibleJiraProjects(projectIds, requester = api.asUser()) {
  const ids = [...new Set(projectIds.map(String).filter((id) => /^\d+$/.test(id)))];
  const visible = new Set();
  for (const group of chunk(ids, 50)) {
    const params = new URLSearchParams({ maxResults: '50' });
    for (const id of group) params.append('id', id);
    const res = await requester.requestJira(route`/rest/api/3/project/search?${params}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Jira visibility check failed: ${res.status}`);
    const body = await res.json();
    for (const p of body.values || []) visible.add(String(p.id));
  }
  return visible;
}

/**
 * Pure rule: which decisions are visible given the sets of visible page/project ids.
 * - confluence: the source page must be visible (covers page restrictions + space permissions)
 * - jira: the work item's project (space) must be browsable
 * - rovo: logged in chat, not tied to a container: visible to everyone with app access
 * A null set means the check failed -> hide that source type (fail closed).
 */
export function applyVisibility(decisions, { pages, projects }) {
  return decisions.filter((d) => {
    if (d.sourceType === 'rovo') return true;
    if (d.sourceType === 'confluence') return !!pages && pages.has(String(d.sourceId));
    if (d.sourceType === 'jira') return !!projects && !!d.containerId && projects.has(String(d.containerId));
    return false;
  });
}

/**
 * Filter decisions to the ones the current user may see. Works on plain decisions or on
 * { decision, ... } wrappers (search results) via `pick`.
 */
export async function filterVisible(items, { pick = (x) => x, requester } = {}) {
  const list = items || [];
  const decisions = list.map(pick);
  const pageIds = decisions.filter((d) => d.sourceType === 'confluence').map((d) => d.sourceId);
  const projectIds = decisions.filter((d) => d.sourceType === 'jira' && d.containerId).map((d) => d.containerId);
  const asUser = requester || api.asUser();

  const [pages, projects] = await Promise.all([
    pageIds.length
      ? visibleConfluencePages(pageIds, asUser).catch((e) => (console.warn(`[access] ${e.message}`), null))
      : new Set(),
    projectIds.length
      ? visibleJiraProjects(projectIds, asUser).catch((e) => (console.warn(`[access] ${e.message}`), null))
      : new Set(),
  ]);
  const allowed = new Set(applyVisibility(decisions, { pages, projects }).map((d) => d.id));
  return list.filter((item) => allowed.has(pick(item).id));
}

/** True if the current user may see this one decision. */
export async function canSee(decision, opts) {
  if (!decision) return false;
  return (await filterVisible([decision], opts)).length === 1;
}
