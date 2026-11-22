// Jira comment starting with "Decision:" -> capture (step 2.3).
export async function onJiraComment(event) {
  console.log(`[capture] jira comment issue=${event?.issue?.key}`);
}

// New Jira issue -> conflict check, comment once if score is high (step 2.5).
export async function onJiraIssueCreated(event) {
  console.log(`[guard] jira issue created ${event?.issue?.key}`);
}
