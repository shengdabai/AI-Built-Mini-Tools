'use strict';
(function () {
  var C = globalThis.RadarCore;
  var KEY = 'radar.v1';
  var SIZE = 400;
  var today = C.todayFromSearch(location.search);
  var state = C.emptyState();
  var locked = false;          // 本机存档损坏时为 true:不覆盖存档
  var pending = null;          // 页内确认区等待执行的动作
  var invalid = new Set();     // 当前内容不合法的输入框
  var showTarget = true;
  var model = null;            // 最近一次雷达图的数据,供悬停读取

  function $(id) { return document.getElementById(id); }
  function h(tag, props, kids) {
    var el = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'text') el.textContent = props[k];
      else if (k === 'class') el.className = props[k];
      else if (props[k] === true) el.setAttribute(k, '');
      else if (props[k] !== false && props[k] !== null && props[k] !== undefined) el.setAttribute(k, props[k]);
    });
    (kids || []).forEach(function (c) { el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function cur() {
    for (var i = 0; i < state.profiles.length; i++) if (state.profiles[i].id === state.activeId) return state.profiles[i];
    return null;
  }
  function fmtInt(v) { return String(Math.round(v)); }
  function fmtPct(v) { return (Math.round(v * 10) / 10) + '%'; }

  /* ---------- 提示与存储 ---------- */
  function showMsg(text, kind) {
    var m = $('message');
    m.textContent = text;
    m.className = 'notice ' + (kind === 'error' ? 'notice-error' : 'notice-info');
    m.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    m.hidden = false;
  }
  function hideMsg() { $('message').hidden = true; }
  function setSaveAlert(text) {
    $('save-alert-text').textContent = text;
    $('save-alert').hidden = !text;
  }
  function persist() {
    var status = $('save-status');
    if (locked) {
      setSaveAlert('本机存档无法读取,所以当前改动不会保存,也不会覆盖原存档。请先导出 JSON 备份;点「清空数据」可丢弃损坏的存档后重新开始。');
      status.textContent = '未保存:存档损坏,已暂停写入。';
      return false;
    }
    var v = C.validateState(state);
    if (!v.ok) {
      setSaveAlert('未保存:数据未通过校验(' + v.errors.slice(0, 3).join(';') + ')。请导出 JSON 备份后检查。');
      status.textContent = '未保存。';
      return false;
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      setSaveAlert('未保存:浏览器拒绝写入本机存储(' + (e && e.name ? e.name : '未知错误') + ')。关闭页面会丢失改动,请立即导出 JSON 备份。');
      status.textContent = '未保存:写入本机存储失败。';
      return false;
    }
    setSaveAlert('');
    status.textContent = '已保存到本机浏览器。';
    return true;
  }
  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) {
      setSaveAlert('无法读取本机存储(' + (e && e.name ? e.name : '未知错误') + '),本次改动可能无法保存。请定期导出 JSON 备份。');
      return C.emptyState();
    }
    if (raw === null) return C.emptyState();
    var parsed;
    try { parsed = JSON.parse(raw); } catch (e) {
      locked = true;
      setSaveAlert('本机存档不是有效的 JSON,已暂停写入以免覆盖。可点「清空数据」丢弃它后重新开始。');
      return C.emptyState();
    }
    var r = C.validateImport(parsed);
    if (!r.ok) {
      locked = true;
      setSaveAlert('本机存档未通过校验(' + r.errors.slice(0, 3).join(';') + '),已暂停写入以免覆盖。可点「清空数据」丢弃它后重新开始。');
      return C.emptyState();
    }
    return r.state;
  }

  /* 页内确认 */
  function askConfirm(text, yesLabel, action) {
    pending = action;
    $('confirm-text').textContent = text;
    $('confirm-yes').textContent = yesLabel;
    $('confirm-box').hidden = false;
    $('confirm-no').focus();
  }
  function closeConfirm() { pending = null; $('confirm-box').hidden = true; }

  /* ---------- 输入合法性 ---------- */
  function parseScore(s) {
    s = String(s).trim();
    if (s === '') return null;
    var v = Number(s);
    return Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
  }
  function parseNonNeg(s) {
    s = String(s).trim();
    if (s === '') return null;
    var v = Number(s);
    return Number.isFinite(v) && v >= 0 ? v : null;
  }
  function mark(el, bad) {
    if (bad) { invalid.add(el); el.setAttribute('aria-invalid', 'true'); el.dataset.err = bad; }
    else { invalid.delete(el); el.removeAttribute('aria-invalid'); delete el.dataset.err; }
    updateExportState();
  }
  function showErr(container, selectorErr) {
    var bad = container.querySelector('[aria-invalid="true"]');
    var errEl = typeof selectorErr === 'string' ? container.querySelector(selectorErr) : selectorErr;
    errEl.textContent = bad ? bad.dataset.err : '';
    errEl.hidden = !bad;
  }
  function updateExportState() {
    var none = !cur();
    var dis = none || invalid.size > 0;
    ['export-csv', 'export-svg', 'export-json'].forEach(function (id) { $(id).disabled = dis; });
    $('export-note').hidden = invalid.size === 0;
  }

  /* ---------- 渲染:档案与编辑器 ---------- */
  function renderTabs() {
    var box = $('profile-tabs');
    box.replaceChildren();
    state.profiles.forEach(function (p) {
      var b = h('button', { type: 'button', class: 'tab', 'data-id': p.id, text: p.name });
      if (p.id === state.activeId) b.setAttribute('aria-pressed', 'true'); else b.setAttribute('aria-pressed', 'false');
      box.appendChild(b);
    });
  }
  function renderCompareSelect() {
    var sel = $('compare-select');
    sel.replaceChildren(h('option', { value: '', text: '不叠加' }));
    state.profiles.forEach(function (p) {
      if (p.id !== state.activeId) sel.appendChild(h('option', { value: p.id, text: p.name }));
    });
    sel.value = state.compareId && state.compareId !== state.activeId ? state.compareId : '';
  }
  function field(label, id, input, extra) {
    return h('div', { class: 'field' + (extra ? ' ' + extra : '') }, [h('label', { for: id, text: label }), input]);
  }
  function renderEditor() {
    var p = cur();
    var list = $('dim-list');
    list.replaceChildren();
    invalid.clear();
    if (!p) return;
    $('profile-name').value = p.name;
    $('profile-name-err').hidden = true;
    $('synthetic-badge').hidden = !p.synthetic;
    p.dims.forEach(function (d, i) {
      var pre = 'd' + i + '-';
      var card = h('div', { class: 'dim-card', 'data-i': String(i) });
      var nameIn = h('input', { type: 'text', id: pre + 'name', 'data-f': 'name', autocomplete: 'off' });
      nameIn.value = d.name;
      var rm = h('button', { type: 'button', class: 'btn btn-small', 'data-act': 'remove', text: '删除此维度' });
      if (p.dims.length <= C.MIN_DIMS) { rm.disabled = true; rm.title = '至少保留 ' + C.MIN_DIMS + ' 个维度'; }
      card.appendChild(h('div', { class: 'dim-head' }, [field('维度名', pre + 'name', nameIn, 'grow'), rm]));

      var cNum = h('input', { type: 'number', id: pre + 'current', 'data-f': 'current', min: '0', max: '100', step: '1', inputmode: 'decimal' });
      cNum.value = d.current;
      var cRange = h('input', { type: 'range', id: pre + 'range', 'data-f': 'current-range', min: '0', max: '100', step: '1', 'aria-label': '当前分滑块:' + d.name });
      cRange.value = d.current;
      var tNum = h('input', { type: 'number', id: pre + 'target', 'data-f': 'target', min: '0', max: '100', step: '1', inputmode: 'decimal' });
      tNum.value = d.target;
      var hrs = h('input', { type: 'number', id: pre + 'hours', 'data-f': 'hours', min: '0', step: '0.5', inputmode: 'decimal', placeholder: '可选' });
      hrs.value = d.hours === null ? '' : d.hours;
      card.appendChild(h('div', { class: 'num-row' }, [
        field('当前分(0–100)', pre + 'current', cNum),
        field('目标分(0–100)', pre + 'target', tNum),
        field('每周小时', pre + 'hours', hrs)
      ]));
      card.appendChild(h('div', { class: 'range-row' }, [cRange]));
      var ev = h('textarea', { id: pre + 'evidence', 'data-f': 'evidence', rows: '2', placeholder: '为什么给这个分?写一件可核对的事' });
      ev.value = d.evidence;
      card.appendChild(field('一句证据', pre + 'evidence', ev));
      card.appendChild(h('p', { class: 'field-err dim-err', id: pre + 'err', role: 'alert', hidden: true }));
      [nameIn, cNum, tNum, hrs].forEach(function (el) { el.setAttribute('aria-describedby', pre + 'err'); });
      cRange.setAttribute('aria-describedby', pre + 'err');
      list.appendChild(card);
    });
    $('weekly-hours').value = p.weeklyHours;
    $('weekly-hours-err').hidden = true;
    $('add-dim').disabled = p.dims.length >= C.MAX_DIMS;
    $('dim-count').textContent = '共 ' + p.dims.length + ' 个维度(允许 ' + C.MIN_DIMS + '–' + C.MAX_DIMS + ')';
  }

  /* ---------- 渲染:雷达与结果 ---------- */
  function buildModel() {
    var p = cur();
    var names = p.dims.map(function (d) { return d.name; });
    var layers = [];
    if (showTarget) layers.push({ key: 'target', label: '目标', scores: p.dims.map(function (d) { return d.target; }) });
    var cp = null, missing = [];
    if (state.compareId && state.compareId !== state.activeId) {
      for (var i = 0; i < state.profiles.length; i++) if (state.profiles[i].id === state.compareId) cp = state.profiles[i];
    }
    var cmap = new Map();
    if (cp) {
      cp.dims.forEach(function (d) { cmap.set(d.name.trim(), d); });
      var sc = names.map(function (n) {
        var d = cmap.get(n.trim());
        if (!d) { missing.push(n); return 0; }
        return d.current;
      });
      layers.push({ key: 'compare', label: '对标:' + cp.name + '(当前)', scores: sc });
    }
    layers.push({ key: 'current', label: '当前', scores: p.dims.map(function (d) { return d.current; }) });
    return { p: p, names: names, layers: layers, cp: cp, cmap: cmap, missing: missing };
  }
  function renderRadar() {
    model = buildModel();
    $('radar-host').innerHTML = C.toSvg({ names: model.names, layers: model.layers, size: SIZE, title: model.p.name });
    var labels = $('radar-labels');
    labels.replaceChildren();
    var ends = C.vertices(new Array(model.names.length).fill(100), 100);
    ends.forEach(function (e, i) {
      var cos = (e.x - 50) / 50, sin = (e.y - 50) / 50;
      var x = 50 + (e.x - 50) * 1.06, y = 50 + (e.y - 50) * 1.06;
      var cls = 'axis-label ' + (cos > 0.3 ? 'at-right' : cos < -0.3 ? 'at-left' : 'at-center') + ' ' + (sin < -0.5 ? 'at-top' : sin > 0.5 ? 'at-bottom' : 'at-mid');
      var sp = h('span', { class: cls, text: model.names[i] });
      sp.style.left = x + '%'; sp.style.top = y + '%';
      labels.appendChild(sp);
    });
    var legend = $('legend');
    legend.replaceChildren();
    ['current', 'target', 'compare'].forEach(function (k) {
      model.layers.forEach(function (l) {
        if (l.key === k) legend.appendChild(h('li', {}, [h('span', { class: 'swatch swatch-' + k, 'aria-hidden': 'true' }), l.label]));
      });
    });
    var note = $('compare-note');
    if (model.cp && model.missing.length) {
      note.textContent = '对标档案没有这些维度,按 0 分画:' + model.missing.join('、') + '。';
      note.hidden = false;
    } else note.hidden = true;
    hideTip();
  }
  function renderStats() {
    var p = model.p;
    var cs = p.dims.map(function (d) { return d.current; });
    var ts = p.dims.map(function (d) { return d.target; });
    var a = C.area(cs), ta = C.area(ts), full = C.fullArea(cs.length), single = C.singleDimFullArea(cs.length);
    $('area-value').textContent = fmtInt(a);
    $('area-pct').textContent = fmtPct(full > 0 ? (a / full) * 100 : 0);
    $('area-target').textContent = fmtInt(ta);
    $('area-explain').textContent = '面积 = 以各维度分数为半径的多边形面积(分数 × 分数,无单位)。维度名称、数量和顺序保持一致时再比较:相同分数换了顺序,面积也可能不同。' + cs.length + ' 个维度全部满分时面积为 ' + fmtInt(full) + '。' +
      (a > 0 ? '全部达到目标后面积为现在的 ' + (Math.round((ta / a) * 100) / 100) + ' 倍。' : '当前面积为 0,先给维度打分。');
    var top = p.dims.reduce(function (m, d) { return d.current > m ? d.current : m; }, -1);
    var tops = p.dims.filter(function (d) { return d.current === top; }).map(function (d) { return d.name; });
    $('top-dim').textContent = '只看最强的一项:' + tops.join('、') + '(' + top + ' 分)。这个口径下,只有在这一项上赢过所有人才算数。';
    $('area-sectors').textContent = '看整体面积:' + fmtInt(a) + ',占 ' + cs.length + ' 维满分多边形(' + fmtInt(full) + ')的 ' + fmtPct(full > 0 ? (a / full) * 100 : 0) + '。单维满分(一个维度 100、其余 0)的多边形面积是 ' + fmtInt(single) + ':只有一个维度,围不出面积。';
    var hints = C.compareSingleVsMulti(cs);
    var ul = $('hints');
    ul.replaceChildren();
    if (!hints.length) ul.appendChild(h('li', { text: '目前没有触发提示:没有单维称王,也还没有 3 个维度 ≥ 60。' }));
    hints.forEach(function (x) { ul.appendChild(h('li', { class: 'hint hint-' + x.kind, text: x.text })); });
  }

  /* ---------- 渲染:投入建议 ---------- */
  function renderAllocTable() {
    var p = cur(), body = $('alloc-body');
    body.replaceChildren();
    p.dims.forEach(function (d, i) {
      var w = h('input', { type: 'number', min: '0', step: '0.5', 'data-f': 'weight', 'aria-label': '权重:' + d.name, inputmode: 'decimal', 'aria-describedby': 'alloc-note' });
      w.value = d.weight;
      var tr = h('tr', { 'data-i': String(i) }, [
        h('th', { scope: 'row', 'data-label': '维度', 'data-role': 'name' }),
        h('td', { 'data-label': '当前', 'data-role': 'cur' }),
        h('td', { 'data-label': '目标', 'data-role': 'tgt' }),
        h('td', { 'data-label': '差距', 'data-role': 'gap' }),
        h('td', { 'data-label': '权重' }, [w]),
        h('td', { 'data-label': '建议小时', 'data-role': 'sug', class: 'strong' }),
        h('td', { 'data-label': '现投入小时', 'data-role': 'now' }),
        h('td', { 'data-label': '边际面积 / 分', 'data-role': 'mar' })
      ]);
      body.appendChild(tr);
    });
    refreshAlloc();
  }
  function refreshAlloc() {
    var p = cur();
    var res = C.allocate(p.dims, p.weeklyHours, p.dims.map(function (d) { return d.weight; }));
    var scores = p.dims.map(function (d) { return d.current; });
    var dec = C.decimalsOf(p.weeklyHours);
    var rows = $('alloc-body').children;
    for (var i = 0; i < rows.length; i++) {
      var d = p.dims[i], r = res.rows[i], tr = rows[i];
      function set(role, v) { tr.querySelector('[data-role="' + role + '"]').textContent = v; }
      set('name', d.name); set('cur', d.current); set('tgt', d.target);
      set('gap', r.gap); set('sug', r.hours.toFixed(dec)); set('now', d.hours === null ? '—' : d.hours);
      set('mar', (Math.round(C.marginalArea(scores, i) * 100) / 100).toFixed(2));
    }
    var best = C.bestMarginal(p.dims);
    $('best-dim').textContent = best
      ? '「' + best.name + '」每提高 1 分,图形面积增加最多(+' + (Math.round(best.value * 100) / 100) + ')。未计算提分耗时,不能据此判断每小时的提升效果。'
      : '所有维度都已达到目标(或已满分),没有需要投入的维度。';
    $('alloc-note').textContent = res.allocated
      ? '建议小时合计 ' + res.total.toFixed(dec) + '(= 每周可投入小时)。差距为 0 的维度不分配。'
      : (p.weeklyHours > 0 ? '没有可分配的维度:差距 × 权重全为 0。' : '每周可投入小时为 0,不分配。');
  }

  /* ---------- 渲染:时间线 ---------- */
  function renderTimeline() {
    var p = cur();
    var pts = C.timeline(p.snapshots);
    $('tl-chart').innerHTML = C.timelineSvg(pts);
    $('tl-caption').textContent = pts.length
      ? '比较前请确认维度名称、数量和顺序一致。纵轴:面积,0 到 ' + fmtInt(Math.max.apply(null, pts.map(function (q) { return q.area; })) * 1.15) + ';横轴:日期,' + pts[0].date + ' 至 ' + pts[pts.length - 1].date + '。'
      : '还没有快照。改好分数后,选日期并点「把当前分数记为快照」。';
    var mc = C.monthCompare(pts, today);
    var txt;
    if (!mc.thisPoint || !mc.lastPoint) {
      txt = '本月(' + mc.thisKey + ')vs 上月(' + mc.lastKey + '):' + (!mc.thisPoint ? '本月没有快照' : '') + (!mc.thisPoint && !mc.lastPoint ? ','  : '') + (!mc.lastPoint ? '上月没有快照' : '') + ',无法比较。';
    } else if (!mc.comparable) {
      txt = '本月与上月快照的' + mc.reason + ',面积不可直接比较(口径改变,已停止比较)。';
    } else {
      txt = '本月(' + mc.thisPoint.date + ')面积 ' + fmtInt(mc.thisPoint.area) + ' vs 上月(' + mc.lastPoint.date + ')' + fmtInt(mc.lastPoint.area) +
        ':' + (mc.delta >= 0 ? '+' : '') + fmtInt(mc.delta) + (mc.pct === null ? '' : '(' + (mc.pct >= 0 ? '+' : '') + fmtPct(mc.pct) + ')') + '。';
    }
    $('month-compare').textContent = txt;
    var body = $('snap-body');
    body.replaceChildren();
    pts.forEach(function (q) {
      body.appendChild(h('tr', {}, [
        h('th', { scope: 'row', 'data-label': '日期', text: q.date }),
        h('td', { 'data-label': '维度数', text: String(q.n) }),
        h('td', { 'data-label': '面积', text: fmtInt(q.area) }),
        h('td', { 'data-label': '操作' }, [h('button', { type: 'button', class: 'btn btn-small', 'data-act': 'del-snap', 'data-date': q.date, text: '删除' })])
      ]));
    });
    if (!pts.length) body.appendChild(h('tr', {}, [h('td', { colspan: '4', text: '暂无快照' })]));
  }

  function renderResults() { renderRadar(); renderStats(); refreshAlloc(); }
  function renderAll() {
    var p = cur();
    $('empty-state').hidden = !!p;
    $('workspace').hidden = !p;
    if (p) {
      renderTabs(); renderCompareSelect(); renderEditor(); renderRadar(); renderStats(); renderAllocTable(); renderTimeline();
    } else { invalid.clear(); }
    updateExportState();
  }

  /* ---------- 悬停提示(纯 DOM) ---------- */
  function hideTip() { $('radar-tip').hidden = true; }
  function showTip(v) {
    if (!model) return;
    var key = v.dataset.layer, i = +v.dataset.i;
    var layer = model.layers.filter(function (l) { return l.key === key; })[0];
    if (!layer) return;
    var name = model.names[i], score = layer.scores[i], ev;
    if (key === 'compare') {
      var d = model.cmap.get(name.trim());
      ev = d ? d.evidence : '该档案没有这个维度,按 0 分画。';
    } else ev = model.p.dims[i].evidence;
    var tip = $('radar-tip');
    tip.replaceChildren(
      h('strong', { class: 'tip-name', text: name }),
      h('div', { class: 'tip-score', text: layer.label + ':' + score + ' 分' }),
      h('div', { class: 'tip-ev', text: ev ? '证据:' + ev : '(未填写证据)' })
    );
    tip.hidden = false;
    var wr = $('radar-wrap').getBoundingClientRect(), vr = v.getBoundingClientRect();
    var x = vr.left + vr.width / 2 - wr.left, y = vr.top + vr.height / 2 - wr.top;
    var w = tip.offsetWidth;
    tip.style.left = Math.min(Math.max(x, w / 2), Math.max(w / 2, wr.width - w / 2)) + 'px';
    tip.style.top = y + 'px';
    tip.classList.toggle('tip-above', y > wr.height / 2);
  }

  /* ---------- 动作 ---------- */
  function download(name, mime, text) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function safeFile(s) { return String(s).replace(/[\\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'radar'; }
  function themeFromCss() {
    var cs = getComputedStyle(document.documentElement);
    function t(n) { return cs.getPropertyValue(n).trim(); }
    return {
      bg: t('--color-bg-surface'), text: t('--color-text'), muted: t('--color-text-muted'), grid: t('--color-grid'),
      font: t('--font-family-base'), current: t('--color-series-current'), currentFill: t('--color-series-current-fill'),
      target: t('--color-series-target'), targetFill: t('--color-series-target-fill'),
      compare: t('--color-series-compare'), compareFill: t('--color-series-compare-fill'),
      strokeThin: t('--svg-stroke-thin'), strokeSeries: t('--svg-stroke-series'), dash: t('--svg-dash-target'),
      vertexR: t('--svg-vertex-r'), labelSize: t('--svg-label-size')
    };
  }
  function exportCsv() {
    if (invalid.size || !cur()) return;
    download('radar-' + safeFile(cur().name) + '.csv', 'text/csv;charset=utf-8', '\uFEFF' + C.toCsv(cur()));
    showMsg('已导出 CSV(维度 × 分数)。');
  }
  function exportSvg() {
    if (invalid.size || !cur()) return;
    try {
      var m = buildModel();
      var svg = C.toSvg({ names: m.names, layers: m.layers, size: SIZE, standalone: true, theme: themeFromCss(), title: m.p.name + (m.p.synthetic && m.p.name.indexOf('合成示例') < 0 ? '(合成示例)' : '') });
      download('radar-' + safeFile(m.p.name) + '.svg', 'image/svg+xml;charset=utf-8', svg);
      showMsg('已导出雷达 SVG。');
    } catch (e) { showMsg('导出 SVG 失败:' + e.message, 'error'); }
  }
  function exportJson(force) {
    if (!cur() || (invalid.size && force !== true)) return;
    download('radar-backup.json', 'application/json;charset=utf-8', JSON.stringify(state, null, 2));
    showMsg('已导出 JSON 备份(当前内存中的全部 ' + state.profiles.length + ' 个档案,含尚未写入浏览器的合法修改;不含非法输入框内容)。');
  }
  function replaceState(next, doneMsg) {
    state = next; locked = false;
    var ok = persist();
    renderAll();
    showMsg(ok ? doneMsg : doneMsg + '但没有保存到本机,请看上方红色提示。', ok ? 'info' : 'error');
  }
  function hasDraft() {
    return ['new-name', 'empty-new-name'].some(function (id) { return $(id).value.trim() !== ''; });
  }
  function scopeText() {
    var snaps = state.profiles.reduce(function (n, p) { return n + p.snapshots.length; }, 0);
    return state.profiles.length + ' 个档案(含 ' + snaps + ' 个快照与全部权重、小时设置)' + (hasDraft() ? '和未提交的新档案名称草稿' : '');
  }
  function loadSample() {
    var apply = function () { replaceState(JSON.parse(JSON.stringify(globalThis.RADAR_SAMPLE)), '已载入合成示例(人物与分数均为虚构)。'); };
    if (state.profiles.length || locked || hasDraft()) {
      askConfirm('载入示例会替换当前全部 ' + scopeText() + (locked ? '(并丢弃无法读取的旧存档)' : '') + '。确认前原数据保持不变,建议先导出 JSON 备份。', '确认替换', apply);
    } else apply();
  }
  function createProfile(name, inputEl) {
    name = name.trim();
    if (!name) {
      showMsg('请先填写新档案名称。', 'error');
      if (inputEl) { inputEl.setAttribute('aria-invalid', 'true'); inputEl.focus(); }
      return false;
    }
    if (inputEl) inputEl.removeAttribute('aria-invalid');
    var p = C.newProfile(name);
    state.profiles.push(p); state.activeId = p.id;
    var ok = persist();
    renderAll();
    showMsg(ok ? '已新建档案「' + name + '」。三个维度都是 0 分,先改名并打分。' : '已新建档案,但没有保存到本机,请看上方红色提示。', ok ? 'info' : 'error');
    $('d0-name').focus();
    return true;
  }
  function importFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var r = C.validateImport(String(reader.result));
      if (!r.ok) {
        showMsg('导入被拒绝,原数据未改动。原因:' + r.errors.slice(0, 5).join(';') + (r.errors.length > 5 ? ';…' : ''), 'error');
        return;
      }
      var apply = function () { replaceState(r.state, '已导入备份(' + r.state.profiles.length + ' 个档案)。'); };
      if (state.profiles.length || locked || hasDraft()) askConfirm('导入将用备份中的 ' + r.state.profiles.length + ' 个档案替换当前全部 ' + scopeText() + '。确认前原数据保持不变。', '确认替换', apply);
      else apply();
    };
    reader.onerror = function () { showMsg('读取文件失败。', 'error'); };
    reader.readAsText(file);
  }

  /* ---------- 事件 ---------- */
  function onDimInput(e) {
    var t = e.target, f = t.dataset.f;
    if (!f) return;
    var card = t.closest('.dim-card'), p = cur(), i = +card.dataset.i, d = p.dims[i], bad = null, v;
    if (f === 'name') {
      v = t.value.trim();
      if (!v) bad = '维度名不能为空。';
      else if (p.dims.some(function (x, j) { return j !== i && x.name.trim() === v; })) bad = '维度名不能和其他维度重复。';
      else d.name = v;
    } else if (f === 'current' || f === 'current-range' || f === 'target') {
      v = parseScore(t.value);
      if (v === null) bad = '请输入 0–100 的数字。';
      else if (f === 'target') d.target = v;
      else {
        d.current = v;
        var other = card.querySelector(f === 'current' ? '[data-f="current-range"]' : '[data-f="current"]');
        other.value = v;
        if (other.getAttribute('aria-invalid')) mark(other, null);
      }
    } else if (f === 'hours') {
      if (t.value.trim() === '') d.hours = null;
      else { v = parseNonNeg(t.value); if (v === null) bad = '每周小时需为不小于 0 的数字,或留空。'; else d.hours = v; }
    } else if (f === 'evidence') {
      d.evidence = t.value;
    }
    mark(t, bad);
    showErr(card, '.dim-err');
    if (!bad) { persist(); renderResults(); }
  }

  function bind() {
    $('load-sample').onclick = loadSample;
    $('empty-load-sample').onclick = loadSample;
    $('clear-data').onclick = function () {
      askConfirm('清空会删除全部 ' + scopeText() + '和本机存档,且不能恢复。建议先导出 JSON 备份。', '确认清空', function () {
        try { localStorage.removeItem(KEY); } catch (e) { /* 存储不可用时只清内存 */ }
        locked = false;
        state = C.emptyState();
        persist(); renderAll();
        $('save-status').textContent = '已清空。';
        showMsg('已清空全部数据。');
      });
    };
    $('confirm-yes').onclick = function () { var a = pending; closeConfirm(); if (a) a(); };
    $('confirm-no').onclick = function () { closeConfirm(); showMsg('已取消,原数据未改动。'); };
    $('export-csv').onclick = exportCsv;
    $('export-svg').onclick = exportSvg;
    $('export-json').onclick = function () { exportJson(); };
    $('save-alert-export').onclick = function () { if (cur()) { exportJson(true); } else showMsg('没有可导出的档案。', 'error'); };
    $('import-btn').onclick = function () { $('import-file').click(); };
    $('import-file').onchange = function (e) { var f = e.target.files && e.target.files[0]; if (f) importFile(f); e.target.value = ''; };

    $('empty-new-form').onsubmit = function (e) { e.preventDefault(); createProfile($('empty-new-name').value, $('empty-new-name')); };
    $('new-form').onsubmit = function (e) { e.preventDefault(); if (createProfile($('new-name').value, $('new-name'))) $('new-name').value = ''; };
    $('profile-tabs').onclick = function (e) {
      var b = e.target.closest('.tab');
      if (!b) return;
      state.activeId = b.dataset.id;
      if (state.compareId === state.activeId) state.compareId = null;
      persist(); renderAll();
    };
    $('clone-profile').onclick = function () {
      var p = cur(); if (!p) return;
      var c = C.cloneProfile(p, p.name + ' 副本');
      state.profiles.push(c); state.activeId = c.id; state.compareId = null;
      var ok = persist(); renderAll();
      showMsg(ok ? '已复制为「' + c.name + '」,可以改名后继续改分(含快照)。' : '已复制,但没有保存到本机,请看上方红色提示。', ok ? 'info' : 'error');
    };
    $('delete-profile').onclick = function () {
      var p = cur(); if (!p) return;
      askConfirm('删除档案「' + p.name + '」及其全部快照,且不能恢复。', '确认删除', function () {
        state.profiles = state.profiles.filter(function (x) { return x.id !== p.id; });
        state.activeId = state.profiles.length ? state.profiles[0].id : null;
        if (!state.compareId || state.compareId === p.id || state.compareId === state.activeId) state.compareId = null;
        persist(); renderAll(); showMsg('已删除档案。');
      });
    };

    $('profile-name').oninput = function (e) {
      var p = cur(), v = e.target.value.trim();
      mark(e.target, v ? null : '档案名称不能为空。');
      var err = $('profile-name-err'); err.textContent = v ? '' : '档案名称不能为空。'; err.hidden = !!v;
      if (!v) return;
      p.name = v; persist(); renderTabs(); renderCompareSelect(); renderRadar();
    };
    $('dim-list').addEventListener('input', onDimInput);
    $('dim-list').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act="remove"]');
      if (!b) return;
      var p = cur(), i = +b.closest('.dim-card').dataset.i;
      askConfirm('删除维度「' + p.dims[i].name + '」(含它的证据)?已存快照不受影响。', '确认删除', function () {
        p.dims.splice(i, 1); persist(); renderAll();
        var nb = $('d' + Math.min(i, p.dims.length - 1) + '-name'); if (nb) nb.focus();
      });
    });
    $('add-dim').onclick = function () {
      var p = cur();
      if (!p || p.dims.length >= C.MAX_DIMS) return;
      p.dims.push(C.newDim(C.uniqueName('新维度', p.dims.map(function (d) { return d.name; })), 0, 0));
      persist(); renderAll();
      var el = $('d' + (p.dims.length - 1) + '-name'); el.focus(); el.select();
    };

    $('show-target').onchange = function (e) { showTarget = e.target.checked; if (cur()) renderRadar(); };
    $('compare-select').onchange = function (e) { state.compareId = e.target.value || null; persist(); renderRadar(); };
    $('weekly-hours').oninput = function (e) {
      var v = parseNonNeg(e.target.value), err = $('weekly-hours-err');
      mark(e.target, v === null ? '请输入不小于 0 的数字。' : null);
      err.textContent = v === null ? '请输入不小于 0 的数字。' : ''; err.hidden = v !== null;
      if (v === null) return;
      cur().weeklyHours = v; persist(); refreshAlloc();
    };
    $('alloc-body').addEventListener('input', function (e) {
      var t = e.target; if (t.dataset.f !== 'weight') return;
      var i = +t.closest('tr').dataset.i, v = parseNonNeg(t.value);
      mark(t, v === null ? '权重需为不小于 0 的数字。' : null);
      if (v === null) { $('alloc-note').textContent = '权重需为不小于 0 的数字(红框处),建议小时暂按上一个有效值计算。'; return; }
      cur().dims[i].weight = v; persist(); refreshAlloc();
    });

    $('snap-add').onclick = function () {
      var p = cur(), date = $('snap-date').value, err = $('snap-err');
      if (!C.isValidDate(date)) { err.textContent = '请选择一个有效的日期。'; err.hidden = false; $('snap-date').setAttribute('aria-invalid', 'true'); $('snap-date').focus(); return; }
      $('snap-date').removeAttribute('aria-invalid');
      err.hidden = true;
      var snap = C.makeSnapshot(p, date), idx = -1;
      p.snapshots.forEach(function (s, k) { if (s.date === date) idx = k; });
      if (idx >= 0) p.snapshots[idx] = snap; else p.snapshots.push(snap);
      var ok = persist(); renderTimeline();
      showMsg(ok ? (idx >= 0 ? '已更新 ' + date + ' 的快照。' : '已记录 ' + date + ' 的快照。') : '快照已记录,但没有保存到本机,请看上方红色提示。', ok ? 'info' : 'error');
    };
    $('snap-body').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act="del-snap"]');
      if (!b) return;
      var date = b.dataset.date, p = cur();
      askConfirm('删除 ' + date + ' 的快照(该日的面积记录,折线图和本月/上月比较随之变化;当前档案分数不受影响)?', '确认删除', function () {
        p.snapshots = p.snapshots.filter(function (s) { return s.date !== date; });
        persist(); renderTimeline();
        var nextBtn = document.querySelector('#snap-body [data-act="del-snap"]'); (nextBtn || $('snap-add')).focus();
      });
    });

    var wrap = $('radar-wrap');
    wrap.addEventListener('mouseover', function (e) { var v = e.target.closest && e.target.closest('.vtx'); if (v) showTip(v); });
    wrap.addEventListener('mouseout', function (e) { var v = e.target.closest && e.target.closest('.vtx'); if (v) hideTip(); });
    wrap.addEventListener('focusin', function (e) { var v = e.target.closest && e.target.closest('.vtx'); if (v) showTip(v); });
    wrap.addEventListener('focusout', function (e) { var v = e.target.closest && e.target.closest('.vtx'); if (v) hideTip(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideTip(); });
  }

  state = load();
  $('snap-date').value = today;
  (function () {
    var fixed = null;
    try { fixed = new URLSearchParams(location.search).get('today'); } catch (e) { fixed = null; }
    if (fixed && fixed === today) { var n = $('today-note'); n.textContent = '基准日 ' + today + '(由地址参数固定)'; n.hidden = false; }
  })();
  bind();
  renderAll();
})();
