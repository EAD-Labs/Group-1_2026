import { Link } from 'react-router-dom';
import DashboardShell from '../components/DashboardShell';
import GameTile from '../components/GameTile';
import { auth } from '../utils/auth';
import { useApi } from '../utils/useApi';

/*
 * Home: what to do next, and nothing else. Everything else has its own tab —
 * all topics under Learn, all games under Play, the full picture under
 * Progress — so this page stays short enough to read at a glance.
 */
const NEW_KINDS = ['parsons', 'predict', 'bughunt', 'fillblank'];

export default function StudentHome() {
  const user = auth.getCurrentUser();
  const first = user.name.split(' ')[0];
  const { loading, error, data } = useApi([`/progress/${user.id}`, '/quizzes', '?/games', '?/practice/mastery']);

  if (loading || error) {
    return (
      <DashboardShell title={`Hello, ${first}`}>
        {error ? <p className="alert" role="alert">{error}</p> : <p className="muted">Loading…</p>}
      </DashboardShell>
    );
  }

  const [progress, quizzes, games, concepts] = data;
  const { summary, topics } = progress;
  const quizFor = (topicId) => quizzes.find((q) => q.topicId === topicId);

  // The weakest topic already started, or else the first one not yet touched.
  const weakest = topics.filter((t) => t.attempts > 0 && t.bestPercent < 80)
    .sort((a, b) => a.bestPercent - b.bestPercent)[0];
  const next = weakest || topics.find((t) => t.attempts === 0 && quizFor(t.topicId));
  const nextQuiz = next && quizFor(next.topicId);

  const practisable = concepts.filter((c) => c.questions > 0);
  const due = practisable.filter((c) => c.status === 'review').length;
  const focus = practisable.filter((c) => c.answered > 0 && c.status === 'learning')
    .sort((a, b) => a.p - b.p).slice(0, 3);

  // New kinds of game first, then anything not yet played.
  const toTry = [...games]
    .filter((g) => !g.attempts)
    .sort((a, b) => (NEW_KINDS.includes(b.kind) - NEW_KINDS.includes(a.kind)) || a.level - b.level)
    .slice(0, 3);

  return (
    <DashboardShell title={`Hello, ${first}`}>
      <div className="home-grid">
        {nextQuiz ? (
          <section className="hero home-hero">
            <div className="hero-row">
              <div>
                <p className="hero-eyebrow">{next.attempts > 0 ? 'Pick up where you left off' : 'Start here'}</p>
                <p className="hero-title">{next.topic}</p>
                <p className="hero-sub">
                  {next.attempts > 0
                    ? `Best so far ${next.bestPercent}% · ${next.attempts} attempt${next.attempts > 1 ? 's' : ''}`
                    : 'Not started yet'}
                </p>
              </div>
              <Link className="btn btn--onbrand" to={`/quiz/${nextQuiz.id}`}>
                {next.attempts > 0 ? 'Try again' : 'Start'}
              </Link>
            </div>
            <div className="bar"><span style={{ width: `${next.attempts ? next.bestPercent : 0}%` }} /></div>
          </section>
        ) : (
          <section className="empty home-hero">No questions have been loaded yet. Your teacher will add them soon.</section>
        )}

        {practisable.length > 0 && (
          <Link className="home-card home-practice" to="/practice">
            <span className="home-card-icon" aria-hidden="true">🎯</span>
            <span className="home-card-title">Adaptive practice</span>
            <span className="home-card-sub">
              {due > 0 ? `${due} concept${due > 1 ? 's' : ''} due for review · ` : ''}
              10 questions picked for you
            </span>
            <span className="home-card-go" aria-hidden="true">→</span>
          </Link>
        )}

        <Link className="home-card" to="/me">
          <span className="home-card-icon" aria-hidden="true">📈</span>
          <span className="home-card-title">{summary.topicsLearnt} of {summary.topics} topics finished</span>
          <span className="home-card-sub">
            {practisable.filter((c) => c.status === 'mastered' || c.status === 'review').length} of {practisable.length} concepts mastered
          </span>
          <span className="home-card-go" aria-hidden="true">→</span>
        </Link>
      </div>

      {focus.length > 0 && (
        <>
          <h2 className="h2">Focus on</h2>
          <ul className="focus">
            {focus.map((c) => (
              <li key={c.slug}>
                <span className="focus-name">{c.name}</span>
                <span className="concept-bar"><span style={{ width: `${c.p}%` }} /></span>
                <span className="focus-p">{c.p}%</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {toTry.length > 0 && (
        <>
          <div className="section-head">
            <h2 className="h2">Try a game</h2>
            <Link className="see-all" to="/play">All games →</Link>
          </div>
          <ul className="tiles">
            {toTry.map((g) => <li key={g.id}><GameTile game={g} /></li>)}
          </ul>
        </>
      )}
    </DashboardShell>
  );
}
