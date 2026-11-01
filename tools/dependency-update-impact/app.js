'use strict';
(function () {
  const C = globalThis.DepImpactCore;
  const SAMPLE = globalThis.DepImpactSample;
  const KEY = 'depimpact.v1';
  const $ = id => document.getElementById(id);

  // analyzed:最近一次分析时的输入文本;输入改动后与之不等 → 结果过期,禁用导出
  const state = { analyzed: null, analyzedSample: false, result: null, saveFailed: false };

  function target() { return $('target-wanted').checked ? 'wanted' : 'latest'; }
  // 当前输入与某个合成示例完全相同时才算「合成示例」;改动后标记消失
  function isSampleText(t) { return !!t && (t === SAMPLE.pair || t === SAMPLE.diff || t === SAMPLE.outdated); }
  function analyzedKey() { return $('input').value + '\u0001' + target(); }

  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    for (const k of Object.keys(attrs || {})) {
      if (k === 'text') el.textContent = attrs[k];
      else if (k === 'class') el.className = attrs[k];
      else el.setAttribute(k, attrs[k]);
    }
    for (const c of children || []) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return el;
  }

  // ---------- 存储 ----------
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ input: $('input').value, target: target() }));
      state.saveFailed = false;
      $('save-warning').hidden = true;
      $('save-status').textContent = '已保存到本机浏览器';
      return true;
    } catch (e) {
      state.saveFailed = true;
      $('save-warning').hidden = false;
      $('save-status').textContent = '';
      return false;
    }
  }

  function loadSaved() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { input: '', target: 'latest' };
      const parsed = JSON.parse(raw);
      return { input: typeof parsed.input === 'string' ? parsed.input : '', target: parsed.target === 'wanted' ? 'wanted' : 'latest' };
    } catch (e) {
      return { input: '', target: 'latest' };
    }
  }

  function download(name, text, type) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(new Blob([text], { type }));
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- 渲染 ----------
  function showError(msg) {
    $('error-text').textContent = msg;
    $('error-box').hidden = false;
    $('input').setAttribute('aria-describedby', 'error-box');
    $('input').setAttribute('aria-invalid', 'true');
  }
  function hideError() {
    $('error-box').hidden = true;
    $('input').removeAttribute('aria-describedby');
    $('input').removeAttribute('aria-invalid');
  }

  function renderSummary(result) {
    const ul = $('summary');
    ul.textContent = '';
    for (const k of C.KIND_ORDER) {
      const n = result.summary.counts[k];
      if (!n) continue;
      ul.appendChild(h('li', { class: 'sum-item tone-' + toneOf(k) }, [
        h('span', { class: 'sum-num', text: String(n) }),
        h('span', { class: 'sum-label', text: C.CATEGORY_LABELS[k] }),
      ]));
    }
    if (!result.changes.length) ul.appendChild(h('li', { class: 'sum-item tone-neutral', text: '没有检测到依赖变化' }));
    const att = result.summary.attention;
    $('attention-note').textContent = result.changes.length
      ? `共 ${result.summary.total} 项变化(每个包算一项),其中 ${att} 项需要重点关注(major、降级、预发布、非 semver、重复声明、移动区块)。`
      : '没有检测到依赖变化:两边的依赖和版本写法完全相同,或输入里没有依赖行。';
    let basis = '比较基准:' + result.basis + '。';
    if (result.kind === 'outdated') {
      basis += result.target === 'wanted'
        ? ' 当前按 Wanted(在现有范围内能装到的最高版本)比较,不会提示跨 major 的升级;要看最新版本请在输入区选 Latest 后重新分析。'
        : ' 当前按 Latest(registry 上的最新发布版本,可能跨 major)比较;Wanted 是在现有范围内能装到的最高版本,要按它比较请在输入区选 Wanted 后重新分析。';
    }
    $('basis-note').textContent = basis;
  }

  function toneOf(key) {
    if (key === 'major') return 'danger';
    if (key === 'minor') return 'warn';
    if (key === 'patch') return 'ok';
    if (key === 'downgrade' || key === 'prerelease' || key === 'nonsemver' || key === 'duplicate' || key === 'moved') return 'attn';
    return 'neutral';
  }

  function renderTable(result) {
    const body = $('changes-body');
    body.textContent = '';
    if (!result.changes.length) {
      const td = h('td', { colspan: '6', text: '没有检测到依赖变化:两边的依赖和版本写法完全相同,或输入里没有依赖行。' });
      body.appendChild(h('tr', {}, [td]));
      return;
    }
    for (const c of result.changes) {
      const a = C.advice(c);
      const tone = toneOf(a.key);
      const noteList = a.notes.length ? h('ul', { class: 'notes' }, a.notes.map(n => h('li', { text: n }))) : null;
      const adviceCell = h('td', { 'data-label': '影响说明' }, [h('span', { text: a.headline }), ...(noteList ? [noteList] : [])]);
      const row = h('tr', { class: 'row-' + tone }, [
        h('th', { scope: 'row', 'data-label': '包名', class: 'pkg', text: c.name }),
        h('td', { 'data-label': '区块', text: (C.SECTION_LABELS[c.section] || c.section) + (c.fromSection ? `(原 ${c.fromSection})` : '') }),
        h('td', { 'data-label': '分类' }, [h('span', { class: 'badge tone-' + tone, text: a.label })]),
        h('td', { 'data-label': '旧版本', text: c.from == null ? '—' : c.from }),
        h('td', { 'data-label': '新版本', text: c.to == null ? '—' : c.to }),
        adviceCell,
      ]);
      body.appendChild(row);
    }
  }

  function renderChecklist(result) {
    const box = $('checklist');
    box.textContent = '';
    const list = C.testChecklist(result.changes);
    if (!list.perPackage.length) box.appendChild(h('p', { class: 'hint', text: list.emptyNote + ' 下面是通用检查项。' }));
    for (const p of list.perPackage) {
      box.appendChild(h('h3', { class: 'sub-title', text: `${p.name}  ${p.from} → ${p.to}` }));
      box.appendChild(h('ul', { class: 'checks' }, p.items.map(t => h('li', {}, [h('span', { text: t })]))));
    }
    box.appendChild(h('h3', { class: 'sub-title', text: '通用' }));
    box.appendChild(h('ul', { class: 'checks' }, list.general.map(t => h('li', {}, [h('span', { text: t })]))));
  }

  function isFresh() {
    return state.result && state.result.ok && state.analyzed === analyzedKey();
  }

  function refreshExportState() {
    const fresh = isFresh();
    for (const id of ['export-md', 'export-csv', 'copy-md']) $(id).disabled = !fresh;
    $('stale-note').hidden = !state.result || fresh;
    $('export-status').textContent = fresh ? '' : (state.result ? '输入已改动,请重新分析后再导出。' : '');
  }

  function renderResult(result) {
    renderSummary(result);
    renderTable(result);
    renderChecklist(result);
    $('md-preview').value = C.toMarkdown(result.changes, { sample: state.analyzedSample, basis: result.basis });
    $('results').hidden = false;
    $('empty-state').hidden = true;
  }

  function analyze() {
    const text = $('input').value;
    const result = C.analyze(text, { target: target() });
    hideError();
    if (!result.ok) {
      state.result = null;
      state.analyzed = null;
      $('results').hidden = true;
      $('empty-state').hidden = false;
      showError(result.errors.map(e => e.message).join(';'));
      $('input').focus();
      refreshExportState();
      return;
    }
    state.result = result;
    state.analyzed = analyzedKey();
    state.analyzedSample = isSampleText(text);
    renderResult(result);
    refreshExportState();
  }

  function updateDetected() {
    const kind = C.detectInput($('input').value);
    $('detected').textContent = C.KIND_LABELS[kind];
    $('sample-badge').hidden = !isSampleText($('input').value);
  }

  function setInput(text) {
    $('input').value = text;
    updateDetected();
    save();
    analyze();
  }

  // ---------- 事件 ----------
  $('input').addEventListener('input', () => {
    hideError();
    updateDetected();
    save();
    refreshExportState();
  });
  $('analyze').addEventListener('click', analyze);
  for (const id of ['target-latest', 'target-wanted']) $(id).addEventListener('change', () => { save(); refreshExportState(); });
  // 载入示例 / 载入文件会替换:输入框内容(草稿)与偏离默认的目标列设置;确认文案写明范围
  let pending = null;
  function requestLoad(text, label) {
    const sc = C.inputScope($('input').value, target());
    if (sc.any && $('input').value !== text) {
      pending = text;
      $('clear-confirm').hidden = true;
      $('replace-q').textContent = `载入${label}会替换你现有的:${C.describeInputScope(sc)}。确定替换吗?`;
      $('replace-confirm').hidden = false;
      $('replace-yes').focus();
      return;
    }
    setInput(text);
  }
  $('load-sample').addEventListener('click', () => requestLoad(SAMPLE.pair, '合成示例(两份 package.json)'));
  $('load-sample-diff').addEventListener('click', () => requestLoad(SAMPLE.diff, '合成示例(git diff)'));
  $('load-sample-outdated').addEventListener('click', () => requestLoad(SAMPLE.outdated, '合成示例(npm outdated)'));
  $('replace-no').addEventListener('click', () => { pending = null; $('replace-confirm').hidden = true; $('input').focus(); });
  $('replace-yes').addEventListener('click', () => {
    const t = pending;
    pending = null;
    $('replace-confirm').hidden = true;
    if (t !== null) { $('target-latest').checked = true; setInput(t); $('input').focus(); }
  });

  // 从 TXT 文件载入:先检查(空文件、空字符、过大都拒绝),再走和示例相同的替换确认
  $('load-file-btn').addEventListener('click', () => $('load-file').click());
  $('load-file').addEventListener('change', ev => {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      const text = String(rd.result);
      const chk = C.checkTextFile(f.name, text);
      if (!chk.ok) { $('file-error').textContent = chk.error + ' 输入框没有改动。'; $('file-error').hidden = false; $('load-file-btn').focus(); return; }
      $('file-error').hidden = true;
      requestLoad(text, `文件「${f.name}」`);
    };
    rd.onerror = () => { $('file-error').textContent = '读取文件失败,输入框没有改动。'; $('file-error').hidden = false; };
    rd.readAsText(f);
  });
  function downloadInput() {
    const t = $('input').value;
    if (!t) return;
    download('依赖更新-原始输入.txt', t, 'text/plain;charset=utf-8');
    $('save-status').textContent = '已下载输入框里的全部原始内容';
  }
  $('download-input').addEventListener('click', downloadInput);
  $('download-input-warn').addEventListener('click', downloadInput);

  $('clear-btn').addEventListener('click', () => {
    const sc = C.inputScope($('input').value, target());
    $('clear-q').textContent = sc.any
      ? `确定清空吗?将清空:${C.describeInputScope(sc)},以及分析结果。清空后无法恢复。`
      : '输入框是空的,清空不会改变什么。';
    $('replace-confirm').hidden = true;
    $('clear-confirm').hidden = false;
    $('clear-yes').focus();
  });
  $('clear-no').addEventListener('click', () => { $('clear-confirm').hidden = true; $('clear-btn').focus(); });
  $('clear-yes').addEventListener('click', () => {
    $('input').value = '';
    $('target-latest').checked = true;
    state.result = null;
    state.analyzed = null;
    $('results').hidden = true;
    $('empty-state').hidden = false;
    hideError();
    $('clear-confirm').hidden = true;
    updateDetected();
    try { localStorage.removeItem(KEY); $('save-warning').hidden = true; $('save-status').textContent = '已清空本机保存的数据'; }
    catch (e) { state.saveFailed = true; $('save-warning').hidden = false; }
    refreshExportState();
    $('input').focus();
  });

  $('export-md').addEventListener('click', () => {
    if (!isFresh()) return;
    download('依赖更新影响说明.md', C.toMarkdown(state.result.changes, { sample: state.analyzedSample, basis: state.result.basis }), 'text/markdown;charset=utf-8');
    $('export-status').textContent = '已生成 依赖更新影响说明.md';
  });
  $('export-csv').addEventListener('click', () => {
    if (!isFresh()) return;
    download('依赖变更表.csv', '\uFEFF' + C.toCsv(state.result.changes, { sample: state.analyzedSample }), 'text/csv;charset=utf-8');
    $('export-status').textContent = '已生成 依赖变更表.csv';
  });
  $('copy-md').addEventListener('click', async () => {
    if (!isFresh()) return;
    const area = $('md-preview');
    try {
      await navigator.clipboard.writeText(area.value);
      $('export-status').textContent = '已复制到剪贴板';
    } catch (e) {
      area.focus();
      area.select();
      $('export-status').textContent = '浏览器不允许自动复制,内容已选中,请按 Ctrl+C 或 Cmd+C 复制。';
    }
  });

  // ---------- 启动 ----------
  const saved = loadSaved();
  if (saved.target === 'wanted') $('target-wanted').checked = true;
  if (saved.input) {
    $('input').value = saved.input;
    analyze();
  }
  updateDetected();
  refreshExportState();
})();
