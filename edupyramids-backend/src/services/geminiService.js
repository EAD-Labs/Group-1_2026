/*
 * Writing questions with Gemini.
 *
 * One call: the video's narration goes in, a list of multiple-choice
 * questions comes out as JSON that matches a schema, so the reply can be
 * checked field by field instead of parsed out of prose. Nothing here decides
 * what students see; every question comes back as a draft for a person.
 *
 * Uses the generateContent endpoint, which Google lists as legacy but fully
 * supported, because its request and response shapes are stable.
 */

const API_BASE = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const TIMEOUT_MS = 120_000;
// Google answers 503 UNAVAILABLE (and sometimes 500) when a model is
// overloaded. It passes in seconds, so wait and ask again before giving up.
const retryDelays = () => (process.env.GEMINI_RETRY_DELAYS_MS || '2000,6000')
  .split(',').map(Number).filter((n) => n >= 0);
const BUSY = new Set([500, 503]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class GeminiError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

const model = () => process.env.GEMINI_MODEL || DEFAULT_MODEL;
// Optional: a second model to try when the first is still busy after the retries.
const fallbackModel = () => process.env.GEMINI_FALLBACK_MODEL || null;
const isConfigured = () => Boolean(process.env.GEMINI_API_KEY);

const QUESTION_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The question. Code goes on its own lines.' },
          options: {
            type: 'array',
            description: 'Between 3 and 5 answer options, each different.',
            items: { type: 'string' },
            minItems: 3,
            maxItems: 5,
          },
          correctIndex: { type: 'integer', minimum: 0, maximum: 4, description: 'Index of the right option.' },
          explanation: { type: 'string', description: 'One or two sentences on why the answer is right.' },
          concepts: { type: 'array', items: { type: 'string' }, description: 'Concept slugs from the list given.' },
          difficulty: { type: 'integer', minimum: 1, maximum: 3 },
          taughtAt: { type: 'string', description: 'mm:ss where the video teaches this.' },
        },
        required: ['text', 'options', 'correctIndex', 'explanation', 'concepts', 'difficulty', 'taughtAt'],
      },
    },
  },
  required: ['questions'],
};

function buildPrompt({ title, outline = [], transcript, concepts, count, avoid = [] }) {
  return [
    'You write multiple-choice questions for Indian school students in Grades 9 to 12 who are',
    'learning Python from the Spoken Tutorial video series (Python 3.4.3, IPython).',
    '',
    `Write ${count} questions about the video "${title}".`,
    '',
    'Rules:',
    '- Test only what this video actually teaches. Use the narration below as the only source.',
    '- Prefer questions that make the student think: predict the output of a short snippet, spot the',
    '  error, or choose the right command for a task. Avoid pure recall of wording.',
    '- Wrong options must be plausible: base them on real beginner mistakes (off-by-one ranges, / versus //,',
    '  mutating a string, confusing append and extend, and so on).',
    '- Never use "All of the above" or "None of the above". Options must all be different.',
    '- Use Python 3 syntax. Put code on its own lines, with newlines, not inline in a sentence.',
    '- Do not ask about the narrator, the operating system, software versions, or installation steps.',
    '- Mix difficulties: 1 = recall a fact shown, 2 = apply it, 3 = reason about unfamiliar code.',
    '- The explanation must say why the right answer is right in plain English, in one or two sentences.',
    '- taughtAt is the mm:ss timestamp from the narration where the idea is taught.',
    `- concepts: choose one or two slugs from this list only: ${concepts.map((c) => `${c.slug} (${c.name})`).join(', ')}.`,
    avoid.length ? `- These questions already exist for this video; do not repeat them:\n${avoid.map((a) => `  * ${a}`).join('\n')}` : '',
    '',
    outline.length ? `Video outline:\n${outline.map((o) => `- ${o}`).join('\n')}\n` : '',
    'Narration, with timestamps:',
    transcript,
  ].filter((line) => line !== '').join('\n');
}

/**
 * @returns {Promise<Array<{text, options, correctIndex, explanation, concepts, difficulty, taughtAt}>>}
 */
async function generateQuestions(input) {
  if (!isConfigured()) {
    throw new GeminiError('Question generation is not set up: GEMINI_API_KEY is missing.', 503);
  }

  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: buildPrompt(input) }] }],
    generationConfig: {
      temperature: 0.5,
      responseMimeType: 'application/json',
      responseJsonSchema: QUESTION_SCHEMA,
    },
  });

  const delays = retryDelays();
  for (const name of [model(), fallbackModel()].filter(Boolean)) {
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      if (attempt > 0) await sleep(delays[attempt - 1]);
      const result = await callOnce(name, body);
      if (!BUSY.has(result.response.status)) return readReply(result);
    }
  }
  // Still busy on every model and every retry.
  throw new GeminiError('Gemini is busy right now (UNAVAILABLE). Wait a minute and try again.', 503);
}

/** One request to one model. */
async function callOnce(name, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${API_BASE}/models/${encodeURIComponent(name)}:generateContent`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY,
      },
      body,
    });
  } catch (err) {
    throw new GeminiError(err.name === 'AbortError'
      ? 'Gemini took too long to answer. Try fewer questions.'
      : 'Could not reach Gemini.');
  } finally {
    clearTimeout(timer);
  }

  return { response, reply: await response.json().catch(() => ({})) };
}

/** Turn a finished reply into questions, or a plain error. */
function readReply({ response, reply: body }) {
  if (!response.ok) {
    // Say which kind of failure it was without echoing anything that might
    // contain the key.
    const reason = body?.error?.status || response.status;
    if (response.status === 429) throw new GeminiError('Gemini rate limit reached. Wait a minute and try again.', 429);
    if (response.status === 400 || response.status === 403) {
      throw new GeminiError(`Gemini refused the request (${reason}). Check GEMINI_API_KEY and GEMINI_MODEL.`, 502);
    }
    throw new GeminiError(`Gemini returned an error (${reason}).`);
  }

  if (body.promptFeedback?.blockReason) {
    throw new GeminiError(`Gemini blocked the request (${body.promptFeedback.blockReason}).`);
  }

  const text = (body.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || '').join('');
  if (!text) {
    throw new GeminiError(`Gemini returned no questions (${body.candidates?.[0]?.finishReason || 'empty reply'}).`);
  }

  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.questions) ? parsed.questions : [];
  } catch {
    throw new GeminiError('Gemini replied with something that is not valid JSON.');
  }
}

module.exports = { generateQuestions, buildPrompt, isConfigured, model, GeminiError, QUESTION_SCHEMA };
