import { client } from '../api/client';
import { read, write, remove, announce } from './store';

/*
 * The offline pack: every quiz and game, with the keys to mark them.
 *
 * Opt-in. It is only downloaded after a student turns offline use on, because
 * it puts the answers on the device. While it is on, it refreshes itself when
 * the app starts online, downloading again only if the content has changed.
 */
const PACK = 'offline.pack';
const ENABLED = 'offline.enabled';

export const isEnabled = () => read(ENABLED, false) === true;
export const getPack = () => read(PACK);

export function info() {
  const pack = getPack();
  if (!pack) return null;
  let bytes = 0;
  try { bytes = JSON.stringify(pack).length; } catch { /* unknown */ }
  return {
    version: pack.version,
    savedAt: pack.savedAt,
    quizzes: pack.quizzes.length,
    games: pack.games.length,
    kb: Math.round(bytes / 1024),
  };
}

/** Download, or refresh, the pack. Returns 'updated', 'unchanged' or throws. */
export async function download() {
  const have = getPack()?.version;
  const res = await client.get(`/offline/pack${have ? `?have=${have}` : ''}`);
  if (res.unchanged) {
    write(PACK, { ...getPack(), savedAt: new Date().toISOString() });
    announce();
    return 'unchanged';
  }
  if (!write(PACK, { ...res.data, savedAt: new Date().toISOString() })) {
    throw new Error('This device has no room to store the questions for offline use.');
  }
  announce();
  return 'updated';
}

export async function enable() {
  write(ENABLED, true);
  try {
    return await download();
  } catch (err) {
    write(ENABLED, false);
    throw err;
  }
}

export function disable() {
  write(ENABLED, false);
  remove(PACK);
  announce();
}

/** Refresh quietly when the app starts online. */
export function refreshInBackground() {
  if (isEnabled() && navigator.onLine) download().catch(() => {});
}

/** A downloaded quiz, or one lesson of it: the same quiz with only that lesson's questions. */
export function findQuiz(id, lesson = null) {
  const quiz = getPack()?.quizzes.find((q) => q.id === Number(id)) ?? null;
  if (!quiz || !lesson) return quiz;
  const one = quiz.lessons?.[lesson - 1];
  if (!one) return null;
  const byId = new Map(quiz.questions.map((q) => [q.id, q]));
  return {
    ...quiz,
    lesson: { index: one.index, count: quiz.lessons.length, title: one.title },
    questions: one.questionIds.map((qid) => byId.get(qid)).filter(Boolean),
  };
}

export function findGame(id) {
  return getPack()?.games.find((g) => g.id === Number(id)) ?? null;
}

/** A quiz as the quiz page shows it: the questions without their answers. */
export function quizForPlay(quiz) {
  return {
    ...quiz,
    questions: quiz.questions.map(({ correct, explanation, ...q }) => q),
  };
}
