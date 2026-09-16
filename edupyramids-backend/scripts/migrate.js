#!/usr/bin/env node
/*
 * Apply every file in migrations/, in name order.
 *
 * The same job as `npm run migrate`, without needing psql on the machine: a
 * host like Render has Node but no PostgreSQL client. Every migration is
 * written to be safe to re-run (IF NOT EXISTS, DROP ... IF EXISTS), so this
 * runs them all on each deploy rather than keeping a record of which ran.
 *
 *   node scripts/migrate.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/database');

const dir = path.join(__dirname, '..', 'migrations');

async function main() {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    // No parameters, so pg sends the file as one simple query and PostgreSQL
    // runs its statements in order, BEGIN/COMMIT included.
    await pool.query(fs.readFileSync(path.join(dir, file), 'utf8'));
    console.log(`[migrate] ${file}`);
  }
  await pool.end();
}

main().catch(async (err) => {
  console.error('[migrate] failed:', err.message);
  await pool.end();
  process.exit(1);
});
