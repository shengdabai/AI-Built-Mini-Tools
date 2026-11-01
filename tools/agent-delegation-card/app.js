/* 委托契约卡 app.js — DOM 与交互，只调用 ContractCore。所有用户文本经 textContent 渲染，不拼接 innerHTML。 */
(function () {
  'use strict';
  var C = globalThis.ContractCore;
  var SAMPLE = globalThis.ContractSample;
  var STORE_KEY = 'weituoqiyueka.v1'; // gitleaks:allow (localStorage key name)
  var SVG_NS = 'http://www.w3.org/2000/svg';

  // 「今天」：默认本地日期；可用 ?today=YYYY-MM-DD 覆盖（演示/截图用）
  var TODAY = (function () {
    var q = new URLSearchParams(location.search).get('today');
    if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) return q;
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  })();

  // 存储状态：corrupt = { key: 备份键名|null, reason }；blocked = 损坏数据未能备份，暂停一切写入；saveError = 最近一次写入失败的说明
  var storage = { readError: false, corrupt: null, blocked: false, saveError: '' };
  var state = load();
  var ui = { view: 'draft', fill: null }; // fill: { recordId, values: {}, qualified }

  // ---------- 存储 ----------
  function load() {
    var empty = { draft: C.createContract(), records: [] };
    var raw;
    try { raw = localStorage.getItem(STORE_KEY); }
    catch (e) { storage.readError = true; return empty; }
    if (!raw) return empty;
    var loaded, dropped = 0;
    try {
      var data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new TypeError('顶层不是对象');
      if (data.records != null && !Array.isArray(data.records)) throw new TypeError('records 不是数组');
      var recs = (data.records || []).map(C.normalizeRecord);
      dropped = recs.filter(function (r) { return !r; }).length;
      loaded = { draft: C.normalizeContract(data.draft), records: recs.filter(Boolean) };
    } catch (e) {
      backupCorrupt(raw, e instanceof SyntaxError ? '内容不是合法 JSON' : '数据结构不符合预期');
      return empty;
    }
    if (dropped) backupCorrupt(raw, dropped + ' 条台账记录无法识别，已跳过');
    return loaded;
  }
  /** 损坏的原始字符串另存为 <STORE_KEY>.corrupt-<时间戳>；备份失败则暂停保存，防止覆盖唯一副本。 */
  function backupCorrupt(raw, reason) {
    var key = STORE_KEY + '.corrupt-' + Date.now();
    try {
      localStorage.setItem(key, raw);
      storage.corrupt = { key: key, reason: reason };
    } catch (e) {
      storage.corrupt = { key: null, reason: reason };
      storage.blocked = true;
    }
  }
  /** 写入成功返回 true；失败返回 false 并显示持久错误。调用方只能在 true 之后替换内存状态或提示成功。 */
  function save(next) {
    if (storage.blocked) {
      storage.saveError = '已暂停保存：本机存储里有无法备份的损坏数据，为免覆盖，刚才的改动只留在当前页面，刷新会丢失。';
      renderStorageAlert();
      return false;
    }
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); }
    catch (e) {
      storage.saveError = '保存失败：浏览器存储不可用或已满。刚才的改动没有写入本机，刷新会丢失。';
      renderStorageAlert();
      return false;
    }
    if (storage.saveError) { storage.saveError = ''; renderStorageAlert(); }
    return true;
  }
  function renderStorageAlert() {
    var box = document.getElementById('storage-alert');
    if (!box) return;
    box.textContent = '';
    function item(title, body, keyName) {
      var p = el('p', 'storage-alert__item');
      p.appendChild(el('strong', null, title));
      p.appendChild(document.createTextNode(body));
      if (keyName) { p.appendChild(el('code', null, keyName)); p.appendChild(document.createTextNode('。')); }
      box.appendChild(p);
    }
    if (storage.readError) item('存储不可读', '浏览器不允许读取本机存储，本页显示的是空白数据。');
    if (storage.corrupt) {
      if (storage.corrupt.key) item('本机数据已损坏', '原因：' + storage.corrupt.reason + '。原始内容已原样另存到 localStorage 键 ', storage.corrupt.key);
      else item('本机数据已损坏且无法备份', '原因：' + storage.corrupt.reason + '。为免覆盖唯一副本，已暂停保存。可先用浏览器开发者工具导出键 ' + STORE_KEY + ' 的内容；确认不要后点「清空数据」重置。');
    }
    if (storage.saveError) item('未保存', storage.saveError);
    box.hidden = !box.firstChild;
  }

  // ---------- 小工具 ----------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function svg(tag, attrs, text) {
    var n = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text != null) n.textContent = text;
    return n;
  }
  function btn(text, cls, onClick, attrs) {
    var b = el('button', 'btn ' + (cls || ''), text);
    b.type = 'button';
    Object.keys(attrs || {}).forEach(function (k) { b.setAttribute(k, attrs[k]); });
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }
  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('is-visible'); }, 2600);
  }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
  function safeName(s) { return (s || '未命名').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40); }
  function signed(n) { return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n); }
  function pct(x) { return Math.round(x * 100) + '%'; }
  function isBlankDraft(d) {
    return !d.taskName && !d.goal && !d.inputs && !d.deadline && !d.stuckProtocol && !C.cleanCriteria(d).length;
  }
  /** 草稿随输入即时生效（界面必须与输入框一致）；写入失败时返回 false，并保留持久的「未保存」提示。 */
  function setDraft(next) { state.draft = next; return save(state); }

  // ---------- 视图切换 ----------
  function route() {
    var v = location.hash.replace('#', '') === 'score' ? 'score' : 'draft';
    ui.view = v;
    document.querySelectorAll('.view').forEach(function (s) { s.hidden = s.id !== 'view-' + v; });
    document.querySelectorAll('.tab').forEach(function (t) {
      if (t.dataset.view === v) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    if (v === 'score') renderScore();
  }

  // ---------- 起草：表单 ----------
  var TEXT_FIELDS = ['taskName', 'taskType', 'goal', 'inputs', 'deadline', 'stuckProtocol'];
  function fillForm() {
    var f = $('#contract-form');
    TEXT_FIELDS.forEach(function (k) {
      if (C.LIMITS[k]) f.elements[k].maxLength = C.LIMITS[k];
      f.elements[k].value = state.draft[k] || '';
    });
    updateCounters();
    renderCriteria();
    renderTypeOptions();
  }
  /** 四个长文本框的字数提示，与 core 的 LIMITS 一致；到上限时明确告知超出部分不会被输入。 */
  function updateCounters() {
    document.querySelectorAll('[data-count-for]').forEach(function (n) {
      var k = n.dataset.countFor;
      var max = C.LIMITS[k];
      var len = ($('#contract-form').elements[k].value || '').length;
      n.textContent = len + ' / ' + max + ' 字' + (len >= max ? ' · 已达上限，超出部分不会被输入' : '');
      n.classList.toggle('is-limit', len >= max);
    });
  }
  function renderTypeOptions() {
    var dl = $('#type-options');
    dl.textContent = '';
    var types = ['资料整理', '代码修改', '报销材料', '文案起草', '数据汇总', '日程安排'];
    state.records.forEach(function (r) { if (r.contract.taskType && types.indexOf(r.contract.taskType) < 0) types.push(r.contract.taskType); });
    types.forEach(function (t) { var o = el('option'); o.value = t; dl.appendChild(o); });
  }
  function renderCriteria(focusIndex) {
    var list = $('#criteria-list');
    list.textContent = '';
    state.draft.criteria.forEach(function (text, i) {
      var li = el('li', 'criteria__item');
      var input = el('input', 'input');
      input.value = text;
      input.maxLength = 300;
      input.placeholder = i === 0 ? '例：每笔金额与票据一致' : '再写一条可判定对错的标准';
      input.setAttribute('aria-label', '完成标准第 ' + (i + 1) + ' 条');
      input.addEventListener('input', function () {
        var crit = state.draft.criteria.slice();
        crit[i] = input.value;
        setDraft(Object.assign({}, state.draft, { criteria: crit }));
        renderPreview();
      });
      li.appendChild(input);
      var rm = btn('删除', 'btn--ghost btn--small', function () {
        var crit = state.draft.criteria.filter(function (_, j) { return j !== i; });
        if (!crit.length) crit = [''];
        setDraft(Object.assign({}, state.draft, { criteria: crit }));
        renderCriteria(Math.min(i, crit.length - 1));
        renderPreview();
      }, { 'aria-label': '删除第 ' + (i + 1) + ' 条完成标准' });
      li.appendChild(rm);
      list.appendChild(li);
    });
    if (focusIndex != null) {
      var inputs = list.querySelectorAll('input');
      if (inputs[focusIndex]) inputs[focusIndex].focus();
    }
  }

  // ---------- 起草：权限边界 ----------
  var ZONE_SHORT = { auto: '自主', ask: '必问', deny: '禁止' };
  function moveTo(id, zone, refocus) {
    setDraft(C.moveAction(state.draft, id, zone));
    renderBoard();
    renderCheck();
    renderPreview();
    if (refocus) {
      var n = document.querySelector('.action[data-id="' + CSS.escape(id) + '"] .action__name');
      if (n) n.focus();
    }
  }
  function renderBoard() {
    var board = $('#board');
    board.textContent = '';
    var zones = C.byZone(state.draft);
    C.ZONES.forEach(function (zone) {
      var col = el('div', 'zone zone--' + zone.id);
      var head = el('div', 'zone__head');
      var title = el('h4', 'zone__title', zone.name);
      title.appendChild(el('span', 'zone__count', String(zones[zone.id].length)));
      head.appendChild(title);
      head.appendChild(el('p', 'zone__rule', zone.rule));
      col.appendChild(head);
      var ul = el('ul', 'zone__list');
      ul.setAttribute('aria-label', zone.name);
      ul.dataset.zone = zone.id;
      ul.addEventListener('dragover', function (e) { e.preventDefault(); ul.classList.add('is-over'); });
      ul.addEventListener('dragleave', function () { ul.classList.remove('is-over'); });
      ul.addEventListener('drop', function (e) {
        e.preventDefault();
        ul.classList.remove('is-over');
        var id = e.dataTransfer.getData('text/plain');
        if (id && state.draft.actions.some(function (a) { return a.id === id; })) moveTo(id, zone.id, false);
      });
      if (!zones[zone.id].length) ul.appendChild(el('li', 'zone__empty', '拖到这里，或点动作下方的「' + ZONE_SHORT[zone.id] + '」'));
      zones[zone.id].forEach(function (a) { ul.appendChild(renderAction(a)); });
      col.appendChild(ul);
      board.appendChild(col);
    });

    var warn = $('#zone-warnings');
    warn.textContent = '';
    C.zoneWarnings(state.draft).forEach(function (w) {
      var p = el('p', 'alert alert--danger');
      p.appendChild(el('strong', null, '警示　'));
      p.appendChild(document.createTextNode(w.text));
      warn.appendChild(p);
    });
  }
  function renderAction(a) {
    var danger = a.high && a.zone === 'auto';
    var li = el('li', 'action' + (a.high ? ' action--high' : '') + (danger ? ' is-danger' : ''));
    li.dataset.id = a.id;
    li.draggable = true;
    li.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', a.id); e.dataTransfer.effectAllowed = 'move'; li.classList.add('is-dragging'); });
    li.addEventListener('dragend', function () { li.classList.remove('is-dragging'); });

    var top = el('div', 'action__top');
    var name = btn(a.label, 'action__name', null, { 'aria-label': a.label + (a.high ? '（高风险）' : '') + '，当前在' + C.zoneOf(a.zone).name + '。按左右方向键切换分区' });
    name.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      var next = C.shiftZone(a.zone, e.key === 'ArrowLeft' ? -1 : 1);
      if (next !== a.zone) moveTo(a.id, next, true);
    });
    top.appendChild(name);
    if (a.high) top.appendChild(el('span', 'tag tag--high', '高风险'));
    if (a.custom) {
      top.appendChild(btn('移除', 'btn--ghost btn--small action__remove', function () {
        setDraft(C.removeAction(state.draft, a.id));
        renderBoard(); renderCheck(); renderPreview();
      }, { 'aria-label': '移除自定义动作 ' + a.label }));
    }
    li.appendChild(top);

    var sw = el('div', 'action__switch');
    sw.setAttribute('role', 'group');
    sw.setAttribute('aria-label', a.label + ' 的分区');
    C.ZONES.forEach(function (z) {
      var b = btn(ZONE_SHORT[z.id], 'seg seg--' + z.id, function () { if (a.zone !== z.id) moveTo(a.id, z.id, false); }, {
        'aria-pressed': String(a.zone === z.id), 'aria-label': '把「' + a.label + '」放进' + z.name
      });
      sw.appendChild(b);
    });
    li.appendChild(sw);
    if (danger) li.appendChild(el('p', 'action__alert', '高风险动作已放开为自主，代理可不经确认直接执行'));
    return li;
  }

  // ---------- 起草：信任阶梯与一致性检查 ----------
  function renderLadder() {
    var fs = $('#ladder');
    fs.querySelectorAll('.ladder__step').forEach(function (n) { n.remove(); });
    C.TRUST_LEVELS.forEach(function (t) {
      var label = el('label', 'ladder__step ladder__step--' + t.level);
      var input = el('input', 'ladder__radio');
      input.type = 'radio';
      input.name = 'trust';
      input.value = String(t.level);
      input.checked = state.draft.trustLevel === t.level;
      input.addEventListener('change', function () {
        setDraft(Object.assign({}, state.draft, { trustLevel: t.level }));
        renderCheck();
        renderPreview();
      });
      label.appendChild(input);
      var body = el('span', 'ladder__body');
      body.appendChild(el('span', 'ladder__level', 'L' + t.level));
      body.appendChild(el('strong', 'ladder__name', t.name));
      body.appendChild(el('span', 'ladder__meaning', t.meaning));
      label.appendChild(body);
      fs.appendChild(label);
    });
  }
  var STATUS_TEXT = {
    ok: ['一致', '信任级别与放开的权限相符'],
    info: ['可再明确', '没有冲突，但有一处可以写得更清楚'],
    warn: ['需留意', '授权前请逐条确认下列提示'],
    conflict: ['不一致', '信任级别与自主区的高风险动作互相矛盾，建议先调整再授权']
  };
  function renderCheck() {
    var res = C.checkConsistency(state.draft);
    var panel = $('#check-panel');
    panel.textContent = '';
    panel.className = 'check-panel check-panel--' + res.status;
    var head = el('div', 'check-panel__head');
    head.appendChild(el('strong', 'check-panel__status', STATUS_TEXT[res.status][0]));
    head.appendChild(el('span', 'check-panel__summary', STATUS_TEXT[res.status][1] + ' · 自主区高风险动作 ' + res.autoHighCount + ' 项'));
    panel.appendChild(head);
    if (res.findings.length) {
      var ul = el('ul', 'findings');
      res.findings.forEach(function (f) {
        var li = el('li', 'finding finding--' + f.severity);
        var meta = el('p', 'finding__rule');
        meta.appendChild(el('span', 'finding__id', '规则 ' + f.rule));
        meta.appendChild(document.createTextNode('触发条件：' + f.condition));
        li.appendChild(meta);
        li.appendChild(el('p', 'finding__text', f.text));
        ul.appendChild(li);
      });
      panel.appendChild(ul);
    } else {
      panel.appendChild(el('p', 'check-panel__none', '未触发任何规则（R1–R7）。'));
    }
  }

  // ---------- 起草：契约卡预览 ----------
  function renderPreview() {
    var root = $('#preview');
    root.textContent = '';
    var d = state.draft;
    if (isBlankDraft(d)) {
      var empty = el('div', 'empty');
      empty.appendChild(el('p', 'empty__title', '还没有契约内容'));
      empty.appendChild(el('p', 'empty__text', '在左侧写下任务名、目标结果和完成标准，这里会实时排成一张可以直接交给 Agent 的契约卡。第一次用，可以先看一份示例。'));
      empty.appendChild(btn('载入示例', 'btn--primary', loadSample));
      root.appendChild(empty);
      return;
    }
    var t = C.trustOf(d.trustLevel);
    var check = C.checkConsistency(d);
    var doc = el('article', 'doc');
    doc.setAttribute('aria-label', '契约卡预览');

    var head = el('header', 'doc__head');
    var kicker = el('div', 'doc__kicker');
    kicker.appendChild(el('span', null, '委托契约卡'));
    kicker.appendChild(el('span', 'doc__no', '编号 ' + d.id.slice(-6).toUpperCase()));
    head.appendChild(kicker);
    head.appendChild(el('h4', 'doc__title' + (d.taskName ? '' : ' is-missing'), d.taskName || '（未填写任务名）'));
    var meta = el('dl', 'doc__meta');
    [['任务类型', d.taskType || '未分类'], ['信任级别', 'L' + t.level + ' ' + t.name], ['签发日期', TODAY]].forEach(function (p) {
      var g = el('div');
      g.appendChild(el('dt', null, p[0]));
      g.appendChild(el('dd', null, p[1]));
      meta.appendChild(g);
    });
    head.appendChild(meta);
    doc.appendChild(head);

    function clause(title, value, required) {
      var s = el('section', 'doc__clause');
      s.appendChild(el('h5', 'doc__label', title));
      if (value) s.appendChild(el('p', 'doc__text', value));
      else s.appendChild(el('p', 'doc__text is-missing', required ? '未填写（必填）' : '未列出'));
      return s;
    }
    doc.appendChild(clause('目标结果', d.goal, true));
    doc.appendChild(clause('输入材料', d.inputs, true));
    var crit = C.cleanCriteria(d);
    var cs = el('section', 'doc__clause');
    cs.appendChild(el('h5', 'doc__label', '完成标准'));
    if (crit.length) {
      var ol = el('ol', 'doc__criteria');
      crit.forEach(function (c) { ol.appendChild(el('li', null, c)); });
      cs.appendChild(ol);
    } else cs.appendChild(el('p', 'doc__text is-missing', '未填写（必填）'));
    doc.appendChild(cs);
    doc.appendChild(clause('截止条件', d.deadline, true));
    doc.appendChild(clause('卡住时怎么问我', d.stuckProtocol, true));

    var perm = el('section', 'doc__perm');
    perm.appendChild(el('h5', 'doc__label', '权限边界'));
    var cols = el('div', 'doc__cols');
    var zones = C.byZone(d);
    C.ZONES.forEach(function (z) {
      var col = el('div', 'doc__col doc__col--' + z.id);
      col.appendChild(el('p', 'doc__col-title', z.name));
      var ul = el('ul');
      if (!zones[z.id].length) ul.appendChild(el('li', 'is-missing', '（无）'));
      zones[z.id].forEach(function (a) {
        var li = el('li', a.high && z.id === 'auto' ? 'is-danger' : null, a.label);
        if (a.high) li.appendChild(el('span', 'doc__high', '高风险'));
        ul.appendChild(li);
      });
      col.appendChild(ul);
      cols.appendChild(col);
    });
    perm.appendChild(cols);
    doc.appendChild(perm);

    var foot = el('footer', 'doc__foot');
    var stamp = el('div', 'stamp stamp--' + check.status);
    stamp.appendChild(el('span', 'stamp__label', '授权前检查'));
    stamp.appendChild(el('strong', 'stamp__value', STATUS_TEXT[check.status][0]));
    if (check.findings.length) stamp.appendChild(el('span', 'stamp__rules', '触发 ' + check.findings.map(function (f) { return f.rule; }).join(' · ')));
    foot.appendChild(stamp);
    foot.appendChild(el('p', 'doc__oath', '越界先停，不自封完成：按完成标准提交证据，由委托人验收。'));
    doc.appendChild(foot);
    root.appendChild(doc);
  }

  // ---------- 起草：导出与存入台账 ----------
  function markdown() { return C.toMarkdown(state.draft, TODAY); }
  function tooLongText(list) {
    return list.map(function (x) { return x.label + '（' + x.length + ' / ' + x.max + ' 字）'; }).join('、');
  }
  /** 导出前检查超长：core 不再截断，超长时拒绝导出而不是悄悄丢字。 */
  function exportBlocked() {
    if (isBlankDraft(state.draft)) { toast('契约卡还是空的，先填写或载入示例'); return true; }
    var long = C.lengthErrors(state.draft);
    if (long.length) { toast('超出字数上限：' + tooLongText(long) + '，请删减后再导出'); return true; }
    return false;
  }
  function copyText(text) {
    function fallback() {
      var ta = el('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.className = 'visually-hidden';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      return Promise.resolve(ok);
    }
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, fallback);
    }
    return fallback();
  }
  function onCopy() {
    if (exportBlocked()) return;
    var md = markdown();
    copyText(md).then(function (ok) {
      toast(ok ? '已复制 Markdown，可直接粘贴给 Agent' : '浏览器不允许自动复制，请改用「下载 .md」');
    });
  }
  function onDownload() {
    if (exportBlocked()) return;
    download('委托契约卡-' + safeName(state.draft.taskName) + '.md', markdown(), 'text/markdown;charset=utf-8');
    toast('已下载 .md');
  }
  function onCommit() {
    var msg = $('#commit-msg');
    var v = C.validateContract(state.draft);
    if (!v.ok) {
      var parts = [];
      if (v.missing.length) parts.push('还缺：' + v.missing.join('、'));
      if (v.tooLong.length) parts.push('超出字数上限：' + tooLongText(v.tooLong));
      msg.textContent = parts.join('；') + '。改好后再存入台账。';
      msg.className = 'form-msg is-error';
      return;
    }
    var rec = C.makeRecord(state.draft, TODAY);
    var next = { draft: C.createContract(), records: [rec].concat(state.records) };
    if (!save(next)) {
      msg.textContent = '存入失败：浏览器存储不可用或已满。契约仍保留在草稿里，台账没有变化。';
      msg.className = 'form-msg is-error';
      return;
    }
    msg.textContent = '';
    msg.className = 'form-msg';
    state = next;
    ui.fill = null;
    ui.selected = rec.id;
    fillForm(); renderBoard(); renderLadder(); renderCheck(); renderPreview(); renderCount();
    toast('已存入台账。任务做完后在这里回填实际耗时');
    location.hash = 'score';
  }

  // ---------- 记分 ----------
  function recordById(id) { return state.records.filter(function (r) { return r.id === id; })[0] || null; }
  function sortedRecords() {
    return state.records.slice().sort(function (a, b) {
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
      return (b.doneAt || b.createdAt).localeCompare(a.doneAt || a.createdAt);
    });
  }
  function ensureFill() {
    var rec = recordById(ui.selected) || sortedRecords()[0] || null;
    if (!rec) { ui.fill = null; return null; }
    ui.selected = rec.id;
    if (!ui.fill || ui.fill.recordId !== rec.id) {
      var values = {};
      C.TIMING_FIELDS.forEach(function (f) { values[f.key] = rec.status === 'done' ? String(rec.timing[f.key]) : ''; });
      ui.fill = { recordId: rec.id, values: values, qualified: rec.status === 'done' ? rec.qualified : null };
    }
    return rec;
  }

  function renderScore() {
    renderFill();
    renderLedger();
  }

  function renderFill() {
    var root = $('#fill-root');
    root.textContent = '';
    var rec = ensureFill();
    if (!rec) {
      var empty = el('div', 'empty empty--wide');
      empty.appendChild(el('p', 'empty__title', '还没有可以记分的委托'));
      empty.appendChild(el('p', 'empty__text', '先在「起草契约」写好一张卡并存入台账；任务做完后回到这里，填入手工基线和你为 AI 付出的各项分钟数。'));
      var row = el('div', 'empty__actions');
      row.appendChild(btn('载入示例', 'btn--primary', loadSample));
      var go = el('a', 'btn btn--secondary', '去起草契约');
      go.href = '#draft';
      row.appendChild(go);
      empty.appendChild(row);
      root.appendChild(empty);
      return;
    }

    var grid = el('div', 'fill-grid');
    var form = el('form', 'fill-form');
    form.noValidate = true;
    form.setAttribute('aria-label', '回填实际耗时');

    var pick = el('label', 'field');
    pick.appendChild(el('span', 'field__label', '选择委托'));
    var sel = el('select', 'input');
    sel.id = 'rec-select';
    sortedRecords().forEach(function (r) {
      var o = el('option', null, (r.status === 'open' ? '【待回填】' : '【已记分 ' + signed(r.net) + ' 分】') + (r.contract.taskName || '未命名') + (r.sample ? '（合成示例）' : ''));
      o.value = r.id;
      o.selected = r.id === rec.id;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () { ui.selected = sel.value; ui.fill = null; renderFill(); });
    pick.appendChild(sel);
    form.appendChild(pick);

    var t = C.trustOf(rec.contract.trustLevel);
    form.appendChild(el('p', 'fill-meta', '类型：' + (rec.contract.taskType || '未分类') + ' · 信任级别 L' + t.level + ' ' + t.name + ' · 签发 ' + (rec.createdAt || '—')));

    var nums = el('div', 'num-grid');
    C.TIMING_FIELDS.forEach(function (f) {
      var lab = el('label', 'field field--num');
      lab.appendChild(el('span', 'field__label', f.label + '（分钟）'));
      var input = el('input', 'input input--num');
      input.type = 'number';
      input.min = '0';
      input.step = '1';
      input.inputMode = 'decimal';
      input.name = f.key;
      input.value = ui.fill.values[f.key];
      input.placeholder = '0';
      input.addEventListener('input', function () { ui.fill.values[f.key] = input.value; renderResult(); });
      lab.appendChild(input);
      lab.appendChild(el('span', 'field__hint', f.hint));
      nums.appendChild(lab);
    });
    form.appendChild(nums);

    var q = el('fieldset', 'qual');
    q.appendChild(el('legend', 'field__label', '按契约的完成标准验收'));
    [[true, '合格'], [false, '不合格']].forEach(function (p) {
      var lab = el('label', 'check');
      var r = el('input');
      r.type = 'radio';
      r.name = 'qualified';
      r.value = String(p[0]);
      r.checked = ui.fill.qualified === p[0];
      r.addEventListener('change', function () { ui.fill.qualified = p[0]; });
      lab.appendChild(r);
      lab.appendChild(el('span', null, p[1]));
      q.appendChild(lab);
    });
    form.appendChild(q);

    var msg = el('p', 'form-msg');
    msg.id = 'fill-msg';
    msg.setAttribute('role', 'status');
    var submit = el('button', 'btn btn--primary', rec.status === 'done' ? '更新记分' : '记入台账');
    submit.type = 'submit';
    var actions = el('div', 'form-actions');
    actions.appendChild(submit);
    form.appendChild(actions);
    form.appendChild(msg);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      try {
        var done = C.completeRecord(rec, ui.fill.values, ui.fill.qualified, rec.doneAt || TODAY);
        var next = { draft: state.draft, records: state.records.map(function (r) { return r.id === rec.id ? done : r; }) };
        if (!save(next)) {
          msg.textContent = '记分失败：浏览器存储不可用或已满，台账没有变化，已填的分钟数仍保留在表单里。';
          msg.className = 'form-msg is-error';
          return;
        }
        state = next;
        ui.fill = null;
        renderScore();
        renderCount();
        toast(done.net < 0 ? '已记入台账：这次委托净亏 ' + Math.abs(done.net) + ' 分钟' : '已记入台账：净省 ' + done.net + ' 分钟');
      } catch (err) {
        msg.textContent = err.message;
        msg.className = 'form-msg is-error';
      }
    });

    grid.appendChild(form);
    var result = el('div', 'result');
    result.id = 'result';
    grid.appendChild(result);
    root.appendChild(grid);
    renderResult();
  }

  function renderResult() {
    var root = $('#result');
    if (!root) return;
    root.textContent = '';
    var r;
    try { r = C.computeNetSaving(ui.fill.values); }
    catch (err) {
      root.appendChild(el('p', 'alert alert--danger', err.message));
      return;
    }
    var headline = el('div', 'result__head' + (r.isLoss ? ' is-loss' : ''));
    headline.appendChild(el('span', 'result__label', '净省时'));
    var big = el('strong', 'result__value', signed(r.net));
    big.appendChild(el('span', 'result__unit', ' 分钟'));
    headline.appendChild(big);
    headline.appendChild(el('span', 'result__sub', '表面省时 ' + signed(r.surface) + ' 分钟'));
    root.appendChild(headline);
    if (r.isLoss) {
      var loss = el('p', 'alert alert--danger loss-banner');
      loss.appendChild(el('strong', null, '这次委托是亏的　'));
      loss.appendChild(document.createTextNode('为 AI 付出的人工时间比自己手工做还多 ' + Math.abs(r.net) + ' 分钟。'));
      root.appendChild(loss);
    }
    var chart = el('div', 'wf');
    root.appendChild(chart);
    if (r.minutes.baseline <= 0) {
      chart.appendChild(el('p', 'wf__empty', '填入手工基线和各项分钟数后，这里画出从表面省时到净省时的瀑布。'));
    } else {
      drawWaterfall(chart, r);
    }
    var f = el('div', 'formula');
    f.appendChild(el('p', null, r.formula));
    f.appendChild(el('p', 'formula__recheck', r.recheck));
    f.appendChild(el('p', 'formula__note', '机器独立运行不算人工；被迫守候、无法另作安排的时间要算。监督含终验，各项互斥不重复扣。'));
    root.appendChild(f);
  }

  function drawWaterfall(container, r) {
    var width = Math.max(280, Math.floor(container.clientWidth || 600));
    var narrow = width < 480;
    var L = C.waterfallLayout(r.steps, { width: width, labelWidth: narrow ? 92 : 128, valueWidth: narrow ? 52 : 68, rowHeight: narrow ? 24 : 28, gap: narrow ? 10 : 12 });
    var top = 22;
    var s = svg('svg', { viewBox: '0 0 ' + L.width + ' ' + (L.height + top + 4), width: '100%', role: 'img', class: 'wf__svg',
      'aria-label': '净省时瀑布图：' + r.formula });
    s.appendChild(svg('line', { x1: L.zeroX, x2: L.zeroX, y1: top - 8, y2: top + L.height + 2, class: 'wf__zero' }));
    s.appendChild(svg('text', { x: L.zeroX, y: top - 12, class: 'wf__axis', 'text-anchor': 'middle' }, '0'));
    L.rows.forEach(function (row, i) {
      var y = top + row.y;
      var cls = row.key === 'net' ? (row.negative ? 'wf__bar--loss' : 'wf__bar--gain') : row.kind === 'total' ? 'wf__bar--base' : 'wf__bar--deduct';
      s.appendChild(svg('text', { x: 0, y: y + row.h / 2, class: 'wf__label' + (row.kind === 'total' ? ' wf__label--total' : ''), 'dominant-baseline': 'central' }, row.label));
      s.appendChild(svg('rect', { x: row.x, y: y, width: row.w, height: row.h, class: 'wf__bar ' + cls }));
      var v = row.kind === 'total' ? signed(row.to) : signed(row.delta);
      s.appendChild(svg('text', { x: L.width, y: y + row.h / 2, class: 'wf__value' + (cls === 'wf__bar--loss' || cls === 'wf__bar--deduct' ? ' wf__value--neg' : ''), 'text-anchor': 'end', 'dominant-baseline': 'central' }, v));
      var next = L.rows[i + 1];
      if (next) s.appendChild(svg('line', { x1: row.endX, x2: row.endX, y1: y + row.h, y2: top + next.y, class: 'wf__link' }));
    });
    container.appendChild(s);
  }

  // ---------- 台账 ----------
  function renderLedger() {
    var root = $('#ledger-root');
    root.textContent = '';
    var sum = C.summarizeLedger(state.records);
    var tiles = el('div', 'tiles');
    function tile(label, value, sub, mod) {
      var t = el('div', 'tile' + (mod ? ' tile--' + mod : ''));
      t.appendChild(el('span', 'tile__label', label));
      t.appendChild(el('strong', 'tile__value', value));
      t.appendChild(el('span', 'tile__sub', sub));
      tiles.appendChild(t);
    }
    tile('累计净省时', signed(sum.totalNet) + ' 分钟', sum.doneCount ? '约 ' + (Math.round(sum.totalNet / 6) / 10) + ' 小时' : '暂无已回填委托', sum.totalNet < 0 ? 'loss' : 'gain');
    tile('亏损任务占比', sum.doneCount ? pct(sum.lossRatio) : '—', sum.lossCount + ' / ' + sum.doneCount + ' 次净省时为负', sum.lossRatio > 0.3 ? 'loss' : null);
    tile('已回填委托', String(sum.doneCount), '另有 ' + sum.openCount + ' 张待回填', null);
    tile('验收合格率', sum.doneCount ? pct(sum.qualifiedRate) : '—', '按契约完成标准验收', null);
    root.appendChild(tiles);

    if (!state.records.length) {
      root.appendChild(el('p', 'ledger-empty', '台账是空的。存入第一张契约卡，或点顶部「载入示例」看看积累后的样子。'));
      return;
    }

    if (sum.byType.length) {
      root.appendChild(el('h4', 'sub-title', '按任务类型：值不值得继续委托'));
      var wrap = el('div', 'table-wrap');
      var table = el('table', 'table');
      var thead = el('thead');
      var hr = el('tr');
      ['任务类型', '次数', '平均净省时', '合格率', '建议', '触发规则'].forEach(function (h) { hr.appendChild(el('th', null, h)); });
      thead.appendChild(hr);
      table.appendChild(thead);
      var tb = el('tbody');
      sum.byType.forEach(function (g) {
        var tr = el('tr');
        tr.appendChild(el('td', null, g.type));
        tr.appendChild(el('td', 'num', String(g.count)));
        // 正负以未舍入总额为准（netSign）；舍入后为 0 但实际非零时写明方向
        var avgText = g.avgNet === 0 && g.netSign !== 0 ? (g.netSign < 0 ? '略低于 0 分' : '略高于 0 分') : signed(g.avgNet) + ' 分';
        tr.appendChild(el('td', 'num' + (g.netSign < 0 ? ' is-neg' : ''), avgText));
        tr.appendChild(el('td', 'num', pct(g.qualifiedRate)));
        var td = el('td');
        td.appendChild(el('span', 'advice advice--' + g.advice.code, g.advice.text));
        tr.appendChild(td);
        tr.appendChild(el('td', 'muted', g.advice.rule));
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      wrap.appendChild(table);
      root.appendChild(wrap);
    }

    root.appendChild(el('h4', 'sub-title', '全部委托'));
    var wrap2 = el('div', 'table-wrap');
    var t2 = el('table', 'table');
    var th2 = el('thead');
    var hr2 = el('tr');
    ['日期', '任务', '类型', '级别', '净省时', '验收', '操作'].forEach(function (h) { hr2.appendChild(el('th', null, h)); });
    th2.appendChild(hr2);
    t2.appendChild(th2);
    var tb2 = el('tbody');
    sortedRecords().forEach(function (r) {
      var tr = el('tr', r.status === 'done' && r.net < 0 ? 'is-loss-row' : null);
      tr.appendChild(el('td', 'nowrap', r.doneAt || r.createdAt || '—'));
      var name = el('td');
      name.appendChild(document.createTextNode(r.contract.taskName || '未命名'));
      if (r.sample) name.appendChild(el('span', 'tag tag--sample', '合成示例'));
      tr.appendChild(name);
      tr.appendChild(el('td', null, r.contract.taskType || '未分类'));
      tr.appendChild(el('td', 'nowrap', 'L' + r.contract.trustLevel));
      if (r.status === 'done') {
        tr.appendChild(el('td', 'num' + (r.net < 0 ? ' is-neg' : ''), signed(r.net) + ' 分' + (r.net < 0 ? '（亏）' : '')));
        tr.appendChild(el('td', r.qualified ? 'ok' : 'is-neg', r.qualified ? '合格' : '不合格'));
      } else {
        tr.appendChild(el('td', 'muted', '待回填'));
        tr.appendChild(el('td', 'muted', '—'));
      }
      var ops = el('td', 'ops');
      ops.appendChild(btn(r.status === 'done' ? '查看' : '回填', 'btn--ghost btn--small', function () {
        ui.selected = r.id; ui.fill = null; renderFill();
        $('#fill-title').scrollIntoView({ behavior: prefersReduced() ? 'auto' : 'smooth' });
        var s = $('#rec-select'); if (s) s.focus();
      }, { 'aria-label': (r.status === 'done' ? '查看 ' : '回填 ') + (r.contract.taskName || '未命名') }));
      ops.appendChild(btn('删除', 'btn--ghost btn--small btn--danger-text', function () {
        if (!confirm('删除「' + (r.contract.taskName || '未命名') + '」这条委托记录？此操作不可撤销。')) return;
        var next = { draft: state.draft, records: state.records.filter(function (x) { return x.id !== r.id; }) };
        if (!save(next)) return; // 持久错误已显示，记录保留
        state = next;
        if (ui.selected === r.id) { ui.selected = null; ui.fill = null; }
        renderScore(); renderCount();
      }, { 'aria-label': '删除 ' + (r.contract.taskName || '未命名') }));
      tr.appendChild(ops);
      tb2.appendChild(tr);
    });
    t2.appendChild(tb2);
    wrap2.appendChild(t2);
    root.appendChild(wrap2);
  }
  function prefersReduced() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }

  function renderCount() { $('#tab-count').textContent = String(state.records.length); }

  // ---------- 全局动作 ----------
  function loadSample() {
    if (!isBlankDraft(state.draft) && !confirm('载入示例会用合成示例替换当前草稿，并把 ' + SAMPLE.records.length + ' 条合成示例加入台账。继续吗？')) return;
    var kept = state.records.filter(function (r) { return !r.sample; });
    var next = { draft: C.normalizeContract(SAMPLE.draft), records: kept.concat(SAMPLE.records.map(C.normalizeRecord)) };
    if (!save(next)) return; // 持久错误已显示，当前草稿与台账保持不变
    state = next;
    ui.fill = null; ui.selected = null;
    renderAllDraft();
    renderCount();
    if (ui.view === 'score') renderScore();
    toast('已载入合成示例：1 张草稿 + ' + SAMPLE.records.length + ' 条已完成委托');
  }
  function clearAll() {
    var extra = storage.corrupt && !storage.corrupt.key ? '\n注意：本机存储里的损坏数据没有备份，清空后将无法恢复。' : '';
    if (!confirm('清空全部数据（当前草稿与整个台账）？此操作不可撤销。' + extra)) return;
    try { localStorage.removeItem(STORE_KEY); }
    catch (e) {
      storage.saveError = '清空失败：浏览器存储不可用，本机数据仍在，页面内容未改动。';
      renderStorageAlert();
      return;
    }
    storage.blocked = false; storage.corrupt = null; storage.saveError = '';
    renderStorageAlert();
    state = { draft: C.createContract(), records: [] };
    ui.fill = null; ui.selected = null;
    renderAllDraft();
    renderCount();
    if (ui.view === 'score') renderScore();
    toast('已清空');
  }
  function renderAllDraft() {
    fillForm(); renderBoard(); renderLadder(); renderCheck(); renderPreview();
    var msg = $('#commit-msg'); msg.textContent = ''; msg.className = 'form-msg';
  }

  // ---------- 绑定 ----------
  $('#contract-form').addEventListener('input', function (e) {
    var name = e.target.name;
    if (TEXT_FIELDS.indexOf(name) < 0) return;
    var patch = {};
    patch[name] = e.target.value;
    setDraft(Object.assign({}, state.draft, patch));
    updateCounters();
    renderPreview();
  });
  $('#contract-form').addEventListener('submit', function (e) { e.preventDefault(); });
  $('#btn-add-criterion').addEventListener('click', function () {
    if (state.draft.criteria.length >= 20) { toast('最多 20 条完成标准'); return; }
    setDraft(Object.assign({}, state.draft, { criteria: state.draft.criteria.concat(['']) }));
    renderCriteria(state.draft.criteria.length - 1);
  });
  $('#custom-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = $('#custom-label');
    try {
      var saved = setDraft(C.addCustomAction(state.draft, input.value, $('#custom-high').checked));
      input.value = '';
      $('#custom-high').checked = false;
      renderBoard(); renderCheck(); renderPreview();
      if (saved) toast('已添加到必问区'); // 失败时持久的「未保存」提示已显示，不再报成功

    } catch (err) { toast(err.message); }
  });
  $('#btn-copy').addEventListener('click', onCopy);
  $('#btn-download').addEventListener('click', onDownload);
  $('#btn-commit').addEventListener('click', onCommit);
  $('#btn-csv').addEventListener('click', function () {
    if (!state.records.length) { toast('台账是空的，没有可导出的内容'); return; }
    download('委托台账-' + TODAY + '.csv', C.toCSV(state.records), 'text/csv;charset=utf-8');
    toast('已导出 CSV');
  });
  $('#btn-sample').addEventListener('click', loadSample);
  $('#btn-clear').addEventListener('click', clearAll);
  window.addEventListener('hashchange', route);
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (ui.view === 'score') renderResult(); }, 150);
  });

  renderStorageAlert();
  renderAllDraft();
  renderCount();
  route();
})();
