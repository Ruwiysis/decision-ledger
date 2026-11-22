import React from 'react';
import ForgeReconciler, { EmptyState } from '@forge/react';

// Confluence global page "Decision Ledger" (built at step 2.4).
const App = () => (
  <EmptyState
    header="Your Decision Ledger is empty"
    description="Add a Decision (/decision) to a Confluence page, comment 'Decision: ...' on a Jira issue, or ask Decision Keeper in Rovo."
  />
);

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
