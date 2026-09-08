const { query, queryOne } = require('../config/database');

const Game = {
  findAll({ topicId } = {}) {
    if (topicId) {
      return query(
        `SELECT g.id, g.title, g.kind, g.topic_id AS "topicId", t.name AS topic
           FROM games g JOIN topics t ON t.id = g.topic_id
          WHERE g.topic_id = $1
          ORDER BY g.id`,
        [topicId],
      );
    }
    return query(
      `SELECT g.id, g.title, g.kind, g.topic_id AS "topicId", t.name AS topic
         FROM games g JOIN topics t ON t.id = g.topic_id
        ORDER BY t.sort_order, g.id`,
    );
  },

  findById(id) {
    return queryOne(
      `SELECT g.id, g.title, g.kind, g.topic_id AS "topicId", t.name AS topic
         FROM games g JOIN topics t ON t.id = g.topic_id
        WHERE g.id = $1`,
      [id],
    );
  },
};

module.exports = Game;
