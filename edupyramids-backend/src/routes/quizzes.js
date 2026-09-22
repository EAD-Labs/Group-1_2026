const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { listQuizzes, getQuizForStudent, QuizNotFound } = require('../services/quizService');
const { markQuizAttempt, checkAnswer, ScoringError } = require('../services/scoringService');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = express.Router();
router.use(authMiddleware);

/**
 * 4. GET /api/quizzes
 *
 * A real query against a real table. The table is empty until the client's MCQ
 * file is loaded in Week 4, so this answers with an empty list rather than
 * sample questions nobody wrote.
 */
router.get('/', async (req, res, next) => {
  try {
    const topicId = req.query.topicId ? Number(req.query.topicId) : undefined;
    res.json({ success: true, data: await listQuizzes({ topicId }) });
  } catch (err) {
    next(err);
  }
});

/** 5. GET /api/quizzes/:id — one quiz and its questions, without the answer key. */
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'Quiz id must be a number' });
    }

    return res.json({ success: true, data: await getQuizForStudent(id) });
  } catch (err) {
    if (err instanceof QuizNotFound) {
      return res.status(err.status).json({ error: err.message });
    }
    return next(err);
  }
});

/**
 * POST /api/quizzes/:id/check  — mark one answer, so the student is told at
 * once whether they were right and why (HLD Section 6.3).
 *
 * The answer key stays here rather than travelling with the questions, which is
 * why this needs a round trip at all.
 *
 * ponytail: nothing stops a determined student calling this repeatedly to find
 * the answer before committing. The score that counts still comes from the
 * submit below, which marks every question server-side. Record-on-first-check
 * if that ever matters.
 */
router.post('/:id/check', async (req, res, next) => {
  try {
    const { questionId, answer } = req.body || {};
    if (!Number.isInteger(Number(questionId))) {
      return res.status(400).json({ error: 'questionId must be a number' });
    }
    const verdict = await checkAnswer(Number(req.params.id), Number(questionId), answer);
    if (!verdict) return res.status(404).json({ error: 'No such question' });
    return res.json({ success: true, data: verdict });
  } catch (err) {
    return next(err);
  }
});

/**
 * 6. POST /api/quizzes/:id/attempts
 *
 * Body: { answers: { [questionId]: 'a'|'b'|'c'|'d' }, clientAttemptId?: uuid }
 *
 * The student id comes from the token, never from the body: taking it from the
 * body would let anyone file an attempt under someone else's name.
 */
router.post('/:id/attempts', async (req, res, next) => {
  try {
    const quizId = Number(req.params.id);
    if (!Number.isInteger(quizId)) {
      return res.status(400).json({ error: 'Quiz id must be a number' });
    }

    const { answers, clientAttemptId, answeredAt } = req.body || {};
    if (answers !== undefined && (typeof answers !== 'object' || Array.isArray(answers))) {
      return res.status(400).json({ error: 'answers must be an object of questionId to letter' });
    }
    if (clientAttemptId !== undefined && !UUID.test(String(clientAttemptId))) {
      return res.status(400).json({ error: 'clientAttemptId must be a UUID' });
    }

    const result = await markQuizAttempt({
      quizId,
      studentId: req.user.userId,
      answers: answers || {},
      clientAttemptId,
      answeredAt,
    });

    return res.status(result.duplicate ? 200 : 201).json({ success: true, data: result });
  } catch (err) {
    if (err instanceof ScoringError) {
      return res.status(err.status).json({ error: err.message });
    }
    return next(err);
  }
});

module.exports = router;
