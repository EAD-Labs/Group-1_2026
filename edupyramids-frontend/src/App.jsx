import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';
import StudentHome from './pages/StudentHome';
import Play from './pages/Play';
import Me from './pages/Me';
import Quiz from './pages/Quiz';
import Game from './pages/Game';
import Practice from './pages/Practice';
import Checkpoint from './pages/Checkpoint';
import QuestionGenerator from './pages/QuestionGenerator';
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
                <StudentHome />
              </ProtectedRoute>
            )}
          />
          {/* The path on Home replaced the Learn page; old links land there. */}
          <Route path="/learn" element={<Navigate to="/dashboard/student" replace />} />
          <Route
            path="/checkpoint/:topicId"
            element={(
              <ProtectedRoute role="student">
                <Checkpoint />
              </ProtectedRoute>
            )}
          />
          <Route
            path="/play"
            element={(
              <ProtectedRoute role="student">
                <Play />
              </ProtectedRoute>
            )}
          />
          <Route
            path="/me"
            element={(
              <ProtectedRoute role="student">
                <Me />
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
            path="/practice"
            element={(
              <ProtectedRoute role="student">
                <Practice />
              </ProtectedRoute>
            )}
          />
          <Route
            path="/game/:id"
            element={(
              <ProtectedRoute role="student">
                <Game />
              </ProtectedRoute>
            )}
          />
          <Route
            path="/content"
            element={(
              <ProtectedRoute role={['teacher', 'coordinator']}>
                <QuestionGenerator />
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
