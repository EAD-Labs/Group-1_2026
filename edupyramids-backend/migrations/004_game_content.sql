-- Games get their content, and a third kind.
--
-- The 8 September meeting added tile/memory games alongside drag-and-drop and
-- matching. The content is JSONB rather than a table per kind: the three kinds
-- have different shapes (pairs, buckets and items), and nothing queries inside
-- them — the whole game is read, shuffled and marked in one piece.
BEGIN;

ALTER TABLE games DROP CONSTRAINT IF EXISTS games_kind_check;
ALTER TABLE games ADD CONSTRAINT games_kind_check
  CHECK (kind IN ('drag_drop', 'matching', 'memory'));

ALTER TABLE games ADD COLUMN IF NOT EXISTS instructions TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS content JSONB NOT NULL DEFAULT '{}'::jsonb;

-- The importer finds a game again by its title within a topic.
CREATE UNIQUE INDEX IF NOT EXISTS idx_games_topic_title ON games (topic_id, title);

COMMIT;
