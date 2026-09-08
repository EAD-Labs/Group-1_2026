-- EduPyramids Gamified Learning Companion
-- 001_init.sql — initial schema
--
-- Two things differ from the Week 3 specification draft, both deliberate:
--
-- 1. Indexes are separate CREATE INDEX statements. `INDEX name (col)` inside
--    CREATE TABLE is MySQL syntax; PostgreSQL rejects it outright, so the draft
--    could not be run at all.
--
-- 2. Quiz attempts and game results share one `attempts` table, told apart by
--    `kind`, and topics are a table rather than a repeated string. This is the
--    design in the HLD ER diagram the client has already been given: one
--    attempts table is what lets a single dashboard query cover quizzes and
--    games without special-casing either (HLD Section 13.3).
--
-- Safe to re-run: everything is IF NOT EXISTS.

BEGIN;

-- ---------------------------------------------------------------- topics
CREATE TABLE IF NOT EXISTS topics (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,
  -- Which level unlocks this topic. Levels only ever go up (HLD D-05).
  level       INT NOT NULL DEFAULT 1,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- users
CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  email          VARCHAR(255) NOT NULL UNIQUE,
  -- bcrypt only. Nothing anywhere may store a readable password (HLD test D6).
  password_hash  VARCHAR(255) NOT NULL,
  name           VARCHAR(255) NOT NULL,
  role           VARCHAR(50)  NOT NULL
                 CHECK (role IN ('student', 'teacher', 'coordinator')),
  school_id      VARCHAR(100),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_role  ON users (role);

-- ---------------------------------------------------------------- classes
CREATE TABLE IF NOT EXISTS classes (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  teacher_id  INT REFERENCES users (id) ON DELETE SET NULL,
  school_id   VARCHAR(100),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_classes_teacher_id ON classes (teacher_id);

-- A student belongs to a class; a teacher owns one. Kept as a join table so a
-- student can be moved between classes without rewriting the users row.
CREATE TABLE IF NOT EXISTS class_students (
  class_id    INT NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  student_id  INT NOT NULL REFERENCES users (id)   ON DELETE CASCADE,
  PRIMARY KEY (class_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_class_students_student ON class_students (student_id);

-- ---------------------------------------------------------------- content
CREATE TABLE IF NOT EXISTS quizzes (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(255) NOT NULL,
  topic_id    INT NOT NULL REFERENCES topics (id) ON DELETE RESTRICT,
  difficulty  INT NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quizzes_topic_id ON quizzes (topic_id);

CREATE TABLE IF NOT EXISTS questions (
  id              SERIAL PRIMARY KEY,
  quiz_id         INT NOT NULL REFERENCES quizzes (id) ON DELETE CASCADE,
  text            TEXT NOT NULL,
  option_a        VARCHAR(255) NOT NULL,
  option_b        VARCHAR(255) NOT NULL,
  option_c        VARCHAR(255),
  option_d        VARCHAR(255),
  -- NOT NULL is the point of HLD test A4: a question file missing a correct
  -- answer must be refused at load time rather than half-imported.
  correct_answer  CHAR(1) NOT NULL CHECK (correct_answer IN ('a','b','c','d')),
  explanation     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_questions_quiz_id ON questions (quiz_id);

CREATE TABLE IF NOT EXISTS games (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(255) NOT NULL,
  kind        VARCHAR(50) NOT NULL CHECK (kind IN ('drag_drop', 'matching')),
  topic_id    INT NOT NULL REFERENCES topics (id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_games_topic_id ON games (topic_id);

-- ---------------------------------------------------------------- attempts
-- One row per finished attempt, quiz or game. Nothing is written until the
-- activity is finished, so an abandoned quiz leaves no record.
CREATE TABLE IF NOT EXISTS attempts (
  id               SERIAL PRIMARY KEY,
  student_id       INT NOT NULL REFERENCES users (id)  ON DELETE CASCADE,
  kind             VARCHAR(10) NOT NULL CHECK (kind IN ('quiz', 'game')),
  quiz_id          INT REFERENCES quizzes (id) ON DELETE SET NULL,
  game_id          INT REFERENCES games (id)   ON DELETE SET NULL,
  topic_id         INT NOT NULL REFERENCES topics (id) ON DELETE RESTRICT,
  score            INT NOT NULL CHECK (score >= 0),
  max_score        INT NOT NULL CHECK (max_score > 0),
  answers          JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A quiz attempt points at a quiz, a game attempt at a game. Never both,
  -- never neither.
  CONSTRAINT attempt_target CHECK (
    (kind = 'quiz' AND quiz_id IS NOT NULL AND game_id IS NULL) OR
    (kind = 'game' AND game_id IS NOT NULL AND quiz_id IS NULL)
  ),
  CONSTRAINT attempt_score_within_max CHECK (score <= max_score)
);
CREATE INDEX IF NOT EXISTS idx_attempts_student_id ON attempts (student_id);
CREATE INDEX IF NOT EXISTS idx_attempts_topic_id   ON attempts (topic_id);
CREATE INDEX IF NOT EXISTS idx_attempts_created_at ON attempts (created_at);

-- ---------------------------------------------------------------- progress
-- One row per student per topic. percent_done follows topics learnt, never
-- time spent in the app (HLD D-04, test C4).
CREATE TABLE IF NOT EXISTS progress (
  id                    SERIAL PRIMARY KEY,
  student_id            INT NOT NULL REFERENCES users (id)  ON DELETE CASCADE,
  topic_id              INT NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
  activities_completed  INT NOT NULL DEFAULT 0,
  average_score         INT NOT NULL DEFAULT 0,
  level                 INT NOT NULL DEFAULT 1,
  points                INT NOT NULL DEFAULT 0,
  percent_done          INT NOT NULL DEFAULT 0
                        CHECK (percent_done BETWEEN 0 AND 100),
  last_activity         TIMESTAMPTZ,
  UNIQUE (student_id, topic_id)
);
CREATE INDEX IF NOT EXISTS idx_progress_student_id ON progress (student_id);

-- ---------------------------------------------------------------- badges
-- The unique constraint is the whole point: however many times the rule engine
-- runs, a badge can be awarded once (HLD test C1).
CREATE TABLE IF NOT EXISTS badges (
  id          SERIAL PRIMARY KEY,
  student_id  INT NOT NULL REFERENCES users (id)  ON DELETE CASCADE,
  topic_id    INT REFERENCES topics (id) ON DELETE CASCADE,
  badge_name  VARCHAR(100) NOT NULL,
  earned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, topic_id, badge_name)
);
CREATE INDEX IF NOT EXISTS idx_badges_student_id ON badges (student_id);

COMMIT;
