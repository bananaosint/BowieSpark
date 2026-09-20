// Every request goes through here.
//
// Normal path: the browser holds an httpOnly session cookie and we send
// nothing extra. Dev view (local only, and only when the server reports
// DEV_MODE on) additionally sends an impersonation header.
const DEV_USER_KEY = 'fit.devUserId';
const DEV_VIEW_KEY = 'fit.devView';

// In-memory is the source of truth; localStorage only persists across reloads.
// If storage is blocked (private browsing, locked-down district device) the
// app still works for the tab's lifetime.
let devUserId = null;
let devView = null;

function readStored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage blocked — the in-memory value still carries this tab */
  }
}

export function getDevUserId() {
  if (devUserId === null) devUserId = readStored(DEV_USER_KEY);
  return devUserId;
}

export function setDevUserId(id) {
  devUserId = id ?? null;
  writeStored(DEV_USER_KEY, id ?? null);
}

// Dev view is OFF unless explicitly turned on, so the default experience is
// always the real login — even on a machine where DEV_MODE is enabled.
export function getDevView() {
  if (devView === null) devView = readStored(DEV_VIEW_KEY) === 'on';
  return devView;
}

export function setDevView(on) {
  devView = Boolean(on);
  writeStored(DEV_VIEW_KEY, on ? 'on' : null);
}

export async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  // Only ever attached in dev view. The server ignores it unless DEV_MODE is on.
  if (getDevView()) {
    const id = getDevUserId();
    if (id) headers['x-dev-user-id'] = id;
  }

  const res = await fetch(`/api${path}`, {
    credentials: 'include', // carry the session cookie
    ...options,
    headers,
    ...(options.body !== undefined && typeof options.body !== 'string'
      ? { body: JSON.stringify(options.body) }
      : {}),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.message ?? `Request failed (${res.status})`);
    err.status = res.status;
    err.code = body.error;
    err.body = body;
    throw err;
  }
  return body;
}

export const apiPost = (path, body) => api(path, { method: 'POST', body });
export const apiPatch = (path, body) => api(path, { method: 'PATCH', body });
export const apiPut = (path, body) => api(path, { method: 'PUT', body });
export const apiDelete = (path) => api(path, { method: 'DELETE' });
