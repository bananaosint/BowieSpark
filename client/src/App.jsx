import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import DevBar from './components/DevBar.jsx';
import LoginPage from './pages/LoginPage.jsx';
import StudentHome from './pages/StudentHome.jsx';
import SchedulePage from './pages/SchedulePage.jsx';
import TeacherHome from './pages/TeacherHome.jsx';
import AdminHome from './pages/AdminHome.jsx';

// Admins see everything teachers see, org-wide, per build sheet §2.
const NAV = [
  { to: '/student', label: 'My FIT', roles: ['student', 'teacher', 'admin'] },
  { to: '/schedule', label: 'My schedule', roles: ['student'] },
  { to: '/teacher', label: 'Teaching', roles: ['teacher', 'admin'] },
  { to: '/admin', label: 'Admin', roles: ['admin'] },
];

function RequireRole({ roles, children }) {
  const { user } = useAuth();
  if (!user) return null;
  if (!roles.includes(user.role)) return <Navigate to="/student" replace />;
  return children;
}

export default function App() {
  const { user, status, error, refresh, logout, devView } = useAuth();

  if (status === 'loading') {
    return (
      <main className="shell">
        <p className="muted">Starting up…</p>
      </main>
    );
  }

  // The API is unreachable — distinct from being signed out, and it needs a
  // retry rather than a login form.
  if (status === 'offline') {
    return (
      <main className="shell">
        <h1>FIT Scheduling</h1>
        <p className="error">Can&rsquo;t reach the server. {error}</p>
        <p className="muted">
          Is the API running? Try <code>npm run dev</code> from the project root, then{' '}
          <button type="button" className="linkish" onClick={refresh}>
            retry
          </button>
          .
        </p>
      </main>
    );
  }

  if (status === 'anonymous' || !user) {
    return (
      <>
        <DevBar />
        <header className="topbar topbar--bare">
          <h1>FIT Scheduling</h1>
        </header>
        <LoginPage />
      </>
    );
  }

  return (
    <>
      <DevBar />
      <header className="topbar">
        <h1>FIT Scheduling</h1>
        <nav className="topbar__nav">
          {NAV.filter((item) => item.roles.includes(user.role)).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? 'is-active' : '')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <span className="topbar__who">
          {user.displayName} <span className="pill">{user.role}</span>
          {/* Dev view has no session to end, so offering "sign out" there
              would be a button that quietly does nothing. */}
          {!devView ? (
            <button type="button" className="topbar__signout" onClick={logout}>
              Sign out
            </button>
          ) : null}
        </span>
      </header>

      <main className="shell">
        <Routes>
          <Route path="/" element={<Navigate to="/student" replace />} />
          <Route path="/login" element={<Navigate to="/student" replace />} />
          <Route path="/student" element={<StudentHome />} />
          <Route
            path="/schedule"
            element={
              <RequireRole roles={['student']}>
                <SchedulePage />
              </RequireRole>
            }
          />
          <Route
            path="/teacher"
            element={
              <RequireRole roles={['teacher', 'admin']}>
                <TeacherHome />
              </RequireRole>
            }
          />
          <Route
            path="/admin"
            element={
              <RequireRole roles={['admin']}>
                <AdminHome />
              </RequireRole>
            }
          />
          <Route path="*" element={<p className="muted">Nothing here.</p>} />
        </Routes>
      </main>
    </>
  );
}
