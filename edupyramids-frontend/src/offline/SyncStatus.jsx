import { useEffect, useState } from 'react';
import { pending, flush } from './outbox';

/*
 * One line that says whether the app is online and whether anything is
 * waiting to upload. Shown only to students, and only when there is
 * something worth saying: a quiet app says nothing.
 */
export function useOfflineState() {
  const [online, setOnline] = useState(navigator.onLine);
  const [waiting, setWaiting] = useState(pending().length);

  useEffect(() => {
    const update = () => { setOnline(navigator.onLine); setWaiting(pending().length); };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    window.addEventListener('edupyramids:offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      window.removeEventListener('edupyramids:offline', update);
    };
  }, []);

  return { online, waiting };
}

export default function SyncStatus() {
  const { online, waiting } = useOfflineState();
  const [busy, setBusy] = useState(false);

  if (online && !waiting) return null;

  async function syncNow() {
    setBusy(true);
    try { await flush(); } finally { setBusy(false); }
  }

  return (
    <div className={`sync${online ? '' : ' sync--off'}`} role="status">
      <span className="sync-dot" aria-hidden="true" />
      <span className="sync-text">
        {online ? 'Online' : 'Offline'}
        {waiting > 0 && ` · ${waiting} result${waiting > 1 ? 's' : ''} waiting to save`}
      </span>
      {online && waiting > 0 && (
        <button type="button" className="linkish sync-now" onClick={syncNow} disabled={busy}>
          {busy ? 'Saving…' : 'Save now'}
        </button>
      )}
    </div>
  );
}
