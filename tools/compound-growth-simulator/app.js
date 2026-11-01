'use strict';
(function () {
  const C = globalThis.CompoundCore;
  const KEY = 'compound.v1';
  const $ = (s) => document.querySelector(s);
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const REF_DAYS = [100, 365, 1000, 3650];

  let state = C.defaultState();
  let hasSaved = false;
  let userData = false; /* 内存里是否已有用户数据或修改,与是否保存成功无关 */
  let pendingConfirm = null;
  let hover = null;
  let layout = null;

  /* ---------- 存储 ---------- */
  function showSaveWarning(msg) {
    const w = $('#save-warning');
    if (msg) { w.textContent = msg; w.hidden = false; } else { w.hidden = true; }
  }
  function save() {
    const v = C.validateImport(state);
    if (!v.ok) {
      showSaveWarning('当前数据未通过校验,没有保存:' + v.errors.join(';'));
      $('#save-status').textContent = '';
      return false;
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      hasSaved = true;
      showSaveWarning('');
      $('#save-status').textContent = '已保存到本机浏览器';
      return true;
    } catch (e) {
      showSaveWarning('未保存:浏览器拒绝写入本地存储(' + (e && e.name ? e.name : '未知错误') + ')。刷新后修改会丢失,请先点「导出全部情景 JSON」备份。');
      $('#save-status').textContent = '';
      return false;
    }
  }
  function loadSaved() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) {
      $('#load-notice').textContent = '无法读取本地存储,本次修改不会被保留;请用「导出全部情景 JSON」备份。';
      $('#load-notice').hidden = false;
      return;
    }
    if (raw == null) return;
    let obj;
    try { obj = JSON.parse(raw); } catch (e) { obj = null; }
    const v = C.validateImport(obj);
    if (v.ok) { state = v.value; hasSaved = true; userData = true; return; }
    const n = $('#load-notice');
    n.textContent = '本地保存的数据未通过校验,已忽略并使用默认参数(原数据仍在浏览器里,保存新修改后会被覆盖)。';
    n.hidden = false;
  }

  /* ---------- 工具 ---------- */
  const active = () => state.scenarios.find(s => s.id === state.activeId) || state.scenarios[0];
  function el(tag, attrs, text) {
    const e = document.createElement(tag);
    if (attrs) for (const k of Object.keys(attrs)) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function svgEl(tag, attrs) {
    const e = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const k of Object.keys(attrs)) e.setAttribute(k, attrs[k]);
    return e;
  }
  function swatch(cls) { const s = el('span', { class: 'swatch ' + cls }); s.setAttribute('aria-hidden', 'true'); return s; }
  const pct = (r) => C.formatPercent(r);
  function showError(msg) {
    const p = $('#param-error');
    if (msg) { p.textContent = msg; p.hidden = false; } else { p.hidden = true; }
  }
  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function safeFile(name) { return String(name).replace(/[^\w一-龥-]+/g, '_').slice(0, 40) || 'scenario'; }

  /* ---------- 用户编辑入口 ---------- */
  function commit(rebuildParams) {
    state.sample = false;
    userData = true;
    save();
    render(rebuildParams);
  }

  /* ---------- 参数面板:滑杆与数字输入双向联动 ---------- */
  function bindPair(rangeSel, numSel, cfg) {
    const range = $(rangeSel), num = $(numSel);
    function apply(v) { cfg.set(v); range.value = String(v); commit(cfg.rebuild); }
    range.addEventListener('input', () => {
      const v = Number(range.value);
      showError('');
      num.value = String(v);
      apply(v);
    });
    num.addEventListener('input', () => {
      const raw = num.value.trim();
      const v = Number(raw);
      let msg = '';
      if (raw === '' || !Number.isFinite(v)) msg = cfg.label + ':请输入完整的数字。';
      else if (v < cfg.min || v > cfg.max) msg = cfg.label + '必须在 ' + cfg.min + ' 到 ' + cfg.max + ' 之间。';
      else if (cfg.integer && !Number.isInteger(v)) msg = cfg.label + '必须是整数。';
      if (msg) { showError(msg + '(图表保持上一个有效值)'); return; }
      showError('');
      apply(v);
    });
    num.addEventListener('change', () => { showError(''); num.value = String(cfg.get()); });
  }

  function setupParams() {
    $('#p-name').addEventListener('input', (e) => {
      active().name = e.target.value;
      commit(false);
      renderScenarioList();
    });
    bindPair('#r-range', '#r-num', {
      label: '日成长率', min: 0, max: 3,
      get: () => Number((active().r * 100).toFixed(4)),
      set: (v) => { active().r = Number((Math.round(v * 10000) / 10000 / 100).toFixed(8)); }
    });
    bindPair('#t-range', '#t-num', {
      label: '时长 T', min: 30, max: 3650, integer: true, rebuild: true,
      get: () => active().days,
      set: (v) => {
        const s = active();
        s.days = v;
        s.events.forEach(e => { if (e.day > v) e.day = v; });
      }
    });
    bindPair('#rest-range', '#rest-num', {
      label: '每周休息天数', min: 0, max: 6, integer: true,
      get: () => active().restDaysPerWeek,
      set: (v) => { active().restDaysPerWeek = v; }
    });
    $('#add-event').addEventListener('click', () => {
      const s = active();
      s.events.push({ day: Math.min(s.days, Math.max(1, Math.round(s.days / 2))), factor: 0.7 });
      commit(true);
    });
    $('#delete-scenario').addEventListener('click', () => {
      if (state.scenarios.length <= 1) return;
      const cur = active();
      askConfirm('确认删除情景「' + (cur.name || '(未命名)') + '」(r = ' + pct(cur.r) + '%,T = ' + cur.days + ' 天,' + cur.events.length + ' 个倍率事件)?删除后不能撤销,其余 ' + (state.scenarios.length - 1) + ' 组情景保留;确认前数据不变。', () => {
        const idx = state.scenarios.findIndex(s => s.id === state.activeId);
        state.scenarios.splice(idx, 1);
        state.activeId = state.scenarios[Math.max(0, idx - 1)].id;
        commit(true);
        const b = document.querySelector('#scenario-list button[aria-pressed="true"]');
        if (b) b.focus();
      }, '#delete-scenario');
    });
    $('#add-scenario').addEventListener('click', () => {
      if (state.scenarios.length >= C.LIMITS.maxScenarios) return;
      const src = active();
      const id = C.nextId(state.scenarios);
      const copy = JSON.parse(JSON.stringify(src));
      copy.id = id;
      copy.name = '情景 ' + id.slice(1);
      state.scenarios.push(copy);
      state.activeId = id;
      commit(true);
    });
  }

  function renderEvents() {
    const box = $('#events-list');
    box.textContent = '';
    const s = active();
    s.events.forEach((ev, i) => {
      const row = el('div', { class: 'event-row' });
      const dayId = 'ev-day-' + i, facId = 'ev-fac-' + i;
      row.appendChild(el('label', { for: dayId }, '第'));
      const day = el('input', { id: dayId, type: 'number', min: '1', max: String(s.days), step: '1', inputmode: 'numeric' });
      day.value = String(ev.day);
      row.appendChild(day);
      const dayR = el('input', { id: dayId + '-range', type: 'range', min: '1', max: String(s.days), step: '1', class: 'ev-range', 'aria-label': '第 ' + (i + 1) + ' 个倍率事件的日期滑杆' });
      dayR.value = String(ev.day);
      row.appendChild(dayR);
      row.appendChild(el('label', { for: facId }, '天,乘以 k ='));
      const fac = el('input', { id: facId, type: 'number', min: '0.01', max: '10', step: '0.01', inputmode: 'decimal' });
      fac.value = String(ev.factor);
      row.appendChild(fac);
      const facR = el('input', { id: facId + '-range', type: 'range', min: '0.01', max: '10', step: '0.01', class: 'ev-range', 'aria-label': '第 ' + (i + 1) + ' 个倍率事件的倍率 k 滑杆' });
      facR.value = String(ev.factor);
      row.appendChild(facR);
      const del = el('button', { type: 'button', class: 'btn btn-quiet' }, '删除');
      del.setAttribute('aria-label', '删除第 ' + (i + 1) + ' 个倍率事件');
      row.appendChild(del);
      const applyDay = (v) => { showError(''); ev.day = v; dayR.value = String(v); commit(false); };
      const applyFac = (v) => { showError(''); ev.factor = v; facR.value = String(v); commit(false); };
      day.addEventListener('input', () => {
        const v = Number(day.value.trim());
        if (day.value.trim() === '' || !Number.isInteger(v) || v < 1 || v > s.days) {
          showError('事件日必须是 1 到 T(' + s.days + ')之间的整数。(图表保持上一个有效值)');
          return;
        }
        applyDay(v);
      });
      dayR.addEventListener('input', () => { const v = Number(dayR.value); day.value = String(v); applyDay(v); });
      fac.addEventListener('input', () => {
        const v = Number(fac.value.trim());
        if (fac.value.trim() === '' || !Number.isFinite(v) || v < 0.01 || v > 10) {
          showError('倍率 k 必须在 0.01 到 10 之间(小于 1 回退,大于 1 增长)。(图表保持上一个有效值)');
          return;
        }
        applyFac(v);
      });
      facR.addEventListener('input', () => { const v = Number(Number(facR.value).toFixed(2)); fac.value = String(v); applyFac(v); });
      day.addEventListener('change', () => { showError(''); day.value = String(ev.day); });
      fac.addEventListener('change', () => { showError(''); fac.value = String(ev.factor); });
      del.addEventListener('click', () => { s.events.splice(i, 1); commit(true); });
      box.appendChild(row);
    });
    if (!s.events.length) box.appendChild(el('p', { class: 'muted' }, '暂无倍率事件。'));
  }

  function syncParams(rebuild) {
    const s = active();
    const set = (sel, v) => { const e = $(sel); if (document.activeElement !== e) e.value = String(v); };
    if (document.activeElement !== $('#p-name')) $('#p-name').value = s.name;
    const rPct = Number((s.r * 100).toFixed(4));
    ['#r-range', '#r-num'].forEach(x => set(x, rPct));
    ['#t-range', '#t-num'].forEach(x => set(x, s.days));
    ['#rest-range', '#rest-num'].forEach(x => set(x, s.restDaysPerWeek));
    if (rebuild) renderEvents();
    $('#delete-scenario').disabled = state.scenarios.length <= 1;
  }

  function renderScenarioList() {
    const box = $('#scenario-list');
    box.textContent = '';
    state.scenarios.forEach((s, i) => {
      const b = el('button', { type: 'button', class: 'scenario-btn', 'aria-pressed': s.id === state.activeId ? 'true' : 'false', 'data-id': s.id });
      b.appendChild(swatch('c' + i));
      b.appendChild(el('span', null, s.name || '(未命名)'));
      b.addEventListener('click', () => { state.activeId = s.id; showError(''); save(); render(true); });
      box.appendChild(b);
    });
    const full = state.scenarios.length >= C.LIMITS.maxScenarios;
    $('#add-scenario').disabled = full;
    $('#scenario-limit').hidden = !full;
  }

  /* ---------- 图表 ---------- */
  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }
  function axisLabel(v) {
    if (v >= 1e6) return '1e' + Math.round(Math.log10(v));
    return v.toLocaleString('en-US', { maximumFractionDigits: 6 });
  }
  function downsample(series, maxPts) {
    const step = Math.max(1, Math.ceil(series.length / maxPts));
    const out = [];
    for (let i = 0; i < series.length; i += step) out.push(series[i]);
    if (out[out.length - 1].day !== series[series.length - 1].day) out.push(series[series.length - 1]);
    return out;
  }

  function computeSeries() {
    const items = state.scenarios.map((s, i) => ({
      kind: 'scenario', cls: 's' + i, name: s.name || '(未命名)', id: s.id,
      series: C.simulate({ r: s.r, days: s.days, restDaysPerWeek: s.restDaysPerWeek, events: s.events }).series
    }));
    const a = active();
    items.push({ kind: 'linear', cls: 'linear', name: '线性对照(' + (a.name || '未命名') + ')', series: C.linear(a.r, a.days, a.restDaysPerWeek).series });
    if (state.weekly.show) {
      items.push({ kind: 'weekly', cls: 'weekly', name: '周频(每周 ' + pct(state.weekly.r7) + '%)', series: C.simulate({ r: state.weekly.r7, days: a.days, frequency: 'weekly' }).series });
    }
    return items;
  }

  function drawChart() {
    const wrap = $('#chart-wrap'), svg = $('#chart');
    const W = Math.max(260, Math.floor(wrap.clientWidth));
    const H = W < 560 ? 300 : 420;
    const m = { l: 68, r: 16, t: 14, b: 52 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const items = computeSeries();
    if (!items.every(it => it.series.every(p => Number.isFinite(p.value)))) {
      svg.textContent = '';
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      const t = svgEl('text', { class: 'axis-title', x: m.l, y: H / 2 });
      t.textContent = '倍数超出可计算范围,无法绘图:请降低 r、T 或倍率事件的倍率 k。';
      svg.appendChild(t);
      layout = null; hover = null;
      return;
    }
    const maxDay = Math.max.apply(null, items.map(it => it.series.length - 1));
    let vmin = 1, vmax = 1;
    items.forEach(it => it.series.forEach(p => { if (p.value < vmin) vmin = p.value; if (p.value > vmax) vmax = p.value; }));
    const log = state.yScale === 'log';
    let y0, y1, yTicks = [];
    if (log) {
      y0 = Math.pow(10, Math.floor(Math.log10(Math.max(vmin, 1e-6))));
      y1 = Math.pow(10, Math.ceil(Math.log10(vmax)));
      if (y1 <= y0) y1 = y0 * 10;
      for (let v = y0, n = 0; v <= y1 * 1.0000001 && n < 400; v *= 10, n++) yTicks.push(v);
      if (yTicks.length > 8) { const k = Math.ceil(yTicks.length / 7); yTicks = yTicks.filter((_, i) => i % k === 0); }
    } else {
      y0 = Math.min(0, vmin);
      const step = niceStep((vmax - y0) / 5);
      y1 = Math.ceil(vmax / step) * step;
      for (let v = Math.floor(y0 / step) * step; v <= y1 + step / 1e6; v += step) yTicks.push(Number(v.toPrecision(12)));
      y0 = yTicks[0];
    }
    const X = (d) => m.l + (d / maxDay) * pw;
    const Y = (v) => {
      const t = log ? Math.log10(Math.max(v, y0) / y0) / Math.log10(y1 / y0) : (v - y0) / (y1 - y0);
      return m.t + (1 - t) * ph;
    };
    layout = { W, H, m, pw, ph, maxDay, X, Y, items };

    svg.textContent = '';
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    yTicks.forEach(v => {
      const y = Y(v);
      svg.appendChild(svgEl('line', { class: 'grid-line', x1: m.l, x2: W - m.r, y1: y.toFixed(1), y2: y.toFixed(1) }));
      const t = svgEl('text', { class: 'tick', x: m.l - 8, y: (y + 5).toFixed(1), 'text-anchor': 'end' });
      t.textContent = axisLabel(v);
      svg.appendChild(t);
    });
    const xStep = niceStep(maxDay / (W < 560 ? 4 : 7));
    for (let d = 0; d <= maxDay; d += xStep) {
      const x = X(d);
      svg.appendChild(svgEl('line', { class: 'grid-line', x1: x.toFixed(1), x2: x.toFixed(1), y1: m.t, y2: m.t + ph }));
      const t = svgEl('text', { class: 'tick', x: x.toFixed(1), y: m.t + ph + 22, 'text-anchor': d === 0 ? 'start' : 'middle' });
      t.textContent = String(d);
      svg.appendChild(t);
    }
    svg.appendChild(svgEl('line', { class: 'axis-line', x1: m.l, x2: W - m.r, y1: m.t + ph, y2: m.t + ph }));
    svg.appendChild(svgEl('line', { class: 'axis-line', x1: m.l, x2: m.l, y1: m.t, y2: m.t + ph }));
    const xt = svgEl('text', { class: 'axis-title', x: m.l + pw / 2, y: H - 8, 'text-anchor': 'middle' });
    xt.textContent = '天数';
    svg.appendChild(xt);
    const yt = svgEl('text', { class: 'axis-title', x: m.l + 10, y: m.t - 2, 'text-anchor': 'start' });
    yt.textContent = log ? '倍数(对数刻度)' : '倍数';
    yt.setAttribute('transform', 'translate(0 12)');
    svg.appendChild(yt);

    const order = items.filter(it => it.kind === 'linear' || it.kind === 'weekly').concat(items.filter(it => it.kind === 'scenario'));
    order.forEach(it => {
      const pts = downsample(it.series, 900);
      const d = pts.map((p, i) => (i ? 'L' : 'M') + X(p.day).toFixed(1) + ' ' + Y(p.value).toFixed(1)).join('');
      const cls = it.kind === 'scenario' ? 'series ' + it.cls : 'series-' + it.kind;
      const path = svgEl('path', { class: cls, d: d, 'data-name': it.name });
      svg.appendChild(path);
    });

    hover = {
      line: svgEl('line', { class: 'hover-line', y1: m.t, y2: m.t + ph, visibility: 'hidden' }),
      dots: items.filter(it => it.kind === 'scenario').map(it => svgEl('circle', { class: 'hover-dot ' + it.cls, visibility: 'hidden' }))
    };
    svg.appendChild(hover.line);
    hover.dots.forEach(d => svg.appendChild(d));
    const hit = svgEl('rect', { class: 'hit-area', x: m.l, y: m.t, width: pw, height: ph });
    svg.appendChild(hit);
    ['pointermove', 'pointerdown'].forEach(ev => hit.addEventListener(ev, onPointer));
    hit.addEventListener('pointerleave', hideHover);
  }

  function hideHover() {
    $('#tooltip').hidden = true;
    if (hover) { hover.line.setAttribute('visibility', 'hidden'); hover.dots.forEach(d => d.setAttribute('visibility', 'hidden')); }
  }
  function onPointer(e) {
    if (!layout) return;
    const svg = $('#chart');
    const rect = svg.getBoundingClientRect();
    const scale = layout.W / rect.width;
    const px = (e.clientX - rect.left) * scale;
    const day = Math.max(0, Math.min(layout.maxDay, Math.round(((px - layout.m.l) / layout.pw) * layout.maxDay)));
    const x = layout.X(day);
    hover.line.setAttribute('x1', x.toFixed(1)); hover.line.setAttribute('x2', x.toFixed(1)); hover.line.setAttribute('visibility', 'visible');
    const tip = $('#tooltip');
    tip.textContent = '';
    tip.appendChild(el('div', { class: 't-day' }, '第 ' + day + ' 天'));
    let di = 0, topY = layout.m.t;
    layout.items.forEach(it => {
      const p = it.series[day];
      const row = el('div', { class: 't-row' });
      const cls = it.kind === 'scenario' ? 'c' + it.cls.slice(1) : 'c-' + it.kind;
      row.appendChild(swatch(cls));
      row.appendChild(el('span', null, it.name + ':' + (p ? '×' + C.formatMultiple(p.value) : '—(超出时长)')));
      tip.appendChild(row);
      if (it.kind === 'scenario') {
        const dot = hover.dots[di++];
        if (p) { dot.setAttribute('cx', x.toFixed(1)); dot.setAttribute('cy', layout.Y(p.value).toFixed(1)); dot.setAttribute('visibility', 'visible'); }
        else dot.setAttribute('visibility', 'hidden');
      }
    });
    tip.hidden = false;
    const tw = tip.offsetWidth;
    const cssX = x / scale;
    tip.style.left = (cssX + tw + 16 > rect.width ? Math.max(0, cssX - tw - 12) : cssX + 12) + 'px';
    tip.style.top = (topY / scale) + 'px';
  }

  /* ---------- 其余视图 ---------- */
  function renderLegend() {
    const ul = $('#legend');
    ul.textContent = '';
    state.scenarios.forEach((s, i) => {
      const li = el('li');
      li.appendChild(swatch('c' + i));
      li.appendChild(el('span', null, s.name || '(未命名)'));
      ul.appendChild(li);
    });
    const li = el('li'); li.appendChild(swatch('c-linear')); li.appendChild(el('span', null, '线性对照(当前情景)')); ul.appendChild(li);
    if (state.weekly.show) { const w = el('li'); w.appendChild(swatch('c-weekly')); w.appendChild(el('span', null, '周频(每周 ' + pct(state.weekly.r7) + '%)')); ul.appendChild(w); }
  }

  function renderStats() {
    const ul = $('#stats');
    ul.textContent = '';
    state.scenarios.forEach((s, i) => {
      const sim = C.simulate({ r: s.r, days: s.days, restDaysPerWeek: s.restDaysPerWeek, events: s.events });
      const lin = C.linear(s.r, s.days, s.restDaysPerWeek);
      const li = el('li');
      const name = el('div', { class: 'stat-name' });
      name.appendChild(swatch('c' + i));
      name.appendChild(el('span', null, s.name || '(未命名)'));
      li.appendChild(name);
      li.appendChild(el('div', { class: 'stat-big' }, s.days + ' 天后 ×' + C.formatMultiple(sim.final)));
      li.appendChild(el('div', { class: 'muted' }, '线性对照 ×' + C.formatMultiple(lin.final)));
      ul.appendChild(li);
    });
  }

  function renderTable() {
    const s = active();
    const tb = $('#ref-table tbody');
    tb.textContent = '';
    REF_DAYS.forEach(T => {
      const exp = C.simulate({ r: s.r, days: T, restDaysPerWeek: s.restDaysPerWeek, events: s.events }).final;
      const lin = C.linear(s.r, T, s.restDaysPerWeek).final;
      const tr = el('tr');
      tr.appendChild(el('th', { scope: 'row' }, T + ' 天'));
      tr.appendChild(el('td', { class: 'num' }, '×' + C.formatMultiple(exp)));
      tr.appendChild(el('td', { class: 'num' }, '×' + C.formatMultiple(lin)));
      tr.appendChild(el('td', { class: 'num' }, C.formatMultiple(exp / lin) + ' 倍'));
      tb.appendChild(tr);
    });
    const num = $('#target-num');
    if (document.activeElement !== num) num.value = String(state.target);
    const res = $('#target-result');
    const d = C.daysToReach(s.r, state.target, s.restDaysPerWeek);
    if (d == null) res.textContent = '用当前 r 与休息天数永远达不到 ×' + C.formatMultiple(state.target) + '(r 为 0)。';
    else res.textContent = '到 ×' + C.formatMultiple(state.target) + ' 需要 ' + d.toLocaleString('en-US') + ' 天(约 ' + (d / 365).toFixed(1) + ' 年)。不含倍率事件。';
  }

  function renderCompare() {
    const tb = $('#compare-table tbody');
    tb.textContent = '';
    const note = $('#compare-note');
    if (state.scenarios.length < 2) {
      note.textContent = '再新增一组情景(最多 3 组)即可并排比较;现在只显示当前这一组。';
    }
    const res = C.compare(state.scenarios);
    if (state.scenarios.length >= 2) note.textContent = '比较口径:所有情景统一看第 ' + res.T + ' 天(各情景时长的最小值);「达到 2×」按各自参数从第 1 天起算。';
    res.rows.forEach(r => {
      const tr = el('tr');
      tr.appendChild(el('td', null, String(r.rank)));
      const nameTd = el('td');
      const ni = state.scenarios.findIndex(s => s.id === r.id);
      const wrap = el('span', { class: 'stat-name' });
      wrap.appendChild(swatch('c' + ni));
      wrap.appendChild(el('span', null, r.name || '(未命名)'));
      nameTd.appendChild(wrap);
      tr.appendChild(nameTd);
      tr.appendChild(el('td', { class: 'num' }, '×' + C.formatMultiple(r.value)));
      tr.appendChild(el('td', { class: 'num' }, r.diffToBest === 0 ? '—' : '−' + C.formatMultiple(-r.diffToBest)));
      tr.appendChild(el('td', { class: 'num' }, r.daysTo2 == null ? '达不到' : r.daysTo2 + ' 天'));
      tr.appendChild(el('td', { class: 'num' }, r.daysTo2Diff == null ? '—' : (r.daysTo2Diff === 0 ? '最快' : '+' + r.daysTo2Diff + ' 天')));
      tb.appendChild(tr);
    });
  }

  function renderWeekly() {
    const s = active();
    const r7pct = Number((state.weekly.r7 * 100).toFixed(4));
    ['#r7-range', '#r7-num'].forEach(x => { const e = $(x); if (document.activeElement !== e) e.value = String(r7pct); });
    $('#weekly-show').checked = state.weekly.show;
    const wk = C.weeklyEquivalent(s.r);
    const dd = C.dailyEquivalent(state.weekly.r7);
    const daily = C.simulate({ r: s.r, days: s.days }).final;
    const weekly = C.simulate({ r: state.weekly.r7, days: s.days, frequency: 'weekly' }).final;
    const none = C.formatMultiple(1);
    const ul = $('#weekly-info');
    ul.textContent = '';
    [
      '日频 r = ' + pct(s.r) + '% 等效每周 ' + pct(wk) + '%(算式:(1+r)^7 − 1)。',
      '周频 r₇ = ' + pct(state.weekly.r7) + '% 等效每天 ' + pct(dd) + '%(算式:(1+r₇)^(1/7) − 1)。',
      s.days + ' 天后:日频 ×' + C.formatMultiple(daily) + ';周频 ×' + C.formatMultiple(weekly) + ';完全不进步 ×' + none + '。',
      state.weekly.r7 > 0 ? '周频只要每周进步 ' + pct(state.weekly.r7) + '%,' + s.days + ' 天后就是没进步的 ' + C.formatMultiple(weekly) + ' 倍。' : 'r₇ 为 0 时周频曲线与「没进步」重合。'
    ].forEach(t => ul.appendChild(el('li', null, t)));
  }

  function render(rebuildParams) {
    syncParams(!!rebuildParams);
    renderScenarioList();
    renderLegend();
    drawChart();
    renderStats();
    renderTable();
    renderCompare();
    renderWeekly();
    $('#y-scale').value = state.yScale;
    $('#sample-badge').hidden = !state.sample;
    $('#empty-guide').hidden = hasSaved;
  }

  /* ---------- 确认区 / 载入 / 清空 / 导入导出 ---------- */
  let confirmReturn = null;
  function askConfirm(message, onYes, returnSel) {
    pendingConfirm = onYes;
    confirmReturn = returnSel || '';
    $('#confirm-text').textContent = message;
    $('#confirm-box').hidden = false;
    $('#confirm-yes').focus();
  }
  function closeConfirm(restore) {
    pendingConfirm = null; $('#confirm-box').hidden = true;
    if (restore === 'cancel' && confirmReturn) { const t = $(confirmReturn); if (t && !t.disabled) t.focus(); }
  }

  function replaceState(next) {
    state = next;
    userData = true;
    save();
    showError('');
    render(true);
  }

  function setupActions() {
    $('#confirm-yes').addEventListener('click', () => { const f = pendingConfirm; closeConfirm(); if (f) f(); });
    $('#confirm-no').addEventListener('click', () => closeConfirm('cancel'));
    $('#pick-import').addEventListener('click', () => $('#import-file').click());
    $('#load-sample').addEventListener('click', () => {
      const go = () => replaceState(JSON.parse(JSON.stringify(globalThis.COMPOUND_SAMPLE)));
      if (userData) askConfirm('载入示例会替换你当前保存的全部情景。确认替换吗?(可先导出 JSON 备份)', go);
      else go();
    });
    $('#clear-data').addEventListener('click', () => {
      askConfirm('清空会删除本机保存的全部情景并恢复默认参数。确认清空吗?', () => {
        try { localStorage.removeItem(KEY); } catch (e) { /* 读写失败时仍重置界面 */ }
        hasSaved = false;
        userData = false;
        showSaveWarning('');
        $('#save-status').textContent = '已清空';
        state = C.defaultState();
        render(true);
      });
    });
    $('#y-scale').addEventListener('change', (e) => { state.yScale = e.target.value; commit(false); });
    $('#weekly-show').addEventListener('change', (e) => { state.weekly.show = e.target.checked; commit(false); });
    bindWeekly();
    $('#target-num').addEventListener('input', (e) => {
      const raw = e.target.value.trim(), v = Number(raw);
      if (raw === '' || !Number.isFinite(v) || v <= 0 || v > C.LIMITS.targetMax) { showError('目标倍数必须是大于 0 且不超过 ' + C.LIMITS.targetMax.toExponential(0) + ' 的数。(结果保持上一个有效值)'); return; }
      showError(''); state.target = v; commit(false);
    });
    $('#target-num').addEventListener('change', (e) => { showError(''); e.target.value = String(state.target); });
    $('#export-csv').addEventListener('click', () => {
      download('compound-' + safeFile(active().name) + '.csv', '﻿' + C.toCsv(active()), 'text/csv;charset=utf-8');
    });
    $('#export-json').addEventListener('click', () => {
      download('compound-scenarios.json', JSON.stringify(state, null, 2), 'application/json');
    });
    $('#import-file').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      const box = $('#import-error');
      box.hidden = true;
      let obj = null, text = '';
      try { text = await f.text(); obj = JSON.parse(text); } catch (err) {
        showImportErrors(['文件不是有效的 JSON。']);
        return;
      }
      const v = C.validateImport(obj);
      if (!v.ok) { showImportErrors(v.errors); return; }
      const go = () => replaceState(v.value);
      if (userData) askConfirm('导入会替换你当前保存的全部情景(' + v.value.scenarios.length + ' 组)。确认替换吗?', go);
      else go();
    });
  }
  function showImportErrors(errors) {
    const box = $('#import-error');
    box.textContent = '导入被拒绝,没有任何改动:';
    const ul = el('ul');
    errors.forEach(t => ul.appendChild(el('li', null, t)));
    box.appendChild(ul);
    box.hidden = false;
  }

  function bindWeekly() {
    const range = $('#r7-range'), num = $('#r7-num');
    const apply = (pctVal) => { state.weekly.r7 = Number((pctVal / 100).toFixed(8)); range.value = String(pctVal); commit(false); };
    range.addEventListener('input', () => { showError(''); num.value = range.value; apply(Number(range.value)); });
    num.addEventListener('input', () => {
      const raw = num.value.trim(), v = Number(raw);
      if (raw === '' || !Number.isFinite(v) || v < 0 || v > 25) { showError('周频 r₇ 必须在 0 到 25 之间。(图表保持上一个有效值)'); return; }
      showError(''); apply(v);
    });
    num.addEventListener('change', () => { showError(''); num.value = String(Number((state.weekly.r7 * 100).toFixed(4))); });
  }

  /* ---------- 启动 ---------- */
  function init() {
    loadSaved();
    setupParams();
    setupActions();
    render(true);
    let raf = 0, lastW = 0;
    const ro = new ResizeObserver(() => {
      const w = $('#chart-wrap').clientWidth;
      if (w === lastW) return;
      lastW = w;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(drawChart);
    });
    ro.observe($('#chart-wrap'));
  }
  init();
})();
