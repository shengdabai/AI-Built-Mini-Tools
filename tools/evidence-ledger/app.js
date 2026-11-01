'use strict';
(function () {
  const C = globalThis.EvidenceCore;
  const KEY = 'evidence.v1';
  const $ = id => document.getElementById(id);
  // innerHTML 模板里的每一个插值都经过 esc(含数字与布尔值),用户文本不会被当作标签解析。
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const realToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const TODAY = C.parseToday(location.search, realToday());
  const today = () => TODAY.date;

  let state = { projects: [], currentId: null, currentClaimId: null };
  const ui = { pendingNav: null, pendingImport: null, delEvidence: null };
  let toastTimer = null;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const v = C.validateImport({ version: 1, projects: parsed.projects || [] });
      if (v.ok) { state.projects = v.projects; state.currentId = parsed.currentId || null; }
    } catch (e) { /* 存储不可用或损坏:从空开始 */ }
  }
  // 返回是否真正写入。失败时显示持续可见的警告条(带备份按钮);之后任何一次写入成功就解除,并说明当前保存结果。
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ projects: state.projects, currentId: state.currentId }));
    } catch (e) {
      $('save-warning').hidden = false;
      return false;
    }
    if (!$('save-warning').hidden) {
      $('save-warning').hidden = true;
      recovered = true;
      toast('');
    }
    return true;
  }
  let recovered = false;
  function toast(msg) {
    const t = $('toast');
    if (recovered) { const hadMsg = msg !== ''; msg = '已恢复保存:此前失败的改动和当前改动都已写入浏览器存储。' + msg; if (hadMsg) recovered = false; }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }
  // 写入成功才说「已…」;写入失败时警告条已持续可见,不再弹成功提示
  function done(ok, msg) { if (ok) toast(msg); }
  function download(name, text, type = 'text/plain;charset=utf-8') {
    const a = document.createElement('a');
    const url = URL.createObjectURL(new Blob([text], { type }));
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const project = () => state.projects.find(p => p.id === state.currentId) || null;
  const claim = () => { const p = project(); return p ? p.claims.find(c => c.id === state.currentClaimId) || null : null; };
  const evCount = p => p.claims.reduce((n, c) => n + c.evidence.length, 0);

  // ---------- 字段级错误 ----------
  function fieldError(inputId, errId, msg) {
    const e = $(errId); e.textContent = msg; e.hidden = false;
    const i = $(inputId); i.setAttribute('aria-invalid', 'true');
    const desc = (i.getAttribute('aria-describedby') || '').split(' ').filter(Boolean);
    if (!desc.includes(errId)) desc.push(errId);
    i.setAttribute('aria-describedby', desc.join(' '));
    i.focus();
  }
  function clearFieldError(inputId, errId) {
    const e = $(errId); e.textContent = ''; e.hidden = true;
    $(inputId).removeAttribute('aria-invalid');
  }

  // ---------- 未保存的主张修改 ----------
  function detailDirty() {
    const c = claim();
    if (!c || $('detail-body').hidden) return false;
    return $('detail-text').value !== c.text || $('detail-note').value !== (c.note || '');
  }
  function updateDirty() {
    $('dirty-note').hidden = !detailDirty();
    renderExportState();
  }
  // 会丢掉详情表单内容的操作都先过这里:有未保存修改时弹出 保存 / 放弃 / 取消
  function guard(next) {
    if (!detailDirty()) { next(); return; }
    ui.pendingNav = next;
    $('dirty-confirm').hidden = false;
    $('dirty-confirm').scrollIntoView({ block: 'nearest' });
    $('dirty-save').focus();
  }
  // 不切换主张的重绘(加证据、改项目名等)要保住尚未保存的输入
  function keepEdits(fn) {
    const c = claim();
    const keep = c && detailDirty() ? { id: c.id, text: $('detail-text').value, note: $('detail-note').value } : null;
    fn();
    if (keep && state.currentClaimId === keep.id && claim()) {
      $('detail-text').value = keep.text; $('detail-note').value = keep.note; updateDirty();
    }
  }

  // ---------- 项目 ----------
  function renderProjects() {
    const sel = $('project-select');
    sel.innerHTML = state.projects.length ? state.projects.map(p => `<option value="${esc(p.id)}" ${p.id === state.currentId ? 'selected' : ''}>${esc(p.title)}${p.sample ? esc('（合成示例）') : ''}</option>`).join('') : '<option value="">（还没有项目）</option>';
    const p = project();
    $('project-title').value = p ? p.title : '';
    $('project-question').value = p ? p.question : '';
    $('project-date').value = p ? p.date : '';
    $('sample-badge').hidden = !(p && p.sample);
    for (const id of ['project-title', 'project-question', 'project-date', 'delete-project']) $(id).disabled = !p;
  }
  function newProject() {
    guard(() => {
      const p = { id: C.newId('p'), title: '未命名项目', question: '', date: today(), sample: false, claims: [] };
      state.projects.unshift(p); state.currentId = p.id; state.currentClaimId = null;
      save(); renderAll(); $('project-title').focus(); $('project-title').select();
    });
  }
  function updateProjectField(field, value) {
    const p = project(); if (!p) return;
    p[field] = field === 'title' ? (value.trim() || '未命名项目') : value;
    save();
    keepEdits(() => { renderProjects(); renderExport(); });
  }

  // ---------- 主张列表 ----------
  function filteredClaims() {
    const p = project(); if (!p) return [];
    let list = C.search(p, $('search').value);
    const st = $('filter-status').value, fl = $('filter-flag').value;
    if (st) list = list.filter(c => C.status(c) === st);
    if (fl) list = list.filter(c => C.flags(c)[fl]);
    return list;
  }
  function renderClaims() {
    const p = project();
    const list = filteredClaims();
    const focusedClaim = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.claim : null;
    $('claim-count').textContent = p ? `${list.length} / ${p.claims.length} 条` : '';
    const box = $('claim-list');
    if (!p) { box.innerHTML = '<div class="empty">先新建项目或载入合成示例。</div>'; return; }
    if (!list.length) { box.innerHTML = `<div class="empty">${p.claims.length ? '没有符合筛选的主张。' : '还没有主张。用上面的表单添加一条。'}</div>`; return; }
    box.innerHTML = list.map(c => {
      const s = C.status(c), n = C.counts(c), f = C.flags(c);
      return `<button type="button" class="claim-item" data-claim="${esc(c.id)}" aria-current="${esc(c.id === state.currentClaimId)}">
        <span class="text">${esc(c.text)}</span>
        <span class="meta"><span class="badge status-${esc(s)}">${esc(s)}</span><span>支持 ${esc(n.support)} · 反对 ${esc(n.oppose)}</span>${f.noPrimary ? '<span class="badge warn">缺一手</span>' : ''}${f.aiOnly ? '<span class="badge warn">仅 AI</span>' : ''}</span>
      </button>`;
    }).join('');
    if (focusedClaim) {
      const again = Array.from(box.querySelectorAll('[data-claim]')).filter(b => b.dataset.claim === focusedClaim)[0];
      if (again) again.focus();
    }
  }
  function addClaim(text) {
    const p = project();
    if (!p) { toast('先新建项目。'); return; }
    const t = text.trim();
    if (!t) { fieldError('claim-text', 'claim-text-error', '主张不能为空:请用一句话写出你要验证的结论。'); return; }
    clearFieldError('claim-text', 'claim-text-error');
    guard(() => {
      const c = { id: C.newId('c'), text: t, note: '', evidence: [] };
      p.claims.unshift(c); state.currentClaimId = c.id;
      $('claim-text').value = '';
      done(save(), '已添加主张。'); renderAll();
    });
  }
  function selectClaim(id) {
    guard(() => { state.currentClaimId = id; save(); renderClaims(); renderDetail(); });
  }

  // ---------- 主张详情 ----------
  function renderDetail() {
    const c = claim();
    $('detail-empty').hidden = !!c; $('detail-body').hidden = !c;
    $('claim-confirm').hidden = true; $('dirty-confirm').hidden = true; ui.pendingNav = null; ui.delEvidence = null;
    clearFieldError('detail-text', 'detail-text-error');
    if (!c) { updateDirty(); return; }
    $('detail-text').value = c.text; $('detail-note').value = c.note || '';
    const s = C.status(c), n = C.counts(c), f = C.flags(c);
    const badge = $('detail-status'); badge.textContent = s; badge.className = `badge status-${s}`;
    $('detail-counts').textContent = `支持 ${n.support} · 反对 ${n.oppose} · 不相关 ${n.neutral}`;
    $('detail-flags').innerHTML = `${f.noPrimary ? '<span class="badge warn">缺一手证据</span> ' : ''}${f.aiOnly ? '<span class="badge warn">仅有 AI 生成证据</span>' : ''}`;
    renderEvidenceList();
    updateDirty();
  }
  function renderEvidenceList() {
    const c = claim(); if (!c) return;
    const list = $('evidence-list');
    list.innerHTML = c.evidence.length ? c.evidence.map(e => {
      const asking = ui.delEvidence === e.id;
      const pv = asking ? C.statusAfterRemove(c, e.id) : null;
      const label = e.title || e.url || '这条证据';
      return `<div class="evidence stance-${esc(e.stance)} type-${esc(e.type)}">
      <div class="head"><span class="row"><span class="badge plain">${esc(C.labelOf(C.TYPES, e.type))}</span><span class="badge plain">${esc(C.labelOf(C.STANCES, e.stance))} · ${esc(C.labelOf(C.STRENGTHS, e.strength))}</span>${e.date ? `<span class="muted">${esc(e.date)}</span>` : ''}</span>${asking ? '' : `<button type="button" class="link" data-remove="${esc(e.id)}" aria-label="${esc('删除证据：' + label)}">删除</button>`}</div>
      <div class="title">${C.safeUrl(e.url) ? `<a href="${esc(C.safeUrl(e.url))}" target="_blank" rel="noopener noreferrer">${esc(e.title || e.url)}</a>` : esc(e.title || '（无来源标题）')}</div>
      ${e.excerpt ? `<div class="excerpt">${esc(e.excerpt)}</div>` : ''}
      ${e.limit ? `<div class="limit">局限:${esc(e.limit)}</div>` : ''}
      ${asking ? `<div class="confirm confirm--inline" role="alertdialog"><strong>确认删除这条证据「${esc(label)}」?</strong><span class="muted">${pv.changed ? `删除后这条主张的状态会从「${esc(pv.before)}」变为「${esc(pv.after)}」。` : `删除后这条主张的状态不变(仍是「${esc(pv.after)}」)。`}确认前证据和状态都保持原样。</span><div class="row"><button type="button" class="danger" data-remove-yes="${esc(e.id)}">确认删除证据</button><button type="button" data-remove-no="${esc(e.id)}">取消</button></div></div>` : ''}
    </div>`;
    }).join('') : '<div class="empty">还没有证据。没有证据的主张状态是「待验证」。</div>';
  }
  function fillSelects() {
    $('ev-type').innerHTML = C.TYPES.map(t => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('');
    $('ev-stance').innerHTML = C.STANCES.map(t => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('');
    $('ev-strength').innerHTML = C.STRENGTHS.map(t => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('');
  }
  function evError(inputId, msg) {
    $('ev-error').textContent = msg;
    const i = $(inputId);
    i.setAttribute('aria-invalid', 'true');
    i.setAttribute('aria-describedby', 'ev-error');
    i.focus();
  }
  function addEvidence() {
    const c = claim(); if (!c) return;
    for (const id of ['ev-title', 'ev-url']) { $(id).removeAttribute('aria-invalid'); }
    const e = { id: C.newId('e'), type: $('ev-type').value, stance: $('ev-stance').value, strength: $('ev-strength').value, title: $('ev-title').value.trim(), url: $('ev-url').value.trim(), excerpt: $('ev-excerpt').value.trim(), date: $('ev-date').value, limit: $('ev-limit').value.trim() };
    if (!e.title && !e.url && !e.excerpt) { evError('ev-title', '来源标题、来源链接、摘录至少填一项。'); return; }
    if (e.url && !C.safeUrl(e.url)) { evError('ev-url', '来源链接需要以 http:// 或 https:// 开头。'); return; }
    $('ev-error').textContent = '';
    c.evidence.push(e);
    for (const id of ['ev-title', 'ev-url', 'ev-excerpt', 'ev-limit']) $(id).value = '';
    const ok = save();
    keepEdits(() => renderAll());
    done(ok, '已加入证据,主张状态已按规则重算。');
  }

  // ---------- 检查页 ----------
  function renderAudit() {
    const p = project(); const box = $('audit-body');
    if (!p) { box.innerHTML = '<div class="empty">先选择项目。</div>'; return; }
    const a = C.audit(p);
    const none = a.claimCount === 0;
    const group = (title, items, render, hint) => `<div class="audit-group"><h3>${esc(title)} <span class="count ${items.length ? 'bad' : ''}">${esc(items.length)}</span></h3>${items.length ? `<ul>${items.map(render).join('')}</ul>` : `<p class="muted">${esc(none ? '暂无主张可检查。' : hint)}</p>`}</div>`;
    const li = c => `<li><button type="button" class="link" data-goto="${esc(c.id)}">${esc(c.text)}</button></li>`;
    box.innerHTML = [
      group('无证据的主张', a.noEvidence, li, '每条主张都挂了至少一条证据。'),
      group('只有 AI 生成证据的主张', a.aiOnly, li, '没有主张只靠 AI 生成内容支撑。'),
      group('有强反对却仍标「已支持」的主张', a.strongOpposeButSupported, li, '本项目未发现状态冲突。'),
      group('非个人观察却没有来源链接的证据', a.missingUrl, x => `<li><button type="button" class="link" data-goto="${esc(x.claim.id)}">${esc(x.claim.text)}</button> ← ${esc(C.labelOf(C.TYPES, x.evidence.type))}「${esc(x.evidence.title || '无标题')}」</li>`, '所有官方文档、一手数据、二手转述、AI 生成证据都带了来源链接。')
    ].join('');
  }

  // ---------- 导出页 ----------
  function exportBlocked() { return detailDirty(); }
  function renderExportState() {
    const dirty = exportBlocked();
    const p = project();
    $('export-md').disabled = !p;
    $('export-md').setAttribute('aria-disabled', String(dirty || !p));
    $('export-json').setAttribute('aria-disabled', String(dirty));
    $('export-hint').hidden = !dirty;
  }
  function renderExport() {
    const p = project();
    $('md-preview').textContent = p ? C.toMarkdown(p) : '（先选择项目）';
    $('clear-confirm').hidden = true;
    renderExportState();
  }

  // ---------- 导入 / 载入示例:校验 → 预览 → 确认 → 写入 ----------
  function listText(items) { return items.length ? items.map(p => `「${p.title}」(${p.claims} 条主张、${p.evidence} 条证据)`).join('、') : '无'; }
  function askReplace(label, projects, openId) {
    const sm = C.summarizeImport(state.projects, projects);
    const body = $('import-confirm-body');
    body.textContent = '';
    const line = t => { const p = document.createElement('p'); p.textContent = t; body.appendChild(p); };
    line(`${label}校验通过,共 ${projects.length} 个项目。`);
    line(`新增 ${sm.added.length} 个:${listText(sm.added)}`);
    line(`替换 ${sm.replaced.length} 个同 ID 项目:${listText(sm.replaced)}${sm.replaced.length ? ' —— 括号里是现有内容,你在本机对它们做的修改会被文件内容覆盖。' : ''}`);
    line(`其余 ${sm.keep.length} 个现有项目不受影响。`);
    $('import-confirm').hidden = false;
    ui.pendingImport = { projects, openId, label };
    $('import-confirm-no').focus();
  }
  function applyProjects(projects, openId) {
    let added = 0, replaced = 0;
    for (const p of projects) {
      const i = state.projects.findIndex(x => x.id === p.id);
      if (i >= 0) { state.projects[i] = p; replaced++; } else { state.projects.unshift(p); added++; }
    }
    const open = projects.find(p => p.id === openId) || projects[0];
    state.currentId = open ? open.id : state.currentId;
    state.currentClaimId = open && open.claims[0] ? open.claims[0].id : null;
    const ok = save(); renderAll(); setTab('claims');
    done(ok, `完成:新增 ${added} 个项目,替换 ${replaced} 个。`);
  }
  function importFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let json;
      try { json = JSON.parse(String(reader.result)); } catch (e) { toast('导入停止:文件不是合法 JSON,现有数据没有改动。'); return; }
      const v = C.validateImport(json);
      if (!v.ok) { toast('导入停止:' + v.error + '。现有数据没有改动。'); return; }
      askReplace(`备份文件「${file.name}」`, v.projects, null);
    };
    reader.onerror = () => toast('读取文件失败,现有数据没有改动。');
    reader.readAsText(file);
  }
  function loadSample() {
    const v = C.validateImport(globalThis.EVIDENCE_SAMPLE);
    if (!v.ok) { toast('示例数据无效:' + v.error); return; }
    const sample = v.projects[0];
    const exists = state.projects.some(p => p.id === sample.id);
    guard(() => {
      if (exists) { askReplace('合成示例', v.projects, sample.id); return; }
      applyProjects(v.projects, sample.id);
    });
  }

  // ---------- 视图切换 ----------
  function setTab(name) {
    document.querySelectorAll('[role="tab"]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    $('tab-claims').hidden = name !== 'claims'; $('tab-audit').hidden = name !== 'audit'; $('tab-export').hidden = name !== 'export';
    if (name === 'audit') renderAudit();
    if (name === 'export') renderExport();
  }
  function renderAll() { renderProjects(); renderClaims(); renderDetail(); renderAudit(); renderExport(); }

  // ---------- 事件 ----------
  function bind() {
    $('new-project').onclick = newProject;
    $('load-sample').onclick = loadSample;
    const openFile = () => $('import-json').click();
    $('import-btn').onclick = openFile; $('import-btn-2').onclick = openFile;
    $('import-confirm-no').onclick = () => { ui.pendingImport = null; $('import-confirm').hidden = true; $('load-sample').focus(); };
    $('import-confirm-yes').onclick = () => {
      const p = ui.pendingImport; if (!p) return;
      ui.pendingImport = null; $('import-confirm').hidden = true;
      applyProjects(p.projects, p.openId);
    };
    $('warning-export').onclick = () => download(`证据台账-备份-${today()}.json`, JSON.stringify({ version: 1, projects: state.projects }, null, 2), 'application/json');
    $('project-select').onchange = e => {
      const next = e.target.value || null;
      if (detailDirty()) { renderProjects(); guard(() => { state.currentId = next; state.currentClaimId = null; save(); renderAll(); }); return; }
      state.currentId = next; state.currentClaimId = null; save(); renderAll();
    };
    $('project-title').onchange = e => updateProjectField('title', e.target.value);
    $('project-question').onchange = e => updateProjectField('question', e.target.value);
    $('project-date').onchange = e => updateProjectField('date', e.target.value);
    $('delete-project').onclick = () => {
      const p = project(); if (!p) return;
      $('project-confirm-text').textContent = `将删除项目「${p.title}」,以及它的 ${p.claims.length} 条主张和 ${evCount(p)} 条证据,无法恢复。建议先在「导出与数据」里导出备份。`;
      $('project-confirm').hidden = false; $('project-confirm-no').focus();
    };
    $('project-confirm-no').onclick = () => { $('project-confirm').hidden = true; $('delete-project').focus(); };
    $('project-confirm-yes').onclick = () => {
      $('project-confirm').hidden = true;
      guard(() => {
        state.projects = state.projects.filter(p => p.id !== state.currentId);
        state.currentId = state.projects[0] ? state.projects[0].id : null; state.currentClaimId = null;
        const ok = save(); renderAll(); done(ok, '项目已删除。');
      });
    };
    document.querySelectorAll('[role="tab"]').forEach(b => { b.onclick = () => setTab(b.dataset.tab); });
    for (const id of ['search', 'filter-status', 'filter-flag']) $(id).addEventListener('input', renderClaims);
    $('claim-form').onsubmit = e => { e.preventDefault(); addClaim($('claim-text').value); };
    $('claim-text').addEventListener('input', () => clearFieldError('claim-text', 'claim-text-error'));
    $('claim-list').addEventListener('click', e => {
      const b = e.target.closest('[data-claim]'); if (!b) return;
      selectClaim(b.dataset.claim);
    });
    $('detail-text').addEventListener('input', () => { clearFieldError('detail-text', 'detail-text-error'); updateDirty(); });
    $('detail-note').addEventListener('input', updateDirty);
    $('save-claim').onclick = () => {
      const c = claim(); if (!c) return;
      const t = $('detail-text').value.trim();
      if (!t) { fieldError('detail-text', 'detail-text-error', '主张不能为空:请写一句话,或点「删除这条主张」。'); return; }
      c.text = t; c.note = $('detail-note').value.trim();
      const ok = save(); renderAll(); done(ok, '已保存。');
    };
    $('dirty-save').onclick = () => {
      const c = claim(); const next = ui.pendingNav; if (!c) return;
      const t = $('detail-text').value.trim();
      if (!t) { $('dirty-confirm').hidden = true; fieldError('detail-text', 'detail-text-error', '主张不能为空:请写一句话,或选「放弃修改」。'); return; }
      c.text = t; c.note = $('detail-note').value.trim();
      save(); $('dirty-confirm').hidden = true; ui.pendingNav = null;
      if (next) next();
    };
    $('dirty-discard').onclick = () => {
      const next = ui.pendingNav; ui.pendingNav = null; $('dirty-confirm').hidden = true;
      const c = claim();
      if (c) { $('detail-text').value = c.text; $('detail-note').value = c.note || ''; updateDirty(); }
      if (next) next();
    };
    $('dirty-cancel').onclick = () => { ui.pendingNav = null; $('dirty-confirm').hidden = true; $('detail-text').focus(); };
    $('delete-claim').onclick = () => {
      const c = claim(); if (!c) return;
      $('claim-confirm-text').textContent = `确认删除这条主张及其 ${c.evidence.length} 条证据?删除后无法恢复。`;
      $('claim-confirm').hidden = false; $('claim-confirm-no').focus();
    };
    $('claim-confirm-no').onclick = () => { $('claim-confirm').hidden = true; $('delete-claim').focus(); };
    $('claim-confirm-yes').onclick = () => {
      const p = project(); if (!p) return;
      p.claims = p.claims.filter(c => c.id !== state.currentClaimId); state.currentClaimId = null;
      const ok = save(); renderAll(); done(ok, '主张已删除。');
      const first = document.querySelector('#claim-list [data-claim]'); if (first) first.focus(); else $('claim-text').focus();
    };
    $('evidence-list').addEventListener('click', e => {
      const c = claim(); if (!c) return;
      const rm = e.target.closest('[data-remove]');
      if (rm) {
        ui.delEvidence = rm.dataset.remove; renderEvidenceList();
        const no = Array.from($('evidence-list').querySelectorAll('[data-remove-no]')).filter(b => b.dataset.removeNo === ui.delEvidence)[0];
        if (no) no.focus();
        return;
      }
      const no = e.target.closest('[data-remove-no]');
      if (no) {
        const id = no.dataset.removeNo; ui.delEvidence = null; renderEvidenceList();
        const back = Array.from($('evidence-list').querySelectorAll('[data-remove]')).filter(b => b.dataset.remove === id)[0];
        if (back) back.focus();
        return;
      }
      const yes = e.target.closest('[data-remove-yes]');
      if (yes) {
        const id = yes.dataset.removeYes;
        const idx = c.evidence.findIndex(x => x.id === id);
        ui.delEvidence = null;
        C.removeEvidence(c, id);
        const ok = save();
        keepEdits(() => renderAll());
        const rest = Array.from($('evidence-list').querySelectorAll('[data-remove]'));
        if (rest.length) rest[Math.min(idx, rest.length - 1)].focus(); else $('ev-type').focus();
        done(ok, '已删除证据,主张状态已按规则重算。');
      }
    });
    $('evidence-form').onsubmit = e => { e.preventDefault(); addEvidence(); };
    for (const id of ['ev-title', 'ev-url', 'ev-excerpt']) $(id).addEventListener('input', () => { $('ev-error').textContent = ''; $(id).removeAttribute('aria-invalid'); });
    $('audit-body').addEventListener('click', e => {
      const b = e.target.closest('[data-goto]'); if (!b) return;
      guard(() => { state.currentClaimId = b.dataset.goto; save(); renderClaims(); renderDetail(); setTab('claims'); });
    });
    $('export-md').onclick = () => {
      const p = project(); if (!p) return;
      if (exportBlocked()) { toast('主张详情里有未保存的修改:请先保存或放弃,再导出。'); return; }
      download(`${p.title}-依据与局限.md`, C.toMarkdown(p), 'text/markdown;charset=utf-8');
    };
    $('export-json').onclick = () => {
      if (exportBlocked()) { toast('主张详情里有未保存的修改:请先保存或放弃,再导出。'); return; }
      download(`证据台账-备份-${today()}.json`, JSON.stringify({ version: 1, projects: state.projects }, null, 2), 'application/json');
    };
    $('import-json').onchange = e => { const f = e.target.files[0]; if (f) importFile(f); e.target.value = ''; };
    $('clear-data').onclick = () => {
      const projects = state.projects.length, claims = state.projects.reduce((n, p) => n + p.claims.length, 0), ev = state.projects.reduce((n, p) => n + evCount(p), 0);
      $('clear-confirm-text').textContent = `将删除本浏览器里的 ${projects} 个项目、${claims} 条主张和 ${ev} 条证据,无法恢复。先导出备份再清空。`;
      $('clear-confirm').hidden = false; $('clear-confirm-no').focus();
    };
    $('clear-confirm-no').onclick = () => { $('clear-confirm').hidden = true; $('clear-data').focus(); };
    $('clear-confirm-yes').onclick = () => {
      $('clear-confirm').hidden = true;
      guard(() => {
        state = { projects: [], currentId: null, currentClaimId: null };
        try { localStorage.removeItem(KEY); } catch (e) { /* 忽略 */ }
        $('save-warning').hidden = true;
        renderAll(); toast('已清空。');
      });
    };
  }

  fillSelects(); load(); bind(); renderAll();
  if (TODAY.fixed) { $('today-note').hidden = false; $('today-note').textContent = `基准日 ${TODAY.date}(由地址参数固定)`; }
})();
