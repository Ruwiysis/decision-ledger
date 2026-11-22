# Decision Ledger — Progress

> Next session: read `PLAN.md` (full brief) and this file first.

**Deadline:** submit by Dec 22, 2026, 10:00 Riyadh (hard deadline 23:00 Riyadh / 12:00 PST).

## Status
- **Current step:** 0.2 done
- **Next:** 0.3 — dev site (`forge site provision`) + Rovo

## Checklist

### Phase 0 — Setup
- [x] 0.1 Machine check (node 22/24 LTS, npm, git, forge CLI)
  - [x] npm 11.6.2, git 2.53.0
  - [x] `@forge/cli@latest` installed globally
  - [x] Node upgraded 24.12.0 → 24.22.3 via `winget upgrade --id OpenJS.NodeJS.24` (CLI requires `^22.23.4 || ^24.22.1 || >=26.12.1`)
  - [x] Forge CLI 15.1.0 runs
- [x] 0.2 Scoped API token (Forge scopes) + `forge login` (credentials in Windows keychain; `forge whoami` OK)
  - Env vars `FORGE_EMAIL`/`FORGE_API_TOKEN` NOT set yet — deferred to 2.6 (demo script)
- [ ] 0.3 Dev site (`forge site provision` or go.atlassian.com/cloud-dev) + Rovo enabled
- [ ] 0.4 Devpost registration, public GitHub repo `decision-ledger` (MIT), git remote

### Phase 1 — Scaffold (Dec 5)
- [ ] 1.1 `forge create` (UI Kit, Jira issue panel) → `decision-ledger`
- [ ] 1.2 Full manifest + folders + packages
- [ ] 1.3 lint clean, deploy, install on Jira + Confluence
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
- [ ] 4.2 Marketplace: privacy policy, listing, screenshots, submit (by Dec 18)
- [ ] 4.3 Distribution install link, test on 2nd site
- [ ] 4.4 Video script + architecture diagram; USER records + uploads
- [ ] 4.5 README.md + SUBMISSION.md
- [ ] 4.6 USER: submit on Devpost, check links logged out

## Known issues
- 2.6 demo data script calls Jira/Confluence REST APIs; the Forge-scoped token likely can't. Plan: user creates a second token with Jira+Confluence scopes (or classic token) stored in env vars.

## Decisions made
- 2026-11-22: Using Node 24 LTS (latest patch) for the Forge CLI.
- 2026-11-23: Forge CLI auth via keychain (`forge login`) instead of env vars, for simplicity.
