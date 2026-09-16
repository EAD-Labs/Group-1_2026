#!/usr/bin/env node
/*
 * Load a game file into the database.
 *
 * Same contract as import-questions.js: the whole file is checked before a
 * single row is written, and the write is one transaction, so a mistake in the
 * last game leaves the database exactly as it was.
 *
 *   node scripts/import-games.js <file> [--replace] [--dry-run]
 *
 * The format is in content/README.md.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/database');

const KINDS = ['matching', 'drag_drop', 'memory'];

const text = (v) => typeof v === 'string' && v.trim().length > 0;

/** Every value in the list is different, compared as trimmed text. */
function duplicates(values) {
  const seen = new Set();
  const dupes = new Set();
  values.forEach((v) => {
    const key = String(v).trim();
    if (seen.has(key)) dupes.add(key);
    seen.add(key);
  });
  return [...dupes];
}

/**
 * @returns {{ errors: string[], warnings: string[], topics: object[] }}
 */
function validate(raw) {
  const errors = [];
  const warnings = [];

  if (!Array.isArray(raw)) {
    return { errors: ['The file must contain a list of topics'], warnings, topics: [] };
  }

  raw.forEach((topic, ti) => {
    const at = `topics[${ti}]`;
    if (!topic || !text(topic.topic)) {
      errors.push(`${at}: "topic" is required`);
      return;
    }
    if (topic.level !== undefined && !Number.isInteger(topic.level)) {
      errors.push(`${at}: "level" must be a whole number`);
    }
    if (!Array.isArray(topic.games) || topic.games.length === 0) {
      errors.push(`${at} (${topic.topic}): needs at least one game`);
      return;
    }

    const titles = duplicates(topic.games.map((g) => g && g.title));
    titles.forEach((t) => errors.push(`${at} (${topic.topic}): two games are called "${t}"`));

    topic.games.forEach((game, gi) => {
      const gAt = `${at}.games[${gi}]`;
      if (!game || !text(game.title)) {
        errors.push(`${gAt}: "title" is required`);
        return;
      }
      if (!KINDS.includes(game.kind)) {
        errors.push(`${gAt} (${game.title}): "kind" must be one of ${KINDS.join(', ')}`);
        return;
      }

      if (game.kind === 'matching' || game.kind === 'memory') {
        const [l, r] = game.kind === 'matching' ? ['left', 'right'] : ['a', 'b'];
        if (!Array.isArray(game.pairs) || game.pairs.length < 2) {
          errors.push(`${gAt} (${game.title}): needs at least two pairs`);
          return;
        }
        game.pairs.forEach((p, pi) => {
          if (!p || !text(p[l]) || !text(p[r])) {
            errors.push(`${gAt}.pairs[${pi}]: "${l}" and "${r}" are both required`);
          } else if (!text(p.explanation)) {
            warnings.push(`${gAt}.pairs[${pi}]: no explanation`);
          }
        });
        // Two tiles or answers with the same text would make a right answer
        // look wrong, which is the one mistake a player cannot recover from.
        const sides = game.kind === 'matching'
          ? [game.pairs.map((p) => p && p[l]), game.pairs.map((p) => p && p[r])]
          : [game.pairs.flatMap((p) => (p ? [p[l], p[r]] : []))];
        sides.forEach((values) => duplicates(values).forEach((d) => {
          errors.push(`${gAt} (${game.title}): "${d}" appears twice, so it could match either`);
        }));
      }

      if (game.kind === 'drag_drop') {
        if (!Array.isArray(game.buckets) || game.buckets.length < 2 || !game.buckets.every(text)) {
          errors.push(`${gAt} (${game.title}): needs at least two named buckets`);
          return;
        }
        duplicates(game.buckets).forEach((d) => errors.push(`${gAt}: bucket "${d}" appears twice`));
        if (!Array.isArray(game.items) || game.items.length < 2) {
          errors.push(`${gAt} (${game.title}): needs at least two items`);
          return;
        }
        game.items.forEach((item, ii) => {
          if (!item || !text(item.text)) {
            errors.push(`${gAt}.items[${ii}]: "text" is required`);
          } else if (!game.buckets.includes(item.bucket)) {
            errors.push(`${gAt}.items[${ii}]: bucket "${item.bucket}" is not one of this game's buckets`);
          } else if (!text(item.explanation)) {
            warnings.push(`${gAt}.items[${ii}]: no explanation`);
          }
        });
        duplicates(game.items.map((i) => i && i.text))
          .forEach((d) => errors.push(`${gAt} (${game.title}): item "${d}" appears twice`));
      }
    });
  });

  return { errors, warnings, topics: raw };
}

/** Only what the kind needs, so a stray field in the file is not stored. */
function contentOf(game) {
  if (game.kind === 'drag_drop') {
    return { buckets: game.buckets, items: game.items };
  }
  return { pairs: game.pairs };
}

async function load(topics, { replace }) {
  const client = await pool.connect();
  const counts = { topics: 0, games: 0 };

  try {
    await client.query('BEGIN');

    for (const topic of topics) {
      const topicId = (await client.query(
        `INSERT INTO topics (name, level) VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET level = EXCLUDED.level
         RETURNING id`,
        [topic.topic.trim(), topic.level ?? 1],
      )).rows[0].id;
      counts.topics += 1;

      for (const game of topic.games) {
        const values = [game.title.trim(), game.kind, topicId,
          game.instructions ?? null, JSON.stringify(contentOf(game))];

        const result = await client.query(
          replace
            ? `INSERT INTO games (title, kind, topic_id, instructions, content)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (topic_id, title) DO UPDATE
                  SET kind = EXCLUDED.kind, instructions = EXCLUDED.instructions,
                      content = EXCLUDED.content
               RETURNING id`
            // Already loaded is left alone, so this can run on every deploy.
            : `INSERT INTO games (title, kind, topic_id, instructions, content)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (topic_id, title) DO NOTHING
               RETURNING id`,
          values,
        );
        counts.games += result.rowCount;
      }
    }

    await client.query('COMMIT');
    return counts;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const replace = args.includes('--replace');
  const dryRun = args.includes('--dry-run');

  if (!file) {
    console.error('Usage: node scripts/import-games.js <file> [--replace] [--dry-run]');
    process.exit(2);
  }

  const full = path.resolve(file);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (err) {
    console.error(`Could not read ${file}: ${err.message}`);
    process.exit(1);
  }

  const { errors, warnings, topics } = validate(raw);
  warnings.forEach((w) => console.warn(`  warning  ${w}`));

  if (errors.length) {
    console.error(`\nRefused ${path.basename(full)} — ${errors.length} problem(s). ` +
      'Nothing was written.\n');
    errors.forEach((e) => console.error(`  error    ${e}`));
    process.exit(1);
  }

  if (dryRun) {
    console.log(`\n${path.basename(full)} is valid. ${warnings.length} warning(s). ` +
      'Nothing written (--dry-run).');
    await pool.end();
    return;
  }

  const counts = await load(topics, { replace });
  console.log(`\nLoaded ${path.basename(full)}: ${counts.topics} topic(s), ${counts.games} game(s).`);
  await pool.end();
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error(err.message);
    await pool.end();
    process.exit(1);
  });
}

module.exports = { validate, load };
