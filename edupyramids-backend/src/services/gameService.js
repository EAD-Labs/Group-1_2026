const { pool } = require('../config/database');
const Game = require('../models/Game');
const { kindOf } = require('../games');
const { GameError, token } = require('../games/common');
const { attemptTime } = require('./attemptTime');
const { starsFor } = require('../games/stars');
const { xpForAttempt } = require('./xp');

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

/**
 * A hint, recorded before it is given: the count decides the third star, so it
 * is the server's record that counts, not the browser's. Asking again for the
 * same hint is free.
 */
async function giveHint({ gameId, studentId, clientAttemptId, item, level }) {
  const { game, kind } = await load(gameId);
  if (!kind.hint) throw new GameError('This game has no hints');
  const hint = kind.hint(game, item, level);
  if (level > hint.maxLevel) throw new GameError('There are no more hints for this');
  await pool.query(
    `INSERT INTO game_hints (client_attempt_id, student_id, game_id, item, level)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING`,
    [clientAttemptId, studentId, game.id, item, level],
  );
  return { ...hint, level };
}

async function hintsUsed(clientAttemptId, studentId) {
  if (!clientAttemptId) return 0;
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM game_hints WHERE client_attempt_id = $1 AND student_id = $2',
    [clientAttemptId, studentId],
  );
  return rows[0].n;
}

async function markGameAttempt({ gameId, studentId, answers = {}, clientAttemptId, answeredAt }) {
  const { game, kind } = await load(gameId);
  const { feedback, score, maxScore, extra = {} } = kind.mark(game, answers);
  const hints = await hintsUsed(clientAttemptId, studentId);
  const stars = starsFor({ score, maxScore, hintsUsed: hints, parMet: extra.parMet });
  const before = (await pool.query(
    'SELECT COALESCE(MAX(stars), 0)::int AS stars FROM attempts WHERE student_id = $1 AND game_id = $2',
    [studentId, game.id],
  )).rows[0].stars;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO attempts
         (student_id, kind, game_id, topic_id, score, max_score, answers, client_attempt_id, created_at,
          stars, hints_used)
       VALUES ($1, 'game', $2, $3, $4, $5, $6, $7, COALESCE($8, now()), $9, $10)
       ON CONFLICT (client_attempt_id) WHERE client_attempt_id IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [studentId, game.id, game.topicId, score, maxScore,
        JSON.stringify(answers), clientAttemptId ?? null, attemptTime(answeredAt), stars, hints],
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
      stars,
      hintsUsed: hints,
      xp: duplicate ? 0 : xpForAttempt(before, stars, score / maxScore),
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
  getGameForStudent, checkMove, giveHint, markGameAttempt, GameError, token,
};
