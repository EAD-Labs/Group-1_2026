-- Games count as evidence for the mastery model.
--
-- Each game names the concepts it practises. A finished game is one piece of
-- evidence per concept, logged in responses like any answer, with the game in
-- place of a question. Safe to re-run.
BEGIN;

ALTER TABLE games ADD COLUMN IF NOT EXISTS concepts TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE responses ALTER COLUMN question_id DROP NOT NULL;
ALTER TABLE responses ADD COLUMN IF NOT EXISTS game_id INT REFERENCES games (id) ON DELETE CASCADE;
ALTER TABLE responses DROP CONSTRAINT IF EXISTS responses_evidence_target;
ALTER TABLE responses ADD CONSTRAINT responses_evidence_target
  CHECK (question_id IS NOT NULL OR game_id IS NOT NULL);
ALTER TABLE responses DROP CONSTRAINT IF EXISTS responses_source_check;
ALTER TABLE responses ADD CONSTRAINT responses_source_check
  CHECK (source IN ('quiz', 'practice', 'live', 'checkpoint', 'game'));
CREATE INDEX IF NOT EXISTS idx_responses_game ON responses (game_id) WHERE game_id IS NOT NULL;

COMMIT;
