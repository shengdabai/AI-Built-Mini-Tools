'use strict';
const test = require('node:test');
const assert = require('node:assert');
require('../../_data/hsk-words.js');
require('../../_data/pinyin-map.js');
require('../../_shared/cn-segment.js');
const core = require('../core.js');
const D = globalThis.HSK_WORDS, M = globalThis.PINYIN_MAP;
const texts = card => card.cells.map(c => c.t);
const pipes = line => (line.match(/(?<!\\)\|/g) || []).length;

test('分词:词典词带词典拼音,词典外字回退字表拼音', () => {
  const c = core.buildCard('我叫大卫', D, M, {});
  assert.deepStrictEqual(texts(c), ['我', '叫', '大', '卫']);
  assert.strictEqual(c.cells[1].pinyin, 'jiào');
  assert.strictEqual(c.cells[3].kind, 'char');
  assert.strictEqual(c.cells[3].pinyin, 'wèi');
  const d = core.buildCard('今天', D, M, {});
  assert.deepStrictEqual(texts(d), ['今天']);
  assert.strictEqual(d.cells[0].pinyin, 'jīntiān');
});

test('标点保留为无拼音无 gloss 的格子,纯空白被丢弃', () => {
  const c = core.buildCard('我 去。', D, M, { '。': { gloss: 'x', count: 1 } });
  assert.deepStrictEqual(texts(c), ['我', '去', '。']);
  const p = c.cells[2];
  assert.strictEqual(p.kind, 'other');
  assert.strictEqual(p.pinyin, '');
  assert.strictEqual(p.gloss, '');
  assert.strictEqual(p.fromGlossary, false);
});

test('词典预填并标 fromGlossary,未命中的格子为空', () => {
  const g = { '今天': { gloss: 'today', count: 2 } };
  const c = core.buildCard('我今天去', D, M, g);
  const jt = c.cells.find(x => x.t === '今天');
  assert.strictEqual(jt.gloss, 'today');
  assert.strictEqual(jt.fromGlossary, true);
  const wo = c.cells.find(x => x.t === '我');
  assert.strictEqual(wo.gloss, '');
  assert.strictEqual(wo.fromGlossary, false);
});

test('learn:次数累加、覆盖 gloss、不改入参', () => {
  const g0 = {};
  const g1 = core.learn(g0, '书', 'book');
  const g2 = core.learn(g1, '书', ' books ');
  assert.deepStrictEqual(g0, {});
  assert.deepStrictEqual(g1['书'], { gloss: 'book', count: 1 });
  assert.deepStrictEqual(g2['书'], { gloss: 'books', count: 2 });
});

test('learn:空 gloss、空白 gloss、空词、__proto__ 都不记', () => {
  const g = { 书: { gloss: 'book', count: 1 } };
  assert.deepStrictEqual(core.learn(g, '书', ''), g);
  assert.deepStrictEqual(core.learn(g, '书', '   '), g);
  assert.deepStrictEqual(core.learn(g, '', 'x'), g);
  const r = core.learn(g, '__proto__', 'x');
  assert.deepStrictEqual(Object.keys(r), ['书']);
});

test('合并:拼音按词典恢复,gloss 清空,fromGlossary 为假', () => {
  let c = core.buildCard('今天', D, M, {});
  c = core.splitCell(c, 0, M);
  assert.deepStrictEqual(texts(c), ['今', '天']);
  c.cells[0].gloss = 'now'; c.cells[0].fromGlossary = true;
  const m = core.mergeCells(c, 0, D, M);
  assert.deepStrictEqual(texts(m), ['今天']);
  assert.strictEqual(m.cells[0].pinyin, 'jīntiān');
  assert.strictEqual(m.cells[0].kind, 'word');
  assert.strictEqual(m.cells[0].gloss, '');
  assert.strictEqual(m.cells[0].fromGlossary, false);
});

test('合并:词典外组合按字拼音拼接;越界和标点不动', () => {
  const c = core.buildCard('我叫大卫。', D, M, {});
  const m = core.mergeCells(c, 2, D, M);
  assert.strictEqual(m.cells[2].t, '大卫');
  assert.strictEqual(m.cells[2].pinyin, 'dàwèi');
  assert.deepStrictEqual(texts(core.mergeCells(c, 99, D, M)), texts(c));
  assert.deepStrictEqual(texts(core.mergeCells(c, 3, D, M)), texts(c)); // 卫 + 。
  assert.deepStrictEqual(texts(core.mergeCells(c, -1, D, M)), texts(c));
});

test('拆分:拼音逐字,gloss 清空;单字与标点不动;不改入参', () => {
  const c = core.buildCard('今天。', D, M, { 今天: { gloss: 'today', count: 1 } });
  assert.strictEqual(c.cells[0].gloss, 'today');
  const s = core.splitCell(c, 0, M);
  assert.deepStrictEqual(texts(s), ['今', '天', '。']);
  assert.deepStrictEqual(s.cells.slice(0, 2).map(x => x.pinyin), ['jīn', 'tiān']);
  assert.ok(s.cells.slice(0, 2).every(x => x.gloss === '' && !x.fromGlossary));
  assert.strictEqual(c.cells[0].t, '今天');
  assert.deepStrictEqual(texts(core.splitCell(s, 0, M)), texts(s));
  assert.deepStrictEqual(texts(core.splitCell(s, 2, M)), texts(s));
});

test('多行输入每行一卡,忽略空行与首尾空白,非字符串返回空', () => {
  assert.deepStrictEqual(core.parseSentences('我去\n\n  你好  \r\n   \n他来'), ['我去', '你好', '他来']);
  assert.deepStrictEqual(core.parseSentences(null), []);
  assert.deepStrictEqual(core.parseSentences('  \n '), []);
});

test('Markdown:每张卡四行,列数 = 格子数 + 1,竖线被转义', () => {
  const c = core.buildCard('我今天去', D, M, { 我: { gloss: 'I|me', count: 1 } });
  c.english = 'I go today';
  const md = core.toMarkdown([c]);
  const rows = md.split('\n').filter(l => l.startsWith('|'));
  assert.strictEqual(rows.length, 5); // Chinese / 分隔 / Pinyin / Word-by-Word / English
  for (const r of rows) assert.strictEqual(pipes(r), c.cells.length + 2, r);
  assert.ok(md.includes('I\\|me'));
  assert.ok(rows[0].startsWith('| Chinese | 我 | 今天 | 去 |'));
  assert.ok(rows[4].startsWith('| English | I go today |'));
  assert.strictEqual(core.toMarkdown([]), '');
});

test('toText:每卡四行,制表符分隔,卡间空行,内容里的制表符被压平', () => {
  const a = core.buildCard('我去', D, M, {});
  a.cells[0].gloss = 'I\tme';
  a.english = 'I go';
  const b = core.buildCard('他来', D, M, {});
  const lines = core.toText([a, b]).split('\n');
  assert.strictEqual(lines.length, 9);
  assert.strictEqual(lines[0], 'Chinese\t我\t去');
  assert.strictEqual(lines[1], 'Pinyin\twǒ\tqù');
  assert.strictEqual(lines[2], 'Word-by-Word\tI me\t');
  assert.strictEqual(lines[3], 'English\tI go');
  assert.strictEqual(lines[4], '');
  assert.strictEqual(lines[5], 'Chinese\t他\t来');
});

test('validateGlossary:拒绝非对象、坏 JSON、缺 gloss、坏 count;接受合法并补默认次数', () => {
  for (const bad of [null, [], 42, 'abc', '[1]', '{"书":"book"}', '{"书":{"gloss":""}}', '{"书":{"gloss":"b","count":-1}}', '{"书":{"gloss":"b","count":1.5}}', '{"__proto__":{"gloss":"x"}}']) {
    assert.strictEqual(core.validateGlossary(bad).ok, false, JSON.stringify(bad));
  }
  const ok = core.validateGlossary('{"书":{"gloss":" book "},"去":{"gloss":"go","count":3}}');
  assert.strictEqual(ok.ok, true);
  assert.deepStrictEqual(ok.glossary, { 书: { gloss: 'book', count: 1 }, 去: { gloss: 'go', count: 3 } });
});

test('词典辅助:editGloss 保留次数,removeWord 删除,glossaryList 按次数降序', () => {
  let g = core.learn(core.learn(core.learn({}, '书', 'book'), '去', 'go'), '去', 'go');
  g = core.editGloss(g, '书', 'a book');
  assert.deepStrictEqual(g['书'], { gloss: 'a book', count: 1 });
  assert.deepStrictEqual(core.editGloss(g, '书', ' '), g);
  assert.deepStrictEqual(core.editGloss(g, '无', 'x'), g);
  assert.deepStrictEqual(core.glossaryList(g).map(x => x.word), ['去', '书']);
  assert.deepStrictEqual(Object.keys(core.removeWord(g, '去')), ['书']);
});

test('公式注入:TSV 与 Markdown 对 = + - @ 开头的字段加单引号,单个符号与普通文本不动', () => {
  const c = core.buildCard('我去', D, M, {});
  c.cells[0].gloss = '=1+1';
  c.cells[1].gloss = ' -2+3';
  c.cells[1].pinyin = '+cmd';
  c.english = '@SUM(A1)';
  const tsv = core.toText([c]).split('\n');
  assert.strictEqual(tsv[2], "Word-by-Word\t'=1+1\t' -2+3");
  assert.strictEqual(tsv[1], "Pinyin\twǒ\t'+cmd");
  assert.strictEqual(tsv[3], "English\t'@SUM(A1)");
  const md = core.toMarkdown([c]);
  assert.ok(md.includes("| '=1+1 |") && md.includes("'@SUM(A1)"));
  assert.strictEqual(core.safeField('-'), '-');
  assert.strictEqual(core.safeField('+'), '+');
  assert.strictEqual(core.safeField('a=b'), 'a=b');
  assert.strictEqual(core.safeField('\t=cmd'), "' =cmd");
  const p = core.buildCard('你-', D, M, {}); // 单个 - 标点格不被改
  assert.ok(core.toText([p]).split('\n')[0].endsWith('\t-'));
});

test('wrapText:普通英文按词换行;超长单词/URL 按字符拆分,每行都不超宽', () => {
  const m = s => s.length * 10; // 每字符 10
  assert.deepStrictEqual(core.wrapText('aa bb cc', 50, m), ['aa bb', 'cc']);
  assert.deepStrictEqual(core.wrapText('', 50, m), ['']);
  const url = 'https://example.com/' + 'a'.repeat(60);
  const lines = core.wrapText('see ' + url, 100, m);
  assert.ok(lines.length >= 8, String(lines.length));
  assert.ok(lines.every(l => m(l) <= 100), JSON.stringify(lines));
  assert.strictEqual(lines.join('').replace(/\s/g, ''), 'see' + url);
  assert.deepStrictEqual(core.wrapText('x', 5, m), ['x']); // 单字符本身超宽也不死循环
});

test('sanitizeCards:跳过 null 词块、非字符串 t、缺 cells 的卡,补默认字段', () => {
  const good = { sentence: '我去', english: 'I go', cells: [{ t: '我', kind: 'word', pinyin: 'wǒ', gloss: 'I', fromGlossary: true, level: 1 }, { t: '去' }] };
  const r = core.sanitizeCards([
    { sentence: 'a', cells: [null] }, { sentence: 'b', cells: [{ t: 5 }] }, { sentence: 'c' }, null, 'x',
    { sentence: 'd', cells: [] }, good
  ]);
  assert.strictEqual(r.skipped, 6);
  assert.strictEqual(r.cards.length, 1);
  assert.deepStrictEqual(r.cards[0].cells[1], { t: '去', kind: 'char', pinyin: '', gloss: '', fromGlossary: false });
  assert.strictEqual(r.cards[0].cells[0].level, 1);
  assert.deepStrictEqual(core.sanitizeCards(null), { cards: [], skipped: 0 });
  assert.strictEqual(core.sanitizeCards({}).skipped, 1);
});

test('[第五轮] 合成示例标记写进 Markdown 与纯文本导出,普通导出不带', () => {
  const card = { sentence: '我去', english: 'I go', cells: [{ t: '我', kind: 'word', pinyin: 'wǒ', gloss: 'I', fromGlossary: false }] };
  assert.match(core.toMarkdown([card], { sample: true }), /^> 合成示例/);
  assert.doesNotMatch(core.toMarkdown([card]), /合成示例/);
  assert.match(core.toText([card], { sample: true }).split('\n')[0], /^合成示例/);
  assert.equal(core.toText([card]).split('\n')[0].split('\t')[0], 'Chinese');
});

test('[第五轮] previewGlossaryMerge:区分新增、同词覆盖、保留的现有词条', () => {
  const cur = { 我: { gloss: 'I', count: 2 }, 去: { gloss: 'go', count: 1 } };
  const inc = { 我: { gloss: 'me', count: 1 }, 书: { gloss: 'book', count: 1 }, 去: { gloss: 'go', count: 5 } };
  const r = core.previewGlossaryMerge(cur, inc);
  assert.deepEqual(r, { added: 1, overwritten: 1, same: 1, kept: 0, total: 3 });
  assert.deepEqual(core.previewGlossaryMerge({ 我: { gloss: 'I', count: 1 }, 你: { gloss: 'you', count: 1 } }, { 书: { gloss: 'book', count: 1 } }), { added: 1, overwritten: 0, same: 0, kept: 2, total: 3 });
  assert.deepEqual(core.previewGlossaryMerge(null, null), { added: 0, overwritten: 0, same: 0, kept: 0, total: 0 });
});

test('[第五轮] 示例对词典的影响:已有词条优先,只补充没有的', () => {
  const r = core.previewGlossaryMerge({ 我: { gloss: 'mine', count: 9 } }, { 我: { gloss: 'I', count: 3 }, 书: { gloss: 'book', count: 1 } }, { existingWins: true });
  assert.deepEqual(r, { added: 1, overwritten: 0, same: 0, kept: 1, total: 2 });
});

test('[第五轮] editGloss 不改使用次数(词典页改释义不计次数)', () => {
  const g = core.learn({}, '书', 'book');
  const g2 = core.editGloss(g, '书', 'books');
  assert.equal(g2['书'].count, 1);
  const g3 = core.learn(g2, '书', 'volume');
  assert.equal(g3['书'].count, 2, '在卡片里重新填写才 +1');
});
