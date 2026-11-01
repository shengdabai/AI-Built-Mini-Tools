'use strict';
/* 应收账款跟进清单 · 纯逻辑。不访问 document / window,Node 下可直接 require。 */

const BUCKETS = [
  { key: 'current', label: '未到期' },
  { key: 'd1_30', label: '逾期 1–30 天' },
  { key: 'd31_60', label: '逾期 31–60 天' },
  { key: 'd61_90', label: '逾期 61–90 天' },
  { key: 'd90p', label: '逾期 90 天以上' }
];

const DEFAULT_TEMPLATE = '{客户}您好:账单 {账单号} 应收 {金额},到期日 {到期日},目前已逾期 {逾期天数} 天。麻烦您确认付款安排,如已付款请忽略并告知到账时间。谢谢!';
const DEFAULT_N = 7;
const MAX_MONEY = 9000000000000;
const FIELD_KEYS = ['client', 'no', 'issueDate', 'dueDate', 'amount', 'currency', 'paid', 'dispute', 'lastFollow'];

/* ---------- 数字与日期 ---------- */
function cents(x) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return NaN;
  const scaled = x * 100;
  const rounded = Math.round(scaled);
  return Number.isSafeInteger(rounded) && Math.abs(scaled - rounded) < 1e-6 ? rounded : NaN;
}
function round2(x) { const c = cents(x); return Number.isSafeInteger(c) ? c / 100 : NaN; }
function hasAtMostTwoDecimals(x) { return Number.isSafeInteger(cents(x)); }
function isMoney(x) { return typeof x === 'number' && Number.isFinite(x) && hasAtMostTwoDecimals(x); }
function isSupportedMoney(x) { return isMoney(x) && Math.abs(x) <= MAX_MONEY; }
function safeAddCents(a, b) {
  const sum = a + b;
  return Number.isSafeInteger(a) && Number.isSafeInteger(b) && Number.isSafeInteger(sum) ? sum : null;
}

function formatMoney(n) {
  const s = Number(n).toFixed(2);
  const parts = s.split('.');
  return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + parts[1];
}

/* 宽松解析:接受 2026/10/5、2026.10.05、全角数字;返回规范 YYYY-MM-DD,非法返回 null */
function parseDate(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s.normalize('NFKC').trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return t.toISOString().slice(0, 10);
}
function isIsoDate(s) { return typeof s === 'string' && parseDate(s) === s; }
function dayNum(s) {
  const p = s.split('-');
  return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])) / 86400000;
}
function daysBetween(a, b) { return dayNum(b) - dayNum(a); }
function addDays(s, k) { return new Date((dayNum(s) + k) * 86400000).toISOString().slice(0, 10); }

/* ?today=YYYY-MM-DD 固定今天;格式或日期非法时回退 realToday,不抛错 */
function resolveToday(search, realToday) {
  try {
    const v = new URLSearchParams(String(search || '')).get('today');
    if (v && isIsoDate(v)) return v;
  } catch (e) { /* 回退 */ }
  return realToday;
}

/* ---------- 账龄 ---------- */
function balance(bill) { return (cents(bill.amount) - cents(bill.paid || 0)) / 100; }

function overdueDays(bill, today) { return daysBetween(bill.dueDate, today); }

function bucketKey(days) {
  if (days <= 0) return 'current';
  if (days <= 30) return 'd1_30';
  if (days <= 60) return 'd31_60';
  if (days <= 90) return 'd61_90';
  return 'd90p';
}

/* 余额 <= 0 的账单不入账龄,返回 null */
function ageBucket(bill, today) {
  if (balance(bill) <= 0) return null;
  return bucketKey(overdueDays(bill, today));
}
function bucketLabel(key) {
  const b = BUCKETS.find((x) => x.key === key);
  return b ? b.label : key;
}

function agingReport(bills, today) {
  const groups = new Map();
  for (const bill of bills) {
    const key = ageBucket(bill, today);
    if (key === null) continue;
    let g = groups.get(bill.currency);
    if (!g) {
      g = { currency: bill.currency, total: 0, count: 0, cents: 0, buckets: BUCKETS.map((b) => ({ key: b.key, label: b.label, amount: 0, count: 0, cents: 0 })), items: [] };
      groups.set(bill.currency, g);
    }
    const c = cents(balance(bill));
    const bk = g.buckets.find((b) => b.key === key);
    const nextBucket = safeAddCents(bk.cents, c);
    const nextGroup = safeAddCents(g.cents, c);
    if (nextBucket === null || nextGroup === null || nextGroup > cents(MAX_MONEY)) return { today, groups: [], error: '单一币种的账龄汇总超过 ' + formatMoney(MAX_MONEY) + ',已停止汇总和导出;请拆分数据' };
    bk.cents = nextBucket; bk.count += 1;
    g.cents = nextGroup; g.count += 1;
    g.items.push({ bill, balance: c / 100, overdue: overdueDays(bill, today), bucket: key });
  }
  const list = Array.from(groups.values()).sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
  list.forEach((g) => {
    g.total = g.cents / 100;
    g.buckets.forEach((b) => { b.amount = b.cents / 100; });
    g.items.sort((x, y) => y.overdue - x.overdue || (x.bill.client < y.bill.client ? -1 : x.bill.client > y.bill.client ? 1 : 0));
  });
  return { today, groups: list };
}

/* ---------- 跟进清单 ---------- */
function isDisputed(bill) { return typeof bill.dispute === 'string' && bill.dispute.trim() !== ''; }

/* 只列余额 > 0 且已逾期的账单,按逾期天数降序。
   needsFollow = 未争议 且 (从未跟进 或 距最近跟进 >= n 天);争议账单永远不进自动提醒。 */
function followUpList(bills, today, n) {
  const gap = Number.isInteger(n) && n >= 0 ? n : DEFAULT_N;
  const out = [];
  bills.forEach((bill) => {
    if (balance(bill) <= 0) return;
    const overdue = overdueDays(bill, today);
    if (overdue <= 0) return;
    const disputed = isDisputed(bill);
    const since = bill.lastFollow ? daysBetween(bill.lastFollow, today) : null;
    const needsFollow = !disputed && (since === null || since >= gap);
    out.push({
      bill, balance: balance(bill), overdue, bucket: bucketKey(overdue), disputed,
      daysSinceFollow: since, needsFollow,
      status: disputed ? 'disputed' : needsFollow ? 'today' : 'recent'
    });
  });
  out.sort((a, b) => b.overdue - a.overdue || (a.bill.no < b.bill.no ? -1 : a.bill.no > b.bill.no ? 1 : 0));
  return out;
}

/* 占位符一次性替换(函数替换,值里出现的 {…} 或 $& 不会被再次展开);未知占位符原样保留 */
function draft(template, bill, today) {
  const values = {
    '客户': bill.client,
    '账单号': bill.no,
    '金额': bill.currency + ' ' + formatMoney(balance(bill)),
    '到期日': bill.dueDate,
    '逾期天数': String(Math.max(0, overdueDays(bill, today)))
  };
  return String(template).replace(/\{(客户|账单号|金额|到期日|逾期天数)\}/g, (all, k) => values[k]);
}

/* ---------- 变更(返回新对象,不改入参) ---------- */
function addPayment(bill, payment) {
  const base = deriveBill(bill);
  const date = payment && parseDate(payment.date);
  if (!date) return { ok: false, error: '收款日期不是有效日期(格式 YYYY-MM-DD)' };
  const amt = payment.amount;
  if (!isSupportedMoney(amt) || amt <= 0) return { ok: false, error: '收款金额必须是大于 0、不超过系统金额上限且最多两位小数的数字;退款或冲销不能填负数' };
  const nextPaidCents = safeAddCents(cents(base.paid || 0), cents(amt));
  if (nextPaidCents === null) return { ok: false, error: '已收合计超过安全计算范围,未登记这笔收款' };
  if (nextPaidCents > cents(base.amount)) {
    return { ok: false, error: '已收合计会超过应收金额,当前余额只有 ' + formatMoney(balance(base)) + ' ' + base.currency };
  }
  const next = Object.assign({}, base, {
    paid: nextPaidCents / 100,
    payments: base.payments.concat([{ date, amount: amt }])
  });
  return { ok: true, bill: next };
}

function recordFollow(bill, follow) {
  const base = deriveBill(bill);
  const date = follow && parseDate(follow.date);
  if (!date) return { ok: false, error: '跟进日期不是有效日期(格式 YYYY-MM-DD)' };
  const note = String((follow && follow.note) || '').trim();
  const follows = base.follows.concat([{ date, note }]);
  const last = follows.reduce((m, f) => (f.date > m ? f.date : m), base.lastFollow || '');
  return { ok: true, bill: Object.assign({}, base, { follows, lastFollow: last }) };
}

function paymentTotal(payments) {
  let sum = 0;
  for (const p of payments) {
    const next = safeAddCents(sum, cents(p.amount));
    if (next === null) return NaN;
    sum = next;
  }
  return sum / 100;
}
function latestFollow(follows, opening) {
  return follows.reduce((latest, f) => (f.date > latest ? f.date : latest), opening || '');
}
function deriveBill(bill) {
  const payments = Array.isArray(bill.payments) ? bill.payments : [];
  const follows = Array.isArray(bill.follows) ? bill.follows : [];
  const openingPaid = bill.openingPaid == null ? (payments.length ? 0 : Number(bill.paid || 0)) : bill.openingPaid;
  const openingLastFollow = bill.openingLastFollow == null ? (follows.length ? '' : String(bill.lastFollow || '')) : bill.openingLastFollow;
  const derivedPaidCents = safeAddCents(cents(openingPaid), cents(paymentTotal(payments)));
  return Object.assign({}, bill, {
    openingPaid,
    openingLastFollow,
    paid: derivedPaidCents === null ? NaN : derivedPaidCents / 100,
    lastFollow: latestFollow(follows, openingLastFollow)
  });
}

/* ---------- 录入 ---------- */
function parseMoney(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  const s = String(v == null ? '' : v).normalize('NFKC').trim().replace(/^[¥￥$€£]/, '').replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

/* 由表单/批量/CSV 的原始字段构建账单(不含 id);existing 存在时保留其 id、收款记录与跟进记录 */
function buildBill(f, existing) {
  const client = String(f.client == null ? '' : f.client).trim();
  const no = String(f.no == null ? '' : f.no).trim();
  if (!client) return { ok: false, error: '客户不能为空' };
  if (!no) return { ok: false, error: '账单号不能为空' };
  const dueDate = parseDate(String(f.dueDate == null ? '' : f.dueDate));
  if (!dueDate) return { ok: false, error: '到期日不是有效日期:' + String(f.dueDate == null ? '' : f.dueDate).trim() };
  let issueDate = '';
  if (String(f.issueDate == null ? '' : f.issueDate).trim() !== '') {
    issueDate = parseDate(String(f.issueDate));
    if (!issueDate) return { ok: false, error: '开票日不是有效日期:' + String(f.issueDate).trim() };
    if (issueDate > dueDate) return { ok: false, error: '到期日早于开票日' };
  }
  const amount = parseMoney(f.amount);
  if (!(amount > 0) || !isSupportedMoney(amount)) return { ok: false, error: '应收金额必须是大于 0、不超过系统金额上限且最多两位小数的数字' };
  const paidRaw = String(f.paid == null ? '' : f.paid).trim();
  const enteredPaid = paidRaw === '' ? 0 : parseMoney(f.paid);
  const normalizedExisting = existing ? deriveBill(existing) : null;
  const paid = normalizedExisting ? normalizedExisting.paid : enteredPaid;
  if (!(paid >= 0) || !isSupportedMoney(paid)) return { ok: false, error: '迁移前已收必须是不小于 0、不超过系统金额上限且最多两位小数的数字' };
  if (cents(paid) > cents(amount)) return { ok: false, error: '已收金额大于应收金额' };
  const curRaw = String(f.currency == null ? '' : f.currency).normalize('NFKC').trim().toUpperCase();
  const currency = curRaw === '' ? 'CNY' : curRaw;
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: '币种需要是 3 位字母代码,例如 CNY、USD' };
  let enteredLastFollow = '';
  if (String(f.lastFollow == null ? '' : f.lastFollow).trim() !== '') {
    enteredLastFollow = parseDate(String(f.lastFollow));
    if (!enteredLastFollow) return { ok: false, error: '迁移前最近跟进日期不是有效日期:' + String(f.lastFollow).trim() };
  }
  const bill = {
    id: existing ? existing.id : '',
    client, no, issueDate, dueDate, amount: round2(amount), currency, paid: round2(paid),
    dispute: String(f.dispute == null ? '' : f.dispute).trim(),
    lastFollow: normalizedExisting ? normalizedExisting.lastFollow : enteredLastFollow,
    openingPaid: normalizedExisting ? normalizedExisting.openingPaid : round2(enteredPaid),
    openingLastFollow: normalizedExisting ? normalizedExisting.openingLastFollow : enteredLastFollow,
    payments: existing ? existing.payments.slice() : [],
    follows: existing ? existing.follows.slice() : []
  };
  return { ok: true, bill };
}

function billKey(b) { return b.client + '\u0000' + b.no; }

function makeId(bills) {
  const used = new Set(bills.map((b) => b.id));
  let n = bills.length + 1;
  while (used.has('b' + n)) n += 1;
  return 'b' + n;
}

/* 把一批已构建的账单并入现有列表:客户+账单号重复的跳过并说明原因 */
function mergeBills(existing, incoming) {
  const keys = new Set(existing.map(billKey));
  const bills = existing.slice();
  const skipped = [];
  incoming.forEach((b) => {
    if (keys.has(billKey(b))) { skipped.push({ client: b.client, no: b.no, reason: '客户 + 账单号已存在' }); return; }
    keys.add(billKey(b));
    bills.push(Object.assign({}, b, { id: makeId(bills) }));
  });
  return { bills, added: bills.length - existing.length, skipped };
}

/* 批量粘贴:客户 | 账单号 | 到期日 | 应收 | 已收(已收可省略);分隔符 | ｜ 或制表符 */
function parseBatch(text, currency) {
  const rows = [];
  const errors = [];
  String(text == null ? '' : text).split(/\r?\n/).forEach((line, i) => {
    if (line.trim() === '') return;
    const cols = line.split(/[|｜\t]/).map((c) => c.trim());
    if (cols.length < 4 || cols.length > 5) {
      errors.push({ line: i + 1, text: line, reason: '需要 4 或 5 列:客户 | 账单号 | 到期日 | 应收 | 已收,实际 ' + cols.length + ' 列' });
      return;
    }
    const r = buildBill({ client: cols[0], no: cols[1], dueDate: cols[2], amount: cols[3], paid: cols[4] || '', currency });
    if (!r.ok) { errors.push({ line: i + 1, text: line, reason: r.error }); return; }
    rows.push(r.bill);
  });
  return { rows, errors };
}

/* ---------- CSV 解析与列映射 ---------- */
function parseCsv(text) {
  let s = String(text == null ? '' : text);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const firstLine = s.split(/\r?\n/)[0] || '';
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  const delim = tabs > commas ? '\t' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i += 1; } else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (q) return { headers: [], rows: [], error: 'CSV 里有引号没有闭合,整份文件被拒绝。请检查最后一个带引号的字段。' };
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  if (rows.length === 0) return { headers: [], rows: [] };
  return { headers: rows[0].map((h) => h.trim()), rows: rows.slice(1) };
}

const HEADER_GUESS = {
  client: ['客户', '客户名称', '公司', 'client', 'customer'],
  no: ['账单号', '发票号', '单号', 'invoice', 'invoice no', 'no'],
  issueDate: ['开票日', '开票日期', 'issue date', 'issued'],
  dueDate: ['到期日', '到期日期', '付款期限', 'due', 'due date'],
  amount: ['应收', '应收金额', '金额', 'amount', 'total'],
  currency: ['币种', '货币', 'currency', 'cur'],
  paid: ['已收', '已收金额', 'paid', 'received'],
  dispute: ['争议', '争议备注', '备注', 'dispute', 'note'],
  lastFollow: ['最近跟进', '最近跟进日期', '跟进日期', 'last follow', 'last follow-up']
};
function guessMapping(headers) {
  const map = {};
  const norm = headers.map((h) => h.normalize('NFKC').trim().toLowerCase());
  FIELD_KEYS.forEach((k) => {
    map[k] = norm.findIndex((h) => HEADER_GUESS[k].includes(h));
  });
  return map;
}
/* mapping: {字段: 列下标或 -1};client/no/dueDate/amount 必须映射 */
function mapCsv(table, mapping, defaultCurrency) {
  if (table.error) return { ok: false, rows: [], errors: [{ line: 0, text: '', reason: table.error }] };
  const need = { client: '客户', no: '账单号', dueDate: '到期日', amount: '应收' };
  const missing = Object.keys(need).filter((k) => !(Number.isInteger(mapping[k]) && mapping[k] >= 0 && mapping[k] < table.headers.length));
  if (missing.length) return { ok: false, rows: [], errors: [{ line: 0, text: '', reason: '必须为以下字段选择列:' + missing.map((k) => need[k]).join('、') }] };
  const rows = [];
  const errors = [];
  table.rows.forEach((cols, i) => {
    const f = {};
    FIELD_KEYS.forEach((k) => {
      const idx = mapping[k];
      f[k] = Number.isInteger(idx) && idx >= 0 && idx < cols.length ? cols[idx] : '';
    });
    if (String(f.currency).trim() === '') f.currency = defaultCurrency;
    const r = buildBill(f);
    if (!r.ok) errors.push({ line: i + 2, text: cols.join(','), reason: r.error });
    else rows.push(r.bill);
  });
  return { ok: errors.length === 0 && rows.length > 0, rows, errors };
}

/* ---------- 导出 ---------- */
/* 公式注入防护:以 = + - @ 开头的字符串前加单引号;单独的 - 或 + 不算 */
function guardFormula(s) {
  return /^[=+\-@]/.test(s) && s !== '-' && s !== '+' ? "'" + s : s;
}
function csvCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  const s = guardFormula(String(v));
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(headers, rows) {
  return [headers].concat(rows).map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
function mdCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  return guardFormula(String(v)).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
function mdTable(headers, rows) {
  const lines = ['| ' + headers.map(mdCell).join(' | ') + ' |', '| ' + headers.map(() => '---').join(' | ') + ' |'];
  rows.forEach((r) => lines.push('| ' + r.map(mdCell).join(' | ') + ' |'));
  return lines.join('\n');
}

function agingCsv(report, mode) {
  if (report.error) throw new Error(report.error);
  if (mode === 'detail') {
    const rows = [];
    report.groups.forEach((g) => g.items.slice().sort((a, b) => BUCKETS.findIndex((x) => x.key === a.bucket) - BUCKETS.findIndex((x) => x.key === b.bucket) || b.overdue - a.overdue)
      .forEach((it) => rows.push([g.currency, bucketLabel(it.bucket), it.bill.client, it.bill.no, it.bill.dueDate, Math.max(0, it.overdue), it.bill.amount, it.bill.paid, it.balance])));
    return toCsv(['币种', '账龄', '客户', '账单号', '到期日', '逾期天数', '应收', '已收', '余额'], rows);
  }
  const rows = [];
  report.groups.forEach((g) => {
    g.buckets.forEach((b) => rows.push([g.currency, b.label, b.count, b.amount]));
    rows.push([g.currency, '合计', g.count, g.total]);
  });
  return toCsv(['币种', '账龄', '笔数', '金额'], rows);
}

function followCsv(list, today, template) {
  const rows = list.map((it) => [
    it.bill.client, it.bill.no, it.bill.currency, it.bill.dueDate, it.overdue, it.balance,
    it.bill.lastFollow || '', it.daysSinceFollow === null ? '' : it.daysSinceFollow,
    it.status === 'today' ? '今天要跟' : it.status === 'disputed' ? '有争议,人工处理' : '近期已跟进',
    it.bill.dispute,
    it.status === 'today' ? draft(template, it.bill, today) : ''
  ]);
  return toCsv(['客户', '账单号', '币种', '到期日', '逾期天数', '余额', '最近跟进', '距上次跟进天数', '状态', '争议备注', '提醒草稿'], rows);
}

function toMarkdown(report) {
  if (report.error) throw new Error(report.error);
  const out = ['# 应收账款账龄表', '', '基准日:' + report.today, ''];
  if (report.groups.length === 0) { out.push('没有余额大于 0 的账单。'); return out.join('\n') + '\n'; }
  report.groups.forEach((g) => {
    out.push('## ' + g.currency, '');
    out.push(mdTable(['账龄', '笔数', '金额'], g.buckets.map((b) => [b.label, b.count, formatMoney(b.amount)]).concat([['合计', g.count, formatMoney(g.total)]])));
    out.push('', '### 明细(按逾期天数降序)', '');
    out.push(mdTable(['客户', '账单号', '到期日', '逾期天数', '账龄', '余额'],
      g.items.map((it) => [it.bill.client, it.bill.no, it.bill.dueDate, Math.max(0, it.overdue), bucketLabel(it.bucket), formatMoney(it.balance)])));
    out.push('');
  });
  out.push('各币种分开汇总,未做汇率换算。');
  return out.join('\n') + '\n';
}

/* 设置校验:输入框、保存前、导入读取共用同一个函数,避免写得进去读不回来 */
const TEMPLATE_MAX = 2000;
function validateSettings(s) {
  if (!isPlainObjectEarly(s)) return 'settings 必须是对象';
  if (typeof s.template !== 'string' || s.template.trim() === '' || s.template.length > TEMPLATE_MAX) return '提醒模板必须是 1 到 ' + TEMPLATE_MAX + ' 字的文本';
  if (!Number.isInteger(s.n) || s.n < 0 || s.n > 365) return '跟进间隔必须是 0 到 365 的整数';
  return null;
}
function isPlainObjectEarly(v) { return Object.prototype.toString.call(v) === '[object Object]'; }

/* ---------- JSON 备份与校验(不合法就整份拒绝,不静默修正) ---------- */
function isPlainObject(v) { return Object.prototype.toString.call(v) === '[object Object]'; }

function validateBill(b, i) {
  const at = '第 ' + (i + 1) + ' 条账单';
  if (!isPlainObject(b)) return at + '不是对象';
  if (typeof b.id !== 'string' || b.id === '') return at + '缺少 id';
  const strs = ['client', 'no', 'currency', 'dispute'];
  for (const k of strs) if (typeof b[k] !== 'string') return at + '字段 ' + k + ' 必须是文本';
  if (b.client.trim() === '' || b.no.trim() === '') return at + '客户和账单号不能为空';
  if (!/^[A-Z]{3}$/.test(b.currency)) return at + '币种必须是 3 位大写字母代码';
  if (!isIsoDate(b.dueDate)) return at + '到期日不是 YYYY-MM-DD';
  if (b.issueDate !== '' && !isIsoDate(b.issueDate)) return at + '开票日不是 YYYY-MM-DD 或空';
  if (b.lastFollow !== '' && !isIsoDate(b.lastFollow)) return at + '最近跟进不是 YYYY-MM-DD 或空';
  if (!isSupportedMoney(b.amount) || b.amount <= 0) return at + '应收金额必须是大于 0、不超过系统金额上限且最多两位小数的数字';
  if (!isSupportedMoney(b.paid) || b.paid < 0 || cents(b.paid) > cents(b.amount)) return at + '已收金额必须在 0 到应收金额之间';
  if (!Array.isArray(b.payments)) return at + '收款记录必须是数组';
  for (const p of b.payments) {
    if (!isPlainObject(p) || !isIsoDate(p.date) || !isSupportedMoney(p.amount) || p.amount <= 0) return at + '收款记录格式不对;退款或冲销不能用负数收款表示';
  }
  if (!Array.isArray(b.follows)) return at + '跟进记录必须是数组';
  for (const f of b.follows) {
    if (!isPlainObject(f) || !isIsoDate(f.date) || typeof f.note !== 'string') return at + '跟进记录格式不对';
  }
  return null;
}

function normalizeImportedBill(b, i, version) {
  const at = '第 ' + (i + 1) + ' 条账单';
  let openingPaid;
  let openingLastFollow;
  if (version === 1) {
    const eventPaid = paymentTotal(b.payments);
    const eventLast = latestFollow(b.follows, '');
    if (!Number.isFinite(eventPaid)) return { error: at + '收款记录合计超过安全计算范围' };
    if (b.payments.length && cents(b.paid) < cents(eventPaid)) return { error: at + '已收金额小于收款记录合计,两者矛盾;请先核对' };
    if (b.follows.length && b.lastFollow < eventLast) return { error: at + '最近跟进日期早于跟进记录的最晚日期,两者矛盾;请先核对' };
    openingPaid = b.payments.length ? (cents(b.paid) - cents(eventPaid)) / 100 : b.paid;
    openingLastFollow = b.follows.length && b.lastFollow === eventLast ? '' : b.lastFollow;
  } else {
    if (!isSupportedMoney(b.openingPaid) || b.openingPaid < 0) return { error: at + '迁移前已收必须是不小于 0 且不超过系统金额上限的数字' };
    if (b.openingLastFollow !== '' && !isIsoDate(b.openingLastFollow)) return { error: at + '迁移前最近跟进不是 YYYY-MM-DD 或空' };
    openingPaid = b.openingPaid;
    openingLastFollow = b.openingLastFollow;
    const eventPaid = paymentTotal(b.payments);
    const expectedCents = safeAddCents(cents(openingPaid), cents(eventPaid));
    if (!Number.isFinite(eventPaid) || expectedCents === null) return { error: at + '迁移前已收与收款记录合计超过安全计算范围' };
    const expectedPaid = expectedCents / 100;
    const expectedLast = latestFollow(b.follows, openingLastFollow);
    if (cents(b.paid) !== cents(expectedPaid)) return { error: at + '已收金额与迁移前已收、收款记录合计矛盾' };
    if (b.lastFollow !== expectedLast) return { error: at + '最近跟进日期与迁移前日期、跟进记录矛盾' };
  }
  const normalized = deriveBill(Object.assign({}, b, { openingPaid, openingLastFollow }));
  if (cents(normalized.paid) > cents(normalized.amount)) return { error: at + '已收合计超过应收金额' };
  return { bill: normalized };
}

function validateImport(raw) {
  let obj = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch (e) { return { ok: false, error: '不是有效的 JSON' }; }
  }
  if (!isPlainObject(obj)) return { ok: false, error: '顶层必须是对象' };
  if (obj.version !== 1 && obj.version !== 2) return { ok: false, error: '不支持的备份版本(需要 version = 1 或 2)' };
  if (!Array.isArray(obj.bills)) return { ok: false, error: 'bills 必须是数组' };
  const ids = new Set();
  const keys = new Set();
  const normalizedBills = [];
  for (let i = 0; i < obj.bills.length; i += 1) {
    const err = validateBill(obj.bills[i], i);
    if (err) return { ok: false, error: err };
    if (ids.has(obj.bills[i].id)) return { ok: false, error: 'id 重复:' + obj.bills[i].id };
    ids.add(obj.bills[i].id);
    const k = billKey(obj.bills[i]);
    if (keys.has(k)) return { ok: false, error: '客户 + 账单号重复:' + obj.bills[i].client + ' ' + obj.bills[i].no };
    keys.add(k);
    const normalized = normalizeImportedBill(obj.bills[i], i, obj.version);
    if (normalized.error) return { ok: false, error: normalized.error };
    normalizedBills.push(normalized.bill);
  }
  if (obj.sample !== undefined && typeof obj.sample !== 'boolean') return { ok: false, error: 'sample 必须是 true 或 false' };
  let template = DEFAULT_TEMPLATE, n = DEFAULT_N;
  if (obj.settings !== undefined) {
    const s = obj.settings;
    const serr = validateSettings(s);
    if (serr) return { ok: false, error: serr };
    template = s.template; n = s.n;
  }
  const bills = normalizedBills.map((b) => ({
    id: b.id, client: b.client, no: b.no, issueDate: b.issueDate, dueDate: b.dueDate, amount: b.amount, currency: b.currency,
    paid: b.paid, openingPaid: b.openingPaid, dispute: b.dispute, lastFollow: b.lastFollow, openingLastFollow: b.openingLastFollow,
    payments: b.payments.map((p) => ({ date: p.date, amount: p.amount })),
    follows: b.follows.map((f) => ({ date: f.date, note: f.note }))
  }));
  return { ok: true, data: { bills, settings: { template, n }, sample: obj.sample === true } };
}

function exportJson(bills, settings, sample) {
  const out = { version: 2, bills: bills.map(deriveBill), settings: { template: settings.template, n: settings.n } };
  if (sample === true) out.sample = true;
  return JSON.stringify(out, null, 2);
}

/* 导入确认前的预览:现有数据与备份文件各有多少账单、收款、跟进记录 */
function countRecords(st) {
  const bills = (st && Array.isArray(st.bills)) ? st.bills : [];
  let payments = 0, follows = 0;
  bills.forEach((b) => { payments += (b.payments || []).length; follows += (b.follows || []).length; });
  return { bills: bills.length, payments, follows };
}
function importSummary(current, incoming) {
  const a = countRecords(current), b = countRecords(incoming);
  const f = (c) => c.bills + ' 张账单、' + c.payments + ' 笔收款、' + c.follows + ' 条跟进记录';
  return { current: a, incoming: b, text: '现有 ' + f(a) + ' 将被替换为备份文件 ' + f(b) + '。' };
}
function settingsAreDefault(s) {
  return !!s && s.template === DEFAULT_TEMPLATE && s.n === DEFAULT_N;
}

/* 选文件后、写入 CSV 文本框前的检查:空文件、无法按 UTF-8 解码的文件(出现替换字符 U+FFFD)直接拒绝并说明原因 */
function checkTextFile(text) {
  const s = String(text == null ? '' : text);
  if (s.trim() === '') return { ok: false, code: 'empty', message: '文件是空的,没有读到内容。' };
  if (s.indexOf('\uFFFD') !== -1) return { ok: false, code: 'encoding', message: '文件含无法识别的字符,可能不是 UTF-8 编码。请在表格软件里另存为「CSV UTF-8」后再试。' };
  return { ok: true, code: '', message: '' };
}

const api = {
  checkTextFile,
  BUCKETS, DEFAULT_TEMPLATE, DEFAULT_N, MAX_MONEY, FIELD_KEYS,
  parseDate, isIsoDate, daysBetween, addDays, resolveToday, formatMoney,
  balance, overdueDays, ageBucket, bucketLabel, agingReport, isDisputed, followUpList, draft,
  TEMPLATE_MAX, validateSettings, addPayment, recordFollow, deriveBill, buildBill, mergeBills, makeId,
  parseBatch, parseCsv, guessMapping, mapCsv,
  csvCell, toCsv, agingCsv, followCsv, toMarkdown, validateImport, exportJson, importSummary, settingsAreDefault
};
globalThis.ReceivablesCore = api;
if (typeof module !== 'undefined') module.exports = api;
