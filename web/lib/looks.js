// Avatar looks ("MY STYLE"): which Roblox item types the builder supports, and the rules every saved look follows.
// The same rules run in the game (src/server/Modules/Avatar.luau); keep the two in step.
//
// A look is a full outfit for Storm Royale only (it never changes the player's real Roblox avatar):
//   { items: [{ id, type, name }], colors: { head, torso, leftArm, rightArm, leftLeg, rightLeg }, scales: { height, width, head, proportion, bodyType } }
// Clothing and accessories that aren't in the look aren't worn. Body parts and the face that aren't in the look
// come from the player's normal Roblox avatar (Roblox avatars always have a body and a face).

// type (Roblox AvatarAssetType name) -> { cat: builder category, label, max worn at once, group: shared slot }
const TYPES = {
  Hat: { cat: 'head', label: 'Hats', max: 3 },
  HairAccessory: { cat: 'head', label: 'Hair', max: 3 },
  FaceAccessory: { cat: 'head', label: 'Face accessories', max: 2 },
  EyebrowAccessory: { cat: 'head', label: 'Eyebrows', max: 1, layered: true },
  EyelashAccessory: { cat: 'head', label: 'Eyelashes', max: 1, layered: true },
  Face: { cat: 'head', label: 'Faces', max: 1 },

  TShirtAccessory: { cat: 'clothes', label: 'T-shirts (3D)', max: 1, layered: true },
  ShirtAccessory: { cat: 'clothes', label: 'Shirts (3D)', max: 1, layered: true },
  SweaterAccessory: { cat: 'clothes', label: 'Sweaters', max: 1, layered: true },
  JacketAccessory: { cat: 'clothes', label: 'Jackets', max: 1, layered: true },
  PantsAccessory: { cat: 'clothes', label: 'Pants (3D)', max: 1, layered: true },
  ShortsAccessory: { cat: 'clothes', label: 'Shorts', max: 1, layered: true },
  DressSkirtAccessory: { cat: 'clothes', label: 'Dresses & skirts', max: 1, layered: true },
  LeftShoeAccessory: { cat: 'clothes', label: 'Left shoes', max: 1, layered: true },
  RightShoeAccessory: { cat: 'clothes', label: 'Right shoes', max: 1, layered: true },
  Shirt: { cat: 'clothes', label: 'Classic shirts', max: 1 },
  Pants: { cat: 'clothes', label: 'Classic pants', max: 1 },
  TShirt: { cat: 'clothes', label: 'Classic T-shirts', max: 1 },

  NeckAccessory: { cat: 'accessories', label: 'Neck', max: 2 },
  ShoulderAccessory: { cat: 'accessories', label: 'Shoulders', max: 2 },
  FrontAccessory: { cat: 'accessories', label: 'Front', max: 2 },
  BackAccessory: { cat: 'accessories', label: 'Back', max: 2 },
  WaistAccessory: { cat: 'accessories', label: 'Waist', max: 2 },

  DynamicHead: { cat: 'body', label: 'Heads', max: 1, group: 'head' },
  Head: { cat: 'body', label: 'Heads', max: 1, group: 'head' },
  Torso: { cat: 'body', label: 'Torsos', max: 1 },
  LeftArm: { cat: 'body', label: 'Left arms', max: 1 },
  RightArm: { cat: 'body', label: 'Right arms', max: 1 },
  LeftLeg: { cat: 'body', label: 'Left legs', max: 1 },
  RightLeg: { cat: 'body', label: 'Right legs', max: 1 },
};

const CATEGORIES = [
  { id: 'head', label: 'HEAD & HAIR' },
  { id: 'clothes', label: 'CLOTHES' },
  { id: 'accessories', label: 'ACCESSORIES' },
  { id: 'body', label: 'BODY' },
];

const RIGID_MAX = 10; // hats, hair and other non-layered accessories worn at once
const LAYERED_MAX = 10;
const ITEMS_MAX = 40; // everything in one look
const INVENTORY_MAX = 3000; // owned items we keep a list of

const PARTS = ['head', 'torso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
// Roblox's allowed R15 ranges
const SCALES = {
  height: { min: 0.9, max: 1.05, def: 1 },
  width: { min: 0.7, max: 1, def: 1 },
  head: { min: 0.95, max: 1, def: 1 },
  proportion: { min: 0, max: 1, def: 0 },
  bodyType: { min: 0, max: 1, def: 0 },
};

const isRigidAccessory = (type) => ['Hat', 'HairAccessory', 'FaceAccessory', 'NeckAccessory', 'ShoulderAccessory', 'FrontAccessory', 'BackAccessory', 'WaistAccessory'].includes(type);
const validId = (id) => Number.isSafeInteger(id) && id > 0;
const cleanName = (name) => String(name || '').replace(/[\u0000-\u001f]/g, '').slice(0, 100);
const HEX = /^#?([0-9a-f]{6})$/i;

/**
 * Make a look safe to store / wear. Unknown types, bad ids, duplicates and anything over the limits are dropped.
 * @param {any} raw
 * @param {{ owned?: Set<number> }} [opts] when given, items not in `owned` are dropped too
 * @returns {{ look: object, dropped: object[] }}
 */
function sanitizeLook(raw, { owned } = {}) {
  const dropped = [];
  const items = [];
  const seen = new Set();
  const perType = {};
  const perGroup = {};
  let rigid = 0;
  let layered = 0;
  const list = Array.isArray(raw?.items) ? raw.items : [];
  for (const it of list) {
    const id = Number(it?.id);
    const type = String(it?.type || '');
    const def = TYPES[type];
    if (!validId(id) || !def || seen.has(id)) continue;
    const key = def.group || type;
    const tooMany = (perType[type] || 0) >= def.max
      || (def.group && (perGroup[key] || 0) >= 1)
      || (isRigidAccessory(type) && rigid >= RIGID_MAX)
      || (def.layered && layered >= LAYERED_MAX)
      || items.length >= ITEMS_MAX;
    if (tooMany || (owned && !owned.has(id))) {
      dropped.push({ id, type, reason: tooMany ? 'limit' : 'not_owned' });
      continue;
    }
    seen.add(id);
    perType[type] = (perType[type] || 0) + 1;
    if (def.group) perGroup[key] = 1;
    if (isRigidAccessory(type)) rigid += 1;
    if (def.layered) layered += 1;
    items.push({ id, type, name: cleanName(it.name) });
  }
  const colors = {};
  for (const p of PARTS) {
    const m = HEX.exec(String(raw?.colors?.[p] || ''));
    if (m) colors[p] = `#${m[1].toLowerCase()}`;
  }
  const scales = {};
  for (const [k, r] of Object.entries(SCALES)) {
    const v = Number(raw?.scales?.[k]);
    scales[k] = Number.isFinite(v) ? Math.round(Math.min(r.max, Math.max(r.min, v)) * 100) / 100 : r.def;
  }
  return { look: { items, colors, scales }, dropped };
}

/** Owned-items list sent by the game (read with the player's permission). */
function sanitizeInventory(raw) {
  const out = [];
  const seen = new Set();
  for (const it of Array.isArray(raw) ? raw : []) {
    const id = Number(it?.id);
    const type = String(it?.type || '');
    if (!validId(id) || !TYPES[type] || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, type, name: cleanName(it.name) });
    if (out.length >= INVENTORY_MAX) break;
  }
  return out;
}

/** Turn Roblox's public "currently worn" avatar (avatar.roblox.com v2) into a look + item list. */
function fromRobloxAvatar(av) {
  const items = (av?.assets || [])
    .map((a) => ({ id: Number(a.id), type: String(a.assetType?.name || ''), name: cleanName(a.name) }))
    .filter((a) => validId(a.id) && TYPES[a.type]);
  const c = av?.bodyColor3s || {};
  const colors = {
    head: c.headColor3, torso: c.torsoColor3, leftArm: c.leftArmColor3, rightArm: c.rightArmColor3, leftLeg: c.leftLegColor3, rightLeg: c.rightLegColor3,
  };
  const { look } = sanitizeLook({ items, colors, scales: av?.scales || {} });
  return { look, items };
}

module.exports = { TYPES, CATEGORIES, PARTS, SCALES, RIGID_MAX, LAYERED_MAX, ITEMS_MAX, INVENTORY_MAX, sanitizeLook, sanitizeInventory, fromRobloxAvatar };
