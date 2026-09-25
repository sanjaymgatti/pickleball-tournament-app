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

router.get('/', asyncHandler(async (req, res) => {
  const result = await db.query(
    'SELECT * FROM tournaments WHERE organizer_id = $1 ORDER BY created_at DESC',
    [req.user.id]
  );
  res.json({ tournaments: result.rows });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { name, description, start_date, end_date } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Tournament name is required' });

  const result = await db.query(
    `INSERT INTO tournaments (organizer_id, name, description, start_date, end_date)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.user.id, name.trim(), description || null, start_date || null, end_date || null]
  );
  res.status(201).json({ tournament: result.rows[0] });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const tournament = await getOwnedTournament(req.params.id, req.user.id);
  if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
  res.json({ tournament });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const tournament = await getOwnedTournament(req.params.id, req.user.id);
  if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

  const { name, description, start_date, end_date } = req.body || {};
  const result = await db.query(
    `UPDATE tournaments SET name = $1, description = $2, start_date = $3, end_date = $4
     WHERE id = $5 RETURNING *`,
    [
      name && name.trim() ? name.trim() : tournament.name,
      description !== undefined ? description : tournament.description,
      start_date !== undefined ? start_date : tournament.start_date,
      end_date !== undefined ? end_date : tournament.end_date,
      tournament.id
    ]
  );
  res.json({ tournament: result.rows[0] });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const tournament = await getOwnedTournament(req.params.id, req.user.id);
  if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
  await db.query('DELETE FROM tournaments WHERE id = $1', [tournament.id]);
  res.json({ ok: true });
}));

module.exports = router;
