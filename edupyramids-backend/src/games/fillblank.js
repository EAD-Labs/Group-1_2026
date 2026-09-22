const {
  token, shuffle, isText, checker,
} = require('./common');

/*
 * Fill the blank: code with gaps (written ___ in the content), and chips to
 * fill them. Some chips are decoys.
 * Score: one point per blank filled correctly.
 */
const BLANK = '___';

const fill = (code, values) => code.split(BLANK)
  .map((part, i, parts) => (i < parts.length - 1 ? `${part}${values[i] ?? BLANK}` : part))
  .join('');

module.exports = {
  kind: 'fillblank',
  label: 'Fill the blank',

  validate(game, at) {
    const c = checker(at, game.title);
    if (!Array.isArray(game.items) || game.items.length < 1) {
      c.error('needs at least one item');
      return c;
    }
    game.items.forEach((it, i) => {
      const where = `.items[${i}]`;
      if (!it || !isText(it.code)) { c.error('"code" is required', where); return; }
      const gaps = it.code.split(BLANK).length - 1;
      if (gaps < 1) c.error(`the code needs at least one ${BLANK}`, where);
      if (!Array.isArray(it.blanks) || it.blanks.length !== gaps || !it.blanks.every(isText)) {
        c.error(`"blanks" needs exactly ${gaps} answer${gaps === 1 ? '' : 's'}, one per ${BLANK}`, where);
      }
      if (!Array.isArray(it.decoys) || !it.decoys.every(isText)) {
        c.error('"decoys" must be a list of wrong chips', where);
      } else if (it.decoys.some((d) => (it.blanks || []).includes(d))) {
        c.error('a decoy is also a right answer', where);
      } else if (it.decoys.length < 1) {
        c.error('needs at least one decoy, or there is nothing to decide', where);
      }
      if (!isText(it.explanation)) c.warn('no explanation', where);
    });
    return c;
  },

  contentOf: (game) => ({ items: game.items }),

  deliver: (game) => ({
    items: game.content.items.map((it, i) => ({
      id: token(game.id, `f${i}`),
      parts: it.code.split(BLANK),
      chips: shuffle([...new Set([...it.blanks, ...it.decoys])]),
    })),
  }),

  /** What the device needs to mark offline, in the same tokens the browser sends. */
  offlineKey(game) {
    const { items } = game.content;
    return {
      blanks: Object.fromEntries(items.map((it, i) => [token(game.id, `f${i}`), it.blanks])),
      explanation: Object.fromEntries(items.map((it, i) => [token(game.id, `f${i}`), it.explanation ?? null])),
    };
  },

  /** answers: { [itemId]: ["chip for blank 1", "chip for blank 2", ...] } */
  mark(game, answers) {
    let score = 0;
    let maxScore = 0;
    const feedback = game.content.items.map((it, i) => {
      const given = Array.isArray(answers[token(game.id, `f${i}`)]) ? answers[token(game.id, `f${i}`)] : [];
      const right = it.blanks.filter((b, k) => given[k] === b).length;
      score += right;
      maxScore += it.blanks.length;
      return {
        prompt: it.code,
        given: given.some((g) => typeof g === 'string') ? fill(it.code, given.map((g) => (typeof g === 'string' ? g : undefined))) : null,
        answer: fill(it.code, it.blanks),
        correct: right === it.blanks.length,
        partial: right > 0 && right < it.blanks.length,
        explanation: it.explanation ?? null,
      };
    });
    return { feedback, score, maxScore };
  },
};
