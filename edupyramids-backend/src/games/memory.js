const {
  GameError, token, shuffle, isText, duplicates, checker,
} = require('./common');

/*
 * Memory tiles: flip two at a time to find each piece of code and its output.
 *
 * Whether two tiles match is asked of the server (check), because the tiles
 * carry no pairing the browser could read. The score comes from replaying the
 * moves on submit. Some misses are the game itself, so every pair gets two
 * free misses; after that each two misses cost a point.
 */

function pairIndex(game) {
  const index = new Map();
  game.content.pairs.forEach((_, i) => {
    index.set(token(game.id, `a${i}`), i);
    index.set(token(game.id, `b${i}`), i);
  });
  return index;
}

module.exports = {
  kind: 'memory',
  label: 'Memory tiles',

  validate(game, at) {
    const c = checker(at, game.title);
    if (!Array.isArray(game.pairs) || game.pairs.length < 2) {
      c.error('needs at least two pairs');
      return c;
    }
    game.pairs.forEach((p, i) => {
      if (!p || !isText(p.a) || !isText(p.b)) c.error('"a" and "b" are both required', `.pairs[${i}]`);
      else if (!isText(p.explanation)) c.warn('no explanation', `.pairs[${i}]`);
    });
    duplicates(game.pairs.flatMap((p) => (p ? [p.a, p.b] : [])))
      .forEach((d) => c.error(`"${d}" appears twice, so it could match either`));
    return c;
  },

  contentOf: (game) => ({ pairs: game.pairs }),

  deliver(game) {
    const { pairs } = game.content;
    return {
      pairs: pairs.length,
      tiles: shuffle(pairs.flatMap((p, i) => [
        { id: token(game.id, `a${i}`), text: p.a },
        { id: token(game.id, `b${i}`), text: p.b },
      ])),
    };
  },

  /** body: { first, second } tile ids. Records nothing. */
  check(game, { first, second } = {}) {
    if (typeof first !== 'string' || typeof second !== 'string') {
      throw new GameError('first and second tile ids are required');
    }
    const index = pairIndex(game);
    if (!index.has(first) || !index.has(second)) throw new GameError('Unknown tile');
    const match = first !== second && index.get(first) === index.get(second);
    return { match, explanation: match ? game.content.pairs[index.get(first)].explanation ?? null : null };
  },

  /** What the device needs to check pairs and mark offline. */
  offlineKey(game) {
    const { pairs } = game.content;
    const pairOf = {};
    const side = {};
    pairs.forEach((_, i) => {
      pairOf[token(game.id, `a${i}`)] = i; side[token(game.id, `a${i}`)] = 'a';
      pairOf[token(game.id, `b${i}`)] = i; side[token(game.id, `b${i}`)] = 'b';
    });
    return { pairOf, side, explanation: pairs.map((p) => p.explanation ?? null) };
  },

  /** answers: { moves: [[tileId, tileId], ...] } */
  mark(game, answers) {
    const index = pairIndex(game);
    const { pairs } = game.content;
    const found = new Set();
    let misses = 0;

    const moves = Array.isArray(answers.moves) ? answers.moves : [];
    for (const move of moves.slice(0, 500)) {
      if (!Array.isArray(move) || move.length !== 2) continue;
      const [a, b] = move;
      if (!index.has(a) || !index.has(b) || a === b) continue;
      if (found.has(index.get(a)) || found.has(index.get(b))) continue;
      if (index.get(a) === index.get(b)) found.add(index.get(a));
      else misses += 1;
    }

    const penalty = Math.floor(Math.max(0, misses - 2 * pairs.length) / 2);
    const feedback = pairs.map((p, i) => ({
      prompt: p.a,
      given: found.has(i) ? p.b : null,
      answer: p.b,
      correct: found.has(i),
      explanation: p.explanation ?? null,
    }));
    return {
      feedback,
      score: Math.max(0, found.size - penalty),
      maxScore: pairs.length,
      extra: { misses },
    };
  },
};
