const {
  token, isText, checker, normaliseOutput, scoreOf, GameError,
} = require('./common');

/*
 * Output predictor: read the code, type exactly what it prints.
 *
 * Harder than choosing from options, because there is nothing to recognise.
 * Trailing spaces and line endings do not count; everything else does, which
 * is the point: 3 and 3.0 are different answers.
 */
module.exports = {
  kind: 'predict',
  label: 'Predict the output',

  validate(game, at) {
    const c = checker(at, game.title);
    if (!Array.isArray(game.items) || game.items.length < 2) {
      c.error('needs at least two items');
      return c;
    }
    game.items.forEach((it, i) => {
      if (!it || !isText(it.code)) c.error('"code" is required', `.items[${i}]`);
      else if (typeof it.output !== 'string' || !normaliseOutput(it.output)) {
        c.error('"output" is required', `.items[${i}]`);
      } else if (!isText(it.explanation)) c.warn('no explanation', `.items[${i}]`);
    });
    return c;
  },

  contentOf: (game) => ({ items: game.items }),

  // In the order written: these usually build on each other.
  deliver: (game) => ({
    items: game.content.items.map((it, i) => ({ id: token(game.id, `o${i}`), code: it.code })),
  }),

  /** What the device needs to mark offline, in the same tokens the browser sends. */
  offlineKey(game) {
    const { items } = game.content;
    return {
      output: Object.fromEntries(items.map((it, i) => [token(game.id, `o${i}`), normaliseOutput(it.output)])),
      explanation: Object.fromEntries(items.map((it, i) => [token(game.id, `o${i}`), it.explanation ?? null])),
    };
  },

  /** How many lines it prints: enough to check a trace without giving it away. */
  hint(game, itemId) {
    const it = game.content.items.find((_, i) => token(game.id, `o${i}`) === itemId);
    if (!it) throw new GameError('No such program in this game');
    const n = normaliseOutput(it.output).split('\n').length;
    return { text: `It prints ${n} line${n === 1 ? '' : 's'}.`, maxLevel: 1 };
  },

  /** answers: { [itemId]: "typed output" } */
  mark(game, answers) {
    const feedback = game.content.items.map((it, i) => {
      const typed = answers[token(game.id, `o${i}`)];
      const given = typeof typed === 'string' && normaliseOutput(typed) ? normaliseOutput(typed) : null;
      return {
        prompt: it.code,
        given,
        answer: normaliseOutput(it.output),
        correct: given === normaliseOutput(it.output),
        explanation: it.explanation ?? null,
      };
    });
    return { feedback, score: scoreOf(feedback), maxScore: feedback.length };
  },
};
