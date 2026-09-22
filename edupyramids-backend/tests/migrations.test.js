const fs = require('fs');
const path = require('path');
const { pool, queryOne } = require('../src/config/database');

/*
 * The server runs every migration on every boot (scripts/render-start.sh), so
 * each one must succeed against a database that already has data in it — not
 * only against the empty one the other suites start from. A migration that
 * re-added an old CHECK once broke a deploy exactly this way.
 */
const dir = path.join(__dirname, '..', 'migrations');

afterAll(() => pool.end());

test('every migration runs again on a database that already holds games of every kind', async () => {
  const kinds = await queryOne('SELECT COUNT(DISTINCT kind)::int AS n FROM games');
  expect(kinds.n).toBeGreaterThan(3);

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await expect(pool.query(fs.readFileSync(path.join(dir, file), 'utf8')))
      .resolves.toBeDefined();
  }
});
