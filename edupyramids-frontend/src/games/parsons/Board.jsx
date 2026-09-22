import { useState } from 'react';

/*
 * Parsons puzzle: build the program from scrambled lines.
 *
 * Tap a line to add it to the program. In the program, each line has buttons
 * to move it up or down and to indent or outdent it. Buttons rather than
 * dragging, so it works the same on a tablet, a lab mouse or the keyboard.
 */
const INDENT_REM = 1.6;

export default function ParsonsBoard({ game, onFinish, sending }) {
  const [program, setProgram] = useState([]);          // [{ id, code, indent }]
  const used = new Set(program.map((p) => p.id));
  const pool = game.blocks.filter((b) => !used.has(b.id));
  const maxIndent = Math.max(1, game.maxIndent);

  const add = (block) => setProgram((p) => [...p, { ...block, indent: p.length ? p[p.length - 1].indent : 0 }]);
  const remove = (i) => setProgram((p) => p.filter((_, k) => k !== i));
  const move = (i, by) => setProgram((p) => {
    const j = i + by;
    if (j < 0 || j >= p.length) return p;
    const next = [...p];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const indent = (i, by) => setProgram((p) => p.map((line, k) => (
    k === i ? { ...line, indent: Math.max(0, Math.min(maxIndent, line.indent + by)) } : line
  )));

  return (
    <>
      <p className="board-status" aria-live="polite">
        {program.length} line{program.length === 1 ? '' : 's'} placed · the program needs {game.lineCount}
        {game.blocks.length > game.lineCount && <span className="muted-on-dark"> · some lines do not belong</span>}
      </p>

      <div className="parsons">
        <section className="parsons-pool" aria-label="Lines to use">
          <h3 className="parsons-head">Lines</h3>
          {pool.length === 0 ? <p className="tray-empty">Every line is in the program.</p> : (
            <ul className="parsons-list">
              {pool.map((b) => (
                <li key={b.id}>
                  <button type="button" className="piece parsons-block" onClick={() => add(b)} disabled={sending}>
                    <code className="piece-code">{b.code}</code>
                    <span className="parsons-add" aria-hidden="true">+</span>
                    <span className="sr-only">Add to the program</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="parsons-program" aria-label="Your program">
          <h3 className="parsons-head">Your program</h3>
          {program.length === 0 ? <p className="tray-empty">Tap lines on the left to build it here.</p> : (
            <ol className="parsons-list">
              {program.map((line, i) => (
                <li key={line.id} className="parsons-line">
                  <span className="parsons-code" style={{ paddingLeft: `${0.7 + line.indent * INDENT_REM}rem` }}>
                    {Array.from({ length: line.indent }, (_, k) => (
                      <span key={k} className="parsons-guide" style={{ left: `${0.7 + k * INDENT_REM}rem` }} aria-hidden="true" />
                    ))}
                    <code>{line.code}</code>
                    <span className="sr-only">, indent level {line.indent}</span>
                  </span>
                  <span className="parsons-tools">
                    <button type="button" onClick={() => indent(i, -1)} disabled={line.indent === 0} aria-label="Outdent">⇤</button>
                    <button type="button" onClick={() => indent(i, 1)} disabled={line.indent === maxIndent} aria-label="Indent">⇥</button>
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === program.length - 1} aria-label="Move down">↓</button>
                    <button type="button" onClick={() => remove(i)} aria-label="Remove">✕</button>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <div className="quiz-nav">
        <button className="btn btn--ghost btn--sm" type="button" onClick={() => setProgram([])} disabled={!program.length || sending}>
          Clear
        </button>
        <button className="btn btn--sm" type="button" disabled={!program.length || sending}
          onClick={() => onFinish({ program: program.map((p) => ({ id: p.id, indent: p.indent })) })}>
          {sending ? 'Checking…' : 'Check program'}
        </button>
      </div>
    </>
  );
}
