import { blocks, inlinePieces } from '../utils/richText';

/*
 * Question text with its code laid out as code (see utils/richText.js).
 * Everything is a span, so it can sit inside a <legend>, <label> or <p>,
 * which only take inline content; the code block is a span shown as a block.
 */

/** A sentence with `code` pieces: for options and short answers. */
const pieces = (list) => list.map((p, i) => (p.kind === 'code'
  ? <code key={i} className="q-code-inline">{p.value}</code>
  : <span key={i}>{p.value}</span>));

/** A sentence with `code` pieces: for options and short answers. */
export function Inline({ text }) {
  return pieces(inlinePieces(text));
}

/** Question text: prose and code blocks. */
export default function RichText({ text }) {
  return blocks(text).map((b, i) => (b.kind === 'code'
    ? <code key={i} className="q-code">{b.value}</code>
    : <span key={i} className="q-prose">{pieces(b.pieces)}</span>));
}
