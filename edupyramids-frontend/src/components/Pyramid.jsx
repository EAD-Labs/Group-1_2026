import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { kindOf } from '../games/registry';
import Stars from './Stars';

/*
 * The course as a pyramid the student builds, from the base up.
 *
 * Each level is a tier: Bronze is the foundation, the last level the
 * capstone. Every quiz and game is a brick, set in place once it has a star
 * and coloured by how many (sandstone, bronze, gold). The checkpoint is the
 * keystone: set it and the tier above can be built. A concept that is
 * starting to fade shows as a cracked brick to repair.
 *
 * The rules underneath (what opens when) come from /api/path; this only
 * draws them. Seeing the whole structure, and how close the top is, is the
 * point: people work harder the nearer a goal looks (Kivetz et al., 2006).
 */

const iconOf = (brick) => (brick.type === 'quiz' ? '📝' : kindOf(brick.kind).icon);
const hrefOf = (brick) => (brick.type === 'quiz' ? `/quiz/${brick.id}` : `/game/${brick.id}`);
const labelOf = (brick) => (brick.type === 'quiz' ? 'Quiz' : kindOf(brick.kind).label);
const STATUS = {
  done: 'set', current: 'build this next', open: 'ready to build', locked: 'locked',
};

function Brick({ brick, nowRef }) {
  const { state } = brick;
  const tone = state === 'done' ? ` brick--s${brick.stars}` : '';
  const inner = (
    <>
      {state === 'current' && <span className="brick-tag" aria-hidden="true">Build</span>}
      <span className="brick-icon" aria-hidden="true">{state === 'locked' ? '🔒' : iconOf(brick)}</span>
      <span className="brick-title">{brick.title}</span>
      <span className="brick-kind">{labelOf(brick)}</span>
      {state === 'done' && <Stars n={brick.stars} size="sm" />}
    </>
  );
  const name = `${brick.title}, ${labelOf(brick)}, ${STATUS[state]}${state === 'done' ? `, ${brick.stars} of 3 stars` : ''}`;
  return (
    <li className={`brick brick--${state}${tone}`} ref={state === 'current' ? nowRef : undefined}>
      {state === 'locked'
        ? <span className="brick-face" aria-label={name}>{inner}</span>
        : <Link className="brick-face" to={hrefOf(brick)} aria-label={name}>{inner}</Link>}
    </li>
  );
}

function Keystone({ unit, nowRef }) {
  const { state, passed } = unit.checkpoint;
  const inner = (
    <>
      {state === 'current' && <span className="brick-tag" aria-hidden="true">Build</span>}
      <span className="brick-icon" aria-hidden="true">{state === 'locked' ? '🔒' : '🗝️'}</span>
      <span className="brick-title">Keystone</span>
      <span className="brick-kind">{passed ? 'Set: the next tier is open' : state === 'locked' ? 'Set every brick first' : 'Mixed challenge'}</span>
    </>
  );
  return (
    <li className={`brick brick--keystone brick--${state}${passed ? ' brick--s3' : ''}`} ref={state === 'current' ? nowRef : undefined}>
      {state === 'locked'
        ? <span className="brick-face" aria-label={`${unit.topic} keystone, locked`}>{inner}</span>
        : <Link className="brick-face" to={`/checkpoint/${unit.topicId}`} aria-label={`${unit.topic} keystone${passed ? ', set' : ''}`}>{inner}</Link>}
    </li>
  );
}

/** A concept from this tier that is fading: a cracked brick, repaired by a short review. */
function CrackedBrick({ review }) {
  const names = review.concepts.map((c) => c.name);
  const label = names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
  return (
    <li className="brick brick--cracked">
      <Link className="brick-face" to={review.href} aria-label={`Cracked: ${label}. Repair with ${review.questions} questions`}>
        <span className="brick-tag brick-tag--repair" aria-hidden="true">Repair</span>
        <svg className="brick-crack" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
          <path d="M8 4 L30 22 L24 32 L46 44 L40 56 M30 22 L52 16 M46 44 L70 38 L92 54" />
        </svg>
        <span className="brick-icon" aria-hidden="true">🔨</span>
        <span className="brick-title">{label}</span>
        <span className="brick-kind">Fading · {review.questions} questions</span>
      </Link>
    </li>
  );
}

export default function Pyramid({ units }) {
  const nowRef = useRef(null);
  useEffect(() => {
    nowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, []);

  const top = units.length - 1;
  const finished = units.length > 0 && units.every((u) => u.progress.done === u.progress.total);
  // Drawn from the capstone down to the foundation, each tier wider than the one above.
  const tiers = units.map((u, i) => ({ u, i })).reverse();

  return (
    <div className="pyramid-scene">
      <div className={`pyramid-cap${finished ? ' pyramid-cap--lit' : ''}`} aria-hidden="true" />
      <ol className="pyramid" aria-label="Your pyramid, from the capstone down to the foundation">
        {tiers.map(({ u, i }) => {
          // Narrower towards the top; on a phone less so, to keep two bricks a row.
          const width = units.length > 1 ? 52 + (48 * (top - i)) / top : 100;
          const phone = units.length > 1 ? 76 + (24 * (top - i)) / top : 100;
          const jumpUnit = u.jumpFrom && units.find((x) => x.topicId === u.jumpFrom);
          return (
            <li key={u.topicId} className={`tier tile--l${u.level}${u.unlocked ? '' : ' tier--locked'}`}
              style={{ '--w': `${width}%`, '--wp': `${phone}%` }}>
              <header className="tier-head">
                <span className="tier-name">
                  {i === top && units.length > 1 ? 'Capstone' : i === 0 ? 'Foundation' : `Tier ${i + 1}`} · <strong>{u.topic}</strong>
                </span>
                <span className="tier-count">{u.progress.done}/{u.progress.total} bricks</span>
              </header>

              {jumpUnit && (
                <p className="tier-jump">
                  <Link to={`/checkpoint/${jumpUnit.topicId}`}>Know this already? Set the {jumpUnit.topic} keystone →</Link>
                </p>
              )}

              <ol className="bricks">
                {u.review && <CrackedBrick review={u.review} />}
                {u.nodes.map((n) => <Brick key={`${n.type}${n.id}`} brick={n} nowRef={nowRef} />)}
                {u.hasCheckpoint && <Keystone unit={u} nowRef={nowRef} />}
              </ol>

              {u.extras.length > 0 && (
                <details className="stones">
                  <summary>{u.extras.length} warm-up stone{u.extras.length === 1 ? '' : 's'} <span className="muted">· optional</span></summary>
                  <ul className="stones-list">
                    {u.extras.map((g) => (
                      <li key={g.id}>
                        {g.state === 'locked' ? (
                          <span className="stone stone--locked">🔒 {g.title}</span>
                        ) : (
                          <Link className="stone" to={`/game/${g.id}`}>
                            <span aria-hidden="true">{kindOf(g.kind).icon}</span> {g.title}
                            {g.stars > 0 && <Stars n={g.stars} size="sm" />}
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          );
        })}
      </ol>
      <div className="pyramid-ground" aria-hidden="true" />
    </div>
  );
}
