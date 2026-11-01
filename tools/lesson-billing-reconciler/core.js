/* 课时账单核对台 · 纯逻辑(无 DOM)。浏览器与 Node 共用。 */
(function () {
  'use strict';

  var STATUSES = ['已上', '学员取消', '教师取消', '缺席'];
  var CURRENCIES = ['CNY', 'USD', 'EUR', 'GBP'];
  var STATUS_ALIASES = {
    '已上': '已上', '上课': '已上', '完成': '已上', '已完成': '已上',
    '学员取消': '学员取消', '学生取消': '学员取消', '取消': '学员取消',
    '教师取消': '教师取消', '老师取消': '教师取消',
    '缺席': '缺席', '旷课': '缺席'
  };
  var DEFAULT_CANCEL_HOURS = 24;

  function pad(n) { return String(n).padStart(2, '0'); }
  function round2(x) { return Math.round((x + Number.EPSILON) * 100) / 100; }
  function isNum(x) { return typeof x === 'number' && Number.isFinite(x); }
  function str(x) { return x == null ? '' : String(x).trim(); }

  function validYmd(y, m, d) {
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  function yearOf(today) {
    var m = /^(\d{4})-\d{2}-\d{2}$/.exec(str(today));
    return m ? Number(m[1]) : new Date().getFullYear();
  }

  /* 支持 2026-10-20 / 2026/10/20 / 10-20(年取 today 的年份) */
  function parseDate(input, today) {
    var s = str(input);
    var y, mo, d, m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/.exec(s);
    if (m) {
      y = Number(m[1]); mo = Number(m[2]); d = Number(m[3]);
    } else {
      m = /^(\d{1,2})[-\/.](\d{1,2})$/.exec(s);
      if (!m) return null;
      y = yearOf(today); mo = Number(m[1]); d = Number(m[2]);
    }
    if (!validYmd(y, mo, d)) return null;
    return y + '-' + pad(mo) + '-' + pad(d);
  }

  function parseTime(input) {
    var m = /^(\d{1,2})[:：](\d{2})$/.exec(str(input));
    if (!m) return null;
    var h = Number(m[1]), mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    return pad(h) + ':' + pad(mi);
  }

  function normStatus(s) {
    var k = str(s);
    return Object.prototype.hasOwnProperty.call(STATUS_ALIASES, k) ? STATUS_ALIASES[k] : null;
  }

  /* 批量粘贴:每行 日期[ 时间] | 学员 | 分钟 | 状态(可省略,默认已上) | 备注(可选) */
  function parseBatch(text, students, today) {
    var known = Object.create(null);
    (students || []).forEach(function (s) { if (s && s.name) known[s.name] = true; });
    var rows = [], errors = [];
    String(text == null ? '' : text).split(/\r?\n/).forEach(function (raw, i) {
      if (!raw.trim()) return;
      var line = i + 1;
      var f = raw.split(/[|｜]/).map(function (x) { return x.trim(); });
      if (f.length < 3) {
        errors.push({ line: line, text: raw, reason: '字段不足,应为「日期 | 学员 | 分钟 | 状态」' });
        return;
      }
      var parts = f[0].split(/[\sT]+/).filter(Boolean);
      var date = parseDate(parts[0], today);
      if (!date) { errors.push({ line: line, text: raw, reason: '日期无法识别:' + f[0] }); return; }
      var time = '';
      if (parts.length > 1) {
        time = parseTime(parts[1]);
        if (!time) { errors.push({ line: line, text: raw, reason: '开始时间无法识别:' + parts[1] }); return; }
      }
      if (!f[1]) { errors.push({ line: line, text: raw, reason: '学员为空' }); return; }
      if (!/^\d+$/.test(f[2]) || Number(f[2]) < 1 || Number(f[2]) > 1440) {
        errors.push({ line: line, text: raw, reason: '分钟须为 1–1440 的整数:' + f[2] });
        return;
      }
      var status = '已上';
      if (f.length > 3 && f[3]) {
        status = normStatus(f[3]);
        if (!status) { errors.push({ line: line, text: raw, reason: '状态无法识别:' + f[3] }); return; }
      }
      rows.push({
        line: line, date: date, time: time, student: f[1], minutes: Number(f[2]),
        status: status, noticeHours: null, note: f.slice(4).join(' | '),
        unknown: !known[f[1]]
      });
    });
    return { rows: rows, errors: errors };
  }

  function cancelHoursOf(student) {
    var v = student ? student.cancelHours : null;
    if (v == null || v === '' || !Number.isFinite(Number(v))) return DEFAULT_CANCEL_HOURS;
    return Number(v);
  }

  /* 单条课的计费判断。hours 是这节课的时长(小时);billable 决定是否计入。 */
  function billable(lesson, student) {
    var mins = Number(lesson && lesson.minutes);
    var hours = Number.isFinite(mins) && mins > 0 ? round2(mins / 60) : 0;
    var status = lesson ? lesson.status : '';
    var n = cancelHoursOf(student);
    if (status === '已上') return { hours: hours, billable: true, reason: '已上课,计费' };
    if (status === '教师取消') return { hours: hours, billable: false, reason: '教师取消,不计费' };
    if (status === '缺席') {
      var billed = !(student && student.absentBilled === false);
      return { hours: hours, billable: billed, reason: billed ? '学员缺席,按规则计费' : '学员缺席,按规则不计费' };
    }
    if (status === '学员取消') {
      var raw = lesson.noticeHours;
      var notice = raw == null || raw === '' || !Number.isFinite(Number(raw)) ? 0 : Number(raw);
      if (notice < n) {
        return { hours: hours, billable: true, reason: '提前 ' + notice + ' 小时取消,不足 ' + n + ' 小时,计费' };
      }
      return { hours: hours, billable: false, reason: '提前 ' + notice + ' 小时取消,达到 ' + n + ' 小时,不计费' };
    }
    return { hours: hours, billable: false, reason: '状态缺失,暂不计费' };
  }

  function ym(date) { return String(date || '').slice(0, 7); }
  function cmpLesson(a, b) {
    var ka = (a.date || '') + ' ' + (a.time || ''), kb = (b.date || '') + ' ' + (b.time || '');
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  }

  /* 对账单:month 为 YYYY-MM。累计口径均截止到该月月底。 */
  function statement(student, lessons, payments, month) {
    if (!student || !student.name) throw new Error('缺少学员');
    if (!/^\d{4}-\d{2}$/.test(str(month))) throw new Error('月份格式应为 YYYY-MM');
    var rate = Number(student.rate) || 0;
    var mine = (lessons || []).filter(function (l) { return l.student === student.name; }).sort(cmpLesson);
    var pkgTotal = Number(student.packageHours) || 0;
    var pkgStart = str(student.packageStart);

    var lines = [], monthHours = 0, monthAmount = 0;
    var cumDue = 0, consumed = 0;
    mine.forEach(function (l) {
      if (!l.date) return;
      var b = billable(l, student);
      var billedHours = b.billable ? b.hours : 0;
      var amount = round2(billedHours * rate);
      // 课包消耗:所有月份的计费课时(不受所选月份限制)
      if (pkgTotal > 0 && (!pkgStart || l.date >= pkgStart)) consumed += billedHours;
      if (ym(l.date) > month) return;
      cumDue += amount;
      if (ym(l.date) === month) {
        monthHours += billedHours;
        monthAmount += amount;
        lines.push({ lesson: l, hours: b.hours, billedHours: billedHours, billable: b.billable, reason: b.reason, amount: amount });
      }
    });

    var cur = student.currency;
    var monthPayments = [], cumPaid = 0, monthPaid = 0, excluded = [];
    (payments || []).forEach(function (p) {
      if (p.student !== student.name || !p.date || ym(p.date) > month) return;
      if (p.currency !== cur) { excluded.push(p); return; }
      var amt = Number(p.amount) || 0;
      cumPaid += amt;
      if (ym(p.date) === month) { monthPaid += amt; monthPayments.push(p); }
    });
    monthPayments.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });

    var perSession = !(pkgTotal > 0);
    return {
      student: student, month: month, currency: cur, rate: rate, lines: lines,
      monthHours: round2(monthHours), monthAmount: round2(monthAmount),
      perSession: perSession, packageTotal: pkgTotal,
      consumed: perSession ? null : round2(consumed),
      balance: perSession ? null : round2(pkgTotal - consumed),
      monthPayments: monthPayments, monthPaid: round2(monthPaid),
      cumDue: round2(cumDue), cumPaid: round2(cumPaid), diff: round2(cumDue - cumPaid),
      excludedPayments: excluded, cancelHours: cancelHoursOf(student),
      absentBilled: !(student.absentBilled === false)
    };
  }

  function startMinutes(l) {
    var d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(l.date || ''), t = /^(\d{2}):(\d{2})$/.exec(l.time || '');
    if (!d || !t) return null;
    return Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2])) / 60000;
  }

  function anomalies(students, lessons, payments) {
    var out = [];
    students = students || []; lessons = lessons || []; payments = payments || [];
    var byName = Object.create(null);
    students.forEach(function (s) { byName[s.name] = s; });

    // 1 重叠
    var groups = Object.create(null);
    lessons.forEach(function (l) {
      var s = startMinutes(l);
      if (s == null || !(Number(l.minutes) > 0)) return;
      (groups[l.student] = groups[l.student] || []).push({ l: l, s: s, e: s + Number(l.minutes) });
    });
    Object.keys(groups).forEach(function (name) {
      var g = groups[name].sort(function (a, b) { return a.s - b.s; });
      for (var i = 0; i < g.length; i++) {
        for (var j = i + 1; j < g.length; j++) {
          if (g[j].s >= g[i].e) break;
          out.push({
            type: 'overlap', level: 'error', student: name, ids: [g[i].l.id, g[j].l.id],
            title: '课时间重叠',
            detail: name + ':' + g[i].l.date + ' ' + g[i].l.time + '(' + g[i].l.minutes + ' 分钟)与 ' +
              g[j].l.date + ' ' + g[j].l.time + '(' + g[j].l.minutes + ' 分钟)相交'
          });
        }
      }
    });

    // 2 课包余额为负
    students.forEach(function (s) {
      var total = Number(s.packageHours) || 0;
      if (!(total > 0)) return;
      var used = 0;
      lessons.forEach(function (l) {
        if (l.student !== s.name) return;
        if (s.packageStart && l.date < s.packageStart) return;
        var b = billable(l, s);
        if (b.billable) used += b.hours;
      });
      var bal = round2(total - used);
      if (bal < 0) {
        out.push({
          type: 'negative_balance', level: 'error', student: s.name, ids: [],
          title: '课包余额为负',
          detail: s.name + ':课包 ' + total + ' 课时,已计费 ' + round2(used) + ' 课时,余额 ' + bal
        });
      }
    });

    // 3 状态缺失
    lessons.forEach(function (l) {
      if (STATUSES.indexOf(l.status) === -1) {
        out.push({
          type: 'missing_status', level: 'warn', student: l.student, ids: [l.id],
          title: '状态缺失',
          detail: l.student + ':' + l.date + ' ' + (l.time || '') + ' 的课没有有效状态,暂不计费'
        });
      }
    });

    // 4 未建档
    var seen = Object.create(null);
    lessons.concat(payments).forEach(function (r) {
      var name = r.student;
      if (!name || byName[name] || seen[name]) return;
      seen[name] = true;
      out.push({
        type: 'unknown_student', level: 'error', student: name, ids: [],
        title: '学员未建档',
        detail: '「' + name + '」出现在课记录或收款里,但没有学员档案,无法计费'
      });
    });

    // 5 收款币种不一致
    payments.forEach(function (p) {
      var s = byName[p.student];
      if (s && p.currency !== s.currency) {
        out.push({
          type: 'currency_mismatch', level: 'error', student: p.student, ids: [p.id],
          title: '收款币种不一致',
          detail: p.student + ':' + p.date + ' 收款 ' + p.amount + ' ' + p.currency + ',学员币种为 ' + s.currency + ',未计入差额'
        });
      }
    });

    return out;
  }

  function mdCell(s) { return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' '); }
  function money(n, cur) { return n.toFixed(2) + ' ' + cur; }

  function toMarkdown(st, opts) {
    var y = st.month.slice(0, 4), m = Number(st.month.slice(5, 7));
    var L = [];
    L.push('# ' + st.student.name + ' ' + y + ' 年 ' + m + ' 月课时对账单');
    L.push('');
    L.push('课时单价:' + money(st.rate, st.currency) + ' / 小时');
    if (opts && opts.sample) { L.push(''); L.push('数据来源:合成示例(虚构学员与金额,不是真实账单)'); }
    L.push('');
    L.push('## 本月课记录');
    L.push('');
    if (st.lines.length === 0) {
      L.push('本月没有课记录。');
    } else {
      L.push('| 日期 | 开始 | 时长(分钟) | 状态 | 计费 | 说明 | 金额(' + st.currency + ') |');
      L.push('| --- | --- | ---: | --- | --- | --- | ---: |');
      st.lines.forEach(function (r) {
        var l = r.lesson;
        L.push('| ' + [l.date, l.time || '-', l.minutes, mdCell(l.status || '未填'), r.billable ? '计费' : '不计费',
          mdCell(r.reason + (l.note ? '(备注:' + l.note + ')' : '')), r.amount.toFixed(2)].join(' | ') + ' |');
      });
    }
    L.push('');
    L.push('## 汇总');
    L.push('');
    L.push('- 本月应计课时:' + st.monthHours.toFixed(2) + ' 小时');
    L.push('- 本月应计金额:' + money(st.monthAmount, st.currency));
    if (st.perSession) {
      L.push('- 课包:按次结算');
    } else {
      L.push('- 课包:总计 ' + st.packageTotal + ' 课时,累计已消耗 ' + st.consumed.toFixed(2) + ' 课时,余额 ' + st.balance.toFixed(2) + ' 课时');
    }
    L.push('- 本月收款:' + money(st.monthPaid, st.currency));
    L.push('- 累计应收:' + money(st.cumDue, st.currency));
    L.push('- 累计已收:' + money(st.cumPaid, st.currency));
    L.push('- 差额(累计应收 − 累计已收):' + money(st.diff, st.currency) + (st.diff > 0 ? ',待收' : st.diff < 0 ? ',多收' : ',已结清'));
    if (st.excludedPayments.length) {
      L.push('- 注意:有 ' + st.excludedPayments.length + ' 笔收款币种与学员币种不一致,未计入累计已收');
    }
    L.push('');
    L.push('## 计费规则说明');
    L.push('');
    L.push('- 计费课时 = 时长分钟 ÷ 60,保留两位小数。');
    L.push('- 已上课:计费。教师取消:不计费。');
    L.push('- 学员取消:提前不足 ' + st.cancelHours + ' 小时(未填按 0 小时)计费;提前达到或超过 ' + st.cancelHours + ' 小时不计费。');
    L.push('- 学员缺席:' + (st.absentBilled ? '计费' : '不计费') + '。');
    L.push('- 累计应收、累计已收统计到本月月底;课包消耗统计所有月份的计费课时。');
    L.push('');
    return L.join('\n');
  }

  function csvCell(v) {
    var s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(lessons, opts) {
    var sample = !!(opts && opts.sample);
    var head = ['日期', '开始时间', '学员', '时长(分钟)', '状态', '取消提前小时数', '备注'];
    if (sample) head.push('数据来源');
    var rows = [head];
    (lessons || []).slice().sort(cmpLesson).forEach(function (l) {
      var r = [l.date, l.time, l.student, l.minutes, l.status, l.noticeHours == null ? '' : l.noticeHours, l.note];
      if (sample) r.push('合成示例');
      rows.push(r);
    });
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\n') + '\n';
  }

  var idSeq = 0;
  function newId(prefix) { idSeq += 1; return prefix + Date.now().toString(36) + idSeq.toString(36); }

  /* 导入校验:通过则返回补齐默认值的数据 */
  function validateImport(input) {
    var errors = [], data = input;
    if (typeof input === 'string') {
      try { data = JSON.parse(input); } catch (e) { return { ok: false, errors: ['不是合法的 JSON'], data: null }; }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, errors: ['顶层必须是对象,含 students / lessons / payments'], data: null };
    }
    ['students', 'lessons', 'payments'].forEach(function (k) {
      if (!Array.isArray(data[k])) errors.push('缺少数组字段:' + k);
    });
    if (errors.length) return { ok: false, errors: errors, data: null };

    var out = { students: [], lessons: [], payments: [], sample: data.sample === true };
    var names = Object.create(null);
    data.students.forEach(function (s, i) {
      var p = 'students[' + i + ']';
      if (!s || typeof s !== 'object') { errors.push(p + ' 不是对象'); return; }
      if (!str(s.name)) errors.push(p + ' 缺少 name');
      if (!isNum(s.rate) || s.rate < 0) errors.push(p + ' rate 须为非负数字');
      if (!str(s.currency)) errors.push(p + ' 缺少 currency');
      if (!isNum(s.packageHours) || s.packageHours < 0) errors.push(p + ' packageHours 须为非负数字');
      if (str(s.name) && names[str(s.name)]) errors.push(p + ' name 重复:' + s.name);
      names[str(s.name)] = true;
      out.students.push({
        name: str(s.name), rate: s.rate, currency: str(s.currency), packageHours: s.packageHours,
        packageStart: str(s.packageStart),
        cancelHours: isNum(s.cancelHours) ? s.cancelHours : DEFAULT_CANCEL_HOURS,
        absentBilled: s.absentBilled !== false
      });
    });
    data.lessons.forEach(function (l, i) {
      var p = 'lessons[' + i + ']';
      if (!l || typeof l !== 'object') { errors.push(p + ' 不是对象'); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(str(l.date)) || !parseDate(l.date)) errors.push(p + ' date 须为 YYYY-MM-DD');
      if (!str(l.student)) errors.push(p + ' 缺少 student');
      if (!isNum(l.minutes) || l.minutes <= 0) errors.push(p + ' minutes 须为正数');
      if (str(l.time) && !parseTime(l.time)) errors.push(p + ' time 须为 HH:MM');
      var st = str(l.status);
      if (st && STATUSES.indexOf(st) === -1) errors.push(p + ' status 不在 ' + STATUSES.join('/') + ' 之内');
      if (l.noticeHours != null && l.noticeHours !== '' && !isNum(l.noticeHours)) errors.push(p + ' noticeHours 须为数字');
      out.lessons.push({
        id: str(l.id) || newId('l'), date: str(l.date), time: parseTime(l.time) || '', student: str(l.student),
        minutes: l.minutes, status: st,
        noticeHours: isNum(l.noticeHours) ? l.noticeHours : null, note: str(l.note)
      });
    });
    data.payments.forEach(function (p0, i) {
      var p = 'payments[' + i + ']';
      if (!p0 || typeof p0 !== 'object') { errors.push(p + ' 不是对象'); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(str(p0.date)) || !parseDate(p0.date)) errors.push(p + ' date 须为 YYYY-MM-DD');
      if (!str(p0.student)) errors.push(p + ' 缺少 student');
      if (!isNum(p0.amount)) errors.push(p + ' amount 须为数字');
      if (!str(p0.currency)) errors.push(p + ' 缺少 currency');
      out.payments.push({
        id: str(p0.id) || newId('p'), date: str(p0.date), student: str(p0.student),
        amount: p0.amount, currency: str(p0.currency), note: str(p0.note)
      });
    });
    [['lessons', out.lessons], ['payments', out.payments]].forEach(function (g) {
      var ids = Object.create(null);
      g[1].forEach(function (r, i) {
        if (ids[r.id]) errors.push(g[0] + '[' + i + '] id 重复:' + r.id);
        ids[r.id] = true;
      });
    });
    if (errors.length) return { ok: false, errors: errors.slice(0, 20), data: null };
    return { ok: true, errors: [], data: out };
  }

  /* ?today=YYYY-MM-DD:格式 + 真实日历校验(拒绝自动进位与短日期)。非法时回退 realToday,fixed=false。 */
  function parseToday(search, realToday) {
    var m = /(?:^|[?&])today=(\d{4}-\d{2}-\d{2})(?:&|$)/.exec(typeof search === 'string' ? search : '');
    if (m) {
      var p = m[1].split('-').map(Number);
      if (validYmd(p[0], p[1], p[2])) return { date: m[1], fixed: true };
    }
    return { date: realToday, fixed: false };
  }

  function describeCounts(d) {
    var x = d || {};
    var n = function (a) { return Array.isArray(a) ? a.length : 0; };
    return n(x.students) + ' 位学员、' + n(x.lessons) + ' 条课记录、' + n(x.payments) + ' 条收款';
  }

  var api = {
    parseToday: parseToday, describeCounts: describeCounts,
    STATUSES: STATUSES, CURRENCIES: CURRENCIES, DEFAULT_CANCEL_HOURS: DEFAULT_CANCEL_HOURS,
    parseDate: parseDate, parseTime: parseTime, parseBatch: parseBatch, billable: billable,
    statement: statement, anomalies: anomalies, toMarkdown: toMarkdown, toCsv: toCsv,
    validateImport: validateImport, newId: newId, round2: round2
  };
  globalThis.BillCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
