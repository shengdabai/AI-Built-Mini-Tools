/* 时间出售三模式试算 · 纯逻辑(无 DOM)。金额四舍五入到分;百分比输入按 0-100 校验。 */
(function () {
  'use strict';

  var SPEC = {
    one: {
      target: { label: '目标月收入', kind: 'num' },
      hours: { label: '每月可售工时', kind: 'num' },
      vacancy: { label: '空置率', kind: 'pct' },
      commission: { label: '平台抽成', kind: 'pct' },
      hidden: { label: '隐性时间比例', kind: 'pct' },
      tax: { label: '税费', kind: 'pct' }
    },
    two: {
      buildHours: { label: '制作工时', kind: 'num' },
      price: { label: '单价', kind: 'num' },
      units: { label: '预计月销量', kind: 'num' },
      fee: { label: '平台费', kind: 'pct' },
      refund: { label: '退款率', kind: 'pct' },
      hourlyValue: { label: '制作时间的估值时薪', kind: 'num' }
    },
    three: {
      outsourceRate: { label: '外包时薪', kind: 'num' },
      yourRate: { label: '你的时薪', kind: 'num' },
      share: { label: '可外包比例', kind: 'pct' },
      fill: { label: '腾出时间的可售比例', kind: 'pct' },
      hours: { label: '涉及的月工时', kind: 'num' }
    }
  };

  function round2(x) {
    if (x === null || x === undefined || !isFinite(x)) return null;
    var r = Math.round((Math.abs(x) + 1e-9) * 100) / 100;
    return x < 0 ? -r : r;
  }
  function ceilInt(x) { return Math.ceil(x - 1e-9); }

  /* 空值视为 0(空情景不报错);非数字、负数、百分比超出 0-100 给出错误 */
  function parse(input, spec) {
    var src = (input && typeof input === 'object') ? input : {};
    var v = {};
    var errors = [];
    Object.keys(spec).forEach(function (k) {
      var raw = src[k];
      var n;
      if (raw === undefined || raw === null || raw === '') n = 0;
      else if (typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '')) n = Number(raw);
      else n = NaN;
      if (!isFinite(n)) { errors.push(spec[k].label + '不是有效数字'); n = 0; }
      else if (n < 0) { errors.push(spec[k].label + '不能为负数'); n = 0; }
      else if (spec[k].kind === 'pct' && n > 100) { errors.push(spec[k].label + '必须在 0 到 100 之间'); n = 0; }
      v[k] = n;
    });
    return { v: v, errors: errors };
  }

  function modeOne(input) {
    var p = parse(input, SPEC.one);
    var v = p.v;
    var out = { valid: p.errors.length === 0, errors: p.errors, feasible: false, reason: '',
      minHourly: null, billableHours: null, totalHours: null, effectiveHourly: null, grossBilling: null };
    if (!out.valid) { out.reason = p.errors[0]; return out; }
    var billable = v.hours * (1 - v.vacancy / 100);
    out.billableHours = round2(billable);
    out.totalHours = round2(billable * (1 + v.hidden / 100));
    if (v.hours <= 0) { out.reason = '每月可售工时为 0,无法反推时薪'; return out; }
    if (v.vacancy >= 100) { out.reason = '空置率 100% 时没有可收费工时'; return out; }
    if (v.commission >= 100) { out.reason = '平台抽成 100% 时到手为 0'; return out; }
    if (v.tax >= 100) { out.reason = '税费 100% 时到手为 0'; return out; }
    var hourly = v.target / billable / (1 - v.commission / 100) / (1 - v.tax / 100);
    out.feasible = true;
    out.minHourly = round2(hourly);
    out.grossBilling = round2(hourly * billable);
    var total = billable * (1 + v.hidden / 100);
    out.effectiveHourly = total > 0 ? round2(v.target / total) : null;
    return out;
  }

  /* 敏感性:从当前值起,每步加 step 个百分点(默认 10),共 steps 步,到 100 以下为止 */
  function sensitivity(input, field, steps, step) {
    if (!SPEC.one[field] || SPEC.one[field].kind !== 'pct') return [];
    var inc = step > 0 ? step : 10;
    var n = steps >= 0 ? Math.floor(steps) : 0;
    var base = Number((input && input[field]) || 0);
    var src = Object.assign({}, input);
    var rows = [];
    var first = null;
    var prev = null;
    for (var i = 0; i <= n; i++) {
      var val = base + i * inc;
      if (!(val < 100)) break;
      src[field] = val;
      var r = modeOne(src);
      if (!r.valid || !r.feasible) break;
      if (first === null) first = r.minHourly;
      rows.push({
        value: val,
        hourly: r.minHourly,
        delta: round2(r.minHourly - first),
        deltaPct: first > 0 ? round2((r.minHourly / first - 1) * 100) : 0,
        stepDelta: prev === null ? 0 : round2(r.minHourly - prev)
      });
      prev = r.minHourly;
    }
    return rows;
  }

  function modeTwo(input) {
    var spec = Object.assign({}, SPEC.two, { tax: { label: '税费', kind: 'pct' }, target: { label: '目标月收入', kind: 'num' } });
    var p = parse(input, spec);
    var v = p.v;
    var out = { valid: p.errors.length === 0, errors: p.errors, netPerUnit: null, monthlyIncome: null,
      breakEvenUnits: null, unitsForTarget: null, curve: [] };
    if (!out.valid) return out;
    var net = v.price * (1 - v.fee / 100) * (1 - v.refund / 100) * (1 - v.tax / 100);
    out.netPerUnit = round2(net);
    out.monthlyIncome = round2(v.units * net);
    if (net > 0) {
      if (v.buildHours > 0 && v.hourlyValue > 0) out.breakEvenUnits = ceilInt(v.buildHours * v.hourlyValue / net);
      else if (v.buildHours <= 0) out.breakEvenUnits = 0;
      if (v.target > 0) out.unitsForTarget = ceilInt(v.target / net);
    }
    var maxUnits = Math.max(Math.ceil(v.units * 2), Math.ceil((out.breakEvenUnits || 0) * 1.5), 10);
    var set = {};
    var list = [];
    function add(u) { u = Math.round(u); if (!set[u]) { set[u] = true; list.push(u); } }
    for (var k = 0; k <= 10; k++) add(maxUnits * k / 10);
    add(Math.round(v.units));
    if (out.breakEvenUnits) add(out.breakEvenUnits);
    list.sort(function (a, b) { return a - b; });
    out.curve = list.map(function (u) {
      return { units: u, hourly: v.buildHours > 0 ? round2(u * net / v.buildHours) : null };
    });
    return out;
  }

  function modeThree(input) {
    var p = parse(input, SPEC.three);
    var v = p.v;
    var out = { valid: p.errors.length === 0, errors: p.errors, freedHours: null, soldHours: null, gain: null, cost: null,
      net: null, breakEvenRate: null, worthIt: false };
    if (!out.valid) return out;
    var freed = v.hours * v.share / 100;
    var sold = freed * v.fill / 100;
    out.freedHours = round2(freed);
    out.soldHours = round2(sold);
    out.gain = round2(sold * v.yourRate);
    out.cost = round2(freed * v.outsourceRate);
    out.net = round2(sold * v.yourRate - freed * v.outsourceRate);
    out.breakEvenRate = v.fill > 0 ? round2(v.outsourceRate / (v.fill / 100)) : null;
    out.worthIt = out.net > 0;
    return out;
  }

  /* 模式三的工时 = 总工时 − 腾出工时 + 再次出售腾出时间所需的工时 */
  var MODE_LABELS = { one: '卖一次', two: '卖很多次', three: '买别人的时间' };

  function evaluate(sc) {
    var s = sc || {};
    var one = s.one || {};
    var r1 = modeOne(one);
    var twoIn = Object.assign({}, s.two || {});
    twoIn.tax = one.tax;
    twoIn.target = one.target;
    if (!(Number(twoIn.hourlyValue) > 0)) twoIn.hourlyValue = r1.feasible ? r1.minHourly : 0;
    var r2 = modeTwo(twoIn);
    var threeIn = Object.assign({}, s.three || {});
    if (!(Number(threeIn.hours) > 0)) threeIn.hours = r1.totalHours || 0;
    var r3 = modeThree(threeIn);
    /* 外包涉及工时不能超过模式一的总工时,否则会产生负工时 */
    if (r3.valid && r1.feasible && Number((s.three || {}).hours) > r1.totalHours) {
      r3 = { valid: false, errors: ['外包涉及的月工时(' + Number(s.three.hours) + ')不能超过模式一的总工时(' + r1.totalHours + ')'],
        freedHours: null, soldHours: null, gain: null, cost: null, net: null, breakEvenRate: null, worthIt: false };
    }
    var buildHours = Number(twoIn.buildHours) || 0;
    var baseIncome = Number(one.target) || 0;
    var modes = [
      { mode: 'one', label: MODE_LABELS.one, income: r1.feasible ? round2(baseIncome) : null,
        hours: r1.totalHours, hourly: r1.effectiveHourly },
      { mode: 'two', label: MODE_LABELS.two, income: r2.valid ? r2.monthlyIncome : null,
        hours: buildHours, hourly: r2.valid && buildHours > 0 ? round2(r2.monthlyIncome / buildHours) : null },
      { mode: 'three', label: MODE_LABELS.three, income: r3.valid && r1.feasible ? round2(baseIncome + r3.net) : null,
        hours: r3.valid && r1.feasible ? round2(r1.totalHours - r3.freedHours + r3.soldHours) : null, hourly: null }
    ];
    var m3 = modes[2];
    if (m3.income !== null && m3.hours > 0) m3.hourly = round2(m3.income / m3.hours);
    var best = null;
    modes.forEach(function (m) { if (m.hourly !== null && (best === null || m.hourly > best.hourly)) best = m; });
    var ranked = modes.filter(function (m) { return m.hourly !== null; })
      .sort(function (a, b) { return b.hourly - a.hourly; });
    modes.forEach(function (m) { var i = ranked.indexOf(m); m.rank = i < 0 ? null : i + 1; });
    return { name: String(s.name || ''), modes: modes, best: best ? best.mode : null,
      bestHourly: best ? best.hourly : null, r1: r1, r2: r2, r3: r3 };
  }


  /* 模式二的口径说明:单份到手公式、实际使用的税费(继承自现状)、回本销量公式 */
  function explainTwo(sc) {
    var s = sc || {};
    var one = s.one || {};
    var two = s.two || {};
    var r1 = modeOne(one);
    var price = Number(two.price) || 0;
    var fee = Number(two.fee) || 0;
    var refund = Number(two.refund) || 0;
    var tax = Number(one.tax) || 0;
    var build = Number(two.buildHours) || 0;
    var hv = Number(two.hourlyValue) > 0 ? Number(two.hourlyValue) : (r1.feasible ? r1.minHourly : 0);
    var net = price * (1 - fee / 100) * (1 - refund / 100) * (1 - tax / 100);
    var out = { taxPct: tax, taxInherited: true, hourlyValueUsed: hv,
      hourlyValueSource: Number(two.hourlyValue) > 0 ? 'input' : 'mode-one',
      netFormula: price + ' × (1−' + fee + '%) × (1−' + refund + '%) × (1−' + tax + '%) = ' + num(round2(net)),
      breakEvenFormula: null, breakEvenReason: '' };
    if (!(net > 0)) out.breakEvenReason = '单份到手为 0,算不出回本销量';
    else if (build <= 0) out.breakEvenReason = '制作工时为 0,回本销量按 0 份计';
    else if (!(hv > 0)) out.breakEvenReason = '没有估值时薪(模式一也无法反推时薪),算不出回本销量';
    else out.breakEvenFormula = build + ' × ' + num(hv) + ' ÷ ' + num(round2(net)) + ',向上取整';
    return out;
  }

  /* 导入确认前的预览文字:当前与备份文件各有多少情景 */
  function importSummary(current, incoming) {
    var a = current && Array.isArray(current.scenarios) ? current.scenarios.length : 0;
    var b = incoming && Array.isArray(incoming.scenarios) ? incoming.scenarios.length : 0;
    return { currentScenarios: a, incomingScenarios: b,
      text: '当前 ' + a + ' 个情景(连同编辑区的输入)将被替换为备份文件 ' + b + ' 个情景。' };
  }

  /* 情景并列:情景按其最高等效时薪降序(无法计算的排最后,同分保持输入顺序);模式固定顺序,rank 为该情景内排名 */
  function compare(scenarios) {
    var list = Array.isArray(scenarios) ? scenarios : [];
    var entries = list.map(function (s, i) { var e = evaluate(s); e.index = i; return e; });
    entries.sort(function (a, b) {
      var ha = a.bestHourly === null ? -Infinity : a.bestHourly;
      var hb = b.bestHourly === null ? -Infinity : b.bestHourly;
      if (hb !== ha) return hb > ha ? 1 : -1;
      return a.index - b.index;
    });
    var maxIncome = 0;
    entries.forEach(function (e) { e.modes.forEach(function (m) { if (m.income !== null && m.income > maxIncome) maxIncome = m.income; }); });
    return { entries: entries, maxIncome: maxIncome };
  }

  /* 公式注入防护:以 = + - @ 开头(单独的 + 或 - 除外)、或以制表/回车开头的字段加单引号前缀 */
  function guard(value) {
    var s = String(value === null || value === undefined ? '' : value);
    if (s === '-' || s === '+') return s;
    if (/^[=+\-@\t\r]/.test(s)) return "'" + s;
    return s;
  }
  function num(n, d) { return n === null || n === undefined ? '-' : Number(n).toFixed(d === undefined ? 2 : d); }
  function csvCell(s) {
    var t = guard(s);
    return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }
  function mdCell(s) { return guard(s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' '); }

  function toCsv(cmp) {
    var rows = [['情景', '模式', '月收入', '工时', '等效时薪', '情景内排名'].map(csvCell).join(',')];
    ((cmp && cmp.entries) || []).forEach(function (e) {
      e.modes.forEach(function (m) {
        rows.push([e.name || '未命名情景', m.label, num(m.income), num(m.hours), num(m.hourly), m.rank === null ? '-' : m.rank]
          .map(csvCell).join(','));
      });
    });
    return rows.join('\n') + '\n';
  }

  function toMarkdown(cmp) {
    var lines = ['# 时间出售三模式试算', '',
      '| 情景 | 模式 | 月收入 | 工时 | 等效时薪 | 情景内排名 |', '| --- | --- | ---: | ---: | ---: | ---: |'];
    var entries = (cmp && cmp.entries) || [];
    entries.forEach(function (e) {
      e.modes.forEach(function (m) {
        lines.push('| ' + [mdCell(e.name || '未命名情景'), m.label, num(m.income), num(m.hours), num(m.hourly), m.rank === null ? '-' : m.rank].join(' | ') + ' |');
      });
    });
    if (!entries.length) lines.push('| (没有已保存的情景) | | | | | |');
    lines.push('', '口径:模式一的工时含隐性时间,月收入为到手目标;模式二的工时是一次性制作工时,等效时薪为首月净收入除以制作工时;模式三的工时为自己亲手做的工时,月收入为目标加净增。所有数字是用户假设下的算术结果,不是市场预测。', '');
    return lines.join('\n');
  }

  /* 导入校验:任何一处不合法就整份拒绝,返回原因,不做静默修正 */
  function checkGroup(obj, spec, where, errors) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { errors.push(where + ' 缺失或不是对象'); return; }
    Object.keys(spec).forEach(function (k) {
      var x = obj[k];
      if (typeof x !== 'number' || !isFinite(x)) errors.push(where + '.' + k + ' 不是数字');
      else if (x < 0) errors.push(where + '.' + k + ' 为负数');
      else if (spec[k].kind === 'pct' && x > 100) errors.push(where + '.' + k + ' 超出 0-100');
    });
  }
  function validateImport(input) {
    var data = input;
    if (typeof input === 'string') {
      try { data = JSON.parse(input); } catch (e) { return { ok: false, error: '不是有效的 JSON 文件' }; }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: '顶层必须是对象' };
    if (data.version !== 1) return { ok: false, error: '不支持的备份版本(需要 version = 1)' };
    var errors = [];
    var cur = data.current;
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return { ok: false, error: 'current 缺失或不是对象' };
    if (typeof cur.name !== 'string' || cur.name.length > 60) errors.push('current.name 必须是不超过 60 字的文本');
    ['one', 'two', 'three'].forEach(function (g) { checkGroup(cur[g], SPEC[g], 'current.' + g, errors); });
    if (!Array.isArray(data.scenarios)) errors.push('scenarios 必须是数组');
    else {
      if (data.scenarios.length > 3) errors.push('最多保存 3 个情景');
      var seen = new Set();
      data.scenarios.forEach(function (s, i) {
        var w = 'scenarios[' + i + ']';
        if (!s || typeof s !== 'object' || Array.isArray(s)) { errors.push(w + ' 不是对象'); return; }
        if (typeof s.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(s.id)) errors.push(w + '.id 不合法');
        else if (seen.has(s.id)) errors.push(w + '.id 重复:' + s.id);
        else seen.add(s.id);
        if (typeof s.name !== 'string' || s.name.length > 60) errors.push(w + '.name 必须是不超过 60 字的文本');
        ['one', 'two', 'three'].forEach(function (g) { checkGroup(s[g], SPEC[g], w + '.' + g, errors); });
      });
    }
    if (errors.length) return { ok: false, error: errors.slice(0, 5).join(';') + (errors.length > 5 ? ';等共 ' + errors.length + ' 处' : '') };
    return { ok: true, data: data };
  }

  function emptyState() {
    function blank(spec) { var o = {}; Object.keys(spec).forEach(function (k) { o[k] = 0; }); return o; }
    return { version: 1, current: { name: '', one: blank(SPEC.one), two: blank(SPEC.two), three: blank(SPEC.three) }, scenarios: [] };
  }

  var api = { SPEC: SPEC, MODE_LABELS: MODE_LABELS, round2: round2, modeOne: modeOne, sensitivity: sensitivity,
    modeTwo: modeTwo, modeThree: modeThree, evaluate: evaluate, compare: compare, toMarkdown: toMarkdown,
    toCsv: toCsv, explainTwo: explainTwo, importSummary: importSummary, validateImport: validateImport, guard: guard, emptyState: emptyState };
  globalThis.TimeCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
