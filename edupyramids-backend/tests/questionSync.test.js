const { pool, query, queryOne } = require('../src/config/database');
const { validate, load } = require('../scripts/import-questions');

/*
 * Correcting questions students have already answered. The client's file was
 * Python 2 with its code squashed onto one line; the corrected file rewords
 * questions and options and moves them, and a database that holds the old
 * ones has to take the new wording without losing what was answered.
 */

const TOPIC = 'Question sync test topic';

const file = (questions) => [{ topic: TOPIC, level: 9, quizzes: [{ title: 'Sync quiz', questions }] }];
const clone = (x) => JSON.parse(JSON.stringify(x));

const OLD = {
  text: 'What gets printed? print type(1/2)',
  options: { a: "<type 'int'>", b: "<type 'float'>", c: "<type 'str'>" },
  correct: 'a',
};
const NEW = {
  text: 'What does this print?\n```\nprint(type(1/2))\n```',
  options: { a: "`<class 'str'>`", b: "`<class 'int'>`", c: "`<class 'float'>`" },
  correct: 'c',
  explanation: 'In Python 3, `/` always gives a float.',
  // int was a, now b; float was b, now c; str was c, now a.
  formerly: { text: OLD.text, letters: { a: 'b', b: 'c', c: 'a' } },
};

let studentId;
beforeAll(async () => {
  studentId = (await queryOne(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ('Sync Student', 'sync.student@test.example', 'x', 'student') RETURNING id`,
  )).id;
});
afterAll(async () => {
  await query('DELETE FROM attempts WHERE student_id = $1', [studentId]);
  await query('DELETE FROM users WHERE id = $1', [studentId]);
  const topic = 'SELECT id FROM topics WHERE name = $1';
  await query(`DELETE FROM questions WHERE quiz_id IN (SELECT id FROM quizzes WHERE topic_id IN (${topic}))`, [TOPIC]);
  await query(`DELETE FROM quizzes WHERE topic_id IN (${topic})`, [TOPIC]);
  await query('DELETE FROM topics WHERE name = $1', [TOPIC]);
  await pool.end();
});

async function answered(quizId, questionId, letter) {
  return (await queryOne(
    `INSERT INTO attempts (student_id, kind, quiz_id, topic_id, score, max_score, answers)
     SELECT $1, 'quiz', id, topic_id, 0, 1, $3 FROM quizzes WHERE id = $2 RETURNING id`,
    [studentId, quizId, { [questionId]: letter }],
  )).id;
}

test('"formerly" is checked like everything else in the file', () => {
  const bad = (formerly) => validate(file([{ ...clone(NEW), formerly }])).errors.join(' ');
  expect(bad({ text: OLD.text, letters: { a: 'b', b: 'c', c: 'a' } })).toBe('');
  expect(bad('old text')).toMatch(/"formerly" must be/);
  expect(bad({ letters: { a: 'e' } })).toMatch(/different option this question has/);
  expect(bad({ letters: { a: 'b', b: 'b' } })).toMatch(/different option/);
});

test('a reworded question keeps its id, and answers given to the old wording keep their meaning', async () => {
  await load(file([clone(OLD)]), { replace: false });
  const row = await queryOne(
    'SELECT q.id, q.quiz_id AS "quizId" FROM questions q JOIN quizzes z ON z.id = q.quiz_id JOIN topics t ON t.id = z.topic_id WHERE t.name = $1',
    [TOPIC],
  );
  const pickedInt = await answered(row.quizId, row.id, 'a');
  const pickedFloat = await answered(row.quizId, row.id, 'b');

  const counts = await load(file([clone(NEW)]), { replace: false });
  expect(counts.revised).toBe(1);

  const after = await queryOne(
    `SELECT text, option_a AS a, option_b AS b, option_c AS c, correct_answer AS correct, explanation
       FROM questions WHERE id = $1`, [row.id],
  );
  expect(after).toEqual({
    text: NEW.text, ...NEW.options, correct: 'c', explanation: NEW.explanation,
  });
  const given = async (id) => (await queryOne('SELECT answers FROM attempts WHERE id = $1', [id])).answers[row.id];
  expect(await given(pickedInt)).toBe('b');     // still points at int
  expect(await given(pickedFloat)).toBe('c');   // still points at float

  // Loading the same file again changes nothing, and moves no answer twice.
  expect((await load(file([clone(NEW)]), { replace: false })).revised).toBe(0);
  expect(await given(pickedInt)).toBe('b');

  // A later fix to the explanation alone leaves the letters where they are.
  const later = { ...clone(NEW), explanation: 'Division with / gives a float in Python 3.' };
  expect((await load(file([later]), { replace: false })).revised).toBe(1);
  expect(await given(pickedInt)).toBe('b');
});

test('a duplicate the file has dropped is removed, and its mastery evidence moves to the copy kept', async () => {
  const twin = { text: 'What is the value of 7*1**7?', options: { a: '7', b: '49' }, correct: 'a' };
  const topic = [{ topic: TOPIC, level: 9, quizzes: [{ title: 'Twins', questions: [clone(twin), clone(twin)] }] }];
  await load(topic, { replace: false });
  const [keep, extra] = (await query(
    `SELECT q.id FROM questions q JOIN quizzes z ON z.id = q.quiz_id
      WHERE z.title = 'Twins' ORDER BY q.id`,
  ));
  const concept = await queryOne("SELECT id FROM concepts WHERE slug = 'numbers'");
  await query(
    `INSERT INTO responses (student_id, question_id, concept_id, source, correct, p_before, p_after)
     VALUES ($1, $2, $3, 'quiz', true, 0.2, 0.4)`,
    [studentId, extra.id, concept.id],
  );

  topic[0].quizzes[0].questions = [clone(twin)];
  expect((await load(topic, { replace: false })).merged).toBe(1);
  const left = await query("SELECT q.id FROM questions q JOIN quizzes z ON z.id = q.quiz_id WHERE z.title = 'Twins'");
  expect(left.map((r) => r.id)).toEqual([keep.id]);
  expect((await queryOne('SELECT question_id FROM responses WHERE student_id = $1', [studentId])).question_id).toBe(keep.id);
});

test('a question the file does not repeat is never removed by an import', async () => {
  const one = { text: 'Only in the database', options: { a: 'x', b: 'y' }, correct: 'a' };
  const other = { text: 'Only in the file', options: { a: 'x', b: 'y' }, correct: 'b' };
  const topic = [{ topic: TOPIC, level: 9, quizzes: [{ title: 'Kept', questions: [one] }] }];
  await load(topic, { replace: false });
  topic[0].quizzes[0].questions = [other];
  expect((await load(topic, { replace: false })).merged).toBe(0);
  expect(await queryOne("SELECT id FROM questions WHERE text = 'Only in the database'")).toBeTruthy();
});
