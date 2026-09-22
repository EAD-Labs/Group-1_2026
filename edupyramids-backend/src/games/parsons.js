const { token, shuffle, isText, duplicates, checker } = require('./common');

/*
 * Parsons puzzle: put scrambled lines of a working program in order, with the
 * right indentation. Some puzzles add distractor lines that do not belong.
 *
 * Marking follows the usual Parsons grading: the longest run of lines that
 * are in the right relative order and at the right indent, so one misplaced
 * line costs one point rather than everything after it. Each distractor used
 * costs a point.
 */

const MAX_INDENT = 4;
const INDENT = '    ';

const render = (lines) => lines.map((l) => `${INDENT.repeat(l.indent)}${l.code}`).join('\n');

/** Longest common subsequence of two key lists, with the matched positions in `b`. */
function lcs(a, b) {
  const t = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      t[i][j] = a[i - 1] === b[j - 1] ? t[i - 1][j - 1] + 1 : Math.max(t[i - 1][j], t[i][j - 1]);
    }
  }
  const matched = new Set();
  for (let i = a.length, j = b.length; i > 0 && j > 0;) {
    if (a[i - 1] === b[j - 1]) { matched.add(j - 1); i -= 1; j -= 1; } else if (t[i - 1][j] >= t[i][j - 1]) i -= 1; else j -= 1;
  }
  return { length: t[a.length][b.length], matched };
}

module.exports = {
  kind: 'parsons',
  label: 'Parsons puzzle',

  validate(game, at) {
    const c = checker(at, game.title);
    if (!Array.isArray(game.lines) || game.lines.length < 3) {
      c.error('needs at least three lines');
      return c;
    }
    game.lines.forEach((l, i) => {
      if (!l || !isText(l.code)) c.error('"code" is required', `.lines[${i}]`);
      else if (!Number.isInteger(l.indent) || l.indent < 0 || l.indent > MAX_INDENT) {
        c.error(`"indent" must be a whole number from 0 to ${MAX_INDENT}`, `.lines[${i}]`);
      } else if (i === 0 ? l.indent !== 0 : l.indent > game.lines[i - 1].indent + 1) {
        c.error('indents one level deeper than the line before it at most, starting from 0', `.lines[${i}]`);
      }
    });
    const distractors = game.distractors ?? [];
    if (!Array.isArray(distractors) || !distractors.every(isText)) c.error('"distractors" must be a list of lines');
    // Two identical lines could go in either place, so one right answer would be marked wrong.
    duplicates([...game.lines.map((l) => l?.code), ...distractors])
      .forEach((d) => c.error(`the line "${d}" appears twice`));
    if (!isText(game.explanation)) c.warn('no explanation');
    return c;
  },

  contentOf: (game) => ({ lines: game.lines, distractors: game.distractors ?? [], explanation: game.explanation ?? null }),

  deliver(game) {
    const { lines, distractors } = game.content;
    return {
      lineCount: lines.length,
      maxIndent: Math.max(...lines.map((l) => l.indent)) + 1,
      blocks: shuffle([
        ...lines.map((l, i) => ({ id: token(game.id, `p${i}`), code: l.code })),
        ...distractors.map((d, j) => ({ id: token(game.id, `x${j}`), code: d })),
      ]),
    };
  },

  /** answers: { program: [{ id, indent }, ...] } in the order the student built it */
  mark(game, answers) {
    const { lines, distractors, explanation } = game.content;
    const byToken = new Map([
      ...lines.map((l, i) => [token(game.id, `p${i}`), { code: l.code, line: i }]),
      ...distractors.map((d, j) => [token(game.id, `x${j}`), { code: d, line: null }]),
    ]);

    const seen = new Set();
    const program = (Array.isArray(answers.program) ? answers.program : [])
      .filter((p) => p && byToken.has(p.id) && !seen.has(p.id) && seen.add(p.id))
      .map((p) => ({ ...byToken.get(p.id), indent: Number.isInteger(p.indent) ? Math.max(0, Math.min(MAX_INDENT, p.indent)) : 0 }));

    const key = (line, indent) => `${line}:${indent}`;
    const expected = lines.map((l, i) => key(i, l.indent));
    const given = program.map((p) => (p.line === null ? 'x' : key(p.line, p.indent)));
    const { length, matched } = lcs(expected, given);
    const distractorsUsed = program.filter((p) => p.line === null).length;

    const score = Math.max(0, length - distractorsUsed);
    return {
      feedback: [{
        prompt: 'The program',
        given: program.length ? render(program) : null,
        answer: render(lines),
        correct: score === lines.length && program.length === lines.length,
        explanation: explanation ?? null,
      }],
      score,
      maxScore: lines.length,
      extra: {
        lines: program.map((p, i) => ({ code: p.code, indent: p.indent, ok: matched.has(i) && p.line !== null })),
        distractorsUsed,
      },
    };
  },
};
