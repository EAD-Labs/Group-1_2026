const express = require('express');
const Progress = require('../models/Progress');
const Badge = require('../models/Badge');
const Attempt = require('../models/Attempt');
const { authMiddleware, requireSelfOrStaff } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

/**
 * 10. GET /api/progress/:studentId
 *
 * A student may read only their own progress; teachers and coordinators may
 * read any student's. Enforced on the server, not by hiding a link.
 */
router.get('/:studentId', requireSelfOrStaff('studentId'), async (req, res, next) => {
  try {
    const studentId = Number(req.params.studentId);
    if (!Number.isInteger(studentId)) {
      return res.status(400).json({ error: 'Student id must be a number' });
    }

    const [summary, topics, badges, attempts] = await Promise.all([
      Progress.summaryForStudent(studentId),
      Progress.forStudent(studentId),
      Badge.forStudent(studentId),
      Attempt.forStudent(studentId, { limit: 20 }),
    ]);

    return res.json({
      success: true,
      data: { studentId, summary, topics, badges, recentAttempts: attempts },
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
