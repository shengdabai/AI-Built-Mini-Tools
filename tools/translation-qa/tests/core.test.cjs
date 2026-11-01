'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../core.js');

const P = (n, src, tgt) => ({ n: String(n), src, tgt });
const run = (pairs, gl, opt) => C.check(pairs, gl ? C.parseGlossary(gl).entries : [], opt);
const types = r => r.issues.map(i => i.n + ':' + i.type);

test('alignText:行数相等时逐行配对', () => {
  const r = C.alignText('a\nb\nc', 'x\ny\nz');
  assert.strictEqual(r.mismatch, false);
  assert.deepStrictEqual(r.pairs.map(p => [p.n, p.src, p.tgt]), [['1', 'a', 'x'], ['2', 'b', 'y'], ['3', 'c', 'z']]);
});

test('alignText:行数不等时报差异并补空串,末尾空行不算行', () => {
  const r = C.alignText('a\nb\nc\n\n', 'x\ny');
  assert.strictEqual(r.mismatch, true);
  assert.strictEqual(r.srcCount, 3);
  assert.strictEqual(r.tgtCount, 2);
  assert.strictEqual(r.pairs[2].tgt, '');
  assert.match(r.note, /原文 3 行,译文 2 行/);
  const rev = C.alignText('a', 'x\ny');
  assert.match(rev.note, /原文为空/);
});

test('alignText:CRLF 与空输入', () => {
  assert.strictEqual(C.alignText('a\r\nb', 'x\r\ny').pairs.length, 2);
  const e = C.alignText('', '');
  assert.deepStrictEqual(e.pairs, []);
  assert.strictEqual(e.mismatch, false);
});

test('parseTable:TSV 带表头、CSV 带引号与内嵌逗号换行', () => {
  const t = C.parseTable('段落号\t原文\t译文\n1\tHi\t你好\n2\tBye\t再见');
  assert.strictEqual(t.ok, true);
  assert.strictEqual(t.pairs.length, 2);
  const c = C.parseTable('1,"Hello, ""world""","你好,\n世界"\n2,a,b');
  assert.strictEqual(c.ok, true);
  assert.strictEqual(c.pairs[0].src, 'Hello, "world"');
  assert.strictEqual(c.pairs[0].tgt, '你好,\n世界');
});

test('parseTable:列数不足、重复段落号、空段落号、多余列、引号未闭合都整份拒绝', () => {
  assert.strictEqual(C.parseTable('1\tonly\n').ok, false);
  const dup = C.parseTable('1\ta\tb\n1\tc\td');
  assert.strictEqual(dup.ok, false);
  assert.match(dup.error, /重复/);
  assert.strictEqual(C.parseTable('\ta\tb').ok, false);
  assert.strictEqual(C.parseTable('1\ta\tb\tc').ok, false);
  assert.strictEqual(C.parseTable('1\ta\tb\t\n').ok, true);
  assert.strictEqual(C.parseTable('1,"abc,d').ok, false);
  assert.strictEqual(C.parseTable('   ').ok, false);
});

test('parseGlossary:半角与全角分隔,忽略空行与注释,坏行进 errors', () => {
  const g = C.parseGlossary('# 注释\nvariable | 变量, 变数\n\nfunction｜函数、方法；函式\nbad line\n | x\nterm |  ');
  assert.deepStrictEqual(g.entries.map(e => [e.term, e.allowed]), [['variable', ['变量', '变数']], ['function', ['函数', '方法', '函式']]]);
  assert.deepStrictEqual(g.errors.map(e => e.line), [5, 6, 7]);
  assert.deepStrictEqual(C.parseGlossary('').entries, []);
});

test('placeholders:花括号、百分号、HTML 标签、换行数', () => {
  assert.deepStrictEqual(C.placeholders('Hi {0} and {name}'), ['{0}', '{name}']);
  assert.deepStrictEqual(C.placeholders('%s has %d items, %1$s %.2f'), ['%.2f', '%1$s', '%d', '%s']);
  assert.deepStrictEqual(C.placeholders('<b>x</b> <a href="u">y</a>'), ['</a>', '</b>', '<a href="u">', '<b>']);
  assert.deepStrictEqual(C.placeholders('a\\nb\nc\r\nd'), ['\\n', '\\n', '\\n']);
  assert.deepStrictEqual(C.placeholders('50% of it, 100%'), []);
  assert.deepStrictEqual(C.placeholders('100%% sure'), []);
  assert.deepStrictEqual(C.placeholders('a < b and c > d'), []);
});

test('numbers:去重排序、全角、千分位、占位符里的数字不算', () => {
  assert.deepStrictEqual(C.numbers('In 2026, 12 and 12 and 3.5'), ['12', '2026', '3.5']);
  assert.deepStrictEqual(C.numbers('共 １２ 项,1,000 元'), ['1000', '12']);
  assert.deepStrictEqual(C.numbers('{0} %1$s <h1>x</h1>'), []);
  assert.deepStrictEqual(C.numbers('Version 3.'), ['3']);
});

test('check:漏译为阻断,反向(原文为空)也是阻断,双空忽略', () => {
  const r = run([P(1, 'Hello', ''), P(2, '', '你好'), P(3, '', ''), P(4, '   ', '  ')]);
  assert.deepStrictEqual(types(r), ['1:missing', '2:extra']);
  assert.ok(r.issues.every(i => i.level === 'block'));
  assert.strictEqual(r.stats.missing, 1);
  assert.strictEqual(r.stats.extra, 1);
  assert.strictEqual(r.stats.segments, 4);
});

test('check:占位符缺失/多出/换行数不同都是阻断,一致则无', () => {
  const r = run([
    P(1, 'Hi {0}, you have %d items.', '你好 {0},你有若干项。'),
    P(2, 'Click <b>Run</b> now.', '现在点击 <b>运行 。'),
    P(3, 'Line one\\nLine two', '第一行第二行'),
    P(4, 'Hi {name}.', '你好 {name}。'),
    P(5, 'Plain text.', '纯文本 {x}。')
  ]);
  assert.deepStrictEqual(r.issues.filter(i => i.type === 'placeholder').map(i => i.n), ['1', '2', '3', '5']);
  assert.match(r.issues.find(i => i.n === '1').message, /缺少 %d/);
  assert.match(r.issues.find(i => i.n === '3').message, /缺少 换行/);
  assert.match(r.issues.find(i => i.n === '5').message, /多出 \{x\}/);
  assert.strictEqual(r.stats.placeholder, 4);
});

test('check:数字集合——丢失与多出都报,顺序不同不报', () => {
  const r = run([
    P(1, 'The year 2026 and 5 items.', '这一年和 5 个项目。'),
    P(2, 'Step 1 then step 2.', '先第 2 步再第 1 步。'),
    P(3, 'No digits here.', '这里有 99 个数字。')
  ]);
  assert.deepStrictEqual(r.issues.filter(i => i.type === 'number').map(i => i.n), ['1', '3']);
  assert.match(r.issues[0].message, /没有 2026/);
  assert.strictEqual(r.issues[0].level, 'block');
});

test('check:术语命中且译文含允许译法则通过,否则警告', () => {
  const gl = 'variable | 变量, 变数\nloop | 循环';
  const r = run([
    P(1, 'A variable holds data.', '变数保存数据。'),
    P(2, 'A variable holds data.', '它保存数据。'),
    P(3, 'Nothing special.', '没有术语。'),
    P(4, 'The loop and the variable.', '循环和值。')
  ], gl);
  assert.deepStrictEqual(r.issues.filter(i => i.type === 'glossary').map(i => i.n + ':' + i.message.match(/「(.+?)」/)[1]), ['2:variable', '4:variable']);
  assert.strictEqual(r.stats.glossary, 2);
  assert.ok(r.issues.filter(i => i.type === 'glossary').every(i => i.level === 'warn'));
});

test('check:术语的大小写开关', () => {
  const gl = 'API | API 接口';
  const pairs = [P(1, 'The api is stable.', '该接口很稳定。'), P(2, 'The API is stable.', '该 api 接口 很稳定。')];
  const loose = run(pairs, gl, { caseSensitive: false });
  assert.deepStrictEqual(loose.issues.filter(i => i.type === 'glossary').map(i => i.n), ['1']);
  const strict = run(pairs, gl, { caseSensitive: true });
  assert.deepStrictEqual(strict.issues.filter(i => i.type === 'glossary').map(i => i.n), ['2']);
});

test('check:长度比阈值——恰好等于边界不报,超出才报,可配置', () => {
  const r = run([P(1, 'abcdefghij', 'abcdefghijklmnopqrstuvwxyz1234'), P(2, 'abcdefghij', 'abcdefghijklmnopqrstuvwxyz12345'),
    P(3, 'abcdefghij', 'abc'), P(4, 'abcdefghij', 'ab')]);
  assert.deepStrictEqual(r.issues.filter(i => i.type === 'ratio').map(i => i.n), ['2', '4']);
  const loose = run([P(1, 'abcdefghij', 'ab')], '', { ratioLow: 0.1, ratioHigh: 5 });
  assert.strictEqual(loose.issues.filter(i => i.type === 'ratio').length, 0);
});

test('check:选项非法时抛错而不是静默修正', () => {
  assert.throws(() => C.check([], [], { ratioLow: 5, ratioHigh: 3 }), /下限/);
  assert.throws(() => C.check([], [], { ratioHigh: NaN }), /上限/);
  assert.throws(() => C.check([], [], { caseSensitive: 'yes' }), /大小写/);
  assert.strictEqual(C.validateOptions(C.DEFAULTS), null);
});

test('check:末尾标点——问号/感叹/句号/无标点任一类型不同都警告,类型相同不报', () => {
  const r = run([
    P(1, 'Really?', '真的。'),
    P(2, 'Stop!', '停下?'),
    P(3, 'Done.', '完成!'),
    P(4, 'Is it?', '是吗?'),
    P(5, 'Title', '标题。'),
    P(6, 'Sentence.', '句子'),
    P(7, 'He said "Go!"', '他说“走!”'),
    P(8, 'Fine?', '好吧')
  ]);
  assert.deepStrictEqual(r.issues.filter(i => i.type === 'punct').map(i => i.n), ['1', '2', '3', '5', '6', '8']);
  assert.match(r.issues.find(i => i.n === '6' && i.type === 'punct').message, /原文是句号,译文是无句末标点/);
  assert.strictEqual(C.endType('Wait…'), 'p');
  assert.strictEqual(C.endType('ok:'), 'n');
});

test('check:疑似未译按 trim 后严格相等判断,不合并内部空白,也不要求含字母', () => {
  const r = run([P(1, 'Hello, world!', 'Hello, world!'), P(2, '2026-10-20', '2026-10-20'), P(3, 'Hello, world!', 'Hello,  world!'), P(4, 'Hi', 'hi'), P(5, ' Hi ', 'Hi')]);
  assert.deepStrictEqual(r.issues.filter(i => i.type === 'untranslated').map(i => i.n), ['1', '2', '5']);
});

test('check:同一原文不同译——每个相关段都报并指向对方,译法相同不报', () => {
  const r = run([P(1, 'Save often.', '常保存。'), P(2, 'Other.', '别的。'), P(3, 'Save  often.', '勤保存。'), P(4, 'Same', '一样'), P(5, 'Same', '一样')]);
  const inc = r.issues.filter(i => i.type === 'inconsistent');
  assert.deepStrictEqual(inc.map(i => i.n), ['1', '3']);
  assert.match(inc[0].message, /第 3 段/);
  assert.match(inc[1].message, /第 1 段/);
  assert.strictEqual(r.stats.inconsistent, 2);
});

test('check:原型键名作为原文不会污染分组(__proto__ / constructor)', () => {
  const r = run([P(1, '__proto__', '甲'), P(2, '__proto__', '乙'), P(3, 'constructor', '丙')]);
  assert.deepStrictEqual(r.issues.filter(i => i.type === 'inconsistent').map(i => i.n), ['1', '2']);
});

test('check:空输入返回零统计,且问题按段落顺序、阻断优先排序', () => {
  const e = C.check([], [], {});
  assert.deepStrictEqual(e.issues, []);
  assert.strictEqual(e.stats.segments, 0);
  const r = run([P(10, 'Really?', '真的。 {x}'), P(2, 'Hello', '')]);
  assert.deepStrictEqual(r.issues.map(i => i.n + ':' + i.level), ['10:block', '10:warn', '2:block']);
});

test('toCsv:公式防护——= + - @ 开头加单引号,单独的 - 与 + 不加,含逗号引号换行会转义', () => {
  const csv = C.toCsv([['h'], ['=SUM(A1)'], ['+1'], ['-2'], ['@cmd'], ['-'], ['+'], ['a,b'], ['say "hi"'], ['l1\nl2'], ['x=1']]);
  assert.deepStrictEqual(csv.split('\r\n').slice(0, 7), ['h', "'=SUM(A1)", "'+1", "'-2", "'@cmd", '-', '+']);
  assert.ok(csv.includes('"a,b"'));
  assert.ok(csv.includes('"say ""hi"""'));
  assert.ok(csv.includes('"l1\nl2"'));
  assert.ok(csv.includes('\r\nx=1\r\n'));
  assert.strictEqual(C.guardCell(5), '5');
  assert.strictEqual(C.guardCell(null), '');
});

test('导出:问题清单 CSV 与带问题列的双语表,用户字段被公式防护', () => {
  const pairs = [P(1, '=cmd', ''), P(2, 'ok', '好')];
  const r = run(pairs);
  const csv = C.issuesToCsv(r.issues);
  assert.ok(csv.startsWith('段落号,级别,类型,说明\r\n1,阻断,漏译,'));
  const ann = C.annotatedCsv(pairs, r.issues);
  const lines = ann.trim().split('\r\n');
  assert.strictEqual(lines[0], '段落号,原文,译文,问题');
  assert.match(lines[1], /^1,'=cmd,,"\[阻断\] 漏译/);
  assert.strictEqual(lines[2], '2,ok,好,');
});

test('issuesToMarkdown:表格转义竖线与换行,摘录防公式,无问题时有明确文字', () => {
  const pairs = [P(1, '=A|B\nC', '')];
  const r = run(pairs);
  const md = C.issuesToMarkdown(r.issues, r.stats, { pairs, alignNote: '原文 1 行,译文 0 行' });
  assert.ok(md.includes('# 译稿机械检查报告'));
  assert.ok(md.includes('> 对齐提示:原文 1 行,译文 0 行'));
  assert.ok(md.includes("'=A\\|B C"));
  assert.ok(md.includes('| 1 | 阻断 | 漏译 |'));
  const none = run([P(1, 'a', '甲')]);
  assert.ok(C.issuesToMarkdown(none.issues, none.stats, { pairs: [] }).includes('没有发现问题'));
});

test('示例数据:20 段,恰好产生设计好的问题', () => {
  require('../sample-data.js');
  const S = globalThis.TRANSCHECK_SAMPLE;
  const t = C.parseTable(S.tableText);
  assert.strictEqual(t.ok, true);
  assert.strictEqual(t.pairs.length, 20);
  const g = C.parseGlossary(S.glossaryText);
  assert.strictEqual(g.errors.length, 0);
  assert.strictEqual(g.entries.length, 6);
  const r = C.check(t.pairs, g.entries, C.DEFAULTS);
  assert.deepStrictEqual(r.issues.map(i => i.n + ':' + i.type), [
    '5:placeholder', '6:number', '7:glossary', '8:glossary', '9:missing', '10:untranslated',
    '11:ratio', '12:inconsistent', '17:inconsistent'
  ]);
  assert.strictEqual(r.stats.blocking, 3);
  assert.strictEqual(r.stats.warnings, 6);
});

const ST = (o) => Object.assign({ mode: 'table', tableText: '', srcText: '', tgtText: '', glossaryText: '', caseSensitive: false, ratioHigh: '3', ratioLow: '0.3' }, o || {});

test('replaceScope:文本、术语表、已有结果、偏离默认的选项都算用户数据', () => {
  assert.strictEqual(C.replaceScope(ST(), false).any, false);
  assert.strictEqual(C.replaceScope(ST({ caseSensitive: true }), false).any, true);
  assert.strictEqual(C.replaceScope(ST({ ratioHigh: '5' }), false).optionsChanged, true);
  assert.strictEqual(C.replaceScope(ST({ ratioLow: '0.5' }), false).any, true);
  assert.strictEqual(C.replaceScope(ST(), true).any, true);
  const sc = C.replaceScope(ST({ tableText: '1\ta\tb\n2\tc\td', glossaryText: 'x | y', srcText: 'l1\nl2\nl3', caseSensitive: true }), true);
  assert.strictEqual(sc.tableLines, 2);
  assert.strictEqual(sc.glossaryLines, 1);
  assert.strictEqual(sc.twoLines, 3);
  const d = C.describeScope(sc);
  assert.ok(d.includes('双语表 2 行') && d.includes('术语表 1 行') && d.includes('选项') && d.includes('检查结果'));
});

test('prepareRun:错误带字段名,供界面显示在对应控件旁', () => {
  const noRatio = C.prepareRun(ST({ tableText: '1\ta\tb', ratioHigh: '' }));
  assert.strictEqual(noRatio.ok, false);
  assert.strictEqual(noRatio.errors[0].field, 'ratioHigh');
  const order = C.prepareRun(ST({ tableText: '1\ta\tb', ratioHigh: '0.2', ratioLow: '0.5' }));
  assert.strictEqual(order.errors[0].field, 'ratioLow');
  const badTable = C.prepareRun(ST({ tableText: '1\ta\n2\tb\tc' }));
  assert.strictEqual(badTable.errors[0].field, 'table');
  const badGl = C.prepareRun(ST({ tableText: '1\ta\tb', glossaryText: 'no separator here' }));
  assert.strictEqual(badGl.errors[0].field, 'glossary');
  assert.ok(/第 1 行/.test(badGl.errors[0].message));
  const empty = C.prepareRun(ST());
  assert.strictEqual(empty.errors[0].field, 'table');
  assert.strictEqual(C.prepareRun(ST({ mode: 'two' })).errors[0].field, 'src');
  const good = C.prepareRun(ST({ tableText: '1\thello\t你好', glossaryText: 'hello | 你好' }));
  assert.strictEqual(good.ok, true);
  assert.strictEqual(good.pairs.length, 1);
  assert.strictEqual(good.glossary.length, 1);
  const multi = C.prepareRun(ST({ tableText: '1\ta\n', glossaryText: 'bad', ratioHigh: 'x' }));
  assert.ok(multi.errors.length >= 3);
});

test('checkVerdict:有错误时写「检查未完成」,只有完整检查且无问题才说没有发现问题', () => {
  const r = C.check([P(1, 'a', 'b')], [], {});
  const clean = C.checkVerdict(r, [], 1);
  assert.strictEqual(clean.state, 'clean');
  assert.ok(clean.text.includes('没有发现问题'));
  const bad = C.checkVerdict(r, [{ field: 'glossary', message: 'x' }, { field: 'ratioHigh', message: 'y' }], 1);
  assert.strictEqual(bad.state, 'incomplete');
  assert.ok(bad.text.includes('检查未完成:2 处错误') && !bad.text.includes('没有发现问题'));
  const withIssue = C.checkVerdict(C.check([P(1, 'a', '')], [], {}), [], 1);
  assert.strictEqual(withIssue.state, 'issues');
  assert.strictEqual(C.checkVerdict(null, [], 0).state, 'incomplete');
});

test('长度比说明用「字符」,与按字符数计算的实现一致', () => {
  const r = run([P(1, 'ab', '中'.repeat(20))]);
  const m = r.issues.filter(i => i.type === 'ratio')[0].message;
  assert.ok(m.includes('译文 20 字符') && m.includes('原文 2 字符'));
  assert.ok(!/\d 字[,)]/.test(m));
});

test('导出标注合成示例:问题清单 CSV / Markdown / 带问题列的双语表;非示例不带', () => {
  const pairs = [P(1, 'a', '')];
  const r = C.check(pairs, [], {});
  assert.ok(C.issuesToCsv(r.issues, { sample: true }).split('\r\n')[0].endsWith('数据来源'));
  assert.ok(C.issuesToCsv(r.issues, { sample: true }).split('\r\n')[1].endsWith('合成示例'));
  assert.ok(!C.issuesToCsv(r.issues).includes('数据来源'));
  assert.ok(C.issuesToMarkdown(r.issues, r.stats, { pairs, sample: true }).includes('数据来源:合成示例'));
  assert.ok(!C.issuesToMarkdown(r.issues, r.stats, { pairs }).includes('合成示例'));
  const an = C.annotatedCsv(pairs, r.issues, { sample: true }).split('\r\n');
  assert.ok(an[0].endsWith('数据来源') && an[1].endsWith('合成示例'));
  assert.ok(!C.annotatedCsv(pairs, r.issues).includes('数据来源'));
});

test('备份:导出对象带 app/version;导入校验类型、字段、长度,不合法整份拒绝', () => {
  const st = ST({ tableText: '1\ta\tb', glossaryText: 'x | y', caseSensitive: true });
  const b = C.backupObject(st);
  assert.strictEqual(b.app, 'transcheck');
  assert.strictEqual(b.version, 1);
  const ok = C.validateBackup(JSON.stringify(b));
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.state.caseSensitive, true);
  assert.strictEqual(C.validateBackup('{bad').ok, false);
  assert.strictEqual(C.validateBackup(JSON.stringify(Object.assign({}, b, { version: 2 }))).ok, false);
  assert.strictEqual(C.validateBackup(JSON.stringify(Object.assign({}, b, { app: 'other' }))).ok, false);
  assert.strictEqual(C.validateBackup(JSON.stringify(Object.assign({}, b, { state: Object.assign({}, st, { mode: 'x' }) }))).ok, false);
  assert.strictEqual(C.validateBackup(JSON.stringify(Object.assign({}, b, { state: Object.assign({}, st, { caseSensitive: 'yes' }) }))).ok, false);
  assert.strictEqual(C.validateBackup(JSON.stringify(Object.assign({}, b, { state: Object.assign({}, st, { tableText: 'x'.repeat(C.MAX_TEXT_CHARS + 1) }) }))).ok, false);
});
