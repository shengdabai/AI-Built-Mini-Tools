'use strict';
(function () {
  const C = globalThis.ResaleCore;
  const KEY = 'resale.v1';
  const SVGNS = 'http://www.w3.org/2000/svg';
  const $ = id => document.getElementById(id);
  const TODAY = C.resolveToday(location.search, new Date());
  const THIS_MONTH = C.monthOf(TODAY);
  const HEAT_MONTHS = 12;

  let state = { channels: C.DEFAULT_CHANNELS.slice(), works: [], sample: false };
  let month = THIS_MONTH;     // 月报与导出共用的月份
  let editingWork = null;     // 正在编辑的作品 id
  let editingResale = null;   // 正在编辑的再售记录 { workId, rid }
  let selectedWorkId = null;
  let pendingAction = null;
  let toastTimer = null;

  // ---------- 小工具 ----------
  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else n.setAttribute(k, v);
    }
    for (const c of children || []) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return n;
  }
  function svg(tag, attrs, text) {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v));
    if (text !== undefined) n.textContent = text;
    return n;
  }
  const clone = o => JSON.parse(JSON.stringify(o));
  const fmtNum = v => String(C.round2(v));
  const tokenNum = name => Number(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
  const truncate = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);

  // ---------- 存储(写入与读取同用 validateState) ----------
  function showWarning(msg) { $('save-warning-text').textContent = msg; $('save-warning').hidden = false; }
  function clearWarning() { $('save-warning').hidden = true; }
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
  }
  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { showWarning('浏览器存储不可用:本次填的内容不会被保存。请随时到「导出与数据」导出 JSON 备份。'); return; }
    if (!raw) return;
    let parsed = null, v = { ok: false, error: '存储内容不是合法 JSON' };
    try { parsed = JSON.parse(raw); v = C.validateState(parsed); } catch (e) { /* 保持 v 为失败 */ }
    if (v.ok) { state = v.state; return; }
    try { localStorage.setItem(KEY + '.rejected', raw); } catch (e) { /* 备份失败也不阻断提示 */ }
    showWarning('已保存的数据没有通过校验,已忽略(原文另存在 ' + KEY + '.rejected 里):' + v.error);
  }
  // 返回是否真正写入;成功提示只在写入后出现
  function save() {
    const v = C.validateState(state);
    if (!v.ok) { showWarning('未保存:数据没有通过校验(' + v.error + ')。请到「导出与数据」导出 JSON 备份。'); return false; }
    state = v.state;
    try { localStorage.setItem(KEY, JSON.stringify({ sample: state.sample, channels: state.channels, works: state.works })); }
    catch (e) { showWarning('未保存:浏览器存储不可用或已满。本次改动只在内存里,请立刻到「导出与数据」导出 JSON 备份。'); return false; }
    clearWarning(); toast('已保存');
    return true;
  }

  // ---------- 表单草稿(确认与导出判据) ----------
  const val = id => $(id).value.trim();
  function workFormDirty() {
    if (editingWork) {
      const w = state.works.find(x => x.id === editingWork);
      if (!w) return false;
      return val('w-title') !== w.title || $('w-type').value !== w.type || $('w-date').value !== w.createdOn || val('w-hours') !== String(w.hours);
    }
    return !!(val('w-title') || val('w-hours'));
  }
  function resaleFormDirty() {
    if (editingResale) {
      const w = state.works.find(x => x.id === editingResale.workId), r = w && w.resales.find(x => x.id === editingResale.rid);
      if (!r) return false;
      return $('r-date').value !== r.date || $('r-channel').value !== r.channel || $('r-form').value !== r.form || val('r-extra') !== String(r.extraHours) ||
        val('r-reach') !== (r.reach === null ? '' : String(r.reach)) || val('r-revenue') !== (r.revenueCents === null ? '' : C.fmtCents(r.revenueCents)) || val('r-sale-ref') !== (r.saleRef || '');
    }
    return !!(val('r-reach') || val('r-revenue') || val('r-sale-ref') || (val('r-extra') !== '0' && val('r-extra') !== ''));
  }
  function drafts() {
    const d = [];
    if (workFormDirty()) d.push(editingWork ? '“编辑作品”表单里未保存的修改' : '“新增作品”表单里未提交的内容');
    if (resaleFormDirty()) d.push(editingResale ? '“编辑再售记录”表单里未保存的修改' : '“记一次再售”表单里未提交的内容');
    if (val('c-name')) d.push('“新增渠道”里未提交的内容');
    return d;
  }
  const draftTail = () => (drafts().length ? ',以及' + drafts().join('、') : '');
  const userHasData = () => !C.isPristine(state) || drafts().length > 0;
  /* 左侧表单有未保存内容时,普通导出暂停(导出的是已保存数据);存储失败条里的备份按钮不受影响 */
  function syncExport() {
    const d = drafts();
    for (const id of ['export-csv', 'export-md', 'export-json']) $(id).disabled = d.length > 0;
    const n = $('export-lock');
    n.hidden = d.length === 0;
    n.textContent = d.length ? '导出已暂停:' + d.join('、') + '。请先在“账本”页保存或取消,再导出。保存失败时可用页面上方的“导出当前内存中的全部账本 JSON 备份”。' : '';
  }
  function markBad(id) {
    ['w-title', 'w-type', 'w-date', 'w-hours', 'r-work', 'r-date', 'r-channel', 'r-form', 'r-extra', 'r-reach', 'r-revenue', 'r-sale-ref', 'c-name'].forEach(x => $(x).removeAttribute('aria-invalid'));
    if (id) { $(id).setAttribute('aria-invalid', 'true'); $(id).focus(); }
  }

  // ---------- 页内确认 ----------
  function askConfirm(title, text, yesLabel, fn) {
    pendingAction = fn;
    $('confirm-title').textContent = title; $('confirm-text').textContent = text;
    $('confirm-yes').textContent = yesLabel; $('confirm').hidden = false;
    $('confirm-no').focus();
  }
  function closeConfirm() { pendingAction = null; $('confirm').hidden = true; }

  // ---------- 表单区 ----------
  function fillSelect(sel, values, keep) {
    const cur = keep ? sel.value : '';
    sel.replaceChildren(...values.map(v => el('option', { value: v, text: v })));
    if (cur && values.includes(cur)) sel.value = cur;
  }
  function renderForms() {
    fillSelect($('w-type'), C.TYPES, true);
    fillSelect($('r-form'), C.FORMS, true);
    fillSelect($('r-channel'), state.channels, true);
    const sel = $('r-work');
    const cur = sel.value;
    if (state.works.length) {
      sel.replaceChildren(...state.works.map(w => el('option', { value: w.id, text: w.title })));
      sel.value = state.works.some(w => w.id === cur) ? cur : state.works[0].id;
    } else sel.replaceChildren(el('option', { value: '', text: '(先新增作品)' }));
    $('r-submit').disabled = !state.works.length;
    if (!$('w-date').value) $('w-date').value = TODAY;
    if (!$('r-date').value) $('r-date').value = TODAY;
    $('channel-list').replaceChildren(...state.channels.map(c => el('li', { text: c })));
  }
  function showErr(id, msg) { const n = $(id); n.textContent = msg || ''; n.hidden = !msg; }

  const badWorkField = e => (/标题/.test(e) ? 'w-title' : /类型/.test(e) ? 'w-type' : /日期/.test(e) ? 'w-date' : /耗时/.test(e) ? 'w-hours' : 'w-title');
  function resetWorkForm() {
    editingWork = null;
    $('w-title').value = ''; $('w-hours').value = ''; $('w-date').value = TODAY;
    $('h-addwork').textContent = '新增作品'; $('w-submit').textContent = '添加作品'; $('w-cancel').hidden = true;
    showErr('work-error', ''); markBad(null);
  }
  function addWork(ev) {
    ev.preventDefault();
    markBad(null);
    const h = C.parseHours($('w-hours').value);
    if (!h.ok) { showErr('work-error', '首次耗时:' + h.error); markBad('w-hours'); return; }
    const fields = { title: $('w-title').value.trim(), type: $('w-type').value, createdOn: $('w-date').value, hours: h.value };
    if (editingWork) {
      const r = C.updateWork(state, editingWork, fields);
      if (!r.ok) { showErr('work-error', r.error); markBad(badWorkField(r.error)); return; }
      state = r.state; selectedWorkId = editingWork;
      const id = editingWork;
      resetWorkForm();
      save(); renderAll(); toast('已保存对作品的修改(再售记录保留)');
      const b = document.querySelector('#works-body tr[data-work="' + id + '"] [data-act="edit"]');
      if (b) b.focus();
      return;
    }
    const w = Object.assign({ id: C.newId('w'), resales: [] }, fields);
    const e = C.validateWork(w, state.channels);
    if (e) { showErr('work-error', e); markBad(badWorkField(e)); return; }
    showErr('work-error', '');
    state.works.push(w); selectedWorkId = w.id;
    $('w-title').value = ''; $('w-hours').value = '';
    save(); renderAll(); $('r-work').value = w.id;
  }
  function startEditWork(id) {
    const w = state.works.find(x => x.id === id); if (!w) return;
    editingWork = id;
    $('w-title').value = w.title; $('w-type').value = w.type; $('w-date').value = w.createdOn; $('w-hours').value = String(w.hours);
    $('h-addwork').textContent = '编辑作品「' + w.title + '」'; $('w-submit').textContent = '保存修改'; $('w-cancel').hidden = false;
    showErr('work-error', ''); syncExport();
    $('w-title').focus();
  }
  function resetResaleForm() {
    editingResale = null;
    $('r-reach').value = ''; $('r-revenue').value = ''; $('r-sale-ref').value = ''; $('r-extra').value = '0'; $('r-date').value = TODAY;
    $('h-addresale').textContent = '记一次再售'; $('r-submit').textContent = '记录再售'; $('r-cancel').hidden = true; $('r-work').disabled = false;
    showErr('resale-error', ''); markBad(null);
  }
  const badResaleField = e => (/交易引用/.test(e) ? 'r-sale-ref' : /日期/.test(e) ? 'r-date' : /渠道/.test(e) ? 'r-channel' : /形式/.test(e) ? 'r-form' : /额外/.test(e) ? 'r-extra' : /触达/.test(e) ? 'r-reach' : /收入/.test(e) ? 'r-revenue' : 'r-date');
  function addResale(ev) {
    ev.preventDefault();
    markBad(null);
    const work = state.works.find(w => w.id === (editingResale ? editingResale.workId : $('r-work').value));
    if (!work) { showErr('resale-error', '请先选择作品'); markBad('r-work'); return; }
    const extra = C.parseHours($('r-extra').value), reach = C.parseReach($('r-reach').value), rev = C.parseYuan($('r-revenue').value);
    for (const [name, p, id] of [['额外耗时', extra, 'r-extra'], ['触达', reach, 'r-reach'], ['收入', rev, 'r-revenue']]) if (!p.ok) { showErr('resale-error', name + ':' + p.error); markBad(id); return; }
    const fields = { date: $('r-date').value, channel: $('r-channel').value, form: $('r-form').value, extraHours: extra.value, reach: reach.value, revenueCents: rev.value, saleRef: C.normalizeSaleRef($('r-sale-ref').value) };
    if (editingResale) {
      const u = C.updateResale(state, editingResale.workId, editingResale.rid, fields);
      if (!u.ok) { showErr('resale-error', u.error); markBad(badResaleField(u.error)); return; }
      state = u.state; selectedWorkId = work.id;
      const rid = editingResale.rid;
      resetResaleForm();
      save(); renderAll(); $('r-work').value = work.id; toast('已保存对这条再售记录的修改');
      const b = document.querySelector('#records [data-resale-row="' + rid + '"] [data-edit-resale]');
      if (b) b.focus();
      return;
    }
    const r = Object.assign({ id: C.newId('r') }, fields);
    const e = C.validateResale(r, state.channels);
    if (e) { showErr('resale-error', e); markBad(badResaleField(e)); return; }
    const candidate = C.validateState(Object.assign({}, state, { works: state.works.map(x => x.id === work.id ? Object.assign({}, x, { resales: [...x.resales, r] }) : x) }));
    if (!candidate.ok) { showErr('resale-error', candidate.error); markBad(badResaleField(candidate.error)); return; }
    showErr('resale-error', '');
    work.resales.push(r); selectedWorkId = work.id;
    $('r-reach').value = ''; $('r-revenue').value = ''; $('r-sale-ref').value = ''; $('r-extra').value = '0';
    save(); renderAll(); $('r-work').value = work.id;
  }
  function startEditResale(rid) {
    const w = state.works.find(x => x.id === selectedWorkId), r = w && w.resales.find(x => x.id === rid); if (!r) return;
    editingResale = { workId: w.id, rid };
    $('r-work').value = w.id; $('r-work').disabled = true;
    $('r-date').value = r.date; $('r-channel').value = r.channel; $('r-form').value = r.form;
    $('r-extra').value = String(r.extraHours); $('r-reach').value = r.reach === null ? '' : String(r.reach);
    $('r-revenue').value = r.revenueCents === null ? '' : C.fmtCents(r.revenueCents);
    $('r-sale-ref').value = r.saleRef || '';
    $('h-addresale').textContent = '编辑「' + w.title + '」的一条再售记录'; $('r-submit').textContent = '保存修改'; $('r-cancel').hidden = false;
    showErr('resale-error', ''); syncExport();
    $('r-date').focus();
  }
  function addChannel(ev) {
    ev.preventDefault();
    const name = $('c-name').value.trim();
    const next = { channels: [...state.channels, name], works: state.works };
    const v = name ? C.validateState(next) : { ok: false, error: '渠道名不能为空' };
    if (!v.ok) { showErr('channel-error', v.error); $('c-name').setAttribute('aria-invalid', 'true'); $('c-name').focus(); return; }
    $('c-name').removeAttribute('aria-invalid');
    showErr('channel-error', '');
    state.channels.push(name); $('c-name').value = '';
    save(); renderAll();
  }

  // ---------- 月报 ----------
  function reportMonth() { return month; }
  function renderMonth() {
    const m = reportMonth();
    const cur = C.monthly(state.works, m), prev = C.monthly(state.works, C.shiftMonth(m, -1)), cmp = C.compare(cur, prev);
    const sign = x => (x === null ? '无法比较' : (x > 0 ? '+' : '') + fmtNum(x));
    const card = (label, stat, vs) => el('div', { class: 'card' }, [el('span', { class: 'label', text: label }), el('span', { class: 'stat', text: stat }), el('span', { class: 'vs', text: vs })]);
    $('month-cards').replaceChildren(
      card('本月新作品数', String(cmp.newWorks.a), `上月 ${cmp.newWorks.b} · 变化 ${sign(cmp.newWorks.delta)}`),
      card('本月复售次数', String(cmp.resales.a), `上月 ${cmp.resales.b} · 变化 ${sign(cmp.resales.delta)}`),
      card('每小时被售次数', cmp.perHour.a === null ? '无耗时' : fmtNum(cmp.perHour.a), `上月 ${cmp.perHour.b === null ? '无耗时' : fmtNum(cmp.perHour.b)} · 变化 ${sign(cmp.perHour.delta)}`)
    );
  }

  // ---------- 提示 ----------
  const KIND_LABEL = { rewrite: '可改写候选', duplicate: '重复', redo: '重做' };
  function renderHints() {
    const hs = C.hints(state.works, TODAY);
    $('hints').replaceChildren(...(hs.length
      ? hs.map(h => el('li', { 'data-kind': h.kind }, [el('span', { class: 'kind', text: KIND_LABEL[h.kind] }), `「${h.title}」${h.text}`]))
      : [el('li', { class: 'none', text: '暂无提示。' })]));
  }

  // ---------- 热力格 ----------
  function levelOf(count, max) {
    if (count <= 0 || max <= 0) return 0;
    const r = count / max;
    return r <= 0.25 ? 1 : r <= 0.5 ? 2 : r <= 0.75 ? 3 : 4;
  }
  function renderHeat() {
    const months = C.monthRange(THIS_MONTH, HEAT_MONTHS);
    const hm = C.heatmap(state.works, months);
    const grid = el('div', { class: 'heat', role: 'group', 'aria-label': '作品乘月份的复售次数' });
    grid.style.setProperty('--heat-cols', String(months.length));
    grid.appendChild(el('div', { class: 'heat-head', text: '作品' }));
    for (const m of months) grid.appendChild(el('div', { class: 'heat-head', title: m, text: `${Number(m.slice(5))}月` }));
    for (const row of hm.rows) {
      grid.appendChild(el('div', { class: 'heat-title', title: row.title, text: row.title }));
      row.cells.forEach((n, i) => grid.appendChild(el('div', {
        class: `heat-cell lv${levelOf(n, hm.max)}`, 'data-work': row.workId, 'data-month': months[i], 'data-count': String(n), role: 'img',
        'aria-label': `${row.title} ${months[i]} 售出 ${n} 次`, text: n ? String(n) : ''
      })));
    }
    if (hm.rows.length) {
      grid.appendChild(el('div', { class: 'heat-total-label', text: '合计' }));
      hm.totals.forEach((n, i) => grid.appendChild(el('div', { class: 'heat-total', 'data-month': months[i], 'data-total': String(n), text: String(n) })));
    }
    $('heatmap').replaceChildren(hm.rows.length ? grid : el('p', { class: 'muted', text: '没有作品时没有热力格。' }));
  }

  // ---------- 散点(内联 SVG,数据生成) ----------
  function niceMax(v) {
    if (!(v > 0)) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    for (const k of [1, 2, 2.5, 5, 10]) if (k * pow >= v) return k * pow;
    return 10 * pow;
  }
  function renderScatter() {
    const box = $('scatter');
    const pts = C.scatter(state.works);
    if (!pts.length) { box.replaceChildren(el('p', { class: 'muted', text: '没有作品时没有散点。' })); return; }
    const W = Math.max(300, box.clientWidth || 640);
    const H = Math.round(Math.max(300, Math.min(W * 0.6, 440)));
    const M = { l: 56, r: 40, t: 36, b: 52 };
    const pw = W - M.l - M.r, ph = H - M.t - M.b;
    const xMax = niceMax(Math.max(...pts.map(p => p.hours)));
    const yMax = Math.max(1, Math.ceil(Math.max(...pts.map(p => p.count)) / 1));
    const yStep = Math.max(1, Math.ceil(yMax / 5)), yTop = Math.ceil(yMax / yStep) * yStep;
    const maxReach = Math.max(...pts.map(p => p.reach));
    const rMin = tokenNum('--chart-r-min'), rMax = tokenNum('--chart-r-max');
    const X = v => M.l + (v / xMax) * pw, Y = v => M.t + ph - (v / yTop) * ph;
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '时间投入与售出次数散点图' });
    for (let v = 0; v <= yTop; v += yStep) {
      s.appendChild(svg('line', { class: 'grid-line', x1: M.l, x2: M.l + pw, y1: Y(v), y2: Y(v) }));
      s.appendChild(svg('text', { class: 'tick', x: M.l - 8, y: Y(v) + 5, 'text-anchor': 'end' }, String(v)));
    }
    for (let i = 0; i <= 4; i++) {
      const v = (xMax / 4) * i;
      s.appendChild(svg('line', { class: 'grid-line', x1: X(v), x2: X(v), y1: M.t, y2: M.t + ph }));
      s.appendChild(svg('text', { class: 'tick', x: X(v), y: M.t + ph + 24, 'text-anchor': 'middle' }, fmtNum(v)));
    }
    s.appendChild(svg('line', { class: 'axis-line', x1: M.l, x2: M.l + pw, y1: M.t + ph, y2: M.t + ph }));
    s.appendChild(svg('line', { class: 'axis-line', x1: M.l, x2: M.l, y1: M.t, y2: M.t + ph }));
    s.appendChild(svg('text', { class: 'axis-title', x: M.l + pw / 2, y: H - 6, 'text-anchor': 'middle' }, '累计耗时(小时)'));
    s.appendChild(svg('text', { class: 'axis-title', x: 14, y: M.t + ph / 2, 'text-anchor': 'middle', transform: `rotate(-90 14 ${M.t + ph / 2})` }, '被售次数'));
    for (const p of pts) {
      const r = maxReach > 0 ? rMin + (rMax - rMin) * Math.sqrt(p.reach / maxReach) : rMin;
      const cx = X(p.hours), cy = Y(p.count);
      const c = svg('circle', { class: 'dot', 'data-work': p.id, cx: cx.toFixed(2), cy: cy.toFixed(2), r: r.toFixed(2) });
      c.appendChild(svg('title', {}, `${p.title}:耗时 ${fmtNum(p.hours)} 小时,售出 ${p.count} 次,触达合计 ${p.reach}`));
      s.appendChild(c);
    }
    for (const p of pts) {
      const r = maxReach > 0 ? rMin + (rMax - rMin) * Math.sqrt(p.reach / maxReach) : rMin;
      const cx = X(p.hours), cy = Y(p.count), left = cx > M.l + pw * 0.7;
      s.appendChild(svg('text', { class: 'dot-label', x: (left ? cx - r - 6 : cx + r + 6).toFixed(2), y: (cy + 5).toFixed(2), 'text-anchor': left ? 'end' : 'start' }, truncate(p.title, 8)));
    }
    box.replaceChildren(s);
  }

  // ---------- 渠道条形 ----------
  function renderBars() {
    const stats = C.channelStats(state.works);
    if (!stats.length) { $('channels-bars').replaceChildren(el('p', { class: 'muted', text: '还没有再售记录。' })); return; }
    const max = stats[0].count;
    $('channels-bars').replaceChildren(...stats.map(e => {
      const fill = el('div', { class: 'bar-fill' });
      fill.style.width = (e.count / max * 100).toFixed(1) + '%';
      const meta = `${e.count} 次 · 占 ${Math.round(e.share * 100)}% · 触达 ${e.reach}` + (e.revenueCents === null ? '' : ` · 收入 ${C.fmtCents(e.revenueCents)} 元`);
      return el('div', { class: 'bar-row', 'data-channel': e.channel }, [
        el('span', { class: 'bar-name', text: e.channel }),
        el('div', {}, [el('div', { class: 'bar-track' }, [fill]), el('div', { class: 'bar-meta', text: meta })])
      ]);
    }));
  }

  // ---------- 作品表与记录 ----------
  function renderWorks() {
    $('works-body').replaceChildren(...state.works.map(w => {
      const ph = C.perHour(w), rph = C.revenuePerHour(w);
      const open = el('button', { type: 'button', class: 'small-btn', 'data-act': 'records', text: '记录' });
      const add = el('button', { type: 'button', class: 'small-btn', 'data-act': 'add', text: '记再售' });
      const edit = el('button', { type: 'button', class: 'small-btn', 'data-act': 'edit', 'aria-label': `编辑作品 ${w.title}`, text: '编辑' });
      const del = el('button', { type: 'button', class: 'small-btn danger', 'data-act': 'delete', 'aria-label': `删除作品 ${w.title}`, text: '删除' });
      return el('tr', { 'data-work': w.id }, [
        el('td', { text: w.title }), el('td', { text: w.type }), el('td', { text: w.createdOn }), el('td', { class: 'num', text: fmtNum(w.hours) }),
        el('td', { class: 'num count', text: String(C.resaleCount(w)) }),
        el('td', { class: 'num hours', text: fmtNum(C.hoursTotal(w)) }),
        el('td', { class: 'num per-hour', text: ph === null ? '无(耗时为 0)' : fmtNum(ph) }),
        el('td', { class: 'num rev-hour', text: rph === null ? C.revenueLabel(w) : C.fmtCents(rph) + ' 元' }),
        el('td', {}, [el('div', { class: 'row' }, [add, open, edit, del])])
      ]);
    }));
    if (!state.works.length) $('works-body').replaceChildren(el('tr', {}, [el('td', { colspan: '9', class: 'muted', text: '还没有作品。' })]));
  }
  function renderRecords() {
    const box = $('records');
    const w = state.works.find(x => x.id === selectedWorkId);
    if (!w || box.dataset.open !== w.id) { box.hidden = true; return; }
    const items = [...w.resales].sort((a, b) => (a.date < b.date ? 1 : -1)).map(r => {
      const parts = [r.date, r.channel, r.form, r.saleRef ? `交易引用 ${r.saleRef}` : '交易引用未填', `额外 ${fmtNum(r.extraHours)} 小时`, r.reach === null ? '触达未填' : `触达 ${r.reach}`, r.revenueCents === null ? '收入未填' : `收入 ${C.fmtCents(r.revenueCents)} 元`];
      const b = el('button', { type: 'button', class: 'small-btn danger', 'data-resale': r.id, text: '删除这条' });
      const eb = el('button', { type: 'button', class: 'small-btn', 'data-edit-resale': r.id, text: '编辑这条' });
      return el('li', { 'data-resale-row': r.id }, [el('span', { text: parts.join(' · ') }), eb, b]);
    });
    box.replaceChildren(el('h3', { text: `「${w.title}」的再售记录(${w.resales.length} 条)` }), items.length ? el('ul', {}, items) : el('p', { class: 'muted', text: '这部作品还没有再售记录。' }));
    box.hidden = false;
  }
  function onWorksClick(ev) {
    const btn = ev.target.closest('button[data-act]'); if (!btn) return;
    const id = btn.closest('tr').dataset.work, w = state.works.find(x => x.id === id);
    if (!w) return;
    if (btn.dataset.act === 'edit') { startEditWork(id); return; }
    if (btn.dataset.act === 'add') { selectedWorkId = id; $('r-work').value = id; $('r-date').focus(); }
    else if (btn.dataset.act === 'records') {
      const box = $('records');
      box.dataset.open = box.dataset.open === id && !box.hidden ? '' : id; selectedWorkId = id; renderRecords();
    } else askConfirm(`确认删除作品「${w.title}」?`, `它的 ${w.resales.length} 条再售记录会一起删除,无法恢复。建议先导出 JSON 备份。`, '确认删除', () => {
      state.works = state.works.filter(x => x.id !== id); if (selectedWorkId === id) selectedWorkId = null;
      if (editingWork === id) resetWorkForm();
      if (editingResale && editingResale.workId === id) resetResaleForm();
      if (!state.works.length) state.sample = false;
      $('records').dataset.open = ''; save(); renderAll();
      const nb = document.querySelector('#works-body [data-act="edit"]');
      (nb || $('empty-add') || $('w-title')).focus();
    });
  }
  function onRecordsClick(ev) {
    const eb = ev.target.closest('button[data-edit-resale]');
    if (eb) { startEditResale(eb.dataset.editResale); return; }
    const btn = ev.target.closest('button[data-resale]'); if (!btn) return;
    const w = state.works.find(x => x.id === selectedWorkId); if (!w) return;
    const rid = btn.dataset.resale, r = w.resales.find(x => x.id === rid); if (!r) return;
    askConfirm('确认删除这条再售记录?', `${r.date} · ${r.channel} · ${r.form}。删除后「${w.title}」的被售次数少 1,相关热力格、散点和月报随之变化;确认前数据不变。`, '确认删除', () => {
      w.resales = w.resales.filter(x => x.id !== rid);
      if (editingResale && editingResale.rid === rid) resetResaleForm();
      save(); renderAll();
      const nb = document.querySelector('#records [data-edit-resale]');
      (nb || document.querySelector('#works-body [data-act="records"]')).focus();
    });
  }

  // ---------- 导出 ----------
  function exportMonth() { return month; }
  function renderExport() {
    $('report-month').value = month; $('export-month').value = month;
    $('md-preview').textContent = C.toMarkdown(state.works, exportMonth(), TODAY, { sample: state.sample });
    $('export-md').textContent = '下载 ' + month + ' 月报 Markdown';
    syncExport();
  }
  function setMonth(v) { if (C.isMonth(v)) { month = v; } renderMonth(); renderExport(); }
  function download(name, text, type) {
    const a = document.createElement('a'); const url = URL.createObjectURL(new Blob([text], { type }));
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function importFile(ev) {
    const f = ev.target.files && ev.target.files[0]; if (!f) return;
    showTab('export'); /* 拒绝原因与导入结果写在「导出与数据」页;从顶部按钮导入时要先切过去才看得到 */
    showErr('import-error', ''); $('import-ok').hidden = true;
    f.text().then(text => {
      const v = C.validateImport(text);
      if (!v.ok) { showErr('import-error', '导入被拒绝,当前数据没有改动:' + v.error); $('import-error').scrollIntoView({ block: 'nearest' }); return; } /* 提示在页面下方,窄屏要滚到可见处 */
      const apply = () => { resetWorkForm(); resetResaleForm(); state = v.state; selectedWorkId = null; $('records').dataset.open = ''; save(); renderAll(); $('import-ok').textContent = `已导入 ${state.works.length} 部作品。`; $('import-ok').hidden = false; $('import-ok').scrollIntoView({ block: 'nearest' }); };
      if (userHasData()) askConfirm('导入会替换当前数据', `当前 ${state.works.length} 部作品(${state.works.reduce((n, w) => n + w.resales.length, 0)} 条再售记录)、${state.channels.length} 个渠道${draftTail()}会被备份文件里的 ${v.state.works.length} 部作品、${v.state.channels.length} 个渠道替换。确认前原数据不变。`, '确认替换', apply); else apply();
    }).catch(e => { showErr('import-error', '读取文件失败:' + e.message); $('import-error').scrollIntoView({ block: 'nearest' }); });
    ev.target.value = '';
  }

  // ---------- 示例 / 清空 ----------
  function applySample() {
    const s = globalThis.RESALE_SAMPLE;
    const v = C.validateState({ sample: true, channels: s.channels, works: clone(s.works) });
    if (!v.ok) { showWarning('示例数据没有通过校验:' + v.error); return; }
    resetWorkForm(); resetResaleForm();
    state = v.state; selectedWorkId = null; $('records').dataset.open = ''; save(); renderAll();
  }
  function loadSample() {
    if (userHasData()) askConfirm('载入示例会替换当前数据', `当前 ${state.works.length} 部作品(${state.works.reduce((n, w) => n + w.resales.length, 0)} 条再售记录)、${state.channels.length} 个渠道${draftTail()}会被示例替换。确认前原数据不变,建议先导出 JSON 备份。`, '确认替换', applySample);
    else applySample();
  }
  function clearData() {
    askConfirm('确认清空全部数据?', `将删除 ${state.works.length} 部作品、${state.works.reduce((n, w) => n + w.resales.length, 0)} 条再售记录${draftTail()},渠道列表恢复默认,无法恢复。建议先导出备份。`, '确认清空', () => {
      resetWorkForm(); resetResaleForm(); $('c-name').value = '';
      state = { channels: C.DEFAULT_CHANNELS.slice(), works: [], sample: false }; selectedWorkId = null; $('records').dataset.open = ''; save(); renderAll();
    });
  }

  // ---------- 渲染入口与标签页 ----------
  function renderBanners() {
    $('sample-banner').hidden = !state.sample;
    const tn = $('today-note');
    let fixed = null;
    try { fixed = new URLSearchParams(location.search).get('today'); } catch (e) { fixed = null; }
    tn.hidden = !(fixed && fixed === TODAY);
    if (!tn.hidden) tn.textContent = '基准日 ' + TODAY + '(由地址参数固定)';
  }
  function renderAll() {
    renderBanners();
    renderForms();
    $('empty').hidden = state.works.length > 0;
    renderMonth(); renderHints(); renderHeat(); renderScatter(); renderBars(); renderWorks(); renderRecords(); renderExport();
  }
  function showTab(name) {
    for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
    $('tab-ledger').hidden = name !== 'ledger'; $('tab-export').hidden = name !== 'export';
    if (name === 'ledger') renderScatter(); else renderExport();
  }

  function init() {
    load(); renderAll();
    $('load-sample').addEventListener('click', loadSample);
    $('clear-data').addEventListener('click', clearData);
    $('confirm-yes').addEventListener('click', () => { const fn = pendingAction; closeConfirm(); if (fn) fn(); });
    $('confirm-no').addEventListener('click', closeConfirm);
    $('work-form').addEventListener('submit', addWork);
    $('resale-form').addEventListener('submit', addResale);
    $('channel-form').addEventListener('submit', addChannel);
    $('works-body').addEventListener('click', onWorksClick);
    $('records').addEventListener('click', onRecordsClick);
    $('report-month').addEventListener('change', e => setMonth(e.target.value));
    $('export-month').addEventListener('change', e => setMonth(e.target.value));
    $('empty-add').addEventListener('click', () => $('w-title').focus());
    $('import-btn').addEventListener('click', () => $('import-file').click());
    $('import-btn-top').addEventListener('click', () => $('import-file').click());
    $('warn-export').addEventListener('click', () => download('写作复售账本-备份.json', C.toBackup(state), 'application/json;charset=utf-8'));
    $('w-cancel').addEventListener('click', () => { resetWorkForm(); syncExport(); });
    $('r-cancel').addEventListener('click', () => { resetResaleForm(); syncExport(); });
    for (const f of ['work-form', 'resale-form', 'channel-form']) { $(f).addEventListener('input', syncExport); $(f).addEventListener('change', syncExport); }
    $('import-file').addEventListener('change', importFile);
    $('export-csv').addEventListener('click', () => download('作品表.csv', '\uFEFF' + C.toCsv(state.works, { sample: state.sample }), 'text/csv;charset=utf-8'));
    $('export-md').addEventListener('click', () => download(`月报-${exportMonth()}.md`, C.toMarkdown(state.works, exportMonth(), TODAY, { sample: state.sample }), 'text/markdown;charset=utf-8'));
    $('export-json').addEventListener('click', () => download('写作复售账本-备份.json', C.toBackup(state), 'application/json;charset=utf-8'));
    for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => showTab(b.dataset.tab));
    let t = null;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(renderScatter, 120); });
  }
  init();
})();
