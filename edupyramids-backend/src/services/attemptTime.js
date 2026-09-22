/*
 * When an attempt made offline was actually finished.
 *
 * A device that was offline uploads its attempts later, and the class report
 * should show them on the day they were done, not the day the tablet next saw
 * a network. The client's clock is only trusted within limits: nothing in the
 * future, nothing older than 30 days. Outside those, the upload time is used.
 */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const SKEW_MS = 5 * 60 * 1000;

function attemptTime(answeredAt, now = Date.now()) {
  if (typeof answeredAt !== 'string') return null;
  const t = Date.parse(answeredAt);
  if (Number.isNaN(t) || t > now + SKEW_MS || t < now - MAX_AGE_MS) return null;
  return new Date(t);
}

module.exports = { attemptTime };
