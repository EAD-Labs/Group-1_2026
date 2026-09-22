const { token, shuffle, isText, duplicates, checker, scoreOf } = require('./common');

/*
 * Matching: pair each piece of code on the left with its answer on the right.
 * Score: one point per correct pair.
 */
module.exports = {
  kind: 'matching',
  label: 'Matching',

  validate(game, at) {
    const c = checker(at, game.title);
    if (!Array.isArray(game.pairs) || game.pairs.length < 2) {
      c.error('needs at least two pairs');
      return c;
    }
    game.pairs.forEach((p, i) => {
      if (!p || !isText(p.left) || !isText(p.right)) c.error('"left" and "right" are both required', `.pairs[${i}]`);
      else if (!isText(p.explanation)) c.warn('no explanation', `.pairs[${i}]`);
    });
    // Two answers with the same text would make a right answer look wrong.
    [game.pairs.map((p) => p?.left), game.pairs.map((p) => p?.right)].forEach((side) => {
      duplicates(side).forEach((d) => c.error(`"${d}" appears twice, so it could match either`));
    });
    return c;
  },

  contentOf: (game) => ({ pairs: game.pairs }),

  deliver(game) {
    const { pairs } = game.content;
    return {
      lefts: shuffle(pairs.map((p, i) => ({ id: token(game.id, `l${i}`), text: p.left }))),
      rights: shuffle(pairs.map((p, i) => ({ id: token(game.id, `r${i}`), text: p.right }))),
    };
  },

  /** answers: { [leftId]: rightId } */
  mark(game, answers) {
    const { pairs } = game.content;
    const rightText = new Map(pairs.map((p, i) => [token(game.id, `r${i}`), p.right]));
    const feedback = pairs.map((p, i) => {
      const given = answers[token(game.id, `l${i}`)] ?? null;
      return {
        prompt: p.left,
        given: given === null ? null : rightText.get(given) ?? null,
        answer: p.right,
        correct: given === token(game.id, `r${i}`),
        explanation: p.explanation ?? null,
      };
    });
    return { feedback, score: scoreOf(feedback), maxScore: pairs.length };
  },
};
