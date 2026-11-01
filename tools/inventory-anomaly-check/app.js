'use strict';
(function () {
  var C = globalThis.InventoryCore;
  var STORAGE_KEY = 'invcheck.v1';
  var state = { text: '', table: null, mapping: null, unitMapText: C.DEFAULT_UNIT_MAP_TEXT, rows: [], sample: false, currency: '' };
  var parseError = null;    // 上一次解析失败的原因,解析成功后才清除
  var focusId = null;
  var pendingAction = null;
  var dirty = false;      // 输入框内容与已解析内容不一致
  var selected = new Set();
  var result = null;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /* ---------- 存储:返回是否真正写入;失败时显示持续可见的「未保存」 ---------- */
  function save() {
    var ok = true;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { ok = false; }
    $('save-warning').hidden = ok;
    return ok;
  }
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      var s = JSON.parse(raw);
      if (!s || typeof s !== 'object' || !s.table || !Array.isArray(s.table.headers) || !Array.isArray(s.rows) || !s.mapping) return false;
      state = {
        text: typeof s.text === 'string' ? s.text : '',
        table: s.table, mapping: s.mapping,
        unitMapText: typeof s.unitMapText === 'string' ? s.unitMapText : C.DEFAULT_UNIT_MAP_TEXT,
        rows: s.rows, sample: !!s.sample,
        currency: typeof s.currency === 'string' && C.normalizeCurrency(s.currency).ok ? s.currency.trim() : ''
      };
      return true;
    } catch (e) { return false; }
  }

  var flashTimer = null;
  function flash(msg) {
    var f = $('flash');
    f.textContent = msg; f.hidden = false; f.classList.remove('notice--danger');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { f.hidden = true; }, 6000);
  }
  /* 成功提示只在真正写入后出现 */
  function commit(msg) {
    var ok = save();
    if (ok && msg) flash(msg);
    return ok;
  }

  /* ---------- 解析 / 映射 ---------- */
  /* 解析错误持续显示在输入框下方,直到下一次解析成功才清除 */
  function showParseError(msg) {
    parseError = msg;
    var box = $('parse-error');
    box.textContent = msg || '';
    box.hidden = !msg;
    if (msg) { $('src').setAttribute('aria-invalid', 'true'); $('src').focus(); }
    else $('src').removeAttribute('aria-invalid');
    if (result) renderVerdict();
  }
  function renderVerdict() {
    var v = C.checkVerdict(result, state.mapping, parseError);
    var el1 = $('verdict');
    el1.textContent = v.text;
    el1.className = 'verdict verdict--' + v.state;
  }
  function scopeNow() { return C.replaceScope(state, $('src').value !== state.text ? $('src').value : ''); }
  /* 会替换现有数据的操作先页内确认;确认文案写明会被替换的范围 */
  function askReplace(lead, scopeText, action, returnFocusId) {
    pendingAction = { run: action, back: returnFocusId };
    $('clear-confirm').hidden = true;
    $('replace-lead').textContent = lead;
    $('replace-scope').textContent = scopeText;
    $('replace-confirm').hidden = false;
    $('btn-replace-no').focus();
  }
  function parseNow() {
    var table = C.parseTable($('src').value);
    if (table.error) { showParseError('未导入,原有结果保持不变。原因:' + table.error); flash('未导入:' + table.error); $('flash').classList.add('notice--danger'); return false; }
    if (!table.headers.length) { showParseError('没有读到内容。请粘贴含表头的库存表。'); flash('没有读到内容。请粘贴含表头的库存表。'); return false; }
    showParseError(null);
    state.text = $('src').value;
    state.table = table;
    state.mapping = C.guessMapping(table.headers);
    state.rows = C.toRows(table, state.mapping);
    state.sample = false;
    selected.clear(); dirty = false;
    return true;
  }

  function renderMapping() {
    var grid = $('map-grid');
    grid.textContent = '';
    var headers = state.table ? state.table.headers : [];
    C.FIELDS.forEach(function (f) {
      var label = el('label', 'field', C.FIELD_LABELS[f] + (f === 'code' ? '(必选)' : '(可选)'));
      label.htmlFor = 'map-' + f;
      var sel = el('select');
      sel.id = 'map-' + f;
      var none = el('option', '', f === 'code' ? '请选择列' : '不使用');
      none.value = '-1';
      sel.appendChild(none);
      headers.forEach(function (h, i) {
        var o = el('option', '', h || '(第 ' + (i + 1) + ' 列无表头)');
        o.value = String(i);
        sel.appendChild(o);
      });
      sel.value = String(state.mapping && state.mapping[f] >= 0 ? state.mapping[f] : -1);
      sel.addEventListener('change', function () {
        var hadEdits = state.rows.some(function (r) { return r.edited; });
        state.mapping[f] = Number(sel.value);
        state.rows = C.toRows(state.table, state.mapping);
        selected.clear();
        commit(hadEdits ? '已重新读取原表,之前采用的公式期末已放弃。' : '');
        focusId = 'map-' + f;
        render();
      });
      label.appendChild(sel);
      grid.appendChild(label);
    });
  }

  /* ---------- 渲染 ---------- */
  var FILTER_ISSUES = 'issues', FILTER_ALL = 'all';
  function fillFilter() {
    var sel = $('filter'), cur = sel.value || FILTER_ISSUES;
    sel.textContent = '';
    function add(v, t) { var o = el('option', '', t); o.value = v; sel.appendChild(o); }
    add(FILTER_ISSUES, '有异常的行(' + result.stats.issueRows + ')');
    add(FILTER_ALL, '全部行(' + result.stats.rows + ')');
    C.RULES.forEach(function (r) { add(r.id, r.label + '(' + result.stats.byRule[r.id] + ')'); });
    sel.value = Array.prototype.some.call(sel.options, function (o) { return o.value === cur; }) ? cur : FILTER_ISSUES;
  }

  function statCard(num, label, cls) {
    var d = el('div', 'stat' + (cls ? ' stat--' + cls : ''));
    d.appendChild(el('span', 'stat__num', num));
    d.appendChild(el('span', '', label));
    return d;
  }

  function renderStats() {
    var s = result.stats, g = $('stat-grid');
    g.textContent = '';
    g.appendChild(statCard(String(s.rows), '数据行数'));
    g.appendChild(statCard(String(s.issueRows), '有异常的行', s.issueRows ? 'warn' : ''));
    g.appendChild(statCard(String(s.blocks), '阻断条数', s.blocks ? 'block' : ''));
    g.appendChild(statCard(String(s.warns), '警告条数', s.warns ? 'warn' : ''));
    g.appendChild(statCard(s.value ? C.fmt(s.value.total) : '无单价列', '库存金额(期末 × 单价,' + C.currencyLabel(state.currency) + ')'));

    var rl = $('rule-list');
    rl.textContent = '';
    C.RULES.forEach(function (r) {
      var n = s.byRule[r.id];
      var li = el('li', 'rule--' + r.level + (n ? '' : ' rule--zero'));
      var b = el('button');
      b.type = 'button';
      b.disabled = !n;
      b.appendChild(el('span', '', (r.level === 'block' ? '阻断 · ' : '警告 · ') + r.label));
      b.appendChild(el('b', '', String(n)));
      b.addEventListener('click', function () { $('filter').value = r.id; renderGrid(); $('grid').scrollIntoView({ block: 'start' }); });
      li.appendChild(b);
      rl.appendChild(li);
    });

    var tb = $('unit-table').querySelector('tbody');
    tb.textContent = '';
    s.unitTotals.forEach(function (u) {
      var tr = el('tr');
      tr.appendChild(el('td', '', u.unit));
      tr.appendChild(el('td', 'num', String(u.rows)));
      tr.appendChild(el('td', 'num', C.fmt(u.close)));
      tb.appendChild(tr);
    });
    $('value-note').textContent = s.value
      ? '金额币种:' + C.currencyLabel(state.currency) + '(单价列须统一币种)。只统计期末非负且单价有效的 ' + s.value.rows + ' 行,其余 ' + s.value.skipped + ' 行未计入。单位只归一不换算,不同单位的数量不能相加。'
      : '没有映射单价列,不计算库存金额。单位只归一不换算,不同单位的数量不能相加。';
  }

  function td(label, text, cls) {
    var c = el('td', cls || '', text);
    c.setAttribute('data-label', label);
    return c;
  }

  function renderGrid() {
    var f = $('filter').value;
    var rows = result.rows.filter(function (r) {
      if (f === FILTER_ALL) return true;
      if (f === FILTER_ISSUES) return r.issues.length > 0;
      return r.issues.some(function (i) { return i.rule === f; });
    });
    var body = $('grid-body');
    body.textContent = '';
    rows.forEach(function (r) {
      var tr = el('tr', r.level ? 'row--' + r.level : '');
      if (selected.has(r.index)) tr.classList.add('row--selected');
      var fixable = r.issues.some(function (i) { return i.rule === 'FORMULA'; }) && r.formula !== null;
      var c0 = el('td'); c0.setAttribute('data-label', '选中');
      var cbLabel = el('label', 'check-hit');
      var cb = el('input'); cb.type = 'checkbox';
      cb.checked = selected.has(r.index);
      cb.disabled = !fixable;
      cb.setAttribute('aria-label', '选中第 ' + r.line + ' 行');
      cb.addEventListener('change', function () {
        if (cb.checked) selected.add(r.index); else selected.delete(r.index);
        tr.classList.toggle('row--selected', cb.checked);
        updateSel();
      });
      cbLabel.appendChild(cb); c0.appendChild(cbLabel); tr.appendChild(c0);
      tr.appendChild(td('行号', String(r.line), 'num'));
      tr.appendChild(td('商品编码', r.code || '(空)'));
      tr.appendChild(td('商品名', r.name || ''));
      tr.appendChild(td('期初', r.open === undefined ? '' : r.open, 'num'));
      tr.appendChild(td('入库', r.in === undefined ? '' : r.in, 'num'));
      tr.appendChild(td('出库', r.out === undefined ? '' : r.out, 'num'));
      var cc = td('期末', r.close === undefined ? '' : r.close, 'num');
      if (r.edited) cc.appendChild(el('span', 'hint', '原 ' + (r.closeOrig === '' ? '空' : r.closeOrig) + ',已采用公式'));
      else if (fixable) cc.appendChild(el('span', 'hint hint--fix', '按公式应为 ' + r.formulaStr));
      tr.appendChild(cc);
      var uc = td('单位', r.unitNorm || '');
      if (r.unit && r.unit !== r.unitNorm) uc.appendChild(el('span', 'hint', '原写 ' + r.unit));
      tr.appendChild(uc);
      var ic = td('问题', '');
      if (r.issues.length) {
        var ul = el('ul', 'issue-list');
        r.issues.forEach(function (i) {
          var li = el('li');
          li.appendChild(el('span', 'tag tag--' + i.level, i.level === 'block' ? '阻断' : '警告'));
          li.appendChild(el('span', '', i.message));
          ul.appendChild(li);
        });
        ic.appendChild(ul);
      } else {
        ic.appendChild(el('span', 'tag tag--ok', '无异常'));
      }
      tr.appendChild(ic);
      body.appendChild(tr);
    });
    $('grid-note').textContent = rows.length ? '当前显示 ' + rows.length + ' 行(共 ' + result.rows.length + ' 行数据)。「行号」是原表中的行号(表头为第 1 行)。' : (result.rows.length ? '没有符合当前筛选条件的行(共 ' + result.rows.length + ' 行数据)。' : '表里没有数据行。');
    updateSel();
  }

  function updateSel() {
    $('sel-count').textContent = selected.size ? '已选 ' + selected.size + ' 行' : '';
    $('btn-apply').disabled = selected.size === 0;
  }

  function exportOpts() { return { sample: state.sample, currency: state.currency }; }
  function exportState() {
    var ready = !!result && !dirty;
    ['export-issues-csv', 'export-issues-md', 'export-fixed-csv'].forEach(function (id) { $(id).disabled = !ready; });
    $('export-note').textContent = !result ? '先导入并检查,才能导出。'
      : dirty ? '输入框的内容已改动但还没重新解析,导出已暂停,避免导出和界面对不上。请点「解析并检查」。'
      : '导出内容与上方结果一致。异常清单含原表行号;修正后库存表只改你选中并采用的行。';
    $('stale-note').hidden = !dirty;
    $('md-preview').value = ready ? C.issuesToMarkdown(result.issues, result.stats, exportOpts()) : '';
  }

  function render() {
    $('sample-tag').hidden = !state.sample;
    $('unit-map').value = state.unitMapText;
    $('currency').value = state.currency;
    var has = !!(state.table && state.table.headers.length);
    $('mapping-panel').hidden = !has;
    if (has) renderMapping();
    result = null;
    if (has && state.mapping.code >= 0) {
      result = C.check(state.rows, state.mapping, { unitMap: state.unitMapText });
      result.rows.forEach(function (r) { if (r.formula === null || !r.issues.some(function (i) { return i.rule === 'FORMULA'; })) selected.delete(r.index); });
    }
    $('empty-state').hidden = !!result;
    $('result').hidden = !result;
    if (has && !result) {
      $('empty-state').hidden = false;
      $('empty-state').textContent = '';
      var p = el('p'); p.appendChild(el('strong', '', '请先在「列映射与单位」里选出「商品编码」列。'));
      $('empty-state').appendChild(p);
    } else if (!has) {
      $('empty-state').textContent = '';
      var p1 = el('p'); p1.appendChild(el('strong', '', '还没有数据。'));
      p1.appendChild(document.createTextNode('点右上角「载入合成示例」看一遍完整流程,或把你的库存表粘贴到上面再点「解析并检查」。'));
      $('empty-state').appendChild(p1);
      $('empty-state').appendChild(el('p', 'muted', '检查规则:阻断(期初+入库−出库≠期末、期末为负、编码重复或为空、数字非法)与警告(单位不一致、低于安全库存、先出后入等)。只核对表内数字,不替代实物盘点。'));
    }
    if (result) { renderStats(); fillFilter(); renderGrid(); renderVerdict(); }
    exportState();
    if (focusId) { var fe = document.getElementById(focusId); focusId = null; if (fe) fe.focus(); }
  }

  /* ---------- 导出 ---------- */
  function download(name, text, mime) {
    var blob = new Blob(['\uFEFF' + text], { type: mime + ';charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function exportFixed() {
    var t = C.correctedTable(state.rows, exportOpts());
    download('修正后库存表.csv', C.toCsv(t.headers, t.rows), 'text/csv');
    flash('已导出修正后库存表 CSV。');
  }

  /* ---------- 事件 ---------- */
  function loadText(text, sample) {
    $('src').value = text;
    if (!parseNow()) return;
    state.sample = !!sample;
    var ok = commit(sample ? '已载入合成示例并完成检查。' : '已解析并检查。');
    render();
    return ok;
  }

  $('btn-sample').addEventListener('click', function () {
    var sc = scopeNow();
    var act = function () { loadText(globalThis.SAMPLE_INVENTORY.text, true); };
    if (sc.any) { askReplace('载入合成示例会替换你现有的:', C.describeScope(sc), act, 'btn-sample'); return; }
    act();
  });
  $('btn-replace-no').addEventListener('click', function () {
    var back = pendingAction && pendingAction.back;
    pendingAction = null;
    $('replace-confirm').hidden = true;
    if (back) $(back).focus();
  });
  $('btn-replace-yes').addEventListener('click', function () {
    var a = pendingAction;
    pendingAction = null;
    $('replace-confirm').hidden = true;
    if (a) a.run();
  });
  $('btn-parse').addEventListener('click', function () {
    if (!$('src').value.trim()) { showParseError('输入框是空的。请先粘贴库存表。'); flash('输入框是空的。请先粘贴库存表。'); return; }
    var pre = C.parseTable($('src').value);
    if (pre.error) { showParseError('未导入,原有结果保持不变。原因:' + pre.error); flash('未导入:' + pre.error); $('flash').classList.add('notice--danger'); return; }
    /* 重新解析会读回原表:已采用的公式期末和手动改过的列映射会被放弃 */
    var sc = scopeNow();
    var lose = { edited: sc.edited, mappingChanged: sc.mappingChanged };
    if (lose.edited || lose.mappingChanged) {
      askReplace('重新解析会放弃你现有的:', C.describeScope(lose), function () { loadText($('src').value, false); }, 'btn-parse');
      return;
    }
    loadText($('src').value, false);
  });
  $('src').addEventListener('input', function () {
    dirty = !!state.table && $('src').value !== state.text;
    exportState();
  });
  $('btn-file').addEventListener('click', function () { $('file-import').click(); });
  /* 文件导入:校验 → 预览行数 → (有现有数据时)确认 → 写入;校验失败整份拒绝,原有结果不变 */
  $('file-import').addEventListener('change', function (ev) {
    var file = ev.target.files && ev.target.files[0];
    if (!file) return;
    var rd = new FileReader();
    rd.onload = function () {
      var text = String(rd.result);
      ev.target.value = '';
      var chk = C.checkTextFile(text);
      if (!chk.ok) { showParseError('文件「' + file.name + '」未导入,原有结果保持不变。原因:' + chk.message); return; }
      var table = C.parseTable(text);
      if (table.error) { showParseError('文件「' + file.name + '」未导入,原有结果保持不变。原因:' + table.error); return; }
      if (!table.headers.length) { showParseError('文件「' + file.name + '」没有读到内容。'); return; }
      showParseError(null);
      var act = function () { loadText(text, false); };
      var sc = scopeNow();
      if (sc.any) { askReplace('文件「' + file.name + '」(' + table.rows.length + ' 行数据)会替换你现有的:', C.describeScope(sc), act, 'btn-file'); return; }
      act();
    };
    rd.onerror = function () { showParseError('文件读取失败,原有结果保持不变。'); };
    rd.readAsText(file);
  });
  $('currency').addEventListener('input', function () {
    var c = C.normalizeCurrency($('currency').value);
    var er = $('currency-error');
    if (!c.ok) { er.textContent = c.error + ' 已保留原来的标注「' + state.currency + '」。'; er.hidden = false; $('currency').setAttribute('aria-invalid', 'true'); return; }
    er.hidden = true; $('currency').removeAttribute('aria-invalid');
    state.currency = c.value;
    save();
    if (state.table) renderResultOnly();
  });
  $('unit-map').addEventListener('input', function () {
    state.unitMapText = $('unit-map').value;
    save();
    if (state.table) renderResultOnly();
  });
  function renderResultOnly() {
    if (!state.table || !(state.mapping.code >= 0)) return;
    result = C.check(state.rows, state.mapping, { unitMap: state.unitMapText });
    renderStats(); fillFilter(); renderGrid(); renderVerdict(); exportState();
  }
  $('filter').addEventListener('change', renderGrid);
  $('btn-select-formula').addEventListener('click', function () {
    result.rows.forEach(function (r) {
      if (r.formula !== null && r.issues.some(function (i) { return i.rule === 'FORMULA'; })) selected.add(r.index);
    });
    if ($('filter').value === FILTER_ISSUES || $('filter').value === FILTER_ALL) $('filter').value = 'FORMULA';
    renderGrid();
  });
  $('btn-apply').addEventListener('click', function () {
    var n = selected.size;
    state.rows = C.applyFormula(result.rows, Array.from(selected));
    selected.clear();
    commit('已把 ' + n + ' 行的期末改为按公式计算的值。其余行未改动。');
    focusId = 'filter';
    render();
  });
  $('export-issues-csv').addEventListener('click', function () {
    if (!result || dirty) return;
    download('库存异常清单.csv', C.issuesToCsv(result.issues, exportOpts()), 'text/csv');
    flash('已导出异常清单 CSV(' + result.issues.length + ' 条)。');
  });
  $('export-issues-md').addEventListener('click', function () {
    if (!result || dirty) return;
    download('库存异常清单.md', C.issuesToMarkdown(result.issues, result.stats, exportOpts()), 'text/markdown');
    flash('已导出异常清单 Markdown。');
  });
  $('export-fixed-csv').addEventListener('click', function () { if (result && !dirty) exportFixed(); });
  $('btn-save-warning-export').addEventListener('click', function () { if (state.rows.length) exportFixed(); });
  $('btn-clear').addEventListener('click', function () {
    var sc = scopeNow();
    $('clear-scope').textContent = sc.any ? '将清空:' + C.describeScope(sc) + '。' : '当前没有任何数据,清空不会改变什么。';
    $('replace-confirm').hidden = true;
    $('clear-confirm').hidden = false;
    $('btn-clear-no').focus();
  });
  $('btn-clear-no').addEventListener('click', function () { $('clear-confirm').hidden = true; $('btn-clear').focus(); });
  $('btn-clear-yes').addEventListener('click', function () {
    state = { text: '', table: null, mapping: null, unitMapText: C.DEFAULT_UNIT_MAP_TEXT, rows: [], sample: false, currency: '' };
    selected.clear(); dirty = false;
    showParseError(null);
    $('src').value = '';
    focusId = 'btn-clear';
    $('clear-confirm').hidden = true;
    try { localStorage.removeItem(STORAGE_KEY); $('save-warning').hidden = true; flash('已清空。'); } catch (e) { $('save-warning').hidden = false; }
    render();
  });

  /* ---------- 启动 ---------- */
  if (load()) $('src').value = state.text;
  render();
})();
