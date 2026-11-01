'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../core.js');
require('../sample-data.js');

const mk = (o) => Object.assign({ id: '1', stem: '题干', options: ['甲', '乙', '丙', '丁'], answer: 'A', topic: 't', difficulty: '易' }, o);
const codes = (qs) => C.check(qs).issues.map(i => i.code);

test('Node 下 require 不触碰 document/window', () => {
  assert.strictEqual(typeof document, 'undefined');
  assert.strictEqual(typeof C.check, 'function');
});

test('文本块解析:多行题干、多行选项、缺答案', () => {
  const text = [
    '1. 下面哪个词表示地点?', '请选择一个', 'A. 图书馆', 'B. 今天', 'C. 很高兴', 'D. 苹果', '答案:A', '知识点:HSK1', '难度:易',
    '',
    '2. 没写答案的题', 'A. 甲', 'B. 乙 的第一行', '乙 的第二行',
    '',
    '3. 全角答案', 'A. 甲', 'B. 乙', '答案：Ｂ。'
  ].join('\n');
  const { questions, errors } = C.parseTextBank(text);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(questions.length, 3);
  assert.strictEqual(questions[0].stem, '下面哪个词表示地点?\n请选择一个');
  assert.deepStrictEqual(questions[0].options, ['图书馆', '今天', '很高兴', '苹果']);
  assert.strictEqual(questions[0].answer, 'A');
  assert.strictEqual(questions[0].topic, 'HSK1');
  assert.strictEqual(questions[1].answer, '');
  assert.strictEqual(questions[1].options[1], '乙 的第一行 乙 的第二行');
  assert.strictEqual(questions[2].answer, 'B');
  assert.ok(codes(questions).includes('answer-empty'));
});

test('文本块:空文本返回错误而不是空题库成功', () => {
  assert.strictEqual(C.parseTextBank('  \n\n ').questions.length, 0);
  assert.ok(C.parseTextBank('').errors.length > 0);
});

test('CSV 解析:引号内逗号与换行、TSV 自动识别、列自动映射', () => {
  const csv = '题号,题干,A,B,答案\n1,"含,逗号\n与换行",x,y,B\n';
  const p = C.parseDelimited(csv);
  assert.strictEqual(p.rows.length, 1);
  assert.strictEqual(p.rows[0][1], '含,逗号\n与换行');
  const t = C.parseDelimited('题号\t题干\tA\tB\t答案\n1\t题\tx\ty\tA');
  assert.strictEqual(t.delimiter, '\t');
  const m = C.autoMapping(t.headers);
  assert.deepStrictEqual(m.options, [2, 3]);
  assert.strictEqual(m.answer, 4);
  const r = C.parseCsvBank(t, m);
  assert.strictEqual(r.questions[0].answer, 'A');
});

test('列映射不合法时整份拒绝', () => {
  const p = C.parseDelimited('题干,A,B,答案\n题,x,y,A');
  const bad1 = C.parseCsvBank(p, { id: -1, stem: 0, options: [1, 1], answer: 3 });
  assert.ok(bad1.errors.length && bad1.questions.length === 0);
  const bad2 = C.parseCsvBank(p, { id: -1, stem: 0, options: [1, 9], answer: 3 });
  assert.ok(bad2.errors.some(e => e.includes('不存在')));
  const bad3 = C.parseCsvBank(p, { id: -1, stem: 1, options: [1, 2], answer: 3 });
  assert.ok(bad3.errors.some(e => e.includes('同时')));
  const bad4 = C.parseCsvBank(p, { id: -1, stem: 0, options: [1], answer: 3 });
  assert.ok(bad4.errors.some(e => e.includes('2 列')));
});

test('答案越界与答案为空是阻断', () => {
  const r = C.check([mk({ id: '1', answer: 'E' }), mk({ id: '2', answer: '' }), mk({ id: '3', answer: 'AB' }), mk({ id: '4', answer: 'D' })]);
  const byQ = i => r.issues.filter(x => x.qIndex === i).map(x => x.code);
  assert.ok(byQ(0).includes('answer-range'));
  assert.ok(byQ(1).includes('answer-empty'));
  assert.ok(byQ(2).includes('answer-range'));
  assert.ok(!byQ(3).includes('answer-range'));
  assert.ok(r.issues.filter(x => x.code.startsWith('answer-')).every(x => x.level === 'block'));
});

test('选项数不足与题干为空', () => {
  const c = codes([mk({ options: ['只有一个'], answer: 'A' }), mk({ id: '2', stem: '  ' })]);
  assert.ok(c.includes('options-few'));
  assert.ok(c.includes('stem-empty'));
});

test('题号重复:同号双方都标记,空题号只警告', () => {
  const r = C.check([mk({ id: '5' }), mk({ id: '5', stem: '另一题' }), mk({ id: '6' }), mk({ id: '', stem: '又一题' })]);
  assert.deepStrictEqual(r.issues.filter(i => i.code === 'id-duplicate').map(i => i.qIndex), [0, 1]);
  assert.strictEqual(r.issues.find(i => i.code === 'id-missing').level, 'warn');
});

test('选项文字重复(忽略空白与标点)', () => {
  const r = C.check([mk({ options: ['苹 果。', '苹果', '梨', '桃'] })]);
  const d = r.issues.find(i => i.code === 'option-duplicate');
  assert.ok(d && d.level === 'block' && d.message.includes('A') && d.message.includes('B'));
});

test('长度陷阱阈值:恰好 1.6 倍不报,超过才报;过短 0.6 倍同理', () => {
  const others = (n) => ['x'.repeat(n), 'y'.repeat(n), 'z'.repeat(n)];
  const q = (len) => mk({ options: ['a'.repeat(len)].concat(others(10)), answer: 'A' });
  assert.ok(!codes([q(16)]).includes('length-trap'));
  assert.ok(codes([q(17)]).includes('length-trap'));
  assert.ok(!codes([q(6)]).includes('length-trap'));
  assert.ok(codes([q(5)]).includes('length-trap'));
  assert.ok(!codes([q(10)]).includes('length-trap'));
});

test('答案字母分布:超过 40% 报警(无最少题数限制),恰好 40% 不报', () => {
  const mkSet = (letters) => letters.split('').map((l, i) => mk({ id: String(i + 1), stem: '题' + i, answer: l }));
  const ok40 = C.check(mkSet('BBBBCADCDA'));
  assert.ok(!ok40.issues.some(i => i.code === 'letter-skew'));
  const skew = C.check(mkSet('BBBBBCADCD'));
  const hit = skew.issues.find(i => i.code === 'letter-skew');
  assert.ok(hit && hit.level === 'warn' && hit.qIndex === -1);
  assert.ok(C.check(mkSet('AAAA')).issues.some(i => i.code === 'letter-skew'), '4 题全选 A 也要报');
  assert.ok(C.check(mkSet('A')).issues.some(i => i.code === 'letter-skew'), '1 题占 100% 也按 SPEC 报');
  assert.ok(!C.check(mkSet('')).issues.some(i => i.code === 'letter-skew'), '没有有效答案不报');
});

test('题干相似:归一化空白/标点/全半角后相同才报', () => {
  const r = C.check([
    mk({ id: '1', stem: '“学习”是什么词性?' }),
    mk({ id: '2', stem: '  学习  是什么词性 ?' }),
    mk({ id: '3', stem: '“学习”是什么意思?' })
  ]);
  assert.deepStrictEqual(r.issues.filter(i => i.code === 'stem-similar').map(i => i.qIndex), [0, 1]);
});

test('其余警告:知识点为空、以上都对、否定题干与肯定答案', () => {
  const c = codes([
    mk({ id: '1', topic: '' }),
    mk({ id: '2', stem: 'b', options: ['甲', '以上都对', '乙', '丙'] }),
    mk({ id: '3', stem: '以下哪项不是水果?', options: ['苹果', '米饭', '梨', '桃'], answer: 'B' })
  ]);
  assert.ok(c.includes('topic-empty'));
  assert.ok(c.includes('all-above'));
  assert.ok(c.includes('negation-mismatch'));
  const none = codes([mk({ id: '9', stem: '以下哪项不是水果?', options: ['苹果', '不是水果的米饭', '梨', '桃'], answer: 'B' })]);
  assert.ok(!none.includes('negation-mismatch'));
});

test('统计:字母分布、知识点、难度', () => {
  const r = C.check([mk({ id: '1', answer: 'A', topic: 'x' }), mk({ id: '2', stem: '2', answer: 'A', topic: 'x', difficulty: '' }), mk({ id: '3', stem: '3', answer: 'C', topic: '' })]);
  assert.strictEqual(r.stats.total, 3);
  assert.deepStrictEqual(r.stats.letters.map(l => l.count), [2, 0, 1, 0]);
  assert.deepStrictEqual(r.stats.topics.find(t => t.name === 'x'), { name: 'x', count: 2 });
  assert.strictEqual(r.stats.topics.find(t => t.name === '(未填)').count, 1);
  assert.strictEqual(r.stats.difficulties.find(t => t.name === '(未填)').count, 1);
});

test('shuffle:同种子可复现、不同种子不同、答案文字保持一致、不改入参', () => {
  const qs = Array.from({ length: 12 }, (_, i) => mk({ id: String(i), stem: '题' + i, options: ['一', '二', '三', '四'], answer: 'ABCD'[i % 4] }));
  const snap = JSON.stringify(qs);
  const a = C.shuffle(qs, 'seed-1'), b = C.shuffle(qs, 'seed-1'), c = C.shuffle(qs, 'seed-2');
  assert.strictEqual(JSON.stringify(qs), snap);
  assert.deepStrictEqual(a, b);
  assert.notDeepStrictEqual(a, c);
  qs.forEach((q, i) => {
    assert.strictEqual(a[i].options[C.answerIndex(a[i])], q.options[C.answerIndex(q)]);
    assert.deepStrictEqual(a[i].options.slice().sort(), q.options.slice().sort());
  });
  assert.ok(a.some((q, i) => q.options.join() !== qs[i].options.join()), '至少有一题顺序发生变化');
});

test('shuffle:非法题原样保留;「以上都对」固定末位', () => {
  const bad = mk({ answer: 'E' });
  const pin = mk({ id: '2', options: ['甲', '乙', '丙', '以上都对'], answer: 'D' });
  for (let s = 0; s < 20; s++) {
    const r = C.shuffle([bad, pin], 'k' + s);
    assert.deepStrictEqual(r[0], bad);
    assert.strictEqual(r[1].options[3], '以上都对');
    assert.strictEqual(r[1].answer, 'D');
  }
});

test('试卷 Markdown:答案在分页之后,题目部分不含参考答案', () => {
  const md = C.toExamMarkdown([mk({ id: '9', stem: 'Q1', answer: 'C' }), mk({ id: '9', stem: 'Q2', answer: 'B' })], '期中');
  const [paper, ans] = md.split('page-break-before');
  assert.ok(paper.includes('# 期中') && paper.includes('**1.** Q1') && paper.includes('**2.** Q2'));
  assert.ok(!paper.includes('参考答案'));
  assert.ok(ans.includes('## 参考答案') && ans.includes('1. C') && ans.includes('2. B'));
});

test('公式防护:CSV 与 Markdown 表格对 = + - @ 开头加单引号,单独的 -/+ 不加', () => {
  assert.strictEqual(C.guard('=1+1'), "'=1+1");
  assert.strictEqual(C.guard('-'), '-');
  assert.strictEqual(C.guard('+'), '+');
  assert.strictEqual(C.guard('-5'), "'-5");
  const q = mk({ id: '@a', stem: '=HYPERLINK("x")', options: ['+1', '-', 'a,b', '正常'] });
  const csv = C.toCsv([q]);
  assert.ok(csv.includes("'@a") && csv.includes(`"'=HYPERLINK(""x"")"`) && csv.includes("'+1"));
  assert.ok(csv.split('\n')[1].split(',').includes('-'));
  const md = C.issuesToMarkdown([{ qIndex: 0, qid: '=cmd|x', level: 'warn', code: 'topic-empty', message: '@x | y' }], { total: 1, letters: [], topics: [], difficulties: [] });
  assert.ok(md.includes("'=cmd\\|x") && md.includes("'@x \\| y"));
});

test('空题库:不抛错,统计为 0', () => {
  const r = C.check([]);
  assert.deepStrictEqual(r.issues, []);
  assert.strictEqual(r.stats.total, 0);
  assert.strictEqual(C.toCsv([]).trim().split('\n').length, 1);
  assert.ok(C.issuesToMarkdown([], r.stats).includes('没有发现问题'));
  assert.deepStrictEqual(C.shuffle([], 1), []);
});

test('__proto__ 作为知识点或难度不污染统计', () => {
  const r = C.check([mk({ topic: '__proto__', difficulty: 'constructor' })]);
  assert.strictEqual(r.stats.topics[0].name, '__proto__');
  assert.strictEqual(r.stats.topics[0].count, 1);
  assert.strictEqual({}.count, undefined);
});

test('示例题库:各类刻意问题都能被检出', () => {
  const p = C.parseDelimited(globalThis.QB_SAMPLE_CSV);
  const { questions, errors } = C.parseCsvBank(p, C.autoMapping(p.headers));
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(questions.length, 16);
  const set = new Set(codes(questions));
  for (const k of ['answer-range', 'id-duplicate', 'length-trap', 'letter-skew', 'stem-similar', 'option-duplicate', 'topic-empty', 'all-above', 'negation-mismatch'])
    assert.ok(set.has(k), '缺少 ' + k);
});

test('validateStored 拒绝类型错误的本地数据', () => {
  assert.ok(C.validateStored({ bank: [mk({})], shuffled: null, view: 'original' }).ok);
  assert.ok(!C.validateStored({ bank: [{ id: 1 }] }).ok);
  assert.ok(!C.validateStored({ bank: [], view: 'shuffled' }).ok);
  assert.ok(!C.validateStored(null).ok);
});

test('CSV 未闭合引号:解析报错,parseCsvBank 拒绝,不产生题目', () => {
  const p = C.parseDelimited('题干,A,B,答案\n题,x,y,"A');
  assert.ok(p.error && p.error.includes('引号'));
  assert.strictEqual(p.rows.length, 0);
  const r = C.parseCsvBank(p, { id: -1, stem: 0, options: [1, 2], answer: 3 });
  assert.strictEqual(r.questions.length, 0);
  assert.ok(r.errors.length > 0);
  const ok = C.parseDelimited('题干,A,B,答案\n题,x,y,"A"');
  assert.strictEqual(ok.error, undefined);
  assert.strictEqual(ok.rows[0][3], 'A');
  assert.ok(!C.parseDelimited('a,"b""c",d').error, '转义引号合法');
});

test('issueSummary: 统计阻断与警告数量,并写明打乱不会修复阻断问题', () => {
  const qs = [mk({ id: '1', answer: 'E' }), mk({ id: '1', stem: '另一题' })];
  const s = C.issueSummary(C.check(qs).issues);
  assert.ok(s.block >= 2, '答案越界与题号重复至少两条阻断');
  assert.strictEqual(s.block + s.warn, C.check(qs).issues.length);
  assert.match(s.text, new RegExp(`${s.block} 个阻断问题`));
  assert.match(s.text, /打乱选项不会修复答案越界、答案为空、题号重复/);
  const clean = C.issueSummary(C.check([mk({ id: '1', topic: 'a' }), mk({ id: '2', stem: '不同题干', answer: 'B', topic: 'a', options: ['一', '二', '三', '四'] })]).issues.filter(i => i.level === 'block'));
  assert.strictEqual(clean.block, 0);
  assert.match(clean.text, /没有阻断问题/);
});

test('importPreview: 写明将导入的题数、将被替换的题数与打乱结果,以及新题库里的阻断数', () => {
  const cur = { bank: [mk({ id: '1' }), mk({ id: '2' })], shuffled: { seed: '期中', questions: [] } };
  const inc = [mk({ id: '1', answer: 'E' }), mk({ id: '2' }), mk({ id: '3' })];
  const p = C.importPreview(cur, inc);
  assert.deepStrictEqual([p.incoming, p.replacing, p.hasShuffled, p.blockCount], [3, 2, true, 1]);
  assert.match(p.text, /解析出 3 题.*其中 1 个阻断问题.*替换现有 2 题和种子「期中」的打乱结果/);
  const fresh = C.importPreview({ bank: [], shuffled: null }, inc);
  assert.strictEqual(fresh.replacing, 0);
  assert.match(fresh.text, /现有题库为空/);
});

test('toCsv 导出原题库时保留知识点与难度(不需要先打乱)', () => {
  const csv = C.toCsv([mk({ id: '7', topic: '时态', difficulty: '难' })]);
  const rows = csv.trim().split(/\r?\n/);
  assert.match(rows[0], /知识点/);
  assert.match(rows[0], /难度/);
  assert.ok(rows[1].includes('时态') && rows[1].includes('难'));
});

test('validateStored 接受 sample 布尔标记,拒绝其它类型', () => {
  const base = { bank: [mk()], shuffled: null, view: 'original' };
  assert.strictEqual(C.validateStored(Object.assign({}, base, { sample: true })).ok, true);
  assert.strictEqual(C.validateStored(base).ok, true);
  assert.strictEqual(C.validateStored(Object.assign({}, base, { sample: 'yes' })).ok, false);
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

test('[W6 往返] 示例题库导出的原题库 CSV 末尾有「合成示例数据」标注行,重新导入时识别为示例标注,不能多出一道题', () => {
  const qs = [mk({ id: '1', stem: '一加一?' }), mk({ id: '2', stem: '二加二?', answer: 'B', topic: '算术', difficulty: '中' }), mk({ id: '3', stem: '含,逗号和"引号"的题干' })];
  const file = C.toCsv(qs).replace(/\r?\n?$/, '\r\n') + C.SAMPLE_NOTE + '\r\n';
  const sp = C.splitSampleNote(file);
  assert.strictEqual(sp.sample, true);
  const parsed = C.parseDelimited(sp.text);
  const res = C.parseCsvBank(parsed, C.autoMapping(parsed.headers));
  assert.deepStrictEqual(res.errors, []);
  assert.deepStrictEqual(res.questions, qs);
  // 没有标注行的文件原样返回;标注只认最后一个非空行,题干里出现同样的文字不受影响
  assert.deepStrictEqual(C.splitSampleNote(C.toCsv(qs)), { text: C.toCsv(qs), sample: false });
  const inner = C.toCsv([mk({ id: '1', stem: C.SAMPLE_NOTE })]);
  assert.strictEqual(C.splitSampleNote(inner).sample, false);
});
