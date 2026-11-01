'use strict';
/* 试课跟进看板 · DOM 与交互。逻辑全部来自 core.js(FollowCore)。所有用户输入通过 textContent 渲染。 */
(function () {
  var C = globalThis.FollowCore;
  var SAMPLE = globalThis.FollowSample;
  var KEY = 'followboard.v1';
  var CURRENCIES = ['', 'CNY', 'USD', 'EUR', 'GBP', 'JPY'];

  var todayInfo = C.resolveTodayInfo(location.search, new Date());
  var today = todayInfo.date;
  var state = { leads: [], n: C.DEFAULT_N, sample: false };
  var ui = { open: {}, pendingLoss: null, editingId: null, pending: null, focusFn: null, contactLeadId: null, contactCorrectId: null, pendingContact: null, archiveEventId: null };

  function $(id) { return document.getElementById(id); }
  function el(tag, opts, kids) {
    var node = document.createElement(tag);
    opts = opts || {};
    if (opts.cls) node.className = opts.cls;
    if (opts.text !== undefined) node.textContent = opts.text;
    if (opts.attrs) Object.keys(opts.attrs).forEach(function (k) { node.setAttribute(k, opts.attrs[k]); });
    (kids || []).forEach(function (k) { if (k) node.appendChild(k); });
    return node;
  }

  /* ---------- 存取 ---------- */
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      var v = C.validateImport({ leads: data.leads || [] });
      if (v.ok) { state.leads = v.leads; state.sample = data.sample === true; }
      if (data.n >= 1 && data.n <= 60) state.n = data.n;
    } catch (e) { /* 存储不可用或数据损坏时从空状态开始 */ }
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ leads: state.leads, n: state.n, sample: state.sample }));
      return true;
    } catch (e) { return false; }
  }
  function showSaveWarning(failed) {
    $('save-warning').hidden = !failed;
  }
  function say(text, isError) {
    var s = $('status');
    s.textContent = text || '';
    s.className = 'status' + (isError ? ' status--error' : '');
  }
  function commit(message) {
    var ok = save();
    showSaveWarning(!ok);
    render();
    if (message) say(ok ? message : message + '(仅在当前页面生效,尚未写入浏览器存储)', !ok);
  }
  function byId(id) { return state.leads.filter(function (l) { return l.id === id; })[0]; }
  function replaceLead(next) {
    state.leads = state.leads.map(function (l) { return l.id === next.id ? next : l; });
  }
  function pct(r) { return r === null ? '暂无数据' : (Math.round(r * 1000) / 10) + '%'; }

  /* ---------- 渲染 ---------- */
  function render() {
    $('today-label').textContent = today;
    $('today-fixed').hidden = !todayInfo.fixed;
    $('today-fixed').textContent = '(基准日由地址参数固定)';
    $('n-input').value = String(state.n);
    var has = state.leads.length > 0;
    $('empty').hidden = has;
    $('sample-badge').hidden = !state.sample;
    renderToday();
    renderBoard();
    renderStats();
    if (!$('report-panel').hidden) refreshReport(false);
    renderExportState();
    if (ui.focusFn) { var f = ui.focusFn; ui.focusFn = null; f(); }
  }

  /* 焦点:操作后重绘列表,把焦点放回同一条线索的同一类控件,没有就放到相邻位置 */
  function focusLead(id, act, fallbackId) {
    ui.focusFn = function () {
      var nodes = Array.prototype.slice.call(document.querySelectorAll('[data-act="' + act + '"]'));
      var hit = nodes.filter(function (n) { return n.getAttribute('data-id') === id; })[0];
      if (!hit) hit = nodes[0];
      if (hit) hit.focus();
      else { var f = $(fallbackId || 'today-zone'); if (f) { if (!f.hasAttribute('tabindex')) f.setAttribute('tabindex', '-1'); f.focus(); } }
    };
  }

  function renderToday() {
    var list = C.overdue(state.leads, today, state.n);
    $('today-count').textContent = String(list.length);
    $('today-hint').textContent = '距最近联系超过 ' + state.n + ' 天,或下一步计划日期已过的线索,逾期最久的在前。已付款、已开课、流失不计入。';
    var ul = $('today-list');
    ul.textContent = '';
    if (!list.length) {
      ul.appendChild(el('li', { cls: 'today-empty', text: state.leads.length ? '今天没有需要补跟的线索。' : '载入示例或新建线索后,这里会列出需要跟进的人。' }));
      return;
    }
    list.forEach(function (o) {
      var l = o.lead;
      var why = [];
      if (o.reasons.indexOf('contact') >= 0) why.push('距最近联系 ' + o.daysSince + ' 天(阈值 ' + state.n + ' 天)');
      if (o.reasons.indexOf('planned') >= 0) why.push('计划日期 ' + l.nextDate + ' 已过 ' + C.diffDays(today, l.nextDate) + ' 天');
      var li = el('li', { cls: 'today-item' }, [
        el('div', { cls: 'today-item__head' }, [
          el('strong', { text: l.name }),
          el('span', { cls: 'tag tag--warn', text: '逾期 ' + o.overdueDays + ' 天' })
        ]),
        el('div', { cls: 'card__meta', text: l.stage + ' · ' + l.channel }),
        el('div', { text: why.join(';') }),
        el('div', { cls: 'card__next', text: l.nextAction ? '下一步:' + l.nextAction + (l.nextDate ? '(' + l.nextDate + ')' : '') : '尚未记录下一步' }),
        el('div', { cls: 'row' }, [
          el('button', { cls: 'btn btn--primary btn--small', text: '今天已联系', attrs: { type: 'button', 'data-act': 'touch', 'data-id': l.id } }),
          el('button', { cls: 'btn btn--small', text: '编辑', attrs: { type: 'button', 'data-act': 'edit', 'data-id': l.id } })
        ])
      ]);
      ul.appendChild(li);
    });
  }

  function stageOptions(lead) {
    var opts = [];
    if (lead.stage === C.LOST) {
      C.STAGES.forEach(function (s) { opts.push(s); });
    } else {
      var i = C.STAGES.indexOf(lead.stage);
      C.STAGES.slice(i + 1).forEach(function (s) { opts.push(s); });
      opts.push(C.LOST);
    }
    return opts;
  }

  function buildCard(lead, overdueMap) {
    var od = overdueMap[lead.id];
    var since = C.daysSinceContact(lead, today);
    var head = el('div', { cls: 'card__head' }, [
      el('span', { cls: 'card__name', text: lead.name }),
      od ? el('span', { cls: 'tag tag--warn', text: '逾期 ' + od + ' 天' }) : null
    ]);
    var kids = [
      head,
      el('div', { cls: 'card__meta', text: lead.channel + ' · ' + lead.goal }),
      el('div', { cls: 'card__meta', text: '距最近联系 ' + since + ' 天' }),
      lead.nextAction ? el('div', { cls: 'card__next', text: '下一步:' + lead.nextAction + (lead.nextDate ? '(' + lead.nextDate + ')' : '') }) : null,
      lead.quoteAmount !== '' && lead.quoteAmount !== undefined ? el('div', { cls: 'card__meta', text: '报价 ' + lead.quoteAmount + ' ' + lead.quoteCurrency }) : null,
      lead.stage === C.LOST ? el('div', null, [el('span', { cls: 'tag', text: '流失原因:' + lead.lossReason })]) : null
    ];
    var actions = el('div', { cls: 'card__actions' });
    if (ui.pendingLoss === lead.id) {
      var sel = el('select', { attrs: { 'aria-label': '选择' + lead.name + '的流失原因', 'data-role': 'loss-reason' } });
      C.LOSS_REASONS.forEach(function (r) { sel.appendChild(el('option', { text: r, attrs: { value: r } })); });
      actions.appendChild(el('div', { cls: 'loss-chooser' }, [
        el('span', { text: '流失原因' }), sel,
        el('div', { cls: 'row' }, [
          el('button', { cls: 'btn btn--danger btn--small', text: '确认流失', attrs: { type: 'button', 'data-act': 'loss-yes', 'data-id': lead.id } }),
          el('button', { cls: 'btn btn--small', text: '取消', attrs: { type: 'button', 'data-act': 'loss-no', 'data-id': lead.id } })
        ])
      ]));
    } else {
      var adv = el('select', { attrs: { 'aria-label': (lead.stage === C.LOST ? '恢复 ' : '推进 ') + lead.name + ' 到', 'data-act': 'advance', 'data-id': lead.id } });
      adv.appendChild(el('option', { text: lead.stage === C.LOST ? '恢复到…' : '推进到…', attrs: { value: '' } }));
      stageOptions(lead).forEach(function (s) { adv.appendChild(el('option', { text: s, attrs: { value: s } })); });
      actions.appendChild(adv);
      actions.appendChild(el('button', { cls: 'btn btn--small', text: '记录跟进', attrs: { type: 'button', 'data-act': 'contact', 'data-id': lead.id } }));
      actions.appendChild(el('button', { cls: 'btn btn--small', text: '编辑', attrs: { type: 'button', 'data-act': 'edit', 'data-id': lead.id } }));
    }
    kids.push(actions);
    return el('article', { cls: 'card' }, kids);
  }

  function renderBoard() {
    var board = $('board');
    board.textContent = '';
    var overdueMap = {};
    C.overdue(state.leads, today, state.n).forEach(function (o) { overdueMap[o.lead.id] = o.overdueDays; });
    C.STAGES.concat([C.LOST]).forEach(function (stage, idx) {
      var items = state.leads.filter(function (l) { return l.stage === stage; });
      var det = el('details', { cls: 'col col--s' + idx, attrs: { 'data-stage': stage } });
      var open = ui.open[stage] === undefined ? items.length > 0 : ui.open[stage];
      if (open) det.setAttribute('open', '');
      det.appendChild(el('summary', null, [el('span', { text: stage }), el('span', { cls: 'count', text: String(items.length) })]));
      var body = el('div', { cls: 'col__body' });
      if (!items.length) body.appendChild(el('div', { cls: 'col__empty', text: '暂无' }));
      items.forEach(function (l) { body.appendChild(buildCard(l, overdueMap)); });
      det.appendChild(body);
      board.appendChild(det);
    });
  }

  function barRow(label, value, max, valueText, extraCls) {
    var w = max > 0 ? Math.round((value / max) * 1000) / 10 : 0;
    var fill = el('div', { cls: 'bar-fill' + (extraCls ? ' ' + extraCls : '') });
    fill.style.width = w + '%'; /* 运行时数据比例,非设计值 */
    return el('div', { cls: 'bar-row' }, [
      el('span', { cls: 'bar-row__label', text: label }),
      el('div', { cls: 'bar-track', attrs: { role: 'img', 'aria-label': label + ' ' + valueText } }, [fill]),
      el('span', { text: valueText })
    ]);
  }
  function statCard(title, kids) { return el('section', { cls: 'stat-card' }, [el('h3', { text: title })].concat(kids)); }

  function renderStats() {
    var root = $('stats');
    root.textContent = '';
    var f = C.funnel(state.leads);
    var maxCount = Math.max.apply(null, C.STAGES.concat([C.LOST]).map(function (s) { return f.counts[s]; }).concat([0]));
    var stageBars = el('div', { cls: 'bars' });
    C.STAGES.concat([C.LOST]).forEach(function (s) {
      stageBars.appendChild(barRow(s, f.counts[s], maxCount, f.counts[s] + ' 条', s === C.LOST ? 'bar-fill--loss' : ''));
    });
    root.appendChild(statCard('各阶段当前数量', [el('p', { cls: 'muted', text: '每条线索只算在它现在所处的阶段(单位:条线索),所以各阶段之和等于线索总数。' }), stageBars]));

    function rate(label, r, a, b) {
      var fill = el('div', { cls: 'bar-fill' });
      fill.style.width = (r === null ? 0 : Math.round(r * 1000) / 10) + '%'; /* 运行时数据比例 */
      return el('div', { cls: 'rate' }, [
        el('span', { text: label }),
        el('span', { cls: 'rate__value', text: pct(r) }),
        el('span', { cls: 'muted', text: b > 0 ? a + ' / ' + b + '(曾到达该阶段的线索)' : '分母为 0,暂无数据' }),
        el('div', { cls: 'bar-track', attrs: { role: 'img', 'aria-label': label + ' ' + pct(r) } }, [fill])
      ]);
    }
    var rateNote = el('p', { cls: 'muted', text: '转化率 = 曾到达后一阶段的线索数 ÷ 曾到达前一阶段的线索数,依据每条线索的阶段记录,不是当前所在阶段。直接跳级(例如从咨询中直接到已付款)的线索,也计入被跳过的中间阶段。' });
    root.appendChild(statCard('漏斗转化率', [rateNote, el('div', { cls: 'rate-list' }, [
      rate('咨询 → 试课', f.consultToTrial, f.reached['已试课'], f.reached['咨询中']),
      rate('试课 → 付款', f.trialToPaid, f.reached['已付款'], f.reached['已试课']),
      rate('整体 咨询 → 付款', f.overall, f.reached['已付款'], f.reached['咨询中'])
    ])]));

    var ch = C.byChannel(state.leads);
    var maxCh = Math.max.apply(null, ch.map(function (c) { return c.leads; }).concat([0]));
    var chBars = el('div', { cls: 'bars' });
    if (!ch.length) chBars.appendChild(el('p', { cls: 'muted', text: '暂无数据' }));
    ch.forEach(function (c) {
      chBars.appendChild(barRow(c.channel + ' 线索', c.leads, maxCh, c.leads + ' 条', ''));
      chBars.appendChild(barRow(c.channel + ' 付款', c.paid, maxCh, c.paid + ' 条', 'bar-fill--paid'));
    });
    root.appendChild(statCard('按渠道:线索数与付款数', [el('p', { cls: 'muted', text: '线索 = 该渠道的全部线索(含流失);付款 = 曾到达「已付款」的线索,按历史阶段统计,所以已开课的线索也算,可能比「已付款」列里的卡片多。' }), chBars]));

    var lr = C.lossReasons(state.leads);
    var maxLr = Math.max.apply(null, lr.map(function (x) { return x.count; }).concat([0]));
    var lrBars = el('div', { cls: 'bars' });
    if (!lr.length) lrBars.appendChild(el('p', { cls: 'muted', text: '暂无流失线索' }));
    lr.forEach(function (x) { lrBars.appendChild(barRow(x.reason, x.count, maxLr, x.count + ' 条', 'bar-fill--loss')); });
    root.appendChild(statCard('流失原因分布', [el('p', { cls: 'muted', text: '只统计当前阶段为流失的线索,按流失原因计数。' }), lrBars]));
  }

  /* ---------- 表单 ---------- */
  function fillSelect(sel, values) {
    sel.textContent = '';
    values.forEach(function (v) { sel.appendChild(el('option', { text: v === '' ? '(不填)' : v, attrs: { value: v } })); });
  }
  function initForm() {
    fillSelect($('f-channel'), C.CHANNELS);
    fillSelect($('f-goal'), C.GOALS);
    fillSelect($('f-stage'), C.STAGES.concat([C.LOST]));
    fillSelect($('f-loss'), C.LOSS_REASONS);
    fillSelect($('f-currency'), CURRENCIES);
    $('f-channel').addEventListener('change', syncFormVisibility);
    $('f-stage').addEventListener('change', syncFormVisibility);
  }
  function syncFormVisibility() {
    $('f-channel-other-wrap').hidden = $('f-channel').value !== '其他';
    $('f-loss-wrap').hidden = $('f-stage').value !== C.LOST;
  }
  function openForm(lead) {
    ui.editingId = lead ? lead.id : null;
    $('form-title').textContent = lead ? '编辑线索' : '新建线索';
    clearFormErrors();
    $('delete-confirm').hidden = true;
    $('form-delete').hidden = !lead;
    var l = lead || C.newLead({ name: '' }, today, 'tmp');
    $('f-name').value = l.name;
    var presetChannel = C.CHANNELS.indexOf(l.channel) >= 0;
    $('f-channel').value = presetChannel ? l.channel : '其他';
    $('f-channel-other').value = presetChannel || l.channel === '其他' ? '' : l.channel;
    $('f-goal').value = l.goal;
    $('f-timezone').value = l.timezone;
    $('f-stage').value = l.stage;
    $('f-loss').value = l.lossReason || C.LOSS_REASONS[0];
    $('f-first').value = l.firstContact;
    $('f-last').value = l.legacyContactAnchor ? l.legacyContactAnchor.date : l.firstContact;
    $('f-next-action').value = l.nextAction;
    $('f-next-date').value = l.nextDate;
    $('f-amount').value = l.quoteAmount;
    $('f-currency').value = l.quoteCurrency;
    $('f-note').value = l.note;
    syncFormVisibility();
    $('form-panel').hidden = false;
    renderExportState();
    $('f-name').focus();
    $('form-panel').scrollIntoView({ block: 'start' });
  }
  function closeForm() { $('form-panel').hidden = true; ui.editingId = null; renderExportState(); }

  function renderTimeline(lead) {
    var root = $('contact-timeline');
    root.textContent = '';
    var archived = Object.create(null);
    (lead.archivedContactEventIds || []).forEach(function (id) { archived[id] = true; });
    var events = (lead.contactEvents || []).slice().sort(function (a, b) { return b.date.localeCompare(a.date) || b.id.localeCompare(a.id); });
    if (lead.legacyContactAnchor) {
      root.appendChild(el('li', { cls: 'timeline__item timeline__item--anchor' }, [
        el('strong', { text: lead.legacyContactAnchor.date + ' · 旧最近联系锚点' }),
        el('span', { cls: 'muted', text: '未核实，不算联系事件。来源：' + lead.legacyContactAnchor.source })
      ]));
    }
    if (!events.length) root.appendChild(el('li', { cls: 'muted', text: '还没有联系事件。旧锚点只用于提醒基线。' }));
    events.forEach(function (event) {
      var inactive = !!archived[event.id];
      var detail = event.type === 'quick_date_only' ? '仅日期标记，没有补写摘要或结果' : event.channel + ' · ' + event.summary + ' → ' + event.outcome + (event.nextStep ? ' · 下一步：' + event.nextStep : '');
      var buttons = [];
      if (!inactive) {
        buttons.push(el('button', { cls: 'btn btn--small', text: '更正', attrs: { type: 'button', 'data-act': 'correct-event', 'data-id': lead.id, 'data-event-id': event.id } }));
        buttons.push(el('button', { cls: 'btn btn--danger btn--small', text: '归档', attrs: { type: 'button', 'data-act': 'archive-event', 'data-id': lead.id, 'data-event-id': event.id } }));
      }
      root.appendChild(el('li', { cls: 'timeline__item' + (inactive ? ' timeline__item--inactive' : '') }, [
        el('strong', { text: event.date + (inactive ? ' · 已归档' : '') }),
        el('span', { text: detail }),
        el('span', { cls: 'muted', text: 'id：' + event.id + ' · 来源：' + event.provenance + (event.supersedes ? ' · 更正自：' + event.supersedes : '') }),
        buttons.length ? el('div', { cls: 'row' }, buttons) : null
      ]));
    });
  }
  function openContact(lead, event) {
    closeForm();
    ui.contactLeadId = lead.id;
    ui.contactCorrectId = event ? event.id : null;
    ui.pendingContact = null;
    ui.archiveEventId = null;
    $('contact-title').textContent = event ? '更正联系事件' : '记录跟进';
    $('contact-context').textContent = '线索：' + lead.name + '。更正不会覆盖原记录，而会追加新事件并归档旧事件。';
    $('c-date').value = event ? event.date : today;
    $('c-channel').value = event && event.channel ? event.channel : C.CONTACT_CHANNELS[0];
    $('c-summary').value = event ? event.summary : '';
    $('c-outcome').value = event ? event.outcome : '';
    $('c-next').value = event ? event.nextStep : '';
    $('contact-error').hidden = true;
    $('contact-confirm').hidden = true;
    $('contact-archive-confirm').hidden = true;
    $('contact-panel').hidden = false;
    renderTimeline(lead);
    renderExportState();
    $('c-date').focus();
    $('contact-panel').scrollIntoView({ block: 'start' });
  }
  function closeContact() {
    $('contact-panel').hidden = true;
    ui.contactLeadId = null; ui.contactCorrectId = null; ui.pendingContact = null; ui.archiveEventId = null;
    renderExportState();
  }
  function currentContactLead() { return byId(ui.contactLeadId); }
  function reviewContact(ev) {
    ev.preventDefault();
    var fields = { type: 'detailed', date: $('c-date').value, channel: $('c-channel').value, summary: $('c-summary').value.trim(), outcome: $('c-outcome').value.trim(), nextStep: $('c-next').value.trim(), provenance: state.sample ? 'sample' : 'user' };
    var error = '';
    if (!C.isDate(fields.date)) error = '请填写有效的联系日期。';
    else if (!fields.summary) error = '请填写联系摘要。';
    else if (!fields.outcome) error = '请填写联系结果。';
    $('contact-error').textContent = error;
    $('contact-error').hidden = !error;
    if (error) return;
    ui.pendingContact = fields;
    $('contact-confirm-text').textContent = (ui.contactCorrectId ? '确认追加更正记录：' : '确认追加联系记录：') + fields.date + '，' + fields.channel + '，' + fields.summary + ' → ' + fields.outcome + '。';
    $('contact-confirm').hidden = false;
    $('contact-yes').focus();
  }
  /* 字段级错误:显示在出错输入旁,aria-describedby 关联;顶部 form-error 只是汇总 */
  function fieldError(input, msg) {
    var id = input.id + '-error';
    var e = $(id);
    if (!e) {
      e = el('span', { cls: 'field-error', attrs: { role: 'alert' } });
      e.id = id;
      (input.closest('label') || input.parentNode).appendChild(e);
    }
    e.textContent = msg;
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', id);
  }
  function clearFieldError(input) {
    var e = $(input.id + '-error');
    if (e) e.remove();
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
  }
  var FORM_IDS = ['f-name', 'f-first', 'f-last', 'f-next-date', 'f-amount', 'f-channel-other'];
  function clearFormErrors() { FORM_IDS.forEach(function (id) { clearFieldError($(id)); }); $('form-error').hidden = true; }
  function formErrors(errs) {
    clearFormErrors();
    errs.forEach(function (x) { fieldError($(x.id), x.msg); });
    var e = $('form-error');
    e.textContent = '没有保存:' + errs.length + ' 处需要修改,已在对应输入框旁说明。';
    e.hidden = false;
    $(errs[0].id).focus();
  }
  function formError(msg, id) { formErrors([{ id: id || 'f-name', msg: msg }]); }

  function submitForm(ev) {
    ev.preventDefault();
    var name = $('f-name').value.trim();
    var errs = [];
    if (!name) errs.push({ id: 'f-name', msg: '请填写姓名或代号。' });
    var first = $('f-first').value, last = $('f-last').value, nextDate = $('f-next-date').value;
    if (!C.isDate(first)) errs.push({ id: 'f-first', msg: '请填写有效的首次联系日期。' });
    if (!C.isDate(last)) errs.push({ id: 'f-last', msg: '请填写有效的最近联系日期。' });
    if (nextDate && !C.isDate(nextDate)) errs.push({ id: 'f-next-date', msg: '下一步计划日期无效。' });
    var amountRaw = $('f-amount').value;
    if (amountRaw !== '' && !(Number(amountRaw) >= 0)) errs.push({ id: 'f-amount', msg: '报价金额应为不小于 0 的数字。' });
    if (errs.length) return formErrors(errs);
    clearFormErrors();
    var channel = $('f-channel').value;
    if (channel === '其他' && $('f-channel-other').value.trim()) channel = $('f-channel-other').value.trim();
    var stage = $('f-stage').value;
    var loss = stage === C.LOST ? $('f-loss').value : '';
    var fields = {
      name: name, channel: channel, goal: $('f-goal').value, timezone: $('f-timezone').value.trim(),
      firstContact: first, lastContact: last, nextAction: $('f-next-action').value.trim(), nextDate: nextDate,
      quoteAmount: amountRaw === '' ? '' : Number(amountRaw), quoteCurrency: $('f-currency').value, note: $('f-note').value.trim()
    };
    if (ui.editingId) {
      var cur = byId(ui.editingId);
      var next = cur;
      try {
        if (stage !== cur.stage) next = C.advance(cur, stage, today, loss, { allowBack: true });
      } catch (e) { return formError(e.message, 'f-name'); }
      next = Object.assign({}, next, fields, { stage: next.stage, lossReason: next.stage === C.LOST ? loss : '', stageHistory: next.stageHistory, legacyContactAnchor: { date: last, verification: 'unverified', source: 'manual_legacy_anchor' } });
      next = C.refreshLead(next);
      replaceLead(next);
      closeForm();
      focusLead(next.id, 'edit', 'btn-new');
      commit('已保存「' + name + '」。');
    } else {
      var created = C.newLead(Object.assign({ stage: stage, lossReason: loss }, fields), today);
      state.leads = state.leads.concat([created]);
      closeForm();
      commit('已新建「' + name + '」。');
    }
  }

  /* ---------- 导出 / 导入 ---------- */
  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  /* 导出一致性:表单有未保存编辑时,所有导出与复制禁用(aria-disabled),周报预览随数据自动重生成 */
  var EXPORT_IDS = ['btn-report', 'btn-csv', 'btn-json', 'report-download', 'report-copy'];
  function formOpen() { return !$('form-panel').hidden || !$('contact-panel').hidden; }
  function renderExportState() {
    var blocked = formOpen();
    EXPORT_IDS.forEach(function (id) { $(id).setAttribute('aria-disabled', String(blocked)); });
    $('export-hint').hidden = !blocked;
  }
  function exportBlocked() {
    renderExportState();
    return formOpen();
  }
  function suffix() { return state.sample ? '-合成示例' : ''; }
  function refreshReport(announce) {
    var r = C.weeklyReport(state.leads, today, state.n, { sample: state.sample });
    $('report-text').textContent = r.markdown;
    if (announce) say('已生成周报预览(' + r.from + ' 至 ' + r.to + ',超过 ' + state.n + ' 天未联系算待跟进)。');
  }
  function showReport() {
    if (exportBlocked()) return;
    refreshReport(true);
    $('report-panel').hidden = false;
    $('report-panel').scrollIntoView({ block: 'start' });
  }

  /* 替换确认:校验 → 预览数量 → 确认 → 写入。取消时原数据不变。 */
  function draftCount() {
    if (!formOpen()) return 0;
    return ['f-name', 'f-timezone', 'f-next-action', 'f-amount', 'f-note'].filter(function (id) { return $(id).value.trim() !== ''; }).length;
  }
  function hasUserData() {
    return state.leads.length > 0 || state.n !== C.DEFAULT_N || draftCount() > 0;
  }
  function requestReplace(label, payload) {
    ui.pending = { label: label, payload: payload };
    var d = draftCount();
    $('replace-text').textContent = '将用' + label + '(' + C.describeCounts(payload.leads, payload.n) + ')替换现有数据(' + C.describeCounts(state.leads, state.n) + ')。未导出的现有线索和阶段记录会丢失' +
      (d ? ';表单里另有 ' + d + ' 处未保存的输入,替换时也会放弃' : '') + '。确定替换吗?';
    $('replace-confirm').hidden = false;
    $('replace-no').focus();
  }
  function closeReplace() { ui.pending = null; $('replace-confirm').hidden = true; }
  function applyPayload(payload, label) {
    state.leads = payload.leads;
    state.n = payload.n;
    state.sample = !!payload.sample;
    ui.pendingLoss = null;
    closeForm();
    commit('已载入' + label + ':' + C.describeCounts(state.leads, state.n) + '。');
  }
  function samplePayload() {
    return { leads: C.validateImport({ leads: SAMPLE.leads }).leads, n: C.DEFAULT_N, sample: true };
  }
  function importFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var v = C.validateImport(String(reader.result));
      var box = $('import-error');
      if (!v.ok) {
        box.textContent = '导入失败,现有数据没有改动。文件「' + file.name + '」的问题:' + v.errors.slice(0, 3).join(';');
        box.hidden = false;
        closeReplace();
        return;
      }
      box.hidden = true;
      requestReplace('备份文件「' + file.name + '」', { leads: v.leads, n: v.n === null ? state.n : v.n, sample: v.sample });
    };
    reader.onerror = function () { var box = $('import-error'); box.textContent = '读取文件失败,现有数据没有改动。'; box.hidden = false; };
    reader.readAsText(file);
  }

  /* ---------- 事件 ---------- */
  function bind() {
    fillSelect($('c-channel'), C.CONTACT_CHANNELS);
    $('btn-new').addEventListener('click', function () { openForm(null); });
    $('empty-new').addEventListener('click', function () { openForm(null); });
    function loadSample() {
      $('import-error').hidden = true;
      var payload = samplePayload();
      if (hasUserData()) { requestReplace('合成示例', payload); return; }
      applyPayload(payload, '合成示例');
    }
    $('replace-no').addEventListener('click', function () { closeReplace(); $('btn-sample').focus(); });
    $('replace-yes').addEventListener('click', function () {
      var p = ui.pending;
      if (!p) return;
      closeReplace();
      applyPayload(p.payload, p.label);
      $('btn-new').focus();
    });
    var openImport = function () { $('file-import').click(); };
    $('btn-import').addEventListener('click', openImport);
    $('empty-import').addEventListener('click', openImport);
    $('btn-sample').addEventListener('click', loadSample);
    $('empty-sample').addEventListener('click', loadSample);
    $('btn-report').addEventListener('click', showReport);
    $('report-close').addEventListener('click', function () { $('report-panel').hidden = true; });
    $('report-download').addEventListener('click', function () {
      if (exportBlocked()) { say('表单里有未保存的编辑,请先保存或取消。', true); return; }
      download('试课周报' + suffix() + '-' + today + '.md', $('report-text').textContent, 'text/markdown'); say('已触发周报 Markdown 下载。');
    });
    $('report-copy').addEventListener('click', function () {
      if (exportBlocked()) { say('表单里有未保存的编辑,请先保存或取消。', true); return; }
      var text = $('report-text').textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { say('已复制周报。'); }, function () { say('浏览器不允许复制,请手动选中预览文字。', true); });
      } else { say('浏览器不允许复制,请手动选中预览文字。', true); }
    });
    $('btn-csv').addEventListener('click', function () {
      if (exportBlocked()) { say('表单里有未保存的编辑,请先保存或取消。', true); return; }
      download('试课线索' + suffix() + '-' + today + '.csv', '\ufeff' + C.toCsv(state.leads, { sample: state.sample }), 'text/csv'); say('已触发线索表 CSV 下载。');
    });
    $('btn-json').addEventListener('click', function () {
      if (exportBlocked()) { say('表单里有未保存的编辑,请先保存或取消。', true); return; }
      download('试课看板备份' + suffix() + '-' + today + '.json', JSON.stringify(C.toBackup(state.leads, state.n, { sample: state.sample }), null, 2), 'application/json'); say('已触发 JSON 备份下载(含 ' + C.describeCounts(state.leads, state.n) + ')。');
    });
    $('file-import').addEventListener('change', function (e) { var f = e.target.files[0]; if (f) importFile(f); e.target.value = ''; });
    $('btn-clear').addEventListener('click', function () { $('clear-count').textContent = state.leads.length + ' 条线索'; $('clear-confirm').hidden = false; $('clear-no').focus(); });
    $('clear-no').addEventListener('click', function () { $('clear-confirm').hidden = true; $('btn-clear').focus(); });
    $('clear-yes').addEventListener('click', function () { state.leads = []; state.sample = false; $('clear-confirm').hidden = true; $('import-error').hidden = true; closeReplace(); closeForm(); commit('已清空全部线索。'); $('btn-new').focus(); });
    $('n-input').addEventListener('change', function (e) {
      var v = Math.round(Number(e.target.value));
      var err = $('n-error');
      if (!(v >= 1 && v <= 60)) {
        err.textContent = '应填 1 到 60 之间的整数天数,已恢复为 ' + state.n + ' 天。';
        err.hidden = false;
        e.target.setAttribute('aria-invalid', 'true');
        e.target.value = String(state.n);
        e.target.focus();
        return;
      }
      err.hidden = true;
      e.target.removeAttribute('aria-invalid');
      state.n = v;
      commit('已设为超过 ' + v + ' 天未联系就提醒。');
    });
    FORM_IDS.forEach(function (id) { $(id).addEventListener('input', function () { clearFieldError($(id)); }); });
    $('lead-form').addEventListener('submit', submitForm);
    $('form-cancel').addEventListener('click', closeForm);
    $('form-delete').addEventListener('click', function () {
      var l = byId(ui.editingId);
      $('delete-text').textContent = '确认删除线索「' + (l ? l.name : '') + '」?它的 ' + (l ? l.stageHistory.length : 0) + ' 条阶段记录和 ' + (l ? l.contactEvents.length : 0) + ' 条联系事件会一并删除,统计、周报里的计数会随之减少,删除后无法恢复。';
      $('delete-confirm').hidden = false;
      $('delete-no').focus();
    });
    $('delete-no').addEventListener('click', function () { $('delete-confirm').hidden = true; $('form-delete').focus(); });
    $('delete-yes').addEventListener('click', function () {
      state.leads = state.leads.filter(function (l) { return l.id !== ui.editingId; });
      closeForm();
      focusLead('', 'edit', 'btn-new');
      commit('已删除该线索。');
    });
    $('contact-form').addEventListener('submit', reviewContact);
    $('contact-cancel').addEventListener('click', closeContact);
    $('contact-no').addEventListener('click', function () { $('contact-confirm').hidden = true; $('c-date').focus(); });
    $('contact-yes').addEventListener('click', function () {
      var lead = currentContactLead();
      if (!lead || !ui.pendingContact) return;
      var wasCorrection = !!ui.contactCorrectId;
      try {
        var next = ui.contactCorrectId ? C.correctContactEvent(lead, ui.contactCorrectId, ui.pendingContact) : C.addContactEvent(lead, ui.pendingContact);
        replaceLead(next);
      } catch (e) { $('contact-error').textContent = e.message; $('contact-error').hidden = false; return; }
      var name = lead.name;
      closeContact();
      commit(wasCorrection ? '已追加更正记录，原事件保留为已归档。' : '已为「' + name + '」追加联系事件。');
    });
    $('contact-archive-no').addEventListener('click', function () { $('contact-archive-confirm').hidden = true; ui.archiveEventId = null; });
    $('contact-archive-yes').addEventListener('click', function () {
      var lead = currentContactLead();
      if (!lead || !ui.archiveEventId) return;
      try { replaceLead(C.archiveContactEvent(lead, ui.archiveEventId)); } catch (e) { return say(e.message, true); }
      ui.archiveEventId = null;
      $('contact-archive-confirm').hidden = true;
      commit('已归档联系事件；原记录仍保留在时间线和备份中。');
      var updated = currentContactLead();
      if (updated) renderTimeline(updated);
    });

    function onAction(act, id, target) {
      var lead = byId(id);
      if (!lead) return;
      if (act === 'edit') return openForm(lead);
      if (act === 'contact') return openContact(lead, null);
      if (act === 'correct-event') {
        var event = (lead.contactEvents || []).filter(function (x) { return x.id === target.getAttribute('data-event-id'); })[0];
        if (event) return openContact(lead, event);
      }
      if (act === 'archive-event') {
        ui.archiveEventId = target.getAttribute('data-event-id');
        $('contact-archive-confirm').hidden = false;
        $('contact-archive-no').focus();
        return;
      }
      if (act === 'touch') {
        var next = C.addContactEvent(lead, { type: 'quick_date_only', date: today, provenance: state.sample ? 'sample' : 'user' });
        if (next.nextDate && C.diffDays(today, next.nextDate) > 0) next.nextDate = '';
        replaceLead(next);
        focusLead('', 'touch', 'today-zone');
        return commit('已记录「' + lead.name + '」今天联系过' + (lead.nextDate && !next.nextDate ? ',并清除已过期的下一步日期' : '') + '。');
      }
      if (act === 'loss-no') { ui.pendingLoss = null; focusLead(id, 'advance'); return render(); }
      if (act === 'loss-yes') {
        var reason = target.closest('.loss-chooser').querySelector('select').value;
        ui.pendingLoss = null;
        try { replaceLead(C.advance(lead, C.LOST, today, reason)); } catch (e) { return say(e.message, true); }
        focusLead(id, 'advance');
        return commit('「' + lead.name + '」已标记为流失(' + reason + ')。');
      }
    }
    /* 按下按钮时输入框失焦会触发 change 并重绘,按钮节点被替换,浏览器随后的 click 可能落空或落到别处。
       所以在按下时记住目标(动作 + 线索 id),抬起/click 时若原节点已被替换,就按记录补发一次,且只执行一次。 */
    var down = null;
    function fireDown() {
      if (!down || down.handled) return;
      down.handled = true;
      var rec = down;
      var fresh = Array.prototype.filter.call(document.querySelectorAll('[data-act="' + rec.act + '"]'), function (n) { return n.getAttribute('data-id') === rec.id; })[0];
      if (fresh) onAction(rec.act, rec.id, fresh);
    }
    document.addEventListener('pointerdown', function (e) {
      var d = e.target.closest ? e.target.closest('[data-act]') : null;
      down = d && d.tagName !== 'SELECT' ? { act: d.getAttribute('data-act'), id: d.getAttribute('data-id'), node: d, handled: false } : null;
    }, true);
    document.addEventListener('pointerup', function () {
      if (down && !down.handled && !down.node.isConnected) fireDown();
    }, true);
    document.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-act]') : null;
      if (down && !down.handled) { fireDown(); return; }
      if (!down && t && t.tagName !== 'SELECT') onAction(t.getAttribute('data-act'), t.getAttribute('data-id'), t);
    });
    $('board').addEventListener('change', function (e) {
      var t = e.target;
      if (t.getAttribute('data-act') !== 'advance' || !t.value) return;
      var lead = byId(t.getAttribute('data-id'));
      if (!lead) return;
      if (t.value === C.LOST) { ui.pendingLoss = lead.id; ui.focusFn = function () { var sel = document.querySelector('[data-role="loss-reason"]'); if (sel) sel.focus(); }; return render(); }
      try {
        replaceLead(C.advance(lead, t.value, today, undefined, { allowBack: lead.stage === C.LOST }));
      } catch (err) { render(); return say(err.message, true); }
      focusLead(lead.id, 'advance');
      commit('「' + lead.name + '」已推进到「' + t.value + '」。');
    });
    $('board').addEventListener('toggle', function (e) {
      var d = e.target;
      if (d.getAttribute && d.getAttribute('data-stage')) ui.open[d.getAttribute('data-stage')] = d.open;
    }, true);
  }

  load();
  initForm();
  bind();
  render();
})();
