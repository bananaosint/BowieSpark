// Every request goes through here. The dev-user header is the client half of
// the auth shim in server/src/middleware/auth.js — when real auth lands, this
// file and that one change together and nothing else does.
const DEV_USER_KEY = 'fit.devUserId';

// In-memory is the source of truth; localStorage only persists it across
// reloads. If storage is blocked (private browsing, locked-down district
// device) the app still works for the tab's lifetime instead of 401ing.
let devUserId = null;

export function getDevUserId() {
  if (devUserId) return devUserId;
  try {
    devUserId = localStorage.getItem(DEV_USER_KEY);
  } catch {
    devUserId = null;
  }
  return devUserId;
}

export function setDevUserId(id) {
  devUserId = id ?? null;
  try {
    if (id) localStorage.setItem(DEV_USER_KEY, id);
    else localStorage.removeItem(DEV_USER_KEY);
  } catch {
    /* storage blocked — the in-memory value above still carries the session */
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
