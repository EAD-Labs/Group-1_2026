-- Who changed a question last, and when (content management, HLD UC-04).
-- The importer leaves an edited question alone, so a deploy cannot put the
-- old version back. Safe to re-run.
BEGIN;

ALTER TABLE questions ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS edited_by INT REFERENCES users (id) ON DELETE SET NULL;

COMMIT;
