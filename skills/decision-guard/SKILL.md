---
name: decision-guard
description: Check a plan, sprint, proposal or Jira work item against the team's past decisions in the Decision Ledger before work starts, and flag anything that would quietly undo an earlier decision. Use when someone plans, scopes, reviews or prioritises work.
compatibility: Requires the Decision Ledger Forge app (Jira and Confluence). Uses its search-decisions and check-conflicts actions.
allowed-tools: search-decisions check-conflicts
metadata:
  app: decision-ledger
  version: "1.0"
---

# Decision guard

Teams record decisions in Confluence pages, Jira comments and chat. Months later new work quietly
reverses them. This skill makes you check planned work against those decisions **before** it starts,
and explain any clash with evidence.

## When to use this skill

Use it whenever the user:

- plans or reviews a sprint, backlog, roadmap or set of work items;
- proposes a change ("let's migrate…", "we should replace…", "drop X", "switch to Y");
- asks whether something "goes against", "conflicts with" or "was already decided";
- creates or refines a Jira work item that changes architecture, vendors, pricing, security or process.

Do not use it for questions that are only about *why* one decision was made: call `search-decisions` directly.

## Tools

### `check-conflicts`

Input `text`: either a Jira work item key (`NP-1`), a work item URL, or the plan in plain words.
Call it **once per work item or proposal**. For a sprint, call it for each work item (most important first,
at most 10).

It returns `related`: up to 5 decisions, each with:

| field | meaning |
| --- | --- |
| `decision`, `why` | what was decided and the reason |
| `status` | `active`, `superseded` or `reversed` |
| `decidedBy`, `decidedOn`, `link` | who, when, where it was discussed |
| `relevance` | keyword overlap score (higher = more related) |
| `matchedWords` | words shared by the work and the decision |
| `changeWords` | change words found near those words (migrate, replace, drop, switch…) |
| `conflictSignal` | `true` when change words appear near words of an **active** decision |

`conflictSignal` is a **hint, not a verdict**. Read the decision and the work yourself.

### `search-decisions`

Input `query`: short keywords ("PostgreSQL reporting", "payment gateway"). Use it to look for a decision on
a specific topic the user mentions that `check-conflicts` did not surface, or to answer a follow-up question.

## How to judge each related decision

Give exactly one verdict per work item:

- **Conflicts**: doing the work would undo, contradict or bypass an **active** decision.
  Example: work "Migrate reporting DB to MongoDB" vs decision "Stay on PostgreSQL for the reporting database".
- **Related, no conflict**: same topic, but the work is compatible or even implements the decision.
  Example: work "Rotate payment gateway API keys for Q4" vs decision "Rotate payment gateway API keys every 90 days".
- **Unclear**: related, but you can't tell from the text. Say what information is missing.

Rules:

1. Decisions with status `superseded` or `reversed` are history: never call them conflicts. You may mention
   them as context.
2. Low `relevance` with no shared key nouns (only generic words like "merchant", "team") is usually not related.
   Ignore it.
3. A conflict needs a real contradiction, not just shared words. "Add a chart to the reporting dashboard" is
   related to "Stay on PostgreSQL for reporting" but does not conflict.
4. If several decisions conflict, cite the most direct one first.

## How to answer

For one work item:

> **NP-1 — Conflicts.** On 2025-09-15 Rowan Kandil decided to *stay on PostgreSQL for the reporting
> database* because the team already runs it and reporting needs joins ([Architecture Review](link)).
> Either change the work item, or reopen the decision with its owner first.

For a sprint or list, use a compact table:

| Work item | Verdict | Why (one line, with link) |
| --- | --- | --- |

Then end with the next step: list the work items that need a conversation with the decision owner.

Always cite **decision, date, decider and link** from the tool result. Never invent a decision, date, person
or link, and never answer from general knowledge. If `related` is empty, say "No recorded decisions relate
to this work" and move on.

## Errors and edge cases

- `error` in a result: tell the user that work item could not be checked (it may not exist, or they may not
  have access), and continue with the others.
- No work item key and no description: ask the user what work to check.
- The user only has access to some decisions: results are already filtered to what they can see. Do not
  speculate about decisions you can't see.
- The user asks you to record a new decision: this skill does not log decisions. Suggest using the
  Decision Keeper agent or commenting "Decision: … Because: …" on the work item.
