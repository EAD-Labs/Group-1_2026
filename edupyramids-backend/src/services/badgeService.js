const { query } = require('../config/database');

/*
 * Badges, by the HLD's rule (Section 6.3): a badge shows what a student has
 * actually learnt, so it is given only for 80% or more across three
 * activities on a topic, and never for logging in or for streaks.
 *
 * An activity is one lesson of a quiz, a whole quiz, or one game; its score is
 * the best the student has reached on it. Keystones do not count: they are a
 * test of the tier, not practice in it. A badge is given once (the table's
 * unique key, HLD test C1) and never taken away.
 */

const BADGE = 'Topic learnt';
const PASS = 0.8;
const ACTIVITIES = 3;

/**
 * When the badge was earned: the moment a third activity in the topic first
 * reached 80%. Null if it has not been earned yet.
 */
async function earnedAt(db, studentId, topicId) {
  const { rows } = await db.query(
    `SELECT reached FROM (
       SELECT MIN(created_at) AS reached
         FROM attempts
        WHERE student_id = $1 AND topic_id = $2 AND score::numeric / max_score >= $3
        GROUP BY kind, quiz_id, lesson, game_id
     ) activity
     ORDER BY reached OFFSET $4 LIMIT 1`,
    [studentId, topicId, PASS, ACTIVITIES - 1],
  );
  return rows[0]?.reached ?? null;
}

/**
 * Award the topic's badge if it is now earned, dated when it was earned.
 * Returns the badge when it was given just now, null otherwise. Takes a
 * client, so an attempt and its badge are saved together.
 */
async function awardIfEarned(db, studentId, topicId) {
  const when = await earnedAt(db, studentId, topicId);
  if (!when) return null;
  const { rows } = await db.query(
    `INSERT INTO badges (student_id, topic_id, badge_name, earned_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (student_id, topic_id, badge_name) DO NOTHING
     RETURNING (SELECT name FROM topics WHERE id = $2) AS topic`,
    [studentId, topicId, BADGE, when],
  );
  return rows.length ? { badgeName: BADGE, topic: rows[0].topic, topicId } : null;
}

/** Check every topic the student has worked in: catches up on work done before badges existed. */
async function awardAll(studentId) {
  const db = { query: (text, params) => query(text, params).then((rows) => ({ rows })) };
  const topics = await query('SELECT DISTINCT topic_id AS id FROM attempts WHERE student_id = $1', [studentId]);
  for (const t of topics) {
    // eslint-disable-next-line no-await-in-loop
    await awardIfEarned(db, studentId, t.id);
  }
}

module.exports = {
  awardIfEarned, awardAll, earnedAt, BADGE, PASS, ACTIVITIES,
};
