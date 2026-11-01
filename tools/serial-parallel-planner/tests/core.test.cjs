'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../core.js');
const { tasks: SAMPLE } = (() => { require('../sample-data.js'); return globalThis.TONGBING_SAMPLE; })();
const T = (id, name, dur, type, deps, earliest) => ({ id, name, dur, type, deps: deps || [], earliest: earliest || 0 });
const clone = o => JSON.parse(JSON.stringify(o));

test('topoSort 按前置给出正确顺序且稳定', () => {
  const r = C.topoSort([T('b', 'B', 1, 'present', ['a']), T('a', 'A', 1, 'present'), T('c', 'C', 1, 'present', ['b'])]);
  assert.deepStrictEqual(r.order, ['a', 'b', 'c']);
  assert.deepStrictEqual(C.topoSort(SAMPLE).order, SAMPLE.map(t => t.id));
});
test('环检测给出环成员,且不含环下游任务', () => {
  const r = C.topoSort([T('a', 'A', 1, 'present', ['c']), T('b', 'B', 1, 'present', ['a']), T('c', 'C', 1, 'present', ['b']), T('d', 'D', 1, 'present', ['c'])]);
  assert.deepStrictEqual(r.members.sort(), ['a', 'b', 'c']);
  assert.strictEqual(r.cycle.length, 3);
  assert.ok(!r.cycle.includes('d'));
  assert.deepStrictEqual(C.topoSort([T('a', 'A', 1, 'present', ['a'])]).cycle, ['a']);
});
test('前置不存在被拒绝', () => {
  const r = C.topoSort([T('a', 'A', 1, 'present', ['zz'])]);
  assert.deepStrictEqual(r.missing, [{ id: 'a', dep: 'zz' }]);
  assert.strictEqual(C.schedule([T('a', 'A', 1, 'present', ['zz'])]).error, 'missing');
  assert.strictEqual(C.schedule([T('a', 'A', 1, 'present', ['a'])]).error, 'cycle');
});
test('示例:并联缩短总时长,saved > 0,串联总和 107', () => {
  const s = C.schedule(SAMPLE);
  assert.strictEqual(s.serialTotal, 107);
  assert.ok(s.total < 107);
  assert.strictEqual(s.saved, 107 - s.total);
  assert.ok(s.saved > 0);
  assert.strictEqual(s.savedPct, Math.round((s.saved / 107) * 100));
});
test('放着跑任务不占在场 lane;在场任务互不重叠;前置先完成', () => {
  const s = C.schedule(SAMPLE);
  const pres = s.slots.filter(x => x.lane === 'present').sort((a, b) => a.start - b.start);
  for (let i = 1; i < pres.length; i++) assert.ok(pres[i].start >= pres[i - 1].end);
  s.slots.filter(x => x.lane === 'auto').forEach(a => assert.strictEqual(a.type, 'auto'));
  const by = id => s.slots.find(x => x.id === id);
  assert.ok(by('t2').start >= by('t1').end);
  assert.ok(by('t5').start >= by('t4').end);
  assert.ok(by('t7').start >= by('t6').end);
  // 烧水(放着跑)与回邮件(在场)同时进行
  assert.ok(by('t1').start < by('t3').end && by('t3').start < by('t1').end);
});
test('在场空闲时先做已就绪的任务,不为等前置而空转', () => {
  const s = C.schedule([T('a', 'A', 10, 'auto'), T('b', 'B', 2, 'present', ['a']), T('c', 'C', 5, 'present')]);
  assert.strictEqual(s.slots.find(x => x.id === 'c').start, 0);
  assert.strictEqual(s.slots.find(x => x.id === 'b').start, 10);
  assert.strictEqual(s.total, 12);
});
test('最早开始时间约束', () => {
  const s = C.schedule([T('a', 'A', 5, 'present', [], 30), T('b', 'B', 5, 'auto', ['a'])]);
  assert.strictEqual(s.slots.find(x => x.id === 'a').start, 30);
  assert.strictEqual(s.slots.find(x => x.id === 'b').start, 35);
  assert.strictEqual(s.total, 40);
});
test('放着跑任务重叠时分到不同 row', () => {
  const s = C.schedule([T('a', 'A', 10, 'auto'), T('b', 'B', 10, 'auto'), T('c', 'C', 5, 'auto', ['a'])]);
  const rows = s.slots.map(x => x.row);
  assert.strictEqual(new Set(s.slots.filter(x => x.start === 0).map(x => x.row)).size, 2);
  assert.ok(rows.every(r => Number.isInteger(r) && r >= 0));
});
test('validateOrder 违反前置返回原因与任务', () => {
  const ok = C.validateOrder(SAMPLE, SAMPLE.map(t => t.id));
  assert.strictEqual(ok.ok, true);
  const bad = C.validateOrder(SAMPLE, ['t2', 't1', 't3', 't4', 't5', 't6', 't7', 't8']);
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.id, 't2');
  assert.match(bad.reason, /泡茶.*必须排在前置任务.*烧水.*之后/);
  assert.strictEqual(C.validateOrder(SAMPLE, ['t1']).ok, false);
});
test('moveTask 合法移动生效,违反前置被拒绝且不改原数组', () => {
  const before = clone(SAMPLE);
  const r = C.moveTask(SAMPLE, 't3', -1);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.tasks.slice(0, 3).map(t => t.id), ['t1', 't3', 't2']);
  const bad = C.moveTask(SAMPLE, 't2', -1);
  assert.strictEqual(bad.ok, false);
  assert.match(bad.reason, /泡茶/);
  assert.strictEqual(C.moveTask(SAMPLE, 't1', -1).ok, false);
  assert.deepStrictEqual(SAMPLE, before);
});
test('hints 规则一:超过 30% 的在场任务提示拆分;放着跑不提示', () => {
  const h = C.hints(C.schedule([T('a', 'A', 40, 'present'), T('b', 'B', 10, 'present'), T('c', 'C', 60, 'auto')]));
  assert.strictEqual(h.filter(x => x.kind === 'split').length, 1);
  assert.deepStrictEqual(h.find(x => x.kind === 'split').ids, ['a']);
  assert.match(h[0].text, /拆成两段/);
  const h2 = C.hints(C.schedule([T('a', 'A', 10, 'present'), T('b', 'B', 10, 'present'), T('c', 'C', 10, 'present'), T('d', 'D', 10, 'present'), T('e', 'E', 10, 'present')]));
  assert.strictEqual(h2.filter(x => x.kind === 'split').length, 0);
});
test('hints 规则二:连续 3 个在场任务 > 90 分钟提示;刚好 90 不提示;被放着跑隔开不算连续', () => {
  const mk = d => C.schedule([T('a', 'A', d, 'present'), T('b', 'B', d, 'present'), T('c', 'C', d, 'present'), T('x', 'X', 400, 'auto')]);
  assert.ok(C.hints(mk(31)).some(x => x.kind === 'break'));
  assert.ok(!C.hints(mk(30)).some(x => x.kind === 'break'));
  const gap = C.schedule([T('a', 'A', 40, 'present'), T('b', 'B', 40, 'present', [], 100), T('c', 'C', 40, 'present', [], 200)]);
  assert.ok(!C.hints(gap).some(x => x.kind === 'break'));
});
test('toSvg 的任务块数 = 任务数,名称被转义', () => {
  const tasks = [T('a', '<b>"&', 5, 'present'), T('b', 'B', 5, 'auto')];
  const svg = C.toSvg(C.schedule(tasks));
  assert.strictEqual((svg.match(/data-task=/g) || []).length, 2);
  assert.ok(!svg.includes('<b>'));
  assert.ok(svg.includes('&lt;b&gt;&quot;&amp;'));
  assert.strictEqual((C.toSvg(C.schedule(SAMPLE)).match(/data-task=/g) || []).length, SAMPLE.length);
});
test('CSV 公式防护:=+-@ 开头加单引号,单独的 - 和 + 不加', () => {
  const tasks = [T('a', '=cmd()', 1, 'present'), T('b', '+1', 1, 'present'), T('c', '-', 1, 'present'), T('d', '@x', 1, 'present'), T('e', '-2x', 1, 'present'), T('f', '+', 1, 'present'), T('g', '正常,带逗号', 1, 'present')];
  const lines = C.toCsv(tasks, C.schedule(tasks)).trim().split('\r\n');
  assert.ok(lines[1].includes(",'=cmd(),"));
  assert.ok(lines[2].includes(",'+1,"));
  assert.ok(lines[3].includes(',-,'));
  assert.ok(lines[4].includes(",'@x,"));
  assert.ok(lines[5].includes(",'-2x,"));
  assert.ok(lines[6].includes(',+,'));
  assert.ok(lines[7].includes('"正常,带逗号"'));
});
test('validateImport 拒绝耗时非正整数、非法枚举、重复 id、前置缺失、循环', () => {
  const base = () => ({ app: 'tongbingban', version: 1, tasks: clone(SAMPLE), templates: [] });
  assert.strictEqual(C.validateImport(base()).ok, true);
  const mut = fn => { const s = base(); fn(s); return C.validateImport(s); };
  for (const bad of [0, -5, 1.5, '5', null, NaN, Infinity]) {
    const r = mut(s => { s.tasks[0].dur = bad; });
    assert.strictEqual(r.ok, false, String(bad));
    assert.ok(r.errors.some(e => e.includes('耗时')));
  }
  assert.strictEqual(mut(s => { s.tasks[0].type = 'both'; }).ok, false);
  assert.strictEqual(mut(s => { s.tasks[1].id = 't1'; }).ok, false);
  assert.strictEqual(mut(s => { s.tasks[1].deps = ['nope']; }).ok, false);
  const cyc = mut(s => { s.tasks[0].deps = ['t2']; });
  assert.strictEqual(cyc.ok, false);
  assert.ok(cyc.errors.some(e => e.includes('循环依赖') && e.includes('烧水') && e.includes('泡茶')));
  assert.strictEqual(mut(s => { s.tasks[0].earliest = -1; }).ok, false);
  assert.strictEqual(mut(s => { s.tasks[0].name = '  '; }).ok, false);
  assert.strictEqual(mut(s => { s.version = 2; }).ok, false);
  assert.strictEqual(C.validateImport(null).ok, false);
  assert.strictEqual(C.parseState('{坏').ok, false);
});
test('写读校验同源:toJson 的输出经 parseState 往返一致,边界值不被读取拒绝', () => {
  const s = C.emptyState();
  s.tasks = clone(SAMPLE);
  s.tasks.push(T('t9', '长'.repeat(5000), 9999999, 'auto', ['t8']));
  s.templates.push({ id: 'p1', name: '模板', savedAt: '2026-10-20', tasks: clone(SAMPLE) });
  const w = C.validateState(s);
  assert.strictEqual(w.ok, true);
  const r = C.parseState(C.toJson(w.state));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.state, w.state);
});
test('模板内的非法任务使整份被拒', () => {
  const s = C.emptyState();
  s.templates.push({ id: 'p1', name: 'x', savedAt: 'd', tasks: [T('a', 'A', 0, 'present')] });
  assert.strictEqual(C.validateState(s).ok, false);
});
test('原型键名不会污染:id 为 __proto__ 的任务可正常排程', () => {
  const s = C.schedule([T('__proto__', 'P', 5, 'present'), T('constructor', 'Q', 5, 'auto', ['__proto__'])]);
  assert.strictEqual(s.total, 10);
});
test('空列表排程与 nextId', () => {
  const s = C.schedule([]);
  assert.deepStrictEqual([s.total, s.serialTotal, s.saved, s.savedPct], [0, 0, 0, 0]);
  assert.strictEqual(C.nextId([]), 't1');
  assert.strictEqual(C.nextId(SAMPLE), 't9');
});
test('parseToday 拒绝自动进位与非法格式', () => {
  assert.strictEqual(C.parseToday('?today=2026-10-20', 'X'), '2026-10-20');
  assert.strictEqual(C.parseToday('?today=2026-02-30', 'X'), 'X');
  assert.strictEqual(C.parseToday('?today=abc', 'X'), 'X');
  assert.strictEqual(C.parseToday('', 'X'), 'X');
  assert.strictEqual(C.parseToday('?today=2024-02-29', 'X'), '2024-02-29');
});
test('normalizeOrder 修正顺序,环返回 null', () => {
  const r = C.normalizeOrder([T('b', 'B', 1, 'present', ['a']), T('a', 'A', 1, 'present')]);
  assert.deepStrictEqual(r.map(t => t.id), ['a', 'b']);
  assert.strictEqual(C.normalizeOrder([T('a', 'A', 1, 'present', ['b']), T('b', 'B', 1, 'present', ['a'])]), null);
});
test('axisTicks:超大总时长刻度数有上限,并含起点', () => {
  for (const total of [1, 7, 107, 1e4, 1e9, 1e12, Number.MAX_SAFE_INTEGER]) {
    const t = C.axisTicks(total);
    assert.ok(t.length >= 1 && t.length <= 24, 'total=' + total + ' 刻度数 ' + t.length);
    assert.strictEqual(t[0], 0);
    assert.ok(t[t.length - 1] <= total);
  }
  assert.ok(C.axisTicks(107).length >= 2);
});
test('超大耗时排程与 SVG 导出不卡死', () => {
  const s = C.schedule([T('a', 'A', 1e12, 'present'), T('b', 'B', 5, 'auto')]);
  assert.strictEqual(s.total, 1e12);
  const t0 = Date.now();
  const svg = C.toSvg(s);
  assert.ok(Date.now() - t0 < 1000);
  assert.ok((svg.match(/<line /g) || []).length <= 24);
});
test('环成员只含真正的环:A<->B -> C -> D<->E 中 C 不算', () => {
  // 依赖方向:deps 指向前置。A,B 互为前置;C 依赖 B;D 依赖 C 与 E;E 依赖 D。
  const r = C.topoSort([T('A', 'A', 1, 'present', ['B']), T('B', 'B', 1, 'present', ['A']), T('C', 'C', 1, 'present', ['B']), T('D', 'D', 1, 'present', ['C', 'E']), T('E', 'E', 1, 'present', ['D'])]);
  assert.deepStrictEqual(r.members.slice().sort(), ['A', 'B', 'D', 'E']);
  assert.ok(!r.members.includes('C'));
  assert.ok(r.cycle.every(id => r.members.includes(id)) && !r.cycle.includes('C'));
  const e = C.validateState({ app: 'tongbingban', version: 1, templates: [], tasks: [T('A', 'A', 1, 'present', ['B']), T('B', 'B', 1, 'present', ['A']), T('C', 'C', 1, 'present', ['B'])] });
  assert.strictEqual(e.ok, false);
  assert.ok(!e.errors.join('').includes('「C」'));
});

test('dependentsOf:列出直接把该任务当前置的任务,删除前确认用', () => {
  assert.deepStrictEqual(C.dependentsOf(SAMPLE, 't1').map(t => t.name), ['泡茶']);
  assert.deepStrictEqual(C.dependentsOf(SAMPLE, 't3'), []);
  assert.deepStrictEqual(C.dependentsOf(SAMPLE, 'nope'), []);
});
test('validateState:sample 标记必须是布尔值并被保留,缺省为 false', () => {
  const base = C.emptyState();
  assert.strictEqual(C.validateState(base).state.sample, false);
  assert.strictEqual(C.validateState(Object.assign({}, base, { sample: true })).state.sample, true);
  const bad = C.validateState(Object.assign({}, base, { sample: 'yes' }));
  assert.strictEqual(bad.ok, false);
  assert.match(bad.errors.join(' '), /sample/);
  assert.strictEqual(C.parseState(C.toJson(Object.assign({}, base, { sample: true }))).state.sample, true);
});
test('合成示例在 CSV 与 SVG 导出中被标注,真实数据不标', () => {
  const tasks = clone(SAMPLE);
  const s = C.schedule(tasks);
  const csvSample = C.toCsv(tasks, s, { sample: true }).trim().split('\r\n');
  assert.match(csvSample[0], /数据性质$/);
  assert.ok(csvSample.slice(1).every(l => l.endsWith('合成示例')));
  assert.ok(!C.toCsv(tasks, s).includes('合成示例'));
  assert.ok(C.toSvg(s, {}, { sample: true }).includes('合成示例'));
  assert.ok(!C.toSvg(s).includes('合成示例'));
});

test('validateState:模板的 sample 标记同样必须是布尔值并被保留', () => {
  const tpl = (extra) => Object.assign({ id: 'p1', name: '模板', savedAt: '2026-10-20', tasks: clone(SAMPLE) }, extra);
  const mk = t => Object.assign(C.emptyState(), { templates: [t] });
  assert.strictEqual(C.validateState(mk(tpl({}))).state.templates[0].sample, false);
  assert.strictEqual(C.validateState(mk(tpl({ sample: true }))).state.templates[0].sample, true);
  assert.strictEqual(C.validateState(mk(tpl({ sample: 1 }))).ok, false);
});
