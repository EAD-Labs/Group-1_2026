import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import DashboardShell from '../components/DashboardShell';
import Pyra from '../components/Pyra';
import { client } from '../api/client';

const LETTERS = ['a', 'b', 'c', 'd', 'e'];

/*
 * A checkpoint: the mixed challenge at the end of a unit.
 *
 * Ten questions, mostly from this unit and a few from earlier ones, because
 * mixing topics makes practice harder and learning last longer (Bjork's
 * desirable difficulties). No instant feedback and no hints: it is a test of
 * what has stuck. Passing it opens the next unit.
 */
export default function Checkpoint() {
  const { topicId } = useParams();
  const [cp, setCp] = useState(null);
  const [started, setStarted] = useState(false);
  const [at, setAt] = useState(0);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let live = true;
    setCp(null);
    client.get(`/path/checkpoints/${topicId}`)
      .then((res) => live && setCp(res.data))
      .catch((err) => live && setError(err.status === 0
        ? 'Checkpoints need a connection, because each one is picked fresh from the whole unit.'
        : err.message));
    return () => { live = false; };
  }, [topicId, round]);

  async function finish() {
    setSending(true);
    try {
      const res = await client.post(`/path/checkpoints/${topicId}`, { ticket: cp.ticket, answers });
      setResult(res.data);
    } catch (err) {
      setError(err.status === 0 ? 'You went offline. Your answers are still here: try again when connected.' : err.message);
    } finally {
      setSending(false);
    }
  }

  function again() {
    setResult(null); setAnswers({}); setAt(0); setStarted(false); setRound((r) => r + 1);
  }

  const back = { to: '/dashboard/student', label: 'Path' };

  if (error) {
    return <DashboardShell title="Checkpoint" back={back}><p className="alert" role="alert">{error}</p></DashboardShell>;
  }
  if (!cp) return <DashboardShell title="Checkpoint" back={back}><p className="muted">Loading…</p></DashboardShell>;

  if (result) {
    return (
      <DashboardShell title={`${cp.topic} checkpoint — ${result.passed ? 'passed' : 'not yet'}`} back={back}>
        <div className="result-score">
          <p className="stat-value big">{result.score} / {result.maxScore}</p>
          <p className="muted">{result.percent}% · {result.passPercent}% needed to pass</p>
        </div>
        <Pyra mood={result.passed ? 'proud' : 'thinking'}>
          {result.passed
            ? 'Checkpoint passed! The next unit is open. 🏰'
            : `Not this time: ${result.passPercent}% opens the next unit. Read the explanations below, then have another go. You get new questions each time.`}
        </Pyra>

        <h2 className="h2">Every answer</h2>
        <ol className="feedback">
          {result.feedback.map((f) => (
            <li key={f.questionId} className={`fb ${f.correct ? 'fb--ok' : 'fb--no'}`}>
              <p className="fb-head"><span className="fb-mark">{f.correct ? 'Correct' : f.given ? 'Not correct' : 'Not answered'}</span><span className="muted small">{f.topic}</span></p>
              <p className="fb-q">{f.text}</p>
              {!f.correct && <p className="fb-a">The answer is <strong>{f.correctAnswer.toUpperCase()}</strong>.</p>}
              {f.explanation && <p className="fb-why">{f.explanation}</p>}
            </li>
          ))}
        </ol>
        <div className="result-actions">
          <Link className="btn btn--sm" to="/dashboard/student">Back to the path</Link>
          {!result.passed && <button className="btn btn--ghost btn--sm" type="button" onClick={again}>Try again</button>}
        </div>
      </DashboardShell>
    );
  }

  if (!started) {
    return (
      <DashboardShell title={`${cp.topic} checkpoint`} back={back}>
        <div className="checkpoint-intro">
          <p className="checkpoint-castle" aria-hidden="true">🏰</p>
          <Pyra mood="hello">
            {cp.questions.length} questions, mostly from {cp.topic} and a few from earlier. No hints, and you see
            the answers at the end. Get {cp.passPercent}% to open the next unit.
          </Pyra>
          <button className="btn" type="button" onClick={() => setStarted(true)}>Start the checkpoint</button>
        </div>
      </DashboardShell>
    );
  }

  const q = cp.questions[at];
  const answered = Object.keys(answers).length;
  return (
    <DashboardShell title={`${cp.topic} checkpoint`} back={back} note="Nothing is saved until you finish">
      <div className="quiz">
        <div className="quiz-top">
          <p className="quiz-topic">🏰 Checkpoint · {cp.topic}</p>
          <p className="quiz-count">{at + 1}<span>/{cp.questions.length}</span></p>
        </div>
        <ol className="pips" aria-label={`Question ${at + 1} of ${cp.questions.length}`}>
          {cp.questions.map((x, i) => (
            <li key={x.id} className={`pip pip--${i === at ? 'now' : answers[x.id] ? 'done' : 'todo'}`} />
          ))}
        </ol>

        <fieldset className="quiz-q">
          <legend className="quiz-text">{q.text}</legend>
          <div className="option-grid">
            {LETTERS.map((letter) => {
              const label = q[`option${letter.toUpperCase()}`];
              if (!label) return null;
              const checked = answers[q.id] === letter;
              return (
                <label key={letter} className={`option${checked ? ' option--on' : ''}`}>
                  <input type="radio" name={`q${q.id}`} value={letter} checked={checked}
                    onChange={() => setAnswers((a) => ({ ...a, [q.id]: letter }))} />
                  <span className="option-letter" aria-hidden="true">{letter.toUpperCase()}</span>
                  <span className="option-text">{label}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="quiz-nav">
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => setAt(at - 1)} disabled={at === 0}>Back</button>
          {at < cp.questions.length - 1 ? (
            <button className="btn btn--sm" type="button" onClick={() => setAt(at + 1)}>Next</button>
          ) : (
            <button className="btn btn--sm" type="button" onClick={finish} disabled={sending}>
              {sending ? 'Marking…' : `Finish (${answered}/${cp.questions.length} answered)`}
            </button>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
