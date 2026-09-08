-- Stop a double submit creating two attempts.
--
-- The client makes an id when it opens a quiz and sends it with the answers.
-- Pressing submit twice, or refreshing and submitting again, sends the same id,
-- and the unique index means the second insert does nothing rather than
-- recording a second attempt (HLD test A6).
--
-- Nullable, so a game attempt or an older row does not need one, and the
-- partial index leaves those alone.

BEGIN;

ALTER TABLE attempts
  ADD COLUMN IF NOT EXISTS client_attempt_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_attempts_client_attempt_id
  ON attempts (client_attempt_id)
  WHERE client_attempt_id IS NOT NULL;

COMMIT;
