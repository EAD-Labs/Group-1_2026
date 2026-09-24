import { Link } from 'react-router-dom';
import DashboardShell from '../components/DashboardShell';
import Path from '../components/Path';
import { DailyStrip } from '../components/Daily';
import { kindOf } from '../games/registry';
import { auth } from '../utils/auth';
import { useApi } from '../utils/useApi';

/*
 * Home is the path: the whole course as one road, with the next step marked.
 * One question answered at a glance, "what do I do now?", and the rest of
 * the road below it. Mastery details live in Practice and Progress.
 */
const hrefOf = (next) => ({ quiz: `/quiz/${next.id}`, game: `/game/${next.id}`, checkpoint: `/checkpoint/${next.id}` }[next.type]);
const kindLabel = (next) => ({ quiz: 'Quiz', checkpoint: 'Checkpoint' }[next.type] || kindOf(next.kind).label);

export default function StudentHome() {
  const user = auth.getCurrentUser();
  const first = user.name.split(' ')[0];
  const { loading, error, data } = useApi(['/path', '?/practice/mastery', '?/me/daily']);

  if (loading || error) {
    return (
      <DashboardShell title={`Hello, ${first}`}>
        {error ? <p className="alert" role="alert">{error}</p> : <p className="muted">Loading…</p>}
      </DashboardShell>
    );
  }

  const [{ units, next }, concepts, daily] = data;
  const due = concepts.filter((c) => c.questions > 0 && c.status === 'review').length;

  return (
    <DashboardShell title={`Hello, ${first}`}>
      {daily?.streak && <DailyStrip daily={daily} />}

      {next ? (
        <section className="hero home-next">
          <div className="hero-row">
            <div>
              <p className="hero-eyebrow">Up next · {next.topic}</p>
              <p className="hero-title">{next.title}</p>
              <p className="hero-sub">{kindLabel(next)}</p>
            </div>
            <Link className="btn btn--onbrand" to={hrefOf(next)}>Start</Link>
          </div>
        </section>
      ) : units.length > 0 && (
        <section className="hero home-next">
          <p className="hero-title">You have finished the whole path! 🎉</p>
          <p className="hero-sub">Go back for three stars, or keep your concepts fresh in Practice.</p>
        </section>
      )}

      {due > 0 && (
        <Link className="home-card home-practice home-review" to="/practice">
          <span className="home-card-icon" aria-hidden="true">🔁</span>
          <span className="home-card-title">{due} concept{due > 1 ? 's' : ''} due for review</span>
          <span className="home-card-sub">A few questions now stop them fading</span>
          <span className="home-card-go" aria-hidden="true">→</span>
        </Link>
      )}

      {units.length === 0
        ? <p className="empty">Nothing to learn yet. Your teacher will add questions soon.</p>
        : <Path units={units} />}
    </DashboardShell>
  );
}
