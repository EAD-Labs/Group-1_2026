const { pool, query, queryOne } = require('../config/database');
const { validate } = require('../../scripts/import-questions');

/*
 * Content management, for the programme coordinator (HLD Section 4: only the
 * coordinator creates and edits content; UC-04; test C8).
 *
 * Every change is live at once: students are served straight from these
 * tables, and the offline download notices the change by itself. A question
 * the coordinator has touched is marked edited, and the importer then leaves
 * it alone, so the next deploy cannot quietly put the old version back.
 */

const LETTERS = ['a', 'b', 'c', 'd', 'e'];
const OPTION_MAX = 255;   // the column's width

class ManageError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** The same checks as a question file, plus what only a database knows. */
async function check(q) {
  const shaped = [{ topic: 'x', quizzes: [{ title: 'x', questions: [q] }] }];
  const { errors, warnings } = validate(shaped);
  const plain = (m) => m.replace(/^topics\[0\]\.quizzes\[0\]\.questions\[0\]:\s*/, '');
  const problems = errors.map(plain);
  LETTERS.forEach((l) => {
    if (typeof q.options?.[l] === 'string' && q.options[l].length > OPTION_MAX) {
      problems.push(`option ${l.toUpperCase()} is longer than ${OPTION_MAX} characters`);
    }
  });
  const slugs = q.concepts || [];
  if (slugs.length) {
    const known = (await query('SELECT slug FROM concepts WHERE slug = ANY($1)', [slugs])).map((r) => r.slug);
    slugs.filter((s) => !known.includes(s)).forEach((s) => problems.push(`unknown concept "${s}"`));
  }
  if (problems.length) throw new ManageError(problems.join('; '));
  return warnings.map(plain);
}

/** Only the fields a question has, tidied. */
function shape(body = {}) {
  const options = {};
  LETTERS.forEach((l) => {
    const v = body.options?.[l];
    if (typeof v === 'string' && v.trim()) options[l] = v.trim();
  });
  return {
    text: typeof body.text === 'string' ? body.text.trim() : '',
    options,
    correct: typeof body.correct === 'string' ? body.correct : '',
    explanation: typeof body.explanation === 'string' && body.explanation.trim() ? body.explanation.trim() : null,
    concepts: Array.isArray(body.concepts) ? body.concepts.filter((c) => typeof c === 'string') : [],
  };
}

async function setConcepts(client, questionId, slugs) {
  await client.query('DELETE FROM question_concepts WHERE question_id = $1', [questionId]);
  if (slugs.length) {
    await client.query(
      `INSERT INTO question_concepts (question_id, concept_id)
       SELECT $1, id FROM concepts WHERE slug = ANY($2)`,
      [questionId, slugs],
    );
  }
}

async function inTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await work(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Every quiz, with its topic and how many questions it holds. */
function listQuizzes() {
  return query(
    `SELECT z.id, z.title, z.topic_id AS "topicId", t.name AS topic, t.level,
            (SELECT COUNT(*) FROM questions q WHERE q.quiz_id = z.id)::int AS questions
       FROM quizzes z JOIN topics t ON t.id = z.topic_id
      ORDER BY t.sort_order, t.level, z.id`,
  );
}

/** A quiz's questions with everything: answer, explanation, concepts, who edited last. */
async function questionsFor(quizId) {
  const quiz = await queryOne('SELECT id FROM quizzes WHERE id = $1', [quizId]);
  if (!quiz) throw new ManageError('No such quiz', 404);
  return query(
    `SELECT q.id, q.text, q.correct_answer AS correct, q.explanation,
            json_strip_nulls(json_build_object('a', q.option_a, 'b', q.option_b, 'c', q.option_c,
                                               'd', q.option_d, 'e', q.option_e)) AS options,
            COALESCE(ARRAY_AGG(c.slug ORDER BY c.sort_order) FILTER (WHERE c.slug IS NOT NULL), '{}') AS concepts,
            q.edited_at AS "editedAt", u.name AS "editedBy"
       FROM questions q
       LEFT JOIN question_concepts qc ON qc.question_id = q.id
       LEFT JOIN concepts c ON c.id = qc.concept_id
       LEFT JOIN users u ON u.id = q.edited_by
      WHERE q.quiz_id = $1
      GROUP BY q.id, u.name
      ORDER BY q.id`,
    [quizId],
  );
}

async function createQuestion(quizId, body, editorId) {
  const q = shape(body);
  const warnings = await check(q);
  const id = await inTransaction(async (client) => {
    const quiz = (await client.query('SELECT id FROM quizzes WHERE id = $1', [quizId])).rows[0];
    if (!quiz) throw new ManageError('No such quiz', 404);
    const row = (await client.query(
      `INSERT INTO questions (quiz_id, text, option_a, option_b, option_c, option_d, option_e,
                              correct_answer, explanation, edited_at, edited_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10) RETURNING id`,
      [quizId, q.text, q.options.a, q.options.b, q.options.c ?? null, q.options.d ?? null, q.options.e ?? null,
        q.correct, q.explanation, editorId],
    )).rows[0];
    await setConcepts(client, row.id, q.concepts);
    return row.id;
  });
  return { id, warnings };
}

async function updateQuestion(questionId, body, editorId) {
  const q = shape(body);
  const warnings = await check(q);
  await inTransaction(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE questions
          SET text = $2, option_a = $3, option_b = $4, option_c = $5, option_d = $6, option_e = $7,
              correct_answer = $8, explanation = $9, edited_at = now(), edited_by = $10
        WHERE id = $1`,
      [questionId, q.text, q.options.a, q.options.b, q.options.c ?? null, q.options.d ?? null, q.options.e ?? null,
        q.correct, q.explanation, editorId],
    );
    if (!rowCount) throw new ManageError('No such question', 404);
    await setConcepts(client, questionId, q.concepts);
  });
  return { id: questionId, warnings };
}

/**
 * Remove a question. Its answers in the mastery log go with it; attempts keep
 * their score, which was right when it was given.
 */
async function deleteQuestion(questionId) {
  const { rowCount } = await pool.query('DELETE FROM questions WHERE id = $1', [questionId]);
  if (!rowCount) throw new ManageError('No such question', 404);
}

/** A new, empty quiz in a topic. */
async function createQuiz({ topicId, title }) {
  if (typeof title !== 'string' || !title.trim()) throw new ManageError('A quiz needs a title');
  const topic = await queryOne('SELECT id FROM topics WHERE id = $1', [topicId]);
  if (!topic) throw new ManageError('No such topic', 404);
  const clash = await queryOne('SELECT id FROM quizzes WHERE topic_id = $1 AND title = $2', [topicId, title.trim()]);
  if (clash) throw new ManageError('That topic already has a quiz with this title', 409);
  return queryOne(
    'INSERT INTO quizzes (title, topic_id, difficulty) VALUES ($1, $2, 1) RETURNING id, title',
    [title.trim(), topicId],
  );
}

module.exports = {
  listQuizzes, questionsFor, createQuestion, updateQuestion, deleteQuestion, createQuiz, ManageError,
};
