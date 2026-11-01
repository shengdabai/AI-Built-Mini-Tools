'use strict';
/* 定投耐力模拟器 · 纯逻辑(无 DOM)。金额一律整数分;价格序列为合成或用户 CSV。
   月序号一律 1 起("第 1 月");数组下标 = 月序号 - 1。 */

const DISCLAIMER = '合成价格序列 · 数学演示 · 不是投资建议';
const STATE_VERSION = 1;
const LIMITS = {
  yearsMin: 1,
  driftMin: -50, driftMax: 100,
  volMin: 0, volMax: 150,
  seedMax: 4294967295,
  crashMax: 3, crashDropMax: 99.99,
  amountMaxYuan: 100000000,
  pricesMin: 2, pointsMax: 100000, priceMin: 0.0001, priceMax: 1e12,
  thresholdMin: 1, thresholdMax: 99,
  fieldMaxLen: 40, idMaxLen: 64
};
const RULE_TYPES = ['never', 'stop', 'sell'];
const RULE_LABEL = { never: '从不停止', stop: '回撤停投', sell: '回撤清仓' };
const CHOICES = ['continue', 'stop', 'sell'];
const CHOICE_LABEL = { continue: '继续', stop: '停投', sell: '清仓' };
const EPS = 1e-9;

/* ---------- 伪随机 ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rand) {
  const u1 = Math.max(rand(), 1e-12);
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/* ---------- 价格序列 ---------- */
function checkGenParams(p) {
  const errs = [];
  if (!p || typeof p !== 'object') return ['参数缺失'];
  const inRange = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  if (!Number.isInteger(p.years) || p.years < LIMITS.yearsMin || p.years * 12 > LIMITS.pointsMax) errs.push(`年数须为不小于 1 的整数(技术上限:${LIMITS.pointsMax} 个月度价格点)`);
  if (!inRange(p.drift, LIMITS.driftMin, LIMITS.driftMax)) errs.push(`年化漂移须在 ${LIMITS.driftMin}% 到 ${LIMITS.driftMax}% 之间`);
  if (!inRange(p.vol, LIMITS.volMin, LIMITS.volMax)) errs.push(`年化波动须在 ${LIMITS.volMin}% 到 ${LIMITS.volMax}% 之间`);
  if (!Number.isInteger(p.seed) || p.seed < 0 || p.seed > LIMITS.seedMax) errs.push(`随机种子须为 0–${LIMITS.seedMax} 的整数`);
  const crashes = p.crashes === undefined ? [] : p.crashes;
  if (!Array.isArray(crashes)) { errs.push('崩盘设置须为列表'); return errs; }
  if (crashes.length > LIMITS.crashMax) errs.push(`崩盘最多 ${LIMITS.crashMax} 次`);
  const n = Number.isInteger(p.years) ? p.years * 12 : 0;
  const spans = [];
  crashes.forEach((c, i) => {
    const tag = `第 ${i + 1} 次崩盘`;
    if (!c || !Number.isInteger(c.start) || c.start < 2) { errs.push(`${tag}:起始月须为不小于 2 的整数`); return; }
    if (!Number.isInteger(c.months) || c.months < 1) { errs.push(`${tag}:持续月数须为不小于 1 的整数`); return; }
    if (!inRange(c.drop, 0.01, LIMITS.crashDropMax)) { errs.push(`${tag}:跌幅须在 0.01% 到 ${LIMITS.crashDropMax}% 之间`); return; }
    if (n && c.start + c.months - 1 > n) { errs.push(`${tag}:超出序列长度(${n} 个月)`); return; }
    spans.push([c.start, c.start + c.months - 1, i + 1]);
  });
  spans.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < spans.length; i++) {
    if (spans[i][0] <= spans[i - 1][1]) errs.push(`第 ${spans[i - 1][2]} 次与第 ${spans[i][2]} 次崩盘的月份重叠`);
  }
  return errs;
}

function genPrices(p) {
  const errs = checkGenParams(p);
  if (errs.length) throw new RangeError(errs.join(';'));
  const n = p.years * 12;
  const rand = mulberry32(p.seed);
  const mu = p.drift / 100, sg = p.vol / 100;
  const crashAt = new Array(n).fill(null);
  (p.crashes || []).forEach(c => {
    const f = Math.pow(1 - c.drop / 100, 1 / c.months);
    for (let m = c.start; m < c.start + c.months; m++) crashAt[m - 1] = f;
  });
  const prices = [100];
  for (let i = 1; i < n; i++) {
    const z = gaussian(rand); // 每月恰好消耗两个随机数,崩盘月也消耗,保证同种子下非崩盘月不受崩盘设置影响
    const prev = prices[i - 1];
    let next;
    if (crashAt[i] !== null) next = prev * crashAt[i];
    else next = prev * Math.exp((mu - 0.5 * sg * sg) / 12 + (sg / Math.sqrt(12)) * z);
    if (!Number.isFinite(next) || next > LIMITS.priceMax) throw new RangeError(`第 ${i + 1} 月价格超出可表示范围(上限 ${LIMITS.priceMax}),请降低漂移或年数`);
    prices.push(Math.max(LIMITS.priceMin, Math.round(next * 1e4) / 1e4));
  }
  for (let i = 1; i < n; i++) {
    if (crashAt[i] !== null && !(prices[i] < prices[i - 1])) throw new RangeError(`第 ${i + 1} 月的崩盘下跌低于最小可表示价格 ${LIMITS.priceMin},请降低跌幅或先前的下跌`);
  }
  return prices;
}

/* ---------- 回撤 ---------- */
function drawdown(curve) {
  const series = [];
  let peak = 0, max = 0, run = 0, longest = 0;
  for (const v of curve) {
    if (v > peak) peak = v;
    const d = peak > 0 ? 1 - v / peak : 0;
    series.push(d);
    if (d > max) max = d;
    if (d > EPS) { run += 1; if (run > longest) longest = run; } else run = 0;
  }
  return { series, max, longestUnderwater: longest };
}

/* ---------- 定投 ---------- */
function normRule(rule) {
  if (rule === undefined || rule === null) return { type: 'never', threshold: 0 };
  if (typeof rule === 'string') rule = { type: rule, threshold: 30 };
  if (!RULE_TYPES.includes(rule.type)) throw new RangeError('规则类型不合法');
  if (rule.type === 'never') return { type: 'never', threshold: 0 };
  if (typeof rule.threshold !== 'number' || !(rule.threshold >= LIMITS.thresholdMin && rule.threshold <= LIMITS.thresholdMax)) throw new RangeError('回撤阈值须在 1–99 之间');
  return { type: rule.type, threshold: rule.threshold };
}
function checkPricesArray(prices) {
  if (!Array.isArray(prices) || prices.length < LIMITS.pricesMin || prices.length > LIMITS.pointsMax) throw new RangeError('价格序列须有 2 个以上月度点');
  for (const p of prices) if (typeof p !== 'number' || !Number.isFinite(p) || p < LIMITS.priceMin || p > LIMITS.priceMax) throw new RangeError(`价格必须在 ${LIMITS.priceMin} 到 ${LIMITS.priceMax} 之间`);
}
function checkAmount(amount) {
  if (!Number.isInteger(amount) || amount <= 0) throw new RangeError('金额必须是正整数(单位:分)');
}
function checkStart(prices, startMonth) {
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > prices.length) throw new RangeError('起始月须在序列范围内');
}
function summarize(prices, curve, costCurve, extra) {
  for (const v of curve) if (!Number.isFinite(v)) throw new RangeError('结果超出可表示范围(份额或市值不是有限数)');
  if (extra && extra.shares !== undefined && !Number.isFinite(extra.shares)) throw new RangeError('份额超出可表示范围');
  const dd = drawdown(curve);
  let maxLoss = 0;
  for (let i = 0; i < curve.length; i++) {
    if (costCurve[i] > 0) maxLoss = Math.max(maxLoss, (costCurve[i] - curve[i]) / costCurve[i]);
  }
  const cost = costCurve[costCurve.length - 1];
  const value = curve[curve.length - 1];
  return Object.assign({
    curve, costCurve, cost, value,
    maxDrawdown: dd.max, underwaterMonths: dd.longestUnderwater, drawdownSeries: dd.series,
    maxLoss, multiple: cost > 0 ? value / cost : null
  }, extra);
}

function dca(prices, opts) {
  checkPricesArray(prices);
  const o = opts || {};
  checkAmount(o.amount);
  const startMonth = o.startMonth === undefined ? 1 : o.startMonth;
  checkStart(prices, startMonth);
  const rule = normRule(o.rule);
  const n = prices.length;
  const curve = new Array(n).fill(0), costCurve = new Array(n).fill(0);
  let shares = 0, cost = 0, cash = 0, peak = 0, status = 'active', haltMonth = null;
  const events = [];
  for (let i = startMonth - 1; i < n; i++) {
    const p = prices[i];
    if (p > peak) peak = p;
    const dd = 1 - p / peak;
    if (status === 'active' && rule.type !== 'never' && dd * 100 >= rule.threshold - EPS) {
      if (rule.type === 'stop') { status = 'stopped'; }
      else { cash += Math.round(shares * p); shares = 0; status = 'sold'; }
      haltMonth = i + 1;
      events.push({ month: i + 1, type: rule.type, price: p, drawdown: dd });
    }
    if (status === 'active') { shares += o.amount / p; cost += o.amount; }
    curve[i] = cash + Math.round(shares * p);
    costCurve[i] = cost;
  }
  return summarize(prices, curve, costCurve, {
    shares, cash, status, haltMonth, events, rule,
    holdings: Math.round(shares * prices[n - 1])
  });
}

function lumpSum(prices, amount, startMonth) {
  checkPricesArray(prices);
  checkAmount(amount);
  const start = startMonth === undefined ? 1 : startMonth;
  checkStart(prices, start);
  const n = prices.length;
  const shares = amount / prices[start - 1];
  const curve = new Array(n).fill(0), costCurve = new Array(n).fill(0);
  for (let i = start - 1; i < n; i++) { curve[i] = Math.round(shares * prices[i]); costCurve[i] = amount; }
  return summarize(prices, curve, costCurve, { shares, cash: 0, status: 'active', haltMonth: null, events: [], rule: { type: 'lump', threshold: 0 }, holdings: curve[n - 1] });
}

function lumpVsDca(prices, opts) {
  const d = dca(prices, { amount: opts.amount, startMonth: opts.startMonth, rule: 'never' });
  const l = lumpSum(prices, d.cost, opts.startMonth);
  return { dca: d, lump: l, drawdownGap: l.maxDrawdown - d.maxDrawdown, valueGap: l.value - d.value };
}

function compareRules(prices, amount, opts) {
  const o = opts || {};
  const threshold = o.threshold === undefined ? 30 : o.threshold;
  const startMonth = o.startMonth === undefined ? 1 : o.startMonth;
  const never = dca(prices, { amount, startMonth, rule: 'never' });
  const stop = dca(prices, { amount, startMonth, rule: { type: 'stop', threshold } });
  const sell = dca(prices, { amount, startMonth, rule: { type: 'sell', threshold } });
  let sideline = null;
  const ev = sell.events.find(e => e.type === 'sell');
  if (ev) {
    let above = 0;
    for (let i = ev.month; i < prices.length; i++) if (prices[i] >= ev.price) above += 1;
    sideline = { sellMonth: ev.month, sellPrice: ev.price, outMonths: prices.length - ev.month, aboveMonths: above };
  }
  return {
    threshold, rules: { never, stop, sell },
    diff: { stopVsNever: never.value - stop.value, sellVsNever: never.value - sell.value },
    sideline
  };
}

/* ---------- 耐力测验状态机 ---------- */
function newReplay(prices, o) {
  checkPricesArray(prices);
  checkAmount(o.amount);
  checkStart(prices, o.startMonth);
  if (typeof o.threshold !== 'number' || !(o.threshold >= LIMITS.thresholdMin && o.threshold <= LIMITS.thresholdMax)) throw new RangeError('提醒阈值须在 1–99 之间');
  return {
    prices, amount: o.amount, startMonth: o.startMonth, threshold: o.threshold,
    month: -1, shares: 0, cost: 0, cash: 0, status: 'active', peak: 0, armed: true,
    pending: null, curve: [], costCurve: [], choices: [], done: false
  };
}
function cloneReplay(s) {
  return Object.assign({}, s, { curve: s.curve.slice(), costCurve: s.costCurve.slice(), choices: s.choices.slice() });
}
function finishMonth(s) {
  const i = s.month, p = s.prices[i];
  if (i >= s.startMonth - 1 && s.status === 'active') { s.shares += s.amount / p; s.cost += s.amount; }
  const val = s.cash + Math.round(s.shares * p);
  if (!Number.isFinite(val)) throw new RangeError('结果超出可表示范围');
  s.curve.push(val);
  s.costCurve.push(s.cost);
  s.pending = null;
  if (i === s.prices.length - 1) s.done = true;
}
/* choice: 'next' 前进一月;'continue' | 'stop' | 'sell' 处理待决回撤。返回新状态,不修改入参。 */
function replayStep(state, choice) {
  const s = cloneReplay(state);
  if (choice === 'next') {
    if (s.done) throw new Error('测验已结束');
    if (s.pending) throw new Error('请先对当前回撤做出选择');
    s.month += 1;
    const i = s.month, p = s.prices[i];
    if (i >= s.startMonth - 1) {
      if (p > s.peak) s.peak = p;
      const dd = 1 - p / s.peak;
      if (dd * 100 >= s.threshold - EPS) {
        if (s.status === 'active' && s.armed) {
          s.armed = false;
          s.pending = { month: i + 1, price: p, drawdown: dd };
          return s;
        }
      } else s.armed = true;
    }
    finishMonth(s);
    return s;
  }
  if (!CHOICES.includes(choice)) throw new Error('未知选择');
  if (!s.pending) throw new Error('当前没有待处理的回撤');
  const p = s.prices[s.month];
  s.choices.push({ month: s.pending.month, drawdown: s.pending.drawdown, choice });
  if (choice === 'stop') s.status = 'stopped';
  else if (choice === 'sell') { s.cash += Math.round(s.shares * p); s.shares = 0; s.status = 'sold'; }
  finishMonth(s);
  return s;
}
function replayResult(state, rule) {
  if (!state.done) throw new Error('测验尚未结束');
  const ref = dca(state.prices, { amount: state.amount, startMonth: state.startMonth, rule: rule || 'never' });
  const dd = drawdown(state.curve);
  const cost = state.costCurve[state.costCurve.length - 1];
  const value = state.curve[state.curve.length - 1];
  return {
    behavior: { curve: state.curve, cost, value, maxDrawdown: dd.max, underwaterMonths: dd.longestUnderwater },
    rule: ref, diff: value - ref.value, choices: state.choices
  };
}

/* ---------- 格式化与安全 ---------- */
function fmtYuan(cents) {
  const neg = cents < 0;
  const c = Math.abs(cents);
  const y = Math.floor(c / 100), f = c % 100;
  return (neg ? '-' : '') + String(y).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + String(f).padStart(2, '0');
}
function fmtPct(frac, digits) { return (frac * 100).toFixed(digits === undefined ? 1 : digits) + '%'; }
function guardCell(v) {
  if (typeof v !== 'string') return v;
  if (v === '-' || v === '+') return v;
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}
function csvField(v) {
  const s = String(guardCell(v));
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function mdCell(v) {
  return String(guardCell(String(v))).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/* ---------- 导出 ---------- */
function toCsv(data) {
  const series = data.series || [];
  const tag = data.sample ? '合成示例:' + data.sample : null;
  const head = ['月', '价格'].concat(series.map(s => s.name + '(分)')).concat(tag ? ['数据性质'] : []);
  const lines = [head.map(csvField).join(',')];
  data.prices.forEach((p, i) => {
    lines.push([i + 1, p].concat(series.map(s => s.values[i])).concat(tag ? [tag] : []).map(csvField).join(','));
  });
  return lines.join('\n') + '\n';
}

function toMarkdown(d) {
  const L = [];
  const cmp = d.compare, rules = cmp.rules;
  L.push('# 定投耐力模拟器 · 小结', '');
  L.push(`> **${DISCLAIMER}**。本小结只是对合成或自备序列的数学演示,不含手续费与税,不预测收益,不构成任何投资建议。`, '');
  L.push(`日期:${mdCell(d.date)}`, '');
  if (d.sample) L.push(`> 合成示例:${mdCell(d.sample)}。下面的价格和结果都来自合成示例,不是真实记录。`, '');
  L.push('## 设定', '');
  L.push('| 项目 | 值 |', '| --- | --- |');
  (d.params || []).forEach(r => L.push(`| ${mdCell(r[0])} | ${mdCell(r[1])} |`));
  L.push('', `## 情景对照(回撤阈值 ${cmp.threshold}%)`, '');
  L.push('| 规则 | 终值(元) | 累计投入(元) | 倍数 | 最大资产回撤 | 最长水下(月) | 相对“从不停止”终值差(元) |', '| --- | --- | --- | --- | --- | --- | --- |');
  const rows = [['从不停止', rules.never, 0], [`跌 ${cmp.threshold}% 停投`, rules.stop, cmp.diff.stopVsNever], [`跌 ${cmp.threshold}% 清仓`, rules.sell, cmp.diff.sellVsNever]];
  rows.forEach(([name, r, diff]) => {
    L.push(`| ${mdCell(name)} | ${fmtYuan(r.value)} | ${fmtYuan(r.cost)} | ${r.multiple === null ? '-' : r.multiple.toFixed(2)} | ${fmtPct(r.maxDrawdown)} | ${r.underwaterMonths} | ${diff === 0 ? '0.00' : fmtYuan(-diff)} |`);
  });
  L.push('', '最大资产回撤:资产曲线(持仓市值 + 清仓后的现金)相对资产历史高点的最大跌幅;最长水下:资产连续未回到历史高点的最长月数。它们与触发规则用的价格回撤(价格相对起始月之后价格高点的跌幅)是两件事。', '');
  if (cmp.sideline) L.push(`清仓发生在第 ${cmp.sideline.sellMonth} 月;此后空仓 ${cmp.sideline.outMonths} 个月,其中价格回到清仓价以上的有 ${cmp.sideline.aboveMonths} 个月。`, '');
  else L.push('该序列在此阈值下没有触发清仓。', '');
  if (d.lump) {
    L.push('## 全部押上 vs 定投', '');
    L.push('| 方式 | 总投入(元) | 终值(元) | 最大资产回撤 | 最大浮亏 |', '| --- | --- | --- | --- | --- |');
    L.push(`| 每月定投 | ${fmtYuan(d.lump.dca.cost)} | ${fmtYuan(d.lump.dca.value)} | ${fmtPct(d.lump.dca.maxDrawdown)} | ${fmtPct(d.lump.dca.maxLoss)} |`);
    L.push(`| 一次性全投 | ${fmtYuan(d.lump.lump.cost)} | ${fmtYuan(d.lump.lump.value)} | ${fmtPct(d.lump.lump.maxDrawdown)} | ${fmtPct(d.lump.lump.maxLoss)} |`, '');
  }
  L.push('## 耐力测验记录', '');
  const recs = d.records || [];
  if (!recs.length) L.push('暂无记录。', '');
  else {
    L.push('| 日期 | 来源 | 种子 | 提醒阈值 | 选择 | 你的终值(元) | 规则终值(元) |', '| --- | --- | --- | --- | --- | --- | --- |');
    recs.forEach(r => {
      const pick = r.choices.length ? r.choices.map(c => `第${c.month}月${CHOICE_LABEL[c.choice]}`).join('、') : '未触发';
      L.push(`| ${mdCell(r.date)} | ${r.source === 'csv' ? '自备 CSV' : '合成'} | ${r.seed === null ? '-' : r.seed} | ${r.threshold}% | ${mdCell(pick)} | ${fmtYuan(r.behaviorValue)} | ${fmtYuan(r.ruleValue)} |`);
    });
    L.push('');
  }
  L.push('---', `*${DISCLAIMER}*`, '');
  return L.join('\n');
}

/* ---------- 导入:价格 CSV ---------- */
function splitCsv(text) {
  const rows = [];
  let row = [], cell = '', inQ = false, i = 0, quotedCell = false, closed = false;
  const pushCell = () => { row.push({ v: cell, q: quotedCell }); cell = ''; quotedCell = false; closed = false; };
  const pushRow = () => { pushCell(); rows.push(row); row = []; };
  while (i < text.length) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQ = false; closed = true; i += 1; continue;
      }
      cell += ch; i += 1; continue;
    }
    if (closed && ch !== ',' && ch !== '\n' && ch !== '\r') return { error: '引号闭合后出现多余字符' };
    if (ch === '"' && cell === '') { inQ = true; quotedCell = true; i += 1; continue; }
    if (ch === ',') { pushCell(); i += 1; continue; }
    if (ch === '\r') { i += 1; continue; }
    if (ch === '\n') { pushRow(); i += 1; continue; }
    cell += ch; i += 1;
  }
  if (inQ) return { error: '引号没有闭合' };
  if (cell !== '' || row.length) pushRow();
  return { rows };
}
const PRICE_RE = /^\d+(\.\d+)?([eE][+-]?\d+)?$/;
function parsePricesCsv(text) {
  if (typeof text !== 'string') return { ok: false, error: '内容不是文本' };
  const src = text.replace(/^﻿/, '');
  const sp = splitCsv(src);
  if (sp.error) return { ok: false, error: sp.error };
  const rows = sp.rows.filter(r => !(r.length === 1 && r[0].v.trim() === ''));
  if (!rows.length) return { ok: false, error: '没有数据行' };
  const width = rows[0].length;
  if (width < 1 || width > 2) return { ok: false, error: '只支持 1 列(价格)或 2 列(月,价格)' };
  let col = width === 2 ? 1 : 0, startRow = 0;
  const first = rows[0].map(c => c.v.trim());
  const isHeader = first.every(v => /[A-Za-z\u4e00-\u9fff]/.test(v) && !PRICE_RE.test(v));
  if (isHeader) {
    startRow = 1;
    const idx = first.findIndex(v => /价格|price|close|收盘/i.test(v));
    if (idx >= 0) col = idx;
  } else if (width === 1) col = 0;
  const prices = [];
  for (let r = startRow; r < rows.length; r++) {
    if (rows[r].length !== width) return { ok: false, error: `第 ${r + 1} 行列数与首行不一致` };
    const raw = rows[r][col].v.trim();
    if (!PRICE_RE.test(raw)) return { ok: false, error: `第 ${r + 1} 行的价格“${raw.slice(0, 20)}”不是正数` };
    const v = Number(raw);
    if (!Number.isFinite(v) || v < LIMITS.priceMin || v > LIMITS.priceMax) return { ok: false, error: `第 ${r + 1} 行的价格须在 ${LIMITS.priceMin} 到 ${LIMITS.priceMax} 之间` };
    prices.push(v);
  }
  if (prices.length < LIMITS.pricesMin) return { ok: false, error: `价格至少 ${LIMITS.pricesMin} 行` };
  if (prices.length > LIMITS.pointsMax) return { ok: false, error: `价格最多 ${LIMITS.pointsMax} 行` };
  return { ok: true, prices };
}

/* ---------- 日期 ---------- */
function isRealDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function resolveToday(search, now) {
  let q = null;
  try { q = new URLSearchParams(search || '').get('today'); } catch (e) { q = null; }
  if (q !== null && isRealDate(q)) return q;
  const d = now instanceof Date ? now : new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* ---------- 测验记录校验 ---------- */
function validateRecord(r, i) {
  const t = `记录 ${i + 1}`;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return `${t}:不是对象`;
  if (typeof r.id !== 'string' || r.id.length < 1 || r.id.length > LIMITS.idMaxLen) return `${t}:id 不合法`;
  if (!isRealDate(r.date)) return `${t}:日期不合法`;
  if (r.source !== 'synthetic' && r.source !== 'csv') return `${t}:来源只能是 synthetic 或 csv`;
  if (r.seed !== null && !(Number.isInteger(r.seed) && r.seed >= 0 && r.seed <= LIMITS.seedMax)) return `${t}:种子不合法`;
  if (r.source === 'synthetic' && r.seed === null) return `${t}:合成序列必须有种子`;
  if (!Number.isInteger(r.months) || r.months < LIMITS.pricesMin || r.months > LIMITS.pointsMax) return `${t}:月数不合法`;
  if (!Number.isInteger(r.amount) || r.amount <= 0 || r.amount > LIMITS.amountMaxYuan * 100) return `${t}:金额须为正整数分`;
  if (typeof r.threshold !== 'number' || !(r.threshold >= LIMITS.thresholdMin && r.threshold <= LIMITS.thresholdMax)) return `${t}:提醒阈值不合法`;
  if (!Array.isArray(r.choices) || r.choices.length > LIMITS.pointsMax) return `${t}:选择列表不合法`;
  for (const c of r.choices) {
    if (!c || !Number.isInteger(c.month) || c.month < 1 || c.month > r.months) return `${t}:选择的月序号不合法`;
    if (typeof c.drawdown !== 'number' || !(c.drawdown >= 0 && c.drawdown <= 1)) return `${t}:选择的回撤不合法`;
    if (!CHOICES.includes(c.choice)) return `${t}:选择只能是 continue/stop/sell`;
  }
  for (const k of ['behaviorValue', 'ruleValue', 'cost']) {
    if (!Number.isInteger(r[k]) || r[k] < 0 || r[k] > Number.MAX_SAFE_INTEGER) return `${t}:${k} 须为非负整数分`;
  }
  for (const k of ['behaviorMaxDrawdown', 'ruleMaxDrawdown']) {
    if (typeof r[k] !== 'number' || !(r[k] >= 0 && r[k] <= 1)) return `${t}:${k} 须在 0–1 之间`;
  }
  return null;
}
function validateRecords(list) {
  if (!Array.isArray(list)) return '记录须为列表';
  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const e = validateRecord(list[i], i);
    if (e) return e;
    if (seen.has(list[i].id)) return `记录 id 重复:${list[i].id.slice(0, 30)}`;
    seen.add(list[i].id);
  }
  return null;
}
function sameJson(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && sameJson(a[k], b[k]));
}
function mergeRecords(existing, incoming) {
  const byId = new Map(existing.map(r => [r.id, r]));
  const added = [];
  for (const r of incoming) {
    if (byId.has(r.id)) {
      if (!sameJson(byId.get(r.id), r)) return { ok: false, error: `id ${r.id.slice(0, 30)} 与已有记录冲突且内容不同,整份拒绝` };
      continue;
    }
    added.push(r);
  }
  return { ok: true, records: existing.concat(added), added: added.length };
}
function recordsToJson(records, date) {
  return JSON.stringify({ version: STATE_VERSION, kind: 'dca-endurance-records', exportedAt: date, records }, null, 2);
}
function validateImport(text, kind) {
  if (typeof text !== 'string') return { ok: false, error: '内容不是文本' };
  let k = kind;
  if (!k) k = /^\s*[\[{]/.test(text.replace(/^﻿/, '')) ? 'records' : 'prices';
  if (k === 'prices') {
    const r = parsePricesCsv(text);
    return r.ok ? { ok: true, kind: 'prices', prices: r.prices } : { ok: false, kind: 'prices', error: r.error };
  }
  let obj;
  try { obj = JSON.parse(text.replace(/^﻿/, '')); } catch (e) { return { ok: false, kind: 'records', error: 'JSON 无法解析' }; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, kind: 'records', error: '顶层必须是对象' };
  if (obj.version !== STATE_VERSION) return { ok: false, kind: 'records', error: '版本不支持' };
  if (obj.kind !== 'dca-endurance-records') return { ok: false, kind: 'records', error: '这不是测验记录文件' };
  const e = validateRecords(obj.records);
  if (e) return { ok: false, kind: 'records', error: e };
  return { ok: true, kind: 'records', records: obj.records };
}

/* ---------- 表单 → 设定 ---------- */
function defaultForm() {
  return {
    source: 'synthetic', years: '10', drift: '6', vol: '18', seed: '20261020', crashes: [],
    amount: '1000', startMonth: '1', ruleType: 'never', threshold: '30', quizThreshold: '20'
  };
}
function defaultState() {
  return { v: STATE_VERSION, generated: false, form: defaultForm(), csvPrices: null, records: [], sample: null };
}
const NUM_RE = /^-?\d+(\.\d+)?$/;
function toNum(s) { return typeof s === 'string' && NUM_RE.test(s.trim()) ? Number(s.trim()) : NaN; }
function yuanToCents(s) {
  if (typeof s !== 'string') return NaN;
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s.trim());
  if (!m) return NaN;
  return Number(m[1]) * 100 + Number(((m[2] || '') + '00').slice(0, 2));
}
function parseForm(form, csvPrices) {
  const errors = [];
  const bad = (field, msg) => errors.push({ field, msg });
  const f = form;
  const out = { source: f.source };
  const amount = yuanToCents(f.amount);
  if (!Number.isInteger(amount) || amount <= 0 || amount > LIMITS.amountMaxYuan * 100) bad('amount', `每月金额须为大于 0 的数,最多两位小数,不超过 ${LIMITS.amountMaxYuan} 元`);
  out.amount = amount;
  const start = toNum(f.startMonth);
  if (!Number.isInteger(start) || start < 1) bad('startMonth', '起始月须为不小于 1 的整数'); else out.startMonth = start;
  const th = toNum(f.threshold);
  if (!(th >= LIMITS.thresholdMin && th <= LIMITS.thresholdMax)) bad('threshold', '回撤阈值须在 1–99 之间'); else out.threshold = th;
  const qth = toNum(f.quizThreshold);
  if (!(qth >= LIMITS.thresholdMin && qth <= LIMITS.thresholdMax)) bad('quizThreshold', '测验提醒阈值须在 1–99 之间'); else out.quizThreshold = qth;
  if (!RULE_TYPES.includes(f.ruleType)) bad('ruleType', '中断规则不合法'); else out.rule = { type: f.ruleType, threshold: f.ruleType === 'never' ? 0 : out.threshold };
  if (f.source === 'csv') {
    if (!csvPrices) bad('csv', '还没有导入价格 CSV'); else out.prices = csvPrices;
  } else {
    const p = {
      years: toNum(f.years), drift: toNum(f.drift), vol: toNum(f.vol), seed: toNum(f.seed),
      crashes: f.crashes.map(c => ({ start: toNum(c.start), months: toNum(c.months), drop: toNum(c.drop) }))
    };
    checkGenParams(p).forEach(m => bad('gen', m));
    out.gen = p;
  }
  if (!errors.length) {
    const n = out.prices ? out.prices.length : out.gen.years * 12;
    if (out.startMonth > n) bad('startMonth', `起始月不能超过序列长度(${n} 个月)`);
  }
  if (errors.length) return { ok: false, errors };
  if (!out.prices) {
    try { out.prices = genPrices(out.gen); } catch (e) { return { ok: false, errors: [{ field: 'gen', msg: e.message }] }; }
  }
  return { ok: true, settings: out };
}

/* ---------- 存档校验(保存与读取共用) ---------- */
function validateState(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return { ok: false, error: '存档不是对象' };
  if (s.v !== STATE_VERSION) return { ok: false, error: '存档版本不支持' };
  if (typeof s.generated !== 'boolean') return { ok: false, error: 'generated 须为布尔值' };
  if (s.sample !== undefined && s.sample !== null && (typeof s.sample !== 'string' || s.sample.length < 1 || s.sample.length > 40)) return { ok: false, error: 'sample 须为空或不超过 40 字的文本' };
  const f = s.form;
  if (!f || typeof f !== 'object') return { ok: false, error: '缺少表单' };
  for (const k of ['years', 'drift', 'vol', 'seed', 'amount', 'startMonth', 'threshold', 'quizThreshold']) {
    if (typeof f[k] !== 'string' || f[k].length > LIMITS.fieldMaxLen) return { ok: false, error: `表单字段 ${k} 须为不超过 ${LIMITS.fieldMaxLen} 字的文本` };
  }
  if (f.source !== 'synthetic' && f.source !== 'csv') return { ok: false, error: '数据来源不合法' };
  if (!RULE_TYPES.includes(f.ruleType)) return { ok: false, error: '中断规则不合法' };
  if (!Array.isArray(f.crashes) || f.crashes.length > LIMITS.crashMax) return { ok: false, error: '崩盘列表不合法' };
  for (const c of f.crashes) {
    if (!c || typeof c !== 'object') return { ok: false, error: '崩盘项不合法' };
    for (const k of ['start', 'months', 'drop']) if (typeof c[k] !== 'string' || c[k].length > LIMITS.fieldMaxLen) return { ok: false, error: '崩盘字段须为文本' };
  }
  if (s.csvPrices !== null) {
    if (!Array.isArray(s.csvPrices) || s.csvPrices.length < LIMITS.pricesMin || s.csvPrices.length > LIMITS.pointsMax) return { ok: false, error: 'CSV 价格数量不合法' };
    for (const p of s.csvPrices) if (typeof p !== 'number' || !Number.isFinite(p) || p < LIMITS.priceMin || p > LIMITS.priceMax) return { ok: false, error: 'CSV 价格超出允许范围' };
  }
  const re = validateRecords(s.records);
  if (re) return { ok: false, error: re };
  return { ok: true };
}

/* 价格相对"起始月之后的价格高点"回撤 >= 阈值的连续区间,下标 0 起、含两端 */
function drawdownZones(prices, startMonth, threshold) {
  const zones = [];
  let peak = 0, open = null;
  for (let i = startMonth - 1; i < prices.length; i++) {
    if (prices[i] > peak) peak = prices[i];
    const hit = (1 - prices[i] / peak) * 100 >= threshold - EPS;
    if (hit && open === null) open = i;
    if (!hit && open !== null) { zones.push([open, i - 1]); open = null; }
  }
  if (open !== null) zones.push([open, prices.length - 1]);
  return zones;
}

const api = {
  DISCLAIMER, STATE_VERSION, LIMITS, RULE_TYPES, RULE_LABEL, CHOICES, CHOICE_LABEL,
  mulberry32, checkGenParams, genPrices, drawdown, drawdownZones, dca, lumpSum, lumpVsDca, compareRules,
  newReplay, replayStep, replayResult,
  fmtYuan, fmtPct, guardCell, toCsv, toMarkdown,
  parsePricesCsv, validateImport, validateRecords, mergeRecords, recordsToJson,
  isRealDate, resolveToday, defaultForm, defaultState, parseForm, yuanToCents, validateState
};
globalThis.DcaCore = api;
if (typeof module !== 'undefined') module.exports = api;
