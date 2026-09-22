const path = require('path');
const { pool, query, queryOne } = require('../config/database');
const gemini = require('./geminiService');

/*
 * Questions from Spoken Tutorial videos.
 *
 * generate  subtitles -> transcript -> Gemini -> checked -> drafts
 * review    a teacher edits, then approves or rejects each draft
 * approve   the draft becomes a real question in that video's quiz, tagged
 *           with its concepts, so it also enters adaptive practice
 *
 * Spoken Tutorial content is CC BY-SA 4.0; every quiz made this way names
 * the video it came from.
 */

const VIDEOS = require(path.join(__dirname, '..', '..', 'content', 'spoken-tutorial-videos.json'));
const LETTERS = ['a', 'b', 'c', 'd', 'e'];
const VIDEO_TOPIC = 'Spoken Tutorial videos';

class ContentError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const videoBySlug = (slug) => VIDEOS.find((v) => v.slug === slug);

/** The quiz title for a video, used to find it again on the next approval. */
const quizTitleFor = (title) => `Video: ${title}`;

async function listVideos() {
  const counts = await query(
    `SELECT video_slug AS slug, status, COUNT(*)::int AS n
       FROM question_drafts WHERE video_slug IS NOT NULL GROUP BY video_slug, status`,
  );
  return VIDEOS.map((v) => {
    const mine = counts.filter((c) => c.slug === v.slug);
    const n = (status) => mine.find((c) => c.status === status)?.n ?? 0;
    return { ...v, drafts: n('draft'), approved: n('approved'), rejected: n('rejected') };
  });
}

/**
 * SRT to plain lines with a timestamp, the tags stripped. Consecutive cues are
 * kept apart so Gemini can point at where each idea is taught.
 */
function srtToTranscript(srt) {
  return srt
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      const timeIndex = lines.findIndex((l) => /-->/.test(l));
      if (timeIndex < 0) return null;
      const start = lines[timeIndex].split('-->')[0].trim();          // 00:03:12,400
      const [h, m, s] = start.split(/[:,.]/).map(Number);
      const stamp = `${String(h * 60 + m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      const text = lines.slice(timeIndex + 1).join(' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
      return text ? `[${stamp}] ${text}` : null;
    })
    .filter(Boolean)
    .join('\n');
}

async function fetchTranscript(video) {
  let response;
  try {
    response = await fetch(video.subtitles, {
      // spoken-tutorial.org turns away requests that do not look like a browser.
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EduPyramids question generator)' },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ContentError('Could not reach spoken-tutorial.org for the subtitles. Paste the narration instead.', 502);
  }
  if (!response.ok) {
    throw new ContentError(`spoken-tutorial.org refused the subtitles (${response.status}). Paste the narration instead.`, 502);
  }
  const transcript = srtToTranscript(await response.text());
  if (transcript.length < 200) throw new ContentError('The subtitles for this video are too short to use.', 502);
  return transcript;
}

/**
 * Keep only questions a student could actually be shown: a question, 3 to 5
 * different options, a right answer that is one of them, and known concepts.
 * Everything else is dropped and counted, so the teacher knows.
 */
function checkQuestions(raw, knownSlugs, fallbackConcepts) {
  const kept = [];
  let dropped = 0;

  for (const q of raw) {
    const options = (Array.isArray(q?.options) ? q.options : [])
      .map((o) => String(o).trim()).filter(Boolean);
    const distinct = new Set(options.map((o) => o.toLowerCase())).size === options.length;
    const vague = options.some((o) => /^(all|none) of the above$/i.test(o));
    const text = String(q?.text || '').trim();

    if (!text || options.length < 3 || options.length > 5 || !distinct || vague
      || !Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= options.length
      || options.some((o) => o.length > 255)) {
      dropped += 1;
      continue;
    }

    const concepts = (Array.isArray(q.concepts) ? q.concepts : []).filter((c) => knownSlugs.has(c)).slice(0, 2);
    kept.push({
      text,
      options: Object.fromEntries(options.map((o, i) => [LETTERS[i], o])),
      correct: LETTERS[q.correctIndex],
      explanation: String(q.explanation || '').trim() || null,
      concepts: concepts.length ? concepts : fallbackConcepts,
      difficulty: [1, 2, 3].includes(q.difficulty) ? q.difficulty : 2,
      taughtAt: /^\d{1,3}:\d{2}$/.test(String(q.taughtAt || '')) ? q.taughtAt : null,
    });
  }
  return { kept, dropped };
}

async function saveDrafts(drafts, { videoSlug, title, userId }) {
  const saved = [];
  for (const d of drafts) {
    saved.push(await queryOne(
      `INSERT INTO question_drafts
         (video_slug, source_title, text, options, correct, explanation, concepts,
          difficulty, taught_at, model, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [videoSlug, title, d.text, JSON.stringify(d.options), d.correct, d.explanation,
        d.concepts, d.difficulty, d.taughtAt, gemini.model(), userId],
    ));
  }
  return saved.map(shape);
}

async function conceptCatalogue() {
  return query('SELECT slug, name FROM concepts ORDER BY sort_order');
}

/** Existing question texts for a video, so Gemini does not write them again. */
async function existingFor(videoSlug) {
  const rows = await query(
    `SELECT text FROM question_drafts WHERE video_slug = $1 AND status <> 'rejected'
      ORDER BY id DESC LIMIT 30`,
    [videoSlug],
  );
  return rows.map((r) => r.text.replace(/\s+/g, ' ').slice(0, 160));
}

async function generateForVideo(slug, { count = 5, userId, transcript: pasted } = {}) {
  const video = videoBySlug(slug);
  if (!video) throw new ContentError('No such video', 404);

  const transcript = pasted?.trim() ? pasted.trim() : await fetchTranscript(video);
  const concepts = await conceptCatalogue();
  const raw = await gemini.generateQuestions({
    title: video.title,
    outline: video.outline,
    transcript: transcript.slice(0, 60_000),
    concepts,
    count,
    avoid: await existingFor(slug),
  });

  const { kept, dropped } = checkQuestions(raw, new Set(concepts.map((c) => c.slug)), video.concepts);
  const drafts = await saveDrafts(kept, { videoSlug: slug, title: video.title, userId });
  return { video: { slug: video.slug, title: video.title }, drafts, dropped };
}

async function generateFromText({ title, transcript, count = 5, userId }) {
  const concepts = await conceptCatalogue();
  const raw = await gemini.generateQuestions({
    title, transcript: transcript.slice(0, 60_000), concepts, count,
  });
  const { kept, dropped } = checkQuestions(raw, new Set(concepts.map((c) => c.slug)), []);
  const drafts = await saveDrafts(kept.filter((d) => d.concepts.length), { videoSlug: null, title, userId });
  return { drafts, dropped: dropped + kept.filter((d) => !d.concepts.length).length };
}

function shape(row) {
  return {
    id: row.id,
    videoSlug: row.video_slug,
    sourceTitle: row.source_title,
    text: row.text,
    options: row.options,
    correct: row.correct,
    explanation: row.explanation,
    concepts: row.concepts,
    difficulty: row.difficulty,
    taughtAt: row.taught_at,
    model: row.model,
    status: row.status,
    questionId: row.question_id,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  };
}

async function listDrafts({ status = 'draft', videoSlug } = {}) {
  const rows = await query(
    `SELECT * FROM question_drafts
      WHERE status = $1 AND ($2::text IS NULL OR video_slug = $2)
      ORDER BY created_at DESC, id DESC LIMIT 200`,
    [status, videoSlug ?? null],
  );
  return rows.map(shape);
}

/** Edit a draft before approving it. Checked the same way generated ones are. */
async function updateDraft(id, changes) {
  const row = await queryOne('SELECT * FROM question_drafts WHERE id = $1', [id]);
  if (!row) throw new ContentError('No such draft', 404);
  if (row.status !== 'draft') throw new ContentError('Only drafts can be edited', 409);

  const options = changes.options ?? row.options;
  const letters = LETTERS.filter((l) => typeof options[l] === 'string' && options[l].trim());
  const candidate = {
    text: changes.text ?? row.text,
    options: letters.map((l) => options[l]),
    correctIndex: letters.indexOf(changes.correct ?? row.correct),
    explanation: changes.explanation ?? row.explanation,
    concepts: changes.concepts ?? row.concepts,
    difficulty: changes.difficulty ?? row.difficulty,
    taughtAt: row.taught_at,
  };
  const known = new Set((await conceptCatalogue()).map((c) => c.slug));
  const { kept } = checkQuestions([candidate], known, []);
  if (!kept.length) {
    throw new ContentError('A question needs text, 3 to 5 different options and a right answer among them.');
  }
  if (!kept[0].concepts.length) throw new ContentError('Choose at least one concept.');

  const d = kept[0];
  return shape(await queryOne(
    `UPDATE question_drafts
        SET text = $2, options = $3, correct = $4, explanation = $5, concepts = $6, difficulty = $7
      WHERE id = $1 RETURNING *`,
    [id, d.text, JSON.stringify(d.options), d.correct, d.explanation, d.concepts, d.difficulty],
  ));
}

/**
 * Approve: copy the draft into the video's quiz and tag its concepts, in one
 * transaction, so a half-approved question cannot exist.
 */
async function approveDraft(id, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = (await client.query('SELECT * FROM question_drafts WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!row) throw new ContentError('No such draft', 404);
    if (row.status !== 'draft') throw new ContentError(`This draft is already ${row.status}`, 409);

    const topicId = (await client.query(
      `INSERT INTO topics (name, level, sort_order) VALUES ($1, 2, 100)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [VIDEO_TOPIC],
    )).rows[0].id;

    const title = quizTitleFor(row.source_title);
    let quiz = (await client.query('SELECT id FROM quizzes WHERE title = $1 AND topic_id = $2', [title, topicId])).rows[0];
    if (!quiz) {
      quiz = (await client.query(
        'INSERT INTO quizzes (title, topic_id, difficulty) VALUES ($1, $2, 2) RETURNING id', [title, topicId],
      )).rows[0];
    }

    const o = row.options;
    const credit = row.video_slug ? ` (From the Spoken Tutorial video "${row.source_title}", CC BY-SA 4.0.)` : '';
    const question = (await client.query(
      `INSERT INTO questions
         (quiz_id, text, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [quiz.id, row.text, o.a, o.b, o.c ?? null, o.d ?? null, o.e ?? null, row.correct,
        `${row.explanation || ''}${credit}`.trim()],
    )).rows[0];

    for (const slug of row.concepts) {
      await client.query(
        `INSERT INTO question_concepts (question_id, concept_id)
         SELECT $1, id FROM concepts WHERE slug = $2 ON CONFLICT DO NOTHING`,
        [question.id, slug],
      );
    }

    const updated = (await client.query(
      `UPDATE question_drafts
          SET status = 'approved', reviewed_by = $2, reviewed_at = now(), question_id = $3
        WHERE id = $1 RETURNING *`,
      [id, userId, question.id],
    )).rows[0];

    await client.query('COMMIT');
    return { ...shape(updated), quizId: quiz.id };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function rejectDraft(id, userId) {
  const row = await queryOne(
    `UPDATE question_drafts SET status = 'rejected', reviewed_by = $2, reviewed_at = now()
      WHERE id = $1 AND status = 'draft' RETURNING *`,
    [id, userId],
  );
  if (!row) throw new ContentError('No such draft, or it was already reviewed', 404);
  return shape(row);
}

module.exports = {
  listVideos, generateForVideo, generateFromText, listDrafts, updateDraft, approveDraft, rejectDraft,
  srtToTranscript, checkQuestions, ContentError, VIDEOS, VIDEO_TOPIC,
};
