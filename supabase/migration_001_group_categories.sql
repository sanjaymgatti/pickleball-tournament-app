-- =============================================================
-- Migration: add Singles Group Based / Doubles Group Based support
--
-- Run this in the SQL Editor of a Supabase project that was already set
-- up with the original schema.sql (i.e. you already have real
-- tournaments/players/matches). It only adds new tables/columns and
-- extends the category "type" check - it does not touch or delete any
-- existing data.
--
-- If you're setting up a brand new Supabase project instead, just run
-- schema.sql - it already includes everything in this file.
-- =============================================================

-- ---------------------------------------------------------------
-- New "groups" table - organizers create N groups per category and
-- manually assign players/teams into them.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS groups (
  id           SERIAL PRIMARY KEY,
  category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  position     INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_groups_category ON groups(category_id);

-- ---------------------------------------------------------------
-- Let players and teams optionally belong to a group. NULL means
-- "not yet assigned to a group" - fine for every existing category
-- type, which never uses groups at all.
-- ---------------------------------------------------------------
ALTER TABLE players ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL;
ALTER TABLE teams   ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_players_group ON players(group_id);
CREATE INDEX IF NOT EXISTS idx_teams_group   ON teams(group_id);

-- ---------------------------------------------------------------
-- Matches need to know which stage they belong to (group play vs.
-- the knockout bracket), which group a group-stage match belongs to,
-- and whether a knockout match is an automatic bye/walkover.
-- Existing matches all default to stage='group' with no group_id,
-- which is exactly correct for your existing Singles/Doubles/MixNMatch
-- categories - they simply don't use groups.
-- ---------------------------------------------------------------
ALTER TABLE matches ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'group' CHECK (stage IN ('group', 'knockout'));
ALTER TABLE matches ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS is_bye BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_matches_group ON matches(group_id);

-- ---------------------------------------------------------------
-- Allow the two new category types. This replaces the CHECK
-- constraint on categories.type - existing rows (singles/doubles/
-- mixnmatch) all still satisfy the new, wider constraint.
-- ---------------------------------------------------------------
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_type_check;
ALTER TABLE categories
  ADD CONSTRAINT categories_type_check
  CHECK (type IN ('singles', 'doubles', 'mixnmatch', 'singles_group', 'doubles_group'));

-- ---------------------------------------------------------------
-- Sanity check / troubleshooting: if creating a "singles_group" or
-- "doubles_group" category still fails after running this migration,
-- your constraint may have a different auto-generated name than the
-- one assumed above. Run this to find its real name:
--
--   SELECT conname FROM pg_constraint
--   WHERE conrelid = 'categories'::regclass AND contype = 'c';
--
-- then re-run the DROP CONSTRAINT line above with that name instead.
-- ---------------------------------------------------------------

-- Done. Table Editor should now show a new "groups" table, and
-- "players"/"teams"/"matches" should each have the new columns.
