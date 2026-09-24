const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../src/app');
const { pool, query, queryOne } = require('../src/config/database');
const { resetThrottle } = require('../src/services/authService');
const { quizStars } = require('../src/services/pathService');

/*
 * The learning path. A brand-new student of its own, so what other suites
 * have played cannot open or close anything here.
 */

let student;
let studentId;
let other;

const login = async (email) => {
  resetThrottle();
  const res = await request(app).post('/api/auth/login').send({ email, password: 'password123', role: 'student' });
  return { Authorization: `Bearer ${res.body.token}` };
};
const path = async (who = student) => (await request(app).get('/api/path').set(who)).body.data;

// The sample units hold three questions each; a full checkpoint needs more.
const EXTRA_QUIZ = 'Path test extra questions';

beforeAll(async () => {
  const units = await query(
    `SELECT DISTINCT t.id, t.sort_order, t.level FROM topics t JOIN quizzes q ON q.topic_id = t.id
      ORDER BY t.sort_order, t.level, t.id LIMIT 2`,
  );
  for (const u of units) {
    const quizId = (await queryOne(
      'INSERT INTO quizzes (title, topic_id, difficulty) VALUES ($1, $2, 3) RETURNING id', [EXTRA_QUIZ, u.id],
    )).id;
    for (let n = 1; n <= 10; n += 1) {
      await query(
        `INSERT INTO questions (quiz_id, text, option_a, option_b, option_c, correct_answer, explanation)
         VALUES ($1, $2, 'yes', 'no', 'maybe', 'a', 'Because.')`,
        [quizId, `Path test question ${u.id}.${n}`],
      );
    }
  }

  const hash = await bcrypt.hash('password123', 4);
  studentId = (await queryOne(
    `INSERT INTO users (email, password_hash, name, role, school_id)
     VALUES ('path@school.com', $1, 'Path Tester', 'student', 'school_001') RETURNING id`,
    [hash],
  )).id;
  student = await login('path@school.com');
  other = await login('student1@school.com');
});

afterAll(async () => {
  await query('DELETE FROM users WHERE id = $1', [studentId]);
  await query('DELETE FROM quizzes WHERE title = $1', [EXTRA_QUIZ]);
  await pool.end();
});

/** A quiz attempt at a chosen score, by answering the first n questions right. */
async function takeQuiz(quizId, rightCount) {
  const questions = await query('SELECT id, correct_answer FROM questions WHERE quiz_id = $1 ORDER BY id', [quizId]);
  const answers = Object.fromEntries(questions.map((q, i) => [q.id, i < rightCount ? q.correct_answer : null]));
  return request(app).post(`/api/quizzes/${quizId}/attempts`).set(student).send({ answers });
}

async function answersFor(checkpoint, right) {
  const key = await query('SELECT id, correct_answer FROM questions WHERE id = ANY($1)', [checkpoint.questions.map((q) => q.id)]);
  return Object.fromEntries(key.map((q, i) => [q.id, i < right ? q.correct_answer : (q.correct_answer === 'a' ? 'b' : 'a')]));
}

test('quiz stars follow the best score', () => {
  expect([null, 50, 60, 80, 99, 100].map(quizStars)).toEqual([0, 0, 1, 2, 2, 3]);
});

test('a new student sees one road: the first quiz is next, everything after it is locked', async () => {
  const { units, next } = await path();
  expect(units.length).toBeGreaterThan(1);
  const [first, second] = units;
  expect(first.unlocked).toBe(true);
  expect(first.nodes[0]).toMatchObject({ type: 'quiz', state: 'current' });
  expect(first.nodes.slice(1).every((n) => n.state === 'locked')).toBe(true);
  expect(next).toMatchObject({ type: 'quiz', id: first.nodes[0].id });
  expect(second.unlocked).toBe(false);
  expect(second.jumpFrom).toBe(first.topicId);
  // Warm-ups sit beside the path, open with the unit.
  expect(first.extras.every((g) => ['matching', 'drag_drop', 'memory'].includes(g.kind))).toBe(true);
});

test('games follow the quiz from the easiest skill to the hardest', async () => {
  const { units } = await path();
  const order = ['quiz', 'fillblank', 'parsons', 'predict', 'trace', 'bughunt', 'bugcatch'];
  for (const u of units) {
    const ranks = u.nodes.map((n) => order.indexOf(n.kind));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  }
});

test('a star on a node opens the next one; below 60% does not', async () => {
  const first = (await path()).units[0];
  const quiz = first.nodes[0];
  const count = (await queryOne('SELECT COUNT(*)::int AS n FROM questions WHERE quiz_id = $1', [quiz.id])).n;

  await takeQuiz(quiz.id, Math.floor(count * 0.4));
  let unit = (await path()).units[0];
  expect(unit.nodes[0].state).toBe('current');
  expect(unit.nodes[1].state).toBe('locked');

  await takeQuiz(quiz.id, Math.ceil(count * 0.6));
  unit = (await path()).units[0];
  expect(unit.nodes[0]).toMatchObject({ state: 'done', stars: 1 });
  expect(unit.nodes[1].state).toBe('current');
});

test('a unit with no quiz has no checkpoint, and neither has the last unit', async () => {
  const { units } = await path();
  units.filter((u) => !u.nodes.some((n) => n.type === 'quiz')).forEach((u) => expect(u.hasCheckpoint).toBe(false));
  expect(units[units.length - 1].hasCheckpoint).toBe(false);
});

test('a checkpoint is ten mixed questions with no answers, on a ticket only its owner can use', async () => {
  const withCheckpoint = (await path()).units.filter((u) => u.hasCheckpoint);
  const [earlier, unit] = withCheckpoint;
  const res = await request(app).get(`/api/path/checkpoints/${unit.topicId}`).set(student);
  expect(res.status).toBe(200);
  const cp = res.body.data;
  expect(cp.questions).toHaveLength(10);
  expect(new Set(cp.questions.map((q) => q.id)).size).toBe(10);
  expect(JSON.stringify(cp.questions)).not.toMatch(/correct|explanation/);

  // Some questions come from the unit before, for interleaving.
  const topics = await query(
    'SELECT DISTINCT q.topic_id FROM questions qs JOIN quizzes q ON q.id = qs.quiz_id WHERE qs.id = ANY($1)',
    [cp.questions.map((q) => q.id)],
  );
  expect(topics.map((t) => t.topic_id).sort()).toEqual([earlier.topicId, unit.topicId].sort());

  const answers = await answersFor(cp, 10);
  const stolen = await request(app).post(`/api/path/checkpoints/${unit.topicId}`).set(other).send({ ticket: cp.ticket, answers });
  expect(stolen.status).toBe(403);
  const forged = await request(app).post(`/api/path/checkpoints/${unit.topicId}`).set(student)
    .send({ ticket: `${cp.ticket.split('.')[0]}.AAAA`, answers });
  expect(forged.status).toBe(400);
});

test('failing a checkpoint keeps the next unit shut; passing it opens it, even skipping ahead', async () => {
  const { units } = await path();
  const topicId = units[0].topicId;

  const first = (await request(app).get(`/api/path/checkpoints/${topicId}`).set(student)).body.data;
  const failed = await request(app).post(`/api/path/checkpoints/${topicId}`).set(student)
    .send({ ticket: first.ticket, answers: await answersFor(first, 5) });
  expect(failed.body.data).toMatchObject({ score: 5, maxScore: 10, passed: false });
  expect((await path()).units[1].unlocked).toBe(false);

  const second = (await request(app).get(`/api/path/checkpoints/${topicId}`).set(student)).body.data;
  const passed = await request(app).post(`/api/path/checkpoints/${topicId}`).set(student)
    .send({ ticket: second.ticket, answers: await answersFor(second, 7) });
  expect(passed.body.data).toMatchObject({ score: 7, passed: true, passPercent: 70 });
  expect(passed.body.data.feedback[0]).toHaveProperty('explanation');

  const after = await path();
  expect(after.units[0].checkpoint).toMatchObject({ passed: true, tries: 2, state: 'done' });
  expect(after.units[1].unlocked).toBe(true);
  expect(after.units[1].nodes[0].state).toBe('open');

  // Every answer to a question tagged with a concept went to the mastery model.
  const asked = [...first.questions, ...second.questions].map((q) => q.id);
  const tagged = await query('SELECT DISTINCT question_id FROM question_concepts WHERE question_id = ANY($1)', [asked]);
  const responses = await query(
    "SELECT DISTINCT question_id FROM responses WHERE student_id = $1 AND source = 'checkpoint'", [studentId],
  );
  expect(tagged.length).toBeGreaterThan(0);
  expect(responses.map((r) => r.question_id).sort()).toEqual(tagged.map((r) => r.question_id).sort());
});

test('a concept due for review shows on the units that practise it, and the review keeps to it', async () => {
  const { units } = await path();
  const unit = units.find((u) => u.unlocked && u.nodes.some((n) => n.type === 'quiz'));
  const concept = await queryOne(
    `SELECT DISTINCT c.id, c.slug FROM question_concepts qc JOIN concepts c ON c.id = qc.concept_id
       JOIN questions q ON q.id = qc.question_id JOIN quizzes z ON z.id = q.quiz_id
      WHERE z.topic_id = $1 LIMIT 1`,
    [unit.topicId],
  );
  expect(unit.review).toBeNull();

  await query(
    `INSERT INTO concept_mastery (student_id, concept_id, p_known, answered, correct, mastered_at, review_interval, next_review)
     VALUES ($1, $2, 0.97, 6, 6, now() - interval '3 days', 1, now() - interval '1 hour')
     ON CONFLICT (student_id, concept_id) DO UPDATE SET p_known = 0.97, answered = 6, next_review = now() - interval '1 hour'`,
    [studentId, concept.id],
  );

  const after = (await path()).units.find((u) => u.topicId === unit.topicId);
  expect(after.review.concepts.map((c) => c.slug)).toContain(concept.slug);
  const url = new URL(after.review.href, 'http://x');
  expect(url.pathname).toBe('/practice');
  expect(url.searchParams.get('focus').split(',')).toContain(concept.slug);
  expect(url.searchParams.get('n')).toBe('5');

  const focus = after.review.concepts.map((c) => c.slug);
  const next = await request(app).get(`/api/practice/next?focus=${focus.join(',')}`).set(student);
  expect(focus).toContain(next.body.data.concept.slug);
});

test('the path is for students only', async () => {
  resetThrottle();
  const res = await request(app).post('/api/auth/login').send({ email: 'teacher1@school.com', password: 'password123', role: 'teacher' });
  const teacher = { Authorization: `Bearer ${res.body.token}` };
  expect((await request(app).get('/api/path').set(teacher)).status).toBe(403);
});
