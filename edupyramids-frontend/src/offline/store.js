import { auth } from '../utils/auth';

/*
 * Small, per-user storage on the device.
 *
 * localStorage, not IndexedDB: the whole offline pack is about 200 KB and the
 * queue holds a handful of attempts, well inside its limits, and it is
 * synchronous, which keeps the pages simple. Keys carry the user id, because
 * a lab tablet is shared: one student's queue must never upload as another's.
 * Every read and write is guarded; a private window or full storage means
 * offline use is unavailable, not that the app breaks.
 */
const key = (name) => `edupyramids.${auth.getCurrentUser()?.id ?? 'anon'}.${name}`;

export function read(name, fallback = null) {
  try {
    const raw = localStorage.getItem(key(name));
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function write(name, value) {
  try {
    localStorage.setItem(key(name), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function remove(name) {
  try { localStorage.removeItem(key(name)); } catch { /* nothing to remove */ }
}

/** Tell every open page that offline state changed. */
export function announce() {
  window.dispatchEvent(new Event('edupyramids:offline'));
}
