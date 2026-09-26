const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../src/app');
const { pool, query, queryOne } = require('../src/config/database');
const { resetThrottle } = require('../src/services/authService');
const { load } = require('../scripts/import-questions');

/*
 * Content management (HLD UC-04, Section 4): only the coordinator creates and
 * edits content, and an edit is saved and shown to students (test C8).
 */

let coordinator;
let teacher;
let student;
let studentId;
let topicId;
let quizId;

const login = async (email, role) => {
  resetThrottle();
  const res = await request(app).post('/api/auth/login').send({ email, password: 'password123', role });
  return { Authorization: `Bearer ${res.body.token}` };
};

const question = (over = {}) => ({
  text: 'What does len("abc") give?',
  options: { a: '2', b: '3', c: '4' },
  correct: 'b',
  explanation: 'len counts the characters: a, b and c.',
  concepts: ['strings'],
  ...over,
});

beforeAll(async () => {
  coordinator = await login('coordinator@school.com', 'coordinator');
  teacher = await login('teacher1@school.com', 'teacher');
  // A student of its own: the seeded ones must stay as the other suites expect.
  const hash = await bcrypt.hash('password123', 4);
  studentId = (await queryOne(
    `INSERT INTO users (email, password_hash, name, role, school_id)
     VALUES ('manage@school.com', $1, 'Manage Tester', 'student', 'school_001') RETURNING id`,
    [hash],
  )).id;
  student = await login('manage@school.com', 'student');
  topicId = (await queryOne('SELECT topic_id AS id FROM quizzes ORDER BY id LIMIT 1')).id;
  const res = await request(app).post('/api/manage/quizzes').set(coordinator).send({ topicId, title: 'Manage test quiz' });
  quizId = res.body.data.id;
});

afterAll(async () => {
  await query('DELETE FROM users WHERE id = $1', [studentId]);
  await query("DELETE FROM quizzes WHERE title = 'Manage test quiz'");
  await pool.end();
});

test('only the coordinator can manage content', async () => {
  expect((await request(app).get('/api/manage/quizzes').set(teacher)).status).toBe(403);
  expect((await request(app).get('/api/manage/quizzes').set(student)).status).toBe(403);
  const res = await request(app).get('/api/manage/quizzes').set(coordinator);
  expect(res.status).toBe(200);
  expect(res.body.data.quizzes.some((q) => q.id === quizId)).toBe(true);
  expect(res.body.data.concepts.length).toBeGreaterThan(0);
});

test('C8: a question the coordinator adds and then edits is saved and shown to students', async () => {
  const created = await request(app).post(`/api/manage/quizzes/${quizId}/questions`).set(coordinator).send(question());
  expect(created.status).toBe(201);
  const { id } = created.body.data;

  const edited = await request(app).put(`/api/manage/questions/${id}`).set(coordinator)
    .send(question({ text: 'What does len("abcd") give?', options: { a: '3', b: '4', c: '5' }, correct: 'b' }));
  expect(edited.status).toBe(200);

  const served = (await request(app).get(`/api/quizzes/${quizId}`).set(student)).body.data.questions;
  expect(served.find((q) => q.id === id)).toMatchObject({ text: 'What does len("abcd") give?', optionB: '4' });

  const marked = await request(app).post(`/api/quizzes/${quizId}/attempts`).set(student).send({ answers: { [id]: 'b' } });
  expect(marked.body.data.score).toBe(1);

  const listed = (await request(app).get(`/api/manage/quizzes/${quizId}/questions`).set(coordinator)).body.data;
  expect(listed.find((q) => q.id === id)).toMatchObject({ correct: 'b', concepts: ['strings'], editedBy: 'Mr Johnson' });
});

test('a broken question is refused with a reason', async () => {
  const post = (q) => request(app).post(`/api/manage/quizzes/${quizId}/questions`).set(coordinator).send(q);
  const noAnswer = await post(question({ correct: 'e' }));
  expect(noAnswer.status).toBe(400);
  expect(noAnswer.body.error).toMatch(/correct "e" has no matching option/);
  expect((await post(question({ concepts: ['no-such-concept'] }))).body.error).toMatch(/unknown concept/);
  expect((await post(question({ options: { a: 'x'.repeat(300), b: 'y' }, correct: 'a' }))).body.error).toMatch(/longer than 255/);
  expect((await post(question({ text: '  ' }))).status).toBe(400);
});

test('two identical options are allowed but flagged', async () => {
  const res = await request(app).post(`/api/manage/quizzes/${quizId}/questions`).set(coordinator)
    .send(question({ options: { a: '3', b: '3', c: '4' }, correct: 'a' }));
  expect(res.status).toBe(201);
  expect(res.body.data.warnings.join(' ')).toMatch(/two options are the same/);
});

test('a deleted question is no longer served', async () => {
  const { id } = (await request(app).post(`/api/manage/quizzes/${quizId}/questions`).set(coordinator).send(question())).body.data;
  expect((await request(app).delete(`/api/manage/questions/${id}`).set(coordinator)).status).toBe(204);
  const served = (await request(app).get(`/api/quizzes/${quizId}`).set(student)).body.data.questions;
  expect(served.some((q) => q.id === id)).toBe(false);
  expect((await request(app).delete(`/api/manage/questions/${id}`).set(coordinator)).status).toBe(404);
});

test('a quiz title cannot be used twice in one topic', async () => {
  const res = await request(app).post('/api/manage/quizzes').set(coordinator).send({ topicId, title: 'Manage test quiz' });
  expect(res.status).toBe(409);
});

test('re-importing the question file does not undo an edit', async () => {
  const sample = require('../content/sample-questions.json');
  const fileQ = sample[0].quizzes[0].questions[0];
  const row = await queryOne(
    `SELECT q.id, q.text, q.option_a AS a, q.option_b AS b, q.option_c AS c, q.option_d AS d, q.correct_answer AS correct,
            q.explanation FROM questions q JOIN quizzes z ON z.id = q.quiz_id WHERE z.title = $1 AND q.text = $2`,
    [sample[0].quizzes[0].title, fileQ.text.trim()],
  );
  const tags = (await query(
    'SELECT c.slug FROM question_concepts qc JOIN concepts c ON c.id = qc.concept_id WHERE qc.question_id = $1', [row.id],
  )).map((r) => r.slug);

  // The coordinator re-tags it with a different concept and changes nothing else.
  const options = Object.fromEntries(['a', 'b', 'c', 'd'].filter((l) => row[l]).map((l) => [l, row[l]]));
  await request(app).put(`/api/manage/questions/${row.id}`).set(coordinator)
    .send({ text: row.text, options, correct: row.correct, explanation: row.explanation, concepts: ['plotting'] });

  await load(sample, { replace: false });
  const after = (await query(
    'SELECT c.slug FROM question_concepts qc JOIN concepts c ON c.id = qc.concept_id WHERE qc.question_id = $1', [row.id],
  )).map((r) => r.slug);
  expect(after).toEqual(['plotting']);

  // Put it back as it was, for the other suites.
  await query('UPDATE questions SET edited_at = NULL, edited_by = NULL WHERE id = $1', [row.id]);
  await query('DELETE FROM question_concepts WHERE question_id = $1', [row.id]);
  for (const slug of tags) {
    await query('INSERT INTO question_concepts SELECT $1, id FROM concepts WHERE slug = $2', [row.id, slug]);
  }
});
