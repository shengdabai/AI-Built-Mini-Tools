'use strict';
(function () {
  var C = globalThis.ProcureCore;
  var KEY = 'procure.v1';
  var state = { quotes: [], threshold: 10, sample: false };
  var ui = { view: 'compare', group: null, editId: null, histKey: null, pendingConfirm: null, confirmDeleteId: null, focusId: null, returnTo: null };
  var TODAY = C.resolveToday(location.search);

  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k]; else n.setAttribute(k, attrs[k]);
    });
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  /* ---------- 存储 ---------- */
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return;
      var v = C.validateImport(JSON.parse(raw));
      if (v.ok) { state.quotes = v.data.quotes; state.threshold = v.data.threshold; state.sample = v.data.sample; }
    } catch (e) { /* 读取失败按空数据处理 */ }
  }
  function backupObj() { return { version: 1, sample: state.sample, threshold: state.threshold, quotes: state.quotes }; }
  function save() {
    var ok = true;
    try { localStorage.setItem(KEY, JSON.stringify(backupObj())); }
    catch (e) { ok = false; }
    $('save-warning').hidden = ok;
    return ok;
  }
  function flash(msg) {
    var f = $('flash');
    f.textContent = msg; f.hidden = false;
    clearTimeout(flash.t);
    flash.t = setTimeout(function () { f.hidden = true; }, 5000);
  }
  function commit(msg) {
    var ok = save();
    renderAll();
    if (ok && msg) flash(msg);
    return ok;
  }

  /* ---------- 下载 ---------- */
  function download(name, text, mime, bom) {
    var blob = new Blob([bom ? '﻿' + text : text], { type: mime + ';charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function allRanks() { return C.groupNames(state.quotes).map(function (g) { return C.rank(state.quotes, g); }); }
  function rankMd() { var t = C.rankTable(allRanks(), { sample: state.sample }); return C.toMarkdown(t.headers, t.rows, '采购比价表(' + TODAY + ')', state.sample ? '数据来源:合成示例,不是真实报价。' : ''); }
  function backupDownload() {
    download('procure-backup-' + TODAY + '.json', JSON.stringify(backupObj(), null, 2), 'application/json');
  }
  function exportJson() { if (draftPresent()) { renderExport(); return; } backupDownload(); }
  function draftPresent() {
    if (ui.editId !== null) return true;
    if ($('batch-text').value.trim() !== '') return true;
    return ['f-supplier', 'f-item', 'f-group', 'f-price', 'f-count', 'f-qty', 'f-note'].some(function (id) { return $(id).value.trim() !== ''; });
  }
  function scopeNow() {
    var formDraft = ui.editId !== null || ['f-supplier', 'f-item', 'f-group', 'f-price', 'f-count', 'f-qty', 'f-note'].some(function (id) { return $(id).value.trim() !== ''; });
    return C.replaceScope(state, { formDraft: formDraft, batchDraft: $('batch-text').value.trim() !== '' });
  }

  /* ---------- 渲染工具 ---------- */
  function fmtPct(p) { return (p > 0 ? '+' : '') + p + '%'; }
  function applyFocus() {
    if (!ui.focusId) return;
    var e = document.getElementById(ui.focusId);
    ui.focusId = null;
    if (e) e.focus();
  }
  function table(headers, stack) {
    var wrap = el('div', { class: 'table-wrap' });
    var t = el('table', stack ? { class: 'stack' } : null);
    var tr = el('tr');
    headers.forEach(function (h) { tr.appendChild(el('th', h.num ? { class: 'num' } : null, h.label)); });
    t.appendChild(el('thead')).appendChild(tr);
    t.appendChild(el('tbody'));
    wrap.appendChild(t);
    return { wrap: wrap, body: t.lastChild, headers: headers };
  }
  function addRow(tb, cells, cls) {
    var tr = el('tr', cls ? { class: cls } : null);
    cells.forEach(function (c, i) {
      var h = tb.headers[i];
      var td = el('td', { 'data-label': h.label, class: h.num ? 'num' : '' });
      if (c && c.nodeType) td.appendChild(c); else td.textContent = c === null || c === undefined ? '' : String(c);
      tr.appendChild(td);
    });
    tb.body.appendChild(tr);
  }
  function tag(text, cls) { return el('span', { class: 'tag ' + cls }, text); }
  function itemCell(q) {
    var s = el('span', null, q.item);
    if (q.note) s.appendChild(el('span', { class: 'sub' }, q.note));
    return s;
  }
  function packDesc(q) {
    var p = [C.fmtMoney(q.packPrice) + ' ' + q.currency + ' / 包'];
    if (q.packCount && q.unitQty && q.unit) p.push('每包 ' + q.packCount + ' 件 × ' + q.unitQty + ' ' + q.unit);
    return p.join(',');
  }

  /* ---------- 比价 ---------- */
  function renderCompare() {
    var groups = C.groupNames(state.quotes);
    var empty = groups.length === 0;
    $('empty-guide').hidden = !empty;
    $('compare-body').hidden = empty;
    if (empty) return;
    if (groups.indexOf(ui.group) < 0) ui.group = groups[0];
    var chips = $('group-chips'); clear(chips);
    groups.forEach(function (g) {
      var b = el('button', { type: 'button', class: 'chip', 'aria-pressed': String(g === ui.group) }, g);
      b.id = 'chip-' + chips.children.length;
      b.addEventListener('click', function () { ui.group = g; ui.focusId = b.id; renderCompare(); applyFocus(); });
      chips.appendChild(b);
    });
    var out = $('rank-out'); clear(out);
    var res = C.rank(state.quotes, ui.group);
    res.partitions.forEach(function (p) {
      var card = el('div', { class: 'card' });
      var h = el('h2', { class: 'part-title' }, ui.group + ' · ' + p.currency);
      h.appendChild(el('span', { class: 'meta' }, C.DIM_NAME[p.dimension] + ',每 ' + p.baseUnit + ' 的价格;最低 ' + C.fmtMoney(p.min) + ' ' + p.currency));
      card.appendChild(h);
      var tb = table([{ label: '排名', num: true }, { label: '供应商' }, { label: '品名' }, { label: '单位价(每 ' + p.baseUnit + ')', num: true },
        { label: '占最低价的百分比(最低价 = 100%)', num: true }, { label: '包装' }, { label: '日期' }], true);
      p.rows.forEach(function (r) {
        var q = r.quote;
        addRow(tb, [r.rank, q.supplier, itemCell(q), C.fmtMoney(r.unitPrice) + ' ' + p.currency,
          r.isMin ? tag('最低价(100%)', 'tag--best') : r.pctOfMin + '%(比最低价贵 ' + r.overMinPct + '%)', packDesc(q), q.date], r.isMin ? 'is-best' : '');
      });
      card.appendChild(tb.wrap);
      out.appendChild(card);
    });
    if (res.partitions.length > 1) {
      out.insertBefore(el('p', { class: 'hint' }, '这个规格组里有不同币种或不同量纲(质量/体积/计数)的报价,已分开排名,互不比较。'), out.firstChild);
    }
    if (res.missing.length) {
      var mc = el('div', { class: 'card' });
      mc.appendChild(el('h2', null, '缺参数,未参与排名'));
      var mt = table([{ label: '供应商' }, { label: '品名' }, { label: '缺什么' }, { label: '包装' }, { label: '日期' }, { label: '操作' }], true);
      res.missing.forEach(function (m) {
        var fix = el('button', { type: 'button', class: 'btn btn--secondary btn--small', 'aria-label': '补齐参数:' + m.quote.supplier + ' ' + m.quote.item }, '补齐参数');
        fix.addEventListener('click', function () { startEdit(m.quote.id, m.field, { view: 'compare', group: m.quote.group }); });
        addRow(mt, [m.quote.supplier, itemCell(m.quote), tag(m.reason, 'tag--warn'), packDesc(m.quote), m.quote.date, fix], 'is-missing');
      });
      mc.appendChild(mt.wrap);
      out.appendChild(mc);
    }
  }

  /* ---------- 全部报价 ---------- */
  function renderAll_() {
    var out = $('all-out'); clear(out);
    if (!state.quotes.length) { out.appendChild(el('p', { class: 'hint' }, '还没有报价。')); return; }
    var tb = table([{ label: '日期' }, { label: '规格组' }, { label: '供应商' }, { label: '品名' }, { label: '包装' }, { label: '单位价', num: true }, { label: '操作' }], true);
    var sorted = state.quotes.slice().sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
    sorted.forEach(function (q) {
      var up = C.unitPrice(q);
      var up_cell = up.ok ? C.fmtMoney(up.value) + ' ' + q.currency + ' / ' + up.baseUnit : tag('缺参数:' + up.reason, 'tag--warn');
      var ops = el('span', { class: 'row' });
      if (ui.confirmDeleteId === q.id) {
        var imp = C.deleteImpact(state.quotes, q.id);
        var box = el('span', { class: 'confirm-inline' });
        box.appendChild(el('span', { class: 'confirm-text' }, '删除 ' + q.date + ' 「' + q.supplier + ' · ' + q.item + '」(' + packDesc(q) + ')这条报价?' + C.describeDelete(imp)));
        var yes = el('button', { type: 'button', class: 'btn btn--danger btn--small', id: 'del-yes-' + q.id, 'aria-label': '确认删除 ' + q.supplier + ' ' + q.item + ' ' + q.date }, '确认删除');
        yes.addEventListener('click', function () { confirmDelete(q.id); });
        var no = el('button', { type: 'button', class: 'btn btn--secondary btn--small', id: 'del-no-' + q.id, 'aria-label': '取消删除 ' + q.supplier + ' ' + q.item + ' ' + q.date }, '取消');
        no.addEventListener('click', function () { ui.confirmDeleteId = null; ui.focusId = 'del-' + q.id; renderAll(); });
        var br = el('span', { class: 'row' }); br.appendChild(yes); br.appendChild(no);
        box.appendChild(br);
        ops.appendChild(box);
      } else {
        var be = el('button', { type: 'button', class: 'btn btn--secondary btn--small', id: 'edit-' + q.id, 'aria-label': '编辑 ' + q.supplier + ' ' + q.item + ' ' + q.date }, '编辑');
        be.addEventListener('click', function () { startEdit(q.id); });
        var bd = el('button', { type: 'button', class: 'btn btn--secondary btn--small', id: 'del-' + q.id, 'aria-label': '删除 ' + q.supplier + ' ' + q.item + ' ' + q.date }, '删除');
        bd.addEventListener('click', function () { ui.confirmDeleteId = q.id; ui.focusId = 'del-no-' + q.id; renderAll(); });
        ops.appendChild(be); ops.appendChild(bd);
      }
      addRow(tb, [q.date, q.group, q.supplier, itemCell(q), packDesc(q), up_cell, ops]);
    });
    out.appendChild(tb.wrap);
  }

  function confirmDelete(id) {
    var rows = state.quotes.slice().sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
    var idx = rows.map(function (x) { return x.id; }).indexOf(id);
    var neighbor = rows[idx + 1] || rows[idx - 1] || null;
    ui.confirmDeleteId = null;
    ui.focusId = neighbor ? 'edit-' + neighbor.id : 'view-all-heading';
    state.quotes = state.quotes.filter(function (x) { return x.id !== id; });
    commit('已删除一条报价。');
  }

  /* ---------- 历史 ---------- */
  function renderHistory() {
    var keys = C.historyKeys(state.quotes);
    var sel = $('hist-key'); clear(sel);
    var out = $('hist-out'); clear(out);
    $('threshold').value = String(state.threshold);
    var wo = $('warn-out'); clear(wo);
    if (!keys.length) {
      out.appendChild(el('p', { class: 'hint' }, '还没有报价。'));
      wo.appendChild(el('p', { class: 'hint' }, '暂无。'));
      return;
    }
    keys.forEach(function (k, i) {
      sel.appendChild(el('option', { value: String(i) }, k.supplier + ' · ' + k.item + '(' + k.count + ' 次)'));
    });
    var idx = keys.findIndex(function (k) { return k.supplier + '\u0000' + k.item === ui.histKey; });
    if (idx < 0) idx = 0;
    ui.histKey = keys[idx].supplier + '\u0000' + keys[idx].item;
    sel.value = String(idx);
    out.appendChild(histTable(C.priceHistory(state.quotes, keys[idx].supplier, keys[idx].item, state.threshold)).wrap);

    var n = 0;
    var wt = table([{ label: '供应商' }, { label: '品名' }, { label: '上次→本次单位价(同币种同量纲的上一条)', num: true }, { label: '涨幅', num: true }, { label: '日期' }], true);
    var comparable = 0;
    keys.forEach(function (k) {
      var h = C.priceHistory(state.quotes, k.supplier, k.item, state.threshold);
      var last = h[h.length - 1];
      if (last && last.changePct !== null) comparable++;
      if (last && last.warn) {
        n++;
        addRow(wt, [k.supplier, k.item, C.fmtMoney(last.prevUnitPrice) + ' → ' + C.fmtMoney(last.unitPrice) + ' ' + last.quote.currency + ' / ' + last.baseUnit + '(上次 ' + last.prevQuote.date + ')',
          tag(fmtPct(last.changePct), 'tag--danger'), last.quote.date]);
      }
    });
    if (n) wo.appendChild(wt.wrap); else wo.appendChild(el('p', { class: 'hint' }, '没有最近一次涨幅超过 ' + state.threshold + '% 的项目(共检查 ' + keys.length + ' 个供应商 + 品名,其中 ' + comparable + ' 个有可比的上一条报价)。'));
  }
  function histTable(h) {
    var tb = table([{ label: '日期' }, { label: '包装' }, { label: '单位价', num: true }, { label: '相对上次', num: true }, { label: '备注' }], true);
    h.forEach(function (e) {
      var change = '';
      if (e.changePct !== null) change = e.warn ? tag(fmtPct(e.changePct) + ' 警示', 'tag--danger') : fmtPct(e.changePct);
      else if (e.unitPrice === null) change = tag('缺参数:' + e.reason, 'tag--warn');
      else change = '首条';
      addRow(tb, [e.quote.date, packDesc(e.quote), e.unitPrice === null ? '' : C.fmtMoney(e.unitPrice) + ' ' + e.quote.currency + ' / ' + e.baseUnit, change, e.quote.note]);
    });
    return tb;
  }

  /* ---------- 导出 ---------- */
  function renderExport() {
    var has = state.quotes.length > 0;
    var draft = draftPresent();
    ['export-rank-csv', 'export-rank-md', 'export-all-csv', 'export-json', 'btn-export-json-top'].forEach(function (id) { $(id).disabled = !has || draft; });
    var reason = draft ? '录入表单或批量粘贴框里有还没保存的内容' + (ui.editId ? '(正在编辑一条报价)' : '') + ',导出内容不含它。请先保存、点「取消编辑」/「清空表单草稿」或清空粘贴框,再导出。' : '';
    $('export-block').hidden = !reason;
    $('export-block').textContent = reason ? '导出已暂停:' + reason : '';
    $('export-hint').hidden = !reason;
    $('export-hint').textContent = reason;
    $('md-preview').textContent = has ? rankMd() : '(还没有报价,无可导出内容)';
  }

  /* ---------- 录入 ---------- */
  function fillSelects() {
    [$('f-currency'), $('b-currency')].forEach(function (s) {
      C.CURRENCIES.forEach(function (c) { s.appendChild(el('option', { value: c }, c)); });
    });
    var u = $('f-unit');
    u.appendChild(el('option', { value: '' }, '(未填)'));
    C.UNIT_LIST.forEach(function (x) { u.appendChild(el('option', { value: x }, x)); });
  }
  function renderGroupList() {
    var dl = $('group-list'); clear(dl);
    C.groupNames(state.quotes).forEach(function (g) { dl.appendChild(el('option', { value: g })); });
  }
  function numOrNull(v) { v = v.trim(); return v === '' ? null : Number(v); }
  function readForm() {
    return {
      supplier: $('f-supplier').value.trim(), item: $('f-item').value.trim(), group: $('f-group').value.trim(),
      currency: $('f-currency').value, packPrice: numOrNull($('f-price').value), packCount: numOrNull($('f-count').value),
      unitQty: numOrNull($('f-qty').value), unit: $('f-unit').value || null, note: $('f-note').value.trim(), date: $('f-date').value
    };
  }
  function updatePreview() {
    var q = readForm(), p = $('form-preview');
    if (q.packPrice === null) { p.textContent = '填写包装价、每包件数、每件净含量和单位后,这里显示换算后的单位价。'; return; }
    var up = C.unitPrice(q);
    p.textContent = up.ok ? '换算:' + C.fmtMoney(up.value) + ' ' + q.currency + ' / ' + up.baseUnit : '暂时无法换算:' + up.reason + '(仍可保存,会标「缺参数」)';
  }
  var FIELD_CTL = { supplier: 'f-supplier', item: 'f-item', group: 'f-group', price: 'f-price', count: 'f-count', qty: 'f-qty', unit: 'f-unit', date: 'f-date' };
  function clearFormErrors() {
    Object.keys(FIELD_CTL).forEach(function (k) {
      var er = $('err-' + k), ctl = $(FIELD_CTL[k]);
      er.hidden = true; er.textContent = '';
      ctl.removeAttribute('aria-describedby'); ctl.removeAttribute('aria-invalid');
    });
    $('form-error').hidden = true;
  }
  /* 错误显示在出错控件旁(aria-describedby),并聚焦第一个出错控件;顶部一句话只做补充 */
  function showFormErrors(list) {
    clearFormErrors();
    if (!list.length) return;
    list.forEach(function (e) {
      var er = $('err-' + e.field), ctl = $(FIELD_CTL[e.field]);
      er.textContent = e.message; er.hidden = false;
      ctl.setAttribute('aria-describedby', 'err-' + e.field); ctl.setAttribute('aria-invalid', 'true');
    });
    $('form-error').textContent = '这条报价没有保存:共 ' + list.length + ' 处需要修改,见标红的输入框。';
    $('form-error').hidden = false;
    $(FIELD_CTL[list[0].field]).focus();
  }
  function resetForm() {
    ui.editId = null;
    ui.returnTo = null;
    $('quote-form').reset();
    $('f-date').value = TODAY;
    $('form-title').textContent = '添加一条报价';
    $('form-submit').textContent = '保存报价';
    $('form-cancel').textContent = '清空表单草稿';
    clearFormErrors();
    updatePreview();
  }
  function startEdit(id, focusField, returnTo) {
    var q = state.quotes.filter(function (x) { return x.id === id; })[0];
    if (!q) return;
    ui.editId = id;
    $('f-supplier').value = q.supplier; $('f-item').value = q.item; $('f-group').value = q.group;
    $('f-currency').value = q.currency; $('f-price').value = q.packPrice;
    $('f-count').value = q.packCount === null ? '' : q.packCount; $('f-qty').value = q.unitQty === null ? '' : q.unitQty;
    $('f-unit').value = q.unit || ''; $('f-note').value = q.note; $('f-date').value = q.date;
    $('form-title').textContent = '编辑报价'; $('form-submit').textContent = '保存修改';
    $('form-cancel').textContent = '取消编辑';
    ui.returnTo = returnTo || null;
    clearFormErrors();
    setView('entry'); updatePreview(); renderExport();
    $(focusField && FIELD_CTL[focusField] ? FIELD_CTL[focusField] : 'f-supplier').focus();
  }
  function onSubmitQuote(e) {
    e.preventDefault();
    var q = readForm();
    var errs = [];
    if (!q.supplier) errs.push({ field: 'supplier', message: '请填写供应商。' });
    if (!q.item) errs.push({ field: 'item', message: '请填写品名。' });
    if (!q.group) errs.push({ field: 'group', message: '请填写规格组(同一类商品放同组,如「鸡蛋」)。' });
    if (!(q.packPrice > 0)) errs.push({ field: 'price', message: '包装价必须大于 0。' });
    if (q.packCount !== null && !(q.packCount > 0)) errs.push({ field: 'count', message: '每包件数必须大于 0,或留空。' });
    if (q.unitQty !== null && !(q.unitQty > 0)) errs.push({ field: 'qty', message: '每件净含量必须大于 0,或留空。' });
    if (!C.validDate(q.date)) errs.push({ field: 'date', message: '请选择有效的报价日期。' });
    if (errs.length) { showFormErrors(errs); return; }
    clearFormErrors();
    var done;
    if (ui.editId) {
      q.id = ui.editId;
      state.quotes = state.quotes.map(function (x) { return x.id === ui.editId ? q : x; });
      done = '已保存修改。';
    } else {
      q.id = C.newId(state.quotes);
      state.quotes.push(q);
      done = '已添加:' + q.supplier + ' · ' + q.item + '。';
    }
    ui.group = q.group;
    var back = ui.returnTo;
    resetForm();
    if (back) { ui.group = back.group; setView(back.view); ui.focusId = 'chip-0'; }
    commit(done);
    if (back) { var chipEl = Array.prototype.filter.call(document.querySelectorAll('.chip'), function (c) { return c.getAttribute('aria-pressed') === 'true'; })[0]; if (chipEl) chipEl.focus(); }
  }
  function onSubmitBatch(e) {
    e.preventDefault();
    var date = $('b-date').value || TODAY;
    var r = C.batchAccept($('batch-text').value, { group: $('b-group').value.trim(), currency: $('b-currency').value, date: date });
    var list = $('batch-errors'); clear(list);
    if (!r.ok) {
      $('batch-text').setAttribute('aria-describedby', 'batch-errors'); $('batch-text').setAttribute('aria-invalid', 'true');
      r.errors.forEach(function (er) { list.appendChild(el('li', null, er.line > 0 ? '第 ' + er.line + ' 行:' + er.message : er.message)); });
      if (r.errors[0].line > 0) list.insertBefore(el('li', null, '有 ' + r.errors.length + ' 行不合法,整批都没有导入。请改正后重新导入:'), list.firstChild);
      list.hidden = false;
      $('batch-text').focus();
      return;
    }
    list.hidden = true;
    $('batch-text').removeAttribute('aria-describedby'); $('batch-text').removeAttribute('aria-invalid');
    r.rows.forEach(function (row) { row.id = C.newId(state.quotes); state.quotes.push(row); });
    ui.group = r.rows[0].group;
    $('batch-text').value = '';
    commit('已导入 ' + r.rows.length + ' 条报价。');
  }

  /* ---------- 确认区 / 视图 ---------- */
  function askConfirm(text, fn) {
    ui.pendingConfirm = fn;
    ui.confirmBack = document.activeElement && document.activeElement.id && document.activeElement.tagName === 'BUTTON' ? document.activeElement.id : 'btn-import';
    $('confirm-text').textContent = text;
    $('confirm-box').hidden = false;
    $('btn-confirm-yes').focus();
  }
  function closeConfirm() { ui.pendingConfirm = null; $('confirm-box').hidden = true; }
  function cancelConfirm() { var back = ui.confirmBack; closeConfirm(); if (back && $(back)) $(back).focus(); }

  function setView(v) {
    ui.view = v;
    document.querySelectorAll('.view').forEach(function (s) { s.hidden = s.id !== 'view-' + v; });
    document.querySelectorAll('.tab').forEach(function (t) {
      if (t.getAttribute('data-view') === v) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
  }
  function renderAll() {
    $('sample-badge').hidden = !state.sample;
    var fixed = C.fixedToday(location.search);
    $('today-banner').hidden = !fixed;
    if (fixed) $('today-banner').textContent = '基准日 ' + fixed + '(由地址参数固定)。新报价的默认日期和导出文件名都用它。';
    renderGroupList(); renderCompare(); renderAll_(); renderHistory(); renderExport();
    applyFocus();
  }

  /* ---------- 导入 JSON ---------- */
  function onImportFile(e) {
    var f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    var box = $('import-error');
    var reader = new FileReader();
    reader.onload = function () {
      var obj;
      try { obj = JSON.parse(String(reader.result)); } catch (er) {
        box.textContent = '导入被拒绝:文件不是有效的 JSON。现有数据没有改动。'; box.hidden = false; return;
      }
      var v = C.validateImport(obj);
      if (!v.ok) {
        box.textContent = '导入被拒绝,现有数据没有改动。原因:' + v.errors.slice(0, 6).join(';') + (v.errors.length > 6 ? ';……共 ' + v.errors.length + ' 处' : '');
        box.hidden = false; return;
      }
      box.hidden = true;
      var sc = scopeNow();
      askConfirm('备份文件通过校验:' + v.data.quotes.length + ' 条报价,涨幅阈值 ' + v.data.threshold + '%' + (v.data.sample ? '(文件标注为合成示例)' : '') + '。确认后会替换' + (sc.any ? '你现有的:' + C.describeScope(sc) : '当前的空白状态') + '。确认前现有数据不变。', function () {
        state.quotes = v.data.quotes; state.threshold = v.data.threshold; state.sample = v.data.sample; ui.group = null; ui.histKey = null;
        resetForm(); $('batch-text').value = '';
        commit('已导入 ' + v.data.quotes.length + ' 条报价。');
      });
    };
    reader.readAsText(f);
  }

  function bind() {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () { setView(t.getAttribute('data-view')); });
    });
    $('btn-sample').addEventListener('click', function () {
      var go = function () {
        var v = C.validateImport(JSON.parse(JSON.stringify(globalThis.PROCURE_SAMPLE)));
        state.quotes = v.data.quotes; state.threshold = v.data.threshold; state.sample = true; ui.group = null; ui.histKey = null;
        resetForm(); $('batch-text').value = '';
        $('import-error').hidden = true;
        commit('已载入合成示例(18 条虚构报价)。');
      };
      var sc = scopeNow();
      if (sc.any) askConfirm('载入合成示例会替换你现有的:' + C.describeScope(sc) + '。此操作不能撤销,建议先导出 JSON 备份。确认?', go); else go();
    });
    $('btn-clear').addEventListener('click', function () {
      var sc = scopeNow();
      askConfirm(sc.any ? '确认清空?将清空:' + C.describeScope(sc) + '。此操作不能撤销,建议先导出 JSON 备份。' : '当前没有任何数据,清空不会改变什么。', function () {
        state.quotes = []; state.threshold = 10; state.sample = false; ui.group = null; ui.histKey = null; resetForm(); $('batch-text').value = '';
        ui.focusId = 'btn-clear';
        commit('已清空。');
      });
    });
    $('btn-confirm-yes').addEventListener('click', function () { var fn = ui.pendingConfirm; closeConfirm(); if (fn) fn(); });
    $('btn-confirm-no').addEventListener('click', cancelConfirm);
    $('btn-export-json-top').addEventListener('click', exportJson);
    $('btn-save-warning-export').addEventListener('click', backupDownload);
    $('btn-import').addEventListener('click', function () { $('file-import').click(); });
    $('btn-import-2').addEventListener('click', function () { $('file-import').click(); });
    $('batch-clear').addEventListener('click', function () { $('batch-text').value = ''; $('batch-errors').hidden = true; $('batch-text').removeAttribute('aria-invalid'); $('batch-text').focus(); renderExport(); });
    $('batch-text').addEventListener('input', renderExport);
    $('export-json').addEventListener('click', exportJson);
    $('file-import').addEventListener('change', onImportFile);
    $('quote-form').addEventListener('submit', onSubmitQuote);
    $('quote-form').addEventListener('input', function () { updatePreview(); renderExport(); });
    $('form-cancel').addEventListener('click', function () {
      var back = ui.returnTo;
      resetForm();
      if (back) { ui.group = back.group; setView(back.view); renderAll(); }
      else { renderExport(); $('f-supplier').focus(); }
    });
    $('batch-form').addEventListener('submit', onSubmitBatch);
    $('hist-key').addEventListener('change', function () {
      var keys = C.historyKeys(state.quotes), k = keys[Number($('hist-key').value)];
      if (k) ui.histKey = k.supplier + '\u0000' + k.item;
      renderHistory();
    });
    $('threshold').addEventListener('change', function () {
      var v = Number($('threshold').value);
      var te = $('threshold-error');
      if ($('threshold').value.trim() === '' || !isFinite(v) || v < 0 || v > 1000) {
        $('threshold').value = String(state.threshold);
        te.textContent = '阈值必须是 0 到 1000 之间的数字,已恢复为 ' + state.threshold + '%。'; te.hidden = false;
        $('threshold').setAttribute('aria-invalid', 'true'); $('threshold').focus();
        return;
      }
      te.hidden = true; $('threshold').removeAttribute('aria-invalid');
      state.threshold = v;
      commit('阈值已设为 ' + v + '%。');
    });
    $('export-rank-csv').addEventListener('click', function () {
      if (draftPresent()) { renderExport(); return; }
      var t = C.rankTable(allRanks(), { sample: state.sample }); download('比价表-' + TODAY + '.csv', C.toCsv(t.headers, t.rows), 'text/csv', true);
    });
    $('export-rank-md').addEventListener('click', function () { if (draftPresent()) { renderExport(); return; } download('比价表-' + TODAY + '.md', rankMd(), 'text/markdown'); });
    $('export-all-csv').addEventListener('click', function () {
      if (draftPresent()) { renderExport(); return; }
      var t = C.quotesTable(state.quotes, { sample: state.sample }); download('全部报价-' + TODAY + '.csv', C.toCsv(t.headers, t.rows), 'text/csv', true);
    });
  }

  fillSelects();
  load();
  bind();
  resetForm();
  $('b-date').value = TODAY;
  setView('compare');
  renderAll();
})();
