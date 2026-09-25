#!/usr/bin/env node
/*
 * Synthetic classes for demos and for trying the dashboards: four classes of
 * twenty students, each with a teacher, and three weeks of activity.
 *
 *   node scripts/seed-demo-classes.js            # create (skipped if already there)
 *   node scripts/seed-demo-classes.js --reset    # remove and create again
 *   node scripts/seed-demo-classes.js --remove   # remove
 *
 * Everyone is made up: names are drawn from common first names and surnames,
 * and every address is @demo.example, a domain reserved for examples. The
 * password is password123, as for the other test accounts.
 *
 * Nothing is typed in by hand. Each student is played through the app's own
 * services (the pyramid picks the next brick, quizzes and games are marked,
 * keystones taken, practice answered, hints asked for), day by day over the
 * last three weeks, so every star, XP, streak, mastery estimate and class goal
 * comes out exactly as it would for a real class. The random choices come from
 * a fixed seed, so a run always produces the same data.
 */
require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool, query, queryOne } = require('../src/config/database');
const { token } = require('../src/games/common');
const { registry } = require('../src/games');
const { pathFor, startCheckpoint, finishCheckpoint } = require('../src/services/pathService');
const { markQuizAttempt } = require('../src/services/scoringService');
const { markGameAttempt, giveHint } = require('../src/services/gameService');
const { nextPracticeQuestion, answerPractice } = require('../src/services/masteryService');
const { lessonsFor } = require('../src/services/lessonService');
const { dayOf } = require('../src/services/dailyService');

const DOMAIN = 'demo.example';
const PASSWORD = 'password123';
const DAYS = 21;

// Each class has a character, so the teacher and coordinator views differ.
const CLASSES = [
  { name: 'Grade 9 Neem', teacher: ['Anjali', 'Deshpande', 'Mrs'], skill: 0.08, keen: 0.1 },
  { name: 'Grade 9 Peepal', teacher: ['Rakesh', 'Nair', 'Mr'], skill: 0, keen: 0 },
  { name: 'Grade 10 Banyan', teacher: ['Farah', 'Siddiqui', 'Ms'], skill: 0.03, keen: -0.05 },
  { name: 'Grade 10 Gulmohar', teacher: ['Suresh', 'Kulkarni', 'Mr'], skill: -0.08, keen: -0.1 },
];

const FIRST = [
  'Aarav', 'Ananya', 'Vivaan', 'Diya', 'Aditya', 'Isha', 'Arjun', 'Kavya', 'Reyansh', 'Meera',
  'Sai', 'Riya', 'Krishna', 'Sara', 'Ishaan', 'Aadhya', 'Rohan', 'Nisha', 'Kabir', 'Tanvi',
  'Dev', 'Pooja', 'Aryan', 'Sneha', 'Yash', 'Anika', 'Harsh', 'Neha', 'Varun', 'Ira',
  'Nikhil', 'Shreya', 'Om', 'Aditi', 'Rahul', 'Zoya', 'Manav', 'Priti', 'Siddharth', 'Lavanya',
];
const LAST = [
  'Sharma', 'Iyer', 'Patel', 'Reddy', 'Gupta', 'Nair', 'Das', 'Joshi', 'Menon', 'Rao',
  'Singh', 'Khan', 'Bose', 'Pillai', 'Mehta', 'Kaur', 'Verma', 'Shah', 'Chatterjee', 'Hegde',
];

// ---------------------------------------------------------------- randomness

let seed = 20260901;
function rnd() {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5; seed >>>= 0;
  return seed / 4294967296;
}
const pick = (list) => list[Math.floor(rnd() * list.length)];
const chance = (p) => rnd() < p;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// Three kinds of student, and how often each turns up.
const PROFILES = [
  { kind: 'strong', share: 0.25, skill: 0.84, keen: 0.75 },
  { kind: 'average', share: 0.5, skill: 0.66, keen: 0.55 },
  { kind: 'struggling', share: 0.25, skill: 0.46, keen: 0.35 },
];
function profileFor(i, cls) {
  if (i >= 18) return { kind: 'rarely here', skill: 0.5, keen: 0.04 };   // two per class barely log in
  const r = (i + 0.5) / 18;
  let acc = 0;
  const p = PROFILES.find((x) => { acc += x.share; return r <= acc; }) || PROFILES[1];
  return {
    kind: p.kind,
    skill: clamp(p.skill + cls.skill + (rnd() - 0.5) * 0.12, 0.25, 0.95),
    keen: clamp(p.keen + cls.keen + (rnd() - 0.5) * 0.15, 0.05, 0.95),
  };
}

// ---------------------------------------------------------------- answers

/** Quiz answers: right with probability p, otherwise a wrong option. */
async function quizAnswers(questionIds, p) {
  const rows = await query(
    `SELECT id, correct_answer AS correct,
            ARRAY_REMOVE(ARRAY[CASE WHEN option_a IS NOT NULL THEN 'a' END, CASE WHEN option_b IS NOT NULL THEN 'b' END,
                               CASE WHEN option_c IS NOT NULL THEN 'c' END, CASE WHEN option_d IS NOT NULL THEN 'd' END,
                               CASE WHEN option_e IS NOT NULL THEN 'e' END], NULL) AS letters
       FROM questions WHERE id = ANY($1)`,
    [questionIds],
  );
  return Object.fromEntries(rows.map((q) => [q.id,
    chance(p) ? q.correct : pick(q.letters.filter((l) => l !== q.correct))]));
}

/** Game answers of every kind, each item right with probability p. */
function gameAnswers(game, p) {
  const c = game.content;
  const t = (piece) => token(game.id, piece);
  switch (game.kind) {
    case 'matching':
      return Object.fromEntries(c.pairs.map((_, i) => [t(`l${i}`),
        chance(p) ? t(`r${i}`) : t(`r${(i + 1) % c.pairs.length}`)]));
    case 'drag_drop':
      return Object.fromEntries(c.items.map((it, i) => [t(`i${i}`),
        chance(p) ? it.bucket : pick(c.buckets.filter((b) => b !== it.bucket))]));
    case 'memory': {
      const moves = [];
      c.pairs.forEach((_, i) => {
        while (!chance(clamp(p, 0.3, 0.95))) moves.push([t(`a${i}`), t(`b${(i + 1) % c.pairs.length}`)]);
        moves.push([t(`a${i}`), t(`b${i}`)]);
      });
      return { moves };
    }
    case 'parsons': {
      const program = c.lines.map((l, i) => ({ id: t(`p${i}`), indent: l.indent }));
      if (!chance(p) && program.length > 2) {
        const i = Math.floor(rnd() * (program.length - 1));
        [program[i], program[i + 1]] = [program[i + 1], program[i]];
      }
      if (!chance(p) && c.distractors.length) program.push({ id: t('x0'), indent: 0 });
      return { program };
    }
    case 'predict':
      return Object.fromEntries(c.items.map((it, i) => [t(`o${i}`), chance(p) ? it.output : '?']));
    case 'bughunt':
      return Object.fromEntries(c.items.map((it, i) => {
        const lines = it.code.split('\n').length;
        const lineOk = chance(p);
        return [t(`b${i}`), {
          line: lineOk ? it.bugLine : ((it.bugLine % lines) + 1),
          fix: lineOk && chance(p) ? t(`b${i}f${it.fix}`) : t(`b${i}f${(it.fix + 1) % it.fixes.length}`),
        }];
      }));
    case 'fillblank':
      return Object.fromEntries(c.items.map((it, i) => [t(`f${i}`),
        it.blanks.map((b) => (chance(p) ? b : pick(it.decoys)))]));
    case 'bugcatch': {
      const bc = registry.bugcatch;
      return Object.fromEntries(c.items.map((it, i) => [t(`c${i}`), bc.bestSet(it).map((k) => {
        const options = bc.optionsFor(it, k);
        const right = options.indexOf(it.outputs[k]);
        return { input: t(`c${i}n${k}`), expect: t(`c${i}n${k}o${chance(p) ? right : (right + 1) % options.length}`) };
      })]));
    }
    case 'trace':
      return Object.fromEntries(c.items.flatMap((it, i) => it.steps.map((s, k) => [t(`t${i}s${k}`),
        chance(p) ? s.value : '0'])));
    default:
      return {};
  }
}

const FIRST_HINT_ITEM = {
  parsons: () => 'program', predict: (g) => token(g.id, 'o0'), bughunt: (g) => token(g.id, 'b0'),
  bugcatch: (g) => token(g.id, 'c0'), trace: (g) => token(g.id, 't0s1'),
};

// ---------------------------------------------------------------- time

/**
 * Everything a step wrote is dated to the simulated moment: attempts through
 * answeredAt, the rest by moving their timestamps, so review dates, streaks
 * and XP fall on the right days.
 */
async function backdate(studentId, stepStart, lastResponseId, at) {
  await query(
    'UPDATE responses SET created_at = $3 WHERE student_id = $1 AND id > $2', [studentId, lastResponseId, at],
  );
  await query(
    `UPDATE concept_mastery
        SET last_seen = $3,
            mastered_at = CASE WHEN mastered_at >= $2 THEN $3 ELSE mastered_at END,
            next_review = CASE WHEN next_review IS NOT NULL THEN $3::timestamptz + review_interval * interval '1 day' END
      WHERE student_id = $1 AND last_seen >= $2`,
    [studentId, stepStart, at],
  );
  await query('UPDATE checkpoint_attempts SET created_at = $3 WHERE student_id = $1 AND created_at >= $2', [studentId, stepStart, at]);
  await query('UPDATE game_hints SET created_at = $3 WHERE student_id = $1 AND created_at >= $2', [studentId, stepStart, at]);
}

// ---------------------------------------------------------------- one student

const gameCache = new Map();
async function gameById(id) {
  if (!gameCache.has(id)) gameCache.set(id, await queryOne('SELECT id, kind, content FROM games WHERE id = $1', [id]));
  return gameCache.get(id);
}

/** One activity: the next brick on the pyramid, or a practice session. */
async function act(student, at, tries) {
  const studentId = student.id;
  const stepStart = new Date();
  const lastResponse = (await queryOne('SELECT COALESCE(MAX(id), 0)::int AS id FROM responses WHERE student_id = $1', [studentId])).id;
  const answeredAt = at.toISOString();
  // A little better each time the same brick comes round again.
  const skill = (key) => clamp(student.skill + 0.07 * (tries.get(key) || 0) + (rnd() - 0.5) * 0.15, 0.05, 0.98);

  if (chance(0.22)) {
    // Adaptive practice: five questions.
    const seen = [];
    for (let n = 0; n < 5; n += 1) {
      // eslint-disable-next-line no-await-in-loop
      const pick5 = await nextPracticeQuestion(studentId, seen);
      if (!pick5) break;
      seen.push(pick5.question.id);
      // eslint-disable-next-line no-await-in-loop
      const [answer] = Object.values(await quizAnswers([pick5.question.id], skill('practice')));
      // eslint-disable-next-line no-await-in-loop
      await answerPractice({ studentId, questionId: pick5.question.id, answer });
    }
  } else {
    const { next } = await pathFor(studentId);
    if (!next) return false;
    const key = `${next.type}${next.id}:${next.lesson ?? ''}`;
    const p = skill(key);
    tries.set(key, (tries.get(key) || 0) + 1);

    if (next.type === 'quiz') {
      const ids = next.lesson
        ? (await lessonsFor(next.id))[next.lesson - 1].questionIds
        : (await query('SELECT id FROM questions WHERE quiz_id = $1', [next.id])).map((q) => q.id);
      await markQuizAttempt({
        quizId: next.id, studentId, answers: await quizAnswers(ids, p), answeredAt, lesson: next.lesson ?? null,
      });
    } else if (next.type === 'game') {
      const game = await gameById(next.id);
      const clientAttemptId = crypto.randomUUID();
      if (FIRST_HINT_ITEM[game.kind] && chance(student.kind === 'strong' ? 0.1 : 0.35)) {
        await giveHint({
          gameId: game.id, studentId, clientAttemptId, item: FIRST_HINT_ITEM[game.kind](game), level: 1,
        }).catch(() => {});
      }
      await markGameAttempt({
        gameId: game.id, studentId, answers: gameAnswers(game, p), clientAttemptId, answeredAt,
      });
    } else if (next.type === 'checkpoint') {
      const cp = await startCheckpoint(studentId, next.id);
      await finishCheckpoint({
        studentId, topicId: next.id, ticket: cp.ticket, answers: await quizAnswers(cp.questions.map((q) => q.id), p),
      });
    }
  }
  await backdate(studentId, stepStart, lastResponse, at);
  return true;
}

/** Three weeks of one student, day by day. */
async function live(student) {
  const tries = new Map();
  const now = Date.now();
  let count = 0;
  for (let d = DAYS - 1; d >= 0; d -= 1) {
    const day = new Date(now - d * 86400000);
    const weekday = new Date(`${dayOf(day)}T00:00:00Z`).getUTCDay();
    const keen = [0, 6].includes(weekday) ? student.keen * 0.3 : student.keen;
    if (!chance(keen)) continue;
    const activities = 1 + Math.floor(rnd() * (student.kind === 'strong' ? 4 : 3));
    // After school, India time: 15:30 onwards, a few minutes apart.
    const start = new Date(`${dayOf(day)}T10:00:00Z`).getTime() + Math.floor(rnd() * 4 * 3600000);
    for (let a = 0; a < activities; a += 1) {
      const at = new Date(Math.min(start + a * 9 * 60000, now - 60000));
      // eslint-disable-next-line no-await-in-loop
      if (!(await act(student, at, tries))) return count;
      count += 1;
    }
  }
  return count;
}

// ---------------------------------------------------------------- the classes

const email = (first, last, n = '') => `${first}.${last}${n}@${DOMAIN}`.toLowerCase();

async function remove() {
  await query('DELETE FROM classes WHERE name = ANY($1)', [CLASSES.map((c) => c.name)]);
  const gone = await query(`DELETE FROM users WHERE email LIKE $1 RETURNING id`, [`%@${DOMAIN}`]);
  console.log(`Removed ${gone.length} demo account(s) and their classes.`);
}

async function create() {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const used = new Set();
  const summary = [];

  for (const [ci, cls] of CLASSES.entries()) {
    const [tf, tl, title] = cls.teacher;
    const teacherId = (await queryOne(
      `INSERT INTO users (email, password_hash, name, role, school_id)
       VALUES ($1, $2, $3, 'teacher', 'school_001') RETURNING id`,
      [email(tf, tl), hash, `${title} ${tf} ${tl}`],
    )).id;
    const classId = (await queryOne(
      "INSERT INTO classes (name, teacher_id, school_id) VALUES ($1, $2, 'school_001') RETURNING id",
      [cls.name, teacherId],
    )).id;

    const students = [];
    for (let i = 0; i < 20; i += 1) {
      let first; let last;
      do { first = pick(FIRST); last = pick(LAST); } while (used.has(`${first} ${last}`));
      used.add(`${first} ${last}`);
      const id = (await queryOne(
        `INSERT INTO users (email, password_hash, name, role, school_id)
         VALUES ($1, $2, $3, 'student', 'school_001') RETURNING id`,
        [email(first, last, ci + 1), hash, `${first} ${last}`],
      )).id;
      await query('INSERT INTO class_students (class_id, student_id) VALUES ($1, $2)', [classId, id]);
      students.push({ id, name: `${first} ${last}`, email: email(first, last, ci + 1), ...profileFor(i, cls) });
    }

    let activities = 0;
    for (const s of students) {
      // eslint-disable-next-line no-await-in-loop
      activities += await live(s);
      process.stdout.write('.');
    }
    summary.push({ cls: cls.name, teacher: email(tf, tl), students: students.length, activities, sample: students[0].email });
    process.stdout.write(`\n${cls.name}: ${activities} activities\n`);
  }

  console.log('\nDemo classes ready. Every account signs in with the password: password123');
  summary.forEach((s) => console.log(`  ${s.cls}: teacher ${s.teacher} · 20 students, e.g. ${s.sample}`));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--remove') || args.includes('--reset')) await remove();
  if (args.includes('--remove')) return;

  const there = await queryOne('SELECT COUNT(*)::int AS n FROM classes WHERE name = ANY($1)', [CLASSES.map((c) => c.name)]);
  if (there.n > 0) {
    console.log('Demo classes already exist; nothing to do. Use --reset to make them again.');
    return;
  }
  const quizzes = await queryOne('SELECT COUNT(*)::int AS n FROM questions');
  if (!quizzes.n) {
    console.log('No questions loaded yet; import the content before seeding demo classes.');
    return;
  }
  await create();
}

if (require.main === module) {
  main()
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(() => pool.end());
}

module.exports = { CLASSES, DOMAIN };
