/* 错题回环 app.js — DOM 与交互，只调用 CuotiCore。所有用户文本经 textContent 渲染。 */
(function () {
  'use strict';
  var C = globalThis.CuotiCore;
  var SAMPLE = globalThis.CuotiSample;
  var STORE_KEY = 'cuotihuihuan.v1';
  var LOG_MAX = 5000;

  // 「今天」：默认每次取本地日期（跨午夜自动切换）；?today=YYYY-MM-DD 固定日期（演示/测试用）
  var FIXED_TODAY = (function () {
    var q = new URLSearchParams(location.search).get('today');
    if (q) { try { C.parseISO(q); return q; } catch (e) { /* 忽略非法参数 */ } }
    return null;
  })();
  function today() { return FIXED_TODAY || C.localToday(); }
  var renderedDay = today();

  var storeProblem = null; // 加载时发现的问题（常驻提示）
  var saveBlocked = false; // 原始数据没能备份时禁止覆盖
  var saveFailed = false;
  var state = load();
  var ui = { view: 'review', reveal: null }; // reveal: { id, answer, mode: 'check'|'show' }

  // ---------- 存储 ----------
  function backupRaw(raw) {
    var key = STORE_KEY + '.corrupt-' + Date.now();
    try { localStorage.setItem(key, raw); return key; } catch (e) { return null; }
  }
  function load() {
    var raw;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { return { cards: [], log: [] }; }
    if (!raw) return { cards: [], log: [] };
    var data;
    try { data = JSON.parse(raw); } catch (e) { data = undefined; }
    var s = data !== undefined ? C.sanitizeState(data, today()) : null;
    if (s && !s.dropped) return { cards: s.cards, log: s.log };
    var key = backupRaw(raw);
    if (!key) saveBlocked = true;
    storeProblem = (s ? '存储里有 ' + s.dropped + ' 条错题数据损坏，已跳过。' : '存储里的数据无法解析，已按空库打开。') +
      (key ? '原始数据已另存为 localStorage 键「' + key + '」，可用于恢复。' : '原始数据无法另存，为避免覆盖，本次改动不会保存；请先导出或手动备份浏览器数据。');
    return s ? { cards: s.cards, log: s.log } : { cards: [], log: [] };
  }
  /** 写入 localStorage；成功返回 true，失败显示常驻提示并返回 false（调用方不再提示成功）。 */
  function save() {
    var ok = false;
    if (!saveBlocked) {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); ok = true; } catch (e) { ok = false; }
    }
    saveFailed = !ok;
    renderNotice();
    if (!ok) toast('未保存：浏览器存储不可用、已满或存有待恢复数据，刷新会丢失本次改动');
    return ok;
  }
  function renderNotice() {
    var n = $('#store-notice');
    var msgs = [];
    if (storeProblem) msgs.push(storeProblem);
    if (saveFailed) msgs.push('最近一次改动没有保存成功，请先点「导出 JSON 备份」保住数据。');
    n.textContent = msgs.join(' ');
    n.hidden = !msgs.length;
  }
  /** 日期跨天后重新渲染（仅非固定日期模式）。 */
  function checkDayChange() {
    var d = today();
    if (d === renderedDay) return;
    renderedDay = d;
    ui.reveal = null;
    $('#today-label').textContent = '今天 ' + d;
    render();
  }

  // ---------- 小工具 ----------
  function $(sel) { return document.querySelector(sel); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function newId() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
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
  function fmtDate(iso) {
    var d = C.daysBetween(today(), iso);
    if (d <= 0) return d === 0 ? '今天' : '已过期 ' + (-d) + ' 天';
    if (d === 1) return '明天';
    return d + ' 天后';
  }
  function fmtDays(n) { return n + ' 天后'; }

  /** 把 diff 片段渲染进容器。side: 'wrong' 只显示 eq+del；'right' 只显示 eq+ins；'inline' 全部。 */
  function renderDiff(container, a, b, side) {
    C.charDiff(a, b).forEach(function (op) {
      // 答案对比时忽略纯标点差异：多写的标点按原样显示，漏写的标点不提示
      if (side === 'inline' && op.type !== 'eq' && C.isPunctOnly(op.text)) {
        if (op.type === 'del') container.appendChild(document.createTextNode(op.text));
        return;
      }
      if (op.type === 'eq') container.appendChild(document.createTextNode(op.text));
      else if (op.type === 'del' && side !== 'right') container.appendChild(el(side === 'inline' ? 'del' : 'span', 'mark-del', op.text));
      else if (op.type === 'ins' && side !== 'wrong') container.appendChild(el(side === 'inline' ? 'ins' : 'span', 'mark-ins', op.text));
    });
    return container;
  }
  function tagOptions(select, includeAll, selected) {
    select.textContent = '';
    if (includeAll) select.appendChild(new Option('全部类型', ''));
    C.TAGS.forEach(function (t) { select.appendChild(new Option(t.label, t.id)); });
    if (selected != null) select.value = selected;
  }

  // ---------- 路由 ----------
  var VIEWS = ['review', 'add', 'list', 'stats'];
  function setView(v) {
    ui.view = VIEWS.indexOf(v) === -1 ? 'review' : v;
    document.querySelectorAll('.view').forEach(function (s) { s.hidden = s.dataset.view !== ui.view; });
    document.querySelectorAll('.tab').forEach(function (t) { t.setAttribute('aria-selected', String(t.dataset.view === ui.view)); });
    render();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', function () { setView(location.hash.slice(1)); });

  // ---------- 渲染 ----------
  function render() {
    var queue = C.dueQueue(state.cards, today());
    $('#tab-due-count').textContent = String(queue.length);
    $('#tab-total-count').textContent = String(state.cards.length);
    if (ui.view === 'review') renderReview(queue);
    if (ui.view === 'list') renderList();
    if (ui.view === 'stats') renderStats();
  }

  function renderEmpty(root) {
    var box = el('div', 'panel empty');
    box.appendChild(el('h3', 'empty__title', '还没有错题'));
    box.appendChild(el('p', 'empty__text', '错题回环只复习学员自己真实说错、写错的句子。老师课后录入，学员每天打开只看今天到期的几条，按记住程度自动安排下一次。'));
    var steps = el('ul', 'empty__steps');
    ['老师：在「录入错题」贴入这节课的错句和正确句（支持整段批量粘贴）', '学员：每天在这里写出正确句，看逐字差异，再自评记住程度', '老师：在「统计与导出」看哪类错误最多，导出 Anki 或备份']
      .forEach(function (s) { steps.appendChild(el('li', null, s)); });
    box.appendChild(steps);
    var ex = el('div', 'empty__example');
    ex.setAttribute('aria-label', '示例：我有三个书 改为 我有三本书');
    ex.appendChild(renderDiff(el('div'), '我有三个书。', '我有三本书。', 'wrong'));
    ex.appendChild(renderDiff(el('div'), '我有三个书。', '我有三本书。', 'right'));
    box.appendChild(ex);
    var act = el('div', 'actions');
    var b1 = el('button', 'btn btn--primary', '载入示例（合成示例 14 条）');
    b1.type = 'button'; b1.addEventListener('click', loadSample);
    var b2 = el('a', 'btn btn--secondary', '去录入第一条');
    b2.href = '#add';
    act.appendChild(b1); act.appendChild(b2);
    box.appendChild(act);
    root.appendChild(box);
  }

  function renderReview(queue) {
    var root = $('#review-root');
    root.textContent = '';
    if (!state.cards.length) { renderEmpty(root); return; }

    var st = C.stats(state.cards, today(), state.log);
    var done = st.reviewedToday;
    var wrap = el('div', 'review review--split');
    var mainCol = el('div', 'review');
    wrap.appendChild(mainCol);

    var meta = el('div', 'review__meta');
    var m1 = el('span'); m1.appendChild(el('strong', null, String(queue.length))); m1.appendChild(document.createTextNode(' 条待复习'));
    var m2 = el('span'); m2.appendChild(el('strong', null, String(done))); m2.appendChild(document.createTextNode(' 条今天已复习'));
    var prog = el('div', 'progress'); prog.setAttribute('role', 'progressbar');
    prog.setAttribute('aria-label', '今日进度'); prog.setAttribute('aria-valuemin', '0');
    prog.setAttribute('aria-valuemax', String(done + queue.length)); prog.setAttribute('aria-valuenow', String(done));
    var fill = el('div', 'progress__fill');
    fill.style.setProperty('--bar-ratio', String(done + queue.length ? done / (done + queue.length) : 0));
    prog.appendChild(fill);
    meta.appendChild(m1); meta.appendChild(prog); meta.appendChild(m2);
    mainCol.appendChild(meta);

    if (!queue.length) {
      var fin = el('div', 'panel empty');
      fin.appendChild(el('h3', 'empty__title', '今天的错题复习完了'));
      var next = C.nextDueDate(state.cards, today());
      fin.appendChild(el('p', 'empty__text', next ? '下一批在 ' + next + '（' + fmtDate(next) + '）到期。新录入的错题会立刻出现在这里。' : '所有错题都已排好。'));
      mainCol.appendChild(fin);
    } else {
      mainCol.appendChild(renderStudyCard(queue[0]));
    }
    wrap.appendChild(renderQueueAside(queue, st));
    root.appendChild(wrap);
  }

  function renderStudyCard(card) {
    var r = ui.reveal && ui.reveal.id === card.id ? ui.reveal : null;
    var box = el('article', 'panel study-card');
    box.setAttribute('aria-label', '当前错题');
    var label = el('p', 'study-card__label');
    label.appendChild(document.createTextNode('这句哪里错了？'));
    label.appendChild(el('span', 'tag', C.tagLabel(card.tag)));
    if (card.lapses) label.appendChild(el('span', 'tag', '忘过 ' + card.lapses + ' 次'));
    box.appendChild(label);
    box.appendChild(el('p', 'study-card__wrong', card.wrong));
    if (card.english) box.appendChild(el('p', 'study-card__english', card.english));

    if (!r) {
      var form = el('form', 'answer');
      var lab = el('label', 'visually-hidden', '写出正确的句子'); lab.htmlFor = 'answer-input';
      var inp = el('input', 'input'); inp.id = 'answer-input'; inp.autocomplete = 'off';
      inp.placeholder = '写出正确的句子，按回车检查';
      form.appendChild(lab); form.appendChild(inp);
      var acts = el('div', 'actions');
      var bCheck = el('button', 'btn btn--primary', '检查'); bCheck.type = 'submit';
      var bShow = el('button', 'btn btn--secondary', '显示答案'); bShow.type = 'button';
      acts.appendChild(bCheck); acts.appendChild(bShow);
      form.appendChild(acts);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var v = inp.value.trim();
        if (!v) { toast('先写出你认为正确的句子，或点「显示答案」'); inp.focus(); return; }
        ui.reveal = { id: card.id, answer: v, mode: 'check' }; render(); focusFirstGrade();
      });
      bShow.addEventListener('click', function () { ui.reveal = { id: card.id, answer: '', mode: 'show' }; render(); focusFirstGrade(); });
      box.appendChild(form);
      setTimeout(function () { if (document.activeElement === document.body || !document.activeElement) inp.focus(); }, 0);
      return box;
    }

    var cmp = el('div', 'compare');
    if (r.mode === 'check') {
      var ok = C.isCorrectAnswer(r.answer, card.correct);
      cmp.appendChild(el('p', 'verdict ' + (ok ? 'verdict--ok' : 'verdict--no'), ok ? '完全正确。' : '还差一点：红色划线是要去掉的字，绿色下划线是应补上的字。'));
      var rowA = el('div', 'compare__row');
      rowA.appendChild(el('span', 'compare__label', '你的答案'));
      rowA.appendChild(renderDiff(el('p', 'compare__text'), r.answer, card.correct, 'inline'));
      cmp.appendChild(rowA);
    } else {
      cmp.appendChild(el('p', 'verdict verdict--shown', '已显示答案。对照下面两行，再诚实自评。'));
    }
    var rowW = el('div', 'compare__row compare__row--wrong');
    rowW.appendChild(el('span', 'compare__label', '错句'));
    rowW.appendChild(renderDiff(el('p', 'compare__text'), card.wrong, card.correct, 'wrong'));
    var rowR = el('div', 'compare__row compare__row--right');
    rowR.appendChild(el('span', 'compare__label', '正确句'));
    rowR.appendChild(renderDiff(el('p', 'compare__text'), card.wrong, card.correct, 'right'));
    cmp.appendChild(rowW); cmp.appendChild(rowR);
    if (card.note) cmp.appendChild(el('p', 'compare__note', '老师备注：' + card.note));
    box.appendChild(cmp);

    var prev = C.previewIntervals(card, today());
    var grades = el('div', 'grades');
    grades.setAttribute('role', 'group'); grades.setAttribute('aria-label', '自评记住程度');
    C.GRADES.forEach(function (g, i) {
      var b = el('button', 'grade grade--' + g.id); b.type = 'button';
      b.appendChild(el('span', 'grade__label', g.label));
      b.appendChild(el('span', 'grade__next', fmtDays(prev[g.id]) + '再见 · 按 ' + (i + 1)));
      b.addEventListener('click', function () { grade(card.id, g.id); });
      grades.appendChild(b);
    });
    box.appendChild(grades);
    box.appendChild(el('p', 'kbd-hint', '间隔由 SM-2 算法按你的自评计算。'));
    return box;
  }

  function focusFirstGrade() { var b = document.querySelector('.grade--good'); if (b) b.focus(); }

  function renderQueueAside(queue, st) {
    var aside = el('aside', 'panel');
    aside.setAttribute('aria-label', '今日队列');
    aside.appendChild(el('h3', 'panel__title', '今天到期'));
    if (!queue.length) {
      aside.appendChild(el('p', 'hint', '队列已清空。'));
    } else {
      var ul = el('ul', 'queue');
      queue.slice(0, 8).forEach(function (c, i) {
        var li = el('li', 'queue__item' + (i === 0 ? ' queue__item--current' : ''));
        li.appendChild(el('span', 'queue__pos', i === 0 ? '当前' : c.due < today() ? '逾期' : '今天'));
        li.appendChild(el('span', null, c.wrong));
        ul.appendChild(li);
      });
      aside.appendChild(ul);
      if (queue.length > 8) aside.appendChild(el('p', 'hint', '还有 ' + (queue.length - 8) + ' 条'));
    }
    var sum = el('p', 'hint chart__legend', '共 ' + st.total + ' 条错题，已掌握 ' + st.mastered + ' 条（间隔 ≥ ' + C.MASTERED_INTERVAL + ' 天）。');
    aside.appendChild(sum);
    return aside;
  }

  function grade(id, g) {
    var idx = state.cards.findIndex(function (c) { return c.id === id; });
    if (idx === -1) return;
    var updated = C.review(state.cards[idx], g, today());
    state.cards[idx] = updated;
    state.log.push({ date: today(), id: id, grade: g });
    if (state.log.length > LOG_MAX) state.log = state.log.slice(-LOG_MAX);
    ui.reveal = null;
    if (save()) toast('已安排：' + fmtDate(updated.due) + '（' + updated.due + '）再复习');
    render();
    var inp = document.getElementById('answer-input');
    if (inp) inp.focus();
  }

  document.addEventListener('keydown', function (e) {
    if (ui.view !== 'review' || !ui.reveal || e.metaKey || e.ctrlKey || e.altKey) return;
    var n = Number(e.key);
    if (n >= 1 && n <= 4) { e.preventDefault(); grade(ui.reveal.id, C.GRADES[n - 1].id); }
  });

  // ---------- 错题本 ----------
  function renderList() {
    var root = $('#list-root');
    root.textContent = '';
    if (!state.cards.length) { root.appendChild(el('p', 'panel list-empty', '错题本是空的。去「录入错题」添加，或点顶部「载入示例」。')); return; }
    var tag = $('#filter-tag').value;
    var q = $('#filter-q').value.trim().toLowerCase();
    var list = state.cards.filter(function (c) {
      if (tag && c.tag !== tag) return false;
      if (q && (c.wrong + c.correct + c.english + c.note).toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).sort(function (a, b) { return a.due < b.due ? -1 : a.due > b.due ? 1 : 0; });
    if (!list.length) { root.appendChild(el('p', 'panel list-empty', '没有符合筛选条件的错题。')); return; }
    var ul = el('ul', 'cards');
    list.forEach(function (c) {
      var li = el('li', 'panel item');
      var pair = el('div', 'item__pair');
      var l1 = el('p', 'item__line'); l1.appendChild(el('span', 'item__arrow', '错')); l1.appendChild(renderDiff(el('span'), c.wrong, c.correct, 'wrong'));
      var l2 = el('p', 'item__line'); l2.appendChild(el('span', 'item__arrow', '对')); l2.appendChild(renderDiff(el('span'), c.wrong, c.correct, 'right'));
      pair.appendChild(l1); pair.appendChild(l2);
      if (c.english || c.note) pair.appendChild(el('p', 'item__english', [c.english, c.note && '备注：' + c.note].filter(Boolean).join(' · ')));
      li.appendChild(pair);

      var side = el('div', 'item__side');
      var sel = el('select', 'select');
      sel.setAttribute('aria-label', '错误类型：' + c.wrong);
      tagOptions(sel, false, c.tag);
      sel.addEventListener('change', function () {
        var i = state.cards.findIndex(function (x) { return x.id === c.id; });
        state.cards[i] = C.setTag(state.cards[i], sel.value); if (save()) toast('已改为「' + C.tagLabel(sel.value) + '」');
      });
      side.appendChild(sel);
      if (c.tagManual) side.appendChild(el('span', 'tag', '手动'));
      var due = el('span', 'due-chip' + (C.isMastered(c) ? ' due-chip--done' : ''), C.isMastered(c) ? '已掌握 · ' + fmtDate(c.due) : '下次 ' + fmtDate(c.due));
      side.appendChild(due);
      side.appendChild(el('span', null, '间隔 ' + c.interval + ' 天'));
      var del = el('button', 'btn btn--link-danger', '删除'); del.type = 'button';
      del.setAttribute('aria-label', '删除：' + c.wrong);
      del.addEventListener('click', function () {
        if (!confirm('删除这条错题？\n' + c.wrong)) return;
        state.cards = state.cards.filter(function (x) { return x.id !== c.id; }); var ok = save(); render(); if (ok) toast('已删除');
      });
      side.appendChild(del);
      li.appendChild(side);
      ul.appendChild(li);
    });
    root.appendChild(ul);
  }

  // ---------- 统计 ----------
  function renderStats() {
    var root = $('#stats-root');
    root.textContent = '';
    var st = C.stats(state.cards, today(), state.log);
    var tiles = el('div', 'tiles');
    [['总错题', st.total, ''], ['今日到期', st.due, 'tile--due'], ['已掌握（间隔 ≥ ' + C.MASTERED_INTERVAL + ' 天）', st.mastered, 'tile--mastered'], ['今天已复习', st.reviewedToday, '']]
      .forEach(function (t) {
        var d = el('div', 'panel tile ' + t[2]);
        d.appendChild(el('p', 'tile__value', String(t[1])));
        d.appendChild(el('p', 'tile__label', t[0]));
        tiles.appendChild(d);
      });
    root.appendChild(tiles);

    var chart = el('div', 'panel chart');
    chart.appendChild(el('h3', 'panel__title', '错误类型分布'));
    if (!st.total) {
      chart.appendChild(el('p', 'hint', '还没有数据。录入错题或载入示例后，这里会按类型显示数量。'));
    } else {
      var ul = el('ul', 'bars');
      st.byTag.forEach(function (r) {
        var li = el('li', 'bar');
        li.appendChild(el('span', 'bar__label', r.label));
        var track = el('div', 'bar__track');
        track.setAttribute('aria-hidden', 'true');
        var fill = el('div', 'bar__fill');
        fill.style.setProperty('--bar-ratio', String(st.maxCount ? r.count / st.maxCount : 0));
        track.appendChild(fill);
        li.appendChild(track);
        var v = el('span', 'bar__value');
        v.appendChild(el('strong', null, r.count + ' 条'));
        v.appendChild(document.createTextNode(' · 忘记 ' + r.lapses + ' 次'));
        li.appendChild(v);
        ul.appendChild(li);
      });
      chart.appendChild(ul);
      chart.appendChild(el('p', 'hint chart__legend', '条形长度 = 该类型错题数；「忘记」= 复习时自评「忘了」的累计次数。类型由规则自动识别，老师可在错题本里改。'));
    }
    root.appendChild(chart);
  }

  // ---------- 录入 ----------
  function initAdd() {
    var form = $('#form-single');
    var tagSel = $('#in-tag');
    tagSel.appendChild(new Option('按规则自动识别', ''));
    C.TAGS.forEach(function (t) { tagSel.appendChild(new Option(t.label, t.id)); });

    function preview() {
      var w = form.wrong.value.trim(), c = form.correct.value.trim();
      var box = $('#single-preview');
      box.textContent = '';
      if (w && c) {
        $('#auto-tag').textContent = '规则识别：' + C.tagLabel(C.classify(w, c));
        box.appendChild(renderDiff(el('div'), w, c, 'wrong'));
        box.appendChild(renderDiff(el('div'), w, c, 'right'));
      } else {
        $('#auto-tag').textContent = '';
      }
    }
    form.wrong.addEventListener('input', preview);
    form.correct.addEventListener('input', preview);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var err = $('#single-error');
      try {
        var card = C.makeCard({ wrong: form.wrong.value, correct: form.correct.value, english: form.english.value, note: form.note.value, tag: tagSel.value || null }, today(), newId());
        state.cards.push(card);
        var ok = save();
        err.textContent = '';
        form.reset(); preview();
        render();
        if (ok) toast('已加入：' + C.tagLabel(card.tag) + '，今天就会出现在复习里');
        form.wrong.focus();
      } catch (ex) {
        err.textContent = ex.message;
      }
    });

    var bulk = $('#in-bulk'), bulkBox = $('#bulk-preview'), bulkBtn = $('#btn-bulk');
    function bulkPreview() {
      var r = C.parseBulk(bulk.value);
      bulkBox.textContent = '';
      r.items.slice(0, 20).forEach(function (it) {
        var row = el('div', 'bulk-row');
        row.appendChild(el('span', 'tag tag--brand', C.tagLabel(C.classify(it.wrong, it.correct))));
        var t = el('span', 'bulk-row__text');
        renderDiff(t, it.wrong, it.correct, 'inline');
        row.appendChild(t);
        if (it.english) row.appendChild(el('span', 'hint', it.english));
        bulkBox.appendChild(row);
      });
      if (r.items.length > 20) bulkBox.appendChild(el('p', 'hint', '……另有 ' + (r.items.length - 20) + ' 条'));
      r.errors.forEach(function (er) {
        bulkBox.appendChild(el('div', 'bulk-row bulk-row--error', '第 ' + er.line + ' 行未识别：' + er.reason));
      });
      bulkBtn.disabled = !r.items.length;
      bulkBtn.textContent = r.items.length ? '导入 ' + r.items.length + ' 条' : '导入';
      return r;
    }
    bulk.addEventListener('input', bulkPreview);
    $('#form-bulk').addEventListener('submit', function (e) {
      e.preventDefault();
      var r = C.parseBulk(bulk.value);
      if (!r.items.length) return;
      r.items.forEach(function (it) { state.cards.push(C.makeCard(it, today(), newId())); });
      var ok = save();
      bulk.value = ''; bulkPreview(); render();
      if (ok) toast('已导入 ' + r.items.length + ' 条' + (r.errors.length ? '，' + r.errors.length + ' 行未识别已跳过' : ''));
    });
  }

  // ---------- 顶栏动作 ----------
  function loadSample() {
    var cards = SAMPLE.cards.map(function (s, i) {
      var c = C.makeCard(s, today(), 'sample-' + (i + 1));
      return Object.assign(c, {
        note: s.note + '（合成示例）',
        createdAt: C.addDays(today(), -Math.max(s.interval, 1) - 3),
        ef: s.ef, reps: s.reps, interval: s.interval, lapses: s.lapses, reviews: s.reps + s.lapses,
        due: C.addDays(today(), s.dueOffset),
        lastReviewed: C.addDays(today(), s.dueOffset - s.interval)
      });
    });
    state.cards = C.mergeCards(state.cards, cards);
    ui.reveal = null;
    var ok = save(); render();
    if (ok) toast('已载入 ' + cards.length + ' 条合成示例');
  }

  function clearAll() {
    if (!state.cards.length && !state.log.length) { toast('当前没有数据'); return; }
    if (!confirm('清空全部错题和复习记录？此操作不可撤销，建议先导出 JSON 备份。')) return;
    state = { cards: [], log: [] }; ui.reveal = null;
    var ok = save(); render();
    if (ok) toast('已清空');
  }

  function initTopbar() {
    $('#today-label').textContent = '今天 ' + today();
    $('#btn-sample').addEventListener('click', loadSample);
    $('#btn-clear').addEventListener('click', clearAll);
    tagOptions($('#filter-tag'), true, '');
    $('#filter-tag').addEventListener('change', renderList);
    $('#filter-q').addEventListener('input', renderList);
    $('#btn-anki').addEventListener('click', function () {
      if (!state.cards.length) { toast('没有可导出的错题'); return; }
      download('错题回环-anki-' + today() + '.csv', C.toAnkiCSV(state.cards), 'text/csv;charset=utf-8');
      toast('已导出 ' + state.cards.length + ' 条 Anki 卡片');
    });
    $('#btn-json').addEventListener('click', function () {
      download('错题回环-备份-' + today() + '.json', C.exportJSON(state, new Date().toISOString()), 'application/json');
      toast('已导出 JSON 备份');
    });
    $('#btn-import').addEventListener('click', function () { $('#in-import').click(); });
    $('#in-import').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      f.text().then(function (text) {
        var data = C.importJSON(text, today());
        state.cards = C.mergeCards(state.cards, data.cards);
        state.log = C.mergeLog(state.log, data.log, LOG_MAX);
        var ok = save(); render();
        if (ok) toast('已导入 ' + data.cards.length + ' 条错题' +
          (data.dropped ? '，' + data.dropped + ' 条损坏已跳过' : '') +
          (data.reIded ? '，' + data.reIded + ' 条缺少或重复 ID 已重新编号' : ''));
      }).catch(function (ex) { toast('导入失败：' + ex.message); })
        .then(function () { e.target.value = ''; });
    });
  }

  initTopbar();
  initAdd();
  renderNotice();
  if (!FIXED_TODAY) {
    document.addEventListener('visibilitychange', function () { if (!document.hidden) checkDayChange(); });
    setInterval(checkDayChange, 60000);
  }
  setView(location.hash.slice(1) || 'review');
})();
