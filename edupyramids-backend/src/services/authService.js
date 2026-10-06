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
  coordinator: 'coordinator',
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
 * The client is adding the user's role to this response (meeting of 29
 * September), so it is read from whichever shape arrives: `user.role` or
 * `user.roles`, or the same at the top level. Without one, the role comes
 * from the school database copy, if there is one, or the existing account.
 *
 * Returns null when no URL is configured, or when their service cannot be
 * reached; the caller then falls back to the local users table.
 *
 * @returns {Promise<null | false | { spokenUserId, username, email, name, roles }>}
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
    const roles = [u.role, u.roles, data.role, data.roles].flat()
      .filter((r) => typeof r === 'string' && r.trim()).map((r) => r.trim().toLowerCase());
    return {
      spokenUserId: u.spoken_user_id,
      username: u.username,
      email: u.email,
      name: [u.first_name, u.last_name].filter(Boolean).join(' ').trim(),
      roles,
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
  const roleFits = (r) => Boolean(r) && (!role || r === role);
  const success = (u) => {
    clearFailures(email, ip);
    return { ok: true, user: User.toPublic(u), token: signToken(u) };
  };

  // 1. An account made in this app (the People page, test accounts) has its
  // own password. Hash a throwaway string when there is no account, so a
  // missing account and a wrong password take about the same time to answer.
  const hash = user ? user.passwordHash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
  if (await bcrypt.compare(password, hash) && roleFits(user.role)) return success(user);

  // 2. The school's login API: null (not set up, or unreachable), false
  // (definitely wrong), or who the person is. A first sign-in makes their
  // account here; the role comes from the API, else the school database
  // copy, else the account they already have.
  const remote = await verifyWithSchool(email, password);
  if (remote) {
    const fromCopy = await School.findForLogin(email).catch(() => null);
    const mapped = ourRole(remote.roles) || ourRole(fromCopy?.roles) || user?.role;
    if (roleFits(mapped)) {
      return success(await User.upsertFromSchool({
        email: remote.email || email,
        name: remote.name || remote.username || email,
        role: mapped,
        spokenUserId: remote.spokenUserId,
      }));
    }
  }

  // 3. Their API not set up or not answering: the school database copy.
  if (remote === null) {
    const fromSchool = await schoolLogin(email, password, role);
    if (fromSchool) return success(fromSchool);
  }

  // Every failure looks the same. See the note at the top of this file.
  recordFailure(email, ip);
  return { ok: false, status: 401, error: GENERIC_FAILURE };
}

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 72;   // bcrypt reads no further than 72 bytes

/**
 * Change your own password. The current one is asked for again, so a
 * computer left signed in cannot be used to take the account over, and wrong
 * guesses count towards the same lock-out as signing in. Every other session
 * ends; the one making the change gets a fresh token.
 *
 * @returns {{ ok: true, token } | { ok: false, status: number, error: string }}
 */
async function changePassword({ userId, current, next, ip }) {
  if (typeof current !== 'string' || typeof next !== 'string' || !current || !next) {
    return { ok: false, status: 400, error: 'Enter your current password and a new one' };
  }
  const user = await User.findByIdWithHash(userId);
  if (!user) return { ok: false, status: 401, error: 'Not signed in' };
  if (user.passwordHash === '!') {
    return { ok: false, status: 400, error: 'You sign in with your school account; change your password on the school site' };
  }
  if (isLockedOut(user.email, ip)) {
    return { ok: false, status: 429, error: 'Too many attempts. Wait a few minutes and try again.' };
  }
  if (!(await bcrypt.compare(current, user.passwordHash))) {
    recordFailure(user.email, ip);
    return { ok: false, status: 400, error: 'Your current password is not right' };
  }
  if (next.length < MIN_PASSWORD) {
    return { ok: false, status: 400, error: `The new password needs at least ${MIN_PASSWORD} characters` };
  }
  if (Buffer.byteLength(next) > MAX_PASSWORD) {
    return { ok: false, status: 400, error: `The new password can be at most ${MAX_PASSWORD} characters` };
  }
  if (next === current) {
    return { ok: false, status: 400, error: 'The new password is the same as the current one' };
  }
  clearFailures(user.email, ip);
  await User.setPassword(userId, await bcrypt.hash(next, 10));
  // A token issued in the same second as the change is still newer than it.
  return { ok: true, token: signToken(user) };
}

/** Clear the failed-login counters. Only for tests. */
function resetThrottle() {
  failures.clear();
}

module.exports = {
  login, signToken, changePassword, GENERIC_FAILURE, resetThrottle,
};
