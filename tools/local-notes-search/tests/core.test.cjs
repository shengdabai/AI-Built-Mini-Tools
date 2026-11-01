'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const DOCS = [
  { path: '日记/2026-10-01.md', text: '# 十月一日\n\n今天复习了间隔重复的卡片。\n\n晚上喝了一杯咖啡,写了一点代码。', mtime: Date.UTC(2026, 9, 1) },
  { path: '读书/记忆.md', text: '# 记忆的技术\n\n间隔重复是对抗遗忘的方法。\n\n复习不等于重复,要在快忘记时复习。', mtime: Date.UTC(2026, 9, 5) },
  { path: '项目/search.md', text: 'Notes about full text search.\n\nThe inverted index maps each word to paragraphs.\n\n倒排索引把词映射到段落。', mtime: Date.UTC(2026, 9, 3) },
  { path: '项目/coffee.txt', text: '咖啡豆的研磨度会影响萃取。\n\n复习笔记里不要写咖啡。', mtime: Date.UTC(2026, 9, 2) }
];
const idx = () => C.buildIndex(DOCS, { builtDate: '2026-10-20', source: '测试' });

test('tokenize:中文按字二元组,英文按小写词,标点切断', () => {
  assert.deepEqual(C.tokenize('机器学习'), ['机器', '器学', '学习']);
  assert.deepEqual(C.tokenize('Hello, World! v2'), ['hello', 'world', 'v2']);
  assert.deepEqual(C.tokenize('用AI做笔记。好'), ['用', 'ai', '做笔', '笔记', '好']);
  assert.deepEqual(C.tokenize('机器,学习'), ['机器', '学习'], '逗号两侧不能拼出跨标点 bigram');
  assert.deepEqual(C.tokenize(''), []);
  assert.deepEqual(C.tokenize(null), []);
});

test('tokenize:查询模式丢弃孤立单字,索引模式保留', () => {
  assert.deepEqual(C.tokenize('猫', { query: true }), []);
  assert.deepEqual(C.tokenize('猫'), ['猫']);
});

test('buildIndex:统计、段落号与倒排表升序', () => {
  const x = idx();
  assert.equal(x.stats.fileCount, 4);
  assert.equal(x.stats.paraCount, 3 + 3 + 3 + 2, '日记 3 段(含标题段) 记忆 3 段 search 3 段 coffee 2 段 = 11');
  assert.equal(x.docs[0].title, '十月一日');
  assert.equal(x.docs[3].title, 'coffee', '无标题时用文件名');
  assert.equal(x.stats.files.length, 4);
  assert.equal(x.stats.termCount, x.postings.size);
  for (const arr of x.postings.values()) for (let i = 1; i < arr.length; i++) assert.ok(arr[i] > arr[i - 1]);
  assert.deepEqual(C.validateIndex(x), { ok: true });
});

test('parseQuery:AND、短语、排除、path、单独的 - 与未闭合引号', () => {
  const q = C.parseQuery('复习 "间隔 重复" -咖啡 path:读书/ Notes');
  assert.deepEqual(q.must, ['复习', 'notes']);
  assert.deepEqual(q.phrases, ['间隔 重复']);
  assert.deepEqual(q.not, ['咖啡']);
  assert.equal(q.path, '读书/');
  assert.deepEqual(C.parseQuery('a - b').must, ['a', 'b']);
  const open = C.parseQuery('"没有结束');
  assert.deepEqual(open.phrases, ['没有结束']);
  assert.equal(open.warnings.length, 1);
  assert.deepEqual(C.parseQuery('-"整段 排除"').not, ['整段 排除']);
  assert.equal(C.parseQuery('path:"我的 日记/"').path, '我的 日记/');
});

test('search:空查询与只有排除/路径时返回空', () => {
  const x = idx();
  assert.deepEqual(C.search(x, ''), []);
  assert.deepEqual(C.search(x, '   '), []);
  assert.deepEqual(C.search(x, '-咖啡'), []);
  assert.deepEqual(C.search(x, 'path:日记/'), []);
});

test('search:多关键词 AND 要求同一段落同时含有', () => {
  const x = idx();
  const r = C.search(x, '复习 咖啡');
  assert.deepEqual(r.map(h => [h.path, h.para]), [['项目/coffee.txt', 2]]);
  assert.equal(C.search(x, '复习 咖啡 遗忘').length, 0);
});

test('search:短语必须是原文连续出现,bigram 交集误报会被剔除', () => {
  const x = C.buildIndex([{ path: 'a.md', text: '重复间隔很重要' }, { path: 'b.md', text: '间隔重复很重要' }]);
  // “间隔重复”的 bigram(间隔、隔重、重复)在 a.md 里并不全是相邻出现
  assert.deepEqual(C.search(x, '"间隔重复"').map(h => h.path), ['b.md']);
  assert.deepEqual(C.search(x, '间隔重复').map(h => h.path), ['b.md'], '含中文的普通词同样按原文子串验证');
});

test('search:英文词按整词匹配,不命中词内子串', () => {
  const x = idx();
  assert.equal(C.search(x, 'note').length, 0);
  assert.equal(C.search(x, 'notes').length, 1);
  assert.equal(C.search(x, 'NOTES')[0].para, 1, '大小写不敏感');
});

test('search:排除词会剔除段落(中文子串与英文整词)', () => {
  const x = idx();
  const withCoffee = C.search(x, '复习').map(h => h.path);
  assert.ok(withCoffee.includes('项目/coffee.txt'));
  const r = C.search(x, '复习 -咖啡');
  assert.ok(r.length >= 2 && r.every(h => !h.text.includes('咖啡')));
  assert.equal(C.search(x, 'index -paragraphs').length, 0);
  assert.equal(C.search(x, 'index -paragraph').length, 1, '英文排除按整词,paragraph 不等于 paragraphs');
});

test('search:路径前缀筛选(大小写不敏感,仅前缀)', () => {
  const x = idx();
  assert.deepEqual([...new Set(C.search(x, '复习 path:读书/').map(h => h.path))], ['读书/记忆.md']);
  assert.equal(C.search(x, '复习 path:记忆').length, 0, '不是前缀就不匹配');
  assert.ok(C.search(x, 'index path:项目/').length === 1);
  assert.equal(C.search(x, 'INDEX PATH:项目/').length, 1);
});

test('search:单个汉字也能搜到(走全量扫描而不是漏掉)', () => {
  const x = idx();
  const r = C.search(x, '咖');
  assert.ok(r.length >= 2);
  assert.ok(r.every(h => h.text.includes('咖')));
});

test('search:排序按命中密度 + 标题命中,且同分稳定', () => {
  const x = C.buildIndex([
    { path: 'z.md', text: '复习 复习 复习' },
    { path: 'a.md', text: '复习一下,然后写很长的一段别的内容,让命中密度变得很低很低很低很低很低很低很低很低很低很低很低很低' },
    { path: 'b.md', text: '# 复习\n\n短' },
    { path: 'c.md', text: '复习一下,然后写很长的一段别的内容,让命中密度变得很低很低很低很低很低很低很低很低很低很低很低很低' }
  ]);
  const r = C.search(x, '复习');
  assert.equal(r[0].path, 'b.md', '标题命中加分');
  assert.equal(r[0].titleHit, true);
  assert.equal(r[1].path, 'z.md', '密度高者在前');
  assert.deepEqual(r.slice(2).map(h => h.path), ['a.md', 'c.md'], '同分按路径升序');
  assert.deepEqual(C.search(x, '复习').map(h => h.path), r.map(h => h.path), '重复查询顺序一致');
});

test('snippet:前后各 60 字、高亮位置相对窗口、边界处理', () => {
  const text = '甲'.repeat(100) + '关键词' + '乙'.repeat(100);
  const s = C.snippet(text, ['关键词'], 60);
  assert.equal(s.text.length, 60 + 3 + 60);
  assert.deepEqual(s.highlights, [[60, 63]]);
  assert.equal(s.text.slice(60, 63), '关键词');
  assert.ok(s.head && s.tail);
  const edge = C.snippet('关键词在开头,后面不长', ['关键词'], 60);
  assert.equal(edge.head, false);
  assert.equal(edge.tail, false);
  assert.deepEqual(edge.highlights, [[0, 3]]);
  const none = C.snippet('完全没有命中的文字', ['不存在'], 3);
  assert.deepEqual(none.highlights, []);
  assert.equal(none.text.length, 6);
  const multi = C.snippet('abc ABC abc', ['abc'], 20);
  assert.equal(multi.highlights.length, 3, '大小写不敏感,窗口内多处都高亮');
});

test('snippet:不会把代理对从中间切开', () => {
  const emoji = '𠀀'; // 补充平面汉字,2 个 UTF-16 单位
  const text = emoji.repeat(10) + 'X' + emoji.repeat(10);
  const s = C.snippet(text, ['x'], 3);
  assert.ok(!/^[\udc00-\udfff]/.test(s.text) && !/[\ud800-\udbff]$/.test(s.text));
});

test('cooccur:统计同段共现词,排除自身,停用词可配', () => {
  const x = C.buildIndex([
    { path: 'a.md', text: '学习方法与记忆技巧。' },
    { path: 'b.md', text: '学习方法很重要,记忆也重要。' },
    { path: 'c.md', text: '完全无关的段落' }
  ]);
  const top = C.cooccur(x, '学习', 20, []);
  assert.ok(top.length > 0);
  assert.ok(!top.some(t => t.term === '学习'), '不统计关键词自身');
  assert.equal(top.find(t => t.term === '方法').count, 2);
  assert.equal(top.find(t => t.term === '记忆').count, 2);
  assert.ok(!top.some(t => t.term === '无关'));
  const withStop = C.cooccur(x, '学习', 20, ['方法']);
  assert.ok(!withStop.some(t => t.term.includes('方') && t.term === '方法'), '自定义停用词(整词)生效');
  const charStop = C.cooccur(x, '学习', 20, ['记']);
  assert.ok(!charStop.some(t => t.term.includes('记')), '单字停用词会过滤含该字的 bigram');
  assert.equal(C.cooccur(x, '学习', 2, []).length, 2, 'n 限制条数');
  assert.deepEqual(C.cooccur(x, '', 20, []), []);
});

test('cooccur:默认停用词过滤英文虚词', () => {
  const x = C.buildIndex([{ path: 'a.md', text: 'the index is a map of words' }, { path: 'b.md', text: 'the index and the map' }]);
  const r = C.cooccur(x, 'index');
  assert.ok(!r.some(t => t.term === 'the' || t.term === 'is'));
  assert.equal(r.find(t => t.term === 'map').count, 2);
});

test('recentFiles:按修改时间倒序,缺失时间的不列出', () => {
  const x = C.buildIndex(DOCS.concat([{ path: 'no-mtime.md', text: 'x' }]));
  const r = C.recentFiles(x, 3);
  assert.deepEqual(r.map(f => f.path), ['读书/记忆.md', '项目/search.md', '项目/coffee.txt']);
  assert.ok(!C.recentFiles(x, 20).some(f => f.path === 'no-mtime.md'));
});

test('toCsv:公式防护、引号转义、单独的 - 不加前缀', () => {
  const stats = { files: [
    { path: '=HYPERLINK("http://x")', paras: 2, chars: 30, mtime: Date.UTC(2026, 9, 1) },
    { path: '+cmd', paras: 1, chars: 5, mtime: null },
    { path: '@sum', paras: 1, chars: 5, mtime: 0 },
    { path: '-1+1', paras: 0, chars: 0, mtime: null },
    { path: '-', paras: 0, chars: 0, mtime: null },
    { path: '带,逗号"和引号.md', paras: 1, chars: 1, mtime: null }
  ] };
  const lines = C.toCsv(stats).split('\r\n');
  assert.equal(lines[0], '"路径","段落数","字数","最近修改"');
  assert.equal(lines[1], '"\'=HYPERLINK(""http://x"")",2,30,"2026-10-01T00:00:00.000Z"');
  assert.ok(lines[2].startsWith('"\'+cmd"'));
  assert.ok(lines[3].startsWith('"\'@sum"'));
  assert.ok(lines[4].startsWith('"\'-1+1"'));
  assert.ok(lines[5].startsWith('"-",'), '单独的 - 不是公式');
  assert.ok(lines[6].startsWith('"带,逗号""和引号.md"'));
  assert.equal(C.guardCell('\t=1'), "'\t=1");
  assert.equal(C.guardCell('+'), '+');
});

test('toMarkdown:带路径与段落号,高亮加粗,多行引用不丢前缀', () => {
  const x = idx();
  const r = C.search(x, '间隔重复');
  const md = C.toMarkdown(r, { query: '间隔重复', date: '2026-10-20', source: '测试' });
  assert.match(md, /^# 搜索结果/);
  assert.match(md, /- 查询:`间隔重复`/);
  assert.match(md, /## `读书\/记忆\.md` · 第 2 段/);
  assert.match(md, /> \*\*间隔重复\*\*是对抗遗忘的方法。/);
  assert.match(md, new RegExp('命中段落:' + r.length));
  const multi = C.toMarkdown([{ path: 'a`b.md', para: 1, text: '第一行\n第二行', snippet: null }]);
  assert.match(multi, /## ``a`b\.md`` · 第 1 段/);
  assert.match(multi, /> 第一行\n> 第二行/);
});

test('isNoteFile / normalizeExts:默认三种后缀,可追加,非法后缀被报告', () => {
  assert.ok(C.isNoteFile('a.MD') && C.isNoteFile('b.txt') && C.isNoteFile('c.markdown'));
  assert.ok(!C.isNoteFile('d.png') && !C.isNoteFile('md') && !C.isNoteFile('.md') && !C.isNoteFile('e.'));
  const { exts, invalid } = C.normalizeExts('.org, rst  md ../x');
  assert.deepEqual(exts, ['org', 'rst']);
  assert.deepEqual(invalid, ['../x']);
  assert.ok(C.isNoteFile('f.org', exts));
});

test('validateIndex:缓存读取与写入共用,损坏/不一致会被拒绝', () => {
  const good = idx();
  assert.equal(C.validateIndex(good).ok, true);
  const empty = C.buildIndex([{ path: '空.md', text: '' }]);
  assert.equal(C.validateIndex(empty).ok, true, '空文件(0 段)是合法边界');
  assert.equal(C.validateIndex(C.buildIndex([])).ok, true);
  const big = C.buildIndex([{ path: 'big.md', text: '长'.repeat(300000) }]);
  assert.equal(C.validateIndex(big).ok, true, '超长单段合法');
  const m1 = idx(); m1.postings = {};
  assert.equal(C.validateIndex(m1).ok, false);
  const m2 = idx(); m2.docs[1].id = 7;
  assert.equal(C.validateIndex(m2).ok, false);
  const m3 = idx(); m3.postings.set('坏', [999999999999]);
  m3.stats.termCount += 1;
  assert.equal(C.validateIndex(m3).ok, false);
  const m4 = idx(); m4.stats.paraCount += 1;
  assert.equal(C.validateIndex(m4).ok, false);
  const m5 = idx(); m5.version = 2;
  assert.equal(C.validateIndex(m5).ok, false);
  assert.equal(C.validateIndex(null).ok, false);
});

test('设置:停用词解析去重,校验拒绝非法值', () => {
  assert.deepEqual(C.parseStopwords('的, 了\n的 the、a'), ['的', '了', 'the', 'a']);
  assert.equal(C.validateSettings({ version: 1, stopwords: ['的'] }).ok, true);
  assert.equal(C.validateSettings({ version: 1, stopwords: [] }).ok, true);
  assert.equal(C.validateSettings({ version: 1, stopwords: [1] }).ok, false);
  assert.equal(C.validateSettings({ version: 1, stopwords: [''] }).ok, false);
  assert.equal(C.validateSettings({ version: 2, stopwords: [] }).ok, false);
  assert.equal(C.validateSettings([]).ok, false);
  const many = Array.from({ length: 5000 }, (_, i) => '词' + i);
  assert.equal(C.validateSettings({ version: 1, stopwords: C.parseStopwords(many.join(' ')) }).ok, true, '大量停用词写入与读取校验一致');
});

test('parseToday:合法日期通过,非法/进位日期回退真实今天', () => {
  const now = new Date(2026, 9, 19);
  assert.equal(C.parseToday('?today=2026-10-20', now), '2026-10-20');
  assert.equal(C.parseToday('?today=2026-02-30', now), '2026-10-19', '2 月 30 日不得进位成 3 月 2 日');
  assert.equal(C.parseToday('?today=2026-13-01', now), '2026-10-19');
  assert.equal(C.parseToday('?today=abc', now), '2026-10-19');
  assert.equal(C.parseToday('', now), '2026-10-19');
  assert.equal(C.parseToday('?today=2024-02-29', now), '2024-02-29', '闰日合法');
  assert.equal(C.parseToday('?today=2025-02-29', now), '2026-10-19');
});

test('原型键:路径或词为 __proto__ / constructor 时不污染也不崩溃', () => {
  const x = C.buildIndex([{ path: '__proto__/constructor.md', text: '__proto__ constructor toString hasOwnProperty' }]);
  assert.equal(C.validateIndex(x).ok, true);
  assert.equal(C.search(x, 'constructor').length, 1);
  assert.equal(C.search(x, 'tostring').length, 1);
  assert.equal(C.search(x, '__proto__ constructor').length, 1);
  assert.equal(C.search(x, 'path:__proto__/ constructor').length, 1);
  assert.ok(C.cooccur(x, 'constructor', 5, []).map(t => t.term).includes('proto'));
  assert.ok(x.postings.has('constructor') && x.postings.has('hasownproperty'));
  assert.equal(({}).polluted, undefined);
});

test('search:排除短语按连续文本匹配,非连续的词不会被排除', () => {
  const x = C.buildIndex([
    { path: 'a.md', text: 'keep foo something bar' },
    { path: 'b.md', text: 'keep foo bar here' },
    { path: 'c.md', text: 'keep alone' }
  ]);
  assert.deepEqual(C.parseQuery('keep -"foo bar"').notPhrases, ['foo bar']);
  assert.deepEqual(C.search(x, 'keep -"foo bar"').map(h => h.path), ['a.md', 'c.md']);
  assert.deepEqual(C.search(x, 'keep -foo -bar').map(h => h.path), ['c.md'], '普通排除词仍按词判断');
});

test('第五轮:排序口径 = 命中次数 ÷ max(段落字数,40) × 100,标题或文件名命中加 TITLE_BONUS(界面说明依据此式)', () => {
  assert.equal(C.TITLE_BONUS, 5);
  const x = C.buildIndex([{ path: 'a/无关.md', text: '# 无关\n\n复习复习复习复习复习复习复习复习复习复习复习复习复习复习复习复习复习复习复习复习', mtime: 1 }], {});
  const r = C.search(x, '复习')[0];
  const len = Array.from(r.text).length;
  assert.equal(r.titleHit, false);
  assert.ok(Math.abs(r.score - (r.hits / Math.max(len, 40)) * 100) < 1e-9, '无标题命中时 score 就是密度');
  const y = C.buildIndex([{ path: 'a/复习.md', text: '# 复习\n\n复习一下', mtime: 1 }], {});
  const s = C.search(y, '复习')[0];
  assert.equal(s.titleHit, true);
  assert.ok(Math.abs(s.score - ((s.hits / Math.max(Array.from(s.text).length, 40)) * 100 + 5)) < 1e-9, '标题命中加 5');
});

test('第五轮:共现词计数 = 与关键词同时出现的段落数,同一段重复只计一次', () => {
  const x = C.buildIndex([{ path: 'a.md', text: '复习 alpha alpha alpha\n\n复习 alpha\n\n复习 beta', mtime: 1 }], {});
  const co = C.cooccur(x, '复习', 20, []);
  assert.equal(co.find((i) => i.term === 'alpha').count, 2);
  assert.equal(co.find((i) => i.term === 'beta').count, 1);
});

test('findProblemNotes:空白笔记与含无法识别字符(多半不是 UTF-8)的笔记分开列出', () => {
  const docs = [
    { path: 'ok.md', text: '# 正常\n内容' },
    { path: 'empty.md', text: '' },
    { path: 'blank.txt', text: '  \n\t\n' },
    { path: 'gbk.md', text: '\uFFFD\uFFFD笔记' },
  ];
  const p = C.findProblemNotes(docs);
  assert.deepEqual(p.empty, ['empty.md', 'blank.txt']);
  assert.deepEqual(p.encoding, ['gbk.md']);
  assert.deepEqual(C.findProblemNotes([{ path: 'a.md', text: '正文' }]), { empty: [], encoding: [] });
  assert.deepEqual(C.findProblemNotes(null), { empty: [], encoding: [] });
});

test('describeProblemNotes:有问题才给提示,文件名过多时截断并给总数', () => {
  assert.equal(C.describeProblemNotes({ empty: [], encoding: [] }), '');
  const msg = C.describeProblemNotes({ empty: ['a.md', 'b.md'], encoding: ['gbk.md'] });
  assert.match(msg, /2 个笔记是空的/);
  assert.match(msg, /a\.md、b\.md/);
  assert.match(msg, /1 个笔记含无法识别的字符/);
  assert.match(msg, /UTF-8/);
  const many = C.describeProblemNotes({ empty: Array.from({ length: 8 }, (_, i) => `n${i}.md`), encoding: [] }, 3);
  assert.match(many, /n0\.md、n1\.md、n2\.md 等 8 个/);
  assert.doesNotMatch(many, /n3\.md/);
});
