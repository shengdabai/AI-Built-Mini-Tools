'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../core.js');
require('../sample-data.js');

const A = { years: 10, drift: 7, vol: 18, seed: 7, crashes: [{ start: 49, months: 6, drop: 45 }] };
const B = { years: 10, drift: 7, vol: 18, seed: 55, crashes: [{ start: 31, months: 5, drop: 35 }, { start: 85, months: 8, drop: 40 }] };
const AMT = 100000; // 1000 元 = 100000 分

test('genPrices:同种子完全一致,不同种子不同', () => {
  const a1 = C.genPrices(A), a2 = C.genPrices(A);
  assert.deepStrictEqual(a1, a2);
  assert.strictEqual(a1.length, 120);
  assert.strictEqual(a1[0], 100);
  assert.notDeepStrictEqual(C.genPrices({ ...A, seed: 8 }), a1);
});

test('mulberry32:已知种子的首个输出固定', () => {
  const r = C.mulberry32(1);
  const first = r();
  assert.ok(first >= 0 && first < 1);
  assert.strictEqual(C.mulberry32(1)(), first);
  assert.notStrictEqual(C.mulberry32(2)(), first);
});

test('genPrices:崩盘段严格单调下跌且总跌幅约等于设定', () => {
  const p = C.genPrices(A);
  for (let m = 49; m <= 54; m++) assert.ok(p[m - 1] < p[m - 2], `第 ${m} 月应低于上月`);
  const total = 1 - p[53] / p[47];
  assert.ok(Math.abs(total - 0.45) < 0.001, `总跌幅 ${total}`);
});

test('genPrices:崩盘设置不改变崩盘之前的月份', () => {
  const none = C.genPrices({ ...A, crashes: [] });
  const withCrash = C.genPrices(A);
  assert.deepStrictEqual(withCrash.slice(0, 48), none.slice(0, 48));
});

test('genPrices:参数越界或崩盘重叠会抛错', () => {
  assert.throws(() => C.genPrices({ ...A, years: 0 }), RangeError);
  assert.throws(() => C.genPrices({ ...A, seed: -1 }), RangeError);
  assert.throws(() => C.genPrices({ ...A, seed: 1.5 }), RangeError);
  assert.throws(() => C.genPrices({ ...A, crashes: [{ start: 10, months: 5, drop: 30 }, { start: 12, months: 3, drop: 30 }] }), RangeError);
  assert.throws(() => C.genPrices({ ...A, crashes: [{ start: 119, months: 5, drop: 30 }] }), RangeError);
  assert.throws(() => C.genPrices({ ...A, crashes: [1, 2, 3, 4].map(i => ({ start: i * 10, months: 2, drop: 20 })) }), RangeError);
  assert.ok(C.genPrices({ ...A, years: 30 }).length === 360);
});

test('dca:份额与成本逐月累计(手算序列)', () => {
  const r = C.dca([100, 50, 100, 200], { amount: 1000, startMonth: 1, rule: 'never' });
  assert.strictEqual(r.cost, 4000);
  assert.ok(Math.abs(r.shares - (10 + 20 + 10 + 5)) < 1e-9);
  assert.deepStrictEqual(r.curve, [1000, 1500, 4000, 9000]);
  assert.strictEqual(r.value, 9000);
  assert.ok(Math.abs(r.multiple - 2.25) < 1e-9);
});

test('dca:起始月之前曲线为 0,成本只计起始月之后', () => {
  const r = C.dca([100, 100, 100, 100], { amount: 500, startMonth: 3, rule: 'never' });
  assert.deepStrictEqual(r.curve, [0, 0, 500, 1000]);
  assert.strictEqual(r.cost, 1000);
});

test('dca:最大回撤与最长水下月数(手算)', () => {
  // 价格 100,100,50,50,50,100:一次性投入式观察,金额每月 100
  const r = C.dca([100, 100, 50, 50, 50, 100], { amount: 100, startMonth: 1, rule: 'never' });
  // 份额 1,2,4,6,8,9 → 市值 100,200,200,300,400,900(逐月加投抵消下跌),无回撤
  assert.deepStrictEqual(r.curve, [100, 200, 200, 300, 400, 900]);
  assert.strictEqual(r.maxDrawdown, 0);
  const d = C.drawdown([100, 80, 60, 90, 120, 60, 60, 130]);
  assert.ok(Math.abs(d.max - 0.5) < 1e-12);
  assert.strictEqual(d.longestUnderwater, 3);
});

test('dca:停投规则触发后不再买入,份额冻结', () => {
  const p = [100, 100, 60, 60, 100];
  const r = C.dca(p, { amount: 1000, rule: { type: 'stop', threshold: 30 } });
  assert.strictEqual(r.haltMonth, 3);
  assert.strictEqual(r.cost, 2000);
  assert.ok(Math.abs(r.shares - 20) < 1e-9);
  assert.strictEqual(r.value, 2000);
});

test('dca:清仓规则触发后变现并永不再买', () => {
  const p = [100, 100, 60, 60, 200];
  const r = C.dca(p, { amount: 1000, rule: { type: 'sell', threshold: 30 } });
  assert.strictEqual(r.status, 'sold');
  assert.strictEqual(r.shares, 0);
  assert.strictEqual(r.cost, 2000);
  assert.strictEqual(r.value, 1200); // 20 份 × 60
  assert.deepStrictEqual(r.curve.slice(-1), [1200]);
});

test('dca:阈值刚好等于回撤时触发,差一点不触发', () => {
  const hit = C.dca([100, 70], { amount: 100, rule: { type: 'stop', threshold: 30 } });
  assert.strictEqual(hit.haltMonth, 2);
  const miss = C.dca([100, 70.01], { amount: 100, rule: { type: 'stop', threshold: 30 } });
  assert.strictEqual(miss.haltMonth, null);
});

test('dca:金额必须是正整数分,浮点金额被拒绝', () => {
  assert.throws(() => C.dca([100, 100], { amount: 10.5 }), RangeError);
  assert.throws(() => C.dca([100, 100], { amount: 0 }), RangeError);
  assert.throws(() => C.dca([100, -1], { amount: 100 }), RangeError);
  assert.throws(() => C.dca([100, 100], { amount: 100, startMonth: 3 }), RangeError);
  const r = C.dca(C.genPrices(A), { amount: AMT });
  for (const v of r.curve.concat([r.cost, r.value])) assert.ok(Number.isInteger(v));
});

test('compareRules:示例 A 与 B 上三条规则终值互不相同,且清仓有空仓月数', () => {
  for (const [params, minOut] of [[A, 1], [B, 1]]) {
    const p = C.genPrices(params);
    const c = C.compareRules(p, AMT, { threshold: 30 });
    const vals = [c.rules.never.value, c.rules.stop.value, c.rules.sell.value];
    assert.strictEqual(new Set(vals).size, 3, JSON.stringify(vals));
    assert.ok(c.sideline && c.sideline.outMonths >= minOut);
    assert.strictEqual(c.diff.stopVsNever, c.rules.never.value - c.rules.stop.value);
    assert.ok(c.diff.stopVsNever > 0 && c.diff.sellVsNever > 0);
  }
  const b = C.compareRules(C.genPrices(B), AMT, { threshold: 30 });
  assert.ok(b.sideline.aboveMonths > 0, '示例 B 清仓后价格曾回到清仓价以上');
});

test('compareRules:未触发清仓时 sideline 为 null 且三条曲线一致', () => {
  const c = C.compareRules([100, 101, 102, 103], AMT, { threshold: 30 });
  assert.strictEqual(c.sideline, null);
  assert.strictEqual(c.rules.never.value, c.rules.stop.value);
  assert.strictEqual(c.rules.never.value, c.rules.sell.value);
});

test('lumpSum 与 dca 回撤比较:同总投入下全投回撤更深', () => {
  const p = C.genPrices(A);
  const v = C.lumpVsDca(p, { amount: AMT, startMonth: 1 });
  assert.strictEqual(v.lump.cost, v.dca.cost);
  assert.ok(v.lump.maxDrawdown > v.dca.maxDrawdown, `${v.lump.maxDrawdown} vs ${v.dca.maxDrawdown}`);
  assert.ok(v.drawdownGap > 0);
  assert.strictEqual(v.valueGap, v.lump.value - v.dca.value);
  const l = C.lumpSum([100, 50, 100], 1000, 1);
  assert.deepStrictEqual(l.curve, [1000, 500, 1000]);
  assert.ok(Math.abs(l.maxDrawdown - 0.5) < 1e-12);
});

test('replayStep:一路继续的曲线与「从不停止」完全相同', () => {
  const p = C.genPrices(A);
  let s = C.newReplay(p, { amount: AMT, startMonth: 1, threshold: 20 });
  let prompts = 0;
  while (!s.done) {
    if (s.pending) { prompts += 1; s = C.replayStep(s, 'continue'); } else s = C.replayStep(s, 'next');
  }
  assert.ok(prompts >= 1);
  const ref = C.dca(p, { amount: AMT, rule: 'never' });
  assert.deepStrictEqual(s.curve, ref.curve);
  assert.strictEqual(s.choices.length, prompts);
});

test('replayStep:回撤超阈值时暂停等待选择,选择前不能前进', () => {
  let s = C.newReplay([100, 100, 70, 70], { amount: 1000, startMonth: 1, threshold: 20 });
  s = C.replayStep(s, 'next'); s = C.replayStep(s, 'next');
  assert.strictEqual(s.pending, null);
  s = C.replayStep(s, 'next');
  assert.ok(s.pending && s.pending.month === 3);
  assert.strictEqual(s.curve.length, 2, '待决月份尚未入账');
  assert.throws(() => C.replayStep(s, 'next'));
});

test('replayStep:停投后不可再买,清仓后不可再买且不再弹出选择', () => {
  const p = [100, 100, 60, 50, 40, 120];
  let s = C.newReplay(p, { amount: 1000, startMonth: 1, threshold: 20 });
  s = C.replayStep(C.replayStep(s, 'next'), 'next');
  s = C.replayStep(s, 'next');
  const costBefore = s.cost;
  s = C.replayStep(s, 'stop');
  assert.strictEqual(s.status, 'stopped');
  assert.strictEqual(s.cost, costBefore);
  while (!s.done) s = C.replayStep(s, 'next');
  assert.strictEqual(s.cost, costBefore, '停投后成本不再增加');
  assert.strictEqual(s.choices.length, 1);

  let t = C.newReplay(p, { amount: 1000, startMonth: 1, threshold: 20 });
  t = C.replayStep(C.replayStep(t, 'next'), 'next');
  t = C.replayStep(C.replayStep(t, 'next'), 'sell');
  assert.strictEqual(t.status, 'sold');
  assert.strictEqual(t.shares, 0);
  const cash = t.cash;
  while (!t.done) t = C.replayStep(t, 'next');
  assert.strictEqual(t.cash, cash);
  assert.strictEqual(t.curve[t.curve.length - 1], cash);
  assert.strictEqual(t.choices.length, 1);
});

test('replayStep:不修改入参状态,非法选择与结束后前进抛错', () => {
  const s0 = C.newReplay([100, 100], { amount: 100, startMonth: 1, threshold: 20 });
  const s1 = C.replayStep(s0, 'next');
  assert.strictEqual(s0.month, -1);
  assert.strictEqual(s0.curve.length, 0);
  assert.strictEqual(s1.month, 0);
  assert.throws(() => C.replayStep(s1, 'continue'), /没有待处理/);
  assert.throws(() => C.replayStep(s1, 'bogus'));
  const done = C.replayStep(s1, 'next');
  assert.ok(done.done);
  assert.throws(() => C.replayStep(done, 'next'), /已结束/);
});

test('replayResult:行为曲线与规则曲线对照,差额等于终值之差', () => {
  const p = C.genPrices(A);
  let s = C.newReplay(p, { amount: AMT, startMonth: 1, threshold: 20 });
  while (!s.done) s = s.pending ? C.replayStep(s, 'sell') : C.replayStep(s, 'next');
  const r = C.replayResult(s, 'never');
  assert.strictEqual(r.diff, r.behavior.value - r.rule.value);
  assert.ok(r.behavior.value < r.rule.value, '示例 A 上清仓后终值低于一路持有');
  assert.throws(() => C.replayResult(C.newReplay(p, { amount: AMT, startMonth: 1, threshold: 20 })));
});

test('parsePricesCsv:合法 CSV(带表头、单列、BOM、CRLF)', () => {
  assert.deepStrictEqual(C.parsePricesCsv('月,价格\n1,100\n2,101.5\n').prices, [100, 101.5]);
  assert.deepStrictEqual(C.parsePricesCsv('price\r\n100\r\n90\r\n').prices, [100, 90]);
  assert.deepStrictEqual(C.parsePricesCsv('﻿100\n200').prices, [100, 200]);
  assert.deepStrictEqual(C.parsePricesCsv('1,100\n2,110').prices, [100, 110]);
});

test('parsePricesCsv:非正价格、非数字、列数不一致、引号未闭合都整份拒绝', () => {
  for (const bad of ['月,价格\n1,100\n2,0', '月,价格\n1,100\n2,-5', '月,价格\n1,100\n2,abc', '月,价格\n1,100\n2', '月,价格\n1,100\n2,"3', '月,价格\n1,100\n2,=1+1', '100', '', '1,2,3\n4,5,6']) {
    const r = C.parsePricesCsv(bad);
    assert.strictEqual(r.ok, false, JSON.stringify(bad));
    assert.ok(r.error);
  }
  const big = '价格\n' + Array(C.LIMITS.pointsMax + 1).fill('100').join('\n');
  assert.strictEqual(C.parsePricesCsv(big).ok, false);
});

test('validateImport:按内容识别 CSV 与记录 JSON', () => {
  assert.strictEqual(C.validateImport('价格\n1\n2').kind, 'prices');
  assert.strictEqual(C.validateImport('{"x":1}').ok, false);
  assert.strictEqual(C.validateImport('{"x":').error, 'JSON 无法解析');
  assert.strictEqual(C.validateImport('[]').ok, false);
});

function rec(over) {
  return Object.assign({ id: 'q1', date: '2026-10-20', source: 'synthetic', seed: 7, months: 120, amount: AMT, threshold: 20, choices: [{ month: 55, drawdown: 0.25, choice: 'continue' }], behaviorValue: 100, ruleValue: 90, cost: 80, behaviorMaxDrawdown: 0.3, ruleMaxDrawdown: 0.4 }, over || {});
}

test('记录校验:枚举、类型、日期、ID 唯一性不合法则整份拒绝', () => {
  const ok = C.recordsToJson([rec(), rec({ id: 'q2' })], '2026-10-20');
  assert.strictEqual(C.validateImport(ok).ok, true);
  const wrap = list => JSON.stringify({ version: 1, kind: 'dca-endurance-records', records: list });
  assert.strictEqual(C.validateImport(wrap([rec(), rec()])).ok, false, 'id 重复');
  assert.strictEqual(C.validateImport(wrap([rec({ date: '2026-02-30' })])).ok, false, '日期进位');
  assert.strictEqual(C.validateImport(wrap([rec({ choices: [{ month: 5, drawdown: 0.3, choice: 'hodl' }] })])).ok, false, '枚举');
  assert.strictEqual(C.validateImport(wrap([rec({ amount: 10.5 })])).ok, false, '小数分');
  assert.strictEqual(C.validateImport(wrap([rec({ source: 'csv', seed: 5 }), rec({ id: 'x', source: 'synthetic', seed: null })])).ok, false, '合成缺种子');
  assert.strictEqual(C.validateImport(JSON.stringify({ version: 2, kind: 'dca-endurance-records', records: [] })).ok, false);
});

test('mergeRecords:相同记录跳过,同 id 内容不同则整份拒绝', () => {
  const ex = [rec()];
  const same = C.mergeRecords(ex, [rec(), rec({ id: 'q9' })]);
  assert.strictEqual(same.ok, true);
  assert.strictEqual(same.added, 1);
  assert.strictEqual(same.records.length, 2);
  const conflict = C.mergeRecords(ex, [rec({ id: 'q8' }), rec({ behaviorValue: 5 })]);
  assert.strictEqual(conflict.ok, false);
});

test('CSV 导出:公式前缀加单引号,单独的 - 和 + 不加,含逗号引号的字段被引用', () => {
  assert.strictEqual(C.guardCell('=1+1'), "'=1+1");
  assert.strictEqual(C.guardCell('+cmd'), "'+cmd");
  assert.strictEqual(C.guardCell('-2'), "'-2");
  assert.strictEqual(C.guardCell('@SUM'), "'@SUM");
  assert.strictEqual(C.guardCell('-'), '-');
  assert.strictEqual(C.guardCell('+'), '+');
  assert.strictEqual(C.guardCell(-5), -5);
  const csv = C.toCsv({ prices: [100, 101], series: [{ name: '=恶意,"名"', values: [1, 2] }] });
  const lines = csv.trim().split('\n');
  assert.strictEqual(lines[0], '月,价格,"\'=恶意,""名""(分)"');
  assert.strictEqual(lines[1], '1,100,1');
  assert.strictEqual(lines.length, 3);
});

test('toMarkdown:含免责声明、三条规则对照与记录;单元格转义竖线并防公式', () => {
  const p = C.genPrices(A);
  const compare = C.compareRules(p, AMT, { threshold: 30 });
  const md = C.toMarkdown({
    date: '2026-10-20', params: [['种子', '7'], ['备注', '=SUM(A1)|x']], compare,
    lump: C.lumpVsDca(p, { amount: AMT, startMonth: 1 }), records: [rec()]
  });
  assert.ok(md.includes(C.DISCLAIMER));
  assert.ok(md.indexOf(C.DISCLAIMER) < md.indexOf('## 设定'), '免责声明在正文之前');
  assert.ok(md.includes("| 备注 | '=SUM(A1)\\|x |"));
  assert.ok(md.includes('跌 30% 清仓'));
  assert.ok(md.includes('不构成任何投资建议'));
  assert.ok(md.includes('第55月继续'));
});

test('fmtYuan:分 → 元,千分位,两位小数', () => {
  assert.strictEqual(C.fmtYuan(0), '0.00');
  assert.strictEqual(C.fmtYuan(5), '0.05');
  assert.strictEqual(C.fmtYuan(123456789), '1,234,567.89');
  assert.strictEqual(C.fmtYuan(-100), '-1.00');
  assert.strictEqual(C.yuanToCents('1000'), 100000);
  assert.strictEqual(C.yuanToCents('0.29'), 29);
  assert.ok(Number.isNaN(C.yuanToCents('1.234')));
  assert.ok(Number.isNaN(C.yuanToCents('-5')));
});

test('resolveToday:合法 ?today 生效,非法与自动进位日期回退真实今天', () => {
  const now = new Date(2026, 9, 21);
  assert.strictEqual(C.resolveToday('?today=2026-10-20', now), '2026-10-20');
  assert.strictEqual(C.resolveToday('?today=2026-02-30', now), '2026-10-21');
  assert.strictEqual(C.resolveToday('?today=abc', now), '2026-10-21');
  assert.strictEqual(C.resolveToday('', now), '2026-10-21');
});

test('parseForm:半成品输入给出错误而不抛错,合法输入给出设定', () => {
  const f = C.defaultForm();
  const ok = C.parseForm(f, null);
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.settings.amount, 100000);
  assert.strictEqual(ok.settings.prices.length, 120);
  for (const patch of [{ years: '' }, { years: '1e3' }, { seed: '-3' }, { amount: '12.345' }, { startMonth: '999' }, { threshold: '0' }, { vol: 'abc' }, { drift: '1.' }]) {
    const r = C.parseForm({ ...f, ...patch }, null);
    assert.strictEqual(r.ok, false, JSON.stringify(patch));
    assert.ok(r.errors.length >= 1);
  }
  assert.strictEqual(C.parseForm({ ...f, source: 'csv' }, null).ok, false);
  assert.strictEqual(C.parseForm({ ...f, source: 'csv', startMonth: '3' }, [100, 101, 102]).ok, true);
});

test('写读校验同源:能保存的状态读回必然通过,半成品与边界值都一样', () => {
  const s = C.defaultState();
  s.generated = true;
  s.form = { ...s.form, years: '', seed: '4294967295', amount: '100000000', startMonth: 'x', crashes: [{ start: '', months: '3', drop: '1e9' }] };
  s.records = [rec()];
  assert.strictEqual(C.validateState(s).ok, true);
  const back = JSON.parse(JSON.stringify(s));
  assert.strictEqual(C.validateState(back).ok, true);
  assert.deepStrictEqual(back, s);
  // 不合法的存档(保存前即被拒绝)
  assert.strictEqual(C.validateState({ ...s, v: 2 }).ok, false);
  assert.strictEqual(C.validateState({ ...s, records: [rec(), rec()] }).ok, false);
  assert.strictEqual(C.validateState({ ...s, form: { ...s.form, years: 10 } }).ok, false);
  assert.strictEqual(C.validateState({ ...s, form: { ...s.form, ruleType: 'x' } }).ok, false);
  assert.strictEqual(C.validateState({ ...s, csvPrices: [1, 0] }).ok, false);
  assert.strictEqual(C.validateState(null).ok, false);
});

test('内置示例:示例 A、B 的表单可解析,示例 C 的 CSV 可导入', () => {
  assert.strictEqual(DCA_SAMPLES.length, 3);
  for (const s of DCA_SAMPLES) {
    assert.strictEqual(s.note, '合成示例');
    const csv = s.csv ? C.validateImport(s.csv) : null;
    if (csv) assert.strictEqual(csv.ok, true);
    const r = C.parseForm(s.form, csv ? csv.prices : null);
    assert.strictEqual(r.ok, true, s.id);
  }
  const a = C.parseForm(DCA_SAMPLES[0].form, null).settings.prices;
  const c = C.compareRules(a, 100000, { threshold: 30 });
  assert.ok(c.rules.sell.haltMonth >= 49, '示例 A 的清仓由崩盘触发');
});

test('drawdownZones:按起始月后的高点找出回撤超阈值的连续区间', () => {
  assert.deepStrictEqual(C.drawdownZones([100, 90, 60, 55, 80, 100, 50], 1, 30), [[2, 3], [6, 6]]);
  assert.deepStrictEqual(C.drawdownZones([100, 90, 60, 55, 80, 100, 50], 3, 30), [[6, 6]]);
  assert.deepStrictEqual(C.drawdownZones([100, 101, 102], 1, 30), []);
});

test('审核修复 1:首行只有明确的列名才算表头,非法首行价格整份拒绝', () => {
  for (const bad of ['-1\n100\n101', '0\n100', '=1+1\n100', '1,abc\n2,100\n3,101']) {
    assert.strictEqual(C.parsePricesCsv(bad).ok, false, JSON.stringify(bad));
  }
  assert.deepStrictEqual(C.parsePricesCsv('价格\n100\n101').prices, [100, 101]);
  assert.deepStrictEqual(C.parsePricesCsv('month,close\n1,100\n2,101').prices, [100, 101]);
  assert.deepStrictEqual(C.parsePricesCsv('100\n101').prices, [100, 101]);
});

test('审核修复 2:引号闭合后只允许分隔符或行尾', () => {
  for (const bad of ['"1"2\n3', '"1" \n3', '1,"2"x\n3,4', '"1"2']) {
    assert.strictEqual(C.parsePricesCsv(bad).ok, false, JSON.stringify(bad));
  }
  assert.deepStrictEqual(C.parsePricesCsv('"100"\n"101"').prices, [100, 101]);
  assert.deepStrictEqual(C.parsePricesCsv('月,价格\n1,"100.5"\n2,101').prices, [100.5, 101]);
});

test('审核修复 3:过小或过大的价格被拒绝,计算永不产生 Infinity/NaN', () => {
  assert.strictEqual(C.parsePricesCsv('1e-320\n1').ok, false);
  assert.strictEqual(C.parsePricesCsv('0.00001\n1').ok, false);
  assert.strictEqual(C.parsePricesCsv('1e300\n1').ok, false);
  assert.throws(() => C.dca([1e-320, 1], { amount: 100 }), RangeError);
  assert.throws(() => C.lumpSum([1e-320, 1], 100), RangeError);
  assert.throws(() => C.newReplay([1e-320, 1], { amount: 100, startMonth: 1, threshold: 20 }), RangeError);
  assert.strictEqual(C.validateState({ ...C.defaultState(), csvPrices: [1e-320, 1] }).ok, false);
  const r = C.dca([C.LIMITS.priceMin, 1, 1e6], { amount: 10000000000 });
  for (const v of r.curve.concat([r.shares, r.value, r.maxDrawdown, r.maxLoss])) assert.ok(Number.isFinite(v));
  assert.throws(() => C.genPrices({ years: 3000, drift: 100, vol: 0, seed: 1, crashes: [] }), RangeError, '指数增长溢出要明确报错');
});

test('审核修复 4:年数与崩盘持续月数没有业务上限', () => {
  const p = C.genPrices({ years: 100, drift: 5, vol: 15, seed: 3, crashes: [{ start: 600, months: 36, drop: 50 }] });
  assert.strictEqual(p.length, 1200);
  for (let m = 600; m < 636; m++) assert.ok(p[m - 1] < p[m - 2]);
  assert.strictEqual(C.genPrices({ years: 200, drift: 5, vol: 15, seed: 3 }).length, 2400);
  assert.strictEqual(C.parsePricesCsv('价格\n' + Array(1500).fill('100').join('\n')).prices.length, 1500);
  const r = C.dca(p, { amount: 100000 });
  assert.ok(Number.isFinite(r.value));
  assert.strictEqual(C.checkGenParams({ years: 0, drift: 5, vol: 15, seed: 3 }).length, 1);
});

test('toMarkdown:回撤列称“最大资产回撤”并解释口径;示例标注只在载入示例时出现', () => {
  const p = C.genPrices(A);
  const compare = C.compareRules(p, AMT, { threshold: 30 });
  const base = { date: '2026-10-20', params: [], compare, lump: C.lumpVsDca(p, { amount: AMT, startMonth: 1 }), records: [] };
  const md = C.toMarkdown(base);
  assert.ok(md.includes('最大资产回撤') && !md.includes('| 最大回撤 |'));
  assert.ok(md.includes('相对资产历史高点') && md.includes('连续未回到历史高点'));
  assert.ok(!md.includes('合成示例'));
  assert.ok(C.toMarkdown({ ...base, sample: '示例 A' }).includes('合成示例:示例 A'));
});

test('toCsv:载入示例时多一列“数据性质”标注合成示例,否则列不变', () => {
  const data = { prices: [100, 101], series: [{ name: '甲', values: [1, 2] }] };
  assert.strictEqual(C.toCsv(data).split('\n')[0], '月,价格,甲(分)');
  const lines = C.toCsv({ ...data, sample: '示例 A' }).trim().split('\n');
  assert.strictEqual(lines[0], '月,价格,甲(分),数据性质');
  assert.ok(lines.slice(1).every(l => l.endsWith(',合成示例:示例 A')));
});

test('validateState:sample 必须是 null 或不超过 40 字的文本,缺省视为 null;旧存档仍可读取', () => {
  const s = C.defaultState();
  assert.strictEqual(s.sample, null);
  assert.strictEqual(C.validateState(s).ok, true);
  const old = { ...s }; delete old.sample;
  assert.strictEqual(C.validateState(old).ok, true);
  assert.strictEqual(C.validateState({ ...s, sample: '示例 A' }).ok, true);
  assert.strictEqual(C.validateState({ ...s, sample: 3 }).ok, false);
  assert.strictEqual(C.validateState({ ...s, sample: 'x'.repeat(41) }).ok, false);
});

test('validateImport:记录里的数值字段被写成带标签的文本时整份拒绝(渲染前的最后一道防线)', () => {
  const bad = (k, v) => JSON.stringify({ version: 1, kind: 'dca-endurance-records', exportedAt: '2026-10-20', records: [{ ...rec(), [k]: v }] });
  assert.strictEqual(C.validateImport(bad('seed', '<img src=x onerror=alert(1)>')).ok, false);
  assert.strictEqual(C.validateImport(bad('threshold', '<b>20</b>')).ok, false);
  assert.strictEqual(C.validateImport(bad('choices', [{ month: '<i>1</i>', drawdown: 0.3, choice: 'stop' }])).ok, false);
});
