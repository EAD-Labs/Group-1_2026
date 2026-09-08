const { query, queryOne } = require('../config/database');

/*
 * Reads work today and return real rows; the quizzes table is simply empty
 * until the client's MCQ file is loaded in Week 4. That is why these endpoints
 * return [] rather than invented sample questions.
 */
const Quiz = {
  findAll({ topicId } = {}) {
    if (topicId) {
      return query(
        `SELECT q.id, q.title, q.difficulty, q.topic_id AS "topicId", t.name AS topic
           FROM quizzes q JOIN topics t ON t.id = q.topic_id
          WHERE q.topic_id = $1
          ORDER BY q.difficulty, q.id`,
        [topicId],
      );
    }
    return query(
      `SELECT q.id, q.title, q.difficulty, q.topic_id AS "topicId", t.name AS topic
         FROM quizzes q JOIN topics t ON t.id = q.topic_id
        ORDER BY t.sort_order, q.difficulty, q.id`,
    );
  },

  findById(id) {
    return queryOne(
      `SELECT q.id, q.title, q.difficulty, q.topic_id AS "topicId", t.name AS topic
         FROM quizzes q JOIN topics t ON t.id = q.topic_id
        WHERE q.id = $1`,
      [id],
    );
  },

  /**
   * Questions for a quiz. `correct_answer` is deliberately not selected: the
   * answer key must never travel to the browser with the question.
   */
  questionsFor(quizId) {
    return query(
      `SELECT id, text, option_a AS "optionA", option_b AS "optionB",
              option_c AS "optionC", option_d AS "optionD",
              option_e AS "optionE"
         FROM questions
        WHERE quiz_id = $1
        ORDER BY id`,
      [quizId],
    );
  },
};

module.exports = Quiz;
