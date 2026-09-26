const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const { pool, query, queryOne } = require('../src/config/database');
const { resetThrottle } = require('../src/services/authService');
const { token } = require('../src/games/common');

/*
 * The HLD's acceptance tests (Section 14) that no other suite is named for.
 * The full map, test by test, is docs/acceptance-tests.md.
 *
 * The games are played by tapping rather than dragging (it works the same by
 * mouse, touch and keyboard), so B1 and B2 are about what a placed piece is
 * worth when marked: the drag itself is a browser matter, checked by hand.
 */

let student;
let studentId;

beforeAll(async () => {
  const hash = await bcrypt.hash('password123', 4);
  studentId = (await queryOne(
    `INSERT INTO users (email, password_hash, name, role, school_id)
     VALUES ('acceptance@school.com', $1, 'Acceptance Tester', 'student', 'school_001') RETURNING id`,
    [hash],
  )).id;
  resetThrottle();
  const res = await request(app).post('/api/auth/login')
    .send({ email: 'acceptance@school.com', password: 'password123', role: 'student' });
  student = { Authorization: `Bearer ${res.body.token}` };
});

afterAll(async () => {
  await query('DELETE FROM users WHERE id = $1', [studentId]);
  await pool.end();
});

const game = (kind) => queryOne('SELECT id, content, topic_id AS "topicId" FROM games WHERE kind = $1 ORDER BY id LIMIT 1', [kind]);
const attempts = async (gameId) => (await queryOne(
  'SELECT COUNT(*)::int AS n FROM attempts WHERE student_id = $1 AND game_id = $2', [studentId, gameId],
)).n;

test('B1: a piece in the right place is marked right and worth one point', async () => {
  const g = await game('drag_drop');
  const [first] = g.content.items;
  const res = await request(app).post(`/api/games/${g.id}/results`).set(student)
    .send({ answers: { [token(g.id, 'i0')]: first.bucket } });
  expect(res.body.data.score).toBe(1);
  expect(res.body.data.feedback[0]).toMatchObject({ correct: true, given: first.bucket });
});

test('B2: a piece in the wrong place earns nothing', async () => {
  const g = await game('drag_drop');
  const [first] = g.content.items;
  const wrong = g.content.buckets.find((b) => b !== first.bucket);
  const res = await request(app).post(`/api/games/${g.id}/results`).set(student)
    .send({ answers: { [token(g.id, 'i0')]: wrong } });
  expect(res.body.data.score).toBe(0);
  expect(res.body.data.feedback[0].correct).toBe(false);
});

test('B5: a right pair turned over ten more times does not raise the score', async () => {
  const g = await game('memory');
  const pair = [token(g.id, 'a0'), token(g.id, 'b0')];
  const once = await request(app).post(`/api/games/${g.id}/results`).set(student).send({ answers: { moves: [pair] } });
  const eleven = await request(app).post(`/api/games/${g.id}/results`).set(student)
    .send({ answers: { moves: Array(11).fill(pair) } });
  expect(eleven.body.data.score).toBe(once.body.data.score);
  expect(eleven.body.data.score).toBe(1);
});

test('B6: a finished game saves one result, points once; an interrupted one saves nothing', async () => {
  const g = await game('matching');
  const before = await attempts(g.id);
  const clientAttemptId = crypto.randomUUID();
  const answers = Object.fromEntries(g.content.pairs.map((_, i) => [token(g.id, `l${i}`), token(g.id, `r${i}`)]));
  const first = await request(app).post(`/api/games/${g.id}/results`).set(student).send({ answers, clientAttemptId });
  const again = await request(app).post(`/api/games/${g.id}/results`).set(student).send({ answers, clientAttemptId });
  expect(again.body.data.duplicate).toBe(true);
  expect(again.body.data.xp).toBe(0);
  expect(await attempts(g.id)).toBe(before + 1);
  expect(first.body.data.topic).toBeTruthy();

  // The next game is opened and played for a while, then the page is refreshed.
  const next = await game('memory');
  const beforeNext = await attempts(next.id);
  await request(app).get(`/api/games/${next.id}`).set(student);
  await request(app).post(`/api/games/${next.id}/check`).set(student)
    .send({ first: token(next.id, 'a0'), second: token(next.id, 'b1'), clientAttemptId: crypto.randomUUID() });
  expect(await attempts(next.id)).toBe(beforeNext);
});

test('C4: progress follows topics learnt, not time spent', async () => {
  // A student of its own, who has done nothing yet however long they stay.
  const hash = await bcrypt.hash('password123', 4);
  const id = (await queryOne(
    `INSERT INTO users (email, password_hash, name, role, school_id)
     VALUES ('c4@school.com', $1, 'C4 Tester', 'student', 'school_001') RETURNING id`,
    [hash],
  )).id;
  resetThrottle();
  const login = await request(app).post('/api/auth/login').send({ email: 'c4@school.com', password: 'password123', role: 'student' });
  const auth = { Authorization: `Bearer ${login.body.token}` };
  const progress = async () => (await request(app).get(`/api/progress/${id}`).set(auth)).body.data.summary;

  const start = await progress();
  expect(start.percentDone).toBe(0);

  // Learning one topic (80% or more on it) moves progress by one topic's share.
  const g = await game('matching');
  const answers = Object.fromEntries(g.content.pairs.map((_, i) => [token(g.id, `l${i}`), token(g.id, `r${i}`)]));
  await request(app).post(`/api/games/${g.id}/results`).set(auth).send({ answers });
  const after = await progress();
  expect(after.topicsLearnt).toBe(1);
  expect(after.percentDone).toBe(Math.round(100 / after.topics));

  await query('DELETE FROM users WHERE id = $1', [id]);
});
