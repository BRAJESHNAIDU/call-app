// Empty in dev (Vite proxies) and in single-service production (same origin).
export const API_BASE = import.meta.env.VITE_API_URL || '';

// Clerk session tokens are short-lived (about a minute), so ask Clerk for a fresh
// one on every request. AuthContext registers the function that does that.
let getTokenFn = null;
export function setTokenGetter(fn) {
  getTokenFn = fn;
}

export async function api(path, { method = 'GET', body } = {}) {
  let jwt = null;
  try {
    jwt = getTokenFn ? await getTokenFn() : null;
  } catch {
    /* signed out: the server will answer 401 */
  }

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    const err = new Error('Cannot reach the server. Check your connection.');
    err.status = 0;
    throw err;
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON body */
  }

  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return data;
}
