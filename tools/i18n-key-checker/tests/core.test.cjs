'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

function F(lang, obj, extra) {
  return Object.assign({ lang, name: lang, format: 'json', nested: false, entries: Object.entries(obj) }, extra || {});
}
function find(res, type, lang, key) {
  return res.issues.filter((i) => i.type === type && (!lang || i.lang === lang) && (!key || i.key === key));
}

test('detectFormat 识别 JSON / properties / CSV / 空 / 未知', () => {
  assert.equal(C.detectFormat('{"a":"b"}'), 'json');
  assert.equal(C.detectFormat('﻿  {"a":"b"}'), 'json');
  assert.equal(C.detectFormat('# 注释\nnav.home=首页\n'), 'properties');
  assert.equal(C.detectFormat('nav.home: 首页'), 'properties');
  assert.equal(C.detectFormat('key, zh, en\na,b,c'), 'csv');
  assert.equal(C.detectFormat('"key","zh"\n"a","b"'), 'csv');
  assert.equal(C.detectFormat('   \n '), 'empty');
  assert.equal(C.detectFormat(''), 'empty');
  assert.equal(C.detectFormat('随便一句话'), 'unknown');
});

test('flatten / unflatten 往返并保持键顺序', () => {
  const obj = { z: { b: '1', a: '2' }, m: '3', arr: ['x', 'y'] };
  const flat = C.flatten(obj);
  assert.deepEqual(flat, [['z.b', '1'], ['z.a', '2'], ['m', '3'], ['arr.0', 'x'], ['arr.1', 'y']]);
  const back = C.unflatten(flat);
  assert.deepEqual(Object.keys(back), ['z', 'm', 'arr']);
  assert.deepEqual(Object.keys(back.z), ['b', 'a']);
  assert.equal(back.arr['1'], 'y');
});

test('flatten 拒绝非字符串叶子、空对象、路径冲突;unflatten 拒绝键冲突', () => {
  assert.throws(() => C.flatten({ a: 1 }), /不是字符串/);
  assert.throws(() => C.flatten({ a: null }), /null/);
  assert.throws(() => C.flatten({ a: {} }), /空对象/);
  assert.throws(() => C.flatten({ a: [] }), /空数组/);
  assert.throws(() => C.flatten({ 'a.b': 'x', a: { b: 'y' } }), /键重复/);
  assert.throws(() => C.unflatten([['a', 'x'], ['a.b', 'y']]), /键冲突/);
  assert.throws(() => C.unflatten([['a.b', 'y'], ['a', 'x']]), /键冲突/);
  assert.throws(() => C.unflatten([['a..b', 'x']]), /空段/);
});

test('__proto__ 键不污染原型也不丢失', () => {
  const r = C.parseJson('{"__proto__":{"x":"y"},"constructor":"c"}');
  assert.deepEqual(r.entries, [['__proto__.x', 'y'], ['constructor', 'c']]);
  assert.equal({}.x, undefined);
  const out = JSON.parse(C.toJson(r.entries, true));
  assert.equal(Object.getOwnPropertyDescriptor(out, '__proto__').value.x, 'y');
});

test('parseJson 报错带原因,顶层必须是对象', () => {
  assert.throws(() => C.parseJson('{bad'), /JSON 解析失败/);
  assert.throws(() => C.parseJson('[1]'), /顶层必须是对象/);
  assert.throws(() => C.parseJson('"x"'), /顶层必须是对象/);
  assert.equal(C.parseJson('{"a":"b"}').nested, false);
  assert.equal(C.parseJson('{"a":{"b":"c"}}').nested, true);
});

test('parseProperties:注释、分隔符、转义、续行、重复键', () => {
  const t = '# c\n! c2\na.b = hello world\nc:冒号\nd\\=e=f\ng=\\u4e2d\\n文\nh=line1 \\\n   line2\nempty=\n';
  const r = C.parseProperties(t).entries;
  assert.deepEqual(r, [['a.b', 'hello world'], ['c', '冒号'], ['d=e', 'f'], ['g', '中\n文'], ['h', 'line1 line2'], ['empty', '']]);
  assert.throws(() => C.parseProperties('a=1\na=2'), /键重复/);
  assert.throws(() => C.parseProperties('=x'), /键名为空/);
  assert.throws(() => C.parseProperties('a=\\u12'), /\\u/);
});

test('parseCsv:引号、逗号、换行、转义引号;引号未闭合与多余字符整份拒绝', () => {
  const rows = C.parseCsv('key,zh\r\na,"x, y"\r\nb,"line1\nline2"\r\nc,"he said ""hi"""\r\n');
  assert.deepEqual(rows, [['key', 'zh'], ['a', 'x, y'], ['b', 'line1\nline2'], ['c', 'he said "hi"']]);
  assert.throws(() => C.parseCsv('key,zh\na,"未闭合\nb,c'), /引号未闭合/);
  assert.throws(() => C.parseCsv('key,zh\na,"x"y'), /多余字符/);
  assert.deepEqual(C.parseCsv('a,\n,b'), [['a', ''], ['', 'b']]);
});

test('parseCsvTranslations:多语言列、表头校验、列数不一致整份拒绝、重复键', () => {
  const fs = C.parseCsvTranslations('key, zh, en\nnav.home,首页,Home\nnav.back,返回,\n');
  assert.deepEqual(fs.map((f) => f.lang), ['zh', 'en']);
  assert.deepEqual(fs[1].entries, [['nav.home', 'Home'], ['nav.back', '']]);
  assert.throws(() => C.parseCsvTranslations('id,zh\na,b'), /key/);
  assert.throws(() => C.parseCsvTranslations('key,zh\na,b,c'), /列/);
  assert.throws(() => C.parseCsvTranslations('key,zh\na,b\na,c'), /键重复/);
  assert.throws(() => C.parseCsvTranslations('key,zh,ZH\na,b,c'), /重复/);
  assert.throws(() => C.parseCsvTranslations('key,中文\na,b'), /语言代码/);
  assert.throws(() => C.parseCsvTranslations('key,zh\n'), /没有任何键/);
});

test('importText:空文件、未知格式、缺语言代码被拒绝;guessLang', () => {
  assert.throws(() => C.importText('  ', 'en'), /文件为空/);
  assert.throws(() => C.importText('hello', 'en'), /无法识别/);
  assert.throws(() => C.importText('{"a":"b"}', ''), /语言代码/);
  assert.equal(C.importText('{"a":"b"}', 'en')[0].lang, 'en');
  assert.equal(C.guessLang('zh-CN.json'), 'zh-CN');
  assert.equal(C.guessLang('messages_ja.properties'), 'ja');
  assert.equal(C.guessLang('app.en.json'), 'en');
  assert.equal(C.guessLang('my-app.json'), null);
});

test('placeholders:各类型,去重,%% 与百分号文字不误判', () => {
  assert.deepEqual(C.placeholders('Hi {name}, {{count}} items, %s %d %1$d %2$s, $t(common.ok)'),
    ['{name}', '{{count}}', '%s', '%d', '%1$d', '%2$s', '$t(common.ok)']);
  assert.deepEqual(C.placeholders('{ name } {name}'), ['{name}']);
  assert.deepEqual(C.placeholders('{{ count }}'), ['{{count}}']);
  assert.deepEqual(C.placeholders('折扣 50% 和 100%% 不是占位符'), []);
  assert.deepEqual(C.placeholders('{n, number}'), ['{n}']);
  assert.deepEqual(C.placeholders('$t(common.email, {"x": 1})'), ['$t(common.email, {"x": 1})']);
  assert.deepEqual(C.placeholders(''), []);
});

test('htmlTags:开闭标签、自闭合、void 标签规范化', () => {
  assert.deepEqual(C.htmlTags('<b>x</b> <a href="/t">y</a><br/><br>'), ['<b>', '</b>', '<a>', '</a>', '<br>']);
  assert.deepEqual(C.htmlTags('<Icon/> a < b'), ['<Icon/>']);
  assert.deepEqual(C.htmlTags('没有标签'), []);
});

test('check:缺键与多键为阻断,带键名与语言', () => {
  const r = C.check([F('zh', { a: '甲', b: '乙' }), F('en', { a: 'A', c: 'C' })], 'zh', { keyPattern: '' });
  const m = find(r, 'missing');
  assert.equal(m.length, 1);
  assert.deepEqual([m[0].lang, m[0].key, m[0].level], ['en', 'b', 'block']);
  const x = find(r, 'extra');
  assert.equal(x.length, 1);
  assert.deepEqual([x[0].lang, x[0].key, x[0].level], ['en', 'c', 'block']);
});

test('check:空值(含纯空白)阻断,且不再叠加其他检查', () => {
  const r = C.check([F('zh', { a: '你好 {n}' }), F('en', { a: '   ' })], 'zh', { keyPattern: '' });
  assert.equal(find(r, 'empty', 'en', 'a').length, 1);
  assert.equal(r.issues.length, 1);
  const s = C.check([F('zh', { a: '' }), F('en', { a: 'x' })], 'zh', { keyPattern: '' });
  assert.equal(find(s, 'empty', 'zh', 'a').length, 1);
});

test('check:占位符缺失/多余/类型不同与 HTML 标签不一致阻断', () => {
  const zh = F('zh', { a: '{{count}} 个', b: '你好 {name}', c: '<b>粗</b>', d: '%s 条', e: '无占位' });
  const en = F('en', { a: '{count} items', b: 'Hello', c: '<b>bold', d: '%d rows', e: 'None {x}' });
  const r = C.check([zh, en], 'zh', { keyPattern: '' });
  assert.equal(find(r, 'placeholder', 'en', 'a').length, 1);
  assert.match(find(r, 'placeholder', 'en', 'a')[0].message, /缺 \{\{count\}\}.*多 \{count\}/);
  assert.equal(find(r, 'placeholder', 'en', 'b').length, 1);
  assert.equal(find(r, 'html', 'en', 'c').length, 1);
  assert.match(find(r, 'html', 'en', 'c')[0].message, /缺 <\/b>/);
  assert.equal(find(r, 'placeholder', 'en', 'd').length, 1);
  assert.equal(find(r, 'placeholder', 'en', 'e').length, 1);
  assert.ok(find(r, 'placeholder').every((i) => i.level === 'block'));
});

test('check:占位符顺序不同但集合相同不报', () => {
  const r = C.check([F('zh', { a: '{x} 和 {y}' }), F('en', { a: '{y} and {x}' })], 'zh', { keyPattern: '' });
  assert.equal(find(r, 'placeholder').length, 0);
});

test('check:与源相同为警告;允许相同(通配符)可豁免', () => {
  const files = [F('zh', { 'brand.name': 'StarNote', 'brand.slogan': 'StarNote', t: '关闭' }), F('en', { 'brand.name': 'StarNote', 'brand.slogan': 'StarNote', t: '关闭' })];
  const r1 = C.check(files, 'zh', { keyPattern: '' });
  assert.equal(find(r1, 'same').length, 3);
  assert.ok(find(r1, 'same').every((i) => i.level === 'warn'));
  const r2 = C.check(files, 'zh', { keyPattern: '', allowSame: ['brand.*'] });
  assert.deepEqual(find(r2, 'same').map((i) => i.key), ['t']);
  const r3 = C.check(files, 'zh', { keyPattern: '', allowSame: ['brand.name'] });
  assert.equal(find(r3, 'same').length, 2);
});

test('check:长度比 > 3 或 < 0.3 警告,边界值不报', () => {
  const r = C.check([F('zh', { a: '1234567890', b: '1234567890', c: '1234567890', d: '1234567890' }),
    F('en', { a: 'x'.repeat(31), b: 'x'.repeat(30), c: 'x'.repeat(2), d: 'x'.repeat(3) })], 'zh', { keyPattern: '' });
  assert.deepEqual(find(r, 'ratio').map((i) => i.key), ['a', 'c']);
});

test('check:长度比按显示宽度,CJK 算 2,中文对英文的正常译文不误报;emoji 按码点算 1', () => {
  const r = C.check([F('zh', { a: '首页', b: '😀😀', c: '网络连接失败' }), F('en', { a: 'Home', b: 'ab', c: 'Network failed' })], 'zh', { keyPattern: '' });
  assert.equal(find(r, 'ratio').length, 0);
  const r2 = C.check([F('zh', { a: '首页' }), F('en', { a: 'Home page of the application' })], 'zh', { keyPattern: '' });
  assert.deepEqual(find(r2, 'ratio').map((i) => i.key), ['a']);
});

test('check:键名正则(默认与自定义,空串关闭,非法正则抛错)', () => {
  const files = [F('zh', { 'nav.home': '首页', 'Nav.Home': '首页2', 'btn-save': '存', 'items.0': '零' }), F('en', { 'nav.home': 'Home', 'Nav.Home': 'Home2', 'btn-save': 'S', 'items.0': 'zero' })];
  const r = C.check(files, 'zh');
  assert.deepEqual(find(r, 'keyname').map((i) => i.key).sort(), ['Nav.Home', 'btn-save']);
  assert.equal(find(r, 'keyname').length, 2, '同一个键只报一次');
  const r2 = C.check(files, 'zh', { keyPattern: '^[a-z.]+$' });
  assert.equal(find(r2, 'keyname').length, 3);
  assert.equal(find(C.check(files, 'zh', { keyPattern: '' }), 'keyname').length, 0);
  assert.throws(() => C.check(files, 'zh', { keyPattern: '(' }), /键名正则无效/);
});

test('check:复数集合 —— 英语缺 other 既警告又缺键,日语只需 other,源只有 other 时英语多出 _one 不算多键', () => {
  const zh = F('zh', { 'n_other': '{{count}} 篇' });
  const en = F('en', { 'n_one': '{{count}} note' });
  const ja = F('ja', { 'n_other': '{{count}} 件' });
  const r = C.check([zh, en, ja], 'zh', { keyPattern: '' });
  const p = find(r, 'plural');
  assert.deepEqual(p.map((i) => i.lang), ['en']);
  assert.match(p[0].message, /缺 _other/);
  assert.deepEqual(find(r, 'missing').map((i) => i.lang + ':' + i.key), ['en:n_other'], '按实际键报缺,复数警告另算');
  const ok = C.check([zh, F('en', { n_one: '{{count}} note', n_other: '{{count}} notes' }), ja], 'zh', { keyPattern: '' });
  assert.equal(find(ok, 'plural').length, 0);
  assert.equal(find(ok, 'extra').length, 0);
});

test('check:复数点号风格与俄语需要 one/few/many/other', () => {
  const zh = F('zh', { 'm.other': '{{n}} 条' });
  const ru = F('ru', { 'm.one': '{{n}} сообщение', 'm.other': '{{n}} сообщений' });
  const r = C.check([zh, ru], 'zh', { keyPattern: '' });
  assert.match(find(r, 'plural', 'ru')[0].message, /缺 \.few、\.many/);
});

test('check:孤立的 step.one / step.two 不被当成复数组', () => {
  const r = C.check([F('zh', { 'step.one': '一', 'step.two': '二' }), F('en', { 'step.one': 'One', 'step.two': 'Two' })], 'zh', { keyPattern: '' });
  assert.equal(find(r, 'plural').length, 0);
});

test('check:同源文本在不同键下译法不同', () => {
  const zh = F('zh', { 'a.save': '保存', 'b.save': '保存', 'c.save': '保存', x: '别的' });
  const en = F('en', { 'a.save': 'Save', 'b.save': 'Store', 'c.save': 'Save', x: 'Other' });
  const r = C.check([zh, en], 'zh', { keyPattern: '' });
  const inc = find(r, 'inconsistent');
  assert.equal(inc.length, 1);
  assert.deepEqual(inc[0].related, ['a.save', 'b.save', 'c.save']);
  const same = C.check([zh, F('en', { 'a.save': 'Save', 'b.save': 'Save', 'c.save': 'Save', x: 'Other' })], 'zh', { keyPattern: '' });
  assert.equal(find(same, 'inconsistent').length, 0);
});

test('stats:覆盖率、未译率、整体进度的计算', () => {
  const zh = F('zh', { a: '一', b: '二', c: '三', d: '四' });
  const en = F('en', { a: 'One', b: '', c: '三', x: 'Extra' });
  const ja = F('ja', { a: '一つ', b: '二つ', c: '三つ', d: '四つ' });
  const { stats } = C.check([zh, en, ja], 'zh', { keyPattern: '' });
  const e = stats.langs.find((s) => s.lang === 'en');
  assert.equal(e.total, 4);
  assert.equal(e.covered, 2, 'a 与 c 非空即覆盖(c 与源相同仍算有值)');
  assert.equal(e.coverage, 0.5);
  assert.equal(e.untranslated, 3, '缺 d、空 b、与源相同 c');
  assert.equal(e.untranslatedRate, 0.75);
  assert.equal(e.missing, 1);
  assert.equal(e.extra, 1);
  assert.equal(e.empty, 1);
  assert.equal(stats.langs.find((s) => s.lang === 'ja').coverage, 1);
  assert.equal(stats.overall.coverage, (2 + 4) / 8);
  assert.equal(stats.overall.targetCount, 2);
  assert.equal(stats.overall.blockers, e.blockers);
  assert.equal(stats.overall.issues, stats.overall.blockers + stats.overall.warnings);
});

test('空文件:没有键时不崩溃,报阻断,覆盖率为 0', () => {
  const r = C.check([F('zh', {}), F('en', {})], 'zh');
  assert.equal(find(r, 'emptyfile').length, 2);
  assert.equal(r.stats.total, 0);
  assert.equal(r.stats.overall.coverage, 0);
  const r2 = C.check([F('zh', { a: '甲' }), F('en', {})], 'zh', { keyPattern: '' });
  assert.equal(find(r2, 'emptyfile', 'en').length, 1);
  assert.equal(find(r2, 'missing', 'en', 'a').length, 1);
});

test('check 参数校验:源语言不存在、语言重复', () => {
  assert.throws(() => C.check([F('zh', { a: 'b' })], 'en'), /源语言/);
  assert.throws(() => C.check([F('zh', { a: 'b' }), F('ZH', { a: 'b' })], 'zh'), /语言重复/);
});

test('todoTable:列为 key / source:源语言 / 各目标语言,只列需要翻译的键,目标列为空', () => {
  const zh = F('zh', { a: '甲', b: '乙', c: '丙' });
  const en = F('en', { a: 'A', b: '' });
  const ja = F('ja', { a: '甲', b: '乙ja', c: '丙ja' });
  const t = C.todoTable([zh, en, ja], 'zh');
  const rows = C.parseCsv(t.csv);
  assert.deepEqual(rows[0], ['key', 'source:zh', 'en', 'ja']);
  assert.deepEqual(rows.slice(1), [['b', '乙', '', ''], ['c', '丙', '', '']]);
  assert.equal(t.rows, 2);
  const t2 = C.todoTable([zh, en, ja], 'zh', { includeSame: true });
  assert.deepEqual(C.parseCsv(t2.csv).slice(1).map((r) => r[0]), ['a', 'b', 'c']);
  const t3 = C.todoTable([zh, en, ja], 'zh', { includeSame: true, allowSame: ['a'] });
  assert.deepEqual(C.parseCsv(t3.csv).slice(1).map((r) => r[0]), ['b', 'c']);
});

test('todoTable:没有需要翻译的键时只有表头;复数组已覆盖不列', () => {
  const t = C.todoTable([F('zh', { a: '甲' }), F('en', { a: 'A' })], 'zh');
  assert.equal(t.rows, 0);
  const p = C.todoTable([F('zh', { n_other: '篇' }), F('en', { n_one: 'note', n_other: 'notes' })], 'zh');
  assert.equal(p.rows, 0);
  const q = C.todoTable([F('zh', { n_other: '篇' }), F('en', {})], 'zh');
  assert.equal(q.rows, 1);
});

test('merge:默认只填空键与缺键,不覆盖已有值;可选覆盖', () => {
  const zh = F('zh', { a: '甲', b: '乙', c: '丙' });
  const en = F('en', { a: 'A', c: '' });
  const csv = 'key,source:zh,en\na,甲,A2\nb,乙,B\nc,丙,C\n';
  const r = C.merge([zh, en], csv);
  assert.deepEqual(r.files[1].entries, [['a', 'A'], ['b', 'B'], ['c', 'C']]);
  assert.equal(r.summary.filled, 2);
  assert.equal(r.summary.keptExisting, 1);
  assert.deepEqual(en.entries, [['a', 'A'], ['c', '']], '不修改输入');
  const o = C.merge([zh, en], csv, { overwrite: true });
  assert.deepEqual(o.files[1].entries, [['a', 'A2'], ['b', 'B'], ['c', 'C']]);
  assert.equal(o.summary.overwritten, 1);
  assert.equal(o.files[0], zh, '未涉及的文件原样保留');
});

test('merge:新键按源语言顺序插入,空白单元格忽略', () => {
  const zh = F('zh', { a: '1', b: '2', c: '3', d: '4' });
  const en = F('en', { a: 'A', d: 'D' });
  const r = C.merge([zh, en], 'key,en\nc,C\nb,B\nd,  \n');
  assert.deepEqual(r.files[1].entries.map((e) => e[0]), ['a', 'b', 'c', 'd']);
  assert.equal(r.files[1].entries[3][1], 'D');
});

test('merge 整份拒绝:未知语言列、未知键、重复键、列数不符、引号未闭合', () => {
  const fs = [F('zh', { a: '甲' }), F('en', {})];
  assert.throws(() => C.merge(fs, 'key,fr\na,x'), /不是已导入的语言/);
  assert.throws(() => C.merge(fs, 'key,en\nzzz,x'), /不在任何已导入文件中/);
  assert.throws(() => C.merge(fs, 'key,en\na,x\na,y'), /键重复/);
  assert.throws(() => C.merge(fs, 'key,en\na,x,y'), /列/);
  assert.throws(() => C.merge(fs, 'key,en\na,"x'), /引号未闭合/);
  assert.throws(() => C.merge(fs, 'id,en\na,x'), /key/);
  assert.throws(() => C.merge(fs, ''), /为空/);
});

test('merge 能还原本工具加的公式防护前缀', () => {
  const fs = [F('zh', { a: '甲' }), F('en', {})];
  const r = C.merge(fs, "key,en\na,'=SUM(1)\n");
  assert.equal(r.files[1].entries[0][1], '=SUM(1)');
});

test('toJson:嵌套保持结构与键顺序;扁平输出;冲突抛错', () => {
  const entries = [['z.b', '1'], ['a', '2'], ['z.a', '3']];
  const nested = JSON.parse(C.toJson(entries, true));
  assert.deepEqual(Object.keys(nested), ['z', 'a']);
  assert.deepEqual(Object.keys(nested.z), ['b', 'a']);
  const flat = C.toJson(entries, false);
  assert.deepEqual(Object.keys(JSON.parse(flat)), ['z.b', 'a', 'z.a']);
  assert.ok(flat.endsWith('\n'));
  assert.throws(() => C.toJson([['a', 'x'], ['a.b', 'y']], true), /键冲突/);
  const src = '{\n  "z": {\n    "b": "1",\n    "a": "3"\n  },\n  "a": "2"\n}\n';
  const p = C.parseJson(src);
  assert.equal(C.toJson(p.entries, p.nested), src, '解析再导出文本一致');
});

test('toCsv:公式防护(= + - @,单独的 - + 不算)、引号与换行转义', () => {
  const out = C.toCsv([['=1+1', '+a', '-b', '@c', '-', '+', 'a,b', 'q"q', 'l1\nl2', '普通'], [undefined, null, 5]]);
  assert.equal(out, "'=1+1,'+a,'-b,'@c,-,+,\"a,b\",\"q\"\"q\",\"l1\nl2\",普通\n,,5\n");
  assert.equal(C.protectCell('\t=x'), "'\t=x");
  assert.equal(C.protectCell('a=b'), 'a=b');
});

test('reportToMarkdown / reportToCsv:含统计与问题,单元格转义并防公式', () => {
  const zh = F('zh', { a: '甲', b: '乙' });
  const en = F('en', { a: '=HYPERLINK("x")|y', '<script>|x': 'c', '=cmd': 'z' });
  const res = C.check([zh, en], 'zh', { keyPattern: '' });
  const md = C.reportToMarkdown(res);
  assert.match(md, /^# 多语言文案键核对报告/);
  assert.match(md, /\| en \| 3 \|/);
  assert.match(md, /## 阻断/);
  assert.match(md, /## 警告/);
  assert.doesNotMatch(md, /<script>/);
  assert.match(md, /&lt;script&gt;\\\|x/);
  assert.match(md, /\| '=cmd \|/);
  const csv = C.reportToCsv(res);
  assert.match(csv, /^级别,语言,键,类型,说明,源文本,当前译文\n/);
  assert.ok(csv.includes("\"'=HYPERLINK(\"\"x\"\")|y\"") || csv.includes("'=HYPERLINK"), 'CSV 里公式值带单引号前缀');
  assert.ok(!/(^|,)=HYPERLINK/m.test(csv));
});

test('validateState:合法通过;拒绝类型错、枚举错、重复语言、重复键、源语言缺失、非法正则', () => {
  const good = { v: 1, source: 'zh', files: [{ lang: 'zh', name: 'zh.json', format: 'json', nested: true, entries: [['a', 'b']] }], options: { allowSame: ['brand.*'], keyPattern: '' } };
  assert.equal(C.validateState(good).ok, true);
  assert.equal(C.validateState(C.emptyState()).ok, true);
  const mut = (fn) => { const s = JSON.parse(JSON.stringify(good)); fn(s); return C.validateState(s); };
  assert.equal(mut((s) => { s.files[0].format = 'xml'; }).ok, false);
  assert.equal(mut((s) => { s.files[0].entries[0][1] = 5; }).ok, false);
  assert.equal(mut((s) => { s.files[0].entries.push(['a', 'again']); }).ok, false);
  assert.equal(mut((s) => { s.files.push(JSON.parse(JSON.stringify(s.files[0]))); s.files[1].lang = 'ZH'; }).ok, false);
  assert.equal(mut((s) => { s.source = 'en'; }).ok, false);
  assert.equal(mut((s) => { s.options.keyPattern = '('; }).ok, false);
  assert.equal(mut((s) => { s.options.allowSame = ['']; }).ok, false);
  assert.equal(mut((s) => { s.files[0].lang = '中文'; }).ok, false);
  assert.equal(mut((s) => { s.v = 2; }).ok, false);
  assert.equal(C.validateState(null).ok, false);
  assert.equal(C.validateState([]).ok, false);
});

test('写入校验 = 读取校验:超长值经 JSON 往返后仍通过', () => {
  const long = 'é'.repeat(200000);
  const s = { v: 1, source: 'zh', files: [{ lang: 'zh', name: '', format: 'json', nested: false, entries: [['__proto__', long], ['k', '']] }], options: { allowSame: [], keyPattern: C.DEFAULT_KEY_PATTERN } };
  const v1 = C.validateState(s);
  assert.equal(v1.ok, true);
  const v2 = C.validateState(JSON.parse(JSON.stringify(v1.data)));
  assert.equal(v2.ok, true);
  assert.equal(v2.data.files[0].entries[0][1].length, 200000);
});

test('导入后核对再导出的整体闭环:CSV 多语言 -> check -> todo -> merge -> 缺键消失', () => {
  const files = C.importText('key,zh,en\nnav.home,首页,Home\nnav.back,返回,\nnav.help,帮助,Help\n');
  assert.equal(find(C.check(files, 'zh'), 'empty', 'en').length, 1);
  const todo = C.todoTable(files, 'zh');
  assert.equal(todo.rows, 1);
  const filled = todo.csv.replace('nav.back,返回,', 'nav.back,返回,Back');
  const merged = C.merge(files, filled);
  const res = C.check(merged.files, 'zh');
  assert.equal(res.issues.length, 0);
  assert.equal(res.stats.overall.coverage, 1);
});

test('P0 结构无损:键名含点号与嵌套混用的 JSON 整份拒绝;纯扁平与纯嵌套往返完全一致', () => {
  assert.throws(() => C.parseJson('{"a.b":"x","c":{"d":"y"}}'), /无法无损还原/);
  assert.throws(() => C.parseJson('{"a":{"b.c":"x"}}'), /无法无损还原/);
  const flatSrc = '{\n  "a.b": "x",\n  "c.d": "y"\n}\n';
  const f = C.parseJson(flatSrc);
  assert.equal(f.nested, false);
  assert.equal(C.toJson(f.entries, f.nested), flatSrc);
  const nestedSrc = '{\n  "c": {\n    "d": "y",\n    "e": {\n      "f": "z"\n    }\n  },\n  "a": "x"\n}\n';
  const n = C.parseJson(nestedSrc);
  assert.equal(n.nested, true);
  assert.equal(C.toJson(n.entries, n.nested), nestedSrc);
  const arr = C.parseJson('{"l":["x","y"],"m":{"n":"o"}}');
  assert.equal(arr.nested, true);
  assert.deepEqual(JSON.parse(C.toJson(arr.entries, true)), { l: { 0: 'x', 1: 'y' }, m: { n: 'o' } });
});

test('P1 复数:目标缺 _other 仍是缺键阻断,覆盖率按实际键算;语言不需要的形式缺失不阻断', () => {
  const zh = F('zh', { n_other: '{{count}} 篇' });
  const en = F('en', { n_one: '{{count}} note' });
  const r = C.check([zh, en], 'zh', { keyPattern: '' });
  assert.deepEqual(find(r, 'missing', 'en').map((i) => i.key), ['n_other']);
  assert.equal(find(r, 'plural', 'en').length, 1);
  const es = r.stats.langs.find((x) => x.lang === 'en');
  assert.equal(es.coverage, 0);
  assert.equal(es.missing, 1);
  const en2 = F('en', { n_one: 'a', n_other: 'b' });
  const r2 = C.check([zh, en2], 'zh', { keyPattern: '' });
  assert.equal(find(r2, 'missing').length, 0);
  assert.equal(find(r2, 'extra').length, 0, 'en 需要 _one,多出不算多键');
  assert.equal(r2.stats.langs.find((x) => x.lang === 'en').coverage, 1);
  const src = F('en', { n_one: 'a', n_other: 'b' });
  const ja = F('ja', { n_other: 'c' });
  const r3 = C.check([src, ja], 'en', { keyPattern: '' });
  assert.equal(find(r3, 'missing').length, 0, '日语不需要 _one');
  const ja2 = F('ja', { n_one: 'x', n_other: 'c' });
  assert.deepEqual(find(C.check([src, ja2], 'en', { keyPattern: '' }), 'missing').length, 0);
  const todo = C.todoTable([zh, en], 'zh');
  assert.equal(todo.rows, 1);
});

test('P1 CSV:未引用字段中的裸双引号整份拒绝', () => {
  assert.throws(() => C.parseCsv('key,en\nk,abc"'), /裸双引号|引号/);
  assert.throws(() => C.parseCsv('key,en\nk,ab"c"'), /引号/);
  assert.throws(() => C.parseCsvTranslations('key,en\nk,abc"'), /引号/);
  assert.throws(() => C.merge([F('zh', { k: 'a' }), F('en', {})], 'key,en\nk,abc"'), /引号/);
  assert.deepEqual(C.parseCsv('a,"b""c"\n'), [['a', 'b"c']]);
});

test('第五轮:hasCustomOptions 判断设置是否偏离默认值', () => {
  assert.equal(C.hasCustomOptions(C.emptyState().options), false);
  assert.equal(C.hasCustomOptions({ allowSame: ['brand.*'], keyPattern: C.DEFAULT_KEY_PATTERN }), true);
  assert.equal(C.hasCustomOptions({ allowSame: [], keyPattern: '' }), true);
  assert.equal(C.hasCustomOptions({ allowSame: [], keyPattern: '^x$' }), true);
  assert.equal(C.hasCustomOptions(null), false);
});

test('第五轮:describeRemoval 写明键数与删除源语言后的新源语言', () => {
  const files = [F('zh', { a: '1', b: '2' }), F('en', { a: 'x' }), F('ja', {})];
  const d1 = C.describeRemoval(files, 'zh', 'en');
  assert.equal(d1.keys, 1);
  assert.equal(d1.wasSource, false);
  assert.equal(d1.nextSource, 'zh');
  const d2 = C.describeRemoval(files, 'zh', 'zh');
  assert.equal(d2.keys, 2);
  assert.equal(d2.wasSource, true);
  assert.equal(d2.nextSource, 'en');
  const d3 = C.describeRemoval([F('zh', { a: '1' })], 'zh', 'zh');
  assert.equal(d3.nextSource, '');
  assert.equal(C.describeRemoval(files, 'zh', 'xx'), null);
});
