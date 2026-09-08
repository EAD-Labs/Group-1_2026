import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import DashboardShell from '../components/DashboardShell';
import { client } from '../api/client';
import { auth } from '../utils/auth';

/*
 * The student's own view, following the reference design: a green hero card
 * that picks up where they left off, then the topics as tiles.
 *
 * Everything is worked out from attempts the student actually made, so a new
 * account correctly looks empty instead of looking used.
 */

// An icon per topic. Falls back to a book, so a topic the client adds later
// still renders rather than leaving a hole.
const ICONS = {
  'Bronze Level': '🥉',
  'Silver Level': '🥈',
  'Gold Level': '🥇',
  'Post-test': '🎓',
};
const icon = (name) => ICONS[name] || '📘';

export default function StudentDashboard() {
  const user = auth.getCurrentUser();
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [quizzes, setQuizzes] = useState([]);

  useEffect(() => {
    let live = true;
    Promise.all([client.get(`/progress/${user.id}`), client.get('/quizzes')])
      .then(([progress, quizList]) => {
        if (!live) return;
        setQuizzes(quizList.data);
        setState({ loading: false, error: null, data: progress.data });
      })
      .catch((err) => live && setState({ loading: false, error: err.message, data: null }));
    return () => { live = false; };
  }, [user.id]);

  if (state.loading) {
    return <DashboardShell title="Your Python practice"><p className="muted">Loading…</p></DashboardShell>;
  }
  if (state.error) {
    return (
      <DashboardShell title="Your Python practice">
        <p className="alert" role="alert">{state.error}</p>
      </DashboardShell>
    );
  }

  const { summary, topics, badges } = state.data;
  const quizFor = (topicId) => quizzes.find((q) => q.topicId === topicId);

  // What to offer in the hero: the weakest topic already started, or failing
  // that the first topic with a quiz that has not been touched.
  const started = topics.filter((t) => t.attempts > 0);
  const weakest = started.filter((t) => t.bestPercent < 80)
    .sort((a, b) => a.bestPercent - b.bestPercent)[0];
  const next = weakest || topics.find((t) => t.attempts === 0 && quizFor(t.topicId));
  const nextQuiz = next && quizFor(next.topicId);

  return (
    <DashboardShell
      title={`Hello, ${user.name.split(' ')[0]}`}
      done={`${summary.topicsLearnt}/${summary.topics}`}
    >
      {nextQuiz ? (
        <section className="hero">
          <div className="hero-row">
            <div>
              <p className="hero-eyebrow">
                {next.attempts > 0 ? 'Pick up where you left off' : 'Start here'}
              </p>
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
          <div className="bar">
            <span style={{ width: `${next.attempts ? next.bestPercent : 0}%` }} />
          </div>
        </section>
      ) : (
        <section className="empty">
          No questions have been loaded yet. Your teacher will add them soon.
        </section>
      )}

      <h2 className="h2">Topics</h2>
      <ul className="tiles">
        {topics.map((t) => {
          const quiz = quizFor(t.topicId);
          const attempted = t.attempts > 0;
          const inner = (
            <>
              <span className="tile-icon" aria-hidden="true">{icon(t.topic)}</span>
              <span className="tile-name">{t.topic}</span>
              <span className="tile-bar">
                <span style={{ width: `${attempted ? t.bestPercent : 0}%` }} />
              </span>
              <span className="tile-meta">
                {!quiz ? 'No questions yet'
                  : attempted ? `Best ${t.bestPercent}%`
                    : 'Not started'}
              </span>
            </>
          );
          return quiz ? (
            <li key={t.topicId}>
              <Link className={`tile tile--l${t.level}`} to={`/quiz/${quiz.id}`}>
                {inner}
              </Link>
            </li>
          ) : (
            <li key={t.topicId} className={`tile tile--l${t.level} tile--locked`}>
              {inner}
            </li>
          );
        })}
      </ul>

      <h2 className="h2">Your progress</h2>
      <div className="card" style={{ padding: '1.15rem' }}>
        <div className="compare">
          <Row label="Topics finished" value={`${summary.topicsLearnt} of ${summary.topics}`}
            percent={summary.percentDone} />
          <Row label="Topics started" value={`${summary.topicsStarted} of ${summary.topics}`}
            percent={summary.topics ? (summary.topicsStarted / summary.topics) * 100 : 0} muted />
        </div>
        <p className="callout">
          {summary.attempts === 0
            ? 'Finish your first quiz to start filling this in.'
            : `${summary.attempts} quiz${summary.attempts > 1 ? 'zes' : ''} taken so far. `
              + 'This follows topics learnt, not time spent.'}
        </p>
      </div>

      <h2 className="h2">Badges</h2>
      {badges.length === 0 ? (
        <p className="empty">
          No badges yet. Badges are earned by doing well on a topic — not by
          logging in, and never by a daily streak.
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

function Row({ label, value, percent, muted }) {
  return (
    <div className="compare-row">
      <span className="compare-label">{label}</span>
      <span className="compare-track">
        <span
          className={`compare-fill${muted ? ' compare-fill--muted' : ''}`}
          style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        />
      </span>
      <span className="compare-value">{value}</span>
    </div>
  );
}
