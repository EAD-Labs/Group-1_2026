/**
 * One line per request, written when the response finishes so it can carry the
 * status and the duration.
 *
 * Bodies are never logged. The login body holds a password, and a log file is
 * the last place it should end up.
 */
function logger(req, res, next) {
  const started = process.hrtime.bigint();

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    console.log(
      `${new Date().toISOString()}  ${req.method} ${req.originalUrl} ` +
      `${res.statusCode} ${ms.toFixed(1)}ms`,
    );
  });

  next();
}

module.exports = logger;
