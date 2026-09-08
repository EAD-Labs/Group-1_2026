const { query, queryOne } = require('../config/database');

const PUBLIC_COLUMNS = 'id, email, name, role, school_id AS "schoolId"';

const User = {
  /** Includes the hash, so this is only for the login path. */
  findByEmailWithHash(email) {
    return queryOne(
      `SELECT id, email, name, role, school_id AS "schoolId", password_hash AS "passwordHash"
         FROM users
        WHERE lower(email) = lower($1)`,
      [email],
    );
  },

  findById(id) {
    return queryOne(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`, [id]);
  },

  /** The classes a teacher owns, used to decide what they may read. */
  classIdsForTeacher(teacherId) {
    return query('SELECT id FROM classes WHERE teacher_id = $1', [teacherId])
      .then((rows) => rows.map((r) => r.id));
  },

  /** The classes a student is in. */
  classIdsForStudent(studentId) {
    return query('SELECT class_id AS id FROM class_students WHERE student_id = $1',
      [studentId]).then((rows) => rows.map((r) => r.id));
  },

  /**
   * Mirror a school account into our users table so attempts and progress have
   * something to hang off. The password column gets Django's "unusable" marker:
   * bcrypt.compare can never match it, so the only way in stays the school's
   * own credentials.
   */
  upsertFromSchool({ email, name, role, spokenUserId }) {
    return queryOne(
      `INSERT INTO users (email, password_hash, name, role, school_id)
            VALUES ($1, '!', $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role
         RETURNING ${PUBLIC_COLUMNS}`,
      [email, name || email, role, spokenUserId ? String(spokenUserId) : null],
    );
  },

  /** Strip anything that should never reach the browser. */
  toPublic(row) {
    if (!row) return null;
    const { passwordHash, password_hash: _ignored, ...safe } = row;
    return safe;
  },
};

module.exports = User;
