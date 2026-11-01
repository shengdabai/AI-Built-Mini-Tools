/* 课时账单核对台 · 界面与交互。所有用户输入通过 textContent 渲染,不拼接 innerHTML。 */
(function () {
  'use strict';

  var C = globalThis.BillCore;
  var STORAGE_KEY = 'billcheck.v1';

  function pad(n) { return String(n).padStart(2, '0'); }
  function localToday() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  var TODAY_INFO = C.parseToday(location.search, localToday());
  var TODAY = TODAY_INFO.date;

  var state = load();
  var ui = {
    view: 'statement', stStudent: '', stMonth: TODAY.slice(0, 7), lessonMonth: '',
    editingStudent: null, md: '', suppressNext: false,
    del: null, focusFn: null, pending: null
  };

  /* ---------- 存储 ---------- */
  function empty() { return { students: [], lessons: [], payments: [], sample: false }; }
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return empty();
      var v = C.validateImport(raw);
      return v.ok ? v.data : empty();
    } catch (e) { return empty(); }
  }
  /* 返回是否真正写入;失败时显示持续可见的「未保存」提示,并让紧随其后的成功提示不出现 */
  function save() {
    var ok = true;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { ok = false; }
    var w = document.getElementById('save-warning');
    if (w) w.hidden = ok;
    ui.suppressNext = !ok;
    return ok;
  }

  /* ---------- DOM 小工具 ---------- */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, children) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    (children || []).forEach(function (c) {
      if (c == null) return;
      n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function money(n) { return Number(n).toFixed(2); }
  function btn(label, cls, onClick) {
    var b = el('button', 'btn ' + cls, [label]);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  var flashTimer = null;
  function flash(msg, kind) {
    if (ui.suppressNext) { ui.suppressNext = false; return; }
    var n = $('flash');
    n.className = 'notice' + (kind ? ' notice--' + kind : '');
    n.textContent = msg;
    n.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { n.hidden = true; }, 6000);
  }

  /* 通用表格:columns = [{label, num, cell(row) -> 文本或节点}];窄屏由 CSS 用 data-label 堆叠 */
  function table(columns, rows, foot) {
    var wrap = el('div', 'table-wrap');
    var t = el('table', 'data-table');
    var head = el('tr');
    columns.forEach(function (c) {
      var th = el('th', c.num ? 'num' : '', [c.label]);
      th.scope = 'col';
      head.appendChild(th);
    });
    t.appendChild(el('thead', '', [head]));
    var body = el('tbody');
    rows.forEach(function (r) {
      var tr = el('tr', r.muted ? 'is-muted' : '');
      columns.forEach(function (c) {
        var td = el('td', c.num ? 'num' : '', [c.cell(r.data)]);
        td.setAttribute('data-label', c.label);
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    t.appendChild(body);
    if (foot) t.appendChild(foot);
    wrap.appendChild(t);
    return wrap;
  }
  /* 删除:先在该行旁页内确认;确认前数据与统计不变。kind:lesson / student / payment */
  function attrList(attr, prefix) {
    return Array.prototype.filter.call(document.querySelectorAll('[' + attr + ']'), function (n) { return n.getAttribute(attr).indexOf(prefix) === 0; });
  }
  function attrOne(attr, key) {
    return attrList(attr, key).filter(function (n) { return n.getAttribute(attr) === key; })[0] || null;
  }
  function delCell(kind, id, summary, extra, doDelete) {
    var key = kind + ':' + id;
    if (ui.del === key) {
      var box = el('div', 'confirm-inline', [el('p', 'confirm-inline__text', ['确认删除' + summary + '?' + extra])]);
      var row = el('div', 'row');
      var yes = btn('确认删除', 'btn--danger btn--small', function () {
        var idx = attrList('data-del-no', kind + ':').indexOf(attrOne('data-del-no', key));
        ui.del = null;
        ui.focusFn = function () {
          var rest = attrList('data-del', kind + ':');
          if (rest.length) rest[Math.max(0, Math.min(idx, rest.length - 1))].focus();
          else { var t = document.querySelector('.tab[data-view="' + (kind === 'student' ? 'students' : kind === 'lesson' ? 'lessons' : 'payments') + '"]'); if (t) t.focus(); }
        };
        doDelete();
      });
      var no = btn('取消', 'btn--secondary btn--small', function () {
        ui.del = null;
        ui.focusFn = function () { var b = attrOne('data-del', key); if (b) b.focus(); };
        renderAll();
      });
      no.setAttribute('data-del-no', key);
      row.appendChild(yes); row.appendChild(no); box.appendChild(row);
      return box;
    }
    var b = btn('删除', 'btn--danger-ghost btn--small', function () {
      ui.del = key;
      ui.focusFn = function () { var n = attrOne('data-del-no', key); if (n) n.focus(); };
      renderAll();
    });
    b.setAttribute('data-del', key);
    b.setAttribute('aria-label', '删除' + summary);
    return b;
  }

  function tag(text, cls) { return el('span', 'tag tag--' + cls, [text]); }

  /* ---------- 视图切换 ---------- */
  function setView(name) {
    ui.view = name;
    document.querySelectorAll('.tab').forEach(function (t) {
      if (t.getAttribute('data-view') === name) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    document.querySelectorAll('.view').forEach(function (v) { v.hidden = v.id !== 'view-' + name; });
  }

  function isEmptyState() { return state.students.length === 0; }

  function studentByName(name) {
    for (var i = 0; i < state.students.length; i++) if (state.students[i].name === name) return state.students[i];
    return null;
  }

  /* ---------- 渲染 ---------- */
  function renderAll() {
    renderOptions();
    renderStatement();
    renderLessons();
    renderStudents();
    renderPayments();
    renderAnomalies();
    renderBatchPreview();
    $('sample-badge').hidden = !state.sample;
    if (ui.focusFn) { var f = ui.focusFn; ui.focusFn = null; f(); }
  }

  function renderOptions() {
    var dl = $('student-list');
    clear(dl);
    state.students.forEach(function (s) {
      var o = document.createElement('option');
      o.value = s.name;
      dl.appendChild(o);
    });
  }

  function fillSelect(sel, items, selected) {
    clear(sel);
    items.forEach(function (it) {
      var o = document.createElement('option');
      o.value = it.value;
      o.textContent = it.label;
      sel.appendChild(o);
    });
    if (selected != null) sel.value = selected;
  }

  function renderStatement() {
    var noData = isEmptyState();
    $('empty-guide').hidden = !noData;
    $('statement-body').hidden = noData;
    if (noData) return;

    var names = state.students.map(function (s) { return { value: s.name, label: s.name }; });
    if (!studentByName(ui.stStudent)) ui.stStudent = state.students[0].name;
    fillSelect($('st-student'), names, ui.stStudent);
    $('st-month').value = ui.stMonth;

    var an = C.anomalies(state.students, state.lessons, state.payments);
    var banner = $('anomaly-banner');
    banner.hidden = an.length === 0;
    $('anomaly-banner-text').textContent = '全局有 ' + an.length + ' 项异常,对账前建议先处理。';

    var out = $('statement-out');
    clear(out);
    if (!/^\d{4}-\d{2}$/.test(ui.stMonth)) {
      out.appendChild(el('p', 'empty', ['请选择月份。']));
      return;
    }
    var st = C.statement(studentByName(ui.stStudent), state.lessons, state.payments, ui.stMonth);
    var cur = st.currency;

    var grid = el('div', 'stat-grid');
    grid.appendChild(el('div', 'stat', [
      el('span', 'stat__label', ['本月应计课时']),
      el('span', 'stat__value', [money(st.monthHours) + ' 小时']),
      el('span', 'stat__note', ['单价 ' + money(st.rate) + ' ' + cur + ' / 小时'])
    ]));
    grid.appendChild(el('div', 'stat', [
      el('span', 'stat__label', ['本月应计金额']),
      el('span', 'stat__value', [money(st.monthAmount) + ' ' + cur]),
      el('span', 'stat__note', ['本月收款 ' + money(st.monthPaid) + ' ' + cur])
    ]));
    var pkg = el('div', 'stat' + (!st.perSession && st.balance < 0 ? ' stat--alert' : ''));
    pkg.appendChild(el('span', 'stat__label', ['课包余额']));
    if (st.perSession) {
      pkg.appendChild(el('span', 'stat__value', ['按次结算']));
      pkg.appendChild(el('span', 'stat__note', ['该学员没有课包']));
    } else {
      pkg.appendChild(el('span', 'stat__value', [money(st.balance) + ' 课时']));
      pkg.appendChild(el('span', 'stat__note', ['总计 ' + st.packageTotal + ' 课时,累计已消耗 ' + money(st.consumed) + ' 课时。统计' + (st.student.packageStart ? '课包开始日 ' + st.student.packageStart + ' 起' : '') + '全部已录入的课程,不受所选月份影响。']));
    }
    grid.appendChild(pkg);
    grid.appendChild(el('div', 'stat ' + (st.diff > 0 ? 'stat--alert' : 'stat--ok'), [
      el('span', 'stat__label', ['差额(累计应收 − 累计已收)']),
      el('span', 'stat__value', [money(st.diff) + ' ' + cur]),
      el('span', 'stat__note', ['累计应收 ' + money(st.cumDue) + ',累计已收 ' + money(st.cumPaid) + (st.diff > 0 ? ',待收' : st.diff < 0 ? ',多收' : ',已结清') + '。累计至 ' + st.month + ' 月底,只计与学员币种相同的收款。'])
    ]));
    out.appendChild(grid);
    var how = el('details', 'note');
    how.appendChild(el('summary', '', ['数字口径(单位、分母、截止范围)']));
    var hl = el('ul', 'note-list');
    ['本月应计课时 = 所选月份内计费课的分钟数 ÷ 60 之和,单位为小时;应计金额 = 应计课时 × 单价。',
     '课包余额 = 课包总课时 − 课包开始日起所有月份的计费课时;总课时为 0 时显示「按次结算」。',
     '差额 = 累计应收 − 累计已收,累计到所选月份月底;币种与学员档案不同的收款不计入,单位为学员币种。'
    ].forEach(function (t) { hl.appendChild(el('li', '', [t])); });
    how.appendChild(hl);
    out.appendChild(how);

    var linesPanel = el('div', 'panel');
    linesPanel.appendChild(el('h2', '', [st.student.name + ' · ' + st.month + ' 课记录与计费判断']));
    if (st.lines.length === 0) {
      linesPanel.appendChild(el('p', 'empty', ['本月没有该学员的课记录。']));
    } else {
      var foot = el('tfoot');
      var fr = el('tr');
      var c1 = el('td', '', ['本月合计 ' + money(st.monthHours) + ' 计费课时']);
      c1.colSpan = 6;
      c1.setAttribute('data-label', '合计');
      var c2 = el('td', 'num', [money(st.monthAmount) + ' ' + cur]);
      c2.setAttribute('data-label', '金额');
      fr.appendChild(c1); fr.appendChild(c2); foot.appendChild(fr);
      linesPanel.appendChild(table([
        { label: '日期', cell: function (r) { return r.lesson.date; } },
        { label: '开始', cell: function (r) { return r.lesson.time || '-'; } },
        { label: '时长(分钟)', num: true, cell: function (r) { return r.lesson.minutes; } },
        { label: '状态', cell: function (r) { return r.lesson.status || '未填'; } },
        { label: '计费', cell: function (r) { return r.billable ? tag('计费', 'yes') : tag('不计费', 'no'); } },
        { label: '原因', cell: function (r) { return r.reason + (r.lesson.note ? '(备注:' + r.lesson.note + ')' : ''); } },
        { label: '金额(' + cur + ')', num: true, cell: function (r) { return money(r.amount); } }
      ], st.lines.map(function (l) { return { data: l, muted: !l.billable }; }), foot));
    }
    out.appendChild(linesPanel);

    if (st.monthPayments.length || st.excludedPayments.length) {
      var payPanel = el('div', 'panel');
      payPanel.appendChild(el('h2', '', ['本月收款']));
      if (st.excludedPayments.length) {
        payPanel.appendChild(el('p', 'notice notice--warn', ['有 ' + st.excludedPayments.length + ' 笔收款币种与学员币种(' + cur + ')不一致,未计入累计已收。']));
      }
      if (st.monthPayments.length) {
        payPanel.appendChild(table([
          { label: '日期', cell: function (p) { return p.date; } },
          { label: '金额(' + cur + ')', num: true, cell: function (p) { return money(p.amount); } },
          { label: '备注', cell: function (p) { return p.note || '-'; } }
        ], st.monthPayments.map(function (p) { return { data: p }; })));
      }
      out.appendChild(payPanel);
    }

    ui.md = C.toMarkdown(st, { sample: state.sample });
    var box = el('div', 'panel export-box');
    box.appendChild(el('h2', '', ['导出对账单(Markdown 文本,可直接发给学员)']));
    var row = el('div', 'row');
    row.appendChild(btn('复制对账单 Markdown', 'btn--primary', copyMarkdown));
    row.appendChild(btn('下载对账单 Markdown', 'btn--secondary', function () {
      download(st.student.name + '-' + st.month + '-对账单' + (state.sample ? '-合成示例' : '') + '.md', ui.md, 'text/markdown');
      flash('已生成对账单文件。', 'ok');
    }));
    box.appendChild(row);
    var ta = el('textarea');
    ta.readOnly = true;
    ta.id = 'md-preview';
    ta.setAttribute('aria-label', '对账单 Markdown 预览');
    ta.value = ui.md;
    box.appendChild(ta);
    out.appendChild(box);
  }

  function copyMarkdown() {
    var done = function () { flash('对账单已复制到剪贴板。', 'ok'); };
    var fallback = function () {
      var ta = $('md-preview');
      ta.focus(); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { flash('浏览器不允许复制,请在下方文本框里手动全选复制。', 'warn'); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ui.md).then(done, fallback);
    else fallback();
  }

  function renderLessons() {
    var box = $('lessons-table');
    clear(box);
    var list = state.lessons.filter(function (l) { return !ui.lessonMonth || l.date.slice(0, 7) === ui.lessonMonth; });
    list.sort(function (a, b) {
      var ka = a.date + ' ' + a.time, kb = b.date + ' ' + b.time;
      return ka < kb ? 1 : ka > kb ? -1 : 0;
    });
    if (!list.length) {
      box.appendChild(el('p', 'empty', [state.lessons.length ? '该月份没有课记录。' : '还没有课记录。可以用上面的表单录入,或批量粘贴。']));
      return;
    }
    box.appendChild(table([
      { label: '日期', cell: function (l) { return l.date; } },
      { label: '开始', cell: function (l) { return l.time || '-'; } },
      { label: '学员', cell: function (l) { return l.student; } },
      { label: '时长(分钟)', num: true, cell: function (l) { return l.minutes; } },
      { label: '状态', cell: function (l) { return l.status ? l.status : tag('未填', 'warn'); } },
      { label: '提前(小时)', num: true, cell: function (l) { return l.noticeHours == null ? '-' : l.noticeHours; } },
      { label: '计费', cell: function (l) {
        var s = studentByName(l.student);
        if (!s) return tag('未建档', 'error');
        return C.billable(l, s).billable ? tag('计费', 'yes') : tag('不计费', 'no');
      } },
      { label: '备注', cell: function (l) { return l.note || '-'; } },
      { label: '操作', cell: function (l) {
        return delCell('lesson', l.id, l.date + ' ' + l.student + ' 的这条课记录(' + l.minutes + ' 分钟)', '', function () {
          state.lessons = state.lessons.filter(function (x) { return x.id !== l.id; });
          save(); renderAll(); flash('已删除一条课记录。');
        });
      } }
    ], list.map(function (l) { return { data: l }; })));
  }

  function renderStudents() {
    var box = $('students-table');
    clear(box);
    if (!state.students.length) {
      box.appendChild(el('p', 'empty', ['还没有学员。用上面的表单建档,或点页头「载入合成示例」。']));
      return;
    }
    box.appendChild(table([
      { label: '姓名', cell: function (s) { return s.name; } },
      { label: '单价/小时', num: true, cell: function (s) { return money(s.rate); } },
      { label: '币种', cell: function (s) { return s.currency; } },
      { label: '课包课时', num: true, cell: function (s) { return s.packageHours > 0 ? s.packageHours : '按次结算'; } },
      { label: '课包开始', cell: function (s) { return s.packageStart || '-'; } },
      { label: '取消规则', cell: function (s) { return '提前不足 ' + s.cancelHours + ' 小时计费'; } },
      { label: '缺席', cell: function (s) { return s.absentBilled ? '计费' : '不计费'; } },
      { label: '操作', cell: function (s) {
        var row = el('div', 'row');
        row.appendChild(btn('编辑', 'btn--secondary btn--small', function () { editStudent(s); }));
        var nl = state.lessons.filter(function (x) { return x.student === s.name; }).length;
        var np = state.payments.filter(function (x) { return x.student === s.name; }).length;
        row.appendChild(delCell('student', s.name, '学员「' + s.name + '」的档案', '该学员的 ' + nl + ' 条课记录和 ' + np + ' 条收款会保留,并在异常列表里显示为「未建档」。', function () {
          state.students = state.students.filter(function (x) { return x.name !== s.name; });
          save(); renderAll(); flash('已删除学员档案;该学员的课记录和收款保留,会显示为「未建档」异常。');
        }));
        return row;
      } }
    ], state.students.map(function (s) { return { data: s }; })));
  }

  function renderPayments() {
    var box = $('payments-table');
    clear(box);
    if (!state.payments.length) {
      box.appendChild(el('p', 'empty', ['还没有收款记录。']));
      return;
    }
    var list = state.payments.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    box.appendChild(table([
      { label: '日期', cell: function (p) { return p.date; } },
      { label: '学员', cell: function (p) { return p.student; } },
      { label: '金额', num: true, cell: function (p) { return money(p.amount); } },
      { label: '币种', cell: function (p) {
        var s = studentByName(p.student);
        return s && s.currency !== p.currency ? el('span', '', [p.currency + ' ', tag('与档案不一致', 'error')]) : p.currency;
      } },
      { label: '备注', cell: function (p) { return p.note || '-'; } },
      { label: '操作', cell: function (p) {
        return delCell('payment', p.id, p.date + ' ' + p.student + ' 的这笔收款(' + money(p.amount) + ' ' + p.currency + ')', '', function () {
          state.payments = state.payments.filter(function (x) { return x.id !== p.id; });
          save(); renderAll(); flash('已删除一条收款。');
        });
      } }
    ], list.map(function (p) { return { data: p }; })));
  }

  function renderAnomalies() {
    var list = C.anomalies(state.students, state.lessons, state.payments);
    var c = $('anomaly-count');
    c.textContent = list.length;
    c.className = 'count' + (list.length ? ' count--alert' : '');
    var box = $('anomaly-list');
    clear(box);
    if (!list.length) {
      box.appendChild(el('p', 'notice notice--ok', [state.students.length || state.lessons.length ? '没有发现异常。' : '还没有数据,没有可检查的内容。']));
      return;
    }
    var ul = el('ul', 'anomaly-list');
    list.forEach(function (a) {
      var li = el('li', 'anomaly' + (a.level === 'warn' ? ' anomaly--warn' : ''));
      li.appendChild(el('span', 'anomaly__title', [tag(a.level === 'warn' ? '提醒' : '错误', a.level === 'warn' ? 'warn' : 'error'), a.title]));
      li.appendChild(el('span', '', [a.detail]));
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }

  /* ---------- 批量粘贴 ---------- */
  var batchParsed = { rows: [], errors: [] };
  function renderBatchPreview() {
    var box = $('batch-preview');
    clear(box);
    var text = $('batch-text').value;
    batchParsed = C.parseBatch(text, state.students, TODAY);
    $('btn-batch-add').disabled = batchParsed.rows.length === 0;
    if (!text.trim()) {
      box.appendChild(el('p', 'hint', ['粘贴后这里实时显示识别结果。']));
      return;
    }
    box.appendChild(el('p', '', ['识别成功 ' + batchParsed.rows.length + ' 行,有问题 ' + batchParsed.errors.length + ' 行。']));
    if (batchParsed.errors.length) {
      var ul = el('ul', 'batch-errors');
      batchParsed.errors.forEach(function (e) { ul.appendChild(el('li', '', ['第 ' + e.line + ' 行:' + e.reason])); });
      box.appendChild(ul);
    }
    if (batchParsed.rows.length) {
      box.appendChild(table([
        { label: '日期', cell: function (r) { return r.date + (r.time ? ' ' + r.time : ''); } },
        { label: '学员', cell: function (r) { return r.unknown ? el('span', '', [r.student + ' ', tag('未建档', 'warn')]) : r.student; } },
        { label: '时长(分钟)', num: true, cell: function (r) { return r.minutes; } },
        { label: '状态', cell: function (r) { return r.status; } }
      ], batchParsed.rows.map(function (r) { return { data: r }; })));
    }
  }

  /* ---------- 导出 / 导入 ---------- */
  function download(name, text, type) {
    var blob = new Blob([text], { type: type + ';charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* ---------- 表单 ---------- */
  function currencyFrom(sel, other) {
    if (sel.value !== '其他') return sel.value;
    var code = other.value.trim().toUpperCase();
    return /^[A-Z]{2,8}$/.test(code) ? code : null;
  }
  function bindCurrency(selId, wrapId) {
    var items = C.CURRENCIES.map(function (c) { return { value: c, label: c }; }).concat([{ value: '其他', label: '其他(自填)' }]);
    fillSelect($(selId), items, 'CNY');
    $(selId).addEventListener('change', function () { $(wrapId).hidden = $(selId).value !== '其他'; });
  }
  function setCurrency(selId, otherId, wrapId, code) {
    var known = C.CURRENCIES.indexOf(code) !== -1;
    $(selId).value = known ? code : '其他';
    $(otherId).value = known ? '' : code;
    $(wrapId).hidden = known;
  }

  /* 字段级错误:显示在出错输入旁,aria-describedby 关联;输入后清除 */
  function fieldError(input, msg) {
    var id = input.id + '-error';
    var e = $(id);
    if (!e) {
      e = el('span', 'field-error');
      e.id = id;
      e.setAttribute('role', 'alert');
      (input.closest('label') || input.parentNode).appendChild(e);
    }
    e.textContent = msg;
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', (input.getAttribute('data-base-desc') ? input.getAttribute('data-base-desc') + ' ' : '') + id);
  }
  function clearFieldError(input) {
    var e = $(input.id + '-error');
    if (e) e.remove();
    input.removeAttribute('aria-invalid');
    if (input.getAttribute('data-base-desc')) input.setAttribute('aria-describedby', input.getAttribute('data-base-desc'));
    else input.removeAttribute('aria-describedby');
  }
  /* errs: [{input, msg}];全部显示,聚焦第一个,顶部提示只作补充。返回是否有错 */
  function showErrors(errs, summary) {
    if (!errs.length) return false;
    errs.forEach(function (x) { fieldError(x.input, x.msg); });
    errs[0].input.focus();
    ui.suppressNext = false;
    flash(summary, 'danger');
    return true;
  }
  function watchClear(ids) {
    ids.forEach(function (id) { $(id).addEventListener('input', function () { clearFieldError($(id)); }); $(id).addEventListener('change', function () { clearFieldError($(id)); }); });
  }

  function editStudent(s) {
    ui.editingStudent = s.name;
    $('student-form-title').textContent = '编辑学员:' + s.name;
    $('s-name').value = s.name;
    $('s-rate').value = s.rate;
    setCurrency('s-currency', 's-currency-other', 's-currency-other-wrap', s.currency);
    $('s-package').value = s.packageHours;
    $('s-package-start').value = s.packageStart || '';
    $('s-cancel').value = s.cancelHours;
    $('s-absent').value = s.absentBilled ? '1' : '0';
    $('s-name').readOnly = true;
    $('s-name-hint').hidden = false;
    clearFieldError($('s-name'));
    $('s-rate').focus();
    window.scrollTo(0, 0);
  }
  function resetStudentForm() {
    ui.editingStudent = null;
    $('student-form-title').textContent = '新增学员';
    $('form-student').reset();
    $('s-currency-other-wrap').hidden = true;
    $('s-name').readOnly = false;
    $('s-name-hint').hidden = true;
    ['s-name', 's-rate', 's-currency-other', 's-package', 's-cancel'].forEach(function (id) { clearFieldError($(id)); });
  }

  function wire() {
    bindCurrency('s-currency', 's-currency-other-wrap');
    bindCurrency('p-currency', 'p-currency-other-wrap');
    fillSelect($('l-status'), C.STATUSES.map(function (s) { return { value: s, label: s }; }).concat([{ value: '', label: '(未填)' }]), '已上');
    $('l-date').value = TODAY;
    $('p-date').value = TODAY;
    if (TODAY_INFO.fixed) {
      $('today-note').hidden = false;
      $('today-note').textContent = '基准日 ' + TODAY + '(由地址参数固定)';
    }
    watchClear(['l-date', 'l-time', 'l-student', 'l-minutes', 's-name', 's-rate', 's-currency-other', 's-package', 's-cancel', 'p-date', 'p-student', 'p-amount', 'p-currency-other']);

    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () { setView(t.getAttribute('data-view')); });
    });
    $('btn-goto-anomalies').addEventListener('click', function () { setView('anomalies'); });

    /* 替换确认:校验 → 预览数量 → 确认 → 写入。取消时原数据不变 */
    function draftCount() {
      return ['l-student', 'l-note', 'l-notice', 'batch-text', 's-name', 'p-student', 'p-amount', 'p-note'].filter(function (id) { return $(id).value.trim() !== ''; }).length;
    }
    function hasUserData() {
      return state.students.length + state.lessons.length + state.payments.length > 0 || draftCount() > 0;
    }
    function requestReplace(label, data) {
      ui.pending = { label: label, data: data };
      var d = draftCount();
      $('replace-title').textContent = '将用' + label + '(' + C.describeCounts(data) + ')替换现有数据(' + C.describeCounts(state) + ')。未导出的现有数据会丢失' +
        (d ? ';页面上另有 ' + d + ' 处未提交的表单草稿,它们不会被写入账本' : '') + '。确定替换吗?';
      $('replace-confirm').hidden = false;
      $('btn-replace-no').focus();
    }
    function closeReplace() { ui.pending = null; $('replace-confirm').hidden = true; }
    function applyData(data, msg) {
      state = data;
      ui.stStudent = state.students.length ? state.students[0].name : '';
      ui.stMonth = TODAY.slice(0, 7);
      ui.del = null;
      resetStudentForm();
      save(); renderAll();
      flash(msg, 'ok');
    }
    var loadSample = function () {
      var v = C.validateImport({ students: globalThis.BILL_SAMPLE.students, lessons: globalThis.BILL_SAMPLE.lessons, payments: globalThis.BILL_SAMPLE.payments, sample: true });
      if (!v.ok) { flash('示例数据校验失败:' + v.errors.join(';'), 'danger'); return; }
      $('import-error').hidden = true;
      if (hasUserData()) { requestReplace('合成示例', v.data); return; }
      applyData(v.data, '已载入合成示例:3 位学员、' + v.data.lessons.length + ' 条课记录、' + v.data.payments.length + ' 条收款(虚构数据)。');
    };
    $('btn-sample').addEventListener('click', loadSample);
    $('btn-sample-2').addEventListener('click', loadSample);
    $('btn-replace-no').addEventListener('click', function () { closeReplace(); $('btn-sample').focus(); });
    $('btn-replace-yes').addEventListener('click', function () {
      var p = ui.pending;
      if (!p) return;
      closeReplace();
      applyData(p.data, p.label === '合成示例'
        ? '已载入合成示例:3 位学员、' + p.data.lessons.length + ' 条课记录、' + p.data.payments.length + ' 条收款(虚构数据)。'
        : '已导入' + p.label + ':' + C.describeCounts(p.data) + '。');
    });

    $('st-student').addEventListener('change', function () { ui.stStudent = $('st-student').value; renderStatement(); });
    $('st-month').addEventListener('change', function () { ui.stMonth = $('st-month').value; renderStatement(); });
    $('l-filter-month').addEventListener('change', function () { ui.lessonMonth = $('l-filter-month').value; renderLessons(); });

    $('form-lesson').addEventListener('submit', function (e) {
      e.preventDefault();
      var date = C.parseDate($('l-date').value, TODAY);
      var time = C.parseTime($('l-time').value);
      var name = $('l-student').value.trim();
      var minutes = Number($('l-minutes').value);
      var errs = [];
      if (!date) errs.push({ input: $('l-date'), msg: '请填写有效的日期(例如 2026-10-20)。' });
      if (!time) errs.push({ input: $('l-time'), msg: '请填写有效的开始时间(例如 10:00)。' });
      if (!name) errs.push({ input: $('l-student'), msg: '请填写学员姓名。' });
      if (!(minutes > 0)) errs.push({ input: $('l-minutes'), msg: '时长须为大于 0 的分钟数。' });
      if (showErrors(errs, '课记录没有保存:请看标红的输入框旁的说明。')) return;
      var notice = $('l-notice').value === '' ? null : Number($('l-notice').value);
      state.lessons.push({
        id: C.newId('l'), date: date, time: time, student: name, minutes: minutes,
        status: $('l-status').value, noticeHours: notice, note: $('l-note').value.trim()
      });
      save(); renderAll();
      $('l-note').value = ''; $('l-notice').value = '';
      flash(studentByName(name) ? '已添加课记录。' : '已添加。注意:「' + name + '」还没有学员档案,会进入异常列表。', studentByName(name) ? 'ok' : 'warn');
    });

    $('batch-text').addEventListener('input', renderBatchPreview);
    $('btn-batch-add').addEventListener('click', function () {
      var n = batchParsed.rows.length;
      if (!n) return;
      batchParsed.rows.forEach(function (r) {
        state.lessons.push({ id: C.newId('l'), date: r.date, time: r.time, student: r.student, minutes: r.minutes, status: r.status, noticeHours: null, note: r.note });
      });
      var skipped = batchParsed.errors.length;
      $('batch-text').value = '';
      save(); renderAll();
      flash('已加入 ' + n + ' 条课记录' + (skipped ? ',' + skipped + ' 行有问题未加入' : '') + '。', 'ok');
    });

    $('form-student').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = $('s-name').value.trim();
      var cur = currencyFrom($('s-currency'), $('s-currency-other'));
      var rate = Number($('s-rate').value), pkg = Number($('s-package').value), cancel = Number($('s-cancel').value);
      var serrs = [];
      if (!name) serrs.push({ input: $('s-name'), msg: '请填写学员姓名。' });
      if (!cur) serrs.push({ input: $('s-currency-other'), msg: '其他币种请填 2–8 位英文字母代码,例如 JPY。' });
      if ($('s-rate').value === '' || !(rate >= 0)) serrs.push({ input: $('s-rate'), msg: '单价须为不小于 0 的数字。' });
      if ($('s-package').value === '' || !(pkg >= 0)) serrs.push({ input: $('s-package'), msg: '课包课时须为不小于 0 的数字(0 表示按次结算)。' });
      if ($('s-cancel').value === '' || !(cancel >= 0)) serrs.push({ input: $('s-cancel'), msg: '取消小时数须为不小于 0 的数字。' });
      if (showErrors(serrs, '学员没有保存:请看标红的输入框旁的说明。')) return;
      var rec = {
        name: name, rate: rate, currency: cur, packageHours: pkg, packageStart: $('s-package-start').value,
        cancelHours: cancel, absentBilled: $('s-absent').value === '1'
      };
      var idx = -1;
      state.students.forEach(function (s, i) { if (s.name === name) idx = i; });
      if (idx >= 0) state.students[idx] = rec; else state.students.push(rec);
      save(); resetStudentForm(); renderAll();
      flash(idx >= 0 ? '已更新学员「' + name + '」。' : '已新增学员「' + name + '」。', 'ok');
    });
    $('btn-student-reset').addEventListener('click', resetStudentForm);

    $('form-payment').addEventListener('submit', function (e) {
      e.preventDefault();
      var date = C.parseDate($('p-date').value, TODAY);
      var name = $('p-student').value.trim();
      var amount = Number($('p-amount').value);
      var cur = currencyFrom($('p-currency'), $('p-currency-other'));
      var perrs = [];
      if (!date) perrs.push({ input: $('p-date'), msg: '请填写有效的日期(例如 2026-10-20)。' });
      if (!name) perrs.push({ input: $('p-student'), msg: '请填写学员姓名。' });
      if ($('p-amount').value === '' || !Number.isFinite(amount)) perrs.push({ input: $('p-amount'), msg: '请填写金额(数字,可为负数表示退款)。' });
      if (!cur) perrs.push({ input: $('p-currency-other'), msg: '其他币种请填 2–8 位英文字母代码,例如 JPY。' });
      if (showErrors(perrs, '收款没有保存:请看标红的输入框旁的说明。')) return;
      state.payments.push({ id: C.newId('p'), date: date, student: name, amount: amount, currency: cur, note: $('p-note').value.trim() });
      save(); renderAll();
      $('p-amount').value = ''; $('p-note').value = '';
      flash('已添加收款。', 'ok');
    });

    $('btn-export-csv').addEventListener('click', function () {
      download('课记录' + (state.sample ? '-合成示例' : '') + '.csv', '\ufeff' + C.toCsv(state.lessons, { sample: state.sample }), 'text/csv');
      flash('已导出 ' + state.lessons.length + ' 条课记录(CSV)。', 'ok');
    });
    $('btn-export-json').addEventListener('click', function () {
      download('课时账单备份' + (state.sample ? '-合成示例' : '') + '.json', JSON.stringify({ app: 'billcheck', version: 1, sample: state.sample, students: state.students, lessons: state.lessons, payments: state.payments }, null, 2), 'application/json');
      flash('已生成 JSON 备份。', 'ok');
    });
    var openImport = function () { $('file-import').click(); };
    $('btn-import').addEventListener('click', openImport);
    $('btn-import-2').addEventListener('click', openImport);
    $('file-import').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var input = e.target;
      f.text().then(function (txt) {
        var v = C.validateImport(txt);
        if (!v.ok) {
          var box = $('import-error');
          box.textContent = '导入失败,现有数据没有改动。文件「' + f.name + '」的问题:' + v.errors.slice(0, 5).join(';');
          box.hidden = false;
          closeReplace();
          box.scrollIntoView({ block: 'nearest' });
          return;
        }
        $('import-error').hidden = true;
        requestReplace('备份文件「' + f.name + '」', v.data);
      }, function () { var box = $('import-error'); box.textContent = '读取文件失败,现有数据没有改动。'; box.hidden = false; });
      input.value = '';
    });

    $('btn-clear').addEventListener('click', function () {
      $('clear-confirm-count').textContent = C.describeCounts(state);
      $('clear-confirm').hidden = false; $('btn-clear-no').focus();
    });
    $('btn-clear-no').addEventListener('click', function () { $('clear-confirm').hidden = true; $('btn-clear').focus(); });
    $('btn-clear-yes').addEventListener('click', function () {
      state = empty();
      ui.del = null;
      closeReplace();
      $('import-error').hidden = true;
      save(); resetStudentForm(); renderAll();
      $('clear-confirm').hidden = true;
      flash('已清空全部数据。');
    });
  }

  $('btn-save-warning-export').addEventListener('click', function () { $('btn-export-json').click(); });
  wire();
  setView('statement');
  renderAll();
})();
