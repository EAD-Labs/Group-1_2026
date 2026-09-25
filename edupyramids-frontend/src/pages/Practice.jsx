import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import DashboardShell from '../components/DashboardShell';
import { client } from '../api/client';
import { useApi } from '../utils/useApi';

const LETTERS = ['a', 'b', 'c', 'd', 'e'];
const SESSION_LENGTH = 10;
const MAX_LENGTH = 20;

/*
 * Practice: a hub of ways to practise, and the session itself.
 *
 *   /practice                          the hub: choose how to practise
 *   /practice?mode=mix                 ten questions picked by the mastery model
 *   /practice?mode=mistakes            wrong answers, until they are put right
 *   /practice?focus=a,b&n=5            one or more concepts (a repair, or a pick)
 *
 * Choosing is the student's; the model only suggests (HLD Section 6.3), and a
 * choice of how to practise supports autonomy (self-determination theory).
 */
export default function Practice() {
  const [params] = useSearchParams();
  const mode = params.get('mode') === 'mistakes' ? 'mistakes' : 'mix';
  const focus = params.get('focus') || '';
  if (!params.get('mode') && !focus) return <PracticeHub />;

  const length = Math.min(MAX_LENGTH, Math.max(1, Number(params.get('n')) || SESSION_LENGTH));
  let title = 'Smart mix';
  if (mode === 'mistakes') title = 'Fix my mistakes';
  else if (focus) title = params.get('kind') === 'focus' ? 'Focus' : 'Repair';
  return <Session key={params.toString()} mode={mode} focus={focus} length={length} title={title} />;
}

const STATUS_LABEL = {
  new: 'Not started', learning: 'Learning', mastered: 'Mastered', review: 'Fading: repair it',
};

/** The hub: four ways in, and every concept with its video. */
function PracticeHub() {
  const { loading, error, data } = useApi(['/practice/overview']);
  if (loading || error) {
    return (
      <DashboardShell title="Practice">
        {error ? <p className="alert" role="alert">{error}</p> : <p className="muted">Loading…</p>}
      </DashboardShell>
    );
  }
  const [{ concepts, mistakes }] = data;
  const practisable = concepts.filter((c) => c.questions > 0);
  const due = practisable.filter((c) => c.status === 'review');

  return (
    <DashboardShell title="Practice">
      <p className="page-intro muted">Questions picked from everything you have answered. Choose how you want to practise.</p>

      <div className="modes">
        <Link className="mode mode--mix" to="/practice?mode=mix">
          <span className="mode-icon" aria-hidden="true">🎯</span>
          <span className="mode-title">Smart mix</span>
          <span className="mode-sub">10 questions picked for you: what is due, then where you can grow most</span>
        </Link>
        {due.length > 0 ? (
          <Link className="mode mode--repair" to={`/practice?focus=${due.map((c) => c.slug).join(',')}&n=5`}>
            <span className="mode-icon" aria-hidden="true">🔨</span>
            <span className="mode-title">Repair fading <span className="mode-count">{due.length}</span></span>
            <span className="mode-sub">{due.map((c) => c.name).join(', ')}</span>
          </Link>
        ) : (
          <span className="mode mode--off">
            <span className="mode-icon" aria-hidden="true">🔨</span>
            <span className="mode-title">Repair fading</span>
            <span className="mode-sub">Nothing is fading. Mastered concepts come back here when they are due.</span>
          </span>
        )}
        {mistakes > 0 ? (
          <Link className="mode mode--mistakes" to={`/practice?mode=mistakes&n=${Math.min(10, mistakes)}`}>
            <span className="mode-icon" aria-hidden="true">❌</span>
            <span className="mode-title">Fix my mistakes <span className="mode-count">{mistakes}</span></span>
            <span className="mode-sub">Questions you got wrong and have not got right since</span>
          </Link>
        ) : (
          <span className="mode mode--off">
            <span className="mode-icon" aria-hidden="true">❌</span>
            <span className="mode-title">Fix my mistakes</span>
            <span className="mode-sub">No mistakes waiting. Wrong answers collect here to try again.</span>
          </span>
        )}
      </div>

      <h2 className="h2">Or pick a concept</h2>
      <ul className="concept-picks">
        {practisable.map((c) => (
          <li key={c.slug} className={`concept-pick concept-pick--${c.status}`}>
            <span className="concept-pick-head">
              <span className="concept-pick-name">{c.name}</span>
              <span className="concept-pick-status">{STATUS_LABEL[c.status] || c.status}</span>
            </span>
            <span className="concept-bar"><span style={{ width: `${c.p}%` }} /></span>
            <span className="concept-pick-foot">
              <span className="muted small">
                {c.p}% sure{c.waitingOn.length > 0 && ` · builds on ${c.waitingOn.join(' and ')}`}
              </span>
              <span className="concept-pick-actions">
                {c.videos[0] && (
                  <a className="concept-pick-video" href={c.videos[0].url} target="_blank" rel="noreferrer"
                    title={`${c.videos[0].title} (${c.videos[0].duration}), Spoken Tutorial`}>
                    📺 Watch
                  </a>
                )}
                <Link className="btn btn--sm" to={`/practice?focus=${c.slug}&n=5&kind=focus`}>Practise</Link>
              </span>
            </span>
          </li>
        ))}
      </ul>
    </DashboardShell>
  );
}

/*
 * One session, a question at a time, each picked by the mastery model.
 *
 * The screen shows its working. Every question says why it was chosen and
 * what the model expects, and every answer shows the estimate moving, because
 * a student who can see why the app does something is more likely to trust
 * it — and a teacher or examiner can check that it does what it claims.
 */
function Session({
  mode, focus, length, title,
}) {
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
      const res = await client.get(`/practice/next?exclude=${exclude.join(',')}${focus ? `&focus=${encodeURIComponent(focus)}` : ''}${mode === 'mistakes' ? '&mode=mistakes' : ''}`);
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

  if (finished) return <Summary title={title} history={history} onAgain={again} />;

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
            {verdict.revisit && (
              <p className="revisit-video">
                <span aria-hidden="true">📺</span> Rewatch the lesson:{' '}
                <a href={verdict.revisit.url} target="_blank" rel="noreferrer">{verdict.revisit.title}</a>
                {' '}<span className="muted-on-dark">({verdict.revisit.duration}, Spoken Tutorial)</span>
              </p>
            )}
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

function Summary({ title, history, onAgain }) {
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
        <Link className="btn btn--ghost btn--sm" to="/practice">Other ways to practise</Link>
      </div>
    </DashboardShell>
  );
}
