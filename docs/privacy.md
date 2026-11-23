---
title: Decision Ledger: Privacy Policy
---

# Decision Ledger: Privacy Policy

_Last updated: 24 November 2026_

Decision Ledger is a Forge app for Jira and Confluence, built for the Atlassian Codegeist 2026
hackathon. It records decisions teams make in Confluence pages, Jira comments and Rovo chat, and warns
when new work may conflict with them. This page explains what data the app handles and where it goes.

## The short version

- **All data stays on Atlassian.** The app runs on Atlassian Forge and stores its data in Forge SQL,
  hosted by Atlassian. It has **no external servers**, makes **no calls outside Atlassian**, and uses
  **no third-party analytics or AI providers**. AI features use Atlassian Rovo.
- **People only see what they already can.** Every screen and every Rovo answer is filtered by the
  viewer's own Jira and Confluence permissions.
- **No data is sold or shared** with anyone.

## What the app stores

For each recorded decision, in the Forge SQL database of the site where the app is installed:

| Data | Example |
| --- | --- |
| Decision text and its reason | "Stay on PostgreSQL for the reporting database" / "the team knows it…" |
| Topics (keywords and page labels) | `database`, `reporting` |
| Where it came from | Confluence page ID and link, or Jira comment ID and work item link, or "Rovo chat" |
| Space / Jira space key and ID | `ENG`, `10000` |
| Who decided and when | the Atlassian **account ID** of the page editor, comment author or Rovo user; a date |
| Status | active, superseded or reversed |

For conflict warnings, the app also stores which Jira work items already received its one automatic
comment (work item ID and key, decision ID, comment ID), so it never comments twice.

The app does **not** store email addresses, names, passwords or tokens. Display names and avatars are
shown by Atlassian at view time, using the account ID.

## What the app reads, and why

- **Confluence pages** that are created or edited: to find native Decision elements (`/decision`).
- **Jira comments**: to find comments that start with `Decision:`. Comments restricted to a group or
  role are skipped.
- **Jira work items**: when you open the "Related decisions" panel, or when a work item is created, to
  compare its summary and description with past decisions.
- **Teamwork Graph**: who contributed to a decision's page and which pages it links to, read as the
  viewing user and only shown to them.

Page and comment bodies are **processed, not stored**. Only the decision text and its reason are kept.

## What the app writes to your site

One Jira comment per work item, at most, when a new work item looks like it conflicts with a past
decision. The comment only quotes decisions that were logged in Rovo chat, which are team-wide by design.
For anything else, it points to the permission-aware "Related decisions" panel.

## Who can see the data

- **Decisions from Confluence:** only people who can view that page.
- **Decisions from Jira:** only people who can see that work item, including work item security levels.
- **Decisions logged in Rovo chat:** everyone who can use the app on the site.

Anyone who can see a decision can change its status (for example "superseded"). These changes are
recorded in the app's logs with the account ID.

## Where data is stored and for how long

- Data is stored in **Forge SQL** on Atlassian infrastructure, in a separate database for each
  installation (site). Data from different sites is never mixed.
- A decision is kept until its source changes. For example, removing a Decision from a page, or editing
  "Decision:" out of a comment, removes it from the ledger. Decisions whose source page is trashed are
  hidden from everyone.
- When the app is **uninstalled**, Atlassian deletes the app's stored data according to the Forge
  platform's data retention rules.
- Operational logs (IDs and counts, no page content) are kept by the Forge platform for a limited time.

## Your choices

- Site admins can uninstall the app at any time from **Apps → Manage apps**.
- To remove a single decision, remove it from its source page or comment.

## Contact

Questions or requests: open an issue at
<https://github.com/Ruwiysis/decision-ledger/issues>.

Decision Ledger is an independent hackathon project and is not affiliated with Atlassian.
