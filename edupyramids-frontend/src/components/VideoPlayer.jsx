import { useEffect, useRef, useState } from 'react';

/*
 * A Spoken Tutorial lesson, played inside the app.
 *
 * The video streams straight from spoken-tutorial.org (see the server's
 * services/videoService.js); captions come through our own API, because a
 * <track> has to be WebVTT from this origin. Their content is CC BY-SA 4.0,
 * so the credit and a link to the original page are always shown.
 *
 * A native <dialog>: it keeps keyboard focus inside while open, closes on
 * Escape, and hands focus back to the button that opened it.
 */

/** A button that opens the lesson in the player, or a plain link if it cannot play here. */
export function WatchButton({ video, className = '', children }) {
  const [open, setOpen] = useState(false);
  if (!video) return null;
  if (!video.mp4) {
    return (
      <a className={className} href={video.url} target="_blank" rel="noreferrer">{children || video.title}</a>
    );
  }
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}
        title={`${video.title} (${video.duration}), Spoken Tutorial`}>
        {children || video.title}
      </button>
      {open && <VideoPlayer video={video} onClose={() => setOpen(false)} />}
    </>
  );
}

export default function VideoPlayer({ video, onClose }) {
  const dialog = useRef(null);
  const [failed, setFailed] = useState(false);

  // Opened once mounted. Leaving the page removes the dialog, which ends it;
  // closing it here as well would fire onClose again on the way out. The close
  // event is listened to directly: React 18 does not pass it on from <dialog>.
  useEffect(() => {
    const d = dialog.current;
    if (!d.open) d.showModal();
    d.addEventListener('close', onClose);
    return () => d.removeEventListener('close', onClose);
  }, [onClose]);

  return (
    // Clicking the dimmed backdrop (the dialog itself, outside the panel) closes
    // it; the keyboard has Escape and the Close button.
    <dialog ref={dialog} className="video-dialog" aria-labelledby="video-title"
      onClick={(e) => { if (e.target === dialog.current) dialog.current.close(); }}>
      <div className="video-panel">
        <div className="video-head">
          <h2 id="video-title" className="video-title">{video.title}</h2>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => dialog.current.close()}>Close</button>
        </div>

        {failed ? (
          <p className="alert" role="alert">
            The video could not load. It needs an internet connection; you can also{' '}
            <a href={video.url} target="_blank" rel="noreferrer">watch it on spoken-tutorial.org</a>.
          </p>
        ) : (
          // The browser tries each source in turn; an error on the last means none played.
          <video className="video-frame" controls preload="metadata" playsInline>
            <source src={video.mp4} type="video/mp4" />
            <source src={video.webm} type="video/webm" onError={() => setFailed(true)} />
            <track kind="captions" srcLang="en" label="English" src={video.captions} default />
          </video>
        )}

        <p className="video-credit muted small">
          {video.duration} · From <a href={video.url} target="_blank" rel="noreferrer">Spoken Tutorial, IIT Bombay</a>,
          {' '}licensed <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>.
        </p>
      </div>
    </dialog>
  );
}
