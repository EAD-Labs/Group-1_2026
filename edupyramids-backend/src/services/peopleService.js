const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { query, queryOne } = require('../config/database');

/*
 * Managing users, for the programme coordinator (HLD Section 4: "Manage
 * users" is the coordinator's alone).
 *
 * Classes and their teachers, and the students in each class. New accounts
 * get a readable starting password (two short words and a number), which is
 * returned once, to the coordinator who made it, to hand to the student; only
 * its hash is stored. A student already known by email is enrolled rather
 * than made twice.
 */

class PeopleError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BATCH = 100;
const WORDS = [
  'mango', 'river', 'tiger', 'lotus', 'cloud', 'maple', 'pearl', 'comet', 'amber', 'cedar',
  'coral', 'delta', 'ember', 'flute', 'grape', 'hazel', 'ivory', 'jade', 'kite', 'lemon',
  'lunar', 'mint', 'north', 'olive', 'otter', 'plum', 'quartz', 'raven', 'sage', 'sunny',
  'tulip', 'vivid', 'wheat', 'zebra', 'bison', 'cobalt', 'dune', 'fern', 'glow', 'harbor',
];

/** A starting password a student can read out and type: "mango-river-42". */
function newPassword() {
  const word = () => WORDS[crypto.randomInt(WORDS.length)];
  return `${word()}-${word()}-${crypto.randomInt(10, 100)}`;
}

const tidyEmail = (e) => String(e || '').trim().toLowerCase();
const tidyName = (n) => String(n || '').trim().replace(/\s+/g, ' ');

async function hashFor(password) {
  return bcrypt.hash(password, 10);
}

/** Everything the People page shows: classes with their students, and the teachers. */
async function overview() {
  const [classes, teachers, members] = await Promise.all([
    query(
      `SELECT c.id, c.name, c.teacher_id AS "teacherId", u.name AS "teacherName"
         FROM classes c LEFT JOIN users u ON u.id = c.teacher_id
        ORDER BY c.name`,
    ),
    query("SELECT id, name, email FROM users WHERE role = 'teacher' ORDER BY name"),
    query(
      `SELECT cs.class_id AS "classId", u.id, u.name, u.email
         FROM class_students cs JOIN users u ON u.id = cs.student_id
        ORDER BY u.name`,
    ),
  ]);
  return {
    classes: classes.map((c) => ({ ...c, students: members.filter((m) => m.classId === c.id).map(({ classId, ...s }) => s) })),
    teachers,
  };
}

async function createTeacher({ name, email }) {
  const n = tidyName(name);
  const e = tidyEmail(email);
  if (!n) throw new PeopleError('A teacher needs a name');
  if (!EMAIL.test(e)) throw new PeopleError(`"${email}" is not an email address`);
  if (await queryOne('SELECT id FROM users WHERE lower(email) = $1', [e])) {
    throw new PeopleError('Someone already has that email address', 409);
  }
  const password = newPassword();
  const teacher = await queryOne(
    `INSERT INTO users (email, password_hash, name, role, school_id)
     VALUES ($1, $2, $3, 'teacher', 'school_001') RETURNING id, name, email`,
    [e, await hashFor(password), n],
  );
  return { teacher, password };
}

async function teacherOrFail(teacherId) {
  const t = await queryOne("SELECT id FROM users WHERE id = $1 AND role = 'teacher'", [teacherId]);
  if (!t) throw new PeopleError('Choose a teacher for the class');
}

async function createClass({ name, teacherId }) {
  const n = tidyName(name);
  if (!n) throw new PeopleError('A class needs a name');
  await teacherOrFail(teacherId);
  if (await queryOne('SELECT id FROM classes WHERE lower(name) = lower($1)', [n])) {
    throw new PeopleError('There is already a class with that name', 409);
  }
  return queryOne(
    "INSERT INTO classes (name, teacher_id, school_id) VALUES ($1, $2, 'school_001') RETURNING id, name",
    [n, teacherId],
  );
}

async function updateClass(classId, { name, teacherId }) {
  const current = await queryOne('SELECT id FROM classes WHERE id = $1', [classId]);
  if (!current) throw new PeopleError('No such class', 404);
  const n = tidyName(name);
  if (!n) throw new PeopleError('A class needs a name');
  await teacherOrFail(teacherId);
  if (await queryOne('SELECT id FROM classes WHERE lower(name) = lower($1) AND id <> $2', [n, classId])) {
    throw new PeopleError('There is already a class with that name', 409);
  }
  return queryOne('UPDATE classes SET name = $2, teacher_id = $3 WHERE id = $1 RETURNING id, name', [classId, n, teacherId]);
}

/**
 * Put a list of students into a class. Each line is { name, email }. Returns
 * one result per line, in order:
 *   created    a new account, with its starting password (shown only now)
 *   enrolled   an existing student added to this class
 *   already    already in this class
 *   refused    with the reason (a bad email, a teacher's address, no name)
 */
async function addStudents(classId, lines) {
  if (!Array.isArray(lines) || !lines.length) throw new PeopleError('Add at least one student');
  if (lines.length > MAX_BATCH) throw new PeopleError(`Add at most ${MAX_BATCH} students at a time`);
  const cls = await queryOne('SELECT id FROM classes WHERE id = $1', [classId]);
  if (!cls) throw new PeopleError('No such class', 404);

  const results = [];
  const seen = new Set();
  for (const line of lines) {
    const name = tidyName(line?.name);
    const email = tidyEmail(line?.email);
    if (!EMAIL.test(email)) { results.push({ name, email, status: 'refused', reason: 'not an email address' }); continue; }
    if (seen.has(email)) { results.push({ name, email, status: 'refused', reason: 'listed twice' }); continue; }
    seen.add(email);

    // eslint-disable-next-line no-await-in-loop
    const existing = await queryOne('SELECT id, name, role FROM users WHERE lower(email) = $1', [email]);
    if (existing && existing.role !== 'student') {
      results.push({ name, email, status: 'refused', reason: `already a ${existing.role}'s address` });
      continue;
    }
    if (existing) {
      // eslint-disable-next-line no-await-in-loop
      const added = await query(
        'INSERT INTO class_students (class_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING student_id',
        [classId, existing.id],
      );
      results.push({ id: existing.id, name: existing.name, email, status: added.length ? 'enrolled' : 'already' });
      continue;
    }
    if (!name) { results.push({ name, email, status: 'refused', reason: 'no name' }); continue; }

    const password = newPassword();
    // One statement makes the account and enrols it, so neither half is left alone.
    // eslint-disable-next-line no-await-in-loop
    const [made] = await query(
      `WITH u AS (
         INSERT INTO users (email, password_hash, name, role, school_id)
         VALUES ($1, $2, $3, 'student', 'school_001') RETURNING id
       )
       INSERT INTO class_students (class_id, student_id) SELECT $4, id FROM u RETURNING student_id AS id`,
      [email, await hashFor(password), name, classId],   // eslint-disable-line no-await-in-loop
    );
    results.push({ id: made.id, name, email, status: 'created', password });
  }
  return results;
}

/** Take a student out of a class. Their account and their work stay. */
async function removeStudent(classId, studentId) {
  const gone = await query(
    'DELETE FROM class_students WHERE class_id = $1 AND student_id = $2 RETURNING student_id', [classId, studentId],
  );
  if (!gone.length) throw new PeopleError('That student is not in this class', 404);
}

/** A new starting password for a student or teacher; returned once. */
async function resetPassword(userId) {
  const user = await queryOne('SELECT id, role, name, email FROM users WHERE id = $1', [userId]);
  if (!user) throw new PeopleError('No such person', 404);
  if (user.role === 'coordinator') throw new PeopleError('A coordinator changes their own password', 403);
  const password = newPassword();
  await query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, await hashFor(password)]);
  return { id: user.id, name: user.name, email: user.email, password };
}

module.exports = {
  overview, createTeacher, createClass, updateClass, addStudents, removeStudent, resetPassword,
  newPassword, PeopleError, MAX_BATCH,
};
