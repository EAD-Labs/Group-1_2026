const request = require('supertest');
const app = require('../src/app');
const { pool } = require('../src/config/database');
const { resetThrottle } = require('../src/services/authService');

const login = (email, password, role) =>
  request(app).post('/api/auth/login').send({ email, password, role });

beforeEach(() => resetThrottle());
afterAll(() => pool.end());

describe('signing in', () => {
  test('A1  a student signs in and gets a token and their own details', async () => {
    const res = await login('student1@school.com', 'password123', 'student');

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      email: 'student1@school.com',
      role: 'student',
      name: 'Aditya Sharma',
    });
    expect(typeof res.body.token).toBe('string');
  });

  test('A1  teachers and coordinators sign in too', async () => {
    await expect(login('teacher1@school.com', 'password123', 'teacher'))
      .resolves.toMatchObject({ status: 200 });
    await expect(login('coordinator@school.com', 'password123', 'coordinator'))
      .resolves.toMatchObject({ status: 200 });
  });

  test('the response never carries the password hash', async () => {
    const res = await login('student1@school.com', 'password123', 'student');
    expect(JSON.stringify(res.body)).not.toMatch(/\$2[aby]\$/);
    expect(res.body.user).not.toHaveProperty('passwordHash');
  });

  test('A2  a wrong password is refused', async () => {
    const res = await login('student1@school.com', 'wrong-password', 'student');
    expect(res.status).toBe(401);
  });

  test('A2  unknown account, wrong password and wrong role are indistinguishable', async () => {
    // This is the whole point: none of the three may reveal whether the
    // address exists or what it is for.
    const unknown = await login('nobody@school.com', 'password123', 'student');
    const wrongPassword = await login('student1@school.com', 'nope', 'student');
    const wrongRole = await login('student1@school.com', 'password123', 'teacher');

    expect(unknown.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(wrongRole.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknown.body);
    expect(wrongRole.body).toEqual(unknown.body);
  });

  test('A2  the sixth failure in a row is throttled', async () => {
    const attempt = () => login('student2@school.com', 'wrong', 'student');

    for (let i = 0; i < 5; i += 1) {
      expect((await attempt()).status).toBe(401);
    }
    expect((await attempt()).status).toBe(429);
  });

  test('A2  the throttle does not lock out a different account', async () => {
    for (let i = 0; i < 5; i += 1) {
      await login('student2@school.com', 'wrong', 'student');
    }
    const other = await login('student1@school.com', 'password123', 'student');
    expect(other.status).toBe(200);
  });

  test('an email or password that is missing gets 400, not 401', async () => {
    expect((await login('student1@school.com', '', 'student')).status).toBe(400);
    expect((await login('', 'password123', 'student')).status).toBe(400);
  });

  test('the email is not case sensitive', async () => {
    const res = await login('Student1@School.com', 'password123', 'student');
    expect(res.status).toBe(200);
  });
});

describe('the current session', () => {
  test('/auth/me returns the signed-in user', async () => {
    const { body } = await login('teacher1@school.com', 'password123', 'teacher');
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${body.token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('teacher');
  });

  test('a token that has been tampered with is refused', async () => {
    const { body } = await login('student1@school.com', 'password123', 'student');
    const [head, payload] = body.token.split('.');
    const forged = `${head}.${payload}.notarealsignature`;

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${forged}`);

    expect(res.status).toBe(401);
  });

  test('no token at all is refused', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
  });
});
