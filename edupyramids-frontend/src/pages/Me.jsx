import DashboardShell from '../components/DashboardShell';
import ConceptMap from '../components/ConceptMap';
import OfflineCard from '../offline/OfflineCard';
import { auth } from '../utils/auth';
import { useState } from 'react';
import { useApi } from '../utils/useApi';
import { DailyStrip, GoalSettings } from '../components/Daily';

/*
 * Progress: the whole picture in one place — topics finished, what the
 * mastery model thinks of each concept, and badges earned. It follows topics
 * learnt, never time spent (HLD D-04).
 */
export default function Me() {
  const user = auth.getCurrentUser();
  const { loading, error, data } = useApi([`/progress/${user.id}`, '?/practice/mastery', '?/me/daily', '?/path']);
  const [changed, setChanged] = useState(null);

  if (loading || error) {
    return (
      <DashboardShell title="Your progress">
        {error ? <p className="alert" role="alert">{error}</p> : <p className="muted">Loading…</p>}
      </DashboardShell>
    );
  }

  const [{ summary, badges }, concepts, loaded, path] = data;
  // A tier is built when every brick in it, keystone included, is set.
  const tiers = path?.units ?? [];
  const built = tiers.filter((u) => u.progress.total > 0 && u.progress.done === u.progress.total).length;
  const daily = changed || loaded;
  const practisable = concepts.filter((c) => c.questions > 0);
  const mastered = practisable.filter((c) => c.status === 'mastered' || c.status === 'review').length;

  return (
    <DashboardShell title="Your progress">
      {daily?.streak && <DailyStrip daily={daily} />}

      <div className="stat-row">
        <Stat label="Tiers built" value={`${built} / ${tiers.length}`} note="every brick set" />
        <Stat label="Concepts mastered" value={`${mastered} / ${practisable.length}`} note="95% estimated" />
        <Stat label="Quizzes and games" value={summary.attempts} note="finished" />
        <Stat label="Badges" value={badges.length} />
      </div>

      {daily?.streak && <GoalSettings daily={daily} onChange={setChanged} />}

      <OfflineCard />

      {practisable.length > 0 && (
        <>
          <h2 className="h2">Your concepts</h2>
          <p className="muted small page-intro">
            How sure the app is that you know each concept, from every answer you have given.
            Right answers raise it; a lucky guess counts for less than a steady run.
          </p>
          <ConceptMap concepts={concepts} />
        </>
      )}

      <h2 className="h2">Badges</h2>
      {badges.length === 0 ? (
        <p className="empty">
          No badges yet. Badges are earned by doing well on a topic — not by logging in, and never by a daily streak.
        </p>
      ) : (
        <ul className="badges">
          {badges.map((b) => (
            <li key={b.id} className="badge">
              <span className="badge-emblem" aria-hidden="true">🏅</span>
              <strong>{b.badgeName}</strong>
              <span className="muted small">{b.topic}</span>
            </li>
          ))}
        </ul>
      )}
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
