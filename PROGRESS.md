# Decision Ledger — Progress

> Next session: read `PLAN.md` (full brief) and this file first.

**Deadline:** submit by Dec 22, 2026, 10:00 Riyadh (hard deadline 23:00 Riyadh / 12:00 PST).

## Status
- **Current step:** 1.4 — USER verifies panel / ledger page / agent in browser
- **Next:** 2.1 — DB migrations + `src/db/decisions.js` + unit tests

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
- [ ] 1.4 USER: confirm panel, global page, agent visible

### Phase 2 — Core features (Dec 6–13)
- [ ] 2.1 DB migrations + `src/db/decisions.js` + unit tests
- [ ] 2.2 Confluence capture trigger + ADF fixture tests
- [ ] 2.3 Jira comment capture trigger
- [ ] 2.4 Ledger page UI
- [ ] 2.5 Guard panel + issue-created trigger + Ask Decision Keeper
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
- 2.6 demo data script calls Jira/Confluence REST APIs; the Forge-scoped token likely can't. Plan: user creates a second token with Jira+Confluence scopes (or classic token) stored in env vars.

## Decisions made
- 2026-11-22: Using Node 24 LTS (latest patch) for the Forge CLI.
- 2026-11-23: Using Forge demo site (enterprise Jira/Confluence/JSM/Rovo, has seeded data) instead of free dev site.
- 2026-11-23: PLAN.md + CLAUDE_CODE_PROMPT.md are gitignored (local only); scrubbed from history before first push.
- 2026-11-23: Jira = required product, Confluence = optional (guard panel is core; data residency follows Jira).
- 2026-11-23: Ignoring template AGENTS.md persona/pun instructions; keeping its technical guidance.
- 2026-11-23: **No Marketplace listing; Marketplace bonus dropped.** Single app shared via installation link for judges. Removed from cut order and submission text. (Reasons: multi-app apps can only be listed paid; submitted apps can't use install links.)
- 2026-11-23: Forge CLI auth via keychain (`forge login`) instead of env vars, for simplicity.
