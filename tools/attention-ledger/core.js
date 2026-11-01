'use strict';
/* 注意力账本 · 纯逻辑。时间一律用「当天 0 点起的分钟整数」(0–1440),日期用 YYYY-MM-DD 字符串。 */

var GROUPS = [
  { key: 'prod', name: '生产' },
  { key: 'learn', name: '学习' },
  { key: 'consume', name: '消费' },
  { key: 'chore', name: '杂务' },
  { key: 'rest', name: '休息' }
];
var GROUP_KEYS = GROUPS.map(function (g) { return g.key; });
var GROUP_NAME = Object.create(null);
GROUPS.forEach(function (g) { GROUP_NAME[g.key] = g.name; });
var DEFAULT_GOLDEN = { start: 540, end: 720 };
var DAY_MIN = 1440;
var MAX_RANGE_DAYS = 400;
var FOCUS_GROUPS = ['prod', 'learn'];

/* ---------- 日期与时间 ---------- */
function parseDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  var y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
  var t = Date.UTC(y, m - 1, d);
  var o = new Date(t);
  if (o.getUTCFullYear() !== y || o.getUTCMonth() !== m - 1 || o.getUTCDate() !== d) return null;
  return t;
}
function isDate(s) { return parseDate(s) !== null; }
function fmtDate(t) {
  var o = new Date(t);
  return o.getUTCFullYear() + '-' + String(o.getUTCMonth() + 1).padStart(2, '0') + '-' + String(o.getUTCDate()).padStart(2, '0');
}
function addDays(iso, n) {
  var t = parseDate(iso);
  if (t === null) return null;
  return fmtDate(t + n * 86400000);
}
function daysBetween(fromISO, toISO) {
  var a = parseDate(fromISO), b = parseDate(toISO);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 86400000);
}
function dateList(fromISO, toISO) {
  var n = daysBetween(fromISO, toISO);
  if (n === null || n < 0) return [];
  if (n + 1 > MAX_RANGE_DAYS) n = MAX_RANGE_DAYS - 1;
  var out = [];
  for (var i = 0; i <= n; i++) out.push(addDays(fromISO, i));
  return out;
}
/* "HH:MM" -> 分钟;允许 24:00 作为结束时间。非法返回 null */
function parseTime(s) {
  if (typeof s !== 'string') return null;
  var m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  var h = +m[1], mi = +m[2];
  if (mi > 59 || h > 24 || (h === 24 && mi !== 0)) return null;
  return h * 60 + mi;
}
function fmtTime(min) {
  var h = Math.floor(min / 60), m = min % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
function fmtDuration(min) {
  var h = Math.floor(min / 60), m = min % 60;
  if (h === 0) return m + ' 分钟';
  if (m === 0) return h + ' 小时';
  return h + ' 小时 ' + m + ' 分钟';
}
/* ?today=YYYY-MM-DD 固定今天;非法回退真实今天,不抛错 */
function resolveToday(search, now) {
  var v = null;
  try { v = new URLSearchParams(search || '').get('today'); } catch (e) { v = null; }
  if (v && isDate(v)) return v;
  var d = now instanceof Date ? now : new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* 仅当地址参数里有合法的 ?today 时返回该日期,否则 null(用来显示「由地址参数固定」) */
function fixedToday(search) {
  var v = null;
  try { v = new URLSearchParams(search || '').get('today'); } catch (e) { v = null; }
  return v && isDate(v) ? v : null;
}

/* ---------- 区间与黄金时段 ---------- */
function overlapMinutes(a0, a1, b0, b1) {
  var s = Math.max(a0, b0), e = Math.min(a1, b1);
  return e > s ? e - s : 0;
}
function normalizeGolden(g) {
  if (g && Number.isInteger(g.start) && Number.isInteger(g.end) && g.start >= 0 && g.end <= DAY_MIN && g.start < g.end) {
    return { start: g.start, end: g.end };
  }
  return { start: DEFAULT_GOLDEN.start, end: DEFAULT_GOLDEN.end };
}
function emptyGroups() {
  var o = Object.create(null);
  GROUP_KEYS.forEach(function (k) { o[k] = 0; });
  return o;
}
function duration(e) { return e.end - e.start; }
function ratio(a, b) { return b > 0 ? a / b : 0; }

/* ---------- 单条校验 ---------- */
function isNonEmptyText(v, max) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max;
}
function validateEntry(entry, sameDayEntries) {
  var errors = [];
  var e = entry || {};
  if (!isDate(e.date)) errors.push({ field: 'date', message: '日期格式应为 YYYY-MM-DD,且必须是真实日期。' });
  var startOk = Number.isInteger(e.start) && e.start >= 0 && e.start < DAY_MIN;
  var endOk = Number.isInteger(e.end) && e.end > 0 && e.end <= DAY_MIN;
  if (!startOk) errors.push({ field: 'start', message: '开始时间不合法。' });
  if (!endOk) errors.push({ field: 'end', message: '结束时间不合法。' });
  if (startOk && endOk && e.end <= e.start) {
    errors.push({ field: 'end', message: '结束时间必须晚于开始时间。如果这一段跨过午夜,请勾选「跨午夜」,系统会拆成两天保存。' });
  }
  if (!isNonEmptyText(e.what, 200)) errors.push({ field: 'what', message: '请写下做了什么(1–200 字)。' });
  if (GROUP_KEYS.indexOf(e.group) < 0) errors.push({ field: 'group', message: '大类必须是生产、学习、消费、杂务、休息之一。' });
  if (e.label !== undefined && e.label !== null && (typeof e.label !== 'string' || e.label.length > 30)) {
    errors.push({ field: 'label', message: '自定义类别名最长 30 字。' });
  }
  if (startOk && endOk && e.end > e.start && isDate(e.date)) {
    (sameDayEntries || []).forEach(function (o) {
      if (!o || o.id === e.id || o.date !== e.date) return;
      if (overlapMinutes(e.start, e.end, o.start, o.end) > 0) {
        errors.push({ field: 'overlap', message: '与已有记录 ' + fmtTime(o.start) + '–' + fmtTime(o.end) + '「' + String(o.what) + '」时间相交,已阻止保存。相邻不算相交。' });
      }
    });
  }
  return { ok: errors.length === 0, errors: errors };
}

/* 跨午夜:返回两段(起始日 start–24:00,次日 00:00–end);end>start 时返回 null */
function splitOvernight(entry) {
  if (!entry || !Number.isInteger(entry.start) || !Number.isInteger(entry.end) || entry.end > entry.start) return null;
  if (entry.end <= 0 || entry.start >= DAY_MIN) return null;
  var next = addDays(entry.date, 1);
  if (!next) return null;
  var a = Object.assign({}, entry, { end: DAY_MIN });
  var b = Object.assign({}, entry, { date: next, start: 0, end: entry.end });
  return [a, b];
}

/* 载入示例 / 导入 / 清空会替换什么:记录、备注、偏离默认值的黄金时段、未提交的表单草稿与备注草稿 */
function replaceScope(state, drafts) {
  var st = state || {};
  var d = drafts || {};
  var g = normalizeGolden(st.golden);
  var entries = (st.entries || []).length;
  var notes = Object.keys(st.notes || {}).length;
  var goldenChanged = g.start !== DEFAULT_GOLDEN.start || g.end !== DEFAULT_GOLDEN.end;
  var formDraft = !!d.formDraft, noteDraft = !!d.noteDraft;
  return {
    entries: entries, notes: notes, goldenChanged: goldenChanged, golden: g, formDraft: formDraft, noteDraft: noteDraft,
    any: entries > 0 || notes > 0 || goldenChanged || formDraft || noteDraft
  };
}
function describeScope(sc) {
  var p = [];
  if (sc.entries) p.push(sc.entries + ' 段记录');
  if (sc.notes) p.push(sc.notes + ' 条备注');
  if (sc.goldenChanged) p.push('自定义的黄金时段 ' + fmtTime(sc.golden.start) + '–' + fmtTime(sc.golden.end) + '(会恢复为默认 09:00–12:00)');
  if (sc.formDraft) p.push('表单草稿');
  if (sc.noteDraft) p.push('未保存的备注草稿');
  return p.join('、');
}
/* 把有效的草稿段并入列表用于预览(带 draft 标记);编辑时去掉被编辑的原条目;与已有记录相交的草稿不并入 */
function withDraft(entries, draftParts, editingId) {
  var base = (entries || []).filter(function (e) { return !editingId || e.id !== editingId; });
  var out = base.slice();
  (draftParts || []).forEach(function (p) {
    var same = out.filter(function (e) { return e.date === p.date; });
    if (validateEntry(p, same).ok) out.push(Object.assign({}, p, { draft: true }));
  });
  return out;
}

/* ---------- 汇总 ---------- */
function goldenUsage(entries, goldenWindow) {
  var g = normalizeGolden(goldenWindow);
  var cap = g.end - g.start;
  var by = emptyGroups();
  (entries || []).forEach(function (e) {
    by[e.group] = (by[e.group] || 0) + overlapMinutes(e.start, e.end, g.start, g.end);
  });
  var used = 0;
  GROUP_KEYS.forEach(function (k) { used += by[k]; });
  var focus = by.prod + by.learn;
  return { capacity: cap, byGroup: by, used: used, focusMin: focus, focusRatio: ratio(focus, cap), usedRatio: ratio(used, cap) };
}
function longest(entries, n) {
  var list = (entries || []).slice();
  list.sort(function (a, b) {
    return (duration(b) - duration(a)) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.start - b.start);
  });
  return list.slice(0, Math.max(0, n === undefined ? list.length : n));
}
function daySummary(entries, goldenWindow) {
  var by = emptyGroups();
  var total = 0;
  (entries || []).forEach(function (e) {
    var d = duration(e);
    by[e.group] = (by[e.group] || 0) + d;
    total += d;
  });
  var gu = goldenUsage(entries, goldenWindow);
  var top = longest(entries, 1)[0] || null;
  return {
    total: total,
    byGroup: by,
    focusMin: by.prod + by.learn,
    focusRatio: ratio(by.prod + by.learn, total),
    golden: gu,
    goldenRatio: gu.focusRatio,
    biggest: top
  };
}
function groupByDate(entries) {
  var m = new Map();
  (entries || []).forEach(function (e) {
    if (!m.has(e.date)) m.set(e.date, []);
    m.get(e.date).push(e);
  });
  return m;
}
function shares(byGroup, total) {
  var o = Object.create(null);
  GROUP_KEYS.forEach(function (k) { o[k] = ratio(byGroup[k] || 0, total); });
  return o;
}
function rangeSummary(entries, fromISO, toISO, goldenWindow) {
  var g = normalizeGolden(goldenWindow);
  var dates = dateList(fromISO, toISO);
  var map = groupByDate(entries);
  var by = emptyGroups();
  var total = 0, goldenFocus = 0, goldenCap = 0, recorded = 0, ratioSum = 0;
  var all = [];
  var days = dates.map(function (d) {
    var list = map.get(d) || [];
    var s = daySummary(list, g);
    var has = list.length > 0;
    GROUP_KEYS.forEach(function (k) { by[k] += s.byGroup[k]; });
    total += s.total;
    goldenFocus += s.golden.focusMin;
    if (has) { recorded++; ratioSum += s.goldenRatio; goldenCap += s.golden.capacity; }
    list.forEach(function (e) { all.push(e); });
    return { date: d, recorded: has, total: s.total, byGroup: s.byGroup, focusMin: s.focusMin, goldenFocusMin: s.golden.focusMin, goldenRatio: s.goldenRatio, biggest: s.biggest };
  });
  return {
    from: fromISO, to: toISO, days: days, entries: all,
    total: total, byGroup: by, shares: shares(by, total),
    focusMin: by.prod + by.learn,
    recordedDays: recorded,
    goldenFocusMin: goldenFocus,
    avgGoldenRatio: recorded > 0 ? ratioSum / recorded : 0,
    goldenUtilization: ratio(goldenFocus, goldenCap)
  };
}
/* 连续「黄金时段利用率 >= threshold」的天数。days 按日期升序,日期不连续或无记录都会中断。 */
function streak(days, threshold) {
  var th = typeof threshold === 'number' ? threshold : 0.6;
  var list = (days || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  var best = 0, run = 0, prev = null;
  list.forEach(function (d) {
    var pass = d.recorded !== false && d.goldenRatio + 1e-9 >= th;
    if (!pass) { run = 0; prev = d.date; return; }
    run = (prev !== null && run > 0 && daysBetween(prev, d.date) === 1) ? run + 1 : 1;
    prev = d.date;
    if (run > best) best = run;
  });
  return { current: run, best: best };
}
/* 本区间 vs 紧邻的上一个等长区间 */
function compareRanges(entries, fromISO, toISO, goldenWindow) {
  var n = dateList(fromISO, toISO).length;
  var prevTo = addDays(fromISO, -1);
  var prevFrom = addDays(fromISO, -n);
  var cur = rangeSummary(entries, fromISO, toISO, goldenWindow);
  var prev = n > 0 ? rangeSummary(entries, prevFrom, prevTo, goldenWindow) : rangeSummary(entries, fromISO, '', goldenWindow);
  var shareDelta = Object.create(null);
  GROUP_KEYS.forEach(function (k) { shareDelta[k] = cur.shares[k] - prev.shares[k]; });
  return {
    current: cur, previous: prev, prevFrom: prevFrom, prevTo: prevTo,
    shareDelta: shareDelta,
    focusMinDelta: cur.focusMin - prev.focusMin,
    goldenRatioDelta: cur.avgGoldenRatio - prev.avgGoldenRatio
  };
}

/* ---------- 导出 ---------- */
function guardFormula(v) {
  var s = v === null || v === undefined ? '' : String(v);
  if (s.length > 1 && /^[=+\-@]/.test(s)) return "'" + s;
  if (s === '=' || s === '@') return "'" + s;
  if (/^[\t\r]/.test(s)) return "'" + s;
  return s;
}
function csvCell(v) {
  var s = guardFormula(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function mdCell(v) {
  return guardFormula(v).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
}
function toCsv(entries, goldenWindow, opts) {
  var sample = !!(opts && opts.sample);
  var g = normalizeGolden(goldenWindow);
  var head = ['日期', '开始', '结束', '分钟', '大类', '自定义类别', '做了什么', '黄金时段内分钟'];
  if (sample) head.push('数据来源');
  var rows = (entries || []).slice().sort(function (a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start;
  }).map(function (e) {
    var row = [e.date, fmtTime(e.start), fmtTime(e.end), duration(e), GROUP_NAME[e.group] || e.group, e.label || '', e.what, overlapMinutes(e.start, e.end, g.start, g.end)];
    if (sample) row.push('合成示例');
    return row;
  });
  return [head].concat(rows).map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
}
function pct(x) { return Math.round(x * 100) + '%'; }
function signedPct(x) {
  var p = Math.round(x * 100);
  return (p > 0 ? '+' : '') + p + ' 个百分点';
}
function weeklyReport(opts) {
  var o = opts || {};
  var g = normalizeGolden(o.golden);
  var notes = o.notes || {};
  var from = o.from, to = o.to;
  var cmp = compareRanges(o.entries || [], from, to, g);
  var cur = cmp.current;
  var st = streak(cur.days, 0.6);
  var L = [];
  L.push('# 注意力周报 ' + from + ' 至 ' + to);
  L.push('');
  if (o.sample) { L.push('> 数据来源:合成示例,不是任何真实人的记录。'); L.push(''); }
  L.push('黄金时段:' + fmtTime(g.start) + '–' + fmtTime(g.end) + '(共 ' + fmtDuration(g.end - g.start) + '/天)。有记录的天数:' + cur.recordedDays + ' / ' + cur.days.length + '。');
  L.push('');
  L.push('## 时间统计');
  L.push('');
  L.push('| 大类 | 分钟 | 占比 | 上一周期占比 | 变化 |');
  L.push('| --- | ---: | ---: | ---: | ---: |');
  GROUPS.forEach(function (gr) {
    L.push('| ' + gr.name + ' | ' + cur.byGroup[gr.key] + ' | ' + pct(cur.shares[gr.key]) + ' | ' + pct(cmp.previous.shares[gr.key]) + ' | ' + signedPct(cmp.shareDelta[gr.key]) + ' |');
  });
  L.push('');
  L.push('- 生产 + 学习合计 ' + fmtDuration(cur.focusMin) + ',占总记录时间 ' + pct(ratio(cur.focusMin, cur.total)) + '。');
  L.push('- 黄金时段里生产 + 学习 ' + fmtDuration(cur.goldenFocusMin) + ';有记录的日子平均利用率 ' + pct(cur.avgGoldenRatio) + '(上一周期 ' + pct(cmp.previous.avgGoldenRatio) + ')。');
  L.push('- 连续黄金时段利用率 ≥ 60% 的天数:当前 ' + st.current + ' 天,区间内最长 ' + st.best + ' 天。');
  L.push('');
  L.push('## 每天');
  L.push('');
  L.push('| 日期 | 生产+学习(分钟) | 黄金时段利用率 | 最大的一笔 | 备注 |');
  L.push('| --- | ---: | ---: | --- | --- |');
  cur.days.forEach(function (d) {
    var note = notes[d.date] || '';
    var big = d.biggest ? d.biggest.what + '(' + fmtDuration(duration(d.biggest)) + ')' : '无记录';
    L.push('| ' + d.date + ' | ' + d.focusMin + ' | ' + (d.recorded ? pct(d.goldenRatio) : '-') + ' | ' + mdCell(big) + ' | ' + mdCell(note) + ' |');
  });
  L.push('');
  L.push('## 最长的 7 段');
  L.push('');
  var top = longest(cur.entries, 7);
  if (top.length === 0) {
    L.push('这个区间没有记录。');
  } else {
    L.push('| 日期 | 时间 | 时长 | 大类 | 做了什么 |');
    L.push('| --- | --- | ---: | --- | --- |');
    top.forEach(function (e) {
      L.push('| ' + e.date + ' | ' + fmtTime(e.start) + '–' + fmtTime(e.end) + ' | ' + duration(e) + ' 分钟 | ' + GROUP_NAME[e.group] + ' | ' + mdCell(e.what) + ' |');
    });
  }
  L.push('');
  L.push('## 我的备注');
  L.push('');
  var any = false;
  cur.days.forEach(function (d) {
    if (notes[d.date]) { any = true; L.push('- ' + d.date + ':' + mdCell(notes[d.date])); }
  });
  if (!any) L.push('这个区间没有写备注。');
  L.push('');
  return L.join('\n');
}

/* ---------- 导入校验:不合法就整份拒绝,不静默修正 ---------- */
function validateImport(raw) {
  var data = raw;
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw); } catch (e) { return { ok: false, error: '不是合法的 JSON 文件。' }; }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: '顶层必须是对象。' };
  if (data.app !== 'attention-ledger' || data.version !== 1) return { ok: false, error: '不是注意力账本的 v1 备份(app 或 version 不符)。' };
  if (data.sample !== undefined && typeof data.sample !== 'boolean') return { ok: false, error: 'sample 必须是 true 或 false。' };
  var g = data.golden;
  if (!g || typeof g !== 'object' || !Number.isInteger(g.start) || !Number.isInteger(g.end) || g.start < 0 || g.end > DAY_MIN || g.start >= g.end) {
    return { ok: false, error: '黄金时段 golden 必须是 {start, end} 分钟整数,且 0 ≤ start < end ≤ 1440。' };
  }
  if (!Array.isArray(data.entries)) return { ok: false, error: 'entries 必须是数组。' };
  if (data.entries.length > 20000) return { ok: false, error: '记录超过 20000 条,拒绝导入。' };
  var seen = new Set();
  var byDate = new Map();
  var out = [];
  for (var i = 0; i < data.entries.length; i++) {
    var e = data.entries[i];
    var where = '第 ' + (i + 1) + ' 条记录';
    if (!e || typeof e !== 'object' || Array.isArray(e)) return { ok: false, error: where + '不是对象。' };
    if (typeof e.id !== 'string' || e.id.length === 0 || e.id.length > 64) return { ok: false, error: where + '的 id 必须是 1–64 字的字符串。' };
    if (seen.has(e.id)) return { ok: false, error: where + '的 id「' + e.id + '」重复。' };
    seen.add(e.id);
    if (typeof e.date !== 'string' || typeof e.what !== 'string') return { ok: false, error: where + '的 date / what 必须是字符串。' };
    if (e.label !== undefined && typeof e.label !== 'string') return { ok: false, error: where + '的 label 必须是字符串。' };
    var same = byDate.get(e.date) || [];
    var v = validateEntry(e, same);
    if (!v.ok) return { ok: false, error: where + '(id ' + e.id + ')不合法:' + v.errors[0].message };
    same.push(e);
    byDate.set(e.date, same);
    out.push({ id: e.id, date: e.date, start: e.start, end: e.end, what: e.what, group: e.group, label: e.label || '' });
  }
  var notes = Object.create(null);
  if (data.notes !== undefined) {
    if (!data.notes || typeof data.notes !== 'object' || Array.isArray(data.notes)) return { ok: false, error: 'notes 必须是 日期→文字 的对象。' };
    var keys = Object.keys(data.notes);
    for (var j = 0; j < keys.length; j++) {
      var k = keys[j];
      if (!isDate(k)) return { ok: false, error: '备注的键「' + k + '」不是合法日期。' };
      if (typeof data.notes[k] !== 'string' || data.notes[k].length > 500) return { ok: false, error: '备注 ' + k + ' 必须是不超过 500 字的字符串。' };
      notes[k] = data.notes[k];
    }
  }
  return { ok: true, data: { app: 'attention-ledger', version: 1, sample: data.sample === true, golden: { start: g.start, end: g.end }, entries: out, notes: notes } };
}

var api = {
  GROUPS: GROUPS, GROUP_KEYS: GROUP_KEYS, GROUP_NAME: GROUP_NAME, DEFAULT_GOLDEN: DEFAULT_GOLDEN, FOCUS_GROUPS: FOCUS_GROUPS,
  parseDate: parseDate, isDate: isDate, addDays: addDays, daysBetween: daysBetween, dateList: dateList,
  parseTime: parseTime, fmtTime: fmtTime, fmtDuration: fmtDuration, resolveToday: resolveToday,
  overlapMinutes: overlapMinutes, normalizeGolden: normalizeGolden, duration: duration,
  validateEntry: validateEntry, splitOvernight: splitOvernight, replaceScope: replaceScope, describeScope: describeScope, withDraft: withDraft, fixedToday: fixedToday,
  daySummary: daySummary, goldenUsage: goldenUsage, rangeSummary: rangeSummary, compareRanges: compareRanges,
  streak: streak, longest: longest, groupByDate: groupByDate, weeklyReport: weeklyReport,
  toCsv: toCsv, guardFormula: guardFormula, mdCell: mdCell, validateImport: validateImport
};
globalThis.AttentionCore = api;
if (typeof module !== 'undefined') module.exports = api;
