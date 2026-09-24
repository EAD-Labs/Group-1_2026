/*
 * Every game kind, in one place.
 *
 * A kind is a module with the same five parts:
 *
 *   kind       the name stored in games.kind
 *   validate   check a game from the content file; returns { errors, warnings }
 *   contentOf  the part of the file entry that is stored as games.content
 *   deliver    what the student's browser receives: shuffled, tokenised, no key
 *   mark       score an answer; returns { feedback, score, maxScore, extra? }
 *   check      optional: an instant check during play (memory, trace)
 *   hint       optional: (game, itemId, level) -> { text, maxLevel, ... }
 *   offlineKey what the device needs to mark with no connection
 *
 * Adding a game kind is a new file here plus a board in the frontend's
 * src/games folder. Nothing else needs to change: the importer, the API and
 * the tests all go through this registry.
 */
const kinds = [
  require('./matching'),
  require('./sort'),
  require('./memory'),
  require('./parsons'),
  require('./predict'),
  require('./bughunt'),
  require('./fillblank'),
  require('./bugcatch'),
  require('./trace'),
];

const registry = Object.fromEntries(kinds.map((k) => [k.kind, k]));

module.exports = {
  registry,
  kindNames: kinds.map((k) => k.kind),
  kindOf: (name) => registry[name] || null,
};
