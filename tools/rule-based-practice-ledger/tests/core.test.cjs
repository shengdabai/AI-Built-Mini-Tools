'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const DAILY = { kind: 'daily' };
const rec = (...dates) => dates.map(d => ({ date: d, value: 1 }));

test('expectedCount 每天:含起止当天,开始日在未来为 0', () => {
  assert.equal(C.expectedCount(DAILY, '2026-10-01', '2026-10-20'), 20);
  assert.equal(C.expectedCount(DAILY, '2026-10-20', '2026-10-20'), 1);
  assert.equal(C.expectedCount(DAILY, '2026-10-21', '2026-10-20'), 0);
});

test('expectedCount 每周 N 次:整周计 N,本周只计"现在必须已做"的部分,首周按可用天数封顶', () => {
  const w3 = { kind: 'weekly', n: 3 };
  // 2026-10-05 是周一
  assert.equal(C.expectedCount(w3, '2026-10-05', '2026-10-18'), 6);
  assert.equal(C.expectedCount(w3, '2026-10-05', '2026-10-20'), 6); // 周二:还来得及,不欠账
  assert.equal(C.expectedCount(w3, '2026-10-05', '2026-10-23'), 7); // 周五起必须开始做
  assert.equal(C.expectedCount(w3, '2026-10-05', '2026-10-25'), 9);
  // 首周从周五开始,可用 3 天,n=5 封顶为 3
  assert.equal(C.expectedCount({ kind: 'weekly', n: 5 }, '2026-10-09', '2026-10-11'), 3);
});

test('expectedCount 每月固定日:月末取当月最后一天,闰月 2 月 29 日', () => {
  const d31 = { kind: 'monthly', day: 31 };
  assert.equal(C.expectedCount(d31, '2026-01-01', '2026-03-01'), 2); // 1/31 与 2/28
  assert.equal(C.expectedCount(d31, '2026-01-01', '2026-03-31'), 3);
  const d30 = { kind: 'monthly', day: 30 };
  assert.equal(C.expectedCount(d30, '2028-02-01', '2028-02-28'), 0);
  assert.equal(C.expectedCount(d30, '2028-02-01', '2028-02-29'), 1); // 2028 闰年
  assert.equal(C.expectedCount(d30, '2027-02-01', '2027-02-28'), 1); // 平年 2/28
  // 开始日晚于当月固定日:当月不计
  assert.equal(C.expectedCount({ kind: 'monthly', day: 1 }, '2026-10-05', '2026-10-20'), 0);
  assert.equal(C.expectedCount({ kind: 'monthly', day: 1 }, '2026-10-05', '2026-11-01'), 1);
});

test('结束践行后不再计入应执行(三种规则)', () => {
  assert.equal(C.expectedCount(DAILY, '2026-10-01', '2026-10-20', '2026-10-10'), 10);
  assert.equal(C.expectedCount({ kind: 'weekly', n: 3 }, '2026-10-05', '2026-12-31', '2026-10-18'), 6);
  assert.equal(C.expectedCount({ kind: 'monthly', day: 1 }, '2026-01-01', '2026-12-31', '2026-03-15'), 3);
  const r = C.executionRate(rec('2026-10-01', '2026-10-02'), DAILY, '2026-10-01', '2026-10-20', '2026-10-04');
  assert.deepEqual([r.actual, r.expected, r.rate], [2, 4, 0.5]);
});

test('streak 断裂与补录:缺一天归零,补录后连起来;今天还没做不算断', () => {
  const start = '2026-10-10';
  const base = rec('2026-10-10', '2026-10-11', '2026-10-13', '2026-10-14');
  assert.equal(C.streak(base, DAILY, '2026-10-14', { start }), 2); // 10-12 缺
  assert.equal(C.streak(base, DAILY, '2026-10-15', { start }), 2); // 今天(15)未做,不断
  assert.equal(C.streak(base, DAILY, '2026-10-16', { start }), 0); // 15 已缺
  const filled = base.concat(rec('2026-10-12'));
  assert.equal(C.streak(filled, DAILY, '2026-10-14', { start }), 5);
  assert.equal(C.streak([], DAILY, '2026-10-14'), 0);
});

test('streak 每周与每月按"达标周/月"计', () => {
  const w2 = { kind: 'weekly', n: 2 };
  const recs = rec('2026-10-05', '2026-10-07', '2026-10-12', '2026-10-14', '2026-10-19');
  // 第 1、2 周达标;第 3 周(10-19 起)目前 1/2,进行中不算断
  assert.equal(C.streak(recs, w2, '2026-10-20', { start: '2026-10-05' }), 2);
  assert.equal(C.streak(recs, w2, '2026-10-26', { start: '2026-10-05' }), 0); // 第 3 周结束仍 1/2
  const m = { kind: 'monthly', day: 1 };
  assert.equal(C.streak(rec('2026-08-01', '2026-09-01', '2026-10-01'), m, '2026-10-20', { start: '2026-08-01' }), 3);
  assert.equal(C.streak(rec('2026-08-01', '2026-10-01'), m, '2026-10-20', { start: '2026-08-01' }), 1);
});

test('executionRate 应执行为 0 时不除零,返回 null', () => {
  const r = C.executionRate([], DAILY, '2026-10-21', '2026-10-20');
  assert.equal(r.expected, 0);
  assert.equal(r.rate, null);
  const r2 = C.executionRate(rec('2026-10-01'), { kind: 'weekly', n: 3 }, '2026-10-05', '2026-10-06');
  assert.equal(r2.rate, null);
});

test('compound 年化 0 时等于累计投入,期数正确', () => {
  const c = C.compound(1000, 12, 0, 12);
  assert.equal(c.length, 12);
  assert.equal(c[11].invested, 12000);
  assert.ok(c.every(p => p.value === p.invested));
});

test('compound 年化 6% 单调递增,终值高于累计投入,月复利可手算核对', () => {
  const c = C.compound(1000, 12, 0.06, 12);
  assert.equal(c.length, 12);
  for (let k = 1; k < c.length; k++) assert.ok(c[k].value > c[k - 1].value);
  assert.ok(c[11].value > c[11].invested);
  const i = Math.pow(1.06, 1 / 12) - 1;
  const expected = 1000 * (1 + i) * (Math.pow(1 + i, 12) - 1) / i; // 期初年金终值
  assert.ok(Math.abs(c[11].value - expected) < 1e-6);
});

test('compound 与 lumpSum 拒绝非法参数而不是抛错', () => {
  assert.deepEqual(C.compound(1000, 1.5, 0.06, 12), []);
  assert.deepEqual(C.compound(1000, 12, -1, 12), []);
  assert.deepEqual(C.compound(-5, 12, 0.06, 12), []);
  assert.deepEqual(C.compound(1000, 12, NaN, 12), []);
  assert.deepEqual(C.lumpSum(12000, 12, 0.06, 0), []);
  const l = C.lumpSum(12000, 12, 0.06, 12);
  assert.ok(Math.abs(l[11].value - 12000 * 1.06) < 1e-6);
  // 同额一次性投入因更早进场,在正收益假设下终值高于定投终值(仅算术对照)
  assert.ok(l[11].value > C.compound(1000, 12, 0.06, 12)[11].value);
});

test('assumedValue 按实际记录折算,0 年化等于累计投入', () => {
  const recs = [{ date: '2025-10-20', value: 1000 }, { date: '2026-10-20', value: 1000 }];
  const z = C.assumedValue(recs, 0, '2026-10-20');
  assert.deepEqual([z.invested, z.value], [2000, 2000]);
  const g = C.assumedValue(recs, 0.06, '2026-10-20');
  assert.ok(Math.abs(g.value - (1000 * Math.pow(1.06, 365 / 365) + 1000)) < 1e-9);
  const future = C.assumedValue([{ date: '2026-10-21', value: 500 }], 0.06, '2026-10-20');
  assert.equal(future.invested, 0);
});

test('growth(0.01, 365) ≈ 37.78,隔天做(183 次)约 6.18 倍', () => {
  assert.ok(Math.abs(C.growth(0.01, 365) - 37.7834) < 1e-3);
  assert.equal(C.growth(0.01, 0), 1);
  assert.equal(C.growth(-1, 5), null);
  assert.equal(C.growth(0.01, 2.5), null);
  const cmp = C.compareGrowth(0.01, 365);
  assert.equal(cmp.alternateTimes, 183);
  assert.ok(Math.abs(cmp.alternate - Math.pow(1.01, 183)) < 1e-9);
  assert.ok(Math.abs(cmp.alternate - 6.178) < 1e-2);
  assert.ok(cmp.steady / cmp.alternate > 6);
  assert.equal(C.compareGrowth(0.01, 1).alternateTimes, 1);
});

test('weeklyHeat 每周 7 列,周一起算,标出未来与区间外', () => {
  const recs = [{ date: '2026-10-19', value: 5 }, { date: '2026-10-20', value: 3 }];
  const heat = C.weeklyHeat(recs, '2026-10-20', { weeks: 4, start: '2026-10-12' });
  assert.equal(heat.length, 4);
  assert.ok(heat.every(w => w.cells.length === 7));
  const last = heat[3];
  assert.equal(last.weekStart, '2026-10-19');
  assert.equal(last.cells[0].value, 5);
  assert.equal(last.cells[1].value, 3);
  assert.equal(last.cells[2].future, true);
  assert.equal(heat[0].cells[0].outside, true); // 开始日以前
  assert.equal(heat[2].cells[0].outside, false);
});

test('monthlySummary 月边界:跨开始日、当月未过完、非法月份', () => {
  const recs = [];
  for (let d = 1; d <= 10; d++) recs.push({ date: '2026-10-' + String(d).padStart(2, '0'), value: 500 });
  const s = C.monthlySummary(recs, DAILY, '2026-10', { start: '2026-10-05', today: '2026-10-20' });
  assert.equal(s.expected, 16); // 10-05 .. 10-20
  assert.equal(s.actual, 6);   // 10-05 .. 10-10
  assert.equal(s.total, 3000);
  assert.equal(s.rate, 6 / 16);
  assert.equal(s.streak, 0);   // 10-11..10-19 缺
  const before = C.monthlySummary(recs, DAILY, '2026-09', { start: '2026-10-05', today: '2026-10-20' });
  assert.deepEqual([before.expected, before.actual, before.rate], [0, 0, null]);
  const full = C.monthlySummary([], { kind: 'monthly', day: 1 }, '2026-02', { start: '2026-01-01', today: '2026-10-20' });
  assert.equal(full.expected, 1);
  assert.equal(C.monthlySummary(recs, DAILY, '2026-13', { start: '2026-10-05' }), null);
  assert.equal(C.monthlySummary(recs, DAILY, 'abc', { start: '2026-10-05' }), null);
});

test('resolveToday 读取 ?today=,非法格式回退不抛错', () => {
  assert.equal(C.resolveToday('?today=2026-10-20', '2030-01-01'), '2026-10-20');
  assert.equal(C.resolveToday('?x=1&today=2026-10-20', '2030-01-01'), '2026-10-20');
  assert.equal(C.resolveToday('?today=2026-02-30', '2030-01-01'), '2030-01-01');
  assert.equal(C.resolveToday('?today=abc', '2030-01-01'), '2030-01-01');
  assert.equal(C.resolveToday('', '2030-01-01'), '2030-01-01');
  assert.equal(C.resolveToday(undefined, '2030-01-01'), '2030-01-01');
});

test('guardStatus 本周还需执行 N 次;每月规则按本月;结束后为 0', () => {
  const w3 = { kind: 'weekly', n: 3 };
  const g = C.guardStatus(rec('2026-10-19'), w3, '2026-10-05', '2026-10-20');
  assert.deepEqual([g.quota, g.done, g.remaining, g.scope], [3, 1, 2, 'week']);
  const gd = C.guardStatus(rec('2026-10-19'), DAILY, '2026-10-05', '2026-10-20');
  assert.deepEqual([gd.quota, gd.remaining], [7, 6]);
  const gm = C.guardStatus([], { kind: 'monthly', day: 1 }, '2026-01-01', '2026-10-20');
  assert.deepEqual([gm.scope, gm.remaining], ['month', 1]);
  const ge = C.guardStatus([], w3, '2026-10-05', '2026-10-20', '2026-10-12');
  assert.equal(ge.remaining, 0);
  assert.equal(ge.active, false);
});

test('periods 把缺勤标为 missed,今天未做为 pending', () => {
  const ps = C.periods(rec('2026-10-18', '2026-10-20'), DAILY, '2026-10-18', '2026-10-21');
  assert.deepEqual(ps.map(p => p.status), ['done', 'missed', 'done', 'pending']);
});

test('CSV 公式防护:= + - @ 开头加单引号,单独的 - + 不算,逗号与引号正确转义', () => {
  assert.equal(C.guardCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(C.guardCell('+1'), "'+1");
  assert.equal(C.guardCell('-2'), "'-2");
  assert.equal(C.guardCell('@cmd'), "'@cmd");
  assert.equal(C.guardCell('-'), '-');
  assert.equal(C.guardCell('+'), '+');
  assert.equal(C.guardCell('正常'), '正常');
  const p = { id: 'a', name: '=HYPERLINK("x")', type: 'count', unit: '次', rule: DAILY, amount: 1, start: '2026-10-01', records: [{ date: '2026-10-02', value: 1 }, { date: '2026-10-01', value: 2 }] };
  const csv = C.toCsv([p]).split('\n');
  assert.equal(csv[0], '践行,类型,规则,每次定额,日期,实际值,单位');
  assert.ok(csv[1].startsWith('"\'=HYPERLINK(""x"")",次数型,每天,1,2026-10-01,2,次'));
});

test('Markdown 月度总结:表格单元格防注入并转义竖线,含执行率', () => {
  const p = { id: 'a', name: '写作|练习', type: 'quantity', unit: '=字', rule: DAILY, amount: 500, start: '2026-10-01', stopLoss: '连续 3 天\n没做就复盘', ended: null,
    records: [{ date: '2026-10-01', value: 500 }, { date: '2026-10-02', value: 500 }] };
  const md = C.toMarkdown(p, '2026-10', '2026-10-04');
  assert.match(md, /执行率 \| 50%/);
  assert.match(md, /\| 2026-10-01 \| 500 =字 \|/);
  assert.match(md, /止损规则\(仅记录,不执行\):连续 3 天 没做就复盘/);
  assert.match(md, /# 月度总结 2026-10:写作\|练习/);
  const md2 = C.toMarkdown(Object.assign({}, p, { unit: '字', records: [{ date: '2026-10-01', value: 5 }] }), '2026-10', '2026-10-04');
  assert.match(md2, /\| 本月累计 \| 5 字 \|/);
});

function good() {
  return { app: 'dca-ledger', version: 1, practices: [{ id: 'p1', name: '写作', type: 'quantity', unit: '字', rule: { kind: 'daily' }, amount: 500, start: '2026-10-01', stopLoss: '', ended: null, annualRate: 0, records: [{ date: '2026-10-02', value: 500 }] }] };
}

test('validateImport 接受合法文件并返回干净副本', () => {
  const r = C.validateImport(good());
  assert.equal(r.ok, true);
  assert.equal(r.data.practices[0].records.length, 1);
  const again = C.validateImport(JSON.parse(C.exportJson(r.data.practices)));
  assert.equal(again.ok, true);
});

test('validateImport 整份拒绝非法类型、枚举、日期、重复 ID、重复日期', () => {
  const cases = [
    ['类型', o => { o.practices[0].type = 'money'; }, /type/],
    ['规则', o => { o.practices[0].rule = { kind: 'weekly', n: 8 }; }, /rule\.n/],
    ['日期', o => { o.practices[0].start = '2026-02-30'; }, /start/],
    ['金额字符串', o => { o.practices[0].amount = '500'; }, /amount/],
    ['记录值', o => { o.practices[0].records[0].value = -1; }, /值/],
    ['记录早于开始', o => { o.practices[0].records[0].date = '2026-09-01'; }, /早于开始/],
    ['重复日期', o => { o.practices[0].records.push({ date: '2026-10-02', value: 1 }); }, /重复/],
    ['重复 id', o => { o.practices.push(JSON.parse(JSON.stringify(o.practices[0]))); }, /id "p1" 重复/],
    ['年化', o => { o.practices[0].annualRate = '6%'; }, /annualRate/],
    ['版本', o => { o.version = 2; }, /version/],
    ['结束早于开始', o => { o.practices[0].ended = '2026-09-01'; }, /结束日期/]
  ];
  for (const [name, mutate, re] of cases) {
    const o = good(); mutate(o);
    const r = C.validateImport(o);
    assert.equal(r.ok, false, name);
    assert.equal(r.data, null, name);
    assert.ok(r.errors.some(e => re.test(e)), name + ' → ' + r.errors.join('|'));
  }
  assert.equal(C.validateImport(null).ok, false);
  assert.equal(C.validateImport([]).ok, false);
  assert.equal(C.validateImport({ app: 'dca-ledger', version: 1, practices: 'x' }).ok, false);
});

test('validateImport 不会被 __proto__ 键污染,且丢弃未知字段', () => {
  const o = JSON.parse('{"app":"dca-ledger","version":1,"practices":[{"__proto__":{"polluted":1},"id":"p1","name":"x","type":"count","unit":"次","rule":{"kind":"daily"},"amount":1,"start":"2026-10-01","records":[],"extra":1}]}');
  const r = C.validateImport(o);
  assert.equal(r.ok, true);
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(r.data.practices[0], 'extra'), false);
});

test('日期工具:校验、加减、周几', () => {
  assert.equal(C.isValidDate('2028-02-29'), true);
  assert.equal(C.isValidDate('2027-02-29'), false);
  assert.equal(C.isValidDate('2026-1-1'), false);
  assert.equal(C.addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(C.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(C.weekdayIdx(C.dayOf('2026-10-19')), 0); // 周一
  assert.equal(C.weekdayIdx(C.dayOf('2026-10-25')), 6); // 周日
});

/* ---- 审核修复 ---- */
test('[P1] 执行率返回真实比值,不截断:实际 3 / 应执行 2 = 1.5', () => {
  const recs = rec('2026-10-05', '2026-10-06', '2026-10-07');
  const r = C.executionRate(recs, { kind: 'weekly', n: 2 }, '2026-10-05', '2026-10-11');
  assert.deepEqual([r.actual, r.expected, r.rate], [3, 2, 1.5]);
  // 月度总结同口径:每周 1 次的践行本月做了 3 次
  const w1 = { kind: 'weekly', n: 1 };
  const s = C.monthlySummary(rec('2026-10-05', '2026-10-06', '2026-10-07'), w1, '2026-10', { start: '2026-10-05', today: '2026-10-11' });
  assert.deepEqual([s.expected, s.actual, s.rate], [1, 3, 3]);
  assert.match(C.toMarkdown({ id: 'a', name: 'x', type: 'count', unit: '次', rule: w1, amount: 1, start: '2026-10-05', ended: null, records: rec('2026-10-05', '2026-10-06', '2026-10-07') }, '2026-10', '2026-10-11'), /执行率 \| 300%/);
});

test('[P0] project:每周 N 次的金额型,推算 4 周 = 4×N 次投入(100×3×4=1200)', () => {
  const w3 = { kind: 'weekly', n: 3 };
  const pr = C.project(w3, 100, 4, 0);
  assert.equal(pr.executions, 12);
  assert.equal(pr.curve.length, 12);
  assert.equal(pr.curve[11].invested, 1200);
  assert.equal(pr.lump[11].invested, 1200); // 一次性对照同额
  assert.equal(pr.ppy, 156);
  const g = C.project(w3, 100, 4, 0.06);
  assert.ok(g.curve[11].value > 1200);
  assert.ok(g.lump[11].value > 1200);
  // 每天与每月:一期一次
  assert.equal(C.project({ kind: 'daily' }, 10, 30, 0).curve[29].invested, 300);
  assert.equal(C.project({ kind: 'monthly', day: 1 }, 1000, 12, 0).curve[11].invested, 12000);
  assert.deepEqual(C.project(w3, 100, 4000, 0).curve, []); // 超过上限返回空而不是抛错
});

test('[P0] withRecord 与读取校验同一套规则:超限值被拒绝且不改动原数据', () => {
  const p = { id: 'a', name: 'x', type: 'quantity', unit: '字', rule: DAILY, amount: 500, start: '2026-10-01', stopLoss: '', ended: null, annualRate: 0, records: [{ date: '2026-10-02', value: 500 }] };
  const bad = C.withRecord(p, '2026-10-03', 1e13);
  assert.equal(bad.ok, false);
  assert.equal(bad.practice, null);
  assert.equal(p.records.length, 1);
  assert.equal(C.withRecord(p, '2026-10-03', 0).ok, false);
  assert.equal(C.withRecord(p, '2026-09-30', 1).ok, false);
  const good = C.withRecord(p, '2026-10-03', 1e12);
  assert.equal(good.ok, true);
  assert.equal(good.practice.records.length, 2);
  // 写入后的数据能通过导入校验(刷新不会丢)
  assert.equal(C.validateImport({ app: 'dca-ledger', version: 1, practices: [good.practice] }).ok, true);
  // 覆盖同一天:替换而不是重复
  const upd = C.withRecord(p, '2026-10-02', 800);
  assert.equal(upd.ok, true);
  assert.deepEqual(upd.practice.records, [{ date: '2026-10-02', value: 800 }]);
});

test('[第五轮] recordChange:区分新增、相同值、覆盖已有值(覆盖前要让界面确认新旧数值)', () => {
  const p = { records: [{ date: '2026-10-20', value: 300 }] };
  assert.deepEqual(C.recordChange(p, '2026-10-19', 500), { kind: 'new', existing: null });
  assert.deepEqual(C.recordChange(p, '2026-10-20', 300), { kind: 'same', existing: 300 });
  assert.deepEqual(C.recordChange(p, '2026-10-20', 500), { kind: 'overwrite', existing: 300 });
  assert.deepEqual(C.recordChange({ records: [] }, '2026-10-20', 1), { kind: 'new', existing: null });
});

test('[第五轮] periodWord:推算期数的单位随规则变化,每周 N 次时给出总执行次数', () => {
  assert.deepEqual(C.periodWord({ kind: 'daily' }, 90), { unit: '天', label: '推算天数', executions: 90, note: '' });
  assert.deepEqual(C.periodWord({ kind: 'monthly', day: 1 }, 12), { unit: '个月', label: '推算月数', executions: 12, note: '' });
  const w = C.periodWord({ kind: 'weekly', n: 3 }, 4);
  assert.equal(w.unit, '周');
  assert.equal(w.label, '推算周数');
  assert.equal(w.executions, 12);
  assert.ok(w.note.includes('每周 3 次') && w.note.includes('12 次'), w.note);
  assert.equal(C.periodWord({ kind: 'weekly', n: 3 }, NaN).executions, null);
});

test('[第五轮] 合成示例的导出带数据来源:CSV 加一列、Markdown 加一行;真实数据不加', () => {
  const real = { name: '读书', type: 'count', rule: { kind: 'daily' }, amount: 1, unit: '次', start: '2026-10-01', stopLoss: '', ended: null, annualRate: 0, records: [{ date: '2026-10-02', value: 1 }] };
  const demo = Object.assign({}, real, { name: '示例', sample: true });
  const csvReal = C.toCsv([real]).split('\n');
  assert.ok(!csvReal[0].includes('数据来源'));
  const csv = C.toCsv([real, demo]).split('\n');
  assert.ok(csv[0].endsWith(',数据来源'));
  assert.ok(csv[1].endsWith(',真实数据') || csv[1].endsWith(','), csv[1]);
  assert.ok(csv[2].endsWith(',合成示例'), csv[2]);
  assert.ok(C.toMarkdown(demo, '2026-10', '2026-10-20').includes('数据来源:合成示例'));
  assert.ok(!C.toMarkdown(real, '2026-10', '2026-10-20').includes('合成示例'));
});

test('[第五轮] executionRate 口径:只要当天有正数记录就算执行一次,不看是否达到定额', () => {
  const small = [{ date: '2026-10-18', value: 1 }, { date: '2026-10-19', value: 500 }];
  const r = C.executionRate(small, DAILY, '2026-10-18', '2026-10-19');
  assert.equal(r.actual, 2);
  assert.equal(r.expected, 2);
  assert.equal(r.rate, 1);
});
