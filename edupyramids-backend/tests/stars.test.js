const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const { pool, query } = require('../src/config/database');
const { resetThrottle } = require('../src/services/authService');
const { token } = require('../src/games/common');
const { registry } = require('../src/games');
const { starsFor } = require('../src/games/stars');

/*
 * The layer every game shares: stars, and hints the server keeps count of.
 * Plus the two kinds built around it, Bug Catcher and Trace Runner.
 */

let student;
let studentId;
let bugcatch;
let trace;
let parsons;

const uuid = () => crypto.randomUUID();
const game = (kind, pick = () => true) => query('SELECT id, kind, title, content FROM games WHERE kind = $1 ORDER BY id', [kind])
  .then((rows) => rows.find(pick));

/** Bug Catcher answers: the chosen inputs, each with the right expectation unless told otherwise. */
function tests(g, i, ks, { wrongAt = [] } = {}) {
  const it = g.content.items[i];
  return ks.map((k) => {
    const options = registry.bugcatch.optionsFor(it, k);
    const right = options.indexOf(it.outputs[k]);
    const j = wrongAt.includes(k) ? (right + 1) % options.length : right;
    return { input: token(g.id, `c${i}n${k}`), expect: token(g.id, `c${i}n${k}o${j}`) };
  });
}

const perfectBugcatch = (g) => Object.fromEntries(g.content.items.map((it, i) => [
  token(g.id, `c${i}`), tests(g, i, registry.bugcatch.bestSet(it)),
]));

beforeAll(async () => {
  resetThrottle();
  const res = await request(app).post('/api/auth/login')
    .send({ email: 'student3@school.com', password: 'password123', role: 'student' });
  student = { Authorization: `Bearer ${res.body.token}` };
  studentId = res.body.user.id;
  bugcatch = await game('bugcatch');
  trace = await game('trace');
  parsons = await game('parsons', (g) => g.content.distractors.length > 0);
});

afterAll(async () => {
  await query('DELETE FROM game_hints WHERE student_id = $1', [studentId]);
  await query("DELETE FROM attempts WHERE student_id = $1 AND kind = 'game' AND game_id IN (SELECT id FROM games WHERE kind IN ('bugcatch', 'trace', 'parsons'))", [studentId]);
  await pool.end();
});

describe('stars', () => {
  test.each([
    [{ score: 5, maxScore: 10 }, 0],
    [{ score: 6, maxScore: 10 }, 1],
    [{ score: 10, maxScore: 10 }, 3],
    [{ score: 10, maxScore: 10, hintsUsed: 1 }, 2],
    [{ score: 10, maxScore: 10, parMet: false }, 2],
    [{ score: 0, maxScore: 0 }, 0],
  ])('%j gives %i', (input, stars) => {
    expect(starsFor(input)).toBe(stars);
  });

  test('a perfect game with no hints earns three stars, and the best shows on the list', async () => {
    const res = await request(app).post(`/api/games/${bugcatch.id}/results`).set(student)
      .send({ answers: perfectBugcatch(bugcatch), clientAttemptId: uuid() });
    expect(res.body.data).toMatchObject({ percent: 100, stars: 3, hintsUsed: 0, parMet: true });

    const list = await request(app).get('/api/games').set(student);
    expect(list.body.data.find((g) => g.id === bugcatch.id).bestStars).toBe(3);
  });
});

describe('hints', () => {
  test('a hint is recorded against the attempt and costs the third star', async () => {
    const attempt = uuid();
    const item = token(bugcatch.id, 'c0');
    const hint = await request(app).post(`/api/games/${bugcatch.id}/hint`).set(student)
      .send({ clientAttemptId: attempt, item, level: 1 });
    expect(hint.status).toBe(200);
    expect(hint.body.data).toMatchObject({ level: 1, maxLevel: 2 });
    expect(hint.body.data.text).toBeTruthy();

    // Asking again for the same hint is not a second hint.
    await request(app).post(`/api/games/${bugcatch.id}/hint`).set(student).send({ clientAttemptId: attempt, item, level: 1 });

    const res = await request(app).post(`/api/games/${bugcatch.id}/results`).set(student)
      .send({ answers: perfectBugcatch(bugcatch), clientAttemptId: attempt });
    expect(res.body.data).toMatchObject({ percent: 100, stars: 2, hintsUsed: 1 });
  });

  test('there is no hint past the last level, and kinds without hints say so', async () => {
    const body = { clientAttemptId: uuid(), item: token(bugcatch.id, 'c0'), level: 3 };
    expect((await request(app).post(`/api/games/${bugcatch.id}/hint`).set(student).send(body)).status).toBe(400);

    const matching = await game('matching');
    const none = await request(app).post(`/api/games/${matching.id}/hint`).set(student)
      .send({ clientAttemptId: uuid(), item: 'x', level: 1 });
    expect(none.status).toBe(400);
    expect(none.body.error).toMatch(/no hints/);
  });

  test('parsons hints make the puzzle easier: first a distractor goes, then the first line is placed', async () => {
    const clientAttemptId = uuid();
    const one = await request(app).post(`/api/games/${parsons.id}/hint`).set(student)
      .send({ clientAttemptId, item: 'program', level: 1 });
    expect(one.body.data.remove).toBe(token(parsons.id, 'x0'));
    const two = await request(app).post(`/api/games/${parsons.id}/hint`).set(student)
      .send({ clientAttemptId, item: 'program', level: 2 });
    expect(two.body.data.first).toEqual({ id: token(parsons.id, 'p0'), indent: 0 });
  });
});

describe('Bug Catcher', () => {
  test('a test only catches a bug when the expected output is right', () => {
    const it = bugcatch.content.items[0];
    const k = registry.bugcatch.bestSet(it)[0];
    const answers = { [token(bugcatch.id, 'c0')]: tests(bugcatch, 0, [k], { wrongAt: [k] }) };
    const { feedback, extra } = registry.bugcatch.mark(bugcatch, answers);
    expect(feedback.slice(0, it.mutants.length).every((f) => !f.correct)).toBe(true);
    expect(extra.tests[0]).toMatchObject({ ok: false, right: it.outputs[k] });
  });

  test('catching everything with more tests than par scores full marks but misses the third star', () => {
    // The Gold functions need more than one test, so there is room to spare.
    const it = bugcatch.content.items.find((x) => registry.bugcatch.parOf(x) < x.inputs.length);
    const i = bugcatch.content.items.indexOf(it);
    const best = registry.bugcatch.bestSet(it);
    const extraInput = it.inputs.map((_, k) => k).find((k) => !best.includes(k));
    const answers = { ...perfectBugcatch(bugcatch), [token(bugcatch.id, `c${i}`)]: tests(bugcatch, i, [...best, extraInput]) };
    const marked = registry.bugcatch.mark(bugcatch, answers);
    expect(marked.score).toBe(marked.maxScore);
    expect(marked.extra.parMet).toBe(false);
  });

  test('tests past the slot limit are ignored', () => {
    const it = bugcatch.content.items[0];
    const slots = Math.min(it.inputs.length, registry.bugcatch.parOf(it) + 1);
    const all = tests(bugcatch, 0, it.inputs.map((_, k) => k));
    const { extra } = registry.bugcatch.mark(bugcatch, { [token(bugcatch.id, 'c0')]: all });
    expect(extra.tests).toHaveLength(slots);
  });

  test('every bugged copy in the content can be caught', () => {
    for (const it of bugcatch.content.items) {
      expect(registry.bugcatch.bestSet(it).length).toBeLessThanOrEqual(it.inputs.length);
    }
  });
});

describe('Trace Runner', () => {
  test('each step is checked at once, forgiving spacing and quote style', async () => {
    const withString = (await query("SELECT id, content FROM games WHERE kind = 'trace'")).find((g) => g.content.items
      .some((it) => it.steps.some((s) => s.value.startsWith("'"))));
    const i = withString.content.items.findIndex((it) => it.steps.some((s) => s.value.length > 2 && s.value.startsWith("'")));
    const k = withString.content.items[i].steps.findIndex((s) => s.value.length > 2 && s.value.startsWith("'"));
    const { value } = withString.content.items[i].steps[k];
    const step = token(withString.id, `t${i}s${k}`);

    const right = await request(app).post(`/api/games/${withString.id}/check`).set(student)
      .send({ step, value: ` ${value.replace(/'/g, '"')} `, clientAttemptId: uuid() });
    expect(right.body.data).toEqual({ correct: true, value });

    const wrong = await request(app).post(`/api/games/${withString.id}/check`).set(student).send({ step, value: 'nope', clientAttemptId: uuid() });
    expect(wrong.body.data).toEqual({ correct: false, value });
  });

  test('a step is marked on the value checked first, not one sent after the answer was shown', async () => {
    const clientAttemptId = uuid();
    const answers = {};
    trace.content.items.forEach((it, i) => it.steps.forEach((s, k) => { answers[token(trace.id, `t${i}s${k}`)] = s.value; }));
    const first = token(trace.id, 't0s0');
    await request(app).post(`/api/games/${trace.id}/check`).set(student).send({ step: first, value: 'wrong', clientAttemptId });
    const res = await request(app).post(`/api/games/${trace.id}/results`).set(student).send({ answers, clientAttemptId });
    expect(res.body.data.score).toBe(res.body.data.maxScore - 1);
  });

  test('lists match whatever the spacing', () => {
    expect(registry.trace.normaliseValue('[3,8, 2]')).toBe(registry.trace.normaliseValue('[3, 8, 2]'));
  });

  test('the best streak is the longest run of right steps', () => {
    const answers = {};
    trace.content.items.forEach((it, i) => it.steps.forEach((s, k) => { answers[token(trace.id, `t${i}s${k}`)] = s.value; }));
    answers[token(trace.id, 't0s2')] = 'wrong';
    const total = trace.content.items.reduce((n, it) => n + it.steps.length, 0);
    const { score, extra } = registry.trace.mark(trace, answers);
    expect(score).toBe(total - 1);
    expect(extra.bestStreak).toBe(total - 3);
  });

  test('the hint gives the values just before the line runs', async () => {
    const it = trace.content.items[0];
    const k = it.steps.findIndex((s, n) => n > 0);
    const res = await request(app).post(`/api/games/${trace.id}/hint`).set(student)
      .send({ clientAttemptId: uuid(), item: token(trace.id, `t0s${k}`), level: 1 });
    expect(res.body.data.text).toContain(`${it.steps[0].var} = ${it.steps[0].value}`);
  });
});
