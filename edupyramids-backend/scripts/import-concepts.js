#!/usr/bin/env node
/*
 * Load the concept map (content/concepts.json).
 *
 * Runs before the questions are imported, because questions name their
 * concepts by slug. Re-running updates names, descriptions and prerequisites
 * in place; it never deletes a concept, since mastery rows point at them.
 *
 *   node scripts/import-concepts.js [file]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/database');

const SLUG = /^[a-z0-9-]+$/;

function validate(raw) {
  const errors = [];
  if (!Array.isArray(raw)) return ['The file must contain a list of concepts'];

  const slugs = new Set(raw.map((c) => c && c.slug));
  raw.forEach((c, i) => {
    const at = `concepts[${i}]`;
    if (!c || typeof c.slug !== 'string' || !SLUG.test(c.slug)) {
      errors.push(`${at}: "slug" must be lowercase letters, digits and dashes`);
      return;
    }
    if (typeof c.name !== 'string' || !c.name.trim()) errors.push(`${at} (${c.slug}): "name" is required`);
    (c.requires || []).forEach((r) => {
      if (!slugs.has(r)) errors.push(`${at} (${c.slug}): requires "${r}", which is not in the file`);
    });
  });
  if (slugs.size !== raw.length) errors.push('Two concepts share a slug');

  // A prerequisite loop would leave every concept in it waiting on another.
  const bySlug = Object.fromEntries(raw.map((c) => [c.slug, c.requires || []]));
  const visiting = new Set();
  const done = new Set();
  const visit = (s, trail) => {
    if (done.has(s)) return;
    if (visiting.has(s)) { errors.push(`Prerequisite loop: ${[...trail, s].join(' → ')}`); return; }
    visiting.add(s);
    (bySlug[s] || []).forEach((r) => visit(r, [...trail, s]));
    visiting.delete(s);
    done.add(s);
  };
  Object.keys(bySlug).forEach((s) => visit(s, []));

  return errors;
}

async function load(concepts, client = pool) {
  for (const [i, c] of concepts.entries()) {
    await client.query(
      `INSERT INTO concepts (slug, name, description, sort_order, requires)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (slug) DO UPDATE
          SET name = EXCLUDED.name, description = EXCLUDED.description,
              sort_order = EXCLUDED.sort_order, requires = EXCLUDED.requires`,
      [c.slug, c.name.trim(), c.description ?? null, i, c.requires || []],
    );
  }
  return concepts.length;
}

const DEFAULT_FILE = path.join(__dirname, '..', 'content', 'concepts.json');

async function main() {
  const file = process.argv[2] || DEFAULT_FILE;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errors = validate(raw);
  if (errors.length) {
    console.error(`Refused ${path.basename(file)}:`);
    errors.forEach((e) => console.error(`  error    ${e}`));
    process.exit(1);
  }
  console.log(`Loaded ${await load(raw)} concept(s).`);
  await pool.end();
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error(err.message);
    await pool.end();
    process.exit(1);
  });
}

module.exports = { validate, load, DEFAULT_FILE };
