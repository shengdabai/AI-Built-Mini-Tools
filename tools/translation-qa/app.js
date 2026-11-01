'use strict';
(function () {
  var Core = globalThis.TransCheckCore;
  var STORAGE_KEY = 'transcheck.v1';
  var $ = function (id) { return document.getElementById(id); };

  function defaults() {
    return { mode: 'table', tableText: '', srcText: '', tgtText: '', glossaryText: '', caseSensitive: false,
      ratioHigh: String(Core.DEFAULTS.ratioHigh), ratioLow: String(Core.DEFAULTS.ratioLow) };
  }

  /* 读取本地数据并校验:类型或枚举不合法就整份丢弃并明说,不静默修正 */
  var validState = Core.validState;

  var state = defaults();
  var loadNote = '';
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      var parsed = JSON.parse(raw);
      if (validState(parsed)) state = parsed;
      else loadNote = '本地保存的数据格式不对,已整份忽略,当前是空白状态。';
    }
  } catch (e) { loadNote = '读取本地保存的数据失败,当前是空白状态。'; }

  var result = null; /* { pairs, issues, stats, sig, alignNote, sample } */
  var runErrors = [];
  var pendingAction = null;
  function isSampleNow() { return state.mode === 'table' && state.tableText !== '' && state.tableText === globalThis.TRANSCHECK_SAMPLE.tableText; }

  function sig() { return JSON.stringify(state); }

  /* 返回是否真正写入;失败时显示持续可见的「未保存」提示 */
  function save() {
    var w = $('save-warning');
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      w.hidden = true;
      return true;
    } catch (e) {
      w.hidden = false;
      return false;
    }
  }

  var flashTimer = null;
  function flash(msg, kind) {
    var f = $('flash');
    f.textContent = msg;
    f.className = 'notice' + (kind ? ' notice--' + kind : '');
    f.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { f.hidden = true; }, 6000);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function download(name, mime, text) {
    var blob = new Blob([(mime === 'text/csv' ? '\uFEFF' : '') + text], { type: mime + ';charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* ---------- 表单 <-> 状态 ---------- */
  function fillForm() {
    $('mode-table').checked = state.mode === 'table';
    $('mode-two').checked = state.mode === 'two';
    $('table-text').value = state.tableText;
    $('src-text').value = state.srcText;
    $('tgt-text').value = state.tgtText;
    $('glossary-text').value = state.glossaryText;
    $('opt-case').checked = state.caseSensitive;
    $('opt-hi').value = state.ratioHigh;
    $('opt-lo').value = state.ratioLow;
    applyMode();
  }

  function applyMode() {
    $('pane-table').hidden = state.mode !== 'table';
    $('pane-two').hidden = state.mode !== 'two';
  }

  function hasInput() {
    return state.tableText.trim() !== '' || state.srcText.trim() !== '' || state.tgtText.trim() !== '' || state.glossaryText.trim() !== '';
  }

  function onInput() {
    state.mode = $('mode-two').checked ? 'two' : 'table';
    state.tableText = $('table-text').value;
    state.srcText = $('src-text').value;
    state.tgtText = $('tgt-text').value;
    state.glossaryText = $('glossary-text').value;
    state.caseSensitive = $('opt-case').checked;
    state.ratioHigh = $('opt-hi').value;
    state.ratioLow = $('opt-lo').value;
    applyMode();
    save();
    refreshState();
  }

  /* ---------- 检查 ---------- */
  var FIELD_IDS = { table: 'table-text', src: 'src-text', glossary: 'glossary-text', ratioHigh: 'opt-hi', ratioLow: 'opt-lo', file: 'btn-file' };
  /* 错误贴近出错的输入框(aria-describedby 关联),可选聚焦第一个出错控件;顶部一句话只做补充 */
  function showErrors(errs, focusFirst) {
    runErrors = errs;
    Object.keys(FIELD_IDS).forEach(function (k) {
      var er = $('err-' + k), ctl = $(FIELD_IDS[k]);
      er.hidden = true; er.textContent = '';
      ctl.removeAttribute('aria-describedby'); ctl.removeAttribute('aria-invalid');
    });
    var first = null;
    errs.forEach(function (e) {
      var er = $('err-' + e.field), ctl = $(FIELD_IDS[e.field]);
      er.textContent = (er.textContent ? er.textContent + ' ' : '') + e.message; er.hidden = false;
      ctl.setAttribute('aria-describedby', 'err-' + e.field); ctl.setAttribute('aria-invalid', 'true');
      if (!first) first = ctl;
    });
    var box = $('input-error');
    if (errs.length) {
      box.textContent = '检查未运行:' + errs.length + ' 处错误,见标红的输入框。' + errs.map(function (e) { return e.message; }).join(' ');
      box.hidden = false;
    } else { box.hidden = true; box.textContent = ''; }
    if (focusFirst && first) first.focus();
    if (result) renderVerdict();
  }
  function renderVerdict() {
    var v = Core.checkVerdict(result, runErrors);
    var n = $('verdict');
    n.textContent = v.text;
    n.className = 'verdict verdict--' + v.state;
  }

  function runCheck() {
    var prep = Core.prepareRun(state);
    if (!prep.ok) { showErrors(prep.errors, true); return; }
    showErrors([], false);
    var r = Core.check(prep.pairs, prep.glossary, prep.options);
    result = { pairs: prep.pairs, issues: r.issues, stats: r.stats, sig: sig(), alignNote: prep.alignNote, sample: isSampleNow() };
    $('filter').value = 'issues';
    refreshState();
    flash('检查完成:' + r.stats.segments + ' 段,阻断 ' + r.stats.blocking + ' 条,警告 ' + r.stats.warnings + ' 条。', r.stats.blocking ? 'warn' : 'ok');
  }

  /* ---------- 渲染 ---------- */
  function isFresh() { return !!result && result.sig === sig(); }

  function refreshState() {
    $('sample-badge').hidden = !isSampleNow();
    $('empty-guide').hidden = hasInput() || !!result;
    var res = $('results');
    res.hidden = !result;
    if (!result) return;
    var fresh = isFresh();
    res.classList.toggle('is-stale', !fresh);
    $('stale-note').hidden = fresh;
    ['export-issues-csv', 'export-issues-md', 'export-annotated'].forEach(function (id) { $(id).disabled = !fresh; });
    $('export-hint').textContent = fresh ? '' : '导出已禁用:当前结果和输入不一致,重新运行检查后才能导出。';
    $('btn-warn-export').disabled = !fresh;
    renderAlign();
    renderStats();
    renderRows();
    renderVerdict();
  }

  function renderAlign() {
    var n = $('align-note');
    n.hidden = !result.alignNote;
    n.textContent = result.alignNote ? '行数差异:' + result.alignNote : '';
  }

  function renderStats() {
    var s = result.stats, box = $('stats');
    box.textContent = '';
    [
      ['segments', '段数', ''], ['missing', '漏译数', 'block'], ['glossary', '术语不一致数', 'warn'],
      ['placeholder', '占位符问题数', 'block'], ['number', '数字不一致数', 'block'],
      ['blocking', '阻断合计', 'block'], ['warnings', '警告合计', 'warn']
    ].forEach(function (d) {
      var c = el('div', 'stat' + (d[2] ? ' stat--' + d[2] : ''));
      c.setAttribute('data-stat', d[0]);
      c.appendChild(el('div', 'stat__value', String(s[d[0]])));
      c.appendChild(el('div', 'stat__label', d[1]));
      box.appendChild(c);
    });
  }

  function cell(label, text, tgt) {
    var c = el('div', 'cell' + (tgt ? ' cell--tgt' : ''));
    c.appendChild(el('div', 'cell__label', label));
    var empty = text.trim() === '';
    c.appendChild(el('div', 'cell__text' + (empty ? ' cell__text--empty' : ''), empty ? '(空)' : text));
    return c;
  }

  function renderRows() {
    var box = $('rows'), mode = $('filter').value;
    box.textContent = '';
    var by = new Map();
    result.issues.forEach(function (x) {
      if (!by.has(x.n)) by.set(x.n, []);
      by.get(x.n).push(x);
    });
    var shown = 0;
    result.pairs.forEach(function (p) {
      var list = by.get(p.n) || [];
      var hasBlock = list.some(function (x) { return x.level === 'block'; });
      if (mode === 'issues' && !list.length) return;
      if (mode === 'block' && !hasBlock) return;
      shown++;
      var seg = el('article', 'seg' + (hasBlock ? ' seg--block' : list.length ? ' seg--warn' : ''));
      seg.setAttribute('data-n', p.n);
      seg.appendChild(el('h3', 'seg__head', '第 ' + p.n + ' 段'));
      var cols = el('div', 'seg__cols');
      cols.appendChild(cell('原文', p.src, false));
      cols.appendChild(cell('译文', p.tgt, true));
      seg.appendChild(cols);
      if (list.length) {
        var ul = el('ul', 'issues');
        list.forEach(function (x) {
          var li = el('li', 'issue');
          li.appendChild(el('span', 'badge badge--' + x.level, Core.LEVEL_LABEL[x.level] + ' · ' + Core.TYPE_LABEL[x.type]));
          li.appendChild(el('span', 'issue__msg', x.message));
          ul.appendChild(li);
        });
        seg.appendChild(ul);
      } else {
        seg.appendChild(el('p', 'hint', '没有发现问题。'));
      }
      box.appendChild(seg);
    });
    if (!shown) box.appendChild(el('p', 'notice notice--ok', mode === 'all' ? '没有段落。' : '这个筛选条件下没有问题段落(共检查 ' + result.pairs.length + ' 段;筛选条件:' + (mode === 'block' ? '只看有阻断问题的段落' : '只看有问题的段落') + ')。'));
  }

  /* ---------- 导出(只在结果与输入一致时可用) ---------- */
  function guardExport(fn) {
    return function () {
      if (!isFresh()) { flash('当前结果已过期,请先重新运行检查。', 'warn'); return; }
      fn();
    };
  }

  /* ---------- 事件 ---------- */
  function scopeNow() { return Core.replaceScope(state, !!result); }
  /* 会替换现有内容的操作先页内确认:确认前状态保持原样,文案写明被替换的范围 */
  function askReplace(lead, scopeText, action, backId) {
    pendingAction = { run: action, back: backId };
    $('clear-confirm').hidden = true;
    $('sample-lead').textContent = lead;
    $('sample-scope').textContent = scopeText;
    $('sample-confirm').hidden = false;
    $('btn-sample-no').focus();
  }
  function requestSample() {
    var sc = scopeNow();
    if (sc.any) { askReplace('载入合成示例会替换你现有的:', Core.describeScope(sc), loadSample, document.activeElement && document.activeElement.id ? document.activeElement.id : 'load-sample'); return; }
    loadSample();
  }

  function loadSample() {
    $('sample-confirm').hidden = true;
    var S = globalThis.TRANSCHECK_SAMPLE;
    state = defaults();
    state.tableText = S.tableText;
    state.glossaryText = S.glossaryText;
    result = null;
    fillForm();
    showErrors([], false);
    $('results').hidden = true;
    $('empty-guide').hidden = true;
    if (save()) flash('已载入' + S.label + '(20 段英译中教材,术语表 6 条)。点「运行检查」查看。', 'ok');
    refreshState();
  }

  var FIELD_OF_INPUT = { 'table-text': 'table', 'src-text': 'src', 'tgt-text': 'src', 'glossary-text': 'glossary', 'opt-hi': 'ratioHigh', 'opt-lo': 'ratioLow' };
  ['table-text', 'src-text', 'tgt-text', 'glossary-text', 'opt-hi', 'opt-lo'].forEach(function (id) {
    $(id).addEventListener('input', function () {
      /* 改动了出错的输入框:只清除这个框旁边的旧错误 */
      var f = FIELD_OF_INPUT[id];
      var related = [f];
      if (f === 'ratioHigh') related.push('ratioLow');
      if (runErrors.some(function (e) { return related.indexOf(e.field) >= 0; })) {
        showErrors(runErrors.filter(function (e) { return related.indexOf(e.field) < 0; }), false);
      }
      onInput();
    });
  });
  ['mode-table', 'mode-two', 'opt-case'].forEach(function (id) { $(id).addEventListener('change', onInput); });
  $('run-check').addEventListener('click', runCheck);
  $('filter').addEventListener('change', function () { if (result) renderRows(); });
  $('load-sample').addEventListener('click', requestSample);
  $('load-sample-2').addEventListener('click', requestSample);
  $('btn-sample-yes').addEventListener('click', function () {
    var a = pendingAction;
    pendingAction = null;
    $('sample-confirm').hidden = true;
    if (a) a.run();
  });
  $('btn-sample-no').addEventListener('click', function () {
    var back = pendingAction && pendingAction.back;
    pendingAction = null;
    $('sample-confirm').hidden = true;
    if (back && $(back)) $(back).focus();
  });

  function applyTableText(text, name, count) {
    showErrors([], false);
    $('mode-table').checked = true;
    $('table-text').value = text.replace(/^﻿/, '');
    result = null;
    onInput();
    $('results').hidden = true;
    flash('已导入文件「' + name + '」,共 ' + count + ' 段。点「运行检查」查看。', 'ok');
  }
  $('btn-file').addEventListener('click', function () { $('file-import').click(); });
  $('file-import').addEventListener('change', function (ev) {
    var f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { showErrors([{ field: 'file', message: '文件超过 5 MB,未导入。' }], true); return; }
    var rd = new FileReader();
    rd.onload = function () {
      var text = String(rd.result);
      var t = Core.parseTable(text);
      if (!t.ok) { showErrors([{ field: 'file', message: '文件被拒绝导入:' + t.error }], true); return; }
      showErrors([], false);
      /* 校验通过 → 预览段数 → (有现有双语表时)确认 → 写入 */
      var sc = Core.replaceScope({ tableText: state.tableText, glossaryText: '', srcText: '', tgtText: '', caseSensitive: false, ratioHigh: '3', ratioLow: '0.3' }, !!result);
      var act = function () { applyTableText(text, f.name, t.pairs.length); };
      if (sc.tableLines > 0 || sc.hasResult) { askReplace('文件「' + f.name + '」(' + t.pairs.length + ' 段)会替换你现有的双语表:', Core.describeScope(sc) + '(术语表和选项不受影响)', act, 'btn-file'); return; }
      act();
    };
    rd.onerror = function () { showErrors([{ field: 'file', message: '读取文件失败,未导入。' }], true); };
    rd.readAsText(f, 'utf-8');
  });

  /* JSON 备份:导出当前输入;导入走 校验 → 预览 → 确认 → 写入 */
  function backupDownload() {
    download('译稿检查-输入备份.json', 'application/json', JSON.stringify(Core.backupObject(state), null, 2));
  }
  $('btn-backup').addEventListener('click', backupDownload);
  $('btn-warn-backup').addEventListener('click', backupDownload);
  $('btn-import').addEventListener('click', function () { $('file-backup').click(); });
  $('btn-import-2').addEventListener('click', function () { $('file-backup').click(); });
  $('file-backup').addEventListener('change', function (ev) {
    var f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      var v = Core.validateBackup(String(rd.result));
      if (!v.ok) { showImportError('导入被拒绝,现有内容没有改动。原因:' + v.error); return; }
      $('import-error').hidden = true;
      var incoming = Core.replaceScope(v.state, false);
      var sc = scopeNow();
      askReplace('备份「' + f.name + '」(' + (Core.describeScope(incoming) || '空白内容') + ')会替换你现有的:', sc.any ? Core.describeScope(sc) : '当前的空白状态', function () {
        state = v.state;
        result = null;
        fillForm();
        showErrors([], false);
        if (save()) flash('已导入备份,点「运行检查」查看。', 'ok');
        refreshState();
        $('btn-import').focus();
      }, 'btn-import');
    };
    rd.onerror = function () { showImportError('读取文件失败,现有内容没有改动。'); };
    rd.readAsText(f, 'utf-8');
  });
  function showImportError(msg) { $('import-error').textContent = msg; $('import-error').hidden = false; }

  $('btn-clear').addEventListener('click', function () {
    var sc = scopeNow();
    $('clear-scope').textContent = sc.any ? '将清空:' + Core.describeScope(sc) + '。' : '当前没有任何内容,清空不会改变什么。';
    $('sample-confirm').hidden = true;
    $('clear-confirm').hidden = false;
    $('btn-clear-no').focus();
  });
  $('btn-clear-no').addEventListener('click', function () { $('clear-confirm').hidden = true; $('btn-clear').focus(); });
  $('btn-clear-yes').addEventListener('click', function () {
    state = defaults();
    result = null;
    fillForm();
    showErrors([], false);
    $('clear-confirm').hidden = true;
    if (save()) flash('已清空。', 'ok');
    refreshState();
    $('btn-clear').focus();
  });

  var exportAnnotated = guardExport(function () {
    download('译稿检查-带问题列双语表.csv', 'text/csv', Core.annotatedCsv(result.pairs, result.issues, { sample: result.sample }));
    flash('已导出带问题列的双语表 CSV。', 'ok');
  });
  $('export-annotated').addEventListener('click', exportAnnotated);
  $('btn-warn-export').addEventListener('click', exportAnnotated);
  $('export-issues-csv').addEventListener('click', guardExport(function () {
    download('译稿检查-问题清单.csv', 'text/csv', Core.issuesToCsv(result.issues, { sample: result.sample }));
    flash('已导出问题清单 CSV。', 'ok');
  }));
  $('export-issues-md').addEventListener('click', guardExport(function () {
    download('译稿检查-问题清单.md', 'text/markdown', Core.issuesToMarkdown(result.issues, result.stats, { pairs: result.pairs, alignNote: result.alignNote, sample: result.sample }));
    flash('已导出问题清单 Markdown。', 'ok');
  }));

  /* ---------- 启动 ---------- */
  fillForm();
  refreshState();
  if (loadNote) flash(loadNote, 'warn');
})();
