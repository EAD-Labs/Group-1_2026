import { useState } from 'react';

/*
 * Sort each card into the right group.
 *
 * Two ways to move a card, because the pilot runs on tablets as well as lab
 * desktops: drag it with a mouse, or tap it and then tap a group. HTML5 drag
 * and drop does nothing on a touch screen, so tapping is not a fallback here,
 * it is the main way in. Tapping also works from the keyboard.
 */
export default function SortBoard({ game, onFinish, sending }) {
  const [placed, setPlaced] = useState({});        // itemId -> bucket
  const [picked, setPicked] = useState(null);      // itemId

  const move = (itemId, bucket) => {
    setPlaced(({ [itemId]: _, ...rest }) => (bucket ? { ...rest, [itemId]: bucket } : rest));
    setPicked(null);
  };

  const dropProps = (bucket) => ({
    onDragOver: (e) => e.preventDefault(),
    onDrop: (e) => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain');
      if (id) move(id, bucket);
    },
    onClick: () => picked && move(picked, bucket),
  });

  const card = (item) => (
    <li key={item.id}>
      <button
        type="button"
        draggable={!sending}
        onDragStart={(e) => e.dataTransfer.setData('text/plain', item.id)}
        onClick={(e) => { e.stopPropagation(); setPicked(picked === item.id ? null : item.id); }}
        className={`piece piece--chip${picked === item.id ? ' piece--picked' : ''}`}
        aria-pressed={picked === item.id}
      >
        <code className="piece-code">{item.text}</code>
      </button>
    </li>
  );

  const loose = game.items.filter((i) => !placed[i.id]);
  const total = game.items.length;
  const done = total - loose.length;

  return (
    <>
      <p className="board-status" aria-live="polite">
        {picked ? 'Now tap the group it belongs in.' : `${done} of ${total} sorted`}
      </p>

      {/* The tray. Also a drop target, so a card can be taken back out. */}
      <div className={`tray${picked && placed[picked] ? ' tray--target' : ''}`} {...dropProps(null)}>
        {loose.length
          ? <ul className="chips">{loose.map(card)}</ul>
          : <p className="tray-empty">All sorted. Tap a card to move it.</p>}
      </div>

      <div className="buckets" style={{ '--cols': game.buckets.length }}>
        {game.buckets.map((b) => (
          <section
            key={b}
            className={`bucket${picked ? ' bucket--target' : ''}`}
            aria-label={b}
            {...dropProps(b)}
          >
            <h3 className="bucket-name">
              {picked ? <button type="button" className="bucket-put">Put in {b}</button> : b}
            </h3>
            <ul className="chips">{game.items.filter((i) => placed[i.id] === b).map(card)}</ul>
          </section>
        ))}
      </div>

      <div className="quiz-nav">
        <button className="btn btn--ghost btn--sm" type="button"
          onClick={() => { setPlaced({}); setPicked(null); }} disabled={!done || sending}>
          Clear
        </button>
        <button className="btn btn--sm" type="button"
          onClick={() => onFinish(placed)} disabled={done < total || sending}>
          {sending ? 'Checking…' : 'Check answers'}
        </button>
      </div>
    </>
  );
}
