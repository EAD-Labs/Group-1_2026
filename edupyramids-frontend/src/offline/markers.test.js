/*
 * The device's marking must agree with the server's, for every game in the
 * content file and for right, wrong and partial answers alike.
 *
 *   node --test src/offline
 *
 * The server's game modules are loaded straight from the backend folder, so
 * this compares against the real marking code, not a copy of it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  markGame, checkMemory, checkTrace, starsFor,
} from './markers.js';

process.env.JWT_SECRET ||= 'offline-parity-test';
const require = createRequire(import.meta.url);
const { registry } = require('../../../edupyramids-backend/src/games');
const serverStars = require('../../../edupyramids-backend/src/games/stars').starsFor;
const content = require('../../../edupyramids-backend/content/python-games.json');

// Every game in the file, as the server holds it and as the device receives it.
const games = content.flatMap((t) => t.games).map((g, i) => {
  const kind = registry[g.kind];
  const server = { id: i + 1, kind: g.kind, title: g.title, topic: 'T', content: kind.contentOf(g) };
  const device = { id: server.id, kind: g.kind, title: g.title, topic: 'T', ...kind.deliver(server), key: kind.offlineKey(server) };
  return { server, device, kind };
});

// A seeded random source, so a failure can be reproduced.
function random(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}
const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];

/** A plausible answer, from perfect to mostly wrong, built from what the device sees. */
function answerFor(d, rnd, rightness) {
  const right = () => rnd() < rightness;
  switch (d.kind) {
    case 'matching':
      return Object.fromEntries(d.lefts.map((l) => [l.id, right() ? d.key.answer[l.id] : pick(rnd, d.rights).id]));
    case 'drag_drop':
      return Object.fromEntries(d.items.filter(() => rnd() > 0.1)
        .map((it) => [it.id, right() ? d.key.bucket[it.id] : pick(rnd, d.buckets)]));
    case 'memory': {
      const tiles = Object.keys(d.key.pairOf);
      const moves = [];
      for (let k = 0; k < tiles.length * 2; k += 1) moves.push([pick(rnd, tiles), pick(rnd, tiles)]);
      return { moves };
    }
    case 'parsons': {
      const ids = right() ? d.key.solution.map((s) => s.id) : d.blocks.map((b) => b.id).sort(() => rnd() - 0.5);
      return { program: ids.map((id) => ({ id, indent: Math.floor(rnd() * 3) })) };
    }
    case 'predict':
      return Object.fromEntries(d.items.map((it) => [it.id, right() ? `${d.key.output[it.id]}  \n` : 'nope']));
    case 'bughunt':
      return Object.fromEntries(d.items.map((it) => [it.id, {
        line: right() ? d.key.bugLine[it.id] : 1 + Math.floor(rnd() * it.lines.length),
        fix: right() ? d.key.fix[it.id] : pick(rnd, it.fixes).id,
      }]));
    case 'fillblank':
      return Object.fromEntries(d.items.map((it) => [it.id,
        d.key.blanks[it.id].map((b) => (right() ? b : pick(rnd, it.chips)))]));
    case 'bugcatch':
      // Random inputs, some with the right expectation, some repeated, some past the slot limit.
      return Object.fromEntries(d.items.map((it) => [it.id, Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => {
        const input = pick(rnd, it.inputs);
        return { input: input.id, expect: right() ? d.key.items[it.id].right[input.id] : pick(rnd, input.options).id };
      })]));
    case 'trace':
      return Object.fromEntries(d.items.flatMap((it) => it.steps.filter(() => rnd() > 0.1)
        .map((s) => [s.id, right() ? ` ${d.key.shown[s.id].replace(/'/g, '"')}` : pick(rnd, ['0', "'x'", '[]'])])));
    default:
      throw new Error(`no answer builder for ${d.kind}`);
  }
}

const essentials = (r) => ({
  score: r.score,
  maxScore: r.maxScore,
  parMet: r.parMet ?? r.extra?.parMet,
  bestStreak: r.bestStreak ?? r.extra?.bestStreak,
  feedback: r.feedback.map((f) => ({
    prompt: f.prompt, given: f.given, answer: f.answer, correct: f.correct, changed: f.changed,
  }))
    .sort((a, b) => String(a.prompt).localeCompare(String(b.prompt))),
});

test('every kind in the file can be marked on the device', () => {
  assert.deepEqual(new Set(games.map((g) => g.device.kind)), new Set(Object.keys(registry)));
});

for (const { server, device, kind } of games) {
  test(`${device.kind} "${device.title}": the device marks exactly as the server does`, () => {
    const rnd = random(server.id * 7919);
    for (const rightness of [1, 0.7, 0.3, 0]) {
      for (let run = 0; run < 5; run += 1) {
        const answers = answerFor(device, rnd, rightness);
        const onServer = kind.mark(server, answers);
        const onDevice = markGame(device, answers);
        assert.deepEqual(essentials(onDevice), essentials(onServer), `rightness ${rightness}, run ${run}`);
        assert.equal(onDevice.stars, serverStars({ ...onServer, parMet: onServer.extra?.parMet }));
      }
    }
    assert.deepEqual(essentials(markGame(device, {})), essentials(kind.mark(server, {})), 'empty answer');
  });
}

test('a trace check on the device agrees with the server', () => {
  for (const { server, device, kind } of games.filter((g) => g.device.kind === 'trace')) {
    for (const s of device.items.flatMap((it) => it.steps)) {
      for (const value of [device.key.shown[s.id], ` ${device.key.shown[s.id].replace(/'/g, '"')} `, 'nope']) {
        assert.deepEqual(checkTrace(device, s.id, value), kind.check(server, { step: s.id, value }));
      }
    }
  }
});

test('the device gives the same stars as the server', () => {
  for (const input of [
    { score: 5, maxScore: 10 }, { score: 6, maxScore: 10 }, { score: 10, maxScore: 10 },
    { score: 10, maxScore: 10, hintsUsed: 2 }, { score: 10, maxScore: 10, parMet: false },
  ]) assert.equal(starsFor(input), serverStars(input));
});

test('a memory check on the device agrees with the server', () => {
  for (const { server, device, kind } of games.filter((g) => g.device.kind === 'memory')) {
    const tiles = Object.keys(device.key.pairOf);
    for (const a of tiles) {
      for (const b of tiles) {
        assert.deepEqual(checkMemory(device, a, b), kind.check(server, { first: a, second: b }));
      }
    }
  }
});
