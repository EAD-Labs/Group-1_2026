import { Link } from 'react-router-dom';
import { kindOf } from '../games/registry';
import Stars from './Stars';

/** One game as a tile: what kind it is, where it sits, and how the student has done. */
export default function GameTile({ game }) {
  const kind = kindOf(game.kind);
  return (
    <Link className={`tile tile--l${game.level}`} to={`/game/${game.id}`}>
      <span className="tile-top">
        <span className="tile-icon" aria-hidden="true">{kind.icon}</span>
        <span className="tile-kind">{kind.label}</span>
      </span>
      <span className="tile-name">{game.title}</span>
      <span className="tile-meta">{game.topic}</span>
      <span className="tile-bar">
        <span style={{ width: `${game.attempts ? game.bestPercent : 0}%` }} />
      </span>
      <span className="tile-meta tile-best">
        {game.attempts ? <>Best {game.bestPercent}% <Stars n={game.bestStars ?? 0} size="sm" /></> : 'Not played yet'}
      </span>
    </Link>
  );
}
