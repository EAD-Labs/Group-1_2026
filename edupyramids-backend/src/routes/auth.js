const express = require('express');
const authService = require('../services/authService');
const User = require('../models/User');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

/** 1. POST /api/auth/login */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password, role } = req.body || {};
    const result = await authService.login({
      email,
      password,
      role,
      ip: req.ip,
    });

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    return res.json({ success: true, user: result.user, token: result.token });
  } catch (err) {
    return next(err);
  }
});

/**
 * 2. POST /api/auth/logout
 *
 * A JWT cannot be recalled, so the client dropping it is what ends the session.
 * The endpoint exists so the client has one thing to call, and so a future
 * token blocklist has somewhere to live.
 */
router.post('/logout', authMiddleware, (req, res) => {
  res.json({ success: true, message: 'Signed out' });
});

/** 3. GET /api/auth/me — who the current token belongs to. */
router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    return res.json({ success: true, user });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
