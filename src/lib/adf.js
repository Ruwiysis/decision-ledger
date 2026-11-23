// Pure helpers for Atlassian Document Format (ADF). No Forge imports: unit-testable.

/** Concatenate the visible text of any ADF node (mentions/dates/emoji become readable text). */
export function adfToText(node) {
  if (!node) return '';
  if (Array.isArray(node)) return node.map(adfToText).join('');
  switch (node.type) {
    case 'text':
      return node.text || '';
    case 'hardBreak':
      return '\n';
    case 'mention':
      return node.attrs?.text ? String(node.attrs.text) : '';
    case 'emoji':
      return node.attrs?.text || node.attrs?.shortName || '';
    case 'date':
      return node.attrs?.timestamp ? new Date(Number(node.attrs.timestamp)).toISOString().slice(0, 10) : '';
    case 'status':
      return node.attrs?.text || '';
    case 'inlineCard':
      return node.attrs?.url || '';
    default: {
      const inner = adfToText(node.content || []);
      // Separate block-level children with a space so words don't run together.
      return BLOCKS.has(node.type) ? `${inner} ` : inner;
    }
  }
}

const BLOCKS = new Set([
  'paragraph', 'heading', 'listItem', 'bulletList', 'orderedList', 'blockquote', 'panel',
  'tableCell', 'tableHeader', 'tableRow', 'table', 'expand', 'nestedExpand', 'decisionItem',
  'decisionList', 'taskItem', 'taskList', 'codeBlock', 'layoutColumn', 'layoutSection',
]);

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const WHY_PREFIX = /^(?:because|why|reason|rationale)\s*[:\-–—]?\s*/i;

/**
 * Split "Stay on PostgreSQL because the team knows it" into title + inline rationale.
 * Only "because"/"due to"/"reason:"/"why:" split; "as"/"since" are too ambiguous mid-sentence.
 */
export function splitInlineRationale(text) {
  const t = clean(text);
  const m = t.match(/^(.*?\S)\s*(?:[-–—,;:]\s*)?\b(because|due to|reason:|why:)\s+(.+)$/i);
  if (m && m[1].length >= 3) return { title: m[1].replace(/[,;:\-–—]\s*$/, '').trim(), rationale: m[3].trim() };
  return { title: t, rationale: '' };
}

/**
 * Walk an ADF document and return every DECIDED decision item.
 *
 * Rationale, in priority order:
 *   1. an inline "because ..." clause in the decision itself;
 *   2. the first non-empty paragraph right after the decision list (a "Because: ..." prefix is stripped);
 *   3. the nearest heading above the decision list ("Section: <heading>").
 *
 * Returns [{ localId, title, rationale, heading }].
 */
export function extractDecisions(doc) {
  const out = [];
  const visit = (nodes, headingAbove) => {
    if (!Array.isArray(nodes)) return headingAbove;
    let heading = headingAbove;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (!node || typeof node !== 'object') continue;
      if (node.type === 'heading') {
        heading = clean(adfToText(node));
        continue;
      }
      if (node.type === 'decisionList') {
        const following = nextParagraphText(nodes, i + 1);
        for (const item of node.content || []) {
          if (item?.type !== 'decisionItem') continue;
          if (String(item.attrs?.state || '').toUpperCase() !== 'DECIDED') continue;
          const raw = clean(adfToText(item.content || []));
          if (!raw) continue;
          const { title, rationale: inline } = splitInlineRationale(raw);
          let rationale = inline;
          if (!rationale && following) rationale = following.replace(WHY_PREFIX, '');
          if (!rationale && heading) rationale = `Section: ${heading}`;
          out.push({ localId: item.attrs?.localId || null, title, rationale, heading: heading || null });
        }
        continue;
      }
      // Recurse into containers (panels, layouts, expands, tables, lists...). Headings inside
      // a container only apply within it, so the outer heading context is restored after.
      if (Array.isArray(node.content)) visit(node.content, heading);
    }
    return heading;
  };
  visit(doc?.content || [], null);
  return out;
}

/** Text of the first non-empty paragraph at or after `start`, stopping at headings/decisions. */
function nextParagraphText(nodes, start) {
  for (let j = start; j < nodes.length; j++) {
    const n = nodes[j];
    if (!n) continue;
    if (n.type === 'heading' || n.type === 'decisionList' || n.type === 'rule') return '';
    if (n.type === 'paragraph') {
      const t = clean(adfToText(n));
      if (t) return t;
    } else {
      return '';
    }
  }
  return '';
}

/**
 * ADF -> plain text that keeps line structure: each block (paragraph, heading, list item...)
 * and each hardBreak becomes its own line. Used where "the next line" matters (Jira comments).
 */
export function adfToLines(doc) {
  const lines = [];
  let current = '';
  const flush = () => {
    if (current.trim()) lines.push(current.replace(/\s+/g, ' ').trim());
    current = '';
  };
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.type === 'hardBreak') return flush();
    if (node.content && BLOCKS.has(node.type)) {
      flush();
      node.content.forEach(walk);
      flush();
      return;
    }
    if (node.content) return node.content.forEach(walk);
    current += adfToText(node);
  };
  walk(doc?.content || doc);
  flush();
  return lines;
}

/** Parse the `atlas_doc_format` body value (a JSON string) safely. */
export function parseAdf(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
