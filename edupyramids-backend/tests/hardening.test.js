const path = require('path');
const { spawnSync } = require('child_process');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../src/app');
const { pool, query } = require('../src/config/database');
const {
  resetThrottle, trackedFailures, recordFailure, pruneFailures, MAX_TRACKED,
} = require('../src/services/authService');

/*
 * The small hardening from the code review of 7 October: security headers on
 * every reply, indexes for attempts by quiz and game, and a record of failed
 * sign-ins that forgets old entries instead of growing for ever.
 */

afterAll(async () => {
  resetThrottle();
  await pool.end();
});

describe('values the database refuses are the caller\'s mistake', () => {
  const auth = async (email, role) => {
    resetThrottle();
    const res = await request(app).post('/api/auth/login').send({ email, password: 'password123', role });
    return { Authorization: `Bearer ${res.body.token}` };
  };

  test('an id too big for its column, or not a number, is a 400', async () => {
    const student = await auth('student1@school.com', 'student');
    const teacher = await auth('teacher1@school.com', 'teacher');
    expect((await request(app).get('/api/quizzes/99999999999').set(student)).status).toBe(400);
    expect((await request(app).get('/api/games/99999999999').set(student)).status).toBe(400);
    expect((await request(app).get('/api/progress/abc').set(teacher)).status).toBe(400);
  });

  test('a name too long for its column is a 400', async () => {
    const coordinator = await auth('coordinator@school.com', 'coordinator');
    const res = await request(app).post('/api/people/teachers').set(coordinator)
      .send({ name: 'n'.repeat(3000), email: 'too.long@test.example' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('That value is too long');
  });

  test('a real server error still says nothing about why', () => {
    const errorHandler = require('../src/middleware/errorHandler');
    const json = jest.fn();
    const res = { status: jest.fn(() => ({ json })) };
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    errorHandler(Object.assign(new Error('relation "users" is missing'), { code: '42P01' }), { method: 'GET', originalUrl: '/x' }, res);
    spy.mockRestore();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: 'Something went wrong' });
  });
});

describe('signing in', () => {
  test('a password or email that is not text is a plain 400', async () => {
    resetThrottle();
    const send = (body) => request(app).post('/api/auth/login').send(body);
    expect((await send({ email: 'student1@school.com', password: 123 })).status).toBe(400);
    expect((await send({ email: ['student1@school.com'], password: ['x'] })).status).toBe(400);
    expect((await send({ email: { a: 1 }, password: 'x' })).status).toBe(400);
  });

  test('an unknown email is really compared, so timing does not reveal who has an account', async () => {
    resetThrottle();
    const spy = jest.spyOn(bcrypt, 'compare');
    await request(app).post('/api/auth/login')
      .send({ email: 'nobody.here@test.example', password: 'wrong', role: 'student' });
    const [, hash] = spy.mock.calls[0];
    spy.mockRestore();
    expect(hash).toHaveLength(60);
    expect(bcrypt.getRounds(hash)).toBe(10);
  });
});

describe('the signing key', () => {
  test('a production server refuses the example file\'s placeholder', () => {
    const run = spawnSync(process.execPath, ['src/server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: 'change-me' },
      encoding: 'utf8',
      timeout: 20000,
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/still the placeholder/);
  });
});

describe('only students record attempts', () => {
  test('a teacher is refused, and can still read a quiz', async () => {
    resetThrottle();
    const login = await request(app).post('/api/auth/login')
      .send({ email: 'teacher1@school.com', password: 'password123', role: 'teacher' });
    const teacher = { Authorization: `Bearer ${login.body.token}` };
    const [{ id: quizId }] = await query('SELECT id FROM quizzes ORDER BY id LIMIT 1');
    const [{ id: gameId }] = await query('SELECT id FROM games ORDER BY id LIMIT 1');
    expect((await request(app).get(`/api/quizzes/${quizId}`).set(teacher)).status).toBe(200);
    expect((await request(app).post(`/api/quizzes/${quizId}/attempts`).set(teacher).send({ answers: {} })).status).toBe(403);
    expect((await request(app).post(`/api/games/${gameId}/results`).set(teacher).send({ answers: {} })).status).toBe(403);
  });
});

describe('security headers', () => {
  test('every reply carries them, and nothing names the framework', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['permissions-policy']).toMatch(/camera=\(\)/);
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  test('the app can still be shown inside the client\'s site', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-frame-options']).toBeUndefined();
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  test('HSTS only over HTTPS (as nginx reports it)', async () => {
    expect((await request(app).get('/api/health')).headers['strict-transport-security']).toBeUndefined();
    const https = await request(app).get('/api/health').set('X-Forwarded-Proto', 'https');
    expect(https.headers['strict-transport-security']).toBe('max-age=15552000');
  });
});

test('attempts are indexed by quiz and by game', async () => {
  const rows = await query(
    "SELECT indexname FROM pg_indexes WHERE tablename = 'attempts' AND indexname IN ($1, $2)",
    ['idx_attempts_quiz_id', 'idx_attempts_game_id'],
  );
  expect(rows.map((r) => r.indexname).sort()).toEqual(['idx_attempts_game_id', 'idx_attempts_quiz_id']);
});

describe('the record of failed sign-ins', () => {
  beforeEach(() => resetThrottle());

  test('expired entries are swept out', () => {
    recordFailure('old@test.example', '10.0.0.1');
    recordFailure('old@test.example', '10.0.0.2');
    expect(trackedFailures()).toBe(2);
    pruneFailures(Date.now() + 16 * 60_000); // past the 15-minute window
    expect(trackedFailures()).toBe(0);
  });

  test('entries still in the window are kept', () => {
    recordFailure('recent@test.example', '10.0.0.1');
    pruneFailures(Date.now() + 61_000);
    expect(trackedFailures()).toBe(1);
  });

  test('a flood of made-up addresses is capped, oldest first', () => {
    for (let i = 0; i < MAX_TRACKED + 50; i += 1) recordFailure(`flood${i}@test.example`, '10.0.0.9');
    expect(trackedFailures()).toBe(MAX_TRACKED);
    recordFailure('newest@test.example', '10.0.0.9');
    expect(trackedFailures()).toBe(MAX_TRACKED);
  });
});
