const { query, queryOne } = require('../config/database');
const { starsFor } = require('../games/stars');
const { quizStars } = require('./xp');

/*
 * XP, the daily goal and the streak.
 *
 * Nothing here is stored as a running total. Everything is worked out from
 * what the student actually did (attempts, checkpoints, practice answers), so
 * an attempt made offline and uploaded days later lands on the day it was
 * done, and no counter can drift from the record.
 *
 * XP rewards learning, not clicking:
 *   finishing a quiz or game   up to 10, in proportion to the score, plus 5
 *                              for each star it adds to the best
 *   replaying at three stars    2, for 60% or more (no grinding)
 *   a checkpoint               20 if passed, 5 for trying
 *   a practice answer           2
 *
 * The streak follows Duolingo's, adjusted for school. One finished activity
 * keeps a day. Weekends never break a streak, but practising on one still
 * counts. Every five active days in a row earns a freeze (at most two), and a
 * freeze covers a missed school day by itself: Duolingo found this slack cut
 * drop-off by a fifth among learners about to lose a streak.
 */

const XP = {
  ...require('./xp').XP, checkpointPass: 20, checkpointTry: 5, practiceAnswer: 2,
};
const { xpForAttempt } = require('./xp');
const GOALS = [10, 20, 30, 50];
const FREEZE_EVERY = 5;
const MAX_FREEZES = 2;
const WEEKEND = new Set([0, 6]);    // Sunday, Saturday
const timeZone = () => process.env.APP_TIMEZONE || 'Asia/Kolkata';

/** The calendar day of a moment, in the school's time zone: "YYYY-MM-DD". */
function dayOf(moment, tz = timeZone()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(moment));
}

const addDays = (day, n) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekday = (day) => new Date(`${day}T00:00:00Z`).getUTCDay();

/** Every XP-earning event for a student, oldest first: [{ day, xp, what }]. */
async function eventsFor(studentId) {
  const [attempts, checkpoints, practice] = await Promise.all([
    query(
      `SELECT kind, quiz_id, game_id, score, max_score, stars, hints_used, created_at
         FROM attempts WHERE student_id = $1 ORDER BY created_at, id`,
      [studentId],
    ),
    query('SELECT passed, created_at FROM checkpoint_attempts WHERE student_id = $1', [studentId]),
    query("SELECT created_at FROM responses WHERE student_id = $1 AND source = 'practice'", [studentId]),
  ]);

  const best = new Map();
  const events = attempts.map((a) => {
    const key = a.kind === 'quiz' ? `q${a.quiz_id}` : `g${a.game_id}`;
    const stars = a.kind === 'quiz'
      ? quizStars(Math.round((a.score / a.max_score) * 100))
      : a.stars ?? starsFor({ score: a.score, maxScore: a.max_score, hintsUsed: a.hints_used });
    const before = best.get(key) ?? 0;
    best.set(key, Math.max(before, stars));
    return { at: a.created_at, xp: xpForAttempt(before, stars, a.score / a.max_score), what: a.kind };
  });
  checkpoints.forEach((c) => events.push({
    at: c.created_at, xp: c.passed ? XP.checkpointPass : XP.checkpointTry, what: 'checkpoint',
  }));
  practice.forEach((p) => events.push({ at: p.created_at, xp: XP.practiceAnswer, what: 'practice' }));

  return events
    .map((e) => ({ ...e, day: dayOf(e.at) }))
    .sort((a, b) => new Date(a.at) - new Date(b.at));
}

/**
 * Walk the calendar from the first active day to today and replay the rules.
 * Today never breaks a streak: it is not over yet.
 */
function streakFrom(activeDays, today) {
  const active = new Set(activeDays);
  const days = [];
  let streak = 0;
  let longest = 0;
  let run = 0;
  let freezes = 0;
  const first = [...active].sort()[0];

  for (let day = first; first && day <= today; day = addDays(day, 1)) {
    let state;
    if (active.has(day)) {
      state = 'active';
      streak += 1;
      run += 1;
      if (run % FREEZE_EVERY === 0) freezes = Math.min(MAX_FREEZES, freezes + 1);
    } else if (day === today) {
      state = 'today';
    } else if (WEEKEND.has(weekday(day))) {
      state = 'weekend';
    } else if (freezes > 0 && streak > 0) {
      state = 'frozen';
      freezes -= 1;
    } else {
      state = 'missed';
      streak = 0;
      run = 0;
    }
    longest = Math.max(longest, streak);
    days.push({ day, state });
  }
  return { streak, longest, freezes, days };
}

/** Everything the Home strip and the Progress page show. */
async function dailyFor(studentId, now = new Date()) {
  const [events, user] = await Promise.all([
    eventsFor(studentId),
    queryOne('SELECT daily_goal AS goal FROM users WHERE id = $1', [studentId]),
  ]);
  const today = dayOf(now);
  const byDay = new Map();
  events.forEach((e) => byDay.set(e.day, (byDay.get(e.day) || 0) + e.xp));

  const { streak, longest, freezes, days } = streakFrom([...byDay.keys()], today);

  // The last seven days, oldest first, whether or not anything happened.
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)).map((day) => {
    const known = days.find((d) => d.day === day);
    return {
      day,
      weekday: weekday(day),
      xp: byDay.get(day) || 0,
      state: known ? known.state : (WEEKEND.has(weekday(day)) ? 'weekend' : day === today ? 'today' : 'none'),
    };
  });

  return {
    goal: user?.goal ?? 20,
    goals: GOALS,
    today: { day: today, xp: byDay.get(today) || 0, done: byDay.has(today) },
    xp: { total: events.reduce((n, e) => n + e.xp, 0), week: week.reduce((n, d) => n + d.xp, 0) },
    streak: { current: streak, longest, freezes, maxFreezes: MAX_FREEZES, freezeEvery: FREEZE_EVERY },
    week,
  };
}

async function setGoal(studentId, goal) {
  if (!GOALS.includes(goal)) {
    const err = new Error(`The daily goal must be one of ${GOALS.join(', ')}`);
    err.status = 400;
    throw err;
  }
  await query('UPDATE users SET daily_goal = $1 WHERE id = $2', [goal, studentId]);
  return dailyFor(studentId);
}

module.exports = {
  dailyFor, setGoal, xpForAttempt, streakFrom, dayOf, XP, GOALS,
};
