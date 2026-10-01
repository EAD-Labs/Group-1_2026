const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const { pool, query, queryOne } = require('../src/config/database');
const { resetThrottle } = require('../src/services/authService');

/*
 * Changing your own password: every role can, the current password is asked
 * for again, and every older session ends while this one carries on.
 */

const EMAIL = 'password.change@test.example';
const START = 'mango-river-42';
let userId;

const login = (password) => request(app).post('/api/auth/login')
  .send({ email: EMAIL, password, role: 'teacher' });
const bearer = (res) => ({ Authorization: `Bearer ${res.body.token}` });
const change = (auth, currentPassword, newPassword) => request(app).post('/api/auth/password')
  .set(auth).send({ currentPassword, newPassword });

beforeAll(async () => {
  resetThrottle();
  userId = (await queryOne(
    `INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, 'Pat Change', 'teacher') RETURNING id`,
    [EMAIL, await bcrypt.hash(START, 10)],
  )).id;
});

afterAll(async () => {
  await query('DELETE FROM users WHERE id = $1', [userId]);
  await pool.end();
});

test('the new password must be long enough, new, and follow the right current one', async () => {
  const auth = bearer(await login(START));
  expect((await change(auth, 'not-it', 'a-good-new-one')).body.error).toMatch(/current password is not right/);
  expect((await change(auth, START, 'short')).body.error).toMatch(/at least 8/);
  expect((await change(auth, START, START)).body.error).toMatch(/same as the current/);
  expect((await change(auth, START, 'x'.repeat(73))).body.error).toMatch(/at most 72/);
  expect((await request(app).post('/api/auth/password').send({})).status).toBe(401);
});

test('a changed password signs out other sessions; this one gets a fresh token', async () => {
  resetThrottle();
  const elsewhere = bearer(await login(START));
  const here = bearer(await login(START));
  await new Promise((r) => { setTimeout(r, 1100); });

  const res = await change(here, START, 'otter-tulip-77');
  expect(res.status).toBe(200);
  expect((await request(app).get('/api/auth/me').set(elsewhere)).status).toBe(401);
  expect((await request(app).get('/api/auth/me').set(here)).status).toBe(401);
  expect((await request(app).get('/api/auth/me').set({ Authorization: `Bearer ${res.body.token}` })).status).toBe(200);

  expect((await login(START)).status).toBe(401);
  expect((await login('otter-tulip-77')).status).toBe(200);
});

test('a removed account is signed out at once', async () => {
  const gone = (await queryOne(
    `INSERT INTO users (email, password_hash, name, role) VALUES ('gone@test.example', $1, 'Gone', 'student') RETURNING id`,
    [await bcrypt.hash(START, 10)],
  )).id;
  const res = await request(app).post('/api/auth/login').send({ email: 'gone@test.example', password: START, role: 'student' });
  await query('DELETE FROM users WHERE id = $1', [gone]);
  expect((await request(app).get('/api/auth/me').set(bearer(res))).status).toBe(401);
});
