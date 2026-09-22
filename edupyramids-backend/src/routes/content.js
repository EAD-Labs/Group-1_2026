const express = require('express');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { query } = require('../config/database');
const content = require('../services/contentService');
const { GeminiError, isConfigured, model } = require('../services/geminiService');

/*
 * Question generation and review, for teachers and coordinators.
 *
 * Generation calls a paid API and takes several seconds, so it is limited to
 * a few requests a minute per user rather than left open to a double click.
 */
const router = express.Router();
router.use(authMiddleware, requireRole('teacher', 'coordinator'));

const recent = new Map();                       // userId -> [timestamps]
const LIMIT = 5;
const WINDOW_MS = 60_000;

function throttled(userId) {
  const now = Date.now();
  const mine = (recent.get(userId) || []).filter((t) => now - t < WINDOW_MS);
  if (mine.length >= LIMIT) return true;
  recent.set(userId, [...mine, now]);
  return false;
}

const fail = (err, res, next) => {
  if (err instanceof content.ContentError || err instanceof GeminiError) {
    return res.status(err.status).json({ error: err.message });
  }
  return next(err);
};

const countFrom = (value) => {
  const n = Number(value ?? 5);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : null;
};

/** GET /api/content/videos — the Spoken Tutorial Python videos, with draft counts. */
router.get('/videos', async (req, res, next) => {
  try {
    const concepts = await query('SELECT slug, name FROM concepts ORDER BY sort_order');
    res.json({
      success: true,
      data: await content.listVideos(),
      concepts,
      generator: { configured: isConfigured(), model: model() },
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/content/videos/:slug/generate — { count?, transcript? } */
router.post('/videos/:slug/generate', async (req, res, next) => {
  const count = countFrom(req.body?.count);
  if (count === null) return res.status(400).json({ error: 'count must be a whole number from 1 to 10' });
  if (req.body?.transcript !== undefined && typeof req.body.transcript !== 'string') {
    return res.status(400).json({ error: 'transcript must be text' });
  }
  if (throttled(req.user.userId)) {
    return res.status(429).json({ error: 'That is a lot of generating. Wait a minute and try again.' });
  }
  try {
    const result = await content.generateForVideo(req.params.slug, {
      count, userId: req.user.userId, transcript: req.body?.transcript,
    });
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return fail(err, res, next);
  }
});

/** POST /api/content/generate — { title, transcript, count? } for anything not in the video list. */
router.post('/generate', async (req, res, next) => {
  const { title, transcript } = req.body || {};
  const count = countFrom(req.body?.count);
  if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'title is required' });
  if (typeof transcript !== 'string' || transcript.trim().length < 200) {
    return res.status(400).json({ error: 'Paste at least a few paragraphs of narration or notes' });
  }
  if (count === null) return res.status(400).json({ error: 'count must be a whole number from 1 to 10' });
  if (throttled(req.user.userId)) {
    return res.status(429).json({ error: 'That is a lot of generating. Wait a minute and try again.' });
  }
  try {
    const result = await content.generateFromText({
      title: title.trim().slice(0, 200), transcript, count, userId: req.user.userId,
    });
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return fail(err, res, next);
  }
});

/** GET /api/content/drafts?status=draft|approved|rejected&video=slug */
router.get('/drafts', async (req, res, next) => {
  const status = req.query.status || 'draft';
  if (!['draft', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'status must be draft, approved or rejected' });
  }
  try {
    return res.json({ success: true, data: await content.listDrafts({ status, videoSlug: req.query.video }) });
  } catch (err) {
    return next(err);
  }
});

const draftId = (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: 'Draft id must be a number' }); return null; }
  return id;
};

/** PATCH /api/content/drafts/:id — { text?, options?, correct?, explanation?, concepts?, difficulty? } */
router.patch('/drafts/:id', async (req, res, next) => {
  const id = draftId(req, res);
  if (id === null) return undefined;
  try {
    return res.json({ success: true, data: await content.updateDraft(id, req.body || {}) });
  } catch (err) {
    return fail(err, res, next);
  }
});

router.post('/drafts/:id/approve', async (req, res, next) => {
  const id = draftId(req, res);
  if (id === null) return undefined;
  try {
    return res.json({ success: true, data: await content.approveDraft(id, req.user.userId) });
  } catch (err) {
    return fail(err, res, next);
  }
});

router.post('/drafts/:id/reject', async (req, res, next) => {
  const id = draftId(req, res);
  if (id === null) return undefined;
  try {
    return res.json({ success: true, data: await content.rejectDraft(id, req.user.userId) });
  } catch (err) {
    return fail(err, res, next);
  }
});

module.exports = router;
