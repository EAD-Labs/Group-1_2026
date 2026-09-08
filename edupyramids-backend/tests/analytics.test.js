const request = require('supertest');
const app = require('../src/app');
const { pool, query, queryOne } = require('../src/config/database');
const Attempt = require('../src/models/Attempt');
const { resetThrottle } = require('../src/services/authService');

/*
 * The class report, on attempts this file owns.
 *
 * It borrows Grade 9-B and adds one student of its own rather than creating a
 * class, for two reasons: a report is an aggregate, so an attempt filed by
 * another suite would quietly change every figure asserted here, and a new
 * class would show up in the class lists that access.test.js checks exactly.
 * Nothing else in the suite files an attempt for Grade 9-B.
 */

let classId;
let studentId;
let quizId;
let questions;
let token;

beforeAll(async () => {
  resetThrottle();

  classId = (await queryOne("SELECT id FROM classes WHERE name = 'Grade 9-B'")).id;

  studentId = (await queryOne(
    `INSERT INTO users (email, password_hash, name, role, school_id)
     VALUES ('probe@school.com', 'x', 'Probe Student', 'student', 'school_001')
     RETURNING id`,
  )).id;
  await query('INSERT INTO class_students VALUES ($1, $2)', [classId, studentId]);

  quizId = (await queryOne(
    "SELECT z.id FROM quizzes z JOIN topics t ON t.id = z.topic_id WHERE t.name = 'Loops'",
  )).id;
  questions = await query(
    'SELECT id, correct_answer FROM questions WHERE quiz_id = $1 ORDER BY id', [quizId],
  );

  // Grade 9-B belongs to Mr Iyer, so he is the teacher who may read it.
  const res = await request(app).post('/api/auth/login')
    .send({ email: 'teacher2@school.com', password: 'password123', role: 'teacher' });
  token = res.body.token;
});

afterAll(() => pool.end());

const auth = () => ({ Authorization: `Bearer ${token}` });

const file = (answers, score) => query(
  `INSERT INTO attempts (student_id, kind, quiz_id, topic_id, score, max_score, answers)
   SELECT $1, 'quiz', $2, z.topic_id, $3, $4, $5 FROM quizzes z WHERE z.id = $2`,
  [studentId, quizId, score, questions.length, JSON.stringify(answers)],
);

describe('the questions a class finds hardest', () => {
  test('a question everyone skipped counts as wrong, not as missing', async () => {
    await file({}, 0);                              // walked away, answered nothing

    const rows = await Attempt.hardestQuestionsForClass(classId);
    expect(rows).toHaveLength(questions.length);
    for (const r of rows) {
      expect(r).toMatchObject({ seen: 1, correct: 0, percentCorrect: 0 });
    }
  });

  test('the figures agree with the score the student was given', async () => {
    // One right out of three: the attempt scores 33%, so exactly one question
    // must come back above 0%. A report that disagrees with the mark is worse
    // than no report at all.
    const first = questions[0];
    await file({ [first.id]: first.correct_answer }, 1);

    const byId = Object.fromEntries(
      (await Attempt.hardestQuestionsForClass(classId)).map((r) => [r.id, r]),
    );

    expect(byId[first.id]).toMatchObject({ seen: 2, correct: 1, percentCorrect: 50 });
    for (const q of questions.slice(1)) {
      expect(byId[q.id]).toMatchObject({ seen: 2, correct: 0, percentCorrect: 0 });
    }
  });

  test('the hardest question is listed first', async () => {
    const percents = (await Attempt.hardestQuestionsForClass(classId))
      .map((r) => r.percentCorrect);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
  });

  test('the class report carries them through to the teacher', async () => {
    const res = await request(app).get(`/api/analytics/classes/${classId}`).set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data.hardestQuestions).toHaveLength(questions.length);
    expect(res.body.data.hardestQuestions[0].percentCorrect).toBe(0);
  });
});

describe('drilling into one student', () => {
  test('the teacher sees every attempt, not an average that hides one', async () => {
    const res = await request(app).get(`/api/analytics/students/${studentId}`).set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data.history).toHaveLength(2);
    expect(res.body.data.history.map((h) => h.percent).sort()).toEqual([0, 33]);
    expect(res.body.data.history[0].topic).toBe('Loops');
  });

  test('a student in nobody else\'s class is refused', async () => {
    const other = await queryOne("SELECT id FROM users WHERE email = 'student1@school.com'");
    const res = await request(app).get(`/api/analytics/students/${other.id}`).set(auth());
    expect(res.status).toBe(403);
  });
});
