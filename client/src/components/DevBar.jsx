import { useAuth } from '../lib/auth.jsx';

// The dev/user view toggle. Rendered only when the SERVER reports DEV_MODE on,
// so a production build shows nothing at all — there is no client-side flag
// that could be flipped to reveal it.
export default function DevBar() {
  const { devMode, devView, devUsers, user, switchDevUser, toggleDevView } = useAuth();

  if (!devMode) return null;

  if (!devView) {
    return (
      <div className="devbar devbar--idle">
        <span className="devbar__tag">Dev mode</span>
        <span className="devbar__note">
          {user ? 'You are signed in normally.' : 'Real sign-in is active.'}
        </span>
        <button type="button" className="devbar__switch" onClick={() => toggleDevView(true)}>
          Switch to dev view
        </button>
      </div>
    );
  }

  return (
    <div className="devbar">
      <span className="devbar__tag">Dev view</span>
      <label htmlFor="devuser">Viewing as</label>
      <select
        id="devuser"
        value={user?.id ?? ''}
        onChange={(e) => switchDevUser(e.target.value)}
      >
        {['student', 'teacher', 'admin'].map((role) => {
          const group = devUsers.filter((u) => u.role === role);
          if (!group.length) return null;
          return (
            <optgroup key={role} label={`${role[0].toUpperCase()}${role.slice(1)}s`}>
              {group.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
      <span className="devbar__note">no password — fake data only</span>
      <button type="button" className="devbar__switch" onClick={() => toggleDevView(false)}>
        Back to real login
      </button>
    </div>
  );
}
