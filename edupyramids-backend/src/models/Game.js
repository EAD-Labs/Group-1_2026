const { query, queryOne } = require('../config/database');

const Game = {
  /**
   * Every game, with how this student has done on each when a student id is
   * given, so the dashboard can show a best score without a second request.
   */
  findAll({ topicId, studentId } = {}) {
    return query(
      `SELECT g.id, g.title, g.kind, g.topic_id AS "topicId", t.name AS topic,
              t.level,
              COUNT(a.id)::int AS attempts,
              MAX(ROUND(a.score::numeric / a.max_score * 100))::int AS "bestPercent"
         FROM games g
         JOIN topics t ON t.id = g.topic_id
         LEFT JOIN attempts a ON a.game_id = g.id AND a.student_id = $2
        WHERE ($1::int IS NULL OR g.topic_id = $1)
        GROUP BY g.id, t.id
        ORDER BY t.sort_order, t.level, g.id`,
      [topicId ?? null, studentId ?? null],
    );
  },

  /** One game with its content, answer key included. Never sent as-is. */
  findById(id) {
    return queryOne(
      `SELECT g.id, g.title, g.kind, g.instructions, g.content,
              g.topic_id AS "topicId", t.name AS topic
         FROM games g JOIN topics t ON t.id = g.topic_id
        WHERE g.id = $1`,
      [id],
    );
  },
};

module.exports = Game;
