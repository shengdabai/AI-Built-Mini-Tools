'use strict';
/* 链接参数预检 · 纯逻辑(无 DOM)。不访问链接、不缩短链接。 */

const DEFAULTS = Object.freeze({
  required: Object.freeze(['utm_source', 'utm_medium', 'utm_campaign']),
  lowercaseValues: true,
  campaignPattern: '^[a-z0-9_-]+$',
  allowedDomains: Object.freeze([]),
  checkOrder: true
});
const MAX_BUILD = 5000;
const BUILD_FIELDS = ['source', 'medium', 'campaign', 'content', 'term'];

const RULES = {
  unparseable: { level: 'block', label: '无法解析' },
  scheme: { level: 'block', label: '协议不是 http(s)' },
  'missing-required': { level: 'block', label: '必填参数缺失' },
  'dup-conflict': { level: 'block', label: '重复参数且值不同' },
  'needs-encoding': { level: 'block', label: '值含未编码字符' },
  'no-protocol': { level: 'warn', label: '缺少协议' },
  'key-case': { level: 'warn', label: '参数名大小写' },
  'value-upper': { level: 'warn', label: '值含大写' },
  'campaign-pattern': { level: 'warn', label: 'campaign 命名' },
  'fragment-position': { level: 'warn', label: '片段位置' },
  'duplicate-link': { level: 'warn', label: '重复链接' },
  domain: { level: 'warn', label: '域名不在允许列表' },
  'param-order': { level: 'warn', label: '参数顺序不一致' },
  'dup-same': { level: 'warn', label: '参数重复(值相同)' }
};

/* ---------- 选项 ---------- */
function normDomain(d) {
  return String(d).trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^\*?\./, '').replace(/[/?#].*$/, '');
}

function resolveOptions(o) {
  const src = o && typeof o === 'object' ? o : {};
  const notes = [];
  const opts = {
    required: DEFAULTS.required.slice(),
    lowercaseValues: DEFAULTS.lowercaseValues,
    campaignPattern: DEFAULTS.campaignPattern,
    allowedDomains: [],
    checkOrder: DEFAULTS.checkOrder
  };
  if (Array.isArray(src.required)) opts.required = src.required.map(s => String(s).trim().toLowerCase()).filter(Boolean);
  if (typeof src.lowercaseValues === 'boolean') opts.lowercaseValues = src.lowercaseValues;
  if (typeof src.checkOrder === 'boolean') opts.checkOrder = src.checkOrder;
  if (Array.isArray(src.allowedDomains)) opts.allowedDomains = src.allowedDomains.map(normDomain).filter(Boolean);
  if (typeof src.campaignPattern === 'string' && src.campaignPattern !== '') {
    try { new RegExp(src.campaignPattern); opts.campaignPattern = src.campaignPattern; } catch (e) {
      notes.push('campaign 正则无法编译,已改用默认规则 ' + DEFAULTS.campaignPattern);
    }
  }
  opts.campaignRe = new RegExp(opts.campaignPattern);
  return { opts, notes };
}

/* 严格校验(用于读取本地存储的设置):不合法就整份拒绝 */
function validateSettings(obj) {
  const bad = msg => ({ ok: false, error: msg });
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return bad('设置不是对象');
  const keys = ['required', 'lowercaseValues', 'campaignPattern', 'allowedDomains', 'checkOrder'];
  for (const k of Object.keys(obj)) if (!keys.includes(k)) return bad('未知字段 ' + k);
  for (const k of keys) if (!(k in obj)) return bad('缺少字段 ' + k);
  if (!Array.isArray(obj.required) || obj.required.length > 20 ||
      !obj.required.every(s => typeof s === 'string' && /^[A-Za-z0-9_.-]{1,40}$/.test(s))) return bad('必填参数列表不合法');
  if (typeof obj.lowercaseValues !== 'boolean') return bad('lowercaseValues 必须是布尔值');
  if (typeof obj.checkOrder !== 'boolean') return bad('checkOrder 必须是布尔值');
  if (typeof obj.campaignPattern !== 'string' || obj.campaignPattern.length > 200) return bad('campaign 正则不合法');
  try { new RegExp(obj.campaignPattern); } catch (e) { return bad('campaign 正则无法编译'); }
  if (!Array.isArray(obj.allowedDomains) || obj.allowedDomains.length > 100 ||
      !obj.allowedDomains.every(s => typeof s === 'string' && /^[A-Za-z0-9.-]{1,253}$/.test(s))) return bad('允许域名列表不合法');
  return { ok: true, value: {
    required: obj.required.slice(), lowercaseValues: obj.lowercaseValues, campaignPattern: obj.campaignPattern,
    allowedDomains: obj.allowedDomains.slice(), checkOrder: obj.checkOrder
  } };
}

/* ---------- 编码工具 ---------- */
function encodePart(s) {
  const a = Array.from(String(s));
  let out = '';
  for (let i = 0; i < a.length; i++) {
    const ch = a[i];
    if (/[A-Za-z0-9\-._~!*'()+,;:@/?$=]/.test(ch)) { out += ch; continue; }
    if (ch === '%') {
      const nx = String(a[i + 1]) + String(a[i + 2]);
      if (/^[0-9a-fA-F]{2}$/.test(nx)) { out += '%' + nx.toUpperCase(); i += 2; } else out += '%25';
      continue;
    }
    try { out += encodeURIComponent(ch); } catch (e) { out += '%EF%BF%BD'; }
  }
  return out;
}
/* 表格单元格是原始值:字面 + 编为 %2B,字面 % 编为 %25 */
function rawEncode(s) {
  return Array.from(String(s)).map(ch => { try { return encodeURIComponent(ch); } catch (e) { return '%EF%BF%BD'; } }).join('');
}
function hexUpper(s) { return s.replace(/%[0-9a-fA-F]{2}/g, m => m.toUpperCase()); }
function needsEncoding(s) { return encodePart(s) !== hexUpper(s); }
function safeDecode(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
function hasUpper(s) { return /[A-Z]/.test(s.replace(/%[0-9a-fA-F]{2}/g, '')); }
function lowerValue(s) {
  return s.replace(/%[0-9a-fA-F]{2}|%|[^%]+/g, m => (m.length === 3 && m[0] === '%' ? m.toUpperCase() : m.toLowerCase()));
}
const isUtm = k => /^utm_/i.test(k);
const canonKey = k => (isUtm(k) ? k.toLowerCase() : k);

/* ---------- 解析 ---------- */
function hasScheme(t) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^(javascript|mailto|data|file|tel|ftp|blob|sms):/i.test(t);
}
function failure(raw, code, error) { return { ok: false, raw: String(raw == null ? '' : raw), code, error }; }
function parseQuery(q) {
  if (!q) return [];
  return q.split('&').filter(s => s !== '').map(seg => {
    const i = seg.indexOf('=');
    const key = i >= 0 ? seg.slice(0, i) : seg;
    return { key, dkey: safeDecode(key), value: i >= 0 ? seg.slice(i + 1) : '', hasEq: i >= 0 };
  });
}

function parseUrl(text) {
  const raw = typeof text === 'string' ? text : '';
  const t = raw.trim();
  if (!t) return failure(raw, 'unparseable', '空链接');
  if (/[\u0000-\u001f\u007f]/.test(t)) return failure(raw, 'unparseable', '含控制字符');
  let added = false;
  let s = t;
  if (!hasScheme(t)) { s = 'https://' + t.replace(/^\/\//, ''); added = true; }
  const m = /^([a-z][a-z0-9+.-]*):(.*)$/is.exec(s);
  if (!m) return failure(raw, 'unparseable', '无法识别为链接');
  const scheme = m[1].toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') return failure(raw, 'scheme', '协议是 ' + scheme + ':,只接受 http 或 https');
  const rest = m[2].replace(/^\/\//, '');
  const hi = rest.indexOf('#');
  const beforeHash = hi >= 0 ? rest.slice(0, hi) : rest;
  const hashPart = hi >= 0 ? rest.slice(hi + 1) : null;
  const am = /^[^/?]*/.exec(beforeHash)[0];
  const tail = beforeHash.slice(am.length);
  const qi = tail.indexOf('?');
  const path = qi < 0 ? tail : tail.slice(0, qi);
  const rawQuery = qi < 0 ? '' : tail.slice(qi + 1);
  let fragment = null;
  let fragQuery = '';
  let fragmentBeforeParams = false;
  if (hashPart !== null) {
    const hq = hashPart.indexOf('?');
    if (hq >= 0) { fragment = hashPart.slice(0, hq); fragQuery = hashPart.slice(hq + 1); fragmentBeforeParams = true; } else fragment = hashPart;
  }
  if (!am) return failure(raw, 'unparseable', '缺少主机名');
  let u;
  try { u = new URL(scheme + '://' + am + '/'); } catch (e) { return failure(raw, 'unparseable', '主机名无法解析'); }
  const hn = u.hostname;
  if (!hn) return failure(raw, 'unparseable', '缺少主机名');
  if (!/^[a-z0-9._-]+$/i.test(hn) && !/^\[[0-9a-f:.]+\]$/i.test(hn)) return failure(raw, 'unparseable', '主机名含非法字符(如空格)');
  if (hn.indexOf('.') < 0 && hn !== 'localhost' && hn[0] !== '[') return failure(raw, 'unparseable', '主机名「' + hn + '」缺少域名后缀');
  return {
    ok: true, raw, text: t, scheme, added, host: u.host, hostname: hn,
    userinfo: u.username ? u.username + (u.password ? ':' + u.password : '') + '@' : '',
    path, params: parseQuery(rawQuery).concat(parseQuery(fragQuery)),
    fragment, fragmentBeforeParams
  };
}

/* ---------- 规范化 ---------- */
function normalize(url, options) {
  const { opts } = resolveOptions(options);
  const p = typeof url === 'string' ? parseUrl(url) : url;
  if (!p || !p.ok) return { ok: false, code: p && p.code, error: p ? p.error : '无法解析' };
  const seen = new Set();
  const list = [];
  p.params.forEach(prm => {
    const k = isUtm(prm.dkey) ? encodePart(prm.dkey.toLowerCase()) : encodePart(prm.key);
    let v = encodePart(prm.value);
    if (isUtm(prm.dkey) && opts.lowercaseValues) v = lowerValue(v);
    const id = k + '\u0000' + safeDecode(v);
    if (seen.has(id)) return;
    seen.add(id);
    list.push({ k, v, hasEq: prm.hasEq, i: list.length });
  });
  list.sort((a, b) => {
    const x = a.k.toLowerCase(); const y = b.k.toLowerCase();
    return x < y ? -1 : x > y ? 1 : a.i - b.i;
  });
  const q = list.map(e => (e.hasEq ? e.k + '=' + e.v : e.k)).join('&');
  let out = p.scheme + '://' + (p.userinfo || '') + p.host + encodePart(p.path);
  if (q) out += '?' + q;
  if (p.fragment) out += '#' + encodePart(p.fragment);
  return { ok: true, url: out, changed: out !== p.text, added: p.added };
}

/* ---------- 检查 ---------- */
function isSubsequence(a, b) {
  let j = 0;
  for (let i = 0; i < b.length && j < a.length; i++) if (b[i] === a[j]) j++;
  return j === a.length;
}
function domainAllowed(host, list) {
  return list.some(d => host === d || host.endsWith('.' + d));
}

function check(urls, options) {
  const { opts, notes } = resolveOptions(options);
  const entries = (Array.isArray(urls) ? urls : []).map((u, i) => (
    typeof u === 'string' ? { raw: u, row: i + 1 } : { raw: String(u && u.raw != null ? u.raw : ''), row: u && u.row != null ? u.row : i + 1 }
  )).filter(e => e.raw.trim() !== '');
  const issues = [];
  const add = (e, code, message, extra) => issues.push(Object.assign({ row: e.row, raw: e.raw, level: RULES[code].level, code, message }, extra || {}));
  const parsedList = [];
  const normMap = new Map();

  entries.forEach(e => {
    const p = parseUrl(e.raw);
    if (!p.ok) { add(e, p.code, p.error); parsedList.push({ e, p }); return; }
    parsedList.push({ e, p });
    if (p.added) add(e, 'no-protocol', '没有协议,已按 https:// 补全判断');
    opts.required.forEach(r => {
      const hit = p.params.find(x => x.dkey.toLowerCase() === r && safeDecode(x.value).trim() !== '');
      if (!hit) add(e, 'missing-required', '缺少必填参数 ' + r);
    });
    const groups = new Map();
    p.params.forEach(x => {
      const ck = canonKey(x.dkey);
      if (!groups.has(ck)) groups.set(ck, []);
      groups.get(ck).push(x);
    });
    groups.forEach((arr, ck) => {
      if (arr.length < 2) return;
      const vals = Array.from(new Set(arr.map(x => safeDecode(x.value))));
      if (vals.length > 1) add(e, 'dup-conflict', '参数 ' + ck + ' 出现 ' + arr.length + ' 次且值不同:' + vals.join('、'));
      else add(e, 'dup-same', '参数 ' + ck + ' 重复出现 ' + arr.length + ' 次,值相同');
    });
    p.params.forEach(x => {
      const lk = x.dkey.toLowerCase();
      if (isUtm(x.dkey) && x.dkey !== lk) add(e, 'key-case', '参数名 ' + x.dkey + ' 大小写混用,应为 ' + lk, { fix: lk });
      const keyBad = needsEncoding(x.key);
      const valBad = needsEncoding(x.value);
      if (keyBad || valBad) {
        const enc = encodePart(valBad ? x.value : x.key);
        add(e, 'needs-encoding', '参数 ' + canonKey(x.dkey) + (valBad ? ' 的值「' + x.value + '」' : ' 的名称') + ' 含未编码字符(空格、中文等),编码后为 ' + enc, { fix: enc });
      }
      if (isUtm(x.dkey) && !valBad) {
        if (opts.lowercaseValues && hasUpper(x.value)) add(e, 'value-upper', '参数 ' + lk + ' 的值「' + x.value + '」含大写,约定小写', { fix: lowerValue(x.value) });
        if (lk === 'utm_campaign') {
          const dv = safeDecode(x.value);
          if (dv !== '' && !opts.campaignRe.test(dv)) add(e, 'campaign-pattern', 'utm_campaign「' + dv + '」不符合命名规则 ' + opts.campaignPattern);
        }
      }
    });
    if (p.fragmentBeforeParams) add(e, 'fragment-position', '片段 # 出现在参数之前,后面的参数会被浏览器当作片段,应把 # 片段放到最后');
    if (opts.allowedDomains.length && !domainAllowed(p.hostname, opts.allowedDomains)) {
      add(e, 'domain', '域名 ' + p.hostname + ' 不在允许列表(' + opts.allowedDomains.join('、') + ')');
    }
    const n = normalize(p, opts);
    normMap.set(e.row, n);
  });

  /* 重复链接 */
  const firstRow = new Map();
  parsedList.forEach(({ e, p }) => {
    if (!p.ok) return;
    const key = normMap.get(e.row).url;
    if (firstRow.has(key)) add(e, 'duplicate-link', '与第 ' + firstRow.get(key) + ' 行是同一条链接(规范化后相同)');
    else firstRow.set(key, e.row);
  });

  /* 同一域名下参数顺序 */
  if (opts.checkOrder) {
    const byHost = new Map();
    parsedList.forEach(({ e, p }) => {
      if (!p.ok) return;
      const seq = [];
      p.params.forEach(x => { if (isUtm(x.dkey) && !seq.includes(x.dkey.toLowerCase())) seq.push(x.dkey.toLowerCase()); });
      if (!byHost.has(p.hostname)) byHost.set(p.hostname, []);
      byHost.get(p.hostname).push({ e, seq });
    });
    byHost.forEach(arr => {
      const multi = arr.filter(x => x.seq.length >= 2);
      if (multi.length < 2) return;
      const counts = new Map();
      multi.forEach(x => { const k = x.seq.join('>'); counts.set(k, (counts.get(k) || 0) + 1); });
      let refKey = null; let best = 0;
      counts.forEach((c, k) => { if (c > best) { best = c; refKey = k; } });
      const ref = refKey.split('>');
      multi.forEach(x => {
        if (!isSubsequence(x.seq, ref) && !isSubsequence(ref, x.seq)) {
          add(x.e, 'param-order', 'UTM 参数顺序(' + x.seq.join(' → ') + ')与同域名多数链接(' + ref.join(' → ') + ')不一致');
        }
      });
    });
  }

  issues.sort((a, b) => a.row - b.row || (a.level === b.level ? 0 : a.level === 'block' ? -1 : 1));
  const rowLevel = new Map();
  issues.forEach(i => {
    if (i.level === 'block') rowLevel.set(i.row, 'block');
    else if (rowLevel.get(i.row) !== 'block') rowLevel.set(i.row, 'warn');
  });
  const results = parsedList.map(({ e, p }) => {
    const n = p.ok ? normMap.get(e.row) : null;
    return { row: e.row, raw: e.raw, level: rowLevel.get(e.row) || 'ok', normalized: n ? n.url : null, changed: n ? n.changed : false };
  });
  const byCode = Object.create(null);
  issues.forEach(i => { byCode[i.code] = (byCode[i.code] || 0) + 1; });
  const stats = {
    total: entries.length,
    blocked: results.filter(r => r.level === 'block').length,
    warned: results.filter(r => r.level === 'warn').length,
    clean: results.filter(r => r.level === 'ok').length,
    blockIssues: issues.filter(i => i.level === 'block').length,
    warnIssues: issues.filter(i => i.level === 'warn').length,
    byCode, notes
  };
  return { issues, stats, results };
}

/* ---------- CSV / 批量解析 ---------- */
function normText(text) { return String(text == null ? '' : text).replace(/^﻿/, '').replace(/\r\n?/g, '\n'); }

/* 返回 [{line, fields:[{value,start,end}]}],start/end 是在 text 中的偏移 */
function parseCsvRecords(text) {
  const recs = [];
  recs.unclosed = 0;
  let i = 0; let line = 1; const n = text.length;
  while (i < n) {
    const rec = { line, fields: [] };
    let done = false;
    while (!done) {
      const start = i;
      let value = '';
      if (text[i] === '"') {
        const qLine = line;
        i++;
        for (;;) {
          if (i >= n) { if (!recs.unclosed) recs.unclosed = qLine; break; }
          if (text[i] === '"') {
            if (text[i + 1] === '"') { value += '"'; i += 2; continue; }
            i++; break;
          }
          if (text[i] === '\n') line++;
          value += text[i++];
        }
        const end = i;
        while (i < n && text[i] !== ',' && text[i] !== '\n') { value += text[i]; i++; }
        rec.fields.push({ value, start, end: i > end ? i : end });
      } else {
        while (i < n && text[i] !== ',' && text[i] !== '\n') i++;
        value = text.slice(start, i);
        rec.fields.push({ value, start, end: i });
      }
      if (i >= n) { done = true; } else if (text[i] === ',') { i++; if (i >= n) { rec.fields.push({ value: '', start: i, end: i }); done = true; } } else { i++; line++; done = true; }
    }
    recs.push(rec);
  }
  return recs;
}

const URL_HEADER = /^(url|link|href|链接|网址|地址)$/i;

function parseBatch(text) {
  const t = normText(text);
  if (t.trim() === '') return [];
  const firstLine = t.split('\n').find(l => l.trim() !== '') || '';
  const head = parseCsvRecords(firstLine)[0];
  const col = head ? head.fields.findIndex(f => URL_HEADER.test(f.value.trim())) : -1;
  const out = [];
  if (col >= 0) {
    const recs = parseCsvRecords(t);
    if (recs.unclosed) { out.error = '链接 CSV 第 ' + recs.unclosed + ' 行的引号没有闭合,已拒绝整份输入'; return out; }
    let skipped = false;
    recs.forEach(r => {
      if (!skipped) { skipped = true; return; }
      const f = r.fields[col];
      if (!f || f.value.trim() === '') return;
      out.push({ row: r.line, raw: f.value.trim(), start: f.start, end: f.end, csv: true });
    });
    return out;
  }
  let pos = 0;
  t.split('\n').forEach((ln, idx) => {
    const lead = ln.length - ln.trimStart().length;
    const trimmed = ln.trim();
    if (trimmed !== '') out.push({ row: idx + 1, raw: trimmed, start: pos + lead, end: pos + lead + trimmed.length, csv: false });
    pos += ln.length + 1;
  });
  return out;
}

/* replacements: Map 或对象,row → 新链接 */
function applyAdoptions(text, entries, replacements) {
  let t = normText(text);
  const get = r => (replacements instanceof Map ? replacements.get(r) : replacements[r]);
  entries.slice().sort((a, b) => b.start - a.start).forEach(e => {
    let r = get(e.row);
    if (typeof r !== 'string' || r === '') return;
    if (e.csv && /[",\n]/.test(r)) r = '"' + r.replace(/"/g, '""') + '"';
    t = t.slice(0, e.start) + r + t.slice(e.end);
  });
  return t;
}

/* ---------- 批量构建 ---------- */
function parseTable(text) {
  const t = normText(text);
  if (t.trim() === '') return { rows: [], errors: [] };
  const all = parseCsvRecords(t);
  if (all.unclosed) return { rows: [], errors: ['参数表第 ' + all.unclosed + ' 行的引号没有闭合,已拒绝整份参数表'] };
  const recs = all.filter(r => r.fields.some(f => f.value.trim() !== ''));
  if (!recs.length) return { rows: [], errors: [] };
  const names = recs[0].fields.map(f => f.value.trim().toLowerCase().replace(/^utm_/, ''));
  const hasHeader = names.some(x => BUILD_FIELDS.includes(x));
  const map = hasHeader ? names : BUILD_FIELDS;
  const rows = [];
  (hasHeader ? recs.slice(1) : recs).forEach(r => {
    const row = { line: r.line };
    BUILD_FIELDS.forEach(f => { row[f] = ''; });
    r.fields.forEach((f, i) => { if (BUILD_FIELDS.includes(map[i])) row[map[i]] = f.value.trim(); });
    if (BUILD_FIELDS.some(f => row[f] !== '')) rows.push(row);
  });
  return { rows, errors: [] };
}

function splitValues(v) {
  if (Array.isArray(v)) return v.map(s => String(s).trim()).filter(Boolean);
  return String(v == null ? '' : v).split('|').map(s => s.trim()).filter(Boolean);
}

function build(base, rows, options) {
  const { opts } = resolveOptions(options);
  const pb = parseUrl(base);
  if (!pb.ok) return { ok: false, error: '基础链接' + (pb.error ? ':' + pb.error : '无法解析'), links: [], errors: [], count: 0 };
  const required = opts.required.map(r => r.replace(/^utm_/, '')).filter(r => BUILD_FIELDS.includes(r));
  const errors = [];
  const plans = [];
  let total = 0;
  (Array.isArray(rows) ? rows : []).forEach((row, idx) => {
    const line = row && row.line != null ? row.line : idx + 1;
    const vals = {};
    BUILD_FIELDS.forEach(f => { vals[f] = splitValues(row ? row[f] : ''); });
    const miss = required.filter(f => vals[f].length === 0);
    if (miss.length) { errors.push({ row: line, message: '第 ' + line + ' 行缺少 ' + miss.map(f => 'utm_' + f).join('、') + ',' }); return; }
    const used = BUILD_FIELDS.filter(f => vals[f].length);
    if (!used.length) return;
    const cnt = used.reduce((a, f) => a * vals[f].length, 1);
    total += cnt;
    plans.push({ line, vals, used });
  });
  if (errors.length) return { ok: false, error: '参数表有 ' + errors.length + ' 行不合法,已拒绝整份构建,不提供部分结果', links: [], errors, count: 0 };
  if (total > MAX_BUILD) return { ok: false, error: '组合数 ' + total + ' 超过上限 ' + MAX_BUILD + ',请拆分参数表', links: [], errors, count: 0 };
  const links = [];
  plans.forEach(pl => {
    let combos = [{}];
    pl.used.forEach(f => {
      const next = [];
      combos.forEach(c => pl.vals[f].forEach(v => next.push(Object.assign({}, c, { [f]: v }))));
      combos = next;
    });
    combos.forEach(c => {
      const keep = pb.params.filter(x => !pl.used.some(f => x.dkey.toLowerCase() === 'utm_' + f));
      const added = pl.used.map(f => ({ key: 'utm_' + f, dkey: 'utm_' + f, value: rawEncode(c[f]), hasEq: true }));
      const n = normalize(Object.assign({}, pb, { params: keep.concat(added), text: '', fragmentBeforeParams: false }), opts);
      links.push(Object.assign({ row: pl.line, url: n.url }, BUILD_FIELDS.reduce((o, f) => { o[f] = c[f] || ''; return o; }, {})));
    });
  });
  return { ok: true, links, errors, count: links.length };
}

/* ---------- 导出 ---------- */
function guard(v) {
  const s = v == null ? '' : String(v);
  if (s === '-' || s === '+') return s;
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}
function csvCell(v) {
  const s = guard(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(header, rows) {
  return [header].concat(rows).map(r => r.map(csvCell).join(',')).join('\n') + '\n';
}
function levelLabel(l) { return l === 'block' ? '阻断' : l === 'warn' ? '警告' : '通过'; }
function issuesToCsv(issues) {
  return toCsv(['行号', '级别', '规则', '说明', '原链接'],
    issues.map(i => [i.row, levelLabel(i.level), RULES[i.code] ? RULES[i.code].label : i.code, i.message, i.raw]));
}
function normalizedToCsv(results) {
  return toCsv(['行号', '状态', '原链接', '建议链接', '是否变化'],
    results.filter(r => r.normalized).map(r => [r.row, levelLabel(r.level), r.raw, r.normalized, r.changed ? '是' : '否']));
}
function buildToCsv(links) {
  return toCsv(['来源 utm_source', '媒介 utm_medium', '活动 utm_campaign', '内容 utm_content', '关键词 utm_term', '链接'],
    links.map(l => [l.source, l.medium, l.campaign, l.content, l.term, l.url]));
}
function mdCell(v) { return guard(v).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' '); }
function issuesToMarkdown(issues, stats) {
  const lines = ['# 链接参数预检结果', ''];
  if (stats) lines.push('共 ' + stats.total + ' 条链接:阻断 ' + stats.blocked + ' 条,仅警告 ' + stats.warned + ' 条,通过 ' + stats.clean + ' 条。', '');
  if (!issues.length) { lines.push('没有发现问题。'); return lines.join('\n') + '\n'; }
  lines.push('| 行号 | 级别 | 规则 | 说明 | 原链接 |', '| --- | --- | --- | --- | --- |');
  issues.forEach(i => {
    lines.push('| ' + [i.row, levelLabel(i.level), RULES[i.code] ? RULES[i.code].label : i.code, i.message, i.raw].map(mdCell).join(' | ') + ' |');
  });
  return lines.join('\n') + '\n';
}

const api = {
  DEFAULTS, RULES, MAX_BUILD, BUILD_FIELDS,
  resolveOptions, validateSettings, parseUrl, check, normalize, build, parseBatch, parseTable, applyAdoptions,
  encodePart, toCsv, issuesToCsv, normalizedToCsv, buildToCsv, issuesToMarkdown, levelLabel
};
globalThis.UrlCheckCore = api;
if (typeof module !== 'undefined') module.exports = api;
