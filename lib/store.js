'use strict';

/**
 * 极简本地存储：data/connections.json + data/workbuddy-history.json
 * 不依赖任何第三方库，原子写入（tmp + rename）。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONN_FILE = path.join(DATA_DIR, 'connections.json');
const HIST_FILE = path.join(DATA_DIR, 'workbuddy-history.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function blankState() {
  return { version: 1, connections: [] };
}

function getState() {
  const st = readJson(CONN_FILE, blankState());
  if (!st || !Array.isArray(st.connections)) return blankState();
  return st;
}

function saveState(st) {
  writeJson(CONN_FILE, { version: 1, connections: st.connections });
}

function newId() {
  return crypto.randomBytes(6).toString('hex');
}

function list() {
  return getState().connections;
}

function get(id) {
  return list().find((c) => c.id === id) || null;
}

function add(conn) {
  const st = getState();
  const row = {
    id: newId(),
    type: conn.type,
    name: conn.name,
    config: conn.config || {},
    demo: !!conn.demo,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  st.connections.push(row);
  saveState(st);
  return row;
}

function update(id, patch) {
  const st = getState();
  const idx = st.connections.findIndex((c) => c.id === id);
  if (idx < 0) return null;
  const cur = st.connections[idx];
  const next = {
    ...cur,
    ...patch,
    config: { ...cur.config, ...(patch.config || {}) },
    id: cur.id,
    updatedAt: new Date().toISOString()
  };
  st.connections[idx] = next;
  saveState(st);
  return next;
}

function remove(id) {
  const st = getState();
  const idx = st.connections.findIndex((c) => c.id === id);
  if (idx < 0) return false;
  st.connections.splice(idx, 1);
  saveState(st);
  return true;
}

function removeDemo() {
  const st = getState();
  st.connections = st.connections.filter((c) => !c.demo);
  saveState(st);
}

/* ---------------- WorkBuddy 余额历史（画趋势用） ---------------- */

function pushWorkbuddySnapshot(connId, value) {
  if (!Number.isFinite(value)) return;
  const all = readJson(HIST_FILE, {});
  const arr = Array.isArray(all[connId]) ? all[connId] : [];
  const now = Date.now();
  const last = arr[arr.length - 1];
  // 同一小时且数值未变则不重复记录
  if (last && now - last.t < 3600 * 1000 && Math.abs(last.v - value) < 1e-9) return;
  arr.push({ t: now, v: Math.round(value * 100) / 100 });
  all[connId] = arr.slice(-90);
  writeJson(HIST_FILE, all);
}

function getWorkbuddyHistory(connId) {
  const all = readJson(HIST_FILE, {});
  return Array.isArray(all[connId]) ? all[connId] : [];
}

module.exports = {
  DATA_DIR,
  list,
  get,
  add,
  update,
  remove,
  removeDemo,
  pushWorkbuddySnapshot,
  getWorkbuddyHistory
};
