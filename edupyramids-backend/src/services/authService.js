const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const School = require('../models/School');
const { verifyDjangoPassword } = require('./djangoPassword');

/*
 * Their role vocabulary is wider than ours. Mapping is a guess until the client
 * confirms it — their `teacher` role has one record and it is not approved,
 * while `main_school_coord` has 577.
 * ponytail: plain object, move to env when they give us the real answer.
 */
const ROLE_MAP = {
  student: 'student',
  invigilator: 'teacher',
  teacher: 'teacher',
  main_school_coord: 'coordinator',
  national_coord: 'coordinator',
  org_partner: 'coordinator',
};

const ourRole = (roles = []) => {
  for (const r of ['main_school_coord', 'national_coord', 'org_partner',
    'invigilator', 'teacher', 'student']) {
    if (roles.includes(r)) return ROLE_MAP[r];
  }
  return null;
};

/** Sign in with the school's own credentials, from the mirrored database. */
async function schoolLogin(email, password, role) {
  const acct = await School.findForLogin(email).catch(() => null);
  if (!acct || !acct.isActive) return null;
  if (!verifyDjangoPassword(password, acct.password)) return null;

  const mapped = ourRole(acct.roles);
  if (!mapped || (role && mapped !== role)) return null;

  return User.upsertFromSchool({
    email: acct.email,
    name: acct.name,
    role: mapped,
    spokenUserId: acct.spokenUserId,
  });
}

/*
 * One deliberate rule runs through this file: every failed sign-in looks
 * identical from outside.
 *
 * Unknown email, wrong password, right password but the wrong role tab — all
 * return the same status and the same sentence. The draft specification
 * returned a distinct "Role mismatch", which tells an attacker that the address
 * exists and what the account is for. HLD test A2 requires the opposite.
 */
const GENERIC_FAILURE = 'Invalid email or password';

// email+IP -> { count, firstAt }. In memory on purpose: this is a single
// process at pilot scale. A second instance needs this moved to the database
// or a cache, and that is called out in the README.
const failures = new Map();

function throttleKey(email, ip) {
  return `${String(email).toLowerCase()}|${ip}`;
}

function maxAttempts() {
  return Number(process.env.LOGIN_MAX_ATTEMPTS) || 5;
}

function windowMs() {
  return (Number(process.env.LOGIN_WINDOW_MINUTES) || 15) * 60_000;
}

function isLockedOut(email, ip) {
  const entry = failures.get(throttleKey(email, ip));
  if (!entry) return false;
  if (Date.now() - entry.firstAt > windowMs()) {
    failures.delete(throttleKey(email, ip));
    return false;
  }
  return entry.count >= maxAttempts();
}

function recordFailure(email, ip) {
  const key = throttleKey(email, ip);
  const entry = failures.get(key);
  if (!entry || Date.now() - entry.firstAt > windowMs()) {
    failures.set(key, { count: 1, firstAt: Date.now() });
  } else {
    entry.count += 1;
  }
}

function clearFailures(email, ip) {
  failures.delete(throttleKey(email, ip));
}

/**
 * Ask Spoken Tutorial whether these credentials are good.
 *
 * Written against their own endpoint rather than a guess. From
 * spoken-website/api/views.py, `verify_spoken_social_user`:
 *
 *   POST  /api/spoken-social/verify-user/
 *   body  { "email": "...", "password": "..." }
 *
 *   200   { status: 'success',
 *           user: { spoken_user_id, username, email, first_name, last_name } }
 *   401   { status: 'error', message: 'Invalid credentials' }
 *   403   { status: 'error', message: 'Account is disabled' }
 *
 * Note what is *not* in the response: a role. Their site knows who someone is,
 * not what they are here, so the role is read separately from the school
 * database using spoken_user_id.
 *
 * Returns null when no URL is configured, or when their service cannot be
 * reached; the caller then falls back to the local users table.
 *
 * @returns {Promise<null | false | { spokenUserId, username, email, name }>}
 */
async function verifyWithSchool(email, password) {
  const url = process.env.SCHOOL_AUTH_URL;
  if (!url) return null;

  try {
    const { data } = await axios.post(
      url,
      { email, password },
      {
        timeout: 5000,
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.SCHOOL_AUTH_API_KEY
            ? { Authorization: `Bearer ${process.env.SCHOOL_AUTH_API_KEY}` }
            : {}),
        },
      },
    );

    if (data.status !== 'success' || !data.user) return false;
    const u = data.user;
    return {
      spokenUserId: u.spoken_user_id,
      username: u.username,
      email: u.email,
      name: [u.first_name, u.last_name].filter(Boolean).join(' ').trim(),
    };
  } catch (err) {
    const status = err.response && err.response.status;

    // 401 is "wrong password" and 403 is "account disabled". Both are a
    // definite no, and neither should fall through to the local check.
    if (status === 401 || status === 403) return false;

    // Anything else — a timeout, a 500, DNS failure — means we do not know.
    // Refusing every login because their server is having a bad morning would
    // lock the whole school out, so fall back and say so in the log.
    console.error('[auth] Spoken Tutorial verify-user unreachable:', err.message);
    return null;
  }
}

function signToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRY || '7d' },
  );
}

/**
 * @returns {{ ok: true, user, token } | { ok: false, status: number, error: string }}
 */
async function login({ email, password, role, ip }) {
  if (!email || !password) {
    return { ok: false, status: 400, error: 'Email and password are required' };
  }

  if (isLockedOut(email, ip)) {
    return {
      ok: false,
      status: 429,
      error: 'Too many attempts. Wait a few minutes and try again.',
    };
  }

  const user = await User.findByEmailWithHash(email);

  // Hash a throwaway string when the account does not exist, so a missing
  // account and a wrong password take about the same time to answer.
  const hash = user ? user.passwordHash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
  const passwordOk = await bcrypt.compare(password, hash);

  // `remote` is null (do not know), false (definitely wrong), or the person's
  // details from Spoken Tutorial.
  const remote = user ? await verifyWithSchool(email, password) : null;
  const credentialsOk = remote === null ? passwordOk : Boolean(remote);

  // The role tab must match, but a mismatch is reported exactly like a wrong
  // password. See the note at the top of this file.
  const roleOk = !role || (user && user.role === role);

  if (!user || !credentialsOk || !roleOk) {
    // No local account, or it did not match: try the school's own credentials.
    const fromSchool = await schoolLogin(email, password, role);
    if (fromSchool) {
      clearFailures(email, ip);
      return { ok: true, user: fromSchool, token: signToken(fromSchool) };
    }
    recordFailure(email, ip);
    return { ok: false, status: 401, error: GENERIC_FAILURE };
  }

  clearFailures(email, ip);
  return { ok: true, user: User.toPublic(user), token: signToken(user) };
}

/** Clear the failed-login counters. Only for tests. */
function resetThrottle() {
  failures.clear();
}

module.exports = { login, signToken, GENERIC_FAILURE, resetThrottle };
