'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../core.js');

const TODAY = '2026-10-20';
const alice = { name: '林悦', rate: 200, currency: 'CNY', packageHours: 10, packageStart: '2026-09-01', cancelHours: 24, absentBilled: true };
const bob = { name: 'Ben', rate: 30, currency: 'USD', packageHours: 0, packageStart: '', cancelHours: 12, absentBilled: false };
const L = (o) => Object.assign({ id: 'x' + Math.random(), date: '2026-10-05', time: '10:00', student: '林悦', minutes: 60, status: '已上', noticeHours: null, note: '' }, o);

test('四种状态的计费判断', () => {
  assert.deepEqual(core.billable(L({ status: '已上' }), alice).billable, true);
  assert.equal(core.billable(L({ status: '教师取消' }), alice).billable, false);
  assert.equal(core.billable(L({ status: '缺席' }), alice).billable, true);
  assert.equal(core.billable(L({ status: '缺席' }), bob).billable, false);
  assert.equal(core.billable(L({ status: '学员取消', noticeHours: 3 }), alice).billable, true);
  assert.equal(core.billable(L({ status: '' }), alice).billable, false);
  assert.match(core.billable(L({ status: '' }), alice).reason, /状态缺失/);
});

test('计费课时 = 分钟/60 保留两位小数', () => {
  assert.equal(core.billable(L({ minutes: 50 }), alice).hours, 0.83);
  assert.equal(core.billable(L({ minutes: 90 }), alice).hours, 1.5);
});

test('取消提前小时数边界:恰好等于 N 不计费,差一小时计费,未填视为 0', () => {
  assert.equal(core.billable(L({ status: '学员取消', noticeHours: 24 }), alice).billable, false);
  assert.equal(core.billable(L({ status: '学员取消', noticeHours: 23 }), alice).billable, true);
  assert.equal(core.billable(L({ status: '学员取消', noticeHours: null }), alice).billable, true);
  assert.equal(core.billable(L({ status: '学员取消', noticeHours: 12 }), bob).billable, false);
  assert.equal(core.billable(L({ status: '学员取消', noticeHours: 11 }), bob).billable, true);
});

test('课包余额跨月累计(九月的课也扣)', () => {
  const lessons = [
    L({ date: '2026-09-10', minutes: 120 }),
    L({ date: '2026-10-05', minutes: 60 }),
    L({ date: '2026-11-02', minutes: 60 })
  ];
  const st = core.statement(alice, lessons, [], '2026-10');
  assert.equal(st.consumed, 4); // 所有月份:2 + 1 + 1
  assert.equal(st.balance, 6);
  assert.equal(st.monthHours, 1);
  assert.equal(st.packageTotal, 10);
});

test('课包余额不随所选月份变化(查九月也扣十月的课)', () => {
  const pkg = { name: 'A', rate: 10, currency: 'CNY', packageHours: 10, packageStart: '', cancelHours: 24, absentBilled: true };
  const lessons = [L({ student: 'A', date: '2026-09-10' }), L({ student: 'A', date: '2026-10-10' })];
  assert.equal(core.statement(pkg, lessons, [], '2026-09').balance, 8);
  assert.equal(core.statement(pkg, lessons, [], '2026-10').balance, 8);
  assert.equal(core.statement(pkg, lessons, [], '2026-09').cumDue, 10); // 累计应收仍只到所选月底
});

test('导入拒绝课记录与收款的重复 ID', () => {
  const base = { students: [], lessons: [], payments: [] };
  const l = (id, d) => ({ id, date: d, student: 'A', minutes: 60, status: '已上' });
  const p = (id) => ({ id, date: '2026-10-01', student: 'A', amount: 1, currency: 'CNY' });
  const r1 = core.validateImport(Object.assign({}, base, { lessons: [l('x', '2026-10-01'), l('x', '2026-10-02')] }));
  assert.equal(r1.ok, false);
  assert.ok(r1.errors.some((e) => /id 重复/.test(e)));
  const r2 = core.validateImport(Object.assign({}, base, { payments: [p('y'), p('y')] }));
  assert.equal(r2.ok, false);
  assert.equal(core.validateImport(Object.assign({}, base, { lessons: [l('x', '2026-10-01'), l('z', '2026-10-02')], payments: [p('x')] })).ok, true);
});

test('学员名为 __proto__ / constructor 不会抛错也不串数据', () => {
  const mk = (name) => ({ name, rate: 1, currency: 'CNY', packageHours: 0, packageStart: '', cancelHours: 24, absentBilled: true });
  const students = [mk('__proto__'), mk('constructor')];
  const lessons = [
    L({ id: 'a', student: '__proto__', time: '10:00' }), L({ id: 'b', student: '__proto__', time: '10:30' }),
    L({ id: 'c', student: 'constructor', time: '10:00' }), L({ id: 'd', student: 'toString' })
  ];
  const an = core.anomalies(students, lessons, []);
  assert.equal(an.filter((x) => x.type === 'overlap').length, 1);
  assert.equal(an.filter((x) => x.type === 'unknown_student').map((x) => x.student).join(), 'toString');
  assert.equal(core.parseBatch('10-01 | __proto__ | 60', students, TODAY).rows[0].unknown, false);
  assert.equal(core.validateImport({ students: students.map((s) => ({ name: s.name, rate: 1, currency: 'CNY', packageHours: 0 })), lessons: [], payments: [] }).ok, true);
});

test('按次结算:课包为 0 不显示余额', () => {
  const st = core.statement(bob, [L({ student: 'Ben' })], [], '2026-10');
  assert.equal(st.perSession, true);
  assert.equal(st.balance, null);
  assert.match(core.toMarkdown(st), /按次结算/);
});

test('重叠检测:相交算重叠,相邻不算,不同学员不算', () => {
  const a = L({ id: 'a', time: '10:00', minutes: 60 });
  const adjacent = L({ id: 'b', time: '11:00', minutes: 60 });
  const crossing = L({ id: 'c', time: '10:30', minutes: 60 });
  const other = L({ id: 'd', student: 'Ben', time: '10:30', minutes: 60 });
  const none = core.anomalies([alice, bob], [a, adjacent, other], []).filter((x) => x.type === 'overlap');
  assert.equal(none.length, 0);
  const some = core.anomalies([alice, bob], [a, crossing], []).filter((x) => x.type === 'overlap');
  assert.equal(some.length, 1);
  assert.deepEqual(some[0].ids.sort(), ['a', 'c']);
});

test('月份过滤含月初月末,不含相邻月', () => {
  const lessons = [
    L({ date: '2026-09-30' }), L({ date: '2026-10-01' }), L({ date: '2026-10-31' }), L({ date: '2026-11-01' })
  ];
  const st = core.statement(alice, lessons, [], '2026-10');
  assert.deepEqual(st.lines.map((r) => r.lesson.date), ['2026-10-01', '2026-10-31']);
  assert.equal(st.cumDue, 600); // 9-30、10-01、10-31 三节,11-01 不计
});

test('差额 = 累计应收 − 累计已收,收款只算同币种', () => {
  const lessons = [L({ date: '2026-09-10', minutes: 60 }), L({ date: '2026-10-05', minutes: 90 })];
  const pays = [
    { id: 'p1', date: '2026-09-12', student: '林悦', amount: 200, currency: 'CNY', note: '' },
    { id: 'p2', date: '2026-10-08', student: '林悦', amount: 100, currency: 'CNY', note: '' },
    { id: 'p3', date: '2026-10-09', student: '林悦', amount: 999, currency: 'USD', note: '' },
    { id: 'p4', date: '2026-11-09', student: '林悦', amount: 50, currency: 'CNY', note: '' }
  ];
  const st = core.statement(alice, lessons, pays, '2026-10');
  assert.equal(st.cumDue, 500);
  assert.equal(st.cumPaid, 300);
  assert.equal(st.diff, 200);
  assert.equal(st.monthPaid, 100);
  assert.equal(st.excludedPayments.length, 1);
});

test('批量解析:全角分隔、默认状态、MM-DD、错误行', () => {
  const text = [
    '2026-10-20 14:30 | 林悦 | 60 | 已上',
    '10-21｜Ben｜45｜学员取消',
    '2026/10/22 | 林悦 | 30',
    '',
    '2026-13-40 | 林悦 | 60 | 已上',
    '2026-10-23 | 林悦 | abc | 已上',
    '2026-10-24 | 林悦 | 60 | 睡过头',
    '只有一段'
  ].join('\n');
  const r = core.parseBatch(text, [alice], TODAY);
  assert.equal(r.rows.length, 3);
  assert.equal(r.rows[0].time, '14:30');
  assert.equal(r.rows[1].date, '2026-10-21');
  assert.equal(r.rows[1].unknown, true);
  assert.equal(r.rows[2].status, '已上');
  assert.deepEqual(r.errors.map((e) => e.line), [5, 6, 7, 8]);
});

test('日期解析:三种格式与非法日期', () => {
  assert.equal(core.parseDate('2026-10-20'), '2026-10-20');
  assert.equal(core.parseDate('2026/1/2'), '2026-01-02');
  assert.equal(core.parseDate('10-20', '2025-01-01'), '2025-10-20');
  assert.equal(core.parseDate('02-30', TODAY), null);
  assert.equal(core.parseDate('明天', TODAY), null);
});

test('币种不一致异常', () => {
  const pays = [{ id: 'p1', date: '2026-10-08', student: 'Ben', amount: 100, currency: 'CNY', note: '' }];
  const a = core.anomalies([alice, bob], [], pays).filter((x) => x.type === 'currency_mismatch');
  assert.equal(a.length, 1);
  assert.equal(a[0].student, 'Ben');
});

test('未建档学员异常(课记录与收款各出现一次只报一次)', () => {
  const lessons = [L({ student: '小王' }), L({ student: '小王', date: '2026-10-06' })];
  const pays = [{ id: 'p1', date: '2026-10-08', student: '小王', amount: 1, currency: 'CNY', note: '' }];
  const a = core.anomalies([alice], lessons, pays).filter((x) => x.type === 'unknown_student');
  assert.equal(a.length, 1);
  assert.equal(a[0].student, '小王');
});

test('课包余额为负与状态缺失异常', () => {
  const lessons = [L({ minutes: 600 }), L({ date: '2026-10-06', minutes: 120 }), L({ date: '2026-10-07', status: '' })];
  const types = core.anomalies([alice], lessons, []).map((x) => x.type);
  assert.ok(types.includes('negative_balance'));
  assert.ok(types.includes('missing_status'));
});

test('导入校验:拒绝缺字段,接受完整数据并补默认值', () => {
  assert.equal(core.validateImport({ students: [], lessons: [] }).ok, false);
  assert.equal(core.validateImport('不是 json').ok, false);
  const bad = core.validateImport({ students: [{ name: 'A', currency: 'CNY' }], lessons: [{ date: '2026-10-01', student: 'A' }], payments: [] });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /rate/.test(e)));
  assert.ok(bad.errors.some((e) => /minutes/.test(e)));
  const good = core.validateImport({
    students: [{ name: 'A', rate: 10, currency: 'CNY', packageHours: 0 }],
    lessons: [{ date: '2026-10-01', student: 'A', minutes: 60, status: '已上' }],
    payments: []
  });
  assert.equal(good.ok, true);
  assert.equal(good.data.students[0].cancelHours, 24);
  assert.ok(good.data.lessons[0].id);
});

test('Markdown 含规则说明与汇总', () => {
  const lessons = [L({ status: '学员取消', noticeHours: 3, note: 'a|b' })];
  const md = core.toMarkdown(core.statement(alice, lessons, [], '2026-10'));
  assert.match(md, /计费规则说明/);
  assert.match(md, /不足 24 小时/);
  assert.match(md, /差额/);
  assert.match(md, /a\\\|b/);
});

test('CSV:引号转义、公式前缀防护、表头', () => {
  const csv = core.toCsv([L({ note: '说"好", 谢谢' }), L({ date: '2026-10-06', note: '=1+1' })]);
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], '日期,开始时间,学员,时长(分钟),状态,取消提前小时数,备注');
  assert.match(lines[1], /"说""好"", 谢谢"$/);
  assert.match(lines[2], /'=1\+1$/);
});

test('parseToday:只认 YYYY-MM-DD 真实日期,进位日期与短日期回退', () => {
  assert.deepEqual(core.parseToday('?today=2026-10-20', '2026-01-01'), { date: '2026-10-20', fixed: true });
  assert.deepEqual(core.parseToday('?a=1&today=2026-12-31', '2026-01-01'), { date: '2026-12-31', fixed: true });
  assert.deepEqual(core.parseToday('?today=2026-02-30', '2026-01-01'), { date: '2026-01-01', fixed: false });
  assert.deepEqual(core.parseToday('?today=10-20', '2026-01-01'), { date: '2026-01-01', fixed: false });
  assert.deepEqual(core.parseToday('', '2026-01-01'), { date: '2026-01-01', fixed: false });
});

test('合成示例标记:validateImport 保留 sample,Markdown 与 CSV 导出带来源标注', () => {
  const base = { students: [alice], lessons: [], payments: [] };
  assert.equal(core.validateImport(Object.assign({ sample: true }, base)).data.sample, true);
  assert.equal(core.validateImport(base).data.sample, false);
  const st = core.statement(alice, [L({})], [], '2026-10');
  assert.match(core.toMarkdown(st, { sample: true }), /数据来源:合成示例/);
  assert.doesNotMatch(core.toMarkdown(st), /合成示例/);
  const csv = core.toCsv([L({})], { sample: true });
  assert.ok(csv.split('\n')[0].endsWith(',数据来源'));
  assert.ok(csv.split('\n')[1].endsWith(',合成示例'));
  assert.ok(!core.toCsv([L({})]).split('\n')[0].includes('数据来源'));
});

test('describeCounts:替换确认文案里的数量', () => {
  assert.equal(core.describeCounts({ students: [1, 2], lessons: [1], payments: [] }), '2 位学员、1 条课记录、0 条收款');
  assert.equal(core.describeCounts(null), '0 位学员、0 条课记录、0 条收款');
});

test('Markdown 对账单写明课包与累计的截止范围', () => {
  const st = core.statement(alice, [L({})], [], '2026-10');
  const md = core.toMarkdown(st);
  assert.match(md, /课包消耗统计.*所有月份/);
  assert.match(md, /累计应收、累计已收统计到本月月底/);
});
