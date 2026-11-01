'use strict';

(function start() {
  const core = globalThis.DecisionReviewCore;
  const byId = (id) => document.getElementById(id);
  const todayParam = new URLSearchParams(location.search).get('today') || '';
  const parsedToday = new Date(`${todayParam}T00:00:00Z`);
  const validToday = /^\d{4}-\d{2}-\d{2}$/.test(todayParam) && !Number.isNaN(parsedToday.valueOf()) && parsedToday.toISOString().slice(0, 10) === todayParam;
  const today = validToday ? todayParam : core.calendarDay(new Date().toISOString());
  let state = core.emptyState();
  let filter = 'all';
  let editingId = null;
  let pending = null;
  let pendingImport = null;
  let storageFailed = false;

  const form = byId('decisionForm');
  const fieldIds = ['title', 'question', 'probability', 'dueDate', 'reasons', 'evidence'];
  const statusLabels = { open: '未到期', overdue: '到期未复查', resolved: '已复查' };

  function el(tag, options = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(options).forEach(([key, value]) => {
      if (key === 'className') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('data-')) node.setAttribute(key, value);
      else node[key] = value;
    });
    children.forEach((child) => node.append(child));
    return node;
  }

  function randomSuffix() {
    if (globalThis.crypto && crypto.getRandomValues) return Array.from(crypto.getRandomValues(new Uint16Array(2))).map((n) => n.toString(16)).join('');
    return Math.random().toString(16).slice(2, 10);
  }

  function isDraftDirty() {
    return editingId !== null || fieldIds.some((id) => byId(id).value.trim() !== '');
  }

  function hasUserData() {
    return state.decisions.length > 0 || state.legacyNotes.length > 0 || isDraftDirty();
  }

  function setStatus(message, failed = false) {
    byId('storageStatus').textContent = message;
    byId('storageStatus').classList.toggle('field-error', failed);
  }

  function persist(message = '已保存到此浏览器。') {
    try {
      localStorage.setItem(core.STORAGE_KEY, JSON.stringify(state));
      storageFailed = false;
      setStatus(message);
      return true;
    } catch (_) {
      storageFailed = true;
      setStatus('本地保存失败。已提交的当前内存记录仍可导出；表单草稿必须先保存或取消，刷新页面可能丢失本次改动。', true);
      return false;
    } finally {
      updateExportState();
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(core.STORAGE_KEY);
      if (raw) {
        const parsed = core.parseBackup(raw, today, new Date().toISOString());
        if (!parsed.ok) throw new Error(parsed.error);
        state = parsed.value;
        setStatus('已恢复此浏览器保存的记录。');
      } else setStatus('尚无本机记录。');
    } catch (error) {
      storageFailed = true;
      setStatus(`无法读取已保存数据：${error.message}。当前从空白状态开始。`, true);
    }
    detectLegacy();
    render();
  }

  function detectLegacy() {
    try {
      const raw = localStorage.getItem(core.LEGACY_KEY);
      const parsed = raw ? core.parseLegacy(raw, new Date().toISOString(), randomSuffix()) : null;
      byId('legacyPanel').hidden = !(parsed && parsed.ok);
      if (parsed && parsed.ok) byId('legacyPanel').dataset.note = JSON.stringify(parsed.value);
    } catch (_) {
      byId('legacyPanel').hidden = true;
    }
  }

  function updateExportState() {
    const blocked = isDraftDirty();
    byId('exportJson').disabled = blocked;
    byId('exportMarkdown').disabled = blocked;
    byId('exportJson').title = blocked ? '请先保存或取消表单草稿。' : '';
    byId('exportMarkdown').title = blocked ? '请先保存或取消表单草稿。' : '';
    if (storageFailed) byId('exportJson').textContent = '导出已提交的当前内存记录 JSON';
    else byId('exportJson').textContent = '导出全部数据 JSON';
  }

  function renderMetrics() {
    const overdue = state.decisions.filter((item) => core.statusOf(item, today) === 'overdue').length;
    const resolved = state.decisions.filter((item) => item.review).length;
    const stats = core.calibration(state.decisions);
    byId('totalMetric').textContent = String(state.decisions.length);
    byId('dueMetric').textContent = String(overdue);
    byId('resolvedMetric').textContent = String(resolved);
    byId('brierMetric').textContent = stats.brier === null ? '—' : stats.brier.toFixed(3);
    byId('brierHelp').textContent = stats.count ? `分母：${stats.count} 条已复查的用户记录；合成示例排除；使用最后一个事前预测版本` : '无已复查的用户记录；合成示例不进入统计';
  }

  function renderDecision(item) {
    const forecast = core.activeForecast(item);
    const status = core.statusOf(item, today);
    const card = el('article', { className: 'decision-card' });
    const heading = el('div', {}, [el('h3', { text: item.title }), el('p', { text: item.question })]);
    const badge = el('strong', { className: `status-${status}`, text: statusLabels[status] });
    card.append(el('header', {}, [heading, badge]));
    const dl = el('dl');
    [['编号', item.id], ['来源', item.origin === 'synthetic' ? '合成示例（不进入真实校准）' : '用户录入'], ['事前概率', `${forecast.probability}%`], ['复查日期', forecast.dueDate], ['预测版本', `${item.forecastVersions.length} 个（旧版本保留）`], ['当时理由', forecast.reasons], ['事前证据', forecast.evidence || '未填写']].forEach(([term, description]) => dl.append(el('dt', { text: term }), el('dd', { text: description })));
    if (item.review) {
      dl.append(el('dt', { text: '实际结果' }), el('dd', { text: item.review.outcome === 1 ? '发生' : '未发生' }), el('dt', { text: '自报复查日期' }), el('dd', { text: item.review.reviewedOn }), el('dt', { text: '复查写入时间' }), el('dd', { text: item.review.reviewedAt }), el('dt', { text: '复查结论' }), el('dd', { text: item.review.summary }), el('dt', { text: '偏差分类' }), el('dd', { text: item.review.bias }), el('dt', { text: '下一次检验' }), el('dd', { text: item.review.nextTest || '未填写' }));
    }
    card.append(dl);
    const buttons = el('div', { className: 'button-row' });
    if (!item.review) {
      const revise = el('button', { type: 'button', className: 'button-secondary', text: '修订事前预测' }); revise.addEventListener('click', () => beginRevision(item));
      const review = el('button', { type: 'button', text: '追加实际结果' }); review.addEventListener('click', () => openReview(card, item));
      buttons.append(revise, review);
    }
    const remove = el('button', { type: 'button', className: 'button-danger', text: '删除这条决策' }); remove.addEventListener('click', () => showDeleteConfirm(card, item));
    buttons.append(remove); card.append(buttons); return card;
  }

  function renderList() {
    const list = byId('decisionList'); list.replaceChildren();
    const visible = core.filterDecisions(state.decisions, filter, today);
    visible.forEach((item) => list.append(renderDecision(item)));
    byId('emptyState').hidden = visible.length > 0;
    byId('queueSummary').textContent = `当前显示 ${visible.length} 条；共 ${state.decisions.length} 条。`;
  }

  function renderLegacy() {
    const list = byId('legacyList'); list.replaceChildren();
    state.legacyNotes.forEach((note) => list.append(el('article', { className: 'legacy-note' }, [el('h3', { text: `旧版原文 · ${note.importedAt.slice(0, 10)}` }), el('strong', { text: '事前原文' }), el('pre', { text: note.before || '空白' }), el('strong', { text: '事后原文' }), el('pre', { text: note.after || '空白' })])));
  }

  function render() {
    byId('todayBadge').textContent = validToday ? `基准日 ${today}（由地址参数固定；日历口径 Asia/Shanghai）` : `基准日 ${today}（日历口径 Asia/Shanghai）`;
    byId('sampleBadge').hidden = !state.isSample;
    renderMetrics(); renderList(); renderLegacy(); updateExportState();
  }

  function clearErrors() {
    fieldIds.forEach((id) => { byId(id).setAttribute('aria-invalid', 'false'); byId(`${id}Error`).textContent = ''; });
  }

  function showFormError(id, message) {
    byId(id).setAttribute('aria-invalid', 'true'); byId(`${id}Error`).textContent = message;
  }

  function formInput() {
    return Object.fromEntries(fieldIds.map((id) => [id, byId(id).value]));
  }

  function resetForm() {
    form.reset(); editingId = null; byId('cancelEdit').hidden = true; byId('newTitle').textContent = '记录事前预测'; byId('title').disabled = false; byId('question').disabled = false; clearErrors(); updateExportState();
  }

  function validateAndFocus(result) {
    if (result.ok) return true;
    const message = result.error;
    const map = message.includes('概率') ? 'probability' : message.includes('日期') ? 'dueDate' : message.includes('标题') ? 'title' : message.includes('问题') ? 'question' : message.includes('证据') ? 'evidence' : 'reasons';
    showFormError(map, message); byId(map).focus(); return false;
  }

  function beginRevision(item) {
    const forecast = core.activeForecast(item); editingId = item.id;
    byId('title').value = item.title; byId('question').value = item.question; byId('probability').value = forecast.probability; byId('dueDate').value = forecast.dueDate; byId('reasons').value = forecast.reasons; byId('evidence').value = forecast.evidence;
    byId('title').disabled = true; byId('question').disabled = true; byId('cancelEdit').hidden = false; byId('newTitle').textContent = '修订事前预测'; byId('probability').focus(); updateExportState();
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault(); clearErrors(); const input = formInput(); const now = new Date().toISOString();
    if (editingId) {
      const index = state.decisions.findIndex((item) => item.id === editingId); const result = core.reviseForecast(state.decisions[index], input, now);
      if (!validateAndFocus(result)) return; state.decisions[index] = result.value;
    } else {
      const result = core.createDecision(input, now, randomSuffix()); if (!validateAndFocus(result)) return; state.decisions.unshift(result.value);
    }
    state.isSample = state.decisions.some((item) => item.origin === 'synthetic'); resetForm(); persist('事前预测已保存。'); render();
  });
  fieldIds.forEach((id) => byId(id).addEventListener('input', updateExportState));
  byId('cancelEdit').addEventListener('click', resetForm);

  function openReview(card, item) {
    card.querySelector('.review-form')?.remove();
    const fragment = byId('reviewTemplate').content.cloneNode(true); const reviewForm = fragment.querySelector('form');
    const bias = reviewForm.elements.bias; core.BIASES.forEach((value) => bias.append(el('option', { value, text: value })));
    reviewForm.elements.reviewedOn.value = today;
    reviewForm.addEventListener('submit', (event) => {
      event.preventDefault(); const data = Object.fromEntries(new FormData(reviewForm)); const result = core.resolveDecision(item, data, today, new Date().toISOString());
      if (!result.ok) { reviewForm.querySelector('.form-error').textContent = result.error; reviewForm.querySelector('select, input, textarea').focus(); return; }
      const index = state.decisions.findIndex((candidate) => candidate.id === item.id); state.decisions[index] = result.value; state.isSample = state.decisions.some((candidate) => candidate.origin === 'synthetic'); persist('实际结果已追加。'); render();
    });
    reviewForm.querySelector('[data-cancel-review]').addEventListener('click', () => reviewForm.remove());
    card.append(fragment); reviewForm.elements.outcome.focus();
  }

  function showDeleteConfirm(card, item) {
    card.querySelector('.confirm-box')?.remove();
    const box = el('div', { className: 'confirm-box' }, [el('p', { text: `将删除“${item.title}”以及全部预测版本和实际结果。此操作只在点击确认后发生。` })]);
    const confirm = el('button', { type: 'button', className: 'button-danger', text: '确认删除这条决策' });
    const cancel = el('button', { type: 'button', className: 'button-secondary', text: '取消删除' });
    confirm.addEventListener('click', () => { state.decisions = state.decisions.filter((candidate) => candidate.id !== item.id); state.isSample = state.decisions.some((candidate) => candidate.origin === 'synthetic'); persist('决策已删除。'); render(); });
    cancel.addEventListener('click', () => { box.remove(); card.querySelector('.button-danger')?.focus(); });
    box.append(el('div', { className: 'button-row' }, [confirm, cancel])); card.append(box); confirm.focus();
  }

  document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    filter = button.dataset.filter; document.querySelectorAll('[data-filter]').forEach((candidate) => candidate.setAttribute('aria-pressed', String(candidate === button))); renderList();
  }));

  function requestAction(kind, message, action, confirmText) {
    pending = action; byId('pendingMessage').textContent = message; byId('confirmAction').textContent = confirmText; byId('pendingAction').hidden = false; byId('confirmAction').focus(); byId('pendingAction').dataset.kind = kind;
  }
  function closePending() { pending = null; pendingImport = null; byId('pendingAction').hidden = true; }
  byId('confirmAction').addEventListener('click', () => { if (pending) pending(); closePending(); });
  byId('cancelAction').addEventListener('click', () => { closePending(); byId('loadSample').focus(); });

  byId('loadSample').addEventListener('click', () => {
    const apply = () => { state = JSON.parse(JSON.stringify(globalThis.DECISION_REVIEW_SAMPLE)); resetForm(); persist('已载入合成示例。'); render(); };
    if (hasUserData()) requestAction('sample', `将替换 ${state.decisions.length} 条决策、${state.legacyNotes.length} 条旧版原文以及当前表单草稿。`, apply, '确认载入合成示例'); else apply();
  });
  byId('clearAll').addEventListener('click', () => {
    if (!hasUserData()) { setStatus('当前没有可清空的数据。'); return; }
    requestAction('clear', `将清空 ${state.decisions.length} 条决策、${state.legacyNotes.length} 条旧版原文以及当前表单草稿。`, () => { state = core.emptyState(); resetForm(); persist('已清空本工具的本机数据。'); render(); }, '确认清空全部数据');
  });

  byId('importTrigger').addEventListener('click', () => byId('importFile').click());
  byId('importFile').addEventListener('change', async () => {
    const file = byId('importFile').files[0]; byId('importFile').value = ''; if (!file) return;
    const parsed = core.parseBackup(await file.text(), today, new Date().toISOString());
    if (!parsed.ok) { setStatus(`导入检查失败，现有数据未改变：${parsed.error}`, true); return; }
    pendingImport = parsed.value;
    requestAction('import', `校验通过：${pendingImport.decisions.length} 条决策、${pendingImport.legacyNotes.length} 条旧版原文。确认后才替换当前 ${state.decisions.length} 条决策和表单草稿。`, () => { state = pendingImport; resetForm(); persist('JSON 备份已导入。'); render(); }, '确认导入并替换');
  });

  function download(filename, type, content) {
    const link = document.createElement('a'); const url = URL.createObjectURL(new Blob([content], { type })); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  byId('exportJson').addEventListener('click', () => download(`decision-review-${today}.json`, 'application/json', JSON.stringify(state, null, 2)));
  byId('exportMarkdown').addEventListener('click', () => download(`decision-review-${today}.md`, 'text/markdown', core.exportMarkdown(state)));

  byId('migrateLegacy').addEventListener('click', () => {
    const note = JSON.parse(byId('legacyPanel').dataset.note); if (state.legacyNotes.some((item) => item.before === note.before && item.after === note.after)) { setStatus('同一份旧版原文已经导入。'); return; }
    state.legacyNotes.push(note); state.isSample = state.decisions.some((item) => item.origin === 'synthetic'); persist('旧版原文已导入；未生成概率或实际结果。'); byId('legacyPanel').hidden = true; render();
  });
  byId('dismissLegacy').addEventListener('click', () => { byId('legacyPanel').hidden = true; });

  load();
})();
