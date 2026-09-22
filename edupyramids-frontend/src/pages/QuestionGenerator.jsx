import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import DashboardShell from '../components/DashboardShell';
import { client } from '../api/client';
import { auth } from '../utils/auth';

const LETTERS = ['a', 'b', 'c', 'd', 'e'];
const TABS = [
  { id: 'draft', label: 'To review' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
];

/*
 * Questions from Spoken Tutorial videos, written by Gemini, checked by a
 * person. The page is built around the review, not the generating: a draft
 * can be corrected in place, and nothing reaches a student until someone
 * presses Approve.
 */
export default function QuestionGenerator() {
  const [videos, setVideos] = useState(null);
  const [concepts, setConcepts] = useState([]);
  const [generator, setGenerator] = useState(null);
  const [slug, setSlug] = useState(null);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('draft');
  const [drafts, setDrafts] = useState([]);
  const [count, setCount] = useState(5);
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);

  const home = auth.homeFor(auth.getCurrentUser()?.role);

  async function loadVideos() {
    const res = await client.get('/content/videos');
    setVideos(res.data);
    setConcepts(res.concepts);
    setGenerator(res.generator);
    return res.data;
  }

  useEffect(() => {
    loadVideos()
      .then((list) => setSlug((s) => s ?? list.find((v) => v.slug === 'loops')?.slug ?? list[0]?.slug))
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!slug) return;
    client.get(`/content/drafts?status=${tab}&video=${slug}`)
      .then((res) => setDrafts(res.data))
      .catch((err) => setError(err.message));
  }, [slug, tab]);

  const video = videos?.find((v) => v.slug === slug);
  const shown = useMemo(() => (videos || []).filter((v) => {
    const q = search.trim().toLowerCase();
    return !q || v.title.toLowerCase().includes(q)
      || v.concepts.some((c) => c.includes(q)) || v.outline.some((o) => o.toLowerCase().includes(q));
  }), [videos, search]);

  async function generate() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await client.post(`/content/videos/${slug}/generate`, {
        count, ...(pasted.trim() ? { transcript: pasted } : {}),
      });
      const { drafts: made, dropped } = res.data;
      setNotice(`${made.length} new draft${made.length === 1 ? '' : 's'} to review`
        + (dropped ? `. ${dropped} came back malformed and were left out.` : '.'));
      setTab('draft');
      setDrafts((d) => (tab === 'draft' ? [...made, ...d] : made));
      await loadVideos();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function reviewed(id) {
    setDrafts((d) => d.filter((x) => x.id !== id));
    loadVideos().catch(() => {});
  }

  if (!videos) {
    return (
      <DashboardShell title="Question generator">
        {error ? <p className="alert" role="alert">{error}</p> : <p className="muted">Loading…</p>}
      </DashboardShell>
    );
  }

  return (
    <DashboardShell title="Question generator" wide>
      <p className="quiz-back">
        <Link to={home}>&larr; Back to the dashboard</Link>
      </p>

      <p className="gen-intro muted">
        Pick a Spoken Tutorial video. Gemini reads its narration and writes multiple-choice questions
        about what the video teaches. <strong>Nothing reaches students until you approve it.</strong>{' '}
        Approved questions go into a quiz for that video and into adaptive practice.
      </p>

      {generator && !generator.configured && (
        <p className="alert" role="alert">
          Generation is not set up on this server: add <code>GEMINI_API_KEY</code> to its environment.
          You can still review drafts that already exist.
        </p>
      )}

      <div className="gen">
        <aside className="gen-videos">
          <label className="sr-only" htmlFor="video-search">Find a video</label>
          <input id="video-search" className="gen-search" type="search" placeholder="Find a video or topic"
            value={search} onChange={(e) => setSearch(e.target.value)} />
          <ul>
            {shown.map((v) => (
              <li key={v.slug}>
                <button type="button" className={`gen-video${v.slug === slug ? ' gen-video--on' : ''}`}
                  onClick={() => { setSlug(v.slug); setNotice(null); setError(null); setPasted(''); }}>
                  <span className="gen-video-title">{v.order}. {v.title}</span>
                  <span className="gen-video-meta">
                    {v.duration}
                    {v.drafts > 0 && <span className="gen-count gen-count--draft">{v.drafts} to review</span>}
                    {v.approved > 0 && <span className="gen-count">{v.approved} approved</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {video && (
          <section className="gen-main">
            <div className="card gen-source">
              <div className="gen-source-head">
                <div>
                  <h2 className="gen-title">{video.title}</h2>
                  <p className="muted small">
                    {video.duration} · {video.concepts.map((c) => concepts.find((x) => x.slug === c)?.name || c).join(', ')}
                    {' · '}<a href={video.url} target="_blank" rel="noreferrer">Watch on spoken-tutorial.org ↗</a>
                  </p>
                </div>
              </div>
              <ul className="gen-outline">
                {video.outline.map((o) => <li key={o}>{o}</li>)}
              </ul>

              <details className="gen-paste">
                <summary>Paste the narration yourself (if the subtitles cannot be fetched)</summary>
                <textarea rows={5} value={pasted} onChange={(e) => setPasted(e.target.value)}
                  placeholder="Paste the script or timed script here" />
              </details>

              <div className="gen-actions">
                <label className="field--inline" htmlFor="count">
                  <span>Questions</span>
                  <select id="count" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                    {[3, 5, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <button className="btn btn--sm" type="button" onClick={generate}
                  disabled={busy || !generator?.configured}>
                  {busy && <span className="spinner" aria-hidden="true" />}
                  {busy ? 'Gemini is writing…' : 'Generate questions'}
                </button>
                {generator?.model && <span className="muted small">{generator.model}</span>}
              </div>
              {busy && <p className="muted small">This usually takes 10 to 30 seconds.</p>}
              {notice && <p className="gen-notice" role="status">{notice}</p>}
              {error && <p className="alert" role="alert">{error}</p>}
            </div>

            <div className="gen-tabs" role="tablist">
              {TABS.map((t) => (
                <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
                  className={`gen-tab${tab === t.id ? ' gen-tab--on' : ''}`} onClick={() => setTab(t.id)}>
                  {t.label}
                  {t.id === 'draft' && video.drafts > 0 && <span className="gen-tab-n">{video.drafts}</span>}
                  {t.id === 'approved' && video.approved > 0 && <span className="gen-tab-n">{video.approved}</span>}
                </button>
              ))}
            </div>

            {drafts.length === 0 ? (
              <p className="empty">
                {tab === 'draft' ? 'Nothing to review for this video. Generate some questions above.' : `No ${tab} questions yet.`}
              </p>
            ) : (
              <ol className="drafts">
                {drafts.map((d) => (
                  <Draft key={d.id} draft={d} concepts={concepts} video={video}
                    editable={tab === 'draft'} onReviewed={reviewed} />
                ))}
              </ol>
            )}
          </section>
        )}
      </div>
    </DashboardShell>
  );
}

function Draft({ draft, concepts, video, editable, onReviewed }) {
  const [d, setD] = useState(draft);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const set = (patch) => { setD((x) => ({ ...x, ...patch })); setDirty(true); };
  const letters = LETTERS.filter((l) => d.options[l] !== undefined);

  function setOption(letter, value) {
    set({ options: { ...d.options, [letter]: value } });
  }

  function addOption() {
    const next = LETTERS.find((l) => d.options[l] === undefined);
    if (next) setOption(next, '');
  }

  function removeOption(letter) {
    // Letters close up, so the options stay a, b, c… with no gap.
    const values = letters.filter((l) => l !== letter).map((l) => d.options[l]);
    const correctValue = d.options[d.correct];
    const options = Object.fromEntries(values.map((v, i) => [LETTERS[i], v]));
    const correct = LETTERS[values.indexOf(correctValue)] || 'a';
    set({ options, correct });
  }

  function toggleConcept(slug) {
    set({ concepts: d.concepts.includes(slug) ? d.concepts.filter((c) => c !== slug) : [...d.concepts, slug] });
  }

  async function save() {
    const res = await client.patch(`/content/drafts/${d.id}`, {
      text: d.text, options: d.options, correct: d.correct,
      explanation: d.explanation, concepts: d.concepts, difficulty: d.difficulty,
    });
    setD(res.data);
    setDirty(false);
  }

  async function act(kind) {
    setBusy(true);
    setError(null);
    try {
      if (kind === 'approve' && dirty) await save();
      if (kind === 'save') { await save(); return; }
      await client.post(`/content/drafts/${d.id}/${kind}`);
      onReviewed(d.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!editable) {
    return (
      <li className={`fb ${d.status === 'approved' ? 'fb--ok' : 'fb--no'}`}>
        <pre className="fb-code">{d.text}</pre>
        <ol className="draft-read" type="a">
          {letters.map((l) => (
            <li key={l} className={l === d.correct ? 'draft-read--right' : ''}>{d.options[l]}</li>
          ))}
        </ol>
        {d.explanation && <p className="fb-why">{d.explanation}</p>}
      </li>
    );
  }

  return (
    <li className="draft card">
      <div className="draft-meta">
        <span className="muted small">
          {d.taughtAt ? <>Taught at <a href={video.url} target="_blank" rel="noreferrer">{d.taughtAt}</a> · </> : null}
          Written by {d.model}
        </span>
        <label className="draft-difficulty">
          <span className="sr-only">Difficulty</span>
          <select value={d.difficulty} onChange={(e) => set({ difficulty: Number(e.target.value) })}>
            <option value={1}>Easy</option>
            <option value={2}>Medium</option>
            <option value={3}>Hard</option>
          </select>
        </label>
      </div>

      <label className="draft-label" htmlFor={`q-${d.id}`}>Question</label>
      <textarea id={`q-${d.id}`} className="draft-text" rows={Math.min(10, d.text.split('\n').length + 1)}
        value={d.text} onChange={(e) => set({ text: e.target.value })} />

      <fieldset className="draft-options">
        <legend className="draft-label">Options — choose the right one</legend>
        {letters.map((l) => (
          <div key={l} className={`draft-option${d.correct === l ? ' draft-option--right' : ''}`}>
            <input type="radio" name={`correct-${d.id}`} checked={d.correct === l}
              onChange={() => set({ correct: l })} aria-label={`Option ${l.toUpperCase()} is correct`} />
            <span className="option-letter">{l.toUpperCase()}</span>
            <input type="text" value={d.options[l]} onChange={(e) => setOption(l, e.target.value)}
              aria-label={`Option ${l.toUpperCase()}`} />
            {letters.length > 3 && (
              <button type="button" className="linkish small" onClick={() => removeOption(l)}>Remove</button>
            )}
          </div>
        ))}
        {letters.length < 5 && (
          <button type="button" className="linkish small" onClick={addOption}>+ Add an option</button>
        )}
      </fieldset>

      <label className="draft-label" htmlFor={`e-${d.id}`}>Explanation shown after answering</label>
      <textarea id={`e-${d.id}`} rows={2} value={d.explanation || ''} onChange={(e) => set({ explanation: e.target.value })} />

      <p className="draft-label">Concepts it tests</p>
      <div className="chips-pick">
        {concepts.map((c) => (
          <button key={c.slug} type="button" aria-pressed={d.concepts.includes(c.slug)}
            className={`chip-pick${d.concepts.includes(c.slug) ? ' chip-pick--on' : ''}`}
            onClick={() => toggleConcept(c.slug)}>
            {c.name}
          </button>
        ))}
      </div>

      {error && <p className="alert" role="alert">{error}</p>}

      <div className="draft-actions">
        <button className="btn btn--ghost btn--sm" type="button" onClick={() => act('reject')} disabled={busy}>
          Reject
        </button>
        {dirty && (
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => act('save')} disabled={busy}>
            Save changes
          </button>
        )}
        <button className="btn btn--sm" type="button" onClick={() => act('approve')} disabled={busy}>
          {dirty ? 'Save and approve' : 'Approve'}
        </button>
      </div>
    </li>
  );
}
