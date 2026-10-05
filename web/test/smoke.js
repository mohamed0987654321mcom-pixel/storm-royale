// End-to-end smoke test: real server in-process, fake players over real sockets.
// Run: npm test
const assert = require('node:assert/strict');

process.env.PORT = '4011';
process.env.DEV_SHOW_LINK = '1';
process.env.GAME_API_KEY = 'test-key-123';
process.env.ADMIN_EMAILS = 'admin@test.com';
process.env.JWT_SECRET = 'test-secret';
delete process.env.DATABASE_URL;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.RESEND_API_KEY;

// fake Roblox's public API so account linking can be tested offline
let robloxBio = '';
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('users.roblox.com/v1/usernames/users')) return new Response(JSON.stringify({ data: [{ id: 111, name: 'RobloxAce' }] }), { status: 200 });
  if (u.includes('users.roblox.com/v1/users/111')) return new Response(JSON.stringify({ id: 111, description: robloxBio }), { status: 200 });
  return realFetch(url, opts);
};

const { io } = require('socket.io-client');
require('../server.js');

const BASE = 'http://localhost:4011';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (path, body, cookie, headers = {}) =>
  fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, body: JSON.stringify(body || {}) });

async function signup(email, name, birthDate) {
  let r = await post('/api/auth/start', { email });
  assert.equal((await r.json()).needSignup, true, 'new email asks for sign-up');
  r = await post('/api/auth/start', { email, name, birthDate });
  const data = await r.json();
  assert.ok(data.devLink, `got sign-in link for ${name}: ${JSON.stringify(data)}`);
  const v = await fetch(data.devLink, { redirect: 'manual' });
  assert.equal(v.status, 302);
  const cookie = v.headers.get('set-cookie').split(';')[0];
  assert.match(cookie, /^sr_session=/);
  return cookie;
}

function connect(cookie) {
  const s = io(BASE, { extraHeaders: { cookie }, transports: ['websocket'], forceNew: true });
  s.inbox = [];
  s.onAny((ev, data) => s.inbox.push({ ev, data }));
  return s;
}
const lastState = (s) => [...s.inbox].reverse().find((m) => m.ev === 'state')?.data;
const got = (s, ev, pred = () => true) => s.inbox.some((m) => m.ev === ev && pred(m.data));
const ask = (s, ev, payload) => new Promise((res) => s.emit(ev, payload || {}, res));

(async () => {
  await wait(600);
  const results = [];
  const ok = (name) => { results.push(name); console.log('  ✓', name); };

  // --- sign up
  const under = await post('/api/auth/start', { email: 'kid@test.com', name: 'TinyKid', birthDate: '2018-05-05' });
  assert.equal(under.status, 403);
  ok('under-13 sign-up is refused');
  const bad = await post('/api/auth/start', { email: 'x@test.com', name: 'bad name!', birthDate: '2008-01-01' });
  assert.equal(bad.status, 400);
  ok('invalid display names are refused');
  const cA = await signup('a@test.com', 'AceTeen', '2010-03-01');
  const cB = await signup('b@test.com', 'BuddyTeen', '2009-07-15');
  const cC = await signup('c@test.com', 'GrownUp', '1990-01-01');
  const cAdmin = await signup('admin@test.com', 'StormAdmin', '1995-01-01');
  const dup = await post('/api/auth/start', { email: 'z@test.com', name: 'aceteen', birthDate: '2008-01-01' });
  assert.equal(dup.status, 409);
  ok('sign-up via email magic link works; names are unique (case-insensitive)');
  const me = await (await fetch(BASE + '/api/me', { headers: { cookie: cA } })).json();
  assert.equal(me.name, 'AceTeen');
  assert.equal(me.ageGroup, 'teen');
  ok('/api/me returns the signed-in player');

  // --- sockets + room separation
  const A = connect(cA), B = connect(cB), C = connect(cC);
  await wait(400);
  assert.equal(lastState(A).room.id, 'open-teen-1');
  assert.equal(lastState(B).room.id, 'open-teen-1');
  assert.equal(lastState(C).room.id, 'open-adult-1');
  ok('teens and adults land in separate open lobbies');
  const unauth = io(BASE, { transports: ['websocket'], forceNew: true });
  const unauthErr = await new Promise((r) => unauth.on('connect_error', (e) => r(e.message)));
  assert.equal(unauthErr, 'unauthorized');
  unauth.close();
  ok('sockets without a session are rejected');

  // --- chat + local moderation
  let r = await ask(A, 'chat:send', { text: 'hey everyone gg' });
  assert.equal(r.ok, true);
  await wait(150);
  assert.ok(got(B, 'chat:msg', (m) => m.text === 'hey everyone gg'));
  assert.ok(!got(C, 'chat:msg', (m) => m.text === 'hey everyone gg'));
  ok('lobby chat reaches the same room only');
  r = await ask(A, 'chat:send', { text: 'text me 555 123 4567' });
  assert.equal(r.ok, false);
  await wait(150);
  assert.ok(!got(B, 'chat:msg', (m) => m.text.includes('555')));
  assert.ok(got(A, 'chat:system', (m) => /blocked/i.test(m.text)));
  r = await ask(A, 'chat:send', { text: 'join my discord.gg/abc' });
  assert.equal(r.ok, false);
  r = await ask(A, 'chat:send', { text: 'I did 200 damage in 30 seconds lol' });
  assert.equal(r.ok, true);
  ok('phone numbers / links are blocked; normal numbers are fine');

  // --- parties
  r = await ask(A, 'party:create');
  assert.equal(r.ok, true);
  const code = r.code;
  r = await ask(B, 'party:join', { code: code.toLowerCase() });
  assert.equal(r.ok, true);
  await wait(200);
  const roomA = lastState(A).room;
  assert.equal(roomA.kind, 'party');
  const partyNow = [...A.inbox].reverse().find((m) => m.ev === 'room')?.data.party || roomA.party;
  assert.equal(partyNow.members.length, 2);
  r = await ask(C, 'party:join', { code: 'NOPE00' });
  assert.equal(r.ok, false);
  await ask(B, 'chat:send', { text: 'party chat secret plan' });
  await wait(150);
  assert.ok(got(A, 'chat:msg', (m) => m.text === 'party chat secret plan'));
  assert.ok(!got(C, 'chat:msg', (m) => m.text === 'party chat secret plan'));
  ok('create party, join by code (case-insensitive), private party chat');

  // --- age separation: an adult can't join or be invited into a teen party (and can't tell why)
  const wrongCode = await ask(C, 'party:join', { code: 'NOPE00' });
  r = await ask(C, 'party:join', { code });
  assert.equal(r.ok, false);
  assert.equal(r.reason, wrongCode.reason, 'adult sees the same answer as a wrong code');
  r = await ask(A, 'party:invite', { name: 'GrownUp' });
  assert.equal(r.ok, true, 'inviter gets no hint about the other player');
  await wait(150);
  assert.ok(!got(C, 'party:invite'), 'adult never receives a teen party invite');
  r = await ask(C, 'party:create');
  const adultCode = r.code;
  r = await ask(C, 'party:invite', { name: 'BuddyTeen' });
  await wait(150);
  assert.ok(!got(B, 'party:invite'), 'teen never receives an adult party invite');
  assert.equal((await ask(B, 'party:join', { code: adultCode })).ok, false, 'teen cannot join an adult party');
  await ask(C, 'party:leave');
  ok('teens and adults can never be in the same party (no age hints leaked)');
  r = await ask(A, 'party:ready', { ready: true });
  assert.equal(r.ok, true);
  r = await ask(B, 'room:join', { roomId: 'open-teen-2' });
  assert.equal(r.ok, false);
  ok('ready toggle works; you must leave the party to switch lobby');

  // --- voice signalling
  const vA = await ask(A, 'voice:join');
  assert.equal(vA.ok, true);
  assert.deepEqual(vA.peers, []);
  const vB = await ask(B, 'voice:join');
  assert.equal(vB.peers.length, 1);
  B.emit('voice:signal', { to: vB.peers[0], data: { sdp: { type: 'offer', sdp: 'fake' } } });
  await wait(150);
  assert.ok(got(A, 'voice:signal', (m) => m.data.sdp.type === 'offer'));
  C.emit('voice:signal', { to: vB.peers[0], data: { sdp: { type: 'offer', sdp: 'evil' } } });
  await wait(150);
  assert.ok(!got(A, 'voice:signal', (m) => m.data.sdp.sdp === 'evil'));
  ok('voice signalling relays inside the room and ignores outsiders');

  // --- Roblox link (profile-code verification)
  r = await post('/api/roblox/start', { username: 'RobloxAce' }, cA);
  const link = await r.json();
  assert.match(link.code, /^storm-[0-9a-f]{6}$/);
  r = await post('/api/roblox/verify', {}, cA);
  assert.equal(r.status, 400);
  robloxBio = `I love Storm Royale ${link.code}`;
  r = await post('/api/roblox/verify', {}, cA);
  assert.equal((await r.json()).robloxName, 'RobloxAce');
  ok('Roblox linking needs the code in the profile About');

  // --- game API
  r = await post('/api/game/sync', { players: [{ robloxId: 111, status: 'In match' }] }, null, { 'x-api-key': 'wrong' });
  assert.equal(r.status, 401);
  r = await post('/api/game/sync', { players: [{ robloxId: 111, status: 'In match' }, { robloxId: 999, status: 'Lobby' }] }, null, { 'x-api-key': 'test-key-123' });
  const sync = await r.json();
  assert.equal(sync.players['111'].name, 'AceTeen');
  assert.equal(sync.players['111'].party.members.length, 2);
  assert.ok(sync.players['111'].chat.some((m) => m.text === 'party chat secret plan'));
  assert.equal(sync.players['999'], undefined);
  await wait(150);
  assert.ok(got(B, 'room', (room) => room.party && room.party.members.some((m) => m.game === 'In match')));
  r = await post('/api/game/match', { robloxId: 111, kills: 7, placement: 1, won: true }, null, { 'x-api-key': 'test-key-123' });
  assert.equal((await r.json()).ok, true);
  await wait(150);
  assert.equal(lastState(A).me.stats.wins, 1);
  assert.equal(lastState(A).me.stats.kills, 7);
  ok('game API: key required, party + chat for linked players, presence + match stats');

  // --- blocks, reports, admin, bans
  r = await ask(B, 'user:block', { userId: lastState(C).me.id, block: true });
  assert.equal(r.ok, true);
  assert.equal(lastState(B).me.blocked.length, 1);
  r = await ask(B, 'user:report', { userId: lastState(A).me.id, reason: 'testing reports' });
  assert.equal(r.ok, true);
  r = await fetch(BASE + '/api/admin/reports', { headers: { cookie: cA } });
  assert.equal(r.status, 403);
  r = await fetch(BASE + '/api/admin/reports', { headers: { cookie: cAdmin } });
  const reps = (await r.json()).reports;
  const rep = reps.find((x) => x.reason === 'testing reports');
  assert.ok(rep && rep.targetName === 'AceTeen' && rep.context.length > 0);
  const disc = new Promise((res) => A.on('disconnect', res));
  r = await post(`/api/admin/reports/${rep.id}`, { action: 'ban', hours: 24, targetId: rep.targetId }, cAdmin);
  assert.equal(r.status, 200);
  await disc;
  const A2 = io(BASE, { extraHeaders: { cookie: cA }, transports: ['websocket'], forceNew: true });
  const banErr = await new Promise((res) => A2.on('connect_error', (e) => res(e.message)));
  assert.equal(banErr, 'banned');
  A2.close();
  ok('block, report with context, admin-only review, ban kicks + blocks reconnect');

  // --- moderation reply parsing
  const { parseVerdict } = require('../lib/moderation');
  assert.deepEqual(parseVerdict('{"allow": false, "category": "grooming", "severity": 3, "reason": "asks for age"}'), { allow: false, category: 'grooming', severity: 3, reason: 'asks for age' });
  assert.equal(parseVerdict('sure! {"allow": true, "category":"ok","severity":0,"reason":""}').allow, true);
  assert.equal(parseVerdict('no json here'), null);
  ok('Claude moderation replies are parsed safely');

  console.log(`\nALL ${results.length} CHECKS PASSED`);
  for (const s of [B, C]) s.close();
  process.exit(0);
})().catch((err) => {
  console.error('\nTEST FAILED:', err);
  process.exit(1);
});
