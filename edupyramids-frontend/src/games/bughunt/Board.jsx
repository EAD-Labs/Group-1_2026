import { useState } from 'react';
import Hint from '../Hint';

/*
 * Bug hunt: tap the line with the bug, then choose what it should say.
 */
export default function BugHuntBoard({ game, onFinish, sending, hint }) {
  const [picks, setPicks] = useState({});        // itemId -> { line, fix }
  const done = game.items.filter((it) => picks[it.id]?.line && picks[it.id]?.fix).length;

  const pickLine = (id, line) => setPicks((p) => ({ ...p, [id]: { line, fix: p[id]?.line === line ? p[id].fix : null } }));
  const pickFix = (id, fix) => setPicks((p) => ({ ...p, [id]: { ...p[id], fix } }));

  return (
    <>
      <p className="board-status" aria-live="polite">{done} of {game.items.length} bugs fixed</p>

      <ol className="code-items">
        {game.items.map((it, i) => {
          const pick = picks[it.id] || {};
          return (
            <li key={it.id} className="code-item">
              <span className="code-item-n">{i + 1}</span>
              <div className="bug-code" role="group" aria-label={`Program ${i + 1}: choose the line with the bug`}>
                {it.lines.map((line, k) => (
                  <button key={k} type="button" disabled={sending}
                    className={`bug-line${pick.line === k + 1 ? ' bug-line--on' : ''}`}
                    aria-pressed={pick.line === k + 1}
                    onClick={() => pickLine(it.id, k + 1)}>
                    <span className="bug-line-n">{k + 1}</span>
                    <code>{line || ' '}</code>
                  </button>
                ))}
              </div>

              {pick.line ? (
                <fieldset className="bug-fixes">
                  <legend>Line {pick.line} should be:</legend>
                  {it.fixes.map((f) => (
                    <label key={f.id} className={`bug-fix${pick.fix === f.id ? ' bug-fix--on' : ''}`}>
                      <input type="radio" name={`fix-${it.id}`} checked={pick.fix === f.id}
                        onChange={() => pickFix(it.id, f.id)} disabled={sending} />
                      <code>{f.text}</code>
                    </label>
                  ))}
                </fieldset>
              ) : <p className="muted-on-dark small">Tap the line you think is wrong.</p>}
              <Hint ask={hint} item={it.id} disabled={sending} />
            </li>
          );
        })}
      </ol>

      <div className="quiz-nav">
        <span />
        <button className="btn btn--sm" type="button" onClick={() => onFinish(picks)} disabled={!done || sending}>
          {sending ? 'Checking…' : 'Check fixes'}
        </button>
      </div>
    </>
  );
}
