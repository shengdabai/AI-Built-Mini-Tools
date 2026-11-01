'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../core.js');
const S = require('../sample-data.js');

const pkg = (deps, dev) => JSON.stringify({ dependencies: deps || {}, devDependencies: dev || {} }, null, 2);
const find = (changes, name) => changes.find(c => c.name === name);

test('detectInput 识别三种输入与异常', () => {
  assert.strictEqual(C.detectInput(S.pair), 'package-json-pair');
  assert.strictEqual(C.detectInput(S.diff), 'diff');
  assert.strictEqual(C.detectInput(S.outdated), 'outdated');
  assert.strictEqual(C.detectInput(''), 'empty');
  assert.strictEqual(C.detectInput('   \n'), 'empty');
  assert.strictEqual(C.detectInput(pkg({ a: '1.0.0' })), 'package-json-single');
  assert.strictEqual(C.detectInput('随便一句话'), 'unknown');
  assert.strictEqual(C.detectInput(pkg() + pkg() + pkg()), 'package-json-many');
});

test('字符串里的花括号不会打断两份 JSON 的切分', () => {
  const a = '{"name":"a}{","dependencies":{"x":"1.0.0"}}';
  const b = '{"dependencies":{"x":"2.0.0"}}';
  const r = C.analyze(a + '\n' + b);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.changes.length, 1);
  assert.strictEqual(r.changes[0].delta.kind, 'major');
});

test('JSON 解析错误给出第几行第几列,不抛异常', () => {
  const bad = '{\n  "dependencies": {\n    "a": "1.0.0",\n  }\n}';
  const r = C.parsePackageJson(bad);
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.line >= 3, '行号应落在出错位置附近: ' + r.error.line);
  assert.match(r.error.message, /第 \d+ 行第 \d+ 列/);
  const r2 = C.analyze(pkg({ a: '1.0.0' }) + '\n{"dependencies": {"a": ');
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(r2.errors[0].doc, 'new');
  assert.match(r2.errors[0].message, /新 package.json/);
});

test('非法 JSON 与奇怪输入不崩', () => {
  for (const t of ['null', '[]', '"x"', '{', '{"dependencies": []}', '{"dependencies": {"a": 1}}', undefined, null]) {
    const r = C.parsePackageJson(t);
    assert.strictEqual(r.ok, false, String(t));
    assert.ok(r.error.message);
  }
  assert.doesNotThrow(() => C.analyze(undefined));
  assert.doesNotThrow(() => C.analyze('{"a":1} 多余文字 {"b":2}'));
  assert.strictEqual(C.analyze('{"a":1} 多余文字 {"b":2}').ok, false);
});

test('semverDelta: major / minor / patch 与 0.x', () => {
  assert.strictEqual(C.semverDelta('^1.2.3', '^2.0.0').kind, 'major');
  assert.strictEqual(C.semverDelta('1.2.3', '1.3.0').kind, 'minor');
  assert.strictEqual(C.semverDelta('1.2.3', '1.2.4').kind, 'patch');
  assert.strictEqual(C.semverDelta('1.2.3', '1.2.3').kind, 'same');
  const z = C.semverDelta('0.2.0', '0.3.0');
  assert.strictEqual(z.kind, 'minor');
  assert.strictEqual(z.zeroX, true);
  assert.strictEqual(C.semverDelta('1.2.0', '1.3.0').zeroX, undefined);
  const d = C.semverDelta('2.0.0', '1.9.0');
  assert.strictEqual(d.direction, 'down');
  assert.strictEqual(d.kind, 'major');
  assert.deepStrictEqual([d.from, d.to], ['2.0.0', '1.9.0']);
});

test('semverDelta: 预发布排序与分类', () => {
  assert.strictEqual(C.semverDelta('^5.0.0', '^6.0.0-beta.2').kind, 'prerelease');
  assert.strictEqual(C.semverDelta('1.0.0-beta.1', '1.0.0-beta.2').direction, 'up');
  assert.strictEqual(C.semverDelta('1.0.0-beta.2', '1.0.0-beta.10').direction, 'up');
  assert.strictEqual(C.semverDelta('1.0.0-rc.1', '1.0.0').direction, 'up');
  assert.strictEqual(C.semverDelta('1.0.0', '1.0.0-rc.1').direction, 'down');
  assert.strictEqual(C.semverDelta('1.0.0-alpha', '1.0.0-alpha.1').direction, 'up');
});

test('semverDelta: 非 semver(latest / git / workspace / 复合范围)', () => {
  assert.strictEqual(C.semverDelta('latest', 'latest').kind, 'same');
  const a = C.semverDelta('1.0.0', 'latest');
  assert.strictEqual(a.kind, 'nonsemver');
  assert.match(a.reason, /latest/);
  assert.strictEqual(C.semverDelta('git+https://x.example/a.git#v1', 'git+https://x.example/a.git#v2').kind, 'nonsemver');
  assert.match(C.semverDelta('workspace:^1.0.0', 'workspace:^2.0.0').reason, /workspace/);
  assert.match(C.semverDelta('^1.0.0 || ^2.0.0', '^3.0.0').reason, /复合/);
  assert.match(C.semverDelta('*', '1.0.0').reason, /通配/);
});

test('范围变化识别与解释', () => {
  const d = C.semverDelta('^4.17.0', '4.17.0');
  assert.strictEqual(d.kind, 'same');
  assert.strictEqual(d.rangeChange.pin, 'pinned');
  assert.match(d.rangeChange.text, /\^/);
  assert.match(d.rangeChange.text, /固定/);
  assert.strictEqual(C.semverDelta('1.0.0', '~1.0.0').rangeChange.pin, 'unpinned');
  assert.strictEqual(C.semverDelta('^1.0.0', '>=1.0.0').rangeChange.pin, null);
  assert.match(C.semverDelta('^1.0.0', '>=1.0.0').rangeChange.text, /没有上限/);
  assert.strictEqual(C.semverDelta('^1.0.0', '^1.0.0').rangeChange, null);
  const both = C.semverDelta('^1.0.0', '2.0.0');
  assert.strictEqual(both.kind, 'major');
  assert.ok(both.rangeChange);
});

test('compareDeps: 新增 / 移除 / 降级 / 范围 / 未变化', () => {
  const o = C.parsePackageJson(pkg({ a: '^1.0.0', b: '^1.0.0', c: '^2.0.0', d: '^1.0.0', e: '1.0.0' })).deps;
  const n = C.parsePackageJson(pkg({ a: '^1.1.0', c: '^1.9.0', d: '1.0.0', e: '1.0.0', f: '^3.0.0' })).deps;
  const ch = C.compareDeps(o, n);
  assert.strictEqual(find(ch, 'a').type, 'upgraded');
  assert.strictEqual(find(ch, 'b').type, 'removed');
  assert.strictEqual(find(ch, 'c').type, 'downgraded');
  assert.strictEqual(C.categoryOf(find(ch, 'c')).key, 'downgrade');
  assert.strictEqual(find(ch, 'd').type, 'range');
  assert.strictEqual(find(ch, 'e'), undefined);
  assert.strictEqual(find(ch, 'f').type, 'added');
  assert.strictEqual(ch.length, 5);
});

test('compareDeps: 同时在 dependencies 与 devDependencies 出现时警告', () => {
  const o = C.parsePackageJson(pkg({ ts: '^5.0.0', x: '1.0.0' }, { ts: '^5.0.0' })).deps;
  const n = C.parsePackageJson(pkg({ ts: '^5.0.0', x: '1.0.1' }, { ts: '^5.0.0', x: '1.0.1' })).deps;
  const ch = C.compareDeps(o, n);
  const ts = find(ch, 'ts');
  assert.strictEqual(ts.type, 'duplicate');
  assert.strictEqual(ts.duplicate, true);
  assert.ok(C.advice(ts).notes.some(t => /dependencies 与 devDependencies/.test(t)));
  assert.strictEqual(C.advice(ts).severity, 'warn');
  const xs = ch.filter(c => c.name === 'x');
  assert.ok(xs.length >= 1 && xs.every(c => c.duplicate));
  const single = C.compareDeps([], C.parsePackageJson(pkg({ solo: '1.0.0' })).deps);
  assert.strictEqual(single[0].duplicate, false);
});

test('compareDeps: 依赖换区块识别为 moved', () => {
  const ch = C.compareDeps(
    [{ name: 'a', range: '1.0.0', section: 'devDependencies' }],
    [{ name: 'a', range: '1.0.0', section: 'dependencies' }]);
  assert.strictEqual(ch.length, 1);
  assert.strictEqual(ch[0].type, 'moved');
  assert.strictEqual(ch[0].fromSection, 'devDependencies');
});

test('advice 模板:major / minor / patch / 降级 / 预发布 / 非 semver', () => {
  const run = (a, b) => C.advice(find(C.compareDeps([{ name: 'p', range: a, section: 'dependencies' }], [{ name: 'p', range: b, section: 'dependencies' }]), 'p'));
  assert.strictEqual(run('1.0.0', '2.0.0').headline, '可能有破坏性变更,必须读 CHANGELOG,建议跑全部测试与类型检查');
  assert.strictEqual(run('1.0.0', '2.0.0').severity, 'danger');
  assert.strictEqual(run('1.0.0', '1.1.0').headline, '新增功能,建议跑测试');
  assert.strictEqual(run('1.0.0', '1.0.1').headline, '修复,建议跑冒烟');
  assert.strictEqual(run('1.1.0', '1.0.0').headline, '确认是否有意为之');
  assert.match(run('1.0.0', '2.0.0-beta.1').headline, /预发布/);
  assert.match(run('1.0.0', 'latest').headline, /无法按 semver/);
  assert.ok(run('0.2.0', '0.3.0').notes.some(t => /0\.x/.test(t)));
  assert.ok(run('^1.0.0', '1.0.1').notes.some(t => /写死/.test(t)));
  assert.ok(run('1.0.0', '^1.0.1').notes.some(t => /可复现/.test(t)));
});

test('测试建议清单只针对 major 升级,内容为通用模板', () => {
  const r = C.analyze(S.pair);
  const list = C.testChecklist(r.changes);
  assert.deepStrictEqual(list.perPackage.map(p => p.name).sort(), ['react', 'react-dom']);
  assert.ok(list.perPackage[0].items.some(t => /接口签名/.test(t)));
  assert.ok(list.perPackage[0].items.some(t => /配置项/.test(t)));
  assert.ok(list.perPackage[0].items.some(t => /Node 版本/.test(t)));
  assert.ok(list.general.length >= 3);
});

test('示例 package.json:22 个依赖,分类数量符合设计', () => {
  const r = C.analyze(S.pair);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.newDeps.length, 22);
  const c = r.summary.counts;
  assert.strictEqual(c.major, 2);
  assert.strictEqual(c.minor, 3);
  assert.strictEqual(c.patch, 4);
  assert.strictEqual(c.downgrade, 1);
  assert.strictEqual(c.added, 1);
  assert.strictEqual(c.removed, 1);
  assert.strictEqual(c.range, 1);
  assert.strictEqual(c.prerelease, 1);
  assert.strictEqual(c.nonsemver, 1);
  assert.strictEqual(c.duplicate, 1);
});

test('git diff 解析:区块跟踪、新增 / 移除 / 升级 / 降级', () => {
  const r = C.analyze(S.diff);
  assert.strictEqual(r.ok, true);
  const ch = r.changes;
  assert.strictEqual(find(ch, 'react').delta.kind, 'major');
  assert.strictEqual(find(ch, 'express').delta.kind, 'minor');
  assert.strictEqual(find(ch, 'moment').type, 'removed');
  assert.strictEqual(find(ch, 'nanoid').type, 'added');
  assert.strictEqual(find(ch, 'vite').section, 'devDependencies');
  assert.strictEqual(find(ch, 'tsx').type, 'downgraded');
  assert.strictEqual(find(ch, 'axios'), undefined);
  const noDeps = C.parseDiff('diff --git a/x b/x\n+++ b/x\n+  "version": "2.0.0",\n');
  assert.strictEqual(noDeps.ok, false);
});

test('npm outdated 解析:Current 到 Latest,忽略 ANSI 颜色', () => {
  const r = C.analyze(S.outdated);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(find(r.changes, 'express').delta.kind, 'major');
  assert.strictEqual(find(r.changes, 'lodash').delta.kind, 'patch');
  assert.strictEqual(find(r.changes, 'axios').delta.kind, 'minor');
  const w = C.analyze(S.outdated, { target: 'wanted' });
  assert.strictEqual(find(w.changes, 'express').delta.kind, 'minor');
  assert.strictEqual(find(w.changes, 'typescript'), undefined);
  const colored = '\x1b[4mPackage\x1b[24m  Current  Wanted  Latest\n\x1b[31mfoo\x1b[39m  1.0.0  1.0.0  2.0.0\n';
  assert.strictEqual(C.analyze(colored).ok, true);
  const miss = C.parseOutdated('Package Current Wanted Latest\nfoo MISSING 1.0.0 1.0.0\n');
  assert.strictEqual(C.compareDeps(miss.oldDeps, miss.newDeps)[0].type, 'added');
});

test('toMarkdown 结构:标题、概览、关注、明细、范围、测试建议', () => {
  const md = C.toMarkdown(C.analyze(S.pair).changes);
  const heads = md.split('\n').filter(l => /^#{2,4} /.test(l));
  assert.strictEqual(heads[0], '## 依赖更新影响说明');
  for (const h of ['### 概览', '### 需要重点关注', '### 变更明细', '### 范围符号变化', '### 测试建议', '#### 通用']) assert.ok(heads.includes(h), h);
  assert.ok(md.includes('| `react` | dependencies | Major | `^18.2.0` | `^19.0.0` |'));
  assert.ok(md.includes('- [ ] 接口签名'));
  assert.match(md, /#### `react` `\^18\.2\.0` → `\^19\.0\.0`/);
  assert.ok(C.toMarkdown([]).includes('没有检测到依赖变化'));
});

test('Markdown 表格转义竖线并保护公式前缀', () => {
  const ch = C.compareDeps([], [{ name: '=cmd|x', range: '@evil', section: 'dependencies' }]);
  const md = C.toMarkdown(ch);
  assert.ok(md.includes('`=cmd\\|x`'));
  assert.ok(!/\| =/.test(md));
  assert.strictEqual(C.guardFormula('=1+1'), "'=1+1");
  assert.strictEqual(C.guardFormula('@a'), "'@a");
  assert.strictEqual(C.guardFormula('-1'), "'-1");
  assert.strictEqual(C.guardFormula('-'), '-');
  assert.strictEqual(C.guardFormula('+'), '+');
  assert.strictEqual(C.guardFormula('^1.0.0'), '^1.0.0');
});

test('toCsv:表头、行数、引号转义、公式防护', () => {
  const r = C.analyze(S.pair);
  const lines = C.toCsv(r.changes).trim().split('\r\n');
  assert.strictEqual(lines[0], '包名,区块,变化,旧版本,新版本,分类,范围变化,影响说明,警告');
  assert.strictEqual(lines.length, r.changes.length + 1);
  const react = lines.find(l => l.startsWith('react,'));
  assert.ok(react.includes('react,dependencies,Major,^18.2.0,^19.0.0,major'));
  const evil = C.toCsv(C.compareDeps([], [{ name: '=HYPERLINK("x")', range: '+1', section: 'dependencies' }]));
  assert.ok(evil.includes('"\'=HYPERLINK(""x"")"'));
  assert.ok(evil.includes("'+1"));
  const scoped = C.toCsv(C.compareDeps([], [{ name: '@types/node', range: '1.0.0', section: 'devDependencies' }]));
  assert.ok(scoped.includes("'@types/node"));
});

test('空依赖与按名分组不被原型键污染', () => {
  const empty = C.analyze(pkg() + '\n' + pkg());
  assert.strictEqual(empty.ok, true);
  assert.strictEqual(empty.changes.length, 0);
  assert.strictEqual(C.toCsv([]).trim(), '包名,区块,变化,旧版本,新版本,分类,范围变化,影响说明,警告');
  const o = '{"dependencies": {"__proto__": "1.0.0", "constructor": "1.0.0"}}';
  const n = '{"dependencies": {"__proto__": "2.0.0", "constructor": "1.0.1"}}';
  const r = C.analyze(o + '\n' + n);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.changes.map(c => c.name).sort(), ['__proto__', 'constructor']);
  assert.strictEqual(find(r.changes, 'constructor').delta.kind, 'patch');
  assert.strictEqual(r.summary.counts.major + r.summary.counts.patch, 2);
});

test('[回归] CSV/Markdown 防护前导制表符与空白后的公式前缀', () => {
  assert.strictEqual(C.guardFormula('\t=1+1'), "'\t=1+1");
  assert.strictEqual(C.guardFormula('  @x'), "'  @x");
  assert.strictEqual(C.guardFormula('\r-1'), "'\r-1");
  assert.strictEqual(C.guardFormula('\t'), '\t');
  assert.strictEqual(C.guardFormula('-'), '-');
  const csv = C.toCsv(C.compareDeps([], [{ name: '\t=1+1', range: '1.0.0', section: 'dependencies' }]));
  const body = csv.split('\r\n')[1];
  assert.ok(body.startsWith("\"'\t=1+1\"") || body.startsWith("'\t=1+1"), body);
  assert.ok(!/^[\t=+@-]/.test(body));
});

test('[回归] 1.2.x → 1.2.0 是范围变化(通配改固定),不能当作无变化', () => {
  const d = C.semverDelta('1.2.x', '1.2.0');
  assert.strictEqual(d.kind, 'same');
  assert.ok(d.rangeChange, '应识别范围变化');
  assert.strictEqual(d.rangeChange.pin, 'pinned');
  assert.strictEqual(C.semverDelta('1.2.0', '1.2.x').rangeChange.pin, 'unpinned');
  assert.strictEqual(C.semverDelta('1.2.x', '1.2.x').rangeChange, null);
  assert.strictEqual(C.semverDelta('^1.2', '^1.2.0').rangeChange, null);
  const ch = C.compareDeps([{ name: 'p', range: '1.2.x', section: 'dependencies' }], [{ name: 'p', range: '1.2.0', section: 'dependencies' }]);
  assert.strictEqual(ch.length, 1);
  assert.strictEqual(ch[0].type, 'range');
});

test('[回归] 移动区块同时 major 升级:仍按 major 分类并进入测试清单', () => {
  const ch = C.compareDeps(
    [{ name: 'p', range: '1.0.0', section: 'devDependencies' }],
    [{ name: 'p', range: '2.0.0', section: 'dependencies' }]);
  assert.strictEqual(ch[0].type, 'moved');
  assert.strictEqual(C.categoryOf(ch[0]).key, 'major');
  const a = C.advice(ch[0]);
  assert.strictEqual(a.severity, 'danger');
  assert.match(a.headline, /破坏性变更/);
  assert.ok(a.notes.some(t => /移到|移动/.test(t)));
  const list = C.testChecklist(ch);
  assert.deepStrictEqual(list.perPackage.map(p => p.name), ['p']);
  assert.strictEqual(C.summarize(ch).counts.major, 1);
  const md = C.toMarkdown(ch);
  assert.ok(md.includes('### 需要重点关注') && md.includes('#### `p`'));
  const same = C.compareDeps([{ name: 'q', range: '1.0.0', section: 'devDependencies' }], [{ name: 'q', range: '1.0.0', section: 'dependencies' }]);
  assert.strictEqual(C.categoryOf(same[0]).key, 'moved');
});

test('analyze 结果写明比较基准:outdated 默认 Current → Latest,可切 Wanted,package.json 为旧 → 新', () => {
  const lat = C.analyze(S.outdated);
  assert.strictEqual(lat.target, 'latest');
  assert.strictEqual(lat.basis, 'Current → Latest');
  const wan = C.analyze(S.outdated, { target: 'wanted' });
  assert.strictEqual(wan.target, 'wanted');
  assert.strictEqual(wan.basis, 'Current → Wanted');
  assert.notDeepStrictEqual(lat.changes.map(c => c.to), wan.changes.map(c => c.to));
  const pair = C.analyze(S.pair);
  assert.strictEqual(pair.target, null);
  assert.strictEqual(pair.basis, '旧文件 → 新文件');
  assert.strictEqual(C.analyze(S.diff).basis, 'diff 里的 - 行 → + 行');
});

test('testChecklist 没有 major 时不说「不需要检查」,而是说明工具只为 major 生成逐包清单', () => {
  const none = C.testChecklist(C.analyze(pkg({ a: '1.0.0' }) + '\n' + pkg({ a: '1.0.1' })).changes);
  assert.strictEqual(none.perPackage.length, 0);
  assert.ok(none.emptyNote.includes('本工具仅为 major 升级生成逐包清单'));
  assert.ok(!/不需要/.test(none.emptyNote));
  const nonsemver = C.testChecklist(C.analyze(pkg({ a: 'latest' }) + '\n' + pkg({ a: 'next' })).changes);
  assert.ok(nonsemver.emptyNote.includes('其余变化请结合'));
  assert.strictEqual(C.testChecklist(C.analyze(S.pair).changes).emptyNote, '');
});

test('toMarkdown / toCsv:示例标注与比较基准;非示例不带标注', () => {
  const r = C.analyze(S.outdated);
  const md = C.toMarkdown(r.changes, { sample: true, basis: r.basis });
  assert.ok(md.includes('数据来源:合成示例'));
  assert.ok(md.includes('比较基准:Current → Latest'));
  const plain = C.toMarkdown(r.changes, { basis: r.basis });
  assert.ok(!plain.includes('合成示例'));
  assert.ok(C.toMarkdown([], { sample: true }).includes('合成示例'));
  const csv = C.toCsv(r.changes, { sample: true }).split('\r\n');
  assert.ok(csv[0].endsWith(',数据来源') && csv[1].endsWith(',合成示例'));
  assert.ok(!C.toCsv(r.changes).includes('数据来源'));
  assert.strictEqual(C.toCsv(r.changes).split('\r\n')[0], '包名,区块,变化,旧版本,新版本,分类,范围变化,影响说明,警告');
});

test('inputScope:输入草稿或偏离默认的目标列设置都算用户数据,确认文案写明范围', () => {
  assert.strictEqual(C.inputScope('', 'latest').any, false);
  assert.strictEqual(C.inputScope('  \n ', 'latest').any, false);
  const a = C.inputScope('{\n}\n', 'latest');
  assert.strictEqual(a.any, true);
  assert.strictEqual(a.lines, 2);
  assert.ok(C.describeInputScope(a).includes('2 行') && C.describeInputScope(a).includes("4 个字符"));
  const b = C.inputScope('', 'wanted');
  assert.strictEqual(b.any, true);
  assert.ok(C.describeInputScope(b).includes('Wanted'));
});

test('checkTextFile:拒绝过大、含空字符或空白的文件,不静默截断', () => {
  assert.strictEqual(C.checkTextFile('ok.txt', '{"a":1}').ok, true);
  assert.strictEqual(C.checkTextFile('x.txt', '   ').ok, false);
  assert.strictEqual(C.checkTextFile('x.txt', 'a\u0000b').ok, false);
  const big = C.checkTextFile('x.txt', 'a'.repeat(C.MAX_INPUT_CHARS + 1));
  assert.strictEqual(big.ok, false);
  assert.ok(big.error.includes('超过'));
  assert.strictEqual(C.checkTextFile('x.txt', 'a'.repeat(C.MAX_INPUT_CHARS)).ok, true);
});
