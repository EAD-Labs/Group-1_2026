const request = require('supertest');
const app = require('../src/app');
const { pool, query } = require('../src/config/database');
const {
  resetThrottle, trackedFailures, recordFailure, pruneFailures, MAX_TRACKED,
} = require('../src/services/authService');

/*
 * The small hardening from the code review of 7 October: security headers on
 * every reply, indexes for attempts by quiz and game, and a record of failed
 * sign-ins that forgets old entries instead of growing for ever.
 */

afterAll(async () => {
  resetThrottle();
  await pool.end();
});

describe('security headers', () => {
  test('every reply carries them, and nothing names the framework', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['permissions-policy']).toMatch(/camera=\(\)/);
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  test('the app can still be shown inside the client\'s site', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-frame-options']).toBeUndefined();
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  test('HSTS only over HTTPS (as nginx reports it)', async () => {
    expect((await request(app).get('/api/health')).headers['strict-transport-security']).toBeUndefined();
    const https = await request(app).get('/api/health').set('X-Forwarded-Proto', 'https');
    expect(https.headers['strict-transport-security']).toBe('max-age=15552000');
  });
});

test('attempts are indexed by quiz and by game', async () => {
  const rows = await query(
    "SELECT indexname FROM pg_indexes WHERE tablename = 'attempts' AND indexname IN ($1, $2)",
    ['idx_attempts_quiz_id', 'idx_attempts_game_id'],
  );
  expect(rows.map((r) => r.indexname).sort()).toEqual(['idx_attempts_game_id', 'idx_attempts_quiz_id']);
});

describe('the record of failed sign-ins', () => {
  beforeEach(() => resetThrottle());

  test('expired entries are swept out', () => {
    recordFailure('old@test.example', '10.0.0.1');
    recordFailure('old@test.example', '10.0.0.2');
    expect(trackedFailures()).toBe(2);
    pruneFailures(Date.now() + 16 * 60_000); // past the 15-minute window
    expect(trackedFailures()).toBe(0);
  });

  test('entries still in the window are kept', () => {
    recordFailure('recent@test.example', '10.0.0.1');
    pruneFailures(Date.now() + 61_000);
    expect(trackedFailures()).toBe(1);
  });

  test('a flood of made-up addresses is capped, oldest first', () => {
    for (let i = 0; i < MAX_TRACKED + 50; i += 1) recordFailure(`flood${i}@test.example`, '10.0.0.9');
    expect(trackedFailures()).toBe(MAX_TRACKED);
    recordFailure('newest@test.example', '10.0.0.9');
    expect(trackedFailures()).toBe(MAX_TRACKED);
  });
});
