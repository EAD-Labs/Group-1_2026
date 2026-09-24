import { useState } from 'react';

/*
 * A hint button for one item: a program, a step, a function.
 *
 * Hints go up in levels, from a nudge towards the answer. Every one costs the
 * third star, and the button says so before it is pressed. The server records
 * each hint, so the count cannot be edited in the browser. With no connection
 * there are no hints.
 */
export default function Hint({ ask, item, onHint, disabled, label = 'Hint' }) {
  const [given, setGiven] = useState([]);       // texts shown so far
  const [maxLevel, setMaxLevel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!ask) return null;
  const level = given.length + 1;
  const more = maxLevel === null || level <= maxLevel;

  async function next() {
    setBusy(true);
    setError(null);
    try {
      const hint = await ask(item, level);
      setGiven((g) => [...g, hint.text]);
      setMaxLevel(hint.maxLevel);
      onHint?.(hint);
    } catch (err) {
      setError(err.status === 0 ? 'Hints need a connection.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hint">
      {given.map((text, i) => <p key={i} className="hint-text"><span aria-hidden="true">💡</span> {text}</p>)}
      {error && <p className="hint-text hint-text--error">{error}</p>}
      {more && (
        <button type="button" className="hint-btn" onClick={next} disabled={disabled || busy}>
          {busy ? 'Thinking…' : `${given.length ? 'Another hint' : label}`}
          <span className="hint-cost"> · costs ⭐</span>
        </button>
      )}
    </div>
  );
}
