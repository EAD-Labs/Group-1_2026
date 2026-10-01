const express = require('express');
const { captionsFor, VideoError } = require('../services/videoService');

const router = express.Router();

/**
 * GET /api/videos/:slug/captions.vtt — a lesson's captions, as WebVTT.
 *
 * Open to anyone: a <track> element cannot send a sign-in token, and these are
 * Spoken Tutorial's public subtitles (CC BY-SA 4.0). Only the lessons listed
 * in content/spoken-tutorial-videos.json can be asked for, so this can never
 * be used to fetch any other address.
 */
router.get('/:slug/captions.vtt', async (req, res, next) => {
  try {
    const vtt = await captionsFor(req.params.slug);
    res.set('Content-Type', 'text/vtt; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=86400');
    return res.send(vtt);
  } catch (err) {
    if (err instanceof VideoError) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
});

module.exports = router;
