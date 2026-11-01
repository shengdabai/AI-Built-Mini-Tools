/* 时间出售三模式试算 · 界面与交互。用户输入只经 textContent 渲染,不拼接 innerHTML。 */
(function () {
  'use strict';

  var C = globalThis.TimeCore;
  var STORAGE_KEY = 'timesell.v1';
  var GROUPS = ['one', 'two', 'three'];

  var state = load();
  var ui = { suppressNext: false, pendingDelete: '', pendingImport: null };

  /* ---------- 存储 ---------- */
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return C.emptyState();
      var v = C.validateImport(raw);
      return v.ok ? v.data : C.emptyState();
    } catch (e) { return C.emptyState(); }
  }
  /* 返回是否真正写入;失败时显示持续可见的「未保存」提示 */
  function save() {
    var ok = true;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { ok = false; }
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
      if (c === null || c === undefined) return;
      n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function money(n) { return n === null || n === undefined ? '-' : Number(n).toFixed(2); }
  function btn(label, cls, onClick) {
    var b = el('button', 'btn ' + cls, [label]);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }
  function flash(msg) {
    if (ui.suppressNext) return;
    var f = $('flash');
    f.textContent = msg;
    f.hidden = false;
  }
  function clearFlash() { $('flash').hidden = true; $('import-error').hidden = true; }
  function stat(label, value, cls) {
    return el('div', 'stat' + (cls ? ' ' + cls : ''), [el('span', 'stat__label', [label]), el('strong', 'stat__value', [value])]);
  }
  function warn(text) { return el('p', 'notice notice--warn', [text]); }

  /* ---------- 输入绑定 ---------- */
  function fieldInputs() { return Array.prototype.slice.call(document.querySelectorAll('input[data-g]')); }
  function fillInputs() {
    fieldInputs().forEach(function (i) {
      var v = state.current[i.dataset.g][i.dataset.k];
      i.value = v ? String(v) : '';
      i.removeAttribute('aria-invalid');
    });
    $('scn-name').value = state.current.name;
  }
  function onField(i) {
    var g = i.dataset.g, k = i.dataset.k;
    var spec = C.SPEC[g][k];
    var raw = i.value.trim();
    var n = raw === '' ? 0 : Number(raw);
    var bad = !isFinite(n) || n < 0 || (spec.kind === 'pct' && n > 100);
    if (bad) {
      i.setAttribute('aria-invalid', 'true');
      showInputError(spec.label + (spec.kind === 'pct' ? '必须在 0 到 100 之间' : '必须是不小于 0 的数字') + '。计算仍使用上一个有效值。');
      return;
    }
    i.removeAttribute('aria-invalid');
    $('input-error').hidden = true;
    state.current[g][k] = n;
    save();
    render();
  }
  function showInputError(msg) {
    var e = $('input-error');
    e.textContent = msg;
    e.hidden = false;
  }

  /* ---------- 渲染 ---------- */
  function isBlank() {
    if (state.scenarios.length || state.current.name) return false;
    return GROUPS.every(function (g) {
      return Object.keys(C.SPEC[g]).every(function (k) { return !state.current[g][k]; });
    });
  }

  function renderMode1(ev) {
    var box = $('m1-result');
    clear(box);
    var r = ev.r1;
    if (!r.feasible) {
      box.appendChild(warn(r.reason || '请先填写现状'));
    } else {
      box.appendChild(stat('最低时薪(每小时标价)', money(r.minHourly) + ' 元', 'stat--main'));
      box.appendChild(stat('实际收费工时', money(r.billableHours) + ' 小时'));
      box.appendChild(stat('含隐性时间的总工时', money(r.totalHours) + ' 小时'));
      box.appendChild(stat('需要客户付出的总额', money(r.grossBilling) + ' 元'));
      box.appendChild(stat('到手目标 ÷ 总工时', money(r.effectiveHourly) + ' 元/小时'));
    }
    var tb = $('sens-table').tBodies[0];
    clear(tb);
    C.sensitivity(state.current.one, 'vacancy', 5).forEach(function (row, i) {
      tb.appendChild(el('tr', i === 0 ? 'is-base' : '', [
        el('td', '', [row.value + '%' + (i === 0 ? '(现状)' : '')]),
        el('td', 'num', [money(row.hourly)]),
        el('td', 'num', [i === 0 ? '-' : '+' + money(row.delta) + '(+' + row.deltaPct.toFixed(1) + '%)']),
        el('td', 'num', [i === 0 ? '-' : '+' + money(row.stepDelta)])
      ]));
    });
    if (!tb.rows.length) tb.appendChild(el('tr', '', [el('td', 'hint', ['填好现状后这里出现敏感性表']), el('td'), el('td'), el('td')]));
  }

  function renderMode2(ev) {
    var box = $('m2-result');
    clear(box);
    var r = ev.r2;
    var two = state.current.two;
    box.appendChild(stat('单份到手', money(r.netPerUnit) + ' 元'));
    box.appendChild(stat('月净收入', money(r.monthlyIncome) + ' 元', 'stat--main'));
    if (r.breakEvenUnits === null) box.appendChild(stat('回本销量', '无法计算(单份到手为 0 或没有估值时薪)'));
    else box.appendChild(stat('回本销量', r.breakEvenUnits + ' 份'));
    if (r.unitsForTarget === null) box.appendChild(stat('达到模式一目标收入需要', '需先填目标月收入和单价'));
    else box.appendChild(stat('达到模式一目标收入需要', r.unitsForTarget + ' 份/月(现在预计 ' + (two.units || 0) + ')'));
    var ex = C.explainTwo(state.current);
    var exBox = $('m2-explain');
    clear(exBox);
    exBox.appendChild(el('p', '', ['单份到手 = 单价 × (1−平台费) × (1−退款率) × (1−税费):' + ex.netFormula + ' 元。']));
    exBox.appendChild(el('p', '', ['这里的税费 ' + ex.taxPct + '% 继承自「现状」里的税费,模式二没有单独的税费输入。']));
    exBox.appendChild(el('p', '', [ex.breakEvenFormula
      ? '回本销量 = 制作工时 × 估值时薪 ÷ 单份到手,向上取整:' + ex.breakEvenFormula + '(估值时薪 ' + money(ex.hourlyValueUsed) + ' 元/小时,' + (ex.hourlyValueSource === 'input' ? '取自你填的估值' : '填 0 所以取模式一最低时薪') + ')。'
      : '回本销量:' + ex.breakEvenReason + '。']));
    var tb = $('curve-table').tBodies[0];
    clear(tb);
    var maxH = 0;
    r.curve.forEach(function (p) { if (p.hourly !== null && p.hourly > maxH) maxH = p.hourly; });
    var base = ev.r1.effectiveHourly;
    r.curve.forEach(function (p) {
      var tags = [];
      if (p.units === Math.round(two.units || 0) && p.units > 0) tags.push('预计月销量');
      if (r.breakEvenUnits && p.units === r.breakEvenUnits) tags.push('回本');
      var rel = '-';
      if (p.hourly !== null && base) rel = p.hourly >= base ? '高于' : '低于';
      var fill = el('div', 'bar__fill');
      fill.style.width = (maxH > 0 && p.hourly !== null ? Math.round(p.hourly / maxH * 100) : 0) + '%';
      tb.appendChild(el('tr', tags.length ? 'is-base' : '', [
        el('td', 'num', [p.units + (tags.length ? '(' + tags.join('、') + ')' : '')]),
        el('td', 'num', [p.hourly === null ? '-' : money(p.hourly)]),
        el('td', '', [rel]),
        el('td', 'bar-cell', [el('div', 'bar', [fill])])
      ]));
    });
  }

  function renderMode3(ev) {
    var box = $('m3-result');
    clear(box);
    var r = ev.r3;
    var v = state.current.three;
    if (!r.valid) { box.appendChild(el('p', 'notice notice--danger', [r.errors[0]])); return; }
    box.appendChild(stat('腾出的工时', money(r.freedHours) + ' 小时/月'));
    box.appendChild(stat('多卖出去的收入', money(r.gain) + ' 元'));
    box.appendChild(stat('外包成本', money(r.cost) + ' 元'));
    box.appendChild(stat('每月净增', (r.net > 0 ? '+' : '') + money(r.net) + ' 元', r.net > 0 ? 'stat--main stat--good' : 'stat--main stat--bad'));
    box.appendChild(stat('外包划算的临界时薪', r.breakEvenRate === null ? '腾出的时间卖不出去,不划算' : money(r.breakEvenRate) + ' 元/小时'));
    var msg;
    if (!v.outsourceRate && !v.yourRate) msg = '填入外包时薪和你的时薪后给出结论。';
    else if (r.worthIt) msg = '你的时薪高于临界时薪,这部分外包划算。';
    else msg = '你的时薪没有高于临界时薪,外包这部分在假设下不划算。';
    box.appendChild(el('p', 'verdict', [msg]));
  }

  function scenarioKey(s) { return JSON.stringify([s.name, s.one, s.two, s.three]); }

  function renderCompare() {
    var cmp = C.compare(state.scenarios);
    var tb = $('cmp-table').tBodies[0];
    clear(tb);
    var has = cmp.entries.length > 0;
    $('cmp-wrap').hidden = !has;
    $('cmp-empty').hidden = has;
    cmp.entries.forEach(function (e) {
      e.modes.forEach(function (m, i) {
        var fill = el('div', 'bar__fill' + (e.best === m.mode ? ' bar__fill--best' : ''));
        fill.style.width = (cmp.maxIncome > 0 && m.income !== null ? Math.round(Math.max(m.income, 0) / cmp.maxIncome * 100) : 0) + '%';
        tb.appendChild(el('tr', (i === 0 ? 'row-first' : '') + (e.best === m.mode ? ' is-best' : ''), [
          el('th', 'name-cell', [i === 0 ? (e.name || '未命名情景') : '']),
          el('td', '', [m.label]),
          el('td', 'num', [money(m.income)]),
          el('td', 'num', [money(m.hours)]),
          el('td', 'num', [money(m.hourly)]),
          el('td', 'num', [m.rank === null ? '-' : String(m.rank)]),
          el('td', 'bar-cell', [el('div', 'bar', [fill])])
        ]));
      });
    });

    var slots = $('slot-buttons');
    clear(slots);
    for (var i = 0; i < 3; i++) {
      (function (idx) {
        var exists = idx < state.scenarios.length;
        var b = btn((exists ? '覆盖情景 ' : '存为情景 ') + (idx + 1), exists ? 'btn--secondary' : 'btn--primary', function () { saveSlot(idx); });
        if (idx > state.scenarios.length) b.disabled = true;
        slots.appendChild(b);
      })(i);
    }
    var evNow = C.evaluate(state.current);
    if (!evNow.r3.valid) Array.prototype.forEach.call(slots.children, function (b) { b.disabled = true; });
    var cur = scenarioKey(state.current);
    $('dirty-hint').hidden = !(state.scenarios.length && !state.scenarios.some(function (s) { return scenarioKey(s) === cur; }));
    $('sample-badge').hidden = !state.scenarios.some(function (s) { return /^sample-/.test(s.id); });

    var list = $('scn-list');
    clear(list);
    state.scenarios.forEach(function (s, idx) {
      var actions = [btn('载入到编辑区', 'btn--secondary', function () { loadSlot(idx); })];
      if (ui.pendingDelete === s.id) {
        actions.push(btn('确认删除', 'btn--danger', function () { deleteSlot(idx); }));
        actions.push(btn('取消', 'btn--secondary', function () { ui.pendingDelete = ''; renderCompare(); }));
      } else {
        actions.push(btn('删除', 'btn--secondary', function () { ui.pendingDelete = s.id; renderCompare(); }));
      }
      list.appendChild(el('div', 'scn-item', [el('strong', '', ['情景 ' + (idx + 1) + ':' + (s.name || '未命名情景')]), el('div', 'row', actions)]));
    });

    var hasData = has;
    var dirty = !$('dirty-hint').hidden;
    $('btn-export-md').disabled = !hasData || dirty;
    $('btn-export-csv').disabled = !hasData || dirty;
    $('export-hint').textContent = !hasData ? '先保存至少一个情景才能导出。'
      : dirty ? '编辑区有未保存的改动:请先存为或覆盖情景,或载入已存情景放弃改动,再导出情景表。JSON 备份不受影响,它包含编辑区。'
      : '导出内容就是下方预览,来自上面已保存的情景。';
    $('md-preview').textContent = hasData ? C.toMarkdown(cmp) : '';
    $('md-preview').hidden = !hasData;
  }

  function render() {
    var ev = C.evaluate(state.current);
    $('empty-guide').hidden = !isBlank();
    renderMode1(ev);
    renderMode2(ev);
    renderMode3(ev);
    renderCompare();
  }

  /* ---------- 动作 ---------- */
  function newId() {
    var id, n = 0;
    do { id = 'sc-' + Date.now().toString(36) + n++; } while (state.scenarios.some(function (s) { return s.id === id; }));
    return id;
  }
  function snapshot(id) {
    var c = JSON.parse(JSON.stringify(state.current));
    return { id: id, name: c.name, one: c.one, two: c.two, three: c.three };
  }
  function saveSlot(idx) {
    clearFlash();
    if (idx < state.scenarios.length) state.scenarios[idx] = snapshot(state.scenarios[idx].id);
    else if (idx === state.scenarios.length) state.scenarios.push(snapshot(newId()));
    ui.pendingDelete = '';
    var ok = save();
    render();
    if (ok) flash('已保存为情景 ' + (idx + 1) + '。');
  }
  function loadSlot(idx) {
    clearFlash();
    var s = state.scenarios[idx];
    state.current = JSON.parse(JSON.stringify({ name: s.name, one: s.one, two: s.two, three: s.three }));
    var ok = save();
    fillInputs();
    render();
    if (ok) flash('已把情景 ' + (idx + 1) + ' 载入编辑区。');
  }
  function deleteSlot(idx) {
    clearFlash();
    state.scenarios.splice(idx, 1);
    ui.pendingDelete = '';
    var ok = save();
    render();
    if (ok) flash('已删除情景。');
  }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function exportJson() {
    download('time-sell-backup.json', JSON.stringify(state, null, 2), 'application/json');
  }
  function requestSample() {
    if (isBlank()) { loadSample(); return; }
    $('sample-confirm').hidden = false;
    $('sample-confirm').scrollIntoView({ block: 'nearest' });
  }
  function loadSample() {
    $('sample-confirm').hidden = true;
    clearFlash();
    state = globalThis.TimeSample.build();
    var ok = save();
    fillInputs();
    render();
    if (ok) flash('已载入合成示例(三个情景,不是真实数据)。');
  }

  function init() {
    fieldInputs().forEach(function (i) { i.addEventListener('input', function () { onField(i); }); });
    $('scn-name').addEventListener('input', function (e) {
      state.current.name = e.target.value;
      save();
      renderCompare();
    });
    $('btn-sample').addEventListener('click', requestSample);
    $('btn-sample-2').addEventListener('click', requestSample);
    $('btn-sample-yes').addEventListener('click', loadSample);
    $('btn-sample-no').addEventListener('click', function () { $('sample-confirm').hidden = true; });
    $('btn-export-json').addEventListener('click', exportJson);
    $('btn-save-warning-export').addEventListener('click', exportJson);
    $('btn-export-md').addEventListener('click', function () {
      download('time-sell-scenarios.md', C.toMarkdown(C.compare(state.scenarios)), 'text/markdown');
    });
    $('btn-export-csv').addEventListener('click', function () {
      download('time-sell-scenarios.csv', C.toCsv(C.compare(state.scenarios)), 'text/csv');
    });
    $('file-import').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        clearFlash();
        var v = C.validateImport(String(reader.result));
        if (!v.ok) {
          var box = $('import-error');
          box.textContent = '导入被拒绝,现有数据没有改动:' + v.error;
          box.hidden = false;
          return;
        }
        ui.pendingImport = v.data;
        $('import-summary').textContent = C.importSummary(state, v.data).text + '确认前现有数据不变。';
        $('import-confirm').hidden = false;
        $('btn-import-no').focus();
      };
      reader.onerror = function () {
        var box = $('import-error');
        box.textContent = '导入被拒绝:文件读取失败。';
        box.hidden = false;
      };
      reader.readAsText(f);
    });
    $('btn-import').addEventListener('click', function () { $('file-import').click(); });
    $('btn-import-no').addEventListener('click', function () {
      ui.pendingImport = null;
      $('import-confirm').hidden = true;
    });
    $('btn-import-yes').addEventListener('click', function () {
      if (!ui.pendingImport) return;
      state = ui.pendingImport;
      ui.pendingImport = null;
      $('import-confirm').hidden = true;
      var ok = save();
      fillInputs();
      render();
      if (ok) flash('已导入备份。');
    });
    $('btn-clear').addEventListener('click', function () { $('clear-confirm').hidden = false; });
    $('btn-clear-no').addEventListener('click', function () { $('clear-confirm').hidden = true; });
    $('btn-clear-yes').addEventListener('click', function () {
      state = C.emptyState();
      $('clear-confirm').hidden = true;
      clearFlash();
      var ok = save();
      fillInputs();
      render();
      if (ok) flash('已清空。');
    });
    fillInputs();
    render();
  }

  init();
})();
