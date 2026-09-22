import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import DashboardShell from '../components/DashboardShell';
import { client } from '../api/client';
import { kindOf } from '../games/registry';

/*
 * One game, start to finish, whatever its kind.
 *
 * The board (from src/games) only collects answers. Marking happens on the
 * server once the student is done, and the result screen is where the right
 * answers and the explanations first arrive — the same rule the quiz follows.
 */
export default function Game() {
  const { id } = useParams();
  const [game, setGame] = useState(null);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [round, setRound] = useState(0);

  // One per round, so a double submit records one attempt and a replay is new.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const clientAttemptId = useMemo(() => crypto.randomUUID(), [round]);

  useEffect(() => {
    let live = true;
    setGame(null);
    client.get(`/games/${id}`)
      .then((res) => live && setGame(res.data))
      .catch((err) => live && setError(err.message));
    return () => { live = false; };
  }, [id, round]);

  const finish = useCallback(async (answers) => {
    setSending(true);
    try {
      const res = await client.post(`/games/${id}/results`, { answers, clientAttemptId });
      setResult(res.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }, [id, clientAttemptId]);

  function playAgain() {
    setResult(null);
    setRound((r) => r + 1);
  }

  if (error) {
    return (
      <DashboardShell title="Game" back={{ to: '/play', label: 'All games' }}>
        <p className="alert" role="alert">{error}</p>
      </DashboardShell>
    );
  }

  if (result) return <GameResult result={result} onAgain={playAgain} />;

  if (!game) {
    return <DashboardShell title="Game" back={{ to: '/play', label: 'All games' }}><p className="muted">Loading…</p></DashboardShell>;
  }

  const { Board, label, icon } = kindOf(game.kind);
  if (!Board) {
    return (
      <DashboardShell title={game.title} back={{ to: '/play', label: 'All games' }}>
        <p className="alert" role="alert">This version of the app cannot play this kind of game yet. Try refreshing the page.</p>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell title={game.title} wide back={{ to: '/play', label: 'All games' }}
      note="Nothing is saved until you finish">
      <div className="quiz game">
        <div className="quiz-top">
          <p className="quiz-topic">
            <span aria-hidden="true">{icon}</span> {label} · {game.topic}
          </p>
        </div>
        {game.instructions && <p className="game-instructions">{game.instructions}</p>}
        <Board key={round} game={game} onFinish={finish} sending={sending} />
      </div>
    </DashboardShell>
  );
}

const multiline = (s) => typeof s === 'string' && s.includes('\n');

/** A given or right answer: code on its own lines when it spans several. */
function Shown({ value }) {
  return multiline(value) ? <pre className="fb-code fb-code--inline">{value}</pre> : <strong>{value}</strong>;
}

function GameResult({ result, onAgain }) {
  const memory = result.kind === 'memory';
  const { label, icon } = kindOf(result.kind);

  const mark = (f) => {
    if (memory) return f.correct ? 'Found' : 'Not found';
    if (f.correct) return 'Correct';
    return f.partial ? 'Partly right' : 'Not correct';
  };

  return (
    <DashboardShell title={`${result.title} — your result`} back={{ to: '/play', label: 'All games' }}>
      <div className="result-score">
        <p className="stat-value big">{result.score} / {result.maxScore}</p>
        <p className="muted">
          <span aria-hidden="true">{icon}</span> {label} · {result.percent}% · {result.topic}
          {memory && result.misses > 0 && ` · ${result.misses} miss${result.misses > 1 ? 'es' : ''}`}
          {result.distractorsUsed > 0 && ` · ${result.distractorsUsed} line${result.distractorsUsed > 1 ? 's' : ''} that did not belong`}
        </p>
      </div>

      {result.revisit.length > 0 && (
        <p className="revisit"><strong>Worth another look:</strong> {result.revisit.join(', ')}</p>
      )}
      {memory && result.score < result.maxScore && (
        <p className="muted small note-memory">
          Every pair gets two free misses. After that, every two misses cost a point.
        </p>
      )}

      {result.lines?.length > 0 && (
        <>
          <h2 className="h2">Your program, line by line</h2>
          <ol className="program-check">
            {result.lines.map((l, i) => (
              <li key={i} className={l.ok ? 'program-ok' : 'program-off'}>
                <span className="program-mark" aria-label={l.ok ? 'in place' : 'out of place'}>{l.ok ? '✓' : '✗'}</span>
                <code style={{ paddingLeft: `${l.indent * 1.6}rem` }}>{l.code}</code>
              </li>
            ))}
          </ol>
        </>
      )}

      <h2 className="h2">{memory ? 'The pairs' : 'Every answer'}</h2>
      <ol className="feedback">
        {result.feedback.map((f, i) => (
          <li key={i} className={`fb ${f.correct ? 'fb--ok' : f.partial ? 'fb--part' : 'fb--no'}`}>
            <p className="fb-head"><span className="fb-mark">{mark(f)}</span></p>
            {result.kind !== 'parsons' && <pre className="fb-code">{f.prompt}</pre>}
            {memory ? (
              <p className="fb-a">Pairs with <strong>{f.answer}</strong>.</p>
            ) : !f.correct && (
              <div className="fb-a">
                {f.given ? <p>You gave <Shown value={f.given} /></p> : <p>You left this out.</p>}
                <p>The answer is <Shown value={f.answer} /></p>
              </div>
            )}
            {f.explanation && <p className="fb-why">{f.explanation}</p>}
          </li>
        ))}
      </ol>

      <div className="result-actions">
        <button className="btn btn--sm" type="button" onClick={onAgain}>Play again</button>
        <Link className="btn btn--ghost btn--sm" to="/play">All games</Link>
      </div>
    </DashboardShell>
  );
}
