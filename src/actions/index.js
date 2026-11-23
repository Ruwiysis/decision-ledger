import api, { getAppContext, route } from '@forge/api';
import { decisions } from '../db/decisions.js';
import { filterVisible, canSee } from '../access.js';
import { checkText, fetchIssue, issueText } from '../guard.js';
import { extractKeywords, titleKey } from '../lib/keywords.js';
import { toActionDecision, parseCheckInput, validateLogInput } from '../lib/actions.js';

// Rovo actions — also exposed as MCP tools via rovo:mcp. Each returns a compact JSON string.
//
// Security rules (Forge guidance for actions):
//  - identity comes ONLY from context.principal.accountId, never from inputs;
//  - every read runs/filters AS THE USER, so the agent never sees decisions the user can't;
//  - inputs are untrusted LLM output: validated and length-limited.

const reply = (obj) => JSON.stringify(obj);
const userOf = (context) => context?.principal?.accountId || null;

/** Display names for decider account IDs, as the user (respects profile visibility). Best effort. */
async function displayNames(accountIds) {
  const ids = [...new Set(accountIds.filter(Boolean))].slice(0, 50);
  if (!ids.length) return {};
  try {
    const params = new URLSearchParams({ maxResults: '50' });
    for (const id of ids) params.append('accountId', id);
    const res = await api.asUser().requestJira(route`/rest/api/3/user/bulk?${params}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(String(res.status));
    const body = await res.json();
    return Object.fromEntries((body.values || []).map((u) => [u.accountId, u.displayName]));
  } catch (e) {
    console.warn(`[actions] name lookup failed: ${e.message}`);
    return {};
  }
}

/** Base site URL: from the Rovo context if present, else Jira serverInfo. */
async function siteUrl(payload) {
  const ctxUrl = payload?.context?.jira?.url || payload?.context?.confluence?.url;
  if (ctxUrl) {
    try {
      return new URL(ctxUrl).origin;
    } catch {
      /* fall through */
    }
  }
  const res = await api.asApp().requestJira(route`/rest/api/3/serverInfo`, { headers: { Accept: 'application/json' } });
  return res.ok ? (await res.json()).baseUrl : null;
}

/** Link to the Decision Ledger page in this environment. */
async function ledgerUrl(payload) {
  try {
    const { appAri, environmentAri } = getAppContext();
    const site = await siteUrl(payload);
    return site ? `${site}/wiki/apps/${appAri.appId}/${environmentAri.environmentId}/decision-ledger` : null;
  } catch {
    return null;
  }
}

async function present(list, extras = () => ({})) {
  const names = await displayNames(list.map((x) => (x.decision || x).decidedBy));
  return list.map((x) => ({ ...toActionDecision(x.decision || x, names), ...extras(x) }));
}

/** search-decisions: top 5 visible matches for a topic or question. */
export async function searchDecisions(payload, context) {
  try {
    if (!userOf(context)) return reply({ error: 'No user context.' });
    const query = String(payload?.query || '').slice(0, 300);
    if (extractKeywords(query).length === 0) return reply({ count: 0, results: [], note: 'Query had no searchable keywords. Ask the user for a topic.' });
    const hits = await decisions.search(query, { limit: 25 });
    const visible = (await filterVisible(hits, { pick: (h) => h.decision })).slice(0, 5);
    const results = await present(visible, (h) => ({ matchedWords: h.matched }));
    return reply({ count: results.length, results, ledger: await ledgerUrl(payload) });
  } catch (err) {
    console.error(`[actions] search-decisions failed: ${err?.message}`);
    return reply({ error: 'The Decision Ledger could not be searched right now.' });
  }
}

/** get-decision: full details of one decision by ID. */
export async function getDecision(payload, context) {
  try {
    if (!userOf(context)) return reply({ error: 'No user context.' });
    const id = String(payload?.decisionId || '').replace(/[^\d]/g, '');
    const d = id ? await decisions.getById(id) : null;
    if (!d || !(await canSee(d))) return reply({ found: false, note: 'No decision with that ID is visible to this user.' });
    let supersededBy = null;
    if (d.supersededBy) {
      const s = await decisions.getById(d.supersededBy);
      if (s && (await canSee(s))) supersededBy = { id: s.id, decision: s.title };
    }
    const [result] = await present([d]);
    return reply({ found: true, ...result, topics: d.topics, supersededBy });
  } catch (err) {
    console.error(`[actions] get-decision failed: ${err?.message}`);
    return reply({ error: 'The decision could not be loaded right now.' });
  }
}

/** check-conflicts: related decisions + scores + matched words for a proposal or work item key. */
export async function checkConflicts(payload, context) {
  try {
    if (!userOf(context)) return reply({ error: 'No user context.' });
    const parsed = parseCheckInput(payload?.text, payload?.context?.jira?.issueKey);
    let text = parsed.text;
    let issue = null;
    if (parsed.issueKey) {
      const found = await fetchIssue(parsed.issueKey, api.asUser());
      if (!found) return reply({ error: `Work item ${parsed.issueKey} was not found or is not visible to this user.` });
      issue = { key: parsed.issueKey, summary: found.fields?.summary || '' };
      text = [issueText(found), parsed.extraText].filter(Boolean).join('\n');
    }
    if (extractKeywords(text).length === 0) return reply({ error: 'Nothing to check. Ask the user for the plan or a work item key.' });

    const { related } = await checkText(text, { visible: (list) => filterVisible(list), limit: 5 });
    const results = await present(related, (r) => ({
      relevance: r.score,
      matchedWords: r.matched,
      changeWords: r.changeWords,
      conflictSignal: r.conflict,
    }));
    return reply({
      checked: issue ? { workItem: issue.key, summary: issue.summary } : { text: text.slice(0, 200) },
      hint: 'conflictSignal=true means the text uses change words (migrate/replace/drop…) near words of an ACTIVE decision. Judge it yourself: Conflicts / Related, no conflict / Unclear.',
      count: results.length,
      related: results,
    });
  } catch (err) {
    console.error(`[actions] check-conflicts failed: ${err?.message}`);
    return reply({ error: 'The conflict check failed right now.' });
  }
}

/** log-decision: record a decision from Rovo chat. decided_by = the calling user (from context). */
export async function logDecision(payload, context) {
  try {
    const accountId = userOf(context);
    if (!accountId) return reply({ error: 'No user context; cannot record who decided.' });
    const input = validateLogInput(payload, payload?.context?.jira?.url || payload?.context?.confluence?.url);
    if (input.error) return reply({ saved: false, error: input.error });

    const saved = await decisions.upsert({
      title: input.title,
      rationale: input.rationale,
      topics: extractKeywords(`${input.title} ${input.rationale}`).slice(0, 6),
      sourceType: 'rovo',
      // Same wording = same ledger row, so a repeated "log it" doesn't duplicate.
      sourceId: `rovo:${titleKey(input.title)}`.slice(0, 128),
      sourceUrl: input.sourceUrl,
      spaceOrProject: null,
      decidedBy: accountId,
      decidedAt: new Date().toISOString(),
    });
    console.log(`[actions] log-decision id=${saved?.id} by=${accountId}`);
    return reply({ saved: true, id: saved.id, decision: saved.title, why: saved.rationale, ledger: await ledgerUrl(payload) });
  } catch (err) {
    console.error(`[actions] log-decision failed: ${err?.message}`);
    return reply({ saved: false, error: 'The decision could not be saved right now.' });
  }
}
