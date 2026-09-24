const { token, isText, checker, GameError } = require('./common');

/*
 * Trace Runner: run the program in your head, one line at a time.
 *
 * Tracing is the step beginners find hardest and the best predictor of being
 * able to write code (Lister et al.). Each time a line gives a watched
 * variable a value, the student types that value. Every answer is checked at
 * once and the true value shown, so one slip does not ruin every step after
 * it, and a run of right answers builds a streak.
 *
 * The steps come from running real Python with a tracer
 * (scripts/run-python-games.py), never from typing.
 *
 * answers: { [stepId]: "typed value" }
 */

const MAX_STEPS = 14;

/** Values as Python shows them, forgiving spacing and the choice of quote. */
const normaliseValue = (s) => String(s ?? '')
  .trim()
  .replace(/"/g, "'")
  .replace(/\s+/g, ' ')
  .replace(/\s*([,[\](){}:])\s*/g, '$1');

/** Every step in play order, with its token. */
function stepsOf(game) {
  return game.content.items.flatMap((it, i) => it.steps.map((s, k) => ({
    ...s, item: i, id: token(game.id, `t${i}s${k}`),
  })));
}

module.exports = {
  kind: 'trace',
  label: 'Trace Runner',
  normaliseValue,

  validate(game, at) {
    const c = checker(at, game.title);
    if (!Array.isArray(game.items) || game.items.length < 1) {
      c.error('needs at least one program');
      return c;
    }
    game.items.forEach((it, i) => {
      const where = `.items[${i}]`;
      if (!it || !isText(it.code)) { c.error('"code" is required', where); return; }
      if (!Array.isArray(it.watch) || !it.watch.length || !it.watch.every(isText)) {
        c.error('"watch" must list the variables to trace', where);
      }
      const lineCount = it.code.split('\n').length;
      if (!Array.isArray(it.steps) || !it.steps.length) {
        c.error('"steps" is missing: run scripts/run-python-games.py', where);
        return;
      }
      if (it.steps.length > MAX_STEPS) c.error(`keep it to ${MAX_STEPS} steps or fewer`, where);
      it.steps.forEach((s, k) => {
        if (!s || !Number.isInteger(s.line) || s.line < 1 || s.line > lineCount
          || !it.watch?.includes(s.var) || typeof s.value !== 'string') {
          c.error('each step needs a line in the program, a watched var and a value', `${where}.steps[${k}]`);
        }
      });
      if (!isText(it.explanation)) c.warn('no explanation', where);
    });
    return c;
  },

  contentOf: (game) => ({ items: game.items }),

  // In order: a trace only makes sense from the top.
  deliver: (game) => ({
    items: game.content.items.map((it, i) => ({
      id: token(game.id, `t${i}`),
      lines: it.code.split('\n'),
      watch: it.watch,
      steps: it.steps.map((s, k) => ({ id: token(game.id, `t${i}s${k}`), line: s.line, var: s.var })),
    })),
  }),

  offlineKey(game) {
    const steps = stepsOf(game);
    return {
      shown: Object.fromEntries(steps.map((s) => [s.id, s.value])),
      explanation: Object.fromEntries(game.content.items.map((it, i) => [token(game.id, `t${i}`), it.explanation ?? null])),
    };
  },

  /** { step, value } -> is it right, and the true value to carry on from. */
  check(game, body) {
    const step = stepsOf(game).find((s) => s.id === body.step);
    if (!step) throw new GameError('No such step in this game');
    return { correct: normaliseValue(body.value) === normaliseValue(step.value), value: step.value };
  },

  /** Level 1: the values just before this line runs. */
  hint(game, stepId) {
    const steps = stepsOf(game);
    const at = steps.findIndex((s) => s.id === stepId);
    if (at < 0) throw new GameError('No such step in this game');
    const before = {};
    steps.slice(0, at).filter((s) => s.item === steps[at].item).forEach((s) => { before[s.var] = s.value; });
    const names = Object.keys(before);
    return {
      text: names.length
        ? `Just before this line runs: ${names.map((n) => `${n} = ${before[n]}`).join(', ')}.`
        : 'Nothing you are tracing has a value yet: this is where it starts.',
      maxLevel: 1,
    };
  },

  mark(game, answers) {
    let streak = 0;
    let bestStreak = 0;
    const feedback = game.content.items.flatMap((it, i) => {
      const lines = it.code.split('\n');
      return it.steps.map((s, k) => {
        const typed = answers[token(game.id, `t${i}s${k}`)];
        const given = typeof typed === 'string' && typed.trim() ? typed.trim() : null;
        const correct = given !== null && normaliseValue(given) === normaliseValue(s.value);
        streak = correct ? streak + 1 : 0;
        bestStreak = Math.max(bestStreak, streak);
        return {
          prompt: `${s.line}: ${lines[s.line - 1].trim()}`,
          given: given === null ? null : `${s.var} = ${given}`,
          answer: `${s.var} = ${s.value}`,
          correct,
          program: i,
          explanation: k === it.steps.length - 1 ? it.explanation ?? null : null,
        };
      });
    });
    return {
      feedback,
      score: feedback.filter((f) => f.correct).length,
      maxScore: feedback.length,
      extra: { bestStreak, programs: game.content.items.map((it) => it.code) },
    };
  },
};
