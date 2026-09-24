const crypto = require('crypto');
const { pool, query } = require('../config/database');
const Game = require('../models/Game');
const { recordResponse, summariseChanges, masteryFor } = require('./masteryService');
const { shuffle } = require('../games/common');
const { quizStars } = require('./xp');

/*
 * The learning path: one road through the course, after Duolingo's 2022
 * redesign, which replaced a tree of choices with a single path and measured
 * better learning for it. The student always knows what is next.
 *
 * A unit is a level (Bronze, Silver, Gold, ...). Inside it, in order: the
 * quiz, then the games from easiest to hardest skill, then a checkpoint, a
 * mixed challenge that opens the next unit. Recognition warm-ups (matching,
 * sorting, memory) sit beside the path as optional extras.
 *
 * Unlocking is generous on purpose. A node opens when the one before it has
 * a star; anything already played stays open; a locked unit can be jumped to
 * by passing the checkpoint before it. Levels only ever go up (HLD D-05).
 */

// Easiest skill first: fill in, arrange, predict, trace, debug, test.
const CORE_ORDER = ['fillblank', 'parsons', 'predict', 'trace', 'bughunt', 'bugcatch'];
const WARM_UPS = ['matching', 'drag_drop', 'memory'];

const CHECKPOINT = {
  size: 10,
  fromEarlier: 3,     // interleaving: some questions from units already done
  passAt: 0.7,
  ttlMs: 3 * 60 * 60 * 1000,
};

class PathError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}


async function unitsWithContent(studentId) {
  const [topics, quizzes, games, checkpoints] = await Promise.all([
    query('SELECT id, name, level, sort_order FROM topics ORDER BY sort_order, level, id'),
    query(
      `SELECT q.id, q.title, q.topic_id AS "topicId",
              COUNT(a.id)::int AS attempts,
              MAX(ROUND(a.score::numeric / a.max_score * 100))::int AS "bestPercent"
         FROM quizzes q
         LEFT JOIN attempts a ON a.quiz_id = q.id AND a.student_id = $1
        GROUP BY q.id
        ORDER BY q.difficulty, q.id`,
      [studentId],
    ),
    Game.findAll({ studentId }),
    query(
      `SELECT topic_id AS "topicId", COUNT(*)::int AS tries, BOOL_OR(passed) AS passed,
              MAX(ROUND(score::numeric / max_score * 100))::int AS "bestPercent"
         FROM checkpoint_attempts WHERE student_id = $1 GROUP BY topic_id`,
      [studentId],
    ),
  ]);

  return topics.map((t) => {
    const cp = checkpoints.find((c) => c.topicId === t.id) || { tries: 0, passed: false, bestPercent: null };
    const topicGames = games.filter((g) => g.topicId === t.id);
    const nodes = [
      ...quizzes.filter((q) => q.topicId === t.id).map((q) => ({
        type: 'quiz', id: q.id, title: q.title, kind: 'quiz',
        attempts: q.attempts, bestPercent: q.bestPercent, stars: quizStars(q.bestPercent),
      })),
      ...topicGames.filter((g) => !WARM_UPS.includes(g.kind))
        .sort((a, b) => (CORE_ORDER.indexOf(a.kind) - CORE_ORDER.indexOf(b.kind)) || a.id - b.id)
        .map((g) => ({
          type: 'game', id: g.id, title: g.title, kind: g.kind,
          attempts: g.attempts, bestPercent: g.bestPercent, stars: g.bestStars ?? 0,
        })),
    ];
    const extras = topicGames.filter((g) => WARM_UPS.includes(g.kind)).map((g) => ({
      type: 'game', id: g.id, title: g.title, kind: g.kind,
      attempts: g.attempts, bestPercent: g.bestPercent, stars: g.bestStars ?? 0,
    }));
    return {
      topicId: t.id, topic: t.name, level: t.level, nodes, extras, checkpoint: cp,
    };
  }).filter((u) => u.nodes.length || u.extras.length);
}

const REVIEW_LENGTH = 5;

/** Per unit, the concepts its questions practise that are due for review. */
async function reviewsFor(studentId) {
  const [mastery, tagged] = await Promise.all([
    masteryFor(studentId),
    query(
      `SELECT DISTINCT z.topic_id AS "topicId", c.slug
         FROM question_concepts qc
         JOIN concepts c ON c.id = qc.concept_id
         JOIN questions q ON q.id = qc.question_id
         JOIN quizzes z ON z.id = q.quiz_id`,
    ),
  ]);
  const due = new Map(mastery.filter((c) => c.status === 'review').map((c) => [c.slug, c.name]));
  const byTopic = new Map();
  tagged.filter((t) => due.has(t.slug)).forEach((t) => {
    if (!byTopic.has(t.topicId)) byTopic.set(t.topicId, []);
    byTopic.get(t.topicId).push({ slug: t.slug, name: due.get(t.slug) });
  });
  return byTopic;
}

/** The whole path for one student, with what is open and what comes next. */
async function pathFor(studentId) {
  const [units, reviews] = await Promise.all([unitsWithContent(studentId), reviewsFor(studentId)]);
  let next = null;

  units.forEach((u, i) => {
    u.hasCheckpoint = i < units.length - 1 && u.nodes.some((n) => n.type === 'quiz');
  });

  units.forEach((u, i) => {
    const prev = units[i - 1];
    const played = u.nodes.some((n) => n.attempts > 0) || u.extras.some((n) => n.attempts > 0);
    // A unit with no quiz has no checkpoint: finishing its nodes opens the next one.
    const prevFinished = prev && !prev.hasCheckpoint && prev.unlocked && prev.nodes.every((n) => n.stars > 0);
    u.unlocked = i === 0 || played || prev.checkpoint.passed || prevFinished || u.checkpoint.passed;

    let open = u.unlocked;
    u.nodes.forEach((n) => {
      n.state = n.stars > 0 ? 'done' : (open || n.attempts > 0) ? 'open' : 'locked';
      if (n.state === 'open' && !next) { n.state = 'current'; next = { ...n, topic: u.topic }; }
      open = n.stars > 0;
    });
    u.extras.forEach((n) => { n.state = u.unlocked ? (n.stars > 0 ? 'done' : 'open') : 'locked'; });

    const coreDone = u.nodes.every((n) => n.stars > 0);
    u.checkpoint.state = !u.hasCheckpoint ? 'none'
      : u.checkpoint.passed ? 'done'
        : u.unlocked && coreDone ? 'open' : 'locked';
    if (u.checkpoint.state === 'open' && !next) {
      u.checkpoint.state = 'current';
      next = { type: 'checkpoint', id: u.topicId, title: `${u.topic} checkpoint`, topic: u.topic };
    }
    // A locked unit can be reached by passing the checkpoint before it.
    u.jumpFrom = !u.unlocked && units[i - 1].hasCheckpoint ? units[i - 1].topicId : null;

    // Concepts from this unit that are fading: a short review, from the path.
    const due = u.unlocked ? reviews.get(u.topicId) || [] : [];
    u.review = due.length ? {
      concepts: due,
      questions: REVIEW_LENGTH,
      href: `/practice?focus=${due.map((c) => c.slug).join(',')}&n=${REVIEW_LENGTH}`,
    } : null;

    const done = u.nodes.filter((n) => n.stars > 0).length + (u.checkpoint.passed ? 1 : 0);
    u.progress = { done, total: u.nodes.length + (u.hasCheckpoint ? 1 : 0) };
  });

  return { units, next };
}

// ---------------------------------------------------------------- checkpoints

const sign = (payload) => crypto.createHmac('sha256', process.env.JWT_SECRET)
  .update(`checkpoint:${payload}`).digest('base64url');

function makeTicket(studentId, topicId, ids) {
  const payload = Buffer.from(JSON.stringify({ s: studentId, t: topicId, q: ids, at: Date.now() })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function readTicket(ticket, studentId, topicId) {
  const [payload, mac] = String(ticket || '').split('.');
  const good = payload && mac && mac.length === sign(payload).length
    && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(sign(payload)));
  if (!good) throw new PathError('This checkpoint could not be checked. Start it again.');
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (data.s !== studentId || data.t !== topicId) throw new PathError('This checkpoint belongs to someone else.', 403);
  if (Date.now() - data.at > CHECKPOINT.ttlMs) throw new PathError('This checkpoint has run out of time. Start it again.');
  return data.q;
}

const sample = (list, n) => shuffle(list).slice(0, n);

/** A fresh checkpoint: mostly this unit's questions, some from earlier units. No answers. */
async function startCheckpoint(studentId, topicId) {
  const { units } = await pathFor(studentId);
  const at = units.findIndex((u) => u.topicId === topicId);
  if (at < 0 || !units[at].hasCheckpoint) throw new PathError('This unit has no checkpoint', 404);

  const questionsIn = (topicIds) => (topicIds.length ? query(
    `SELECT qs.id FROM questions qs JOIN quizzes q ON q.id = qs.quiz_id WHERE q.topic_id = ANY($1)`,
    [topicIds],
  ) : Promise.resolve([]));
  const here = (await questionsIn([topicId])).map((r) => r.id);
  const earlier = (await questionsIn(units.slice(0, at).map((u) => u.topicId))).map((r) => r.id);

  const fromEarlier = sample(earlier, Math.min(CHECKPOINT.fromEarlier, earlier.length));
  const ids = sample([...sample(here, CHECKPOINT.size - fromEarlier.length), ...fromEarlier], CHECKPOINT.size);
  if (!ids.length) throw new PathError('This unit has no questions yet', 404);

  const questions = await query(
    `SELECT id, text, option_a AS "optionA", option_b AS "optionB", option_c AS "optionC",
            option_d AS "optionD", option_e AS "optionE"
       FROM questions WHERE id = ANY($1)`,
    [ids],
  );
  const byId = new Map(questions.map((q) => [q.id, q]));
  return {
    topicId,
    topic: units[at].topic,
    passPercent: Math.round(CHECKPOINT.passAt * 100),
    ticket: makeTicket(studentId, topicId, ids),
    questions: ids.map((id) => byId.get(id)),
  };
}

/** Mark a checkpoint, store the try, and feed every answer to the mastery model. */
async function finishCheckpoint({ studentId, topicId, ticket, answers = {} }) {
  const ids = readTicket(ticket, studentId, topicId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rows = (await client.query(
      `SELECT qs.id, qs.text, qs.correct_answer AS correct, qs.explanation, t.name AS topic
         FROM questions qs JOIN quizzes q ON q.id = qs.quiz_id JOIN topics t ON t.id = q.topic_id
        WHERE qs.id = ANY($1)`,
      [ids],
    )).rows;
    const byId = new Map(rows.map((r) => [r.id, r]));

    const changes = [];
    const feedback = [];
    for (const id of ids) {
      const q = byId.get(id);
      if (!q) continue;
      const given = answers[id] ?? answers[String(id)] ?? null;
      const correct = given === q.correct;
      feedback.push({
        questionId: id, text: q.text, given, correct, correctAnswer: q.correct, explanation: q.explanation, topic: q.topic,
      });
      // eslint-disable-next-line no-await-in-loop
      changes.push(await recordResponse(client, { studentId, questionId: id, correct, source: 'checkpoint' }));
    }

    const score = feedback.filter((f) => f.correct).length;
    const maxScore = feedback.length;
    const passed = maxScore > 0 && score / maxScore >= CHECKPOINT.passAt;
    await client.query(
      'INSERT INTO checkpoint_attempts (student_id, topic_id, score, max_score, passed) VALUES ($1, $2, $3, $4, $5)',
      [studentId, topicId, score, maxScore, passed],
    );
    await client.query('COMMIT');

    return {
      topicId, score, maxScore, percent: Math.round((score / maxScore) * 100), passed, xp: passed ? 20 : 5,
      passPercent: Math.round(CHECKPOINT.passAt * 100), feedback, mastery: summariseChanges(changes),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  pathFor, startCheckpoint, finishCheckpoint, quizStars, PathError, CHECKPOINT, CORE_ORDER, WARM_UPS,
};
