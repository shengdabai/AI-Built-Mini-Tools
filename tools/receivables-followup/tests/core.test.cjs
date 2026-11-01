'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const TODAY = '2026-10-20';
test('汇总错误不得导出成空账龄文件', () => {
  const report = C.agingReport([bill({ id: 'large-1', amount: 4500000000000.01 }), bill({ id: 'large-2', amount: 4500000000000 })], TODAY);
  assert.match(report.error, /超过/);
  assert.throws(() => C.toMarkdown(report), /超过/);
  assert.throws(() => C.agingCsv(report, 'summary'), /超过/);
  assert.throws(() => C.agingCsv(report, 'detail'), /超过/);
});
function bill(over) {
  return Object.assign({ id: 'b1', client: '甲', no: 'N1', issueDate: '', dueDate: TODAY, amount: 100, currency: 'CNY', paid: 0, dispute: '', lastFollow: '', payments: [], follows: [] }, over);
}
function due(daysOverdue, over) { return bill(Object.assign({ dueDate: C.addDays(TODAY, -daysOverdue) }, over)); }

test('balance 用分计算,避免浮点误差', () => {
  assert.equal(C.balance(bill({ amount: 0.3, paid: 0.1 })), 0.2);
  assert.equal(C.balance(bill({ amount: 100, paid: 100 })), 0);
});

test('账龄桶边界:到期日当天=未到期,1/30/31/60/61/90/91', () => {
  const key = (d) => C.ageBucket(due(d), TODAY);
  assert.equal(key(-5), 'current');
  assert.equal(key(0), 'current');
  assert.equal(key(1), 'd1_30');
  assert.equal(key(30), 'd1_30');
  assert.equal(key(31), 'd31_60');
  assert.equal(key(60), 'd31_60');
  assert.equal(key(61), 'd61_90');
  assert.equal(key(90), 'd61_90');
  assert.equal(key(91), 'd90p');
});

test('余额为 0 的账单不入账龄', () => {
  assert.equal(C.ageBucket(due(95, { paid: 100 }), TODAY), null);
  const r = C.agingReport([due(95, { paid: 100 })], TODAY);
  assert.deepEqual(r.groups, []);
});

test('agingReport 按币种分开并汇总金额与笔数', () => {
  const bills = [
    due(5, { id: 'a', amount: 100, paid: 40 }),
    due(5, { id: 'b', no: 'N2', amount: 50 }),
    due(95, { id: 'c', no: 'N3', amount: 10, currency: 'USD' }),
    due(-3, { id: 'd', no: 'N4', amount: 7, currency: 'USD' })
  ];
  const r = C.agingReport(bills, TODAY);
  assert.deepEqual(r.groups.map((g) => g.currency), ['CNY', 'USD']);
  const cny = r.groups[0], usd = r.groups[1];
  assert.equal(cny.buckets.find((b) => b.key === 'd1_30').amount, 110);
  assert.equal(cny.buckets.find((b) => b.key === 'd1_30').count, 2);
  assert.equal(cny.total, 110);
  assert.equal(usd.buckets.find((b) => b.key === 'd90p').amount, 10);
  assert.equal(usd.buckets.find((b) => b.key === 'current').count, 1);
  assert.equal(usd.total, 17);
});

test('币种名为 __proto__ 或 constructor 不会污染分组', () => {
  const r = C.agingReport([due(1, { currency: 'CNY', client: '__proto__' })], TODAY);
  assert.equal(r.groups.length, 1);
  assert.equal(r.groups[0].items[0].bill.client, '__proto__');
});

test('followUpList:只列逾期且有余额的,按逾期天数降序', () => {
  const bills = [
    due(10, { id: 'a', no: 'A' }), due(95, { id: 'b', no: 'B' }), due(0, { id: 'c', no: 'C' }),
    due(40, { id: 'd', no: 'D', paid: 100 }), due(40, { id: 'e', no: 'E' })
  ];
  const l = C.followUpList(bills, TODAY, 7);
  assert.deepEqual(l.map((x) => x.bill.no), ['B', 'E', 'A']);
});

test('今天要跟:从未跟进,或距最近跟进 >= N 天', () => {
  const l = C.followUpList([
    due(10, { no: 'never' }),
    due(10, { no: 'six', lastFollow: C.addDays(TODAY, -6) }),
    due(10, { no: 'seven', lastFollow: C.addDays(TODAY, -7) }),
    due(10, { no: 'future', lastFollow: C.addDays(TODAY, 2) })
  ], TODAY, 7);
  const by = Object.fromEntries(l.map((x) => [x.bill.no, x]));
  assert.equal(by.never.needsFollow, true);
  assert.equal(by.six.needsFollow, false);
  assert.equal(by.seven.needsFollow, true);
  assert.equal(by.future.needsFollow, false);
  assert.equal(by.six.status, 'recent');
  const l3 = C.followUpList([due(10, { lastFollow: C.addDays(TODAY, -3) })], TODAY, 3);
  assert.equal(l3[0].needsFollow, true);
  const bad = C.followUpList([due(10, { lastFollow: C.addDays(TODAY, -7) })], TODAY, -2);
  assert.equal(bad[0].needsFollow, true, '非法 N 回退默认 7');
});

test('有争议的账单仍在清单里但不进自动提醒', () => {
  const l = C.followUpList([due(50, { dispute: '对方说没收到货' }), due(50, { no: 'N9', dispute: '   ' })], TODAY, 7);
  assert.equal(l[0].disputed, true);
  assert.equal(l[0].needsFollow, false);
  assert.equal(l[0].status, 'disputed');
  assert.equal(l.find((x) => x.bill.no === 'N9').needsFollow, true, '纯空白的争议备注不算争议');
});

test('draft 替换全部占位符', () => {
  const b = due(12, { client: '星河', no: 'INV-9', amount: 12000, paid: 2500 });
  const out = C.draft('{客户}|{账单号}|{金额}|{到期日}|{逾期天数}|{未知}', b, TODAY);
  assert.equal(out, '星河|INV-9|CNY 9,500.00|2026-10-08|12|{未知}');
});

test('draft 不二次展开值里的占位符,也不解释 $ 替换语法', () => {
  const b = due(3, { client: '{账单号}$&$1', no: 'X' });
  const out = C.draft('Hi {客户} / {账单号}', b, TODAY);
  assert.equal(out, 'Hi {账单号}$&$1 / X');
  assert.equal(C.draft('{逾期天数}', due(-4), TODAY), '0', '未到期时逾期天数显示 0');
});

test('addPayment 累加已收、记录明细,不改原对象', () => {
  const b = bill({ amount: 100, paid: 30 });
  const r = C.addPayment(b, { date: '2026-10-01', amount: 20.5 });
  assert.equal(r.ok, true);
  assert.equal(r.bill.paid, 50.5);
  assert.equal(C.balance(r.bill), 49.5);
  assert.equal(r.bill.payments.length, 1);
  assert.equal(b.paid, 30);
  assert.equal(b.payments.length, 0);
});

test('addPayment 拒绝超额、非正数、坏日期,恰好收齐允许', () => {
  const b = bill({ amount: 100, paid: 30 });
  const over = C.addPayment(b, { date: '2026-10-01', amount: 70.01 });
  assert.equal(over.ok, false);
  assert.match(over.error, /超过应收/);
  assert.equal(C.addPayment(b, { date: '2026-10-01', amount: 0 }).ok, false);
  assert.equal(C.addPayment(b, { date: '2026-13-01', amount: 5 }).ok, false);
  assert.equal(C.addPayment(b, { date: '2026-10-01', amount: 1.234 }).ok, false);
  const full = C.addPayment(b, { date: '2026-10-01', amount: 70 });
  assert.equal(full.ok, true);
  assert.equal(C.balance(full.bill), 0);
});

test('recordFollow 更新最近跟进为最晚日期', () => {
  let b = bill();
  b = C.recordFollow(b, { date: '2026-10-10', note: '电话' }).bill;
  b = C.recordFollow(b, { date: '2026-10-05', note: '补记' }).bill;
  assert.equal(b.lastFollow, '2026-10-10');
  assert.equal(b.follows.length, 2);
  assert.equal(C.recordFollow(b, { date: 'x', note: '' }).ok, false);
});

test('parseBatch 支持全角分隔符、制表符、省略已收,并报告错误行号', () => {
  const text = '星河｜INV-1｜2026/10/05｜12,000｜2,000\n北辰\tBC-2\t2026-09-01\t8000\n\n坏行 | 只有两列\n甲 | N3 | 2026-02-30 | 100\n乙 | N4 | 2026-10-01 | 100 | 200';
  const r = C.parseBatch(text, 'USD');
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].dueDate, '2026-10-05');
  assert.equal(r.rows[0].amount, 12000);
  assert.equal(r.rows[0].paid, 2000);
  assert.equal(r.rows[0].currency, 'USD');
  assert.equal(r.rows[1].paid, 0);
  assert.deepEqual(r.errors.map((e) => e.line), [4, 5, 6]);
  assert.match(r.errors[0].reason, /4 或 5 列/);
  assert.match(r.errors[1].reason, /到期日/);
  assert.match(r.errors[2].reason, /已收金额大于应收/);
});

test('buildBill 校验必填、金额、币种与日期顺序', () => {
  const ok = { client: ' 甲 ', no: 'N', dueDate: '2026-10-20', amount: '100', currency: 'usd' };
  const r = C.buildBill(ok);
  assert.equal(r.ok, true);
  assert.equal(r.bill.client, '甲');
  assert.equal(r.bill.currency, 'USD');
  assert.equal(C.buildBill(Object.assign({}, ok, { client: ' ' })).ok, false);
  assert.equal(C.buildBill(Object.assign({}, ok, { amount: '-5' })).ok, false);
  assert.equal(C.buildBill(Object.assign({}, ok, { amount: '1.005' })).ok, false);
  assert.equal(C.buildBill(Object.assign({}, ok, { currency: '人民币' })).ok, false);
  assert.equal(C.buildBill(Object.assign({}, ok, { issueDate: '2026-11-01' })).ok, false);
  assert.equal(C.buildBill(Object.assign({}, ok, { lastFollow: 'abc' })).ok, false);
});

test('mergeBills 分配唯一 id,并跳过客户+账单号重复的行', () => {
  const a = C.buildBill({ client: '甲', no: '1', dueDate: '2026-10-01', amount: 10 }).bill;
  const b = C.buildBill({ client: '甲', no: '2', dueDate: '2026-10-01', amount: 10 }).bill;
  const first = C.mergeBills([], [a, b, a]);
  assert.equal(first.added, 2);
  assert.equal(first.skipped.length, 1);
  assert.equal(new Set(first.bills.map((x) => x.id)).size, 2);
  const second = C.mergeBills(first.bills, [b]);
  assert.equal(second.added, 0);
});

test('parseCsv 处理引号、逗号、换行、BOM 与制表符', () => {
  const t = C.parseCsv('﻿客户,账单号,备注\r\n"甲, 乙",N1,"第一行\n第二行 ""引用"""\r\n丙,N2,\r\n');
  assert.deepEqual(t.headers, ['客户', '账单号', '备注']);
  assert.equal(t.rows.length, 2);
  assert.equal(t.rows[0][0], '甲, 乙');
  assert.equal(t.rows[0][2], '第一行\n第二行 "引用"');
  const tsv = C.parseCsv('a\tb\n1\t2');
  assert.deepEqual(tsv.rows[0], ['1', '2']);
});

test('mapCsv 按列映射建账单,缺必需映射时报错,坏行带行号', () => {
  const t = C.parseCsv('公司,发票号,Due,金额,Cur\n甲,N1,2026-10-01,100,usd\n乙,N2,bad,50,\n丙,N3,2026-10-02,70,');
  const m = C.guessMapping(t.headers);
  assert.equal(m.client, 0);
  assert.equal(m.no, 1);
  assert.equal(m.dueDate, 2);
  assert.equal(m.amount, 3);
  assert.equal(m.currency, 4);
  assert.equal(m.paid, -1);
  const r = C.mapCsv(t, m, 'CNY');
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].currency, 'USD');
  assert.equal(r.rows[1].currency, 'CNY', '币种列为空时用默认币种');
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].line, 3);
  const miss = C.mapCsv(t, Object.assign({}, m, { dueDate: -1 }), 'CNY');
  assert.equal(miss.rows.length, 0);
  assert.match(miss.errors[0].reason, /到期日/);
});

test('CSV 公式防护:= + - @ 开头加单引号,单独的 - 或 + 不算,数字不受影响', () => {
  assert.equal(C.csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(C.csvCell('+86 1380000'), "'+86 1380000");
  assert.equal(C.csvCell('-5 折'), "'-5 折");
  assert.equal(C.csvCell('@cmd'), "'@cmd");
  assert.equal(C.csvCell('-'), '-');
  assert.equal(C.csvCell('+'), '+');
  assert.equal(C.csvCell('正常'), '正常');
  assert.equal(C.csvCell(-12.5), '-12.5');
  assert.equal(C.csvCell('a,b'), '"a,b"');
  assert.equal(C.csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(C.csvCell('=1,2'), '"\'=1,2"');
});

test('导出的 CSV 与 Markdown 对用户字段做公式防护和管道符转义', () => {
  const evil = due(40, { client: '=HYPERLINK("x")', no: 'a|b', dispute: '@争议' });
  const report = C.agingReport([evil], TODAY);
  const csv = C.agingCsv(report, 'detail');
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'));
  const md = C.toMarkdown(report);
  assert.ok(md.includes("'=HYPERLINK"));
  assert.ok(md.includes('a\\|b'));
  const fcsv = C.followCsv(C.followUpList([evil], TODAY, 7), TODAY, C.DEFAULT_TEMPLATE);
  assert.ok(fcsv.includes("'@争议"));
  assert.ok(fcsv.startsWith('客户,账单号'));
});

test('账龄 CSV 汇总含各桶和合计,Markdown 含币种分节与免换算说明', () => {
  const r = C.agingReport([due(5, { amount: 100 }), due(95, { no: 'N2', amount: 20, currency: 'USD' })], TODAY);
  const csv = C.agingCsv(r, 'summary').split('\r\n');
  assert.equal(csv[0], '币种,账龄,笔数,金额');
  assert.ok(csv.includes('CNY,合计,1,100'));
  assert.ok(csv.includes('USD,逾期 90 天以上,1,20'));
  const md = C.toMarkdown(r);
  assert.ok(md.includes('## CNY') && md.includes('## USD') && md.includes('未做汇率换算'));
  assert.ok(C.toMarkdown(C.agingReport([], TODAY)).includes('没有余额大于 0'));
});

test('resolveToday:合法日期生效,非法回退且不抛错', () => {
  assert.equal(C.resolveToday('?today=2026-10-20', '2030-01-01'), '2026-10-20');
  assert.equal(C.resolveToday('?today=2026-02-30', '2030-01-01'), '2030-01-01');
  assert.equal(C.resolveToday('?today=abc', '2030-01-01'), '2030-01-01');
  assert.equal(C.resolveToday('?today=2026-1-5', '2030-01-01'), '2030-01-01');
  assert.equal(C.resolveToday('', '2030-01-01'), '2030-01-01');
  assert.equal(C.resolveToday(undefined, '2030-01-01'), '2030-01-01');
});

test('日期工具跨月跨年、闰年', () => {
  assert.equal(C.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(C.daysBetween('2028-02-28', '2028-03-01'), 2);
  assert.equal(C.parseDate('2026/1/5'), '2026-01-05');
  assert.equal(C.parseDate('2026-02-29'), null);
});

test('validateImport:合法备份往返一致', () => {
  const b = C.buildBill({ client: '甲', no: '1', dueDate: '2026-10-01', amount: 100, paid: 10 }).bill;
  b.id = 'b1';
  const json = C.exportJson([b], { template: 'T {客户}', n: 5 });
  const v = C.validateImport(json);
  assert.equal(v.ok, true);
  assert.deepEqual(v.data.bills, [b]);
  assert.deepEqual(v.data.settings, { template: 'T {客户}', n: 5 });
});

test('validateImport:类型、枚举、重复 ID、金额、日期不合法一律整份拒绝', () => {
  const good = () => JSON.parse(C.exportJson([Object.assign(C.buildBill({ client: '甲', no: '1', dueDate: '2026-10-01', amount: 100 }).bill, { id: 'b1' })], { template: 'T', n: 7 }));
  const bad = (mut, re) => {
    const o = good(); mut(o);
    const v = C.validateImport(o);
    assert.equal(v.ok, false);
    assert.match(v.error, re);
  };
  assert.equal(C.validateImport('{not json').ok, false);
  assert.equal(C.validateImport('[]').ok, false);
  bad((o) => { o.version = 3; }, /版本/);
  bad((o) => { o.bills[0].amount = '100'; }, /应收金额/);
  bad((o) => { o.bills[0].amount = -1; }, /应收金额/);
  bad((o) => { o.bills[0].paid = 101; }, /已收金额/);
  bad((o) => { o.bills[0].currency = 'cny'; }, /币种/);
  bad((o) => { o.bills[0].dueDate = '2026-13-01'; }, /到期日/);
  bad((o) => { o.bills[0].dueDate = '2026/10/01'; }, /到期日/);
  bad((o) => { o.bills[0].id = ''; }, /id/);
  bad((o) => { o.bills.push(Object.assign({}, o.bills[0], { no: '2' })); }, /id 重复/);
  bad((o) => { o.bills.push(Object.assign({}, o.bills[0], { id: 'b2' })); }, /重复/);
  bad((o) => { o.bills[0].payments = [{ date: '2026-10-01', amount: 0 }]; }, /收款记录/);
  bad((o) => { o.bills[0].follows = [{ date: '2026-10-01' }]; }, /跟进记录/);
  bad((o) => { o.settings.n = 1.5; }, /跟进间隔/);
  bad((o) => { o.settings.template = ''; }, /模板/);
});

test('recordFollow 补录更早日期不会让原有最近跟进倒退(无历史明细)', () => {
  const b = bill({ lastFollow: '2026-10-19', follows: [] });
  const r = C.recordFollow(b, { date: '2026-10-01', note: '补录' });
  assert.equal(r.bill.lastFollow, '2026-10-19');
  const list = C.followUpList([Object.assign({}, r.bill, { dueDate: '2026-09-01' })], TODAY, 7);
  assert.equal(list[0].needsFollow, false);
  assert.equal(C.recordFollow(b, { date: '2026-10-20', note: '' }).bill.lastFollow, '2026-10-20');
});

test('编辑账单不能改写付款与跟进历史派生的汇总', () => {
  let b = C.buildBill({ client: '甲', no: '1', dueDate: '2026-12-01', amount: 100, paid: 20, lastFollow: '2026-09-01' }).bill;
  b.id = 'b1';
  b = C.addPayment(b, { date: '2026-10-01', amount: 30 }).bill;
  b = C.recordFollow(b, { date: '2026-10-10', note: '电话' }).bill;
  const edited = C.buildBill({ client: '甲', no: '1', dueDate: '2026-12-01', amount: 100, paid: 10, lastFollow: '2026-08-01' }, b);
  assert.equal(edited.ok, true);
  assert.equal(edited.bill.openingPaid, 20);
  assert.equal(edited.bill.paid, 50);
  assert.equal(edited.bill.openingLastFollow, '2026-09-01');
  assert.equal(edited.bill.lastFollow, '2026-10-10');
  assert.equal(edited.bill.payments.length, 1);
  assert.equal(edited.bill.follows.length, 1);
});

test('version 1 标量旧账迁移成显式起点,不伪造事件', () => {
  const legacy = { version: 1, bills: [bill({ paid: 25, lastFollow: '2026-09-09' })], settings: { template: 'T', n: 7 } };
  const v = C.validateImport(legacy);
  assert.equal(v.ok, true);
  assert.equal(v.data.bills[0].openingPaid, 25);
  assert.equal(v.data.bills[0].openingLastFollow, '2026-09-09');
  assert.deepEqual(v.data.bills[0].payments, []);
  assert.deepEqual(v.data.bills[0].follows, []);
});

test('version 1 部分历史保留差额和较新的标量日期作为显式起点', () => {
  const legacy = { version: 1, bills: [bill({
    paid: 50,
    payments: [{ date: '2026-10-01', amount: 20 }],
    lastFollow: '2026-10-15',
    follows: [{ date: '2026-10-10', note: '电话' }]
  })], settings: { template: 'T', n: 7 } };
  const v = C.validateImport(legacy);
  assert.equal(v.ok, true);
  assert.equal(v.data.bills[0].openingPaid, 30);
  assert.equal(v.data.bills[0].paid, 50);
  assert.equal(v.data.bills[0].openingLastFollow, '2026-10-15');
  assert.equal(v.data.bills[0].lastFollow, '2026-10-15');
  assert.equal(v.data.bills[0].payments.length, 1);
  assert.equal(v.data.bills[0].follows.length, 1);
});

test('version 1 有历史时以历史为依据,矛盾汇总整份拒绝且不改输入', () => {
  const paidConflict = { version: 1, bills: [bill({ paid: 10, payments: [{ date: '2026-10-01', amount: 80 }] })], settings: { template: 'T', n: 7 } };
  const before = JSON.stringify(paidConflict);
  const pv = C.validateImport(paidConflict);
  assert.equal(pv.ok, false);
  assert.match(pv.error, /矛盾/);
  assert.equal(JSON.stringify(paidConflict), before);
  const followConflict = { version: 1, bills: [bill({ lastFollow: '2026-09-01', follows: [{ date: '2026-10-10', note: '电话' }] })], settings: { template: 'T', n: 7 } };
  const fv = C.validateImport(followConflict);
  assert.equal(fv.ok, false);
  assert.match(fv.error, /矛盾/);
});

test('version 2 起点与事件混合后可往返,补录旧跟进不让日期倒退', () => {
  let b = C.buildBill({ client: '甲', no: '1', dueDate: '2026-12-01', amount: 100, paid: 10, lastFollow: '2026-09-01' }).bill;
  b.id = 'b1';
  b = C.addPayment(b, { date: '2026-10-01', amount: 20 }).bill;
  b = C.recordFollow(b, { date: '2026-10-10', note: '电话' }).bill;
  b = C.recordFollow(b, { date: '2026-08-01', note: '补录' }).bill;
  const json = C.exportJson([b], { template: 'T', n: 7 });
  assert.equal(JSON.parse(json).version, 2);
  const v = C.validateImport(json);
  assert.equal(v.ok, true);
  assert.equal(v.data.bills[0].paid, 30);
  assert.equal(v.data.bills[0].lastFollow, '2026-10-10');
  assert.equal(v.data.bills[0].payments.length, 1);
  assert.equal(v.data.bills[0].follows.length, 2);
});

test('金额边界明确:零起点允许,负数退款拒绝,超过上限和非有限值不被舍入', () => {
  const zero = C.buildBill({ client: '甲', no: '1', dueDate: TODAY, amount: 100, paid: 0 });
  assert.equal(zero.ok, true);
  assert.equal(zero.bill.openingPaid, 0);
  assert.equal(C.addPayment(zero.bill, { date: TODAY, amount: -1 }).ok, false);
  assert.equal(C.addPayment(zero.bill, { date: TODAY, amount: Infinity }).ok, false);
  assert.equal(C.buildBill({ client: '甲', no: '2', dueDate: TODAY, amount: C.MAX_MONEY + 1 }).ok, false);
  assert.equal(C.buildBill({ client: '甲', no: '3', dueDate: TODAY, amount: Infinity }).ok, false);
});

test('金额字符串在安全上限附近保持 .01 与 .99 的精确分值', () => {
  const a = C.buildBill({ client: '甲', no: 'A', dueDate: TODAY, amount: '8999999999999.01' });
  const b = C.buildBill({ client: '甲', no: 'B', dueDate: TODAY, amount: '8999999999999.99' });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(BigInt(Math.round(a.bill.amount * 100)), 899999999999901n);
  assert.equal(BigInt(Math.round(b.bill.amount * 100)), 899999999999999n);
  const unsafe = C.buildBill({ client: '甲', no: 'C', dueDate: TODAY, amount: '89999999999999.99' });
  assert.equal(unsafe.ok, false);
  assert.match(unsafe.error, /上限/);
});

test('同币种汇总按整数分与 BigInt 参考一致,超过单币种总额上限则明确拒绝', () => {
  const one = due(1, { id: 'a', no: 'A', amount: 3000000000000.01 });
  const two = due(1, { id: 'b', no: 'B', amount: 2000000000000.99 });
  const ok = C.agingReport([one, two], TODAY);
  assert.equal(ok.error, undefined);
  assert.equal(BigInt(ok.groups[0].cents), 300000000000001n + 200000000000099n);
  assert.equal(ok.groups[0].total, 5000000000001);
  const tooLarge = C.agingReport([
    due(1, { id: 'x', no: 'X', amount: 4500000000000.01 }),
    due(1, { id: 'y', no: 'Y', amount: 4500000000000.01 })
  ], TODAY);
  assert.match(tooLarge.error, /超过.*拆分数据/);
  assert.deepEqual(tooLarge.groups, []);
});

test('parseCsv 引号未闭合时整份拒绝,mapCsv 不产出任何账单', () => {
  const t = C.parseCsv('客户,账单号,到期日,应收,已收\n甲,N1,2026-10-01,100,"20');
  assert.match(t.error, /引号没有闭合/);
  const m = C.mapCsv(t, { client: 0, no: 1, dueDate: 2, amount: 3, paid: 4 }, 'CNY');
  assert.equal(m.ok, false);
  assert.equal(m.rows.length, 0);
  assert.match(m.errors[0].reason, /引号/);
  assert.equal(C.parseCsv('a,b\n"x,y",z').error, undefined);
});

test('mapCsv:任一行有错误则 ok=false(界面据此禁用导入),全部合法才 ok', () => {
  const head = '客户,账单号,到期日,应收\n';
  const good = C.mapCsv(C.parseCsv(head + '甲,1,2026-10-01,10\n乙,2,2026-10-02,20'), { client: 0, no: 1, dueDate: 2, amount: 3 }, 'CNY');
  assert.equal(good.ok, true);
  const mixed = C.mapCsv(C.parseCsv(head + '甲,1,2026-10-01,10\n乙,2,坏日期,20'), { client: 0, no: 1, dueDate: 2, amount: 3 }, 'CNY');
  assert.equal(mixed.ok, false);
  assert.equal(mixed.rows.length, 1);
  assert.equal(mixed.errors.length, 1);
  assert.equal(C.mapCsv(C.parseCsv(head), { client: 0, no: 1, dueDate: 2, amount: 3 }, 'CNY').ok, false, '没有数据行也不算可导入');
});

test('validateSettings 与导入共用:模板 2000 字可以、2001 字拒绝,保存前后一致', () => {
  assert.equal(C.validateSettings({ template: 'x'.repeat(2000), n: 7 }), null);
  assert.match(C.validateSettings({ template: 'x'.repeat(2001), n: 7 }), /2000/);
  assert.ok(C.validateSettings({ template: '  ', n: 7 }));
  assert.ok(C.validateSettings({ template: 'a', n: 366 }));
  const b = Object.assign(C.buildBill({ client: '甲', no: '1', dueDate: '2026-10-01', amount: 1 }).bill, { id: 'b1' });
  assert.equal(C.validateImport(C.exportJson([b], { template: 'x'.repeat(2000), n: 7 })).ok, true);
  assert.equal(C.validateImport(C.exportJson([b], { template: 'x'.repeat(2001), n: 7 })).ok, false);
});

test('followCsv 只对今天要跟的账单生成提醒草稿', () => {
  const list = C.followUpList([due(20, { no: 'T1' }), due(20, { no: 'D1', dispute: '争议中' })], TODAY, 7);
  const csv = C.followCsv(list, TODAY, '催 {账单号}');
  const lines = csv.trim().split('\r\n');
  assert.ok(lines.find((l) => l.includes('T1') && l.endsWith('催 T1')));
  const dl = lines.find((l) => l.includes('D1'));
  assert.ok(dl.includes('有争议,人工处理'));
  assert.ok(!dl.includes('催 D1'));
});

test('importSummary 统计现有与备份的账单、收款、跟进数量,供导入确认前预览', () => {
  const a = [bill({ id: 'x1', payments: [{ date: TODAY, amount: 10 }], follows: [{ date: TODAY, note: '' }, { date: TODAY, note: 'n' }] })];
  const b = [bill({ id: 'y1' }), bill({ id: 'y2', no: 'N2', payments: [{ date: TODAY, amount: 5 }] })];
  const s = C.importSummary({ bills: a }, { bills: b });
  assert.deepStrictEqual(s.current, { bills: 1, payments: 1, follows: 2 });
  assert.deepStrictEqual(s.incoming, { bills: 2, payments: 1, follows: 0 });
  assert.match(s.text, /现有 1 张账单、1 笔收款、2 条跟进记录.*备份文件 2 张账单、1 笔收款、0 条跟进记录/);
});

test('settingsAreDefault:模板或间隔偏离默认值就算用户设置', () => {
  assert.strictEqual(C.settingsAreDefault({ template: C.DEFAULT_TEMPLATE, n: C.DEFAULT_N }), true);
  assert.strictEqual(C.settingsAreDefault({ template: C.DEFAULT_TEMPLATE + '!', n: C.DEFAULT_N }), false);
  assert.strictEqual(C.settingsAreDefault({ template: C.DEFAULT_TEMPLATE, n: 3 }), false);
});

test('合成示例标记写进 JSON 备份并能读回;非布尔值整份拒绝', () => {
  const st = { bills: [bill()], settings: { template: C.DEFAULT_TEMPLATE, n: 7 } };
  const withFlag = C.validateImport(C.exportJson(st.bills, st.settings, true));
  assert.strictEqual(withFlag.ok, true);
  assert.strictEqual(withFlag.data.sample, true);
  const without = C.validateImport(C.exportJson(st.bills, st.settings));
  assert.strictEqual(without.data.sample, false);
  assert.strictEqual(JSON.parse(C.exportJson(st.bills, st.settings)).sample, undefined);
  const bad = JSON.parse(C.exportJson(st.bills, st.settings)); bad.sample = 'yes';
  assert.strictEqual(C.validateImport(bad).ok, false);
});

test('[W6 导入] checkTextFile:空文件与无法按 UTF-8 解码的文件被拒绝并给出原因,正常文本放行', () => {
  const empty = C.checkTextFile('');
  assert.strictEqual(empty.ok, false);
  assert.strictEqual(empty.code, 'empty');
  assert.match(empty.message, /空/);
  assert.strictEqual(C.checkTextFile(' \r\n\t').code, 'empty');
  assert.strictEqual(C.checkTextFile('\uFEFF').code, 'empty');
  assert.strictEqual(C.checkTextFile(null).code, 'empty');
  const enc = C.checkTextFile('abc,def\n\u0007\uFFFD\uFFFD,x');
  assert.strictEqual(enc.ok, false);
  assert.strictEqual(enc.code, 'encoding');
  assert.match(enc.message, /UTF-8/);
  // 只有表头、不像表格的普通文本不在这里拦:交给各产品自己的解析规则报错
  assert.deepStrictEqual(C.checkTextFile('a,b'), { ok: true, code: '', message: '' });
  assert.strictEqual(C.checkTextFile('{broken json').ok, true);
});
