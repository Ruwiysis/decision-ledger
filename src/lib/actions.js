// Pure helpers for the Rovo actions (unit-tested): output shaping and input validation.

const SOURCE = { confluence: 'Confluence page', jira: 'Jira work item comment', rovo: 'Rovo chat' };

/** Compact, agent-friendly view of a decision. `names` maps accountId -> display name. */
export function toActionDecision(d, names = {}) {
  const why = d.rationale && !d.rationale.startsWith('Section:') ? d.rationale : null;
  return {
    id: d.id,
    decision: d.title,
    why: why ? why.charAt(0).toUpperCase() + why.slice(1) : 'No rationale was recorded.',
    status: d.status,
    decidedBy: names[d.decidedBy] || (d.decidedBy ? 'a teammate' : 'unknown'),
    decidedOn: d.decidedAt ? d.decidedAt.slice(0, 10) : null,
    source: SOURCE[d.sourceType] || d.sourceType,
    space: d.spaceOrProject && !d.spaceOrProject.startsWith('~') ? d.spaceOrProject : null,
    link: d.sourceUrl || null,
  };
}

const KEY_RE = /\b([A-Z][A-Z0-9_]{0,19}-\d{1,9})\b/;

/**
 * check-conflicts input: a work item key ("NP-1"), a work item URL, free text, or text that
 * mentions a key ("Does NP-1 go against…"). Falls back to the Rovo context's issue key.
 * Returns { issueKey?, text, extraText }.
 */
export function parseCheckInput(rawText, contextIssueKey) {
  const text = String(rawText || '').trim().slice(0, 4000);
  const fromUrl = text.match(/\/browse\/([A-Za-z][A-Za-z0-9_]{0,19}-\d{1,9})/);
  const upper = text.toUpperCase();
  const keyMatch = fromUrl ? [null, fromUrl[1].toUpperCase()] : upper.match(KEY_RE);
  if (keyMatch) {
    const issueKey = keyMatch[1];
    // Whatever else the user wrote beyond "does KEY conflict" adds context to the check.
    const rest = text
      .replace(fromUrl ? fromUrl[0] : new RegExp(issueKey, 'i'), ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/\b(does|do|is|go(es)?|against|any|past|decisions?|conflicts?|with|check)\b/gi, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return { issueKey, text: '', extraText: rest.split(' ').length >= 3 ? rest : '' };
  }
  if (!text && contextIssueKey && KEY_RE.test(String(contextIssueKey))) {
    return { issueKey: String(contextIssueKey), text: '', extraText: '' };
  }
  return { issueKey: null, text, extraText: '' };
}

/** log-decision input validation. Inputs are LLM output: never trusted, always bounded. */
export function validateLogInput(payload, contextUrl) {
  const title = String(payload?.title || '').replace(/\s+/g, ' ').trim();
  const rationale = String(payload?.rationale || '').replace(/\s+/g, ' ').trim();
  if (title.length < 5) return { error: 'The decision needs a short statement of what was decided (at least 5 characters).' };
  if (title.length > 300) return { error: 'The decision statement is too long; keep it to one sentence.' };
  if (rationale.length < 3) return { error: 'Ask the user why this was decided before logging it.' };
  let sourceUrl = null;
  const candidate = String(payload?.sourceUrl || contextUrl || '').trim();
  if (candidate) {
    try {
      const u = new URL(candidate);
      // Only https links are stored (they're rendered as links in the ledger).
      if (u.protocol === 'https:') sourceUrl = u.toString().slice(0, 1000);
    } catch {
      /* ignore invalid URLs */
    }
  }
  return { title, rationale: rationale.slice(0, 2000), sourceUrl };
}
