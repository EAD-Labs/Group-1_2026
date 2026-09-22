import { useEffect, useState } from 'react';
import { client } from '../api/client';
import MasteryHeatmap from './MasteryHeatmap';

/*
 * One class, reported on. Shared by the teacher dashboard (their own class) and
 * the coordinator dashboard (any class), because the two views are the same
 * report — what differs is which classes you are allowed to ask for, and the
 * server decides that, not this component.
 *
 * Every figure comes from the analytics endpoint, which works it out from the
 * attempts table. Nothing is calculated twice in two places.
 */
export default function ClassReport({ classId, className }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    let live = true;
    setState({ loading: true, error: null, data: null });
    setOpenId(null);
    client.get(`/analytics/classes/${classId}`)
      .then((res) => live && setState({ loading: false, error: null, data: res.data }))
      .catch((err) => live && setState({ loading: false, error: err.message, data: null }));
    return () => { live = false; };
  }, [classId]);

  if (state.loading) return <p className="muted">Loading…</p>;
  if (state.error) return <p className="alert" role="alert">{state.error}</p>;

  const { byTopic, byStudent, hardestQuestions = [] } = state.data;

  // Only the ones that actually went badly. A question the class got right is
  // not something to reteach.
  const reteach = hardestQuestions.filter((q) => q.percentCorrect < 100).slice(0, 5);

  const attempted = byStudent.filter((s) => s.attempts > 0);
  const notStarted = byStudent.length - attempted.length;
  const classAverage = attempted.length
    ? Math.round(attempted.reduce((sum, s) => sum + s.averagePercent, 0) / attempted.length)
    : null;
  const totalAttempts = byStudent.reduce((sum, s) => sum + s.attempts, 0);

  const withData = byTopic.filter((t) => t.attempts > 0);
  const weakest = withData.length
    ? withData.reduce((low, t) => (t.averagePercent < low.averagePercent ? t : low))
    : null;

  // Students who have started and are below 50%. Sorted worst first, because
  // that is the order a teacher wants to work through them in.
  const struggling = attempted
    .filter((s) => s.averagePercent < 50)
    .sort((a, b) => a.averagePercent - b.averagePercent);

  function downloadCsv() {
    const rows = [
      ['Student', 'Email', 'Attempts', 'Average %'],
      ...byStudent.map((s) => [
        s.name, s.email, s.attempts,
        // Blank, not 0: a student who has not started has no average, and a 0
        // in a spreadsheet reads as a score of zero.
        s.averagePercent ?? '',
      ]),
    ];
    const csv = rows
      .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(className || 'class').replace(/\s+/g, '-').toLowerCase()}-report.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="stat-row">
        <Stat label="Students" value={byStudent.length} />
        <Stat
          label="Class average"
          value={classAverage === null ? '—' : `${classAverage}%`}
          note={classAverage === null ? 'no attempts yet' : `${attempted.length} started`}
        />
        <Stat label="Attempts" value={totalAttempts} />
        <Stat
          label="Weakest topic"
          value={weakest ? weakest.topic : '—'}
          note={weakest ? `${weakest.averagePercent}%` : 'no attempts yet'}
        />
      </div>

      {notStarted > 0 && (
        <p className="revisit">
          <strong>{notStarted} student{notStarted > 1 ? 's have' : ' has'} not started yet.</strong>{' '}
          They appear at the bottom of the table.
        </p>
      )}

      <div className="section-head">
        <h2 className="h2">Average by topic</h2>
      </div>
      <ul className="chart">
        {byTopic.map((t) => (
          <li key={t.topicId} className="chart-row">
            <span className="chart-label">{t.topic}</span>
            <span className="chart-track">
              <span className="chart-fill" style={{ width: `${t.attempts ? t.averagePercent : 0}%` }} />
            </span>
            <span className="chart-value muted small">
              {t.attempts ? `${t.averagePercent}%` : 'no attempts'}
            </span>
          </li>
        ))}
      </ul>

      <div className="section-head">
        <h2 className="h2">Concept mastery</h2>
      </div>
      <MasteryHeatmap classId={classId} />

      {struggling.length > 0 && (
        <>
          <h2 className="h2">Needs help</h2>
          <ul className="needs">
            {struggling.map((s) => (
              <li key={s.id}>
                <strong>{s.name}</strong>
                <span className="muted small">{s.averagePercent}% over {s.attempts} attempt
                  {s.attempts > 1 ? 's' : ''}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {reteach.length > 0 && (
        <>
          <h2 className="h2">Worth going over again</h2>
          <ol className="reteach">
            {reteach.map((q) => (
              <li key={q.id}>
                <span className="reteach-q">{q.text}</span>
                <span className="muted small">
                  {q.correct} of {q.seen} correct · {q.topic}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}

      <div className="section-head">
        <h2 className="h2">Students</h2>
        <button className="btn btn--ghost btn--sm" type="button" onClick={downloadCsv}>
          Download CSV
        </button>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th scope="col">Student</th>
            <th scope="col">Attempts</th>
            <th scope="col">Average</th>
          </tr>
        </thead>
        <tbody>
          {[...byStudent]
            .sort((a, b) => b.attempts - a.attempts || a.name.localeCompare(b.name))
            .map((s) => (
              <StudentRow key={s.id} student={s} open={openId === s.id}
                onToggle={() => setOpenId(openId === s.id ? null : s.id)} />
            ))}
        </tbody>
      </table>
    </>
  );
}

/*
 * One student, expandable. The average in the row is what the class report
 * knows; the attempts underneath are what it hides, which is the whole reason
 * a teacher clicks a name (HLD Section 5.2).
 */
function StudentRow({ student, open, onToggle }) {
  const [history, setHistory] = useState(null);

  useEffect(() => {
    if (!open || history || student.attempts === 0) return;
    let live = true;
    client.get(`/analytics/students/${student.id}`)
      .then((res) => live && setHistory(res.data.history))
      .catch(() => live && setHistory([]));
    return () => { live = false; };
  }, [open, history, student.id, student.attempts]);

  return (
    <>
      <tr className={open ? 'is-open' : undefined}>
        <td>
          {student.attempts === 0 ? (
            <>{student.name}</>
          ) : (
            <button type="button" className="linkish" onClick={onToggle}
              aria-expanded={open}>
              {student.name}
            </button>
          )}
          <span className="cell-sub muted small">{student.email}</span>
        </td>
        <td>{student.attempts}</td>
        <td>
          {/* Never 0% for someone who has not started. */}
          {student.attempts === 0
            ? <span className="muted">No attempts yet</span>
            : `${student.averagePercent}%`}
        </td>
      </tr>

      {open && (
        <tr className="drill">
          <td colSpan={3}>
            {history === null ? <span className="muted small">Loading…</span> : (
              <ul className="history">
                {history.map((h) => (
                  <li key={h.id}>
                    <span>{h.quiz || h.topic}</span>
                    <span className="muted small">
                      {h.score}/{h.maxScore} · {h.percent}% ·{' '}
                      {new Date(h.createdAt).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
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
