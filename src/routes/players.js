const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { getOwnedCategory } = require('./categories');

const router = express.Router();
router.use(requireAuth);

async function getOwnedPlayer(playerId, organizerId) {
  const result = await db.query(
    `SELECT p.* FROM players p
     JOIN categories c ON c.id = p.category_id
     JOIN tournaments t ON t.id = c.tournament_id
     WHERE p.id = $1 AND t.organizer_id = $2`,
    [playerId, organizerId]
  );
  return result.rows[0] || null;
}

// GET /api/categories/:cid/players
router.get('/categories/:cid/players', asyncHandler(async (req, res) => {
  const category = await getOwnedCategory(req.params.cid, req.user.id);
  if (!category) return res.status(404).json({ error: 'Category not found' });
  const result = await db.query(
    'SELECT * FROM players WHERE category_id = $1 ORDER BY created_at ASC',
    [category.id]
  );
  res.json({ players: result.rows });
}));

// POST /api/categories/:cid/players  { name } OR { names: [ ... ] }
router.post('/categories/:cid/players', asyncHandler(async (req, res) => {
  const category = await getOwnedCategory(req.params.cid, req.user.id);
  if (!category) return res.status(404).json({ error: 'Category not found' });

  const { name, names } = req.body || {};
  const list = Array.isArray(names) ? names : (name ? [name] : []);
  const cleaned = list.map(n => (n || '').trim()).filter(Boolean);

  if (cleaned.length === 0) {
    return res.status(400).json({ error: 'Provide "name" or a non-empty "names" array' });
  }

  const players = await db.withTransaction(async (client) => {
    const inserted = [];
    for (const n of cleaned) {
      const result = await client.query(
        'INSERT INTO players (category_id, name) VALUES ($1, $2) RETURNING *',
        [category.id, n]
      );
      inserted.push(result.rows[0]);
    }
    return inserted;
  });

  res.status(201).json({ players });
}));

// DELETE /api/players/:id
router.delete('/players/:id', asyncHandler(async (req, res) => {
  const player = await getOwnedPlayer(req.params.id, req.user.id);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  await db.query('DELETE FROM players WHERE id = $1', [player.id]);
  res.json({ ok: true });
}));

module.exports = { router, getOwnedPlayer };
