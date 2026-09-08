import { useEffect, useState } from 'react';
import { client } from '../api/client';

/*
 * The connection to the school's own database.
 *
 * Read-only, and separate from ours: quizzes, attempts and progress live in the
 * EduPyramids database, while this one supplies identity and the roster. It is
 * shown to coordinators only, because it is a roster of over a million real
 * people.
 */
export default function SchoolPanel() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  const [term, setTerm] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  useEffect(() => {
    let live = true;
    client.get('/school/stats')
      .then((r) => live && setStats(r.data))
      .catch((err) => live && setError(err.message));
    return () => { live = false; };
  }, []);

  async function search(event) {
    event.preventDefault();
    if (term.trim().length < 3) {
      setSearchError('Search for at least three characters');
      return;
    }
    setSearchError('');
    setSearching(true);
    try {
      const res = await client.get(`/school/students?q=${encodeURIComponent(term.trim())}`);
      setResults(res.data);
    } catch (err) {
      setSearchError(err.message);
      setResults(null);
    } finally {
      setSearching(false);
    }
  }

  if (error) return <p className="alert" role="alert">{error}</p>;
  if (!stats) return <p className="muted">Checking the school database…</p>;

  if (!stats.connected) {
    return (
      <p className="empty">
        The school database is not connected. Everything else works without it;
        only the roster lookup below needs it.
      </p>
    );
  }

  const n = (v) => Number(v).toLocaleString();

  return (
    <>
      <div className="stat-row">
        <Stat label="Accounts" value={n(stats.accounts)} note="read-only" />
        <Stat label="Student records" value={n(stats.students)}
          note={`${n(stats.approved)} approved`} />
        <Stat label="Centres" value={n(stats.centres)} />
        <Stat label="Batches" value={n(stats.batches)} />
      </div>

      <p className="callout">
        Read-only. EduPyramids owns no tables in the school database and writes
        nothing to it — classes, quizzes and results are kept separately.
        Levels in use there: {stats.levels.map((l) => l.name).join(', ')}.
      </p>

      <form className="field field--inline" onSubmit={search} style={{ marginTop: '1rem' }}>
        <label htmlFor="roster">Find someone on the roster</label>
        <input
          id="roster"
          type="search"
          value={term}
          placeholder="name or email"
          onChange={(e) => setTerm(e.target.value)}
          style={{ maxWidth: '16rem' }}
        />
        <button className="btn btn--sm" type="submit" disabled={searching}>
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>
      {searchError && <p className="field-error">{searchError}</p>}

      {results && (results.length === 0 ? (
        <p className="muted small">Nobody on the roster matches that.</p>
      ) : (
        <table className="table" style={{ marginTop: '0.75rem' }}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Admission no.</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.id}>
                <td>{r.name || <span className="muted">no name recorded</span>}</td>
                <td>{r.email}</td>
                <td>{r.admissionNumber || <span className="muted">—</span>}</td>
                <td>
                  {r.status
                    ? <span className="role-chip">{r.status}</span>
                    : <span className="muted">not a student</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
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
