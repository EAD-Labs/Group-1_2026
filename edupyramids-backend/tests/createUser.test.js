const request = require('supertest');
const app = require('../src/app');
const { pool, query } = require('../src/config/database');
const { resetThrottle } = require('../src/services/authService');
const { createUser, resetUser, UsageError } = require('../scripts/create-user');

/*
 * The first account on a new server, made from the command line: it signs
 * in with the printed password, nothing is made twice, and --reset gives a
 * forgotten coordinator a way back in that ends their old sessions.
 */

const EMAIL = 'first.coordinator@test.example';

const login = (password) => request(app).post('/api/auth/login')
  .send({ email: EMAIL, password, role: 'coordinator' });

beforeAll(() => resetThrottle());

afterAll(async () => {
  await query('DELETE FROM users WHERE email = $1', [EMAIL]);
  await pool.end();
});

test('a new coordinator signs in with the printed password', async () => {
  const made = await createUser({ role: 'coordinator', email: ` ${EMAIL.toUpperCase()} `, name: ' Asha   Rao ' });
  expect(made).toMatchObject({ email: EMAIL, name: 'Asha Rao', role: 'coordinator' });
  expect(made.password.length).toBeGreaterThanOrEqual(16);

  const res = await login(made.password);
  expect(res.status).toBe(200);
  expect(res.body.user.role).toBe('coordinator');
});

test('nothing is made twice, and bad input is refused', async () => {
  await expect(createUser({ role: 'coordinator', email: EMAIL, name: 'Asha Rao' })).rejects.toThrow(UsageError);
  await expect(createUser({ role: 'admin', email: 'x@test.example', name: 'X' })).rejects.toThrow(/role/);
  await expect(createUser({ role: 'teacher', email: 'not-an-email', name: 'X' })).rejects.toThrow(/email/);
  await expect(createUser({ role: 'teacher', email: 'y@test.example', name: '  ' })).rejects.toThrow(/name/);
  await expect(resetUser({ email: 'nobody@test.example' })).rejects.toThrow(UsageError);
});

test('--reset gives a new password and ends the old sessions', async () => {
  const before = await login((await resetUser({ email: EMAIL })).password);
  const auth = { Authorization: `Bearer ${before.body.token}` };
  expect((await request(app).get('/api/auth/me').set(auth)).status).toBe(200);

  await new Promise((r) => setTimeout(r, 1100)); // tokens are dated to the second
  const again = await resetUser({ email: EMAIL });
  expect((await request(app).get('/api/auth/me').set(auth)).status).toBe(401);
  expect((await login(again.password)).status).toBe(200);
});
