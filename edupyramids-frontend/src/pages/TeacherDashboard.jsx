import { useEffect, useState } from 'react';
import DashboardShell from '../components/DashboardShell';
import ClassReport from '../components/ClassReport';
import { client } from '../api/client';

/*
 * A teacher's view of their own class.
 *
 * The class list comes from the server, which only returns classes this teacher
 * owns. The interface never chooses a class id for itself, and asking for
 * someone else's is refused by the API anyway.
 */
export default function TeacherDashboard() {
  const [classes, setClasses] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    client.get('/classes')
      .then((res) => {
        if (!live) return;
        setClasses(res.data);
        setSelected(res.data[0]?.id ?? null);
      })
      .catch((err) => live && setError(err.message));
    return () => { live = false; };
  }, []);

  if (error) {
    return (
      <DashboardShell title="Your class">
        <p className="alert" role="alert">{error}</p>
      </DashboardShell>
    );
  }

  if (!classes) {
    return <DashboardShell title="Your class"><p className="muted">Loading…</p></DashboardShell>;
  }

  if (classes.length === 0) {
    return (
      <DashboardShell title="Your class">
        <p className="muted">
          No class has been assigned to you yet. A coordinator sets this up.
        </p>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell title="Your class">
      {classes.length > 1 && (
        <div className="field field--inline">
          <label htmlFor="class">Class</label>
          <select id="class" value={selected} onChange={(e) => setSelected(Number(e.target.value))}>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      {selected && (
        <ClassReport
          classId={selected}
          className={classes.find((c) => c.id === selected)?.name}
        />
      )}
    </DashboardShell>
  );
}
