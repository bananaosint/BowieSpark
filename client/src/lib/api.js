// Every request goes through here. The dev-user header is the client half of
// the auth shim in server/src/middleware/auth.js — when real auth lands, this
// file and that one change together and nothing else does.
const DEV_USER_KEY = 'fit.devUserId';

export function getDevUserId() {
  try {
    return localStorage.getItem(DEV_USER_KEY);
  } catch {
    return null;
  }
}

export function setDevUserId(id) {
  try {
    if (id) localStorage.setItem(DEV_USER_KEY, id);
    else localStorage.removeItem(DEV_USER_KEY);
  } catch {
    /* private browsing — the header just won't persist across reloads */
  }
}

export async function api(path, options = {}) {
  const devUserId = getDevUserId();
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(devUserId ? { 'x-dev-user-id': devUserId } : {}),
      ...options.headers,
    },
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.message ?? `Request failed (${res.status})`);
    err.status = res.status;
    err.code = body.error;
    throw err;
  }
  return body;
}
