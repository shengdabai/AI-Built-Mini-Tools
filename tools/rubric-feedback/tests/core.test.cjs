'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../core.js');

const lv = () => [1, 2, 3, 4].map(n => ({ desc: `等级${n}描述`, fb: `等级${n}反馈` }));
const dim = (id, name, weight) => ({ id, name, weight, levels: lv() });
const rub = (dims, id = 'r1', name = '测试量规') => ({ id, name, dims });
const R2 = rub([dim('a', '发音', 50), dim('b', '流利', 50)]);
const R5 = rub(['a', 'b', 'c', 'd', 'e'].map((k, i) => dim(k, '维' + k, 20)));
const g = (...ls) => ls.map((l, i) => ({ id: 'abcde'[i], level: l }));

test('加权总分:等权与不等权', () => {
  assert.deepStrictEqual(C.score(R2, { a: 4, b: 4 }), { total: 100, level: 'A' });
  assert.deepStrictEqual(C.score(R2, { a: 1, b: 1 }), { total: 25, level: 'D' });
  const R = rub([dim('a', '甲', 75), dim('b', '乙', 25)]);
  // (75*4 + 25*2) * 25 / 100 = 87.5
  assert.strictEqual(C.score(R, { a: 4, b: 2 }).total, 87.5);
  assert.strictEqual(C.score(R, { a: 2, b: 4 }).total, 62.5);
});

test('权重之和不为 100 时按比例归一', () => {
  const A = rub([dim('a', '甲', 1), dim('b', '乙', 3)]);
  const B = rub([dim('a', '甲', 25), dim('b', '乙', 75)]);
  const C3 = rub([dim('a', '甲', 300), dim('b', '乙', 900)]);
  for (const grades of [{ a: 4, b: 1 }, { a: 2, b: 3 }]) {
    assert.strictEqual(C.score(A, grades).total, C.score(B, grades).total);
    assert.strictEqual(C.score(C3, grades).total, C.score(B, grades).total);
  }
  assert.deepStrictEqual(C.weights(A), [25, 75]);
});

test('等级区间边界 85 / 70 / 55', () => {
  assert.deepStrictEqual(C.score(R5, g(4, 4, 3, 3, 3)), { total: 85, level: 'A' });
  assert.deepStrictEqual(C.score(R5, g(4, 3, 3, 3, 3)), { total: 80, level: 'B' });
  assert.deepStrictEqual(C.score(R5, g(3, 3, 3, 3, 2)), { total: 70, level: 'B' });
  assert.deepStrictEqual(C.score(R5, g(3, 3, 3, 2, 2)), { total: 65, level: 'C' });
  assert.deepStrictEqual(C.score(R5, g(3, 2, 2, 2, 2)), { total: 55, level: 'C' });
  assert.deepStrictEqual(C.score(R5, g(2, 2, 2, 2, 2)), { total: 50, level: 'D' });
  assert.strictEqual(C.levelOf(84.9), 'B');
  assert.strictEqual(C.levelOf(54.9), 'D');
});

test('未打满或等级非法时 score 返回 null', () => {
  assert.deepStrictEqual(C.score(R2, { a: 3 }), { total: null, level: null });
  assert.deepStrictEqual(C.score(R2, { a: 3, b: 5 }), { total: null, level: null });
  assert.deepStrictEqual(C.score(R2, { a: 3, b: 2.5 }), { total: null, level: null });
  assert.deepStrictEqual(C.score(R2, null), { total: null, level: null });
});

test('weakest:并列时按量规原有顺序,n 超出时不报错', () => {
  const items = [{ id: 'a', name: '甲', level: 3 }, { id: 'b', name: '乙', level: 1 }, { id: 'c', name: '丙', level: 1 }, { id: 'd', name: '丁', level: 2 }];
  assert.deepStrictEqual(C.weakest(items, 2).map(x => x.id), ['b', 'c']);
  assert.deepStrictEqual(C.weakest(items, 3).map(x => x.id), ['b', 'c', 'd']);
  assert.strictEqual(C.weakest(items, 10).length, 4);
  assert.deepStrictEqual(C.weakest([], 2), []);
  const tie = items.map(x => ({ ...x, level: 2 }));
  assert.deepStrictEqual(C.weakest(tie, 2).map(x => x.id), ['a', 'b']);
});

const rec = (over = {}) => ({
  student: 'S01', title: '自我介绍',
  dims: [
    { id: 'a', level: 4, quote: '我叫小明', note: '' },
    { id: 'b', level: 1, quote: '', note: '多停顿' }
  ], ...over
});

test('feedback 包含称呼、总评、各维度、引用、补充、下次重点', () => {
  const t = C.feedback(R2, rec(), 'zh');
  assert.match(t, /S01 你好/);
  assert.match(t, /作业:自我介绍/);
  assert.match(t, /总分:62.5 \/ 100\(合格\)/);
  assert.match(t, /合格|基本达到/);
  assert.match(t, /### 发音\(50%\):表现突出/);
  assert.match(t, /等级4描述/);
  assert.match(t, /等级1反馈/);
  assert.match(t, /> 我叫小明/);
  assert.match(t, /老师补充:多停顿/);
  const next = t.split('### 下次重点')[1];
  assert.match(next, /流利:等级1反馈/);
  // SPEC:取等级最低的两个维度,即使第二个已是满级也要列出
  assert.match(next, /发音:等级4反馈/);
  assert.ok(next.indexOf('流利') < next.indexOf('发音'));
});

test('feedback 对学员输入做 Markdown 转义,文本模式不转义', () => {
  const r = rec({ student: '<b>x</b>', title: 'a*b', dims: [{ id: 'a', level: 3, quote: '<script>alert(1)</script>\n第二行', note: '' }, { id: 'b', level: 3, quote: '', note: '' }] });
  const md = C.feedback(R2, r, 'zh');
  assert.ok(!md.includes('<script>'));
  assert.ok(md.includes('\\<script\\>'));
  assert.ok(md.includes('> 第二行'));
  assert.ok(md.includes('a\\*b'));
  const txt = C.feedback(R2, r, 'zh', { format: 'text' });
  assert.ok(txt.includes('<script>alert(1)</script>'));
  assert.ok(txt.includes('【发音'));
  assert.ok(!txt.includes('###'));
  // 模板占位符不会被学员输入二次展开
  const inj = C.feedback(R2, rec({ student: '{title}' }), 'zh');
  assert.match(inj, /\{title\} 你好/);
});

test('feedback 双语模板与可编辑模板', () => {
  const en = C.feedback(R2, rec(), 'en');
  assert.match(en, /Hi S01,/);
  assert.match(en, /Total score:62.5 \/ 100\(Fair\)/);
  assert.match(en, /### Focus for next time/);
  assert.doesNotMatch(en, /你好/);
  const tpl = C.defaultTemplates(); tpl.zh.greeting = '亲爱的{name}:'; tpl.zh.closing = '加油。';
  const zh = C.feedback(R2, rec(), 'zh', { templates: tpl });
  assert.match(zh, /亲爱的S01:/);
  assert.match(zh, /加油。$/);
});

test('全部满级时下次重点仍列出最低的两个维度(并列按量规顺序)', () => {
  const R3 = rub([dim('a', '甲', 10), dim('b', '乙', 10), dim('c', '丙', 10)]);
  const full = { student: 'S', title: 't', dims: [{ id: 'a', level: 4 }, { id: 'b', level: 4 }, { id: 'c', level: 4 }] };
  const t = C.feedback(R3, full, 'zh');
  const next = t.split('### 下次重点')[1];
  assert.match(next, /- 甲:等级4反馈/);
  assert.match(next, /- 乙:等级4反馈/);
  assert.doesNotMatch(next, /丙/);
  assert.match(t, /总分:100 \/ 100/);
  // 单维度量规只有一个维度可列
  const one = C.feedback(rub([dim('a', '甲', 10)]), { student: 'S', title: 't', dims: [{ id: 'a', level: 4 }] }, 'zh');
  assert.match(one.split('### 下次重点')[1], /- 甲:/);
});

function mk(student, date, la, lb, id) {
  return C.makeRecord(R2, { student, title: 't' + id, date, grades: { a: la, b: lb }, quotes: {}, notes: {}, lang: 'zh' }, id);
}

test('trend 按日期升序、同日保持录入顺序,并算首末变化', () => {
  const recs = [mk('S01', '2026-10-13', 3, 4, 'x2'), mk('S02', '2026-10-01', 1, 1, 'y1'), mk('S01', '2026-09-22', 2, 4, 'x1'), mk('S01', '2026-10-13', 4, 4, 'x3')];
  const t = C.trend(recs, 'S01');
  assert.deepStrictEqual(t.rows.map(r => r.id), ['x1', 'x2', 'x3']);
  assert.deepStrictEqual(t.dims, ['发音', '流利']);
  assert.deepStrictEqual(t.rows[0].cells, [2, 4]);
  assert.deepStrictEqual(t.change, [2, 0]);
  assert.strictEqual(t.rows.some(r => r.id === 'y1'), false);
});

test('空记录与未知学员不报错', () => {
  assert.deepStrictEqual(C.trend([], 'S01'), { student: 'S01', dims: [], rows: [], change: [] });
  assert.deepStrictEqual(C.trend(undefined, 'S01').rows, []);
  assert.deepStrictEqual(C.studentsOf([]), []);
  assert.strictEqual(C.toCsv([]).split('\r\n').length, 1);
  assert.strictEqual(C.toCsv(undefined, 'x').startsWith('日期,学员'), true);
});

test('studentsOf 用 Map 分组,__proto__ 学员代号不污染', () => {
  const recs = [mk('__proto__', '2026-10-01', 2, 2, 'p1'), mk('constructor', '2026-10-01', 2, 2, 'p2'), mk('__proto__', '2026-10-02', 3, 3, 'p3')];
  const s = C.studentsOf(recs);
  assert.deepStrictEqual(s.find(x => x.name === '__proto__'), { name: '__proto__', count: 2 });
  assert.strictEqual(s.find(x => x.name === 'constructor').count, 1);
  assert.strictEqual(C.trend(recs, '__proto__').rows.length, 2);
  assert.strictEqual({}.polluted, undefined);
});

test('validateRubric 拒绝等级数不为 4、负权重、重复 id、零权重和', () => {
  assert.strictEqual(C.validateRubric(R2).ok, true);
  const bad3 = rub([{ ...dim('a', '甲', 10), levels: lv().slice(0, 3) }]);
  assert.match(C.validateRubric(bad3).errors.join(), /4 个等级/);
  const bad5 = rub([{ ...dim('a', '甲', 10), levels: [...lv(), { desc: '', fb: '' }] }]);
  assert.strictEqual(C.validateRubric(bad5).ok, false);
  assert.match(C.validateRubric(rub([dim('a', '甲', -1), dim('b', '乙', 10)])).errors.join(), /负数/);
  assert.match(C.validateRubric(rub([dim('a', '甲', 10), dim('a', '乙', 10)])).errors.join(), /重复/);
  assert.match(C.validateRubric(rub([dim('a', '甲', 0)])).errors.join(), /大于 0/);
  assert.strictEqual(C.validateRubric(rub([dim('a', '甲', '10')])).ok, false);
  assert.strictEqual(C.validateRubric(rub([])).ok, false);
  assert.strictEqual(C.validateRubric(null).ok, false);
  const badLv = rub([{ ...dim('a', '甲', 10), levels: [{ desc: 1, fb: '' }, ...lv().slice(1)] }]);
  assert.strictEqual(C.validateRubric(badLv).ok, false);
});

function goodBackup() {
  return { version: 1, rubrics: [R2], records: [mk('S01', '2026-10-01', 3, 2, 'r1'), mk('S01', '2026-10-08', 4, 3, 'r2')], templates: C.defaultTemplates() };
}

test('validateImport 接受合法备份并返回数据', () => {
  const v = C.validateImport(JSON.parse(JSON.stringify(goodBackup())));
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.data.records.length, 2);
  assert.strictEqual(C.validateImport({ version: 1, rubrics: [], records: [] }).ok, true);
});

test('validateImport 整份拒绝:版本、日期、等级、重复 id、总分不符、坏模板', () => {
  const cases = [
    [b => { b.version = 2; }, /version/],
    [b => { b.records[0].date = '2026-02-30'; }, /日期/],
    [b => { b.records[0].dims[0].level = 5; }, /等级/],
    [b => { b.records[1].id = 'r1'; }, /重复/],
    [b => { b.records[0].total = 99; }, /总分/],
    [b => { b.records[0].lang = 'fr'; }, /lang/],
    [b => { b.rubrics.push({ ...R2 }); }, /重复/],
    [b => { b.rubrics[0].dims[0].weight = -5; }, /负数/],
    [b => { delete b.templates.zh.greeting; }, /greeting/],
    [b => { b.records = 'x'; }, /records/]
  ];
  for (const [mut, re] of cases) {
    const b = JSON.parse(JSON.stringify(goodBackup())); mut(b);
    const v = C.validateImport(b);
    assert.strictEqual(v.ok, false, String(re));
    assert.match(v.errors.join('|'), re);
    assert.strictEqual(v.data, null);
  }
  assert.strictEqual(C.validateImport('x').ok, false);
  assert.strictEqual(C.validateImport(null).ok, false);
});

test('CSV 公式防护:以 = + - @ 开头的字段加单引号,单独的 - + 不算', () => {
  assert.strictEqual(C.safeCell('=SUM(A1)'), "'=SUM(A1)");
  assert.strictEqual(C.safeCell('+1'), "'+1");
  assert.strictEqual(C.safeCell('-2'), "'-2");
  assert.strictEqual(C.safeCell('@x'), "'@x");
  assert.strictEqual(C.safeCell('-'), '-');
  assert.strictEqual(C.safeCell('+'), '+');
  assert.strictEqual(C.safeCell('正常'), '正常');
  const r = C.makeRecord(R2, { student: '=cmd|x', title: '含,逗号"和引号', date: '2026-10-01', grades: { a: 1, b: 4 }, lang: 'zh' }, 'z1');
  const csv = C.toCsv([r]);
  const lines = csv.split('\r\n');
  assert.strictEqual(lines.length, 2);
  assert.ok(lines[1].includes("'=cmd|x"));
  assert.ok(lines[1].includes('"含,逗号""和引号"'));
  assert.strictEqual(lines[0], '日期,学员,作业标题,量规,总分,等级,发音,流利,下次重点');
  assert.ok(lines[1].endsWith(',发音、流利'));  // 最低两个维度,满级也列
});

test('toCsv 按学员过滤并合并不同量规的维度列', () => {
  const R3 = rub([dim('x', '写作', 100)], 'r3', '写作量规');
  const w = C.makeRecord(R3, { student: 'S01', title: 'w', date: '2026-10-05', grades: { x: 3 }, lang: 'zh' }, 'w1');
  const csv = C.toCsv([mk('S01', '2026-10-01', 3, 3, 'a1'), w, mk('S02', '2026-10-01', 1, 1, 'a2')], 'S01');
  const lines = csv.split('\r\n');
  assert.strictEqual(lines.length, 3);
  assert.ok(lines[0].includes('发音,流利,写作'));
  assert.ok(lines[2].includes(',,,3,') || lines[2].includes(',,3,'));
});

test('resolveToday 读取 ?today 并校验,非法回退', () => {
  assert.strictEqual(C.resolveToday('?today=2026-10-20', '2030-01-01'), '2026-10-20');
  assert.strictEqual(C.resolveToday('?today=2026-13-01', '2030-01-01'), '2030-01-01');
  assert.strictEqual(C.resolveToday('?today=abc', '2030-01-01'), '2030-01-01');
  assert.strictEqual(C.resolveToday('?today=2026-02-29', '2030-01-01'), '2030-01-01');
  assert.strictEqual(C.resolveToday('', '2030-01-01'), '2030-01-01');
  assert.strictEqual(C.resolveToday(undefined, undefined).length, 10);
  assert.strictEqual(C.resolveToday('?today=%E0%A4%A', '2030-01-01'), '2030-01-01');
});

test('makeRecord 生成快照与总分,不随原量规后续修改变化', () => {
  const R = JSON.parse(JSON.stringify(R2));
  const r = C.makeRecord(R, { student: ' S01 ', title: ' 标题\n换行 ', date: '2026-10-01', grades: { a: 4, b: 2 }, quotes: { a: ' 原句 ' }, notes: { b: '  补\n充 ' }, lang: 'en' }, 'k1');
  R.dims[0].name = '改名';
  assert.strictEqual(r.rubric.dims[0].name, '发音');
  assert.strictEqual(r.student, 'S01');
  assert.strictEqual(r.title, '标题 换行');
  assert.strictEqual(r.dims[0].quote, '原句');
  assert.strictEqual(r.dims[1].note, '补 充');
  assert.strictEqual(r.total, 75);
  assert.strictEqual(r.levelCode, 'B');
  assert.strictEqual(r.lang, 'en');
});

test('copyName:60 字量规名加后缀后仍合法(P0 回归)', () => {
  const long = '长'.repeat(60);
  const n = C.copyName(long);
  assert.ok(n.length <= 60);
  assert.ok(n.endsWith('(副本)'));
  assert.strictEqual(C.validateRubric(rub([dim('a', '甲', 1)], 'x', n)).ok, true);
  // 朴素拼接会超长并被校验拒绝
  assert.strictEqual(C.validateRubric(rub([dim('a', '甲', 1)], 'x', long + '(副本)')).ok, false);
  assert.strictEqual(C.copyName('短名'), '短名(副本)');
  const st = { rubrics: [rub([dim('a', '甲', 1)], 'x', n)], records: [], templates: C.defaultTemplates() };
  assert.strictEqual(C.validateImport(C.backup(st)).ok, true);
});

test('维度 id 为 __proto__ 时 makeRecord 不读到原型,validateRecord 拒绝无效记录(P0 回归)', () => {
  const RP = rub([dim('__proto__', '原型', 50), dim('b', '乙', 50)]);
  const plain = C.makeRecord(RP, { student: 'S', title: 't', date: '2026-10-01', grades: {}, quotes: {}, notes: {}, lang: 'zh' }, 'p1');
  assert.strictEqual(plain.dims[0].quote, '');
  assert.strictEqual(plain.dims[0].level, undefined);
  assert.strictEqual(plain.total, null);
  assert.strictEqual(C.validateRecord(plain).ok, false);
  // 用无原型对象写入 __proto__ 键可以正常评分
  const g = Object.create(null); g.__proto__ = 3; g.b = 2;
  const ok = C.makeRecord(RP, { student: 'S', title: 't', date: '2026-10-01', grades: g, lang: 'zh' }, 'p2');
  assert.strictEqual(ok.total, 62.5);
  assert.strictEqual(C.validateRecord(ok).ok, true);
  assert.strictEqual(C.validateImport({ version: 1, rubrics: [], records: [ok] }).ok, true);
  assert.strictEqual(C.validateImport({ version: 1, rubrics: [], records: [plain] }).ok, false);
});

test('overwriteConflicts:同 id 内容不同才算冲突(P0 回归)', () => {
  const sample = rub([dim('a', '甲', 10)], 'sample', '示例');
  const rec = C.makeRecord(sample, { student: 'S', title: 't', date: '2026-10-01', grades: { a: 3 }, lang: 'zh' }, 'sr1');
  const st = { rubrics: [], records: [] };
  assert.deepStrictEqual(C.overwriteConflicts(st, [sample], [rec]), []);
  st.rubrics = [JSON.parse(JSON.stringify(sample))]; st.records = [JSON.parse(JSON.stringify(rec))];
  assert.deepStrictEqual(C.overwriteConflicts(st, [sample], [rec]), []);
  st.rubrics[0].name = '我改过的名字';
  st.records[0].dims[0].note = '老师加的备注';
  const c = C.overwriteConflicts(st, [sample], [rec]);
  assert.strictEqual(c.length, 2);
  assert.match(c.join('|'), /我改过的名字/);
});

test('scoringRule: 公式、等级对应分数与 A/B/C/D 边界都来自同一份常量', () => {
  const r = C.scoringRule();
  assert.strictEqual(r.formula, '总分＝Σ（权重×等级）×25÷Σ权重');
  assert.strictEqual(r.levelPoints, '等级 1、2、3、4 分别对应 25、50、75、100 分');
  assert.strictEqual(r.grades, 'A：总分 ≥ 85；B：70 至 84.9；C：55 至 69.9；D：< 55');
  assert.match(r.text, /Σ（权重×等级）×25÷Σ权重.*等级 1.*25.*A：总分 ≥ 85/);
});

test('importPlan: 区分新增与替换的量规/记录,并说明措辞模板是否被替换', () => {
  const st = { rubrics: [R2], records: [], templates: C.defaultTemplates() };
  const rec = C.makeRecord(R2, { student: 'S1', title: 't', date: '2026-10-20', lang: 'zh', grades: g(3, 3) }, 'rec-1');
  const R3 = rub([dim('a', '发音', 100)], 'r3', '另一套');
  const st2 = { rubrics: [R2, R3], records: [rec], templates: C.defaultTemplates() };
  const p = C.importPlan(st, { rubrics: [R2, R3], records: [rec], templates: null });
  assert.deepStrictEqual([p.addedRubrics, p.replacedRubrics, p.addedRecords, p.replacedRecords, p.templatesReplaced], [1, 1, 1, 0, false]);
  const same = C.importPlan(st2, { rubrics: [R2], records: [rec], templates: C.defaultTemplates() });
  assert.deepStrictEqual([same.addedRubrics, same.replacedRubrics, same.addedRecords, same.replacedRecords, same.templatesReplaced], [0, 1, 0, 1, false]);
  const t = C.defaultTemplates(); t.zh.greeting = '同学：';
  assert.strictEqual(C.importPlan(st2, { rubrics: [], records: [], templates: t }).templatesReplaced, true);
  assert.match(p.text, /新增 1 套量规、替换 1 套量规；新增 1 条记录、替换 0 条记录/);
});

test('changedTemplateKeys: 只列出与已保存模板不同的键', () => {
  const saved = C.defaultTemplates().zh;
  assert.deepStrictEqual(C.changedTemplateKeys(saved, saved), []);
  const draft = Object.assign({}, saved, { greeting: '改过的称呼', closing: '改过的结束语' });
  assert.deepStrictEqual(C.changedTemplateKeys(saved, draft).sort(), ['closing', 'greeting']);
  assert.deepStrictEqual(C.changedTemplateKeys(saved, null), []);
});

test('hasSample: 按示例 id 判断数据里是否仍含合成示例', () => {
  assert.strictEqual(C.hasSample({ rubrics: [R2], records: [] }), false);
  assert.strictEqual(C.hasSample({ rubrics: [rub([dim('a', 'x', 1)], 'sample-oral')], records: [] }), true);
  assert.strictEqual(C.hasSample({ rubrics: [], records: [{ id: 'sample-rec-3' }] }), true);
  assert.strictEqual(C.hasSample({ rubrics: [], records: [{ id: 'rec-3' }] }), false);
});
