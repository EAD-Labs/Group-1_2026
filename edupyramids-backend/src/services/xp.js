/*
 * The XP for one finished quiz or game, given the best stars it had before
 * and the share of marks it got.
 * Kept apart from dailyService so marking can use it without loading the
 * whole daily picture.
 */
const XP = { finish: 10, perNewStar: 5, replay: 2 };

/** A quiz's stars from its score: quizzes have no hints, so percent alone decides. */
function quizStars(percent) {
  if (percent === null || percent === undefined) return 0;
  if (percent >= 100) return 3;
  if (percent >= 80) return 2;
  return percent >= 60 ? 1 : 0;
}

/**
 * Finishing pays in proportion to the score, so pressing Finish on an empty
 * attempt earns nothing; each new star adds more; a replay of something
 * already at three stars earns a little, and only for a real go at it.
 */
function xpForAttempt(starsBefore, starsNow, ratio = 1) {
  if (starsBefore >= 3) return ratio >= 0.6 ? XP.replay : 0;
  return Math.round(XP.finish * Math.max(0, Math.min(1, ratio)))
    + XP.perNewStar * Math.max(0, starsNow - starsBefore);
}

module.exports = { xpForAttempt, quizStars, XP };
