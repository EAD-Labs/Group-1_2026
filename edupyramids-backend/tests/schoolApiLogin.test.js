jest.mock('axios');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const { pool, query, queryOne } = require('../src/config/database');
const { login, resetThrottle } = require('../src/services/authService');

/*
 * Signing in through the school's login API (EduPyramids, meeting of 29
 * September): the API says who someone is and what they are, and a first
 * sign-in makes their account here. Accounts made in this app keep working.
 */

const API = 'https://school.example/api/spoken-social/verify-user/';
const ok = (user) => Promise.resolve({ data: { status: 'success', user } });
const refused = (status) => Object.assign(new Error('no'), { response: { status } });
const EMAILS = ['api.student@school.example', 'api.teacher@school.example', 'api.norole@school.example', 'local.only@school.example'];

beforeAll(() => { process.env.SCHOOL_AUTH_URL = API; });
beforeEach(() => { resetThrottle(); axios.post.mockReset(); });
afterAll(async () => {
  process.env.SCHOOL_AUTH_URL = '';
  await query('DELETE FROM users WHERE email = ANY($1)', [EMAILS]);
  await pool.end();
});

test('a first sign-in through the API makes the account, with the role the API gives', async () => {
  axios.post.mockReturnValue(ok({ spoken_user_id: 501, email: EMAILS[0], first_name: 'Api', last_name: 'Student', role: 'student' }));
  const res = await login({ email: EMAILS[0], password: 'their-password', role: 'student', ip: '1.1.1.1' });
  expect(res.ok).toBe(true);
  expect(res.user).toMatchObject({ email: EMAILS[0], name: 'Api Student', role: 'student' });
  expect(axios.post).toHaveBeenCalledWith(API, { email: EMAILS[0], password: 'their-password' }, expect.anything());
  // Their password is never stored here.
  expect((await queryOne('SELECT password_hash FROM users WHERE email = $1', [EMAILS[0]])).password_hash).toBe('!');
});

test("the school's role names are mapped, and the role tab still has to match", async () => {
  axios.post.mockReturnValue(ok({ spoken_user_id: 502, email: EMAILS[1], first_name: 'Api', roles: ['invigilator'] }));
  expect((await login({ email: EMAILS[1], password: 'x', role: 'teacher', ip: '1.1.1.1' })).user.role).toBe('teacher');
  const wrongTab = await login({ email: EMAILS[1], password: 'x', role: 'student', ip: '1.1.1.1' });
  expect(wrongTab).toMatchObject({ ok: false, status: 401 });
});

test('a wrong password or a disabled account is refused, the same way as everything else', async () => {
  axios.post.mockRejectedValue(refused(401));
  const wrong = await login({ email: EMAILS[0], password: 'nope', role: 'student', ip: '1.1.1.2' });
  axios.post.mockRejectedValue(refused(403));
  const disabled = await login({ email: EMAILS[0], password: 'nope', role: 'student', ip: '1.1.1.2' });
  expect(wrong).toEqual(disabled);
  expect(wrong).toMatchObject({ ok: false, status: 401 });
});

test('a new person with no role anywhere is not let in', async () => {
  axios.post.mockReturnValue(ok({ spoken_user_id: 503, email: EMAILS[2], first_name: 'No', last_name: 'Role' }));
  expect((await login({ email: EMAILS[2], password: 'x', ip: '1.1.1.3' })).ok).toBe(false);
  expect(await queryOne('SELECT id FROM users WHERE email = $1', [EMAILS[2]])).toBeNull();
});

test('accounts made in this app sign in with their own password, without asking the API', async () => {
  await query("INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, 'Local Only', 'teacher')",
    [EMAILS[3], await bcrypt.hash('mango-river-42', 10)]);
  const res = await login({ email: EMAILS[3], password: 'mango-river-42', role: 'teacher', ip: '1.1.1.4' });
  expect(res.ok).toBe(true);
  expect(axios.post).not.toHaveBeenCalled();
});

test('when the API cannot be reached, local accounts still work and nobody else gets in', async () => {
  axios.post.mockRejectedValue(new Error('timeout'));
  expect((await login({ email: EMAILS[3], password: 'mango-river-42', role: 'teacher', ip: '1.1.1.5' })).ok).toBe(true);
  expect((await login({ email: 'stranger@school.example', password: 'x', ip: '1.1.1.5' })).ok).toBe(false);
});
