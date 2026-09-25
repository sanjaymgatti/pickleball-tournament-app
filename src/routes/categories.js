const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();
router.use(requireAuth);

async function getOwnedTournament(id, organizerId) {
  const result = await db.query(
    'SELECT * FROM tournaments WHERE id = $1 AND organizer_id = $2',
    [id, organizerId]
  );
  return result.rows[0] || null;
}

// Returns the category row only if it belongs to a tournament owned by this organizer.
async function getOwnedCategory(categoryId, organizerId) {
  const result = await db.query(
    `SELECT c.* FROM categories c
     JOIN tournaments t ON t.id = c.tournament_id
     WHERE c.id = $1 AND t.organizer_id = $2`,
    [categoryId, organizerId]
  );
  return result.rows[0] || null;
}

// GET /api/tournaments/:tid/categories
router.get('/tournaments/:tid/categories', asyncHandler(async (req, res) => {
  const tournament = await getOwnedTournament(req.params.tid, req.user.id);
  if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
  const result = await db.query(
    'SELECT * FROM categories WHERE tournament_id = $1 ORDER BY created_at ASC',
    [tournament.id]
  );
  res.json({ categories: result.rows });
}));

// POST /api/tournaments/:tid/categories
router.post('/tournaments/:tid/categories', asyncHandler(async (req, res) => {
  const tournament = await getOwnedTournament(req.params.tid, req.user.id);
  if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

  const { name, type } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Category name is required' });
  if (!['singles', 'doubles', 'mixnmatch'].includes(type)) {
    return res.status(400).json({ error: 'type must be one of: singles, doubles, mixnmatch' });
  }

  const result = await db.query(
    'INSERT INTO categories (tournament_id, name, type) VALUES ($1, $2, $3) RETURNING *',
    [tournament.id, name.trim(), type]
  );
  res.status(201).json({ category: result.rows[0] });
}));

// GET /api/categories/:id
router.get('/categories/:id', asyncHandler(async (req, res) => {
  const category = await getOwnedCategory(req.params.id, req.user.id);
  if (!category) return res.status(404).json({ error: 'Category not found' });
  res.json({ category });
}));

// DELETE /api/categories/:id
router.delete('/categories/:id', asyncHandler(async (req, res) => {
  const category = await getOwnedCategory(req.params.id, req.user.id);
  if (!category) return res.status(404).json({ error: 'Category not found' });
  await db.query('DELETE FROM categories WHERE id = $1', [category.id]);
  res.json({ ok: true });
}));

module.exports = { router, getOwnedCategory };
