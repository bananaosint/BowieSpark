import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getDevUserId, setDevUserId } from './api.js';

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [user, setUser] = useState(null);
  const [devUsers, setDevUsers] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      // The dev switcher needs the roster even when nobody is selected yet.
      const { users } = await api('/dev/users');
      setDevUsers(users);

      let id = getDevUserId();
      if (!id || !users.some((u) => u.id === id)) {
        // Default to a seeded student so a fresh clone lands on a useful screen.
        id = users.find((u) => u.role === 'student')?.id ?? users[0]?.id ?? null;
        setDevUserId(id);
      }
      if (!id) throw new Error('No seeded users. Run `npm run db:seed`.');

      const { user: me } = await api('/me');
      setUser(me);
      setStatus('ready');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const switchUser = useCallback(
    async (id) => {
      setDevUserId(id);
      await load();
    },
    [load]
  );

  return (
    <SessionContext.Provider value={{ user, devUsers, status, error, switchUser, reload: load }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
