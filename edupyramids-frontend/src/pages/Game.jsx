import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import DashboardShell from '../components/DashboardShell';
import MatchingBoard from '../components/games/MatchingBoard';
import SortBoard from '../components/games/SortBoard';
import MemoryBoard from '../components/games/MemoryBoard';
import { client } from '../api/client';

export const KINDS = {
  matching: { label: 'Matching', icon: '🔗', Board: MatchingBoard },
  drag_drop: { label: 'Sorting', icon: '🗂️', Board: SortBoard },
  memory: { label: 'Memory tiles', icon: '🃏', Board: MemoryBoard },
};

/*
 * One game, start to finish.
 *
 * The board only collects answers. Marking happens on the server once the
 * student is done, and the result screen is where the right answers and the
 * explanations first arrive — the same rule the quiz follows.
 */
export default function Game() {
  const { id } = useParams();
  const [game, setGame] = useState(null);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [round, setRound] = useState(0);

  // One per round, so a double submit records one attempt and a replay is new.
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
      <DashboardShell title="Game">
        <p className="alert" role="alert">{error}</p>
        <Link className="btn btn--sm" to="/dashboard/student">Back to your topics</Link>
      </DashboardShell>
    );
  }

  if (result) return <GameResult result={result} onAgain={playAgain} />;

  if (!game) {
    return <DashboardShell title="Game"><p className="muted">Loading…</p></DashboardShell>;
  }

  const { Board, label, icon } = KINDS[game.kind];

  return (
    <DashboardShell title={game.title} wide>
      <p className="quiz-back">
        <Link to="/dashboard/student">&larr; All topics</Link>
        <span className="muted small">Nothing is saved until you finish</span>
      </p>

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

function GameResult({ result, onAgain }) {
  const memory = result.kind === 'memory';

  return (
    <DashboardShell title={`${result.title} — your result`}>
      <div className="result-score">
        <p className="stat-value big">{result.score} / {result.maxScore}</p>
        <p className="muted">
          {result.percent}% · {result.topic}
          {memory && result.misses > 0 && ` · ${result.misses} miss${result.misses > 1 ? 'es' : ''}`}
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

      <h2 className="h2">{memory ? 'The pairs' : 'Every answer'}</h2>
      <ol className="feedback">
        {result.feedback.map((f, i) => (
          <li key={i} className={f.correct ? 'fb fb--ok' : 'fb fb--no'}>
            <p className="fb-head">
              <span className="fb-mark">{memory ? (f.correct ? 'Found' : 'Not found') : (f.correct ? 'Correct' : 'Not correct')}</span>
            </p>
            <pre className="fb-code">{f.prompt}</pre>
            {memory ? (
              <p className="fb-a">Pairs with <strong>{f.answer}</strong>.</p>
            ) : !f.correct && (
              <p className="fb-a">
                {f.given ? <>You chose <strong>{f.given}</strong>. </> : <>You left this out. </>}
                The answer is <strong>{f.answer}</strong>.
              </p>
            )}
            {f.explanation && <p className="fb-why">{f.explanation}</p>}
          </li>
        ))}
      </ol>

      <div className="result-actions">
        <button className="btn btn--sm" type="button" onClick={onAgain}>Play again</button>
        <Link className="btn btn--ghost btn--sm" to="/dashboard/student">Back to your topics</Link>
      </div>
    </DashboardShell>
  );
}
