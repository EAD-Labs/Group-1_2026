const {
  token, shuffle, isText, duplicates, checker,
} = require('./common');

/*
 * Bug hunt: each short program has one bug. Tap the line, then pick the fix.
 * Score: a point for the right line, and a second for the right fix on it.
 */
module.exports = {
  kind: 'bughunt',
  label: 'Bug hunt',

  validate(game, at) {
    const c = checker(at, game.title);
    if (!Array.isArray(game.items) || game.items.length < 1) {
      c.error('needs at least one program');
      return c;
    }
    game.items.forEach((it, i) => {
      const where = `.items[${i}]`;
      if (!it || !isText(it.code)) { c.error('"code" is required', where); return; }
      const lineCount = it.code.split('\n').length;
      if (lineCount < 2) c.error('the program needs at least two lines', where);
      if (!Number.isInteger(it.bugLine) || it.bugLine < 1 || it.bugLine > lineCount) {
        c.error(`"bugLine" must be a line number from 1 to ${lineCount}`, where);
      }
      if (!Array.isArray(it.fixes) || it.fixes.length < 2 || it.fixes.length > 4 || !it.fixes.every(isText)) {
        c.error('"fixes" needs 2 to 4 replacement lines', where);
      } else {
        duplicates(it.fixes).forEach((d) => c.error(`fix "${d}" appears twice`, where));
        if (!Number.isInteger(it.fix) || it.fix < 0 || it.fix >= it.fixes.length) {
          c.error('"fix" must be the index of the right fix', where);
        }
      }
      if (!isText(it.explanation)) c.warn('no explanation', where);
    });
    return c;
  },

  contentOf: (game) => ({ items: game.items }),

  deliver: (game) => ({
    items: game.content.items.map((it, i) => ({
      id: token(game.id, `b${i}`),
      lines: it.code.split('\n'),
      fixes: shuffle(it.fixes.map((f, k) => ({ id: token(game.id, `b${i}f${k}`), text: f }))),
    })),
  }),

  /** What the device needs to mark offline, in the same tokens the browser sends. */
  offlineKey(game) {
    const { items } = game.content;
    return {
      bugLine: Object.fromEntries(items.map((it, i) => [token(game.id, `b${i}`), it.bugLine])),
      fix: Object.fromEntries(items.map((it, i) => [token(game.id, `b${i}`), token(game.id, `b${i}f${it.fix}`)])),
      explanation: Object.fromEntries(items.map((it, i) => [token(game.id, `b${i}`), it.explanation ?? null])),
    };
  },

  /** answers: { [itemId]: { line: 1-based number, fix: fixId } } */
  mark(game, answers) {
    let score = 0;
    const feedback = game.content.items.map((it, i) => {
      const a = answers[token(game.id, `b${i}`)] || {};
      const lineOk = a.line === it.bugLine;
      const fixIndex = it.fixes.findIndex((_, k) => token(game.id, `b${i}f${k}`) === a.fix);
      const fixOk = lineOk && fixIndex === it.fix;
      score += (lineOk ? 1 : 0) + (fixOk ? 1 : 0);
      return {
        prompt: it.code,
        given: Number.isInteger(a.line)
          ? `Line ${a.line}${fixIndex >= 0 ? ` → ${it.fixes[fixIndex]}` : ''}`
          : null,
        answer: `Line ${it.bugLine} → ${it.fixes[it.fix]}`,
        correct: fixOk,
        partial: lineOk && !fixOk,
        explanation: it.explanation ?? null,
      };
    });
    return { feedback, score, maxScore: game.content.items.length * 2 };
  },
};
