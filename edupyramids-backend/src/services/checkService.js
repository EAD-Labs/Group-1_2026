const { query } = require('../config/database');

/*
 * Instant checks, remembered.
 *
 * Quizzes, Trace Runner and Memory tell the student at once whether an
 * answer is right, which means the server hands back the right answer. On its
 * own that let anyone check, learn the answer, and then submit a different,
 * correct one. So every check is recorded against the attempt it belongs to,
 * and marking uses what was checked:
 *
 *   quiz    the first letter checked for a question
 *   trace   the first value checked for a step
 *   memory  the pairs actually turned over, in order
 *
 * Whatever was never checked (offline play, or a question skipped) is marked
 * from the submitted answers as before.
 */

async function recordCheck({
  clientAttemptId, studentId, quizId = null, gameId = null, item, value, correct,
}) {
  await query(
    `INSERT INTO answer_checks (client_attempt_id, student_id, quiz_id, game_id, item, value, correct)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [clientAttemptId, studentId, quizId, gameId, String(item), JSON.stringify(value), Boolean(correct)],
  );
}

/** Every check in one attempt, in the order they were made. */
function checksFor({ clientAttemptId, studentId }) {
  if (!clientAttemptId) return Promise.resolve([]);
  return query(
    `SELECT item, value, correct FROM answer_checks
      WHERE client_attempt_id = $1 AND student_id = $2
      ORDER BY id`,
    [clientAttemptId, studentId],
  );
}

/** The first value checked for each item: what the student committed to. */
function firstChecked(checks) {
  const first = new Map();
  checks.forEach((c) => { if (!first.has(c.item)) first.set(c.item, c.value); });
  return first;
}

module.exports = { recordCheck, checksFor, firstChecked };
