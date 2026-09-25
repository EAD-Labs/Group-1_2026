import { useEffect, useRef, useState } from 'react';
import { client } from '../../api/client';
import { checkMemory } from '../../offline/markers';

/*
 * Flip two tiles at a time to find each piece of code and its output.
 *
 * Whether two tiles match is asked of the server, because the tiles carry no
 * pairing the browser could read. Every pair of flips is kept as a move and
 * sent at the end, and the server replays them to work out the score, so the
 * number shown here is never the number that counts.
 */
const FLIP_BACK_MS = 1100;

export default function MemoryBoard({
  game, onFinish, sending, attemptId,
}) {
  const [up, setUp] = useState([]);                // tile ids face up, not yet matched
  const [matched, setMatched] = useState(new Set());
  const [moves, setMoves] = useState([]);
  const [misses, setMisses] = useState(0);
  const [note, setNote] = useState(null);          // { match, text }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const finished = useRef(false);

  useEffect(() => {
    if (matched.size === game.tiles.length && !finished.current) {
      finished.current = true;
      onFinish({ moves });
    }
  }, [matched, moves, game.tiles.length, onFinish]);

  async function flip(id) {
    if (busy || matched.has(id) || up.includes(id)) return;
    if (up.length === 0) { setUp([id]); return; }

    const [first] = up;
    setUp([first, id]);
    setBusy(true);
    setMoves((m) => [...m, [first, id]]);

    try {
      // Online, the server says; offline, the downloaded key does.
      let data;
      try {
        if (game.offline) throw Object.assign(new Error('offline'), { status: 0 });
        ({ data } = await client.post(`/games/${game.id}/check`, { first, second: id, clientAttemptId: attemptId }));
      } catch (err) {
        if (err.status !== 0 || !game.key) throw err;
        data = checkMemory(game, first, id);
      }
      if (data.match) {
        setMatched((s) => new Set([...s, first, id]));
        setUp([]);
        setNote({ match: true, text: data.explanation || 'A pair!' });
        setBusy(false);
      } else {
        setMisses((n) => n + 1);
        setNote({ match: false, text: 'Not a pair. Remember where they were.' });
        setTimeout(() => { setUp([]); setBusy(false); }, FLIP_BACK_MS);
      }
    } catch (err) {
      setError(err.message);
      setUp([]);
      setBusy(false);
    }
  }

  const found = matched.size / 2;

  return (
    <>
      <p className="board-status" aria-live="polite">
        {found} of {game.pairs} pairs found
        {misses > 0 && <span className="muted-on-dark"> · {misses} miss{misses > 1 ? 'es' : ''}</span>}
      </p>

      <ul className="tiles-grid">
        {game.tiles.map((t, i) => {
          const shown = matched.has(t.id) || up.includes(t.id);
          return (
            <li key={t.id}>
              <button
                type="button"
                className={`tile-card${shown ? ' tile-card--up' : ''}${matched.has(t.id) ? ' tile-card--done' : ''}`}
                onClick={() => flip(t.id)}
                disabled={sending || matched.has(t.id)}
                aria-label={shown ? t.text : `Tile ${i + 1}, face down`}
              >
                <span className="tile-face tile-back" aria-hidden="true">?</span>
                <span className="tile-face tile-front" aria-hidden={!shown}>
                  <code>{t.text}</code>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {error && <p className="verdict verdict--no" role="alert">{error}</p>}
      {note && !error && (
        <p key={moves.length} className={`verdict ${note.match ? 'verdict--ok' : 'verdict--no'}`} role="status">
          {note.match && <strong>Pair found — </strong>}{note.text}
        </p>
      )}
      {sending && <p className="board-status">Saving your result…</p>}
    </>
  );
}
