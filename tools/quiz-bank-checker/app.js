'use strict';
(function () {
  const C = globalThis.QbCore;
  const KEY = 'qbcheck.v1';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const letter = i => String.fromCharCode(65 + i);

  let state = { bank: [], shuffled: null, view: 'original', sample: false };
  let parsedCsv = null;
  let parsedSample = false; /* 解析的文本末尾是否带「合成示例数据」标注行 */
  let pendingImport = null;
  let pendingExport = null;
  const DEFAULT_SEED = '期中';
  let toastTimer = null;

  const current = () => (state.view === 'shuffled' && state.shuffled ? state.shuffled.questions : state.bank);

  // ---------- 存储 ----------
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      const v = C.validateStored(obj);
      if (v.ok) state = { bank: obj.bank, shuffled: obj.shuffled || null, view: obj.view || 'original', sample: obj.sample === true };
      else showToast('本地保存的数据格式不合法,已忽略:' + v.errors[0]);
    } catch (e) { /* 存储不可用或损坏:从空开始 */ }
  }
  // 返回是否真正写入。失败时「未保存」提示持续可见,直到之后某次写入成功。
  function save() {
    const alertEl = $('save-alert');
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      alertEl.hidden = true;
      return true;
    } catch (e) {
      alertEl.textContent = '未保存:浏览器存储不可用或已满。当前改动只在这个页面的内存里,刷新会丢失。请立刻点右侧「导出原题库 CSV」备份题库（导出的是当前内存里的全部题目）。';
      alertEl.hidden = false;
      return false;
    }
  }
  function showToast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
  }
  function download(name, text, type) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(new Blob(['﻿' + text], { type: type || 'text/plain;charset=utf-8' }));
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- 导入 ----------
  function showImportErrors(list) {
    const ul = $('import-errors');
    ul.innerHTML = list.map(e => `<li>${esc(e)}</li>`).join('');
    ul.hidden = !list.length;
  }
  function colOptions(headers, withNone) {
    return (withNone ? '<option value="-1">(不使用)</option>' : '') + headers.map((h, i) => `<option value="${i}">${esc(`第 ${i + 1} 列:${h || '(空列名)'}`)}</option>`).join('');
  }
  function fillMapping(parsed) {
    const m = C.autoMapping(parsed.headers);
    $('map-id').innerHTML = colOptions(parsed.headers, true);
    $('map-stem').innerHTML = colOptions(parsed.headers, false);
    $('map-answer').innerHTML = colOptions(parsed.headers, true);
    $('map-topic').innerHTML = colOptions(parsed.headers, true);
    $('map-difficulty').innerHTML = colOptions(parsed.headers, true);
    $('map-id').value = String(m.id); $('map-answer').value = String(m.answer);
    $('map-topic').value = String(m.topic); $('map-difficulty').value = String(m.difficulty);
    if (m.stem >= 0) $('map-stem').value = String(m.stem);
    $('map-options').innerHTML = parsed.headers.map((h, i) =>
      `<label><input type="checkbox" name="opt" value="${i}" ${m.options.includes(i) ? 'checked' : ''}> ${esc(h || '第 ' + (i + 1) + ' 列')}</label>`).join('');
    $('mapping').hidden = false;
  }
  function readMapping() {
    return {
      id: Number($('map-id').value), stem: Number($('map-stem').value), answer: Number($('map-answer').value),
      topic: Number($('map-topic').value), difficulty: Number($('map-difficulty').value),
      options: Array.from(document.querySelectorAll('#map-options input:checked')).map(x => Number(x.value))
    };
  }
  /* 解析成功后先预览，确认后才写入；任何一处解析错误整份拒绝 */
  function stageImport(result, sample) {
    if (result.errors.length) { showImportErrors(result.errors); hidePreview(); $('import-text').focus(); return; }
    showImportErrors([]);
    pendingImport = { questions: result.questions, sample: !!sample };
    $('import-preview-text').textContent = C.importPreview(state, result.questions).text;
    $('import-preview').hidden = false;
    $('import-confirm-no').focus();
  }
  function hidePreview() { pendingImport = null; $('import-preview').hidden = true; }
  function commitImport(questions, sample) {
    showImportErrors([]);
    hidePreview();
    state = { bank: questions, shuffled: null, view: 'original', sample: !!sample };
    $('mapping').hidden = true; parsedCsv = null;
    $('import-details').open = false;
    render();
    if (save()) showToast(`已导入 ${state.bank.length} 题并保存在本机。`);
  }
  function onParse() {
    const text = $('import-text').value;
    const fmt = document.querySelector('input[name=fmt]:checked').value;
    hidePreview();
    if (!text.trim()) { showImportErrors(['还没有粘贴内容。']); $('mapping').hidden = true; $('import-text').focus(); return; }
    if (fmt === 'text') { $('mapping').hidden = true; stageImport(C.parseTextBank(text)); return; }
    /* 示例题库导出的 CSV 末尾带一行「合成示例数据」标注:去掉它(不当成题目),并把导入结果记为示例 */
    const note = C.splitSampleNote(text);
    const parsed = C.parseDelimited(note.text);
    if (parsed.error) { showImportErrors([parsed.error]); $('mapping').hidden = true; parsedCsv = null; $('import-text').focus(); return; }
    if (!parsed.headers.length || !parsed.rows.length) { showImportErrors(['需要第一行列名,以及至少一行数据。']); $('mapping').hidden = true; return; }
    parsedCsv = parsed; parsedSample = note.sample; showImportErrors([]); fillMapping(parsed);
  }
  function onImport() {
    if (!parsedCsv) { showImportErrors(['输入内容已变化,请先重新点「解析」。']); $('mapping').hidden = true; return; }
    stageImport(C.parseCsvBank(parsedCsv, readMapping()), parsedSample);
  }

  // ---------- 渲染 ----------
  function render() {
    const qs = current();
    const hasBank = state.bank.length > 0;
    $('empty').hidden = hasBank;
    $('cards').hidden = !hasBank;
    $('view-switch').hidden = !state.shuffled;
    $('sample-badge').hidden = !(state.sample && hasBank);
    $('view-original').setAttribute('aria-pressed', String(state.view === 'original'));
    $('view-shuffled').setAttribute('aria-pressed', String(state.view === 'shuffled'));
    const { issues, stats } = C.check(qs);
    renderCards(qs, issues);
    renderStats(stats, issues, hasBank);
    renderIssues(issues, hasBank);
    for (const id of ['export-issues-md', 'export-issues-csv', 'export-exam', 'export-bank-csv', 'shuffle-btn']) $(id).disabled = !hasBank;
    $('export-summary').textContent = hasBank ? C.issueSummary(issues).text : '';
    $('export-shuffled-csv').disabled = !state.shuffled;
    $('export-version').textContent = hasBank
      ? `当前查看与导出的版本:${state.view === 'shuffled' && state.shuffled ? `打乱后(种子「${state.shuffled.seed}」)` : '原题库'}。`
      : '导入题库后才能导出。';
    $('shuffle-note').textContent = hasBank ? '' : '导入题库后可用。';
  }

  function renderCards(qs, issues) {
    const by = new Map();
    issues.forEach(it => { if (it.qIndex >= 0) { if (!by.has(it.qIndex)) by.set(it.qIndex, []); by.get(it.qIndex).push(it); } });
    const only = $('only-issues').checked;
    const html = qs.map((q, i) => {
      const list = by.get(i) || [];
      if (only && !list.length) return '';
      const cls = list.some(x => x.level === 'block') ? 'card--block' : list.length ? 'card--warn' : '';
      const ai = C.answerIndex(q);
      const opts = q.options.map((o, k) => `<li class="opt${k === ai ? ' opt--answer' : ''}"><span class="opt__k">${letter(k)}</span><span>${esc(o) || '(空)'}${k === ai ? ' (答案)' : ''}</span></li>`).join('');
      const status = list.some(x => x.level === 'block') ? '<span class="tag tag--block">阻断</span>' : list.length ? '<span class="tag tag--warn">警告</span>' : '<span class="tag tag--ok">通过</span>';
      const iss = list.map(x => `<li><span class="tag tag--${esc(x.level)}">${esc(C.LEVEL_LABEL[x.level])}</span> ${esc(x.message)}</li>`).join('');
      return `<li id="card-${i}" class="card ${cls}">
        <div class="card__head"><span class="card__no">第 ${i + 1} 题 · 题号 ${esc(q.id) || '(空)'}</span>${status}</div>
        <p class="card__stem">${esc(q.stem) || '(题干为空)'}</p>
        <ul class="opts">${opts}</ul>
        <div class="card__meta"><span>答案:${esc(q.answer) || '(空)'}</span><span>知识点:${esc(q.topic) || '(空)'}</span><span>难度:${esc(q.difficulty) || '(空)'}</span></div>
        ${iss ? `<ul class="card__issues">${iss}</ul>` : ''}
      </li>`;
    }).join('');
    $('cards').innerHTML = html || (qs.length ? '<li class="empty">没有带问题的题。</li>' : '');
  }

  function renderStats(stats, issues, hasBank) {
    const el = $('stats');
    if (!hasBank) { el.innerHTML = '<p class="hint">导入题库后显示题数、答案字母、知识点与难度分布。</p>'; return; }
    const skew = new Set(issues.filter(i => i.code === 'letter-skew').map(i => i.message.charAt(5)));
    const dist = stats.letters.map(l => `<div class="dist__row${skew.has(l.letter) ? ' dist__row--skew' : ''}"><strong>${esc(l.letter)}</strong><span class="dist__bar"><i style="--ratio:${l.ratio.toFixed(3)}"></i></span><span>${l.count} 题 · ${Math.round(l.ratio * 100)}%</span></div>`).join('');
    const kv = arr => arr.map(t => `<div class="kv__row"><span>${esc(t.name)}</span><strong>${Number(t.count)}</strong></div>`).join('');
    el.innerHTML = `<p><strong>${Number(stats.total)}</strong> 题,其中 ${Number(stats.validAnswerCount)} 题答案有效。</p>
      <h3>答案字母分布</h3><div class="dist">${dist}</div>
      <h3>知识点题数</h3><div class="kv">${kv(stats.topics)}</div>
      <h3>难度分布</h3><div class="kv">${kv(stats.difficulties)}</div>`;
  }

  function renderIssues(issues, hasBank) {
    const el = $('issues');
    $('issue-count').textContent = hasBank ? String(issues.length) : '';
    if (!hasBank) { el.innerHTML = '<p class="hint">没有题库,无可检查内容。</p>'; return; }
    if (!issues.length) { el.innerHTML = '<p class="ok-note">没有发现问题。</p>'; return; }
    const group = (level) => {
      const list = issues.filter(i => i.level === level);
      if (!list.length) return '';
      const items = list.map(it => it.qIndex >= 0
        ? `<li><button type="button" data-goto="${Number(it.qIndex)}"><strong>第 ${it.qIndex + 1} 题(题号 ${esc(it.qid) || '空'})· ${esc(C.RULE_NAMES[it.code])}</strong><span>${esc(it.message)}</span></button></li>`
        : `<li class="issue-global"><strong>全库 · ${esc(C.RULE_NAMES[it.code])}</strong><br>${esc(it.message)}</li>`).join('');
      return `<div class="issue-group"><h3><span class="tag tag--${esc(level)}">${esc(C.LEVEL_LABEL[level])}</span> ${list.length} 条</h3><ul class="issue-list">${items}</ul></div>`;
    };
    el.innerHTML = group('block') + group('warn');
  }

  // ---------- 动作 ----------
  function onShuffle() {
    if (!state.bank.length) return;
    const seed = $('seed').value.trim() || 'demo';
    const out = C.shuffle(state.bank, seed);
    const skipped = state.bank.filter(q => !C.canShuffle(q)).length;
    state.shuffled = { seed, questions: out };
    state.view = 'shuffled';
    render();
    $('shuffle-note').textContent = `已用种子「${seed}」打乱 ${out.length - skipped} 题,答案已同步。${skipped ? `${skipped} 题答案或选项有阻断问题,保持原样,请先修复。` : ''}`;
    save();
  }
  function onClear() {
    state = { bank: [], shuffled: null, view: 'original', sample: false };
    hidePreview(); $('export-confirm').hidden = true; pendingExport = null;
    parsedCsv = null; $('mapping').hidden = true; $('import-details').open = true;
    $('clear-confirm').hidden = true; $('sample-confirm').hidden = true;
    render();
    if (save()) showToast('已清空。');
  }
  const sampleTag = () => (state.sample ? '合成示例-' : '');
  const SAMPLE_NOTE = C.SAMPLE_NOTE; /* 导出时追加;导入时由 C.splitSampleNote 识别并去掉 */
  const withNote = (csv) => (state.sample ? csv.replace(/\r?\n?$/, '\r\n') + SAMPLE_NOTE + '\r\n' : csv);
  const mdNote = (md) => (state.sample ? `> ${SAMPLE_NOTE}。\n\n` + md : md);
  function versionOf(kind) {
    if (kind === 'shuffled-csv') return state.shuffled ? state.shuffled.questions : [];
    if (kind === 'bank-csv') return state.bank;
    return current();
  }
  function doExport(kind) {
    const qs = versionOf(kind);
    const { issues, stats } = C.check(qs);
    if (kind === 'issues-md') download(sampleTag() + '题库问题清单.md', mdNote(C.issuesToMarkdown(issues, stats)), 'text/markdown;charset=utf-8');
    if (kind === 'issues-csv') download(sampleTag() + '题库问题清单.csv', withNote(C.issuesToCsv(issues)), 'text/csv;charset=utf-8');
    if (kind === 'exam') download(sampleTag() + '试卷.md', mdNote(C.toExamMarkdown(qs, state.sample ? '选择题试卷（合成示例）' : '选择题试卷')), 'text/markdown;charset=utf-8');
    if (kind === 'shuffled-csv' && state.shuffled) download(sampleTag() + '题库-打乱后.csv', withNote(C.toCsv(state.shuffled.questions)), 'text/csv;charset=utf-8');
    if (kind === 'bank-csv') download(sampleTag() + '题库-原题库.csv', withNote(C.toCsv(state.bank)), 'text/csv;charset=utf-8');
  }
  /* 带阻断问题的题库导出试卷或题库前，先在页内确认；问题清单本身不需要确认 */
  function exportCurrent(kind) {
    if (['exam', 'shuffled-csv', 'bank-csv'].includes(kind)) {
      const sum = C.issueSummary(C.check(versionOf(kind)).issues);
      if (sum.block > 0) {
        pendingExport = kind;
        $('export-confirm-text').textContent = `这个版本还有 ${sum.block} 个阻断问题，导出的文件会带着这些问题。${sum.text}仍要导出吗？`;
        $('export-confirm').hidden = false;
        $('export-confirm-no').focus();
        return;
      }
    }
    doExport(kind);
  }

  function loadSample() {
    $('import-text').value = globalThis.QB_SAMPLE_CSV;
    document.querySelector('input[name=fmt][value=csv]').checked = true;
    $('seed').value = DEFAULT_SEED;
    const parsed = C.parseDelimited(globalThis.QB_SAMPLE_CSV);
    const res = C.parseCsvBank(parsed, C.autoMapping(parsed.headers));
    if (res.errors.length) { showImportErrors(res.errors); return; }
    commitImport(res.questions, true);
  }
  /* 用户数据 = 已有题库 + 未导入的粘贴内容 + 偏离默认值的随机种子 */
  function sampleScope() {
    const bits = [];
    if (state.bank.length) bits.push(`现有 ${state.bank.length} 题${state.shuffled ? `和种子「${state.shuffled.seed}」的打乱结果` : ''}`);
    if ($('import-text').value.trim()) bits.push('粘贴框里尚未导入的内容');
    if ($('seed').value.trim() !== DEFAULT_SEED) bits.push(`自定义的随机种子「${$('seed').value.trim()}」`);
    return bits;
  }

  function bind() {
    $('load-sample').addEventListener('click', () => {
      const bits = sampleScope();
      if (bits.length) { $('sample-msg').textContent = `载入合成示例会替换：${bits.join('、')}。确认前原内容不变，且不能撤销。确定替换吗？`; $('sample-confirm').hidden = false; $('sample-yes').focus(); return; }
      loadSample();
    });
    $('sample-no').addEventListener('click', () => { $('sample-confirm').hidden = true; });
    $('sample-yes').addEventListener('click', () => { $('sample-confirm').hidden = true; loadSample(); });
    const invalidateParse = () => { parsedCsv = null; $('mapping').hidden = true; hidePreview(); };
    $('import-text').addEventListener('input', invalidateParse);
    document.querySelectorAll('input[name=fmt]').forEach(r => r.addEventListener('change', invalidateParse));
    $('parse-btn').addEventListener('click', onParse);
    $('import-btn').addEventListener('click', onImport);
    $('import-file').addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        /* 空文件、乱码文件先拒绝:不改动粘贴框,原因写在导入区的错误提示里 */
        const chk = C.checkTextFile(String(r.result));
        if (!chk.ok) { hidePreview(); showImportErrors([`文件「${f.name}」没有读入:${chk.message}粘贴框里的内容没有改动。`]); return; }
        $('import-text').value = String(r.result);
        document.querySelector(`input[name=fmt][value=${/\.(csv|tsv)$/i.test(f.name) ? 'csv' : 'text'}]`).checked = true;
        onParse();
      };
      r.onerror = () => showImportErrors(['文件读取失败。']);
      r.readAsText(f);
    });
    $('only-issues').addEventListener('change', render);
    $('view-original').addEventListener('click', () => { state.view = 'original'; render(); save(); });
    $('view-shuffled').addEventListener('click', () => { if (state.shuffled) { state.view = 'shuffled'; render(); save(); } });
    $('shuffle-btn').addEventListener('click', onShuffle);
    $('export-issues-md').addEventListener('click', () => exportCurrent('issues-md'));
    $('export-issues-csv').addEventListener('click', () => exportCurrent('issues-csv'));
    $('export-shuffled-csv').addEventListener('click', () => exportCurrent('shuffled-csv'));
    $('export-bank-csv').addEventListener('click', () => exportCurrent('bank-csv'));
    $('export-confirm-yes').addEventListener('click', () => { const k = pendingExport; pendingExport = null; $('export-confirm').hidden = true; if (k) doExport(k); });
    $('export-confirm-no').addEventListener('click', () => { pendingExport = null; $('export-confirm').hidden = true; });
    $('import-confirm-yes').addEventListener('click', () => { if (pendingImport) commitImport(pendingImport.questions, pendingImport.sample); });
    $('import-confirm-no').addEventListener('click', () => { hidePreview(); $('parse-btn').focus(); });
    $('export-exam').addEventListener('click', () => exportCurrent('exam'));
    $('clear-open').addEventListener('click', () => { $('clear-confirm').hidden = false; $('clear-yes').focus(); });
    $('clear-no').addEventListener('click', () => { $('clear-confirm').hidden = true; });
    $('clear-yes').addEventListener('click', onClear);
    $('issues').addEventListener('click', e => {
      const b = e.target.closest('[data-goto]');
      if (!b) return;
      const idx = b.getAttribute('data-goto');
      const card = $('card-' + idx);
      if (card) { card.scrollIntoView({ block: 'center' }); card.setAttribute('tabindex', '-1'); card.focus(); }
    });
  }

  load();
  bind();
  render();
})();
