/** Stars out of three, readable by a screen reader as a number. */
export default function Stars({ n = 0, size = 'md' }) {
  return (
    <span className={`stars stars--${size}`} role="img" aria-label={`${n} of 3 stars`}>
      {[1, 2, 3].map((k) => (
        <span key={k} className={k <= n ? 'star star--on' : 'star'} aria-hidden="true">★</span>
      ))}
    </span>
  );
}
