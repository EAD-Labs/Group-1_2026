const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const { pool, queryOne, query } = require('../src/config/database');
const { resetThrottle } = require('../src/services/authService');
const { attemptTime } = require('../src/services/attemptTime');

/*
 * The offline pack must let a device mark exactly as the server does. The
 * strongest check is to build a perfect answer from the pack's key alone,
 * upload it, and see the server give full marks.
 */

/** A full-marks answer built only from what the device holds. */
const fromKey = {
  matching: (g) => g.key.answer,
  drag_drop: (g) => g.key.bucket,
  memory: (g) => {
    const byPair = {};
    Object.entries(g.key.pairOf).forEach(([tile, i]) => { (byPair[i] ||= []).push(tile); });
    return { moves: Object.values(byPair) };
  },
  parsons: (g) => ({ program: g.key.solution }),
  predict: (g) => g.key.output,
  bughunt: (g) => Object.fromEntries(Object.keys(g.key.bugLine)
    .map((id) => [id, { line: g.key.bugLine[id], fix: g.key.fix[id] }])),
  fillblank: (g) => g.key.blanks,
};

let student;
let pack;
const made = [];               // attempt ids, removed afterwards

beforeAll(async () => {
  resetThrottle();
  const res = await request(app).post('/api/auth/login')
    .send({ email: 'student1@school.com', password: 'password123', role: 'student' });
  student = { Authorization: `Bearer ${res.body.token}` };
  pack = (await request(app).get('/api/offline/pack').set(student)).body.data;
});

// Leave student1's figures as the other suites expect them.
afterAll(async () => {
  await query('DELETE FROM attempts WHERE id = ANY($1::int[])', [made]);
  await pool.end();
});

test('only students get the pack', async () => {
  resetThrottle();
  const t = await request(app).post('/api/auth/login')
    .send({ email: 'teacher1@school.com', password: 'password123', role: 'teacher' });
  const res = await request(app).get('/api/offline/pack').set({ Authorization: `Bearer ${t.body.token}` });
  expect(res.status).toBe(403);
});

test('the pack holds every quiz with its answers and every game with a key', async () => {
  const quizzes = await queryOne('SELECT COUNT(*)::int AS n FROM quizzes');
  const games = await queryOne('SELECT COUNT(*)::int AS n FROM games');
  expect(pack.quizzes).toHaveLength(quizzes.n);
  expect(pack.games).toHaveLength(games.n);
  expect(pack.quizzes[0].questions[0]).toHaveProperty('correct');
  pack.games.forEach((g) => expect(g.key).toBeDefined());
});

test('an unchanged pack is not sent again', async () => {
  const res = await request(app).get(`/api/offline/pack?have=${pack.version}`).set(student);
  expect(res.body).toMatchObject({ unchanged: true, version: pack.version });
});

test.each(['matching', 'drag_drop', 'memory', 'parsons', 'predict', 'bughunt', 'fillblank'])(
  '%s: a perfect answer built from the offline key gets full marks from the server',
  async (kind) => {
    const games = pack.games.filter((g) => g.kind === kind);
    expect(games.length).toBeGreaterThan(0);
    for (const g of games) {
      const res = await request(app).post(`/api/games/${g.id}/results`).set(student)
        .send({ answers: fromKey[kind](g) });
      made.push(res.body.data.attemptId);
      expect([g.title, res.body.data.percent]).toEqual([g.title, 100]);
    }
  },
);

test('a quiz answered from the pack gets full marks, dated when it was done', async () => {
  const quiz = pack.quizzes[0];
  const answers = Object.fromEntries(quiz.questions.map((q) => [q.id, q.correct]));
  const answeredAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

  const res = await request(app).post(`/api/quizzes/${quiz.id}/attempts`).set(student)
    .send({ answers, clientAttemptId: crypto.randomUUID(), answeredAt });
  made.push(res.body.data.attemptId);
  expect(res.body.data.percent).toBe(100);

  const row = await queryOne('SELECT created_at FROM attempts WHERE id = $1', [res.body.data.attemptId]);
  expect(new Date(row.created_at).toISOString()).toBe(answeredAt);
});

describe('trusting the device clock only so far', () => {
  const now = Date.parse('2026-09-22T12:00:00Z');
  test('a time in the past month is kept', () => {
    expect(attemptTime('2026-09-20T09:00:00Z', now)).toEqual(new Date('2026-09-20T09:00:00Z'));
  });
  test('the future, very old dates and rubbish are ignored', () => {
    expect(attemptTime('2026-09-23T12:00:00Z', now)).toBeNull();
    expect(attemptTime('2026-07-01T12:00:00Z', now)).toBeNull();
    expect(attemptTime('yesterday', now)).toBeNull();
    expect(attemptTime(undefined, now)).toBeNull();
  });
});
