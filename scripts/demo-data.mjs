// Demo content for "Nakhla Pay", a fictional Saudi fintech. All vendor names are invented
// (no third-party trademarks). Each Confluence page holds native Decision elements; three
// Jira work items clearly conflict with earlier decisions.

export const SPACE = { key: 'NAKHLA', name: 'Nakhla Pay', description: 'Engineering, product and operations decisions for Nakhla Pay (demo data).' };
export const PROJECT = { key: 'NP', name: 'Nakhla Pay' };

/**
 * Pages: sections of { heading, intro?, decisions: [{ title, because? }] }.
 * `decidedOn` is the meeting date; it is written into every Decision as a Confluence /date
 * (sections a few days apart), which Decision Ledger reads as the decision date.
 * `because` is written as a "Because: …" paragraph after the decision list (one decision
 * per list) — exactly what a person would type in Confluence.
 */
export const PAGES = [
  {
    title: 'Architecture Review: Reporting & Data Platform',
    decidedOn: '2025-09-15', // decision date written into each Decision with /date
    labels: ['architecture', 'database', 'reporting'],
    intro: 'Review held with the platform and data teams to settle how reporting and ledger data are stored and served.',
    sections: [
      {
        heading: 'Reporting database',
        decisions: [{ title: 'Stay on PostgreSQL for the reporting database', because: 'the team already runs PostgreSQL in production, reporting needs joins across ledgers and payouts, and a document store like MongoDB would add a second database to operate, back up and secure.' }],
      },
      {
        heading: 'Dashboards',
        decisions: [{ title: 'Serve merchant dashboards from a PostgreSQL read replica, not a separate warehouse', because: 'a warehouse costs more than it saves until we pass one million transactions a day.' }],
      },
      {
        heading: 'Ledger events',
        decisions: [{ title: 'Publish ledger events through Kafka', because: 'we need strict ordering per merchant and the ability to replay events after an incident.' }],
      },
    ],
  },
  {
    title: 'Vendor Selection: Payment Gateway',
    decidedOn: '2025-07-08', // decision date written into each Decision with /date
    labels: ['vendor', 'payments'],
    intro: 'We compared four gateways on local card support, settlement speed, fees and licensing.',
    sections: [
      {
        heading: 'Primary gateway',
        decisions: [{ title: 'Use Rimal Pay as the primary card payment gateway', because: 'it supports local debit cards and Apple Pay, settles next day, and is licensed by the central bank.' }],
      },
      {
        heading: 'Redundancy',
        decisions: [{ title: 'Keep Sahel Gateway as a fallback for card payments', because: 'during the March outage we lost four hours of sales with a single provider.' }],
      },
      {
        heading: 'Build vs buy',
        decisions: [{ title: 'Do not build an in-house payment gateway', because: 'PCI DSS Level 1 certification would take a year and two dedicated engineers.' }],
      },
    ],
  },
  {
    title: 'KYC & Merchant Onboarding Compliance',
    decidedOn: '2025-08-20', // decision date written into each Decision with /date
    labels: ['compliance', 'kyc', 'security'],
    intro: 'Outcome of the compliance workshop with legal and risk.',
    sections: [
      {
        heading: 'Identity verification',
        decisions: [{ title: 'Verify every merchant with Tahqeeq KYC before activation', because: 'the central bank requires verified ownership before a merchant can receive payouts.' }],
      },
      {
        heading: 'Data residency',
        decisions: [{ title: 'Store national ID images in-region only', because: 'data residency rules require customer identity data to stay in the Kingdom.' }],
      },
      {
        heading: 'Periodic review',
        decisions: [{ title: 'Re-verify active merchants every 12 months', because: 'annual review is the minimum the risk team will sign off on.' }],
      },
    ],
  },
  {
    title: 'Pricing Committee: Q3 2026',
    decidedOn: '2026-06-30', // decision date written into each Decision with /date
    labels: ['pricing', 'merchants'],
    intro: 'Pricing for the public launch, agreed by product, finance and sales.',
    sections: [
      {
        heading: 'Transaction pricing',
        decisions: [{ title: 'Charge 1.9% plus 1 SAR per card transaction for standard merchants', because: 'it matches the market midpoint while keeping a 0.6% margin after gateway fees.' }],
      },
      {
        heading: 'Subscriptions',
        decisions: [{ title: 'No monthly subscription fee for merchants under 50k SAR monthly volume', because: 'small merchants churned in the pilot as soon as they saw a fixed monthly fee.' }],
      },
      {
        heading: 'Discounts',
        decisions: [{ title: 'Offer volume discounts only above 1M SAR per month', because: 'below that, discounts cost more margin than the extra volume brings in.' }],
      },
    ],
  },
  {
    title: 'Hiring Plan 2026',
    decidedOn: '2026-01-12', // decision date written into each Decision with /date
    labels: ['hiring', 'team'],
    intro: 'Headcount priorities for the next two quarters.',
    sections: [
      {
        heading: 'Priorities',
        decisions: [{ title: 'Hire two senior backend engineers before a mobile engineer', because: 'payout reliability is the top risk on the roadmap.' }],
      },
      {
        heading: 'Working model',
        decisions: [{ title: 'Stay remote-first with a Riyadh hub', because: 'half of our best candidates live outside Riyadh.' }],
      },
      {
        heading: 'Interviews',
        decisions: [{ title: 'Use a paid take-home exercise instead of whiteboard interviews', because: 'it gives better signal and is fairer to candidates who already have jobs.' }],
      },
    ],
  },
  {
    title: 'Security Review: Access & Secrets',
    decidedOn: '2026-02-03', // decision date written into each Decision with /date
    labels: ['security'],
    intro: 'Annual access review with the security lead.',
    sections: [
      {
        heading: 'Production access',
        decisions: [{ title: 'Require SSO with hardware security keys for all production access', because: 'phishing was the root cause in both industry incidents we reviewed this year.' }],
      },
      {
        heading: 'API keys',
        decisions: [{ title: 'Rotate payment gateway API keys every 90 days', because: 'the PCI auditor flagged long-lived keys as our highest finding.' }],
      },
      {
        heading: 'Secrets',
        decisions: [{ title: 'Keep all secrets in the cloud secret manager, never in environment files', because: 'two leaked .env files last year exposed staging credentials.' }],
      },
    ],
  },
  {
    title: 'Mobile App Architecture',
    decidedOn: '2025-11-04', // decision date written into each Decision with /date
    labels: ['mobile', 'architecture'],
    intro: 'Choices for the merchant point-of-sale app.',
    sections: [
      {
        heading: 'Framework',
        decisions: [{ title: 'Build the merchant app with React Native', because: 'one codebase covers iOS and Android and the team already writes React.' }],
      },
      {
        heading: 'Connectivity',
        decisions: [{ title: 'Support offline receipts in the merchant app', because: 'many stores in the pilot had weak connectivity at the till.' }],
      },
    ],
  },
  {
    title: 'Infrastructure & Hosting',
    decidedOn: '2025-06-10', // decision date written into each Decision with /date
    labels: ['infrastructure', 'architecture'],
    intro: 'Hosting standards for production.',
    sections: [
      {
        heading: 'Platform',
        decisions: [{ title: 'Run production on Kubernetes in a single in-country region', because: 'data residency rules apply and one region keeps operations simple for a team our size.' }],
      },
      {
        heading: 'Databases',
        decisions: [{ title: 'Use managed PostgreSQL instead of self-hosting', because: 'backups, failover and patching are handled for us.' }],
      },
      {
        heading: 'Release cadence',
        decisions: [{ title: 'Deploy to production at most twice a week and never on Thursdays', because: 'the weekend starts on Friday and nobody wants a weekend incident.' }],
      },
    ],
  },
  {
    title: 'Merchant Support Operations',
    decidedOn: '2026-04-22', // decision date written into each Decision with /date
    labels: ['support', 'merchants'],
    intro: 'How we support merchants after launch.',
    sections: [
      {
        heading: 'Response times',
        decisions: [{ title: 'Answer merchant chats in Arabic and English within 15 minutes', because: 'a payment problem at the till costs the merchant sales every minute.' }],
      },
      {
        heading: 'Tooling',
        decisions: [{ title: 'Handle merchant support tickets in Jira Service Management', because: 'engineering already works in Jira, so escalations stay in one place.' }],
      },
    ],
  },
];

/** Jira work items. `conflictsWith` = decision title(s) the guard should flag (checked by test/demo-data.test.mjs). */
export const ISSUES = [
  // Clear conflicts (the guard should warn and comment once).
  {
    summary: 'Migrate reporting DB to MongoDB',
    description: 'The new analytics dashboards change shape every sprint. We want to migrate the reporting database to MongoDB so schema changes are easier.',
    conflictsWith: 'Stay on PostgreSQL for the reporting database',
  },
  {
    summary: 'Replace Rimal Pay with an in-house payment gateway',
    description: 'Gateway fees are our biggest cost. Proposal: replace Rimal Pay and build our own in-house payment gateway for card payments.',
    conflictsWith: ['Use Rimal Pay as the primary card payment gateway', 'Do not build an in-house payment gateway'],
  },
  {
    summary: 'Switch small merchants to a monthly subscription fee',
    description: 'Finance wants predictable revenue. Switch merchants under 50k SAR volume to a fixed monthly subscription fee instead of per-transaction pricing.',
    conflictsWith: 'No monthly subscription fee for merchants under 50k SAR monthly volume',
  },
  // Related but not conflicting (the panel lists decisions, no warning).
  { summary: 'Add revenue chart to the merchant reporting dashboard', description: 'Show daily revenue for the last 30 days on the reporting dashboard.' },
  { summary: 'Rotate Rimal Pay API keys for Q4', description: 'Quarterly rotation of the payment gateway API keys.' },
  {
    summary: 'Alert on Kafka consumer lag for ledger events',
    description: 'Page the on-call engineer when the ledger event consumers fall behind.',
    comment: ['Decision: Page on-call when ledger consumer lag exceeds 5 minutes', 'Because: settlements must post within 15 minutes of capture.'],
  },
  {
    summary: 'Arabic translations for merchant onboarding',
    description: 'Translate the onboarding flow and emails into Arabic.',
    comment: ['Decision: Make Arabic the default language for new merchants in Saudi Arabia', 'Because: 80% of pilot merchants switched to Arabic within their first week.'],
  },
  { summary: 'Offline receipt sync for the merchant app', description: 'Queue receipts locally and sync when the device is back online.' },
  { summary: 'KYC re-verification reminder emails', description: 'Email merchants 30 days before their annual KYC re-verification is due.' },
  { summary: 'Read replica failover runbook', description: 'Document how to promote the reporting read replica during an incident.' },
  { summary: 'Prepare PCI DSS questionnaire for the auditor', description: 'Collect evidence for the annual PCI DSS self-assessment.' },
  { summary: 'Update the public pricing page for Q3', description: 'Publish the Q3 transaction pricing and volume discount tiers.' },
  { summary: 'Set up a support queue for merchant tickets', description: 'Create queues and SLAs for merchant support in Jira Service Management.' },
  { summary: 'Hire senior backend engineer for payouts', description: 'Open the role, write the take-home exercise and schedule interviews.' },
  { summary: 'Hardware security keys for the new contractors', description: 'Order and enrol hardware keys so contractors can access production via SSO.' },
];
