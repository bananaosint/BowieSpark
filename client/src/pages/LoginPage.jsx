import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

export default function LoginPage() {
  const { login, signup, devMode, toggleDevView } = useAuth();
  const [mode, setMode] = useState('login'); // login | signup
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [config, setConfig] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api('/auth/config')
      .then((c) => !cancelled && setConfig(c))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setPending(null);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        const res = await signup(email, password, displayName);
        if (res.pendingApproval) {
          setPending(res.message);
          setMode('login');
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next) {
    setMode(next);
    setError(null);
    setPending(null);
  }

  return (
    <main className="shell shell--narrow">
      <section className="authcard">
        <h2>{mode === 'login' ? 'Sign in' : 'Create your account'}</h2>

        <div className="authtabs">
          <button
            type="button"
            className={mode === 'login' ? 'is-active' : ''}
            onClick={() => switchMode('login')}
          >
            Sign in
          </button>
          <button
            type="button"
            className={mode === 'signup' ? 'is-active' : ''}
            onClick={() => switchMode('signup')}
          >
            Create account
          </button>
        </div>

        {pending ? <p className="notice notice--plain">{pending}</p> : null}
        {error ? <p className="error">{error}</p> : null}

        <form onSubmit={onSubmit} className="authform">
          {mode === 'signup' ? (
            <label className="field">
              <span className="field__label">Your name</span>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                maxLength={80}
                autoComplete="name"
              />
            </label>
          ) : null}

          <label className="field">
            <span className="field__label">School email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
              placeholder={config ? `you@${config.studentDomain}` : ''}
            />
          </label>

          <label className="field">
            <span className="field__label">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={mode === 'signup' ? 10 : undefined}
            />
            {mode === 'signup' ? (
              <span className="field__hint">At least 10 characters.</span>
            ) : null}
          </label>

          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        {config ? (
          <p className="authnote">
            Students sign in with <code>@{config.studentDomain}</code>; staff with{' '}
            <code>@{config.staffDomain}</code>. Staff accounts need an administrator
            to activate them before first sign-in.
          </p>
        ) : null}

        {devMode ? (
          <p className="authnote authnote--dev">
            This server is running in <strong>dev mode</strong>.{' '}
            <button type="button" className="linkish" onClick={() => toggleDevView(true)}>
              Switch to dev view
            </button>{' '}
            to browse as any seeded account without a password.
          </p>
        ) : null}
      </section>
    </main>
  );
}
