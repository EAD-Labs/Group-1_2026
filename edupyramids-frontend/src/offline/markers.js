/*
 * Marking on the device, for when there is no connection.
 *
 * Each function mirrors the server's marking for that kind (the server's is in
 * edupyramids-backend/src/games) and returns the same shape, so the result
 * screen does not know which one it got. markers.test.js runs both over every
 * game in the content file and fails if they ever disagree.
 *
 * This marking is for the student's feedback only. What counts is the server's:
 * every offline attempt is uploaded as raw answers and marked again there.
 */

const MAX_INDENT = 4;
const INDENT = '    ';

export function normaliseOutput(s) {
  return String(s ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n').map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

const percent = (score, max) => Math.round((score / max) * 100);

// ---------------------------------------------------------------- quizzes

/** One answer, for instant feedback. Same shape as POST /quizzes/:id/check. */
export function checkQuestion(quiz, questionId, letter) {
  const q = quiz.questions.find((x) => x.id === questionId);
  if (!q) return null;
  return {
    questionId: q.id, correct: letter === q.correct, correctAnswer: q.correct,
    explanation: q.explanation, topic: quiz.topic,
  };
}

/** A whole quiz. Same shape as POST /quizzes/:id/attempts, without mastery. */
export function markQuiz(quiz, answers = {}) {
  const feedback = [...quiz.questions].sort((a, b) => a.id - b.id).map((q) => {
    const given = answers[q.id] ?? answers[String(q.id)] ?? null;
    return {
      questionId: q.id, answered: given !== null, given, correct: given === q.correct,
      correctAnswer: q.correct, explanation: q.explanation, topic: quiz.topic,
    };
  });
  const score = feedback.filter((f) => f.correct).length;
  const maxScore = feedback.length;
  return {
    quizId: quiz.id, topic: quiz.topic, score, maxScore, percent: percent(score, maxScore),
    unanswered: feedback.filter((f) => !f.answered).length,
    feedback, revisit: score < maxScore ? [quiz.topic] : [], mastery: [],
  };
}

// ---------------------------------------------------------------- games

function markMatching(g, answers) {
  const rightText = Object.fromEntries(g.rights.map((r) => [r.id, r.text]));
  const feedback = g.lefts.map((l) => {
    const given = answers[l.id] ?? null;
    const right = g.key.answer[l.id];
    return {
      prompt: l.text,
      given: given === null ? null : rightText[given] ?? null,
      answer: rightText[right],
      correct: given === right,
      explanation: g.key.explanation[l.id],
    };
  });
  return { feedback, score: feedback.filter((f) => f.correct).length, maxScore: feedback.length };
}

function markSort(g, answers) {
  const feedback = g.items.map((it) => {
    const given = answers[it.id] ?? null;
    return {
      prompt: it.text,
      given: g.buckets.includes(given) ? given : null,
      answer: g.key.bucket[it.id],
      correct: given === g.key.bucket[it.id],
      explanation: g.key.explanation[it.id],
    };
  });
  return { feedback, score: feedback.filter((f) => f.correct).length, maxScore: feedback.length };
}

/** Do two memory tiles match? Same shape as POST /games/:id/check. */
export function checkMemory(g, first, second) {
  const { pairOf } = g.key;
  if (!(first in pairOf) || !(second in pairOf)) return null;
  const match = first !== second && pairOf[first] === pairOf[second];
  return { match, explanation: match ? g.key.explanation[pairOf[first]] ?? null : null };
}

function markMemory(g, answers) {
  const { pairOf, side, explanation } = g.key;
  const text = Object.fromEntries(g.tiles.map((t) => [t.id, t.text]));
  const found = new Set();
  let misses = 0;

  for (const move of (Array.isArray(answers.moves) ? answers.moves : []).slice(0, 500)) {
    if (!Array.isArray(move) || move.length !== 2) continue;
    const [a, b] = move;
    if (!(a in pairOf) || !(b in pairOf) || a === b) continue;
    if (found.has(pairOf[a]) || found.has(pairOf[b])) continue;
    if (pairOf[a] === pairOf[b]) found.add(pairOf[a]);
    else misses += 1;
  }

  const pairs = g.pairs;
  const tileOf = (i, s) => Object.keys(pairOf).find((id) => pairOf[id] === i && side[id] === s);
  const feedback = Array.from({ length: pairs }, (_, i) => ({
    prompt: text[tileOf(i, 'a')],
    given: found.has(i) ? text[tileOf(i, 'b')] : null,
    answer: text[tileOf(i, 'b')],
    correct: found.has(i),
    explanation: explanation[i] ?? null,
  }));
  const penalty = Math.floor(Math.max(0, misses - 2 * pairs) / 2);
  return { feedback, score: Math.max(0, found.size - penalty), maxScore: pairs, extra: { misses } };
}

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

function markParsons(g, answers) {
  const { solution, distractors, explanation } = g.key;
  const code = Object.fromEntries(g.blocks.map((b) => [b.id, b.code]));
  const lineOf = Object.fromEntries(solution.map((s, i) => [s.id, i]));
  const render = (lines) => lines.map((l) => `${INDENT.repeat(l.indent)}${l.code}`).join('\n');

  const seen = new Set();
  const program = (Array.isArray(answers.program) ? answers.program : [])
    .filter((p) => p && p.id in code && !seen.has(p.id) && seen.add(p.id))
    .map((p) => ({
      code: code[p.id],
      line: p.id in lineOf ? lineOf[p.id] : null,
      indent: Number.isInteger(p.indent) ? Math.max(0, Math.min(MAX_INDENT, p.indent)) : 0,
    }));

  const expected = solution.map((s, i) => `${i}:${s.indent}`);
  const given = program.map((p) => (p.line === null ? 'x' : `${p.line}:${p.indent}`));
  const { length, matched } = lcs(expected, given);
  const distractorsUsed = program.filter((p) => p.line === null).length;
  const score = Math.max(0, length - distractorsUsed);

  return {
    feedback: [{
      prompt: 'The program',
      given: program.length ? render(program) : null,
      answer: render(solution.map((s) => ({ code: code[s.id], indent: s.indent }))),
      correct: score === solution.length && program.length === solution.length,
      explanation,
    }],
    score,
    maxScore: solution.length,
    extra: {
      lines: program.map((p, i) => ({ code: p.code, indent: p.indent, ok: matched.has(i) && p.line !== null })),
      distractorsUsed,
    },
  };
  // (distractors are identified by not being in the solution; the list is
  // kept in the key for clarity and future use.)
}

function markPredict(g, answers) {
  const feedback = g.items.map((it) => {
    const typed = answers[it.id];
    const given = typeof typed === 'string' && normaliseOutput(typed) ? normaliseOutput(typed) : null;
    return {
      prompt: it.code, given, answer: g.key.output[it.id],
      correct: given === g.key.output[it.id], explanation: g.key.explanation[it.id],
    };
  });
  return { feedback, score: feedback.filter((f) => f.correct).length, maxScore: feedback.length };
}

function markBugHunt(g, answers) {
  let score = 0;
  const feedback = g.items.map((it) => {
    const a = answers[it.id] || {};
    const fixText = (id) => it.fixes.find((f) => f.id === id)?.text;
    const lineOk = a.line === g.key.bugLine[it.id];
    const fixOk = lineOk && a.fix === g.key.fix[it.id];
    score += (lineOk ? 1 : 0) + (fixOk ? 1 : 0);
    return {
      prompt: it.lines.join('\n'),
      given: Number.isInteger(a.line) ? `Line ${a.line}${fixText(a.fix) !== undefined ? ` → ${fixText(a.fix)}` : ''}` : null,
      answer: `Line ${g.key.bugLine[it.id]} → ${fixText(g.key.fix[it.id])}`,
      correct: fixOk,
      partial: lineOk && !fixOk,
      explanation: g.key.explanation[it.id],
    };
  });
  return { feedback, score, maxScore: g.items.length * 2 };
}

function markFillBlank(g, answers) {
  let score = 0;
  let maxScore = 0;
  const fill = (parts, values) => parts
    .map((part, i) => (i < parts.length - 1 ? `${part}${values[i] ?? '___'}` : part)).join('');
  const feedback = g.items.map((it) => {
    const blanks = g.key.blanks[it.id];
    const given = Array.isArray(answers[it.id]) ? answers[it.id] : [];
    const right = blanks.filter((b, k) => given[k] === b).length;
    score += right;
    maxScore += blanks.length;
    return {
      prompt: it.parts.join('___'),
      given: given.some((v) => typeof v === 'string')
        ? fill(it.parts, given.map((v) => (typeof v === 'string' ? v : undefined))) : null,
      answer: fill(it.parts, blanks),
      correct: right === blanks.length,
      partial: right > 0 && right < blanks.length,
      explanation: g.key.explanation[it.id],
    };
  });
  return { feedback, score, maxScore };
}

const MARKERS = {
  matching: markMatching,
  drag_drop: markSort,
  memory: markMemory,
  parsons: markParsons,
  predict: markPredict,
  bughunt: markBugHunt,
  fillblank: markFillBlank,
};

/** A whole game. Same shape as POST /games/:id/results. */
export function markGame(game, answers = {}) {
  const mark = MARKERS[game.kind];
  if (!mark) throw new Error(`Cannot mark "${game.kind}" games offline`);
  const { feedback, score, maxScore, extra = {} } = mark(game, answers);
  return {
    gameId: game.id, kind: game.kind, title: game.title, topic: game.topic,
    score, maxScore, percent: percent(score, maxScore), ...extra, feedback,
    revisit: score < maxScore ? [game.topic] : [],
  };
}
