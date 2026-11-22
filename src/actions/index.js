// Rovo actions, also exposed as MCP tools (implemented at step 3.1).
// Each returns a compact JSON string for the agent to read.

const notReady = (name) => JSON.stringify({ status: 'not_implemented', action: name });

export async function searchDecisions() {
  return notReady('search-decisions');
}

export async function getDecision() {
  return notReady('get-decision');
}

export async function checkConflicts() {
  return notReady('check-conflicts');
}

export async function logDecision() {
  return notReady('log-decision');
}
