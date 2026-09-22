const express = require('express');
const Game = require('../models/Game');
const { authMiddleware } = require('../middleware/auth');
const {
  getGameForStudent, checkMove, markGameAttempt, GameError,
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
 * have one (memory tiles: { first, second }). Records nothing.
 */
router.post('/:id/check', async (req, res, next) => {
  const id = idFrom(req, res);
  if (id === null) return undefined;
  try {
    return res.json({ success: true, data: await checkMove(id, req.body) });
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

  const { answers, clientAttemptId } = req.body || {};
  if (answers !== undefined && (typeof answers !== 'object' || answers === null || Array.isArray(answers))) {
    return res.status(400).json({ error: 'answers must be an object' });
  }
  if (clientAttemptId !== undefined && !UUID.test(String(clientAttemptId))) {
    return res.status(400).json({ error: 'clientAttemptId must be a UUID' });
  }

  try {
    const result = await markGameAttempt({
      gameId: id, studentId: req.user.userId, answers: answers || {}, clientAttemptId,
    });
    return res.status(result.duplicate ? 200 : 201).json({ success: true, data: result });
  } catch (err) {
    return handle(err, res, next);
  }
});

module.exports = router;
