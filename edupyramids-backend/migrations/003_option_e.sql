-- The client's Moodle export has 18 questions with five options; the table had
-- four. Widen rather than drop 13% of their content.
BEGIN;

ALTER TABLE questions ADD COLUMN IF NOT EXISTS option_e VARCHAR(255);

ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_correct_answer_check;
ALTER TABLE questions ADD CONSTRAINT questions_correct_answer_check
  CHECK (correct_answer IN ('a','b','c','d','e'));

COMMIT;
