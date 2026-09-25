const request = require('supertest');
const app = require('../src/app');
const { pool, query, queryOne } = require('../src/config/database');
const { resetThrottle } = require('../src/services/authService');
const { shuffleQuestion, shuffleFile } = require('../scripts/shuffle-options');
const { validate, load } = require('../scripts/import-questions');

/*
 * The client's export listed every right answer first. The shuffle fixes the
 * file; the importer brings a database that already holds the questions into
 * line, re-lettering answers already given so past results keep their meaning.
 */

afterAll(() => pool.end());

const client = require('../content/python-mcqs.json');

test('the client file no longer puts every right answer under one letter', () => {
  const keys = client.flatMap((t) => t.quizzes.flatMap((z) => z.questions.map((q) => q.correct)));
  const share = Math.max(...['a', 'b', 'c', 'd', 'e'].map((l) => keys.filter((k) => k === l).length)) / keys.length;
  expect(share).toBeLessThan(0.4);
  expect(validate(client).warnings.join(' ')).not.toMatch(/Every answer is/);
});

test('shuffling keeps the right answer right, and running it again changes nothing', () => {
  const q = {
    text: 'Which can "in" search?',
    options: {
      a: 'All of the above', b: 'list', c: 'set', d: 'dictionary', e: 'None of the above',
    },
    correct: 'a',
  };
  const once = shuffleQuestion(q);
  expect(once.options[once.correct]).toBe('All of the above');
  // Options about the others stay at the end.
  expect([once.options.d, once.options.e]).toEqual(['All of the above', 'None of the above']);
  expect(shuffleQuestion(once)).toEqual(once);
  expect(shuffleFile(client)).toEqual(client);
});

test('an option listed twice is kept once, so no copy of the right answer is marked wrong', () => {
  const q = { text: 'What prints?', options: { a: '5', b: '6', c: '5', d: '6', e: '5.5' }, correct: 'a' };
  const out = shuffleQuestion(q);
  expect(Object.values(out.options).sort()).toEqual(['5', '5.5', '6']);
  expect(out.options[out.correct]).toBe('5');
  expect(validate([{ topic: 'T', quizzes: [{ title: 'Q', questions: [q] }] }]).warnings.join(' ')).toMatch(/two options are the same/);
});

test('the importer warns about a file whose answers are all one letter', () => {
  const allA = [{
    topic: 'T',
    quizzes: [{
      title: 'Q',
      questions: Array.from({ length: 5 }, (_, i) => ({ text: `q${i}`, options: { a: 'x', b: 'y' }, correct: 'a' })),
    }],
  }];
  expect(validate(allA).warnings[0]).toMatch(/Every answer is "a"/);
});

test('re-importing re-orders questions already loaded and re-letters answers already given', async () => {
  const sample = JSON.parse(JSON.stringify(require('../content/sample-questions.json')));
  const quizTitle = sample[0].quizzes[0].title;
  const q0 = sample[0].quizzes[0].questions[0];
  const row = await queryOne(
    `SELECT qs.id, qs.quiz_id AS "quizId", qs.correct_answer AS correct, qs.option_a AS a, qs.option_b AS b
       FROM questions qs JOIN quizzes z ON z.id = qs.quiz_id
      WHERE z.title = $1 AND qs.text = $2`,
    [quizTitle, q0.text.trim()],
  );

  // A student answered with the old letters, right and wrong.
  resetThrottle();
  const login = await request(app).post('/api/auth/login')
    .send({ email: 'student1@school.com', password: 'password123', role: 'student' });
  const auth = { Authorization: `Bearer ${login.body.token}` };
  const wrong = row.correct === 'a' ? 'b' : 'a';
  const right = await request(app).post(`/api/quizzes/${row.quizId}/attempts`).set(auth)
    .send({ answers: { [row.id]: row.correct } });
  const missed = await request(app).post(`/api/quizzes/${row.quizId}/attempts`).set(auth)
    .send({ answers: { [row.id]: wrong } });

  // Swap options a and b in the file, moving the answer with them.
  const swap = { a: 'b', b: 'a' };
  q0.options = { ...q0.options, a: q0.options.b, b: q0.options.a };
  q0.correct = swap[q0.correct] ?? q0.correct;
  const counts = await load(sample, { replace: false });
  expect(counts.reordered).toBe(1);

  const after = await queryOne('SELECT option_a AS a, option_b AS b, correct_answer AS correct FROM questions WHERE id = $1', [row.id]);
  expect(after).toEqual({ a: row.b, b: row.a, correct: q0.correct });
  const stored = async (attemptId) => (await queryOne('SELECT answers FROM attempts WHERE id = $1', [attemptId])).answers[row.id];
  expect(await stored(right.body.data.attemptId)).toBe(q0.correct);
  expect(await stored(missed.body.data.attemptId)).toBe(swap[wrong] ?? wrong);

  // Nothing more to do the second time; then put it back for the other suites.
  expect((await load(sample, { replace: false })).reordered).toBe(0);
  await load(require('../content/sample-questions.json'), { replace: false });
  await query('DELETE FROM attempts WHERE id = ANY($1)', [[right.body.data.attemptId, missed.body.data.attemptId]]);
});
