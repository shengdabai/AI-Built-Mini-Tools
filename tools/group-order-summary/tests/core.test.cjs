'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const MENU_TEXT = [
  '宫保鸡丁=宫保, 鸡丁饭 | 22 | 微辣, 不辣, 特辣',
  '鱼香肉丝=鱼香 | 20',
  '麻婆豆腐=麻婆 | 16 | 微辣, 不辣',
  '红烧肉 | 28',
  '米饭 | 2',
  '可乐鸡翅=鸡翅 | 24.5'
].join('\n');
const MENU = C.parseMenu(MENU_TEXT).menu;
const run = (text, opts) => C.aggregate(C.parseReplies(text), MENU, opts);

test('parseMenu: 别名、规格、小数价格', () => {
  const r = C.parseMenu(MENU_TEXT);
  assert.deepEqual(r.errors, []);
  assert.equal(r.menu.length, 6);
  assert.deepEqual(r.menu[0].aliases, ['宫保', '鸡丁饭']);
  assert.deepEqual(r.menu[0].specs, ['微辣', '不辣', '特辣']);
  assert.equal(r.menu[0].price, 2200);
  assert.equal(r.menu[5].price, 2450);
});

test('parseMenu: 任何一行有错都带行号报错,重复菜名被拒', () => {
  const r = C.parseMenu('红烧肉 | 28\n坏行没有价格\n红烧肉 | 30\n鱼香 | abc');
  assert.equal(r.errors.length, 3);
  assert.match(r.errors[0], /第2行/);
  assert.match(r.errors[1], /重复/);
  assert.match(r.errors[2], /第4行/);
});

test('serializeMenu 与 parseMenu 互为往返', () => {
  const again = C.parseMenu(C.serializeMenu(MENU)).menu;
  assert.deepEqual(again, MENU);
});

test('parseQty: x2 / ×2 / 2份 / 两份 / 十份 / 默认 1', () => {
  assert.equal(C.parseQty('宫保鸡丁 x2').qty, 2);
  assert.equal(C.parseQty('宫保鸡丁X3').qty, 3);
  assert.equal(C.parseQty('宫保鸡丁 ×4').qty, 4);
  assert.equal(C.parseQty('红烧肉 2份').qty, 2);
  assert.equal(C.parseQty('两份红烧肉').qty, 2);
  assert.equal(C.parseQty('红烧肉 十份').qty, 10);
  const d = C.parseQty('米饭');
  assert.equal(d.qty, 1); assert.equal(d.found, false);
  assert.equal(C.parseQty('红烧肉 x2').rest, '红烧肉');
});

test('parseQty: 读不懂的数量标记为 ambiguous 而不是猜', () => {
  for (const s of ['红烧肉 x0', '红烧肉 x1.5', '红烧肉 x2 3份', '红烧肉 二十份', '红烧肉 x1000']) {
    const r = C.parseQty(s);
    assert.equal(r.ambiguous, true, s);
    assert.equal(r.qty, null, s);
  }
});

test('matchDish: 精确 / 别名 / 包含 / 部分', () => {
  assert.equal(C.matchDish('红烧肉', MENU).dish.name, '红烧肉');
  assert.equal(C.matchDish('鱼香', MENU).dish.name, '鱼香肉丝');
  assert.equal(C.matchDish('来一份红烧肉吧', MENU).dish.name, '红烧肉');
  assert.equal(C.matchDish('麻婆', MENU).dish.name, '麻婆豆腐');
  assert.equal(C.matchDish('宫保鸡丁', MENU).via, 'exact');
});

test('matchDish: 规格写在前、后、括号里、横线后都能识别', () => {
  for (const s of ['微辣宫保', '宫保鸡丁 微辣', '宫保鸡丁(微辣)', '宫保鸡丁-微辣', '鸡丁饭微辣']) {
    const r = C.matchDish(s, MENU);
    assert.equal(r.status, 'ok', s);
    assert.equal(r.dish.name, '宫保鸡丁', s);
    assert.equal(r.spec, '微辣', s);
  }
  assert.equal(C.matchDish('宫保鸡丁', MENU).spec, '');
});

test('matchDish: 歧义与找不到', () => {
  const amb = C.matchDish('鸡', MENU);
  assert.equal(amb.status, 'ambiguous');
  assert.deepEqual(amb.candidates.sort(), ['可乐鸡翅', '宫保鸡丁'].sort());
  assert.equal(C.matchDish('螺蛳粉', MENU).status, 'none');
  assert.equal(C.matchDish('  ', MENU).status, 'none');
});

test('matchDish: 更长的命中优先,不误判为歧义', () => {
  const menu = C.parseMenu('宫保鸡丁 | 22\n宫保鸡丁饭 | 25').menu;
  assert.equal(C.matchDish('宫保鸡丁饭', menu).dish.name, '宫保鸡丁饭');
  assert.equal(C.matchDish('宫保鸡丁', menu).dish.name, '宫保鸡丁');
});

test('parseReplies: 冒号写法、空格写法、全角冒号', () => {
  const o = C.parseReplies('张三: 红烧肉 x2\n李四 米饭\n王五：鱼香');
  assert.deepEqual(o.map(x => x.person), ['张三', '李四', '王五']);
  assert.equal(o[0].items[0].qty, 2);
  assert.equal(o[1].items[0].text, '米饭');
});

test('「同上」取前一个人的点单,链式也成立', () => {
  const a = run('张三: 红烧肉 x2\n李四: 同上\n王五: 同上');
  assert.equal(a.byPerson.length, 3);
  a.byPerson.forEach(p => assert.equal(p.amount, 5600));
  assert.equal(a.total, 16800);
});

test('「同上」前面没人 → 待确认;前一人不吃则同样不吃', () => {
  const a = run('张三: 同上');
  assert.equal(a.pending.length, 1);
  assert.equal(a.pending[0].reason, 'no-previous');
  const b = run('张三: 不吃\n李四: 同上');
  assert.equal(b.byPerson[1].skip, true);
  assert.equal(b.total, 0);
});

test('「不吃」「不要」记为不点,金额 0', () => {
  const a = run('张三: 不吃\n李四: 不要了\n王五: 红烧肉');
  assert.equal(a.byPerson[0].skip, true);
  assert.equal(a.byPerson[1].skip, true);
  assert.equal(a.total, 2800);
  assert.equal(a.pending.length, 0);
});

test('同一人多次回复取最后一次,顺序按首次出现', () => {
  const a = run('张三: 红烧肉\n李四: 米饭\n张三: 鱼香肉丝');
  assert.deepEqual(a.byPerson.map(p => p.person), ['张三', '李四']);
  assert.equal(a.byPerson[0].amount, 2000);
  assert.equal(a.total, 2200);
  assert.equal(a.byDish.find(g => g.name === '红烧肉'), undefined);
});

test('aggregate: 按菜名×规格合计数量与金额,金额是整数分', () => {
  const a = run('张三: 宫保鸡丁 微辣 x2\n李四: 宫保鸡丁 不辣\n王五: 微辣宫保\n赵六: 可乐鸡翅 x3');
  const g = a.byDish.map(x => [x.name, x.spec, x.qty, x.amount]);
  assert.deepEqual(g, [['宫保鸡丁', '微辣', 3, 6600], ['宫保鸡丁', '不辣', 1, 2200], ['可乐鸡翅', '', 3, 7350]]);
  assert.equal(a.total, 16150);
  assert.ok(a.byDish.every(x => Number.isInteger(x.amount)));
  assert.deepEqual(a.byDish[0].people, ['张三', '王五']);
});

test('aggregate: 一人多道菜,单独一段的规格并入上一道', () => {
  const a = run('张三: 宫保鸡丁, 微辣, 米饭 两份');
  const p = a.byPerson[0];
  assert.equal(p.items.length, 2);
  assert.equal(p.items[0].spec, '微辣');
  assert.equal(p.amount, 2200 + 400);
  assert.equal(a.pending.length, 0);
});

test('aggregate: pending 收集未识别、歧义、数量不明、空回复,且不计入金额', () => {
  const a = run('张三: 螺蛳粉\n李四: 鸡\n王五: 红烧肉 x0\n赵六\n: 米饭\n钱七: 红烧肉');
  const reasons = a.pending.map(x => x.reason).sort();
  assert.deepEqual(reasons, ['ambiguous', 'empty', 'no-name', 'qty', 'unmatched']);
  assert.equal(a.total, 2800);
  assert.equal(a.byPerson.find(p => p.person === '张三').pendingCount, 1);
  assert.ok(a.pending.find(x => x.reason === 'ambiguous').candidates.length === 2);
});

test('空回复得到空结果', () => {
  const a = run('');
  assert.deepEqual(a.byDish, []);
  assert.deepEqual(a.byPerson, []);
  assert.equal(a.total, 0);
  assert.equal(C.orderText(a), '');
  assert.equal(C.paymentText(a), '');
  assert.equal(C.toCsv(a).split('\r\n').length, 2);
});

test('splitFee 按人头:总额守恒,余数分给前面的人', () => {
  const a = run('张三: 红烧肉\n李四: 米饭\n王五: 米饭\n赵六: 不吃');
  const s = C.splitFee(a.byPerson, 1000, 'head');
  assert.deepEqual(s.map(x => x.share), [334, 333, 333, 0]);
  assert.equal(s.reduce((t, x) => t + x.share, 0), 1000);
});

test('splitFee 按金额比例:最大余数法,总额守恒', () => {
  const a = run('张三: 红烧肉\n李四: 米饭\n王五: 米饭');   // 2800 / 200 / 200
  for (const fee of [1, 7, 100, 999, 1001]) {
    const s = C.splitFee(a.byPerson, fee, 'amount');
    assert.equal(s.reduce((t, x) => t + x.share, 0), fee, 'fee=' + fee);
    assert.ok(s[0].share >= s[1].share);
  }
  assert.deepEqual(C.splitFee(a.byPerson, 3000, 'amount').map(x => x.share), [2625, 188, 187]);
});

test('splitFee: 金额全 0 时退回人头;没人参与则不分摊;超大数不丢精度', () => {
  const none = run('张三: 不吃');
  assert.deepEqual(C.splitFee(none.byPerson, 500, 'head').map(x => x.share), [0]);
  const big = [{ person: 'a', items: [1], amount: 9007199254740000, skip: false }, { person: 'b', items: [1], amount: 3, skip: false }];
  const s = C.splitFee(big, C.MAX_FEE, 'amount');
  assert.equal(s[0].share + s[1].share, C.MAX_FEE);
});

test('aggregate 带 fee:应付 = 餐费 + 分摊,合计守恒', () => {
  const a = run('张三: 红烧肉\n李四: 米饭', { fee: 601, feeMode: 'head' });
  assert.deepEqual(a.byPerson.map(p => p.fee), [301, 300]);
  assert.deepEqual(a.byPerson.map(p => p.payable), [3101, 500]);
  assert.equal(a.grandTotal, 3601);
  assert.equal(a.feeUnallocated, 0);
  const none = run('张三: 不吃', { fee: 500 });
  assert.equal(none.feeUnallocated, 500);
});

test('orderText: 商家下单文本,规格合并、无规格单行、混合用「默认」', () => {
  const a = run('张三: 宫保鸡丁 微辣 x2\n李四: 宫保鸡丁 微辣\n王五: 宫保鸡丁 不辣\n赵六: 米饭 x5\n钱七: 麻婆豆腐\n孙八: 麻婆豆腐 微辣');
  assert.equal(C.orderText(a), '宫保鸡丁 微辣 ×3,不辣 ×1\n麻婆豆腐 默认 ×1,微辣 ×1\n米饭 ×5');
});

test('paymentText: 收款文本含合计,不点的人不出现', () => {
  const a = run('张三: 红烧肉 x1\n李四: 鱼香肉丝\n王五: 不吃\n赵六: 可乐鸡翅');
  assert.equal(C.paymentText(a), '张三 28 元,李四 20 元,赵六 24.5 元\n合计 72.5 元');
  assert.equal(C.paymentText(a, { withTotal: false }), '张三 28 元,李四 20 元,赵六 24.5 元');
});

test('weekStats: 只统计同一周(周一到周日),分人计次数与金额', () => {
  const d1 = run('张三: 红烧肉\n李四: 米饭\n王五: 不吃');
  const d2 = run('张三: 鱼香肉丝');
  const stats = C.weekStats([
    { date: '2026-10-19', byPerson: d1.byPerson },
    { date: '2026-10-20', byPerson: d2.byPerson },
    { date: '2026-10-18', byPerson: d1.byPerson }   // 上周日,不计
  ], '2026-10-22');
  assert.equal(stats.start, '2026-10-19');
  assert.equal(stats.end, '2026-10-25');
  assert.equal(stats.dayCount, 2);
  assert.deepEqual(stats.people.map(p => [p.person, p.count, p.amount]), [['张三', 2, 4800], ['李四', 1, 200]]);
});

test('lastSame: 取当天之前最近一个有回复的日子', () => {
  const days = [
    { date: '2026-10-17', replies: 'a: 米饭' }, { date: '2026-10-19', replies: '   ' },
    { date: '2026-10-18', replies: 'b: 米饭' }, { date: '2026-10-20', replies: 'c: 米饭' }
  ];
  assert.equal(C.lastSame(days, '2026-10-20').date, '2026-10-18');
  assert.equal(C.lastSame(days, '2026-10-17'), null);
});

test('toCsv: 公式防护只加在用户字段上,单独的 - 不加;引号被转义', () => {
  const menu = C.parseMenu('+cmd | 5\n-x | 3\n@dish | 1\n"引号菜 | 1').menu;
  const a = C.aggregate(C.parseReplies('=张三: +cmd\n-: -x\n@李四: @dish\n"王": "引号菜'), menu);
  const csv = C.toCsv(a);
  assert.ok(csv.includes("'+cmd"));
  assert.ok(csv.includes("'-x"));
  assert.ok(csv.includes("'@dish"));
  assert.ok(csv.includes("'=张三"));
  assert.ok(!/(^|,)\+cmd/m.test(csv));
  assert.ok(csv.includes('"""引号菜"'));
  const p = C.toCsv(a, { kind: 'person' });
  assert.ok(p.includes("'=张三"));
  assert.ok(p.includes("'@李四"));
  assert.ok(p.includes('\r\n-,'));
});

test('toCsv: 按菜品合计行与按人状态', () => {
  const a = run('张三: 红烧肉 x2\n李四: 不吃\n王五: 螺蛳粉');
  const dish = C.toCsv(a).split('\r\n');
  assert.equal(dish[0], '菜品,规格,数量,单价(元),金额(元),点单人');
  assert.equal(dish[1], '红烧肉,,2,28,56,张三');
  assert.equal(dish[2], '合计,,2,,56,');
  const per = C.toCsv(a, { kind: 'person' });
  assert.ok(per.includes('李四,,0,0,0,不点'));
  assert.ok(per.includes('待确认:菜名在菜单里找不到'));
});

test('日期: 拒绝自动进位,?today 非法回退', () => {
  assert.equal(C.isValidDateStr('2026-02-30'), false);
  assert.equal(C.isValidDateStr('2026-13-01'), false);
  assert.equal(C.isValidDateStr('2028-02-29'), true);
  assert.equal(C.isValidDateStr('2026-2-3'), false);
  assert.equal(C.parseTodayParam('?today=2026-10-20', 'X'), '2026-10-20');
  assert.equal(C.parseTodayParam('?today=2026-02-30', 'X'), 'X');
  assert.equal(C.parseTodayParam('?today=abc', 'X'), 'X');
  assert.equal(C.parseTodayParam('', 'X'), 'X');
  assert.equal(C.addDays('2026-12-31', 1), '2027-01-01');
  assert.deepEqual(C.weekRange('2026-10-25'), { start: '2026-10-19', end: '2026-10-25' });
});

test('分组用 Map:__proto__ / constructor 作菜名或人名不出错', () => {
  const menu = C.parseMenu('__proto__ | 1\nconstructor | 2').menu;
  const a = C.aggregate(C.parseReplies('__proto__: __proto__\nconstructor: constructor x2'), menu);
  assert.equal(a.total, 500);
  assert.deepEqual(a.byPerson.map(p => p.person), ['__proto__', 'constructor']);
  const w = C.weekStats([{ date: '2026-10-19', byPerson: a.byPerson }], '2026-10-19');
  assert.equal(w.people.length, 2);
});

const goodState = () => ({
  version: 1,
  menu: [{ id: 'd1', name: '红烧肉', price: 2800, aliases: ['红烧'], specs: [] }],
  days: [{ date: '2026-10-20', replies: '张三: 红烧肉', fee: 0, feeMode: 'head',
    menu: [{ id: 'd1', name: '红烧肉', price: 2800, aliases: ['红烧'], specs: [] }] }]
});

test('validateImport: 合法内容通过,JSON 文本也可', () => {
  assert.equal(C.validateImport(goodState()).ok, true);
  const r = C.validateImport(JSON.stringify(goodState()));
  assert.equal(r.ok, true);
  assert.equal(r.state.days[0].replies, '张三: 红烧肉');
  assert.equal(C.validateState(C.emptyState()).ok, true);
});

test('validateImport: 类型、枚举、重复 ID、日期、坏 JSON 一律整份拒绝', () => {
  const bad = [];
  const mut = fn => { const s = goodState(); fn(s); bad.push(s); };
  mut(s => { s.version = 2; });
  mut(s => { s.menu[0].price = 28.5; });
  mut(s => { s.menu[0].price = '2800'; });
  mut(s => { s.menu[0].price = -1; });
  mut(s => { s.menu.push(Object.assign({}, s.menu[0], { name: '米饭' })); });   // id 重复
  mut(s => { s.menu.push(Object.assign({}, s.menu[0], { id: 'd2' })); });       // 菜名重复
  mut(s => { s.menu[0].specs = ['微辣', '微辣']; });
  mut(s => { s.menu[0].name = '带|竖线'; });
  mut(s => { s.days[0].date = '2026-02-30'; });
  mut(s => { s.days.push(Object.assign({}, s.days[0])); });
  mut(s => { s.days[0].feeMode = 'half'; });
  mut(s => { s.days[0].fee = 1.5; });
  mut(s => { delete s.days[0].menu; });
  mut(s => { s.days[0].menu[0].price = 'x'; });
  mut(s => { s.days[0].menu.push(Object.assign({}, s.days[0].menu[0])); });
  mut(s => { s.days[0].replies = 5; });
  mut(s => { s.menu = {}; });
  bad.forEach((s, i) => assert.equal(C.validateImport(s).ok, false, '第 ' + i + ' 例应被拒绝'));
  assert.equal(C.validateImport('{坏').ok, false);
  assert.equal(C.validateImport(null).ok, false);
  assert.equal(C.validateImport([]).ok, false);
});

test('写入校验 = 读取校验:边界值能保存也能读回', () => {
  const s = goodState();
  s.days[0].replies = '张三: 红烧肉\n'.repeat(C.LIMITS.replies / 12 | 0);
  s.days[0].fee = C.MAX_FEE;
  s.menu[0].price = C.MAX_PRICE;
  assert.equal(C.validateState(s).ok, true);
  const back = C.validateImport(JSON.stringify(s));
  assert.equal(back.ok, true);
  s.days[0].replies = 'x'.repeat(C.LIMITS.replies + 1);
  assert.equal(C.validateState(s).ok, false);
});

test('最后一条回复无效时不回退旧订单:该人置为待确认,且不再按旧订单收费', () => {
  for (const bad of ['甲:', '甲', '甲: x2']) {
    const a = run('甲: 米饭 x2\n' + bad);
    assert.equal(a.total, 0, bad);
    assert.equal(a.byPerson.length, 1, bad);
    assert.equal(a.byPerson[0].amount, 0, bad);
    assert.equal(a.byPerson[0].pendingCount, 1, bad);
    assert.equal(a.pending.length, 1, bad);
  }
  // 同上:前面没人 → 无效;改回有效回复后恢复
  const fixed = run('甲: 米饭 x2\n甲:\n甲: 红烧肉');
  assert.equal(fixed.total, 2800);
  assert.equal(fixed.pending.length, 0, '被后来有效回复取代的无效行不再列出');
  const fee = run('甲: 米饭\n乙: 红烧肉\n甲:', { fee: 100, feeMode: 'head' });
  assert.equal(fee.byPerson.reduce((t, p) => t + p.fee, 0), 100);
  assert.equal(fee.byPerson[0].amount, 0);
});

test('历史订单用当日菜单快照:改菜价不改变过去金额与周汇总', () => {
  const old = C.parseMenu('红烧肉 | 28').menu;
  const day = { date: '2026-10-19', replies: '甲: 红烧肉 x2', fee: 0, feeMode: 'head', menu: C.cloneMenu(old) };
  const newMenu = C.parseMenu('红烧肉 | 40').menu;
  assert.equal(C.dayAggregate(day, newMenu).total, 5600);          // 快照优先
  assert.equal(C.dayAggregate(Object.assign({}, day, { menu: undefined }), newMenu).total, 8000); // 无快照才用传入菜单
  const days = C.refreshSnapshots([day, Object.assign({}, day, { date: '2026-10-20' })], newMenu, '2026-10-20');
  assert.equal(C.dayAggregate(days[0], newMenu).total, 5600, '更早的日子保持原价');
  assert.equal(C.dayAggregate(days[1], newMenu).total, 8000, '今天及以后用新价');
  const w = C.weekStats(days.map(d => ({ date: d.date, byPerson: C.dayAggregate(d, newMenu).byPerson })), '2026-10-20');
  assert.equal(w.people[0].amount, 13600);
  assert.notEqual(days[1].menu, newMenu, '快照是拷贝');
});

test('快照写读同源:带快照的状态能通过校验并原样读回,快照不合法则整份拒绝', () => {
  const s = goodState();
  s.days[0].menu[0].price = 4000;
  assert.equal(C.validateState(s).ok, true);
  const back = C.validateImport(JSON.stringify(s));
  assert.equal(back.state.days[0].menu[0].price, 4000);
  assert.equal(back.state.menu[0].price, 2800);
  s.days[0].menu[0].price = 4000.5;
  assert.equal(C.validateState(s).ok, false);
});

/* ---- 第五轮:零头规则说明、历史菜单快照 ---- */
test('feeRuleText:两种模式的零头规则说明与 splitFee 的实际行为一致', () => {
  assert.match(C.feeRuleText('head'), /按人头.*名单顺序/);
  assert.match(C.feeRuleText('amount'), /按金额.*余数较大/);
  assert.notEqual(C.feeRuleText('head'), C.feeRuleText('amount'));
  // 实际行为:按金额时 1 分零头给小数余数较大的乙(2 元),不是名单里靠前的甲(1 元)
  const people = [
    { person: '甲', skip: false, items: [{}], pendingCount: 0, amount: 100 },
    { person: '乙', skip: false, items: [{}], pendingCount: 0, amount: 200 },
  ];
  assert.deepEqual(C.splitFee(people, 1, 'amount').map(x => x.share), [0, 1]);
  // 按人头时余数相同,按名单顺序先给前面的人
  assert.deepEqual(C.splitFee(people, 1, 'head').map(x => x.share), [1, 0]);
});

test('menuView:当天快照与当前菜单不同时判为 snapshot,相同或没有记录时不是', () => {
  const cur = C.parseMenu('红烧肉 | 28\n米饭 | 2').menu;
  const old = C.parseMenu('红烧肉 | 25\n米饭 | 2').menu;
  assert.equal(C.menuView(null, cur).mode, 'current');
  assert.equal(C.menuView({ date: '2026-10-01', menu: C.cloneMenu(cur) }, cur).mode, 'current');
  const v = C.menuView({ date: '2026-10-01', menu: old }, cur);
  assert.equal(v.mode, 'snapshot');
  assert.equal(v.text, C.serializeMenu(old));
  assert.equal(v.count, 2);
});
