import { Navigate, useLocation } from 'react-router-dom';
import { auth } from '../utils/auth';

/**
 * Route guard.
 *
 * This is a convenience, not a security boundary. It stops a student wandering
 * into a teacher screen and seeing a broken page; what actually protects the
 * data is the server refusing the request (see the 403s in the API). Anyone can
 * edit localStorage, so the guard must never be the only thing standing between
 * a user and someone else's records.
 */
export default function ProtectedRoute({ role, children }) {
  const location = useLocation();

  if (!auth.isAuthenticated()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (role && !auth.hasRole(role)) {
    const user = auth.getCurrentUser();
    return (
      <main className="auth">
        <div className="card auth-card">
          <h1>Not allowed</h1>
          <p className="muted">
            This page is for {role}s. You are signed in as {user.role}.
          </p>
          <a className="btn" href={auth.homeFor(user.role)}>
            Go to your dashboard
          </a>
        </div>
      </main>
    );
  }

  return children;
}
