import { client } from '../api/client';
import { read, write, announce } from './store';

/*
 * Attempts finished offline, waiting to upload.
 *
 * Each entry is the exact request the page would have made online, plus when
 * it was finished. Uploads are safe to repeat: every attempt carries its
 * clientAttemptId, so a request that reached the server but lost its reply is
 * recorded once, not twice.
 *
 * An entry is removed when the server accepts it, and also when the server
 * refuses it outright (a 4xx: the quiz was deleted, the session is not a
 * student's), since retrying would never succeed. A network failure leaves it
 * queued for next time.
 */
const OUTBOX = 'offline.outbox';

export const pending = () => read(OUTBOX, []);

export function enqueue(entry) {
  write(OUTBOX, [...pending(), { ...entry, queuedAt: new Date().toISOString() }]);
  announce();
}

let flushing = null;

/** Upload everything waiting. Returns how many were sent. */
export function flush() {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    for (const entry of pending()) {
      try {
        await client.post(entry.path, entry.body);
        sent += 1;
      } catch (err) {
        if (err.status === 0 || err.status >= 500) break;     // offline, or their bad morning: try later
        if (err.status === 401) break;                         // signed out: keep it for the next sign-in
      }
      write(OUTBOX, pending().filter((e) => e.body.clientAttemptId !== entry.body.clientAttemptId));
      announce();
    }
    return sent;
  })().finally(() => { flushing = null; });
  return flushing;
}

/** Upload when the connection comes back, and every minute while it is up. */
export function startSync() {
  window.addEventListener('online', () => flush());
  setInterval(() => { if (navigator.onLine && pending().length) flush(); }, 60_000);
  if (navigator.onLine) flush();
}
