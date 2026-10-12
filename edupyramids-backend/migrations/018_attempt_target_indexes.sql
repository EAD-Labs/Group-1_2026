-- Attempts looked up by the quiz or game they were for. The class reports and
-- the hardest-questions list go through quiz_id, and deleting a quiz or game
-- sets these columns to NULL, which without an index reads every attempt ever
-- made. Safe to re-run.
BEGIN;

CREATE INDEX IF NOT EXISTS idx_attempts_quiz_id ON attempts (quiz_id);
CREATE INDEX IF NOT EXISTS idx_attempts_game_id ON attempts (game_id);

COMMIT;
