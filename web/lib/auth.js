// Auth: MPARADISE-style email sign-in. A magic link is emailed with Resend; clicking it sets a session cookie.
// Parents get their own sign-in (separate cookie) for the parent page.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) console.warn('[auth] JWT_SECRET not set: sessions reset on every restart');
const COOKIE = 'sr_session';
const PARENT_COOKIE = 'sr_parent';
const SESSION_DAYS = 30;
const PARENT_DAYS = 7;
const LINK_MINUTES = 15;
const PARENT_LINK_HOURS = 72; // parents may not open the consent email right away
const MIN_AGE = 13; // without a parent
const KID_MIN_AGE = 6;
const KIDS_ENABLED = process.env.KIDS_ENABLED === '1';

const pending = new Map(); // token -> { ...data, exp }

function ageFrom(birthDate) {
  const b = new Date(birthDate + 'T00:00:00Z');
  if (Number.isNaN(b.getTime())) return -1;
  const now = new Date();
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  const m = now.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

// 'kid' (under 13), 'teen' (13-17), 'adult' (18+). Kids grow into teens automatically on their birthday.
function ageGroup(user) {
  const age = ageFrom(user.birthDate);
  if (age < MIN_AGE) return 'kid';
  return age >= 18 ? 'adult' : 'teen';
}

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

function readToken(cookieHeader, name, kind) {
  const token = parseCookies(cookieHeader)[name];
  if (!token) return null;
  try {
    const p = jwt.verify(token, SECRET);
    // sessions made before parent sign-in existed have no "k"; they're player sessions
    if (p.k === kind || (kind === 'u' && p.k === undefined && p.uid)) return p;
    return null;
  } catch {
    return null;
  }
}

function cookie(res, name, value, maxAge) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.append('Set-Cookie', `${name}=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

const readSession = (cookieHeader) => readToken(cookieHeader, COOKIE, 'u')?.uid || null;
const readParentSession = (cookieHeader) => readToken(cookieHeader, PARENT_COOKIE, 'p')?.email || null;

function setSession(res, userId) {
  cookie(res, COOKIE, jwt.sign({ k: 'u', uid: userId }, SECRET, { expiresIn: `${SESSION_DAYS}d` }), SESSION_DAYS * 86400);
}
function setParentSession(res, email) {
  cookie(res, PARENT_COOKIE, jwt.sign({ k: 'p', email }, SECRET, { expiresIn: `${PARENT_DAYS}d` }), PARENT_DAYS * 86400);
}
const clearSession = (res) => cookie(res, COOKIE, '', 0);
const clearParentSession = (res) => cookie(res, PARENT_COOKIE, '', 0);

// Parent links are signed (not stored in memory) so they keep working after the server restarts
function createParentLink(email, hours = PARENT_LINK_HOURS) {
  return jwt.sign({ k: 'pl', email }, SECRET, { expiresIn: `${hours}h` });
}
function readParentLink(token) {
  try {
    const p = jwt.verify(String(token || ''), SECRET);
    return p.k === 'pl' ? p.email : null;
  } catch {
    return null;
  }
}

// "verify your email" links (for accounts made with "skip for now") are signed too, and last a week
function createVerifyLink(uid, email) {
  return jwt.sign({ k: 've', uid, email }, SECRET, { expiresIn: '7d' });
}
function readVerifyLink(token) {
  try {
    const p = jwt.verify(String(token || ''), SECRET);
    return p.k === 've' ? { uid: p.uid, email: p.email } : null;
  } catch {
    return null;
  }
}

function createLoginToken(data, minutes = LINK_MINUTES) {
  const token = crypto.randomBytes(24).toString('base64url');
  pending.set(token, { ...data, exp: Date.now() + minutes * 60 * 1000 });
  return token;
}

function consumeLoginToken(token, kind = 'player') {
  const d = pending.get(token);
  if (!d || (d.kind || 'player') !== kind) return null;
  pending.delete(token);
  if (d.exp < Date.now()) return null;
  return d;
}

setInterval(() => {
  const now = Date.now();
  for (const [t, d] of pending) if (d.exp < now) pending.delete(t);
}, 60 * 1000).unref();

// ------------------------------------------------------------------ email
function shell(inner) {
  return `<div style="font-family:Arial,sans-serif;background:#0b1640;padding:32px;color:#fff;text-align:center">
    <h1 style="color:#ffdc32;margin:0 0 8px">STORM ROYALE</h1>${inner}
    <p style="font-size:11px;color:#6f7fb0;margin-top:24px">An MPARADISE account</p></div>`;
}
const button = (link, label) =>
  `<a href="${link}" style="display:inline-block;margin:18px 0;padding:14px 28px;background:#ffdc32;color:#111;font-weight:bold;text-decoration:none;border-radius:8px">${label}</a>`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function sendEmail(to, subject, html, devLabel, link) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[auth] RESEND_API_KEY not set. ${devLabel} for ${to}: ${link}`);
    return false;
  }
  const from = process.env.EMAIL_FROM || 'Storm Royale <onboarding@resend.dev>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!res.ok) {
    console.error('[auth] Resend error', res.status, await res.text());
    throw new Error('Could not send the email');
  }
  return true;
}

function sendLoginEmail(email, link, isNew) {
  const html = shell(`
    <p style="font-size:16px">${isNew ? 'Welcome! Confirm your email to create your account.' : 'Tap the button to sign in.'}</p>
    ${button(link, isNew ? 'CREATE ACCOUNT' : 'SIGN IN')}
    <p style="font-size:12px;color:#9fb0e0">This link works for ${LINK_MINUTES} minutes. If you didn't ask for it, ignore this email.</p>`);
  return sendEmail(email, isNew ? 'Create your Storm Royale account' : 'Your Storm Royale sign-in link', html, 'Sign-in link', link);
}

function sendVerifyEmail(email, name, link) {
  const html = shell(`
    <p style="font-size:16px">Confirm this email for your Storm Royale account <b>${esc(name)}</b>.</p>
    <p style="font-size:14px;color:#c8d4ff;max-width:460px;margin:0 auto">Until you do, you can play, party up and use quick chat. Typing and voice unlock once your email is confirmed, and this link also signs you in on any device.</p>
    ${button(link, 'CONFIRM MY EMAIL')}
    <p style="font-size:12px;color:#9fb0e0">This link works for 7 days. If you didn't make this account, ignore this email.</p>`);
  return sendEmail(email, 'Confirm your Storm Royale email', html, 'Verify-email link', link);
}

function sendParentConsentEmail(parentEmail, kidName, link) {
  const html = shell(`
    <p style="font-size:16px">Your child signed up for <b>Storm Royale</b> as <b>${esc(kidName)}</b> and asked for your permission.</p>
    <p style="font-size:14px;color:#c8d4ff;max-width:460px;margin:0 auto">Storm Royale is a game community for Roblox players. Kids' accounts can only play with friends you approve, and can only send preset quick-chat phrases like "GG!". Typing and voice stay off unless you turn them on.</p>
    ${button(link, 'REVIEW AND DECIDE')}
    <p style="font-size:12px;color:#9fb0e0">If you don't respond within 7 days, the account and its email address are deleted.<br>If you don't know about this, you can ignore this email.</p>`);
  return sendEmail(parentEmail, `${kidName} wants to join Storm Royale`, html, 'Parent consent link', link);
}

function sendParentLoginEmail(parentEmail, link) {
  const html = shell(`
    <p style="font-size:16px">Sign in to the Storm Royale parent page to manage your child's account.</p>
    ${button(link, 'OPEN PARENT PAGE')}
    <p style="font-size:12px;color:#9fb0e0">This link works for ${LINK_MINUTES} minutes.</p>`);
  return sendEmail(parentEmail, 'Your Storm Royale parent page link', html, 'Parent sign-in link', link);
}

function sendParentNoticeEmail(parentEmail, subject, text, link) {
  const html = shell(`<p style="font-size:16px">${esc(text)}</p>${button(link, 'OPEN PARENT PAGE')}`);
  return sendEmail(parentEmail, subject, html, 'Parent notice link', link);
}

module.exports = {
  MIN_AGE,
  KID_MIN_AGE,
  KIDS_ENABLED,
  LINK_MINUTES,
  PARENT_LINK_HOURS,
  ageFrom,
  ageGroup,
  validName,
  validEmail,
  readSession,
  readParentSession,
  setSession,
  setParentSession,
  clearSession,
  clearParentSession,
  createLoginToken,
  consumeLoginToken,
  createParentLink,
  readParentLink,
  createVerifyLink,
  readVerifyLink,
  sendVerifyEmail,
  sendLoginEmail,
  sendParentConsentEmail,
  sendParentLoginEmail,
  sendParentNoticeEmail,
};
