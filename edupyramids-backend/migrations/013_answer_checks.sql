-- Instant checks, remembered (see src/services/checkService.js).
--
-- A quiz question, a trace step or a memory pair checked during play is kept
-- against the attempt, so the answer that counts is the one checked first,
-- not one changed after the right answer was shown. Safe to re-run.
BEGIN;

CREATE TABLE IF NOT EXISTS answer_checks (
  id                BIGSERIAL PRIMARY KEY,
  client_attempt_id UUID        NOT NULL,
  student_id        INT         NOT NULL REFERENCES users (id)   ON DELETE CASCADE,
  quiz_id           INT                  REFERENCES quizzes (id) ON DELETE CASCADE,
  game_id           INT                  REFERENCES games (id)   ON DELETE CASCADE,
  item              TEXT        NOT NULL,
  value             JSONB       NOT NULL,
  correct           BOOLEAN     NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT answer_checks_one_target CHECK ((quiz_id IS NULL) <> (game_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_answer_checks_attempt ON answer_checks (client_attempt_id, student_id);

COMMIT;
