-- Adaptive learning: concepts, what each student knows of them, and every
-- answer that moved that estimate.
--
-- A topic ("Silver Level") is how the course is organised. A concept
-- ("Loops and range") is what a question actually tests, and it is what the
-- mastery model tracks. A question can test more than one.
BEGIN;

CREATE TABLE IF NOT EXISTS concepts (
  id           SERIAL PRIMARY KEY,
  slug         VARCHAR(50)  NOT NULL UNIQUE,
  name         VARCHAR(100) NOT NULL,
  description  TEXT,
  sort_order   INT NOT NULL DEFAULT 0,
  -- Slugs of the concepts this one builds on. Practice suggests a concept
  -- once these are reasonably known; it never locks anything.
  requires     TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS question_concepts (
  question_id  INT NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  concept_id   INT NOT NULL REFERENCES concepts (id)  ON DELETE CASCADE,
  PRIMARY KEY (question_id, concept_id)
);
CREATE INDEX IF NOT EXISTS idx_question_concepts_concept ON question_concepts (concept_id);

-- One row per student per concept, created on their first answer.
-- p_known is the Bayesian Knowledge Tracing estimate that the student knows
-- the concept. The review columns are the spaced-repetition schedule, used
-- once a concept is mastered.
CREATE TABLE IF NOT EXISTS concept_mastery (
  student_id       INT NOT NULL REFERENCES users (id)    ON DELETE CASCADE,
  concept_id       INT NOT NULL REFERENCES concepts (id) ON DELETE CASCADE,
  p_known          DOUBLE PRECISION NOT NULL CHECK (p_known BETWEEN 0 AND 1),
  answered         INT NOT NULL DEFAULT 0,
  correct          INT NOT NULL DEFAULT 0,
  mastered_at      TIMESTAMPTZ,
  review_interval  DOUBLE PRECISION NOT NULL DEFAULT 0,   -- days
  next_review      TIMESTAMPTZ,
  last_seen        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, concept_id)
);

-- Every marked answer, from any source, with the estimate before and after.
-- This is the raw material for learning curves and for checking that the
-- model's predictions hold up against what students actually do.
CREATE TABLE IF NOT EXISTS responses (
  id            BIGSERIAL PRIMARY KEY,
  student_id    INT NOT NULL REFERENCES users (id)     ON DELETE CASCADE,
  question_id   INT NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  concept_id    INT NOT NULL REFERENCES concepts (id)  ON DELETE CASCADE,
  source        VARCHAR(10) NOT NULL CHECK (source IN ('quiz', 'practice', 'live')),
  correct       BOOLEAN NOT NULL,
  p_before      DOUBLE PRECISION NOT NULL,
  p_after       DOUBLE PRECISION NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_responses_student  ON responses (student_id, created_at);
CREATE INDEX IF NOT EXISTS idx_responses_question ON responses (question_id);

COMMIT;
