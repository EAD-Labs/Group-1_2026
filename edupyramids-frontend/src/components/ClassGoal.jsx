import { useEffect, useState } from 'react';
import { client } from '../api/client';

/*
 * The class goal: one shared weekly XP target for the whole class.
 *
 * Working together towards one number, rather than a ranking, keeps the
 * motivation of competition without discouraging the students at the bottom
 * of a leaderboard. A student sees the total, how many classmates are
 * active and their own share. A teacher also sees who has not practised yet.
 */
const fmt = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function ClassGoalCard({ week, mine = null, quiet = null, compact = false }) {
  const part = Math.min(100, Math.round((week.xp / week.goal) * 100));
  const done = week.xp >= week.goal;
  if (compact) {
    return (
      <section className={`class-goal class-goal--compact${done ? ' class-goal--done' : ''}`} aria-label="Class goal this week">
        <span className="class-goal-title"><span aria-hidden="true">{done ? '🏆' : '🎯'}</span> {week.name}</span>
        <span className="class-goal-bar" role="progressbar" aria-valuemin={0} aria-valuemax={week.goal} aria-valuenow={week.xp}
          aria-label={`${week.name} weekly XP`}><span style={{ width: `${part}%` }} /></span>
        <span className="class-goal-sub">
          <strong>{week.xp}</strong>/{week.goal} XP this week · {week.active} of {week.students} active
          {mine !== null && <> · you {mine}</>}
        </span>
      </section>
    );
  }
  return (
    <section className={`class-goal${done ? ' class-goal--done' : ''}`}>
      <p className="class-goal-eyebrow">Class goal · {fmt(week.from)} to {fmt(week.to)}</p>
      <p className="class-goal-title">
        <span aria-hidden="true">{done ? '🏆' : '🎯'}</span> {week.name}: <strong>{week.xp}</strong> / {week.goal} XP
      </p>
      <div className="class-goal-bar" role="progressbar" aria-valuemin={0} aria-valuemax={week.goal} aria-valuenow={week.xp}
        aria-label={`${week.name} weekly XP`}>
        <span style={{ width: `${part}%` }} />
      </div>
      <p className="class-goal-sub">
        {week.active} of {week.students} student{week.students === 1 ? '' : 's'} active this week
        {mine !== null && <> · you added <strong>{mine} XP</strong></>}
        {done && ' · goal reached, well done everyone!'}
      </p>
      {quiet && quiet.length > 0 && (
        <details className="class-goal-quiet">
          <summary>{quiet.length} not practised yet this week</summary>
          <p>{quiet.map((s) => s.name).join(', ')}</p>
        </details>
      )}
    </section>
  );
}

/** For a teacher's dashboard: fetches the class's week, names included. */
export function TeacherClassGoal({ classId }) {
  const [week, setWeek] = useState(null);
  useEffect(() => {
    let live = true;
    setWeek(null);
    client.get(`/analytics/classes/${classId}/week`).then((res) => live && setWeek(res.data)).catch(() => {});
    return () => { live = false; };
  }, [classId]);
  return week ? <ClassGoalCard week={week} quiet={week.quiet} /> : null;
}
