'use strict';
// 项目毛利表 · 纯逻辑层(无 DOM)。金额一律用整数「分」。规则见 SPEC.md 与 README「口径」。
(function () {
  const LIMIT = 1e12; // 单个金额字段上限:100 亿元(保证乘法与求和都在安全整数内)
  const TYPES = [
    { id: 'labor', label: '人工' },
    { id: 'outsource', label: '外包' },
    { id: 'tool', label: '工具与订阅' },
    { id: 'travel', label: '差旅' },
    { id: 'other', label: '其他' }
  ];
  const STATUSES = ['报价中', '进行中', '已交付', '已收款', '已取消'];
  const typeLabel = id => (TYPES.find(t => t.id === id) || {}).label || id;

  // ---------- 基础数值 ----------
  // 非负整数乘除并四舍五入(半入),用 BigInt 避免超过 2^53
  function mulDiv(nums, d) {
    let p = 1n;
    for (const n of nums) p *= BigInt(Math.max(0, Math.round(Number(n) || 0)));
    const den = BigInt(d);
    return Number((p * 2n + den) / (2n * den));
  }
  const int0 = v => (Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

  function netRevenue(quote, taxIncluded, rate) {
    const q = int0(quote);
    if (!taxIncluded) return q;
    const bp = Math.round((Number(rate) || 0) * 100);
    return mulDiv([q, 10000], 10000 + Math.max(0, bp));
  }

  function lineAmount(line) {
    if (!line) return 0;
    if (line.type === 'labor') return mulDiv([line.rate, Math.round((Number(line.hours) || 0) * 100)], 100);
    if (line.type === 'tool') {
      return mulDiv([line.monthlyFee, Math.round((Number(line.months) || 0) * 100), Math.round((Number(line.share) || 0) * 100)], 1000000);
    }
    return int0(line.amount);
  }
  function costTotal(lines) {
    let s = 0;
    for (const l of Array.isArray(lines) ? lines : []) s += lineAmount(l);
    return s;
  }

  function margin(project) {
    const p = project || {};
    const lines = Array.isArray(p.lines) ? p.lines : [];
    const revenue = netRevenue(p.quote, p.taxIncluded, p.taxRate);
    const cost = costTotal(lines);
    const gross = revenue - cost;
    let h100 = 0;
    for (const l of lines) if (l.type === 'labor') h100 += Math.round((Number(l.hours) || 0) * 100);
    const hours = h100 / 100;
    const rate = revenue > 0 ? gross / revenue : null;
    const perHour = h100 > 0 ? Math.round((gross * 100) / h100) : null;
    const opp = int0(p.opportunityHourly);
    const belowOpportunity = perHour !== null && opp > 0 && perHour < opp;
    return { revenue, cost, gross, rate, hours, perHour, belowOpportunity };
  }

  // ---------- 日期(全部在 UTC 时间轴上计算) ----------
  function isRealDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    if (y < 1000) return false;
    return fmtDate(new Date(Date.UTC(y, m - 1, d))) === s;
  }
  function fmtDate(dt) {
    return `${String(dt.getUTCFullYear()).padStart(4, '0')}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  }
  function addDays(s, n) {
    const [y, m, d] = s.split('-').map(Number);
    return fmtDate(new Date(Date.UTC(y, m - 1, d + n)));
  }
  function localDateString(dt) {
    return `${String(dt.getFullYear()).padStart(4, '0')}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }
  // ?today=YYYY-MM-DD 固定今天;不合法(含 2026-02-30 这类会自动进位的)回退真实今天
  function resolveToday(search, realToday) {
    try {
      const q = new URLSearchParams(String(search || '')).get('today');
      if (q && isRealDate(q)) return q;
    } catch (e) { /* 回退 */ }
    return realToday;
  }

  // 预计回款日:预付比例 < 100% 时 = 交付日期 + 账期天数(尾款);预付 100% 时 = 开始日期
  function dueDate(project) {
    const p = project || {};
    const prepaid = Number(p.prepaidPct) || 0;
    if (prepaid >= 100) return isRealDate(p.startDate) ? p.startDate : null;
    if (!isRealDate(p.deliverDate)) return null;
    return addDays(p.deliverDate, Math.max(0, Math.round(Number(p.termDays) || 0)));
  }
  function tailAmount(project) {
    const q = int0(project && project.quote);
    const prepaid = mulDiv([q, Math.round((Number(project && project.prepaidPct) || 0) * 100)], 10000);
    return Math.max(0, q - prepaid);
  }
  // 回款日 < 今天 且 状态非已收款 → 逾期(当天不算);已取消的项目不会回款,不计逾期
  function isOverdue(project, today) {
    if (!project || project.status === '已收款' || project.status === '已取消') return false;
    const due = dueDate(project);
    return !!due && isRealDate(today) && due < today;
  }

  // ---------- 组合视图 ----------
  const nameOf = p => (p.name && p.name.trim()) || '(未命名)';
  const clientOf = p => (p.client && p.client.trim()) || '(未填客户)';
  const active = projects => (Array.isArray(projects) ? projects : []).filter(p => p.status !== '已取消');

  function sumMargins(list) {
    let revenue = 0, cost = 0;
    for (const p of list) { const m = margin(p); revenue += m.revenue; cost += m.cost; }
    const gross = revenue - cost;
    return { count: list.length, revenue, cost, gross, rate: revenue > 0 ? gross / revenue : null };
  }

  function portfolio(projects, today) {
    const all = Array.isArray(projects) ? projects : [];
    const items = active(all).map(p => ({ project: p, m: margin(p), due: dueDate(p), overdue: isOverdue(p, today) }));
    items.sort((a, b) => {
      const ar = a.m.rate, br = b.m.rate;
      if (ar === null && br !== null) return 1;
      if (br === null && ar !== null) return -1;
      if (ar !== br && ar !== null) return br - ar;
      if (a.m.gross !== b.m.gross) return b.m.gross - a.m.gross;
      return nameOf(a.project).localeCompare(nameOf(b.project)) || String(a.project.id).localeCompare(String(b.project.id));
    });
    const ranked = items.filter(i => i.m.rate !== null);
    const worst3 = ranked.slice(-3).reverse();
    const overdue = items.filter(i => i.overdue).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
    let overdueAmount = 0;
    for (const o of overdue) overdueAmount += tailAmount(o.project);
    return {
      items, worst3, overdue, overdueAmount,
      cancelled: all.filter(p => p.status === '已取消'),
      totals: sumMargins(active(all)),
      traits: traitsOf(worst3.map(i => i.project))
    };
  }

  // 只列客观字段(客户、成本类型、时薪、含税),不下结论
  function traitsOf(list) {
    const n = list.length;
    const clients = new Map();
    const types = new Map();
    const rates = [];
    let taxYes = 0;
    for (const p of list) {
      const c = clientOf(p);
      clients.set(c, (clients.get(c) || 0) + 1);
      const seen = new Set();
      let h100 = 0, cost = 0;
      for (const l of p.lines || []) {
        seen.add(l.type);
        if (l.type === 'labor') { const h = Math.round((Number(l.hours) || 0) * 100); h100 += h; cost += lineAmount(l); }
      }
      for (const t of seen) types.set(t, (types.get(t) || 0) + 1);
      if (h100 > 0) rates.push({ name: nameOf(p), hourly: Math.round((cost * 100) / h100) });
      if (p.taxIncluded) taxYes += 1;
    }
    const common = [];
    for (const [c, k] of clients) if (n > 1 && k === n) common.push(`客户都是「${c}」`);
    for (const [t, k] of types) if (n > 1 && k === n) common.push(`都有「${typeLabel(t)}」成本行`);
    if (n > 1 && taxYes === n) common.push('报价都是含税');
    if (n > 1 && taxYes === 0) common.push('报价都是不含税');
    return {
      count: n,
      clients: [...clients].sort((a, b) => b[1] - a[1]),
      costTypes: [...types].map(([id, k]) => ({ id, label: typeLabel(id), count: k })).sort((a, b) => b.count - a.count),
      laborRates: rates,
      taxIncluded: taxYes,
      taxExcluded: n - taxYes,
      common
    };
  }

  function byClient(projects) {
    const map = new Map();
    for (const p of active(projects)) {
      const c = clientOf(p);
      if (!map.has(c)) map.set(c, []);
      map.get(c).push(p);
    }
    const out = [];
    for (const [client, list] of map) {
      const s = sumMargins(list);
      const rates = list.map(p => margin(p).rate).filter(r => r !== null);
      out.push({
        client, count: list.length, revenue: s.revenue, cost: s.cost, gross: s.gross,
        avgRate: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null,
        weightedRate: s.rate
      });
    }
    return out.sort((a, b) => b.revenue - a.revenue || a.client.localeCompare(b.client));
  }

  function quarterOf(dateStr) {
    const [y, m] = dateStr.split('-').map(Number);
    const q = Math.floor((m - 1) / 3) + 1;
    const startM = (q - 1) * 3 + 1;
    const endM = startM + 2;
    const endD = new Date(Date.UTC(y, endM, 0)).getUTCDate();
    const pad = n => String(n).padStart(2, '0');
    return { year: y, q, label: `${y} 年第 ${q} 季度`, start: `${y}-${pad(startM)}-01`, end: `${y}-${pad(endM)}-${pad(endD)}` };
  }
  function prevQuarterOf(qr) {
    return qr.q === 1 ? quarterOf(`${qr.year - 1}-12-01`) : quarterOf(`${qr.year}-${String((qr.q - 2) * 3 + 1).padStart(2, '0')}-01`);
  }
  // 按交付日期归季度;没有交付日期的项目不参与(noDate 计数)
  function quarterCompare(projects, today) {
    const cur = quarterOf(isRealDate(today) ? today : '1970-01-01');
    const prev = prevQuarterOf(cur);
    const list = active(projects);
    const inQ = qr => list.filter(p => isRealDate(p.deliverDate) && p.deliverDate >= qr.start && p.deliverDate <= qr.end);
    const cs = sumMargins(inQ(cur)), ps = sumMargins(inQ(prev));
    return {
      current: Object.assign({ label: cur.label, start: cur.start, end: cur.end }, cs),
      previous: Object.assign({ label: prev.label, start: prev.start, end: prev.end }, ps),
      rateDelta: cs.rate !== null && ps.rate !== null ? cs.rate - ps.rate : null,
      noDate: list.filter(p => !isRealDate(p.deliverDate)).length
    };
  }

  // 季度对比的说明文字:区分「没有项目」与「收入为 0,无法计算毛利率」
  function quarterDeltaNote(q) {
    const cur = q.current, prev = q.previous;
    if (cur.count === 0 && prev.count === 0) return '本季度和上季度都没有项目,无法比较。';
    if (cur.count === 0) return '本季度没有项目,无法比较。';
    if (prev.count === 0) return '上季度没有项目,无法比较。';
    if (q.rateDelta === null) {
      const zero = [];
      if (cur.rate === null) zero.push('本季度');
      if (prev.rate === null) zero.push('上季度');
      return zero.join('和') + '收入为 0,无法计算毛利率,无法比较。';
    }
    return `本季度比上季度${q.rateDelta >= 0 ? '高' : '低'} ${Math.abs(q.rateDelta * 100).toFixed(1)} 个百分点。`;
  }

  // ---------- 情景(纯计算,不改项目) ----------
  function scenario(project, opts) {
    const o = opts || {};
    const disc = Math.min(100, Math.max(0, Number(o.discount) || 0));
    const hourly = Number.isFinite(o.hourly) && o.hourly >= 0 ? Math.round(o.hourly) : null;
    const copy = Object.assign({}, project, {
      quote: mulDiv([int0(project.quote), 10000 - Math.round(disc * 100)], 10000),
      lines: (project.lines || []).map(l => (l.type === 'labor' && hourly !== null ? Object.assign({}, l, { rate: hourly }) : l))
    });
    const base = margin(project);
    const next = margin(copy);
    return {
      base, scenario: next, quote: copy.quote,
      rateDelta: base.rate !== null && next.rate !== null ? next.rate - base.rate : null,
      grossDelta: next.gross - base.gross
    };
  }

  // ---------- 格式化与解析 ----------
  function moneyPlain(cents) {
    const n = Math.round(Number(cents) || 0);
    const abs = Math.abs(n);
    return `${n < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  }
  function formatMoney(cents) {
    const s = moneyPlain(cents);
    const neg = s.startsWith('-');
    const [i, f] = (neg ? s.slice(1) : s).split('.');
    return `${neg ? '-' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${f}`;
  }
  const formatPct = r => (r === null || r === undefined ? '—' : `${(r * 100).toFixed(1)}%`);
  // 金额字符串 → 分;空串=0;非法或超上限=NaN;多于两位小数四舍五入到分
  function parseMoney(str) {
    const s = String(str ?? '').replace(/[,\s¥￥]/g, '');
    if (s === '') return 0;
    const m = /^(\d{1,13})(?:\.(\d+))?$/.exec(s);
    if (!m) return NaN;
    const frac = (m[2] || '').padEnd(3, '0');
    const cents = Number(m[1]) * 100 + Number(frac.slice(0, 2)) + (Number(frac[2]) >= 5 ? 1 : 0);
    return cents <= LIMIT ? cents : NaN;
  }
  function parseNumber(str, opts) {
    const o = Object.assign({ max: 1e6, dp: 2 }, opts);
    const s = String(str ?? '').replace(/[,\s]/g, '');
    if (s === '') return 0;
    if (!/^\d{1,12}(\.\d+)?$/.test(s)) return NaN;
    const k = Math.pow(10, o.dp);
    const v = Math.round(Number(s) * k) / k;
    return v <= o.max ? v : NaN;
  }

  // ---------- 导出(含公式注入防护) ----------
  function guard(v) {
    const s = String(v ?? '');
    if (s === '-' || s === '+') return s;
    return /^[\t\r]*[=+\-@]/.test(s) ? `'${s}` : s;
  }
  const csvCell = v => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  function toCsv(projects, today) {
    const head = ['项目', '客户', '状态', '报价币种', '报价(元)', '含税', '税率(%)', '不含税收入(元)', '直接成本(元)', '毛利(元)', '毛利率(%)', '总人工小时', '每小时毛利(元)', '低于机会成本时薪', '开始日期', '交付日期', '预计回款日', '逾期', '活动基线版本', '基线锁定日', '已知实际分钟', '已知实际成本(元)', '已知实收(元)', '实际完整性声明', '实际截至日', '可比', '收入偏差(元)', '成本偏差(元)', '毛利偏差(元)', '单位来源', '记录类型', '记录日期', '记录ID', '记录币种', '分钟', '时薪(元/小时)', '金额(元)', '来源', '备注', '计入截至日'];
    const rows = [head.map(csvCell).join(',')];
    for (const p of Array.isArray(projects) ? projects : []) {
      const m = margin(p);
      const a = actualComparison(p), b = a.baseline;
      const cells = [
        guard(p.name), guard(p.client), p.status, p.currency || 'CNY', moneyPlain(p.quote), p.taxIncluded ? '是' : '否', p.taxIncluded ? p.taxRate : '',
        moneyPlain(m.revenue), moneyPlain(m.cost), moneyPlain(m.gross), m.rate === null ? '' : (m.rate * 100).toFixed(1),
        m.hours, m.perHour === null ? '' : moneyPlain(m.perHour), m.belowOpportunity ? '是' : '否',
        p.startDate || '', p.deliverDate || '', dueDate(p) || '', isOverdue(p, today) ? '是' : '否',
        b ? b.version : '', b ? b.lockedAt : '', a.known.minutes, moneyPlain(a.known.cost), moneyPlain(a.known.collected),
        a.complete ? '用户声明完整' : '未声明完整', (p.actualCompleteness || {}).asOf || '', a.comparable ? '是' : '否',
        a.variance ? moneyPlain(a.variance.revenue) : '', a.variance ? moneyPlain(a.variance.cost) : '', a.variance ? moneyPlain(a.variance.gross) : '',
        `金额=整数分;工时=整数分钟;实际人工成本=分钟×记录时薪÷60;币种未换算;按币种=${a.knownByCurrency.map(x => `${x.currency}:成本${moneyPlain(x.cost)}/实收${moneyPlain(x.collected)}/分钟${x.minutes}`).join('|')}`,
        '项目汇总', '', '', '', '', '', '', '', '', ''
      ];
      rows.push(cells.map(csvCell).join(','));
      const cutoff = (p.actualCompleteness || {}).asOf || '';
      const detail = (kind, x) => {
        const prefix = [guard(p.name), guard(p.client), p.status, ...Array(27).fill('')];
        const values = kind === '工时'
          ? [kind, x.date, guard(x.id), x.currency, x.minutes, moneyPlain(x.hourlyRate), '', guard(x.source), guard(x.note), !cutoff || x.date <= cutoff ? '是' : '否']
          : [kind, x.date, guard(x.id), x.currency, '', '', moneyPlain(x.amount), guard(x.source), guard(x.note), !cutoff || x.date <= cutoff ? '是' : '否'];
        rows.push([...prefix, ...values].map(csvCell).join(','));
      };
      for (const x of p.actualWork || []) detail('实际工时', x);
      for (const x of p.actualExpenses || []) detail('实际费用', x);
      for (const x of p.actualRevenue || []) detail('实际收款', x);
    }
    return rows.join('\r\n') + '\r\n';
  }

  const mdCell = v => guard(String(v ?? '').replace(/\r?\n|\r/g, ' ')).replace(/\|/g, '\\|');
  function lineFormula(l) {
    if (l.type === 'labor') return `${l.hours} 小时 × ${formatMoney(l.rate)} 元/小时`;
    if (l.type === 'tool') return `月费 ${formatMoney(l.monthlyFee)} 元 × ${l.months} 月 × 分摊 ${l.share}%`;
    return '直接填写';
  }
  function toMarkdown(project, today) {
    const p = project;
    const m = margin(p);
    const due = dueDate(p);
    const title = String(p.name || '(未命名)').replace(/\r?\n|\r/g, ' ');
    const out = [];
    out.push(`# 项目毛利说明:${title}`, '');
    out.push(`- 客户:${mdCell(p.client || '(未填)')}`);
    out.push(`- 状态:${p.status}`);
    out.push(`- 开始 / 交付日期:${p.startDate || '未填'} / ${p.deliverDate || '未填'}`);
    out.push(`- 报价:${formatMoney(p.quote)} 元(${p.taxIncluded ? `含税,税率 ${p.taxRate}%` : '不含税'})`, '');
    out.push('## 结果', '', '| 项目 | 数值 |', '| --- | --- |');
    out.push(`| 不含税收入 | ${formatMoney(m.revenue)} 元 |`, `| 直接成本 | ${formatMoney(m.cost)} 元 |`, `| 毛利 | ${formatMoney(m.gross)} 元 |`);
    out.push(`| 毛利率 | ${formatPct(m.rate)} |`, `| 总人工小时 | ${m.hours} |`, `| 每小时毛利 | ${m.perHour === null ? '—(没有人工小时)' : `${formatMoney(m.perHour)} 元`} |`);
    out.push(`| 机会成本时薪 | ${formatMoney(p.opportunityHourly)} 元 |`, `| 是否低于机会成本时薪 | ${m.belowOpportunity ? '是' : '否'} |`, '');
    out.push('## 成本明细', '');
    if ((p.lines || []).length) {
      out.push('| 类型 | 备注 | 计算 | 金额(元) |', '| --- | --- | --- | --- |');
      for (const l of p.lines) out.push(`| ${typeLabel(l.type)} | ${mdCell(l.note)} | ${lineFormula(l)} | ${formatMoney(lineAmount(l))} |`);
    } else out.push('没有成本行。');
    out.push('', '## 回款', '');
    out.push(`- 预付比例 ${p.prepaidPct}%,尾款账期 ${p.termDays} 天`);
    out.push(`- 预计回款日:${due || '无法计算(缺日期)'}`);
    out.push(`- 逾期:${isOverdue(p, today) ? `是(今天 ${today})` : '否'}`, '');
    const a = actualComparison(p), b = a.baseline;
    out.push('## 估算基线与实际', '');
    out.push(`- 活动估算基线:${b ? `v${b.version},锁定于 ${b.lockedAt}` : '未锁定'}`);
    out.push(`- 基线币种已知实际:工时 ${a.known.minutes} 分钟;成本 ${formatMoney(a.known.cost)} ${a.known.currency};实收 ${formatMoney(a.known.collected)} ${a.known.currency}`);
    if (a.knownByCurrency.length) out.push(`- 按币种原值:${a.knownByCurrency.map(x => `${x.currency} 工时 ${x.minutes} 分钟、成本 ${formatMoney(x.cost)}、实收 ${formatMoney(x.collected)}`).join(';')}`);
    out.push(`- 实际完整性:${a.complete ? `用户声明完整,截至 ${(p.actualCompleteness || {}).asOf}` : '未声明完整;缺失项是未知,不是 0'}`);
    if (a.excludedAfterAsOf) out.push(`- 截至日之后的记录:${a.excludedAfterAsOf} 条,保留在明细中但不计入上述合计和偏差。`);
    out.push(`- 可比性:${a.comparable ? '币种一致' : '存在未换算币种或没有锁定基线'}`);
    out.push(`- 偏差:${a.variance ? `收入 ${formatMoney(a.variance.revenue)}、成本 ${formatMoney(a.variance.cost)}、毛利 ${formatMoney(a.variance.gross)}` : '不显示;只有锁定基线、币种一致且用户声明实际完整时才计算'}`, '');
    out.push('### 实际记录明细', '');
    out.push('| 类型 | 日期 | 币种 | 分钟 | 时薪 / 金额 | 来源 | 备注 | 计入截至日 |', '| --- | --- | --- | ---: | ---: | --- | --- | --- |');
    const cutoff = (p.actualCompleteness || {}).asOf || '';
    const included = x => !cutoff || x.date <= cutoff ? '是' : '否';
    for (const x of p.actualWork || []) out.push(`| 工时 | ${x.date} | ${x.currency} | ${x.minutes} | ${formatMoney(x.hourlyRate)} / 小时 | ${mdCell(x.source)} | ${mdCell(x.note)} | ${included(x)} |`);
    for (const x of p.actualExpenses || []) out.push(`| 费用 | ${x.date} | ${x.currency} |  | ${formatMoney(x.amount)} | ${mdCell(x.source)} | ${mdCell(x.note)} | ${included(x)} |`);
    for (const x of p.actualRevenue || []) out.push(`| 收款 | ${x.date} | ${x.currency} |  | ${formatMoney(x.amount)} | ${mdCell(x.source)} | ${mdCell(x.note)} | ${included(x)} |`);
    if (!(p.actualWork || []).length && !(p.actualExpenses || []).length && !(p.actualRevenue || []).length) out.push('| 无 |  |  |  |  |  |  |  |');
    out.push('');
    out.push('## 口径', '', '- 金额按整数分计算;工具订阅按「月费 × 占用月数 × 分摊比例」,分摊比例是用户自设的近似值。', '- 实际人工成本 = 整数分钟 × 该条记录的时薪 ÷ 60;不同币种不做自动换算。', '- 报价是估算收入;实收记录才是已收金额。本工具不处理应收账款或银行对账。', '- 本说明不是税务或财务申报材料。', '');
    return out.join('\n');
  }

  // ---------- 估算基线与实际记录 ----------
  const ISO_CURRENCY = /^[A-Z]{3}$/;
  const clone = v => JSON.parse(JSON.stringify(v));
  function estimateSnapshot(p) {
    return {
      currency: p.currency || 'CNY', quote: p.quote, taxIncluded: p.taxIncluded, taxRate: p.taxRate,
      opportunityHourly: p.opportunityHourly, lines: clone(p.lines || [])
    };
  }
  function nextBaselineVersion(p) {
    return Math.max(0, ...(p.baselineVersions || []).map(x => x.version || 0)) + 1;
  }
  function lockEstimate(p, date) {
    if (!isRealDate(date)) throw new Error('锁定日期必须是真实存在的 YYYY-MM-DD');
    const versions = clone(p.baselineVersions || []);
    let active = versions.find(x => x.id === p.activeBaselineId);
    if (active && !active.lockedAt) {
      active.estimate = estimateSnapshot(p); active.lockedAt = date;
    } else {
      active = { id: newId(), version: nextBaselineVersion(p), createdAt: date, lockedAt: date, estimate: estimateSnapshot(p) };
      versions.push(active);
    }
    return Object.assign({}, p, { baselineVersions: versions, activeBaselineId: active.id });
  }
  function reopenEstimate(p, baselineId, date) {
    if (!isRealDate(date)) throw new Error('重开日期必须是真实存在的 YYYY-MM-DD');
    const source = (p.baselineVersions || []).find(x => x.id === baselineId && x.lockedAt);
    if (!source) throw new Error('只能从已锁定的估算基线创建新版本');
    const draft = { id: newId(), version: nextBaselineVersion(p), createdAt: date, lockedAt: '', estimate: clone(source.estimate) };
    const e = source.estimate;
    return Object.assign({}, p, {
      currency: e.currency, quote: e.quote, taxIncluded: e.taxIncluded, taxRate: e.taxRate,
      opportunityHourly: e.opportunityHourly, lines: clone(e.lines),
      baselineVersions: [...clone(p.baselineVersions || []), draft], activeBaselineId: draft.id
    });
  }
  function actualComparison(p) {
    const baseline = (p.baselineVersions || []).find(x => x.id === p.activeBaselineId && x.lockedAt);
    const completeness = p.actualCompleteness || { asserted: false, asOf: '', assertedAt: '' };
    const asOf = isRealDate(completeness.asOf) ? completeness.asOf : '';
    const allWork = p.actualWork || [], allExpenses = p.actualExpenses || [], allRevenue = p.actualRevenue || [];
    const within = x => !asOf || x.date <= asOf;
    const work = allWork.filter(within), expenses = allExpenses.filter(within), revenue = allRevenue.filter(within);
    const excludedAfterAsOf = allWork.length + allExpenses.length + allRevenue.length - work.length - expenses.length - revenue.length;
    const currencies = new Set([...work.map(x => x.currency), ...expenses.map(x => x.currency), ...revenue.map(x => x.currency)]);
    const byCurrency = new Map();
    const bucket = currency => {
      if (!byCurrency.has(currency)) byCurrency.set(currency, { currency, minutes: 0, workCost: 0, expenseCost: 0, cost: 0, collected: 0 });
      return byCurrency.get(currency);
    };
    for (const x of work) { const b = bucket(x.currency); b.minutes += x.minutes; b.workCost += mulDiv([x.minutes, x.hourlyRate], 60); }
    for (const x of expenses) bucket(x.currency).expenseCost += x.amount;
    for (const x of revenue) bucket(x.currency).collected += x.amount;
    for (const b of byCurrency.values()) b.cost = b.workCost + b.expenseCost;
    const targetCurrency = baseline ? baseline.estimate.currency : (p.currency || 'CNY');
    const known = clone(byCurrency.get(targetCurrency) || { currency: targetCurrency, minutes: 0, workCost: 0, expenseCost: 0, cost: 0, collected: 0 });
    const knownByCurrency = [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));
    const comparable = !!baseline && [...currencies].every(x => x === baseline.estimate.currency);
    const complete = !!completeness.asserted;
    if (!baseline || !complete || !comparable) return { baseline, known, knownByCurrency, complete, comparable, variance: null, currencies: [...currencies].sort(), asOf, excludedAfterAsOf };
    const estimated = margin(Object.assign({}, p, baseline.estimate));
    const actualGross = known.collected - known.cost;
    return {
      baseline, known, knownByCurrency, complete, comparable, estimated,
      variance: { revenue: known.collected - estimated.revenue, cost: known.cost - estimated.cost, gross: actualGross - estimated.gross, actualGross },
      currencies: [...currencies].sort(), asOf, excludedAfterAsOf
    };
  }

  // ---------- 校验(保存前 = 读取时 = 导入时,同一个函数) ----------
  const isInt = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
  const isDp = (v, max, dp) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max && Math.abs(v * Math.pow(10, dp) - Math.round(v * Math.pow(10, dp))) < 1e-6;
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isDateOrEmpty = v => v === '' || isRealDate(v);

  function validateActualEntry(x, where, kind) {
    if (!isObj(x) || typeof x.id !== 'string' || !x.id) return { error: `${where}缺少有效 id` };
    if (!isRealDate(x.date)) return { error: `${where}日期必须是真实存在的 YYYY-MM-DD` };
    if (typeof x.note !== 'string' || typeof x.source !== 'string') return { error: `${where}来源和备注必须是字符串` };
    if (!ISO_CURRENCY.test(x.currency)) return { error: `${where}币种必须是 3 位大写代码` };
    const out = { id: x.id, date: x.date, currency: x.currency, source: x.source, note: x.note };
    if (kind === 'work') {
      if (!isInt(x.minutes, 1, 10000000)) return { error: `${where}分钟必须是 1 到 10000000 的整数` };
      if (!isInt(x.hourlyRate, 0, LIMIT)) return { error: `${where}时薪必须是整数分` };
      out.minutes = x.minutes; out.hourlyRate = x.hourlyRate;
    } else {
      if (!isInt(x.amount, 1, LIMIT)) return { error: `${where}金额必须是 1 到 ${LIMIT} 的整数分` };
      out.amount = x.amount;
    }
    return { value: out };
  }

  function validateActualList(list, where, kind) {
    if (!Array.isArray(list)) return { error: `${where}必须是数组` };
    const ids = new Set(), out = [];
    for (let i = 0; i < list.length; i++) {
      const r = validateActualEntry(list[i], `${where}第 ${i + 1} 条`, kind);
      if (r.error) return r;
      if (ids.has(r.value.id)) return { error: `${where}id 重复(${r.value.id})` };
      ids.add(r.value.id); out.push(r.value);
    }
    return { value: out };
  }

  function validateLine(l, where) {
    if (!isObj(l)) return { error: `${where}不是对象` };
    if (typeof l.id !== 'string' || !l.id) return { error: `${where}缺少 id` };
    if (!TYPES.some(t => t.id === l.type)) return { error: `${where}成本类型不在枚举内(${String(l.type)})` };
    if (typeof l.note !== 'string') return { error: `${where}备注必须是字符串` };
    const out = { id: l.id, type: l.type, note: l.note };
    if (l.type === 'labor') {
      if (!isDp(l.hours, 1e6, 2)) return { error: `${where}小时数必须是 0 到 1000000、最多两位小数的数字` };
      if (!isInt(l.rate, 0, LIMIT)) return { error: `${where}时薪必须是 0 到 ${LIMIT} 的整数(分)` };
      out.hours = l.hours; out.rate = l.rate;
    } else if (l.type === 'tool') {
      if (!isInt(l.monthlyFee, 0, LIMIT)) return { error: `${where}月费必须是 0 到 ${LIMIT} 的整数(分)` };
      if (!isDp(l.months, 1200, 2)) return { error: `${where}占用月数必须是 0 到 1200、最多两位小数的数字` };
      if (!isDp(l.share, 100, 2)) return { error: `${where}分摊比例必须是 0 到 100、最多两位小数的数字` };
      out.monthlyFee = l.monthlyFee; out.months = l.months; out.share = l.share;
    } else {
      if (!isInt(l.amount, 0, LIMIT)) return { error: `${where}金额必须是 0 到 ${LIMIT} 的整数(分)` };
      out.amount = l.amount;
    }
    if (lineAmount(out) > LIMIT) return { error: `${where}算出的金额超过上限 ${LIMIT} 分` };
    return { value: out };
  }

  function validateProject(p, i) {
    const where = `项目 ${i + 1}`;
    if (!isObj(p)) return { error: `${where}不是对象` };
    if (typeof p.id !== 'string' || !p.id) return { error: `${where}缺少 id` };
    if (typeof p.name !== 'string') return { error: `${where}名称必须是字符串` };
    if (typeof p.client !== 'string') return { error: `${where}客户必须是字符串` };
    if (!isInt(p.quote, 0, LIMIT)) return { error: `${where}报价必须是 0 到 ${LIMIT} 的整数(分)` };
    if (typeof p.taxIncluded !== 'boolean') return { error: `${where}「是否含税」必须是 true 或 false` };
    if (!isDp(p.taxRate, 100, 2)) return { error: `${where}税率必须是 0 到 100、最多两位小数的数字` };
    if (!STATUSES.includes(p.status)) return { error: `${where}状态不在枚举内(${String(p.status)};允许:${STATUSES.join('、')})` };
    if (!isDateOrEmpty(p.startDate)) return { error: `${where}开始日期必须是真实存在的 YYYY-MM-DD 或空串` };
    if (!isDateOrEmpty(p.deliverDate)) return { error: `${where}交付日期必须是真实存在的 YYYY-MM-DD 或空串` };
    if (!isDp(p.prepaidPct, 100, 2)) return { error: `${where}预付比例必须是 0 到 100、最多两位小数的数字` };
    if (!isInt(p.termDays, 0, 3650)) return { error: `${where}账期天数必须是 0 到 3650 的整数` };
    if (!isInt(p.opportunityHourly, 0, LIMIT)) return { error: `${where}机会成本时薪必须是 0 到 ${LIMIT} 的整数(分)` };
    if (!Array.isArray(p.lines)) return { error: `${where}成本行必须是数组` };
    const ids = new Set();
    const lines = [];
    for (let j = 0; j < p.lines.length; j++) {
      const r = validateLine(p.lines[j], `${where} 第 ${j + 1} 条成本行`);
      if (r.error) return r;
      if (ids.has(r.value.id)) return { error: `${where}成本行 id 重复(${r.value.id})` };
      ids.add(r.value.id);
      lines.push(r.value);
    }
    if (costTotal(lines) > LIMIT * 100) return { error: `${where}成本合计超过上限` };
    const currency = p.currency === undefined ? 'CNY' : p.currency;
    if (!ISO_CURRENCY.test(currency)) return { error: `${where}币种必须是 3 位大写代码` };
    const baselines = p.baselineVersions === undefined ? [] : p.baselineVersions;
    if (!Array.isArray(baselines)) return { error: `${where}baselineVersions 必须是数组` };
    const baselineIds = new Set(), versionNumbers = new Set(), baselineVersions = [];
    for (let j = 0; j < baselines.length; j++) {
      const b = baselines[j], bw = `${where} 第 ${j + 1} 个估算版本`;
      if (!isObj(b) || typeof b.id !== 'string' || !b.id || baselineIds.has(b.id)) return { error: `${bw}id 缺失或重复` };
      if (!isInt(b.version, 1, 1000000) || !isRealDate(b.createdAt) || !(b.lockedAt === '' || isRealDate(b.lockedAt))) return { error: `${bw}版本或日期不合法` };
      if (versionNumbers.has(b.version)) return { error: `${where}估算版本号重复(v${b.version})` };
      if (b.lockedAt && b.lockedAt < b.createdAt) return { error: `${bw}锁定日期不能早于创建日期` };
      if (!isObj(b.estimate) || !ISO_CURRENCY.test(b.estimate.currency)) return { error: `${bw}估算快照或币种不合法` };
      const snap = Object.assign({}, p, b.estimate, { baselineVersions: [], actualWork: [], actualExpenses: [], actualRevenue: [] });
      const sr = validateProjectSnapshot(snap, bw);
      if (sr.error) return sr;
      baselineIds.add(b.id); versionNumbers.add(b.version); baselineVersions.push({ id: b.id, version: b.version, createdAt: b.createdAt, lockedAt: b.lockedAt, estimate: sr.value });
    }
    const activeBaselineId = p.activeBaselineId === undefined ? '' : p.activeBaselineId;
    if (typeof activeBaselineId !== 'string' || (activeBaselineId && !baselineIds.has(activeBaselineId))) return { error: `${where}activeBaselineId 不存在` };
    const aw = validateActualList(p.actualWork === undefined ? [] : p.actualWork, `${where}实际工时`, 'work'); if (aw.error) return aw;
    const ae = validateActualList(p.actualExpenses === undefined ? [] : p.actualExpenses, `${where}实际费用`, 'money'); if (ae.error) return ae;
    const ar = validateActualList(p.actualRevenue === undefined ? [] : p.actualRevenue, `${where}实收记录`, 'money'); if (ar.error) return ar;
    const allActualIds = new Set();
    for (const x of [...aw.value, ...ae.value, ...ar.value]) { if (allActualIds.has(x.id)) return { error: `${where}实际记录 id 跨类型重复(${x.id})` }; allActualIds.add(x.id); }
    const ac = p.actualCompleteness === undefined ? { asserted: false, asOf: '', assertedAt: '' } : p.actualCompleteness;
    if (!isObj(ac) || typeof ac.asserted !== 'boolean' || !isDateOrEmpty(ac.asOf) || !isDateOrEmpty(ac.assertedAt)) return { error: `${where}实际完整性声明不合法` };
    if (ac.asserted) {
      const currentDate = localDateString(new Date());
      if (!isRealDate(ac.asOf) || !isRealDate(ac.assertedAt)) return { error: `${where}声明完整时必须填写真实的截至日和声明日` };
      if (ac.asOf > ac.assertedAt) return { error: `${where}实际截至日不能晚于声明日` };
      if (ac.assertedAt > currentDate) return { error: `${where}完整性声明日不能晚于今天` };
    }
    return {
      value: {
        id: p.id, name: p.name, client: p.client, quote: p.quote, taxIncluded: p.taxIncluded, taxRate: p.taxRate, status: p.status,
        startDate: p.startDate, deliverDate: p.deliverDate, prepaidPct: p.prepaidPct, termDays: p.termDays,
        opportunityHourly: p.opportunityHourly, lines, currency, baselineVersions, activeBaselineId,
        actualWork: aw.value, actualExpenses: ae.value, actualRevenue: ar.value,
        actualCompleteness: { asserted: ac.asserted, asOf: ac.asOf, assertedAt: ac.assertedAt }
      }
    };
  }

  function validateProjectSnapshot(p, where) {
    if (!isInt(p.quote, 0, LIMIT) || typeof p.taxIncluded !== 'boolean' || !isDp(p.taxRate, 100, 2) || !isInt(p.opportunityHourly, 0, LIMIT)) return { error: `${where}估算金额字段不合法` };
    if (!Array.isArray(p.lines)) return { error: `${where}成本行必须是数组` };
    const ids = new Set(), lines = [];
    for (let i = 0; i < p.lines.length; i++) { const r = validateLine(p.lines[i], `${where} 第 ${i + 1} 条成本行`); if (r.error) return r; if (ids.has(r.value.id)) return { error: `${where}成本行 id 重复` }; ids.add(r.value.id); lines.push(r.value); }
    return { value: { currency: p.currency, quote: p.quote, taxIncluded: p.taxIncluded, taxRate: p.taxRate, opportunityHourly: p.opportunityHourly, lines } };
  }

  function validateState(s) {
    if (!isObj(s)) return { ok: false, error: '顶层必须是对象' };
    if (s.version !== 1 && s.version !== 2) return { ok: false, error: `不支持的 version(${String(s.version)}),需要 1 或 2` };
    if (!isObj(s.settings) || !isInt(s.settings.opportunityHourly, 0, LIMIT)) return { ok: false, error: 'settings.opportunityHourly 必须是 0 到 ' + LIMIT + ' 的整数(分)' };
    if (!Array.isArray(s.projects)) return { ok: false, error: 'projects 必须是数组' };
    const ids = new Set();
    const projects = [];
    for (let i = 0; i < s.projects.length; i++) {
      const r = validateProject(s.projects[i], i);
      if (r.error) return { ok: false, error: r.error };
      if (ids.has(r.value.id)) return { ok: false, error: `项目 id 重复(${r.value.id})` };
      ids.add(r.value.id);
      projects.push(r.value);
    }
    return { ok: true, state: { version: 2, settings: { opportunityHourly: s.settings.opportunityHourly }, projects } };
  }

  // 导入:字符串或对象;任何不合法都整份拒绝并说明原因,不做静默修正
  function validateImport(input) {
    let obj = input;
    if (typeof input === 'string') {
      try { obj = JSON.parse(input); } catch (e) { return { ok: false, error: 'JSON 解析失败:' + e.message }; }
    }
    return validateState(obj);
  }

  // ---------- 构造 ----------
  let seq = 0;
  function newId(prefix) {
    seq += 1;
    return `${prefix || 'id'}-${Date.now().toString(36)}-${seq.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  }
  function newLine(type, opportunityHourly) {
    const base = { id: newId('l'), type, note: '' };
    if (type === 'labor') return Object.assign(base, { hours: 0, rate: int0(opportunityHourly) });
    if (type === 'tool') return Object.assign(base, { monthlyFee: 0, months: 1, share: 100 });
    return Object.assign(base, { amount: 0 });
  }
  function newProject(opportunityHourly, today) {
    return {
      id: newId('p'), name: '', client: '', quote: 0, taxIncluded: false, taxRate: 6, status: '报价中',
      startDate: isRealDate(today) ? today : '', deliverDate: '', prepaidPct: 0, termDays: 30,
      opportunityHourly: int0(opportunityHourly), lines: [], currency: 'CNY', baselineVersions: [], activeBaselineId: '',
      actualWork: [], actualExpenses: [], actualRevenue: [], actualCompleteness: { asserted: false, asOf: '', assertedAt: '' }
    };
  }

  const api = {
    LIMIT, TYPES, STATUSES, typeLabel, mulDiv,
    netRevenue, lineAmount, costTotal, margin, dueDate, tailAmount, isOverdue, portfolio, byClient, quarterCompare, quarterOf, scenario,
    isRealDate, quarterDeltaNote, addDays, localDateString, resolveToday,
    moneyPlain, formatMoney, formatPct, parseMoney, parseNumber,
    guard, toCsv, toMarkdown, validateState, validateImport, newId, newLine, newProject, nameOf, clientOf,
    estimateSnapshot, lockEstimate, reopenEstimate, actualComparison
  };
  globalThis.MarginCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
