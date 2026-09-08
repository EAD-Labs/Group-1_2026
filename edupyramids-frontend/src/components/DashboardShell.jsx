import { useNavigate } from 'react-router-dom';
import { auth } from '../utils/auth';

/**
 * The frame the three dashboards share: who is signed in, and the way out.
 *
 * Not in the Week 3 file list, but the alternative is the same header copied
 * into three placeholder pages that are about to be rewritten anyway.
 */
export default function DashboardShell({ title, children, done, wide }) {
  const navigate = useNavigate();
  const user = auth.getCurrentUser();

  async function signOut() {
    await auth.logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="shell">
      <header className="topbar">
        <p className="brand">
          <img src="/edupyramids-logo.png" alt="EduPyramids" width="440" height="336" />
        </p>
        <div className="topbar-right">
          {/* Points and topics finished, the way the reference keeps them
              always visible. Shown only where they mean something, so the
              teacher and coordinator headers stay clean. */}
          {done !== undefined && (
            <span className="pills">
              {done !== undefined && (
                <span className="pill pill--done" title="Topics finished">
                  <span className="pill-icon" aria-hidden="true">✅</span>
                  {done}
                  <span className="sr-only"> topics finished</span>
                </span>
              )}
            </span>
          )}
          <span className="who">
            {user?.name}
            <span className="role-chip">{user?.role}</span>
          </span>
          <button className="btn btn--ghost" type="button" onClick={signOut}>
            Log out
          </button>
        </div>
      </header>

      <main className={`page${wide ? ' page--wide' : ''}`}>
        <h1>{title}</h1>
        {children}
      </main>
    </div>
  );
}
