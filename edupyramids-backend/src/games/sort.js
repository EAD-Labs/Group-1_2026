const { token, shuffle, isText, duplicates, checker, scoreOf } = require('./common');

/*
 * Sorting: put each card in the right group.
 * Score: one point per card in the right group; a card left out is wrong.
 *
 * Stored as kind "drag_drop", the name it had before tapping was added.
 */
module.exports = {
  kind: 'drag_drop',
  label: 'Sorting',

  validate(game, at) {
    const c = checker(at, game.title);
    if (!Array.isArray(game.buckets) || game.buckets.length < 2 || !game.buckets.every(isText)) {
      c.error('needs at least two named buckets');
      return c;
    }
    duplicates(game.buckets).forEach((d) => c.error(`bucket "${d}" appears twice`));
    if (!Array.isArray(game.items) || game.items.length < 2) {
      c.error('needs at least two items');
      return c;
    }
    game.items.forEach((item, i) => {
      if (!item || !isText(item.text)) c.error('"text" is required', `.items[${i}]`);
      else if (!game.buckets.includes(item.bucket)) {
        c.errors.push(`${at}.items[${i}]: bucket "${item.bucket}" is not one of this game's buckets`);
      } else if (!isText(item.explanation)) c.warn('no explanation', `.items[${i}]`);
    });
    duplicates(game.items.map((i) => i?.text)).forEach((d) => c.error(`item "${d}" appears twice`));
    return c;
  },

  contentOf: (game) => ({ buckets: game.buckets, items: game.items }),

  deliver(game) {
    const { buckets, items } = game.content;
    return {
      buckets,
      items: shuffle(items.map((it, i) => ({ id: token(game.id, `i${i}`), text: it.text }))),
    };
  },

  /** answers: { [itemId]: bucketName } */
  mark(game, answers) {
    const { buckets, items } = game.content;
    const feedback = items.map((it, i) => {
      const given = answers[token(game.id, `i${i}`)] ?? null;
      return {
        prompt: it.text,
        given: buckets.includes(given) ? given : null,
        answer: it.bucket,
        correct: given === it.bucket,
        explanation: it.explanation ?? null,
      };
    });
    return { feedback, score: scoreOf(feedback), maxScore: items.length };
  },
};
