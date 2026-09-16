const crypto = require('crypto');
const { pool } = require('../config/database');
const Game = require('../models/Game');

/*
 * Delivering and marking games.
 *
 * The rule from quizService holds here too: the answer key never travels with
 * the game. The difficulty is that a game's pieces need ids the browser can
 * send back, and a plain index gives the key away — right answer 3 is the one
 * with id 3. So every piece gets an opaque token, a keyed hash of the game and
 * the piece's place in the content. The server can recompute it to mark an
 * answer; the browser cannot work backwards from it.
 *
 * Three kinds:
 *   matching   pair each left with a right              score: pairs right
 *   drag_drop  put each item in the right bucket        score: items right
 *   memory     flip tiles to find pairs                 score: see markMemory
 */

class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function token(gameId, piece) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET)
    .update(`game:${gameId}:${piece}`)
    .digest('base64url')
    .slice(0, 16);
}

function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function load(gameId) {
  const game = await Game.findById(gameId);
  if (!game) throw new GameError('No such game', 404);
  return game;
}

/** The game as a student receives it: shuffled, tokenised, no key, no explanations. */
async function getGameForStudent(gameId) {
  const game = await load(gameId);
  const { content } = game;
  const base = {
    id: game.id, title: game.title, kind: game.kind,
    instructions: game.instructions, topicId: game.topicId, topic: game.topic,
  };

  if (game.kind === 'matching') {
    return {
      ...base,
      lefts: shuffle(content.pairs.map((p, i) => ({ id: token(game.id, `l${i}`), text: p.left }))),
      rights: shuffle(content.pairs.map((p, i) => ({ id: token(game.id, `r${i}`), text: p.right }))),
    };
  }

  if (game.kind === 'drag_drop') {
    return {
      ...base,
      buckets: content.buckets,
      items: shuffle(content.items.map((it, i) => ({ id: token(game.id, `i${i}`), text: it.text }))),
    };
  }

  return {
    ...base,
    pairs: content.pairs.length,
    tiles: shuffle(content.pairs.flatMap((p, i) => [
      { id: token(game.id, `a${i}`), text: p.a },
      { id: token(game.id, `b${i}`), text: p.b },
    ])),
  };
}

/** token -> which pair it belongs to, for a memory game. */
function memoryIndex(game) {
  const index = new Map();
  game.content.pairs.forEach((_, i) => {
    index.set(token(game.id, `a${i}`), i);
    index.set(token(game.id, `b${i}`), i);
  });
  return index;
}

/**
 * Do two memory tiles match? Answers straight away so the tiles can stay face
 * up, and hands back the explanation at the moment the pair is found.
 *
 * Like the quiz check, nothing stops a student probing this. The score comes
 * from replaying the moves on submit, so probing cannot raise it.
 */
async function checkMemoryPair(gameId, first, second) {
  const game = await load(gameId);
  if (game.kind !== 'memory') throw new GameError('Only memory games check pairs');

  const index = memoryIndex(game);
  if (!index.has(first) || !index.has(second)) throw new GameError('Unknown tile');

  const match = first !== second && index.get(first) === index.get(second);
  const pair = game.content.pairs[index.get(first)];
  return { match, explanation: match ? pair.explanation ?? null : null };
}

function markMatching(game, answers) {
  const byToken = new Map(game.content.pairs.map((p, i) => [token(game.id, `r${i}`), p.right]));
  const feedback = game.content.pairs.map((p, i) => {
    const given = answers[token(game.id, `l${i}`)] ?? null;
    return {
      prompt: p.left,
      given: given === null ? null : byToken.get(given) ?? null,
      answer: p.right,
      correct: given === token(game.id, `r${i}`),
      explanation: p.explanation ?? null,
    };
  });
  return { feedback, score: feedback.filter((f) => f.correct).length, maxScore: feedback.length };
}

function markDragDrop(game, answers) {
  const feedback = game.content.items.map((it, i) => {
    const given = answers[token(game.id, `i${i}`)] ?? null;
    return {
      prompt: it.text,
      given: game.content.buckets.includes(given) ? given : null,
      answer: it.bucket,
      correct: given === it.bucket,
      explanation: it.explanation ?? null,
    };
  });
  return { feedback, score: feedback.filter((f) => f.correct).length, maxScore: feedback.length };
}

/*
 * Memory is marked by replaying the moves, not by trusting a score.
 *
 * Some misses are the game itself: a tile you have never seen cannot be
 * matched on purpose, and finding where things are is the point. So a round
 * gets two free misses per pair, and each two misses beyond that cost one
 * point. A pair never found scores nothing.
 */
function markMemory(game, answers) {
  const index = memoryIndex(game);
  const pairs = game.content.pairs.length;
  const found = new Set();
  let misses = 0;

  const moves = Array.isArray(answers.moves) ? answers.moves : [];
  for (const move of moves.slice(0, 500)) {
    if (!Array.isArray(move) || move.length !== 2) continue;
    const [a, b] = move;
    if (!index.has(a) || !index.has(b) || a === b) continue;
    const pa = index.get(a);
    if (found.has(pa) || found.has(index.get(b))) continue;
    if (pa === index.get(b)) found.add(pa);
    else misses += 1;
  }

  const penalty = Math.floor(Math.max(0, misses - 2 * pairs) / 2);
  const score = Math.max(0, found.size - penalty);

  const feedback = game.content.pairs.map((p, i) => ({
    prompt: p.a,
    given: found.has(i) ? p.b : null,
    answer: p.b,
    correct: found.has(i),
    explanation: p.explanation ?? null,
  }));
  return { feedback, score, maxScore: pairs, misses };
}

const MARKERS = { matching: markMatching, drag_drop: markDragDrop, memory: markMemory };

/**
 * Mark a finished game and store it as an attempt, in the same table as
 * quizzes, so progress and the class dashboards count both.
 */
async function markGameAttempt({ gameId, studentId, answers = {}, clientAttemptId }) {
  const game = await load(gameId);
  const { feedback, score, maxScore, misses } = MARKERS[game.kind](game, answers);

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
      ...(misses !== undefined ? { misses } : {}),
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
  getGameForStudent, checkMemoryPair, markGameAttempt, GameError, token,
};
