import { useState } from 'react';

/*
 * Fill the blank: tap a gap, then a chip. The first empty gap is chosen for
 * you, so most of the time it is just tapping chips. Tap a filled gap to
 * empty it.
 */
export default function FillBlankBoard({ game, onFinish, sending }) {
  const [filled, setFilled] = useState({});      // itemId -> [chip per gap]
  const [active, setActive] = useState(null);    // { id, gap }

  const gapsOf = (it) => it.parts.length - 1;
  const valuesOf = (it) => filled[it.id] || Array(gapsOf(it)).fill(null);
  const complete = (it) => valuesOf(it).every(Boolean);
  const done = game.items.filter(complete).length;

  function firstEmpty(it, values) {
    const k = values.findIndex((v) => !v);
    return k < 0 ? null : { id: it.id, gap: k };
  }

  function tapGap(it, gap) {
    const values = valuesOf(it);
    if (values[gap]) {
      const next = values.map((v, k) => (k === gap ? null : v));
      setFilled((f) => ({ ...f, [it.id]: next }));
    }
    setActive({ id: it.id, gap });
  }

  function tapChip(it, chip) {
    const values = valuesOf(it);
    const target = active?.id === it.id ? active.gap : firstEmpty(it, values)?.gap;
    if (target === undefined || target === null) return;
    const next = values.map((v, k) => (k === target ? chip : v));
    setFilled((f) => ({ ...f, [it.id]: next }));
    setActive(firstEmpty(it, next));
  }

  return (
    <>
      <p className="board-status" aria-live="polite">{done} of {game.items.length} complete</p>

      <ol className="code-items">
        {game.items.map((it, i) => {
          const values = valuesOf(it);
          return (
            <li key={it.id} className="code-item">
              <span className="code-item-n">{i + 1}</span>
              <pre className="code-panel"><code>
                {it.parts.map((part, k) => (
                  <span key={k}>
                    {part}
                    {k < it.parts.length - 1 && (
                      <button type="button" disabled={sending}
                        className={`gap${values[k] ? ' gap--filled' : ''}${active?.id === it.id && active.gap === k ? ' gap--active' : ''}`}
                        onClick={() => tapGap(it, k)}
                        aria-label={values[k] ? `Gap ${k + 1}: ${values[k]}. Tap to empty it` : `Gap ${k + 1}, empty`}>
                        {values[k] || '  '}
                      </button>
                    )}
                  </span>
                ))}
              </code></pre>
              <div className="chips" role="group" aria-label="Chips">
                {it.chips.map((chip) => (
                  <button key={chip} type="button" className="piece piece--chip" disabled={sending || complete(it)}
                    onClick={() => tapChip(it, chip)}>
                    <code className="piece-code">{chip}</code>
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="quiz-nav">
        <button className="btn btn--ghost btn--sm" type="button" onClick={() => { setFilled({}); setActive(null); }}
          disabled={!Object.keys(filled).length || sending}>
          Clear
        </button>
        <button className="btn btn--sm" type="button" onClick={() => onFinish(filled)} disabled={!done || sending}>
          {sending ? 'Checking…' : 'Check answers'}
        </button>
      </div>
    </>
  );
}
