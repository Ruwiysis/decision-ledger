import React from 'react';
import ForgeReconciler, { EmptyState } from '@forge/react';

// Jira issue panel "Related decisions" (built at step 2.5).
const App = () => (
  <EmptyState
    header="No related decisions yet"
    description="Decisions captured from Confluence, Jira and Rovo will appear here."
  />
);

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
