const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const { pool, query, queryOne } = require('../src/config/database');
const { resetThrottle } = require('../src/services/authService');
const { validate } = require('../scripts/import-questions');

let token;
let quiz;
let questions;

beforeAll(async () => {
  resetThrottle();
  const res = await request(app).post('/api/auth/login')
    .send({ email: 'student1@school.com', password: 'password123', role: 'student' });
  token = res.body.token;

  const list = await request(app).get('/api/quizzes').set('Authorization', `Bearer ${token}`);
  quiz = list.body.data.find((q) => q.topic === 'Loops');

  const detail = await request(app).get(`/api/quizzes/${quiz.id}`)
    .set('Authorization', `Bearer ${token}`);
  questions = detail.body.questions || detail.body.data.questions;
});

afterAll(() => pool.end());

const auth = () => ({ Authorization: `Bearer ${token}` });

describe('delivering a quiz', () => {
  test('the loaded content is listed', async () => {
    const res = await request(app).get('/api/quizzes').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.map((q) => q.topic)).toEqual(
      expect.arrayContaining(['Variables', 'Loops', 'Lists']),
    );
  });

  test('the answer key never reaches the student', async () => {
    const res = await request(app).get(`/api/quizzes/${quiz.id}`).set(auth());
    const body = JSON.stringify(res.body);

    expect(res.status).toBe(200);
    expect(body).not.toMatch(/correct_answer|correctAnswer/);
    // The explanations give the answer away too, so they are held back until
    // the attempt is marked.
    expect(body).not.toMatch(/stops one before/);
  });

  test('a quiz that does not exist is a 404, not a crash', async () => {
    expect((await request(app).get('/api/quizzes/99999').set(auth())).status).toBe(404);
  });

  test('a quiz id that is not a number is rejected', async () => {
    expect((await request(app).get('/api/quizzes/abc').set(auth())).status).toBe(400);
  });
});

describe('marking an attempt', () => {
  const answersFor = (correctCount) => {
    // Deliberately answer the first `correctCount` questions correctly, using
    // the keys the seed content actually uses.
    const key = { 'What does range(1, 5) produce?': 'a' };
    const out = {};
    questions.slice(0, correctCount).forEach((q, i) => {
      out[q.id] = ['a', 'b', 'c'][i];
    });
    return { out, key };
  };

  test('A5  the score matches the answers given', async () => {
    // Loop basics: correct answers are a, b, c in order.
    const answers = { [questions[0].id]: 'a', [questions[1].id]: 'b', [questions[2].id]: 'c' };
    const res = await request(app)
      .post(`/api/quizzes/${quiz.id}/attempts`)
      .set(auth())
      .send({ answers, clientAttemptId: crypto.randomUUID() });

    expect(res.status).toBe(201);
    expect(res.body.data.score).toBe(3);
    expect(res.body.data.maxScore).toBe(3);
    expect(res.body.data.percent).toBe(100);
  });

  test('A5  a question left blank counts as wrong and never as null', async () => {
    const answers = { [questions[0].id]: 'a' };            // two left blank
    const res = await request(app)
      .post(`/api/quizzes/${quiz.id}/attempts`)
      .set(auth())
      .send({ answers, clientAttemptId: crypto.randomUUID() });

    expect(res.status).toBe(201);
    expect(res.body.data.score).toBe(1);
    expect(res.body.data.maxScore).toBe(3);
    expect(res.body.data.unanswered).toBe(2);
    expect(res.body.data.feedback).toHaveLength(3);
    expect(res.body.data.feedback.every((f) => typeof f.correct === 'boolean')).toBe(true);

    const stored = await queryOne(
      'SELECT score, max_score FROM attempts WHERE id = $1', [res.body.data.attemptId],
    );
    expect(stored.score).toBe(1);
    expect(stored.max_score).toBe(3);
  });

  test('A7  every wrong answer comes back with the right answer, the reason and the topic', async () => {
    const res = await request(app)
      .post(`/api/quizzes/${quiz.id}/attempts`)
      .set(auth())
      .send({ answers: {}, clientAttemptId: crypto.randomUUID() });

    const wrong = res.body.data.feedback.filter((f) => !f.correct);
    expect(wrong).toHaveLength(3);
    for (const f of wrong) {
      expect(f.correctAnswer).toMatch(/^[abcd]$/);
      expect(typeof f.explanation).toBe('string');
      expect(f.explanation.length).toBeGreaterThan(0);
      expect(f.topic).toBe('Loops');
    }
  });

  test('A6  submitting the same attempt twice records one attempt', async () => {
    const clientAttemptId = crypto.randomUUID();
    const body = { answers: { [questions[0].id]: 'a' }, clientAttemptId };

    const first = await request(app).post(`/api/quizzes/${quiz.id}/attempts`).set(auth()).send(body);
    const second = await request(app).post(`/api/quizzes/${quiz.id}/attempts`).set(auth()).send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.duplicate).toBe(true);
    expect(second.body.data.attemptId).toBe(first.body.data.attemptId);

    const rows = await query(
      'SELECT id FROM attempts WHERE client_attempt_id = $1', [clientAttemptId],
    );
    expect(rows).toHaveLength(1);
  });

  test('the attempt is filed against the signed-in student, whatever the body says', async () => {
    const res = await request(app)
      .post(`/api/quizzes/${quiz.id}/attempts`)
      .set(auth())
      .send({ answers: {}, studentId: 9999, clientAttemptId: crypto.randomUUID() });

    const me = (await queryOne("SELECT id FROM users WHERE email = 'student1@school.com'")).id;
    const stored = await queryOne(
      'SELECT student_id FROM attempts WHERE id = $1', [res.body.data.attemptId],
    );
    expect(stored.student_id).toBe(me);
  });

  test('C9  a topic that went badly is suggested for another look', async () => {
    const res = await request(app)
      .post(`/api/quizzes/${quiz.id}/attempts`)
      .set(auth())
      .send({ answers: {}, clientAttemptId: crypto.randomUUID() });

    expect(res.body.data.revisit).toContain('Loops');
  });

  test('a malformed body is rejected rather than marked', async () => {
    const res = await request(app)
      .post(`/api/quizzes/${quiz.id}/attempts`)
      .set(auth())
      .send({ answers: ['a', 'b'] });
    expect(res.status).toBe(400);
  });

  test('an unsigned-in caller cannot file an attempt', async () => {
    const res = await request(app).post(`/api/quizzes/${quiz.id}/attempts`).send({ answers: {} });
    expect(res.status).toBe(401);
  });
});

describe('A4  loading a question file', () => {
  const good = [{
    topic: 'Temp', level: 1,
    quizzes: [{
      title: 'T', difficulty: 1,
      questions: [{ text: 'q', options: { a: '1', b: '2' }, correct: 'a', explanation: 'why' }],
    }],
  }];

  test('a good file passes', () => {
    expect(validate(good).errors).toEqual([]);
  });

  test('a correct answer with no matching option is caught and located', () => {
    const bad = JSON.parse(JSON.stringify(good));
    bad[0].quizzes[0].questions[0].correct = 'd';

    const { errors } = validate(bad);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('topics[0].quizzes[0].questions[0]');
    expect(errors[0]).toContain('no matching option');
  });

  test('a question with fewer than two options is caught', () => {
    const bad = JSON.parse(JSON.stringify(good));
    delete bad[0].quizzes[0].questions[0].options.b;
    expect(validate(bad).errors.join()).toContain('at least options');
  });

  test('a missing topic name is caught', () => {
    expect(validate([{ quizzes: [] }]).errors.join()).toContain('"topic" is required');
  });

  test('a missing explanation is a warning, not an error', () => {
    const noExplanation = JSON.parse(JSON.stringify(good));
    delete noExplanation[0].quizzes[0].questions[0].explanation;

    const { errors, warnings } = validate(noExplanation);
    expect(errors).toEqual([]);
    expect(warnings.join()).toContain('no explanation');
  });

  test('something that is not a list is rejected outright', () => {
    expect(validate({ topic: 'x' }).errors.join()).toContain('must contain a list');
  });
});

describe('telling the student straight away', () => {
  test('a right answer comes back right, a wrong one wrong', async () => {
    const q = questions[0];
    const right = await request(app).post(`/api/quizzes/${quiz.id}/check`)
      .set(auth()).send({ questionId: q.id, answer: 'a', clientAttemptId: crypto.randomUUID() });

    expect(right.status).toBe(200);
    const key = right.body.data.correctAnswer;
    expect(right.body.data.correct).toBe(key === 'a');

    const other = ['a', 'b', 'c', 'd'].find((l) => l !== key);
    const wrong = await request(app).post(`/api/quizzes/${quiz.id}/check`)
      .set(auth()).send({ questionId: q.id, answer: other, clientAttemptId: crypto.randomUUID() });
    expect(wrong.body.data.correct).toBe(false);
  });

  test('checking does not record an attempt', async () => {
    const before = await query('SELECT count(*)::int n FROM attempts');
    await request(app).post(`/api/quizzes/${quiz.id}/check`)
      .set(auth()).send({ questionId: questions[0].id, answer: 'a', clientAttemptId: crypto.randomUUID() });
    const after = await query('SELECT count(*)::int n FROM attempts');
    expect(after[0].n).toBe(before[0].n);
  });

  test('a question from another quiz is refused', async () => {
    const res = await request(app).post('/api/quizzes/99999/check')
      .set(auth()).send({ questionId: questions[0].id, answer: 'a', clientAttemptId: crypto.randomUUID() });
    expect(res.status).toBe(404);
  });

  test('a check must name the attempt it belongs to', async () => {
    const res = await request(app).post(`/api/quizzes/${quiz.id}/check`)
      .set(auth()).send({ questionId: questions[0].id, answer: 'a' });
    expect(res.status).toBe(400);
  });

  test('the letter checked first is the one marked, even if a right one is sent after', async () => {
    const clientAttemptId = crypto.randomUUID();
    const q = questions[0];
    const key = (await queryOne('SELECT correct_answer FROM questions WHERE id = $1', [q.id])).correct_answer;
    const wrong = ['a', 'b', 'c', 'd'].find((l) => l !== key);
    await request(app).post(`/api/quizzes/${quiz.id}/check`).set(auth())
      .send({ questionId: q.id, answer: wrong, clientAttemptId });
    // The check has shown the right answer; now send it.
    const res = await request(app).post(`/api/quizzes/${quiz.id}/attempts`).set(auth())
      .send({ answers: { [q.id]: key }, clientAttemptId });
    expect(res.body.data.feedback.find((f) => f.questionId === q.id)).toMatchObject({ given: wrong, correct: false });
  });

  test('an unsigned-in caller cannot peek at the answer', async () => {
    const res = await request(app).post(`/api/quizzes/${quiz.id}/check`)
      .send({ questionId: questions[0].id, answer: 'a', clientAttemptId: crypto.randomUUID() });
    expect(res.status).toBe(401);
  });
});
