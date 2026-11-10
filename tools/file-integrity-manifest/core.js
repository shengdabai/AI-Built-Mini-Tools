'use strict';
/* 文件完整校验 · 纯逻辑(无 DOM)。哈希:Sha256 为增量实现,app.js 对大文件分块调用。 */
(function () {
  const DEFAULT_IGNORE = ['.DS_Store', 'Thumbs.db', '__MACOSX/'];
  const STATUS_LABEL = { missing: '缺失', extra: '多出', mismatch: '哈希不一致', case: '大小写差异', internal: '内部错误', ok: '一致', name: '文件名警告' };
  const SHA_RE = /^[0-9a-fA-F]{64}$/;

  /* ---------- 路径 ---------- */
  function normalizePath(p) {
    let s = String(p == null ? '' : p).replace(/\\/g, '/');
    s = s.replace(/\/{2,}/g, '/');
    while (s.startsWith('./')) s = s.slice(2);
    s = s.replace(/\/(\.\/)+/g, '/').replace(/^\/+/, '');
    return s.normalize('NFC');
  }

  function globToRegExp(g) {
    return new RegExp('^' + g.split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
  }

  function parsePatterns(patterns) {
    return (patterns || []).map(x => String(x).trim()).filter(x => x && !x.startsWith('#'));
  }

  function shouldIgnore(path, patterns) {
    const segs = normalizePath(path).split('/');
    const base = segs.length - 1;
    for (const pat of parsePatterns(patterns)) {
      if (pat.endsWith('/')) {
        const re = globToRegExp(normalizePath(pat.slice(0, -1)));
        if (segs.slice(0, base).some(s => re.test(s))) return true;
      } else if (pat.includes('/')) {
        if (globToRegExp(normalizePath(pat)).test(segs.join('/'))) return true;
      } else {
        const re = globToRegExp(pat);
        if (segs.some(s => re.test(s))) return true;
      }
    }
    return false;
  }

  function byteLength(s) { return new TextEncoder().encode(s).length; }

  function checkName(path) {
    const issues = [];
    for (const seg of normalizePath(path).split('/')) {
      const bad = seg.match(/[<>:"|?*]/g);
      if (bad) issues.push({ code: 'illegal-char', message: `文件名含 Windows 不允许的字符 ${[...new Set(bad)].join(' ')}:${seg}` });
      if (/[\u0000-\u001f\u007f]/.test(seg)) issues.push({ code: 'control-char', message: `文件名含控制字符:${JSON.stringify(seg)}` });
      const n = byteLength(seg);
      if (n > 255) issues.push({ code: 'too-long', message: `文件名 ${n} 字节,超过 255 字节上限:${seg.slice(0, 40)}…` });
    }
    return issues;
  }

  /* ---------- 条目与清单 ---------- */
  function normalizeEntry(e, where) {
    if (!e || typeof e !== 'object') throw new Error(`${where}:条目不是对象`);
    if (typeof e.path !== 'string' || !normalizePath(e.path)) throw new Error(`${where}:路径缺失或不是字符串`);
    const path = normalizePath(e.path);
    if (path.split('/').includes('..')) throw new Error(`${where}:路径含 ..:${path}`);
    if (!Number.isInteger(e.size) || e.size < 0) throw new Error(`${where}:大小必须是非负整数:${path}`);
    if (typeof e.sha256 !== 'string' || !SHA_RE.test(e.sha256)) throw new Error(`${where}:sha256 必须是 64 位十六进制:${path}`);
    let mtime = '';
    if (e.mtime != null && e.mtime !== '') {
      if (typeof e.mtime !== 'string' || Number.isNaN(Date.parse(e.mtime))) throw new Error(`${where}:修改时间不是有效日期:${path}`);
      mtime = e.mtime;
    }
    return { path, size: e.size, sha256: e.sha256.toLowerCase(), mtime };
  }

  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  function normalizeList(entries, where, ignore) {
    if (!Array.isArray(entries)) throw new Error(`${where}:不是数组`);
    const seen = new Set(); const files = []; const ignored = [];
    entries.forEach((raw, i) => {
      const e = normalizeEntry(raw, `${where}第 ${i + 1} 条`);
      if (seen.has(e.path)) throw new Error(`${where}:重复路径 ${e.path}`);
      seen.add(e.path);
      if (ignore && shouldIgnore(e.path, ignore)) ignored.push(e.path); else files.push(e);
    });
    files.sort((a, b) => cmp(a.path, b.path));
    ignored.sort(cmp);
    return { files, ignored };
  }

  /* opts.sample:非空文本时写进清单,标明这是合成示例(导出再导入后仍能认出来) */
  function buildManifest(entries, opts) {
    const o = opts || {};
    const { files } = normalizeList(entries, '文件列表', o.ignore);
    const m = { version: 1 };
    if (typeof o.sample === 'string' && o.sample) m.sample = o.sample;
    m.generatedAt = o.generatedAt || null;
    m.files = files;
    return m;
  }

  /* ---------- 本机存档 ---------- */
  function storedError(code, message) {
    const e = new Error(message); e.code = code; return e;
  }

  /* 先校验整个对象,再由调用方一次性写入内存,避免部分加载。 */
  function parseStoredState(raw) {
    if (typeof raw !== 'string') throw storedError('wrong-type', '存档原文必须是字符串');
    let d;
    try { d = JSON.parse(raw); }
    catch (e) { throw storedError('malformed-json', '存档不是有效 JSON:' + e.message); }
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw storedError('wrong-type', '存档顶层必须是对象');
    if (!Array.isArray(d.ignore) || !d.ignore.every(x => typeof x === 'string')) throw storedError('wrong-type', 'ignore 必须是字符串数组');
    if (!Object.prototype.hasOwnProperty.call(d, 'manifest') || (d.manifest !== null && (!d.manifest || typeof d.manifest !== 'object' || Array.isArray(d.manifest)))) throw storedError('wrong-type', 'manifest 必须是清单对象或 null');
    if (typeof d.manifestName !== 'string') throw storedError('wrong-type', 'manifestName 必须是字符串');
    if (typeof d.manifestIsSample !== 'boolean') throw storedError('wrong-type', 'manifestIsSample 必须是布尔值');
    let manifest = null;
    if (d.manifest !== null) {
      try { manifest = parseManifest(JSON.stringify(d.manifest)); }
      catch (e) { throw storedError('invalid-manifest', '存档中的清单无效:' + e.message); }
    }
    return {
      ignore: d.ignore.slice(),
      manifest,
      manifestName: d.manifestName,
      manifestIsSample: d.manifestIsSample || !!(manifest && manifest.sample)
    };
  }

  /* ---------- 比对 ---------- */
  function compare(manifest, entries, opts) {
    const o = opts || {};
    if (!manifest || !Array.isArray(manifest.files)) throw new Error('清单缺少 files 数组');
    const man = normalizeList(manifest.files, '清单', o.ignore).files;
    const act = normalizeList(entries, '文件列表', o.ignore);
    const actual = act.files;
    const actMap = new Map(actual.map(e => [e.path, e]));
    const manMap = new Map(man.map(e => [e.path, e]));
    const ok = []; const mismatched = []; const internal = [];
    let missing = []; let extra = [];
    for (const m of man) {
      const a = actMap.get(m.path);
      if (!a) { missing.push({ path: m.path, size: m.size, sha256: m.sha256 }); continue; }
      const sameHash = a.sha256 === m.sha256; const sameSize = a.size === m.size;
      if (sameHash && sameSize) ok.push({ path: m.path, size: m.size, sha256: m.sha256 });
      else if (sameHash) internal.push({ path: m.path, expectedSize: m.size, actualSize: a.size, sha256: m.sha256 });
      else mismatched.push({ path: m.path, expectedSha: m.sha256, actualSha: a.sha256, expectedSize: m.size, actualSize: a.size, sizeChanged: !sameSize });
    }
    for (const a of actual) if (!manMap.has(a.path)) extra.push({ path: a.path, size: a.size, sha256: a.sha256 });
    // 大小写差异:缺失与多出之间,小写路径相同的一对
    const caseDiff = [];
    const extraByLower = new Map();
    for (const x of extra) { const k = x.path.toLowerCase(); if (!extraByLower.has(k)) extraByLower.set(k, []); extraByLower.get(k).push(x); }
    const usedExtra = new Set(); const usedMissing = new Set();
    for (const m of missing) {
      const list = extraByLower.get(m.path.toLowerCase());
      const x = list && list.find(y => !usedExtra.has(y.path));
      if (!x) continue;
      usedExtra.add(x.path); usedMissing.add(m.path);
      const sameHash = x.sha256 === m.sha256; const sameSize = x.size === m.size;
      caseDiff.push({ manifestPath: m.path, actualPath: x.path, sameHash, sameSize });
      if (sameHash && !sameSize) internal.push({ path: x.path, expectedSize: m.size, actualSize: x.size, sha256: m.sha256, caseOf: m.path });
    }
    missing = missing.filter(m => !usedMissing.has(m.path));
    extra = extra.filter(x => !usedExtra.has(x.path));
    const nameWarnings = [];
    for (const a of actual) { const issues = checkName(a.path); if (issues.length) nameWarnings.push({ path: a.path, issues }); }
    const sum = l => l.reduce((n, e) => n + e.size, 0);
    const stats = {
      manifestFiles: man.length, actualFiles: actual.length,
      manifestSize: sum(man), actualSize: sum(actual),
      missing: missing.length, extra: extra.length, mismatched: mismatched.length,
      caseDiff: caseDiff.length, internal: internal.length, ok: ok.length,
      ignored: act.ignored.length, nameWarnings: nameWarnings.length
    };
    stats.clean = !(stats.missing || stats.extra || stats.mismatched || stats.caseDiff || stats.internal);
    return { missing, extra, mismatched, caseDiff, internal, ok, nameWarnings, ignored: act.ignored, stats };
  }

  function flattenRows(r) {
    const rows = [];
    r.missing.forEach(x => rows.push({ status: 'missing', path: x.path, detail: `清单记录 ${formatSize(x.size)},实际文件夹中没有` }));
    r.extra.forEach(x => rows.push({ status: 'extra', path: x.path, detail: `实际有 ${formatSize(x.size)},清单没有` }));
    r.mismatched.forEach(x => rows.push({ status: 'mismatch', path: x.path, detail: `sha256 不同(清单 ${x.expectedSha.slice(0, 10)}…,实际 ${x.actualSha.slice(0, 10)}…)` + (x.sizeChanged ? `;大小 ${formatSize(x.expectedSize)} → ${formatSize(x.actualSize)}` : ';大小相同') }));
    r.caseDiff.forEach(x => rows.push({ status: 'case', path: x.actualPath, detail: `清单写作 ${x.manifestPath};内容${x.sameHash ? (x.sameSize ? '一致' : '哈希一致但大小不同') : '也不一致'}。大小写敏感的系统上会找不到文件` }));
    r.internal.forEach(x => rows.push({ status: 'internal', path: x.path, detail: `哈希一致但大小不同(${formatSize(x.expectedSize)} vs ${formatSize(x.actualSize)}),不应发生,请重新生成清单后再核对` }));
    r.nameWarnings.forEach(x => rows.push({ status: 'name', path: x.path, detail: x.issues.map(i => i.message).join(';') }));
    r.ok.forEach(x => rows.push({ status: 'ok', path: x.path, detail: `${formatSize(x.size)},sha256 一致` }));
    return rows;
  }

  /* ---------- 导入 ---------- */
  function parseCsvRows(text) {
    const rows = []; let row = []; let cell = ''; let q = false; let i = 0;
    const s = text.replace(/^\uFEFF/, '');
    while (i < s.length) {
      const c = s[i];
      if (q) {
        if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i += 2; continue; } q = false; i++; continue; }
        cell += c; i++; continue;
      }
      if (c === '"' && cell === '') { q = true; i++; continue; }
      if (c === ',') { row.push(cell); cell = ''; i++; continue; }
      if (c === '\r' || c === '\n') {
        if (c === '\r' && s[i + 1] === '\n') i++;
        row.push(cell); cell = ''; rows.push(row); row = []; i++; continue;
      }
      cell += c; i++;
    }
    if (q) throw new Error('CSV 引号未闭合');
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => !(r.length === 1 && r[0] === ''));
  }

  const COLS = { path: ['路径', 'path'], size: ['大小', 'size'], sha256: ['sha256'], mtime: ['修改时间', 'mtime'] };

  // 防护可逆:公式字符开头,或「已是防护形态」(若干个 ' 后接公式字符)的值,导出时再加一个 ';导入时去掉一个
  const GUARD_RE = /^'*(?:[=+\-@].|[\t\r][\s\S])/;
  function unguard(v, controls) {
    const re = controls ? /^'+(?:[=+\-@].|[\t\r][\s\S])/ : /^'+[=+\-@]./;
    return re.test(v) ? v.slice(1) : v;
  }
  const CONTROL_GUARD = '控制字符防护:v1';

  function parseManifest(text) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('内容为空');
    const t = text.replace(/^\uFEFF/, '').trim();
    let list; let generatedAt = null; let sample = '';
    if (t[0] === '{' || t[0] === '[') {
      let data;
      try { data = JSON.parse(t); } catch (e) { throw new Error('JSON 解析失败:' + e.message); }
      if (Array.isArray(data)) list = data;
      else if (data && Array.isArray(data.files)) {
        list = data.files;
        if (typeof data.generatedAt === 'string') generatedAt = data.generatedAt;
        if (typeof data.sample === 'string' && data.sample.trim()) sample = data.sample.trim();
      }
      else throw new Error('JSON 缺少 files 数组');
      list.forEach((e, i) => {
        if (!e || typeof e !== 'object' || typeof e.path !== 'string') throw new Error(`第 ${i + 1} 条:path 必须是字符串`);
        if (typeof e.size !== 'number') throw new Error(`第 ${i + 1} 条:size 必须是数字`);
        if (typeof e.sha256 !== 'string') throw new Error(`第 ${i + 1} 条:sha256 必须是字符串`);
      });
    } else {
      const rows = parseCsvRows(t);
      if (!rows.length) throw new Error('CSV 没有表头');
      const head = rows[0].map(h => h.trim().toLowerCase());
      const controls = head.includes(CONTROL_GUARD);
      const idx = {};
      for (const k of Object.keys(COLS)) idx[k] = head.findIndex(h => COLS[k].includes(h));
      for (const k of ['path', 'size', 'sha256']) if (idx[k] < 0) throw new Error(`CSV 缺少列:${COLS[k].join(' / ')}`);
      list = rows.slice(1).map((r, i) => {
        if (r.length < head.length) throw new Error(`CSV 第 ${i + 2} 行列数不足`);
        const sizeText = r[idx.size].trim();
        if (!/^\d+$/.test(sizeText)) throw new Error(`CSV 第 ${i + 2} 行:大小必须是非负整数`);
        return { path: unguard(r[idx.path], controls), size: Number(sizeText), sha256: r[idx.sha256].trim(), mtime: idx.mtime >= 0 ? r[idx.mtime].trim() : '' };
      });
    }
    const files = normalizeList(list, '清单', null).files;
    return sample ? { version: 1, sample, generatedAt, files } : { version: 1, generatedAt, files };
  }

  /* ---------- 导出 ---------- */
  function guard(v) {
    const s = String(v == null ? '' : v);
    return GUARD_RE.test(s) ? "'" + s : s;
  }
  function csvCell(v) {
    const s = guard(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csvLine(cells) { return cells.map(csvCell).join(','); }

  function toCsv(manifest) {
    // Older CSVs did not escape control prefixes. Mark the new encoding so
    // importing a legacy filename such as "'\t=1" does not remove its apostrophe.
    const controls = manifest.files.some(f => /^'*[\t\r]/.test(f.path));
    const marker = controls ? [CONTROL_GUARD] : [];
    const lines = [csvLine(['路径', '大小', 'sha256', '修改时间'].concat(marker))];
    for (const f of manifest.files) lines.push(csvLine([f.path, f.size, f.sha256, f.mtime || ''].concat(controls ? [''] : [])));
    return lines.join('\n') + '\n';
  }

  function reportToCsv(report) {
    const lines = [csvLine(['状态', '路径', '说明'])];
    for (const r of flattenRows(report)) lines.push(csvLine([STATUS_LABEL[r.status], r.path, r.detail]));
    return lines.join('\n') + '\n';
  }

  function mdCell(v) { return guard(v).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' '); }

  function reportToMarkdown(report, opts) {
    const o = opts || {}; const s = report.stats;
    const out = [`# ${o.title || '文件完整校验报告'}`, ''];
    if (o.date) out.push(`日期:${o.date}`);
    if (o.manifestName) out.push(`清单:${mdCell(o.manifestName)}`);
    out.push('', `结论:${s.clean ? '清单与文件一致' : '发现差异'}`, '');
    out.push('| 项目 | 数量 |', '| --- | --- |');
    out.push(`| 清单文件数 | ${s.manifestFiles} |`, `| 实际文件数 | ${s.actualFiles} |`, `| 清单总大小 | ${formatSize(s.manifestSize)} |`, `| 实际总大小 | ${formatSize(s.actualSize)} |`);
    for (const k of ['missing', 'extra', 'mismatch', 'case', 'internal', 'ok', 'name']) {
      const n = { missing: s.missing, extra: s.extra, mismatch: s.mismatched, case: s.caseDiff, internal: s.internal, ok: s.ok, name: s.nameWarnings }[k];
      out.push(`| ${STATUS_LABEL[k]} | ${n} |`);
    }
    out.push(`| 已忽略 | ${s.ignored} |`, '');
    const rows = flattenRows(report).filter(r => r.status !== 'ok');
    if (rows.length) {
      out.push('## 需要处理的项目', '', '| 状态 | 路径 | 说明 |', '| --- | --- | --- |');
      rows.forEach(r => out.push(`| ${STATUS_LABEL[r.status]} | ${mdCell(r.path)} | ${mdCell(r.detail)} |`));
      out.push('');
    }
    return out.join('\n');
  }

  /* ---------- 工具 ---------- */
  function formatSize(n) {
    if (n < 1024) return n + ' B';
    const u = ['KB', 'MB', 'GB', 'TB']; let v = n / 1024; let i = 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(v >= 100 ? 0 : 1) + ' ' + u[i];
  }

  function todayFrom(search, fallback) {
    try {
      const v = new URLSearchParams(search || '').get('today');
      if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
        const d = new Date(v + 'T00:00:00Z');
        if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v) return v;
      }
    } catch (e) { /* 回退 */ }
    return fallback;
  }

  /* ---------- 增量 SHA-256 ---------- */
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);

  function Sha256() {
    this.h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    this.buf = new Uint8Array(64); this.fill = 0; this.len = 0; this.w = new Uint32Array(64);
  }
  Sha256.prototype._block = function (b, o) {
    const w = this.w; const h = this.h;
    for (let i = 0; i < 16; i++) { const j = o + i * 4; w[i] = ((b[j] << 24) | (b[j + 1] << 16) | (b[j + 2] << 8) | b[j + 3]) >>> 0; }
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]; const c = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((c >>> 17) | (c << 15)) ^ ((c >>> 19) | (c << 13)) ^ (c >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h[0], b2 = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b2) ^ (a & c) ^ (b2 & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b2; b2 = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b2) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  };
  Sha256.prototype.update = function (data) {
    let i = 0; const n = data.length; this.len += n;
    if (this.fill) {
      while (i < n && this.fill < 64) this.buf[this.fill++] = data[i++];
      if (this.fill === 64) { this._block(this.buf, 0); this.fill = 0; }
    }
    while (i + 64 <= n) { this._block(data, i); i += 64; }
    while (i < n) this.buf[this.fill++] = data[i++];
    return this;
  };
  Sha256.prototype.digest = function () {
    const bits = this.len * 8; const pad = new Uint8Array(((this.fill < 56 ? 56 : 120) - this.fill) + 8);
    pad[0] = 0x80;
    const hi = Math.floor(bits / 4294967296); const lo = bits >>> 0; const p = pad.length - 8;
    pad[p] = hi >>> 24; pad[p + 1] = hi >>> 16; pad[p + 2] = hi >>> 8; pad[p + 3] = hi;
    pad[p + 4] = lo >>> 24; pad[p + 5] = lo >>> 16; pad[p + 6] = lo >>> 8; pad[p + 7] = lo;
    const saved = this.len; this.update(pad); this.len = saved;
    return Array.from(this.h, x => x.toString(16).padStart(8, '0')).join('');
  };

  const api = { DEFAULT_IGNORE, STATUS_LABEL, normalizePath, shouldIgnore, checkName, buildManifest, parseStoredState, compare, flattenRows, parseManifest, toCsv, reportToCsv, reportToMarkdown, formatSize, todayFrom, Sha256 };
  globalThis.FileCheckCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
