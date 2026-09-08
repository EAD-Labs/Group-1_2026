import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';
import StudentDashboard from './pages/StudentDashboard';
import Quiz from './pages/Quiz';
import TeacherDashboard from './pages/TeacherDashboard';
import CoordinatorDash from './pages/CoordinatorDash';
import { auth } from './utils/auth';

/** Send someone who lands on "/" wherever they belong. */
function Landing() {
  if (!auth.isAuthenticated()) return <Navigate to="/login" replace />;
  return <Navigate to={auth.homeFor(auth.getCurrentUser().role)} replace />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />

          <Route
            path="/dashboard/student"
            element={(
              <ProtectedRoute role="student">
                <StudentDashboard />
              </ProtectedRoute>
            )}
          />
          <Route
            path="/quiz/:id"
            element={(
              <ProtectedRoute role="student">
                <Quiz />
              </ProtectedRoute>
            )}
          />
          <Route
            path="/dashboard/teacher"
            element={(
              <ProtectedRoute role="teacher">
                <TeacherDashboard />
              </ProtectedRoute>
            )}
          />
          <Route
            path="/dashboard/coordinator"
            element={(
              <ProtectedRoute role="coordinator">
                <CoordinatorDash />
              </ProtectedRoute>
            )}
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
