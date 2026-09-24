const request = require('supertest');
const app = require('../src/app');
const { pool, query, queryOne } = require('../src/config/database');
const { resetThrottle } = require('../src/services/authService');
const { srtToTranscript, checkQuestions } = require('../src/services/contentService');
const { buildPrompt } = require('../src/services/geminiService');

/*
 * Gemini and spoken-tutorial.org are both replaced with fakes: the tests must
 * not spend API credit, need a key, or depend on someone else's website.
 */
const SRT = `<b>Narration</b>

1
00:00:01 --> 00:00:04
Welcome to the spoken tutorial on <b>Loops</b>.

2
00:03:12,400 --> 00:03:20,000
<p><b>range(1, 5)</b> gives 1, 2, 3 and 4. It stops one before the end value.</p>

3
00:04:02 --> 00:04:10
The <b>break</b> statement leaves the loop at once, and continue skips to the next turn.
${'Filler narration to make the transcript long enough. '.repeat(6)}
`;

const generated = {
  questions: [
    {
      text: 'What does this print?\n\nfor i in range(1, 4):\n    print(i)',
      options: ['1 2 3', '1 2 3 4', '0 1 2 3'],
      correctIndex: 0,
      explanation: 'range stops one before its end value.',
      concepts: ['loops', 'made-up-concept'],
      difficulty: 2,
      taughtAt: '03:12',
    },
    // Dropped: the options repeat.
    { text: 'Pick one', options: ['a', 'a', 'b'], correctIndex: 0, explanation: '', concepts: [], difficulty: 1, taughtAt: '00:01' },
    // Dropped: "All of the above".
    { text: 'Which is true?', options: ['x', 'y', 'All of the above'], correctIndex: 2, explanation: '', concepts: ['loops'], difficulty: 1, taughtAt: '04:02' },
  ],
};

let lastGeminiBody;
let geminiStatus = 200;
// Statuses to answer before the normal reply, one per call: [503, 503] is busy twice.
let geminiQueue = [];
const geminiModels = [];

beforeAll(() => {
  process.env.GEMINI_API_KEY = 'test-key-not-real';
  process.env.GEMINI_RETRY_DELAYS_MS = '0,0';
  const realFetch = global.fetch;
  jest.spyOn(global, 'fetch').mockImplementation(async (url, init = {}) => {
    const target = String(url);
    if (target.includes('spoken-tutorial.org')) {
      return new Response(SRT, { status: 200 });
    }
    if (target.includes('generativelanguage.googleapis.com')) {
      lastGeminiBody = JSON.parse(init.body);
      geminiModels.push(target.split('/models/')[1].split(':')[0]);
      if (geminiQueue.length) {
        return new Response('{"error":{"status":"UNAVAILABLE"}}', { status: geminiQueue.shift() });
      }
      if (geminiStatus !== 200) return new Response('{"error":{"status":"RESOURCE_EXHAUSTED"}}', { status: geminiStatus });
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(generated) }] }, finishReason: 'STOP' }],
      }), { status: 200 });
    }
    return realFetch(url, init);
  });
});

afterAll(async () => {
  jest.restoreAllMocks();
  delete process.env.GEMINI_API_KEY;
  await pool.end();
});

const login = async (email, role) => {
  resetThrottle();
  const res = await request(app).post('/api/auth/login').send({ email, password: 'password123', role });
  return { Authorization: `Bearer ${res.body.token}` };
};

describe('turning subtitles into a transcript', () => {
  test('keeps a timestamp per cue and strips the markup', () => {
    const t = srtToTranscript(SRT);
    expect(t).toContain('[03:12] range(1, 5) gives 1, 2, 3 and 4.');
    expect(t).not.toMatch(/<b>|<p>|Narration/);
  });
});

describe('checking what Gemini returns', () => {
  test('drops repeated options and "all of the above", keeps only known concepts', () => {
    const { kept, dropped } = checkQuestions(generated.questions, new Set(['loops']), ['basics']);
    expect(dropped).toBe(2);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ correct: 'a', concepts: ['loops'], taughtAt: '03:12' });
    expect(kept[0].options).toEqual({ a: '1 2 3', b: '1 2 3 4', c: '0 1 2 3' });
  });

  test('the prompt grounds Gemini in the narration and the concept list', () => {
    const prompt = buildPrompt({
      title: 'Loops', outline: ['while loop'], transcript: '[00:01] hello', concepts: [{ slug: 'loops', name: 'Loops' }], count: 3,
    });
    expect(prompt).toContain('Write 3 questions about the video "Loops"');
    expect(prompt).toContain('loops (Loops)');
    expect(prompt).toContain('[00:01] hello');
    expect(prompt).toMatch(/Never use "All of the above"/);
  });
});

describe('generating and reviewing', () => {
  let teacher;
  let draft;

  beforeAll(async () => { teacher = await login('teacher1@school.com', 'teacher'); });

  test('students cannot reach the generator', async () => {
    const student = await login('student1@school.com', 'student');
    expect((await request(app).get('/api/content/videos').set(student)).status).toBe(403);
  });

  test('the video list says the generator is set up', async () => {
    const res = await request(app).get('/api/content/videos').set(teacher);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(39);
    expect(res.body.generator.configured).toBe(true);
  });

  test('generating from a video stores checked drafts, not questions', async () => {
    const before = (await queryOne('SELECT COUNT(*)::int AS n FROM questions')).n;
    const res = await request(app).post('/api/content/videos/loops/generate').set(teacher).send({ count: 3 });

    expect(res.status).toBe(201);
    expect(res.body.data.dropped).toBe(2);
    expect(res.body.data.drafts).toHaveLength(1);
    [draft] = res.body.data.drafts;
    expect(draft).toMatchObject({ status: 'draft', videoSlug: 'loops', concepts: ['loops'] });

    // The narration reached Gemini, with JSON output requested.
    expect(lastGeminiBody.contents[0].parts[0].text).toContain('[03:12] range(1, 5)');
    expect(lastGeminiBody.generationConfig.responseMimeType).toBe('application/json');

    // Nothing is visible to students yet.
    expect((await queryOne('SELECT COUNT(*)::int AS n FROM questions')).n).toBe(before);
  });

  test('an edit that breaks the question is refused', async () => {
    const res = await request(app).patch(`/api/content/drafts/${draft.id}`).set(teacher)
      .send({ options: { a: 'same', b: 'same', c: 'other' } });
    expect(res.status).toBe(400);
  });

  test('approving puts it in the video quiz, tagged, with credit to Spoken Tutorial', async () => {
    const edited = await request(app).patch(`/api/content/drafts/${draft.id}`).set(teacher)
      .send({ explanation: 'range(1, 4) stops before 4.' });
    expect(edited.status).toBe(200);

    const res = await request(app).post(`/api/content/drafts/${draft.id}/approve`).set(teacher);
    expect(res.status).toBe(200);

    const q = await queryOne(
      `SELECT q.explanation, z.title FROM questions q JOIN quizzes z ON z.id = q.quiz_id WHERE q.id = $1`,
      [res.body.data.questionId],
    );
    expect(q.title).toBe('Video: Loops');
    expect(q.explanation).toMatch(/stops before 4\..*Spoken Tutorial video "Loops", CC BY-SA 4\.0/);

    const tags = await query(
      `SELECT c.slug FROM question_concepts qc JOIN concepts c ON c.id = qc.concept_id WHERE qc.question_id = $1`,
      [res.body.data.questionId],
    );
    expect(tags.map((t) => t.slug)).toEqual(['loops']);

    // Approving twice does not make a second question.
    expect((await request(app).post(`/api/content/drafts/${draft.id}/approve`).set(teacher)).status).toBe(409);
  });

  test('a rate limit from Gemini is reported plainly', async () => {
    geminiStatus = 429;
    const res = await request(app).post('/api/content/videos/loops/generate').set(teacher).send({ count: 2 });
    geminiStatus = 200;
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/rate limit/);
    expect(JSON.stringify(res.body)).not.toContain('test-key-not-real');
  });

  test('a busy Gemini is asked again, and the retry succeeds', async () => {
    geminiQueue = [503, 503];
    geminiModels.length = 0;
    const res = await request(app).post('/api/content/videos/loops/generate').set(teacher).send({ count: 2 });
    expect(res.status).toBe(201);
    expect(geminiModels).toEqual(['gemini-3.5-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.5-flash-lite']);
  });

  test('still busy after the retries: the backup model is tried, then a plain message', async () => {
    process.env.GEMINI_FALLBACK_MODEL = 'backup-model';
    geminiQueue = [503, 503, 503, 500, 503, 503];
    geminiModels.length = 0;
    const res = await request(app).post('/api/content/videos/loops/generate').set(teacher).send({ count: 2 });
    delete process.env.GEMINI_FALLBACK_MODEL;
    geminiQueue = [];
    expect(geminiModels).toEqual([
      'gemini-3.5-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.5-flash-lite',
      'backup-model', 'backup-model', 'backup-model',
    ]);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/busy/);
  });

  test('without a key the generator says so instead of failing oddly', async () => {
    const key = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const res = await request(app).post('/api/content/videos/loops/generate').set(teacher).send({ count: 2 });
    process.env.GEMINI_API_KEY = key;
    expect(res.status).toBe(503);
  });
});
