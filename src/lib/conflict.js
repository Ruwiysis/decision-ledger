// Conflict detection for the guard panel, the issue-created trigger and check-conflicts.
// Pure: unit-tested. Heuristic on purpose — it flags *possible* conflicts for a human
// (or the Rovo agent) to judge, it never blocks anything.
import { extractKeywords, rankDecisions } from './keywords.js';

// Words that signal work which may undo an earlier decision.
export const CHANGE_PHRASES = [
  'move away from', 'stop using', 'get rid of', 'instead of', 'switch from', 'switch to', 'switching to',
  'move to', 'moving to', 'migrate', 'migrating', 'migration', 'replace', 'replacing', 'replacement',
  'drop', 'dropping', 'remove', 'removing', 'deprecate', 'deprecating', 'abandon', 'sunset', 'retire',
  'rewrite', 'ditch', 'revert', 'undo', 'reverse',
];

const WINDOW = 8; // words either side of a change phrase that count as "near"

/** Thresholds, exported so the UI/trigger/tests agree. */
export const PANEL_MIN_SCORE = 3; // a related decision must at least match a title word to warn
export const AUTO_COMMENT_MIN_SCORE = 7; // stricter bar before the app writes a comment

const words = (text) => String(text || '').toLowerCase().match(/[\p{L}\p{N}+#.]+/gu) || [];

/**
 * Find change phrases in the text and the normalised keywords within WINDOW words of each.
 * Returns [{ phrase, near: Set<keyword> }].
 */
export function findChangeSignals(text) {
  const w = words(text);
  const signals = [];
  for (let i = 0; i < w.length; i++) {
    for (const phrase of CHANGE_PHRASES) {
      const parts = phrase.split(' ');
      if (parts.every((p, k) => w[i + k] === p)) {
        const start = Math.max(0, i - WINDOW);
        const end = Math.min(w.length, i + parts.length + WINDOW);
        const windowText = [...w.slice(start, i), ...w.slice(i + parts.length, end)].join(' ');
        signals.push({ phrase, near: new Set(extractKeywords(windowText, { max: 50 })) });
        break; // longest phrases are listed first; one match per position
      }
    }
  }
  return signals;
}

/**
 * Score candidate decisions against a proposal / work item text.
 * Returns { keywords, related: [{ decision, score, matched, conflict, conflictScore, changeWords }] }
 * sorted by conflictScore. Only *active* decisions can be in conflict.
 */
export function detectConflicts(text, candidates, { limit = 3 } = {}) {
  const keywords = extractKeywords(text, { max: 30 });
  const ranked = rankDecisions(candidates || [], keywords, { limit: 50 });
  const signals = findChangeSignals(text);

  const related = ranked.map((r) => {
    const near = new Set();
    const phrases = new Set();
    for (const s of signals) {
      for (const m of r.matched) {
        if (s.near.has(m)) {
          near.add(m);
          phrases.add(s.phrase);
        }
      }
    }
    const conflict = r.decision.status === 'active' && near.size > 0 && r.score >= PANEL_MIN_SCORE;
    return {
      decision: r.decision,
      score: r.score,
      matched: r.matched,
      conflict,
      conflictScore: r.score + (conflict ? 3 * near.size : 0),
      changeWords: [...phrases],
    };
  });

  related.sort((a, b) => b.conflictScore - a.conflictScore || b.score - a.score);
  return { keywords, related: related.slice(0, limit) };
}

/** One-sentence warning used by the panel and the auto-comment. */
export function conflictSentence(decision, { formatDate = (iso) => (iso ? iso.slice(0, 10) : 'earlier') } = {}) {
  const why = decision.rationale && !decision.rationale.startsWith('Section:') ? ` because ${decision.rationale.replace(/\.$/, '')}` : '';
  return `Possible conflict: on ${formatDate(decision.decidedAt)} the team decided “${decision.title}”${why}.`;
}
