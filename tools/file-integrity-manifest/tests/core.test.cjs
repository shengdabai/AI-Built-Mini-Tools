'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const C = require('../core.js');
const SAMPLE = require('../sample-data.js');

const H = c => c.repeat(64);
const e = (path, size, c) => ({ path, size, sha256: H(c) });

test('normalizePath:反斜杠、前导 ./、重复斜杠、NFC', () => {
  assert.strictEqual(C.normalizePath('.\\a\\b.txt'), 'a/b.txt');
  assert.strictEqual(C.normalizePath('./././a//b/./c'), 'a/b/c');
  assert.strictEqual(C.normalizePath('/abs/x'), 'abs/x');
  assert.strictEqual(C.normalizePath('é.txt'), 'é.txt');
});

test('shouldIgnore:默认列表、目录规则、通配与注释', () => {
  const d = C.DEFAULT_IGNORE;
  assert.ok(C.shouldIgnore('a/.DS_Store', d));
  assert.ok(C.shouldIgnore('Thumbs.db', d));
  assert.ok(C.shouldIgnore('__MACOSX/x/._y', d));
  assert.ok(!C.shouldIgnore('a/__MACOSX', d), '目录规则不匹配同名文件');
  assert.ok(!C.shouldIgnore('a/b.txt', d));
  assert.ok(C.shouldIgnore('x/y.tmp', ['*.tmp']));
  assert.ok(!C.shouldIgnore('x/y.tmp', ['# *.tmp']));
  assert.ok(C.shouldIgnore('build/out/a.js', ['build/out/*.js']));
});

test('checkName:非法字符、控制字符、超长(按字节)', () => {
  assert.deepStrictEqual(C.checkName('a/ok.txt'), []);
  assert.strictEqual(C.checkName('图标:最终版.png')[0].code, 'illegal-char');
  assert.ok(C.checkName('a<b>.txt').some(i => i.code === 'illegal-char'));
  assert.ok(C.checkName('a\u0007b').some(i => i.code === 'control-char'));
  assert.deepStrictEqual(C.checkName('x'.repeat(255)), []);
  assert.strictEqual(C.checkName('x'.repeat(256))[0].code, 'too-long');
  // 90 个汉字 = 270 字节,字符数不超但字节超
  assert.strictEqual(C.checkName('文'.repeat(90))[0].code, 'too-long');
  // 长度按单个文件名而不是整条路径
  assert.deepStrictEqual(C.checkName(('d'.repeat(100) + '/').repeat(4) + 'f.txt'), []);
});

test('buildManifest:排序、规范化、忽略、小写化哈希', () => {
  const m = C.buildManifest([e('b/z.txt', 1, 'A'), e('.\\a.txt', 2, 'b'), e('.DS_Store', 3, 'c')], { ignore: C.DEFAULT_IGNORE, generatedAt: '2026-10-20' });
  assert.deepStrictEqual(m.files.map(f => f.path), ['a.txt', 'b/z.txt']);
  assert.strictEqual(m.files[1].sha256, H('a'));
  assert.strictEqual(m.generatedAt, '2026-10-20');
});

test('buildManifest:重复路径报错(含规范化后重复)', () => {
  assert.throws(() => C.buildManifest([e('a.txt', 1, 'a'), e('./a.txt', 1, 'a')]), /重复路径 a\.txt/);
});

test('buildManifest:拒绝非法字段', () => {
  assert.throws(() => C.buildManifest([e('a', -1, 'a')]), /大小/);
  assert.throws(() => C.buildManifest([e('a', 1.5, 'a')]), /大小/);
  assert.throws(() => C.buildManifest([{ path: 'a', size: 1, sha256: 'xyz' }]), /sha256/);
  assert.throws(() => C.buildManifest([e('../x', 1, 'a')]), /\.\./);
  assert.throws(() => C.buildManifest([{ path: '', size: 1, sha256: H('a') }]), /路径/);
});

test('compare:缺失、多出、哈希不一致、一致', () => {
  const man = C.buildManifest([e('a', 1, 'a'), e('b', 2, 'b'), e('c', 3, 'c')]);
  const r = C.compare(man, [e('a', 1, 'a'), e('c', 4, 'd'), e('d', 5, 'e')]);
  assert.deepStrictEqual(r.missing.map(x => x.path), ['b']);
  assert.deepStrictEqual(r.extra.map(x => x.path), ['d']);
  assert.deepStrictEqual(r.ok.map(x => x.path), ['a']);
  assert.strictEqual(r.mismatched.length, 1);
  assert.strictEqual(r.mismatched[0].path, 'c');
  assert.strictEqual(r.mismatched[0].sizeChanged, true);
  assert.strictEqual(r.stats.clean, false);
});

test('compare:大小写差异不计入缺失和多出', () => {
  const man = C.buildManifest([e('Img/Cover.PNG', 1, 'a')]);
  const r = C.compare(man, [e('img/cover.png', 1, 'a')]);
  assert.strictEqual(r.missing.length, 0);
  assert.strictEqual(r.extra.length, 0);
  assert.deepStrictEqual(r.caseDiff, [{ manifestPath: 'Img/Cover.PNG', actualPath: 'img/cover.png', sameHash: true, sameSize: true }]);
  assert.strictEqual(r.stats.clean, false, '大小写差异是需要处理的警告');
});

test('compare:大小不同但哈希相同 -> 内部错误,不算一致也不算不一致', () => {
  const r = C.compare(C.buildManifest([e('a', 1, 'a')]), [e('a', 2, 'a')]);
  assert.strictEqual(r.internal.length, 1);
  assert.strictEqual(r.mismatched.length, 0);
  assert.strictEqual(r.ok.length, 0);
});

test('compare:哈希不同但大小相同仍报不一致,且 sizeChanged 为 false', () => {
  const r = C.compare(C.buildManifest([e('a', 5, 'a')]), [e('a', 5, 'b')]);
  assert.strictEqual(r.mismatched[0].sizeChanged, false);
});

test('compare:忽略规则两侧生效,忽略数量进入 stats', () => {
  const man = C.buildManifest([e('a', 1, 'a'), e('Thumbs.db', 9, '8')]);
  const r = C.compare(man, [e('a', 1, 'a'), e('.DS_Store', 6, 'b'), e('__MACOSX/a', 1, '7')], { ignore: C.DEFAULT_IGNORE });
  assert.strictEqual(r.stats.ignored, 2);
  assert.strictEqual(r.stats.manifestFiles, 1);
  assert.strictEqual(r.extra.length, 0);
  assert.strictEqual(r.missing.length, 0);
  assert.strictEqual(r.stats.clean, true);
});

test('compare:空清单 -> 全部多出;清单有文件而实际为空 -> 全部缺失', () => {
  const empty = C.buildManifest([]);
  assert.strictEqual(empty.files.length, 0);
  const r1 = C.compare(empty, [e('a', 1, 'a')]);
  assert.strictEqual(r1.extra.length, 1);
  const r2 = C.compare(C.buildManifest([e('a', 1, 'a')]), []);
  assert.strictEqual(r2.missing.length, 1);
  assert.strictEqual(C.compare(empty, []).stats.clean, true);
});

test('compare:实际列表重复路径报错;文件名警告只针对实际文件', () => {
  assert.throws(() => C.compare(C.buildManifest([]), [e('a', 1, 'a'), e('a', 1, 'a')]), /重复路径/);
  const r = C.compare(C.buildManifest([e('a:b', 1, 'a')]), [e('a:b', 1, 'a'), e('ok', 1, 'b')]);
  assert.deepStrictEqual(r.nameWarnings.map(w => w.path), ['a:b']);
  assert.strictEqual(r.stats.clean === false, true, 'ok 文件 ok 但 ok 文件为多出');
});

test('compare:stats 合计一致', () => {
  const r = C.compare(SAMPLE.manifest, SAMPLE.actual, { ignore: C.DEFAULT_IGNORE });
  const s = r.stats;
  assert.strictEqual(s.manifestFiles, 15);
  assert.strictEqual(s.manifestFiles, s.missing + s.mismatched + s.internal + s.ok + s.caseDiff);
  assert.strictEqual(s.actualFiles, s.extra + s.mismatched + s.internal + s.ok + s.caseDiff);
  assert.strictEqual(s.manifestSize, SAMPLE.manifest.files.reduce((n, f) => n + f.size, 0));
});

test('示例:2 缺失、1 多出、1 哈希不一致、1 大小写差异、1 非法文件名、忽略 .DS_Store', () => {
  const r = C.compare(SAMPLE.manifest, SAMPLE.actual, { ignore: C.DEFAULT_IGNORE });
  assert.deepStrictEqual(r.missing.map(x => x.path), ['视频/lesson1.mp4', '视频/lesson2.mp4']);
  assert.deepStrictEqual(r.extra.map(x => x.path), ['备份/草稿.txt']);
  assert.deepStrictEqual(r.mismatched.map(x => x.path), ['课程/第2课.pdf']);
  assert.strictEqual(r.caseDiff.length, 1);
  assert.strictEqual(r.nameWarnings.length, 1);
  assert.deepStrictEqual(r.ignored, ['.DS_Store']);
  assert.strictEqual(r.ok.length, 11);
});

test('parseManifest:JSON(对象与数组)', () => {
  const m = C.buildManifest([e('b', 2, 'b'), e('a', 1, 'a')], { generatedAt: '2026-10-20' });
  const p = C.parseManifest(JSON.stringify(m));
  assert.deepStrictEqual(p.files.map(f => f.path), ['a', 'b']);
  assert.strictEqual(p.generatedAt, '2026-10-20');
  assert.strictEqual(C.parseManifest(JSON.stringify(m.files)).files.length, 2);
});

test('parseManifest:CSV 往返,含逗号、引号、中文列名与英文列名', () => {
  const m = C.buildManifest([{ path: 'a,b "x".txt', size: 3, sha256: H('a'), mtime: '2026-10-01T00:00:00.000Z' }, e('中文.txt', 4, 'b')]);
  const back = C.parseManifest(C.toCsv(m));
  assert.deepStrictEqual(back.files.map(f => f.path), m.files.map(f => f.path));
  assert.strictEqual(back.files[0].size, m.files[0].size);
  const en = C.parseManifest('path,size,sha256\r\nx.txt,5,' + H('c') + '\r\n');
  assert.strictEqual(en.files[0].size, 5);
});

test('parseManifest:非法输入整份拒绝并给原因', () => {
  assert.throws(() => C.parseManifest(''), /为空/);
  assert.throws(() => C.parseManifest('{bad'), /JSON/);
  assert.throws(() => C.parseManifest('{"files":"x"}'), /files/);
  assert.throws(() => C.parseManifest('{"files":[{"path":"a","size":"1","sha256":"' + H('a') + '"}]}'), /size/);
  assert.throws(() => C.parseManifest('{"files":[{"path":"a","size":1,"sha256":"zz"}]}'), /sha256/);
  assert.throws(() => C.parseManifest('{"files":[{"path":"a","size":1,"sha256":"' + H('a') + '","mtime":"不是日期"}]}'), /日期/);
  assert.throws(() => C.parseManifest('路径,大小\na,1'), /缺少列/);
  assert.throws(() => C.parseManifest('路径,大小,sha256\na,-1,' + H('a')), /非负整数/);
  assert.throws(() => C.parseManifest('路径,大小,sha256\na,1,' + H('a') + '\na,1,' + H('a')), /重复路径/);
  assert.throws(() => C.parseManifest('路径,大小,sha256\n"a,1,' + H('a')), /引号/);
});

test('空清单可以解析(files 为空数组)', () => {
  assert.strictEqual(C.parseManifest('{"files":[]}').files.length, 0);
  assert.strictEqual(C.parseManifest('路径,大小,sha256\n').files.length, 0);
});

test('CSV 公式防护:=+-@ 开头加单引号,单独的 - + 不加,导入还原', () => {
  const m = C.buildManifest([e('=cmd.txt', 1, 'a'), e('+x', 1, 'b'), e('-y', 1, 'c'), e('@z', 1, 'd'), e('-', 1, 'e'), e('+', 1, 'f'), e('normal', 1, '9')]);
  const lines = C.toCsv(m).split('\n');
  assert.ok(lines.some(l => l.startsWith("'=cmd.txt,")));
  assert.ok(lines.some(l => l.startsWith("'+x,")));
  assert.ok(lines.some(l => l.startsWith("'-y,")));
  assert.ok(lines.some(l => l.startsWith("'@z,")));
  assert.ok(lines.some(l => l.startsWith('-,')));
  assert.ok(lines.some(l => l.startsWith('+,')));
  assert.deepStrictEqual(C.parseManifest(C.toCsv(m)).files.map(f => f.path).sort(), m.files.map(f => f.path).sort());
});

test('reportToCsv 与 reportToMarkdown:公式防护、竖线转义、内容覆盖各状态', () => {
  const man = C.buildManifest([e('=evil|x', 1, 'a'), e('gone', 2, 'b')]);
  const r = C.compare(man, [e('=evil|x', 1, 'c')]);
  const csv = C.reportToCsv(r);
  assert.ok(csv.includes("'=evil|x"));
  const md = C.reportToMarkdown(r, { date: '2026-10-20', manifestName: 'm.json' });
  assert.ok(md.includes("'=evil\\|x"));
  assert.ok(md.includes('日期:2026-10-20'));
  assert.ok(md.includes('发现差异'));
  assert.ok(md.includes('| 缺失 | 1 |'));
  assert.ok(md.includes('| 哈希不一致 | 1 |'));
  const clean = C.reportToMarkdown(C.compare(C.buildManifest([]), []));
  assert.ok(clean.includes('清单与文件一致'));
});

test('toCsv 表头与行数', () => {
  const lines = C.toCsv(C.buildManifest([e('a', 1, 'a')])).trim().split('\n');
  assert.strictEqual(lines[0], '路径,大小,sha256,修改时间');
  assert.strictEqual(lines.length, 2);
});

test('Sha256:与 node:crypto 一致(空串、abc、跨块边界、分块喂入)', () => {
  const ref = b => crypto.createHash('sha256').update(b).digest('hex');
  assert.strictEqual(new C.Sha256().digest(), ref(Buffer.alloc(0)));
  assert.strictEqual(new C.Sha256().update(Buffer.from('abc')).digest(), ref(Buffer.from('abc')));
  for (const n of [55, 56, 63, 64, 65, 119, 120, 128, 1000]) {
    const b = crypto.randomBytes(n);
    assert.strictEqual(new C.Sha256().update(b).digest(), ref(b), 'len ' + n);
  }
  const big = crypto.randomBytes(1000003);
  const s = new C.Sha256();
  for (let i = 0; i < big.length; i += 65537) s.update(big.subarray(i, i + 65537));
  assert.strictEqual(s.digest(), ref(big));
});

test('todayFrom:合法日期采用,非法回退不抛错', () => {
  assert.strictEqual(C.todayFrom('?today=2026-10-20', 'X'), '2026-10-20');
  assert.strictEqual(C.todayFrom('?today=2026-02-30', 'X'), 'X');
  assert.strictEqual(C.todayFrom('?today=abc', 'X'), 'X');
  assert.strictEqual(C.todayFrom('', 'X'), 'X');
});

test('formatSize', () => {
  assert.strictEqual(C.formatSize(0), '0 B');
  assert.strictEqual(C.formatSize(1536), '1.5 KB');
  assert.strictEqual(C.formatSize(5 * 1024 * 1024), '5.0 MB');
});

test('以 __proto__ / constructor 命名的文件不会污染比对', () => {
  const man = C.buildManifest([e('__proto__', 1, 'a'), e('constructor', 1, 'b')]);
  const r = C.compare(man, [e('__proto__', 1, 'a'), e('constructor', 1, 'b')]);
  assert.strictEqual(r.ok.length, 2);
  assert.strictEqual(r.stats.clean, true);
});

test('CSV 防护可逆:原文件名以单引号开头也能往返还原', () => {
  const names = ["'=abc.txt", "''=x", "'+y", "'-z", "'@w", "'abc", "'", "'-", "=a", "+b", "-", "+", "@c"];
  const m = C.buildManifest(names.map((n, i) => e(n, i, String(i % 10))));
  const csv = C.toCsv(m);
  const back = C.parseManifest(csv);
  assert.deepStrictEqual(back.files.map(f => f.path).sort(), names.slice().sort());
  assert.ok(csv.split('\n').some(l => l.startsWith("''=abc.txt,")), "原名 '=abc.txt 导出为 ''=abc.txt");
  assert.ok(csv.split('\n').some(l => l.startsWith("'abc,")), "不像防护形态的 'abc 保持原样");
});

test('大小写差异配对后仍检查大小:哈希同、大小不同 -> 内部错误;哈希不同照旧标注', () => {
  const r = C.compare(C.buildManifest([e('A.txt', 1, 'a')]), [e('a.txt', 2, 'a')]);
  assert.strictEqual(r.caseDiff.length, 1);
  assert.strictEqual(r.caseDiff[0].sameSize, false);
  assert.strictEqual(r.internal.length, 1);
  assert.strictEqual(r.internal[0].path, 'a.txt');
  assert.ok(C.flattenRows(r).some(x => x.status === 'internal'));
  const r2 = C.compare(C.buildManifest([e('A.txt', 1, 'a')]), [e('a.txt', 1, 'b')]);
  assert.strictEqual(r2.caseDiff[0].sameHash, false);
  assert.strictEqual(r2.internal.length, 0);
  const r3 = C.compare(C.buildManifest([e('A.txt', 1, 'a')]), [e('a.txt', 1, 'a')]);
  assert.strictEqual(r3.internal.length, 0);
});

test('示例清单 JSON 自带「合成示例」标记,导出再导入后仍可识别;普通清单不带标记', () => {
  const exported = JSON.stringify(SAMPLE.manifest, null, 2);
  assert.match(exported, /"sample":\s*"合成示例/);
  const back = C.parseManifest(exported);
  assert.ok(typeof back.sample === 'string' && back.sample.startsWith('合成示例'), '导入后保留示例标记');
  const plain = C.buildManifest([e('a', 1, 'a')], { generatedAt: '2026-10-20' });
  assert.ok(!('sample' in plain));
  assert.ok(!('sample' in C.parseManifest(JSON.stringify(plain))));
  // 非字符串的 sample 字段不当作标记,也不让导入失败
  assert.ok(!('sample' in C.parseManifest(JSON.stringify(Object.assign({}, plain, { sample: true })))));
});

test('存档整份原子校验:忽略列表有效但清单损坏时整份拒绝', () => {
  const raw = JSON.stringify({ ignore: ['*.tmp'], manifest: { files: [{ path: 'a', size: 1, sha256: 'bad' }] }, manifestName: 'x', manifestIsSample: false });
  assert.throws(() => C.parseStoredState(raw), e => e.code === 'invalid-manifest' && /清单无效/.test(e.message));
});

test('存档区分非法 JSON 与字段类型错误', () => {
  assert.throws(() => C.parseStoredState('{bad'), e => e.code === 'malformed-json');
  assert.throws(() => C.parseStoredState(JSON.stringify({ ignore: 'x', manifest: null, manifestName: '', manifestIsSample: false })), e => e.code === 'wrong-type');
  assert.throws(() => C.parseStoredState(JSON.stringify({ ignore: [], manifest: null, manifestName: 3, manifestIsSample: false })), e => e.code === 'wrong-type');
});

test('当前有效内存状态 JSON 往返不丢字段', () => {
  const source = { ignore: C.DEFAULT_IGNORE, manifest: C.buildManifest([e('a', 1, 'a')]), manifestName: '内存清单', manifestIsSample: false };
  const back = C.parseStoredState(JSON.stringify(source, null, 2));
  assert.deepStrictEqual(back.ignore, source.ignore);
  assert.deepStrictEqual(back.manifest, source.manifest);
  assert.strictEqual(back.manifestName, source.manifestName);
  assert.strictEqual(back.manifestIsSample, false);
});
