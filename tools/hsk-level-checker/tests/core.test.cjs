'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../_data/hsk-words.js');
require('../../_data/pinyin-map.js');
require('../../_shared/cn-segment.js');
const core = require('../core.js');
const D = globalThis.HSK_WORDS;
const M = globalThis.PINYIN_MAP;
const run = (t, lv) => core.analyze(t, lv, D, M);

test('最长匹配:学生 不被拆成单字,活动 整词识别', () => {
  const r = run('学生活动', 3);
  const words = r.tokens.map((t) => t.t);
  assert.deepEqual(words, ['学生', '活动']);
});

test('目标级别边界:level 等于目标不算超纲,高一级才算', () => {
  // 周末=3 公园=3 效率=5
  const r = run('周末去公园提高效率', 3);
  assert.equal(r.overLevel.length, 1);
  assert.equal(r.overLevel[0].word, '效率');
  assert.equal(r.overLevel[0].level, 5);
  const r5 = run('周末去公园提高效率', 5);
  assert.equal(r5.stats.overCount, 0);
  const r4 = run('效率', 4);
  assert.equal(r4.tokens[0].over, 1);
  assert.equal(r4.tokens[0].tier, 'over1');
});

test('目标 7(7–9 级)没有超纲词,连 7 级词也算目标内', () => {
  const r = run('贯彻日程安排', 7);
  assert.equal(r.stats.overCount, 0);
  assert.deepEqual(r.overLevel, []);
  assert.ok(r.tokens.some((t) => t.level === 7));
});

test('高出级别分档:+1 +2 +3 以上', () => {
  // 我=1,效率=5,氛围=6
  const r = run('我效率氛围', 3);
  const byWord = Object.fromEntries(r.tokens.map((t) => [t.t, t.tier]));
  assert.equal(byWord['我'], 'in');
  assert.equal(byWord['效率'], 'over2');
  assert.equal(byWord['氛围'], 'over3');
  const r1 = run('氛围', 1);
  assert.equal(r1.tokens[0].tier, 'over3');
});

test('词表外汉字进 outOfList,相邻汉字合并成串并聚合次数', () => {
  const r = run('龘龘好，龘龘好', 3);
  assert.equal(r.outOfList.length, 1);
  assert.equal(r.outOfList[0].text, '龘龘');
  assert.equal(r.outOfList[0].count, 2);
  assert.equal(r.stats.outOfListCount, 2);
  assert.equal(r.tokens.filter((t) => t.tier === 'out').length, 4);
});

test('词表外串被标点隔开时不合并', () => {
  const r = run('龘，龘', 3);
  assert.equal(r.outOfList.length, 1);
  assert.equal(r.outOfList[0].text, '龘');
  assert.equal(r.outOfList[0].count, 2);
});

test('超纲词计数与排序:级别降序,同级按次数降序', () => {
  // 氛围=6 ×1;效率=5 ×3;缓解=5 ×1
  const r = run('效率，缓解，效率，氛围，效率', 3);
  assert.deepEqual(
    r.overLevel.map((x) => [x.word, x.level, x.count]),
    [['氛围', 6, 1], ['效率', 5, 3], ['缓解', 5, 1]]
  );
  assert.equal(r.stats.overCount, 5);
  assert.equal(r.stats.overDistinct, 3);
  assert.ok(r.overLevel[1].pinyin.length > 0);
});

test('目标级内占比 = 目标内词 / 总词数', () => {
  const r = run('我喜欢效率', 3); // 我 喜欢 效率 -> 2/3
  assert.equal(r.stats.wordCount, 3);
  assert.equal(r.stats.inLevelCount, 2);
  assert.ok(Math.abs(r.stats.inLevelRatio - 2 / 3) < 1e-9);
});

test('句子切分:中英文标点、换行、无结尾标点的尾句', () => {
  assert.deepEqual(core.splitSentences('你好。你好吗？很好！好；再见'), ['你好。', '你好吗？', '很好！', '好；', '再见']);
  assert.deepEqual(core.splitSentences('Hi! OK? yes;no'), ['Hi!', 'OK?', 'yes;', 'no']);
  assert.deepEqual(core.splitSentences('第一行\n第二行。'), ['第一行', '第二行。']);
  assert.deepEqual(core.splitSentences('。。！ \n'), []);
});

test('平均句长 = 汉字数 / 句数,保留一位小数', () => {
  const r = run('我喜欢。你好吗？', 3); // 汉字 3+... 我喜欢=3, 你好吗=3
  assert.equal(r.stats.charCount, 6);
  assert.equal(r.stats.sentenceCount, 2);
  assert.equal(r.stats.avgSentenceLen, 3);
  const r2 = run('我喜欢你。你好', 3); // 4 + 2 = 6 chars, 2 sentences
  assert.equal(r2.stats.avgSentenceLen, 3);
  const r3 = run('我喜欢。好。好', 3); // 5 chars / 3 = 1.7
  assert.equal(r3.stats.avgSentenceLen, 1.7);
});

test('空输入、非字符串、纯英文数字:不抛错且统计为 0', () => {
  for (const x of ['', '   ', null, undefined, 42]) {
    const r = run(x, 3);
    assert.equal(r.stats.charCount, 0);
    assert.equal(r.stats.wordCount, 0);
    assert.equal(r.stats.inLevelRatio, 0);
    assert.equal(r.stats.avgSentenceLen, 0);
    assert.deepEqual(r.overLevel, []);
  }
  const en = run('Hello world 123.', 3);
  assert.equal(en.stats.charCount, 0);
  assert.equal(en.stats.wordCount, 0);
  assert.equal(en.stats.overCount, 0);
  assert.equal(en.stats.sentenceCount, 1);
});

test('非法目标级别回退到 HSK 3', () => {
  assert.equal(run('我', 99).stats.target, 3);
  assert.equal(run('我', 'abc').stats.target, 3);
  assert.equal(run('我', '7').stats.target, 7);
});

test('compare:差值方向是「后 - 前」,变好时 overBetter/ratioBetter 为真', () => {
  const before = run('效率氛围缓解我', 3);
  const after = run('我喜欢我', 3);
  const c = core.compare(before, after);
  assert.equal(c.overBefore, 3);
  assert.equal(c.overAfter, 0);
  assert.equal(c.overDelta, -3);
  assert.ok(c.ratioDelta > 0);
  assert.equal(c.overBetter, true);
  assert.equal(c.ratioBetter, true);
  const worse = core.compare(after, before);
  assert.equal(worse.overDelta, 3);
  assert.equal(worse.overBetter, false);
  const same = core.compare(before, before);
  assert.equal(same.overDelta, 0);
  assert.equal(same.overBetter, false);
  assert.equal(same.ratioBetter, false);
});

test('toCsv:表头、逗号与引号转义、CRLF', () => {
  const csv = core.toCsv([
    { word: '效率', level: 5, pinyin: 'xiàolǜ', count: 2 },
    { word: 'a,b', level: 6, pinyin: 'say "hi"', count: 1 },
  ]);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], '词,级别,拼音,出现次数');
  assert.equal(lines[1], '效率,HSK 5,xiàolǜ,2');
  assert.equal(lines[2], '"a,b",HSK 6,"say ""hi""",1');
  assert.equal(core.toCsv([]), '词,级别,拼音,出现次数\r\n');
});

test('toMarkdown:含两版统计、对比、超纲词表(竖线转义)与改写后全文', () => {
  const before = run('效率氛围我', 3);
  const after = run('我喜欢', 3);
  const md = core.toMarkdown({ target: 3, before, after, rewriteText: '我喜欢', date: '2026-10-20' });
  assert.match(md, /^# HSK 分级改写检查报告/);
  assert.match(md, /目标级别:HSK 3/);
  assert.match(md, /### 改写前/);
  assert.match(md, /### 改写后/);
  assert.match(md, /超纲词数:2 → 0\(-2\)/);
  assert.match(md, /没有超纲词。/);
  assert.match(md, /## 改写后全文\s+我喜欢/);
  const onlyBefore = core.toMarkdown({ target: 3, before, rewriteText: 'x' });
  assert.match(onlyBefore, /\| 效率 \| HSK 5 \|/);
  const pipe = core.toMarkdown({ target: 3, before: { stats: before.stats, overLevel: [{ word: 'a|b', level: 5, pinyin: 'p', count: 1 }], outOfList: [] } });
  assert.match(pipe, /a\\\|b/);
});

test('levelLabel 与 pct', () => {
  assert.equal(core.levelLabel(7), 'HSK 7–9');
  assert.equal(core.levelLabel(4), 'HSK 4');
  assert.equal(core.pct(0.6667), '66.7%');
  assert.equal(core.pct(0), '0.0%');
});

test('isStale:改写文被改后未重新检查视为过期(防止旧统计拼新全文)', () => {
  const base = { srcNow: 'a', srcChecked: 'a', rewNow: 'b', rewChecked: 'b', hasAfter: true };
  assert.equal(core.isStale(base), false);
  assert.equal(core.isStale({ ...base, rewNow: 'b2' }), true);
  assert.equal(core.isStale({ ...base, srcNow: 'a2' }), true);
  // 首次检查后还没有改写结果时,改写文变化同样算过期(不能导出未重查的改写文)
  assert.equal(core.isStale({ ...base, hasAfter: false, rewNow: 'zzz' }), true);
  assert.equal(core.isStale({ ...base, hasAfter: false }), false);
  assert.equal(core.isStale({}), false);
  assert.equal(core.isStale(), false);
});

test('parseToday:合法日期生效,非法/进位日期回退并标记未固定', () => {
  assert.deepEqual(core.parseToday('?today=2026-10-20', '2026-01-01'), { date: '2026-10-20', fixed: true });
  assert.deepEqual(core.parseToday('?today=2026-02-30', '2026-01-01'), { date: '2026-01-01', fixed: false });
  assert.deepEqual(core.parseToday('?today=abc', '2026-01-01'), { date: '2026-01-01', fixed: false });
  assert.deepEqual(core.parseToday('', '2026-01-01'), { date: '2026-01-01', fixed: false });
  assert.deepEqual(core.parseToday(undefined, '2026-01-01'), { date: '2026-01-01', fixed: false });
});

test('合成示例标记写进 Markdown 与 CSV', () => {
  const r = run('我效率氛围', 3);
  const md = core.toMarkdown({ target: 3, before: r, rewriteText: 'x', date: '2026-10-20', sample: true });
  assert.match(md, /数据来源:合成示例/);
  assert.doesNotMatch(core.toMarkdown({ target: 3, before: r, rewriteText: 'x' }), /合成示例/);
  const csv = core.toCsv(r.overLevel, { sample: true });
  assert.ok(csv.startsWith('词,级别,拼音,出现次数,数据来源\r\n'));
  assert.match(csv, /合成示例/);
  assert.equal(core.toCsv(r.overLevel).split('\r\n')[0], '词,级别,拼音,出现次数');
});

test('Markdown 报告写明统计口径', () => {
  const r = run('我效率氛围', 3);
  const md = core.toMarkdown({ target: 3, before: r, rewriteText: 'x' });
  assert.match(md, /口径/);
  assert.match(md, /目标级内词占比 = 目标级内词数 ÷ 词数/);
});
