import { useEffect, useRef, useState } from 'react';
import { client } from '../../api/client';
import { checkTrace } from '../../offline/markers';
import Pyra from '../../components/Pyra';
import Hint from '../Hint';

/*
 * Trace Runner: run Pyra's program in your head, one step at a time.
 *
 * The line about to run is highlighted. Each time it gives a watched variable
 * a value, the student types that value. It is checked at once (by the
 * server, or the downloaded key offline) and the true value goes into the
 * variables panel either way, so one slip does not spoil the steps after it.
 * Right answers in a row make a streak. The answers are sent at the end and
 * the server marks them again.
 */
export default function TraceBoard({ game, onFinish, sending, hint }) {
  const steps = game.items.flatMap((it, p) => it.steps.map((s) => ({ ...s, program: p })));
  const [at, setAt] = useState(0);
  const [typed, setTyped] = useState('');
  const [answers, setAnswers] = useState({});
  const [known, setKnown] = useState({});         // program -> { var: value }
  const [last, setLast] = useState(null);         // { correct, value, var }
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const input = useRef(null);

  const done = at >= steps.length;
  const step = steps[Math.min(at, steps.length - 1)];

  useEffect(() => { if (!done) input.current?.focus(); }, [at, done]);

  async function check(e) {
    e.preventDefault();
    if (!typed.trim() || busy || done) return;
    setBusy(true);
    setError(null);
    try {
      let data;
      try {
        if (game.offline) throw Object.assign(new Error('offline'), { status: 0 });
        ({ data } = await client.post(`/games/${game.id}/check`, { step: step.id, value: typed }));
      } catch (err) {
        if (err.status !== 0 || !game.key) throw err;
        data = checkTrace(game, step.id, typed);
      }
      setAnswers((a) => ({ ...a, [step.id]: typed }));
      setKnown((k) => ({ ...k, [step.program]: { ...(k[step.program] || {}), [step.var]: data.value } }));
      setLast({ ...data, var: step.var });
      const now = data.correct ? streak + 1 : 0;
      setStreak(now);
      setBest((b) => Math.max(b, now));
      setTyped('');
      setAt((n) => n + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const showing = done ? game.items.length - 1 : step.program;
  const shownProgram = game.items[showing];
  const shownVars = known[showing] || {};

  return (
    <>
      <Pyra mood={last ? (last.correct ? 'happy' : 'oops') : 'hello'} small>
        {last
          ? (last.correct ? `Yes! ${last.var} is ${last.value}.` : `Not quite: ${last.var} is ${last.value}. Carry on from there.`)
          : 'I will run my program one line at a time. Tell me what each variable becomes.'}
      </Pyra>

      <p className="board-status" aria-live="polite">
        Program {showing + 1} of {game.items.length} · step {Math.min(at + 1, steps.length)} of {steps.length}
        {streak > 1 && <span className="trace-streak"> · 🔥 {streak} in a row</span>}
      </p>

      <div className="trace">
        <div className="trace-code" aria-label={`Program ${showing + 1}`}>
          {shownProgram.lines.map((line, k) => {
            const current = !done && step.line === k + 1;
            return (
              <div key={k} className={`trace-line${current ? ' trace-line--now' : ''}`}>
                <span className="trace-line-n">{k + 1}</span>
                <code>{line || ' '}</code>
              </div>
            );
          })}
        </div>

        <div className="trace-side">
          <h3 className="parsons-head">Variables</h3>
          <dl className="trace-vars">
            {shownProgram.watch.map((name) => (
              <div key={name} className="trace-var">
                <dt>{name}</dt>
                <dd>{name in shownVars ? <code>{shownVars[name]}</code> : <span className="muted-on-dark">not set</span>}</dd>
              </div>
            ))}
          </dl>

          {!done ? (
            <form className="trace-ask" onSubmit={check}>
              <label htmlFor="trace-value">
                Line {step.line} runs. <strong>{step.var}</strong> becomes:
              </label>
              <div className="trace-row">
                <input id="trace-value" ref={input} value={typed} autoComplete="off" spellCheck={false}
                  autoCapitalize="off" autoCorrect="off" onChange={(e) => setTyped(e.target.value)} disabled={busy || sending} />
                <button className="btn btn--sm" type="submit" disabled={!typed.trim() || busy}>Check</button>
              </div>
              {error && <p className="hint-text hint-text--error">{error}</p>}
              <Hint key={step.id} ask={hint} item={step.id} disabled={busy} label="What are the values now?" />
            </form>
          ) : (
            <p className="trace-done">Program finished! Best streak: {best}.</p>
          )}
        </div>
      </div>

      <div className="quiz-nav">
        <span />
        <button className="btn btn--sm" type="button" disabled={!done || sending} onClick={() => onFinish(answers)}>
          {sending ? 'Checking…' : done ? 'See my result' : `${steps.length - at} step${steps.length - at === 1 ? '' : 's'} to go`}
        </button>
      </div>
    </>
  );
}
