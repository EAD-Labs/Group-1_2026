const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const { pool, queryOne } = require('../src/config/database');
const { resetThrottle } = require('../src/services/authService');
const { token } = require('../src/services/gameService');
const { validate } = require('../scripts/import-games');

let auth;
let games;

const byKind = (kind) => games.find((g) => g.kind === kind);
const content = async (id) => (await queryOne('SELECT content FROM games WHERE id = $1', [id])).content;

beforeAll(async () => {
  resetThrottle();
  const res = await request(app).post('/api/auth/login')
    .send({ email: 'student2@school.com', password: 'password123', role: 'student' });
  auth = { Authorization: `Bearer ${res.body.token}` };
  games = (await request(app).get('/api/games').set(auth)).body.data;
});

afterAll(() => pool.end());

describe('delivering a game', () => {
  test('all three kinds are listed', async () => {
    expect(games.map((g) => g.kind)).toEqual(
      expect.arrayContaining(['matching', 'drag_drop', 'memory']),
    );
  });

  test('the answer key and explanations never reach the student', async () => {
    for (const kind of ['matching', 'drag_drop', 'memory']) {
      const res = await request(app).get(`/api/games/${byKind(kind).id}`).set(auth);
      const body = JSON.stringify(res.body);
      expect(res.status).toBe(200);
      expect(body).not.toMatch(/explanation|"bucket"|"right"|"answer"/);
    }
  });

  test('piece ids do not reveal which pieces belong together', async () => {
    const res = await request(app).get(`/api/games/${byKind('matching').id}`).set(auth);
    const leftIds = res.body.data.lefts.map((l) => l.id);
    const rightIds = res.body.data.rights.map((r) => r.id);
    expect(leftIds.every((id) => !/^\d+$/.test(id))).toBe(true);
    expect(rightIds.some((id) => leftIds.includes(id))).toBe(false);
  });

  test('a game that does not exist is a 404', async () => {
    expect((await request(app).get('/api/games/99999').set(auth)).status).toBe(404);
  });
});

describe('marking a game', () => {
  test('matching: every pair right scores full marks and is stored', async () => {
    const game = byKind('matching');
    const { pairs } = await content(game.id);
    const answers = Object.fromEntries(
      pairs.map((_, i) => [token(game.id, `l${i}`), token(game.id, `r${i}`)]),
    );

    const res = await request(app).post(`/api/games/${game.id}/results`).set(auth).send({ answers });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ score: pairs.length, maxScore: pairs.length, percent: 100 });

    const row = await queryOne('SELECT kind, game_id FROM attempts WHERE id = $1', [res.body.data.attemptId]);
    expect(row).toEqual({ kind: 'game', game_id: game.id });
  });

  test('matching: a swapped pair costs both, and says what the answer was', async () => {
    const game = byKind('matching');
    const { pairs } = await content(game.id);
    const answers = Object.fromEntries(
      pairs.map((_, i) => [token(game.id, `l${i}`), token(game.id, `r${i}`)]),
    );
    answers[token(game.id, 'l0')] = token(game.id, 'r1');
    answers[token(game.id, 'l1')] = token(game.id, 'r0');

    const { data } = (await request(app).post(`/api/games/${game.id}/results`).set(auth).send({ answers })).body;
    expect(data.score).toBe(pairs.length - 2);
    expect(data.feedback[0]).toMatchObject({ correct: false, given: pairs[1].right, answer: pairs[0].right });
    expect(data.revisit).toEqual([game.topic]);
  });

  test('drag and drop: an unplaced item counts as wrong, not missing', async () => {
    const game = byKind('drag_drop');
    const { items } = await content(game.id);
    const answers = Object.fromEntries(
      items.slice(1).map((it, i) => [token(game.id, `i${i + 1}`), it.bucket]),
    );

    const { data } = (await request(app).post(`/api/games/${game.id}/results`).set(auth).send({ answers })).body;
    expect(data).toMatchObject({ score: items.length - 1, maxScore: items.length });
    expect(data.feedback[0]).toMatchObject({ given: null, correct: false });
  });

  test('memory: a clean run scores full marks, and misses beyond the grace cost points', async () => {
    const game = byKind('memory');
    const { pairs } = await content(game.id);
    const found = pairs.map((_, i) => [token(game.id, `a${i}`), token(game.id, `b${i}`)]);

    const clean = (await request(app).post(`/api/games/${game.id}/results`).set(auth)
      .send({ answers: { moves: found } })).body.data;
    expect(clean.score).toBe(pairs.length);

    // Two free misses per pair, then a point for every two more.
    const miss = [token(game.id, 'a0'), token(game.id, 'b1')];
    const moves = [...Array(2 * pairs.length + 4).fill(miss), ...found];
    const sloppy = (await request(app).post(`/api/games/${game.id}/results`).set(auth)
      .send({ answers: { moves } })).body.data;
    expect(sloppy).toMatchObject({ score: pairs.length - 2, misses: 2 * pairs.length + 4 });
  });

  test('memory: the check endpoint says whether two tiles match', async () => {
    const game = byKind('memory');
    const hit = await request(app).post(`/api/games/${game.id}/check`).set(auth)
      .send({ first: token(game.id, 'a0'), second: token(game.id, 'b0') });
    expect(hit.body.data.match).toBe(true);
    expect(hit.body.data.explanation).toBeTruthy();

    const miss = await request(app).post(`/api/games/${game.id}/check`).set(auth)
      .send({ first: token(game.id, 'a0'), second: token(game.id, 'b1') });
    expect(miss.body.data).toEqual({ match: false, explanation: null });
  });

  test('submitting twice records one attempt', async () => {
    const game = byKind('drag_drop');
    const clientAttemptId = crypto.randomUUID();
    const send = () => request(app).post(`/api/games/${game.id}/results`).set(auth)
      .send({ answers: {}, clientAttemptId });

    const first = await send();
    const second = await send();
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.attemptId).toBe(first.body.data.attemptId);
  });

  test('the list shows the best score once a game is played', async () => {
    const list = (await request(app).get('/api/games').set(auth)).body.data;
    expect(list.find((g) => g.kind === 'matching')).toMatchObject({ bestPercent: 100 });
  });
});

describe('importing games', () => {
  test('a bucket that does not exist is refused with its path', () => {
    const { errors } = validate([{
      topic: 'Loops',
      games: [{ title: 'Sort', kind: 'drag_drop', buckets: ['A', 'B'], items: [{ text: 'x', bucket: 'A' }, { text: 'y', bucket: 'C' }] }],
    }]);
    expect(errors).toEqual([expect.stringContaining('topics[0].games[0].items[1]: bucket "C"')]);
  });

  test('two memory tiles with the same text are refused', () => {
    const { errors } = validate([{
      topic: 'Loops',
      games: [{ title: 'Pairs', kind: 'memory', pairs: [{ a: '1 + 1', b: '2' }, { a: '4 // 2', b: '2' }] }],
    }]);
    expect(errors).toEqual([expect.stringContaining('"2" appears twice')]);
  });

  test('the shipped game file is valid', () => {
    const { errors } = validate(require('../content/python-games.json'));
    expect(errors).toEqual([]);
  });
});
