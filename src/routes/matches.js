const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { getOwnedCategory } = require('./categories');
const {
  roundRobin,
  generateMixNMatch,
  calculateLeaderboard,
  calculateLeaderboardWithIds,
  buildKnockoutSeeds,
  buildFirstKnockoutRound
} = require('../utils/scheduler');

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
// Clears any existing matches for the category and generates a fresh
// group-stage schedule. For "singles_group"/"doubles_group" this builds
// one independent round robin per group (all inserted with stage
// 'group'); any existing knockout bracket is cleared too, since it was
// seeded from group results that are about to be reset.
router.post('/categories/:cid/generate-draws', asyncHandler(async (req, res) => {
  const category = await getOwnedCategory(req.params.cid, req.user.id);
  if (!category) return res.status(404).json({ error: 'Category not found' });

  let groupedSchedules; // [{ groupId, schedule }]
  let flatSchedule;     // used for the non-group types (schedule with no group_id)

  try {
    if (category.type === 'singles') {
      const { rows: players } = await db.query('SELECT id, name FROM players WHERE category_id = $1', [category.id]);
      if (players.length < 2) return res.status(400).json({ error: 'Add at least 2 players first' });
      const items = players.map(p => ({ id: p.id, label: p.name }));
      flatSchedule = roundRobin(items);
    } else if (category.type === 'doubles') {
      const { rows: teams } = await db.query('SELECT id, name FROM teams WHERE category_id = $1', [category.id]);
      if (teams.length < 2) return res.status(400).json({ error: 'Create at least 2 fixed teams first' });
      const items = teams.map(t => ({ id: t.id, label: t.name }));
      flatSchedule = roundRobin(items);
    } else if (category.type === 'mixnmatch') {
      const { rows: players } = await db.query('SELECT id, name FROM players WHERE category_id = $1', [category.id]);
      if (players.length < 4 || players.length % 2 !== 0) {
        return res.status(400).json({ error: 'MixNMatch requires an even number of players (at least 4)' });
      }
      const items = players.map(p => ({ id: p.id, label: p.name }));
      const rounds = req.body && req.body.rounds ? parseInt(req.body.rounds, 10) : undefined;
      flatSchedule = generateMixNMatch(items, rounds);
    } else if (category.type === 'singles_group' || category.type === 'doubles_group') {
      const { rows: groups } = await db.query(
        'SELECT * FROM groups WHERE category_id = $1 ORDER BY position ASC, id ASC',
        [category.id]
      );
      if (groups.length < 1) {
        return res.status(400).json({ error: 'Create at least 1 group first' });
      }

      const memberTable = category.type === 'singles_group' ? 'players' : 'teams';
      const { rows: allMembers } = await db.query(
        `SELECT id, name, group_id FROM ${memberTable} WHERE category_id = $1`,
        [category.id]
      );

      const unassigned = allMembers.filter(m => !m.group_id);
      if (unassigned.length > 0) {
        const noun = category.type === 'singles_group' ? 'player(s)' : 'team(s)';
        return res.status(400).json({
          error: `${unassigned.length} ${noun} not yet assigned to a group: ${unassigned.map(m => m.name).join(', ')}`
        });
      }

      groupedSchedules = [];
      for (const group of groups) {
        const members = allMembers.filter(m => m.group_id === group.id);
        if (members.length < 2) {
          const noun = category.type === 'singles_group' ? 'players' : 'teams';
          return res.status(400).json({ error: `"${group.name}" needs at least 2 ${noun} (has ${members.length})` });
        }
        const items = members.map(m => ({ id: m.id, label: m.name }));
        groupedSchedules.push({ groupId: group.id, schedule: roundRobin(items) });
      }
    } else {
      return res.status(400).json({ error: 'Unknown category type' });
    }
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const insertMatch = (client, { round, side1, side2, groupId }) => {
    const label1 = side1.map(p => p.label).join(' & ');
    const label2 = side2.map(p => p.label).join(' & ');
    return client.query(
      `INSERT INTO matches (category_id, round, stage, group_id, side1_json, side2_json, side1_label, side2_label)
       VALUES ($1, $2, 'group', $3, $4, $5, $6, $7) RETURNING *`,
      [category.id, round, groupId || null, JSON.stringify(side1), JSON.stringify(side2), label1, label2]
    );
  };

  const matches = await db.withTransaction(async (client) => {
    // Regenerating draws resets everything for this category, including
    // any knockout bracket that was seeded from the group results.
    await client.query('DELETE FROM matches WHERE category_id = $1', [category.id]);

    const inserted = [];
    if (groupedSchedules) {
      for (const { groupId, schedule } of groupedSchedules) {
        for (const m of schedule) {
          const result = await insertMatch(client, { round: m.round, side1: m.side1, side2: m.side2, groupId });
          inserted.push(result.rows[0]);
        }
      }
    } else {
      for (const m of flatSchedule) {
        const result = await insertMatch(client, { round: m.round, side1: m.side1, side2: m.side2 });
        inserted.push(result.rows[0]);
      }
    }
    return inserted;
  });

  res.status(201).json({ matches });
}));

// GET /api/categories/:cid/matches?stage=group|knockout&group_id=N
router.get('/categories/:cid/matches', asyncHandler(async (req, res) => {
  const category = await getOwnedCategory(req.params.cid, req.user.id);
  if (!category) return res.status(404).json({ error: 'Category not found' });

  const conditions = ['category_id = $1'];
  const params = [category.id];

  if (req.query.stage === 'group' || req.query.stage === 'knockout') {
    params.push(req.query.stage);
    conditions.push(`stage = $${params.length}`);
  }
  if (req.query.group_id) {
    params.push(req.query.group_id);
    conditions.push(`group_id = $${params.length}`);
  }

  const result = await db.query(
    `SELECT * FROM matches WHERE ${conditions.join(' AND ')} ORDER BY round ASC, id ASC`,
    params
  );
  res.json({ matches: result.rows });
}));

// POST /api/categories/:cid/generate-knockout  { qualifiersPerGroup }
// Reads each group's current standings, takes the top N from each, seeds
// them into a cross-group bracket (see buildKnockoutSeeds in
// scheduler.js for exactly how), and creates the first knockout round.
// Only clears any *existing* knockout matches - group-stage matches and
// their scores are left untouched, so this can be re-run safely if
// group scores change before the bracket is finalized.
router.post('/categories/:cid/generate-knockout', asyncHandler(async (req, res) => {
  const category = await getOwnedCategory(req.params.cid, req.user.id);
  if (!category) return res.status(404).json({ error: 'Category not found' });
  if (!['singles_group', 'doubles_group'].includes(category.type)) {
    return res.status(400).json({ error: 'Knockout brackets only apply to "singles_group"/"doubles_group" categories' });
  }

  const qualifiersPerGroup = parseInt(req.body && req.body.qualifiersPerGroup, 10);
  if (!qualifiersPerGroup || qualifiersPerGroup < 1) {
    return res.status(400).json({ error: 'qualifiersPerGroup must be a number of 1 or more' });
  }

  const { rows: groups } = await db.query(
    'SELECT * FROM groups WHERE category_id = $1 ORDER BY position ASC, id ASC',
    [category.id]
  );
  if (groups.length < 1) return res.status(400).json({ error: 'Create at least 1 group first' });

  const groupQualifiers = [];
  for (const group of groups) {
    const memberTable = category.type === 'singles_group' ? 'players' : 'teams';
    const { rows: members } = await db.query(
      `SELECT id FROM ${memberTable} WHERE group_id = $1`,
      [group.id]
    );
    if (members.length < qualifiersPerGroup) {
      return res.status(400).json({
        error: `"${group.name}" only has ${members.length} member(s), fewer than the ${qualifiersPerGroup} qualifiers requested`
      });
    }

    const { rows: groupMatches } = await db.query(
      `SELECT * FROM matches WHERE category_id = $1 AND group_id = $2 AND stage = 'group'`,
      [category.id, group.id]
    );
    const standings = calculateLeaderboardWithIds(forLeaderboard(groupMatches));
    if (standings.length < qualifiersPerGroup) {
      return res.status(400).json({
        error: `"${group.name}" only has ${standings.length} player(s)/team(s) with a recorded score, fewer than the ${qualifiersPerGroup} qualifiers requested. Enter more group-stage scores first.`
      });
    }

    groupQualifiers.push(
      standings.slice(0, qualifiersPerGroup).map(s => ({ id: s.id, label: s.name }))
    );
  }

  let seeds, built;
  try {
    seeds = buildKnockoutSeeds(groupQualifiers);
    built = buildFirstKnockoutRound(seeds);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const matches = await db.withTransaction(async (client) => {
    await client.query(`DELETE FROM matches WHERE category_id = $1 AND stage = 'knockout'`, [category.id]);

    const inserted = [];
    for (const m of built.matches) {
      const label1 = m.side1[0].label;
      const side2 = m.isBye ? [{ id: null, label: 'BYE' }] : m.side2;
      const label2 = m.isBye ? 'BYE' : m.side2[0].label;
      // A bye is recorded as an already-decided walkover so the same
      // "read the winner off score1/score2" logic used to advance real
      // matches also works for byes with no special-casing needed.
      const score1 = m.isBye ? 1 : null;
      const score2 = m.isBye ? 0 : null;

      const result = await client.query(
        `INSERT INTO matches (category_id, round, stage, group_id, is_bye, side1_json, side2_json, side1_label, side2_label, score1, score2)
         VALUES ($1, 1, 'knockout', NULL, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [category.id, m.isBye, JSON.stringify(m.side1), JSON.stringify(side2), label1, label2, score1, score2]
      );
      inserted.push(result.rows[0]);
    }
    return inserted;
  });

  res.status(201).json({ matches, bracketSize: built.bracketSize });
}));

// POST /api/categories/:cid/generate-next-knockout-round
// Reads the current final knockout round, requires every match in it to
// have a (non-tied) score, and creates the next round by pairing up
// consecutive winners - including byes, whose winner was already
// decided when the bracket was generated.
router.post('/categories/:cid/generate-next-knockout-round', asyncHandler(async (req, res) => {
  const category = await getOwnedCategory(req.params.cid, req.user.id);
  if (!category) return res.status(404).json({ error: 'Category not found' });
  if (!['singles_group', 'doubles_group'].includes(category.type)) {
    return res.status(400).json({ error: 'Knockout brackets only apply to "singles_group"/"doubles_group" categories' });
  }

  const { rows: knockoutMatches } = await db.query(
    `SELECT * FROM matches WHERE category_id = $1 AND stage = 'knockout' ORDER BY round DESC, id ASC`,
    [category.id]
  );
  if (knockoutMatches.length === 0) {
    return res.status(400).json({ error: 'Generate the knockout bracket first' });
  }

  const currentRound = knockoutMatches[0].round;
  const currentMatches = knockoutMatches
    .filter(m => m.round === currentRound)
    .sort((a, b) => a.id - b.id);

  if (currentMatches.length === 1) {
    return res.status(400).json({ error: 'This is already the final - there is no next round' });
  }

  const unscored = currentMatches.filter(m => m.score1 === null || m.score2 === null);
  if (unscored.length > 0) {
    return res.status(400).json({ error: 'Enter a score for every match in the current round first' });
  }
  const tied = currentMatches.find(m => m.score1 === m.score2);
  if (tied) {
    return res.status(400).json({ error: `"${tied.side1_label}" vs "${tied.side2_label}" is tied - a knockout match needs a winner` });
  }

  const winners = currentMatches.map(m => {
    const side1 = Array.isArray(m.side1_json) ? m.side1_json : JSON.parse(m.side1_json);
    const side2 = Array.isArray(m.side2_json) ? m.side2_json : JSON.parse(m.side2_json);
    return m.score1 > m.score2 ? side1[0] : side2[0];
  });

  const nextRound = currentRound + 1;
  const matches = await db.withTransaction(async (client) => {
    const inserted = [];
    for (let i = 0; i < winners.length; i += 2) {
      const side1 = [winners[i]];
      const side2 = [winners[i + 1]];
      const result = await client.query(
        `INSERT INTO matches (category_id, round, stage, group_id, is_bye, side1_json, side2_json, side1_label, side2_label)
         VALUES ($1, $2, 'knockout', NULL, false, $3, $4, $5, $6) RETURNING *`,
        [category.id, nextRound, JSON.stringify(side1), JSON.stringify(side2), side1[0].label, side2[0].label]
      );
      inserted.push(result.rows[0]);
    }
    return inserted;
  });

  res.status(201).json({ matches });
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

// GET /api/categories/:cid/leaderboard?group_id=N
// Without group_id: leaderboard across all of the category's matches
// (used by singles/doubles/mixnmatch). With group_id: standings within
// just that group's group-stage matches (used by singles_group/doubles_group).
router.get('/categories/:cid/leaderboard', asyncHandler(async (req, res) => {
  const category = await getOwnedCategory(req.params.cid, req.user.id);
  if (!category) return res.status(404).json({ error: 'Category not found' });

  const conditions = ['category_id = $1'];
  const params = [category.id];
  if (req.query.group_id) {
    params.push(req.query.group_id);
    conditions.push(`group_id = $${params.length}`);
    conditions.push(`stage = 'group'`);
  }

  const result = await db.query(`SELECT * FROM matches WHERE ${conditions.join(' AND ')}`, params);
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
