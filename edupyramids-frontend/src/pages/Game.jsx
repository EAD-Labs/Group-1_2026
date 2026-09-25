import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import DashboardShell from '../components/DashboardShell';
import { client } from '../api/client';
import { kindOf } from '../games/registry';
import { findGame } from '../offline/pack';
import { markGame } from '../offline/markers';
import { enqueue } from '../offline/outbox';
import Pyra, { pyraOnResult } from '../components/Pyra';
import Stars from '../components/Stars';
import { MasteryMoves } from './Practice';

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

  // The downloaded copy, with its marking key, if offline use is on.
  const offlineGame = useMemo(() => findGame(id), [id]);

  useEffect(() => {
    let live = true;
    setGame(null);
    client.get(`/games/${id}`)
      .then((res) => live && setGame(res.data))
      .catch((err) => {
        if (!live) return;
        if (err.status === 0 && offlineGame) setGame({ ...offlineGame, offline: true });
        else {
          setError(err.status === 0
            ? 'You are offline, and this game has not been downloaded. Turn on offline use under Progress while connected.'
            : err.message);
        }
      });
    return () => { live = false; };
  }, [id, round, offlineGame]);

  // Hints are recorded by the server against this round, so they need a connection.
  const askHint = useCallback(async (item, level) => {
    if (game?.offline) throw Object.assign(new Error('offline'), { status: 0 });
    const res = await client.post(`/games/${id}/hint`, { clientAttemptId, item, level });
    return res.data;
  }, [id, clientAttemptId, game]);

  const finish = useCallback(async (answers) => {
    setSending(true);
    const body = { answers, clientAttemptId, answeredAt: new Date().toISOString() };
    try {
      if (game?.offline) throw Object.assign(new Error('offline'), { status: 0 });
      const res = await client.post(`/games/${id}/results`, body);
      setResult(res.data);
    } catch (err) {
      if (err.status === 0 && offlineGame) {
        // Marked here for the student now; uploaded and marked again later.
        enqueue({ path: `/games/${id}/results`, body, title: offlineGame.title });
        setResult({ ...markGame(offlineGame, answers), savedOffline: true });
      } else {
        setError(err.message);
      }
    } finally {
      setSending(false);
    }
  }, [id, clientAttemptId, game, offlineGame]);

  function playAgain() {
    setResult(null);
    setRound((r) => r + 1);
  }

  if (error) {
    return (
      <DashboardShell title="Game" back={{ to: '/dashboard/student', label: 'Pyramid' }}>
        <p className="alert" role="alert">{error}</p>
      </DashboardShell>
    );
  }

  if (result) return <GameResult result={result} onAgain={playAgain} />;

  if (!game) {
    return <DashboardShell title="Game" back={{ to: '/dashboard/student', label: 'Pyramid' }}><p className="muted">Loading…</p></DashboardShell>;
  }

  const { Board, label, icon } = kindOf(game.kind);
  if (!Board) {
    return (
      <DashboardShell title={game.title} back={{ to: '/dashboard/student', label: 'Pyramid' }}>
        <p className="alert" role="alert">This version of the app cannot play this kind of game yet. Try refreshing the page.</p>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell title={game.title} wide back={{ to: '/dashboard/student', label: 'Pyramid' }}
      note="Nothing is saved until you finish">
      <div className="quiz game">
        <div className="quiz-top">
          <p className="quiz-topic">
            <span aria-hidden="true">{icon}</span> {label} · {game.topic}
          </p>
        </div>
        {game.instructions && <p className="game-instructions">{game.instructions}</p>}
        <Board key={round} game={game} onFinish={finish} sending={sending} hint={askHint} attemptId={clientAttemptId} />
      </div>
    </DashboardShell>
  );
}

const multiline = (s) => typeof s === 'string' && s.includes('\n');

/** A given or right answer: code on its own lines when it spans several. */
function Shown({ value }) {
  return multiline(value) ? <pre className="fb-code fb-code--inline">{value}</pre> : <strong>{value}</strong>;
}

/** Bug Catcher: the tests the student ran, then every bugged copy, caught or not. */
function CatchResult({ result }) {
  return (
    <>
      <h2 className="h2">Your tests</h2>
      <ul className="catch-ran">
        {result.tests.map((t, i) => (
          <li key={i} className={t.ok ? 'catch-ran--ok' : 'catch-ran--no'}>
            <code>{t.call}</code>
            {t.ok
              ? <span>you expected <code>{t.expected}</code>, right ✓</span>
              : <span>you expected <code>{t.expected ?? 'nothing'}</code>, but it gives <code>{t.right}</code>, so this test could not catch anything</span>}
          </li>
        ))}
      </ul>
      <h2 className="h2">The bugged copies</h2>
      <ol className="feedback">
        {result.feedback.map((f, i) => (
          <li key={i} className={`fb ${f.correct ? 'fb--ok' : 'fb--no'}`}>
            <p className="fb-head"><span className="fb-mark">{f.correct ? `🪤 ${f.given}` : '🐞 Escaped'}</span></p>
            <pre className="fb-code">
              {f.prompt.split('\n').map((line, n) => (
                <span key={n} className={`fb-code-line${f.changed?.includes(n) ? ' fb-code-changed' : ''}`}>{line || ' '}</span>
              ))}
            </pre>
            {!f.correct && <p className="fb-a">{f.answer}.</p>}
            <p className="fb-why">{f.explanation}</p>
          </li>
        ))}
      </ol>
    </>
  );
}

/** Trace Runner: each program with every step, right or wrong. */
function TraceResult({ result }) {
  return result.programs.map((code, p) => (
    <section key={p} className="trace-result">
      <h2 className="h2">Program {p + 1}</h2>
      <pre className="fb-code">{code}</pre>
      <ol className="trace-steps">
        {result.feedback.filter((f) => f.program === p).map((f, i) => (
          <li key={i} className={f.correct ? 'trace-step--ok' : 'trace-step--no'}>
            <span className="trace-step-mark" aria-label={f.correct ? 'right' : 'wrong'}>{f.correct ? '✓' : '✗'}</span>
            <code className="trace-step-line">line {f.prompt}</code>
            <span><code>{f.answer}</code>{!f.correct && <span className="muted"> (you said {f.given ? <code>{f.given.split(' = ').slice(1).join(' = ')}</code> : 'nothing'})</span>}</span>
          </li>
        ))}
      </ol>
      {result.feedback.filter((f) => f.program === p && f.explanation).map((f, i) => <p key={i} className="fb-why">{f.explanation}</p>)}
    </section>
  ));
}

function GameResult({ result, onAgain }) {
  const memory = result.kind === 'memory';
  const { label, icon } = kindOf(result.kind);
  const pyra = pyraOnResult(result);

  const mark = (f) => {
    if (memory) return f.correct ? 'Found' : 'Not found';
    if (f.correct) return 'Correct';
    return f.partial ? 'Partly right' : 'Not correct';
  };

  return (
    <DashboardShell title={`${result.title} — your result`} back={{ to: '/dashboard/student', label: 'Pyramid' }}>
      {result.savedOffline && (
        <p className="offline-note" role="status">
          Marked on this device. It will be saved to your record when you are next online.
        </p>
      )}
      <div className="result-score">
        <Stars n={result.stars ?? 0} size="lg" />
        {result.xp > 0 && <p className="xp-chip">+{result.xp} XP</p>}
        <p className="stat-value big">{result.score} / {result.maxScore}</p>
        <p className="muted">
          <span aria-hidden="true">{icon}</span> {label} · {result.percent}% · {result.topic}
          {memory && result.misses > 0 && ` · ${result.misses} miss${result.misses > 1 ? 'es' : ''}`}
          {result.distractorsUsed > 0 && ` · ${result.distractorsUsed} line${result.distractorsUsed > 1 ? 's' : ''} that did not belong`}
          {result.hintsUsed > 0 && ` · ${result.hintsUsed} hint${result.hintsUsed > 1 ? 's' : ''}`}
        </p>
      </div>

      <Pyra mood={pyra.mood}>{pyra.text}</Pyra>

      {result.mastery?.length > 0 && (
        <>
          <h2 className="h2">What moved</h2>
          <div className="card"><MasteryMoves changes={result.mastery} dark={false} /></div>
        </>
      )}

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

      {result.kind === 'bugcatch' && <CatchResult result={result} />}
      {result.kind === 'trace' && <TraceResult result={result} />}

      {!['bugcatch', 'trace'].includes(result.kind) && (<>
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
      </>)}

      <div className="result-actions">
        <button className="btn btn--sm" type="button" onClick={onAgain}>Play again</button>
        <Link className="btn btn--ghost btn--sm" to="/dashboard/student">Back to your pyramid</Link>
      </div>
    </DashboardShell>
  );
}
