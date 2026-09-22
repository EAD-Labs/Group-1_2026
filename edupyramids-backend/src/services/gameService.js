const { pool } = require('../config/database');
const Game = require('../models/Game');
const { kindOf } = require('../games');
const { GameError, token } = require('../games/common');

/*
 * Delivering and marking games, for every kind.
 *
 * What differs between kinds (the shape of the content, how it is shuffled,
 * how an answer is scored) lives in src/games, one file per kind. What is the
 * same for all of them lives here: loading a game, keeping the answer key out
 * of what is sent, and storing the attempt in the same table as quizzes, so
 * progress and the class dashboards count both.
 */

async function load(gameId) {
  const game = await Game.findById(gameId);
  if (!game) throw new GameError('No such game', 404);
  const kind = kindOf(game.kind);
  if (!kind) throw new GameError(`This server does not know how to run "${game.kind}" games`, 500);
  return { game, kind };
}

/** The game as a student receives it: shuffled, tokenised, no key, no explanations. */
async function getGameForStudent(gameId) {
  const { game, kind } = await load(gameId);
  return {
    id: game.id,
    title: game.title,
    kind: game.kind,
    instructions: game.instructions,
    topicId: game.topicId,
    topic: game.topic,
    ...kind.deliver(game),
  };
}

/** An instant check during play, for kinds that have one. Records nothing. */
async function checkMove(gameId, body) {
  const { game, kind } = await load(gameId);
  if (!kind.check) throw new GameError('This game has nothing to check during play');
  return kind.check(game, body || {});
}

async function markGameAttempt({ gameId, studentId, answers = {}, clientAttemptId }) {
  const { game, kind } = await load(gameId);
  const { feedback, score, maxScore, extra = {} } = kind.mark(game, answers);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO attempts
         (student_id, kind, game_id, topic_id, score, max_score, answers, client_attempt_id)
       VALUES ($1, 'game', $2, $3, $4, $5, $6, $7)
       ON CONFLICT (client_attempt_id) WHERE client_attempt_id IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [studentId, game.id, game.topicId, score, maxScore,
        JSON.stringify(answers), clientAttemptId ?? null],
    );

    let attemptId = inserted.rows[0]?.id;
    const duplicate = !attemptId;
    if (duplicate) {
      attemptId = (await client.query(
        'SELECT id FROM attempts WHERE client_attempt_id = $1', [clientAttemptId],
      )).rows[0].id;
    }
    await client.query('COMMIT');

    return {
      attemptId,
      duplicate,
      gameId: game.id,
      kind: game.kind,
      title: game.title,
      topic: game.topic,
      score,
      maxScore,
      percent: Math.round((score / maxScore) * 100),
      ...extra,
      feedback,
      revisit: score < maxScore ? [game.topic] : [],
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  getGameForStudent, checkMove, markGameAttempt, GameError, token,
};
