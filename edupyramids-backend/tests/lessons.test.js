const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../src/app');
const { pool, query, queryOne } = require('../src/config/database');
const { resetThrottle } = require('../src/services/authService');
const { chunkSizes, lessonsFor } = require('../src/services/lessonService');

/*
 * Lessons: a long quiz shown as short slices. The sample quizzes are only
 * three questions, so this suite adds a twenty-question quiz of its own to the
 * first unit, and a student of its own, and removes both afterwards.
 */

const QUIZ = 'Lessons test quiz';
let quizId;
let student;
let studentId;

beforeAll(async () => {
  const topic = await queryOne(
    `SELECT t.id FROM topics t WHERE EXISTS (SELECT 1 FROM quizzes q WHERE q.topic_id = t.id)
      ORDER BY t.sort_order, t.level, t.id LIMIT 1`,
  );
  quizId = (await queryOne(
    'INSERT INTO quizzes (title, topic_id, difficulty) VALUES ($1, $2, 1) RETURNING id', [QUIZ, topic.id],
  )).id;
  const loops = await queryOne("SELECT id FROM concepts WHERE slug = 'loops'");
  for (let n = 1; n <= 20; n += 1) {
    const q = await queryOne(
      `INSERT INTO questions (quiz_id, text, option_a, option_b, option_c, correct_answer)
       VALUES ($1, $2, 'yes', 'no', 'maybe', 'a') RETURNING id`,
      [quizId, `Lesson test question ${n}`],
    );
    if (n <= 8) await query('INSERT INTO question_concepts VALUES ($1, $2)', [q.id, loops.id]);
  }

  const hash = await bcrypt.hash('password123', 4);
  studentId = (await queryOne(
    `INSERT INTO users (email, password_hash, name, role, school_id)
     VALUES ('lessons@school.com', $1, 'Lesson Tester', 'student', 'school_001') RETURNING id`,
    [hash],
  )).id;
  resetThrottle();
  const res = await request(app).post('/api/auth/login')
    .send({ email: 'lessons@school.com', password: 'password123', role: 'student' });
  student = { Authorization: `Bearer ${res.body.token}` };
});

afterAll(async () => {
  await query('DELETE FROM users WHERE id = $1', [studentId]);
  await query('DELETE FROM quizzes WHERE title = $1', [QUIZ]);
  await pool.end();
});

const lessonBricks = async () => (await request(app).get('/api/path').set(student)).body.data.units
  .flatMap((u) => u.nodes).filter((n) => n.type === 'quiz' && n.id === quizId);

test('lessons are as even as possible and no longer than eight', () => {
  expect(chunkSizes(22)).toEqual([8, 7, 7]);
  expect(chunkSizes(32)).toEqual([8, 8, 8, 8]);
  expect(chunkSizes(19)).toEqual([7, 6, 6]);
  expect(chunkSizes(63).every((n) => n <= 8)).toBe(true);
});

test('a long quiz splits into lessons that cover every question once, named after their concepts', async () => {
  const lessons = await lessonsFor(quizId);
  expect(lessons.map((l) => l.questionIds.length)).toEqual([7, 7, 6]);
  const all = lessons.flatMap((l) => l.questionIds);
  expect(new Set(all).size).toBe(20);
  expect(lessons[0].title).toBe('Lesson 1: Loops and range');

  const short = await queryOne("SELECT id FROM quizzes WHERE title <> $1 ORDER BY id LIMIT 1", [QUIZ]);
  expect(await lessonsFor(short.id)).toEqual([]);
});

test('the pyramid shows the quiz as lesson bricks', async () => {
  const bricks = await lessonBricks();
  expect(bricks.map((b) => b.lesson)).toEqual([1, 2, 3]);
  expect(bricks[0].title).toMatch(/^Lesson 1: /);
});

test('a lesson delivers and marks only its own questions', async () => {
  const lessons = await lessonsFor(quizId);
  const res = await request(app).get(`/api/quizzes/${quizId}?lesson=2`).set(student);
  expect(res.body.data.lesson).toMatchObject({ index: 2, count: 3 });
  expect(res.body.data.questions.map((q) => q.id)).toEqual(lessons[1].questionIds);

  const answers = Object.fromEntries(lessons[1].questionIds.map((id) => [id, 'a']));
  const marked = await request(app).post(`/api/quizzes/${quizId}/attempts`).set(student).send({ answers, lesson: 2 });
  expect(marked.body.data).toMatchObject({ score: 7, maxScore: 7, lesson: 2 });

  const bricks = await lessonBricks();
  expect(bricks.find((b) => b.lesson === 2).stars).toBe(3);
  expect(bricks.find((b) => b.lesson === 1).stars).toBe(0);
});

test('an attempt at the whole quiz counts for every lesson it covered', async () => {
  const ids = (await query('SELECT id FROM questions WHERE quiz_id = $1', [quizId])).map((q) => q.id);
  const answers = Object.fromEntries(ids.map((id) => [id, 'a']));
  await request(app).post(`/api/quizzes/${quizId}/attempts`).set(student).send({ answers });
  const bricks = await lessonBricks();
  expect(bricks.every((b) => b.stars === 3)).toBe(true);
});

test('a lesson that does not exist is refused', async () => {
  expect((await request(app).get(`/api/quizzes/${quizId}?lesson=9`).set(student)).status).toBe(404);
  expect((await request(app).get(`/api/quizzes/${quizId}?lesson=0`).set(student)).status).toBe(400);
  const res = await request(app).post(`/api/quizzes/${quizId}/attempts`).set(student).send({ answers: {}, lesson: 9 });
  expect(res.status).toBe(400);
});

test('the offline download carries each quiz\'s lessons', async () => {
  const pack = (await request(app).get('/api/offline/pack').set(student)).body.data;
  const quiz = pack.quizzes.find((q) => q.id === quizId);
  expect(quiz.lessons.map((l) => l.questionIds.length)).toEqual([7, 7, 6]);
});
