'use strict';
(function () {
  const C = globalThis.OrgChartCore;
  const KEY = 'orgchart.v1';
  const TODAY = C.resolveToday(location.search, C.localDateString(new Date()));
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const clone = o => JSON.parse(JSON.stringify(o));
  const compactMq = window.matchMedia('(max-width: 760px)');

  let state = C.emptyState();
  let selectedId = null;
  let mode = 'new';           // 'new' | 'edit'
  let newParentId = null;     // 新建模式默认上级
  let pendingImport = null;
  let toastTimer = null;
  let activeTab = 'chart';
  let preview = null;         // 表单即时预览(未保存),只影响组织图显示

  /* ---------- 存储 ---------- */
  function showBanner(text, withExport) {
    $('save-warning-text').textContent = text;
    $('save-warning-export').hidden = !withExport;
    $('save-warning').hidden = false;
  }
  function save() {
    const v = C.validateState(state);
    if (!v.ok) { showBanner('这次改动没有通过数据校验,没有保存:' + v.error, true); return false; }
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      showBanner('浏览器拒绝了写入(' + (e && e.name ? e.name : '未知错误') + '),当前改动只在这个页面里,刷新或关闭就会丢失。请马上导出 JSON 备份。', true);
      return false;
    }
    $('save-warning').hidden = true;
    return true;
  }
  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { showBanner('浏览器不允许读取本地存储,这个页面里的数据不会被保存。请随时导出 JSON 备份。', true); return C.emptyState(); }
    if (raw == null) return C.emptyState();
    const v = C.validateImport(raw);
    if (v.ok) return { version: v.state.version, nodes: v.state.nodes, collapsed: v.state.collapsed, sample: v.state.sample === true };
    try { localStorage.setItem(KEY + '.rejected', raw); } catch (e) { /* 备份失败也不影响继续使用 */ }
    showBanner('本机保存的数据没有通过校验(' + v.error + '),已原样另存到 ' + KEY + '.rejected,当前显示为空。', false);
    return C.emptyState();
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }
  function commit(msg, keepForm) {
    preview = null;
    const ok = save();
    renderAll(keepForm);
    if (ok && msg) toast(msg);
    return ok;
  }

  /* ---------- 工具 ---------- */
  const nodeById = id => state.nodes.find(n => n.id === id);
  const pct = r => Math.round(r * 100) + '%';

  /* 表单草稿:新建模式下填了内容,或编辑模式下与已保存节点不同 */
  function formDirty() {
    if (!state.nodes.length) return false;
    const edit = mode === 'edit' ? nodeById(selectedId) : null;
    const f = readForm();
    if (edit) {
      const a = Object.assign({}, edit, { inputFrom: edit.inputFrom.slice().sort(), outputTo: edit.outputTo.slice().sort(), interventions: edit.interventions.slice().sort() });
      const b = Object.assign({}, f, { inputFrom: f.inputFrom.slice().sort(), outputTo: f.outputTo.slice().sort(), interventions: f.interventions.slice().sort() });
      return JSON.stringify(a, Object.keys(a).sort()) !== JSON.stringify(b, Object.keys(b).sort()) || JSON.stringify(a.trigger) !== JSON.stringify(b.trigger);
    }
    return !!(f.name || f.duty || f.trigger.text || f.inputFrom.length || f.outputTo.length || f.runningSince || f.weekly || f.status !== 'idea' || f.trigger.kind !== 'manual' || f.interventions.join() !== 'none');
  }
  const scopeText = () => state.nodes.length + ' 个节点' + (formDirty() ? '和表单里未保存的内容' : '');
  function intLabel(n) { return n.interventions.map(k => C.INTERVENTION_LABEL[k]).join('、'); }
  function triggerLabel(n) {
    const k = C.TRIGGER_LABEL[n.trigger.kind];
    return n.trigger.kind === 'manual' ? k : k + (n.trigger.text ? '(' + n.trigger.text + ')' : '(未填)');
  }

  /* ---------- 提示框 ---------- */
  const tip = $('tip');
  function showTip(id, target) {
    const n = (preview ? preview.nodes : state.nodes).find(x => x.id === id);
    if (!n) return;
    tip.textContent = '';
    tip.appendChild(el('strong', 'tip-title', n.name));
    tip.appendChild(el('p', null, '职责:' + (n.duty || '(未填)')));
    tip.appendChild(el('p', null, '人工干预点:' + intLabel(n)));
    tip.appendChild(el('p', null, '触发:' + triggerLabel(n)));
    tip.hidden = false;
    const r = target.getBoundingClientRect();
    const w = tip.offsetWidth, h = tip.offsetHeight, m = 8;
    let left = Math.min(Math.max(m, r.left), window.innerWidth - w - m);
    let top = r.bottom + m;
    if (top + h > window.innerHeight - m) top = Math.max(m, r.top - h - m);
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  const hideTip = () => { tip.hidden = true; };
  function tipTarget(e) { return e.target && e.target.closest ? e.target.closest('[data-tip-id]') : null; }
  document.addEventListener('mouseover', e => { const t = tipTarget(e); if (t) showTip(t.dataset.tipId, t); });
  document.addEventListener('mouseout', e => { if (tipTarget(e)) hideTip(); });
  document.addEventListener('focusin', e => { const t = tipTarget(e); if (t) showTip(t.dataset.tipId, t); });
  document.addEventListener('focusout', e => { if (tipTarget(e)) hideTip(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hideTip(); });
  window.addEventListener('scroll', hideTip, true);

  /* ---------- 组织图 ---------- */
  function foldButton(item, cls) {
    const b = el('button', cls, item.collapsed ? '展开 ' + item.hidden : '收起');
    b.type = 'button';
    b.dataset.fold = item.id;
    b.setAttribute('aria-expanded', item.collapsed ? 'false' : 'true');
    b.setAttribute('aria-label', (item.collapsed ? '展开' : '收起') + '「' + item.node.name + '」的下级');
    return b;
  }

  function renderChart() {
    const view = preview || state;
    const has = view.nodes.length > 0;
    $('empty-guide').hidden = has;
    $('chart-area').hidden = !has;
    if (!has) return;
    const tree = C.buildTree(view.nodes);
    if (tree.error) { $('chart-note').textContent = '组织树无法生成:' + tree.error; return; }
    const L = C.layout(tree, view.collapsed);
    const list = C.visibleList(tree, view.collapsed);
    $('chart-note').textContent = (preview ? '【预览,尚未保存】' : '') + '当前显示 ' + L.nodes.length + ' / ' + view.nodes.length + ' 个节点。点节点可编辑,悬停可看职责和干预点,点「收起」折叠下级。';

    const stage = $('stage');
    stage.style.width = L.width + 'px';
    stage.style.height = L.height + 'px';
    const svg = $('links');
    svg.setAttribute('width', L.width);
    svg.setAttribute('height', L.height);
    svg.setAttribute('viewBox', '0 0 ' + L.width + ' ' + L.height);
    svg.textContent = '';
    for (const l of L.links) {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('class', 'org-link');
      p.setAttribute('d', l.d);
      p.dataset.from = l.from;
      p.dataset.to = l.to;
      svg.appendChild(p);
    }
    const holder = $('nodes');
    holder.textContent = '';
    for (const n of L.nodes) {
      const root = n.node.parentId == null;
      const d = el('div', 'org-node s-' + n.node.status + (root ? ' is-root' : '') + (n.id === selectedId ? ' is-selected' : ''));
      d.dataset.id = n.id;
      d.dataset.tipId = n.id;
      d.style.left = n.x + 'px';
      d.style.top = n.y + 'px';
      d.style.width = n.w + 'px';
      d.style.height = n.h + 'px';
      const main = el('button', 'node-main');
      main.type = 'button';
      main.dataset.select = n.id;
      main.setAttribute('aria-label', n.node.name + ',' + C.STATUS_LABEL[n.node.status] + (root ? ',根节点' : ''));
      main.appendChild(el('span', 'node-name', n.node.name));
      d.appendChild(main);
      const row = el('div', 'node-row');
      row.appendChild(el('span', 'badge', root ? '根节点' : C.STATUS_LABEL[n.node.status]));
      if (n.hasChildren) row.appendChild(foldButton(n, 'fold-btn'));
      d.appendChild(row);
      holder.appendChild(d);
    }

    const ul = $('tree-list');
    ul.textContent = '';
    for (const it of list) {
      const root = it.node.parentId == null;
      const li = el('li', 'tree-row s-' + it.node.status + (root ? ' is-root' : '') + (it.id === selectedId ? ' is-selected' : ''));
      li.style.setProperty('--depth', it.depth);
      li.dataset.id = it.id;
      li.dataset.tipId = it.id;
      const main = el('button', 'row-main');
      main.type = 'button';
      main.dataset.select = it.id;
      main.appendChild(el('span', 'row-name', it.node.name));
      main.appendChild(el('span', 'badge', root ? '根节点' : C.STATUS_LABEL[it.node.status]));
      li.appendChild(main);
      if (it.hasChildren) li.appendChild(foldButton(it, 'fold-btn'));
      ul.appendChild(li);
    }
  }

  function selectNode(id) {
    preview = null;
    selectedId = id;
    mode = 'edit';
    $('delete-confirm').hidden = true;
    renderChart();
    renderForm();
    if (compactMq.matches) $('node-form').scrollIntoView({ block: 'start' });
  }
  function toggleFold(id) {
    const set = new Set(state.collapsed);
    if (set.has(id)) set.delete(id); else set.add(id);
    state.collapsed = Array.from(set);
    commit(null, true);
    const again = document.querySelector('#chart-wrap [data-fold="' + id + '"]') || document.querySelector('[data-fold="' + id + '"]');
    if (again) again.focus();
  }
  document.addEventListener('click', e => {
    const f = e.target.closest && e.target.closest('[data-fold]');
    if (f) { hideTip(); toggleFold(f.dataset.fold); return; }
    const s = e.target.closest && e.target.closest('[data-select]');
    if (s) selectNode(s.dataset.select);
  });
  $('fold-all').onclick = () => {
    const tree = C.buildTree(state.nodes);
    if (tree.error) return;
    state.collapsed = state.nodes.filter(n => n.parentId != null && state.nodes.some(c => c.parentId === n.id)).map(n => n.id);
    commit(null, true);
  };
  $('unfold-all').onclick = () => { state.collapsed = []; commit(null, true); };

  /* ---------- 表单 ---------- */
  function checkList(containerId, name, excludeId, checked, missing) {
    const box = $(containerId);
    box.textContent = '';
    const others = state.nodes.filter(n => n.id !== excludeId);
    if (!others.length && !missing.length) { box.appendChild(el('span', 'muted', '还没有其他节点')); return; }
    for (const id of missing) {
      const lab = el('label', 'check check-missing');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = id;
      cb.name = name;
      cb.checked = true;
      cb.dataset.missing = '1';
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode('(不存在的节点:' + id + ',取消勾选即可移除)'));
      box.appendChild(lab);
    }
    for (const n of others) {
      const lab = el('label', 'check');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = n.id;
      cb.name = name;
      cb.checked = checked.includes(n.id);
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(n.name));
      box.appendChild(lab);
    }
  }
  const checkedValues = containerId => Array.from($(containerId).querySelectorAll('input:checked')).map(i => i.value);

  function syncTriggerText() {
    const manual = $('f-trigger-kind').value === 'manual';
    $('f-trigger-text').disabled = manual;
    if (manual) $('f-trigger-text').value = '';
  }
  function syncQuick(n) {
    $('quick-status').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', n && b.dataset.status === n.status ? 'true' : 'false'));
  }

  function renderForm() {
    if (!state.nodes.length) return;
    const edit = mode === 'edit' && nodeById(selectedId);
    if (!edit) { mode = 'new'; selectedId = null; }
    const n = edit ? nodeById(selectedId) : null;
    $('form-title').textContent = n ? '编辑:' + n.name : '添加节点';
    $('quick-status').hidden = !n;
    $('btn-add').hidden = !!n;
    $('btn-save').hidden = !n;
    $('btn-child').hidden = !n;
    $('btn-cancel').hidden = !n;
    $('btn-delete').hidden = !n;
    $('delete-confirm').hidden = true;
    $('form-msg').hidden = true;
    syncQuick(n);

    const parent = $('f-parent');
    parent.textContent = '';
    const rootNode = state.nodes.find(x => x.parentId == null);
    if (n && n.parentId == null) {
      parent.appendChild(new Option('(根节点,没有上级)', ''));
      parent.disabled = true;
    } else {
      parent.disabled = false;
      const banned = n ? C.descendantIds(state.nodes, n.id) : new Set();
      for (const x of state.nodes) if (!n || (x.id !== n.id && !banned.has(x.id))) parent.appendChild(new Option(x.name, x.id));
      parent.value = n ? n.parentId : (newParentId && nodeById(newParentId) ? newParentId : rootNode.id);
    }
    $('f-name').value = n ? n.name : '';
    $('f-duty').value = n ? n.duty : '';
    $('f-trigger-kind').value = n ? n.trigger.kind : 'manual';
    $('f-trigger-text').value = n ? n.trigger.text : '';
    syncTriggerText();
    if (n) $('f-trigger-text').value = n.trigger.text;
    $('f-status').value = n ? n.status : 'idea';
    $('f-since').value = n ? n.runningSince : '';
    $('f-weekly').value = n ? String(n.weekly) : '0';
    const ints = n ? n.interventions : ['none'];
    $('f-int').querySelectorAll('input').forEach(i => { i.checked = ints.includes(i.value); });
    const miss = n ? C.missingRefs(state.nodes, n) : { inputFrom: [], outputTo: [] };
    checkList('f-inputs', 'in', n ? n.id : null, n ? n.inputFrom : [], miss.inputFrom);
    checkList('f-outputs', 'out', n ? n.id : null, n ? n.outputTo : [], miss.outputTo);
    renderExport();
  }

  $('f-trigger-kind').onchange = syncTriggerText;
  $('f-int').addEventListener('change', e => {
    const t = e.target;
    if (!t.checked) return;
    $('f-int').querySelectorAll('input').forEach(i => {
      if (i === t) return;
      if (t.value === 'none') i.checked = false; else if (i.value === 'none') i.checked = false;
    });
  });

  function readForm() {
    const edit = mode === 'edit' ? nodeById(selectedId) : null;
    const weeklyRaw = $('f-weekly').value.trim();
    return {
      id: edit ? edit.id : C.nextId(state.nodes),
      name: $('f-name').value.trim(),
      duty: $('f-duty').value.trim(),
      inputFrom: checkedValues('f-inputs'),
      outputTo: checkedValues('f-outputs'),
      trigger: { kind: $('f-trigger-kind').value, text: $('f-trigger-kind').value === 'manual' ? '' : $('f-trigger-text').value.trim() },
      status: $('f-status').value,
      interventions: checkedValues('f-int'),
      parentId: edit && edit.parentId == null ? null : $('f-parent').value,
      runningSince: $('f-since').value,
      weekly: weeklyRaw === '' ? 0 : Number(weeklyRaw)
    };
  }
  function candidateFromForm() {
    const node = readForm();
    const editing = mode === 'edit' && nodeById(selectedId);
    const nodes = editing ? state.nodes.map(x => (x.id === node.id ? node : x)) : state.nodes.concat([node]);
    return { node, editing, cand: { version: state.version, nodes, collapsed: state.collapsed.slice() } };
  }
  function updatePreview() {
    if (!state.nodes.length) return;
    const { node, cand } = candidateFromForm();
    if (!node.interventions.length || !C.validateState(cand).ok) { if (preview) { preview = null; renderChart(); } return; }
    if (node.parentId) cand.collapsed = cand.collapsed.filter(id => id !== node.parentId);
    preview = cand;
    renderChart();
  }
  $('node-form').addEventListener('input', () => { updatePreview(); renderExport(); });
  $('node-form').addEventListener('change', () => { updatePreview(); renderExport(); });
  function formError(msg, target) {
    const m = $('form-msg');
    m.textContent = msg; m.hidden = false;
    ['f-name', 'f-since', 'f-weekly'].forEach(id => $(id).removeAttribute('aria-invalid'));
    const t = target || (/岗位名/.test(msg) ? $('f-name') : /起始日/.test(msg) ? $('f-since') : /每周/.test(msg) ? $('f-weekly') : m);
    if (t.id && t.id !== 'form-msg') t.setAttribute('aria-invalid', 'true');
    t.focus();
  }

  $('node-form').addEventListener('submit', e => {
    e.preventDefault();
    const { node, editing, cand } = candidateFromForm();
    if (!node.interventions.length) { formError('人工干预点至少选一项,没有就选「无」。', $('f-int').querySelector('input')); return; }
    const v = C.validateState(cand);
    if (!v.ok) { formError(v.error); return; }
    if (node.parentId) cand.collapsed = cand.collapsed.filter(id => id !== node.parentId);
    state = cand;
    selectedId = node.id;
    mode = 'edit';
    commit(editing ? '已保存「' + node.name + '」。' : '已添加「' + node.name + '」。');
  });
  $('mode-new').onclick = () => { preview = null; mode = 'new'; selectedId = null; newParentId = null; renderChart(); renderForm(); $('f-name').focus(); };
  $('btn-cancel').onclick = () => { preview = null; mode = 'new'; selectedId = null; newParentId = null; renderChart(); renderForm(); };
  $('btn-child').onclick = () => { preview = null; newParentId = selectedId; mode = 'new'; selectedId = null; renderChart(); renderForm(); $('f-name').focus(); };
  $('quick-status').addEventListener('click', e => {
    const b = e.target.closest('button[data-status]');
    const n = b && nodeById(selectedId);
    if (!n) return;
    state.nodes = state.nodes.map(x => (x.id === n.id ? Object.assign({}, x, { status: b.dataset.status }) : x));
    $('f-status').value = b.dataset.status;
    commit('「' + n.name + '」改为' + C.STATUS_LABEL[b.dataset.status] + '。', true);
    syncQuick(nodeById(selectedId));
  });
  $('btn-delete').onclick = () => {
    const n = nodeById(selectedId);
    if (!n) return;
    $('delete-name').textContent = n.name;
    const refs = C.referencesTo(state.nodes, n.id);
    $('delete-detail').textContent = refs.length
      ? '它被 ' + refs.map(r => '「' + r.name + '」(' + r.count + ' 处)').join('、') + ' 的输入或输出引用,确认后这些引用会一并移除(这些节点本身保留)。确认前组织图和统计不变。'
      : '没有其他节点引用它。确认前组织图和统计不变。';
    $('delete-confirm').hidden = false;
    $('delete-yes').focus();
  };
  $('delete-no').onclick = () => { $('delete-confirm').hidden = true; };
  $('delete-yes').onclick = () => {
    const n = nodeById(selectedId);
    if (!n) return;
    const r = C.removeNode(state.nodes, n.id);
    $('delete-confirm').hidden = true;
    if (r.error) { formError(r.error); return; }
    state.nodes = r.nodes;
    state.collapsed = state.collapsed.filter(id => id !== n.id);
    selectedId = null; mode = 'new'; newParentId = null;
    commit('已删除「' + n.name + '」' + (r.scrubbed ? ',同时移除了 ' + r.scrubbed + ' 处引用' : '') + '。');
  };

  /* ---------- 自动化度与检查 ---------- */
  function renderStats() {
    const s = C.automationStats(state.nodes);
    $('stat-running').textContent = String(s.running);
    $('stat-running-sub').textContent = '共 ' + s.total + ' 个岗位(不含根节点,部门节点也算)';
    $('stat-ratio').textContent = pct(s.interventionRatio);
    $('stat-ratio-sub').textContent = s.withIntervention + ' / ' + s.total + ' 个节点至少有一个干预点';
    $('stat-weekly').textContent = String(s.weeklyTotal);

    const cand = C.nextInterventionToRemove(state.nodes, TODAY);
    const box = $('next-candidate');
    box.textContent = '';
    if (cand) {
      box.appendChild(el('strong', null, '「' + cand.name + '」'));
      box.appendChild(document.createTextNode(' 是符合复核条件的校对环节:已在跑 ' + cand.days + ' 天,每周约 ' + cand.weekly + ' 次干预(按 ' + TODAY + ' 计算)。这里只按运行天数筛选,是否取消校对,请先核对实际的错误记录。'));
      const b = el('button', null, '定位到这个节点');
      b.type = 'button';
      b.id = 'goto-candidate';
      b.onclick = () => { setTab('chart'); selectNode(cand.id); };
      box.appendChild(document.createTextNode(' '));
      box.appendChild(b);
    } else {
      const noDate = state.nodes.filter(n => n.status === 'running' && n.interventions.includes('proofread') && !n.runningSince).length;
      box.textContent = '暂时没有符合复核条件的校对环节。' + (noDate ? '有 ' + noDate + ' 个在跑且需要校对的节点没填起始日,填了才能判断。' : '');
    }

    const ul = $('flow-list');
    ul.textContent = '';
    const issues = state.nodes.length ? C.flowIssues(state.nodes) : [];
    const tag = { block: '阻断', warn: '警告', info: '提示' };
    if (!issues.length) ul.appendChild(el('li', 'flow-item level-ok', state.nodes.length ? '没有发现数据流问题。' : '还没有节点。'));
    for (const i of issues) {
      const li = el('li', 'flow-item level-' + i.level);
      li.dataset.kind = i.kind;
      li.appendChild(el('strong', 'flow-tag', tag[i.level]));
      li.appendChild(el('span', null, i.message));
      ul.appendChild(li);
    }
  }

  /* ---------- 骨架与导出 ---------- */
  let exportBlockedReason = '';
  function renderExport() {
    const has = state.nodes.length > 0;
    const blocked = has && C.hasBlock(C.flowIssues(state.nodes));
    exportBlockedReason = !has ? '还没有节点,没有可导出的骨架。' : (blocked ? '数据流检查里有「阻断」问题(输入来源或输出对象不存在),先改掉才能生成骨架。' : '');
    const md = exportBlockedReason ? '' : C.toAgentMarkdown(state.nodes, { sample: state.sample });
    $('md-preview').textContent = md || '(没有可预览的内容)';
    $('md-blocked').textContent = exportBlockedReason;
    $('md-blocked').hidden = !exportBlockedReason;
    $('copy-md').disabled = !md;
    $('dl-md').disabled = !md;
    const none = !has;
    $('dl-svg').disabled = none;
    $('dl-csv').disabled = none;
    $('dl-json').disabled = none;
    syncLock();
  }
  /* 表单有未保存修改(含预览)时,骨架复制/下载与 SVG/CSV/JSON 导出全部暂停 */
  function syncLock() {
    const dirty = formDirty();
    const lock = $('export-lock');
    lock.hidden = !dirty;
    lock.textContent = dirty ? '组织图表单里有尚未保存的修改(预览中),导出已暂停:请先在「组织图」页点「保存修改 / 添加这个节点」,或点「取消选择」。保存失败时可用页面上方“导出当前内存中的全部节点 JSON 备份”。' : '';
    if (dirty) ['copy-md', 'dl-md', 'dl-svg', 'dl-csv', 'dl-json'].forEach(id => { $(id).disabled = true; });
  }

  function download(name, text, type, bom) {
    const blob = new Blob([bom ? '\uFEFF' + text : text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('已开始下载 ' + name + '。');
  }
  function paletteFromCss() {
    const cs = getComputedStyle(document.documentElement);
    const g = n => cs.getPropertyValue(n).trim();
    const pick = o => { const r = {}; for (const k of Object.keys(o)) if (o[k]) r[k] = o[k]; return r; };
    const stat = k => pick({ fill: g('--st-' + k + '-bg'), stroke: g('--st-' + k + '-edge') });
    return Object.assign(pick({ bg: g('--bg'), ink: g('--ink'), line: g('--line-strong'), rootFill: g('--root-bg'), rootInk: g('--root-ink') }),
      { status: { idea: stat('idea'), configured: stat('configured'), running: stat('running'), disabled: stat('disabled') } });
  }
  $('dl-md').onclick = () => { if (!exportBlockedReason) download('org-skeleton.md', C.toAgentMarkdown(state.nodes, { sample: state.sample }), 'text/markdown;charset=utf-8'); };
  $('dl-svg').onclick = () => download('org-chart.svg', C.toSvg(state.nodes, { collapsed: state.collapsed, palette: paletteFromCss(), sample: state.sample }), 'image/svg+xml;charset=utf-8');
  $('dl-csv').onclick = () => download('org-nodes.csv', C.toCsv(state.nodes, { sample: state.sample }), 'text/csv;charset=utf-8', true);
  $('dl-json').onclick = () => download('org-backup.json', C.serialize(state), 'application/json;charset=utf-8');
  $('save-warning-export').onclick = () => download('org-backup.json', C.serialize(state), 'application/json;charset=utf-8');
  $('copy-md').onclick = async () => {
    if (exportBlockedReason) return;
    const text = C.toAgentMarkdown(state.nodes, { sample: state.sample });
    try {
      await navigator.clipboard.writeText(text);
      toast('Markdown 已复制到剪贴板。');
      return;
    } catch (e) { /* 退回选区复制 */ }
    const range = document.createRange();
    range.selectNodeContents($('md-preview'));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    toast(ok ? 'Markdown 已复制到剪贴板。' : '复制没有成功,文本已选中,请按 Ctrl/Cmd+C 手动复制。');
  };

  /* ---------- 导入 ---------- */
  function importMsg(text) { const m = $('import-msg'); m.textContent = text || ''; m.hidden = !text; if (text) m.scrollIntoView({ block: 'nearest' }); /* 提示在页面下方,窄屏要滚到可见处 */ }
  function applyImport(v) {
    state = { version: v.state.version, nodes: v.state.nodes, collapsed: v.state.collapsed, sample: v.state.sample === true };
    selectedId = null; mode = 'new'; newParentId = null;
    commit('已导入 ' + state.nodes.length + ' 个节点。');
  }
  $('import-file').onchange = async e => {
    const f = e.target.files && e.target.files[0];
    $('import-confirm').hidden = true;
    pendingImport = null;
    importMsg('');
    if (!f) return;
    setTab('export'); /* 拒绝原因与替换确认都在「骨架与导出」页;从顶部按钮导入时要先切过去才看得到 */
    let text;
    try { text = await f.text(); } catch (err) { importMsg('读取文件失败,没有导入。'); e.target.value = ''; return; }
    const v = C.validateImport(text);
    e.target.value = '';
    if (!v.ok) { importMsg('「' + f.name + '」整份被拒绝,没有导入任何内容:' + v.error); return; }
    if (state.nodes.length || formDirty()) {
      pendingImport = v;
      $('import-confirm-count').textContent = scopeText();
      $('import-confirm-detail').textContent = '备份文件「' + f.name + '」里有 ' + v.state.nodes.length + ' 个节点' + (v.state.sample ? '(带“合成示例”标记)' : '') + '。';
      $('import-confirm').hidden = false;
      $('import-confirm').scrollIntoView({ block: 'nearest' });
    } else applyImport(v);
  };
  $('import-btn').onclick = () => $('import-file').click();
  $('import-btn-top').onclick = () => $('import-file').click();
  $('import-yes').onclick = () => { if (pendingImport) { const v = pendingImport; pendingImport = null; $('import-confirm').hidden = true; applyImport(v); } };
  $('import-no').onclick = () => { pendingImport = null; $('import-confirm').hidden = true; importMsg('已取消导入,当前数据没有变化。'); };

  /* ---------- 示例 / 清空 ---------- */
  function applySample() {
    state = Object.assign(clone(globalThis.ORGCHART_SAMPLE), { sample: true });
    selectedId = null; mode = 'new'; newParentId = null;
    $('sample-confirm').hidden = true;
    commit('已载入合成示例(' + state.nodes.length + ' 个节点,不是真实配置)。');
  }
  function askSample() {
    if (state.nodes.length || formDirty()) {
      $('sample-confirm-count').textContent = String(state.nodes.length);
      $('sample-confirm-draft').textContent = formDirty() ? '和表单里未保存的内容' : '';
      $('sample-confirm').hidden = false;
      $('sample-confirm').scrollIntoView({ block: 'nearest' });
    } else applySample();
  }
  $('load-sample').onclick = askSample;
  $('empty-sample').onclick = askSample;
  $('sample-confirm-yes').onclick = applySample;
  $('sample-confirm-no').onclick = () => { $('sample-confirm').hidden = true; };
  $('clear-data').onclick = () => { $('clear-confirm-text').textContent = '确认清空全部 ' + scopeText() + '?'; $('clear-confirm').hidden = false; };
  $('clear-confirm-no').onclick = () => { $('clear-confirm').hidden = true; };
  $('clear-confirm-yes').onclick = () => {
    state = C.emptyState();
    selectedId = null; mode = 'new'; newParentId = null;
    $('clear-confirm').hidden = true;
    commit('已清空全部节点。');
  };
  $('empty-root').onclick = () => {
    state = { version: C.VERSION, collapsed: [], sample: false, nodes: [{ id: 'n1', name: '我', duty: '定方向、做最终决定', inputFrom: [], outputTo: [], trigger: { kind: 'manual', text: '' }, status: 'running', interventions: ['none'], parentId: null, runningSince: '', weekly: 0 }] };
    mode = 'new'; selectedId = null;
    commit('已创建根节点「我」。');
    $('f-name').focus();
  };

  /* ---------- 标签页 ---------- */
  function setTab(name) {
    activeTab = name;
    document.querySelectorAll('.tabs [role=tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === name ? 'true' : 'false'));
    for (const t of ['chart', 'stats', 'export']) $('tab-' + t).hidden = t !== name;
    hideTip();
  }
  document.querySelectorAll('.tabs [role=tab]').forEach(b => { b.onclick = () => setTab(b.dataset.tab); });

  function renderBanners() {
    $('sample-banner').hidden = !state.sample;
    const tn = $('today-note');
    let fixed = null;
    try { fixed = new URLSearchParams(location.search).get('today'); } catch (e) { fixed = null; }
    tn.hidden = !(fixed && fixed === TODAY);
    if (!tn.hidden) tn.textContent = '基准日 ' + TODAY + '(由地址参数固定)';
  }
  function renderAll(keepForm) {
    renderBanners();
    renderChart();
    if (!keepForm) renderForm();
    renderStats();
    renderExport();
  }

  state = load();
  renderAll();
  setTab(activeTab);
})();
