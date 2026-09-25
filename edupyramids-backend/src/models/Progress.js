const { query } = require('../config/database');

const Progress = {
  /**
   * Every topic for a student, including the ones not started, so the dashboard
   * can draw the full ladder rather than only what has been touched.
   */
  forStudent(studentId) {
    /*
     * The attempt figures are worked out from the attempts table rather than
     * read from `progress`. The progress row is maintained by the rules engine,
     * which is Week 7 work; until then it is all zeros, and a dashboard showing
     * nothing after a student has just finished a quiz looks broken. Counting
     * the attempts directly is both honest and correct today, and it stays
     * correct once the rules engine starts filling the row in.
     */
    return query(
      `SELECT t.id AS "topicId", t.name AS topic, t.level,
              COALESCE(p.points, 0)       AS points,
              COALESCE(p.level, 1)        AS "studentLevel",
              COALESCE(p.percent_done, 0) AS "percentDone",
              COUNT(a.id)::int            AS attempts,
              MAX(ROUND(a.score::numeric / a.max_score * 100))::int AS "bestPercent",
              MAX(a.created_at)           AS "lastActivity",
              EXISTS (SELECT 1 FROM quizzes q WHERE q.topic_id = t.id) AS "hasQuiz"
         FROM topics t
         LEFT JOIN progress p ON p.topic_id = t.id AND p.student_id = $1
         LEFT JOIN attempts a ON a.topic_id = t.id AND a.student_id = $1
        -- A topic with nothing in it is nothing to finish.
        WHERE EXISTS (SELECT 1 FROM quizzes q WHERE q.topic_id = t.id)
           OR EXISTS (SELECT 1 FROM games g WHERE g.topic_id = t.id)
        GROUP BY t.id, t.name, t.level, t.sort_order,
                 p.points, p.level, p.percent_done
        ORDER BY t.sort_order, t.id`,
      [studentId],
    );
  },

  /** Overall figures for the header of the student dashboard. */
  async summaryForStudent(studentId) {
    const rows = await Progress.forStudent(studentId);
    const started = rows.filter((r) => r.attempts > 0);
    // A topic counts as learnt at 80% or better, the same bar the badge rules
    // will use in Week 7 (HLD Section 6.3).
    const learnt = rows.filter((r) => (r.bestPercent ?? 0) >= 80).length;

    return {
      topics: rows.length,
      topicsAvailable: rows.filter((r) => r.hasQuiz).length,
      topicsStarted: started.length,
      topicsLearnt: learnt,
      // Follows topics learnt, never time spent (HLD D-04, test C4).
      percentDone: rows.length ? Math.round((learnt / rows.length) * 100) : 0,
      attempts: rows.reduce((sum, r) => sum + r.attempts, 0),
      points: rows.reduce((sum, r) => sum + r.points, 0),
      level: rows.reduce((max, r) => Math.max(max, r.studentLevel), 1),
    };
  },
};

module.exports = Progress;
