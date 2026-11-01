const test = require('node:test');
const assert = require('node:assert');
const seg = require('../cn-segment.js');
const dict = { '我': { l: 1, p: 'wǒ' }, '我们': { l: 1, p: 'wǒmen' }, '学习': { l: 1, p: 'xuéxí' }, '中文': { l: 1, p: 'zhōngwén' }, '中': { l: 1, p: 'zhōng' }, '文': { l: 2, p: 'wén' }, '不客气': { l: 1, p: 'bú kèqi' } };
const cmap = { '我': 'wǒ', '们': 'men', '学': 'xué', '习': 'xí', '中': 'zhōng', '文': 'wén', '龘': 'dá', '很': 'hěn' };

test('最长匹配优先：我们 而不是 我+们', () => {
  const r = seg.segment('我们学习中文', dict, cmap);
  assert.deepStrictEqual(r.map(x => x.t), ['我们', '学习', '中文']);
  assert.strictEqual(r[0].kind, 'word');
  assert.strictEqual(r[0].level, 1);
  assert.strictEqual(r[0].pinyin, 'wǒmen');
});
test('词典外汉字单字回退并用字表拼音', () => {
  const r = seg.segment('很龘', dict, cmap);
  assert.deepStrictEqual(r.map(x => [x.t, x.kind]), [['很', 'char'], ['龘', 'char']]);
  assert.strictEqual(r[1].pinyin, 'dá');
});
test('标点、数字、英文合并为 other 且不带 level', () => {
  const r = seg.segment('我，2024 OK！', dict, cmap);
  assert.deepStrictEqual(r.map(x => x.kind), ['word', 'other']);
  assert.strictEqual(r[1].t, '，2024 OK！');
  assert.strictEqual(r[1].level, undefined);
});
test('三字词命中且保留带空格的词典拼音', () => {
  const r = seg.segment('不客气', dict, cmap);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].pinyin, 'bú kèqi');
});
test('空字符串与非字符串输入返回空数组', () => {
  assert.deepStrictEqual(seg.segment('', dict, cmap), []);
  assert.deepStrictEqual(seg.segment(null, dict, cmap), []);
});
test('无字表时拼音为空串而不是抛错', () => {
  const r = seg.segment('龘', dict);
  assert.strictEqual(r[0].pinyin, '');
});
test('split 把词拆成单字并补拼音', () => {
  const r = seg.split({ t: '我们', kind: 'word' }, cmap);
  assert.deepStrictEqual(r.map(x => [x.t, x.pinyin]), [['我', 'wǒ'], ['们', 'men']]);
});
test('merge 相邻 token，词典命中时恢复 level', () => {
  const a = { t: '中', kind: 'word' }, b = { t: '文', kind: 'word' };
  const m = seg.merge([a, b], dict, cmap);
  assert.strictEqual(m.kind, 'word');
  assert.strictEqual(m.level, 1);
  assert.strictEqual(m.pinyin, 'zhōngwén');
});
test('merge 词典未命中时按字表拼音拼接', () => {
  const m = seg.merge([{ t: '很', kind: 'char' }, { t: '龘', kind: 'char' }], dict, cmap);
  assert.strictEqual(m.kind, 'char');
  assert.strictEqual(m.pinyin, 'hěndá');
});
test('在真实 HSK 词表上分词并给出级别', () => {
  const { HSK_WORDS } = require('../../_data/hsk-words.js');
  const { PINYIN_MAP } = require('../../_data/pinyin-map.js');
  const r = seg.segment('我们今天学习汉语。', HSK_WORDS, PINYIN_MAP);
  const words = r.filter(x => x.kind === 'word');
  assert.ok(words.length >= 4, '应至少命中 4 个词');
  assert.ok(words.every(x => x.level >= 1 && x.level <= 7));
  assert.ok(words.every(x => x.pinyin && x.pinyin.length > 0));
});
