const request = require('supertest');
const app = require('../src/app');
const { pool, query } = require('../src/config/database');
const { resetThrottle } = require('../src/services/authService');
const { token } = require('../src/games/common');
const { kindNames, registry } = require('../src/games');

/*
 * The same promises, checked for every game of every kind in the content file:
 *   - what the browser receives carries no answer key and no explanation;
 *   - a perfect answer scores full marks;
 *   - an empty answer scores nothing and does not crash.
 * A new kind is covered here as soon as it has a perfect() below.
 */

/** A full-marks answer, built from the stored content the way the browser would send it. */
const perfect = {
  matching: (g) => Object.fromEntries(g.content.pairs.map((_, i) => [token(g.id, `l${i}`), token(g.id, `r${i}`)])),
  drag_drop: (g) => Object.fromEntries(g.content.items.map((it, i) => [token(g.id, `i${i}`), it.bucket])),
  memory: (g) => ({ moves: g.content.pairs.map((_, i) => [token(g.id, `a${i}`), token(g.id, `b${i}`)]) }),
  parsons: (g) => ({ program: g.content.lines.map((l, i) => ({ id: token(g.id, `p${i}`), indent: l.indent })) }),
  predict: (g) => Object.fromEntries(g.content.items.map((it, i) => [token(g.id, `o${i}`), `${it.output}\n`])),
  bughunt: (g) => Object.fromEntries(g.content.items.map((it, i) => [
    token(g.id, `b${i}`), { line: it.bugLine, fix: token(g.id, `b${i}f${it.fix}`) },
  ])),
  fillblank: (g) => Object.fromEntries(g.content.items.map((it, i) => [token(g.id, `f${i}`), it.blanks])),
  bugcatch: (g) => Object.fromEntries(g.content.items.map((it, i) => [token(g.id, `c${i}`),
    registry.bugcatch.bestSet(it).map((k) => ({
      input: token(g.id, `c${i}n${k}`),
      expect: token(g.id, `c${i}n${k}o${registry.bugcatch.optionsFor(it, k).indexOf(it.outputs[k])}`),
    }))])),
  trace: (g) => Object.fromEntries(g.content.items.flatMap((it, i) => it.steps
    .map((s, k) => [token(g.id, `t${i}s${k}`), s.value]))),
};

// Keys that only the stored content has. None may reach the browser.
// (Parsons sends its lines as shuffled blocks; the indentation is the secret part.)
const SECRET_KEYS = /"(explanation|right|bucket|output|outputs|mutants|bug|value|blanks|decoys|bugLine|fix|indent|distractors|correct)"/;

let auth;
let games;

beforeAll(async () => {
  resetThrottle();
  const res = await request(app).post('/api/auth/login')
    .send({ email: 'coordinator@school.com', password: 'password123', role: 'coordinator' });
  auth = { Authorization: `Bearer ${res.body.token}` };
  games = await query('SELECT id, kind, title, content FROM games ORDER BY id');
});

afterAll(async () => {
  // Coordinator attempts are test noise; leave the student figures untouched.
  await query("DELETE FROM attempts WHERE student_id = (SELECT id FROM users WHERE email = 'coordinator@school.com')");
  await pool.end();
});

test('every registered kind has a perfect answer builder, and the file uses them all', () => {
  expect(Object.keys(perfect).sort()).toEqual([...kindNames].sort());
  expect(new Set(games.map((g) => g.kind))).toEqual(new Set(kindNames));
});

test.each(kindNames)('%s: nothing secret is sent, a perfect answer scores full marks, an empty one scores 0', async (kind) => {
  for (const game of games.filter((g) => g.kind === kind)) {
    const delivered = await request(app).get(`/api/games/${game.id}`).set(auth);
    expect(delivered.status).toBe(200);
    expect(JSON.stringify(delivered.body.data)).not.toMatch(SECRET_KEYS);

    const full = await request(app).post(`/api/games/${game.id}/results`).set(auth)
      .send({ answers: perfect[kind](game) });
    expect([game.title, full.body.data.percent]).toEqual([game.title, 100]);

    const empty = await request(app).post(`/api/games/${game.id}/results`).set(auth).send({ answers: {} });
    expect(empty.status).toBe(201);
    expect(empty.body.data.score).toBe(0);
  }
});

describe('the new kinds mark partial answers fairly', () => {
  const game = (kind) => games.find((g) => g.kind === kind);

  test('parsons: one line out of place costs one point, not the rest of the program', () => {
    const g = game('parsons');
    const program = perfect.parsons(g).program;
    // Move the first line to the end.
    const moved = [...program.slice(1), program[0]];
    const { score, maxScore, extra } = registry.parsons.mark(g, { program: moved });
    expect(score).toBe(maxScore - 1);
    expect(extra.lines.filter((l) => !l.ok)).toHaveLength(1);
  });

  test('parsons: wrong indentation and distractor lines both cost points', () => {
    const g = games.find((x) => x.kind === 'parsons' && x.content.distractors.length);
    const program = perfect.parsons(g).program;
    const indented = program.map((p, i) => (i === program.length - 1 ? { ...p, indent: p.indent + 1 } : p));
    expect(registry.parsons.mark(g, { program: indented }).score).toBe(program.length - 1);

    const withDistractor = [...program, { id: token(g.id, 'x0'), indent: 0 }];
    const marked = registry.parsons.mark(g, { program: withDistractor });
    expect(marked).toMatchObject({ score: program.length - 1, extra: { distractorsUsed: 1 } });
  });

  test('predict: trailing spaces do not count, but 3 and 3.0 are different answers', () => {
    const g = { id: 1, content: { items: [{ code: 'print(3)', output: '3' }, { code: 'for i in range(2): print(i)', output: '0\n1' }] } };
    const ok = registry.predict.mark(g, { [token(1, 'o0')]: '3  ', [token(1, 'o1')]: '0 \r\n1\n' });
    expect(ok.score).toBe(2);
    expect(registry.predict.mark(g, { [token(1, 'o0')]: '3.0' }).score).toBe(0);
  });

  test('bughunt: the right line with the wrong fix earns half', () => {
    const g = game('bughunt');
    const it = g.content.items[0];
    const wrongFix = it.fix === 0 ? 1 : 0;
    const { score, feedback } = registry.bughunt.mark(g, {
      [token(g.id, 'b0')]: { line: it.bugLine, fix: token(g.id, `b0f${wrongFix}`) },
    });
    expect(score).toBe(1);
    expect(feedback[0]).toMatchObject({ correct: false, partial: true });
  });
});
