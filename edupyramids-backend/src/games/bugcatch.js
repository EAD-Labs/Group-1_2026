const {
  token, shuffle, isText, checker, GameError,
} = require('./common');

/*
 * Bug Catcher: testing as the game (after Code Critters, Straubinger et al.).
 *
 * The student sees a working function and is told that bugged copies of it
 * are hiding. They choose test inputs and, for each, the output the working
 * function gives. A test catches every copy that answers differently, but
 * only if the student's expected output is right: a test with a wrong
 * expectation proves nothing. So the game is two skills at once, tracing
 * (what should this return?) and testing (which input tells them apart?).
 *
 * Every output comes from running real Python (scripts/run-python-games.py),
 * never from typing. Test slots are limited to par + 1, where par is the
 * fewest inputs that catch every copy; matching par is part of three stars.
 *
 * answers: { [itemId]: [{ input: inputId, expect: optionId }, ...] }
 */

const MAX_OPTIONS = 4;

/** Every output a student could expect for input k: the right one, each copy's, then others from the item. */
function optionsFor(item, k) {
  const list = [item.outputs[k], ...item.mutants.map((m) => m.outputs[k])];
  for (const out of item.outputs) list.push(out);
  const unique = [...new Set(list)];
  const needed = new Set([item.outputs[k], ...item.mutants.map((m) => m.outputs[k])]).size;
  return unique.slice(0, Math.max(3, Math.min(MAX_OPTIONS, needed)));
}

/** Inputs that tell copy m apart from the working function. */
const catchers = (item, m) => item.inputs.map((_, k) => k).filter((k) => item.mutants[m].outputs[k] !== item.outputs[k]);

/** The fewest inputs that catch every copy. Inputs are few, so trying every set is cheap. */
function bestSet(item) {
  const n = item.inputs.length;
  const all = item.inputs.map((_, k) => k);
  let best = all;
  for (let mask = 1; mask < (1 << n); mask += 1) {
    const set = all.filter((k) => mask & (1 << k));
    if (set.length < best.length && item.mutants.every((_, m) => catchers(item, m).some((k) => set.includes(k)))) best = set;
  }
  return best;
}

const parOf = (item) => bestSet(item).length;

/** Lines of a bugged copy that the working function does not have: where the bug is. */
function changedLines(code, original) {
  const have = new Set(original.split('\n'));
  return code.split('\n').map((line, n) => (have.has(line) ? null : n)).filter((n) => n !== null);
}

const slotsOf = (item) => Math.min(item.inputs.length, parOf(item) + 1);
const callText = (item, k) => `${item.call}(${item.inputs[k]})`;

module.exports = {
  kind: 'bugcatch',
  label: 'Bug Catcher',
  optionsFor,
  parOf,
  bestSet,
  changedLines,

  validate(game, at) {
    const c = checker(at, game.title);
    if (!Array.isArray(game.items) || game.items.length < 1) {
      c.error('needs at least one function');
      return c;
    }
    game.items.forEach((it, i) => {
      const where = `.items[${i}]`;
      if (!it || !isText(it.code) || !isText(it.call)) { c.error('"code" and "call" are required', where); return; }
      if (!Array.isArray(it.inputs) || it.inputs.length < 2 || it.inputs.length > 6 || !it.inputs.every(isText)) {
        c.error('"inputs" needs 2 to 6 argument lists', where);
        return;
      }
      if (!Array.isArray(it.outputs) || it.outputs.length !== it.inputs.length) {
        c.error('"outputs" is missing or out of date: run scripts/run-python-games.py', where);
        return;
      }
      if (!Array.isArray(it.mutants) || it.mutants.length < 1 || it.mutants.length > 4) {
        c.error('"mutants" needs 1 to 4 bugged copies', where);
        return;
      }
      it.mutants.forEach((m, j) => {
        const w = `${where}.mutants[${j}]`;
        if (!m || !isText(m.code) || !isText(m.bug)) c.error('"code" and "bug" are required', w);
        else if (!Array.isArray(m.outputs) || m.outputs.length !== it.inputs.length) {
          c.error('"outputs" is missing or out of date: run scripts/run-python-games.py', w);
        } else if (!catchers(it, j).length) c.error('no input catches this copy: add an input that does', w);
      });
      if (!isText(it.task)) c.warn('no task: say what the function is meant to do', where);
      if (!isText(it.hint)) c.warn('no hint', where);
    });
    return c;
  },

  contentOf: (game) => ({ items: game.items }),

  deliver: (game) => ({
    items: game.content.items.map((it, i) => ({
      id: token(game.id, `c${i}`),
      code: it.code,
      task: it.task ?? null,
      bugs: it.mutants.length,
      slots: slotsOf(it),
      par: parOf(it),
      inputs: it.inputs.map((inp, k) => ({
        id: token(game.id, `c${i}n${k}`),
        call: callText(it, k),
        options: shuffle(optionsFor(it, k).map((text, j) => ({ id: token(game.id, `c${i}n${k}o${j}`), text }))),
      })),
    })),
  }),

  /** What the device needs to mark offline, in the same tokens the browser sends. */
  offlineKey(game) {
    return {
      items: Object.fromEntries(game.content.items.map((it, i) => [token(game.id, `c${i}`), {
        call: Object.fromEntries(it.inputs.map((_, k) => [token(game.id, `c${i}n${k}`), callText(it, k)])),
        // The option that is the working function's output, per input.
        right: Object.fromEntries(it.inputs.map((_, k) => [
          token(game.id, `c${i}n${k}`),
          token(game.id, `c${i}n${k}o${optionsFor(it, k).indexOf(it.outputs[k])}`),
        ])),
        inputs: it.inputs.map((_, k) => token(game.id, `c${i}n${k}`)),
        mutants: it.mutants.map((m, j) => ({
          code: m.code,
          bug: m.bug,
          catches: catchers(it, j).map((k) => token(game.id, `c${i}n${k}`)),
          outputs: Object.fromEntries(it.inputs.map((_, k) => [token(game.id, `c${i}n${k}`), m.outputs[k]])),
        })),
        slots: slotsOf(it),
        par: parOf(it),
      }])),
    };
  },

  hint(game, itemId, level) {
    const i = game.content.items.findIndex((_, n) => token(game.id, `c${n}`) === itemId);
    if (i < 0) throw new GameError('No such function in this game');
    const it = game.content.items[i];
    if (level === 1) return { text: it.hint || 'Think about the smallest inputs and the edges of each rule.', maxLevel: 2 };
    // The input that catches the most copies.
    const k = it.inputs.map((_, n) => n)
      .sort((a, b) => it.mutants.filter((_, m) => catchers(it, m).includes(b)).length
        - it.mutants.filter((_, m) => catchers(it, m).includes(a)).length)[0];
    return { text: `Try ${callText(it, k)}. Work out what the working function returns for it.`, maxLevel: 2 };
  },

  mark(game, answers) {
    let score = 0;
    let maxScore = 0;
    let parMet = true;
    const feedback = [];
    const tests = [];

    game.content.items.forEach((it, i) => {
      const inputOf = new Map(it.inputs.map((_, k) => [token(game.id, `c${i}n${k}`), k]));
      const seen = new Set();
      const chosen = (Array.isArray(answers[token(game.id, `c${i}`)]) ? answers[token(game.id, `c${i}`)] : [])
        .filter((t) => t && inputOf.has(t.input) && !seen.has(t.input) && seen.add(t.input))
        .slice(0, slotsOf(it))
        .map((t) => {
          const k = inputOf.get(t.input);
          const options = optionsFor(it, k);
          const j = options.findIndex((_, n) => token(game.id, `c${i}n${k}o${n}`) === t.expect);
          return { k, expected: j >= 0 ? options[j] : null, ok: j >= 0 && options[j] === it.outputs[k] };
        });

      chosen.forEach((t) => tests.push({
        call: callText(it, t.k), expected: t.expected, right: it.outputs[t.k], ok: t.ok,
      }));

      let caughtAll = true;
      it.mutants.forEach((m, j) => {
        const by = chosen.find((t) => t.ok && m.outputs[t.k] !== it.outputs[t.k]);
        if (by) score += 1; else caughtAll = false;
        feedback.push({
          prompt: m.code,
          given: by ? `Caught by ${callText(it, by.k)}` : null,
          answer: `${callText(it, catchers(it, j)[0])} catches it: the copy gives ${m.outputs[catchers(it, j)[0]]}, the working function ${it.outputs[catchers(it, j)[0]]}`,
          correct: Boolean(by),
          changed: changedLines(m.code, it.code),
          explanation: m.bug,
        });
      });
      maxScore += it.mutants.length;
      if (!caughtAll || chosen.length > parOf(it)) parMet = false;
    });

    return { feedback, score, maxScore, extra: { tests, parMet } };
  },
};
