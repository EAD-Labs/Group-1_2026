#!/usr/bin/env node
/*
 * Seed the development database.
 *
 * Passwords are hashed here rather than pasted into a .sql file, because a
 * hardcoded hash in a repository is a hash somebody eventually reuses in
 * production. Re-running is safe: everything is keyed on a unique column and
 * conflicts do nothing.
 *
 * Two classes with two different teachers are seeded on purpose. One class
 * cannot demonstrate that Teacher A is kept out of Class B (HLD test C5), and
 * one student who has attempted nothing is what test C7 needs.
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool, query, queryOne } = require('../src/config/database');

const PASSWORD = 'password123';

// Topics come from the content files (the importers), not from here.

const USERS = [
  ['student1@school.com', 'Aditya Sharma', 'student', 'school_001'],
  ['student2@school.com', 'Priya Sundaram', 'student', 'school_001'],
  ['student3@school.com', 'Rahul Menon', 'student', 'school_001'],
  ['teacher1@school.com', 'Mrs Rao', 'teacher', 'school_001'],
  ['teacher2@school.com', 'Mr Iyer', 'teacher', 'school_001'],
  ['coordinator@school.com', 'Mr Johnson', 'coordinator', 'school_001'],
];

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 10);

  for (const [email, name, role, schoolId] of USERS) {
    await query(
      `INSERT INTO users (email, password_hash, name, role, school_id)
            VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE
          SET name = EXCLUDED.name, role = EXCLUDED.role`,
      [email, hash, name, role, schoolId],
    );
  }

  const idFor = async (email) =>
    (await queryOne('SELECT id FROM users WHERE email = $1', [email])).id;

  const teacherA = await idFor('teacher1@school.com');
  const teacherB = await idFor('teacher2@school.com');

  const classFor = async (name, teacherId) => {
    const existing = await queryOne('SELECT id FROM classes WHERE name = $1', [name]);
    if (existing) return existing.id;
    const row = await queryOne(
      `INSERT INTO classes (name, teacher_id, school_id)
            VALUES ($1, $2, 'school_001') RETURNING id`,
      [name, teacherId],
    );
    return row.id;
  };

  const classA = await classFor('Grade 9-A', teacherA);
  const classB = await classFor('Grade 9-B', teacherB);

  const enrol = (classId, studentId) =>
    query(
      `INSERT INTO class_students (class_id, student_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [classId, studentId],
    );

  await enrol(classA, await idFor('student1@school.com'));
  await enrol(classA, await idFor('student2@school.com'));
  await enrol(classB, await idFor('student3@school.com'));

  const counts = await queryOne(
    `SELECT (SELECT count(*) FROM users)   AS users,
            (SELECT count(*) FROM classes) AS classes,
            (SELECT count(*) FROM topics)  AS topics`,
  );

  console.log('Seeded.');
  console.log(`  users ${counts.users}, classes ${counts.classes}, topics ${counts.topics}`);
  console.log(`  every account signs in with the password: ${PASSWORD}`);
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
