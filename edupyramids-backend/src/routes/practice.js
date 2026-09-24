const express = require('express');
const { authMiddleware, requireRole } = require('../middleware/auth');
const {
  masteryFor, nextPracticeQuestion, answerPractice, PracticeError,
} = require('../services/masteryService');

/*
 * Adaptive practice, for students.
 *
 * A practice session lives in the browser: it is a list of question ids
 * already shown, sent back as `exclude`. Nothing about the session itself is
 * stored. Every answer is, through the mastery model.
 */
const router = express.Router();
router.use(authMiddleware, requireRole('student'));

/** GET /api/practice/mastery — every concept with this student's estimate. */
router.get('/mastery', async (req, res, next) => {
  try {
    res.json({ success: true, data: await masteryFor(req.user.userId) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/practice/next?exclude=1,2,3&focus=loops,strings — the next
 * question, and why it was chosen. focus keeps to those concepts (a review
 * started from the path).
 */
router.get('/next', async (req, res, next) => {
  try {
    const exclude = String(req.query.exclude || '')
      .split(',').filter(Boolean).map(Number).filter(Number.isInteger).slice(0, 200);
    const focus = String(req.query.focus || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20);
    const pick = await nextPracticeQuestion(req.user.userId, exclude, focus);
    if (!pick) return res.status(404).json({ error: 'No more questions to practise right now' });
    return res.json({ success: true, data: pick });
  } catch (err) {
    return next(err);
  }
});

/** POST /api/practice/answer — { questionId, answer } */
router.post('/answer', async (req, res, next) => {
  try {
    const { questionId, answer } = req.body || {};
    if (!Number.isInteger(Number(questionId))) {
      return res.status(400).json({ error: 'questionId must be a number' });
    }
    if (!['a', 'b', 'c', 'd', 'e'].includes(answer)) {
      return res.status(400).json({ error: 'answer must be a letter from a to e' });
    }
    const result = await answerPractice({
      studentId: req.user.userId, questionId: Number(questionId), answer,
    });
    // Each practice answer earns 2 XP (see services/dailyService.js).
    return res.json({ success: true, data: { ...result, xp: 2 } });
  } catch (err) {
    if (err instanceof PracticeError) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
});

module.exports = router;
