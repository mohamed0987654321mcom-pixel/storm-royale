// Cross-platform tournaments: timed events where match results from the Roblox game AND from
// Neoblox's Thunder Battle count on one leaderboard.
//
//   • One person, one entry: a Storm Royale account linked to Roblox and/or Neoblox earns into a
//     single entry whichever game they play. Neoblox accounts that aren't linked compete on their
//     own. Roblox players compete once their Roblox account is linked (that's where we know who
//     they are and how old they are) — unlinked Roblox players simply aren't recorded.
//   • Squads are teams: a result earned while you're in a cross-play squad (2+ members) also counts
//     for that squad. A squad with points from both games is marked cross-platform.
//   • Same scoring for both games, and your BEST 10 matches count, so it's about playing well rather
//     than playing the most. Placement / win bonuses only count in matches with 4+ players.
//   • Kid accounts are never put on a public leaderboard (same rule as squads and open lobbies).
//
// Results are only ever reported by trusted servers: the Roblox game server (game API key) and the
// Neoblox server (MPARADISE key), which runs Thunder Battle rounds and counts the kills itself.

const db = require('./db');
const auth = require('./auth');

const BEST_OF = 10;
const KILL_CAP = 15; // eliminations that count in one match
const BONUS_MIN_PLAYERS = 4;
const WIN_BONUS = 10;
const WEEK_MS = 7 * 86400e3;
const RECENT_MS = 14 * 86400e3; // ended tournaments stay listed this long
const BOARD_TTL = 15000;
const MAX_LENGTH_DAYS = 60;

const SCORING = {
  bestOf: BEST_OF,
  killCap: KILL_CAP,
  bonusMinPlayers: BONUS_MIN_PLAYERS,
  winBonus: WIN_BONUS,
  placement: [5, 4, 3, 2, 1], // bonus for #1..#5
  text: `1 point per elimination (up to ${KILL_CAP} a match) · #1–#5 get +5/+4/+3/+2/+1 · a win adds +${WIN_BONUS} · bonuses need ${BONUS_MIN_PLAYERS}+ players · your best ${BEST_OF} matches count`,
};

const clampInt = (v, lo, hi, dflt) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
};

function pointsFor({ kills, placement, size, won }) {
  const k = Math.min(KILL_CAP, kills);
  if (size < BONUS_MIN_PLAYERS) return k;
  return k + (placement <= 5 ? 6 - placement : 0) + (won ? WIN_BONUS : 0);
}

// Monday 00:00 UTC of the week containing `now`
function weekStartUTC(now) {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * 86400e3);
}

const sumBest = (pts) => pts.slice().sort((a, b) => b - a).slice(0, BEST_OF).reduce((s, x) => s + x, 0);

module.exports = function makeTournaments({ crossplay = null, moderate } = {}) {
  const boardCache = new Map(); // tournamentId -> { at, data }
  const nameVerdict = new Map(); // Neoblox username -> allowed? (moderated once)
  let ensuredFor = null;

  async function ensureWeekly(now) {
    const ws = weekStartUTC(now);
    const key = `weekly:${ws.toISOString().slice(0, 10)}`;
    if (ensuredFor === key) return;
    await db.createTournament({ name: 'Weekly Storm Cup', startsAt: ws, endsAt: new Date(ws.getTime() + WEEK_MS), autoKey: key });
    ensuredFor = key;
  }

  const pub = (t, now = new Date()) => ({
    id: t.id,
    name: t.name,
    startsAt: t.startsAt.toISOString(),
    endsAt: t.endsAt.toISOString(),
    weekly: Boolean(t.autoKey),
    active: t.startsAt <= now && t.endsAt > now,
    upcoming: t.startsAt > now,
    endsInMs: Math.max(0, t.endsAt - now),
    startsInMs: Math.max(0, t.startsAt - now),
  });

  // Running first (special events before the weekly cup), then upcoming, then recently ended.
  async function list() {
    const now = new Date();
    await ensureWeekly(now);
    const rank = (t) => (t.active ? (t.weekly ? 1 : 0) : t.upcoming ? 2 : 3);
    return (await db.listTournaments({ endedAfter: new Date(now.getTime() - RECENT_MS) }))
      .map((t) => pub(t, now))
      .sort((a, b) => rank(a) - rank(b) || new Date(a.endsAt) - new Date(b.endsAt));
  }

  // ---------------------------------------------------------------- who gets the points
  async function safeNeobloxName(name) {
    name = String(name || '').trim().slice(0, 24);
    if (!name) return 'Neoblox player';
    if (!nameVerdict.has(name)) {
      let v = { allow: false, category: 'unavailable' };
      try {
        v = await moderate(name, { kind: 'name', author: name, ageGroup: 'teen' });
      } catch {}
      if (v.category === 'unavailable') return 'Neoblox player'; // ask again next time
      if (nameVerdict.size > 5000) nameVerdict.clear();
      nameVerdict.set(name, v.allow === true);
    }
    return nameVerdict.get(name) ? name : 'Neoblox player';
  }

  async function entrantForRoblox(robloxId) {
    const id = Number(robloxId);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    const u = await db.findUserByRoblox(id);
    if (!u || auth.ageGroup(u) === 'kid') return null;
    return { key: `storm:${u.id}`, name: u.name };
  }

  // name = their Neoblox username (only moderated when it's going on the board)
  async function entrantForNeoblox({ neobloxId, name, restricted }, { forBoard = true } = {}) {
    const id = String(neobloxId || '').slice(0, 64);
    if (!id || (restricted && restricted.isKid)) return null;
    const u = await db.findUserByNeoblox(id);
    if (u) return auth.ageGroup(u) === 'kid' ? null : { key: `storm:${u.id}`, name: u.name };
    return { key: `neoblox:${id}`, name: forBoard ? await safeNeobloxName(name) : String(name || '') };
  }

  const entrantForUser = (user) => (user && auth.ageGroup(user) !== 'kid' ? { key: `storm:${user.id}`, name: user.name } : null);

  // ---------------------------------------------------------------- recording a match
  // surface: 'roblox' | 'neoblox'; squadKey: the crossplay member key (to find their squad)
  async function record(entrant, { surface, squadKey, kills, placement, size, won }) {
    if (!entrant) return { counted: false, reason: 'not eligible' };
    const running = (await list()).filter((t) => t.active);
    if (!running.length) return { counted: false, reason: 'no tournament running' };
    const k = clampInt(kills, 0, 100, 0);
    const p = clampInt(placement, 1, 100, 100);
    const n = clampInt(size, 1, 100, 1);
    const w = won === true && p === 1;
    const sq = squadKey && crossplay ? crossplay.squadInfo(squadKey) : null;
    const teamKey = sq && sq.memberCount >= 2 ? `squad:${sq.id}` : null;
    const points = pointsFor({ kills: k, placement: p, size: n, won: w });
    await db.addTournamentResults(running.map((t) => ({
      tournamentId: t.id, entrantKey: entrant.key, entrantName: entrant.name, surface, teamKey, kills: k, placement: p, size: n, won: w, points,
    })));
    for (const t of running) boardCache.delete(t.id);
    return { counted: true, points, tournaments: running.map((t) => t.id) };
  }

  // ---------------------------------------------------------------- leaderboards
  function compute(rows) {
    const players = new Map();
    const teams = new Map();
    for (const r of rows.sort((a, b) => a.createdAt - b.createdAt)) {
      let pl = players.get(r.entrantKey);
      if (!pl) players.set(r.entrantKey, (pl = { key: r.entrantKey, pts: [], matches: 0, kills: 0, wins: 0, surfaces: new Set() }));
      pl.name = r.entrantName; // latest name wins
      pl.pts.push(r.points);
      pl.matches += 1;
      pl.kills += r.kills;
      if (r.won) pl.wins += 1;
      pl.surfaces.add(r.surface);
      if (r.teamKey) {
        let tm = teams.get(r.teamKey);
        if (!tm) teams.set(r.teamKey, (tm = { members: new Map(), pts: [], matches: 0, surfaces: new Set() }));
        tm.members.set(r.entrantKey, r.entrantName);
        tm.pts.push(r.points);
        tm.matches += 1;
        tm.surfaces.add(r.surface);
      }
    }
    const ps = [...players.values()]
      .map((x) => ({ key: x.key, name: x.name, score: sumBest(x.pts), matches: x.matches, kills: x.kills, wins: x.wins, surfaces: [...x.surfaces].sort() }))
      .sort((a, b) => b.score - a.score || b.wins - a.wins || b.kills - a.kills || a.name.localeCompare(b.name));
    ps.forEach((x, i) => { x.rank = i + 1; });
    const ts = [...teams.values()]
      .map((x) => ({ members: [...x.members.values()], memberKeys: [...x.members.keys()], score: sumBest(x.pts), matches: x.matches, crossPlatform: x.surfaces.size > 1 }))
      .sort((a, b) => b.score - a.score || b.matches - a.matches);
    ts.forEach((x, i) => { x.rank = i + 1; });
    return { players: ps, teams: ts };
  }

  // viewerKey: the asking player's entrant key (to mark "you"), or null
  async function board(id, viewerKey = null) {
    const t = await db.findTournament(Number(id));
    if (!t) return null;
    let c = boardCache.get(t.id);
    if (!c || Date.now() - c.at > BOARD_TTL) {
      c = { at: Date.now(), data: compute(await db.listTournamentResults(t.id)) };
      boardCache.set(t.id, c);
    }
    const { players, teams } = c.data;
    // internal keys (account ids) never leave the server: just a `you` flag
    const strip = (x) => ({ rank: x.rank, name: x.name, score: x.score, matches: x.matches, kills: x.kills, wins: x.wins, surfaces: x.surfaces, you: Boolean(viewerKey) && x.key === viewerKey });
    const me = viewerKey ? players.find((x) => x.key === viewerKey) : null;
    return {
      tournament: pub(t),
      scoring: SCORING,
      totalPlayers: players.length,
      totalTeams: teams.length,
      players: players.slice(0, 50).map(strip),
      teams: teams.slice(0, 20).map((x) => ({ rank: x.rank, members: x.members, score: x.score, matches: x.matches, crossPlatform: x.crossPlatform, you: Boolean(viewerKey) && x.memberKeys.includes(viewerKey) })),
      you: me ? strip(me) : null,
      canCompete: Boolean(viewerKey),
    };
  }

  // The board for whatever's running now (special events first), plus the list of tournaments.
  async function current(viewerKey = null) {
    const all = await list();
    const pick = all.find((t) => t.active) || all.find((t) => t.upcoming) || all[0];
    return { tournaments: all, board: pick ? await board(pick.id, viewerKey) : null };
  }

  // ---------------------------------------------------------------- admin
  async function create({ name, startsAt, endsAt }) {
    name = String(name || '').trim().slice(0, 40);
    const s = new Date(startsAt);
    const e = new Date(endsAt);
    if (name.length < 3) return { error: 'Give it a name (3–40 characters).' };
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return { error: 'Pick a start and an end time.' };
    if (e <= s) return { error: 'It has to end after it starts.' };
    if (e - s > MAX_LENGTH_DAYS * 86400e3) return { error: `Keep it under ${MAX_LENGTH_DAYS} days.` };
    if (e <= new Date()) return { error: 'That time has already passed.' };
    return { ok: true, tournament: pub(await db.createTournament({ name, startsAt: s, endsAt: e })) };
  }

  async function remove(id) {
    const t = await db.findTournament(Number(id));
    if (!t) return { error: 'No such tournament.' };
    if (t.autoKey) return { error: 'The weekly cup runs automatically and can’t be deleted.' };
    await db.deleteTournament(t.id);
    boardCache.delete(t.id);
    return { ok: true };
  }

  return { SCORING, pointsFor, list, board, current, record, create, remove, entrantForRoblox, entrantForNeoblox, entrantForUser };
};

module.exports.pointsFor = pointsFor;
module.exports.weekStartUTC = weekStartUTC;
module.exports.SCORING = SCORING;
