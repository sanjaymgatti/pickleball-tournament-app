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
  type           TEXT NOT NULL CHECK (type IN ('singles', 'doubles', 'mixnmatch')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- Players (individuals registered within a category)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS players (
  id           SERIAL PRIMARY KEY,
  category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_players_category       ON players(category_id);
CREATE INDEX IF NOT EXISTS idx_teams_category         ON teams(category_id);
CREATE INDEX IF NOT EXISTS idx_matches_category       ON matches(category_id);

-- Done. You should now see users, tournaments, categories, players,
-- teams, and matches under Table Editor in your Supabase dashboard.
