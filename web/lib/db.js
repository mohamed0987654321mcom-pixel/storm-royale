// Storage: Postgres when DATABASE_URL is set (Railway), otherwise in-memory (local testing).
const { Pool } = require('pg');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  birth_date DATE NOT NULL,
  roblox_id BIGINT UNIQUE,
  roblox_name TEXT,
  strikes INT NOT NULL DEFAULT 0,
  banned_until TIMESTAMPTZ,
  muted_until TIMESTAMPTZ,
  blocked JSONB NOT NULL DEFAULT '[]',
  stats JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_name_lower ON users (lower(name));
-- kids accounts (under 13)
ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS consent TEXT NOT NULL DEFAULT 'none';
ALTER TABLE users ADD COLUMN IF NOT EXISTS kid_settings JSONB NOT NULL DEFAULT '{"chat":false,"voice":false}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS friends JSONB NOT NULL DEFAULT '[]';
-- (age_verified: left over from a dropped plan to age-check every player; unused)
ALTER TABLE users ADD COLUMN IF NOT EXISTS age_verified BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS users_parent_email ON users (parent_email);
-- "skip email check for now": the typed email waits in pending_email until it's verified
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS users_pending_email ON users (pending_email);
-- avatar builder ("MY STYLE"): the saved look, and a version the game uses to notice changes
ALTER TABLE users ADD COLUMN IF NOT EXISTS look JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS look_ver BIGINT NOT NULL DEFAULT 0;
-- the player's owned Roblox items, read in the game with their permission (kept apart: it can be big)
CREATE TABLE IF NOT EXISTS avatar_items (
  user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  items JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  reporter_id INT,
  target_id INT NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user',
  context JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS friend_requests (
  id SERIAL PRIMARY KEY,
  from_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  accepted BOOLEAN NOT NULL DEFAULT false,
  from_parent_ok BOOLEAN NOT NULL DEFAULT false,
  to_parent_ok BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (from_id, to_id)
);
`;

const FIELDS = {
  robloxId: 'roblox_id',
  robloxName: 'roblox_name',
  strikes: 'strikes',
  bannedUntil: 'banned_until',
  mutedUntil: 'muted_until',
  blocked: 'blocked',
  stats: 'stats',
  consent: 'consent',
  kidSettings: 'kid_settings',
  friends: 'friends',
  email: 'email',
  pendingEmail: 'pending_email',
  emailVerified: 'email_verified',
  look: 'look',
  lookVer: 'look_ver',
};
const JSON_COLS = new Set(['blocked', 'stats', 'kid_settings', 'friends', 'look']);
const REQ_FIELDS = { accepted: 'accepted', fromParentOk: 'from_parent_ok', toParentOk: 'to_parent_ok' };

function rowToUser(r) {
  if (!r) return null;
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    birthDate: r.birth_date instanceof Date ? r.birth_date.toISOString().slice(0, 10) : String(r.birth_date).slice(0, 10),
    robloxId: r.roblox_id == null ? null : Number(r.roblox_id),
    robloxName: r.roblox_name,
    strikes: r.strikes,
    bannedUntil: r.banned_until ? new Date(r.banned_until) : null,
    mutedUntil: r.muted_until ? new Date(r.muted_until) : null,
    blocked: r.blocked || [],
    stats: r.stats || {},
    parentEmail: r.parent_email || null,
    consent: r.consent || 'none',
    kidSettings: { chat: false, voice: false, quick: true, ...(r.kid_settings || {}) },
    friends: r.friends || [],
    pendingEmail: r.pending_email || null,
    emailVerified: r.email_verified !== false,
    look: r.look || null,
    lookVer: Number(r.look_ver || 0),
    createdAt: new Date(r.created_at),
  };
}

function rowToReport(r) {
  return {
    id: r.id,
    reporterId: r.reporter_id,
    targetId: r.target_id,
    reason: r.reason,
    source: r.source,
    context: r.context || [],
    status: r.status,
    createdAt: new Date(r.created_at),
  };
}

function rowToRequest(r) {
  return {
    id: r.id,
    fromId: r.from_id,
    toId: r.to_id,
    accepted: r.accepted,
    fromParentOk: r.from_parent_ok,
    toParentOk: r.to_parent_ok,
    createdAt: new Date(r.created_at),
  };
}

function pgStore(url) {
  const pool = new Pool({
    connectionString: url,
    ssl: /sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined,
  });
  const one = async (sql, args) => (await pool.query(sql, args)).rows[0];
  const many = async (sql, args) => (await pool.query(sql, args)).rows;
  const store = {
    kind: 'postgres',
    init: () => pool.query(SCHEMA),
    findUserByEmail: async (email) => rowToUser(await one('SELECT * FROM users WHERE email = $1', [email])),
    findUserById: async (id) => rowToUser(await one('SELECT * FROM users WHERE id = $1', [id])),
    findUserByName: async (name) => rowToUser(await one('SELECT * FROM users WHERE lower(name) = lower($1)', [name])),
    findUserByRoblox: async (rid) => rowToUser(await one('SELECT * FROM users WHERE roblox_id = $1', [rid])),
    findUsersByRoblox: async (ids) => (await many('SELECT * FROM users WHERE roblox_id = ANY($1::bigint[])', [ids])).map(rowToUser),
    findUsersByIds: async (ids) => (await many('SELECT * FROM users WHERE id = ANY($1::int[])', [ids])).map(rowToUser),
    findKidsByParent: async (email) => (await many('SELECT * FROM users WHERE parent_email = $1 ORDER BY id', [email])).map(rowToUser),
    findPendingByEmail: async (email) => (await many('SELECT * FROM users WHERE pending_email = $1 AND email_verified = false ORDER BY id LIMIT 5', [email])).map(rowToUser),
    createUser: async ({ email, name, birthDate, parentEmail = null, consent = 'none', pendingEmail = null, emailVerified = true }) =>
      rowToUser(await one(
        'INSERT INTO users (email, name, birth_date, parent_email, consent, pending_email, email_verified) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
        [email, name, birthDate, parentEmail, consent, pendingEmail, emailVerified],
      )),
    updateUser: async (id, fields) => {
      const sets = [];
      const args = [];
      for (const [k, v] of Object.entries(fields)) {
        const col = FIELDS[k];
        if (!col) throw new Error('bad field ' + k);
        args.push(JSON_COLS.has(col) ? JSON.stringify(v) : v);
        sets.push(`${col} = $${args.length}`);
      }
      args.push(id);
      return rowToUser(await one(`UPDATE users SET ${sets.join(', ')} WHERE id = $${args.length} RETURNING *`, args));
    },
    deleteUser: async (id) => {
      // drop them from everyone's friends list (friend requests go via ON DELETE CASCADE)
      await pool.query(`UPDATE users SET friends = (SELECT COALESCE(jsonb_agg(f), '[]') FROM jsonb_array_elements(friends) f WHERE f <> to_jsonb($1::int)) WHERE friends @> to_jsonb($1::int)`, [id]);
      await pool.query('DELETE FROM users WHERE id = $1', [id]);
    },
    stalePendingKids: async (days) =>
      (await many(`SELECT * FROM users WHERE consent = 'pending' AND created_at < now() - ($1 || ' days')::interval`, [String(days)])).map(rowToUser),
    addReport: async ({ reporterId, targetId, reason, source, context }) =>
      rowToReport(await one(
        'INSERT INTO reports (reporter_id, target_id, reason, source, context) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [reporterId || null, targetId, reason, source || 'user', JSON.stringify(context || [])],
      )),
    listReports: async (status) =>
      (await many('SELECT * FROM reports WHERE status = $1 ORDER BY created_at DESC LIMIT 200', [status])).map(rowToReport),
    setReportStatus: async (id, status) => { await pool.query('UPDATE reports SET status = $1 WHERE id = $2', [status, id]); },
    // friend requests (kids)
    addFriendRequest: async (fromId, toId) =>
      rowToRequest(await one('INSERT INTO friend_requests (from_id, to_id) VALUES ($1, $2) ON CONFLICT (from_id, to_id) DO UPDATE SET from_id = EXCLUDED.from_id RETURNING *', [fromId, toId])),
    findFriendRequest: async (id) => { const r = await one('SELECT * FROM friend_requests WHERE id = $1', [id]); return r ? rowToRequest(r) : null; },
    findFriendRequestBetween: async (a, b) => {
      const r = await one('SELECT * FROM friend_requests WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1)', [a, b]);
      return r ? rowToRequest(r) : null;
    },
    listFriendRequestsFor: async (ids) =>
      (await many('SELECT * FROM friend_requests WHERE from_id = ANY($1::int[]) OR to_id = ANY($1::int[]) ORDER BY id', [ids])).map(rowToRequest),
    updateFriendRequest: async (id, fields) => {
      const sets = [];
      const args = [];
      for (const [k, v] of Object.entries(fields)) {
        if (!REQ_FIELDS[k]) throw new Error('bad field ' + k);
        args.push(v);
        sets.push(`${REQ_FIELDS[k]} = $${args.length}`);
      }
      args.push(id);
      const r = await one(`UPDATE friend_requests SET ${sets.join(', ')} WHERE id = $${args.length} RETURNING *`, args);
      return r ? rowToRequest(r) : null;
    },
    deleteFriendRequest: async (id) => { await pool.query('DELETE FROM friend_requests WHERE id = $1', [id]); },
    // owned Roblox items (avatar builder)
    getAvatarItems: async (userId) => {
      const r = await one('SELECT items, updated_at FROM avatar_items WHERE user_id = $1', [userId]);
      return r ? { items: r.items || [], updatedAt: new Date(r.updated_at) } : null;
    },
    setAvatarItems: async (userId, items) => {
      if (items === null) return void (await pool.query('DELETE FROM avatar_items WHERE user_id = $1', [userId]));
      await pool.query(
        'INSERT INTO avatar_items (user_id, items, updated_at) VALUES ($1, $2, now()) ON CONFLICT (user_id) DO UPDATE SET items = EXCLUDED.items, updated_at = now()',
        [userId, JSON.stringify(items)],
      );
    },
  };
  return store;
}

function memoryStore() {
  let users = [];
  const reports = [];
  let requests = [];
  let nextUser = 1;
  let nextReq = 1;
  const avatarItems = new Map(); // userId -> { items, updatedAt }
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const copy = (u) => (u ? { ...u, blocked: [...u.blocked], stats: { ...u.stats }, kidSettings: { ...u.kidSettings }, friends: [...u.friends], look: clone(u.look) } : null);
  const copyReq = (r) => (r ? { ...r } : null);
  return {
    kind: 'memory',
    init: async () => {},
    findUserByEmail: async (email) => copy(users.find((u) => u.email === email)),
    findUserById: async (id) => copy(users.find((u) => u.id === id)),
    findUserByName: async (name) => copy(users.find((u) => u.name.toLowerCase() === String(name).toLowerCase())),
    findUserByRoblox: async (rid) => copy(users.find((u) => u.robloxId === Number(rid))),
    findUsersByRoblox: async (ids) => users.filter((u) => ids.map(Number).includes(u.robloxId)).map(copy),
    findUsersByIds: async (ids) => users.filter((u) => ids.map(Number).includes(u.id)).map(copy),
    findKidsByParent: async (email) => users.filter((u) => u.parentEmail === email).map(copy),
    findPendingByEmail: async (email) => users.filter((u) => u.pendingEmail === email && !u.emailVerified).slice(0, 5).map(copy),
    createUser: async ({ email, name, birthDate, parentEmail = null, consent = 'none', pendingEmail = null, emailVerified = true }) => {
      if (users.some((u) => (email && u.email === email) || u.name.toLowerCase() === name.toLowerCase())) throw Object.assign(new Error('duplicate'), { code: '23505' });
      const u = {
        id: nextUser++, email: email || null, pendingEmail, emailVerified, name, birthDate, robloxId: null, robloxName: null, strikes: 0, bannedUntil: null, mutedUntil: null,
        blocked: [], stats: {}, parentEmail, consent, kidSettings: { chat: false, voice: false, quick: true }, friends: [], look: null, lookVer: 0, createdAt: new Date(),
      };
      users.push(u);
      return copy(u);
    },
    updateUser: async (id, fields) => {
      const u = users.find((x) => x.id === id);
      if (!u) return null;
      for (const [k, v] of Object.entries(fields)) {
        if (!FIELDS[k]) throw new Error('bad field ' + k);
        if (k === 'robloxId' && v != null && users.some((x) => x.robloxId === v && x.id !== id)) throw Object.assign(new Error('duplicate'), { code: '23505' });
        if (k === 'email' && v != null && users.some((x) => x.email === v && x.id !== id)) throw Object.assign(new Error('duplicate'), { code: '23505' });
        u[k] = k === 'look' ? clone(v) : v;
      }
      return copy(u);
    },
    deleteUser: async (id) => {
      avatarItems.delete(id);
      users = users.filter((u) => u.id !== id);
      for (const u of users) u.friends = u.friends.filter((f) => f !== id);
      requests = requests.filter((r) => r.fromId !== id && r.toId !== id);
    },
    stalePendingKids: async (days) => users.filter((u) => u.consent === 'pending' && Date.now() - u.createdAt.getTime() > days * 86400e3).map(copy),
    addReport: async (r) => {
      const rep = { id: reports.length + 1, reporterId: r.reporterId || null, targetId: r.targetId, reason: r.reason, source: r.source || 'user', context: r.context || [], status: 'open', createdAt: new Date() };
      reports.push(rep);
      return rep;
    },
    listReports: async (status) => reports.filter((r) => r.status === status).reverse(),
    setReportStatus: async (id, status) => { const r = reports.find((x) => x.id === id); if (r) r.status = status; },
    addFriendRequest: async (fromId, toId) => {
      let r = requests.find((x) => x.fromId === fromId && x.toId === toId);
      if (!r) {
        r = { id: nextReq++, fromId, toId, accepted: false, fromParentOk: false, toParentOk: false, createdAt: new Date() };
        requests.push(r);
      }
      return copyReq(r);
    },
    findFriendRequest: async (id) => copyReq(requests.find((r) => r.id === id)),
    findFriendRequestBetween: async (a, b) => copyReq(requests.find((r) => (r.fromId === a && r.toId === b) || (r.fromId === b && r.toId === a))),
    listFriendRequestsFor: async (ids) => requests.filter((r) => ids.includes(r.fromId) || ids.includes(r.toId)).map(copyReq),
    updateFriendRequest: async (id, fields) => {
      const r = requests.find((x) => x.id === id);
      if (!r) return null;
      for (const [k, v] of Object.entries(fields)) {
        if (!REQ_FIELDS[k]) throw new Error('bad field ' + k);
        r[k] = v;
      }
      return copyReq(r);
    },
    deleteFriendRequest: async (id) => { requests = requests.filter((r) => r.id !== id); },
    getAvatarItems: async (userId) => {
      const r = avatarItems.get(userId);
      return r ? { items: clone(r.items), updatedAt: r.updatedAt } : null;
    },
    setAvatarItems: async (userId, items) => {
      if (items === null) avatarItems.delete(userId);
      else avatarItems.set(userId, { items: clone(items), updatedAt: new Date() });
    },
  };
}

module.exports = process.env.DATABASE_URL ? pgStore(process.env.DATABASE_URL) : memoryStore();
