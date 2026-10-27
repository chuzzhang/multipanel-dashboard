'use strict';

/**
 * 管理员鉴权：scrypt 密码哈希 + 服务端会话（HttpOnly Cookie）+ 登录失败锁定。
 * 数据文件：data/auth.json（密码） / data/sessions.json（会话，可删）
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DATA_DIR } = require('./store');

const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const SESSION_FILE = path.join(DATA_DIR, 'sessions.json');
const COOKIE_NAME = 'mp_sid';
const SESSION_TTL = 7 * 24 * 3600 * 1000;

const MAX_FAILS = 8;
const FAIL_WINDOW = 10 * 60 * 1000;
const LOCK_TIME = 10 * 60 * 1000;

const sessions = new Map();
const failures = new Map();

/* ------------------------------ 密码 ------------------------------ */

function readAuth() {
  try {
    if (!fs.existsSync(AUTH_FILE)) return null;
    const j = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    return j && j.hash && j.salt ? j : null;
  } catch (_) {
    return null;
  }
}

function isConfigured() {
  return !!readAuth();
}

function username() {
  const a = readAuth();
  return (a && a.username) || 'admin';
}

function writeAuth(obj) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${AUTH_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, AUTH_FILE);
}

function scrypt(password, salt, keylen = 64) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      String(password),
      salt,
      keylen,
      { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (err, dk) => (err ? reject(err) : resolve(dk))
    );
  });
}

async function createPassword(user, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const dk = await scrypt(password, salt);
  writeAuth({
    version: 1,
    username: String(user || 'admin').trim() || 'admin',
    algo: 'scrypt',
    N: 16384,
    salt,
    hash: dk.toString('hex'),
    createdAt: new Date().toISOString()
  });
}

async function verifyPassword(user, password) {
  const a = readAuth();
  if (!a) return { ok: false, reason: 'not_configured' };
  const userOk = String(user || '').trim().toLowerCase() === String(a.username || 'admin').toLowerCase();
  const dk = await scrypt(password, a.salt, 64);
  const target = Buffer.from(a.hash, 'hex');
  const passOk = target.length === dk.length && crypto.timingSafeEqual(target, dk);
  return { ok: userOk && passOk, userOk, passOk };
}

async function changePassword(currentPassword, nextPassword) {
  const a = readAuth();
  if (!a) return { ok: false, error: '尚未设置管理员密码' };
  const check = await verifyPassword(a.username, currentPassword);
  if (!check.passOk) return { ok: false, error: '当前密码不正确' };
  await createPassword(a.username, nextPassword);
  return { ok: true };
}

/* ------------------------------ 会话 ------------------------------ */

function loadSessions() {
  try {
    if (!fs.existsSync(SESSION_FILE)) return;
    const j = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')) || {};
    const now = Date.now();
    for (const [sid, v] of Object.entries(j)) {
      if (v && v.exp > now) sessions.set(sid, v);
    }
  } catch (_) {
    /* 会话文件损坏则忽略 */
  }
}

function saveSessions() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    const out = {};
    for (const [sid, v] of sessions) out[sid] = v;
    const tmp = `${SESSION_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(out, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, SESSION_FILE);
  } catch (_) {
    /* 忽略写盘失败 */
  }
}

function createSession(meta = {}) {
  const sid = crypto.randomBytes(32).toString('hex');
  sessions.set(sid, {
    exp: Date.now() + SESSION_TTL,
    createdAt: Date.now(),
    ip: meta.ip || '',
    ua: String(meta.ua || '').slice(0, 120)
  });
  saveSessions();
  return sid;
}

function getSession(sid) {
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (s.exp <= Date.now()) {
    sessions.delete(sid);
    saveSessions();
    return null;
  }
  return s;
}

function destroySession(sid) {
  if (!sid) return;
  if (sessions.delete(sid)) saveSessions();
}

function destroyOtherSessions(keepSid) {
  for (const sid of Array.from(sessions.keys())) {
    if (sid !== keepSid) sessions.delete(sid);
  }
  saveSessions();
}

function sessionCount() {
  return sessions.size;
}

/* --------------------------- 登录失败锁定 --------------------------- */

function lockedFor(key) {
  const a = failures.get(key);
  if (!a || !a.lockUntil) return 0;
  const left = a.lockUntil - Date.now();
  if (left <= 0) {
    failures.delete(key);
    return 0;
  }
  return Math.ceil(left / 60000);
}

function recordFailure(key) {
  const now = Date.now();
  let a = failures.get(key);
  if (!a || now - a.firstAt > FAIL_WINDOW) a = { count: 0, firstAt: now, lockUntil: 0 };
  a.count += 1;
  if (a.count >= MAX_FAILS) a.lockUntil = now + LOCK_TIME;
  failures.set(key, a);
  return a;
}

function clearFailures(key) {
  failures.delete(key);
}

/* ------------------------------ Cookie ------------------------------ */

function parseCookies(header) {
  const out = {};
  String(header || '')
    .split(';')
    .forEach((part) => {
      const idx = part.indexOf('=');
      if (idx > 0) {
        const k = part.slice(0, idx).trim();
        const v = part.slice(idx + 1).trim();
        if (k) out[k] = decodeURIComponent(v);
      }
    });
  return out;
}

function sidFrom(req) {
  return parseCookies(req.headers.cookie)[COOKIE_NAME] || '';
}

function sessionCookie(sid, secure) {
  return `${COOKIE_NAME}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL / 1000)}${
    secure ? '; Secure' : ''
  }`;
}

function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

loadSessions();

module.exports = {
  COOKIE_NAME,
  MAX_FAILS,
  isConfigured,
  username,
  createPassword,
  verifyPassword,
  changePassword,
  createSession,
  getSession,
  destroySession,
  destroyOtherSessions,
  sessionCount,
  lockedFor,
  recordFailure,
  clearFailures,
  sidFrom,
  sessionCookie,
  clearCookie
};
