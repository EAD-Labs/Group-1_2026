const express = require('express');
const Game = require('../models/Game');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

/** 7. GET /api/games */
router.get('/', async (req, res, next) => {
  try {
    const topicId = req.query.topicId ? Number(req.query.topicId) : undefined;
    const games = await Game.findAll({ topicId });
    res.json({ success: true, data: games });
  } catch (err) {
    next(err);
  }
});

/** 8. GET /api/games/:id */
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'Game id must be a number' });
    }

    const game = await Game.findById(id);
    if (!game) return res.status(404).json({ error: 'No such game' });
    return res.json({ success: true, data: game });
  } catch (err) {
    return next(err);
  }
});

/**
 * 9. POST /api/games/:id/results
 *
 * Week 5. When it lands it writes to the same `attempts` table the quiz route
 * uses, with kind = 'game', which is what lets one dashboard query cover both.
 */
router.post('/:id/results', (req, res) => {
  res.status(200).json({
    success: true,
    implemented: false,
    message: 'Saving a game result arrives in Week 5',
    data: null,
  });
});

module.exports = router;
