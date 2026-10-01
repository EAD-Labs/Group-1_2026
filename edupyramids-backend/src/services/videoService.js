const VIDEOS = require('../../content/spoken-tutorial-videos.json');

/*
 * Spoken Tutorial's videos, played inside the app.
 *
 * spoken-tutorial.org serves every lesson as plain files next to its
 * subtitles (…/Getting-started-with-IPython-English.mp4, .webm, .srt), with
 * range requests, so a <video> element can stream and seek them straight from
 * their server: nothing is copied or stored here. Their content is CC BY-SA
 * 4.0, so the player always names them and links to the original page.
 *
 * Captions are the one thing that has to come through us. A <track> needs
 * WebVTT, and from the page's own origin (their server sends no CORS header),
 * so the subtitles are fetched once, turned from SRT into WebVTT and kept.
 */

const BY_SLUG = new Map(VIDEOS.map((v) => [v.slug, v]));
const captions = new Map();   // slug -> WebVTT text; 39 small files at most

class VideoError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** The video files of a lesson, from its subtitles' address. */
function mediaFor(video) {
  const base = String(video.subtitles || '').replace(/\.srt$/i, '');
  if (!base || base === video.subtitles) return null;
  return { mp4: `${base}.mp4`, webm: `${base}.webm` };
}

/** What a page needs to play a lesson. */
function playable(video) {
  const media = mediaFor(video);
  return {
    slug: video.slug,
    title: video.title,
    url: video.url,              // the lesson on spoken-tutorial.org
    duration: video.duration,
    ...(media ? { mp4: media.mp4, webm: media.webm, captions: `/api/videos/${video.slug}/captions.vtt` } : {}),
  };
}

const TIMING = /^(\d{1,2}):(\d{2}):(\d{2})(?:[,.](\d{1,3}))?\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})(?:[,.](\d{1,3}))?/;
const stamp = (h, m, sec, ms = '0') => `${h.padStart(2, '0')}:${m}:${sec}.${ms.padEnd(3, '0')}`;

/**
 * SRT to WebVTT, one cue at a time. Spoken Tutorial's files are close to SRT
 * but not exact, so each cue is rebuilt rather than patched:
 *   - times are whole seconds ("00:00:01"), and WebVTT needs milliseconds;
 *   - a "Narration" heading sits before the first cue, and is dropped;
 *   - <center> and the like are not caption markup: only <b>, <i> and <u> stay;
 *   - a caption may contain "-->", which WebVTT would read as a new timing.
 */
function srtToVtt(srt) {
  const cues = String(srt)
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split('\n');
      const at = lines.findIndex((l) => TIMING.test(l.trim()));
      if (at === -1) return null;
      const [, h1, m1, s1, ms1, h2, m2, s2, ms2] = lines[at].trim().match(TIMING);
      const text = lines.slice(at + 1)
        .map((l) => l.replace(/<\/?(?!(?:b|i|u)\b)[a-z][^>]*>/gi, '').replace(/-->/g, '--&gt;').trim())
        .filter(Boolean)
        .join('\n');
      return text ? `${stamp(h1, m1, s1, ms1)} --> ${stamp(h2, m2, s2, ms2)}\n${text}` : null;
    })
    .filter(Boolean);
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

async function captionsFor(slug) {
  const video = BY_SLUG.get(slug);
  if (!video) throw new VideoError('No such video', 404);
  if (captions.has(slug)) return captions.get(slug);

  let response;
  try {
    response = await fetch(video.subtitles, {
      // spoken-tutorial.org turns away requests that do not look like a browser.
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EduPyramids video captions)' },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new VideoError('Could not reach spoken-tutorial.org for the captions', 502);
  }
  if (!response.ok) throw new VideoError('spoken-tutorial.org refused the captions', 502);
  const vtt = srtToVtt(await response.text());
  captions.set(slug, vtt);
  return vtt;
}

module.exports = {
  playable, mediaFor, srtToVtt, captionsFor, VideoError,
};
