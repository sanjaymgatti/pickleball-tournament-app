-- =============================================================
-- Pickleball Tournament Manager — Supabase schema
--
-- Run this once in your Supabase project's SQL editor
-- (Dashboard → SQL Editor → New query → paste this whole file → Run).
--
-- This app manages its own authentication (bcrypt + JWT cookies in
-- Express) and connects to this database directly via a Postgres
-- connection string, not through Supabase's PostgREST/Auth layer.
-- Row Level Security is therefore intentionally left off (it's off
-- by default on new tables) — access control happens in the Express
-- app, not in Postgres policies.
-- =============================================================

-- ---------------------------------------------------------------
-- Organizers (registered users of the app)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- Tournaments (each belongs to one organizer)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tournaments (
  id            SERIAL PRIMARY KEY,
  organizer_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  start_date    DATE,
  end_date      DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- Categories (Singles / Doubles / MixNMatch, within a tournament)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id             SERIAL PRIMARY KEY,
  tournament_id  INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('singles', 'doubles', 'mixnmatch', 'singles_group', 'doubles_group')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- Groups (only used by "singles_group" / "doubles_group" categories).
-- Organizers create a fixed number of groups (e.g. Group 1, Group 2)
-- and manually assign players/teams into them.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS groups (
  id           SERIAL PRIMARY KEY,
  category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  position     INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- Players (individuals registered within a category)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS players (
  id           SERIAL PRIMARY KEY,
  category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  group_id     INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- Teams (fixed doubles pairings — only used by "doubles" categories)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teams (
  id           SERIAL PRIMARY KEY,
  category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  player1_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  player2_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  group_id     INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- Matches (generated draws + recorded scores)
-- side1_json / side2_json store the participant(s) on each side as
-- JSON, e.g. [{"id":3,"label":"Amit"}] for singles/doubles, or
-- [{"id":3,"label":"Amit"},{"id":5,"label":"Bala"}] for MixNMatch.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matches (
  id           SERIAL PRIMARY KEY,
  category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  round        INTEGER NOT NULL DEFAULT 1,
  stage        TEXT NOT NULL DEFAULT 'group' CHECK (stage IN ('group', 'knockout')),
  group_id     INTEGER REFERENCES groups(id) ON DELETE CASCADE,
  is_bye       BOOLEAN NOT NULL DEFAULT false,
  side1_json   JSONB NOT NULL,
  side2_json   JSONB NOT NULL,
  side1_label  TEXT NOT NULL,
  side2_label  TEXT NOT NULL,
  score1       INTEGER,
  score2       INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- Indexes to keep lookups fast as data grows
-- ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tournaments_organizer ON tournaments(organizer_id);
CREATE INDEX IF NOT EXISTS idx_categories_tournament  ON categories(tournament_id);
CREATE INDEX IF NOT EXISTS idx_groups_category        ON groups(category_id);
CREATE INDEX IF NOT EXISTS idx_players_category       ON players(category_id);
CREATE INDEX IF NOT EXISTS idx_players_group          ON players(group_id);
CREATE INDEX IF NOT EXISTS idx_teams_category         ON teams(category_id);
CREATE INDEX IF NOT EXISTS idx_teams_group            ON teams(group_id);
CREATE INDEX IF NOT EXISTS idx_matches_category       ON matches(category_id);
CREATE INDEX IF NOT EXISTS idx_matches_group          ON matches(group_id);

-- Done. You should now see users, tournaments, categories, groups,
-- players, teams, and matches under Table Editor in your Supabase
-- dashboard.
