#!/usr/bin/env node
/*
 * HLD test D4: fifty students use the app at once. It passes if all fifty
 * attempts are saved and pages load in under three seconds.
 *
 *   node scripts/load-test.js                    # against http://localhost:5000
 *   node scripts/load-test.js http://localhost:5077 --students 50
 *
 * Makes fifty temporary students straight in the database (so it needs
 * DATABASE_URL, and is meant for a local or staging copy, never the live
 * site), signs them all in together, and has each at the same moment open
 * Home, take a quiz lesson and play a game. It times every page as the
 * browser would load it (Home fetches four things side by side), checks the
 * database holds every attempt, and removes the temporary students.
 */
require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool, query, queryOne } = require('../src/config/database');
const { token } = require('../src/games/common');

const args = process.argv.slice(2);
const BASE = (args.find((a) => a.startsWith('http')) || 'http://localhost:5000').replace(/\/$/, '');
const COUNT = Number(args[args.indexOf('--students') + 1]) || 50;
const LIMIT_MS = 3000;
const DOMAIN = 'loadtest.example';

async function api(path, { method = 'GET', body, auth } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 404) throw new Error(`${method} ${path} -> ${res.status}`);
  return res.status === 204 ? null : res.json();
}

/** One page, timed as the browser loads it: its requests side by side. */
async function page(timings, name, requests) {
  const start = performance.now();
  const out = await Promise.all(requests.map((r) => r()));
  timings.push({ page: name, ms: performance.now() - start });
  return out;
}

async function student(auth, id, quizId, lesson, g, timings) {
  await page(timings, 'Home', [
    () => api('/path', { auth }), () => api('/me/daily', { auth }),
    () => api('/me/classes', { auth }), () => api('/practice/mastery', { auth }),
  ]);
  const [quiz] = await page(timings, 'Quiz lesson', [() => api(`/quizzes/${quizId}?lesson=${lesson}`, { auth })]);
  const answers = Object.fromEntries(quiz.data.questions.map((q) => [q.id, ['a', 'b', 'c'][crypto.randomInt(3)]]));
  await page(timings, 'Quiz result', [() => api(`/quizzes/${quizId}/attempts`, {
    method: 'POST', auth, body: { answers, lesson, clientAttemptId: crypto.randomUUID() },
  })]);
  await page(timings, 'Game', [() => api(`/games/${g.id}`, { auth })]);
  const moves = Object.fromEntries(g.content.pairs.map((_, i) => [token(g.id, `l${i}`), token(g.id, `r${i}`)]));
  await page(timings, 'Game result', [() => api(`/games/${g.id}/results`, {
    method: 'POST', auth, body: { answers: moves, clientAttemptId: crypto.randomUUID() },
  })]);
  return id;
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

async function main() {
  console.log(`D4 load test: ${COUNT} students at once against ${BASE}\n`);
  const quiz = await queryOne(
    'SELECT q.id FROM quizzes q WHERE (SELECT COUNT(*) FROM questions WHERE quiz_id = q.id) > 12 ORDER BY q.id LIMIT 1',
  ) || await queryOne('SELECT id FROM quizzes ORDER BY id LIMIT 1');
  const g = await queryOne("SELECT id, content FROM games WHERE kind = 'matching' ORDER BY id LIMIT 1");
  const lesson = (await queryOne('SELECT COUNT(*)::int AS n FROM questions WHERE quiz_id = $1', [quiz.id])).n > 12 ? 1 : null;

  // Fifty students, made directly: the test is of the app under load, not of sign-up.
  const hash = await bcrypt.hash('password123', 4);
  const ids = [];
  for (let i = 0; i < COUNT; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    ids.push((await queryOne(
      `INSERT INTO users (email, password_hash, name, role, school_id)
       VALUES ($1, $2, $3, 'student', 'school_001') RETURNING id`,
      [`load${i}@${DOMAIN}`, hash, `Load Student ${i + 1}`],
    )).id);
  }

  try {
    const timings = [];
    const signIns = await Promise.all(ids.map(async (id, i) => {
      const start = performance.now();
      const res = await api('/auth/login', { method: 'POST', body: { email: `load${i}@${DOMAIN}`, password: 'password123', role: 'student' } });
      timings.push({ page: 'Sign in', ms: performance.now() - start });
      return { id, auth: res.token };
    }));

    const started = performance.now();
    await Promise.all(signIns.map((s) => student(s.auth, s.id, quiz.id, lesson ?? undefined, g, timings)));
    const total = performance.now() - started;

    const saved = await queryOne(
      `SELECT COUNT(*) FILTER (WHERE kind = 'quiz')::int AS quizzes, COUNT(*) FILTER (WHERE kind = 'game')::int AS games
         FROM attempts WHERE student_id = ANY($1)`,
      [ids],
    );

    const pages = [...new Set(timings.map((t) => t.page))];
    console.log('Page            loads   median    95th     slowest');
    let worst = 0;
    for (const p of pages) {
      const ms = timings.filter((t) => t.page === p).map((t) => t.ms).sort((a, b) => a - b);
      worst = Math.max(worst, ms[ms.length - 1]);
      console.log(`${p.padEnd(15)} ${String(ms.length).padStart(5)} ${pct(ms, 0.5).toFixed(0).padStart(7)} ms ${pct(ms, 0.95).toFixed(0).padStart(6)} ms ${ms[ms.length - 1].toFixed(0).padStart(7)} ms`);
    }
    console.log(`\nAll ${COUNT} students finished in ${(total / 1000).toFixed(1)} s.`);
    console.log(`Attempts saved: ${saved.quizzes} quiz lessons and ${saved.games} games (expected ${COUNT} each).`);

    const pass = saved.quizzes === COUNT && saved.games === COUNT && worst < LIMIT_MS;
    console.log(`\nD4 ${pass ? 'PASSES' : 'FAILS'}: ${saved.quizzes === COUNT && saved.games === COUNT ? 'every attempt saved' : 'attempts missing'}, `
      + `slowest page ${(worst / 1000).toFixed(2)} s (limit ${LIMIT_MS / 1000} s).`);
    process.exitCode = pass ? 0 : 1;
  } finally {
    await query('DELETE FROM users WHERE email LIKE $1', [`%@${DOMAIN}`]);
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => pool.end());
