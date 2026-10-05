// Storm Royale website: parties, chat and voice for Storm Royale players.
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const db = require('./lib/db');
const auth = require('./lib/auth');
const moderation = require('./lib/moderation');
const attachRealtime = require('./lib/realtime');
const gameRoutes = require('./lib/game');
const parentRoutes = require('./lib/parents');

const PORT = Number(process.env.PORT) || 3000;
const ADMINS = String(process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);

function iceServers() {
  const list = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.TURN_URL) list.push({ urls: process.env.TURN_URL.split(','), username: process.env.TURN_USERNAME, credential: process.env.TURN_PASSWORD });
  return list;
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; media-src 'self' blob:; connect-src 'self' wss: ws:; frame-ancestors 'none'",
  );
  next();
});

const server = http.createServer(app);
const publicUrl = () => process.env.PUBLIC_URL || `http://localhost:${PORT}`;
let parents = null; // parent page API (created after realtime, which needs its email helper)
const rt = attachRealtime(server, {
  iceServers: iceServers(),
  admins: ADMINS,
  notifyParent: (...args) => parents.notifyParent(...args),
});
parents = parentRoutes({ rt, publicUrl });
app.use(parents.router);

const baseUrl = (req) => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;

async function currentUser(req) {
  const uid = auth.readSession(req.headers.cookie);
  return uid ? db.findUserById(uid) : null;
}

const needUser = (handler) => async (req, res) => {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Sign in first' });
    await handler(req, res, user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
};

const needAdmin = (handler) =>
  needUser(async (req, res, user) => {
    if (!ADMINS.includes(user.email.toLowerCase())) return res.status(403).json({ error: 'Admins only' });
    await handler(req, res, user);
  });

// ------------------------------------------------------------------ sign in
const emailSends = new Map(); // email -> [timestamps]
function sendAllowed(email) {
  const now = Date.now();
  const list = (emailSends.get(email) || []).filter((t) => now - t < 3600e3);
  if (list.length >= 5) return false;
  list.push(now);
  emailSends.set(email, list);
  return true;
}

app.post('/api/auth/start', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!auth.validEmail(email)) return res.status(400).json({ error: 'Enter a valid email' });
    const existing = await db.findUserByEmail(email);
    let data;
    if (existing) {
      if (existing.bannedUntil && existing.bannedUntil > new Date()) return res.status(403).json({ error: `This account is banned until ${existing.bannedUntil.toDateString()}` });
      data = { email };
    } else {
      const { name, birthDate } = req.body || {};
      if (!name || !birthDate) return res.json({ needSignup: true });
      if (!auth.validName(name)) return res.status(400).json({ error: 'Name: 3–20 letters, numbers or _' });
      const age = auth.ageFrom(String(birthDate));
      if (age < 0 || age > 120) return res.status(400).json({ error: 'Enter a real birth date' });
      let parentEmail = null;
      if (age < auth.MIN_AGE) {
        // kids accounts: only with a parent's permission (and only once switched on)
        if (!auth.KIDS_ENABLED) return res.status(403).json({ error: `Storm Royale's website is for players ${auth.MIN_AGE} and older for now. Kids accounts are coming soon!` });
        if (age < auth.KID_MIN_AGE) return res.status(403).json({ error: `Players need to be at least ${auth.KID_MIN_AGE}` });
        parentEmail = String(req.body.parentEmail || '').trim().toLowerCase();
        if (!parentEmail) return res.json({ needParent: true });
        if (!auth.validEmail(parentEmail)) return res.status(400).json({ error: "Enter your parent's email" });
        if (parentEmail === email) return res.status(400).json({ error: "Use your parent's own email, not yours" });
      }
      if (await db.findUserByName(name)) return res.status(409).json({ error: 'That name is taken' });
      const group = age < auth.MIN_AGE ? 'kid' : age >= 18 ? 'adult' : 'teen';
      const v = await moderation.moderate(name, { kind: 'name', author: name, ageGroup: group });
      if (!v.allow) return res.status(400).json({ error: 'Please pick a different name' });
      data = { email, name, birthDate: String(birthDate), parentEmail };
    }
    if (!sendAllowed(email)) return res.status(429).json({ error: 'Too many emails. Try again in an hour.' });
    const token = auth.createLoginToken(data);
    const link = `${baseUrl(req)}/auth/verify?token=${encodeURIComponent(token)}`;
    const sent = await auth.sendLoginEmail(email, link, !existing);
    res.json({ ok: true, sent, ...(!sent && process.env.DEV_SHOW_LINK === '1' ? { devLink: link } : {}) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Something went wrong' });
  }
});

app.get('/auth/verify', async (req, res) => {
  try {
    const data = auth.consumeLoginToken(String(req.query.token || ''));
    if (!data) return res.redirect('/?error=link');
    let user = await db.findUserByEmail(data.email);
    if (!user) {
      if (!data.name) return res.redirect('/?error=link');
      if (await db.findUserByName(data.name)) return res.redirect('/?error=name');
      const kid = Boolean(data.parentEmail);
      user = await db.createUser({ email: data.email, name: data.name, birthDate: data.birthDate, parentEmail: data.parentEmail || null, consent: kid ? 'pending' : 'none' });
      if (kid) await parents.sendConsentRequest(user).catch((err) => console.error('[kids] consent email', err));
    }
    auth.setSession(res, user.id);
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.redirect('/?error=server');
  }
});

app.post('/api/auth/logout', (req, res) => {
  auth.clearSession(res);
  res.json({ ok: true });
});

app.get('/api/me', needUser(async (req, res, user) => {
  res.json({ id: user.id, name: user.name, email: user.email, ageGroup: auth.ageGroup(user), consent: user.consent, robloxName: user.robloxName, isAdmin: ADMINS.includes(user.email.toLowerCase()) });
}));

const resends = new Map();
app.post('/api/kid/resend-parent', needUser(async (req, res, user) => {
  if (auth.ageGroup(user) !== 'kid' || user.consent !== 'pending' || !user.parentEmail) return res.status(400).json({ error: 'Nothing to resend' });
  const last = resends.get(user.id) || 0;
  if (Date.now() - last < 10 * 60e3) return res.status(429).json({ error: 'We just sent it. Ask your parent to check their inbox (and spam).' });
  resends.set(user.id, Date.now());
  await parents.sendConsentRequest(user);
  res.json({ ok: true });
}));

// ------------------------------------------------------------------ link Roblox account
// The player puts a short code in their Roblox profile "About" section; we check it with Roblox's public API.
const robloxPending = new Map(); // userId -> { robloxId, robloxName, code, exp }

app.post('/api/roblox/start', needUser(async (req, res, user) => {
  const username = String(req.body?.username || '').trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Enter your Roblox username' });
  const r = await fetch('https://users.roblox.com/v1/usernames/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernames: [username], excludeBannedUsers: true }),
    signal: AbortSignal.timeout(8000),
  });
  const found = r.ok ? (await r.json()).data?.[0] : null;
  if (!found) return res.status(404).json({ error: 'No Roblox user with that name' });
  const code = `storm-${crypto.randomBytes(3).toString('hex')}`;
  robloxPending.set(user.id, { robloxId: found.id, robloxName: found.name, code, exp: Date.now() + 30 * 60e3 });
  res.json({ ok: true, robloxName: found.name, code });
}));

app.post('/api/roblox/verify', needUser(async (req, res, user) => {
  const p = robloxPending.get(user.id);
  if (!p || p.exp < Date.now()) return res.status(400).json({ error: 'Start again: the code expired' });
  const r = await fetch(`https://users.roblox.com/v1/users/${p.robloxId}`, { signal: AbortSignal.timeout(8000) });
  const profile = r.ok ? await r.json() : null;
  if (!profile || !String(profile.description || '').includes(p.code)) {
    return res.status(400).json({ error: `Couldn't find "${p.code}" in ${p.robloxName}'s About section yet. Save it on Roblox and try again.` });
  }
  try {
    await db.updateUser(user.id, { robloxId: p.robloxId, robloxName: p.robloxName });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That Roblox account is linked to another Storm Royale account' });
    throw err;
  }
  robloxPending.delete(user.id);
  await rt.refreshUser(user.id);
  res.json({ ok: true, robloxName: p.robloxName });
}));

app.post('/api/roblox/unlink', needUser(async (req, res, user) => {
  await db.updateUser(user.id, { robloxId: null, robloxName: null });
  await rt.refreshUser(user.id);
  res.json({ ok: true });
}));

// ------------------------------------------------------------------ admin
app.get('/api/admin/reports', needAdmin(async (req, res) => {
  const reports = await db.listReports(req.query.status === 'closed' ? 'closed' : 'open');
  const names = new Map();
  for (const r of reports) {
    for (const id of [r.targetId, r.reporterId]) {
      if (id && !names.has(id)) {
        const u = await db.findUserById(id);
        names.set(id, u ? { name: u.name, group: auth.ageGroup(u) } : null);
      }
    }
  }
  res.json({
    reports: reports.map((r) => ({ ...r, targetName: names.get(r.targetId)?.name || `#${r.targetId}`, targetGroup: names.get(r.targetId)?.group, reporterName: r.reporterId ? names.get(r.reporterId)?.name || `#${r.reporterId}` : 'AI moderator' })),
    live: rt.stats(),
  });
}));

app.post('/api/admin/reports/:id', needAdmin(async (req, res) => {
  const { action, targetId } = req.body || {};
  const hours = Math.max(1, Math.min(24 * 365, Number(req.body?.hours) || 24));
  const until = new Date(Date.now() + hours * 3600e3);
  if (action === 'ban') {
    await db.updateUser(Number(targetId), { bannedUntil: until });
    rt.disconnectUser(Number(targetId));
  } else if (action === 'mute') {
    await db.updateUser(Number(targetId), { mutedUntil: until });
    await rt.refreshUser(Number(targetId));
  } else if (action === 'unban') {
    await db.updateUser(Number(targetId), { bannedUntil: null, mutedUntil: null });
  }
  await db.setReportStatus(Number(req.params.id), 'closed');
  res.json({ ok: true });
}));

// ------------------------------------------------------------------ game + pages
app.use('/api/game', gameRoutes(rt));
app.get('/health', (req, res) => res.json({ ok: true, db: db.kind, moderation: moderation.enabled ? moderation.model : 'off', ...rt.stats() }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/parent', (req, res) => res.sendFile(path.join(__dirname, 'public', 'parent.html')));

db.init()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Storm Royale web on :${PORT} (db: ${db.kind}, moderation: ${moderation.enabled ? moderation.model : 'OFF'})`);
      if (!moderation.enabled) console.warn('[moderation] ANTHROPIC_API_KEY not set: only the local link/phone/email filter is active');
    });
  })
  .catch((err) => {
    console.error('Database init failed', err);
    process.exit(1);
  });
