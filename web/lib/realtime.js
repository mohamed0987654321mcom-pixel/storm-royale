// Realtime: open rooms, parties, text chat, WebRTC voice signalling, kids' friends, moderation actions.
// Everything here is in memory: parties and chat are live-only, like a game lobby.
//
// Age groups (auth.ageGroup): 'kid' (under 13), 'teen' (13-17), 'adult' (18+). They never mix:
//   • teens and adults have their own open lobbies; parties belong to one age group
//   • kids have NO open lobbies: they only party with friends that both kids' parents approved
//   • kids can only type / use voice if a verified parent turned it on (and only then do they receive typed chat)
//   • quick chat (preset phrases) works for approved kids even before the parent is verified; parents can turn it off
const crypto = require('crypto');
const { Server } = require('socket.io');
const db = require('./db');
const auth = require('./auth');
const { moderate, enabled: moderationOn } = require('./moderation');
const quickchat = require('./quickchat');

// never run chat/voice unmoderated on the live site
const SAFETY_OFF = !moderationOn && process.env.NODE_ENV === 'production';
const SAFETY_MSG = 'Chat and voice turn on as soon as safety moderation is set up.';

const OPEN_ROOMS = 4; // per teen/adult group
const VOICE_MAX = 10;
const PARTY_MAX = 4;
const HISTORY = 60;
const GAME_FRESH_MS = 30000;
const MAX_PENDING_REQUESTS = 20;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const openRoomIds = (group) => (group === 'kid' ? [] : Array.from({ length: OPEN_ROOMS }, (_, i) => `open-${group}-${i + 1}`));

function attach(httpServer, { iceServers, admins, notifyParent = async () => {} }) {
  const io = new Server(httpServer, { maxHttpBufferSize: 1e5, cors: { origin: false } });

  const online = new Map(); // userId -> { user, sockets:Set, partyId, roomId, voiceSocket, voiceRoom, game, friendList, requests }
  const parties = new Map(); // partyId -> { id, code, leaderId, members:[uid], ready:Set, ageGroup }
  const partyByCode = new Map();
  const history = new Map(); // roomId -> [msg]
  const transcripts = new Map(); // roomId -> [{name,text,ts}]
  const voiceRooms = new Map(); // roomId -> Map(userId -> socketId)
  const recentByUser = new Map(); // userId -> [{room,name,text,ts}] (report context)
  const rate = new Map();
  const leaveTimers = new Map();

  const group = (o) => auth.ageGroup(o.user);
  const isKid = (o) => group(o) === 'kid';
  const kidApproved = (o) => ['basic', 'verified'].includes(o.user.consent);
  const kidLocked = (o) => isKid(o) && !kidApproved(o);
  const canChat = (o) => !isKid(o) || (o.user.consent === 'verified' && o.user.kidSettings.chat === true);
  const canVoice = (o) => !isKid(o) || (o.user.consent === 'verified' && o.user.kidSettings.voice === true);
  const canQuick = (o) => !isKid(o) || (kidApproved(o) && o.user.kidSettings.quick !== false);
  // what this player may see from a room's chat history
  const visibleHistory = (o, hist) => (canChat(o) ? hist : canQuick(o) ? hist.filter((m) => m.quick) : []);
  const isAdmin = (user) => admins.includes(String(user.email).toLowerCase());
  const isMuted = (user) => Boolean(user.mutedUntil && new Date(user.mutedUntil) > new Date());
  const currentRoom = (o) => (o.partyId ? `party-${o.partyId}` : isKid(o) ? `solo-${o.user.id}` : o.roomId);
  const freshGame = (o) => (o.game && Date.now() - o.game.at < GAME_FRESH_MS ? o.game.status : null);
  const LOCKED_MSG = 'Your account is waiting for a parent to approve it.';

  function roomTitle(roomId) {
    if (roomId.startsWith('party-')) return 'Party';
    if (roomId.startsWith('solo-')) return 'Home';
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
      kind: p ? 'party' : roomId.startsWith('solo-') ? 'solo' : 'open',
      title: roomTitle(roomId),
      members: membersOf(roomId).map(pub),
      party: p ? partyInfo(p) : null,
      voiceCount: (voiceRooms.get(roomId) || new Map()).size,
      voiceMax: VOICE_MAX,
    };
  }

  function meInfo(o) {
    const u = o.user;
    const kid = isKid(o);
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      ageGroup: group(o),
      robloxId: u.robloxId,
      robloxName: u.robloxName,
      blocked: u.blocked,
      mutedUntil: isMuted(u) ? u.mutedUntil : null,
      strikes: u.strikes,
      stats: u.stats,
      isAdmin: isAdmin(u),
      canChat: canChat(o),
      canVoice: canVoice(o),
      canQuick: canQuick(o),
      ...(kid
        ? {
          kid: {
            consent: u.consent,
            locked: kidLocked(o),
            friends: (o.friendList || []).map((f) => ({ ...f, online: Boolean(online.get(f.id)?.sockets.size) })),
            requests: o.requests || [],
          },
        }
        : {}),
    };
  }

  // kids who can't type sit in the "nochat" socket room, which typed-chat broadcasts skip;
  // kids without quick chat also sit in "noquick", which quick-chat broadcasts skip
  function syncChatFlag(o) {
    const chat = canChat(o);
    const quick = canQuick(o);
    for (const s of o.sockets) {
      if (chat) s.leave('nochat');
      else s.join('nochat');
      if (quick) s.leave('noquick');
      else s.join('noquick');
    }
  }

  function pushState(o) {
    const room = currentRoom(o);
    syncChatFlag(o);
    io.to(`u:${o.user.id}`).emit('state', {
      me: meInfo(o),
      room: roomInfo(room),
      history: visibleHistory(o, history.get(room) || []),
      quick: canQuick(o) ? quickchat.PHRASES : [],
      rooms: openRoomIds(group(o)).map((id) => ({ id, title: roomTitle(id), count: membersOf(id).length })),
      iceServers,
    });
  }

  function broadcastRoom(roomId) {
    io.to(`r:${roomId}`).emit('room', roomInfo(roomId));
  }

  function systemMsg(o, text) {
    io.to(`u:${o.user.id}`).emit('chat:system', { text, ts: Date.now() });
  }

  // ---------------------------------------------------------------- kids: friends + requests
  async function loadKidExtras(o) {
    if (!isKid(o)) {
      o.friendList = [];
      o.requests = [];
      return;
    }
    const uid = o.user.id;
    const reqs = await db.listFriendRequestsFor([uid]);
    const ids = [...new Set([...o.user.friends, ...reqs.map((r) => (r.fromId === uid ? r.toId : r.fromId))])];
    const users = ids.length ? await db.findUsersByIds(ids) : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    o.friendList = o.user.friends.filter((id) => names.has(id)).map((id) => ({ id, name: names.get(id) }));
    o.requests = reqs
      .filter((r) => names.has(r.fromId === uid ? r.toId : r.fromId))
      .map((r) => {
        const incoming = r.toId === uid;
        return {
          id: r.id,
          name: names.get(incoming ? r.fromId : r.toId),
          incoming,
          accepted: r.accepted,
          waitingParents: r.accepted && !(r.fromParentOk && r.toParentOk),
        };
      });
  }

  async function refreshUser(uid, { extras = true } = {}) {
    const o = online.get(uid);
    if (!o) return;
    const fresh = await db.findUserById(uid);
    if (!fresh) return;
    o.user = fresh;
    if (extras) await loadKidExtras(o);
    if (o.voiceSocket && !canVoice(o)) leaveVoice(o);
    if (o.partyId && kidLocked(o)) leaveParty(o);
    pushState(o);
    broadcastRoom(currentRoom(o));
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

  // move a user between rooms (open room / home <-> party), keeping sockets + voice consistent
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

  // can `o` be in party `p`? (same age group; for kids, everyone in it must be their approved friend)
  function mayJoin(o, p) {
    if (p.ageGroup !== group(o)) return false;
    if (isKid(o)) return kidApproved(o) && p.members.every((id) => o.user.friends.includes(id));
    return true;
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
    const user = await db.findUserById(uid);
    if (!user) return socket.disconnect(true);
    if (!o) {
      o = { user, sockets: new Set(), partyId: null, roomId: openRoomIds(auth.ageGroup(user))[0] || null, voiceSocket: null, voiceRoom: null, game: null, friendList: [], requests: [] };
      online.set(uid, o);
    } else {
      o.user = user; // a quick reconnect (page reload) still picks up the latest account
    }
    clearTimeout(leaveTimers.get(uid));
    leaveTimers.delete(uid);
    o.sockets.add(socket);
    socket.join(`u:${uid}`);
    socket.join(`r:${currentRoom(o)}`);
    await loadKidExtras(o).catch((err) => console.error('[kids] load', err));
    pushState(o);
    broadcastRoom(currentRoom(o));
    // let a kid's online friends see they came online
    for (const f of o.friendList || []) {
      const fo = online.get(f.id);
      if (fo) pushState(fo);
    }

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
      if (!openRoomIds(group(o)).includes(roomId)) return reply({ ok: false, reason: 'Unknown room' });
      relocate(o, () => {
        o.roomId = roomId;
      });
      reply({ ok: true });
    });

    on('chat:send', async ({ text }, reply) => {
      text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!text) return reply({ ok: false });
      if (SAFETY_OFF) return reply({ ok: false, reason: SAFETY_MSG });
      if (kidLocked(o)) return reply({ ok: false, reason: LOCKED_MSG });
      if (!canChat(o)) return reply({ ok: false, reason: 'Chat is off. A parent can turn it on from the parent page.' });
      const room = currentRoom(o);
      if (room.startsWith('solo-')) return reply({ ok: false, reason: 'Party up with a friend to chat!' });
      if (isMuted(o.user)) return reply({ ok: false, reason: `You're muted until ${new Date(o.user.mutedUntil).toLocaleTimeString()}` });
      if (!rateOk(uid)) return reply({ ok: false, reason: 'Slow down a little!' });
      const hist = history.get(room) || [];
      const verdict = await moderate(text, {
        kind: 'chat',
        author: o.user.name,
        ageGroup: group(o),
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
      io.to(`r:${room}`).except('nochat').emit('chat:msg', msg);
      reply({ ok: true });
    });

    // quick chat: preset phrases only, so no AI check is needed
    on('chat:quick', ({ id }, reply) => {
      const phrase = quickchat.byId.get(String(id || ''));
      if (!phrase) return reply({ ok: false });
      if (kidLocked(o)) return reply({ ok: false, reason: LOCKED_MSG });
      if (!canQuick(o)) return reply({ ok: false, reason: 'Quick chat is off. A parent can turn it on from the parent page.' });
      const room = currentRoom(o);
      if (room.startsWith('solo-')) return reply({ ok: false, reason: 'Party up with a friend to chat!' });
      if (isMuted(o.user)) return reply({ ok: false, reason: `You're muted until ${new Date(o.user.mutedUntil).toLocaleTimeString()}` });
      if (!rateOk(uid)) return reply({ ok: false, reason: 'Slow down a little!' });
      const msg = { id: crypto.randomUUID(), room, from: { id: uid, name: o.user.name, robloxId: o.user.robloxId }, text: phrase.text, quick: true, ts: Date.now() };
      const hist = history.get(room) || [];
      hist.push(msg);
      if (hist.length > HISTORY) hist.shift();
      history.set(room, hist);
      io.to(`r:${room}`).except('noquick').emit('chat:msg', msg);
      reply({ ok: true });
    });

    // ---- parties
    on('party:create', (_, reply) => {
      if (kidLocked(o)) return reply({ ok: false, reason: LOCKED_MSG });
      if (o.partyId) return reply({ ok: false, reason: "You're already in a party" });
      // a party belongs to one age group: kids, teens and adults are never in the same party
      const p = { id: crypto.randomBytes(5).toString('hex'), code: newCode(), leaderId: uid, members: [], ready: new Set(), ageGroup: group(o) };
      parties.set(p.id, p);
      partyByCode.set(p.code, p);
      joinParty(o, p);
      reply({ ok: true, code: p.code });
    });

    on('party:join', ({ code }, reply) => {
      if (kidLocked(o)) return reply({ ok: false, reason: LOCKED_MSG });
      const p = partyByCode.get(String(code || '').toUpperCase().trim());
      // not allowed in: same answer as a wrong code, so nobody can probe who's in a party or how old they are
      if (!p || !mayJoin(o, p)) return reply({ ok: false, reason: 'No party with that code' });
      if (p.members.length >= PARTY_MAX) return reply({ ok: false, reason: 'That party is full' });
      const blockedByMember = p.members.some((id) => (online.get(id)?.user.blocked || []).includes(uid));
      if (blockedByMember) return reply({ ok: false, reason: "You can't join that party" });
      joinParty(o, p);
      reply({ ok: true });
    });

    on('party:invite', ({ name, userId }, reply) => {
      const p = o.partyId && parties.get(o.partyId);
      if (!p) return reply({ ok: false, reason: 'Create a party first' });
      const target = userId
        ? online.get(Number(userId))
        : [...online.values()].find((m) => m.user.name.toLowerCase() === String(name || '').toLowerCase());
      if (isKid(o)) {
        if (!target || !o.user.friends.includes(target.user.id)) return reply({ ok: false, reason: 'You can only invite your friends' });
        if (!target.sockets.size) return reply({ ok: false, reason: 'That friend is not online' });
      }
      if (!target || target === o) return reply({ ok: false, reason: 'That player is not online' });
      // blocked, other age group, or (kids) not allowed: the invite is silently dropped, with no hint why
      if (mayJoin(target, p) && !(target.user.blocked || []).includes(uid) && !(o.user.blocked || []).includes(target.user.id)) {
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

    // ---- kids: friends (both kids' parents must approve before they become friends)
    on('friend:request', async ({ name }, reply) => {
      if (!isKid(o)) return reply({ ok: false, reason: 'Only kids accounts use friend requests' });
      if (kidLocked(o)) return reply({ ok: false, reason: LOCKED_MSG });
      const sent = { ok: true }; // same answer whatever happens, so kids can't be used to probe other players
      const target = await db.findUserByName(String(name || '').trim());
      if (!target || target.id === uid) return reply(sent);
      if (auth.ageGroup(target) !== 'kid' || !['basic', 'verified'].includes(target.consent)) return reply(sent);
      if (o.user.friends.includes(target.id)) return reply(sent);
      if (o.user.blocked.includes(target.id) || target.blocked.includes(uid)) return reply(sent);
      const outgoing = (o.requests || []).filter((r) => !r.incoming && !r.accepted).length;
      if (outgoing >= MAX_PENDING_REQUESTS) return reply({ ok: false, reason: 'You have lots of requests waiting already' });
      const existing = await db.findFriendRequestBetween(uid, target.id);
      if (existing && existing.toId === uid && !existing.accepted) {
        await acceptRequest(existing); // they already asked you: that's a yes from both kids
      } else if (!existing) {
        await db.addFriendRequest(uid, target.id);
        await refreshUser(target.id);
      }
      await refreshUser(uid);
      reply(sent);
    });

    on('friend:respond', async ({ requestId, accept }, reply) => {
      const r = await db.findFriendRequest(Number(requestId));
      if (!r || r.toId !== uid || r.accepted) return reply({ ok: false });
      if (accept) await acceptRequest(r);
      else {
        await db.deleteFriendRequest(r.id);
        await refreshUser(r.fromId);
      }
      await refreshUser(uid);
      reply({ ok: true });
    });

    on('friend:remove', async ({ userId }, reply) => {
      const id = Number(userId);
      if (!isKid(o) || !o.user.friends.includes(id)) return reply({ ok: false });
      await unfriend(uid, id);
      reply({ ok: true });
    });

    // ---- voice (WebRTC mesh; the server only relays signalling)
    on('voice:join', (_, reply) => {
      if (SAFETY_OFF) return reply({ ok: false, reason: SAFETY_MSG });
      if (kidLocked(o)) return reply({ ok: false, reason: LOCKED_MSG });
      if (!canVoice(o)) return reply({ ok: false, reason: 'Voice chat is off. A parent can turn it on from the parent page.' });
      const room = currentRoom(o);
      if (room.startsWith('solo-')) return reply({ ok: false, reason: 'Party up with a friend to use voice!' });
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
      const verdict = await moderate(text, { kind: 'voice', author: o.user.name, ageGroup: group(o), context: ctx });
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
      // a report made by a kid also goes to their parent
      if (isKid(o) && o.user.parentEmail) {
        notifyParent(o.user.parentEmail, `${o.user.name} reported a player`, `${o.user.name} reported ${target.name} on Storm Royale. Our moderators will review it. You can see your child's friends and settings on the parent page.`).catch(() => {});
      }
      reply({ ok: true });
    });

    on('user:block', async ({ userId, block }, reply) => {
      const id = Number(userId);
      if (!id || id === uid) return reply({ ok: false });
      const set = new Set(o.user.blocked || []);
      if (block) set.add(id);
      else set.delete(id);
      o.user = await db.updateUser(uid, { blocked: [...set] });
      if (block && isKid(o) && o.user.friends.includes(id)) await unfriend(uid, id);
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
            for (const f of o.friendList || []) {
              const fo = online.get(f.id);
              if (fo) pushState(fo);
            }
          }, 60000),
        );
      }
      broadcastRoom(currentRoom(o));
    });
  });

  async function acceptRequest(r) {
    const updated = await db.updateFriendRequest(r.id, { accepted: true });
    const [a, b] = await db.findUsersByIds([r.fromId, r.toId]);
    if (a && b) {
      for (const [kid, other] of [[a, b], [b, a]]) {
        if (kid.parentEmail) {
          notifyParent(kid.parentEmail, `${kid.name} has a new friend request`, `${kid.name} and ${other.name} want to be friends on Storm Royale. They can only play together once you and the other player's parent both approve.`).catch(() => {});
        }
      }
    }
    await refreshUser(r.fromId);
    await refreshUser(r.toId);
    return updated;
  }

  async function unfriend(a, b) {
    const [ua, ub] = await db.findUsersByIds([a, b]);
    if (ua) await db.updateUser(a, { friends: ua.friends.filter((x) => x !== b) });
    if (ub) await db.updateUser(b, { friends: ub.friends.filter((x) => x !== a) });
    // leave any shared party: kids' parties are friends-only
    for (const [x, y] of [[a, b], [b, a]]) {
      const ox = online.get(x);
      const oy = online.get(y);
      if (ox && oy && ox.partyId && ox.partyId === oy.partyId) leaveParty(ox);
    }
    await refreshUser(a);
    await refreshUser(b);
  }

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
    refreshUser,
    unfriend,
    disconnectUser(uid) {
      const o = online.get(uid);
      if (!o) return;
      leaveParty(o);
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
        // kids only get the chat they're allowed in the game too (typed, quick-chat only, or none)
        chat: visibleHistory(o, history.get(`party-${p.id}`) || []).slice(-8).map((m) => ({ id: m.id, name: m.from.name, robloxId: m.from.robloxId, text: m.text, ts: m.ts })),
      };
    },
    isOnline: (uid) => Boolean(online.get(uid)?.sockets.size),
    stats() {
      return { online: online.size, parties: parties.size, inVoice: [...voiceRooms.values()].reduce((n, v) => n + v.size, 0) };
    },
  };
}

module.exports = attach;
