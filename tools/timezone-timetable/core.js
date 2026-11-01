'use strict';
/* 跨时区课表核对 · 纯逻辑(无 DOM)。时区计算全部走 Intl.DateTimeFormat.formatToParts。 */
(function () {
  const FALLBACK_TZ = ['UTC', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Singapore', 'Asia/Bangkok', 'Asia/Jakarta', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Karachi', 'Asia/Manila', 'Asia/Kuala_Lumpur', 'Asia/Ho_Chi_Minh', 'Asia/Jerusalem', 'Asia/Riyadh', 'Europe/London', 'Europe/Dublin', 'Europe/Lisbon', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome', 'Europe/Amsterdam', 'Europe/Zurich', 'Europe/Stockholm', 'Europe/Warsaw', 'Europe/Athens', 'Europe/Istanbul', 'Europe/Moscow', 'Africa/Cairo', 'Africa/Lagos', 'Africa/Johannesburg', 'Africa/Nairobi', 'America/New_York', 'America/Toronto', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Vancouver', 'America/Anchorage', 'America/Mexico_City', 'America/Bogota', 'America/Lima', 'America/Santiago', 'America/Sao_Paulo', 'America/Argentina/Buenos_Aires', 'Pacific/Honolulu', 'Pacific/Auckland', 'Pacific/Fiji', 'Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Perth', 'Australia/Adelaide', 'Atlantic/Reykjavik', 'Atlantic/Azores', 'America/Halifax'];

  const WEEKDAY_NAMES = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

  function isValidISODate(s) {
    if (typeof s !== 'string') return false;
    const m = ISO_RE.exec(s);
    if (!m) return false;
    const y = +m[1], mo = +m[2], d = +m[3];
    const t = new Date(Date.UTC(y, mo - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
  }
  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  function isValidId(s) { return typeof s === 'string' && ID_RE.test(s); }
  function isValidTime(s) { return typeof s === 'string' && TIME_RE.test(s); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function toISO(ms) { const d = new Date(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function isoToUtcMs(iso) { const m = ISO_RE.exec(iso); return Date.UTC(+m[1], +m[2] - 1, +m[3]); }
  function addDays(iso, n) { return toISO(isoToUtcMs(iso) + n * 86400000); }
  function diffDays(aISO, bISO) { return Math.round((isoToUtcMs(bISO) - isoToUtcMs(aISO)) / 86400000); }
  /* 1=周一 … 7=周日 */
  function weekdayOf(iso) { const w = new Date(isoToUtcMs(iso)).getUTCDay(); return w === 0 ? 7 : w; }
  function weekStartOf(iso) { return addDays(iso, 1 - weekdayOf(iso)); }

  function isValidTz(tz) {
    if (typeof tz !== 'string' || !tz || tz.length > 80) return false;
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; }
  }

  const fmtCache = new Map();
  function formatter(tz) {
    let f = fmtCache.get(tz);
    if (!f) {
      f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      fmtCache.set(tz, f);
    }
    return f;
  }
  function partsAt(ms, tz) {
    const o = {};
    for (const p of formatter(tz).formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = +p.value;
    if (o.hour === 24) o.hour = 0;
    return o;
  }
  /* 该时刻 tz 比 UTC 快多少分钟 */
  function offsetMinutes(ms, tz) {
    const p = partsAt(ms, tz);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
  }
  /* 把 tz 的本地日期+时间换成 UTC 毫秒。重叠(秋季回拨)取先出现的一次;
     不存在的本地时间(春季空洞)显式顺延:按空洞前的偏移换算,结果比钟面晚空洞长度(如 02:30 变 03:30) */
  function zonedToUtcMs(dateISO, timeHHMM, tz) {
    const m = ISO_RE.exec(dateISO), t = TIME_RE.exec(timeHHMM);
    const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]);
    const offBefore = offsetMinutes(naive - 86400000, tz);
    const offAfter = offsetMinutes(naive + 86400000, tz);
    const valid = [];
    for (const off of new Set([offBefore, offAfter])) {
      const c = naive - off * 60000;
      if (offsetMinutes(c, tz) === off) valid.push(c);
    }
    if (valid.length) return Math.min.apply(null, valid);
    return naive - offBefore * 60000;
  }
  /* 在 UTC 时间轴上加时长,再换回 tz 的本地日期与时间 */
  function endLocal(dateISO, timeHHMM, durationMin, fromTz, toTz) {
    const ms = zonedToUtcMs(dateISO, timeHHMM, fromTz) + durationMin * 60000;
    const p = partsAt(ms, toTz);
    return { date: p.year + '-' + pad(p.month) + '-' + pad(p.day), time: pad(p.hour) + ':' + pad(p.minute) };
  }
  function localTimeIn(dateISO, timeHHMM, fromTz, toTz) {
    if (!isValidISODate(dateISO) || !isValidTime(timeHHMM)) throw new Error('日期或时间格式不合法');
    if (!isValidTz(fromTz) || !isValidTz(toTz)) throw new Error('时区不合法');
    const ms = zonedToUtcMs(dateISO, timeHHMM, fromTz);
    const p = partsAt(ms, toTz);
    const date = p.year + '-' + pad(p.month) + '-' + pad(p.day);
    return { date, time: pad(p.hour) + ':' + pad(p.minute), dayOffset: diffDays(dateISO, date) };
  }
  function addMinutesLocal(dateISO, timeHHMM, minutes) {
    const total = (+timeHHMM.slice(0, 2)) * 60 + (+timeHHMM.slice(3)) + minutes;
    const dayShift = Math.floor(total / 1440);
    const rest = total - dayShift * 1440;
    return { date: addDays(dateISO, dayShift), time: pad(Math.floor(rest / 60)) + ':' + pad(rest % 60) };
  }

  /* 生成教师时区的一周课节。返回 [{key, ruleId, studentId, date, start, duration, status:'normal'|'moved'|'cancelled'}] */
  function weekSchedule(rules, exceptions, weekStartISO, teacherTz) {
    if (!isValidISODate(weekStartISO)) throw new Error('周起始日期不合法');
    const out = [];
    const exMap = new Map();
    for (const e of exceptions || []) exMap.set(e.ruleId + '|' + e.date, e);
    for (const r of rules || []) {
      const date = addDays(weekStartISO, r.weekday - 1);
      const ex = exMap.get(r.id + '|' + date);
      let start = r.start, duration = r.duration, status = 'normal';
      if (ex && ex.type === 'cancel') status = 'cancelled';
      else if (ex && ex.type === 'move') { start = ex.start || r.start; duration = ex.duration || r.duration; status = 'moved'; }
      out.push({ key: r.id + '@' + date, ruleId: r.id, studentId: r.studentId, date, start, duration, status, teacherTz });
    }
    out.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start) || a.key.localeCompare(b.key));
    return out;
  }
  /* 给每节课附上学员本地时间 */
  function withStudentTimes(schedule, students) {
    const byId = new Map(students.map((s) => [s.id, s]));
    return schedule.map((it) => {
      const st = byId.get(it.studentId);
      const local = st ? localTimeIn(it.date, it.start, it.teacherTz, st.tz) : null;
      const end = local ? endLocal(it.date, it.start, it.duration, it.teacherTz, st.tz) : null;
      return Object.assign({}, it, { studentName: st ? st.name : '(已删除学员)', studentTz: st ? st.tz : '', local, localEnd: end });
    });
  }

  /* 扫描 [fromISO, fromISO+days) 内 tz 的偏移变化。返回 [{date, instant, fromOffset, toOffset, deltaMin}],date 为该时区本地日期 */
  function dstTransitions(tz, fromISO, days) {
    if (!isValidTz(tz) || !isValidISODate(fromISO)) throw new Error('参数不合法');
    const out = [];
    const startMs = isoToUtcMs(fromISO);
    let prev = offsetMinutes(startMs, tz);
    let prevMs = startMs;
    for (let i = 1; i <= days; i++) {
      const ms = startMs + i * 86400000;
      const cur = offsetMinutes(ms, tz);
      if (cur !== prev) {
        let lo = prevMs, hi = ms; /* 二分到分钟,lo 是旧偏移的最后时刻 */
        while (hi - lo > 60000) {
          const mid = Math.floor((lo + hi) / 2 / 60000) * 60000;
          if (mid <= lo) break;
          if (offsetMinutes(mid, tz) === prev) lo = mid; else hi = mid;
        }
        const p = partsAt(hi, tz);
        out.push({ date: p.year + '-' + pad(p.month) + '-' + pad(p.day), instant: hi, fromOffset: prev, toOffset: cur, deltaMin: cur - prev });
      }
      prev = cur; prevMs = ms;
    }
    return out;
  }

  function dayLabel(dayOffset) { return dayOffset === 1 ? '次日' : dayOffset === -1 ? '前一日' : dayOffset > 1 ? '+' + dayOffset + '日' : dayOffset < -1 ? dayOffset + '日' : ''; }
  function fmtLocal(item) {
    const l = item.local;
    const lab = dayLabel(l.dayOffset);
    return WEEKDAY_NAMES[weekdayOf(l.date)] + ' ' + l.time + (lab ? '(' + lab + ')' : '');
  }

  /* 对比两周同一课的学员本地时间(同一 ruleId、教师时间相同、均未取消) */
  function switchWarnings(schedule, otherSchedule) {
    const other = new Map();
    for (const it of otherSchedule || []) other.set(it.ruleId, it);
    const warnings = [];
    for (const it of schedule || []) {
      const o = other.get(it.ruleId);
      if (!o || !it.local || !o.local) continue;
      if (it.status === 'cancelled' || o.status === 'cancelled') continue;
      if (it.start !== o.start) continue;
      const a = it.local, b = o.local;
      if (a.time !== b.time || weekdayOf(a.date) !== weekdayOf(b.date)) {
        warnings.push({ studentId: it.studentId, studentName: it.studentName, ruleId: it.ruleId, tz: it.studentTz, from: fmtLocal(it), to: fmtLocal(o), fromDate: it.date, toDate: o.date });
      }
    }
    return warnings;
  }

  /* 表格单元格:防公式注入 + 转义竖线与换行 */
  function safeCell(v) {
    let s = String(v == null ? '' : v).replace(/[\r\n]+/g, ' ');
    if (/^[=@]/.test(s) || /^[+-]./.test(s)) s = "'" + s;
    return s.replace(/\|/g, '\\|');
  }

  /* 每个学员一段;lessons 为 withStudentTimes 的结果,warnings 为 switchWarnings 合并结果 */
  function toMarkdown(lessons, students, weekStartISO, teacherTz, warnings) {
    const lines = ['# 本周课表对照(' + weekStartISO + ' 至 ' + addDays(weekStartISO, 6) + ')', '', '教师时区:' + safeCell(teacherTz) + '。时间为各自所在时区的本地时间。', ''];
    const groups = new Map();
    for (const l of lessons) { if (!groups.has(l.studentId)) groups.set(l.studentId, []); groups.get(l.studentId).push(l); }
    const warnBy = new Map();
    for (const w of warnings || []) { if (!warnBy.has(w.studentId)) warnBy.set(w.studentId, []); warnBy.get(w.studentId).push(w); }
    let any = false;
    for (const s of students) {
      const ls = groups.get(s.id);
      if (!ls || !ls.length) continue;
      any = true;
      lines.push('## ' + safeCell(s.name) + '(' + safeCell(s.tz) + ')', '');
      for (const w of warnBy.get(s.id) || []) lines.push('> 夏令时提醒:学员本地时间从 ' + w.from + ' 变 ' + w.to + '。', '');
      lines.push('| 教师本地 | 学员本地 | 时长 | 状态 |', '| --- | --- | --- | --- |');
      for (const l of ls) {
        const t = WEEKDAY_NAMES[weekdayOf(l.date)] + ' ' + l.date + ' ' + l.start;
        const st = l.status === 'cancelled' ? '已取消' : l.status === 'moved' ? '已改时间' : '正常';
        lines.push('| ' + safeCell(t) + ' | ' + safeCell(l.local ? fmtLocal(l) + ' ' + l.local.date : '') + ' | ' + l.duration + ' 分钟 | ' + st + ' |');
      }
      lines.push('');
    }
    if (!any) lines.push('本周没有课。', '');
    return lines.join('\n');
  }

  function icsEscape(s) { return String(s).replace(/\r\n|\r/g, '\n').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/[\r\n]+/g, '\\n'); }
  function icsToken(s) { return String(s).replace(/[^A-Za-z0-9_@.\/+-]/g, '_'); }
  function icsLocal(dateISO, time) { return dateISO.replace(/-/g, '') + 'T' + time.replace(':', '') + '00'; }
  /* 教师时区 VEVENT,带 TZID;不含 VTIMEZONE(README 已说明) */
  function toIcs(lessons, teacherTz, stampISO) {
    if (!isValidTz(teacherTz)) throw new Error('教师时区不合法');
    const stamp = icsToken((stampISO || '2026-01-01T00:00:00Z').replace(/[-:]/g, '').replace(/\.\d+/, ''));
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//tz-schedule-check//ZH//', 'CALSCALE:GREGORIAN'];
    for (const l of lessons) {
      if (l.status === 'cancelled') continue;
      const end = endLocal(l.date, l.start, l.duration, teacherTz, teacherTz);
      L.push('BEGIN:VEVENT',
        'UID:' + icsToken(l.key) + '@tz-schedule-check',
        'DTSTAMP:' + stamp,
        'DTSTART;TZID=' + icsToken(teacherTz) + ':' + icsLocal(l.date, l.start),
        'DTEND;TZID=' + icsToken(teacherTz) + ':' + icsLocal(end.date, end.time),
        'SUMMARY:' + icsEscape('课程 ' + l.studentName),
        'END:VEVENT');
    }
    L.push('END:VCALENDAR');
    return L.join('\r\n') + '\r\n';
  }

  function validateImport(json) {
    const fail = (error) => ({ ok: false, error });
    let d = json;
    if (typeof json === 'string') { try { d = JSON.parse(json); } catch (e) { return fail('不是合法的 JSON'); } }
    if (!d || typeof d !== 'object' || Array.isArray(d)) return fail('顶层必须是对象');
    if (d.version !== 1) return fail('version 必须是 1');
    if (!isValidTz(d.teacherTz)) return fail('teacherTz 不是合法的 IANA 时区');
    for (const k of ['students', 'rules', 'exceptions']) if (!Array.isArray(d[k])) return fail(k + ' 必须是数组');
    const sIds = new Set(), rIds = new Set(), eIds = new Set(), pairSeen = new Set();
    for (let i = 0; i < d.students.length; i++) {
      const s = d.students[i];
      if (!s || typeof s !== 'object') return fail('students[' + i + '] 不是对象');
      if (!isValidId(s.id)) return fail('students[' + i + '].id 只能由字母、数字、- 和 _ 组成,长度 1 到 64');
      if (sIds.has(s.id)) return fail('学员 id 重复:' + s.id);
      sIds.add(s.id);
      if (typeof s.name !== 'string' || !s.name.trim() || s.name.length > 60) return fail('students[' + i + '].name 必须是 1 到 60 字的字符串');
      if (!isValidTz(s.tz)) return fail('students[' + i + '].tz 不是合法的 IANA 时区:' + String(s.tz));
    }
    for (let i = 0; i < d.rules.length; i++) {
      const r = d.rules[i];
      if (!r || typeof r !== 'object') return fail('rules[' + i + '] 不是对象');
      if (!isValidId(r.id)) return fail('rules[' + i + '].id 只能由字母、数字、- 和 _ 组成,长度 1 到 64');
      if (rIds.has(r.id)) return fail('课表 id 重复:' + r.id);
      rIds.add(r.id);
      if (!sIds.has(r.studentId)) return fail('rules[' + i + '].studentId 找不到对应学员');
      if (!Number.isInteger(r.weekday) || r.weekday < 1 || r.weekday > 7) return fail('rules[' + i + '].weekday 必须是 1 到 7 的整数');
      if (!isValidTime(r.start)) return fail('rules[' + i + '].start 必须是 HH:MM');
      if (!Number.isInteger(r.duration) || r.duration < 5 || r.duration > 480) return fail('rules[' + i + '].duration 必须是 5 到 480 的整数分钟');
    }
    for (let i = 0; i < d.exceptions.length; i++) {
      const e = d.exceptions[i];
      if (!e || typeof e !== 'object') return fail('exceptions[' + i + '] 不是对象');
      if (!isValidId(e.id)) return fail('exceptions[' + i + '].id 只能由字母、数字、- 和 _ 组成,长度 1 到 64');
      if (eIds.has(e.id)) return fail('例外 id 重复:' + e.id);
      eIds.add(e.id);
      if (!rIds.has(e.ruleId)) return fail('exceptions[' + i + '].ruleId 找不到对应课表');
      if (!isValidISODate(e.date)) return fail('exceptions[' + i + '].date 必须是 YYYY-MM-DD');
      const pairKey = e.ruleId + '|' + e.date;
      if (pairSeen.has(pairKey)) return fail('同一课节同一天只能有一个例外:' + e.ruleId + ' ' + e.date);
      pairSeen.add(pairKey);
      if (e.type !== 'cancel' && e.type !== 'move') return fail('exceptions[' + i + '].type 只能是 cancel 或 move');
      if (e.type === 'move') {
        if (!isValidTime(e.start)) return fail('exceptions[' + i + '].start 必须是 HH:MM');
        if (e.duration !== undefined && (!Number.isInteger(e.duration) || e.duration < 5 || e.duration > 480)) return fail('exceptions[' + i + '].duration 必须是 5 到 480 的整数分钟');
      }
    }
    const data = {
      version: 1, teacherTz: d.teacherTz,
      students: d.students.map((s) => ({ id: s.id, name: s.name.trim(), tz: s.tz })),
      rules: d.rules.map((r) => ({ id: r.id, studentId: r.studentId, weekday: r.weekday, start: r.start, duration: r.duration })),
      exceptions: d.exceptions.map((e) => e.type === 'move' ? { id: e.id, ruleId: e.ruleId, date: e.date, type: 'move', start: e.start, duration: e.duration } : { id: e.id, ruleId: e.ruleId, date: e.date, type: 'cancel' })
    };
    return { ok: true, data };
  }


  /* 编辑学员:只改姓名与时区,保留学员 ID 与关联课节、例外;返回新状态,不改动传入对象 */
  function updateStudent(state, id, patch) {
    const list = (state && Array.isArray(state.students)) ? state.students : [];
    if (!list.some((x) => x.id === id)) return { ok: false, field: 'id', error: '找不到这位学员' };
    const name = patch && typeof patch.name === 'string' ? patch.name.trim() : '';
    if (!name) return { ok: false, field: 'name', error: '请填写姓名' };
    if (name.length > 60) return { ok: false, field: 'name', error: '姓名不能超过 60 个字' };
    if (!isValidTz(patch.tz)) return { ok: false, field: 'tz', error: '时区不合法' };
    const next = Object.assign({}, state, { students: list.map((x) => x.id === id ? { id: x.id, name, tz: patch.tz } : x) });
    return { ok: true, state: next };
  }
  /* 删除前统计会一并删除的关联数据 */
  function countStudentImpact(state, studentId) {
    const ruleIds = new Set((state.rules || []).filter((r) => r.studentId === studentId).map((r) => r.id));
    return { rules: ruleIds.size, exceptions: (state.exceptions || []).filter((e) => ruleIds.has(e.ruleId)).length };
  }
  function countRuleImpact(state, ruleId) {
    return { exceptions: (state.exceptions || []).filter((e) => e.ruleId === ruleId).length };
  }

  function resolveToday(search, realToday) {
    try {
      const v = new URLSearchParams(search || '').get('today');
      if (v && isValidISODate(v)) return v;
    } catch (e) { /* 回退 */ }
    return realToday;
  }
  function tzList() {
    try {
      if (typeof Intl.supportedValuesOf === 'function') {
        const l = Intl.supportedValuesOf('timeZone');
        /* 浏览器返回规范名(如 Asia/Calcutta),并入常用别名(Asia/Kolkata)后去重 */
        if (l && l.length) return Array.from(new Set(l.concat(FALLBACK_TZ.filter(isValidTz)))).sort();
      }
    } catch (e) { /* 回退 */ }
    return FALLBACK_TZ.slice();
  }

  const api = { localTimeIn, weekSchedule, withStudentTimes, dstTransitions, switchWarnings, toMarkdown, toIcs, validateImport, updateStudent, countStudentImpact, countRuleImpact, resolveToday, tzList, safeCell, isValidTz, isValidId, endLocal, zonedToUtcMs, isValidISODate, isValidTime, addDays, weekStartOf, weekdayOf, offsetMinutes, fmtLocal, dayLabel, addMinutesLocal, WEEKDAY_NAMES, FALLBACK_TZ };
  globalThis.TzCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
