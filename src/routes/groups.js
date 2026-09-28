const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { getOwnedCategory } = require('./categories');

const router = express.Router();
router.use(requireAuth);

async function getOwnedGroup(groupId, organizerId) {
  const result = await db.query(
    `SELECT g.* FROM groups g
     JOIN categories c ON c.id = g.category_id
     JOIN tournaments t ON t.id = c.tournament_id
     WHERE g.id = $1 AND t.organizer_id = $2`,
    [groupId, organizerId]
  );
  return result.rows[0] || null;
}

// GET /api/categories/:cid/groups
router.get('/categories/:cid/groups', asyncHandler(async (req, res) => {
  const category = await getOwnedCategory(req.params.cid, req.user.id);
  if (!category) return res.status(404).json({ error: 'Category not found' });
  const result = await db.query(
    'SELECT * FROM groups WHERE category_id = $1 ORDER BY position ASC, id ASC',
    [category.id]
  );
  res.json({ groups: result.rows });
}));

// POST /api/categories/:cid/groups { count }
// Bulk-creates `count` new groups, named sequentially after whatever
// groups already exist (e.g. if "Group 1" and "Group 2" already exist,
// asking for 2 more creates "Group 3" and "Group 4").
router.post('/categories/:cid/groups', asyncHandler(async (req, res) => {
  const category = await getOwnedCategory(req.params.cid, req.user.id);
  if (!category) return res.status(404).json({ error: 'Category not found' });
  if (!['singles_group', 'doubles_group'].includes(category.type)) {
    return res.status(400).json({ error: 'Groups only apply to "singles_group" or "doubles_group" categories' });
  }

  const count = parseInt(req.body && req.body.count, 10);
  if (!count || count < 1 || count > 32) {
    return res.status(400).json({ error: 'count must be a number between 1 and 32' });
  }

  const existing = await db.query(
    'SELECT COALESCE(MAX(position), 0) AS max_position FROM groups WHERE category_id = $1',
    [category.id]
  );
  const startPosition = existing.rows[0].max_position;

  const groups = await db.withTransaction(async (client) => {
    const inserted = [];
    for (let i = 1; i <= count; i++) {
      const position = startPosition + i;
      const result = await client.query(
        'INSERT INTO groups (category_id, name, position) VALUES ($1, $2, $3) RETURNING *',
        [category.id, `Group ${position}`, position]
      );
      inserted.push(result.rows[0]);
    }
    return inserted;
  });

  res.status(201).json({ groups });
}));

// PUT /api/groups/:id { name }
router.put('/groups/:id', asyncHandler(async (req, res) => {
  const group = await getOwnedGroup(req.params.id, req.user.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Group name is required' });

  const result = await db.query('UPDATE groups SET name = $1 WHERE id = $2 RETURNING *', [name.trim(), group.id]);
  res.json({ group: result.rows[0] });
}));

// DELETE /api/groups/:id - players/teams in it become unassigned, not deleted.
router.delete('/groups/:id', asyncHandler(async (req, res) => {
  const group = await getOwnedGroup(req.params.id, req.user.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  await db.query('DELETE FROM groups WHERE id = $1', [group.id]);
  res.json({ ok: true });
}));

module.exports = { router, getOwnedGroup };
