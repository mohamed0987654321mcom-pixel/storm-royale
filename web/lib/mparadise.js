// MPARADISE link: one shared identity + token balance with Neoblox (Mohamed's other site,
// neoblox.mparadiseplatrforms.com). The flow mirrors Storm Royale's own Roblox-link UX exactly —
// a short code, typed on the other side, redeemed server-to-server — except the "other side"
// here is Neoblox's own server, authenticated with a shared secret (MPARADISE_LINK_KEY, set the
// same value on both Railway services) rather than ever trusting what the browser claims about
// the other account.
//
// Each site only ever WRITES its own mirror column — neoblox_tokens_mirror here is written only
// when Neoblox pushes its own new total; roblox_coins_mirror is written only from this game's own
// heartbeat (lib/game.js's /sync, already running every ~10s per online player). Neoblox does the
// same on its side. That means there's no race to reconcile: the "shared total" shown to a player
// is always just a safe sum of two independently-authoritative numbers, recomputed on read.
//
// Safety: Storm Royale's kid accounts (under 13, parent-approved, chat/voice off by default) are
// allowed to link too — no exceptions — but every claim/push call also carries this player's
// current ageGroup + kidSettings, so Neoblox can mirror the same chat/voice/avatar-upload
// restriction instead of handing a locked-down kid account a free pass into Neoblox's unmoderated
// surfaces. See accounts.js's restrictionsFor() on the Neoblox side.
const crypto = require('crypto');
const express = require('express');
const db = require('./db');
const auth = require('./auth');

const NEOBLOX_URL = process.env.NEOBLOX_URL || 'https://neoblox.mparadiseplatrforms.com';

function keyOk(given) {
  const key = process.env.MPARADISE_LINK_KEY;
  if (!key || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function callNeoblox(path, body) {
  const res = await fetch(NEOBLOX_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-mparadise-key': process.env.MPARADISE_LINK_KEY || '' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error || `Neoblox ${res.status}`), { status: res.status });
  return data;
}

module.exports = function mparadiseRoutes(rt, crossplay) {
  const r = express.Router();

  const needUser = (handler) => async (req, res) => {
    try {
      const uid = auth.readSession(req.headers.cookie);
      const user = uid && (await db.findUserById(uid));
      if (!user) return res.status(401).json({ error: 'Sign in first' });
      await handler(req, res, user);
    } catch (err) {
      console.error('[mparadise]', err);
      res.status(err.status || 500).json({ error: err.message || 'Something went wrong' });
    }
  };

  const publicStatus = (user) => ({
    linked: Boolean(user.neobloxId),
    neobloxUsername: user.neobloxUsername || null,
    sharedTotal: (user.robloxCoinsMirror || 0) + (user.neobloxTokensMirror || 0),
  });

  r.get('/api/mparadise/status', needUser(async (req, res, user) => {
    res.json(publicStatus(user));
  }));

  // The player already has a code from Neoblox ("link your Storm Royale account" there) — enter
  // it here to redeem it. We call OUT to Neoblox's server to confirm the code and exchange info;
  // the browser never talks to Neoblox directly.
  r.post('/api/mparadise/claim', needUser(async (req, res, user) => {
    if (user.neobloxId) return res.status(400).json({ error: 'Already linked to a Neoblox account.' });
    const code = String(req.body?.code || '').trim();
    if (!code) return res.status(400).json({ error: 'Enter the code shown on Neoblox.' });
    if (!process.env.MPARADISE_LINK_KEY) return res.status(503).json({ error: 'Linking is not set up on this server yet.' });
    let data;
    try {
      data = await callNeoblox('/api/mparadise/redeem', {
        code,
        stormUserId: String(user.id),
        stormUsername: user.name,
        ageGroup: auth.ageGroup(user),
        kidSettings: user.kidSettings,
        coinsSeed: user.robloxCoinsMirror || 0,
      });
    } catch (err) {
      return res.status(400).json({ error: err.message || "Couldn't reach Neoblox — try again in a moment." });
    }
    try {
      await db.updateUser(user.id, { neobloxId: String(data.neobloxId), neobloxUsername: data.neobloxUsername || null, neobloxTokensMirror: Number(data.neobloxTokens) || 0 });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'That Neoblox account is linked to another Storm Royale account.' });
      throw err;
    }
    await rt.refreshUser(user.id);
    res.json({ ok: true, ...publicStatus({ ...user, neobloxId: data.neobloxId, neobloxUsername: data.neobloxUsername, neobloxTokensMirror: data.neobloxTokens }) });
  }));

  r.post('/api/mparadise/unlink', needUser(async (req, res, user) => {
    await db.updateUser(user.id, { neobloxId: null, neobloxUsername: null, neobloxTokensMirror: 0 });
    await rt.refreshUser(user.id);
    res.json({ ok: true, ...publicStatus({ ...user, neobloxId: null, neobloxUsername: null, neobloxTokensMirror: 0 }) });
  }));

  // ---- server-to-server (Neoblox calls these; never the browser) ----
  r.use('/api/mparadise/push', (req, res, next) => (keyOk(req.get('x-mparadise-key')) ? next() : res.status(401).json({ error: 'bad key' })));

  // Neoblox pushes its latest token total for a linked player whenever it awards tokens.
  r.post('/api/mparadise/push', async (req, res) => {
    const neobloxId = String(req.body?.neobloxId || '');
    const tokens = Number(req.body?.neobloxTokens);
    if (!neobloxId || !Number.isFinite(tokens)) return res.status(400).json({ error: 'missing neobloxId/neobloxTokens' });
    const user = await db.findUserByNeoblox(neobloxId);
    if (!user) return res.status(404).json({ error: 'not linked' });
    await db.updateUser(user.id, { neobloxTokensMirror: Math.max(0, Math.floor(tokens)) });
    await rt.refreshUser(user.id);
    res.json({ ok: true });
  });

  // ---- cross-play squads: Neoblox's server relays its players' squad actions here (never the
  // browser). A Neoblox member is keyed `neoblox:<neobloxId>`; everything else is the shared
  // crossplay hub (see lib/crossplay.js). Neoblox sends the player's name + restriction flags so
  // the hub can show them and keep kid accounts out.
  if (crossplay) {
    r.use('/api/mparadise/party', (req, res, next) => (keyOk(req.get('x-mparadise-key')) ? next() : res.status(401).json({ error: 'bad key' })));

    const nbMember = (b) => ({ surface: 'neoblox', id: b.neobloxId, name: b.name, restricted: b.restricted || null });
    const nbKey = (b) => `neoblox:${String(b.neobloxId || '')}`;
    const reply = (res, result) => (result.error ? res.status(result.kid ? 403 : 400).json(result) : res.json(result));

    r.post('/api/mparadise/party/create', (req, res) => reply(res, crossplay.create(nbMember(req.body || {}))));
    r.post('/api/mparadise/party/join', (req, res) => reply(res, crossplay.join(req.body?.code, nbMember(req.body || {}))));
    r.post('/api/mparadise/party/leave', (req, res) => res.json(crossplay.leave(nbKey(req.body || {}))));
    r.post('/api/mparadise/party/ready', (req, res) => reply(res, crossplay.setReady(nbKey(req.body || {}), req.body?.ready === true)));
    r.post('/api/mparadise/party/launch', (req, res) => reply(res, crossplay.launch(nbKey(req.body || {}))));
    r.post('/api/mparadise/party/result', (req, res) => reply(res, crossplay.reportResult(nbKey(req.body || {}), req.body || {})));
    r.post('/api/mparadise/party/chat', async (req, res) => reply(res, await crossplay.chat(nbKey(req.body || {}), req.body?.text, { ageGroup: 'teen' })));
    // Poll: refresh presence and return the squad view (or { inSquad:false }).
    r.post('/api/mparadise/party/state', (req, res) => {
      const b = req.body || {};
      res.json(crossplay.state(nbKey(b), { name: b.name, restricted: b.restricted || null, status: b.status }));
    });
  }

  return r;
};

// Called from lib/game.js's existing /sync heartbeat (every ~10s per online Roblox player) when
// a linked player's in-game Coins total has changed. Fire-and-forget: if Neoblox or the network
// is briefly down, the next heartbeat tries again with the latest number — nothing here is
// load-bearing for Storm Royale's own (always-authoritative, Roblox DataStore-backed) Coins.
async function pushCoinsToNeoblox(user) {
  if (!user.neobloxId || !process.env.MPARADISE_LINK_KEY) return;
  try {
    await callNeoblox('/api/mparadise/push', {
      stormUserId: String(user.id),
      stormCoinsMirror: user.robloxCoinsMirror || 0,
      ageGroup: auth.ageGroup(user),
      kidSettings: user.kidSettings,
    });
  } catch (err) {
    console.warn('[mparadise] push to Neoblox failed:', err.message);
  }
}
module.exports.pushCoinsToNeoblox = pushCoinsToNeoblox;
