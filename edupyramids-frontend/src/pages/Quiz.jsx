import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import DashboardShell from '../components/DashboardShell';
import { client } from '../api/client';
import { auth } from '../utils/auth';
import { MasteryMoves } from './Practice';
import { findQuiz, quizForPlay } from '../offline/pack';
import { checkQuestion, markQuiz } from '../offline/markers';
import { enqueue } from '../offline/outbox';

const LETTERS = ['a', 'b', 'c', 'd', 'e'];

/*
 * Where an unfinished quiz is kept.
 *
 * Per user as well as per quiz, so two people sharing a computer — which the
 * pilot expects — do not resume into each other's answers. Cleared on submit.
 * localStorage, not the server: nothing is worth recording until the attempt is
 * finished, which is the same rule the marking follows.
 */
const progressKey = (quizId) =>
  `edupyramids.quiz.${auth.getCurrentUser()?.id ?? 'anon'}.${quizId}`;

function loadProgress(quizId) {
  try {
    return JSON.parse(localStorage.getItem(progressKey(quizId))) || null;
  } catch {
    return null;
  }
}

/*
 * One question at a time, as in the Week 2 wireframe.
 *
 * Nothing is sent until the student presses Finish, so leaving half way through
 * records nothing. The result screen is where the correct answers first arrive:
 * the quiz payload never contains them.
 */
export default function Quiz() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [quiz, setQuiz] = useState(null);
  const [error, setError] = useState(null);
  const saved = useMemo(() => loadProgress(id), [id]);
  const [at, setAt] = useState(saved?.at ?? 0);
  const [answers, setAnswers] = useState(saved?.answers ?? {});
  const [resumed, setResumed] = useState(Boolean(saved?.answers
    && Object.keys(saved.answers).length));
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  // questionId -> { correct, correctAnswer, explanation }, filled the moment
  // the student picks. Answering is one-shot: once told, the choice is locked.
  const [verdicts, setVerdicts] = useState(saved?.verdicts ?? {});

  // Keep the unfinished attempt where the student left it.
  useEffect(() => {
    if (result) return;
    try {
      localStorage.setItem(progressKey(id), JSON.stringify({ at, answers, verdicts }));
    } catch { /* private window, or storage full: resuming is a convenience */ }
  }, [id, at, answers, verdicts, result]);

  function startAgain() {
    try { localStorage.removeItem(progressKey(id)); } catch { /* ignore */ }
    setAt(0); setAnswers({}); setVerdicts({}); setResumed(false);
  }

  // Made once, when the quiz opens. Sending it with the answers is what makes a
  // double submit record one attempt instead of two.
  const clientAttemptId = useMemo(() => crypto.randomUUID(), []);

  // Set when the quiz came from the offline pack: marking then happens on
  // the device, and the attempt waits in the outbox until there is a network.
  const offlineQuiz = useMemo(() => findQuiz(id), [id]);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let live = true;
    client.get(`/quizzes/${id}`)
      .then((res) => live && setQuiz(res.data))
      .catch((err) => {
        if (!live) return;
        if (err.status === 0 && offlineQuiz) {
          setOffline(true);
          setQuiz(quizForPlay(offlineQuiz));
        } else {
          setError(err.status === 0
            ? 'You are offline, and this quiz has not been downloaded. Turn on offline use under Progress while connected.'
            : err.message);
        }
      });
    return () => { live = false; };
  }, [id, offlineQuiz]);

  if (error) {
    return (
      <DashboardShell title="Quiz" back={{ to: '/dashboard/student', label: 'Path' }}>
        <p className="alert" role="alert">{error}</p>
        <Link className="btn btn--sm" to="/dashboard/student">Back to the path</Link>
      </DashboardShell>
    );
  }

  if (!quiz) {
    return <DashboardShell title="Quiz" back={{ to: '/dashboard/student', label: 'Path' }}><p className="muted">Loading…</p></DashboardShell>;
  }

  if (result) return <Result quiz={quiz} result={result} />;

  const questions = quiz.questions;
  const question = questions[at];
  const verdict = verdicts[question.id];
  const rightSoFar = Object.values(verdicts).filter((v) => v.correct).length;

  async function choose(letter) {
    if (verdicts[question.id]) return;                 // already answered
    setAnswers((a) => ({ ...a, [question.id]: letter }));
    const onDevice = () => (offlineQuiz ? checkQuestion(offlineQuiz, question.id, letter) : null);
    try {
      if (offline) throw Object.assign(new Error('offline'), { status: 0 });
      const res = await client.post(`/quizzes/${id}/check`,
        { questionId: question.id, answer: letter });
      setVerdicts((v) => ({ ...v, [question.id]: res.data }));
    } catch {
      // No connection: mark on the device if the quiz was downloaded. If not,
      // the answer still stands and is marked on submit; the student just
      // does not get told early.
      const local = onDevice();
      setVerdicts((v) => ({ ...v, [question.id]: local || { unavailable: true } }));
    }
  }
  const answered = Object.keys(answers).length;
  const last = at === questions.length - 1;

  async function finish() {
    setSending(true);
    const body = { answers, clientAttemptId, answeredAt: new Date().toISOString() };
    try {
      if (offline) throw Object.assign(new Error('offline'), { status: 0 });
      const res = await client.post(`/quizzes/${id}/attempts`, body);
      try { localStorage.removeItem(progressKey(id)); } catch { /* ignore */ }
      setResult(res.data);
    } catch (err) {
      if (err.status === 0 && offlineQuiz) {
        // Marked here for the student now; uploaded and marked again later.
        enqueue({ path: `/quizzes/${id}/attempts`, body, title: offlineQuiz.title });
        try { localStorage.removeItem(progressKey(id)); } catch { /* ignore */ }
        setResult({ ...markQuiz(offlineQuiz, answers), savedOffline: true });
      } else {
        setError(err.message);
      }
    } finally {
      setSending(false);
    }
  }

  return (
    // Leaving is safe: answers so far are kept, so the note says so rather than
    // making the student guess whether they are about to lose them.
    <DashboardShell title={quiz.topic} wide back={{ to: '/dashboard/student', label: 'Path' }}
      note={answered > 0 ? 'Your answers are saved' : undefined}>

      <div className="quiz">
        <div className="quiz-top">
          <p className="quiz-topic">{quiz.title}</p>
          <div className="quiz-meta">
            {rightSoFar > 0 && (
              <span className="tally" key={rightSoFar}>
                <span aria-hidden="true">✔</span> {rightSoFar} right
              </span>
            )}
            <p className="quiz-count">{at + 1}<span>/{questions.length}</span></p>
          </div>
        </div>

        {/* One dash per question: done, current, still to come. Reads at a
            glance in a way a single bar does not. */}
        <ol className="pips" aria-label={`Question ${at + 1} of ${questions.length}`}>
          {questions.map((q, i) => {
            const v = verdicts[q.id];
            const state = v ? (v.unavailable ? 'done' : (v.correct ? 'right' : 'wrong'))
              : (i === at ? 'now' : 'todo');
            return <li key={q.id} className={`pip pip--${state}`} />;
          })}
        </ol>


        <fieldset className="quiz-q">
          <legend className="quiz-text">{question.text}</legend>

          <div className="option-grid">
          {LETTERS.map((letter) => {
            const label = question[`option${letter.toUpperCase()}`];
            if (!label) return null;
            const checked = answers[question.id] === letter;
            // Once answered: mark the right one, and mark their wrong pick.
            let state = '';
            if (verdict && !verdict.unavailable) {
              if (letter === verdict.correctAnswer) state = ' option--right';
              else if (checked) state = ' option--wrong';
            }
            return (
              <label
                key={letter}
                className={`option${checked ? ' option--on' : ''}${state}`}
              >
                <input
                  type="radio"
                  name={`q${question.id}`}
                  value={letter}
                  checked={checked}
                  disabled={Boolean(verdict)}
                  onChange={() => choose(letter)}
                />
                <span className="option-letter" aria-hidden="true">
                  {letter.toUpperCase()}
                </span>
                <span className="option-text">{label}</span>
                {state === ' option--right' && <span className="option-tag">Correct</span>}
                {state === ' option--wrong' && <span className="option-tag">Your answer</span>}
              </label>
            );
          })}
          </div>
        </fieldset>

        {verdict && !verdict.unavailable && (
          <p className={`verdict ${verdict.correct ? 'verdict--ok' : 'verdict--no'}`} role="status">
            <strong>{verdict.correct ? 'Correct' : 'Not correct'}</strong>
            {verdict.explanation
              ? ` — ${verdict.explanation}`
              : !verdict.correct && ' — the right answer is highlighted above.'}
          </p>
        )}

        <div className="quiz-nav">
          <button className="btn btn--ghost btn--sm" type="button"
            onClick={() => setAt(at - 1)} disabled={at === 0}>
            Back
          </button>

          {last ? (
            <button className="btn btn--sm" type="button" onClick={finish} disabled={sending}>
              {sending && <span className="spinner" aria-hidden="true" />}
              {sending ? 'Marking…' : 'Finish'}
            </button>
          ) : (
            <button className="btn btn--sm" type="button" onClick={() => setAt(at + 1)}>
              Next
            </button>
          )}
        </div>

        {resumed && (
          <p className="resumed">
            Carried on from where you left off.
            <button type="button" className="linkish" onClick={startAgain}>
              Start again
            </button>
          </p>
        )}

        <p className="muted small">
          {answered} of {questions.length} answered.
          {answered < questions.length && ' Anything left blank counts as wrong.'}
          {verdict && ' You cannot change an answer once it is marked.'}
        </p>
      </div>
    </DashboardShell>
  );
}

/** The text of an option, given its letter. */
function optionText(question, letter) {
  if (!question || !letter) return letter || '';
  return question[`option${letter.toUpperCase()}`] || letter;
}

function Result({ quiz, result }) {
  // Counts up to the score. Honours a request for less movement by landing on
  // the number straight away (HLD Section 6.3).
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still || result.score === 0) { setShown(result.score); return undefined; }
    let n = 0;
    const step = setInterval(() => {
      n += 1;
      setShown(n);
      if (n >= result.score) clearInterval(step);
    }, Math.min(420 / result.score, 90));
    return () => clearInterval(step);
  }, [result.score]);

  return (
    <DashboardShell title={`${quiz.topic} — your result`} back={{ to: '/dashboard/student', label: 'Path' }}>
      {result.savedOffline && (
        <p className="offline-note" role="status">
          Marked on this device. It will be saved to your record when you are next online.
        </p>
      )}
      <div className="result-score">
        <p className="stat-value big">{shown} / {result.maxScore}</p>
        <p className="muted">{result.percent}%
          {result.unanswered > 0 && ` · ${result.unanswered} left blank, counted wrong`}
        </p>
      </div>

      {result.revisit.length > 0 && (
        <p className="revisit"><strong>Worth another look:</strong> {result.revisit.join(', ')}</p>
      )}

      {result.mastery?.length > 0 && (
        <>
          <h2 className="h2">What moved</h2>
          <div className="card">
            <MasteryMoves changes={result.mastery} dark={false} />
          </div>
        </>
      )}

      <h2 className="h2">Every question</h2>
      <ol className="feedback">
        {result.feedback.map((f, i) => {
          const q = quiz.questions.find((x) => x.id === f.questionId);
          return (
            <li key={f.questionId} className={f.correct ? 'fb fb--ok' : 'fb fb--no'}>
              <p className="fb-head">
                <span className="fb-mark">{f.correct ? 'Correct' : 'Not correct'}</span>
                <span className="muted small">Question {i + 1} · {f.topic}</span>
              </p>
              <p className="fb-q">{q?.text}</p>
              {!f.correct && (
                // Named by their text, not by their letter. The options are not
                // labelled a/b/c/d on screen, so "the answer is b" would mean
                // nothing to the student reading this.
                <p className="fb-a">
                  {f.answered
                    ? <>You chose <strong>{optionText(q, f.given)}</strong>. </>
                    : <>You left this blank. </>}
                  The answer is <strong>{optionText(q, f.correctAnswer)}</strong>.
                </p>
              )}
              {/* The explanation is the point of the screen: a score alone does
                  not tell a student what to do next. */}
              {f.explanation && <p className="fb-why">{f.explanation}</p>}
            </li>
          );
        })}
      </ol>

      <Link className="btn btn--sm" to="/dashboard/student">Back to the path</Link>
    </DashboardShell>
  );
}
