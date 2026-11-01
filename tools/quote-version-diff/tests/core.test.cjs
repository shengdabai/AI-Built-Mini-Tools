'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const H = '项目编码,项目名称,数量,单位,单价,备注\n';
function run(oldCsv, newCsv) {
  const o = C.parseTable(H + oldCsv), n = C.parseTable(H + newCsv);
  const m = C.guessMapping(o.headers);
  return C.diffQuotes(o, n, m);
}

test('parseTable 处理引号、千分位逗号、CRLF、BOM 与行号', () => {
  const t = C.parseTable('﻿项目编码,项目名称,数量\r\nA1,"乳胶漆(两遍,含腻子)",10\r\n\r\nA2,"含""引号""",2\r\n');
  assert.deepEqual(t.headers, ['项目编码', '项目名称', '数量']);
  assert.equal(t.rows.length, 2);
  assert.equal(t.rows[0][1], '乳胶漆(两遍,含腻子)');
  assert.equal(t.rows[1][1], '含"引号"');
  assert.deepEqual(t.lines, [2, 4]);
});

test('parseTable 识别制表符并处理空输入', () => {
  const t = C.parseTable('编码\t名称\n1\t含,逗号\n');
  assert.equal(t.delimiter, '\t');
  assert.equal(t.rows[0][1], '含,逗号');
  assert.deepEqual(C.parseTable('   ').rows, []);
});

test('guessMapping 按表头猜列,英文表头也能识别', () => {
  assert.deepEqual(C.guessMapping(['项目编码', '项目名称', '数量', '单位', '单价', '备注']), { code: 0, name: 1, qty: 2, unit: 3, price: 4, note: 5 });
  const m = C.guessMapping(['Code', 'Description', 'Qty', 'Unit', 'Unit Price']);
  assert.equal(m.code, 0); assert.equal(m.name, 1); assert.equal(m.qty, 2); assert.equal(m.unit, 3); assert.equal(m.price, 4); assert.equal(m.note, -1);
});

test('normalizeNumber 处理货币、千分位、全角、括号负数与非法值', () => {
  assert.equal(C.normalizeNumber('¥1,500.50'), 1500.5);
  assert.equal(C.normalizeNumber('１２０'), 120);
  assert.equal(C.normalizeNumber('(5)'), -5);
  assert.equal(C.normalizeNumber('-3.5'), -3.5);
  assert.equal(C.normalizeNumber('200元'), 200);
  assert.equal(C.normalizeNumber(''), null);
  assert.equal(C.normalizeNumber('12abc'), null);
  assert.equal(C.normalizeNumber('1,5'), null);
});

test('检测新增与删除,并计入合计', () => {
  const d = run('A1,甲,1,项,100,\nA2,乙,2,个,50,', 'A1,甲,1,项,100,\nA3,丙,3,个,10,');
  assert.equal(d.ok, true);
  assert.deepEqual(d.added.map(x => x.code), ['A3']);
  assert.deepEqual(d.removed.map(x => x.code), ['A2']);
  assert.equal(d.unchanged, 1);
  assert.equal(d.totals.oldTotal, 200);
  assert.equal(d.totals.newTotal, 130);
  assert.equal(d.totals.delta, -70);
  assert.equal(d.totals.percent, -35);
});

test('数量变更:字段与 deltaAmount', () => {
  const d = run('A1,地砖铺贴,80,㎡,120,', 'A1,地砖铺贴,95,㎡,120,');
  assert.equal(d.changed.length, 1);
  assert.deepEqual(d.changed[0].fields, [{ field: 'qty', from: 80, to: 95 }]);
  assert.equal(d.changed[0].deltaAmount, 1800);
});

test('单价变更与单位变更各自只产生对应字段', () => {
  const p = run('A1,木地板,45,㎡,260,', 'A1,木地板,45,㎡,280,');
  assert.deepEqual(p.changed[0].fields.map(f => f.field), ['price']);
  assert.equal(p.changed[0].deltaAmount, 900);
  const u = run('A1,橱柜,4.2,延米,1800,', 'A1,橱柜,4.2,米,1800,');
  assert.deepEqual(u.changed[0].fields, [{ field: 'unit', from: '延米', to: '米' }]);
  assert.equal(u.changed[0].deltaAmount, 0);
});

test('名称变更只提示:nameOnly 且金额影响为 0', () => {
  const d = run('A1,防水,18,㎡,85,', 'A1,防水(含闭水试验),18,㎡,85,');
  assert.equal(d.changed[0].nameOnly, true);
  assert.equal(d.changed[0].deltaAmount, 0);
  assert.equal(d.totals.delta, 0);
});

test('金额四舍五入到分,避免浮点误差', () => {
  const d = run('A1,甲,4.2,m,1800.005,', 'A1,甲,4.2,m,1800.005,\nA2,乙,3,个,0.1,');
  assert.equal(d.totals.oldTotal, 7560.02);
  assert.equal(d.added[0].amount, 0.3);
  assert.equal(d.totals.delta, 0.3);
});

test('重复编码阻止计算并报行号(含大小写与空白变体)', () => {
  const d = run('A1,甲,1,项,1,', 'A1,甲,1,项,1,\nA2,乙,1,项,1,\n a2 ,丙,1,项,1,');
  assert.equal(d.ok, false);
  assert.equal(d.totals, null);
  assert.equal(d.errors.length, 1);
  assert.equal(d.errors[0].type, 'duplicate');
  assert.equal(d.errors[0].side, 'new');
  assert.equal(d.errors[0].line, 4);
  assert.match(d.errors[0].message, /新版第 4 行.*重复.*第 3 行/);
});

test('缺编码、无编码列、非法数字都阻止计算', () => {
  const noCode = C.diffQuotes([['x']], [['x']], { code: -1 });
  assert.equal(noCode.ok, false); assert.equal(noCode.errors[0].type, 'no-code-column');
  const miss = run('A1,甲,1,项,1,', ',乙,1,项,1,');
  assert.equal(miss.errors[0].type, 'missing-code');
  const bad = run('A1,甲,abc,项,1,', 'A1,甲,1,项,1,');
  assert.equal(bad.ok, false); assert.equal(bad.errors[0].type, 'bad-number');
});

test('旧合计为 0 时百分比为 null 而不是除零', () => {
  const d = run('A1,甲,0,项,100,', 'A1,甲,2,项,100,');
  assert.equal(d.totals.oldTotal, 0);
  assert.equal(d.totals.delta, 200);
  assert.equal(d.totals.percent, null);
  assert.match(C.explain(d), /不计算百分比/);
});

test('按名分组用 Map:编码 __proto__ / constructor 不出问题', () => {
  const d = run('__proto__,甲,1,项,10,\nconstructor,乙,1,项,5,', '__proto__,甲,2,项,10,\nconstructor,乙,1,项,5,');
  assert.equal(d.ok, true);
  assert.equal(d.changed.length, 1);
  assert.equal(d.changed[0].code, '__proto__');
  assert.equal(d.totals.delta, 10);
});

test('explain 文案:新增 / 删除 / 调整三段与示例句', () => {
  const d = run(
    'A1,地砖铺贴,80,㎡,120,\nA2,旧窗拆除,6,扇,150,\nA3,木地板,45,㎡,260,',
    'A1,地砖铺贴,95,㎡,120,\nA3,木地板,45,㎡,280,\nB1,阳台封窗,1,项,4800,'
  );
  const md = C.explain(d);
  assert.ok(md.indexOf('## 新增') < md.indexOf('## 删除') && md.indexOf('## 删除') < md.indexOf('## 调整'));
  assert.match(md, /- 地砖铺贴:数量 80 → 95 ㎡,单价不变,增加 ¥1,800/);
  assert.match(md, /- 木地板:数量不变,单价 ¥260 → ¥280,增加 ¥900/);
  assert.match(md, /- 阳台封窗:新增 1 项,单价 ¥4,800,增加 ¥4,800/);
  assert.match(md, /- 旧窗拆除:删除\(原 6 扇,单价 ¥150\),减少 ¥900/);
});

test('explain「只列影响金额的项」过滤改名与纯单位变更', () => {
  const d = run(
    'A1,防水,18,㎡,85,\nA2,橱柜,4,延米,100,\nA3,砖,1,个,10,',
    'A1,防水(含试验),18,㎡,85,\nA2,橱柜,4,米,100,\nA3,砖,2,个,10,'
  );
  const all = C.explain(d), only = C.explain(d, { onlyAmount: true });
  assert.match(all, /仅改名称,金额不变/);
  assert.match(all, /单位 延米 → 米/);
  assert.doesNotMatch(only, /仅改名称/);
  assert.doesNotMatch(only, /延米/);
  assert.match(only, /砖:数量 1 → 2 个,单价不变,增加 ¥10/);
  const same = C.explain(run('A1,甲,1,项,1,', 'A1,甲,1,项,1,'), { onlyAmount: true });
  assert.match(same, /没有影响金额的变更/);
});

test('toCsv 公式防护:= + - @ 开头加单引号,单独的 - + 与数字不动', () => {
  const csv = C.toCsv([['=SUM(A1)', '+1', '-2x', '@cmd', '-', '+', '正常', -1500, 'a,b', '含"引号"']]);
  assert.equal(csv, "'=SUM(A1),'+1,'-2x,'@cmd,-,+,正常,-1500,\"a,b\",\"含\"\"引号\"\"\"\r\n");
});

test('diffToCsv 导出行与合计,用户名称开头 = 被防护', () => {
  const d = run('A1,=HYPERLINK("x"),1,项,10,', 'A1,=HYPERLINK("x"),3,项,10,');
  const csv = C.diffToCsv(d);
  const lines = csv.trim().split('\r\n');
  assert.equal(lines[0], '类型,项目编码,项目名称,变更内容,旧金额,新金额,金额影响');
  assert.match(lines[1], /^调整,A1,"'=HYPERLINK\(""x""\)",数量 1 → 3,10,30,20$/);
  assert.equal(lines[2], '合计,,,,10,30,20');
});

test('确认记录:makeRecord 校验并按时间排序成版本链', () => {
  const d = run('A1,甲,1,项,100,', 'A1,甲,2,项,100,');
  assert.equal(C.makeRecord({ id: 'r', now: '2026-10-20T08:00:00Z', versionName: ' ', diff: d }).ok, false);
  assert.equal(C.makeRecord({ id: 'r', now: 'x', versionName: 'v2', diff: d, confirmed: true, confirmedDate: '2026-02-30' }).ok, false);
  const ok = C.makeRecord({ id: 'r2', now: '2026-10-20T09:00:00Z', versionName: 'v2', diff: d, confirmed: true, confirmedDate: '2026-10-21' });
  assert.equal(ok.ok, true);
  assert.equal(ok.record.delta, 100);
  assert.deepEqual(ok.record.counts, { added: 0, removed: 0, changed: 1 });
  const a = C.makeRecord({ id: 'r1', now: '2026-10-19T09:00:00Z', versionName: 'v1', diff: d }).record;
  const b = C.makeRecord({ id: 'r0', now: '2026-10-20T09:00:00Z', versionName: 'v2b', diff: d }).record;
  const sorted = C.sortRecords([ok.record, b, a]);
  assert.deepEqual(sorted.map(r => r.id), ['r1', 'r0', 'r2']);
});

test('validateImport 接受合法备份,拒绝类型/枚举/重复 id/非法日期', () => {
  const d = run('A1,甲,1,项,100,', 'A1,甲,2,项,100,');
  const r1 = C.makeRecord({ id: 'a', now: '2026-10-20T09:00:00Z', versionName: 'v1', diff: d, confirmed: true, confirmedDate: '2026-10-21' }).record;
  const r2 = C.makeRecord({ id: 'b', now: '2026-10-21T09:00:00Z', versionName: 'v2', diff: d }).record;
  const good = { app: 'quote-diff', version: 1, records: [r1, r2], draft: { oldText: '', newText: '', versionName: '' } };
  assert.equal(C.validateImport(good).ok, true);
  assert.equal(C.validateImport(null).ok, false);
  assert.equal(C.validateImport({ ...good, app: 'other' }).ok, false);
  const dup = C.validateImport({ ...good, records: [r1, { ...r2, id: 'a' }] });
  assert.equal(dup.ok, false); assert.match(dup.errors.join('|'), /重复/);
  const badType = C.validateImport({ ...good, records: [{ ...r1, delta: '100' }] });
  assert.equal(badType.ok, false); assert.match(badType.errors.join('|'), /delta/);
  const badDate = C.validateImport({ ...good, records: [{ ...r1, confirmedDate: '2026-13-01' }] });
  assert.equal(badDate.ok, false);
  const badConf = C.validateImport({ ...good, records: [{ ...r2, confirmedDate: '2026-10-22' }] });
  assert.equal(badConf.ok, false);
  const badDraft = C.validateImport({ ...good, draft: { oldText: 1, newText: '', versionName: '' } });
  assert.equal(badDraft.ok, false);
});

test('resolveToday 读取 ?today= 并在非法时回退', () => {
  assert.equal(C.resolveToday('?today=2026-10-20', '2030-01-01'), '2026-10-20');
  assert.equal(C.resolveToday('?today=2026-02-30', '2030-01-01'), '2030-01-01');
  assert.equal(C.resolveToday('?today=abc', '2030-01-01'), '2030-01-01');
  assert.equal(C.resolveToday('', '2030-01-01'), '2030-01-01');
});

test('引号未闭合:parseTable 标记 unclosedQuote,diffQuotes 整份拒绝并报行号', () => {
  const bad = C.parseTable(H + 'A1,甲,1,项,"2\nA2,乙,1,项,5,');
  assert.equal(bad.unclosedQuote, true);
  assert.equal(bad.unclosedQuoteLine, 2);
  const good = C.parseTable(H + 'A1,甲,1,项,2,');
  assert.equal(good.unclosedQuote, false);
  const d = C.diffQuotes(bad, C.parseTable(H + 'A1,甲,1,项,2,'), C.guessMapping(good.headers));
  assert.equal(d.ok, false);
  assert.equal(d.totals, null);
  assert.equal(d.errors[0].type, 'unclosed-quote');
  assert.equal(d.errors[0].side, 'old');
  assert.match(d.errors[0].message, /旧版.*第 2 行.*引号未闭合/);
});

test('stampFromDate: 上海 16:00 保存仍显示 16:00(+08:00),不再把 UTC 时分秒拼到本地日期', () => {
  const t = new Date(Date.UTC(2026, 9, 20, 8, 0, 0));
  const s = C.stampFromDate(t, { offsetMinutes: 480 });
  assert.equal(s.createdAt, '2026-10-20T16:00:00+08:00');
  assert.equal(s.simulated, false);
  assert.equal(Date.parse(s.createdAt), t.getTime(), '同一时刻');
});

test('stampFromDate: 跨日与负偏移,以及固定日期时标为模拟', () => {
  const t = new Date(Date.UTC(2026, 9, 20, 20, 30, 15));
  assert.equal(C.stampFromDate(t, { offsetMinutes: 480 }).createdAt, '2026-10-21T04:30:15+08:00');
  assert.equal(C.stampFromDate(t, { offsetMinutes: -300 }).createdAt, '2026-10-20T15:30:15-05:00');
  const sim = C.stampFromDate(t, { offsetMinutes: 480, fixedDate: '2026-10-26' });
  assert.equal(sim.createdAt, '2026-10-26T04:30:15+08:00');
  assert.equal(sim.simulated, true);
  assert.equal(C.stampFromDate(t, { offsetMinutes: 0, fixedDate: '2026-02-30' }).simulated, false, '非法固定日期不当作模拟');
});

test('describeStamp: 带时区偏移的记录写明偏移,旧记录标注时区未记录,模拟日期另行标注', () => {
  assert.equal(C.describeStamp({ createdAt: '2026-10-20T16:05:09+08:00', createdTz: 'Asia/Shanghai' }), '2026-10-20 16:05(UTC+08:00,Asia/Shanghai)');
  assert.equal(C.describeStamp({ createdAt: '2026-10-20T16:05:09+08:00', simulated: true }), '2026-10-20 16:05(UTC+08:00;日期由地址参数固定,为模拟日期)');
  assert.equal(C.describeStamp({ createdAt: '2026-10-20T08:00:00Z' }), '2026-10-20 08:00(UTC)');
  assert.equal(C.describeStamp({ createdAt: '2026-10-20T08:00:00' }), '2026-10-20 08:00(旧记录,未记录时区)');
});

test('sortRecords: 按绝对时刻排序,不同偏移的记录不会错序', () => {
  const a = { id: 'a', createdAt: '2026-10-20T23:00:00+08:00' };  // 15:00Z
  const b = { id: 'b', createdAt: '2026-10-20T10:00:00-05:00' };  // 15:00Z 同刻,按 id
  const c = { id: 'c', createdAt: '2026-10-20T09:00:00-05:00' };  // 14:00Z 最早
  assert.deepEqual(C.sortRecords([a, b, c]).map((r) => r.id), ['c', 'a', 'b']);
});

test('makeRecord 记录 createdTz 与 simulated', () => {
  const d = run('A1,甲,1,项,100,', 'A1,甲,2,项,100,');
  const r = C.makeRecord({ id: 'r1', now: '2026-10-20T16:00:00+08:00', tz: 'Asia/Shanghai', simulated: true, versionName: 'V2', diff: d });
  assert.equal(r.ok, true);
  assert.equal(r.record.createdTz, 'Asia/Shanghai');
  assert.equal(r.record.simulated, true);
  assert.equal(C.validateImport({ app: 'quote-diff', version: 1, records: [r.record], draft: null }).ok, true);
});

test('draft 里的说明草稿随备份保存并读回;类型不对整份拒绝', () => {
  const base = { app: 'quote-diff', version: 1, records: [] };
  const ok = C.validateImport(Object.assign({}, base, { draft: { oldText: 'a', newText: 'b', versionName: 'v', explainText: '## 新增\n- x', explainEdited: true } }));
  assert.equal(ok.ok, true);
  assert.equal(ok.value.draft.explainText, '## 新增\n- x');
  assert.equal(ok.value.draft.explainEdited, true);
  const legacy = C.validateImport(Object.assign({}, base, { draft: { oldText: '', newText: '', versionName: '' } }));
  assert.equal(legacy.ok, true, '旧备份没有说明草稿字段也能读');
  assert.equal(C.validateImport(Object.assign({}, base, { draft: { oldText: '', newText: '', versionName: '', explainText: 5 } })).ok, false);
  assert.equal(C.validateImport(Object.assign({}, base, { draft: { oldText: '', newText: '', versionName: '', explainEdited: 'yes' } })).ok, false);
  assert.equal(C.validateImport(Object.assign({}, base, { draft: { oldText: '', newText: '', versionName: '', explainText: 'x'.repeat(C.EXPLAIN_MAX + 1) } })).ok, false);
});

test('importSummary: 写明现有与备份的记录数以及草稿替换范围', () => {
  const cur = { records: [{ id: 'a' }, { id: 'b' }], draft: { oldText: 'x', newText: '', versionName: '', explainText: '说明', explainEdited: true } };
  const inc = { records: [{ id: 'c' }], draft: { oldText: '', newText: '', versionName: '' } };
  const s = C.importSummary(cur, inc);
  assert.equal(s.currentRecords, 2);
  assert.equal(s.incomingRecords, 1);
  assert.equal(s.draftReplaced, true);
  assert.match(s.text, /现有 2 条确认记录.*备份文件 1 条/);
  assert.match(s.text, /旧版\/新版文本、版本名和说明草稿/);
  assert.equal(C.importSummary({ records: [], draft: { oldText: '', newText: '', versionName: '' } }, inc).draftReplaced, false);
});

test('[W6 导入] checkTextFile:空文件与无法按 UTF-8 解码的文件被拒绝并给出原因,正常文本放行', () => {
  const empty = C.checkTextFile('');
  assert.strictEqual(empty.ok, false);
  assert.strictEqual(empty.code, 'empty');
  assert.match(empty.message, /空/);
  assert.strictEqual(C.checkTextFile(' \r\n\t').code, 'empty');
  assert.strictEqual(C.checkTextFile('\uFEFF').code, 'empty');
  assert.strictEqual(C.checkTextFile(null).code, 'empty');
  const enc = C.checkTextFile('abc,def\n\u0007\uFFFD\uFFFD,x');
  assert.strictEqual(enc.ok, false);
  assert.strictEqual(enc.code, 'encoding');
  assert.match(enc.message, /UTF-8/);
  // 只有表头、不像表格的普通文本不在这里拦:交给各产品自己的解析规则报错
  assert.deepStrictEqual(C.checkTextFile('a,b'), { ok: true, code: '', message: '' });
  assert.strictEqual(C.checkTextFile('{broken json').ok, true);
});
