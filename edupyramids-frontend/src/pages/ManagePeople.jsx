import { useEffect, useState } from 'react';
import DashboardShell from '../components/DashboardShell';
import { client } from '../api/client';

/*
 * People: classes, their teachers and their students (HLD Section 4, "Manage
 * users", the coordinator's alone).
 *
 * Students are added by pasting a list, one per line: "Name, email" (or a
 * column copied from a spreadsheet). New accounts get a starting password that
 * is shown here once, with a sheet to download and hand out; it is not stored
 * anywhere it could be read again.
 */

/** "Asha Rao, asha@school.in" or "Asha Rao<TAB>asha@school.in" -> { name, email } */
function parseLines(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.split(/[,\t;]/).map((p) => p.trim()).filter(Boolean);
    const at = parts.findIndex((p) => p.includes('@'));
    if (at < 0) return { name: parts.join(' '), email: '' };
    return { name: parts.filter((_, i) => i !== at).join(' '), email: parts[at] };
  });
}

function downloadSheet(rows) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = ['Name,Email,Starting password,Class',
    ...rows.map((r) => [r.name, r.email, r.password, r.className].map(cell).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'edupyramids-logins.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export default function ManagePeople() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [logins, setLogins] = useState([]);      // new passwords this session, to hand out
  const [open, setOpen] = useState(null);         // class id shown in full

  const load = () => client.get('/people').then((res) => setData(res.data)).catch((err) => setError(err.message));
  useEffect(() => { load(); }, []);

  const remember = (rows) => setLogins((l) => [...rows, ...l]);

  if (error) return <DashboardShell title="People"><p className="alert" role="alert">{error}</p></DashboardShell>;
  if (!data) return <DashboardShell title="People"><p className="muted">Loading…</p></DashboardShell>;

  return (
    <DashboardShell title="People" wide>
      <p className="page-intro muted">
        Classes, teachers and students. New accounts get a starting password, shown once below to hand out.
      </p>

      {logins.length > 0 && (
        <section className="logins" aria-label="New passwords">
          <div className="logins-head">
            <h2 className="h2">New passwords to hand out</h2>
            <button className="btn btn--sm" type="button" onClick={() => downloadSheet(logins)}>Download sheet</button>
          </div>
          <p className="muted small">Shown only now. Download or write them down before leaving this page.</p>
          <table className="table logins-table">
            <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Starting password</th><th scope="col">Class</th></tr></thead>
            <tbody>
              {logins.map((r) => (
                <tr key={`${r.email}-${r.password}`}>
                  <td>{r.name}</td><td>{r.email}</td><td><code>{r.password}</code></td><td className="muted">{r.className}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <div className="people-forms">
        <NewTeacher onMade={(t) => { remember([{ ...t.teacher, password: t.password, className: 'Teacher' }]); load(); }} />
        <NewClass teachers={data.teachers} onMade={load} />
      </div>

      <h2 className="h2">Classes</h2>
      <ul className="people-classes">
        {data.classes.map((c) => (
          <ClassCard key={c.id} cls={c} teachers={data.teachers} open={open === c.id}
            onToggle={() => setOpen(open === c.id ? null : c.id)}
            onChanged={load} onLogins={remember} />
        ))}
      </ul>
    </DashboardShell>
  );
}

function ClassCard({ cls, teachers, open, onToggle, onChanged, onLogins }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(cls.name);
  const [teacherId, setTeacherId] = useState(cls.teacherId ?? '');
  const [list, setList] = useState('');
  const [results, setResults] = useState(null);
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);

  async function run(work) {
    setBusy(true);
    setProblem(null);
    try { await work(); } catch (err) { setProblem(err.message); } finally { setBusy(false); }
  }

  const save = () => run(async () => {
    await client.put(`/people/classes/${cls.id}`, { name, teacherId: Number(teacherId) });
    setEditing(false);
    onChanged();
  });

  const add = () => run(async () => {
    const lines = parseLines(list);
    if (!lines.length) throw new Error('Paste at least one line: Name, email');
    const res = await client.post(`/people/classes/${cls.id}/students`, { students: lines });
    setResults(res.data);
    onLogins(res.data.filter((r) => r.password).map((r) => ({ ...r, className: cls.name })));
    setList('');
    onChanged();
  });

  const reset = (s) => run(async () => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Give ${s.name} a new starting password? The old one stops working.`)) return;
    const res = await client.post(`/people/users/${s.id}/password`);
    onLogins([{ ...res.data, className: cls.name }]);
  });

  const remove = (s) => run(async () => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Take ${s.name} out of ${cls.name}? Their account and work stay.`)) return;
    await client.delete(`/people/classes/${cls.id}/students/${s.id}`);
    onChanged();
  });

  const STATUS = {
    created: 'new account', enrolled: 'added (had an account)', already: 'already in the class', refused: 'not added',
  };

  return (
    <li className="people-class">
      <div className="people-class-head">
        {editing ? (
          <span className="people-edit">
            <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Class name" />
            <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} aria-label="Teacher">
              {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button className="btn btn--sm" type="button" onClick={save} disabled={busy}>Save</button>
            <button className="btn btn--ghost btn--sm" type="button" onClick={() => setEditing(false)}>Cancel</button>
          </span>
        ) : (
          <>
            <span>
              <strong className="people-class-name">{cls.name}</strong>
              <span className="muted small"> · {cls.teacherName || 'no teacher'} · {cls.students.length} student{cls.students.length === 1 ? '' : 's'}</span>
            </span>
            <span className="people-class-tools">
              <button className="btn btn--ghost btn--sm" type="button" onClick={() => setEditing(true)}>Rename or change teacher</button>
              <button className="btn btn--ghost btn--sm" type="button" onClick={onToggle} aria-expanded={open}>
                {open ? 'Close' : 'Students'}
              </button>
            </span>
          </>
        )}
      </div>

      {problem && <p className="alert" role="alert">{problem}</p>}

      {open && (
        <div className="people-class-body">
          <label className="field">
            <span>Add students: one per line, "Name, email"</span>
            <textarea rows={4} value={list} onChange={(e) => setList(e.target.value)}
              placeholder={'Asha Rao, asha.rao@school.in\nVikram Das, vikram.das@school.in'} />
          </label>
          <button className="btn btn--sm" type="button" onClick={add} disabled={busy || !list.trim()}>
            {busy ? 'Adding…' : 'Add to class'}
          </button>

          {results && (
            <ul className="people-results">
              {results.map((r, i) => (
                <li key={i} className={`people-result people-result--${r.status}`}>
                  <strong>{r.name || '(no name)'}</strong> {r.email} · {STATUS[r.status]}{r.reason ? `: ${r.reason}` : ''}
                </li>
              ))}
            </ul>
          )}

          {cls.students.length === 0 ? <p className="muted">No students yet.</p> : (
            <table className="table people-students">
              <thead><tr><th scope="col">Student</th><th scope="col">Email</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {cls.students.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td className="muted">{s.email}</td>
                    <td className="people-row-tools">
                      <button className="btn btn--ghost btn--sm" type="button" onClick={() => reset(s)} disabled={busy}>New password</button>
                      <button className="btn btn--ghost btn--sm" type="button" onClick={() => remove(s)} disabled={busy}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </li>
  );
}

function NewTeacher({ onMade }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [problem, setProblem] = useState(null);
  async function make(e) {
    e.preventDefault();
    setProblem(null);
    try {
      const res = await client.post('/people/teachers', { name, email });
      setName(''); setEmail('');
      onMade(res.data);
    } catch (err) { setProblem(err.message); }
  }
  return (
    <form className="people-form" onSubmit={make}>
      <h3>New teacher</h3>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Teacher's name" required />
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" aria-label="Teacher's email" required />
      <button className="btn btn--sm" type="submit">Add teacher</button>
      {problem && <p className="alert" role="alert">{problem}</p>}
    </form>
  );
}

function NewClass({ teachers, onMade }) {
  const [name, setName] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [problem, setProblem] = useState(null);
  async function make(e) {
    e.preventDefault();
    setProblem(null);
    try {
      await client.post('/people/classes', { name, teacherId: Number(teacherId) });
      setName('');
      onMade();
    } catch (err) { setProblem(err.message); }
  }
  return (
    <form className="people-form" onSubmit={make}>
      <h3>New class</h3>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Class name, e.g. Grade 9 Neem" aria-label="Class name" required />
      <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} aria-label="Teacher" required>
        <option value="">Choose the teacher</option>
        {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <button className="btn btn--sm" type="submit">Add class</button>
      {problem && <p className="alert" role="alert">{problem}</p>}
    </form>
  );
}
