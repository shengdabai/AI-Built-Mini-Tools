'use strict';
(function () {
  const Core = globalThis.LadderCore;
  const KEY = 'ladderboard.v1';
  const $ = id => document.getElementById(id);
  const L = Core.LABELS;

  let state = Core.newProject();
  let saved = null; // null 尚无写入;true 最近一次写入成功;false 最近一次写入失败
  let editingId = null;
  let pendingConfirm = null;
  let dragId = null;
  let noticeTimer = null;
  let draftView = null;      // 表单草稿合法时的预览项目(只用于显示,不写入存储)
  let formDirty = false;     // 表单相对基线有未保存的改动
  let formBaseline = '';
  let draftReason = '';
  const MOS_UI = { must: '必须做 Must', should: '应该做 Should', could: '可以做 Could', wont: "本次不做 Won't" };
  const LAYER_UI = { unit: '单测', integration: '集成', e2e: '端到端 E2E', screenshot: '截图', real: '真实依赖' };
  const viewState = () => draftView || state;

  /* ---------- 小工具 ---------- */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (v === false || v === null || v === undefined) return;
      if (k === 'class') el.className = v;
      else if (k === 'data') Object.entries(v).forEach(([dk, dv]) => { el.dataset[dk] = dv; });
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    kids.flat().forEach(c => { if (c !== null && c !== undefined && c !== false) el.append(c); });
    return el;
  }
  const clone = o => JSON.parse(JSON.stringify(o));
  const keywordsCustomized = () => state.keywords.join('\n') !== Core.DEFAULT_KEYWORDS.join('\n');
  const hasData = () => state.features.length > 0 || state.name.trim() !== '' || [1, 2, 3].some(g => state.evidence[g].trim() !== '') || keywordsCustomized();

  /* ---------- 存储 ---------- */
  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      saved = true;
    } catch (e) {
      saved = false;
    }
    return saved;
  }
  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { return; }
    if (raw === null) return;
    let obj;
    try { obj = JSON.parse(raw); } catch (e) { notify('本机保存的数据无法解析,已按空白开始(原数据未被删除,下次保存才会覆盖)。', 'error', true); return; }
    const r = Core.validateState(obj);
    if (!r.ok) { notify('本机保存的数据未通过校验,已按空白开始(原数据未被删除,下次保存才会覆盖):' + r.errors[0], 'error', true); return; }
    state = obj;
    saved = true;
  }

  function commit(next, okMsg) {
    const v = Core.validateState(next);
    if (!v.ok) { notify('改动没有应用:' + v.errors[0], 'error', true); return false; }
    state = next;
    const ok = persist();
    renderAll();
    if (okMsg) notify(ok ? okMsg + '。已保存。' : okMsg + '。注意:尚未保存。', ok ? 'ok' : 'error', !ok);
    return true;
  }

  /* ---------- 提示与确认 ---------- */
  function notify(msg, kind, sticky) {
    const n = $('notice');
    n.textContent = msg;
    n.className = 'notice notice-' + (kind || 'ok');
    n.hidden = false;
    clearTimeout(noticeTimer);
    if (!sticky) noticeTimer = setTimeout(() => { n.hidden = true; }, 6000);
  }
  function ask(msg, yes) {
    pendingConfirm = yes;
    $('confirm-text').textContent = msg;
    $('confirm-area').hidden = false;
    $('confirm-yes').focus();
  }
  function closeConfirm() { pendingConfirm = null; $('confirm-area').hidden = true; }

  /* ---------- 渲染 ---------- */
  function issueLevels(issues) {
    const m = new Map();
    issues.forEach(i => i.ids.forEach(id => { if (m.get(id) !== 'block') m.set(id, i.level); }));
    return m;
  }

  function renderSummary(res) {
    const preview = Boolean(draftView);
    const s = res.stats;
    const stat = (label, value, tone) => h('li', { class: 'stat' + (tone ? ' stat-' + tone : '') }, h('span', { class: 'stat-value', text: value }), h('span', { class: 'stat-label', text: label }));
    const stats = $('stats');
    stats.replaceChildren(
      stat((preview ? '预览 · ' : '') + '必须做 Must(上限 ' + Core.MUST_LIMIT + ')', s.counts.must + ' / ' + Core.MUST_LIMIT, s.counts.must > Core.MUST_LIMIT ? 'danger' : ''),
      stat('阻断', String(s.block), s.block ? 'danger' : 'ok'),
      stat('警告', String(s.warn), s.warn ? 'warn' : 'ok'),
      stat('功能数', String(s.total)),
      stat((preview ? '预览 · ' : '') + '预计总小时(不含已砍、本次不做)', String(s.totalHours))
    );
  }

  function actionBtn(f, act, label, full, disabled) {
    return h('button', { type: 'button', class: 'btn btn-sm', data: { act, id: f.id }, 'aria-label': full + ':' + f.name, title: full, disabled }, label);
  }

  function renderCard(f, levels, previewId) {
    const lv = levels.get(f.id);
    const card = h('article', { class: 'card' + (f.status === 'cut' ? ' card-cut' : ''), draggable: 'true', data: { id: f.id } },
      h('div', { class: 'card-top' },
        h('strong', { class: 'card-name', text: f.name }),
        f.id === previewId ? h('span', { class: 'chip chip-ok', text: '预览(未保存)' }) : null,
        lv ? h('span', { class: 'chip chip-' + (lv === 'block' ? 'danger' : 'warn'), text: lv === 'block' ? '阻断' : '警告' }) : null),
      f.task ? h('p', { class: 'card-task', text: f.task }) : null,
      h('p', { class: 'card-meta' },
        h('span', { class: 'chip', text: f.hours + ' 小时' }),
        h('span', { class: 'chip' + (f.layer ? '' : ' chip-muted'), text: f.layer ? LAYER_UI[f.layer] : '无验证层' }),
        h('span', { class: 'chip chip-status-' + f.status, text: L.status[f.status] }),
        f.deps.length ? h('span', { class: 'chip', text: '依赖 ' + f.deps.length }) : null),
      h('div', { class: 'card-actions' },
        actionBtn(f, 'gate-prev', '← 门', '移到前一门', f.gate === 1),
        actionBtn(f, 'gate-next', '门 →', '移到后一门', f.gate === 3),
        actionBtn(f, 'lvl-up', '↑ 级', '提高 MoSCoW 等级', f.moscow === 'must'),
        actionBtn(f, 'lvl-down', '↓ 级', '降低 MoSCoW 等级', f.moscow === 'wont'),
        actionBtn(f, 'edit', '编辑', '编辑'),
        actionBtn(f, 'delete', '删除', '删除')));
    card.addEventListener('dragstart', e => { dragId = f.id; e.dataTransfer.setData('text/plain', f.id); e.dataTransfer.effectAllowed = 'move'; });
    card.addEventListener('dragend', () => { dragId = null; });
    return card;
  }

  function renderBoard(res) {
    const board = $('board');
    const vs = viewState();
    const gates = Core.gateStatus(state);
    const levels = issueLevels(res.issues);
    const cols = Core.ladder(vs.features);
    const previewId = draftView ? draftId() : null;
    if (vs.features.length === 0) {
      board.replaceChildren(h('div', { class: 'empty' },
        h('h3', { text: '还没有功能' }),
        h('p', { text: '从「载入示例」看一个完整的取舍过程,或在下方表单添加第一个功能。三个门各有过门证据,没拿到证据,下一门的功能就标灰。' }),
        h('button', { type: 'button', class: 'btn btn-primary', data: { act: 'sample' } }, '载入示例')));
      return;
    }
    board.replaceChildren(...cols.map(col => {
      const gs = gates[col.gate - 1];
      const body = h('div', { class: 'gate-body' },
        Core.MOSCOW.map(m => {
          const list = col.groups[m];
          const zone = h('div', { class: 'group-zone', data: { gate: col.gate, moscow: m } },
            list.length ? list.map(f => renderCard(f, levels, previewId)) : h('p', { class: 'group-empty', text: '拖到这里,或用卡片上的按钮' }));
          zone.addEventListener('dragover', e => { if (dragId) { e.preventDefault(); zone.classList.add('over'); } });
          zone.addEventListener('dragleave', () => zone.classList.remove('over'));
          zone.addEventListener('drop', e => {
            e.preventDefault(); zone.classList.remove('over');
            const id = dragId || e.dataTransfer.getData('text/plain');
            dragId = null;
            if (id) moveFeature(id, col.gate, m);
          });
          return h('section', { class: 'group group-' + m, 'aria-label': L.gate[col.gate] + ' ' + MOS_UI[m] },
            h('h4', { class: 'group-title' }, MOS_UI[m], h('span', { class: 'group-count', text: String(list.length) })),
            zone);
        }));
      return h('section', { class: 'gate' + (gs.locked ? ' gate-locked' : ''), data: { gate: col.gate }, 'aria-label': L.gate[col.gate] },
        h('header', { class: 'gate-head' },
          h('h3', { text: L.gate[col.gate] }),
          h('p', { class: 'gate-sum' },
            h('span', { class: 'chip ' + (gs.passed ? 'chip-ok' : 'chip-muted'), text: gs.passed ? '已过门' : '未过门' }),
            h('span', { class: 'gate-hours', text: col.hours + ' 小时 · ' + col.count + ' 个功能' })),
          gs.locked ? h('p', { class: 'gate-hint', text: gs.hint }) : null),
        body);
    }));
  }

  function renderIssues(res) {
    const ul = $('issues');
    const vs = viewState();
    if (vs.features.length === 0) { ul.replaceChildren(h('li', { class: 'issue-none', text: '添加功能后,这里会自动检查。' })); return; }
    if (res.issues.length === 0) { ul.replaceChildren(h('li', { class: 'issue-none', text: '没有触发任何规则。' })); return; }
    const sorted = res.issues.filter(i => i.level === 'block').concat(res.issues.filter(i => i.level === 'warn'));
    ul.replaceChildren(...sorted.map(i => h('li', { class: 'issue issue-' + i.level },
      h('span', { class: 'chip ' + (i.level === 'block' ? 'chip-danger' : 'chip-warn'), text: i.level === 'block' ? '阻断' : '警告' }),
      h('span', { class: 'issue-msg', text: i.message }),
      i.ids.length && state.features.some(f => f.id === i.ids[0]) ? h('button', { type: 'button', class: 'btn btn-sm', data: { act: 'edit', id: i.ids[0] } }, '编辑「' + vs.features.find(f => f.id === i.ids[0]).name + '」') : null)));
  }

  function renderDeps(depIds) {
    const box = $('f-deps');
    const checked = new Set(depIds || currentDepsDraft());
    const others = state.features.filter(f => f.id !== editingId);
    if (others.length === 0) { box.replaceChildren(h('p', { class: 'hint', text: '还没有其他功能可依赖。' })); return; }
    box.replaceChildren(...others.map(f => {
      const cb = h('input', { type: 'checkbox', value: f.id, checked: checked.has(f.id) });
      return h('label', { class: 'dep' }, cb, h('span', { text: f.name }));
    }));
  }
  function currentDepsDraft() {
    return Array.from($('f-deps').querySelectorAll('input:checked')).map(i => i.value);
  }

  function renderEvidence() {
    const gates = Core.gateStatus(state);
    gates.forEach(g => {
      const chip = $('evchip-' + g.gate);
      chip.textContent = g.passed ? '已过门' : '未过门';
      chip.className = 'chip ' + (g.passed ? 'chip-ok' : 'chip-muted');
    });
  }

  function syncInputs() {
    const set = (el, v) => { if (el.value !== v && document.activeElement !== el) el.value = v; };
    set($('project-name'), state.name);
    set($('kw'), state.keywords.join('、'));
    [1, 2, 3].forEach(g => set($('ev-' + g), state.evidence[g]));
  }

  function renderSaveState() {
    const s = $('save-state');
    if (saved === false) { s.textContent = '未保存'; s.className = 'save-state save-state-bad'; }
    else if (saved === true) { s.textContent = '已保存在本机浏览器'; s.className = 'save-state'; }
    else { s.textContent = '尚无数据'; s.className = 'save-state'; }
    $('storage-banner').hidden = saved !== false;
  }

  function renderExport() {
    const empty = state.features.length === 0;
    ['export-md', 'export-csv', 'export-json'].forEach(id => { $(id).disabled = empty || formDirty; });
    $('md-preview').textContent = empty ? '添加功能后,这里显示 PRD 片段预览。' : (formDirty ? '表单里有未保存的修改,PRD 片段预览与导出已暂停。请先点「' + $('f-submit').textContent + '」保存,或点「' + cancelLabel() + '」放弃。' : Core.toPrdMarkdown(state));
    const note = $('export-note');
    note.textContent = formDirty ? '导出已停用:表单里有未保存的修改。保存或放弃修改后才能导出。' : '导出的是已保存的数据(与页面一致)。表单里有未保存的修改时,导出会停用。';
  }

  /* ---------- 表单草稿:读取、预览、错误 ---------- */
  function formSnapshot() {
    return JSON.stringify([$('f-name').value, $('f-task').value, $('f-gate').value, $('f-moscow').value, $('f-hours').value, $('f-layer').value, $('f-status').value, currentDepsDraft()]);
  }
  function draftId() { return editingId || Core.nextId(state.features); }
  function readDraft() {
    const errors = [];
    const hours = Core.parseHours($('f-hours').value);
    if (Number.isNaN(hours)) errors.push({ id: 'f-hours', msg: '预计小时必须是不小于 0 的数字,例如 4 或 2.5。' });
    const base = editingId ? state.features.find(f => f.id === editingId) : null;
    const feature = {
      id: draftId(),
      name: $('f-name').value.trim(),
      task: $('f-task').value.trim(),
      gate: Number($('f-gate').value),
      moscow: $('f-moscow').value,
      hours,
      deps: currentDepsDraft().filter(d => d !== (base && base.id)),
      layer: $('f-layer').value,
      status: $('f-status').value,
    };
    if (!Number.isNaN(hours)) {
      const fv = Core.validateFeature(feature);
      if (!fv.ok) fv.errors.forEach(e => errors.push({ id: /小时/.test(e) ? 'f-hours' : 'f-name', msg: e }));
    }
    if (feature.name === '' && !errors.some(e => e.id === 'f-name')) errors.push({ id: 'f-name', msg: '功能名不能为空。' });
    return { feature, errors };
  }
  function computeDraft() {
    formDirty = formSnapshot() !== formBaseline;
    draftView = null; draftReason = '';
    if (!formDirty) return;
    const d = readDraft();
    if (d.errors.length) { draftReason = d.errors[0].msg; return; }
    draftView = Core.applyDraft(state, d.feature);
  }
  function cancelLabel() { return editingId ? '取消编辑' : '清空表单'; }
  function renderDraftNote() {
    const n = $('draft-note');
    $('f-cancel').hidden = !(editingId || formDirty);
    $('f-cancel').textContent = cancelLabel();
    if (!formDirty) { n.hidden = true; return; }
    n.hidden = false;
    n.textContent = draftView
      ? '预览中:看板、统计和规则检查已按表单内容重算,尚未保存。点「' + $('f-submit').textContent + '」才会写入;点「' + cancelLabel() + '」放弃。'
      : '表单内容还不能预览(' + draftReason + '),看板仍显示已保存的数据。';
  }
  function updatePreview() {
    computeDraft();
    const res = Core.check(viewState());
    renderSummary(res); renderBoard(res); renderIssues(res); renderExport(); renderDraftNote();
    clearFieldErrors();
  }
  function clearFieldErrors() {
    document.querySelectorAll('.field-error').forEach(e => e.remove());
    document.querySelectorAll('#feature-form [aria-invalid]').forEach(e => { e.removeAttribute('aria-invalid'); e.removeAttribute('aria-describedby'); });
    $('form-error').hidden = true;
  }
  function showFieldErrors(errors) {
    clearFieldErrors();
    const seen = new Set();
    errors.forEach(({ id, msg }) => {
      if (seen.has(id)) return;
      seen.add(id);
      const el = $(id);
      const p = h('p', { class: 'field-error', id: 'err-' + id, role: 'alert', text: msg });
      el.closest('.field').append(p);
      el.setAttribute('aria-invalid', 'true');
      el.setAttribute('aria-describedby', 'err-' + id);
    });
    const fe = $('form-error');
    fe.textContent = '有 ' + seen.size + ' 处输入需要修改,原因写在对应输入框下方。';
    fe.hidden = false;
    $(errors[0].id).focus();
  }

  function renderAll() {
    computeDraft();
    const res = Core.check(viewState());
    syncInputs();
    renderSummary(res);
    renderBoard(res);
    renderIssues(res);
    renderDeps();
    renderEvidence();
    renderExport();
    renderSaveState();
    renderDraftNote();
  }

  /* ---------- 操作 ---------- */
  function moveFeature(id, gate, moscow, focusAct) {
    const f = state.features.find(x => x.id === id);
    if (!f) return;
    if (f.gate === gate && f.moscow === moscow) return;
    const next = clone(state);
    const i = next.features.findIndex(x => x.id === id);
    next.features[i] = Core.move(next.features[i], gate, moscow);
    if (commit(next, `「${f.name}」已移到 ${L.gate[gate]} / ${MOS_UI[moscow]}`) && focusAct) refocus(id, focusAct);
  }
  function refocus(id, act) {
    const card = $('board').querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    if (!card) return;
    const btn = card.querySelector(`[data-act="${act}"]:not(:disabled)`) || card.querySelector('[data-act="edit"]');
    if (btn) btn.focus();
  }

  function startEdit(id) {
    const f = state.features.find(x => x.id === id);
    if (!f) return;
    editingId = id;
    $('f-name').value = f.name; $('f-task').value = f.task; $('f-gate').value = String(f.gate); $('f-moscow').value = f.moscow;
    $('f-hours').value = String(f.hours); $('f-layer').value = f.layer; $('f-status').value = f.status;
    $('form-title').textContent = '编辑功能';
    $('f-submit').textContent = '保存修改';
    clearFieldErrors();
    renderDeps(f.deps);
    formBaseline = formSnapshot();
    updatePreview();
    $('feature-form').scrollIntoView({ block: 'center' });
    $('f-name').focus();
  }
  function resetForm() {
    editingId = null;
    $('feature-form').reset();
    $('f-moscow').value = 'should';
    $('form-title').textContent = '添加功能';
    $('f-submit').textContent = '添加功能';
    clearFieldErrors();
    renderDeps([]);
    formBaseline = formSnapshot();
    updatePreview();
  }

  function submitForm(ev) {
    ev.preventDefault();
    const base = editingId ? state.features.find(f => f.id === editingId) : null;
    const { feature, errors } = readDraft();
    if (errors.length) { showFieldErrors(errors); return; }
    const next = clone(state);
    if (base) next.features[next.features.findIndex(f => f.id === base.id)] = feature;
    else next.features.push(feature);
    const wasEdit = Boolean(base);
    if (commit(next, `功能「${feature.name}」已${wasEdit ? '修改' : '添加'}`)) {
      resetForm();
      if (!wasEdit) $('f-name').focus();
    }
  }

  function deleteFeature(id) {
    const f = state.features.find(x => x.id === id);
    if (!f) return;
    const dependents = state.features.filter(x => x.deps.includes(id)).length;
    ask(`确认删除功能「${f.name}」?${dependents ? `有 ${dependents} 个功能依赖它,这些依赖会一并移除。` : '没有其他功能依赖它。'}`, () => {
      const next = clone(state);
      next.features = next.features.filter(x => x.id !== id);
      next.features.forEach(x => { x.deps = x.deps.filter(d => d !== id); });
      if (editingId === id) resetForm();
      commit(next, `功能「${f.name}」已删除`);
    });
  }

  function replaceState(next, msg) {
    editingId = null;
    commit(next, msg);
    resetForm();
  }

  function loadSample() {
    const go = () => replaceState(clone(globalThis.LADDER_SAMPLE), '已载入合成示例');
    if (hasData()) ask('载入示例会替换当前的全部数据(功能、证据、关键词表)。确认替换?建议先导出 JSON 备份。', go);
    else go();
  }
  function clearData() {
    if (!hasData()) { notify('当前没有数据可清空。', 'ok'); return; }
    ask('确认清空全部数据(项目名、功能、过门证据、关键词表)?此操作不能撤销,建议先导出 JSON 备份。', () => replaceState(Core.newProject(), '数据已清空'));
  }

  function download(name, mime, text, bom) {
    const blob = new Blob([bom ? '\uFEFF' + text : text], { type: mime + ';charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const fileBase = () => (state.name.trim() || '功能阶梯').replace(/[\\/:*?"<>|\r\n]+/g, '_');

  async function importFile(file) {
    let text;
    try { text = await file.text(); } catch (e) { notify('读取文件失败:' + e.message, 'error', true); return; }
    const r = Core.validateImport(text);
    if (!r.ok) { notify('导入被拒绝,当前数据没有改动。原因:' + r.error, 'error', true); return; }
    const go = () => replaceState(r.project, `已导入「${file.name}」`);
    if (hasData()) ask('导入会替换当前的全部数据。确认替换?', go);
    else go();
  }

  /* ---------- 事件 ---------- */
  function bind() {
    $('load-sample').addEventListener('click', loadSample);
    $('clear-data').addEventListener('click', clearData);
    $('import-btn').addEventListener('click', () => $('import-file').click());
    $('import-file').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); });
    $('confirm-yes').addEventListener('click', () => { const fn = pendingConfirm; closeConfirm(); if (fn) fn(); });
    $('confirm-no').addEventListener('click', closeConfirm);
    $('feature-form').addEventListener('submit', submitForm);
    $('f-cancel').addEventListener('click', resetForm);
    $('feature-form').addEventListener('input', updatePreview);
    $('feature-form').addEventListener('change', updatePreview);
    $('banner-export').addEventListener('click', () => download(fileBase() + '-备份.json', 'application/json', Core.toJson(state)));
    $('export-md').addEventListener('click', () => download(fileBase() + '-PRD片段.md', 'text/markdown', Core.toPrdMarkdown(state)));
    $('export-csv').addEventListener('click', () => download(fileBase() + '-功能表.csv', 'text/csv', Core.toCsv(state), true));
    $('export-json').addEventListener('click', () => download(fileBase() + '-备份.json', 'application/json', Core.toJson(state)));

    $('project-name').addEventListener('change', e => { const n = clone(state); n.name = e.target.value; commit(n); });
    $('kw').addEventListener('change', e => { const n = clone(state); n.keywords = Core.parseKeywords(e.target.value); commit(n, '关键词表已更新'); });
    [1, 2, 3].forEach(g => $('ev-' + g).addEventListener('change', e => { const n = clone(state); n.evidence[g] = e.target.value; commit(n); }));

    document.body.addEventListener('click', e => {
      const btn = e.target.closest('[data-act]');
      if (!btn || btn.disabled) return;
      const act = btn.dataset.act; const id = btn.dataset.id;
      if (act === 'sample') { loadSample(); return; }
      const f = state.features.find(x => x.id === id);
      if (!f) return;
      if (act === 'edit') startEdit(id);
      else if (act === 'delete') deleteFeature(id);
      else if (act === 'gate-prev') moveFeature(id, f.gate - 1, f.moscow, act);
      else if (act === 'gate-next') moveFeature(id, f.gate + 1, f.moscow, act);
      else if (act === 'lvl-up') moveFeature(id, f.gate, Core.MOSCOW[Core.MOSCOW.indexOf(f.moscow) - 1], act);
      else if (act === 'lvl-down') moveFeature(id, f.gate, Core.MOSCOW[Core.MOSCOW.indexOf(f.moscow) + 1], act);
    });
  }

  load();
  bind();
  renderDeps([]);
  formBaseline = formSnapshot();
  renderAll();
})();
