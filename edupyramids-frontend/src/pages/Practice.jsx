import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import DashboardShell from '../components/DashboardShell';
import { client } from '../api/client';

const LETTERS = ['a', 'b', 'c', 'd', 'e'];
const SESSION_LENGTH = 10;
const MAX_LENGTH = 20;

/*
 * Adaptive practice: ten questions, each picked by the mastery model.
 *
 * The screen shows its working. Every question says why it was chosen and
 * what the model expects, and every answer shows the estimate moving, because
 * a student who can see why the app does something is more likely to trust
 * it — and a teacher or examiner can check that it does what it claims.
 */
export default function Practice() {
  // A review from the path keeps to its concepts and is shorter: ?focus=a,b&n=5
  const [params] = useSearchParams();
  const focus = params.get('focus') || '';
  const length = Math.min(MAX_LENGTH, Math.max(1, Number(params.get('n')) || SESSION_LENGTH));
  const title = focus ? 'Review' : 'Practice';
  const [pick, setPick] = useState(null);
  const [seen, setSeen] = useState([]);
  const [chosen, setChosen] = useState(null);
  const [verdict, setVerdict] = useState(null);
  const [history, setHistory] = useState([]);       // { correct, mastery }
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);

  async function load(exclude) {
    setBusy(true);
    setChosen(null);
    setVerdict(null);
    try {
      const res = await client.get(`/practice/next?exclude=${exclude.join(',')}${focus ? `&focus=${encodeURIComponent(focus)}` : ''}`);
      setPick(res.data);
    } catch (err) {
      if (err.status === 404) setFinished(true);
      else if (err.status === 0) {
        setError('Practice picks each question from your whole record, so it needs a connection. Quizzes and games you have downloaded still work offline.');
      } else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { load([]); }, []);

  async function answer(letter) {
    if (verdict || busy) return;
    setChosen(letter);
    setBusy(true);
    try {
      const res = await client.post('/practice/answer', { questionId: pick.question.id, answer: letter });
      setVerdict(res.data);
      setHistory((h) => [...h, { correct: res.data.correct, mastery: res.data.mastery }]);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function next() {
    const nowSeen = [...seen, pick.question.id];
    setSeen(nowSeen);
    if (nowSeen.length >= length) setFinished(true);
    else load(nowSeen);
  }

  function again() {
    setSeen([]);
    setHistory([]);
    setFinished(false);
    load([]);
  }

  if (error) {
    return (
      <DashboardShell title={title}>
        <p className="alert" role="alert">{error}</p>
        <Link className="btn btn--sm" to="/dashboard/student">Back home</Link>
      </DashboardShell>
    );
  }

  if (finished) return <Summary history={history} onAgain={again} />;

  if (!pick) {
    return <DashboardShell title={title}><p className="muted">Choosing your first question…</p></DashboardShell>;
  }

  const { question, concept, reason, predicted } = pick;

  return (
    <DashboardShell title={title} wide note="Questions picked for you, one at a time">

      <div className="quiz">
        <div className="quiz-top">
          <p className="quiz-topic">{concept.name} · {question.topic}</p>
          <p className="quiz-count">{seen.length + 1}<span>/{length}</span></p>
        </div>

        <ol className="pips" aria-hidden="true">
          {Array.from({ length: length }, (_, i) => {
            const h = history[i];
            const state = h ? (h.correct ? 'right' : 'wrong') : (i === seen.length ? 'now' : 'todo');
            return <li key={i} className={`pip pip--${state}`} />;
          })}
        </ol>

        <p className="why">
          <strong>Why this question:</strong> {reason}{' '}
          <span className="why-predict">The model expects you to get it right {predicted}% of the time.</span>
        </p>

        <fieldset className="quiz-q">
          <legend className="quiz-text">{question.text}</legend>
          <div className="option-grid">
            {LETTERS.map((letter) => {
              const label = question[`option${letter.toUpperCase()}`];
              if (!label) return null;
              let state = '';
              if (verdict) {
                if (letter === verdict.correctAnswer) state = ' option--right';
                else if (letter === chosen) state = ' option--wrong';
              }
              return (
                <label key={letter} className={`option${chosen === letter ? ' option--on' : ''}${state}`}>
                  <input type="radio" name="practice" value={letter} checked={chosen === letter}
                    disabled={Boolean(verdict) || busy} onChange={() => answer(letter)} />
                  <span className="option-letter" aria-hidden="true">{letter.toUpperCase()}</span>
                  <span className="option-text">{label}</span>
                  {state === ' option--right' && <span className="option-tag">Correct</span>}
                  {state === ' option--wrong' && <span className="option-tag">Your answer</span>}
                </label>
              );
            })}
          </div>
        </fieldset>

        {verdict && (
          <>
            <p className={`verdict ${verdict.correct ? 'verdict--ok' : 'verdict--no'}`} role="status">
              <strong>{verdict.correct ? 'Correct' : 'Not correct'}</strong>
              {verdict.explanation ? ` — ${verdict.explanation}` : ' — the right answer is highlighted above.'}
            </p>
            <MasteryMoves changes={verdict.mastery} />
          </>
        )}

        <div className="quiz-nav">
          <span />
          <button className="btn btn--sm" type="button" onClick={next} disabled={!verdict || busy}>
            {seen.length + 1 >= length ? 'Finish' : 'Next question'}
          </button>
        </div>
      </div>
    </DashboardShell>
  );
}

/** Each concept's estimate, before and after, as a bar that fills. */
export function MasteryMoves({ changes, dark = true }) {
  if (!changes?.length) return null;
  return (
    <ul className={`moves${dark ? '' : ' moves--light'}`} aria-label="How your mastery changed">
      {changes.map((c) => {
        const up = c.after >= c.before;
        return (
          <li key={c.slug} className="move">
            <span className="move-name">{c.name}</span>
            <span className="move-track">
              <span className="move-before" style={{ width: `${Math.min(c.before, c.after)}%` }} />
              <span className={`move-delta${up ? '' : ' move-delta--down'}`}
                style={{ left: `${Math.min(c.before, c.after)}%`, width: `${Math.abs(c.after - c.before)}%` }} />
            </span>
            <span className="move-value">
              {c.before}% → <strong>{c.after}%</strong>
              {c.newlyMastered && <span className="move-badge">Mastered</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Summary({ history, onAgain }) {
  const right = history.filter((h) => h.correct).length;
  const moved = new Map();
  history.flatMap((h) => h.mastery).forEach((c) => {
    const seen = moved.get(c.slug);
    if (!seen) moved.set(c.slug, { ...c });
    else Object.assign(seen, { after: c.after, newlyMastered: seen.newlyMastered || c.newlyMastered });
  });

  return (
    <DashboardShell title={`${title} — how it went`}>
      <div className="result-score">
        <p className="stat-value big">{right} / {history.length}</p>
        <p className="muted">
          {history.length ? `${moved.size} concept${moved.size === 1 ? '' : 's'} practised` : 'Nothing left to practise right now'}
        </p>
      </div>

      {moved.size > 0 && (
        <>
          <h2 className="h2">What moved</h2>
          <div className="card">
            <MasteryMoves changes={[...moved.values()]} dark={false} />
          </div>
        </>
      )}

      <div className="result-actions note-foot">
        <button className="btn btn--sm" type="button" onClick={onAgain}>Practise again</button>
        <Link className="btn btn--ghost btn--sm" to="/dashboard/student">Back home</Link>
      </div>
    </DashboardShell>
  );
}
