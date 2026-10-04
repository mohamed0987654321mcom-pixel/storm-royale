// Auth: MPARADISE-style email sign-in. A magic link is emailed with Resend; clicking it sets a session cookie.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) console.warn('[auth] JWT_SECRET not set: sessions reset on every restart');
const COOKIE = 'sr_session';
const SESSION_DAYS = 30;
const LINK_MINUTES = 15;
const MIN_AGE = 13;

const pending = new Map(); // token -> { email, name, birthDate, exp }

function ageFrom(birthDate) {
  const b = new Date(birthDate + 'T00:00:00Z');
  if (Number.isNaN(b.getTime())) return -1;
  const now = new Date();
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  const m = now.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

const ageGroup = (user) => (ageFrom(user.birthDate) >= 18 ? 'adult' : 'teen');

function validName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9_]{3,20}$/.test(name);
}

function validEmail(email) {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function readSession(cookieHeader) {
  const token = parseCookies(cookieHeader)[COOKIE];
  if (!token) return null;
  try {
    return jwt.verify(token, SECRET).uid;
  } catch {
    return null;
  }
}

function setSession(res, userId) {
  const token = jwt.sign({ uid: userId }, SECRET, { expiresIn: `${SESSION_DAYS}d` });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}

function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

function createLoginToken(data) {
  const token = crypto.randomBytes(24).toString('base64url');
  pending.set(token, { ...data, exp: Date.now() + LINK_MINUTES * 60 * 1000 });
  return token;
}

function consumeLoginToken(token) {
  const d = pending.get(token);
  pending.delete(token);
  if (!d || d.exp < Date.now()) return null;
  return d;
}

setInterval(() => {
  const now = Date.now();
  for (const [t, d] of pending) if (d.exp < now) pending.delete(t);
}, 60 * 1000).unref();

async function sendLoginEmail(email, link, isNew) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[auth] RESEND_API_KEY not set. Sign-in link for ${email}: ${link}`);
    return false;
  }
  const from = process.env.EMAIL_FROM || 'Storm Royale <onboarding@resend.dev>';
  const html = `
  <div style="font-family:Arial,sans-serif;background:#0b1640;padding:32px;color:#fff;text-align:center">
    <h1 style="color:#ffdc32;margin:0 0 8px">STORM ROYALE</h1>
    <p style="font-size:16px">${isNew ? 'Welcome! Confirm your email to create your account.' : 'Tap the button to sign in.'}</p>
    <a href="${link}" style="display:inline-block;margin:18px 0;padding:14px 28px;background:#ffdc32;color:#111;font-weight:bold;text-decoration:none;border-radius:8px">${isNew ? 'CREATE ACCOUNT' : 'SIGN IN'}</a>
    <p style="font-size:12px;color:#9fb0e0">This link works for ${LINK_MINUTES} minutes. If you didn't ask for it, ignore this email.</p>
    <p style="font-size:11px;color:#6f7fb0">An MPARADISE account</p>
  </div>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [email], subject: isNew ? 'Create your Storm Royale account' : 'Your Storm Royale sign-in link', html }),
  });
  if (!res.ok) {
    console.error('[auth] Resend error', res.status, await res.text());
    throw new Error('Could not send the email');
  }
  return true;
}

module.exports = {
  MIN_AGE,
  ageFrom,
  ageGroup,
  validName,
  validEmail,
  readSession,
  setSession,
  clearSession,
  createLoginToken,
  consumeLoginToken,
  sendLoginEmail,
};
