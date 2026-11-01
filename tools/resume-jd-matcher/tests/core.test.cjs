'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const terms = kws => kws.map(k => k.term);

test('要求行识别:中英文关键词都能命中,标题与职责行不算', () => {
  const jd = ['岗位:前端工程师', '岗位职责', '- 负责页面开发', '1. 熟悉 React', '2、Proficient in SQL', '3) 3 年以上经验', 'Familiar with Docker', '有海外经历者优先', '薪资面议'].join('\n');
  const lines = C.extractRequirementLines(jd);
  assert.deepEqual(lines, ['熟悉 React', 'Proficient in SQL', '3 年以上经验', 'Familiar with Docker', '有海外经历者优先']);
  assert.deepEqual(C.extractRequirementLines(''), []);
  assert.deepEqual(C.extractRequirementLines(null), []);
});

test('切词:按顿号逗号分号斜杠括号和 与 及 切开', () => {
  const kws = C.extractKeywords(['掌握课堂管理与课件制作;熟悉 PPT、课程设计(含教案)']);
  assert.deepEqual(terms(kws), ['课堂管理', '课件制作', 'PPT', '课程设计', '含教案']);
  assert.deepEqual(terms(C.extractKeywords(['熟悉Zoom和腾讯会议'])), ['Zoom', '腾讯会议']);
});

test('切词:英文词与缩写整体保留(SQL / Next.js / CI/CD / C++)', () => {
  const kws = C.extractKeywords(['精通 SQL、Next.js、CI/CD,熟悉 C++ 和 Node.js']);
  assert.deepEqual(terms(kws), ['SQL', 'Next.js', 'CI/CD', 'C++', 'Node.js']);
});

test('切词:单字和/与/及不破坏词内用法("参与""及时")', () => {
  assert.deepEqual(terms(C.extractKeywords(['参与项目开发,及时沟通'])), ['参与项目开发', '及时沟通']);
});

test('停用词过滤:熟悉/了解/能力/相关/经验/优先/年数不进入候选', () => {
  const kws = C.extractKeywords(['熟悉', '有 3 年以上经验', '具备良好的沟通能力', '相关专业优先', 'Required: experience with the Python']);
  assert.deepEqual(terms(kws), ['沟通', '专业', 'Python']);
});

test('must / 加分分组:优先、plus 为加分,精通、required、无标记为必须,同词取必须', () => {
  const kws = C.extractKeywords(['精通 Java', 'Go is a plus', '熟悉 Redis', '有 Docker 经验优先', 'Docker required']);
  const m = Object.fromEntries(kws.map(k => [k.term, k.must]));
  assert.equal(m.Java, true);
  assert.equal(m.Go, false);
  assert.equal(m.Redis, true);
  assert.equal(m.Docker, true);
  const mixed = C.extractKeywords(['熟悉 React,有 Vue 经验优先']);
  assert.deepEqual(mixed.map(k => [k.term, k.must]), [['React', true], ['Vue', false]]);
});

test('normalize:全半角、大小写、空白统一', () => {
  assert.equal(C.normalize('ＳＱＬ　Server'), 'sqlserver');
  assert.equal(C.normalize(' Next.js '), 'next.js');
  assert.equal(C.normalize('（ＨＳＫ）'), '(hsk)');
  assert.equal(C.normalize(null), '');
});

test('同义词命中:HSK = 汉语水平考试,只有该组声明后才命中', () => {
  const kws = [{ term: 'HSK', must: true }];
  const resume = '负责汉语水平考试备考辅导';
  assert.equal(C.match(kws, resume, '').hits.length, 0);
  const r = C.match(kws, resume, 'HSK = 汉语水平考试');
  assert.equal(r.hits.length, 1);
  assert.deepEqual(r.hits[0].lines, [1]);
  assert.equal(C.match([{ term: '汉语水平考试', must: true }], '只写了 HSK', 'HSK = 汉语水平考试').hits.length, 1);
});

test('匹配:全半角与大小写不敏感;英文词有边界,SQL 不命中 NoSQL', () => {
  assert.equal(C.match([{ term: 'SQL', must: true }], '熟练使用ｓｑｌ优化', '').hits.length, 1);
  assert.equal(C.match([{ term: 'SQL', must: true }], '使用 NoSQL 数据库', '').hits.length, 0);
  assert.equal(C.match([{ term: 'C', must: true }], '用 C++ 和 React', '').hits.length, 0);
  assert.equal(C.match([{ term: 'Google Meet', must: true }], 'google   meet 授课', '').hits.length, 1);
  assert.equal(C.match([{ term: '课件制作', must: true }], '课件 制作经验', '').hits.length, 1);
});

test('覆盖率:命中数/关键词数,必须与加分分别统计,0 个关键词不除零', () => {
  const kws = [{ term: 'React', must: true }, { term: 'Vue', must: true }, { term: 'Docker', must: false }, { term: 'Go', must: false }];
  const r = C.match(kws, 'React 项目\nDocker 部署', '');
  assert.equal(r.coverage, 0.5);
  assert.equal(r.mustCoverage, 0.5);
  assert.equal(r.bonusCoverage, 0.5);
  assert.deepEqual(r.missing, ['Vue', 'Go']);
  assert.deepEqual(r.byGroup.must, { hit: 1, total: 2, missing: ['Vue'] });
  const z = C.match([], '任何内容', '');
  assert.equal(z.coverage, 0);
  assert.equal(z.mustCoverage, 0);
  assert.ok(Number.isFinite(z.coverage));
});

test('命中行号:返回简历里的原始行号(含空行),同一词多行都列出', () => {
  const resume = '姓名\n\n用 React 做后台\n无关\n再次使用 react';
  const r = C.match([{ term: 'React', must: true }], resume, '');
  assert.deepEqual(r.hits[0].lines, [3, 5]);
});

test('事实句抽取:百分号、年、人、万、倍、+,同句去重;含年份的句子保留', () => {
  const resume = ['2022.03–2024.08 某公司', '2019年毕业于某大学', '- 转化率提升 300%', '- 团队 5 人;累计服务 20 万用户', '性能提升 3 倍,覆盖 100+ 门店', '拥有 3 年经验。熟悉 React', '- 转化率提升 300%'].join('\n');
  const f = C.extractFacts(resume);
  assert.deepEqual(f.map(x => x.text), ['2019年毕业于某大学', '转化率提升 300%', '团队 5 人', '累计服务 20 万用户', '性能提升 3 倍,覆盖 100+ 门店', '拥有 3 年经验']);
  assert.deepEqual(f.map(x => x.line), [2, 3, 4, 4, 5, 6]);
  assert.deepEqual(C.extractFacts('没有数字的句子'), []);
  assert.equal(C.extractFacts('提升 ５０％')[0].text, '提升 ５０％');
});

test('diffLines:新增/删除/不变,LCS 保持顺序', () => {
  const d = C.diffLines('A\nB\nC\nD', 'A\nC\nX\nD');
  assert.deepEqual(d.map(x => x.type + ':' + x.text), ['same:A', 'del:B', 'same:C', 'add:X', 'same:D']);
  assert.deepEqual(C.diffLines('', 'a').map(x => x.type), ['add']);
  assert.deepEqual(C.diffLines('a', '').map(x => x.type), ['del']);
  assert.deepEqual(C.diffLines('x\r\ny', 'x\ny').map(x => x.type), ['same', 'same']);
  assert.deepEqual(C.diffLines('', ''), []);
});

test('版本趋势:按时间升序,忽略录入顺序,delta 为相邻覆盖率之差', () => {
  const tr = C.versionTrend([
    { id: 'c', title: '三', time: '2026-10-20T10:00', coverage: 0.8 },
    { id: 'a', title: '一', time: '2026-10-01T09:00', coverage: 0.4 },
    { id: 'b', title: '二', time: '2026-10-10T09:00', coverage: 0.5 }
  ]);
  assert.deepEqual(tr.map(x => x.id), ['a', 'b', 'c']);
  assert.equal(tr[0].delta, null);
  assert.ok(Math.abs(tr[1].delta - 0.1) < 1e-9);
  assert.ok(Math.abs(tr[2].delta - 0.3) < 1e-9);
});

test('公式前缀防护:= + - @ 开头加单引号,单独的 - + 不加,表格转义竖线', () => {
  assert.equal(C.guard('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(C.guard('+86 138'), "'+86 138");
  assert.equal(C.guard('-5%'), "'-5%");
  assert.equal(C.guard('@cmd'), "'@cmd");
  assert.equal(C.guard('-'), '-');
  assert.equal(C.guard('+'), '+');
  assert.equal(C.guard('普通'), '普通');
  const md = C.toMarkdown({
    jobTitle: '岗位', result: C.match([{ term: '=HYPERLINK("x")', must: true }, { term: 'a|b', must: false }], '', ''),
    facts: [{ line: 1, text: '@evil 提升 50%', status: 'fix' }]
  });
  assert.match(md, /\| '=HYPERLINK\("x"\) \| 必须 \| 缺失 \|/);
  assert.match(md, /\| a\\\|b \|/);
  assert.match(md, /\| 1 \| '@evil 提升 50% \| 需修改 \|/);
});

test('toMarkdown:含覆盖率、缺失清单、事实核验表', () => {
  const result = C.match([{ term: 'React', must: true }, { term: 'Go', must: false }], 'React', '');
  const md = C.toMarkdown({ jobTitle: '前端', date: '2026-10-20', resumeLabel: '版本一', result, facts: [{ line: 2, text: '提升 3 倍', status: 'ok' }, { line: 3, text: '5 人团队', status: undefined }] });
  assert.match(md, /^# 岗位对照报告:前端/);
  assert.match(md, /总覆盖率:50%\(1\/2\)/);
  assert.match(md, /- Go\(加分\)/);
  assert.match(md, /\| 2 \| 提升 3 倍 \| 有证据 \|/);
  assert.match(md, /\| 3 \| 5 人团队 \| 未核验 \|/);
});

function validBackup() {
  return {
    app: 'jobmatch', version: 1, currentId: 'j1',
    jobs: [{
      id: 'j1', title: 't', jd: 'x', resume: 'y', synonyms: '', keywords: [{ term: 'React', must: true, on: true }], kwFrom: 'x',
      factChecks: { k: 'ok' },
      versions: [{ id: 'v1', title: '一', time: '2026-10-01T09:00', text: 'y', coverage: 0.5, mustCoverage: 0.5, hits: 1, total: 2 }]
    }]
  };
}

test('validateImport:合法备份通过,并且返回无原型的 factChecks', () => {
  const r = C.validateImport(JSON.stringify(validBackup()));
  assert.equal(r.ok, true);
  assert.equal(r.data.jobs[0].factChecks.k, 'ok');
  assert.equal(Object.getPrototypeOf(r.data.jobs[0].factChecks), null);
});

test('validateImport:缺字段、错类型、非法枚举、重复 ID、坏时间整份拒绝', () => {
  const bad = fn => { const b = validBackup(); fn(b); return C.validateImport(b); };
  assert.equal(C.validateImport('{oops').ok, false);
  assert.equal(C.validateImport([]).ok, false);
  assert.equal(bad(b => { b.app = 'other'; }).ok, false);
  assert.equal(bad(b => { b.version = 2; }).ok, false);
  assert.equal(bad(b => { delete b.jobs[0].jd; }).ok, false);
  assert.equal(bad(b => { b.jobs[0].keywords[0].must = 'yes'; }).ok, false);
  assert.equal(bad(b => { b.jobs[0].factChecks.k = 'maybe'; }).ok, false);
  assert.equal(bad(b => { b.jobs.push(JSON.parse(JSON.stringify(b.jobs[0]))); }).ok, false);
  assert.equal(bad(b => { b.jobs[0].versions.push({ ...b.jobs[0].versions[0] }); }).ok, false);
  assert.equal(bad(b => { b.jobs[0].versions[0].time = 'yesterday'; }).ok, false);
  assert.equal(bad(b => { b.jobs[0].versions[0].coverage = 1.5; }).ok, false);
  assert.equal(bad(b => { b.currentId = 'nope'; }).ok, false);
  const r = bad(b => { b.jobs[0].keywords.push({ term: ' react ', must: false, on: true }); });
  assert.equal(r.ok, false);
  assert.match(r.error, /重复/);
});

test('?today:合法日期生效,非法回退不抛错', () => {
  assert.equal(C.resolveToday('?today=2026-10-20', '2000-01-01'), '2026-10-20');
  assert.equal(C.resolveToday('?today=2026-02-30', '2000-01-01'), '2000-01-01');
  assert.equal(C.resolveToday('?today=abc', '2000-01-01'), '2000-01-01');
  assert.equal(C.resolveToday('', '2000-01-01'), '2000-01-01');
  assert.equal(C.resolveToday(undefined, '2000-01-01'), '2000-01-01');
  assert.equal(C.stamp('2026-10-20', new Date(2020, 0, 1, 9, 5)), '2026-10-20T09:05');
});

test('原型键:同义词和关键词含 __proto__ / constructor 不污染也不崩', () => {
  const r = C.match([{ term: '__proto__', must: true }, { term: 'constructor', must: false }], 'constructor 用法', '__proto__ = proto\nconstructor = 构造');
  assert.deepEqual(r.hits.map(h => h.term), ['constructor']);
  assert.deepEqual(r.missing, ['__proto__']);
  assert.equal({}.polluted, undefined);
});

test('英文匹配按去空格规则:SQL 命中 "S Q L"、GoogleMeet 命中 Google Meet,仍不命中 NoSQL', () => {
  assert.equal(C.match([{ term: 'SQL', must: true }], '熟练使用 S Q L 优化', '').hits.length, 1);
  assert.equal(C.match([{ term: 'Google Meet', must: true }], '用 GoogleMeet 授课', '').hits.length, 1);
  assert.equal(C.match([{ term: 'SQL', must: true }], '使用 NoSQL 与 No SQL 数据库', '').hits.length, 1);
  assert.equal(C.match([{ term: 'SQL', must: true }], '只用 NoSQL', '').hits.length, 0);
  assert.equal(C.match([{ term: 'Next.js', must: true }], 'Next . js 项目', '').hits.length, 1);
});

test('[第五轮] keywordAdjustments:区分手动添加、改过类型、删除、取消勾选(以上次提取为基准)', () => {
  const base = [{ term: 'SQL', must: true }, { term: 'Excel', must: false }, { term: 'Python', must: true }];
  const none = C.keywordAdjustments(base.map(k => ({ term: k.term, must: k.must, on: true })), base);
  assert.equal(none.count, 0);
  const cur = [
    { term: 'SQL', must: false, on: true },       // 改过类型
    { term: 'Excel', must: false, on: false },    // 取消勾选
    { term: 'Figma', must: true, on: true }       // 手动添加(Python 被删除)
  ];
  const a = C.keywordAdjustments(cur, base);
  assert.deepEqual(a.added, ['Figma']);
  assert.deepEqual(a.retyped, ['SQL']);
  assert.deepEqual(a.deleted, ['Python']);
  assert.deepEqual(a.off, ['Excel']);
  assert.equal(a.count, 4);
  // 全半角与大小写不影响判断
  assert.equal(C.keywordAdjustments([{ term: 'ｓｑｌ', must: true, on: true }], [{ term: 'SQL', must: true }]).count, 0);
  // 没有上次提取基准(只手动加过词)时,所有词都是手动添加
  assert.deepEqual(C.keywordAdjustments([{ term: 'Figma', must: true, on: true }], []).added, ['Figma']);
});

test('[第五轮] mergeKeywords keep:保留手动词、改过的类型、取消勾选,补入新词,不把已删除的词加回来', () => {
  const base = [{ term: 'SQL', must: true }, { term: 'Excel', must: false }, { term: 'Python', must: true }];
  const cur = [
    { term: 'SQL', must: false, on: true },
    { term: 'Excel', must: false, on: false },
    { term: 'Figma', must: true, on: true }
  ];
  const found = [{ term: 'SQL', must: true }, { term: 'Excel', must: false }, { term: 'Python', must: true }, { term: 'Notion', must: true }];
  const kept = C.mergeKeywords(cur, base, found, 'keep');
  assert.deepEqual(kept, [
    { term: 'SQL', must: false, on: true },
    { term: 'Excel', must: false, on: false },
    { term: 'Figma', must: true, on: true },
    { term: 'Notion', must: true, on: true }
  ]);
  // 输入不被修改
  assert.equal(cur.length, 3);
  assert.equal(cur[0].must, false);
});

test('[第五轮] mergeKeywords replace:整个列表换成新提取结果,调整全部丢弃', () => {
  const found = [{ term: 'SQL', must: true }, { term: 'Notion', must: false }];
  const out = C.mergeKeywords([{ term: 'Figma', must: true, on: true }, { term: 'SQL', must: false, on: false }], [], found, 'replace');
  assert.deepEqual(out, [{ term: 'SQL', must: true, on: true }, { term: 'Notion', must: false, on: true }]);
});
