'use strict';
/* 团餐点单汇总 · 纯逻辑(无 DOM)。金额一律整数分。 */

const MAX_PRICE = 10000000;   // 单价上限:10 万元(分)
const MAX_FEE = 100000000;    // 配送费/包装费上限:100 万元(分)
const MAX_QTY = 999;          // 单条数量上限
const LIMITS = { dishes: 300, days: 3700, name: 100, listItems: 20, replies: 200000 };

/* ---------- 文本与金额工具 ---------- */

function nfkc(s) { return String(s == null ? '' : s).normalize('NFKC'); }

// 匹配用:统一宽度、去空白与常见标点、转小写
function squash(s) {
  return nfkc(s).toLowerCase().replace(/[\s　()[\]{}【】「」《》『』"'“”‘’.,。、!?~\-_·:;]/g, '');
}

function formatYuan(cents) {
  const neg = cents < 0;
  const a = Math.abs(cents);
  const y = Math.floor(a / 100);
  const f = a % 100;
  let s = String(y);
  if (f) s += '.' + (f < 10 ? '0' + f : String(f)).replace(/0$/, '');
  return (neg ? '-' : '') + s;
}

function parseYuan(str, max) {
  const m = nfkc(str).trim().match(/^[¥￥]?\s*(\d{1,9})(?:\.(\d{1,2}))?\s*(?:元|块钱|块)?$/);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + (m[2] ? Number(m[2].padEnd(2, '0')) : 0);
  if (cents > (max == null ? MAX_PRICE : max)) return null;
  return cents;
}

/* ---------- 日期(全部在 UTC 时间轴上计算) ---------- */

function fmtUTC(dt) {
  const y = String(dt.getUTCFullYear()).padStart(4, '0');
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}
function toUTC(s) {
  const p = s.split('-').map(Number);
  const dt = new Date(0);
  dt.setUTCFullYear(p[0], p[1] - 1, p[2]);
  return dt;
}
function isValidDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return fmtUTC(toUTC(s)) === s;   // 解析后再格式化比较,拒绝 2026-02-30 这类自动进位
}
function addDays(s, n) {
  const dt = toUTC(s);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fmtUTC(dt);
}
function weekRange(s) {            // 周一至周日
  const off = (toUTC(s).getUTCDay() + 6) % 7;
  const start = addDays(s, -off);
  return { start, end: addDays(start, 6) };
}
function parseTodayParam(search, fallback) {
  try {
    const v = new URLSearchParams(search || '').get('today');
    return v != null && isValidDateStr(v) ? v : fallback;
  } catch (e) { return fallback; }
}

/* ---------- 菜单 ---------- */

const ALIAS_SPLIT = /[,，、;；]/;

function parseMenu(text) {
  const menu = [];
  const errors = [];
  const names = new Set();
  const lines = String(text == null ? '' : text).split(/\r\n|\r|\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const at = '第' + (i + 1) + '行:';
    const parts = line.split(/[|｜]/).map(s => s.trim());
    if (parts.length < 2 || parts.length > 3) { errors.push(at + '格式应为「菜名 | 单价 | 可选规格」'); return; }
    const head = parts[0].split(/[=＝]/);
    const name = head[0].trim();
    if (head.length > 2) { errors.push(at + '菜名里只能有一个「=」(别名写在等号后面)'); return; }
    if (!name) { errors.push(at + '菜名不能为空'); return; }
    if (name.length > LIMITS.name) { errors.push(at + '菜名太长'); return; }
    const aliases = head.length === 2 ? head[1].split(ALIAS_SPLIT).map(s => s.trim()).filter(Boolean) : [];
    const price = parseYuan(parts[1]);
    if (price == null) { errors.push(at + '单价「' + parts[1] + '」不是有效金额(最多两位小数,不超过 100000 元)'); return; }
    const specs = parts.length === 3 ? parts[2].split(ALIAS_SPLIT).map(s => s.trim()).filter(Boolean) : [];
    if (names.has(name)) { errors.push(at + '菜名「' + name + '」重复'); return; }
    if (new Set(aliases).size !== aliases.length || aliases.includes(name)) { errors.push(at + '别名重复,或与菜名相同'); return; }
    if (new Set(specs).size !== specs.length) { errors.push(at + '规格重复'); return; }
    if (aliases.some(a => a.length > LIMITS.name) || specs.some(a => a.length > LIMITS.name)) { errors.push(at + '别名或规格太长'); return; }
    names.add(name);
    menu.push({ id: 'd' + (menu.length + 1), name, price, aliases, specs });
  });
  return { menu, errors };
}

function serializeMenu(menu) {
  return menu.map(d => {
    let head = d.name + (d.aliases.length ? '=' + d.aliases.join(', ') : '');
    let s = head + ' | ' + formatYuan(d.price);
    if (d.specs.length) s += ' | ' + d.specs.join(', ');
    return s;
  }).join('\n');
}

/* ---------- 数量 ---------- */

const CN_DIGIT = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const NUM_SRC = '(\\d+(?:\\.\\d+)?|[一二两三四五六七八九十]+)';
const QTY_X = new RegExp('[x×*]\\s*' + NUM_SRC, 'i');
const QTY_UNIT = new RegExp(NUM_SRC + '\\s*(?:份|个|碗|盒|杯)');

function numFrom(str) {
  if (/^\d/.test(str)) {
    const n = Number(str);
    return Number.isInteger(n) && n >= 1 && n <= MAX_QTY ? n : null;
  }
  return str.length === 1 && CN_DIGIT[str] ? CN_DIGIT[str] : null;   // 中文数字只认到「十」
}

// 返回 { qty, found, ambiguous, rest };未写数量默认 1;写了但读不懂 → ambiguous 且 qty 为 null
function parseQty(text) {
  const s = nfkc(text);
  let m = QTY_X.exec(s);
  if (!m) m = QTY_UNIT.exec(s);
  if (!m) return { qty: 1, found: false, ambiguous: false, rest: s.replace(/\s+/g, ' ').trim() };
  const rest = (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
  const n = numFrom(m[1]);
  const again = QTY_X.test(rest) || QTY_UNIT.test(rest);   // 一条里写了两个数量 → 不猜
  if (n == null || again) return { qty: null, found: true, ambiguous: true, rest };
  return { qty: n, found: true, ambiguous: false, rest };
}

/* ---------- 菜名匹配 ---------- */

// 返回 { status:'ok'|'none'|'ambiguous', dish, spec, note, candidates }
function matchDish(text, menu) {
  const t = squash(text);
  if (!t) return { status: 'none' };
  let best = null;
  let ties = [];
  (menu || []).forEach(dish => {
    const names = [dish.name].concat(dish.aliases || []).map(squash).filter(Boolean);
    const specs = (dish.specs || []).map(raw => ({ raw, sq: squash(raw) }))
      .filter(s => s.sq && t.includes(s.sq)).sort((a, b) => b.sq.length - a.sq.length);
    const variants = specs.map(s => ({ spec: s.raw, rem: t.replace(s.sq, '') })).concat([{ spec: '', rem: t }]);
    let top = null;
    variants.forEach(v => {
      if (!v.rem) return;
      names.forEach(n => {
        let rank = 0, len = 0, note = '';
        if (v.rem === n) { rank = 4; len = n.length; }
        else if (v.rem.includes(n)) { rank = 3; len = n.length; note = v.rem.replace(n, ''); }
        else if (n.includes(v.rem)) { rank = 2; len = v.rem.length; }
        if (!rank) return;
        if (!top || rank > top.rank || (rank === top.rank && len > top.len)) top = { rank, len, spec: v.spec, note, dish };
      });
    });
    if (!top) return;
    if (!best || top.rank > best.rank || (top.rank === best.rank && top.len > best.len)) { best = top; ties = [top]; }
    else if (top.rank === best.rank && top.len === best.len) ties.push(top);
  });
  if (!best) return { status: 'none' };
  if (ties.length > 1) return { status: 'ambiguous', candidates: ties.map(x => x.dish.name) };
  return { status: 'ok', dish: best.dish, spec: best.spec, note: best.note, via: best.rank === 4 ? 'exact' : best.rank === 3 ? 'contains' : 'partial' };
}

/* ---------- 回复解析 ---------- */

const SKIP_RE = /^(今天|我)?(不吃|不要|不点|不订|不用|不需要)(了|啦|哈)?[\s。.!!~～]*$/;
const SAME_RE = /^同上[\s。.!!~～]*$/;

function personKey(name) { return nfkc(name).trim().toLowerCase(); }

function parseItem(chunk) {
  const q = parseQty(chunk);
  return { raw: chunk, text: q.rest, qty: q.qty, qtyAmbiguous: q.ambiguous };
}

function parseReplies(text) {
  const orders = [];
  let prev = null;
  String(text == null ? '' : text).split(/\r\n|\r|\n/).forEach((rawLine, i) => {
    const raw = rawLine.trim();
    if (!raw) return;
    const o = { line: i + 1, raw, person: '', key: '', skip: false, same: false, items: [], issue: null };
    let person, content;
    const c = raw.search(/[:：]/);
    if (c >= 0) {
      person = raw.slice(0, c).trim();
      content = raw.slice(c + 1).trim();
      if (!person) { o.issue = 'no-name'; orders.push(o); return; }
    } else {
      const m = raw.match(/^(\S+)[\s　]+([\s\S]+)$/);
      person = m ? m[1] : raw;
      content = m ? m[2].trim() : '';
    }
    o.person = person;
    o.key = personKey(person);
    if (!content) { o.issue = 'empty'; orders.push(o); return; }
    if (SKIP_RE.test(content)) {
      o.skip = true;
    } else if (SAME_RE.test(content)) {
      o.same = true;
      if (!prev) o.issue = 'no-previous';
      else { o.skip = prev.skip; o.items = prev.items.map(x => Object.assign({}, x)); }
    } else {
      o.items = content.split(/[,，;；、+＋]+/).map(s => s.trim()).filter(Boolean).map(parseItem);
      if (!o.items.length) o.issue = 'empty';
    }
    orders.push(o);
    if (!o.issue) prev = o;
  });
  return orders;
}

// 同一人多次回复取最后一次;顺序按首次出现
function lastPerPerson(orders) {
  const map = new Map();
  orders.forEach(o => { if (o.key) map.set(o.key, o); });   // 无效回复也算「最后一次」,不能回退到旧订单
  return Array.from(map.values());
}

/* ---------- 汇总 ---------- */

const ISSUE_MSG = {
  'no-name': '这一行没有名字',
  empty: '只有名字,没有点单内容',
  'no-previous': '写了「同上」,但前面没有可参照的人',
  unmatched: '菜名在菜单里找不到',
  ambiguous: '菜名对应多道菜,请写得更具体',
  qty: '数量不明(支持 x2、2份、两份,最多到 999)'
};

function splitFee(byPerson, fee, mode) {
  const n = byPerson.length;
  const shares = new Array(n).fill(0);
  const idx = [];
  byPerson.forEach((p, i) => { if (!p.skip && ((p.items && p.items.length) || p.pendingCount)) idx.push(i); });
  if (!idx.length || !(fee > 0)) return byPerson.map((p, i) => ({ person: p.person, share: shares[i] }));
  const total = BigInt(fee);
  let weights = idx.map(i => BigInt(byPerson[i].amount || 0));
  let W = weights.reduce((a, b) => a + b, 0n);
  if (mode !== 'amount' || W === 0n) { weights = idx.map(() => 1n); W = BigInt(idx.length); }
  const floors = weights.map(w => (total * w) / W);
  const rems = weights.map((w, k) => ({ k, r: (total * w) % W }));
  let left = Number(total - floors.reduce((a, b) => a + b, 0n));
  rems.sort((a, b) => (a.r === b.r ? a.k - b.k : (a.r > b.r ? -1 : 1)));
  const extra = new Array(idx.length).fill(0);
  for (let j = 0; j < left; j++) extra[rems[j].k] = 1;
  idx.forEach((i, k) => { shares[i] = Number(floors[k]) + extra[k]; });
  return byPerson.map((p, i) => ({ person: p.person, share: shares[i] }));
}

function aggregate(orders, menu, options) {
  const opts = options || {};
  const dishes = menu || [];
  const pending = [];
  const groups = new Map();
  const byPerson = [];
  const finals = lastPerPerson(orders);
  const addIssue = o => pending.push({ person: o.person, text: o.raw, reason: o.issue, message: ISSUE_MSG[o.issue] });
  orders.forEach(o => { if (o.issue && !o.key) addIssue(o); });   // 没有名字的行无法归属任何人
  finals.forEach(o => {
    const p = { person: o.person, key: o.key, skip: o.skip, items: [], pendingCount: 0, amount: 0, fee: 0, payable: 0 };
    byPerson.push(p);
    if (o.issue) { p.pendingCount++; addIssue(o); return; }   // 最后一条回复无效:该人订单置为待确认
    if (o.skip) return;
    o.items.forEach(it => {
      const res = it.text ? matchDish(it.text, dishes) : { status: 'none' };
      const last = p.items[p.items.length - 1];
      // 「宫保鸡丁, 微辣」:单独一段只写了上一道菜的规格,并入上一道
      if (res.status === 'none' && last && !last.spec && !it.qtyAmbiguous && last.dish.specs) {
        const hit = last.dish.specs.find(s => squash(s) === squash(it.text));
        if (hit) { last.spec = hit; return; }
      }
      const fail = res.status !== 'ok' ? (res.status === 'ambiguous' ? 'ambiguous' : 'unmatched') : (it.qtyAmbiguous ? 'qty' : null);
      if (fail) {
        p.pendingCount++;
        pending.push({
          person: o.person, text: it.raw, reason: fail, message: ISSUE_MSG[fail],
          candidates: res.candidates || (res.status === 'ok' ? [res.dish.name] : [])
        });
        return;
      }
      const amount = res.dish.price * it.qty;
      p.items.push({ dish: res.dish, name: res.dish.name, spec: res.spec, qty: it.qty, unitPrice: res.dish.price, amount, note: res.note || '', raw: it.raw });
    });
    p.items.forEach(it => { p.amount += it.amount; });
  });

  byPerson.forEach(p => p.items.forEach(it => {
    const k = it.dish.id + '\u0000' + it.spec;
    let g = groups.get(k);
    if (!g) {
      g = { dishId: it.dish.id, name: it.name, spec: it.spec, qty: 0, unitPrice: it.unitPrice, amount: 0, people: [], menuIndex: dishes.indexOf(it.dish), specIndex: it.dish.specs.indexOf(it.spec) };
      groups.set(k, g);
    }
    g.qty += it.qty;
    g.amount += it.amount;
    if (!g.people.includes(p.person)) g.people.push(p.person);
  }));
  const byDish = Array.from(groups.values()).sort((a, b) => a.menuIndex - b.menuIndex || a.specIndex - b.specIndex);
  byDish.forEach(g => { delete g.menuIndex; delete g.specIndex; });

  const total = byDish.reduce((s, g) => s + g.amount, 0);
  const fee = opts.fee > 0 ? opts.fee : 0;
  const shares = splitFee(byPerson, fee, opts.feeMode);
  byPerson.forEach((p, i) => { p.fee = shares[i].share; p.payable = p.amount + p.fee; });
  const feeAllocated = byPerson.reduce((s, p) => s + p.fee, 0);
  return { byDish, byPerson, total, pending, fee, feeUnallocated: fee - feeAllocated, grandTotal: total + feeAllocated };
}

/* ---------- 每日订单:菜单快照 ---------- */

function cloneMenu(menu) {
  return menu.map(d => ({ id: d.id, name: d.name, price: d.price, aliases: d.aliases.slice(), specs: d.specs.slice() }));
}
// 用该日自己保存的菜单快照计价;改菜单不会改变过去的订单
function dayAggregate(day, fallbackMenu) {
  return aggregate(parseReplies(day ? day.replies : ''), day && day.menu ? day.menu : (fallbackMenu || []),
    { fee: day ? day.fee : 0, feeMode: day ? day.feeMode : 'head' });
}
/* 某一天的菜单视图:当天保存的快照与当前菜单不同时,界面必须显示快照(汇总按快照计价) */
function menuView(day, currentMenu) {
  if (!day || !day.menu) return { mode: 'current', text: serializeMenu(currentMenu), count: currentMenu.length };
  const snap = serializeMenu(day.menu);
  if (snap === serializeMenu(currentMenu)) return { mode: 'current', text: snap, count: day.menu.length };
  return { mode: 'snapshot', text: snap, count: day.menu.length };
}

function feeRuleText(mode) {
  return mode === 'amount'
    ? '按金额比例分摊:先按各人餐费占比算,分不尽的零头(每次 1 分)先给小数余数较大的人,余数相同按名单顺序。不点的人不分摊,总额保持不变。'
    : '按人头平分:分不尽的零头(每次 1 分)按名单顺序先给前面的人。不点的人不分摊,总额保持不变。';
}

// 应用新菜单:只刷新 fromDate 及之后的日子,更早的日子保留原快照
function refreshSnapshots(days, menu, fromDate) {
  return days.map(d => (d.date >= fromDate ? Object.assign({}, d, { menu: cloneMenu(menu) }) : d));
}

/* ---------- 输出文本 ---------- */

function orderText(agg) {
  const byName = new Map();
  agg.byDish.forEach(g => {
    if (!byName.has(g.dishId)) byName.set(g.dishId, { name: g.name, rows: [] });
    byName.get(g.dishId).rows.push(g);
  });
  return Array.from(byName.values()).map(d => {
    if (d.rows.length === 1 && !d.rows[0].spec) return d.name + ' ×' + d.rows[0].qty;
    return d.name + ' ' + d.rows.map(r => (r.spec || '默认') + ' ×' + r.qty).join(',');
  }).join('\n');
}

function paymentText(agg, options) {
  const withTotal = !options || options.withTotal !== false;
  const rows = agg.byPerson.filter(p => !p.skip && p.payable > 0);
  if (!rows.length) return '';
  let s = rows.map(p => p.person + ' ' + formatYuan(p.payable) + ' 元').join(',');
  if (withTotal) s += '\n合计 ' + formatYuan(rows.reduce((a, p) => a + p.payable, 0)) + ' 元';
  return s;
}

/* ---------- 一周统计 ---------- */

// days: [{ date, byPerson }];anyDate 为该周内任一天
function weekStats(days, anyDate) {
  const range = weekRange(anyDate);
  const map = new Map();
  let dayCount = 0;
  (days || []).forEach(d => {
    if (d.date < range.start || d.date > range.end) return;
    dayCount++;
    (d.byPerson || []).forEach(p => {
      const key = personKey(p.person);
      let s = map.get(key);
      if (!s) { s = { person: p.person, count: 0, amount: 0 }; map.set(key, s); }
      if (!p.skip && p.items && p.items.length) {
        s.count++;
        s.amount += typeof p.payable === 'number' ? p.payable : p.amount;
      }
    });
  });
  const people = Array.from(map.values()).filter(s => s.count > 0).sort((a, b) => b.count - a.count || b.amount - a.amount);
  return { start: range.start, end: range.end, dayCount, people };
}

// 上次同款:当天之前最近一个有回复的日子
function lastSame(days, date) {
  let best = null;
  (days || []).forEach(d => {
    if (d.date < date && d.replies && d.replies.trim() && (!best || d.date > best.date)) best = d;
  });
  return best;
}

/* ---------- CSV ---------- */

function guardCell(s) {
  const v = String(s);
  return v.length > 1 && /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}
function cell(s) {
  const g = guardCell(s);
  return /[",\r\n]/.test(g) ? '"' + g.replace(/"/g, '""') + '"' : g;
}
function numCell(n) { return String(n); }

function itemLabel(it) { return it.name + (it.spec ? ' ' + it.spec : '') + ' ×' + it.qty; }

// options.kind: 'dish'(默认,按菜品×规格) | 'person'(按人)
function toCsv(agg, options) {
  const kind = options && options.kind === 'person' ? 'person' : 'dish';
  const rows = [];
  if (kind === 'dish') {
    rows.push(['菜品', '规格', '数量', '单价(元)', '金额(元)', '点单人']);
    agg.byDish.forEach(g => rows.push([cell(g.name), cell(g.spec), numCell(g.qty), formatYuan(g.unitPrice), formatYuan(g.amount), cell(g.people.join('、'))]));
    rows.push(['合计', '', numCell(agg.byDish.reduce((s, g) => s + g.qty, 0)), '', formatYuan(agg.total), '']);
  } else {
    rows.push(['姓名', '清单', '餐费(元)', '分摊费用(元)', '应付(元)', '状态']);
    agg.byPerson.forEach(p => {
      const status = p.skip ? '不点' : (p.pendingCount ? '有待确认' : '已确认');
      rows.push([cell(p.person), cell(p.items.map(itemLabel).join(';')), formatYuan(p.amount), formatYuan(p.fee), formatYuan(p.payable), status]);
    });
    agg.pending.forEach(x => rows.push([cell(x.person), cell(x.text), '', '', '', '待确认:' + x.message]));
  }
  return rows.map(r => r.join(',')).join('\r\n');
}

/* ---------- 校验(保存前与读取后共用) ---------- */

const FORBIDDEN_NAME = /[|｜=＝\n\r]/;
const FORBIDDEN_LIST_ITEM = /[|｜,，、;；\n\r]/;
const isInt = n => typeof n === 'number' && Number.isInteger(n);
const isStr = s => typeof s === 'string';

function emptyState() { return { version: 1, menu: [], days: [] }; }

function validateMenu(menu, label) {
  const ids = new Set();
  const names = new Set();
  for (let i = 0; i < menu.length; i++) {
    const d = menu[i];
    const at = label + '第 ' + (i + 1) + ' 项';
    if (!d || typeof d !== 'object' || Array.isArray(d)) return at + '不是对象';
    if (!isStr(d.id) || !d.id) return at + '缺少 id';
    if (ids.has(d.id)) return at + ' id 重复:' + d.id;
    ids.add(d.id);
    if (!isStr(d.name) || !d.name.trim() || d.name !== d.name.trim() || d.name.length > LIMITS.name || FORBIDDEN_NAME.test(d.name)) return at + '菜名无效';
    if (names.has(d.name)) return at + '菜名重复:' + d.name;
    names.add(d.name);
    if (!isInt(d.price) || d.price < 0 || d.price > MAX_PRICE) return at + '单价必须是 0 到 ' + MAX_PRICE + ' 的整数分';
    for (const key of ['aliases', 'specs']) {
      const arr = d[key];
      if (!Array.isArray(arr) || arr.length > LIMITS.listItems) return at + ' ' + key + ' 必须是数组且不超过 ' + LIMITS.listItems + ' 项';
      for (const x of arr) {
        if (!isStr(x) || !x || x !== x.trim() || x.length > LIMITS.name || FORBIDDEN_LIST_ITEM.test(x)) return at + ' ' + key + ' 含无效项';
      }
      if (new Set(arr).size !== arr.length) return at + ' ' + key + ' 有重复项';
    }
    if (d.aliases.includes(d.name)) return at + '别名不能与菜名相同';
  }
  return null;
}

function validateState(st) {
  const fail = error => ({ ok: false, error });
  if (!st || typeof st !== 'object' || Array.isArray(st)) return fail('内容不是对象');
  if (st.version !== 1) return fail('版本号必须是 1');
  if (!Array.isArray(st.menu)) return fail('menu 必须是数组');
  if (!Array.isArray(st.days)) return fail('days 必须是数组');
  if (st.menu.length > LIMITS.dishes) return fail('菜单最多 ' + LIMITS.dishes + ' 道');
  if (st.days.length > LIMITS.days) return fail('历史最多 ' + LIMITS.days + ' 天');
  const menuErr = validateMenu(st.menu, '菜单');
  if (menuErr) return fail(menuErr);
  const dates = new Set();
  for (let i = 0; i < st.days.length; i++) {
    const d = st.days[i];
    const at = '历史第 ' + (i + 1) + ' 项';
    if (!d || typeof d !== 'object' || Array.isArray(d)) return fail(at + '不是对象');
    if (!isValidDateStr(d.date)) return fail(at + '日期无效:' + String(d.date));
    if (dates.has(d.date)) return fail(at + '日期重复:' + d.date);
    dates.add(d.date);
    if (!isStr(d.replies) || d.replies.length > LIMITS.replies) return fail(at + '回复文本无效或超过 ' + LIMITS.replies + ' 字');
    if (!isInt(d.fee) || d.fee < 0 || d.fee > MAX_FEE) return fail(at + '费用必须是 0 到 ' + MAX_FEE + ' 的整数分');
    if (d.feeMode !== 'head' && d.feeMode !== 'amount') return fail(at + '分摊方式必须是 head 或 amount');
    if (!Array.isArray(d.menu)) return fail(at + '缺少菜单快照 menu');
    if (d.menu.length > LIMITS.dishes) return fail(at + '菜单快照最多 ' + LIMITS.dishes + ' 道');
    const snapErr = validateMenu(d.menu, at + '菜单快照');
    if (snapErr) return fail(snapErr);
  }
  return { ok: true };
}

// input 可以是 JSON 文本或已解析对象;任何不合法都整份拒绝,不静默修正
function validateImport(input) {
  let obj = input;
  if (typeof input === 'string') {
    try { obj = JSON.parse(input); } catch (e) { return { ok: false, error: 'JSON 无法解析:' + e.message }; }
  }
  const v = validateState(obj);
  if (!v.ok) return v;
  return {
    ok: true,
    state: {
      version: 1,
      menu: obj.menu.map(d => ({ id: d.id, name: d.name, price: d.price, aliases: d.aliases.slice(), specs: d.specs.slice() })),
      days: obj.days.map(d => ({ date: d.date, replies: d.replies, fee: d.fee, feeMode: d.feeMode, menu: cloneMenu(d.menu) }))
    }
  };
}

const api = {
  MAX_PRICE, MAX_FEE, MAX_QTY, LIMITS,
  formatYuan, parseYuan, squash,
  isValidDateStr, addDays, weekRange, parseTodayParam,
  parseMenu, serializeMenu, parseQty, matchDish, parseReplies, lastPerPerson,
  aggregate, dayAggregate, menuView, feeRuleText, cloneMenu, refreshSnapshots, splitFee, orderText, paymentText, weekStats, lastSame, toCsv,
  emptyState, validateState, validateImport
};
globalThis.TuancanCore = api;
if (typeof module !== 'undefined') module.exports = api;
