const crypto = require('crypto');

/*
 * What every game kind shares.
 *
 * A piece of a game (a card, a tile, a line of code) needs an id the browser
 * can send back. A plain index gives the answer key away, so each piece gets
 * a keyed hash of the game and its place in the content instead. The server
 * recomputes it to mark an answer; the browser cannot work backwards from it.
 */

class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function token(gameId, piece) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET)
    .update(`game:${gameId}:${piece}`)
    .digest('base64url')
    .slice(0, 16);
}

function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const isText = (v) => typeof v === 'string' && v.trim().length > 0;

/** Values that appear more than once, compared as trimmed text. */
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
 * Collects problems while a game kind checks its content, with the path in
 * the file already attached, so each kind only says what is wrong.
 */
function checker(at, title) {
  const errors = [];
  const warnings = [];
  return {
    errors,
    warnings,
    error: (msg, where = '') => errors.push(`${at}${where} (${title}): ${msg}`),
    warn: (msg, where = '') => warnings.push(`${at}${where}: ${msg}`),
  };
}

/** Output as a student would type it: line endings and trailing spaces do not count. */
const normaliseOutput = (s) => String(s ?? '')
  .replace(/\r\n?/g, '\n')
  .split('\n').map((line) => line.replace(/\s+$/, ''))
  .join('\n')
  .replace(/^\n+|\n+$/g, '');

const scoreOf = (feedback, weight = () => 1) => feedback.reduce((n, f) => n + (f.correct ? weight(f) : 0), 0);

module.exports = {
  GameError, token, shuffle, isText, duplicates, checker, normaliseOutput, scoreOf,
};
