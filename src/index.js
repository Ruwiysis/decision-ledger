// Entry point: every Forge function handler in manifest.yml is exported from here.

export { resolver } from './resolvers/index.js';
export { onConfluencePage } from './triggers/confluence.js';
export { onJiraComment, onJiraIssueCreated } from './triggers/jira.js';
export { runMigrations } from './db/migrations.js';
export { searchDecisions, getDecision, checkConflicts, logDecision } from './actions/index.js';
