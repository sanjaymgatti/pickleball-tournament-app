const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { getOwnedCategory } = require('./categories');
const { getOwnedPlayer } = require('./players');

const router = express.Router();
router.use(requireAuth);

async function getOwnedTeam(teamId, organizerId) {
  const result = await db.query(
    `SELECT tm.* FROM teams tm
     JOIN categories c ON c.id = tm.category_id
     JOIN tournaments t ON t.id = c.tournament_id
     WHERE tm.id = $1 AND t.organizer_id = $2`,
    [teamId, organizerId]
  );
  return result.rows[0] || null;
}

// GET /api/categories/:cid/teams
router.get('/categories/:cid/teams', asyncHandler(async (req, res) => {
  const category = await getOwnedCategory(req.params.cid, req.user.id);
  if (!category) return res.status(404).json({ error: 'Category not found' });
  const result = await db.query(
    'SELECT * FROM teams WHERE category_id = $1 ORDER BY created_at ASC',
    [category.id]
  );
  res.json({ teams: result.rows });
}));

// POST /api/categories/:cid/teams { player1_id, player2_id, name? }
router.post('/categories/:cid/teams', asyncHandler(async (req, res) => {
  const category = await getOwnedCategory(req.params.cid, req.user.id);
  if (!category) return res.status(404).json({ error: 'Category not found' });
  if (category.type !== 'doubles') {
    return res.status(400).json({ error: 'Fixed teams only apply to "doubles" categories' });
  }

  const { player1_id, player2_id, name } = req.body || {};
  const p1 = await getOwnedPlayer(player1_id, req.user.id);
  const p2 = await getOwnedPlayer(player2_id, req.user.id);
  if (!p1 || !p2 || p1.category_id !== category.id || p2.category_id !== category.id) {
    return res.status(400).json({ error: 'Both players must exist in this category' });
  }
  if (p1.id === p2.id) {
    return res.status(400).json({ error: 'A team needs two different players' });
  }

  const teamName = (name && name.trim()) ? name.trim() : `${p1.name} & ${p2.name}`;
  const result = await db.query(
    'INSERT INTO teams (category_id, name, player1_id, player2_id) VALUES ($1, $2, $3, $4) RETURNING *',
    [category.id, teamName, p1.id, p2.id]
  );
  res.status(201).json({ team: result.rows[0] });
}));

// DELETE /api/teams/:id
router.delete('/teams/:id', asyncHandler(async (req, res) => {
  const team = await getOwnedTeam(req.params.id, req.user.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  await db.query('DELETE FROM teams WHERE id = $1', [team.id]);
  res.json({ ok: true });
}));

module.exports = { router, getOwnedTeam };
