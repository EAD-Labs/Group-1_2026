const express = require('express');
const Attempt = require('../models/Attempt');
const User = require('../models/User');
const { classMastery } = require('../services/masteryService');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

/**
 * 11. GET /api/analytics/classes/:classId
 *
 * Two separate checks, and both matter:
 *
 *   - students are refused outright (HLD test A3);
 *   - a teacher is refused any class that is not theirs, which is the one that
 *     stops Teacher A reading Class B by editing the URL (HLD test C5).
 *
 * A coordinator may read every class (HLD Section 4).
 */
router.get(
  '/classes/:classId',
  requireRole('teacher', 'coordinator'),
  async (req, res, next) => {
    try {
      const classId = Number(req.params.classId);
      if (!Number.isInteger(classId)) {
        return res.status(400).json({ error: 'Class id must be a number' });
      }

      if (req.user.role === 'teacher') {
        const owned = await User.classIdsForTeacher(req.user.userId);
        if (!owned.includes(classId)) {
          return res.status(403).json({ error: 'Not allowed' });
        }
      }

      const [byTopic, byStudent, hardest] = await Promise.all([
        Attempt.topicAveragesForClass(classId),
        Attempt.perStudentForClass(classId),
        Attempt.hardestQuestionsForClass(classId),
      ]);

      return res.json({
        success: true,
        data: {
          classId,
          students: byStudent.length,
          byTopic,
          byStudent,
          hardestQuestions: hardest,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

/**
 * GET /api/analytics/classes/:classId/mastery
 *
 * Students against concepts, each cell the mastery model's estimate. Same
 * access rule as the class report above.
 */
router.get(
  '/classes/:classId/mastery',
  requireRole('teacher', 'coordinator'),
  async (req, res, next) => {
    try {
      const classId = Number(req.params.classId);
      if (!Number.isInteger(classId)) {
        return res.status(400).json({ error: 'Class id must be a number' });
      }
      if (req.user.role === 'teacher') {
        const owned = await User.classIdsForTeacher(req.user.userId);
        if (!owned.includes(classId)) return res.status(403).json({ error: 'Not allowed' });
      }
      return res.json({ success: true, data: await classMastery(classId) });
    } catch (err) {
      return next(err);
    }
  },
);

/**
 * GET /api/analytics/students/:studentId — one student's attempt history.
 *
 * Staff only, and a teacher only gets students in a class they own: the same
 * rule as the class report, applied one level down.
 */
router.get('/students/:studentId', requireRole('teacher', 'coordinator'),
  async (req, res, next) => {
    try {
      const studentId = Number(req.params.studentId);
      if (!Number.isInteger(studentId)) {
        return res.status(400).json({ error: 'Student id must be a number' });
      }

      if (req.user.role === 'teacher') {
        const mine = await User.classIdsForTeacher(req.user.userId);
        const theirs = await User.classIdsForStudent(studentId);
        if (!theirs.some((c) => mine.includes(c))) {
          return res.status(403).json({ error: 'Not allowed' });
        }
      }

      const history = await Attempt.historyForStudent(studentId);
      return res.json({ success: true, data: { studentId, history } });
    } catch (err) {
      return next(err);
    }
  });

module.exports = router;
