'use strict';
(function () {
  const C = globalThis.JtbdCore;
  const KEY = 'jtbd.v1';
  const $ = id => document.getElementById(id);
  const clone = o => JSON.parse(JSON.stringify(o));
  const today = () => C.resolveToday(location.search, new Date());

  // 用户输入一律走 textContent / value,不拼接 innerHTML
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k.startsWith('aria-') || k.startsWith('data-')) el.setAttribute(k, v === true ? '' : v);
      else if (k in el) el[k] = v;
      else el.setAttribute(k, v);
    }
    const add = list => { for (const c of list) { if (c == null || c === false) continue; if (Array.isArray(c)) add(c); else el.append(c.nodeType ? c : document.createTextNode(String(c))); } };
    add(kids);
    return el;
  }

  const KIND = {
    push: { title: '推力', hint: '现状让你不满的地方', add: '添加推力', evidence: true },
    pull: { title: '拉力', hint: '新方案吸引你的地方', add: '添加拉力', evidence: true },
    inertia: { title: '惯性', hint: '现状的习惯、懒得改的理由', add: '添加惯性', evidence: false },
    anxiety: { title: '焦虑', hint: '对新方案的担心', add: '添加焦虑', evidence: false }
  };

  let state = { version: 1, jobs: [], currentId: null };
  let tab = 'statement';
  let pending = null;
  let rawRejected = null;
  const openEvidence = new Set();
  const evidenceMsg = new Map();

  const job = () => state.jobs.find(j => j.id === state.currentId) || null;

  // ---------- 存储 ----------
  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { return; }
    if (!raw) return;
    let parsed = null, reason = '内容不是合法 JSON';
    try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
    if (parsed !== null) {
      const v = C.validateState(parsed);
      if (v.ok) { state = { version: 1, jobs: v.jobs, currentId: v.currentId }; if (!job() && state.jobs.length) state.currentId = state.jobs[0].id; return; }
      reason = v.errors.slice(0, 3).join(';');
    }
    rawRejected = raw;
    $('load-banner-text').textContent = `原因:${reason}。下次保存前会先把这份原始数据另存一份,你也可以现在下载。`;
    $('load-banner').hidden = false;
  }
  // 返回是否真正写入;保存前与读取后用同一个 validateState
  function save() {
    const v = C.validateState(state);
    if (!v.ok) {
      showSaveFailure('内部数据没通过校验:' + v.errors[0] + '。这次改动没有写入。');
      return false;
    }
    try {
      if (rawRejected !== null) { localStorage.setItem(KEY + '.rejected', rawRejected); rawRejected = null; $('load-banner').hidden = true; }
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      showSaveFailure('浏览器存储写入失败(可能已满或被禁用)。改动只在这个页面里,刷新会丢失,请先导出备份。');
      return false;
    }
    $('save-banner').hidden = true;
    $('save-status').textContent = ' · 已保存到本机浏览器';
    return true;
  }
  function showSaveFailure(msg) {
    $('save-banner-text').textContent = msg;
    $('save-banner').hidden = false;
    $('save-status').textContent = ' · 未保存';
  }
  function download(name, text, type) {
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: type || 'text/plain;charset=utf-8' })), download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const jsonText = () => C.exportJson(state);
  const stamp = () => today();

  // ---------- 页内确认 ----------
  let returnFocus = null, fallbackSel = '';
  function ask(message, run, fallback) {
    pending = run;
    returnFocus = document.activeElement; fallbackSel = fallback || '';
    $('confirm-text').textContent = message;
    $('confirm').hidden = false;
    $('confirm-no').focus();
    $('confirm').scrollIntoView({ block: 'nearest' });
  }
  function closeConfirm(restore) {
    pending = null; $('confirm').hidden = true;
    if (restore === 'cancel' && returnFocus && returnFocus.isConnected) returnFocus.focus();
  }
  // 确认并执行后:原按钮若已被删除,把焦点放到相邻位置
  function settleFocus() {
    if (returnFocus && returnFocus.isConnected) { returnFocus.focus(); return; }
    const t = fallbackSel ? document.querySelector(fallbackSel) : null;
    if (t) t.focus();
  }

  // ---------- 渲染 ----------
  function renderAll() {
    const has = state.jobs.length > 0;
    $('empty').hidden = has;
    $('work').hidden = !has;
    if (!has) return;
    renderJobBar(); renderFields(); renderForces(); renderAlts(); renderTabs(); renderLive(); renderCompare();
  }
  function renderJobBar() {
    const sel = $('job-select');
    sel.replaceChildren(...state.jobs.map(j => h('option', { value: j.id, selected: j.id === state.currentId, text: j.title || '未命名任务' })));
    $('job-title').value = job().title;
  }
  const FIELDS = { 'f-situation': 'situation', 'f-motivation': 'motivation', 'f-outcome': 'outcome', 'f-user': 'user', 'f-buyer': 'buyer', 'f-trigger': 'trigger', 'f-success': 'success' };
  function renderFields() {
    const j = job();
    for (const [id, key] of Object.entries(FIELDS)) $(id).value = j[key];
    $('f-words').value = j.words.join('、');
  }
  function renderTabs() {
    for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    for (const t of ['statement', 'compare', 'export']) $('tab-' + t).hidden = t !== tab;
  }

  function renderForces() {
    for (const kind of C.FORCE_KINDS) renderForce(kind);
  }
  function renderForce(kind) {
    const j = job(), k = KIND[kind], items = j.forces[kind];
    const box = $('force-' + kind);
    box.replaceChildren(
      h('div', { class: 'force-head' }, h('h4', { text: `${k.title}(${items.length})` }), h('span', { class: 'muted', text: k.hint })),
      ...items.map(it => forceItem(kind, it)),
      h('button', { type: 'button', text: k.add, onclick: () => addForce(kind) })
    );
  }
  function forceItem(kind, it) {
    const k = KIND[kind];
    const open = openEvidence.has(it.id);
    const head = [
      h('textarea', { rows: 2, value: it.text, 'aria-label': k.title + '内容', 'data-item': it.id, placeholder: '写一条具体的、能想起某次真实情况的描述',
        oninput: e => { it.text = e.target.value; save(); renderLive(); } })
    ];
    const tools = [];
    if (k.evidence) {
      const n = it.evidence.length;
      tools.push(h('span', { class: 'tag ' + (n ? 'tag-ok' : 'tag-assume'), text: n ? `证据 ${n} 条` : '假设' }));
      tools.push(h('button', { type: 'button', class: 'small', 'aria-expanded': String(open), text: open ? '收起证据' : '挂证据',
        onclick: () => { if (open) openEvidence.delete(it.id); else openEvidence.add(it.id); renderForce(kind); } }));
    }
    tools.push(h('button', { type: 'button', class: 'small danger', text: '删除', 'aria-label': `删除这条${k.title}`, onclick: () => removeForce(kind, it.id) }));
    return h('div', { class: 'item' }, head, h('div', { class: 'item-tools' }, tools), open ? evidencePanel(kind, it) : null);
  }
  function evidencePanel(kind, it) {
    const typeSel = h('select', { 'aria-label': '证据类型' }, ...Object.entries(C.EVIDENCE_TYPES).map(([v, t]) => h('option', { value: v, text: t })));
    const text = h('textarea', { rows: 2, 'aria-label': '证据内容', placeholder: '证据:对方说了什么、看到了什么数据' });
    const source = h('input', { type: 'text', 'aria-label': '来源', placeholder: '来源:谁、哪个帖子、哪份数据(链接只接受 http/https)' });
    const date = h('input', { type: 'date', 'aria-label': '日期', value: today() });
    const msg = h('p', { class: 'field-msg', role: 'status', text: evidenceMsg.get(it.id) || '' });
    return h('div', { class: 'evidence' },
      ...it.evidence.map(e => h('div', { class: 'ev-row' },
        h('div', {}, h('strong', { text: C.EVIDENCE_TYPES[e.type] }), ' ', h('span', { class: 'muted', text: [e.date, e.source].filter(Boolean).join(' · ') }), h('div', { text: e.text })),
        h('button', { type: 'button', class: 'small danger', text: '删除证据', onclick: () => ask(`删除这条${C.EVIDENCE_TYPES[e.type]}证据「${e.text.trim().slice(0, 40)}${e.text.trim().length > 40 ? '…' : ''}」?此操作不能撤销;确认前数据不变。`, () => { it.evidence = it.evidence.filter(x => x.id !== e.id); save(); renderForce(kind); renderLive(); settleFocus(); }, `[data-item="${CSS.escape(it.id)}"]`) }))),
      h('div', { class: 'ev-form' }, typeSel, date, text, source,
        h('button', { type: 'button', text: '添加这条证据', onclick: () => {
          if (!text.value.trim()) { evidenceMsg.set(it.id, '证据内容不能为空'); msg.textContent = '证据内容不能为空'; return; }
          const ev = { id: C.newId('e'), type: typeSel.value, text: text.value, source: source.value, date: date.value };
          it.evidence.push(ev);
          const v = C.validateState(state);
          if (!v.ok) { it.evidence.pop(); const m = v.errors[0]; evidenceMsg.set(it.id, m); msg.textContent = m; return; }
          evidenceMsg.delete(it.id); save(); renderForce(kind); renderLive();
        } })),
      msg);
  }
  function addForce(kind) {
    const it = { id: C.newId('f'), text: '', evidence: [] };
    job().forces[kind].push(it);
    save(); renderForce(kind); renderLive();
    const ta = document.querySelector(`[data-item="${CSS.escape(it.id)}"]`); if (ta) ta.focus();
  }
  function removeForce(kind, id) {
    const j = job();
    const imp = C.forceRemovalImpact(j, id);
    const doRemove = () => {
      j.forces[kind] = j.forces[kind].filter(x => x.id !== id);
      for (const c of j.candidates) { c.solves = c.solves.filter(x => x !== id); c.eases = c.eases.filter(x => x !== id); }
      openEvidence.delete(id);
      save(); renderForce(kind); renderLive(); renderCompare();
    };
    if (!imp || (imp.text.trim() === '' && imp.evidence === 0 && imp.candidates === 0)) { doRemove(); return; }
    const label = KIND[kind].title;
    const shown = imp.text.trim() ? `「${imp.text.trim().slice(0, 40)}${imp.text.trim().length > 40 ? '…' : ''}」` : '(空白内容)';
    ask(`删除这条${label}${shown}?会一并删除它的 ${imp.evidence} 条证据,并从 ${imp.candidates} 个候选方案的勾选里摘掉它。此操作不能撤销;确认前数据不变。`, () => { doRemove(); settleFocus(); }, `#force-${kind} > button`);
  }

  function renderAlts() {
    const j = job();
    $('alt-list').replaceChildren(...(j.alternatives.length ? j.alternatives.map(a => h('div', { class: 'alt' },
      ...[['name', '名称'], ['cost', '费用'], ['time', '耗时'], ['pain', '不满点']].map(([f, label]) =>
        h('label', {}, label, h('input', { type: 'text', value: a[f], 'data-alt': a.id + f, oninput: e => { a[f] = e.target.value; save(); renderLive(); } }))),
      h('button', { type: 'button', class: 'small danger', text: '删除', 'aria-label': '删除这条替代方案', onclick: () => {
        const rm = () => { j.alternatives = j.alternatives.filter(x => x.id !== a.id); save(); renderAlts(); renderLive(); };
        if (!(a.name + a.cost + a.time + a.pain).trim()) { rm(); return; }
        ask(`删除替代方案「${(a.name || '未命名').trim().slice(0, 40)}」(费用:${a.cost || '空'},耗时:${a.time || '空'},不满点:${(a.pain || '空').slice(0, 30)})?此操作不能撤销;确认前数据不变。`, () => { rm(); settleFocus(); }, '#add-alt');
      } })
    )) : [h('p', { class: 'muted', text: '还没有替代方案。' })]));
  }

  function renderLive() {
    const j = job(); if (!j) return;
    const { issues } = C.validateJob(j);
    const LV = { block: '阻断', warn: '警告', hint: '提示' };
    $('issues').replaceChildren(...(issues.length ? issues.map(i => h('li', { class: 'issue issue-' + i.level }, h('strong', { text: LV[i.level] }), ' ', i.message)) : [h('li', { class: 'issue issue-ok', text: '没有规则问题' })]));
    const b = C.forceBalance(j), tot = Math.max(b.drive, b.resist, 1);
    const bar = (label, n, cls) => h('div', { class: 'bar-row' }, h('span', { text: `${label} ${n} 条` }), h('div', { class: 'bar' }, h('div', { class: 'bar-fill ' + cls, style: `--w:${(n / tot) * 100}%` })));
    $('balance').replaceChildren(bar('动力(推力+拉力)', b.drive, 'fill-drive'), bar('阻力(惯性+焦虑)', b.resist, 'fill-resist'));
    const s = C.evidenceStats(j);
    $('stats').replaceChildren(...(s.total === 0 ? [h('p', { text: '还没有推力或拉力条目。' })] : [
      h('p', {}, `推力/拉力共 ${s.total} 条;`, h('strong', { text: `假设 ${s.assumptions} 条(${Math.round(s.ratio * 100)}%)` }), `,有证据 ${s.withEvidence} 条。`),
      h('p', { class: 'muted', text: `其中只有「自己猜」证据的 ${s.guessOnly} 条。` })
    ]));
    renderMatrix(); renderCounts(); renderExport();
  }

  // ---------- 候选对比 ----------
  function renderCompare() {
    const j = job(); if (!j) return;
    const drive = [...j.forces.push, ...j.forces.pull].filter(x => x.text.trim());
    const anx = j.forces.anxiety.filter(x => x.text.trim());
    const group = (c, key, title, list, kindLabel) => h('fieldset', {}, h('legend', { text: title }),
      ...(list.length ? list.map(it => h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: c[key].includes(it.id), onchange: e => {
          c[key] = e.target.checked ? c[key].concat(it.id) : c[key].filter(x => x !== it.id);
          save(); renderLive();
        } }), h('span', {}, h('span', { class: 'muted', text: kindLabel(it) + ' ' }), it.text))) : [h('p', { class: 'muted', text: key === 'solves' ? '先在「陈述与四力」里写推力或拉力。' : '先写焦虑。' })]));
    $('candidate-list').replaceChildren(...(j.candidates.length ? j.candidates.map(c => h('div', { class: 'cand' },
      h('div', { class: 'cand-head' },
        h('input', { type: 'text', value: c.name, placeholder: '候选方案名称', 'aria-label': '候选方案名称', oninput: e => { c.name = e.target.value; save(); renderLive(); } }),
        h('span', { class: 'cand-count', 'data-cand': c.id }),
        h('button', { type: 'button', class: 'small danger', text: '删除', 'aria-label': '删除这个候选方案', onclick: () => {
          const rm = () => { j.candidates = j.candidates.filter(x => x.id !== c.id); save(); renderCompare(); renderLive(); };
          if (!c.name.trim() && !c.solves.length && !c.eases.length) { rm(); return; }
          ask(`删除候选方案「${(c.name || '未命名').trim().slice(0, 40)}」?它勾选的 ${c.solves.length} 条推力/拉力和 ${c.eases.length} 条焦虑覆盖关系会一并删除,覆盖矩阵里的这一列也会消失。此操作不能撤销;确认前数据不变。`, () => { rm(); settleFocus(); }, '#add-candidate');
        } })),
      h('div', { class: 'grid-2' },
        group(c, 'solves', '解决了哪条推力/拉力', drive, it => (j.forces.push.includes(it) ? '推力' : '拉力')),
        group(c, 'eases', '缓解了哪条焦虑', anx, () => '焦虑')))) : [h('p', { class: 'muted', text: '还没有候选方案。同一个任务下可以放多个,比较它们各自覆盖了什么。' })]));
    renderCounts();
  }
  function renderCounts() {
    const j = job(); if (!j) return;
    const cov = C.coverage(j);
    for (const r of cov.rows) {
      const el = document.querySelector(`[data-cand="${CSS.escape(r.id)}"]`);
      if (el) el.textContent = `推力/拉力 ${r.solved}/${cov.drivingTotal} · 焦虑 ${r.eased}/${cov.anxietyTotal}`;
    }
  }
  function renderMatrix() {
    const j = job(); if (!j) return;
    const cov = C.coverage(j);
    const wrap = $('matrix');
    if (!cov.rows.length || !cov.columns.length) {
      wrap.replaceChildren(h('p', { class: 'muted', text: cov.rows.length ? '还没有可覆盖的推力、拉力或焦虑。' : '添加候选方案后,这里显示覆盖矩阵。' }));
      return;
    }
    const L = C.FORCE_LABELS;
    wrap.replaceChildren(h('table', { class: 'matrix' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: '力量' }), ...cov.rows.map(r => h('th', { scope: 'col', text: r.name || '(未命名)' })))),
      h('tbody', {}, ...cov.columns.map((col, i) => h('tr', {},
        h('th', { scope: 'row' }, h('span', { class: 'kind kind-' + col.kind, text: L[col.kind] }), ' ', col.text),
        ...cov.rows.map(r => h('td', { class: r.cells[i] ? 'hit' : 'miss', text: r.cells[i] ? '覆盖' : '未覆盖' }))))),
      h('tfoot', {}, h('tr', {}, h('th', { scope: 'row', text: '覆盖数' }), ...cov.rows.map(r => h('td', { text: `推力/拉力 ${r.solved}/${cov.drivingTotal} · 焦虑 ${r.eased}/${cov.anxietyTotal}` }))))));
  }

  // ---------- 导出 ----------
  function renderExport() {
    const j = job(); if (!j) return;
    const blocks = C.validateJob(j).issues.filter(i => i.level === 'block');
    $('md-preview').textContent = C.toMarkdown(j);
    $('export-md').disabled = blocks.length > 0;
    $('export-csv').disabled = j.candidates.length === 0;
    const notes = [];
    if (blocks.length) notes.push('任务陈述卡暂不能导出:' + blocks.map(b => b.message).join(';') + '。');
    if (!j.candidates.length) notes.push('覆盖矩阵需要至少一个候选方案。');
    $('export-note').textContent = notes.join(' ');
  }
  function fileSafe(s) { return (s || '任务').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40); }

  async function importFile(file) {
    $('import-errors').hidden = true;
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { showImportErrors(['文件不是合法 JSON']); return; }
    const v = C.validateImport(data);
    if (!v.ok) { showImportErrors(v.errors); return; }
    const apply = () => {
      state = { version: 1, jobs: v.jobs, currentId: v.currentId && v.jobs.some(j => j.id === v.currentId) ? v.currentId : (v.jobs[0] ? v.jobs[0].id : null) };
      openEvidence.clear(); save(); renderAll();
    };
    if (state.jobs.length) ask(`导入会替换当前的 ${state.jobs.length} 个任务,备份文件里有 ${v.jobs.length} 个。确认替换?`, apply); else apply();
  }
  function showImportErrors(list) {
    $('import-error-list').replaceChildren(...list.slice(0, 8).map(e => h('li', { text: e })), ...(list.length > 8 ? [h('li', { text: `……另有 ${list.length - 8} 条` })] : []));
    $('import-errors').hidden = false;
  }

  // ---------- 动作 ----------
  function loadSample() {
    const apply = () => {
      const s = clone(globalThis.JtbdSample);
      state = { version: 1, jobs: s.jobs, currentId: s.currentId };
      openEvidence.clear(); tab = 'statement'; save(); renderAll();
    };
    if (state.jobs.length) ask(`已有 ${state.jobs.length} 个任务。载入示例会替换它们,确认替换?(建议先导出备份)`, apply); else apply();
  }
  function newJob() {
    const j = C.blankJob();
    state.jobs.push(j); state.currentId = j.id; tab = 'statement';
    save(); renderAll(); $('job-title').focus(); $('job-title').select();
  }

  function bind() {
    $('load-sample').onclick = loadSample; $('empty-sample').onclick = loadSample;
    $('new-job').onclick = newJob; $('empty-new').onclick = newJob;
    $('clear-all').onclick = () => ask('清空全部任务?此操作无法撤销,建议先导出备份。', () => { state = { version: 1, jobs: [], currentId: null }; openEvidence.clear(); save(); renderAll(); });
    $('delete-job').onclick = () => ask(`删除任务「${job().title || '未命名任务'}」?它的四力、证据和候选方案会一起删除。`, () => {
      state.jobs = state.jobs.filter(j => j.id !== state.currentId);
      state.currentId = state.jobs[0] ? state.jobs[0].id : null; save(); renderAll();
    });
    $('confirm-yes').onclick = () => { const run = pending; closeConfirm(); if (run) run(); };
    $('confirm-no').onclick = () => closeConfirm('cancel');
    $('import-backup').onclick = () => $('import-file').click();
    $('empty-import').onclick = () => $('import-file').click();
    $('job-select').onchange = e => { state.currentId = e.target.value; save(); renderAll(); };
    $('job-title').oninput = e => { job().title = e.target.value; save(); const o = $('job-select').selectedOptions[0]; if (o) o.textContent = e.target.value || '未命名任务'; renderExport(); };
    for (const [id, key] of Object.entries(FIELDS)) $(id).oninput = e => { job()[key] = e.target.value; save(); renderLive(); };
    $('f-words').oninput = e => { job().words = e.target.value.split(/[,，、\s]+/).filter(Boolean); save(); renderLive(); };
    $('add-alt').onclick = () => { const a = { id: C.newId('a'), name: '', cost: '', time: '', pain: '' }; job().alternatives.push(a); save(); renderAlts(); renderLive(); const el = document.querySelector(`[data-alt="${CSS.escape(a.id + 'name')}"]`); if (el) el.focus(); };
    $('add-candidate').onclick = () => { job().candidates.push({ id: C.newId('c'), name: '', solves: [], eases: [] }); save(); renderCompare(); renderLive(); const els = document.querySelectorAll('.cand-head input[type=text]'); if (els.length) els[els.length - 1].focus(); };
    for (const b of document.querySelectorAll('[data-tab]')) b.onclick = () => { tab = b.dataset.tab; renderTabs(); if (tab === 'compare') renderCompare(); if (tab === 'export') renderExport(); };
    $('export-md').onclick = () => download(`任务陈述卡-${fileSafe(job().title)}-${stamp()}.md`, C.toMarkdown(job()), 'text/markdown;charset=utf-8');
    $('export-csv').onclick = () => download(`覆盖矩阵-${fileSafe(job().title)}-${stamp()}.csv`, '\uFEFF' + C.toCsv(job()), 'text/csv;charset=utf-8');
    $('export-json').onclick = () => download(`jtbd-备份-${stamp()}.json`, jsonText(), 'application/json');
    $('banner-export').onclick = () => download(`jtbd-备份-${stamp()}.json`, jsonText(), 'application/json');
    $('banner-raw').onclick = () => { if (rawRejected !== null) download('jtbd-原始数据.json', rawRejected, 'application/json'); };
    $('import-file').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); };
  }

  load(); bind(); renderAll();
})();
