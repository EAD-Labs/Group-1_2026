/*
 * Question text with code in it.
 *
 * A question file marks code the way chat apps and README files do: a block
 * between two lines of three backticks keeps its lines and indentation, and a
 * short piece between single backticks sits inside a sentence.
 *
 *   What gets printed?
 *   ```
 *   for i in range(3):
 *       print(i)
 *   ```
 *
 * Text without backticks comes back as one plain piece, so older questions
 * read exactly as before.
 */

const FENCE = /```[a-z]*\n?([\s\S]*?)\n?```/g;
const INLINE = /`([^`\n]+)`/g;

/** Split a sentence into plain text and `code` pieces. */
export function inlinePieces(text) {
  const out = [];
  let last = 0;
  for (const m of String(text ?? '').matchAll(INLINE)) {
    if (m.index > last) out.push({ kind: 'text', value: text.slice(last, m.index) });
    out.push({ kind: 'code', value: m[1] });
    last = m.index + m[0].length;
  }
  if (last < String(text ?? '').length) out.push({ kind: 'text', value: text.slice(last) });
  return out;
}

/**
 * Split question text into blocks: prose (itself split into inline pieces)
 * and code. Blank edges around a code block are dropped, since the block
 * already stands on its own line.
 */
export function blocks(text) {
  const src = String(text ?? '');
  const out = [];
  let last = 0;
  const prose = (s) => {
    const t = s.replace(/^\n+|\n+$/g, '');
    if (t.trim()) out.push({ kind: 'prose', pieces: inlinePieces(t) });
  };
  for (const m of src.matchAll(FENCE)) {
    prose(src.slice(last, m.index));
    out.push({ kind: 'code', value: m[1] });
    last = m.index + m[0].length;
  }
  prose(src.slice(last));
  return out;
}

/** The text as one line with the markup removed, for tables and short lists. */
export function plain(text) {
  return blocks(text)
    .map((b) => (b.kind === 'code' ? b.value.replace(/\s*\n\s*/g, '; ') : b.pieces.map((p) => p.value).join('')))
    .join(' ');
}
