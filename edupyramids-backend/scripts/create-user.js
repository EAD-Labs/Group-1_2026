#!/usr/bin/env node
/*
 * Make an account from the server's command line, and print its starting
 * password once.
 *
 * A new server has no accounts, and the People page needs a coordinator to
 * sign in first. Until the school login API is live, this is how the first
 * coordinator gets in; after that they make teachers and students on the
 * People page. With --reset it gives an existing account a new password
 * instead, which is the way back in for a coordinator who has forgotten
 * theirs (the People page resets everyone else).
 *
 *   node scripts/create-user.js coordinator name@school.org "Full Name"
 *   node scripts/create-user.js --reset name@school.org
 *
 * With Docker:  docker compose exec app node scripts/create-user.js ...
 */
require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool, queryOne } = require('../src/config/database');

const ROLES = ['student', 'teacher', 'coordinator'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USAGE = `Usage:
  node scripts/create-user.js <student|teacher|coordinator> <email> "<full name>"
  node scripts/create-user.js --reset <email>`;

class UsageError extends Error {}

// Longer than the People page's word passwords: this one is typed by the
// person who looks after the server, and changed on the Account page.
const newPassword = () => crypto.randomBytes(12).toString('base64url');

async function createUser({ role, email, name }) {
  const e = String(email || '').trim().toLowerCase();
  const n = String(name || '').trim().replace(/\s+/g, ' ');
  if (!ROLES.includes(role)) throw new UsageError(`The role must be one of: ${ROLES.join(', ')}`);
  if (!EMAIL.test(e)) throw new UsageError(`"${email}" is not an email address`);
  if (!n) throw new UsageError('Give the person\'s full name');
  if (await queryOne('SELECT id FROM users WHERE lower(email) = $1', [e])) {
    throw new UsageError(`${e} already has an account. Use --reset to give it a new password.`);
  }
  const password = newPassword();
  const user = await queryOne(
    `INSERT INTO users (email, password_hash, name, role, school_id)
     VALUES ($1, $2, $3, $4, 'school_001') RETURNING id, email, name, role`,
    [e, await bcrypt.hash(password, 10), n, role],
  );
  return { ...user, password };
}

async function resetUser({ email }) {
  const e = String(email || '').trim().toLowerCase();
  const password = newPassword();
  // Signs out every session on the old password (middleware/auth.js).
  const user = await queryOne(
    `UPDATE users SET password_hash = $2, password_changed_at = now()
      WHERE lower(email) = $1 RETURNING id, email, name, role`,
    [e, await bcrypt.hash(password, 10)],
  );
  if (!user) throw new UsageError(`No account has the email ${e}`);
  return { ...user, password };
}

async function main(args) {
  const user = args[0] === '--reset'
    ? await resetUser({ email: args[1] })
    : await createUser({ role: args[0], email: args[1], name: args.slice(2).join(' ') });
  console.log(`${args[0] === '--reset' ? 'New password for' : 'Made'} ${user.role} ${user.name} <${user.email}>`);
  console.log(`Starting password: ${user.password}`);
  console.log('Sign in and change it on the Account page (click your name).');
}

if (require.main === module) {
  main(process.argv.slice(2))
    .catch((err) => {
      console.error(err instanceof UsageError ? `${err.message}\n\n${USAGE}` : err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { createUser, resetUser, UsageError };
