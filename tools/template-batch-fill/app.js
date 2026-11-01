'use strict';
(function () {
  var Core = globalThis.TplFillCore;
  var KEY = 'tplfill.v1';
  var $ = function (id) { return document.getElementById(id); };
  var state = { template: '', data: '', filePattern: Core.DEFAULT_FILE_PATTERN, separator: Core.DEFAULT_SEPARATOR, sample: false };
  var current = 0;
  var pendingImport = null;
  var pendingAction = null;
  var focusId = null;
  var last = null; // 最近一次 renderAll 结果,界面与导出共用同一份
  var recovery = { raw: null, errors: [], archiveKey: '', archiveReady: false, storageReadFailed: false };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  /* ---------- 存储 ---------- */
  function snapshot() { return { version: 1, sample: state.sample, template: state.template, data: state.data, filePattern: state.filePattern, separator: state.separator }; }
  function warn(msg) { $('save-warning-text').textContent = msg; $('save-warning').hidden = !msg; }
  function showRecovery(msg) {
    $('recovery-warning-text').textContent = msg;
    $('recovery-warning').hidden = !msg;
    $('btn-raw-download').hidden = recovery.raw === null;
  }
  function recoveryJson() {
    var out = snapshot();
    out.recoveryScope = ['template', 'data', 'filePattern', 'separator', 'sample'];
    out.recoveryNote = '只包含当前页面内存里的模板、数据和输出设置;不包含损坏存档原文。';
    return JSON.stringify(out, null, 2);
  }
  function archiveCorruptRaw() {
    if (recovery.raw === null) return true;
    try {
      if (recovery.archiveKey) {
        var prior = localStorage.getItem(recovery.archiveKey);
        if (prior === recovery.raw) { recovery.archiveReady = true; return true; }
        recovery.archiveReady = false;
        if (prior !== null) recovery.archiveKey = '';
      }
      if (!recovery.archiveKey) {
        var base = KEY + '.corrupt.' + new Date().toISOString().replace(/[:.]/g, '-');
        var candidate = base, suffix = 1;
        while (localStorage.getItem(candidate) !== null) candidate = base + '-' + suffix++;
        recovery.archiveKey = candidate;
      }
      localStorage.setItem(recovery.archiveKey, recovery.raw);
      if (localStorage.getItem(recovery.archiveKey) !== recovery.raw) throw new Error('archive read-back mismatch');
      recovery.archiveReady = true;
      showRecovery('检测到旧存档损坏。旧存档原文已逐字归档并读回核对;当前页面使用空白的有效状态。你仍可下载原文。');
      return true;
    } catch (e) {
      showRecovery('检测到旧存档损坏,但浏览器没有完成逐字归档和读回核对。旧存档主键没有改动;当前修改只在内存里。请下载损坏存档原文和当前内存 JSON。');
      return false;
    }
  }
  function save() {
    var v = Core.validateImport(snapshot());
    if (!v.ok) { warn('未保存:' + v.errors.join(';') + '。刷新后会回到上次保存的内容,请缩短内容或先导出备份 JSON。'); return false; }
    if (recovery.storageReadFailed) {
      warn('未保存:本次页面没有安全读取到旧主键,所以不会写入或清除浏览器存储。当前有效内容只在内存里;请导出当前内存 JSON 后刷新页面再试。');
      return false;
    }
    if (!archiveCorruptRaw()) { warn('未保存:损坏旧存档尚未安全归档。当前有效内容只在内存里;刷新会丢失。'); return false; }
    try { localStorage.setItem(KEY, JSON.stringify(snapshot())); }
    catch (e) { warn('未保存:浏览器拒绝写入本地存储。当前有效内容只在内存里,刷新会丢失。请导出当前内存 JSON。'); return false; }
    warn('');
    return true;
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw === null) return;
      var v = Core.validateImport(raw);
      if (!v.ok) {
        recovery.raw = raw; recovery.errors = v.errors.slice();
        showRecovery('检测到旧存档损坏(' + v.errors.join(';') + ')。当前页面没有载入任何字段,也不会直接覆盖旧存档。请先下载损坏存档原文。');
        return;
      }
      state.template = v.value.template; state.data = v.value.data;
      state.filePattern = v.value.filePattern; state.separator = v.value.separator; state.sample = v.value.sample;
    } catch (e) {
      recovery.storageReadFailed = true;
      showRecovery('浏览器拒绝读取本地存储。当前页面使用空白状态;任何修改都只在内存里,不能称为已保存。你可以导出当前内存 JSON。');
    }
  }
  var flashTimer = null;
  function flash(msg) {
    var f = $('flash'); f.textContent = msg; f.hidden = false;
    clearTimeout(flashTimer); flashTimer = setTimeout(function () { f.hidden = true; }, 4000);
  }

  /* ---------- 渲染 ---------- */
  function recompute() {
    last = Core.renderAll(state.template, state.data, { filePattern: state.filePattern });
    if (current >= last.results.length) current = Math.max(0, last.results.length - 1);
  }

  function listInto(ul, msgs) {
    clear(ul);
    msgs.forEach(function (m) { ul.appendChild(el('li', null, m)); });
    ul.hidden = msgs.length === 0;
  }
  /* 错误同时显示在出错的输入框下方(aria-describedby 关联),顶部「检查」面板只做汇总 */
  function renderFieldErrors(r) {
    var te = r.templateErrors.map(function (e) { return e.message; });
    var de = r.dataErrors.map(function (e) { return e.message; });
    var fe = Core.fileCheckMessages(r).filter(function (m) { return m.indexOf('文件名模板') === 0 || m.indexOf('有 ') === 0; });
    [['tpl', 'err-tpl', te], ['data', 'err-data', de], ['file-pattern', 'err-file-pattern', fe]].forEach(function (x) {
      listInto($(x[1]), x[2]);
      if (x[2].length) { $(x[0]).setAttribute('aria-describedby', x[1]); $(x[0]).setAttribute('aria-invalid', String(x[0] !== 'file-pattern' || r.fileBlocked)); }
      else { $(x[0]).removeAttribute('aria-describedby'); $(x[0]).removeAttribute('aria-invalid'); }
    });
  }

  function renderChecks() {
    var p = $('check-panel'); clear(p);
    var r = last;
    var sum = Core.checkSummary(r);
    renderFieldErrors(r);
    if (sum.state === 'empty') { p.appendChild(el('p', 'status', sum.text)); return; }
    p.appendChild(el('h3', null, '检查'));
    p.appendChild(el('p', 'status ' + (sum.state === 'ok' ? 'status--ok' : sum.state === 'errors' ? 'status--bad' : ''), sum.text));
    if (r.templateErrors.length) {
      var ul = el('ul', 'issues issues--bad');
      r.templateErrors.forEach(function (e) { ul.appendChild(el('li', null, '模板 · ' + e.message)); });
      p.appendChild(ul);
    }
    if (r.dataErrors.length) {
      var ul2 = el('ul', 'issues issues--bad');
      r.dataErrors.forEach(function (e) { ul2.appendChild(el('li', null, '数据 · ' + e.message)); });
      p.appendChild(ul2);
      var colErr = r.dataErrors.filter(function (e) { return e.kind === 'cols' && e.extra > 0; });
      if (state.sample && colErr.length) {
        p.appendChild(el('p', 'status status--bad', '这是示例里预设的错误:数据第 ' + colErr[0].line + ' 行故意多了一列,用来演示报错。点下面的按钮定位到这一行,或移除多出的末尾列后继续预览和输出。'));
      }
      var br = el('div', 'btn-row');
      var firstLine = r.dataErrors[0] && r.dataErrors[0].line;
      if (firstLine) {
        var loc = el('button', 'btn btn--small', '定位到数据第 ' + firstLine + ' 行'); loc.type = 'button'; loc.id = 'btn-locate';
        loc.addEventListener('click', function () { locateData(firstLine); });
        br.appendChild(loc);
      }
      if (colErr.length) {
        var fix = el('button', 'btn btn--small btn--primary', '移除多出的末尾列并继续(第 ' + colErr.map(function (e) { return e.line; }).join('、') + ' 行)'); fix.type = 'button'; fix.id = 'btn-fix-cols';
        fix.addEventListener('click', fixExtraColumns);
        br.appendChild(fix);
      }
      if (br.childNodes.length) p.appendChild(br);
    }
    var fm = Core.fileCheckMessages(r);
    if (fm.length) {
      var ul3 = el('ul', 'issues issues--bad');
      fm.forEach(function (m) { ul3.appendChild(el('li', null, m)); });
      p.appendChild(ul3);
    }
    var d = el('p', 'status');
    var a = el('span', 'diff-line');
    a.appendChild(el('span', 'tag', '模板用到、数据里没有的字段:'));
    a.appendChild(document.createTextNode(r.diff.missingInData.length ? r.diff.missingInData.join('、') : '无'));
    var b = el('span', 'diff-line');
    b.appendChild(el('span', 'tag', '数据有、模板没用的字段:'));
    b.appendChild(document.createTextNode(r.diff.unusedInTemplate.length ? r.diff.unusedInTemplate.join('、') : '无'));
    d.appendChild(a); d.appendChild(b);
    p.appendChild(d);
    if (r.fields.length && r.headers.length) {
      var st = el('p', 'status', '本次共 ' + r.results.length + ' 条输出(数据里除表头外每行一条),未填占位符合计 ' + r.missingTotal + ' 处。');
      p.appendChild(st);
    }
  }

  function locateData(line) {
    var rg = Core.lineRange(state.data, line);
    var ta = $('data');
    ta.focus();
    if (rg) { ta.setSelectionRange(rg[0], rg[1]); }
  }
  function fixExtraColumns() {
    var r = Core.removeExtraColumns(state.data);
    if (!r.changed) { flash('没有可以自动移除的多余列。'); return; }
    state.data = r.text;
    $('data').value = state.data;
    save(); renderAll();
    flash('已移除第 ' + r.fixedLines.join('、') + ' 行表头之外多出的末尾列;数据格式按分隔符重新整理过,内容不变。');
    $('data').focus();
  }

  function renderPreview() {
    var box = $('preview'), r = last;
    clear(box);
    var res = r.results[current];
    $('pos').textContent = (r.results.length ? current + 1 : 0) + ' / ' + r.results.length;
    $('prev').disabled = current <= 0;
    $('next').disabled = current >= r.results.length - 1;
    $('next-miss').disabled = !r.results.some(function (x) { return x.missing.length; });
    var st = $('preview-status');
    if (r.templateErrors.length || r.dataErrors.length) { st.textContent = '检查未完成:' + (r.templateErrors.length ? '模板' : '数据') + '有错误,修好之后才能预览。'; st.className = 'status status--bad'; $('file-name').textContent = ''; return; }
    if (!res) { st.textContent = r.templateEmpty ? '先写模板。' : '先粘贴数据。'; st.className = 'status'; $('file-name').textContent = ''; return; }
    res.parts.forEach(function (p) {
      if (p.k === 'text' || p.k === 'val') box.appendChild(document.createTextNode(p.v));
      else {
        var s = el('span', p.k === 'miss' ? 'miss' : 'def', p.v);
        s.title = p.k === 'miss' ? '「' + p.name + '」没有值,也没有默认值' : '「' + p.name + '」为空,已用默认值';
        box.appendChild(s);
      }
    });
    if (res.missing.length) { st.textContent = '这一条有 ' + res.missing.length + ' 处未填:' + res.missing.join('、') + '(红色波浪线标出)。'; st.className = 'status status--bad'; }
    else { st.textContent = '这一条所有占位符都有值。'; st.className = 'status status--ok'; }
    $('file-name').textContent = '文件名:' + res.file + '(数据第 ' + res.line + ' 行)';
  }

  function renderList() {
    var tb = $('row-list'); clear(tb);
    last.results.forEach(function (res, i) {
      var tr = document.createElement('tr');
      if (i === current) tr.className = 'is-current';
      var td1 = el('td', null, String(i + 1));
      var td2 = el('td', null, String(res.line));
      var td3 = document.createElement('td');
      var b = el('button', 'jump', res.file); b.type = 'button';
      b.id = 'jump-' + i;
      b.addEventListener('click', function () { current = i; renderPreview(); focusId = 'jump-' + i; renderList(); });
      td3.appendChild(b);
      var td4 = el('td', res.missing.length ? 'warn' : null, res.missing.length ? res.missing.length + ' 处' : '无');
      var td5 = el('td', res.fileMissing.length ? 'warn' : null, res.fileMissing.length ? res.fileMissing.join('、') + ' 为空' : '无');
      [td1, td2, td3, td4, td5].forEach(function (t) { tr.appendChild(t); });
      tb.appendChild(tr);
    });
    if (focusId) { var fe = document.getElementById(focusId); focusId = null; if (fe) fe.focus(); }
  }

  function renderExport() {
    var r = last, hint = $('export-hint');
    var blocked = r.templateErrors.length > 0 || r.dataErrors.length > 0 || r.results.length === 0;
    $('btn-merged').disabled = blocked;
    $('btn-csv').disabled = blocked;
    $('btn-zip').disabled = blocked || r.fileBlocked;
    $('btn-json').disabled = r.templateEmpty && r.dataEmpty;
    if (r.templateErrors.length || r.dataErrors.length) { hint.textContent = '检查未完成:' + (r.templateErrors.length ? '模板' : '数据') + '有错误,输出已禁用,请先按上方「检查」修正。'; hint.className = 'status status--bad'; }
    else if (!r.results.length) { hint.textContent = '没有可输出的内容。'; hint.className = 'status'; }
    else if (r.fileBlocked) { hint.textContent = '文件名模板有错误或用到了数据里没有的字段,ZIP 已禁用(合并文本和 CSV 不受影响),请先按输入框下方的提示修正文件名模板。'; hint.className = 'status status--bad'; }
    else {
      var t = '将输出 ' + r.results.length + ' 条';
      if (r.missingTotal) t += ',其中仍有 ' + r.missingTotal + ' 处未填(会原样输出占位符)';
      if (r.fileMissingTotal) t += ';' + r.fileMissingTotal + ' 处文件名字段为空(会被省略)';
      hint.textContent = t + '。';
      hint.className = (r.missingTotal || r.fileMissingTotal) ? 'status status--bad' : 'status status--ok';
    }
  }

  function renderAll() {
    recompute();
    $('empty-guide').hidden = !(last.templateEmpty && last.dataEmpty);
    var dn = { '\t': '制表符', ',': '逗号', ';': '分号' };
    $('delim-hint').textContent = last.headers.length ? '已识别分隔符:' + dn[last.delimiter] + ',共 ' + last.headers.length + ' 个字段。' : '分隔符会自动识别(逗号、制表符、分号)。';
    $('sample-badge').hidden = !state.sample;
    renderChecks(); renderPreview(); renderList(); renderExport();
  }

  function syncInputs() {
    $('tpl').value = state.template; $('data').value = state.data;
    $('file-pattern').value = state.filePattern; $('separator').value = state.separator;
  }

  /* ---------- 下载 ---------- */
  function download(name, mime, content) {
    var blob = new Blob([content], { type: mime });
    var a = document.createElement('a');
    var url = URL.createObjectURL(blob);
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function backupJson() {
    return JSON.stringify(snapshot(), null, 2);
  }

  /* ---------- 事件 ---------- */
  function onInput(ev) {
    var changedContent = ev && ev.target && (ev.target.id === 'tpl' || ev.target.id === 'data');
    state.template = $('tpl').value; state.data = $('data').value;
    state.filePattern = $('file-pattern').value; state.separator = $('separator').value;
    if (changedContent) state.sample = false;
    save(); renderAll();
  }
  ['tpl', 'data', 'file-pattern', 'separator'].forEach(function (id) { $(id).addEventListener('input', onInput); });

  function applySample() {
    var s = globalThis.TPLFILL_SAMPLE;
    state.template = s.template; state.data = s.data; state.filePattern = s.filePattern; state.separator = s.separator; state.sample = true;
    current = 0; syncInputs();
    var ok = save(); renderAll();
    flash(ok ? '已载入合成示例(虚构的家长通知,12 行数据)。数据第 12 行是预设的错误,见「检查」。' : '已载入示例,但没有保存成功。');
  }
  function scopeNow() { return Core.replaceScope(state); }
  /* 会替换现有内容的操作先页内确认:确认前内容与存储都不变,文案列出被替换的四项 */
  function askReplace(lead, scopeText, action, backId) {
    pendingAction = { run: action, back: backId };
    $('clear-confirm').hidden = true; $('import-confirm').hidden = true;
    $('sample-lead').textContent = lead;
    $('sample-scope').textContent = scopeText;
    $('sample-confirm').hidden = false;
    $('btn-sample-no').focus();
  }
  $('load-sample').addEventListener('click', function () {
    var sc = scopeNow();
    if (sc.any) askReplace('载入合成示例会替换你现有的:', Core.describeScope(sc), applySample, 'load-sample');
    else applySample();
  });
  $('btn-sample-yes').addEventListener('click', function () { var a = pendingAction; pendingAction = null; $('sample-confirm').hidden = true; if (a) a.run(); });
  $('btn-sample-no').addEventListener('click', function () { var b = pendingAction && pendingAction.back; pendingAction = null; $('sample-confirm').hidden = true; if (b && $(b)) $(b).focus(); });
  $('btn-clear').addEventListener('click', function () {
    var sc = scopeNow();
    $('clear-scope').textContent = sc.any ? '将清空:' + Core.describeScope(sc) + '。' : '当前没有任何内容,清空不会改变什么。';
    $('sample-confirm').hidden = true; $('import-confirm').hidden = true;
    $('clear-confirm').hidden = false; $('btn-clear-no').focus();
  });
  $('btn-clear-no').addEventListener('click', function () { $('clear-confirm').hidden = true; $('btn-clear').focus(); });
  $('btn-clear-yes').addEventListener('click', function () {
    state.template = ''; state.data = ''; state.filePattern = Core.DEFAULT_FILE_PATTERN; state.separator = Core.DEFAULT_SEPARATOR; state.sample = false;
    current = 0; syncInputs(); $('clear-confirm').hidden = true;
    var ok = save(); renderAll();
    flash(ok ? '已清空。' : '已清空界面,但没有保存成功。');
    $('btn-clear').focus();
  });
  $('prev').addEventListener('click', function () { if (current > 0) { current--; renderPreview(); renderList(); } });
  $('next').addEventListener('click', function () { if (current < last.results.length - 1) { current++; renderPreview(); renderList(); } });
  $('next-miss').addEventListener('click', function () {
    var n = last.results.length;
    for (var k = 1; k <= n; k++) {
      var i = (current + k) % n;
      if (last.results[i].missing.length) { current = i; renderPreview(); renderList(); return; }
    }
  });

  $('btn-merged').addEventListener('click', function () {
    if ($('btn-merged').disabled) return;
    download((state.sample ? '合成示例-' : '') + '合并输出.txt', 'text/plain;charset=utf-8', Core.mergeTexts(last.results.map(function (x) { return x.text; }), state.separator));
    flash('已生成合并文本,共 ' + last.results.length + ' 条。');
  });
  $('btn-zip').addEventListener('click', function () {
    if ($('btn-zip').disabled) return;
    var zip = Core.makeZip(last.results.map(function (x) { return { name: x.file, content: x.text }; }));
    download((state.sample ? '合成示例-' : '') + '批量输出.zip', 'application/zip', zip);
    flash('已生成 zip,共 ' + last.results.length + ' 个文件(无压缩)。');
  });
  $('btn-csv').addEventListener('click', function () {
    if ($('btn-csv').disabled) return;
    download('渲染结果.csv', 'text/csv;charset=utf-8', Core.toCsv(last.headers, last.results, { sample: state.sample }));
    flash('已导出结果 CSV。以 = + - @ 开头的内容已加单引号前缀防公式注入。');
  });
  function exportJson() { download('模板批量填充-备份.json', 'application/json', backupJson()); flash('已导出备份 JSON。'); }
  $('btn-json').addEventListener('click', exportJson);
  $('btn-warn-export').addEventListener('click', exportJson);
  $('btn-recovery-export').addEventListener('click', function () {
    download('模板批量填充-当前内存恢复.json', 'application/json', recoveryJson());
    flash('已导出当前内存里的模板、数据和输出设置;文件不包含损坏存档原文。');
  });
  $('btn-raw-download').addEventListener('click', function () {
    if (recovery.raw === null) return;
    download('tplfill-v1-损坏存档原文.txt', 'text/plain;charset=utf-8', recovery.raw);
    flash('已下载损坏存档原文。');
  });

  /* 导入备份:校验 → 预览(模板字数、数据行数、将替换什么) → 确认 → 写入 */
  $('btn-import').addEventListener('click', function () { $('import-file').click(); });
  $('btn-import-2').addEventListener('click', function () { $('import-file').click(); });
  $('import-file').addEventListener('change', function (ev) {
    var f = ev.target.files && ev.target.files[0], msg = $('import-msg');
    ev.target.value = '';
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      var v = Core.validateImport(String(rd.result));
      if (!v.ok) { pendingImport = null; $('import-confirm').hidden = true; msg.textContent = '导入被拒绝,当前内容没有改动。原因:' + v.errors.join(';'); msg.className = 'status status--bad'; return; }
      msg.textContent = '';
      pendingImport = v.value;
      var inc = Core.replaceScope(v.value), sc = scopeNow();
      $('import-scope').textContent = '文件「' + f.name + '」里有模板(' + inc.templateChars + ' 个字符)、数据 ' + inc.dataRows + ' 行' + (v.value.sample ? '(文件标注为合成示例)' : '') + '。确认后会替换' + (sc.any ? '你现有的:' + Core.describeScope(sc) : '当前的空白状态') + '。确认前现有内容不变。';
      $('sample-confirm').hidden = true; $('clear-confirm').hidden = true;
      $('import-confirm').hidden = false;
      $('btn-import-no').focus();
    };
    rd.onerror = function () { msg.textContent = '读取文件失败,当前内容没有改动。'; msg.className = 'status status--bad'; };
    rd.readAsText(f);
  });
  $('btn-import-yes').addEventListener('click', function () {
    var v = pendingImport; pendingImport = null; $('import-confirm').hidden = true;
    if (!v) return;
    state.template = v.template; state.data = v.data; state.filePattern = v.filePattern; state.separator = v.separator; state.sample = v.sample;
    current = 0; syncInputs(); var ok = save(); renderAll();
    var msg = $('import-msg');
    msg.textContent = ok ? '已导入备份。' : '已导入,但没有保存成功。'; msg.className = ok ? 'status status--ok' : 'status status--bad';
    $('btn-import').focus();
  });
  $('btn-import-no').addEventListener('click', function () { pendingImport = null; $('import-confirm').hidden = true; $('btn-import').focus(); });

  load(); syncInputs(); renderAll();
})();
