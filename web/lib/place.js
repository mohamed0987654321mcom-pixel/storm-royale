// The Roblox place id of Storm Royale, so the other surfaces can build "open the game" links.
// Nobody has to type it in: every Roblox game server reports game.PlaceId on its heartbeat (an
// authenticated game API call), and the first one is saved. ROBLOX_PLACE_ID (optional) overrides it.
const db = require('./db');

let learned = null;
let loaded = false;

async function get() {
  const forced = Number(process.env.ROBLOX_PLACE_ID);
  if (Number.isSafeInteger(forced) && forced > 0) return forced;
  if (!loaded) {
    loaded = true;
    const saved = Number(await db.getSetting('robloxPlaceId').catch(() => null));
    if (Number.isSafeInteger(saved) && saved > 0) learned = saved;
  }
  return learned;
}

async function learn(placeId) {
  const n = Number(placeId);
  if (!Number.isSafeInteger(n) || n <= 0 || n === learned) return;
  learned = n;
  loaded = true;
  await db.setSetting('robloxPlaceId', String(n)).catch((err) => console.warn('[place] save failed:', err.message));
}

// "Open Storm Royale on Roblox", optionally carrying data the game reads on join (≤ 200 bytes)
const launchUrl = (placeId, launchData) =>
  `https://www.roblox.com/games/start?placeId=${placeId}${launchData ? `&launchData=${encodeURIComponent(launchData)}` : ''}`;

module.exports = { get, learn, launchUrl };
