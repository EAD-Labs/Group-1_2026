const request = require('supertest');
const app = require('../src/app');
const { pool, query } = require('../src/config/database');
const { resetThrottle } = require('../src/services/authService');
const { newPassword } = require('../src/services/peopleService');

/*
 * Managing users (HLD Section 4: the coordinator's alone): classes, teachers
 * and students, and starting passwords that work.
 */

const DOMAIN = 'people.test';
let coordinator;

const login = async (email, password, role) => {
  resetThrottle();
  return request(app).post('/api/auth/login').send({ email, password, role });
};

beforeAll(async () => {
  const res = await login('coordinator@school.com', 'password123', 'coordinator');
  coordinator = { Authorization: `Bearer ${res.body.token}` };
});

afterAll(async () => {
  await query("DELETE FROM classes WHERE name LIKE 'People test%'");
  await query('DELETE FROM users WHERE email LIKE $1', [`%@${DOMAIN}`]);
  await pool.end();
});

test('starting passwords are two words and a number, and differ', () => {
  const made = new Set(Array.from({ length: 20 }, newPassword));
  expect(made.size).toBeGreaterThan(15);
  [...made].forEach((p) => expect(p).toMatch(/^[a-z]+-[a-z]+-\d{2}$/));
});

test('only the coordinator manages users', async () => {
  const teacher = await login('teacher1@school.com', 'password123', 'teacher');
  const auth = { Authorization: `Bearer ${teacher.body.token}` };
  expect((await request(app).get('/api/people').set(auth)).status).toBe(403);
  expect((await request(app).post('/api/people/teachers').set(auth).send({ name: 'X', email: `x@${DOMAIN}` })).status).toBe(403);
});

describe('a class from nothing', () => {
  let teacher;
  let classId;
  let students;

  test('a new teacher can sign in with the starting password', async () => {
    const res = await request(app).post('/api/people/teachers').set(coordinator)
      .send({ name: 'Ms  Test Teacher', email: `Teacher@${DOMAIN}` });
    expect(res.status).toBe(201);
    teacher = res.body.data;
    expect(teacher.teacher).toMatchObject({ name: 'Ms Test Teacher', email: `teacher@${DOMAIN}` });
    expect(res.headers['cache-control']).toBe('no-store');
    const signIn = await login(`teacher@${DOMAIN}`, teacher.password, 'teacher');
    expect(signIn.status).toBe(200);

    const again = await request(app).post('/api/people/teachers').set(coordinator).send({ name: 'Dup', email: `teacher@${DOMAIN}` });
    expect(again.status).toBe(409);
  });

  test('a class is made with its teacher; the name must be new', async () => {
    const res = await request(app).post('/api/people/classes').set(coordinator)
      .send({ name: 'People test class', teacherId: teacher.teacher.id });
    expect(res.status).toBe(201);
    classId = res.body.data.id;
    const dup = await request(app).post('/api/people/classes').set(coordinator).send({ name: 'people TEST class', teacherId: teacher.teacher.id });
    expect(dup.status).toBe(409);
    const noTeacher = await request(app).post('/api/people/classes').set(coordinator).send({ name: 'People test 2', teacherId: 999999 });
    expect(noTeacher.status).toBe(400);
  });

  test('a pasted list of students: new accounts, an existing student, and lines that are refused', async () => {
    const res = await request(app).post(`/api/people/classes/${classId}/students`).set(coordinator).send({
      students: [
        { name: 'Asha Rao', email: `asha@${DOMAIN}` },
        { name: 'Vikram Das', email: `vikram@${DOMAIN}` },
        { name: 'Aditya Sharma', email: 'student1@school.com' },     // already a student elsewhere
        { name: 'Not An Email', email: 'nope' },
        { name: 'Twice', email: `asha@${DOMAIN}` },
        { name: 'A teacher', email: 'teacher1@school.com' },
        { name: '', email: `noname@${DOMAIN}` },
      ],
    });
    expect(res.status).toBe(201);
    students = res.body.data;
    expect(students.map((s) => s.status)).toEqual(['created', 'created', 'enrolled', 'refused', 'refused', 'refused', 'refused']);
    expect(students[3].reason).toMatch(/not an email/);
    expect(students[4].reason).toMatch(/twice/);
    expect(students[5].reason).toMatch(/teacher/);
    expect(students[2].password).toBeUndefined();

    // A new student signs in with the password they were given, and is in the class.
    const signIn = await login(`asha@${DOMAIN}`, students[0].password, 'student');
    expect(signIn.status).toBe(200);
    const auth = { Authorization: `Bearer ${signIn.body.token}` };
    const classes = (await request(app).get('/api/me/classes').set(auth)).body.data;
    expect(classes.map((c) => c.name)).toEqual(['People test class']);

    // Adding the same list again changes nothing.
    const again = await request(app).post(`/api/people/classes/${classId}/students`).set(coordinator)
      .send({ students: [{ name: 'Asha Rao', email: `asha@${DOMAIN}` }] });
    expect(again.body.data[0].status).toBe('already');
  });

  test("the class's teacher sees the new students", async () => {
    const signIn = await login(`teacher@${DOMAIN}`, teacher.password, 'teacher');
    const auth = { Authorization: `Bearer ${signIn.body.token}` };
    const report = (await request(app).get(`/api/analytics/classes/${classId}`).set(auth)).body.data;
    expect(report.students).toBe(3);
  });

  test('a new starting password replaces the old one', async () => {
    const res = await request(app).post(`/api/people/users/${students[1].id}/password`).set(coordinator);
    expect(res.status).toBe(200);
    expect((await login(`vikram@${DOMAIN}`, students[1].password, 'student')).status).toBe(401);
    expect((await login(`vikram@${DOMAIN}`, res.body.data.password, 'student')).status).toBe(200);

    const coord = (await query("SELECT id FROM users WHERE email = 'coordinator@school.com'"))[0].id;
    expect((await request(app).post(`/api/people/users/${coord}/password`).set(coordinator)).status).toBe(403);
  });

  test('a student taken out of a class keeps their account; the class can be renamed and moved', async () => {
    const existing = students[2].id;
    expect((await request(app).delete(`/api/people/classes/${classId}/students/${existing}`).set(coordinator)).status).toBe(204);
    const overview = (await request(app).get('/api/people').set(coordinator)).body.data;
    const cls = overview.classes.find((c) => c.id === classId);
    expect(cls.students.map((s) => s.email).sort()).toEqual([`asha@${DOMAIN}`, `vikram@${DOMAIN}`]);
    expect((await login('student1@school.com', 'password123', 'student')).status).toBe(200);

    const moved = await request(app).put(`/api/people/classes/${classId}`).set(coordinator)
      .send({ name: 'People test class B', teacherId: (await query("SELECT id FROM users WHERE email = 'teacher1@school.com'"))[0].id });
    expect(moved.body.data.name).toBe('People test class B');
  });
});
