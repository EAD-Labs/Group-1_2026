import { client, setUnauthorisedHandler, TOKEN_KEY } from '../api/client';

const USER_KEY = 'edupyramids.user';
const EXPIRY_KEY = 'edupyramids.expiry';

/**
 * Read the expiry out of the token itself.
 *
 * This is a convenience so the interface can sign someone out before they click
 * something and get a 401. It is not a security check — the token is only
 * trusted because the server verified its signature.
 */
function expiryFromToken(token) {
  try {
    const [, payload] = token.split('.');
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return claims.exp ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}

export const auth = {
  async login(email, password, role) {
    const data = await client.post('/auth/login', { email, password, role });
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    const expiry = expiryFromToken(data.token);
    if (expiry) localStorage.setItem(EXPIRY_KEY, String(expiry));
    return data.user;
  },

  async logout({ notifyServer = true } = {}) {
    // Best effort: the session is over on this device either way.
    if (notifyServer) {
      try { await client.post('/auth/logout'); } catch { /* already gone */ }
    }
    auth.clear();
  },

  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(EXPIRY_KEY);
  },

  getToken() {
    return localStorage.getItem(TOKEN_KEY);
  },

  getCurrentUser() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY)) || null;
    } catch {
      return null;
    }
  },

  /** Expired counts as not signed in, so a stale tab does not look logged in. */
  isAuthenticated() {
    if (!auth.getToken() || !auth.getCurrentUser()) return false;
    const expiry = Number(localStorage.getItem(EXPIRY_KEY));
    if (expiry && Date.now() >= expiry) {
      auth.clear();
      return false;
    }
    return true;
  },

  hasRole(role) {
    const user = auth.getCurrentUser();
    return Boolean(user && user.role === role);
  },

  homeFor(role) {
    return `/dashboard/${role || 'student'}`;
  },
};

// Any 401 from anywhere clears the session and sends the user to the login
// page, carrying a note so it can say why.
setUnauthorisedHandler(() => {
  auth.clear();
  if (!window.location.pathname.startsWith('/login')) {
    window.location.assign('/login?expired=1');
  }
});
