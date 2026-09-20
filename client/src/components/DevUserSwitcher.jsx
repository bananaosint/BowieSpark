import { useSession } from '../lib/session.jsx';

// Visible, deliberately loud reminder that there is no real auth yet.
export default function DevUserSwitcher() {
  const { user, devUsers, switchUser } = useSession();

  return (
    <div className="devbar">
      <span className="devbar__tag">DEV AUTH</span>
      <label htmlFor="devuser">Signed in as</label>
      <select
        id="devuser"
        value={user?.id ?? ''}
        onChange={(e) => switchUser(e.target.value)}
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
      <span className="devbar__note">fake data only — no real auth</span>
    </div>
  );
}
