const express = require('express');
const Class = require('../models/Class');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

/**
 * 12. GET /api/classes
 *
 * The classes the caller may see, decided by their role rather than by a query
 * parameter: a coordinator gets every class, a teacher only their own, a
 * student only the one they are in. A dashboard needs this before it can ask
 * for any analytics, because nothing else tells it which class id to use.
 */
router.get('/', async (req, res, next) => {
  try {
    const classes = await Class.visibleTo(req.user);
    res.json({ success: true, data: classes });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
