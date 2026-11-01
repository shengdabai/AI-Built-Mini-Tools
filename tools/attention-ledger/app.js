'use strict';
(function () {
  var C = globalThis.AttentionCore;
  var STORAGE_KEY = 'attledger.v1';
  var TODAY = C.resolveToday(location.search);
  var $ = function (id) { return document.getElementById(id); };

  var state = emptyState();
  var ui = { tab: 'day', viewDate: TODAY, range: 7, editingId: null, noteDirty: false, pendingDate: null, pendingImport: null, confirmDeleteId: null, focusId: null, draft: { present: false, previewable: false, parts: [] } };

  function emptyState() {
    return { app: 'attention-ledger', version: 1, sample: false, golden: { start: C.DEFAULT_GOLDEN.start, end: C.DEFAULT_GOLDEN.end }, entries: [], notes: Object.create(null) };
  }

  /* ---------- DOM 小工具(只用 textContent,不拼 innerHTML) ---------- */
  function h(tag, props, kids) {
    var el = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'text') el.textContent = props[k];
      else if (k === 'class') el.className = props[k];
      else if (k === 'vars') Object.keys(props[k]).forEach(function (v) { el.style.setProperty(v, String(props[k][v])); });
      else el.setAttribute(k, props[k]);
    });
    (kids || []).forEach(function (c) { if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function pct(x) { return Math.round(x * 100) + '%'; }
  function pos(min) { return Math.round(min / 1440 * 100000) / 1000; }
  function chip(g) { return h('span', { class: 'chip g-' + g, 'aria-hidden': 'true' }); }
  function gname(k) { return C.GROUP_NAME[k]; }

  /* ---------- 存储 ---------- */
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      $('save-warning').hidden = true;
      return true;
    } catch (e) {
      $('save-warning').hidden = false;
      return false;
    }
  }
  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { raw = null; }
    if (!raw) return;
    var v = C.validateImport(raw);
    if (v.ok) state = v.data;
    else showImportError('本地保存的数据没有通过校验,已忽略(原因:' + v.error + ')。原数据仍留在浏览器里,没有被覆盖,直到你下一次保存。');
  }
  var flashTimer = null;
  function flash(msg) {
    var f = $('flash');
    f.textContent = msg;
    f.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { f.hidden = true; }, 6000);
  }
  /* 成功提示只在真正写入后显示 */
  function commit(msg) {
    var ok = save();
    renderAll();
    if (ok) flash(msg);
    return ok;
  }
  function showImportError(msg) {
    $('import-error-text').textContent = msg;
    $('import-error').hidden = false;
  }

  /* ---------- 视图切换 ---------- */
  function setTab(t) {
    ui.tab = t;
    ['day', 'range', 'review'].forEach(function (k) { $('view-' + k).hidden = k !== t; });
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      if (b.getAttribute('data-view') === t) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    renderAll();
  }

  /* ---------- 渲染:一天 ---------- */
  function entriesOn(date) {
    return state.entries.filter(function (e) { return e.date === date; }).sort(function (a, b) { return a.start - b.start; });
  }
  function dayList() {
    var saved = entriesOn(ui.viewDate);
    if (!ui.draft.previewable) return saved;
    var merged = C.withDraft(state.entries, ui.draft.parts, ui.editingId).filter(function (e) { return e.date === ui.viewDate; });
    return merged.sort(function (a, b) { return a.start - b.start; });
  }
  function metric(value, label, note, golden) {
    return h('div', { class: 'metric' + (golden ? ' metric--golden' : '') }, [
      h('div', { class: 'metric__value', text: value }),
      h('div', { class: 'metric__label', text: label }),
      note ? h('div', { class: 'metric__note', text: note }) : null
    ]);
  }
  function renderTimeline(list) {
    var box = $('timeline');
    clear(box);
    var g = C.normalizeGolden(state.golden);
    box.setAttribute('aria-label', '一天的时间轴,共 ' + list.length + ' 段,黄金时段 ' + C.fmtTime(g.start) + ' 到 ' + C.fmtTime(g.end));
    var ticks = h('div', { class: 'timeline__ticks', 'aria-hidden': 'true' });
    for (var hr = 0; hr <= 24; hr += 3) ticks.appendChild(h('span', { class: 'timeline__tick', text: String(hr).padStart(2, '0') + ':00', vars: { '--seg-start': pos(hr * 60) } }));
    var track = h('div', { class: 'timeline__track' });
    track.appendChild(h('div', { class: 'timeline__golden', vars: { '--seg-start': pos(g.start), '--seg-len': pos(g.end - g.start) } }));
    list.forEach(function (e) {
      track.appendChild(h('div', {
        class: 'timeline__seg g-' + e.group + (e.draft ? ' timeline__seg--draft' : ''),
        title: (e.draft ? '草稿(未保存) ' : '') + C.fmtTime(e.start) + '–' + C.fmtTime(e.end) + ' ' + gname(e.group) + ':' + e.what,
        vars: { '--seg-start': pos(e.start), '--seg-len': pos(e.end - e.start) }
      }));
    });
    box.appendChild(ticks);
    box.appendChild(track);
    var nd = list.filter(function (e) { return e.draft; }).length;
    box.appendChild(h('p', { class: 'timeline__label', text: '带金色边线的区间是黄金时段。' + (nd ? '虚线轮廓的是还没保存的草稿(已计入下面的统计)。' : '') }));
  }
  function legendInto(ul, by, total) {
    clear(ul);
    C.GROUPS.forEach(function (gr) {
      var min = by[gr.key] || 0;
      ul.appendChild(h('li', {}, [chip(gr.key), h('span', { text: gr.name + ' ' + min + ' 分钟' + (total ? '(' + pct(min / total) + ')' : '') })]));
    });
  }
  function renderDay() {
    var list = dayList();
    $('empty-guide').hidden = state.entries.length > 0;
    var s = C.daySummary(list, state.golden);
    var g = C.normalizeGolden(state.golden);
    $('day-title').textContent = ui.viewDate + ' 这一天' + (list.some(function (e) { return e.draft; }) ? '(含未保存的草稿预览)' : '');
    if (list.length === 0) {
      $('day-headline').textContent = '这一天还没有记录。';
    } else {
      var b = s.biggest;
      $('day-headline').textContent = '今天注意力最大的一笔:' + C.fmtTime(b.start) + '–' + C.fmtTime(b.end) + '「' + b.what + '」,' + C.fmtDuration(C.duration(b)) + '(' + gname(b.group) + ')。';
    }
    var m = $('day-metrics');
    clear(m);
    m.appendChild(metric(C.fmtDuration(s.total), '记录总时长', list.length + ' 段'));
    m.appendChild(metric(pct(s.focusRatio), '生产 + 学习占比', C.fmtDuration(s.focusMin)));
    m.appendChild(metric(pct(s.golden.focusRatio), '黄金时段利用率', '生产 + 学习 ' + s.golden.focusMin + ' / ' + s.golden.capacity + ' 分钟', true));
    renderTimeline(list);
    legendInto($('legend'), s.byGroup, s.total);

    var cap = s.golden.capacity;
    var gt = $('golden-text');
    if (list.length === 0) gt.textContent = '黄金时段 ' + C.fmtTime(g.start) + '–' + C.fmtTime(g.end) + '(' + cap + ' 分钟),这一天还没有记录。';
    else {
      var parts = C.GROUPS.filter(function (gr) { return s.golden.byGroup[gr.key] > 0; }).map(function (gr) { return gr.name + ' ' + s.golden.byGroup[gr.key] + ' 分钟'; });
      var free = cap - s.golden.used;
      gt.textContent = '黄金时段 ' + C.fmtTime(g.start) + '–' + C.fmtTime(g.end) + ' 共 ' + cap + ' 分钟:' + (parts.length ? parts.join('、') : '没有记录') + (free > 0 ? '、未记录 ' + free + ' 分钟' : '') + '。';
    }
    var stack = $('golden-stack');
    clear(stack);
    stack.setAttribute('aria-label', gt.textContent);
    C.GROUPS.forEach(function (gr) {
      var min = s.golden.byGroup[gr.key];
      if (min > 0) stack.appendChild(h('span', { class: 'stack-bar__part g-' + gr.key, vars: { '--fill': Math.round(min / cap * 10000) / 100 } }));
    });
    legendInto($('golden-legend'), s.golden.byGroup, cap);

    var tbody = $('entry-table').querySelector('tbody');
    clear(tbody);
    $('entry-empty').hidden = list.length > 0;
    $('entry-table').hidden = list.length === 0;
    list.forEach(function (e) {
      var tr = h('tr', e.draft ? { class: 'row--draft' } : {});
      tr.appendChild(h('td', { 'data-label': '时间', text: C.fmtTime(e.start) + '–' + C.fmtTime(e.end) }));
      tr.appendChild(h('td', { 'data-label': '时长', text: C.fmtDuration(C.duration(e)) }));
      tr.appendChild(h('td', { 'data-label': '大类' }, [h('span', { class: 'tag' }, [chip(e.group), h('span', { text: gname(e.group) + (e.label ? ' · ' + e.label : '') })])]));
      tr.appendChild(h('td', { 'data-label': '做了什么', text: e.what + (e.draft ? '(草稿,未保存)' : '') }));
      if (e.draft) {
        tr.appendChild(h('td', { 'data-label': '操作', text: '先保存或取消编辑' }));
      } else if (ui.confirmDeleteId === e.id) {
        var yes = h('button', { type: 'button', class: 'btn btn--danger btn--small', id: 'del-yes-' + e.id, text: '确认删除', 'aria-label': '确认删除 ' + e.what });
        yes.addEventListener('click', function () { confirmDelete(e.id); });
        var no = h('button', { type: 'button', class: 'btn btn--secondary btn--small', id: 'del-no-' + e.id, text: '取消', 'aria-label': '取消删除 ' + e.what });
        no.addEventListener('click', function () { ui.confirmDeleteId = null; ui.focusId = 'del-' + e.id; renderAll(); });
        tr.appendChild(h('td', { 'data-label': '操作' }, [
          h('p', { class: 'confirm-text', text: '删除 ' + e.date + ' ' + C.fmtTime(e.start) + '–' + C.fmtTime(e.end) + '「' + e.what + '」?删除后不能撤销;同一事项跨午夜拆开的另一半是独立的一条,不会一起删除。' }),
          h('div', { class: 'actions' }, [yes, no])
        ]));
      } else {
        var edit = h('button', { type: 'button', class: 'btn btn--secondary btn--small', id: 'edit-' + e.id, text: '编辑', 'aria-label': '编辑 ' + e.what });
        edit.addEventListener('click', function () { startEdit(e.id); });
        var del = h('button', { type: 'button', class: 'btn btn--danger btn--small', id: 'del-' + e.id, text: '删除', 'aria-label': '删除 ' + e.what });
        del.addEventListener('click', function () { removeEntry(e.id); });
        tr.appendChild(h('td', { 'data-label': '操作' }, [h('div', { class: 'actions' }, [edit, del])]));
      }
      tbody.appendChild(tr);
    });
  }

  /* ---------- 渲染:周与月 ---------- */
  function rangeBounds() {
    return { from: C.addDays(ui.viewDate, -(ui.range - 1)), to: ui.viewDate };
  }
  function delta(x) {
    var p = Math.round(x * 100);
    return { text: (p > 0 ? '+' : '') + p + ' 个百分点', cls: p > 0 ? 'up' : p < 0 ? 'down' : '' };
  }
  function renderRange() {
    var b = rangeBounds();
    var cmp = C.compareRanges(state.entries, b.from, b.to, state.golden);
    var cur = cmp.current;
    var st = C.streak(cur.days, 0.6);
    $('range-sub').textContent = b.from + ' 至 ' + b.to + '(以「查看日期」为最后一天),对比 ' + cmp.prevFrom + ' 至 ' + cmp.prevTo + '。';
    Array.prototype.forEach.call(document.querySelectorAll('[data-range]'), function (btn) {
      btn.setAttribute('aria-pressed', String(+btn.getAttribute('data-range') === ui.range));
    });
    var m = $('range-metrics');
    clear(m);
    var fd = cmp.focusMinDelta;
    m.appendChild(metric(C.fmtDuration(cur.focusMin), '生产 + 学习', '比上一期 ' + (fd > 0 ? '多 ' : fd < 0 ? '少 ' : '持平 ') + (fd === 0 ? '' : Math.abs(fd) + ' 分钟')));
    m.appendChild(metric(pct(cur.avgGoldenRatio), '黄金时段平均利用率', '有记录的 ' + cur.recordedDays + ' 天', true));
    m.appendChild(metric(st.current + ' 天', '连续利用率 ≥ 60%', '区间内最长 ' + st.best + ' 天', true));
    m.appendChild(metric(C.fmtDuration(cur.total), '记录总时长', cur.recordedDays + ' / ' + cur.days.length + ' 天有记录'));

    var sb = $('share-table').querySelector('tbody');
    clear(sb);
    C.GROUPS.forEach(function (gr) {
      var d = delta(cmp.shareDelta[gr.key]);
      var tr = h('tr');
      tr.appendChild(h('td', {}, [h('span', { class: 'tag' }, [chip(gr.key), h('span', { text: gr.name })])]));
      tr.appendChild(h('td', { class: 'num', text: String(cur.byGroup[gr.key]) }));
      tr.appendChild(h('td', { class: 'num', text: pct(cur.shares[gr.key]) }));
      tr.appendChild(h('td', { class: 'num', text: pct(cmp.previous.shares[gr.key]) }));
      tr.appendChild(h('td', { class: 'num ' + d.cls, text: d.text }));
      sb.appendChild(tr);
    });

    var db = $('daily-table').querySelector('tbody');
    clear(db);
    cur.days.forEach(function (d) {
      var tr = h('tr');
      tr.appendChild(h('td', { text: d.date }));
      tr.appendChild(h('td', { text: d.recorded ? d.focusMin + ' 分钟' : '无记录' }));
      var ratioCell = h('td');
      if (d.recorded) {
        ratioCell.appendChild(h('div', { class: 'meter' }, [
          h('span', { class: 'meter__track', 'aria-hidden': 'true' }, [h('span', { class: 'meter__fill' + (d.goldenRatio < 0.6 ? ' meter__fill--low' : ''), vars: { '--fill': Math.round(d.goldenRatio * 100) } })]),
          h('span', { text: pct(d.goldenRatio) })
        ]));
      } else ratioCell.textContent = '-';
      tr.appendChild(ratioCell);
      tr.appendChild(h('td', { text: d.biggest ? d.biggest.what + '(' + C.duration(d.biggest) + ' 分钟)' : '-' }));
      db.appendChild(tr);
    });
  }

  /* ---------- 渲染:复盘与导出 ---------- */
  function currentReport() {
    var b = { from: C.addDays(ui.viewDate, -6), to: ui.viewDate };
    return C.weeklyReport({ entries: state.entries, notes: state.notes, from: b.from, to: b.to, golden: state.golden, sample: state.sample });
  }
  function renderReview() {
    var list = entriesOn(ui.viewDate);
    var s = C.daySummary(list, state.golden);
    $('review-title').textContent = ui.viewDate + ' 的一句复盘';
    $('review-auto').textContent = s.biggest
      ? '今天注意力最大的一笔花在了:「' + s.biggest.what + '」,' + C.fmtDuration(C.duration(s.biggest)) + ',' + gname(s.biggest.group) + '。'
      : '这一天没有记录,无法自动取最大的一笔。';
    var input = $('note-input');
    if (!ui.noteDirty) input.value = state.notes[ui.viewDate] || '';
    $('md-preview').textContent = currentReport();
    $('note-state').textContent = ui.noteDirty ? '有未保存的改动。' : (state.notes[ui.viewDate] ? '已保存。' : '');
  }

  /* ---------- 渲染:总控 ---------- */
  function formDraftPresent() {
    return ui.editingId !== null || $('f-what').value.trim() !== '' || $('f-label').value.trim() !== '';
  }
  function sameAsOriginal(parts) {
    if (!ui.editingId || parts.length !== 1) return false;
    var o = state.entries.filter(function (x) { return x.id === ui.editingId; })[0];
    var p = parts[0];
    return !!o && o.date === p.date && o.start === p.start && o.end === p.end && o.what === p.what && o.group === p.group && (o.label || '') === (p.label || '');
  }
  function computeDraft() {
    var present = formDraftPresent();
    if (!present) return { present: false, previewable: false, parts: [] };
    var r = buildFromForm();
    var ok = r.errs.length === 0 && r.parts.length > 0;
    return { present: true, previewable: ok && !sameAsOriginal(r.parts), parts: ok ? r.parts : [] };
  }
  /* 有未保存编辑或预览时,普通导出/备份全部禁用并说明原因;存储失败面板里的内存备份按钮不受影响 */
  function exportBlockReasons() {
    var r = [];
    if (state.entries.length === 0 && Object.keys(state.notes).length === 0) r.push('还没有任何记录,没有可导出的内容。');
    if (ui.noteDirty) r.push('备注有改动还没保存,导出内容不含它。请先点「保存备注」。');
    if (ui.draft.present) r.push('表单里有还没保存的时间段' + (ui.editingId ? '(正在编辑)' : '草稿') + ',导出内容不含它。请先点「保存这一段」或「取消编辑」,或清空「做了什么」。');
    return r;
  }
  function renderExportState() {
    var reasons = exportBlockReasons();
    var blocked = reasons.length > 0;
    ['btn-backup', 'export-md', 'export-csv', 'export-json'].forEach(function (id) { $(id).disabled = blocked; });
    var hint = $('export-hint');
    hint.hidden = !blocked;
    hint.textContent = reasons.join(' ');
    var eb = $('export-block');
    var showBanner = blocked && reasons.some(function (x) { return x.indexOf('没有任何记录') < 0; });
    eb.hidden = !showBanner;
    eb.textContent = showBanner ? '导出已暂停:' + reasons.filter(function (x) { return x.indexOf('没有任何记录') < 0; }).join(' ') : '';
  }
  function renderAll() {
    ui.draft = computeDraft();
    var dn = $('draft-note');
    if (ui.draft.previewable) {
      var dp = ui.draft.parts[0];
      dn.textContent = '正在预览未保存的这一段(' + dp.date + ' ' + C.fmtTime(dp.start) + '–' + C.fmtTime(dp.end) + ')。时间轴里的虚线轮廓和下面的统计已包含它;点「保存这一段」才会写入。' + (dp.date !== ui.viewDate ? '它属于 ' + dp.date + ',切换到那一天才能在时间轴上看到。' : '');
      dn.hidden = false;
    } else { dn.hidden = true; dn.textContent = ''; }
    $('sample-badge').hidden = !state.sample;
    var fixed = C.fixedToday(location.search);
    $('today-banner').hidden = !fixed;
    if (fixed) $('today-banner').textContent = '基准日 ' + fixed + '(由地址参数固定)。「回到今天」和默认日期都以它为准。';
    $('note-switch-confirm').hidden = !ui.pendingDate;
    if (ui.pendingDate) $('note-switch-title').textContent = '「' + ui.viewDate + '」的备注有未保存的改动。要切换到 ' + ui.pendingDate + ',请先选择怎么处理这段备注:';
    $('view-date').value = ui.viewDate;
    $('golden-start').value = C.fmtTime(state.golden.start);
    $('golden-end').value = C.fmtTime(state.golden.end);
    if (!ui.editingId && !$('f-date').dataset.touched) $('f-date').value = ui.viewDate;
    if (ui.tab === 'day') renderDay();
    if (ui.tab === 'range') renderRange();
    if (ui.tab === 'review') renderReview();
    renderExportState();
    applyFocus();
  }
  function applyFocus() {
    if (!ui.focusId) return;
    var el = document.getElementById(ui.focusId);
    ui.focusId = null;
    if (el) el.focus();
  }

  /* ---------- 录入 ---------- */
  function newId() { return 'e-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }
  var FIELD_CONTROL = { date: 'f-date', start: 'f-start', end: 'f-end', what: 'f-what', group: 'f-group', label: 'f-label', overlap: 'f-start' };
  var FIELD_ERR = { date: 'err-date', start: 'err-start', end: 'err-end', what: 'err-what', group: 'err-group', label: 'err-label', overlap: 'err-start' };
  function clearFieldErrors() {
    Object.keys(FIELD_ERR).forEach(function (k) {
      var ctl = $(FIELD_CONTROL[k]), er = $(FIELD_ERR[k]);
      er.hidden = true; er.textContent = '';
      ctl.removeAttribute('aria-describedby'); ctl.removeAttribute('aria-invalid');
    });
  }
  /* errs: [{field, message}];错误显示在出错控件旁(aria-describedby 关联),并聚焦第一个出错控件;顶部汇总只做补充 */
  function showFormErrors(errs, focusFirst) {
    var box = $('form-errors');
    clear(box);
    clearFieldErrors();
    if (!errs.length) { box.hidden = true; return; }
    var firstCtl = null;
    var perField = {};
    errs.forEach(function (er) {
      var f = FIELD_ERR[er.field] ? er.field : 'what';
      var id = FIELD_ERR[f];
      perField[id] = (perField[id] ? perField[id] + ' ' : '') + er.message;
    });
    Object.keys(FIELD_ERR).forEach(function (k) {
      var id = FIELD_ERR[k];
      if (!perField[id]) return;
      var ctl = $(FIELD_CONTROL[k]), er = $(id);
      er.textContent = perField[id]; er.hidden = false;
      ctl.setAttribute('aria-describedby', id); ctl.setAttribute('aria-invalid', 'true');
      delete perField[id];
      if (!firstCtl) firstCtl = ctl;
    });
    box.appendChild(h('strong', { text: '这一段没有保存:' }));
    box.appendChild(h('ul', {}, errs.map(function (m) { return h('li', { text: m.message }); })));
    box.hidden = false;
    if (focusFirst && firstCtl) firstCtl.focus();
  }
  function resetForm() {
    ui.editingId = null;
    $('f-what').value = '';
    $('f-label').value = '';
    $('f-overnight').checked = false;
    $('f-overnight').disabled = false;
    $('f-midnight').checked = false;
    $('f-end').disabled = false;
    $('f-submit').textContent = '保存这一段';
    $('f-cancel').hidden = true;
    showFormErrors([], false);
  }
  function startEdit(id) {
    var e = state.entries.filter(function (x) { return x.id === id; })[0];
    if (!e) return;
    ui.editingId = id;
    $('f-date').value = e.date;
    $('f-date').dataset.touched = '1';
    $('f-start').value = C.fmtTime(e.start);
    $('f-midnight').checked = e.end === 1440;
    $('f-end').disabled = e.end === 1440;
    $('f-end').value = e.end === 1440 ? '00:00' : C.fmtTime(e.end);
    $('f-what').value = e.what;
    $('f-group').value = e.group;
    $('f-label').value = e.label || '';
    $('f-overnight').checked = false;
    $('f-overnight').disabled = true;
    $('f-submit').textContent = '保存修改';
    $('f-cancel').hidden = false;
    showFormErrors([], false);
    $('f-what').focus();
    renderAll();
  }
  function removeEntry(id) {
    ui.confirmDeleteId = id;
    ui.focusId = 'del-no-' + id;
    renderAll();
  }
  function confirmDelete(id) {
    var e = state.entries.filter(function (x) { return x.id === id; })[0];
    ui.confirmDeleteId = null;
    if (!e) { renderAll(); return; }
    var rows = entriesOn(e.date);
    var idx = rows.map(function (x) { return x.id; }).indexOf(id);
    var neighbor = rows[idx + 1] || rows[idx - 1] || null;
    ui.focusId = neighbor ? 'edit-' + neighbor.id : 'f-what';
    state.entries = state.entries.filter(function (x) { return x.id !== id; });
    if (ui.editingId === id) resetForm();
    commit('已删除 ' + e.date + ' ' + C.fmtTime(e.start) + '–' + C.fmtTime(e.end) + '「' + e.what + '」。');
  }
  /* 读取表单并校验;不改任何状态(预览与提交共用) */
  function buildFromForm() {
    var date = $('f-date').value;
    var start = C.parseTime($('f-start').value);
    var midnight = $('f-midnight').checked;
    var end = midnight ? 1440 : C.parseTime($('f-end').value);
    var base = { id: ui.editingId || newId(), date: date, start: start, end: end, what: $('f-what').value.trim(), group: $('f-group').value, label: $('f-label').value.trim() };
    var overnight = $('f-overnight').checked;
    var parts = [base];
    var errs = [];
    if (start === null || end === null) {
      if (start === null) errs.push({ field: 'start', message: '请填写开始时间。' });
      if (end === null) errs.push({ field: 'end', message: '请填写结束时间。' });
    } else if (overnight && midnight) {
      errs.push({ field: 'end', message: '「跨午夜」与「结束于午夜 24:00」只能选一个。' });
    } else if (overnight) {
      if (end === 0) {
        base.end = 1440;
      } else if (end > start) {
        errs.push({ field: 'end', message: '勾选了跨午夜,结束时间应该早于开始时间(例如 23:00 开始,01:00 结束)。' });
      } else {
        parts = C.splitOvernight(base) || [];
        if (parts.length === 2) parts[1].id = newId();
      }
    }
    if (!errs.length) {
      parts.forEach(function (p) {
        var same = state.entries.filter(function (e) { return e.date === p.date && e.id !== ui.editingId; });
        var v = C.validateEntry(p, same);
        v.errors.forEach(function (er) {
          var prefix = parts.length === 2 ? p.date + ':' : '';
          var msg = prefix + er.message;
          if (!errs.some(function (x) { return x.message === msg; })) errs.push({ field: er.field, message: msg });
        });
      });
    }
    if (!errs.length && parts.length === 0) errs.push({ field: 'end', message: '这一段无法拆分,请检查时间。' });
    return { parts: parts, errs: errs, date: date };
  }
  function onSubmit(ev) {
    ev.preventDefault();
    var r = buildFromForm();
    var parts = r.parts, date = r.date;
    if (r.errs.length) { showFormErrors(r.errs, true); return; }
    showFormErrors([], false);
    if (ui.editingId) {
      state.entries = state.entries.map(function (e) { return e.id === ui.editingId ? parts[0] : e; });
    } else {
      parts.forEach(function (p) { state.entries.push(p); });
    }
    var msg = (ui.editingId ? '已修改' : '已记下') + (parts.length === 2 ? '(跨午夜,已拆成 ' + parts[0].date + ' 与 ' + parts[1].date + ' 两段)' : '') + ':' + C.fmtTime(parts[0].start) + '–' + C.fmtTime(parts[0].end) + '「' + parts[0].what + '」。';
    var wasEditing = !!ui.editingId;
    var savedId = parts[0].id;
    if (ui.noteDirty && date !== ui.viewDate) {
      msg += '当前仍停在 ' + ui.viewDate + ',因为那天的备注有未保存的改动。';
    } else {
      ui.viewDate = date;
    }
    if (wasEditing) { resetForm(); ui.focusId = 'edit-' + savedId; }
    else { $('f-what').value = ''; $('f-label').value = ''; $('f-overnight').checked = false; var nextStart = parts[parts.length - 1].end; $('f-start').value = C.fmtTime(nextStart === 1440 ? 0 : nextStart); ui.focusId = 'f-what'; }
    commit(msg);
  }
  function fillErrorDemo() {
    var ex = globalThis.AttentionSample.errorExample;
    resetForm();
    $('f-date').value = ex.date;
    $('f-date').dataset.touched = '1';
    $('f-start').value = C.fmtTime(ex.start);
    $('f-end').value = C.fmtTime(ex.end);
    $('f-what').value = ex.what;
    $('f-group').value = ex.group;
    $('f-label').value = ex.label;
    flash('已填入一条和 10-20 上午写稿重叠的记录。载入合成示例后点「保存这一段」,会看到保存被阻止。');
    renderAll();
  }

  /* ---------- 备注、黄金时段 ---------- */
  function saveNote() {
    var v = $('note-input').value.trim();
    if (v) state.notes[ui.viewDate] = v; else delete state.notes[ui.viewDate];
    ui.noteDirty = false;
    commit('已保存 ' + ui.viewDate + ' 的备注。');
  }
  function onGolden() {
    var s = C.parseTime($('golden-start').value), e = C.parseTime($('golden-end').value);
    var ge = $('err-golden');
    if (s === null || e === null || s >= e) {
      ge.textContent = '黄金时段的开始必须早于结束,已恢复原来的设置(' + C.fmtTime(state.golden.start) + '–' + C.fmtTime(state.golden.end) + ')。';
      ge.hidden = false;
      renderAll();
      $('golden-start').setAttribute('aria-describedby', 'err-golden');
      $('golden-end').setAttribute('aria-describedby', 'err-golden');
      $('golden-start').focus();
      return;
    }
    ge.hidden = true; ge.textContent = '';
    $('golden-start').removeAttribute('aria-describedby');
    $('golden-end').removeAttribute('aria-describedby');
    state.golden = { start: s, end: e };
    commit('黄金时段改为 ' + C.fmtTime(s) + '–' + C.fmtTime(e) + '。');
  }

  /* ---------- 导出 / 导入 ---------- */
  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function backupDownload() { download('注意力账本-备份-' + TODAY + '.json', JSON.stringify(state, null, 2), 'application/json'); }
  function exportJson() { if (ui.draft.present || ui.noteDirty) { renderExportState(); return; } backupDownload(); }
  function exportCsv() { if (ui.draft.present || ui.noteDirty) { renderExportState(); return; } download('注意力账本-记录-' + TODAY + '.csv', '﻿' + C.toCsv(state.entries, state.golden, { sample: state.sample }), 'text/csv;charset=utf-8'); flash('已导出全部记录 CSV。'); }
  function exportMd() {
    if (ui.noteDirty || ui.draft.present) { renderExportState(); return; }
    download('注意力周报-' + ui.viewDate + '.md', currentReport(), 'text/markdown;charset=utf-8');
    flash('已导出周报 Markdown。');
  }
  function currentScope() {
    return C.replaceScope(state, { formDraft: formDraftPresent(), noteDraft: ui.noteDirty });
  }
  function onImport(ev) {
    var f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      var v = C.validateImport(String(rd.result));
      if (!v.ok) { ui.pendingImport = null; $('import-confirm').hidden = true; showImportError('导入被拒绝,现有数据没有改动。原因:' + v.error); return; }
      $('import-error').hidden = true;
      ui.pendingImport = v.data;
      var sc = currentScope();
      $('import-scope').textContent = '文件里有 ' + v.data.entries.length + ' 段记录、' + Object.keys(v.data.notes).length + ' 条备注,黄金时段 ' + C.fmtTime(v.data.golden.start) + '–' + C.fmtTime(v.data.golden.end) + (v.data.sample ? '(文件标注为合成示例)' : '') + '。确认后会替换' + (sc.any ? '你现有的:' + C.describeScope(sc) : '当前的空白状态') + '。确认前现有数据不变。';
      $('import-confirm').hidden = false;
      $('btn-import-no').focus();
    };
    rd.onerror = function () { showImportError('读取文件失败,现有数据没有改动。'); };
    rd.readAsText(f);
  }
  function applyImport() {
    if (!ui.pendingImport) return;
    state = ui.pendingImport;
    ui.pendingImport = null;
    $('import-confirm').hidden = true;
    ui.noteDirty = false;
    resetForm();
    ui.focusId = 'btn-import';
    commit('已导入 ' + state.entries.length + ' 段记录。');
  }
  function loadSample() {
    var sc = currentScope();
    if (sc.any) {
      $('replace-scope').textContent = C.describeScope(sc);
      $('replace-confirm').hidden = false;
      $('btn-replace-no').focus();
      return;
    }
    applySample();
  }
  function applySample() {
    $('replace-confirm').hidden = true;
    var v = C.validateImport(globalThis.AttentionSample.data);
    if (!v.ok) { showImportError('示例数据校验失败:' + v.error); return; }
    state = v.data;
    ui.viewDate = TODAY;
    ui.noteDirty = false;
    resetForm();
    commit('已载入合成示例(14 天,不是真实记录)。');
  }
  function requestDate(d) {
    if (!C.isDate(d) || d === ui.viewDate) { renderAll(); return; }
    if (ui.noteDirty) { ui.pendingDate = d; renderAll(); $('btn-note-switch-save').focus(); return; }
    applyDate(d);
  }
  function applyDate(d) {
    ui.viewDate = d;
    ui.pendingDate = null;
    if (!ui.editingId) delete $('f-date').dataset.touched;
    renderAll();
  }

  /* ---------- 事件 ---------- */
  function wire() {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.addEventListener('click', function () { setTab(b.getAttribute('data-view')); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-range]'), function (b) {
      b.addEventListener('click', function () { ui.range = +b.getAttribute('data-range'); renderAll(); });
    });
    $('load-sample').addEventListener('click', loadSample);
    $('load-sample-2').addEventListener('click', loadSample);
    $('btn-backup').addEventListener('click', exportJson);
    $('export-json').addEventListener('click', exportJson);
    $('btn-save-warning-export').addEventListener('click', backupDownload);
    $('export-csv').addEventListener('click', exportCsv);
    $('export-md').addEventListener('click', exportMd);
    $('btn-import').addEventListener('click', function () { $('file-import').click(); });
    $('btn-import-2').addEventListener('click', function () { $('file-import').click(); });
    $('file-import').addEventListener('change', onImport);
    $('btn-import-yes').addEventListener('click', applyImport);
    $('btn-import-no').addEventListener('click', function () { ui.pendingImport = null; $('import-confirm').hidden = true; $('btn-import').focus(); });
    $('btn-import-error-close').addEventListener('click', function () { $('import-error').hidden = true; });
    $('btn-replace-yes').addEventListener('click', applySample);
    $('btn-replace-no').addEventListener('click', function () { $('replace-confirm').hidden = true; $('load-sample').focus(); });
    $('btn-clear').addEventListener('click', function () {
      var sc = currentScope();
      $('clear-scope').textContent = sc.any ? '将清空:' + C.describeScope(sc) + '。' : '当前没有任何数据,清空不会改变什么。';
      $('clear-confirm').hidden = false;
      $('btn-clear-no').focus();
    });
    $('btn-clear-no').addEventListener('click', function () { $('clear-confirm').hidden = true; $('btn-clear').focus(); });
    $('btn-clear-yes').addEventListener('click', function () {
      state = emptyState();
      ui.noteDirty = false;
      ui.pendingDate = null;
      resetForm();
      $('clear-confirm').hidden = true;
      ui.focusId = 'btn-clear';
      commit('已清空所有数据。');
    });
    $('view-date').addEventListener('change', function () { requestDate($('view-date').value); });
    $('date-prev').addEventListener('click', function () { requestDate(C.addDays(ui.viewDate, -1)); });
    $('date-next').addEventListener('click', function () { requestDate(C.addDays(ui.viewDate, 1)); });
    $('date-today').addEventListener('click', function () { requestDate(TODAY); });
    $('btn-note-switch-save').addEventListener('click', function () {
      var d = ui.pendingDate;
      saveNote();
      if (d) applyDate(d);
    });
    $('btn-note-switch-discard').addEventListener('click', function () {
      var d = ui.pendingDate;
      ui.noteDirty = false;
      if (d) applyDate(d); else renderAll();
    });
    $('btn-note-switch-cancel').addEventListener('click', function () { ui.pendingDate = null; renderAll(); $('note-input').focus(); });
    $('golden-start').addEventListener('change', onGolden);
    $('golden-end').addEventListener('change', onGolden);
    $('entry-form').addEventListener('submit', onSubmit);
    /* 表单里任何合法改动,提交前就在时间轴和统计里以草稿样式预览 */
    ['input', 'change'].forEach(function (evn) {
      $('entry-form').addEventListener(evn, function (ev) {
        if (ev.target && ev.target.id === 'f-date') $('f-date').dataset.touched = '1';
        if (ev.target && ev.target.id === 'f-midnight') $('f-end').disabled = $('f-midnight').checked;
        showFormErrors([], false);
        renderAll();
      });
    });
    $('f-cancel').addEventListener('click', function () { resetForm(); delete $('f-date').dataset.touched; ui.focusId = 'f-what'; renderAll(); });
    $('f-error-demo').addEventListener('click', fillErrorDemo);
    $('note-input').addEventListener('input', function () { ui.noteDirty = true; renderReview(); renderExportState(); });
    $('note-save').addEventListener('click', saveNote);
  }

  load();
  wire();
  $('f-start').value = '09:00';
  $('f-end').value = '10:00';
  renderAll();
})();
