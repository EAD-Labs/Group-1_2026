import { useState } from 'react';
import Pyra from '../../components/Pyra';
import Hint from '../Hint';

/*
 * Bug Catcher: choose test inputs that expose Pyra's bugged copies.
 *
 * For each function: tap an input to add it as a test, then say what the
 * working function returns for it. Nothing is revealed until the end, when
 * each copy shows whether a test caught it. Test slots are limited, so the
 * choice of input matters: par is the fewest tests that can catch every copy.
 */
export default function BugCatchBoard({ game, onFinish, sending, hint }) {
  const [tests, setTests] = useState({});      // itemId -> [{ input, expect }]

  const listOf = (id) => tests[id] || [];
  const add = (it, input) => setTests((t) => {
    const list = t[it.id] || [];
    if (list.length >= it.slots || list.some((x) => x.input === input)) return t;
    return { ...t, [it.id]: [...list, { input, expect: null }] };
  });
  const expect = (itemId, input, option) => setTests((t) => ({
    ...t, [itemId]: t[itemId].map((x) => (x.input === input ? { ...x, expect: option } : x)),
  }));
  const remove = (itemId, input) => setTests((t) => ({ ...t, [itemId]: t[itemId].filter((x) => x.input !== input) }));

  const ready = game.items.filter((it) => listOf(it.id).some((x) => x.expect)).length;
  const bugs = game.items.reduce((n, it) => n + it.bugs, 0);

  return (
    <>
      <Pyra mood="thinking" small>
        I copied my functions and {bugs} of the copies came out wrong. Help me catch them! A test only
        counts if you know what the working function gives.
      </Pyra>

      <p className="board-status" aria-live="polite">{ready} of {game.items.length} functions tested</p>

      <ol className="code-items">
        {game.items.map((it, i) => {
          const list = listOf(it.id);
          const inputOf = Object.fromEntries(it.inputs.map((inp) => [inp.id, inp]));
          const full = list.length >= it.slots;
          return (
            <li key={it.id} className="code-item catch">
              <span className="code-item-n">{i + 1}</span>
              {it.task && <p className="catch-task">{it.task}</p>}
              <pre className="code-panel"><code>{it.code}</code></pre>
              <p className="catch-meta">
                <span>🐞 {it.bugs} bugged cop{it.bugs === 1 ? 'y' : 'ies'} hiding</span>
                <span>🧪 {list.length} of {it.slots} test slots</span>
                <span>⛳ par {it.par}</span>
              </p>

              <div className="catch-inputs" role="group" aria-label="Inputs you can test">
                {it.inputs.map((inp) => {
                  const on = list.some((x) => x.input === inp.id);
                  return (
                    <button key={inp.id} type="button" className={`catch-input${on ? ' catch-input--on' : ''}`}
                      aria-pressed={on} disabled={sending || (!on && full)}
                      onClick={() => (on ? remove(it.id, inp.id) : add(it, inp.id))}>
                      <code>{inp.call}</code>
                    </button>
                  );
                })}
              </div>

              {list.length > 0 && (
                <ul className="catch-tests">
                  {list.map((t) => (
                    <li key={t.input} className="catch-test">
                      <p className="catch-test-q"><code>{inputOf[t.input].call}</code> should give:</p>
                      <div className="catch-options" role="radiogroup" aria-label={`Expected output of ${inputOf[t.input].call}`}>
                        {inputOf[t.input].options.map((o) => (
                          <button key={o.id} type="button" role="radio" aria-checked={t.expect === o.id}
                            className={`catch-option${t.expect === o.id ? ' catch-option--on' : ''}`}
                            onClick={() => expect(it.id, t.input, o.id)} disabled={sending}>
                            <code>{o.text}</code>
                          </button>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <Hint ask={hint} item={it.id} disabled={sending} />
            </li>
          );
        })}
      </ol>

      <div className="quiz-nav">
        <button className="btn btn--ghost btn--sm" type="button" onClick={() => setTests({})} disabled={sending}>Clear</button>
        <button className="btn btn--sm" type="button" disabled={!ready || sending}
          onClick={() => onFinish(Object.fromEntries(Object.entries(tests)
            .map(([id, list]) => [id, list.filter((x) => x.expect)]))) }>
          {sending ? 'Running tests…' : 'Run my tests'}
        </button>
      </div>
    </>
  );
}
