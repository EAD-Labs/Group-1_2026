const { query } = require('../config/database');

/*
 * Lessons: short slices of a long quiz.
 *
 * The client's questions arrive as one quiz per level (22, 32 and 19
 * questions, and 63 in the post-test). As a single brick that is far longer
 * than the ten-to-fifteen items a practice session should be, so the pyramid
 * shows each long quiz as lessons of about eight questions, grouped by the
 * concept they practise. The questions stay in one quiz in the database; a
 * lesson is a view of it, so nothing is re-imported and an attempt at the
 * whole quiz still counts towards each lesson it covered.
 *
 * The grouping is worked out from the content each time, in a fixed order
 * (concept in course order, then question id), so a lesson's questions do not
 * change between visits unless the questions themselves do.
 */

const LESSON_SIZE = 8;
const SPLIT_OVER = 12;     // a quiz this long or shorter stays one brick

/** Sizes as even as possible: 22 questions become 8, 7 and 7. */
function chunkSizes(n) {
  const count = Math.ceil(n / LESSON_SIZE);
  const base = Math.floor(n / count);
  return Array.from({ length: count }, (_, i) => base + (i < n % count ? 1 : 0));
}

/** Lessons for each of the given quizzes: Map(quizId -> [{ index, title, questionIds }]). */
async function lessonsForMany(quizIds) {
  if (!quizIds.length) return new Map();
  const rows = await query(
    `SELECT q.id, q.quiz_id AS "quizId",
            MIN(c.sort_order) AS "order",
            (ARRAY_AGG(c.name ORDER BY c.sort_order))[1] AS concept
       FROM questions q
       LEFT JOIN question_concepts qc ON qc.question_id = q.id
       LEFT JOIN concepts c ON c.id = qc.concept_id
      WHERE q.quiz_id = ANY($1)
      GROUP BY q.id
      ORDER BY q.quiz_id, "order" NULLS LAST, q.id`,
    [quizIds],
  );

  const out = new Map(quizIds.map((id) => [id, []]));
  quizIds.forEach((quizId) => {
    const questions = rows.filter((r) => r.quizId === quizId);
    if (questions.length <= SPLIT_OVER) return;
    let from = 0;
    chunkSizes(questions.length).forEach((size, i) => {
      const slice = questions.slice(from, from + size);
      from += size;
      out.get(quizId).push({
        index: i + 1,
        title: `Lesson ${i + 1}: ${titleOf(slice)}`,
        questionIds: slice.map((q) => q.id),
      });
    });
  });
  return out;
}

/** Named after the one or two concepts most of its questions practise. */
function titleOf(slice) {
  const counts = new Map();
  slice.forEach((q) => { if (q.concept) counts.set(q.concept, (counts.get(q.concept) || 0) + 1); });
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([name]) => name);
  return top.length ? top.join(' · ') : 'Mixed questions';
}

const lessonsFor = async (quizId) => (await lessonsForMany([quizId])).get(quizId);

module.exports = {
  lessonsFor, lessonsForMany, chunkSizes, LESSON_SIZE, SPLIT_OVER,
};
