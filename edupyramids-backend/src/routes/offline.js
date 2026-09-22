const crypto = require('crypto');
const express = require('express');
const { query } = require('../config/database');
const { authMiddleware, requireRole } = require('../middleware/auth');
const Game = require('../models/Game');
const { kindOf } = require('../games');

/*
 * GET /api/offline/pack — everything a student's device needs to run quizzes
 * and games with no connection, including the answer keys.
 *
 * Sending the keys is a deliberate trade, made only when a student turns
 * offline use on: without them the device cannot mark anything. It does not
 * weaken the record, because every attempt made offline is uploaded as raw
 * answers and marked again here, by the same code as an online attempt.
 *
 * `version` changes whenever the content does, so the device only downloads
 * again when there is something new.
 */
const router = express.Router();
router.use(authMiddleware, requireRole('student'));

async function buildPack() {
  const quizRows = await query(
    `SELECT z.id, z.title, z.topic_id AS "topicId", t.name AS topic, t.level
       FROM quizzes z JOIN topics t ON t.id = z.topic_id
      ORDER BY t.sort_order, t.id, z.id`,
  );
  const questionRows = await query(
    `SELECT id, quiz_id AS "quizId", text,
            option_a AS "optionA", option_b AS "optionB", option_c AS "optionC",
            option_d AS "optionD", option_e AS "optionE",
            correct_answer AS correct, explanation
       FROM questions ORDER BY id`,
  );
  const quizzes = quizRows.map((z) => ({
    ...z,
    questions: questionRows.filter((q) => q.quizId === z.id).map(({ quizId, ...q }) => q),
  }));

  const games = [];
  for (const row of await query('SELECT id FROM games ORDER BY id')) {
    const game = await Game.findById(row.id);
    const kind = kindOf(game.kind);
    if (!kind || !kind.offlineKey) continue;
    games.push({
      id: game.id,
      title: game.title,
      kind: game.kind,
      instructions: game.instructions,
      topicId: game.topicId,
      topic: game.topic,
      ...kind.deliver(game),
      key: kind.offlineKey(game),
    });
  }

  // The version follows the content, not the shuffle, so a re-download of the
  // same content is recognised as unchanged.
  const version = crypto.createHash('sha256')
    .update(JSON.stringify({
      quizzes: quizzes.map((z) => [z.id, z.questions.map((q) => [q.id, q.correct, q.explanation])]),
      games: games.map((g) => [g.id, g.key]),
    }))
    .digest('hex')
    .slice(0, 16);

  return { version, generatedAt: new Date().toISOString(), quizzes, games };
}

router.get('/pack', async (req, res, next) => {
  try {
    const pack = await buildPack();
    if (req.query.have === pack.version) return res.json({ success: true, unchanged: true, version: pack.version });
    return res.json({ success: true, data: pack });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
