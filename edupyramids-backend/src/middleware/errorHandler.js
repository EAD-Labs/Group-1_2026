/* eslint-disable no-unused-vars */

/**
 * Last middleware in the stack. Express only treats a four-argument function as
 * an error handler, so `next` stays in the signature even though it is unused.
 */
function errorHandler(err, req, res, next) {
  const status = err.status || 500;

  // The full error goes to the log; the client gets a sentence. Stack traces
  // and database messages leak table names and query shapes.
  console.error(`[error] ${req.method} ${req.originalUrl}`, err);

  res.status(status).json({
    error: status === 500 ? 'Something went wrong' : err.message,
  });
}

function notFound(req, res) {
  res.status(404).json({ error: 'No such endpoint' });
}

module.exports = errorHandler;
module.exports.notFound = notFound;
