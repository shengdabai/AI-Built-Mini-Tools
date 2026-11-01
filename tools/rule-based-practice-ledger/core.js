'use strict';
/* 定投复利践行账本 · 纯逻辑(无 DOM)。
   日期一律是 'YYYY-MM-DD' 字符串;内部转成"自 1970-01-01 起的天数"做运算。
   规则 rule:{kind:'daily'} | {kind:'weekly', n:1..7} | {kind:'monthly', day:1..31}。
   周从周一开始。 */

const DAY_MS = 86400000;
const TYPES = ['amount', 'count', 'quantity'];
const KINDS = ['daily', 'weekly', 'monthly'];
const TYPE_LABEL = { amount: '金额型', count: '次数型', quantity: '数量型' };
const MAX_EXEC = 5000;
const FORMAT_ID = 'dca-ledger';
const FORMAT_VERSION = 1;

/* ---------- 日期 ---------- */
function dayOf(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const t = Date.UTC(y, m - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return t / DAY_MS;
}
function pad(n, w) { return String(n).padStart(w, '0'); }
function fromDay(n) {
  const dt = new Date(n * DAY_MS);
  return pad(dt.getUTCFullYear(), 4) + '-' + pad(dt.getUTCMonth() + 1, 2) + '-' + pad(dt.getUTCDate(), 2);
}
function isValidDate(s) { return dayOf(s) !== null; }
function addDays(s, n) { const d = dayOf(s); return d === null ? null : fromDay(d + n); }
function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
/* 周一 = 0 … 周日 = 6(1970-01-01 是周四) */
function weekdayIdx(day) { return (((day + 3) % 7) + 7) % 7; }
function mondayOf(day) { return day - weekdayIdx(day); }
function resolveToday(search, fallback) {
  try {
    const v = new URLSearchParams(String(search || '')).get('today');
    if (v && isValidDate(v)) return v;
  } catch (e) { /* 回退 */ }
  return fallback;
}
function monthBounds(month) {
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) return null;
  const y = +month.slice(0, 4), m = +month.slice(5, 7);
  if (y < 2000 || y > 2100 || m < 1 || m > 12) return null;
  const first = dayOf(month + '-01');
  return { first, last: first + daysInMonth(y, m) - 1, y, m };
}

/* ---------- 规则 ---------- */
function ruleText(rule) {
  if (!rule) return '';
  if (rule.kind === 'daily') return '每天';
  if (rule.kind === 'weekly') return '每周 ' + rule.n + ' 次';
  if (rule.kind === 'monthly') return '每月 ' + rule.day + ' 日';
  return '';
}
function periodsPerYear(rule) {
  return rule && rule.kind === 'weekly' ? 52 * rule.n : rule && rule.kind === 'monthly' ? 12 : 365;
}
/* 一个「期」(天/周/月)内的执行次数:每周 N 次 = N,其余 1。 */
function executionsPerPeriod(rule) { return rule && rule.kind === 'weekly' ? rule.n : 1; }
function streakUnit(rule) {
  return rule && rule.kind === 'weekly' ? '周' : rule && rule.kind === 'monthly' ? '个月' : '天';
}
function recordMap(records) {
  const m = new Map();
  for (const r of records || []) {
    const d = dayOf(r && r.date);
    if (d !== null) m.set(d, r.value);
  }
  return m;
}
function effectiveEnd(today, ended) {
  const t = dayOf(today);
  if (t === null) return null;
  const e = ended ? dayOf(ended) : null;
  return e !== null ? Math.min(t, e) : t;
}
function monthSched(y, m, rule) { return dayOf(y + '-' + pad(m, 2) + '-' + pad(Math.min(rule.day, daysInMonth(y, m)), 2)); }

/* 应执行次数(累计到 today;结束践行后停在结束日)。
   每周 N 次:一周内可用天数不足 N 时按可用天数封顶;本周内只计"若要完成配额现在必须已做"的部分,
   所以周一不会立刻出现"欠账"。 */
function expectedCount(rule, start, today, ended) {
  const s = dayOf(start);
  const E = effectiveEnd(today, ended);
  if (s === null || E === null || !rule || E < s) return 0;
  if (rule.kind === 'daily') return E - s + 1;
  if (rule.kind === 'weekly') {
    const e = ended ? dayOf(ended) : null;
    let total = 0;
    for (let mon = mondayOf(s); mon <= E; mon += 7) {
      const availStart = Math.max(s, mon);
      const availEnd = e !== null ? Math.min(mon + 6, e) : mon + 6;
      const avail = availEnd - availStart + 1;
      if (avail <= 0) continue;
      const quota = Math.min(rule.n, avail);
      const remaining = Math.max(0, availEnd - Math.max(E, availStart - 1));
      total += quota - Math.min(quota, remaining);
    }
    return total;
  }
  if (rule.kind === 'monthly') {
    const e = ended ? dayOf(ended) : null;
    const sd = new Date(s * DAY_MS), ed = new Date(E * DAY_MS);
    let y = sd.getUTCFullYear(), m = sd.getUTCMonth() + 1, total = 0;
    const endKey = ed.getUTCFullYear() * 12 + ed.getUTCMonth();
    while (y * 12 + (m - 1) <= endKey) {
      const sched = monthSched(y, m, rule);
      if (sched >= s && sched <= E && (e === null || sched <= e)) total++;
      m++; if (m > 12) { m = 1; y++; }
    }
    return total;
  }
  return 0;
}

/* 逐期状态:daily 每天一期,weekly 每周一期,monthly 每月一期。
   status: done / missed(未执行)/ pending(进行中,尚未算缺勤)。 */
function periods(records, rule, start, today, ended) {
  const s = dayOf(start), t = dayOf(today), E = effectiveEnd(today, ended);
  if (s === null || t === null || E === null || !rule || E < s) return [];
  const e = ended ? dayOf(ended) : null;
  const rec = recordMap(records);
  const countIn = (from, to) => { let c = 0; for (const d of rec.keys()) if (d >= from && d <= to) c++; return c; };
  const out = [];
  if (rule.kind === 'daily') {
    for (let d = s; d <= E; d++) {
      const done = rec.has(d) ? 1 : 0;
      out.push({ key: fromDay(d), from: fromDay(d), to: fromDay(d), quota: 1, done, due: true,
        status: done ? 'done' : d < t ? 'missed' : 'pending' });
    }
  } else if (rule.kind === 'weekly') {
    for (let mon = mondayOf(s); mon <= E; mon += 7) {
      const availStart = Math.max(s, mon);
      const availEnd = e !== null ? Math.min(mon + 6, e) : mon + 6;
      const avail = availEnd - availStart + 1;
      if (avail <= 0) continue;
      const quota = Math.min(rule.n, avail);
      const done = countIn(availStart, availEnd);
      out.push({ key: fromDay(mon), from: fromDay(availStart), to: fromDay(availEnd), quota, done, due: true,
        status: done >= quota ? 'done' : availEnd < t ? 'missed' : 'pending' });
    }
  } else if (rule.kind === 'monthly') {
    const sd = new Date(s * DAY_MS), ed = new Date(E * DAY_MS);
    let y = sd.getUTCFullYear(), m = sd.getUTCMonth() + 1;
    const endKey = ed.getUTCFullYear() * 12 + ed.getUTCMonth();
    while (y * 12 + (m - 1) <= endKey) {
      const sched = monthSched(y, m, rule);
      if (sched >= s && (e === null || sched <= e)) {
        const mb = monthBounds(y + '-' + pad(m, 2));
        const done = countIn(Math.max(mb.first, s), mb.last) > 0 ? 1 : 0;
        out.push({ key: y + '-' + pad(m, 2), from: fromDay(mb.first), to: fromDay(mb.last), quota: 1, done,
          due: sched <= E, status: done ? 'done' : sched < t ? 'missed' : 'pending' });
      }
      m++; if (m > 12) { m = 1; y++; }
    }
  }
  return out;
}

/* 连续:daily 连续天数,weekly 连续达标周数,monthly 连续月数。进行中的当期尚未完成时不算断。 */
function streak(records, rule, today, opts) {
  opts = opts || {};
  let start = opts.start;
  if (!start) {
    let min = null;
    for (const d of recordMap(records).keys()) if (min === null || d < min) min = d;
    if (min === null) return 0;
    start = fromDay(min);
  }
  const ps = periods(records, rule, start, today, opts.ended);
  let i = ps.length - 1;
  while (i >= 0 && ps[i].status === 'pending') i--;
  let n = 0;
  while (i >= 0 && ps[i].status === 'done') { n++; i--; }
  return n;
}

/* 执行率 = 区间内实际记录次数 / 应执行次数(真实比值,可超过 1);应执行为 0 时 rate 为 null(不除零)。 */
function executionRate(records, rule, start, today, ended) {
  const s = dayOf(start), E = effectiveEnd(today, ended);
  const expected = expectedCount(rule, start, today, ended);
  let actual = 0;
  if (s !== null && E !== null) for (const d of recordMap(records).keys()) if (d >= s && d <= E) actual++;
  return { actual, expected, rate: expected > 0 ? actual / expected : null };
}

/* 本周(或本月)还需执行几次 */
function guardStatus(records, rule, start, today, ended) {
  const s = dayOf(start), t = dayOf(today);
  const e = ended ? dayOf(ended) : null;
  const scope = rule && rule.kind === 'monthly' ? 'month' : 'week';
  const none = { scope, quota: 0, done: 0, remaining: 0, active: false };
  if (s === null || t === null || !rule || t < s || (e !== null && t > e)) return none;
  const rec = recordMap(records);
  const countIn = (from, to) => { let c = 0; for (const d of rec.keys()) if (d >= from && d <= to) c++; return c; };
  if (scope === 'month') {
    const td = new Date(t * DAY_MS);
    const mb = monthBounds(td.getUTCFullYear() + '-' + pad(td.getUTCMonth() + 1, 2));
    const sched = monthSched(mb.y, mb.m, rule);
    if (sched < s || (e !== null && sched > e)) return none;
    const done = countIn(Math.max(mb.first, s), mb.last) > 0 ? 1 : 0;
    return { scope, quota: 1, done, remaining: 1 - done, active: true };
  }
  const mon = mondayOf(t);
  const availStart = Math.max(s, mon);
  const availEnd = e !== null ? Math.min(mon + 6, e) : mon + 6;
  const avail = availEnd - availStart + 1;
  const quota = rule.kind === 'daily' ? avail : Math.min(rule.n, avail);
  const done = countIn(availStart, availEnd);
  return { scope, quota, done, remaining: Math.max(0, quota - done), active: true };
}

/* ---------- 复利 ---------- */
function validRate(r) { return typeof r === 'number' && isFinite(r) && r > -1 && r <= 10; }
/* 期初投入、期末结算:v_k = (v_{k-1} + a) * (1 + i),i = (1+年化)^(1/每年期数) - 1。
   返回 k = 1..periods 的数组 [{period, invested, value}];参数不合法返回 []。 */
function compound(amountPerPeriod, periods_, annualRate, periodsPerYear_) {
  const a = amountPerPeriod, n = periods_, ppy = periodsPerYear_;
  if (typeof a !== 'number' || !isFinite(a) || a < 0) return [];
  if (!Number.isInteger(n) || n < 0 || n > MAX_EXEC) return [];
  if (!Number.isInteger(ppy) || ppy < 1 || ppy > 366) return [];
  if (!validRate(annualRate)) return [];
  const i = annualRate === 0 ? 0 : Math.pow(1 + annualRate, 1 / ppy) - 1;
  const out = [];
  let v = 0;
  for (let k = 1; k <= n; k++) {
    const invested = a * k;
    v = i === 0 ? invested : (v + a) * (1 + i);
    out.push({ period: k, invested, value: v });
  }
  return out;
}
/* 算术对照:同样的总额在第 0 期一次性投入,按同一假设滚动 k 期。 */
function lumpSum(total, periods_, annualRate, periodsPerYear_) {
  const ppy = periodsPerYear_;
  if (typeof total !== 'number' || !isFinite(total) || total < 0) return [];
  if (!Number.isInteger(periods_) || periods_ < 0 || periods_ > MAX_EXEC) return [];
  if (!Number.isInteger(ppy) || ppy < 1 || ppy > 366) return [];
  if (!validRate(annualRate)) return [];
  const i = annualRate === 0 ? 0 : Math.pow(1 + annualRate, 1 / ppy) - 1;
  const out = [];
  for (let k = 1; k <= periods_; k++) out.push({ period: k, invested: total, value: i === 0 ? total : total * Math.pow(1 + i, k) });
  return out;
}
/* 按规则向前推算 periods_ 个「期」:每期的执行次数计入投入与复利次数(每周 N 次 = 每期 N 笔),
   一次性对照用同样的总额。返回 {executions, ppy, curve, lump}。 */
function project(rule, amount, periods_, annualRate) {
  const per = executionsPerPeriod(rule);
  const executions = Number.isInteger(periods_) ? periods_ * per : NaN;
  const ppy = periodsPerYear(rule);
  const curve = compound(amount, executions, annualRate, ppy);
  const lump = lumpSum(amount * executions, executions, annualRate, ppy);
  return { executions, ppy, curve, lump };
}
/* 已发生的实际记录:累计投入,以及按年化假设(按天复利)折算到 today 的账面值。 */
function assumedValue(records, annualRate, today) {
  const t = dayOf(today);
  let invested = 0, value = 0;
  if (t === null || !validRate(annualRate)) return { invested: 0, value: 0 };
  for (const r of records || []) {
    const d = dayOf(r.date);
    if (d === null || d > t) continue;
    invested += r.value;
    value += annualRate === 0 ? r.value : r.value * Math.pow(1 + annualRate, (t - d) / 365);
  }
  return { invested, value };
}

/* ---------- 每天进步一点点 ---------- */
function growth(dailyRate, days) {
  if (typeof dailyRate !== 'number' || !isFinite(dailyRate) || dailyRate <= -1) return null;
  if (!Number.isInteger(days) || days < 0) return null;
  return Math.pow(1 + dailyRate, days);
}
/* 稳定每天做 vs 隔天做(第 1、3、5… 天做,共 ceil(days/2) 次) */
function compareGrowth(dailyRate, days) {
  const steady = growth(dailyRate, days);
  if (steady === null) return null;
  const alternateTimes = Math.ceil(days / 2);
  const alternate = growth(dailyRate, alternateTimes);
  return { steady, alternate, alternateTimes, ratio: alternate > 0 ? steady / alternate : null };
}

/* ---------- 热力 ---------- */
/* 最近 weeks 周(旧→新),每周 7 格(周一…周日)。 */
function weeklyHeat(records, today, opts) {
  opts = opts || {};
  const weeks = Number.isInteger(opts.weeks) && opts.weeks > 0 ? opts.weeks : 12;
  const t = dayOf(today);
  if (t === null) return [];
  const s = opts.start ? dayOf(opts.start) : null;
  const e = opts.ended ? dayOf(opts.ended) : null;
  const rec = recordMap(records);
  const out = [];
  const lastMon = mondayOf(t);
  for (let w = weeks - 1; w >= 0; w--) {
    const mon = lastMon - 7 * w;
    const cells = [];
    for (let i = 0; i < 7; i++) {
      const d = mon + i;
      cells.push({
        date: fromDay(d),
        value: rec.has(d) ? rec.get(d) : null,
        future: d > t,
        outside: (s !== null && d < s) || (e !== null && d > e)
      });
    }
    out.push({ weekStart: fromDay(mon), cells });
  }
  return out;
}

/* ---------- 月度总结 ---------- */
function monthlySummary(records, rule, month, opts) {
  opts = opts || {};
  const mb = monthBounds(month);
  const s = dayOf(opts.start);
  if (!mb || s === null || !rule) return null;
  const t = opts.today ? dayOf(opts.today) : null;
  const e = opts.ended ? dayOf(opts.ended) : null;
  let end = mb.last;
  if (t !== null) end = Math.min(end, t);
  if (e !== null) end = Math.min(end, e);
  const cum = day => (day < s ? 0 : expectedCount(rule, fromDay(s), fromDay(day), opts.ended));
  const expected = end < Math.max(mb.first, s) ? 0 : cum(end) - cum(mb.first - 1);
  let actual = 0, total = 0;
  for (const [d, v] of recordMap(records)) {
    if (d >= Math.max(mb.first, s) && d <= end) { actual++; total += v; }
  }
  const streakAtEnd = end < s ? 0 : streak(records, rule, fromDay(end), { start: fromDay(s), ended: opts.ended });
  return { month, expected, actual, total, rate: expected > 0 ? actual / expected : null, streak: streakAtEnd, unit: streakUnit(rule), end: fromDay(end) };
}

/* ---------- 导出 ---------- */
/* 防公式注入:以 = + - @ (及制表符、回车)开头的用户字段加单引号前缀;单独的 - 或 + 不算。 */
function guardCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  if (s === '-' || s === '+') return s;
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}
function csvField(v) {
  const s = guardCell(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(practices) {
  const tag = (practices || []).some(p => p && p.sample === true);
  const rows = [['践行', '类型', '规则', '每次定额', '日期', '实际值', '单位'].concat(tag ? ['数据来源'] : [])];
  for (const p of practices || []) {
    const sorted = (p.records || []).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (const r of sorted) rows.push([p.name, TYPE_LABEL[p.type] || p.type, ruleText(p.rule), p.amount, r.date, r.value, p.unit].concat(tag ? [p.sample === true ? '合成示例' : '真实数据'] : []));
  }
  return rows.map(r => r.map(csvField).join(',')).join('\n') + '\n';
}
function mdCell(v) { return guardCell(v).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' '); }
function oneLine(v) { return String(v === null || v === undefined ? '' : v).replace(/[\r\n]+/g, ' '); }
function toMarkdown(practice, month, today) {
  const p = practice;
  const sum = monthlySummary(p.records, p.rule, month, { start: p.start, ended: p.ended, today });
  const lines = [];
  lines.push('# 月度总结 ' + month + ':' + oneLine(p.name), '');
  lines.push('- 类型:' + TYPE_LABEL[p.type] + ';规则:' + ruleText(p.rule) + ';每次定额:' + p.amount + ' ' + oneLine(p.unit));
  lines.push('- 开始日期:' + p.start + (p.ended ? ';已于 ' + p.ended + ' 结束' : ''));
  if (p.sample === true) lines.push('- 数据来源:合成示例(虚构数据,年化为假设)');
  if (p.stopLoss) lines.push('- 止损规则(仅记录,不执行):' + oneLine(p.stopLoss));
  lines.push('');
  if (!sum) { lines.push('月份无效。'); return lines.join('\n') + '\n'; }
  lines.push('| 指标 | 数值 |', '| --- | --- |');
  lines.push('| 应执行次数 | ' + sum.expected + ' |');
  lines.push('| 实际执行次数 | ' + sum.actual + ' |');
  lines.push('| 执行率 | ' + (sum.rate === null ? '无应执行' : Math.round(sum.rate * 1000) / 10 + '%') + ' |');
  lines.push('| 月末连续 | ' + sum.streak + ' ' + sum.unit + ' |');
  lines.push('| 本月累计 | ' + mdCell(sum.total + ' ' + p.unit) + ' |');
  lines.push('', '| 日期 | 实际值 |', '| --- | --- |');
  const mb = monthBounds(month);
  const rows = (p.records || []).filter(r => { const d = dayOf(r.date); return d >= mb.first && d <= mb.last; })
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const r of rows) lines.push('| ' + mdCell(r.date) + ' | ' + mdCell(r.value + ' ' + p.unit) + ' |');
  if (!rows.length) lines.push('| (本月无记录) | - |');
  lines.push('', '> 由本机「定投复利践行账本」生成。执行率只衡量是否按规则做,不是投资建议。');
  return lines.join('\n') + '\n';
}

/* ---------- 校验与导入 ---------- */
function isPlainObject(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
function validatePractice(p, label) {
  const errs = [];
  const bad = msg => errs.push(label + ':' + msg);
  if (!isPlainObject(p)) { bad('不是对象'); return { errors: errs, clean: null }; }
  if (typeof p.id !== 'string' || !/^[\w.-]{1,64}$/.test(p.id)) bad('id 必须是 1-64 位字母数字/下划线/点/横线');
  if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 60) bad('名称必须是 1-60 字的非空文本');
  if (!TYPES.includes(p.type)) bad('类型 type 必须是 amount / count / quantity 之一');
  if (typeof p.unit !== 'string' || !p.unit.trim() || p.unit.length > 10) bad('单位必须是 1-10 字的非空文本');
  let rule = null;
  if (!isPlainObject(p.rule) || !KINDS.includes(p.rule.kind)) bad('规则 rule.kind 必须是 daily / weekly / monthly 之一');
  else if (p.rule.kind === 'weekly') {
    if (!Number.isInteger(p.rule.n) || p.rule.n < 1 || p.rule.n > 7) bad('每周次数 rule.n 必须是 1-7 的整数');
    else rule = { kind: 'weekly', n: p.rule.n };
  } else if (p.rule.kind === 'monthly') {
    if (!Number.isInteger(p.rule.day) || p.rule.day < 1 || p.rule.day > 31) bad('每月日期 rule.day 必须是 1-31 的整数');
    else rule = { kind: 'monthly', day: p.rule.day };
  } else rule = { kind: 'daily' };
  if (typeof p.amount !== 'number' || !isFinite(p.amount) || p.amount <= 0 || p.amount > 1e9) bad('每次定额 amount 必须是大于 0 的有限数字');
  const s = dayOf(p.start);
  if (s === null) bad('开始日期 start 必须是有效的 YYYY-MM-DD');
  if (p.stopLoss !== undefined && (typeof p.stopLoss !== 'string' || p.stopLoss.length > 500)) bad('止损规则 stopLoss 必须是不超过 500 字的文本');
  let ended = null;
  if (p.ended !== undefined && p.ended !== null) {
    const e = dayOf(p.ended);
    if (e === null) bad('结束日期 ended 必须是有效日期或 null');
    else if (s !== null && e < s) bad('结束日期不能早于开始日期');
    else ended = p.ended;
  }
  if (p.annualRate !== undefined && !validRate(p.annualRate)) bad('年化假设 annualRate 必须是 -1 到 10 之间的数字(小数,6% 写 0.06)');
  if (p.sample !== undefined && typeof p.sample !== 'boolean') bad('sample 必须是布尔值');
  const records = [];
  if (!Array.isArray(p.records)) bad('records 必须是数组');
  else if (p.records.length > 20000) bad('records 超过 20000 条');
  else {
    const seen = new Set();
    p.records.forEach((r, i) => {
      if (!isPlainObject(r)) { bad('第 ' + (i + 1) + ' 条记录不是对象'); return; }
      const d = dayOf(r.date);
      if (d === null) { bad('第 ' + (i + 1) + ' 条记录日期无效'); return; }
      if (s !== null && d < s) { bad('第 ' + (i + 1) + ' 条记录早于开始日期'); return; }
      if (ended && d > dayOf(ended)) { bad('第 ' + (i + 1) + ' 条记录晚于结束日期'); return; }
      if (typeof r.value !== 'number' || !isFinite(r.value) || r.value <= 0 || r.value > 1e12) { bad('第 ' + (i + 1) + ' 条记录的值必须是大于 0 的有限数字'); return; }
      if (seen.has(r.date)) { bad('日期 ' + r.date + ' 重复记录'); return; }
      seen.add(r.date);
      records.push({ date: r.date, value: r.value });
    });
  }
  if (errs.length) return { errors: errs, clean: null };
  const clean = { id: p.id, name: p.name, type: p.type, unit: p.unit, rule, amount: p.amount, start: p.start,
    stopLoss: p.stopLoss || '', ended, annualRate: p.annualRate === undefined ? 0 : p.annualRate, records };
  if (p.sample === true) clean.sample = true;
  return { errors: [], clean };
}
/* 整份拒绝而不是静默修正:任何一处不合法就 ok=false 并列出原因。 */
function validateImport(obj) {
  const errors = [];
  if (!isPlainObject(obj)) return { ok: false, errors: ['文件内容不是 JSON 对象'], data: null };
  if (obj.app !== FORMAT_ID) errors.push('app 字段必须是 "' + FORMAT_ID + '"');
  if (obj.version !== FORMAT_VERSION) errors.push('version 必须是 ' + FORMAT_VERSION);
  if (!Array.isArray(obj.practices)) errors.push('practices 必须是数组');
  else if (obj.practices.length > 200) errors.push('practices 超过 200 条');
  if (errors.length) return { ok: false, errors, data: null };
  const ids = new Set();
  const clean = [];
  obj.practices.forEach((p, i) => {
    const label = '第 ' + (i + 1) + ' 条践行';
    const res = validatePractice(p, label);
    errors.push(...res.errors);
    if (res.clean) {
      if (ids.has(res.clean.id)) errors.push(label + ':id "' + res.clean.id + '" 重复');
      ids.add(res.clean.id);
      clean.push(res.clean);
    }
  });
  if (errors.length) return { ok: false, errors, data: null };
  return { ok: true, errors: [], data: { practices: clean } };
}
/* 新增或覆盖一条记录:先造出新的整份践行,再走与读取/导入完全相同的 validatePractice;
   不合法就返回 ok=false 且不改动原对象。 */
function withRecord(practice, date, value) {
  const records = (practice.records || []).filter(r => r.date !== date).concat([{ date, value }])
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const res = validatePractice(Object.assign({}, practice, { records }), '记录');
  if (res.errors.length) return { ok: false, errors: res.errors, practice: null };
  return { ok: true, errors: [], practice: res.clean };
}
/* 写入某日记录前判断:新增 / 与已有值相同 / 覆盖已有值(界面据此决定是否要确认) */
function recordChange(practice, date, value) {
  const ex = ((practice && practice.records) || []).find(r => r.date === date);
  if (!ex) return { kind: 'new', existing: null };
  return { kind: ex.value === value ? 'same' : 'overwrite', existing: ex.value };
}
/* 推算期数的单位与说明:一期是一天、一周还是一个月;每周 N 次时给出总执行次数 */
function periodWord(rule, periods_) {
  const kind = rule && rule.kind;
  const unit = kind === 'weekly' ? '周' : kind === 'monthly' ? '个月' : '天';
  const label = kind === 'weekly' ? '推算周数' : kind === 'monthly' ? '推算月数' : '推算天数';
  const executions = Number.isInteger(periods_) ? periods_ * executionsPerPeriod(rule) : null;
  const note = kind === 'weekly' && executions !== null ? '每周 ' + rule.n + ' 次,所以推算 ' + periods_ + ' 周共 ' + executions + ' 次执行。' : '';
  return { unit, label, executions, note };
}
function exportJson(practices) {
  return JSON.stringify({ app: FORMAT_ID, version: FORMAT_VERSION, practices }, null, 2);
}

const api = {
  TYPES, KINDS, TYPE_LABEL, FORMAT_ID, FORMAT_VERSION,
  dayOf, fromDay, isValidDate, addDays, daysInMonth, weekdayIdx, resolveToday, monthBounds,
  ruleText, periodsPerYear, streakUnit,
  expectedCount, periods, streak, executionRate, guardStatus,
  executionsPerPeriod, project, compound, lumpSum, assumedValue, growth, compareGrowth,
  weeklyHeat, monthlySummary,
  withRecord, recordChange, periodWord, guardCell, toCsv, toMarkdown, exportJson, validatePractice, validateImport
};
globalThis.DcaCore = api;
if (typeof module !== 'undefined') module.exports = api;
