'use strict';

/**
 * MultiPanel —— 多平台仪表盘聚合服务
 * 零依赖：只用 Node 内置模块。node server.js 即可启动。
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const store = require('./lib/store');
const auth = require('./lib/auth');
const { TYPES, TYPE_ORDER, run, probe } = require('./lib/providers');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const AUTH_OFF = process.env.AUTH_DISABLED === '1';

// 自建面板常用自签证书；如需严格校验，启动前设置 ALLOW_INSECURE_TLS=0
if (process.env.ALLOW_INSECURE_TLS !== '0') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

/* ------------------------------ 工具 ------------------------------ */

function sendJson(res, status, body, headers = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(data),
    ...headers
  });
  res.end(data);
}

function clientIp(req) {
  return req.socket.remoteAddress || 'unknown';
}

function isSecureReq(req) {
  if (req.socket.encrypted) return true;
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

// CSRF 防护：非 GET 请求校验来源。
// 反向代理/隧道常会改写 Host，所以同时参考 X-Forwarded-Host、X-Original-Host，
// 并允许用 PUBLIC_URL 显式声明对外访问地址；端口被省略时退化为只比主机名。
function normalizeHost(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/:(80|443)$/, '')
    .replace(/\/$/, '');
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // 同站请求（部分客户端不带 Origin）

  // 浏览器自报的请求上下文，跨站页面无法伪造：
  // - same-origin：请求确实由本站页面发起
  // - none：用户直接在地址栏输入 / 书签打开
  // 这两个值不受反向代理改写 Host 影响，是反代场景下最可靠的依据。
  const site = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (site === 'same-origin' || site === 'none') return true;

  let parsed;
  try {
    parsed = new URL(origin);
  } catch (_) {
    return false;
  }

  const hosts = new Set();
  [req.headers.host, req.headers['x-forwarded-host'], req.headers['x-original-host']]
    .filter(Boolean)
    .join(',')
    .split(',')
    .map(normalizeHost)
    .filter(Boolean)
    .forEach((h) => hosts.add(h));

  if (process.env.PUBLIC_URL) {
    const pub = normalizeHost(process.env.PUBLIC_URL);
    if (pub) hosts.add(pub);
  }

  if (!hosts.size) return true;

  const originHost = normalizeHost(parsed.host);
  if (hosts.has(originHost)) return true;

  // 代理可能把端口改写或去掉，退一步只比主机名
  const originName = originHost.split(':')[0];
  for (const h of hosts) {
    if (h.split(':')[0] === originName) return true;
  }

  // 已持有会话 Cookie 的请求：Cookie 是 SameSite=Lax + HttpOnly，
  // 跨站 POST 不会被浏览器带上，因此能带上来就说明来自本站页面。
  // 这一条同样不依赖 Host，代理怎么改写都不影响。
  const cookie = String(req.headers.cookie || '');
  if (new RegExp(`(?:^|;\\s*)${auth.COOKIE_NAME}=[^;]{8,}`).test(cookie)) return true;

  req.csrfDetail = {
    origin: originHost,
    host: req.headers.host || '',
    xfh: req.headers['x-forwarded-host'] || '',
    site: site || '-'
  };
  return false;
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function maskConfig(type, config) {
  const meta = TYPES[type];
  const out = { ...config };
  if (!meta) return out;
  for (const f of meta.fields) {
    if (!f.secret) continue;
    const v = out[f.key];
    if (typeof v === 'string' && v.length > 0) {
      out[f.key] = '••••••' + v.slice(-4);
      out[`${f.key}__masked`] = true;
    }
  }
  return out;
}

function publicConn(conn) {
  return {
    id: conn.id,
    type: conn.type,
    name: conn.name,
    demo: !!conn.demo,
    createdAt: conn.createdAt,
    updatedAt: conn.updatedAt,
    config: maskConfig(conn.type, conn.config || {})
  };
}

function mergeConfig(conn, incoming) {
  const prev = (conn && conn.config) || {};
  const next = { ...incoming };
  const meta = TYPES[conn ? conn.type : incoming.type];
  for (const f of (meta && meta.fields) || []) {
    if (!f.secret) continue;
    const v = next[f.key];
    // 前端留空 / 传回掩码 → 保留旧值
    if (v === undefined || v === null || v === '' || (typeof v === 'string' && v.startsWith('••••'))) {
      if (prev[f.key] !== undefined) next[f.key] = prev[f.key];
      else delete next[f.key];
    }
  }
  return next;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

/* ------------------------------ 指标缓存 ------------------------------ */

const CACHE = new Map(); // id -> { at, data }
const CACHE_TTL = 15 * 1000;

function cacheKey(conn) {
  return JSON.stringify([conn.type, conn.config, conn.demo]);
}

async function collectOne(conn, force) {
  const cached = CACHE.get(conn.id);
  const key = cacheKey(conn);
  if (!force && cached && cached.key === key && Date.now() - cached.at < CACHE_TTL) {
    return cached.data;
  }

  let data;
  try {
    const result = await run(conn);
    data = { id: conn.id, ok: true, ...result };

    if (conn.type === 'workbuddy' && Number.isFinite(result.payload.balance)) {
      store.pushWorkbuddySnapshot(conn.id, result.payload.balance);
      data.payload.series = store.getWorkbuddyHistory(conn.id);
    }
  } catch (err) {
    data = {
      id: conn.id,
      ok: false,
      error: (err && err.message) || '未知错误',
      fetchedAt: new Date().toISOString()
    };
  }

  CACHE.set(conn.id, { at: Date.now(), key, data });
  return data;
}

/* ------------------------------ 路由 ------------------------------ */

async function handleAuthRoutes(req, res, p, method) {
  const sid = auth.sidFrom(req);

  if (p === '/api/auth/status' && method === 'GET') {
    const sess = auth.getSession(sid);
    return sendJson(res, 200, {
      configured: auth.isConfigured() || AUTH_OFF,
      authenticated: AUTH_OFF || !!sess,
      username: auth.username(),
      authDisabled: AUTH_OFF
    });
  }

  // 首次使用：设置管理员密码
  if (p === '/api/auth/setup' && method === 'POST') {
    if (auth.isConfigured()) return sendJson(res, 409, { error: '管理员密码已设置，请直接登录' });
    const body = await readBody(req);
    const user = String(body.username || 'admin').trim() || 'admin';
    const pass = String(body.password || '');
    if (pass.length < 8) return sendJson(res, 400, { error: '密码至少 8 位' });
    if (pass === user) return sendJson(res, 400, { error: '密码不能与用户名相同' });
    await auth.createPassword(user, pass);
    const newSid = auth.createSession({ ip: clientIp(req), ua: req.headers['user-agent'] });
    return sendJson(
      res,
      200,
      { ok: true, username: auth.username() },
      { 'Set-Cookie': auth.sessionCookie(newSid, isSecureReq(req)) }
    );
  }

  if (p === '/api/auth/login' && method === 'POST') {
    if (!auth.isConfigured()) {
      return sendJson(res, 409, { error: '尚未设置管理员密码', code: 'SETUP_REQUIRED' });
    }
    const ip = clientIp(req);
    const locked = auth.lockedFor(ip);
    if (locked) {
      return sendJson(res, 429, { error: `尝试过于频繁，请 ${locked} 分钟后再试` });
    }
    const body = await readBody(req);
    const result = await auth.verifyPassword(body.username, body.password);
    if (!result.ok) {
      const stat = auth.recordFailure(ip);
      const left = Math.max(0, auth.MAX_FAILS - stat.count);
      return sendJson(res, 401, {
        error: left > 0 ? `用户名或密码不正确，还可尝试 ${left} 次` : '尝试次数过多，已锁定 10 分钟'
      });
    }
    auth.clearFailures(ip);
    const newSid = auth.createSession({ ip, ua: req.headers['user-agent'] });
    return sendJson(
      res,
      200,
      { ok: true, username: auth.username() },
      { 'Set-Cookie': auth.sessionCookie(newSid, isSecureReq(req)) }
    );
  }

  if (p === '/api/auth/logout' && method === 'POST') {
    auth.destroySession(sid);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
  }

  // 以下需要已登录
  const sess = auth.getSession(sid);
  if (!sess && !AUTH_OFF) return sendJson(res, 401, { error: '需要登录', code: 'UNAUTHORIZED' });

  if (p === '/api/auth/password' && method === 'POST') {
    const body = await readBody(req);
    const next = String(body.next || '');
    if (next.length < 8) return sendJson(res, 400, { error: '新密码至少 8 位' });
    if (next === String(body.current || '')) return sendJson(res, 400, { error: '新密码不能与当前密码相同' });
    const result = await auth.changePassword(String(body.current || ''), next);
    if (!result.ok) return sendJson(res, 400, { error: result.error });
    auth.destroyOtherSessions(sid);
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'Not Found' });
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  const method = req.method.toUpperCase();
  const force = url.searchParams.get('force') === '1';

  // 非 GET 请求校验来源，避免 CSRF。
  // 登录与首次设置例外：前者需要密码、后者在任何人都能直接访问的前提下才可用，
  // 做了来源校验只会在反向代理场景下把自己挡在门外，不增加实际安全性。
  const authEntry = p === '/api/auth/login' || p === '/api/auth/setup';
  if (!authEntry && method !== 'GET' && method !== 'HEAD' && !sameOrigin(req)) {
    const d = req.csrfDetail || {};
    process.stdout.write(
      `[csrf] 拒绝 origin=${d.origin || '-'} host=${d.host || '-'} xfh=${d.xfh || '-'} sec-fetch-site=${d.site || '-'}\n`
    );
    return sendJson(res, 403, {
      error:
        `跨站请求被拒绝（origin=${d.origin || '-'} / host=${d.host || '-'}）。` +
        '反向代理请透传原始 Host（Nginx: proxy_set_header Host $host;），' +
        '或设置环境变量 PUBLIC_URL 为对外访问地址'
    });
  }

  if (p.startsWith('/api/auth/')) {
    return handleAuthRoutes(req, res, p, method);
  }

  if (p === '/api/health' && method === 'GET') {
    return sendJson(res, 200, { ok: true, time: new Date().toISOString(), node: process.version });
  }

  // 其余接口一律要求登录
  if (!AUTH_OFF) {
    const sess = auth.getSession(auth.sidFrom(req));
    if (!sess) {
      const configured = auth.isConfigured();
      return sendJson(res, 401, {
        error: configured ? '需要登录' : '尚未设置管理员密码',
        code: configured ? 'UNAUTHORIZED' : 'SETUP_REQUIRED'
      });
    }
  }

  if (p === '/api/types' && method === 'GET') {
    return sendJson(res, 200, { order: TYPE_ORDER, types: TYPES });
  }

  if (p === '/api/state' && method === 'GET') {
    return sendJson(res, 200, {
      connections: store.list().map(publicConn),
      dataDir: store.DATA_DIR
    });
  }

  if (p === '/api/connections' && method === 'POST') {
    const body = await readBody(req);
    const type = body.type;
    if (!TYPES[type]) return sendJson(res, 400, { error: '未知的平台类型' });
    const name = String(body.name || TYPES[type].label).slice(0, 40);
    const config = { ...(body.config || {}) };
    const row = store.add({ type, name, config, demo: !!body.demo });
    CACHE.delete(row.id);
    return sendJson(res, 200, { connection: publicConn(row) });
  }

  const idMatch = p.match(/^\/api\/connections\/([\w-]+)$/);
  if (idMatch) {
    const id = idMatch[1];
    const conn = store.get(id);
    if (!conn) return sendJson(res, 404, { error: '连接不存在' });

    if (method === 'PUT') {
      const body = await readBody(req);
      const patch = {};
      if (body.name !== undefined) patch.name = String(body.name).slice(0, 40);
      if (body.demo !== undefined) patch.demo = !!body.demo;
      if (body.config !== undefined) patch.config = mergeConfig(conn, body.config);
      const row = store.update(id, patch);
      CACHE.delete(id);
      return sendJson(res, 200, { connection: publicConn(row) });
    }

    if (method === 'DELETE') {
      store.remove(id);
      CACHE.delete(id);
      return sendJson(res, 200, { ok: true });
    }

    if (method === 'GET') {
      return sendJson(res, 200, { connection: publicConn(conn) });
    }
  }

  if (p === '/api/probe' && method === 'POST') {
    const body = await readBody(req);
    const type = body.type;
    if (!TYPES[type]) return sendJson(res, 400, { error: '未知的平台类型' });
    const baseConn = body.id ? store.get(body.id) : null;
    const config = baseConn ? mergeConfig(baseConn, body.config || {}) : body.config || {};
    try {
      const result = await probe(type, config);
      return sendJson(res, 200, result);
    } catch (err) {
      process.stdout.write(`[probe] ${type} 失败：${err.message}\n`);
      return sendJson(res, 200, { ok: false, error: err.message });
    }
  }

  if (p === '/api/metrics' && method === 'GET') {
    const conns = store.list();
    const results = await mapLimit(conns, 4, (c) => collectOne(c, force));
    return sendJson(res, 200, { results, at: new Date().toISOString() });
  }

  const mMatch = p.match(/^\/api\/metrics\/([\w-]+)$/);
  if (mMatch && method === 'GET') {
    const conn = store.get(mMatch[1]);
    if (!conn) return sendJson(res, 404, { error: '连接不存在' });
    const data = await collectOne(conn, force);
    return sendJson(res, 200, data);
  }

  if (p === '/api/export' && method === 'GET') {
    const withSecrets = url.searchParams.get('secrets') !== '0';
    const payload = {
      app: 'multipanel',
      version: 1,
      exportedAt: new Date().toISOString(),
      secretsIncluded: withSecrets,
      connections: store.list().map((c) => {
        const meta = TYPES[c.type] || { fields: [] };
        const config = { ...(c.config || {}) };
        if (!withSecrets) {
          for (const f of meta.fields || []) {
            if (!f.secret) continue;
            if (config[f.key] !== undefined) config[f.key] = '';
          }
        }
        return { type: c.type, name: c.name, demo: !!c.demo, config };
      })
    };
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const data = JSON.stringify(payload, null, 2);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="multipanel-${stamp}.json"`,
      'Content-Length': Buffer.byteLength(data),
      'Cache-Control': 'no-store'
    });
    return res.end(data);
  }

  if (p === '/api/import' && method === 'POST') {
    const body = await readBody(req);
    const mode = body.mode === 'replace' ? 'replace' : 'merge';
    const rows = Array.isArray(body.connections) ? body.connections : null;
    if (!rows) return sendJson(res, 400, { error: '导入内容格式不对：缺少 connections 数组' });
    if (rows.length > 200) return sendJson(res, 400, { error: '一次最多导入 200 个连接' });

    const cleaned = [];
    const skipped = [];
    for (const raw of rows) {
      const type = String((raw && raw.type) || '');
      if (!TYPES[type]) {
        skipped.push(type || '(缺少 type)');
        continue;
      }
      const name = String((raw && raw.name) || TYPES[type].label).slice(0, 40);
      const cfg = raw && typeof raw.config === 'object' && raw.config ? { ...raw.config } : {};
      cleaned.push({ type, name, config: cfg, demo: !!(raw && raw.demo) });
    }
    if (!cleaned.length) {
      return sendJson(res, 400, {
        error: `没有可导入的连接${skipped.length ? '（不认识的类型：' + skipped.join('、') + '）' : ''}`
      });
    }

    let imported = 0;
    let updated = 0;

    if (mode === 'replace') {
      store.replaceAll(cleaned);
      imported = cleaned.length;
      CACHE.clear();
    } else {
      for (const item of cleaned) {
        const hit = store.list().find((c) => c.type === item.type && c.name === item.name);
        if (hit) {
          const prev = hit.config || {};
          const cfg = { ...prev, ...item.config };
          for (const f of TYPES[item.type].fields || []) {
            if (!f.secret) continue;
            const v = item.config[f.key];
            if (v === undefined || v === null || v === '' || (typeof v === 'string' && v.startsWith('••••'))) {
              if (prev[f.key] !== undefined) cfg[f.key] = prev[f.key];
              else delete cfg[f.key];
            }
          }
          store.update(hit.id, { config: cfg, demo: item.demo });
          CACHE.delete(hit.id);
          updated += 1;
        } else {
          const row = store.add(item);
          CACHE.delete(row.id);
          imported += 1;
        }
      }
    }

    // 覆盖导入时若文件不含密钥，提醒哪些连接缺少凭据
    const missingSecrets =
      mode === 'replace'
        ? cleaned
            .filter((c) => (TYPES[c.type].fields || []).some((f) => f.secret && !c.config[f.key]))
            .map((c) => c.name)
        : [];

    return sendJson(res, 200, {
      ok: true,
      mode,
      imported,
      updated,
      skipped,
      missingSecrets,
      connections: store.list().map(publicConn)
    });
  }

  if (p === '/api/demo' && method === 'POST') {
    store.removeDemo();
    const presets = [
      { type: 'workbuddy', name: 'WorkBuddy（演示）' },
      { type: 'deepseek', name: 'DeepSeek（演示）' },
      { type: 'cloudflare', name: 'Cloudflare（演示）' },
      { type: 'baota', name: '宝塔面板（演示）' },
      { type: 'nezha', name: '哪吒面板（演示）' },
      { type: 'qinglong', name: '青龙面板（演示）' }
    ];
    for (const preset of presets) {
      store.add({ type: preset.type, name: preset.name, config: {}, demo: true });
    }
    return sendJson(res, 200, { connections: store.list().map(publicConn) });
  }

  if (p === '/api/demo' && method === 'DELETE') {
    store.removeDemo();
    return sendJson(res, 200, { connections: store.list().map(publicConn) });
  }

  return sendJson(res, 404, { error: 'Not Found' });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Content-Length': stat.size,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      serveStatic(req, res, url.pathname);
    } else {
      res.writeHead(405).end('Method Not Allowed');
    }
  } catch (err) {
    if (!res.headersSent) sendJson(res, 500, { error: err.message || '服务器内部错误' });
    else res.end();
  }
});

(async () => {
  // 支持用环境变量预置管理员密码（首次启动、auth.json 不存在时生效）
  if (!auth.isConfigured() && process.env.ADMIN_PASSWORD) {
    await auth.createPassword(process.env.ADMIN_USERNAME || 'admin', process.env.ADMIN_PASSWORD);
    process.stdout.write('  已根据 ADMIN_PASSWORD 初始化管理员账号\n');
  }

  server.listen(PORT, HOST, () => {
    const line = (s) => process.stdout.write(s + '\n');
    line('');
    line('  MultiPanel  多平台仪表盘已启动');
    line(`  → http://${HOST}:${PORT}`);
    line(`  数据目录：${store.DATA_DIR}`);
    if (AUTH_OFF) line('  ⚠ 已通过 AUTH_DISABLED=1 关闭登录鉴权');
    else if (!auth.isConfigured()) line('  管理员账号：尚未设置，首次打开页面时设置密码');
    else line(`  管理员账号：${auth.username()}（已登录 ${auth.sessionCount()} 个会话）`);
    if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
      line('  ⚠ 当前绑定非本机地址，面板含明文密钥，请务必加防火墙 / 反向代理认证');
    }
    line('');
  });
})();
