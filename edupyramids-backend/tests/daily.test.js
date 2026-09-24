const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../src/app');
const { pool, query, queryOne } = require('../src/config/database');
const { resetThrottle } = require('../src/services/authService');
const {
  streakFrom, dayOf, xpForAttempt, XP,
} = require('../src/services/dailyService');
const { token } = require('../src/games/common');

/*
 * XP, the daily goal and the school-day streak. The streak rules are checked
 * on fixed calendars; the API on a student of its own.
 */

// 2026-09-07 is a Monday.
const MON = '2026-09-07';
const day = (n) => {
  const d = new Date(`${MON}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

describe('the streak', () => {
  test('a school week of activity is a streak of five and earns a freeze', () => {
    const s = streakFrom([0, 1, 2, 3, 4].map(day), day(4));
    expect(s).toMatchObject({ streak: 5, longest: 5, freezes: 1 });
  });

  test('a weekend with nothing done does not break it', () => {
    expect(streakFrom([day(4), day(7)], day(7)).streak).toBe(2);   // Friday, then Monday
  });

  test('practising at the weekend still counts', () => {
    expect(streakFrom([day(4), day(5), day(7)], day(7)).streak).toBe(3);
  });

  test('a missed school day breaks it when there is no freeze', () => {
    const s = streakFrom([day(0), day(1), day(3)], day(3));       // Wednesday missed
    expect(s.streak).toBe(1);
    expect(s.longest).toBe(2);
    expect(s.days.find((d) => d.day === day(2)).state).toBe('missed');
  });

  test('a freeze covers a missed school day by itself', () => {
    // Mon to Fri earns a freeze; the next Monday is missed; Tuesday carries on.
    const s = streakFrom([0, 1, 2, 3, 4, 8].map(day), day(8));
    expect(s.days.find((d) => d.day === day(7)).state).toBe('frozen');
    expect(s).toMatchObject({ streak: 6, freezes: 0 });
  });

  test('today with nothing done yet does not break it', () => {
    const s = streakFrom([day(0), day(1)], day(2));
    expect(s.streak).toBe(2);
    expect(s.days[s.days.length - 1].state).toBe('today');
  });

  test('at most two freezes are kept', () => {
    const fifteen = Array.from({ length: 21 }, (_, i) => day(i)).filter((d) => ![0, 6].includes(new Date(d).getUTCDay()));
    expect(streakFrom(fifteen, fifteen[fifteen.length - 1]).freezes).toBe(2);
  });
});

test('days are counted in India time', () => {
  expect(dayOf('2026-09-24T20:00:00Z', 'Asia/Kolkata')).toBe('2026-09-25');
  expect(dayOf('2026-09-24T17:00:00Z', 'Asia/Kolkata')).toBe('2026-09-24');
});

test('XP follows the score, rewards new stars, and replays at three stars earn little', () => {
  expect(xpForAttempt(0, 0, 0)).toBe(0);                      // an empty attempt earns nothing
  expect(xpForAttempt(0, 0, 0.5)).toBe(5);
  expect(xpForAttempt(0, 2, 1)).toBe(XP.finish + 2 * XP.perNewStar);
  expect(xpForAttempt(2, 2, 1)).toBe(XP.finish);
  expect(xpForAttempt(1, 3, 1)).toBe(XP.finish + 2 * XP.perNewStar);
  expect(xpForAttempt(3, 3, 1)).toBe(XP.replay);
  expect(xpForAttempt(3, 0, 0.2)).toBe(0);
});

describe('the API', () => {
  let student;
  let studentId;

  beforeAll(async () => {
    const hash = await bcrypt.hash('password123', 4);
    studentId = (await queryOne(
      `INSERT INTO users (email, password_hash, name, role, school_id)
       VALUES ('daily@school.com', $1, 'Daily Tester', 'student', 'school_001') RETURNING id`,
      [hash],
    )).id;
    resetThrottle();
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'daily@school.com', password: 'password123', role: 'student' });
    student = { Authorization: `Bearer ${res.body.token}` };
  });

  afterAll(async () => {
    await query('DELETE FROM users WHERE id = $1', [studentId]);
    await pool.end();
  });

  test('a new student starts at zero with the default goal', async () => {
    const { body } = await request(app).get('/api/me/daily').set(student);
    expect(body.data).toMatchObject({
      goal: 20, today: { xp: 0, done: false }, xp: { total: 0 }, streak: { current: 0, freezes: 0 },
    });
    expect(body.data.week).toHaveLength(7);
  });

  test('finishing a game earns XP for today and starts the streak; a replay at three stars earns 2', async () => {
    const game = await queryOne("SELECT id, content FROM games WHERE kind = 'predict' ORDER BY id LIMIT 1");
    const answers = Object.fromEntries(game.content.items.map((it, i) => [token(game.id, `o${i}`), it.output]));

    const first = await request(app).post(`/api/games/${game.id}/results`).set(student).send({ answers });
    expect(first.body.data).toMatchObject({ stars: 3, xp: XP.finish + 3 * XP.perNewStar });
    const again = await request(app).post(`/api/games/${game.id}/results`).set(student).send({ answers });
    expect(again.body.data.xp).toBe(XP.replay);

    const { body } = await request(app).get('/api/me/daily').set(student);
    expect(body.data.today).toMatchObject({ xp: XP.finish + 3 * XP.perNewStar + XP.replay, done: true });
    expect(body.data.streak.current).toBe(1);
  });

  test('an attempt made offline counts on the day it was done', async () => {
    const game = await queryOne("SELECT id, content FROM games WHERE kind = 'matching' ORDER BY id LIMIT 1");
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const answers = Object.fromEntries(game.content.pairs.map((_, i) => [token(game.id, `l${i}`), token(game.id, `r${i}`)]));
    await request(app).post(`/api/games/${game.id}/results`).set(student).send({ answers, answeredAt: yesterday });
    const { body } = await request(app).get('/api/me/daily').set(student);
    expect(body.data.week[5].xp).toBe(XP.finish + 3 * XP.perNewStar);
  });

  test('pressing Finish on an empty game earns no XP', async () => {
    const game = await queryOne("SELECT id FROM games WHERE kind = 'bughunt' ORDER BY id LIMIT 1");
    const res = await request(app).post(`/api/games/${game.id}/results`).set(student).send({ answers: {} });
    expect(res.body.data.xp).toBe(0);
  });

  test('the goal can be changed to one of the choices only', async () => {
    const ok = await request(app).put('/api/me/goal').set(student).send({ goal: 30 });
    expect(ok.body.data.goal).toBe(30);
    expect((await request(app).put('/api/me/goal').set(student).send({ goal: 25 })).status).toBe(400);
  });

  test('staff have no daily figures', async () => {
    resetThrottle();
    const res = await request(app).post('/api/auth/login').send({ email: 'teacher1@school.com', password: 'password123', role: 'teacher' });
    expect((await request(app).get('/api/me/daily').set({ Authorization: `Bearer ${res.body.token}` })).status).toBe(403);
  });
});
