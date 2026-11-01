'use strict';
(function () {
  const C = globalThis.CsvCheckCore;
  const KEY = 'csvcheck.v1';
  const PREVIEW_ROWS = 500;
  const ISSUE_CAP = 300;
  const BIG_FILE = 5 * 1024 * 1024;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clip = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);

  const state = {
    sourceText: null, // 最近一次预检所用的原文;null 表示还没有预检过
    parsed: null,
    result: null,
    applied: null, // {changed, removedRows}:已应用的安全修复
    filter: 'all',
    previewLimit: PREVIEW_ROWS,
    showAllIssues: false,
    highlight: null, // {index, colIndex}
  };
  const input = $('csv-input');
  const isStale = () => state.result !== null && input.value !== state.sourceText;
  const sample = () => globalThis.CSVCHECK_SAMPLE;
  // 输入框内容就是合成示例时,持续标注(刷新后仍然成立;改动输入或清空后消失)
  const isSample = () => input.value !== '' && input.value === sample().csv;
  const sampleOpts = () => ({ sample: isSample() });
  const sampleSuffix = () => (isSample() ? '-合成示例' : '');
  function renderSampleBadge() { $('sample-badge').hidden = !isSample(); }

  // ---------- 存储 ----------
  // 返回是否真正写入。失败时「未保存」横幅持续可见,成功后才显示「已保存」。
  function save() {
    try {
      if (input.value === '') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, JSON.stringify({ v: 1, text: input.value }));
      $('save-warn').hidden = true;
      $('save-state').textContent = input.value === '' ? '' : '原始输入已保存到本机浏览器(未上传);安全修复的结果不会保存';
      return true;
    } catch (e) {
      $('save-warn').hidden = false;
      $('save-state').textContent = '';
      return false;
    }
  }
  function restore() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return '';
      const data = JSON.parse(raw);
      return data && data.v === 1 && typeof data.text === 'string' ? data.text : '';
    } catch (e) { return ''; }
  }
  let saveTimer = null;

  function download(name, text, type) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(new Blob([text], { type: type || 'text/plain;charset=utf-8' }));
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- 预检流程 ----------
  function runCheck(text) {
    state.sourceText = text;
    clearInputError();
    state.parsed = C.parseCsv(text);
    state.result = C.check(state.parsed);
    state.applied = null;
    state.filter = 'all';
    state.previewLimit = PREVIEW_ROWS;
    state.showAllIssues = false;
    state.highlight = null;
    renderAll();
  }

  function applyFix() {
    if (!state.parsed || isStale()) return;
    const fx = C.safeFix(state.parsed);
    state.parsed = fx.parsed;
    state.result = C.check(state.parsed);
    state.applied = { changed: fx.changed, removedRows: fx.removedRows };
    state.highlight = null;
    renderAll();
  }

  // ---------- 渲染 ----------
  function renderAll() {
    const has = state.result !== null;
    $('result').hidden = !has;
    $('guide').hidden = has;
    if (!has) return;
    renderVerdict(); renderStats(); renderIssues(); renderPreview(); renderFix(); renderExport();
  }

  function renderVerdict() {
    const v = C.verdict(state.result, state.parsed);
    const box = $('verdict');
    box.className = 'verdict verdict-' + (v.kind === 'incomplete' ? 'block' : v.kind);
    const stale = isStale() ? '<p class="verdict-stale"><strong>输入框已修改。</strong>下面仍是上一次预检的结果,请点「开始预检」重新检查;重新检查之前导出和安全修复已停用。</p>' : '';
    box.innerHTML = `<p class="verdict-main">${esc(v.text)}</p><p class="verdict-note">预检通过不保证平台一定能导入成功。</p>${stale}`;
  }

  function renderStats() {
    const s = state.result.stats;
    const items = [['数据行', s.rows, ''], ['商品数', s.products, ''], ['变体数', s.variants, ''], ['阻断', s.blocks, s.blocks ? 'stat-block' : ''], ['警告', s.warns, s.warns ? 'stat-warn' : '']];
    $('stats').innerHTML = items.map(([k, v, cls]) => `<div class="stat ${esc(cls)}"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
    $('stat-notes').innerHTML = ['rows', 'products', 'variants', 'blocks', 'warns'].map(k => `<li>${esc(C.STAT_NOTES[k])}</li>`).join('');
  }

  function renderIssues() {
    const { issues } = state.result;
    const counts = { all: issues.length, block: issues.filter(i => i.level === 'block').length, warn: issues.filter(i => i.level === 'warn').length };
    document.querySelectorAll('[data-filter]').forEach(b => {
      const f = b.dataset.filter;
      b.textContent = `${{ all: '全部', block: '阻断', warn: '警告' }[f]} ${counts[f]}`;
      b.setAttribute('aria-pressed', String(state.filter === f));
    });
    const list = issues.filter(i => state.filter === 'all' || i.level === state.filter);
    const box = $('issue-list');
    if (list.length === 0) { box.innerHTML = '<div class="empty">这一级别下没有问题。</div>'; return; }
    const shown = state.showAllIssues ? list : list.slice(0, ISSUE_CAP);
    const rule = id => C.RULES.find(r => r.id === id);
    box.innerHTML = shown.map((x, n) => {
      const pos = x.col ? `第 ${esc(x.row)} 行 · ${esc(x.col)}` : `第 ${esc(x.row)} 行`;
      const val = x.value === '' ? '' : `<span class="issue-value">${esc(clip(x.value, 80))}</span>`;
      return `<button type="button" class="issue issue-${esc(x.level)}" data-n="${esc(n)}">
        <span class="issue-top"><span class="badge badge-${esc(x.level)}">${esc(C.LEVEL_LABEL[x.level])}</span><span class="issue-pos">${pos}</span></span>
        <span class="issue-title">${esc(rule(x.ruleId).title)}</span>
        <span class="issue-msg">${esc(x.message)}</span>${val}
      </button>`;
    }).join('') + (shown.length < list.length ? `<button type="button" id="show-all-issues" class="link">显示全部 ${esc(list.length)} 条(当前显示 ${esc(shown.length)} 条)</button>` : '');
    box._shown = shown;
  }

  function renderPreview() {
    const { headers, rows } = state.parsed;
    const level = new Map(); // "i:c" -> 级别;c 为 -1 表示整行
    for (const x of state.result.issues) {
      const k = `${x.index}:${x.colIndex}`;
      if (level.get(k) !== 'block') level.set(k, x.level);
    }
    const shownRows = rows.slice(0, state.previewLimit);
    const ncols = Math.max(headers.length, ...shownRows.map(r => r.length), 0);
    if (ncols === 0) { $('preview').innerHTML = '<div class="empty">没有可显示的数据。</div>'; $('preview-note').textContent = ''; return; }
    const cls = k => (level.has(k) ? ' cell-' + level.get(k) : '');
    const head = ['<th scope="col" class="rownum">行</th>'];
    for (let c = 0; c < ncols; c++) head.push(`<th scope="col" data-c="${esc(c)}" class="${esc(cls('-1:' + c).trim())}">${c < headers.length ? esc(headers[c]) : '(无表头)'}</th>`);
    const body = shownRows.map((r, i) => {
      const tds = [`<th scope="row" class="rownum${esc(cls(i + ':-1'))}" data-r="${esc(i)}" data-c="-1">${esc(i + 2)}</th>`];
      for (let c = 0; c < ncols; c++) {
        const v = c < r.length ? r[c] : '';
        tds.push(`<td data-r="${esc(i)}" data-c="${esc(c)}" class="${esc(cls(i + ':' + c).trim())}" title="${esc(v)}">${esc(v)}</td>`);
      }
      return `<tr>${tds.join('')}</tr>`;
    }).join('');
    $('preview').innerHTML = `<table><thead><tr>${head.join('')}</tr></thead><tbody>${body}</tbody></table>`; // head/body 里每个单元格都已转义
    $('preview-note').textContent = rows.length > shownRows.length ? `只显示前 ${shownRows.length} 行,共 ${rows.length} 行;点问题会自动展开到对应行。` : `共 ${rows.length} 行,行号以表头为第 1 行。`;
    applyHighlight();
  }

  function applyHighlight() {
    document.querySelectorAll('.focus-cell').forEach(e => e.classList.remove('focus-cell'));
    const h = state.highlight;
    if (!h) return;
    const sel = h.index < 0 ? `th[data-c="${Number(h.colIndex)}"]` : `[data-r="${Number(h.index)}"][data-c="${Number(h.colIndex)}"]`;
    const el = document.querySelector('#preview ' + sel);
    if (!el) return;
    el.classList.add('focus-cell');
    el.scrollIntoView({ block: 'center', inline: 'center' });
  }

  function locate(issue) {
    if (issue.index >= state.previewLimit) { state.previewLimit = issue.index + PREVIEW_ROWS; }
    state.highlight = { index: issue.index, colIndex: issue.colIndex };
    renderPreview();
  }

  function renderFix() {
    const stale = isStale();
    const fx = C.safeFix(state.parsed);
    const total = fx.changed + fx.removedRows;
    $('fix-summary').textContent = total === 0 ? '当前数据没有可以安全修复的内容。' : `将改动 ${fx.changed} 个单元格,删除 ${fx.removedRows} 个空行。`;
    $('apply-fix').disabled = stale || total === 0;
    $('fix-unsaved').hidden = !state.applied;
    $('fix-applied').textContent = state.applied ? `已应用:改动了 ${state.applied.changed} 个单元格,删除了 ${state.applied.removedRows} 个空行。预览与导出现在使用修复后的数据,输入框里仍是原文。` : '';
  }

  function renderExport() {
    const stale = isStale();
    const hasParseError = state.parsed.errors.length > 0;
    const noHeaders = state.parsed.headers.length === 0;
    const note = $('export-note');
    let msg = '导出内容与上方预览一致。';
    if (stale) msg = '输入框已修改但还没有重新预检,为避免导出和界面不一致,导出已停用。请先点「开始预检」。';
    else if (hasParseError) msg = '文件有无法解析的行(引号问题),修复后的 CSV 会丢失这些行,所以只能导出问题清单。';
    note.textContent = msg;
    $('export-csv').disabled = stale || hasParseError || noHeaders;
    $('export-issues-csv').disabled = stale;
    $('export-issues-md').disabled = stale;
    $('md-preview').textContent = stale ? '' : C.issuesToMarkdown(state.result.issues, state.result.stats, mdOpts());
  }

  const mdOpts = () => ({ sample: isSample(), parseErrors: state.parsed ? state.parsed.errors.length : 0 });

  // ---------- 事件 ----------
  function setStatus(msg, isError) { const n = $('input-status'); n.textContent = msg; n.classList.toggle('field-error', !!isError); }
  function clearInputError() { input.removeAttribute('aria-invalid'); $('input-status').classList.remove('field-error'); }

  $('run-check').onclick = () => {
    if (input.value.trim() === '') {
      setStatus('输入框是空的:请粘贴 CSV 内容、选择文件,或点右上角「载入合成示例」。', true);
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    runCheck(input.value);
    save();
    setStatus(`已预检 ${state.result.stats.rows} 行数据。`);
  };

  input.addEventListener('input', () => {
    clearInputError();
    renderSampleBadge();
    if (state.result !== null) { renderVerdict(); renderFix(); renderExport(); }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 600);
  });

  // 合法文件也要先确认:输入框里已有别的内容(或已应用安全修复)时,替换前页内确认
  let pendingFile = null;
  function applyFile(file, text) {
    pendingFile = null;
    $('confirm-file').hidden = true;
    input.value = text;
    runCheck(input.value);
    renderSampleBadge();
    const big = file.size > BIG_FILE ? '。文件超过 5MB,界面可能变慢' : '';
    setStatus(`已读取「${file.name}」(${Math.ceil(file.size / 1024)} KB),预检 ${state.result.stats.rows} 行数据${big}。`);
    save();
  }
  $('file-input').onchange = e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      /* 空文件、乱码文件先拒绝:不覆盖输入框和本机已保存的内容 */
      const chk = C.checkTextFile(text);
      if (!chk.ok) { setStatus(`没有读入「${file.name}」:${chk.message}输入框里的内容没有改动。`, true); return; }
      if (!state.applied && (input.value.trim() === '' || input.value === text)) { applyFile(file, text); return; }
      pendingFile = { file, text };
      const lines = input.value === '' ? 0 : input.value.split(/\r?\n/).length;
      $('confirm-file-text').textContent = `读入「${file.name}」会替换输入框里的 ${input.value.length} 个字符(约 ${lines} 行)和当前预检结果` +
        (state.applied ? `,以及已应用的安全修复结果(改动了 ${state.applied.changed} 个单元格、删除了 ${state.applied.removedRows} 个空行;它只在内存里,替换后无法找回,请先下载修复后的 CSV)` : '') + '。确定吗?';
      $('confirm-sample').hidden = true;
      $('confirm-file').hidden = false;
      $('file-no').focus();
    };
    reader.onerror = () => { setStatus(`读取「${file.name}」失败,请确认它是文本格式的 CSV。`, true); input.focus(); };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };

  // 有输入或已应用的安全修复时,载入示例前先页内确认(修复结果只在内存里,替换后找不回)
  function doLoadSample() {
    $('confirm-sample').hidden = true;
    input.value = sample().csv;
    runCheck(input.value);
    save();
    renderSampleBadge();
    setStatus(`已载入${sample().note},共 ${state.result.stats.rows} 行数据。`);
  }
  $('load-sample').onclick = () => {
    const hasText = input.value.trim() !== '';
    if (!hasText && !state.applied) { doLoadSample(); return; }
    if (input.value === sample().csv && !state.applied) { doLoadSample(); return; }
    const lines = input.value === '' ? 0 : input.value.split(/\r?\n/).length;
    $('confirm-sample-text').textContent = `载入合成示例会替换输入框里的 ${input.value.length} 个字符(约 ${lines} 行)和当前预检结果` +
      (state.applied ? `,以及已应用的安全修复结果(改动了 ${state.applied.changed} 个单元格、删除了 ${state.applied.removedRows} 个空行;它只在内存里,替换后无法找回,请先下载修复后的 CSV)` : '') + '。确定吗?';
    $('confirm-file').hidden = true; pendingFile = null;
    $('confirm-sample').hidden = false;
    $('sample-no').focus();
  };
  $('sample-no').onclick = () => { $('confirm-sample').hidden = true; $('load-sample').focus(); };
  $('file-no').onclick = () => {
    pendingFile = null;
    $('confirm-file').hidden = true;
    setStatus('没有读入文件,输入框里的内容没有改动。');
    $('file-input').focus();
  };
  $('file-yes').onclick = () => { if (pendingFile) applyFile(pendingFile.file, pendingFile.text); };
  $('sample-yes').onclick = doLoadSample;

  $('clear-all').onclick = () => {
    const parts = [];
    if (input.value !== '') parts.push(`输入框里的 ${input.value.length} 个字符`);
    if (state.result) parts.push('当前预检结果');
    if (state.applied) parts.push('已应用的安全修复结果(只在内存里,无法找回)');
    parts.push('本机浏览器里保存的原始输入');
    $('confirm-clear-text').textContent = `将删除:${parts.join('、')}。无法恢复。`;
    $('confirm-clear').hidden = false; $('confirm-yes').focus();
  };
  $('confirm-no').onclick = () => { $('confirm-clear').hidden = true; $('clear-all').focus(); };
  $('confirm-yes').onclick = () => {
    input.value = '';
    state.sourceText = null; state.parsed = null; state.result = null; state.applied = null;
    $('confirm-clear').hidden = true;
    $('confirm-sample').hidden = true;
    $('confirm-file').hidden = true; pendingFile = null;
    clearInputError();
    renderSampleBadge();
    renderAll();
    save();
    setStatus('已清空。');
    input.focus();
  };

  document.addEventListener('click', e => {
    const f = e.target.closest('[data-filter]');
    if (f) { state.filter = f.dataset.filter; state.showAllIssues = false; renderIssues(); return; }
    if (e.target.id === 'show-all-issues') {
      state.showAllIssues = true; renderIssues();
      const next = $('issue-list').querySelectorAll('.issue')[ISSUE_CAP];
      if (next) next.focus();
      return;
    }
    const b = e.target.closest('.issue');
    if (b) { const shown = $('issue-list')._shown; if (shown) locate(shown[Number(b.dataset.n)]); }
  });

  $('apply-fix').onclick = applyFix;
  $('export-csv').onclick = () => { if (!isStale()) download('shopify-products-checked' + sampleSuffix() + '.csv', C.toCsv(state.parsed), 'text/csv;charset=utf-8'); };
  $('export-issues-csv').onclick = () => { if (!isStale()) download('precheck-issues' + sampleSuffix() + '.csv', '\uFEFF' + C.issuesToCsv(state.result.issues, sampleOpts()), 'text/csv;charset=utf-8'); };
  $('export-issues-md').onclick = () => { if (!isStale()) download('precheck-issues' + sampleSuffix() + '.md', C.issuesToMarkdown(state.result.issues, state.result.stats, mdOpts()), 'text/markdown;charset=utf-8'); };

  // ---------- 启动 ----------
  const saved = restore();
  if (saved) { input.value = saved; runCheck(saved); $('save-state').textContent = '已从本机浏览器恢复上次的输入'; setStatus(`已恢复上次的输入并预检 ${state.result.stats.rows} 行数据。`); }
  renderSampleBadge();
  renderAll();
})();
