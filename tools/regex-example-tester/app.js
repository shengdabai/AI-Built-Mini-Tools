'use strict';
(function () {
  const C = globalThis.RegexCore;
  const SAMPLE = globalThis.RegexSample;
  const KEY = 'regexcheck.v1';
  const $ = id => document.getElementById(id);

  let state = C.defaultState();
  let lastRun = null;          // { sig, results, stats, pattern, flags, name }
  let running = false;
  let pendingConfirm = null;
  let toastTimer = null;
  let maxInputValid = true;
  let stopCtl = null;

  /* ---------- DOM 小工具(用户内容一律走 textContent) ---------- */
  function el(tag, props, children) {
    const n = document.createElement(tag);
    if (props) for (const k of Object.keys(props)) {
      if (k === 'class') n.className = props[k];
      else if (k === 'text') n.textContent = props[k];
      else if (k === 'data') for (const d of Object.keys(props.data)) n.dataset[d] = props.data[d];
      else n.setAttribute(k, props[k]);
    }
    (children || []).forEach(c => n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  /* ---------- 存储 ---------- */
  function showSaveWarning(msg) {
    const w = $('save-warning');
    if (msg) { w.textContent = msg; w.hidden = false; } else { w.hidden = true; w.textContent = ''; }
  }
  function save() {
    const v = C.validateState(state);
    if (!v.ok) {
      showSaveWarning('未保存:当前数据没通过校验(' + v.error + ')。修改会在刷新后丢失,请先到「导出与数据」下载 JSON 备份。');
      $('save-state').textContent = '未保存';
      return false;
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      showSaveWarning('未保存:浏览器拒绝写入本机存储(可能已满或被禁用)。当前修改只在这个页面里,刷新会丢失。请立刻到「导出与数据」下载 JSON 备份。');
      $('save-state').textContent = '未保存';
      return false;
    }
    showSaveWarning('');
    $('save-state').textContent = '已保存到本机';
    return true;
  }
  function loadStored() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (raw === null) return;
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return rejectStored('不是合法 JSON'); }
    const v = C.validateState(parsed);
    if (!v.ok) return rejectStored(v.error);
    state = parsed;
  }
  function rejectStored(reason) {
    const n = $('load-notice');
    n.textContent = '本机保存的数据没通过校验,已忽略(' + reason + ')。原数据仍在浏览器里,你下一次修改并保存时才会被覆盖。';
    n.hidden = false;
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
  }

  /* ---------- 页内确认 ---------- */
  function askConfirm(text, yesLabel, fn) {
    pendingConfirm = fn;
    $('confirm-text').textContent = text;
    $('confirm-yes').textContent = yesLabel || '确认';
    $('confirm').hidden = false;
    $('confirm-yes').focus();
  }
  function closeConfirm() { pendingConfirm = null; $('confirm').hidden = true; }

  /* ---------- 草稿与表单 ---------- */
  function flagsFromUi() { return C.FLAG_CHARS.split('').filter(f => $('flag-' + f).checked).join(''); }
  function draftBlank() { const d = state.draft; return !d.pattern && !d.cases.trim() && !d.name && d.flags === '' && d.maxInput === C.DEFAULT_MAX_INPUT; }
  function hasData() { return C.hasUserData(state); }
  function dataScope() {
    const d = state.draft;
    const lines = d.cases.trim() ? d.cases.split(/\r\n|\r|\n/).filter(l => l.trim()).length : 0;
    return '草稿(名称、正则「' + (d.pattern.length > 30 ? d.pattern.slice(0, 30) + '…' : d.pattern) + '」、标志「' + d.flags + '」、输入长度上限 ' + d.maxInput + '、样例表 ' + lines + ' 行)和样例库 ' + state.library.length + ' 条';
  }
  function draftToUi() {
    const d = state.draft;
    $('name').value = d.name; $('pattern').value = d.pattern; $('cases').value = d.cases; $('max-input').value = String(d.maxInput);
    C.FLAG_CHARS.split('').forEach(f => { $('flag-' + f).checked = d.flags.indexOf(f) >= 0; });
    maxInputValid = true; $('max-error').textContent = '';
  }
  function sigNow() { return JSON.stringify([state.draft.pattern, state.draft.flags, state.draft.cases, $('max-input').value]); }

  function onDraftInput() {
    const d = state.draft;
    d.name = $('name').value; d.pattern = $('pattern').value; d.cases = $('cases').value; d.flags = flagsFromUi();
    const raw = $('max-input').value.trim();
    const num = Number(raw);
    if (raw !== '' && C.validMaxInput(num)) { d.maxInput = num; maxInputValid = true; $('max-error').textContent = ''; }
    else { maxInputValid = false; $('max-error').textContent = '输入长度上限必须是 1 到 ' + C.MAX_INPUT_LIMIT + ' 的整数;修正前不能运行,保存的仍是上一个有效值。'; }
    save();
    renderCompile(); renderExplain(); renderStale(); renderLibrary();
  }

  function renderCompile() {
    const box = $('compile-status');
    clear(box);
    const d = state.draft;
    box.className = 'compile';
    if (!d.pattern) { box.textContent = '还没有输入正则。'; return; }
    const r = C.compile(d.pattern, d.flags);
    if (r.ok) { box.classList.add('ok'); box.textContent = '编译通过。'; return; }
    box.classList.add('err');
    box.appendChild(el('div', { text: '编译失败' + (r.pos !== null ? ',第 ' + (r.pos + 1) + ' 个字符' : '') + ':' + r.error }));
    if (r.pos !== null) {
      const start = Math.max(0, r.pos - 30);
      const end = Math.min(d.pattern.length, r.pos + 31);
      const shown = (start > 0 ? '…' : '') + d.pattern.slice(start, end) + (end < d.pattern.length ? '…' : '');
      const offset = (start > 0 ? 1 : 0) + (r.pos - start);
      box.appendChild(el('pre', { class: 'caret', text: shown + '\n' + ' '.repeat(offset) + '^' }));
    }
  }

  /* ---------- 运行 ---------- */
  function runInWorker(pattern, flags, cases, maxInput, ctl) {
    return new Promise((resolve, reject) => {
      const results = new Array(cases.length);
      if (!cases.length) { resolve(results); return; }
      let worker = null, timer = null, current = 0, url = null;
      try { url = URL.createObjectURL(new Blob([C.workerSource()], { type: 'text/javascript' })); }
      catch (e) { reject(new Error('无法创建 Worker 脚本:' + e.message)); return; }
      const cleanup = () => { clearTimeout(timer); if (worker) worker.terminate(); URL.revokeObjectURL(url); };
      const finish = () => { cleanup(); resolve(results); };
      if (ctl) ctl.stop = () => {
        clearTimeout(timer);
        if (worker) worker.terminate();
        URL.revokeObjectURL(url);
        for (let i = 0; i < cases.length; i++) if (!results[i]) results[i] = C.makeSkippedResult(i, cases[i]);
        resolve(results);
      };
      const fail = err => { cleanup(); reject(err); };
      const arm = () => { clearTimeout(timer); timer = setTimeout(onTimeout, C.TIMEOUT_MS); };
      function onTimeout() {
        worker.terminate();
        results[current] = C.makeTimeoutResult(current, cases[current], C.TIMEOUT_MS);
        $('run-status').textContent = '第 ' + (current + 1) + ' 条超过 ' + (C.TIMEOUT_MS / 1000) + ' 秒,已中止,继续后面的样例…';
        start(current + 1);
      }
      function start(from) {
        if (from >= cases.length) { finish(); return; }
        try { worker = new Worker(url); } catch (e) { fail(new Error('浏览器不允许在这里启动 Worker:' + e.message + '。为避免页面卡死,没有改用主线程执行。')); return; }
        current = from;
        worker.onmessage = ev => {
          const d = ev.data;
          if (d.type === 'error') { fail(new Error(d.message)); return; }
          if (d.type === 'result') {
            results[d.index] = C.makeResult(d.index, cases[d.index], d.result);
            current = d.index + 1;
            if (current < cases.length) arm();
          } else if (d.type === 'done') finish();
        };
        worker.onerror = ev => fail(new Error(ev.message || 'Worker 出错'));
        worker.postMessage({ pattern: pattern, flags: flags, cases: cases, maxInput: maxInput, start: from });
        arm();
      }
      start(0);
    });
  }

  async function run() {
    if (running) return;
    const d = state.draft;
    $('cases-errors').textContent = ''; $('run-status').textContent = '';
    if (!d.pattern) { $('run-status').textContent = '请先输入正则。'; return; }
    if (!maxInputValid) { $('run-status').textContent = '输入长度上限不合法,先修正。'; return; }
    const parsed = C.parseCases(d.cases);
    if (!parsed.ok) { showCaseErrors(parsed.errors); $('run-status').textContent = '样例表有错误,已停止,没有运行任何一条。'; return; }
    const comp = C.compile(d.pattern, d.flags);
    if (!comp.ok) { $('run-status').textContent = '正则编译失败,没有运行。'; renderCompile(); return; }
    running = true; $('run').disabled = true; $('stop').hidden = false; $('run-status').textContent = '运行中…(共 ' + parsed.cases.length + ' 条,可随时点「停止验收」)';
    const sig = sigNow();
    stopCtl = {};
    try {
      const results = await runInWorker(d.pattern, d.flags, parsed.cases, d.maxInput, stopCtl);
      lastRun = { sig: sig, results: results, stats: C.buildStats(results), pattern: d.pattern, flags: d.flags, name: d.name };
      $('run-status').textContent = (lastRun.stats.skipped ? '已停止:' : '完成:') + C.formatRate(lastRun.stats);
    } catch (e) {
      $('run-status').textContent = '运行失败:' + e.message;
    } finally {
      running = false; stopCtl = null; $('run').disabled = false; $('stop').hidden = true;
    }
    renderResults(); renderStale();
  }

  function showCaseErrors(errors) {
    const box = $('cases-errors');
    clear(box);
    errors.slice(0, 8).forEach(e => box.appendChild(el('div', { text: e.message })));
    if (errors.length > 8) box.appendChild(el('div', { text: '还有 ' + (errors.length - 8) + ' 处错误未显示。' }));
  }

  /* ---------- 结果渲染 ---------- */
  function inputCell(r) {
    const td = el('td', { 'data-label': '输入', class: 'cell-code' });
    const s = r.input;
    if (s === '') { td.appendChild(el('span', { class: 'ws', text: '(空输入)' })); return td; }
    if (r.actual && r.actual.matched && r.actual.end > r.actual.index) {
      td.appendChild(document.createTextNode(s.slice(0, r.actual.index)));
      td.appendChild(el('mark', { text: s.slice(r.actual.index, r.actual.end) }));
      td.appendChild(document.createTextNode(s.slice(r.actual.end)));
    } else td.appendChild(document.createTextNode(s));
    if (s !== s.trim()) td.appendChild(el('span', { class: 'sub', text: '首尾含空格' }));
    return td;
  }

  /* 标签用普通字体,只有捕获到的机器文本用等宽字体 */
  function labelled(label, value) {
    return el('span', { class: 'sub' }, [label, el('span', { class: 'cell-code', text: value })]);
  }
  function expectCell(r) {
    const td = el('td', { 'data-label': '期望' });
    td.appendChild(document.createTextNode(r.expect === 'match' ? '匹配' : '不匹配'));
    if (r.captures && r.captures.length) td.appendChild(labelled('捕获:', r.captures.map((c, i) => (i + 1) + '=' + (c === null ? '未捕获' : '「' + c + '」')).join(' ')));
    return td;
  }

  function actualCell(r) {
    const td = el('td', { 'data-label': '实际' });
    const a = r.actual;
    if (!a) { td.textContent = r.code === 'timeout' ? '已中止' : (r.code === 'skipped' ? '未运行' : '未执行'); return td; }
    if (!a.matched) { td.textContent = '未匹配'; return td; }
    td.appendChild(document.createTextNode('匹配,位置 ' + a.index + '–' + a.end));
    if (a.count > 1) td.appendChild(el('span', { class: 'sub', text: '全局共 ' + a.count + ' 处' }));
    if (a.groups.length) td.appendChild(labelled('捕获:', a.groups.map((g, i) => (i + 1) + '=' + (g === undefined ? '未捕获' : '「' + g + '」')).join(' ')));
    if (a.named.length) td.appendChild(labelled('命名:', a.named.map(p => p[0] + '=' + (p[1] === undefined ? '未捕获' : '「' + p[1] + '」')).join(' ')));
    return td;
  }

  function verdictCell(r) {
    const td = el('td', { 'data-label': '结果' });
    const kind = r.pass ? 'pass' : (r.code === 'skipped' ? 'skip' : (r.code === 'timeout' || r.code === 'toolong' ? 'warn' : 'fail'));
    const glyph = r.pass ? '✓' : (kind === 'skip' ? '–' : (kind === 'warn' ? '!' : '✗'));
    const text = el('span', { class: 'verdict-text ' + (r.pass ? 'pass' : (kind === 'skip' ? 'skip' : 'fail')) }, [r.pass ? '通过' : (kind === 'skip' ? r.reason : '失败:' + r.reason)]);
    if (!r.pass && r.detail) text.appendChild(el('span', { class: 'detail', text: r.detail }));
    td.appendChild(el('div', { class: 'verdict' }, [el('span', { class: 'icon ' + kind, 'aria-hidden': 'true', text: glyph }), text]));
    return td;
  }

  function renderResults() {
    const has = !!lastRun;
    $('results-empty').hidden = has; $('results-body').hidden = !has;
    if (!has) return;
    const st = lastRun.stats;
    const num = $('rate-num');
    num.textContent = st.rate !== null ? (st.rate * 100).toFixed(1) + '%' : '—';
    num.className = 'rate-num ' + (st.rate !== null ? (st.failed ? 'has-fail' : 'all-pass') : '');
    const det = $('rate-detail');
    clear(det);
    det.appendChild(el('span', { text: C.formatRate(st) }));
    if (st.total) {
      det.appendChild(el('span', { text: '通过 ' + st.passed }));
      det.appendChild(el('span', { text: '失败 ' + st.failed }));
      if (st.skipped) det.appendChild(el('span', { text: '未运行 ' + st.skipped + '(已手动停止)' }));
      const bc = st.byCode;
      [['missed', '应匹配未匹配'], ['unexpected', '不应匹配却匹配'], ['capture', '捕获不符'], ['timeout', '疑似回溯'], ['toolong', '输入过长']]
        .forEach(p => { if (bc[p[0]]) det.appendChild(el('span', { text: p[1] + ' ' + bc[p[0]] })); });
    }
    const tb = $('results-table').tBodies[0];
    clear(tb);
    const only = $('only-fail').checked;
    lastRun.results.forEach(r => {
      if (only && r.pass) return;
      const tr = el('tr', { class: r.pass ? 'pass' : (r.code === 'skipped' ? 'skip' : 'fail') });
      tr.appendChild(el('td', { 'data-label': '序号', text: String(r.index + 1) }));
      tr.appendChild(inputCell(r)); tr.appendChild(expectCell(r)); tr.appendChild(actualCell(r)); tr.appendChild(verdictCell(r));
      tb.appendChild(tr);
    });
    if (!tb.children.length) { const tr = el('tr'); tr.appendChild(el('td', { text: '没有可显示的行。', 'data-label': '提示' })); tb.appendChild(tr); }
  }

  function isStale() { return !lastRun || lastRun.sig !== sigNow(); }
  function renderStale() {
    $('stale-note').hidden = !(lastRun && isStale());
    updateExportState();
  }

  /* ---------- 解释 ---------- */
  const TYPE_NAME = { literal: '字面文字', escape: '转义', class: '字符类', quantifier: '量词', group: '分组', anchor: '锚点', alternation: '或', any: '任意字符', unparsed: '未解析' };
  function renderExplain() {
    const box = $('explain-body');
    clear(box);
    const p = state.draft.pattern;
    if (!p) { box.appendChild(el('div', { class: 'empty', text: '输入正则后,这里按顺序列出每个部分的含义。' })); return; }
    const toks = C.tokenize(p);
    const table = el('table', { class: 'grid explain' });
    table.appendChild(el('thead', null, [el('tr', null, [el('th', { text: '片段' }), el('th', { text: '类型' }), el('th', { text: '说明' })])]));
    const tb = el('tbody');
    toks.forEach(t => {
      const tr = el('tr', { class: t.type === 'unparsed' ? 'unparsed' : '' });
      tr.appendChild(el('td', { 'data-label': '片段', class: 'cell-code', text: t.raw === '' ? '(缺失)' : t.raw }));
      tr.appendChild(el('td', { 'data-label': '类型', class: 'tok-type', text: TYPE_NAME[t.type] || t.type }));
      tr.appendChild(el('td', { 'data-label': '说明', text: t.explain }));
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    box.appendChild(el('div', { class: 'table-wrap' }, [table]));
    const un = toks.filter(t => t.type === 'unparsed').length;
    if (un) box.appendChild(el('p', { class: 'muted', text: '有 ' + un + ' 处未解析,说明解释器不认识这种写法,不代表正则错误。' }));
  }

  /* ---------- 样例库 ---------- */
  function currentEntry() { return state.library.find(e => e.id === state.currentId) || null; }
  function draftDirty() {
    const d = state.draft, e = currentEntry();
    if (!e) return !draftBlank();
    return d.name !== e.name || d.pattern !== e.pattern || d.flags !== e.flags || d.maxInput !== e.maxInput || d.cases.trim() !== C.formatCases(e.cases).trim();
  }
  function renderLibrary() {
    const list = $('lib-list');
    clear(list);
    const items = C.searchLibrary(state.library, $('lib-search').value);
    const cur = currentEntry();
    $('lib-hint').textContent = '样例库共 ' + state.library.length + ' 条。' + (cur ? '当前载入:「' + cur.name + '」。「保存到样例库」会更新它;「另存为新条目」另建一条。' : '保存时使用左侧「名称」。');
    if (!items.length) { list.appendChild(el('div', { class: 'empty', text: state.library.length ? '没有符合搜索的条目。' : '样例库是空的。填好左侧内容后点「保存到样例库」,或先「载入示例」。' })); return; }
    items.forEach(e => {
      const item = el('div', { class: 'lib-item' + (e.id === state.currentId ? ' current' : '') });
      item.appendChild(el('div', { class: 'lib-main' }, [
        el('strong', { text: e.name }),
        el('span', { class: 'sub cell-code', text: e.pattern.length > 120 ? e.pattern.slice(0, 120) + '…' : e.pattern }),
        el('span', { class: 'sub', text: e.cases.length + ' 条样例' + (e.flags ? ' · 标志 ' + e.flags : '') })
      ]));
      item.appendChild(el('div', { class: 'row' }, [
        el('button', { type: 'button', text: '载入', data: { act: 'load', id: e.id } }),
        el('button', { type: 'button', class: 'danger', text: '删除', data: { act: 'del', id: e.id } })
      ]));
      list.appendChild(item);
    });
  }
  function saveEntry(asNew) {
    const d = state.draft;
    if (!d.name.trim()) { toast('先在左侧填「名称」。'); $('name').focus(); return; }
    if (!maxInputValid) { toast('输入长度上限不合法,先修正。'); return; }
    const parsed = C.parseCases(d.cases);
    if (!parsed.ok) { showCaseErrors(parsed.errors); toast('样例表有错误,不能保存到样例库。'); return; }
    const entry = { id: C.newId(), name: d.name.trim(), pattern: d.pattern, flags: d.flags, maxInput: d.maxInput, cases: parsed.cases };
    const cur = currentEntry();
    if (!asNew && cur) { entry.id = cur.id; state.library[state.library.indexOf(cur)] = entry; }
    else { state.library.push(entry); }
    state.currentId = entry.id;
    state.draft.name = entry.name; $('name').value = entry.name;
    const ok = save();
    renderLibrary();
    if (ok) toast('已保存到样例库:' + entry.name);
  }
  function applyEntry(id) {
    const e = state.library.find(x => x.id === id);
    if (!e) return;
    state.draft = { name: e.name, pattern: e.pattern, flags: e.flags, cases: C.formatCases(e.cases), maxInput: e.maxInput };
    state.currentId = e.id;
    lastRun = null;
    const ok = save();
    draftToUi(); renderAll();
    if (ok) toast('已载入:' + e.name);
  }
  function loadEntry(id) {
    if (draftDirty()) askConfirm('当前草稿有未保存到样例库的修改,载入会替换它。', '确认替换', () => applyEntry(id));
    else applyEntry(id);
  }
  function deleteEntry(id) {
    const e = state.library.find(x => x.id === id);
    if (!e) return;
    askConfirm('确认从样例库删除「' + e.name + '」?无法恢复,建议先下载 JSON 备份。', '确认删除', () => {
      state.library = state.library.filter(x => x.id !== id);
      if (state.currentId === id) state.currentId = null;
      const ok = save(); renderAll();
      if (ok) toast('已删除。');
    });
  }

  /* ---------- 示例 / 清空 ---------- */
  function applySample() {
    const sets = JSON.parse(JSON.stringify(SAMPLE.sets));
    state.library = state.library.filter(e => e.id.indexOf('sample-') !== 0).concat(sets);
    const first = sets[0];
    state.draft = { name: first.name, pattern: first.pattern, flags: first.flags, cases: C.formatCases(first.cases), maxInput: first.maxInput };
    state.currentId = first.id;
    lastRun = null;
    const ok = save();
    draftToUi(); renderAll();
    if (ok) toast('已载入 5 套合成示例,并放进样例库。');
  }
  function loadSample() {
    if (hasData()) askConfirm('载入示例会替换当前' + dataScope().replace(/和样例库 \d+ 条$/, '') + ',并把 5 套合成示例加入样例库(同 id 的示例被覆盖,你自己的 ' + state.library.filter(e => e.id.indexOf('sample-') !== 0).length + ' 条保留)。', '确认替换', applySample);
    else applySample();
  }
  function clearAll() {
    askConfirm('确认清空全部数据:' + dataScope() + '?无法恢复,建议先下载 JSON 备份。', '确认清空', () => {
      state = C.defaultState(); lastRun = null;
      const ok = save(); draftToUi(); renderAll();
      if (ok) toast('已清空。');
    });
  }

  /* ---------- 导出 / 导入 ---------- */
  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function safeName(s) { return (s || '正则').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40) || '正则'; }

  function reportFresh() { return !!lastRun && !isStale(); }
  function updateExportState() {
    const parsed = C.parseCases(state.draft.cases);
    const csvOk = parsed.ok && parsed.cases.length > 0;
    $('export-csv').disabled = !csvOk;
    $('export-md').disabled = !reportFresh();
    const notes = [];
    if (!csvOk) notes.push(parsed.ok ? '样例表是空的,不能导出 CSV。' : '样例表有错误,不能导出 CSV。');
    if (!lastRun) notes.push('还没有运行结果,不能导出验收报告。');
    else if (isStale()) notes.push('输入已修改,请重新「运行验收」后再导出报告。');
    $('export-note').textContent = notes.join(' ');
    const pre = $('md-preview');
    pre.textContent = reportFresh() ? C.reportToMarkdown(lastRun) : '(运行验收后,这里显示报告)';
  }
  function showMsg(text, kind) {
    const m = $('data-msg');
    m.textContent = text; m.className = 'msg ' + (kind || ''); m.hidden = !text;
  }
  function readFile(input, cb) {
    const f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => cb(String(fr.result));
    fr.onerror = () => showMsg('读取文件失败。', 'err');
    fr.readAsText(f, 'utf-8');
  }

  function bindExports() {
    $('export-csv').onclick = () => {
      const parsed = C.parseCases(state.draft.cases);
      if (!parsed.ok || !parsed.cases.length) return;
      const withRes = reportFresh() && lastRun.results.length === parsed.cases.length ? lastRun.results : null;
      download(safeName(state.draft.name) + '-样例表.csv', C.toCsv(parsed.cases, withRes), 'text/csv;charset=utf-8');
      showMsg('已导出样例表 CSV' + (withRes ? '(含本次结果列,再导入时忽略结果列)。' : '。'), 'ok');
    };
    $('export-md').onclick = () => {
      if (!reportFresh()) return;
      download(safeName(lastRun.name) + '-验收报告.md', C.reportToMarkdown(lastRun), 'text/markdown;charset=utf-8');
      showMsg('已导出验收报告 Markdown。', 'ok');
    };
    $('export-json').onclick = () => {
      download('正则样例验收-备份.json', C.exportBackup(state), 'application/json');
      showMsg('已导出 JSON 备份(含草稿和样例库)。', 'ok');
    };
    $('import-csv').onchange = ev => readFile(ev.target, text => {
      const r = C.csvToCases(text);
      if (!r.ok) { showMsg('CSV 被整份拒绝,没有导入任何行:' + r.errors.slice(0, 5).join(';') + (r.errors.length > 5 ? ';还有 ' + (r.errors.length - 5) + ' 处' : ''), 'err'); return; }
      const apply = () => {
        state.draft.cases = C.formatCases(r.cases); $('cases').value = state.draft.cases;
        const ok = save(); renderStale(); renderLibrary();
        showMsg('已导入 ' + r.cases.length + ' 条样例到样例表' + (ok ? '。' : '(但未保存到本机)。'), ok ? 'ok' : 'err');
      };
      if (state.draft.cases.trim()) askConfirm('导入 CSV 会替换当前样例表(' + r.cases.length + ' 条新样例)。', '确认替换', apply); else apply();
    });
    $('import-json').onchange = ev => readFile(ev.target, text => {
      const r = C.validateImport(text);
      if (!r.ok) { showMsg('JSON 备份被整份拒绝,当前数据没有改动:' + r.error, 'err'); return; }
      const apply = () => {
        state = r.state; lastRun = null;
        const ok = save(); draftToUi(); renderAll();
        showMsg('已导入备份:样例库 ' + state.library.length + ' 条' + (ok ? '。' : '(但未保存到本机)。'), ok ? 'ok' : 'err');
      };
      if (hasData()) askConfirm('导入备份(样例库 ' + r.state.library.length + ' 条)会替换当前全部数据:' + dataScope() + '。', '确认替换', apply); else apply();
    });
  }

  /* ---------- 标签页与启动 ---------- */
  function setTab(name) {
    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    ['results', 'explain', 'library', 'export'].forEach(t => { $('tab-' + t).hidden = t !== name; });
  }
  function renderAll() { renderCompile(); renderResults(); renderExplain(); renderLibrary(); renderStale(); }

  function init() {
    loadStored();
    draftToUi();
    ['name', 'pattern', 'cases', 'max-input'].forEach(id => $(id).addEventListener('input', onDraftInput));
    C.FLAG_CHARS.split('').forEach(f => $('flag-' + f).addEventListener('change', onDraftInput));
    $('run').onclick = run;
    $('stop').onclick = () => { if (stopCtl && stopCtl.stop) { $('run-status').textContent = '正在停止…'; stopCtl.stop(); } };
    $('only-fail').onchange = renderResults;
    $('load-sample').onclick = loadSample;
    $('clear-data').onclick = clearAll;
    $('confirm-yes').onclick = () => { const f = pendingConfirm; closeConfirm(); if (f) f(); };
    $('confirm-no').onclick = closeConfirm;
    $('lib-save').onclick = () => saveEntry(false);
    $('lib-save-new').onclick = () => saveEntry(true);
    $('lib-search').addEventListener('input', renderLibrary);
    $('lib-list').addEventListener('click', ev => {
      const b = ev.target.closest('button[data-act]');
      if (!b) return;
      if (b.dataset.act === 'load') loadEntry(b.dataset.id); else deleteEntry(b.dataset.id);
    });
    document.querySelectorAll('.tabs button').forEach(b => { b.onclick = () => setTab(b.dataset.tab); });
    bindExports();
    renderAll();
  }
  init();
})();
