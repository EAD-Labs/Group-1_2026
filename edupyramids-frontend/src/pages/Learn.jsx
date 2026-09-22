import { Link } from 'react-router-dom';
import DashboardShell from '../components/DashboardShell';
import { kindOf } from '../games/registry';
import { auth } from '../utils/auth';
import { useApi, topicIcon } from '../utils/useApi';

/*
 * Learn: the course, topic by topic, easy to hard. Each topic holds its
 * quizzes and its games together, so a student finishing Silver Level sees
 * everything Silver Level has to offer in one place. Topics with nothing to
 * do yet are left out rather than shown as dead tiles.
 */
export default function Learn() {
  const user = auth.getCurrentUser();
  const { loading, error, data } = useApi([`/progress/${user.id}`, '/quizzes', '?/games']);

  if (loading || error) {
    return (
      <DashboardShell title="Learn">
        {error ? <p className="alert" role="alert">{error}</p> : <p className="muted">Loading…</p>}
      </DashboardShell>
    );
  }

  const [progress, quizzes, games] = data;
  const sections = progress.topics
    .map((t) => ({
      ...t,
      quizzes: quizzes.filter((q) => q.topicId === t.topicId),
      games: games.filter((g) => g.topicId === t.topicId),
    }))
    .filter((t) => t.quizzes.length || t.games.length);

  return (
    <DashboardShell title="Learn">
      <p className="page-intro muted">Work through the levels in order, or jump to any topic. Nothing is locked.</p>

      {sections.length === 0 && <p className="empty">Nothing to learn yet. Your teacher will add questions soon.</p>}

      <ol className="levels">
        {sections.map((t) => (
          <li key={t.topicId} className={`level tile--l${t.level}`}>
            <header className="level-head">
              <span className="level-icon" aria-hidden="true">{topicIcon(t.topic)}</span>
              <span className="level-title">
                <h2>{t.topic}</h2>
                <span className="muted small">
                  {t.quizzes.length} quiz{t.quizzes.length === 1 ? '' : 'zes'} · {t.games.length} game{t.games.length === 1 ? '' : 's'}
                </span>
              </span>
              <span className="level-progress">
                <span className="tile-bar"><span style={{ width: `${t.attempts ? t.bestPercent : 0}%` }} /></span>
                <span className="small muted">{t.attempts ? `Best ${t.bestPercent}%` : 'Not started'}</span>
              </span>
            </header>

            <ul className="activities">
              {t.quizzes.map((q) => (
                <li key={`q${q.id}`}>
                  <Link className="activity" to={`/quiz/${q.id}`}>
                    <span className="activity-icon" aria-hidden="true">📝</span>
                    <span className="activity-text">
                      <span className="activity-name">{q.title}</span>
                      <span className="activity-kind">Quiz</span>
                    </span>
                  </Link>
                </li>
              ))}
              {t.games.map((g) => {
                const kind = kindOf(g.kind);
                return (
                  <li key={`g${g.id}`}>
                    <Link className="activity" to={`/game/${g.id}`}>
                      <span className="activity-icon" aria-hidden="true">{kind.icon}</span>
                      <span className="activity-text">
                        <span className="activity-name">{g.title}</span>
                        <span className="activity-kind">{kind.label}{g.attempts ? ` · best ${g.bestPercent}%` : ''}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
    </DashboardShell>
  );
}
