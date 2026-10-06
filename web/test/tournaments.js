// Tournament tests: real server in-process; results arrive the way they really do (the Roblox game
// server with the game API key, the Neoblox server with the MPARADISE key).
// Run: node test/tournaments.js
const assert = require('node:assert/strict');

process.env.PORT = '4012';
process.env.DEV_SHOW_LINK = '1';
process.env.GAME_API_KEY = 'test-key-123';
process.env.MPARADISE_LINK_KEY = 'test-mp-key';
process.env.ADMIN_EMAILS = 'admin@test.com';
process.env.JWT_SECRET = 'test-secret';
process.env.KIDS_ENABLED = '1';
delete process.env.DATABASE_URL;
process.env.ANTHROPIC_API_KEY = 'test-key'; // Claude is faked below
delete process.env.RESEND_API_KEY;

// fake Claude moderator: blocks anything containing BADNAME
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('api.anthropic.com')) {
    const fresh = JSON.parse(opts.body).messages[0].content.split('<<<')[1] || '';
    const v = fresh.includes('BADNAME') ? { allow: false, category: 'other', severity: 1, reason: 'bad name' } : { allow: true, category: 'ok', severity: 0, reason: '' };
    return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(v) }] }), { status: 200 });
  }
  return realFetch(url, opts);
};

require('../server');
const db = require('../lib/db');
const BASE = `http://localhost:${process.env.PORT}`;

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log('  ✓', name);
}

async function call(method, path, { body, cookie, game, mp } = {}) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  if (game) headers['x-api-key'] = game === true ? process.env.GAME_API_KEY : game;
  if (mp) headers['x-mparadise-key'] = mp === true ? process.env.MPARADISE_LINK_KEY : mp;
  const r = await realFetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const data = await r.json().catch(() => null);
  return { status: r.status, data, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}

async function signUp(email, name, birthDate = '2000-01-01') {
  const r = await call('POST', '/api/auth/start', { body: { email, name, birthDate, skip: true } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const user = await db.findUserByName(name);
  return { cookie: r.cookie, user, devLink: r.data.devLink };
}

const robloxMatch = (robloxId, kills, placement, size = 16) =>
  call('POST', '/api/game/match', { game: true, body: { robloxId, kills, placement, size, won: placement === 1 } });
const neobloxRound = (neobloxId, name, kills, placement, size, extra = {}) =>
  call('POST', '/api/mparadise/tournament/result', { mp: true, body: { neobloxId, name, kills, placement, size, won: placement === 1, ...extra } });

(async () => {
  for (let i = 0; i < 50; i++) {
    try { if ((await realFetch(BASE + '/health')).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }

  // Ava: one person with a website account, linked to Roblox (1001) AND to Neoblox (nb-ava)
  const ava = await signUp('ava@test.com', 'AvaStorm');
  await db.updateUser(ava.user.id, { robloxId: 1001, robloxName: 'AvaRbx', neobloxId: 'nb-ava', neobloxUsername: 'AvaNeo' });

  await check('a weekly cup is running automatically', async () => {
    const r = await call('GET', '/api/tournaments');
    assert.equal(r.status, 200);
    assert.ok(r.data.board, 'has a board');
    assert.equal(r.data.board.tournament.name, 'Weekly Storm Cup');
    assert.equal(r.data.board.tournament.active, true);
    assert.ok(r.data.board.scoring.text.includes('best 10'));
  });

  await check('a Roblox match by a linked player counts (kills + placement bonus)', async () => {
    const r = await robloxMatch(1001, 3, 2); // 3 kills + #2 bonus 4 = 7
    assert.equal(r.status, 200);
    assert.equal(r.data.tournament.counted, true);
    assert.equal(r.data.tournament.points, 7);
  });

  await check('a Neoblox round by the same (linked) person adds into ONE entry', async () => {
    const r = await neobloxRound('nb-ava', 'AvaNeo', 5, 1, 4); // 5 + #1 bonus 5 + win 10 = 20
    assert.equal(r.data.counted, true);
    assert.equal(r.data.points, 20);
    const b = (await call('GET', '/api/tournaments', { cookie: ava.cookie })).data.board;
    const me = b.players.find((p) => p.name === 'AvaStorm');
    assert.equal(me.score, 27);
    assert.deepEqual(me.surfaces, ['neoblox', 'roblox']);
    assert.equal(b.you.rank, 1);
    assert.equal(b.you.score, 27);
    assert.equal(b.players.filter((p) => p.name === 'AvaStorm').length, 1);
  });

  await check('small matches score eliminations only (bonuses need 4+ players)', async () => {
    const r = await neobloxRound('nb-ben', 'BenNeo', 2, 1, 2); // just 2
    assert.equal(r.data.points, 2);
  });

  await check('unlinked Neoblox players compete under their (moderated) name', async () => {
    await neobloxRound('nb-bad', 'BADNAME99', 1, 3, 3);
    const b = (await call('GET', '/api/tournaments')).data.board;
    assert.ok(b.players.some((p) => p.name === 'BenNeo'));
    assert.ok(b.players.some((p) => p.name === 'Neoblox player'), 'blocked name is hidden');
    assert.ok(!b.players.some((p) => p.name === 'BADNAME99'));
  });

  await check('only your best 10 matches count', async () => {
    for (let k = 1; k <= 12; k++) await neobloxRound('nb-cal', 'CalNeo', k, 6, 8); // points = k (no placement bonus at #6)
    const b = (await call('GET', '/api/tournaments')).data.board;
    const cal = b.players.find((p) => p.name === 'CalNeo');
    assert.equal(cal.score, 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10 + 11 + 12);
    assert.equal(cal.matches, 12);
  });

  await check('unlinked Roblox players and kid accounts never reach the board', async () => {
    assert.equal((await robloxMatch(2002, 9, 1)).data.ok, false); // not linked
    const kid = await db.createUser({ email: 'kid@test.com', name: 'KidPlayer', birthDate: '2017-01-01', parentEmail: 'mom@test.com', consent: 'verified' });
    await db.updateUser(kid.id, { robloxId: 3003, neobloxId: 'nb-kid' });
    const r1 = await robloxMatch(3003, 9, 1);
    assert.equal(r1.data.tournament.counted, false);
    const r2 = await neobloxRound('nb-kid', 'KidNeo', 9, 1, 6);
    assert.equal(r2.data.counted, false);
    const r3 = await neobloxRound('nb-other-kid', 'Kiddo', 9, 1, 6, { restricted: { isKid: true } });
    assert.equal(r3.data.counted, false);
    const b = (await call('GET', '/api/tournaments')).data.board;
    assert.ok(!b.players.some((p) => ['KidPlayer', 'KidNeo', 'Kiddo'].includes(p.name)));
  });

  await check('no account ids leak in the public board', async () => {
    const b = (await call('GET', '/api/tournaments')).data.board;
    const text = JSON.stringify(b);
    assert.ok(!/storm:|neoblox:|roblox:/.test(text));
  });

  await check('a cross-play squad scores as a team, marked cross-platform', async () => {
    // Ava (on Roblox) makes a squad; Dee (on Neoblox) joins it
    const made = await call('POST', '/api/game/crossplay/create', { game: true, body: { robloxId: 1001, name: 'AvaRbx' } });
    assert.equal(made.status, 200);
    const join = await call('POST', '/api/mparadise/party/join', { mp: true, body: { neobloxId: 'nb-dee', name: 'DeeNeo', code: made.data.code } });
    assert.equal(join.status, 200);
    await robloxMatch(1001, 4, 1); // 4 + 5 + 10 = 19
    await neobloxRound('nb-dee', 'DeeNeo', 6, 2, 5); // 6 + 4 = 10
    const b = (await call('GET', '/api/tournaments')).data.board;
    const team = b.teams.find((t) => t.members.includes('AvaStorm') && t.members.includes('DeeNeo'));
    assert.ok(team, 'team on the board');
    assert.equal(team.score, 29);
    assert.equal(team.crossPlatform, true);
  });

  await check('a solo squad (1 member) does not make a team', async () => {
    await call('POST', '/api/mparadise/party/create', { mp: true, body: { neobloxId: 'nb-solo', name: 'SoloNeo' } });
    await neobloxRound('nb-solo', 'SoloNeo', 1, 4, 5);
    const b = (await call('GET', '/api/tournaments')).data.board;
    assert.ok(!b.teams.some((t) => t.members.includes('SoloNeo')));
  });

  await check('the game and Neoblox can read the board (with "you")', async () => {
    const g = await call('POST', '/api/game/tournament', { game: true, body: { robloxId: 1001 } });
    assert.equal(g.data.board.you.name, 'AvaStorm');
    const n = await call('POST', '/api/mparadise/tournament', { mp: true, body: { neobloxId: 'nb-dee' } });
    assert.equal(n.data.board.you.name, 'DeeNeo');
    const unlinked = await call('POST', '/api/game/tournament', { game: true, body: { robloxId: 2002 } });
    assert.equal(unlinked.data.board.you, null);
    assert.equal(unlinked.data.board.canCompete, false);
  });

  await check('results need the right server key', async () => {
    assert.equal((await call('POST', '/api/mparadise/tournament/result', { mp: 'nope', body: { neobloxId: 'x', kills: 9 } })).status, 401);
    assert.equal((await call('POST', '/api/game/tournament', { body: { robloxId: 1 } })).status, 401);
    assert.equal((await call('POST', '/api/game/match', { game: 'nope', body: { robloxId: 1001, kills: 9, placement: 1 } })).status, 401);
  });

  await check('admins run special events; results count in every running tournament', async () => {
    const admin = await signUp('admin@test.com', 'TheAdmin');
    const v = await realFetch(admin.devLink, { redirect: 'manual' }); // confirm the email (admins need a confirmed one)
    const adminCookie = (v.headers.get('set-cookie') || '').split(';')[0];
    assert.equal((await call('POST', '/api/admin/tournaments', { cookie: ava.cookie, body: { name: 'Nope' } })).status, 403);
    const bad = await call('POST', '/api/admin/tournaments', { cookie: adminCookie, body: { name: 'Bad', startsAt: '2030-01-02', endsAt: '2030-01-01' } });
    assert.equal(bad.status, 400);
    const now = Date.now();
    const made = await call('POST', '/api/admin/tournaments', { cookie: adminCookie, body: { name: 'Friday Night Cup', startsAt: new Date(now - 60e3).toISOString(), endsAt: new Date(now + 3600e3).toISOString() } });
    assert.equal(made.status, 200, JSON.stringify(made.data));
    const cur = (await call('GET', '/api/tournaments')).data;
    assert.equal(cur.tournaments[0].name, 'Friday Night Cup', 'running special events come first');
    assert.equal(cur.board.tournament.name, 'Friday Night Cup');
    const r = await robloxMatch(1001, 2, 3); // 2 + 3 = 5, into both
    assert.equal(r.data.tournament.tournaments.length, 2);
    const special = (await call('GET', `/api/tournaments/${made.data.tournament.id}`)).data;
    assert.equal(special.players[0].name, 'AvaStorm');
    assert.equal(special.players[0].score, 5);
    const weeklyId = cur.tournaments.find((t) => t.weekly).id;
    assert.equal((await call('POST', `/api/admin/tournaments/${weeklyId}/delete`, { cookie: adminCookie })).status, 400);
    assert.equal((await call('POST', `/api/admin/tournaments/${made.data.tournament.id}/delete`, { cookie: adminCookie })).status, 200);
    assert.equal((await call('GET', `/api/tournaments/${made.data.tournament.id}`)).status, 404);
  });

  console.log(`\nALL ${passed} TOURNAMENT CHECKS PASSED`);
  process.exit(0);
})().catch((err) => {
  console.error('\nFAILED:', err);
  process.exit(1);
});
