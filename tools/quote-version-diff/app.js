'use strict';
(function () {
  var C = globalThis.QuoteDiffCore, S = globalThis.QuoteDiffSample;
  var STORAGE_KEY = 'quotediff.v1';
  var FIELD_LABELS = { code: '项目编码(必选)', name: '项目名称', qty: '数量', unit: '单位', price: '单价', note: '备注' };

  function blankDraft() { return { oldText: '', newText: '', versionName: '', explainText: '', explainEdited: false, sample: false }; }
  function normDraft(d) {
    var b = blankDraft();
    if (!d) return b;
    Object.keys(b).forEach(function (k) { if (d[k] !== undefined) b[k] = d[k]; });
    return b;
  }
  var state = { records: [], draft: blankDraft() };
  var maps = { old: null, new: null };
  var headerKeys = { old: null, new: null };
  var current = null; /* {diff, sig, explainText, onlyAmount} */
  var pendingDeleteId = null;

  function $(id) { return document.getElementById(id); }
  function realToday() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  var TODAY = C.resolveToday(location.search, realToday());
  var BASE_FIXED = C.resolveToday(location.search, '') !== '';

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  /* ---------- 存储 ---------- */
  function save() {
    var ok = true;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ app: 'quote-diff', version: 1, records: state.records, draft: state.draft })); }
    catch (e) { ok = false; }
    $('save-warning').hidden = ok;
    setExplainStatus(ok);
    return ok;
  }
  function setExplainStatus(ok) {
    var st = $('explain-status');
    if (!st) return;
    st.textContent = ok ? '说明草稿已自动保存在本机浏览器,并包含在 JSON 备份里。' : '未保存:浏览器拒绝写入,说明草稿只在当前页面里。请导出 JSON 备份(备份包含当前内存里的说明草稿)。';
    st.className = ok ? 'hint' : 'hint hint--warn';
  }
  function flash(msg) {
    var f = $('flash'); f.textContent = msg; f.hidden = false;
    clearTimeout(flash.t); flash.t = setTimeout(function () { f.hidden = true; }, 4000);
  }
  function saveAndFlash(msg) { if (save()) flash(msg); }
  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { raw = null; }
    if (!raw) return;
    try {
      var v = C.validateImport(JSON.parse(raw));
      if (v.ok) { state.records = v.value.records; if (v.value.draft) state.draft = normDraft(v.value.draft); }
      else showImportError('浏览器里保存的旧数据格式不合法,已忽略(下次保存会覆盖它):', v.errors);
    } catch (e) { showImportError('浏览器里保存的旧数据无法解析,已忽略(下次保存会覆盖它)。', []); }
  }
  function showImportError(title, errors) {
    var box = $('import-error'); box.textContent = '';
    box.appendChild(el('p', {}, [el('strong', { text: title })]));
    if (errors.length) {
      var ul = el('ul'); errors.slice(0, 12).forEach(function (m) { ul.appendChild(el('li', { text: m })); });
      if (errors.length > 12) ul.appendChild(el('li', { text: '……另有 ' + (errors.length - 12) + ' 条原因' }));
      box.appendChild(ul);
    }
    box.hidden = false;
  }

  /* ---------- 下载 ---------- */
  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---------- 列对应 ---------- */
  function renderMapping(side) {
    var text = $(side + '-text').value;
    var t = C.parseTable(text);
    var key = JSON.stringify(t.headers);
    var grid = $(side + '-mapping-grid');
    if (headerKeys[side] !== key) {
      maps[side] = C.guessMapping(t.headers);
      headerKeys[side] = key;
      grid.textContent = '';
      C.MAPPING_KEYS.forEach(function (k) {
        var sel = el('select', { id: side + '-map-' + k });
        sel.appendChild(el('option', { value: '-1', text: '(不使用)' }));
        t.headers.forEach(function (h, i) { sel.appendChild(el('option', { value: String(i), text: (h || '(空表头)') + ' · 第 ' + (i + 1) + ' 列' })); });
        sel.value = String(maps[side][k]);
        sel.addEventListener('change', function () { maps[side][k] = parseInt(sel.value, 10); refreshStale(); });
        grid.appendChild(el('label', { class: 'field', for: side + '-map-' + k }, [el('span', { text: FIELD_LABELS[k] }), sel]));
      });
      if (!t.headers.length) grid.appendChild(el('p', { class: 'hint', text: '粘贴表格后,这里会出现列对应选项。' }));
    }
  }

  /* ---------- 对比 ---------- */
  function sig() { return JSON.stringify([$('old-text').value, $('new-text').value, maps.old, maps.new]); }
  function isStale() { return !!current && current.sig !== sig(); }
  function fresh() { return !!current && !isStale(); }

  function compare() {
    var oldT = C.parseTable($('old-text').value), newT = C.parseTable($('new-text').value);
    var errBox = $('errors-box'), warnBox = $('warnings-box');
    errBox.hidden = true; warnBox.hidden = true;
    current = null;
    if (!oldT.headers.length || !newT.headers.length) {
      showErrors(['请先粘贴旧版和新版两份报价表(第一行为表头)。']);
      renderAll(); return;
    }
    var diff = C.diffQuotes(oldT, newT, { old: maps.old, new: maps.new });
    if (!diff.ok) { showErrors(diff.errors.map(function (e) { return e.message; })); renderAll(); return; }
    current = { diff: diff, sig: sig(), onlyAmount: false, explainText: '', keptEdits: false };
    current.explainText = C.explain(diff, { onlyAmount: false, title: state.draft.versionName || '报价变更说明' });
    /* 手动编辑过的说明不被重新对比悄悄覆盖:保留并提示,由用户点「重新生成」决定 */
    if (state.draft.explainEdited && state.draft.explainText) { current.explainText = state.draft.explainText; current.keptEdits = true; }
    else { state.draft.explainText = current.explainText; state.draft.explainEdited = false; }
    save();
    if (diff.warnings.length) {
      warnBox.textContent = ''; warnBox.appendChild(el('p', {}, [el('strong', { text: '提示:' })]));
      var ul = el('ul'); diff.warnings.forEach(function (w) { ul.appendChild(el('li', { text: w })); }); warnBox.appendChild(ul);
      warnBox.hidden = false;
    }
    $('only-amount').checked = false;
    renderAll();
  }
  function showErrors(list) {
    var box = $('errors-box'); box.textContent = '';
    box.appendChild(el('p', {}, [el('strong', { text: '无法对比,请先修正:' })]));
    var ul = el('ul'); list.slice(0, 20).forEach(function (m) { ul.appendChild(el('li', { text: m })); });
    if (list.length > 20) ul.appendChild(el('li', { text: '……另有 ' + (list.length - 20) + ' 条' }));
    box.appendChild(ul); box.hidden = false;
  }

  function signed(n) { return (n > 0 ? '+' : n < 0 ? '-' : '') + C.fmtMoney(Math.abs(n)); }
  function describeItem(it) { return C.fmtNum(it.qty) + (it.unit ? ' ' + it.unit : '') + ' × ' + C.fmtMoney(it.price); }

  function renderResult() {
    var box = $('result');
    if (!current) { box.hidden = true; return; }
    var d = current.diff, t = d.totals;
    box.hidden = false;
    var totals = $('totals'); totals.textContent = '';
    function stat(label, value, cls) { totals.appendChild(el('div', { class: cls || '' }, [el('dt', { text: label }), el('dd', { text: value })])); }
    stat('旧版合计', C.fmtMoney(t.oldTotal));
    stat('新版合计', C.fmtMoney(t.newTotal));
    stat('差额', signed(t.delta), t.delta > 0 ? 'is-up' : t.delta < 0 ? 'is-down' : '');
    stat('变化百分比', t.percent === null ? '不计算(旧版为 0)' : (t.percent > 0 ? '+' : '') + t.percent + '%');
    $('result-summary').textContent = '新增 ' + d.added.length + ' 项,删除 ' + d.removed.length + ' 项,调整 ' + d.changed.filter(function (c) { return !c.nameOnly; }).length + ' 项,仅改名 ' + d.changed.filter(function (c) { return c.nameOnly; }).length + ' 项,无变化 ' + d.unchanged + ' 项。';
    var body = $('diff-body'); body.textContent = '';
    function row(cls, tag, code, name, oldNew, amount) {
      var tr = el('tr', { class: cls });
      tr.appendChild(el('td', {}, [el('span', { class: 'tag', text: tag })]));
      tr.appendChild(el('td', { text: code }));
      tr.appendChild(el('td', { text: name }));
      var td = el('td', { class: 'old-new' });
      oldNew.forEach(function (line) { td.appendChild(el('div', { text: line })); });
      tr.appendChild(td);
      tr.appendChild(el('td', { class: 'num', text: amount }));
      body.appendChild(tr);
    }
    d.added.forEach(function (a) { row('row-added', '新增', a.code, a.name, ['(无) → ' + describeItem(a)], signed(a.amount)); });
    d.removed.forEach(function (r) { row('row-removed', '删除', r.code, r.name, [describeItem(r) + ' → (无)'], signed(-r.amount)); });
    d.changed.forEach(function (c) {
      var lines = c.fields.map(function (f) {
        var a = f.from, b = f.to;
        if (f.field === 'price') { a = C.fmtMoney(a); b = C.fmtMoney(b); }
        if (f.field === 'qty') { a = C.fmtNum(a); b = C.fmtNum(b); }
        return { name: '名称', qty: '数量', unit: '单位', price: '单价' }[f.field] + ':' + (a === '' ? '(空)' : a) + ' → ' + (b === '' ? '(空)' : b);
      });
      row(c.nameOnly ? 'row-note' : 'row-changed', c.nameOnly ? '改名(仅提示)' : '调整', c.code, c.name, lines, signed(c.deltaAmount));
    });
    if (!body.children.length) {
      var tr = el('tr'); tr.appendChild(el('td', { colspan: '5', text: '两版报价没有任何差异。' })); body.appendChild(tr);
    }
  }

  /* ---------- 状态联动 ---------- */
  function refreshStale() {
    var stale = isStale(), ok = fresh();
    $('btn-export-csv').disabled = !ok;
    $('stale-note').textContent = stale ? '输入或列对应已改动,结果已过期:请重新点「对比两版」后再导出。' : '';
    $('result').classList.toggle('is-stale', stale);
    $('explain-stale').hidden = !stale;
    $('btn-export-md').disabled = !ok;
    $('btn-regen').disabled = !ok;
    $('only-amount').disabled = !ok;
    var canSave = ok;
    $('record-form').hidden = !canSave;
    $('record-block').hidden = canSave;
    $('record-block').textContent = stale ? '输入已改动,结果已过期。请回到「对比」页重新对比后再保存。' : '需要先在「对比」页得到最新的对比结果,才能保存。';
    var hasSaved = !current && !!state.draft.explainText;
    $('explain-box').hidden = !current && !hasSaved;
    $('explain-empty').hidden = !!current || hasSaved;
    $('explain-kept').hidden = !(current && current.keptEdits && state.draft.explainEdited);
    $('explain-saved-only').hidden = !hasSaved;
    $('base-date').textContent = '业务基准日:' + TODAY + (BASE_FIXED ? '(由地址参数固定)' : '(今天)') + '。确认日期默认取这一天。';
    $('sample-badge').hidden = !state.draft.sample;
  }

  function renderAll() {
    renderResult();
    if (current) $('explain-text').value = current.explainText;
    else if (state.draft.explainText) $('explain-text').value = state.draft.explainText;
    $('empty-guide').hidden = !!($('old-text').value || $('new-text').value || state.records.length);
    renderRecords();
    refreshStale();
  }

  /* ---------- 确认记录 ---------- */
  function renderRecords() {
    var list = $('chain'); list.textContent = '';
    var recs = C.sortRecords(state.records);
    $('record-count').textContent = String(recs.length);
    $('chain-empty').hidden = recs.length > 0;
    recs.forEach(function (r, i) {
      var li = el('li', { class: 'chain__item ' + (r.confirmed ? 'chain__item--confirmed' : 'chain__item--pending') });
      li.appendChild(el('div', { class: 'chain__title', text: '第 ' + (i + 1) + ' 版 · ' + r.versionName }));
      li.appendChild(el('div', { class: 'chain__meta', text: '保存于 ' + C.describeStamp(r) }));
      var pct = r.percent === null ? '不计算百分比' : (r.percent > 0 ? '+' : '') + r.percent + '%';
      li.appendChild(el('div', { class: 'chain__body', text: '旧版 ' + C.fmtMoney(r.oldTotal) + ' → 新版 ' + C.fmtMoney(r.newTotal) + ',差额 ' + signed(r.delta) + '(' + pct + ');新增 ' + r.counts.added + '、删除 ' + r.counts.removed + '、调整 ' + r.counts.changed }));
      li.appendChild(el('div', { class: 'chain__status', text: r.confirmed ? '已向客户确认:' + r.confirmedDate : '尚未向客户确认' }));
      if (r.note) li.appendChild(el('div', { class: 'chain__body', text: '备注:' + r.note }));
      var row = el('div', { class: 'row' });
      if (r.confirmed) {
        var undo = el('button', { type: 'button', class: 'btn btn--secondary', text: '撤销确认' });
        undo.addEventListener('click', function () { r.confirmed = false; r.confirmedDate = ''; saveAndFlash('已撤销确认。'); renderRecords(); });
        row.appendChild(undo);
      } else {
        var date = el('input', { type: 'date', class: 'inline-date', value: TODAY, 'aria-label': '确认日期(' + r.versionName + ')' });
        var mark = el('button', { type: 'button', class: 'btn btn--secondary', text: '标记已向客户确认' });
        mark.addEventListener('click', function () {
          if (!C.isValidDate(date.value)) { flash('请填写有效的确认日期。'); return; }
          r.confirmed = true; r.confirmedDate = date.value; saveAndFlash('已标记为已向客户确认。'); renderRecords();
        });
        row.appendChild(date); row.appendChild(mark);
      }
      var mdBtn = el('button', { type: 'button', class: 'btn btn--secondary', text: '导出这条的变更说明' });
      mdBtn.disabled = !r.explainText;
      mdBtn.addEventListener('click', function () { download(r.versionName + '-变更说明.md', r.explainText, 'text/markdown;charset=utf-8'); });
      row.appendChild(mdBtn);
      var del = el('button', { type: 'button', class: 'btn btn--secondary', text: '删除' });
      del.addEventListener('click', function () { pendingDeleteId = r.id; $('del-title').textContent = ''; $('del-title').appendChild(el('strong', { text: '确认删除记录「' + r.versionName + '」?' })); $('del-title').appendChild(document.createTextNode('它保存的金额、确认状态和变更说明文字会一起删除,此操作不能撤销。')); $('delete-confirm').hidden = false; $('btn-del-no').focus(); });
      row.appendChild(del);
      li.appendChild(row);
      list.appendChild(li);
    });
  }

  /* ---------- 事件 ---------- */
  function setTab(name) {
    ['compare', 'explain', 'records'].forEach(function (v) { $('view-' + v).hidden = v !== name; });
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      if (b.getAttribute('data-view') === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
    b.addEventListener('click', function () { setTab(b.getAttribute('data-view')); });
  });

  function onTextInput(side) {
    state.draft[side + 'Text'] = $(side + '-text').value;
    save();
    renderMapping(side);
    $('empty-guide').hidden = !!($('old-text').value || $('new-text').value || state.records.length);
    refreshStale();
  }
  var SIDE_LABEL = { old: '旧版报价', new: '新版报价' };
  var pendingFile = { old: null, new: null };
  function applyFile(side, name, text) {
    pendingFile[side] = null;
    $(side + '-file-confirm').hidden = true;
    $(side + '-text').value = text; onTextInput(side); flash('已读入文件:' + name);
  }
  ['old', 'new'].forEach(function (side) {
    $(side + '-file-yes').addEventListener('click', function () { var p = pendingFile[side]; if (p) applyFile(side, p.name, p.text); });
    $(side + '-file-no').addEventListener('click', function () {
      pendingFile[side] = null;
      $(side + '-file-confirm').hidden = true;
      flash('没有读入文件,' + SIDE_LABEL[side] + '输入框里的内容没有改动。');
      $(side + '-file').focus();
    });
    $(side + '-text').addEventListener('input', function () { onTextInput(side); });
    $(side + '-file').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      var reader = new FileReader();
      var err = $(side + '-file-error');
      reader.onload = function () {
        /* 空文件、乱码文件先拒绝:不覆盖输入框和本机已保存的草稿,原因写在文件选择框下面 */
        var chk = C.checkTextFile(String(reader.result));
        if (!chk.ok) { err.textContent = '文件「' + f.name + '」没有读入:' + chk.message + '输入框里的内容没有改动。'; err.hidden = false; return; }
        err.hidden = true;
        var text = String(reader.result);
        var cur = $(side + '-text').value;
        /* 输入框里已有别的内容:合法文件也先页内确认,确认前不改动 */
        if (cur.trim() === '' || cur === text) { applyFile(side, f.name, text); return; }
        pendingFile[side] = { name: f.name, text: text };
        $(side + '-file-confirm-text').textContent = '读入「' + f.name + '」会替换' + SIDE_LABEL[side] + '输入框里现有的 ' + cur.length + ' 个字符。确定吗?';
        $(side + '-file-confirm').hidden = false;
        $(side + '-file-no').focus();
      };
      reader.onerror = function () { flash('文件读取失败,请改为直接粘贴。'); };
      reader.readAsText(f);
      e.target.value = '';
    });
  });

  function fillInputs() {
    /* 输入被整体替换(示例、清空、导入备份)时,作废还没确认的文件读入 */
    ['old', 'new'].forEach(function (s) { pendingFile[s] = null; $(s + '-file-confirm').hidden = true; });
    $('old-text').value = state.draft.oldText; $('new-text').value = state.draft.newText;
    headerKeys.old = null; headerKeys.new = null;
    renderMapping('old'); renderMapping('new');
  }
  var pendingSample = null;
  function hasDraft() { return !!(state.draft.oldText.trim() || state.draft.newText.trim() || state.draft.versionName.trim() || state.draft.explainText.trim() || $('rec-note').value.trim() || $('rec-confirmed').checked); }
  function requestSample(errorVersion) {
    if (!hasDraft()) { applySample(errorVersion); return; }
    pendingSample = errorVersion; $('sample-confirm').hidden = false; $('btn-sample-yes').focus();
  }
  function applySample(errorVersion) {
    $('sample-confirm').hidden = true; pendingSample = null;
    state.draft.oldText = S.oldText;
    state.draft.newText = errorVersion ? S.errorNewText : S.newText;
    state.draft.versionName = S.versionName;
    state.draft.explainText = ''; state.draft.explainEdited = false; state.draft.sample = true;
    current = null; fillInputs(); $('errors-box').hidden = true; $('warnings-box').hidden = true;
    saveAndFlash(errorVersion ? '已载入错误示例(合成):新版里 A03 重复,点「对比两版」查看报错。' : '已载入示例(合成)。点「对比两版」。');
    $('rec-name').value = state.draft.versionName;
    setTab('compare'); renderAll();
  }
  $('btn-sample').addEventListener('click', function () { requestSample(false); });
  $('btn-sample-error').addEventListener('click', function () { requestSample(true); });
  $('btn-sample-yes').addEventListener('click', function () { applySample(!!pendingSample); });
  $('btn-sample-no').addEventListener('click', function () { pendingSample = null; $('sample-confirm').hidden = true; });
  $('btn-compare').addEventListener('click', function () { compare(); if (current) flash('对比完成。'); });

  function storeExplain(edited) {
    state.draft.explainText = current ? current.explainText : $('explain-text').value;
    state.draft.explainEdited = edited;
    if (current) current.keptEdits = false;
    save();
    refreshStale();
  }
  $('only-amount').addEventListener('change', function () {
    if (!fresh()) return;
    current.onlyAmount = $('only-amount').checked;
    current.explainText = C.explain(current.diff, { onlyAmount: current.onlyAmount, title: state.draft.versionName || '报价变更说明' });
    $('explain-text').value = current.explainText;
    storeExplain(false);
  });
  $('btn-regen').addEventListener('click', function () {
    if (!fresh()) return;
    current.explainText = C.explain(current.diff, { onlyAmount: $('only-amount').checked, title: state.draft.versionName || '报价变更说明' });
    $('explain-text').value = current.explainText; storeExplain(false); flash('已按当前选项重新生成。');
  });
  $('explain-text').addEventListener('input', function () {
    if (current) current.explainText = $('explain-text').value;
    storeExplain(true);
  });

  $('btn-export-csv').addEventListener('click', function () {
    if (!fresh()) return;
    download(sampleTag() + '报价差异表.csv', '﻿' + C.diffToCsv(current.diff) + (state.draft.sample ? '合成示例数据,不是真实报价\n' : ''), 'text/csv;charset=utf-8');
  });
  $('btn-export-md').addEventListener('click', function () {
    if (!fresh()) return;
    download(sampleTag() + '报价变更说明.md', (state.draft.sample ? '> 合成示例数据,不是真实报价。\n\n' : '') + $('explain-text').value, 'text/markdown;charset=utf-8');
  });
  function sampleTag() { return state.draft.sample ? '合成示例-' : ''; }
  function exportJson() {
    download(sampleTag() + '报价版本备份.json', JSON.stringify({ app: 'quote-diff', version: 1, records: state.records, draft: state.draft }, null, 2), 'application/json');
  }
  $('btn-export-json').addEventListener('click', exportJson);
  $('btn-save-warning-export').addEventListener('click', exportJson);

  $('rec-confirmed').addEventListener('change', function () {
    $('rec-date').disabled = !$('rec-confirmed').checked;
    if ($('rec-confirmed').checked && !$('rec-date').value) $('rec-date').value = TODAY;
  });
  $('rec-name').addEventListener('input', function () { state.draft.versionName = $('rec-name').value; save(); });
  $('record-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('record-error'); err.hidden = true;
    $('rec-name').removeAttribute('aria-invalid'); $('rec-date').removeAttribute('aria-invalid');
    if (!fresh()) { err.textContent = '结果已过期,请重新对比。'; err.hidden = false; return; }
    var stamp = C.stampFromDate(new Date(), { offsetMinutes: -new Date().getTimezoneOffset(), fixedDate: BASE_FIXED ? TODAY : undefined });
    var tzName = '';
    try { tzName = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (ex) { tzName = ''; }
    var res = C.makeRecord({
      id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), now: stamp.createdAt, tz: tzName, simulated: stamp.simulated,
      versionName: $('rec-name').value, diff: current.diff, confirmed: $('rec-confirmed').checked,
      confirmedDate: $('rec-date').value, note: $('rec-note').value, explainText: current.explainText
    });
    if (!res.ok) {
      err.textContent = res.error; err.hidden = false;
      var bad = /确认日期/.test(res.error) ? $('rec-date') : $('rec-name');
      bad.setAttribute('aria-invalid', 'true'); bad.focus();
      return;
    }
    $('rec-name').removeAttribute('aria-invalid'); $('rec-date').removeAttribute('aria-invalid');
    state.records.push(res.record);
    if (save()) flash('已保存记录「' + res.record.versionName + '」。');
    $('rec-note').value = '';
    renderRecords();
  });

  $('btn-del-no').addEventListener('click', function () { pendingDeleteId = null; $('delete-confirm').hidden = true; });
  $('btn-del-yes').addEventListener('click', function () {
    state.records = state.records.filter(function (r) { return r.id !== pendingDeleteId; });
    pendingDeleteId = null; $('delete-confirm').hidden = true;
    saveAndFlash('已删除一条记录。'); renderAll();
  });

  $('btn-clear').addEventListener('click', function () { $('clear-confirm').hidden = false; $('btn-clear-yes').focus(); });
  $('btn-clear-no').addEventListener('click', function () { $('clear-confirm').hidden = true; });
  $('btn-clear-yes').addEventListener('click', function () {
    state = { records: [], draft: blankDraft() };
    current = null; $('clear-confirm').hidden = true; $('errors-box').hidden = true; $('warnings-box').hidden = true;
    $('rec-name').value = ''; $('rec-note').value = ''; $('rec-confirmed').checked = false; $('rec-date').value = ''; $('rec-date').disabled = true;
    fillInputs(); $('explain-text').value = ''; saveAndFlash('已清空。'); renderAll();
  });

  var pendingImport = null;
  $('btn-import').addEventListener('click', function () { $('file-import-json').click(); });
  $('btn-import-no').addEventListener('click', function () { pendingImport = null; $('import-confirm').hidden = true; $('btn-import').focus(); });
  $('btn-import-yes').addEventListener('click', function () {
    if (!pendingImport) return;
    var v = pendingImport; pendingImport = null; $('import-confirm').hidden = true;
    state.records = v.records;
    state.draft = normDraft(v.draft);
    current = null; fillInputs(); $('rec-name').value = state.draft.versionName; $('explain-text').value = state.draft.explainText;
    saveAndFlash('已导入 ' + state.records.length + ' 条记录。'); renderAll();
  });
  $('file-import-json').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(String(reader.result)); }
      catch (err) { showImportError('导入被拒绝:文件不是有效的 JSON,现有数据未改动。', []); return; }
      var v = C.validateImport(data);
      if (!v.ok) { showImportError('导入被拒绝:备份文件不合法,现有数据未改动。原因:', v.errors); return; }
      $('import-error').hidden = true;
      pendingImport = v.value;
      $('import-summary').textContent = C.importSummary(state, v.value).text;
      $('import-confirm').hidden = false;
      $('btn-import-no').focus();
    };
    reader.onerror = function () { showImportError('导入被拒绝:文件读取失败,现有数据未改动。', []); };
    reader.readAsText(f);
  });

  /* ---------- 启动 ---------- */
  load();
  setExplainStatus(true);
  fillInputs();
  $('rec-name').value = state.draft.versionName;
  $('rec-date').value = '';
  renderAll();
})();
