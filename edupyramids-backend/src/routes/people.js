const express = require('express');
const { authMiddleware, requireRole } = require('../middleware/auth');
const people = require('../services/peopleService');

/*
 * Managing users: classes, teachers and students. The programme coordinator
 * only (HLD Section 4). Starting passwords come back once, in the response,
 * for the coordinator to hand out; they are never stored or shown again.
 */
const router = express.Router();
router.use(authMiddleware, requireRole('coordinator'));

const idFrom = (value) => (Number.isInteger(Number(value)) ? Number(value) : null);
const fail = (err, res, next) => (err instanceof people.PeopleError
  ? res.status(err.status).json({ error: err.message })
  : next(err));
const handle = (work, status = 200) => async (req, res, next) => {
  try {
    const data = await work(req);
    return data === undefined ? res.status(204).end() : res.status(status).json({ success: true, data });
  } catch (err) {
    return fail(err, res, next);
  }
};
const needId = (param) => (req, res, next) => (idFrom(req.params[param]) === null
  ? res.status(400).json({ error: `${param} must be a number` }) : next());

// Starting passwords must not be kept by any cache on the way.
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

/** GET /api/people — classes with their students, and the teachers. */
router.get('/', handle(() => people.overview()));

/** POST /api/people/teachers — { name, email } -> { teacher, password } */
router.post('/teachers', handle((req) => people.createTeacher(req.body || {}), 201));

/** POST /api/people/classes — { name, teacherId } */
router.post('/classes', handle((req) => people.createClass(req.body || {}), 201));

/** PUT /api/people/classes/:classId — { name, teacherId } */
router.put('/classes/:classId', needId('classId'), handle((req) => people.updateClass(Number(req.params.classId), req.body || {})));

/** POST /api/people/classes/:classId/students — { students: [{ name, email }] } -> one result per line */
router.post('/classes/:classId/students', needId('classId'),
  handle((req) => people.addStudents(Number(req.params.classId), req.body?.students), 201));

/** DELETE /api/people/classes/:classId/students/:studentId — out of the class; the account stays. */
router.delete('/classes/:classId/students/:studentId', needId('classId'), needId('studentId'),
  handle(async (req) => { await people.removeStudent(Number(req.params.classId), Number(req.params.studentId)); }));

/** POST /api/people/users/:userId/password — a new starting password, returned once. */
router.post('/users/:userId/password', needId('userId'), handle((req) => people.resetPassword(Number(req.params.userId))));

module.exports = router;
