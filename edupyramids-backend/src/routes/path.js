const express = require('express');
const { authMiddleware, requireRole } = require('../middleware/auth');
const {
  pathFor, startCheckpoint, finishCheckpoint, PathError,
} = require('../services/pathService');

/*
 * The learning path, for students: the course as one road, and the
 * checkpoints that open each next unit.
 */
const router = express.Router();
router.use(authMiddleware, requireRole('student'));

const topicFrom = (req, res) => {
  const id = Number(req.params.topicId);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Topic id must be a number' });
    return null;
  }
  return id;
};

const handle = (err, res, next) => (err instanceof PathError
  ? res.status(err.status).json({ error: err.message })
  : next(err));

/** GET /api/path — every unit, its nodes and their state, and the next thing to do. */
router.get('/', async (req, res, next) => {
  try {
    res.json({ success: true, data: await pathFor(req.user.userId) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/path/checkpoints/:topicId — a fresh mixed challenge, without answers. */
router.get('/checkpoints/:topicId', async (req, res, next) => {
  const topicId = topicFrom(req, res);
  if (topicId === null) return undefined;
  try {
    return res.json({ success: true, data: await startCheckpoint(req.user.userId, topicId) });
  } catch (err) {
    return handle(err, res, next);
  }
});

/** POST /api/path/checkpoints/:topicId — { ticket, answers: { [questionId]: letter } } */
router.post('/checkpoints/:topicId', async (req, res, next) => {
  const topicId = topicFrom(req, res);
  if (topicId === null) return undefined;
  const { ticket, answers } = req.body || {};
  if (typeof ticket !== 'string') return res.status(400).json({ error: 'ticket is required' });
  if (answers !== undefined && (typeof answers !== 'object' || answers === null || Array.isArray(answers))) {
    return res.status(400).json({ error: 'answers must be an object' });
  }
  try {
    const result = await finishCheckpoint({
      studentId: req.user.userId, topicId, ticket, answers: answers || {},
    });
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return handle(err, res, next);
  }
});

module.exports = router;
