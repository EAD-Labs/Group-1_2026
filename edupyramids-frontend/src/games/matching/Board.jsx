import { useState } from 'react';

/*
 * Pair each piece of code on the left with its answer on the right.
 *
 * Tap a left card, then a right card. Taps rather than drawn lines, because a
 * line has to be dragged and a tap works the same with a finger, a mouse or
 * the keyboard. A pair is shown by the same number on both cards.
 */
export default function MatchingBoard({ game, onFinish, sending }) {
  const [pairs, setPairs] = useState({});          // leftId -> rightId
  const [picked, setPicked] = useState(null);      // a leftId waiting for its right

  const numberOf = {};                              // either id -> its pair number
  game.lefts.forEach((l) => {
    if (pairs[l.id]) {
      const n = Object.keys(numberOf).length / 2 + 1;
      numberOf[l.id] = n;
      numberOf[pairs[l.id]] = n;
    }
  });

  function pickLeft(id) {
    if (pairs[id]) {
      // Tapping a paired card undoes the pair, so a mistake is one tap away.
      setPairs(({ [id]: _, ...rest }) => rest);
      setPicked(id);
      return;
    }
    setPicked(picked === id ? null : id);
  }

  function pickRight(id) {
    if (!picked) {
      // Tapping a paired right card undoes its pair too.
      const owner = Object.keys(pairs).find((l) => pairs[l] === id);
      if (owner) setPairs(({ [owner]: _, ...rest }) => rest);
      return;
    }
    setPairs((p) => {
      const next = Object.fromEntries(Object.entries(p).filter(([, r]) => r !== id));
      return { ...next, [picked]: id };
    });
    setPicked(null);
  }

  const done = Object.keys(pairs).length;
  const total = game.lefts.length;

  return (
    <>
      <p className="board-status" aria-live="polite">
        {picked ? 'Now pick its match on the right.' : `${done} of ${total} matched`}
      </p>

      <div className="match">
        <ul className="match-col" aria-label="Code">
          {game.lefts.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                className={`piece${picked === l.id ? ' piece--picked' : ''}${pairs[l.id] ? ' piece--paired' : ''}`}
                aria-pressed={picked === l.id}
                onClick={() => pickLeft(l.id)}
              >
                <code className="piece-code">{l.text}</code>
                {numberOf[l.id] && <span className="piece-num">{numberOf[l.id]}</span>}
              </button>
            </li>
          ))}
        </ul>

        <ul className="match-col" aria-label="Answers">
          {game.rights.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className={`piece piece--answer${numberOf[r.id] ? ' piece--paired' : ''}`}
                onClick={() => pickRight(r.id)}
              >
                {numberOf[r.id] && <span className="piece-num">{numberOf[r.id]}</span>}
                <code className="piece-code">{r.text}</code>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="quiz-nav">
        <button className="btn btn--ghost btn--sm" type="button"
          onClick={() => { setPairs({}); setPicked(null); }} disabled={!done || sending}>
          Clear
        </button>
        <button className="btn btn--sm" type="button"
          onClick={() => onFinish(pairs)} disabled={done < total || sending}>
          {sending ? 'Checking…' : 'Check answers'}
        </button>
      </div>
    </>
  );
}
