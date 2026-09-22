const STATUS = {
  mastered: { label: 'Mastered', icon: '✓' },
  review: { label: 'Review due', icon: '↻' },
  learning: { label: 'Learning', icon: '' },
  new: { label: 'Not started', icon: '' },
};

/**
 * A student's concepts, each with the mastery model's estimate.
 *
 * Concepts with no questions yet are left out: there is nothing a student
 * could do about them.
 */
export default function ConceptMap({ concepts }) {
  const shown = concepts.filter((c) => c.questions > 0);
  return (
    <ul className="concepts">
      {shown.map((c) => (
        <li key={c.slug} className={`concept concept--${c.status}`}>
          <div className="concept-head">
            <span className="concept-name">{c.name}</span>
            <span className="concept-status">
              {STATUS[c.status].icon && <span aria-hidden="true">{STATUS[c.status].icon} </span>}
              {STATUS[c.status].label}
            </span>
          </div>
          <span className="concept-bar" role="img" aria-label={`${c.p}% mastery`}>
            <span style={{ width: `${c.p}%` }} />
          </span>
          <span className="concept-meta">
            {c.answered ? `${c.p}% · ${c.correct} of ${c.answered} right` : 'No answers yet'}
            {c.waitingOn.length > 0 && c.status !== 'mastered' && ` · builds on ${c.waitingOn.join(', ')}`}
          </span>
        </li>
      ))}
    </ul>
  );
}
