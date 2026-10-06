// Cross-play squads: one party whose members can be on ANY surface at once —
//   • storm:<userId>    a Storm Royale website player (cookie session)
//   • roblox:<robloxId> a player inside the Roblox game (via the game API heartbeat)
//   • neoblox:<id>      a Neoblox player (via the MPARADISE server-to-server link)
//
// A web player and a Roblox player can't be in the SAME live match (Roblox won't let an
// outside client into its servers), so a squad does the next best thing: chat together,
// see each other's live status, ready up, and get a synced "launch" signal — then each
// plays the match on their own platform and the squad shows everyone's results side by side.
//
// This is the hub for all three surfaces because Storm Royale's web server is the only one
// every surface already talks to, and it already has the AI chat moderation. Everything here
// is in memory and live-only, exactly like realtime.js's own parties.
//
// Safety: squads are code-joined, i.e. a stranger-contact channel. Storm Royale deliberately
// gives under-13s NO open/stranger lobbies (friends-only, parent-approved), so KID accounts
// are kept out of cross-play squads entirely (create + join both refuse). Everyone else's chat
// still goes through the same AI moderation as the rest of the site, and chat shown inside the
// Roblox client is additionally run through Roblox's own TextService per viewer (see WebLink).

const crypto = require('crypto');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SQUAD_MAX = 6; // a bit bigger than a same-platform party: it spans games
const CHAT_KEEP = 40;
const STALE_MS = 45000; // a member unseen this long (missed heartbeats) is dropped
const LAUNCH_MS = 90000; // how long a "launch!" banner stays live before it clears on its own
const SURFACES = new Set(['storm', 'roblox', 'neoblox']);

// `moderate` is injected (Storm Royale's lib/moderation.moderate). `safetyOff` mirrors
// realtime.js: never run chat unmoderated on the live site.
module.exports = function makeCrossplay({ moderate, safetyOff = false } = {}) {
  const squads = new Map(); // id -> squad
  const byCode = new Map(); // CODE -> squad
  const memberSquad = new Map(); // memberKey -> squadId
  const chatTimes = new Map(); // memberKey -> [timestamps] (chat rate limit)

  const msgId = () => crypto.randomBytes(6).toString('hex');
  // System lines carry structured fields (event/who/whoKey) besides the ready-made text, so a
  // client that has to re-filter names (the Roblox game: TextService per viewer) can rebuild the
  // line from a filtered name instead of showing the raw one.
  function systemLine(squad, event, m) {
    const text =
      event === 'join' ? `${m.name} joined the squad`
        : event === 'leave' ? `${m.name} left the squad`
          : `\uD83D\uDE80 ${m.name} launched the squad \u2014 jump into a match!`;
    squad.chat.push({ id: msgId(), system: true, event, who: m.name, whoKey: m.key, text, ts: Date.now() });
    if (squad.chat.length > CHAT_KEEP) squad.chat.shift();
  }

  function chatRateOk(key) {
    const now = Date.now();
    const list = (chatTimes.get(key) || []).filter((t) => now - t < 10000);
    if (list.length >= 5) return false;
    list.push(now);
    chatTimes.set(key, list);
    return true;
  }

  function newCode() {
    let code;
    do {
      code = Array.from(crypto.randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
    } while (byCode.has(code));
    return code;
  }

  // Build a member record from a caller-supplied identity. `restricted` carries the kid-safety
  // flags we already propagate over MPARADISE ({ isKid, allowChat, ... }); absent = not a kid.
  function normMember(m) {
    const surface = SURFACES.has(m.surface) ? m.surface : 'neoblox';
    const id = String(m.id || '').slice(0, 64);
    return {
      key: `${surface}:${id}`,
      surface,
      id,
      name: String(m.name || 'Player').slice(0, 24) || 'Player',
      restricted: m.restricted || null,
      status: 'In lobby',
      ready: false,
      result: null,
      lastSeen: Date.now(),
    };
  }

  const isKid = (m) => Boolean(m.restricted && m.restricted.isKid);
  const canChat = (m) => !m.restricted || m.restricted.allowChat !== false;

  function squadOf(key) {
    const id = memberSquad.get(key);
    return id ? squads.get(id) || null : null;
  }

  function dropMember(squad, key) {
    squad.members.delete(key);
    memberSquad.delete(key);
    if (!squad.members.size) {
      squads.delete(squad.id);
      byCode.delete(squad.code);
      return;
    }
    if (squad.leaderKey === key) squad.leaderKey = squad.members.keys().next().value;
  }

  // Drop members who've stopped checking in (closed the tab, left the game, lost the network).
  function sweep() {
    const now = Date.now();
    for (const squad of [...squads.values()]) {
      for (const [key, m] of [...squad.members]) {
        if (now - m.lastSeen > STALE_MS) dropMember(squad, key);
      }
    }
  }
  setInterval(sweep, 15000).unref();

  // A squad member record seen by everyone (no internal fields leaked).
  function viewMember(squad, m) {
    return {
      key: m.key,
      surface: m.surface,
      name: m.name,
      status: m.status,
      ready: m.ready,
      leader: squad.leaderKey === m.key,
      result: m.result,
    };
  }

  function launchActive(squad) {
    return squad.launch && Date.now() - squad.launch.at < LAUNCH_MS ? { at: squad.launch.at, by: squad.launch.by } : null;
  }

  // The full squad view for one member (what their client renders). `key` = who's asking.
  function view(squad, key) {
    const members = [...squad.members.values()].map((m) => ({ ...viewMember(squad, m), isYou: m.key === key }));
    const results = members.filter((m) => m.result).map((m) => ({ name: m.name, surface: m.surface, ...m.result }));
    return {
      inSquad: true,
      code: squad.code,
      max: SQUAD_MAX,
      youAre: key,
      isLeader: squad.leaderKey === key,
      members,
      chat: squad.chat.slice(-20),
      launch: launchActive(squad),
      results,
    };
  }

  // Touch presence on every poll/heartbeat; also refresh name/restricted if the caller sent them.
  function touch(key, patch) {
    const squad = squadOf(key);
    if (!squad) return null;
    const m = squad.members.get(key);
    if (!m) return null;
    m.lastSeen = Date.now();
    if (patch) {
      if (patch.name) m.name = String(patch.name).slice(0, 24) || m.name;
      if (patch.restricted) m.restricted = patch.restricted;
      if (typeof patch.status === 'string') m.status = patch.status.slice(0, 40);
    }
    return { squad, m };
  }

  return {
    SQUAD_MAX,

    // Is this member currently in a squad? (used to decide whether to relay match results)
    inSquad: (key) => Boolean(squadOf(key)),

    create(identity) {
      const m = normMember(identity);
      if (isKid(m)) return { error: 'Squads aren’t available for kid accounts.', kid: true };
      // leaving any existing squad first keeps a member in exactly one squad at a time
      this.leave(m.key);
      const squad = { id: crypto.randomBytes(5).toString('hex'), code: newCode(), createdAt: Date.now(), leaderKey: m.key, members: new Map([[m.key, m]]), chat: [], launch: null };
      squads.set(squad.id, squad);
      byCode.set(squad.code, squad);
      memberSquad.set(m.key, squad.id);
      return { ok: true, code: squad.code, squad: view(squad, m.key) };
    },

    join(code, identity) {
      const m = normMember(identity);
      if (isKid(m)) return { error: 'Squads aren’t available for kid accounts.', kid: true };
      const squad = byCode.get(String(code || '').toUpperCase().trim());
      if (!squad) return { error: 'No squad with that code.' };
      if (squad.members.size >= SQUAD_MAX && !squad.members.has(m.key)) return { error: 'That squad is full.' };
      if (!squad.members.has(m.key)) {
        this.leave(m.key);
        squad.members.set(m.key, m);
        memberSquad.set(m.key, squad.id);
        systemLine(squad, 'join', m);
      } else {
        // rejoin (e.g. reconnected) just refreshes presence
        const ex = squad.members.get(m.key);
        ex.lastSeen = Date.now();
        ex.name = m.name;
      }
      return { ok: true, code: squad.code, squad: view(squad, m.key) };
    },

    leave(key) {
      const squad = squadOf(key);
      if (!squad) return { ok: true };
      const m = squad.members.get(key);
      dropMember(squad, key);
      chatTimes.delete(key);
      if (m && squads.has(squad.id)) systemLine(squad, 'leave', m);
      return { ok: true };
    },

    setReady(key, ready) {
      const t = touch(key);
      if (!t) return { error: 'You’re not in a squad.' };
      t.m.ready = Boolean(ready);
      return { ok: true, squad: view(t.squad, key) };
    },

    setStatus(key, status) {
      const t = touch(key, { status: String(status || '') });
      if (!t) return { error: 'You’re not in a squad.' };
      return { ok: true };
    },

    // Leader starts a synced launch: everyone sees "jump into a match now" at once. Clears any
    // previous round's results so the new round starts clean.
    launch(key) {
      const t = touch(key);
      if (!t) return { error: 'You’re not in a squad.' };
      if (t.squad.leaderKey !== key) return { error: 'Only the squad leader can launch.' };
      t.squad.launch = { at: Date.now(), by: t.m.name };
      for (const m of t.squad.members.values()) {
        m.result = null;
        m.ready = false;
      }
      systemLine(t.squad, 'launch', t.m);
      return { ok: true, squad: view(t.squad, key) };
    },

    // A member finished a match on their platform — show it in the squad results.
    reportResult(key, result) {
      const t = touch(key);
      if (!t) return { error: 'You’re not in a squad.' };
      const kills = Math.max(0, Math.min(100, Math.floor(Number(result?.kills) || 0)));
      const placement = Math.max(1, Math.min(100, Math.floor(Number(result?.placement) || 100)));
      const won = result?.won === true || placement === 1;
      t.m.result = { kills, placement, won };
      t.m.status = won ? '🏆 Won!' : `#${placement}`;
      return { ok: true, squad: view(t.squad, key) };
    },

    async chat(key, text, { ageGroup = 'teen' } = {}) {
      const t = touch(key);
      if (!t) return { error: 'You’re not in a squad.' };
      if (!canChat(t.m)) return { error: 'Chat is off for this account.' };
      if (safetyOff) return { error: 'Chat turns on as soon as safety moderation is set up.' };
      text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!text) return { error: 'Say something!' };
      if (!chatRateOk(key)) return { error: 'Slow down a little!' };
      const ctx = t.squad.chat.filter((c) => !c.system).slice(-6).map((c) => ({ name: c.name, text: c.text }));
      let verdict = { allow: true };
      try {
        verdict = await moderate(text, { kind: 'chat', author: t.m.name, ageGroup, context: ctx });
      } catch (err) {
        return { error: 'Couldn’t check that message, try again.' };
      }
      if (!verdict.allow) return { error: verdict.reason || 'That message was blocked.', blocked: true };
      const msg = { id: msgId(), key: t.m.key, name: t.m.name, surface: t.m.surface, text, ts: Date.now() };
      t.squad.chat.push(msg);
      if (t.squad.chat.length > CHAT_KEEP) t.squad.chat.shift();
      return { ok: true, msg, squad: view(t.squad, key) };
    },

    // Poll/heartbeat: refresh presence and return the current squad view (or {inSquad:false}).
    state(key, patch) {
      const t = touch(key, patch);
      if (!t) return { inSquad: false };
      return view(t.squad, key);
    },

    stats() {
      return { squads: squads.size, squadMembers: memberSquad.size };
    },
  };
};
