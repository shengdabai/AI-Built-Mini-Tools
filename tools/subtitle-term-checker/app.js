'use strict';
(function () {
  const C = globalThis.SubtitleCore;
  const KEY = 'subtitleterms.v1';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let checked = null;          // 最近一次检查的结果快照
  let decisions = new Map();   // issue.id -> 'accept' | 'skip'
  let focusPos = null;
  let fileBase = '字幕';
  let isSample = false;        // 当前内容是否为合成示例(持久化,编辑后清除)

  // ---------- 输入读取 ----------
  function readOptions() {
    return { caseSensitive: $('opt-case').checked, cpsMax: $('opt-cps').value, lineMaxCjk: $('opt-cjk').value, lineMaxOther: $('opt-other').value };
  }
  function readInputs() {
    return { subtitle: $('subtitle-text').value, glossary: $('glossary-text').value, opts: readOptions() };
  }
  const signature = () => JSON.stringify(readInputs());
  function writeOptions(o) {
    $('opt-case').checked = !!(o && o.caseSensitive);
    $('opt-cps').value = o && o.cpsMax != null ? o.cpsMax : C.DEFAULTS.cpsMax;
    $('opt-cjk').value = o && o.lineMaxCjk != null ? o.lineMaxCjk : C.DEFAULTS.lineMaxCjk;
    $('opt-other').value = o && o.lineMaxOther != null ? o.lineMaxOther : C.DEFAULTS.lineMaxOther;
  }

  // ---------- 存储:save 返回是否真正写入 ----------
  function showSaveWarning(on) {
    const w = $('save-warning');
    w.hidden = !on;
    if (on) w.textContent = '未保存:浏览器存储不可用或已满,本次改动只在当前页面里。刷新会丢失。请先导出修正后的字幕或问题报告,并把两个文本框的内容另存。';
  }
  function save() {
    try {
      // 接受/跳过的选择与检查时的输入快照一起保存;输入已改动(结果过期)时,选择仍只对应那次检查
      const payload = Object.assign(readInputs(), {
        sample: isSample,
        decisions: checked ? Array.from(decisions) : [],
        decisionsSig: checked ? checked.sig : null
      });
      localStorage.setItem(KEY, JSON.stringify(payload));
      showSaveWarning(false);
      setStatus('已保存到本机浏览器。');
      return true;
    } catch (e) {
      showSaveWarning(true);
      setStatus('');
      return false;
    }
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (!d || typeof d.subtitle !== 'string' || typeof d.glossary !== 'string' || typeof d.opts !== 'object' || d.opts === null) return null;
      const okDec = Array.isArray(d.decisions) && d.decisions.every(x => Array.isArray(x) && x.length === 2 && typeof x[0] === 'string' && (x[1] === 'accept' || x[1] === 'skip'));
      d.decisions = okDec ? d.decisions : [];
      d.sample = d.sample === true;
      d.decisionsSig = typeof d.decisionsSig === 'string' ? d.decisionsSig : null;
      return d;
    } catch (e) { return null; }
  }
  function setStatus(msg) { $('status').textContent = msg; }

  // ---------- 选项校验:错误显示在出错输入旁 ----------
  const OPT_IDS = { cpsMax: 'opt-cps', lineMaxCjk: 'opt-cjk', lineMaxOther: 'opt-other' };
  function showOptionErrors() {
    const v = C.validateOptions(readOptions());
    for (const [field, id] of Object.entries(OPT_IDS)) {
      const err = v.errors.find(e => e.field === field);
      const box = $(id + '-err');
      box.hidden = !err;
      box.textContent = err ? err.message : '';
      if (err) $(id).setAttribute('aria-invalid', 'true'); else $(id).removeAttribute('aria-invalid');
    }
    return v;
  }

  // ---------- 检查 ----------
  function runCheck(restore) {
    const inp = readInputs();
    if (!inp.subtitle.trim()) { setStatus('请先粘贴字幕内容,或点「载入示例」。'); return; }
    const valid = showOptionErrors();
    if (valid.errors.length) {
      $(OPT_IDS[valid.errors[0].field]).focus();
      setStatus(`检查选项有 ${valid.errors.length} 处不合法,没有开始检查:${valid.errors.map(e => e.message).join('')}`);
      return;
    }
    const parsed = C.parseSubtitles(inp.subtitle);
    const glossary = C.parseGlossary(inp.glossary);
    const opts = valid.options;
    const issues = C.checkAll(parsed.cues, glossary, opts);
    const termsByPos = new Map();
    for (const it of issues) {
      if (it.kind !== 'term') continue;
      if (!termsByPos.has(it.pos)) termsByPos.set(it.pos, []);
      termsByPos.get(it.pos).push(it);
    }
    checked = { sig: JSON.stringify(inp), format: parsed.format, cues: parsed.cues, errors: parsed.errors, glossaryErrors: glossary.errors, issues, termsByPos };
    decisions = new Map();
    if (restore && restore.sig === checked.sig) {
      const valid = new Set(issues.map(i => i.id));
      for (const [id, act] of restore.decisions) if (valid.has(id)) decisions.set(id, act);
    }
    focusPos = null;
    renderAll();
    const errN = parsed.errors.length + glossary.errors.length;
    setStatus(errN
      ? `检查未完成:${errN} 处解析错误(${parsed.cues.length} 条字幕已解析,${issues.length} 个问题),请先按行号修正。`
      : `检查完成:${parsed.cues.length} 条字幕,${issues.length} 个问题。`);
  }

  const isStale = () => !!checked && checked.sig !== signature();

  // ---------- 渲染 ----------
  function renderFormatNote() {
    const t = $('subtitle-text').value;
    const first = t.split(/\r?\n/).find(l => l.trim() !== '');
    $('format-note').textContent = first ? `按内容判断为 ${/^\uFEFF?WEBVTT(\s|$)/.test(first.trim()) ? 'WebVTT' : 'SRT'} 格式。` : '';
  }
  function renderErrors() {
    const box = $('parse-errors');
    const items = [];
    if (checked) {
      for (const e of checked.errors) items.push(`字幕第 ${e.line} 行:${e.message}`);
      for (const e of checked.glossaryErrors) items.push(`术语表第 ${e.line} 行:${e.message}`);
    }
    box.hidden = !items.length;
    box.innerHTML = items.map(t => `<li>${esc(t)}</li>`).join('');
  }
  function renderSummary() {
    const box = $('summary');
    const terms = checked.issues.filter(i => i.kind === 'term');
    const acc = terms.filter(i => decisions.get(i.id) === 'accept').length;
    const errN = checked.errors.length + checked.glossaryErrors.length;
    const st = C.checkStatus(errN, checked.issues.length);
    const chips = [`<span class="chip"><b>${esc(checked.cues.length)}</b> 条字幕 · ${esc(checked.format === 'vtt' ? 'WebVTT' : 'SRT')}</span>`,
      st.complete ? (checked.issues.length ? `<span class="chip"><b>${esc(checked.issues.length)}</b> 个问题</span>` : `<span class="chip ok">${esc(st.label)}</span>`)
        : `<span class="chip bad">${esc(st.label)}</span>` + (checked.issues.length ? `<span class="chip"><b>${esc(checked.issues.length)}</b> 个问题(仅限已解析的内容)</span>` : '')];
    for (const s of C.summarize(checked.issues)) chips.push(`<span class="chip">${esc(s.label)} <b>${esc(s.count)}</b></span>`);
    if (terms.length) chips.push(`<span class="chip ok">已接受 <b>${esc(acc)}</b> / ${esc(terms.length)} 处术语修正</span>`);
    box.innerHTML = chips.join('');
  }
  function visibleIssues() {
    const f = $('issue-filter').value;
    return checked.issues.filter(i => f === 'all' || (f === 'term' && i.kind === 'term') || (f === 'timing' && i.kind === 'timing') || (f === 'pending' && i.kind === 'term' && !decisions.has(i.id)));
  }
  function renderIssues() {
    const list = $('issue-list');
    const keep = list.scrollTop;
    const stale = isStale();
    const items = visibleIssues();
    if (!items.length) {
      const errN = checked.errors.length + checked.glossaryErrors.length;
      list.innerHTML = `<li class="none">${esc(checked.issues.length ? '当前筛选下没有问题。' : errN ? `检查未完成:${errN} 处解析错误,出错的内容没有被检查,不能说没有问题。请先按上方行号修正。` : '没有发现术语或时间轴问题。')}</li>`;
      return;
    }
    list.innerHTML = items.map(it => {
      const d = decisions.get(it.id);
      const cls = esc(`issue sev-${it.severity}${d === 'accept' ? ' is-accepted' : ''}${d === 'skip' ? ' is-skipped' : ''}`);
      const kindBadge = `<span class="badge ${esc(it.kind === 'term' ? 'term' : it.severity)}">${esc(C.CODE_LABELS[it.code] || it.code)}</span>`;
      const decide = it.kind === 'term' ? `<div class="decide">
        <button type="button" data-act="accept" data-id="${esc(it.id)}" aria-pressed="${esc(d === 'accept')}" ${stale ? 'disabled' : ''}>接受替换</button>
        <button type="button" data-act="skip" data-id="${esc(it.id)}" aria-pressed="${esc(d === 'skip')}" ${stale ? 'disabled' : ''}>跳过</button></div>` : '';
      return `<li class="${cls}" data-id="${esc(it.id)}">
        <div class="head"><button type="button" class="link goto" data-pos="${esc(it.pos)}">#${esc(it.cueIndex)}</button><span class="tc">${esc(it.time)}</span>${kindBadge}</div>
        <p class="msg">${esc(it.message)}</p><p class="sug">建议:${esc(it.suggestion)}</p>${decide}</li>`;
    }).join('');
    list.scrollTop = keep;
  }
  function lineHtml(pos, lineNo, text) {
    const terms = (checked.termsByPos.get(pos) || []).filter(t => t.lineNo === lineNo).sort((a, b) => a.col - b.col);
    let out = '', cur = 0;
    for (const t of terms) {
      out += esc(text.slice(cur, t.col));
      const d = decisions.get(t.id);
      if (d === 'accept') out += `<span class="fixed"><del>${esc(t.found)}</del><ins>${esc(t.replacement)}</ins></span>`;
      else out += `<mark class="hit${d === 'skip' ? ' is-skipped' : ''}">${esc(t.found)}</mark>`;
      cur = t.col + t.found.length;
    }
    return out + esc(text.slice(cur)) || '&nbsp;';
  }
  function renderPreview() {
    const box = $('preview');
    const keep = box.scrollTop;
    const byPos = new Map();
    for (const it of checked.issues) if (it.kind === 'timing') { if (!byPos.has(it.pos)) byPos.set(it.pos, []); byPos.get(it.pos).push(it); }
    $('preview-note').textContent = '黄色 = 待处理术语,绿色 = 已接受,灰色 = 已跳过';
    if (!checked.cues.length) { box.innerHTML = '<div class="none">没有解析出任何字幕。</div>'; return; }
    box.innerHTML = checked.cues.map((c, pos) => {
      const t = byPos.get(pos) || [];
      const sev = t.some(i => i.severity === 'error') ? ' has-error' : (t.length || checked.termsByPos.has(pos)) ? ' has-warn' : '';
      const v = C.cps(c);
      const badges = t.map(i => `<span class="badge ${esc(i.severity)}">${esc(C.CODE_LABELS[i.code] || i.code)}</span>`).join('');
      return `<article class="cue${esc(sev)}${focusPos === pos ? ' is-focus' : ''}" id="cue-${esc(pos)}">
        <div class="cue-head"><span class="cue-no">#${esc(c.index)}</span><span class="tc">${esc(C.formatTime(c.start))} → ${esc(C.formatTime(c.end))}</span><span class="tc">${esc(Number.isFinite(v) ? v.toFixed(1) : '—')} 字/秒</span>${badges}</div>
        <div class="cue-text">${c.lines.map((l, i) => `<div class="line">${lineHtml(pos, i, l)}</div>`).join('') || '<div class="line muted">（空文本）</div>'}</div></article>`;
    }).join('');
    box.scrollTop = keep;
  }
  function reportErrors() {
    return checked.errors.map(e => ({ source: '字幕', line: e.line, message: e.message }))
      .concat(checked.glossaryErrors.map(e => ({ source: '术语表', line: e.line, message: e.message })));
  }
  function accepted() { return checked.issues.filter(i => decisions.get(i.id) === 'accept'); }
  function renderExport() {
    const stale = isStale();
    const hasErr = checked.errors.length > 0;
    $('export-fixed').disabled = stale || hasErr || !checked.cues.length;
    $('export-md').disabled = stale;
    $('export-csv').disabled = stale;
    $('accept-all').disabled = stale || !checked.issues.some(i => i.kind === 'term');
    $('reset-decisions').disabled = stale || !decisions.size;
    let note;
    if (stale) note = '输入或选项已改动,当前结果不再对应界面。请先点「检查字幕」,再导出。';
    else if (hasErr) note = `字幕有 ${checked.errors.length} 处解析错误,「导出修正后的字幕」已禁用,否则会丢掉无法解析的字幕。请先按上方行号修正。问题报告仍可导出。`;
    else note = `将导出 ${checked.cues.length} 条字幕,已接受 ${accepted().length} 处术语修正;时间轴与序号保持原样,格式与输入一致(${checked.format === 'vtt' ? 'WebVTT' : 'SRT'})。`;
    $('export-note').textContent = note;
  }
  function renderAll() {
    renderFormatNote();
    const has = !!checked;
    $('results').hidden = !has;
    $('empty-guide').hidden = has || !!$('subtitle-text').value.trim();
    $('stale-note').hidden = !isStale();
    $('sample-badge').hidden = !isSample;
    $('results').classList.toggle('is-stale', isStale());
    renderErrors();
    if (!has) return;
    renderSummary(); renderIssues(); renderPreview(); renderExport();
  }
  function refreshDecisions() { renderSummary(); renderIssues(); renderPreview(); renderExport(); save(); }

  // ---------- 导出 ----------
  function download(name, text, type) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(new Blob([text], { type }));
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportFixed() {
    if (!checked || isStale() || checked.errors.length) return;
    const fixed = C.applyFixes(checked.cues, accepted());
    const ext = checked.format === 'vtt' ? 'vtt' : 'srt';
    download(`${fileBase}-已校对.${ext}`, C.serialize(fixed, checked.format), 'text/plain;charset=utf-8');
    setStatus(`已导出修正后的字幕(${accepted().length} 处术语修正)。`);
  }

  // ---------- 事件 ----------
  function onInput(e) {
    if (isSample && e && (e.target.id === 'subtitle-text' || e.target.id === 'glossary-text')) { isSample = false; fileBase = '字幕'; }
    if (e && e.target.id && e.target.id.indexOf('opt-') === 0) showOptionErrors();
    save(); renderAll();
  }
  const defaultOptsText = () => ({ cpsMax: String(C.DEFAULTS.cpsMax), lineMaxCjk: String(C.DEFAULTS.lineMaxCjk), lineMaxOther: String(C.DEFAULTS.lineMaxOther) });
  function optsChanged() {
    const o = readOptions(), d = defaultOptsText();
    return o.caseSensitive || o.cpsMax !== d.cpsMax || o.lineMaxCjk !== d.lineMaxCjk || o.lineMaxOther !== d.lineMaxOther;
  }
  function hasUserWork() {
    const s = globalThis.SUBTITLE_SAMPLE;
    const sub = $('subtitle-text').value, gl = $('glossary-text').value;
    if (isSample && s && sub === s.srt && gl === s.glossary && !optsChanged() && !decisions.size) return false;
    return sub.trim() !== '' || gl.trim() !== '' || optsChanged() || decisions.size > 0;
  }
  function describeWork() {
    const parts = [];
    const sub = $('subtitle-text').value, gl = $('glossary-text').value;
    if (sub.trim()) parts.push(`字幕(${checked ? checked.cues.length + ' 条' : sub.split(/\r?\n/).length + ' 行'})`);
    if (gl.trim()) parts.push(`术语表(${gl.split(/\r?\n/).filter(l => l.trim()).length} 行)`);
    if (optsChanged()) parts.push('已改动的检查选项');
    if (decisions.size) parts.push(`${decisions.size} 条接受/跳过选择`);
    return parts.join('、');
  }
  function requestSample() {
    $('clear-confirm').hidden = true;
    if (!hasUserWork()) { loadSample(); return; }
    $('sample-confirm-scope').textContent = `当前的${describeWork()}会被合成示例替换,检查选项会重置为默认值,接受/跳过记录会一并清除;此操作无法撤销。`;
    $('sample-confirm').hidden = false;
    $('sample-confirm-yes').focus();
  }
  function loadSample() {
    const s = globalThis.SUBTITLE_SAMPLE;
    $('sample-confirm').hidden = true;
    $('subtitle-text').value = s.srt; $('glossary-text').value = s.glossary; writeOptions(null);
    showOptionErrors();
    fileBase = '合成示例';
    isSample = true;
    save(); runCheck();
    setStatus(`已载入${s.label}。`);
  }
  // 重绘后把键盘焦点放回同一条问题的同一个按钮;该条已不在当前筛选下时,转到同位置的下一条待处理问题
  function restoreIssueFocus(id, act, idx) {
    const after = visibleIssues();
    let btn = null;
    if (after.some(i => i.id === id)) btn = document.querySelector(`#issue-list [data-id="${CSS.escape(id)}"][data-act="${act}"]`);
    else if (after.length) {
      const next = after[Math.min(idx, after.length - 1)];
      btn = document.querySelector(`#issue-list [data-id="${CSS.escape(next.id)}"][data-act="accept"]`) || document.querySelector(`#issue-list li[data-id="${CSS.escape(next.id)}"] .goto`);
    }
    (btn || $('issue-filter')).focus();
  }
  function bind() {
    for (const id of ['subtitle-text', 'glossary-text', 'opt-case', 'opt-cps', 'opt-cjk', 'opt-other']) $(id).addEventListener('input', onInput);
    $('run-check').onclick = () => { save(); runCheck(); };
    $('load-sample').onclick = requestSample;
    $('sample-confirm-yes').onclick = loadSample;
    $('sample-confirm-no').onclick = () => { $('sample-confirm').hidden = true; $('load-sample').focus(); };
    $('subtitle-file').onchange = e => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) { setStatus('文件超过 5 MB,没有读取。'); return; }
      const r = new FileReader();
      r.onload = () => { $('subtitle-text').value = String(r.result); isSample = false; fileBase = f.name.replace(/\.[^.]+$/, '') || '字幕'; save(); runCheck(); };
      r.onerror = () => setStatus('读取文件失败。');
      r.readAsText(f, 'utf-8');
    };
    $('issue-filter').onchange = () => { if (checked) renderIssues(); };
    $('accept-all').onclick = () => { for (const i of checked.issues) if (i.kind === 'term') decisions.set(i.id, 'accept'); refreshDecisions(); };
    $('reset-decisions').onclick = () => { decisions = new Map(); refreshDecisions(); $('accept-all').focus(); };
    $('issue-list').addEventListener('click', e => {
      const act = e.target.closest('[data-act]');
      if (act) {
        const id = act.dataset.id, a = act.dataset.act;
        const idx = visibleIssues().findIndex(i => i.id === id);
        if (decisions.get(id) === a) decisions.delete(id); else decisions.set(id, a);
        refreshDecisions();
        restoreIssueFocus(id, a, idx);
        return;
      }
      const g = e.target.closest('.goto');
      if (g) {
        focusPos = Number(g.dataset.pos);
        document.querySelectorAll('.cue.is-focus').forEach(n => n.classList.remove('is-focus'));
        const el = $('cue-' + focusPos);
        if (el) { el.classList.add('is-focus'); el.scrollIntoView({ block: 'nearest' }); }
      }
    });
    $('export-fixed').onclick = exportFixed;
    $('export-md').onclick = () => { if (checked && !isStale()) download(`${fileBase}-问题报告.md`, C.toMarkdown(checked.issues, reportErrors(), { sample: isSample }), 'text/markdown;charset=utf-8'); };
    $('export-csv').onclick = () => { if (checked && !isStale()) download(`${fileBase}-问题报告.csv`, C.toCsv(checked.issues, reportErrors(), { sample: isSample }), 'text/csv;charset=utf-8'); };
    $('clear-data').onclick = () => {
      $('sample-confirm').hidden = true;
      const w = describeWork();
      $('clear-confirm-scope').textContent = `${w ? '当前的' + w + '都会被删除' : '字幕、术语表、选项和检查结果都会删除'},无法恢复。建议先导出需要的文件。`;
      $('clear-confirm').hidden = false;
      $('clear-confirm-no').focus();
    };
    $('clear-confirm-no').onclick = () => { $('clear-confirm').hidden = true; };
    $('clear-confirm-yes').onclick = () => {
      $('subtitle-text').value = ''; $('glossary-text').value = ''; writeOptions(null);
      checked = null; decisions = new Map(); focusPos = null; fileBase = '字幕'; isSample = false; showOptionErrors();
      let ok = true;
      try { localStorage.removeItem(KEY); } catch (e) { ok = false; }
      showSaveWarning(!ok);
      $('clear-confirm').hidden = true;
      renderAll();
      setStatus(ok ? '已清空。' : '');
    };
  }

  const saved = load();
  if (saved) { $('subtitle-text').value = saved.subtitle; $('glossary-text').value = saved.glossary; writeOptions(saved.opts); isSample = saved.sample; if (isSample) fileBase = '合成示例'; } else writeOptions(null);
  bind();
  if (saved && saved.subtitle.trim()) {
    // 选项不合法时也要把错误显示在输入旁,但不执行检查
    if (C.validateOptions(readOptions()).errors.length) { showOptionErrors(); renderAll(); }
    else runCheck({ sig: saved.decisionsSig, decisions: saved.decisions });
  } else renderAll();
})();
