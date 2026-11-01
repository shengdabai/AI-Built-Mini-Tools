/* AI 订阅成本账本 · 界面与交互。所有用户输入通过 textContent 渲染,不注入 HTML 字符串。 */
(function () {
  'use strict';

  var C = globalThis.LedgerCore;
  var Sample = globalThis.LedgerSample;
  var STORAGE_KEY = 'aiLedger.v2';
  var LEGACY_STORAGE_KEY = 'aiLedger.v1';

  function pad(n) { return String(n).padStart(2, '0'); }
  function localToday() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  var TODAY = C.resolveToday(location.search, localToday());

  var ui = {
    view: 'overview', month: TODAY.slice(0, 7), editingId: null, chartCur: '',
    pending: null, suppressNext: false, loadNotice: '', editingOutputId: null, rawRecovery: []
  };
  var state = load();

  /* ---------- 存储 ---------- */
  function load() {
    var raw = null, legacy = null;
    try { raw = localStorage.getItem(STORAGE_KEY); legacy = localStorage.getItem(LEGACY_STORAGE_KEY); } catch (e) {
      ui.loadNotice = '浏览器不允许读取本地存储,本次按空白账本打开,改动无法保存。请用「备份 JSON」导出数据。';
      return C.emptyState();
    }
    if (raw) {
      var v = C.validateImport(raw, TODAY);
      if (v.ok) return v.data;
      ui.rawRecovery.push({ key: STORAGE_KEY, raw: raw });
    }
    if (legacy) {
      var old = C.validateImport(legacy, TODAY);
      if (old.ok) {
        ui.loadNotice = raw ? 'v2 存档损坏，已从有效 v1 恢复。保存前会归档损坏原文；旧 v1 保留。' : '已读取 v1 存档；首次保存写入 v2，旧 v1 保留。';
        return old.data;
      }
      ui.rawRecovery.push({ key: LEGACY_STORAGE_KEY, raw: legacy });
    }
    if (ui.rawRecovery.length) ui.loadNotice = '存档校验失败，当前显示空白账本。损坏原文已保留在内存；保存前必须先成功归档。可下载损坏原文。';
    return C.emptyState();
  }
  /* 返回是否真正写入;失败时显示持续可见的「未保存」提示,并让紧随其后的成功提示不出现。
     写入前用与读取相同的 validateState,保证「能保存」就「能读回」。 */
  function save() {
    var warn = $('save-warning');
    var v = C.validateState(state, TODAY);
    if (!v.ok) {
      $('save-warning-text').textContent = '未保存:数据没有通过校验(' + v.error + '),刚才的改动只在当前页面里。请导出 JSON 备份。';
      warn.hidden = false;
      ui.suppressNext = true;
      return false;
    }
    try {
      ui.rawRecovery.forEach(function (item) {
        var recoveryKey = item.key + ':corrupt-backup';
        localStorage.setItem(recoveryKey, item.raw);
        if (localStorage.getItem(recoveryKey) !== item.raw) throw new Error('原文归档回读失败');
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(v.data));
    } catch (e) {
      $('save-warning-text').textContent = '未保存:浏览器拒绝写入本地存储,刚才的改动只在当前页面里,关闭页面就会丢失。请立即导出 JSON 备份。';
      warn.hidden = false;
      ui.suppressNext = true;
      return false;
    }
    warn.hidden = true;
    ui.suppressNext = false;
    return true;
  }

  /* ---------- DOM 小工具 ---------- */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, children) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function btn(label, cls, onClick) {
    var b = el('button', 'btn ' + cls, [label]);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }
  function tag(text, cls) { return el('span', 'tag tag--' + cls, [text]); }
  function money(list) {
    return list.length ? list.map(function (x) { return x.currency + ' ' + C.formatMoney(x.cents, true); }).join(' / ') : '—';
  }

  var flashTimer = null;
  function flash(msg) {
    if (ui.suppressNext) { ui.suppressNext = false; return; }
    var n = $('flash');
    n.textContent = msg;
    n.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { n.hidden = true; }, 6000);
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
      var tr = el('tr', r.muted ? 'is-muted' : '');
      columns.forEach(function (c) {
        var td = el('td', c.num ? 'num' : '', [c.cell(r.data)]);
        td.setAttribute('data-label', c.label);
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    t.appendChild(body);
    wrap.appendChild(t);
    return wrap;
  }

  /* ---------- 视图切换 ---------- */
  function setView(name) {
    ui.view = name;
    document.querySelectorAll('.tab').forEach(function (t) {
      if (t.getAttribute('data-view') === name) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    document.querySelectorAll('.view').forEach(function (v) { v.hidden = v.id !== 'view-' + name; });
  }

  /* ---------- 页内确认区 ---------- */
  var returnFocus = null, fallbackSel = '';
  function ask(message, yesLabel, action, fallback) {
    ui.pending = action;
    returnFocus = document.activeElement; fallbackSel = fallback || '';
    $('confirm-text').textContent = message;
    $('btn-confirm-yes').textContent = yesLabel;
    $('confirm-box').hidden = false;
    $('btn-confirm-no').focus();
    $('confirm-box').scrollIntoView({ block: 'nearest' });
  }
  function closeAsk(restore) {
    ui.pending = null; $('confirm-box').hidden = true;
    if (restore === 'cancel' && returnFocus && returnFocus.isConnected) returnFocus.focus();
  }
  /* 确认删除后,原按钮已不存在:把焦点放到相邻位置 */
  function settleFocus() {
    if (returnFocus && returnFocus.isConnected) { returnFocus.focus(); return; }
    var t = fallbackSel ? document.querySelector(fallbackSel) : null;
    if (t) t.focus();
  }

  function hasData() {
    return state.subs.length > 0 || state.outputs.length > 0 || state.snapshots.length > 0 || state.settings.fx !== null || state.settings.wage !== null;
  }
  function isSample() {
    return state.subs.length > 0 && state.subs.every(function (s) { return s.id.indexOf('sample-') === 0; });
  }
  function settingsOf() { return state.settings; }

  /* 统一提交:先保存,再渲染,最后(仅真正写入成功时)提示 */
  function commit(msg) {
    var ok = save();
    renderAll();
    if (ok && msg) flash(msg);
    return ok;
  }
  function replaceState(next, msg) {
    state = next;
    ui.editingId = null;
    resetSubForm();
    resetOutputForm();
    fillSettingsForm();
    loadSnapshotForm();
    commit(msg);
  }

  /* ---------- 渲染:总览 ---------- */
  function stat(label, value, note, kind) {
    return el('div', 'stat' + (kind ? ' stat--' + kind : ''), [
      el('div', 'stat__label', [label]), el('div', 'stat__value', [value]), note ? el('div', 'stat__note', [note]) : null
    ]);
  }
  function wageTag(w) {
    if (!w) return null;
    return w.level === 'below' ? tag('低于时薪', 'ok') : w.level === 'above' ? tag('高于时薪', 'warn') : tag('等于时薪', 'no');
  }
  function perHourCell(list, hours) {
    var wrap = el('span', 'stack-inline');
    if (hours === null) { wrap.appendChild(document.createTextNode('未填产出')); return wrap; }
    if (hours === 0) { wrap.appendChild(document.createTextNode('产出为 0')); return wrap; }
    if (!list.length) { wrap.appendChild(document.createTextNode('—')); return wrap; }
    list.forEach(function (x) {
      var label = (x.estimated ? '估算 ' : '') + x.currency + ' ' + (x.cents === null ? '—' : C.formatMoney(x.cents, true) + '/小时');
      wrap.appendChild(el('span', '', [label + ' ', wageTag(x.wage)]));
    });
    return wrap;
  }

  function renderOverview() {
    var month = ui.month;
    var s = settingsOf();
    var sum = C.summarizeMonth(state.subs, state.outputs, month, s.fx, s.wage, state.snapshots);
    var cur = C.trend(state.subs, state.outputs, [month], s.fx, state.snapshots)[0];
    var prev = C.trend(state.subs, state.outputs, [C.addMonths(month, -1)], s.fx, state.snapshots)[0];
    var cmp = C.compare(cur, prev);
    var body = $('ov-body');
    clear(body);

    var cards = el('div', 'stat-grid');
    if (!sum.totals.byCurrency.length) cards.appendChild(stat(month + ' 月成本', '—', '这个月没有计入成本的订阅'));
    sum.totals.byCurrency.forEach(function (x) {
      var n = sum.totals.items.filter(function (it) { return it.sub.currency === x.currency; }).length;
      cards.appendChild(stat(x.currency + ' 月成本', C.formatMoney(x.cents, true), n + ' 个订阅,各币种不换汇'));
    });
    if (sum.totals.estimate) {
      var e = sum.totals.estimate;
      cards.appendChild(stat('估算合计(估算)', e.currency + ' ' + C.formatMoney(e.cents, true),
        '按 1 ' + e.from + ' = ' + e.rate + ' ' + e.currency + ' 折算,仅供总览' + (e.excluded.length ? ';未折算:' + e.excluded.join('、') : ''), 'estimate'));
    }
    cards.appendChild(stat('小时当量(自估)', sum.hours === null ? '未填' : C.fmtHours(sum.hours), sum.hours === null ? '本月还没有产出记录,只显示成本' : '折合人工小时:估计不用 AI 完成这些交付物需要多久;各用途合计'));
    if (sum.hours !== null) {
      if (sum.hours === 0) cards.appendChild(stat('每小时当量成本', '—', '本月产出为 0,无法计算'));
      else {
        sum.perHour.forEach(function (x) {
          cards.appendChild(stat('每小时当量成本(' + x.currency + ')', C.formatMoney(x.cents, true), '月成本 ÷ 折合人工小时;' + (x.wage ? (x.wage.level === 'below' ? '低于' : x.wage.level === 'above' ? '高于' : '等于') + '机会成本时薪' : '填写同币种时薪后可比较'), x.wage ? (x.wage.level === 'above' ? 'alert' : 'ok') : ''));
        });
        if (sum.perHourEstimate && sum.perHourEstimate.cents !== null) {
          var pe = sum.perHourEstimate;
          cards.appendChild(stat('每小时当量成本(估算)', pe.currency + ' ' + C.formatMoney(pe.cents, true), '月成本 ÷ 折合人工小时;' + (pe.wage ? (pe.wage.level === 'below' ? '低于' : pe.wage.level === 'above' ? '高于' : '等于') + '机会成本时薪' : '填写同币种时薪后可比较'), pe.wage ? (pe.wage.level === 'above' ? 'alert' : 'ok') : ''));
        } else if (sum.missingFx.length) {
          cards.appendChild(stat('每小时当量成本', '—', '有币种没有折算汇率(' + sum.missingFx.join('、') + '),不给总体比值和时薪结论', 'alert'));
        } else if (!sum.perHour.length) {
          cards.appendChild(stat('每小时当量成本', '—', '多币种请先设置折算汇率,或看下方各用途'));
        }
      }
    }
    body.appendChild(cards);

    body.appendChild(el('p', sum.sourceMode === 'snapshot' ? 'notice notice--ok' : 'notice notice--warn', [
      sum.sourceMode === 'snapshot'
        ? '成本口径：用户确认的月度成本快照（按月摊销，不是实付账单）；确认日期 ' + sum.snapshot.recordedDate + '；来源：' + sum.snapshot.source
        : '成本口径：按当前订阅状态推算。这个月份没有已确认快照，改订阅状态会改变这里的历史数字。'
    ]));

    if (sum.snapshot && sum.snapshot.warnings.length) body.appendChild(el('p', 'notice notice--warn', sum.snapshot.warnings));
    if (sum.totals.missingUsage.length) {
      body.appendChild(el('p', 'notice notice--warn', ['以下按量订阅还没有记 ' + month + ' 的账单，金额未知且未纳入合计；当前合计不完整：' + sum.totals.missingUsage.join('、')]));
    }

    var cmpPanel = el('div', 'panel', [el('h2', '', ['本月 vs 上月(' + C.addMonths(month, -1) + ')'])]);
    var cl = el('ul', 'plain-list');
    cmp.currencies.forEach(function (c) {
      var d = (c.diff >= 0 ? '+' : '-') + C.formatMoney(Math.abs(c.diff), true);
      cl.appendChild(el('li', '', [c.currency + ':' + C.formatMoney(c.now, true) + ' vs ' + C.formatMoney(c.prev, true) + ',变化 ' + d + (c.pct === null ? '' : '(' + (c.pct >= 0 ? '+' : '') + c.pct + '%)')]));
    });
    if (!cmp.currencies.length) cl.appendChild(el('li', '', ['两个月都没有成本']));
    if (cmp.hours) cl.appendChild(el('li', '', ['小时当量:' + (cmp.hours.now === null ? '未填' : C.fmtHours(cmp.hours.now)) + ' vs ' + (cmp.hours.prev === null ? '未填' : C.fmtHours(cmp.hours.prev))]));
    cmpPanel.appendChild(cl);
    body.appendChild(cmpPanel);

    var al = C.alerts(state.subs, state.outputs, TODAY);
    var alPanel = el('div', 'panel', [el('h2', '', ['提醒(截至 ' + TODAY + ')'])]);
    if (!al.length) alPanel.appendChild(el('p', 'empty', ['暂时没有提醒。']));
    else {
      var ul = el('ul', 'alert-list', []);
      var labels = { renew: ['续费', 'warn'], 'renew-overdue': ['续费日已过', 'error'], pause: ['考虑暂停', 'error'], overlap: ['重叠', 'warn'] };
      al.forEach(function (a) {
        ul.appendChild(el('li', 'alert-item alert-item--' + a.type, [tag(labels[a.type][0], labels[a.type][1]), el('span', '', [a.message])]));
      });
      alPanel.appendChild(ul);
    }
    body.appendChild(alPanel);

    var tp = el('div', 'panel', [el('h2', '', [month + ' 各用途:成本与产出'])]);
    if (!sum.perTag.length) tp.appendChild(el('p', 'empty', ['这个月没有成本也没有产出记录。']));
    else {
      tp.appendChild(table([
        { label: '用途', cell: function (r) { return r.tag; } },
        { label: '月成本', cell: function (r) { return money(r.byCurrency); } },
        { label: '小时当量', num: true, cell: function (r) { return r.hours === null ? '未填' : C.fmtHours(r.hours); } },
        { label: '每小时当量成本', cell: function (r) { if (r.missingFx.length && r.hours) return '缺汇率:' + r.missingFx.join('、'); return perHourCell(r.perHour.concat(r.perHourEstimate ? [r.perHourEstimate] : []), r.hours); } },
        { label: '证据(交付物)', cell: function (r) { return r.evidence || '—'; } }
      ], sum.perTag.map(function (r) { return { data: r }; })));
    }
    body.appendChild(tp);
  }

  /* ---------- 渲染:订阅 ---------- */
  function periodText(sub) {
    var t = C.PERIOD_LABEL[sub.period];
    if (sub.period === 'once') t += ',摊 ' + sub.amortMonths + ' 个月';
    return t;
  }
  function renderSubs() {
    var wrap = $('subs-table');
    clear(wrap);
    if (!state.subs.length) { wrap.appendChild(el('p', 'empty', ['还没有订阅。用上面的表单添加,或点「载入示例」。'])); return; }
    var statusCls = { active: 'ok', paused: 'warn', cancelled: 'no' };
    wrap.appendChild(table([
      { label: '服务', cell: function (s) { return el('span', 'stack-inline', [el('strong', '', [s.name]), s.tier ? el('span', 'hint', [s.tier]) : null]); } },
      { label: '原价', num: true, cell: function (s) { return s.period === 'usage' ? '按量' : s.currency + ' ' + C.formatMoney(s.amountCents, true); } },
      { label: '周期', cell: periodText },
      { label: ui.month + ' 成本', num: true, cell: function (s) { var c = C.monthlyCost(s, ui.month); return c > 0 ? s.currency + ' ' + C.formatMoney(c, true) : '—'; } },
      { label: '续费日', cell: function (s) { return s.renewDate || '—'; } },
      { label: '状态', cell: function (s) { return tag(C.STATUS_LABEL[s.status], statusCls[s.status]); } },
      { label: '用途', cell: function (s) { return s.tag; } },
      { label: '谁在用', cell: function (s) { return s.who === 'team' ? '团队 ' + s.headcount + ' 人' : '自己'; } },
      { label: '操作', cell: function (s) {
        return el('span', 'row', [
          btn('编辑', 'btn--secondary btn--small', function () { editSub(s.id); }),
          btn('删除', 'btn--danger-ghost btn--small', function () {
            ask('确认删除订阅「' + s.name + '」?它的按量账单会一起删除,产出记录不受影响。', '确认删除', function () {
              state.subs = state.subs.filter(function (x) { return x.id !== s.id; });
              if (ui.editingId === s.id) { ui.editingId = null; resetSubForm(); }
              commit('已删除订阅');
            });
          })
        ]);
      } }
    ], state.subs.map(function (s) { return { data: s, muted: s.status !== 'active' }; })));
  }

  function usageSubs() { return state.subs.filter(function (s) { return s.period === 'usage'; }); }
  function renderBills() {
    var sel = $('b-sub');
    var keep = sel.value;
    clear(sel);
    var list = usageSubs();
    list.forEach(function (s) {
      var o = document.createElement('option');
      o.value = s.id; o.textContent = s.name + '(' + s.currency + ')';
      sel.appendChild(o);
    });
    if (list.some(function (s) { return s.id === keep; })) sel.value = keep;
    $('usage-empty').hidden = list.length > 0;
    $('form-bill').hidden = list.length === 0;
    var wrap = $('bills-table');
    clear(wrap);
    var s = list.filter(function (x) { return x.id === sel.value; })[0];
    if (!s) return;
    var months = Object.keys(s.usageBills).sort().reverse();
    if (!months.length) { wrap.appendChild(el('p', 'empty', ['这个订阅还没有月账单。'])); return; }
    wrap.appendChild(table([
      { label: '月份', cell: function (m) { return m; } },
      { label: '实际账单', num: true, cell: function (m) { return s.currency + ' ' + C.formatMoney(s.usageBills[m], true); } },
      { label: '操作', cell: function (m) {
        return btn('删除', 'btn--danger-ghost btn--small', function () {
          ask('确认删除订阅「' + s.name + '」' + m + ' 的月账单(' + s.currency + ' ' + C.formatMoney(s.usageBills[m], true) + ')?删除后该月成本按 0 计,此操作不能撤销;确认前数据不变。', '确认删除账单', function () {
            delete s.usageBills[m];
            commit('已删除 ' + m + ' 的账单');
            settleFocus();
          }, '#bills-table button');
        });
      } }
    ], months.map(function (m) { return { data: m }; })));
  }

  /* ---------- 渲染:产出 ---------- */
  function renderOutputs() {
    var wrap = $('outputs-table');
    clear(wrap);
    if (!state.outputs.length) { wrap.appendChild(el('p', 'empty', ['还没有产出记录。'])); return; }
    var rows = state.outputs.slice().sort(function (a, b) {
      return a.month === b.month ? C.TAGS.indexOf(a.tag) - C.TAGS.indexOf(b.tag) : (a.month < b.month ? 1 : -1);
    });
    wrap.appendChild(table([
      { label: '月份', cell: function (o) { return o.month; } },
      { label: '用途', cell: function (o) { return o.tag; } },
      { label: '小时当量', num: true, cell: function (o) { return C.fmtHours(o.hours); } },
      { label: '证据(交付物)', cell: function (o) { return o.evidence || '—'; } },
      { label: '操作', cell: function (o) {
        return el('span', 'row', [
          btn('编辑', 'btn--secondary btn--small', function () {
            ui.editingOutputId = o.id; $('btn-out-cancel').hidden = false; $('btn-out-save').textContent = '保存修改';
            $('output-error').hidden = true;
            $('o-month').value = o.month; $('o-tag').value = o.tag; $('o-hours').value = C.fmtHours(o.hours); $('o-evidence').value = o.evidence;
            $('o-hours').focus();
          }),
          btn('删除', 'btn--danger-ghost btn--small', function () {
            ask('确认删除 ' + o.month + '「' + o.tag + '」的产出记录(' + C.fmtHours(o.hours) + ' 小时当量' + (o.evidence ? ',证据:' + o.evidence.slice(0, 40) + (o.evidence.length > 40 ? '…' : '') : '') + ')?删除后该月该用途变为「未填」,此操作不能撤销;确认前数据不变。', '确认删除产出', function () {
              state.outputs = state.outputs.filter(function (x) { return x.id !== o.id; });
              if (ui.editingOutputId === o.id) resetOutputForm();
              commit('已删除产出记录');
              settleFocus();
            }, '#o-hours');
          })
        ]);
      } }
    ], rows.map(function (o) { return { data: o }; })));
  }

  /* ---------- 渲染:月度成本快照 ---------- */
  function snapshotCostText(snapshot) {
    return money(C.snapshotTotals(snapshot, null).byCurrency);
  }
  function renderSnapshotPreview() {
    var month = C.parseMonth($('snap-month').value);
    var box = $('snapshot-preview');
    if (!month) { box.textContent = '请先选择成本月份。'; return; }
    var r = C.createSnapshot(state.subs, month, $('snap-date').value || TODAY, '待填写来源', '', 'preview', TODAY);
    if (!r.ok) { box.textContent = '当前无法生成快照：' + r.error + '。请先录入这个月实际计入成本的订阅和按量账单。'; return; }
    var existing = C.snapshotForMonth(state.snapshots, month);
    box.textContent = (existing ? '这个月份已有快照。保存会更新它。当前快照：' + snapshotCostText(existing) + '；重新核对后将记录：' : '待确认：') + snapshotCostText(r.snapshot) + '，共 ' + r.snapshot.items.length + ' 项订阅明细。';
  }
  function loadSnapshotForm() {
    var month = C.parseMonth($('snap-month').value);
    var existing = month ? C.snapshotForMonth(state.snapshots, month) : null;
    $('snap-date').value = existing ? existing.recordedDate : TODAY;
    $('snap-source').value = existing ? existing.source : '';
    $('snap-note').value = existing ? existing.note : '';
    $('btn-snapshot-save').textContent = existing ? '更新已确认成本快照' : '保存已确认成本快照';
    $('snapshot-error').hidden = true;
    renderSnapshotPreview();
  }
  function renderSnapshots() {
    var wrap = $('snapshots-table');
    clear(wrap);
    if (!state.snapshots.length) { wrap.appendChild(el('p', 'empty', ['还没有月度成本快照。先核对各项按月摊销金额与按量账单，再保存。快照不是实付账单。'])); }
    else {
      var rows = state.snapshots.slice().sort(function (a, b) { return b.month.localeCompare(a.month); });
      wrap.appendChild(table([
        { label: '月份', cell: function (s) { return s.month; } },
        { label: '已确认成本', cell: snapshotCostText },
        { label: '明细', num: true, cell: function (s) { return s.items.length + ' 项'; } },
        { label: '确认日期', cell: function (s) { return s.recordedDate; } },
        { label: '完整性', cell: function (s) { return s.warnings.length ? s.warnings.join('；') : '生成时按量账单已填；金额由用户确认'; } },
        { label: '来源与备注', cell: function (s) { return el('span', 'stack-inline', [el('strong', '', [s.source]), s.note ? el('span', 'hint', [s.note]) : null]); } },
        { label: '操作', cell: function (s) { return el('span', 'row', [
          btn('重新核对', 'btn--secondary btn--small', function () { $('snap-month').value = s.month; loadSnapshotForm(); setView('snapshots'); $('snap-source').focus(); }),
          btn('删除快照', 'btn--danger-ghost btn--small', function () {
            ask('确认删除 ' + s.month + ' 的已确认成本快照（' + snapshotCostText(s) + '）？删除后趋势和月报会改回按当前订阅状态推算。', '确认删除快照', function () {
              state.snapshots = state.snapshots.filter(function (x) { return x.id !== s.id; });
              commit('已删除成本快照');
              loadSnapshotForm();
            });
          })
        ]); } }
      ], rows.map(function (s) { return { data: s }; })));
    }
    renderSnapshotPreview();
  }
  function submitSnapshot(ev) {
    ev.preventDefault();
    var month = C.parseMonth($('snap-month').value);
    var date = C.parseDate($('snap-date').value);
    var source = $('snap-source').value.trim();
    var note = $('snap-note').value;
    if (!month) { showErr('snapshot-error', '请选择成本月份。'); $('snap-month').focus(); return; }
    if (!date) { showErr('snapshot-error', '请选择真实存在的确认日期。'); $('snap-date').focus(); return; }
    if (!source) { showErr('snapshot-error', '请填写确认来源，例如已核对的账单或收据。'); $('snap-source').focus(); return; }
    var existing = C.snapshotForMonth(state.snapshots, month);
    var made = C.createSnapshot(state.subs, month, date, source, note, existing ? existing.id : newId('snap'), TODAY);
    if (!made.ok) { showErr('snapshot-error', made.error); return; }
    var saved = C.upsertSnapshot(state.snapshots, made.snapshot);
    if (!saved.ok) { showErr('snapshot-error', saved.error); return; }
    state.snapshots = saved.snapshots;
    $('snapshot-error').hidden = true;
    commit(saved.updated ? '已更新 ' + month + ' 的成本快照' : '已保存 ' + month + ' 的成本快照');
    loadSnapshotForm();
  }

  /* ---------- 渲染:趋势 ---------- */
  function renderTrend() {
    var months = C.lastMonths(TODAY, 12);
    var tr = C.trend(state.subs, state.outputs, months, settingsOf().fx, state.snapshots);
    var cur = new Set();
    tr.forEach(function (t) { t.byCurrency.forEach(function (x) { cur.add(x.currency); }); });
    var opts = Array.from(cur).sort();
    var hasEst = !!settingsOf().fx;
    var sel = $('chart-cur');
    clear(sel);
    opts.forEach(function (c) { var o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o); });
    if (hasEst) { var oe = document.createElement('option'); oe.value = '__est'; oe.textContent = '估算合计(' + settingsOf().fx.to + ',估算)'; sel.appendChild(oe); }
    if (!ui.chartCur || (opts.indexOf(ui.chartCur) < 0 && !(ui.chartCur === '__est' && hasEst))) ui.chartCur = opts[0] || (hasEst ? '__est' : '');
    sel.value = ui.chartCur;
    sel.disabled = !sel.options.length;

    function costOf(t) {
      if (ui.chartCur === '__est') return t.estimate ? t.estimate.cents : 0;
      var f = t.byCurrency.filter(function (x) { return x.currency === ui.chartCur; })[0];
      return f ? f.cents : 0;
    }
    var unit = ui.chartCur === '__est' ? settingsOf().fx.to + '(估算)' : ui.chartCur;
    var maxCost = Math.max.apply(null, tr.map(costOf).concat([0]));
    var maxHours = Math.max.apply(null, tr.map(function (t) { return t.hours || 0; }).concat([0]));
    var n = tr.length;

    var wrap = $('chart-wrap');
    clear(wrap);
    if (!maxCost && !maxHours) { wrap.appendChild(el('p', 'empty', ['近 12 个月还没有数据。'])); $('trend-table').textContent = ''; return; }

    var legend = el('p', 'chart__legend', [
      el('span', 'chart__key chart__key--bar', []), '月成本(' + unit + ')   ',
      el('span', 'chart__key chart__key--line', []), '小时当量(自估)'
    ]);
    var plot = el('div', 'chart__plot');
    plot.setAttribute('role', 'img');
    plot.setAttribute('aria-label', '近 12 个月成本柱与产出小时当量折线,数据见下方表格');
    var svgNs = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('class', 'chart__lines');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    var pts = tr.map(function (t, i) {
      return t.hours === null || !maxHours ? null : { x: (i + 0.5) / n * 100, y: 100 - t.hours / maxHours * 100 };
    });
    for (var i = 0; i + 1 < n; i++) {
      if (pts[i] && pts[i + 1]) {
        var ln = document.createElementNS(svgNs, 'line');
        ln.setAttribute('class', 'chart__segment');
        ln.setAttribute('x1', pts[i].x); ln.setAttribute('y1', pts[i].y);
        ln.setAttribute('x2', pts[i + 1].x); ln.setAttribute('y2', pts[i + 1].y);
        svg.appendChild(ln);
      }
    }
    plot.appendChild(svg);
    var labels = el('div', 'chart__labels');
    tr.forEach(function (t, i) {
      var col = el('div', 'chart__col');
      var bar = el('div', 'chart__bar');
      bar.style.height = (maxCost ? costOf(t) / maxCost * 100 : 0) + '%';
      col.appendChild(bar);
      if (pts[i]) {
        var dot = el('div', 'chart__dot');
        dot.style.bottom = (100 - pts[i].y) + '%';
        col.appendChild(dot);
      }
      plot.appendChild(col);
      labels.appendChild(el('div', 'chart__label', [t.month.slice(5)]));
    });
    wrap.appendChild(legend);
    wrap.appendChild(plot);
    wrap.appendChild(labels);

    var tt = $('trend-table');
    clear(tt);
    tt.appendChild(table([
      { label: '月份', cell: function (t) { return t.month; } },
      { label: '各币种月成本', cell: function (t) { return money(t.byCurrency); } },
      { label: '估算合计', cell: function (t) { return t.estimate ? t.estimate.currency + ' ' + C.formatMoney(t.estimate.cents, true) + '(估算)' : '—'; } },
      { label: '成本口径', cell: function (t) { return t.sourceMode === 'snapshot' ? '已确认快照' : '当前状态推算'; } },
      { label: '小时当量', num: true, cell: function (t) { return t.hours === null ? '未填' : C.fmtHours(t.hours); } }
    ], tr.map(function (t) { return { data: t }; })));
  }

  /* ---------- 渲染:导出 ---------- */
  function reportText() {
    return C.toMarkdown(state.subs, state.outputs, ui.month, { fx: settingsOf().fx, wage: settingsOf().wage, today: TODAY, snapshots: state.snapshots });
  }
  function renderExport() {
    $('export-month').textContent = ui.month;
    $('md-preview').value = reportText();
    updateDirty();
  }

  function renderAll() {
    var empty = !hasData();
    $('empty-guide').hidden = !empty;
    $('sample-badge').hidden = !isSample();
    $('ov-month').value = ui.month;
    $('today-label').textContent = TODAY;
    $('load-notice').hidden = !ui.loadNotice;
    $('load-notice-text').textContent = ui.loadNotice;
    $('btn-export-raw-recovery').hidden = !ui.rawRecovery.length;
    renderOverview();
    renderSubs();
    renderBills();
    renderOutputs();
    renderSnapshots();
    renderTrend();
    renderExport();
  }

  /* ---------- 设置表单 ---------- */
  function fillSettingsForm() {
    var s = settingsOf();
    $('fx-from').value = s.fx ? s.fx.from : '';
    $('fx-to').value = s.fx ? s.fx.to : '';
    $('fx-rate').value = s.fx ? String(s.fx.rate) : '';
    $('wage-amount').value = s.wage ? C.formatMoney(s.wage.cents) : '';
    $('wage-currency').value = s.wage ? s.wage.currency : '';
    $('settings-error').hidden = true;
  }
  function readSettingsForm() {
    var from = $('fx-from').value.trim().toUpperCase(), to = $('fx-to').value.trim().toUpperCase(), rateStr = $('fx-rate').value.trim();
    var wAmt = $('wage-amount').value.trim(), wCur = $('wage-currency').value.trim().toUpperCase();
    var out = { fx: null, wage: null };
    if (from || to || rateStr) {
      if (!/^\d+(\.\d+)?$/.test(rateStr)) return { error: '折算汇率必须是大于 0 的数字,例如 7.2' };
      out.fx = { from: from, to: to, rate: Number(rateStr) };
      var fe = C.validateFx(out.fx);
      if (fe) return { error: fe };
    }
    if (wAmt || wCur) {
      var cents = C.parseMoney(wAmt);
      if (cents === null) return { error: '时薪必须是数字,最多两位小数' };
      out.wage = { cents: cents, currency: wCur };
      var we = C.validateWage(out.wage);
      if (we) return { error: we };
    }
    return { settings: out };
  }
  function updateDirty() {
    var r = readSettingsForm();
    var dirty = !!r.error || JSON.stringify(r.settings) !== JSON.stringify(settingsOf());
    $('settings-dirty').hidden = !dirty;
    $('export-hint').hidden = !dirty;
    $('btn-export-md').disabled = dirty;
    return dirty;
  }

  /* ---------- 订阅表单 ---------- */
  function fillTagOptions() {
    ['f-tag', 'o-tag'].forEach(function (id) {
      var sel = $(id);
      clear(sel);
      C.TAGS.forEach(function (t) { var o = document.createElement('option'); o.value = t; o.textContent = t; sel.appendChild(o); });
    });
  }
  function syncSubFormVisibility() {
    $('f-currency-other-wrap').hidden = $('f-currency').value !== '其他';
    $('f-amort-wrap').hidden = $('f-period').value !== 'once';
    $('f-headcount-wrap').hidden = $('f-who').value !== 'team';
    $('f-amount').disabled = false;
  }
  function resetSubForm() {
    $('form-sub').reset();
    $('f-tag').value = C.TAGS[0];
    $('sub-form-title').textContent = '新增订阅';
    $('btn-sub-save').textContent = '添加订阅';
    $('sub-error').hidden = true;
    ui.editingId = null;
    syncSubFormVisibility();
  }
  function editSub(id) {
    var s = state.subs.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    ui.editingId = id;
    $('f-name').value = s.name; $('f-tier').value = s.tier;
    var known = ['USD', 'CNY', 'EUR', 'JPY', 'GBP'];
    if (known.indexOf(s.currency) >= 0) { $('f-currency').value = s.currency; $('f-currency-other').value = ''; }
    else { $('f-currency').value = '其他'; $('f-currency-other').value = s.currency; }
    $('f-amount').value = C.formatMoney(s.amountCents);
    $('f-period').value = s.period; $('f-amort').value = s.amortMonths;
    $('f-start').value = s.startDate; $('f-renew').value = s.renewDate;
    $('f-status').value = s.status; $('f-tag').value = s.tag; $('f-who').value = s.who; $('f-headcount').value = s.headcount;
    $('sub-form-title').textContent = '编辑订阅';
    $('btn-sub-save').textContent = '保存修改';
    $('sub-error').hidden = true;
    syncSubFormVisibility();
    setView('subs');
    $('f-name').focus();
  }
  function showErr(id, msg) { var n = $(id); n.textContent = msg; n.hidden = false; }
  function newId(prefix) { return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function submitSub(ev) {
    ev.preventDefault();
    var cur = $('f-currency').value === '其他' ? $('f-currency-other').value.trim().toUpperCase() : $('f-currency').value;
    var amount = C.parseMoney($('f-amount').value);
    if (amount === null) { showErr('sub-error', '金额必须是数字,最多两位小数,不能为负;按量订阅可填 0。'); return; }
    var period = $('f-period').value, who = $('f-who').value;
    var existing = ui.editingId ? state.subs.filter(function (x) { return x.id === ui.editingId; })[0] : null;
    var sub = {
      id: existing ? existing.id : newId('sub'), name: $('f-name').value, tier: $('f-tier').value, currency: cur, amountCents: amount,
      period: period, startDate: $('f-start').value, renewDate: $('f-renew').value, status: $('f-status').value, tag: $('f-tag').value,
      who: who, headcount: who === 'team' ? Number($('f-headcount').value) : 1,
      amortMonths: period === 'once' ? Number($('f-amort').value) : (existing ? existing.amortMonths : 12),
      usageBills: existing ? existing.usageBills : {}
    };
    var err = C.validateSub(sub);
    if (err) { showErr('sub-error', err); return; }
    if (existing) state.subs = state.subs.map(function (x) { return x.id === existing.id ? sub : x; });
    else state.subs = state.subs.concat([sub]);
    var msg = existing ? '已保存修改' : '已添加订阅「' + sub.name + '」';
    resetSubForm();
    commit(msg);
  }

  function submitBill(ev) {
    ev.preventDefault();
    var s = state.subs.filter(function (x) { return x.id === $('b-sub').value; })[0];
    if (!s) { showErr('bill-error', '请先选择一个按量订阅。'); return; }
    var month = C.parseMonth($('b-month').value);
    if (!month) { showErr('bill-error', '请选择月份。'); return; }
    var cents = C.parseMoney($('b-amount').value);
    if (cents === null) { showErr('bill-error', '账单金额必须是数字,最多两位小数,不能为负。'); return; }
    s.usageBills[month] = cents;
    $('bill-error').hidden = true;
    $('b-amount').value = '';
    commit('已记入 ' + month + ' 的账单');
  }

  function submitOutput(ev) {
    ev.preventDefault();
    var month = C.parseMonth($('o-month').value);
    if (!month) { showErr('output-error', '请选择月份。'); return; }
    var hours = C.parseHours($('o-hours').value);
    if (hours === null) { showErr('output-error', '小时当量必须是 0 到 ' + C.MAX_HOURS + ' 的数字,最多两位小数。'); return; }
    var rec = { id: newId('out'), month: month, tag: $('o-tag').value, hours: hours, evidence: $('o-evidence').value };
    var err = C.validateOutput(rec);
    if (err) { showErr('output-error', err); return; }
    var r = C.upsertOutput(state.outputs, rec, ui.editingOutputId);
    if (!r.ok) { showErr('output-error', r.error); return; }
    state.outputs = r.outputs;
    $('output-error').hidden = true;
    resetOutputForm();
    commit(r.updated ? '已更新 ' + month + '「' + rec.tag + '」的产出' : '已保存产出');
  }
  function resetOutputForm() {
    ui.editingOutputId = null;
    $('btn-out-cancel').hidden = true;
    $('btn-out-save').textContent = '保存产出';
    $('o-hours').value = ''; $('o-evidence').value = '';
  }

  function submitSettings(ev) {
    ev.preventDefault();
    var r = readSettingsForm();
    if (r.error) { showErr('settings-error', r.error); return; }
    $('settings-error').hidden = true;
    state.settings = r.settings;
    commit('已应用设置');
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
  function exportJson() { download('ai-ledger-backup.json', JSON.stringify(state, null, 2), 'application/json'); }
  function importFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var v = C.validateImport(String(reader.result), TODAY);
      if (!v.ok) {
        $('import-error-text').textContent = '导入被拒绝,现有数据没有改动:' + v.error;
        $('import-error').hidden = false;
        return;
      }
      $('import-error').hidden = true;
      var apply = function () { replaceState(v.data, '已导入 ' + v.data.subs.length + ' 个订阅、' + v.data.outputs.length + ' 条产出、' + v.data.snapshots.length + ' 份成本快照'); };
      if (hasData()) ask('导入会用文件内容替换当前全部数据(' + state.subs.length + ' 个订阅、' + state.outputs.length + ' 条产出、' + state.snapshots.length + ' 份成本快照)。确认替换?建议先备份 JSON。', '确认替换', apply);
      else apply();
    };
    reader.onerror = function () {
      $('import-error-text').textContent = '导入被拒绝:无法读取文件。';
      $('import-error').hidden = false;
    };
    reader.readAsText(file);
  }
  function loadSample() {
    var apply = function () { replaceState(Sample.build(TODAY), '已载入合成示例(' + Sample.NOTE + ')'); };
    if (hasData()) ask('载入示例会替换当前全部数据(' + state.subs.length + ' 个订阅、' + state.outputs.length + ' 条产出、' + state.snapshots.length + ' 份成本快照)。确认替换?建议先备份 JSON。', '确认替换', apply);
    else apply();
  }

  /* ---------- 事件 ---------- */
  function init() {
    fillTagOptions();
    fillSettingsForm();
    resetSubForm();
    $('o-month').value = ui.month;
    $('b-month').value = ui.month;
    $('snap-month').value = ui.month;
    $('snap-date').value = TODAY;
    $('snap-month').max = TODAY.slice(0, 7);
    $('snap-date').max = TODAY;

    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () { setView(t.getAttribute('data-view')); });
    });
    $('btn-sample').addEventListener('click', loadSample);
    $('btn-sample-2').addEventListener('click', loadSample);
    $('btn-export-json-top').addEventListener('click', exportJson);
    $('btn-export-raw-recovery').addEventListener('click', function () { download('ai-ledger-corrupt-raw-recovery.json', JSON.stringify({ kind: 'raw-recovery', entries: ui.rawRecovery }, null, 2), 'application/json'); });
    $('btn-save-warning-export').addEventListener('click', exportJson);
    $('btn-export-json').addEventListener('click', exportJson);
    $('btn-export-csv').addEventListener('click', function () { download('ai-subscriptions-' + ui.month + '.csv', '\ufeff' + C.toCsv(state.subs, ui.month), 'text/csv'); });
    $('btn-export-md').addEventListener('click', function () {
      if (updateDirty()) return;
      download('ai-cost-report-' + ui.month + '.md', reportText(), 'text/markdown');
    });
    $('file-import').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) importFile(f);
      e.target.value = '';
    });
    $('btn-import-error-close').addEventListener('click', function () { $('import-error').hidden = true; });
    $('btn-clear').addEventListener('click', function () {
      ask('确认清空所有订阅、产出、月度成本快照和设置?建议先备份 JSON。', '确认清空', function () {
        ui.loadNotice = '';
        replaceState(C.emptyState(), '已清空');
      });
    });
    $('btn-confirm-yes').addEventListener('click', function () { var a = ui.pending; closeAsk(); if (a) a(); });
    $('btn-confirm-no').addEventListener('click', function () { closeAsk('cancel'); });
    $('btn-pick-import').addEventListener('click', function () { $('file-import').click(); });

    $('ov-month').addEventListener('change', function (e) {
      var m = C.parseMonth(e.target.value);
      if (m) { ui.month = m; renderAll(); }
    });
    $('chart-cur').addEventListener('change', function (e) { ui.chartCur = e.target.value; renderTrend(); });
    $('form-sub').addEventListener('submit', submitSub);
    $('btn-sub-reset').addEventListener('click', resetSubForm);
    ['f-currency', 'f-period', 'f-who'].forEach(function (id) { $(id).addEventListener('change', syncSubFormVisibility); });
    $('form-bill').addEventListener('submit', submitBill);
    $('b-sub').addEventListener('change', renderBills);
    $('form-output').addEventListener('submit', submitOutput);
    $('btn-out-cancel').addEventListener('click', function () { $('output-error').hidden = true; resetOutputForm(); });
    $('form-settings').addEventListener('submit', submitSettings);
    $('form-snapshot').addEventListener('submit', submitSnapshot);
    $('snap-month').addEventListener('change', loadSnapshotForm);
    ['snap-date', 'snap-source', 'snap-note'].forEach(function (id) { $(id).addEventListener('input', renderSnapshotPreview); });
    ['fx-from', 'fx-to', 'fx-rate', 'wage-amount', 'wage-currency'].forEach(function (id) { $(id).addEventListener('input', updateDirty); });

    renderAll();
  }

  init();
})();
