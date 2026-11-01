'use strict';
(function () {
  const C = globalThis.CausalCore;
  const KEY = 'causalchain.v1';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const $ = id => document.getElementById(id);

  function localToday() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  const TODAY = C.resolveToday(location.search, localToday());

  let state = C.newState();
  let editingId = null;
  let activeTab = 'review';
  let pendingConfirm = null;

  /* ---------- 小工具 ---------- */
  function h(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function svg(tag, attrs, cls) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (cls) n.setAttribute('class', cls);
    return n;
  }
  function say(msg) { $('status-msg').textContent = msg; }
  /* 表单是否有未保存内容(新建填了内容,或编辑中与已保存条目不同) */
  function formDirty() {
    const f = readForm();
    const lv = f.levels.map(t => t.trim()).filter(Boolean);
    if (editingId) {
      const e = state.entries.find(x => x.id === editingId);
      if (!e) return false;
      return f.date !== e.date || f.who !== e.who || f.event !== e.event || f.proposer !== e.proposer || f.mood !== e.mood ||
        lv.join('\u0001') !== e.chain.join('\u0001') || f.tags.slice().sort().join() !== e.tags.slice().sort().join() || (f.prevId || null) !== (e.prevId || null);
    }
    return !!(f.event || lv.length || f.tags.length || f.prevId || f.proposer !== 'parent' || f.mood !== 'calm');
  }
  const draftTail = () => (formDirty() ? '和表单里尚未保存的内容' : '');
  function markInvalid(el, msg) {
    ['f-date', 'f-who', 'f-event'].forEach(id => $(id).removeAttribute('aria-invalid'));
    levelInputs().forEach(i => i.removeAttribute('aria-invalid'));
    if (el) { el.setAttribute('aria-invalid', 'true'); el.focus(); }
  }
  function newId() { return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function shortDate(iso) { return iso.slice(5); }

  /* ---------- 存储 ---------- */
  function showAlert(title, text) {
    $('save-alert-title').textContent = title;
    $('save-alert-text').textContent = text;
    $('save-alert').hidden = false;
  }
  function save() {
    const v = C.validateState(state);
    if (!v.ok) { showAlert('未保存', '数据没有通过校验:' + v.error + '。请先导出备份。'); return false; }
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      showAlert('未保存', '浏览器拒绝写入(' + (e && e.name ? e.name : '存储错误') + ')。刷新后这次改动会丢失,请现在导出 JSON 备份。');
      return false;
    }
    $('save-alert').hidden = true;
    return true;
  }
  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { showAlert('无法读取', '浏览器不允许读取本地存储,本次数据不会被保留,请及时导出。'); return; }
    if (raw === null) return;
    const r = C.validateImport(raw);
    if (r.ok) { state = r.state; return; }
    try { localStorage.setItem(KEY + '.rejected', raw); } catch (e) { /* 备份失败不影响提示 */ }
    showAlert('已保存的数据未通过校验', r.error + '。原文已另存到 ' + KEY + '.rejected,当前显示空白。');
  }

  /* ---------- 确认区 ---------- */
  function askConfirm(text, yes) {
    pendingConfirm = yes;
    $('confirm-text').textContent = text;
    $('confirm-box').hidden = false;
    $('confirm-no').focus();
  }
  function closeConfirm() { pendingConfirm = null; $('confirm-box').hidden = true; }

  /* ---------- 链条可视化(运行时 div) ---------- */
  function renderChain(container, levels, proposer, compact) {
    container.textContent = '';
    const chain = h('ol', 'chain chain-' + proposer + (compact ? ' chain-compact' : ''));
    levels.forEach((text, i) => {
      if (i > 0) {
        const link = h('li', 'chain-link');
        link.setAttribute('aria-hidden', 'true');
        chain.appendChild(link);
      }
      const node = h('li', 'node' + (text.trim() ? '' : ' node-empty'));
      node.appendChild(h('span', 'node-label', C.LEVEL_LABELS[i]));
      node.appendChild(h('span', 'node-text', text.trim() ? text : '(待填)'));
      chain.appendChild(node);
    });
    container.appendChild(chain);
  }

  /* ---------- 表单 ---------- */
  function levelInputs() { return Array.from(document.querySelectorAll('#levels .level-input')); }
  function setLevels(values) {
    const box = $('levels');
    box.textContent = '';
    values.forEach((v, i) => {
      const lab = h('label', 'field level-field');
      lab.appendChild(document.createTextNode(C.LEVEL_LABELS[i]));
      const inp = h('input', 'level-input');
      inp.type = 'text';
      inp.value = v;
      inp.setAttribute('aria-label', '第 ' + (i + 1) + ' 级 ' + C.LEVEL_LABELS[i]);
      inp.addEventListener('input', updatePreview);
      lab.appendChild(inp);
      box.appendChild(lab);
    });
    $('add-level').disabled = values.length >= C.MAX_LEVELS;
    $('remove-level').disabled = values.length <= 1;
    updatePreview();
  }
  function radio(name) { return document.querySelector('input[name="' + name + '"]:checked').value; }
  function readForm() {
    return {
      date: $('f-date').value,
      who: $('f-who').value.trim(),
      event: $('f-event').value.trim(),
      proposer: radio('f-proposer'),
      mood: radio('f-mood'),
      levels: levelInputs().map(i => i.value),
      tags: Array.from(document.querySelectorAll('#f-tags input:checked')).map(i => i.value),
      prevId: $('f-prev').value || null,
    };
  }
  function renderTagChoices(selected) {
    const box = $('f-tags');
    box.textContent = '';
    const all = state.config.tags.slice();
    selected.forEach(t => { if (!all.includes(t)) all.push(t); });
    all.forEach(t => {
      const lab = h('label', 'choice');
      const cb = h('input');
      cb.type = 'checkbox';
      cb.value = t;
      cb.checked = selected.includes(t);
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(' ' + t));
      box.appendChild(lab);
    });
  }
  function renderPrevOptions(selected) {
    const sel = $('f-prev');
    sel.textContent = '';
    const none = h('option', '', '不关联');
    none.value = '';
    sel.appendChild(none);
    state.entries.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).forEach(e => {
      if (e.id === editingId) return;
      const o = h('option', '', e.date + ' · ' + e.who + ' · ' + e.event);
      o.value = e.id;
      sel.appendChild(o);
    });
    sel.value = selected && state.entries.some(e => e.id === selected) ? selected : '';
  }
  function renderWhoList() {
    const dl = $('who-list');
    dl.textContent = '';
    Array.from(new Set(state.entries.map(e => e.who))).forEach(w => { const o = h('option'); o.value = w; dl.appendChild(o); });
  }

  function updatePreview() {
    const f = readForm();
    if ($('export-hint')) renderExport();
    renderChain($('preview-chain'), f.levels, f.proposer, false);
    const issues = $('issues');
    issues.textContent = '';
    C.checkChain({ chain: f.levels, mood: f.mood }, state.config).issues.forEach(i => {
      issues.appendChild(h('li', 'issue issue-' + i.code, i.message));
    });
    const prev = f.prevId ? state.entries.find(e => e.id === f.prevId) : null;
    const box = $('preview-prev');
    box.hidden = !prev;
    box.textContent = '';
    if (prev) {
      box.appendChild(h('h3', '', '上次链条 · ' + prev.date + ' · ' + prev.event));
      const c = h('div');
      renderChain(c, prev.chain, prev.proposer, true);
      box.appendChild(c);
    }
  }

  function resetForm() {
    editingId = null;
    $('form-h').textContent = '新建复盘';
    $('cancel-edit').hidden = true;
    $('f-date').value = TODAY;
    $('f-event').value = '';
    document.querySelector('input[name="f-proposer"][value="parent"]').checked = true;
    document.querySelector('input[name="f-mood"][value="calm"]').checked = true;
    renderTagChoices([]);
    renderPrevOptions(null);
    $('form-error').hidden = true;
    setLevels(['', '']);
  }
  function startEdit(id) {
    const e = state.entries.find(x => x.id === id);
    if (!e) return;
    editingId = id;
    $('form-h').textContent = '编辑复盘';
    $('cancel-edit').hidden = false;
    $('f-date').value = e.date;
    $('f-who').value = e.who;
    $('f-event').value = e.event;
    document.querySelector('input[name="f-proposer"][value="' + e.proposer + '"]').checked = true;
    document.querySelector('input[name="f-mood"][value="' + e.mood + '"]').checked = true;
    renderTagChoices(e.tags);
    renderPrevOptions(e.prevId);
    $('form-error').hidden = true;
    setLevels(e.chain.length ? e.chain.slice() : ['']);
    showTab('review');
    $('f-event').focus();
  }

  function submitEntry(status) {
    const f = readForm();
    const entry = {
      id: editingId || newId(), date: f.date, who: f.who, event: f.event,
      chain: f.levels.map(t => t.trim()).filter(Boolean), proposer: f.proposer, mood: f.mood,
      tags: f.tags, status: status, prevId: f.prevId,
    };
    const err = $('form-error');
    const v = C.validateEntry(entry);
    if (!v.ok) {
      err.textContent = v.error; err.hidden = false;
      const m = v.error;
      const lvls = levelInputs();
      const target = /日期/.test(m) ? $('f-date') : /谁/.test(m) ? $('f-who') : /事件/.test(m) ? $('f-event') : /链条|级/.test(m) ? (lvls.find(i => !i.value.trim()) || lvls[lvls.length - 1]) : err;
      markInvalid(target === err ? null : target);
      if (target === err) err.focus();
      return;
    }
    markInvalid(null);
    const next = editingId ? state.entries.map(e => (e.id === editingId ? entry : e)) : state.entries.concat(entry);
    const check = C.validateState(Object.assign({}, state, { entries: next }));
    if (!check.ok) { err.textContent = check.error; err.hidden = false; return; }
    state.entries = next;
    const ok = save();
    resetForm();
    renderAll();
    say(ok ? (status === 'draft' ? '已保存为草稿' : '已保存复盘') : '');
  }

  /* ---------- 今天的事 ---------- */
  function renderPending() {
    const list = $('pending-list');
    list.textContent = '';
    const items = C.todayPending(state.entries, TODAY);
    $('pending-empty').hidden = items.length > 0;
    items.forEach(e => {
      const li = h('li', 'pending-item');
      li.appendChild(h('span', 'pending-text', e.who + ':' + e.event));
      const b = h('button', 'btn btn-small', '继续复盘');
      b.type = 'button';
      b.addEventListener('click', () => startEdit(e.id));
      li.appendChild(b);
      list.appendChild(li);
    });
    const now = new Date();
    const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const cur = C.currentSlot(state.config.slots, hhmm);
    $('slot-line').textContent = '复盘时段:' + state.config.slots.map(s => s.label + ' ' + s.time).join(' · ') + (cur ? '。现在是「' + cur.label + '」时段。' : '。');
  }

  /* ---------- 回看 ---------- */
  function fillSelect(sel, firstText, values) {
    const keep = sel.value;
    sel.textContent = '';
    const o0 = h('option', '', firstText); o0.value = ''; sel.appendChild(o0);
    values.forEach(v => { const o = h('option', '', v); o.value = v; sel.appendChild(o); });
    sel.value = values.includes(keep) ? keep : '';
  }
  function entryCard(e) {
    const card = h('article', 'card entry');
    const head = h('div', 'entry-head');
    head.appendChild(h('h3', '', e.event));
    const meta = h('div', 'entry-meta');
    meta.appendChild(h('span', '', e.date + ' · ' + e.who));
    meta.appendChild(h('span', 'tag tag-' + e.proposer, C.PROPOSER_NAME[e.proposer] + '提出'));
    if (e.mood === 'upset') meta.appendChild(h('span', 'tag tag-upset', '录入时有情绪'));
    if (e.status === 'draft') meta.appendChild(h('span', 'tag tag-draft', '草稿'));
    e.tags.forEach(t => meta.appendChild(h('span', 'tag', t)));
    head.appendChild(meta);
    card.appendChild(head);
    const c = h('div');
    renderChain(c, e.chain, e.proposer, false);
    card.appendChild(c);
    const hits = C.checkChain(e, state.config).issues.filter(i => i.code === 'far');
    if (hits.length) card.appendChild(h('p', 'issue issue-far', hits[0].message));
    const prev = e.prevId ? state.entries.find(x => x.id === e.prevId) : null;
    if (prev) {
      const box = h('div', 'prev-box');
      box.appendChild(h('h4', '', '上次链条 · ' + prev.date + ' · ' + prev.event));
      const pc = h('div');
      renderChain(pc, prev.chain, prev.proposer, true);
      box.appendChild(pc);
      card.appendChild(box);
    }
    const acts = h('div', 'row');
    const be = h('button', 'btn btn-small', '编辑'); be.type = 'button';
    be.addEventListener('click', () => startEdit(e.id));
    const bd = h('button', 'btn btn-small btn-quiet', '删除'); bd.type = 'button';
    bd.addEventListener('click', () => {
      const linked = state.entries.filter(x => x.prevId === e.id).length;
      askConfirm('删除「' + e.event + '」(' + e.date + ' · ' + e.who + ')?' + (linked ? '有 ' + linked + ' 条条目关联了它,删除后它们会取消关联(条目本身保留)。' : '没有其他条目关联它。') + '确认前数据不变。', () => deleteEntry(e.id));
    });
    acts.appendChild(be); acts.appendChild(bd);
    card.appendChild(acts);
    return card;
  }
  function deleteEntry(id) {
    state.entries = state.entries.filter(e => e.id !== id).map(e => (e.prevId === id ? Object.assign({}, e, { prevId: null }) : e));
    if (editingId === id) resetForm();
    const ok = save();
    renderAll();
    say(ok ? '已删除' : '');
    const nb = document.querySelector('#browse-list .entry .btn');
    if (nb) nb.focus(); else $('q-text').focus();
  }
  function renderBrowse() {
    fillSelect($('q-who'), '全部', Array.from(new Set(state.entries.map(e => e.who))));
    fillSelect($('q-tag'), '全部', Array.from(new Set(state.config.tags.concat(state.entries.flatMap(e => e.tags)))));
    const rows = C.filterEntries(state.entries, { who: $('q-who').value, tag: $('q-tag').value, q: $('q-text').value })
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    $('browse-count').textContent = state.entries.length === 0 ? '还没有复盘。去「复盘」页写第一条,或点右上角「载入示例」。' : '共 ' + rows.length + ' 条';
    const box = $('browse-list');
    box.textContent = '';
    rows.forEach(e => box.appendChild(entryCard(e)));
  }

  /* ---------- 统计(运行时 SVG / div) ---------- */
  function renderRatio() {
    const host = $('ratio-chart');
    host.textContent = '';
    const series = C.ratioSeries(state.entries, TODAY, 8);
    const W = Math.max(host.clientWidth, 280), H = 260;
    const m = { l: 56, r: 36, t: 20, b: 44 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const x = i => m.l + (pw * i) / (series.length - 1);
    const y = r => m.t + ph * (1 - r);
    const s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-label': '孩子自己推演的比例,按周折线图' }, 'ratio-svg');
    [0, 0.5, 1].forEach(r => {
      s.appendChild(svg('line', { x1: m.l, x2: W - m.r, y1: y(r), y2: y(r) }, 'grid-line'));
      const t = svg('text', { x: m.l - 8, y: y(r) + 5, 'text-anchor': 'end' }, 'axis-text');
      t.textContent = Math.round(r * 100) + '%';
      s.appendChild(t);
    });
    const step = Math.max(1, Math.ceil(72 / (pw / (series.length - 1))));
    series.forEach((p, i) => {
      if ((series.length - 1 - i) % step !== 0) return;
      const t = svg('text', { x: x(i), y: H - 14, 'text-anchor': 'middle' }, 'axis-text');
      t.textContent = shortDate(p.end);
      s.appendChild(t);
    });
    const real = series.map((p, i) => (p.ratio === null ? null : [x(i), y(p.ratio), p])).filter(Boolean);
    C.ratioSegments(series).forEach(seg => {
      if (seg.length > 1) s.appendChild(svg('polyline', { points: seg.map(i => x(i) + ',' + y(series[i].ratio)).join(' ') }, 'ratio-line'));
    });
    series.forEach((p, i) => {
      if (p.ratio !== null) return;
      const t = svg('text', { x: x(i), y: y(0) - 8, 'text-anchor': 'middle' }, 'axis-text gap-label');
      t.textContent = '无记录';
      s.appendChild(t);
    });
    real.forEach(p => {
      const c = svg('circle', { cx: p[0], cy: p[1], r: 6 }, 'ratio-dot');
      const t = svg('title', {});
      t.textContent = p[2].start + ' 至 ' + p[2].end + ':' + p[2].child + '/' + p[2].total;
      c.appendChild(t);
      s.appendChild(c);
    });
    host.appendChild(s);
    const list = $('ratio-list');
    list.textContent = '';
    if (real.length === 0) list.appendChild(h('li', 'muted', '近 8 周还没有可统计的已复盘条目。'));
    series.forEach(p => {
      if (p.ratio === null) return;
      list.appendChild(h('li', '', p.start + ' 至 ' + p.end + ':孩子自己推演 ' + p.child + ' / ' + p.total + ' 条(' + Math.round(p.ratio * 100) + '%)'));
    });
  }
  function renderBars() {
    const box = $('tag-bars');
    box.textContent = '';
    const stats = C.tagStats(state.entries);
    if (stats.length === 0) { box.appendChild(h('p', 'muted', '还没有带标签的条目。')); return; }
    const max = Math.max.apply(null, stats.map(s => s.count));
    stats.forEach(s => {
      const row = h('div', 'bar-row');
      row.appendChild(h('span', 'bar-label', s.tag));
      const track = h('div', 'bar-track');
      const fill = h('div', 'bar-fill');
      fill.style.width = (s.count / max) * 100 + '%';
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(h('span', 'bar-count', s.count + ' 条'));
      box.appendChild(row);
    });
  }

  /* ---------- 导出 / 导入 / 设置 ---------- */
  function download(name, text, type) {
    const blob = new Blob([text], { type: type + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = h('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function renderExport() {
    const none = state.entries.length === 0;
    const dirty = formDirty();
    ['export-md', 'export-csv', 'export-json'].forEach(id => { $(id).disabled = none || dirty; });
    $('export-hint').textContent = dirty ? '“复盘”页的表单里有尚未保存的内容,导出已暂停:请先保存(正式或草稿)或点“取消编辑”/清空表单。保存失败时可用页面上方的“导出当前内存中的全部复盘 JSON 备份”。' : none ? '没有条目可导出。' : '导出的是已保存的全部条目,与界面一致,共 ' + state.entries.length + ' 条。';
    $('md-preview').textContent = none ? '' : C.toMarkdown(state.entries);
  }
  function renderConfig() {
    const c = state.config;
    $('c-far').value = c.farWords.join('、');
    $('c-tags').value = c.tags.join('、');
    $('c-s1-label').value = c.slots[0].label; $('c-s1-time').value = c.slots[0].time;
    $('c-s2-label').value = c.slots[1].label; $('c-s2-time').value = c.slots[1].time;
  }
  function splitList(s) { return s.split(/[,，、\n]/).map(x => x.trim()).filter(Boolean); }

  function applyState(next, msg) {
    state = next;
    resetForm();
    const ok = save();
    renderAll();
    say(ok ? msg : '');
  }

  /* ---------- 渲染与标签页 ---------- */
  function showTab(name) {
    activeTab = name;
    document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
    document.querySelectorAll('.panel').forEach(p => { p.hidden = p.dataset.panel !== name; });
    if (name === 'stats') { renderRatio(); renderBars(); }
  }
  function renderAll() {
    let fixed = null;
    try { fixed = new URLSearchParams(location.search).get('today'); } catch (e) { fixed = null; }
    $('today-label').textContent = fixed && fixed === TODAY ? '基准日 ' + TODAY + '(由地址参数固定)' : '今天 ' + TODAY;
    $('sample-note').hidden = !state.entries.some(e => e.id.startsWith('sample-'));
    renderWhoList();
    const f = readForm();
    renderTagChoices(f.tags);
    renderPrevOptions(f.prevId);
    updatePreview();
    renderPending();
    renderBrowse();
    renderExport();
    renderConfig();
    if (activeTab === 'stats') { renderRatio(); renderBars(); }
  }

  /* ---------- 事件 ---------- */
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));
  document.querySelector('[data-go-export]').addEventListener('click', () => showTab('export'));
  $('confirm-yes').addEventListener('click', () => { const fn = pendingConfirm; closeConfirm(); if (fn) fn(); });
  $('confirm-no').addEventListener('click', closeConfirm);
  $('import-btn').addEventListener('click', () => $('import-file').click());
  $('import-btn-top').addEventListener('click', () => $('import-file').click());
  $('save-alert-export').addEventListener('click', () => download('因果复盘备份-' + TODAY + '.json', C.toJson(state), 'application/json'));
  $('entry-form').addEventListener('input', renderExport);
  $('entry-form').addEventListener('change', renderExport);

  $('add-level').addEventListener('click', () => {
    const vals = levelInputs().map(i => i.value);
    if (vals.length < C.MAX_LEVELS) { vals.push(''); setLevels(vals); levelInputs()[vals.length - 1].focus(); }
  });
  $('remove-level').addEventListener('click', () => {
    const vals = levelInputs().map(i => i.value);
    if (vals.length <= 1) return;
    const dropIt = () => { closeConfirm(); const v2 = levelInputs().map(i => i.value); v2.pop(); setLevels(v2); levelInputs()[v2.length - 1].focus(); };
    const last = vals[vals.length - 1];
    if (last.trim()) askConfirm('删除第 ' + vals.length + ' 级「' + last.trim() + '」?这一级已填写的内容会丢失,确认前链条不变。', dropIt);
    else dropIt();
  });
  ['f-proposer', 'f-mood'].forEach(n => document.querySelectorAll('input[name="' + n + '"]').forEach(r => r.addEventListener('change', updatePreview)));
  $('f-prev').addEventListener('change', updatePreview);
  $('entry-form').addEventListener('submit', ev => { ev.preventDefault(); submitEntry('done'); });
  $('save-draft-btn').addEventListener('click', () => submitEntry('draft'));
  $('cancel-edit').addEventListener('click', resetForm);
  ['q-who', 'q-tag'].forEach(id => $(id).addEventListener('change', renderBrowse));
  $('q-text').addEventListener('input', renderBrowse);

  $('load-sample').addEventListener('click', () => {
    const go = () => { closeConfirm(); applyState(globalThis.CausalSample(), '已载入合成示例'); };
    if (C.hasUserData(state) || formDirty()) askConfirm('载入示例会替换现有的 ' + state.entries.length + ' 条复盘、自定义设置' + draftTail() + '。确认前不会改动现有数据。', go);
    else go();
  });
  $('clear-all').addEventListener('click', () => {
    askConfirm('清空 ' + state.entries.length + ' 条复盘、自定义设置' + draftTail() + ',并恢复默认设置?此操作不能撤销,建议先导出 JSON 备份。', () => applyState(C.newState(), '已清空'));
  });

  $('export-md').addEventListener('click', () => download('因果复盘册-' + TODAY + '.md', C.toMarkdown(state.entries), 'text/markdown'));
  $('export-csv').addEventListener('click', () => download('因果复盘-' + TODAY + '.csv', '\uFEFF' + C.toCsv(state.entries), 'text/csv'));
  $('export-json').addEventListener('click', () => download('因果复盘备份-' + TODAY + '.json', C.toJson(state), 'application/json'));

  $('import-file').addEventListener('change', ev => {
    const input = ev.target;
    const file = input.files[0];
    if (!file) return;
    showTab('export'); /* 导入结果写在「导出与设置」页的 #import-msg;从顶部按钮导入时要先切过去才看得到 */
    const rd = new FileReader();
    rd.onload = () => {
      const r = C.validateImport(String(rd.result));
      const msg = $('import-msg');
      input.value = '';
      if (!r.ok) { msg.textContent = '导入被拒绝,现有数据未改动:' + r.error; msg.scrollIntoView({ block: 'nearest' }); return; } /* 提示在页面下方,窄屏要滚到可见处 */
      const go = () => { closeConfirm(); msg.textContent = '已导入 ' + r.state.entries.length + ' 条。'; applyState(r.state, '已导入'); msg.scrollIntoView({ block: 'nearest' }); };
      if (C.hasUserData(state) || formDirty()) askConfirm('导入会用备份中的 ' + r.state.entries.length + ' 条复盘替换现有的 ' + state.entries.length + ' 条复盘、自定义设置' + draftTail() + '。确认前不会改动现有数据。', go);
      else go();
    };
    rd.onerror = () => { $('import-msg').textContent = '读取文件失败,现有数据未改动。'; $('import-msg').scrollIntoView({ block: 'nearest' }); };
    rd.readAsText(file);
  });

  $('config-form').addEventListener('submit', ev => {
    ev.preventDefault();
    const cfg = {
      farWords: splitList($('c-far').value),
      tags: splitList($('c-tags').value),
      slots: [{ label: $('c-s1-label').value.trim(), time: $('c-s1-time').value }, { label: $('c-s2-label').value.trim(), time: $('c-s2-time').value }],
    };
    const v = C.validateConfig(cfg);
    const err = $('config-error');
    if (!v.ok) { err.textContent = v.error; err.hidden = false; return; }
    err.hidden = true;
    state.config = cfg;
    const ok = save();
    renderAll();
    say(ok ? '设置已保存' : '');
  });

  let rz = 0;
  window.addEventListener('resize', () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => { if (activeTab === 'stats') renderRatio(); }); });

  load();
  resetForm();
  renderAll();
})();
