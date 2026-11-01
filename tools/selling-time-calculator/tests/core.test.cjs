'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../core.js');

const base = { target: 20000, hours: 80, vacancy: 20, commission: 15, hidden: 30, tax: 5 };

test('modeOne 公式:目标 ÷ 有效工时 ÷ (1-抽成) ÷ (1-税费)', () => {
  const r = C.modeOne(base);
  assert.strictEqual(r.feasible, true);
  assert.strictEqual(r.minHourly, C.round2(20000 / 64 / 0.85 / 0.95));
  assert.strictEqual(r.billableHours, 64);
  assert.strictEqual(r.totalHours, 83.2);
  assert.strictEqual(r.effectiveHourly, C.round2(20000 / 83.2));
});

test('modeOne 无抽成无税无空置时等于目标 ÷ 工时', () => {
  const r = C.modeOne({ target: 10000, hours: 100 });
  assert.strictEqual(r.minHourly, 100);
});

test('modeOne 空置率 100% 不除零,标记不可行', () => {
  const r = C.modeOne({ ...base, vacancy: 100 });
  assert.strictEqual(r.feasible, false);
  assert.strictEqual(r.minHourly, null);
  assert.match(r.reason, /空置率/);
});

test('modeOne 抽成或税费 100%、工时 0 都不可行且不抛错', () => {
  assert.strictEqual(C.modeOne({ ...base, commission: 100 }).feasible, false);
  assert.strictEqual(C.modeOne({ ...base, tax: 100 }).feasible, false);
  assert.strictEqual(C.modeOne({ ...base, hours: 0 }).feasible, false);
});

test('百分比 > 100 或负数或非数字被拒绝', () => {
  const a = C.modeOne({ ...base, vacancy: 101 });
  assert.strictEqual(a.valid, false);
  assert.match(a.errors[0], /空置率.*0 到 100/);
  assert.strictEqual(C.modeOne({ ...base, tax: -1 }).valid, false);
  assert.strictEqual(C.modeOne({ ...base, hours: 'abc' }).valid, false);
  assert.strictEqual(C.modeTwo({ price: 10, fee: 120 }).valid, false);
  assert.strictEqual(C.modeThree({ share: 150 }).valid, false);
});

test('空情景不报错', () => {
  assert.doesNotThrow(() => { C.modeOne({}); C.modeOne(); C.modeTwo(); C.modeThree(null); C.compare([{}]); C.compare(); });
  const r = C.modeOne({});
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.feasible, false);
  assert.strictEqual(C.compare([{}]).entries[0].best, null);
});

test('sensitivity 步长 10 个百分点且时薪严格单调上升', () => {
  const rows = C.sensitivity(base, 'vacancy', 4);
  assert.deepStrictEqual(rows.map((r) => r.value), [20, 30, 40, 50, 60]);
  assert.strictEqual(rows[0].delta, 0);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].hourly > rows[i - 1].hourly);
    assert.strictEqual(rows[i].stepDelta, C.round2(rows[i].hourly - rows[i - 1].hourly));
  }
  assert.strictEqual(rows[1].hourly, C.round2(20000 / 56 / 0.85 / 0.95));
});

test('sensitivity 到 100% 前截断,非法字段返回空', () => {
  const rows = C.sensitivity({ ...base, vacancy: 85 }, 'vacancy', 5);
  assert.deepStrictEqual(rows.map((r) => r.value), [85, 95]);
  assert.deepStrictEqual(C.sensitivity(base, 'target', 3), []);
});

test('modeTwo 月收入扣平台费、退款、税费并四舍五入到分', () => {
  const r = C.modeTwo({ buildHours: 60, price: 299, units: 30, fee: 10, refund: 5, tax: 5, hourlyValue: 300 });
  const net = 299 * 0.9 * 0.95 * 0.95;
  assert.strictEqual(r.netPerUnit, C.round2(net));
  assert.strictEqual(r.monthlyIncome, C.round2(30 * net));
});

test('modeTwo 回本销量上取整', () => {
  const r = C.modeTwo({ buildHours: 10, price: 100, units: 5, hourlyValue: 100 });
  assert.strictEqual(r.breakEvenUnits, 10);
  const r2 = C.modeTwo({ buildHours: 10, price: 99, units: 5, hourlyValue: 100 });
  assert.strictEqual(r2.breakEvenUnits, 11);
});

test('modeTwo 退款率提高会推高回本销量,退款 100% 无法回本', () => {
  const a = C.modeTwo({ buildHours: 10, price: 100, hourlyValue: 100, refund: 0 });
  const b = C.modeTwo({ buildHours: 10, price: 100, hourlyValue: 100, refund: 50 });
  assert.ok(b.breakEvenUnits > a.breakEvenUnits);
  const c = C.modeTwo({ buildHours: 10, price: 100, hourlyValue: 100, refund: 100 });
  assert.strictEqual(c.breakEvenUnits, null);
  assert.strictEqual(c.monthlyIncome, 0);
});

test('modeTwo 曲线单调不减、含当前销量和回本点,并给出达标销量', () => {
  const r = C.modeTwo({ buildHours: 40, price: 200, units: 12, fee: 10, hourlyValue: 250, target: 5000 });
  const us = r.curve.map((p) => p.units);
  assert.ok(us.includes(12) && us.includes(r.breakEvenUnits));
  for (let i = 1; i < r.curve.length; i++) {
    assert.ok(r.curve[i].units > r.curve[i - 1].units);
    assert.ok(r.curve[i].hourly >= r.curve[i - 1].hourly);
  }
  assert.strictEqual(r.unitsForTarget, Math.ceil(5000 / 180));
});

test('modeThree 净增 = 腾出工时 × 可售比例 × 你的时薪 − 外包成本', () => {
  const r = C.modeThree({ outsourceRate: 60, yourRate: 300, share: 25, fill: 80, hours: 80 });
  assert.strictEqual(r.freedHours, 20);
  assert.strictEqual(r.gain, 4800);
  assert.strictEqual(r.cost, 1200);
  assert.strictEqual(r.net, 3600);
  assert.strictEqual(r.worthIt, true);
});

test('modeThree 临界时薪与净增正负', () => {
  const r = C.modeThree({ outsourceRate: 60, yourRate: 100, share: 50, fill: 50, hours: 100 });
  assert.strictEqual(r.breakEvenRate, 120);
  assert.ok(r.net < 0);
  assert.strictEqual(r.worthIt, false);
  const ok = C.modeThree({ outsourceRate: 60, yourRate: 120, share: 50, fill: 50, hours: 100 });
  assert.strictEqual(ok.net, 0);
  assert.strictEqual(C.modeThree({ outsourceRate: 60, yourRate: 500, share: 50, fill: 0, hours: 100 }).breakEvenRate, null);
});

test('四舍五入到分', () => {
  assert.strictEqual(C.round2(1.005), 1.01);
  assert.strictEqual(C.round2(2.675), 2.68);
  assert.strictEqual(C.round2(-1.005), -1.01);
  assert.strictEqual(C.round2(NaN), null);
  const r = C.modeOne({ target: 1000, hours: 7 });
  assert.strictEqual(r.minHourly, 142.86);
});

const scen = (name, units) => ({ id: name, name,
  one: base,
  two: { buildHours: 60, price: 299, units, fee: 10, refund: 5, hourlyValue: 0 },
  three: { outsourceRate: 60, yourRate: 300, share: 25, fill: 80, hours: 0 } });

test('compare 情景按最高等效时薪降序,模式固定顺序并给排名', () => {
  const c = C.compare([scen('低', 5), scen('高', 200), scen('中', 50)]);
  assert.strictEqual(c.entries[0].name, '高');
  for (let i = 1; i < c.entries.length; i++) assert.ok(c.entries[i - 1].bestHourly >= c.entries[i].bestHourly);
  assert.deepStrictEqual(C.compare([scen('先', 5), scen('后', 5)]).entries.map((e) => e.name), ['先', '后']);
  const e = c.entries[0];
  assert.deepStrictEqual(e.modes.map((m) => m.mode), ['one', 'two', 'three']);
  const ranks = e.modes.map((m) => m.rank).sort();
  assert.deepStrictEqual(ranks, [1, 2, 3]);
  assert.strictEqual(e.best, 'two');
  assert.ok(c.maxIncome >= e.modes[1].income);
});

test('compare 回退:未填估值时薪用模式一最低时薪,未填工时用模式一总工时', () => {
  const e = C.compare([scen('x', 30)]).entries[0];
  assert.strictEqual(e.r2.breakEvenUnits, Math.ceil(60 * e.r1.minHourly / e.r2.netPerUnit - 1e-9));
  assert.strictEqual(e.r3.freedHours, C.round2(83.2 * 0.25));
});

test('toMarkdown 与 toCsv 内容', () => {
  const c = C.compare([scen('基准', 30)]);
  const md = C.toMarkdown(c);
  assert.match(md, /^# 时间出售三模式试算/);
  assert.match(md, /\| 基准 \| 卖一次 \|/);
  assert.match(md, /不是市场预测/);
  const csv = C.toCsv(c).trim().split('\n');
  assert.strictEqual(csv[0], '情景,模式,月收入,工时,等效时薪,情景内排名');
  assert.strictEqual(csv.length, 4);
  assert.ok(csv[1].startsWith('基准,卖一次,20000.00,83.20,'));
  assert.match(C.toMarkdown({ entries: [] }), /没有已保存的情景/);
});

test('公式防护:= + - @ 开头加单引号,单独 +/- 不算', () => {
  assert.strictEqual(C.guard('=SUM(A1)'), "'=SUM(A1)");
  assert.strictEqual(C.guard('+1'), "'+1");
  assert.strictEqual(C.guard('-2'), "'-2");
  assert.strictEqual(C.guard('@x'), "'@x");
  assert.strictEqual(C.guard('-'), '-');
  assert.strictEqual(C.guard('+'), '+');
  assert.strictEqual(C.guard('正常'), '正常');
  const c = C.compare([{ name: '=HYPERLINK("x")', one: base }, { name: 'a|b', one: base }]);
  assert.ok(C.toCsv(c).includes('"\'=HYPERLINK(""x"")"'));
  assert.ok(C.toMarkdown(c).includes("| '=HYPERLINK") && C.toMarkdown(c).includes('a\\|b'));
});

test('validateImport 接受合法备份并拒绝非法内容', () => {
  const st = C.emptyState();
  st.scenarios.push({ id: 's1', name: 'A', one: { ...st.current.one }, two: { ...st.current.two }, three: { ...st.current.three } });
  assert.strictEqual(C.validateImport(JSON.stringify(st)).ok, true);
  assert.strictEqual(C.validateImport('{').ok, false);
  assert.strictEqual(C.validateImport({ ...st, version: 2 }).ok, false);
  const bad = JSON.parse(JSON.stringify(st));
  bad.current.one.vacancy = 120;
  const r = C.validateImport(bad);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /vacancy/);
  const strNum = JSON.parse(JSON.stringify(st));
  strNum.current.two.price = '5';
  assert.strictEqual(C.validateImport(strNum).ok, false);
});

test('validateImport 拒绝重复 ID、超过 3 个情景、非法 ID', () => {
  const st = C.emptyState();
  const mk = (id) => ({ id, name: 'n', one: { ...st.current.one }, two: { ...st.current.two }, three: { ...st.current.three } });
  assert.match(C.validateImport({ ...st, scenarios: [mk('a'), mk('a')] }).error, /重复/);
  assert.match(C.validateImport({ ...st, scenarios: [mk('a'), mk('b'), mk('c'), mk('d')] }).error, /最多保存 3/);
  assert.strictEqual(C.validateImport({ ...st, scenarios: [mk('__proto__ x')] }).ok, false);
  assert.strictEqual(C.validateImport({ ...st, scenarios: [mk('__proto__')] }).ok, true);
});

test('模式三:全部再出售时工时不会少算(100 小时、外包 50%、全部再出售 → 仍工作 100 小时)', () => {
  const sc = { name: 'x', one: { target: 10000, hours: 100 }, two: {}, three: { outsourceRate: 50, yourRate: 200, share: 50, fill: 100, hours: 100 } };
  const m = C.compare([sc]).entries[0].modes[2];
  assert.strictEqual(m.hours, 100);
  assert.strictEqual(m.income, 10000 + 50 * 200 - 50 * 50);
  assert.strictEqual(m.hourly, 175);
  assert.strictEqual(C.modeThree(sc.three).soldHours, 50);
});

test('模式三:只有部分腾出时间再卖出时,工时 = 总工时 − 腾出 + 再卖出', () => {
  const sc = { name: 'x', one: { target: 10000, hours: 100 }, two: {}, three: { outsourceRate: 50, yourRate: 200, share: 50, fill: 40, hours: 100 } };
  const m = C.compare([sc]).entries[0].modes[2];
  assert.strictEqual(m.hours, 70);
});

test('外包涉及工时超过模式一总工时时拒绝该情景,不产生负工时', () => {
  const sc = { name: 'x', one: { target: 10000, hours: 100 }, two: {}, three: { outsourceRate: 50, yourRate: 200, share: 50, fill: 100, hours: 300 } };
  const e = C.compare([sc]).entries[0];
  assert.strictEqual(e.r3.valid, false);
  assert.match(e.r3.errors[0], /不能超过模式一的总工时/);
  assert.strictEqual(e.modes[2].hours, null);
  assert.strictEqual(e.modes[2].income, null);
  e.modes.forEach((m) => assert.ok(m.hours === null || m.hours >= 0));
  const ok = C.compare([{ ...sc, three: { ...sc.three, hours: 100 } }]).entries[0];
  assert.strictEqual(ok.r3.valid, true);
});

test('explainTwo 写出单份到手公式、实际使用的税费(继承自现状)与回本公式', () => {
  const sc = { name: 'x', one: { target: 20000, hours: 80, vacancy: 20, commission: 15, hidden: 30, tax: 5 },
    two: { buildHours: 60, price: 299, units: 30, fee: 10, refund: 5, hourlyValue: 0 }, three: {} };
  const ex = C.explainTwo(sc);
  assert.strictEqual(ex.taxPct, 5);
  assert.strictEqual(ex.taxInherited, true);
  assert.match(ex.netFormula, /299 × \(1−10%\) × \(1−5%\) × \(1−5%\) = 242\.\d\d/);
  assert.strictEqual(ex.hourlyValueUsed, C.modeOne(sc.one).minHourly);
  assert.strictEqual(ex.hourlyValueSource, 'mode-one');
  assert.match(ex.breakEvenFormula, /60 × 387\.00 ÷ 242\.\d\d.*向上取整/);
  const own = C.explainTwo({ ...sc, two: { ...sc.two, hourlyValue: 100 } });
  assert.strictEqual(own.hourlyValueSource, 'input');
  assert.match(own.breakEvenFormula, /60 × 100\.00/);
});

test('explainTwo 单价为 0 或没有估值时薪时说明原因而不是公式', () => {
  const ex = C.explainTwo({ one: { tax: 5 }, two: { buildHours: 10, price: 0 }, three: {} });
  assert.strictEqual(ex.breakEvenFormula, null);
  assert.match(ex.breakEvenReason, /单份到手为 0/);
});

test('importSummary 给出备份里的情景数量与当前数据的情景数量,供确认前预览', () => {
  const cur = C.emptyState();
  cur.scenarios.push({ id: 'a', name: 'a', one: cur.current.one, two: cur.current.two, three: cur.current.three });
  const inc = C.emptyState();
  inc.scenarios.push(cur.scenarios[0], { ...cur.scenarios[0], id: 'b' });
  const s = C.importSummary(cur, inc);
  assert.deepStrictEqual({ cur: s.currentScenarios, inc: s.incomingScenarios }, { cur: 1, inc: 2 });
  assert.match(s.text, /当前 1 个情景.*备份文件 2 个情景/);
});
