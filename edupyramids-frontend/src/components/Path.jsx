import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { kindOf } from '../games/registry';
import { topicIcon } from '../utils/useApi';
import Stars from './Stars';

/*
 * The learning path: one winding road of nodes per unit, after Duolingo.
 *
 * Every node is a link when it is open and a plain, labelled circle when it
 * is locked, so the road reads the same to a screen reader as it looks. The
 * page scrolls to the student's current node, the one marked Start.
 */

// Sideways offsets that make the road wind: in rem, repeating.
const WIND = [0, 2.6, 4, 2.6, 0, -2.6, -4, -2.6];

const iconOf = (node) => (node.type === 'quiz' ? '📝' : kindOf(node.kind).icon);
const hrefOf = (node) => (node.type === 'quiz' ? `/quiz/${node.id}` : `/game/${node.id}`);
const labelOf = (node) => (node.type === 'quiz' ? 'Quiz' : kindOf(node.kind).label);

function Node({ node, offset, nowRef }) {
  const current = node.state === 'current';
  const body = (
    <>
      {current && <span className="node-start" aria-hidden="true">Start</span>}
      <span className="node-circle" aria-hidden="true">
        {node.state === 'locked' ? '🔒' : iconOf(node)}
      </span>
      <span className="node-label">
        <span className="node-title">{node.title}</span>
        <span className="node-kind">{labelOf(node)}</span>
        {node.state === 'done' && <Stars n={node.stars} size="sm" />}
      </span>
    </>
  );
  const style = { '--x': `${offset}rem` };
  const status = { done: 'done', current: 'up next', open: 'open', locked: 'locked' }[node.state];

  return (
    <li className={`node node--${node.state}`} style={style} ref={current ? nowRef : undefined}>
      {node.state === 'locked'
        ? <span className="node-link" aria-label={`${node.title}, ${labelOf(node)}, locked`}>{body}</span>
        : <Link className="node-link" to={hrefOf(node)} aria-label={`${node.title}, ${labelOf(node)}, ${status}`}>{body}</Link>}
    </li>
  );
}

function Checkpoint({ unit, offset, nowRef }) {
  const cp = unit.checkpoint;
  const current = cp.state === 'current';
  const body = (
    <>
      {current && <span className="node-start" aria-hidden="true">Start</span>}
      <span className="node-circle node-circle--big" aria-hidden="true">{cp.state === 'locked' ? '🔒' : '🏰'}</span>
      <span className="node-label">
        <span className="node-title">Checkpoint</span>
        <span className="node-kind">
          {cp.passed ? 'Passed' : cp.state === 'locked' ? 'Finish the unit to open it' : 'Mixed challenge: opens the next unit'}
        </span>
      </span>
    </>
  );
  return (
    <li className={`node node--checkpoint node--${cp.state}`} style={{ '--x': `${offset}rem` }} ref={current ? nowRef : undefined}>
      {cp.state === 'locked'
        ? <span className="node-link" aria-label={`${unit.topic} checkpoint, locked`}>{body}</span>
        : <Link className="node-link" to={`/checkpoint/${unit.topicId}`} aria-label={`${unit.topic} checkpoint${cp.passed ? ', passed' : ''}`}>{body}</Link>}
    </li>
  );
}

/** Concepts from this unit that are fading: a short review, from the path (spaced repetition). */
function ReviewNode({ review }) {
  const names = review.concepts.map((c) => c.name);
  const label = names.length > 2 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : names.join(' and ');
  return (
    <li className="node node--review">
      <Link className="node-link" to={review.href} aria-label={`Review ${label}: due now, ${review.questions} questions`}>
        <span className="node-start node-start--review" aria-hidden="true">Review</span>
        <span className="node-circle" aria-hidden="true">🔨</span>
        <span className="node-label">
          <span className="node-title">{label}</span>
          <span className="node-kind">Fading · {review.questions} quick questions</span>
        </span>
      </Link>
    </li>
  );
}

export default function Path({ units }) {
  const nowRef = useRef(null);
  useEffect(() => {
    nowRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);

  return (
    <ol className="path">
      {units.map((u, ui) => {
        const jumpUnit = u.jumpFrom && units.find((x) => x.topicId === u.jumpFrom);
        return (
          <li key={u.topicId} className={`unit tile--l${u.level}${u.unlocked ? '' : ' unit--locked'}`}>
            <header className="unit-head">
              <span className="unit-icon" aria-hidden="true">{topicIcon(u.topic)}</span>
              <span className="unit-title">
                <span className="unit-eyebrow">Unit {ui + 1}</span>
                <h2>{u.topic}</h2>
              </span>
              <span className="unit-progress">
                <span className="tile-bar"><span style={{ width: `${(u.progress.done / Math.max(1, u.progress.total)) * 100}%` }} /></span>
                <span className="small">{u.progress.done} of {u.progress.total}</span>
              </span>
            </header>

            {jumpUnit && (
              <p className="unit-jump">
                Already know this?{' '}
                <Link to={`/checkpoint/${jumpUnit.topicId}`}>Pass the {jumpUnit.topic} checkpoint to jump here →</Link>
              </p>
            )}

            <ol className="road">
              {u.review && <ReviewNode review={u.review} />}
              {u.nodes.map((n, i) => <Node key={`${n.type}${n.id}`} node={n} offset={WIND[i % WIND.length]} nowRef={nowRef} />)}
              {u.hasCheckpoint && <Checkpoint unit={u} offset={WIND[u.nodes.length % WIND.length]} nowRef={nowRef} />}
            </ol>

            {u.extras.length > 0 && (
              <div className="warmups">
                <p className="warmups-head">Warm-ups <span className="muted small">optional, any time</span></p>
                <ul className="warmups-list">
                  {u.extras.map((g) => (
                    <li key={g.id}>
                      {g.state === 'locked' ? (
                        <span className="warmup warmup--locked">🔒 {g.title}</span>
                      ) : (
                        <Link className="warmup" to={`/game/${g.id}`}>
                          <span aria-hidden="true">{kindOf(g.kind).icon}</span> {g.title}
                          {g.stars > 0 && <Stars n={g.stars} size="sm" />}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
