import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import DashboardShell from '../components/DashboardShell';
import ClassReport from '../components/ClassReport';
import SchoolPanel from '../components/SchoolPanel';
import { client } from '../api/client';

/*
 * Every class across the programme, and one class in detail.
 *
 * The rollup is worked out from each class's own report rather than from a
 * separate programme query, so the totals here can never disagree with the
 * numbers a teacher sees for their own class. At pilot scale that is a handful
 * of requests; if the programme grows past a dozen classes this wants a single
 * rollup endpoint instead.
 */
export default function CoordinatorDash() {
  const [classes, setClasses] = useState(null);
  const [rollup, setRollup] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    client.get('/classes')
      .then(async (res) => {
        if (!live) return;
        setClasses(res.data);

        const reports = await Promise.all(
          res.data.map((c) =>
            client.get(`/analytics/classes/${c.id}`)
              .then((r) => ({ ...c, report: r.data }))
              .catch(() => ({ ...c, report: null }))),
        );
        if (live) setRollup(reports);
      })
      .catch((err) => live && setError(err.message));
    return () => { live = false; };
  }, []);

  if (error) {
    return (
      <DashboardShell title="Across the programme">
        <p className="alert" role="alert">{error}</p>
      </DashboardShell>
    );
  }

  if (!classes) {
    return (
      <DashboardShell title="Across the programme">
        <p className="muted">Loading…</p>
      </DashboardShell>
    );
  }

  const students = rollup.reduce((n, c) => n + (c.report?.byStudent.length ?? 0), 0);
  const attempts = rollup.reduce(
    (n, c) => n + (c.report?.byStudent.reduce((s, x) => s + x.attempts, 0) ?? 0), 0,
  );
  const started = rollup.reduce(
    (n, c) => n + (c.report?.byStudent.filter((x) => x.attempts > 0).length ?? 0), 0,
  );

  return (
    <DashboardShell title="Across the programme">
      <section className="practice-cta">
        <div>
          <p className="practice-title">Question generator</p>
          <p className="practice-sub">
            Turn a Spoken Tutorial video into quiz questions with Gemini, then review them before students see them.
          </p>
        </div>
        <Link className="btn btn--sm" to="/content">Open generator</Link>
      </section>

      <div className="stat-row">
        <Stat label="Classes" value={classes.length} />
        <Stat label="Students" value={students} />
        <Stat label="Have started" value={`${started} of ${students}`} />
        <Stat label="Attempts" value={attempts} />
      </div>

      <h2 className="h2">Classes</h2>
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Class</th>
            <th scope="col">Teacher</th>
            <th scope="col">Students</th>
            <th scope="col">Started</th>
            <th scope="col">Average</th>
            <th scope="col"><span className="sr-only">Open</span></th>
          </tr>
        </thead>
        <tbody>
          {rollup.map((c) => {
            const rows = c.report?.byStudent ?? [];
            const active = rows.filter((s) => s.attempts > 0);
            const average = active.length
              ? Math.round(active.reduce((s, x) => s + x.averagePercent, 0) / active.length)
              : null;
            return (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className="muted">{c.teacherName || '—'}</td>
                <td>{rows.length}</td>
                <td>{active.length}</td>
                <td>{average === null ? <span className="muted">No attempts yet</span> : `${average}%`}</td>
                <td>
                  <button
                    className="btn btn--ghost btn--sm"
                    type="button"
                    onClick={() => setSelected(selected === c.id ? null : c.id)}
                  >
                    {selected === c.id ? 'Hide' : 'Open'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {selected && (
        <div className="drill">
          <h2 className="h2">{classes.find((c) => c.id === selected)?.name}</h2>
          <ClassReport
            classId={selected}
            className={classes.find((c) => c.id === selected)?.name}
          />
        </div>
      )}

      <h2 className="h2">School database</h2>
      <SchoolPanel />

      <p className="muted small note-foot">
        Editing content is a coordinator's job under Section 4 of the HLD, and
        those tools arrive in Week 9.
      </p>
    </DashboardShell>
  );
}

function Stat({ label, value, note }) {
  return (
    <div className="stat">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {note && <p className="stat-note">{note}</p>}
    </div>
  );
}
