const express = require('express');
const Game = require('../models/Game');
const { authMiddleware } = require('../middleware/auth');
const {
  getGameForStudent, checkMove, giveHint, markGameAttempt, GameError,
} = require('../services/gameService');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = express.Router();
router.use(authMiddleware);

const idFrom = (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Game id must be a number' });
    return null;
  }
  return id;
};

const handle = (err, res, next) => (err instanceof GameError
  ? res.status(err.status).json({ error: err.message })
  : next(err));

/** 7. GET /api/games — with this student's best score on each. */
router.get('/', async (req, res, next) => {
  try {
    const topicId = req.query.topicId ? Number(req.query.topicId) : undefined;
    const games = await Game.findAll({ topicId, studentId: req.user.userId });
    res.json({ success: true, data: games });
  } catch (err) {
    next(err);
  }
});

/** 8. GET /api/games/:id — shuffled, with no answer key. */
router.get('/:id', async (req, res, next) => {
  const id = idFrom(req, res);
  if (id === null) return undefined;
  try {
    return res.json({ success: true, data: await getGameForStudent(id) });
  } catch (err) {
    return handle(err, res, next);
  }
});

/**
 * POST /api/games/:id/check — an instant check during play, for kinds that
 * have one (memory: { first, second }; trace: { step, value }), with the
 * attempt's clientAttemptId. Recorded, and the marking uses what was checked.
 */
router.post('/:id/check', async (req, res, next) => {
  const id = idFrom(req, res);
  if (id === null) return undefined;
  const clientAttemptId = req.body?.clientAttemptId;
  if (!UUID.test(String(clientAttemptId))) return res.status(400).json({ error: 'clientAttemptId must be a UUID' });
  try {
    return res.json({
      success: true,
      data: await checkMove(id, req.body, { studentId: req.user.userId, clientAttemptId }),
    });
  } catch (err) {
    return handle(err, res, next);
  }
});

/**
 * POST /api/games/:id/hint — { clientAttemptId, item, level }
 *
 * A hint for one item (a program, a step, a function; "program" for a
 * Parsons puzzle). Recorded against this attempt: any hint costs the third
 * star. Levels go from a nudge up to maxLevel.
 */
router.post('/:id/hint', async (req, res, next) => {
  const id = idFrom(req, res);
  if (id === null) return undefined;
  const { clientAttemptId, item, level } = req.body || {};
  if (!UUID.test(String(clientAttemptId))) return res.status(400).json({ error: 'clientAttemptId must be a UUID' });
  if (typeof item !== 'string' || !item || item.length > 64) return res.status(400).json({ error: 'item is required' });
  if (!Number.isInteger(level) || level < 1 || level > 3) return res.status(400).json({ error: 'level must be 1, 2 or 3' });
  try {
    return res.json({
      success: true,
      data: await giveHint({
        gameId: id, studentId: req.user.userId, clientAttemptId, item, level,
      }),
    });
  } catch (err) {
    return handle(err, res, next);
  }
});

/**
 * 9. POST /api/games/:id/results
 *
 * Body: { answers, clientAttemptId?: uuid }
 *   matching   answers = { [leftId]: rightId }
 *   drag_drop  answers = { [itemId]: bucketName }
 *   memory     answers = { moves: [[tileId, tileId], ...] }
 *   (every kind documents its own shape in src/games/<kind>.js)
 *
 * Written to the same attempts table as quizzes, with kind = 'game'. The
 * student id comes from the token, never the body.
 */
router.post('/:id/results', async (req, res, next) => {
  const id = idFrom(req, res);
  if (id === null) return undefined;

  const { answers, clientAttemptId, answeredAt } = req.body || {};
  if (answers !== undefined && (typeof answers !== 'object' || answers === null || Array.isArray(answers))) {
    return res.status(400).json({ error: 'answers must be an object' });
  }
  if (clientAttemptId !== undefined && !UUID.test(String(clientAttemptId))) {
    return res.status(400).json({ error: 'clientAttemptId must be a UUID' });
  }

  try {
    const result = await markGameAttempt({
      gameId: id, studentId: req.user.userId, answers: answers || {}, clientAttemptId, answeredAt,
    });
    return res.status(result.duplicate ? 200 : 201).json({ success: true, data: result });
  } catch (err) {
    return handle(err, res, next);
  }
});

module.exports = router;
