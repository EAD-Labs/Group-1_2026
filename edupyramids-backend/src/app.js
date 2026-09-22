const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const logger = require('./middleware/logger');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Behind a proxy req.ip is the proxy without this, and the login throttle keys
// on the caller's address.
app.set('trust proxy', 1);

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(logger);

// Not one of the eleven: a liveness check for deployment.
app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/quizzes', require('./routes/quizzes'));
app.use('/api/games', require('./routes/games'));
app.use('/api/progress', require('./routes/progress'));
app.use('/api/classes', require('./routes/classes'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/school', require('./routes/school'));
app.use('/api/practice', require('./routes/practice'));
app.use('/api/content', require('./routes/content'));

/*
 * The built interface, served from the same origin as the API.
 *
 * One origin means the browser never makes a cross-origin request, so a tunnel
 * or a deploy needs one address rather than two kept in step. Skipped entirely
 * when there is no build, which is the case while Vite is serving on 5173.
 */
const distDir = process.env.STATIC_DIR
  || path.join(__dirname, '..', '..', 'edupyramids-frontend', 'dist');

if (fs.existsSync(path.join(distDir, 'index.html'))) {
  // Hashed filenames change whenever their contents change, so the assets
  // themselves can be cached hard. index.html must not be: a cached copy goes
  // on naming the previous build's hashes long after those files are gone.
  app.use(express.static(distDir, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  }));

  // Every other path belongs to React Router, which decides it in the browser.
  // The negative lookahead keeps /api/nonsense a real 404 rather than handing
  // back index.html and letting the client parse HTML as JSON.
  app.get(/^(?!\/api\/).*/, (req, res, next) => {
    // A missing file is a 404, not the app. Answering a request for
    // /assets/main.js with index.html gives the browser HTML where it expects
    // JavaScript; it refuses to run it, and the page renders blank with no
    // failed request to show for it. That is what a stale index.html asking
    // for a deleted hash looks like, so it has to fail loudly instead.
    if (path.extname(req.path)) return next();
    return res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.use(errorHandler.notFound);
app.use(errorHandler);

module.exports = app;
