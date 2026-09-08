#!/usr/bin/env node
/*
 * Moodle question export (one row per answer option) -> our question format.
 *
 *   node scripts/convert-moodle-csv.js "Python - Python.csv" content/python.json
 *
 * The file groups questions by category, and the categories are difficulty
 * levels rather than subjects, so that is what the topics become. Nothing here
 * invents a topic for a question: the file does not say what any question is
 * about, and guessing would put words in the client's mouth.
 */
const fs = require('fs');

const LETTERS = ['a', 'b', 'c', 'd', 'e'];

// Their category names, tidied for display, with the order they unlock in.
const TOPICS = {
  'MCQs-Bronze Level': { name: 'Bronze Level', level: 1 },
  'MCQs-Silver Level': { name: 'Silver Level', level: 2 },
  'MCQs-Gold Level': { name: 'Gold Level', level: 3 },
  'Default for PYTPOST001': { name: 'Post-test', level: 4 },
};

/** Minimal RFC4180 reader: quoted fields, doubled quotes, embedded newlines. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const tidy = (s) => s
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
  .replace(/\s+/g, ' ')
  .trim();

function main() {
  const [src, dest] = process.argv.slice(2);
  if (!src || !dest) {
    console.error('Usage: node scripts/convert-moodle-csv.js <csv> <out.json>');
    process.exit(2);
  }

  const [header, ...rows] = parseCsv(fs.readFileSync(src, 'utf8').replace(/^﻿/, ''));
  const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));

  const byQuestion = new Map();
  for (const r of rows) {
    if (!r[col.question_id]) continue;
    const id = r[col.question_id];
    if (!byQuestion.has(id)) byQuestion.set(id, []);
    byQuestion.get(id).push(r);
  }

  const topics = new Map();
  const skipped = [];

  for (const [id, opts] of byQuestion) {
    const first = opts[0];
    const cat = first[col.category_name];
    const meta = TOPICS[cat] || { name: cat, level: 1 };

    const text = tidy(first[col.clean_questiontext] || first[col.questiontext]);
    const answers = opts.map((o) => tidy(o[col.clean_answer] || o[col.answer]))
      .filter(Boolean);
    const correctAt = opts.findIndex((o) => Number(o[col.fraction]) === 1);

    if (!text || answers.length < 2 || correctAt < 0 || correctAt >= LETTERS.length
        || answers.length > LETTERS.length) {
      skipped.push({ id, why: !text ? 'no question text'
        : correctAt < 0 ? 'no option marked correct'
          : `${answers.length} options` });
      continue;
    }

    const options = {};
    answers.forEach((a, i) => { options[LETTERS[i]] = a; });

    if (!topics.has(meta.name)) {
      topics.set(meta.name, { topic: meta.name, level: meta.level, quizzes: [] });
    }
    const t = topics.get(meta.name);
    if (!t.quizzes.length) {
      t.quizzes.push({ title: `${meta.name} questions`, difficulty: meta.level, questions: [] });
    }
    // No explanation column exists in the export, so none is written. The
    // importer warns about that rather than inventing one.
    t.quizzes[0].questions.push({ text, options, correct: LETTERS[correctAt] });
  }

  const out = [...topics.values()].sort((a, b) => a.level - b.level);
  fs.writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`);

  const total = out.reduce((n, t) => n + t.quizzes[0].questions.length, 0);
  console.log(`${total} questions across ${out.length} topics -> ${dest}`);
  out.forEach((t) => console.log(`  ${String(t.quizzes[0].questions.length).padStart(4)}  ${t.topic} (level ${t.level})`));
  if (skipped.length) {
    console.log(`\n${skipped.length} skipped:`);
    skipped.forEach((s) => console.log(`  question ${s.id}: ${s.why}`));
  }
}

if (require.main === module) main();

module.exports = { parseCsv, tidy };
