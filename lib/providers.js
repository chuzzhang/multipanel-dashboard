'use strict';

/**
 * 各平台适配器。每个适配器把第三方返回归一化成前端可直接渲染的 payload。
 * 约定：run(conn) -> { widget, payload }；失败直接 throw Error(可读中文提示)
 */

const crypto = require('node:crypto');

/* ------------------------------------------------------------------ */
/* 类型元数据（前端表单直接由它渲染）                                    */
/* ------------------------------------------------------------------ */

const TYPES = {
  workbuddy: {
    label: 'WorkBuddy',
    desc: '积分余额 / 套餐用量',
    color: '#4f46e5',
    mark: 'WB',
    hint:
      '官方没有公开的积分接口。推荐接自建网关 workbuddy2api（linguo2625469/workbuddy2api-panel）：' +
      '填网关地址和 api_key 即可自动读出积分、账号池与到期提醒；也可以手动记账或填自己的接口。',
    docs: 'https://github.com/linguo2625469/workbuddy2api-panel',
    fields: [
      {
        key: 'mode',
        label: '取数方式',
        type: 'select',
        default: 'wb2api',
        options: [
          { value: 'wb2api', label: 'workbuddy2api 网关（推荐）' },
          { value: 'manual', label: '手动记账' },
          { value: 'api', label: '自定义 API' }
        ]
      },
      {
        key: 'gatewayUrl',
        label: '网关地址',
        type: 'text',
        placeholder: 'http://127.0.0.1:7863',
        default: 'http://127.0.0.1:7863',
        when: 'mode=wb2api',
        help: 'workbuddy2api 的根地址，不要带 /panel；读取 /panel/api/overview（失败回退 /status）'
      },
      {
        key: 'gatewayKey',
        label: 'api_key',
        type: 'password',
        secret: true,
        when: 'mode=wb2api',
        placeholder: '网关 config.json 里的 api_key；未启用鉴权可留空'
      },
      { key: 'balance', label: '当前积分余额', type: 'number', placeholder: '1280', when: 'mode=manual', width: 'half' },
      { key: 'total', label: '积分总量（用于进度条）', type: 'number', placeholder: '2000', when: 'mode=manual', width: 'half' },
      { key: 'plan', label: '套餐名称', type: 'text', placeholder: 'Pro 年度', when: 'mode=manual', width: 'half' },
      { key: 'resetAt', label: '积分重置日期', type: 'date', when: 'mode=manual', width: 'half' },
      {
        key: 'baseUrl',
        label: '接口地址',
        type: 'text',
        placeholder: 'https://your-proxy.example.com/credits',
        when: 'mode=api',
        help: '服务端会 GET 这个地址，并自动寻找 credit/balance/quota 类数值字段'
      },
      { key: 'token', label: '访问令牌（可选）', type: 'password', secret: true, when: 'mode=api', width: 'half' },
      { key: 'jsonPath', label: '数值字段路径（可选）', type: 'text', placeholder: 'data.credits', when: 'mode=api', width: 'half' }
    ]
  },

  deepseek: {
    label: 'DeepSeek',
    desc: '账户余额 / 可用状态',
    color: '#4d6bfe',
    mark: 'DS',
    docs: 'https://platform.deepseek.com/api_keys',
    hint: '在 DeepSeek 开放平台创建 API Key，需要能读取余额的权限。',
    fields: [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        secret: true,
        required: true,
        placeholder: 'sk-...',
        help: '必须是 platform.deepseek.com 创建的 Key；中转站的 Key 不能用于官方接口'
      },
      {
        key: 'baseUrl',
        label: 'API 地址',
        type: 'text',
        placeholder: 'https://api.deepseek.com',
        default: 'https://api.deepseek.com',
        help: '只填到域名，带 /v1 会自动纠正；走中转站时改成中转站地址'
      }
    ]
  },

  cloudflare: {
    label: 'Cloudflare',
    desc: '域名 / 24h 请求量 / 威胁',
    color: '#f38020',
    mark: 'CF',
    docs: 'https://dash.cloudflare.com/profile/api-tokens',
    hint: '创建 API Token 时给权限：Zone → Zone: Read，Zone → Analytics: Read。',
    fields: [
      { key: 'apiToken', label: 'API Token', type: 'password', secret: true, required: true, placeholder: '粘贴 Zone 级 API Token' },
      { key: 'maxZones', label: '统计域名上限', type: 'number', placeholder: '10', width: 'half', default: '10' },
      { key: 'accountId', label: 'Account ID（可不填）', type: 'text', width: 'half' }
    ]
  },

  baota: {
    label: '宝塔面板',
    desc: 'CPU / 内存 / 磁盘 / 站点',
    color: '#20a53a',
    mark: 'BT',
    hint:
      '在宝塔「面板设置 → API 接口」开启接口、把本机公网 IP 加入白名单，再复制密钥；' +
      '8.x/9.x 的签名是 md5(时间 + md5(密钥))，旧版是 md5(时间 + 密钥)，两种都会自动尝试。' +
      '地址形如 http://1.2.3.4:8888，若开了「安全入口」要带上后缀路径。',
    fields: [
      { key: 'baseUrl', label: '面板地址', type: 'text', required: true, placeholder: 'http://1.2.3.4:8888' },
      { key: 'apiKey', label: 'API 密钥', type: 'password', secret: true, required: true, placeholder: '面板设置 → API 接口里获取' }
    ]
  },

  nezha: {
    label: '哪吒面板',
    desc: '服务器在线状态 / 负载',
    color: '#7c3aed',
    mark: 'NZ',
    hint: '在面板「用户 → 我的账号」里复制 API Token（管理员 Token 可看全部服务器）。',
    fields: [
      { key: 'baseUrl', label: '面板地址', type: 'text', required: true, placeholder: 'https://nezha.example.com' },
      { key: 'token', label: 'API Token', type: 'password', secret: true, required: true, placeholder: '用户页面的 API Token' }
    ]
  },

  qinglong: {
    label: '青龙面板',
    desc: '定时任务 / 运行状态',
    color: '#0ea5e9',
    mark: 'QL',
    hint:
      '推荐在青龙「系统设置 → 应用设置」创建应用，拿到 Client ID / Secret（OpenAPI 更稳定，2.21 起用 GET 取 token，已自动适配）；' +
      '也可以只填账号密码走 /api/user/login。',
    fields: [
      { key: 'baseUrl', label: '面板地址', type: 'text', required: true, placeholder: 'http://1.2.3.4:5700' },
      { key: 'clientId', label: 'Client ID（OpenAPI）', type: 'text', width: 'half' },
      { key: 'clientSecret', label: 'Client Secret', type: 'password', secret: true, width: 'half', placeholder: '应用密钥' },
      { key: 'username', label: '账号（备选）', type: 'text', width: 'half' },
      { key: 'password', label: '密码（备选）', type: 'password', secret: true, width: 'half', placeholder: '面板登录密码' }
    ]
  }
};

const TYPE_ORDER = ['workbuddy', 'deepseek', 'cloudflare', 'baota', 'nezha', 'qinglong'];

/* ------------------------------------------------------------------ */
/* 工具函数                                                             */
/* ------------------------------------------------------------------ */

function normBase(u) {
  return String(u || '').trim().replace(/\/+$/, '');
}

function num(v, d = 0) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : d;
  const n = parseFloat(String(v == null ? '' : v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : d;
}

function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
    const cap = k.charAt(0).toUpperCase() + k.slice(1);
    if (obj[cap] !== undefined && obj[cap] !== null && obj[cap] !== '') return obj[cap];
  }
  return undefined;
}

function trim(s, n = 200) {
  const t = String(s == null ? '' : s)
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

function looksLikeHtml(text) {
  const t = String(text || '').trim().slice(0, 200).toLowerCase();
  return t.startsWith('<!doctype') || t.startsWith('<html') || t.includes('<body');
}

async function httpJson(url, opts = {}, timeout = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_) {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, text };
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error(`请求超时（${Math.round(timeout / 1000)} 秒），请检查地址与网络连通性`);
    }
    const cause = err && err.cause && (err.cause.code || err.cause.message);
    throw new Error(`网络请求失败${cause ? `（${cause}）` : ''}：地址不可达或被防火墙拦截`);
  } finally {
    clearTimeout(timer);
  }
}

function findArray(node, depth = 0) {
  if (Array.isArray(node)) return node;
  if (!node || typeof node !== 'object' || depth > 4) return null;
  const preferred = ['data', 'servers', 'server', 'result', 'list', 'items', 'rows', 'crons'];
  for (const key of preferred) {
    if (node[key] !== undefined) {
      const found = findArray(node[key], depth + 1);
      if (found) return found;
    }
  }
  for (const key of Object.keys(node)) {
    const found = findArray(node[key], depth + 1);
    if (found) return found;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* WorkBuddy                                                            */
/* ------------------------------------------------------------------ */

function digPath(obj, pathStr) {
  if (!pathStr) return undefined;
  return String(pathStr)
    .split('.')
    .filter(Boolean)
    .reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}

function huntNumber(node, regex, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 4) return null;
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (typeof v === 'number' && regex.test(k) && v >= 0) return { key: k, value: v };
    if (typeof v === 'string' && regex.test(k) && v.trim() !== '' && Number.isFinite(Number(v))) {
      return { key: k, value: Number(v) };
    }
  }
  for (const k of Object.keys(node)) {
    const found = huntNumber(node[k], regex, depth + 1);
    if (found) return found;
  }
  return null;
}

function isoToMs(v) {
  if (!v) return 0;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

/**
 * workbuddy2api 网关（github.com/linguo2625469/workbuddy2api-panel）
 * 读取 /panel/api/overview（等价数据也从 /status 拿），汇总账号池积分。
 */
async function workbuddyGateway(cfg) {
  const base = normBase(cfg.gatewayUrl) || 'http://127.0.0.1:7863';
  const key = String(cfg.gatewayKey || '').trim();
  const headers = { Accept: 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;

  const paths = ['/panel/api/overview', '/status'];
  let json = null;
  let source = '';
  let lastErr = null;

  for (const apiPath of paths) {
    const res = await httpJson(`${base}${apiPath}`, { headers }, 15000);
    if (res.status === 401 || res.status === 403) {
      throw new Error('网关拒绝了请求（401/403）：检查 api_key 是否与网关 config.json 一致');
    }
    if (res.status === 404) {
      lastErr = new Error(`接口 ${apiPath} 不存在（404），请确认版本或地址是否正确`);
      continue;
    }
    if (!res.ok) {
      lastErr = new Error(`网关返回 HTTP ${res.status}${res.text ? '：' + trim(res.text, 120) : ''}`);
      continue;
    }
    if (!res.json || typeof res.json !== 'object') {
      lastErr = new Error(`接口 ${apiPath} 返回的不是 JSON，可能填错了端口/地址`);
      continue;
    }
    if (!Array.isArray(res.json.accounts)) {
      lastErr = new Error(`接口 ${apiPath} 里没有 accounts 字段，确认这是 workbuddy2api 网关`);
      continue;
    }
    json = res.json;
    source = apiPath;
    break;
  }
  if (!json) throw lastErr || new Error('无法读取网关状态');

  const accounts = json.accounts.map((a) => {
    const buckets = Array.isArray(a.credits_expiry_buckets) ? a.credits_expiry_buckets : [];
    const first = buckets.find((b) => num(b.remain) > 0) || buckets[0] || null;
    return {
      uid: String(a.uid || ''),
      name: String(a.nickname || a.uid || '未命名账号'),
      credits: num(a.credits),
      creditsTotal: num(a.credits_total),
      cooling: !!a.cooling,
      coolingLeft: num(a.cool_remaining_sec),
      disabled: !!a.disabled,
      disabledReason: String(a.disabled_reason || ''),
      paused: !!a.paused,
      realm: String(a.realm || ''),
      enterprise: !!a.enterprise,
      checkinDone: !!a.checkin_done,
      expiring: num(a.credits_expiring),
      earliestDate: first ? String(first.date || '') : ''
    };
  });

  const credits = accounts.reduce((x, a) => x + a.credits, 0);
  const known = accounts.filter((a) => a.creditsTotal > 0);
  const creditsTotal = known.reduce((x, a) => x + a.creditsTotal, 0);

  const count = (field, fallback) => (json[field] === undefined ? fallback : num(json[field], fallback));
  const counts = {
    total: count('total', accounts.length),
    healthy: count('healthy', accounts.filter((a) => !a.disabled && !a.cooling && !a.paused).length),
    cooling: count('cooling', accounts.filter((a) => a.cooling).length),
    disabled: count('disabled', accounts.filter((a) => a.disabled).length),
    paused: count('paused', accounts.filter((a) => a.paused).length)
  };

  // 各账号的到期批次按自然日合并
  const byDate = new Map();
  for (const a of json.accounts) {
    for (const b of a.credits_expiry_buckets || []) {
      const d = String(b.date || '');
      if (!d) continue;
      byDate.set(d, (byDate.get(d) || 0) + num(b.remain));
    }
  }
  const buckets = Array.from(byDate.entries())
    .filter(([, v]) => v > 0)
    .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
    .map(([date, remain]) => ({ date, remain }));

  const notes = [];
  if (!accounts.length) notes.push('网关里还没有账号，先在网关面板完成 OAuth 登录');
  if (accounts.length && known.length < accounts.length) notes.push('部分账号总额度未知，进度条只按已知部分合计');

  return {
    widget: 'workbuddy',
    payload: {
      mode: 'wb2api',
      balance: credits,
      total: creditsTotal,
      credits,
      creditsTotal,
      counts,
      accounts,
      expiring: { amount: buckets.reduce((x, b) => x + b.remain, 0), date: buckets[0] ? buckets[0].date : '' },
      buckets: buckets.slice(0, 4),
      version: String(json.version || ''),
      authRequired: !!json.auth_required,
      balanceRefreshedAt: isoToMs(json.balance_refreshed_at),
      uptimeSec: num(json.uptime_sec),
      source,
      note: notes.join('；')
    }
  };
}

async function workbuddy(cfg) {
  const mode = cfg.mode === 'wb2api' ? 'wb2api' : cfg.mode === 'api' ? 'api' : 'manual';
  if (mode === 'wb2api') return workbuddyGateway(cfg);

  if (mode === 'manual') {
    const balance = num(cfg.balance, 0);
    const total = num(cfg.total, 0);
    return {
      widget: 'workbuddy',
      payload: {
        mode: 'manual',
        balance,
        total,
        plan: String(cfg.plan || ''),
        resetAt: String(cfg.resetAt || ''),
        note: '手动记账模式：点卡片右上角「编辑」更新余额'
      }
    };
  }

  const url = normBase(cfg.baseUrl);
  if (!url) throw new Error('请填写接口地址');
  const headers = { Accept: 'application/json' };
  if (cfg.token) headers.Authorization = `Bearer ${String(cfg.token).trim()}`;
  const res = await httpJson(url, { headers });
  if (!res.ok) throw new Error(`接口返回 HTTP ${res.status}${res.text ? '：' + trim(res.text, 120) : ''}`);
  const json = res.json;
  if (json == null) throw new Error('接口返回的不是 JSON');

  let value;
  let key;
  if (cfg.jsonPath) {
    const raw = digPath(json, cfg.jsonPath);
    const n = num(raw, NaN);
    if (!Number.isFinite(n)) throw new Error(`字段路径 ${cfg.jsonPath} 没有取到数字`);
    value = n;
    key = cfg.jsonPath;
  } else {
    const found = huntNumber(json, /(credit|balance|point|quota|remain|available)/i);
    if (!found) throw new Error('没在返回里找到 credit/balance/quota 类数值，可手动指定字段路径');
    value = found.value;
    key = found.key;
  }

  const totalRaw = huntNumber(json, /(total|quota|limit|all)/i);
  return {
    widget: 'workbuddy',
    payload: {
      mode: 'api',
      balance: value,
      total: totalRaw && totalRaw.value > value ? totalRaw.value : 0,
      field: key,
      note: `来自自定义接口（字段 ${key}）`
    }
  };
}

/* ------------------------------------------------------------------ */
/* DeepSeek                                                             */
/* ------------------------------------------------------------------ */

// 用户常把文档里的 https://api.deepseek.com/v1 整段粘进来，这里做归一化
function deepseekBase(raw) {
  let base = normBase(raw) || 'https://api.deepseek.com';
  base = base.replace(/\/(v1|chat\/completions|models|user\/balance)\/?$/i, '');
  return base;
}

function cleanApiKey(raw) {
  return String(raw || '')
    .trim()
    .replace(/^["'`]|["'`]$/g, '')
    .replace(/^Bearer\s+/i, '')
    .trim();
}

function upstreamError(json) {
  if (!json) return '';
  if (json.error && (json.error.message || typeof json.error === 'string')) {
    return typeof json.error === 'string' ? json.error : json.error.message;
  }
  return json.message || json.msg || '';
}

async function deepseek(cfg) {
  const key = cleanApiKey(cfg.apiKey);
  if (!key) throw new Error('缺少 API Key');
  const base = deepseekBase(cfg.baseUrl);

  const paths = ['/user/balance'];
  if (!/\/v1$/i.test(base)) paths.push('/v1/user/balance');

  let res = null;
  let lastErr = '';

  for (const path of paths) {
    res = await httpJson(`${base}${path}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }
    });
    if (res.ok) break;
    if (res.status === 404) {
      lastErr = `接口 ${base}${path} 不存在（404）`;
      continue;
    }
    break;
  }

  if (!res || !res.ok) {
    const status = res ? res.status : 0;
    const msg = upstreamError(res && res.json) || trim((res && res.text) || '', 160);
    if (status === 401) {
      throw new Error(
        `Key 被拒绝（401）${msg ? '：' + msg : ''}。请确认 Key 来自 platform.deepseek.com 且未过期；如走中转站要把「API 地址」改成中转站地址`
      );
    }
    if (status === 402) throw new Error(`余额不足（402）${msg ? '：' + msg : ''}`);
    if (status === 403) throw new Error(`无权限或触发了风控（403）${msg ? '：' + msg : ''}`);
    if (status === 404) {
      throw new Error(
        `${lastErr || '接口不存在（404）'}。DeepSeek 余额接口固定是 /user/balance，地址只填到 https://api.deepseek.com（不要带 /v1）；若这是 OpenAI 兼容中转站，它通常没有余额接口`
      );
    }
    if (status >= 500) throw new Error(`DeepSeek 服务端错误（${status}）${msg ? '：' + msg : ''}`);
    if (res && !res.json && looksLikeHtml(res.text)) {
      throw new Error('该地址返回的是网页而不是接口：检查「API 地址」是否填成了控制台/中转站首页');
    }
    throw new Error(`DeepSeek 返回 HTTP ${status}${msg ? '：' + msg : ''}`);
  }

  const j = res.json || {};
  const balances = (Array.isArray(j.balance_infos) ? j.balance_infos : []).map((b) => ({
    currency: String(b.currency || 'CNY').toUpperCase(),
    total: num(b.total_balance, 0),
    granted: num(b.granted_balance, 0),
    toppedUp: num(b.topped_up_balance, 0)
  }));

  return {
    widget: 'deepseek',
    payload: {
      available: !!j.is_available,
      balances: balances.length ? balances : [{ currency: 'CNY', total: 0, granted: 0, toppedUp: 0 }],
      endpoint: `${base}/user/balance`,
      checkedAt: new Date().toISOString()
    }
  };
}

/* ------------------------------------------------------------------ */
/* Cloudflare                                                           */
/* ------------------------------------------------------------------ */

const CF_GQL = `query($tags:[String!],$since:Time!,$until:Time!){
  viewer {
    zones(filter:{zoneTag_in:$tags}) {
      zoneTag
      httpRequests1hGroups(limit:200, filter:{datetime_geq:$since, datetime_lt:$until}, orderBy:[datetime_ASC]) {
        dimensions { datetime }
        sum { requests bytes threats cachedBytes }
        uniq { uniques }
      }
    }
  }
}`;

async function cloudflare(cfg) {
  const token = String(cfg.apiToken || '').trim();
  if (!token) throw new Error('缺少 Cloudflare API Token');
  const api = 'https://api.cloudflare.com/client/v4';
  const auth = { Authorization: `Bearer ${token}` };

  const zres = await httpJson(`${api}/zones?per_page=50&order=name&direction=asc`, { headers: auth });
  if (zres.status === 403 || zres.status === 401) {
    throw new Error('Token 权限不足：需要 Zone:Read 与 Zone:Analytics:Read 两项权限');
  }
  if (zres.status === 400) {
    throw new Error('Token 格式不正确（400），请重新完整复制一次 API Token');
  }
  if (!zres.json || zres.json.success === false) {
    const msg = zres.json && zres.json.errors && zres.json.errors[0] && zres.json.errors[0].message;
    throw new Error(`Cloudflare 返回 HTTP ${zres.status}${msg ? '：' + msg : ''}`);
  }

  const zones = (zres.json.result || []).map((z) => ({
    id: z.id,
    name: z.name,
    status: z.status || 'unknown',
    plan: (z.plan && z.plan.name) || '-',
    paused: !!z.paused,
    requests: null,
    uniques: null,
    bytes: null,
    threats: null,
    cachedRatio: null,
    series: []
  }));

  if (!zones.length) {
    return { widget: 'cloudflare', payload: { zones: [], totals: null, note: '这个 Token 下没有可读的域名' } };
  }

  const maxZones = Math.max(1, Math.min(50, num(cfg.maxZones, 10) || 10));
  const targets = zones.slice(0, maxZones);
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const until = new Date().toISOString();

  let note = '';
  const byTag = new Map();

  const gql = await httpJson(`${api}/graphql`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: CF_GQL, variables: { tags: targets.map((z) => z.id), since, until } })
  });

  if (gql.json && gql.json.errors && gql.json.errors.length) {
    note = `GraphQL 统计失败：${gql.json.errors[0].message}（已尝试 REST 兜底）`;
  } else if (gql.json && gql.json.data && gql.json.data.viewer) {
    for (const z of gql.json.data.viewer.zones || []) {
      byTag.set(z.zoneTag, z.httpRequests1hGroups || []);
    }
  } else {
    note = `GraphQL 返回异常（HTTP ${gql.status}）`;
  }

  for (const zone of targets) {
    const groups = byTag.get(zone.id);
    if (Array.isArray(groups) && groups.length) {
      let requests = 0;
      let bytes = 0;
      let threats = 0;
      let cachedBytes = 0;
      let uniques = 0;
      const series = [];
      for (const g of groups) {
        const sum = g.sum || {};
        const uq = g.uniq || {};
        requests += num(sum.requests);
        bytes += num(sum.bytes);
        threats += num(sum.threats);
        cachedBytes += num(sum.cachedBytes);
        uniques = Math.max(uniques, num(uq.uniques));
        series.push({ t: (g.dimensions && g.dimensions.datetime) || '', v: num(sum.requests) });
      }
      zone.requests = requests;
      zone.bytes = bytes;
      zone.threats = threats;
      zone.uniques = uniques;
      zone.cachedRatio = bytes > 0 ? (cachedBytes / bytes) * 100 : null;
      zone.series = series;
    } else {
      // REST 兜底
      try {
        const dash = await httpJson(
          `${api}/zones/${zone.id}/analytics/dashboard?since=-1440&until=0&continuous=true`,
          { headers: auth }
        );
        const r = dash.json && dash.json.result;
        if (r && r.totals) {
          zone.requests = num(r.totals.requests && r.totals.requests.all);
          zone.bytes = num(r.totals.bandwidth && r.totals.bandwidth.all);
          zone.threats = num(r.totals.threats && r.totals.threats.all);
          zone.uniques = num(r.totals.uniques && r.totals.uniques.all);
          const cached = num(r.totals.bandwidth && r.totals.bandwidth.cached);
          zone.cachedRatio = zone.bytes > 0 ? (cached / zone.bytes) * 100 : null;
          zone.series = (r.timeseries || []).map((p) => ({
            t: p.until || p.since || '',
            v: num(p.requests && p.requests.all)
          }));
        }
      } catch (_) {
        /* 单域名失败不影响整体 */
      }
    }
  }

  const withData = targets.filter((z) => z.requests != null);
  const totals = withData.length
    ? {
        requests: withData.reduce((a, z) => a + z.requests, 0),
        bytes: withData.reduce((a, z) => a + (z.bytes || 0), 0),
        threats: withData.reduce((a, z) => a + (z.threats || 0), 0),
        uniques: withData.reduce((a, z) => a + (z.uniques || 0), 0),
        cachedRatio:
          withData.reduce((a, z) => a + (z.cachedRatio || 0), 0) / Math.max(1, withData.length)
      }
    : null;

  if (!totals) note = note || '没有取到统计数据，请确认 Token 是否有 Analytics 权限';

  return { widget: 'cloudflare', payload: { zones, totals, note, windowHours: 24 } };
}

/* ------------------------------------------------------------------ */
/* 宝塔面板                                                             */
/* ------------------------------------------------------------------ */

// 宝塔 8.x/9.x 起签名是 md5(request_time + md5(api_key))；老版本是 md5(request_time + api_key)
const btSchemeCache = new Map();

function btToken(apiKey, time, scheme) {
  const md5 = (str) => crypto.createHash('md5').update(str).digest('hex');
  return scheme === 'v1' ? md5(time + apiKey) : md5(time + md5(apiKey));
}

async function btPost(base, apiKey, pathAndQuery, scheme, extra) {
  const time = String(Math.floor(Date.now() / 1000));
  const params = Object.assign({ request_time: time, request_token: btToken(apiKey, time, scheme) }, extra || {});
  return httpJson(base + pathAndQuery, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString()
  });
}

function btHtmlHint(text, status) {
  if (looksLikeHtml(text)) {
    if (/login|安全入口|password/i.test(text)) {
      return '返回登录页：面板可能开了「安全入口」，地址要带入口后缀（如 https://ip:8888/abcd1234）';
    }
    return '返回网页而不是数据：API 接口未开启 / 密钥不对 / 本机 IP 不在白名单';
  }
  return `HTTP ${status}`;
}

function btParseSize(str) {
  const m = String(str || '').match(/([\d.]+)\s*(TB|GB|MB|KB|B)/i);
  if (!m) return 0;
  const v = num(m[1]);
  const unit = m[2].toUpperCase();
  const mul = { TB: 1048576, GB: 1024, MB: 1, KB: 1 / 1024, B: 1 / 1048576 };
  return v * (mul[unit] || 1);
}

// 宝塔磁盘返回：byte_size:[total,used,free]（字节），size:["95.8 GB",…,"43.67%",…]
function btDiskList(json) {
  const rows = Array.isArray(json) ? json : json && Array.isArray(json.data) ? json.data : [];
  const out = [];
  for (const row of rows) {
    if (!row) continue;
    let total = 0;
    let used = 0;
    let percent = 0;
    const bytes = Array.isArray(row.byte_size) ? row.byte_size : null;
    if (bytes && bytes.length >= 2) {
      total = num(bytes[0]) / 1048576;
      used = num(bytes[1]) / 1048576;
      percent = total > 0 ? (used / total) * 100 : 0;
    } else if (Array.isArray(row.size)) {
      total = btParseSize(row.size[0]);
      used = btParseSize(row.size[1]);
      percent = num(String(row.size[3] || '').replace('%', ''));
      if (!percent && total > 0) percent = (used / total) * 100;
    }
    if (total > 0) {
      out.push({ mount: row.path || row.mount || '/', total, used, percent: Math.min(100, percent) });
    }
  }
  return out.slice(0, 6);
}

// 站点数量：新版只有 /data?action=getData&table=sites 可用，/site?action=GetSiteList 会报「指定参数无效」
async function btSiteCount(base, apiKey, scheme) {
  const res = await btPost(base, apiKey, '/data?action=getData', scheme, { table: 'sites', limit: 200, p: 1, type: -1 });
  if (res.json) {
    if (Array.isArray(res.json.data)) return res.json.data.length;
    const m = String(res.json.page || '').match(/共\s*(\d+)\s*条/);
    if (m) return num(m[1]);
  }
  const fallback = await btPost(base, apiKey, '/site?action=GetSiteList', scheme);
  if (fallback.json) {
    const arr = Array.isArray(fallback.json) ? fallback.json : fallback.json.data;
    if (Array.isArray(arr)) return arr.length;
    if (fallback.json.siteTotal != null) return num(fallback.json.siteTotal);
  }
  return null;
}

async function baota(cfg) {
  const base = normBase(cfg.baseUrl);
  if (!base) throw new Error('请填写面板地址，例如 https://1.2.3.4:8888');
  const apiKey = String(cfg.apiKey || '').trim();
  if (!apiKey) throw new Error('缺少宝塔 API 密钥（面板设置 → API 接口里获取）');

  const cacheKey = `${base}|${apiKey}`;
  const preferred = btSchemeCache.get(cacheKey);
  const schemes = preferred ? [preferred, preferred === 'v2' ? 'v1' : 'v2'] : ['v2', 'v1'];

  let sys = null;
  let scheme = '';
  const errors = [];

  for (const candidate of schemes) {
    const res = await btPost(base, apiKey, '/system?action=GetSystemTotal', candidate);
    if (!res.json) {
      errors.push(btHtmlHint(res.text, res.status));
      continue;
    }
    const msg = String(res.json.msg || '');
    if (res.json.status === false || /密钥|校验失败|签名/i.test(msg)) {
      errors.push(msg || '密钥校验失败');
      continue;
    }
    sys = res.json;
    scheme = candidate;
    btSchemeCache.set(cacheKey, candidate);
    break;
  }

  if (!sys) {
    const detail = Array.from(new Set(errors)).join('；') || '未知原因';
    throw new Error(`宝塔鉴权失败：${detail}。请确认密钥来自「面板设置 → API 接口」，且本机公网 IP 已加入白名单`);
  }

  const memTotal = num(sys.memTotal);
  const memFree = num(sys.memFree);
  const buffers = num(sys.memBuffers);
  const cached = num(sys.memCached);
  const memUsed = num(sys.memRealUsed, Math.max(0, memTotal - memFree - buffers - cached));

  // 磁盘和站点互不依赖，并行取，减少一次往返
  const [disks, siteCount] = await Promise.all([
    btPost(base, apiKey, '/system?action=GetDiskInfo', scheme)
      .then((res) => (res.json ? btDiskList(res.json) : []))
      .catch(() => []),
    btSiteCount(base, apiKey, scheme).catch(() => null)
  ]);

  return {
    widget: 'baota',
    payload: {
      cpu: num(sys.cpuRealUsed),
      cores: num(sys.cpuNum, 0) || null,
      mem: {
        total: memTotal,
        used: memUsed,
        percent: memTotal > 0 ? Math.min(100, (memUsed / memTotal) * 100) : 0
      },
      disks,
      sites: siteCount,
      system: String(sys.system || ''),
      version: String(sys.version || ''),
      uptimeText: String(sys.time || ''),
      scheme
    }
  };
}

/* ------------------------------------------------------------------ */
/* 哪吒面板                                                             */
/* ------------------------------------------------------------------ */

// 哪吒 v1 的 /api/v1/server 没有 online 字段：按 last_active 距今是否超过 90 秒推算
const NEZHA_ONLINE_WINDOW = 90 * 1000;
const nezhaPathCache = new Map();

function normalizeNezha(s) {
  const host = s.host || {};
  const state = s.state || {};

  const memTotal = num(host.mem_total) || num(state.mem_total) || num(s.mem_total);
  const memUsed = num(state.mem_used) || num(s.mem_used);
  const diskTotal = num(host.disk_total) || num(state.disk_total) || num(s.disk_total);
  const diskUsed = num(state.disk_used) || num(s.disk_used);

  const lastActive = Date.parse(s.last_active || s.lastActive || '') || 0;
  const explicit = s.online !== undefined ? s.online : state.online;
  let online;
  if (explicit !== undefined && explicit !== null) {
    online = explicit === true || explicit === 1 || explicit === 'true';
  } else if (lastActive > 0) {
    online = Date.now() - lastActive < NEZHA_ONLINE_WINDOW;
  } else {
    // 老版本没给 last_active，有 state 就算在线
    online = Object.keys(state).length > 0;
  }

  const platformParts = [host.platform, host.platform_version].filter(Boolean);
  const osName = platformParts.join(' ').replace(/^([a-z])/, (m) => m.toUpperCase());

  return {
    name: String(s.name || s.Name || '未命名'),
    online,
    cpu: Math.max(0, Math.min(100, num(state.cpu, num(s.cpu)))),
    memUsed,
    memTotal,
    memPct: memTotal > 0 ? Math.min(100, (memUsed / memTotal) * 100) : 0,
    diskUsed,
    diskTotal,
    diskPct: diskTotal > 0 ? Math.min(100, (diskUsed / diskTotal) * 100) : 0,
    netIn: num(state.net_in_transfer) || num(s.net_in_transfer),
    netOut: num(state.net_out_transfer) || num(s.net_out_transfer),
    uptime: num(state.uptime) || num(s.uptime),
    platform: osName,
    version: String(host.version || s.version || ''),
    lastActive,
    load1: num(state.load_1, 0)
  };
}

async function nezha(cfg) {
  const base = normBase(cfg.baseUrl);
  if (!base) throw new Error('请填写哪吒面板地址');
  const token = String(cfg.token || '').trim();
  if (!token) throw new Error('缺少 API Token');

  const preferred = nezhaPathCache.get(base);
  const paths = preferred
    ? [preferred, ...['/api/v1/servers', '/api/v1/server'].filter((x) => x !== preferred)]
    : ['/api/v1/servers', '/api/v1/server'];

  let lastErr = null;

  for (const p of paths) {
    try {
      const res = await httpJson(base + p, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      if (res.status === 404) {
        lastErr = new Error('接口路径不存在（404），面板版本可能不匹配');
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error('Token 无效或无权限（401/403），请重新复制用户 API Token');
      }
      if (!res.ok) {
        lastErr = new Error(`哪吒面板返回 HTTP ${res.status}`);
        continue;
      }
      const arr = findArray(res.json);
      if (!arr) {
        lastErr = new Error('返回结构无法识别，可能是面板版本差异');
        continue;
      }
      nezhaPathCache.set(base, p);
      const servers = arr.map(normalizeNezha).slice(0, 60);
      return {
        widget: 'nezha',
        payload: {
          servers,
          online: servers.filter((x) => x.online).length,
          total: servers.length,
          windowSec: NEZHA_ONLINE_WINDOW / 1000,
          endpoint: p
        }
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('无法连接哪吒面板');
}

/* ------------------------------------------------------------------ */
/* 青龙面板                                                             */
/* ------------------------------------------------------------------ */

function normalizeCron(c) {
  const lastRun = num(c.last_execution_time || c.lastExecutionTime || c.last_running_time);
  // 2.21 的 status 是运行态（1=正常），禁用只看 isDisabled；旧版字段为 is_disabled
  const disabled = !!(Number(c.isDisabled) || Number(c.is_disabled));
  return {
    name: String(c.name || `任务 ${c.id || ''}`).slice(0, 60),
    schedule: String(c.schedule || c.cron || '').slice(0, 40),
    disabled,
    lastRun: lastRun > 1e12 ? lastRun : lastRun > 1e9 ? lastRun * 1000 : 0,
    command: trim(c.command, 60),
    status: num(c.status)
  };
}

// 青龙返回可能是数组，也可能是 { data, total } 分页结构
function cronListOf(json) {
  if (!json) return null;
  const payload = json.data;
  if (Array.isArray(payload)) return { list: payload, total: num(json.total, payload.length) };
  if (payload && Array.isArray(payload.data)) {
    return { list: payload.data, total: num(payload.total, payload.data.length) };
  }
  if (Array.isArray(json)) return { list: json, total: json.length };
  return null;
}

// 进程内缓存 OpenAPI token，避免 30 秒轮询反复鉴权
const qlTokenCache = new Map();

/**
 * 取 OpenAPI token。
 * 青龙 2.21+ 改成 GET + query（client_id / client_secret），旧版是 POST + JSON，两个都试。
 */
async function qinglongToken(base, cfg, errors) {
  const cacheKey = `${base}|${cfg.clientId}`;
  const cached = qlTokenCache.get(cacheKey);
  if (cached && cached.exp > Date.now()) return { token: cached.token, via: cached.via, cached: true };

  const id = String(cfg.clientId).trim();
  const secret = String(cfg.clientSecret).trim();
  const qs = new URLSearchParams({ client_id: id, client_secret: secret }).toString();

  const attempts = [
    {
      label: 'GET /open/auth/token',
      run: () => httpJson(`${base}/open/auth/token?${qs}`, { headers: { Accept: 'application/json' } })
    },
    {
      label: 'POST /open/auth/token',
      run: () =>
        httpJson(`${base}/open/auth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ client_id: id, client_secret: secret })
        })
    }
  ];

  for (const attempt of attempts) {
    try {
      const res = await attempt.run();
      const token = res.json && ((res.json.data && res.json.data.token) || res.json.token);
      if (token) {
        const expSec = num(res.json.data && res.json.data.expiration, 0);
        const ttl = expSec > 0 ? Math.min(expSec * 1000 - Date.now() - 60000, 3600 * 1000) : 1800 * 1000;
        if (ttl > 0) qlTokenCache.set(cacheKey, { token, via: attempt.label, exp: Date.now() + ttl });
        return { token, via: attempt.label };
      }
      if (res.status === 404) {
        errors.push(`${attempt.label} 不存在（404）`);
        continue;
      }
      const msg = res.json && (res.json.message || res.json.error);
      errors.push(`${attempt.label} 返回 ${res.status}${msg ? '：' + msg : ''}`);
    } catch (err) {
      errors.push(`${attempt.label} 失败：${err.message}`);
    }
  }
  return null;
}

async function qinglong(cfg) {
  const base = normBase(cfg.baseUrl);
  if (!base) throw new Error('请填写青龙面板地址');
  const errors = [];
  let token = null;
  let via = '';

  if (cfg.clientId && cfg.clientSecret) {
    const auth = await qinglongToken(base, cfg, errors);
    if (auth) {
      token = auth.token;
      via = /^GET/.test(auth.via) ? 'openapi-get' : 'openapi-post';
    }
  }

  let cronsData = null;

  if (token) {
    const res = await httpJson(`${base}/open/crons?page=1&size=200`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    });
    if (res.status === 401) {
      qlTokenCache.delete(`${base}|${cfg.clientId}`);
      errors.push('OpenAPI Token 被拒绝（401），请检查 Client ID / Secret 是否有效');
    } else if (!res.ok) {
      errors.push(`/open/crons 返回 HTTP ${res.status}`);
    } else {
      cronsData = cronListOf(res.json);
      if (!cronsData) errors.push('/open/crons 返回结构无法解析');
    }
  }

  // 账号密码兜底（也用于没配 OpenAPI 的情况）
  if (!cronsData && cfg.username && cfg.password) {
    const login = await httpJson(`${base}/api/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username: String(cfg.username), password: String(cfg.password) })
    });
    const loginToken = login.json && ((login.json.data && login.json.data.token) || login.json.token);
    if (loginToken) {
      const res = await httpJson(`${base}/api/crons?page=1&size=100&searchValue=`, {
        headers: { Authorization: `Bearer ${loginToken}`, Accept: 'application/json' }
      });
      if (res.ok) cronsData = cronListOf(res.json);
      if (!cronsData) errors.push(`账号登录成功但读取任务失败（HTTP ${res.status}）`);
      else via = 'login';
    } else {
      const msg = (login.json && (login.json.message || login.json.error)) || `HTTP ${login.status}`;
      errors.push(`账号密码登录失败：${msg}`);
    }
  }

  if (!cronsData) {
    if (!cfg.clientId && !cfg.username) {
      throw new Error('请填写 Client ID / Secret，或青龙的账号密码');
    }
    const detail = errors.length ? errors.join('；') : '未知原因';
    throw new Error(`青龙连接失败：${detail}。青龙 2.21 起 OpenAPI 只接受 GET 查询串，若仍失败请改用账号密码`);
  }

  const crons = cronsData.list.map(normalizeCron).slice(0, 200);
  const disabledCount = crons.filter((c) => c.disabled).length;
  const enabled = crons.length - disabledCount;
  const total = Math.max(cronsData.total || 0, crons.length);
  const notes = [];
  if (total > crons.length) notes.push(`共 ${total} 个任务，仅统计前 ${crons.length} 个`);

  return {
    widget: 'qinglong',
    payload: {
      total,
      enabled,
      disabled: disabledCount,
      crons,
      via,
      note: notes.join('；')
    }
  };
}

/* ------------------------------------------------------------------ */
/* 演示数据                                                             */
/* ------------------------------------------------------------------ */

function wave(base, amp, phase = 0) {
  const t = Date.now() / 60000;
  return Math.max(0, Math.round(base + Math.sin(t + phase) * amp + Math.cos(t / 3 + phase) * amp * 0.4));
}

function seriesOf(n, base, amp) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(wave(base, amp, i * 0.5));
  return out;
}

function demoPayload(type) {
  if (type === 'deepseek') {
    return {
      widget: 'deepseek',
      payload: {
        available: true,
        balances: [{ currency: 'CNY', total: 86.42, granted: 10, toppedUp: 76.42 }],
        checkedAt: new Date().toISOString()
      }
    };
  }
  if (type === 'cloudflare') {
    const zones = [
      { id: 'a', name: 'jdym.eu.org', status: 'active', plan: 'Free Website' },
      { id: 'b', name: 'api.jdym.eu.org', status: 'active', plan: 'Free Website' },
      { id: 'c', name: 'game.jdym.eu.org', status: 'active', plan: 'Free Website' }
    ].map((z, i) => {
      const s = seriesOf(24, 1800 + i * 900, 700);
      const requests = s.reduce((a, b) => a + b, 0);
      return {
        ...z,
        requests,
        uniques: Math.round(requests * 0.35),
        bytes: requests * 14500,
        threats: wave(12, 8, i),
        cachedRatio: 62 + i * 4,
        series: s.map((v, idx) => ({ t: String(idx), v }))
      };
    });
    return {
      widget: 'cloudflare',
      payload: {
        zones,
        totals: {
          requests: zones.reduce((a, z) => a + z.requests, 0),
          bytes: zones.reduce((a, z) => a + z.bytes, 0),
          threats: zones.reduce((a, z) => a + z.threats, 0),
          uniques: zones.reduce((a, z) => a + z.uniques, 0),
          cachedRatio: 66
        },
        windowHours: 24,
        note: ''
      }
    };
  }
  if (type === 'baota') {
    const memTotal = 8192;
    const memUsed = wave(3400, 400, 1);
    return {
      widget: 'baota',
      payload: {
        cpu: wave(23, 9, 2),
        cores: 4,
        mem: { total: memTotal, used: memUsed, percent: (memUsed / memTotal) * 100 },
        disks: [
          { mount: '/', total: 51200, used: 31800, percent: 62 },
          { mount: '/data', total: 102400, used: 24100, percent: 23.5 }
        ],
        sites: 6,
        system: 'Ubuntu 22.04',
        version: '9.2.0'
      }
    };
  }
  if (type === 'nezha') {
    const servers = [
      { name: 'oracle-sg-1', online: true, cpu: wave(18, 8), mem: [1240, 4096], disk: [18, 48], up: 86400 * 41 },
      { name: 'aws-hk-1', online: true, cpu: wave(31, 12), mem: [2100, 4096], disk: [22, 48], up: 86400 * 12 },
      { name: 'aws-syd-1', online: true, cpu: wave(9, 5), mem: [800, 2048], disk: [9, 48], up: 86400 * 7 },
      { name: 'racknerd-la', online: false, cpu: 0, mem: [0, 2048], disk: [12, 40], up: 0 }
    ].map((s) => ({
      name: s.name,
      online: s.online,
      cpu: s.online ? s.cpu : 0,
      memUsed: s.mem[0] * 1024 * 1024,
      memTotal: s.mem[1] * 1024 * 1024,
      memPct: (s.mem[0] / s.mem[1]) * 100,
      diskUsed: s.disk[0] * 1024 * 1024 * 1024,
      diskTotal: s.disk[1] * 1024 * 1024 * 1024,
      diskPct: (s.disk[0] / s.disk[1]) * 100,
      netIn: 1024 * 1024 * 1024 * 210,
      netOut: 1024 * 1024 * 1024 * 138,
      uptime: s.up,
      platform: 'Ubuntu 22.04',
      version: 'v1.0'
    }));
    return {
      widget: 'nezha',
      payload: { servers, online: servers.filter((s) => s.online).length, total: servers.length }
    };
  }
  if (type === 'qinglong') {
    const names = [
      ['签到 · 京东', '30 8 * * *'],
      ['签到 · 天翼云', '15 7 * * *'],
      ['羊毛 · 每日领豆', '0 9 * * *'],
      ['备份 · 数据库', '0 3 * * *'],
      ['清理 · 日志轮转', '0 4 * * 0'],
      ['推送 · 早报', '30 7 * * *'],
      ['同步 · 订阅仓库', '20 */6 * * *'],
      ['监控 · 到期提醒', '0 10 * * 1']
    ];
    const crons = names.map(([name, schedule], i) => ({
      name,
      schedule,
      disabled: i === 5 || i === 7,
      lastRun: Date.now() - (i + 1) * 3600 * 1000,
      command: 'task example.js',
      status: i === 5 || i === 7 ? 1 : 0
    }));
    const enabled = crons.filter((c) => !c.disabled).length;
    return {
      widget: 'qinglong',
      payload: { total: crons.length, enabled, disabled: crons.length - enabled, crons, via: 'demo' }
    };
  }
  // workbuddy（演示按 workbuddy2api 网关的数据形态渲染）
  const d1 = new Date(Date.now() + 9 * 86400 * 1000).toISOString().slice(0, 10);
  const d2 = new Date(Date.now() + 21 * 86400 * 1000).toISOString().slice(0, 10);
  return {
    widget: 'workbuddy',
    payload: {
      mode: 'wb2api',
      balance: 1280,
      total: 2000,
      credits: 1280,
      creditsTotal: 2000,
      counts: { total: 2, healthy: 1, cooling: 1, disabled: 0, paused: 0 },
      accounts: [
        {
          name: 'main-account',
          uid: 'wb_9f2c',
          credits: 980,
          creditsTotal: 1200,
          cooling: false,
          coolingLeft: 0,
          disabled: false,
          paused: false,
          realm: 'cn',
          enterprise: false,
          checkinDone: true,
          expiring: 180,
          earliestDate: d1
        },
        {
          name: 'backup-account',
          uid: 'wb_4a71',
          credits: 300,
          creditsTotal: 800,
          cooling: true,
          coolingLeft: 420,
          disabled: false,
          paused: false,
          realm: 'global',
          enterprise: false,
          checkinDone: false,
          expiring: 80,
          earliestDate: d2
        }
      ],
      expiring: { amount: 260, date: d1 },
      buckets: [
        { date: d1, remain: 180 },
        { date: d2, remain: 80 }
      ],
      version: 'v0.9.4',
      authRequired: true,
      balanceRefreshedAt: Date.now() - 4 * 60 * 1000,
      uptimeSec: 86400 * 3 + 7200,
      source: '/panel/api/overview',
      note: '演示数据 · 来自 workbuddy2api 网关'
    }
  };
}

/* ------------------------------------------------------------------ */
/* 统一入口                                                             */
/* ------------------------------------------------------------------ */

const ADAPTERS = { workbuddy, deepseek, cloudflare, baota, nezha, qinglong };

async function run(conn) {
  const started = Date.now();
  const adapter = ADAPTERS[conn.type];
  if (!adapter) throw new Error(`未知类型：${conn.type}`);

  if (conn.demo) {
    const demo = demoPayload(conn.type);
    return {
      ...demo,
      latency: Math.round(6 + Math.random() * 20),
      fetchedAt: new Date().toISOString(),
      demo: true
    };
  }

  const result = await adapter(conn.config || {});
  return {
    ...result,
    latency: Date.now() - started,
    fetchedAt: new Date().toISOString(),
    demo: false
  };
}

async function probe(type, config) {
  const adapter = ADAPTERS[type];
  if (!adapter) throw new Error(`未知类型：${type}`);
  const started = Date.now();
  const result = await adapter(config || {});
  return {
    ok: true,
    latency: Date.now() - started,
    widget: result.widget,
    preview: JSON.stringify(result.payload).slice(0, 400)
  };
}

module.exports = { TYPES, TYPE_ORDER, run, probe };
