-- Game kinds are checked by the registry in src/games, not by the database.
--
-- A CHECK constraint listing every kind meant a migration for each new game.
-- The importer refuses a kind the registry does not know, and the server
-- refuses to deliver one, so the list lives in one place: the code that can
-- actually run the game. The database only keeps the name well-formed.
BEGIN;

ALTER TABLE games DROP CONSTRAINT IF EXISTS games_kind_check;
ALTER TABLE games DROP CONSTRAINT IF EXISTS games_kind_format;
ALTER TABLE games ADD CONSTRAINT games_kind_format CHECK (kind ~ '^[a-z_]{2,30}$');

COMMIT;
