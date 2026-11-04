-- A keystone's result shows the right answers, so its ticket must work only
-- once: otherwise the same questions can be sent again with those answers.
-- Older rows have no hash and are left alone. Safe to re-run.
BEGIN;

ALTER TABLE checkpoint_attempts ADD COLUMN IF NOT EXISTS ticket_hash CHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS checkpoint_attempts_ticket_once
  ON checkpoint_attempts (ticket_hash) WHERE ticket_hash IS NOT NULL;

COMMIT;
