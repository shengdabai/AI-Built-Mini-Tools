/* 概念卡片库 · 界面与交互。所有用户输入通过 textContent 渲染,不拼接 innerHTML。 */
(function () {
  'use strict';

  var C = globalThis.CardCore;
  var STORAGE_KEY = 'conceptcards.v1';

  function pad(n) { return String(n).padStart(2, '0'); }
  var now = new Date();
  var TODAY = C.resolveToday(location.search, now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()));

  var loadProblem = '';
  var state = { cards: load() };
  var ui = {
    view: 'library', q: '', status: '', selected: null, edit: null, graphId: null,
    review: null, rewriting: false, suppressNext: false, pending: null, deleting: false, detailRewrite: false,
    editDirty: false, leaveNext: null
  };
  var FIELD_IDS = { name: 'f-name', def: 'f-def', notNot: 'f-notnot', questions: 'f-questions', links: 'f-link-input', source: 'f-source', status: 'f-status' };

  /* ---------- 存储 ---------- */
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var v = C.validateImport(raw);
      if (v.ok) return v.cards;
      loadProblem = '本地存储的数据没有通过校验,已按空库打开(原文另存在 ' + STORAGE_KEY + '.rejected,没有被覆盖):' + v.errors.slice(0, 3).join(';');
      try { localStorage.setItem(STORAGE_KEY + '.rejected', raw); } catch (e2) { loadProblem += '(另存也失败了)'; }
      return [];
    } catch (e) { return []; }
  }
  /* 写入前用与读取相同的 validateImport 检查;返回是否真正写入。失败时显示持续可见的「未保存」提示 */
  function save() {
    var ok = true;
    try {
      var text = C.serialize(state.cards);
      if (!C.validateImport(text).ok) throw new Error('校验未通过');
      localStorage.setItem(STORAGE_KEY, text);
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
  /* 编辑表单有未保存修改时:离开、替换数据前先页内确认;导出停用 */
  function isDirty() { return ui.view === 'edit' && ui.editDirty; }
  function guardDraft(next) {
    if (!isDirty()) { next(); return; }
    ui.leaveNext = next;
    $('leave-confirm').hidden = false;
    $('btn-leave-no').focus();
  }
  function markDirty() { ui.editDirty = true; updateExportGuard(); }
  function updateExportGuard() {
    var dirty = isDirty();
    ['btn-export-md', 'btn-export-csv', 'btn-export-json'].forEach(function (id) { $(id).disabled = dirty; });
    $('export-block').hidden = !dirty;
  }
  function clearFieldErrors() {
    Object.keys(FIELD_IDS).forEach(function (k) {
      var input = $(FIELD_IDS[k]);
      input.removeAttribute('aria-invalid');
      var span = $('err-' + k);
      if (span) { span.hidden = true; span.textContent = ''; }
    });
  }
  function btn(label, cls, onClick) {
    var b = el('button', 'btn ' + cls, [label]);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }
  function tag(text, cls) { return el('span', 'tag tag--' + cls, [text]); }
  function statusTag(s) { return tag(s, s === '可用' ? 'ok' : s === '草稿' ? 'warn' : 'plain'); }
  function bullets(list) { return el('ul', 'bullets', list.map(function (x) { return el('li', '', [x]); })); }

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

  function cardById(id) {
    for (var i = 0; i < state.cards.length; i++) if (state.cards[i].id === id) return state.cards[i];
    return null;
  }
  function cardByName(name) {
    for (var i = 0; i < state.cards.length; i++) if (state.cards[i].name === name) return state.cards[i];
    return null;
  }
  function newId() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function commit(cards, msg, kind) {
    state.cards = cards;
    var ok = save();
    renderAll();
    if (msg) flash(ok ? msg : '', kind);
    return ok;
  }

  /* ---------- 视图 ---------- */
  var TAB_OF = { library: 'library', detail: 'library', edit: 'library', graph: 'graph', review: 'review' };
  function setView(name) {
    ui.view = name;
    document.querySelectorAll('.tab').forEach(function (t) {
      if (t.getAttribute('data-view') === TAB_OF[name]) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    document.querySelectorAll('main > .view').forEach(function (v) { v.hidden = v.id !== 'view-' + name; });
    if (name === 'graph') renderGraph();
    if (name === 'review') renderReview();
    if (name === 'library') renderLibrary();
    updateExportGuard();
  }

  function renderAll() {
    $('count-cards').textContent = String(state.cards.length);
    $('count-review').textContent = String(eligibleForReview().length ? Math.min(5, eligibleForReview().length) : 0);
    renderLibrary();
    if (ui.view === 'detail') renderDetail();
    if (ui.view === 'graph') renderGraph();
    if (ui.view === 'review') renderReview();
    var dl = $('names-list');
    clear(dl);
    state.cards.forEach(function (c) { var o = document.createElement('option'); o.value = c.name; dl.appendChild(o); });
  }

  /* ---------- 卡片库 ---------- */
  function warningsOf(card, g) {
    var out = [];
    var len = C.len(card.def);
    if (len > C.DEF_LIMIT) out.push(tag('定义 ' + len + ' 字,超 ' + C.DEF_LIMIT, 'warn'));
    var gate = C.qualityGate(card, state.cards);
    if (!gate.clear) out.push(tag('依赖未定义概念', 'warn'));
    if (g.islands.indexOf(card.name) >= 0) out.push(tag('孤岛', 'plain'));
    if (g.hubs.some(function (h) { return h.name === card.name; })) out.push(tag('枢纽', 'ok'));
    return out;
  }

  function renderLibrary() {
    var has = state.cards.length > 0;
    $('empty-guide').hidden = has;
    $('library-body').hidden = !has;
    if (!has) return;
    var g = C.linkGraph(state.cards);
    var counts = { 草稿: 0, 可用: 0, 已重写: 0 };
    state.cards.forEach(function (c) { counts[c.status]++; });
    var longCount = state.cards.filter(function (c) { return C.len(c.def) > C.DEF_LIMIT; }).length;
    var grid = $('stat-grid');
    clear(grid);
    [['卡片总数', state.cards.length, ''], ['可用 / 已重写', counts['可用'] + ' / ' + counts['已重写'], ''], ['草稿', counts['草稿'], 'warn'],
      ['孤岛(无关联)', g.islands.length, 'warn'], ['定义超 60 字', longCount, 'warn']].forEach(function (s) {
      grid.appendChild(el('div', 'stat' + (s[2] && s[1] ? ' stat--warn' : ''), [el('span', 'stat__label', [s[0]]), el('span', 'stat__value', [s[1]])]));
    });
    var list = C.search(state.cards, ui.q).filter(function (c) { return !ui.status || c.status === ui.status; });
    $('result-hint').textContent = (ui.q || ui.status) ? '找到 ' + list.length + ' 张(共 ' + state.cards.length + ' 张)' : '点卡片查看详情、质量门与关联。';
    var sampleCount = state.cards.filter(function (c) { return c.source.indexOf('合成示例') === 0; }).length;
    var sn = $('sample-note');
    sn.hidden = !sampleCount;
    sn.textContent = sampleCount ? '其中 ' + sampleCount + ' 张是合成示例卡片(来源以「合成示例」开头),定义仅为示意,不是你的笔记。导出文件里同样带着这个来源标注。' : '';
    var cg = $('card-grid');
    clear(cg);
    if (!list.length) cg.appendChild(el('p', 'hint', ['没有符合条件的卡片。']));
    list.forEach(function (c) {
      var open = el('button', 'link-btn', [c.name]);
      open.type = 'button';
      open.addEventListener('click', function (e) { e.stopPropagation(); openDetail(c.id); });
      var tile = el('article', 'tile', [
        el('div', 'tile__head', [el('h3', 'tile__name', [open]), statusTag(c.status)]),
        el('p', 'tile__def', [c.def]),
        el('div', 'tile__meta', warningsOf(c, g).concat([tag(g.adjacency[c.name].length + ' 个关联', 'plain')]))
      ]);
      tile.addEventListener('click', function () { openDetail(c.id); });
      cg.appendChild(tile);
    });
  }

  /* ---------- 详情 ---------- */
  function openDetail(id) {
    ui.selected = id;
    ui.deleting = false;
    ui.detailRewrite = false;
    setView('detail');
    renderDetail();
    window.scrollTo(0, 0);
  }

  function gateBlock(card) {
    var g = C.qualityGate(card, state.cards);
    var rows = [['清晰', g.clear, '定义里没有引用草稿状态的概念'], ['准确', g.accurate, '至少有 1 条反例'], ['必要', g.necessary, '至少有 1 个能回答的问题']];
    var box = el('div', 'gate', [el('h3', '', ['质量门:清晰、准确、必要'])]);
    rows.forEach(function (r) {
      box.appendChild(el('div', 'gate__row', [tag(r[1] ? '通过' : '未通过', r[1] ? 'ok' : 'error'), el('strong', '', [r[0]]), el('span', 'hint', [r[2]])]));
    });
    if (g.reasons.length) box.appendChild(bullets(g.reasons));
    box.appendChild(el('p', 'hint', [C.canBeUsable(card, state.cards) ? '三项全过,可以设为「可用」。' : '三项没有全过,不能设为「可用」。']));
    return box;
  }

  function renderDetail() {
    var body = $('detail-body');
    clear(body);
    var c = cardById(ui.selected);
    if (!c) { body.appendChild(el('p', '', ['这张卡片不存在了。'])); return; }
    var g = C.linkGraph(state.cards);
    var nbrs = g.adjacency[c.name] || [];
    body.appendChild(el('div', 'detail__head', [el('h2', '', [c.name]), el('div', 'row', [statusTag(c.status)].concat(warningsOf(c, g)))]));
    body.appendChild(el('p', 'detail__def', [c.def]));

    var chips = el('div', 'chips');
    if (!nbrs.length) chips.appendChild(el('span', 'hint', ['没有关联(孤岛)']));
    nbrs.forEach(function (n) {
      var target = cardByName(n);
      var b = el('button', 'chip', [n]);
      b.type = 'button';
      b.addEventListener('click', function () { if (target) openDetail(target.id); });
      chips.appendChild(b);
    });
    var dangling = (c.links || []).filter(function (l) { return !cardByName(l); });
    dangling.forEach(function (l) { chips.appendChild(el('span', 'chip chip--static', [l + '(还没有这张卡)'])); });

    var dates = '创建 ' + c.created + (c.rewritten ? ' · 最近重写 ' + c.rewritten + '(' + C.daysBetween(c.rewritten, TODAY) + ' 天前)' : ' · 还没有重写过');
    body.appendChild(el('div', 'detail__grid', [
      el('div', 'detail__block', [el('h3', '', ['不是什么']), bullets(c.notNot)]),
      el('div', 'detail__block', [el('h3', '', ['能回答的问题']), bullets(c.questions)]),
      el('div', 'detail__block', [el('h3', '', ['关联概念']), chips]),
      el('div', 'detail__block', [el('h3', '', ['来源']), el('p', '', [c.source || '(未填写)']), el('p', 'hint', [dates])])
    ]));
    body.appendChild(gateBlock(c));

    if (c.versions && c.versions.length) {
      var vs = el('div', 'detail__block', [el('h3', '', ['历史版本(最近 ' + C.VERSION_LIMIT + ' 版)'])]);
      c.versions.forEach(function (v) { vs.appendChild(el('div', 'version', [el('span', 'hint', ['改写前,日期 ' + v.date]), el('span', '', [v.def])])); });
      body.appendChild(vs);
    }

    var actions = el('div', 'row');
    actions.appendChild(btn('编辑', 'btn--primary', function () { openEdit(c.id); }));
    actions.appendChild(btn('重写定义', 'btn--secondary', function () { ui.detailRewrite = !ui.detailRewrite; renderDetail(); }));
    if (c.status !== '可用') actions.appendChild(btn('设为可用', 'btn--secondary', function () { setStatus(c, '可用'); }));
    if (c.status !== '草稿') actions.appendChild(btn('退回草稿', 'btn--secondary', function () { setStatus(c, '草稿'); }));
    actions.appendChild(btn('导出这张 Markdown', 'btn--secondary', function () { download(c.name + '.md', C.toMarkdown(c), 'text/markdown;charset=utf-8'); }));
    actions.appendChild(btn('删除', 'btn--danger-ghost', function () { ui.deleting = true; renderDetail(); }));
    body.appendChild(actions);

    if (ui.detailRewrite) {
      var ta = el('textarea', 'textarea--short');
      ta.id = 'rewrite-text';
      ta.value = c.def;
      var errs = el('p', 'hint hint--warn');
      errs.id = 'rewrite-errors';
      body.appendChild(el('div', 'gate', [
        el('label', 'field', ['新的一句话定义(旧版本会保留,最多 3 版)', ta]), errs,
        el('div', 'row', [
          btn('保存重写', 'btn--primary', function () {
            ui.detailRewrite = false;
            var r = applyRewrite(c, ta.value);
            if (r.error) { ui.detailRewrite = true; errs.textContent = r.error; }
          }),
          btn('取消', 'btn--secondary', function () { ui.detailRewrite = false; renderDetail(); })
        ])
      ]));
    }
    if (ui.deleting) {
      var box = el('div', 'notice notice--danger', [
        el('p', '', [el('strong', '', ['确认删除「' + c.name + '」?']), '别的卡片里指向它的关联会一并移除,不能撤销。']),
        el('div', 'row', [
          btn('确认删除', 'btn--danger', function () {
            ui.deleting = false;
            var id = c.id;
            var ok = commit(C.removeCard(state.cards, id), '已删除「' + c.name + '」');
            void ok;
            setView('library');
          }),
          btn('取消', 'btn--secondary', function () { ui.deleting = false; renderDetail(); })
        ])
      ]);
      box.id = 'delete-confirm';
      body.appendChild(box);
    }
  }

  function setStatus(card, status) {
    var next = Object.assign({}, card, { status: status });
    if (status === '可用' && !C.canBeUsable(card, state.cards)) {
      flash('不能设为可用:' + C.qualityGate(card, state.cards).reasons.join(';'), 'danger');
      return;
    }
    var r = C.upsertCard(state.cards, next, TODAY);
    if (!r.ok) { flash(r.errors.join(';'), 'danger'); return; }
    commit(r.cards, '「' + card.name + '」已设为' + status + demotedNote(r));
  }

  function demotedNote(r) {
    return r.demoted && r.demoted.length ? '。因依赖草稿概念,已自动退回草稿:' + r.demoted.join('、') : '';
  }

  /* 重写:返回 {error} 或 {ok};定义变化由 core.upsertCard 统一记录日期与旧版本。detail 与复习共用 */
  function applyRewrite(card, text) {
    if (!text.trim()) return { error: '新的定义不能为空。' };
    var r = C.upsertCard(state.cards, Object.assign({}, card, { def: text }), TODAY);
    if (!r.ok) return { error: r.errors.join(';') };
    var warn = r.warnings.filter(function (w) { return w.indexOf('超过') >= 0; });
    commit(r.cards, '「' + card.name + '」已重写,旧版本已保留' + (warn.length ? '。提示:' + warn[0] : '') + demotedNote(r));
    return { ok: true };
  }

  /* ---------- 编辑 ---------- */
  function openEdit(id) {
    var c = id ? cardById(id) : null;
    ui.edit = { id: id || null, links: c ? c.links.slice() : [] };
    $('edit-title').textContent = c ? '编辑「' + c.name + '」' : '新建卡片';
    $('f-name').value = c ? c.name : '';
    $('f-def').value = c ? c.def : '';
    $('f-notnot').value = c ? c.notNot.join('\n') : '';
    $('f-questions').value = c ? c.questions.join('\n') : '';
    $('f-source').value = c ? c.source : '';
    $('f-status').value = c ? c.status : '草稿';
    $('f-link-input').value = '';
    $('edit-errors').hidden = true;
    clearFieldErrors();
    ui.editDirty = false;
    renderChips();
    updateDefCount();
    setView('edit');
    window.scrollTo(0, 0);
    $('f-name').focus();
  }
  function renderChips() {
    var box = $('link-chips');
    clear(box);
    if (!ui.edit.links.length) box.appendChild(el('span', 'hint', ['还没有关联']));
    ui.edit.links.forEach(function (name) {
      var exists = !!cardByName(name);
      var b = el('button', 'chip', [name + (exists ? '' : '(还没有这张卡)'), el('span', '', ['移除'])]);
      b.type = 'button';
      b.setAttribute('aria-label', '移除关联 ' + name);
      b.addEventListener('click', function () {
        ui.edit.links = ui.edit.links.filter(function (x) { return x !== name; });
        markDirty();
        renderChips();
      });
      box.appendChild(b);
    });
  }
  function addLinkFromInput() {
    var input = $('f-link-input');
    var name = input.value.trim();
    if (!name) return;
    if (ui.edit.links.indexOf(name) < 0) ui.edit.links.push(name);
    markDirty();
    input.value = '';
    renderChips();
  }
  function updateDefCount() {
    var n = C.len($('f-def').value.trim());
    var over = n > C.DEF_LIMIT;
    var h = $('def-count');
    h.textContent = n + ' / ' + C.DEF_LIMIT + ' 字' + (over ? ',超出了,可以保存但建议压缩' : '');
    h.className = over ? 'hint hint--warn' : 'hint';
  }
  function showEditErrors(list) {
    var ul = $('edit-errors-list');
    clear(ul);
    clearFieldErrors();
    var first = null;
    list.forEach(function (e) {
      ul.appendChild(el('li', '', [e]));
      var k = C.errorField(e);
      if (!k) return;
      var span = $('err-' + k);
      var input = $(FIELD_IDS[k]);
      input.setAttribute('aria-invalid', 'true');
      if (span) { span.textContent = span.textContent ? span.textContent + ';' + e : e; span.hidden = false; }
      if (!first) first = input;
    });
    $('edit-errors').hidden = false;
    (first || $('edit-errors')).scrollIntoView && (first || $('edit-errors')).scrollIntoView({ block: 'center' });
    if (first) first.focus();
  }
  function saveEdit() {
    addLinkFromInput();
    var old = ui.edit.id ? cardById(ui.edit.id) : null;
    var card = {
      id: old ? old.id : newId(),
      name: $('f-name').value,
      def: $('f-def').value,
      notNot: $('f-notnot').value.split(/\r?\n/),
      questions: $('f-questions').value.split(/\r?\n/),
      links: ui.edit.links.slice(),
      source: $('f-source').value,
      status: $('f-status').value,
      created: old ? old.created : TODAY,
      rewritten: old ? old.rewritten : '',
      reviewed: old ? old.reviewed || '' : '',
      versions: old ? old.versions : []
    };
    card.notNot = C.trimList(card.notNot);
    card.questions = C.trimList(card.questions);
    if (card.status === '可用') {
      var trial = state.cards.filter(function (c) { return c.id !== card.id; }).concat([Object.assign({}, card, { name: card.name.trim(), def: card.def.trim() })]);
      var gate = C.qualityGate(trial[trial.length - 1], trial);
      if (!(gate.clear && gate.accurate && gate.necessary)) {
        showEditErrors(['不能设为可用,质量门没有全过:'].concat(gate.reasons));
        return;
      }
    }
    var r = C.upsertCard(state.cards, card, TODAY);
    if (!r.ok) { showEditErrors(r.errors); return; }
    var extra = (r.warnings.length ? '。提示:' + r.warnings.slice(0, 2).join(';') : '') + demotedNote(r);
    if (old && old.def !== card.def.trim()) extra += '。定义已改,旧定义已存入历史版本';
    ui.selected = card.id;
    ui.editDirty = false;
    commit(r.cards, '已保存「' + card.name.trim() + '」' + extra);
    openDetail(card.id);
  }

  /* ---------- 关系图 ---------- */
  function renderGraph() {
    var has = state.cards.length > 0;
    $('graph-empty').hidden = has;
    $('graph-body').hidden = !has;
    if (!has) return;
    var g = C.linkGraph(state.cards);
    if (!ui.graphId || !cardById(ui.graphId)) {
      var topHub = g.hubs.length ? cardByName(g.hubs[0].name) : null;
      ui.graphId = (topHub || state.cards[0]).id;
    }
    var sel = $('graph-select');
    clear(sel);
    state.cards.forEach(function (c) { var o = document.createElement('option'); o.value = c.id; o.textContent = c.name; sel.appendChild(o); });
    sel.value = ui.graphId;
    var center = cardById(ui.graphId);
    var nbrs = g.adjacency[center.name];
    var left = el('div', 'adj__col adj__col--left');
    var right = el('div', 'adj__col adj__col--right');
    nbrs.forEach(function (n, i) {
      var target = cardByName(n);
      var b = el('button', 'node', [n]);
      b.type = 'button';
      b.addEventListener('click', function () { ui.graphId = target.id; renderGraph(); });
      (i % 2 === 0 ? left : right).appendChild(b);
    });
    var c = el('div', 'adj__center', [
      el('h3', '', [center.name]), statusTag(center.status), el('p', '', [center.def]),
      el('p', '', [nbrs.length ? nbrs.length + ' 个直接关联的卡片' : '没有关联,这是一座孤岛'])
    ]);
    c.appendChild(btn('打开这张卡片', 'btn--secondary', function () { openDetail(center.id); }));
    var adj = $('adj');
    clear(adj);
    adj.appendChild(left);
    adj.appendChild(c);
    adj.appendChild(right);

    function jump(listEl, items, labelFn) {
      clear(listEl);
      if (!items.length) { listEl.appendChild(el('li', 'hint', ['没有']));return; }
      items.forEach(function (it) {
        var name = typeof it === 'string' ? it : it.name;
        var b = el('button', 'link-btn', [labelFn(it)]);
        b.type = 'button';
        b.addEventListener('click', function () { ui.graphId = cardByName(name).id; renderGraph(); });
        listEl.appendChild(el('li', '', [b]));
      });
    }
    jump($('hub-list'), g.hubs, function (h) { return h.name + '(' + h.degree + ' 个关联)'; });
    jump($('island-list'), g.islands, function (n) { return n; });
  }

  /* ---------- 复习 ---------- */
  function eligibleForReview() {
    return state.cards.filter(function (c) { return c.reviewed !== TODAY && c.rewritten !== TODAY; });
  }
  function renderReview() {
    var box = $('review-box');
    clear(box);
    var r = ui.review;
    if (!state.cards.length) {
      box.appendChild(el('h2', '', ['复习']));
      box.appendChild(el('p', '', ['还没有卡片可以复习。先载入示例或新建卡片。']));
      return;
    }
    if (!r) {
      var q = C.reviewQueue(eligibleForReview(), 5, TODAY);
      box.appendChild(el('h2', '', ['复习:最久没有重写的 5 张']));
      if (!q.length) {
        box.appendChild(el('p', '', ['今天的卡片都复习过了。']));
        return;
      }
      box.appendChild(el('p', 'hint', ['每张先只看定义,判断它还清不清晰;要重写就直接改,旧版本会保留。顺序按最近一次重写(没重写过的按创建日期)从早到晚。']));
      var list = el('ul', 'bullets');
      q.forEach(function (c) { list.appendChild(el('li', '', [c.name + ' · 上次动过 ' + (c.rewritten || c.created) + '(' + C.daysBetween(c.rewritten || c.created, TODAY) + ' 天前)'])); });
      box.appendChild(list);
      box.appendChild(el('div', 'row', [btn('开始复习', 'btn--primary', function () {
        ui.review = { ids: q.map(function (c) { return c.id; }), i: 0, clear: 0, rewritten: 0, rewriting: false };
        renderReview();
      })]));
      return;
    }
    if (r.i >= r.ids.length) {
      box.appendChild(el('h2', '', ['这一轮完成']));
      box.appendChild(el('p', '', ['共 ' + r.ids.length + ' 张:还清晰 ' + r.clear + ' 张,重写 ' + r.rewritten + ' 张。']));
      box.appendChild(el('div', 'row', [btn('再来一轮', 'btn--primary', function () { ui.review = null; renderAll(); renderReview(); }), btn('回到卡片库', 'btn--secondary', function () { ui.review = null; setView('library'); })]));
      return;
    }
    var c = cardById(r.ids[r.i]);
    if (!c) { r.i++; renderReview(); return; }
    box.appendChild(el('p', 'review__progress', ['第 ' + (r.i + 1) + ' / ' + r.ids.length + ' 张 · 上次动过 ' + (c.rewritten || c.created)]));
    box.appendChild(el('h2', '', [c.name]));
    box.appendChild(el('p', 'review__def', [c.def]));
    if (!r.rewriting) {
      box.appendChild(el('div', 'row', [
        btn('还清晰', 'btn--primary', function () {
          var res = C.upsertCard(state.cards, Object.assign({}, c, { reviewed: TODAY }), TODAY);
          if (res.ok) { state.cards = res.cards; save(); }
          r.clear++; r.i++; renderAll();
        }),
        btn('要重写', 'btn--secondary', function () { r.rewriting = true; renderReview(); })
      ]));
    } else {
      var ta = el('textarea', 'textarea--short');
      ta.id = 'review-rewrite-text';
      ta.value = c.def;
      var errs = el('p', 'hint hint--warn');
      box.appendChild(el('label', 'field', ['新的一句话定义', ta]));
      box.appendChild(errs);
      box.appendChild(el('div', 'row', [
        btn('保存重写并下一张', 'btn--primary', function () {
          var res = applyRewrite(c, ta.value);
          if (res.error) { errs.textContent = res.error; return; }
          r.rewritten++; r.i++; r.rewriting = false; renderAll();
        }),
        btn('取消', 'btn--secondary', function () { r.rewriting = false; renderReview(); })
      ]));
    }
  }

  /* ---------- 替换确认(载入示例 / 导入覆盖) ---------- */
  function askReplace(message, apply) {
    ui.pending = apply;
    $('replace-title').textContent = message;
    $('replace-confirm').hidden = false;
  }
  function closeReplace() { ui.pending = null; $('replace-confirm').hidden = true; }

  function loadSample() {
    var doApply = function () {
      var cards = JSON.parse(JSON.stringify(globalThis.CARD_SAMPLE.cards));
      closeReplace();
      ui.review = null; ui.graphId = null;
      commit(cards, '已载入 ' + cards.length + ' 张示例卡片。' + globalThis.CARD_SAMPLE.note + '。');
      setView('library');
    };
    if (state.cards.length) askReplace('载入示例会替换你现有的 ' + state.cards.length + ' 张卡片。建议先点「备份 JSON」。确认替换吗?', doApply);
    else doApply();
  }

  function showImportError(list) {
    var ul = $('import-error-list');
    clear(ul);
    list.slice(0, 8).forEach(function (e) { ul.appendChild(el('li', '', [e])); });
    if (list.length > 8) ul.appendChild(el('li', '', ['还有 ' + (list.length - 8) + ' 条没有列出']));
    $('import-error').hidden = false;
  }

  function onImportFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var v = C.validateImport(String(reader.result));
      if (!v.ok) { showImportError(v.errors); return; }
      $('import-error').hidden = true;
      var apply = function () {
        closeReplace();
        ui.review = null; ui.graphId = null;
        commit(v.cards, '已导入 ' + v.cards.length + ' 张卡片' + (v.warnings.length ? '。提示:' + v.warnings[0] : ''));
        setView('library');
      };
      if (state.cards.length) askReplace('导入会替换你现有的 ' + state.cards.length + ' 张卡片,换成备份里的 ' + v.cards.length + ' 张。确认替换吗?', apply);
      else apply();
    };
    reader.onerror = function () { showImportError(['文件读取失败']); };
    reader.readAsText(file);
  }

  /* ---------- 事件 ---------- */
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () { guardDraft(function () { setView(t.getAttribute('data-view')); }); });
  });
  $('btn-new').addEventListener('click', function () { guardDraft(function () { openEdit(null); }); });
  $('btn-sample').addEventListener('click', function () { guardDraft(loadSample); });
  $('btn-sample-2').addEventListener('click', loadSample);
  $('btn-replace-yes').addEventListener('click', function () { if (ui.pending) ui.pending(); });
  $('btn-replace-no').addEventListener('click', closeReplace);
  $('btn-detail-back').addEventListener('click', function () { setView('library'); });
  $('btn-edit-cancel').addEventListener('click', function () {
    guardDraft(function () { setView(ui.edit && ui.edit.id && cardById(ui.edit.id) ? 'detail' : 'library'); if (ui.view === 'detail') renderDetail(); });
  });
  $('btn-leave-yes').addEventListener('click', function () {
    var next = ui.leaveNext; ui.leaveNext = null; ui.editDirty = false;
    $('leave-confirm').hidden = true; updateExportGuard();
    if (next) next();
  });
  $('btn-leave-no').addEventListener('click', function () {
    ui.leaveNext = null; $('leave-confirm').hidden = true;
    if (ui.view === 'edit') $('f-name').focus();
  });
  $('edit-form').addEventListener('input', markDirty);
  $('edit-form').addEventListener('change', markDirty);
  $('btn-import').addEventListener('click', function () { $('file-import').click(); });
  $('edit-form').addEventListener('submit', function (e) { e.preventDefault(); saveEdit(); });
  $('f-def').addEventListener('input', updateDefCount);
  $('btn-link-add').addEventListener('click', addLinkFromInput);
  $('f-link-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addLinkFromInput(); } });
  $('search-q').addEventListener('input', function (e) { ui.q = e.target.value; renderLibrary(); });
  $('filter-status').addEventListener('change', function (e) { ui.status = e.target.value; renderLibrary(); });
  $('graph-select').addEventListener('change', function (e) { ui.graphId = e.target.value; renderGraph(); });
  $('btn-export-md').addEventListener('click', function () {
    if (!state.cards.length) { flash('还没有卡片可以导出。', 'warn'); return; }
    download('概念卡片库.md', C.toMarkdown(state.cards), 'text/markdown;charset=utf-8');
  });
  $('btn-export-csv').addEventListener('click', function () {
    if (!state.cards.length) { flash('还没有卡片可以导出。', 'warn'); return; }
    download('概念卡片库.csv', '\ufeff' + C.toCsv(state.cards), 'text/csv;charset=utf-8');
  });
  function exportJson() { download('概念卡片库-备份.json', C.serialize(state.cards), 'application/json'); }
  $('btn-export-json').addEventListener('click', exportJson);
  $('btn-save-warning-export').addEventListener('click', exportJson);
  $('file-import').addEventListener('change', function (e) {
    var f = e.target.files[0]; e.target.value = '';
    if (f) guardDraft(function () { onImportFile(f); });
  });
  $('btn-import-error-close').addEventListener('click', function () { $('import-error').hidden = true; });
  $('btn-clear').addEventListener('click', function () {
    guardDraft(function () {
      $('clear-title').textContent = '确认清空全部 ' + state.cards.length + ' 张卡片?此操作不能撤销,建议先导出 JSON 备份。';
      $('clear-confirm').hidden = false; $('btn-clear-no').focus();
    });
  });
  $('btn-clear-no').addEventListener('click', function () { $('clear-confirm').hidden = true; });
  $('btn-clear-yes').addEventListener('click', function () {
    $('clear-confirm').hidden = true;
    ui.review = null; ui.graphId = null; ui.selected = null;
    commit([], '已清空所有卡片');
    setView('library');
  });

  if (C.resolveToday(location.search, '')) { $('today-fixed').textContent = '基准日 ' + TODAY + '(由地址参数固定)'; $('today-fixed').hidden = false; }
  if (loadProblem) { $('load-warning-text').textContent = loadProblem; $('load-warning').hidden = false; }
  renderAll();
  setView('library');
})();
