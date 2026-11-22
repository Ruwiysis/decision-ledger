// Confluence page created/updated -> extract native Decision elements (step 2.2).
export async function onConfluencePage(event) {
  console.log(`[capture] confluence ${event.eventType} page=${event?.content?.id}`);
}
