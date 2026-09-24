-- Each student's daily XP goal. XP and streaks are worked out from the
-- attempts, checkpoints and practice answers already stored, so the goal is
-- the only new thing to keep. Safe to re-run.
BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_goal SMALLINT NOT NULL DEFAULT 20;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_daily_goal_choice;
ALTER TABLE users ADD CONSTRAINT users_daily_goal_choice CHECK (daily_goal IN (10, 20, 30, 50));

COMMIT;
