(function (root) {
  'use strict';
  var VERSION = 1;
  var OUTCOMES = ['pending', 'passed', 'failed'];
  var USAGE_UNITS = ['percentage_points', 'tokens', 'requests', 'credits', 'minutes', 'other'];
  var MAX_TEXT = 1000;
  var MAX_MINUTES = 1000000;
  var MAX_CENTS = 1000000000000;

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function obj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function validDate(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    var p = v.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  }
  function text(v, label, max, empty) {
    if (typeof v !== 'string') return label + '必须是文本';
    if (!empty && !v.trim()) return label + '不能为空';
    if (v.length > max) return label + '不能超过 ' + max + ' 个字符';
    return null;
  }
  function validId(v) { return typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v); }
  function validCurrency(v) { return typeof v === 'string' && /^[A-Z]{3}$/.test(v); }
  function validMinutes(v) { return Number.isInteger(v) && v >= 0 && v <= MAX_MINUTES; }
  function validFinite(v) { return typeof v === 'number' && Number.isFinite(v); }

  function validateApi(api) {
    if (api === null) return null;
    if (!obj(api)) return 'API 费用必须为空或对象';
    if (!validCurrency(api.currency)) return 'API 费用币种必须是 3 位大写字母';
    if (!Number.isSafeInteger(api.amountCents) || api.amountCents < 0 || api.amountCents > MAX_CENTS) return 'API 费用必须是非负、有限且以分为单位的整数';
    return null;
  }
  function validateWage(wage) {
    if (wage === null) return null;
    if (!obj(wage)) return '人工时薪必须为空或对象';
    if (!validCurrency(wage.currency)) return '人工时薪币种必须是 3 位大写字母';
    if (!Number.isSafeInteger(wage.centsPerHour) || wage.centsPerHour < 0 || wage.centsPerHour > MAX_CENTS) return '人工时薪必须是非负、有限且以分为单位的整数';
    return null;
  }
  function validateUsage(u) {
    if (u === null) return null;
    if (!obj(u)) return '订阅额度观察必须为空或对象';
    if (USAGE_UNITS.indexOf(u.unit) < 0) return '订阅额度单位不支持';
    if (!validFinite(u.before) || !validFinite(u.after) || u.before < 0 || u.after < 0) return '订阅额度前后值必须是非负有限数字';
    if (typeof u.comparable !== 'boolean' || typeof u.reset !== 'boolean') return '订阅额度的可比和重置标记必须是布尔值';
    var e = text(u.windowLabel, '额度窗口', 200, false); if (e) return e;
    e = text(u.unitLabel || '', '自定义单位', 80, u.unit !== 'other'); if (e) return e;
    return null;
  }
  function validateTask(t) {
    if (!obj(t)) return '任务必须是对象';
    if (own(t, 'synthetic') && typeof t.synthetic !== 'boolean') return 'synthetic 必须是布尔值';
    if (!validId(t.id)) return 'id 必须是 1–64 位字母、数字、下划线或连字符';
    var e = text(t.name, '任务名', 200, false); if (e) return e;
    e = text(t.type, '任务类型', 120, false); if (e) return e;
    e = text(t.model, '模型', 120, false); if (e) return e;
    e = text(t.acceptance, '验收条件', MAX_TEXT, false); if (e) return e;
    e = text(t.notes || '', '备注', MAX_TEXT, true); if (e) return e;
    if (!validDate(t.date)) return '日期必须是真实存在的 YYYY-MM-DD';
    if (OUTCOMES.indexOf(t.outcome) < 0) return '结果必须是 pending / passed / failed';
    if (!validMinutes(t.workMinutes) || !validMinutes(t.reworkMinutes)) return '工作和返工分钟必须是 0–' + MAX_MINUTES + ' 的整数';
    e = validateApi(t.api); if (e) return e;
    e = validateWage(t.wage); if (e) return e;
    e = validateUsage(t.subscriptionUsage); if (e) return e;
    return null;
  }
  function cleanTask(t) {
    return {
      id: t.id, name: t.name.trim(), type: t.type.trim(), date: t.date, model: t.model.trim(),
      acceptance: t.acceptance.trim(), outcome: t.outcome, workMinutes: t.workMinutes,
      reworkMinutes: t.reworkMinutes, api: t.api === null ? null : { currency: t.api.currency, amountCents: t.api.amountCents },
      subscriptionUsage: t.subscriptionUsage === null ? null : {
        unit: t.subscriptionUsage.unit, unitLabel: (t.subscriptionUsage.unitLabel || '').trim(),
        before: t.subscriptionUsage.before, after: t.subscriptionUsage.after,
        windowLabel: t.subscriptionUsage.windowLabel.trim(), comparable: t.subscriptionUsage.comparable,
        reset: t.subscriptionUsage.reset
      },
      wage: t.wage === null ? null : { currency: t.wage.currency, centsPerHour: t.wage.centsPerHour },
      notes: (t.notes || '').trim(), synthetic: own(t, 'synthetic') ? t.synthetic : false
    };
  }
  function emptyState() { return { version: VERSION, synthetic: false, tasks: [] }; }
  function validateState(raw) {
    if (!obj(raw)) return { ok: false, error: '备份内容必须是对象' };
    if (raw.version !== VERSION) return { ok: false, error: '不支持的版本号' };
    if (typeof raw.synthetic !== 'boolean') return { ok: false, error: 'synthetic 必须是布尔值' };
    if (!Array.isArray(raw.tasks) || raw.tasks.length > 10000) return { ok: false, error: 'tasks 必须是最多 10000 条的数组' };
    var ids = new Set(), tasks = [];
    for (var i = 0; i < raw.tasks.length; i++) {
      var e = validateTask(raw.tasks[i]);
      if (e) return { ok: false, error: '任务 #' + (i + 1) + '：' + e };
      if (ids.has(raw.tasks[i].id)) return { ok: false, error: '任务 #' + (i + 1) + '：id 重复' };
      ids.add(raw.tasks[i].id);
      var cleaned = cleanTask(raw.tasks[i]);
      if (!own(raw.tasks[i], 'synthetic')) cleaned.synthetic = raw.synthetic;
      tasks.push(cleaned);
    }
    return { ok: true, data: { version: VERSION, synthetic: tasks.some(function (t) { return t.synthetic; }), tasks: tasks } };
  }
  function validateImport(input) {
    var raw = input;
    if (typeof input === 'string') { try { raw = JSON.parse(input); } catch (e) { return { ok: false, error: '不是合法 JSON：' + e.message }; } }
    return validateState(raw);
  }
  function median(xs) {
    if (!xs.length) return null;
    var a = xs.slice().sort(function (x, y) { return x - y; }), m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function summarize(state) {
    var cost = new Map(), unknownApi = 0, human = new Map(), unknownWage = 0, groups = new Map();
    var real = state.tasks.filter(function (t) { return !t.synthetic; });
    real.forEach(function (t) {
      if (t.api === null) unknownApi++; else cost.set(t.api.currency, (cost.get(t.api.currency) || 0) + t.api.amountCents);
      if (t.wage !== null) {
        var hc = Math.round((t.workMinutes + t.reworkMinutes) * t.wage.centsPerHour / 60);
        human.set(t.wage.currency, (human.get(t.wage.currency) || 0) + hc);
      } else unknownWage++;
      if (!groups.has(t.type)) groups.set(t.type, { type: t.type, total: 0, passed: 0, minutes: [] });
      var g = groups.get(t.type); g.total++;
      if (t.outcome === 'passed') { g.passed++; g.minutes.push(t.workMinutes + t.reworkMinutes); }
    });
    function list(map) { return Array.from(map).sort().map(function (x) { return { currency: x[0], cents: x[1] }; }); }
    return {
      tasks: state.tasks.length, realTasks: real.length, syntheticTasks: state.tasks.length - real.length,
      passed: real.filter(function (t) { return t.outcome === 'passed'; }).length,
      apiByCurrency: list(cost), unknownApi: unknownApi, humanByCurrency: list(human), unknownWage: unknownWage,
      comparisons: Array.from(groups.values()).sort(function (a, b) { return a.type.localeCompare(b.type, 'zh-CN'); }).map(function (g) {
        return { type: g.type, total: g.total, passed: g.passed, medianPassedMinutes: median(g.minutes) };
      })
    };
  }
  function usageDelta(u) {
    if (!u) return { status: 'unknown', delta: null };
    if (u.reset) return { status: 'reset', delta: null };
    if (!u.comparable) return { status: 'incomparable', delta: null };
    return { status: 'observed', delta: u.after - u.before, unit: u.unit, unitLabel: u.unitLabel || '' };
  }
  function csvSafe(v) {
    var s = String(v === null || v === undefined ? '' : v);
    if (/^[\s\x00-\x1f]*[=+\-@]/.test(s) && s.trim() !== '-' && s.trim() !== '+') s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function exportCsv(state) {
    var rows = [['任务ID','示例身份','任务名','类型','日期','模型','验收条件','结果','工作分钟','返工分钟','API费用','API币种','额度单位','额度前值','额度后值','额度窗口','额度可比','额度重置','人工时薪','时薪币种','备注']];
    state.tasks.forEach(function (t) { rows.push([
      t.id,t.synthetic?'合成示例':'本人记录',t.name,t.type,t.date,t.model,t.acceptance,t.outcome,t.workMinutes,t.reworkMinutes,
      t.api === null ? '未知' : (t.api.amountCents / 100).toFixed(2), t.api === null ? '' : t.api.currency,
      t.subscriptionUsage ? (t.subscriptionUsage.unit === 'other' ? t.subscriptionUsage.unitLabel : t.subscriptionUsage.unit) : '',
      t.subscriptionUsage ? t.subscriptionUsage.before : '', t.subscriptionUsage ? t.subscriptionUsage.after : '',
      t.subscriptionUsage ? t.subscriptionUsage.windowLabel : '', t.subscriptionUsage ? t.subscriptionUsage.comparable : '',
      t.subscriptionUsage ? t.subscriptionUsage.reset : '', t.wage ? (t.wage.centsPerHour / 100).toFixed(2) : '',
      t.wage ? t.wage.currency : '', t.notes
    ]); });
    return '\ufeff' + rows.map(function (r) { return r.map(csvSafe).join(','); }).join('\n');
  }
  function exportMarkdown(state) {
    var s = summarize(state), out = ['# AI 单任务投入报告','', state.synthetic ? '> 报告含合成示例；每条任务单独标记身份。' : '> 本报告来自本机手工记录。', '',
      '- 本人记录：' + s.realTasks + ' 项；合成示例：' + s.syntheticTasks + ' 项', '- 本人记录中验收通过：' + s.passed, '- 本人记录中 API 费用未知：' + s.unknownApi + ' 项',
      '- 说明：API 费用、人工估算和订阅额度是三种独立口径，不互相换算。', '', '## 按币种汇总', ''];
    if (!s.apiByCurrency.length) out.push('- 没有已知 API 费用。');
    s.apiByCurrency.forEach(function (x) { out.push('- API ' + x.currency + ' ' + (x.cents / 100).toFixed(2)); });
    s.humanByCurrency.forEach(function (x) { out.push('- 人工估算 ' + x.currency + ' ' + (x.cents / 100).toFixed(2)); });
    out.push('- 人工时薪未知：' + s.unknownWage + ' 项');
    out.push('', '## 同类任务观察', '', '> 仅统计验收通过任务的总耗时中位数。这是描述性记录，不证明 AI 造成了节省。');
    s.comparisons.forEach(function (g) { out.push('- ' + g.type + '：全部 ' + g.total + ' 项，通过 ' + g.passed + ' 项；通过样本中位总耗时 ' + (g.medianPassedMinutes === null ? '无法计算' : g.medianPassedMinutes + ' 分钟')); });
    out.push('', '## 任务明细', '');
    state.tasks.forEach(function (t) {
      var u = usageDelta(t.subscriptionUsage);
      out.push('### ' + t.name, '', '- 身份：' + (t.synthetic ? '合成示例' : '本人记录'), '- 日期：' + t.date, '- 类型：' + t.type, '- 模型：' + t.model,
        '- 验收条件：' + t.acceptance, '- 结果：' + t.outcome, '- 工作 / 返工：' + t.workMinutes + ' / ' + t.reworkMinutes + ' 分钟',
        '- API 费用：' + (t.api ? t.api.currency + ' ' + (t.api.amountCents / 100).toFixed(2) : '未知'),
        '- 额度观察：' + (u.status === 'observed' ? String(u.delta) + ' ' + (u.unit === 'percentage_points' ? '百分点' : (u.unitLabel || u.unit)) : (u.status === 'unknown' ? '未记录' : (u.status === 'reset' ? '窗口已重置，不可比较' : '窗口不可比'))),
        '- 备注：' + (t.notes || '无'), '');
    });
    return out.join('\n');
  }
  function parseMoney(v) {
    var s = String(v).trim(); if (!/^\d+(?:\.\d{1,2})?$/.test(s)) return null;
    var cents = Math.round(Number(s) * 100); return Number.isSafeInteger(cents) && cents <= MAX_CENTS ? cents : null;
  }
  var api = { VERSION:VERSION, OUTCOMES:OUTCOMES, USAGE_UNITS:USAGE_UNITS, emptyState:emptyState, validDate:validDate,
    validateTask:validateTask, validateState:validateState, validateImport:validateImport, summarize:summarize, usageDelta:usageDelta,
    exportCsv:exportCsv, exportMarkdown:exportMarkdown, parseMoney:parseMoney, median:median };
  root.TaskEffortCore = api; if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
