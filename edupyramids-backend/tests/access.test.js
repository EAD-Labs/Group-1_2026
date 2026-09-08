const request = require('supertest');
const app = require('../src/app');
const { pool, queryOne } = require('../src/config/database');
const { resetThrottle } = require('../src/services/authService');

/*
 * Everything here goes at the API directly, bypassing the interface, because
 * that is how someone would actually try it: by editing the address bar or
 * replaying a request. A guard that only exists in React is not a guard.
 */

const tokens = {};
let classA;
let classB;
let student3;

beforeAll(async () => {
  resetThrottle();
  const signIn = async (email, role) => {
    const res = await request(app).post('/api/auth/login')
      .send({ email, password: 'password123', role });
    tokens[role === 'student' ? email : role] = res.body.token;
  };
  await signIn('student1@school.com', 'student');
  await signIn('teacher1@school.com', 'teacher');
  await signIn('coordinator@school.com', 'coordinator');

  classA = (await queryOne("SELECT id FROM classes WHERE name = 'Grade 9-A'")).id;
  classB = (await queryOne("SELECT id FROM classes WHERE name = 'Grade 9-B'")).id;
  student3 = (await queryOne("SELECT id FROM users WHERE email = 'student3@school.com'")).id;
});

afterAll(() => pool.end());

const as = (who) => ({ Authorization: `Bearer ${tokens[who]}` });

describe('who may read what', () => {
  test('A3  a student is refused a class report, and is told nothing about it', async () => {
    const res = await request(app)
      .get(`/api/analytics/classes/${classA}`)
      .set(as('student1@school.com'));

    expect(res.status).toBe(403);
    // No student names, no class name, nothing to learn from the refusal.
    expect(JSON.stringify(res.body)).not.toMatch(/Aditya|Priya|Grade/);
  });

  test('a student cannot read another student\'s progress', async () => {
    const res = await request(app)
      .get(`/api/progress/${student3}`)
      .set(as('student1@school.com'));
    expect(res.status).toBe(403);
  });

  test('a student can read their own progress', async () => {
    const me = (await queryOne("SELECT id FROM users WHERE email = 'student1@school.com'")).id;
    const res = await request(app).get(`/api/progress/${me}`).set(as('student1@school.com'));
    expect(res.status).toBe(200);
    expect(res.body.data.studentId).toBe(me);
  });

  test('C5  a teacher sees their own class', async () => {
    const res = await request(app)
      .get(`/api/analytics/classes/${classA}`)
      .set(as('teacher'));

    expect(res.status).toBe(200);
    expect(res.body.data.byStudent.map((s) => s.name)).toEqual(
      expect.arrayContaining(['Aditya Sharma', 'Priya Sundaram']),
    );
  });

  test('C5  a teacher is refused a class that is not theirs', async () => {
    const res = await request(app)
      .get(`/api/analytics/classes/${classB}`)
      .set(as('teacher'));

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toMatch(/Rahul/);
  });

  test('C8  a coordinator may read every class', async () => {
    for (const id of [classA, classB]) {
      const res = await request(app).get(`/api/analytics/classes/${id}`).set(as('coordinator'));
      expect(res.status).toBe(200);
    }
  });

  test('C7  a student who has attempted nothing shows as no attempts, not zero', async () => {
    const res = await request(app)
      .get(`/api/analytics/classes/${classB}`)
      .set(as('coordinator'));

    const rahul = res.body.data.byStudent.find((s) => s.name === 'Rahul Menon');
    expect(rahul.attempts).toBe(0);
    // null, so the interface can say "No attempts yet". A 0 here would be
    // displayed as a real score of zero.
    expect(rahul.averagePercent).toBeNull();
  });

  test('every protected endpoint refuses an anonymous caller', async () => {
    const paths = [
      '/api/auth/me',
      '/api/quizzes',
      '/api/games',
      '/api/progress/1',
      `/api/analytics/classes/${classA}`,
    ];
    for (const path of paths) {
      expect((await request(app).get(path)).status).toBe(401);
    }
  });
});

describe('which classes a caller is offered', () => {
  test('a teacher is only offered their own class', async () => {
    const res = await request(app).get('/api/classes').set(as('teacher'));

    expect(res.status).toBe(200);
    expect(res.body.data.map((c) => c.name)).toEqual(['Grade 9-A']);
  });

  test('a coordinator is offered every class', async () => {
    const res = await request(app).get('/api/classes').set(as('coordinator'));

    expect(res.status).toBe(200);
    expect(res.body.data.map((c) => c.name)).toEqual(['Grade 9-A', 'Grade 9-B']);
  });

  test('a student is offered only the class they are in', async () => {
    const res = await request(app).get('/api/classes').set(as('student1@school.com'));

    expect(res.status).toBe(200);
    expect(res.body.data.map((c) => c.name)).toEqual(['Grade 9-A']);
  });

  test('an anonymous caller is refused', async () => {
    expect((await request(app).get('/api/classes')).status).toBe(401);
  });
});
