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
const avatarRoutes = require('./lib/avatar');

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
// the game uploads a player's owned-items list, which can be big; everything else stays small
app.use('/api/game', express.json({ limit: '512kb' }));
app.use(express.json({ limit: '50kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://*.rbxcdn.com; media-src 'self' blob:; connect-src 'self' wss: ws:; frame-ancestors 'none'",
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
app.use(avatarRoutes());

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

// only a CONFIRMED email counts (an unconfirmed "skip for now" email could be anyone's)
const isAdminUser = (user) => Boolean(user.email) && user.emailVerified !== false && ADMINS.includes(user.email.toLowerCase());

const needAdmin = (handler) =>
  needUser(async (req, res, user) => {
    if (!isAdminUser(user)) return res.status(403).json({ error: 'Admins only' });
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

// "skip for now" makes an account without proving the email, so cap it per network
const skips = new Map(); // ip -> [timestamps]
function skipAllowed(ip) {
  const now = Date.now();
  const list = (skips.get(ip) || []).filter((t) => now - t < 3600e3);
  if (list.length >= 5) return false;
  list.push(now);
  skips.set(ip, list);
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const m of [emailSends, skips]) for (const [k, list] of m) if (!list.some((t) => now - t < 3600e3)) m.delete(k);
}, 10 * 60e3).unref();

const verifyLinkFor = (req, user, email) => `${baseUrl(req)}/auth/verify-email?token=${encodeURIComponent(auth.createVerifyLink(user.id, email))}`;
const devOnly = (sent, link) => (!sent && process.env.DEV_SHOW_LINK === '1' ? { devLink: link } : {});

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

      // "Skip for now": make the account and sign in right away; the email gets confirmed later.
      // The email is only "pending" until then, so nobody can claim someone else's address.
      if (req.body.skip === true) {
        if (!skipAllowed(req.ip)) return res.status(429).json({ error: 'Too many new accounts from here. Confirm your email instead, or try again later.' });
        let user;
        try {
          user = await db.createUser({ email: null, pendingEmail: email, emailVerified: false, name, birthDate: String(birthDate), parentEmail, consent: parentEmail ? 'pending' : 'none' });
        } catch (err) {
          if (err.code === '23505') return res.status(409).json({ error: 'That name is taken' });
          throw err;
        }
        if (parentEmail) await parents.sendConsentRequest(user).catch((err) => console.error('[kids] consent email', err));
        const link = verifyLinkFor(req, user, email);
        let sent = false;
        if (sendAllowed(email)) sent = await auth.sendVerifyEmail(email, user.name, link).catch((err) => (console.error('[auth] verify email', err), false));
        auth.setSession(res, user.id);
        return res.json({ ok: true, skipped: true, sent, ...devOnly(sent, link) });
      }
      data = { email, name, birthDate: String(birthDate), parentEmail };
    }
    if (!sendAllowed(email)) return res.status(429).json({ error: 'Too many emails. Try again in an hour.' });
    const token = auth.createLoginToken(data);
    const link = `${baseUrl(req)}/auth/verify?token=${encodeURIComponent(token)}`;
    const sent = await auth.sendLoginEmail(email, link, !existing);
    res.json({ ok: true, sent, ...devOnly(sent, link) });
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

// the link in the "confirm your email" email: confirms it and signs in (on any device)
app.get('/auth/verify-email', async (req, res) => {
  try {
    const v = auth.readVerifyLink(req.query.token);
    const user = v && (await db.findUserById(v.uid));
    if (!user) return res.redirect('/?error=link');
    if (user.emailVerified && user.email === v.email) {
      auth.setSession(res, user.id); // already confirmed: just sign in
      return res.redirect('/');
    }
    if (user.emailVerified || user.pendingEmail !== v.email) return res.redirect('/?error=link');
    // someone already confirmed this email on another account: it's theirs
    const owner = await db.findUserByEmail(v.email);
    if (owner && owner.id !== user.id) return res.redirect('/?error=emailtaken');
    try {
      await db.updateUser(user.id, { email: v.email, pendingEmail: null, emailVerified: true });
    } catch (err) {
      if (err.code === '23505') return res.redirect('/?error=emailtaken');
      throw err;
    }
    auth.setSession(res, user.id);
    await rt.refreshUser(user.id);
    res.redirect('/?verified=1');
  } catch (err) {
    console.error(err);
    res.redirect('/?error=server');
  }
});

// send the confirm link again: for the signed-in player, or by email (lost the cookie / new device)
app.post('/api/auth/resend-verify', async (req, res) => {
  try {
    const uid = auth.readSession(req.headers.cookie);
    const me = uid ? await db.findUserById(uid) : null;
    let targets;
    if (me && !req.body?.email) {
      if (me.emailVerified) return res.status(400).json({ error: 'Your email is already confirmed' });
      targets = [me];
    } else {
      const email = String(req.body?.email || '').trim().toLowerCase();
      if (!auth.validEmail(email)) return res.status(400).json({ error: 'Enter a valid email' });
      targets = await db.findPendingByEmail(email);
    }
    let devLink = null;
    for (const u of targets.slice(0, 3)) {
      if (!u.pendingEmail || !sendAllowed(u.pendingEmail)) {
        if (me && targets[0] === me) return res.status(429).json({ error: 'Too many emails. Try again in an hour.' });
        break;
      }
      const link = verifyLinkFor(req, u, u.pendingEmail);
      const sent = await auth.sendVerifyEmail(u.pendingEmail, u.name, link);
      if (!sent) devLink = devLink || link;
    }
    // same answer whether or not that email has an account, so nobody can probe emails
    res.json({ ok: true, ...(devLink && process.env.DEV_SHOW_LINK === '1' ? { devLink } : {}) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Something went wrong' });
  }
});

// fix a typo'd email on a "skip for now" account (old confirm links stop working)
app.post('/api/auth/change-email', needUser(async (req, res, user) => {
  if (user.emailVerified) return res.status(400).json({ error: 'Your email is already confirmed' });
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!auth.validEmail(email)) return res.status(400).json({ error: 'Enter a valid email' });
  if (user.parentEmail && email === user.parentEmail) return res.status(400).json({ error: "Use your own email, not your parent's" });
  if (!sendAllowed(email)) return res.status(429).json({ error: 'Too many emails. Try again in an hour.' });
  await db.updateUser(user.id, { pendingEmail: email });
  const link = verifyLinkFor(req, user, email);
  const sent = await auth.sendVerifyEmail(email, user.name, link);
  await rt.refreshUser(user.id);
  res.json({ ok: true, ...devOnly(sent, link) });
}));

app.post('/api/auth/logout', (req, res) => {
  auth.clearSession(res);
  res.json({ ok: true });
});

app.get('/api/me', needUser(async (req, res, user) => {
  res.json({ id: user.id, name: user.name, email: user.email || user.pendingEmail, emailVerified: user.emailVerified !== false, ageGroup: auth.ageGroup(user), consent: user.consent, robloxName: user.robloxName, isAdmin: isAdminUser(user) });
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
    const changed = user.robloxId !== p.robloxId;
    await db.updateUser(user.id, { robloxId: p.robloxId, robloxName: p.robloxName, ...(changed ? { look: null, lookVer: Date.now() } : {}) });
    if (changed) await db.setAvatarItems(user.id, null); // items belonged to the old Roblox account
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That Roblox account is linked to another Storm Royale account' });
    throw err;
  }
  robloxPending.delete(user.id);
  await rt.refreshUser(user.id);
  res.json({ ok: true, robloxName: p.robloxName });
}));

app.post('/api/roblox/unlink', needUser(async (req, res, user) => {
  await db.updateUser(user.id, { robloxId: null, robloxName: null, look: null, lookVer: Date.now() });
  await db.setAvatarItems(user.id, null);
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
    await rt.refreshUser(Number(targetId)); // lifts a mute live, no reload needed
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
app.get('/locker', (req, res) => res.sendFile(path.join(__dirname, 'public', 'locker.html')));

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
