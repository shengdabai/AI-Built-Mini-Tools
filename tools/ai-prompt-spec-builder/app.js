/* AI 提问规格生成器 · 界面与交互。所有用户输入通过 textContent / value 渲染,不拼接 innerHTML。 */
(function () {
  'use strict';

  var C = globalThis.SpecCore;
  var STORAGE_KEY = 'aispec.v1';
  var STEP_NAMES = ['任务', '限定条件', '验收标准', '输出结构', '角色与语气'];

  function pad(n) { return String(n).padStart(2, '0'); }
  function localToday() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  var TODAY = C.parseToday(new URLSearchParams(location.search).get('today') || '') || localToday();

  var corrupt = null;      // 本机存档读取失败时 { raw, errors };用户明确放弃之前不覆盖旧存档
  var storageBlocked = false;
  var state = load();
  var ui = { currentId: state.specs.length ? state.specs[0].id : null, step: 0, tag: '', query: '', mode: 'full', suppressNext: false, pending: null };
  var idCounter = 0;

  /* ---------- 存储(写入校验 = 读取校验:都用 validateState) ---------- */
  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { storageBlocked = true; return { specs: [] }; }
    if (!raw) return { specs: [] };
    var v = C.validateImport(raw);
    if (v.ok) return { specs: v.data.specs };
    corrupt = { raw: raw, errors: v.errors };
    return { specs: [] };
  }
  function save() {
    var ok = true, why = '';
    var v = C.validateState({ specs: state.specs });
    if (corrupt) { ok = false; why = '浏览器里的旧存档读取失败,为了不覆盖它,新改动暂不写入(先点页面上方的「下载原始存档」,再决定是否放弃旧存档)。'; }
    else if (!v.ok) { ok = false; why = '数据校验未通过(' + v.errors[0] + ')。'; }
    else {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ specs: state.specs })); }
      catch (e) { ok = false; why = '浏览器拒绝写入本地存储。'; }
    }
    var w = $('save-warning');
    w.hidden = ok;
    if (!ok) $('save-warning-text').textContent = '未保存:' + why + '刚才的改动只在当前页面里,关闭页面就会丢失。请立即导出 JSON 备份。';
    ui.suppressNext = !ok;
    return ok;
  }
  function renderLoadError() {
    var box = $('load-error');
    box.hidden = !corrupt;
    if (!corrupt) return;
    var ul = $('load-error-list');
    clear(ul);
    corrupt.errors.slice(0, 5).forEach(function (m) { ul.appendChild(el('li', null, [m])); });
    if (corrupt.errors.length > 5) ul.appendChild(el('li', null, ['……另有 ' + (corrupt.errors.length - 5) + ' 条']));
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
  var flashTimer = null;
  function flash(msg) {
    if (ui.suppressNext) { ui.suppressNext = false; return; }
    var f = $('flash');
    f.textContent = msg;
    f.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { f.hidden = true; }, 6000);
  }
  function cur() {
    for (var i = 0; i < state.specs.length; i++) if (state.specs[i].id === ui.currentId) return state.specs[i];
    return null;
  }
  function newId() {
    var id;
    do { id = 's' + Date.now().toString(36) + (idCounter++).toString(36); }
    while (state.specs.some(function (s) { return s.id === id; }));
    return id;
  }
  function touch(spec) { spec.updatedAt = TODAY; }

  /* ---------- 页内确认 ---------- */
  function askConfirm(text, yesLabel, onYes) {
    ui.pending = onYes;
    $('confirm-text').textContent = text;
    $('btn-confirm-yes').textContent = yesLabel;
    $('confirm').hidden = false;
  }
  function closeConfirm() { ui.pending = null; $('confirm').hidden = true; }

  /* ---------- 下载 ---------- */
  function download(name, text, type, bom) {
    var blob = new Blob([bom ? '﻿' + text : text], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function safeName(s) {
    var n = (s.title || '规格').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40);
    return n || '规格';
  }

  /* ---------- 渲染:规格库 ---------- */
  function renderLibrary() {
    var all = state.specs;
    var tagBox = $('tag-filter');
    clear(tagBox);
    var counts = C.tagCounts(all);
    if (ui.tag && !counts.has(ui.tag)) ui.tag = '';
    counts.forEach(function (n, t) {
      var b = el('button', 'chip', [t + ' (' + n + ')']);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(ui.tag === t));
      b.addEventListener('click', function () { ui.tag = ui.tag === t ? '' : t; renderLibrary(); });
      tagBox.appendChild(b);
    });
    var list = C.search(all, ui.query).filter(function (s) { return !ui.tag || s.tags.indexOf(ui.tag) !== -1; });
    var ul = $('spec-list');
    clear(ul);
    list.forEach(function (s) {
      var b = el('button', 'spec-item', [
        el('span', 'spec-item__title', [s.title || '(未命名)']),
        el('span', 'spec-item__meta', [(s.tags.length ? s.tags.join('、') + ' · ' : '') + '更新 ' + (s.updatedAt || '—')])
      ]);
      b.type = 'button';
      b.setAttribute('aria-current', String(s.id === ui.currentId));
      b.addEventListener('click', function () { ui.currentId = s.id; ui.step = 0; renderAll(); });
      ul.appendChild(el('li', null, [b]));
    });
    $('spec-list-empty').hidden = list.length > 0 || all.length === 0;
  }

  /* ---------- 渲染:编辑器 ---------- */
  function stepFilled(s, i) {
    if (i === 0) return !!s.task.trim();
    if (i === 1) return s.constraints.some(function (c) { return c.text.trim(); });
    if (i === 2) return s.criteria.some(function (c) { return c.text.trim(); });
    if (i === 3) return !!s.output.trim();
    return !!(s.role.trim() || s.tone.trim());
  }
  function renderSteps() {
    var s = cur();
    var nav = $('steps-nav');
    clear(nav);
    STEP_NAMES.forEach(function (name, i) {
      var label = (i + 1) + '. ' + name + (i >= 3 ? '(可选)' : '');
      var b = el('button', 'step-tab', [label, stepFilled(s, i) ? el('span', 'step-tab__done', [' 已填']) : null]);
      b.type = 'button';
      if (i === ui.step) b.setAttribute('aria-current', 'step');
      b.addEventListener('click', function () { ui.step = i; renderSteps(); });
      nav.appendChild(b);
    });
    for (var i = 0; i < 5; i++) $('step-' + (i + 1)).hidden = i !== ui.step;
    $('progress-bar').style.width = (((ui.step + 1) / 5) * 100) + '%';
    $('progress-text').textContent = '第 ' + (ui.step + 1) + ' 步,共 5 步:' + STEP_NAMES[ui.step];
    $('btn-prev').disabled = ui.step === 0;
    $('btn-next').disabled = ui.step === 4;
  }

  function renderConstraintRows() {
    var s = cur(), box = $('constraint-rows');
    clear(box);
    if (!s.constraints.length) box.appendChild(el('p', 'empty', ['还没有限定条件。点下面的按钮添加。']));
    s.constraints.forEach(function (c, i) {
      var sel = el('select');
      sel.setAttribute('aria-label', '第 ' + (i + 1) + ' 条的类别');
      C.KINDS.forEach(function (k) { var o = el('option', null, [k]); o.value = k; sel.appendChild(o); });
      sel.value = c.kind;
      sel.addEventListener('change', function () { c.kind = sel.value; changed(s); });
      var inp = el('input');
      inp.type = 'text'; inp.value = c.text; inp.autocomplete = 'off';
      inp.setAttribute('aria-label', '第 ' + (i + 1) + ' 条限定条件');
      inp.addEventListener('input', function () { c.text = inp.value; changed(s); });
      var del = el('button', 'btn btn--secondary', ['删除']);
      del.type = 'button';
      del.setAttribute('aria-label', '删除第 ' + (i + 1) + ' 条限定条件');
      del.addEventListener('click', function () {
        var drop = function () { s.constraints.splice(s.constraints.indexOf(c), 1); changed(s); renderConstraintRows(); renderSteps(); };
        if (c.text.trim()) askConfirm('确认删除第 ' + (i + 1) + ' 条限定条件「' + c.kind + ':' + c.text.trim() + '」?删除后不能撤销。', '确认删除', drop);
        else drop();
      });
      box.appendChild(el('div', 'rowline', [sel, inp, del]));
    });
  }
  function renderCriteriaRows() {
    var s = cur(), box = $('criteria-rows');
    clear(box);
    if (!s.criteria.length) box.appendChild(el('p', 'empty', ['还没有验收标准。点下面的按钮添加。']));
    s.criteria.forEach(function (c, i) {
      var t = el('input');
      t.type = 'text'; t.value = c.text; t.autocomplete = 'off';
      t.placeholder = '可观察的标准,例如:每个结论后附一个来源链接';
      t.setAttribute('aria-label', '第 ' + (i + 1) + ' 条验收标准');
      t.addEventListener('input', function () { c.text = t.value; changed(s); });
      var k = el('input');
      k.type = 'text'; k.value = c.check; k.autocomplete = 'off';
      k.placeholder = '如何检验,例如:逐个点开链接';
      k.setAttribute('aria-label', '第 ' + (i + 1) + ' 条的检验方式');
      k.addEventListener('input', function () { c.check = k.value; changed(s); });
      var del = el('button', 'btn btn--secondary', ['删除']);
      del.type = 'button';
      del.setAttribute('aria-label', '删除第 ' + (i + 1) + ' 条验收标准');
      del.addEventListener('click', function () {
        var drop = function () { s.criteria.splice(s.criteria.indexOf(c), 1); changed(s); renderCriteriaRows(); renderSteps(); };
        if (c.text.trim() || c.check.trim()) askConfirm('确认删除第 ' + (i + 1) + ' 条验收标准「' + c.text.trim() + '」' + (c.check.trim() ? '(检验方式:' + c.check.trim() + ')' : '') + '?删除后不能撤销。', '确认删除', drop);
        else drop();
      });
      box.appendChild(el('div', 'rowline rowline--criterion', [t, k, del]));
    });
  }

  function renderFields() {
    var s = cur();
    $('f-title').value = s.title;
    $('f-tags').value = s.tags.join(', ');
    $('f-task').value = s.task;
    $('f-output').value = s.output;
    $('f-role').value = s.role;
    $('f-tone').value = s.tone;
    renderConstraintRows();
    renderCriteriaRows();
    renderSteps();
  }

  /* ---------- 渲染:检查与输出(每次改动都重算,所以导出始终与界面一致) ---------- */
  var LEVEL_LABEL = { error: '需要补充', warn: '警告', info: '建议' };
  function renderDerived() {
    var s = cur();
    var issues = C.validateSpec(s).issues;
    var ul = $('check-list');
    clear(ul);
    if (!issues.length) {
      ul.appendChild(el('li', 'check check--ok', [el('span', 'check__level', ['没有发现问题']), el('span', 'check__suggest', ['任务、限定和验收之间没有触发任何规则。规则只能查结构,答案好不好仍取决于你写的内容。'])]));
    }
    issues.forEach(function (i) {
      ul.appendChild(el('li', 'check check--' + i.level, [
        el('span', 'check__level', [LEVEL_LABEL[i.level]]),
        el('span', null, [i.message]),
        el('span', 'check__suggest', [i.suggestion])
      ]));
    });
    $('check-summary').textContent = '共 ' + C.totalChars(s) + ' 字 · ' + issues.length + ' 条提示';
    var full = ui.mode === 'full';
    $('tab-full').setAttribute('aria-pressed', String(full));
    $('tab-first').setAttribute('aria-pressed', String(!full));
    $('out-hint').textContent = full
      ? '把它整段粘贴到一个新的对话里使用。'
      : '只发任务一句话,要求 AI 先列限定条件和验收标准(三步法的第 1、2 步)。确认后再用完整提示词开新对话。';
    $('out-text').value = full ? C.buildPrompt(s) : C.buildFirstRound(s);
    $('btn-copy').textContent = full ? '复制完整提示词' : '复制第一轮先问';
    $('btn-dl-md').textContent = full ? '下载完整提示词 Markdown' : '下载第一轮先问 Markdown';
  }

  function renderAll() {
    var has = state.specs.length > 0;
    if (has && !cur()) ui.currentId = state.specs[0].id;
    $('empty-guide').hidden = has;
    $('editor').hidden = !has;
    renderLibrary();
    if (has) { renderFields(); renderDerived(); }
  }

  function changed(s) {
    touch(s);
    save();
    renderLibrary();
    renderDerived();
    renderSteps();
  }

  /* ---------- 创建 ---------- */
  function addSpec(spec) {
    state.specs.unshift(spec);
    ui.currentId = spec.id; ui.step = 0; ui.query = ''; ui.tag = '';
    $('search').value = '';
    var ok = save();
    renderAll();
    return ok;
  }
  function newBlank() {
    var s = C.blankSpec(newId(), TODAY);
    s.title = '未命名规格';
    if (addSpec(s)) flash('已新建空白规格。');
  }
  function newFromTemplate() {
    var t = C.templates().filter(function (x) { return x.id === $('tpl-select').value; })[0];
    if (!t) return;
    var s = C.blankSpec(newId(), TODAY);
    Object.keys(t.spec).forEach(function (k) { s[k] = t.spec[k]; });
    s.title = '模板 · ' + t.name;
    s.tags = ['模板'];
    if (addSpec(s)) flash('已用「' + t.name + '」模板新建。把【】处改成你自己的内容。');
  }

  function applySamples() {
    state = { specs: C.clone(globalThis.SPEC_SAMPLES) };
    ui.currentId = state.specs[0].id; ui.step = 0; ui.query = ''; ui.tag = '';
    $('search').value = '';
    var ok = save();
    renderAll();
    if (ok) flash('已载入 ' + state.specs.length + ' 份合成示例(虚构内容,仅供演示)。');
  }
  function loadSample() {
    if (state.specs.length) {
      askConfirm('载入示例会替换当前的 ' + state.specs.length + ' 份规格。建议先备份 JSON。确认替换?', '确认替换', applySamples);
    } else applySamples();
  }

  /* ---------- 事件 ---------- */
  function bind(id, ev, fn) { $(id).addEventListener(ev, fn); }

  bind('btn-sample', 'click', loadSample);
  bind('btn-sample-2', 'click', loadSample);
  bind('btn-new', 'click', newBlank);
  bind('btn-new-2', 'click', newBlank);
  bind('btn-from-tpl', 'click', newFromTemplate);
  bind('btn-confirm-yes', 'click', function () { var f = ui.pending; closeConfirm(); if (f) f(); });
  bind('btn-confirm-no', 'click', closeConfirm);
  bind('search', 'input', function () { ui.query = $('search').value; renderLibrary(); });

  bind('btn-clear', 'click', function () {
    if (!state.specs.length) { flash('现在没有数据。'); return; }
    askConfirm('确认清空全部 ' + state.specs.length + ' 份规格?此操作不能撤销,建议先备份 JSON。', '确认清空', function () {
      state = { specs: [] }; ui.currentId = null;
      if (save()) flash('已清空。');
      renderAll();
    });
  });
  bind('btn-delete', 'click', function () {
    var s = cur();
    askConfirm('确认删除规格「' + (s.title || '未命名') + '」?此操作不能撤销。', '确认删除', function () {
      state.specs = state.specs.filter(function (x) { return x.id !== s.id; });
      ui.currentId = null;
      if (save()) flash('已删除。');
      renderAll();
    });
  });

  bind('f-title', 'input', function () { var s = cur(); s.title = $('f-title').value; changed(s); });
  bind('f-tags', 'input', function () { var s = cur(); s.tags = C.parseTags($('f-tags').value); changed(s); });
  bind('f-task', 'input', function () { var s = cur(); s.task = $('f-task').value; changed(s); });
  bind('f-output', 'input', function () { var s = cur(); s.output = $('f-output').value; changed(s); });
  bind('f-role', 'input', function () { var s = cur(); s.role = $('f-role').value; changed(s); });
  bind('f-tone', 'input', function () { var s = cur(); s.tone = $('f-tone').value; changed(s); });
  bind('btn-add-constraint', 'click', function () {
    var s = cur(); s.constraints.push({ kind: '范围', text: '' }); changed(s); renderConstraintRows();
    var rows = document.querySelectorAll('#constraint-rows .rowline input'); if (rows.length) rows[rows.length - 1].focus();
  });
  bind('btn-add-criterion', 'click', function () {
    var s = cur(); s.criteria.push({ text: '', check: '' }); changed(s); renderCriteriaRows();
    var rows = document.querySelectorAll('#criteria-rows .rowline input'); if (rows.length) rows[rows.length - 2].focus();
  });
  bind('btn-prev', 'click', function () { if (ui.step > 0) { ui.step--; renderSteps(); } });
  bind('btn-next', 'click', function () { if (ui.step < 4) { ui.step++; renderSteps(); } });

  bind('tab-full', 'click', function () { ui.mode = 'full'; renderDerived(); });
  bind('tab-first', 'click', function () { ui.mode = 'first'; renderDerived(); });

  function fallbackCopy(text) {
    var ta = $('out-text');
    ta.focus(); ta.select();
    try { return document.execCommand('copy'); } catch (e) { return false; }
  }
  bind('btn-copy', 'click', function () {
    var text = $('out-text').value;
    var done = function () { flash('已复制' + (ui.mode === 'full' ? '完整提示词' : '「第一轮先问」') + '。'); };
    var fail = function () {
      if (fallbackCopy(text)) done();
      else { var f = $('flash'); f.textContent = '浏览器不允许自动复制,文本已选中,请按 Ctrl/Cmd+C。'; f.hidden = false; }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fail);
    else fail();
  });
  bind('btn-dl-md', 'click', function () {
    var s = cur();
    download(safeName(s) + (ui.mode === 'full' ? '-完整提示词' : '-第一轮先问') + '.md', C.toMarkdown(s, ui.mode), 'text/markdown;charset=utf-8');
  });
  bind('btn-raw-download', 'click', function () { if (corrupt) download('提问规格-原始存档.json', corrupt.raw, 'application/json;charset=utf-8'); });
  bind('btn-raw-discard', 'click', function () {
    askConfirm('确认放弃读取失败的旧存档并开始新库?旧存档会在下一次保存时被覆盖,不能恢复;建议先点「下载原始存档」。', '确认放弃旧存档', function () {
      corrupt = null; state = { specs: [] }; ui.currentId = null;
      if (save()) flash('已放弃旧存档,新库已开始。');
      renderLoadError(); renderAll();
    });
  });
  bind('btn-dl-json', 'click', function () { var s = cur(); download(safeName(s) + '.json', C.toJson([s]), 'application/json;charset=utf-8'); });
  bind('btn-dl-csv', 'click', function () { download('提问规格.csv', C.toCsv(state.specs), 'text/csv;charset=utf-8', true); });
  function backup() { download('提问规格备份.json', C.toJson(state.specs), 'application/json;charset=utf-8'); }
  bind('btn-export-backup', 'click', backup);
  bind('btn-save-warning-export', 'click', backup);

  /* ---------- 导入:任何校验问题整份拒绝 ---------- */
  bind('btn-import-error-close', 'click', function () { $('import-error').hidden = true; });
  bind('file-import', 'change', function (ev) {
    var file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var v = C.validateImport(String(reader.result), { strict: true });
      if (!v.ok) {
        var ul = $('import-error-list');
        clear(ul);
        v.errors.slice(0, 8).forEach(function (m) { ul.appendChild(el('li', null, [m])); });
        if (v.errors.length > 8) ul.appendChild(el('li', null, ['……另有 ' + (v.errors.length - 8) + ' 条']));
        $('import-error').hidden = false;
        return;
      }
      $('import-error').hidden = true;
      var apply = function () {
        state = { specs: v.data.specs }; ui.currentId = state.specs.length ? state.specs[0].id : null; ui.step = 0;
        var ok = save(); renderAll();
        if (ok) flash('已导入 ' + state.specs.length + ' 份规格。');
      };
      if (state.specs.length) askConfirm('导入会替换当前的 ' + state.specs.length + ' 份规格,改为文件里的 ' + v.data.specs.length + ' 份。确认替换?', '确认替换', apply);
      else apply();
    };
    reader.onerror = function () {
      var ul = $('import-error-list'); clear(ul); ul.appendChild(el('li', null, ['文件读取失败。'])); $('import-error').hidden = false;
    };
    reader.readAsText(file);
  });

  /* ---------- 初始化 ---------- */
  (function init() {
    var sel = $('tpl-select');
    C.templates().forEach(function (t) {
      var o = el('option', null, [t.name + ':' + t.desc]);
      o.value = t.id;
      sel.appendChild(o);
    });
    renderAll();
    renderLoadError();
    if (storageBlocked) {
      $('save-warning-text').textContent = '未保存:浏览器不允许读取本地存储,这次的改动只在当前页面里。请随时导出 JSON 备份。';
      $('save-warning').hidden = false;
    }
  })();
})();
