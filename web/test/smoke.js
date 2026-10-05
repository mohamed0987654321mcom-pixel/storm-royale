// End-to-end smoke test: real server in-process, fake players over real sockets.
// Run: npm test
const assert = require('node:assert/strict');

process.env.PORT = '4011';
process.env.DEV_SHOW_LINK = '1';
process.env.GAME_API_KEY = 'test-key-123';
process.env.ADMIN_EMAILS = 'admin@test.com';
process.env.JWT_SECRET = 'test-secret';
process.env.KIDS_ENABLED = '1';
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

async function kidSignup(email, name, birthDate, parentEmail) {
  let r = await post('/api/auth/start', { email, name, birthDate });
  assert.equal((await r.json()).needParent, true, 'under-13 asks for a parent email');
  r = await post('/api/auth/start', { email, name, birthDate, parentEmail });
  const data = await r.json();
  assert.ok(data.devLink, `got sign-in link for ${name}: ${JSON.stringify(data)}`);
  const v = await fetch(data.devLink, { redirect: 'manual' });
  return v.headers.get('set-cookie').split(';')[0];
}

async function parentLogin(email) {
  const d = await (await post('/api/parent/start', { email })).json();
  assert.ok(d.devLink, `parent link for ${email}`);
  const v = await fetch(d.devLink, { redirect: 'manual' });
  assert.equal(v.status, 302);
  const cookie = v.headers.get('set-cookie').split(';')[0];
  assert.match(cookie, /^sr_parent=/);
  return cookie;
}
const pget = (path, cookie) => fetch(BASE + path, { headers: { cookie } }).then((r) => r.json());

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
  let under = await post('/api/auth/start', { email: 'kid@test.com', name: 'TinyKid', birthDate: '2016-05-05' });
  assert.equal((await under.json()).needParent, true);
  under = await post('/api/auth/start', { email: 'baby@test.com', name: 'BabyKid', birthDate: '2023-05-05' });
  assert.equal(under.status, 403);
  under = await post('/api/auth/start', { email: 'kid@test.com', name: 'TinyKid', birthDate: '2016-05-05', parentEmail: 'kid@test.com' });
  assert.equal(under.status, 400);
  ok("under-13s need their parent's email (not their own), and must be 6+");
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

  // ================================================================ kids accounts
  const db = require('../lib/db');
  const cK1 = await kidSignup('k1@test.com', 'KidOne', '2016-03-03', 'mom@test.com');
  const cK2 = await kidSignup('k2@test.com', 'KidTwo', '2015-06-06', 'dad@test.com');
  const cK3 = await kidSignup('k3@test.com', 'KidThree', '2016-09-09', 'aunt@test.com');
  const K1 = connect(cK1), K2 = connect(cK2), K3 = connect(cK3);
  await wait(400);
  const s1 = lastState(K1);
  assert.equal(s1.me.ageGroup, 'kid');
  assert.equal(s1.me.kid.locked, true);
  assert.equal(s1.room.kind, 'solo');
  assert.deepEqual(s1.rooms, [], 'kids get no open lobbies');
  assert.equal((await ask(K1, 'party:create')).ok, false);
  assert.equal((await ask(K1, 'chat:send', { text: 'hi' })).ok, false);
  assert.equal((await ask(K1, 'voice:join')).ok, false);
  ok('a new kids account is locked until a parent approves (and has no open lobbies)');

  const mom = await parentLogin('mom@test.com');
  const dad = await parentLogin('dad@test.com');
  const aunt = await parentLogin('aunt@test.com');
  let pm = await pget('/api/parent/me', mom);
  assert.equal(pm.kids.length, 1);
  assert.equal(pm.kids[0].consent, 'pending');
  const k1id = pm.kids[0].id;
  assert.equal((await post('/api/parent/consent', { kidId: k1id, approve: true }, dad)).status, 404, "a parent can't touch another family's child");
  assert.equal((await post('/api/parent/consent', { kidId: k1id, approve: true }, mom)).status, 200);
  const k2id = (await pget('/api/parent/me', dad)).kids[0].id;
  await post('/api/parent/consent', { kidId: k2id, approve: true }, dad);
  const k3id = (await pget('/api/parent/me', aunt)).kids[0].id;
  await post('/api/parent/consent', { kidId: k3id, approve: true }, aunt);
  const nobody = await (await post('/api/parent/start', { email: 'stranger@test.com' })).json();
  assert.equal(nobody.ok, true);
  assert.equal(nobody.devLink, undefined, 'no link for emails without kids (same answer though)');
  await wait(200);
  assert.equal(lastState(K1).me.kid.locked, false);
  ok('parents sign in by email, can only approve their own child, and approval unlocks the account');

  assert.equal((await ask(C, 'friend:request', { name: 'KidOne' })).ok, false, 'adults cannot friend kids');
  assert.equal((await ask(K1, 'friend:request', { name: 'GrownUp' })).ok, true, 'same answer for non-kids');
  await ask(K1, 'friend:request', { name: 'KidTwo' });
  await wait(200);
  const inc = lastState(K2).me.kid.requests.find((r) => r.incoming);
  assert.ok(inc && inc.name === 'KidOne');
  assert.equal(lastState(K1).me.kid.requests.length, 1, 'no request was created for the adult');
  await ask(K2, 'friend:respond', { requestId: inc.id, accept: true });
  await wait(200);
  assert.ok(lastState(K1).me.kid.requests[0].waitingParents);
  pm = await pget('/api/parent/me', mom);
  const reqId = pm.kids[0].requests[0].id;
  await post('/api/parent/request', { requestId: reqId, approve: true }, mom);
  await wait(150);
  assert.equal(lastState(K1).me.kid.friends.length, 0, 'one parent is not enough');
  assert.equal((await post('/api/parent/request', { requestId: reqId, approve: true }, aunt)).status, 404, "an unrelated parent can't approve");
  await post('/api/parent/request', { requestId: reqId, approve: true }, dad);
  await wait(200);
  assert.deepEqual(lastState(K1).me.kid.friends.map((f) => f.name), ['KidTwo']);
  assert.deepEqual(lastState(K2).me.kid.friends.map((f) => f.name), ['KidOne']);
  ok('kids become friends only after both kids and both parents say yes');

  const kp = await ask(K1, 'party:create');
  assert.equal(kp.ok, true);
  assert.equal((await ask(K1, 'party:invite', { name: 'KidThree' })).ok, false, 'kids can only invite friends');
  await ask(K1, 'party:invite', { userId: lastState(K2).me.id });
  await wait(150);
  assert.ok(got(K2, 'party:invite', (m) => m.code === kp.code));
  assert.equal((await ask(K3, 'party:join', { code: kp.code })).ok, false, 'a kid who is not a friend cannot join');
  assert.equal((await ask(C, 'party:join', { code: kp.code })).ok, false, 'an adult cannot join');
  assert.equal((await ask(K2, 'party:join', { code: kp.code })).ok, true);
  ok('kids party only with approved friends; other kids and adults are kept out');

  assert.equal((await ask(K1, 'chat:send', { text: 'gg' })).ok, false);
  assert.equal((await ask(K1, 'voice:join')).ok, false);
  const setRes = await post('/api/parent/settings', { kidId: k1id, chat: true }, mom);
  assert.equal(setRes.status, 403);
  assert.equal((await setRes.json()).needVerify, true);
  assert.equal((await post('/api/parent/verify', { kidId: k1id }, mom)).status, 501);
  await db.updateUser(k1id, { consent: 'verified' }); // stands in for Phase 2 (Epic KWS) verification
  await db.updateUser(k2id, { consent: 'verified' });
  assert.equal((await post('/api/parent/settings', { kidId: k1id, chat: true }, mom)).status, 200);
  await wait(150);
  K2.inbox.length = 0;
  assert.equal((await ask(K1, 'chat:send', { text: 'nice build' })).ok, true);
  await wait(150);
  assert.ok(!got(K2, 'chat:msg'), 'a kid without chat permission receives nothing');
  await post('/api/parent/settings', { kidId: k2id, chat: true }, dad);
  await wait(150);
  await ask(K1, 'chat:send', { text: 'follow me' });
  await wait(150);
  assert.ok(got(K2, 'chat:msg', (m) => m.text === 'follow me'));
  ok('kids chat only after a verified parent turns it on, and only receive chat if allowed');

  await post('/api/parent/settings', { kidId: k1id, chat: false }, mom);
  await wait(150);
  assert.equal((await ask(K1, 'chat:send', { text: 'hello' })).ok, false);
  const gone = new Promise((r) => K3.on('disconnect', r));
  assert.equal((await post('/api/parent/delete', { kidId: k3id }, aunt)).status, 200);
  await gone;
  assert.equal((await pget('/api/parent/me', aunt)).kids.length, 0);
  assert.equal(await db.findUserById(k3id), null);
  ok('parents can switch chat off any time, and deleting the account removes it and kicks the child out');

  console.log(`\nALL ${results.length} CHECKS PASSED`);
  for (const s of [B, C, K1, K2]) s.close();
  process.exit(0);
})().catch((err) => {
  console.error('\nTEST FAILED:', err);
  process.exit(1);
});
