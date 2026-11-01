'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const roster = (t) => C.parseRoster(t);

test('名单:每行一个、CSV 备注、别名', () => {
  const r = roster('张三=张三妈妈, 三三\n李四, 二年级\n\n王五');
  assert.equal(r.length, 3);
  assert.deepEqual(r[0].aliases, ['张三妈妈', '三三']);
  assert.equal(r[0].name, '张三');
  assert.equal(r[1].name, '李四');
  assert.equal(r[1].note, '二年级');
  assert.equal(r[2].note, '');
  assert.deepEqual(r.map(m => m.id), ['m1', 'm2', 'm3']);
});

test('名单:全角等号、全角逗号与空名字行', () => {
  const x = C.parseRosterEx('张三＝三三，阿三\n=没有名字\n李四，备注');
  assert.deepEqual(x.members[0].aliases, ['三三', '阿三']);
  assert.equal(x.members[1].note, '备注');
  assert.equal(x.skipped.length, 1);
  assert.equal(x.skipped[0].line, 2);
});

test('名单:空输入得到空数组', () => {
  assert.deepEqual(roster(''), []);
  assert.deepEqual(roster(null), []);
  assert.deepEqual(roster('  \n \n'), []);
});

test('归一化:全角半角、空白、大小写、零宽字符', () => {
  assert.equal(C.normalizeName('ＡＢＣ　 张 三'), 'abc张三');
  assert.equal(C.normalizeName('张​三'), '张三');
  assert.equal(C.normalizeName(null), '');
});

test('回执格式 A:冒号与空格分隔,冒号优先,时间冒号不当分隔符', () => {
  const r = C.parseReplies('张三: 收到\n李四：好的\n王五 同意\nAmy 妈妈: 参加\n赵六 10:30到');
  assert.deepEqual(r.map(x => [x.nick, x.content]), [
    ['张三', '收到'], ['李四', '好的'], ['王五', '同意'], ['Amy 妈妈', '参加'], ['赵六', '10:30到']
  ]);
});

test('回执格式 B:微信导出「名字 时间 / 内容」,含日期和多行内容', () => {
  const r = C.parseReplies('张三 2026-10-20 21:05:12\n收到\n\n李四 21:06\n好的\n第二行\n王五 21:07\n同意');
  assert.equal(r.length, 3);
  assert.deepEqual(r[0], { nick: '张三', content: '收到', time: '2026-10-20 21:05:12' });
  assert.equal(r[1].content, '好的\n第二行');
  assert.equal(r[2].nick, '王五');
});

test('回执:两种格式混合,无法解析的行进入 skipped', () => {
  const x = C.parseRepliesEx('张三: 收到\n李四 21:06\n好的\n\n单独一个词\n');
  assert.equal(x.replies.length, 2);
  assert.equal(x.skipped.length, 1);
  assert.equal(x.skipped[0].text, '单独一个词');
});

test('回执:「名字 时间」后面没有内容时按格式 A 处理', () => {
  const r = C.parseReplies('张三 10:30');
  assert.deepEqual(r, [{ nick: '张三', content: '10:30' }]);
});

test('匹配:精确 → 别名 → 归一化', () => {
  const ro = roster('张三=三三妈妈\n李四\nAnna');
  const res = C.match(ro, [
    { nick: '张三', content: 'a' }, { nick: '三三妈妈', content: 'b' },
    { nick: '李　四', content: 'c' }, { nick: 'ＡＮＮＡ', content: 'd' }
  ]);
  assert.equal(res.matched.length, 3);
  assert.equal(res.unmatched.length, 0);
  assert.equal(res.matched.find(e => e.member.name === '张三').via, 'exact');
  assert.equal(res.matched.find(e => e.member.name === '李四').via, 'normalized');
  assert.equal(res.matched.find(e => e.member.name === '张三').count, 2);
});

test('匹配:包含匹配(昵称里含姓名)', () => {
  const ro = roster('王子豪=子豪爸爸\n李思雨');
  const res = C.match(ro, [{ nick: '王子豪爸爸(家长)', content: 'ok' }, { nick: '小李思雨', content: 'ok' }]);
  assert.equal(res.matched.length, 2);
  assert.ok(res.matched.every(e => e.via === 'contains'));
});

test('匹配:两人都被包含 → 无法识别并写明原因', () => {
  const ro = roster('张三\n张三丰');
  const res = C.match(ro, [{ nick: '张三丰妈妈', content: '收到' }]);
  assert.equal(res.matched.length, 0);
  assert.equal(res.unknown.length, 1);
  assert.match(res.unknown[0].reason, /多人/);
  assert.equal(res.unmatched.length, 2);
});

test('匹配:精确命中优先于包含(张三 与 张三丰 并存)', () => {
  const res = C.match(roster('张三\n张三丰'), [{ nick: '张三丰', content: '收到' }]);
  assert.equal(res.matched.length, 1);
  assert.equal(res.matched[0].member.name, '张三丰');
});

test('匹配:同名同姓出现在名单两次 → 无法识别', () => {
  const res = C.match(roster('李明\n李明'), [{ nick: '李明', content: '收到' }]);
  assert.equal(res.unknown.length, 1);
  assert.equal(res.matched.length, 0);
});

test('匹配:同一人多次回复取最后一次;未匹配昵称进入 unknown', () => {
  const res = C.match(roster('张三\n李四'), [
    { nick: '张三', content: '好的' }, { nick: '陌生人', content: '收到' }, { nick: '张三', content: '不参加' }
  ]);
  assert.equal(res.matched[0].reply.content, '不参加');
  assert.equal(res.matched[0].count, 2);
  assert.equal(res.matched[0].history.length, 2);
  assert.equal(res.unknown[0].nick, '陌生人');
  assert.deepEqual(res.unmatched.map(m => m.name), ['李四']);
});

test('匹配:空名单、空昵称', () => {
  const res = C.match([], [{ nick: '张三', content: 'x' }, { nick: '  ', content: 'y' }]);
  assert.equal(res.unknown.length, 2);
  assert.equal(res.unknown[1].reason, '昵称为空');
  assert.deepEqual(C.match([], []), { matched: [], unmatched: [], unknown: [] });
});

test('匹配:昵称 __proto__ / constructor 不会出错', () => {
  const res = C.match(roster('constructor\n__proto__'), [{ nick: '__proto__', content: '收到' }, { nick: 'constructor', content: '好的' }]);
  assert.equal(res.matched.length, 2);
  assert.equal(res.unknown.length, 0);
});

test('分类:四类 + 其他', () => {
  assert.equal(C.classify('收到'), 'read');
  assert.equal(C.classify('好的,谢谢'), 'read');
  assert.equal(C.classify('OK'), 'read');
  assert.equal(C.classify('同意参加'), 'agree');
  assert.equal(C.classify('报名两个孩子'), 'agree');
  assert.equal(C.classify('不参加'), 'decline');
  assert.equal(C.classify('明天请假'), 'decline');
  assert.equal(C.classify('几点开始?'), 'question');
  assert.equal(C.classify('几点开始？'), 'question');
  assert.equal(C.classify('要带水杯吗'), 'question');
  assert.equal(C.classify('我晚点到,先占个位'), 'other');
  assert.equal(C.classify(''), 'other');
});

test('分类:优先级 问题 > 不参加 > 同意 > 已读', () => {
  assert.equal(C.classify('不参加'), 'decline');            // 含「参加」但不能算同意
  assert.equal(C.classify('好的,不去了'), 'decline');
  assert.equal(C.classify('可以参加吗?'), 'question');
  assert.equal(C.classify('收到,同意'), 'agree');
});

test('分类:纯字母数字关键词按词边界匹配(「1」不命中「10:30」,ok 不命中 book)', () => {
  assert.equal(C.classify('1'), 'read');
  assert.equal(C.classify('收到1'), 'read');
  assert.equal(C.classify('10:30到'), 'other');
  assert.equal(C.classify('book'), 'other');
  assert.equal(C.classify('ok!'), 'read');
  assert.equal(C.classify('１'), 'read');
});

test('分类:自定义关键词替换默认', () => {
  const rules = { read: ['已阅'], agree: ['可以'], decline: ['去不了'], question: ['请问'] };
  assert.equal(C.classify('已阅', rules), 'read');
  assert.equal(C.classify('收到', rules), 'other');
  assert.equal(C.classify('请问几点', rules), 'question');
  assert.equal(C.classify('我去不了', rules), 'decline');
  assert.deepEqual(C.parseKeywords('已阅, 好 ，、\n  好\nOK'), ['已阅', '好', 'OK']);
  assert.equal(C.classify('已阅', { read: [''], agree: [], decline: [], question: [] }), 'other');
});

test('催回文本:{姓名} 逐行带 @,{名单} 合并,无占位符时前置', () => {
  const un = [{ name: '张三' }, { name: '李四' }];
  assert.equal(C.reminderText(un, '@{姓名} 请回复收到'), '@张三 请回复收到\n@李四 请回复收到');
  assert.equal(C.reminderText(un, '{名单} 请今晚前回复'), '@张三 @李四 请今晚前回复');
  assert.equal(C.reminderText(['张三'], '请回复'), '@张三 请回复');
  assert.equal(C.reminderText(un, ''), '@张三 请回复收到\n@李四 请回复收到');
  assert.equal(C.reminderText([], '@{姓名}'), '');
  assert.equal(C.reminderText([{ name: '$&' }], '@{姓名}!'), '@$&!');
});

test('merge:第二批覆盖第一批、次数累加、保持名单顺序、未回减少', () => {
  const ro = roster('张三\n李四\n王五');
  const a = C.match(ro, [{ nick: '李四', content: '不参加' }]);
  const b = C.match(ro, [{ nick: '李四', content: '改了,参加' }, { nick: '张三', content: '收到' }, { nick: '外人', content: '1' }]);
  const m = C.merge(a, b);
  assert.deepEqual(m.matched.map(e => e.member.name), ['张三', '李四']);
  const li = m.matched[1];
  assert.equal(li.reply.content, '改了,参加');
  assert.equal(li.count, 2);
  assert.equal(li.history.length, 2);
  assert.deepEqual(m.unmatched.map(x => x.name), ['王五']);
  assert.equal(m.unknown.length, 1);
  assert.equal(C.merge(null, a).matched.length, 1);
});

function stateWith(over) { return Object.assign(C.createState(), over); }

test('analyze:两批累加并按分类分组', () => {
  const s = stateWith({
    rosterText: '张三\n李四\n王五\n赵六',
    batches: [
      { id: 'b1', label: '第 1 批', text: '张三: 收到\n李四: 不参加\n陌生: 好的' },
      { id: 'b2', label: '第 2 批', text: '李四 21:00\n改了,参加\n王五 21:01\n要带什么吗?' }
    ]
  });
  const a = C.analyze(s);
  assert.equal(a.counts.total, 4);
  assert.equal(a.counts.replied, 3);
  assert.equal(a.counts.unreplied, 1);
  assert.equal(a.counts.unknown, 1);
  assert.equal(a.unknown[0].batch, '第 1 批');
  assert.deepEqual(a.groups.agree.map(g => g.member.name), ['李四']);
  assert.deepEqual(a.groups.question.map(g => g.member.name), ['王五']);
  assert.deepEqual(a.counts.perCat, { read: 1, agree: 1, decline: 0, question: 1, other: 0 });
});

test('analyze:空名单不抛错;名单重名给出提示', () => {
  const a = C.analyze(stateWith({ rosterText: '', batches: [{ id: 'b1', label: 'x', text: '张三: 收到' }] }));
  assert.equal(a.counts.total, 0);
  assert.equal(a.counts.unknown, 1);
  const w = C.analyze(stateWith({ rosterText: '张三=三三\n李四=三三' })).warnings;
  assert.equal(w.length, 1);
  assert.match(w[0], /三三/);
});

test('CSV:公式注入加单引号,单独的 - 和 + 不加,引号与换行转义', () => {
  assert.equal(C.csvCell('=1+1'), "'=1+1");
  assert.equal(C.csvCell('+86 123'), "'+86 123");
  assert.equal(C.csvCell('-5'), "'-5");
  assert.equal(C.csvCell('@张三'), "'@张三");
  assert.equal(C.csvCell('-'), '-');
  assert.equal(C.csvCell('+'), '+');
  assert.equal(C.csvCell('a,"b"'), '"a,""b"""');
  assert.equal(C.csvCell('x\ny'), '"x\ny"');
  assert.equal(C.toCsv([['a', '=b'], ['c', 'd']]), "a,'=b\r\nc,d");
});

test('回执表行:已回/未回/无法识别齐全,恶意昵称被防护', () => {
  const s = stateWith({
    rosterText: '张三, 一班\n李四',
    batches: [{ id: 'b1', label: '第 1 批', text: '张三: =HYPERLINK("x")\n=cmd: 收到' }]
  });
  const rows = C.receiptRows(C.analyze(s));
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[1].slice(0, 3), ['张三', '一班', '已回']);
  assert.equal(rows[2][2], '未回');
  assert.equal(rows[3][2], '无法识别');
  const csv = C.toCsv(rows);
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes("'=cmd"));
});

test('validateImport:合法备份往返;JSON 字符串与对象都可', () => {
  const s = stateWith({ title: 't', rosterText: '张三', batches: [{ id: 'b1', label: 'a', text: 'x' }, { id: 'b2', label: 'b', text: '' }] });
  const r1 = C.validateImport(JSON.stringify(s));
  assert.equal(r1.ok, true);
  assert.deepEqual(r1.state, s);
  assert.equal(C.validateImport(s).ok, true);
  assert.equal(C.validateState(C.createState()).ok, true);
});

test('validateImport:类型/枚举/重复 id/坏 JSON 一律整份拒绝', () => {
  const ok = C.createState();
  const cases = [
    ['{坏', /JSON/],
    ['[]', /对象/],
    [Object.assign({}, ok, { app: 'other' }), /app/],
    [Object.assign({}, ok, { version: 2 }), /version/],
    [Object.assign({}, ok, { title: 5 }), /title/],
    [Object.assign({}, ok, { rules: { read: [], agree: [], decline: [], question: [], bogus: [] } }), /未知分类/],
    [Object.assign({}, ok, { rules: { read: ['a'], agree: [], decline: [] } }), /question/],
    [Object.assign({}, ok, { rules: { read: [1], agree: [], decline: [], question: [] } }), /字符串/],
    [Object.assign({}, ok, { batches: 'x' }), /batches/],
    [Object.assign({}, ok, { batches: [{ id: 'a', label: '', text: '' }, { id: 'a', label: '', text: '' }] }), /重复/],
    [Object.assign({}, ok, { batches: [{ id: '', label: '', text: '' }] }), /id/],
    [Object.assign({}, ok, { batches: [{ id: 'a', label: '', text: 3 }] }), /text/]
  ];
  cases.forEach(([input, re]) => {
    const r = C.validateImport(input);
    assert.equal(r.ok, false, String(re));
    assert.match(r.error, re);
  });
});

test('写入校验 = 读取校验:超长文本与半成品输入保存后仍通过', () => {
  const big = '张三: 收到\n'.repeat(20000);
  const s = stateWith({ rosterText: '张三\n=\n', batches: [{ id: 'b1', label: 'x'.repeat(5000), text: big + '\n半成品没有分隔符' }] });
  assert.equal(C.validateState(s).ok, true);
  const back = C.validateImport(JSON.stringify(s));
  assert.equal(back.ok, true);
  assert.equal(back.state.batches[0].text.length, s.batches[0].text.length);
  assert.doesNotThrow(() => C.analyze(back.state));
});

test('hasUserData:空状态 false,有任一输入 true', () => {
  assert.equal(C.hasUserData(C.createState()), false);
  assert.equal(C.hasUserData(stateWith({ title: 'x' })), true);
  assert.equal(C.hasUserData(stateWith({ batches: [{ id: 'b1', label: '', text: ' 张三: 1' }] })), true);
});

test('示例数据:30 人 + 18/7 条回执,各分类齐全、3 条无法识别', () => {
  global.NoticeCore = C;
  require('../sample-data.js');
  const s = global.NoticeSample.build();
  assert.equal(C.validateState(s).ok, true);
  const a = C.analyze(s);
  assert.equal(a.counts.total, 30);
  assert.equal(a.batchInfo[0].replies, 18);
  assert.equal(a.batchInfo[1].replies, 7);
  assert.equal(a.counts.unknown, 3);
  assert.equal(a.counts.replied, 20);
  assert.equal(a.counts.unreplied, 10);
  ['read', 'agree', 'decline', 'question', 'other'].forEach(c => assert.ok(a.counts.perCat[c] > 0, c));
  assert.equal(a.batchInfo.every(b => b.skipped.length === 0), true);
});

/* ---------- Codex 审核修复:名单 CSV 引号 / 混合回执边界 / 替换确认 ---------- */
test('名单 CSV:引号包裹的姓名与备注去掉引号,引号内逗号和 "" 转义保留', () => {
  const r = roster('"张三","备注"\n"李,四","一班, ""重点"""\n"王五"');
  assert.deepEqual(r.map(m => m.name), ['张三', '李,四', '王五']);
  assert.equal(r[0].note, '备注');
  assert.equal(r[1].note, '一班, "重点"');
  const res = C.match(r, [{ nick: '张三', content: '收到' }]);
  assert.equal(res.matched.length, 1);
});

test('名单 CSV:引号未闭合或列数过多 → 整份拒绝(空名单 + 错误原因)', () => {
  const a = C.parseRosterEx('张三\n"李四,备注\n王五');
  assert.deepEqual(a.members, []);
  assert.equal(a.errors.length, 1);
  assert.match(a.errors[0].message, /引号/);
  const b = C.parseRosterEx('张三, 备注, 多余一列');
  assert.deepEqual(b.members, []);
  assert.match(b.errors[0].message, /列/);
  const c = C.parseRosterEx('"张三"后面多了字,备注');
  assert.deepEqual(c.members, []);
  assert.equal(C.parseRosterEx('张三=三三, 阿三\n李四, 备注').errors.length, 0);
  const an = C.analyze(stateWith({ rosterText: '"张三' }));
  assert.equal(an.counts.total, 0);
  assert.equal(an.rosterErrors.length, 1);
});

test('回执:微信格式后紧接普通「昵称: 内容」回执(无空行)不被吞进前一条', () => {
  const r = C.parseReplies('张三 10:00\n收到\n李四: 同意\n王五：不参加');
  assert.deepEqual(r.map(x => [x.nick, x.content]), [['张三', '收到'], ['李四', '同意'], ['王五', '不参加']]);
  assert.equal(r[0].time, '10:00');
  const r2 = C.parseReplies('李四: 同意\n张三 10:00\n收到\n王五: 好的');
  assert.deepEqual(r2.map(x => x.nick), ['李四', '张三', '王五']);
});

test('hasUserData:仅改关键词、催回模板或批次配置也算有数据', () => {
  assert.equal(C.hasUserData(stateWith({ template: '@{姓名} 快回' })), true);
  const s = C.createState(); s.rules.read = ['已阅'];
  assert.equal(C.hasUserData(s), true);
  const s2 = C.createState(); s2.batches[0].label = '自定义';
  assert.equal(C.hasUserData(s2), true);
  const s3 = C.createState(); s3.batches.push({ id: 'b2', label: '第 2 批', text: '' });
  assert.equal(C.hasUserData(s3), true);
  assert.equal(C.hasUserData(C.createState()), false);
});

/* ---- 第五轮:匹配依据、命中词、表头 ---- */
test('classifyEx 返回分类和命中的关键词', () => {
  assert.deepEqual(C.classifyEx('不用担心,我参加', C.DEFAULT_RULES), { cat: 'decline', hit: '不' });
  assert.deepEqual(C.classifyEx('收到', C.DEFAULT_RULES), { cat: 'read', hit: '收到' });
  assert.deepEqual(C.classifyEx('可以参加吗?', C.DEFAULT_RULES), { cat: 'question', hit: '?' });
  assert.deepEqual(C.classifyEx('明天见', C.DEFAULT_RULES), { cat: 'other', hit: '' });
});

test('analyze:已回条目带匹配方式、命中词,包含匹配与不参加要求人工确认', () => {
  const state = C.createState();
  state.rosterText = '张三\n李四\n王五';
  state.batches[0].text = '张三妈妈: 不用担心,我参加\n李四: 收到\n王五: 不参加';
  const a = C.analyze(state);
  const by = n => [].concat(...C.CATS.map(c => a.groups[c])).find(g => g.member.name === n);
  const z = by('张三');
  assert.equal(z.via, 'contains');
  assert.equal(z.hit, '不');
  assert.equal(z.category, 'decline');
  assert.ok(z.review.some(r => /昵称里包含姓名/.test(r)));
  assert.ok(z.review.some(r => /不参加/.test(r) && /「不」/.test(r)));
  const l = by('李四');
  assert.equal(l.via, 'exact');
  assert.equal(l.hit, '收到');
  assert.deepEqual(l.review, []);
  assert.ok(by('王五').review.length === 1);
});

test('名单表头:首行「姓名, 备注」被识别为表头,不计入成员并给出提示', () => {
  const x = C.parseRosterEx('姓名, 备注\n张三, 一班\n李四, 二班');
  assert.equal(x.members.length, 2);
  assert.equal(x.members[0].name, '张三');
  assert.deepEqual(x.header, ['姓名', '备注']);
  const only = C.parseRosterEx('姓名\n张三');
  assert.equal(only.members.length, 1);
  assert.deepEqual(only.header, ['姓名']);
  const a = C.analyze(Object.assign(C.createState(), { rosterText: '姓名, 备注\n张三' }));
  assert.equal(a.counts.total, 1);
  assert.deepEqual(a.rosterHeader, ['姓名', '备注']);
});

test('名单表头:不是表头的首行照常当成员(姓名带别名、姓名带真实备注)', () => {
  assert.equal(C.parseRosterEx('张三, 备注\n李四').members.length, 2);
  assert.equal(C.parseRosterEx('姓名=小名\n李四').members.length, 2);
  assert.equal(C.parseRosterEx('姓名, 一班\n李四').members.length, 2);
  assert.equal(C.parseRosterEx('张三\n姓名, 备注').members.length, 2);
  assert.equal(C.parseRosterEx('张三\n姓名, 备注').header, null);
});
