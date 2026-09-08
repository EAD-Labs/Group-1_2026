const jwt = require('jsonwebtoken');

/**
 * Verify the bearer token and hang the claims on req.user.
 *
 * Every failure returns a bare 401 with the same wording. Saying "expired" or
 * "malformed" tells whoever is probing which half of the token to work on.
 */
function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Not signed in' });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: 'Not signed in' });
  }
}

/**
 * Require one of the given roles. Must sit after authMiddleware.
 *
 * 403, not 401: the caller is signed in, they are simply not allowed here. The
 * body carries no detail about what lives at the route (HLD tests A3, C5, C8).
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    return next();
  };
}

/**
 * A student may read only their own record; staff may read any student's.
 * Reads the id from req.params[param].
 */
function requireSelfOrStaff(param = 'studentId') {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in' });
    if (req.user.role !== 'student') return next();
    if (String(req.user.userId) === String(req.params[param])) return next();
    return res.status(403).json({ error: 'Not allowed' });
  };
}

module.exports = { authMiddleware, requireRole, requireSelfOrStaff };
