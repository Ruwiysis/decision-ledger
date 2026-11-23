// Pure text helpers shared by the ledger search, the guard panel and the Rovo actions.
// No Forge imports here, so everything is unit-testable with plain Node.

// Common English filler words plus Jira/Confluence noise that never identifies a decision.
const STOPWORDS = new Set(
  `a about above after again against all also am an and any are as at be because been before
  being below between both but by can could did do does doing down during each few for from
  further had has have having he her here hers him his how i if in into is it its itself just
  me more most my no nor not now of off on once only or other our ours out over own same she
  should so some such than that the their theirs them then there these they this those through
  to too under until up very was we were what when where which while who whom why will with
  would you your yours yourself
  let lets make made need needs needed new use used using via per etc get got going want wants
  team teams please thanks issue issues ticket tickets task tasks story work item items page
  decision decisions decided decide because also should would maybe
  stay keep keeps adopt choose chose chosen go goes agreed agree`
    .split(/\s+/)
    .filter(Boolean)
);

// Map common aliases onto one canonical keyword so "Postgres" matches "PostgreSQL".
const ALIASES = {
  postgres: 'postgresql',
  pg: 'postgresql',
  psql: 'postgresql',
  mongo: 'mongodb',
  k8s: 'kubernetes',
  js: 'javascript',
  ts: 'typescript',
  aws: 'aws',
  gcp: 'gcp',
  db: 'database',
  dbs: 'database',
  databases: 'database',
};

/** Light plural stemming: "vendors" -> "vendor", "policies" -> "policy". */
function stem(word) {
  if (word.length > 4 && word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.length > 4 && word.endsWith('ses')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/**
 * Split free text into normalised keywords (lowercase, no stopwords, aliases resolved).
 * Returns them in first-seen order without duplicates.
 */
export function extractKeywords(text, { max = 25 } = {}) {
  if (!text) return [];
  const seen = new Set();
  const out = [];
  const tokens = String(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}+#.]+/u)
    .map((t) => t.replace(/^[.]+|[.]+$/g, ''));
  for (const raw of tokens) {
    if (!raw || raw.length < 2 || /^\d+$/.test(raw)) continue;
    if (STOPWORDS.has(raw)) continue;
    let word = ALIASES[raw] || stem(raw);
    word = ALIASES[word] || word;
    if (word.length < 3 && !ALIASES[raw]) continue;
    if (STOPWORDS.has(word) || seen.has(word)) continue;
    seen.add(word);
    out.push(word);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Score how related a decision is to a set of query keywords.
 * Title matches weigh most, then topics, then rationale.
 * Returns { score, matched } where matched lists the overlapping keywords.
 */
export function scoreDecision(decision, queryKeywords) {
  const keywords = new Set(queryKeywords);
  if (keywords.size === 0) return { score: 0, matched: [] };

  const titleWords = new Set(extractKeywords(decision.title, { max: 100 }));
  const topicWords = new Set(
    (decision.topics || []).flatMap((t) => extractKeywords(t, { max: 10 }))
  );
  const rationaleWords = new Set(extractKeywords(decision.rationale, { max: 200 }));

  let score = 0;
  const matched = [];
  for (const k of keywords) {
    let hit = 0;
    if (titleWords.has(k)) hit += 3;
    if (topicWords.has(k)) hit += 2;
    if (rationaleWords.has(k)) hit += 1;
    if (hit > 0) {
      score += hit;
      matched.push(k);
    }
  }
  return { score, matched };
}

/** Rank decisions by scoreDecision, dropping zero scores. Stable for equal scores (newest first). */
export function rankDecisions(decisions, queryKeywords, { limit = 5 } = {}) {
  return decisions
    .map((d) => ({ decision: d, ...scoreDecision(d, queryKeywords) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || String(b.decision.decidedAt).localeCompare(String(a.decision.decidedAt)))
    .slice(0, limit);
}

/**
 * Normalised key used for the "upsert by source" unique index: same decision text on the
 * same source maps to the same row even if whitespace/case/punctuation changes.
 */
export function titleKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .slice(0, 100);
}
