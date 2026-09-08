/*
 * Build the test database from scratch before the suites run.
 *
 * Dropping and recreating every table each time is deliberate: a test that only
 * passes because of a row left behind by an earlier run is worse than no test.
 */
require('./env');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const MIGRATIONS = ['001_init.sql', '002_attempt_idempotency.sql', '003_option_e.sql'];

module.exports = async function globalSetup() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || undefined,
  });

  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

  for (const file of MIGRATIONS) {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', file), 'utf8');
    await pool.query(sql);
  }

  const hash = await bcrypt.hash('password123', 10);
  const users = [
    ['student1@school.com', 'Aditya Sharma', 'student'],
    ['student2@school.com', 'Priya Sundaram', 'student'],
    ['student3@school.com', 'Rahul Menon', 'student'],
    ['teacher1@school.com', 'Mrs Rao', 'teacher'],
    ['teacher2@school.com', 'Mr Iyer', 'teacher'],
    ['coordinator@school.com', 'Mr Johnson', 'coordinator'],
  ];
  for (const [email, name, role] of users) {
    await pool.query(
      `INSERT INTO users (email, password_hash, name, role, school_id)
       VALUES ($1, $2, $3, $4, 'school_001')`,
      [email, hash, name, role],
    );
  }

  const id = async (email) =>
    (await pool.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id;

  const classA = (await pool.query(
    `INSERT INTO classes (name, teacher_id, school_id)
     VALUES ('Grade 9-A', $1, 'school_001') RETURNING id`,
    [await id('teacher1@school.com')],
  )).rows[0].id;

  const classB = (await pool.query(
    `INSERT INTO classes (name, teacher_id, school_id)
     VALUES ('Grade 9-B', $1, 'school_001') RETURNING id`,
    [await id('teacher2@school.com')],
  )).rows[0].id;

  await pool.query('INSERT INTO class_students VALUES ($1, $2)', [classA, await id('student1@school.com')]);
  await pool.query('INSERT INTO class_students VALUES ($1, $2)', [classA, await id('student2@school.com')]);
  // student3 is enrolled but never attempts anything, which is what the
  // empty-state test needs.
  await pool.query('INSERT INTO class_students VALUES ($1, $2)', [classB, await id('student3@school.com')]);

  await pool.end();

  // Load the sample questions through the real importer, so the tests exercise
  // the same path an operator would use.
  const { load } = require('../scripts/import-questions');
  const content = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'content', 'sample-questions.json'), 'utf8'),
  );
  await load(content, { replace: false });
  await require('../src/config/database').pool.end();
};
