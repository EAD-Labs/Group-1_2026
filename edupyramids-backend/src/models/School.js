const school = require('../config/schoolDb');

/*
 * Reads against the client's school database. Every query here is a SELECT.
 *
 * What this database actually holds, checked rather than assumed:
 *
 *   - 1.18M accounts and 1.37M student records: a real roster;
 *   - a real level taxonomy, Basic / Intermediate / Advanced;
 *   - batches and sections that are almost entirely unpopulated — of 737
 *     batches, none carries a grade, section or class teacher, and only 136
 *     students are linked to one;
 *   - no test content and no attempts at all; those tables are empty.
 *
 * So classes, quizzes, attempts and progress stay in our own database. This one
 * answers exactly two questions: does this person belong to the school, and who
 * are they.
 */

const School = {
  /**
   * Look someone up by email.
   *
   * Does not return the password hash; use findForLogin for that.
   */
  findAccountByEmail(email) {
    return school.queryOne(
      `SELECT u.id, u.username, u.email,
              trim(both ' ' from u.first_name || ' ' || u.last_name) AS name,
              u.is_active   AS "isActive",
              u.date_joined AS "joinedAt",
              u.spk_user_id AS "spokenUserId"
         FROM accounts_user u
        WHERE lower(u.email) = lower($1)
        LIMIT 1`,
      [email],
    );
  },

  /** The student record attached to an account, if there is one. */
  findStudentByAccountId(accountId) {
    return school.queryOne(
      `SELECT s.id, s.admission_number AS "admissionNumber", s.status,
              s.current_batch_id AS "batchId", s.spoken_student_id AS "spokenStudentId"
         FROM stp_training_student s
        WHERE s.user_id = $1
        ORDER BY s.updated DESC NULLS LAST
        LIMIT 1`,
      [accountId],
    );
  },

  /**
   * Search the roster. Used when a coordinator adds real students to a class.
   *
   * Capped hard: an unbounded LIKE over 1.18M rows returned to a browser helps
   * nobody, and a roster of a million people is not something to page through.
   */
  searchAccounts(term, limit = 20) {
    const capped = Math.min(Math.max(Number(limit) || 20, 1), 50);
    // DISTINCT ON, because an account can carry more than one student record —
    // a re-enrolment, or an import that ran twice. A plain join multiplies the
    // account across those rows and lists the same person several times. Keep
    // the most recently updated record and show the person once.
    return school.query(
      `SELECT DISTINCT ON (u.id)
              u.id, u.email,
              trim(both ' ' from u.first_name || ' ' || u.last_name) AS name,
              s.admission_number AS "admissionNumber", s.status
         FROM accounts_user u
         LEFT JOIN stp_training_student s ON s.user_id = u.id
        WHERE lower(u.email) LIKE lower($1) OR lower(u.username) LIKE lower($1)
        ORDER BY u.id, s.updated DESC NULLS LAST
        LIMIT $2`,
      [`${term}%`, capped],
    );
  },

  /**
   * Find someone by the id spoken-tutorial.org returns from verify-user.
   *
   * Their site runs stock django.contrib.auth, so `spoken_user_id` is a row id
   * in their `auth_user` table, and this database records it as
   * `accounts_user.spk_user_id`. 1,182,131 of 1,182,156 accounts carry one, so
   * it is a sound join key — but it is not declared unique and one duplicate
   * already exists in the data, hence the ordering and the single row.
   *
   * Roles come back with it. Their taxonomy is wider than ours, and only
   * mappings that are approved and currently in date are counted.
   */
  findBySpokenUserId(spokenUserId) {
    return school.queryOne(
      `SELECT u.id, u.email, u.username,
              trim(both ' ' from u.first_name || ' ' || u.last_name) AS name,
              u.is_active AS "isActive",
              COALESCE(
                array_agg(DISTINCT m.role) FILTER (WHERE m.role IS NOT NULL),
                '{}'
              ) AS roles
         FROM accounts_user u
         LEFT JOIN accounts_userrolemapping m
                ON m.user_id = u.id
               AND m.status = 'approved'
               AND m.valid_from <= now()
               AND (m.valid_to IS NULL OR m.valid_to > now())
        WHERE u.spk_user_id = $1
        GROUP BY u.id, u.email, u.username, u.first_name, u.last_name, u.is_active
        ORDER BY u.id
        LIMIT 1`,
      [spokenUserId],
    );
  },

  /**
   * An account by email, with its hash and current roles, for signing in
   * against the school's own credentials.
   */
  findForLogin(email) {
    return school.queryOne(
      `SELECT u.id, u.email, u.username, u.password, u.is_active AS "isActive",
              u.spk_user_id AS "spokenUserId",
              trim(both ' ' from u.first_name || ' ' || u.last_name) AS name,
              COALESCE(array_agg(DISTINCT m.role)
                       FILTER (WHERE m.role IS NOT NULL), '{}') AS roles
         FROM accounts_user u
         LEFT JOIN accounts_userrolemapping m
                ON m.user_id = u.id AND m.status = 'approved'
               AND m.valid_from <= now()
               AND (m.valid_to IS NULL OR m.valid_to > now())
        WHERE lower(u.email) = lower($1)
        GROUP BY u.id
        ORDER BY u.id
        LIMIT 1`,
      [email],
    );
  },

  /** The school's own level names, so ours do not drift from theirs. */
  levels() {
    return school.query(
      'SELECT id, level AS name, code FROM common_level ORDER BY id',
    );
  },

  /** Headline counts, for the coordinator view and for the health check. */
  stats() {
    return school.queryOne(
      `SELECT (SELECT count(*) FROM accounts_user)                          AS accounts,
              (SELECT count(*) FROM stp_training_student)                   AS students,
              (SELECT count(*) FROM stp_training_student
                WHERE status = 'approved')                                  AS approved,
              (SELECT count(*) FROM stp_training_batch)                     AS batches,
              (SELECT count(*) FROM stp_training_academiccenter)            AS centres`,
    );
  },
};

module.exports = School;
