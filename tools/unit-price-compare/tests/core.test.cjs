'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');
require('../sample-data.js');
const S = globalThis.PROCURE_SAMPLE;

const q = (o) => Object.assign({ id: 'x', supplier: 'A', item: '面粉', group: 'g', currency: 'CNY', packPrice: 10, packCount: 1, unitQty: 1, unit: 'kg', note: '', date: '2026-10-01' }, o);

test('toBase 各单位换算与量纲', () => {
  assert.deepEqual(C.toBase(500, 'g'), { value: 0.5, dimension: 'mass' });
  assert.deepEqual(C.toBase(2, 'kg'), { value: 2, dimension: 'mass' });
  assert.deepEqual(C.toBase(900, 'mL'), { value: 0.9, dimension: 'volume' });
  assert.deepEqual(C.toBase(1.8, 'L'), { value: 1.8, dimension: 'volume' });
  assert.deepEqual(C.toBase(30, '件'), { value: 30, dimension: 'count' });
});

test('toBase 未知单位与非法数量返回 null,含原型键', () => {
  assert.equal(C.toBase(1, '斤'), null);
  assert.equal(C.toBase(1, '__proto__'), null);
  assert.equal(C.toBase(1, 'constructor'), null);
  assert.equal(C.toBase(0, 'kg'), null);
  assert.equal(C.toBase(-1, 'kg'), null);
  assert.equal(C.toBase(NaN, 'kg'), null);
  assert.equal(C.toBase(1, undefined), null);
});

test('unitPrice 正常计算并保留 4 位小数', () => {
  const r = C.unitPrice(q({ packPrice: 66, packCount: 10, unitQty: 500, unit: 'g' }));
  assert.equal(r.ok, true);
  assert.equal(r.value, 13.2);
  assert.equal(r.baseUnit, 'kg');
  assert.equal(C.unitPrice(q({ packPrice: 10, packCount: 3, unitQty: 1, unit: 'kg' })).value, 3.3333);
});

test('unitPrice 除零与缺参数保护', () => {
  assert.equal(C.unitPrice(q({ packCount: 0 })).ok, false);
  assert.equal(C.unitPrice(q({ unitQty: 0 })).ok, false);
  assert.equal(C.unitPrice(q({ unitQty: null })).reason, '缺每件净含量');
  assert.equal(C.unitPrice(q({ packCount: null })).reason, '缺每包件数');
  assert.equal(C.unitPrice(q({ unit: null })).reason, '缺含量单位');
  assert.equal(C.unitPrice(q({ unit: '斤' })).reason, '含量单位无法识别');
  assert.equal(C.unitPrice(q({ packPrice: 0 })).ok, false);
});

test('rank 升序与相对最低价百分比', () => {
  const qs = [
    q({ id: '1', supplier: 'B', packPrice: 30, unitQty: 10 }),
    q({ id: '2', supplier: 'A', packPrice: 20, unitQty: 10 }),
    q({ id: '3', supplier: 'C', packPrice: 40, unitQty: 10 })
  ];
  const r = C.rank(qs, 'g');
  const rows = r.partitions[0].rows;
  assert.deepEqual(rows.map(x => x.quote.supplier), ['A', 'B', 'C']);
  assert.deepEqual(rows.map(x => x.pctOfMin), [100, 150, 200]);
  assert.equal(rows[0].isMin, true);
  assert.equal(rows[1].isMin, false);
  assert.deepEqual(rows.map(x => x.rank), [1, 2, 3]);
});

test('rank 不同量纲不互相比较', () => {
  const r = C.rank([q({ id: '1', unit: 'kg' }), q({ id: '2', supplier: 'B', unit: 'L' })], 'g');
  assert.equal(r.partitions.length, 2);
  assert.ok(r.partitions.every(p => p.rows.length === 1 && p.rows[0].pctOfMin === 100));
  assert.deepEqual(r.partitions.map(p => p.dimension).sort(), ['mass', 'volume']);
});

test('rank 不同币种分别排名', () => {
  const r = C.rank([q({ id: '1', currency: 'CNY', packPrice: 50 }), q({ id: '2', supplier: 'B', currency: 'USD', packPrice: 5 })], 'g');
  assert.equal(r.partitions.length, 2);
  assert.deepEqual(r.partitions.map(p => p.currency), ['CNY', 'USD']);
});

test('rank 缺参数不排名,且只取每家最近一条', () => {
  const qs = [
    q({ id: '1', supplier: 'A', packPrice: 10, date: '2026-09-01' }),
    q({ id: '2', supplier: 'A', packPrice: 99, date: '2026-10-01' }),
    q({ id: '3', supplier: 'B', item: '残缺', unitQty: null })
  ];
  const r = C.rank(qs, 'g');
  assert.equal(r.partitions[0].rows.length, 1);
  assert.equal(r.partitions[0].rows[0].unitPrice, 99);
  assert.equal(r.missing.length, 1);
  assert.equal(r.missing[0].reason, '缺每件净含量');
});

test('rank 规格组名为 __proto__ 不出错', () => {
  const r = C.rank([q({ group: '__proto__' })], '__proto__');
  assert.equal(r.partitions[0].rows.length, 1);
  assert.equal(C.rank([], 'constructor').partitions.length, 0);
});

test('priceHistory 按日期排序并计算涨跌幅', () => {
  const qs = [
    q({ id: '2', packPrice: 11.5, date: '2026-10-10' }),
    q({ id: '1', packPrice: 10, date: '2026-09-05' }),
    q({ id: '3', supplier: 'B', packPrice: 1 })
  ];
  const h = C.priceHistory(qs, 'A', '面粉');
  assert.deepEqual(h.map(e => e.quote.id), ['1', '2']);
  assert.equal(h[0].changePct, null);
  assert.equal(h[1].changePct, 15);
});

test('priceHistory 阈值警示:严格大于才警示,可调', () => {
  const qs = [q({ id: '1', packPrice: 10, date: '2026-09-01' }), q({ id: '2', packPrice: 11, date: '2026-10-01' }), q({ id: '3', packPrice: 9, date: '2026-10-02' })];
  assert.equal(C.priceHistory(qs, 'A', '面粉')[1].warn, false);
  assert.equal(C.priceHistory(qs, 'A', '面粉', 5)[1].warn, true);
  const down = C.priceHistory(qs, 'A', '面粉', 5)[2];
  assert.equal(down.changePct, -18.2);
  assert.equal(down.warn, false);
});

test('priceHistory 缺参数条目不参与涨跌基准,换币种不比较', () => {
  const qs = [
    q({ id: '1', packPrice: 10, date: '2026-09-01' }),
    q({ id: '2', unitQty: null, date: '2026-09-10' }),
    q({ id: '3', packPrice: 12, date: '2026-09-20' }),
    q({ id: '4', packPrice: 5, currency: 'USD', date: '2026-10-01' })
  ];
  const h = C.priceHistory(qs, 'A', '面粉');
  assert.equal(h[1].unitPrice, null);
  assert.equal(h[2].changePct, 20);
  assert.equal(h[3].changePct, null);
});

test('parseBatch 正常行与默认值', () => {
  const r = C.parseBatch('老李 | 鸡蛋 | 24 | 1 | 30 | 件\n\n绿源|面粉|66|10|500|g|面粉', { group: '鸡蛋', currency: 'USD', date: '2026-10-20' });
  assert.equal(r.errors.length, 0);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].group, '鸡蛋');
  assert.equal(r.rows[0].currency, 'USD');
  assert.equal(r.rows[1].group, '面粉');
  assert.equal(r.rows[1].unit, 'g');
});

test('parseBatch 错误行带行号(逐行报告)', () => {
  const r = C.parseBatch('A|b|10|1|1|kg\nA|b|abc|1|1|kg\nA|b|10|1\nA|b|10|1|1|斤\nA|b|10|0|1|kg\n|b|10|1|1|kg', { group: 'g' });
  assert.equal(r.rows.length, 1);
  assert.deepEqual(r.errors.map(e => e.line), [2, 3, 4, 5, 6]);
});

test('parseBatch 后三列留空记为缺参数;无规格组报错', () => {
  const r = C.parseBatch('A|b|10|||', { group: 'g' });
  assert.equal(r.rows[0].packCount, null);
  assert.equal(r.rows[0].unit, null);
  assert.equal(C.unitPrice(r.rows[0]).ok, false);
  assert.equal(C.parseBatch('A|b|10|1|1|kg', {}).errors.length, 1);
});

test('CSV 公式防护:=+-@ 开头加单引号,单独 - 与 + 不算', () => {
  assert.equal(C.guard('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(C.guard('+86'), "'+86");
  assert.equal(C.guard('-1'), "'-1");
  assert.equal(C.guard('@x'), "'@x");
  assert.equal(C.guard('-'), '-');
  assert.equal(C.guard('+'), '+');
  assert.equal(C.guard('正常'), '正常');
  const csv = C.toCsv(['a', 'b'], [['=1+1', 'x,"y"'], [-5, null]]);
  assert.equal(csv, "a,b\r\n'=1+1,\"x,\"\"y\"\"\"\r\n-5,\r\n");
});

test('toMarkdown 转义竖线并防公式', () => {
  const md = C.toMarkdown(['名', '值'], [['a|b', '=cmd'], ['line1\nline2', 1]], '标题');
  assert.ok(md.startsWith('# 标题\n\n| 名 | 值 |\n| --- | --- |'));
  assert.ok(md.includes('a\\|b'));
  assert.ok(md.includes("'=cmd"));
  assert.ok(md.includes('line1 line2'));
});

test('rankTable 含最低价与缺参数行', () => {
  const t = C.rankTable([C.rank([q({ id: '1' }), q({ id: '2', supplier: 'B', unitQty: null })], 'g')]);
  assert.equal(t.rows.length, 2);
  assert.equal(t.rows[0][10], '最低价');
  assert.ok(String(t.rows[1][10]).startsWith('缺参数'));
  assert.equal(t.headers.length, t.rows[0].length);
});

test('validateImport 接受示例数据', () => {
  const r = C.validateImport(JSON.parse(JSON.stringify(S)));
  assert.equal(r.ok, true);
  assert.equal(r.data.quotes.length, 18);
});

test('validateImport 整份拒绝:重复 id / 枚举 / 类型 / 日期', () => {
  const good = JSON.parse(JSON.stringify(S));
  const dup = JSON.parse(JSON.stringify(good)); dup.quotes[1].id = dup.quotes[0].id;
  assert.equal(C.validateImport(dup).ok, false);
  const cur = JSON.parse(JSON.stringify(good)); cur.quotes[0].currency = 'XXX';
  assert.equal(C.validateImport(cur).ok, false);
  const unit = JSON.parse(JSON.stringify(good)); unit.quotes[0].unit = '斤';
  assert.equal(C.validateImport(unit).ok, false);
  const price = JSON.parse(JSON.stringify(good)); price.quotes[0].packPrice = '24';
  assert.equal(C.validateImport(price).ok, false);
  const date = JSON.parse(JSON.stringify(good)); date.quotes[0].date = '2026-02-30';
  assert.equal(C.validateImport(date).ok, false);
  const ver = JSON.parse(JSON.stringify(good)); ver.version = 2;
  assert.equal(C.validateImport(ver).ok, false);
  assert.equal(C.validateImport(null).ok, false);
  assert.equal(C.validateImport([]).ok, false);
  assert.equal(C.validateImport({ version: 1, quotes: 'x' }).ok, false);
  const th = JSON.parse(JSON.stringify(good)); th.threshold = -1;
  const res = C.validateImport(th);
  assert.equal(res.ok, false);
  assert.ok(res.errors.length >= 1);
});

test('?today 固定今天,非法回退真实今天且不抛错', () => {
  const now = new Date(2026, 5, 7);
  assert.equal(C.resolveToday('?today=2026-10-20', now), '2026-10-20');
  assert.equal(C.resolveToday('?today=2026-13-40', now), '2026-06-07');
  assert.equal(C.resolveToday('?today=abc', now), '2026-06-07');
  assert.equal(C.resolveToday('', now), '2026-06-07');
  assert.equal(C.resolveToday(undefined, now), '2026-06-07');
});

test('示例数据业务特征:18 条、15% 涨价、缺参数、双币种', () => {
  assert.equal(S.quotes.length, 18);
  const h = C.priceHistory(S.quotes, '老李批发', '鲜鸡蛋(30枚盘装)');
  assert.equal(h[1].changePct, 15);
  assert.equal(h[1].warn, true);
  const flour = C.rank(S.quotes, '面粉');
  assert.equal(flour.partitions.length, 2);
  assert.equal(flour.missing.length, 1);
  const oil = C.rank(S.quotes, '食用油');
  assert.equal(oil.partitions[0].rows[0].quote.supplier, '鲜达配送');
  assert.ok(!S.quotes.some(x => x.id === C.newId(S.quotes)));
});

test('[修复P0] rank:同供应商同品名新增 USD 报价,原 CNY 报价仍在各自分区', () => {
  const r = C.rank([q({ id: '1', currency: 'CNY', packPrice: 100, date: '2026-09-01' }), q({ id: '2', currency: 'USD', packPrice: 15, date: '2026-10-01' })], 'g');
  assert.deepEqual(r.partitions.map(p => p.currency), ['CNY', 'USD']);
  assert.equal(r.partitions[0].rows[0].unitPrice, 100);
});

test('[修复P0] rank:同供应商同品名换量纲后,两个量纲分区各保留最新报价', () => {
  const r = C.rank([q({ id: '1', unit: 'kg', date: '2026-09-01' }), q({ id: '2', unit: 'L', date: '2026-10-01' })], 'g');
  assert.equal(r.partitions.length, 2);
});

test('[修复P0] priceHistory:CNY 100 → USD → CNY 115 仍显示 15% 涨幅', () => {
  const h = C.priceHistory([
    q({ id: '1', packPrice: 100, date: '2026-09-01' }),
    q({ id: '2', packPrice: 15, currency: 'USD', date: '2026-09-15' }),
    q({ id: '3', packPrice: 115, date: '2026-10-01' })], 'A', '面粉');
  assert.equal(h[1].changePct, null);
  assert.equal(h[2].changePct, 15);
  assert.equal(h[2].warn, true);
});

test('[修复P0] rank:单位价舍入为 0 时百分比不是 NaN/Infinity', () => {
  const r = C.rank([q({ id: '1', packPrice: 0.01, unitQty: 1000 }), q({ id: '2', supplier: 'B', packPrice: 0.02, unitQty: 1000 })], 'g');
  const rows = r.partitions[0].rows;
  assert.equal(rows[0].unitPrice, 0);
  assert.deepEqual(rows.map(x => x.pctOfMin), [100, 200]);
  assert.ok(rows.every(x => Number.isFinite(x.pctOfMin)));
});

test('[修复P0] newId:现有 ID 为 q9007199254740992 时不重复,连续生成唯一', () => {
  const list = [q({ id: 'q9007199254740992' })];
  const seen = new Set(['q9007199254740992']);
  for (let i = 0; i < 500; i++) {
    const id = C.newId(list);
    assert.ok(!seen.has(id), '重复 ID ' + id);
    seen.add(id); list.push(q({ id }));
  }
  const v = C.validateImport({ version: 1, quotes: list.map(x => Object.assign({}, x)) });
  assert.equal(v.ok, true);
});

test('[修复P1] priceHistory:10.04% 涨幅按未舍入值判阈值并警示,展示值舍入', () => {
  const h = C.priceHistory([q({ id: '1', packPrice: 10, date: '2026-09-01' }), q({ id: '2', packPrice: 11.004, date: '2026-10-01' })], 'A', '面粉');
  assert.equal(h[1].changePct, 10);
  assert.equal(h[1].warn, true);
});

test('[修复P1] batchAccept:任一行有错则整批不接受', () => {
  const bad = C.batchAccept('A|b|10|1|1|kg\nA|b|abc|1|1|kg', { group: 'g' });
  assert.equal(bad.ok, false);
  assert.equal(bad.rows.length, 0);
  assert.equal(bad.errors[0].line, 2);
  const good = C.batchAccept('A|b|10|1|1|kg\nB|b|11|1|1|kg', { group: 'g' });
  assert.equal(good.ok, true);
  assert.equal(good.rows.length, 2);
  assert.equal(C.batchAccept('', { group: 'g' }).ok, false);
});

test('priceHistory 记录涨跌幅所用的上一条同币种同量纲报价(CNY 10 → USD 2 → CNY 12)', () => {
  const h = C.priceHistory([
    q({ id: '1', date: '2026-10-01', packPrice: 10 }),
    q({ id: '2', date: '2026-10-05', packPrice: 2, currency: 'USD' }),
    q({ id: '3', date: '2026-10-10', packPrice: 12 })
  ], 'A', '面粉', 10);
  const last = h[2];
  assert.equal(last.changePct, 20);
  assert.equal(last.warn, true);
  assert.equal(last.prevUnitPrice, 10);
  assert.equal(last.prevQuote.id, '1');
  assert.equal(h[1].changePct, null);
  assert.equal(h[1].prevUnitPrice, null);
  assert.equal(h[0].prevQuote, null);
});

test('rank 同时给出「占最低价的百分比」和「比最低价贵多少」', () => {
  const r = C.rank([q({ id: '1', packPrice: 10 }), q({ id: '2', supplier: 'B', packPrice: 12 })], 'g');
  const rows = r.partitions[0].rows;
  assert.equal(rows[0].pctOfMin, 100);
  assert.equal(rows[0].overMinPct, 0);
  assert.equal(rows[1].pctOfMin, 120);
  assert.equal(rows[1].overMinPct, 20);
  const t = C.rankTable([r]);
  assert.ok(t.headers.some(h => /最低价=100/.test(h)) && t.headers.some(h => /比最低价贵/.test(h)));
});

test('unitPrice 缺参数时指出缺哪个字段,供「补齐参数」聚焦', () => {
  assert.equal(C.unitPrice(q({ packCount: null })).field, 'count');
  assert.equal(C.unitPrice(q({ unitQty: null })).field, 'qty');
  assert.equal(C.unitPrice(q({ unit: null })).field, 'unit');
  assert.equal(C.unitPrice(q({ unit: 'xx' })).field, 'unit');
  assert.equal(C.unitPrice(q({ packPrice: null })).field, 'price');
  assert.equal(C.unitPrice(q()).field, undefined);
  const r = C.rank([q({ unitQty: null })], 'g');
  assert.equal(r.missing[0].field, 'qty');
});

test('replaceScope:报价、偏离默认的阈值、表单草稿、批量粘贴草稿、正在编辑都算用户数据', () => {
  assert.equal(C.replaceScope({ quotes: [], threshold: 10 }, {}).any, false);
  assert.equal(C.replaceScope({ quotes: [], threshold: 15 }, {}).any, true);
  assert.equal(C.replaceScope({ quotes: [], threshold: 10 }, { formDraft: true }).any, true);
  assert.equal(C.replaceScope({ quotes: [], threshold: 10 }, { batchDraft: true }).any, true);
  const sc = C.replaceScope({ quotes: [q()], threshold: 15 }, { formDraft: true });
  const d = C.describeScope(sc);
  assert.ok(d.includes('1 条报价') && d.includes('涨幅阈值 15%') && d.includes('表单草稿'));
});

test('validateImport 保留 sample 标记并拒绝非布尔;导出表带数据来源列', () => {
  const base = { version: 1, threshold: 10, quotes: [q({ id: 'a' })] };
  assert.equal(C.validateImport(Object.assign({ sample: true }, base)).data.sample, true);
  assert.equal(C.validateImport(base).data.sample, false);
  assert.equal(C.validateImport(Object.assign({ sample: 1 }, base)).ok, false);
  assert.equal(S.sample, true);
  const r = C.rank([q({ id: '1' })], 'g');
  const t = C.rankTable([r], { sample: true });
  assert.equal(t.headers[t.headers.length - 1], '数据来源');
  assert.equal(t.rows[0][t.rows[0].length - 1], '合成示例');
  assert.ok(!C.rankTable([r]).headers.includes('数据来源'));
  const qt = C.quotesTable([q()], { sample: true });
  assert.equal(qt.rows[0][qt.rows[0].length - 1], '合成示例');
  assert.ok(C.toMarkdown(['a'], [['1']], '标题', '数据来源:合成示例').includes('数据来源:合成示例'));
});

test('deleteImpact:说明删除会让比价排名和后续涨跌幅怎么变', () => {
  const list = [
    q({ id: '1', date: '2026-10-01', packPrice: 10 }),
    q({ id: '2', date: '2026-10-10', packPrice: 12 }),
    q({ id: '3', supplier: 'B', date: '2026-10-08', packPrice: 11 })
  ];
  const first = C.deleteImpact(list, '1');
  assert.equal(first.affectsRank, false);
  assert.equal(first.laterShift, 1);
  const latest = C.deleteImpact(list, '2');
  assert.equal(latest.affectsRank, true);
  assert.equal(latest.sameKeyOthers, 1);
  assert.ok(C.describeDelete(latest).includes('比价排名'));
  assert.ok(C.describeDelete(first).includes('相对上次'));
  const only = C.deleteImpact(list, '3');
  assert.equal(only.sameKeyOthers, 0);
  assert.ok(C.describeDelete(only).includes('不再出现'));
  assert.equal(C.deleteImpact(list, 'nope'), null);
});

test('fixedToday:只有合法的 ?today 才算固定', () => {
  assert.equal(C.fixedToday('?today=2026-10-20'), '2026-10-20');
  assert.equal(C.fixedToday('?today=2026-02-30'), null);
  assert.equal(C.fixedToday(''), null);
});
