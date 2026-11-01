'use strict';
(function () {
  var C = globalThis.TuancanCore;
  var KEY = 'tuancan.v1';
  var state = C.emptyState();
  var corrupt = false;
  var menuDirty = false;
  var feeInvalid = false;
  var editCurrentMenu = false;
  var lastRenderedDate = null;
  var pendingAction = null;
  var $ = function (id) { return document.getElementById(id); };

  function localToday() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }
  var curDate = C.parseTodayParam(location.search, localToday());
  var todayStr = curDate;

  /* ---------- 存储 ---------- */
  function showWarning(html, canDiscard) {
    $('save-warning-text').innerHTML = html;
    $('btn-corrupt-discard').hidden = !canDiscard;
    $('save-warning').hidden = false;
  }
  function setStatus(text) { $('save-status').textContent = text; }

  function save() {
    if (corrupt) {
      showWarning('<strong>未保存:</strong>浏览器里存着一份无法读取的旧数据,为避免覆盖它,新的改动暂不写入。可先导出 JSON 备份,或选择丢弃旧数据重新开始。', true);
      return false;
    }
    var v = C.validateState(state);
    if (!v.ok) {
      showWarning('<strong>未保存:</strong>' + escapeHtml(v.error) + '。请先修正,或导出 JSON 备份。', false);
      return false;
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      showWarning('<strong>未保存:</strong>浏览器拒绝写入本地存储(' + escapeHtml(e && e.name ? e.name : '未知错误') + '),刚才的改动只在当前页面里,关闭页面就会丢失。请立即导出 JSON 备份。', false);
      setStatus('未保存');
      return false;
    }
    $('save-warning').hidden = true;
    var t = new Date();
    setStatus('已保存 ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') + ':' + String(t.getSeconds()).padStart(2, '0'));
    return true;
  }

  function load() {
    var raw;
    try { raw = localStorage.getItem(KEY); } catch (e) {
      showWarning('<strong>无法使用本地存储:</strong>改动不会被保留。请用导出 JSON 备份保存数据。', false);
      return;
    }
    if (raw == null) return;
    var r = C.validateImport(raw);
    if (r.ok) { state = r.state; setStatus('已读取保存的数据'); return; }
    corrupt = true;
    showWarning('<strong>无法读取已保存的数据:</strong>' + escapeHtml(r.error) + '。原始数据没有被改动。', true);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  /* ---------- 小工具 ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  var flashTimer = null;
  function flash(msg) {
    var f = $('flash');
    f.textContent = msg;
    f.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { f.hidden = true; }, 6000);
  }
  function getDay(date) { return state.days.find(function (d) { return d.date === date; }) || null; }
  function ensureDay() {
    var d = getDay(curDate);
    if (!d) {
      d = { date: curDate, replies: '', fee: 0, feeMode: 'head', menu: C.cloneMenu(state.menu) };
      state.days.push(d);
      state.days.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    }
    return d;
  }
  function pruneDay() {
    var d = getDay(curDate);
    if (d && !d.replies.trim() && d.fee === 0) state.days = state.days.filter(function (x) { return x !== d; });
  }
  function compute(date) {
    return C.dayAggregate(getDay(date), state.menu);   // 历史日期用当天保存的菜单快照
  }

  /* ---------- 页内确认 ---------- */
  function askConfirm(message, onYes) {
    pendingAction = onYes;
    $('confirm-text').textContent = message;
    $('confirm-area').hidden = false;
    $('btn-confirm-no').focus();
  }
  function closeConfirm() { pendingAction = null; $('confirm-area').hidden = true; }
  function hasSavedData() { return state.menu.length > 0 || state.days.length > 0; }
  function dishFormFilled() { return ['dish-name', 'dish-price', 'dish-aliases', 'dish-specs'].some(function (id) { return $(id).value.trim() !== ''; }); }
  /* 用户数据 = 已保存的菜单与历史 + 尚未应用的菜单修改 + 手动加菜表单里没提交的内容 */
  function hasUserData() { return hasSavedData() || menuDirty || dishFormFilled(); }
  function scopeText() {
    var parts = ['当前的菜单(' + state.menu.length + ' 道)和全部历史记录(' + state.days.length + ' 天)'];
    if (menuDirty) parts.push('尚未应用的菜单修改');
    if (dishFormFilled()) parts.push('「手动加一道菜」里没有提交的内容');
    return parts.join('、');
  }
  function resetDishForm() { ['dish-name', 'dish-price', 'dish-aliases', 'dish-specs'].forEach(function (id) { $(id).value = ''; }); }

  /* ---------- 渲染 ---------- */
  function renderAll() {
    $('date-input').value = curDate;
    $('empty-guide').hidden = hasSavedData();
    var day = getDay(curDate);
    if (lastRenderedDate !== curDate) { editCurrentMenu = false; lastRenderedDate = curDate; }
    $('replies-text').value = day ? day.replies : '';
    var mv = C.menuView(day, state.menu);
    var snapMode = mv.mode === 'snapshot' && !editCurrentMenu;
    $('menu-text').value = snapMode ? mv.text : C.serializeMenu(state.menu);
    $('menu-text').readOnly = snapMode;
    renderMenuMode(mv, snapMode);
    menuDirty = false;
    feeInvalid = false;
    $('fee-input').removeAttribute('aria-invalid');
    $('fee-input').value = day && day.fee ? C.formatYuan(day.fee) : '';
    $('fee-mode').value = day ? day.feeMode : 'head';
    $('fee-error').hidden = true;
    $('menu-errors').hidden = true;
    renderDerived();
  }

  function renderMenuMode(mv, snapMode) {
    var note = $('menu-mode-note');
    var btn = $('btn-menu-mode');
    note.hidden = mv.mode !== 'snapshot';
    btn.hidden = mv.mode !== 'snapshot';
    if (mv.mode === 'snapshot') {
      if (snapMode) {
        $('menu-mode-text').textContent = '这里显示的是 ' + curDate + ' 当天保存的菜单快照(' + mv.count + ' 道,只读),因为这一天的汇总和金额按它计价;它和当前菜单不同。';
        btn.textContent = '编辑当前菜单';
      } else {
        $('menu-mode-text').textContent = '你在编辑当前菜单。' + curDate + ' 的汇总仍按当天保存的菜单快照(' + mv.count + ' 道)计价,应用菜单只会影响今天及之后的日期,这一天的金额不会变。';
        btn.textContent = '查看 ' + curDate + ' 的菜单快照';
      }
    }
    $('btn-menu-apply').disabled = snapMode;
    Array.prototype.forEach.call($('dish-form').querySelectorAll('input, button'), function (c) { c.disabled = snapMode; });
  }

  function row(cells) {
    var tr = document.createElement('tr');
    cells.forEach(function (c) {
      var td = el('td', c.cls || '', c.text);
      if (c.colSpan) td.colSpan = c.colSpan;
      tr.appendChild(td);
    });
    return tr;
  }

  function renderDerived() {
    $('menu-count').textContent = state.menu.length ? '共 ' + state.menu.length + ' 道' : '';
    $('menu-dirty').hidden = !menuDirty;
    $('day-label').textContent = curDate;
    $('empty-guide').hidden = hasSavedData();
    $('fee-note').textContent = C.feeRuleText($('fee-mode').value);
    var agg = compute(curDate);

    // 待确认
    $('pending-panel').hidden = agg.pending.length === 0;
    $('pending-count').textContent = String(agg.pending.length);
    var pl = $('pending-list');
    pl.textContent = '';
    agg.pending.forEach(function (p) {
      var li = el('li');
      li.appendChild(el('strong', '', (p.person || '(无名字)') + ':'));
      li.appendChild(document.createTextNode('「' + p.text + '」— ' + p.message + (p.candidates && p.candidates.length > 1 ? '(可能是:' + p.candidates.join('、') + ')' : '')));
      pl.appendChild(li);
    });

    // 汇总
    $('total-amount').textContent = C.formatYuan(agg.total);
    $('fee-line').textContent = agg.fee > 0 ? '  + 费用 ' + C.formatYuan(agg.fee - agg.feeUnallocated) + ' 元 = 应收 ' + C.formatYuan(agg.grandTotal) + ' 元' : '';
    var dt = $('dish-table').tBodies[0];
    dt.textContent = '';
    if (!agg.byDish.length) dt.appendChild(row([{ text: '还没有可汇总的点单', cls: 'empty', colSpan: 4 }]));
    agg.byDish.forEach(function (g) {
      dt.appendChild(row([{ text: g.name }, { text: g.spec || '—' }, { text: String(g.qty), cls: 'num' }, { text: C.formatYuan(g.amount), cls: 'num amount' }]));
    });
    var pt = $('person-table').tBodies[0];
    pt.textContent = '';
    if (!agg.byPerson.length) pt.appendChild(row([{ text: '还没有人点单', cls: 'empty', colSpan: 4 }]));
    agg.byPerson.forEach(function (p) {
      var list = p.skip ? '不点' : (p.items.map(function (it) { return it.name + (it.spec ? ' ' + it.spec : '') + ' ×' + it.qty; }).join(',') || '—') + (p.pendingCount ? '(另有 ' + p.pendingCount + ' 项待确认)' : '');
      pt.appendChild(row([
        { text: p.person }, { text: list },
        { text: p.skip ? '0' : C.formatYuan(p.amount), cls: 'num amount' },
        { text: p.skip ? '0' : C.formatYuan(p.payable), cls: 'num amount' }
      ]));
    });

    // 输出
    var orderText = C.orderText(agg);
    var payText = C.paymentText(agg);
    $('order-text').value = orderText;
    $('pay-text').value = payText;
    var hint = $('export-hint');
    var blocked = menuDirty || feeInvalid;
    if (feeInvalid) { hint.textContent = '费用输入无效,下面的金额、文本和导出仍按上一次保存的费用(' + (agg.fee > 0 ? C.formatYuan(agg.fee) + ' 元' : '无费用') + ')计算。请先修正费用,复制和导出已停用。'; }
    else if (menuDirty) { hint.textContent = '菜单有未应用的修改,输出可能与界面不一致。请先点「应用菜单」。'; }
    else if (agg.pending.length) { hint.textContent = '有 ' + agg.pending.length + ' 条待确认没有计入下面的文本和 CSV,发给商家前请先处理。'; }
    hint.hidden = !(feeInvalid || menuDirty || agg.pending.length);
    var empty = !orderText;
    ['btn-copy-order', 'btn-copy-pay', 'btn-csv-dish', 'btn-csv-person'].forEach(function (id) { $(id).disabled = blocked || empty; });
    $('btn-json').disabled = false;

    renderWeekAndHistory();
    var ls = C.lastSame(state.days, curDate);
    $('btn-last-same').disabled = !ls;
    $('last-same-hint').textContent = ls ? '复制 ' + ls.date + ' 的点单' : '之前还没有历史点单';
  }

  function renderWeekAndHistory() {
    var summaries = state.days.map(function (d) { return { date: d.date, byPerson: compute(d.date).byPerson }; });
    var w = C.weekStats(summaries, curDate);
    $('week-range').textContent = w.start + ' 至 ' + w.end + '(共 ' + w.dayCount + ' 天有点单)';
    var wt = $('week-table').tBodies[0];
    wt.textContent = '';
    if (!w.people.length) wt.appendChild(row([{ text: '本周还没有记录', cls: 'empty', colSpan: 3 }]));
    w.people.forEach(function (p) {
      wt.appendChild(row([{ text: p.person }, { text: String(p.count), cls: 'num' }, { text: C.formatYuan(p.amount), cls: 'num amount' }]));
    });
    var hl = $('history-list');
    hl.textContent = '';
    if (!state.days.length) hl.appendChild(el('li', 'muted', '还没有历史记录'));
    state.days.slice().reverse().forEach(function (d) {
      var a = compute(d.date);
      var li = el('li');
      if (d.date === curDate) li.setAttribute('aria-current', 'true');
      li.appendChild(el('span', '', d.date + ' · ' + a.byPerson.filter(function (p) { return !p.skip && p.items.length; }).length + ' 人 · 合计 ' + C.formatYuan(a.grandTotal) + ' 元'));
      var b = el('button', 'btn btn--secondary', d.date === curDate ? '当前日期' : '打开');
      b.type = 'button';
      b.disabled = d.date === curDate;
      b.addEventListener('click', function () { curDate = d.date; renderAll(); });
      li.appendChild(b);
      hl.appendChild(li);
    });
  }

  /* ---------- 复制与下载 ---------- */
  function copyFrom(areaId, label) {
    var ta = $(areaId);
    var text = ta.value;
    function fallback() {
      ta.focus(); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      flash(ok ? '已复制' + label + '。' : '浏览器不允许自动复制,文本已选中,请按 Ctrl+C / Cmd+C 复制。');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { flash('已复制' + label + '。'); }, fallback);
    } else fallback();
  }
  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function exportJson() {
    download('团餐点单备份-' + curDate + '.json', JSON.stringify(state, null, 2), 'application/json');
    flash('已导出 JSON 备份。');
  }

  /* ---------- 事件 ---------- */
  $('replies-text').addEventListener('input', function () {
    var d = ensureDay();
    d.replies = $('replies-text').value;
    pruneDay();
    save();
    renderDerived();
  });

  $('menu-text').addEventListener('input', function () {
    if ($('menu-text').readOnly) return;
    menuDirty = $('menu-text').value.trim() !== C.serializeMenu(state.menu);
    renderDerived();
  });
  $('btn-menu-apply').addEventListener('click', function () {
    var r = C.parseMenu($('menu-text').value);
    var errs = $('menu-errors');
    errs.textContent = '';
    if (r.errors.length) {
      r.errors.forEach(function (e) { errs.appendChild(el('li', '', e)); });
      errs.appendChild(el('li', '', '菜单有错误,整份没有应用,原菜单保持不变。'));
      errs.hidden = false;
      return;
    }
    var next = { version: 1, menu: r.menu, days: C.refreshSnapshots(state.days, r.menu, todayStr) };
    var v = C.validateState(next);
    if (!v.ok) { errs.appendChild(el('li', '', v.error)); errs.hidden = false; return; }
    errs.hidden = true;
    state = next;
    menuDirty = false;
    save();
    $('menu-text').value = C.serializeMenu(state.menu);
    renderDerived();
    flash('菜单已应用,共 ' + state.menu.length + ' 道。');
  });

  $('dish-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('dish-name').value.trim();
    var aliases = $('dish-aliases').value.trim();
    var specs = $('dish-specs').value.trim();
    var line = name + (aliases ? '=' + aliases : '') + ' | ' + $('dish-price').value.trim() + (specs ? ' | ' + specs : '');
    var base = $('menu-text').value.trim();
    var text = (base ? base + '\n' : '') + line;
    var r = C.parseMenu(text);
    var errs = $('menu-errors');
    errs.textContent = '';
    if (r.errors.length) {
      r.errors.forEach(function (x) { errs.appendChild(el('li', '', x)); });
      errs.hidden = false;
      return;
    }
    errs.hidden = true;
    $('menu-text').value = text;
    menuDirty = true;
    renderDerived();
    $('btn-menu-apply').click();
    if (!errs.hidden) return;
    ['dish-name', 'dish-price', 'dish-aliases', 'dish-specs'].forEach(function (id) { $(id).value = ''; });
  });

  function writeFee() {
    var raw = $('fee-input').value.trim();
    var err = $('fee-error');
    var cents = 0;
    if (raw) {
      cents = C.parseYuan(raw, C.MAX_FEE);
      if (cents == null) {
        err.textContent = '费用「' + raw + '」不是有效金额(最多两位小数,不超过 1000000 元),没有保存。汇总仍按上一次保存的费用计算,修正前不能复制或导出。';
        err.hidden = false;
        $('fee-input').setAttribute('aria-invalid', 'true');
        feeInvalid = true;
        renderDerived();
        return;
      }
    }
    err.hidden = true;
    feeInvalid = false;
    $('fee-input').removeAttribute('aria-invalid');
    var d = ensureDay();
    d.fee = cents;
    d.feeMode = $('fee-mode').value;
    pruneDay();
    save();
    renderDerived();
  }
  $('fee-input').addEventListener('input', writeFee);
  $('fee-mode').addEventListener('change', writeFee);

  $('date-input').addEventListener('change', function () {
    var v = $('date-input').value;
    if (C.isValidDateStr(v)) { curDate = v; renderAll(); } else $('date-input').value = curDate;
  });

  $('btn-last-same').addEventListener('click', function () {
    var ls = C.lastSame(state.days, curDate);
    if (!ls) return;
    var cur = getDay(curDate);
    function doCopy() {
      var d = ensureDay();
      d.replies = ls.replies; d.fee = ls.fee; d.feeMode = ls.feeMode; d.menu = C.cloneMenu(state.menu);
      save();
      renderAll();
      flash('已复制 ' + ls.date + ' 的点单,可直接修改。');
    }
    if (cur && cur.replies.trim()) askConfirm('今天(' + curDate + ')已有回复,要用 ' + ls.date + ' 的点单替换吗?', doCopy);
    else doCopy();
  });

  function loadSample() {
    var S = globalThis.TuancanSample;
    var r = C.parseMenu(S.menuText);
    var days = S.days.map(function (d) { return { date: C.addDays(curDate, d.offset), replies: d.replies, fee: d.fee, feeMode: d.feeMode, menu: C.cloneMenu(r.menu) }; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    state = { version: 1, menu: r.menu, days: days };
    corrupt = false;
    resetDishForm();
    save();
    renderAll();
    flash('已载入示例(' + S.label + ')。');
  }
  function onSample() {
    if (hasUserData()) askConfirm('载入示例会替换:' + scopeText() + '。此操作不能撤销,建议先导出 JSON 备份。确认替换吗?', loadSample);
    else loadSample();
  }
  $('btn-sample').addEventListener('click', onSample);
  $('btn-sample-2').addEventListener('click', onSample);

  $('btn-clear').addEventListener('click', function () {
    askConfirm('确认清空:' + scopeText() + '?此操作不能撤销,建议先导出 JSON 备份。', function () {
      state = C.emptyState();
      corrupt = false;
      resetDishForm();
      save();
      renderAll();
      flash('数据已清空。');
    });
  });
  $('btn-confirm-yes').addEventListener('click', function () { var f = pendingAction; closeConfirm(); if (f) f(); });
  $('btn-confirm-no').addEventListener('click', closeConfirm);

  $('btn-copy-order').addEventListener('click', function () { copyFrom('order-text', '下单文本'); });
  $('btn-copy-pay').addEventListener('click', function () { copyFrom('pay-text', '收款文本'); });
  $('btn-csv-dish').addEventListener('click', function () {
    download('团餐汇总-按菜-' + curDate + '.csv', '\uFEFF' + C.toCsv(compute(curDate), { kind: 'dish' }), 'text/csv;charset=utf-8');
    flash('已导出按菜汇总 CSV。');
  });
  $('btn-csv-person').addEventListener('click', function () {
    download('团餐汇总-按人-' + curDate + '.csv', '\uFEFF' + C.toCsv(compute(curDate), { kind: 'person' }), 'text/csv;charset=utf-8');
    flash('已导出按人汇总 CSV。');
  });
  $('btn-json').addEventListener('click', exportJson);
  $('btn-menu-mode').addEventListener('click', function () { editCurrentMenu = !editCurrentMenu; renderAll(); });
  $('btn-warning-export').addEventListener('click', exportJson);
  $('btn-corrupt-discard').addEventListener('click', function () {
    askConfirm('丢弃浏览器里无法读取的旧数据并重新开始?此操作不能撤销。', function () {
      corrupt = false;
      state = C.emptyState();
      save();
      renderAll();
    });
  });

  $('file-import').addEventListener('change', function (ev) {
    var f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    var reader = new FileReader();
    reader.onerror = function () { flash('读取文件失败,没有导入。'); };
    reader.onload = function () {
      var r = C.validateImport(String(reader.result));
      if (!r.ok) { flash('导入被拒绝,现有数据没有改动:' + r.error); return; }
      function apply() { state = r.state; corrupt = false; resetDishForm(); save(); renderAll(); flash('已导入备份:菜单 ' + state.menu.length + ' 道,历史 ' + state.days.length + ' 天。'); }
      if (hasUserData()) askConfirm('备份已通过校验:菜单 ' + r.state.menu.length + ' 道,历史 ' + r.state.days.length + ' 天。导入会替换:' + scopeText() + '。确认替换吗?', apply);
      else apply();
    };
    reader.readAsText(f);
  });

  load();
  renderAll();
})();
