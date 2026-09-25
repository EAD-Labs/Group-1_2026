-- Which lesson of a quiz an attempt was (see src/services/lessonService.js).
-- Empty for an attempt at the whole quiz. Safe to re-run.
BEGIN;

ALTER TABLE attempts ADD COLUMN IF NOT EXISTS lesson SMALLINT;
ALTER TABLE attempts DROP CONSTRAINT IF EXISTS attempts_lesson_positive;
ALTER TABLE attempts ADD CONSTRAINT attempts_lesson_positive CHECK (lesson IS NULL OR lesson >= 1);

COMMIT;
