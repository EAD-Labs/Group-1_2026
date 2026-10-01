-- When a password last changed. A sign-in token issued before it is no
-- longer accepted, so a new password (or a coordinator's reset) ends every
-- session that used the old one: on a shared lab computer, the person who
-- knew the old password is signed out too. Safe to re-run.
BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

COMMIT;
