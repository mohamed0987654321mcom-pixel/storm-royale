// Parent page API: parents approve their child's account, approve friends, control chat/voice, delete the account.
// Parents sign in with a link sent to their email (separate from player accounts).
const express = require('express');
const db = require('./db');
const auth = require('./auth');
const verify = require('./verify');

const PENDING_DAYS = 7;

module.exports = function parentRoutes({ rt, publicUrl }) {
  const r = express.Router();
  const linkFor = (email) => `${publicUrl()}/parent/verify?token=${encodeURIComponent(auth.createParentLink(email))}`;

  async function notifyParent(email, subject, text) {
    return auth.sendParentNoticeEmail(email, subject, text, linkFor(email));
  }

  async function sendConsentRequest(kid) {
    return auth.sendParentConsentEmail(kid.parentEmail, kid.name, linkFor(kid.parentEmail));
  }

  const needParent = (handler) => async (req, res) => {
    try {
      const email = auth.readParentSession(req.headers.cookie);
      if (!email) return res.status(401).json({ error: 'Sign in as a parent first' });
      await handler(req, res, email);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Something went wrong' });
    }
  };

  // the kid must belong to this parent
  async function ownKid(email, kidId) {
    const kid = await db.findUserById(Number(kidId));
    return kid && kid.parentEmail === email ? kid : null;
  }

  // ------------------------------------------------------------ sign in
  const sends = new Map();
  r.post('/api/parent/start', async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      if (!auth.validEmail(email)) return res.status(400).json({ error: 'Enter a valid email' });
      const now = Date.now();
      const list = (sends.get(email) || []).filter((t) => now - t < 3600e3);
      // same answer whether or not this email has kids (don't reveal which emails are parents)
      if (list.length < 5) {
        list.push(now);
        sends.set(email, list);
        const kids = await db.findKidsByParent(email);
        if (kids.length) {
          const link = linkFor(email);
          const sent = await auth.sendParentLoginEmail(email, link);
          if (!sent && process.env.DEV_SHOW_LINK === '1') return res.json({ ok: true, devLink: link });
        }
      }
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

  r.get('/parent/verify', (req, res) => {
    const email = auth.readParentLink(req.query.token);
    if (!email) return res.redirect('/parent?error=link');
    auth.setParentSession(res, email);
    res.redirect('/parent');
  });

  r.post('/api/parent/logout', (req, res) => {
    auth.clearParentSession(res);
    res.json({ ok: true });
  });

  // ------------------------------------------------------------ overview
  r.get('/api/parent/me', needParent(async (req, res, email) => {
    const kids = await db.findKidsByParent(email);
    const reqs = kids.length ? await db.listFriendRequestsFor(kids.map((k) => k.id)) : [];
    const otherIds = new Set();
    for (const k of kids) k.friends.forEach((f) => otherIds.add(f));
    for (const q of reqs) [q.fromId, q.toId].forEach((id) => otherIds.add(id));
    const others = otherIds.size ? await db.findUsersByIds([...otherIds]) : [];
    const name = new Map(others.map((u) => [u.id, u.name]));
    res.json({
      email,
      verifyAvailable: verify.available(),
      kids: kids.map((k) => ({
        id: k.id,
        name: k.name,
        stillKid: auth.ageGroup(k) === 'kid',
        consent: k.consent,
        settings: k.kidSettings,
        robloxName: k.robloxName,
        online: rt.isOnline(k.id),
        strikes: k.strikes,
        createdAt: k.createdAt,
        friends: k.friends.map((id) => ({ id, name: name.get(id) || `Player #${id}` })),
        // only requests both kids agreed to need a parent's decision
        requests: reqs
          .filter((q) => q.accepted && (q.fromId === k.id || q.toId === k.id))
          .map((q) => {
            const mine = q.fromId === k.id ? 'fromParentOk' : 'toParentOk';
            const theirs = mine === 'fromParentOk' ? 'toParentOk' : 'fromParentOk';
            return { id: q.id, otherName: name.get(q.fromId === k.id ? q.toId : q.fromId), approvedByMe: q[mine], approvedByOther: q[theirs] };
          }),
      })),
    });
  }));

  // ------------------------------------------------------------ account consent
  r.post('/api/parent/consent', needParent(async (req, res, email) => {
    const kid = await ownKid(email, req.body?.kidId);
    if (!kid) return res.status(404).json({ error: 'Not found' });
    if (req.body.approve === true) {
      if (kid.consent === 'pending' || kid.consent === 'none') await db.updateUser(kid.id, { consent: 'basic' });
      await rt.refreshUser(kid.id);
      return res.json({ ok: true });
    }
    // declining deletes the account and everything stored about it
    rt.disconnectUser(kid.id);
    await db.deleteUser(kid.id);
    res.json({ ok: true, deleted: true });
  }));

  // Phase 2: stronger parent verification (e.g. Epic Kids Web Services) unlocks chat/voice
  r.post('/api/parent/verify', needParent(async (req, res, email) => {
    const kid = await ownKid(email, req.body?.kidId);
    if (!kid) return res.status(404).json({ error: 'Not found' });
    if (!verify.available()) return res.status(501).json({ error: "Parent verification is coming soon. Until then, chat and voice stay off." });
    const { url } = await verify.startParentVerification({ parentEmail: email, kidId: kid.id, returnUrl: `${publicUrl()}/parent` });
    res.json({ ok: true, url });
  }));

  r.post('/api/parent/settings', needParent(async (req, res, email) => {
    const kid = await ownKid(email, req.body?.kidId);
    if (!kid) return res.status(404).json({ error: 'Not found' });
    const next = { ...kid.kidSettings };
    for (const key of ['chat', 'voice']) if (typeof req.body[key] === 'boolean') next[key] = req.body[key];
    const turningOn = (next.chat && !kid.kidSettings.chat) || (next.voice && !kid.kidSettings.voice);
    if (turningOn && kid.consent !== 'verified') {
      return res.status(403).json({ error: 'Verify that you are a parent to turn chat or voice on.', needVerify: true });
    }
    await db.updateUser(kid.id, { kidSettings: next });
    await rt.refreshUser(kid.id);
    res.json({ ok: true, settings: next });
  }));

  // ------------------------------------------------------------ friends
  r.post('/api/parent/request', needParent(async (req, res, email) => {
    const q = await db.findFriendRequest(Number(req.body?.requestId));
    if (!q || !q.accepted) return res.status(404).json({ error: 'Not found' });
    const [from, to] = await db.findUsersByIds([q.fromId, q.toId]).then((us) => [us.find((u) => u.id === q.fromId), us.find((u) => u.id === q.toId)]);
    if (!from || !to) return res.status(404).json({ error: 'Not found' });
    const isFromParent = from.parentEmail === email;
    const isToParent = to.parentEmail === email;
    if (!isFromParent && !isToParent) return res.status(404).json({ error: 'Not found' });
    if (req.body.approve !== true) {
      await db.deleteFriendRequest(q.id);
      await rt.refreshUser(from.id);
      await rt.refreshUser(to.id);
      return res.json({ ok: true });
    }
    const fields = {};
    if (isFromParent) fields.fromParentOk = true;
    if (isToParent) fields.toParentOk = true; // siblings: one parent approves both sides
    const upd = await db.updateFriendRequest(q.id, fields);
    if (upd.fromParentOk && upd.toParentOk) {
      await db.updateUser(from.id, { friends: [...new Set([...from.friends, to.id])] });
      await db.updateUser(to.id, { friends: [...new Set([...to.friends, from.id])] });
      await db.deleteFriendRequest(q.id);
    }
    await rt.refreshUser(from.id);
    await rt.refreshUser(to.id);
    res.json({ ok: true, friends: upd.fromParentOk && upd.toParentOk });
  }));

  r.post('/api/parent/unfriend', needParent(async (req, res, email) => {
    const kid = await ownKid(email, req.body?.kidId);
    const friendId = Number(req.body?.friendId);
    if (!kid || !kid.friends.includes(friendId)) return res.status(404).json({ error: 'Not found' });
    await rt.unfriend(kid.id, friendId);
    res.json({ ok: true });
  }));

  // withdraw consent: delete the account and everything stored about it
  r.post('/api/parent/delete', needParent(async (req, res, email) => {
    const kid = await ownKid(email, req.body?.kidId);
    if (!kid) return res.status(404).json({ error: 'Not found' });
    rt.disconnectUser(kid.id);
    await db.deleteUser(kid.id);
    res.json({ ok: true });
  }));

  // kids whose parent never answered are deleted (with their email) after PENDING_DAYS
  async function cleanup() {
    try {
      for (const kid of await db.stalePendingKids(PENDING_DAYS)) {
        rt.disconnectUser(kid.id);
        await db.deleteUser(kid.id);
        console.log(`[kids] deleted unapproved account #${kid.id} after ${PENDING_DAYS} days`);
      }
    } catch (err) {
      console.error('[kids] cleanup', err);
    }
  }
  setInterval(cleanup, 3600e3).unref();
  setTimeout(cleanup, 10e3).unref();

  return { router: r, notifyParent, sendConsentRequest };
};
