-- Stars and hints for games.
--
-- stars is kept on the attempt so a best can be shown without re-marking.
-- Hints are recorded by the server when they are given, against the
-- attempt's client id, so the count that decides the third star is not the
-- browser's word. Safe to re-run.
BEGIN;

ALTER TABLE attempts ADD COLUMN IF NOT EXISTS stars SMALLINT;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS hints_used INT NOT NULL DEFAULT 0;
ALTER TABLE attempts DROP CONSTRAINT IF EXISTS attempts_stars_range;
ALTER TABLE attempts ADD CONSTRAINT attempts_stars_range CHECK (stars IS NULL OR stars BETWEEN 0 AND 3);

CREATE TABLE IF NOT EXISTS game_hints (
  client_attempt_id UUID        NOT NULL,
  student_id        INT         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  game_id           INT         NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  item              TEXT        NOT NULL,
  level             INT         NOT NULL CHECK (level BETWEEN 1 AND 3),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_attempt_id, item, level)
);

COMMIT;
