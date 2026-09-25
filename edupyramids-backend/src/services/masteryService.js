const { pool, query } = require('../config/database');
const VIDEOS = require('../../content/spoken-tutorial-videos.json');

/*
 * Adaptive learning.
 *
 * Three parts, each small enough to check by hand:
 *
 * 1. Bayesian Knowledge Tracing (Corbett & Anderson, 1995). For every student
 *    and concept we keep one number, p_known: the probability they know it.
 *    Each answer updates it with Bayes' rule, allowing for a lucky guess and a
 *    careless slip, then adds the chance they learnt it from the attempt.
 *
 * 2. Spaced repetition. Once a concept passes the mastery bar it is scheduled
 *    for review, one day out, then two and a half times further each time it
 *    is answered correctly (Leitner/SM-2 style). A wrong review answer drops
 *    p_known through the same update and takes it off the schedule until it is
 *    mastered again.
 *
 * 3. Choosing the next practice question. Concept first, by a priority that
 *    can be explained in a sentence (review due, then the weakest concept
 *    whose prerequisites are known), then the question within it whose
 *    difficulty best suits the student's current estimate.
 *
 * 4. Back to the lesson. Every concept knows which Spoken Tutorial videos
 *    teach it, so a wrong answer can point to the right video rather than
 *    only to the right letter.
 *
 * Practice only ever suggests. A student can still pick any topic, quiz or
 * game themselves (HLD Section 6.3: "suggests weak topics but never forces an
 * order").
 */

const BKT = {
  init: 0.2,      // P(L0): known before any evidence
  learn: 0.12,    // P(T):  learnt from one attempt
  slip: 0.1,      // P(S):  knows it, answers wrong anyway
};

const MASTERED = 0.95;     // the conventional BKT mastery bar
const READY = 0.6;         // a prerequisite this well known no longer holds a concept back
const FIRST_REVIEW_DAYS = 1;
const REVIEW_GROWTH = 2.5;
const MAX_REVIEW_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

const INTRO_VIDEO = Object.fromEntries(require('../../content/concepts.json').map((c) => [c.slug, c.video]));

/**
 * The Spoken Tutorial videos that teach a concept: the one chosen as its
 * introduction (concepts.json "video") first, then the others in course order.
 */
function videosFor(slug, limit = 2) {
  const intro = INTRO_VIDEO[slug];
  return VIDEOS.filter((v) => v.slug === intro || v.concepts.includes(slug))
    .sort((a, b) => (b.slug === intro) - (a.slug === intro) || a.order - b.order)
    .slice(0, limit)
    .map(({ title, url, duration }) => ({ title, url, duration }));
}

/** P(guess): one in the number of options, kept within sensible bounds. */
function guessFor(optionCount) {
  return Math.min(0.5, Math.max(0.2, 1 / Math.max(2, optionCount)));
}

/** One BKT step. Pure, so the arithmetic is tested on its own. */
function bktUpdate(p, correct, guess, { slip = BKT.slip, learn = BKT.learn } = {}) {
  const posterior = correct
    ? (p * (1 - slip)) / (p * (1 - slip) + (1 - p) * guess)
    : (p * slip) / (p * slip + (1 - p) * (1 - guess));
  const next = posterior + (1 - posterior) * learn;
  // Never quite 0 or 1: one answer should always be able to move it.
  return Math.min(0.999, Math.max(0.001, next));
}

/** P(correct) on the next question, as the model sees it. */
function predictCorrect(p, guess, slip = BKT.slip) {
  return p * (1 - slip) + (1 - p) * guess;
}

/**
 * The review schedule after an answer.
 * @returns {{ interval: number, nextReview: Date|null, masteredAt: Date|null }}
 */
function schedule(row, pAfter, correct, now = new Date()) {
  if (pAfter < MASTERED) return { interval: 0, nextReview: null, masteredAt: null };

  const wasMastered = Boolean(row.mastered_at);
  let interval;
  if (!wasMastered || !row.review_interval) interval = FIRST_REVIEW_DAYS;
  else if (correct) interval = Math.min(MAX_REVIEW_DAYS, row.review_interval * REVIEW_GROWTH);
  else interval = FIRST_REVIEW_DAYS;

  return {
    interval,
    nextReview: new Date(now.getTime() + interval * DAY_MS),
    masteredAt: wasMastered ? row.mastered_at : now,
  };
}

function statusOf(row, now = new Date()) {
  if (!row || !row.answered) return 'new';
  if (row.p_known >= MASTERED) {
    return row.next_review && new Date(row.next_review) <= now ? 'review' : 'mastered';
  }
  return 'learning';
}

/**
 * Record one marked answer against every concept the question tests.
 *
 * Takes a client so a quiz submission can do this inside its own transaction:
 * the attempt and the mastery change are stored together or not at all.
 *
 * @returns {Promise<Array<{slug, name, before, after, status, newlyMastered}>>}
 */
async function recordResponse(client, { studentId, questionId, correct, source }) {
  const question = (await client.query(
    `SELECT (option_a IS NOT NULL)::int + (option_b IS NOT NULL)::int +
            (option_c IS NOT NULL)::int + (option_d IS NOT NULL)::int +
            (option_e IS NOT NULL)::int AS options
       FROM questions WHERE id = $1`,
    [questionId],
  )).rows[0];
  if (!question) return [];
  const guess = guessFor(question.options);

  const concepts = (await client.query(
    `SELECT c.id, c.slug, c.name FROM question_concepts qc
       JOIN concepts c ON c.id = qc.concept_id
      WHERE qc.question_id = $1 ORDER BY c.sort_order`,
    [questionId],
  )).rows;

  const changes = [];
  for (const concept of concepts) {
    // Create the row if this is the first answer, then lock it, so two answers
    // arriving together (a live session) cannot both read the same estimate.
    await client.query(
      `INSERT INTO concept_mastery (student_id, concept_id, p_known)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [studentId, concept.id, BKT.init],
    );
    const row = (await client.query(
      `SELECT * FROM concept_mastery WHERE student_id = $1 AND concept_id = $2 FOR UPDATE`,
      [studentId, concept.id],
    )).rows[0];

    const before = row.p_known;
    const after = bktUpdate(before, correct, guess);
    const next = schedule(row, after, correct);

    const updated = (await client.query(
      `UPDATE concept_mastery
          SET p_known = $3, answered = answered + 1, correct = correct + $4::int,
              review_interval = $5, next_review = $6, mastered_at = $7, last_seen = now()
        WHERE student_id = $1 AND concept_id = $2
        RETURNING *`,
      [studentId, concept.id, after, correct ? 1 : 0, next.interval, next.nextReview, next.masteredAt],
    )).rows[0];

    await client.query(
      `INSERT INTO responses (student_id, question_id, concept_id, source, correct, p_before, p_after)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [studentId, questionId, concept.id, source, correct, before, after],
    );

    changes.push({
      slug: concept.slug,
      name: concept.name,
      before: Math.round(before * 100),
      after: Math.round(after * 100),
      status: statusOf(updated),
      newlyMastered: !row.mastered_at && Boolean(next.masteredAt),
    });
  }
  return changes;
}

/**
 * Collapse the per-question changes of a whole quiz into one line per concept:
 * where it started and where it ended.
 */
function summariseChanges(lists) {
  const byConcept = new Map();
  lists.flat().forEach((c) => {
    const seen = byConcept.get(c.slug);
    if (!seen) byConcept.set(c.slug, { ...c });
    else Object.assign(seen, { after: c.after, status: c.status, newlyMastered: seen.newlyMastered || c.newlyMastered });
  });
  return [...byConcept.values()];
}

/** Every concept, with this student's estimate and status. */
async function masteryFor(studentId) {
  const rows = await query(
    `SELECT c.id, c.slug, c.name, c.description, c.requires, c.sort_order,
            (SELECT COUNT(*) FROM question_concepts qc WHERE qc.concept_id = c.id)::int AS questions,
            m.p_known, m.answered, m.correct, m.mastered_at, m.next_review, m.review_interval
       FROM concepts c
       LEFT JOIN concept_mastery m ON m.concept_id = c.id AND m.student_id = $1
      ORDER BY c.sort_order`,
    [studentId],
  );

  const bySlug = Object.fromEntries(rows.map((r) => [r.slug, r]));
  const known = (slug) => (bySlug[slug]?.p_known ?? BKT.init);
  const now = new Date();

  return rows.map((r, order) => {
    // A prerequisite with no questions cannot be practised, so it cannot hold
    // anything back.
    const waitingOn = r.requires.filter((s) => bySlug[s]?.questions && known(s) < READY);
    return {
      slug: r.slug,
      name: r.name,
      order,
      description: r.description,
      questions: r.questions,
      p: Math.round((r.p_known ?? BKT.init) * 100),
      answered: r.answered ?? 0,
      correct: r.correct ?? 0,
      status: statusOf(r, now),
      nextReview: r.next_review,
      requires: r.requires,
      waitingOn: waitingOn.map((s) => bySlug[s].name),
      videos: videosFor(r.slug),
    };
  });
}

/**
 * Questions this student got wrong and has not got right since, oldest
 * mistake first. Going back to a mistake with the answer explained is what
 * makes it stick, most of all a mistake made with confidence (Butterfield &
 * Metcalfe's hypercorrection effect).
 */
async function mistakesFor(studentId) {
  const rows = await query(
    `SELECT question_id AS id, created_at FROM (
       SELECT DISTINCT ON (question_id) question_id, correct, created_at
         FROM responses
        WHERE student_id = $1 AND question_id IS NOT NULL
        ORDER BY question_id, created_at DESC
     ) latest
     WHERE NOT correct
     ORDER BY created_at`,
    [studentId],
  );
  return rows.map((r) => r.id);
}

/** A question as practice shows it: no answer, with its option count and topic. */
async function practiceQuestion(id) {
  const question = (await query(
    `SELECT q.id, q.text, q.option_a AS "optionA", q.option_b AS "optionB",
            q.option_c AS "optionC", q.option_d AS "optionD", q.option_e AS "optionE",
            t.name AS topic
       FROM questions q JOIN quizzes z ON z.id = q.quiz_id JOIN topics t ON t.id = z.topic_id
      WHERE q.id = $1`,
    [id],
  ))[0];
  if (!question) return null;
  const optionCount = ['optionA', 'optionB', 'optionC', 'optionD', 'optionE'].filter((k) => question[k]).length;
  return { ...question, optionCount };
}

/** The next mistake to fix, skipping any already shown in this session. */
async function nextMistake(studentId, exclude) {
  const id = (await mistakesFor(studentId)).find((q) => !exclude.includes(q));
  if (!id) return null;
  const question = await practiceQuestion(id);
  const [slug] = (await query(
    `SELECT c.slug FROM question_concepts qc JOIN concepts c ON c.id = qc.concept_id
      WHERE qc.question_id = $1 ORDER BY c.sort_order LIMIT 1`,
    [id],
  )).map((r) => r.slug);
  const concept = (await masteryFor(studentId)).find((c) => c.slug === slug);
  const p = concept?.p ?? Math.round(BKT.init * 100);
  return {
    question,
    concept: concept
      ? { slug: concept.slug, name: concept.name, p, status: concept.status }
      : { slug: null, name: 'Mixed', p, status: 'learning' },
    reason: 'You got this one wrong before. Another go, with the explanation, is how a mistake turns into something you know.',
    predicted: Math.round(predictCorrect(p / 100, guessFor(question.optionCount)) * 100),
  };
}

/**
 * Pick the next practice question and say why.
 *
 * @param {number}   studentId
 * @param {number[]} exclude   question ids already seen in this session
 * @param {string[]} focus     concept slugs to keep to (a review from the path); all when empty
 * @param {string}   mode      'mistakes' to go back over wrong answers; otherwise the adaptive mix
 */
async function nextPracticeQuestion(studentId, exclude = [], focus = [], mode = 'mix') {
  if (mode === 'mistakes') return nextMistake(studentId, exclude.filter(Number.isInteger));
  const concepts = (await masteryFor(studentId))
    .filter((c) => c.questions > 0 && (!focus.length || focus.includes(c.slug)));
  if (!concepts.length) return null;

  // Priority, highest first, with the reason the student will be shown.
  const ranked = concepts.map((c) => {
    if (c.status === 'review') {
      return { c, rank: 4, reason: `${c.name} is due for review, so it stays mastered.` };
    }
    if (c.status === 'mastered') {
      return { c, rank: 0, reason: `A quick check on ${c.name}, which you have mastered.` };
    }
    if (c.waitingOn.length) {
      return { c, rank: 1, reason: `${c.name} builds on ${c.waitingOn.join(' and ')}; this is a gentle start.` };
    }
    return c.answered
      ? { c, rank: 3, reason: `${c.name} is where you have the most room to grow (${c.p}%).` }
      : { c, rank: 2, reason: `Something new: ${c.name}. Everything it builds on is in place.` };
  });

  const excluded = exclude.filter(Number.isInteger);

  // Interleaving: three questions in a row on one concept is enough for now.
  // Mixing concepts makes each answer depend on recognising what kind of
  // problem it is, which is part of knowing it (Rohrer & Taylor, 2007).
  const recent = await recentConcepts(excluded.slice(-3));
  if (excluded.length >= 3 && recent.length === 1) {
    const stuck = ranked.find((r) => r.c.slug === recent[0]);
    if (stuck && stuck.rank > 1) {
      stuck.rank -= 1.5;
      stuck.reason = `${stuck.c.name} again soon; mixing in another concept helps it stick.`;
    }
  }

  // Ties go in course order, so a new student meets basics before tools.
  ranked.sort((a, b) => b.rank - a.rank || a.c.p - b.c.p || a.c.order - b.c.order);

  for (const pick of ranked) {
    const question = await chooseQuestion(studentId, pick.c, excluded);
    if (question) {
      return {
        question,
        concept: { slug: pick.c.slug, name: pick.c.name, p: pick.c.p, status: pick.c.status },
        reason: pick.reason,
        predicted: Math.round(predictCorrect(pick.c.p / 100, guessFor(question.optionCount)) * 100),
      };
    }
  }
  return null;
}

/** The distinct concepts of the given questions. */
async function recentConcepts(questionIds) {
  if (!questionIds.length) return [];
  const rows = await query(
    `SELECT DISTINCT c.slug FROM question_concepts qc JOIN concepts c ON c.id = qc.concept_id
      WHERE qc.question_id = ANY($1::int[])`,
    [questionIds],
  );
  return rows.map((r) => r.slug);
}

/*
 * The question within a concept. Each question's difficulty is how often it is
 * answered wrongly, smoothed towards a prior set by its level, so a question
 * nobody has answered yet still has a sensible estimate. The target is easier
 * for a student the model thinks is struggling, harder as they improve.
 */
const LEVEL_PRIOR = { 1: 0.3, 2: 0.45, 3: 0.55 };
const PRIOR_WEIGHT = 5;

async function chooseQuestion(studentId, concept, exclude) {
  const candidates = await query(
    `SELECT q.id, t.level,
            COUNT(r.id)::int AS seen,
            COUNT(r.id) FILTER (WHERE NOT r.correct)::int AS wrong,
            BOOL_OR(r.student_id = $2 AND NOT r.correct) AS "missedBefore",
            MAX(r.created_at) FILTER (WHERE r.student_id = $2) AS "lastMine"
       FROM question_concepts qc
       JOIN concepts c  ON c.id = qc.concept_id AND c.slug = $1
       JOIN questions q ON q.id = qc.question_id
       JOIN quizzes z   ON z.id = q.quiz_id
       JOIN topics t    ON t.id = z.topic_id
       LEFT JOIN responses r ON r.question_id = q.id AND r.concept_id = c.id
      WHERE NOT (q.id = ANY($3::int[]))
      GROUP BY q.id, t.level`,
    [concept.slug, studentId, exclude],
  );
  if (!candidates.length) return null;

  const target = 0.2 + 0.5 * (concept.p / 100);
  const now = Date.now();

  const scored = candidates.map((q) => {
    const prior = LEVEL_PRIOR[q.level] ?? 0.5;
    const difficulty = (q.wrong + prior * PRIOR_WEIGHT) / (q.seen + PRIOR_WEIGHT);
    let score = Math.abs(difficulty - target);
    // Something answered in the last few hours is fresh in memory, so it tells
    // us little. A question they got wrong before is worth another go.
    if (q.lastMine && now - new Date(q.lastMine).getTime() < 6 * 60 * 60 * 1000) score += 0.3;
    if (q.missedBefore) score -= 0.08;
    // A little variety between equally good questions.
    score += Math.random() * 0.04;
    return { id: q.id, score, difficulty };
  }).sort((a, b) => a.score - b.score);

  const best = scored[0];
  return { ...(await practiceQuestion(best.id)), difficulty: Math.round(best.difficulty * 100) };
}

class PracticeError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Mark a practice answer and update mastery, in one transaction. */
async function answerPractice({ studentId, questionId, answer }) {
  const client = await pool.connect();
  try {
    const q = (await client.query(
      'SELECT id, correct_answer, explanation FROM questions WHERE id = $1', [questionId],
    )).rows[0];
    if (!q) throw new PracticeError('No such question', 404);

    const correct = answer === q.correct_answer;
    await client.query('BEGIN');
    const mastery = await recordResponse(client, { studentId, questionId, correct, source: 'practice' });
    await client.query('COMMIT');

    // A wrong answer points back to the lesson that teaches it.
    let revisit = null;
    if (!correct) {
      const [first] = (await client.query(
        `SELECT c.slug FROM question_concepts qc JOIN concepts c ON c.id = qc.concept_id
          WHERE qc.question_id = $1 ORDER BY c.sort_order LIMIT 1`,
        [questionId],
      )).rows;
      revisit = first ? videosFor(first.slug, 1)[0] ?? null : null;
    }

    return {
      questionId, correct, correctAnswer: q.correct_answer, explanation: q.explanation, mastery, revisit,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Students x concepts for one class: the teacher's heatmap. */
async function classMastery(classId) {
  const concepts = await query(
    `SELECT c.slug, c.name FROM concepts c
      WHERE EXISTS (SELECT 1 FROM question_concepts qc WHERE qc.concept_id = c.id)
      ORDER BY c.sort_order`,
  );
  const students = await query(
    `SELECT u.id, u.name FROM class_students cs JOIN users u ON u.id = cs.student_id
      WHERE cs.class_id = $1 ORDER BY u.name`,
    [classId],
  );
  const cells = await query(
    `SELECT m.student_id AS "studentId", c.slug, m.p_known, m.answered, m.correct,
            m.mastered_at, m.next_review
       FROM concept_mastery m
       JOIN concepts c ON c.id = m.concept_id
       JOIN class_students cs ON cs.student_id = m.student_id AND cs.class_id = $1`,
    [classId],
  );

  const now = new Date();
  const grid = new Map(students.map((s) => [s.id, {}]));
  cells.forEach((cell) => {
    grid.get(cell.studentId)[cell.slug] = {
      p: Math.round(cell.p_known * 100),
      answered: cell.answered,
      correct: cell.correct,
      status: statusOf(cell, now),
    };
  });

  const averages = Object.fromEntries(concepts.map((c) => {
    const values = students.map((s) => grid.get(s.id)[c.slug]).filter(Boolean);
    return [c.slug, values.length
      ? { p: Math.round(values.reduce((n, v) => n + v.p, 0) / values.length), students: values.length }
      : null];
  }));

  return {
    classId,
    concepts,
    students: students.map((s) => ({ id: s.id, name: s.name, cells: grid.get(s.id) })),
    averages,
    thresholds: { mastered: Math.round(MASTERED * 100), ready: Math.round(READY * 100) },
  };
}

module.exports = {
  BKT, MASTERED, READY,
  guessFor, bktUpdate, predictCorrect, schedule, statusOf,
  recordResponse, summariseChanges, masteryFor, nextPracticeQuestion, answerPractice,
  mistakesFor, videosFor,
  classMastery, PracticeError,
};
