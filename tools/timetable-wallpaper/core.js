/*
 * 课表壁纸生成器 · core.js
 * 纯逻辑，无 DOM：数据模型、批量粘贴解析、颜色分配、壁纸布局计算、文字适配、文件名、JSON 导入导出。
 *
 * TEMPLATES 是「壁纸成品的设计数据」的唯一来源：每套模板的背景、墨色、调色板、字重、圆角、间距比例
 * 都只在这里定义；app.js 的 canvas 绘制只读取这里的值，不自带颜色。
 */
(function () {
  'use strict';

  var APP_ID = 'kebiao-wallpaper';
  var SCHEMA_VERSION = 1;
  var MAX_PERIODS = 12;
  var MAX_COURSE_LEN = 20;
  var MAX_ROOM_LEN = 12;
  var MAX_TITLE_LEN = 30;

  var DAYS = [
    { key: 'mon', label: '周一' },
    { key: 'tue', label: '周二' },
    { key: 'wed', label: '周三' },
    { key: 'thu', label: '周四' },
    { key: 'fri', label: '周五' },
    { key: 'sat', label: '周六' },
    { key: 'sun', label: '周日' }
  ];

  var SESSIONS = { am: '上午', pm: '下午' };

  /* 壁纸字体：与界面同一中文字体栈（本机字体，不联网加载） */
  var WALLPAPER_FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';

  /*
   * 尺寸与安全区（单位：壁纸像素）。
   * 手机 / 平板：顶部 safe.top 给锁屏时钟与小组件留白；底部给手电筒/相机按钮与 Home 指示条留白。
   * 电脑：顶部避开菜单栏，底部避开 Dock。
   */
  var SIZES = {
    phone: {
      key: 'phone', label: '手机', hint: '锁屏', w: 1170, h: 2532,
      safe: { top: 800, right: 64, bottom: 220, left: 64 },
      headerH: 230, dayHeaderH: 84, breakH: 60, timeColRatio: 0.125, minTimeColW: 118,
      maxRowH: 200, titleSize: 78, subtitleSize: 38, lockClock: true
    },
    desktop: {
      key: 'desktop', label: '电脑', hint: '桌面', w: 2560, h: 1440,
      safe: { top: 120, right: 260, bottom: 170, left: 260 },
      headerH: 190, dayHeaderH: 70, breakH: 44, timeColRatio: 0.085, minTimeColW: 150,
      maxRowH: 150, titleSize: 76, subtitleSize: 34, lockClock: false
    },
    tablet: {
      key: 'tablet', label: '平板', hint: '锁屏', w: 2048, h: 2732,
      safe: { top: 760, right: 128, bottom: 200, left: 128 },
      headerH: 250, dayHeaderH: 96, breakH: 64, timeColRatio: 0.1, minTimeColW: 150,
      maxRowH: 230, titleSize: 96, subtitleSize: 44, lockClock: true
    }
  };

  /*
   * 模板：style 决定绘制方式（bar 左侧色条 / tint 浅色填充 / block 纯色块 / chalk 粉笔字）。
   * palette 每项 { fill, ink }：fill 为课程主色，ink 为压在 fill 上（或粉笔风直接写在黑板上）的文字色。
   * radius、gap 是相对于格子短边的比例；tone 表示背景明暗（预览里的锁屏时钟参考据此选色）。
   */
  var TEMPLATES = [
    {
      id: 'midnight', tone: 'dark', name: '深色极简', style: 'bar',
      bg: ['#0C0E12', '#171B23'], ink: '#F2F4F7', subInk: '#8D95A3', line: '#252A34',
      cellFill: '#181C24', emptyFill: '#12151B', breakInk: '#5C6472',
      weights: { title: 300, subtitle: 400, day: 500, course: 600, meta: 400, period: 300 },
      radius: 0.16, gap: 0.08,
      palette: [
        { fill: '#7AA2F7', ink: '#F2F4F7' }, { fill: '#F7768E', ink: '#F2F4F7' },
        { fill: '#9ECE6A', ink: '#F2F4F7' }, { fill: '#E0AF68', ink: '#F2F4F7' },
        { fill: '#7DCFFF', ink: '#F2F4F7' }, { fill: '#FF9E64', ink: '#F2F4F7' },
        { fill: '#73DACA', ink: '#F2F4F7' }, { fill: '#C0A6F0', ink: '#F2F4F7' },
        { fill: '#F5D76E', ink: '#F2F4F7' }, { fill: '#9AA5CE', ink: '#F2F4F7' },
        { fill: '#E8A0BF', ink: '#F2F4F7' }, { fill: '#B4E080', ink: '#F2F4F7' }
      ]
    },
    {
      id: 'fresh', tone: 'light', name: '清爽网格', style: 'tint',
      bg: ['#F3F7FA', '#E6EEF4'], ink: '#15263A', subInk: '#5B6B7D', line: '#CCD7E1',
      cellFill: '#FFFFFF', emptyFill: '#FFFFFF', breakInk: '#7A8898',
      weights: { title: 600, subtitle: 400, day: 600, course: 600, meta: 400, period: 500 },
      radius: 0.1, gap: 0.05,
      palette: [
        { fill: '#DCEBFF', ink: '#174A85' }, { fill: '#FFE0DE', ink: '#962A24' },
        { fill: '#D9F3E1', ink: '#1C6537' }, { fill: '#FFF0C7', ink: '#7A5208' },
        { fill: '#EAE2FF', ink: '#553A93' }, { fill: '#D3F1F4', ink: '#12636B' },
        { fill: '#FFE5D3', ink: '#914012' }, { fill: '#E4EAF0', ink: '#33465B' },
        { fill: '#F9E1F0', ink: '#8A2862' }, { fill: '#E6F2CF', ink: '#4A6214' },
        { fill: '#DDE3FF', ink: '#2F3F8F' }, { fill: '#F5E6DA', ink: '#6E4424' }
      ]
    },
    {
      id: 'blocks', tone: 'dark', name: '撞色色块', style: 'block',
      bg: ['#2336D4', '#1C2DB8'], ink: '#FFFFFF', subInk: '#C9D0FF', line: '#3A4CE4',
      cellFill: '#3446E0', emptyFill: '#2C3ED9', breakInk: '#C9D0FF',
      // 背景装饰圆：大圆用同色系浅一档（不与课程色块撞色），小圆用强调黄
      decor: ['#3A50EC', '#FFD23F'],
      weights: { title: 600, subtitle: 500, day: 600, course: 600, meta: 500, period: 600 },
      radius: 0, gap: 0.06,
      palette: [
        { fill: '#FFD23F', ink: '#111111' }, { fill: '#FF6B4A', ink: '#111111' },
        { fill: '#3DDC97', ink: '#111111' }, { fill: '#FFFFFF', ink: '#111111' },
        { fill: '#FF9EC7', ink: '#111111' }, { fill: '#7FD8FF', ink: '#111111' },
        { fill: '#C6F432', ink: '#111111' }, { fill: '#FFB23F', ink: '#111111' },
        { fill: '#B8B2FF', ink: '#111111' }, { fill: '#9BF0DC', ink: '#111111' },
        { fill: '#FFE8A3', ink: '#111111' }, { fill: '#FF8FA3', ink: '#111111' }
      ]
    },
    {
      id: 'chalk', tone: 'dark', name: '黑板风', style: 'chalk',
      bg: ['#243B31', '#1B2F26'], ink: '#F1F3EC', subInk: '#B9C6BD', line: '#DDE5DA',
      cellFill: '#2A4337', emptyFill: '#243B31', breakInk: '#B9C6BD',
      frame: '#7A5233', frameShade: '#553820', dust: '#FFFFFF',
      weights: { title: 500, subtitle: 400, day: 500, course: 500, meta: 400, period: 400 },
      radius: 0, gap: 0,
      palette: [
        { fill: '#FFF2A1', ink: '#FFF2A1' }, { fill: '#FFC2CF', ink: '#FFC2CF' },
        { fill: '#BDE2FF', ink: '#BDE2FF' }, { fill: '#CDF4C1', ink: '#CDF4C1' },
        { fill: '#FFFFFF', ink: '#FFFFFF' }, { fill: '#FFD49C', ink: '#FFD49C' },
        { fill: '#E4CCFF', ink: '#E4CCFF' }, { fill: '#A6EFE3', ink: '#A6EFE3' },
        { fill: '#FFB3A6', ink: '#FFB3A6' }, { fill: '#E9F59A', ink: '#E9F59A' },
        { fill: '#C9D4FF', ink: '#C9D4FF' }, { fill: '#F5E3C8', ink: '#F5E3C8' }
      ]
    }
  ];

  var DEFAULT_TEMPLATE = 'midnight';
  var DEFAULT_SIZE = 'phone';

  /* ---------- 小工具 ---------- */

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function isTime(v) { return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v); }

  function normalizeTime(v) {
    if (typeof v !== 'string') return '';
    var s = v.trim().replace('：', ':');
    var m = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (!m) return '';
    var t = (m[1].length === 1 ? '0' + m[1] : m[1]) + ':' + m[2];
    return isTime(t) ? t : '';
  }

  function toMinutes(t) { return isTime(t) ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : null; }

  function fromMinutes(n) {
    if (n < 0 || n >= 24 * 60) return '';
    var h = Math.floor(n / 60), m = n % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  function cleanText(v, max) {
    if (typeof v !== 'string') return '';
    return v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
  }

  function dayIndex(key) {
    for (var i = 0; i < DAYS.length; i++) if (DAYS[i].key === key) return i;
    return -1;
  }

  function cellKey(dayKey, periodId) { return dayKey + '|' + periodId; }

  /* ---------- 数据模型 ---------- */

  var DEFAULT_TIMES = [
    ['am', '08:00', '08:45'], ['am', '08:55', '09:40'], ['am', '10:00', '10:45'], ['am', '10:55', '11:40'],
    ['pm', '14:00', '14:45'], ['pm', '14:55', '15:40'], ['pm', '15:50', '16:35'], ['pm', '16:45', '17:30']
  ];

  function createEmptySchedule() {
    return {
      app: APP_ID,
      version: SCHEMA_VERSION,
      title: '',
      subtitle: '',
      showWeekend: false,
      templateId: DEFAULT_TEMPLATE,
      sizeKey: DEFAULT_SIZE,
      periods: DEFAULT_TIMES.map(function (t, i) {
        return { id: 'p' + (i + 1), session: t[0], start: t[1], end: t[2] };
      }),
      cells: {}
    };
  }

  /* 上午在前、下午在后，组内保持原顺序 */
  function orderedPeriods(schedule) {
    var am = [], pm = [];
    schedule.periods.forEach(function (p) { (p.session === 'pm' ? pm : am).push(p); });
    return am.concat(pm);
  }

  function visibleDays(schedule) {
    return DAYS.slice(0, schedule.showWeekend ? 7 : 5);
  }

  function nextPeriodId(schedule) {
    var max = 0;
    schedule.periods.forEach(function (p) {
      var m = /^p(\d+)$/.exec(p.id);
      if (m) max = Math.max(max, Number(m[1]));
    });
    return 'p' + (max + 1);
  }

  function addPeriod(schedule, session) {
    if (session !== 'am' && session !== 'pm') throw new Error('session 只能是 am 或 pm');
    if (schedule.periods.length >= MAX_PERIODS) return { schedule: schedule, added: null, error: '最多 ' + MAX_PERIODS + ' 节' };
    var s = clone(schedule);
    var ordered = orderedPeriods(s);
    var same = ordered.filter(function (p) { return p.session === session; });
    var last = same[same.length - 1];
    var start = '', end = '';
    if (last && isTime(last.end)) {
      start = fromMinutes(toMinutes(last.end) + 10);
      end = start ? fromMinutes(toMinutes(start) + 45) : '';
      if (!end) start = '';
    }
    var p = { id: nextPeriodId(s), session: session, start: start, end: end };
    var am = ordered.filter(function (x) { return x.session === 'am'; });
    var pm = ordered.filter(function (x) { return x.session === 'pm'; });
    if (session === 'am') am.push(p); else pm.push(p);
    s.periods = am.concat(pm);
    return { schedule: s, added: p, error: null };
  }

  function removePeriod(schedule, periodId) {
    if (schedule.periods.length <= 1) return { schedule: schedule, error: '至少保留 1 节' };
    var idx = schedule.periods.findIndex(function (p) { return p.id === periodId; });
    if (idx < 0) return { schedule: schedule, error: '找不到这一节' };
    var s = clone(schedule);
    s.periods.splice(idx, 1);
    Object.keys(s.cells).forEach(function (k) {
      if (k.split('|')[1] === periodId) delete s.cells[k];
    });
    return { schedule: s, error: null };
  }

  function updatePeriodTime(schedule, periodId, field, value) {
    if (field !== 'start' && field !== 'end') throw new Error('field 只能是 start 或 end');
    var s = clone(schedule);
    var p = s.periods.find(function (x) { return x.id === periodId; });
    if (!p) return s;
    p[field] = normalizeTime(value);
    return s;
  }

  function getCell(schedule, dayKey, periodId) {
    return schedule.cells[cellKey(dayKey, periodId)] || null;
  }

  function setCell(schedule, dayKey, periodId, value) {
    if (dayIndex(dayKey) < 0) throw new Error('未知的星期：' + dayKey);
    if (!schedule.periods.some(function (p) { return p.id === periodId; })) throw new Error('未知的节次：' + periodId);
    var s = clone(schedule);
    var course = cleanText(value && value.course, MAX_COURSE_LEN);
    var room = cleanText(value && value.room, MAX_ROOM_LEN);
    var k = cellKey(dayKey, periodId);
    if (!course && !room) delete s.cells[k];
    else s.cells[k] = { course: course, room: room };
    return s;
  }

  function filledCount(schedule) {
    var days = visibleDays(schedule).map(function (d) { return d.key; });
    var ids = schedule.periods.map(function (p) { return p.id; });
    return Object.keys(schedule.cells).filter(function (k) {
      var parts = k.split('|');
      var c = schedule.cells[k];
      return days.indexOf(parts[0]) >= 0 && ids.indexOf(parts[1]) >= 0 && c && c.course;
    }).length;
  }

  /*
   * 是否有值得在覆盖前确认的用户数据：任意格子（含已隐藏的周末格）有课程或教室、
   * 标题 / 副标题非空、节次数量或时间与默认不同。模板与尺寸是外观偏好，载入示例和导入都会保留或自带，不计入。
   * 载入示例、导入 JSON 都用它决定是否先弹确认。
   */
  function hasUserData(schedule) {
    if (!schedule || typeof schedule !== 'object') return false;
    var cells = schedule.cells || {};
    var anyCell = Object.keys(cells).some(function (k) {
      var c = cells[k];
      return !!(c && ((typeof c.course === 'string' && c.course.trim()) || (typeof c.room === 'string' && c.room.trim())));
    });
    if (anyCell) return true;
    if (typeof schedule.title === 'string' && schedule.title.trim()) return true;
    if (typeof schedule.subtitle === 'string' && schedule.subtitle.trim()) return true;
    var def = createEmptySchedule().periods;
    var ps = Array.isArray(schedule.periods) ? schedule.periods : [];
    if (ps.length !== def.length) return true;
    return ps.some(function (p, i) {
      var d = def[i];
      return !p || p.id !== d.id || p.session !== d.session || p.start !== d.start || p.end !== d.end;
    });
  }

  /* 壁纸标题 / 副标题：去首尾空白；标题为空回退「本周课表」，副标题为空则不画 */
  var FALLBACK_TITLE = '本周课表';
  function headerTexts(schedule) {
    var t = schedule && typeof schedule.title === 'string' ? schedule.title.trim() : '';
    var s = schedule && typeof schedule.subtitle === 'string' ? schedule.subtitle.trim() : '';
    return { title: t || FALLBACK_TITLE, subtitle: s };
  }

  /* ---------- 批量粘贴 ---------- */

  var CN_NUM = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };

  function parseCnNumber(s) {
    if (/^\d+$/.test(s)) return Number(s);
    if (!/^[一二三四五六七八九十]+$/.test(s)) return NaN;
    if (s === '十') return 10;
    if (s.length === 1) return CN_NUM[s];
    if (s.length === 2 && s[0] === '十') return 10 + CN_NUM[s[1]];
    if (s.length === 2 && s[1] === '十') return CN_NUM[s[0]] * 10;
    if (s.length === 3 && s[1] === '十') return CN_NUM[s[0]] * 10 + CN_NUM[s[2]];
    return NaN;
  }

  var EN_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

  /* 返回 0..6（周一..周日），无法识别返回 -1 */
  function parseDay(raw) {
    if (typeof raw !== 'string') return -1;
    var s = raw.trim().toLowerCase();
    if (!s) return -1;
    var en = EN_DAYS.indexOf(s.slice(0, 3));
    if (en >= 0 && /^[a-z]+$/.test(s)) return en;
    s = s.replace(/^(星期|礼拜|周)/, '');
    if (s === '日' || s === '天' || s === '七' || s === '7') return 6;
    if (/^[1-6]$/.test(s)) return Number(s) - 1;
    var map = ['一', '二', '三', '四', '五', '六'];
    return map.indexOf(s);
  }

  /* “3” “第3节” “第三节” → 3；无法识别 → NaN */
  function parsePeriodNumber(raw) {
    if (typeof raw !== 'string') return NaN;
    var s = raw.trim().replace(/\s+/g, '');
    var m = /^第?([0-9]+|[一二三四五六七八九十]+)节?$/.exec(s);
    if (!m) return NaN;
    return parseCnNumber(m[1]);
  }

  function parseBulk(text, schedule) {
    var s = clone(schedule);
    var errors = [];
    var applied = 0;
    var weekendTurnedOn = false;
    if (typeof text !== 'string') return { schedule: s, applied: 0, errors: [{ line: 0, text: '', reason: '没有内容' }], weekendTurnedOn: false };
    var ordered = orderedPeriods(s);
    text.split(/\r?\n/).forEach(function (line, i) {
      var raw = line.trim();
      if (!raw || raw.charAt(0) === '#') return;
      var parts = raw.split(/\s*[,，\t;；、]\s*/);
      if (parts.length < 3) {
        errors.push({ line: i + 1, text: raw, reason: '至少需要 周几,第几节,课程 三项' });
        return;
      }
      var d = parseDay(parts[0]);
      if (d < 0) { errors.push({ line: i + 1, text: raw, reason: '看不懂星期「' + parts[0] + '」' }); return; }
      var n = parsePeriodNumber(parts[1]);
      if (!(n >= 1)) { errors.push({ line: i + 1, text: raw, reason: '看不懂节次「' + parts[1] + '」' }); return; }
      if (n > ordered.length) {
        errors.push({ line: i + 1, text: raw, reason: '第 ' + n + ' 节不存在（当前共 ' + ordered.length + ' 节）' });
        return;
      }
      var course = cleanText(parts[2], MAX_COURSE_LEN);
      if (!course) { errors.push({ line: i + 1, text: raw, reason: '课程名为空' }); return; }
      var room = cleanText(parts.slice(3).join(' '), MAX_ROOM_LEN);
      if (d >= 5 && !s.showWeekend) { s.showWeekend = true; weekendTurnedOn = true; }
      s.cells[cellKey(DAYS[d].key, ordered[n - 1].id)] = { course: course, room: room };
      applied++;
    });
    return { schedule: s, applied: applied, errors: errors, weekendTurnedOn: weekendTurnedOn };
  }

  /* ---------- 颜色分配 ---------- */

  /*
   * 确定性分配：按阅读顺序（先节次、后星期）第一次出现的先后给课程编号，编号对调色板取模。
   * 同名课程（去首尾空格后完全相同）永远同色；课程数不超过调色板长度时不同课程必不同色。
   * 返回无原型对象：课程名是任意用户文本，「__proto__」「constructor」「toString」等也必须是普通键。
   * 读取请用 colorIndex()，只认自有属性。
   */
  function assignCourseColors(schedule, paletteSize) {
    if (!(paletteSize > 0)) throw new Error('paletteSize 必须为正数');
    var map = Object.create(null);
    var n = 0;
    var days = visibleDays(schedule);
    orderedPeriods(schedule).forEach(function (p) {
      days.forEach(function (d) {
        var c = schedule.cells[cellKey(d.key, p.id)];
        var name = c && c.course ? c.course.trim() : '';
        if (name && !Object.prototype.hasOwnProperty.call(map, name)) {
          map[name] = n % paletteSize;
          n++;
        }
      });
    });
    return map;
  }

  /* 从 assignCourseColors 的结果里取编号；不存在返回 undefined（不会读到原型链上的东西） */
  function colorIndex(map, courseName) {
    var name = typeof courseName === 'string' ? courseName.trim() : '';
    if (!name || !map || !Object.prototype.hasOwnProperty.call(map, name)) return undefined;
    var idx = map[name];
    return typeof idx === 'number' ? idx : undefined;
  }

  function getTemplate(id) {
    for (var i = 0; i < TEMPLATES.length; i++) if (TEMPLATES[i].id === id) return TEMPLATES[i];
    return TEMPLATES[0];
  }

  function courseColor(schedule, templateId, courseName) {
    var t = getTemplate(templateId);
    var map = assignCourseColors(schedule, t.palette.length);
    var idx = colorIndex(map, courseName);
    return idx === undefined ? null : t.palette[idx];
  }

  /* ---------- 布局 ---------- */

  function computeLayout(sizeKey, opts) {
    var size = SIZES[sizeKey];
    if (!size) throw new Error('未知尺寸：' + sizeKey);
    var dayCount = opts && opts.dayCount;
    var sessions = (opts && opts.sessions) || [];
    var gapRatio = opts && typeof opts.gapRatio === 'number' ? opts.gapRatio : 0.06;
    if (!(dayCount >= 1 && dayCount <= 7)) throw new Error('dayCount 必须在 1..7');
    if (!sessions.length) throw new Error('至少需要 1 节');

    var left = size.safe.left;
    var right = size.w - size.safe.right;
    var top = size.safe.top;
    var bottom = size.h - size.safe.bottom;
    var W = right - left;

    var header = { x: left, y: top, w: W, h: size.headerH };
    var gridTop = top + size.headerH;
    var hasBreak = sessions.indexOf('am') >= 0 && sessions.indexOf('pm') >= 0;
    var breakH = hasBreak ? size.breakH : 0;
    var n = sessions.length;
    var rowH = Math.min(size.maxRowH, (bottom - gridTop - size.dayHeaderH - breakH) / n);
    var gridH = size.dayHeaderH + breakH + rowH * n;

    var timeColW = Math.max(size.minTimeColW, Math.round(W * size.timeColRatio));
    var colW = (W - timeColW) / dayCount;
    var gap = Math.round(Math.min(colW, rowH) * gapRatio);

    var rows = [];
    var y = gridTop + size.dayHeaderH;
    var breakBand = null;
    for (var i = 0; i < n; i++) {
      if (i > 0 && sessions[i] === 'pm' && sessions[i - 1] === 'am') {
        breakBand = { x: left, y: y, w: W, h: breakH };
        y += breakH;
      }
      rows.push({ index: i, y: y, h: rowH, session: sessions[i] });
      y += rowH;
    }

    var cols = [];
    for (var j = 0; j < dayCount; j++) cols.push({ index: j, x: left + timeColW + j * colW, w: colW });

    var cells = [];
    rows.forEach(function (r) {
      cols.forEach(function (c) {
        cells.push({
          row: r.index, col: c.index,
          x: Math.round(c.x + gap / 2), y: Math.round(r.y + gap / 2),
          w: Math.round(c.w - gap), h: Math.round(r.h - gap)
        });
      });
    });

    return {
      width: size.w, height: size.h, size: size,
      safe: { x: left, y: top, w: W, h: bottom - top },
      header: header,
      grid: { x: left, y: gridTop, w: W, h: gridH },
      dayHeader: { y: gridTop, h: size.dayHeaderH },
      timeCol: { x: left, w: timeColW },
      rows: rows, cols: cols, cells: cells,
      breakBand: breakBand, gap: gap, rowH: rowH, colW: colW
    };
  }

  /* ---------- 文字适配 ---------- */

  /* 拆成可断行的片段：中文逐字，连续的拉丁字母/数字作为一个词 */
  function tokenize(text) {
    return text.match(/[A-Za-z0-9.+#\-]+|\s+|./g) || [];
  }

  function wrapText(text, maxW, size, measure) {
    var lines = [];
    var cur = '';
    tokenize(text).forEach(function (tok) {
      if (/^\s+$/.test(tok)) {
        if (cur) cur += ' ';
        return;
      }
      if (measure(cur + tok, size) <= maxW) { cur += tok; return; }
      if (cur.trim()) { lines.push(cur.trim()); cur = ''; }
      if (measure(tok, size) <= maxW) { cur = tok; return; }
      for (var i = 0; i < tok.length; i++) {
        var ch = tok.charAt(i);
        if (cur && measure(cur + ch, size) > maxW) { lines.push(cur); cur = ''; }
        cur += ch;
      }
    });
    if (cur.trim()) lines.push(cur.trim());
    return lines;
  }

  /*
   * 在 maxW × maxH 的盒子里放下 text：从 maxSize 往下缩，直到行数 ≤ maxLines 且总高度放得下。
   * 缩到 minSize 仍放不下时截断最后一行并加省略号（truncated=true）。
   * 返回的每一行宽度都 ≤ maxW：若盒子窄到连单个字形或省略号都放不下（不可满足），
   * 超宽的行被逐字裁短，全都放不下时返回空行数组并标 truncated=true；绘制端另外按格子裁剪兜底。
   * measure(str, size) 返回宽度，由调用方注入（canvas 用 ctx.measureText，测试用假函数）。
   */
  function fitText(text, maxW, maxH, opts, measure) {
    var o = opts || {};
    var maxSize = Math.floor(o.maxSize || 40);
    var minSize = Math.floor(o.minSize || 12);
    var lh = o.lineHeight || 1.2;
    var maxLines = o.maxLines || 2;
    var str = typeof text === 'string' ? text.trim() : '';
    if (!str || maxW <= 0 || maxH <= 0) return { size: minSize, lines: [], lineHeight: minSize * lh, truncated: false };
    if (minSize > maxSize) minSize = maxSize;

    function fits(line, sz) { return measure(line, sz) <= maxW; }

    for (var size = maxSize; size >= minSize; size--) {
      var allowed = Math.min(maxLines, Math.floor(maxH / (size * lh)));
      if (allowed < 1) continue;
      var lines = wrapText(str, maxW, size, measure);
      // wrapText 在单个字形比 maxW 还宽时仍会放进一行，这里必须逐行复核宽度
      if (lines.length <= allowed && lines.every(function (l) { return fits(l, size); })) {
        return { size: size, lines: lines, lineHeight: size * lh, truncated: false };
      }
    }

    var s = minSize;
    var cap = Math.max(1, Math.min(maxLines, Math.floor(maxH / (s * lh))));
    var all = wrapText(str, maxW, s, measure);
    var kept = all.slice(0, cap).map(function (l) {
      while (l.length > 0 && !fits(l, s)) l = l.slice(0, -1);
      return l;
    });
    var last = kept[kept.length - 1] || '';
    while (last.length > 0 && !fits(last + '…', s)) last = last.slice(0, -1);
    kept[kept.length - 1] = fits(last + '…', s) ? last + '…' : last;
    kept = kept.filter(function (l) { return l.length > 0; });
    return { size: s, lines: kept, lineHeight: s * lh, truncated: true };
  }

  /*
   * 时间列：节次数字 + 起止时间，按行高与列宽决定字号与显示几行。
   * 时间字号不低于 minTimeSize（壁纸像素，低于它在手机上就看不清），行高不够时先省略结束时间，再省略开始时间。
   */
  function periodLabelLayout(rowH, colW, hasStart, hasEnd, minTimeSize) {
    var minT = minTimeSize || 20;
    var numSize = Math.floor(Math.min(rowH * 0.34, colW * 0.36));
    var timeSize = Math.max(minT, Math.floor(Math.min(rowH * 0.17, colW * 0.2)));
    var room = rowH * 0.88;
    var need2 = numSize * 1.1 + timeSize * 1.3 * 2;
    var need1 = numSize * 1.1 + timeSize * 1.3;
    var showStart = false, showEnd = false;
    if (hasStart && hasEnd && need2 <= room) { showStart = true; showEnd = true; }
    else if (hasStart && need1 <= room) { showStart = true; }
    return { numSize: numSize, timeSize: timeSize, showStart: showStart, showEnd: showEnd };
  }

  /* ---------- 文件名 ---------- */

  function ymd(date) {
    var d = date instanceof Date && !isNaN(date) ? date : new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return '' + d.getFullYear() + (m < 10 ? '0' : '') + m + (day < 10 ? '0' : '') + day;
  }

  function wallpaperFileName(sizeKey, date) {
    var size = SIZES[sizeKey];
    if (!size) throw new Error('未知尺寸：' + sizeKey);
    return '课表壁纸-' + size.label + '-' + size.w + 'x' + size.h + '-' + ymd(date) + '.png';
  }

  function jsonFileName(date) { return '课表数据-' + ymd(date) + '.json'; }

  /* ---------- JSON 导入导出 ---------- */

  function normalizeSchedule(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('不是课表对象');
    if (!Array.isArray(raw.periods) || raw.periods.length < 1) throw new Error('缺少节次（periods）');
    if (raw.periods.length > MAX_PERIODS) throw new Error('节次超过 ' + MAX_PERIODS + ' 节');
    var seen = {};
    var periods = raw.periods.map(function (p, i) {
      if (!p || typeof p !== 'object') throw new Error('第 ' + (i + 1) + ' 节格式不对');
      var id = typeof p.id === 'string' && /^p\d+$/.test(p.id) ? p.id : null;
      if (!id || seen[id]) throw new Error('第 ' + (i + 1) + ' 节的 id 无效或重复');
      seen[id] = true;
      return {
        id: id,
        session: p.session === 'pm' ? 'pm' : 'am',
        start: normalizeTime(p.start),
        end: normalizeTime(p.end)
      };
    });
    var s = {
      app: APP_ID,
      version: SCHEMA_VERSION,
      title: cleanText(raw.title, MAX_TITLE_LEN),
      subtitle: cleanText(raw.subtitle, MAX_TITLE_LEN),
      showWeekend: raw.showWeekend === true,
      templateId: getTemplate(raw.templateId).id,
      sizeKey: SIZES[raw.sizeKey] ? raw.sizeKey : DEFAULT_SIZE,
      periods: periods,
      cells: {}
    };
    s.periods = orderedPeriods(s);
    var cells = raw.cells && typeof raw.cells === 'object' ? raw.cells : {};
    Object.keys(cells).forEach(function (k) {
      var parts = k.split('|');
      if (parts.length !== 2 || dayIndex(parts[0]) < 0 || !seen[parts[1]]) return;
      var c = cells[k] || {};
      var course = cleanText(c.course, MAX_COURSE_LEN);
      var room = cleanText(c.room, MAX_ROOM_LEN);
      if (course || room) s.cells[k] = { course: course, room: room };
    });
    return s;
  }

  function serializeSchedule(schedule) {
    return JSON.stringify(normalizeSchedule(schedule), null, 2);
  }

  function parseScheduleJSON(text) {
    var raw;
    try { raw = JSON.parse(text); } catch (e) { return { ok: false, error: '文件不是有效的 JSON' }; }
    try { return { ok: true, schedule: normalizeSchedule(raw) }; }
    catch (e) { return { ok: false, error: e.message }; }
  }

  var api = {
    APP_ID: APP_ID, MAX_PERIODS: MAX_PERIODS, DAYS: DAYS, SESSIONS: SESSIONS,
    SIZES: SIZES, TEMPLATES: TEMPLATES, WALLPAPER_FONT: WALLPAPER_FONT,
    createEmptySchedule: createEmptySchedule, orderedPeriods: orderedPeriods, visibleDays: visibleDays,
    addPeriod: addPeriod, removePeriod: removePeriod, updatePeriodTime: updatePeriodTime,
    getCell: getCell, setCell: setCell, filledCount: filledCount, cellKey: cellKey,
    hasUserData: hasUserData, headerTexts: headerTexts, FALLBACK_TITLE: FALLBACK_TITLE,
    parseDay: parseDay, parsePeriodNumber: parsePeriodNumber, parseBulk: parseBulk,
    assignCourseColors: assignCourseColors, colorIndex: colorIndex, getTemplate: getTemplate, courseColor: courseColor,
    computeLayout: computeLayout, wrapText: wrapText, fitText: fitText, periodLabelLayout: periodLabelLayout,
    wallpaperFileName: wallpaperFileName, jsonFileName: jsonFileName,
    normalizeSchedule: normalizeSchedule, serializeSchedule: serializeSchedule, parseScheduleJSON: parseScheduleJSON,
    normalizeTime: normalizeTime
  };

  globalThis.ScheduleWallpaperCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
