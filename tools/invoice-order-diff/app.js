/* 发票与订单差异核对 · 界面与交互。所有用户输入通过 textContent 渲染,不拼接 innerHTML。 */
(function () {
  'use strict';

  var C = globalThis.InvoiceCore;
  var STORAGE_KEY = 'invoicecheck.v1';
  var DEFAULT_PARAMS = { tolAbs: '0.01', tolPct: '0.5', tax: '13', byName: false };

  var ORDER_ROLES = [
    { id: 'orderNo', label: '订单号', required: true },
    { id: 'name', label: '品名' },
    { id: 'qty', label: '数量' },
    { id: 'price', label: '单价' },
    { id: 'amount', label: '金额', required: true }
  ];
  var INVOICE_ROLES = [
    { id: 'invoiceNo', label: '发票号', required: true },
    { id: 'orderNo', label: '订单号', required: true },
    { id: 'name', label: '品名' },
    { id: 'qty', label: '数量' },
    { id: 'price', label: '单价' },
    { id: 'tax', label: '税额' },
    { id: 'amount', label: '金额(不含税)', guessId: 'amount', required: true }
  ];

  var state = loadState();
  var ui = {
    sig: { orders: null, invoices: null },
    mapping: { orders: {}, invoices: {} },
    tables: { orders: null, invoices: null },
    result: null, suppressNext: false, flashTimer: null
  };

  /* ---------- 存储(只存核对参数与「已载入示例」标记;不存上传的文件) ---------- */
  function copyParams(p) { return { tolAbs: p.tolAbs, tolPct: p.tolPct, tax: p.tax, byName: !!p.byName }; }
  function loadState() {
    var s = { sample: false, params: copyParams(DEFAULT_PARAMS), orders: '', invoices: '' };
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return s;
      var v = JSON.parse(raw);
      if (v && typeof v === 'object' && v.params && typeof v.params === 'object') {
        var p = v.params;
        if (typeof p.tolAbs === 'string' && typeof p.tolPct === 'string' && typeof p.tax === 'string' && typeof p.byName === 'boolean') {
          s.params = copyParams(p);
        }
        if (v.sample === true && globalThis.INVOICE_SAMPLE) {
          s.sample = true;
          s.orders = globalThis.INVOICE_SAMPLE.orders;
          s.invoices = globalThis.INVOICE_SAMPLE.invoices;
        }
      }
    } catch (e) { /* 读取失败按空状态处理 */ }
    return s;
  }
  /* 返回是否真正写入;失败时显示持续可见的「未保存」提示,并让紧随其后的成功提示不出现 */
  function save() {
    var ok = true;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, sample: state.sample, params: state.params }));
    } catch (e) { ok = false; }
    $('save-warning').hidden = ok;
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
  function money(n) { return n == null ? '' : Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  function flash(msg, kind) {
    if (ui.suppressNext) { ui.suppressNext = false; return; }
    var n = $('flash');
    n.className = 'notice' + (kind ? ' notice--' + kind : '');
    n.textContent = msg;
    n.hidden = false;
    clearTimeout(ui.flashTimer);
    ui.flashTimer = setTimeout(function () { n.hidden = true; }, 6000);
  }

  function table(columns, rows) {
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
      var tr = el('tr');
      columns.forEach(function (c) {
        var td = el('td', c.num ? 'num' : '', [c.cell(r)]);
        td.setAttribute('data-label', c.label);
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    t.appendChild(body);
    wrap.appendChild(t);
    return wrap;
  }
  function tag(level) {
    var label = { block: '阻断', warn: '警告', ok: '正常' }[level];
    return el('span', 'tag tag--' + level, [label]);
  }

  /* ---------- 输入与列映射 ---------- */
  var DELIM_NAME = { '\t': '制表符', ',': '逗号', ';': '分号' };

  function rolesOf(kind) { return kind === 'orders' ? ORDER_ROLES : INVOICE_ROLES; }

  function syncTable(kind) {
    var text = $(kind + '-text').value;
    var t = C.parseTable(text);
    ui.tables[kind] = t;
    var sig = JSON.stringify(t.headers);
    var info = $(kind + '-info');
    if (!t.headers.length) {
      info.textContent = '尚未输入。';
    } else {
      info.textContent = '已识别 ' + t.rows.length + ' 行数据、' + t.headers.length + ' 列,分隔符:' + DELIM_NAME[t.delimiter] + '。' + (t.error ? ' 注意:' + t.error + '。' : '');
    }
    if (sig !== ui.sig[kind]) {
      ui.sig[kind] = sig;
      var m = {};
      rolesOf(kind).forEach(function (r) { m[r.id] = C.guessMapping(t.headers, r.guessId || r.id); });
      ui.mapping[kind] = m;
      renderMapping(kind);
    }
  }

  function renderMapping(kind) {
    var box = $(kind + '-map');
    clear(box);
    var t = ui.tables[kind];
    if (!t || !t.headers.length) return;
    rolesOf(kind).forEach(function (role) {
      var sel = el('select');
      sel.id = kind + '-col-' + role.id;
      sel.appendChild(el('option', '', [role.required ? '(请选择)' : '(不使用)']));
      sel.firstChild.value = '-1';
      t.headers.forEach(function (h, i) {
        var o = el('option', '', ['第 ' + (i + 1) + ' 列 · ' + (h || '(空表头)')]);
        o.value = String(i);
        sel.appendChild(o);
      });
      sel.value = String(ui.mapping[kind][role.id]);
      sel.addEventListener('change', function () {
        ui.mapping[kind][role.id] = Number(sel.value);
        recompute();
      });
      var lab = el('label', 'field', [el('span', '', [role.label, role.required ? el('span', 'field__req', [' 必选']) : null]), sel]);
      box.appendChild(lab);
    });
  }

  /* ---------- 参数 ---------- */
  function readParams() {
    var errors = [];
    var p = state.params;
    var tolAbs = p.tolAbs.trim() === '' ? C.DEFAULTS.tolAbs : C.normalizeNumber(p.tolAbs);
    var tolPct = p.tolPct.trim() === '' ? C.DEFAULTS.tolPct : C.normalizeNumber(p.tolPct);
    var tax = p.tax.trim() === '' ? null : C.normalizeNumber(p.tax);
    var bad = [];
    if (tolAbs === null || tolAbs < 0) { errors.push('金额容差必须是不小于 0 的数字。'); bad.push('p-tolabs'); }
    if (tolPct === null || tolPct < 0) { errors.push('百分比容差必须是不小于 0 的数字。'); bad.push('p-tolpct'); }
    if (p.tax.trim() !== '' && (tax === null || tax < 0)) { errors.push('税率必须是不小于 0 的数字,或者留空。'); bad.push('p-tax'); }
    return { errors: errors, bad: bad, options: { tolAbs: tolAbs, tolPct: tolPct, taxRate: tax, matchByName: !!p.byName } };
  }

  /* ---------- 计算与渲染 ---------- */
  function recompute() {
    var hasOrders = ui.tables.orders.headers.length > 0, hasInvoices = ui.tables.invoices.headers.length > 0;
    $('empty-guide').hidden = hasOrders || hasInvoices;
    var results = $('results');
    $('sample-badge').hidden = !state.sample;
    var perr = $('param-error');
    var pr = readParams();
    perr.hidden = pr.errors.length === 0;
    perr.textContent = pr.errors.join(' ');
    ['p-tolabs', 'p-tolpct', 'p-tax'].forEach(function (id) {
      if (pr.bad.indexOf(id) >= 0) $(id).setAttribute('aria-invalid', 'true'); else $(id).removeAttribute('aria-invalid');
    });
    ui.result = null;
    var msg = '';
    if (!hasOrders || !hasInvoices) {
      msg = (hasOrders || hasInvoices) ? '订单表和发票表都需要粘贴(或选择文件)后才能核对。' : '';
    } else if (pr.errors.length) {
      msg = '核对参数有误,请先修正上方的参数。';
    } else {
      var r = C.reconcile(ui.tables.orders, ui.tables.invoices, { orders: ui.mapping.orders, invoices: ui.mapping.invoices }, pr.options);
      if (r.error) msg = r.error; else ui.result = r;
    }
    results.hidden = !(hasOrders || hasInvoices);
    var re = $('result-error');
    re.hidden = !msg;
    re.textContent = msg;
    $('result-body').hidden = !ui.result;
    ['btn-export-review-csv', 'btn-export-review-md', 'btn-export-pairs-csv', 'btn-save-warning-export'].forEach(function (id) {
      $(id).disabled = !ui.result;
    });
    if (ui.result) renderResult();
  }

  function statCard(label, value, cls) {
    return el('div', 'stat' + (cls ? ' stat--' + cls : ''), [el('span', 'stat__label', [label]), el('span', 'stat__value', [value])]);
  }

  function renderResult() {
    var res = ui.result, s = res.summary;
    var sum = $('summary');
    clear(sum);
    sum.appendChild(statCard('订单行数', String(s.orderCount)));
    sum.appendChild(statCard('发票行数', String(s.invoiceCount)));
    sum.appendChild(statCard('已配对行数', String(s.paired)));
    sum.appendChild(statCard('阻断', String(s.blockCount), s.blockCount ? 'block' : 'ok'));
    sum.appendChild(statCard('警告', String(s.warnCount), s.warnCount ? 'warn' : 'ok'));
    sum.appendChild(statCard('订单金额合计(元)', money(s.orderTotal)));
    sum.appendChild(statCard('发票金额合计(元)', money(s.invoiceTotal)));
    sum.appendChild(statCard('差额(发票 - 订单,元)', money(s.diff), s.diff === 0 ? 'ok' : 'warn'));

    var filter = $('issue-filter').value;
    var list = res.issues.filter(function (i) { return filter === 'all' || i.level === filter; });
    var box = $('issue-list');
    clear(box);
    if (!list.length) {
      box.appendChild(el('p', 'empty', [res.issues.length ? '当前筛选下没有条目。' : '没有发现需要复核的差异(两张表均已完整解析并核对)。']));
    } else {
      box.appendChild(table([
        { label: '级别', cell: function (i) { return tag(i.level); } },
        { label: '类别', cell: function (i) { return i.title; } },
        { label: '订单号', cell: function (i) { return i.orderNo; } },
        { label: '发票号', cell: function (i) { return i.invoiceNo; } },
        { label: '原行号', cell: function (i) { return i.location; } },
        { label: '说明', cell: function (i) { return i.detail; } }
      ], list));
    }

    var okPairs = res.pairs.filter(function (p) { return p.status === 'ok'; });
    $('ok-summary').textContent = '一致的配对(' + okPairs.length + ' 对,点开查看)';
    var okBox = $('ok-list');
    clear(okBox);
    if (!okPairs.length) okBox.appendChild(el('p', 'empty', ['没有完全一致的配对。']));
    else okBox.appendChild(table([
      { label: '状态', cell: function () { return tag('ok'); } },
      { label: '订单号', cell: function (p) { return p.orderNo; } },
      { label: '发票号', cell: function (p) { return p.invoiceNo; } },
      { label: '品名', cell: function (p) { return p.name; } },
      { label: '订单行', num: true, cell: function (p) { return p.orderRow; } },
      { label: '发票行', num: true, cell: function (p) { return p.invoiceRow; } },
      { label: '订单金额(元)', num: true, cell: function (p) { return money(p.orderAmount); } },
      { label: '发票金额(元)', num: true, cell: function (p) { return money(p.invoiceAmount); } }
    ], okPairs));
  }

  /* ---------- 导出(与界面同一份 ui.result) ---------- */
  function download(name, text, mime, bom) {
    var blob = new Blob([bom ? '﻿' + text : text], { type: mime + ';charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function exportReviewCsv() {
    if (!ui.result) return;
    download('待复核清单.csv', C.toCsv(C.reviewRows(ui.result, { sample: state.sample })), 'text/csv', true);
    flash('已生成待复核清单 CSV(共 ' + ui.result.issues.length + ' 条)。', 'ok');
  }
  function exportReviewMd() {
    if (!ui.result) return;
    download('待复核清单.md', C.toMarkdown(ui.result, undefined, { sample: state.sample }), 'text/markdown', false);
    flash('已生成待复核清单 Markdown。', 'ok');
  }
  function exportPairsCsv() {
    if (!ui.result) return;
    download('全部配对结果.csv', C.toCsv(C.pairRows(ui.result)), 'text/csv', true);
    flash('已生成全部配对结果 CSV。', 'ok');
  }

  /* ---------- 参数输入同步 ---------- */
  function paramsToInputs() {
    $('p-tolabs').value = state.params.tolAbs;
    $('p-tolpct').value = state.params.tolPct;
    $('p-tax').value = state.params.tax;
    $('p-byname').checked = state.params.byName;
  }
  function onParamChange() {
    state.params = {
      tolAbs: $('p-tolabs').value, tolPct: $('p-tolpct').value, tax: $('p-tax').value, byName: $('p-byname').checked
    };
    save();
    recompute();
  }

  function onTextEdited() {
    if (state.sample) { state.sample = false; save(); }
    syncTable('orders');
    syncTable('invoices');
    recompute();
  }

  function decodeBuffer(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { /* 不是 UTF-8 */ }
    try { return new TextDecoder('gbk').decode(buf); } catch (e2) { /* 浏览器不支持 */ }
    return new TextDecoder('utf-8').decode(buf);
  }
  function readFile(kind, file) {
    if (!file) return;
    file.arrayBuffer().then(function (buf) {
      $(kind + '-text').value = decodeBuffer(buf);
      onTextEdited();
      flash('已读取文件「' + file.name + '」(只在本页内存中,不保存)。', 'ok');
    }, function () { flash('读取文件失败,请改用粘贴。', 'warn'); });
  }

  function paramsChanged() {
    var p = state.params, d = DEFAULT_PARAMS;
    return p.tolAbs !== d.tolAbs || p.tolPct !== d.tolPct || p.tax !== d.tax || p.byName !== d.byName;
  }
  function hasUserData() {
    var S = globalThis.INVOICE_SAMPLE;
    var o = $('orders-text').value, i = $('invoices-text').value;
    var pristineSample = state.sample && S && o === S.orders && i === S.invoices && !paramsChanged();
    if (pristineSample) return false;
    return o.trim() !== '' || i.trim() !== '' || paramsChanged();
  }
  function describeData() {
    var parts = [];
    var o = ui.tables.orders, i = ui.tables.invoices;
    if ($('orders-text').value.trim()) parts.push('订单表 ' + (o ? o.rows.length : 0) + ' 行');
    if ($('invoices-text').value.trim()) parts.push('发票表 ' + (i ? i.rows.length : 0) + ' 行');
    if (paramsChanged()) parts.push('已修改的核对参数');
    return parts.join('、');
  }
  function requestSample() {
    $('clear-confirm').hidden = true;
    if (!hasUserData()) { loadSample(); return; }
    $('sample-scope').textContent = '当前的' + describeData() + '会被示例替换,核对参数会重置为默认值;此操作不能撤销。';
    $('sample-confirm').hidden = false;
    $('btn-sample-yes').focus();
  }
  function loadSample() {
    var S = globalThis.INVOICE_SAMPLE;
    $('sample-confirm').hidden = true;
    $('orders-text').value = S.orders;
    $('invoices-text').value = S.invoices;
    state.sample = true;
    state.params = copyParams(DEFAULT_PARAMS);
    paramsToInputs();
    syncTable('orders');
    syncTable('invoices');
    recompute();
    save();
    flash('已载入合成示例(虚构数据):12 条订单、13 条发票。', 'ok');
  }

  function requestClear() {
    $('sample-confirm').hidden = true;
    var d = describeData();
    $('clear-scope').textContent = (d ? d + '会被清空,' : '') + '两张表及核对参数都会回到初始状态。';
    $('clear-confirm').hidden = false;
    $('btn-clear-no').focus();
  }
  function clearAll() {
    $('orders-text').value = '';
    $('invoices-text').value = '';
    $('orders-file').value = '';
    $('invoices-file').value = '';
    state.sample = false;
    state.params = copyParams(DEFAULT_PARAMS);
    paramsToInputs();
    syncTable('orders');
    syncTable('invoices');
    recompute();
    $('clear-confirm').hidden = true;
    save();
    flash('已清空两张表及核对参数。', 'ok');
  }

  /* ---------- 启动 ---------- */
  function init() {
    $('orders-text').value = state.orders;
    $('invoices-text').value = state.invoices;
    paramsToInputs();
    syncTable('orders');
    syncTable('invoices');
    recompute();

    $('orders-text').addEventListener('input', onTextEdited);
    $('invoices-text').addEventListener('input', onTextEdited);
    $('orders-file').addEventListener('change', function (e) { readFile('orders', e.target.files[0]); });
    $('invoices-file').addEventListener('change', function (e) { readFile('invoices', e.target.files[0]); });
    ['p-tolabs', 'p-tolpct', 'p-tax'].forEach(function (id) { $(id).addEventListener('input', onParamChange); });
    $('p-byname').addEventListener('change', onParamChange);
    $('issue-filter').addEventListener('change', function () { if (ui.result) renderResult(); });
    $('btn-sample').addEventListener('click', requestSample);
    $('btn-sample-2').addEventListener('click', requestSample);
    $('btn-sample-yes').addEventListener('click', loadSample);
    $('btn-sample-no').addEventListener('click', function () { $('sample-confirm').hidden = true; });
    $('btn-clear').addEventListener('click', requestClear);
    $('btn-clear-no').addEventListener('click', function () { $('clear-confirm').hidden = true; });
    $('btn-clear-yes').addEventListener('click', clearAll);
    $('btn-export-review-csv').addEventListener('click', exportReviewCsv);
    $('btn-export-review-md').addEventListener('click', exportReviewMd);
    $('btn-export-pairs-csv').addEventListener('click', exportPairsCsv);
    $('btn-save-warning-export').addEventListener('click', exportReviewCsv);
  }

  init();
})();
