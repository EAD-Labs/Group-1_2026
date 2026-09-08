const express = require('express');
const School = require('../models/School');
const schoolDb = require('../config/schoolDb');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

/*
 * Reads from the client's school database.
 *
 * Coordinators only. This is a roster of over a million real people, with names
 * and email addresses; there is no reason for a student or a class teacher to
 * be able to page through it.
 */
router.use(requireRole('coordinator'));

/** 13. GET /api/school/stats — is the mirror connected, and what is in it. */
router.get('/stats', async (req, res, next) => {
  try {
    if (!schoolDb.isConfigured()) {
      return res.json({ success: true, data: { connected: false } });
    }
    const [stats, levels] = await Promise.all([School.stats(), School.levels()]);
    return res.json({ success: true, data: { connected: true, ...stats, levels } });
  } catch (err) {
    return next(err);
  }
});

/**
 * 14. GET /api/school/students?q=  — search the roster.
 *
 * A search term is required. Without one this would be "give me a million
 * people", which is neither useful nor something to expose.
 */
router.get('/students', async (req, res, next) => {
  try {
    const term = (req.query.q || '').trim();
    if (term.length < 3) {
      return res.status(400).json({ error: 'Search for at least three characters' });
    }
    const results = await School.searchAccounts(term, req.query.limit);
    return res.json({ success: true, data: results });
  } catch (err) {
    if (err instanceof schoolDb.SchoolDbUnavailable) {
      return res.status(err.status).json({ error: err.message });
    }
    return next(err);
  }
});

module.exports = router;
