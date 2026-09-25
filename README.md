# Pickleball Tournament Manager

A multi-tournament successor to [pickleball-scoretracker](https://github.com/sanjaymgatti/pickleball-scoretracker).
Where the original ran entirely in one browser tab with no persistence, this
version is a real multi-user web app: organizers register, create
tournaments, add categories (Singles / Doubles / MixNMatch), add players,
generate draws, and record scores — all stored in a database.

## What's the same, what's different

**Scoring math is untouched.** `src/utils/scheduler.js` has a direct port of
the original `calculateLeaderboard()` function: wins, losses, points-for,
points-against, and diff, sorted by wins then diff. Singles and Doubles
attribute each match to one participant per side; MixNMatch attributes it to
each of the two individual players on each side — exactly like before.

**MixNMatch's schedule generator is improved.** The original app generated a
match for *every* combination of 4 players once you went past 4 players
(10 players → 630 matches — not really usable for a real Friday session).
For exactly 4 players you'll get the identical 3 matches as before. For more
than 4, the app now uses a practical rotation: each round splits players
into courts of 4 (sitting out whoever has sat out least so far) and picks
whichever partner pairing has been used least. You can control how many
rounds to generate from the category page.

## Stack

- **Backend:** Node.js + Express
- **Database:** Postgres, hosted for free on [Supabase](https://supabase.com)
  (accessed via `pg`, the standard Postgres client for Node — no Supabase
  SDK or their Auth/RLS system involved, since this app manages its own
  login)
- **Auth:** email/password with bcrypt, sessions via an HTTP-only JWT cookie
- **Frontend:** plain HTML/CSS/JS (no build step), kept in the same dark
  court theme as the original app
- **Hosting:** deployable as either a traditional Node process (Render, a
  VPS, local) or as a Vercel serverless function — same Express app
  either way, see "Deploying" below

## One-time setup: create the Supabase project and tables

1. Go to [supabase.com](https://supabase.com), sign up (GitHub login is
   fine), and click **New project**. Pick any name/region and set a
   database password — save that password, you'll need it in a minute.
2. Once the project finishes provisioning, open **SQL Editor** in the left
   sidebar, click **New query**, paste in the entire contents of
   [`supabase/schema.sql`](./supabase/schema.sql) from this repo, and click
   **Run**. This creates all six tables (`users`, `tournaments`,
   `categories`, `players`, `teams`, `matches`) plus their indexes.
3. Confirm it worked: open **Table Editor** in the sidebar — you should see
   all six tables listed.
4. Get your connection string: **Project Settings → Database →
   Connection string**, choose the **URI** tab, and copy it. It looks like:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxxxxxxx.supabase.co:5432/postgres
   ```
   Replace `[YOUR-PASSWORD]` with the database password from step 1.

That's the entire database setup — no migrations to run, no ORM to
configure.

## Running it locally

```bash
cd pickleball-app
npm install
cp .env.example .env
# then edit .env:
#   - set DATABASE_URL to the connection string from step 4 above
#   - set JWT_SECRET to any long random string
npm start
```

Open http://localhost:3000 — register an organizer account and you're in.
On startup the server does a quick `SELECT 1` against Supabase and will
exit with a clear error if `DATABASE_URL` is wrong, rather than failing
mysteriously on the first request.

## Data model

The full, authoritative definition is [`supabase/schema.sql`](./supabase/schema.sql).
Summary:

```
users            organizer accounts
tournaments      belongs to a user
categories       belongs to a tournament; type = singles | doubles | mixnmatch
players          belongs to a category
teams            belongs to a category (doubles only) — pairs two players into a fixed team
matches          belongs to a category; stores each side's participants
                 (as jsonb), labels, and scores
```

## API overview

All routes below (except `/api/auth/register` and `/api/auth/login`) require
being logged in (the browser handles this automatically via the cookie).

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Create an organizer account |
| POST | `/api/auth/login` | Log in |
| POST | `/api/auth/logout` | Log out |
| GET | `/api/auth/me` | Current user |
| GET/POST | `/api/tournaments` | List / create tournaments |
| GET/PUT/DELETE | `/api/tournaments/:id` | One tournament |
| GET/POST | `/api/tournaments/:tid/categories` | List / create categories |
| GET/DELETE | `/api/categories/:id` | One category |
| GET/POST | `/api/categories/:cid/players` | List / add players |
| DELETE | `/api/players/:id` | Remove a player |
| GET/POST | `/api/categories/:cid/teams` | List / create fixed doubles teams |
| DELETE | `/api/teams/:id` | Remove a team |
| POST | `/api/categories/:cid/generate-draws` | Generate the match schedule |
| GET | `/api/categories/:cid/matches` | List matches |
| PUT | `/api/matches/:id` | Record a score |
| GET | `/api/categories/:cid/leaderboard` | Standings |
| POST | `/api/categories/:cid/reset` | Clear matches (keeps players/teams) |

## Deploying so it's actually usable by your group — for free

**Important:** unlike the original single-file `pickleball-scoretracker`,
this app needs a host that runs Node.js — GitHub Pages (static files only)
cannot run it. The good news: now that your data lives in Supabase rather
than on local disk, it doesn't matter that free compute tiers wipe their
filesystem or spin down when idle — your tournaments, players, and scores
are safe in Postgres regardless of what happens to the web server
container.

Two files make this work on either a traditional server or a serverless
platform without duplicating any logic:
- `src/app.js` — the actual Express app (routes, static files, error
  handling). This is the one place request-handling logic lives.
- `server.js` — the entrypoint for a traditional long-running process
  (local dev, Render, a VPS): loads `src/app.js` and calls `app.listen()`.
- `api/index.js` — the entrypoint for Vercel: loads the exact same
  `src/app.js` and exports it directly, since Vercel invokes it the same
  way it would invoke any `(req, res) => {}` handler.

Do the one-time Supabase setup in the section above first either way
(create the project, run `supabase/schema.sql`, grab a connection string).

### Option 1 — Render

1. **Push this folder to a new GitHub repo:**
   ```bash
   cd pickleball-app
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/pickleball-tournament-app.git
   git push -u origin main
   ```
   Your `.gitignore` already excludes `node_modules/` and `.env`, so your
   database password never gets committed.

2. **Create a Render account** at render.com and connect your GitHub
   account.

3. **New → Web Service**, select the repo you just pushed.

4. **Configure the service:**
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: **Free** — fine now, no persistent disk needed.

5. **Add environment variables** (Render dashboard → your service →
   "Environment"):
   - `DATABASE_URL` → your Supabase **direct connection** string (port 5432)
   - `JWT_SECRET` → a long random string (e.g. `openssl rand -hex 32`)
   - `PORT` — Render sets this automatically; don't add it yourself.

6. **Deploy.** Render builds and starts the service, then gives you a URL
   like `https://pickleball-tournament-app.onrender.com`. Watch the deploy
   logs for "Connected to Supabase Postgres." to confirm the connection
   string is correct.

7. **Switch on secure cookies** now that you're on HTTPS: in
   `src/routes/auth.js`, uncomment `secure: true` in `COOKIE_OPTS`, commit,
   and push — Render auto-redeploys on every push to `main`.

8. Open the Render URL, register your organizer account, and you're live
   at $0/month. The only tradeoff of the Free instance type: it spins down
   after 15 minutes of no traffic and takes 30–60 seconds to wake back up
   on the next request — fine for a Wednesday/Friday group.

### Option 2 — Vercel

1. **Push this folder to a new GitHub repo** (same as step 1 above, skip
   if you already did it).

2. **Get the Transaction pooler connection string from Supabase** —
   different from the one you'd use for Render. In your Supabase project:
   **Project Settings → Database → Connection Pooling**, mode
   **Transaction**, copy the URI (port **6543**, not 5432). Vercel can run
   many function instances at once, and the pooler is built to handle lots
   of short-lived connections without exhausting Supabase's connection
   limit — `src/db.js` is already tuned to use a smaller connection pool
   automatically when it detects it's running on Vercel.

3. **Create a Vercel account** at vercel.com and connect your GitHub
   account.

4. **Add New → Project**, import the repo. Vercel will detect
   `vercel.json` and the `api/` folder automatically — you shouldn't need
   to change any build/output settings (framework preset can stay
   "Other").

5. **Add environment variables** (in the import screen, or later under
   Project Settings → Environment Variables):
   - `DATABASE_URL` → the **pooler** connection string from step 2
   - `JWT_SECRET` → a long random string

6. **Deploy.** Vercel gives you a URL like
   `https://pickleball-tournament-app.vercel.app`.

7. **Switch on secure cookies**: same as the Render step — uncomment
   `secure: true` in `COOKIE_OPTS` in `src/routes/auth.js`, commit, push.
   Vercel auto-redeploys on every push to `main`.

8. Open the Vercel URL and register your organizer account. Vercel's free
   tier has no forced idle spin-down the way Render's does, so cold starts
   are rarer, but the very first request after a period of inactivity can
   still take a moment while a function instance spins up.

**Testing the Vercel setup locally before you deploy:** install the Vercel
CLI (`npm i -g vercel`) and run `vercel dev` from the project root instead
of `npm start`. It reads the same `vercel.json` and `api/` folder your
production deployment will use, so you can catch routing issues before
pushing.

### Running it on your own hardware instead

If you'd rather run it on a home server or Raspberry Pi, `npm start`
behind a reverse proxy (Caddy or nginx) with a domain and a free Let's
Encrypt TLS cert works well — same Supabase connection string, no cold
starts.

## Suggested next steps (not built yet, flagging so it's a deliberate choice)

- Player-facing read-only view (share a link to a category's live
  leaderboard without requiring login)
- CSV/PDF export of results per tournament
- Multiple organizers collaborating on the same tournament
- Court/time-slot scheduling on top of the match list
