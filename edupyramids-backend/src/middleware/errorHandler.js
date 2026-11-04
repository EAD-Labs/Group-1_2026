/* eslint-disable no-unused-vars */

// PostgreSQL's refusals of a value it was sent: not a number, too big for its
// column, or too long. Every value reaches the database as a parameter, so
// these only ever come from what the caller sent.
const BAD_VALUE = {
  '22P02': 'That value is not valid',
  22003: 'That number is out of range',
  22001: 'That value is too long',
};

/**
 * Last middleware in the stack. Express only treats a four-argument function as
 * an error handler, so `next` stays in the signature even though it is unused.
 */
function errorHandler(err, req, res, next) {
  const badValue = BAD_VALUE[err.code];
  const status = err.status || (badValue ? 400 : 500);

  // The full error goes to the log; the client gets a sentence. Stack traces
  // and database messages leak table names and query shapes.
  console.error(`[error] ${req.method} ${req.originalUrl}`, err);

  res.status(status).json({
    error: status === 500 ? 'Something went wrong' : badValue || err.message,
  });
}

function notFound(req, res) {
  res.status(404).json({ error: 'No such endpoint' });
}

module.exports = errorHandler;
module.exports.notFound = notFound;
