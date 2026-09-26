const express = require('express');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { query } = require('../config/database');
const manage = require('../services/manageService');

/*
 * Content management, for the programme coordinator only (HLD Section 4:
 * teachers view progress but do not edit content). Test C8: an edit is saved
 * and shown to students.
 */
const router = express.Router();
router.use(authMiddleware, requireRole('coordinator'));

const idFrom = (value) => (Number.isInteger(Number(value)) ? Number(value) : null);
const fail = (err, res, next) => (err instanceof manage.ManageError
  ? res.status(err.status).json({ error: err.message })
  : next(err));

/** GET /api/manage/quizzes — every quiz with its topic and question count; plus topics and concepts for the forms. */
router.get('/quizzes', async (req, res, next) => {
  try {
    const [quizzes, topics, concepts] = await Promise.all([
      manage.listQuizzes(),
      query('SELECT id, name, level FROM topics ORDER BY sort_order, level, id'),
      query('SELECT slug, name FROM concepts ORDER BY sort_order'),
    ]);
    res.json({ success: true, data: { quizzes, topics, concepts } });
  } catch (err) {
    next(err);
  }
});

/** POST /api/manage/quizzes — { topicId, title } */
router.post('/quizzes', async (req, res, next) => {
  try {
    res.status(201).json({ success: true, data: await manage.createQuiz(req.body || {}) });
  } catch (err) {
    fail(err, res, next);
  }
});

/** GET /api/manage/quizzes/:id/questions — with answers, explanations and concepts. */
router.get('/quizzes/:id/questions', async (req, res, next) => {
  const id = idFrom(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Quiz id must be a number' });
  try {
    return res.json({ success: true, data: await manage.questionsFor(id) });
  } catch (err) {
    return fail(err, res, next);
  }
});

/** POST /api/manage/quizzes/:id/questions — { text, options: { a..e }, correct, explanation, concepts } */
router.post('/quizzes/:id/questions', async (req, res, next) => {
  const id = idFrom(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Quiz id must be a number' });
  try {
    return res.status(201).json({ success: true, data: await manage.createQuestion(id, req.body, req.user.userId) });
  } catch (err) {
    return fail(err, res, next);
  }
});

/** PUT /api/manage/questions/:id — the whole question, as above. */
router.put('/questions/:id', async (req, res, next) => {
  const id = idFrom(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Question id must be a number' });
  try {
    return res.json({ success: true, data: await manage.updateQuestion(id, req.body, req.user.userId) });
  } catch (err) {
    return fail(err, res, next);
  }
});

/** DELETE /api/manage/questions/:id */
router.delete('/questions/:id', async (req, res, next) => {
  const id = idFrom(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Question id must be a number' });
  try {
    await manage.deleteQuestion(id);
    return res.status(204).end();
  } catch (err) {
    return fail(err, res, next);
  }
});

module.exports = router;
