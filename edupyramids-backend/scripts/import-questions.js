#!/usr/bin/env node
/*
 * Load a question file into the database.
 *
 * The whole file is validated before a single row is written, and the write
 * runs in one transaction. A file with a mistake in the last question leaves
 * the database exactly as it was, which is what HLD test A4 checks: a partly
 * loaded quiz is worse than no quiz, because nothing tells you it is partial.
 *
 *   node scripts/import-questions.js <file> [--replace] [--dry-run] [--quiet]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/database');

const LETTERS = ['a', 'b', 'c', 'd', 'e'];

/**
 * @returns {{ errors: string[], warnings: string[], topics: object[] }}
 */
function validate(raw) {
  const errors = [];
  const warnings = [];

  if (!Array.isArray(raw)) {
    return { errors: ['The file must contain a list of topics'], warnings, topics: [] };
  }

  raw.forEach((topic, ti) => {
    const at = `topics[${ti}]`;

    if (!topic || typeof topic.topic !== 'string' || !topic.topic.trim()) {
      errors.push(`${at}: "topic" is required`);
      return;
    }
    if (topic.level !== undefined && !Number.isInteger(topic.level)) {
      errors.push(`${at}: "level" must be a whole number`);
    }
    if (!Array.isArray(topic.quizzes) || topic.quizzes.length === 0) {
      errors.push(`${at} (${topic.topic}): needs at least one quiz`);
      return;
    }

    topic.quizzes.forEach((quiz, qi) => {
      const qAt = `${at}.quizzes[${qi}]`;

      if (!quiz || typeof quiz.title !== 'string' || !quiz.title.trim()) {
        errors.push(`${qAt}: "title" is required`);
        return;
      }
      if (quiz.difficulty !== undefined && !Number.isInteger(quiz.difficulty)) {
        errors.push(`${qAt}: "difficulty" must be a whole number`);
      }
      if (!Array.isArray(quiz.questions) || quiz.questions.length === 0) {
        errors.push(`${qAt} (${quiz.title}): needs at least one question`);
        return;
      }

      quiz.questions.forEach((question, qqi) => {
        const at3 = `${qAt}.questions[${qqi}]`;

        if (!question || typeof question.text !== 'string' || !question.text.trim()) {
          errors.push(`${at3}: "text" is required`);
          return;
        }

        const options = question.options || {};
        const present = LETTERS.filter(
          (l) => typeof options[l] === 'string' && options[l].trim(),
        );

        if (!present.includes('a') || !present.includes('b')) {
          errors.push(`${at3}: needs at least options "a" and "b"`);
        }
        const texts = present.map((l) => options[l].trim());
        if (new Set(texts).size !== texts.length) {
          warnings.push(`${at3}: two options are the same, so picking the other copy of the right one is marked wrong `
            + '(scripts/shuffle-options.js keeps each option once)');
        }

        if (typeof question.correct !== 'string') {
          errors.push(`${at3}: "correct" is required`);
        } else if (!present.includes(question.correct)) {
          // The error this whole function exists for: it reads fine and it
          // marks every student wrong.
          errors.push(
            `${at3}: correct "${question.correct}" has no matching option ` +
            `(this question has ${present.join(', ') || 'none'})`,
          );
        }

        if (question.concepts !== undefined && (!Array.isArray(question.concepts)
          || !question.concepts.every((c) => typeof c === 'string' && c.trim()))) {
          errors.push(`${at3}: "concepts" must be a list of concept slugs`);
        }

        if (!question.explanation || !String(question.explanation).trim()) {
          warnings.push(`${at3}: no explanation, so the student is told only right or wrong`);
        }
      });
    });
  });

  // A file whose answers are all one letter can be passed by always tapping it:
  // the usual sign of an export that lists the right answer first.
  const keys = raw.flatMap((t) => (t?.quizzes || []).flatMap((z) => (z?.questions || []).map((q) => q?.correct)));
  if (keys.length >= 5 && new Set(keys).size === 1) {
    warnings.unshift(`Every answer is "${keys[0]}", so tapping it every time scores 100%. `
      + 'Run node scripts/shuffle-options.js on the file first.');
  }

  return { errors, warnings, topics: raw };
}

/** Link one question to its concepts by slug. An unknown slug stops the import. */
async function tagQuestion(client, questionId, slugs = []) {
  for (const slug of slugs) {
    const concept = await client.query('SELECT id FROM concepts WHERE slug = $1', [slug.trim()]);
    if (!concept.rows.length) {
      throw new Error(`Unknown concept "${slug}". Load content/concepts.json first.`);
    }
    await client.query(
      `INSERT INTO question_concepts (question_id, concept_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [questionId, concept.rows[0].id],
    );
  }
}

/**
 * Tag the questions of a quiz that is already loaded. Questions are matched by
 * their text, in order, so two questions with the same text each get a turn.
 */
async function syncConcepts(client, quizId, fileQuestions) {
  const stored = (await client.query(
    'SELECT id, text FROM questions WHERE quiz_id = $1 ORDER BY id', [quizId],
  )).rows;
  const used = new Set();
  for (const q of fileQuestions) {
    if (!q.concepts || !q.concepts.length) continue;
    const match = stored.find((row) => !used.has(row.id) && row.text === q.text.trim());
    if (!match) continue;
    used.add(match.id);
    await tagQuestion(client, match.id, q.concepts);
  }
}

/*
 * Bring the option order of questions already loaded into line with the file,
 * after scripts/shuffle-options.js has re-ordered it. A question is changed
 * only if it holds exactly the same options, and every stored answer to it is
 * re-lettered in the same step (attempts and recorded checks), so past
 * results still mean what they meant. Nothing to do once the order matches.
 */
async function syncOptionOrder(client, quizId, fileQuestions) {
  const stored = (await client.query(
    `SELECT id, text, option_a AS a, option_b AS b, option_c AS c, option_d AS d, option_e AS e,
            correct_answer AS correct
       FROM questions WHERE quiz_id = $1 ORDER BY id`,
    [quizId],
  )).rows;
  const used = new Set();
  let changed = 0;

  for (const q of fileQuestions) {
    const row = stored.find((r) => !used.has(r.id) && r.text === q.text.trim());
    if (!row) continue;
    used.add(row.id);

    const was = Object.fromEntries(LETTERS.filter((l) => row[l] !== null).map((l) => [l, row[l]]));
    const now = Object.fromEntries(LETTERS.filter((l) => typeof q.options[l] === 'string').map((l) => [l, q.options[l]]));
    if (JSON.stringify(was) === JSON.stringify(now)) continue;

    // The same options, only moved (or a duplicate dropped): every old letter
    // maps, by its text, to the new letter of that text.
    const nowTexts = new Set(Object.values(now));
    if (nowTexts.size !== Object.keys(now).length
      || new Set(Object.values(was)).size !== nowTexts.size
      || Object.values(was).some((t) => !nowTexts.has(t))) continue;
    const letterOf = Object.fromEntries(Object.entries(now).map(([l, t]) => [t, l]));
    const map = Object.fromEntries(Object.entries(was).map(([l, t]) => [l, letterOf[t]]));
    if (map[row.correct] !== q.correct) continue;

    await client.query(
      `UPDATE questions SET option_a = $2, option_b = $3, option_c = $4, option_d = $5, option_e = $6,
                            correct_answer = $7
        WHERE id = $1`,
      [row.id, now.a, now.b, now.c ?? null, now.d ?? null, now.e ?? null, q.correct],
    );

    const key = String(row.id);
    const attempts = (await client.query(
      'SELECT id, answers FROM attempts WHERE quiz_id = $1 AND answers ? $2', [quizId, key],
    )).rows;
    for (const a of attempts) {
      const given = a.answers[key];
      if (map[given]) {
        await client.query('UPDATE attempts SET answers = jsonb_set(answers, $2, $3) WHERE id = $1',
          [a.id, [key], JSON.stringify(map[given])]);
      }
    }
    const checks = (await client.query(
      'SELECT id, value FROM answer_checks WHERE quiz_id = $1 AND item = $2', [quizId, key],
    )).rows;
    for (const c of checks) {
      if (map[c.value]) {
        await client.query('UPDATE answer_checks SET value = $2 WHERE id = $1', [c.id, JSON.stringify(map[c.value])]);
      }
    }
    changed += 1;
  }
  return changed;
}

async function load(topics, { replace }) {
  const client = await pool.connect();
  let counts = {
    topics: 0, quizzes: 0, questions: 0, reordered: 0,
  };

  try {
    await client.query('BEGIN');

    for (const topic of topics) {
      const topicRow = await client.query(
        `INSERT INTO topics (name, level) VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET level = EXCLUDED.level
         RETURNING id`,
        [topic.topic.trim(), topic.level ?? 1],
      );
      const topicId = topicRow.rows[0].id;
      counts.topics += 1;

      for (const quiz of topic.quizzes) {
        const existing = await client.query(
          'SELECT id FROM quizzes WHERE title = $1 AND topic_id = $2',
          [quiz.title.trim(), topicId],
        );

        let quizId;
        if (existing.rows.length) {
          quizId = existing.rows[0].id;
          if (!replace) {
            // Already loaded, so the questions are left alone, but their concept
            // tags are brought up to date: tags added to the file later still
            // reach a database that loaded the questions before tags existed.
            await syncConcepts(client, quizId, quiz.questions);
            counts.reordered += await syncOptionOrder(client, quizId, quiz.questions);
            continue;
          }
          await client.query('DELETE FROM questions WHERE quiz_id = $1', [quizId]);
        } else {
          const inserted = await client.query(
            `INSERT INTO quizzes (title, topic_id, difficulty)
             VALUES ($1, $2, $3) RETURNING id`,
            [quiz.title.trim(), topicId, quiz.difficulty ?? 1],
          );
          quizId = inserted.rows[0].id;
        }
        counts.quizzes += 1;

        for (const q of quiz.questions) {
          const o = q.options;
          const inserted = await client.query(
            `INSERT INTO questions
               (quiz_id, text, option_a, option_b, option_c, option_d, option_e,
                correct_answer, explanation)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id`,
            [quizId, q.text.trim(), o.a, o.b, o.c ?? null, o.d ?? null, o.e ?? null,
              q.correct, q.explanation ?? null],
          );
          await tagQuestion(client, inserted.rows[0].id, q.concepts);
          counts.questions += 1;
        }
      }
    }

    await client.query('COMMIT');
    return counts;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const replace = args.includes('--replace');
  const dryRun = args.includes('--dry-run');
  // --quiet drops the per-item warnings (a boot log does not need 136 of them);
  // errors are still printed and still stop the import.
  const quiet = args.includes('--quiet');

  if (!file) {
    console.error('Usage: node scripts/import-questions.js <file> [--replace] [--dry-run] [--quiet]');
    process.exit(2);
  }

  const full = path.resolve(file);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (err) {
    console.error(`Could not read ${file}: ${err.message}`);
    process.exit(1);
  }

  const { errors, warnings, topics } = validate(raw);

  if (!quiet) warnings.forEach((w) => console.warn(`  warning  ${w}`));

  if (errors.length) {
    console.error(`\nRefused ${path.basename(full)} — ${errors.length} problem(s). ` +
      'Nothing was written.\n');
    errors.forEach((e) => console.error(`  error    ${e}`));
    process.exit(1);
  }

  if (dryRun) {
    console.log(`\n${path.basename(full)} is valid. ` +
      `${warnings.length} warning(s). Nothing written (--dry-run).`);
    await pool.end();
    return;
  }

  // The concept map comes first: questions name their concepts by slug.
  const concepts = require('./import-concepts');
  const conceptFile = JSON.parse(fs.readFileSync(concepts.DEFAULT_FILE, 'utf8'));
  const conceptErrors = concepts.validate(conceptFile);
  if (conceptErrors.length) {
    conceptErrors.forEach((e) => console.error(`  error    concepts.json: ${e}`));
    process.exit(1);
  }
  await concepts.load(conceptFile);

  const counts = await load(topics, { replace });
  console.log(`\nLoaded ${path.basename(full)}: ${counts.topics} topic(s), ` +
    `${counts.quizzes} quiz(zes), ${counts.questions} question(s).`
    + (counts.reordered ? ` Re-ordered the options of ${counts.reordered} question(s) already loaded.` : ''));
  if (warnings.length && !quiet) console.log(`${warnings.length} warning(s) above.`);
  await pool.end();
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error(err.message);
    await pool.end();
    process.exit(1);
  });
}

module.exports = { validate, load, syncOptionOrder };
