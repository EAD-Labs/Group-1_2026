const express = require('express');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { dailyFor, setGoal } = require('../services/dailyService');

/*
 * The signed-in student's own daily figures: XP, goal and streak.
 */
const router = express.Router();
router.use(authMiddleware, requireRole('student'));

/** GET /api/me/daily — today's XP against the goal, the streak and the last seven days. */
router.get('/daily', async (req, res, next) => {
  try {
    res.json({ success: true, data: await dailyFor(req.user.userId) });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/me/goal — { goal: 10 | 20 | 30 | 50 } */
router.put('/goal', async (req, res, next) => {
  try {
    res.json({ success: true, data: await setGoal(req.user.userId, Number(req.body?.goal)) });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    return next(err);
  }
});

module.exports = router;
