/**
 * Scheduling and leaderboard logic.
 *
 * The leaderboard math below is a direct, faithful port of the
 * calculateLeaderboard() function from the original pickleball-scoretracker
 * project (wins / losses / points-for / points-against / diff, sorted by
 * wins desc then diff desc). It has NOT been changed.
 *
 * The MixNMatch *schedule generator* has been improved. The original app
 * generated a match for every possible combination of 4 players out of the
 * whole player pool once you went above 4 players, which explodes
 * combinatorially (10 players -> 630 matches). For exactly 4 players the
 * result is identical to the original (the same 3 partner configurations).
 * For more than 4 players, a practical rotation algorithm is used instead:
 * each round splits players into courts of 4, sitting out the players who
 * have sat out least so far, and picks whichever of the 3 partner pairings
 * for that group of 4 has been used the least so far. This keeps things
 * playable for a real weekly group while still rotating partners fairly.
 */

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Standard circle-method round robin for singles or fixed-doubles-teams.
 * `items` is an array of { id, label }. Returns array of { side1, side2 }
 * where side1/side2 are single-item arrays of { id, label }.
 */
function roundRobin(items) {
  let pool = [...items];
  const hasBye = pool.length % 2 !== 0;
  if (hasBye) pool.push({ id: null, label: '__BYE__' });

  const n = pool.length;
  const rounds = n - 1;
  const half = n / 2;
  const schedule = [];

  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < half; i++) {
      const p1 = pool[i];
      const p2 = pool[n - 1 - i];
      if (p1.label !== '__BYE__' && p2.label !== '__BYE__') {
        schedule.push({
          round: r + 1,
          side1: [p1],
          side2: [p2]
        });
      }
    }
    pool.splice(1, 0, pool.pop());
  }
  return schedule;
}

/**
 * MixNMatch: individual players, doubles teams re-shuffled each match.
 * `players` is an array of { id, label }.
 * `rounds` (optional) - number of rounds to generate when n > 4. Defaults
 * to n (each player plays roughly n matches).
 */
function generateMixNMatch(players, rounds) {
  const n = players.length;
  if (n < 4 || n % 2 !== 0) {
    throw new Error('MixNMatch requires an even number of players (at least 4).');
  }

  // Exact original behavior for exactly 4 players: the 3 fixed configs.
  if (n === 4) {
    const [p1, p2, p3, p4] = players;
    return [
      { round: 1, side1: [p1, p2], side2: [p3, p4] },
      { round: 2, side1: [p1, p3], side2: [p2, p4] },
      { round: 3, side1: [p1, p4], side2: [p2, p3] }
    ];
  }

  // Practical rotation algorithm for more than 4 players.
  const totalRounds = rounds && rounds > 0 ? rounds : n;
  const courtsPerRound = Math.floor(n / 4);
  const byeCount = {};
  players.forEach(p => (byeCount[p.id] = 0));

  const partnerCount = {}; // key: sorted "id-id" -> times partnered
  const pairKey = (a, b) => [a.id, b.id].sort((x, y) => x - y).join('-');

  const schedule = [];

  for (let r = 1; r <= totalRounds; r++) {
    // Decide who sits out this round (fewest byes so far get priority to play).
    const sortedByByes = shuffle(players).sort((a, b) => byeCount[a.id] - byeCount[b.id]);
    const playersUsed = courtsPerRound * 4;
    const sitOutCount = n - playersUsed;

    const sittingOut = sortedByByes.slice(0, sitOutCount);
    const playing = shuffle(sortedByByes.slice(sitOutCount));

    sittingOut.forEach(p => (byeCount[p.id] += 1));

    for (let c = 0; c < courtsPerRound; c++) {
      const group = playing.slice(c * 4, c * 4 + 4);
      if (group.length < 4) continue;
      const [a, b, cPlayer, d] = group;

      const configs = [
        { side1: [a, b], side2: [cPlayer, d] },
        { side1: [a, cPlayer], side2: [b, d] },
        { side1: [a, d], side2: [b, cPlayer] }
      ];

      // Pick the config whose partner pairing has been used least so far.
      let best = configs[0];
      let bestScore = Infinity;
      for (const cfg of configs) {
        const k1 = pairKey(cfg.side1[0], cfg.side1[1]);
        const k2 = pairKey(cfg.side2[0], cfg.side2[1]);
        const score = (partnerCount[k1] || 0) + (partnerCount[k2] || 0);
        if (score < bestScore) {
          bestScore = score;
          best = cfg;
        }
      }

      const k1 = pairKey(best.side1[0], best.side1[1]);
      const k2 = pairKey(best.side2[0], best.side2[1]);
      partnerCount[k1] = (partnerCount[k1] || 0) + 1;
      partnerCount[k2] = (partnerCount[k2] || 0) + 1;

      schedule.push({ round: r, side1: best.side1, side2: best.side2 });
    }
  }

  return schedule;
}

/**
 * Leaderboard calculation - direct port of the original app's
 * calculateLeaderboard(). Attributes points-for/points-against and
 * win/loss to every participant listed on each side of a scored match,
 * then sorts by wins desc, then point-differential desc.
 *
 * `matches` rows must have: side1_json, side2_json, score1, score2
 * (side*_json is a JSON string of [{id, label}, ...]).
 */
function calculateLeaderboard(matches) {
  const stats = {}; // keyed by participant label

  const touch = (label) => {
    if (!stats[label]) {
      stats[label] = { name: label, wins: 0, losses: 0, pf: 0, pa: 0, diff: 0 };
    }
    return stats[label];
  };

  matches.forEach((m) => {
    if (m.score1 === null || m.score1 === undefined) return;
    if (m.score2 === null || m.score2 === undefined) return;

    const s1 = m.score1;
    const s2 = m.score2;
    const side1 = JSON.parse(m.side1_json);
    const side2 = JSON.parse(m.side2_json);

    side1.forEach((p) => {
      const st = touch(p.label);
      st.pf += s1;
      st.pa += s2;
      if (s1 > s2) st.wins += 1;
      else if (s2 > s1) st.losses += 1;
    });

    side2.forEach((p) => {
      const st = touch(p.label);
      st.pf += s2;
      st.pa += s1;
      if (s2 > s1) st.wins += 1;
      else if (s1 > s2) st.losses += 1;
    });
  });

  const list = Object.values(stats);
  list.forEach((p) => (p.diff = p.pf - p.pa));
  list.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    return b.diff - a.diff;
  });
  return list;
}

/**
 * Same math as calculateLeaderboard(), but also keeps each participant's
 * id alongside their label - needed when a group-stage leaderboard has to
 * feed into knockout bracket seeding (calculateLeaderboard() itself is
 * left untouched above since it's a direct port of the original app's
 * function and other code already depends on its exact shape).
 */
function calculateLeaderboardWithIds(matches) {
  const stats = {};

  const touch = (p) => {
    if (!stats[p.label]) {
      stats[p.label] = { id: p.id, name: p.label, wins: 0, losses: 0, pf: 0, pa: 0, diff: 0 };
    }
    return stats[p.label];
  };

  matches.forEach((m) => {
    if (m.score1 === null || m.score1 === undefined) return;
    if (m.score2 === null || m.score2 === undefined) return;

    const s1 = m.score1;
    const s2 = m.score2;
    const side1 = JSON.parse(m.side1_json);
    const side2 = JSON.parse(m.side2_json);

    side1.forEach((p) => {
      const st = touch(p);
      st.pf += s1;
      st.pa += s2;
      if (s1 > s2) st.wins += 1;
      else if (s2 > s1) st.losses += 1;
    });

    side2.forEach((p) => {
      const st = touch(p);
      st.pf += s2;
      st.pa += s1;
      if (s2 > s1) st.wins += 1;
      else if (s1 > s2) st.losses += 1;
    });
  });

  const list = Object.values(stats);
  list.forEach((p) => (p.diff = p.pf - p.pa));
  list.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    return b.diff - a.diff;
  });
  return list;
}

/**
 * Smallest power of 2 that is >= n.
 */
function nextPowerOfTwo(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Standard single-elimination seed ordering for a bracket of `size`
 * (must be a power of 2), e.g. size=4 -> [1,4,2,3], size=8 ->
 * [1,8,4,5,2,7,3,6]. This is the well-known construction that keeps
 * seed 1 and seed 2 apart until the final, seeds 1-4 apart until the
 * semifinal, and so on. Consecutive pairs in the returned array are the
 * first-round matchups: (order[0] vs order[1]), (order[2] vs order[3]),
 * etc.
 */
function standardBracketOrder(size) {
  if (size < 1 || (size & (size - 1)) !== 0) {
    throw new Error('Bracket size must be a power of 2');
  }
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    const next = [];
    order.forEach((seed) => {
      next.push(seed);
      next.push(n + 1 - seed);
    });
    order = next;
  }
  return order;
}

/**
 * Builds the seeded qualifier list for a group-stage knockout bracket.
 *
 * `groupQualifiers` is an array (one entry per group, in group order) of
 * arrays of qualifiers for that group in rank order (group winner
 * first), each qualifier shaped like { id, label }.
 *
 * Seeding order: every group's winner (position 1), in group order,
 * becomes seeds 1..N; every group's runner-up (position 2), in the SAME
 * group order, becomes seeds N+1..2N; and so on for further qualifying
 * positions if more than 2 advance per group.
 *
 * For the common case of 2 groups with the top 2 advancing, this
 * produces exactly: seed1=G1P1, seed2=G2P1, seed3=G1P2, seed4=G2P2 -
 * which the standard bracket pairing (1v4, 2v3) turns into G1P1 vs G2P2
 * and G2P1 vs G1P2, matching how club tournaments normally cross-seed a
 * 2-group draw. It generalizes the same way to more groups.
 */
function buildKnockoutSeeds(groupQualifiers) {
  const maxPositions = Math.max(...groupQualifiers.map(g => g.length));
  const seeds = [];
  for (let pos = 0; pos < maxPositions; pos++) {
    groupQualifiers.forEach((group) => {
      if (group[pos]) seeds.push(group[pos]);
    });
  }
  return seeds; // seeds[0] is seed #1, seeds[1] is seed #2, ...
}

/**
 * Builds the first knockout round from a seeded qualifier list. Handles
 * byes when the qualifier count isn't a power of 2 by giving the
 * strongest seeds the byes (standard tournament convention) - a bye
 * match has `side2: null` and `isBye: true`; the caller should record it
 * as an automatic walkover rather than asking for a score. Every
 * subsequent round is a plain power of 2, so no further bye handling is
 * ever needed once the first round is past.
 */
function buildFirstKnockoutRound(seeds) {
  const q = seeds.length;
  if (q < 2) {
    throw new Error('Need at least 2 qualifying players/teams to build a knockout bracket.');
  }

  const bracketSize = nextPowerOfTwo(q);
  const order = standardBracketOrder(bracketSize); // seed numbers, bracket order

  const matches = [];
  for (let i = 0; i < order.length; i += 2) {
    const seedA = order[i];
    const seedB = order[i + 1];
    const a = seedA <= q ? seeds[seedA - 1] : null; // beyond q = phantom bye slot
    const b = seedB <= q ? seeds[seedB - 1] : null;

    if (!a && !b) {
      // Never expected: byes = bracketSize - q is always < bracketSize / 2.
      throw new Error('Unexpected double bye while building the knockout bracket.');
    }
    if (a && b) {
      matches.push({ side1: [a], side2: [b], isBye: false });
    } else {
      matches.push({ side1: [a || b], side2: null, isBye: true });
    }
  }
  return { matches, bracketSize };
}

module.exports = {
  roundRobin,
  generateMixNMatch,
  calculateLeaderboard,
  calculateLeaderboardWithIds,
  nextPowerOfTwo,
  standardBracketOrder,
  buildKnockoutSeeds,
  buildFirstKnockoutRound
};
