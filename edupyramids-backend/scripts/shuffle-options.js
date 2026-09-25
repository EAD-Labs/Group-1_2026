#!/usr/bin/env node
/*
 * Put each question's options in a fixed shuffled order.
 *
 *   node scripts/shuffle-options.js content/python-mcqs.json
 *
 * The client's questions come from a Moodle export that lists the right answer
 * first, so every answer was (a) and tapping A every time scored 100%. This
 * rewrites the file so the right answer lands anywhere, and moves the
 * "correct" letter with it.
 *
 * The order depends only on the question and its options, never on the order
 * they arrive in, so running it again changes nothing. Options that talk
 * about the others ("None of the above", "All of them", "Both") keep their
 * place at the end, or they would stop making sense. An option that appears
 * twice is kept once: with two identical answers, picking the "other" copy
 * of the right one would be marked wrong.
 *
 * Run it on every new question file. The importer warns when a file's answers
 * are all the same letter. To bring a database that already holds the
 * questions into line, just import the file again: the importer re-orders
 * existing questions to match and re-letters stored answers.
 */
const crypto = require('crypto');
const fs = require('fs');

const LETTERS = ['a', 'b', 'c', 'd', 'e'];
const REFERS_TO_OTHERS = /^(all|none|neither|both)\b(?! (a|b|x|y) (and|are))|\b(of the above|of these|of them)\b/i;

/** A seeded random source from the question text, so the result is repeatable. */
function randomFrom(seed) {
  let state = crypto.createHash('sha256').update(seed).digest().readUInt32LE(0) || 1;
  return () => {
    // xorshift32
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
}

function shuffleQuestion(q) {
  const letters = LETTERS.filter((l) => typeof q.options[l] === 'string');
  const right = q.options[q.correct];
  const texts = [...new Set(letters.map((l) => q.options[l]))];
  const pinned = texts.filter((t) => REFERS_TO_OTHERS.test(t.trim())).sort();
  const free = texts.filter((t) => !REFERS_TO_OTHERS.test(t.trim())).sort();

  const rnd = randomFrom(`${q.text}\u0000${texts.slice().sort().join('\u0000')}`);
  for (let i = free.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [free[i], free[j]] = [free[j], free[i]];
  }

  const order = [...free, ...pinned];
  const options = Object.fromEntries(order.map((t, i) => [LETTERS[i], t]));
  return { ...q, options, correct: LETTERS[order.indexOf(right)] };
}

function shuffleFile(topics) {
  return topics.map((t) => ({
    ...t,
    quizzes: t.quizzes.map((z) => ({ ...z, questions: z.questions.map(shuffleQuestion) })),
  }));
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/shuffle-options.js <questions.json>');
    process.exit(1);
  }
  const topics = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = shuffleFile(topics);
  fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  const tally = {};
  out.forEach((t) => t.quizzes.forEach((z) => z.questions.forEach((q) => { tally[q.correct] = (tally[q.correct] || 0) + 1; })));
  console.log(`Shuffled ${file}. Right answers by letter:`, tally);
}

module.exports = { shuffleQuestion, shuffleFile, REFERS_TO_OTHERS };
