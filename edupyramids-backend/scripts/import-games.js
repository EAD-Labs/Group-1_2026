#!/usr/bin/env node
/*
 * Load a game file into the database.
 *
 * Same contract as import-questions.js: the whole file is checked before a
 * single row is written, and the write is one transaction, so a mistake in the
 * last game leaves the database exactly as it was.
 *
 *   node scripts/import-games.js <file> [--replace] [--dry-run] [--quiet]
 *
 * The format is in content/README.md.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/database');

const { registry, kindNames, kindOf } = require('../src/games');
const { isText, duplicates } = require('../src/games/common');

/**
 * Check the whole file. The file-level rules (topics, titles, a known kind)
 * are here; what makes a game of a given kind valid is that kind's own
 * validate(), in src/games.
 *
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
    if (!topic || !isText(topic.topic)) {
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

    duplicates(topic.games.map((g) => g && g.title))
      .forEach((t) => errors.push(`${at} (${topic.topic}): two games are called "${t}"`));

    topic.games.forEach((game, gi) => {
      const gAt = `${at}.games[${gi}]`;
      if (!game || !isText(game.title)) {
        errors.push(`${gAt}: "title" is required`);
        return;
      }
      const kind = kindOf(game.kind);
      if (!kind) {
        errors.push(`${gAt} (${game.title}): "kind" must be one of ${kindNames.join(', ')}`);
        return;
      }
      const result = kind.validate(game, gAt);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    });
  });

  return { errors, warnings, topics: raw };
}

/** Only what the kind stores, so a stray field in the file is not kept. */
const contentOf = (game) => registry[game.kind].contentOf(game);

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
  // --quiet drops the per-item warnings (a boot log does not need 136 of them);
  // errors are still printed and still stop the import.
  const quiet = args.includes('--quiet');

  if (!file) {
    console.error('Usage: node scripts/import-games.js <file> [--replace] [--dry-run] [--quiet]');
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
  if (!quiet) warnings.forEach((w) => console.warn(`  warning  ${w}`));

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
