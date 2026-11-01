/* 应收账款跟进清单 · 界面与交互。所有用户输入通过 textContent / value 渲染,不拼接 innerHTML。 */
(function () {
  'use strict';

  var C = globalThis.ReceivablesCore;
  var S = globalThis.ReceivablesSample;
  var STORAGE_KEY = 'receivables.v1';

  function pad(n) { return String(n).padStart(2, '0'); }
  function localToday() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  var TODAY = C.resolveToday(location.search, localToday());
  var TODAY_FIXED = TODAY !== localToday() || /[?&]today=/.test(location.search);

  var rejectedStoredRaw = null;
  var rejectedStoredReason = '';
  var storageReadFailed = false;
  var state = load();
  var ui = {
    view: 'aging', selected: null, editing: null, deleting: null, onlyToday: false,
    suppressNext: false, pendingImport: null, batch: { rows: [], errors: [] }, csv: { table: null, mapping: null, result: null }
  };

  /* ---------- 存储 ---------- */
  function empty() { return { bills: [], settings: { template: C.DEFAULT_TEMPLATE, n: C.DEFAULT_N }, sample: false }; }
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) return empty();
      var v = C.validateImport(raw);
      if (v.ok) return v.data;
      rejectedStoredRaw = raw;
      rejectedStoredReason = v.error;
      return empty();
    } catch (e) { storageReadFailed = true; rejectedStoredReason = '无法读取原存档,本页始终禁止写入和清空。请导出当前内存备份,并重新打开页面后重试'; return empty(); }
  }
  /* 返回是否真正写入;失败时显示持续可见的「未保存」提示,并让紧随其后的成功提示不出现 */
  function save() {
    var ok = true;
    if (storageReadFailed || rejectedStoredRaw !== null) {
      $('storage-recovery').hidden = false;
      $('storage-recovery-reason').textContent = '原因:' + rejectedStoredReason + '。';
      $('save-warning').hidden = false;
      ui.suppressNext = true;
      return false;
    }
    try {
      var json = C.exportJson(state.bills, state.settings, state.sample);
      /* 写入前用读取时同一个校验函数自检,保证写进去的一定读得回来 */
      if (!C.validateImport(json).ok) ok = false;
      else localStorage.setItem(STORAGE_KEY, json);
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
  function money(n) { return C.formatMoney(n); }
  function btn(label, cls, onClick) {
    var b = el('button', 'btn ' + cls, [label]);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }
  function tag(text, cls) { return el('span', 'tag tag--' + cls, [text]); }
  function field(label, input, wide) {
    var l = el('label', 'field' + (wide ? ' field--wide' : ''), [label, input]);
    return l;
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

  /* columns = [{label, num, cls, cell(row) -> 文本或节点}];窄屏由 CSS 用 data-label 堆叠 */
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
      var tr = el('tr', (r.muted ? 'is-muted ' : '') + (r.selected ? 'is-selected' : ''));
      columns.forEach(function (c) {
        var td = el('td', (c.num ? 'num ' : '') + (c.cls || ''), [c.cell(r.data)]);
        td.setAttribute('data-label', c.label);
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    t.appendChild(body);
    wrap.appendChild(t);
    return wrap;
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function downloadCsv(name, text) { download(name, '\uFEFF' + text, 'text/csv;charset=utf-8'); }

  /* ---------- 状态读取 ---------- */
  function billById(id) {
    for (var i = 0; i < state.bills.length; i++) if (state.bills[i].id === id) return state.bills[i];
    return null;
  }
  function replaceBill(next) {
    state.bills = state.bills.map(function (b) { return b.id === next.id ? next : b; });
  }
  function followList() { return C.followUpList(state.bills, TODAY, state.settings.n); }
  function statusText(s) { return s === 'today' ? '今天要跟' : s === 'disputed' ? '有争议,人工处理' : '近期已跟进'; }

  /* ---------- 视图切换 ---------- */
  function setView(name) {
    ui.view = name;
    document.querySelectorAll('.tab').forEach(function (t) {
      if (t.getAttribute('data-view') === name) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    document.querySelectorAll('.view').forEach(function (v) { v.hidden = v.id !== 'view-' + name; });
  }

  /* ---------- 渲染 ---------- */
  function renderAll() {
    renderMeta();
    renderAging();
    renderSettings();
    renderFollow();
    renderBills();
    renderWork();
  }

  function renderMeta() {
    $('today-label').textContent = TODAY;
    $('today-note').textContent = TODAY_FIXED ? '(由地址参数固定)' : '';
    $('sample-badge').hidden = !state.sample;
    var has = state.bills.length > 0;
    $('empty-guide').hidden = has;
    $('aging-body').hidden = !has;
    $('bill-count').textContent = String(state.bills.length);
    var fl = followList();
    var todo = fl.filter(function (x) { return x.needsFollow; }).length;
    var fc = $('follow-count');
    fc.textContent = String(todo);
    fc.className = 'count' + (todo > 0 ? ' count--alert' : '');
    var pending = !!ui.editing || ui.batch.rows.length > 0 || !!ui.csv.table;
    $('export-pending').hidden = !(pending && has);
    $('btn-aging-md').disabled = !has || pending;
    $('btn-aging-csv').disabled = !has || pending;
    $('btn-aging-detail-csv').disabled = !has || pending;
    $('btn-follow-csv').disabled = fl.length === 0 || pending;
  }

  function renderAging() {
    var out = $('aging-out');
    clear(out);
    var report = C.agingReport(state.bills, TODAY);
    if (report.error) {
      out.appendChild(el('p', 'notice notice--danger', [report.error]));
      return;
    }
    if (report.groups.length === 0) {
      out.appendChild(el('p', 'empty', ['所有账单的余额都是 0,没有需要跟进的应收。']));
      return;
    }
    report.groups.forEach(function (g) {
      var head = el('div', 'aging-group__head', [
        el('h3', '', [g.currency + ' 应收余额']),
        el('span', 'aging-group__total', [g.currency + ' ' + money(g.total) + '(' + g.count + ' 笔)'])
      ]);
      var rows = el('div', 'aging-rows');
      g.buckets.forEach(function (b) {
        var bar = el('div', 'aging-row__bar');
        bar.style.width = (g.cents > 0 ? (b.cents / g.cents) * 100 : 0) + '%';
        var row = el('div', 'aging-row', [
          el('span', 'aging-row__label', [b.label]),
          el('div', 'aging-row__track', [bar]),
          el('span', 'aging-row__value', [el('strong', '', [money(b.amount)]), el('span', 'aging-row__count', ['  ' + b.count + ' 笔'])])
        ]);
        row.setAttribute('data-bucket', b.key);
        rows.appendChild(row);
      });
      out.appendChild(el('div', 'aging-group', [head, rows]));
    });
  }

  function renderSettings() {
    var n = $('fu-n');
    if (document.activeElement !== n) n.value = String(state.settings.n);
    var t = $('fu-template');
    if (document.activeElement !== t) t.value = state.settings.template;
  }

  function workButton(id) {
    return btn('处理', 'btn--secondary btn--small', function () { openWork(id); });
  }

  function renderFollow() {
    var out = $('follow-out');
    clear(out);
    var list = followList();
    if (ui.onlyToday) list = list.filter(function (x) { return x.needsFollow; });
    if (list.length === 0) {
      out.appendChild(el('p', 'empty', [state.bills.length === 0 ? '还没有账单。' : ui.onlyToday ? '今天没有需要跟进的逾期账单。' : '没有逾期且有余额的账单。']));
      return;
    }
    out.appendChild(table([
      { label: '客户', cell: function (it) { return it.bill.client; } },
      { label: '账单号', cell: function (it) { return it.bill.no; } },
      { label: '到期日', cell: function (it) { return it.bill.dueDate; } },
      { label: '逾期天数', num: true, cell: function (it) { return it.overdue + ' 天'; } },
      { label: '账龄', cell: function (it) { return tag(C.bucketLabel(it.bucket), 'b-' + it.bucket); } },
      { label: '余额', num: true, cell: function (it) { return it.bill.currency + ' ' + money(it.balance); } },
      { label: '最近跟进', cell: function (it) { return it.bill.lastFollow ? it.bill.lastFollow + '(' + it.daysSinceFollow + ' 天前)' : '从未跟进'; } },
      { label: '状态', cell: function (it) { return tag(statusText(it.status), it.status); } },
      { label: '操作', cls: 'actions', cell: function (it) { return workButton(it.bill.id); } }
    ], list.map(function (it) { return { data: it, selected: it.bill.id === ui.selected }; })));
  }

  function renderBills() {
    var out = $('bills-out');
    clear(out);
    if (state.bills.length === 0) { out.appendChild(el('p', 'empty', ['还没有账单。'])); return; }
    var sorted = state.bills.slice().sort(function (a, b) {
      return (a.client < b.client ? -1 : a.client > b.client ? 1 : 0) || (a.dueDate < b.dueDate ? -1 : 1);
    });
    out.appendChild(table([
      { label: '客户', cell: function (b) { return b.client; } },
      { label: '账单号', cell: function (b) { return b.no; } },
      { label: '到期日', cell: function (b) { return b.dueDate; } },
      { label: '应收', num: true, cell: function (b) { return b.currency + ' ' + money(b.amount); } },
      { label: '已收', num: true, cell: function (b) { return money(b.paid); } },
      { label: '余额', num: true, cell: function (b) { return money(C.balance(b)); } },
      { label: '账龄', cell: function (b) {
        var k = C.ageBucket(b, TODAY);
        return k ? tag(C.bucketLabel(k), 'b-' + k) : tag('已结清', 'settled');
      } },
      { label: '争议', cell: function (b) { return C.isDisputed(b) ? tag('有争议', 'disputed') : '无'; } },
      { label: '操作', cls: 'actions', cell: function (b) {
        return el('span', '', [
          workButton(b.id),
          btn('编辑', 'btn--secondary btn--small', function () { startEdit(b.id); }),
          btn('删除', 'btn--danger-ghost btn--small', function () { askDelete(b.id); })
        ]);
      } }
    ], sorted.map(function (b) { return { data: b, muted: C.balance(b) <= 0, selected: b.id === ui.selected }; })));
  }

  /* ---------- 详情工作面板 ---------- */
  function openWork(id) {
    ui.selected = id;
    setView('follow');
    renderAll();
    var p = $('work-panel');
    if (p.scrollIntoView) p.scrollIntoView({ block: 'nearest' });
  }
  function closeWork() { ui.selected = null; renderAll(); }

  function renderWork() {
    var p = $('work-panel');
    clear(p);
    var b = ui.selected ? billById(ui.selected) : null;
    if (!b) { p.hidden = true; return; }
    p.hidden = false;
    var overdue = C.overdueDays(b, TODAY);
    var bal = C.balance(b);
    var disputed = C.isDisputed(b);

    var head = el('div', 'panel__head', [
      el('h2', '', [b.client + ' · ' + b.no]),
      btn('关闭详情', 'btn--secondary', closeWork)
    ]);

    var facts = el('dl', 'facts');
    [
      ['应收 / 已收', b.currency + ' ' + money(b.amount) + ' / ' + money(b.paid)],
      ['余额', b.currency + ' ' + money(bal)],
      ['到期日', b.dueDate + (bal > 0 ? (overdue > 0 ? '(已逾期 ' + overdue + ' 天)' : '(未到期)') : '(已结清)')],
      ['最近跟进', b.lastFollow || '从未跟进'],
      ['争议备注', disputed ? b.dispute : '无']
    ].forEach(function (kv) { facts.appendChild(el('dt', '', [kv[0]])); facts.appendChild(el('dd', '', [kv[1]])); });

    /* 每个操作区各有自己的错误行,错误贴近出错控件;提交失败聚焦出错控件 */
    function errLine(id) {
      var e = el('p', 'form-error');
      e.id = id;
      e.setAttribute('role', 'alert');
      e.hidden = true;
      return e;
    }
    var followErr = errLine('w-follow-error');
    var payErr = errLine('w-pay-error');
    var disputeErr = errLine('w-dispute-error');
    function showError(line, ctrl, msg) {
      [followErr, payErr, disputeErr].forEach(function (x) { x.hidden = true; });
      Array.prototype.forEach.call(document.querySelectorAll('#work-panel [aria-invalid]'), function (n) { n.removeAttribute('aria-invalid'); });
      line.textContent = msg;
      line.hidden = false;
      ctrl.setAttribute('aria-invalid', 'true');
      ctrl.focus();
    }

    /* 提醒草稿 */
    var draftBlock = el('div', 'work-block', [el('h3', '', ['提醒草稿'])]);
    if (bal <= 0) {
      draftBlock.appendChild(el('p', 'hint', ['这张账单已结清,不需要提醒。']));
    } else {
      var ta = el('textarea');
      ta.id = 'w-draft';
      ta.rows = 5;
      ta.value = C.draft(state.settings.template, b, TODAY);
      ta.setAttribute('aria-label', '提醒草稿');
      if (disputed) draftBlock.appendChild(el('p', 'hint', ['这张账单有争议,不进入「今天要跟」清单。下面的草稿只在你决定手动联系时使用。']));
      else if (overdue <= 0) draftBlock.appendChild(el('p', 'hint', ['这张账单还没到期,草稿里的逾期天数是 0。']));
      draftBlock.appendChild(ta);
      var copyBtn = btn('复制提醒草稿', 'btn--primary', function () {
        copyText(ta.value, ta).then(function (ok) {
          if (ok) flash('已复制提醒草稿,请粘贴到你的聊天或邮件里发送。', 'ok');
          else flash('浏览器不允许自动复制,草稿已选中,请按 Ctrl+C(Mac 按 ⌘+C)复制。', 'warn');
        });
      });
      copyBtn.id = 'btn-copy-draft';
      draftBlock.appendChild(el('div', 'row', [copyBtn]));
    }

    /* 记录跟进 */
    var fDate = el('input'); fDate.type = 'date'; fDate.id = 'w-follow-date'; fDate.value = TODAY;
    var fNote = el('input'); fNote.id = 'w-follow-note'; fNote.autocomplete = 'off';
    var fBtn = btn('记录这次跟进', 'btn--primary', function () {
      var r = C.recordFollow(b, { date: fDate.value, note: fNote.value });
      if (!r.ok) { showError(followErr, fDate, r.error); return; }
      replaceBill(r.bill);
      commit('已记录跟进(' + fDate.value + ')。');
    });
    fBtn.id = 'btn-follow-save';
    var followBlock = el('div', 'work-block', [el('h3', '', ['记录一次跟进']), field('跟进日期', fDate), field('备注(可空)', fNote), followErr, el('div', 'row', [fBtn])]);

    /* 收款登记 */
    var pDate = el('input'); pDate.type = 'date'; pDate.id = 'w-pay-date'; pDate.value = TODAY;
    var pAmt = el('input'); pAmt.id = 'w-pay-amount'; pAmt.autocomplete = 'off'; pAmt.setAttribute('inputmode', 'decimal');
    var pBtn = btn('登记这笔收款', 'btn--primary', function () {
      var amt = Number(String(pAmt.value).normalize('NFKC').replace(/,/g, '').trim());
      if (String(pAmt.value).trim() === '' || !isFinite(amt)) { showError(payErr, pAmt, '请输入收款金额(数字)。'); return; }
      var r = C.addPayment(b, { date: pDate.value, amount: amt });
      if (!r.ok) { showError(payErr, /日期/.test(r.error) ? pDate : pAmt, r.error); return; }
      replaceBill(r.bill);
      commit('已登记收款 ' + b.currency + ' ' + money(amt) + ',余额 ' + money(C.balance(r.bill)) + '。');
    });
    pBtn.id = 'btn-pay-save';
    pDate.setAttribute('aria-describedby', 'w-pay-error'); pAmt.setAttribute('aria-describedby', 'w-pay-error'); fDate.setAttribute('aria-describedby', 'w-follow-error'); fNote.setAttribute('aria-describedby', 'w-follow-error');
    var payBlock = el('div', 'work-block', [el('h3', '', ['登记收款']), field('收款日期', pDate), field('收款金额(' + b.currency + ')', pAmt), payErr, el('div', 'row', [pBtn])]);
    if (bal <= 0) { pBtn.disabled = true; pAmt.disabled = true; }

    /* 争议备注 */
    var dText = el('textarea'); dText.id = 'w-dispute'; dText.rows = 2; dText.value = b.dispute;
    var dBtn = btn('保存争议备注', 'btn--secondary', function () {
      replaceBill(Object.assign({}, b, { dispute: dText.value.trim() }));
      commit(dText.value.trim() ? '已标记为争议账单,不再进入「今天要跟」清单。' : '已清除争议标记。');
    });
    dBtn.id = 'btn-dispute-save';
    dText.setAttribute('aria-describedby', 'w-dispute-error');
    var disputeBlock = el('div', 'work-block', [el('h3', '', ['争议备注']), field('有内容就算争议;清空即取消争议', dText), disputeErr, el('div', 'row', [dBtn])]);

    /* 历史 */
    var histBlock = el('div', 'work-block', [el('h3', '', ['收款与跟进历史'])]);
    var pl = el('ul', 'log');
    b.payments.forEach(function (x) { pl.appendChild(el('li', '', ['收款 ' + x.date + ':' + money(x.amount)])); });
    b.follows.forEach(function (x) { pl.appendChild(el('li', '', ['跟进 ' + x.date + (x.note ? ':' + x.note : '')])); });
    if (!pl.firstChild) pl.appendChild(el('li', '', ['还没有登记过收款或跟进。']));
    histBlock.appendChild(facts);
    histBlock.appendChild(pl);

    p.appendChild(head);
    p.appendChild(el('div', 'work-grid', [histBlock, draftBlock, followBlock, payBlock, disputeBlock]));
  }

  function copyText(text, ta) {
    function fallback() {
      try { ta.focus(); ta.select(); return document.execCommand('copy'); } catch (e) { return false; }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallback(); });
    }
    return Promise.resolve(fallback());
  }

  /* ---------- 变更提交 ---------- */
  function commit(msg) {
    save();
    renderAll();
    flash(msg, 'ok');
  }

  /* ---------- 录入表单 ---------- */
  var FORM_IDS = { client: 'f-client', no: 'f-no', issueDate: 'f-issue', dueDate: 'f-due', amount: 'f-amount', currency: 'f-currency', paid: 'f-paid', lastFollow: 'f-lastfollow', dispute: 'f-dispute' };
  function resetForm() {
    ui.editing = null;
    C.FIELD_KEYS.forEach(function (k) { $(FORM_IDS[k]).value = k === 'currency' ? 'CNY' : ''; });
    $('f-paid').readOnly = false;
    $('f-lastfollow').readOnly = false;
    $('f-paid-help').textContent = '只在新建账单时使用,表示开始使用本工具前已经收到的金额;不会伪造收款记录。';
    $('f-lastfollow-help').textContent = '只在新建账单时使用,表示开始使用本工具前的最近跟进日期;不会伪造跟进记录。';
    renderMeta();
    $('bill-form-title').textContent = '录入一张账单';
    $('btn-bill-save').textContent = '保存账单';
    $('btn-bill-cancel').hidden = true;
    $('bill-form-error').hidden = true;
    Array.prototype.forEach.call(document.querySelectorAll('#bill-form [aria-invalid]'), function (n) { n.removeAttribute('aria-invalid'); });
  }
  function startEdit(id) {
    var b = billById(id);
    if (!b) return;
    ui.editing = id;
    C.FIELD_KEYS.forEach(function (k) { $(FORM_IDS[k]).value = String(b[k]); });
    $('f-paid').readOnly = true;
    $('f-lastfollow').readOnly = true;
    $('f-paid-help').textContent = '只读汇总:迁移前已收 ' + money(b.openingPaid) + ',另有 ' + b.payments.length + ' 笔收款记录。新收款请在账单详情登记。';
    $('f-lastfollow-help').textContent = '只读汇总:取迁移前日期与 ' + b.follows.length + ' 条跟进记录中的最晚日期。新跟进请在账单详情登记。';
    $('bill-form-title').textContent = '编辑账单:' + b.client + ' · ' + b.no;
    $('btn-bill-save').textContent = '保存修改';
    $('btn-bill-cancel').hidden = false;
    $('bill-form-error').hidden = true;
    renderMeta();
    setView('entry');
    $('f-client').focus();
  }
  function formError(msg) {
    var e = $('bill-form-error'); e.textContent = msg; e.hidden = false;
    Array.prototype.forEach.call(document.querySelectorAll('#bill-form [aria-invalid]'), function (n) { n.removeAttribute('aria-invalid'); });
    var id = /已经有账单号/.test(msg) ? 'f-no' : /客户/.test(msg) ? 'f-client' : /账单号/.test(msg) ? 'f-no' : /开票日/.test(msg) ? 'f-issue' : /到期日/.test(msg) ? 'f-due'
      : /应收/.test(msg) ? 'f-amount' : /已收/.test(msg) ? 'f-paid' : /币种/.test(msg) ? 'f-currency' : 'f-client';
    $(id).setAttribute('aria-invalid', 'true');
    $(id).focus();
  }

  function onSubmitBill(ev) {
    ev.preventDefault();
    var f = {};
    C.FIELD_KEYS.forEach(function (k) { f[k] = $(FORM_IDS[k]).value; });
    var existing = ui.editing ? billById(ui.editing) : null;
    var r = C.buildBill(f, existing);
    if (!r.ok) { formError(r.error); return; }
    var dup = state.bills.some(function (x) { return x.client === r.bill.client && x.no === r.bill.no && (!existing || x.id !== existing.id); });
    if (dup) { formError('客户「' + r.bill.client + '」下已经有账单号「' + r.bill.no + '」。'); return; }
    if (existing) {
      replaceBill(r.bill);
      resetForm();
      commit('已保存修改。');
    } else {
      r.bill.id = C.makeId(state.bills);
      state.bills = state.bills.concat([r.bill]);
      resetForm();
      commit('已保存账单 ' + r.bill.no + '。');
    }
  }

  /* ---------- 批量粘贴 ---------- */
  function renderBatch() {
    var box = $('batch-preview');
    clear(box);
    var text = $('batch-text').value;
    if (text.trim() === '') { ui.batch = { rows: [], errors: [] }; $('btn-batch-add').disabled = true; renderMeta(); return; }
    var r = C.parseBatch(text, $('batch-currency').value);
    ui.batch = r;
    box.appendChild(el('p', '', ['识别成功 ' + r.rows.length + ' 行,有问题 ' + r.errors.length + ' 行。']));
    if (r.errors.length) {
      var ul = el('ul', 'batch-errors');
      r.errors.forEach(function (e) { ul.appendChild(el('li', '', ['第 ' + e.line + ' 行:' + e.reason])); });
      box.appendChild(ul);
    }
    $('btn-batch-add').disabled = r.rows.length === 0;
    renderMeta();
  }
  function addMerged(rows, label) {
    var m = C.mergeBills(state.bills, rows);
    state.bills = m.bills;
    var msg = '已加入 ' + m.added + ' 张账单(' + label + ')。';
    if (m.skipped.length) msg += '跳过 ' + m.skipped.length + ' 张重复账单:' + m.skipped.map(function (s) { return s.client + ' ' + s.no; }).join('、') + '。';
    commit(msg);
  }

  /* ---------- CSV 导入 ---------- */
  var FIELD_LABELS = { client: '客户', no: '账单号', issueDate: '开票日', dueDate: '到期日', amount: '应收金额', currency: '币种', paid: '已收金额', dispute: '争议备注', lastFollow: '最近跟进日期' };
  var REQUIRED = { client: true, no: true, dueDate: true, amount: true };

  function onCsvText() {
    var text = $('csv-text').value;
    if (text.trim() === '') { ui.csv = { table: null, mapping: null, result: null }; clear($('csv-mapping')); clear($('csv-preview')); $('btn-csv-add').disabled = true; renderMeta(); return; }
    var table = C.parseCsv(text);
    ui.csv.table = table;
    ui.csv.mapping = C.guessMapping(table.headers);
    renderCsvMapping();
    renderCsvPreview();
  }
  function renderCsvMapping() {
    var box = $('csv-mapping');
    clear(box);
    var t = ui.csv.table;
    if (!t || t.headers.length === 0) return;
    C.FIELD_KEYS.forEach(function (k) {
      var sel = el('select');
      sel.id = 'map-' + k;
      sel.appendChild(el('option', '', ['(不导入)'])).value = '-1';
      t.headers.forEach(function (h, i) {
        var o = el('option', '', [h || '(第 ' + (i + 1) + ' 列)']);
        o.value = String(i);
        sel.appendChild(o);
      });
      sel.value = String(ui.csv.mapping[k]);
      sel.addEventListener('change', function () { ui.csv.mapping[k] = Number(sel.value); renderCsvPreview(); });
      box.appendChild(field(FIELD_LABELS[k] + (REQUIRED[k] ? '(必选)' : ''), sel));
    });
  }
  function renderCsvPreview() {
    var box = $('csv-preview');
    clear(box);
    var t = ui.csv.table;
    if (!t) return;
    var r = C.mapCsv(t, ui.csv.mapping, $('csv-currency').value);
    ui.csv.result = r;
    box.appendChild(el('p', '', ['识别成功 ' + r.rows.length + ' 行,有问题 ' + r.errors.length + ' 行(共 ' + t.rows.length + ' 行数据)。' + (r.errors.length ? '有任何一行有问题就不能导入,请先改正 CSV 或列映射。' : '')]));
    if (r.errors.length) {
      var ul = el('ul', 'batch-errors');
      r.errors.slice(0, 20).forEach(function (e) { ul.appendChild(el('li', '', [(e.line ? '第 ' + e.line + ' 行:' : '') + e.reason])); });
      if (r.errors.length > 20) ul.appendChild(el('li', '', ['还有 ' + (r.errors.length - 20) + ' 行有问题未列出。']));
      box.appendChild(ul);
    }
    $('btn-csv-add').disabled = !r.ok;
    renderMeta();
  }

  /* ---------- 删除 / 清空 ---------- */
  function askDelete(id) {
    var b = billById(id);
    if (!b) return;
    ui.deleting = id;
    $('delete-title').textContent = '确认删除账单「' + b.client + ' · ' + b.no + '」?它的收款与跟进记录也会一起删除,不能撤销。';
    $('delete-confirm').hidden = false;
    $('delete-confirm').scrollIntoView({ block: 'nearest' });
  }

  /* ---------- 导出 ---------- */
  function sampleTag() { return state.sample ? '合成示例-' : ''; }
  function sampleNote() { return state.sample ? '> 合成示例数据,不是真实账单。\n\n' : ''; }
  function sampleCsvNote() { return state.sample ? '合成示例数据,不是真实账单\n' : ''; }
  function exportJsonBackup() {
    download('应收账款备份-' + (state.sample ? '合成示例-' : '') + TODAY + '.json', C.exportJson(state.bills, state.settings, state.sample), 'application/json');
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () { setView(t.getAttribute('data-view')); });
    });

    /* 用户数据 = 已保存账单 + 偏离默认值的设置 + 未提交的表单、批量、CSV 草稿 */
    function draftParts() {
      var parts = [];
      if (ui.editing) parts.push('正在编辑的账单');
      var ids = ['f-client', 'f-no', 'f-issue', 'f-due', 'f-amount', 'f-paid', 'f-lastfollow', 'f-dispute'];
      if (!ui.editing && ids.some(function (id) { return $(id).value.trim() !== ''; })) parts.push('录入表单里未保存的内容');
      if ($('batch-text').value.trim() !== '') parts.push('批量粘贴的内容');
      if ($('csv-text').value.trim() !== '') parts.push('CSV 文本');
      return parts;
    }
    function hasUserData() {
      return rejectedStoredRaw !== null || state.bills.length > 0 || !C.settingsAreDefault(state.settings) || draftParts().length > 0;
    }
    function sampleScope() {
      var bits = [];
      if (rejectedStoredRaw !== null) bits.push('未通过校验但仍保留在浏览器里的原始数据');
      if (state.bills.length) bits.push(state.bills.length + ' 张账单及其收款、跟进记录');
      if (!C.settingsAreDefault(state.settings)) bits.push('自定义的提醒模板或跟进间隔(恢复为默认值)');
      draftParts().forEach(function (x) { bits.push(x); });
      return bits.join('、');
    }
    function askSample() {
      if (hasUserData()) {
        $('sample-scope').textContent = sampleScope();
        $('sample-confirm').hidden = false;
        $('sample-confirm').scrollIntoView({ block: 'nearest' });
        $('btn-sample-no').focus();
        return;
      }
      loadSample();
    }
    function loadSample() {
      $('sample-confirm').hidden = true;
      rejectedStoredRaw = null;
      rejectedStoredReason = '';
      $('storage-recovery').hidden = true;
      var s = S.sampleState(TODAY);
      state = { bills: s.bills, settings: s.settings, sample: true };
      ui.selected = null;
      resetForm();
      $('batch-text').value = ''; $('csv-text').value = '';
      renderBatch(); onCsvText();
      commit('已载入' + S.LABEL + ':10 张虚构账单、3 个客户、2 种币种,用来演示完整流程。');
    }
    $('btn-sample').addEventListener('click', askSample);
    $('btn-sample-2').addEventListener('click', askSample);
    $('btn-sample-yes').addEventListener('click', loadSample);
    $('btn-sample-no').addEventListener('click', function () { $('sample-confirm').hidden = true; });

    $('btn-export-json').addEventListener('click', exportJsonBackup);
    $('btn-save-warning-export').addEventListener('click', exportJsonBackup);
    $('btn-storage-raw').addEventListener('click', function () {
      if (rejectedStoredRaw !== null) download('应收账款-未通过校验的原始数据-' + TODAY + '.json', rejectedStoredRaw, 'application/json');
    });

    $('file-import').addEventListener('change', function (ev) {
      var file = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var v = C.validateImport(String(reader.result));
        var box = $('import-error');
        if (!v.ok) {
          $('import-error-text').textContent = '导入被拒绝,现有数据没有改动。原因:' + v.error;
          box.hidden = false;
          return;
        }
        box.hidden = true;
        ui.pendingImport = v.data;
        $('import-summary').textContent = C.importSummary(state, v.data).text;
        $('import-confirm').hidden = false;
        $('import-confirm').scrollIntoView({ block: 'nearest' });
        $('btn-import-no').focus();
      };
      reader.onerror = function () {
        $('import-error-text').textContent = '导入被拒绝:读取文件失败。';
        $('import-error').hidden = false;
      };
      reader.readAsText(file);
    });

    $('btn-import').addEventListener('click', function () { $('file-import').click(); });
    $('btn-import-no').addEventListener('click', function () { ui.pendingImport = null; $('import-confirm').hidden = true; $('btn-import').focus(); });
    $('btn-import-yes').addEventListener('click', function () {
      var d = ui.pendingImport;
      ui.pendingImport = null;
      $('import-confirm').hidden = true;
      if (!d) return;
      rejectedStoredRaw = null;
      rejectedStoredReason = '';
      $('storage-recovery').hidden = true;
      state = d;
      ui.selected = null;
      commit('已导入 ' + d.bills.length + ' 张账单(替换了原有数据)。');
    });
    $('btn-clear').addEventListener('click', function () { $('clear-confirm').hidden = false; });
    $('btn-clear-no').addEventListener('click', function () { $('clear-confirm').hidden = true; });
    $('btn-clear-yes').addEventListener('click', function () {
      if (storageReadFailed) { $('clear-confirm').hidden = true; save(); return; }
      rejectedStoredRaw = null;
      rejectedStoredReason = '';
      $('storage-recovery').hidden = true;
      state = empty();
      $('batch-text').value = ''; $('csv-text').value = ''; onCsvText(); renderBatch();
      ui.selected = null;
      $('clear-confirm').hidden = true;
      resetForm();
      commit('已清空所有数据。');
      setView('aging');
    });

    $('btn-delete-no').addEventListener('click', function () { ui.deleting = null; $('delete-confirm').hidden = true; });
    $('btn-delete-yes').addEventListener('click', function () {
      var id = ui.deleting;
      ui.deleting = null;
      $('delete-confirm').hidden = true;
      if (!id) return;
      state.bills = state.bills.filter(function (b) { return b.id !== id; });
      if (ui.selected === id) ui.selected = null;
      if (ui.editing === id) resetForm();
      commit('已删除账单。');
    });

    /* 导出 */
    function reportForExport() {
      var report = C.agingReport(state.bills, TODAY);
      if (report.error) { flash(report.error, 'danger'); return null; }
      return report;
    }
    $('btn-aging-md').addEventListener('click', function () {
      var report = reportForExport();
      if (report) download('账龄表-' + sampleTag() + TODAY + '.md', sampleNote() + C.toMarkdown(report), 'text/markdown;charset=utf-8');
    });
    $('btn-aging-csv').addEventListener('click', function () {
      var report = reportForExport();
      if (report) downloadCsv('账龄汇总-' + sampleTag() + TODAY + '.csv', C.agingCsv(report, 'summary') + sampleCsvNote());
    });
    $('btn-aging-detail-csv').addEventListener('click', function () {
      var report = reportForExport();
      if (report) downloadCsv('账龄明细-' + sampleTag() + TODAY + '.csv', C.agingCsv(report, 'detail') + sampleCsvNote());
    });
    $('btn-follow-csv').addEventListener('click', function () {
      downloadCsv('跟进清单-' + sampleTag() + TODAY + '.csv', C.followCsv(followList(), TODAY, state.settings.template) + sampleCsvNote());
    });

    /* 跟进设置 */
    $('fu-n').addEventListener('change', function () {
      var raw = $('fu-n').value.trim();
      var v = Number(raw);
      if (raw === '' || !Number.isInteger(v) || v < 0 || v > 365) {
        $('fu-n').value = String(state.settings.n);
        flash('间隔需要是 0 到 365 的整数,已恢复为 ' + state.settings.n + ' 天。', 'warn');
        return;
      }
      state.settings.n = v;
      commit('已设为 ' + v + ' 天没跟进就算「今天要跟」。');
    });
    $('fu-template').addEventListener('input', function () {
      var v = $('fu-template').value;
      if (C.validateSettings({ template: v, n: state.settings.n })) return;
      state.settings.template = v;
      var b = ui.selected ? billById(ui.selected) : null;
      var d = $('w-draft');
      if (b && d) d.value = C.draft(v, b, TODAY);
    });
    $('fu-template').addEventListener('change', function () {
      var err = C.validateSettings({ template: $('fu-template').value, n: state.settings.n });
      if (err) {
        $('fu-template').value = state.settings.template;
        flash('模板没有保存:' + err + '。已保留原来的模板。', 'warn');
        return;
      }
      save();
      renderWork();
    });
    $('btn-template-reset').addEventListener('click', function () {
      state.settings.template = C.DEFAULT_TEMPLATE;
      $('fu-template').value = C.DEFAULT_TEMPLATE;
      commit('已恢复默认模板。');
    });
    $('fu-only-today').addEventListener('change', function () { ui.onlyToday = $('fu-only-today').checked; renderFollow(); });

    /* 录入 */
    $('bill-form').addEventListener('submit', onSubmitBill);
    $('btn-bill-cancel').addEventListener('click', resetForm);
    $('batch-text').addEventListener('input', renderBatch);
    $('batch-currency').addEventListener('input', renderBatch);
    $('btn-batch-add').addEventListener('click', function () {
      var rows = ui.batch.rows;
      if (!rows.length) return;
      addMerged(rows, '批量粘贴');
      $('batch-text').value = '';
      renderBatch();
    });
    $('csv-text').addEventListener('input', onCsvText);
    $('csv-currency').addEventListener('input', function () { if (ui.csv.table) renderCsvPreview(); });
    $('csv-file').addEventListener('change', function (ev) {
      var file = ev.target.files && ev.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        /* 空文件、乱码文件先拒绝:不改动文本框,原因写在文件选择框下面 */
        var chk = C.checkTextFile(String(reader.result));
        var err = $('csv-file-error');
        if (!chk.ok) { err.textContent = '文件「' + file.name + '」没有读入:' + chk.message + '文本框里的内容没有改动。'; err.hidden = false; return; }
        err.hidden = true;
        $('csv-text').value = String(reader.result); onCsvText();
      };
      reader.readAsText(file);
    });
    $('btn-csv-add').addEventListener('click', function () {
      var r = ui.csv.result;
      if (!r || !r.ok || r.errors.length) return;
      addMerged(r.rows, 'CSV 导入');
      $('csv-text').value = '';
      $('csv-file').value = '';
      onCsvText();
    });
  }

  bind();
  if (storageReadFailed || rejectedStoredRaw !== null) {
    $('storage-recovery-reason').textContent = '原因:' + rejectedStoredReason + '。';
    $('storage-recovery').hidden = false;
    $('btn-storage-raw').disabled = storageReadFailed;
  }
  setView('aging');
  renderAll();
  renderBatch();
})();
