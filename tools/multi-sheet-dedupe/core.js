'use strict';
/* 多表重复记录核对 · 纯逻辑(无 DOM)。Node 与浏览器共用。 */
(function () {
  const MAX_ROWS = 20000;
  const MAX_TABLES = 5;
  // 列角色:五个标准字段 + 其他(保留) + 不使用
  const ROLES = ['name', 'phone', 'email', 'company', 'wechat', 'other', 'skip'];
  const ROLE_LABEL = { name: '姓名', phone: '手机', email: '邮箱', company: '公司', wechat: '微信号', other: '其他(保留)', skip: '不使用' };
  const FIELDS = ['name', 'phone', 'email', 'company', 'wechat'];
  const FIELD_LABEL = { name: '姓名', phone: '手机', email: '邮箱', company: '公司', wechat: '微信号' };
  const DEFAULT_RULES = { email: true, phone: true, wechat: true, nameCompany: true, suspect: true };

  const str = v => (v === undefined || v === null ? '' : String(v));
  const nfkc = v => str(v).normalize('NFKC');

  // ---------------------------------------------------------------- 解析
  function detectDelimiter(text) {
    const counts = { '\t': 0, ',': 0, ';': 0 };
    let inQ = false;
    for (const ch of text) {
      if (ch === '"') inQ = !inQ;
      else if (!inQ) {
        if (ch === '\n' || ch === '\r') break;
        if (ch in counts) counts[ch]++;
      }
    }
    let best = ',', max = 0;
    for (const d of ['\t', ',', ';']) if (counts[d] > max) { max = counts[d]; best = d; }
    return best;
  }

  // RFC 4180:引号字段、"" 转义、字段内换行;CRLF / LF / CR 都当换行。
  function parseTable(text) {
    let s = str(text);
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    if (!s.trim()) return { ok: true, delimiter: ',', headers: [], rows: [] };
    const delimiter = detectDelimiter(s);
    const records = [];
    let row = [], field = '', inQ = false, quotedClosed = false, atFieldStart = true, line = 1;
    const endField = () => { row.push(field); field = ''; quotedClosed = false; atFieldStart = true; };
    const endRow = () => { endField(); records.push(row); row = []; };
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inQ) {
        if (ch === '"') {
          if (s[i + 1] === '"') { field += '"'; i++; }
          else { inQ = false; quotedClosed = true; }
        } else { if (ch === '\n') line++; field += ch; }
        continue;
      }
      if (ch === '"' && atFieldStart) { inQ = true; atFieldStart = false; continue; }
      if (quotedClosed && ch !== delimiter && ch !== '\n' && ch !== '\r') {
        return { ok: false, error: `第 ${line} 行:引号结束后还有多余字符。` };
      }
      if (ch === delimiter) { endField(); continue; }
      if (ch === '\r') { if (s[i + 1] === '\n') i++; endRow(); line++; continue; }
      if (ch === '\n') { endRow(); line++; continue; }
      field += ch; atFieldStart = false;
    }
    if (inQ) return { ok: false, error: '引号没有闭合,文件可能被截断。' };
    if (field !== '' || row.length || quotedClosed) endRow();
    const nonEmpty = records.filter(r => r.some(c => c.trim() !== ''));
    if (!nonEmpty.length) return { ok: true, delimiter, headers: [], rows: [] };
    const headers = nonEmpty[0].map(h => h.trim());
    const seen = new Set();
    for (const h of headers) {
      if (h === '') continue;
      if (seen.has(h)) return { ok: false, error: `表头「${h}」重复。请先在源文件里改成不同的名字。` };
      seen.add(h);
    }
    const body = nonEmpty.slice(1);
    if (body.length > MAX_ROWS) return { ok: false, error: `数据行 ${body.length} 超过上限 ${MAX_ROWS}。` };
    const rows = [];
    for (let i = 0; i < body.length; i++) {
      const r = body[i];
      if (r.length > headers.length) {
        return { ok: false, error: `数据第 ${i + 1} 行有 ${r.length} 列,表头只有 ${headers.length} 列。` };
      }
      const padded = r.slice();
      while (padded.length < headers.length) padded.push('');
      rows.push(padded);
    }
    return { ok: true, delimiter, headers, rows };
  }

  function guessMapping(headers) {
    const rules = [
      ['email', /邮箱|邮件|e-?mail|mail/i],
      ['phone', /手机|电话|联系方式|mobile|phone|tel/i],
      ['wechat', /微信号|微信id|^微信$|wechat|weixin|wxid|^vx$/i],
      ['company', /公司|单位|企业|机构|company|employer|organi[sz]ation/i],
      ['name', /姓名|名字|联系人|称呼|^name$|full.?name|^姓$/i]
    ];
    const used = new Set();
    return headers.map(h => {
      const t = str(h).trim();
      for (const [role, re] of rules) {
        if (!used.has(role) && re.test(t)) { used.add(role); return role; }
      }
      return 'other';
    });
  }

  // ---------------------------------------------------------------- 标准化
  const CJK = /[\u3400-\u9fff]/;
  const normalize = {
    phone(s) {
      const t = nfkc(s).trim();
      let d = t.replace(/\D/g, '');
      if (!d) return '';
      if (d.startsWith('0086')) d = d.slice(4);
      else if (/^[\s(]*\+\s*86/.test(t) && d.startsWith('86')) d = d.slice(2);
      else if (d.length === 13 && d.startsWith('86')) d = d.slice(2);
      return d;
    },
    email(s) { return nfkc(s).replace(/\s+/g, '').toLowerCase(); },
    name(s) {
      const t = nfkc(s).trim();
      if (!t) return '';
      if (CJK.test(t)) return t.replace(/\s+/g, '');
      return t.replace(/\s+/g, ' ').toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase());
    },
    company(s) {
      let t = nfkc(s).toLowerCase().replace(/[\s.,，。]+/g, '');
      const suffix = /(股份有限公司|有限责任公司|有限公司|coltd|ltd|inc)$/;
      while (suffix.test(t)) t = t.replace(suffix, '');
      return t;
    },
    wechat(s) { return nfkc(s).replace(/\s+/g, '').toLowerCase(); }
  };

  function editDistance(a, b) {
    const x = Array.from(str(a)), y = Array.from(str(b));
    if (!x.length) return y.length;
    if (!y.length) return x.length;
    let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
    for (let i = 1; i <= x.length; i++) {
      const cur = [i];
      for (let j = 1; j <= y.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[y.length];
  }

  // ---------------------------------------------------------------- 记录
  /** table: {id, name, headers, rows, mapping:[role]} → records */
  function buildRecords(table, tableIndex) {
    const out = [];
    const { headers, rows, mapping } = table;
    for (let r = 0; r < rows.length; r++) {
      const rec = { id: `${table.id}#${r + 1}`, tableId: table.id, tableIndex: tableIndex || 0, table: table.name, row: r + 1,
        name: '', phone: '', email: '', company: '', wechat: '', extras: [] };
      for (let c = 0; c < headers.length; c++) {
        const role = mapping[c];
        const v = str(rows[r][c]).trim();
        if (role === 'skip' || v === '') continue;
        if (FIELDS.includes(role) && rec[role] === '') rec[role] = v;
        else rec.extras.push({ k: headers[c] || `列${c + 1}`, v });
      }
      out.push(rec);
    }
    return out;
  }

  const fieldKey = (field, v) => field === 'name' ? normalize.name(v).toLowerCase() : normalize[field](v);

  function conflictKeys(members) {
    const keys = [];
    for (const f of FIELDS) {
      const set = new Set();
      for (const m of members) { const k = fieldKey(f, m[f]); if (k) set.add(k); }
      if (set.size >= 2) keys.push(f);
    }
    const ex = new Map();
    for (const m of members) for (const e of m.extras) {
      if (!ex.has(e.k)) ex.set(e.k, new Set());
      ex.get(e.k).add(e.v);
    }
    for (const [k, set] of ex) if (set.size >= 2) keys.push('x:' + k);
    return keys;
  }
  const conflictLabel = key => key.startsWith('x:') ? key.slice(2) : FIELD_LABEL[key];

  // ---------------------------------------------------------------- 聚类
  /**
   * records → {clusters, suspects}
   * rules:{email,phone,wechat,nameCompany,suspect}(缺省为开)。confirmed:已人工确认并入的疑似键数组。
   * 强规则用并查集合并;「疑似」(姓名编辑距离 ≤ 1 且手机或邮箱至少一项为空)只在 confirmed 里才并入,否则列在 suspects。
   */
  const RULE_TEXT = { email: '邮箱标准化后相同', phone: '手机标准化后相同', wechat: '微信号标准化后相同', nameCompany: '姓名与公司标准化后相同' };
  const where = r => `${r.table} 第${r.row}行`;
  function linkText(e, ra, rb) {
    const head = `${where(ra)} 与 ${where(rb)}:`;
    if (e.rule === 'suspect') return head + `人工确认为同一人(姓名${e.value === 0 ? '相同' : '相差 1 个字'},手机或邮箱有缺项)`;
    return head + `${RULE_TEXT[e.rule]}(${e.value})`;
  }
  function cluster(records, rules, confirmed) {
    const on = k => !rules || rules[k] !== false;
    const recs = records || [];
    const n = recs.length;
    const parent = Array.from({ length: n }, (_, i) => i);
    const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra === rb) return; if (ra < rb) parent[rb] = ra; else parent[ra] = rb; };
    const nm = recs.map(r => ({
      name: normalize.name(r.name), phone: normalize.phone(r.phone), email: normalize.email(r.email),
      company: normalize.company(r.company), wechat: normalize.wechat(r.wechat)
    }));
    const edges = []; // 归组依据:{rule, a, b, value}(a、b 为记录下标)
    const link = (rule, keyOf, show) => {
      const seen = new Map();
      for (let i = 0; i < n; i++) {
        const k = keyOf(nm[i]);
        if (!k) continue;
        if (seen.has(k)) { union(seen.get(k), i); edges.push({ rule, a: seen.get(k), b: i, value: show ? show(nm[i]) : k }); } else seen.set(k, i);
      }
    };
    if (on('email')) link('email', x => x.email);
    if (on('phone')) link('phone', x => x.phone);
    if (on('wechat')) link('wechat', x => x.wechat);
    if (on('nameCompany')) link('nameCompany', x => (x.name && x.company ? x.name.toLowerCase() + '\u0001' + x.company : ''), x => x.name + ' / ' + x.company);

    // 疑似候选:用「删一个字符」分桶,避免 O(n²) 编辑距离
    const cand = [];
    if (on('suspect')) {
      const hardRoot = Array.from({ length: n }, (_, i) => find(i));
      const buckets = new Map();
      const names = nm.map(x => Array.from(x.name.toLowerCase()));
      const add = (k, i) => { const l = buckets.get(k); if (l) l.push(i); else buckets.set(k, [i]); };
      for (let i = 0; i < n; i++) {
        const ch = names[i];
        if (ch.length < 1) continue;
        // 完整姓名与「删一个字」候选放在同一命名空间,这样增字、删字、替换都会落进同一个桶
        add(ch.join(''), i);
        for (let d = 0; d < ch.length; d++) add(ch.slice(0, d).concat(ch.slice(d + 1)).join(''), i);
      }
      const done = new Set();
      for (const list of buckets.values()) {
        for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
          const a = list[x], b = list[y];
          const pk = a * n + b;
          if (done.has(pk)) continue;
          done.add(pk);
          if (hardRoot[a] === hardRoot[b]) continue;
          if (nm[a].phone && nm[b].phone && nm[a].email && nm[b].email) continue;
          const dist = editDistance(names[a].join(''), names[b].join(''));
          if (dist <= 1) cand.push({ a, b, distance: dist });
        }
      }
      cand.sort((p, q) => p.a - q.a || p.b - q.b);
    }
    const kept = [];
    const rootPairs = new Set();
    for (const c of cand) {
      const ra = find(c.a), rb = find(c.b);
      const pk = Math.min(ra, rb) * n + Math.max(ra, rb);
      if (rootPairs.has(pk)) continue;
      rootPairs.add(pk);
      kept.push(Object.assign(c, { key: [recs[c.a].id, recs[c.b].id].sort().join('~') }));
    }
    const okKeys = new Set(Array.isArray(confirmed) ? confirmed : []);
    const confirmedLinks = kept.filter(c => okKeys.has(c.key));
    for (const c of confirmedLinks) { union(c.a, c.b); edges.push({ rule: 'suspect', a: c.a, b: c.b, value: c.distance }); }

    const groups = new Map();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(i);
    }
    const clusters = [];
    const idOfRoot = new Map();
    for (const [root, idxs] of groups) {
      const members = idxs.map(i => recs[i]);
      const id = clusters.length + 1;
      idOfRoot.set(root, id);
      clusters.push({ id, members, size: members.length, conflicts: conflictKeys(members), suspect: false, viaSuspect: false, pending: [], links: [] });
    }
    for (const c of confirmedLinks) clusters[idOfRoot.get(find(c.a)) - 1].viaSuspect = true;
    for (const e of edges) {
      clusters[idOfRoot.get(find(e.a)) - 1].links.push({
        rule: e.rule, aId: recs[e.a].id, bId: recs[e.b].id, value: e.value, text: linkText(e, recs[e.a], recs[e.b])
      });
    }
    const suspects = [];
    for (const c of kept) {
      if (okKeys.has(c.key)) continue;
      const ca = idOfRoot.get(find(c.a)), cb = idOfRoot.get(find(c.b));
      if (ca === cb) continue;
      suspects.push({ key: c.key, distance: c.distance, recordA: recs[c.a], recordB: recs[c.b], clusterA: ca, clusterB: cb });
      clusters[ca - 1].pending.push(c.key);
      clusters[cb - 1].pending.push(c.key);
    }
    for (const cl of clusters) cl.suspect = cl.viaSuspect || cl.pending.length > 0;
    return { clusters, suspects };
  }

  const filled = m => FIELDS.filter(f => str(m[f]).trim() !== '').length + m.extras.filter(e => e.v !== '').length;

  /** 默认主记录:非空字段最多的一条;并列取靠前者。返回 members 下标,空簇返回 -1。 */
  function pickMaster(cl) {
    let best = -1, bestN = -1;
    cl.members.forEach((m, i) => { const c = filled(m); if (c > bestN) { bestN = c; best = i; } });
    return best;
  }

  function distinctValues(list, keyFn) {
    const seen = new Set(), out = [];
    for (const v of list) {
      const t = str(v).trim();
      if (!t) continue;
      const k = keyFn(t);
      if (!k || seen.has(k)) continue;
      seen.add(k); out.push(t);
    }
    return out;
  }

  /** 一个簇合并成一行:主记录优先,缺的字段用其他记录补;同字段不同值全部保留并用 " / " 连接。 */
  function merge(cl, masterIndex) {
    const mi = Number.isInteger(masterIndex) && masterIndex >= 0 && masterIndex < cl.members.length ? masterIndex : pickMaster(cl);
    const ordered = cl.members.length ? [cl.members[mi]].concat(cl.members.filter((_, i) => i !== mi)) : [];
    const fields = {}, conflicts = [];
    for (const f of FIELDS) {
      const vals = distinctValues(ordered.map(m => m[f]), v => fieldKey(f, v));
      fields[f] = vals.join(' / ');
      if (vals.length >= 2) conflicts.push(f);
    }
    const headers = [];
    const byHeader = new Map();
    for (const m of ordered) for (const e of m.extras) {
      if (!byHeader.has(e.k)) { byHeader.set(e.k, []); headers.push(e.k); }
      byHeader.get(e.k).push(e.v);
    }
    const extras = headers.map(k => {
      const vals = distinctValues(byHeader.get(k), v => v);
      if (vals.length >= 2) conflicts.push('x:' + k);
      return { k, v: vals.join(' / ') };
    });
    return {
      clusterId: cl.id, fields, extras, conflicts,
      conflictLabels: conflicts.map(conflictLabel),
      count: cl.members.length,
      sources: cl.members.map(m => `${m.table} 第${m.row}行`),
      master: ordered.length ? ordered[0].id : null
    };
  }

  /** 冲突明细:每个冲突字段下,不同取值及其来源。 */
  function conflictDetails(cl) {
    return cl.conflicts.map(key => {
      const map = new Map();
      for (const m of cl.members) {
        const vals = key.startsWith('x:') ? m.extras.filter(e => e.k === key.slice(2)).map(e => e.v) : [m[key]];
        for (const raw of vals) {
          const v = str(raw).trim();
          if (!v) continue;
          const k = key.startsWith('x:') ? v : fieldKey(key, v);
          if (!k) continue;
          if (!map.has(k)) map.set(k, { value: v, sources: [] });
          map.get(k).sources.push(`${m.table} 第${m.row}行`);
        }
      }
      return { key, label: conflictLabel(key), values: Array.from(map.values()) };
    });
  }

  // ---------------------------------------------------------------- 导出
  /** YYYY-MM-DD 且是真实存在的日期(2026-02-30 不合法,不会被自动进位)。 */
  function isValidDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(s));
    if (!m) return false;
    const y = +m[1], mo = +m[2], d = +m[3];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  }

  const FORMULA = /^[=+\-@\t\r]/;
  function guardFormula(s) {
    return FORMULA.test(s) && s !== '-' && s !== '+' ? "'" + s : s;
  }
  function csvCell(v) {
    const s = guardFormula(str(v));
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(rows) { return (rows || []).map(r => r.map(csvCell).join(',')).join('\r\n'); }

  function extraHeaders(items) {
    const seen = new Set(), out = [];
    for (const list of items) for (const e of list) if (!seen.has(e.k)) { seen.add(e.k); out.push(e.k); }
    return out;
  }

  /** masters: 主记录 id 的数组/Set(用户手选);未选的簇用 pickMaster。 */
  function masterIndexFor(cl, masters) {
    const set = masters instanceof Set ? masters : new Set(masters || []);
    const i = cl.members.findIndex(m => set.has(m.id));
    return i >= 0 ? i : pickMaster(cl);
  }

  function mergedRows(clusters, masters, meta) {
    const merged = clusters.map(cl => ({ cl, m: merge(cl, masterIndexFor(cl, masters)) }));
    const xs = extraHeaders(merged.map(x => x.m.extras));
    const header = ['组号', ...FIELDS.map(f => FIELD_LABEL[f]), ...xs, '合并条数', '来源', '冲突字段', '备注'].concat(meta && meta.sample ? ['数据来源'] : []);
    const rows = merged.map(({ cl, m }) => {
      const ex = new Map(m.extras.map(e => [e.k, e.v]));
      const note = [cl.viaSuspect ? '含人工确认的疑似并入' : '', cl.pending.length ? '另有待确认的疑似重复' : ''].filter(Boolean).join(';');
      return [cl.id, ...FIELDS.map(f => m.fields[f]), ...xs.map(k => ex.get(k) || ''), m.count, m.sources.join(' ; '), m.conflictLabels.join(' ; '), note].concat(meta && meta.sample ? ['合成示例'] : []);
    });
    return [header, ...rows];
  }

  function originalRows(clusters, meta) {
    const tag = meta && meta.sample;
    const all = [];
    for (const cl of clusters) for (const m of cl.members) all.push({ cl, m });
    const xs = extraHeaders(all.map(x => x.m.extras));
    const header = ['组号', '来源表', '行号', ...FIELDS.map(f => FIELD_LABEL[f]), ...xs].concat(tag ? ['数据来源'] : []);
    const rows = all.map(({ cl, m }) => {
      const ex = new Map(m.extras.map(e => [e.k, e.v]));
      return [cl.id, m.table, m.row, ...FIELDS.map(f => m[f]), ...xs.map(k => ex.get(k) || '')].concat(tag ? ['合成示例'] : []);
    });
    return [header, ...rows];
  }

  function mdCell(v) {
    return guardFormula(str(v).replace(/\s*[\r\n]+\s*/g, ' '))
      .replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/</g, '&lt;');
  }

  function conflictsToMarkdown(clusters, meta) {
    const withConflict = (clusters || []).filter(c => c.conflicts.length);
    const lines = ['# 多表重复记录冲突报告', ''];
    if (meta && meta.sample) lines.push('数据来源:合成示例(虚构数据,仅用于演示)。', '');
    if (!withConflict.length) {
      lines.push('没有发现冲突字段:同一记录组内的各字段取值一致或只有一方有值。');
      return lines.join('\n') + '\n';
    }
    lines.push(`共 ${withConflict.length} 个记录组存在冲突字段。本报告只列出事实,不判断谁对谁错。`, '');
    for (const cl of withConflict) {
      lines.push(`## 记录组 ${cl.id}(${cl.members.length} 条记录)`, '');
      if (cl.viaSuspect) lines.push('该记录组含人工确认的疑似并入。', '');
      lines.push('| 冲突字段 | 取值 | 来源 |', '| --- | --- | --- |');
      for (const d of conflictDetails(cl)) {
        for (const v of d.values) lines.push(`| ${mdCell(d.label)} | ${mdCell(v.value)} | ${mdCell(v.sources.join(';'))} |`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  // 导出口径:导出始终覆盖全部记录组,不受界面显示筛选影响
  function exportCounts(clusters) {
    const cs = clusters || [];
    const records = cs.reduce((n, c) => n + c.members.length, 0);
    return { groups: cs.length, records, conflictGroups: cs.filter(c => c.conflicts.length).length, mergedRows: cs.length, originalRows: records };
  }

  const api = {
    MAX_ROWS, MAX_TABLES, ROLES, ROLE_LABEL, FIELDS, FIELD_LABEL, DEFAULT_RULES,
    parseTable, guessMapping, normalize, editDistance, buildRecords, cluster, pickMaster, merge,
    conflictDetails, conflictLabel, masterIndexFor, mergedRows, originalRows, toCsv, csvCell, conflictsToMarkdown, exportCounts, isValidDate
  };
  globalThis.DupCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
