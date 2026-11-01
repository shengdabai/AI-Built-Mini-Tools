'use strict';
/* 复利成长曲线模拟器 · 纯逻辑(无 DOM)。
   口径:倍数保留 6 位小数(四舍五入);比率类(周频等效)保留 12 位有效小数;
   r 以小数存储(0.01 = 1%)。 */
(function () {
  const APP = 'compound-curve';
  const VERSION = 1;
  const LIMITS = Object.freeze({
    rMin: 0, rMax: 0.03,
    daysMin: 30, daysMax: 3650,
    restMin: 0, restMax: 6,
    r7Max: 0.25,
    maxScenarios: 3,
    targetMax: 1e12
  });

  function round6(x) {
    const y = x * 1e6;
    if (!Number.isFinite(y)) return x;
    return Math.round(y) / 1e6;
  }
  function round12(x) { return Math.round(x * 1e12) / 1e12; }

  function isRest(day, restDays) {
    return restDays > 0 && ((day - 1) % 7) >= 7 - restDays;
  }

  function checkRest(n) {
    if (!Number.isInteger(n) || n < LIMITS.restMin || n > LIMITS.restMax) {
      throw new RangeError('restDaysPerWeek 必须是 0–6 的整数');
    }
  }
  function checkR(r) {
    if (typeof r !== 'number' || !Number.isFinite(r)) throw new TypeError('r 必须是有限数字');
  }

  function eventMap(events) {
    const m = new Map();
    for (const e of events || []) {
      m.set(e.day, (m.has(e.day) ? m.get(e.day) : 1) * e.factor);
    }
    return m;
  }

  /* frequency: 'daily'(默认,每天乘 1+r,休息日不增长)
                'weekly'(每满 7 天乘一次 1+r,忽略休息日) */
  function simulate(opts) {
    const o = opts || {};
    const r = o.r;
    const days = o.days;
    const rest = o.restDaysPerWeek == null ? 0 : o.restDaysPerWeek;
    const frequency = o.frequency || 'daily';
    checkR(r);
    if (!Number.isInteger(days) || days < 0) throw new RangeError('days 必须是非负整数');
    checkRest(rest);
    if (frequency !== 'daily' && frequency !== 'weekly') throw new RangeError('frequency 只能是 daily 或 weekly');
    const ev = eventMap(o.events);
    const g = 1 + r;
    let v = 1;
    const series = [{ day: 0, value: 1 }];
    for (let d = 1; d <= days; d++) {
      if (frequency === 'daily') {
        if (!isRest(d, rest)) v *= g;
      } else if (d % 7 === 0) {
        v *= g;
      }
      if (ev.has(d)) v *= ev.get(d);
      series.push({ day: d, value: round6(v) });
    }
    return { series, final: series[days].value };
  }

  /* 线性对照:每个增长日 +r(休息日不加),起点 1 */
  function linear(r, days, restDaysPerWeek) {
    const rest = restDaysPerWeek == null ? 0 : restDaysPerWeek;
    checkR(r);
    if (!Number.isInteger(days) || days < 0) throw new RangeError('days 必须是非负整数');
    checkRest(rest);
    let v = 1;
    const series = [{ day: 0, value: 1 }];
    for (let d = 1; d <= days; d++) {
      if (!isRest(d, rest)) v += r;
      series.push({ day: d, value: round6(v) });
    }
    return { series, final: series[days].value };
  }

  /* 前 d 天里的增长日数(休息日为每周最后 N 天)。 */
  function activeDays(d, rest) {
    const per = 7 - rest;
    return Math.floor(d / 7) * per + Math.min(d % 7, per);
  }
  /* 第 n 个增长日是第几天(n ≥ 1)。 */
  function dayOfActive(n, rest) {
    const per = 7 - rest;
    return Math.floor((n - 1) / per) * 7 + ((n - 1) % per) + 1;
  }

  /* 第一天达到 target 倍的天数;永远达不到返回 null。
     最后一个事件日之前逐日模拟;之后用对数公式一次求出还需要的增长日数,
     不设天数上限(r 极小时天数很大但仍是有限数)。 */
  function daysToReach(r, target, restDaysPerWeek, events) {
    const rest = restDaysPerWeek == null ? 0 : restDaysPerWeek;
    checkR(r);
    checkRest(rest);
    if (typeof target !== 'number' || !Number.isFinite(target) || target <= 0) {
      throw new RangeError('target 必须是正数');
    }
    if (target <= 1) return 0;
    const ev = eventMap(events);
    const g = 1 + r;
    let last = 0;
    for (const d of ev.keys()) if (d > last) last = d;
    let v = 1;
    for (let d = 1; d <= last; d++) {
      if (!isRest(d, rest)) v *= g;
      if (ev.has(d)) v *= ev.get(d);
      if (v >= target * (1 - 1e-12)) return d;
    }
    if (!(r > 0) || rest >= 7 || !(v > 0)) return null;
    const need = Math.ceil(Math.log(target / v) / Math.log1p(r) - 1e-9);
    const day = dayOfActive(activeDays(last, rest) + Math.max(need, 1), rest);
    return Number.isSafeInteger(day) ? day : null;
  }

  /* 日频 r 的每周等效增长:(1+r)^7 - 1 */
  function weeklyEquivalent(r) {
    checkR(r);
    return round12(Math.expm1(7 * Math.log1p(r)));
  }
  /* 周频 r7 的每日等效:(1+r7)^(1/7) - 1 */
  function dailyEquivalent(r7) {
    checkR(r7);
    return round12(Math.expm1(Math.log1p(r7) / 7));
  }

  /* 并排比较:在同一 T(默认取各情景 days 的最小值)比较倍数与达到 2× 的天数。
     rows 按 T 天后的倍数从大到小排序(并列保持输入顺序)。 */
  function compare(scenarios, T) {
    if (!Array.isArray(scenarios) || scenarios.length === 0) throw new RangeError('至少需要一个情景');
    const t = T == null ? Math.min.apply(null, scenarios.map(s => s.days)) : T;
    const rows = scenarios.map((s, i) => {
      const sim = simulate({ r: s.r, days: t, restDaysPerWeek: s.restDaysPerWeek, events: s.events });
      return {
        id: s.id, name: s.name, index: i,
        value: sim.final,
        daysTo2: daysToReach(s.r, 2, s.restDaysPerWeek, s.events)
      };
    });
    rows.sort((a, b) => b.value - a.value || a.index - b.index);
    const best = rows[0].value;
    const reached = rows.filter(x => x.daysTo2 != null).map(x => x.daysTo2);
    const fastest = reached.length ? Math.min.apply(null, reached) : null;
    rows.forEach((x, i) => {
      x.rank = i + 1;
      x.diffToBest = round6(x.value - best);
      x.daysTo2Diff = (x.daysTo2 != null && fastest != null) ? x.daysTo2 - fastest : null;
    });
    return { T: t, rows };
  }

  /* CSV 文本字段:公式防护 + 引号转义。单独的 "-" / "+" 不算公式。 */
  function csvText(v) {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s) && !(s.length === 1 && (s === '-' || s === '+'))) s = "'" + s;
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /* 当前情景参数 + 365 点序列(第 1–365 天)。 */
  function toCsv(scenario) {
    const s = scenario;
    const sim = simulate({ r: s.r, days: 365, restDaysPerWeek: s.restDaysPerWeek, events: s.events });
    const lin = linear(s.r, 365, s.restDaysPerWeek);
    const evText = (s.events || []).map(e => e.day + ':' + e.factor).join(';');
    const lines = [
      ['情景', csvText(s.name)],
      ['日成长率 r', s.r],
      ['时长 T(天)', s.days],
      ['每周休息天数', s.restDaysPerWeek],
      ['倍率事件(第几天:乘数)', csvText(evText)],
      ['说明', csvText('这是数学演示,不是预测;序列固定输出第 1–365 天,不覆盖完整时长 T,365 天之后的倍率事件不会进入这份序列')],
      [],
      ['天', '情景倍数', '线性对照倍数']
    ].map(a => a.join(','));
    for (let d = 1; d <= 365; d++) {
      lines.push([d, sim.series[d].value, lin.series[d].value].join(','));
    }
    return lines.join('\n') + '\n';
  }

  function formatMultiple(x) {
    if (x == null || !Number.isFinite(x)) return '—';
    const a = Math.abs(x);
    if (a >= 1e6) return x.toExponential(2).replace('e+', '×10^');
    if (a >= 1000) return x.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (a >= 100) return x.toFixed(1);
    return x.toFixed(2);
  }
  function formatPercent(r) {
    return String(Number((r * 100).toFixed(4)));
  }

  function isPlain(o) { return o !== null && typeof o === 'object' && !Array.isArray(o); }
  function isNum(x) { return typeof x === 'number' && Number.isFinite(x); }

  /* 校验导入文件 / 本地存储的整份状态。不修正、不跳过:任何一处不合法就整份拒绝。 */
  function validateImport(obj) {
    const errors = [];
    if (!isPlain(obj)) return { ok: false, errors: ['文件内容不是一个 JSON 对象'] };
    if (obj.app !== APP) errors.push('app 字段必须是 "' + APP + '"');
    if (obj.version !== VERSION) errors.push('version 必须是 ' + VERSION);
    if (!Array.isArray(obj.scenarios) || obj.scenarios.length < 1 || obj.scenarios.length > LIMITS.maxScenarios) {
      errors.push('scenarios 必须是 1–' + LIMITS.maxScenarios + ' 个情景组成的数组');
    }
    const scenarios = [];
    const ids = new Set();
    if (Array.isArray(obj.scenarios) && obj.scenarios.length <= LIMITS.maxScenarios) {
      obj.scenarios.forEach((s, i) => {
        const tag = '情景 ' + (i + 1) + ':';
        const errCount = errors.length;
        if (!isPlain(s)) { errors.push(tag + '不是对象'); return; }
        if (typeof s.id !== 'string' || s.id === '') errors.push(tag + 'id 必须是非空字符串');
        else if (ids.has(s.id)) errors.push(tag + 'id "' + s.id + '" 重复');
        else ids.add(s.id);
        if (typeof s.name !== 'string') errors.push(tag + 'name 必须是字符串');
        if (!isNum(s.r) || s.r < LIMITS.rMin || s.r > LIMITS.rMax + 1e-12) errors.push(tag + '日成长率 r 必须在 0–0.03(0%–3%)');
        if (!Number.isInteger(s.days) || s.days < LIMITS.daysMin || s.days > LIMITS.daysMax) errors.push(tag + '时长 days 必须是 ' + LIMITS.daysMin + '–' + LIMITS.daysMax + ' 的整数');
        if (!Number.isInteger(s.restDaysPerWeek) || s.restDaysPerWeek < LIMITS.restMin || s.restDaysPerWeek > LIMITS.restMax) errors.push(tag + 'restDaysPerWeek 必须是 0–6 的整数');
        const evs = [];
        if (!Array.isArray(s.events)) errors.push(tag + 'events 必须是数组');
        else s.events.forEach((e, j) => {
          const et = tag + '事件 ' + (j + 1) + ' ';
          if (!isPlain(e)) { errors.push(et + '不是对象'); return; }
          if (!Number.isInteger(e.day) || e.day < 1 || (Number.isInteger(s.days) && e.day > s.days)) errors.push(et + '的 day 必须是 1 到 T 之间的整数(事件日不能超过时长)');
          if (!isNum(e.factor) || e.factor <= 0) errors.push(et + '的 factor 必须是大于 0 的数');
          evs.push({ day: e.day, factor: e.factor });
        });
        if (errors.length === errCount && Number.isFinite(s.r)) {
          try {
            const sim = simulate({ r: s.r, days: s.days, restDaysPerWeek: s.restDaysPerWeek, events: evs });
            if (!sim.series.every(p => Number.isFinite(p.value))) errors.push(tag + '倍数溢出(结果超出可计算范围),请降低 r、T 或事件乘数');
            else if (sim.series.some(p => p.value === 0) ) errors.push(tag + '倍数溢出(结果下溢为 0),请提高事件乘数');
          } catch (e) { errors.push(tag + '无法计算:' + e.message); }
        }
        scenarios.push({ id: s.id, name: s.name, r: s.r, days: s.days, restDaysPerWeek: s.restDaysPerWeek, events: evs });
      });
    }
    if (typeof obj.activeId !== 'string' || !ids.has(obj.activeId)) errors.push('activeId 必须是某个情景的 id');
    if (!isNum(obj.target) || obj.target <= 0 || obj.target > LIMITS.targetMax) errors.push('target(目标倍数)必须是 0 到 ' + LIMITS.targetMax + ' 之间的正数');
    if (obj.yScale !== 'log' && obj.yScale !== 'linear') errors.push('yScale 只能是 "log" 或 "linear"');
    const w = obj.weekly;
    if (!isPlain(w) || typeof w.show !== 'boolean' || !isNum(w.r7) || w.r7 < 0 || w.r7 > LIMITS.r7Max) {
      errors.push('weekly 必须是 {show:布尔, r7:0–' + LIMITS.r7Max + '}');
    }
    if (obj.sample !== undefined && typeof obj.sample !== 'boolean') errors.push('sample 必须是布尔值');
    if (errors.length) return { ok: false, errors };
    return {
      ok: true,
      value: {
        app: APP, version: VERSION, scenarios,
        activeId: obj.activeId, target: obj.target, yScale: obj.yScale,
        weekly: { show: w.show, r7: w.r7 },
        sample: obj.sample === true
      }
    };
  }

  function newScenario(id, name) {
    return { id, name, r: 0.01, days: 365, restDaysPerWeek: 0, events: [] };
  }
  function defaultState() {
    return {
      app: APP, version: VERSION,
      scenarios: [newScenario('s1', '情景 1')],
      activeId: 's1', target: 10, yScale: 'log',
      weekly: { show: false, r7: 0.01 },
      sample: false
    };
  }
  function nextId(scenarios) {
    let n = 0;
    for (const s of scenarios) {
      const m = /^s(\d+)$/.exec(s.id);
      if (m) n = Math.max(n, Number(m[1]));
    }
    return 's' + (n + 1);
  }

  const api = {
    LIMITS, simulate, linear, daysToReach, weeklyEquivalent, dailyEquivalent,
    compare, toCsv, csvText, validateImport, defaultState, newScenario, nextId,
    formatMultiple, formatPercent, round6
  };
  globalThis.CompoundCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
