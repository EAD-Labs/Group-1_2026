import { useEffect, useState } from 'react';
import { client } from '../api/client';

/*
 * Students down the side, concepts across the top, each cell the mastery
 * model's estimate. Darker is better known. A teacher reads it two ways: a
 * pale row is a student who needs help, a pale column is a concept the whole
 * class needs retaught.
 */
export default function MasteryHeatmap({ classId }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });

  useEffect(() => {
    let live = true;
    setState({ loading: true, error: null, data: null });
    client.get(`/analytics/classes/${classId}/mastery`)
      .then((res) => live && setState({ loading: false, error: null, data: res.data }))
      .catch((err) => live && setState({ loading: false, error: err.message, data: null }));
    return () => { live = false; };
  }, [classId]);

  if (state.loading) return <p className="muted">Loading…</p>;
  if (state.error) return <p className="alert" role="alert">{state.error}</p>;

  const { concepts, students, averages, thresholds } = state.data;
  const anyData = students.some((s) => Object.keys(s.cells).length);
  if (!anyData) {
    return <p className="empty">No answers yet. The map fills in as students take quizzes and practise.</p>;
  }

  // The weakest concepts, still below the ready bar, that at least half the
  // class has attempted.
  const weakest = concepts
    .filter((c) => averages[c.slug] && averages[c.slug].students >= Math.ceil(students.length / 2))
    .filter((c) => averages[c.slug].p < thresholds.ready)
    .sort((a, b) => averages[a.slug].p - averages[b.slug].p)
    .slice(0, 2);

  return (
    <>
      {weakest.length > 0 && (
        <p className="revisit">
          <strong>Class-wide gap:</strong>{' '}
          {weakest.map((c) => `${c.name} (${averages[c.slug].p}%)`).join(' and ')}
          {' '}— worth reteaching to everyone.
        </p>
      )}

      <div className="heatmap-wrap">
        <table className="heatmap">
          <thead>
            <tr>
              <th scope="col" className="heatmap-corner">Student</th>
              {concepts.map((c) => <th key={c.slug} scope="col"><span>{c.name}</span></th>)}
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id}>
                <th scope="row">{s.name}</th>
                {concepts.map((c) => <Cell key={c.slug} cell={s.cells[c.slug]} mastered={thresholds.mastered} />)}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Class average</th>
              {concepts.map((c) => <Cell key={c.slug} cell={averages[c.slug]} mastered={thresholds.mastered} />)}
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="heatmap-legend muted small">
        <span className="legend-swatch" style={{ '--p': 0.1 }} /> not known
        <span className="legend-swatch" style={{ '--p': 0.5 }} /> learning
        <span className="legend-swatch" style={{ '--p': 0.95 }} /> mastered ({thresholds.mastered}%+)
        · — no answers yet. Estimates use Bayesian Knowledge Tracing.
      </p>
    </>
  );
}

function Cell({ cell, mastered }) {
  if (!cell) return <td className="heat heat--none">—</td>;
  const title = cell.answered !== undefined
    ? `${cell.p}% · ${cell.correct} of ${cell.answered} right${cell.status === 'review' ? ' · review due' : ''}`
    : `${cell.p}% average over ${cell.students} student${cell.students === 1 ? '' : 's'}`;
  return (
    <td className={`heat${cell.p >= 55 ? ' heat--dark' : ''}`} style={{ '--p': cell.p / 100 }} title={title}>
      {cell.p}{cell.p >= mastered ? ' ✓' : ''}
    </td>
  );
}
