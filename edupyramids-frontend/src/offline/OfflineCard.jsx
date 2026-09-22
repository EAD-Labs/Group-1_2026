import { useEffect, useState } from 'react';
import { isEnabled, enable, disable, download, info } from './pack';
import { useOfflineState } from './SyncStatus';

/*
 * Turning offline use on and off, on the Progress page.
 *
 * Off by default: turning it on stores every quiz and game on this device,
 * answers included, so it is a choice for lab tablets and patchy connections
 * rather than something every account does.
 */
export default function OfflineCard() {
  const { online, waiting } = useOfflineState();
  const [enabled, setEnabled] = useState(isEnabled());
  const [details, setDetails] = useState(info());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    const update = () => { setEnabled(isEnabled()); setDetails(info()); };
    window.addEventListener('edupyramids:offline', update);
    return () => window.removeEventListener('edupyramids:offline', update);
  }, []);

  async function act(fn, done) {
    setBusy(true);
    setMessage(null);
    try {
      const outcome = await fn();
      setMessage(done(outcome));
    } catch (err) {
      setMessage(err.status === 0 ? 'You are offline. Try again when connected.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  const saved = details?.savedAt ? new Date(details.savedAt).toLocaleString() : null;

  return (
    <section className="card offline-card">
      <div className="offline-head">
        <span className="offline-icon" aria-hidden="true">{enabled ? '📥' : '📶'}</span>
        <div>
          <h2 className="offline-title">Use without internet</h2>
          <p className="muted small">
            {enabled
              ? `Every quiz and game is on this device (${details?.quizzes ?? 0} quizzes, ${details?.games ?? 0} games, ${details?.kb ?? 0} KB). Updated ${saved}.`
              : 'Download every quiz and game to this device, so they work with no connection. Results are saved to your record next time you are online.'}
          </p>
        </div>
      </div>

      {waiting > 0 && (
        <p className="offline-note">{waiting} result{waiting > 1 ? 's' : ''} from offline play waiting to save.</p>
      )}

      <div className="result-actions">
        {!enabled && (
          <button className="btn btn--sm" type="button" disabled={busy || !online}
            onClick={() => act(enable, () => 'Downloaded. Quizzes and games now work offline on this device.')}>
            {busy ? 'Downloading…' : 'Download for offline use'}
          </button>
        )}
        {enabled && (
          <>
            <button className="btn btn--ghost btn--sm" type="button" disabled={busy || !online}
              onClick={() => act(download, (o) => (o === 'unchanged' ? 'Already up to date.' : 'Updated with the latest questions and games.'))}>
              {busy ? 'Checking…' : 'Check for updates'}
            </button>
            <button className="btn btn--ghost btn--sm" type="button" disabled={busy}
              onClick={() => act(async () => disable(), () => 'Removed from this device.')}>
              Remove from this device
            </button>
          </>
        )}
      </div>
      {!online && !enabled && <p className="muted small">Connect to the internet to download.</p>}
      {message && <p className="muted small" role="status">{message}</p>}
    </section>
  );
}
