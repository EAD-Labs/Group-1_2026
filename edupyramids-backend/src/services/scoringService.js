const { pool } = require('../config/database');
const { recordResponse, summariseChanges } = require('./masteryService');
const { attemptTime } = require('./attemptTime');
const { xpForAttempt, quizStars } = require('./xp');
const { checksFor, firstChecked } = require('./checkService');

/*
 * Marking a quiz attempt.
 *
 * Three rules from the HLD are load-bearing here:
 *
 *   - an unanswered question is wrong, not missing (test A5). It must never
 *     leave a null in the score or drop out of the total;
 *   - submitting twice records one attempt (test A6);
 *   - the result names the concept and gives the explanation, so the student is
 *     told why rather than just being marked (test A7, HLD Section 6.3).
 */

class ScoringError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Mark a set of answers and store the attempt.
 *
 * @param {object}  input
 * @param {number}  input.quizId
 * @param {number}  input.studentId
 * @param {object}  input.answers          { [questionId]: 'a' | 'b' | 'c' | 'd' }
 * @param {string} [input.clientAttemptId] UUID made by the client when it opened the quiz
 */
async function markQuizAttempt({ quizId, studentId, answers = {}, clientAttemptId, answeredAt }) {
  const client = await pool.connect();

  try {
    const quiz = await client.query(
      `SELECT q.id, q.title, q.topic_id, t.name AS topic
         FROM quizzes q JOIN topics t ON t.id = q.topic_id
        WHERE q.id = $1`,
      [quizId],
    );
    if (!quiz.rows.length) throw new ScoringError('No such quiz', 404);
    const { topic_id: topicId, topic } = quiz.rows[0];

    const questions = (await client.query(
      `SELECT id, text, correct_answer, explanation
         FROM questions WHERE quiz_id = $1 ORDER BY id`,
      [quizId],
    )).rows;

    if (!questions.length) {
      throw new ScoringError('That quiz has no questions loaded yet', 409);
    }

    // A question checked during play is marked on the letter checked first,
    // not on whatever was sent after the answer was shown.
    const checked = firstChecked(await checksFor({ clientAttemptId, studentId }));

    // Mark every question in the quiz, not every answer that was sent. A
    // question the student skipped is still counted, and counted as wrong.
    const feedback = questions.map((q) => {
      const given = checked.has(String(q.id))
        ? checked.get(String(q.id))
        : answers[q.id] ?? answers[String(q.id)] ?? null;
      const correct = given === q.correct_answer;
      return {
        questionId: q.id,
        answered: given !== null,
        given,
        correct,
        correctAnswer: q.correct_answer,
        explanation: q.explanation,
        topic,
      };
    });

    const score = feedback.filter((f) => f.correct).length;
    const maxScore = questions.length;

    const bestBefore = (await client.query(
      `SELECT MAX(ROUND(score::numeric / max_score * 100))::int AS percent
         FROM attempts WHERE student_id = $1 AND quiz_id = $2`,
      [studentId, quizId],
    )).rows[0].percent;

    await client.query('BEGIN');

    // ON CONFLICT DO NOTHING is the double-submit guard. The index only covers
    // rows that carry a client id, so an attempt sent without one still saves.
    const inserted = await client.query(
      `INSERT INTO attempts
         (student_id, kind, quiz_id, topic_id, score, max_score, answers, client_attempt_id, created_at)
       VALUES ($1, 'quiz', $2, $3, $4, $5, $6, $7, COALESCE($8, now()))
       ON CONFLICT (client_attempt_id) WHERE client_attempt_id IS NOT NULL
       DO NOTHING
       RETURNING id, created_at`,
      [studentId, quizId, topicId, score, maxScore,
        JSON.stringify(answers), clientAttemptId ?? null, attemptTime(answeredAt)],
    );

    let attempt = inserted.rows[0];
    let duplicate = false;

    if (!attempt) {
      // Already recorded. Return the attempt that is actually stored rather
      // than a fresh one, so the student sees the same result either way.
      duplicate = true;
      attempt = (await client.query(
        `SELECT id, created_at FROM attempts WHERE client_attempt_id = $1`,
        [clientAttemptId],
      )).rows[0];
    }

    // Every answer is evidence for the mastery model, stored in the same
    // transaction as the attempt. A duplicate submit adds no evidence.
    let mastery = [];
    if (!duplicate) {
      const changes = [];
      for (const f of feedback) {
        changes.push(await recordResponse(client, {
          studentId, questionId: f.questionId, correct: f.correct, source: 'quiz',
        }));
      }
      mastery = summariseChanges(changes);
    }

    await client.query('COMMIT');

    return {
      attemptId: attempt.id,
      duplicate,
      xp: duplicate ? 0 : xpForAttempt(quizStars(bestBefore), quizStars(Math.round((score / maxScore) * 100)), score / maxScore),
      mastery,
      quizId,
      topic,
      score,
      maxScore,
      percent: Math.round((score / maxScore) * 100),
      unanswered: feedback.filter((f) => !f.answered).length,
      feedback,
      // Which topics to look at again. Weakest first, and only a suggestion:
      // nothing is locked (HLD test C9).
      revisit: score < maxScore ? [topic] : [],
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Mark a single answer without recording anything.
 *
 * Used to tell the student straight away. The attempt is still marked in full
 * on submit, so this cannot change what they score.
 */
async function checkAnswer(quizId, questionId, answer) {
  const { queryOne } = require('../config/database');
  const q = await queryOne(
    `SELECT qu.id, qu.correct_answer, qu.explanation, t.name AS topic
       FROM questions qu
       JOIN quizzes z ON z.id = qu.quiz_id
       JOIN topics  t ON t.id = z.topic_id
      WHERE qu.id = $1 AND qu.quiz_id = $2`,
    [questionId, quizId],
  );
  if (!q) return null;

  return {
    questionId: q.id,
    correct: answer === q.correct_answer,
    correctAnswer: q.correct_answer,
    explanation: q.explanation,
    topic: q.topic,
  };
}

module.exports = { markQuizAttempt, checkAnswer, ScoringError };
