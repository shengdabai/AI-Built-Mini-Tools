/* 多语言文案键核对 · 界面与交互。所有用户输入通过 textContent 渲染,不拼接 innerHTML。 */
(function () {
  'use strict';

  var C = globalThis.I18nKeyCore;
  var STORAGE_KEY = 'i18nkeys.v1';
  var PAGE = 200;

  var state = load();
  var ui = {
    view: 'files', result: null, resultError: '', issueLimit: PAGE, matrixLimit: PAGE,
    pendingReplace: null, mergePreview: null, pendingRemove: '', focusAfter: null
  };

  /* ---------- 存储(写入校验与读取校验使用同一个 validateState) ---------- */
  var loadNote = '';
  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { return C.emptyState(); }
    if (!raw) return C.emptyState();
    try {
      var v = C.validateState(JSON.parse(raw));
      if (v.ok) return v.data;
      loadNote = '浏览器里保存的数据没有通过校验(' + v.error + '),已忽略。下次保存会覆盖它。';
    } catch (e) {
      loadNote = '浏览器里保存的数据无法解析,已忽略。下次保存会覆盖它。';
    }
    return C.emptyState();
  }
  /* 返回是否真正写入;失败时显示持续可见的「未保存」提示 */
  function save() {
    var reason = '';
    var v = C.validateState(state);
    if (!v.ok) reason = '数据未通过校验:' + v.error + '。';
    else {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v.data)); }
      catch (e) { reason = '浏览器拒绝写入本地存储(可能已满或被禁用)。'; }
    }
    var w = $('save-warning');
    $('save-warning-reason').textContent = reason;
    w.hidden = reason === '';
    return reason === '';
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
  function pct(x) { return (x * 100).toFixed(1) + '%'; }
  function flash(msg, danger) {
    var f = $('flash');
    f.textContent = msg;
    f.className = danger ? 'notice notice--danger' : 'notice';
    f.hidden = false;
  }
  function hideFlash() { $('flash').hidden = true; }

  /* ---------- 状态变更入口 ---------- */
  function commit(msg) {
    ui.mergePreview = null;
    ui.issueLimit = PAGE;
    ui.matrixLimit = PAGE;
    var ok = save();
    hideFlash();
    render();
    if (ok && msg) flash(msg);
    return ok;
  }

  function recompute() {
    ui.result = null;
    ui.resultError = '';
    if (state.files.length === 0 || !state.source) return;
    try { ui.result = C.check(state.files, state.source, state.options); }
    catch (e) { ui.resultError = e.message; }
  }

  /* ---------- 渲染 ---------- */
  function render() {
    recompute();
    var has = state.files.length > 0;
    $('empty-guide').hidden = has;
    $('files-panel').hidden = !has;
    $('summary').hidden = !ui.result;
    renderSummary();
    renderFiles();
    renderFilters();
    renderIssues();
    renderMatrix();
    renderExport();
    ['files', 'issues', 'matrix', 'export'].forEach(function (v) {
      $('view-' + v).hidden = ui.view !== v;
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      if (t.getAttribute('data-view') === ui.view) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    $('issue-count').textContent = ui.result ? String(ui.result.issues.length) : '0';
    if (ui.focusAfter) {
      var target = document.querySelector(ui.focusAfter);
      ui.focusAfter = null;
      if (target) target.focus();
    }
  }

  function renderSummary() {
    if (!ui.result) return;
    var o = ui.result.stats.overall;
    $('sum-coverage').textContent = o.targetCount ? pct(o.coverage) : '无目标语言';
    $('sum-untranslated').textContent = o.targetCount ? pct(o.untranslatedRate) : '-';
    $('sum-block').textContent = String(o.blockers);
    $('sum-warn').textContent = String(o.warnings);
    $('sum-keys').textContent = String(o.keyCount);
    var p = Math.round(o.coverage * 100);
    $('sum-bar').setAttribute('aria-valuenow', String(p));
    $('sum-bar-fill').style.width = (o.coverage * 100) + '%';
  }

  function renderFiles() {
    var list = $('file-list');
    clear(list);
    state.files.forEach(function (f) {
      var isSrc = f.lang === state.source;
      var radio = el('input');
      radio.type = 'radio';
      radio.name = 'source-lang';
      radio.checked = isSrc;
      radio.addEventListener('change', function () { state.source = f.lang; commit('已把 ' + f.lang + ' 设为源语言'); });
      var title = el('div', 'file-card__title', [
        el('h3', '', [f.lang]),
        isSrc ? el('span', 'tag tag--source', ['源语言']) : null
      ]);
      var info = el('p', 'hint', [f.entries.length + ' 个键 · ' + ({ json: f.nested ? '嵌套 JSON' : '扁平 JSON', properties: '.properties', csv: 'CSV 列' }[f.format]) + (f.name ? ' · ' + f.name : '')]);
      var radioLabel = el('label', 'radio', [radio, '设为源语言']);
      var del = btn('移除 ' + f.lang, 'btn--secondary btn--small', function () {
        ui.pendingRemove = f.lang;
        renderFiles();
        var yes = document.querySelector('[data-remove-yes="' + f.lang + '"]');
        if (yes) yes.focus();
      });
      del.setAttribute('data-remove', f.lang);
      var kids = [title, info, radioLabel, del];
      if (ui.pendingRemove === f.lang) {
        var d = C.describeRemoval(state.files, state.source, f.lang);
        var msg = '确认移除语言文件 ' + f.lang + '(' + d.keys + ' 个键)?移除后这份文件的译文和合并结果会一并丢失,此操作不能撤销。';
        if (d.wasSource) msg += d.nextSource ? '它是当前源语言,移除后源语言会改为 ' + d.nextSource + '。' : '它是当前源语言,移除后没有源语言,核对结果会清空。';
        var yesBtn = btn('确认移除 ' + f.lang, 'btn--danger btn--small', function () {
          state.files = state.files.filter(function (x) { return x.lang !== f.lang; });
          state.source = d.nextSource;
          ui.pendingRemove = '';
          ui.focusAfter = state.files.length ? '[data-remove="' + state.files[0].lang + '"]' : '#paste-lang';
          commit('已移除 ' + f.lang);
        });
        yesBtn.setAttribute('data-remove-yes', f.lang);
        var noBtn = btn('取消', 'btn--secondary btn--small', function () {
          ui.pendingRemove = '';
          renderFiles();
          var back = document.querySelector('[data-remove="' + f.lang + '"]');
          if (back) back.focus();
        });
        kids.push(el('div', 'notice notice--danger file-card__confirm', [el('p', '', [msg]), el('div', 'row', [yesBtn, noBtn])]));
      }
      list.appendChild(el('div', 'file-card' + (isSrc ? ' file-card--source' : ''), kids));
    });
  }

  function renderFilters() {
    var langSel = $('f-lang');
    var typeSel = $('f-type');
    var curLang = langSel.value;
    var curType = typeSel.value;
    clear(langSel);
    clear(typeSel);
    langSel.appendChild(opt('', '全部'));
    state.files.forEach(function (f) { langSel.appendChild(opt(f.lang, f.lang)); });
    typeSel.appendChild(opt('', '全部'));
    Object.keys(C.TYPE_LABELS).forEach(function (t) { typeSel.appendChild(opt(t, C.TYPE_LABELS[t])); });
    langSel.value = state.files.some(function (f) { return f.lang === curLang; }) ? curLang : '';
    typeSel.value = C.TYPE_LABELS[curType] ? curType : '';
  }
  function opt(v, label) { var o = el('option', '', [label]); o.value = v; return o; }

  function tagFor(level) { return el('span', 'tag tag--' + level, [level === 'block' ? '阻断' : '警告']); }

  function stackTable(headers, rows, extraCls) {
    var thead = el('thead', '', [el('tr', '', headers.map(function (h) { return el('th', h.num ? 'num' : '', [h.label]); }))]);
    var tbody = el('tbody', '', rows);
    return el('div', 'table-wrap', [el('table', 'data-table stack-table' + (extraCls ? ' ' + extraCls : ''), [thead, tbody])]);
  }
  function td(label, children, cls) {
    var c = el('td', cls || '', Array.isArray(children) ? children : [children]);
    c.setAttribute('data-label', label);
    return c;
  }

  function renderIssues() {
    var box = $('issues-table');
    var stats = $('lang-stats');
    clear(box);
    clear(stats);
    if (ui.resultError) { box.appendChild(el('p', 'error-text', [ui.resultError])); return; }
    if (!ui.result) { box.appendChild(el('p', 'hint', ['先在「文件与设置」导入至少一份语言文件并选好源语言。'])); return; }
    var res = ui.result;
    var srows = res.stats.langs.map(function (s) {
      return el('tr', '', [
        td('语言', [el('span', 'key', [s.lang]), s.isSource ? el('span', 'tag tag--source', ['源']) : null]),
        td('键数', String(s.keys), 'num'),
        td('覆盖率', pct(s.coverage), 'num'),
        td('未译率', s.isSource ? '-' : pct(s.untranslatedRate), 'num'),
        td('缺键', String(s.missing), 'num'),
        td('多键', String(s.extra), 'num'),
        td('空值', String(s.empty), 'num'),
        td('阻断', String(s.blockers), 'num'),
        td('警告', String(s.warnings), 'num')
      ]);
    });
    stats.appendChild(stackTable([
      { label: '语言' }, { label: '键数', num: true }, { label: '覆盖率', num: true }, { label: '未译率', num: true },
      { label: '缺键', num: true }, { label: '多键', num: true }, { label: '空值', num: true }, { label: '阻断', num: true }, { label: '警告', num: true }
    ], srows));

    var fl = $('f-level').value, fg = $('f-lang').value, ft = $('f-type').value;
    var list = res.issues.filter(function (i) {
      return (!fl || i.level === fl) && (!fg || i.lang === fg) && (!ft || i.type === ft);
    });
    $('issues-title').textContent = '问题列表(' + list.length + ' 条)';
    if (list.length === 0) {
      box.appendChild(el('p', 'hint', [res.issues.length === 0 ? '没有发现问题。' : '当前筛选下没有问题。']));
      return;
    }
    var shown = list.slice(0, ui.issueLimit);
    var rows = shown.map(function (i) {
      return el('tr', '', [
        td('级别', [tagFor(i.level)]),
        td('语言', i.lang),
        td('键', [el('span', 'key', [i.key || '(整个文件)'])]),
        td('类型', C.TYPE_LABELS[i.type]),
        td('说明', i.message)
      ]);
    });
    box.appendChild(stackTable([{ label: '级别' }, { label: '语言' }, { label: '键' }, { label: '类型' }, { label: '说明' }], rows));
    if (list.length > shown.length) {
      box.appendChild(btn('显示更多(还有 ' + (list.length - shown.length) + ' 条)', 'btn--secondary', function () { ui.issueLimit += PAGE; renderIssues(); }));
    }
  }

  function renderMatrix() {
    var box = $('matrix-table');
    clear(box);
    if (!ui.result) { box.appendChild(el('p', 'hint', ['导入文件并选好源语言后,这里按键和语言列出所有译文。'])); return; }
    var langs = [state.source].concat(state.files.map(function (f) { return f.lang; }).filter(function (l) { return l !== state.source; }));
    var maps = new Map();
    state.files.forEach(function (f) { maps.set(f.lang, new Map(f.entries)); });
    var worst = new Map();
    ui.result.issues.forEach(function (i) {
      var k = i.lang + '\u0000' + i.key;
      if (worst.get(k) !== 'block') worst.set(k, i.level);
    });
    var keys = [];
    var seen = new Set();
    langs.forEach(function (l) {
      state.files.filter(function (f) { return f.lang === l; })[0].entries.forEach(function (e) {
        if (!seen.has(e[0])) { seen.add(e[0]); keys.push(e[0]); }
      });
    });
    var only = $('m-only-issues').checked;
    var q = $('m-filter').value.trim().toLowerCase();
    keys = keys.filter(function (k) {
      if (q && k.toLowerCase().indexOf(q) < 0) return false;
      if (only) return langs.some(function (l) { return worst.has(l + '\u0000' + k); });
      return true;
    });
    if (keys.length === 0) { box.appendChild(el('p', 'hint', ['没有符合条件的键。'])); return; }
    var shown = keys.slice(0, ui.matrixLimit);
    var rows = shown.map(function (k) {
      var cells = [td('键', [el('span', 'key', [k])], 'key-col')];
      langs.forEach(function (l) {
        var v = maps.get(l).get(k);
        var lv = worst.get(l + '\u0000' + k);
        var cls = 'cell' + (lv ? ' cell--' + lv : '') + (v === undefined ? ' cell--missing' : '');
        var content = v === undefined ? el('span', '', ['缺键']) : el('span', 'value', [v === '' ? '(空)' : v]);
        cells.push(td(l, [content], cls));
      });
      return el('tr', '', cells);
    });
    var headers = [{ label: '键' }].concat(langs.map(function (l) { return { label: l + (l === state.source ? '(源)' : '') }; }));
    box.appendChild(stackTable(headers, rows));
    if (keys.length > shown.length) {
      box.appendChild(btn('显示更多(还有 ' + (keys.length - shown.length) + ' 个键)', 'btn--secondary', function () { ui.matrixLimit += PAGE; renderMatrix(); }));
    }
  }

  function todoOptions() {
    return { allowSame: state.options.allowSame, keyPattern: state.options.keyPattern, includeSame: $('todo-same').checked };
  }

  function renderExport() {
    var has = !!ui.result;
    ['btn-report-md', 'btn-report-csv'].forEach(function (id) { $(id).disabled = !has; });
    var info = $('todo-info');
    var todoBtn = $('btn-todo');
    if (!has) {
      info.textContent = '先导入文件并选好源语言。';
      todoBtn.disabled = true;
    } else {
      var t = C.todoTable(state.files, state.source, todoOptions());
      info.textContent = t.rows ? '当前有 ' + t.rows + ' 个键需要翻译。' : '没有需要翻译的键。';
      todoBtn.disabled = t.rows === 0;
    }
    $('btn-merge-preview').disabled = !has;
    var box = $('json-buttons');
    clear(box);
    if (state.files.length === 0) box.appendChild(el('p', 'hint', ['还没有文件。']));
    state.files.forEach(function (f) {
      box.appendChild(btn('下载 ' + f.lang + '.json', 'btn--secondary', function () {
        $('json-error').hidden = true;
        try { download(f.lang + '.json', C.toJson(f.entries, f.nested), 'application/json'); }
        catch (e) { $('json-error').textContent = f.lang + ' 无法按嵌套结构导出:' + e.message + '。请检查该文件的键是否互相冲突。'; $('json-error').hidden = false; }
      }));
    });
    renderMergePreview();
  }

  function renderMergePreview() {
    var box = $('merge-preview');
    clear(box);
    var mp = ui.mergePreview;
    box.hidden = !mp;
    if (!mp) return;
    var s = mp.merged.summary;
    box.appendChild(el('h3', '', ['合并预览']));
    box.appendChild(el('p', '', ['将填入 ' + s.filled + ' 个空值或缺键' + (mp.overwrite ? ',覆盖 ' + s.overwritten + ' 个已有值(' + s.unchanged + ' 个与现有值相同)' : ',保留 ' + s.keptExisting + ' 个已有值不动') + '。']));
    if (s.changes.length) {
      var shown = s.changes.slice(0, 10).map(function (c) { return c.lang + ' / ' + c.key + (c.kind === 'overwrite' ? '(覆盖)' : ''); });
      box.appendChild(el('p', 'hint', ['前 ' + shown.length + ' 项:' + shown.join(';')]));
    }
    var apply = btn('应用合并', 'btn--primary', function () {
      if ($('merge-text').value !== mp.text || $('merge-overwrite').checked !== mp.overwrite) {
        ui.mergePreview = null; renderMergePreview();
        $('merge-error').textContent = '合并内容或选项在预览后有改动,预览已作废,请重新预览。';
        $('merge-error').hidden = false;
        return;
      }
      state.files = mp.merged.files;
      commit('已合并:填入 ' + s.filled + ' 项' + (mp.overwrite ? ',覆盖 ' + s.overwritten + ' 项' : ''));
      $('merge-text').value = '';
    });
    apply.disabled = s.filled + s.overwritten === 0;
    box.appendChild(el('div', 'row', [apply, btn('放弃', 'btn--secondary', function () { ui.mergePreview = null; renderMergePreview(); })]));
  }

  /* ---------- 下载 ---------- */
  function download(name, text, mime, bom) {
    var blob = new Blob([(bom ? '﻿' : '') + text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---------- 添加文件 ---------- */
  function showAddError(msg) {
    var e = $('add-error');
    e.textContent = msg;
    e.hidden = !msg;
  }
  function tryAdd(newFiles) {
    var existing = new Set(state.files.map(function (f) { return f.lang.toLowerCase(); }));
    var dup = newFiles.filter(function (f) { return existing.has(f.lang.toLowerCase()); });
    if (dup.length) return '语言 ' + dup.map(function (f) { return f.lang; }).join('、') + ' 已存在,请先移除旧文件再添加。整份未导入。';
    var seen = new Set();
    for (var i = 0; i < newFiles.length; i++) {
      var l = newFiles[i].lang.toLowerCase();
      if (seen.has(l)) return '这批文件里语言 ' + newFiles[i].lang + ' 出现了两次。整份未导入。';
      seen.add(l);
    }
    state.files = state.files.concat(newFiles);
    if (!state.source) state.source = newFiles[0].lang;
    return '';
  }
  function addFromPaste() {
    showAddError('');
    var text = $('paste-text').value;
    var lang = $('paste-lang').value.trim();
    var files;
    try { files = C.importText(text, lang, ''); }
    catch (e) { showAddError('导入被拒绝:' + e.message); return; }
    var err = tryAdd(files);
    if (err) { showAddError(err); return; }
    $('paste-text').value = '';
    $('paste-lang').value = '';
    commit('已添加 ' + files.map(function (f) { return f.lang; }).join('、') + '(' + files.map(function (f) { return f.entries.length; }).join('/') + ' 个键)');
  }
  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result)); };
      r.onerror = function () { reject(new Error('读取文件失败')); };
      r.readAsText(file);
    });
  }
  function addFromFiles(fileList) {
    showAddError('');
    var picked = Array.prototype.slice.call(fileList);
    if (!picked.length) return;
    Promise.all(picked.map(function (f) { return readFile(f).then(function (t) { return { name: f.name, text: t }; }); })).then(function (items) {
      var all = [];
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var lang = C.guessLang(it.name);
        var fmt = C.detectFormat(it.text);
        if (fmt !== 'csv' && !lang) { showAddError('无法从文件名 ' + it.name + ' 判断语言,整批未导入。请改用粘贴并填写语言代码。'); return; }
        try { all = all.concat(C.importText(it.text, lang, it.name)); }
        catch (e) { showAddError('文件 ' + it.name + ' 被拒绝:' + e.message + '。整批未导入。'); return; }
      }
      var err = tryAdd(all);
      if (err) { showAddError(err); return; }
      commit('已添加 ' + all.map(function (f) { return f.lang; }).join('、'));
    }).catch(function (e) { showAddError(e.message); });
  }

  /* ---------- 替换确认(示例 / 备份导入会覆盖现有数据时) ---------- */
  /* 用户数据 = 已保存的文件 + 偏离默认值的设置 + 未提交的粘贴 / 合并草稿 */
  function userDataParts() {
    var parts = [];
    if (state.files.length) parts.push(state.files.length + ' 份语言文件(' + state.files.reduce(function (a, f) { return a + f.entries.length; }, 0) + ' 个键)');
    if (C.hasCustomOptions(state.options)) parts.push('已修改的核对设置(允许相同的键 / 键名约定)');
    if ($('paste-text').value.trim() !== '' || $('paste-lang').value.trim() !== '') parts.push('「添加语言文件」里未提交的粘贴草稿');
    if ($('merge-text').value.trim() !== '') parts.push('「合并译完的表」里未应用的 CSV 草稿');
    return parts;
  }
  function askReplace(what, fn) {
    var parts = userDataParts();
    if (parts.length === 0) { fn(); return; }
    ui.pendingReplace = fn;
    $('replace-title').textContent = what + '会替换当前的 ' + parts.join('、') + ',此操作不能撤销。';
    $('replace-confirm').hidden = false;
  }
  function closeReplace() { ui.pendingReplace = null; $('replace-confirm').hidden = true; }

  function loadSample() {
    askReplace('载入示例', function () {
      state = globalThis.I18N_SAMPLE.build();
      $('paste-text').value = ''; $('paste-lang').value = ''; $('merge-text').value = '';
      syncOptionInputs();
      ui.view = 'issues';
      commit('已载入合成示例:虚构产品「星图笔记」的 zh / en / ja 文案,问题均为人为埋入');
    });
  }

  /* ---------- 设置 ---------- */
  function syncOptionInputs() {
    $('opt-allow-same').value = state.options.allowSame.join('\n');
    $('opt-key-pattern').value = state.options.keyPattern;
    $('opt-error').hidden = true;
  }

  /* ---------- 事件 ---------- */
  function init() {
    syncOptionInputs();
    if (loadNote) flash(loadNote, true);

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.addEventListener('click', function () { ui.view = t.getAttribute('data-view'); render(); });
    });
    $('btn-sample').addEventListener('click', loadSample);
    $('btn-sample-2').addEventListener('click', loadSample);
    $('btn-replace-yes').addEventListener('click', function () { var fn = ui.pendingReplace; closeReplace(); if (fn) fn(); });
    $('btn-replace-no').addEventListener('click', closeReplace);
    [['btn-pick-backup', 'file-backup'], ['btn-pick-add', 'file-add'], ['btn-pick-merge', 'file-merge']].forEach(function (p) {
      $(p[0]).addEventListener('click', function () { $(p[1]).click(); });
    });

    $('btn-clear').addEventListener('click', function () { $('clear-confirm').hidden = false; });
    $('btn-clear-no').addEventListener('click', function () { $('clear-confirm').hidden = true; });
    $('btn-clear-yes').addEventListener('click', function () {
      $('clear-confirm').hidden = true;
      state = C.emptyState();
      syncOptionInputs();
      ui.view = 'files';
      commit('已清空');
    });

    function exportBackup() { download('i18n-keys-backup.json', JSON.stringify(state, null, 2), 'application/json'); }
    $('btn-backup').addEventListener('click', exportBackup);
    $('btn-save-warning-export').addEventListener('click', exportBackup);
    $('file-backup').addEventListener('change', function (ev) {
      var f = ev.target.files[0];
      ev.target.value = '';
      if (!f) return;
      readFile(f).then(function (text) {
        var parsed;
        try { parsed = JSON.parse(text); } catch (e) { flash('备份导入被拒绝:不是有效的 JSON。', true); return; }
        var v = C.validateState(parsed);
        if (!v.ok) { flash('备份导入被拒绝:' + v.error, true); return; }
        askReplace('导入备份', function () {
          state = v.data;
          $('paste-text').value = ''; $('paste-lang').value = ''; $('merge-text').value = '';
          syncOptionInputs();
          commit('已导入备份(' + state.files.length + ' 份语言文件)');
        });
      });
    });

    $('btn-add-paste').addEventListener('click', addFromPaste);
    $('file-add').addEventListener('change', function (ev) { var l = ev.target.files; addFromFiles(l); setTimeout(function () { ev.target.value = ''; }, 0); });

    $('opt-allow-same').addEventListener('input', function () {
      state.options.allowSame = $('opt-allow-same').value.split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean);
      commit();
    });
    $('opt-key-pattern').addEventListener('input', function () {
      var v = $('opt-key-pattern').value;
      var err = $('opt-error');
      if (v !== '') {
        try { new RegExp(v); } catch (e) { err.textContent = '正则无效,保持上一个有效设置:' + e.message; err.hidden = false; return; }
      }
      err.hidden = true;
      state.options.keyPattern = v;
      commit();
    });
    $('btn-opt-reset').addEventListener('click', function () {
      state.options = { allowSame: [], keyPattern: C.DEFAULT_KEY_PATTERN };
      syncOptionInputs();
      commit('已恢复默认设置');
    });

    ['f-level', 'f-lang', 'f-type'].forEach(function (id) {
      $(id).addEventListener('change', function () { ui.issueLimit = PAGE; renderIssues(); });
    });
    $('m-only-issues').addEventListener('change', function () { ui.matrixLimit = PAGE; renderMatrix(); });
    $('m-filter').addEventListener('input', function () { ui.matrixLimit = PAGE; renderMatrix(); });

    $('btn-report-md').addEventListener('click', function () { if (ui.result) download('i18n-report.md', C.reportToMarkdown(ui.result), 'text/markdown'); });
    $('btn-report-csv').addEventListener('click', function () { if (ui.result) download('i18n-report.csv', C.reportToCsv(ui.result), 'text/csv', true); });
    $('todo-same').addEventListener('change', renderExport);
    $('btn-todo').addEventListener('click', function () {
      if (!ui.result) return;
      var t = C.todoTable(state.files, state.source, todoOptions());
      if (t.rows) download('i18n-todo.csv', t.csv, 'text/csv', true);
    });

    $('file-merge').addEventListener('change', function (ev) {
      var f = ev.target.files[0];
      ev.target.value = '';
      ui.mergePreview = null;
      $('merge-error').hidden = true;
      renderMergePreview();
      if (f) readFile(f).then(function (t) { $('merge-text').value = t; ui.mergePreview = null; renderMergePreview(); });
    });
    function dropPreview() { if (ui.mergePreview) { ui.mergePreview = null; renderMergePreview(); } }
    $('merge-text').addEventListener('input', dropPreview);
    $('merge-overwrite').addEventListener('change', dropPreview);
    $('btn-merge-preview').addEventListener('click', function () {
      var err = $('merge-error');
      err.hidden = true;
      ui.mergePreview = null;
      try {
        var overwrite = $('merge-overwrite').checked;
        ui.mergePreview = { merged: C.merge(state.files, $('merge-text').value, { overwrite: overwrite }), overwrite: overwrite, text: $('merge-text').value };
      } catch (e) {
        err.textContent = '合并被拒绝:' + e.message;
        err.hidden = false;
      }
      renderMergePreview();
    });

    render();
  }

  init();
})();
