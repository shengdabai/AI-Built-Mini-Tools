/* AI 订阅成本账本 · 纯逻辑(无 DOM)。金额一律为整数分,小时当量为数字。 */
(function () {
  'use strict';

  var VERSION = 2;
  var MAX_CENTS = 1000000000000;
  var MAX_HOURS = 100000;
  var MAX_TEXT = 200;
  var MAX_EVIDENCE = 1000;
  var MAX_AMORT = 120;
  var MAX_HEADCOUNT = 10000;
  var MAX_RATE = 1000000;

  var PERIODS = ['monthly', 'yearly', 'once', 'usage'];
  var STATUSES = ['active', 'paused', 'cancelled'];
  var TAGS = ['编码', '写作', '调研', '图像', '其他'];
  var WHOS = ['self', 'team'];
  var PERIOD_LABEL = { monthly: '月付', yearly: '年付', once: '一次性', usage: '按量' };
  var STATUS_LABEL = { active: '在用', paused: '暂停', cancelled: '已退' };
  var WHO_LABEL = { self: '自己', team: '团队' };

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function pad(n, w) { return String(n).padStart(w || 2, '0'); }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  /* ---------- 日期与月份(全部在 UTC 时间轴上计算) ---------- */
  function fmtDate(d) { return pad(d.getUTCFullYear(), 4) + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function utcOf(s) { var p = s.split('-'); return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
  /* 严格日期:解析后再格式化,与原串一致才算合法(2026-02-30 不会被进位) */
  function parseDate(s) {
    if (typeof s !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(s)) return null;
    return fmtDate(new Date(utcOf(s))) === s ? s : null;
  }
  function parseMonth(s) {
    if (typeof s !== 'string' || !/^[1-9]\d{3}-\d{2}$/.test(s)) return null;
    var m = Number(s.slice(5));
    return m >= 1 && m <= 12 ? s : null;
  }
  function addMonths(month, n) {
    var idx = Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1 + n;
    return pad(Math.floor(idx / 12), 4) + '-' + pad((idx % 12) + 1);
  }
  function monthIndex(month) { return Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1; }
  function daysBetween(a, b) { return Math.round((utcOf(b) - utcOf(a)) / 86400000); }
  function addDays(date, n) { return fmtDate(new Date(utcOf(date) + n * 86400000)); }
  function lastMonths(today, n) {
    var end = today.slice(0, 7);
    var out = [];
    for (var i = n - 1; i >= 0; i--) out.push(addMonths(end, -i));
    return out;
  }
  /* ?today=YYYY-MM-DD;非法(含 2026-02-30)回退 fallback,不抛错 */
  function resolveToday(search, fallback) {
    try {
      var v = new URLSearchParams(search || '').get('today');
      return parseDate(v) || fallback;
    } catch (e) { return fallback; }
  }

  /* ---------- 金额与小时 ---------- */
  function parseMoney(str) {
    if (typeof str !== 'string') return null;
    var s = str.trim();
    var m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(s);
    if (!m) return null;
    var c = Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0') || 0);
    return c <= MAX_CENTS ? c : null;
  }
  function parseHours(str) {
    if (typeof str !== 'string') return null;
    var m = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(str.trim());
    if (!m) return null;
    var h = Number(m[1]) + Number((m[2] || '').padEnd(2, '0') || 0) / 100;
    return h <= MAX_HOURS ? h : null;
  }
  function formatMoney(cents, group) {
    var c = Math.round(Number(cents) || 0);
    var neg = c < 0;
    c = Math.abs(c);
    var whole = String(Math.floor(c / 100));
    if (group) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + whole + '.' + pad(c % 100);
  }
  function round2(x) { return Math.round(x * 100) / 100; }
  function fmtHours(h) { return String(round2(h)); }

  /* ---------- 校验(保存前与读取后共用) ---------- */
  function strField(v, name, max, allowEmpty) {
    if (typeof v !== 'string') return name + '必须是文本';
    if (!allowEmpty && v.trim() === '') return name + '不能为空';
    if (v.length > max) return name + '不能超过 ' + max + ' 个字符';
    return null;
  }
  function isCurrency(v) { return typeof v === 'string' && /^[A-Z]{3,8}$/.test(v); }
  function isCents(v) { return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= MAX_CENTS; }

  /* 返回错误文本或 null;不修改入参 */
  function validateSub(s) {
    if (!isObj(s)) return '订阅必须是对象';
    var e;
    if (typeof s.id !== 'string' || s.id === '' || s.id.length > 64) return 'id 必须是 1–64 位文本';
    if ((e = strField(s.name, '服务名', MAX_TEXT, false))) return e;
    if (has(s, 'tier') && (e = strField(s.tier, '档位', MAX_TEXT, true))) return e;
    if (!isCurrency(s.currency)) return '币种必须是 3–8 位大写字母代码';
    if (!isCents(s.amountCents)) return '金额必须是 0 到 ' + formatMoney(MAX_CENTS) + ' 之间、以分为单位的整数';
    if (PERIODS.indexOf(s.period) < 0) return '周期必须是 monthly / yearly / once / usage 之一';
    if (parseDate(s.startDate) === null) return '开始日必须是真实存在的 YYYY-MM-DD 日期';
    if (has(s, 'renewDate') && s.renewDate !== '' && parseDate(s.renewDate) === null) return '续费日必须为空或真实存在的 YYYY-MM-DD 日期';
    if (STATUSES.indexOf(s.status) < 0) return '状态必须是 active / paused / cancelled 之一';
    if (TAGS.indexOf(s.tag) < 0) return '用途标签必须是 ' + TAGS.join('、') + ' 之一';
    if (WHOS.indexOf(s.who) < 0) return '使用者必须是 self / team 之一';
    if (has(s, 'headcount')) {
      if (!Number.isInteger(s.headcount) || s.headcount < 1 || s.headcount > MAX_HEADCOUNT) return '人数必须是 1–' + MAX_HEADCOUNT + ' 的整数';
      if (s.who === 'self' && s.headcount !== 1) return '使用者为自己时人数必须是 1';
    }
    if (has(s, 'amortMonths') && (!Number.isInteger(s.amortMonths) || s.amortMonths < 1 || s.amortMonths > MAX_AMORT)) return '摊销月数必须是 1–' + MAX_AMORT + ' 的整数';
    if (has(s, 'usageBills')) {
      if (!isObj(s.usageBills)) return '按量账单必须是对象';
      var keys = Object.keys(s.usageBills);
      for (var i = 0; i < keys.length; i++) {
        if (parseMonth(keys[i]) === null) return '按量账单的月份「' + keys[i] + '」不是 YYYY-MM';
        if (!isCents(s.usageBills[keys[i]])) return '按量账单 ' + keys[i] + ' 的金额不合法';
      }
    }
    return null;
  }
  function validateOutput(o) {
    if (!isObj(o)) return '产出记录必须是对象';
    if (typeof o.id !== 'string' || o.id === '' || o.id.length > 64) return 'id 必须是 1–64 位文本';
    if (parseMonth(o.month) === null) return '产出月份必须是 YYYY-MM';
    if (TAGS.indexOf(o.tag) < 0) return '用途标签必须是 ' + TAGS.join('、') + ' 之一';
    if (typeof o.hours !== 'number' || !Number.isFinite(o.hours) || o.hours < 0 || o.hours > MAX_HOURS) return '小时当量必须是 0–' + MAX_HOURS + ' 的数字';
    if (has(o, 'evidence')) { var e = strField(o.evidence, '证据', MAX_EVIDENCE, true); if (e) return e; }
    return null;
  }
  function validateFx(fx) {
    if (!isObj(fx)) return '折算汇率必须是对象或空';
    if (!isCurrency(fx.from) || !isCurrency(fx.to)) return '折算汇率的币种必须是 3–8 位大写字母代码';
    if (fx.from === fx.to) return '折算汇率的两个币种不能相同';
    if (typeof fx.rate !== 'number' || !Number.isFinite(fx.rate) || fx.rate <= 0 || fx.rate > MAX_RATE) return '折算汇率必须是大于 0 的数字';
    return null;
  }
  function validateWage(w) {
    if (!isObj(w)) return '机会成本时薪必须是对象或空';
    if (!isCurrency(w.currency)) return '时薪币种必须是 3–8 位大写字母代码';
    if (!isCents(w.cents)) return '时薪金额不合法';
    return null;
  }

  var LEGACY_SNAPSHOT_WARNING = '旧版快照没有完整性标记，无法确认保存时是否缺少按量账单。';
  function validateSnapshot(s, today) {
    if (!isObj(s)) return '快照必须是对象';
    if (typeof s.id !== 'string' || s.id === '' || s.id.length > 64) return 'id 必须是 1–64 位文本';
    if (parseMonth(s.month) === null) return '月份必须是 YYYY-MM';
    if (parseDate(s.recordedDate) === null) return '确认日期必须是真实存在的 YYYY-MM-DD 日期';
    if (today !== undefined) {
      if (parseDate(today) === null) return '校验基准日期必须是真实存在的 YYYY-MM-DD 日期';
      if (s.month > today.slice(0, 7)) return '成本月份不能晚于今天所在月份';
      if (s.recordedDate > today) return '确认日期不能晚于今天';
    }
    var e = strField(s.source, '确认来源', MAX_TEXT, false);
    if (e) return e;
    e = strField(has(s, 'note') ? s.note : '', '备注', MAX_EVIDENCE, true);
    if (e) return e;
    if (has(s, 'warnings')) {
      if (!Array.isArray(s.warnings)) return '完整性提示必须是数组';
      for (var w = 0; w < s.warnings.length; w++) {
        e = strField(s.warnings[w], '完整性提示', MAX_EVIDENCE, false);
        if (e) return e;
      }
    }
    if (!Array.isArray(s.items) || !s.items.length) return '快照至少要有一条成本明细';
    var ids = new Set();
    for (var i = 0; i < s.items.length; i++) {
      var it = s.items[i];
      if (!isObj(it)) return '明细 #' + (i + 1) + ' 必须是对象';
      if (typeof it.subId !== 'string' || it.subId === '' || it.subId.length > 64) return '明细 #' + (i + 1) + ' 的订阅 id 不合法';
      if (ids.has(it.subId)) return '明细 #' + (i + 1) + ' 的订阅 id「' + it.subId + '」重复';
      ids.add(it.subId);
      e = strField(it.name, '明细服务名', MAX_TEXT, false);
      if (e) return '明细 #' + (i + 1) + ':' + e;
      if (!isCurrency(it.currency)) return '明细 #' + (i + 1) + ' 的币种不合法';
      if (TAGS.indexOf(it.tag) < 0) return '明细 #' + (i + 1) + ' 的用途标签不合法';
      if (!isCents(it.cents)) return '明细 #' + (i + 1) + ' 的金额必须是非负整数分';
    }
    return null;
  }

  function cleanSnapshot(s) {
    return {
      id: s.id, month: s.month, recordedDate: s.recordedDate, source: s.source,
      note: has(s, 'note') ? s.note : '',
      warnings: has(s, 'warnings') ? s.warnings.slice() : [LEGACY_SNAPSHOT_WARNING],
      items: s.items.map(function (it) { return { subId: it.subId, name: it.name, currency: it.currency, tag: it.tag, cents: it.cents }; })
    };
  }

  function emptyState() { return { version: VERSION, subs: [], outputs: [], snapshots: [], settings: { fx: null, wage: null } }; }

  /* 保存前、读取后、导入时都走这个函数:{ok:true,data} 或 {ok:false,error} */
  function validateState(raw, today) {
    if (!isObj(raw)) return { ok: false, error: '文件内容不是对象' };
    var inputVersion = has(raw, 'version') ? raw.version : 1;
    if (inputVersion !== 1 && inputVersion !== VERSION) return { ok: false, error: '不支持的版本号:' + String(raw.version) };
    if (!Array.isArray(raw.subs)) return { ok: false, error: 'subs 必须是数组' };
    if (!Array.isArray(raw.outputs)) return { ok: false, error: 'outputs 必须是数组' };
    var ids = new Set();
    var data = emptyState();
    for (var i = 0; i < raw.subs.length; i++) {
      var s = raw.subs[i];
      var err = validateSub(s);
      if (err) return { ok: false, error: '订阅 #' + (i + 1) + ':' + err };
      if (ids.has(s.id)) return { ok: false, error: '订阅 #' + (i + 1) + ':id「' + s.id + '」重复' };
      ids.add(s.id);
      data.subs.push(cleanSub(s));
    }
    var oids = new Set();
    var keys = new Set();
    for (var j = 0; j < raw.outputs.length; j++) {
      var o = raw.outputs[j];
      var oerr = validateOutput(o);
      if (oerr) return { ok: false, error: '产出 #' + (j + 1) + ':' + oerr };
      if (oids.has(o.id)) return { ok: false, error: '产出 #' + (j + 1) + ':id「' + o.id + '」重复' };
      oids.add(o.id);
      var key = o.month + '|' + o.tag;
      if (keys.has(key)) return { ok: false, error: '产出 #' + (j + 1) + ':' + o.month + ' 的「' + o.tag + '」已有一条记录' };
      keys.add(key);
      data.outputs.push({ id: o.id, month: o.month, tag: o.tag, hours: o.hours, evidence: has(o, 'evidence') ? o.evidence : '' });
    }
    var snapshots = has(raw, 'snapshots') ? raw.snapshots : [];
    if (!Array.isArray(snapshots)) return { ok: false, error: 'snapshots 必须是数组' };
    var snapIds = new Set(), snapMonths = new Set();
    for (var k = 0; k < snapshots.length; k++) {
      var snap = snapshots[k];
      var serr = validateSnapshot(snap, today);
      if (serr) return { ok: false, error: '成本快照 #' + (k + 1) + ':' + serr };
      if (snapIds.has(snap.id)) return { ok: false, error: '成本快照 #' + (k + 1) + ':id「' + snap.id + '」重复' };
      if (snapMonths.has(snap.month)) return { ok: false, error: '成本快照 #' + (k + 1) + ':月份「' + snap.month + '」重复' };
      snapIds.add(snap.id); snapMonths.add(snap.month);
      data.snapshots.push(cleanSnapshot(snap));
    }
    if (has(raw, 'settings') && raw.settings !== null) {
      if (!isObj(raw.settings)) return { ok: false, error: 'settings 必须是对象' };
      if (raw.settings.fx !== undefined && raw.settings.fx !== null) {
        var fe = validateFx(raw.settings.fx);
        if (fe) return { ok: false, error: '设置:' + fe };
        data.settings.fx = { from: raw.settings.fx.from, to: raw.settings.fx.to, rate: raw.settings.fx.rate };
      }
      if (raw.settings.wage !== undefined && raw.settings.wage !== null) {
        var we = validateWage(raw.settings.wage);
        if (we) return { ok: false, error: '设置:' + we };
        data.settings.wage = { cents: raw.settings.wage.cents, currency: raw.settings.wage.currency };
      }
    }
    return { ok: true, data: data };
  }
  function cleanSub(s) {
    var bills = {};
    if (has(s, 'usageBills')) Object.keys(s.usageBills).forEach(function (k) { bills[k] = s.usageBills[k]; });
    return {
      id: s.id, name: s.name, tier: has(s, 'tier') ? s.tier : '', currency: s.currency, amountCents: s.amountCents,
      period: s.period, startDate: s.startDate, renewDate: has(s, 'renewDate') ? s.renewDate : '', status: s.status,
      tag: s.tag, who: s.who, headcount: has(s, 'headcount') ? s.headcount : 1,
      amortMonths: has(s, 'amortMonths') ? s.amortMonths : 12, usageBills: bills
    };
  }
  function validateImport(input, today) {
    var raw = input;
    if (typeof input === 'string') {
      try { raw = JSON.parse(input); } catch (e) { return { ok: false, error: '不是合法的 JSON:' + e.message }; }
    }
    return validateState(raw, today);
  }

  /* ---------- 月成本 ---------- */
  /* 返回该订阅在 month(YYYY-MM)的成本,整数分,币种为订阅自身币种。暂停/已退不计。 */
  function monthlyCost(sub, month) {
    if (!sub || sub.status !== 'active' || parseMonth(month) === null || parseDate(sub.startDate) === null) return 0;
    var start = sub.startDate.slice(0, 7);
    if (month < start) return 0;
    switch (sub.period) {
      case 'monthly': return sub.amountCents;
      case 'yearly': return Math.round(sub.amountCents / 12);
      case 'once':
        var n = sub.amortMonths || 12;
        return monthIndex(month) < monthIndex(start) + n ? Math.round(sub.amountCents / n) : 0;
      case 'usage':
        return sub.usageBills && has(sub.usageBills, month) ? sub.usageBills[month] : 0;
      default: return 0;
    }
  }

  function addToMap(map, key, cents) { map.set(key, (map.get(key) || 0) + cents); }
  function mapToList(map) {
    return Array.from(map.keys()).sort().map(function (k) { return { currency: k, cents: map.get(k) }; }).filter(function (x) { return x.cents > 0; });
  }
  function estimateOf(byCurrency, fx) {
    if (!fx || validateFx(fx)) return null;
    var cents = 0, fromCents = 0, excluded = [];
    byCurrency.forEach(function (x) {
      if (x.currency === fx.to) cents += x.cents;
      else if (x.currency === fx.from) fromCents += x.cents;
      else excluded.push(x.currency);
    });
    return { currency: fx.to, cents: cents + Math.round(fromCents * fx.rate), rate: fx.rate, from: fx.from, estimated: true, excluded: excluded };
  }

  /* 多币种各自汇总;fx={from,to,rate} 只用于总览估算(标 estimated)。 */
  function totals(subs, month, fx) {
    var map = new Map();
    var items = [];
    var missing = [];
    (subs || []).forEach(function (s) {
      var c = monthlyCost(s, month);
      if (c > 0) { addToMap(map, s.currency, c); items.push({ sub: s, cents: c }); }
      if (s.status === 'active' && s.period === 'usage' && parseMonth(month) && month >= s.startDate.slice(0, 7) && !(s.usageBills && has(s.usageBills, month))) missing.push(s.name);
    });
    var by = mapToList(map);
    return { month: month, byCurrency: by, estimate: estimateOf(by, fx), items: items, missingUsage: missing };
  }

  function snapshotForMonth(snapshots, month) {
    return (snapshots || []).filter(function (s) { return s.month === month; })[0] || null;
  }
  function snapshotTotals(snapshot, fx) {
    var map = new Map();
    if (snapshot) snapshot.items.forEach(function (it) { addToMap(map, it.currency, it.cents); });
    var by = mapToList(map);
    return { byCurrency: by, estimate: estimateOf(by, fx) };
  }
  function createSnapshot(subs, month, recordedDate, source, note, id, today) {
    if (parseDate(today) === null) return { ok: false, error: '必须提供真实存在的今天日期' };
    if (parseMonth(month) !== null && month > today.slice(0, 7)) return { ok: false, error: '成本月份不能晚于今天所在月份' };
    if (parseDate(recordedDate) !== null && recordedDate > today) return { ok: false, error: '确认日期不能晚于今天' };
    var missing = (subs || []).filter(function (s) {
      return s.status === 'active' && s.period === 'usage' && parseMonth(month) && parseDate(s.startDate) &&
        month >= s.startDate.slice(0, 7) && !(s.usageBills && has(s.usageBills, month));
    });
    if (missing.length) return { ok: false, error: '以下按量订阅缺少 ' + month + ' 的明确账单：' + missing.map(function (s) { return s.name; }).join('、') + '。请先录入账单，0 金额也要明确录入' };
    function applicable(s) {
      if (!s || s.status !== 'active' || parseMonth(month) === null || parseDate(s.startDate) === null || month < s.startDate.slice(0, 7)) return false;
      if (s.period === 'once') return monthIndex(month) < monthIndex(s.startDate.slice(0, 7)) + (s.amortMonths || 12);
      return PERIODS.indexOf(s.period) >= 0;
    }
    var snap = {
      id: id || ('snap-' + month), month: month, recordedDate: recordedDate, source: source, note: note || '',
      warnings: [],
      items: (subs || []).filter(applicable).map(function (s) { return { sub: s, cents: monthlyCost(s, month) }; })
        .map(function (x) { return { subId: x.sub.id, name: x.sub.name, currency: x.sub.currency, tag: x.sub.tag, cents: x.cents }; })
    };
    var err = validateSnapshot(snap, today);
    return err ? { ok: false, error: err } : { ok: true, snapshot: cleanSnapshot(snap) };
  }
  function upsertSnapshot(snapshots, snapshot) {
    var list = snapshots || [];
    var err = validateSnapshot(snapshot);
    if (err) return { ok: false, error: err };
    var existing = snapshotForMonth(list, snapshot.month);
    if (existing && existing.id !== snapshot.id) snapshot.id = existing.id;
    return { ok: true, updated: !!existing, snapshots: existing ? list.map(function (s) { return s.month === snapshot.month ? cleanSnapshot(snapshot) : s; }) : list.concat([cleanSnapshot(snapshot)]) };
  }

  function costPerHour(total, hours) {
    if (typeof total !== 'number' || !Number.isFinite(total)) return null;
    if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0) return null;
    return Math.round(total / hours);
  }
  function compareToWage(perHourCents, currency, wage) {
    if (perHourCents === null || !wage || wage.currency !== currency) return null;
    var level = perHourCents < wage.cents ? 'below' : perHourCents > wage.cents ? 'above' : 'equal';
    return { level: level, ratio: wage.cents > 0 ? perHourCents / wage.cents : null };
  }

  function outputIndex(outputs) {
    var m = new Map();
    (outputs || []).forEach(function (o) { m.set(o.month + '|' + o.tag, o); });
    return m;
  }
  function hoursOfMonth(outputs, month) {
    var any = false, sum = 0;
    (outputs || []).forEach(function (o) { if (o.month === month) { any = true; sum += o.hours; } });
    return any ? round2(sum) : null;
  }

  /* 单月完整汇总:总成本、各用途、每小时当量成本及与时薪的比较 */
  function summarizeMonth(subs, outputs, month, fx, wage, snapshots) {
    var snap = snapshotForMonth(snapshots, month);
    var t = totals(subs, month, fx);
    if (snap) {
      var st = snapshotTotals(snap, fx);
      t = {
        month: month, byCurrency: st.byCurrency, estimate: st.estimate, missingUsage: [],
        items: snap.items.map(function (it) { return { sub: { id: it.subId, name: it.name, currency: it.currency, tag: it.tag }, cents: it.cents }; })
      };
    }
    var hours = hoursOfMonth(outputs, month);
    function cphList(list, h) {
      return list.map(function (x) {
        var c = costPerHour(x.cents, h);
        return { currency: x.currency, cents: c, wage: compareToWage(c, x.currency, wage) };
      });
    }
    /* 多币种共用同一份小时当量,分币种相除没有意义:总览只在单币种时给比值,多币种看折算估算 */
    var overall = t.byCurrency.length <= 1 ? cphList(t.byCurrency, hours) : [];
    var est = null;
    var missingFx = t.estimate ? t.estimate.excluded.slice() : [];
    /* 有未折算币种时,估算合计缺了那部分成本,不能再算总体每小时成本或与时薪比较 */
    if (t.estimate && !missingFx.length) {
      var ec = costPerHour(t.estimate.cents, hours);
      est = { currency: t.estimate.currency, cents: ec, wage: compareToWage(ec, t.estimate.currency, wage), estimated: true };
    }
    var idx = outputIndex(outputs);
    var perTag = TAGS.map(function (tag) {
      var map = new Map();
      t.items.forEach(function (it) { if (it.sub.tag === tag) addToMap(map, it.sub.currency, it.cents); });
      var by = mapToList(map);
      var rec = idx.get(month + '|' + tag);
      var h = rec ? rec.hours : null;
      var tagEst = estimateOf(by, fx);
      var tagEstCents = tagEst ? costPerHour(tagEst.cents, h) : null;
      return {
        tag: tag, byCurrency: by, hours: h, evidence: rec ? rec.evidence : '',
        perHour: by.length <= 1 ? cphList(by, h) : [],
        missingFx: tagEst ? tagEst.excluded.slice() : [],
        perHourEstimate: tagEst && !tagEst.excluded.length && by.length > 1 ? { currency: tagEst.currency, cents: tagEstCents, wage: compareToWage(tagEstCents, tagEst.currency, wage), estimated: true } : null
      };
    }).filter(function (r) { return r.byCurrency.length > 0 || r.hours !== null; });
    return { month: month, totals: t, hours: hours, perHour: overall, perHourEstimate: est, missingFx: missingFx, perTag: perTag, sourceMode: snap ? 'snapshot' : 'projection', snapshot: snap, snapshotWarnings: snap ? snap.warnings.slice() : [] };
  }

  /* ---------- 提醒 ---------- */
  function alerts(subs, outputs, today) {
    var list = [];
    var thisMonth = today.slice(0, 7);
    var prevMonth = addMonths(thisMonth, -1);
    var idx = outputIndex(outputs);
    var active = (subs || []).filter(function (s) { return s.status === 'active'; });
    active.forEach(function (s) {
      if (!s.renewDate) return;
      var d = daysBetween(today, s.renewDate);
      if (d >= 0 && d <= 7) {
        list.push({ type: 'renew', subIds: [s.id], days: d, message: '「' + s.name + '」' + (d === 0 ? '今天续费' : d + ' 天后续费') + '(' + s.renewDate + ')' });
      } else if (d < 0) {
        list.push({ type: 'renew-overdue', subIds: [s.id], days: d, message: '「' + s.name + '」的续费日 ' + s.renewDate + ' 已过 ' + (-d) + ' 天,请更新续费日' });
      }
    });
    list.sort(function (a, b) { return (a.type === b.type ? a.days - b.days : a.type === 'renew' ? -1 : 1); });
    active.forEach(function (s) {
      if (s.startDate.slice(0, 7) > prevMonth) return;
      var a = idx.get(prevMonth + '|' + s.tag);
      var b = idx.get(thisMonth + '|' + s.tag);
      if (a && b && a.hours === 0 && b.hours === 0) {
        list.push({ type: 'pause', subIds: [s.id], tag: s.tag, message: '「' + s.name + '」所属用途「' + s.tag + '」已连续 2 个月(' + prevMonth + '、' + thisMonth + ')产出小时当量为 0,考虑暂停' });
      }
    });
    var groups = new Map();
    active.forEach(function (s) { if (!groups.has(s.tag)) groups.set(s.tag, []); groups.get(s.tag).push(s); });
    TAGS.forEach(function (tag) {
      var g = groups.get(tag);
      if (g && g.length >= 3) {
        list.push({ type: 'overlap', subIds: g.map(function (s) { return s.id; }), tag: tag, message: '用途「' + tag + '」有 ' + g.length + ' 个在用订阅(' + g.map(function (s) { return s.name; }).join('、') + '),可能重叠' });
      }
    });
    return list;
  }

  /* 保存产出:按正在编辑的记录 ID 更新;目标月份+用途已被另一条记录占用时返回冲突,不覆盖 */
  function upsertOutput(outputs, rec, editingId) {
    var list = outputs || [];
    var clash = list.filter(function (o) { return o.month === rec.month && o.tag === rec.tag && o.id !== editingId; })[0];
    var self = editingId ? list.filter(function (o) { return o.id === editingId; })[0] : null;
    if (self) {
      if (clash) return { ok: false, conflict: true, error: rec.month + ' 的「' + rec.tag + '」已有另一条记录。请先删除那一条,或改回原月份/用途。' };
      var upd = Object.assign({}, rec, { id: editingId });
      return { ok: true, updated: true, outputs: list.map(function (o) { return o.id === editingId ? upd : o; }) };
    }
    if (clash) return { ok: true, updated: true, outputs: list.map(function (o) { return o === clash ? Object.assign({}, rec, { id: clash.id }) : o; }) };
    return { ok: true, updated: false, outputs: list.concat([rec]) };
  }

  /* ---------- 趋势与对比 ---------- */
  function trend(subs, outputs, months, fx, snapshots) {
    return (months || []).map(function (m) {
      var snap = snapshotForMonth(snapshots, m);
      if (snap) {
        var st = snapshotTotals(snap, fx);
        return { month: m, byCurrency: st.byCurrency, estimate: st.estimate, hours: hoursOfMonth(outputs, m), sourceMode: 'snapshot', snapshot: snap };
      }
      var t = totals(subs, m, fx);
      return { month: m, byCurrency: t.byCurrency, estimate: t.estimate, hours: hoursOfMonth(outputs, m), sourceMode: 'projection', snapshot: null };
    });
  }
  function compare(thisMonth, lastMonth) {
    var cur = new Map(), prev = new Map();
    ((thisMonth && thisMonth.byCurrency) || []).forEach(function (x) { cur.set(x.currency, x.cents); });
    ((lastMonth && lastMonth.byCurrency) || []).forEach(function (x) { prev.set(x.currency, x.cents); });
    var keys = Array.from(new Set(Array.from(cur.keys()).concat(Array.from(prev.keys())))).sort();
    var currencies = keys.map(function (k) {
      var now = cur.get(k) || 0, before = prev.get(k) || 0, diff = now - before;
      return { currency: k, now: now, prev: before, diff: diff, pct: before > 0 ? Math.round(diff / before * 1000) / 10 : null };
    });
    var hn = thisMonth ? thisMonth.hours : null, hp = lastMonth ? lastMonth.hours : null;
    var hours = (hn === null || hn === undefined) && (hp === null || hp === undefined) ? null : {
      now: hn === undefined ? null : hn, prev: hp === undefined ? null : hp,
      diff: typeof hn === 'number' && typeof hp === 'number' ? round2(hn - hp) : null
    };
    return { currencies: currencies, hours: hours };
  }

  /* ---------- 导出 ---------- */
  /* 公式注入防护:以 = + - @ 开头(或制表/回车开头)的用户文本加单引号前缀;单独的 - 或 + 不算 */
  function guardFormula(v) {
    var s = String(v);
    if (s.length > 1 && /^[=+\-@]/.test(s)) return "'" + s;
    if (/^[\t\r]/.test(s)) return "'" + s;
    return s;
  }
  function csvCell(v) {
    var s = guardFormula(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(subs, month) {
    var head = ['服务名', '档位', '币种', '金额', '周期', '开始日', '续费日', '状态', '用途', '使用者', '人数', '摊销月数', '按量账单'];
    if (month) head.push(month + ' 月成本');
    var rows = [head.map(csvCell).join(',')];
    (subs || []).forEach(function (s) {
      var bills = Object.keys(s.usageBills || {}).sort().map(function (k) { return k + ':' + formatMoney(s.usageBills[k]); }).join(';');
      var cols = [s.name, s.tier || '', s.currency, formatMoney(s.amountCents), PERIOD_LABEL[s.period], s.startDate, s.renewDate || '',
        STATUS_LABEL[s.status], s.tag, WHO_LABEL[s.who], s.headcount || 1, s.period === 'once' ? (s.amortMonths || 12) : '', bills];
      if (month) cols.push(formatMoney(monthlyCost(s, month)));
      rows.push(cols.map(csvCell).join(','));
    });
    return rows.join('\n') + '\n';
  }
  function mdCell(v) {
    return guardFormula(String(v).replace(/\r?\n|\r/g, ' ')).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function moneyList(list) {
    return list.length ? list.map(function (x) { return x.currency + ' ' + formatMoney(x.cents, true); }).join(' / ') : '无';
  }
  function wageText(w) {
    if (!w) return '';
    return w.level === 'below' ? '低于时薪' : w.level === 'above' ? '高于时薪' : '等于时薪';
  }
  function perHourText(list) {
    return list.map(function (x) {
      var pre = x.estimated ? '估算 ' : '';
      return x.cents === null ? pre + x.currency + ' —' : pre + x.currency + ' ' + formatMoney(x.cents, true) + '/小时' + (x.wage ? '(' + wageText(x.wage) + ')' : '');
    }).join(' / ');
  }

  function toMarkdown(subs, outputs, month, opts) {
    opts = opts || {};
    var fx = opts.fx || null, wage = opts.wage || null;
    var sum = summarizeMonth(subs, outputs, month, fx, wage, opts.snapshots);
    var snapshot = snapshotForMonth(opts.snapshots, month);
    var reported = snapshot ? snapshotTotals(snapshot, fx) : { byCurrency: sum.totals.byCurrency, estimate: sum.totals.estimate };
    var prev = addMonths(month, -1);
    var cmp = compare(trend(subs, outputs, [month], fx, opts.snapshots)[0], trend(subs, outputs, [prev], fx, opts.snapshots)[0]);
    var L = [];
    L.push('# AI 订阅成本月报 ' + month, '');
    L.push('## 本月成本', '');
    L.push('- 成本口径:' + (snapshot ? '用户确认的月度成本快照(确认日期 ' + snapshot.recordedDate + ';来源:' + mdCell(snapshot.source) + ')' : '按当前订阅状态推算,不是冻结的历史记录'));
    L.push('- 记账口径:固定月费、年付及一次性费用按月摊销；按量取已录账单。快照不是实付账单或付款证据。');
    if (snapshot && snapshot.warnings) snapshot.warnings.forEach(function (warning) { L.push('- 完整性提示:' + mdCell(warning)); });
    L.push('- 各币种合计(不换汇):' + moneyList(reported.byCurrency));
    if (reported.estimate) {
      var e = reported.estimate;
      L.push('- 估算合计(使用当前设置的汇率 1 ' + e.from + ' = ' + e.rate + ' ' + e.currency + ';快照只冻结各原币金额，不冻结汇率):' + e.currency + ' ' + formatMoney(e.cents, true) + (e.excluded.length ? ';未折算币种:' + e.excluded.join('、') : ''));
    }
    if (sum.totals.missingUsage.length) L.push('- 未填本月账单的按量订阅:' + sum.totals.missingUsage.map(mdCell).join('、'));
    if (snapshot && snapshot.note) L.push('- 快照备注:' + mdCell(snapshot.note));
    if (snapshot && snapshot.warnings.length) L.push('- 快照完整性提示:' + snapshot.warnings.map(mdCell).join('；'));
    L.push('', '## 硅基产出与每小时当量成本', '');
    if (sum.hours === null) {
      L.push('本月未填产出,只显示成本,不计算每小时当量成本。');
    } else {
      L.push('- 本月小时当量合计:' + fmtHours(sum.hours));
      if (wage) L.push('- 机会成本时薪:' + wage.currency + ' ' + formatMoney(wage.cents, true));
      if (sum.missingFx.length) L.push('- 以下币种没有折算汇率,无法给出总体每小时当量成本和时薪结论:' + sum.missingFx.join('、'));
      L.push('- 每小时当量成本:' + (sum.hours > 0 ? (perHourText(sum.perHour) || (sum.missingFx.length ? '未折算币种缺汇率' : '多币种,见下方估算')) + (sum.perHourEstimate ? (sum.perHour.length ? ' / ' : '') + perHourText([sum.perHourEstimate]) : '') : '产出为 0,无法计算'));
      L.push('', '| 用途 | 成本 | 小时当量 | 每小时当量成本 | 证据(交付物) |', '| --- | --- | --- | --- | --- |');
      sum.perTag.forEach(function (r) {
        L.push('| ' + [r.tag, moneyList(r.byCurrency), r.hours === null ? '未填' : fmtHours(r.hours),
          r.hours === null ? '—' : r.hours > 0 ? (perHourText(r.perHour.concat(r.perHourEstimate ? [r.perHourEstimate] : [])) || '—') : '产出为 0', r.evidence || ''].map(mdCell).join(' | ') + ' |');
      });
    }
    L.push('', '## 本月 vs 上月(' + prev + ')', '');
    cmp.currencies.forEach(function (c) {
      L.push('- ' + c.currency + ':' + formatMoney(c.now, true) + ' vs ' + formatMoney(c.prev, true) + ',' + (c.diff >= 0 ? '+' : '-') + formatMoney(Math.abs(c.diff), true) + (c.pct === null ? '' : '(' + (c.pct >= 0 ? '+' : '') + c.pct + '%)'));
    });
    if (!cmp.currencies.length) L.push('- 两个月都没有成本');
    if (cmp.hours) L.push('- 小时当量:' + (cmp.hours.now === null ? '未填' : fmtHours(cmp.hours.now)) + ' vs ' + (cmp.hours.prev === null ? '未填' : fmtHours(cmp.hours.prev)));
    if (opts.today) {
      var al = alerts(subs, outputs, opts.today);
      L.push('', '## 提醒(截至 ' + opts.today + ')', '');
      if (al.length) al.forEach(function (a) { L.push('- ' + mdCell(a.message)); });
      else L.push('- 无');
    }
    if (snapshot) {
      L.push('', '## 已确认快照明细', '', '| 服务 | 币种 | 已确认成本 | 用途 |', '| --- | --- | --- | --- |');
      snapshot.items.forEach(function (it) {
        L.push('| ' + [it.name, it.currency, formatMoney(it.cents, true), it.tag].map(mdCell).join(' | ') + ' |');
      });
    }
    L.push('', '## 当前订阅明细（按当前状态推算）', '', '| 服务 | 档位 | 周期 | 原价 | 本月推算成本 | 状态 | 用途 | 使用者 | 续费日 |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    (subs || []).forEach(function (s) {
      L.push('| ' + [s.name, s.tier || '', PERIOD_LABEL[s.period], s.currency + ' ' + formatMoney(s.amountCents, true), s.currency + ' ' + formatMoney(monthlyCost(s, month), true),
        STATUS_LABEL[s.status], s.tag, s.who === 'team' ? '团队 ' + (s.headcount || 1) + ' 人' : '自己', s.renewDate || ''].map(mdCell).join(' | ') + ' |');
    });
    L.push('', '## 口径', '',
      '- 快照保存月度成本计算结果：月付取固定月费，年付按 1/12 折月，一次性按摊销月数平均，按量取已录入的当月账单；暂停与已退不计。快照不是支付凭证。',
      '- 小时当量是自估值；各原币金额会冻结，但折算合计使用当前汇率设置，汇率变化会改变估算值。', '');
    return L.join('\n');
  }

  var api = {
    VERSION: VERSION, MAX_CENTS: MAX_CENTS, MAX_HOURS: MAX_HOURS, MAX_TEXT: MAX_TEXT, MAX_EVIDENCE: MAX_EVIDENCE,
    MAX_AMORT: MAX_AMORT, MAX_HEADCOUNT: MAX_HEADCOUNT, PERIODS: PERIODS, STATUSES: STATUSES, TAGS: TAGS, WHOS: WHOS,
    PERIOD_LABEL: PERIOD_LABEL, STATUS_LABEL: STATUS_LABEL, WHO_LABEL: WHO_LABEL,
    parseDate: parseDate, parseMonth: parseMonth, addMonths: addMonths, addDays: addDays, daysBetween: daysBetween,
    lastMonths: lastMonths, resolveToday: resolveToday, parseMoney: parseMoney, parseHours: parseHours,
    formatMoney: formatMoney, fmtHours: fmtHours, emptyState: emptyState,
    validateSub: validateSub, validateOutput: validateOutput, validateFx: validateFx, validateWage: validateWage, validateSnapshot: validateSnapshot,
    validateState: validateState, validateImport: validateImport,
    monthlyCost: monthlyCost, totals: totals, snapshotForMonth: snapshotForMonth, snapshotTotals: snapshotTotals,
    createSnapshot: createSnapshot, upsertSnapshot: upsertSnapshot, costPerHour: costPerHour, compareToWage: compareToWage,
    summarizeMonth: summarizeMonth, upsertOutput: upsertOutput, alerts: alerts, trend: trend, compare: compare,
    toCsv: toCsv, toMarkdown: toMarkdown, guardFormula: guardFormula
  };
  globalThis.LedgerCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
