'use strict';
(function () {
  const C = globalThis.AnswerCheckCore;
  const KEY = 'answercheck.v1';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const realToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const TODAY = C.resolveToday(location.search, realToday());
  const pct = r => (r === null ? '—' : `${Math.round(r * 1000) / 10}%`);

  let state = { tasks: [], currentId: null };
  let tab = 'verify';
  let toastTimer = null;
  let saveTimer = null;
  let pendingRecoveryRaw = null;
  let pendingAction = null;
  let lastProbe = '';
  let lastProbeKey = '';
  function probeCtx() {
    const t = task(); if (!t) return null;
    const kind = $('p-kind').value;
    const ctx = { question: t.question, answer: t.answer, model: t.model, otherAnswer: kind === 'cross' ? $('p-other').value : '' };
    if (kind === 'improve') {
      const idx = t.claims.findIndex(c => c.id === $('p-claim').value);
      if (idx >= 0) { ctx.claimIndex = idx + 1; ctx.claimText = t.claims[idx].text; }
    }
    return { kind, ctx, key: JSON.stringify([t.id, kind, ctx]) };
  }
  // 输入或任务变化后,旧提示词作废:清空结果并禁用复制
  function clearProbe() { lastProbe = ''; lastProbeKey = ''; $('p-out').value = ''; $('p-copy').disabled = true; }

  // ---------- 图标(描边,跟随文字色) ----------
  const ICONS = {
    ok: '<path d="M5 12l5 5 9-10"/>',
    bad: '<path d="M6 6l12 12M18 6L6 18"/>',
    doubt: '<path d="M9 9a3 3 0 1 1 4.5 2.6c-1 .6-1.5 1.2-1.5 2.4"/><path d="M12 18h.01"/>',
    idle: '<path d="M5 12h14"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="1"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
    list: '<path d="M5 7h14M5 12h14M5 17h9"/>',
  };
  const icon = n => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;
  const CLAIM_STATUS_VIEW = { 已核实: ['ok', 'tone-ok'], 有误: ['bad', 'tone-bad'], 存疑: ['doubt', 'tone-warn'], 未核: ['idle', 'tone-idle'] };
  const ANSWER_STATUS_VIEW = { 可引用: ['ok', 'tone-ok'], 需修正: ['bad', 'tone-bad'], 不可引用: ['lock', 'tone-warn'], 核实中: ['clock', 'tone-idle'], 待拆断言: ['list', 'tone-idle'] };

  // ---------- 存储 ----------
  function showSaveWarning(msg) { $('save-warning-text').textContent = msg; $('save-warning').hidden = false; }
  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { showSaveWarning('浏览器存储不可用,本次数据只在内存里。请随时到「统计与导出」导出 JSON 备份。'); return; }
    if (!raw) return;
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { /* 下面按校验失败处理 */ }
    const v = C.validateState(parsed);
    if (v.ok) { state = v.state; return; }
    try { localStorage.setItem(KEY + '.rejected', raw); }
    catch (e) {
      pendingRecoveryRaw = raw;
      showSaveWarning('旧数据备份失败,已暂停保存以保留原文。请释放浏览器存储空间后重试;当前新改动可导出 JSON 备份。');
      return;
    }
    toast('浏览器里已保存的数据没有通过校验,未载入(原文已另存为 answercheck.v1.rejected)。继续操作会覆盖当前存储。', true);
  }
  // 返回是否真正写入。保存前与读取后用同一个 validateState
  function save() {
    clearTimeout(saveTimer); saveTimer = null;
    const v = C.validateState(state);
    if (!v.ok) { showSaveWarning('当前数据没有通过校验,未写入:' + v.errors[0] + '。请先导出 JSON 备份。'); return false; }
    if (pendingRecoveryRaw !== null) {
      try { localStorage.setItem(KEY + '.rejected', pendingRecoveryRaw); pendingRecoveryRaw = null; }
      catch (e) { showSaveWarning('旧数据仍未备份,没有覆盖原文。请释放浏览器存储空间后重试;当前新改动可导出 JSON 备份。'); return false; }
    }
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { showSaveWarning('浏览器存储写入失败(可能已满或被禁用)。最近的改动只在内存里,刷新会丢失。请立刻到「统计与导出」导出 JSON 备份。'); return false; }
    $('save-warning').hidden = true;
    return true;
  }
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 300); }
  function flushSave() { if (saveTimer) save(); }
  function toast(msg, sticky) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    if (!sticky) toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }
  const savedToast = msg => { if (save()) toast(msg); };
  function ask(text, fn) { pendingAction = fn; $('confirm-text').textContent = text; $('confirm-bar').hidden = false; $('confirm-yes').focus(); }
  function closeAsk() { pendingAction = null; $('confirm-bar').hidden = true; }

  function download(name, text, type) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(new Blob([text], { type: type || 'text/plain;charset=utf-8' }));
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const task = () => state.tasks.find(t => t.id === state.currentId) || null;
  const claimDefaults = text => ({ id: C.newId('c'), text, type: '事实', checkability: '可查', status: '未核', evidenceText: '', evidenceUrl: '', note: '' });

  // ---------- 渲染 ----------
  function renderTaskList() {
    const ul = $('task-list');
    ul.innerHTML = state.tasks.map(t => {
      const st = C.answerStatus(t.claims).status;
      const title = (t.question || '(未填问题)').slice(0, 60);
      return `<li><button type="button" class="task-item" data-task="${esc(t.id)}" aria-current="${t.id === state.currentId}">
        <span class="task-item-title">${esc(title)}</span>
        <span class="task-item-meta">${esc(t.model || C.NO_MODEL)} · ${esc(st)}</span></button>
        <button type="button" class="btn btn-danger task-delete" data-del-task="${esc(t.id)}">删除此任务</button></li>`;
    }).join('');
    $('task-empty').hidden = state.tasks.length > 0;
  }
  function renderTabs() {
    document.querySelectorAll('.tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    const has = !!task();
    $('empty-guide').hidden = !(tab !== 'data' && !has);
    for (const v of document.querySelectorAll('.view')) v.hidden = v.dataset.view !== tab || (v.dataset.view !== 'data' && !has);
  }
  function fillTaskForm() {
    const t = task(); if (!t) return;
    $('t-question').value = t.question; $('t-model').value = t.model; $('t-date').value = t.date; $('t-answer').value = t.answer;
  }
  function renderStatus() {
    const t = task(); const el = $('status-panel'); if (!t) { el.innerHTML = ''; return; }
    const r = C.answerStatus(t.claims); const [ic, tone] = ANSWER_STATUS_VIEW[r.status]; const n = r.counts;
    el.innerHTML = `<div class="status-badge ${esc(tone)}">${icon(ic)}<span id="answer-status">${esc(r.status)}</span></div>
      <div class="status-body"><ul class="status-reasons">${r.reasons.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      <div class="stat-row"><span>断言 <strong>${esc(n.total)}</strong></span><span>已核实 <strong>${esc(n.已核实)}</strong></span><span>有误 <strong>${esc(n.有误)}</strong></span><span>存疑 <strong>${esc(n.存疑)}</strong></span><span>未核 <strong>${esc(n.未核)}</strong></span><span>无法核实 <strong>${esc(n.unverifiable)}</strong></span><span>核实率 <strong>${esc(pct(r.verifyRate))}</strong></span></div>
      <p class="rate-note" id="rate-note">核实率口径:${esc(C.rateText(r))}。上面的「已核实」包含无法核实类里已核实的,所以不能直接用它除以断言数。</p></div>`;
  }
  const opts = (list, cur) => list.map(x => `<option value="${esc(x)}"${x === cur ? ' selected' : ''}>${esc(x)}</option>`).join('');
  function chipHtml(status) { const [ic, tone] = CLAIM_STATUS_VIEW[status]; return `<span class="chip ${esc(tone)}" data-role="chip">${icon(ic)}${esc(status)}</span>`; }
  function renderClaims() {
    const t = task(); const ol = $('claims'); if (!t) { ol.innerHTML = ''; return; }
    $('claims-empty').hidden = t.claims.length > 0;
    ol.innerHTML = t.claims.map((c, i) => `<li class="claim" data-id="${esc(c.id)}" data-status="${esc(c.status)}">
      <div class="claim-head"><span class="claim-no">第 ${esc(i + 1)} 条</span>${chipHtml(c.status)}</div>
      <p class="stale-note" data-role="stale"${c.staleFrom ? '' : ' hidden'}>待重新核实:这条断言的文字在核实之后被改动,状态已重置为「未核」。原文:「<span data-role="stale-from">${esc(c.staleFrom || '')}</span>」。下面的旧证据保留供对照;重新选择「状态」后这条提示消失。</p>
      <label class="field">断言<textarea data-f="text" rows="2">${esc(c.text)}</textarea></label>
      <div class="claim-grid">
        <label class="field">类型<select data-f="type">${opts(C.TYPES, c.type)}</select></label>
        <label class="field">可核实性<select data-f="checkability">${opts(C.CHECKS, c.checkability)}</select></label>
        <label class="field">状态<select data-f="status">${opts(C.STATUSES, c.status)}</select></label>
        <label class="field">证据来源(文本)<input type="text" data-f="evidenceText" value="${esc(c.evidenceText)}" autocomplete="off"></label>
        <label class="field">证据链接(只接受 http/https)<input type="text" data-f="evidenceUrl" value="${esc(c.evidenceUrl)}" autocomplete="off" inputmode="url"><span class="field-error" data-role="url-err" hidden>这不是 http(s) 链接,没有保存。</span></label>
        <label class="field">备注<input type="text" data-f="note" value="${esc(c.note)}" autocomplete="off"></label>
      </div>
      <div class="claim-actions">
        <a class="btn" data-role="open-link" href="${esc(C.isHttpUrl(c.evidenceUrl) ? c.evidenceUrl : '')}" target="_blank" rel="noopener noreferrer"${C.isHttpUrl(c.evidenceUrl) ? '' : ' hidden'}>打开证据链接</a>
        ${i > 0 ? '<button type="button" class="btn" data-act="merge">与上一条合并</button>' : ''}
        <button type="button" class="btn btn-danger" data-act="del-claim">删除此断言</button>
      </div></li>`).join('');
  }
  function renderProbeControls() {
    const t = task(); if (!t) return;
    const kind = $('p-kind').value;
    $('p-claim-wrap').hidden = kind !== 'improve'; $('p-other-wrap').hidden = kind !== 'cross';
    const sel = $('p-claim'); const prev = sel.value;
    sel.innerHTML = t.claims.map((c, i) => `<option value="${esc(c.id)}">${esc(i + 1)}. ${esc((c.text || '(空)').slice(0, 40))}</option>`).join('');
    if (prev && t.claims.some(c => c.id === prev)) sel.value = prev;
  }
  function nextRoundN(t) { return t.rounds.reduce((m, r) => Math.max(m, r.n), 0) + 1; }
  function renderRounds() {
    const t = task(); const ul = $('rounds'); if (!t) { ul.innerHTML = ''; return; }
    $('rounds-empty').hidden = t.rounds.length > 0;
    ul.innerHTML = t.rounds.slice().sort((a, b) => a.n - b.n).map(r => `<li class="round" data-id="${esc(r.id)}">
      <strong>第 ${esc(r.n)} 轮</strong><span>${esc(C.KIND_LABEL[r.kind])}</span><span>修正 ${esc(r.fixed)} 条</span>
      <span class="round-text">${esc(r.summary || '(无摘要)')}</span>
      <button type="button" class="btn btn-danger" data-act="del-round">删除</button></li>`).join('');
  }
  function renderData() {
    const t = task(); const el = $('stats');
    if (!t) { el.innerHTML = '<p class="muted">没有选中的任务。</p>'; }
    else {
      const r = C.answerStatus(t.claims); const n = r.counts; const rs = C.roundStats(t.rounds);
      const card = (k, v) => `<div class="stat-card"><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
      el.innerHTML = `<div class="stat-grid">${card('断言数', n.total)}${card('已核实', n.已核实)}${card('有误', n.有误)}${card('存疑', n.存疑)}${card('未核', n.未核)}${card('无法核实(不计分母)', n.unverifiable)}${card('核实率', pct(r.verifyRate))}${card('拷问轮数', rs.count)}${card('累计修正数', rs.totalFixed)}</div>
        <p class="muted">核实率口径:${esc(C.rateText(r))}。「已核实」${esc(n.已核实)} 条含无法核实类里已核实的,所以不能直接用它复算核实率。</p>
        <div class="table-wrap"><table><thead><tr><th>轮次</th><th>模板</th><th>本轮修正数</th></tr></thead><tbody>${rs.perRound.length ? rs.perRound.map(p => `<tr><td>第 ${esc(p.n)} 轮</td><td>${esc(C.KIND_LABEL[p.kind])}</td><td>${esc(p.fixed)}</td></tr>`).join('') : '<tr><td colspan="3">还没有拷问记录</td></tr>'}</tbody></table></div>`;
    }
    const ms = C.modelStats(state.tasks);
    $('model-stats').innerHTML = ms.length ? `<table><thead><tr><th>模型</th><th>任务数</th><th>断言数</th><th>已核实</th><th>有误</th><th>错误率</th></tr></thead><tbody>${ms.map(m => `<tr><td>${esc(m.model)}</td><td>${esc(m.tasks)}</td><td>${esc(m.claims)}</td><td>${esc(m.verified)}</td><td>${esc(m.wrong)}</td><td>${esc(pct(m.errorRate))}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">还没有数据。</p>';
    $('md-preview').value = t ? C.toMarkdown(t) : '';
    $('export-md').disabled = !t;
    $('export-csv').disabled = !state.tasks.some(x => x.claims.length);
    $('export-json').disabled = state.tasks.length === 0;
    $('clear-all').disabled = state.tasks.length === 0;
  }
  function renderAll() {
    clearProbe();
    renderTaskList(); renderTabs(); fillTaskForm(); renderStatus(); renderClaims(); renderAnswerNote(); renderProbeControls(); renderRounds(); renderData();
    if (task()) $('r-n').value = nextRoundN(task());
  }
  // 编辑中的轻量刷新:不重建断言列表,避免打断输入焦点
  function renderAnswerNote() {
    const t = task(); const box = $('answer-changed');
    const show = !!t && C.answerChanged(t);
    box.hidden = !show;
    if (show) $('answer-changed-text').textContent = `答案文字在拆断言之后被修改过。下面 ${t.claims.length} 条断言是按旧答案拆的,可能已经不对应当前答案:请逐条核对,删除或改写不再对应的断言,再点「确认断言仍对应当前答案」。`;
  }
  function refreshDerived() { renderTaskList(); renderStatus(); renderData(); renderAnswerNote(); }

  // ---------- 任务 ----------
  function newTask() {
    const t = { id: C.newId('t'), question: '', answer: '', model: '', date: TODAY, claims: [], rounds: [] };
    state.tasks.unshift(t); state.currentId = t.id; tab = 'verify';
    renderAll(); savedToast('已新建任务'); $('t-question').focus();
  }
  function applyState(s, msg) {
    state = { tasks: s.tasks, currentId: s.currentId || (s.tasks[0] ? s.tasks[0].id : null) };
    tab = 'verify'; renderAll(); savedToast(msg);
  }
  function loadSample() {
    const run = () => {
      const v = C.validateState(JSON.parse(JSON.stringify(globalThis.ANSWERCHECK_SAMPLE)));
      if (!v.ok) { toast('示例数据未通过校验:' + v.errors[0], true); return; }
      applyState(v.state, '已载入合成示例(内容为示意)');
    };
    if (state.tasks.length) ask(`载入示例会替换当前全部 ${state.tasks.length} 个任务,且不可撤销。建议先导出 JSON 备份。确认替换?`, run); else run();
  }

  // ---------- 事件 ----------
  $('new-task').addEventListener('click', newTask);
  $('load-sample').addEventListener('click', loadSample);
  $('confirm-yes').addEventListener('click', () => { const fn = pendingAction; closeAsk(); if (fn) fn(); });
  $('confirm-no').addEventListener('click', closeAsk);
  document.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('.tab'); if (!b) return; tab = b.dataset.tab; renderAll(); });
  document.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) { tab = g.dataset.go; renderAll(); } });
  $('task-list').addEventListener('click', e => {
    const del = e.target.closest('[data-del-task]');
    if (del) {
      const id = del.dataset.delTask;
      ask('删除这个任务及其全部断言与拷问记录?不可撤销。', () => {
        state.tasks = state.tasks.filter(t => t.id !== id);
        if (state.currentId === id) state.currentId = state.tasks[0] ? state.tasks[0].id : null;
        renderAll(); savedToast('已删除任务');
      });
      return;
    }
    const b = e.target.closest('[data-task]');
    if (b) { state.currentId = b.dataset.task; renderAll(); scheduleSave(); }
  });

  for (const [id, f] of [['t-question', 'question'], ['t-model', 'model'], ['t-answer', 'answer'], ['t-date', 'date']]) {
    const h = () => {
      const t = task(); if (!t) return;
      if (f === 'answer' && t.claims.length && typeof t.claimsAnswer !== 'string') t.claimsAnswer = t.answer; // 记下断言对应的是改动前的答案
      t[f] = $(id).value; clearProbe(); refreshDerived(); scheduleSave();
    };
    $(id).addEventListener('input', h); $(id).addEventListener('change', h);
  }

  $('add-claim-form').addEventListener('submit', e => {
    e.preventDefault(); const t = task(); const inp = $('add-claim-text'); const text = inp.value.trim();
    if (!t || !text) return;
    t.claims.push(claimDefaults(text)); inp.value = '';
    if (typeof t.claimsAnswer !== 'string') t.claimsAnswer = t.answer;
    renderStatus(); renderClaims(); renderTaskList(); renderProbeControls(); renderData(); savedToast('已添加断言');
  });
  $('split-btn').addEventListener('click', () => {
    const t = task(); if (!t) return;
    const parts = C.splitClaims(t.answer);
    if (!parts.length) { toast('答案里没有可拆的句子,请先粘贴 AI 答案。'); return; }
    const run = () => { for (const p of parts) t.claims.push(claimDefaults(p)); if (typeof t.claimsAnswer !== 'string') t.claimsAnswer = t.answer; refreshDerived(); renderClaims(); renderProbeControls(); savedToast(`已粗拆出 ${parts.length} 条断言,请逐条检查类型并合并被拆碎的句子`); };
    if (t.claims.length) ask(`已有 ${t.claims.length} 条断言;粗拆出的 ${parts.length} 条会追加到末尾。确认追加?`, run); else run();
  });

  const claimOf = el => { const li = el.closest('.claim'); const t = task(); return li && t ? [li, t.claims.find(c => c.id === li.dataset.id), t] : [null, null, t]; };
  function onClaimInput(e) {
    const f = e.target.dataset.f; if (!f) return;
    const [li, c] = claimOf(e.target); if (!c) return;
    const v = e.target.value;
    if (f === 'evidenceUrl') {
      const bad = v !== '' && !C.isHttpUrl(v);
      e.target.setAttribute('aria-invalid', String(bad));
      li.querySelector('[data-role=url-err]').hidden = !bad;
      if (bad) { li.querySelector('[data-role=open-link]').hidden = true; return; } // 非法链接不写入状态,界面上明确标红;链接按钮暂时隐藏
    }
    if (f === 'text') {
      const next = C.editClaimText(c, v);
      Object.assign(c, next);
      clearProbe();
      if (c.status !== li.dataset.status) {
        li.dataset.status = c.status; li.querySelector('[data-role=chip]').outerHTML = chipHtml(c.status);
        li.querySelector('select[data-f=status]').value = c.status;
      }
      li.querySelector('[data-role=stale]').hidden = !c.staleFrom;
      li.querySelector('[data-role=stale-from]').textContent = c.staleFrom || '';
    } else {
      c[f] = v;
      if (f === 'status') {
        li.dataset.status = v; li.querySelector('[data-role=chip]').outerHTML = chipHtml(v);
        if (c.staleFrom) { delete c.staleFrom; li.querySelector('[data-role=stale]').hidden = true; }
      }
      if (f === 'evidenceUrl') {
        const a = li.querySelector('[data-role=open-link]');
        a.hidden = v === ''; if (v !== '') a.href = v;
      }
    }
    refreshDerived(); if (f === 'text') renderProbeControls(); scheduleSave();
  }
  $('claims').addEventListener('input', onClaimInput);
  $('claims').addEventListener('change', onClaimInput);
  $('claims').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const [, c, t] = claimOf(b); if (!c) return;
    const i = t.claims.indexOf(c);
    if (b.dataset.act === 'del-claim') {
      ask(`删除第 ${i + 1} 条断言及其证据?不可撤销。`, () => { t.claims.splice(i, 1); renderAll(); savedToast('已删除断言'); });
    } else if (b.dataset.act === 'merge' && i > 0) {
      t.claims[i - 1] = C.mergeClaims(t.claims[i - 1], c);
      t.claims.splice(i, 1); renderAll(); savedToast('已合并;状态不一致时重置为「未核」,请重新核实');
    }
  });

  $('confirm-claims').addEventListener('click', () => { const t = task(); if (!t) return; t.claimsAnswer = t.answer; renderAnswerNote(); savedToast('已确认断言对应当前答案'); });

  // 拷问
  $('p-kind').addEventListener('change', () => { renderProbeControls(); clearProbe(); });
  $('p-claim').addEventListener('change', clearProbe);
  $('p-other').addEventListener('input', clearProbe);
  $('p-gen').addEventListener('click', () => {
    const t = task(); if (!t) return;
    const pc = probeCtx(); const kind = pc.kind; const out = $('p-out');
    if (!t.answer.trim()) { clearProbe(); out.value = '请先在「核实」页粘贴 AI 答案。'; return; }
    if (kind === 'improve' && pc.ctx.claimIndex === undefined) { clearProbe(); out.value = '请先添加断言,再选择要修正的那一条。'; return; }
    lastProbe = C.probePrompt(kind, pc.ctx); lastProbeKey = pc.key; out.value = lastProbe; $('p-copy').disabled = false;
    $('r-kind').value = kind;
  });
  $('p-copy').addEventListener('click', async () => {
    const pc = probeCtx();
    if (!lastProbe || !pc || pc.key !== lastProbeKey) { clearProbe(); toast('输入已变化,旧提示词已作废,请重新生成。'); return; }
    let ok = false;
    try { await navigator.clipboard.writeText(lastProbe); ok = true; } catch (e) { /* 走兜底 */ }
    if (!ok) { const o = $('p-out'); o.focus(); o.select(); try { ok = document.execCommand('copy'); } catch (e) { ok = false; } }
    toast(ok ? '已复制提示词' : '浏览器不允许自动复制,提示词已选中,请按 Cmd/Ctrl+C。');
  });
  $('round-form').addEventListener('submit', e => {
    e.preventDefault(); const t = task(); if (!t) return;
    const err = $('round-error'); const nS = $('r-n').value.trim(); const fS = $('r-fixed').value.trim();
    const n = Number(nS), fixed = Number(fS);
    if (nS === '' || !Number.isSafeInteger(n) || n < 1) { err.textContent = '「第几轮」必须是 1 以上的整数。'; err.hidden = false; return; }
    if (fS === '' || !Number.isSafeInteger(fixed) || fixed < 0) { err.textContent = '「本轮修正了几条」必须是 0 以上的整数。'; err.hidden = false; return; }
    err.hidden = true;
    t.rounds.push({ id: C.newId('r'), n, kind: $('r-kind').value, summary: $('r-summary').value, fixed });
    $('r-summary').value = ''; $('r-fixed').value = '0';
    renderRounds(); renderData(); $('r-n').value = nextRoundN(t); savedToast('已记录这一轮');
  });
  $('rounds').addEventListener('click', e => {
    const b = e.target.closest('[data-act=del-round]'); const t = task(); if (!b || !t) return;
    const id = b.closest('.round').dataset.id;
    ask('删除这条拷问记录?', () => { t.rounds = t.rounds.filter(r => r.id !== id); renderRounds(); renderData(); $('r-n').value = nextRoundN(t); savedToast('已删除记录'); });
  });

  // 导出 / 导入 / 清空
  $('export-md').addEventListener('click', () => { const t = task(); if (t) download(`核实报告-${(t.date || TODAY)}.md`, C.toMarkdown(t), 'text/markdown;charset=utf-8'); });
  $('export-csv').addEventListener('click', () => download(`断言清单-${TODAY}.csv`, '﻿' + C.toCsv(state.tasks), 'text/csv;charset=utf-8'));
  $('export-json').addEventListener('click', () => download(`答案核实备份-${TODAY}.json`, C.exportJson(state), 'application/json;charset=utf-8'));
  $('import-file').addEventListener('change', async e => {
    const file = e.target.files[0]; e.target.value = ''; const box = $('import-error');
    if (!file) return;
    const v = C.validateImport(await file.text());
    if (!v.ok) { box.textContent = '导入被拒绝,没有改动任何数据。原因:' + v.errors.slice(0, 6).join(';') + (v.errors.length > 6 ? `;另有 ${v.errors.length - 6} 条` : ''); box.hidden = false; return; }
    box.hidden = true;
    const run = () => applyState({ tasks: v.tasks, currentId: v.currentId }, `已导入 ${v.tasks.length} 个任务`);
    if (state.tasks.length) ask(`导入会替换当前全部 ${state.tasks.length} 个任务。确认替换?`, run); else run();
  });
  $('clear-all').addEventListener('click', () => ask('清空全部任务与断言?不可撤销。建议先导出 JSON 备份。', () => { state = { tasks: [], currentId: null }; renderAll(); savedToast('已清空'); }));

  window.addEventListener('pagehide', flushSave);
  load(); renderAll();
})();
