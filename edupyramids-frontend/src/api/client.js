/*
 * One place where every request to the API is shaped.
 *
 * Built on fetch rather than axios: the browser and Node 18+ both ship it, and
 * the whole wrapper is thirty lines. One fewer dependency to keep patched.
 */

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const TOKEN_KEY = 'edupyramids.token';

/** Set by utils/auth.js so a 401 can bounce the user out. */
let onUnauthorised = () => {};
export function setUnauthorisedHandler(fn) {
  onUnauthorised = fn;
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/*
 * Endpoints that are allowed to answer 401 without it meaning "your session
 * ended". Signing in with the wrong password is a 401, and treating that as an
 * expired session would clear the storage of whoever was already signed in and
 * replace the real message with "your session has ended".
 */
const PUBLIC_PATHS = new Set(['/auth/login']);

async function request(method, path, body) {
  const token = localStorage.getItem(TOKEN_KEY);

  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // fetch only rejects when the request never happened: the API is down, DNS
    // failed, or CORS blocked it. "Failed to fetch" tells a user nothing.
    throw new ApiError('Cannot reach the server. Is the API running?', 0);
  }

  // 204 and friends have no body to parse.
  const payload = response.status === 204
    ? {}
    : await response.json().catch(() => ({}));

  if (response.status === 401 && !PUBLIC_PATHS.has(path)) {
    // The token is missing, expired or rejected. Sign out rather than let the
    // interface sit there half-working.
    onUnauthorised();
    throw new ApiError(payload.error || 'Your session has ended', 401);
  }

  if (!response.ok) {
    throw new ApiError(payload.error || 'Something went wrong', response.status);
  }

  return payload;
}

/*
 * The last good answer to the requests a student's pages load, kept per user,
 * so that with no connection a page shows what it saw last instead of an
 * error. Only these paths: nothing a teacher sees, and nothing that would be
 * wrong to show old (a quiz itself comes from the offline pack instead).
 */
const REMEMBERED = [/^\/progress\/\d+$/, /^\/quizzes$/, /^\/games$/, /^\/practice\/mastery$/, /^\/path$/];

function memoryKey(path) {
  let userId = 'anon';
  try { userId = JSON.parse(localStorage.getItem('edupyramids.user'))?.id ?? 'anon'; } catch { /* anon */ }
  return `edupyramids.${userId}.cache.${path}`;
}

async function get(path) {
  const remembered = REMEMBERED.some((re) => re.test(path));
  try {
    const payload = await request('GET', path);
    if (remembered) {
      try { localStorage.setItem(memoryKey(path), JSON.stringify(payload)); } catch { /* full: skip */ }
    }
    return payload;
  } catch (err) {
    if (err.status === 0 && remembered) {
      try {
        const saved = JSON.parse(localStorage.getItem(memoryKey(path)));
        if (saved) return { ...saved, fromDevice: true };
      } catch { /* nothing saved */ }
    }
    throw err;
  }
}

export const client = {
  get,
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  delete: (path) => request('DELETE', path),
};

export { TOKEN_KEY, BASE_URL };
