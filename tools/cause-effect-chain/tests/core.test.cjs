'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../core.js');
const sample = require('../sample-data.js');

const mk = (o) => Object.assign({ id: 'x1', date: '2026-10-20', who: 'A 娃', event: '事', chain: ['因为甲', '所以乙'], proposer: 'child', mood: 'calm', tags: [], status: 'done', prevId: null }, o);
const st = (entries) => ({ version: 1, entries, config: C.defaultConfig() });

test('远期词提示', () => {
  const r = C.checkChain(mk({ chain: ['因为没戴头盔', '所以以后找不到工作'] }), C.defaultConfig());
  const far = r.issues.find(i => i.code === 'far');
  assert.ok(far);
  assert.deepStrictEqual(far.words, ['以后', '找不到工作']);
  assert.match(far.message, /空泛因果/);
  assert.strictEqual(C.checkChain(mk(), C.defaultConfig()).issues.length, 0);
});
test('远期词可配,自定义词表生效', () => {
  const cfg = Object.assign(C.defaultConfig(), { farWords: ['下辈子'] });
  assert.ok(C.checkChain(mk({ chain: ['因为甲', '所以下辈子'] }), cfg).issues.some(i => i.code === 'far'));
  assert.ok(!C.checkChain(mk({ chain: ['因为甲', '所以以后'] }), cfg).issues.some(i => i.code === 'far'));
});
test('有情绪提示并可存草稿(草稿链条可不足 2 级)', () => {
  const e = mk({ mood: 'upset', status: 'draft', chain: ['因为甲'] });
  const codes = C.checkChain(e, C.defaultConfig()).issues.map(i => i.code);
  assert.ok(codes.includes('emotion'));
  assert.ok(C.validateEntry(e).ok);
  assert.ok(!C.validateEntry(mk({ chain: ['因为甲'] })).ok); // 已复盘不行
});
test('只有 1 级提示再推一步,空链条另有提示', () => {
  const r = C.checkChain(mk({ chain: ['因为甲', '  '] }), C.defaultConfig());
  assert.deepStrictEqual(r.issues.map(i => i.code), ['short']);
  assert.strictEqual(r.issues[0].message, '再推一步');
  assert.deepStrictEqual(C.checkChain(mk({ chain: [] }), C.defaultConfig()).issues.map(i => i.code), ['empty']);
});
test('级数上下限:导入 1 级与 7 级整份拒绝,2 与 6 级通过', () => {
  const six = ['一', '二', '三', '四', '五', '六'];
  assert.ok(C.validateImport(st([mk({ chain: six })])).ok);
  assert.ok(C.validateImport(st([mk({ chain: ['一', '二'] })])).ok);
  const low = C.validateImport(JSON.stringify(st([mk(), mk({ id: 'x2', chain: ['一'] })])));
  assert.ok(!low.ok); assert.match(low.error, /第 2 条.*至少 2 级/);
  const high = C.validateImport(st([mk({ chain: six.concat('七') })]));
  assert.ok(!high.ok); assert.match(high.error, /最多 6 级/);
});
test('导入拒绝坏枚举、坏日期、重复 id、坏关联、坏 JSON,且不修正', () => {
  assert.ok(!C.validateImport(st([mk({ proposer: 'teacher' })])).ok);
  assert.ok(!C.validateImport(st([mk({ mood: 'happy' })])).ok);
  assert.ok(!C.validateImport(st([mk({ date: '2026-02-30' })])).ok);
  assert.ok(!C.validateImport(st([mk({ date: '10/20/2026' })])).ok);
  assert.ok(!C.validateImport(st([mk(), mk()])).ok);
  assert.ok(!C.validateImport(st([mk({ prevId: 'nope' })])).ok);
  assert.ok(!C.validateImport(st([mk({ prevId: 'x1' })])).ok);
  assert.ok(!C.validateImport(st([mk({ id: 'a', prevId: 'b' }), mk({ id: 'b', prevId: 'a' })])).ok);
  assert.ok(!C.validateImport('{坏').ok);
  assert.ok(!C.validateImport(Object.assign(st([]), { version: 2 })).ok);
  assert.ok(!C.validateImport([]).ok);
});
test('childRatio:除零返回 null,窗口按天计,草稿与“自己”不计', () => {
  assert.deepStrictEqual(C.childRatio([], 30, '2026-10-20'), { child: 0, total: 0, ratio: null });
  const es = [
    mk({ id: 'a', date: '2026-10-20', proposer: 'child' }),
    mk({ id: 'b', date: '2026-10-14', proposer: 'parent' }),
    mk({ id: 'c', date: '2026-10-13', proposer: 'child' }), // 7 天窗口外
    mk({ id: 'd', who: '自己', proposer: 'child' }),
    mk({ id: 'e', status: 'draft', proposer: 'child' }),
  ];
  assert.deepStrictEqual(C.childRatio(es, 7, '2026-10-20'), { child: 1, total: 2, ratio: 0.5 });
  assert.strictEqual(C.childRatio(es, 8, '2026-10-20').total, 3);
  assert.strictEqual(C.childRatio(es, 7, 'bad').ratio, null);
});
test('ratioSeries 按周分桶,示例数据三条孩子自己推演', () => {
  const s = sample();
  const ser = C.ratioSeries(s.entries, '2026-10-20', 8);
  assert.strictEqual(ser.length, 8);
  assert.strictEqual(ser[7].end, '2026-10-20');
  assert.strictEqual(ser[7].start, '2026-10-14');
  assert.strictEqual(ser.reduce((a, b) => a + b.child, 0), 3);
  assert.ok(ser.filter(p => p.ratio !== null).length >= 3);
});
test('tagStats 计数并排序,__proto__ 标签不污染', () => {
  const r = C.tagStats([mk({ tags: ['安全', '作业'] }), mk({ id: 'b', tags: ['安全'] }), mk({ id: 'c', tags: ['__proto__', '__proto__'] })]);
  assert.deepStrictEqual(r.map(x => [x.tag, x.count]), [['安全', 2], ['__proto__', 1], ['作业', 1]]);
  assert.strictEqual(({}).polluted, undefined);
});
test('todayPending 只取当天且未复盘(草稿)', () => {
  const es = [mk({ id: 'a', status: 'draft' }), mk({ id: 'b', status: 'done' }), mk({ id: 'c', status: 'draft', date: '2026-10-19' })];
  assert.deepStrictEqual(C.todayPending(es, '2026-10-20').map(e => e.id), ['a']);
  assert.deepStrictEqual(C.todayPending(sample().entries, '2026-10-20').map(e => e.id), ['sample-10']);
});
test('currentSlot 取已到的最晚时段', () => {
  const slots = C.defaultConfig().slots;
  assert.strictEqual(C.currentSlot(slots, '18:00'), null);
  assert.strictEqual(C.currentSlot(slots, '19:30').label, '晚饭后');
  assert.strictEqual(C.currentSlot(slots, '22:10').label, '睡前');
});
test('search 中文子串,覆盖事件/链条/标签/姓名', () => {
  const es = sample().entries;
  assert.deepStrictEqual(C.search(es, '水杯').map(e => e.id), ['sample-3', 'sample-8']);
  assert.deepStrictEqual(C.search(es, '头盔').map(e => e.id), ['sample-6']);
  assert.strictEqual(C.search(es, '').length, 10);
  assert.strictEqual(C.search(es, '不存在的词').length, 0);
  assert.deepStrictEqual(C.filterEntries(es, { who: 'B 娃', tag: '安全' }).map(e => e.id), ['sample-6', 'sample-9']);
});
test('link:自指、不存在、成环拒绝;正常关联与取消', () => {
  const es = [mk({ id: 'a' }), mk({ id: 'b' }), mk({ id: 'c' })];
  assert.ok(!C.link(es, 'a', 'a').ok);
  assert.ok(!C.link(es, 'a', 'zz').ok);
  assert.ok(!C.link(es, 'zz', 'a').ok);
  const r = C.link(es, 'b', 'a');
  assert.ok(r.ok); assert.strictEqual(r.entries[1].prevId, 'a'); assert.strictEqual(es[1].prevId, null);
  assert.ok(!C.link(r.entries, 'a', 'b').ok);
  assert.strictEqual(C.link(r.entries, 'b', null).entries[1].prevId, null);
});
test('Markdown 按月分组、含关联与上次链条', () => {
  const md = C.toMarkdown(sample().entries);
  assert.ok(md.indexOf('## 2026-09') < md.indexOf('## 2026-10'));
  assert.ok(md.indexOf('### 2026-09-08') < md.indexOf('### 2026-09-15'));
  assert.match(md, /- 因为:因为出门前没检查书包/);
  assert.match(md, /关联上次:2026-09-22 忘带水杯去学校/);
  assert.match(md, /状态:草稿/);
  const oct = md.slice(md.indexOf('## 2026-10'));
  assert.ok(!oct.includes('2026-09-'.concat('08')));
});
test('CSV 与 Markdown 公式防护,单独 - / + 不加', () => {
  const es = [mk({ event: '=SUM(A1)', who: '+1', chain: ['-', '@cmd'], tags: ['-2'] })];
  const csv = C.toCsv(es);
  assert.ok(csv.includes("'=SUM(A1)"));
  assert.ok(csv.includes("'+1"));
  assert.ok(csv.includes("'@cmd"));
  assert.ok(csv.includes("'-2"));
  assert.ok(/,-,/.test(csv));
  assert.ok(C.toMarkdown(es).includes("'=SUM(A1)"));
  assert.strictEqual(C.guard('+'), '+');
  assert.ok(C.toCsv([mk({ event: 'a,"b"\n' })]).includes('"a,""b""\n"'));
});
test('?today 固定今天,非法与自动进位回退', () => {
  assert.strictEqual(C.resolveToday('?today=2026-10-20', '2030-01-01'), '2026-10-20');
  assert.strictEqual(C.resolveToday('?today=2026-02-30', '2030-01-01'), '2030-01-01');
  assert.strictEqual(C.resolveToday('?today=abc', '2030-01-01'), '2030-01-01');
  assert.strictEqual(C.resolveToday('', '2030-01-01'), '2030-01-01');
  assert.strictEqual(C.resolveToday(null, '2030-01-01'), '2030-01-01');
  assert.strictEqual(C.addDays('2026-03-01', -1), '2026-02-28');
});
test('写读校验同源:示例与往返 JSON 都通过同一个 validateState', () => {
  const s = sample();
  assert.ok(C.validateState(s).ok);
  const back = C.validateImport(C.toJson(s));
  assert.ok(back.ok);
  assert.deepStrictEqual(back.state, s);
  assert.ok(C.validateState(C.newState()).ok);
  // 边界:超长文本也能写后读
  const long = mk({ event: '长'.repeat(5000), chain: ['因'.repeat(5000), '所'.repeat(5000)] });
  assert.ok(C.validateImport(JSON.parse(JSON.stringify(st([long])))).ok);
});
test('设置校验:时段必须两个且时间合法,标签不重复', () => {
  const c = C.defaultConfig();
  assert.ok(C.validateConfig(c).ok);
  assert.ok(!C.validateConfig(Object.assign({}, c, { slots: [c.slots[0]] })).ok);
  assert.ok(!C.validateConfig(Object.assign({}, c, { slots: [c.slots[0], { label: 'x', time: '25:00' }] })).ok);
  assert.ok(!C.validateConfig(Object.assign({}, c, { tags: ['a', 'a'] })).ok);
});
test('间接缺失引用(A→B、B→不存在)整份拒绝而不是抛错,且读取路径同样如此', () => {
  const s = st([mk({ id: 'a', prevId: 'b' }), mk({ id: 'b', prevId: 'ghost' })]);
  let r;
  assert.doesNotThrow(() => { r = C.validateImport(s); });
  assert.ok(!r.ok); assert.match(r.error, /第 2 条.*不存在/);
  assert.doesNotThrow(() => { r = C.validateImport(JSON.stringify(s)); });
  assert.ok(!r.ok);
  assert.ok(!C.validateState(st([mk({ id: 'b', prevId: 'ghost' }), mk({ id: 'a', prevId: 'b' })])).ok);
  assert.doesNotThrow(() => C.link(s.entries, 'a', 'b'));
});
test('有情绪的正式条目与草稿都被校验接受(只提示,不禁止)', () => {
  const e = mk({ mood: 'upset', status: 'done' });
  assert.ok(C.validateEntry(e).ok);
  assert.ok(C.validateImport(st([e])).ok);
  assert.ok(C.checkChain(e, C.defaultConfig()).issues.some(i => i.code === 'emotion'));
});
test('hasUserData:空默认状态为假;只有自定义设置也为真;有条目为真', () => {
  assert.strictEqual(C.hasUserData(C.newState()), false);
  const a = C.newState(); a.config.tags.push('运动');
  assert.strictEqual(C.hasUserData(a), true);
  const b = C.newState(); b.config.farWords = ['下辈子'];
  assert.strictEqual(C.hasUserData(b), true);
  const c = C.newState(); c.config.slots[0].time = '18:00';
  assert.strictEqual(C.hasUserData(c), true);
  assert.strictEqual(C.hasUserData(st([mk()])), true);
});

test('ratioSegments:没有记录的周把折线断开,孤立的点单独成段', () => {
  const s = (ratios) => ratios.map((r, i) => ({ start: 'a' + i, end: 'b' + i, child: 0, total: r === null ? 0 : 1, ratio: r }));
  assert.deepStrictEqual(C.ratioSegments(s([0.5, 0.5, null, null, 1, null, 0, 0.2])), [[0, 1], [4], [6, 7]]);
  assert.deepStrictEqual(C.ratioSegments(s([null, null])), []);
  assert.deepStrictEqual(C.ratioSegments(s([0, 1])), [[0, 1]]);
  assert.deepStrictEqual(C.ratioSegments([]), []);
});

test('合成示例条目在 CSV 与 Markdown 里标注,没有示例条目时不加列也不加说明', () => {
  const real = [{ id: 'e1', date: '2026-10-01', who: '我', event: '真事', chain: ['a', 'b'], proposer: 'parent', mood: 'calm', tags: [], status: 'done', prevId: null }];
  const sample = [Object.assign({}, real[0], { id: 'sample-1', event: '演示' })];
  assert.ok(!C.toCsv(real).split('\r\n')[0].includes('数据性质'));
  assert.ok(!C.toMarkdown(real).includes('合成示例'));
  const lines = C.toCsv(real.concat(sample)).trim().split('\r\n');
  assert.match(lines[0], /数据性质$/);
  assert.ok(lines[1].endsWith(',') && lines[2].endsWith('合成示例'));
  const md = C.toMarkdown(real.concat(sample));
  assert.match(md, /合成示例/);
  assert.equal((md.match(/【合成示例】/g) || []).length, 1);
});
