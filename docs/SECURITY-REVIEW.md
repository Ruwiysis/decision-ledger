# Decision Ledger: security review

**Date:** 2026-11-23 · **Scope:** the whole Forge app (manifest, 9 functions, 2 UI Kit modules, 4 Rovo actions/MCP tools) · **Method:** the Forge Skills `forge-security-review` workflow, with deterministic scanners followed by a manual source-to-sink review against the Forge rule set.

## Result

| | |
|---|---|
| Deterministic scanners | FSRT v0.1.1 **0 findings** · OpenGrep 1.16.2 with 44 Forge rules **0 findings** (21 source files, 0 parse errors) |
| Manual review | **2 confidentiality issues + 1 multi-tenant correctness issue found and fixed** (below) |
| Open confirmed vulnerabilities | **None** |

## Attack surface

| Entry point | Runs as | Input | Authorization |
|---|---|---|---|
| Jira panel resolver `relatedDecisions` | user | work item key from **Forge context** (not payload) | work item read `asUser`; every decision filtered by `filterVisible` |
| Confluence page resolvers `listDecisions`, `listFilters`, `getDecision`, `setStatus`, `connectedWork` | user | IDs / filters from payload (validated) | `filterVisible` / `canSee` before any read or write; identity from `context.accountId` |
| Rovo actions = MCP tools (`search-decisions`, `get-decision`, `check-conflicts`, `log-decision`) | user | LLM-generated inputs (treated as untrusted) | identity from `context.principal.accountId` only; reads filtered as the user; inputs length-bounded and validated; https-only links |
| Trigger `avi:confluence:created/updated:page` | app | platform event | reads only the page named by the signed event |
| Trigger `avi:jira:commented:issue` (`ignoreSelf`) | app | platform event | restricted comments are skipped |
| Trigger `avi:jira:created:issue` (`ignoreSelf`) | app | platform event | posts at most one comment; see the privacy rule below |
| Scheduled trigger (migrations) | app | none | n/a |
| Web triggers / external egress / remotes | **none** | | |

**Visibility model.** Visibility is checked **as the viewing user**, and the app fails closed: if a check errors, the affected decisions are hidden.
- **Confluence decisions:** `GET /wiki/api/v2/pages?id=…` returns only pages the user can view, so page restrictions and space permissions are respected. Trashed pages are not returned.
- **Jira decisions:** `POST /rest/api/3/issue/bulkfetch` returns only work items the user can see, honouring Browse permission **and work item security levels**.
- **Rovo-logged decisions:** these are team-wide by design.

## Findings fixed in this review

| # | Issue | Class | Fix |
|---|---|---|---|
| 1 | Jira decisions were visible to anyone with *Browse projects* on the space, even when the source work item had a **security level**. | Confidentiality (CWE-863), Medium | Visibility is now checked per work item with `issue/bulkfetch` as the user (`src/access.js`). Covered by a test. |
| 2 | The automatic conflict comment (posted `asApp`, readable by everyone on the work item) could quote a Jira decision from a **more restricted** work item. | Confidentiality (CWE-200), Medium | The comment now quotes **only Rovo-logged decisions**. Others get a neutral pointer to the permission-aware panel (`src/triggers/jira.js`). Covered by a test. |
| 3 | The "schema ready" promise was module-level. Warm runtimes are reused across installations, so a **new site could skip its migrations**. | Tenant isolation pattern (CWE-1189), availability | The memo is now keyed by `installationId`, and no tenant data is cached (`src/db/migrations.js`). |

## Checked and fine

- **SQL injection.** Every query uses `sql.prepare(...).bindParams(...)`. LIMIT/OFFSET values are numbers that are clamped. LIKE wildcards are escaped. Migration DDL is static.
- **XSS.** The app is UI Kit only: no HTML sinks and no CSP relaxations. Links come from the Atlassian APIs or are validated `https:` URLs.
- **SSRF / egress.** Only `route`-templated Atlassian API calls are made, with IDs validated by regex. There is no `fetch`, and no `permissions.external` entry.
- **Secrets.** There are none in the code. The demo seed script reads credentials from environment variables only, and is not part of the deployed app.
- **Logs.** They contain IDs, counts and account IDs for auditing, but no content bodies, tokens or emails.
- **Least privilege.** Every scope maps to a call:
  - `read:jira-work`: events, work item reads, bulk fetch.
  - `write:jira-work`: the single guard comment.
  - `read:page:confluence`: page body, labels and visibility.
  - `read:confluence-content.summary`: page events.
  - `read:jira-user`: decider names.
  - `read:graph:page:confluence` and `read:graph:user:atlassian`: Teamwork Graph.
  - Not requested: `write:confluence-content`, which is why we don't subscribe to the trashed/deleted page events.

## Accepted by design (documented)

- **Changing a decision's status.** Anyone who can *see* a decision can mark it superseded or active again. This keeps the ledger a shared team tool. Each change is logged with the account ID.
- **Rovo-logged decisions.** They are visible to everyone with app access, and the agent tells users before logging.

## Dependencies

`npm audit` reports advisories only in **transitive dependencies of Atlassian's own `@forge/react` / `@forge/bridge` / `@forge/api`**, which are already at their latest versions: ProseMirror paste XSS, markdown-it ReDoS, and glob/minimatch at build time.
- npm's only "fix" is downgrading those packages to old major versions, which we rejected.
- The app doesn't use the editor, markdown parsing or glob at runtime.
- The non-breaking fix for markdown-it was applied.

## Coverage and gaps

- **Tools.** FSRT and OpenGrep ran to completion. Their bundled Windows launcher needs PowerShell 7, so they were run through a PowerShell 5.1-compatible copy, with checksums verified.
- **Not run.** Snyk and gitleaks were not run. `npm audit` was.
- **Runtime verification still to do (step 4.1).** A second user with no access to one space, and one secured work item, should see neither in the ledger, the panel or Rovo answers.
