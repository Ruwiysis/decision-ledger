import Resolver from '@forge/resolver';

// Backend for both UI modules (Jira issue panel + Confluence ledger page).
const resolver = new Resolver();

// Stub: returns no decisions until the database layer lands (step 2.1).
resolver.define('listDecisions', async () => {
  return { decisions: [] };
});

resolver.define('relatedDecisions', async () => {
  return { related: [], conflict: null };
});

export const handler = resolver.getDefinitions();
export { handler as resolver };
