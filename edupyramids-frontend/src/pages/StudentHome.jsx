import { Link } from 'react-router-dom';
import DashboardShell from '../components/DashboardShell';
import Path from '../components/Path';
import { DailyStrip } from '../components/Daily';
import { ClassGoalCard } from '../components/ClassGoal';
import { kindOf } from '../games/registry';
import { auth } from '../utils/auth';
import { useApi } from '../utils/useApi';

/*
 * Home is the path: the whole course as one road, with the next step marked.
 * Above it only three slim rows: today (streak and goal), what is next, and
 * the class goal, so the road itself starts on the first screen. Reviews
 * are nodes on the road; mastery details live in Practice and Progress.
 */
const hrefOf = (next) => ({ quiz: `/quiz/${next.id}`, game: `/game/${next.id}`, checkpoint: `/checkpoint/${next.id}` }[next.type]);
const kindLabel = (next) => ({ quiz: 'Quiz', checkpoint: 'Checkpoint' }[next.type] || kindOf(next.kind).label);

export default function StudentHome() {
  const user = auth.getCurrentUser();
  const first = user.name.split(' ')[0];
  const { loading, error, data } = useApi(['/path', '?/practice/mastery', '?/me/daily', '?/me/classes']);

  if (loading || error) {
    return (
      <DashboardShell title={`Hello, ${first}`}>
        {error ? <p className="alert" role="alert">{error}</p> : <p className="muted">Loading…</p>}
      </DashboardShell>
    );
  }

  const [{ units, next }, , daily, classes] = data;

  return (
    <DashboardShell title={`Hello, ${first}`}>
      {daily?.streak && <DailyStrip daily={daily} />}

      {next ? (
        <Link className="up-next" to={hrefOf(next)}>
          <span className="up-next-text">
            <span className="up-next-eyebrow">Up next · {next.topic} · {kindLabel(next)}</span>
            <span className="up-next-title">{next.title}</span>
          </span>
          <span className="up-next-go">Start →</span>
        </Link>
      ) : units.length > 0 && (
        <p className="up-next up-next--done">You have finished the whole path! 🎉 Go back for three stars, or keep concepts fresh in Practice.</p>
      )}

      {classes.map((c) => <ClassGoalCard key={c.classId} week={c} mine={c.mine} compact />)}

      {units.length === 0
        ? <p className="empty">Nothing to learn yet. Your teacher will add questions soon.</p>
        : <Path units={units} />}
    </DashboardShell>
  );
}
