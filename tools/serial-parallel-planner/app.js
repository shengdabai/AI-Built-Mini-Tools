'use strict';
(function () {
  const C = globalThis.TongbingCore;
  const SAMPLE = globalThis.TONGBING_SAMPLE;
  const KEY = 'tongbingban.v1';
  const $ = id => document.getElementById(id);

  function localToday() {
    const d = new Date();
    const p = n => (n < 10 ? '0' : '') + n;
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  const TODAY = C.parseToday(location.search, localToday());

  let state = C.emptyState();
  let editingId = null;
  let cycleIds = new Set();
  let rejectedId = null;
  let pending = null;

  function h(tag, props) {
    const e = document.createElement(tag);
    Object.keys(props || {}).forEach(k => {
      const v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    });
    for (let i = 2; i < arguments.length; i++) {
      [].concat(arguments[i]).forEach(c => { if (c !== null && c !== undefined && c !== false) e.append(c); });
    }
    return e;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function show(el, text) { el.textContent = text; el.hidden = !text; }

  /* ---------- 存储 ---------- */
  function setSaveState(ok, detail) {
    const s = $('save-state'), w = $('save-warning');
    if (ok) {
      s.textContent = '已保存到本机浏览器';
      s.classList.remove('is-bad');
      w.hidden = true;
    } else {
      s.textContent = '未保存';
      s.classList.add('is-bad');
      clear(w);
      w.append(h('p', { text: '未保存:浏览器拒绝写入(' + detail + ')。刷新或关闭页面后这次改动会丢失,请先点下面的按钮备份。' }),
        h('button', { type: 'button', class: 'btn', id: 'warn-export', text: '导出当前内存中的全部任务与模板 JSON 备份', onclick: exportJson }));
      w.hidden = false;
    }
  }
  function save() {
    try {
      const v = C.validateState(state);
      if (!v.ok) throw new Error('数据校验失败:' + v.errors[0]);
      localStorage.setItem(KEY, C.toJson(state));
      setSaveState(true);
      return true;
    } catch (e) {
      setSaveState(false, e && e.name ? e.name : '未知错误');
      return false;
    }
  }
  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { return; }
    if (!raw) return;
    const r = C.parseState(raw);
    if (r.ok) { state = r.state; setSaveState(true); return; }
    try { localStorage.setItem(KEY + '.rejected', raw); } catch (e) { /* 尽力备份 */ }
    notice('本机保存的数据未通过校验,已忽略并另存为备份键(' + KEY + '.rejected):' + r.errors[0]);
  }

  /* ---------- 状态变更 ---------- */
  function notice(text) { show($('notice'), text); }
  function commit(next, msg) {
    const v = C.validateState(next);
    if (!v.ok) { notice('没有应用:' + v.errors[0]); return false; }
    state = v.state;
    cycleIds = new Set();
    rejectedId = null;
    show($('cycle-box'), '');
    save();
    notice(msg || '');
    render();
    return true;
  }
  const withTasks = tasks => Object.assign({}, state, { tasks });

  function ask(text, yesLabel, fn) {
    pending = fn;
    const box = $('confirm-box');
    clear(box);
    box.append(h('p', { text }),
      h('button', { type: 'button', class: 'btn btn-primary', id: 'confirm-yes', text: yesLabel, onclick: () => { const f = pending; closeAsk(); f(); } }),
      h('button', { type: 'button', class: 'btn', id: 'confirm-no', text: '取消', onclick: closeAsk }));
    box.hidden = false;
    $('confirm-yes').focus();
  }
  function closeAsk() { pending = null; $('confirm-box').hidden = true; clear($('confirm-box')); }
  const hasData = () => state.tasks.length > 0;

  /* ---------- 渲染 ---------- */
  function render() {
    $('preview-flag').hidden = true;
    renderSample();
    const sched = C.schedule(state.tasks);
    renderSummary(sched);
    renderTasks();
    renderDeps();
    renderGantt(sched);
    renderHints(sched);
    renderTemplates();
    const none = state.tasks.length === 0;
    $('empty-guide').hidden = !none;
    syncDirty();
    $('task-count').textContent = none ? '' : '(' + state.tasks.length + ' 项)';
  }

  function formDirty() {
    return !!editingId || $('f-name').value.trim() !== '' || $('f-dur').value.trim() !== '' || $('f-earliest').value.trim() !== '' ||
      $('f-type').value !== 'present' || !!$('f-deps').querySelector('input:checked');
  }
  /* 表单有未保存内容(含预览)时,普通导出、保存模板暂停;避免导出内容与界面不一致 */
  function syncDirty() {
    const none = state.tasks.length === 0, dirty = formDirty();
    $('export-svg').disabled = none || dirty;
    $('export-csv').disabled = none || dirty;
    $('export-json').disabled = (none && state.templates.length === 0) || dirty;
    $('tpl-save').disabled = none || dirty;
    $('export-note').hidden = !dirty;
    $('f-cancel').hidden = !dirty;
    $('f-cancel').textContent = editingId ? '取消修改' : '清空表单';
  }
  function renderSample() {
    $('sample-badge').hidden = !state.sample;
    const t = $('today-note');
    let fixed = null;
    try { fixed = new URLSearchParams(location.search).get('today'); } catch (e) { fixed = null; }
    t.hidden = !(fixed && fixed === TODAY);
    if (!t.hidden) t.textContent = '基准日 ' + TODAY + '(由地址参数固定)';
  }

  function renderSummary(s) {
    $('sum-serial').textContent = C.fmtMin(s.serialTotal);
    $('sum-total').textContent = C.fmtMin(s.total);
    $('saved-pct').textContent = s.savedPct + '%';
    $('sum-saved').textContent = s.saved >= 0 ? '省 ' + C.fmtMin(s.saved) : '多 ' + C.fmtMin(-s.saved);
    $('sum-note').textContent = s.slots.length
      ? '“当前顺序下的总时长”按已就绪任务和列表顺序排程,不保证最短时间。节省 = 全部串联做完 − 当前顺序下的总时长;百分比 = 节省 ÷ 串联总和,四舍五入。'
      : '还没有任务,所以三个数字都是 0 分钟。添加任务或载入示例后才会计算。';
  }

  function depNames(t) { return t.deps.map(d => (state.tasks.find(x => x.id === d) || { name: d }).name); }

  function renderTasks() {
    const ul = $('task-list');
    clear(ul);
    const n = state.tasks.length;
    state.tasks.forEach((t, i) => {
      const cls = 'task-item t-' + t.type + (cycleIds.has(t.id) ? ' is-cycle' : '') + (rejectedId === t.id ? ' is-rejected' : '') + (editingId === t.id ? ' is-editing' : '');
      const meta = [C.fmtMin(t.dur)];
      if (t.deps.length) meta.push('前置:' + depNames(t).join('、'));
      if (t.earliest) meta.push('最早第 ' + t.earliest + ' 分钟开始');
      ul.append(h('li', { class: cls, 'data-id': t.id },
        h('div', {},
          h('div', { class: 'task-name' }, h('span', { class: 'tag tag-' + t.type, text: C.TYPE_LABEL[t.type] }), t.name),
          h('div', { class: 'task-meta', text: meta.join(' · ') })),
        h('div', { class: 'task-actions' },
          h('button', { type: 'button', class: 'btn btn-small', 'data-act': 'up', 'aria-label': '上移 ' + t.name, disabled: i === 0, text: '上移', onclick: () => move(t.id, -1) }),
          h('button', { type: 'button', class: 'btn btn-small', 'data-act': 'down', 'aria-label': '下移 ' + t.name, disabled: i === n - 1, text: '下移', onclick: () => move(t.id, 1) }),
          h('button', { type: 'button', class: 'btn btn-small', 'data-act': 'edit', 'aria-label': '修改 ' + t.name, text: '修改', onclick: () => startEdit(t.id) }),
          h('button', { type: 'button', class: 'btn btn-small btn-danger', 'data-act': 'del', 'aria-label': '删除 ' + t.name, text: '删除', onclick: () => remove(t.id) }))));
    });
  }

  function renderDeps() {
    const box = $('f-deps');
    const checked = new Set(Array.from(box.querySelectorAll('input:checked')).map(i => i.value));
    clear(box);
    const others = state.tasks.filter(t => t.id !== editingId);
    if (!others.length) { box.append(h('span', { class: 'muted', text: '还没有其他任务可选。' })); return; }
    others.forEach(t => {
      const cb = h('input', { type: 'checkbox', value: t.id });
      cb.checked = checked.has(t.id);
      box.append(h('label', { class: 'dep-opt' + (cycleIds.has(t.id) ? ' is-cycle' : '') },
        cb,
        h('span', { text: t.name + '(' + C.fmtMin(t.dur) + ')' })));
    });
  }

  function renderGantt(s) {
    const g = $('gantt');
    clear(g);
    if (!s.slots.length) { g.append(h('p', { class: 'gantt-empty', text: '添加任务后,这里会自动生成按耗时比例画出的两条泳道。' })); return; }
    const ticks = C.axisTicks(s.total);
    const lane = (key, title, sub, slots) => {
      const axis = h('div', { class: 'axis', 'aria-hidden': 'true' }, h('div', { class: 'axis-spacer' }),
        h('div', { class: 'axis-track' }, ticks.map((m, i) => {
          const tk = h('span', { class: 'tick' + (i === 0 ? ' is-first' : '') + (i === ticks.length - 1 && i > 0 ? ' is-last' : ''), text: String(m) });
          tk.style.left = (m / s.total * 100) + '%';
          return tk;
        })));
      const rows = slots.map(sl => {
        const bar = h('div', { class: 'bar bar-' + sl.lane, 'data-id': sl.id, title: sl.name + ' ' + sl.start + '–' + sl.end + ' 分钟', text: sl.dur + '分' });
        bar.style.setProperty('--bar-left', (sl.start / s.total * 100) + '%');
        bar.style.setProperty('--bar-width', (sl.dur / s.total * 100) + '%');
        return h('div', { class: 'g-row' },
          h('div', { class: 'g-label' }, h('span', { class: 'g-name', text: sl.name }), h('span', { class: 'g-time', text: sl.start + '–' + sl.end + ' 分钟' })),
          h('div', { class: 'g-track' }, bar));
      });
      return h('section', { class: 'lane lane-' + key, 'data-lane': key },
        h('h3', { class: 'lane-title' }, h('span', { text: title }), h('span', { class: 'lane-sub', text: sub })),
        axis, rows);
    };
    const pres = s.slots.filter(x => x.lane === 'present');
    const auto = s.slots.filter(x => x.lane === 'auto').sort((a, b) => a.row - b.row || a.start - b.start);
    g.append(lane('present', '在场(我必须在)', pres.length + ' 项,一次只做一件', pres),
      lane('auto', '放着跑(并联)', auto.length + ' 项,不占用我', auto));
  }

  function renderHints(s) {
    const ul = $('hints');
    clear(ul);
    const hs = C.hints(s);
    if (!hs.length) { ul.append(h('li', { class: 'hint-none', text: state.tasks.length ? '目前没有触发提示。' : '添加任务后显示。' })); return; }
    hs.forEach(x => ul.append(h('li', { 'data-kind': x.kind, text: x.text })));
  }

  function renderTemplates() {
    const ul = $('tpl-list');
    clear(ul);
    if (!state.templates.length) { ul.append(h('li', { class: 'muted', text: '还没有模板。' })); return; }
    state.templates.forEach(tp => {
      ul.append(h('li', { class: 'tpl-item', 'data-id': tp.id },
        h('span', { class: 'tpl-name', text: tp.name + '(' + tp.tasks.length + ' 项,' + tp.savedAt + (tp.sample ? ',合成示例' : '') + ')' }),
        h('button', { type: 'button', class: 'btn btn-small', 'data-act': 'tpl-load', 'aria-label': '载入模板 ' + tp.name, text: '载入', onclick: () => loadTemplate(tp.id) }),
        h('button', { type: 'button', class: 'btn btn-small btn-danger', 'data-act': 'tpl-del', 'aria-label': '删除模板 ' + tp.name, text: '删除', onclick: () => delTemplate(tp.id) })));
    });
  }

  /* ---------- 任务操作 ---------- */
  function move(id, dir) {
    const r = C.moveTask(state.tasks, id, dir);
    if (!r.ok) {
      rejectedId = r.id || id;
      notice('没有移动:' + r.reason);
      renderTasks();
      return;
    }
    if (commit(withTasks(r.tasks), '已调整顺序,甘特图已重排。')) {
      const li = $('task-list').querySelector('[data-id="' + id + '"]');
      const b = li && (li.querySelector('[data-act=' + (dir < 0 ? 'up' : 'down') + ']:not(:disabled)') || li.querySelector('[data-act=' + (dir < 0 ? 'down' : 'up') + ']:not(:disabled)'));
      if (b) b.focus();
    }
  }

  function remove(id) {
    const t = state.tasks.find(x => x.id === id);
    const idx = state.tasks.findIndex(x => x.id === id);
    const affected = C.dependentsOf(state.tasks, id).map(x => x.name);
    const text = '删除任务「' + t.name + '」(' + C.fmtMin(t.dur) + ')?' +
      (affected.length ? '「' + affected.join('」「') + '」把它当前置,确认后会同时从这些任务的前置里移除它(这些任务本身不会被删除)。' : '没有其他任务依赖它。') +
      '确认前任务列表、甘特图和统计都不变。';
    ask(text, '确认删除', () => {
      const tasks = state.tasks.filter(x => x.id !== id).map(x => Object.assign({}, x, { deps: x.deps.filter(d => d !== id) }));
      if (editingId === id) stopEdit();
      commit(withTasks(tasks), '已删除「' + t.name + '」' + (affected.length ? ',并从「' + affected.join('」「') + '」的前置里移除它。' : '。'));
      const li = $('task-list').children[Math.min(idx, tasks.length - 1)];
      const b = li && li.querySelector('[data-act=edit]');
      (b || $('f-name')).focus();
    });
  }

  function startEdit(id) {
    const t = state.tasks.find(x => x.id === id);
    editingId = id;
    $('f-name').value = t.name;
    $('f-dur').value = String(t.dur);
    $('f-type').value = t.type;
    $('f-earliest').value = t.earliest ? String(t.earliest) : '';
    $('form-title').textContent = '修改任务「' + t.name + '」';
    $('f-submit').textContent = '保存修改';
    $('f-cancel').hidden = false;
    renderDeps();
    Array.from($('f-deps').querySelectorAll('input')).forEach(i => { i.checked = t.deps.includes(i.value); });
    renderTasks();
    $('f-name').focus();
  }
  function stopEdit() {
    editingId = null;
    $('task-form').reset();
    $('form-title').textContent = '新增任务';
    $('f-submit').textContent = '添加任务';
    $('f-cancel').hidden = true;
    cycleIds = new Set();
    show($('cycle-box'), '');
    show($('form-error'), '');
    clearInvalid();
    renderDeps();
    renderTasks();
    syncDirty();
  }

  /* 读表单:{task} 或 {error}。名称为空时仅用于预览(提交仍要求名称) */
  function readForm(forPreview) {
    const name = $('f-name').value.trim();
    const durRaw = $('f-dur').value.trim();
    const earlyRaw = $('f-earliest').value.trim();
    if (!name && !forPreview) return { error: '请填写任务名称。', field: 'f-name' };
    if (!/^\d+$/.test(durRaw) || Number(durRaw) < 1 || !Number.isSafeInteger(Number(durRaw))) return { error: '耗时必须是正整数(分钟)。', field: 'f-dur' };
    if (earlyRaw && (!/^\d+$/.test(earlyRaw) || !Number.isSafeInteger(Number(earlyRaw)))) return { error: '最早开始必须是 0 或正整数(分钟),也可以不填。', field: 'f-earliest' };
    const deps = Array.from($('f-deps').querySelectorAll('input:checked')).map(i => i.value);
    return { task: { id: editingId || C.nextId(state.tasks), name: name || '(新任务)', dur: Number(durRaw), type: $('f-type').value, deps, earliest: earlyRaw ? Number(earlyRaw) : 0 } };
  }
  function candidateWith(task) { return editingId ? state.tasks.map(t => (t.id === editingId ? task : t)) : state.tasks.concat([task]); }
  function markCycle(g, candidate) {
    cycleIds = new Set(g.members);
    const nm = id => '「' + candidate.find(t => t.id === id).name + '」';
    show($('cycle-box'), '循环依赖,没有保存:' + g.cycle.map(nm).join(' → ') + ' → ' + nm(g.cycle[0]) + '。红色标出的任务互相等待,请去掉其中一条前置。');
    renderTasks();
    Array.from($('f-deps').querySelectorAll('.dep-opt')).forEach(l => l.classList.toggle('is-cycle', cycleIds.has(l.querySelector('input').value)));
  }
  /* 控件改动即时重排:只预览,提交才落盘 */
  function preview() {
    const r = readForm(true);
    clearInvalid();
    if (r.error) { show($('form-error'), ''); render(); return; }
    show($('form-error'), '');
    syncDirty();
    const candidate = candidateWith(r.task);
    const g = C.topoSort(candidate);
    if (g.cycle) { markCycle(g, candidate); return; }
    if (g.missing) return;
    if (cycleIds.size) {
      cycleIds = new Set();
      show($('cycle-box'), '');
      renderTasks();
      Array.from($('f-deps').querySelectorAll('.dep-opt')).forEach(l => l.classList.remove('is-cycle'));
    }
    const sched = C.schedule(C.normalizeOrder(candidate));
    renderSummary(sched);
    renderGantt(sched);
    renderHints(sched);
    $('preview-flag').hidden = false;
  }

  function clearInvalid() { ['f-name', 'f-dur', 'f-earliest'].forEach(id => $(id).removeAttribute('aria-invalid')); }
  function onSubmit(ev) {
    ev.preventDefault();
    show($('form-error'), '');
    clearInvalid();
    const r = readForm(false);
    if (r.error) {
      show($('form-error'), r.error);
      $(r.field).setAttribute('aria-invalid', 'true');
      $(r.field).focus();
      return;
    }
    const task = r.task, name = task.name, deps = task.deps;
    const candidate = candidateWith(task);
    const g = C.topoSort(candidate);
    if (g.cycle) {
      markCycle(g, candidate);
      return;
    }
    if (g.missing) return show($('form-error'), '前置任务不存在,没有保存。');
    const ordered = C.normalizeOrder(candidate);
    const reordered = ordered.some((t, i) => t.id !== candidate[i].id);
    const wasEdit = !!editingId;
    if (commit(withTasks(ordered), (wasEdit ? '已保存修改「' : '已添加「') + name + '」,甘特图已重排。' + (reordered ? '顺序已按前置关系自动调整。' : ''))) {
      editingId = null;
      $('task-form').reset();
      $('form-title').textContent = '新增任务';
      $('f-submit').textContent = '添加任务';
      $('f-cancel').hidden = true;
      renderDeps();
      renderTasks();
      syncDirty();
      $('f-name').focus();
    }
  }

  /* ---------- 示例 / 清空 / 模板 ---------- */
  function applySample() {
    const tasks = JSON.parse(JSON.stringify(SAMPLE.tasks));
    stopEdit();
    commit(Object.assign(withTasks(tasks), { sample: true }), '已载入' + SAMPLE.label + '(合成数据,不是真实记录)。');
  }
  function draftText() { return formDirty() ? '和表单里尚未保存的内容' : ''; }
  function onSample() {
    if (hasData() || formDirty()) ask('载入示例会替换当前的 ' + state.tasks.length + ' 项任务' + draftText() + '(' + state.templates.length + ' 个模板不受影响)。确认替换吗?', '确认替换', applySample);
    else applySample();
  }
  function onClear() {
    if (!hasData() && !state.templates.length && !formDirty()) return notice('当前没有数据可清空。');
    ask('清空会删除全部 ' + state.tasks.length + ' 项任务、' + state.templates.length + ' 个模板' + draftText() + ',且无法恢复。建议先导出 JSON 备份。确认清空吗?', '确认清空', () => {
      stopEdit();
      state = C.emptyState();
      try { localStorage.removeItem(KEY); setSaveState(true); } catch (e) { setSaveState(false, e && e.name ? e.name : '未知错误'); }
      notice('已清空。');
      render();
    });
  }
  function saveTemplate() {
    const name = $('tpl-name').value.trim() || ('今日排程 ' + TODAY);
    const ids = state.templates.map(t => t.id);
    let n = state.templates.length + 1;
    while (ids.includes('p' + n)) n++;
    const tp = { id: 'p' + n, name, savedAt: TODAY, sample: !!state.sample, tasks: JSON.parse(JSON.stringify(state.tasks)) };
    if (commit(Object.assign({}, state, { templates: state.templates.concat([tp]) }), '已保存模板「' + name + '」。')) $('tpl-name').value = '';
  }
  function loadTemplate(id) {
    const tp = state.templates.find(t => t.id === id);
    const apply = () => { stopEdit(); commit(Object.assign(withTasks(JSON.parse(JSON.stringify(tp.tasks))), { sample: !!tp.sample }), '已载入模板「' + tp.name + '」。'); };
    if (hasData() || formDirty()) ask('载入模板「' + tp.name + '」会替换当前的 ' + state.tasks.length + ' 项任务' + draftText() + '。确认替换吗?', '确认替换', apply);
    else apply();
  }
  function delTemplate(id) {
    const tp = state.templates.find(t => t.id === id);
    ask('删除模板「' + tp.name + '」?', '确认删除', () => commit(Object.assign({}, state, { templates: state.templates.filter(t => t.id !== id) }), '已删除模板。'));
  }

  /* ---------- 导出 / 导入 ---------- */
  function download(name, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function palette() {
    const cs = getComputedStyle(document.documentElement);
    const v = n => cs.getPropertyValue(n).trim();
    return { present: v('--color-lane-present'), auto: v('--color-lane-auto'), text: v('--color-text'), grid: v('--color-grid'), bg: v('--color-bg') };
  }
  function exportSvg() { download('甘特-' + TODAY + '.svg', C.toSvg(C.schedule(state.tasks), palette(), { sample: state.sample }), 'image/svg+xml'); notice('已导出甘特 SVG。'); }
  function exportCsv() { download('任务-' + TODAY + '.csv', '\uFEFF' + C.toCsv(state.tasks, C.schedule(state.tasks), { sample: state.sample }), 'text/csv;charset=utf-8'); notice('已导出任务 CSV。'); }
  function exportJson() { download('统筹板-' + TODAY + '.json', C.toJson(state), 'application/json'); notice('已导出 JSON 备份:当前内存中的 ' + state.tasks.length + ' 项任务、' + state.templates.length + ' 个模板(不含表单里尚未保存的内容)。'); }

  function onImport(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    show($('import-error'), '');
    if (!file) return;
    const rd = new FileReader();
    rd.onerror = () => show($('import-error'), '读取文件失败,没有导入。');
    rd.onload = () => {
      const r = C.parseState(String(rd.result));
      if (!r.ok) { $('import-btn').setAttribute('aria-invalid', 'true'); $('import-btn').focus(); }
      if (!r.ok) return show($('import-error'), '整份拒绝导入,当前数据未改动。原因:' + r.errors.slice(0, 5).join(';') + (r.errors.length > 5 ? ';等共 ' + r.errors.length + ' 条' : ''));
      const apply = () => { stopEdit(); commit(r.state, '已导入 ' + r.state.tasks.length + ' 项任务、' + r.state.templates.length + ' 个模板。'); };
      $('import-btn').removeAttribute('aria-invalid');
      if (hasData() || state.templates.length || formDirty()) ask('导入将用备份中的 ' + r.state.tasks.length + ' 项任务、' + r.state.templates.length + ' 个模板,替换当前的 ' + state.tasks.length + ' 项任务、' + state.templates.length + ' 个模板' + draftText() + '。确认替换吗?', '确认替换', apply);
      else apply();
    };
    rd.readAsText(file);
  }

  /* ---------- 绑定 ---------- */
  $('task-form').addEventListener('submit', onSubmit);
  $('f-cancel').addEventListener('click', () => { stopEdit(); render(); });
  $('task-form').addEventListener('input', preview);
  $('task-form').addEventListener('change', preview);
  $('load-sample').addEventListener('click', onSample);
  $('empty-sample').addEventListener('click', onSample);
  $('clear-data').addEventListener('click', onClear);
  $('tpl-save').addEventListener('click', saveTemplate);
  $('export-svg').addEventListener('click', exportSvg);
  $('export-csv').addEventListener('click', exportCsv);
  $('export-json').addEventListener('click', exportJson);
  $('import-file').addEventListener('change', onImport);
  $('import-btn').addEventListener('click', () => $('import-file').click());

  load();
  render();
})();
