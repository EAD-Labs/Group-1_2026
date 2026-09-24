-- The learning path's checkpoints.
--
-- A checkpoint is the mixed challenge at the end of a unit; passing it opens
-- the next unit. Each try is kept, so a teacher can see how many it took.
-- Checkpoint answers also feed the mastery model, as a new response source.
-- Safe to re-run.
BEGIN;

CREATE TABLE IF NOT EXISTS checkpoint_attempts (
  id          SERIAL PRIMARY KEY,
  student_id  INT         NOT NULL REFERENCES users (id)  ON DELETE CASCADE,
  topic_id    INT         NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
  score       INT         NOT NULL CHECK (score >= 0),
  max_score   INT         NOT NULL CHECK (max_score > 0),
  passed      BOOLEAN     NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (score <= max_score)
);
CREATE INDEX IF NOT EXISTS idx_checkpoint_attempts_student ON checkpoint_attempts (student_id, topic_id);

ALTER TABLE responses DROP CONSTRAINT IF EXISTS responses_source_check;
ALTER TABLE responses ADD CONSTRAINT responses_source_check
  CHECK (source IN ('quiz', 'practice', 'live', 'checkpoint'));

COMMIT;
