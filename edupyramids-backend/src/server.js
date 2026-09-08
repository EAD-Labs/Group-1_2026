require('dotenv').config();

// Checked before the app is loaded: a server that starts without a signing key
// and only fails at the first login is worse than one that refuses to boot.
if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is not set. Copy .env.example to .env and set it.');
  process.exit(1);
}

const app = require('./app');
const { pool } = require('./config/database');

const PORT = Number(process.env.PORT) || 5000;

async function start() {
  try {
    await pool.query('SELECT 1');
    console.log(`[db] connected to ${process.env.DB_NAME} on ` +
      `${process.env.DB_HOST}:${process.env.DB_PORT}`);
  } catch (err) {
    console.error('[db] cannot connect:', err.message);
    console.error('Is PostgreSQL running, and does the database exist?');
    process.exit(1);
  }

  if (!process.env.SCHOOL_AUTH_URL) {
    console.log('[auth] SCHOOL_AUTH_URL not set — verifying passwords locally');
  }

  // The school database is optional. Say plainly which it is, so nobody spends
  // an afternoon wondering why the roster search returns nothing.
  const school = await require('./config/schoolDb').check();
  if (!school.connected) {
    console.log('[school-db] not connected — roster lookups are unavailable');
  } else {
    console.log(`[school-db] read-only mirror: ${Number(school.users).toLocaleString()} `
      + `accounts, ${Number(school.students).toLocaleString()} students`);
  }

  const server = app.listen(PORT, () => {
    console.log(`[api] listening on http://localhost:${PORT}`);
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      server.close(() => pool.end().then(() => process.exit(0)));
    });
  }
}

start();
