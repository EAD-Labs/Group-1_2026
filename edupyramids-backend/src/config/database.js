const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'edupyramids_dev',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
});

// An idle client dying is normal (the database restarted, a network blip). It
// must not take the process down with it.
pool.on('error', (err) => {
  console.error('[db] idle client error:', err.message);
});

/** Run a query and return the rows. */
async function query(text, params) {
  const result = await pool.query(text, params);
  return result.rows;
}

/** Run a query expecting at most one row. */
async function queryOne(text, params) {
  const rows = await query(text, params);
  return rows[0] || null;
}

module.exports = { pool, query, queryOne };
