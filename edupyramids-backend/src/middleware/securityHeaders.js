/*
 * Basic security headers on every response.
 *
 * Written out rather than taken from helmet: five headers, one fewer
 * dependency to keep patched. Framing is deliberately left alone, so the
 * client can show the app inside their own site; nginx can add
 * frame-ancestors once they know which pages will embed it.
 *
 * - nosniff: the browser never runs an upload or a JSON reply as a script.
 * - Referrer-Policy: other sites (the Spoken Tutorial videos included) see
 *   only our origin, never a page address.
 * - Permissions-Policy: nothing here needs the camera, microphone or location.
 * - Cross-Origin-Opener-Policy: a page opened from ours cannot reach back in.
 * - Strict-Transport-Security, on HTTPS only: once seen, the browser keeps to
 *   HTTPS for this host. Not for subdomains, which the app does not own.
 */
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
}

module.exports = securityHeaders;
