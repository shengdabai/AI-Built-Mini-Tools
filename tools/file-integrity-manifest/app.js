'use strict';
(function () {
  const C = globalThis.FileCheckCore;
  const KEY = 'filecheck.v1';
  const RECOVERY_PREFIX = KEY + '.recovery.';
  const SMALL_FILE = 32 * 1024 * 1024; // 不超过此大小一次读入后用 Web Crypto;更大的分块读取
  const CHUNK = 4 * 1024 * 1024;
  const ROW_CAP = 500;
  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, '0');
  const realToday = (() => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; })();
  const today = C.todayFrom(location.search, realToday);

  const state = {
    ignore: C.DEFAULT_IGNORE.slice(),
    manifest: null, manifestName: '', manifestIsSample: false,
    genEntries: null, genManifest: null,
    actual: null, actualIsSample: false,
    result: null, busy: false,
    storage: { status: 'none', raw: null, reason: '', archiveKey: '', archiveVerified: false }
  };

  /* ---------- 工具 ---------- */
  const SVG = {
    missing: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
    extra: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    mismatch: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
    case: '<path d="M4 18l5-12 5 12M6 14h6M16 18v-5a3 3 0 0 1 5 0v5"/>',
    internal: '<path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z"/><path d="M12 8v5M12 16v.5"/>',
    ok: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
    name: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>'
  };
  function icon(kind) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'icon'); s.setAttribute('aria-hidden', 'true');
    s.innerHTML = SVG[kind]; // 常量字符串,不含用户输入
    return s;
  }
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function show(id, on) { $(id).hidden = !on; }
  function showError(id, msg) { const e = $(id); e.textContent = msg || ''; e.hidden = !msg; }
  let toastTimer = null;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3500); }

  /* ---------- 存储 ---------- */
  function storageObject() {
    return { ignore: state.ignore, manifest: state.manifest, manifestName: state.manifestName, manifestIsSample: state.manifestIsSample };
  }
  function storageJson(pretty) { return JSON.stringify(storageObject(), null, pretty ? 2 : 0); }
  function renderStorageNotice() {
    const s = state.storage; const box = $('recovery-warning');
    if (!box) return;
    if (s.status === 'invalid') {
      $('recovery-message').textContent = s.archiveVerified
        ? `原存档无效(${s.reason})。原文已校验存入恢复副本 ${s.archiveKey},当前页面使用默认或新内存状态。`
        : `原存档无效(${s.reason})。整份存档未加载。在原文完整存入恢复副本前,本页不会覆盖它。`;
      box.hidden = false; $('download-raw').hidden = false;
    } else if (s.status === 'read-error') {
      $('recovery-message').textContent = `读取本机存档失败(${s.reason})。这不等于“没有存档”。本页仅使用内存状态,且不会覆盖未知的原存档。`;
      box.hidden = false; $('download-raw').hidden = true;
    } else box.hidden = true;
  }
  function archiveCorruptRaw() {
    const raw = state.storage.raw;
    if (state.storage.archiveKey && localStorage.getItem(state.storage.archiveKey) === raw) {
      state.storage.archiveVerified = true; renderStorageNotice(); return true;
    }
    state.storage.archiveKey = ''; state.storage.archiveVerified = false;
    const base = RECOVERY_PREFIX + Date.now();
    let key = base; let suffix = 0;
    while (localStorage.getItem(key) !== null) key = base + '.' + (++suffix);
    localStorage.setItem(key, raw);
    if (localStorage.getItem(key) !== raw) throw new Error('恢复副本回读不一致');
    state.storage.archiveKey = key; state.storage.archiveVerified = true;
    renderStorageNotice();
    return true;
  }
  function save() {
    if (state.storage.status === 'read-error') {
      show('save-warning', true); renderStorageNotice(); return false;
    }
    try {
      if (state.storage.status === 'invalid') archiveCorruptRaw();
      const serialized = storageJson(false);
      localStorage.setItem(KEY, serialized);
      if (localStorage.getItem(KEY) !== serialized) throw new Error('主存档回读不一致');
      state.storage = { status: 'ok', raw: null, reason: '', archiveKey: '', archiveVerified: false };
      show('save-warning', false);
      renderStorageNotice();
      return true;
    } catch (e) {
      show('save-warning', true);
      renderStorageNotice();
      return false;
    }
  }
  function load() {
    let raw;
    try {
      raw = localStorage.getItem(KEY);
    } catch (e) {
      state.storage = { status: 'read-error', raw: null, reason: e.message || e.name, archiveKey: '', archiveVerified: false };
      return;
    }
    if (raw === null) return;
    try {
      const d = C.parseStoredState(raw);
      state.ignore = d.ignore; state.manifest = d.manifest; state.manifestName = d.manifestName; state.manifestIsSample = d.manifestIsSample;
      state.storage.status = 'ok';
    } catch (e) {
      state.storage = { status: 'invalid', raw, reason: e.message, archiveKey: '', archiveVerified: false };
    }
  }

  /* ---------- 失效:输入改动后旧结果不再可信 ---------- */
  function invalidate(reason) {
    const had = !!state.result;
    state.result = null;
    renderResult();
    const note = $('stale-note');
    note.textContent = had && reason ? `${reason}已改动,上一次的核对结果已作废,导出已禁用。请重新点「开始核对」。` : '';
    note.hidden = !(had && reason);
    updateRunButton();
  }
  function updateRunButton() { $('run-check').disabled = state.busy || !(state.manifest && state.actual); }

  /* ---------- 哈希 ---------- */
  const tick = () => new Promise(r => setTimeout(r, 0));
  const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');

  async function hashFile(file, onPartial) {
    if (file.size <= SMALL_FILE && globalThis.crypto && crypto.subtle) {
      try { return hex(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())); } catch (e) { /* 回退到分块实现 */ }
    }
    const h = new C.Sha256();
    for (let o = 0; o < file.size; o += CHUNK) {
      h.update(new Uint8Array(await file.slice(o, Math.min(o + CHUNK, file.size)).arrayBuffer()));
      onPartial(Math.min(o + CHUNK, file.size));
      await tick();
    }
    return h.digest();
  }

  function stripRoot(items) {
    if (items.length && items.every(i => i.path.includes('/'))) {
      const first = items[0].path.split('/')[0];
      if (items.every(i => i.path.split('/')[0] === first)) return items.map(i => ({ file: i.file, path: i.path.slice(first.length + 1) }));
    }
    return items;
  }

  // items: [{file, path}] → 哈希后的条目数组
  async function hashAll(items, prefix) {
    const norm = stripRoot(items.map(i => ({ file: i.file, path: C.normalizePath(i.path) })));
    const todo = norm.filter(i => !C.shouldIgnore(i.path, state.ignore));
    const total = todo.reduce((n, i) => n + i.file.size, 0) || 1;
    const bar = $(prefix + '-bar'); const txt = $(prefix + '-progress-text');
    show(prefix + '-progress', true); bar.value = 0;
    const out = []; let done = 0;
    for (let k = 0; k < todo.length; k++) {
      const { file, path } = todo[k];
      txt.textContent = `已处理 ${k}/${todo.length} 个文件 · 正在计算:${path}`;
      const sha256 = await hashFile(file, p => { bar.value = (done + p) / total; txt.textContent = `已处理 ${k}/${todo.length} 个文件 · 正在计算:${path}(${Math.round(p / file.size * 100)}%)`; });
      done += file.size; bar.value = done / total;
      out.push({ path, size: file.size, sha256, mtime: new Date(file.lastModified).toISOString() });
      if (k % 20 === 19) await tick();
    }
    txt.textContent = `完成:${todo.length} 个文件已计算,${norm.length - todo.length} 个按忽略列表跳过。`;
    return { entries: out, skipped: norm.length - todo.length };
  }

  /* ---------- 文件来源:选择与拖入 ---------- */
  function fromInput(input) { return Array.from(input.files || []).map(f => ({ file: f, path: f.webkitRelativePath || f.name })); }

  function readAllEntries(reader) {
    return new Promise((resolve, reject) => {
      const all = [];
      const next = () => reader.readEntries(batch => { if (!batch.length) resolve(all); else { all.push(...batch); next(); } }, reject);
      next();
    });
  }
  async function walk(entry, out) {
    if (entry.isFile) { const file = await new Promise((res, rej) => entry.file(res, rej)); out.push({ file, path: entry.fullPath.replace(/^\//, '') }); }
    else if (entry.isDirectory) for (const c of await readAllEntries(entry.createReader())) await walk(c, out);
  }
  async function fromDrop(dt) {
    const out = [];
    const entries = Array.from(dt.items || []).map(i => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
    if (entries.length) { for (const e of entries) await walk(e, out); return out; }
    return Array.from(dt.files || []).map(f => ({ file: f, path: f.name }));
  }
  function wireDrop(zoneId, handler, inputId) {
    const z = $(zoneId);
    z.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $(inputId).click(); } });
    ['dragenter', 'dragover'].forEach(t => z.addEventListener(t, e => { e.preventDefault(); z.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(t => z.addEventListener(t, e => { e.preventDefault(); z.classList.remove('over'); }));
    z.addEventListener('drop', async e => { try { handler(await fromDrop(e.dataTransfer)); } catch (err) { toast('读取拖入内容失败:' + err.message); } });
  }

  /* ---------- 生成清单 ---------- */
  async function runGenerate(items) {
    if (state.busy) return;
    // 开始读取即作废旧清单,处理中或失败后都不能导出旧内容
    state.genEntries = null; state.genManifest = null; renderGen();
    showError('gen-error', '');
    if (!items.length) { showError('gen-error', '没有读取到文件。请选择一个含文件的文件夹。'); return; }
    state.busy = true; updateRunButton();
    try {
      const { entries, skipped } = await hashAll(items, 'gen');
      state.genEntries = entries;
      state.genManifest = C.buildManifest(entries, { generatedAt: today });
      state.genSkipped = skipped;
      renderGen();
    } catch (e) {
      showError('gen-error', '生成失败:' + e.message);
    } finally { state.busy = false; updateRunButton(); }
  }

  function chip(kind, label, n) {
    const c = el('span', 'chip st-' + kind); c.appendChild(icon(kind));
    c.appendChild(document.createTextNode(label + ' ')); c.appendChild(el('strong', null, String(n))); return c;
  }
  function plainChip(label, value) { const c = el('span', 'chip'); c.appendChild(document.createTextNode(label + ' ')); c.appendChild(el('strong', null, value)); return c; }

  function renderGen() {
    const m = state.genManifest;
    show('gen-result', !!m);
    if (!m) return;
    $('gen-unsaved').hidden = state.manifest === m;
    const sum = $('gen-summary'); sum.textContent = '';
    sum.appendChild(plainChip('文件数', String(m.files.length)));
    sum.appendChild(plainChip('总大小', C.formatSize(m.files.reduce((n, f) => n + f.size, 0))));
    sum.appendChild(plainChip('已忽略', String(state.genSkipped || 0)));
    const warns = m.files.map(f => ({ path: f.path, issues: C.checkName(f.path) })).filter(w => w.issues.length);
    const wbox = $('gen-warnings'); wbox.textContent = '';
    if (warns.length) {
      wbox.appendChild(el('h3', null, `跨平台文件名警告(${warns.length})`));
      const ul = el('ul', 'warn-list');
      warns.forEach(w => w.issues.forEach(i => { const li = el('li'); li.appendChild(icon('name')); li.appendChild(el('span', null, `${w.path}:${i.message}`)); ul.appendChild(li); }));
      wbox.appendChild(ul);
    }
    const list = $('gen-list'); list.textContent = '';
    m.files.slice(0, ROW_CAP).forEach(f => { const li = el('li'); li.appendChild(el('span', null, f.path)); li.appendChild(el('span', 'size', C.formatSize(f.size))); list.appendChild(li); });
    if (m.files.length > ROW_CAP) list.appendChild(el('li', 'muted', `只预览前 ${ROW_CAP} 个,导出的清单包含全部 ${m.files.length} 个。`));
  }

  /* ---------- 清单导入 ---------- */
  function setManifest(m, name, isSample) {
    state.manifest = m; state.manifestName = name; state.manifestIsSample = !!isSample;
    showError('man-error', '');
    renderManifest();
    invalidate('清单');
    const ok = save();
    if (ok) toast(`已导入清单:${m.files.length} 个文件。`);
  }
  function renderManifest() {
    const m = state.manifest;
    show('man-sample-badge', !!m && state.manifestIsSample);
    $('export-current').disabled = !m;
    $('man-summary').textContent = m ? `当前清单:${state.manifestName} · ${m.files.length} 个文件 · ${C.formatSize(m.files.reduce((n, f) => n + f.size, 0))}` : '尚未导入清单。';
    updateRunButton();
  }
  function tryParse(text, name) {
    try { const m = C.parseManifest(text); setManifest(m, name, !!m.sample); }
    catch (e) { showError('man-error', '清单被拒绝,未导入:' + e.message); }
  }

  /* ---------- 核对 ---------- */
  async function runActual(items) {
    if (state.busy) return;
    // 开始读取即作废旧结果,处理中或失败后都不能导出旧报告
    state.actual = null; state.actualIsSample = false; $('act-summary').textContent = '';
    invalidate('收到的文件');
    showError('act-error', '');
    if (!items.length) { showError('act-error', '没有读取到文件。请选择一个含文件的文件夹。'); return; }
    state.busy = true; updateRunButton();
    try {
      const { entries, skipped } = await hashAll(items, 'act');
      state.actual = entries; state.actualIsSample = false; state.actualSkipped = skipped;
      $('act-summary').textContent = `已读取 ${entries.length} 个文件(${C.formatSize(entries.reduce((n, f) => n + f.size, 0))})。`;
    } catch (e) { showError('act-error', '读取失败:' + e.message); }
    finally { state.busy = false; updateRunButton(); }
  }

  function runCompare() {
    try {
      state.result = C.compare(state.manifest, state.actual, { ignore: state.ignore });
      $('stale-note').hidden = true;
      renderResult();
    } catch (e) { state.result = null; renderResult(); showError('act-error', '核对失败:' + e.message); }
  }

  function renderResult() {
    const r = state.result;
    show('result', !!r);
    if (!r) return;
    const s = r.stats;
    show('sample-badge', state.actualIsSample || state.manifestIsSample);
    const v = $('verdict');
    v.className = 'verdict ' + (s.clean ? 'good' : 'bad');
    v.textContent = s.clean ? `清单与文件一致:${s.ok} 个文件全部通过。` : `发现差异:缺失 ${s.missing}、多出 ${s.extra}、哈希不一致 ${s.mismatched}、大小写差异 ${s.caseDiff}、内部错误 ${s.internal}。`;
    const sum = $('summary'); sum.textContent = '';
    sum.appendChild(plainChip('清单文件', String(s.manifestFiles)));
    sum.appendChild(plainChip('实际文件', String(s.actualFiles)));
    sum.appendChild(plainChip('总大小', C.formatSize(s.actualSize)));
    sum.appendChild(chip('missing', '缺失', s.missing)); sum.appendChild(chip('extra', '多出', s.extra));
    sum.appendChild(chip('mismatch', '哈希不一致', s.mismatched)); sum.appendChild(chip('case', '大小写差异', s.caseDiff));
    sum.appendChild(chip('internal', '内部错误', s.internal)); sum.appendChild(chip('name', '文件名警告', s.nameWarnings));
    sum.appendChild(chip('ok', '一致', s.ok)); sum.appendChild(plainChip('已忽略', String(s.ignored)));
    renderRows();
  }

  function renderRows() {
    const r = state.result; if (!r) return;
    const f = $('filter-status').value; const q = $('filter-text').value.trim().toLowerCase();
    let rows = C.flattenRows(r);
    if (f === 'attention') rows = rows.filter(x => x.status !== 'ok'); else if (f !== 'all') rows = rows.filter(x => x.status === f);
    if (q) rows = rows.filter(x => x.path.toLowerCase().includes(q));
    const ul = $('rows'); ul.textContent = '';
    rows.slice(0, ROW_CAP).forEach(x => {
      const li = el('li', 'st-' + x.status);
      const st = el('span', 'status'); st.appendChild(icon(x.status)); st.appendChild(document.createTextNode(C.STATUS_LABEL[x.status]));
      li.appendChild(st); li.appendChild(el('span', 'path', x.path)); li.appendChild(el('span', 'detail', x.detail));
      ul.appendChild(li);
    });
    $('row-count').textContent = rows.length ? `显示 ${Math.min(rows.length, ROW_CAP)} / ${rows.length} 条` + (rows.length > ROW_CAP ? `(超出部分请收窄筛选,或导出完整报告)` : '') : '没有符合筛选条件的项目。';
  }

  /* ---------- 导出 ---------- */
  function download(name, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------- 绑定 ---------- */
  function setTab(t) {
    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    show('tab-gen', t === 'gen'); show('tab-check', t === 'check');
  }

  function onIgnoreChange() {
    const list = $('ignore-list').value.split('\n').map(x => x.trim()).filter(Boolean);
    state.ignore = list;
    const ok = save();
    $('ignore-note').textContent = ok ? '已保存。忽略列表改动后,需要重新选择文件才会生效。' : '未保存。';
    // 哈希时已按旧规则跳过文件,改动后旧数据不再可信
    if (state.genEntries) { state.genEntries = null; state.genManifest = null; renderGen(); show('gen-progress', false); showError('gen-error', '忽略列表已改动,请重新选择文件夹生成清单。'); }
    if (state.actual && !state.actualIsSample) { state.actual = null; $('act-summary').textContent = ''; show('act-progress', false); }
    invalidate('忽略列表');
  }

  function bind() {
    $('ignore-list').value = state.ignore.join('\n');
    $('ignore-list').addEventListener('change', onIgnoreChange);
    $('ignore-reset').addEventListener('click', () => { $('ignore-list').value = C.DEFAULT_IGNORE.join('\n'); onIgnoreChange(); });
    $('download-raw').addEventListener('click', () => {
      if (state.storage.raw === null) return;
      download(`损坏存档原文-${today}.txt`, state.storage.raw, 'text/plain');
    });
    const exportMemory = () => download(`当前有效状态-${today}.json`, storageJson(true), 'application/json');
    $('export-memory').addEventListener('click', exportMemory);
    $('export-memory-unsaved').addEventListener('click', exportMemory);
    document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

    $('gen-dir').addEventListener('change', e => { runGenerate(fromInput(e.target)); });
    wireDrop('gen-drop', runGenerate, 'gen-dir');
    $('export-json').addEventListener('click', () => {
      if (!state.genManifest) return;
      download(`文件清单-${today}.json`, JSON.stringify(state.genManifest, null, 2), 'application/json');
    });
    $('export-csv').addEventListener('click', () => {
      if (!state.genManifest) return;
      download(`文件清单-${today}.csv`, C.toCsv(state.genManifest), 'text/csv');
    });
    $('use-generated').addEventListener('click', () => {
      if (!state.genManifest) return;
      setManifest(state.genManifest, '刚生成的清单', false); renderGen(); setTab('check');
    });

    $('export-current').addEventListener('click', () => {
      if (!state.manifest) return;
      const tag = state.manifestIsSample ? '合成示例-' : '';
      download(`文件清单-${tag}${today}.json`, JSON.stringify(state.manifest, null, 2), 'application/json');
    });
    $('man-file').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      try { tryParse(await f.text(), f.name); } catch (err) { showError('man-error', '读取清单文件失败:' + err.message); }
    });
    $('man-parse').addEventListener('click', () => tryParse($('man-text').value, '粘贴的清单'));

    $('act-dir').addEventListener('change', e => { runActual(fromInput(e.target)); });
    wireDrop('act-drop', runActual, 'act-dir');
    $('run-check').addEventListener('click', runCompare);
    $('filter-status').addEventListener('change', renderRows);
    $('filter-text').addEventListener('input', renderRows);

    $('export-md').addEventListener('click', () => {
      if (!state.result) return;
      download(`核对报告-${today}.md`, C.reportToMarkdown(state.result, { date: today, manifestName: state.manifestName + (state.actualIsSample ? '(合成示例)' : '') }), 'text/markdown');
    });
    $('export-report-csv').addEventListener('click', () => {
      if (!state.result) return;
      download(`核对报告-${today}.csv`, C.reportToCsv(state.result), 'text/csv');
    });

    function applySample() {
      const S = globalThis.FILECHECK_SAMPLE;
      state.manifest = S.manifest; state.manifestName = S.manifestName; state.manifestIsSample = true;
      state.actual = S.actual; state.actualIsSample = true;
      showError('man-error', ''); showError('act-error', '');
      renderManifest();
      $('act-summary').textContent = `合成示例:${S.actual.length} 个文件(含一个 .DS_Store)。`;
      runCompare(); setTab('check');
      const ok = save();
      if (ok) toast('已载入合成示例。');
    }
    $('load-sample').addEventListener('click', () => {
      // 已有清单或收到的文件时,先在页内确认,避免覆盖并保存
      const ignoreChanged = state.ignore.join('\n') !== C.DEFAULT_IGNORE.join('\n');
      if (state.manifest || state.actual || state.genManifest || ignoreChanged) show('sample-confirm', true); else applySample();
    });
    $('sample-yes').addEventListener('click', () => { show('sample-confirm', false); applySample(); });
    $('sample-no').addEventListener('click', () => show('sample-confirm', false));

    $('clear-data').addEventListener('click', () => show('clear-confirm', true));
    $('clear-no').addEventListener('click', () => show('clear-confirm', false));
    $('clear-yes').addEventListener('click', () => {
      if (state.storage.status === 'read-error') {
        show('clear-confirm', false); show('save-warning', true); renderStorageNotice();
        toast('无法确认原存档状态,未清空任何数据。');
        return;
      }
      state.ignore = C.DEFAULT_IGNORE.slice(); state.manifest = null; state.manifestName = ''; state.manifestIsSample = false;
      state.genEntries = null; state.genManifest = null; state.actual = null; state.actualIsSample = false; state.result = null;
      $('ignore-list').value = state.ignore.join('\n');
      $('man-text').value = ''; $('act-summary').textContent = ''; $('stale-note').hidden = true;
      show('gen-progress', false); show('act-progress', false);
      renderGen(); renderManifest(); renderResult(); show('clear-confirm', false);
      try { localStorage.removeItem(KEY); show('save-warning', false); toast('数据已清空。'); } catch (e) { show('save-warning', true); }
    });
  }

  load();
  bind();
  renderStorageNotice();
  (function showToday() {
    const fixed = C.todayFrom(location.search, '');
    const n = $('today-note');
    if (fixed) { n.textContent = `基准日 ${fixed}(由地址参数固定)`; n.hidden = false; }
  })();
  renderManifest();
  renderGen();
  renderResult();
})();
