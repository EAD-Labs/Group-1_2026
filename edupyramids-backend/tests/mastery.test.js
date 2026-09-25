const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../src/app');
const { pool, query, queryOne } = require('../src/config/database');
const { resetThrottle } = require('../src/services/authService');
const {
  bktUpdate, guessFor, schedule, statusOf, MASTERED,
} = require('../src/services/masteryService');

const login = async (email, role) => {
  resetThrottle();
  const res = await request(app).post('/api/auth/login').send({ email, password: 'password123', role });
  return { Authorization: `Bearer ${res.body.token}` };
};

let student;
let studentId;

// A student and class of its own: other suites rely on the seeded students
// having no activity beyond what they create themselves.
beforeAll(async () => {
  const hash = await bcrypt.hash('password123', 4);
  studentId = (await queryOne(
    `INSERT INTO users (email, password_hash, name, role, school_id)
     VALUES ('mastery@school.com', $1, 'Meera Pillai', 'student', 'school_001') RETURNING id`,
    [hash],
  )).id;
  const teacherId = (await queryOne("SELECT id FROM users WHERE email = 'teacher2@school.com'")).id;
  const classId = (await queryOne(
    `INSERT INTO classes (name, teacher_id, school_id) VALUES ('Grade 9-C', $1, 'school_001') RETURNING id`,
    [teacherId],
  )).id;
  await query('INSERT INTO class_students VALUES ($1, $2)', [classId, studentId]);
  student = await login('mastery@school.com', 'student');
});

// Leave nothing behind for the suites that count classes and students.
afterAll(async () => {
  await query("DELETE FROM classes WHERE name = 'Grade 9-C'");
  await query('DELETE FROM users WHERE id = $1', [studentId]);
  await pool.end();
});

describe('the knowledge tracing arithmetic', () => {
  test('a right answer raises the estimate by Bayes rule plus learning', () => {
    // posterior = .2*.9 / (.2*.9 + .8*.25) = .4737; + (1 - .4737) * .12
    expect(bktUpdate(0.2, true, 0.25)).toBeCloseTo(0.5368, 3);
  });

  test('a wrong answer lowers it, allowing for a slip', () => {
    // posterior = .2*.1 / (.2*.1 + .8*.75) = .0323; + (1 - .0323) * .12
    expect(bktUpdate(0.2, false, 0.25)).toBeCloseTo(0.1484, 3);
  });

  test('a lucky guess counts for less when guessing is easier', () => {
    expect(bktUpdate(0.2, true, guessFor(2))).toBeLessThan(bktUpdate(0.2, true, guessFor(4)));
  });

  test('steady right answers reach mastery, and it never hits exactly 1', () => {
    let p = 0.2;
    let steps = 0;
    while (p < MASTERED) { p = bktUpdate(p, true, 0.25); steps += 1; }
    expect(steps).toBeLessThanOrEqual(5);
    for (let i = 0; i < 50; i += 1) p = bktUpdate(p, true, 0.25);
    expect(p).toBeLessThan(1);
  });

  test('reviews space out on success and reset on a miss', () => {
    const now = new Date('2026-09-01T00:00:00Z');
    const first = schedule({ mastered_at: null, review_interval: 0 }, 0.96, true, now);
    expect(first.interval).toBe(1);

    const second = schedule({ mastered_at: now, review_interval: 1 }, 0.97, true, now);
    expect(second.interval).toBe(2.5);

    const dropped = schedule({ mastered_at: now, review_interval: 2.5 }, 0.8, false, now);
    expect(dropped).toEqual({ interval: 0, nextReview: null, masteredAt: null });
  });

  test('a mastered concept past its review date is due', () => {
    const past = new Date(Date.now() - 1000);
    expect(statusOf({ answered: 5, p_known: 0.97, next_review: past })).toBe('review');
    expect(statusOf({ answered: 5, p_known: 0.5 })).toBe('learning');
    expect(statusOf(null)).toBe('new');
  });
});

describe('adaptive practice', () => {
  test('the first question never gives the answer away, and says why it was picked', async () => {
    const res = await request(app).get('/api/practice/next').set(student);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/correct_answer|correctAnswer|explanation/);
    expect(res.body.data.reason).toEqual(expect.any(String));
    expect(res.body.data.predicted).toBeGreaterThan(0);
  });

  test('a concept waits until what it builds on is known', async () => {
    // Loops builds on Lists, which a new student has not shown yet.
    const res = await request(app).get('/api/practice/next').set(student);
    expect(res.body.data.concept.slug).not.toBe('loops');

    const mastery = (await request(app).get('/api/practice/mastery').set(student)).body.data;
    expect(mastery.find((c) => c.slug === 'loops').waitingOn).toEqual(['Lists and tuples']);
  });

  test('answering updates the estimate and logs the response', async () => {
    const { data: pick } = (await request(app).get('/api/practice/next').set(student)).body;
    const q = await queryOne('SELECT correct_answer FROM questions WHERE id = $1', [pick.question.id]);

    const res = await request(app).post('/api/practice/answer').set(student)
      .send({ questionId: pick.question.id, answer: q.correct_answer });

    expect(res.status).toBe(200);
    expect(res.body.data.correct).toBe(true);
    const change = res.body.data.mastery.find((m) => m.slug === pick.concept.slug);
    expect(change.after).toBeGreaterThan(change.before);

    const logged = await query(
      "SELECT source FROM responses WHERE student_id = $1 AND question_id = $2", [studentId, pick.question.id],
    );
    expect(logged.map((r) => r.source)).toContain('practice');
  });

  test('questions already seen in the session are not repeated', async () => {
    const seen = [];
    for (let i = 0; i < 4; i += 1) {
      const res = await request(app).get(`/api/practice/next?exclude=${seen.join(',')}`).set(student);
      expect(seen).not.toContain(res.body.data.question.id);
      seen.push(res.body.data.question.id);
    }
  });

  test('after three in a row on one concept, practice mixes in another', async () => {
    const basics = await query(
      `SELECT qc.question_id AS id FROM question_concepts qc JOIN concepts c ON c.id = qc.concept_id
        WHERE c.slug = 'basics' ORDER BY qc.question_id LIMIT 3`,
    );
    const res = await request(app)
      .get(`/api/practice/next?exclude=${basics.map((q) => q.id).join(',')}`).set(student);
    expect(res.body.data.concept.slug).not.toBe('basics');
  });

  test('staff cannot practise, and a bad answer letter is refused', async () => {
    const teacher = await login('teacher1@school.com', 'teacher');
    expect((await request(app).get('/api/practice/next').set(teacher)).status).toBe(403);
    expect((await request(app).post('/api/practice/answer').set(student)
      .send({ questionId: 1, answer: 'z' })).status).toBe(400);
  });
});

describe('the practice hub', () => {
  const wrongFor = (correct) => (correct === 'a' ? 'b' : 'a');

  test('a wrong answer points to the Spoken Tutorial video that teaches it', async () => {
    const { data: pick } = (await request(app).get('/api/practice/next').set(student)).body;
    const q = await queryOne('SELECT correct_answer FROM questions WHERE id = $1', [pick.question.id]);
    const res = await request(app).post('/api/practice/answer').set(student)
      .send({ questionId: pick.question.id, answer: wrongFor(q.correct_answer) });
    expect(res.body.data.correct).toBe(false);
    expect(res.body.data.revisit).toMatchObject({ title: expect.any(String) });
    expect(res.body.data.revisit.url).toMatch(/^https:\/\/spoken-tutorial\.org\//);
  });

  test('the overview lists every concept with its videos, and counts the mistakes to fix', async () => {
    const { body } = await request(app).get('/api/practice/overview').set(student);
    expect(body.data.mistakes).toBeGreaterThanOrEqual(1);
    const basics = body.data.concepts.find((c) => c.slug === 'basics');
    expect(basics.videos.length).toBeGreaterThan(0);
  });

  test('each concept names its introductory video, and the importer refuses one that does not exist', () => {
    const { validate } = require('../scripts/import-concepts');
    const concepts = require('../content/concepts.json');
    expect(validate(concepts)).toEqual([]);
    const typo = concepts.map((c, i) => (i === 0 ? { ...c, video: 'no-such-video' } : c));
    expect(validate(typo).join(' ')).toMatch(/no-such-video/);
  });

  test('"fix my mistakes" serves wrong answers until they are put right', async () => {
    const before = (await request(app).get('/api/practice/overview').set(student)).body.data.mistakes;
    const { data: pick } = (await request(app).get('/api/practice/next?mode=mistakes').set(student)).body;
    expect(pick.reason).toMatch(/wrong before/);

    const q = await queryOne('SELECT correct_answer FROM questions WHERE id = $1', [pick.question.id]);
    await request(app).post('/api/practice/answer').set(student)
      .send({ questionId: pick.question.id, answer: q.correct_answer });

    const after = (await request(app).get('/api/practice/overview').set(student)).body.data.mistakes;
    expect(after).toBe(before - 1);
    const again = await request(app).get(`/api/practice/next?mode=mistakes&exclude=${pick.question.id}`).set(student);
    if (after === 0) expect(again.status).toBe(404);
    else expect(again.body.data.question.id).not.toBe(pick.question.id);
  });
});

describe('quizzes feed the model', () => {
  test('a submitted quiz reports what moved, once', async () => {
    const quiz = await queryOne(
      "SELECT z.id FROM quizzes z JOIN topics t ON t.id = z.topic_id WHERE t.name = 'Lists' LIMIT 1",
    );
    const questions = await query('SELECT id, correct_answer FROM questions WHERE quiz_id = $1', [quiz.id]);
    const answers = Object.fromEntries(questions.map((q) => [q.id, q.correct_answer]));
    const clientAttemptId = crypto.randomUUID();

    const first = await request(app).post(`/api/quizzes/${quiz.id}/attempts`).set(student)
      .send({ answers, clientAttemptId });
    const lists = first.body.data.mastery.find((m) => m.slug === 'lists');
    expect(lists.after).toBeGreaterThan(lists.before);

    const before = (await queryOne('SELECT COUNT(*)::int AS n FROM responses WHERE student_id = $1', [studentId])).n;
    const again = await request(app).post(`/api/quizzes/${quiz.id}/attempts`).set(student)
      .send({ answers, clientAttemptId });
    const after = (await queryOne('SELECT COUNT(*)::int AS n FROM responses WHERE student_id = $1', [studentId])).n;
    expect(again.body.data.mastery).toEqual([]);
    expect(after).toBe(before);
  });
});

describe('the class heatmap', () => {
  test('a teacher sees their own class, students by concept', async () => {
    const teacher = await login('teacher2@school.com', 'teacher');
    const classId = (await queryOne("SELECT id FROM classes WHERE name = 'Grade 9-C'")).id;

    const res = await request(app).get(`/api/analytics/classes/${classId}/mastery`).set(teacher);
    expect(res.status).toBe(200);
    const row = res.body.data.students.find((s) => s.id === studentId);
    expect(row.cells.lists.p).toBeGreaterThan(20);
    expect(res.body.data.concepts.map((c) => c.slug)).toEqual(expect.arrayContaining(['basics', 'lists', 'loops']));
  });

  test('another class is refused, and so is a student', async () => {
    const teacher = await login('teacher1@school.com', 'teacher');
    const classId = (await queryOne("SELECT id FROM classes WHERE name = 'Grade 9-C'")).id;
    expect((await request(app).get(`/api/analytics/classes/${classId}/mastery`).set(teacher)).status).toBe(403);
    expect((await request(app).get(`/api/analytics/classes/${classId}/mastery`).set(student)).status).toBe(403);
  });
});
