const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');
const S = require('../sample-data.js');

const TODAY = '2026-09-30';

test('分类：量词替换（个→本、只→件）与数词后漏写量词', () => {
  assert.equal(C.classify('我有三个书。', '我有三本书。'), 'measure');
  assert.equal(C.classify('我很喜欢这只衣服', '我很喜欢这件衣服'), 'measure');
  assert.equal(C.classify('这书很好', '这本书很好'), 'measure');
  // 「只」作副词被删掉，前面不是数词/指示词 → 不是量词错误
  assert.equal(C.classify('我只有一个', '我有一个'), 'extra');
});

test('分类：语序（字符集合相同、顺序不同），标点与空格不影响', () => {
  assert.equal(C.classify('我学习中文在北京。', '我在北京学习中文。'), 'order');
  assert.equal(C.classify('我 起床 七点 每天', '我每天七点起床！'), 'order');
});

test('分类：了/过/着 增删与互换', () => {
  assert.equal(C.classify('我昨天看一个电影', '我昨天看了一个电影'), 'aspect');
  assert.equal(C.classify('我没去了上海', '我没去过上海'), 'aspect');
  assert.equal(C.classify('门开着了', '门开着'), 'aspect');
});

test('分类：的/地/得 混用，但删掉「的」算多字', () => {
  assert.equal(C.classify('他跑的很快', '他跑得很快'), 'de');
  assert.equal(C.classify('她高兴的说', '她高兴地说'), 'de');
  assert.equal(C.classify('我的朋友的书', '我朋友的书'), 'extra');
});

test('分类：缺字、多字、错别字、其他', () => {
  assert.equal(C.classify('我对中国文化很兴趣', '我对中国文化很感兴趣'), 'missing');
  assert.equal(C.classify('我是很累', '我很累'), 'extra');
  assert.equal(C.classify('我在等公共气车', '我在等公共汽车'), 'typo');
  assert.equal(C.classify('我打电话我的朋友', '我给我的朋友打电话'), 'other');
});

test('分类：异常输入（空、相同、非字符串）返回其他而不抛错', () => {
  assert.equal(C.classify('', '我很好'), 'other');
  assert.equal(C.classify('我很好', '我很好。'), 'other');
  assert.equal(C.classify(null, undefined), 'other');
});

test('示例数据全部标为合成示例，且规则分类与 expectTag 一致', () => {
  assert.equal(S.label, '合成示例');
  assert.ok(S.cards.length >= 12);
  for (const s of S.cards) assert.equal(C.classify(s.wrong, s.correct), s.expectTag, s.wrong);
});

test('charDiff：还原两侧原文，并标出替换/插入', () => {
  const ops = C.charDiff('我有三个书', '我有三本书');
  assert.deepEqual(ops, [
    { type: 'eq', text: '我有三' }, { type: 'del', text: '个' }, { type: 'ins', text: '本' }, { type: 'eq', text: '书' }
  ]);
  const a = ops.filter(o => o.type !== 'ins').map(o => o.text).join('');
  const b = ops.filter(o => o.type !== 'del').map(o => o.text).join('');
  assert.equal(a, '我有三个书');
  assert.equal(b, '我有三本书');
  assert.deepEqual(C.charDiff('', 'ab'), [{ type: 'ins', text: 'ab' }]);
});

test('isCorrectAnswer 忽略标点空格，空答案不算对', () => {
  assert.equal(C.isCorrectAnswer('我有三本书', '我有三本书。'), true);
  assert.equal(C.isCorrectAnswer('我有三个书', '我有三本书。'), false);
  assert.equal(C.isCorrectAnswer('   ', '。'), false);
});

test('日期：跨月跨年加减、非法日期抛错', () => {
  assert.equal(C.addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(C.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(C.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(C.daysBetween('2026-09-30', '2026-10-21'), 21);
  assert.throws(() => C.parseISO('2026-02-30'));
  assert.throws(() => C.parseISO('2026/09/30'));
});

test('SM-2：新卡首次「想起」→1 天，第二次 6 天，第三次 ×EF', () => {
  let card = C.makeCard({ wrong: '我有三个书', correct: '我有三本书' }, TODAY, 'a');
  card = C.review(card, 'good', TODAY);
  assert.equal(card.interval, 1);
  assert.equal(card.due, '2026-10-01');
  card = C.review(card, 'good', '2026-10-01');
  assert.equal(card.interval, 6);
  assert.equal(card.due, '2026-10-07');
  card = C.review(card, 'good', '2026-10-07');
  assert.equal(card.interval, 15); // round(6 × 2.5)
  assert.equal(card.ef, 2.5);
  assert.equal(card.reps, 3);
});

test('SM-2：「忘了」重置 reps、间隔 1 天、EF 下降且不低于 1.3，并计入遗忘次数', () => {
  let card = Object.assign(C.makeCard({ wrong: 'a', correct: 'b' }, TODAY, 'x'), { reps: 5, interval: 40, ef: 1.35 });
  card = C.review(card, 'again', TODAY);
  assert.equal(card.reps, 0);
  assert.equal(card.interval, 1);
  assert.equal(card.ef, 1.3);
  assert.equal(card.lapses, 1);
  const easy = C.sm2({ ef: 2.5, reps: 0, interval: 0 }, 5, TODAY);
  assert.equal(easy.ef, 2.6);
  const hard = C.sm2({ ef: 2.5, reps: 0, interval: 0 }, 3, TODAY);
  assert.equal(hard.ef, 2.36);
  assert.throws(() => C.review(card, 'maybe', TODAY));
  assert.throws(() => C.sm2(card, 4, 'tomorrow'));
});

test('到期队列：只含 due<=今天，按到期日升序；已掌握=间隔≥21', () => {
  const mk = (id, due, interval) => Object.assign(C.makeCard({ wrong: '甲' + id, correct: '乙' + id }, '2026-09-01', id), { due, interval });
  const cards = [mk('1', '2026-09-30', 1), mk('2', '2026-09-28', 6), mk('3', '2026-10-01', 21), mk('4', '2026-09-29', 30)];
  assert.deepEqual(C.dueQueue(cards, TODAY).map(c => c.id), ['2', '4', '1']);
  assert.deepEqual(C.dueQueue(cards, '2026-09-27'), []);
  assert.equal(C.nextDueDate(cards, TODAY), '2026-10-01');
  const st = C.stats(cards, TODAY, [{ date: TODAY, id: '1', grade: 'good' }, { date: '2026-09-29', id: '2', grade: 'good' }]);
  assert.equal(st.due, 3);
  assert.equal(st.mastered, 2);
  assert.equal(st.reviewedToday, 1);
  assert.equal(st.total, 4);
});

test('统计：按错误类型计数并按数量降序', () => {
  const cards = S.cards.map((s, i) => C.makeCard(s, TODAY, 's' + i));
  const st = C.stats(cards, TODAY, []);
  assert.equal(st.byTag[0].id, 'measure');
  assert.equal(st.byTag[0].count, 3);
  assert.equal(st.maxCount, 3);
  assert.equal(st.byTag.reduce((n, r) => n + r.count, 0), cards.length);
  assert.equal(st.byTag.length, C.TAGS.length);
});

test('makeCard / setTag：必填校验、手动改标签被记录', () => {
  assert.throws(() => C.makeCard({ wrong: '', correct: '我好' }, TODAY, 1), /错句/);
  assert.throws(() => C.makeCard({ wrong: '我好', correct: '我好。' }, TODAY, 1), /相同/);
  const card = C.makeCard({ wrong: '我有三个书', correct: '我有三本书' }, TODAY, 1);
  assert.equal(card.due, TODAY);
  assert.equal(card.tagManual, false);
  const edited = C.setTag(card, 'typo');
  assert.equal(edited.tag, 'typo');
  assert.equal(edited.tagManual, true);
  assert.equal(C.setTag(edited, 'measure').tagManual, false);
  assert.throws(() => C.setTag(card, 'nope'));
});

test('批量粘贴：支持全角竖线、跳过空行、报告错误行号', () => {
  const r = C.parseBulk('我有三个书 | 我有三本书 | I have three books\n\n我是很累｜我很累\n只有一段\n同句 | 同句');
  assert.equal(r.items.length, 2);
  assert.deepEqual(r.items[0], { wrong: '我有三个书', correct: '我有三本书', english: 'I have three books' });
  assert.equal(r.items[1].english, '');
  assert.deepEqual(r.errors.map(e => e.line), [4, 5]);
});

test('Anki CSV：正面=错句+英文，背面=正确句+类型；转义逗号、引号与 HTML', () => {
  const card = C.makeCard({ wrong: '我有三个书', correct: '我有三本书', english: 'I have "three" books, <b>' }, TODAY, 1);
  const csv = C.toAnkiCSV([card]);
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], '#separator:comma');
  assert.equal(lines[2], '#columns:正面,背面,标签');
  assert.equal(lines[3], '"我有三个书<br>I have &quot;three&quot; books, &lt;b&gt;",我有三本书<br>错误类型：量词错误,错题回环 measure');
});

test('JSON 备份往返；非法或非本产品文件抛错；坏字段被修正', () => {
  const card = C.review(C.makeCard({ wrong: '我是很累', correct: '我很累' }, TODAY, 'k'), 'good', TODAY);
  const json = C.exportJSON({ cards: [card], log: [{ date: TODAY, id: 'k', grade: 'good' }] }, '2026-09-30T10:00:00Z');
  const back = C.importJSON(json, TODAY);
  assert.deepEqual(back.cards[0], card);
  assert.equal(back.log.length, 1);
  assert.throws(() => C.importJSON('{oops', TODAY), /JSON/);
  assert.throws(() => C.importJSON('{"app":"other","cards":[]}', TODAY), /备份/);
  const fixed = C.importJSON(JSON.stringify({ app: 'cuoti-huihuan', cards: [{ id: 'z', wrong: '这书', correct: '这本书', tag: 'bogus', due: 'soon', ef: 0.2, reps: -3 }] }), TODAY);
  assert.equal(fixed.cards[0].tag, 'measure');
  assert.equal(fixed.cards[0].due, TODAY);
  assert.equal(fixed.cards[0].ef, 2.5);
  assert.equal(fixed.cards[0].reps, 0);
  assert.deepEqual(C.mergeCards([card], [Object.assign({}, card, { note: 'new' })]).map(c => c.note), ['new']);
});

test('导入：缺失/重复 ID 生成唯一 ID 不吞卡，重复导入幂等，坏条目跳过并计数', () => {
  const file = JSON.stringify({ app: 'cuoti-huihuan', cards: [
    { wrong: '我有三个书', correct: '我有三本书' },
    { wrong: '我是很累', correct: '我很累' },
    { id: 'dup', wrong: '这书', correct: '这本书' },
    { id: 'dup', wrong: '他跑地很快', correct: '他跑得很快' },
    null,
    { id: 'empty', wrong: '', correct: '空' }
  ] });
  const r = C.importJSON(file, TODAY);
  assert.equal(r.cards.length, 4);
  assert.equal(new Set(r.cards.map(c => c.id)).size, 4);
  assert.equal(r.dropped, 2);
  assert.equal(r.reIded, 3);
  const once = C.mergeCards([], r.cards);
  const twice = C.mergeCards(once, C.importJSON(file, TODAY).cards);
  assert.equal(twice.length, 4);
});

test('复习日志合并按 date+id+grade 去重，重复导入不放大今日复习数', () => {
  const log = [{ date: TODAY, id: 'k', grade: 'good' }];
  const merged = C.mergeLog(C.mergeLog([], log), log);
  assert.equal(merged.length, 1);
  assert.equal(C.stats([], TODAY, merged).reviewedToday, 1);
  assert.equal(C.mergeLog([], [{ date: TODAY, id: 'a', grade: 'good' }, { date: TODAY, id: 'b', grade: 'good' }, { date: TODAY, id: 'c', grade: 'good' }], 2).map(e => e.id).join(), 'b,c');
});

test('sanitizeState：null 卡片与坏日志被剔除，不会在到期计算里崩溃', () => {
  const s = C.sanitizeState({ cards: [null, { id: 'a', wrong: '我是很累', correct: '我很累', due: TODAY }], log: [null, { date: 'x' }] }, TODAY);
  assert.equal(s.cards.length, 1);
  assert.equal(s.dropped, 1);
  assert.equal(s.log.length, 0);
  assert.equal(C.dueQueue(s.cards, TODAY).length, 1);
  assert.deepEqual(C.sanitizeState(null, TODAY).cards, []);
});

test('Anki CSV：首字符 = + - @ 编码为 HTML 实体，防电子表格公式执行', () => {
  const card = C.makeCard({ wrong: '=1+1', correct: '@我很累' }, TODAY, 'f');
  const row = C.toAnkiCSV([card]).trim().split('\n')[3];
  assert.ok(row.startsWith('&#61;1+1,&#64;我很累'), row);
  assert.ok(!/^[=+\-@]/.test(row));
});

test('isPunctOnly：复习对比忽略纯标点差异', () => {
  assert.equal(C.isPunctOnly('。'), true);
  assert.equal(C.isPunctOnly('，！ '), true);
  assert.equal(C.isPunctOnly('得'), false);
  assert.equal(C.isPunctOnly(''), false);
  const ops = C.charDiff('他跑步跑地很快', '他跑步跑得很快。');
  assert.deepEqual(ops.filter(o => o.type !== 'eq' && !C.isPunctOnly(o.text)).map(o => o.type + o.text), ['del地', 'ins得']);
});
