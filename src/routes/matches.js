const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { getOwnedCategory } = require('./categories');
const { roundRobin, generateMixNMatch, calculateLeaderboard } = require('../utils/scheduler');

const router = express.Router();
router.use(requireAuth);

async function getOwnedMatch(matchId, organizerId) {
  const result = await db.query(
    `SELECT m.* FROM matches m
     JOIN categories c ON c.id = m.category_id
     JOIN tournaments t ON t.id = c.tournament_id
     WHERE m.id = $1 AND t.organizer_id = $2`,
    [matchId, organizerId]
  );
  return result.rows[0] || null;
}

// calculateLeaderboard() (in scheduler.js) expects side1_json/side2_json as
// JSON *strings* and JSON.parse()s them itself — that logic is a direct,
// untouched port of the original app's math and storage-agnostic. Postgres's
// jsonb columns come back from node-postgres already parsed into objects,
// so we re-stringify here rather than change the shared scoring logic.
function forLeaderboard(rows) {
  return rows.map(r => ({
    ...r,
    side1_json: JSON.stringify(r.side1_json),
    side2_json: JSON.stringify(r.side2_json)
  }));
}

// POST /api/categories/:cid/generate-draws  { rounds? }
// Clears any existing matches for the category and generates a fresh schedule.
router.post('/categories/:cid/generate-draws', asyncHandler(async (req, res) => {
  const category = await getOwnedCategory(req.params.cid, req.user.id);
  if (!category) return res.status(404).json({ error: 'Category not found' });

  let schedule;
  try {
    if (category.type === 'singles') {
      const { rows: players } = await db.query('SELECT id, name FROM players WHERE category_id = $1', [category.id]);
      if (players.length < 2) return res.status(400).json({ error: 'Add at least 2 players first' });
      const items = players.map(p => ({ id: p.id, label: p.name }));
      schedule = roundRobin(items);
    } else if (category.type === 'doubles') {
      const { rows: teams } = await db.query('SELECT id, name FROM teams WHERE category_id = $1', [category.id]);
      if (teams.length < 2) return res.status(400).json({ error: 'Create at least 2 fixed teams first' });
      const items = teams.map(t => ({ id: t.id, label: t.name }));
      schedule = roundRobin(items);
    } else if (category.type === 'mixnmatch') {
      const { rows: players } = await db.query('SELECT id, name FROM players WHERE category_id = $1', [category.id]);
      if (players.length < 4 || players.length % 2 !== 0) {
        return res.status(400).json({ error: 'MixNMatch requires an even number of players (at least 4)' });
      }
      const items = players.map(p => ({ id: p.id, label: p.name }));
      const rounds = req.body && req.body.rounds ? parseInt(req.body.rounds, 10) : undefined;
      schedule = generateMixNMatch(items, rounds);
    } else {
      return res.status(400).json({ error: 'Unknown category type' });
    }
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const matches = await db.withTransaction(async (client) => {
    await client.query('DELETE FROM matches WHERE category_id = $1', [category.id]);

    const inserted = [];
    for (const m of schedule) {
      const label1 = m.side1.map(p => p.label).join(' & ');
      const label2 = m.side2.map(p => p.label).join(' & ');
      const result = await client.query(
        `INSERT INTO matches (category_id, round, side1_json, side2_json, side1_label, side2_label)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [category.id, m.round, JSON.stringify(m.side1), JSON.stringify(m.side2), label1, label2]
      );
      inserted.push(result.rows[0]);
    }
    return inserted;
  });

  res.status(201).json({ matches });
}));

// GET /api/categories/:cid/matches
router.get('/categories/:cid/matches', asyncHandler(async (req, res) => {
  const category = await getOwnedCategory(req.params.cid, req.user.id);
  if (!category) return res.status(404).json({ error: 'Category not found' });
  const result = await db.query(
    'SELECT * FROM matches WHERE category_id = $1 ORDER BY round ASC, id ASC',
    [category.id]
  );
  res.json({ matches: result.rows });
}));

// PUT /api/matches/:id  { score1, score2 } - either field can be sent alone.
   router.put('/matches/:id', asyncHandler(async (req, res) => {
     const match = await getOwnedMatch(req.params.id, req.user.id);
     if (!match) return res.status(404).json({ error: 'Match not found' });

     const body = req.body || {};

     // This is a partial update: the frontend saves each score box the
     // moment you tab out of it, one field at a time, so only touch a
     // field here if the request actually included it. Otherwise scoring
     // one side of a match would wipe out a score already saved on the
     // other side.
     const parseScore = (raw) => (raw === '' || raw === null || raw === undefined ? null : parseInt(raw, 10));
     const s1 = Object.prototype.hasOwnProperty.call(body, 'score1') ? parseScore(body.score1) : match.score1;
     const s2 = Object.prototype.hasOwnProperty.call(body, 'score2') ? parseScore(body.score2) : match.score2;

     if ((s1 !== null && isNaN(s1)) || (s2 !== null && isNaN(s2))) {
       return res.status(400).json({ error: 'Scores must be numbers' });
     }

     const result = await db.query(
       'UPDATE matches SET score1 = $1, score2 = $2 WHERE id = $3 RETURNING *',
       [s1, s2, match.id]
     );
     res.json({ match: result.rows[0] });
   }));

// GET /api/categories/:cid/leaderboard
router.get('/categories/:cid/leaderboard', asyncHandler(async (req, res) => {
  const category = await getOwnedCategory(req.params.cid, req.user.id);
  if (!category) return res.status(404).json({ error: 'Category not found' });
  const result = await db.query('SELECT * FROM matches WHERE category_id = $1', [category.id]);
  const leaderboard = calculateLeaderboard(forLeaderboard(result.rows));
  res.json({ leaderboard });
}));

// POST /api/categories/:cid/reset - clears all matches (keeps players/teams)
router.post('/categories/:cid/reset', asyncHandler(async (req, res) => {
  const category = await getOwnedCategory(req.params.cid, req.user.id);
  if (!category) return res.status(404).json({ error: 'Category not found' });
  await db.query('DELETE FROM matches WHERE category_id = $1', [category.id]);
  res.json({ ok: true });
}));

module.exports = router;
