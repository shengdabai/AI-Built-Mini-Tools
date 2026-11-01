/* 委托契约卡 core.js — 纯逻辑，无 DOM。
 * 规则来源（均为笔记原文口径）：
 *   · 净省时 ＝ 表面省时 − 监督 − 返工 − 授权维护 − 学习；表面省时 ＝ 同质人工基线 − AI 流程中的必要人工执行；允许负值。
 *     （《有边界的委托》图 F：「净省时 ＝ 180 − 35 − 25 − 10 − 20 ＝ 90 分钟；复核：240 −（必要执行 60 ＋ 监督 35 ＋ 返工 25 ＋ 授权 10 ＋ 学习 20）＝ 90」）
 *   · 自主行动区：已明确授权；可逆；不产生新的对外承诺或后续义务。必须询问区：不可逆，或涉及责任、敏感资料提交与他人权益。（a16z 拆解）
 *   · 信任阶梯：只建议 → 确认后执行 → 已授权范围内自主行动。（a16z 拆解）
 *   · 人确认付款、发布、删除、对外发送等高影响或不可逆动作。（刘小排学习地图「上下文不等于安全权限」）
 *   · 任务包：目标结果、输入材料、完成标准、截止条件、卡住时的提问方式。（刘小排学习地图）
 *   · 决策闸门：扩大＝验收合格、净省时为正；收缩＝质量达标但注意力或成本不划算；只扩大一个维度。（《有边界的委托》7 天实验）
 */
(function () {
  'use strict';

  var ZONES = [
    { id: 'auto', name: '自主区', rule: '可直接做：已明确授权、可逆、不产生新的对外承诺或后续义务' },
    { id: 'ask', name: '必问区', rule: '先停下问我：不可逆，或涉及责任、敏感资料提交与他人权益' },
    { id: 'deny', name: '禁止区', rule: '本次委托不授权，任何情况都不做' }
  ];

  var TRUST_LEVELS = [
    { level: 1, name: '只建议', meaning: '代理只给建议与草稿，由我自己动手执行。' },
    { level: 2, name: '确认后执行', meaning: '代理可以执行，但每个会产生后果的动作先经我确认。' },
    { level: 3, name: '授权范围内自主', meaning: '在已授权范围内自主行动；每次扩权仍需我明确同意，也可退回上一级。' }
  ];

  // readOnly：只读取、不改变任何状态；high：笔记点名须人确认的高影响/不可逆动作
  var DEFAULT_ACTIONS = [
    { id: 'read', label: '读文件', high: false, readOnly: true, zone: 'auto' },
    { id: 'search', label: '联网检索', high: false, readOnly: true, zone: 'auto' },
    { id: 'edit', label: '改文件', high: false, readOnly: false, zone: 'ask' },
    { id: 'exec', label: '执行命令', high: false, readOnly: false, zone: 'ask' },
    { id: 'install', label: '安装依赖', high: false, readOnly: false, zone: 'ask' },
    { id: 'send', label: '发消息 / 外发', high: true, readOnly: false, zone: 'ask' },
    { id: 'pay', label: '付款 / 花钱', high: true, readOnly: false, zone: 'ask' },
    { id: 'deploy', label: '发布 / 部署', high: true, readOnly: false, zone: 'ask' },
    { id: 'delete', label: '删除数据', high: true, readOnly: false, zone: 'ask' },
    { id: 'creds', label: '改权限 / 凭据', high: true, readOnly: false, zone: 'ask' }
  ];

  var TIMING_FIELDS = [
    { key: 'baseline', label: '手工基线', hint: '同质任务自己手工做要多久' },
    { key: 'humanExec', label: 'AI 流程人工执行', hint: 'AI 流程中你仍必须亲自做的时间；机器独立运行不算，被迫守候、无法另作安排的时间要算' },
    { key: 'supervision', label: '监督', hint: '中途干预与终验' },
    { key: 'rework', label: '返工', hint: '修正 AI 产出' },
    { key: 'authMaintenance', label: '授权维护', hint: '配置权限、账号、连接器' },
    { key: 'learning', label: '学习', hint: '本次为学会这套流程实际投入的时间' }
  ];
  var MAX_MINUTES = 100000;

  function str(v, max) {
    if (v == null) return '';
    var s = String(v).replace(/\r\n?/g, '\n').trim();
    return s.length > (max || 2000) ? s.slice(0, max || 2000) : s;
  }
  /** 用户正文：只规范换行与首尾空白，不截断；超长由 lengthErrors / validateContract 显式报告。 */
  function text(v) { return v == null ? '' : String(v).replace(/\r\n?/g, '\n').trim(); }

  // 与 index.html 中 maxlength 一致的字数上限（按 JS 字符串长度计，与浏览器 maxlength 口径相同）
  var LIMITS = { taskName: 80, taskType: 80, goal: 2000, inputs: 2000, deadline: 2000, stuckProtocol: 2000, criterion: 300 };
  var FIELD_LABELS = { taskName: '任务名', taskType: '任务类型', goal: '目标结果', inputs: '输入材料', deadline: '截止条件', stuckProtocol: '卡住时怎么问我' };
  function uid(prefix) { return (prefix || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function zoneOf(id) { for (var i = 0; i < ZONES.length; i++) if (ZONES[i].id === id) return ZONES[i]; return null; }
  function trustOf(level) { for (var i = 0; i < TRUST_LEVELS.length; i++) if (TRUST_LEVELS[i].level === level) return TRUST_LEVELS[i]; return null; }

  function defaultActions() { return DEFAULT_ACTIONS.map(function (a) { return Object.assign({ custom: false }, a); }); }

  function createContract() {
    return { id: uid('k'), taskName: '', taskType: '', goal: '', inputs: '', criteria: [''], deadline: '', stuckProtocol: '', trustLevel: 1, actions: defaultActions() };
  }

  /** 清洗任意输入（localStorage / 导入）为合法契约；非法字段回落默认值。 */
  function normalizeContract(input) {
    var c = createContract();
    if (!input || typeof input !== 'object') return c;
    if (typeof input.id === 'string' && input.id) c.id = input.id.slice(0, 64);
    // 不静默截断用户正文：超出 LIMITS 的内容原样保留，由 validateContract 报错、界面阻止存入/导出
    ['taskName', 'taskType', 'goal', 'inputs', 'deadline', 'stuckProtocol'].forEach(function (k) { c[k] = text(input[k]); });
    if (Array.isArray(input.criteria)) {
      c.criteria = input.criteria.map(function (x) { return text(x); }).slice(0, 20);
      if (!c.criteria.length) c.criteria = [''];
    }
    var lv = Number(input.trustLevel);
    c.trustLevel = trustOf(lv) ? lv : 1;
    if (Array.isArray(input.actions) && input.actions.length) {
      var seen = {};
      c.actions = input.actions.filter(function (a) {
        if (!a || typeof a !== 'object' || !str(a.label, 40) || typeof a.id !== 'string' || seen[a.id]) return false;
        seen[a.id] = true;
        return true;
      }).map(function (a) {
        return { id: a.id.slice(0, 64), label: str(a.label, 40), high: !!a.high, readOnly: !!a.readOnly, custom: !!a.custom, zone: zoneOf(a.zone) ? a.zone : 'ask' };
      });
      if (!c.actions.length) c.actions = defaultActions();
    }
    return c;
  }

  function moveAction(contract, actionId, zone) {
    if (!zoneOf(zone)) throw new Error('未知分区：' + zone);
    var found = false;
    var actions = contract.actions.map(function (a) {
      if (a.id !== actionId) return a;
      found = true;
      return Object.assign({}, a, { zone: zone });
    });
    if (!found) throw new Error('未知动作：' + actionId);
    return Object.assign({}, contract, { actions: actions });
  }

  /** 相邻分区：dir = -1 往自主区方向，+1 往禁止区方向；到头不动。 */
  function shiftZone(zone, dir) {
    var idx = ZONES.findIndex(function (z) { return z.id === zone; });
    if (idx < 0) return 'ask';
    var next = Math.min(ZONES.length - 1, Math.max(0, idx + dir));
    return ZONES[next].id;
  }

  /** 自定义动作默认进必问区（未明确授权前先问）。重名拒绝。 */
  function addCustomAction(contract, label, high) {
    var name = str(label, 40);
    if (!name) throw new Error('动作名称不能为空');
    var dup = contract.actions.some(function (a) { return a.label === name; });
    if (dup) throw new Error('已有同名动作：' + name);
    var action = { id: uid('a'), label: name, high: !!high, readOnly: false, custom: true, zone: 'ask' };
    return Object.assign({}, contract, { actions: contract.actions.concat([action]) });
  }

  function removeAction(contract, actionId) {
    return Object.assign({}, contract, { actions: contract.actions.filter(function (a) { return !(a.id === actionId && a.custom); }) });
  }

  function byZone(contract) {
    var out = { auto: [], ask: [], deny: [] };
    contract.actions.forEach(function (a) { out[a.zone].push(a); });
    return out;
  }

  /** 高风险动作被放进自主区 → 逐项警示。 */
  function zoneWarnings(contract) {
    return contract.actions.filter(function (a) { return a.high && a.zone === 'auto'; }).map(function (a) {
      return { actionId: a.id, text: '「' + a.label + '」是高风险动作，却被放进自主区：笔记建议付款、发布、删除、对外发送等高影响或不可逆动作须人确认。' };
    });
  }

  var SEVERITY = { ok: 0, info: 1, warn: 2, conflict: 3 };

  /**
   * 信任级别 × 自主区高风险动作数 → 一致性检查。每条结果写明触发的规则编号与条件。
   * 返回 { status: 'ok'|'info'|'warn'|'conflict', autoHighCount, findings: [{ rule, severity, condition, text }] }
   */
  function checkConsistency(contract) {
    var z = byZone(contract);
    var autoHigh = z.auto.filter(function (a) { return a.high; });
    var autoWrite = z.auto.filter(function (a) { return !a.high && !a.readOnly; });
    var n = autoHigh.length;
    var names = function (list) { return list.map(function (a) { return a.label; }).join('、'); };
    var lv = contract.trustLevel;
    var findings = [];
    function add(rule, severity, condition, text) { findings.push({ rule: rule, severity: severity, condition: condition, text: text }); }

    if (lv === 1 && n > 0) add('R1', 'conflict', '级别＝只建议 且 自主区高风险动作 ≥ 1', '「只建议」级别下代理不该自行执行，自主区却放开了 ' + n + ' 项高风险动作（' + names(autoHigh) + '）。要么移回必问区，要么先升级信任级别。');
    if (lv === 1 && autoWrite.length > 0) add('R2', 'warn', '级别＝只建议 且 自主区含非只读动作', '「只建议」级别的自主区应只放只读动作，现有 ' + names(autoWrite) + ' 会改变状态。');
    if (lv === 2 && n > 0) add('R3', 'conflict', '级别＝确认后执行 且 自主区高风险动作 ≥ 1', '「确认后执行」要求有后果的动作先确认，但 ' + names(autoHigh) + ' 被设为不经确认直接做。');
    if (lv === 3 && n === 1) add('R4', 'warn', '级别＝授权范围内自主 且 自主区高风险动作 ＝ 1', '即便级别最高，笔记仍建议人确认付款、发布、删除、对外发送等动作。请确认「' + autoHigh[0].label + '」确实要免确认，并写清限额与撤回办法。');
    if (lv === 3 && n >= 2) add('R5', 'conflict', '级别＝授权范围内自主 且 自主区高风险动作 ≥ 2', '一次放开 ' + n + ' 项高风险动作（' + names(autoHigh) + '）。信任应逐步扩大，每次只扩一项。');
    if (z.ask.length === 0) add('R6', 'warn', '必问区为空', '必问区没有任何动作：代理遇到越界或卡住时没有「先停下来问」的出口。');
    if (lv === 3 && z.auto.length === 0) add('R7', 'info', '级别＝授权范围内自主 且 自主区为空', '选了「授权范围内自主」，但自主区为空，实际等同确认后执行。');

    var status = 'ok';
    findings.forEach(function (f) { if (SEVERITY[f.severity] > SEVERITY[status]) status = f.severity; });
    return { status: status, autoHighCount: n, findings: findings };
  }

  var REQUIRED = [
    { key: 'taskName', label: '任务名' },
    { key: 'goal', label: '目标结果' },
    { key: 'inputs', label: '输入材料' },
    { key: 'criteria', label: '至少一条完成标准' },
    { key: 'deadline', label: '截止条件' },
    { key: 'stuckProtocol', label: '卡住时怎么问我' }
  ];
  /** 超出字数上限的字段：[{ key, label, max, length }]。 */
  function lengthErrors(contract) {
    var out = [];
    var c = contract || {};
    Object.keys(FIELD_LABELS).forEach(function (k) {
      var n = text(c[k]).length;
      if (n > LIMITS[k]) out.push({ key: k, label: FIELD_LABELS[k], max: LIMITS[k], length: n });
    });
    (c.criteria || []).forEach(function (x, i) {
      var n = text(x).length;
      if (n > LIMITS.criterion) out.push({ key: 'criteria.' + i, label: '完成标准第 ' + (i + 1) + ' 条', max: LIMITS.criterion, length: n });
    });
    return out;
  }
  function validateContract(contract) {
    var missing = [];
    REQUIRED.forEach(function (r) {
      if (r.key === 'criteria') { if (!cleanCriteria(contract).length) missing.push(r.label); }
      else if (!text(contract[r.key])) missing.push(r.label);
    });
    var tooLong = lengthErrors(contract);
    return { ok: missing.length === 0 && tooLong.length === 0, missing: missing, tooLong: tooLong };
  }
  function cleanCriteria(contract) { return (contract.criteria || []).map(function (x) { return text(x); }).filter(Boolean); }

  /**
   * 用户文本 → 安全的 Markdown 行内文本：反斜杠转义 CommonMark 中有结构含义的 ASCII 标点，
   * 行首的列表 / 分隔线 / setext 标记与有序列表序号也一并转义。结果无法开启标题、引用、列表、代码块、链接或原始 HTML。
   */
  function mdEscape(s) {
    var t = String(s).replace(/[\\`*_\[\]<>#|~&]/g, '\\$&');
    return t.replace(/^([-=+])/, '\\$1').replace(/^(\d+)([.)])/, '$1\\$2');
  }
  function mdLine(s) { return mdEscape(text(s).replace(/\s*\n\s*/g, ' ')); }
  function mdBlock(s, fallback) {
    var t = text(s);
    if (!t) return fallback;
    return t.split('\n').map(function (l) { return l.trim() ? mdEscape(l.trim()) : ''; }).join('\n');
  }

  /** 契约卡 → Markdown（可直接贴给 Agent 当任务说明）。 */
  function toMarkdown(contract, date) {
    var c = normalizeContract(contract);
    var t = trustOf(c.trustLevel);
    var z = byZone(c);
    var check = checkConsistency(c);
    var L = [];
    L.push('# 委托契约卡：' + (mdLine(c.taskName) || '（未命名任务）'));
    L.push('');
    L.push('> 任务类型：' + (mdLine(c.taskType) || '未分类') + ' ｜ 信任级别：L' + t.level + ' ' + t.name + ' ｜ 签发：' + (date || ''));
    L.push('');
    L.push('## 目标结果', '', mdBlock(c.goal, '（未填写）'), '');
    L.push('## 输入材料', '', mdBlock(c.inputs, '（未列出，只可使用下方权限允许读取的材料）'), '');
    L.push('## 完成标准（逐条验收，不临时放宽）', '');
    var crit = cleanCriteria(c);
    if (crit.length) crit.forEach(function (x) { L.push('- [ ] ' + mdLine(x)); }); else L.push('（未填写）');
    L.push('');
    L.push('## 截止条件', '', mdBlock(c.deadline, '（未填写）'), '');
    L.push('## 卡住时怎么问我', '', mdBlock(c.stuckProtocol, '（未填写）'), '');
    L.push('## 权限边界', '');
    ZONES.forEach(function (zone) {
      L.push('### ' + zone.name + '（' + zone.rule + '）');
      if (z[zone.id].length) z[zone.id].forEach(function (a) { L.push('- ' + mdLine(a.label) + (a.high ? '（高风险）' : '')); });
      else L.push('- （无）');
      L.push('');
    });
    L.push('## 信任级别', '', 'L' + t.level + ' ' + t.name + '：' + t.meaning, '');
    if (check.findings.length) {
      L.push('## 授权前一致性检查', '');
      check.findings.forEach(function (f) { L.push('- [' + f.rule + '] ' + f.text); });
      L.push('');
    }
    L.push('---', '越界先停、不自封完成：按上方完成标准提交证据，由我验收。');
    return L.join('\n') + '\n';
  }

  /** 读取并校验分钟数：非负有限数，空值视为 0；超大值报错。 */
  function parseMinutes(v, label) {
    if (v === '' || v == null) return 0;
    var n = typeof v === 'number' ? v : Number(String(v).trim());
    if (!isFinite(n)) throw new Error((label || '分钟数') + '不是有效数字');
    if (n < 0) throw new Error((label || '分钟数') + '不能为负');
    if (n > MAX_MINUTES) throw new Error((label || '分钟数') + '过大');
    return Math.round(n * 10) / 10;
  }

  function round1(n) { return Math.round(n * 10) / 10; }

  /**
   * 净省时计算（笔记图 F 公式）。返回 { minutes, surface, net, isLoss, steps, formula, recheck }。
   * steps 是瀑布每一步：kind = 'total'（从 0 起的柱）或 'delta'（浮动增减）。
   */
  function computeNetSaving(timing) {
    var t = timing || {};
    var m = {};
    TIMING_FIELDS.forEach(function (f) { m[f.key] = parseMinutes(t[f.key], f.label); });
    var surface = round1(m.baseline - m.humanExec);
    var deductions = round1(m.supervision + m.rework + m.authMaintenance + m.learning);
    var net = round1(surface - deductions);
    var running = m.baseline;
    var steps = [{ key: 'baseline', label: '手工基线', kind: 'total', delta: m.baseline, from: 0, to: m.baseline }];
    running = round1(running - m.humanExec);
    steps.push({ key: 'humanExec', label: '扣：人工执行', kind: 'delta', delta: -m.humanExec, from: m.baseline, to: running });
    steps.push({ key: 'surface', label: '表面省时', kind: 'total', delta: surface, from: 0, to: surface });
    ['supervision', 'rework', 'authMaintenance', 'learning'].forEach(function (k) {
      var f = TIMING_FIELDS.filter(function (x) { return x.key === k; })[0];
      var next = round1(running - m[k]);
      steps.push({ key: k, label: '扣：' + f.label, kind: 'delta', delta: -m[k], from: running, to: next });
      running = next;
    });
    steps.push({ key: 'net', label: '净省时', kind: 'total', delta: net, from: 0, to: net });
    var fmt = function (x) { return String(x); };
    var formula = '净省时 ＝ ' + fmt(surface) + ' − ' + fmt(m.supervision) + ' − ' + fmt(m.rework) + ' − ' + fmt(m.authMaintenance) + ' − ' + fmt(m.learning) + ' ＝ ' + fmt(net) + ' 分钟';
    var recheck = '复核：' + fmt(m.baseline) + ' −（人工执行 ' + fmt(m.humanExec) + ' ＋ 监督 ' + fmt(m.supervision) + ' ＋ 返工 ' + fmt(m.rework) + ' ＋ 授权 ' + fmt(m.authMaintenance) + ' ＋ 学习 ' + fmt(m.learning) + '）＝ ' + fmt(round1(m.baseline - m.humanExec - deductions));
    return { minutes: m, surface: surface, net: net, isLoss: net < 0, steps: steps, formula: formula, recheck: recheck };
  }

  /**
   * 横向瀑布布局（纯几何）：每步一行，x 轴为分钟。支持负值（零线左移）。
   * opts: { width, labelWidth, valueWidth, rowHeight, gap }
   */
  function waterfallLayout(steps, opts) {
    var o = Object.assign({ width: 640, labelWidth: 140, valueWidth: 64, rowHeight: 28, gap: 10 }, opts || {});
    var vals = [0];
    steps.forEach(function (s) { vals.push(s.from, s.to); });
    var min = Math.min.apply(null, vals);
    var max = Math.max.apply(null, vals);
    if (max === min) max = min + 1;
    var plotX = o.labelWidth;
    var plotW = Math.max(40, o.width - o.labelWidth - o.valueWidth);
    var scale = function (v) { return plotX + (v - min) / (max - min) * plotW; };
    var rows = steps.map(function (s, i) {
      var a = scale(Math.min(s.from, s.to));
      var b = scale(Math.max(s.from, s.to));
      return {
        key: s.key, label: s.label, kind: s.kind, delta: s.delta, to: s.to,
        y: i * (o.rowHeight + o.gap), h: o.rowHeight,
        x: a, w: Math.max(b - a, s.delta === 0 ? 0 : 1),
        endX: scale(s.to), negative: s.kind === 'total' ? s.to < 0 : s.delta < 0
      };
    });
    return { width: o.width, height: steps.length * (o.rowHeight + o.gap) - o.gap, zeroX: scale(0), plotX: plotX, plotW: plotW, min: min, max: max, rows: rows };
  }

  // ---------- 台账 ----------
  function makeRecord(contract, date) {
    return { id: uid('r'), contract: normalizeContract(contract), status: 'open', timing: null, qualified: null, createdAt: date || '', doneAt: '' };
  }

  function completeRecord(record, timing, qualified, date) {
    if (qualified !== true && qualified !== false) throw new Error('请先标记验收是否合格');
    var r = computeNetSaving(timing);
    if (r.minutes.baseline <= 0) throw new Error('手工基线必须大于 0');
    return Object.assign({}, record, { status: 'done', timing: r.minutes, net: r.net, qualified: qualified, doneAt: date || record.doneAt || '' });
  }

  function normalizeRecord(input) {
    if (!input || typeof input !== 'object') return null;
    var rec = { id: typeof input.id === 'string' && input.id ? input.id.slice(0, 64) : uid('r'), contract: normalizeContract(input.contract), status: input.status === 'done' ? 'done' : 'open', timing: null, qualified: null, createdAt: str(input.createdAt, 20), doneAt: str(input.doneAt, 20), sample: !!input.sample };
    if (rec.status === 'done') {
      try {
        var res = computeNetSaving(input.timing);
        if (res.minutes.baseline <= 0 || typeof input.qualified !== 'boolean') throw new Error('bad');
        rec.timing = res.minutes; rec.net = res.net; rec.qualified = input.qualified;
      } catch (e) { rec.status = 'open'; }
    }
    return rec;
  }

  var MIN_SAMPLES = 3;
  /** group.netSign（-1/0/1，由未舍入总额决定）优先；未提供时回落到 avgNet 的符号。 */
  function adviceFor(group) {
    var sign = typeof group.netSign === 'number' ? group.netSign : Math.sign(group.avgNet);
    if (group.count < MIN_SAMPLES) return { code: 'insufficient', text: '样本不足', rule: '同类已完成 < ' + MIN_SAMPLES + ' 次，先继续记录' };
    if (sign < 0) return { code: 'stop', text: '先别再委托这类', rule: '同类 ≥ ' + MIN_SAMPLES + ' 次且平均净省时为负' };
    if (group.qualifiedRate < 2 / 3) return { code: 'shrink', text: '收缩范围，先补验收标准', rule: '平均净省时 ≥ 0，但合格率 < 2/3' };
    if (sign === 0) return { code: 'flat', text: '持平，不值得扩大', rule: '平均净省时 ＝ 0' };
    return { code: 'expand', text: '可继续委托，一次只扩大一个维度', rule: '同类 ≥ ' + MIN_SAMPLES + ' 次、平均净省时为正、合格率 ≥ 2/3' };
  }

  function summarizeLedger(records) {
    var done = (records || []).filter(function (r) { return r && r.status === 'done'; });
    var totalNet = round1(done.reduce(function (s, r) { return s + r.net; }, 0));
    var lossCount = done.filter(function (r) { return r.net < 0; }).length;
    var qualifiedCount = done.filter(function (r) { return r.qualified; }).length;
    // Map：任务类型是用户文本（可能是 __proto__ / constructor），不能当普通对象的键
    var groups = new Map();
    done.forEach(function (r) {
      var type = r.contract.taskType || '未分类';
      if (!groups.has(type)) groups.set(type, { type: type, count: 0, totalTenths: 0, qualified: 0, losses: 0 });
      var g = groups.get(type);
      // 每条净省时已是 0.1 精度，按「十分之一分钟」整数累加，避免浮点误差影响正负判断
      g.count++; g.totalTenths += Math.round(r.net * 10); if (r.qualified) g.qualified++; if (r.net < 0) g.losses++;
    });
    var byType = Array.from(groups.values()).map(function (g) {
      g.totalNet = g.totalTenths / 10;
      g.netSign = Math.sign(g.totalTenths);
      g.avgNet = round1(g.totalTenths / 10 / g.count) || 0; // 仅用于展示；|| 0 去掉 -0
      delete g.totalTenths;
      g.qualifiedRate = g.qualified / g.count;
      g.advice = adviceFor(g);
      return g;
    }).sort(function (a, b) { return b.count - a.count || a.type.localeCompare(b.type, 'zh'); });
    return {
      doneCount: done.length,
      openCount: (records || []).filter(function (r) { return r && r.status === 'open'; }).length,
      totalNet: totalNet,
      lossCount: lossCount,
      lossRatio: done.length ? lossCount / done.length : 0,
      qualifiedRate: done.length ? qualifiedCount / done.length : 0,
      byType: byType
    };
  }

  function csvCell(v) {
    var s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s; // 防 CSV 公式注入，保留负数
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(records) {
    var head = ['签发日期', '完成日期', '任务名', '任务类型', '信任级别', '状态', '验收', '手工基线', 'AI流程人工执行', '监督', '返工', '授权维护', '学习', '表面省时', '净省时', '是否亏损', '合成示例'];
    var rows = [head];
    (records || []).forEach(function (r) {
      var t = trustOf(r.contract.trustLevel);
      var done = r.status === 'done';
      var m = done ? r.timing : {};
      rows.push([
        r.createdAt, r.doneAt, r.contract.taskName, r.contract.taskType, 'L' + t.level + ' ' + t.name,
        done ? '已完成' : '待回填', done ? (r.qualified ? '合格' : '不合格') : '',
        done ? m.baseline : '', done ? m.humanExec : '', done ? m.supervision : '', done ? m.rework : '', done ? m.authMaintenance : '', done ? m.learning : '',
        done ? round1(m.baseline - m.humanExec) : '', done ? r.net : '', done ? (r.net < 0 ? '是' : '否') : '', r.sample ? '是' : ''
      ]);
    });
    return '\uFEFF' + rows.map(function (row) { return row.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }

  var api = {
    LIMITS: LIMITS, lengthErrors: lengthErrors, mdEscape: mdEscape,
    ZONES: ZONES, TRUST_LEVELS: TRUST_LEVELS, DEFAULT_ACTIONS: DEFAULT_ACTIONS, TIMING_FIELDS: TIMING_FIELDS, MIN_SAMPLES: MIN_SAMPLES,
    createContract: createContract, normalizeContract: normalizeContract, moveAction: moveAction, shiftZone: shiftZone,
    addCustomAction: addCustomAction, removeAction: removeAction, byZone: byZone, zoneWarnings: zoneWarnings,
    checkConsistency: checkConsistency, validateContract: validateContract, cleanCriteria: cleanCriteria, toMarkdown: toMarkdown,
    trustOf: trustOf, zoneOf: zoneOf, parseMinutes: parseMinutes, computeNetSaving: computeNetSaving, waterfallLayout: waterfallLayout,
    makeRecord: makeRecord, completeRecord: completeRecord, normalizeRecord: normalizeRecord, summarizeLedger: summarizeLedger, adviceFor: adviceFor, toCSV: toCSV
  };
  globalThis.ContractCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
