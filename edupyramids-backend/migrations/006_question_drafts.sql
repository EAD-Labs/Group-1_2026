-- Questions generated from Spoken Tutorial videos, waiting for a person.
--
-- A generated question is a draft until a teacher or coordinator approves it.
-- Approving copies it into `questions`, where students can see it; until then
-- it lives only here. Rejected drafts are kept, so the same bad question is
-- recognisable if it is generated again, and so the approval rate of the
-- generator can be measured.
BEGIN;

CREATE TABLE IF NOT EXISTS question_drafts (
  id             SERIAL PRIMARY KEY,
  video_slug     VARCHAR(100),                 -- null for pasted text
  source_title   VARCHAR(255) NOT NULL,
  text           TEXT NOT NULL,
  options        JSONB NOT NULL,               -- { "a": "...", "b": "...", ... }
  correct        CHAR(1) NOT NULL CHECK (correct IN ('a','b','c','d','e')),
  explanation    TEXT,
  concepts       TEXT[] NOT NULL DEFAULT '{}',
  difficulty     INT NOT NULL DEFAULT 2 CHECK (difficulty BETWEEN 1 AND 3),
  taught_at      VARCHAR(8),                   -- "mm:ss" in the video
  model          VARCHAR(60) NOT NULL,
  status         VARCHAR(10) NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'approved', 'rejected')),
  created_by     INT REFERENCES users (id) ON DELETE SET NULL,
  reviewed_by    INT REFERENCES users (id) ON DELETE SET NULL,
  question_id    INT REFERENCES questions (id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_question_drafts_video ON question_drafts (video_slug, status);

COMMIT;
