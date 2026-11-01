const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

// 假测量函数：每个字符宽 = 字号（接近中文等宽字形）
const measure = (s, size) => s.length * size;

function filled() {
  let s = C.createEmptySchedule();
  const r = C.parseBulk([
    '周一,1,语文,301',
    '周一,2,数学',
    '周二,1,数学,301',
    '周二,2,英语',
    '周三,1,语文'
  ].join('\n'), s);
  return r.schedule;
}

test('默认课表：上午 4 节 + 下午 4 节，周一到周五', () => {
  const s = C.createEmptySchedule();
  assert.equal(s.periods.length, 8);
  assert.deepEqual(s.periods.map(p => p.session), ['am', 'am', 'am', 'am', 'pm', 'pm', 'pm', 'pm']);
  assert.equal(C.visibleDays(s).length, 5);
  assert.equal(C.visibleDays({ ...s, showWeekend: true }).length, 7);
  assert.equal(C.visibleDays({ ...s, showWeekend: true })[6].label, '周日');
});

test('setCell：去首尾空格；课程与教室都为空时删除该格；不修改原对象', () => {
  const s0 = C.createEmptySchedule();
  const s1 = C.setCell(s0, 'mon', 'p1', { course: '  物理 ', room: ' 实验室 ' });
  assert.deepEqual(C.getCell(s1, 'mon', 'p1'), { course: '物理', room: '实验室' });
  assert.equal(C.getCell(s0, 'mon', 'p1'), null, '原对象不应被修改');
  const s2 = C.setCell(s1, 'mon', 'p1', { course: ' ', room: '' });
  assert.equal(C.getCell(s2, 'mon', 'p1'), null);
  assert.throws(() => C.setCell(s0, 'xyz', 'p1', { course: 'a' }), /未知的星期/);
  assert.throws(() => C.setCell(s0, 'mon', 'p99', { course: 'a' }), /未知的节次/);
});

test('parseDay / parsePeriodNumber 识别多种写法，拒绝无效输入', () => {
  assert.equal(C.parseDay('周一'), 0);
  assert.equal(C.parseDay('星期三'), 2);
  assert.equal(C.parseDay('五'), 4);
  assert.equal(C.parseDay('周日'), 6);
  assert.equal(C.parseDay('星期天'), 6);
  assert.equal(C.parseDay('7'), 6);
  assert.equal(C.parseDay('Tue'), 1);
  assert.equal(C.parseDay('周八'), -1);
  assert.equal(C.parseDay(''), -1);
  assert.equal(C.parsePeriodNumber('3'), 3);
  assert.equal(C.parsePeriodNumber('第3节'), 3);
  assert.equal(C.parsePeriodNumber('第十二节'), 12);
  assert.equal(C.parsePeriodNumber('第十一节'), 11);
  assert.ok(Number.isNaN(C.parsePeriodNumber('下午')));
});

test('parseBulk：正确写入、报告逐行错误、周末课自动打开周末', () => {
  const s = C.createEmptySchedule();
  const text = [
    '# 注释行会被跳过',
    '周一，第1节，语文，301',
    '周二\t2\t数学',
    '周八,1,体育',
    '周三,第9节,化学',
    '周四,1',
    '周六,3,兴趣课,礼堂',
    ''
  ].join('\n');
  const r = C.parseBulk(text, s);
  assert.equal(r.applied, 3);
  assert.deepEqual(C.getCell(r.schedule, 'mon', 'p1'), { course: '语文', room: '301' });
  assert.deepEqual(C.getCell(r.schedule, 'tue', 'p2'), { course: '数学', room: '' });
  assert.deepEqual(C.getCell(r.schedule, 'sat', 'p3'), { course: '兴趣课', room: '礼堂' });
  assert.equal(r.schedule.showWeekend, true);
  assert.equal(r.weekendTurnedOn, true);
  assert.deepEqual(r.errors.map(e => e.line), [4, 5, 6]);
  assert.match(r.errors[1].reason, /第 9 节不存在（当前共 8 节）/);
  assert.equal(s.showWeekend, false, '原对象不应被修改');
});

test('颜色分配：同名同色、不同课程不同色、结果确定', () => {
  const s = filled();
  const map = C.assignCourseColors(s, 8);
  assert.deepEqual({ ...map }, { '语文': 0, '数学': 1, '英语': 2 });
  assert.deepEqual(C.assignCourseColors(s, 8), map, '重复调用结果一致');
  const t = C.getTemplate('fresh');
  assert.equal(C.courseColor(s, 'fresh', '语文'), t.palette[0]);
  assert.equal(C.courseColor(s, 'fresh', ' 语文 '), t.palette[0]);
  assert.equal(C.courseColor(s, 'fresh', '不存在'), null);
  // 课程数超过调色板长度时循环复用
  const wrap = C.assignCourseColors(s, 2);
  assert.equal(wrap['英语'], 0);
  assert.throws(() => C.assignCourseColors(s, 0));
});

test('颜色分配：__proto__ / constructor / toString 等特殊课程名是普通键，不读原型链', () => {
  let s = C.createEmptySchedule();
  s = C.setCell(s, 'mon', 'p1', { course: '__proto__' });
  s = C.setCell(s, 'tue', 'p1', { course: 'constructor' });
  s = C.setCell(s, 'wed', 'p1', { course: 'hasOwnProperty' });
  const map = C.assignCourseColors(s, 12);
  assert.ok(Object.prototype.hasOwnProperty.call(map, '__proto__'), '__proto__ 应是自有键');
  assert.equal(C.colorIndex(map, '__proto__'), 0);
  assert.equal(C.colorIndex(map, 'constructor'), 1);
  assert.equal(C.colorIndex(map, 'hasOwnProperty'), 2);
  assert.deepEqual(Object.keys(map), ['__proto__', 'constructor', 'hasOwnProperty']);
  const t = C.getTemplate('midnight');
  assert.equal(C.courseColor(s, 'midnight', '__proto__'), t.palette[0]);
  assert.equal(C.courseColor(s, 'midnight', 'constructor'), t.palette[1]);
  // 未出现的特殊名不能从原型链上读到东西
  assert.equal(C.colorIndex(map, 'toString'), undefined);
  assert.equal(C.courseColor(s, 'midnight', 'toString'), null);
  assert.equal(C.courseColor(C.createEmptySchedule(), 'midnight', '__proto__'), null);
  // 经 JSON 回环后仍可着色
  const back = C.parseScheduleJSON(C.serializeSchedule(s));
  assert.equal(back.ok, true);
  assert.equal(C.getCell(back.schedule, 'mon', 'p1').course, '__proto__');
});

test('模板配置：至少 4 套，id 唯一，调色板颜色合法且每套至少 8 色', () => {
  assert.ok(C.TEMPLATES.length >= 4);
  const ids = new Set(C.TEMPLATES.map(t => t.id));
  assert.equal(ids.size, C.TEMPLATES.length);
  const hex = /^#[0-9A-F]{6}$/i;
  for (const t of C.TEMPLATES) {
    assert.ok(t.palette.length >= 8, t.id);
    for (const p of t.palette) { assert.match(p.fill, hex); assert.match(p.ink, hex); }
    assert.ok(t.weights.title > 0 && t.weights.course > 0);
  }
  assert.equal(C.getTemplate('nope').id, C.TEMPLATES[0].id, '未知模板回退到默认');
});

test('布局：三种尺寸下所有格子都在安全区内、互不重叠；手机网格在锁屏时钟区下方', () => {
  for (const key of Object.keys(C.SIZES)) {
    for (const dayCount of [5, 7]) {
      const sessions = ['am', 'am', 'am', 'am', 'pm', 'pm', 'pm', 'pm'];
      const L = C.computeLayout(key, { dayCount, sessions, gapRatio: 0.08 });
      assert.equal(L.cells.length, dayCount * 8);
      const sx0 = L.safe.x, sy0 = L.safe.y, sx1 = L.safe.x + L.safe.w, sy1 = L.safe.y + L.safe.h;
      for (const c of L.cells) {
        assert.ok(c.x >= sx0 && c.x + c.w <= sx1 + 1, `${key} 横向越界`);
        assert.ok(c.y >= sy0 && c.y + c.h <= sy1 + 1, `${key} 纵向越界`);
        assert.ok(c.w > 0 && c.h > 0);
      }
      // 同一行相邻格子不重叠
      const row0 = L.cells.filter(c => c.row === 0).sort((a, b) => a.x - b.x);
      for (let i = 1; i < row0.length; i++) assert.ok(row0[i].x >= row0[i - 1].x + row0[i - 1].w);
      // 午休带在第 4 节与第 5 节之间
      assert.ok(L.breakBand);
      assert.ok(L.rows[4].y >= L.breakBand.y + L.breakBand.h);
      assert.ok(L.rows[3].y + L.rows[3].h <= L.breakBand.y + 0.001);
      assert.ok(L.grid.y >= L.header.y + L.header.h);
    }
  }
  const phone = C.computeLayout('phone', { dayCount: 5, sessions: ['am', 'pm'] });
  assert.ok(phone.grid.y >= C.SIZES.phone.safe.top + C.SIZES.phone.headerH);
  assert.ok(phone.header.y >= 700, '手机顶部要给锁屏时钟留白');
});

test('布局：节次很少时行高封顶；只有上午时没有午休带；非法参数报错', () => {
  const L = C.computeLayout('desktop', { dayCount: 5, sessions: ['am', 'am'] });
  assert.equal(L.breakBand, null);
  assert.equal(L.rowH, C.SIZES.desktop.maxRowH);
  assert.throws(() => C.computeLayout('watch', { dayCount: 5, sessions: ['am'] }), /未知尺寸/);
  assert.throws(() => C.computeLayout('phone', { dayCount: 0, sessions: ['am'] }));
  assert.throws(() => C.computeLayout('phone', { dayCount: 5, sessions: [] }));
});

test('fitText：短名用最大字号；长名缩字号或换行；极端长名截断且不溢出', () => {
  const short = C.fitText('语文', 200, 100, { maxSize: 48, minSize: 20, maxLines: 2 }, measure);
  assert.equal(short.size, 48);
  assert.deepEqual(short.lines, ['语文']);

  const mid = C.fitText('信息技术', 150, 100, { maxSize: 48, minSize: 20, maxLines: 2 }, measure);
  for (const line of mid.lines) assert.ok(measure(line, mid.size) <= 150);
  assert.ok(mid.lines.length * mid.lineHeight <= 100);
  assert.equal(mid.lines.join(''), '信息技术');
  assert.equal(mid.truncated, false);

  const long = C.fitText('通用技术与综合实践活动拓展课程', 100, 60, { maxSize: 40, minSize: 20, maxLines: 2 }, measure);
  assert.equal(long.truncated, true);
  assert.equal(long.size, 20);
  assert.ok(long.lines.length <= 2);
  for (const line of long.lines) assert.ok(measure(line, long.size) <= 100, '截断后也不能超宽');
  assert.ok(long.lines[long.lines.length - 1].endsWith('…'));

  const empty = C.fitText('   ', 100, 60, {}, measure);
  assert.deepEqual(empty.lines, []);
});

test('fitText：盒子窄于单个字形时不可满足，标记截断且返回行都不超宽', () => {
  // 复现评审用例：每字宽 20，盒宽 1
  const tiny = C.fitText('课程', 1, 60, { maxSize: 20, minSize: 20, maxLines: 2 }, measure);
  assert.equal(tiny.truncated, true);
  for (const line of tiny.lines) assert.ok(measure(line, tiny.size) <= 1, `行「${line}」超宽`);
  // 能放下 1 个字但放不下「字+…」：保留能放下的部分，仍不超宽
  const one = C.fitText('信息技术', 20, 24, { maxSize: 20, minSize: 20, maxLines: 1 }, measure);
  assert.equal(one.truncated, true);
  assert.ok(one.lines.length <= 1);
  for (const line of one.lines) assert.ok(measure(line, one.size) <= 20);
  // 在各种窄宽度下扫一遍：未截断时必然全部放得下
  for (let w = 1; w <= 120; w += 7) {
    const r = C.fitText('通用技术 AP Physics', w, 60, { maxSize: 30, minSize: 16, maxLines: 2 }, measure);
    for (const line of r.lines) assert.ok(measure(line, r.size) <= w, `w=${w} 行「${line}」超宽`);
    if (!r.truncated) assert.equal(r.lines.join('').replace(/\s/g, ''), '通用技术APPhysics');
  }
});

test('headerTexts：纯空白标题回退「本周课表」，纯空白副标题为空', () => {
  const s = { ...C.createEmptySchedule(), title: '   ', subtitle: ' 　 ' };
  assert.deepEqual(C.headerTexts(s), { title: '本周课表', subtitle: '' });
  assert.deepEqual(C.headerTexts({ ...s, title: '  高二课表 ', subtitle: ' 秋季 ' }), { title: '高二课表', subtitle: '秋季' });
  // 回退标题在任何尺寸下都能排出至少一行
  const t = C.headerTexts(s).title;
  const fit = C.fitText(t, 1000, 100, { maxSize: 78, minSize: 43, maxLines: 1 }, measure);
  assert.equal(fit.lines[0], '本周课表');
});

test('hasUserData：隐藏周末格、标题、副标题、节次设置都算用户数据', () => {
  const empty = C.createEmptySchedule();
  assert.equal(C.hasUserData(empty), false);
  assert.equal(C.hasUserData({ ...empty, templateId: 'chalk', sizeKey: 'desktop', showWeekend: true }), false, '外观偏好不算');
  // 周末关闭时的周六课程（filledCount=0，但确实是数据）
  const hiddenSat = C.setCell(empty, 'sat', 'p1', { course: '补课' });
  assert.equal(hiddenSat.showWeekend, false);
  assert.equal(C.filledCount(hiddenSat), 0);
  assert.equal(C.hasUserData(hiddenSat), true);
  assert.equal(C.hasUserData(C.setCell(empty, 'mon', 'p1', { course: '', room: '301' })), true, '只有教室也算');
  assert.equal(C.hasUserData({ ...empty, title: '我的课表' }), true);
  assert.equal(C.hasUserData({ ...empty, title: '   ' }), false);
  assert.equal(C.hasUserData({ ...empty, subtitle: '第一学期' }), true);
  assert.equal(C.hasUserData(C.updatePeriodTime(empty, 'p1', 'start', '07:50')), true, '改了时间');
  assert.equal(C.hasUserData(C.addPeriod(empty, 'pm').schedule), true, '加了节次');
  assert.equal(C.hasUserData(C.removePeriod(empty, 'p8').schedule), true, '删了节次');
  // 导入的 JSON 解析后也能判断
  assert.equal(C.hasUserData(C.parseScheduleJSON(C.serializeSchedule(empty)).schedule), false);
});

test('wrapText：英文单词不被拆开（除非单词本身超宽）', () => {
  const lines = C.wrapText('AP Physics', 7 * 10, 10, measure);
  assert.deepEqual(lines, ['AP', 'Physics']);
  const hard = C.wrapText('Supercalifragilistic', 50, 10, measure);
  for (const l of hard) assert.ok(measure(l, 10) <= 50);
  assert.equal(hard.join(''), 'Supercalifragilistic');
});

test('periodLabelLayout：行高够时显示起止时间，变矮后逐级省略', () => {
  const big = C.periodLabelLayout(150, 140, true, true);
  assert.equal(big.showStart && big.showEnd, true);
  const small = C.periodLabelLayout(60, 140, true, true);
  assert.equal(small.showEnd, false);
  assert.equal(small.showStart, true);
  assert.ok(small.timeSize >= 20, '时间字号有下限');
  const tiny = C.periodLabelLayout(30, 140, true, true);
  assert.equal(tiny.showStart, false);
  const none = C.periodLabelLayout(150, 140, false, false);
  assert.equal(none.showStart, false);
});

test('增删节次与时间：自动推算新节时间、上午插在下午前、删节同时删格子、上限 12 节', () => {
  let s = C.setCell(C.createEmptySchedule(), 'mon', 'p8', { course: '体育' });
  const r = C.addPeriod(s, 'am');
  assert.equal(r.added.id, 'p9');
  assert.equal(r.added.start, '11:50');
  assert.equal(r.added.end, '12:35');
  assert.deepEqual(C.orderedPeriods(r.schedule).map(p => p.id).slice(3, 6), ['p4', 'p9', 'p5']);
  const del = C.removePeriod(s, 'p8');
  assert.equal(del.schedule.periods.length, 7);
  assert.equal(C.getCell(del.schedule, 'mon', 'p8'), null);
  let t = C.createEmptySchedule();
  for (let i = 0; i < 10; i++) t = C.addPeriod(t, 'pm').schedule;
  assert.equal(t.periods.length, C.MAX_PERIODS);
  assert.ok(C.addPeriod(t, 'pm').error);
  let one = C.createEmptySchedule();
  one.periods = one.periods.slice(0, 1);
  assert.ok(C.removePeriod(one, 'p1').error);
  const timed = C.updatePeriodTime(C.createEmptySchedule(), 'p1', 'start', '7:5');
  assert.equal(timed.periods[0].start, '', '非法时间清空');
  assert.equal(C.updatePeriodTime(C.createEmptySchedule(), 'p1', 'start', '7:50').periods[0].start, '07:50');
});

test('文件名带尺寸与日期', () => {
  const d = new Date(2026, 8, 3);
  assert.equal(C.wallpaperFileName('phone', d), '课表壁纸-手机-1170x2532-20260903.png');
  assert.equal(C.wallpaperFileName('desktop', d), '课表壁纸-电脑-2560x1440-20260903.png');
  assert.equal(C.wallpaperFileName('tablet', d), '课表壁纸-平板-2048x2732-20260903.png');
  assert.equal(C.jsonFileName(d), '课表数据-20260903.json');
  assert.throws(() => C.wallpaperFileName('tv', d));
});

test('JSON 导出再导入保持一致；坏文件给出错误而不是抛异常', () => {
  const s = { ...filled(), title: '高二（3）班 课表', subtitle: '第一学期', templateId: 'chalk', sizeKey: 'desktop' };
  const back = C.parseScheduleJSON(C.serializeSchedule(s));
  assert.equal(back.ok, true);
  assert.deepEqual(back.schedule.cells, s.cells);
  assert.equal(back.schedule.templateId, 'chalk');
  assert.equal(back.schedule.sizeKey, 'desktop');
  assert.equal(back.schedule.title, '高二（3）班 课表');

  assert.equal(C.parseScheduleJSON('{不是json').ok, false);
  assert.match(C.parseScheduleJSON('{"periods":[]}').error, /节次/);
  assert.match(C.parseScheduleJSON('[1,2]').error, /课表对象/);
  const dup = C.parseScheduleJSON(JSON.stringify({ periods: [{ id: 'p1' }, { id: 'p1' }] }));
  assert.equal(dup.ok, false);
  // 未知格子键、未知模板被丢弃/回退
  const odd = C.parseScheduleJSON(JSON.stringify({
    periods: [{ id: 'p1', session: 'am', start: '25:00' }],
    cells: { 'mon|p1': { course: '<b>语文</b>' }, 'xxx|p1': { course: '坏' }, 'mon|p7': { course: '坏' } },
    templateId: 'hacker'
  }));
  assert.equal(odd.ok, true);
  assert.deepEqual(Object.keys(odd.schedule.cells), ['mon|p1']);
  assert.equal(odd.schedule.cells['mon|p1'].course, '<b>语文</b>', '原样保存，渲染时由 textContent/canvas 负责不解析');
  assert.equal(odd.schedule.periods[0].start, '');
  assert.equal(odd.schedule.templateId, 'midnight');
});

test('filledCount 只统计可见天、有课程名的格子', () => {
  let s = filled();
  assert.equal(C.filledCount(s), 5);
  s = C.setCell(s, 'sat', 'p1', { course: '补课' });
  assert.equal(C.filledCount(s), 5, '周末未开启时不计入');
  s.showWeekend = true;
  assert.equal(C.filledCount(s), 6);
  s = C.setCell(s, 'fri', 'p1', { course: '', room: '只有教室' });
  assert.equal(C.filledCount(s), 6);
});
