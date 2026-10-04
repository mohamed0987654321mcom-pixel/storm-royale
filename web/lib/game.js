// Game API: the Roblox game server talks to the website with a secret key (header x-api-key).
const crypto = require('crypto');
const express = require('express');
const db = require('./db');

const STATUSES = new Set(['Lobby', 'Warm-up', 'On the bus', 'In match', 'Spectating']);

function keyOk(given) {
  const key = process.env.GAME_API_KEY;
  if (!key || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = function gameRoutes(rt) {
  const r = express.Router();

  r.use((req, res, next) => {
    if (!process.env.GAME_API_KEY) return res.status(503).json({ error: 'GAME_API_KEY is not set on the server' });
    if (!keyOk(req.get('x-api-key'))) return res.status(401).json({ error: 'bad api key' });
    next();
  });

  // Every ~10 s each Roblox server reports who's playing and gets back their parties + party chat.
  // body: { players: [{ robloxId, status }] }
  r.post('/sync', async (req, res) => {
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
      out[String(u.robloxId)] = { name: u.name, ...rt.gameInfoFor(u.id) };
    }
    res.json({ players: out });
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
    res.json({ ok: true });
  });

  return r;
};
