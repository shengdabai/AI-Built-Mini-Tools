'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');
const S = require('../sample-data.js');

const one = (sha, subject, body = '') => ({ id: sha, sha, subject, body, author: '', date: '', isMerge: /^Merge /.test(subject) });
const run = (subjects, opt) => C.group(subjects.map((s, i) => one('a00000' + i, s)), opt);

test('core.js 在 Node 下加载不依赖 document/window', () => {
  assert.equal(typeof document, 'undefined');
  assert.equal(typeof window, 'undefined');
  assert.equal(typeof C.parseLog, 'function');
});

test('detectFormat 识别 oneline / pretty / raw / empty / unknown', () => {
  assert.equal(C.detectFormat('abc1234 feat: x\ndef5678 fix: y\n'), 'oneline');
  assert.equal(C.detectFormat('abc1234|feat: x|Ann|Mon Oct 19\ndef5678|fix: y|Bob|Mon Oct 19\n'), 'pretty');
  assert.equal(C.detectFormat('commit abc1234def5678\nAuthor: A <a@x.y>\nDate:   today\n\n    feat: x\n'), 'raw');
  assert.equal(C.detectFormat('  \n\n'), 'empty');
  assert.equal(C.detectFormat('hello world\nnot a log'), 'unknown');
});

test('三种格式解析同一份示例,条数与主题一致', () => {
  const a = C.parseLog(S.texts.oneline), b = C.parseLog(S.texts.pretty), c = C.parseLog(S.texts.raw);
  assert.equal(a.length, 22); assert.equal(b.length, 22); assert.equal(c.length, 22);
  assert.deepEqual(a.map(x => x.subject), b.map(x => x.subject));
  assert.deepEqual(a.map(x => x.subject), c.map(x => x.subject));
  assert.equal(b[0].author, 'Synthetic Dev');
  assert.match(b[0].date, /2026/);
  assert.equal(c[0].author, 'Synthetic Dev'); // 邮箱被去掉
});

test('oneline 去掉分支装饰,pretty 主题含竖线时不被截断', () => {
  const l = C.parseLog('abc1234 (HEAD -> main, tag: v1) feat: add x\n');
  assert.equal(l[0].subject, 'feat: add x');
  const p = C.parseLog('abc1234|fix: handle a|b pipe|Ann|Mon\ndef5678|feat: y|Bob|Tue\n');
  assert.equal(p[0].subject, 'fix: handle a|b pipe');
  assert.equal(p[0].author, 'Ann');
});

test('raw 解析正文、Merge 头与 CRLF', () => {
  const t = 'commit aaaaaaa1\r\nMerge: 111 222\r\nAuthor: A <a@x.y>\r\nDate:   d\r\n\r\n    Merge pull request #9 from x/y\r\n\r\n    Add thing\r\n';
  const l = C.parseLog(t);
  assert.equal(l.length, 1);
  assert.equal(l[0].isMerge, true);
  assert.equal(l[0].subject, 'Merge pull request #9 from x/y');
  assert.equal(l[0].body, 'Add thing');
});

test('重复 sha 获得不同 id,避免勾选互相串', () => {
  const l = C.parseLog('abc1234 fix: a\nabc1234 fix: b\n');
  assert.notEqual(l[0].id, l[1].id);
});

test('parseConventional:scope、!、大小写与空 scope', () => {
  assert.deepEqual(
    (({ type, scope, breaking, subject }) => ({ type, scope, breaking, subject }))(C.parseConventional(one('a', 'feat(api)!: drop v1'))),
    { type: 'feat', scope: 'api', breaking: true, subject: 'drop v1' });
  const p = C.parseConventional(one('a', 'FIX(): Typo'));
  assert.equal(p.type, 'fix'); assert.equal(p.scope, null); assert.equal(p.breaking, false);
  const n = C.parseConventional(one('a', 'update readme'));
  assert.equal(n.type, 'other'); assert.equal(n.conventional, false);
});

test('正文 BREAKING CHANGE 视为破坏性,并取多行说明但停在空行/尾注', () => {
  const p = C.parseConventional(one('a', 'refactor: x', 'BREAKING CHANGE: old file ignored.\nuse new one\n\nCo-authored-by: B <b@x.y>'));
  assert.equal(p.breaking, true);
  assert.equal(p.breakingNote, 'old file ignored. use new one');
  assert.equal(C.parseConventional(one('a', 'fix: x', 'no break here')).breaking, false);
});

test('refs:取标题中的 #n 与正文 Closes #n,去重', () => {
  const p = C.parseConventional(one('a', 'fix: a (#12) and #12 #7', 'Closes #99\nsee also #5'));
  assert.deepEqual(p.refs, ['12', '7', '99']);
});

test('Merge 提交默认过滤,includeMerges 时归其他', () => {
  const r = run(['Merge pull request #1 from a/b', "Merge branch 'main'", 'feat: x']);
  assert.equal(r.groups.length, 1);
  assert.equal(r.skipped.filter(s => s.reason === 'merge').length, 2);
  const r2 = run(['Merge pull request #1 from a/b', 'feat: x'], { includeMerges: true });
  assert.deepEqual(r2.groups.map(g => g.key), ['feat', 'other']);
});

test('分组顺序固定:破坏性 → 新功能 → 修复 → 性能 → 其他;非约定提交归其他', () => {
  const r = run(['update readme', 'perf: p', 'fix: f', 'feat: n', 'feat!: b']);
  assert.deepEqual(r.groups.map(g => g.key), ['breaking', 'feat', 'fix', 'perf', 'other']);
  assert.deepEqual(r.groups.map(g => g.title), ['破坏性变更', '新功能', '修复', '性能', '其他']);
  assert.equal(r.groups[4].items[0].text, 'Update readme');
});

test('docs / chore / refactor 默认排除,勾选后进入其他;破坏性始终保留', () => {
  const subjects = ['docs: d', 'chore: c', 'ci: i', 'refactor: r', 'revert: v', 'chore!: big'];
  const off = run(subjects);
  assert.deepEqual(off.groups.map(g => g.key), ['breaking']);
  assert.equal(off.skipped.length, 5);
  assert.deepEqual(off.skipped.map(s => s.reason), ['docs', 'chore', 'chore', 'refactor', 'refactor']);
  const docsOnly = run(subjects, { includeDocs: true });
  assert.equal(docsOnly.groups.find(g => g.key === 'other').items.length, 1);
  const all = run(subjects, { includeDocs: true, includeChore: true, includeRefactor: true });
  assert.equal(all.groups.find(g => g.key === 'other').items.length, 5);
});

test('humanize:去前缀、首字母大写、去句号、保留省略号', () => {
  assert.equal(C.humanize('feat(api): add login.'), 'Add login');
  assert.equal(C.humanize('fix: crash on start。'), 'Crash on start');
  assert.equal(C.humanize('chore: wait for it...'), 'Wait for it...');
  assert.equal(C.humanize('修复登录崩溃。'), '修复登录崩溃');
  assert.equal(C.humanize('  Already Fine  '), 'Already Fine');
});

test('humanize:Co-authored-by 等尾注被去掉', () => {
  assert.equal(C.humanize('Co-authored-by: A <a@x.y>\nfix: real subject'), 'Real subject');
  assert.equal(C.humanize('Signed-off-by: A\n'), '');
});

test('humanize:#123 在有仓库 URL 时变链接,无或非 http(s) 时保持原样', () => {
  assert.equal(C.humanize('fix: a (#123)', { repoUrl: 'https://github.com/o/r.git/' }), 'A ([#123](https://github.com/o/r/issues/123))');
  assert.equal(C.humanize('fix: a (#123)'), 'A (#123)');
  assert.equal(C.humanize('fix: a (#123)', { repoUrl: 'javascript:alert(1)' }), 'A (#123)');
  assert.equal(C.humanize('fix: a (#123)', { repoUrl: 'ftp://x/y' }), 'A (#123)');
  assert.equal(C.normalizeRepoUrl('https://u:p@github.com/o/r?x=1#h'), 'https://github.com/o/r');
});

test('nextVersion:四种情况', () => {
  const g = subj => run(subj).groups;
  assert.equal(C.nextVersion('1.2.3', g(['feat!: x', 'feat: y'])).next, '2.0.0');
  assert.equal(C.nextVersion('1.2.3', g(['feat: y', 'fix: z'])).next, '1.3.0');
  assert.equal(C.nextVersion('1.2.3', g(['fix: z'])).next, '1.2.4');
  assert.equal(C.nextVersion('1.2.3', g(['perf: p'])).bump, 'patch');
  const none = C.nextVersion('v1.2.3', g(['update readme']));
  assert.equal(none.next, '1.2.3'); assert.equal(none.bump, 'none');
});

test('nextVersion:0.x 约定(破坏性升 minor,其余升 patch)', () => {
  const g = subj => run(subj).groups;
  assert.equal(C.nextVersion('0.4.1', g(['feat!: x'])).next, '0.5.0');
  assert.equal(C.nextVersion('0.4.1', g(['feat: x'])).next, '0.4.2');
  assert.equal(C.nextVersion('0.4.1', g(['fix: x'])).next, '0.4.2');
  assert.equal(C.nextVersion('0.4.1', g(['docs: x'])).bump, 'none');
});

test('nextVersion:非法版本号抛错', () => {
  for (const bad of ['', '1.2', '1.2.x', 'abc', '1.2.3-beta', '1.2.3.4', null]) {
    assert.throws(() => C.nextVersion(bad, []), /x\.y\.z/);
  }
});

test('toReleaseNotes:scope 聚合、说明、用户操作单独一节', () => {
  const r = C.group([
    one('a000001', 'feat(ui): one'), one('a000002', 'feat(ui): two'), one('a000003', 'feat: plain'),
    one('a000004', 'fix(db): solo (#5)'), one('a000005', 'refactor(cfg): rename', 'BREAKING CHANGE: use new name')
  ], { repoUrl: 'https://github.com/o/r', userActions: ['a000005', 'a000003'] });
  const md = C.toReleaseNotes(r.groups, { version: '2.0.0', date: '2026-10-20' });
  assert.match(md, /^## 2\.0\.0 \(2026-10-20\)\n/);
  assert.match(md, /### 新功能\n- \*\*ui\*\*\n {2}- One\n {2}- Two\n- Plain\n/);
  assert.match(md, /- \*\*db\*\*: Solo \(\[#5\]\(https:\/\/github\.com\/o\/r\/issues\/5\)\)/);
  assert.match(md, /### 升级时需要你操作\n- \*\*cfg\*\*: Rename\(use new name\)\n- Plain\n/);
  assert.ok(md.indexOf('### 破坏性变更') < md.indexOf('### 新功能'));
});

test('toReleaseNotes:没有变更时给出明确说明,无版本时不编造', () => {
  const md = C.toReleaseNotes([], {});
  assert.match(md, /^## 未发布版本\n/);
  assert.match(md, /没有可写入发布说明的变更/);
});

test('toChangelog:日期格式、Keep a Changelog 分节与顺序', () => {
  const g = run(['feat: a', 'fix: b', 'perf: c', 'revert: d', 'feat!: e'], { includeRefactor: true }).groups;
  const md = C.toChangelog(g, '1.3.0', '2026-10-20');
  assert.match(md, /^## \[1\.3\.0\] - 2026-10-20\n/);
  const order = ['### Added', '### Changed', '### Removed', '### Fixed'].map(h => md.indexOf(h));
  assert.ok(order.every(i => i >= 0));
  assert.deepEqual([...order].sort((x, y) => x - y), order);
  assert.match(md, /### Added\n- \*\*BREAKING\*\* E\n- A\n/);
  assert.match(md, /### Removed\n- D\n/);
});

test('toChangelog:非法日期或版本抛错(含不存在的日期)', () => {
  assert.throws(() => C.toChangelog([], '1.0.0', '2026-02-30'), /日期/);
  assert.throws(() => C.toChangelog([], '1.0.0', '2026/10/20'), /日期/);
  assert.throws(() => C.toChangelog([], 'x', '2026-10-20'), /版本/);
});

test('空输入与无法识别的输入不抛错', () => {
  assert.deepEqual(C.parseLog(''), []);
  assert.deepEqual(C.parseLog(null), []);
  assert.deepEqual(C.parseLog('just some words'), []);
  const r = C.group([], {});
  assert.deepEqual(r.groups, []);
  assert.equal(C.nextVersion('1.0.0', r.groups).next, '1.0.0');
});

test('特殊键名作为 scope 不污染原型', () => {
  const r = run(['feat(__proto__): a', 'feat(constructor): b', 'feat(__proto__): c']);
  const md = C.toReleaseNotes(r.groups, {});
  assert.match(md, /\*\*__proto__\*\*\n {2}- A\n {2}- C/);
  assert.match(md, /\*\*constructor\*\*: B/);
  assert.equal(({}).polluted, undefined);
});

test('用户操作勾选只影响被勾选的提交', () => {
  const commits = [one('a000001', 'fix: a'), one('a000002', 'fix: b')];
  const r = C.group(commits, { userActions: ['a000002'] });
  assert.deepEqual(r.groups[0].items.map(i => i.userAction), [false, true]);
});

test('resolveToday:合法 ?today 生效,非法或不存在日期回退真实今天且不抛错', () => {
  const now = new Date(2026, 0, 5);
  assert.equal(C.resolveToday('?today=2026-10-20', now), '2026-10-20');
  assert.equal(C.resolveToday('?today=2026-13-01', now), '2026-01-05');
  assert.equal(C.resolveToday('?today=2026-02-30', now), '2026-01-05');
  assert.equal(C.resolveToday('?today=abc', now), '2026-01-05');
  assert.equal(C.resolveToday('', now), '2026-01-05');
  assert.equal(C.resolveToday(undefined, now), '2026-01-05');
});

test('renderMarkdown:转义 HTML,只放行 http(s) 链接,嵌套列表结构正确', () => {
  const html = C.renderMarkdown('## T\n\n- **a**\n  - <img src=x onerror=alert(1)>\n  - [ok](https://e.com/x?a=1&b=2) [bad](javascript:alert(1))\n- b\n');
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('href="https://e.com/x?a=1&amp;b=2"'));
  assert.ok(!html.includes('href="javascript'));
  assert.equal((html.match(/<ul>/g) || []).length, (html.match(/<\/ul>/g) || []).length);
  assert.ok(html.startsWith('<h3>T</h3>'));
  assert.match(html, /<ul><li><strong>a<\/strong><ul><li>.*<\/li><li>.*<\/li><\/ul><\/li><li>b<\/li><\/ul>/);
});

test('validateState:合法通过,类型/枚举/重复 ID/非 http 地址整份拒绝', () => {
  const ok = C.defaultState();
  assert.equal(C.validateState(ok).ok, true);
  const bad = patch => C.validateState(Object.assign(C.defaultState(), patch));
  assert.equal(bad({ log: 5 }).ok, false);
  assert.equal(bad({ tab: 'other' }).ok, false);
  assert.equal(bad({ actions: ['a', 'a'] }).ok, false);
  assert.equal(bad({ actions: [1] }).ok, false);
  assert.equal(bad({ opts: { docs: 'yes', chore: false, refactor: false, merges: false } }).ok, false);
  assert.equal(C.validateState(null).ok, false);
  assert.equal(C.validateState([]).ok, false);
});

test('示例 raw 日志整体:22 条、9 条被过滤、版本建议为 major、含 3 个带 # 的引用', () => {
  const list = C.parseLog(S.texts.raw);
  const r = C.group(list, { repoUrl: S.repoUrl });
  assert.equal(list.length, 22);
  assert.equal(r.skipped.length, 9);
  assert.equal(C.nextVersion(S.current, r.groups).next, '2.0.0');
  const md = C.toReleaseNotes(r.groups, { version: '2.0.0', date: '2026-10-20' });
  assert.equal((md.match(/\]\(https:\/\/github\.com\/example\/demo-app\/issues\/\d+\)/g) || []).length, 3);
  // oneline 没有正文,正文里的 BREAKING CHANGE 无法识别 → 只有 1 条破坏性
  const r1 = C.group(C.parseLog(S.texts.oneline), {});
  assert.equal(r1.groups[0].items.length, 1);
  assert.equal(r.groups[0].items.length, 2);
});

test('草稿恢复:半成品版本号/日期/地址照常恢复,业务校验推迟(P0)', () => {
  const draft = Object.assign(C.defaultState(), { log: 'abc1234 feat: x\n', current: '1.', release: '2.0', date: '2026-0', repoUrl: 'javascript:alert(1)', actions: ['abc1234'], edited: '手改' });
  const v = C.validateState(draft);
  assert.equal(v.ok, true);
  assert.equal(v.state.current, '1.');
  assert.deepEqual(v.state.actions, ['abc1234']);
  assert.equal(v.state.edited, '手改');
  // 不安全地址即使被恢复,也不会生成链接;半成品版本号在生成时才被拒绝
  assert.equal(C.humanize('fix: a (#1)', { repoUrl: v.state.repoUrl }), 'A (#1)');
  assert.throws(() => C.nextVersion(v.state.current, []), /x\.y\.z/);
});

test('0.x:含 docs 或非约定提交的发布也升 patch,完全无条目才不变(P1)', () => {
  const g = (subj, opt) => run(subj, opt).groups;
  assert.equal(C.nextVersion('0.4.1', g(['docs: x'], { includeDocs: true })).next, '0.4.2');
  assert.equal(C.nextVersion('0.4.1', g(['update readme'])).next, '0.4.2');
  assert.equal(C.nextVersion('0.4.1', g(['chore: c'], { includeChore: true })).bump, 'patch');
  assert.equal(C.nextVersion('0.4.1', g(['docs: x'])).next, '0.4.1');
});

test('toChangelog 输出「需要用户操作」章节(P1)', () => {
  const r = C.group([one('a000001', 'fix(db): migrate schema (#3)', ''), one('a000002', 'feat: other'), one('a000003', 'refactor: r', 'BREAKING CHANGE: rerun setup')],
    { userActions: ['a000001', 'a000003'], repoUrl: 'https://github.com/o/r' });
  const md = C.toChangelog(r.groups, '1.1.0', '2026-10-20');
  assert.match(md, /### Action required\n- R \(rerun setup\)\n- \*\*db\*\*: Migrate schema \(\[#3\]\(https:\/\/github\.com\/o\/r\/issues\/3\)\)\n/);
  assert.ok(md.indexOf('### Fixed') < md.indexOf('### Action required'));
  const none = C.toChangelog(C.group([one('a000001', 'fix: a')], {}).groups, '1.0.1', '2026-10-20');
  assert.ok(!none.includes('Action required'));
});

test('[第五轮] todayFromParam:只有合法的 ?today 才返回日期,其余返回 null(界面据此显示「由地址参数固定」)', () => {
  assert.equal(C.todayFromParam('?today=2026-10-20'), '2026-10-20');
  assert.equal(C.todayFromParam('?x=1&today=2026-10-20'), '2026-10-20');
  assert.equal(C.todayFromParam('?today=2026-02-30'), null);
  assert.equal(C.todayFromParam('?today=abc'), null);
  assert.equal(C.todayFromParam(''), null);
  assert.equal(C.todayFromParam(undefined), null);
});

test('[第五轮] validateState 保存「合成示例」标记:缺省为 false,非布尔整份拒绝', () => {
  assert.equal(C.defaultState().sample, false);
  const s = C.defaultState();
  s.sample = true;
  const r = C.validateState(JSON.parse(JSON.stringify(s)));
  assert.equal(r.ok, true);
  assert.equal(r.state.sample, true);
  const old = JSON.parse(JSON.stringify(C.defaultState()));
  delete old.sample;
  const ro = C.validateState(old);
  assert.equal(ro.ok, true);
  assert.equal(ro.state.sample, false);
  const bad = JSON.parse(JSON.stringify(C.defaultState()));
  bad.sample = 'yes';
  assert.equal(C.validateState(bad).ok, false);
});

test('[第五轮] markSample:示例导出的文件首行标注合成示例,真实数据原样返回', () => {
  const md = '## 2.0.0 (2026-10-20)\n\n- x\n';
  const marked = C.markSample(md, true);
  assert.ok(marked.startsWith('<!-- 合成示例'));
  assert.ok(marked.endsWith(md));
  assert.equal(C.markSample(md, false), md);
  assert.equal(C.markSample(null, true), null);
});

test('[第五轮] hasDraft:任何日志、字段、勾选、选项偏离默认或手改都算用户数据', () => {
  const d = C.defaultState();
  assert.equal(C.hasDraft(d, '2026-10-20'), false);
  const dated = Object.assign(C.defaultState(), { date: '2026-10-20' });
  assert.equal(C.hasDraft(dated, '2026-10-20'), false);
  assert.equal(C.hasDraft(Object.assign(C.defaultState(), { date: '2026-01-01' }), '2026-10-20'), true);
  for (const patch of [{ log: 'abc1234 feat: x' }, { repoUrl: 'https://a.b' }, { current: '1.0.0' }, { release: '2.0.0' }, { actions: ['a'] }, { edited: '改过' }, { opts: { docs: true, chore: false, refactor: false, merges: false } }]) {
    assert.equal(C.hasDraft(Object.assign(C.defaultState(), patch), '2026-10-20'), true, JSON.stringify(patch));
  }
  assert.equal(C.hasDraft(Object.assign(C.defaultState(), { log: '   ' }), '2026-10-20'), false);
});
