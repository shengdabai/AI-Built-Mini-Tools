'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const C = require('../core.js');

const row = o => Object.assign(Object.create(null), o);

test('占位符解析:普通字段与默认值', () => {
  const p = C.parseTemplate('你好 {{姓名}},{{称呼|同学}}!');
  assert.deepStrictEqual(p.errors, []);
  assert.deepStrictEqual(p.fields, ['姓名', '称呼']);
  const v = p.tokens.filter(t => t.type === 'var');
  assert.strictEqual(v[0].def, null);
  assert.strictEqual(v[1].def, '同学');
});

test('条件块:非空为真,空/空白为假', () => {
  const t = C.parseTemplate('A{{#if 补课}}补课:{{补课}}{{/if}}B').tokens;
  assert.strictEqual(C.render(t, row({ 补课: '周六' })).text, 'A补课:周六B');
  assert.strictEqual(C.render(t, row({ 补课: '' })).text, 'AB');
  assert.strictEqual(C.render(t, row({ 补课: '   ' })).text, 'AB');
  assert.strictEqual(C.render(t, row({})).text, 'AB');
});

test('独占一行的条件标签不留空行', () => {
  const t = C.parseTemplate('甲\n{{#if x}}\n乙:{{x}}\n{{/if}}\n丙').tokens;
  assert.strictEqual(C.render(t, row({ x: '' })).text, '甲\n丙');
  assert.strictEqual(C.render(t, row({ x: '1' })).text, '甲\n乙:1\n丙');
});

test('条件块内被隐藏的占位符不计入未填', () => {
  const t = C.parseTemplate('{{#if 补课}}{{地点}}{{/if}}').tokens;
  assert.strictEqual(C.render(t, row({ 补课: '', 地点: '' })).missing.length, 0);
  assert.deepStrictEqual(C.render(t, row({ 补课: 'x', 地点: '' })).missing, ['地点']);
});

test('嵌套条件块报错并带行号', () => {
  const p = C.parseTemplate('a\n{{#if x}}\n{{#if y}}\n{{/if}}');
  assert.ok(p.errors.some(e => e.line === 3 && /嵌套/.test(e.message)));
});

test('未闭合占位符报错位置', () => {
  const p = C.parseTemplate('第一行\n第二行 {{姓名\n第三行');
  assert.strictEqual(p.errors.length, 1);
  assert.strictEqual(p.errors[0].line, 2);
  assert.match(p.errors[0].message, /未闭合/);
});

test('条件块不配对与多余 /if', () => {
  assert.ok(C.parseTemplate('{{#if a}}x').errors.some(e => e.line === 1 && /不配对/.test(e.message)));
  assert.ok(C.parseTemplate('x\n{{/if}}').errors.some(e => e.line === 2));
});

test('非法字段名报错', () => {
  assert.ok(C.parseTemplate('{{a/b}}').errors.length === 1);
  assert.ok(C.parseTemplate('{{}}').errors.length === 1);
  assert.ok(C.parseTemplate('{{#if a|b}}x{{/if}}').errors.some(e => /非法/.test(e.message)));
});

test('分隔符识别:逗号、制表符、分号', () => {
  assert.strictEqual(C.parseData('a,b\n1,2').delimiter, ',');
  assert.strictEqual(C.parseData('a\tb\n1\t2').delimiter, '\t');
  assert.strictEqual(C.parseData('a;b\n1;2').delimiter, ';');
  assert.deepStrictEqual(C.parseData('a\tb,c\n1\t2,3').headers, ['a', 'b,c']);
});

test('引号内的分隔符与换行', () => {
  const d = C.parseData('姓名,备注\n"李,明","第一行\n第二行"\n王五,x');
  assert.strictEqual(d.rows[0].values['姓名'], '李,明');
  assert.strictEqual(d.rows[0].values['备注'], '第一行\n第二行');
  assert.strictEqual(d.rows[1].line, 4);
  assert.deepStrictEqual(d.errors, []);
});

test('列数不等报错并带行号,仍保留该行', () => {
  const d = C.parseData('a,b\n1,2\n3,4,5\n6');
  assert.strictEqual(d.errors.length, 2);
  assert.deepStrictEqual(d.errors.map(e => e.line), [3, 4]);
  assert.strictEqual(d.rows.length, 3);
  assert.strictEqual(d.rows[2].values.b, '');
  assert.strictEqual(d.rows[1].bad, true);
});

test('表头重复与非法字段名报错', () => {
  assert.ok(C.parseData('a,a\n1,2').errors.some(e => /重复/.test(e.message)));
  assert.ok(C.parseData('a/b,c\n1,2').errors.some(e => /非法/.test(e.message)));
});

test('缺字段高亮与计数', () => {
  const t = C.parseTemplate('{{姓名}}-{{班级}}-{{老师|王老师}}').tokens;
  const r = C.render(t, row({ 姓名: '小明', 班级: '', 老师: '' }));
  assert.deepStrictEqual(r.missing, ['班级']);
  assert.strictEqual(r.text, '小明-{{班级}}-王老师');
  assert.deepStrictEqual(r.parts.map(p => p.k), ['val', 'text', 'miss', 'text', 'def']);
});

test('fileName 清洗路径分隔符与控制字符', () => {
  assert.strictEqual(C.fileName('{{姓名}}-通知.txt', row({ 姓名: '小明' })), '小明-通知.txt');
  const bad = C.fileName('{{姓名}}.txt', row({ 姓名: '../../etc/passwd' }));
  assert.ok(!/[\/\\]/.test(bad) && !bad.includes('..'), bad);
  assert.ok(!/[\u0000-\u001f]/.test(C.fileName('{{姓名}}.txt', row({ 姓名: 'a\u0000b\nc' }))));
  assert.strictEqual(C.fileName('{{姓名}}', row({ 姓名: '' })), 'untitled');
});

test('uniqueNames 同名加序号', () => {
  assert.deepStrictEqual(C.uniqueNames(['a.txt', 'a.txt', 'A.txt']), ['a.txt', 'a-2.txt', 'A-3.txt']);
});

test('renderAll 行数、未填合计、文件名', () => {
  const r = C.renderAll('Hi {{姓名}} {{班级}}', '姓名,班级\n甲,一\n乙,\n丙,三', { filePattern: '{{姓名}}.txt' });
  assert.strictEqual(r.results.length, 3);
  assert.strictEqual(r.missingTotal, 1);
  assert.deepStrictEqual(r.results.map(x => x.file), ['甲.txt', '乙.txt', '丙.txt']);
});

test('任一数据解析错误都阻断整批生成(列数不等/重复表头/引号未闭合)', () => {
  const cases = { 列数不等: 'a,b\n1,2\n3,4,5', 重复表头: 'a,a\n1,2', 引号未闭合: 'a,b\n1,"2\n3,4' };
  Object.keys(cases).forEach(k => {
    const r = C.renderAll('{{a}}', cases[k]);
    assert.ok(r.dataErrors.length > 0, k + ' 应报数据错误');
    assert.strictEqual(r.results.length, 0, k + ' 不得生成结果');
  });
  assert.strictEqual(C.renderAll('{{a}}', 'a,b\n1,2').results.length, 1);
});

test('模板有错时 renderAll 不输出结果', () => {
  const r = C.renderAll('{{a', 'a\n1');
  assert.strictEqual(r.results.length, 0);
  assert.strictEqual(r.templateErrors.length, 1);
});

test('字段差异', () => {
  const d = C.fieldDiff(['姓名', '电话'], ['姓名', '班级']);
  assert.deepStrictEqual(d.missingInData, ['电话']);
  assert.deepStrictEqual(d.unusedInTemplate, ['班级']);
});

test('空模板与空数据', () => {
  const p = C.parseTemplate('');
  assert.deepStrictEqual([p.tokens.length, p.fields.length, p.errors.length], [0, 0, 0]);
  const r = C.renderAll('', '');
  assert.strictEqual(r.templateEmpty, true);
  assert.strictEqual(r.dataEmpty, true);
  assert.strictEqual(r.results.length, 0);
  assert.deepStrictEqual(C.parseData('  \n ').rows, []);
});

test('CSV 公式防护:= + - @ 开头加单引号,单独的 - + 不加', () => {
  const res = [{ values: row({ a: '=1+1', b: '-', c: '+', d: '@x', e: '-5', f: '正常,含逗号' }), text: '=HYPERLINK("x")', missing: [] }];
  const csv = C.toCsv(['a', 'b', 'c', 'd', 'e', 'f'], res).replace(/^﻿/, '');
  const line = csv.split('\r\n')[1];
  assert.strictEqual(line, `'=1+1,-,+,'@x,'-5,"正常,含逗号","'=HYPERLINK(""x"")",0`);
});

test('保存与读取共用校验:半成品模板允许,超过上限拒绝', () => {
  const mk = (t, d) => ({ version: 1, template: t, data: d });
  assert.strictEqual(C.validateImport(mk('你好 {{姓名\n{{#if x}}', 'a,b\n1')).ok, true);
  assert.strictEqual(C.validateImport(mk('x'.repeat(C.LIMITS.template), '')).ok, true);
  const over = C.validateImport(mk('x'.repeat(C.LIMITS.template + 1), ''));
  assert.strictEqual(over.ok, false);
  assert.match(over.errors[0], /template/);
  assert.strictEqual(C.validateImport(mk('', 'x'.repeat(C.LIMITS.data + 1))).ok, false);
});

test('字段名为 __proto__ 不污染', () => {
  const d = C.parseData('__proto__,constructor\n1,2');
  assert.strictEqual(d.rows[0].values['__proto__'], '1');
  assert.strictEqual({}.polluted, undefined);
  assert.strictEqual(Object.getPrototypeOf(d.rows[0].values), null);
});

test('validateImport 拒绝非法备份', () => {
  assert.strictEqual(C.validateImport('{').ok, false);
  assert.strictEqual(C.validateImport([]).ok, false);
  assert.strictEqual(C.validateImport({ version: 1, template: 1, data: '' }).ok, false);
  assert.strictEqual(C.validateImport({ version: 2, template: '', data: '' }).ok, false);
  const ok = C.validateImport({ version: 1, template: 'x', data: 'a\n1' });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.value.separator, '----------');
});

test('zip:结构合法,python zipfile 能校验并解出原内容(含中文文件名)', () => {
  const files = [{ name: '小明-通知.txt', content: '你好,小明' }, { name: 'b.txt', content: 'line1\nline2' }];
  const zip = C.makeZip(files);
  assert.strictEqual(C.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tplzip-'));
  const zp = path.join(dir, 't.zip');
  fs.writeFileSync(zp, zip);
  const py = 'import zipfile,sys,json;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps({i.filename:z.read(i).decode("utf8") for i in z.infolist()},ensure_ascii=False))';
  const out = JSON.parse(execFileSync('python3', ['-I', '-c', py, zp], { encoding: 'utf8' }));
  assert.deepStrictEqual(out, { '小明-通知.txt': '你好,小明', 'b.txt': 'line1\nline2' });
  execFileSync('unzip', ['-tqq', zp]);
});

test('文件名模板纳入检查:语法错误、模板字段不在数据列里、逐条缺值', () => {
  const data = '姓名,班级\n小明,一班\n,二班\n';
  const ok = C.renderAll('{{姓名}}好', data, { filePattern: '{{姓名}}-通知.txt' });
  assert.equal(ok.fileErrors.length, 0);
  assert.deepEqual(ok.fileDiff.missingInData, []);
  assert.equal(ok.results[0].fileMissing.length, 0);
  assert.deepEqual(ok.results[1].fileMissing, ['姓名']);
  assert.equal(ok.fileMissingTotal, 1);
  assert.equal(ok.fileBlocked, false);
  const unclosed = C.renderAll('{{姓名}}', data, { filePattern: '{{姓名-通知.txt' });
  assert.ok(unclosed.fileErrors.length > 0);
  assert.equal(unclosed.fileBlocked, true);
  assert.equal(unclosed.templateErrors.length, 0);
  const noCol = C.renderAll('{{姓名}}', data, { filePattern: '{{学号}}-通知.txt' });
  assert.deepEqual(noCol.fileDiff.missingInData, ['学号']);
  assert.equal(noCol.fileBlocked, true);
  assert.ok(C.fileCheckMessages(noCol).some(m => m.includes('学号')));
  const withDefault = C.renderAll('{{姓名}}', data, { filePattern: '{{姓名|无名}}.txt' });
  assert.equal(withDefault.fileMissingTotal, 0);
  assert.equal(withDefault.results[1].file, '无名.txt');
});

test('removeExtraColumns:只删表头之外多出的末尾列,列数不足的行不动,并说明改了哪些行', () => {
  const text = 'a,b,c\n1,2,3\n4,5,6,多余\n7,8\n';
  const r = C.removeExtraColumns(text);
  assert.equal(r.changed, true);
  assert.deepEqual(r.fixedLines, [3]);
  const re = C.parseData(r.text);
  assert.equal(re.errors.length, 1);
  assert.ok(/第 4 行/.test(re.errors[0].message));
  assert.equal(re.rows[1].values.c, '6');
  assert.equal(C.removeExtraColumns('a,b\n1,2\n').changed, false);
  assert.equal(C.removeExtraColumns('').changed, false);
  const q = C.removeExtraColumns('名,话\n"小,明","说""你好"""\nx,y,z\n');
  assert.equal(q.text.includes('"小,明"'), true);
  assert.equal(C.parseData(q.text).errors.length, 0);
  const err = C.parseData('a,b\n1,2,3\n').errors[0];
  assert.equal(err.kind, 'cols');
  assert.equal(err.extra, 1);
});

test('lineRange:返回第 N 行在文本里的起止位置,用于定位到出错行', () => {
  const t = 'ab\ncd\nef';
  assert.deepEqual(C.lineRange(t, 1), [0, 2]);
  assert.deepEqual(C.lineRange(t, 2), [3, 5]);
  assert.deepEqual(C.lineRange(t, 3), [6, 8]);
  assert.equal(C.lineRange(t, 4), null);
  assert.deepEqual(C.lineRange('a\r\nb', 2), [3, 4]);
});

test('replaceScope:模板、数据、自定义文件名、自定义分隔线都算用户数据,文案列出替换范围', () => {
  const def = { template: '', data: '', filePattern: '{{姓名}}-通知.txt', separator: '----------' };
  assert.equal(C.replaceScope(def).any, false);
  assert.equal(C.replaceScope(Object.assign({}, def, { filePattern: '{{学号}}.txt' })).any, true);
  assert.equal(C.replaceScope(Object.assign({}, def, { separator: '=====' })).any, true);
  const sc = C.replaceScope({ template: '你好\n{{姓名}}', data: '姓名\n小明\n小红', filePattern: 'x.txt', separator: '==' });
  assert.equal(sc.templateChars, 9);
  assert.equal(sc.dataRows, 2);
  const d = C.describeScope(sc);
  assert.ok(d.includes('模板') && d.includes('数据 2 行') && d.includes('文件名模板「x.txt」') && d.includes('分隔线「==」'));
});

test('sample 标记:validateImport 保留并拒绝非布尔;CSV 带数据来源列', () => {
  const base = { version: 1, template: 't', data: 'd' };
  assert.equal(C.validateImport(Object.assign({ sample: true }, base)).value.sample, true);
  assert.equal(C.validateImport(base).value.sample, false);
  assert.equal(C.validateImport(Object.assign({ sample: 'x' }, base)).ok, false);
  const r = C.renderAll('{{姓名}}', '姓名\n小明\n');
  const csv = C.toCsv(r.headers, r.results, { sample: true }).replace(/^﻿/, '').split('\r\n');
  assert.ok(csv[0].endsWith(',数据来源') && csv[1].endsWith(',合成示例'));
  assert.ok(!C.toCsv(r.headers, r.results).includes('数据来源'));
});

test('checkSummary:模板、数据、文件名任何一处有错都写「检查未完成」,全部通过才写通过', () => {
  const good = C.renderAll('{{姓名}}', '姓名\n小明\n', { filePattern: '{{姓名}}.txt' });
  const s1 = C.checkSummary(good);
  assert.equal(s1.state, 'ok');
  assert.equal(s1.errorCount, 0);
  const badFile = C.renderAll('{{姓名}}', '姓名\n小明\n', { filePattern: '{{学号}}.txt' });
  const s2 = C.checkSummary(badFile);
  assert.equal(s2.state, 'errors');
  assert.ok(s2.text.includes('检查未完成') && !s2.text.includes('没有发现错误'));
  const badData = C.renderAll('{{姓名}}', '姓名\n小明,多\n');
  assert.equal(C.checkSummary(badData).state, 'errors');
  assert.equal(C.checkSummary(C.renderAll('', '')).state, 'empty');
});
