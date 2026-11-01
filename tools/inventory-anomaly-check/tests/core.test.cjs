'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../core.js');

const HEAD = '商品编码\t商品名\t期初\t入库\t出库\t期末\t单位\t安全库存\t单价';
function run(lines, opts) {
  const t = C.parseTable([HEAD].concat(lines).join('\n'));
  const m = C.guessMapping(t.headers);
  return C.check(C.toRows(t, m), m, Object.assign({}, opts));
}
const rules = r => r.issues.map(i => i.rule);

test('parseTable:TSV/CSV/引号换行与原行号', () => {
  const t = C.parseTable('编码,名称,期初\n"A,1","带\n换行",5\n\nB2,x,6\n');
  assert.deepStrictEqual(t.headers, ['编码', '名称', '期初']);
  assert.strictEqual(t.rows.length, 2);
  assert.strictEqual(t.rows[0][0], 'A,1');
  assert.deepStrictEqual(t.lines, [2, 5]);
  assert.strictEqual(C.parseTable('a\tb\n1\t2').delimiter, '\t');
});

test('空表:不抛错,统计为 0', () => {
  const t = C.parseTable('   \n');
  assert.deepStrictEqual(t.rows, []);
  const r = C.check([], C.guessMapping([]), {});
  assert.strictEqual(r.stats.rows, 0);
  assert.strictEqual(r.issues.length, 0);
  assert.strictEqual(r.stats.value, null);
});

test('guessMapping:识别中文列名,安全库存不被当成期末', () => {
  const m = C.guessMapping(['商品编码', '商品名', '期初', '入库', '出库', '期末', '单位', '安全库存', '单价']);
  assert.deepStrictEqual([m.code, m.name, m.open, m.in, m.out, m.close, m.unit, m.safety, m.price], [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.strictEqual(C.guessMapping(['x', 'y']).code, -1);
});

test('normalizeNumber:千分位/全角/空值/非法', () => {
  assert.strictEqual(C.normalizeNumber('1,200').value, 1200);
  assert.strictEqual(C.normalizeNumber('１２３．５').value, 123.5);
  assert.strictEqual(C.normalizeNumber('-5').value, -5);
  assert.strictEqual(C.normalizeNumber('¥3,500.25').value, 3500.25);
  const e = C.normalizeNumber('  ');
  assert.ok(e.empty && e.value === 0 && !e.invalid);
  for (const bad of ['abc', '1,2', '1.2.3', '12kg', 'N/A']) {
    const r = C.normalizeNumber(bad);
    assert.ok(r.invalid && r.value === null, bad);
  }
  assert.strictEqual(C.normalizeNumber(0.1 + 0.2).value, 0.3);
});

test('公式校验:容差为 0,差 0.1 也报', () => {
  const ok = run(['A1\t甲\t10\t5\t3\t12\t个\t\t']);
  assert.ok(!rules(ok).includes('FORMULA'));
  const bad = run(['A1\t甲\t10\t5\t3\t12.1\t个\t\t']);
  const f = bad.issues.find(i => i.rule === 'FORMULA');
  assert.ok(f && f.level === 'block');
  assert.ok(f.message.includes('= 12') && f.message.includes('12.1'));
  assert.strictEqual(bad.rows[0].formula, 12);
  const float = run(['A1\t甲\t0.1\t0.2\t0\t0.3\t个\t\t']);
  assert.ok(!rules(float).includes('FORMULA'));
});

test('负库存阻断', () => {
  const r = run(['A1\t甲\t5\t0\t8\t-3\t个\t\t']);
  const n = r.issues.find(i => i.rule === 'NEGATIVE');
  assert.ok(n && n.level === 'block' && n.line === 2);
});

test('重复编码与空编码阻断,并给出另一行行号', () => {
  const r = run(['A1\t甲\t1\t0\t0\t1\t个\t\t', 'a1\t乙\t2\t0\t0\t2\t个\t\t', '\t丙\t3\t0\t0\t3\t个\t\t']);
  const dups = r.issues.filter(i => i.rule === 'DUP_CODE');
  assert.strictEqual(dups.length, 2);
  assert.ok(dups[0].message.includes('第 3 行'));
  assert.strictEqual(r.issues.filter(i => i.rule === 'EMPTY_CODE').length, 1);
  assert.strictEqual(r.issues.find(i => i.rule === 'EMPTY_CODE').line, 4);
});

test('单位同义归一不报警,真实不一致才报警', () => {
  const map = '个=件=pcs\nkg=千克';
  assert.strictEqual(C.normalizeUnit('PCS', map), '个');
  assert.strictEqual(C.normalizeUnit('千克', map), 'kg');
  assert.strictEqual(C.normalizeUnit('袋', map), '袋');
  assert.strictEqual(C.normalizeUnit('', map), '');
  const syn = run(['A1\t甲\t1\t0\t0\t1\t个\t\t', 'A1\t甲\t1\t0\t0\t1\tpcs\t\t'], { unitMap: map });
  assert.ok(!rules(syn).includes('UNIT_MISMATCH'));
  const diff = run(['A1\t甲\t1\t0\t0\t1\t个\t\t', 'A1\t甲\t1\t0\t0\t1\t箱\t\t'], { unitMap: map });
  assert.strictEqual(diff.issues.filter(i => i.rule === 'UNIT_MISMATCH').length, 2);
  const noMap = run(['A1\t甲\t1\t0\t0\t1\t个\t\t', 'A1\t甲\t1\t0\t0\t1\tpcs\t\t'], { unitMap: '' });
  assert.ok(rules(noMap).includes('UNIT_MISMATCH'));
});

test('安全库存:低于才警告,等于不警告,空值不警告', () => {
  const r = run(['A1\t甲\t5\t0\t0\t5\t个\t10\t', 'A2\t乙\t10\t0\t0\t10\t个\t10\t', 'A3\t丙\t1\t0\t0\t1\t个\t\t']);
  const lows = r.issues.filter(i => i.rule === 'BELOW_SAFETY');
  assert.strictEqual(lows.length, 1);
  assert.strictEqual(lows[0].code, 'A1');
});

test('先出后入:出库大于期初+入库;期末为 0 且有入库', () => {
  const r = run(['A1\t甲\t2\t3\t9\t-4\t个\t\t', 'A2\t乙\t0\t6\t6\t0\t个\t\t', 'A3\t丙\t0\t0\t0\t0\t个\t\t']);
  assert.ok(rules(r).includes('OUT_BEFORE_IN'));
  assert.strictEqual(r.issues.filter(i => i.rule === 'OUT_BEFORE_IN').length, 1);
  const z = r.issues.filter(i => i.rule === 'ZERO_WITH_IN');
  assert.deepStrictEqual(z.map(i => i.code), ['A2']);
});

test('空值按 0 警告;非法数字阻断且不连带公式误报', () => {
  const e = run(['A1\t甲\t\t5\t2\t3\t个\t\t']);
  const w = e.issues.find(i => i.rule === 'EMPTY_AS_ZERO');
  assert.ok(w && w.level === 'warn' && w.field === 'open');
  assert.ok(!rules(e).includes('FORMULA'));
  const b = run(['A1\t甲\t十\t5\t2\t3\t个\t\t']);
  assert.ok(b.issues.some(i => i.rule === 'BAD_NUMBER' && i.level === 'block' && i.field === 'open'));
  assert.ok(!rules(b).includes('FORMULA'));
});

test('名称相同编码不同、单价为空有出库', () => {
  const r = run(['A1\t保温杯\t5\t0\t2\t3\t个\t\t10', 'B1\t保温杯\t5\t0\t0\t5\t个\t\t', 'C1\t水壶\t5\t0\t2\t3\t个\t\t']);
  assert.strictEqual(r.issues.filter(i => i.rule === 'NAME_DUP').length, 2);
  const np = r.issues.filter(i => i.rule === 'NO_PRICE');
  assert.deepStrictEqual(np.map(i => i.code), ['C1']);
});

test('applyFormula 只改选中行,保留原值痕迹', () => {
  const r = run(['A1\t甲\t10\t5\t3\t99\t个\t\t', 'A2\t乙\t10\t5\t3\t98\t个\t\t', 'A3\t丙\t1\t1\t0\t2\t个\t\t']);
  const fixed = C.applyFormula(r.rows, [1]);
  assert.strictEqual(fixed[0].close, '99');
  assert.strictEqual(fixed[1].close, '12');
  assert.strictEqual(fixed[1].edited, true);
  assert.strictEqual(fixed[1].closeOrig, '98');
  assert.strictEqual(fixed[2].close, '2');
  const again = C.check(fixed, {}, {});
  assert.strictEqual(again.issues.filter(i => i.rule === 'FORMULA').length, 1);
  assert.strictEqual(again.issues.find(i => i.rule === 'FORMULA').code, 'A1');
  assert.strictEqual(C.applyFormula(r.rows, [0, 1]).filter(x => x.edited).length, 2);
});

test('applyFormula 对数字非法的行不改动', () => {
  const r = run(['A1\t甲\t十\t5\t3\t99\t个\t\t']);
  const fixed = C.applyFormula(r.rows, [0]);
  assert.strictEqual(fixed[0].close, '99');
  assert.ok(!fixed[0].edited);
});

test('汇总:按单位分组期末合计(同义归一)与库存金额', () => {
  const r = run([
    'A1\t甲\t10\t0\t0\t10\t个\t\t2', 'A2\t乙\t5\t0\t0\t5\tpcs\t\t3',
    'B1\t丙\t4\t0\t0\t4\t箱\t\t10', 'C1\t丁\t1\t0\t0\t1\tkg\t\t', 'D1\t戊\t3\t0\t6\t-3\t个\t\t4'
  ]);
  const u = Object.fromEntries(r.stats.unitTotals.map(x => [x.unit, x.close]));
  assert.strictEqual(u['个'], 12);
  assert.strictEqual(u['箱'], 4);
  assert.strictEqual(u['kg'], 1);
  assert.strictEqual(r.stats.value.total, 10 * 2 + 5 * 3 + 4 * 10);
  assert.strictEqual(r.stats.value.skipped, 2);
  assert.strictEqual(r.stats.rows, 5);
  assert.strictEqual(r.stats.byRule.NEGATIVE, 1);
});

test('按名分组不受 __proto__ / constructor 影响', () => {
  const r = run(['__proto__\tconstructor\t1\t0\t0\t1\t__proto__\t\t', 'constructor\t__proto__\t2\t0\t0\t2\tconstructor\t\t']);
  assert.strictEqual(r.stats.rows, 2);
  assert.strictEqual(r.stats.unitTotals.length, 2);
  assert.strictEqual(r.issues.length, 0);
});

test('CSV/Markdown 导出防公式注入,单独 - 或 + 不加前缀', () => {
  const csv = C.toCsv(['a', 'b'], [['=1+1', '-'], ['+SUM(A1)', '@x'], ['-5', 'a,b'], ['+', 12]]);
  const lines = csv.trim().split('\n');
  assert.strictEqual(lines[1], "'=1+1,-");
  assert.strictEqual(lines[2], "'+SUM(A1),'@x");
  assert.strictEqual(lines[3], "'-5,\"a,b\"");
  assert.strictEqual(lines[4], '+,12');
  const md = C.issuesToMarkdown([{ line: 3, level: 'block', label: '规则', code: '=CMD|x', message: 'a|b\nc' }], { rows: 1, issueRows: 1, blocks: 1, warns: 0 });
  assert.ok(md.includes("'=CMD\\|x"));
  assert.ok(md.includes('a\\|b c'));
  assert.ok(md.includes('| 3 | 阻断 |'));
});

test('异常清单 CSV 含原行号;修正表含修正说明', () => {
  const r = run(['A1\t甲\t10\t5\t3\t99\t个\t\t5']);
  const csv = C.issuesToCsv(r.issues);
  assert.ok(csv.startsWith('行号,级别,规则,商品编码,说明\n2,阻断,'));
  const fixed = C.applyFormula(r.rows, [0]);
  const t = C.correctedTable(fixed);
  assert.ok(t.headers.includes('修正说明'));
  assert.deepStrictEqual(t.rows[0][t.headers.indexOf('期末')], { n: '12' });
  assert.ok(t.rows[0][t.headers.length - 1].includes('99'));
});

test('零容差:小于百万分之一的差异也报 FORMULA,等值的不同写法不报', () => {
  const tiny = run(['A1\t甲\t1\t0\t0\t1.0000001\t个\t\t']);
  const f = tiny.issues.find(i => i.rule === 'FORMULA');
  assert.ok(f, '1 vs 1.0000001 必须报错');
  assert.ok(f.message.includes('1.0000001') && f.message.includes('差 0.0000001'));
  const huge = run(['A1\t甲\t0.1234567891\t0\t0\t0.1234567890\t个\t\t']);
  assert.ok(huge.issues.some(i => i.rule === 'FORMULA'));
  const same = run(['A1\t甲\t1\t0\t0\t1.0000000\t个\t\t', 'A2\t乙\t0.1\t0.2\t0\t0.3\t个\t\t', 'A3\t丙\t1,000.50\t0\t0.5\t1000\t个\t\t']);
  assert.ok(!rules(same).includes('FORMULA'));
  const fixed = C.applyFormula(tiny.rows, [0]);
  assert.strictEqual(fixed[0].close, '1');
  assert.strictEqual(C.normalizeNumber('0.00000001').dec.s, 8);
});

test('引号未闭合:整份拒绝,不产生行', () => {
  const t = C.parseTable('商品编码,期末\nA1,"1\nA2,2\n');
  assert.ok(t.error && t.error.includes('第 2 行'));
  assert.deepStrictEqual(t.rows, []);
  assert.deepStrictEqual(t.headers, []);
  assert.ok(!C.parseTable('a,b\n"1",2\n').error);
});

test('期末为空按 0:既报空值警告,也按 0 触发「期末为 0 且有入库」', () => {
  const r = run(['A1\t甲\t0\t5\t5\t\t个\t\t']);
  assert.ok(rules(r).includes('EMPTY_AS_ZERO'));
  assert.ok(rules(r).includes('ZERO_WITH_IN'));
  assert.ok(!rules(r).includes('FORMULA'));
});

test('replaceScope:输入框草稿、已采用公式、改过的单位表/列映射/币种都算用户数据', () => {
  const empty = { table: null, rows: [], mapping: null, unitMapText: C.DEFAULT_UNIT_MAP_TEXT, currency: '' };
  assert.strictEqual(C.replaceScope(empty, '').any, false);
  assert.strictEqual(C.replaceScope(empty, '   \n').any, false);
  const draft = C.replaceScope(empty, 'A1\t5');
  assert.strictEqual(draft.any, true);
  assert.strictEqual(draft.draftChars, 4);
  assert.ok(C.describeScope(draft).includes('输入框里还没解析的内容'));
  const t = C.parseTable('商品编码\t期初\t入库\t出库\t期末\nA\t1\t1\t1\t2\n');
  const m = C.guessMapping(t.headers);
  const rows = C.applyFormula(C.toRows(t, m), [0]);
  const st = { table: t, rows, mapping: m, unitMapText: '个=件\n箱', currency: 'CNY' };
  const sc = C.replaceScope(st, '');
  assert.strictEqual(sc.rows, 1);
  assert.strictEqual(sc.edited, 1);
  assert.strictEqual(sc.unitMapChanged, true);
  assert.strictEqual(sc.currency, 'CNY');
  const d = C.describeScope(sc);
  assert.ok(d.includes('1 行库存数据') && d.includes('1 行已采用的公式期末') && d.includes('单位同义表') && d.includes('币种'));
  const m2 = Object.assign({}, m, { close: -1 });
  assert.strictEqual(C.replaceScope({ table: t, rows: C.toRows(t, m2), mapping: m2, unitMapText: C.DEFAULT_UNIT_MAP_TEXT, currency: '' }, '').mappingChanged, true);
});

test('ruleCoverage:缺列时列出没有运行的规则,不会把「没检查」说成「没问题」', () => {
  const full = C.guessMapping(['商品编码', '商品名', '期初', '入库', '出库', '期末', '单位', '安全库存', '单价']);
  assert.deepStrictEqual(C.ruleCoverage(full).skipped, []);
  const noPrice = Object.assign({}, full, { price: -1, safety: -1 });
  const sk = C.ruleCoverage(noPrice).skipped.map(s => s.id);
  assert.ok(sk.includes('NO_PRICE') && sk.includes('BELOW_SAFETY'));
  assert.ok(!sk.includes('FORMULA'));
  const onlyCode = C.guessMapping(['商品编码']);
  assert.ok(C.ruleCoverage(onlyCode).skipped.some(s => s.id === 'FORMULA' && s.missing.includes('期初')));
});

test('checkVerdict:只有检查完整完成且无异常才说「没有发现问题」', () => {
  const full = C.guessMapping(['商品编码', '商品名', '期初', '入库', '出库', '期末', '单位', '安全库存', '单价']);
  const ok = run(['A1\t苹果\t1\t1\t1\t1\t个\t0\t2']);
  assert.strictEqual(C.checkVerdict(ok, full, null).state, 'clean');
  assert.ok(C.checkVerdict(ok, full, null).text.includes('没有发现问题'));
  const bad = run(['A1\t苹果\t1\t1\t1\t5\t个\t0\t2']);
  assert.strictEqual(C.checkVerdict(bad, full, null).state, 'issues');
  const partial = C.checkVerdict(ok, Object.assign({}, full, { price: -1 }), null);
  assert.strictEqual(partial.state, 'incomplete');
  assert.ok(!partial.text.includes('没有发现问题') && partial.text.includes('检查未完成'));
  const perr = C.checkVerdict(ok, full, '引号没有闭合');
  assert.strictEqual(perr.state, 'incomplete');
  assert.ok(perr.text.includes('检查未完成:1 处错误'));
});

test('currency:空值写「原表统一货币单位」,非空原样标注;拒绝控制字符与过长文本', () => {
  assert.ok(C.currencyLabel('').includes('原表统一货币单位'));
  assert.strictEqual(C.currencyLabel('CNY'), 'CNY');
  assert.strictEqual(C.normalizeCurrency('  CNY ').value, 'CNY');
  assert.strictEqual(C.normalizeCurrency('').ok, true);
  assert.strictEqual(C.normalizeCurrency('a'.repeat(13)).ok, false);
  assert.strictEqual(C.normalizeCurrency('C\nNY').ok, false);
});

test('导出标注:示例与币种写进 Markdown / CSV / 修正表;非示例不带', () => {
  const r = run(['A1\t苹果\t1\t1\t1\t5\t个\t0\t2']);
  const md = C.issuesToMarkdown(r.issues, r.stats, { sample: true, currency: 'CNY' });
  assert.ok(md.includes('数据来源:合成示例') && md.includes('库存金额币种:CNY'));
  const md2 = C.issuesToMarkdown(r.issues, r.stats, {});
  assert.ok(!md2.includes('合成示例') && md2.includes('原表统一货币单位'));
  const csv = C.issuesToCsv(r.issues, { sample: true }).split('\n');
  assert.ok(csv[0].endsWith(',数据来源') && csv[1].endsWith(',合成示例'));
  assert.ok(!C.issuesToCsv(r.issues).includes('数据来源'));
  const tbl = C.correctedTable([{ line: 2, code: 'A1' }], { sample: true });
  assert.strictEqual(tbl.headers[tbl.headers.length - 1], '数据来源');
  assert.strictEqual(tbl.rows[0][tbl.rows[0].length - 1], '合成示例');
  assert.ok(!C.correctedTable([{ line: 2, code: 'A1' }]).headers.includes('数据来源'));
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
