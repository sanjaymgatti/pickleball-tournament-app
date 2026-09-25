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

module.exports = { roundRobin, generateMixNMatch, calculateLeaderboard };
