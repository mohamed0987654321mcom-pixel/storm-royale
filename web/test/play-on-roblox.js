// "Play on Roblox" tests: a Neoblox player opens Storm Royale on Roblox wearing their Neoblox look and
// lands in their squad; squads know where their Roblox players are. Real server in-process.
// Run: node test/play-on-roblox.js
const assert = require('node:assert/strict');

process.env.PORT = '4013';
process.env.GAME_API_KEY = 'test-key-123';
process.env.MPARADISE_LINK_KEY = 'test-mp-key';
process.env.JWT_SECRET = 'test-secret';
delete process.env.DATABASE_URL;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.RESEND_API_KEY;
delete process.env.ROBLOX_PLACE_ID;

require('../server');
const db = require('../lib/db');
const BASE = `http://localhost:${process.env.PORT}`;
const PLACE = 4483381587;
const JOB_A = '1a2b3c4d-0000-4000-8000-00000000000a';
const JOB_B = '1a2b3c4d-0000-4000-8000-00000000000b';

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log('  ✓', name);
}
async function call(path, body, { game, mp } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (game) headers['x-api-key'] = process.env.GAME_API_KEY;
  if (mp) headers['x-mparadise-key'] = mp === true ? process.env.MPARADISE_LINK_KEY : mp;
  const r = await fetch(BASE + path, { method: 'POST', headers, body: JSON.stringify(body || {}) });
  return { status: r.status, data: await r.json().catch(() => null) };
}
const NEO_LOOK = { skin: '#c68642', shirt: '#ff5c72', pants: '#0a0d18' };

(async () => {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + '/health')).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const user = await db.createUser({ email: 'zed@test.com', name: 'ZedStorm', birthDate: '2000-01-01' });

  await check('not linked to Storm Royale: told to link first', async () => {
    const r = await call('/api/mparadise/play', { neobloxId: 'nb-zed', look: NEO_LOOK }, { mp: true });
    assert.equal(r.status, 400);
    assert.equal(r.data.code, 'not_linked');
  });

  await db.updateUser(user.id, { neobloxId: 'nb-zed', neobloxUsername: 'ZedNeo' });
  await check('linked to Storm Royale but not Roblox: told to link Roblox', async () => {
    const r = await call('/api/mparadise/play', { neobloxId: 'nb-zed', look: NEO_LOOK }, { mp: true });
    assert.equal(r.status, 400);
    assert.equal(r.data.code, 'no_roblox');
  });

  await db.updateUser(user.id, { robloxId: 9001, robloxName: 'ZedRbx' });
  await check('before the game has ever reported in, there is no place to open yet', async () => {
    const r = await call('/api/mparadise/play', { neobloxId: 'nb-zed' }, { mp: true });
    assert.equal(r.status, 503);
    assert.equal(r.data.code, 'no_place');
  });

  await check('the game teaches the hub its place id on its heartbeat (and it is saved)', async () => {
    const r = await call('/api/game/sync', { placeId: PLACE, players: [] }, { game: true });
    assert.equal(r.status, 200);
    assert.equal(await db.getSetting('robloxPlaceId'), String(PLACE));
  });

  await check('play link + the Neoblox look goes on (blocky, colors on the right parts)', async () => {
    const before = (await db.findUserById(user.id)).lookVer || 0;
    const r = await call('/api/mparadise/play', { neobloxId: 'nb-zed', look: NEO_LOOK }, { mp: true });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.url, `https://www.roblox.com/games/start?placeId=${PLACE}`);
    assert.equal(r.data.wearingLook, true);
    assert.equal(r.data.robloxName, 'ZedRbx');
    const u = await db.findUserById(user.id);
    assert.ok(u.lookVer > before, 'lookVer bumped so the game re-dresses them');
    assert.equal(u.look.blocky, true);
    assert.deepEqual(u.look.items, []);
    assert.deepEqual(u.look.colors, { head: '#c68642', leftArm: '#c68642', rightArm: '#c68642', torso: '#ff5c72', leftLeg: '#0a0d18', rightLeg: '#0a0d18' });
  });

  await check('the game reads that look for the linked Roblox account', async () => {
    const r = await call('/api/game/look', { robloxId: 9001 }, { game: true });
    assert.equal(r.data.ok, true);
    assert.equal(r.data.look.blocky, true);
    assert.equal(r.data.look.colors.torso, '#ff5c72');
  });

  await check('bad colors are ignored (no look change)', async () => {
    const before = (await db.findUserById(user.id)).lookVer;
    const r = await call('/api/mparadise/play', { neobloxId: 'nb-zed', look: { skin: 'red', shirt: 'javascript:x', pants: 12 } }, { mp: true });
    assert.equal(r.data.wearingLook, false);
    assert.equal((await db.findUserById(user.id)).lookVer, before);
  });

  await check('in a squad: the link carries the squad code', async () => {
    const made = await call('/api/mparadise/party/create', { neobloxId: 'nb-zed', name: 'ZedNeo' }, { mp: true });
    const r = await call('/api/mparadise/play', { neobloxId: 'nb-zed' }, { mp: true });
    assert.equal(r.data.squad, made.data.code);
    assert.equal(r.data.url, `https://www.roblox.com/games/start?placeId=${PLACE}&launchData=${encodeURIComponent(`sq:${made.data.code}`)}`);
  });

  await check('squads know where their Roblox players are (servers only for the game)', async () => {
    const made = await call('/api/mparadise/party/create', { neobloxId: 'nb-amy', name: 'AmyNeo' }, { mp: true });
    const code = made.data.code;
    await call('/api/game/crossplay/join', { robloxId: 777, name: 'RbxPal', code, placeId: PLACE, jobId: JOB_A }, { game: true });
    const nb = (await call('/api/mparadise/party/state', { neobloxId: 'nb-amy', name: 'AmyNeo' }, { mp: true })).data;
    assert.deepEqual(nb.roblox, { placeId: PLACE }, 'Neoblox gets the place');
    assert.ok(!nb.members.some((m) => 'jobId' in m), 'but never a server id');
    const rbx = (await call('/api/game/crossplay/state', { robloxId: 777 }, { game: true })).data;
    assert.equal(rbx.members.find((m) => m.surface === 'roblox').jobId, JOB_A, 'the game gets the server');
    // the Roblox player moves to another server
    await call('/api/game/crossplay/state', { robloxId: 777, placeId: PLACE, jobId: JOB_B }, { game: true });
    const moved = (await call('/api/game/crossplay/state', { robloxId: 777 }, { game: true })).data;
    assert.equal(moved.members.find((m) => m.surface === 'roblox').jobId, JOB_B);
    // junk server ids are ignored
    await call('/api/game/crossplay/state', { robloxId: 777, jobId: "x'; DROP" }, { game: true });
    const kept = (await call('/api/game/crossplay/state', { robloxId: 777 }, { game: true })).data;
    assert.equal(kept.members.find((m) => m.surface === 'roblox').jobId, JOB_B);
  });

  await check('a squad with no Roblox players offers no Roblox link', async () => {
    const made = await call('/api/mparadise/party/create', { neobloxId: 'nb-solo2', name: 'SoloNeo' }, { mp: true });
    assert.equal(made.data.squad.roblox, null);
  });

  await check('play requests need the right key', async () => {
    assert.equal((await call('/api/mparadise/play', { neobloxId: 'nb-zed' }, { mp: 'nope' })).status, 401);
  });

  console.log(`\nALL ${passed} PLAY-ON-ROBLOX CHECKS PASSED`);
  process.exit(0);
})().catch((err) => {
  console.error('\nFAILED:', err);
  process.exit(1);
});
