import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  api,
  apiPost,
  getDevUserId,
  setDevUserId,
  getDevView,
  setDevView,
} from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [devMode, setDevMode] = useState(false); // server-side DEV_MODE flag
  const [devView, setDevViewState] = useState(getDevView());
  const [devUsers, setDevUsers] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | anonymous | offline
  const [error, setError] = useState(null);

  // Ask the server who we are. In dev view this resolves via the impersonation
  // header; otherwise via the session cookie.
  const refresh = useCallback(async () => {
    setError(null);
    try {
      const me = await api('/auth/me');
      setDevMode(Boolean(me.devMode));

      // Dev view is only meaningful if the SERVER says dev mode is on.
      if (!me.devMode && getDevView()) {
        setDevView(false);
        setDevViewState(false);
      }

      if (me.devMode && getDevView()) {
        const { users } = await api('/dev/users');
        setDevUsers(users);
        // Default to a seeded student so dev view lands somewhere useful.
        let id = getDevUserId();
        if (!id || !users.some((u) => u.id === id)) {
          id = users.find((u) => u.role === 'student')?.id ?? users[0]?.id ?? null;
          setDevUserId(id);
          if (id) {
            const again = await api('/auth/me');
            setUser(again.user);
            setStatus(again.user ? 'ready' : 'anonymous');
            return;
          }
        }
      }

      setUser(me.user);
      setStatus(me.user ? 'ready' : 'anonymous');
    } catch (err) {
      // A failed /auth/me means the API is unreachable — distinct from being
      // signed out, and it needs a different message and a retry.
      setError(err.message);
      setStatus('offline');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(
    async (email, password) => {
      const { user: me } = await apiPost('/auth/login', { email, password });
      setUser(me);
      setStatus('ready');
      return me;
    },
    []
  );

  const signup = useCallback(async (email, password, displayName) => {
    const res = await apiPost('/auth/signup', { email, password, displayName });
    // Staff accounts come back pending an admin; no session is issued.
    if (res.pendingApproval) return res;
    setUser(res.user);
    setStatus('ready');
    return res;
  }, []);

  const logout = useCallback(async () => {
    await apiPost('/auth/logout').catch(() => {});
    setUser(null);
    setStatus('anonymous');
  }, []);

  const toggleDevView = useCallback(
    async (on) => {
      setDevView(on);
      setDevViewState(on);
      if (!on) setDevUserId(null);
      setStatus('loading');
      await refresh();
    },
    [refresh]
  );

  const switchDevUser = useCallback(
    async (id) => {
      setDevUserId(id);
      setStatus('loading');
      await refresh();
    },
    [refresh]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        status,
        error,
        devMode,
        devView,
        devUsers,
        login,
        signup,
        logout,
        toggleDevView,
        switchDevUser,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
