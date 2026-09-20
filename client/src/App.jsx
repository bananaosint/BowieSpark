import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from './lib/session.jsx';
import DevUserSwitcher from './components/DevUserSwitcher.jsx';
import StudentHome from './pages/StudentHome.jsx';
import TeacherHome from './pages/TeacherHome.jsx';
import AdminHome from './pages/AdminHome.jsx';

// Admins see everything teachers see, per build sheet §2.
const NAV = [
  { to: '/student', label: 'My FIT', roles: ['student', 'teacher', 'admin'] },
  { to: '/teacher', label: 'Teaching', roles: ['teacher', 'admin'] },
  { to: '/admin', label: 'Admin', roles: ['admin'] },
];

function RequireRole({ roles, children }) {
  const { user } = useSession();
  if (!user) return null;
  if (!roles.includes(user.role)) return <Navigate to="/student" replace />;
  return children;
}

export default function App() {
  const { user, status, error, reload } = useSession();

  if (status === 'loading') {
    return <main className="shell"><p className="muted">Starting up…</p></main>;
  }

  if (status === 'error') {
    return (
      <main className="shell">
        <h1>FIT Scheduling</h1>
        <p className="error">{error}</p>
        <p className="muted">
          Is the API running? Try <code>npm run dev</code> from the repo root, then{' '}
          <button type="button" onClick={reload}>retry</button>.
        </p>
      </main>
    );
  }

  return (
    <>
      <DevUserSwitcher />
      <header className="topbar">
        <h1>FIT Scheduling</h1>
        <nav className="topbar__nav">
          {NAV.filter((item) => item.roles.includes(user.role)).map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'is-active' : '')}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <span className="topbar__who">
          {user.displayName} <span className="pill">{user.role}</span>
        </span>
      </header>

      <main className="shell">
        <Routes>
          <Route path="/" element={<Navigate to="/student" replace />} />
          <Route path="/student" element={<StudentHome />} />
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
