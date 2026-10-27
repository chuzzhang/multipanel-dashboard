'use strict';

/* ============================================================
   基础工具
   ============================================================ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ICONS = {
  refresh:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  edit:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M13.5 6.5 17.5 10.5" stroke="currentColor" stroke-width="1.8"/></svg>',
  trash:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9.5 7V5h5v2M7 7l.8 12.2h8.4L17 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  external:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  warn:
    '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M10.3 4.2 3 17a2 2 0 0 0 1.7 3h14.6a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 9v4.5M12 16.8v.4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
};

const state = {
  types: {},
  order: [],
  connections: [],
  metrics: new Map(),
  loading: new Set(),
  busy: false,
  editingId: null,
  formType: null,
  formValues: {},
  formDemo: false,
  testResult: null,
  autoSec: Number(localStorage.getItem('mp.auto') || 0),
  timer: null,
  auth: { username: 'admin', configured: false, authenticated: false, authDisabled: false },
};

async function api(path, opts = {}) {
  const init = { headers: { 'Content-Type': 'application/json' }, ...opts };
  if (init.body && typeof init.body !== 'string') init.body = JSON.stringify(init.body);
  const res = await fetch(path, init);
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    /* ignore */
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = data && data.code;
    if (res.status === 401 && err.code === 'UNAUTHORIZED') openAuth('login');
    throw err;
  }
  return data;
}

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtNum(n, digits = 0) {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  let out;
  if (abs >= 1e8) out = (n / 1e8).toFixed(2).replace(/\.?0+$/, '') + ' 亿';
  else if (abs >= 1e4) out = (n / 1e4).toFixed(abs >= 1e5 ? 1 : 2).replace(/\.?0+$/, '') + ' 万';
  else out = n.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  return out;
}

function fmtMoney(n) {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtInt(n) {
  if (!Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('zh-CN');
}

function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

function fmtMB(mb) {
  if (!Number.isFinite(mb) || mb <= 0) return '0';
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

function fmtUptime(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  if (d > 0) return `${d} 天${h > 0 ? ` ${h} 小时` : ''}`;
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h} 小时${m > 0 ? ` ${m} 分` : ''}`;
  return `${m} 分钟`;
}

function fmtUptimeShort(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  const d = Math.floor(sec / 86400);
  if (d > 0) return `${d}天`;
  const h = Math.floor(sec / 3600);
  if (h > 0) return `${h}小时`;
  return `${Math.floor(sec / 60)}分`;
}

function timeAgo(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 0) return '刚刚';
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

let sparkSeq = 0;
function spark(values, opts = {}) {
  const vals = (values || []).map((v) => Number(v) || 0);
  if (!vals.length) return '<span class="zmeta">暂无趋势</span>';
  const w = opts.w || 88;
  const h = opts.h || 26;
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const span = Math.max(max - min, 1);
  const step = vals.length > 1 ? w / (vals.length - 1) : w;
  const pts = vals.map((v, i) => [i * step, h - 2 - ((v - min) / span) * (h - 6)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  const id = `spark${++sparkSeq}`;
  const last = pts[pts.length - 1];
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#${id})"/>
    <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="1.9" fill="var(--accent)"/>
  </svg>`;
}

function bar(percent, extraClass = '') {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  return `<div class="bar ${extraClass}"><i style="width:${p.toFixed(1)}%"></i></div>`;
}

function toneFor(percent, warnAt = 70, errAt = 88) {
  if (percent >= errAt) return 'err';
  if (percent >= warnAt) return 'warn';
  return 'ok';
}

function gauge(label, percent, valueText, sub) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  return `<div>
    <div class="gauge-k"><span>${esc(label)}</span></div>
    <div class="gauge-v">${valueText}</div>
    ${bar(p, toneFor(p))}
    <div class="gauge-sub">${esc(sub || '')}</div>
  </div>`;
}

/* ============================================================
   各平台渲染器
   ============================================================ */

function shortDate(d) {
  const m = String(d || '').match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : String(d || '');
}

function wb2apiCard(p) {
  const credits = Number.isFinite(p.credits) ? p.credits : Number(p.balance) || 0;
  const total = Number.isFinite(p.creditsTotal) ? p.creditsTotal : 0;
  const c = p.counts || {};
  const accs = p.accounts || [];
  const exp = p.expiring || {};
  const series = (p.series || []).map((x) => x.v);
  const pct = total > 0 ? Math.min(100, (credits / total) * 100) : 0;
  const updated = p.balanceRefreshedAt ? timeAgo(p.balanceRefreshedAt) : '';

  const chip =
    c.total > 0
      ? `<span class="chip ${c.healthy >= c.total ? 'ok' : 'warn'}">${c.healthy}/${c.total} 可用</span>`
      : '<span class="chip">无账号</span>';

  const parts = [
    `<div class="hero"><span class="hero-num">${fmtInt(credits)}</span><span class="hero-unit">积分</span>${chip}</div>`,
    `<div class="hero-note">${p.version ? `网关 ${esc(p.version)} · ` : ''}${
      updated ? `余额 ${esc(updated)}更新` : '来自账号池余额快照'
    }</div>`,
  ];

  if (total > 0) {
    parts.push('<div class="section-gap"></div>');
    parts.push(bar(pct, pct > 88 ? 'err' : pct > 70 ? 'warn' : ''));
    parts.push(
      `<div class="kv-line" style="margin-top:6px"><span>剩余 <b>${fmtInt(credits)}</b> / ${fmtInt(
        total
      )}</span><span>${pct.toFixed(0)}%</span></div>`
    );
  }

  const stats = [];
  if (exp.amount > 0) {
    stats.push(
      `<div class="stat"><div class="stat-k">即将到期${exp.date ? ' · ' + esc(shortDate(exp.date)) : ''}</div><div class="stat-v">${fmtInt(
        exp.amount
      )}</div></div>`
    );
  }
  stats.push(`<div class="stat"><div class="stat-k">冷却中</div><div class="stat-v">${fmtInt(c.cooling || 0)}</div></div>`);
  const pauseNote = c.paused ? ` · 暂停 ${c.paused}` : '';
  stats.push(`<div class="stat"><div class="stat-k">禁用${pauseNote}</div><div class="stat-v">${fmtInt(c.disabled || 0)}</div></div>`);
  parts.push(`<div class="section-gap"></div><div class="stat-row ${stats.length === 3 ? 'three' : ''}">${stats.join('')}</div>`);

  if (accs.length) {
    parts.push('<div class="section-gap"></div><div class="rows">');
    parts.push(
      accs
        .slice(0, 3)
        .map((a) => {
          const st = a.disabled
            ? ['err', '禁用']
            : a.paused
            ? ['warn', '暂停']
            : a.cooling
            ? ['warn', '冷却']
            : ['ok', '正常'];
          const meta = [];
          if (a.realm) meta.push(esc(a.realm));
          if (a.enterprise) meta.push('企业版');
          if (a.checkinDone) meta.push('已签到');
          if (a.cooling && a.coolingLeft) meta.push(`剩 ${fmtUptime(a.coolingLeft)}`);
          return `<div class="zrow">
            <div>
              <div class="zname" title="${esc(a.name)}">${esc(a.name)}</div>
              <div class="zmeta">${meta.length ? meta.join(' · ') : '—'}</div>
            </div>
            <span class="chip ${st[0]}">${st[1]}</span>
            <div class="zval">${fmtInt(a.credits)}<em>积分</em></div>
          </div>`;
        })
        .join('')
    );
    parts.push('</div>');
    if (accs.length > 3) parts.push(`<div class="hero-note">另有 ${accs.length - 3} 个账号未展示</div>`);
  }

  if (series.length > 1) {
    parts.push('<div class="section-gap"></div>');
    parts.push(
      `<div class="kv-line"><span>积分趋势 · ${series.length} 次记录</span>${spark(series, { w: 118, h: 30 })}</div>`
    );
  }
  if (p.note) parts.push(`<div class="hero-note" style="margin-top:8px">${esc(p.note)}</div>`);
  return parts.join('');
}

const RENDERERS = {
  workbuddy(p) {
    if (p.mode === 'wb2api') return wb2apiCard(p);
    const balance = Number.isFinite(p.balance) ? p.balance : 0;
    const total = Number.isFinite(p.total) ? p.total : 0;
    const pct = total > 0 ? Math.min(100, (balance / total) * 100) : 0;
    const series = (p.series || []).map((x) => x.v);
    let daysText = '';
    if (p.resetAt) {
      const days = Math.ceil((new Date(`${p.resetAt}T23:59:59`) - Date.now()) / 86400000);
      daysText = days >= 0 ? `${days} 天后重置` : '已过期';
    }

    const parts = [
      `<div class="hero"><span class="hero-num">${fmtNum(balance, 2)}</span><span class="hero-unit">积分</span></div>`,
    ];
    if (p.plan) parts.push(`<div class="hero-note">${esc(p.plan)}${daysText ? ' · ' + esc(daysText) : ''}</div>`);
    else if (daysText) parts.push(`<div class="hero-note">${esc(daysText)}</div>`);

    if (total > 0) {
      parts.push(`<div class="section-gap"></div>`);
      parts.push(bar(pct, pct > 88 ? 'err' : pct > 70 ? 'warn' : ''));
      parts.push(`<div class="kv-line" style="margin-top:6px"><span>剩余 <b>${fmtNum(balance, 0)}</b> / ${fmtNum(total, 0)}</span><span>${pct.toFixed(0)}%</span></div>`);
    }

    if (series.length > 1) {
      parts.push(`<div class="section-gap"></div>`);
      parts.push(`<div class="kv-line"><span>余额趋势 · ${series.length} 次记录</span>${spark(series, { w: 118, h: 30 })}</div>`);
    }
    if (p.note) parts.push(`<div class="hero-note" style="margin-top:8px">${esc(p.note)}</div>`);
    return parts.join('');
  },

  deepseek(p) {
    const list = p.balances && p.balances.length ? p.balances : [{ currency: 'CNY', total: 0, granted: 0, toppedUp: 0 }];
    const b = list[0];
    const sym = b.currency === 'USD' ? '$' : b.currency === 'CNY' ? '¥' : '';
    const parts = [
      `<div class="hero">
         <span class="hero-num">${sym}${fmtMoney(b.total)}</span>
         <span class="chip ${p.available ? 'ok' : 'err'}">${p.available ? '可用' : '不可用'}</span>
       </div>
       <div class="hero-note">${esc(b.currency)} · 账户余额</div>
       <div class="section-gap"></div>
       <div class="stat-row">
         <div class="stat"><div class="stat-k">赠送余额</div><div class="stat-v">${sym}${fmtMoney(b.granted)}</div></div>
         <div class="stat"><div class="stat-k">充值余额</div><div class="stat-v">${sym}${fmtMoney(b.toppedUp)}</div></div>
       </div>`,
    ];
    if (list.length > 1) {
      parts.push(`<div class="section-gap"></div>`);
      parts.push(
        list
          .slice(1)
          .map(
            (x) =>
              `<div class="kv-line"><span>${esc(x.currency)}</span><b>${fmtMoney(x.total)}</b></div>`
          )
          .join('')
      );
    }
    return parts.join('');
  },

  cloudflare(p) {
    const zones = p.zones || [];
    if (!zones.length) {
      return `<div class="err-box"><div class="err-title">没有可读域名</div><div class="err-msg">${esc(p.note || '当前 Token 下没有 zone')}</div></div>`;
    }
    const t = p.totals;
    const parts = [];
    if (t) {
      parts.push(`<div class="stat-row four">
        <div class="stat"><div class="stat-k">24h 请求</div><div class="stat-v">${fmtNum(t.requests)}</div></div>
        <div class="stat"><div class="stat-k">流量</div><div class="stat-v">${fmtBytes(t.bytes)}</div></div>
        <div class="stat"><div class="stat-k">独立访客</div><div class="stat-v">${fmtNum(t.uniques)}</div></div>
        <div class="stat"><div class="stat-k">威胁</div><div class="stat-v">${fmtNum(t.threats)}</div></div>
      </div>`);
    }
    parts.push(`<div class="section-gap"></div><div class="rows${zones.length > 5 ? ' scroll' : ''}">`);
    parts.push(
      zones
        .map((z) => {
          const has = z.requests != null;
          return `<div class="zrow">
            <div>
              <div class="zname" title="${esc(z.name)}">${esc(z.name)}</div>
              <div class="zmeta">
                <span class="chip ${z.status === 'active' ? 'ok' : z.status === 'paused' ? 'warn' : ''}">${esc(z.status)}</span>
                <span>${esc(z.plan)}</span>
                ${has && z.threats ? `<span>· 威胁 ${fmtNum(z.threats)}</span>` : ''}
              </div>
            </div>
            <div class="zval">${has ? fmtNum(z.requests) : '—'}<em>请求</em></div>
            ${has ? spark((z.series || []).map((s) => s.v)) : '<span></span>'}
          </div>`;
        })
        .join('')
    );
    parts.push('</div>');
    if (p.note) parts.push(`<div class="hero-note" style="margin-top:8px">${esc(p.note)}</div>`);
    return parts.join('');
  },

  baota(p) {
    const disks = p.disks || [];
    const d = disks[0];
    const mem = p.mem || { total: 0, used: 0, percent: 0 };
    const parts = [
      `<div class="gauges">
        ${gauge('CPU', p.cpu || 0, `${fmtNum(p.cpu || 0, 0)}%`, p.cores ? `${p.cores} 核` : '实时占用')}
        ${gauge('内存', mem.percent, fmtMB(mem.used), `共 ${fmtMB(mem.total)} · ${fmtNum(mem.percent, 0)}%`)}
        ${gauge('磁盘', d ? d.percent : 0, d ? `${fmtNum(d.percent, 0)}%` : '—', d ? `${fmtMB(d.used)} / ${fmtMB(d.total)}` : '未读取')}
      </div>`,
      `<div class="section-gap"></div>`,
      `<div class="stat-row three">
        <div class="stat"><div class="stat-k">站点</div><div class="stat-v">${p.sites == null ? '—' : fmtInt(p.sites)}</div></div>
        <div class="stat"><div class="stat-k">面板版本</div><div class="stat-v">${esc(p.version || '—')}</div></div>
        <div class="stat"><div class="stat-k">已运行</div><div class="stat-v">${esc(p.uptimeText || '—')}</div></div>
      </div>`,
      p.system ? `<div class="hero-note" style="margin-top:8px">${esc(p.system)}</div>` : '',
    ];
    if (disks.length > 1) {
      parts.push(`<div class="section-gap"></div>`);
      parts.push(
        disks
          .slice(1, 4)
          .map(
            (x) =>
              `<div class="kv-line" style="margin-top:4px"><span>${esc(x.mount)} · ${fmtMB(x.used)} / ${fmtMB(x.total)}</span><b>${fmtNum(x.percent, 0)}%</b></div>`
          )
          .join('')
      );
    }
    return parts.join('');
  },

  nezha(p) {
    const servers = p.servers || [];
    if (!servers.length) {
      return `<div class="err-box"><div class="err-title">没有服务器</div><div class="err-msg">Token 下没有可读的服务器，检查账号权限</div></div>`;
    }
    const netIn = servers.reduce((a, s) => a + (s.netIn || 0), 0);
    const netOut = servers.reduce((a, s) => a + (s.netOut || 0), 0);
    const parts = [
      `<div class="kv-line" style="margin-bottom:4px">
        <span>在线 <b>${p.online}</b> / ${p.total}</span>
        <span class="chip ${p.online === p.total ? 'ok' : 'warn'}" title="哪吒接口没有 online 字段，按 last_active 距今是否在 ${
          p.windowSec || 90
        } 秒内判定">${p.online === p.total ? '全部在线' : `${p.total - p.online} 台离线`}</span>
      </div>`,
      `<div class="rows">`,
      servers
        .slice(0, 6)
        .map(
          (s) => `<div class="srow">
            <div class="sname">
              <i class="status-dot ${s.online ? 'ok' : 'err'}"></i>
              <span title="${esc(s.name)}">${esc(s.name)}</span>
              ${s.platform ? `<em>${esc(s.platform)}</em>` : ''}
            </div>
            <div class="smini">
              <span><b>${s.online ? s.cpu.toFixed(0) + '%' : '—'}</b>CPU</span>
              <span><b>${s.online && s.memTotal ? s.memPct.toFixed(0) + '%' : '—'}</b>内存</span>
              <span><b>${s.online && s.diskTotal ? s.diskPct.toFixed(0) + '%' : '—'}</b>磁盘</span>
              ${
                s.online
                  ? `<span><b>${fmtUptimeShort(s.uptime)}</b>在线</span>`
                  : `<span><b>${s.lastActive ? timeAgo(s.lastActive) : '离线'}</b>${s.lastActive ? '活跃' : ''}</span>`
              }
            </div>
          </div>`
        )
        .join(''),
      `</div>`,
    ];
    if (servers.length > 6) {
      parts.push(`<div class="hero-note">另有 ${servers.length - 6} 台服务器未展示</div>`);
    }
    const online = servers.filter((s) => s.online);
    const memUsed = online.reduce((a, s) => a + (s.memUsed || 0), 0);
    const memTotal = online.reduce((a, s) => a + (s.memTotal || 0), 0);
    const diskUsed = online.reduce((a, s) => a + (s.diskUsed || 0), 0);
    const diskTotal = online.reduce((a, s) => a + (s.diskTotal || 0), 0);
    if (memTotal > 0) {
      parts.push(`<div class="section-gap"></div>
        <div class="stat-row">
          <div class="stat"><div class="stat-k">在线机内存</div><div class="stat-v">${fmtBytes(memUsed)} <span style="color:var(--faint);font-weight:500">/ ${fmtBytes(memTotal)}</span></div></div>
          <div class="stat"><div class="stat-k">在线机磁盘</div><div class="stat-v">${fmtBytes(diskUsed)} <span style="color:var(--faint);font-weight:500">/ ${fmtBytes(diskTotal)}</span></div></div>
        </div>`);
    }
    if (netIn || netOut) {
      parts.push(`<div class="section-gap"></div>
        <div class="kv-line"><span>累计流量</span><span>入 <b>${fmtBytes(netIn)}</b> · 出 <b>${fmtBytes(netOut)}</b></span></div>`);
    }
    return parts.join('');
  },

  qinglong(p) {
    const crons = p.crons || [];
    const parts = [
      `<div class="stat-row three">
        <div class="stat"><div class="stat-k">任务总数</div><div class="stat-v">${fmtInt(p.total)}</div></div>
        <div class="stat"><div class="stat-k">已启用</div><div class="stat-v" style="color:var(--ok)">${fmtInt(p.enabled)}</div></div>
        <div class="stat"><div class="stat-k">已禁用</div><div class="stat-v">${fmtInt(p.disabled)}</div></div>
      </div>
      <div class="section-gap"></div>
      <div class="rows">`,
    ];
    if (!crons.length) parts.push(`<div class="hero-note">没有任何定时任务</div>`);
    parts.push(
      crons
        .slice(0, 6)
        .map(
          (c) => `<div class="zrow">
            <div>
              <div class="zname" title="${esc(c.name)}">${esc(c.name)}</div>
              <div class="zmeta"><code>${esc(c.schedule || '未设置')}</code></div>
            </div>
            <span class="chip ${c.disabled ? '' : 'ok'}">${c.disabled ? '禁用' : '启用'}</span>
            <div class="zval">${c.lastRun ? timeAgo(c.lastRun).replace('前', '') : '—'}<em>${c.lastRun ? '上次运行' : '未运行'}</em></div>
          </div>`
        )
        .join('')
    );
    parts.push('</div>');
    if (crons.length > 6) parts.push(`<div class="hero-note">另有 ${crons.length - 6} 个任务未展示</div>`);
    if (p.note) parts.push(`<div class="hero-note" style="margin-top:4px">${esc(p.note)}</div>`);
    return parts.join('');
  },
};

/* ============================================================
   卡片 / 网格 / 概览
   ============================================================ */

const ERROR_HINTS = {
  deepseek:
    '接口固定为 /user/balance：「API 地址」只填 https://api.deepseek.com（带 /v1 也能自动纠正）。走中转站要改成中转站地址；Key 前后带空格或引号会自动清理。401 多为 Key 失效或不属于该站点。',
  cloudflare: 'Token 需要 Zone:Read + Zone.Analytics:Read；如果是 Account 级 Token 请确认包含目标域名。',
  baota: '宝塔面板需开启「API 接口」并把本机公网 IP 加入白名单，密钥在面板设置里重新获取。',
  nezha: '哪吒面板需使用用户 Token；自签证书已默认放行，仍失败请检查地址端口与反代路径。',
  qinglong: '优先用「应用设置」里的 Client ID / Secret；用账号登录时注意青龙可能开启了二步验证。',
  workbuddy:
    '网关模式：确认网关已启动（默认 :7863）且 api_key 与 config.json 一致，地址不要带 /panel；手动模式不需要网络。',
};

function safeLink(url) {
  if (!url) return null;
  const val = String(url).trim();
  return /^https?:\/\//i.test(val) ? val : null;
}

function cardLink(conn) {
  if (conn.demo) return null;
  const cfg = conn.config || {};
  switch (conn.type) {
    case 'workbuddy':
      if (cfg.mode === 'wb2api') return safeLink(`${String(cfg.gatewayUrl || 'http://127.0.0.1:7863').replace(/\/+$/, '')}/panel/`);
      if (cfg.mode === 'api') return safeLink(cfg.baseUrl);
      return null;
    case 'deepseek':
      return cfg.baseUrl && cfg.baseUrl !== 'https://api.deepseek.com'
        ? safeLink(cfg.baseUrl)
        : 'https://platform.deepseek.com/usage';
    case 'cloudflare':
      return 'https://dash.cloudflare.com/';
    case 'baota':
    case 'nezha':
    case 'qinglong':
      return safeLink(cfg.baseUrl);
    default:
      return null;
  }
}

function cardSub(conn) {
  if (conn.demo) return '演示数据 · 无需密钥';
  const cfg = conn.config || {};
  if (conn.type === 'workbuddy') {
    if (cfg.mode === 'wb2api') return `workbuddy2api · ${hostOf(cfg.gatewayUrl || 'http://127.0.0.1:7863')}`;
    return cfg.mode === 'api' ? `自定义接口 · ${hostOf(cfg.baseUrl)}` : '手动记账';
  }
  if (cfg.baseUrl) return hostOf(cfg.baseUrl);
  return state.types[conn.type] ? state.types[conn.type].desc : '';
}

function hostOf(url) {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch (_) {
    return String(url).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  }
}

function skeletonHTML() {
  return `<div class="skeleton">
    <div class="sk" style="height:30px;width:52%"></div>
    <div class="sk" style="height:10px;width:34%;margin-top:10px"></div>
    <div class="sk" style="height:6px;width:100%;margin-top:16px"></div>
    <div class="sk" style="height:34px;width:100%;margin-top:14px"></div>
  </div>`;
}

function errorHTML(conn, msg) {
  return `<div class="err-box">
    <div class="err-title">${ICONS.warn} 取数失败</div>
    <div class="err-msg">${esc(msg)}</div>
    <div class="err-hint">${esc(ERROR_HINTS[conn.type] || '')}</div>
  </div>`;
}

function cardHTML(conn) {
  const meta = state.types[conn.type] || { label: conn.type, color: '#3b6ef6', mark: '?' };
  const link = cardLink(conn);
  const m = state.metrics.get(conn.id);
  const loading = state.loading.has(conn.id);
  const dot = loading ? 'loading' : m ? (m.ok ? 'ok' : 'err') : '';

  let body;
  if (!m) body = skeletonHTML();
  else if (!m.ok) body = errorHTML(conn, m.error);
  else {
    const fn = RENDERERS[conn.type];
    body = fn ? fn(m.payload || {}) : `<pre style="font-size:11px;overflow:auto">${esc(JSON.stringify(m.payload, null, 2))}</pre>`;
  }

  const time = m && m.fetchedAt ? new Date(m.fetchedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '—';
  const latency = m && m.ok && Number.isFinite(m.latency) ? `${m.latency} ms` : m && m.ok === false ? '失败' : '—';

  return `<article class="card" data-card="${conn.id}" style="--accent:${meta.color}">
    <div class="card-head">
      <div class="card-mark">${
        link
          ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer" title="打开面板">${esc(meta.mark)}</a>`
          : esc(meta.mark)
      }</div>
      <div class="card-title">
        <h2><i class="status-dot ${dot}"></i>${
          link
            ? `<a class="card-title-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer" title="打开面板">${esc(conn.name)}</a>`
            : esc(conn.name)
        }</h2>
        <div class="card-sub">${esc(cardSub(conn))}</div>
      </div>
      <div class="card-actions">
        ${
          link
            ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer" title="打开面板">${ICONS.external}</a>`
            : ''
        }
        <button type="button" data-action="refresh" data-id="${conn.id}" title="刷新这一项">${ICONS.refresh}</button>
        <button type="button" data-action="edit" data-id="${conn.id}" title="编辑">${ICONS.edit}</button>
        <button type="button" class="del" data-action="del" data-id="${conn.id}" title="删除">${ICONS.trash}</button>
      </div>
    </div>
    <div class="card-body">${body}</div>
    <div class="card-foot">
      <span>${latency}</span><span class="sep"></span><span>${time}</span>
      <span class="grow"></span>
      ${conn.demo ? '<span class="chip">DEMO</span>' : ''}
      ${m && m.ok === false ? `<button type="button" data-action="refresh" data-id="${conn.id}">重试</button>` : ''}
    </div>
  </article>`;
}

function emptyHTML() {
  return `<div class="empty">
    <h3>还没有接入任何平台</h3>
    <p>添加连接后，这里会显示 WorkBuddy 积分、DeepSeek 余额、Cloudflare 请求量、宝塔资源占用、哪吒服务器状态和青龙任务列表。密钥只保存在本机服务端。</p>
    <div class="empty-steps">
      <div class="empty-step"><b>1</b>选择平台</div>
      <div class="empty-step"><b>2</b>填入 Token / 密钥</div>
      <div class="empty-step"><b>3</b>自动刷新看板</div>
    </div>
    <div class="empty-actions">
      <button class="btn primary" type="button" data-action="add">添加第一个连接</button>
      <button class="btn soft" type="button" data-action="demo">先看演示数据</button>
    </div>
  </div>`;
}

let masonRaf = 0;

/** 卡片高度不一，按真实高度换算 grid-row 跨度，避免整行被最高的卡片撑出空洞 */
function layoutMasonry() {
  if (masonRaf) cancelAnimationFrame(masonRaf);
  masonRaf = requestAnimationFrame(() => {
    masonRaf = 0;
    const grid = $('#grid');
    if (!grid || !grid.classList.contains('masonry')) return;
    const cards = Array.from(grid.children).filter((el) => el.classList.contains('card'));
    if (!cards.length) return;
    const cs = getComputedStyle(grid);
    const rowH = parseFloat(cs.gridAutoRows) || 8;
    const gap = parseFloat(cs.rowGap) || 16;

    cards.forEach((c) => {
      c.style.gridRowEnd = 'auto';
    });
    const spans = cards.map((c) => Math.max(1, Math.ceil((c.getBoundingClientRect().height + gap) / (rowH + gap))));
    cards.forEach((c, i) => {
      c.style.gridRowEnd = `span ${spans[i]}`;
    });
  });
}

function renderGrid() {
  const grid = $('#grid');
  grid.innerHTML = state.connections.length ? state.connections.map(cardHTML).join('') : emptyHTML();
  grid.classList.toggle('masonry', state.connections.length > 0);
  layoutMasonry();
}

function updateCard(id) {
  const conn = state.connections.find((c) => c.id === id);
  if (!conn) return;
  const el = document.querySelector(`[data-card="${id}"]`);
  if (!el) {
    renderGrid();
    return;
  }
  const tpl = document.createElement('div');
  tpl.innerHTML = cardHTML(conn);
  const next = tpl.firstElementChild;
  if (next) {
    next.style.animation = 'none';
    el.replaceWith(next);
    layoutMasonry();
  }
}

function renderSummary() {
  updateFoot();
  const el = $('#summary');
  if (!state.connections.length) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }

  const metrics = Array.from(state.metrics.values());
  const done = metrics.filter((m) => m && typeof m.ok === 'boolean');
  const okCount = done.filter((m) => m.ok).length;
  const errCount = done.filter((m) => !m.ok).length;

  const tiles = [
    {
      label: '连接状态',
      value: `${okCount}<small>/ ${state.connections.length}</small>`,
      sub: errCount > 0 ? `${errCount} 个取数失败` : done.length < state.connections.length ? '正在拉取…' : '全部正常',
      tone: errCount > 0 ? 'var(--err)' : 'var(--ok)',
    },
  ];

  let cfRequests = null;
  let nezhaOnline = null;
  let nezhaTotal = 0;
  let qlJobs = null;
  let wbCredits = null;
  let wbAccounts = 0;

  for (const conn of state.connections) {
    const m = state.metrics.get(conn.id);
    if (!m || !m.ok || !m.payload) continue;
    if (conn.type === 'cloudflare' && m.payload.totals) {
      cfRequests = (cfRequests || 0) + m.payload.totals.requests;
    }
    if (conn.type === 'nezha') {
      nezhaOnline = (nezhaOnline || 0) + (m.payload.online || 0);
      nezhaTotal += m.payload.total || 0;
    }
    if (conn.type === 'qinglong') {
      qlJobs = (qlJobs || 0) + (m.payload.total || 0);
    }
    if (conn.type === 'workbuddy' && m.payload.mode === 'wb2api') {
      wbCredits = (wbCredits || 0) + (Number(m.payload.credits) || 0);
      wbAccounts += (m.payload.counts && m.payload.counts.total) || 0;
    }
  }

  if (wbCredits != null) {
    tiles.push({
      label: 'WorkBuddy 积分',
      value: fmtInt(wbCredits),
      sub: `${wbAccounts} 个账号合计`,
      tone: '#4f46e5'
    });
  }
  if (cfRequests != null) {
    tiles.push({ label: 'Cloudflare · 24h', value: fmtNum(cfRequests), sub: '累计请求数', tone: '#f38020' });
  }
  if (nezhaOnline != null) {
    tiles.push({
      label: '服务器在线',
      value: `${nezhaOnline}<small>/ ${nezhaTotal}</small>`,
      sub: nezhaTotal - nezhaOnline > 0 ? `${nezhaTotal - nezhaOnline} 台离线` : '全部在线',
      tone: '#7c3aed',
    });
  }
  if (qlJobs != null) {
    tiles.push({ label: '青龙任务', value: fmtInt(qlJobs), sub: '定时任务总数', tone: '#0ea5e9' });
  }

  el.innerHTML = tiles
    .map(
      (t) => `<div class="sum-tile" style="--tone:${t.tone}">
        <div class="sum-label">${esc(t.label)}</div>
        <div class="sum-value">${t.value}</div>
        <div class="sum-sub">${esc(t.sub)}</div>
      </div>`
    )
    .join('');
  el.hidden = false;
}

function updateFoot() {
  const demoCount = state.connections.filter((c) => c.demo).length;
  const btn = $('#footAction');
  if (!btn) return;
  btn.hidden = demoCount === 0;
  btn.textContent = `清除 ${demoCount} 个演示连接`;
}

/* ============================================================
   数据刷新
   ============================================================ */

async function loadState(first = false) {
  const tasks = [api('/api/state')];
  if (first) tasks.push(api('/api/types'));
  const [st, types] = await Promise.all(tasks);
  if (types) {
    state.types = types.types;
    state.order = types.order;
  }
  state.connections = st.connections || [];
  // 清掉已删除连接的缓存
  for (const key of Array.from(state.metrics.keys())) {
    if (!state.connections.some((c) => c.id === key)) state.metrics.delete(key);
  }
}

async function refreshAll() {
  if (state.busy || !state.connections.length) {
    if (!state.connections.length) renderGrid();
    return;
  }
  state.busy = true;
  $('#refreshBtn').classList.add('spinning');

  const conns = state.connections.slice();
  conns.forEach((c) => state.loading.add(c.id));
  renderGrid();
  renderSummary();

  await Promise.all(
    conns.map(async (c) => {
      try {
        const m = await api(`/api/metrics/${c.id}?force=1`);
        state.metrics.set(c.id, m);
      } catch (err) {
        if (err && err.code === 'UNAUTHORIZED') return;
        state.metrics.set(c.id, { id: c.id, ok: false, error: err.message });
      } finally {
        state.loading.delete(c.id);
        updateCard(c.id);
      }
    })
  );

  state.busy = false;
  $('#refreshBtn').classList.remove('spinning');
  renderSummary();
  $('#footTime').textContent = `最后刷新 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
}

async function refreshOne(id) {
  const conn = state.connections.find((c) => c.id === id);
  if (!conn || state.loading.has(id)) return;
  state.loading.add(id);
  updateCard(id);
  try {
    const m = await api(`/api/metrics/${id}?force=1`);
    state.metrics.set(id, m);
  } catch (err) {
    if (err && err.code === 'UNAUTHORIZED') return;
    state.metrics.set(id, { id, ok: false, error: err.message });
  } finally {
    state.loading.delete(id);
    updateCard(id);
    renderSummary();
  }
}

/* ============================================================
   模态框
   ============================================================ */

function closeModal() {
  $('#modalRoot').innerHTML = '';
  state.editingId = null;
  state.formType = null;
  state.formValues = {};
  state.testResult = null;
}

function openModal(conn = null) {
  state.editingId = conn ? conn.id : null;
  state.formType = conn ? conn.type : null;
  state.testResult = null;
  state.formValues = {};
  state.formDemo = conn ? !!conn.demo : false;

  if (conn) {
    const cfg = { ...(conn.config || {}) };
    const meta = state.types[conn.type];
    (meta ? meta.fields : []).forEach((f) => {
      if (f.secret && typeof cfg[f.key] === 'string' && cfg[f.key].startsWith('••••')) cfg[f.key] = '';
    });
    state.formValues = cfg;
    if (!state.formValues.mode && conn.type === 'workbuddy') state.formValues.mode = 'manual';
  }
  renderModal();
}

function renderModal() {
  const root = $('#modalRoot');
  if (!state.formType) {
    root.innerHTML = `<div class="overlay" data-close="1"><div class="dialog" role="dialog" aria-modal="true">
      <div class="dialog-head">
        <div>
          <h3>接入一个平台</h3>
          <p>选择要显示在仪表盘上的服务</p>
        </div>
        <button class="icon-btn dialog-close" type="button" data-action="close" aria-label="关闭">✕</button>
      </div>
      <div class="dialog-body">
        <div class="type-grid">
          ${state.order
            .map((key) => {
              const t = state.types[key];
              if (!t) return '';
              return `<button class="type-card" type="button" data-pick="${key}" style="--c:${t.color}">
                <span class="mark">${esc(t.mark)}</span>
                <strong>${esc(t.label)}</strong>
                <span>${esc(t.desc)}</span>
              </button>`;
            })
            .join('')}
        </div>
      </div>
      <div class="dialog-foot">
        <span class="grow"></span>
        <button class="btn ghost" type="button" data-action="close">取消</button>
      </div>
    </div></div>`;
    return;
  }

  const meta = state.types[state.formType];
  const editing = state.connections.find((c) => c.id === state.editingId);
  const fields = (meta.fields || []).filter((f) => fieldVisible(f));

  const testBox = state.testResult
    ? `<div class="test-box ${state.testResult.ok ? 'ok' : 'err'}">
        <span>${state.testResult.ok ? '✓' : '✕'}</span>
        <div><b>${state.testResult.ok ? '连接成功' : '连接失败'}</b>${
          state.testResult.ok
            ? ` · 耗时 ${state.testResult.latency} ms`
            : ` · ${esc(state.testResult.error || '')}`
        }</div>
      </div>`
    : '';

  root.innerHTML = `<div class="overlay" data-close="1"><div class="dialog" role="dialog" aria-modal="true">
    <div class="dialog-head">
      <div class="card-mark" style="--accent:${meta.color}">${esc(meta.mark)}</div>
      <div>
        <h3>${editing ? '编辑 ' : '添加 '}${esc(meta.label)}</h3>
        <p>${esc(meta.desc)}</p>
      </div>
      <button class="icon-btn dialog-close" type="button" data-action="close" aria-label="关闭">✕</button>
    </div>
    <div class="dialog-body">
      ${meta.hint ? `<div class="type-hint"><span>ⓘ</span><div>${esc(meta.hint)}${
        meta.docs ? ` <a href="${esc(meta.docs)}" target="_blank" rel="noreferrer noopener">查看文档 ↗</a>` : ''
      }</div></div>` : ''}
      <div class="form-grid">
        <div class="field full">
          <label>显示名称</label>
          <input class="input" data-name="1" type="text" placeholder="${esc(meta.label)}" value="${esc(
            (editing && editing.name) || meta.label
          )}" />
        </div>
        ${fields.map((f) => fieldHTML(f, editing)).join('')}
        <div class="field full">
          <label class="check-line" for="demoToggle">
            <input type="checkbox" id="demoToggle" ${state.formDemo ? 'checked' : ''} />
            <span>使用演示数据<span class="check-hint">勾选后不请求真实接口，卡片显示示例数据</span></span>
          </label>
        </div>
      </div>
      ${testBox}
    </div>
    <div class="dialog-foot">
      <button class="btn ghost" type="button" data-action="back">← 换平台</button>
      <span class="grow"></span>
      <button class="btn ghost" type="button" data-action="test">测试连接</button>
      <button class="btn primary" type="button" data-action="save">${editing ? '保存修改' : '添加'}</button>
    </div>
  </div></div>`;

  const nameInput = $('[data-name="1"]', root);
  if (nameInput) {
    nameInput.addEventListener('input', () => {
      state.formValues.__name = nameInput.value;
    });
  }
  const demoToggle = $('#demoToggle', root);
  if (demoToggle) {
    demoToggle.addEventListener('change', () => {
      state.formDemo = demoToggle.checked;
    });
  }
  $$('[data-field]', root).forEach((input) => {
    const key = input.getAttribute('data-field');
    const handler = () => {
      state.formValues[key] = input.value;
      if (input.tagName === 'SELECT') {
        state.testResult = null;
        renderModal();
      }
    };
    input.addEventListener('input', handler);
    input.addEventListener('change', handler);
  });
}

function fieldVisible(f) {
  if (!f.when) return true;
  const [k, v] = f.when.split('=');
  const cur = state.formValues[k] !== undefined ? state.formValues[k] : defaultOf(k);
  return String(cur) === String(v);
}

function defaultOf(key) {
  const meta = state.types[state.formType];
  const f = (meta.fields || []).find((x) => x.key === key);
  if (!f) return undefined;
  if (f.default !== undefined) return f.default;
  if (f.type === 'select' && f.options && f.options.length) return f.options[0].value;
  return undefined;
}

function fieldHTML(f, editing) {
  const raw = state.formValues[f.key];
  let value = raw === undefined || raw === null ? '' : String(raw);
  if (f.secret && value.startsWith('••••')) value = '';
  if (value === '' && f.default !== undefined && !editing) value = String(f.default);

  const placeholder = f.secret && editing && raw && String(raw).startsWith('••••') ? raw : f.placeholder || '';
  const cls = `field ${f.width === 'half' ? 'half' : 'full'}`;
  const label = `<label for="f-${f.key}">${esc(f.label)}${f.required ? '<span class="req">*</span>' : ''}</label>`;

  let input;
  if (f.type === 'select') {
    input = `<select class="input" id="f-${f.key}" data-field="${f.key}">
      ${(f.options || [])
        .map(
          (o) =>
            `<option value="${esc(o.value)}" ${String(value) === String(o.value) ? 'selected' : ''}>${esc(o.label)}</option>`
        )
        .join('')}
    </select>`;
  } else {
    input = `<input class="input" id="f-${f.key}" data-field="${f.key}" type="${f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}"
      placeholder="${esc(placeholder)}" value="${esc(value)}" autocomplete="off" spellcheck="false" />`;
  }

  return `<div class="${cls}">${label}${input}${f.help ? `<div class="field-hint">${esc(f.help)}</div>` : ''}</div>`;
}

function collectConfig() {
  const meta = state.types[state.formType];
  const cfg = {};
  (meta.fields || []).forEach((f) => {
    if (!fieldVisible(f)) return;
    const v = state.formValues[f.key];
    if (v !== undefined && v !== '') cfg[f.key] = v;
    else if (f.type === 'select') cfg[f.key] = v || defaultOf(f.key);
  });
  return cfg;
}

async function probeConnection() {
  const btn = $('[data-action="test"]');
  if (btn) {
    btn.textContent = '测试中…';
    btn.disabled = true;
  }
  try {
    const res = await api('/api/probe', {
      method: 'POST',
      body: { type: state.formType, config: collectConfig(), id: state.editingId },
    });
    state.testResult = res;
  } catch (err) {
    state.testResult = { ok: false, error: err.message };
  }
  renderModal();
}

async function saveConnection() {
  const name = (state.formValues.__name || '').trim() || (state.types[state.formType].label);
  const config = collectConfig();

  // 填了真实凭据却还勾着「演示数据」→ 自动关掉，避免以为连上了其实看的是假数据
  const meta = state.types[state.formType];
  const hasSecret = (meta.fields || []).some((f) => f.secret && config[f.key] && String(config[f.key]).length > 0);
  if (state.formDemo && hasSecret) {
    state.formDemo = false;
    toast('检测到已填写凭据，已自动关闭演示模式');
  }
  const btn = $('[data-action="save"]');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '保存中…';
  }
  try {
    if (state.editingId) {
      await api(`/api/connections/${state.editingId}`, { method: 'PUT', body: { name, config, demo: state.formDemo } });
      toast('已保存修改', 'ok');
    } else {
      await api('/api/connections', { method: 'POST', body: { type: state.formType, name, config, demo: state.formDemo } });
      toast('已添加连接', 'ok');
    }
    closeModal();
    await loadState();
    renderGrid();
    renderSummary();
    await refreshAll();
  } catch (err) {
    toast(`保存失败：${err.message}`, 'err');
    if (btn) {
      btn.disabled = false;
      btn.textContent = '保存';
    }
  }
}

function openConfirm({ title, message, confirmText = '确认', danger = false, onConfirm }) {
  const root = $('#modalRoot');
  root.innerHTML = `<div class="overlay" data-close="1"><div class="dialog" style="width:min(420px,100%)" role="dialog" aria-modal="true">
    <div class="dialog-head"><div><h3>${esc(title)}</h3></div>
      <button class="icon-btn dialog-close" type="button" data-action="close" aria-label="关闭">✕</button>
    </div>
    <div class="dialog-body"><div class="confirm-text">${message}</div></div>
    <div class="dialog-foot"><span class="grow"></span>
      <button class="btn ghost" type="button" data-action="close">取消</button>
      <button class="btn ${danger ? 'danger' : 'primary'}" type="button" data-action="confirm">${esc(confirmText)}</button>
    </div>
  </div></div>`;
  const okBtn = $('[data-action="confirm"]', root);
  okBtn.addEventListener('click', async () => {
    okBtn.disabled = true;
    try {
      await onConfirm();
    } finally {
      closeModal();
    }
  });
}

/* ============================================================
   交互
   ============================================================ */

function toast(message, tone = '') {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${tone}`;
  el.innerHTML = `<span class="dot"></span><span>${esc(message)}</span>`;
  box.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 220);
  }, 3200);
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('mp.theme', theme);
}

function applyAuto() {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  $$('#autoGroup button').forEach((b) => {
    b.classList.toggle('on', Number(b.dataset.auto) === state.autoSec);
  });
  if (state.autoSec > 0) {
    state.timer = setInterval(() => {
      if (!document.hidden) refreshAll();
    }, state.autoSec * 1000);
  }
}

function bind() {
  $('#addBtn').addEventListener('click', () => openModal());

  $('#footAction').addEventListener('click', async () => {
    try {
      await api('/api/demo', { method: 'DELETE' });
      state.metrics.clear();
      await loadState();
      renderGrid();
      renderSummary();
      toast('演示数据已清除', 'ok');
    } catch (err) {
      toast(`清除失败：${err.message}`, 'err');
    }
  });

  $('#refreshBtn').addEventListener('click', () => {
    refreshAll();
    toast('正在刷新全部连接');
  });

  $('#accountBtn').addEventListener('click', () => {
    if (!state.auth.authenticated) {
      if ($('#authRoot').innerHTML) return; // 已经在登录/检查中
      openAuth(state.auth.configured ? 'login' : 'setup');
      return;
    }
    openAccount();
  });

  $('#themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    setTheme(cur === 'dark' ? 'light' : 'dark');
  });

  $('#autoGroup').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-auto]');
    if (!btn) return;
    state.autoSec = Number(btn.dataset.auto);
    localStorage.setItem('mp.auto', String(state.autoSec));
    applyAuto();
    toast(state.autoSec ? `每 ${state.autoSec} 秒自动刷新` : '已关闭自动刷新');
  });

  document.addEventListener('click', async (e) => {
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      state.formType = pick.dataset.pick;
      state.formValues = {};
      const meta = state.types[state.formType];
      (meta.fields || []).forEach((f) => {
        if (f.type === 'select') state.formValues[f.key] = f.default !== undefined ? f.default : (f.options[0] || {}).value;
      });
      state.testResult = null;
      renderModal();
      return;
    }

    if (e.target.closest('[data-action="close"]')) {
      closeModal();
      return;
    }
    if (e.target.closest('[data-action="back"]')) {
      state.formType = null;
      state.testResult = null;
      renderModal();
      return;
    }
    if (e.target.closest('[data-action="test"]')) {
      probeConnection();
      return;
    }
    if (e.target.closest('[data-action="save"]')) {
      saveConnection();
      return;
    }

    const demoBtn = e.target.closest('[data-action="demo"]');
    if (demoBtn) {
      demoBtn.disabled = true;
      demoBtn.textContent = '载入中…';
      try {
        await api('/api/demo', { method: 'POST' });
        await loadState();
        state.metrics.clear();
        renderGrid();
        renderSummary();
        await refreshAll();
        toast('已载入演示数据，可随时删除', 'ok');
      } catch (err) {
        toast(`载入失败：${err.message}`, 'err');
      }
      return;
    }

    const addAction = e.target.closest('[data-action="add"]');
    if (addAction) {
      openModal();
      return;
    }

    const actionEl = e.target.closest('[data-action][data-id]');
    if (actionEl) {
      const id = actionEl.dataset.id;
      const action = actionEl.dataset.action;
      const conn = state.connections.find((c) => c.id === id);
      if (action === 'refresh') return refreshOne(id);
      if (action === 'edit' && conn) return openModal(conn);
      if (action === 'del' && conn) {
        return openConfirm({
          title: '删除连接',
          message: `确定删除 <b>${esc(conn.name)}</b>？只删除本地保存的配置，不会影响该平台上的任何数据。`,
          confirmText: '删除',
          danger: true,
          onConfirm: async () => {
            await api(`/api/connections/${id}`, { method: 'DELETE' });
            state.metrics.delete(id);
            await loadState();
            renderGrid();
            renderSummary();
            toast('已删除', 'ok');
          },
        });
      }
    }

    if (e.target.classList && e.target.classList.contains('overlay') && e.target.dataset.close === '1') {
      closeModal();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#modalRoot').innerHTML) closeModal();
  });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layoutMasonry, 120);
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.autoSec > 0) refreshAll();
  });
}

/* ============================================================
   登录 / 账户
   ============================================================ */

function closeAuth() {
  $('#authRoot').innerHTML = '';
}

function showAuthError(msg) {
  const box = $('#authError');
  if (!box) return;
  box.textContent = msg;
  box.hidden = false;
}

function openAuth(mode) {
  const root = $('#authRoot');
  if (!root) return;

  if (mode === 'checking') {
    root.innerHTML = `<div class="auth-screen"><div class="auth-card">
      <div class="auth-loading"><span class="spinner"></span>正在检查登录状态…</div>
    </div></div>`;
    return;
  }

  const isSetup = mode === 'setup';
  const brand = `<div class="auth-head">
      <div class="brand-mark">
        <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 24V9l9 8 9-8v15" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div><h1>MultiPanel</h1><p>多平台仪表盘</p></div>
    </div>`;

  root.innerHTML = `<div class="auth-screen"><div class="auth-card">
    ${brand}
    <h2 class="auth-title">${isSetup ? '设置管理员密码' : '管理员登录'}</h2>
    <p class="auth-sub">${isSetup ? '首次使用，请为这个面板创建一个管理员密码' : '验证身份后即可查看全部连接与密钥'}</p>
    <form class="auth-form" id="authForm" autocomplete="on">
      <div class="field">
        <label for="authUser">用户名</label>
        <input class="input" id="authUser" name="username" type="text" value="${esc(state.auth.username || 'admin')}"
          autocomplete="username" spellcheck="false" ${isSetup ? '' : ''} />
      </div>
      <div class="field">
        <label for="authPass">密码</label>
        <div class="pass-wrap">
          <input class="input" id="authPass" name="password" type="password"
            placeholder="${isSetup ? '至少 8 位字符' : '请输入管理员密码'}"
            autocomplete="${isSetup ? 'new-password' : 'current-password'}" ${isSetup ? 'autofocus' : ''} />
          <button class="pass-toggle" type="button" data-pass="authPass">显示</button>
        </div>
      </div>
      ${isSetup ? `<div class="field">
        <label for="authPass2">确认密码</label>
        <input class="input" id="authPass2" type="password" placeholder="再输入一次" autocomplete="new-password" />
      </div>` : ''}
      <div class="auth-error" id="authError" hidden></div>
      <button class="btn primary auth-submit" type="submit" id="authSubmit">${isSetup ? '创建并进入' : '登录'}</button>
    </form>
    <p class="auth-note">${
      isSetup
        ? '至少 8 位；只以 scrypt 哈希保存在本机 <b>data/auth.json</b>。'
        : '登录状态保持 7 天。<b>忘记密码</b>时删除 data/auth.json 后重启服务即可重设。'
    }</p>
  </div></div>`;

  const form = $('#authForm');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitAuth(mode);
  });

  const toggle = root.querySelector('[data-pass]');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const input = $('#' + toggle.getAttribute('data-pass'));
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.textContent = show ? '隐藏' : '显示';
    });
  }
  if (!isSetup) {
    const pass = $('#authPass');
    if (pass) pass.focus();
  }
}

async function submitAuth(mode) {
  const user = ($('#authUser').value || '').trim() || 'admin';
  const pass = $('#authPass').value;
  const box = $('#authError');
  const btn = $('#authSubmit');
  if (box) box.hidden = true;

  if (mode === 'setup') {
    if (pass.length < 8) return showAuthError('密码至少 8 位');
    if (pass !== $('#authPass2').value) return showAuthError('两次输入的密码不一致');
  } else if (!pass) {
    return showAuthError('请输入密码');
  }

  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = mode === 'setup' ? '创建中…' : '登录中…';

  try {
    if (mode === 'setup') {
      await api('/api/auth/setup', { method: 'POST', body: { username: user, password: pass } });
    } else {
      await api('/api/auth/login', { method: 'POST', body: { username: user, password: pass } });
    }
    const st = await api('/api/auth/status');
    state.auth = st;
    closeAuth();
    toast(mode === 'setup' ? '管理员密码已设置' : '登录成功', 'ok');
    try {
      await startApp();
    } catch (err) {
      if (!err || err.code !== 'UNAUTHORIZED') bootError(err);
    }
  } catch (err) {
    showAuthError(err.message || '登录失败');
    btn.disabled = false;
    btn.textContent = label;
    const passInput = $('#authPass');
    if (passInput) {
      passInput.value = '';
      passInput.focus();
    }
  }
}

async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch (_) {
    /* 忽略 */
  }
  location.reload();
}

function openAccount() {
  const root = $('#modalRoot');
  const name = state.auth.username || 'admin';
  root.innerHTML = `<div class="overlay" data-close="1"><div class="dialog" style="width:min(440px,100%)" role="dialog" aria-modal="true">
    <div class="dialog-head">
      <div><h3>账户</h3><p>管理员登录与密码管理</p></div>
      <button class="icon-btn dialog-close" type="button" data-action="close" aria-label="关闭">✕</button>
    </div>
    <div class="dialog-body">
      <div class="acc-head">
        <div class="acc-avatar">${esc(name.slice(0, 2))}</div>
        <div><div class="acc-name">${esc(name)}</div><div class="acc-meta">管理员 · 会话保持 7 天</div></div>
      </div>
      <div class="acc-section-title">修改密码</div>
      <div class="form-grid">
        <div class="field full"><label>当前密码</label><input class="input" id="pwCur" type="password" autocomplete="current-password" /></div>
        <div class="field half"><label>新密码</label><input class="input" id="pwNew" type="password" autocomplete="new-password" placeholder="至少 8 位" /></div>
        <div class="field half"><label>确认新密码</label><input class="input" id="pwNew2" type="password" autocomplete="new-password" /></div>
      </div>
      <div class="auth-error" id="pwError" hidden style="margin-top:12px"></div>
    </div>
    <div class="dialog-foot">
      <button class="btn ghost" type="button" data-action="logout">退出登录</button>
      <span class="grow"></span>
      <button class="btn primary" type="button" data-action="changePw">保存新密码</button>
    </div>
  </div></div>`;

  $('[data-action="changePw"]').addEventListener('click', changePassword);
  $('[data-action="logout"]').addEventListener('click', logout);
}

async function changePassword() {
  const cur = $('#pwCur').value;
  const next = $('#pwNew').value;
  const next2 = $('#pwNew2').value;
  const box = $('#pwError');
  box.hidden = true;
  if (next.length < 8) {
    box.textContent = '新密码至少 8 位';
    box.hidden = false;
    return;
  }
  if (next !== next2) {
    box.textContent = '两次输入的新密码不一致';
    box.hidden = false;
    return;
  }
  try {
    await api('/api/auth/password', { method: 'POST', body: { current: cur, next } });
    closeModal();
    toast('密码已更新，其他设备已退出登录', 'ok');
  } catch (err) {
    box.textContent = err.message;
    box.hidden = false;
  }
}

/* ============================================================
   启动
   ============================================================ */

function bootError(err) {
  $('#grid').innerHTML = `<div class="empty">
    <h3>无法连接本地服务</h3>
    <p>请确认已在项目目录运行 <code>node server.js</code>，然后刷新页面。错误：${esc(err.message)}</p>
  </div>`;
}

async function startApp() {
  await loadState(true);
  renderGrid();
  renderSummary();
  if (state.connections.length) {
    refreshAll();
  } else {
    $('#footTime').textContent = '尚未添加连接';
  }

  const hashAdd = location.hash.match(/^#add(?::([a-z]+))?$/);
  if (hashAdd) {
    const preset = hashAdd[1] && state.types[hashAdd[1]] ? hashAdd[1] : null;
    openModal();
    if (preset) {
      state.formType = preset;
      state.formValues = {};
      (state.types[preset].fields || []).forEach((f) => {
        if (f.type === 'select') state.formValues[f.key] = f.default !== undefined ? f.default : (f.options[0] || {}).value;
      });
      renderModal();
    }
  }
}

(async function init() {
  const qs = new URLSearchParams(location.search);
  const themeParam = qs.get('theme');
  setTheme(themeParam === 'dark' || themeParam === 'light' ? themeParam : localStorage.getItem('mp.theme') || 'light');
  bind();
  applyAuto();
  openAuth('checking');

  let status = null;
  try {
    status = await api('/api/auth/status');
  } catch (_) {
    /* 服务未启动时会走到下面的 bootError */
  }

  if (status) {
    state.auth = status;
    if (!status.authDisabled && !status.authenticated) {
      openAuth(status.configured ? 'login' : 'setup');
      return;
    }
  }

  closeAuth();
  try {
    await startApp();
    setTimeout(layoutMasonry, 260);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(layoutMasonry);
  } catch (err) {
    if (err && err.code === 'UNAUTHORIZED') return;
    bootError(err);
  }
})();
