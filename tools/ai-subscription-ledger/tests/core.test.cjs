'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

function sub(o) {
  return Object.assign({
    id: 's1', name: '示例', tier: '', currency: 'USD', amountCents: 2000, period: 'monthly',
    startDate: '2026-01-15', renewDate: '', status: 'active', tag: '编码', who: 'self', headcount: 1,
    amortMonths: 12, usageBills: {}
  }, o);
}
function out(month, tag, hours, id) { return { id: id || month + tag, month, tag, hours, evidence: '' }; }

test('年付折算到月', () => {
  assert.equal(C.monthlyCost(sub({ period: 'yearly', amountCents: 120000 }), '2026-06'), 10000);
  assert.equal(C.monthlyCost(sub({ period: 'yearly', amountCents: 10000 }), '2026-06'), 833);
});
test('开始日之前的月份不计', () => {
  assert.equal(C.monthlyCost(sub({ startDate: '2026-03-31' }), '2026-02'), 0);
  assert.equal(C.monthlyCost(sub({ startDate: '2026-03-31' }), '2026-03'), 2000);
});
test('一次性按摊销月数摊,期满后为 0', () => {
  const s = sub({ period: 'once', amountCents: 60000, amortMonths: 6, startDate: '2026-03-10' });
  assert.equal(C.monthlyCost(s, '2026-03'), 10000);
  assert.equal(C.monthlyCost(s, '2026-08'), 10000);
  assert.equal(C.monthlyCost(s, '2026-09'), 0);
  assert.equal(C.monthlyCost(s, '2026-02'), 0);
});
test('按量取当月实际账单,未填为 0 且被标记缺失', () => {
  const s = sub({ period: 'usage', amountCents: 0, usageBills: { '2026-05': 1234 } });
  assert.equal(C.monthlyCost(s, '2026-05'), 1234);
  assert.equal(C.monthlyCost(s, '2026-06'), 0);
  assert.deepEqual(C.totals([s], '2026-06').missingUsage, ['示例']);
  assert.deepEqual(C.totals([s], '2026-05').missingUsage, []);
});
test('暂停与已退不计成本', () => {
  assert.equal(C.monthlyCost(sub({ status: 'paused' }), '2026-06'), 0);
  assert.equal(C.monthlyCost(sub({ status: 'cancelled' }), '2026-06'), 0);
  assert.deepEqual(C.totals([sub({ status: 'paused' })], '2026-06').byCurrency, []);
});
test('多币种分列,不换汇', () => {
  const t = C.totals([sub({ id: 'a' }), sub({ id: 'b', currency: 'CNY', amountCents: 5000 }), sub({ id: 'c', amountCents: 1000 })], '2026-06');
  assert.deepEqual(t.byCurrency, [{ currency: 'CNY', cents: 5000 }, { currency: 'USD', cents: 3000 }]);
  assert.equal(t.estimate, null);
});
test('估算汇率:标 estimated,只折算 from/to,其他币种列为未折算', () => {
  const subs = [sub({ id: 'a', amountCents: 1000 }), sub({ id: 'b', currency: 'CNY', amountCents: 5000 }), sub({ id: 'c', currency: 'EUR', amountCents: 900 })];
  const t = C.totals(subs, '2026-06', { from: 'USD', to: 'CNY', rate: 7.2 });
  assert.equal(t.estimate.estimated, true);
  assert.equal(t.estimate.currency, 'CNY');
  assert.equal(t.estimate.cents, 5000 + 7200);
  assert.deepEqual(t.estimate.excluded, ['EUR']);
  assert.equal(C.totals(subs, '2026-06', { from: 'USD', to: 'CNY', rate: 0 }).estimate, null);
  assert.equal(C.totals(subs, '2026-06', { from: 'USD', to: 'USD', rate: 2 }).estimate, null);
});
test('costPerHour:除零、负数、未填产出都返回 null', () => {
  assert.equal(C.costPerHour(30000, 10), 3000);
  assert.equal(C.costPerHour(30000, 0), null);
  assert.equal(C.costPerHour(30000, null), null);
  assert.equal(C.costPerHour(30000, undefined), null);
  assert.equal(C.costPerHour(30000, -1), null);
  assert.equal(C.costPerHour(100, 3), 33);
});
test('未填产出的月份 hours 为 null,不出比值;填了 0 则 hours 为 0 但无比值', () => {
  const subs = [sub()];
  const none = C.summarizeMonth(subs, [], '2026-06', null, null);
  assert.equal(none.hours, null);
  assert.equal(none.perHour[0].cents, null);
  const zero = C.summarizeMonth(subs, [out('2026-06', '编码', 0)], '2026-06', null, null);
  assert.equal(zero.hours, 0);
  assert.equal(zero.perHour[0].cents, null);
  const ok = C.summarizeMonth(subs, [out('2026-06', '编码', 4)], '2026-06', null, { cents: 1000, currency: 'USD' });
  assert.equal(ok.perHour[0].cents, 500);
  assert.equal(ok.perHour[0].wage.level, 'below');
});
test('与时薪比较:低于/高于/等于,币种不同则不比较', () => {
  const w = { cents: 1000, currency: 'USD' };
  assert.equal(C.compareToWage(999, 'USD', w).level, 'below');
  assert.equal(C.compareToWage(1001, 'USD', w).level, 'above');
  assert.equal(C.compareToWage(1000, 'USD', w).level, 'equal');
  assert.equal(C.compareToWage(500, 'CNY', w), null);
  assert.equal(C.compareToWage(500, 'USD', null), null);
});
test('续费提醒边界:当天、7 天提醒,8 天不提醒,已过期单独提示', () => {
  const today = '2026-10-20';
  const r = (d) => C.alerts([sub({ renewDate: d })], [], today).filter((a) => a.type === 'renew' || a.type === 'renew-overdue');
  assert.equal(r('2026-10-20').length, 1);
  assert.equal(r('2026-10-20')[0].days, 0);
  assert.equal(r('2026-10-27').length, 1);
  assert.equal(r('2026-10-27')[0].days, 7);
  assert.equal(r('2026-10-28').length, 0);
  assert.equal(r('2026-10-19')[0].type, 'renew-overdue');
  assert.equal(C.alerts([sub({ renewDate: '2026-10-21', status: 'paused' })], [], today).length, 0);
});
test('续费天数跨月/跨年/闰日按 UTC 日历计算', () => {
  assert.equal(C.daysBetween('2026-12-30', '2027-01-02'), 3);
  assert.equal(C.daysBetween('2028-02-28', '2028-03-01'), 2);
  assert.equal(C.addDays('2026-12-31', 1), '2027-01-01');
});
test('连续 2 个月产出为 0 的在用订阅提示考虑暂停;只有一个月为 0 或未填不提示', () => {
  const s = [sub({ id: 'img', tag: '图像', startDate: '2026-01-01' })];
  const both = C.alerts(s, [out('2026-09', '图像', 0), out('2026-10', '图像', 0)], '2026-10-20');
  assert.equal(both.filter((a) => a.type === 'pause').length, 1);
  assert.equal(C.alerts(s, [out('2026-09', '图像', 3), out('2026-10', '图像', 0)], '2026-10-20').filter((a) => a.type === 'pause').length, 0);
  assert.equal(C.alerts(s, [out('2026-10', '图像', 0)], '2026-10-20').filter((a) => a.type === 'pause').length, 0);
  assert.equal(C.alerts([sub({ id: 'img', tag: '图像', status: 'paused' })], [out('2026-09', '图像', 0), out('2026-10', '图像', 0)], '2026-10-20').length, 0);
  assert.equal(C.alerts([sub({ id: 'new', tag: '图像', startDate: '2026-10-01' })], [out('2026-09', '图像', 0), out('2026-10', '图像', 0)], '2026-10-20').filter((a) => a.type === 'pause').length, 0);
});
test('同一用途 ≥3 个在用订阅提示重叠,2 个或含暂停则不提示', () => {
  const three = [sub({ id: 'a' }), sub({ id: 'b' }), sub({ id: 'c' })];
  const al = C.alerts(three, [], '2026-10-20').filter((a) => a.type === 'overlap');
  assert.equal(al.length, 1);
  assert.deepEqual(al[0].subIds, ['a', 'b', 'c']);
  assert.equal(C.alerts([sub({ id: 'a' }), sub({ id: 'b' }), sub({ id: 'c', status: 'paused' })], [], '2026-10-20').filter((a) => a.type === 'overlap').length, 0);
});
test('trend 月序升序且长度正确,跨年正确', () => {
  assert.deepEqual(C.lastMonths('2026-02-10', 4), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.equal(C.lastMonths('2026-10-20', 12).length, 12);
  const t = C.trend([sub({ startDate: '2026-02-01' })], [out('2026-03', '编码', 5)], ['2026-01', '2026-02', '2026-03']);
  assert.deepEqual(t.map((x) => x.month), ['2026-01', '2026-02', '2026-03']);
  assert.deepEqual(t.map((x) => x.byCurrency.length), [0, 1, 1]);
  assert.deepEqual(t.map((x) => x.hours), [null, null, 5]);
});
test('compare:本月 vs 上月差额与百分比,上月为 0 时百分比为 null', () => {
  const r = C.compare({ byCurrency: [{ currency: 'USD', cents: 15000 }, { currency: 'CNY', cents: 100 }], hours: 12 }, { byCurrency: [{ currency: 'USD', cents: 10000 }], hours: 10 });
  assert.deepEqual(r.currencies.find((c) => c.currency === 'USD'), { currency: 'USD', now: 15000, prev: 10000, diff: 5000, pct: 50 });
  assert.equal(r.currencies.find((c) => c.currency === 'CNY').pct, null);
  assert.equal(r.hours.diff, 2);
  assert.equal(C.compare({ byCurrency: [], hours: null }, { byCurrency: [], hours: null }).hours, null);
});
test('?today 解析:合法生效,非法与自动进位回退', () => {
  assert.equal(C.resolveToday('?today=2026-10-20', 'X'), '2026-10-20');
  assert.equal(C.resolveToday('?today=2026-02-30', 'X'), 'X');
  assert.equal(C.resolveToday('?today=2026-13-01', 'X'), 'X');
  assert.equal(C.resolveToday('?today=abc', 'X'), 'X');
  assert.equal(C.resolveToday('', 'X'), 'X');
  assert.equal(C.resolveToday('?today=2028-02-29', 'X'), '2028-02-29');
  assert.equal(C.resolveToday('?today=2027-02-29', 'X'), 'X');
});
test('CSV 公式防护:= + - @ 开头加单引号,单独 - 或 + 不算;引号与逗号转义', () => {
  const csv = C.toCsv([sub({ name: '=SUM(A1)' }), sub({ id: 'b', name: '-', tier: '+' }), sub({ id: 'c', name: '@x', tier: '-5 折' }), sub({ id: 'd', name: 'a,"b"' })]);
  const lines = csv.split('\n');
  assert.ok(lines[1].startsWith("'=SUM(A1),"));
  assert.ok(lines[2].startsWith('-,+,'));
  assert.ok(lines[3].startsWith("'@x,'-5 折,"));
  assert.ok(lines[4].startsWith('"a,""b""",'));
  assert.ok(lines[0].startsWith('服务名,档位,币种,金额,周期'));
});
test('CSV 含当月成本列', () => {
  const csv = C.toCsv([sub({ period: 'yearly', amountCents: 120000 })], '2026-06');
  assert.ok(csv.split('\n')[0].endsWith('2026-06 月成本'));
  assert.ok(csv.split('\n')[1].endsWith(',100.00'));
});
test('Markdown 月报:表格单元转义管道符与公式,含估算标注与口径', () => {
  const subs = [sub({ name: '=cmd|x', tier: 'a|b', currency: 'USD' }), sub({ id: 'c', currency: 'CNY', amountCents: 5000, tag: '写作' })];
  const md = C.toMarkdown(subs, [out('2026-06', '编码', 5), out('2026-05', '编码', 2)], '2026-06', { fx: { from: 'USD', to: 'CNY', rate: 7 }, wage: { cents: 20000, currency: 'CNY' }, today: '2026-06-10' });
  assert.ok(md.includes("'=cmd\\|x"));
  assert.ok(md.includes('a\\|b'));
  assert.ok(md.includes('估算'));
  assert.ok(md.includes('口径'));
  assert.ok(md.includes('# AI 订阅成本月报 2026-06'));
});
test('Markdown 月报:未填产出时不出现每小时当量成本比值', () => {
  const md = C.toMarkdown([sub()], [], '2026-06', {});
  assert.ok(md.includes('本月未填产出'));
  assert.ok(!md.includes('/小时'));
});
test('validateImport:周期、状态、用途、币种枚举不合法即整份拒绝', () => {
  const base = () => ({ version: 1, subs: [sub()], outputs: [] });
  assert.equal(C.validateImport(JSON.stringify(base())).ok, true);
  for (const [k, v] of [['period', 'weekly'], ['status', 'gone'], ['tag', '游戏'], ['currency', 'usd'], ['who', 'all']]) {
    const b = base(); b.subs[0][k] = v;
    const r = C.validateImport(b);
    assert.equal(r.ok, false, k);
    assert.ok(r.error.includes('订阅 #1'), k);
  }
});
test('validateImport:类型、金额、日期、ID、重复记录都拒绝而不是修正', () => {
  const bad = (mut) => { const b = { version: 1, subs: [sub()], outputs: [out('2026-06', '编码', 1)] }; mut(b); return C.validateImport(b); };
  assert.equal(bad((b) => { b.subs[0].amountCents = 12.5; }).ok, false);
  assert.equal(bad((b) => { b.subs[0].amountCents = -1; }).ok, false);
  assert.equal(bad((b) => { b.subs[0].amountCents = '2000'; }).ok, false);
  assert.equal(bad((b) => { b.subs[0].amountCents = C.MAX_CENTS + 1; }).ok, false);
  assert.equal(bad((b) => { b.subs[0].startDate = '2026-02-30'; }).ok, false);
  assert.equal(bad((b) => { b.subs[0].renewDate = 'soon'; }).ok, false);
  assert.equal(bad((b) => { b.subs.push(sub()); }).ok, false);
  assert.equal(bad((b) => { b.subs[0].name = '   '; }).ok, false);
  assert.equal(bad((b) => { b.subs[0].name = 'x'.repeat(C.MAX_TEXT + 1); }).ok, false);
  assert.equal(bad((b) => { b.subs[0].usageBills = { '2026-13': 1 }; }).ok, false);
  assert.equal(bad((b) => { b.subs[0].usageBills = { '2026-05': 1.5 }; }).ok, false);
  assert.equal(bad((b) => { b.outputs[0].hours = -1; }).ok, false);
  assert.equal(bad((b) => { b.outputs[0].hours = '3'; }).ok, false);
  assert.equal(bad((b) => { b.outputs.push(out('2026-06', '编码', 2, 'other')); }).ok, false);
  assert.equal(bad((b) => { b.outputs.push(out('2026-06', '写作', 2, b.outputs[0].id)); }).ok, false);
  assert.equal(bad((b) => { b.settings = { fx: { from: 'USD', to: 'CNY', rate: -1 } }; }).ok, false);
  assert.equal(bad((b) => { b.version = 3; }).ok, false);
  assert.equal(C.validateImport('{oops').ok, false);
  assert.equal(C.validateImport('[]').ok, false);
});

test('v1 备份无损迁移为 v2，并补空快照数组', () => {
  const legacy = { version: 1, subs: [sub()], outputs: [out('2026-06', '编码', 2)], settings: { fx: null, wage: null } };
  const r = C.validateImport(legacy);
  assert.equal(r.ok, true);
  assert.equal(r.data.version, 2);
  assert.deepEqual(r.data.snapshots, []);
  assert.equal(r.data.subs[0].name, legacy.subs[0].name);
  assert.equal(r.data.outputs[0].hours, 2);
});

test('已确认快照冻结订阅身份、用途与金额，暂停、改价或删除订阅不改历史', () => {
  const original = sub({ id: 'freeze-me', name: '编码助手', amountCents: 2000, tag: '编码' });
  const made = C.createSnapshot([original], '2026-06', '2026-07-03', '已核对按月摊销', '六月结账', 'snap-june', '2026-10-29');
  assert.equal(made.ok, true);
  assert.deepEqual(made.snapshot.items[0], { subId: 'freeze-me', name: '编码助手', currency: 'USD', tag: '编码', cents: 2000 });
  const changed = { ...original, status: 'paused', name: '已改名', amountCents: 999900 };
  assert.equal(C.totals([changed], '2026-06').byCurrency.length, 0);
  assert.deepEqual(C.snapshotTotals(made.snapshot).byCurrency, [{ currency: 'USD', cents: 2000 }]);
  assert.deepEqual(C.snapshotTotals(made.snapshot).byCurrency, C.snapshotTotals(C.validateState({ version: 2, subs: [], outputs: [], snapshots: [made.snapshot] }).data.snapshots[0]).byCurrency);
});

test('同月快照显式更新，保留唯一记录并使用原 id', () => {
  const first = C.createSnapshot([sub()], '2026-06', '2026-07-01', '账单 A', '', 'snap-a', '2026-10-29').snapshot;
  const second = C.createSnapshot([sub({ amountCents: 3000 })], '2026-06', '2026-07-02', '账单 B', '更正', 'snap-other', '2026-10-29').snapshot;
  const r1 = C.upsertSnapshot([], first);
  const r2 = C.upsertSnapshot(r1.snapshots, second);
  assert.equal(r2.ok, true);
  assert.equal(r2.updated, true);
  assert.equal(r2.snapshots.length, 1);
  assert.equal(r2.snapshots[0].id, 'snap-a');
  assert.equal(r2.snapshots[0].items[0].cents, 3000);
  assert.equal(r2.snapshots[0].source, '账单 B');
});

test('快照导入严格拒绝重复 id、重复月份、坏日期、币种、金额和明细身份', () => {
  const snap = C.createSnapshot([sub()], '2026-06', '2026-07-01', '账单', '', 'snap-a', '2026-10-29').snapshot;
  const base = () => ({ version: 2, subs: [], outputs: [], snapshots: [JSON.parse(JSON.stringify(snap))] });
  const bad = (mut) => { const x = base(); mut(x); return C.validateImport(x); };
  assert.equal(bad((x) => { x.snapshots.push({ ...x.snapshots[0], month: '2026-07' }); }).ok, false);
  assert.equal(bad((x) => { x.snapshots.push({ ...x.snapshots[0], id: 'snap-b' }); }).ok, false);
  assert.equal(bad((x) => { x.snapshots[0].recordedDate = '2026-02-30'; }).ok, false);
  assert.equal(bad((x) => { x.snapshots[0].items[0].currency = 'usd'; }).ok, false);
  assert.equal(bad((x) => { x.snapshots[0].items[0].cents = 1.5; }).ok, false);
  assert.equal(bad((x) => { x.snapshots[0].items.push({ ...x.snapshots[0].items[0] }); }).ok, false);
});

test('趋势和月报优先使用已确认快照，并清楚标明来源', () => {
  const active = sub({ amountCents: 2000 });
  const snap = C.createSnapshot([active], '2026-06', '2026-07-01', '服务商收据', '已结账', 'snap-a', '2026-10-29').snapshot;
  const paused = { ...active, status: 'paused' };
  const point = C.trend([paused], [], ['2026-06'], null, [snap])[0];
  assert.equal(point.sourceMode, 'snapshot');
  assert.equal(point.byCurrency[0].cents, 2000);
  const md = C.toMarkdown([paused], [], '2026-06', { snapshots: [snap] });
  assert.match(md, /用户确认的月度成本快照/);
  assert.match(md, /服务商收据/);
  assert.match(md, /USD 20\.00/);
});
test('快照拒绝未来月份和未来确认日期，导入使用同一基准日', () => {
  const create = (month, date) => C.createSnapshot([sub()], month, date, '核对摊销', '', 's', '2026-10-29');
  assert.equal(create('2099-06', '2026-10-29').ok, false);
  assert.equal(create('2026-10', '2099-01-01').ok, false);
  const snap = create('2026-10', '2026-10-29').snapshot;
  const state = { version: 2, subs: [], outputs: [], snapshots: [{ ...snap, recordedDate: '2099-01-01' }] };
  assert.equal(C.validateImport(state, '2026-10-29').ok, false);
});
test('缺失按量账单不能冻结为零；显式零账单保留明细', () => {
  const usage = sub({ id: 'usage', period: 'usage', usageBills: {} });
  const args = ['2026-10', '2026-10-29', '已核对', '', 's', '2026-10-29'];
  assert.equal(C.createSnapshot([sub(), usage], ...args).ok, false);
  const result = C.createSnapshot([sub(), { ...usage, usageBills: { '2026-10': 0 } }], ...args);
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.items.find(x => x.subId === 'usage').cents, 0);
});
test('旧快照保留完整性未知提示，月报不把摊销叫实付账单', () => {
  const snap = C.createSnapshot([sub({ period: 'yearly', amountCents: 120000 })], '2026-10', '2026-10-29', '核对', '', 's', '2026-10-29').snapshot;
  delete snap.warnings;
  const migrated = C.validateImport({ version: 2, subs: [], outputs: [], snapshots: [snap] }, '2026-10-29');
  assert.equal(migrated.ok, true);
  assert.equal(migrated.data.snapshots[0].warnings.length, 1);
  const md = C.toMarkdown([], [], '2026-10', { snapshots: migrated.data.snapshots });
  assert.match(md, /按月摊销/);
  assert.match(md, /不是实付账单/);
  assert.match(md, /完整性提示/);
});
test('写入校验 = 读取校验:合法状态 JSON 往返后仍通过且内容一致', () => {
  const state = { version: 1, subs: [sub({ name: 'x'.repeat(C.MAX_TEXT), amountCents: C.MAX_CENTS, usageBills: { '2026-05': C.MAX_CENTS } })], outputs: [{ id: 'o', month: '2026-05', tag: '编码', hours: C.MAX_HOURS, evidence: 'e'.repeat(C.MAX_EVIDENCE) }], settings: { fx: { from: 'USD', to: 'CNY', rate: 7.25 }, wage: { cents: 0, currency: 'CNY' } } };
  const first = C.validateState(state);
  assert.equal(first.ok, true);
  const again = C.validateImport(JSON.stringify(first.data));
  assert.equal(again.ok, true);
  assert.deepEqual(again.data, first.data);
});
test('按名分组不受 __proto__ / constructor 影响', () => {
  const subs = [sub({ id: 'a', name: '__proto__', tag: '编码' }), sub({ id: 'b', name: 'constructor' }), sub({ id: 'c', name: 'toString' })];
  const al = C.alerts(subs, [], '2026-10-20');
  assert.equal(al.filter((a) => a.type === 'overlap').length, 1);
  assert.equal(C.totals(subs, '2026-06').byCurrency[0].cents, 6000);
  const r = C.validateImport(JSON.parse('{"version":1,"subs":[],"outputs":[],"settings":{"__proto__":{"x":1}}}'));
  assert.equal(r.ok, true);
  assert.equal({}.x, undefined);
});
test('金额解析与格式化', () => {
  assert.equal(C.parseMoney('20'), 2000);
  assert.equal(C.parseMoney('19.9'), 1990);
  assert.equal(C.parseMoney('0.05'), 5);
  assert.equal(C.parseMoney('1.234'), null);
  assert.equal(C.parseMoney('-3'), null);
  assert.equal(C.parseMoney(''), null);
  assert.equal(C.parseMoney('9999999999.99'), 999999999999);
  assert.equal(C.parseMoney('10000000000.01'), null);
  assert.equal(C.formatMoney(123456789, true), '1,234,567.89');
  assert.equal(C.formatMoney(5), '0.05');
  assert.equal(C.parseHours('12.5'), 12.5);
  assert.equal(C.parseHours('abc'), null);
  assert.equal(C.parseHours('100001'), null);
});
test('多币种时总览不分币种相除,折算估算单独给出并与时薪比较', () => {
  const subs = [sub({ id: 'a', amountCents: 10000 }), sub({ id: 'b', currency: 'CNY', amountCents: 20000 })];
  const fx = { from: 'USD', to: 'CNY', rate: 7 };
  const s = C.summarizeMonth(subs, [out('2026-06', '编码', 10)], '2026-06', fx, { cents: 5000, currency: 'CNY' });
  assert.deepEqual(s.perHour, []);
  assert.equal(s.perHourEstimate.estimated, true);
  assert.equal(s.perHourEstimate.cents, 9000);
  assert.equal(s.perHourEstimate.wage.level, 'above');
  const single = C.summarizeMonth([subs[0]], [out('2026-06', '编码', 10)], '2026-06', null, null);
  assert.equal(single.perHour[0].cents, 1000);
});

test('[P0] 汇率未覆盖的币种:只有 EUR 成本时不输出总体每小时成本与时薪结论,并列出缺失币种', () => {
  const subs = [sub({ id: 'e', currency: 'EUR', amountCents: 5000 })];
  const s = C.summarizeMonth(subs, [out('2026-06', '编码', 5)], '2026-06', { from: 'USD', to: 'CNY', rate: 7 }, { cents: 20000, currency: 'CNY' });
  assert.equal(s.perHourEstimate, null);
  assert.deepEqual(s.missingFx, ['EUR']);
  assert.equal(s.perTag[0].perHourEstimate, null);
  assert.deepEqual(s.perTag[0].missingFx, ['EUR']);
  const md = C.toMarkdown(subs, [out('2026-06', '编码', 5)], '2026-06', { fx: { from: 'USD', to: 'CNY', rate: 7 }, wage: { cents: 20000, currency: 'CNY' } });
  assert.ok(md.includes('EUR') && md.includes('没有折算汇率'));
  assert.ok(!md.includes('低于时薪') && !md.includes('CNY 0.00/小时'));
});
test('[P0] 混合币种且部分未折算时同样不给估算比值', () => {
  const subs = [sub({ id: 'a' }), sub({ id: 'e', currency: 'EUR', amountCents: 5000 })];
  const s = C.summarizeMonth(subs, [out('2026-06', '编码', 5)], '2026-06', { from: 'USD', to: 'CNY', rate: 7 }, { cents: 20000, currency: 'CNY' });
  assert.equal(s.perHourEstimate, null);
  assert.deepEqual(s.missingFx, ['EUR']);
  const ok = C.summarizeMonth([subs[0]], [out('2026-06', '编码', 5)], '2026-06', { from: 'USD', to: 'CNY', rate: 7 }, { cents: 20000, currency: 'CNY' });
  assert.deepEqual(ok.missingFx, []);
  assert.equal(ok.perHourEstimate.cents, 2800);
});
test('[P0] 编辑产出按原记录 ID 更新:改月份/用途不留下原记录', () => {
  const list = [out('2026-05', '编码', 3, 'a'), out('2026-06', '写作', 4, 'b')];
  const r = C.upsertOutput(list, { id: 'new', month: '2026-07', tag: '编码', hours: 9, evidence: '' }, 'a');
  assert.equal(r.ok, true);
  assert.equal(r.outputs.length, 2);
  assert.deepEqual(r.outputs.map((o) => o.id), ['a', 'b']);
  assert.equal(r.outputs[0].month, '2026-07');
  assert.equal(C.validateState({ version: 1, subs: [], outputs: r.outputs }).ok, true);
});
test('[P0] 编辑产出时目标月份+用途已有另一条记录:返回冲突,不覆盖不丢失', () => {
  const list = [out('2026-05', '编码', 3, 'a'), out('2026-06', '写作', 4, 'b')];
  const r = C.upsertOutput(list, { id: 'x', month: '2026-06', tag: '写作', hours: 9, evidence: '' }, 'a');
  assert.equal(r.ok, false);
  assert.equal(r.conflict, true);
  assert.equal(list[1].hours, 4);
  const plain = C.upsertOutput(list, { id: 'n', month: '2026-06', tag: '写作', hours: 8, evidence: '' }, null);
  assert.equal(plain.outputs.length, 2);
  assert.equal(plain.outputs[1].id, 'b');
});
