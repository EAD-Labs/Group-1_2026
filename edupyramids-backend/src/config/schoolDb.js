const { Pool } = require('pg');

/*
 * A second, read-only connection to the client's school database.
 *
 * This is a source, never a destination. EduPyramids owns no tables here and
 * writes nothing: quizzes, attempts, progress and badges all live in our own
 * database. Everything below is a SELECT, and the pool asks the server to
 * enforce that too, so a mistake in a future query fails loudly instead of
 * quietly modifying the client's records.
 *
 * If SCHOOL_DB_NAME is not set the app runs without it. Every caller must cope
 * with that, because the school database is the client's to provide and may not
 * be reachable from wherever this is deployed.
 */

const configured = Boolean(process.env.SCHOOL_DB_NAME);

const pool = configured
  ? new Pool({
    host: process.env.SCHOOL_DB_HOST || process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.SCHOOL_DB_PORT || process.env.DB_PORT) || 5432,
    database: process.env.SCHOOL_DB_NAME,
    user: process.env.SCHOOL_DB_USER || process.env.DB_USER || 'postgres',
    password: process.env.SCHOOL_DB_PASSWORD || process.env.DB_PASSWORD || undefined,
    max: 5,
    idleTimeoutMillis: 30_000,
    // Belt and braces: even a stray UPDATE would be refused by the server.
    options: '-c default_transaction_read_only=on',
  })
  : null;

if (pool) {
  pool.on('error', (err) => {
    console.error('[school-db] idle client error:', err.message);
  });
}

function isConfigured() {
  return configured;
}

class SchoolDbUnavailable extends Error {
  constructor() {
    super('The school database is not connected');
    this.status = 503;
  }
}

async function query(text, params) {
  if (!pool) throw new SchoolDbUnavailable();
  const result = await pool.query(text, params);
  return result.rows;
}

async function queryOne(text, params) {
  const rows = await query(text, params);
  return rows[0] || null;
}

/** Used at startup to say plainly whether the mirror is there. */
async function check() {
  if (!pool) return { connected: false };
  try {
    const row = await queryOne(
      `SELECT (SELECT count(*) FROM accounts_user)        AS users,
              (SELECT count(*) FROM stp_training_student) AS students,
              (SELECT count(*) FROM stp_training_batch)   AS batches`,
    );
    return { connected: true, ...row };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

module.exports = { pool, query, queryOne, isConfigured, check, SchoolDbUnavailable };
