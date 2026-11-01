'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');
require('../sample-data.js');

let n = 0;
const feat = (o = {}) => Object.assign({ id: 'f' + (++n), name: '功能' + n, task: '用户做某事', gate: 2, moscow: 'should', hours: 2, deps: [], layer: 'unit', status: 'todo' }, o);
const proj = (features, extra = {}) => Object.assign(C.newProject(), { features }, extra);
const codes = (p, level) => C.check(p).issues.filter(i => !level || i.level === level).map(i => i.code);

test('Must 上限:7 个通过,8 个阻断并列出名字', () => {
  const seven = Array.from({ length: 7 }, () => feat({ moscow: 'must' }));
  assert.ok(!codes(proj(seven)).includes('must_limit'));
  const eight = seven.concat(feat({ moscow: 'must', name: '第八个' }));
  const issue = C.check(proj(eight)).issues.find(i => i.code === 'must_limit');
  assert.equal(issue.level, 'block');
  assert.match(issue.message, /8 个/);
  assert.equal(issue.ids.length, 8);
});

test('已砍的 Must 不占 Must 名额', () => {
  const eight = Array.from({ length: 8 }, () => feat({ moscow: 'must' }));
  eight[0].status = 'cut';
  assert.ok(!codes(proj(eight)).includes('must_limit'));
});

test('Must 缺验证层 → 阻断且带功能名;Should 缺验证层不阻断', () => {
  const p = proj([feat({ moscow: 'must', layer: '', name: '无验证的核心' }), feat({ moscow: 'should', layer: '' })]);
  const issues = C.check(p).issues.filter(i => i.code === 'must_no_layer');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].feature, '无验证的核心');
  assert.match(issues[0].message, /无验证的核心/);
});

test('门 1 关键词:默认词命中名称或任务;门 2 同名不触发', () => {
  const p = proj([
    feat({ gate: 1, name: '微信登录' }),
    feat({ gate: 1, name: '导出', task: '用户通过支付宝付费' }),
    feat({ gate: 2, name: '邮箱登录' }),
  ]);
  const hit = C.check(p).issues.filter(i => i.code === 'gate1_keyword');
  assert.equal(hit.length, 2);
  assert.ok(hit.every(i => i.level === 'block'));
});

test('门 1 关键词可配置:改词表后结果随之改变,空词被忽略', () => {
  const f = feat({ gate: 1, name: '云同步', task: '换设备也能看' });
  assert.ok(!codes(proj([f])).includes('gate1_keyword'));
  assert.ok(codes(proj([f], { keywords: ['云同步'] })).includes('gate1_keyword'));
  assert.ok(!codes(proj([f], { keywords: ['', '  '] })).includes('gate1_keyword'));
  assert.deepEqual(C.parseKeywords('云同步，登录\n 登录;;短信 '), ['云同步', '登录', '短信']);
});

test('已砍或 Won\'t 的门 1 登录功能不再触发关键词阻断', () => {
  assert.ok(!codes(proj([feat({ gate: 1, name: '登录', status: 'cut' }), feat({ gate: 1, name: '支付', moscow: 'wont' })])).includes('gate1_keyword'));
});

test('依赖环:两点环与自依赖都能找到,无环为空', () => {
  const a = feat({ id: 'a', name: 'A', deps: ['b'] });
  const b = feat({ id: 'b', name: 'B', deps: ['a'] });
  const c = feat({ id: 'c', name: 'C', deps: ['c'] });
  const d = feat({ id: 'd', name: 'D', deps: ['a'] });
  assert.deepEqual(C.detectCycle([a, b, c, d]), [['a', 'b'], ['c']]);
  assert.deepEqual(C.detectCycle([feat({ id: 'x', deps: [] }), feat({ id: 'y', deps: ['x'] })]), []);
  const issues = C.check(proj([a, b, c, d])).issues.filter(i => i.code === 'cycle');
  assert.equal(issues.length, 2);
  assert.match(issues[1].message, /依赖了自己/);
});

test('依赖环:三点环与深链不爆栈', () => {
  const ring = ['p', 'q', 'r'].map((id, i, arr) => feat({ id, deps: [arr[(i + 1) % 3]] }));
  assert.deepEqual(C.detectCycle(ring), [['p', 'q', 'r']]);
  const chain = Array.from({ length: 20000 }, (_, i) => feat({ id: 'n' + i, deps: i ? ['n' + (i - 1)] : [] }));
  assert.deepEqual(C.detectCycle(chain), []);
});

test('依赖已砍或 Won\'t 功能 → 阻断;被依赖方正常则不报', () => {
  const cut = feat({ id: 'k', name: '被砍的', status: 'cut' });
  const wont = feat({ id: 'w', name: '不做的', moscow: 'wont' });
  const ok = feat({ id: 'o', name: '正常的' });
  const p = proj([cut, wont, ok, feat({ name: '依赖者1', deps: ['k'] }), feat({ name: '依赖者2', deps: ['w'] }), feat({ name: '依赖者3', deps: ['o'] })]);
  const hit = C.check(p).issues.filter(i => i.code === 'dep_cut');
  assert.equal(hit.length, 2);
  assert.match(hit[0].message, /已砍/);
  assert.match(hit[1].message, /Won't/);
});

test("Won't 为空 → 警告;有 Won't 或没有任何功能则不警告", () => {
  assert.ok(codes(proj([feat()]), 'warn').includes('no_wont'));
  assert.ok(!codes(proj([feat({ moscow: 'wont' })]), 'warn').includes('no_wont'));
  assert.ok(!codes(proj([]), 'warn').includes('no_wont'));
});

test('Could 多于 Must + Should → 警告;相等不警告', () => {
  const eq = proj([feat({ moscow: 'must' }), feat({ moscow: 'could' })]);
  assert.ok(!codes(eq).includes('could_many'));
  const more = proj([feat({ moscow: 'must' }), feat({ moscow: 'could' }), feat({ moscow: 'could' })]);
  const i = C.check(more).issues.find(x => x.code === 'could_many');
  assert.equal(i.level, 'warn');
});

test('单功能工时:16 小时不警告,16.5 警告并带功能名', () => {
  assert.ok(!codes(proj([feat({ hours: 16 })])).includes('big_hours'));
  const i = C.check(proj([feat({ hours: 24, name: '大功能' })])).issues.find(x => x.code === 'big_hours');
  assert.equal(i.level, 'warn');
  assert.equal(i.feature, '大功能');
  assert.ok(codes(proj([feat({ hours: 16.5 })])).includes('big_hours'));
});

test('门顺序:门 2 依赖门 3、或门 3 先开工而门 2 未完成 → 警告', () => {
  const g3 = feat({ id: 'g3', gate: 3, name: '付费功能' });
  const g2 = feat({ id: 'g2', gate: 2, name: '他人可用功能', deps: ['g3'] });
  assert.ok(C.check(proj([g3, g2])).issues.some(i => i.code === 'gate_order' && /依赖门 3/.test(i.message)));
  const started = feat({ gate: 3, status: 'doing', name: '提前做的付费功能' });
  const open2 = feat({ gate: 2, status: 'todo' });
  assert.ok(C.check(proj([started, open2])).issues.some(i => i.code === 'gate_order' && /开工/.test(i.message)));
  const done2 = feat({ gate: 2, status: 'done' });
  assert.ok(!codes(proj([started, done2])).includes('gate_order'));
});

test('gateStatus:三门全空、逐门填写、空白不算证据', () => {
  let s = C.gateStatus(proj([]));
  assert.deepEqual(s.map(g => g.passed), [false, false, false]);
  assert.deepEqual(s.map(g => g.locked), [false, true, true]);
  s = C.gateStatus(proj([], { evidence: { 1: '三条记录', 2: '   ', 3: '' } }));
  assert.deepEqual(s.map(g => g.passed), [true, false, false]);
  assert.deepEqual(s.map(g => g.locked), [false, false, true]);
  assert.match(s[2].hint, /先拿证据/);
  assert.match(s[2].hint, /门 2/);
  s = C.gateStatus(proj([], { evidence: { 1: 'a', 2: 'b', 3: 'c' } }));
  assert.deepEqual(s.map(g => g.locked), [false, false, false]);
});

test('gateStatus:门 1 没证据时门 3 也被锁,提示指向门 1', () => {
  const s = C.gateStatus(proj([], { evidence: { 1: '', 2: '有', 3: '有' } }));
  assert.deepEqual(s.map(g => g.locked), [false, true, true]);
  assert.match(s[2].hint, /门 1/);
});

test('ladder:按门分三列、列内按 MoSCoW 分组,工时只算未砍且非 Won\'t', () => {
  const l = C.ladder([
    feat({ gate: 1, moscow: 'must', hours: 3 }), feat({ gate: 1, moscow: 'wont', hours: 9 }),
    feat({ gate: 1, moscow: 'could', hours: 2, status: 'cut' }), feat({ gate: 3, moscow: 'should', hours: 5 }),
  ]);
  assert.equal(l.length, 3);
  assert.equal(l[0].count, 3);
  assert.equal(l[0].hours, 3);
  assert.equal(l[0].groups.wont.length, 1);
  assert.equal(l[1].count, 0);
  assert.equal(l[2].groups.should.length, 1);
});

test('move 返回新对象不改原对象;非法门或等级抛错;改后重算结果变化', () => {
  const f = feat({ gate: 2, moscow: 'could', name: '被移动' });
  const m = C.move(f, 1, 'must');
  assert.equal(f.gate, 2);
  assert.equal(m.gate, 1);
  assert.equal(m.moscow, 'must');
  assert.equal(C.move(f, undefined, 'wont').gate, 2);
  assert.throws(() => C.move(f, 4, 'must'), RangeError);
  assert.throws(() => C.move(f, 1, 'maybe'), RangeError);
  assert.throws(() => C.move(f, 1.5, 'must'), RangeError);
  const base = [feat({ moscow: 'should' }), f];
  const before = C.check(proj(base)).stats;
  const after = C.check(proj([base[0], m])).stats;
  assert.equal(before.counts.could, 1);
  assert.equal(after.counts.could, 0);
  assert.equal(after.counts.must, 1);
  assert.equal(after.hoursByGate[1], 2);
  assert.ok(C.check(proj([base[0], C.move(f, 1, 'must')])).issues.some(i => i.code === 'no_wont'));
});

test('移到门 1 后触发关键词阻断', () => {
  const f = feat({ gate: 3, name: '支付接入' });
  assert.ok(!codes(proj([f])).includes('gate1_keyword'));
  assert.ok(codes(proj([C.move(f, 1)])).includes('gate1_keyword'));
});

test('PRD Markdown 结构:标题、Must 表、验证层分布、Won\'t、未解决阻断', () => {
  const p = proj([
    feat({ moscow: 'must', name: '核心A', layer: 'e2e', hours: 3 }),
    feat({ moscow: 'must', name: '核心B', layer: '' }),
    feat({ moscow: 'wont', name: '社区广场', task: '不做社交' }),
    feat({ moscow: 'should', name: '次要' }),
  ], { name: '测试项目' });
  const md = C.toPrdMarkdown(p);
  const heads = md.split('\n').filter(l => l.startsWith('#'));
  assert.deepEqual(heads, ['# 测试项目 · PRD 片段', '## Must 清单(2 个,上限 7)', '## 验证层分布', "## Won't(明确不做,1 个)", '## 未解决的阻断']);
  assert.match(md, /\| 核心A \| 用户做某事 \| 门 2 他人可用 \| E2E \| 3 \| 未做 \|/);
  assert.match(md, /- E2E:核心A/);
  assert.match(md, /- 未定:核心B/);
  assert.match(md, /- 社区广场:不做社交/);
  assert.ok(!md.includes('次要'));
});

test("PRD Markdown:Won't 为空时明说,无阻断时没有阻断小节", () => {
  const md = C.toPrdMarkdown(proj([feat({ moscow: 'must', layer: 'unit' })]));
  assert.match(md, /还没有写下任何明确不做的功能/);
  assert.ok(!md.includes('未解决的阻断'));
});

test('PRD Markdown 表格:管道符转义、换行压平、公式前缀', () => {
  const p = proj([feat({ moscow: 'must', name: '=HYPERLINK("x")', task: 'a|b\nc', layer: 'unit' })]);
  const md = C.toPrdMarkdown(p);
  assert.ok(md.includes("| '=HYPERLINK(\"x\") | a\\|b c |"));
});

test('CSV:表头、依赖按名字、中文标签', () => {
  const a = feat({ id: 'a', name: '甲', gate: 1, moscow: 'must', hours: 1.5, layer: 'e2e', status: 'doing' });
  const b = feat({ id: 'b', name: '乙', deps: ['a'], layer: '' });
  const rows = C.toCsv(proj([a, b])).trim().split('\r\n');
  assert.equal(rows[0], 'ID,功能名,用户任务,所属门,MoSCoW,预计小时,依赖,验证层,状态');
  assert.equal(rows[1], 'a,甲,用户做某事,门 1 自用,Must,1.5,,E2E,做中');
  assert.match(rows[2], /,门 2 他人可用,Should,2,甲,,未做$/);
});

test('CSV 公式防护:= + - @ 开头加单引号,单独的 - 或 + 不加,逗号引号换行正确引用', () => {
  const mk = name => feat({ name, task: 'x' });
  const csv = C.toCsv(proj([mk('=1+1'), mk('+SUM(A1)'), mk('-2+3'), mk('@cmd'), mk('-'), mk('+'), mk('a,b'), mk('他说"好"'), mk('第一行\n第二行')]));
  const lines = csv.split('\r\n');
  assert.match(lines[1], /^f\d+,'=1\+1,/);
  assert.match(lines[2], /,'\+SUM\(A1\),/);
  assert.match(lines[3], /,'-2\+3,/);
  assert.match(lines[4], /,'@cmd,/);
  assert.match(lines[5], /,-,x,/);
  assert.match(lines[6], /,\+,x,/);
  assert.ok(csv.includes('"a,b"'));
  assert.ok(csv.includes('"他说""好"""'));
  assert.ok(csv.includes('"第一行\n第二行"'));
});

test('validateFeature:合法通过;枚举、类型、负数、NaN、字符串小时都拒绝', () => {
  assert.ok(C.validateFeature(feat()).ok);
  const bad = o => C.validateFeature(feat(o));
  assert.ok(!bad({ name: '  ' }).ok);
  assert.ok(!bad({ gate: 4 }).ok);
  assert.ok(!bad({ gate: '1' }).ok);
  assert.ok(!bad({ moscow: 'MUST' }).ok);
  assert.ok(!bad({ hours: -1 }).ok);
  assert.ok(!bad({ hours: NaN }).ok);
  assert.ok(!bad({ hours: '3' }).ok);
  assert.ok(!bad({ hours: Infinity }).ok);
  assert.ok(!bad({ layer: 'manual' }).ok);
  assert.ok(!bad({ status: 'paused' }).ok);
  assert.ok(!bad({ deps: 'f1' }).ok);
  assert.ok(C.validateFeature(feat({ layer: '', hours: 0 })).ok);
  assert.ok(!C.validateFeature(null).ok);
});

test('validateImport:合法往返;JSON 错误、格式、版本、枚举、重复 id、悬空依赖整份拒绝', () => {
  const good = proj([feat({ id: 'a' }), feat({ id: 'b', deps: ['a'] })], { name: '导入测试' });
  const r = C.validateImport(C.toJson(good));
  assert.ok(r.ok);
  assert.deepEqual(r.project, good);
  assert.ok(!C.validateImport('{oops').ok);
  assert.ok(!C.validateImport('[]').ok);
  assert.ok(!C.validateImport(JSON.stringify({ format: 'other', version: 1, project: good })).ok);
  assert.ok(!C.validateImport(JSON.stringify({ format: 'ladder-board', version: 2, project: good })).ok);
  const wrap = p => JSON.stringify({ format: 'ladder-board', version: 1, project: p });
  const badEnum = JSON.parse(JSON.stringify(good)); badEnum.features[0].moscow = 'urgent';
  const e1 = C.validateImport(wrap(badEnum));
  assert.ok(!e1.ok);
  assert.match(e1.error, /MoSCoW/);
  const dup = JSON.parse(JSON.stringify(good)); dup.features[1].id = 'a';
  assert.match(C.validateImport(wrap(dup)).error, /重复/);
  const dangling = JSON.parse(JSON.stringify(good)); dangling.features[1].deps = ['zzz'];
  assert.match(C.validateImport(wrap(dangling)).error, /不存在/);
  const noEv = JSON.parse(JSON.stringify(good)); delete noEv.evidence[2];
  assert.ok(!C.validateImport(wrap(noEv)).ok);
});

test('validateImport:一条坏功能让整份拒绝,不跳过坏条目', () => {
  const p = proj([feat({ id: 'a' }), feat({ id: 'b', hours: -5 }), feat({ id: 'c' })]);
  const r = C.validateImport(C.toJson(p));
  assert.ok(!r.ok);
  assert.equal(r.project, undefined);
});

test('校验口径一致:能保存(validateState 通过)的数据经 JSON 往返后仍通过;长文本和大数字边界', () => {
  const p = proj([feat({ id: 'a', name: '长'.repeat(5000), task: '任务'.repeat(5000), hours: 1e9 })], { name: '名'.repeat(3000) });
  assert.ok(C.validateState(p).ok);
  const back = JSON.parse(JSON.stringify(p));
  assert.ok(C.validateState(back).ok);
  assert.ok(C.validateImport(C.toJson(p)).ok);
});

test('原型键名不会污染:功能名 __proto__ / constructor 正常处理', () => {
  const p = proj([feat({ id: 'a', name: '__proto__', layer: '', moscow: 'must' }), feat({ id: 'b', name: 'constructor', layer: '', moscow: 'must' })]);
  const md = C.toPrdMarkdown(p);
  assert.match(md, /- 未定:__proto__、constructor/);
  assert.equal(C.check(p).issues.filter(i => i.code === 'must_no_layer').length, 2);
  assert.equal(Object.getPrototypeOf({}).polluted, undefined);
});

test('nextId 不与已有 id 冲突', () => {
  assert.equal(C.nextId([]), 'f1');
  assert.equal(C.nextId([{ id: 'f2' }]), 'f3');
  assert.equal(C.nextId([{ id: 'f2' }, { id: 'f3' }]), 'f4');
});

test('合成示例满足 SPEC:16 个功能、Must 8、门 1 微信登录、一个环、Won\'t 为空、一个 24 小时功能', () => {
  const s = globalThis.LADDER_SAMPLE;
  assert.ok(C.validateState(s).ok);
  assert.equal(s.synthetic, true);
  assert.equal(s.features.length, 16);
  assert.equal(s.features.filter(f => f.moscow === 'must').length, 8);
  const c = codes(s);
  ['must_limit', 'gate1_keyword', 'cycle', 'no_wont', 'big_hours'].forEach(k => assert.ok(c.includes(k), k));
  assert.ok(s.features.some(f => f.gate === 1 && f.name === '微信登录'));
  assert.ok(s.features.some(f => f.hours === 24));
  assert.equal(C.check(s).stats.block, 3);
  assert.ok(C.validateImport(C.toJson(s)).ok);
});

/* ---- 第五轮:表单草稿预览(提交前即时重算) ---- */
test('applyDraft 新增草稿:返回含草稿的新项目,原项目不变', () => {
  const p = C.newProject();
  p.features.push(feat({ id: 'a', name: '甲', moscow: 'should' }));
  const draft = feat({ id: 'f2', name: '乙', moscow: 'must', layer: '' });
  const view = C.applyDraft(p, draft);
  assert.equal(view.features.length, 2);
  assert.equal(p.features.length, 1);
  assert.equal(C.check(view).stats.counts.must, 1);
  assert.equal(C.check(p).stats.counts.must, 0);
});
test('applyDraft 编辑草稿:按 id 替换,门与工时合计随草稿变化', () => {
  const p = C.newProject();
  p.features.push(feat({ id: 'a', name: '甲', gate: 1, hours: 2 }));
  const view = C.applyDraft(p, feat({ id: 'a', name: '甲', gate: 2, hours: 5 }));
  assert.equal(view.features.length, 1);
  assert.equal(C.check(view).stats.hoursByGate[2], 5);
  assert.equal(C.check(view).stats.hoursByGate[1], 0);
  assert.equal(C.check(p).stats.hoursByGate[1], 2);
});
test('parseHours 只接受不小于 0 的有限十进制数', () => {
  assert.equal(C.parseHours('4'), 4);
  assert.equal(C.parseHours(' 2.5 '), 2.5);
  assert.equal(C.parseHours('.5'), 0.5);
  assert.ok(Number.isNaN(C.parseHours('abc')));
  assert.ok(Number.isNaN(C.parseHours('')));
  assert.ok(Number.isNaN(C.parseHours('-1')));
  assert.ok(Number.isNaN(C.parseHours('1e999')));
  assert.ok(Number.isNaN(C.parseHours('9'.repeat(400))));
});
