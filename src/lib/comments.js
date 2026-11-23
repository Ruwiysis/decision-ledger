// Parse a Jira comment that records a decision. Pure: unit-tested.
//
//   Decision: Stay on PostgreSQL for reporting
//   Because: the team knows it and we need joins
//
// Rules: the comment must start with "Decision:" (case-insensitive). The rationale is the
// text after "Because:" if present (same line or later), otherwise the following line(s).
import { splitInlineRationale } from './adf.js';

const DECISION_PREFIX = /^\s*decision\s*[:：]\s*/i;
const BECAUSE = /\bbecause\s*[:：]\s*/i;

/** @param {string[]} lines comment text split into lines (see adfToLines). */
export function parseDecisionComment(lines) {
  const all = (lines || []).map((l) => String(l).trim()).filter(Boolean);
  if (all.length === 0 || !DECISION_PREFIX.test(all[0])) return null;

  const text = [all[0].replace(DECISION_PREFIX, ''), ...all.slice(1)].join('\n');
  let title;
  let rationale;
  const m = text.match(BECAUSE);
  if (m) {
    title = text.slice(0, m.index);
    rationale = text.slice(m.index + m[0].length);
  } else {
    const [first, ...rest] = text.split('\n');
    title = first;
    rationale = rest.join(' ');
    if (!rationale) ({ title, rationale } = splitInlineRationale(first));
  }
  title = title.replace(/\s+/g, ' ').replace(/[\s.;,]+$/, '').trim();
  rationale = rationale.replace(/\s+/g, ' ').trim();
  if (title.length < 3) return null;
  return { title: title.slice(0, 500), rationale };
}
