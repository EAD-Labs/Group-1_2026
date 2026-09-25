import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { auth } from '../utils/auth';
import SyncStatus from '../offline/SyncStatus';

/*
 * The frame every signed-in page shares.
 *
 * Wide screens get a sidebar; phones and narrow tablets get a bar of tabs
 * along the bottom, where a thumb reaches. The tabs depend on the role, so a
 * student never sees teacher tools and a teacher is not shown games.
 *
 * `match` lists the other paths that belong to a tab, so the Pyramid tab stays
 * lit while a quiz is open and Play stays lit during a game.
 */
const NAV = {
  student: [
    { to: '/dashboard/student', label: 'Pyramid', icon: '🔺', match: ['/quiz/', '/game/', '/checkpoint/'] },
    { to: '/practice', label: 'Practice', icon: '🎯' },
    { to: '/play', label: 'All games', short: 'Games', icon: '🎮' },
    { to: '/me', label: 'Progress', icon: '📈' },
  ],
  teacher: [
    { to: '/dashboard/teacher', label: 'My class', icon: '🧑‍🏫' },
    { to: '/content', label: 'Question generator', short: 'Generator', icon: '✨' },
  ],
  coordinator: [
    { to: '/dashboard/coordinator', label: 'Programme', icon: '🏫' },
    { to: '/content', label: 'Question generator', short: 'Generator', icon: '✨' },
  ],
};

export default function DashboardShell({ title, children, wide, back, note, actions }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const user = auth.getCurrentUser();
  const items = NAV[user?.role] || [];

  async function signOut() {
    await auth.logout();
    navigate('/login', { replace: true });
  }

  const isActive = (item) => pathname === item.to
    || pathname.startsWith(`${item.to}/`)
    || (item.match || []).some((m) => pathname.startsWith(m));

  const initials = (user?.name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className={`app${items.length ? ' app--nav' : ''}`}>
      <a className="skip" href="#main">Skip to content</a>

      <aside className="sidebar" aria-label="Main">
        <Link className="brand sidebar-brand" to={items[0]?.to || '/'}>
          <img src="/edupyramids-logo.png" alt="EduPyramids" width="440" height="336" />
        </Link>

        <nav className="sidebar-nav">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to}
              className={() => `side-link${isActive(item) ? ' side-link--on' : ''}`}
              aria-current={isActive(item) ? 'page' : undefined}>
              <span className="side-icon" aria-hidden="true">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-user">
          <span className="avatar" aria-hidden="true">{initials}</span>
          <span className="sidebar-who">
            <span className="sidebar-name">{user?.name}</span>
            <span className="role-chip">{user?.role}</span>
          </span>
          <button className="btn btn--ghost btn--sm" type="button" onClick={signOut}>Log out</button>
        </div>
      </aside>

      <header className="mobilebar">
        <Link className="brand" to={items[0]?.to || '/'}>
          <img src="/edupyramids-logo.png" alt="EduPyramids" width="440" height="336" />
        </Link>
        <span className="mobilebar-right">
          <span className="avatar" title={user?.name} aria-hidden="true">{initials}</span>
          <button className="btn btn--ghost btn--sm" type="button" onClick={signOut}>Log out</button>
        </span>
      </header>

      <main id="main" className={`page${wide ? ' page--wide' : ''}`}>
        {(back || note) && (
          <p className="page-back">
            {back && <Link to={back.to}>&larr; {back.label}</Link>}
            {note && <span className="muted small">{note}</span>}
          </p>
        )}
        {user?.role === 'student' && <SyncStatus />}
        <div className="page-head">
          <h1>{title}</h1>
          {actions && <div className="page-actions">{actions}</div>}
        </div>
        {children}
      </main>

      {items.length > 1 && (
        <nav className="tabbar" aria-label="Main">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to}
              className={() => `tab-link${isActive(item) ? ' tab-link--on' : ''}`}
              aria-current={isActive(item) ? 'page' : undefined}>
              <span className="tab-icon" aria-hidden="true">{item.icon}</span>
              <span className="tab-label">{item.short || item.label}</span>
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
