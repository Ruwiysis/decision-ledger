# Decision Ledger — Progress

> Next session: read `PLAN.md` (full brief) and this file first.

**Deadline:** submit by Dec 22, 2026, 10:00 Riyadh (hard deadline 23:00 Riyadh / 12:00 PST).

## Status
- **Current step:** 2.5 — USER live test of guard
- **Next:** 2.5 — Guard panel + issue-created trigger + Ask Decision Keeper

## Checklist

### Phase 0 — Setup
- [x] 0.1 Machine check (node 22/24 LTS, npm, git, forge CLI)
  - [x] npm 11.6.2, git 2.53.0
  - [x] `@forge/cli@latest` installed globally
  - [x] Node upgraded 24.12.0 → 24.22.3 via `winget upgrade --id OpenJS.NodeJS.24` (CLI requires `^22.23.4 || ^24.22.1 || >=26.12.1`)
  - [x] Forge CLI 15.1.0 runs
- [x] 0.2 Scoped API token (Forge scopes) + `forge login` (credentials in Windows keychain; `forge whoami` OK)
  - Env vars `FORGE_EMAIL`/`FORGE_API_TOKEN` NOT set yet — deferred to 2.6 (demo script)
- [x] 0.3 Dev site (`forge site provision` or go.atlassian.com/cloud-dev) + Rovo enabled
  - [x] Demo site provisioned: https://one-atlas-ejjo.atlassian.net (expires 2027-02-20). Install with `forge install --demo-site` or `--site one-atlas-ejjo.atlassian.net`
  - [x] USER confirmed: Jira, Confluence, Rovo all work
- [x] 0.4 Devpost registration, public GitHub repo `decision-ledger` (MIT), git remote
  - [x] Repo https://github.com/Ruwiysis/decision-ledger (public, MIT, remote `origin`)
  - [x] USER: Devpost registration confirmed

### Phase 1 — Scaffold (Dec 5)
- [x] 1.1 `forge create` (UI Kit, Jira issue panel) → `decision-ledger`
  - App ID `ari:cloud:ecosystem::app/7674119a-33d5-4976-bc59-5f8955c6e895`, in a new Developer Space
  - Scaffold created in `app-tmp/` then moved to repo root
- [x] 1.2 Full manifest + folders + packages
  - All modules verified against current docs via Forge MCP (rovo:skill + rovo:mcp are Preview)
  - Jira required, Confluence optional (`app.compatibility`)
  - Agent prompt is a resource: `prompt: resource:agent-prompt;prompt.md` (dir `agent/`)
  - Migrations via `scheduledTrigger` (hourly) — will also run lazily on first DB use
  - Scopes: read:jira-work, write:jira-work, read:page:confluence, read:confluence-content.summary
  - Swapped template's `-next` prerelease packages for stable: api 8.5, bridge 7.3, react 12.5, resolver 2.0.2, sql 4.0.10
- [x] 1.3 lint clean, deploy, install on Jira + Confluence
  - Deployed v2.0.0 to development; installed Jira + Confluence on one-atlas-ejjo (first Jira install hit a transient 500, retry OK)
  - Ledger URL: https://one-atlas-ejjo.atlassian.net/wiki/apps/7674119a-33d5-4976-bc59-5f8955c6e895/8506e278-b2ea-4584-8460-c29da5c7e56b/decision-ledger
- [x] 1.4 USER confirmed: Jira panel, Confluence ledger page and Decision Keeper agent all render

### Phase 2 — Core features (Dec 6–13)
- [x] 2.1 DB migrations + `src/db/decisions.js` + unit tests
  - `src/db/migrations.js`: `v001_create_decisions` (unique key on source_type+source_id+title_key, indexes on status/container/date). `ensureSchema()` runs lazily on first DB use + hourly scheduled trigger
  - `src/db/decisions.js`: `createDecisionStore({client, ensureSchema})` → upsert (never overwrites status), removeStaleForSource, search (SQL LIKE candidates → JS ranking), list (filters), listContainers, getById, setStatus
  - `src/lib/keywords.js`: extractKeywords (stopwords, aliases e.g. postgres→postgresql, plural stemming), scoreDecision (title 3 / topics 2 / rationale 1), rankDecisions, titleKey
  - Tests: `npm test` (node:test, fake SQL client) — 16/16 pass
  - Verified on real Forge SQL via a temporary token-protected web trigger (11/11 steps OK), then removed it (URL, module, code, secret) → v3.1.0, RoA-eligible again
- [x] 2.2 Confluence capture trigger + ADF fixture tests — live OK (page 4096344: 2 decisions saved)
  - `src/lib/adf.js`: extractDecisions (DECIDED only, recurses into panels/layouts), rationale = inline "because…" → next paragraph ("Because:" stripped) → "Section: <heading>"; adfToText/adfToLines
  - `src/triggers/confluence.js`: fetch v2 page as app (`body-format=atlas_doc_format&include-labels=true`), upsert per decision, prune removed ones; topics = labels + title/heading keywords; logs node types if 0 found
  - Fixture `test/fixtures/architecture-review.adf.json`
- [x] 2.3 Jira comment capture trigger — live OK (MC-42 comment: 1 decision saved)
  - `src/lib/comments.js` parseDecisionComment: must start with "Decision:"; rationale after "Because:" else next line(s) else inline "because"
  - `src/triggers/jira.js` captureComment: source = comment id (edits update, un-decision edits delete), skips restricted comments, link `/browse/KEY?focusedCommentId=`
  - Tests: 36/36 pass. Deployed v3.2.0
- [x] 2.4 Ledger page UI — user verified; cross-product asUser Jira check from Confluence works
  - `src/access.js`: filterVisible() as the user — Confluence `GET /wiki/api/v2/pages?id=…` (page-level, respects restrictions), Jira `GET /rest/api/3/project/search?id=…` (Browse projects). Fail closed. Rovo decisions visible to all
  - Resolvers: listDecisions (search or filtered list), listFilters, getDecision, setStatus (must see decision + replacement; logs accountId)
  - UI: search + status/space/date filters, DynamicTable (Decision button → modal, Why, Status lozenge, User, Date, Source link), modal w/ topics, Superseded-by select, Mark superseded / active again, Open source; loading, empty (2 variants), error+retry
  - Tests: 41/41
- [ ] 2.5 Guard panel + issue-created trigger + Ask Decision Keeper — built + deployed v3.4.0, awaiting live test
  - `src/lib/conflict.js`: change phrases (migrate/replace/switch to/drop/move away from/…) within 8 words of a matched keyword of an ACTIVE decision → conflict; PANEL_MIN_SCORE 3, AUTO_COMMENT_MIN_SCORE 7
  - `src/guard.js`: issueText, fetchIssue, checkText (shared with check-conflicts action later)
  - Panel resolver reads issue key from context, fetches issue asUser, filters visible; UI: warning SectionMessage + View discussion + Ask Decision Keeper (`rovo.open`, appearance=rovo), top 3 cards, empty/error/loading
  - Trigger: fetch as app, one comment max via `guard_comments` table (migration v002, claim → post → record / release on failure)
  - Tests: 52/52
- [ ] 2.6 Demo data script (Nakhla Pay), idempotent
- [ ] 2.7 USER: end-to-end browser test

### Phase 3 — Rovo, MCP, Teamwork Graph (Dec 14–17)
- [ ] 3.1 Four action functions
- [ ] 3.2 `agent/prompt.md` + 4 Rovo chat tests
- [ ] 3.3 `skills/decision-guard/SKILL.md` wired to agent
- [ ] 3.4 MCP deploy + Sprint Planner agent
- [ ] 3.5 STRETCH: Teamwork Graph "Connected work"

### Phase 4 — Polish & submission (Dec 18–22)
- [ ] 4.1 Security + app review, states, 2nd-user access test, production deploy
- [ ] 4.2 Distribution prep: privacy policy page (GitHub Pages) + app details for Sharing — **no Marketplace listing**
- [ ] 4.3 Distribution install link (single app, "Sharing"), test on 2nd site
- [ ] 4.4 Video script + architecture diagram; USER records + uploads
- [ ] 4.5 README.md + SUBMISSION.md (bonus sections: Agents, MCP, Teamwork Graph if shipped — no Marketplace)
- [ ] 4.6 USER: submit on Devpost, check links logged out

## Known issues
- Jira access check is project-level (Browse projects); issue-level security schemes not yet honoured. Revisit at 4.1.
- 2.6 demo data script calls Jira/Confluence REST APIs; the Forge-scoped token likely can't. Plan: user creates a second token with Jira+Confluence scopes (or classic token) stored in env vars.

## Decisions made
- 2026-11-22: Using Node 24 LTS (latest patch) for the Forge CLI.
- 2026-11-23: Using Forge demo site (enterprise Jira/Confluence/JSM/Rovo, has seeded data) instead of free dev site.
- 2026-11-23: PLAN.md + CLAUDE_CODE_PROMPT.md are gitignored (local only); scrubbed from history before first push.
- 2026-11-23: Jira = required product, Confluence = optional (guard panel is core; data residency follows Jira).
- 2026-11-23: Ignoring template AGENTS.md persona/pun instructions; keeping its technical guidance.
- 2026-11-23: **No Marketplace listing; Marketplace bonus dropped.** Single app shared via installation link for judges. Removed from cut order and submission text. (Reasons: multi-app apps can only be listed paid; submitted apps can't use install links.)
- 2026-11-23: **UI copy uses current Jira terms:** "work item" (not issue) and "space" (not project) in all user-facing text, agent prompt, skill, video and submission. Code/API names (issue, project) unchanged.
- 2026-11-23: Relative imports use explicit `.js` extensions so Node's ESM test runner can load `src/` directly (webpack is fine with it).
- 2026-11-23: Authorization lives in callers (resolvers/actions), not the DB layer; DB stores `space_or_project` + `container_id` for access checks.
- 2026-11-23: A web trigger costs the RoA trust signal (major version). Only use temporarily in dev; never ship one.
- 2026-11-23: **Auto-comment privacy rule:** a Jira comment is visible to everyone on the work item, so it only quotes decisions from the same Jira space or Rovo; Confluence-sourced conflicts get a neutral pointer to the (permission-filtered) panel.
- 2026-11-23: setStatus allowed for anyone who can see the decision (logged with accountId).
- 2026-11-23: Forge CLI auth via keychain (`forge login`) instead of env vars, for simplicity.
