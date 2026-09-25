-- Small facts about the app's own state, such as "the demo classes finished
-- generating". A job that can be cut off part way (the server restarting while
-- it runs) records here that it completed, so the next start can tell a
-- finished job from a half-finished one. Safe to re-run.
BEGIN;

CREATE TABLE IF NOT EXISTS app_flags (
  name        TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
