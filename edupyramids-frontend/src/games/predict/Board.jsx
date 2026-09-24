import { useState } from 'react';
import Hint from '../Hint';

/*
 * Predict the output: read each program and type exactly what it prints.
 * Enter makes a new line, because some programs print several.
 */
export default function PredictBoard({ game, onFinish, sending, hint }) {
  const [typed, setTyped] = useState({});
  const done = game.items.filter((it) => (typed[it.id] || '').trim()).length;

  return (
    <>
      <p className="board-status" aria-live="polite">{done} of {game.items.length} answered</p>

      <ol className="code-items">
        {game.items.map((it, i) => (
          <li key={it.id} className="code-item">
            <span className="code-item-n">{i + 1}</span>
            <pre className="code-panel"><code>{it.code}</code></pre>
            <label className="code-answer">
              <span>Output</span>
              <textarea
                rows={Math.max(1, it.code.split('\n').filter((l) => l.includes('print')).length)}
                value={typed[it.id] || ''}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                onChange={(e) => setTyped((t) => ({ ...t, [it.id]: e.target.value }))}
                disabled={sending}
              />
            </label>
            <Hint ask={hint} item={it.id} disabled={sending} />
          </li>
        ))}
      </ol>

      <div className="quiz-nav">
        <span />
        <button className="btn btn--sm" type="button" onClick={() => onFinish(typed)} disabled={!done || sending}>
          {sending ? 'Checking…' : done < game.items.length ? `Check ${done} answer${done === 1 ? '' : 's'}` : 'Check answers'}
        </button>
      </div>
    </>
  );
}
