'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../core.js');
require('../sample-data.js');
const G = { start: 540, end: 720 };
const mk = (o) => Object.assign({ id: 'x', date: '2026-10-20', start: 540, end: 600, what: '写稿', group: 'prod', label: '' }, o);

test('结束时间不晚于开始时间被拒绝,并提示跨午夜', () => {
  const r = C.validateEntry(mk({ start: 600, end: 600 }), []);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => e.field === 'end' && /跨午夜/.test(e.message)));
  assert.strictEqual(C.validateEntry(mk({ start: 700, end: 600 }), []).ok, false);
  assert.strictEqual(C.validateEntry(mk(), []).ok, true);
});

test('同日区间相交被阻止,相邻不算相交,编辑自身不冲突', () => {
  const other = mk({ id: 'a', start: 600, end: 660 });
  assert.strictEqual(C.validateEntry(mk({ id: 'b', start: 630, end: 700 }), [other]).ok, false);
  assert.strictEqual(C.validateEntry(mk({ id: 'b', start: 660, end: 700 }), [other]).ok, true);
  assert.strictEqual(C.validateEntry(mk({ id: 'b', start: 540, end: 600 }), [other]).ok, true);
  assert.strictEqual(C.validateEntry(mk({ id: 'a', start: 610, end: 650 }), [other]).ok, true);
  assert.strictEqual(C.validateEntry(mk({ id: 'b', date: '2026-10-21', start: 630, end: 700 }), [other]).ok, true);
});

test('非法大类、日期、空内容被拒绝', () => {
  assert.strictEqual(C.validateEntry(mk({ group: 'game' }), []).ok, false);
  assert.strictEqual(C.validateEntry(mk({ date: '2026-02-30' }), []).ok, false);
  assert.strictEqual(C.validateEntry(mk({ what: '   ' }), []).ok, false);
  assert.strictEqual(C.validateEntry(mk({ start: 12.5 }), []).ok, false);
});

test('黄金时段交集分钟:部分重叠只算交集', () => {
  const e = [mk({ start: 480, end: 600, group: 'prod' }), mk({ id: 'y', start: 690, end: 780, group: 'consume' })];
  const u = C.goldenUsage(e, G);
  assert.strictEqual(u.byGroup.prod, 60);
  assert.strictEqual(u.byGroup.consume, 30);
  assert.strictEqual(u.focusMin, 60);
  assert.strictEqual(u.capacity, 180);
  assert.ok(Math.abs(u.focusRatio - 1 / 3) < 1e-9);
});

test('占比不除零:空数据与零长黄金窗口', () => {
  const s = C.daySummary([], G);
  assert.strictEqual(s.total, 0);
  assert.strictEqual(s.focusRatio, 0);
  assert.strictEqual(s.goldenRatio, 0);
  assert.strictEqual(s.biggest, null);
  const bad = C.goldenUsage([mk()], { start: 600, end: 600 });
  assert.strictEqual(bad.capacity, 180); // 非法窗口回退默认 09:00–12:00,而不是除零
  const r = C.rangeSummary([], '2026-10-01', '2026-10-07', G);
  assert.strictEqual(r.days.length, 7);
  assert.strictEqual(r.avgGoldenRatio, 0);
  assert.strictEqual(r.shares.prod, 0);
});

test('daySummary 分类汇总与最大一笔', () => {
  const e = [mk({ id: '1', start: 540, end: 660, group: 'prod' }), mk({ id: '2', start: 700, end: 730, group: 'learn' }), mk({ id: '3', start: 800, end: 1000, group: 'consume' })];
  const s = C.daySummary(e, G);
  assert.strictEqual(s.total, 350);
  assert.strictEqual(s.focusMin, 150);
  assert.strictEqual(s.biggest.id, '3');
  assert.strictEqual(s.golden.byGroup.learn, 20);
});

test('rangeSummary 日期边界含首尾,区间外不计', () => {
  const e = [mk({ id: '1', date: '2026-10-06' }), mk({ id: '2', date: '2026-10-07' }), mk({ id: '3', date: '2026-10-13' }), mk({ id: '4', date: '2026-10-14' })];
  const r = C.rangeSummary(e, '2026-10-07', '2026-10-13', G);
  assert.strictEqual(r.days.length, 7);
  assert.strictEqual(r.recordedDays, 2);
  assert.strictEqual(r.total, 120);
  assert.strictEqual(C.rangeSummary(e, '2026-10-13', '2026-10-07', G).days.length, 0);
  assert.strictEqual(C.rangeSummary(e, 'bad', '2026-10-07', G).days.length, 0);
});

test('streak:阈值含等号,无记录或日期断档会中断', () => {
  const d = (date, goldenRatio, recorded) => ({ date, goldenRatio, recorded: recorded !== false });
  const days = [d('2026-10-01', 0.6), d('2026-10-02', 0.9), d('2026-10-03', 0.59), d('2026-10-04', 0.7), d('2026-10-05', 0.7), d('2026-10-06', 0.8)];
  assert.deepStrictEqual(C.streak(days, 0.6), { current: 3, best: 3 });
  assert.deepStrictEqual(C.streak(days, 0.75), { current: 1, best: 1 });
  const gap = [d('2026-10-01', 1), d('2026-10-02', 1), d('2026-10-04', 1)];
  assert.deepStrictEqual(C.streak(gap, 0.6), { current: 1, best: 2 });
  assert.deepStrictEqual(C.streak([d('2026-10-01', 1), d('2026-10-02', 0, false)], 0.6), { current: 0, best: 1 });
  assert.deepStrictEqual(C.streak([], 0.6), { current: 0, best: 0 });
  // 108/180 刚好 60%
  const exact = C.daySummary([mk({ start: 540, end: 648 })], G);
  assert.deepStrictEqual(C.streak([{ date: '2026-10-01', goldenRatio: exact.goldenRatio, recorded: true }], 0.6).best, 1);
});

test('longest 按时长降序,同长按日期与开始时间', () => {
  const e = [mk({ id: 'a', start: 0, end: 30 }), mk({ id: 'b', date: '2026-10-19', start: 0, end: 90 }), mk({ id: 'c', start: 100, end: 190 }), mk({ id: 'd', start: 300, end: 400 })];
  assert.deepStrictEqual(C.longest(e, 3).map(x => x.id), ['d', 'b', 'c']);
  assert.deepStrictEqual(C.longest(e, 0), []);
  assert.deepStrictEqual(C.longest([], 7), []);
  assert.strictEqual(C.longest(e).length, 4);
});

test('上周对比:与紧邻的上一个等长区间比较占比', () => {
  const e = [
    mk({ id: '1', date: '2026-10-08', start: 540, end: 600, group: 'consume' }),
    mk({ id: '2', date: '2026-10-08', start: 600, end: 660, group: 'prod' }),
    mk({ id: '3', date: '2026-10-16', start: 540, end: 600, group: 'prod' }),
    mk({ id: '4', date: '2026-10-16', start: 600, end: 660, group: 'prod' })
  ];
  const c = C.compareRanges(e, '2026-10-14', '2026-10-20', G);
  assert.strictEqual(c.prevFrom, '2026-10-07');
  assert.strictEqual(c.prevTo, '2026-10-13');
  assert.strictEqual(c.previous.byGroup.consume, 60);
  assert.ok(Math.abs(c.shareDelta.prod - 0.5) < 1e-9);
  assert.ok(Math.abs(c.shareDelta.consume + 0.5) < 1e-9);
  assert.strictEqual(c.focusMinDelta, 60);
});

test('跨午夜拆成两天,总分钟不变', () => {
  const parts = C.splitOvernight(mk({ start: 1350, end: 40, what: '刷视频' }));
  assert.strictEqual(parts.length, 2);
  assert.strictEqual(parts[0].end, 1440);
  assert.strictEqual(parts[1].date, '2026-10-21');
  assert.strictEqual(parts[1].start, 0);
  assert.strictEqual(C.duration(parts[0]) + C.duration(parts[1]), 130);
  assert.strictEqual(C.splitOvernight(mk()), null);
  assert.ok(parts.every(p => C.validateEntry(p, []).ok));
});

test('CSV 与 Markdown 公式防护,单独的 - 或 + 不加前缀', () => {
  const rows = [mk({ what: '=SUM(A1)', label: '@cmd' }), mk({ id: 'z', start: 700, end: 760, what: '-', label: '+1+2' })];
  const csv = C.toCsv(rows, G);
  assert.ok(csv.includes("'=SUM(A1)"));
  assert.ok(csv.includes("'@cmd"));
  assert.ok(csv.includes("'+1+2"));
  assert.ok(/,-,/.test(csv) || /,-\r\n/.test(csv));
  assert.ok(!csv.includes("'-"));
  assert.strictEqual(C.guardFormula('+'), '+');
  assert.strictEqual(C.guardFormula('-5 分钟'), "'-5 分钟");
  assert.strictEqual(C.toCsv([mk({ what: 'a,"b"' })], G).split('\r\n')[1].split(',').slice(6).join(','), '"a,""b""",60');
  const md = C.weeklyReport({ entries: [mk({ what: '=HYPERLINK("x")|管道' })], notes: { '2026-10-20': '@备注' }, from: '2026-10-14', to: '2026-10-20', golden: G });
  assert.ok(md.includes("'=HYPERLINK"));
  assert.ok(md.includes('\\|管道'));
  assert.ok(md.includes("'@备注"));
});

test('?today 固定今天;非法值回退真实今天且不抛错', () => {
  const now = new Date(2026, 5, 3, 12, 0, 0);
  assert.strictEqual(C.resolveToday('?today=2026-10-20', now), '2026-10-20');
  assert.strictEqual(C.resolveToday('?today=2026-13-40', now), '2026-06-03');
  assert.strictEqual(C.resolveToday('?today=abc', now), '2026-06-03');
  assert.strictEqual(C.resolveToday('', now), '2026-06-03');
  assert.strictEqual(C.resolveToday(null, now), '2026-06-03');
});

test('validateImport 拒绝非五大类、重复 id、重叠、非法类型,整份拒绝', () => {
  const base = () => ({ app: 'attention-ledger', version: 1, golden: { start: 540, end: 720 }, entries: [mk({ id: 'a' })], notes: {} });
  assert.strictEqual(C.validateImport(base()).ok, true);
  const bad1 = base(); bad1.entries[0].group = '娱乐';
  assert.strictEqual(C.validateImport(bad1).ok, false);
  const bad2 = base(); bad2.entries.push(mk({ id: 'a', date: '2026-10-21' }));
  const r2 = C.validateImport(bad2); assert.strictEqual(r2.ok, false); assert.ok(/重复/.test(r2.error));
  const bad3 = base(); bad3.entries.push(mk({ id: 'b', start: 570, end: 620 }));
  assert.strictEqual(C.validateImport(bad3).ok, false);
  const bad4 = base(); bad4.entries[0].start = '540';
  assert.strictEqual(C.validateImport(bad4).ok, false);
  const bad5 = base(); bad5.golden = { start: 800, end: 700 };
  assert.strictEqual(C.validateImport(bad5).ok, false);
  const bad6 = base(); bad6.notes = { 'not-a-date': 'x' };
  assert.strictEqual(C.validateImport(bad6).ok, false);
  assert.strictEqual(C.validateImport('{not json').ok, false);
  assert.strictEqual(C.validateImport(null).ok, false);
  const bad7 = base(); bad7.version = 2;
  assert.strictEqual(C.validateImport(bad7).ok, false);
});

test('导入后 __proto__ 不污染原型,备注按 Map/空原型保存', () => {
  const r = C.validateImport(JSON.parse('{"app":"attention-ledger","version":1,"golden":{"start":540,"end":720},"entries":[],"notes":{"2026-10-20":"ok"}}'));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(Object.getPrototypeOf(r.data.notes), null);
  const poison = JSON.parse('{"app":"attention-ledger","version":1,"golden":{"start":540,"end":720},"entries":[],"notes":{"__proto__":"x"}}');
  assert.strictEqual(C.validateImport(poison).ok, false);
  assert.strictEqual({}.polluted, undefined);
  const e = [mk({ what: '__proto__', group: 'prod' }), mk({ id: 'q', start: 700, end: 720, what: 'constructor', group: 'learn' })];
  const m = C.groupByDate(e);
  assert.strictEqual(m.get('2026-10-20').length, 2);
});

test('示例数据通过导入校验,且包含设计好的场景', () => {
  const S = globalThis.AttentionSample;
  const v = C.validateImport(S.data);
  assert.strictEqual(v.ok, true, v.error);
  const r = C.rangeSummary(S.data.entries, '2026-10-07', '2026-10-20', G);
  assert.strictEqual(r.days.length, 14);
  r.days.forEach(d => assert.ok(d.recorded));
  const per = C.groupByDate(S.data.entries);
  [...per.values()].forEach(l => assert.ok(l.length >= 5 && l.length <= 8, '每天 5–8 段'));
  const byDate = Object.fromEntries(r.days.map(d => [d.date, d]));
  assert.strictEqual(byDate['2026-10-10'].goldenFocusMin, 0);
  assert.strictEqual(byDate['2026-10-15'].goldenFocusMin, 0);
  assert.strictEqual(C.streak(r.days, 0.6).current, 5);
  assert.strictEqual(C.validateEntry(Object.assign({ id: 'new' }, S.errorExample), per.get('2026-10-20')).ok, false);
});

test('周报 Markdown 含统计、最长 7 段与备注;空数据不报错', () => {
  const S = globalThis.AttentionSample;
  const md = C.weeklyReport({ entries: S.data.entries, notes: S.data.notes, from: '2026-10-14', to: '2026-10-20', golden: G });
  assert.ok(md.startsWith('# 注意力周报 2026-10-14 至 2026-10-20'));
  assert.ok(md.includes('## 最长的 7 段'));
  assert.strictEqual(md.split('## 最长的 7 段')[1].split('## 我的备注')[0].split('\n').filter(l => /^\| 2026/.test(l)).length, 7);
  assert.ok(md.includes('黄金时段给了第六章。'));
  const empty = C.weeklyReport({ entries: [], notes: {}, from: '2026-10-14', to: '2026-10-20', golden: G });
  assert.ok(empty.includes('这个区间没有记录。'));
  assert.ok(empty.includes('这个区间没有写备注。'));
});

test('午夜结束:end=1440 合法,end=0 非法(编辑午夜记录不能回填成 00:00)', () => {
  assert.strictEqual(C.validateEntry(mk({ start: 1350, end: 1440 }), []).ok, true);
  assert.strictEqual(C.validateEntry(mk({ start: 1350, end: 0 }), []).ok, false);
  assert.strictEqual(C.fmtTime(1440), '24:00');
  assert.strictEqual(C.parseTime('24:00'), 1440);
  assert.strictEqual(C.validateImport({ app: 'attention-ledger', version: 1, golden: { start: 540, end: 720 }, entries: [mk({ id: 'm', start: 1350, end: 1440 })], notes: {} }).ok, true);
});

test('replaceScope:记录、备注、黄金时段偏离默认值、表单草稿、备注草稿都算用户数据', () => {
  const empty = { golden: { start: 540, end: 720 }, entries: [], notes: {} };
  assert.strictEqual(C.replaceScope(empty, {}).any, false);
  const g = C.replaceScope({ golden: { start: 600, end: 720 }, entries: [], notes: {} }, {});
  assert.strictEqual(g.any, true);
  assert.strictEqual(g.goldenChanged, true);
  assert.ok(/黄金时段/.test(C.describeScope(g)));
  const d = C.replaceScope(empty, { formDraft: true });
  assert.strictEqual(d.any, true);
  assert.ok(/表单草稿/.test(C.describeScope(d)));
  const n = C.replaceScope(empty, { noteDraft: true });
  assert.strictEqual(n.any, true);
  const full = C.replaceScope({ golden: { start: 540, end: 720 }, entries: [mk()], notes: { '2026-10-20': 'x' } }, {});
  assert.strictEqual(full.entries, 1);
  assert.strictEqual(full.notes, 1);
  assert.ok(/1 段记录/.test(C.describeScope(full)) && /1 条备注/.test(C.describeScope(full)));
});

test('withDraft:草稿并入当天列表;编辑时替换原条目;无效草稿不并入', () => {
  const saved = [mk({ id: 'a', start: 540, end: 600 }), mk({ id: 'b', start: 700, end: 760 })];
  const draft = mk({ id: 'new', start: 600, end: 660, what: '草稿' });
  const r = C.withDraft(saved, [draft], null);
  assert.strictEqual(r.length, 3);
  assert.strictEqual(r.filter(e => e.draft).length, 1);
  const edited = C.withDraft(saved, [Object.assign({}, draft, { id: 'a' })], 'a');
  assert.strictEqual(edited.length, 2);
  assert.ok(!edited.some(e => e.id === 'a' && !e.draft));
  const overlap = C.withDraft(saved, [mk({ id: 'new', start: 550, end: 580 })], null);
  assert.strictEqual(overlap.length, 2, '与已有记录相交的草稿不预览');
  assert.strictEqual(C.withDraft(saved, [], null).length, 2);
  assert.strictEqual(saved.length, 2, '不修改原数组');
});

test('合成示例标记:导入保留 sample,非布尔拒绝;CSV 与周报写明数据来源', () => {
  const base = { app: 'attention-ledger', version: 1, golden: { start: 540, end: 720 }, entries: [mk({ id: 'a' })], notes: {} };
  assert.strictEqual(C.validateImport(Object.assign({ sample: true }, base)).data.sample, true);
  assert.strictEqual(C.validateImport(base).data.sample, false);
  assert.strictEqual(C.validateImport(Object.assign({ sample: 'yes' }, base)).ok, false);
  const csv = C.toCsv([mk()], G, { sample: true });
  assert.ok(csv.split('\r\n')[0].endsWith(',数据来源') && csv.split('\r\n')[1].endsWith(',合成示例'));
  assert.ok(!C.toCsv([mk()], G).includes('数据来源'));
  const md = C.weeklyReport({ entries: [mk()], notes: {}, from: '2026-10-14', to: '2026-10-20', golden: G, sample: true });
  assert.ok(md.includes('合成示例'));
  assert.ok(!C.weeklyReport({ entries: [mk()], notes: {}, from: '2026-10-14', to: '2026-10-20', golden: G }).includes('合成示例'));
});

test('fixedToday:仅合法的 ?today 返回日期,2026-02-30 之类返回 null', () => {
  assert.strictEqual(C.fixedToday('?today=2026-10-20'), '2026-10-20');
  assert.strictEqual(C.fixedToday('?today=2026-02-30'), null);
  assert.strictEqual(C.fixedToday(''), null);
  assert.strictEqual(C.fixedToday('?x=1'), null);
});
