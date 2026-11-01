'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');
require('../sample-data.js');
const SAMPLE = globalThis.MARGIN_SAMPLE;

const base = (o) => Object.assign({
  id: 'p', name: 'n', client: 'c', quote: 1000000, taxIncluded: false, taxRate: 6, status: '进行中',
  startDate: '2026-01-01', deliverDate: '2026-01-31', prepaidPct: 0, termDays: 30, opportunityHourly: 15000, lines: []
}, o);
const labor = (hours, rate, id) => ({ id: id || 'l' + hours + rate, type: 'labor', note: '', hours, rate });
const amt = (type, amount, id) => ({ id: id || 'a' + type + amount, type, note: '', amount });
const stateOf = (projects) => ({ version: 1, settings: { opportunityHourly: 15000 }, projects });

test('含税换算:48000 元含税 6% → 不含税 45283.02 元(分,四舍五入)', () => {
  assert.equal(C.netRevenue(4800000, true, 6), 4528302);
  assert.equal(C.netRevenue(10600, true, 6), 10000);
  assert.equal(C.netRevenue(4800000, false, 6), 4800000, '不含税时税率不起作用');
  assert.equal(C.netRevenue(10000, true, 0), 10000);
});

test('工具订阅按月分摊:月费 300 元 × 2.5 月 × 50% = 375 元', () => {
  assert.equal(C.lineAmount({ type: 'tool', monthlyFee: 30000, months: 2.5, share: 50 }), 37500);
  assert.equal(C.lineAmount({ type: 'tool', monthlyFee: 30000, months: 3, share: 0 }), 0);
  assert.equal(C.lineAmount({ type: 'labor', hours: 12.5, rate: 8000 }), 100000);
  assert.equal(C.costTotal([amt('outsource', 500), amt('travel', 250), labor(2, 100)]), 950);
});

test('毛利率除零:收入为 0 时 rate 为 null,不是 NaN/Infinity', () => {
  const m = C.margin(base({ quote: 0, lines: [amt('other', 5000)] }));
  assert.equal(m.rate, null);
  assert.equal(m.gross, -5000);
});

test('perHour:没有人工小时时为 null,且不触发机会成本警示', () => {
  const m = C.margin(base({ lines: [amt('outsource', 100000)] }));
  assert.equal(m.perHour, null);
  assert.equal(m.hours, 0);
  assert.equal(m.belowOpportunity, false);
});

test('机会成本警示:每小时毛利 < 机会成本时薪才警示,等于不警示', () => {
  // 收入 10000 元,成本 = 10 小时 × 50 元 = 500 元 → 毛利 9500 元 → 每小时 950 元
  const hi = C.margin(base({ quote: 1000000, lines: [labor(10, 5000)] }));
  assert.equal(hi.perHour, 95000);
  assert.equal(hi.belowOpportunity, false);
  // 收入 1000 元,10 小时 × 50 元 → 毛利 500 元 → 每小时 50 元 < 150 元
  const lo = C.margin(base({ quote: 100000, lines: [labor(10, 5000)] }));
  assert.equal(lo.perHour, 5000);
  assert.equal(lo.belowOpportunity, true);
  // 恰好等于:毛利 1500 元 / 10 小时 = 150 元
  const eq = C.margin(base({ quote: 200000, lines: [labor(10, 5000)] }));
  assert.equal(eq.perHour, 15000);
  assert.equal(eq.belowOpportunity, false);
});

test('dueDate:预付 < 100% 时 = 交付日 + 账期;跨月跨年;缺交付日为 null', () => {
  assert.equal(C.dueDate(base({ deliverDate: '2026-01-31', termDays: 30 })), '2026-03-02');
  assert.equal(C.dueDate(base({ deliverDate: '2026-12-20', termDays: 20 })), '2027-01-09');
  assert.equal(C.dueDate(base({ deliverDate: '2028-02-28', termDays: 1 })), '2028-02-29', '闰年');
  assert.equal(C.dueDate(base({ deliverDate: '' })), null);
  assert.equal(C.dueDate(base({ prepaidPct: 100, startDate: '2026-05-01', deliverDate: '2026-09-01' })), '2026-05-01', '全额预付按开始日');
  assert.equal(C.tailAmount(base({ quote: 1000000, prepaidPct: 30 })), 700000);
});

test('逾期边界:回款日当天不算,次日算;已收款/已取消不算', () => {
  const p = base({ deliverDate: '2026-10-01', termDays: 9 }); // 回款日 2026-10-10
  assert.equal(C.dueDate(p), '2026-10-10');
  assert.equal(C.isOverdue(p, '2026-10-10'), false);
  assert.equal(C.isOverdue(p, '2026-10-11'), true);
  assert.equal(C.isOverdue(Object.assign({}, p, { status: '已收款' }), '2026-12-01'), false);
  assert.equal(C.isOverdue(Object.assign({}, p, { status: '已取消' }), '2026-12-01'), false);
  assert.equal(C.isOverdue(base({ deliverDate: '' }), '2026-12-01'), false);
});

test('portfolio:按毛利率从高到低,收入为 0 的排最后,已取消不进排名', () => {
  const a = base({ id: 'a', name: 'A', quote: 100000, lines: [amt('other', 20000)] }); // 80%
  const b = base({ id: 'b', name: 'B', quote: 100000, lines: [amt('other', 70000)] }); // 30%
  const z = base({ id: 'z', name: 'Z', quote: 0 });
  const x = base({ id: 'x', name: 'X', quote: 100000, status: '已取消' });
  const r = C.portfolio([z, b, x, a], '2026-10-20');
  assert.deepEqual(r.items.map(i => i.project.id), ['a', 'b', 'z']);
  assert.deepEqual(r.worst3.map(i => i.project.id), ['b', 'a']);
  assert.equal(r.cancelled.length, 1);
  assert.equal(r.totals.revenue, 200000);
  assert.ok(Math.abs(r.totals.rate - 0.55) < 1e-9);
});

test('byClient:汇总收入/项目数/平均与加权毛利率;__proto__ 客户名安全', () => {
  const ps = [
    base({ id: '1', client: 'A', quote: 100000, lines: [amt('other', 50000)] }), // 50%
    base({ id: '2', client: 'A', quote: 300000, lines: [amt('other', 30000)] }), // 90%
    base({ id: '3', client: '__proto__', quote: 100000 }),
    base({ id: '4', client: 'B', quote: 100000, status: '已取消' })
  ];
  const r = C.byClient(ps);
  assert.equal(r.length, 2, '已取消的 B 不出现');
  const a = r.find(x => x.client === 'A');
  assert.equal(a.count, 2);
  assert.equal(a.revenue, 400000);
  assert.ok(Math.abs(a.avgRate - 0.7) < 1e-9);
  assert.ok(Math.abs(a.weightedRate - 0.8) < 1e-9);
  assert.ok(r.find(x => x.client === '__proto__'));
  assert.equal({}.polluted, undefined);
});

test('季度边界:3/31 属 Q1,4/1 属 Q2;跨年上一季度是上年 Q4;无交付日不参与', () => {
  const q = C.quarterOf('2026-03-31');
  assert.equal(q.q, 1); assert.equal(q.end, '2026-03-31');
  assert.equal(C.quarterOf('2026-04-01').q, 2);
  const ps = [
    base({ id: 'a', deliverDate: '2026-03-31', quote: 100000 }),
    base({ id: 'b', deliverDate: '2026-04-01', quote: 200000 }),
    base({ id: 'c', deliverDate: '2025-12-31', quote: 400000 }),
    base({ id: 'd', deliverDate: '', quote: 800000 })
  ];
  const r = C.quarterCompare(ps, '2026-02-10'); // 当前 2026Q1,上一季度 2025Q4
  assert.equal(r.current.count, 1); assert.equal(r.current.revenue, 100000);
  assert.equal(r.previous.count, 1); assert.equal(r.previous.revenue, 400000);
  assert.equal(r.previous.start, '2025-10-01');
  assert.equal(r.noDate, 1);
  const r2 = C.quarterCompare(ps, '2026-04-02');
  assert.equal(r2.current.revenue, 200000);
  assert.equal(r2.previous.revenue, 100000);
});

test('scenario:折扣降低收入、时薪改写所有人工行;不修改原项目', () => {
  const p = base({ quote: 10000000, lines: [labor(100, 10000), amt('outsource', 2000000)] }); // 收入 10 万,成本 10 万/… 见下
  const b = C.margin(p); // 成本 = 100h×100 元 = 1 万 + 2 万 = 3 万 → 毛利 7 万,70%
  assert.equal(b.cost, 3000000);
  assert.ok(Math.abs(b.rate - 0.7) < 1e-9);
  const d = C.scenario(p, { discount: 10 }); // 收入 9 万,毛利 6 万
  assert.equal(d.quote, 9000000);
  assert.equal(d.scenario.gross, 6000000);
  assert.ok(Math.abs(d.scenario.rate - 6 / 9) < 1e-9);
  assert.ok(d.rateDelta < 0);
  const h = C.scenario(p, { hourly: 20000 }); // 人工 100h×200 元 = 2 万 → 成本 4 万
  assert.equal(h.scenario.cost, 4000000);
  assert.equal(p.lines[0].rate, 10000, '原项目不变');
  assert.equal(p.quote, 10000000);
  const clamp = C.scenario(p, { discount: 500, hourly: NaN });
  assert.equal(clamp.scenario.revenue, 0, '折扣封顶 100%');
  assert.equal(clamp.scenario.rate, null);
});

test('?today:合法固定今天;非法格式与 2026-02-30 自动进位都回退真实今天', () => {
  assert.equal(C.resolveToday('?today=2026-10-20', '2030-01-01'), '2026-10-20');
  assert.equal(C.resolveToday('?today=2026-02-30', '2030-01-01'), '2030-01-01');
  assert.equal(C.resolveToday('?today=2026-13-01', '2030-01-01'), '2030-01-01');
  assert.equal(C.resolveToday('?today=abc', '2030-01-01'), '2030-01-01');
  assert.equal(C.resolveToday('', '2030-01-01'), '2030-01-01');
  assert.equal(C.resolveToday('?today=2028-02-29', 'x'), '2028-02-29');
  assert.equal(C.resolveToday('?today=2027-02-29', 'x'), 'x');
});

test('CSV 公式防护:= + - @ 开头的用户字段加单引号;单独的 - + 不算;含逗号与引号会转义', () => {
  assert.equal(C.guard('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(C.guard('+1'), "'+1");
  assert.equal(C.guard('-1'), "'-1");
  assert.equal(C.guard('@cmd'), "'@cmd");
  assert.equal(C.guard('-'), '-');
  assert.equal(C.guard('+'), '+');
  assert.equal(C.guard('正常'), '正常');
  const csv = C.toCsv([base({ name: '=HYPERLINK("x")', client: 'a,b' })], '2026-10-20');
  const line = csv.split('\r\n')[1];
  assert.ok(line.startsWith(`"'=HYPERLINK(""x"")","a,b",进行中,CNY`), line);
  assert.equal(csv.split('\r\n')[0].split(',').length, 40);
});

test('Markdown:表格里的 | 与换行被转义,公式前缀加引号', () => {
  const p = base({ name: '甲\n乙', lines: [{ id: 'x', type: 'other', note: '=cmd|x\n换行', amount: 12345 }] });
  const md = C.toMarkdown(p, '2026-10-20');
  assert.ok(md.includes("| 其他 | '=cmd\\|x 换行 |"), md);
  assert.ok(md.startsWith('# 项目毛利说明:甲 乙'));
  assert.ok(md.includes('123.45'));
});

test('validateImport:状态枚举不合法 → 整份拒绝并说明原因,不修正', () => {
  const st = stateOf([base({ status: '进行中' })]);
  assert.equal(C.validateImport(JSON.stringify(st)).ok, true);
  const bad = stateOf([base({ id: 'a' }), base({ id: 'b', status: '完成了' })]);
  const r = C.validateImport(bad);
  assert.equal(r.ok, false);
  assert.match(r.error, /项目 2.*状态.*完成了/);
});

test('validateImport:类型、ID 唯一、日期真实性、成本类型与字段缺失都拒绝', () => {
  assert.equal(C.validateImport('{坏').ok, false);
  assert.equal(C.validateImport(stateOf([base({ id: 'a' }), base({ id: 'a' })])).ok, false, '项目 id 重复');
  assert.equal(C.validateImport(stateOf([base({ lines: [amt('other', 1, 'x'), amt('other', 2, 'x')] })])).ok, false, '成本行 id 重复');
  assert.equal(C.validateImport(stateOf([base({ quote: 1.5 })])).ok, false, '分必须是整数');
  assert.equal(C.validateImport(stateOf([base({ quote: '100' })])).ok, false);
  assert.equal(C.validateImport(stateOf([base({ deliverDate: '2026-02-30' })])).ok, false);
  assert.equal(C.validateImport(stateOf([base({ taxRate: 101 })])).ok, false);
  assert.equal(C.validateImport(stateOf([base({ lines: [{ id: 'z', type: 'gift', note: '', amount: 1 }] })])).ok, false);
  assert.equal(C.validateImport(stateOf([base({ lines: [{ id: 'z', type: 'labor', note: '', hours: 1 }] })])).ok, false, '缺时薪');
  assert.equal(C.validateImport({ version: 3, settings: { opportunityHourly: 0 }, projects: [] }).ok, false);
  assert.equal(C.validateImport({ version: 1, settings: { opportunityHourly: 0 } }).ok, false);
  const ok = C.validateImport(stateOf([base({ name: '', client: '', deliverDate: '', startDate: '' })]));
  assert.equal(ok.ok, true, '半成品(空名称/空日期)可以保存和读取');
});

test('写入校验 = 读取校验:边界值(超大金额、超长文本、半成品)往返 JSON 后仍通过', () => {
  const p = base({ name: '长'.repeat(5000), quote: C.LIMIT, lines: [labor(1000000, 1000000, 'big'), amt('other', C.LIMIT, 'o'), { id: 't', type: 'tool', note: '', monthlyFee: 800000000, months: 1200, share: 100 }] });
  const st = stateOf([p]);
  const v = C.validateState(st);
  assert.equal(v.ok, true);
  const back = C.validateState(JSON.parse(JSON.stringify(v.state)));
  assert.equal(back.ok, true);
  assert.deepEqual(back.state, v.state);
  // 极端金额下乘法不丢精度(BigInt)
  assert.equal(C.lineAmount({ type: 'labor', hours: 1000000, rate: 1000000 }), 1e12);
  assert.equal(C.validateState(stateOf([base({ lines: [labor(1000000, C.LIMIT, 'x')] })])).ok, false, '单行算出的金额超上限要拒绝');
  assert.equal(C.validateState(stateOf([base({ quote: C.LIMIT + 1 })])).ok, false);
});

test('整数分精度:0.1+0.2 类浮点问题不出现在金额里;解析按分四舍五入', () => {
  assert.equal(C.parseMoney('0.1'), 10);
  assert.equal(C.parseMoney('0.30'), 30);
  assert.equal(C.parseMoney('1,234.565'), 123457);
  assert.equal(C.parseMoney('19.994'), 1999);
  assert.ok(Number.isNaN(C.parseMoney('abc')));
  assert.ok(Number.isNaN(C.parseMoney('-5')));
  assert.equal(C.parseMoney(''), 0);
  assert.ok(Number.isNaN(C.parseMoney('99999999999.99')));
  assert.equal(C.lineAmount(labor(0.1, 30)), 3);
  assert.equal(C.costTotal([amt('other', 10), amt('other', 20)]), 30);
  assert.equal(C.moneyPlain(-12345), '-123.45');
  assert.equal(C.formatMoney(123456789), '1,234,567.89');
  assert.equal(C.parseNumber('12.345'), 12.35);
  assert.ok(Number.isNaN(C.parseNumber('101', { max: 100 })));
});

test('示例数据:9 个项目、4 个客户、含税混合、1 个低于机会成本、2 个逾期、1 个已取消、跨季度,且通过校验', () => {
  const v = C.validateState(SAMPLE);
  assert.equal(v.ok, true, v.error);
  const ps = SAMPLE.projects;
  assert.equal(ps.length, 9);
  assert.equal(new Set(ps.map(p => p.client)).size, 4);
  assert.ok(ps.some(p => p.taxIncluded) && ps.some(p => !p.taxIncluded));
  const today = '2026-10-20';
  const r = C.portfolio(ps, today);
  assert.equal(r.items.filter(i => i.m.belowOpportunity).length, 1);
  assert.equal(r.overdue.length, 2);
  assert.equal(r.cancelled.length, 1);
  const q = C.quarterCompare(ps, today);
  assert.ok(q.current.count > 0 && q.previous.count > 0);
  assert.equal(r.worst3.length, 3);
  assert.ok(r.traits.common.some(s => s.includes('外包')), r.traits.common.join('|'));
});

test('quarterDeltaNote:区分「没有项目」与「收入为 0」,不再一律说没有项目', () => {
  const zero = id => base({ id, quote: 0, lines: [amt('other', 100000, 'z' + id)] });
  const both = C.quarterCompare([zero('a'), Object.assign(zero('b'), { deliverDate: '2025-12-31' })], '2026-02-10');
  assert.equal(both.rateDelta, null);
  const noteBoth = C.quarterDeltaNote(both);
  assert.ok(noteBoth.includes('收入为 0'), noteBoth);
  assert.ok(!noteBoth.includes('没有项目'), noteBoth);
  const onlyCur = C.quarterCompare([base({ id: 'a', deliverDate: '2026-01-31' })], '2026-02-10');
  assert.ok(C.quarterDeltaNote(onlyCur).includes('没有项目'));
  const oneZero = C.quarterCompare([base({ id: 'a', deliverDate: '2026-01-31' }), Object.assign(zero('b'), { deliverDate: '2025-12-31' })], '2026-02-10');
  const noteOne = C.quarterDeltaNote(oneZero);
  assert.ok(noteOne.includes('上季度') && noteOne.includes('收入为 0') && !noteOne.includes('本季度收入为 0'), noteOne);
  const ok = C.quarterCompare([base({ id: 'a', deliverDate: '2026-01-31' }), base({ id: 'b', deliverDate: '2025-12-31' })], '2026-02-10');
  assert.ok(/个百分点/.test(C.quarterDeltaNote(ok)));
});

test('旧版备份只迁移估算字段,不虚构基线或实际记录', () => {
  const r = C.validateState(stateOf([base({ quote: 123400 })]));
  assert.equal(r.ok, true); assert.equal(r.state.version, 2);
  assert.deepEqual(r.state.projects[0].baselineVersions, []);
  assert.deepEqual(r.state.projects[0].actualWork, []);
  assert.deepEqual(r.state.projects[0].actualExpenses, []);
  assert.deepEqual(r.state.projects[0].actualRevenue, []);
  assert.equal(r.state.projects[0].actualCompleteness.asserted, false);
});

test('锁定基线后继续编辑不改写快照;重开会保留旧版并创建草稿新版', () => {
  const p = C.validateState(stateOf([base({ quote: 100000, lines: [labor(2, 10000, 'l1')] })])).state.projects[0];
  const locked = C.lockEstimate(p, '2026-10-20');
  locked.quote = 200000; locked.lines[0].rate = 50000;
  assert.equal(locked.baselineVersions[0].estimate.quote, 100000);
  assert.equal(locked.baselineVersions[0].estimate.lines[0].rate, 10000);
  const reopened = C.reopenEstimate(locked, locked.activeBaselineId, '2026-10-21');
  assert.equal(reopened.baselineVersions.length, 2);
  assert.equal(reopened.baselineVersions[0].lockedAt, '2026-10-20');
  assert.equal(reopened.baselineVersions[1].lockedAt, '');
  assert.equal(reopened.quote, 100000);
  const relocked = C.lockEstimate(Object.assign(reopened, { quote: 150000 }), '2026-10-22');
  assert.equal(relocked.baselineVersions.length, 2);
  assert.equal(relocked.baselineVersions[1].estimate.quote, 150000);
});

test('缺少实际值保持未知;部分费用可显示已知合计但不显示偏差', () => {
  let p = C.lockEstimate(C.validateState(stateOf([base({ quote: 100000 })])).state.projects[0], '2026-10-20');
  let a = C.actualComparison(p);
  assert.equal(a.known.cost, 0); assert.equal(a.variance, null); assert.equal(a.complete, false);
  p.actualExpenses = [{ id: 'e1', date: '2026-10-21', amount: 5000, currency: 'CNY', source: '收据', note: '' }];
  a = C.actualComparison(p);
  assert.equal(a.known.cost, 5000); assert.equal(a.variance, null);
});

test('报价收入与实收分开;只有完整声明后才计算收入偏差', () => {
  let p = C.lockEstimate(C.validateState(stateOf([base({ quote: 100000 })])).state.projects[0], '2026-10-20');
  p.actualRevenue = [{ id: 'r1', date: '2026-10-21', amount: 60000, currency: 'CNY', source: '本人核对', note: '' }];
  assert.equal(C.actualComparison(p).known.collected, 60000);
  assert.equal(C.actualComparison(p).variance, null);
  p.actualCompleteness = { asserted: true, asOf: '2026-10-21', assertedAt: '2026-10-21' };
  assert.equal(C.actualComparison(p).variance.revenue, -40000);
});

test('不同币种不合并为偏差;同币种工时按整数分钟与记录时薪计算', () => {
  let p = C.lockEstimate(C.validateState(stateOf([base({ quote: 100000 })])).state.projects[0], '2026-10-20');
  p.actualWork = [{ id: 'w1', date: '2026-10-21', minutes: 90, hourlyRate: 12000, currency: 'CNY', source: '日历', note: '' }];
  p.actualExpenses = [{ id: 'e1', date: '2026-10-21', amount: 5000, currency: 'USD', source: '收据', note: '' }];
  p.actualCompleteness = { asserted: true, asOf: '2026-10-21', assertedAt: '2026-10-21' };
  const a = C.actualComparison(p);
  assert.equal(a.known.workCost, 18000); assert.equal(a.known.cost, 18000, 'CNY 主结果不混入 USD');
  assert.equal(a.knownByCurrency.find(x => x.currency === 'USD').cost, 5000);
  assert.equal(a.comparable, false); assert.equal(a.variance, null);
});

test('实际记录严格校验日期、整数单位、ID 重复和跨类型重复', () => {
  const p = C.validateState(stateOf([base()])).state.projects[0];
  const valid = { id: 'x', date: '2026-10-21', minutes: 30, hourlyRate: 10000, currency: 'CNY', source: '日历', note: '' };
  p.actualWork = [valid];
  assert.equal(C.validateState({ version: 2, settings: { opportunityHourly: 0 }, projects: [p] }).ok, true);
  p.actualWork = [valid, Object.assign({}, valid)]; assert.equal(C.validateState({ version: 2, settings: { opportunityHourly: 0 }, projects: [p] }).ok, false);
  p.actualWork = [Object.assign({}, valid, { id: 'w', minutes: 1.5 })]; assert.equal(C.validateState({ version: 2, settings: { opportunityHourly: 0 }, projects: [p] }).ok, false);
  p.actualWork = [Object.assign({}, valid, { id: 'w', date: '2026-02-30' })]; assert.equal(C.validateState({ version: 2, settings: { opportunityHourly: 0 }, projects: [p] }).ok, false);
  p.actualWork = [valid]; p.actualRevenue = [{ id: 'x', date: '2026-10-21', amount: 1, currency: 'CNY', source: '核对', note: '' }];
  assert.equal(C.validateState({ version: 2, settings: { opportunityHourly: 0 }, projects: [p] }).ok, false);
});

test('JSON 往返及 CSV/Markdown 包含基线、实际、完整性和单位来源', () => {
  let p = C.lockEstimate(C.validateState(stateOf([base()])).state.projects[0], '2026-10-20');
  p.actualWork = [{ id: 'w1', date: '2026-10-21', minutes: 60, hourlyRate: 10000, currency: 'CNY', source: '=日历', note: '<x>' }];
  p.actualCompleteness = { asserted: false, asOf: '2026-10-21', assertedAt: '' };
  const st = C.validateState({ version: 2, settings: { opportunityHourly: 15000 }, projects: [p] });
  assert.equal(st.ok, true); assert.deepEqual(C.validateImport(JSON.stringify(st.state)).state, st.state);
  const csv = C.toCsv(st.state.projects, '2026-10-21');
  assert.ok(csv.includes('活动基线版本') && csv.includes('单位来源') && csv.includes('未声明完整'));
  const md = C.toMarkdown(st.state.projects[0], '2026-10-21');
  assert.ok(md.includes('估算基线与实际') && md.includes('缺失项是未知,不是 0') && md.includes('整数分钟'));
});

test('实际合计和偏差只统计截至日内记录,截至日后记录保留但排除', () => {
  let p = C.lockEstimate(C.validateState(stateOf([base({ quote: 10000 })])).state.projects[0], '2026-10-01');
  p.actualRevenue = [
    { id: 'r-before', date: '2026-10-20', amount: 5000, currency: 'CNY', source: '收款记录 A', note: '截至日内' },
    { id: 'r-after', date: '2026-11-01', amount: 9000, currency: 'CNY', source: '收款记录 B', note: '截至日后' }
  ];
  p.actualCompleteness = { asserted: true, asOf: '2026-10-20', assertedAt: '2026-10-21' };
  const a = C.actualComparison(p);
  assert.equal(a.known.collected, 5000);
  assert.equal(a.variance.revenue, -5000);
  assert.equal(a.excludedAfterAsOf, 1);
  const csv = C.toCsv([p], '2026-10-21');
  assert.ok(csv.includes('r-after,CNY,,,90.00,收款记录 B,截至日后,否'));
  const md = C.toMarkdown(p, '2026-10-21');
  assert.ok(md.includes('截至日之后的记录:1 条') && md.includes('| 收款 | 2026-11-01 | CNY') && md.includes('| 否 |'));
});

test('完整性声明必须有真实截至日与声明日,且时间顺序有效并不得来自未来', () => {
  const p = C.validateState(stateOf([base()])).state.projects[0];
  const check = ac => C.validateState({ version: 2, settings: { opportunityHourly: 0 }, projects: [Object.assign({}, p, { actualCompleteness: ac })] }).ok;
  assert.equal(check({ asserted: true, asOf: '', assertedAt: '' }), false);
  assert.equal(check({ asserted: true, asOf: '2026-02-30', assertedAt: '2026-10-21' }), false);
  assert.equal(check({ asserted: true, asOf: '2026-10-22', assertedAt: '2026-10-21' }), false);
  assert.equal(check({ asserted: true, asOf: '9999-01-01', assertedAt: '9999-01-02' }), false);
  assert.equal(check({ asserted: true, asOf: '2026-10-20', assertedAt: '2026-10-21' }), true);
});

test('导入拒绝重复基线版本号和早于创建日的锁定日期', () => {
  let p = C.lockEstimate(C.validateState(stateOf([base()])).state.projects[0], '2026-10-20');
  const duplicate = JSON.parse(JSON.stringify(p.baselineVersions[0])); duplicate.id = 'other-id';
  p.baselineVersions.push(duplicate);
  assert.equal(C.validateState({ version: 2, settings: { opportunityHourly: 0 }, projects: [p] }).ok, false);
  p.baselineVersions = [Object.assign({}, p.baselineVersions[0], { createdAt: '2026-10-21', lockedAt: '2026-10-20' })];
  assert.equal(C.validateState({ version: 2, settings: { opportunityHourly: 0 }, projects: [p] }).ok, false);
});

test('CSV 和 Markdown 保留全部币种的实际日期、来源、备注与原值', () => {
  let p = C.lockEstimate(C.validateState(stateOf([base()])).state.projects[0], '2026-10-20');
  p.actualExpenses = [{ id: 'usd-1', date: '2026-10-20', amount: 1234, currency: 'USD', source: '=外币收据', note: '差旅|原值' }];
  const csv = C.toCsv([p], '2026-10-21');
  assert.ok(csv.includes('按币种=USD:成本12.34/实收0.00/分钟0'));
  assert.ok(csv.includes("实际费用,2026-10-20,usd-1,USD,,,12.34,'=外币收据,差旅|原值,是"));
  const md = C.toMarkdown(p, '2026-10-21');
  assert.ok(md.includes('| 费用 | 2026-10-20 | USD') && md.includes("'=外币收据") && md.includes('差旅\\|原值'));
});

test('CSV 实际记录 ID 防公式注入,普通 ID 保持原值', () => {
  const p = C.validateState(stateOf([base()])).state.projects[0];
  const ids = ['=cmd', '+1', '-1', '@x', 'normal-id'];
  p.actualRevenue = ids.map((id, i) => ({ id, date: `2026-10-${String(20 + i).padStart(2, '0')}`, amount: i + 1, currency: 'CNY', source: '核对', note: '' }));
  const csv = C.toCsv([p], '2026-10-29');
  for (const id of ids.slice(0, 4)) assert.ok(csv.includes(`,'${id},CNY`), `${id} 应加单引号`);
  assert.ok(csv.includes(',normal-id,CNY'), '普通 ID 不改写');
});
