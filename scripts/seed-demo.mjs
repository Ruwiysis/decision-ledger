#!/usr/bin/env node
// Seed the "Nakhla Pay" demo: a Confluence space with decision pages, then a Jira space
// (project) with work items — three of which conflict with earlier decisions.
//
// Safe to run twice: everything is looked up by key/title first and only created if missing.
//
// Usage (PowerShell):
//   $env:ATLASSIAN_SITE="your-site.atlassian.net"; npm run seed            # full run
//   npm run seed -- --dry-run          # print what would happen, no API calls
//   npm run seed -- --confluence-only  # only pages
//   npm run seed -- --jira-only        # only work items (run after pages were captured)
//   npm run seed -- --wait=180         # seconds to wait between pages and work items (default 180)
//   npm run seed -- --project=MC       # use an existing Jira space instead of creating NP
//   npm run seed -- --confluence-only --update   # rewrite existing demo pages with current content
//
// Credentials come from environment variables, never from arguments or files:
//   ATLASSIAN_EMAIL, ATLASSIAN_API_TOKEN (a classic API token from id.atlassian.com)

import { SPACE, PROJECT, PAGES, ISSUES } from './demo-data.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const DRY = !!args['dry-run'];
const WAIT = Number(args.wait ?? 180);
const PROJECT_KEY = String(args.project || PROJECT.key).toUpperCase();

const site = (process.env.ATLASSIAN_SITE || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
const email = process.env.ATLASSIAN_EMAIL || '';
const token = process.env.ATLASSIAN_API_TOKEN || '';

function requireEnv() {
  if (!DRY && (!site || !email || !token)) {
    console.error('Missing env vars. Set ATLASSIAN_SITE, ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN (see README).');
    process.exit(1);
  }
}

const BASE = `https://${site}`;
const AUTH = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');
const log = (...m) => console.log(...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(method, path, body) {
  if (DRY) return { dry: true };
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: AUTH, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt < 5) {
      const wait = Number(res.headers.get('retry-after') || 5) * 1000;
      log(`  rate limited, retrying in ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    const text = await res.text();
    const json = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
    if (!res.ok) {
      const err = new Error(`${method} ${path} -> ${res.status}: ${typeof json === 'string' ? json.slice(0, 300) : JSON.stringify(json).slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return json;
  }
}

// ---------------------------------------------------------------- ADF builders
const t = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const p = (...content) => ({ type: 'paragraph', content: content.map((c) => (typeof c === 'string' ? t(c) : c)) });
const h = (level, text) => ({ type: 'heading', attrs: { level }, content: [t(text)] });
let localIdSeq = 0;
const lid = () => `nakhla-${Date.now().toString(36)}-${(localIdSeq++).toString(36)}`;
const dateNode = (ms) => ({ type: 'date', attrs: { timestamp: String(ms) } });
const decisionList = (items) => ({
  type: 'decisionList',
  attrs: { localId: lid() },
  content: items.map(({ title, ms }) => ({
    type: 'decisionItem',
    attrs: { localId: lid(), state: 'DECIDED' },
    content: ms ? [t(`${title} — `), dateNode(ms)] : [t(title)],
  })),
});

/**
 * Page ADF. Each Decision carries a /date: the page's decidedOn plus 2 days per section.
 * `links` (title -> URL) adds a "Related pages" line, which Teamwork Graph picks up as page links.
 */
export function pageAdf(page, links = {}) {
  const base = page.decidedOn ? Date.parse(`${page.decidedOn}T09:00:00Z`) : null;
  const content = [];
  if (page.intro) content.push(p(page.intro));
  page.sections.forEach((s, i) => {
    content.push(h(2, s.heading));
    if (s.intro) content.push(p(s.intro));
    for (const d of s.decisions) {
      content.push(decisionList([{ title: d.title, ms: base ? base + i * 2 * 86400000 : null }]));
      if (d.because) content.push(p(t('Because: ', [{ type: 'strong' }]), d.because));
    }
  });
  const related = (page.related || []).filter((t) => links[t]);
  if (related.length) {
    const parts = [t('Related pages: ', [{ type: 'strong' }])];
    related.forEach((title, i) => {
      if (i) parts.push(t(' · '));
      parts.push(t(title, [{ type: 'link', attrs: { href: links[title] } }]));
    });
    content.push({ type: 'rule' }, { type: 'paragraph', content: parts });
  }
  return { type: 'doc', version: 1, content };
}

const doc = (...paragraphs) => ({ type: 'doc', version: 1, content: paragraphs.map((x) => p(x)) });

// ---------------------------------------------------------------- Confluence
async function ensureSpace() {
  if (DRY) return log(`[dry] ensure Confluence space ${SPACE.key}`), { id: 'DRY', key: SPACE.key };
  const found = await http('GET', `/wiki/api/v2/spaces?keys=${SPACE.key}`);
  if (found.results?.[0]) {
    log(`✓ space ${SPACE.key} exists (id ${found.results[0].id})`);
    return found.results[0];
  }
  log(`+ creating space ${SPACE.key}`);
  // v1 create is the stable, widely available endpoint.
  await http('POST', `/wiki/rest/api/space`, {
    key: SPACE.key,
    name: SPACE.name,
    description: { plain: { value: SPACE.description, representation: 'plain' } },
  });
  const again = await http('GET', `/wiki/api/v2/spaces?keys=${SPACE.key}`);
  return again.results[0];
}

/** Title -> URL of the demo pages that already exist (used to cross-link them on --update). */
async function pageLinks(space) {
  const links = {};
  for (const page of PAGES) {
    const q = new URLSearchParams({ 'space-id': space.id, title: page.title, status: 'current' });
    const found = await http('GET', `/wiki/api/v2/pages?${q}`);
    const id = found.results?.[0]?.id;
    if (id) links[page.title] = `${BASE}/wiki/spaces/${SPACE.key}/pages/${id}`;
  }
  return links;
}

async function ensurePage(space, page, links = {}) {
  const decisions = page.sections.reduce((n, s) => n + s.decisions.length, 0);
  if (DRY) return log(`[dry] page "${page.title}" (${decisions} decisions, labels: ${page.labels.join(', ')})`);
  const q = new URLSearchParams({ 'space-id': space.id, title: page.title, status: 'current' });
  const found = await http('GET', `/wiki/api/v2/pages?${q}`);
  if (found.results?.[0]) {
    if (!args.update) return log(`✓ page "${page.title}" exists`);
    // --update: publish a new version with the current demo content (Decision Ledger re-captures it).
    const current = await http('GET', `/wiki/api/v2/pages/${found.results[0].id}`);
    await http('PUT', `/wiki/api/v2/pages/${current.id}`, {
      id: current.id,
      status: 'current',
      title: page.title,
      body: { representation: 'atlas_doc_format', value: JSON.stringify(pageAdf(page, links)) },
      version: { number: (current.version?.number || 1) + 1, message: 'Decision Ledger demo update' },
    });
    return log(`~ page "${page.title}" updated (${decisions} decisions)`);
  }
  const created = await http('POST', `/wiki/api/v2/pages`, {
    spaceId: space.id,
    status: 'current',
    title: page.title,
    body: { representation: 'atlas_doc_format', value: JSON.stringify(pageAdf(page)) },
  });
  if (page.labels?.length) {
    await http('POST', `/wiki/rest/api/content/${created.id}/label`, page.labels.map((name) => ({ prefix: 'global', name })));
  }
  log(`+ page "${page.title}" (${decisions} decisions)`);
}

// ---------------------------------------------------------------- Jira
async function ensureProject() {
  if (DRY) return log(`[dry] ensure Jira space ${PROJECT_KEY}`), { key: PROJECT_KEY };
  try {
    const p0 = await http('GET', `/rest/api/3/project/${PROJECT_KEY}`);
    log(`✓ Jira space ${PROJECT_KEY} exists`);
    return p0;
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  const me = await http('GET', `/rest/api/3/myself`);
  log(`+ creating Jira space ${PROJECT_KEY}`);
  try {
    await http('POST', `/rest/api/3/project`, {
      key: PROJECT_KEY,
      name: PROJECT.name,
      projectTypeKey: 'software',
      projectTemplateKey: 'com.pyxis.greenhopper.jira:gh-simplified-kanban-classic',
      leadAccountId: me.accountId,
      assigneeType: 'UNASSIGNED',
    });
  } catch (e) {
    console.error(`Could not create Jira space ${PROJECT_KEY}: ${e.message}`);
    console.error(`Create it by hand (Jira → Create space → Kanban, key ${PROJECT_KEY}) or rerun with --project=<existing key>.`);
    process.exit(1);
  }
  return http('GET', `/rest/api/3/project/${PROJECT_KEY}`);
}

async function issueTypeId(projectKey) {
  const res = await http('GET', `/rest/api/3/issue/createmeta/${projectKey}/issuetypes`);
  const types = res.issueTypes || res.values || [];
  const task = types.find((x) => x.name === 'Task') || types.find((x) => !x.subtask);
  if (!task) throw new Error(`No usable work type in ${projectKey}`);
  return task.id;
}

async function findIssue(projectKey, summary) {
  const jql = `project = "${projectKey}" AND summary ~ "\\"${summary.replace(/["\\]/g, ' ')}\\"" ORDER BY created ASC`;
  const res = await http('POST', `/rest/api/3/search/jql`, { jql, fields: ['summary'], maxResults: 20 });
  return (res.issues || []).find((i) => i.fields?.summary === summary) || null;
}

async function ensureIssue(projectKey, typeId, item) {
  if (DRY) return log(`[dry] work item "${item.summary}"${item.conflictsWith ? `  ⚠ conflicts with "${[].concat(item.conflictsWith).join('" / "')}"` : ''}${item.comment ? '  + Decision comment' : ''}`);
  const existing = await findIssue(projectKey, item.summary);
  if (existing) return log(`✓ ${existing.key} "${item.summary}" exists`);
  const created = await http('POST', `/rest/api/3/issue`, {
    fields: {
      project: { key: projectKey },
      issuetype: { id: typeId },
      summary: item.summary,
      description: doc(item.description),
      labels: ['nakhla-demo'],
    },
  });
  if (item.comment) await http('POST', `/rest/api/3/issue/${created.key}/comment`, { body: doc(...item.comment) });
  log(`+ ${created.key} "${item.summary}"${item.conflictsWith ? '  ⚠ expected conflict' : ''}`);
}

// ---------------------------------------------------------------- main
async function main() {
  requireEnv();
  log(`Nakhla Pay demo seed → ${DRY ? '(dry run)' : BASE}`);
  if (!args['jira-only']) {
    const space = await ensureSpace();
    const links = args.update && !DRY ? await pageLinks(space) : {};
    for (const page of PAGES) await ensurePage(space, page, links);
    const total = PAGES.reduce((n, pg) => n + pg.sections.reduce((m, s) => m + s.decisions.length, 0), 0);
    log(`Confluence: ${PAGES.length} pages, ${total} decisions.`);
  }
  if (!args['confluence-only']) {
    if (!args['jira-only'] && WAIT > 0 && !DRY) {
      log(`Waiting ${WAIT}s so Decision Ledger captures the pages before work items are created…`);
      for (let s = WAIT; s > 0; s -= 30) {
        process.stdout.write(`  ${s}s left\r`);
        await sleep(Math.min(30, s) * 1000);
      }
      log('');
    }
    const project = await ensureProject();
    const typeId = DRY ? 'DRY' : await issueTypeId(project.key);
    for (const item of ISSUES) await ensureIssue(project.key, typeId, item);
    log(`Jira: ${ISSUES.length} work items (${ISSUES.filter((i) => i.conflictsWith).length} expected conflicts).`);
  }
  log('Done.');
}

// Run only when executed directly (tests import pageAdf without side effects).
const isMain = import.meta.url === new URL(`file:///${process.argv[1]?.replace(/\\/g, '/').replace(/^\//, '')}`).href;
if (isMain) {
  main().catch((e) => {
    console.error(`\n✗ ${e.message}`);
    process.exit(1);
  });
}
