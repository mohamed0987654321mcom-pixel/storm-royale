// Website side of the avatar builder ("MY STYLE" locker).
// Items come from two places: the owned-items list the game uploads (read in Roblox with the player's permission,
// because Roblox inventories are usually private) and the items the player is wearing on Roblox right now (public).
// Saved looks are picked up by the game within ~10 s (see lookVer in lib/game.js).
const express = require('express');
const db = require('./db');
const auth = require('./auth');
const looks = require('./looks');

const THUMB_TTL = 12 * 3600e3;
const WORN_TTL = 2 * 60e3;
const thumbCache = new Map(); // assetId -> { url, at }
const wornCache = new Map(); // robloxId -> { data, at }
const saves = new Map(); // userId -> [timestamps]

async function robloxJson(url) {
  const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Roblox ${r.status}`);
  return r.json();
}

// what the player is wearing on Roblox right now (public, no permission needed)
async function wornAvatar(robloxId, { fresh = false } = {}) {
  const c = wornCache.get(robloxId);
  if (!fresh && c && Date.now() - c.at < WORN_TTL) return c.data;
  const data = looks.fromRobloxAvatar(await robloxJson(`https://avatar.roblox.com/v2/avatar/users/${robloxId}/avatar`));
  wornCache.set(robloxId, { data, at: Date.now() });
  if (wornCache.size > 5000) wornCache.delete(wornCache.keys().next().value);
  return data;
}

// Roblox item pictures (150x150 PNGs on Roblox's image CDN)
async function thumbsFor(ids) {
  const out = {};
  const need = [];
  for (const id of ids) {
    const c = thumbCache.get(id);
    if (c && Date.now() - c.at < THUMB_TTL) out[id] = c.url;
    else need.push(id);
  }
  for (let i = 0; i < need.length; i += 100) {
    const batch = need.slice(i, i + 100);
    try {
      const data = await robloxJson(`https://thumbnails.roblox.com/v1/assets?assetIds=${batch.join(',')}&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false`);
      for (const t of data.data || []) {
        // pending pictures aren't cached, so they're asked for again next time
        if (t.state === 'Completed' && typeof t.imageUrl === 'string' && /^https:\/\/[a-z0-9.-]+\.rbxcdn\.com\//.test(t.imageUrl)) {
          thumbCache.set(Number(t.targetId), { url: t.imageUrl, at: Date.now() });
          out[t.targetId] = t.imageUrl;
        }
      }
    } catch (err) {
      console.error('[avatar] thumbnails', err.message);
    }
  }
  if (thumbCache.size > 60000) {
    let n = 10000;
    for (const k of thumbCache.keys()) {
      thumbCache.delete(k);
      if (--n <= 0) break;
    }
  }
  return out;
}

function mergeItems(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const it of list || []) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      out.push(it);
    }
  }
  return out;
}

const RULES = {
  types: looks.TYPES,
  categories: looks.CATEGORIES,
  parts: looks.PARTS,
  scales: looks.SCALES,
  rigidMax: looks.RIGID_MAX,
  layeredMax: looks.LAYERED_MAX,
  itemsMax: looks.ITEMS_MAX,
};

module.exports = function avatarRoutes() {
  const r = express.Router();

  const needUser = (handler) => async (req, res) => {
    try {
      const uid = auth.readSession(req.headers.cookie);
      const user = uid && (await db.findUserById(uid));
      if (!user) return res.status(401).json({ error: 'Sign in first' });
      await handler(req, res, user);
    } catch (err) {
      console.error('[avatar]', err);
      res.status(500).json({ error: 'Something went wrong' });
    }
  };

  r.get('/api/avatar', needUser(async (req, res, user) => {
    if (!user.robloxId) return res.json({ linked: false, rules: RULES });
    const [worn, stored] = await Promise.all([wornAvatar(user.robloxId).catch(() => null), db.getAvatarItems(user.id)]);
    const blank = looks.sanitizeLook({}).look;
    res.json({
      linked: true,
      robloxName: user.robloxName,
      look: user.look || worn?.look || blank,
      saved: Boolean(user.look),
      lookVer: user.lookVer || 0,
      robloxLook: worn?.look || null, // for "start over from my Roblox avatar"
      items: mergeItems(stored?.items, worn?.items),
      inventoryAt: stored?.updatedAt || null,
      rules: RULES,
    });
  }));

  // the page checks this now and then, to notice a look saved in the game
  r.get('/api/avatar/ver', needUser(async (req, res, user) => {
    res.json({ lookVer: user.lookVer || 0 });
  }));

  r.post('/api/avatar/thumbs', needUser(async (req, res) => {
    const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))].slice(0, 120);
    res.json({ thumbs: await thumbsFor(ids) });
  }));

  r.post('/api/avatar', needUser(async (req, res, user) => {
    if (!user.robloxId) return res.status(400).json({ error: 'Link your Roblox account first' });
    const now = Date.now();
    const recent = (saves.get(user.id) || []).filter((t) => now - t < 60e3);
    if (recent.length >= 20) return res.status(429).json({ error: 'Saving too fast. Wait a moment.' });
    recent.push(now);
    saves.set(user.id, recent);
    // only items this Roblox account owns: the list from the game, plus what they're wearing on Roblox right now
    const [worn, stored] = await Promise.all([wornAvatar(user.robloxId, { fresh: true }).catch(() => null), db.getAvatarItems(user.id)]);
    const owned = new Set([...(stored?.items || []), ...(worn?.items || [])].map((i) => i.id));
    const { look, dropped } = looks.sanitizeLook(req.body?.look, { owned });
    const lookVer = Date.now();
    await db.updateUser(user.id, { look, lookVer });
    res.json({ ok: true, look, lookVer, dropped });
  }));

  // back to the normal Roblox avatar in Storm Royale
  r.post('/api/avatar/reset', needUser(async (req, res, user) => {
    const lookVer = Date.now();
    await db.updateUser(user.id, { look: null, lookVer });
    res.json({ ok: true, lookVer });
  }));

  return r;
};
