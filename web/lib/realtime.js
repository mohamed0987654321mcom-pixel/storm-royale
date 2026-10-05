// Realtime: open rooms, parties, text chat, WebRTC voice signalling, moderation actions.
// Everything here is in memory: parties and chat are live-only, like a game lobby.
const crypto = require('crypto');
const { Server } = require('socket.io');
const db = require('./db');
const auth = require('./auth');
const { moderate, enabled: moderationOn } = require('./moderation');

// never run chat/voice unmoderated on the live site
const SAFETY_OFF = !moderationOn && process.env.NODE_ENV === 'production';
const SAFETY_MSG = 'Chat and voice turn on as soon as safety moderation is set up.';

const OPEN_ROOMS = 4; // per age group
const VOICE_MAX = 10;
const PARTY_MAX = 4;
const HISTORY = 60;
const GAME_FRESH_MS = 30000;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const openRoomIds = (group) => Array.from({ length: OPEN_ROOMS }, (_, i) => `open-${group}-${i + 1}`);

function attach(httpServer, { iceServers, admins }) {
  const io = new Server(httpServer, { maxHttpBufferSize: 1e5, cors: { origin: false } });

  const online = new Map(); // userId -> { user, sockets:Set, partyId, roomId, voiceSocket, voiceRoom, game }
  const parties = new Map(); // partyId -> { id, code, leaderId, members:[uid], ready:Set }
  const partyByCode = new Map();
  const history = new Map(); // roomId -> [msg]
  const transcripts = new Map(); // roomId -> [{name,text}]
  const voiceRooms = new Map(); // roomId -> Map(userId -> socketId)
  const recentByUser = new Map(); // userId -> [{room,text,ts}] (report context)
  const rate = new Map();
  const leaveTimers = new Map();

  const isAdmin = (user) => admins.includes(String(user.email).toLowerCase());
  const isMuted = (user) => Boolean(user.mutedUntil && new Date(user.mutedUntil) > new Date());
  const currentRoom = (o) => (o.partyId ? `party-${o.partyId}` : o.roomId);
  const freshGame = (o) => (o.game && Date.now() - o.game.at < GAME_FRESH_MS ? o.game.status : null);

  function roomTitle(roomId) {
    if (roomId.startsWith('party-')) return 'Party';
    const m = /^open-(teen|adult)-(\d+)$/.exec(roomId);
    return m ? `Lobby ${m[2]}` : roomId;
  }

  function pub(o) {
    return {
      id: o.user.id,
      name: o.user.name,
      robloxName: o.user.robloxName || null,
      inVoice: Boolean(o.voiceSocket),
      muted: isMuted(o.user),
      game: freshGame(o),
    };
  }

  function membersOf(roomId) {
    const out = [];
    for (const o of online.values()) if (o.sockets.size && currentRoom(o) === roomId) out.push(o);
    return out;
  }

  function partyInfo(p) {
    return {
      id: p.id,
      code: p.code,
      leaderId: p.leaderId,
      max: PARTY_MAX,
      members: p.members.filter((id) => online.has(id)).map((id) => ({ ...pub(online.get(id)), leader: id === p.leaderId, ready: p.ready.has(id) })),
    };
  }

  function roomInfo(roomId) {
    const p = roomId.startsWith('party-') ? parties.get(roomId.slice(6)) : null;
    return {
      id: roomId,
      kind: p ? 'party' : 'open',
      title: roomTitle(roomId),
      members: membersOf(roomId).map(pub),
      party: p ? partyInfo(p) : null,
      voiceCount: (voiceRooms.get(roomId) || new Map()).size,
      voiceMax: VOICE_MAX,
    };
  }

  function meInfo(o) {
    const u = o.user;
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      ageGroup: auth.ageGroup(u),
      robloxId: u.robloxId,
      robloxName: u.robloxName,
      blocked: u.blocked,
      mutedUntil: isMuted(u) ? u.mutedUntil : null,
      strikes: u.strikes,
      stats: u.stats,
      isAdmin: isAdmin(u),
    };
  }

  function pushState(o) {
    const room = currentRoom(o);
    const group = auth.ageGroup(o.user);
    io.to(`u:${o.user.id}`).emit('state', {
      me: meInfo(o),
      room: roomInfo(room),
      history: history.get(room) || [],
      rooms: openRoomIds(group).map((id) => ({ id, title: roomTitle(id), count: membersOf(id).length })),
      iceServers,
    });
  }

  function broadcastRoom(roomId) {
    io.to(`r:${roomId}`).emit('room', roomInfo(roomId));
  }

  function systemMsg(o, text) {
    io.to(`u:${o.user.id}`).emit('chat:system', { text, ts: Date.now() });
  }

  // ---------------------------------------------------------------- voice
  function leaveVoice(o) {
    const room = o.voiceRoom;
    if (!room) return;
    const vr = voiceRooms.get(room);
    if (vr) {
      vr.delete(o.user.id);
      if (!vr.size) voiceRooms.delete(room);
    }
    o.voiceSocket = null;
    o.voiceRoom = null;
    io.to(`r:${room}`).emit('voice:peer-left', { userId: o.user.id });
    broadcastRoom(room);
  }

  // move a user between rooms (open room <-> party), keeping sockets + voice consistent
  function relocate(o, change) {
    const before = currentRoom(o);
    change();
    const after = currentRoom(o);
    if (before === after) return;
    leaveVoice(o);
    for (const s of o.sockets) {
      s.leave(`r:${before}`);
      s.join(`r:${after}`);
    }
    broadcastRoom(before);
    broadcastRoom(after);
    pushState(o);
  }

  // ---------------------------------------------------------------- parties
  function newCode() {
    let code;
    do {
      code = Array.from(crypto.randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
    } while (partyByCode.has(code));
    return code;
  }

  function leaveParty(o) {
    const p = o.partyId && parties.get(o.partyId);
    if (!p) return;
    p.members = p.members.filter((id) => id !== o.user.id);
    p.ready.delete(o.user.id);
    const room = `party-${p.id}`;
    relocate(o, () => {
      o.partyId = null;
    });
    if (!p.members.length) {
      parties.delete(p.id);
      partyByCode.delete(p.code);
      history.delete(room);
      transcripts.delete(room);
    } else {
      if (p.leaderId === o.user.id) p.leaderId = p.members[0];
      broadcastRoom(room);
    }
  }

  function joinParty(o, p) {
    if (o.partyId === p.id) return;
    if (o.partyId) leaveParty(o);
    p.members.push(o.user.id);
    relocate(o, () => {
      o.partyId = p.id;
    });
    for (const id of p.members) {
      const m = online.get(id);
      if (m && m !== o) systemMsg(m, `${o.user.name} joined the party`);
    }
  }

  // ---------------------------------------------------------------- moderation actions
  function remember(o, room, text, blocked = false) {
    const list = recentByUser.get(o.user.id) || [];
    list.push({ room, name: o.user.name, text, ts: Date.now(), ...(blocked ? { blocked: true } : {}) });
    if (list.length > 15) list.shift();
    recentByUser.set(o.user.id, list);
  }

  // convo: what was said in the room just before, so the admin sees the whole conversation
  async function punish(o, verdict, content, room, isVoice, convo = []) {
    if (verdict.category === 'unavailable') return;
    if (verdict.category === 'self_harm') {
      systemMsg(o, "💙 It sounds like things might be hard right now. You're not alone. Please talk to someone you trust, or reach out to a local helpline.");
      return;
    }
    const sev = verdict.severity;
    const changes = {};
    let muteMin = 0;
    if (sev >= 2) {
      changes.strikes = (o.user.strikes || 0) + 1;
      muteMin = sev >= 3 ? 24 * 60 : 10;
      if (changes.strikes % 3 === 0) muteMin = Math.max(muteMin, 30);
    } else if (isVoice && sev >= 1) {
      muteMin = 2;
    }
    if (muteMin) changes.mutedUntil = new Date(Date.now() + muteMin * 60000);
    if (Object.keys(changes).length) o.user = await db.updateUser(o.user.id, changes);
    if (sev >= 2) {
      await db.addReport({
        targetId: o.user.id,
        reason: `AI moderation: ${verdict.category} (${verdict.reason})`,
        source: 'ai',
        context: [...convo.slice(-8), { name: o.user.name, text: content, ts: Date.now(), blocked: true }],
      });
    }
    const what = isVoice ? 'Something you said in voice' : 'Your message';
    systemMsg(o, `⚠️ ${what} was blocked: ${verdict.reason || verdict.category}.${muteMin ? ` You're muted for ${muteMin >= 60 ? Math.round(muteMin / 60) + ' h' : muteMin + ' min'}.` : ''}`);
    if (muteMin) {
      const vr = o.voiceRoom;
      if (vr) io.to(`r:${vr}`).emit('voice:muted', { userId: o.user.id, until: o.user.mutedUntil });
      pushState(o);
      broadcastRoom(currentRoom(o));
    }
  }

  function rateOk(uid) {
    const now = Date.now();
    const list = (rate.get(uid) || []).filter((t) => now - t < 10000);
    if (list.length >= 6) return false;
    list.push(now);
    rate.set(uid, list);
    return true;
  }

  // ---------------------------------------------------------------- sockets
  io.use(async (socket, next) => {
    try {
      const uid = auth.readSession(socket.handshake.headers.cookie);
      if (!uid) return next(new Error('unauthorized'));
      const user = await db.findUserById(uid);
      if (!user) return next(new Error('unauthorized'));
      if (user.bannedUntil && new Date(user.bannedUntil) > new Date()) return next(new Error('banned'));
      socket.data.uid = uid;
      next();
    } catch (err) {
      next(err);
    }
  });

  io.on('connection', async (socket) => {
    const uid = socket.data.uid;
    let o = online.get(uid);
    if (!o) {
      const user = await db.findUserById(uid);
      o = { user, sockets: new Set(), partyId: null, roomId: openRoomIds(auth.ageGroup(user))[0], voiceSocket: null, voiceRoom: null, game: null };
      online.set(uid, o);
    }
    clearTimeout(leaveTimers.get(uid));
    leaveTimers.delete(uid);
    o.sockets.add(socket);
    socket.join(`u:${uid}`);
    socket.join(`r:${currentRoom(o)}`);
    pushState(o);
    broadcastRoom(currentRoom(o));

    const on = (ev, fn) =>
      socket.on(ev, async (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        try {
          await fn(payload || {}, reply);
        } catch (err) {
          console.error(`[socket ${ev}]`, err);
          reply({ ok: false, reason: 'Something went wrong' });
        }
      });

    on('room:join', ({ roomId }, reply) => {
      if (o.partyId) return reply({ ok: false, reason: 'Leave your party to join a lobby' });
      if (!openRoomIds(auth.ageGroup(o.user)).includes(roomId)) return reply({ ok: false, reason: 'Unknown room' });
      relocate(o, () => {
        o.roomId = roomId;
      });
      reply({ ok: true });
    });

    on('chat:send', async ({ text }, reply) => {
      text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!text) return reply({ ok: false });
      if (SAFETY_OFF) return reply({ ok: false, reason: SAFETY_MSG });
      if (isMuted(o.user)) return reply({ ok: false, reason: `You're muted until ${new Date(o.user.mutedUntil).toLocaleTimeString()}` });
      if (!rateOk(uid)) return reply({ ok: false, reason: 'Slow down a little!' });
      const room = currentRoom(o);
      const hist = history.get(room) || [];
      const verdict = await moderate(text, {
        kind: 'chat',
        author: o.user.name,
        ageGroup: auth.ageGroup(o.user),
        context: hist.slice(-6).map((m) => ({ name: m.from.name, text: m.text })),
      });
      remember(o, room, text, !verdict.allow);
      if (!verdict.allow) {
        await punish(o, verdict, text, room, false, hist.slice(-8).map((m) => ({ name: m.from.name, text: m.text, ts: m.ts })));
        return reply({ ok: false, reason: verdict.reason, category: verdict.category });
      }
      if (currentRoom(o) !== room) return reply({ ok: false, reason: 'You changed rooms' });
      const msg = { id: crypto.randomUUID(), room, from: { id: uid, name: o.user.name, robloxId: o.user.robloxId }, text, ts: Date.now() };
      hist.push(msg);
      if (hist.length > HISTORY) hist.shift();
      history.set(room, hist);
      io.to(`r:${room}`).emit('chat:msg', msg);
      reply({ ok: true });
    });

    // ---- parties
    on('party:create', (_, reply) => {
      if (o.partyId) return reply({ ok: false, reason: "You're already in a party" });
      const p = { id: crypto.randomBytes(5).toString('hex'), code: newCode(), leaderId: uid, members: [], ready: new Set() };
      parties.set(p.id, p);
      partyByCode.set(p.code, p);
      joinParty(o, p);
      reply({ ok: true, code: p.code });
    });

    on('party:join', ({ code }, reply) => {
      const p = partyByCode.get(String(code || '').toUpperCase().trim());
      if (!p) return reply({ ok: false, reason: 'No party with that code' });
      if (p.members.length >= PARTY_MAX) return reply({ ok: false, reason: 'That party is full' });
      const blockedByMember = p.members.some((id) => (online.get(id)?.user.blocked || []).includes(uid));
      if (blockedByMember) return reply({ ok: false, reason: "You can't join that party" });
      joinParty(o, p);
      reply({ ok: true });
    });

    on('party:invite', ({ name }, reply) => {
      const p = o.partyId && parties.get(o.partyId);
      if (!p) return reply({ ok: false, reason: 'Create a party first' });
      const target = [...online.values()].find((m) => m.user.name.toLowerCase() === String(name || '').toLowerCase());
      if (!target || target === o) return reply({ ok: false, reason: 'That player is not online' });
      if (!(target.user.blocked || []).includes(uid) && !(o.user.blocked || []).includes(target.user.id)) {
        io.to(`u:${target.user.id}`).emit('party:invite', { from: o.user.name, code: p.code });
      }
      reply({ ok: true });
    });

    on('party:leave', (_, reply) => {
      leaveParty(o);
      reply({ ok: true });
    });

    on('party:kick', ({ userId }, reply) => {
      const p = o.partyId && parties.get(o.partyId);
      const target = online.get(userId);
      if (!p || p.leaderId !== uid || !target || target.partyId !== p.id || target === o) return reply({ ok: false });
      leaveParty(target);
      systemMsg(target, 'You were removed from the party');
      reply({ ok: true });
    });

    on('party:promote', ({ userId }, reply) => {
      const p = o.partyId && parties.get(o.partyId);
      if (!p || p.leaderId !== uid || !p.members.includes(userId)) return reply({ ok: false });
      p.leaderId = userId;
      broadcastRoom(`party-${p.id}`);
      reply({ ok: true });
    });

    on('party:ready', ({ ready }, reply) => {
      const p = o.partyId && parties.get(o.partyId);
      if (!p) return reply({ ok: false });
      if (ready) p.ready.add(uid);
      else p.ready.delete(uid);
      broadcastRoom(`party-${p.id}`);
      reply({ ok: true });
    });

    // ---- voice (WebRTC mesh; the server only relays signalling)
    on('voice:join', (_, reply) => {
      if (SAFETY_OFF) return reply({ ok: false, reason: SAFETY_MSG });
      const room = currentRoom(o);
      const vr = voiceRooms.get(room) || new Map();
      if (vr.size >= VOICE_MAX && !vr.has(uid)) return reply({ ok: false, reason: 'Voice is full in this room' });
      if (o.voiceSocket) leaveVoice(o);
      vr.set(uid, socket.id);
      voiceRooms.set(room, vr);
      o.voiceSocket = socket.id;
      o.voiceRoom = room;
      socket.to(`r:${room}`).emit('voice:peer-joined', { userId: uid });
      broadcastRoom(room);
      reply({ ok: true, peers: [...vr.keys()].filter((id) => id !== uid), iceServers, moderated: true });
    });

    on('voice:leave', (_, reply) => {
      if (o.voiceSocket === socket.id) leaveVoice(o);
      reply({ ok: true });
    });

    on('voice:signal', ({ to, data }) => {
      const vr = o.voiceRoom && voiceRooms.get(o.voiceRoom);
      if (!vr || vr.get(uid) !== socket.id || !vr.has(to)) return;
      io.to(vr.get(to)).emit('voice:signal', { from: uid, data });
    });

    on('voice:transcript', async ({ text }) => {
      text = String(text || '').trim().slice(0, 400);
      const room = o.voiceRoom;
      if (!text || !room) return;
      const ctx = transcripts.get(room) || [];
      const verdict = await moderate(text, { kind: 'voice', author: o.user.name, ageGroup: auth.ageGroup(o.user), context: ctx });
      const before = ctx.map((m) => ({ name: m.name, text: `[voice] ${m.text}`, ts: m.ts }));
      ctx.push({ name: o.user.name, text, ts: Date.now() });
      if (ctx.length > 8) ctx.shift();
      transcripts.set(room, ctx);
      remember(o, room, `[voice] ${text}`, !verdict.allow);
      if (!verdict.allow) await punish(o, verdict, `[voice] ${text}`, room, true, before);
    });

    // ---- safety tools
    on('user:report', async ({ userId, reason }, reply) => {
      const target = online.get(userId)?.user || (await db.findUserById(Number(userId)));
      if (!target || target.id === uid) return reply({ ok: false });
      await db.addReport({
        reporterId: uid,
        targetId: target.id,
        reason: String(reason || 'No reason given').slice(0, 300),
        source: 'user',
        context: (recentByUser.get(target.id) || []).slice(-10),
      });
      reply({ ok: true });
    });

    on('user:block', async ({ userId, block }, reply) => {
      const id = Number(userId);
      if (!id || id === uid) return reply({ ok: false });
      const set = new Set(o.user.blocked || []);
      if (block) set.add(id);
      else set.delete(id);
      o.user = await db.updateUser(uid, { blocked: [...set] });
      pushState(o);
      reply({ ok: true });
    });

    socket.on('disconnect', () => {
      o.sockets.delete(socket);
      if (o.voiceSocket === socket.id) leaveVoice(o);
      if (!o.sockets.size) {
        // keep their party spot for a minute in case they're just refreshing
        leaveTimers.set(
          uid,
          setTimeout(() => {
            if (o.sockets.size) return;
            leaveParty(o);
            online.delete(uid);
            broadcastRoom(currentRoom(o));
          }, 60000),
        );
      }
      broadcastRoom(currentRoom(o));
    });
  });

  // game presence goes stale if the Roblox server stops reporting
  setInterval(() => {
    for (const o of online.values()) {
      if (o.game && !o.gameStale && Date.now() - o.game.at > GAME_FRESH_MS) {
        o.gameStale = true;
        broadcastRoom(currentRoom(o));
      }
    }
  }, 10000).unref();

  // ---------------------------------------------------------------- API for HTTP routes
  return {
    async refreshUser(uid) {
      const o = online.get(uid);
      if (!o) return;
      o.user = await db.findUserById(uid);
      pushState(o);
      broadcastRoom(currentRoom(o));
    },
    disconnectUser(uid) {
      const o = online.get(uid);
      if (!o) return;
      for (const s of o.sockets) s.disconnect(true);
    },
    setGamePresence(uid, status) {
      const o = online.get(uid);
      if (!o) return;
      const changed = !o.game || o.game.status !== status || o.gameStale;
      o.game = { status, at: Date.now() };
      o.gameStale = false;
      if (changed) broadcastRoom(currentRoom(o));
    },
    gameInfoFor(uid) {
      const o = online.get(uid);
      const p = o && o.partyId && parties.get(o.partyId);
      if (!p) return { party: null, chat: [] };
      return {
        party: {
          code: p.code,
          members: p.members
            .filter((id) => online.has(id))
            .map((id) => {
              const m = online.get(id);
              return { name: m.user.name, robloxId: m.user.robloxId, status: freshGame(m) || 'Website', leader: id === p.leaderId, ready: p.ready.has(id) };
            }),
        },
        chat: (history.get(`party-${p.id}`) || []).slice(-8).map((m) => ({ id: m.id, name: m.from.name, robloxId: m.from.robloxId, text: m.text, ts: m.ts })),
      };
    },
    stats() {
      return { online: online.size, parties: parties.size, inVoice: [...voiceRooms.values()].reduce((n, v) => n + v.size, 0) };
    },
  };
}

module.exports = attach;
