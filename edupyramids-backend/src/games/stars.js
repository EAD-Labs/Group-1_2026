/*
 * Stars, the same for every game kind.
 *
 *   one   60% or more: a floor every student can reach
 *   two   everything right
 *   three everything right with no hints, and at or under par where the kind
 *         has one (fewest tests in Bug Catcher)
 *
 * The third star is the stretch goal for students who find the level easy,
 * after the optional optimisation goals in Human Resource Machine; hints are
 * there for everyone else and only ever cost that star.
 */
function starsFor({ score, maxScore, hintsUsed = 0, parMet = true }) {
  const ratio = maxScore > 0 ? score / maxScore : 0;
  if (ratio < 0.6) return 0;
  if (ratio < 1) return 1;
  return hintsUsed === 0 && parMet !== false ? 3 : 2;
}

module.exports = { starsFor };
