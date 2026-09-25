import { useState } from 'react';
import { client } from '../api/client';

/*
 * The daily picture: build streak, today's XP against the goal, and the week.
 *
 * Kept small on purpose. It answers "have I done my bit today?" and nothing
 * else; the pyramid answers "what next?".
 */

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const STATE_LABEL = {
  active: 'built', frozen: 'covered by a shield', missed: 'missed', weekend: 'weekend', today: 'today, not yet', none: 'nothing',
};

/** A ring that fills as today's XP approaches the goal. */
function GoalRing({ xp, goal }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  const part = Math.min(1, xp / goal);
  return (
    <svg className="goal-ring" viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r={r} className="goal-ring-track" />
      <circle cx="24" cy="24" r={r} className="goal-ring-fill" strokeDasharray={`${c * part} ${c}`} transform="rotate(-90 24 24)" />
      {xp >= goal && <text x="24" y="29" textAnchor="middle" className="goal-ring-tick">✓</text>}
    </svg>
  );
}

export function DailyStrip({ daily }) {
  const { streak, today, goal, week } = daily;
  const met = today.xp >= goal;
  return (
    <section className="daily" aria-label="Today">
      <div className={`daily-streak${today.done ? ' daily-streak--lit' : ''}`}>
        <span className="daily-flame" aria-hidden="true">🧱</span>
        <span>
          <strong>{streak.current}</strong>-day build streak
          <span className="daily-sub">{today.done ? 'kept today' : streak.current ? 'build once to keep it' : 'start one today'}</span>
        </span>
        {streak.freezes > 0 && (
          <span className="daily-freeze" title="A shield covers a missed school day by itself">🛡️ {streak.freezes}</span>
        )}
      </div>

      <div className="daily-goal">
        <GoalRing xp={today.xp} goal={goal} />
        <span>
          <strong>{today.xp}</strong> / {goal} XP
          <span className="daily-sub">{met ? 'daily goal done!' : 'daily goal'}</span>
        </span>
      </div>

      <ol className="daily-week" aria-label="The last seven days">
        {week.map((d) => (
          <li key={d.day} className={`daily-day daily-day--${d.state}`} title={`${d.day}: ${STATE_LABEL[d.state]}${d.xp ? `, ${d.xp} XP` : ''}`}>
            <span className="daily-dot" aria-hidden="true">{d.state === 'active' ? '🧱' : d.state === 'frozen' ? '🛡️' : ''}</span>
            <span className="daily-letter">{DAY_LETTERS[d.weekday]}</span>
            <span className="sr-only">{d.day}: {STATE_LABEL[d.state]}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

const GOAL_NAMES = { 10: 'Casual', 20: 'Regular', 30: 'Serious', 50: 'Intense' };

/** Choosing the daily goal, and what the streak rules are. */
export function GoalSettings({ daily, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function choose(goal) {
    setBusy(true);
    setError(null);
    try {
      const res = await client.put('/me/goal', { goal });
      onChange(res.data);
    } catch (err) {
      setError(err.status === 0 ? 'Changing the goal needs a connection.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="goal-settings">
      <h2 className="h2">Daily goal</h2>
      <div className="goal-choices" role="radiogroup" aria-label="Daily XP goal">
        {daily.goals.map((g) => (
          <button key={g} type="button" role="radio" aria-checked={daily.goal === g} disabled={busy}
            className={`goal-choice${daily.goal === g ? ' goal-choice--on' : ''}`} onClick={() => choose(g)}>
            <strong>{GOAL_NAMES[g] || g}</strong>
            <span>{g} XP a day</span>
          </button>
        ))}
      </div>
      {error && <p className="alert" role="alert">{error}</p>}
      <p className="muted small">
        Best build streak: {daily.streak.longest} day{daily.streak.longest === 1 ? '' : 's'} · {daily.xp.total} XP in all.
        Finishing a quiz or game gives up to 10 XP, depending on your score, and 5 more for each new star; setting a keystone gives 20. Weekends never break a
        streak, and every {daily.streak.freezeEvery} days in a row earn a 🛡️ shield (up to {daily.streak.maxFreezes})
        that covers a missed school day.
      </p>
    </section>
  );
}
