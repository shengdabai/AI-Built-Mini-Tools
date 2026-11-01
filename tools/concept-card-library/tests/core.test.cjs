'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');
require('../sample-data.js');

let n = 0;
const card = (o) => Object.assign({
  id: 'c' + (++n), name: '卡' + n, def: '一句话定义', notNot: ['反例'], questions: ['问题?'], links: [],
  source: '', status: '草稿', created: '2026-09-01', rewritten: '', reviewed: '', versions: []
}, o);

test('定义超过 60 字只警告不拒绝,恰好 60 字不警告', () => {
  const long = C.validateCard(card({ def: '长'.repeat(61) }), []);
  assert.equal(long.ok, true);
  assert.equal(long.warnings.filter((w) => w.includes('超过 60')).length, 1);
  assert.equal(C.validateCard(card({ def: '长'.repeat(60) }), []).warnings.length, 0);
  // 按字符数而不是 UTF-16 单元数:60 个代理对字符仍是 60 字
  assert.equal(C.validateCard(card({ def: '𠀀'.repeat(60) }), []).warnings.length, 0);
});

test('名、定义必填', () => {
  assert.equal(C.validateCard(card({ name: '  ' }), []).ok, false);
  assert.equal(C.validateCard(card({ def: '' }), []).ok, false);
});

test('反例与可回答的问题至少各 1 条', () => {
  const a = C.validateCard(card({ notNot: [] }), []);
  assert.equal(a.ok, false);
  assert.match(a.errors.join(), /不是什么/);
  const b = C.validateCard(card({ questions: ['  '] }), []);
  assert.equal(b.ok, false);
  assert.match(b.errors.join(), /能回答的问题/);
});

test('自引用被拒绝,重复关联被拒绝', () => {
  const self = C.validateCard(card({ name: 'A', links: ['A'] }), ['A']);
  assert.equal(self.ok, false);
  assert.match(self.errors.join(), /不能关联自己/);
  assert.equal(C.validateCard(card({ name: 'A', links: ['B', 'B'] }), ['A', 'B']).ok, false);
});

test('引用不存在的卡片给出提示但不拒绝', () => {
  const r = C.validateCard(card({ name: 'A', links: ['幽灵'] }), ['A']);
  assert.equal(r.ok, true);
  assert.match(r.warnings.join(), /幽灵/);
});

test('状态枚举与日期格式', () => {
  assert.equal(C.validateCard(card({ status: '完成' }), []).ok, false);
  assert.equal(C.validateCard(card({ created: '2026-02-30' }), []).ok, false);
  assert.equal(C.validateCard(card({ rewritten: '昨天' }), []).ok, false);
});

test('qualityGate:三项全过', () => {
  const a = card({ name: 'A', def: '没有别的卡名' });
  const g = C.qualityGate(a, [a]);
  assert.deepEqual([g.clear, g.accurate, g.necessary, g.reasons], [true, true, true, []]);
  assert.equal(C.canBeUsable(a, [a]), true);
});

test('qualityGate:缺反例或缺问题各自失败并写明原因', () => {
  const a = card({ name: 'A', notNot: [] });
  const g = C.qualityGate(a, [a]);
  assert.equal(g.accurate, false);
  assert.equal(g.necessary, true);
  const b = card({ name: 'B', questions: [] });
  const h = C.qualityGate(b, [b]);
  assert.equal(h.necessary, false);
  assert.match(h.reasons.join(), /缺少它能回答的问题/);
  assert.equal(C.canBeUsable(b, [b]), false);
});

test('qualityGate:定义引用草稿卡 -> 依赖未定义概念;引用可用卡则通过', () => {
  const draft = card({ name: '心智模型', status: '草稿' });
  const ok = card({ name: '概念', status: '可用' });
  const a = card({ name: 'A', def: '用心智模型检验' });
  const b = card({ name: 'B', def: '用概念检验' });
  const cards = [draft, ok, a, b];
  const ga = C.qualityGate(a, cards);
  assert.equal(ga.clear, false);
  assert.match(ga.reasons.join(), /依赖未定义概念:心智模型/);
  assert.equal(C.canBeUsable(a, cards), false);
  assert.equal(C.qualityGate(b, cards).clear, true);
});

test('qualityGate:长名优先,不会因「复利效应」同时误报草稿「复利」', () => {
  const short = card({ name: '复利', status: '草稿' });
  const long = card({ name: '复利效应', status: '可用' });
  const a = card({ name: 'A', def: '依靠复利效应增长' });
  assert.equal(C.qualityGate(a, [short, long, a]).clear, true);
  const b = card({ name: 'B', def: '依靠复利增长' });
  assert.equal(C.qualityGate(b, [short, long, b]).clear, false);
});

test('linkGraph:关联自动双向、去重、忽略不存在的名字', () => {
  const a = card({ name: 'A', links: ['B', 'B', '幽灵'] });
  const b = card({ name: 'B', links: [] });
  const c = card({ name: 'C', links: [] });
  const g = C.linkGraph([a, b, c]);
  assert.deepEqual(g.adjacency.A, ['B']);
  assert.deepEqual(g.adjacency.B, ['A']);
  assert.deepEqual(g.adjacency.C, []);
  assert.deepEqual(g.islands, ['C']);
});

test('linkGraph:枢纽取关联最多的前 3 名,孤岛不进枢纽;__proto__ 当卡名不出事', () => {
  const hub = card({ name: '__proto__', links: ['a', 'b', 'c', 'd'] });
  const ls = ['a', 'b', 'c', 'd'].map((x) => card({ name: x, links: x === 'a' ? ['b'] : [] }));
  const lone = card({ name: 'constructor' });
  const g = C.linkGraph([hub].concat(ls, [lone]));
  assert.equal(g.hubs[0].name, '__proto__');
  assert.equal(g.hubs[0].degree, 4);
  assert.equal(g.hubs.length, 3);
  assert.deepEqual(g.islands, ['constructor']);
  assert.equal(Object.getPrototypeOf(g.adjacency), null);
  assert.deepEqual(g.adjacency.a, ['__proto__', 'b']);
});

test('示例数据:18 张、3 草稿、2 孤岛、1 张引用草稿、2 张超长定义', () => {
  const cards = globalThis.CARD_SAMPLE.cards;
  assert.equal(cards.length, 18);
  assert.equal(cards.filter((c) => c.status === '草稿').length, 3);
  assert.equal(C.linkGraph(cards).islands.length, 2);
  assert.equal(cards.filter((c) => !C.qualityGate(c, cards).clear).length, 1);
  assert.equal(cards.filter((c) => C.len(c.def) > 60).length, 2);
  assert.equal(C.validateState(cards).ok, true);
  assert.equal(C.validateImport(C.serialize(cards)).ok, true);
});

test('reviewQueue:最久未重写在前,同日按创建日期,n 截断', () => {
  const a = card({ name: 'a', created: '2026-01-01', rewritten: '2026-09-01' });
  const b = card({ name: 'b', created: '2026-03-01', rewritten: '' });
  const c = card({ name: 'c', created: '2026-02-01', rewritten: '' });
  const d = card({ name: 'd', created: '2026-08-01', rewritten: '' });
  const q = C.reviewQueue([a, b, c, d], 3, '2026-10-20');
  assert.deepEqual(q.map((x) => x.name), ['c', 'b', 'd']);
  assert.equal(C.reviewQueue([a, b, c, d], 0, '2026-10-20').length, 0);
  assert.equal(C.reviewQueue([a, b], 5, '2026-10-20').length, 2);
  assert.equal(C.reviewQueue([a, b, c, d, a, b], undefined, '2026-10-20').length, 5);
});

test('reviewQueue 不修改传入数组', () => {
  const list = [card({ name: 'x', created: '2026-05-01' }), card({ name: 'y', created: '2026-01-01' })];
  C.reviewQueue(list, 5, '2026-10-20');
  assert.deepEqual(list.map((x) => x.name), ['x', 'y']);
});

test('rewrite:记录日期与旧版本、状态变已重写、最多保留 3 版且新的在前', () => {
  let c = card({ def: 'v0', created: '2026-01-01' });
  const days = ['2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01'];
  days.forEach((d, i) => { c = C.rewrite(c, 'v' + (i + 1), d); });
  assert.equal(c.def, 'v4');
  assert.equal(c.rewritten, '2026-05-01');
  assert.equal(c.status, '已重写');
  assert.deepEqual(c.versions.map((v) => v.def), ['v3', 'v2', 'v1']);
  assert.deepEqual(c.versions.map((v) => v.date), ['2026-04-01', '2026-03-01', '2026-02-01']);
});

test('rewrite:不改原对象;空定义或坏日期抛错', () => {
  const c = card({ def: '旧', created: '2026-01-01' });
  const r = C.rewrite(c, ' 新 ', '2026-10-20');
  assert.equal(c.def, '旧');
  assert.equal(c.versions.length, 0);
  assert.equal(r.def, '新');
  assert.equal(r.versions[0].date, '2026-01-01');
  assert.throws(() => C.rewrite(c, '  ', '2026-10-20'), TypeError);
  assert.throws(() => C.rewrite(c, '新', '2026-13-01'), TypeError);
});

test('search:名、定义、反例都能搜到,不区分大小写,多词需都出现', () => {
  const a = card({ name: 'Attention', def: '有限的心智资源', notNot: ['不是时间'] });
  const b = card({ name: '复利', def: '收益再投入', notNot: ['不是线性增长'] });
  assert.deepEqual(C.search([a, b], 'attention').map((x) => x.name), ['Attention']);
  assert.deepEqual(C.search([a, b], '心智').map((x) => x.name), ['Attention']);
  assert.deepEqual(C.search([a, b], '线性').map((x) => x.name), ['复利']);
  assert.deepEqual(C.search([a, b], '复利 线性').map((x) => x.name), ['复利']);
  assert.deepEqual(C.search([a, b], '复利 心智'), []);
  assert.equal(C.search([a, b], '   ').length, 2);
  assert.equal(C.search([a, b], '问题?').length, 0);
});

test('CSV:公式防护、引号/逗号/换行转义,单独的 - 或 + 不加前缀', () => {
  const rows = [
    card({ name: '=SUM(A1)', def: '+1', source: '@cmd', notNot: ['-2'] }),
    card({ name: '-', def: '+', source: 'a,"b"\nc' })
  ];
  const csv = C.toCsv(rows);
  assert.match(csv, /'=SUM\(A1\),'\+1,'-2,问题\?,,'@cmd/);
  assert.match(csv, /\r\n-,\+,/);
  assert.ok(csv.includes('"a,""b""\nc"'));
  assert.equal(C.toCsv([]).split('\r\n')[0], '概念名,一句话定义,不是什么,能回答的问题,关联概念,来源,状态,创建日期,最近重写日期');
});

test('Markdown:单张与全部;多行字段压成一行,不能借换行造出标题', () => {
  const c = card({ name: 'A', def: '定义\n# 假标题', links: ['B'], source: '书', rewritten: '2026-10-01' });
  const one = C.toMarkdown(c);
  assert.ok(one.startsWith('## A\n'));
  assert.ok(!/^# 假标题/m.test(one));
  assert.match(one, /\[\[B\]\]/);
  assert.match(one, /最近重写:2026-10-01/);
  const all = C.toMarkdown([c, card({ name: 'Z' })]);
  assert.ok(all.startsWith('# 概念卡片库(2 张)'));
  assert.equal((all.match(/^## /gm) || []).length, 2);
});

const goodBackup = () => ({ app: 'conceptcards', version: 1, cards: [card({ name: 'A' }), card({ name: 'B', links: ['A'] })] });

test('validateImport:合法备份往返', () => {
  const b = goodBackup();
  const r = C.validateImport(JSON.stringify(b));
  assert.equal(r.ok, true);
  assert.equal(r.cards.length, 2);
  assert.equal(C.validateImport(C.serialize(r.cards)).ok, true);
});

test('validateImport:状态枚举不合法 -> 整份拒绝而不是改成草稿', () => {
  const b = goodBackup();
  b.cards[1].status = 'done';
  const r = C.validateImport(b);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /状态必须是/);
  assert.equal(r.cards, undefined);
});

test('validateImport:重复名、重复 id、非 http(s) 网址、类型错误、坏 JSON 全部拒绝', () => {
  let b = goodBackup(); b.cards[1].name = 'A';
  assert.match(C.validateImport(b).errors.join(), /概念名重复/);
  b = goodBackup(); b.cards[1].id = b.cards[0].id;
  assert.match(C.validateImport(b).errors.join(), /id 重复/);
  b = goodBackup(); b.cards[0].source = 'javascript://x';
  assert.equal(C.validateImport(b).ok, false);
  b = goodBackup(); b.cards[0].source = 'file:///etc/passwd';
  assert.equal(C.validateImport(b).ok, false);
  b = goodBackup(); b.cards[0].source = '见 https://example.com/a 与 http://x.org';
  assert.equal(C.validateImport(b).ok, true);
  b = goodBackup(); b.cards[0].notNot = '不是数组';
  assert.equal(C.validateImport(b).ok, false);
  b = goodBackup(); b.cards[0].versions = [1, 2, 3, 4].map((i) => ({ def: 'x', date: '2026-01-0' + i }));
  assert.equal(C.validateImport(b).ok, false);
  assert.equal(C.validateImport('{坏').ok, false);
  assert.equal(C.validateImport({ app: 'other', version: 1, cards: [] }).ok, false);
  assert.equal(C.validateImport({ app: 'conceptcards', version: 2, cards: [] }).ok, false);
  assert.equal(C.validateImport([]).ok, false);
});

test('validateImport:自引用整份拒绝;关联不存在的卡只是警告', () => {
  let b = goodBackup(); b.cards[0].links = ['A'];
  assert.equal(C.validateImport(b).ok, false);
  b = goodBackup(); b.cards[0].links = ['尚未建卡'];
  const r = C.validateImport(b);
  assert.equal(r.ok, true);
  assert.match(r.warnings.join(), /尚未建卡/);
});

test('写入校验 = 读取校验:超长文本与大量条目保存后仍可读回', () => {
  const big = card({ name: 'N'.repeat(500), def: '长'.repeat(5000), notNot: Array.from({ length: 200 }, (_, i) => '反例' + i), source: 's'.repeat(20000) });
  assert.equal(C.validateState([big]).ok, true);
  const back = C.validateImport(C.serialize([big]));
  assert.equal(back.ok, true);
  assert.equal(back.cards[0].def.length, 5000);
});

test('upsertCard:新增卡后关联自动双向;去掉关联同步移除', () => {
  const a = card({ id: 'a', name: 'A' });
  let r = C.upsertCard([a], card({ id: 'b', name: 'B', links: ['A'] }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.cards.find((c) => c.name === 'A').links, ['B']);
  const b2 = Object.assign({}, r.cards.find((c) => c.id === 'b'), { links: [] });
  r = C.upsertCard(r.cards, b2);
  assert.deepEqual(r.cards.find((c) => c.name === 'A').links, []);
});

test('upsertCard:改名同步别处关联;同名、自引用拒绝且不改原数组', () => {
  const a = card({ id: 'a', name: 'A', links: ['B'] });
  const b = card({ id: 'b', name: 'B', links: ['A'] });
  const cards = [a, b];
  let r = C.upsertCard(cards, Object.assign({}, a, { name: 'A2' }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.cards.find((c) => c.id === 'b').links, ['A2']);
  r = C.upsertCard(cards, Object.assign({}, a, { name: 'B' }));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /同名/);
  r = C.upsertCard(cards, Object.assign({}, a, { links: ['A'] }));
  assert.equal(r.ok, false);
  assert.deepEqual(a.links, ['B']);
  assert.deepEqual(r.cards, cards);
});

test('removeCard:删除后别处的关联一并清掉', () => {
  const a = card({ id: 'a', name: 'A', links: ['B'] });
  const b = card({ id: 'b', name: 'B', links: ['A'] });
  const out = C.removeCard([a, b], 'a');
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].links, []);
});

test('?today 解析:合法日期生效,非法与自动进位回退,不抛错', () => {
  const fb = '2026-10-21';
  assert.equal(C.resolveToday('?today=2026-10-20', fb), '2026-10-20');
  assert.equal(C.resolveToday('?today=2026-02-30', fb), fb);
  assert.equal(C.resolveToday('?today=2026-13-01', fb), fb);
  assert.equal(C.resolveToday('?today=2026-1-5', fb), fb);
  assert.equal(C.resolveToday('?today=', fb), fb);
  assert.equal(C.resolveToday('', fb), fb);
  assert.equal(C.resolveToday(undefined, fb), fb);
  assert.equal(C.resolveToday('?today=2028-02-29', fb), '2028-02-29');
  assert.equal(C.resolveToday('?today=2027-02-29', fb), fb);
});

test('daysBetween', () => {
  assert.equal(C.daysBetween('2026-10-01', '2026-10-20'), 19);
  assert.equal(C.daysBetween('2026-02-28', '2026-03-01'), 1);
});

test('core.js 不依赖 document/window', () => {
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof globalThis.window, 'undefined');
});

/* ---------- Codex 审核修复:导入质量门、编辑走重写逻辑、依赖退回 ---------- */
test('导入:状态「可用」但定义引用草稿概念 -> 整份拒绝并说明原因;降为草稿后可导入', () => {
  const draft = card({ name: '心智模型', status: '草稿' });
  const usable = card({ name: '甲', def: '用心智模型判断', status: '可用' });
  const r = C.validateImport({ app: 'conceptcards', version: 1, cards: [draft, usable] });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /甲.*质量门.*依赖未定义概念:心智模型/);
  const fixed = C.validateImport({ app: 'conceptcards', version: 1, cards: [draft, Object.assign({}, usable, { status: '草稿' })] });
  assert.equal(fixed.ok, true);
  const rewrittenOk = C.validateImport({ app: 'conceptcards', version: 1, cards: [draft, Object.assign({}, usable, { status: '已重写' })] });
  assert.equal(rewrittenOk.ok, true);
});

test('settleGate:依赖草稿的「可用」卡退回草稿,并级联', () => {
  const d = card({ name: 'D', status: '草稿' });
  const b = card({ name: 'B', def: '建立在D之上', status: '可用' });
  const a = card({ name: 'A', def: '建立在B之上', status: '可用' });
  const out = C.settleGate([d, b, a]);
  assert.deepEqual(out.demoted.sort(), ['A', 'B']);
  assert.deepEqual(out.cards.map((c) => c.status), ['草稿', '草稿', '草稿']);
  assert.equal(C.validateImport(C.serialize(out.cards)).ok, true);
  assert.deepEqual(C.settleGate([a]).demoted, []);
});

test('upsertCard:新建草稿卡后,定义里提到它的「可用」卡自动退回草稿并报告', () => {
  const user = card({ id: 'u', name: '甲', def: '用乙来判断', status: '可用' });
  const r = C.upsertCard([user], card({ id: 'n', name: '乙', status: '草稿' }), '2026-10-20');
  assert.equal(r.ok, true);
  assert.deepEqual(r.demoted, ['甲']);
  assert.equal(r.cards.find((c) => c.id === 'u').status, '草稿');
  assert.equal(C.validateImport(C.serialize(r.cards)).ok, true);
});

test('upsertCard:直接设为「可用」但质量门未过 -> 拒绝', () => {
  const d = card({ id: 'd', name: '丙', status: '草稿' });
  const r = C.upsertCard([d], card({ id: 'x', name: '丁', def: '依赖丙', status: '可用' }), '2026-10-20');
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /质量门/);
});

test('upsertCard:编辑改了定义 -> 旧定义进历史、记录重写日期、状态变已重写', () => {
  const old = card({ id: 'e', name: 'E', def: '旧定义', status: '可用', created: '2026-01-01', rewritten: '2026-02-01', versions: [{ def: '更早', date: '2026-01-01' }] });
  const r = C.upsertCard([old], Object.assign({}, old, { def: '新定义', source: '改了来源' }), '2026-10-20');
  assert.equal(r.ok, true);
  const e = r.cards[0];
  assert.equal(e.def, '新定义');
  assert.equal(e.rewritten, '2026-10-20');
  assert.equal(e.status, '已重写');
  assert.deepEqual(e.versions, [{ def: '旧定义', date: '2026-02-01' }, { def: '更早', date: '2026-01-01' }]);
  assert.equal(e.source, '改了来源');
});

test('upsertCard:编辑忽略传入的旧版本数组、最多保留 3 版;不改定义则不动历史', () => {
  let c = card({ id: 'f', name: 'F', def: 'v0', created: '2026-01-01' });
  let cards = [c];
  ['v1', 'v2', 'v3', 'v4'].forEach((d, i) => {
    const r = C.upsertCard(cards, Object.assign({}, cards[0], { def: d, versions: [], rewritten: '' }), '2026-0' + (i + 2) + '-01');
    assert.equal(r.ok, true);
    cards = r.cards;
  });
  assert.deepEqual(cards[0].versions.map((v) => v.def), ['v3', 'v2', 'v1']);
  const same = C.upsertCard(cards, Object.assign({}, cards[0], { source: 'x' }), '2026-12-01');
  assert.deepEqual(same.cards[0].versions, cards[0].versions);
  assert.equal(same.cards[0].rewritten, cards[0].rewritten);
  assert.equal(same.cards[0].status, cards[0].status);
});

test('upsertCard:改定义的同时明确改了状态 -> 保留所选状态', () => {
  const old = card({ id: 'g', name: 'G', def: '旧', status: '草稿', created: '2026-01-01' });
  const r = C.upsertCard([old], Object.assign({}, old, { def: '新', status: '可用' }), '2026-10-20');
  assert.equal(r.ok, true);
  assert.equal(r.cards[0].status, '可用');
  assert.equal(r.cards[0].versions[0].def, '旧');
});

test('errorField:把校验错误文字对应到表单控件,门槛汇总行不对应控件', () => {
  assert.equal(C.errorField('概念名不能为空'), 'name');
  assert.equal(C.errorField('已有同名卡片:注意力'), 'name');
  assert.equal(C.errorField('一句话定义不能为空'), 'def');
  assert.equal(C.errorField('「不是什么」至少要有 1 条反例'), 'notNot');
  assert.equal(C.errorField('「能回答的问题」至少要有 1 条'), 'questions');
  assert.equal(C.errorField('缺少反例(不是什么)'), 'notNot');
  assert.equal(C.errorField('缺少它能回答的问题'), 'questions');
  assert.equal(C.errorField('依赖未定义概念:时间'), 'def');
  assert.equal(C.errorField('不能设为可用,质量门没有全过:'), 'status');
  assert.equal(C.errorField('关联概念必须是字符串列表'), 'links');
  assert.equal(C.errorField('完全无关的文字'), null);
  const r = C.upsertCard([], card({ name: '', def: '' }), '2026-10-20');
  assert.equal(r.ok, false);
  const fields = r.errors.map(C.errorField);
  assert.ok(fields.includes('name') && fields.includes('def'), JSON.stringify(fields));
});
