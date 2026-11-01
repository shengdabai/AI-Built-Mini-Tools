'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const students = [
  { id: 's1', name: 'Alice', tz: 'America/New_York' },
  { id: 's2', name: 'Ben', tz: 'Europe/London' },
  { id: 's3', name: 'Chloe', tz: 'Australia/Sydney' },
  { id: 's4', name: 'Dai', tz: 'Asia/Tokyo' }
];
const rules = [
  { id: 'r1', studentId: 's1', weekday: 2, start: '21:00', duration: 60 },
  { id: 'r2', studentId: 's2', weekday: 3, start: '16:00', duration: 45 },
  { id: 'r3', studentId: 's3', weekday: 4, start: '07:30', duration: 60 },
  { id: 'r4', studentId: 's4', weekday: 5, start: '10:00', duration: 30 }
];
const TT = 'Asia/Shanghai';
const build = (ws, ex) => C.withStudentTimes(C.weekSchedule(rules, ex || [], ws, TT), students);

test('localTimeIn: 教师晚间课对美东是同日早些时候,东京同日', () => {
  const r = C.localTimeIn('2026-10-20', '21:00', TT, 'America/New_York');
  assert.deepEqual(r, { date: '2026-10-20', time: '09:00', dayOffset: 0 });
});
test('localTimeIn: 跨日 次日', () => {
  const r = C.localTimeIn('2026-10-20', '22:00', TT, 'Australia/Sydney');
  assert.equal(r.dayOffset, 1);
  assert.equal(r.date, '2026-10-21');
  assert.equal(r.time, '01:00');
});
test('localTimeIn: 跨日 前一日', () => {
  const r = C.localTimeIn('2026-10-20', '02:00', TT, 'Europe/London');
  assert.equal(r.dayOffset, -1);
  assert.equal(r.date, '2026-10-19');
  assert.equal(r.time, '19:00');
});
test('localTimeIn: 夏令时前后同一教师时间,美东目标时间相差一小时', () => {
  const before = C.localTimeIn('2026-10-27', '21:00', TT, 'America/New_York'); // EDT
  const after = C.localTimeIn('2026-11-03', '21:00', TT, 'America/New_York'); // EST
  assert.equal(before.time, '09:00');
  assert.equal(after.time, '08:00');
});
test('localTimeIn: 非法输入抛错', () => {
  assert.throws(() => C.localTimeIn('2026-13-01', '10:00', TT, 'Asia/Tokyo'));
  assert.throws(() => C.localTimeIn('2026-10-01', '25:00', TT, 'Asia/Tokyo'));
  assert.throws(() => C.localTimeIn('2026-10-01', '10:00', TT, 'Mars/Base'));
});
test('dstTransitions: London 2026-10-25 命中,偏移 60 -> 0', () => {
  const t = C.dstTransitions('Europe/London', '2026-10-01', 60);
  assert.equal(t.length, 1);
  assert.equal(t[0].date, '2026-10-25');
  assert.equal(t[0].fromOffset, 60);
  assert.equal(t[0].toOffset, 0);
});
test('dstTransitions: New_York 2026-11-01 命中', () => {
  const t = C.dstTransitions('America/New_York', '2026-10-20', 60);
  assert.deepEqual(t.map((x) => x.date), ['2026-11-01']);
  assert.equal(t[0].deltaMin, -60);
});
test('dstTransitions: Tokyo 无切换;Sydney 10 月初开始夏令时', () => {
  assert.equal(C.dstTransitions('Asia/Tokyo', '2026-01-01', 365).length, 0);
  const s = C.dstTransitions('Australia/Sydney', '2026-09-25', 20);
  assert.deepEqual(s.map((x) => x.date), ['2026-10-04']);
  assert.equal(s[0].deltaMin, 60);
});
test('weekSchedule: 按星期生成日期并按时间排序', () => {
  const s = C.weekSchedule(rules, [], '2026-10-26', TT);
  assert.deepEqual(s.map((x) => x.date), ['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
  assert.equal(s[0].ruleId, 'r1');
});
test('weekSchedule: 例外 取消 与 改时间 覆盖', () => {
  const ex = [
    { id: 'e1', ruleId: 'r1', date: '2026-10-27', type: 'cancel' },
    { id: 'e2', ruleId: 'r2', date: '2026-10-28', type: 'move', start: '18:00', duration: 90 },
    { id: 'e3', ruleId: 'r3', date: '2026-11-05', type: 'cancel' } // 不在本周
  ];
  const s = C.weekSchedule(rules, ex, '2026-10-26', TT);
  const by = (id) => s.find((x) => x.ruleId === id);
  assert.equal(by('r1').status, 'cancelled');
  assert.equal(by('r2').status, 'moved');
  assert.equal(by('r2').start, '18:00');
  assert.equal(by('r2').duration, 90);
  assert.equal(by('r3').status, 'normal');
});
test('switchWarnings: 下周美东学员本地时间变化命中,东京不命中', () => {
  const w = C.switchWarnings(build('2026-10-26'), build('2026-11-02'));
  assert.deepEqual(w.map((x) => x.studentName), ['Alice']);
  assert.match(w[0].from, /09:00/);
  assert.match(w[0].to, /08:00/);
});
test('switchWarnings: 上一周对本周命中 London(10-25 切换);已取消的课不报', () => {
  const w = C.switchWarnings(build('2026-10-26'), build('2026-10-19'));
  assert.ok(w.some((x) => x.studentName === 'Ben'));
  const ex = [{ id: 'e', ruleId: 'r2', date: '2026-10-28', type: 'cancel' }];
  const w2 = C.switchWarnings(build('2026-10-26', ex), build('2026-10-19'));
  assert.ok(!w2.some((x) => x.studentName === 'Ben'));
});
test('toMarkdown: 每位有课的学员一段,含提醒;公式前缀与竖线被处理', () => {
  const sts = students.concat([{ id: 's5', name: '=CMD|x', tz: 'Asia/Tokyo' }]);
  const rs = rules.concat([{ id: 'r5', studentId: 's5', weekday: 1, start: '09:00', duration: 30 }]);
  const lessons = C.withStudentTimes(C.weekSchedule(rs, [], '2026-10-26', TT), sts);
  const w = C.switchWarnings(lessons, C.withStudentTimes(C.weekSchedule(rs, [], '2026-11-02', TT), sts));
  const md = C.toMarkdown(lessons, sts, '2026-10-26', TT, w);
  assert.equal((md.match(/^## /gm) || []).length, 5);
  assert.match(md, /夏令时提醒/);
  assert.match(md, /## '=CMD\\\|x/);
});
test('toIcs: 结构、TZID、本地时间格式、取消的课不输出', () => {
  const ex = [{ id: 'e', ruleId: 'r4', date: '2026-10-30', type: 'cancel' }];
  const ics = C.toIcs(build('2026-10-26', ex), TT, '2026-10-20T08:00:00Z');
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 3);
  assert.equal((ics.match(/END:VEVENT/g) || []).length, 3);
  assert.match(ics, /DTSTART;TZID=Asia\/Shanghai:20261027T210000\r\n/);
  assert.match(ics, /DTEND;TZID=Asia\/Shanghai:20261027T220000\r\n/);
  assert.match(ics, /SUMMARY:课程 Alice/);
  assert.match(ics, /DTSTAMP:20261020T080000Z/);
});
test('toIcs: 跨午夜的课 DTEND 进入次日', () => {
  const rs = [{ id: 'x', studentId: 's1', weekday: 1, start: '23:30', duration: 60 }];
  const l = C.withStudentTimes(C.weekSchedule(rs, [], '2026-10-26', TT), students);
  assert.match(C.toIcs(l, TT), /DTEND;TZID=Asia\/Shanghai:20261027T003000/);
});
const good = () => ({ version: 1, teacherTz: TT, students: students.map((s) => ({ ...s })), rules: rules.map((r) => ({ ...r })), exceptions: [{ id: 'e1', ruleId: 'r1', date: '2026-10-27', type: 'cancel' }] });
test('validateImport: 合法通过;非法时区/重复 id/枚举/引用/格式被整份拒绝', () => {
  assert.equal(C.validateImport(good()).ok, true);
  assert.equal(C.validateImport(JSON.stringify(good())).ok, true);
  let d = good(); d.students[0].tz = 'Mars/Base';
  assert.match(C.validateImport(d).error, /时区/);
  d = good(); d.students[1].id = 's1';
  assert.match(C.validateImport(d).error, /重复/);
  d = good(); d.rules[0].weekday = 8;
  assert.equal(C.validateImport(d).ok, false);
  d = good(); d.rules[0].studentId = 'nope';
  assert.equal(C.validateImport(d).ok, false);
  d = good(); d.exceptions[0].type = 'delete';
  assert.equal(C.validateImport(d).ok, false);
  d = good(); d.rules[0].start = '9:00';
  assert.equal(C.validateImport(d).ok, false);
  d = good(); d.version = 2;
  assert.equal(C.validateImport(d).ok, false);
  assert.equal(C.validateImport('{bad').ok, false);
  assert.equal(C.validateImport([]).ok, false);
});
test('resolveToday: 合法使用,非法与不存在日期回退不抛错', () => {
  assert.equal(C.resolveToday('?today=2026-10-26', '2000-01-01'), '2026-10-26');
  assert.equal(C.resolveToday('?today=2026-02-30', '2000-01-01'), '2000-01-01');
  assert.equal(C.resolveToday('?today=abc', '2000-01-01'), '2000-01-01');
  assert.equal(C.resolveToday('', '2000-01-01'), '2000-01-01');
});
test('空课表与空学员不报错', () => {
  const s = C.weekSchedule([], [], '2026-10-26', TT);
  assert.deepEqual(s, []);
  const l = C.withStudentTimes(s, []);
  assert.deepEqual(C.switchWarnings(l, l), []);
  assert.match(C.toMarkdown(l, [], '2026-10-26', TT, []), /本周没有课/);
  assert.equal((C.toIcs(l, TT).match(/VEVENT/g) || []).length, 0);
});
test('weekStartOf / weekdayOf / tzList', () => {
  assert.equal(C.weekStartOf('2026-10-25'), '2026-10-19'); // 周日归上一周
  assert.equal(C.weekStartOf('2026-10-26'), '2026-10-26');
  assert.equal(C.weekdayOf('2026-11-01'), 7);
  assert.ok(C.tzList().includes('Asia/Tokyo'));
  assert.ok(C.tzList().includes('Asia/Kolkata'));
  assert.ok(C.FALLBACK_TZ.length >= 60 - 1 && C.FALLBACK_TZ.every(C.isValidTz));
});
test('safeCell: 以 = + - @ 开头加单引号,单独 - 与 + 不算', () => {
  assert.equal(C.safeCell('=1+1'), "'=1+1");
  assert.equal(C.safeCell('@a'), "'@a");
  assert.equal(C.safeCell('-2'), "'-2");
  assert.equal(C.safeCell('-'), '-');
  assert.equal(C.safeCell('+'), '+');
});

/* ---- 审核修复 ---- */
test('P0-ID: 导入拒绝含换行或特殊字符的 ID(学员/课节/例外)', () => {
  let d = good(); d.rules[0].id = 'r1\nDESCRIPTION:x';
  assert.match(C.validateImport(d).error, /id/);
  d = good(); d.students[0].id = 's 1';
  assert.equal(C.validateImport(d).ok, false);
  d = good(); d.exceptions[0].id = 'e\r1';
  assert.equal(C.validateImport(d).ok, false);
  d = good(); d.rules[0].id = 'ok_id-1';
  d.exceptions[0].ruleId = 'ok_id-1';
  assert.equal(C.validateImport(d).ok, true);
});
test('P0-ID: toIcs 即使收到恶意 key/姓名/时区也不产生额外属性行', () => {
  const lessons = [{ key: 'r1\r\nDESCRIPTION:evil@2026-10-26', ruleId: 'r1', studentId: 's1', date: '2026-10-26', start: '09:00', duration: 60, status: 'normal', teacherTz: TT, studentName: 'A\r\nDESCRIPTION:evil;x,y\\z' }];
  assert.throws(() => C.toIcs(lessons, 'Asia/Shanghai\r\nX-EVIL:1'));
  const ics = C.toIcs(lessons, 'Asia/Shanghai');
  const lines = ics.split('\r\n');
  assert.ok(!lines.some((l) => l.startsWith('DESCRIPTION') || l.startsWith('X-EVIL')));
  assert.ok(lines.some((l) => l.startsWith('SUMMARY:') && l.includes('\\n') && l.includes('\\;') && l.includes('\\,') && l.includes('\\\\')));
  assert.equal(lines.filter((l) => l.startsWith('UID:')).length, 1);
});
test('P0-结束时间: 纽约 2026-11-01 00:30 开始 180 分钟,结束是 02:30(夏令时结束)', () => {
  const e = C.endLocal('2026-11-01', '00:30', 180, 'America/New_York', 'America/New_York');
  assert.deepEqual(e, { date: '2026-11-01', time: '02:30' });
  const rs = [{ id: 'n', studentId: 's1', weekday: 7, start: '00:30', duration: 180 }];
  const ls = C.withStudentTimes(C.weekSchedule(rs, [], '2026-10-26', 'America/New_York'), students);
  assert.equal(ls[0].localEnd.time, '02:30');
  const ics = C.toIcs(ls, 'America/New_York');
  assert.match(ics, /DTSTART;TZID=America\/New_York:20261101T003000/);
  assert.match(ics, /DTEND;TZID=America\/New_York:20261101T023000/);
});
test('P0-夏令时空洞: 柏林 03-29 02:30 与纽约 03-08 02:30 统一顺延到 03:30', () => {
  const b = C.localTimeIn('2026-03-29', '02:30', 'Europe/Berlin', 'Europe/Berlin');
  assert.deepEqual(b, { date: '2026-03-29', time: '03:30', dayOffset: 0 });
  const n = C.localTimeIn('2026-03-08', '02:30', 'America/New_York', 'America/New_York');
  assert.deepEqual(n, { date: '2026-03-08', time: '03:30', dayOffset: 0 });
  assert.equal(C.localTimeIn('2026-03-29', '01:59', 'Europe/Berlin', 'Europe/Berlin').time, '01:59');
  assert.equal(C.localTimeIn('2026-10-25', '01:30', 'Europe/Berlin', 'Europe/Berlin').time, '01:30'); /* 重叠不受影响 */
});
test('P1-例外: 同一课节同一天多个不同 ID 的例外整份拒绝', () => {
  const d = good();
  d.exceptions.push({ id: 'e2', ruleId: 'r1', date: '2026-10-27', type: 'move', start: '10:00' });
  assert.match(C.validateImport(d).error, /只能有一个例外/);
  d.exceptions[1].date = '2026-11-03';
  assert.equal(C.validateImport(d).ok, true);
});

test('updateStudent: 保留学员 ID 与关联课表,只改姓名与时区', () => {
  const st = { version: 1, teacherTz: 'Asia/Shanghai', students: students.slice(), rules: rules.slice(), exceptions: [] };
  const r = C.updateStudent(st, 's1', { name: '  Alice 2  ', tz: 'Europe/Paris' });
  assert.equal(r.ok, true);
  const s = r.state.students.find((x) => x.id === 's1');
  assert.deepEqual(s, { id: 's1', name: 'Alice 2', tz: 'Europe/Paris' });
  assert.equal(r.state.rules.filter((x) => x.studentId === 's1').length, 1);
  assert.equal(r.state.students.length, 4);
  assert.equal(st.students[0].name, 'Alice', '不改动传入的原状态');
});

test('updateStudent: 空姓名、非法时区、不存在的 ID 被拒绝并指出出错字段', () => {
  const st = { version: 1, teacherTz: 'Asia/Shanghai', students: students.slice(), rules: [], exceptions: [] };
  assert.deepEqual([C.updateStudent(st, 's1', { name: '  ', tz: 'Asia/Tokyo' }).ok, C.updateStudent(st, 's1', { name: '  ', tz: 'Asia/Tokyo' }).field], [false, 'name']);
  assert.equal(C.updateStudent(st, 's1', { name: 'A', tz: 'Mars/Base' }).field, 'tz');
  assert.equal(C.updateStudent(st, 'nope', { name: 'A', tz: 'Asia/Tokyo' }).field, 'id');
  assert.equal(C.updateStudent(st, 's1', { name: 'x'.repeat(61), tz: 'Asia/Tokyo' }).field, 'name');
});

test('updateStudent: 改时区后同一课的学员本地时间随之改变', () => {
  const st = { version: 1, teacherTz: TT, students: students.slice(), rules: rules.slice(), exceptions: [] };
  const before = C.withStudentTimes(C.weekSchedule(st.rules, [], '2026-10-19', TT), st.students).find((l) => l.studentId === 's1');
  const after = C.updateStudent(st, 's1', { name: 'Alice', tz: 'Asia/Tokyo' }).state;
  const l2 = C.withStudentTimes(C.weekSchedule(after.rules, [], '2026-10-19', TT), after.students).find((l) => l.studentId === 's1');
  assert.notEqual(before.local.time, l2.local.time);
});

test('countStudentImpact / countRuleImpact: 删除前统计会一并删除的课节与例外', () => {
  const st = { students, rules, exceptions: [{ id: 'e1', ruleId: 'r1', date: '2026-10-20', type: 'cancel' }, { id: 'e2', ruleId: 'r1', date: '2026-10-27', type: 'cancel' }, { id: 'e3', ruleId: 'r2', date: '2026-10-21', type: 'cancel' }] };
  assert.deepEqual(C.countStudentImpact(st, 's1'), { rules: 1, exceptions: 2 });
  assert.deepEqual(C.countRuleImpact(st, 'r2'), { exceptions: 1 });
  assert.deepEqual(C.countStudentImpact(st, 'zzz'), { rules: 0, exceptions: 0 });
});
