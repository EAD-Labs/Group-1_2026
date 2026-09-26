const { query } = require('../config/database');

const Badge = {
  /** A student's badges, newest first. */
  forStudent(studentId) {
    return query(
      `SELECT b.id, b.badge_name AS "badgeName", b.topic_id AS "topicId",
              t.name AS topic, b.earned_at AS "earnedAt"
         FROM badges b LEFT JOIN topics t ON t.id = b.topic_id
        WHERE b.student_id = $1
        ORDER BY b.earned_at DESC`,
      [studentId],
    );
  },

  /**
   * Award a badge, or do nothing if it is already there.
   *
   * The ON CONFLICT clause, resting on the table's UNIQUE constraint, is what
   * makes this safe to call from the rule engine as often as it likes: running
   * it five times leaves one row (HLD test C1). When to award is decided in
   * services/badgeService.js.
   */
  award(studentId, topicId, badgeName) {
    return query(
      `INSERT INTO badges (student_id, topic_id, badge_name)
            VALUES ($1, $2, $3)
       ON CONFLICT (student_id, topic_id, badge_name) DO NOTHING
         RETURNING id`,
      [studentId, topicId, badgeName],
    );
  },
};

module.exports = Badge;
