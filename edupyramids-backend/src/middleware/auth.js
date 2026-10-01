const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Verify the bearer token and hang the claims on req.user.
 *
 * A valid signature is not enough on its own: the account must still exist,
 * and the token must be newer than its password. A coordinator's reset, or a
 * person changing their own password, so ends every older session; without
 * this a token would go on working for days after the password it came from.
 *
 * Every failure returns a bare 401 with the same wording. Saying "expired" or
 * "malformed" tells whoever is probing which half of the token to work on.
 */
async function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Not signed in' });
  }

  let claims;
  try {
    claims = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Not signed in' });
  }
  try {
    const account = await User.sessionCheck(claims.userId);
    const changed = account?.passwordChangedAt;
    if (!account || (changed && Math.floor(new Date(changed).getTime() / 1000) > claims.iat)) {
      return res.status(401).json({ error: 'Not signed in' });
    }
  } catch (err) {
    return next(err);
  }
  req.user = claims;
  return next();
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
 * A student may read only their own record, a teacher only a student in one of
 * their classes (HLD test C5, one level down), a coordinator anyone's. Reads
 * the id from req.params[param].
 */
function requireSelfOrStaff(param = 'studentId') {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in' });
    const { role, userId } = req.user;
    if (role === 'coordinator' || String(userId) === String(req.params[param])) return next();
    try {
      if (role === 'teacher' && await User.teaches(userId, Number(req.params[param]))) return next();
    } catch (err) {
      return next(err);
    }
    return res.status(403).json({ error: 'Not allowed' });
  };
}

module.exports = { authMiddleware, requireRole, requireSelfOrStaff };
