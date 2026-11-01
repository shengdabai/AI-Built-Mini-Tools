'use strict';
(function () {
  const C = globalThis.RubricCore;
  const KEY = 'rubricfb.v1';
  const TODAY = C.resolveToday(location.search);
  const TODAY_FIXED = (() => { try { return C.validDate(new URLSearchParams(location.search).get('today')); } catch (e) { return false; } })();
  const $ = id => document.getElementById(id);

  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(k => {
      const v = attrs[k];
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v === true) n.setAttribute(k, '');
      else if (v !== false && v != null) n.setAttribute(k, v);
    });
    kids.flat().forEach(c => { if (c != null) n.append(c); });
    return n;
  }
  const clear = n => { while (n.firstChild) n.removeChild(n.firstChild); };
  const clone = o => JSON.parse(JSON.stringify(o));
  const uid = p => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* ---------- 状态与存储 ---------- */
  function emptyState() { return { rubrics: [], records: [], templates: C.defaultTemplates() }; }
  const newGs = () => ({ grades: Object.create(null), quotes: Object.create(null), notes: Object.create(null) });
  let loadNote = '';
  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { loadNote = '浏览器不允许读取本地存储,本次数据不会被保留。'; return emptyState(); }
    if (!raw) return emptyState();
    try {
      const v = C.validateImport(JSON.parse(raw));
      if (v.ok) return { rubrics: v.data.rubrics, records: v.data.records, templates: v.data.templates || C.defaultTemplates() };
      loadNote = '本地数据格式不合法,已忽略(原因:' + v.errors[0] + ')。再次保存会覆盖它。';
    } catch (e) { loadNote = '本地数据无法解析,已忽略。再次保存会覆盖它。'; }
    return emptyState();
  }
  let state = load();

  const ui = {
    tab: 'grade', gradeSig: '', gs: newGs(),
    rid: null, draft: null, dirty: false, tplLang: 'zh', student: null, pendingRecord: null,
    tplDraft: { zh: null, en: null }, pendingTab: null, pendingImport: null
  };

  let toastTimer = null;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }
  function updateBadges() { $('sample-badge').hidden = !C.hasSample(state); }
  function save() {
    updateBadges();
    const check = C.validateImport(C.backup(state));
    if (!check.ok) {
      $('save-warn-text').textContent = '数据未通过校验,没有写入(' + check.errors[0] + ')。请先下载 JSON 备份。';
      $('save-warn').hidden = false;
      return false;
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(C.backup(state)));
      $('save-warn').hidden = true;
      return true;
    } catch (e) {
      $('save-warn-text').textContent = '浏览器拒绝写入本地存储(' + (e && e.name ? e.name : '未知错误') + '),刷新后本页的改动会丢失。';
      $('save-warn').hidden = false;
      return false;
    }
  }

  function download(name, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = h('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function safeName(s) { return String(s).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'file'; }
  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await Promise.race([navigator.clipboard.writeText(text), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1500))]);
        return true;
      }
    } catch (e) { /* 走回退方案 */ }
    const ta = h('textarea', { 'aria-hidden': 'true', class: 'offscreen' });
    ta.value = text; document.body.append(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }
  async function copyWithToast(text, label) {
    const ok = await copyText(text);
    toast(ok ? '已复制' + label + '。' : '浏览器不允许复制,请改用「下载 .md」。');
  }

  /* ---------- 标签页 ---------- */
  function tplDirtyLangs() { return ['zh', 'en'].filter(l => ui.tplDraft[l] && C.changedTemplateKeys(state.templates[l], ui.tplDraft[l]).length > 0); }
  function updateTplDirty() {
    const langs = tplDirtyLangs();
    const names = { zh: '中文', en: 'English' };
    $('t-dirty').textContent = langs.length ? '未保存：' + langs.map(l => names[l] + ' ' + C.changedTemplateKeys(state.templates[l], ui.tplDraft[l]).length + ' 项').join('、') : '';
    $('t-dirty').className = langs.length ? 'hint hint-warn' : 'hint';
  }
  function setTab(name, force) {
    if (!force && ui.tab === 'phrases' && name !== 'phrases' && tplDirtyLangs().length) {
      ui.pendingTab = name;
      $('t-leave-text').textContent = '措辞模板有未保存的修改（' + $('t-dirty').textContent.replace('未保存：', '') + '）。离开前要保存还是放弃？';
      $('t-leave').hidden = false;
      $('t-leave-stay').focus();
      return;
    }
    ui.tab = name;
    document.querySelectorAll('.tab').forEach(b => {
      const on = b.dataset.tab === name;
      b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.panel').forEach(p => { p.hidden = p.dataset.panel !== name; });
    renderTab();
  }
  function renderTab() {
    ({ grade: renderGrade, rubric: renderRubric, students: renderStudents, phrases: renderPhrases, data: renderData })[ui.tab]();
  }
  function renderAll() { renderTab(); }

  /* ---------- 批改 ---------- */
  const currentRubric = () => state.rubrics.find(r => r.id === $('g-rubric').value) || null;

  function renderGrade() {
    const has = state.rubrics.length > 0;
    $('g-empty').hidden = has; $('g-work').hidden = !has;
    if (!has) return;
    const sel = $('g-rubric'); const prev = sel.value;
    clear(sel);
    state.rubrics.forEach(r => sel.append(h('option', { value: r.id, text: r.name })));
    sel.value = state.rubrics.some(r => r.id === prev) ? prev : state.rubrics[0].id;
    const dl = $('g-students'); clear(dl);
    C.studentsOf(state.records).forEach(s => dl.append(h('option', { value: s.name })));
    if (!$('g-date').value) $('g-date').value = TODAY;
    const sig = JSON.stringify(currentRubric());
    if (sig !== ui.gradeSig) { ui.gradeSig = sig; ui.gs = newGs(); buildDims(); }
    updatePreview();
  }

  function buildDims() {
    const r = currentRubric(); const box = $('g-dims'); clear(box);
    if (!r) return;
    const T = state.templates.zh; const ws = C.weights(r);
    r.dims.forEach((d, i) => {
      const levels = h('div', { class: 'levels' });
      [1, 2, 3, 4].forEach(n => {
        const radio = h('input', { type: 'radio', name: 'lv-' + i, value: String(n) });
        radio.addEventListener('change', () => { ui.gs.grades[d.id] = n; updatePreview(); });
        levels.append(h('label', { class: 'level', 'data-level': String(n) }, radio,
          h('span', { class: 'level-head' }, h('b', { text: String(n) }), ' ', h('span', { text: T['levelName' + n] })),
          h('span', { class: 'level-desc', text: d.levels[n - 1].desc || '(未填写描述)' })));
      });
      const q = h('textarea', { rows: '2', maxlength: '600', 'aria-label': d.name + ' 原文引用', placeholder: '可选:粘贴学员原句' });
      q.addEventListener('input', () => { ui.gs.quotes[d.id] = q.value; updatePreview(); });
      const nt = h('input', { maxlength: '200', 'aria-label': d.name + ' 教师补充', placeholder: '可选:补充一句' });
      nt.addEventListener('input', () => { ui.gs.notes[d.id] = nt.value; updatePreview(); });
      box.append(h('fieldset', { class: 'dim' },
        h('legend', {}, h('span', { text: d.name }), h('span', { class: 'muted', text: '  权重 ' + ws[i] + '%' })),
        levels,
        h('div', { class: 'extras' },
          h('label', { class: 'field' }, h('span', { text: '原文引用(可选)' }), q),
          h('label', { class: 'field' }, h('span', { text: '教师补充(可选)' }), nt))));
    });
  }

  function gradeInput() {
    return {
      student: $('g-student').value, title: $('g-title').value, date: $('g-date').value, lang: $('g-lang').value,
      grades: ui.gs.grades, quotes: ui.gs.quotes, notes: ui.gs.notes
    };
  }
  /* 返回 {rec, missing[], ready}:预览、复制、下载、保存共用同一份判定 */
  function gradeState() {
    const r = currentRubric(); if (!r) return { rec: null, missing: ['量规'], ready: false, rubric: null };
    const inp = gradeInput();
    const rec = C.makeRecord(r, inp, 'draft');
    const missing = [];
    const ungraded = r.dims.filter(d => !ui.gs.grades[d.id]).length;
    if (ungraded) missing.push(ungraded + ' 个维度未选等级');
    if (!rec.student) missing.push('学员代号');
    if (!rec.title) missing.push('作业标题');
    if (!C.validDate(rec.date)) missing.push('有效日期');
    return { rec, missing, ready: missing.length === 0, rubric: r };
  }
  function updatePreview() {
    const g = gradeState();
    const pre = $('g-feedback');
    const scored = g.rec && g.rec.total != null;
    $('g-total').textContent = scored ? String(g.rec.total) : '-';
    const gr = $('g-grade'); gr.textContent = scored ? state.templates.zh['grade' + g.rec.levelCode] : '-';
    gr.dataset.grade = scored ? g.rec.levelCode : '';
    pre.textContent = scored ? C.feedback(g.rubric, g.rec, g.rec.lang, { templates: state.templates }) : '每个维度都选好等级后,这里会生成反馈。';
    $('g-status').textContent = g.ready ? '信息齐全,可以保存或复制。' : '还差:' + g.missing.join('、') + '。补齐前不能保存或导出。';
    ['g-save', 'g-copy-md', 'g-copy-txt', 'g-dl-md'].forEach(id => { $(id).disabled = !g.ready; });
  }
  function resetGradeForm() {
    ui.gs = newGs();
    $('g-title').value = ''; buildDims(); updatePreview();
  }
  function feedbackText(format) {
    const g = gradeState();
    return C.feedback(g.rubric, g.rec, g.rec.lang, { templates: state.templates, format });
  }

  /* ---------- 量规 ---------- */
  function selectRubric(id) {
    ui.rid = id; const r = state.rubrics.find(x => x.id === id);
    ui.draft = r ? clone(r) : null; ui.dirty = false;
  }
  function guardDirty() {
    if (!ui.dirty) return true;
    showErrors(['当前量规有未保存的修改。请先点「保存量规」或「放弃修改」。']);
    return false;
  }
  function showErrors(list) {
    const ul = $('r-errors'); clear(ul);
    list.forEach(e => ul.append(h('li', { text: e })));
    ul.hidden = list.length === 0;
  }
  function markDirty() {
    ui.dirty = true; $('r-dirty').textContent = '有未保存的修改'; $('r-discard').disabled = false; updateWeightsLine();
  }
  function updateWeightsLine() {
    const d = ui.draft; if (!d) return;
    const sum = d.dims.reduce((a, x) => a + (Number.isFinite(x.weight) ? x.weight : 0), 0);
    const ws = sum > 0 ? d.dims.map(x => (Number.isFinite(x.weight) ? Math.round(x.weight / sum * 1000) / 10 : 0)) : d.dims.map(() => 0);
    $('r-weights').textContent = '权重合计 ' + sum + (sum === 100 ? '。' : ',将按比例归一为 ' + ws.join('% / ') + '%。');
    document.querySelectorAll('[data-norm]').forEach(sp => { sp.textContent = '归一 ' + ws[Number(sp.dataset.norm)] + '%'; });
  }

  function renderRubric() {
    const sel = $('r-select'); clear(sel);
    state.rubrics.forEach(r => sel.append(h('option', { value: r.id, text: r.name })));
    const none = state.rubrics.length === 0;
    $('r-empty').hidden = !none; $('r-editor').hidden = none;
    $('r-copy').disabled = none; $('r-delete').disabled = none; $('r-confirm').hidden = true;
    if (none) { showErrors([]); return; }
    if (!state.rubrics.some(r => r.id === ui.rid)) selectRubric(state.rubrics[0].id);
    sel.value = ui.rid;
    if (!ui.dirty) ui.draft = clone(state.rubrics.find(r => r.id === ui.rid));
    $('r-name').value = ui.draft.name;
    $('r-dirty').textContent = ui.dirty ? '有未保存的修改' : '';
    $('r-discard').disabled = !ui.dirty;
    showErrors([]);
    renderDraftDims();
    updateWeightsLine();
  }

  function renderDraftDims() {
    const box = $('r-dims'); clear(box);
    ui.draft.dims.forEach((d, i) => {
      const name = h('input', { value: d.name, maxlength: '40', 'aria-label': '维度名称' });
      name.addEventListener('input', () => { d.name = name.value; markDirty(); });
      const w = h('input', { type: 'number', min: '0', step: 'any', value: String(d.weight), 'aria-label': d.name + ' 权重' });
      w.addEventListener('input', () => { d.weight = w.value === '' ? NaN : Number(w.value); markDirty(); });
      const rm = h('button', { type: 'button', class: 'btn btn-danger', text: '删除此维度', disabled: ui.draft.dims.length <= 1 });
      rm.addEventListener('click', () => { ui.draft.dims.splice(i, 1); markDirty(); renderDraftDims(); updateWeightsLine(); });
      const lv = h('div', { class: 'lv-edit' });
      d.levels.forEach((l, k) => {
        const desc = h('textarea', { rows: '2', maxlength: '500', 'aria-label': d.name + ' 等级 ' + (k + 1) + ' 描述' }); desc.value = l.desc;
        desc.addEventListener('input', () => { l.desc = desc.value; markDirty(); });
        const fb = h('textarea', { rows: '2', maxlength: '500', 'aria-label': d.name + ' 等级 ' + (k + 1) + ' 反馈模板' }); fb.value = l.fb;
        fb.addEventListener('input', () => { l.fb = fb.value; markDirty(); });
        lv.append(h('div', { class: 'lv-cell', 'data-level': String(k + 1) },
          h('b', { text: '等级 ' + (k + 1) }),
          h('label', { class: 'field' }, h('span', { text: '描述' }), desc),
          h('label', { class: 'field' }, h('span', { text: '一句话反馈模板' }), fb)));
      });
      box.append(h('div', { class: 'dim' },
        h('div', { class: 'dim-head' },
          h('label', { class: 'field' }, h('span', { text: '维度名称' }), name),
          h('label', { class: 'field field-narrow' }, h('span', { text: '权重' }), w),
          h('span', { class: 'muted', 'data-norm': String(i) }), rm),
        lv));
    });
  }

  /* ---------- 学员 ---------- */
  function renderStudents() {
    const list = $('s-list'); clear(list);
    const ss = C.studentsOf(state.records);
    $('s-empty').hidden = ss.length > 0; $('s-detail').hidden = ss.length === 0;
    if (!ss.length) return;
    if (!ss.some(s => s.name === ui.student)) ui.student = ss[0].name;
    ss.forEach(s => {
      const b = h('button', { type: 'button', class: 'student-btn' + (s.name === ui.student ? ' is-active' : ''), text: s.name + '(' + s.count + ' 次)' });
      b.addEventListener('click', () => { ui.student = s.name; ui.pendingRecord = null; renderStudents(); });
      list.append(h('li', {}, b));
    });
    $('s-name').textContent = ui.student;
    $('s-confirm').hidden = ui.pendingRecord == null;
    $('s-view').hidden = true;
    buildTrend(C.trend(state.records, ui.student));
    buildRecordList();
  }

  function buildTrend(t) {
    const tb = $('s-table'); clear(tb);
    const head = h('tr', {}, h('th', { scope: 'col', text: '日期' }), h('th', { scope: 'col', text: '作业' }),
      t.dims.map(n => h('th', { scope: 'col', text: n })), h('th', { scope: 'col', text: '总分' }));
    tb.append(h('thead', {}, head));
    const body = h('tbody');
    t.rows.forEach(r => {
      const tr = h('tr', {}, h('td', { text: r.date }), h('td', { text: r.title }));
      r.cells.forEach(v => {
        if (v == null) { tr.append(h('td', { text: '-' })); return; }
        const bar = h('span', { class: 'bar', 'data-level': String(v) }, h('i'));
        bar.firstChild.style.setProperty('--w', v * 25 + '%');
        tr.append(h('td', {}, h('span', { class: 'badge', 'data-level': String(v), text: String(v) }), bar));
      });
      const tot = h('span', { class: 'bar bar-total', 'data-grade': r.levelCode }, h('i'));
      tot.firstChild.style.setProperty('--w', r.total + '%');
      tr.append(h('td', {}, h('b', { text: String(r.total) }), ' ', h('span', { class: 'muted', text: state.templates.zh['grade' + r.levelCode] }), tot));
      body.append(tr);
    });
    tb.append(body);
    const foot = h('tr', {}, h('th', { scope: 'row', colspan: '2', text: '变化(最近-最早)' }),
      t.change.map(c => h('td', { class: c == null ? '' : c > 0 ? 'up' : c < 0 ? 'down' : '', text: c == null ? '-' : (c > 0 ? '+' : '') + c })), h('td'));
    tb.append(h('tfoot', {}, foot));
  }

  function buildRecordList() {
    const ul = $('s-records'); clear(ul);
    const mine = state.records.filter(r => r.student === ui.student).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    mine.forEach(r => {
      const v = h('button', { type: 'button', class: 'btn', text: '查看反馈' });
      v.addEventListener('click', () => {
        $('s-view-title').textContent = r.date + ' ' + r.title;
        $('s-view-text').textContent = C.feedback(r.rubric, r, r.lang, { templates: state.templates });
        $('s-view').hidden = false; $('s-confirm').hidden = true; ui.pendingRecord = null;
        $('s-view-copy').onclick = () => copyWithToast($('s-view-text').textContent, ' Markdown');
        $('s-view').scrollIntoView({ block: 'nearest' });
      });
      const d = h('button', { type: 'button', class: 'btn btn-danger', text: '删除' });
      d.addEventListener('click', () => {
        ui.pendingRecord = r.id; $('s-view').hidden = true;
        $('s-confirm-text').textContent = '删除 ' + r.date + '「' + r.title + '」这条记录?不可恢复。';
        $('s-confirm').hidden = false;
      });
      ul.append(h('li', { class: 'record' },
        h('span', { class: 'record-main' }, h('b', { text: r.date }), ' ', h('span', { text: r.title }), ' ',
          h('span', { class: 'muted', text: r.total + ' 分 · ' + r.rubric.name })),
        h('span', { class: 'row' }, v, d)));
    });
  }

  /* ---------- 措辞模板 ---------- */
  const LABELS = {
    greeting: '称呼', titleLine: '作业标题行', scoreLabel: '总分标签', overallA: '总评 A(≥85)', overallB: '总评 B(70–84.9)',
    overallC: '总评 C(55–69.9)', overallD: '总评 D(<55)', dimTitle: '维度标题行', quoteLabel: '原句引导语', noteLabel: '教师补充引导语',
    nextTitle: '「下次重点」标题', nextItem: '下次重点每条', closing: '结束语',
    gradeA: '等级名 A', gradeB: '等级名 B', gradeC: '等级名 C', gradeD: '等级名 D',
    levelName1: '等级 1 名称', levelName2: '等级 2 名称', levelName3: '等级 3 名称', levelName4: '等级 4 名称'
  };
  function renderPhrases() {
    const box = $('t-fields'); clear(box);
    const T = ui.tplDraft[ui.tplLang] || state.templates[ui.tplLang];
    $('t-lang').value = ui.tplLang;
    $('t-leave').hidden = true;
    C.TEMPLATE_KEYS.forEach(k => {
      const long = /^(overall|closing)/.test(k);
      const inp = long ? h('textarea', { rows: '2', maxlength: '400', 'data-key': k }) : h('input', { maxlength: '400', 'data-key': k });
      inp.value = T[k];
      inp.addEventListener('input', () => {
        if (!ui.tplDraft[ui.tplLang]) ui.tplDraft[ui.tplLang] = clone(state.templates[ui.tplLang]);
        ui.tplDraft[ui.tplLang][k] = inp.value;
        updateTplDirty();
      });
      box.append(h('label', { class: 'field' + (long ? ' field-full' : '') }, h('span', { text: LABELS[k] }), inp));
    });
    updateTplDirty();
  }

  /* ---------- 数据 ---------- */
  function renderData() { $('d-confirm').hidden = true; }

  function mergeImport(data) {
    let added = 0; let replaced = 0;
    data.rubrics.forEach(r => { const i = state.rubrics.findIndex(x => x.id === r.id); if (i >= 0) { state.rubrics[i] = r; replaced++; } else { state.rubrics.push(r); added++; } });
    data.records.forEach(r => { const i = state.records.findIndex(x => x.id === r.id); if (i >= 0) { state.records[i] = r; replaced++; } else { state.records.push(r); added++; } });
    if (data.templates) state.templates = data.templates;
    return { added, replaced };
  }

  function sampleItems() {
    const S = globalThis.RUBRIC_SAMPLE;
    const r = clone(S.rubric);
    return { r, recs: S.gradings.map((g, n) => C.makeRecord(r, g, 'sample-rec-' + (n + 1))) };
  }
  function requestSample() {
    const { r, recs } = sampleItems();
    const c = C.overwriteConflicts(state, [r], recs);
    if (c.length === 0) { loadSample(); return; }
    $('sample-confirm-text').textContent = '示例会覆盖你已修改过的同名内容:' + c.join('、') + '。覆盖后这些修改无法恢复,建议先下载备份。';
    $('sample-confirm').hidden = false;
  }
  function loadSample() {
    $('sample-confirm').hidden = true;
    const S = globalThis.RUBRIC_SAMPLE;
    const r = clone(S.rubric);
    const i = state.rubrics.findIndex(x => x.id === r.id);
    if (i >= 0) state.rubrics[i] = r; else state.rubrics.push(r);
    S.gradings.forEach((g, n) => {
      const rec = C.makeRecord(r, g, 'sample-rec-' + (n + 1));
      const j = state.records.findIndex(x => x.id === rec.id);
      if (j >= 0) state.records[j] = rec; else state.records.push(rec);
    });
    ui.gradeSig = ''; ui.dirty = false; ui.rid = r.id;
    const ok = save();
    setTab('grade');
    $('g-rubric').value = r.id;
    if (ok) toast('已载入合成示例:1 套量规、6 条记录。');
  }

  /* ---------- 事件 ---------- */
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('load-sample').addEventListener('click', requestSample);
  document.querySelector('[data-act="sample"]').addEventListener('click', requestSample);
  $('sample-confirm-yes').addEventListener('click', loadSample);
  $('sample-confirm-no').addEventListener('click', () => { $('sample-confirm').hidden = true; });
  document.querySelector('[data-act="goto-rubric"]').addEventListener('click', () => setTab('rubric'));

  $('g-rubric').addEventListener('change', () => { ui.gradeSig = ''; renderGrade(); });
  ['g-student', 'g-title', 'g-date', 'g-lang'].forEach(id => {
    $(id).addEventListener('input', updatePreview); $(id).addEventListener('change', updatePreview);
  });
  /* 保存按钮是关联表单的提交按钮:点击和输入框里按 Enter 走同一套校验与保存 */
  ['g-student', 'g-title', 'g-date'].forEach(id => $(id).addEventListener('keydown', e => {
    if (e.key === 'Enter' && $('g-save').disabled) { e.preventDefault(); $('g-form').requestSubmit(); }
  }));
  $('g-form').addEventListener('submit', e => {
    e.preventDefault();
    const g = gradeState();
    if (!g.ready) {
      $('g-status').textContent = '还差：' + g.missing.join('、') + '。补齐前不能保存。';
      const firstEmpty = !$('g-student').value.trim() ? $('g-student') : !$('g-title').value.trim() ? $('g-title') : !C.validDate($('g-date').value) ? $('g-date') : null;
      if (firstEmpty) firstEmpty.focus();
      return;
    }
    const rec = C.makeRecord(g.rubric, gradeInput(), uid('rec'));
    const rv = C.validateRecord(rec);
    if (!rv.ok) { toast('这条记录不合法,未保存:' + rv.errors[0]); return; }
    state.records.push(rec);
    const ok = save();
    resetGradeForm();
    renderGrade();
    if (ok) toast('已保存 ' + rec.student + ' 的批改记录(' + rec.total + ' 分)。');
  });
  $('g-copy-md').addEventListener('click', () => { if (gradeState().ready) copyWithToast(feedbackText('md'), ' Markdown'); });
  $('g-copy-txt').addEventListener('click', () => { if (gradeState().ready) copyWithToast(feedbackText('text'), '纯文本'); });
  $('g-dl-md').addEventListener('click', () => {
    const g = gradeState(); if (!g.ready) return;
    download('反馈-' + safeName(g.rec.student) + '-' + safeName(g.rec.title) + '.md', feedbackText('md'), 'text/markdown;charset=utf-8');
  });

  $('r-select').addEventListener('change', () => {
    if (!guardDirty()) { $('r-select').value = ui.rid; return; }
    selectRubric($('r-select').value); renderRubric();
  });
  $('r-name').addEventListener('input', () => { ui.draft.name = $('r-name').value; markDirty(); });
  $('r-add-dim').addEventListener('click', () => {
    const n = ui.draft.dims.length + 1;
    ui.draft.dims.push({ id: uid('d'), name: '维度 ' + n, weight: 10, levels: [1, 2, 3, 4].map(() => ({ desc: '', fb: '' })) });
    markDirty(); renderDraftDims(); updateWeightsLine();
  });
  $('r-save').addEventListener('click', () => {
    ui.draft.name = ui.draft.name.trim(); ui.draft.dims.forEach(d => { d.name = d.name.trim(); });
    const v = C.validateRubric(ui.draft);
    if (!v.ok) { showErrors(v.errors); return; }
    const i = state.rubrics.findIndex(r => r.id === ui.rid);
    state.rubrics[i] = clone(ui.draft); ui.dirty = false;
    const ok = save(); renderRubric();
    if (ok) toast('量规已保存。');
  });
  $('r-discard').addEventListener('click', () => { ui.dirty = false; selectRubric(ui.rid); renderRubric(); });
  $('r-new').addEventListener('click', () => {
    if (!guardDirty()) return;
    const r = C.newRubric(uid('rubric'), '新量规 ' + (state.rubrics.length + 1));
    state.rubrics.push(r); const ok = save(); selectRubric(r.id); renderRubric();
    if (ok) toast('已新建量规,请填写维度与等级描述。');
  });
  $('r-copy').addEventListener('click', () => {
    if (!guardDirty()) return;
    const r = clone(state.rubrics.find(x => x.id === ui.rid)); r.id = uid('rubric'); r.name = C.copyName(r.name);
    state.rubrics.push(r); const ok = save(); selectRubric(r.id); renderRubric();
    if (ok) toast('已复制量规。');
  });
  $('r-delete').addEventListener('click', () => {
    if (!guardDirty()) return;
    $('r-confirm-text').textContent = '删除量规「' + state.rubrics.find(r => r.id === ui.rid).name + '」?已保存的批改记录会保留(记录里存有量规快照)。';
    $('r-confirm').hidden = false;
  });
  $('r-confirm-no').addEventListener('click', () => { $('r-confirm').hidden = true; });
  $('r-confirm-yes').addEventListener('click', () => {
    state.rubrics = state.rubrics.filter(r => r.id !== ui.rid); ui.rid = null; ui.dirty = false;
    const ok = save(); renderRubric(); if (ok) toast('量规已删除。');
  });

  const isSampleRec = r => /^sample-rec-/.test(String(r.id));
  $('s-csv').addEventListener('click', () => {
    const mine = state.records.filter(r => r.student === ui.student);
    const smp = mine.some(isSampleRec);
    download('学员-' + safeName(ui.student) + (smp ? '-含合成示例' : '') + '.csv', '\uFEFF' + C.toCsv(state.records, ui.student) + (smp ? '\r\n含合成示例数据,不是真实学员' : ''), 'text/csv;charset=utf-8');
  });
  $('s-view-close').addEventListener('click', () => { $('s-view').hidden = true; });
  $('s-confirm-no').addEventListener('click', () => { ui.pendingRecord = null; $('s-confirm').hidden = true; });
  $('s-confirm-yes').addEventListener('click', () => {
    state.records = state.records.filter(r => r.id !== ui.pendingRecord); ui.pendingRecord = null;
    const ok = save(); renderStudents(); if (ok) toast('记录已删除。');
    const nb = document.querySelector('#s-records .btn-danger') || document.querySelector('.student-btn.is-active'); if (nb) nb.focus();
  });

  $('t-lang').addEventListener('change', () => { ui.tplLang = $('t-lang').value; renderPhrases(); });
  /* 保存全部语言里有修改的草稿;失败时保留草稿并提示 */
  function saveTemplates() {
    const next = clone(state.templates);
    tplDirtyLangs().forEach(l => { next[l] = clone(ui.tplDraft[l]); });
    const v = C.validateTemplates(next);
    if (!v.ok) { toast('模板不合法,没有保存:' + v.errors[0]); return false; }
    state.templates = next; ui.tplDraft = { zh: null, en: null };
    const ok = save(); updateTplDirty(); if (ok) toast('措辞模板已保存。');
    return true;
  }
  $('t-save').addEventListener('click', saveTemplates);
  $('t-reset').addEventListener('click', () => {
    ui.tplDraft[ui.tplLang] = null;
    state.templates[ui.tplLang] = C.defaultTemplates()[ui.tplLang];
    const ok = save(); renderPhrases(); if (ok) toast('已恢复默认模板。');
  });
  $('t-leave-stay').addEventListener('click', () => { ui.pendingTab = null; $('t-leave').hidden = true; });
  $('t-leave-save').addEventListener('click', () => { if (saveTemplates()) { const t = ui.pendingTab; ui.pendingTab = null; $('t-leave').hidden = true; setTab(t, true); } });
  $('t-leave-discard').addEventListener('click', () => { ui.tplDraft = { zh: null, en: null }; const t = ui.pendingTab; ui.pendingTab = null; $('t-leave').hidden = true; setTab(t, true); });

  $('d-backup').addEventListener('click', () => download('作业量规反馈-备份-' + (C.hasSample(state) ? '含合成示例-' : '') + TODAY + '.json', JSON.stringify(C.backup(state), null, 2), 'application/json'));
  $('d-csv').addEventListener('click', () => download('全部记录-' + (state.records.some(isSampleRec) ? '含合成示例-' : '') + TODAY + '.csv', '\uFEFF' + C.toCsv(state.records) + (state.records.some(isSampleRec) ? '\r\n含合成示例数据,不是真实学员' : ''), 'text/csv;charset=utf-8'));
  $('d-file').addEventListener('change', async () => {
    const f = $('d-file').files[0]; const out = $('d-result'); clear(out);
    ui.pendingImport = null; $('d-import-confirm').hidden = true;
    if (!f) return;
    let json;
    try { json = JSON.parse(await f.text()); } catch (e) { out.append(h('p', { class: 'err', text: '导入失败:文件不是有效的 JSON。' })); $('d-file').value = ''; return; }
    const v = C.validateImport(json);
    if (!v.ok) {
      out.append(h('p', { class: 'err', text: '整份拒绝导入,原因:' }), h('ul', { class: 'errors' }, v.errors.slice(0, 8).map(e => h('li', { text: e }))));
      if (v.errors.length > 8) out.append(h('p', { text: '另有 ' + (v.errors.length - 8) + ' 条问题未列出。' }));
      $('d-file').value = ''; return;
    }
    /* 校验通过 → 预览数量 → 确认 → 写入 */
    ui.pendingImport = v.data;
    $('d-import-text').textContent = '备份文件校验通过。确认后将按 id 合并：' + C.importPlan(state, v.data).text + '确认前现有数据不变。';
    $('d-import-confirm').hidden = false;
    $('d-import-no').focus();
    $('d-file').value = '';
  });
  $('d-import-no').addEventListener('click', () => { ui.pendingImport = null; $('d-import-confirm').hidden = true; });
  $('d-import-yes').addEventListener('click', () => {
    const data = ui.pendingImport; const out = $('d-result'); clear(out);
    ui.pendingImport = null; $('d-import-confirm').hidden = true;
    if (!data) return;
    const m = mergeImport(data); ui.gradeSig = '';
    const ok = save();
    out.append(h('p', { text: '导入成功:新增 ' + m.added + ' 项,替换 ' + m.replaced + ' 项。' + (ok ? '' : '但写入本地存储失败,请先导出 JSON 备份。') }));
  });
  $('top-import').addEventListener('click', () => { setTab('data'); if (ui.tab === 'data') $('d-file').click(); });
  $('d-clear').addEventListener('click', () => { $('d-confirm').hidden = false; });
  $('d-confirm-no').addEventListener('click', () => { $('d-confirm').hidden = true; });
  $('d-confirm-yes').addEventListener('click', () => {
    state = emptyState(); ui.gradeSig = ''; ui.rid = null; ui.dirty = false; ui.student = null;
    let removed = true;
    try { localStorage.removeItem(KEY); } catch (e) { removed = false; }
    $('d-confirm').hidden = true; clear($('d-result')); ui.tplDraft = { zh: null, en: null }; updateBadges();
    if (removed) { $('save-warn').hidden = true; toast('已清空全部数据。'); }
    else save();
  });

  $('g-rule').textContent = '计算口径：' + C.scoringRule().text;
  $('g-base').textContent = TODAY_FIXED ? '基准日 ' + TODAY + '（由地址参数固定），日期默认取这一天。' : '日期默认取今天（' + TODAY + '）。';
  updateBadges();
  if (loadNote) { $('save-warn-text').textContent = loadNote; $('save-warn').hidden = false; }
  $('g-date').value = TODAY;
  renderAll();
})();
