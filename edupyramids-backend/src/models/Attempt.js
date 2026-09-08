const { query } = require('../config/database');

/*
 * Quiz attempts and game attempts live in the same table, told apart by `kind`.
 * Every read below therefore covers both without special-casing either, which
 * is the reason the HLD ER diagram unified them (HLD Section 13.3).
 */
const Attempt = {
  forStudent(studentId, { limit = 100 } = {}) {
    return query(
      `SELECT a.id, a.kind, a.quiz_id AS "quizId", a.game_id AS "gameId",
              a.topic_id AS "topicId", t.name AS topic,
              a.score, a.max_score AS "maxScore", a.created_at AS "createdAt"
         FROM attempts a JOIN topics t ON t.id = a.topic_id
        WHERE a.student_id = $1
        ORDER BY a.created_at DESC
        LIMIT $2`,
      [studentId, limit],
    );
  },

  /**
   * One student's attempts, newest first. What HLD Section 5.2 means by
   * drilling in: the teacher sees each attempt rather than an average that
   * hides a bad week behind a good one.
   */
  historyForStudent(studentId, { limit = 50 } = {}) {
    return query(
      `SELECT a.id, a.kind, a.score, a.max_score AS "maxScore",
              ROUND(a.score::numeric / a.max_score * 100)::int AS percent,
              a.created_at AS "createdAt",
              t.name AS topic, z.title AS quiz
         FROM attempts a
         JOIN topics t ON t.id = a.topic_id
         LEFT JOIN quizzes z ON z.id = a.quiz_id
        WHERE a.student_id = $1
        ORDER BY a.created_at DESC
        LIMIT $2`,
      [studentId, limit],
    );
  },

  /**
   * The questions this class gets wrong most often.
   *
   * Every question the quiz put in front of the student counts, not just the
   * ones they filled in. A question the whole class skipped is the strongest
   * sign it needs reteaching, and marking already counts a blank as wrong
   * (HLD test A5), so the report has to agree with the score.
   */
  hardestQuestionsForClass(classId, { limit = 10 } = {}) {
    return query(
      `SELECT q.id, q.text, t.name AS topic,
              count(*)::int AS seen,
              count(*) FILTER (WHERE a.answers ->> q.id::text = q.correct_answer)::int
                AS correct,
              ROUND(100.0 * count(*) FILTER (WHERE a.answers ->> q.id::text = q.correct_answer)
                    / count(*))::int AS "percentCorrect"
         FROM attempts a
         JOIN questions q ON q.quiz_id = a.quiz_id
         JOIN quizzes   z ON z.id = q.quiz_id
         JOIN topics    t ON t.id = z.topic_id
        WHERE a.student_id IN (SELECT student_id FROM class_students WHERE class_id = $1)
        GROUP BY q.id, q.text, t.name
        ORDER BY "percentCorrect" ASC, seen DESC, q.id
        LIMIT $2`,
      [classId, limit],
    );
  },

  /** Per-topic averages for one class, the shape the teacher dashboard needs. */
  topicAveragesForClass(classId) {
    return query(
      `SELECT t.id   AS "topicId",
              t.name AS topic,
              COUNT(a.id)::int AS attempts,
              COALESCE(ROUND(AVG(a.score::numeric / a.max_score) * 100), 0)::int
                AS "averagePercent"
         FROM topics t
         LEFT JOIN attempts a ON a.topic_id = t.id
          AND a.student_id IN (SELECT student_id FROM class_students WHERE class_id = $1)
        GROUP BY t.id, t.name, t.sort_order
        ORDER BY t.sort_order, t.id`,
      [classId],
    );
  },

  /**
   * One row per enrolled student, including students who have never attempted
   * anything: they come back with 0 attempts and a null average so the
   * interface can say "No attempts yet" rather than 0% (HLD test C7).
   */
  perStudentForClass(classId) {
    return query(
      `SELECT u.id, u.name, u.email,
              COUNT(a.id)::int AS attempts,
              CASE WHEN COUNT(a.id) = 0 THEN NULL
                   ELSE ROUND(AVG(a.score::numeric / a.max_score) * 100)::int
              END AS "averagePercent"
         FROM class_students cs
         JOIN users u ON u.id = cs.student_id
         LEFT JOIN attempts a ON a.student_id = u.id
        WHERE cs.class_id = $1
        GROUP BY u.id, u.name, u.email
        ORDER BY u.name`,
      [classId],
    );
  },
};

module.exports = Attempt;
