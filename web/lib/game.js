// Game API: the Roblox game server talks to the website with a secret key (header x-api-key).
const crypto = require('crypto');
const express = require('express');
const db = require('./db');
const auth = require('./auth');
const looks = require('./looks');
const mparadise = require('./mparadise');
const place = require('./place');

const STATUSES = new Set(['Lobby', 'Warm-up', 'On the bus', 'In match', 'Spectating']);

function keyOk(given) {
  const key = process.env.GAME_API_KEY;
  if (!key || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = function gameRoutes(rt, crossplay, tournaments) {
  const r = express.Router();

  r.use((req, res, next) => {
    if (!process.env.GAME_API_KEY) return res.status(503).json({ error: 'GAME_API_KEY is not set on the server' });
    if (!keyOk(req.get('x-api-key'))) return res.status(401).json({ error: 'bad api key' });
    next();
  });

  // Every ~10 s each Roblox server reports who's playing and gets back their parties + party chat.
  // body: { players: [{ robloxId, status, coins }] }
  // `coins` (optional) is also how the MPARADISE link stays current: Roblox Coins are always
  // authoritative here (the game's own DataStore), this just mirrors the latest number for the
  // website and, for linked players, forwards it on to Neoblox — see mparadise.js's comment on
  // why that's a safe thing to do on every heartbeat with no reconciliation needed.
  r.post('/sync', async (req, res) => {
    // the game tells us its own place id (that's how "open Storm Royale on Roblox" links know it)
    if (req.body?.placeId) place.learn(req.body.placeId);
    const list = Array.isArray(req.body?.players) ? req.body.players.slice(0, 60) : [];
    const ids = list.map((p) => Number(p.robloxId)).filter((n) => Number.isSafeInteger(n) && n > 0);
    const users = ids.length ? await db.findUsersByRoblox(ids) : [];
    const byRoblox = new Map(users.map((u) => [u.robloxId, u]));
    const out = {};
    for (const p of list) {
      const u = byRoblox.get(Number(p.robloxId));
      if (!u) continue;
      const status = STATUSES.has(p.status) ? p.status : 'Lobby';
      rt.setGamePresence(u.id, status);
      // lookVer: when it changes, the game fetches the new look (/look) and dresses the player
      out[String(u.robloxId)] = { name: u.name, lookVer: u.lookVer || 0, ...rt.gameInfoFor(u.id) };
      const coins = Math.max(0, Math.floor(Number(p.coins) || 0));
      if (Number.isFinite(coins) && coins !== u.robloxCoinsMirror) {
        u.robloxCoinsMirror = coins; // keep this in-memory copy current for the push below
        db.updateUser(u.id, { robloxCoinsMirror: coins })
          .then(() => mparadise.pushCoinsToNeoblox(u))
          .catch((err) => console.warn('[game] coins mirror update failed:', err.message));
      }
    }
    res.json({ players: out });
  });

  // ---- avatar builder ("MY STYLE")
  const linked = async (req, res) => {
    const u = await db.findUserByRoblox(Number(req.body?.robloxId));
    if (!u) res.json({ ok: false, reason: 'not linked' });
    return u;
  };

  // the game asks for a player's look after seeing a new lookVer
  r.post('/look', async (req, res) => {
    const u = await linked(req, res);
    if (!u) return;
    res.json({ ok: true, look: u.look, lookVer: u.lookVer || 0 });
  });

  // the player changed their look in the game (the game server already checked they own every item)
  r.post('/look/save', async (req, res) => {
    const u = await linked(req, res);
    if (!u) return;
    // reset = back to the normal Roblox avatar (the game can't send a JSON null)
    const look = req.body.reset === true || req.body.look === null ? null : looks.sanitizeLook(req.body.look).look;
    const lookVer = Date.now();
    await db.updateUser(u.id, { look, lookVer });
    res.json({ ok: true, lookVer });
  });

  // the player's owned items, read by the game with their permission (Roblox inventories are usually private)
  r.post('/inventory', async (req, res) => {
    const u = await linked(req, res);
    if (!u) return;
    const items = looks.sanitizeInventory(req.body.items);
    await db.setAvatarItems(u.id, items);
    res.json({ ok: true, count: items.length });
  });

  // After a match. body: { robloxId, kills, placement, won }
  r.post('/match', async (req, res) => {
    const u = await db.findUserByRoblox(Number(req.body?.robloxId));
    if (!u) return res.json({ ok: false, reason: 'not linked' });
    const kills = Math.max(0, Math.min(100, Math.floor(Number(req.body.kills) || 0)));
    const placement = Math.max(1, Math.min(100, Math.floor(Number(req.body.placement) || 100)));
    const s = { matches: 0, wins: 0, kills: 0, best: null, ...u.stats };
    s.matches += 1;
    s.kills += kills;
    if (req.body.won === true || placement === 1) s.wins += 1;
    s.best = s.best ? Math.min(s.best, placement) : placement;
    await db.updateUser(u.id, { stats: s });
    await rt.refreshUser(u.id);
    // if this player is in a cross-play squad, show their match result there too
    if (crossplay && crossplay.inSquad(`roblox:${u.robloxId}`)) {
      crossplay.reportResult(`roblox:${u.robloxId}`, { kills, placement, won: req.body.won === true || placement === 1 });
    }
    // ...and on the tournament leaderboard (size = players in the match, bots included)
    let tournament = null;
    if (tournaments) {
      try {
        tournament = await tournaments.record(tournaments.entrantForUser(u), {
          surface: 'roblox', squadKey: `roblox:${u.robloxId}`, kills, placement, size: req.body.size, won: req.body.won === true || placement === 1,
        });
      } catch (err) {
        console.warn('[tournaments] record failed:', err.message);
      }
    }
    res.json({ ok: true, tournament });
  });

  // The tournament board for the in-game panel (the game filters every name before showing it).
  r.post('/tournament', async (req, res) => {
    if (!tournaments) return res.json({ tournaments: [], board: null });
    const e = await tournaments.entrantForRoblox(req.body?.robloxId);
    res.json(await tournaments.current(e ? e.key : null));
  });

  // ---- cross-play squads (the Roblox game drives these for its players; the game server already
  // authenticated with the API key above). A Roblox player is keyed `roblox:<robloxId>`. If that
  // Roblox account is linked to a Storm Royale KID account, squads are refused (same stranger-
  // contact rule as the rest of the site). Everything else is the shared hub (lib/crossplay.js).
  if (crossplay) {
    const robloxMember = async (body) => {
      const robloxId = Number(body.robloxId);
      let name = String(body.name || '').slice(0, 24) || null;
      let restricted = null;
      if (Number.isSafeInteger(robloxId) && robloxId > 0) {
        const u = await db.findUserByRoblox(robloxId);
        if (u) {
          name = name || u.name || u.robloxName;
          restricted = { isKid: auth.ageGroup(u) === 'kid' };
        }
      }
      return { surface: 'roblox', id: String(robloxId), name: name || 'Roblox player', restricted, placeId: body.placeId, jobId: body.jobId };
    };
    const rbKey = (body) => `roblox:${Number(body.robloxId)}`;
    const reply = (res, result) => (result.error ? res.status(result.kid ? 403 : 400).json(result) : res.json(result));

    r.post('/crossplay/create', async (req, res) => reply(res, crossplay.create(await robloxMember(req.body || {}))));
    r.post('/crossplay/join', async (req, res) => reply(res, crossplay.join(req.body?.code, await robloxMember(req.body || {}))));
    r.post('/crossplay/leave', (req, res) => res.json(crossplay.leave(rbKey(req.body || {}))));
    r.post('/crossplay/ready', (req, res) => reply(res, crossplay.setReady(rbKey(req.body || {}), req.body?.ready === true)));
    r.post('/crossplay/launch', (req, res) => reply(res, crossplay.launch(rbKey(req.body || {}))));
    r.post('/crossplay/chat', async (req, res) => reply(res, await crossplay.chat(rbKey(req.body || {}), req.body?.text, { ageGroup: 'teen' })));
    // Poll: the game sends each squad member's live status (Lobby / In match / …) and gets the squad back.
    r.post('/crossplay/state', (req, res) => {
      const b = req.body || {};
      res.json(crossplay.state(rbKey(b), { name: b.name, status: b.status, placeId: b.placeId, jobId: b.jobId }));
    });
  }

  return r;
};
