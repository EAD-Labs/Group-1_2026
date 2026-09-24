import { useState } from 'react';
import DashboardShell from '../components/DashboardShell';
import GameTile from '../components/GameTile';
import { GAME_KINDS, kindOf } from '../games/registry';
import { useApi } from '../utils/useApi';

/*
 * Play: every game, filtered by the skill it practises or by level. Filters
 * are buttons, not a dropdown, so the choices are visible without a tap.
 */
const SKILL_HELP = {
  Recognise: 'spot the right answer',
  Recall: 'remember what goes with what',
  Trace: 'work out what code does',
  Write: 'put code together',
  Debug: 'find and fix mistakes',
  Test: 'choose tests that catch hidden bugs',
};

export default function Play() {
  const { loading, error, data } = useApi(['/games']);
  const [skill, setSkill] = useState('All');
  const [level, setLevel] = useState('All');

  if (loading || error) {
    return (
      <DashboardShell title="Play">
        {error ? <p className="alert" role="alert">{error}</p> : <p className="muted">Loading…</p>}
      </DashboardShell>
    );
  }

  const [games] = data;
  const skills = ['All', ...new Set(Object.values(GAME_KINDS).map((k) => k.skill))]
    .filter((s) => s === 'All' || games.some((g) => kindOf(g.kind).skill === s));
  const levels = ['All', ...new Set(games.map((g) => g.topic))];

  const shown = games.filter((g) => (skill === 'All' || kindOf(g.kind).skill === skill)
    && (level === 'All' || g.topic === level));

  return (
    <DashboardShell title="Play">
      <div className="filters">
        <div className="filter-row" role="group" aria-label="Skill">
          {skills.map((s) => (
            <button key={s} type="button" aria-pressed={skill === s}
              className={`chip-pick${skill === s ? ' chip-pick--on' : ''}`} onClick={() => setSkill(s)}>
              {s}
            </button>
          ))}
        </div>
        <div className="filter-row" role="group" aria-label="Level">
          {levels.map((l) => (
            <button key={l} type="button" aria-pressed={level === l}
              className={`chip-pick chip-pick--quiet${level === l ? ' chip-pick--on' : ''}`} onClick={() => setLevel(l)}>
              {l === 'All' ? 'Every level' : l}
            </button>
          ))}
        </div>
        {skill !== 'All' && <p className="muted small">{skill} games: {SKILL_HELP[skill]}.</p>}
      </div>

      {shown.length === 0
        ? <p className="empty">No games match those filters.</p>
        : <ul className="tiles">{shown.map((g) => <li key={g.id}><GameTile game={g} /></li>)}</ul>}
    </DashboardShell>
  );
}
