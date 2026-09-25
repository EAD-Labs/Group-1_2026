import { Link } from 'react-router-dom';
import DashboardShell from '../components/DashboardShell';
import Pyramid from '../components/Pyramid';
import { DailyStrip } from '../components/Daily';
import { ClassGoalCard } from '../components/ClassGoal';
import { kindOf } from '../games/registry';
import { auth } from '../utils/auth';
import { useApi } from '../utils/useApi';

/*
 * Home is the student's pyramid: the whole course, built brick by brick from
 * the foundation up, with the next brick marked. Above it only three slim
 * rows: today (build streak and goal), the next brick, and the class goal.
 * Fading concepts are cracked bricks; mastery details live in Practice and
 * Progress.
 */
const hrefOf = (next) => ({
  quiz: `/quiz/${next.id}${next.lesson ? `?lesson=${next.lesson}` : ''}`,
  game: `/game/${next.id}`,
  checkpoint: `/checkpoint/${next.id}`,
}[next.type]);
const kindLabel = (next) => ({ quiz: next.lesson ? 'Lesson' : 'Quiz', checkpoint: 'Keystone' }[next.type] || kindOf(next.kind).label);

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
            <span className="up-next-eyebrow">Next brick · {next.topic} · {kindLabel(next)}</span>
            <span className="up-next-title">{next.title}</span>
          </span>
          <span className="up-next-go">Build →</span>
        </Link>
      ) : units.length > 0 && (
        <p className="up-next up-next--done">Your pyramid is complete! 🔺 Go back for gold bricks (three stars), or keep concepts fresh in Practice.</p>
      )}

      {classes.map((c) => <ClassGoalCard key={c.classId} week={c} mine={c.mine} compact />)}

      {units.length === 0
        ? <p className="empty">Nothing to learn yet. Your teacher will add questions soon.</p>
        : <Pyramid units={units} />}
    </DashboardShell>
  );
}
