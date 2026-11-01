'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const state0 = () => C.emptyState();
function sessionOf(date, seconds, chars = 0) { return { id: 's' + date + seconds, textId: null, title: 'T', date, seconds, chars, marks: 0 }; }

test('分段:按空行分段,忽略多余空行与 CRLF', () => {
  const t = '第一段。\r\n\r\n\r\n   \r\n第二段第一句。第二句。\n\n第三段';
  assert.deepEqual(C.segment(t, 'para'), ['第一段。', '第二段第一句。第二句。', '第三段']);
});

test('分句:中文句末标点与英文句号', () => {
  assert.deepEqual(C.segment('今天下雨。你去吗?我不去!好吧。', 'sent'), ['今天下雨。', '你去吗?', '我不去!', '好吧。']);
  assert.deepEqual(C.segment('It rains. Do you go? No! Fine.', 'sent'), ['It rains.', 'Do you go?', 'No!', 'Fine.']);
});

test('分句:引号内的句号不在引号中间断开', () => {
  const s = C.segment('他说:“我来了。你呢?”然后走了。', 'sent');
  assert.deepEqual(s, ['他说:“我来了。你呢?”', '然后走了。']);
  const e = C.segment('She said, "Stop here. Now." Then she left.', 'sent');
  assert.deepEqual(e, ['She said, "Stop here. Now."', 'Then she left.']);
});

test('分句:省略号', () => {
  assert.deepEqual(C.segment('他想了想……然后笑了。', 'sent'), ['他想了想……', '然后笑了。']);
  assert.deepEqual(C.segment('Wait... Then he ran. And so... it goes on.', 'sent'), ['Wait...', 'Then he ran.', 'And so... it goes on.']);
});

test('分句:缩写 e.g. / Dr. / 小数不当句末', () => {
  assert.deepEqual(C.segment('Use tools, e.g. a pen. Dr. Smith paid 3.14 dollars. J. K. Rowling agreed.', 'sent'),
    ['Use tools, e.g. a pen.', 'Dr. Smith paid 3.14 dollars.', 'J. K. Rowling agreed.']);
  assert.deepEqual(C.segment('cats, dogs, etc. are pets. Yes.', 'sent'), ['cats, dogs, etc. are pets.', 'Yes.']);
});

test('空文本与只有空白:没有任何段/句', () => {
  assert.deepEqual(C.segment('', 'para'), []);
  assert.deepEqual(C.segment('  \n\n \t \n', 'sent'), []);
  assert.deepEqual(C.segment(null, 'para'), []);
  assert.equal(C.makeText('x', '   \n ', '2026-10-20').ok, false);
  assert.deepEqual(C.countChars(''), { cjk: 0, words: 0, total: 0 });
});

test('字数统计:中文按字、英文按词,分别计', () => {
  assert.deepEqual(C.countChars('阅读是一种耐力。'), { cjk: 7, words: 0, total: 7 });
  assert.deepEqual(C.countChars("Don't stop re-reading, 2 times."), { cjk: 0, words: 5, total: 5 });
  assert.deepEqual(C.countChars('读 AI 的 3.5 版本'), { cjk: 4, words: 2, total: 6 });
});

test('sessionStats:暂停期间不计时,字/分钟除零返回 0', () => {
  const ev = [
    { t: 0, type: 'start' }, { t: 60000, type: 'read', chars: 300 }, { t: 120000, type: 'pause' },
    { t: 900000, type: 'resume' }, { t: 960000, type: 'mark' }, { t: 1020000, type: 'end' },
  ];
  const s = C.sessionStats(ev);
  assert.equal(s.seconds, 240);
  assert.equal(s.minutes, 4);
  assert.equal(s.chars, 300);
  assert.equal(s.marks, 1);
  assert.equal(s.cpm, 75);
  const zero = C.sessionStats([{ t: 5, type: 'start' }, { t: 5, type: 'end' }]);
  assert.equal(zero.seconds, 0);
  assert.equal(zero.cpm, 0);
  assert.ok(Number.isFinite(zero.cpm));
  assert.equal(C.sessionStats([]).cpm, 0);
});

test('sessionStats:进行中的会话 running=true,最后一次 tick 计入', () => {
  const s = C.sessionStats([{ t: 0, type: 'start' }, { t: 30000, type: 'tick' }]);
  assert.equal(s.running, true);
  assert.equal(s.seconds, 30);
});

test('breakDue:到点才提示,确认后重新计时,非法间隔不提示', () => {
  assert.equal(C.breakDue(1499, 0, 25), false);
  assert.equal(C.breakDue(1500, 0, 25), true);
  assert.equal(C.breakDue(1600, 1500, 25), false);
  assert.equal(C.breakDue(3000, 1500, 25), true);
  assert.equal(C.breakDue(9999, 0, 0), false);
});

test('dailyStats:按日期汇总,跨日排序,同日多次会话取最长', () => {
  const d = C.dailyStats([sessionOf('2026-10-19', 600, 1000), sessionOf('2026-10-18', 1200, 2000), sessionOf('2026-10-19', 900, 500)]);
  assert.deepEqual(d.map(x => x.date), ['2026-10-18', '2026-10-19']);
  assert.equal(d[1].seconds, 1500);
  assert.equal(d[1].minutes, 25);
  assert.equal(d[1].chars, 1500);
  assert.equal(d[1].sessions, 2);
  assert.equal(d[1].longest, 900);
  assert.deepEqual(C.dailyStats([]), []);
});

test('dailyStats:日期键 __proto__ 不会污染', () => {
  const d = C.dailyStats([sessionOf('__proto__', 60, 1)]);
  assert.equal(d.length, 1);
  assert.equal(d[0].date, '__proto__');
  assert.equal(({}).seconds, undefined);
});

test('streak:按目标判断达标,今天未达标时从昨天数,中断后归零', () => {
  const days = C.dailyStats([
    sessionOf('2026-10-14', 1800), sessionOf('2026-10-15', 1800), sessionOf('2026-10-16', 600),
    sessionOf('2026-10-17', 1800), sessionOf('2026-10-18', 2400), sessionOf('2026-10-19', 1800),
  ]);
  assert.deepEqual(C.streak(days, 30, '2026-10-20'), { current: 3, best: 3 });
  assert.deepEqual(C.streak(days, 10, '2026-10-20'), { current: 6, best: 6 });
  assert.deepEqual(C.streak(days, 30, '2026-10-22'), { current: 0, best: 3 });
  assert.deepEqual(C.streak(days, 41, '2026-10-19'), { current: 0, best: 0 });
  const withToday = C.dailyStats([sessionOf('2026-10-19', 1800), sessionOf('2026-10-20', 1800)]);
  assert.equal(C.streak(withToday, 30, '2026-10-20').current, 2);
});

test('streak:跨月、跨年连续', () => {
  const days = C.dailyStats([sessionOf('2026-12-31', 1800), sessionOf('2027-01-01', 1800)]);
  assert.deepEqual(C.streak(days, 30, '2027-01-01'), { current: 2, best: 2 });
});

test('weekCompare:周一起算,本周与上周分开,上周为 0 时百分比为 null', () => {
  // 2026-10-20 是周二;本周 10-19(周一)起,上周 10-12 到 10-18
  const ss = [sessionOf('2026-10-11', 6000), sessionOf('2026-10-12', 1200), sessionOf('2026-10-18', 600), sessionOf('2026-10-19', 1800), sessionOf('2026-10-20', 600)];
  const w = C.weekCompare(ss, '2026-10-20');
  assert.equal(w.weekStart, '2026-10-19');
  assert.equal(w.thisWeek.seconds, 2400);
  assert.equal(w.lastWeek.seconds, 1800);
  assert.equal(w.deltaMinutes, 10);
  assert.equal(w.pct, 33);
  assert.equal(w.thisWeek.activeDays, 2);
  assert.equal(C.weekCompare([sessionOf('2026-10-19', 60)], '2026-10-20').pct, null);
  assert.equal(C.weekStart('2026-10-25'), '2026-10-19'); // 周日仍属这一周
});

test('goalRate:最近 7 天(含今天)达标天数', () => {
  const days = C.dailyStats([sessionOf('2026-10-20', 1800), sessionOf('2026-10-18', 1800), sessionOf('2026-10-14', 1800), sessionOf('2026-10-13', 1800)]);
  const r = C.goalRate(days, 30, '2026-10-20');
  assert.equal(r.met, 3); // 10-13 在 7 天窗口之外
  assert.equal(r.of, 7);
});

test('addVocab:去重计数,大小写与空白归一,新语境保留', () => {
  let r = C.addVocab([], 'Ephemeral', 'An ephemeral joy.', '文本A', '2026-10-19');
  assert.equal(r.isNew, true);
  assert.equal(r.entry.count, 1);
  r = C.addVocab(r.list, '  ephemeral ', 'Another ephemeral day.', '文本A', '2026-10-20');
  assert.equal(r.isNew, false);
  assert.equal(r.list.length, 1);
  assert.equal(r.entry.count, 2);
  assert.equal(r.entry.date, '2026-10-19');
  assert.equal(r.entry.lastDate, '2026-10-20');
  assert.equal(r.entry.extra.length, 1);
  r = C.addVocab(r.list, 'ephemeral', 'Another ephemeral day.', '文本A', '2026-10-20');
  assert.equal(r.entry.count, 3);
  assert.equal(r.entry.extra.length, 1); // 同一语境不重复记录
  const empty = C.addVocab(r.list, '   ', 'x', 's', '2026-10-20');
  assert.equal(empty.entry, null);
  assert.equal(empty.list, r.list);
});

test('addVocab 不修改传入的数组', () => {
  const list = [];
  const r = C.addVocab(list, '词', '语境', '来源', '2026-10-20');
  assert.equal(list.length, 0);
  assert.equal(r.list.length, 1);
});

test('sortVocab:最近添加(同日后加的在前)与出现次数两种', () => {
  const v = (w, date, count) => ({ id: w, word: w, context: '', source: '', date, lastDate: date, count, extra: [] });
  const list = [v('a', '2026-10-18', 5), v('b', '2026-10-20', 1), v('c', '2026-10-20', 1), v('d', '2026-10-19', 3)];
  assert.deepEqual(C.sortVocab(list, 'recent').map(x => x.word), ['c', 'b', 'd', 'a']);
  assert.deepEqual(C.sortVocab(list, 'count').map(x => x.word), ['a', 'd', 'c', 'b']);
  assert.deepEqual(list.map(x => x.word), ['a', 'b', 'c', 'd']);
});

test('contextOf:取包含该词的那一句', () => {
  assert.equal(C.contextOf('第一句。耐力很重要。第三句。', '耐力'), '耐力很重要。');
  assert.equal(C.contextOf('没有这个词。', '缺失'), '没有这个词。');
});

test('进度位置:按段/句换算并随 JSON 往返保留', () => {
  const body = '甲一。甲二。\n\n乙一。乙二。乙三。\n\n丙一。';
  const ix = C.indexText(body);
  assert.equal(ix.paras.length, 3);
  assert.equal(ix.sents.length, 6);
  assert.deepEqual(C.posAt(ix, 'para', 1), { para: 1, sent: 2 });
  assert.deepEqual(C.posAt(ix, 'sent', 4), { para: 1, sent: 4 });
  assert.deepEqual(C.advance(ix, { para: 2, sent: 5 }, 'para', 1), { para: 3, sent: 6 }); // 读完
  assert.deepEqual(C.advance(ix, { para: 0, sent: 0 }, 'para', -1), { para: 0, sent: 0 }); // 不越界
  const st = state0();
  const t = C.makeText('测', body, '2026-10-20').text;
  t.pos = C.posAt(ix, 'para', 2);
  st.texts.push(t); st.currentTextId = t.id;
  const back = JSON.parse(JSON.stringify(st));
  assert.equal(C.validateState(back).ok, true);
  assert.deepEqual(back.texts[0].pos, { para: 2, sent: 5 });
});

test('CSV:公式防护(= + - @ 开头加单引号,单独 - + 不算),引号与换行转义', () => {
  assert.equal(C.protect('=1+1'), "'=1+1");
  assert.equal(C.protect('+8613'), "'+8613");
  assert.equal(C.protect('-5'), "'-5");
  assert.equal(C.protect('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(C.protect('-'), '-');
  assert.equal(C.protect('+'), '+');
  assert.equal(C.protect('a=b'), 'a=b');
  const list = [{ id: 'v1', word: '=cmd|x', context: '他说"好",然后\n走了', source: '@书', date: '2026-10-20', lastDate: '2026-10-20', count: 2 }];
  const csv = C.vocabCsv(list);
  assert.equal(csv, '词,上下文,来源,添加日期,最近出现,出现次数\r\n\'=cmd|x,"他说""好"",然后\n走了",\'@书,2026-10-20,2026-10-20,2\r\n');
});

test('阅读记录 CSV:字/分钟除零为 0', () => {
  const csv = C.sessionsCsv([{ id: 'a', date: '2026-10-20', title: '=标题', seconds: 0, chars: 10, marks: 1 }, { id: 'b', date: '2026-10-20', title: 'T', seconds: 120, chars: 600, marks: 0 }]);
  const lines = csv.trim().split('\r\n');
  assert.equal(lines[1], "2026-10-20,'=标题,0,10,0,1");
  assert.equal(lines[2], '2026-10-20,T,2,600,300,0');
});

test('批注 Markdown:按来源分组,__proto__ 来源不出错,多行引用压成一行', () => {
  const notes = [
    { id: '1', source: '__proto__', kind: 'doubt', quote: '第一行\n第二行', note: '存疑', date: '2026-10-20', textId: null },
    { id: '2', source: '文本B', kind: 'skip', quote: '看不懂', note: '', date: '2026-10-20', textId: 'x' },
    { id: '3', source: '__proto__', kind: 'doubt', quote: '=HYPERLINK("x")', note: '', date: '2026-10-19', textId: null },
  ];
  const md = C.toMarkdown(notes, '2026-10-20');
  assert.match(md, /^# 批注清单/);
  assert.equal(md.match(/^## /gm).length, 2);
  assert.match(md, /> 第一行 第二行/);
  assert.match(md, /批注:存疑/);
  assert.match(md, /先读过去/);
  assert.doesNotMatch(md, /\n=HYPERLINK/);
});

test('?today:合法日期生效,非法与会被进位的日期回退真实今天', () => {
  const now = new Date(2026, 5, 7, 12, 0, 0);
  assert.equal(C.todayFrom('?today=2026-10-20', now), '2026-10-20');
  assert.equal(C.todayFrom('?today=2024-02-29', now), '2024-02-29');
  assert.equal(C.todayFrom('?today=2026-02-30', now), '2026-06-07');
  assert.equal(C.todayFrom('?today=2026-13-01', now), '2026-06-07');
  assert.equal(C.todayFrom('?today=abc', now), '2026-06-07');
  assert.equal(C.todayFrom('', now), '2026-06-07');
  assert.equal(C.todayFrom('?today=%E0%A4%A', now), '2026-06-07');
  assert.equal(C.addDays('2026-02-28', 1), '2026-03-01');
});

test('validateImport:合法状态通过,往返不变', () => {
  const st = state0();
  const t = C.makeText('标题', '一段。\n\n又一段。', '2026-10-20').text;
  st.texts.push(t); st.currentTextId = t.id;
  st.vocab = C.addVocab([], '词', '语境', '标题', '2026-10-20').list;
  st.sessions.push({ id: 's1', textId: t.id, title: '标题', date: '2026-10-20', seconds: 90, chars: 300, marks: 1 });
  const r = C.validateImport(JSON.stringify(st));
  assert.equal(r.ok, true);
  assert.deepEqual(r.state, st);
});

test('validateImport:拒绝并给出原因(类型、枚举、ID 重复、日期、位置越界、坏 JSON)', () => {
  const base = () => { const s = state0(); const t = C.makeText('T', '甲。\n\n乙。', '2026-10-20').text; s.texts.push(t); return s; };
  assert.equal(C.validateImport('{oops').ok, false);
  assert.equal(C.validateImport('[]').ok, false);
  assert.equal(C.validateImport(null).ok, false);
  let s = base(); s.version = 2; assert.match(C.validateImport(s).error, /版本/);
  s = base(); s.settings.mode = 'page'; assert.match(C.validateImport(s).error, /mode/);
  s = base(); s.settings.goalMin = '30'; assert.equal(C.validateImport(s).ok, false);
  s = base(); s.settings.goalMin = 0; assert.equal(C.validateImport(s).ok, false);
  s = base(); s.texts.push({ ...s.texts[0] }); assert.match(C.validateImport(s).error, /重复/);
  s = base(); s.texts[0].addedAt = '2026-02-30'; assert.match(C.validateImport(s).error, /addedAt/);
  s = base(); s.texts[0].pos = { para: 3, sent: 0 }; assert.match(C.validateImport(s).error, /超出/);
  s = base(); s.texts[0].body = '   '; assert.equal(C.validateImport(s).ok, false);
  s = base(); s.texts[0].times = { __proto__x: 1 }; assert.equal(C.validateImport(s).ok, false);
  s = base(); s.currentTextId = 'nope'; assert.match(C.validateImport(s).error, /currentTextId/);
  s = base(); s.vocab = [{ id: 'v', word: 'w', context: '', source: '', date: '2026-10-20', lastDate: '2026-10-20', count: 0, extra: [] }]; assert.match(C.validateImport(s).error, /次数/);
  s = base(); s.notes = [{ id: 'n', kind: 'maybe', source: '', quote: 'q', note: '', date: '2026-10-20', textId: null }]; assert.match(C.validateImport(s).error, /类型/);
  s = base(); s.sessions = [{ id: 's', textId: null, title: '', date: '2026-10-20', seconds: -1, chars: 0, marks: 0 }]; assert.equal(C.validateImport(s).ok, false);
  s = base(); s.sessions = [{ id: 's', textId: null, title: '', date: '2026-10-20', seconds: 1, chars: 1.5, marks: 0 }]; assert.equal(C.validateImport(s).ok, false);
  s = base(); s.active = { textId: null, title: '', date: '2026-10-20', breakAck: 0, events: [{ t: 1, type: 'dance' }] }; assert.equal(C.validateImport(s).ok, false);
});

test('写入校验 = 读取校验:超长文本、超大目标数字、半成品输入保存后仍能读回', () => {
  const st = state0();
  const long = ('很长的一句话。'.repeat(20000) + '\n\n') + 'tail words here.';
  const t = C.makeText('T'.repeat(5000), long, '2026-10-20').text;
  st.texts.push(t); st.currentTextId = t.id;
  st.settings.goalMin = 99999999;
  st.settings.breakMin = 0.02;
  st.vocab = C.addVocab([], 'x', '', '', '2026-10-20').list; // 无上下文的半成品生词
  const wrote = JSON.stringify(st);
  assert.equal(C.validateState(st).ok, true);
  assert.equal(C.validateState(JSON.parse(wrote)).ok, true);
});

test('emptyState 自身合法;makeText 空标题用默认名', () => {
  assert.equal(C.validateState(C.emptyState()).ok, true);
  assert.equal(C.makeText('  ', '内容', '2026-10-20').text.title, '未命名文本');
});

test('fmtClock', () => {
  assert.equal(C.fmtClock(0), '00:00');
  assert.equal(C.fmtClock(75), '01:15');
  assert.equal(C.fmtClock(3671), '1:01:11');
  assert.equal(C.fmtClock(-5), '00:00');
});

test('切换文本:先结算原文本的会话,新会话不再累计到原文本', () => {
  const st = state0();
  const a = C.makeText('甲', '甲一。\n\n甲二。', '2026-10-20').text;
  const b = C.makeText('乙', '乙一。', '2026-10-20').text;
  st.texts.push(a, b); st.currentTextId = a.id;
  st.active = { textId: a.id, title: '甲', date: '2026-10-20', breakAck: 0, events: [{ t: 0, type: 'start' }, { t: 60000, type: 'read', chars: 200 }, { t: 90000, type: 'mark' }] };
  const rec = C.switchText(st, b.id, 120000);
  assert.equal(st.currentTextId, b.id);
  assert.equal(st.active, null);
  assert.equal(st.sessions.length, 1);
  assert.equal(rec.textId, a.id);
  assert.equal(rec.title, '甲');
  assert.equal(rec.chars, 200);
  assert.equal(rec.seconds, 120);
  assert.equal(rec.marks, 1);
  assert.equal(C.validateState(st).ok, true);
  // 同一文本不结算;没读到内容的会话丢弃
  const st2 = state0(); st2.texts.push(a); st2.currentTextId = a.id;
  st2.active = { textId: a.id, title: '甲', date: '2026-10-20', breakAck: 0, events: [{ t: 5, type: 'start' }] };
  assert.equal(C.switchText(st2, a.id, 99), null);
  assert.ok(st2.active);
  assert.equal(C.switchText(st2, null, 5), null);
  assert.equal(st2.sessions.length, 0);
  assert.equal(st2.active, null);
});

test('第五轮:snippet 截取删除确认里显示的摘要(压缩空白、超长加省略号、空值安全)', () => {
  assert.equal(C.snippet('  很  长\n的   词 ', 40), '很 长 的 词');
  assert.equal(C.snippet('abcdefghij', 5), 'abcde…');
  assert.equal(C.snippet('abcde', 5), 'abcde');
  assert.equal(C.snippet(null, 5), '');
  assert.equal(C.snippet(undefined), '');
});
