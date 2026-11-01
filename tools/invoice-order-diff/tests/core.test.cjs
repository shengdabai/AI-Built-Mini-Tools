'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const OM = { orderNo: 0, name: 1, qty: 2, price: 3, amount: 4 };
const IM = { invoiceNo: 0, orderNo: 1, name: 2, qty: 3, price: 4, tax: 5, amount: 6 };
const MAP = { orders: OM, invoices: IM };

function run(orderRows, invRows, options) {
  const o = C.parseTable('订单号\t品名\t数量\t单价\t金额\n' + orderRows.map((r) => r.join('\t')).join('\n'));
  const i = C.parseTable('发票号\t订单号\t品名\t数量\t单价\t税额\t金额\n' + invRows.map((r) => r.join('\t')).join('\n'));
  return C.reconcile(o, i, MAP, options);
}
const codes = (res, level) => res.issues.filter((x) => !level || x.level === level).map((x) => x.code).sort();

test('parseTable 识别制表符、逗号、分号', () => {
  assert.equal(C.parseTable('a\tb\n1\t2').delimiter, '\t');
  assert.equal(C.parseTable('a,b\n1,2').delimiter, ',');
  const semi = C.parseTable('a;b\n1;2');
  assert.equal(semi.delimiter, ';');
  assert.deepEqual(semi.rows[0].cells, ['1', '2']);
});

test('parseTable 处理引号内的分隔符、双引号转义、换行与 BOM,行号以表头为第 1 行', () => {
  const t = C.parseTable('﻿x,y\n"1,5","say ""hi"""\n\n"a\nb",3\n');
  assert.deepEqual(t.headers, ['x', 'y']);
  assert.equal(t.rows.length, 2);
  assert.deepEqual(t.rows[0].cells, ['1,5', 'say "hi"']);
  assert.equal(t.rows[0].row, 2);
  assert.equal(t.rows[1].cells[0], 'a\nb');
  assert.equal(t.rows[1].row, 4);
});

test('parseTable 空输入与未闭合引号不抛错', () => {
  assert.deepEqual(C.parseTable('').rows, []);
  assert.deepEqual(C.parseTable('   \n  ').headers, []);
  assert.deepEqual(C.parseTable(null).headers, []);
  assert.ok(C.parseTable('a,b\n"x,1').error.length > 0);
});

test('normalizeNumber 支持千分位、货币符号、全角、括号负数', () => {
  assert.equal(C.normalizeNumber('1,234.50'), 1234.5);
  assert.equal(C.normalizeNumber('¥1,000'), 1000);
  assert.equal(C.normalizeNumber('￥ 88.8'), 88.8);
  assert.equal(C.normalizeNumber('１２３．４５'), 123.45);
  assert.equal(C.normalizeNumber('(200.00)'), -200);
  assert.equal(C.normalizeNumber('-5'), -5);
  assert.equal(C.normalizeNumber('－5'), -5);
  assert.equal(C.normalizeNumber('300元'), 300);
  assert.equal(C.normalizeNumber(12), 12);
});

test('normalizeNumber 对非法值返回 null', () => {
  for (const bad of ['', '  ', 'abc', '1,23', '12.3.4', '1,2345', '--1', null, undefined, NaN, '1e3', '12%']) {
    assert.equal(C.normalizeNumber(bad), null, String(bad));
  }
});

test('guessMapping 命中常见列名并区分发票号与订单号', () => {
  const h = ['发票号码', '对应订单号', '货物名称', '数量', '单价', '税额', '不含税金额'];
  assert.equal(C.guessMapping(h, 'invoiceNo'), 0);
  assert.equal(C.guessMapping(h, 'orderNo'), 1);
  assert.equal(C.guessMapping(h, 'name'), 2);
  assert.equal(C.guessMapping(h, 'qty'), 3);
  assert.equal(C.guessMapping(h, 'price'), 4);
  assert.equal(C.guessMapping(h, 'tax'), 5);
  assert.equal(C.guessMapping(h, 'amount'), 6, '「不含税金额」是金额不是税额');
  assert.equal(C.guessMapping(['PO', '合计'], 'orderNo'), 0);
  assert.equal(C.guessMapping(['Invoice No', 'Order No', 'Amount'], 'invoiceNo'), 0);
});

test('guessMapping 未命中或角色非法返回 -1', () => {
  assert.equal(C.guessMapping(['甲', '乙'], 'amount'), -1);
  assert.equal(C.guessMapping(['订单金额'], 'orderNo'), -1);
  assert.equal(C.guessMapping(['x'], 'nonsense'), -1);
  assert.equal(C.guessMapping(null, 'amount'), -1);
});

test('完全一致的订单与发票没有任何问题', () => {
  const r = run([['PO1', '纸', '10', '5', '50']], [['I1', 'PO1', '纸', '10', '5', '6.50', '50']]);
  assert.equal(r.issues.length, 0);
  assert.equal(r.pairs.length, 1);
  assert.equal(r.pairs[0].status, 'ok');
  assert.equal(r.summary.diff, 0);
});

test('金额容差:恰好等于绝对容差视为一致,超出 0.01 阻断', () => {
  let r = run([['PO1', '', '', '', '100.00']], [['I1', 'PO1', '', '', '', '', '100.01']], { tolAbs: 0.01, tolPct: 0, taxRate: null });
  assert.equal(r.issues.filter((x) => x.code === 'amountDiff').length, 0);
  r = run([['PO1', '', '', '', '100.00']], [['I1', 'PO1', '', '', '', '', '100.02']], { tolAbs: 0.01, tolPct: 0, taxRate: null });
  assert.equal(r.issues.filter((x) => x.code === 'amountDiff').length, 1);
  assert.equal(r.pairs[0].status, 'block');
});

test('金额容差:百分比容差边界(0.5% of 200 = 1.00)', () => {
  const opt = { tolAbs: 0, tolPct: 0.5, taxRate: null };
  let r = run([['PO1', '', '', '', '200']], [['I1', 'PO1', '', '', '', '', '201']], opt);
  assert.equal(codes(r, 'block').length, 0, '恰好 1.00 一致');
  r = run([['PO1', '', '', '', '200']], [['I1', 'PO1', '', '', '', '', '201.01']], opt);
  assert.deepEqual(codes(r, 'block'), ['amountDiff']);
});

test('重复发票号:阻断一次并标出所有行,配对也被标记', () => {
  const r = run(
    [['PO1', '', '', '', '10'], ['PO2', '', '', '', '20']],
    [['I9', 'PO1', '', '', '', '', '10'], ['I9', 'PO2', '', '', '', '', '20']],
    { taxRate: null });
  const dup = r.issues.filter((x) => x.code === 'dupInvoice');
  assert.equal(dup.length, 1);
  assert.deepEqual(dup[0].invoiceRows, [2, 3]);
  assert.ok(r.pairs.every((p) => p.status === 'block'));
});

test('发票的订单号不在订单表:阻断;订单没有发票:警告', () => {
  const r = run([['PO1', '', '', '', '10'], ['PO2', '', '', '', '20']], [['I1', 'PO1', '', '', '', '', '10'], ['I2', 'PO404', '', '', '', '', '5']], { taxRate: null });
  assert.ok(codes(r, 'block').includes('noOrder'));
  assert.ok(codes(r, 'warn').includes('noInvoice'));
  assert.equal(r.unmatchedInvoices.length, 1);
  assert.equal(r.unmatchedOrders.length, 1);
  assert.equal(r.unmatchedOrders[0].orderNo, 'PO2');
});

test('订单号比较忽略大小写、空白与全角差异', () => {
  const r = run([['ＰＯ-1', '', '', '', '10']], [['I1', ' po-1 ', '', '', '', '', '10']], { taxRate: null });
  assert.equal(r.pairs.length, 1);
  assert.equal(codes(r, 'block').length, 0);
});

test('数量差与单价差阻断,留空的数量不比较', () => {
  let r = run([['PO1', '', '10', '5', '50']], [['I1', 'PO1', '', '9', '5', '', '50']], { taxRate: null });
  assert.deepEqual(codes(r, 'block'), ['qtyDiff']);
  r = run([['PO1', '', '10', '5', '50']], [['I1', 'PO1', '', '10', '5.5', '', '50']], { taxRate: null });
  assert.deepEqual(codes(r, 'block'), ['priceDiff']);
  r = run([['PO1', '', '10', '5', '50']], [['I1', 'PO1', '', '', '', '', '50']], { taxRate: null });
  assert.equal(r.issues.length, 0);
});

test('税额检查:偏差警告;税率留空则跳过;税额为空不查', () => {
  const o = [['PO1', '', '', '', '1000']];
  let r = run(o, [['I1', 'PO1', '', '', '', '90', '1000']], { taxRate: 13 });
  assert.deepEqual(codes(r, 'warn'), ['taxDiff']);
  r = run(o, [['I1', 'PO1', '', '', '', '90', '1000']], { taxRate: null });
  assert.equal(r.issues.length, 0);
  r = run(o, [['I1', 'PO1', '', '', '', '130', '1000']], { taxRate: 13 });
  assert.equal(r.issues.length, 0);
  r = run(o, [['I1', 'PO1', '', '', '', '', '1000']], { taxRate: 13 });
  assert.equal(r.issues.length, 0);
});

test('同订单多行:先按品名配对,剩余按顺序', () => {
  const r = run(
    [['PO1', '甲', '', '', '10'], ['PO1', '乙', '', '', '20']],
    [['I1', 'PO1', '乙', '', '', '', '20'], ['I2', 'PO1', '甲', '', '', '', '10']],
    { taxRate: null });
  assert.equal(r.pairs.length, 2);
  assert.equal(r.issues.length, 0, '按品名交叉配对后金额都一致');
  const r2 = run(
    [['PO1', '甲', '', '', '10'], ['PO1', '乙', '', '', '20']],
    [['I1', 'PO1', '丙', '', '', '', '10'], ['I2', 'PO1', '丁', '', '', '', '20']],
    { taxRate: null });
  assert.equal(r2.pairs.length, 2, '品名都不同时按顺序配对');
  assert.deepEqual(codes(r2, 'warn'), ['nameDiff', 'nameDiff']);
});

test('发票行多于订单行:多出的一行阻断', () => {
  const r = run([['PO1', '甲', '', '', '10']], [['I1', 'PO1', '甲', '', '', '', '10'], ['I2', 'PO1', '甲', '', '', '', '10']], { taxRate: null });
  assert.ok(codes(r, 'block').includes('extraInvoice'));
  assert.equal(r.pairs.length, 1);
});

test('按「订单号+品名」匹配:品名不同的 1:1 不配对', () => {
  const rows = [['PO1', '甲', '', '', '10']];
  const inv = [['I1', 'PO1', '乙', '', '', '', '10']];
  const loose = run(rows, inv, { taxRate: null });
  assert.equal(loose.pairs.length, 1);
  const strict = run(rows, inv, { taxRate: null, matchByName: true });
  assert.equal(strict.pairs.length, 0);
  assert.deepEqual(codes(strict).sort(), ['noInvoice', 'noOrderLine', 'totalDiff'].filter((c) => c !== 'totalDiff'));
});

test('品名半角全角差异不算不一致,真正不同才警告', () => {
  const same = run([['PO1', 'ＵＳＢ 键盘', '', '', '10']], [['I1', 'PO1', 'usb键盘', '', '', '', '10']], { taxRate: null });
  assert.equal(same.issues.length, 0);
  const diff = run([['PO1', '鼠标', '', '', '10']], [['I1', 'PO1', '无线鼠标', '', '', '', '10']], { taxRate: null });
  assert.deepEqual(codes(diff, 'warn'), ['nameDiff']);
});

test('汇总:合计、差额与汇总级警告', () => {
  const r = run([['PO1', '', '', '', '100'], ['PO2', '', '', '', '50']], [['I1', 'PO1', '', '', '', '', '100']], { taxRate: null });
  assert.equal(r.summary.orderTotal, 150);
  assert.equal(r.summary.invoiceTotal, 100);
  assert.equal(r.summary.diff, -50);
  assert.equal(r.summary.orderCount, 2);
  assert.equal(r.summary.invoiceCount, 1);
  assert.equal(r.summary.paired, 1);
  assert.ok(codes(r, 'warn').includes('totalDiff'));
  assert.equal(r.summary.warnCount, 2);
  assert.equal(r.summary.blockCount, 0);
});

test('金额无法识别:阻断而不是当成 0', () => {
  const r = run([['PO1', '', '', '', 'abc']], [['I1', 'PO1', '', '', '', '', '100']], { taxRate: null });
  assert.deepEqual(codes(r, 'block'), ['badAmount']);
});

test('缺少必选列映射时返回 error,不抛错', () => {
  const t = C.parseTable('a,b\n1,2');
  const r = C.reconcile(t, t, { orders: { orderNo: 0 }, invoices: {} }, {});
  assert.ok(r.error.includes('金额'));
  assert.equal(r.pairs.length, 0);
});

test('空表不报错', () => {
  const e = C.parseTable('');
  const r = C.reconcile(e, e, MAP, {});
  assert.equal(r.error, '');
  assert.equal(r.summary.paired, 0);
  assert.equal(r.issues.length, 0);
  assert.equal(r.summary.diff, 0);
  assert.doesNotThrow(() => C.reconcile(null, undefined, MAP));
});

test('订单号为 __proto__ / constructor 不破坏分组', () => {
  const r = run(
    [['__proto__', '', '', '', '10'], ['constructor', '', '', '', '20']],
    [['I1', '__proto__', '', '', '', '', '10'], ['I2', 'constructor', '', '', '', '', '20']],
    { taxRate: null });
  assert.equal(r.pairs.length, 2);
  assert.equal(r.issues.length, 0);
});

test('toCsv 转义逗号、引号、换行,并给公式开头加单引号', () => {
  const csv = C.toCsv([['a,b', 'say "x"', 'l1\nl2'], ['=SUM(A1)', '+1', '-1'], ['@cmd', '-', '+'], [-2.5, 0, '']]);
  const lines = csv.split('\n');
  assert.equal(lines[0], '"a,b","say ""x""","l1');
  assert.equal(lines[1], 'l2"');
  assert.equal(lines[2], "'=SUM(A1),'+1,'-1");
  assert.equal(lines[3], "'@cmd,-,+");
  assert.equal(lines[4], '-2.5,0,');
});

test('待复核清单 CSV 对用户字段做公式防护', () => {
  const r = run([['=HYPERLINK("x")', '', '', '', '10']], [], { taxRate: null });
  const csv = C.toCsv(C.reviewRows(r));
  assert.ok(csv.includes('\'=HYPERLINK'), csv);
  assert.ok(!/(^|,)=HYPERLINK/m.test(csv));
});

test('toMarkdown 含参数、汇总、阻断与警告,表格里转义竖线和公式', () => {
  const r = run([['PO|1', '', '', '', '10'], ['=X', '', '', '', '5']], [['I1', 'PO|1', '', '', '', '', '12']], { tolAbs: 0.05, tolPct: 1, taxRate: 9 });
  const md = C.toMarkdown(r);
  assert.ok(md.includes('金额容差(绝对值):0.05'));
  assert.ok(md.includes('税率期望值:9%'));
  assert.ok(md.includes('## 阻断(1)'));
  assert.ok(md.includes('PO\\|1'));
  assert.ok(md.includes("'=X"));
  assert.ok(md.includes('差额(发票 - 订单,元)'));
  assert.ok(md.includes('订单行数') && md.includes('已配对行数'));
  const none = C.toMarkdown(run([['P', '', '', '', '1']], [['I', 'P', '', '', '', '', '1']], { taxRate: null }));
  assert.ok(none.includes('无。'));
  assert.ok(none.includes('未设置,不检查税额'));
});

test('pairRows 包含配对、无发票订单和无订单发票', () => {
  const r = run([['PO1', '', '', '', '10'], ['PO2', '', '', '', '5']], [['I1', 'PO1', '', '', '', '', '10'], ['I2', 'NONE', '', '', '', '', '3']], { taxRate: null });
  const rows = C.pairRows(r);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.slice(1).map((x) => x[0]).sort(), ['正常', '警告', '阻断'].sort());
});

test('P0 列数与表头不一致:整表拒绝核对并报告行号', () => {
  const o = C.parseTable('订单号,金额\nPO1,1,234');
  assert.ok(o.error.includes('第 2 行有 3 列'), o.error);
  const i = C.parseTable('发票号,订单号,金额\nI1,PO1,1');
  const r = C.reconcile(o, i, { orders: { orderNo: 0, amount: 1 }, invoices: { invoiceNo: 0, orderNo: 1, amount: 2 } }, { taxRate: null });
  assert.ok(r.error.includes('订单表') && r.error.includes('第 2 行'), r.error);
  assert.equal(r.pairs.length, 0);
  assert.equal(C.parseTable('订单号,金额\nPO1,"1,234"').error, '', '引号包住的千分位列数正确');
});

test('P0 引号未闭合的输入表不能核对', () => {
  const o = C.parseTable('订单号,金额\nPO1,"100');
  const i = C.parseTable('发票号,订单号,金额\nI1,PO1,100');
  assert.ok(o.error.length > 0);
  const r = C.reconcile(o, i, { orders: { orderNo: 0, amount: 1 }, invoices: { invoiceNo: 0, orderNo: 1, amount: 2 } }, { taxRate: null });
  assert.ok(r.error.includes('解析错误'));
  assert.equal(r.pairs.length, 0);
  assert.equal(r.issues.length, 0);
});

test('P0 空订单号行仍计入订单合计与订单数,并单独报告', () => {
  const r = run([['PO1', '', '', '', '100'], ['', '', '', '', '100']], [['I1', 'PO1', '', '', '', '', '100']], { taxRate: null });
  assert.equal(r.summary.orderTotal, 200);
  assert.equal(r.summary.orderCount, 2);
  assert.equal(r.summary.diff, -100);
  assert.equal(r.unmatchedOrders.length, 1);
  assert.ok(codes(r, 'warn').includes('blankOrderNo'));
  assert.ok(codes(r, 'warn').includes('totalDiff'));
});

test('P1 单价差不复用金额容差:100 与 100.1 阻断', () => {
  const r = run([['PO1', '', '1', '100', '100']], [['I1', 'PO1', '', '1', '100.1', '', '100']], { taxRate: null });
  assert.deepEqual(codes(r, 'block'), ['priceDiff']);
  const same = run([['PO1', '', '1', '100', '100']], [['I1', 'PO1', '', '1', '100.00', '', '100']], { taxRate: null });
  assert.equal(same.issues.length, 0);
});

test('P1 汇总合计不等即警告,不复用配对容差', () => {
  const r = run([['PO1', '', '', '', '100']], [['I1', 'PO1', '', '', '', '', '100.1']], { tolAbs: 1, tolPct: 0, taxRate: null });
  assert.equal(codes(r).includes('amountDiff'), false, '单笔金额在容差内');
  assert.deepEqual(codes(r, 'warn'), ['totalDiff']);
  assert.equal(r.summary.diff, 0.1);
});

test('待复核清单 CSV 每行带核对参数(金额容差、百分比容差、税率、匹配模式),文件可独立解释', () => {
  const r = run([['P1', '', '', '', '100']], [['I1', 'P1', '', '', '', '', '103']], { tolAbs: 0.05, tolPct: 1, taxRate: 9, matchByName: true });
  const rows = C.reviewRows(r);
  const head = rows[0];
  ['金额容差(元)', '百分比容差(%)', '税率期望值(%)', '匹配模式'].forEach((h) => assert.ok(head.includes(h), h));
  assert.ok(rows.length > 1);
  rows.slice(1).forEach((row) => {
    assert.equal(row[head.indexOf('金额容差(元)')], 0.05);
    assert.equal(row[head.indexOf('百分比容差(%)')], 1);
    assert.equal(row[head.indexOf('税率期望值(%)')], 9);
    assert.equal(row[head.indexOf('匹配模式')], '订单号 + 品名');
  });
  const off = C.reviewRows(run([['P1', '', '', '', '100']], [['I1', 'P1', '', '', '', '', '103']], { taxRate: null }));
  assert.equal(off[1][off[0].indexOf('税率期望值(%)')], '不检查');
  assert.equal(off[1][off[0].indexOf('匹配模式')], '订单号');
});

test('待复核清单 CSV 与 Markdown 在合成示例下标注数据来源', () => {
  const r = run([['P1', '', '', '', '100']], [['I1', 'P1', '', '', '', '', '103']], { taxRate: null });
  const rows = C.reviewRows(r, { sample: true });
  assert.ok(rows[0].includes('数据来源'));
  assert.equal(rows[1][rows[0].indexOf('数据来源')], '合成示例');
  assert.ok(C.toMarkdown(r, undefined, { sample: true }).includes('数据来源:合成示例'));
  assert.ok(!C.toMarkdown(r).includes('合成示例'));
  assert.ok(!C.reviewRows(r)[0].includes('数据来源'));
});
