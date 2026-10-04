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
`;

const FIELDS = {
  robloxId: 'roblox_id',
  robloxName: 'roblox_name',
  strikes: 'strikes',
  bannedUntil: 'banned_until',
  mutedUntil: 'muted_until',
  blocked: 'blocked',
  stats: 'stats',
};

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

function pgStore(url) {
  const pool = new Pool({
    connectionString: url,
    ssl: /sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined,
  });
  const one = async (sql, args) => (await pool.query(sql, args)).rows[0];
  return {
    kind: 'postgres',
    init: () => pool.query(SCHEMA),
    findUserByEmail: async (email) => rowToUser(await one('SELECT * FROM users WHERE email = $1', [email])),
    findUserById: async (id) => rowToUser(await one('SELECT * FROM users WHERE id = $1', [id])),
    findUserByName: async (name) => rowToUser(await one('SELECT * FROM users WHERE lower(name) = lower($1)', [name])),
    findUserByRoblox: async (rid) => rowToUser(await one('SELECT * FROM users WHERE roblox_id = $1', [rid])),
    findUsersByRoblox: async (ids) => (await pool.query('SELECT * FROM users WHERE roblox_id = ANY($1::bigint[])', [ids])).rows.map(rowToUser),
    createUser: async ({ email, name, birthDate }) =>
      rowToUser(await one('INSERT INTO users (email, name, birth_date) VALUES ($1, $2, $3) RETURNING *', [email, name, birthDate])),
    updateUser: async (id, fields) => {
      const sets = [];
      const args = [];
      for (const [k, v] of Object.entries(fields)) {
        const col = FIELDS[k];
        if (!col) throw new Error('bad field ' + k);
        args.push(col === 'blocked' || col === 'stats' ? JSON.stringify(v) : v);
        sets.push(`${col} = $${args.length}`);
      }
      args.push(id);
      return rowToUser(await one(`UPDATE users SET ${sets.join(', ')} WHERE id = $${args.length} RETURNING *`, args));
    },
    addReport: async ({ reporterId, targetId, reason, source, context }) =>
      rowToReport(await one(
        'INSERT INTO reports (reporter_id, target_id, reason, source, context) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [reporterId || null, targetId, reason, source || 'user', JSON.stringify(context || [])],
      )),
    listReports: async (status) =>
      (await pool.query('SELECT * FROM reports WHERE status = $1 ORDER BY created_at DESC LIMIT 200', [status])).rows.map(rowToReport),
    setReportStatus: async (id, status) => { await pool.query('UPDATE reports SET status = $1 WHERE id = $2', [status, id]); },
  };
}

function memoryStore() {
  const users = [];
  const reports = [];
  const copy = (u) => (u ? { ...u, blocked: [...u.blocked], stats: { ...u.stats } } : null);
  return {
    kind: 'memory',
    init: async () => {},
    findUserByEmail: async (email) => copy(users.find((u) => u.email === email)),
    findUserById: async (id) => copy(users.find((u) => u.id === id)),
    findUserByName: async (name) => copy(users.find((u) => u.name.toLowerCase() === String(name).toLowerCase())),
    findUserByRoblox: async (rid) => copy(users.find((u) => u.robloxId === Number(rid))),
    findUsersByRoblox: async (ids) => users.filter((u) => ids.map(Number).includes(u.robloxId)).map(copy),
    createUser: async ({ email, name, birthDate }) => {
      if (users.some((u) => u.email === email || u.name.toLowerCase() === name.toLowerCase())) throw Object.assign(new Error('duplicate'), { code: '23505' });
      const u = { id: users.length + 1, email, name, birthDate, robloxId: null, robloxName: null, strikes: 0, bannedUntil: null, mutedUntil: null, blocked: [], stats: {}, createdAt: new Date() };
      users.push(u);
      return copy(u);
    },
    updateUser: async (id, fields) => {
      const u = users.find((x) => x.id === id);
      if (!u) return null;
      for (const [k, v] of Object.entries(fields)) {
        if (!FIELDS[k]) throw new Error('bad field ' + k);
        if (k === 'robloxId' && v != null && users.some((x) => x.robloxId === v && x.id !== id)) throw Object.assign(new Error('duplicate'), { code: '23505' });
        u[k] = v;
      }
      return copy(u);
    },
    addReport: async (r) => {
      const rep = { id: reports.length + 1, reporterId: r.reporterId || null, targetId: r.targetId, reason: r.reason, source: r.source || 'user', context: r.context || [], status: 'open', createdAt: new Date() };
      reports.push(rep);
      return rep;
    },
    listReports: async (status) => reports.filter((r) => r.status === status).reverse(),
    setReportStatus: async (id, status) => { const r = reports.find((x) => x.id === id); if (r) r.status = status; },
  };
}

module.exports = process.env.DATABASE_URL ? pgStore(process.env.DATABASE_URL) : memoryStore();
