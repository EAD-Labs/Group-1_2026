import { useEffect, useMemo, useState } from 'react';
import DashboardShell from '../components/DashboardShell';
import { client } from '../api/client';

/*
 * Content management, for the programme coordinator (HLD UC-04, test C8).
 *
 * Pick a quiz, find a question, and edit it where it stands: the text, the
 * options, which one is right, the explanation and the concepts it practises.
 * Saving is live at once for students. A question edited here is marked, and
 * the importer never overwrites it on the next deploy.
 */
const LETTERS = ['a', 'b', 'c', 'd', 'e'];
const blank = () => ({
  text: '', options: { a: '', b: '', c: '', d: '', e: '' }, correct: 'a', explanation: '', concepts: [],
});

export default function ManageQuestions() {
  const [meta, setMeta] = useState(null);           // { quizzes, topics, concepts }
  const [quizId, setQuizId] = useState(null);
  const [questions, setQuestions] = useState(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);     // question id, or 'new'
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);

  async function loadMeta(select) {
    const res = await client.get('/manage/quizzes');
    setMeta(res.data);
    setQuizId((current) => select ?? current ?? res.data.quizzes[0]?.id ?? null);
  }

  useEffect(() => { loadMeta().catch((err) => setError(err.message)); }, []);

  async function loadQuestions(id = quizId) {
    if (!id) return;
    setQuestions(null);
    const res = await client.get(`/manage/quizzes/${id}/questions`);
    setQuestions(res.data);
  }
  useEffect(() => { setEditing(null); loadQuestions().catch((err) => setError(err.message)); }, [quizId]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (questions || []).filter((x) => !q || x.text.toLowerCase().includes(q)
      || Object.values(x.options).some((o) => o.toLowerCase().includes(q)));
  }, [questions, search]);

  if (error) return <DashboardShell title="Questions"><p className="alert" role="alert">{error}</p></DashboardShell>;
  if (!meta) return <DashboardShell title="Questions"><p className="muted">Loading…</p></DashboardShell>;

  const quiz = meta.quizzes.find((z) => z.id === quizId);
  const conceptName = Object.fromEntries(meta.concepts.map((c) => [c.slug, c.name]));

  async function saved(message) {
    setEditing(null);
    setNotice(message);
    await Promise.all([loadQuestions(), loadMeta()]);
  }

  return (
    <DashboardShell title="Questions" wide>
      <p className="page-intro muted">
        Edit the client&apos;s questions or add your own. Changes reach students straight away, and a
        question edited here is never overwritten by the next import.
      </p>

      <div className="manage-bar">
        <label className="field field--inline">
          <span>Quiz</span>
          <select value={quizId ?? ''} onChange={(e) => setQuizId(Number(e.target.value))}>
            {meta.topics.map((t) => {
              const inTopic = meta.quizzes.filter((z) => z.topicId === t.id);
              return inTopic.length ? (
                <optgroup key={t.id} label={t.name}>
                  {inTopic.map((z) => <option key={z.id} value={z.id}>{z.title} ({z.questions})</option>)}
                </optgroup>
              ) : null;
            })}
          </select>
        </label>
        <input className="manage-search" type="search" placeholder="Search questions and options"
          value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search questions" />
        <button className="btn btn--sm" type="button" onClick={() => { setNotice(null); setEditing('new'); }} disabled={!quizId}>
          + Add question
        </button>
        <NewQuiz topics={meta.topics} onMade={async (made) => { setNotice(`Quiz "${made.title}" created. Add its questions below.`); await loadMeta(made.id); }} />
      </div>

      {notice && <p className="manage-notice" role="status">{notice}</p>}

      {editing === 'new' && (
        <Editor quizId={quizId} start={blank()} concepts={meta.concepts}
          onCancel={() => setEditing(null)} onSaved={() => saved('Question added. Students see it now.')} />
      )}

      {!questions ? <p className="muted">Loading…</p> : (
        <>
          <p className="muted small">
            {quiz?.topic} · {shown.length} of {questions.length} question{questions.length === 1 ? '' : 's'}
          </p>
          <ol className="manage-list">
            {shown.map((q) => (
              <li key={q.id} className="manage-item">
                {editing === q.id ? (
                  <Editor quizId={quizId} start={{ ...blank(), ...q, options: { ...blank().options, ...q.options }, explanation: q.explanation || '' }}
                    id={q.id} concepts={meta.concepts}
                    onCancel={() => setEditing(null)}
                    onSaved={(message) => saved(message)} />
                ) : (
                  <div className="manage-view">
                    <p className="manage-text">{q.text}</p>
                    <ul className="manage-options">
                      {LETTERS.filter((l) => q.options[l]).map((l) => (
                        <li key={l} className={l === q.correct ? 'manage-option--right' : undefined}>
                          <strong>{l.toUpperCase()}</strong> {q.options[l]} {l === q.correct && <span className="sr-only">(correct)</span>}
                        </li>
                      ))}
                    </ul>
                    <p className="manage-foot">
                      {q.concepts.map((c) => <span key={c} className="chip-small">{conceptName[c] || c}</span>)}
                      {!q.explanation && <span className="manage-flag">No explanation</span>}
                      {q.editedAt && (
                        <span className="muted small">
                          Edited by {q.editedBy || 'someone'} · {new Date(q.editedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </span>
                      )}
                      <button className="btn btn--ghost btn--sm manage-edit" type="button"
                        onClick={() => { setNotice(null); setEditing(q.id); }}>Edit</button>
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </DashboardShell>
  );
}

/** One question's form: new or existing. */
function Editor({ quizId, id, start, concepts, onCancel, onSaved }) {
  const [q, setQ] = useState(start);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  const set = (field, value) => setQ((x) => ({ ...x, [field]: value }));
  const setOption = (l, value) => setQ((x) => ({ ...x, options: { ...x.options, [l]: value } }));
  const toggle = (slug) => set('concepts', q.concepts.includes(slug) ? q.concepts.filter((s) => s !== slug) : [...q.concepts, slug]);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const res = id
        ? await client.put(`/manage/questions/${id}`, q)
        : await client.post(`/manage/quizzes/${quizId}/questions`, q);
      const warn = res.data.warnings?.length ? ` Note: ${res.data.warnings.join('; ')}.` : '';
      onSaved(`${id ? 'Saved' : 'Question added'}. Students see it now.${warn}`);
    } catch (err) {
      setProblem(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Delete this question? Students will no longer see it. Scores already given stay as they are.')) return;
    setBusy(true);
    try {
      await client.delete(`/manage/questions/${id}`);
      onSaved('Question deleted.');
    } catch (err) {
      setProblem(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="manage-form" onSubmit={save}>
      <label className="field">
        <span>Question</span>
        <textarea rows={3} value={q.text} onChange={(e) => set('text', e.target.value)} required />
      </label>

      <fieldset className="manage-options-edit">
        <legend>Options: tick the right one. A and B are needed; leave the others empty if unused.</legend>
        {LETTERS.map((l) => (
          <div key={l} className="manage-option-row">
            <input type="radio" name="correct" value={l} checked={q.correct === l} onChange={() => set('correct', l)}
              aria-label={`Option ${l.toUpperCase()} is the right answer`} />
            <span className="manage-letter">{l.toUpperCase()}</span>
            <input type="text" value={q.options[l] || ''} onChange={(e) => setOption(l, e.target.value)}
              maxLength={255} aria-label={`Option ${l.toUpperCase()}`} />
          </div>
        ))}
      </fieldset>

      <label className="field">
        <span>Explanation, shown after answering</span>
        <textarea rows={2} value={q.explanation} onChange={(e) => set('explanation', e.target.value)} />
      </label>

      <fieldset className="manage-concepts">
        <legend>Concepts it practises</legend>
        {concepts.map((c) => (
          <label key={c.slug} className={`chip-pick${q.concepts.includes(c.slug) ? ' chip-pick--on' : ''}`}>
            <input type="checkbox" className="sr-only" checked={q.concepts.includes(c.slug)} onChange={() => toggle(c.slug)} />
            {c.name}
          </label>
        ))}
      </fieldset>

      {problem && <p className="alert" role="alert">{problem}</p>}

      <div className="manage-actions">
        <button className="btn btn--sm" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="btn btn--ghost btn--sm" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        {id && <button className="btn btn--ghost btn--sm manage-delete" type="button" onClick={remove} disabled={busy}>Delete</button>}
      </div>
    </form>
  );
}

/** A new, empty quiz in a chosen topic. */
function NewQuiz({ topics, onMade }) {
  const [open, setOpen] = useState(false);
  const [topicId, setTopicId] = useState(topics[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [problem, setProblem] = useState(null);

  if (!open) return <button className="btn btn--ghost btn--sm" type="button" onClick={() => setOpen(true)}>New quiz</button>;

  async function make(e) {
    e.preventDefault();
    setProblem(null);
    try {
      const res = await client.post('/manage/quizzes', { topicId: Number(topicId), title });
      setOpen(false);
      setTitle('');
      onMade(res.data);
    } catch (err) {
      setProblem(err.message);
    }
  }

  return (
    <form className="manage-newquiz" onSubmit={make}>
      <select value={topicId} onChange={(e) => setTopicId(e.target.value)} aria-label="Topic">
        {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Quiz title" aria-label="Quiz title" required />
      <button className="btn btn--sm" type="submit">Create</button>
      <button className="btn btn--ghost btn--sm" type="button" onClick={() => setOpen(false)}>Cancel</button>
      {problem && <p className="alert" role="alert">{problem}</p>}
    </form>
  );
}
