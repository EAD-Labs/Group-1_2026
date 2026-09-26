const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../src/app');
const { pool, query, queryOne } = require('../src/config/database');
const { resetThrottle } = require('../src/services/authService');
const { token } = require('../src/games/common');

/*
 * Badges and levels, against the HLD's own tests (Section 14, Part 3):
 *   C1  a badge earned, more work, three reloads: the badge is there once
 *   C2  a student on a higher level scores 20%: the level stays
 *   C3  eight activities all under 50%: no badge
 * and the rule itself (Section 6.3): 80% or more across three activities on
 * a topic, never for logging in or for streaks.
 */

let topic;           // a topic with at least three games
let games;
const made = [];     // user ids, removed afterwards

async function newStudent(tag) {
  const hash = await bcrypt.hash('password123', 4);
  const id = (await queryOne(
    `INSERT INTO users (email, password_hash, name, role, school_id)
     VALUES ($1, $2, $3, 'student', 'school_001') RETURNING id`,
    [`badge-${tag}@school.com`, hash, `Badge ${tag}`],
  )).id;
  made.push(id);
  resetThrottle();
  const res = await request(app).post('/api/auth/login')
    .send({ email: `badge-${tag}@school.com`, password: 'password123', role: 'student' });
  return { id, auth: { Authorization: `Bearer ${res.body.token}` } };
}

/** Answers for a game with the first `right` of its items right. */
function answers(g, right) {
  const c = g.content;
  const t = (piece) => token(g.id, piece);
  if (g.kind === 'matching') return Object.fromEntries(c.pairs.map((_, i) => [t(`l${i}`), i < right ? t(`r${i}`) : t(`r${(i + 1) % c.pairs.length}`)]));
  if (g.kind === 'drag_drop') return Object.fromEntries(c.items.map((it, i) => [t(`i${i}`), i < right ? it.bucket : c.buckets.find((b) => b !== it.bucket)]));
  if (g.kind === 'predict') return Object.fromEntries(c.items.map((it, i) => [t(`o${i}`), i < right ? it.output : 'no']));
  if (g.kind === 'fillblank') return Object.fromEntries(c.items.map((it, i) => [t(`f${i}`), i < right ? it.blanks : it.blanks.map(() => it.decoys[0])]));
  throw new Error(g.kind);
}
const size = (g) => (g.content.pairs || g.content.items).length;
const play = (who, g, right) => request(app).post(`/api/games/${g.id}/results`).set(who.auth).send({ answers: answers(g, right) });

beforeAll(async () => {
  const rows = await query(
    `SELECT g.id, g.kind, g.content, g.topic_id AS "topicId" FROM games g
      WHERE g.kind IN ('matching', 'drag_drop', 'predict', 'fillblank') ORDER BY g.topic_id, g.id`,
  );
  topic = rows.map((r) => r.topicId).find((id) => rows.filter((r) => r.topicId === id).length >= 3);
  games = rows.filter((r) => r.topicId === topic).slice(0, 3);
});

afterAll(async () => {
  await query('DELETE FROM users WHERE id = ANY($1)', [made]);
  await pool.end();
});

test('three activities at 80% or more on a topic earn its badge, the moment the third is done', async () => {
  const s = await newStudent('earn');
  const [a, b, c] = games;
  expect((await play(s, a, size(a))).body.data.badge).toBeNull();
  expect((await play(s, b, size(b))).body.data.badge).toBeNull();
  const third = await play(s, c, size(c));
  expect(third.body.data.badge).toMatchObject({ topicId: topic });

  const progress = await request(app).get(`/api/progress/${s.id}`).set(s.auth);
  expect(progress.body.data.badges).toHaveLength(1);
});

test('C1: more work and three reloads leave the badge there once', async () => {
  const s = await newStudent('once');
  for (const g of games) await play(s, g, size(g));
  for (const g of games) await play(s, g, size(g));
  for (let i = 0; i < 3; i += 1) {
    const res = await request(app).get(`/api/progress/${s.id}`).set(s.auth);
    expect(res.body.data.badges).toHaveLength(1);
  }
});

test('C3: eight activities all under 50% earn no badge', async () => {
  const s = await newStudent('low');
  for (let i = 0; i < 8; i += 1) {
    const g = games[i % games.length];
    const res = await play(s, g, Math.floor((size(g) - 1) / 2));
    expect(res.body.data.percent).toBeLessThan(50);
  }
  const res = await request(app).get(`/api/progress/${s.id}`).set(s.auth);
  expect(res.body.data.badges).toEqual([]);
});

test('the same activity done well three times is one activity, not three', async () => {
  const s = await newStudent('repeat');
  for (let i = 0; i < 3; i += 1) {
    const res = await play(s, games[0], size(games[0]));
    expect(res.body.data.badge).toBeNull();
  }
});

test('work done before the badge rule existed is counted when progress is next opened', async () => {
  const s = await newStudent('backfill');
  for (const g of games) {
    await query(
      `INSERT INTO attempts (student_id, kind, game_id, topic_id, score, max_score, answers, created_at)
       VALUES ($1, 'game', $2, $3, 9, 10, '{}', now() - ($4 || ' days')::interval)`,
      [s.id, g.id, topic, 10 - games.indexOf(g)],
    );
  }
  const res = await request(app).get(`/api/progress/${s.id}`).set(s.auth);
  expect(res.body.data.badges).toHaveLength(1);
  // Dated when the third activity reached 80%, eight days ago, not today.
  const days = (Date.now() - new Date(res.body.data.badges[0].earnedAt)) / 86400000;
  expect(Math.round(days)).toBe(8);
});

test('C2: levels only go up, whatever the next score', async () => {
  const s = await newStudent('level');
  const path = async () => (await request(app).get('/api/path').set(s.auth)).body.data.units;
  const levelOf = (units) => units.filter((u) => u.unlocked).length;

  // Reach the next tier by setting the first keystone.
  const first = (await path()).find((u) => u.hasCheckpoint);
  const cp = (await request(app).get(`/api/path/checkpoints/${first.topicId}`).set(s.auth)).body.data;
  const key = await query('SELECT id, correct_answer FROM questions WHERE id = ANY($1)', [cp.questions.map((q) => q.id)]);
  await request(app).post(`/api/path/checkpoints/${first.topicId}`).set(s.auth)
    .send({ ticket: cp.ticket, answers: Object.fromEntries(key.map((q) => [q.id, q.correct_answer])) });
  const up = await path();
  const level = levelOf(up);
  expect(level).toBeGreaterThan(1);

  // Score badly in the new tier: the level stays.
  const next = up[up.findIndex((u) => u.topicId === first.topicId) + 1];
  const game = await queryOne('SELECT id, kind, content FROM games WHERE topic_id = $1 AND kind = ANY($2) LIMIT 1',
    [next.topicId, ['matching', 'drag_drop', 'predict', 'fillblank']]);
  const res = await play(s, game, Math.floor(size(game) / 5));
  expect(res.body.data.percent).toBeLessThanOrEqual(20);
  expect(levelOf(await path())).toBe(level);
});
