'use strict';
(function () {
  const C = globalThis.NoteSearchCore;
  const SAMPLE = globalThis.NOTESEARCH_SAMPLE;
  const SETTINGS_KEY = 'notesearch.v1';
  const IDB_NAME = 'notesearch.v1';
  const IDB_KEY = 'index';
  const PAGE_SIZE = 50;
  const BATCH = 32;
  const TODAY = C.parseToday(location.search);
  const $ = id => document.getElementById(id);
  const nf = n => Number(n).toLocaleString('zh-CN');

  const state = {
    index: null, busy: false,
    results: [], resultsIndex: null, lastQuery: null, shown: 0,
    stopwords: C.DEFAULT_STOPWORDS.slice(), coTerm: ''
  };
  let pending = null;
  let toastTimer = null;

  // ---------- 小工具 ----------
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function fmtDate(ms) {
    const d = new Date(ms);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }
  // 持续可见的警告:按 key 保存,直到对应问题解除
  const warnings = new Map();
  function warn(key, msg) {
    let p = warnings.get(key);
    if (!p) { p = el('p', 'warning'); p.dataset.key = key; warnings.set(key, p); $('warnings').appendChild(p); }
    p.textContent = msg;
  }
  function clearWarn(key) {
    const p = warnings.get(key);
    if (p) { p.remove(); warnings.delete(key); }
  }
  function download(name, text, type) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(new Blob([text], { type: type || 'text/plain;charset=utf-8' }));
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const tick = () => new Promise(r => setTimeout(r, 0));

  // ---------- 设置(localStorage) ----------
  function saveSettings() {
    const settings = { version: 1, stopwords: state.stopwords };
    const v = C.validateSettings(settings);
    if (!v.ok) { warn('settings', `停用词没有保存:${v.error}。`); return false; }
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      clearWarn('settings');
      return true;
    } catch (e) {
      warn('settings', '未保存:浏览器拒绝写入停用词设置(存储已满或被禁用)。当前设置只在本页内存里,刷新后会丢失;请把文本框里的停用词复制到别处备份。');
      return false;
    }
  }
  function loadSettings() {
    let raw = null;
    try { raw = localStorage.getItem(SETTINGS_KEY); }
    catch (e) { warn('settings', '浏览器存储不可用,停用词设置无法保存,刷新后恢复默认。'); return; }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const v = C.validateSettings(parsed);
      if (v.ok) state.stopwords = parsed.stopwords;
      else warn('settings', `已保存的停用词设置无法读取(${v.error}),本次使用默认停用词;再次保存会覆盖它。`);
    } catch (e) {
      warn('settings', '已保存的停用词设置不是有效 JSON,本次使用默认停用词;再次保存会覆盖它。');
    }
  }

  // ---------- IndexedDB 缓存 ----------
  function idbOpen() {
    return new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(IDB_NAME, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'));
      req.onblocked = () => reject(new Error('IndexedDB 被其他页面占用'));
    });
  }
  async function idbRun(mode, fn) {
    const db = await idbOpen();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('kv', mode);
        const req = fn(tx.objectStore('kv'));
        tx.oncomplete = () => resolve(req && req.result);
        tx.onerror = () => reject(tx.error || new Error('IndexedDB 事务失败'));
        tx.onabort = () => reject(tx.error || new Error('IndexedDB 事务中止'));
      });
    } finally { db.close(); }
  }
  async function cacheIndex(idx) {
    const v = C.validateIndex(idx);
    if (!v.ok) { warn('cache', `索引没有缓存:${v.error}。索引只在内存里,刷新后需重新选择文件夹。`); return false; }
    try {
      await idbRun('readwrite', s => s.put(idx, IDB_KEY));
      clearWarn('cache');
      $('cache-status').textContent = '索引已缓存到 IndexedDB,下次打开可直接搜索。文件有变更时需重新选择文件夹重建。';
      return true;
    } catch (e) {
      $('cache-status').textContent = '';
      warn('cache', `未缓存:浏览器拒绝写入索引缓存(${e && e.message ? e.message : '未知错误'})。索引只在内存里,刷新后需重新选择文件夹;当前可先导出搜索结果或统计 CSV。`);
      return false;
    }
  }
  async function loadCached() {
    try {
      const idx = await idbRun('readonly', s => s.get(IDB_KEY));
      if (!idx) return;
      const v = C.validateIndex(idx);
      if (!v.ok) { warn('cache', `缓存里的索引无法读取(${v.error}),已忽略。请重新选择文件夹重建。`); return; }
      clearWarn('cache');
      setIndex(idx);
      $('cache-status').textContent = `已从 IndexedDB 缓存载入(索引日期 ${idx.builtDate || '未知'})。文件有变更时需重新选择文件夹重建。`;
    } catch (e) {
      warn('cache', `此浏览器不允许使用索引缓存(${e && e.message ? e.message : '未知错误'})。索引只在内存里,刷新后需重新选择文件夹。`);
    }
  }

  // ---------- 渲染 ----------
  function setBusy(b) {
    state.busy = b;
    for (const id of ['btn-pick-folder', 'btn-pick-files', 'pick-folder', 'pick-files', 'load-sample', 'ext-extra', 'clear-cache']) $(id).disabled = b || (id === 'clear-cache' && !state.index);
    $('dropzone').classList.toggle('disabled', b);
  }
  function setIndex(idx) {
    state.index = idx;
    showProblemNotes('');
    state.results = []; state.resultsIndex = null; state.lastQuery = null; state.shown = 0;
    state.coTerm = '';
    renderLibrary();
    renderResults();
    renderCo([]);
    $('co-note').textContent = '';
    renderRecent();
  }
  function renderLibrary() {
    const idx = state.index;
    const st = idx ? idx.stats : { fileCount: 0, charCount: 0, paraCount: 0, termCount: 0 };
    $('s-files').textContent = nf(st.fileCount);
    $('s-chars').textContent = nf(st.charCount);
    $('s-paras').textContent = nf(st.paraCount);
    $('s-terms').textContent = nf(st.termCount);
    $('lib-meta').textContent = idx
      ? `来源:${idx.source || '未知'} · 索引日期 ${idx.builtDate || '未知'}`
      : '还没有索引。选择文件夹,或点右上角「载入示例」。';
    if (!idx) $('cache-status').textContent = '';
    const has = !!idx;
    $('q').disabled = !has; $('do-search').disabled = !has;
    $('co-go').disabled = !has;
    $('export-csv').disabled = !has;
    $('clear-cache').disabled = !has || state.busy;
    $('result-meta').textContent = has ? '输入搜索语句后点「搜索」。' : '载入笔记库后即可搜索。';
  }
  function renderRecent() {
    const list = $('recent-list');
    list.textContent = '';
    const rec = state.index ? C.recentFiles(state.index, 20) : [];
    $('recent-empty').hidden = rec.length > 0;
    if (state.index && !rec.length) { $('recent-empty').hidden = false; $('recent-empty').textContent = '这些文件没有修改时间信息。'; }
    else $('recent-empty').textContent = '载入笔记库后显示最近修改的 20 个文件。';
    for (const f of rec) {
      const li = el('li', 'recent-item');
      li.appendChild(el('span', 'date', fmtDate(f.mtime)));
      li.appendChild(el('code', 'path', f.path));
      list.appendChild(li);
    }
  }
  function appendHighlighted(parent, text, ranges) {
    let pos = 0;
    for (const [s, e] of ranges) {
      if (s > pos) parent.appendChild(document.createTextNode(text.slice(pos, s)));
      parent.appendChild(el('mark', '', text.slice(s, e)));
      pos = e;
    }
    if (pos < text.length) parent.appendChild(document.createTextNode(text.slice(pos)));
  }
  function paraBlock(label, text, terms, current) {
    const box = el('div', current ? 'ctx-para current' : 'ctx-para');
    box.appendChild(el('span', 'ctx-label', label));
    const body = el('p', 'ctx-text');
    appendHighlighted(body, text, current ? C.highlights(text, terms) : []);
    box.appendChild(body);
    return box;
  }
  function hitEl(r) {
    const art = el('article', 'hit');
    const head = el('div', 'hit-head');
    head.appendChild(el('code', 'path', r.path));
    head.appendChild(el('span', 'badge', `第 ${r.para} 段`));
    if (r.titleHit) head.appendChild(el('span', 'badge accent', '标题命中'));
    art.appendChild(head);
    const sn = el('p', 'snippet');
    if (r.snippet.head) sn.appendChild(document.createTextNode('…'));
    appendHighlighted(sn, r.snippet.text, r.snippet.highlights);
    if (r.snippet.tail) sn.appendChild(document.createTextNode('…'));
    art.appendChild(sn);
    const btn = el('button', 'link', '展开整段与上下段');
    btn.type = 'button'; btn.setAttribute('aria-expanded', 'false');
    const ctx = el('div', 'ctx'); ctx.hidden = true;
    btn.onclick = () => {
      const open = ctx.hidden;
      if (open && !ctx.childElementCount) {
        const paras = state.resultsIndex.docs[r.docId].paras;
        if (r.para > 1) ctx.appendChild(paraBlock(`上一段 · 第 ${r.para - 1} 段`, paras[r.para - 2], r.terms, false));
        ctx.appendChild(paraBlock(`本段 · 第 ${r.para} 段`, r.text, r.terms, true));
        if (r.para < paras.length) ctx.appendChild(paraBlock(`下一段 · 第 ${r.para + 1} 段`, paras[r.para], r.terms, false));
      }
      ctx.hidden = !open;
      btn.textContent = open ? '收起' : '展开整段与上下段';
      btn.setAttribute('aria-expanded', String(open));
    };
    art.appendChild(btn); art.appendChild(ctx);
    return art;
  }
  function renderResults() {
    const box = $('results');
    box.textContent = '';
    const shown = state.results.slice(0, state.shown);
    for (const r of shown) box.appendChild(hitEl(r));
    $('rank-box').hidden = !state.results.length;
    $('more').hidden = state.results.length <= state.shown;
    $('more').textContent = `显示更多(还有 ${state.results.length - state.shown} 条)`;
    syncExport();
  }
  function syncExport() {
    const fresh = state.lastQuery !== null && state.results.length > 0 && state.resultsIndex === state.index && $('q').value === state.lastQuery;
    $('export-md').disabled = !fresh;
    const stale = state.results.length > 0 && !fresh;
    $('export-hint').hidden = !stale;
    $('export-hint').textContent = stale ? '搜索框的内容已改动,下面还是上一次的结果。点「搜索」重新搜索后才能导出。' : '';
  }
  function renderCo(list) {
    const ol = $('co-list');
    ol.textContent = '';
    for (const item of list) {
      const li = el('li');
      const b = el('button', 'chip');
      b.type = 'button';
      b.appendChild(document.createTextNode(item.term + ' '));
      b.appendChild(el('span', 'chip-count', `共同出现于 ${item.count} 个段落`));
      b.title = `与关键词共同出现于 ${item.count} 个段落;点击用「${item.term}」搜索`;
      b.onclick = () => { $('q').value = item.term; runSearch(); $('q').focus(); };
      li.appendChild(b); ol.appendChild(li);
    }
  }

  // ---------- 搜索与共现 ----------
  function runSearch() {
    if (!state.index) return;
    const q = $('q').value;
    const parsed = C.parseQuery(q);
    state.lastQuery = q; state.resultsIndex = state.index; state.shown = PAGE_SIZE;
    if (!parsed.must.length && !parsed.phrases.length) {
      state.results = [];
      $('result-meta').textContent = '请输入至少一个要包含的词或短语(只有排除词或路径无法搜索)。';
      renderResults(); return;
    }
    state.results = C.search(state.index, parsed);
    const files = new Set(state.results.map(r => r.docId)).size;
    const warns = parsed.warnings.length ? ` · ${parsed.warnings.join(';')}` : '';
    $('result-meta').textContent = state.results.length
      ? `命中 ${nf(state.results.length)} 个段落,来自 ${nf(files)} 个文件${warns}。按命中密度排序,标题或文件名命中加权。`
      : `没有命中${warns}`;
    renderResults();
  }
  function runCo() {
    if (!state.index) return;
    const term = $('co-term').value;
    const parsed = C.parseQuery(term);
    state.coTerm = term;
    if (!parsed.must.length && !parsed.phrases.length) { renderCo([]); $('co-note').textContent = '请输入一个关键词。'; return; }
    const list = C.cooccur(state.index, term, 20, state.stopwords);
    renderCo(list);
    $('co-note').textContent = list.length
      ? `「${term.trim()}」所在段落里最常同现的 ${list.length} 个词。词旁的数字 = 它与「${term.trim()}」共同出现的段落数,同一段里重复出现只计 1 次;中文按相邻两个字的组合(二元组)统计,所以会看到两个字的片段。点一个词即可搜索。`
      : '没有共现词:该词没有命中,或全部被停用词过滤。';
  }

  // ---------- 导入 ----------
  function requestReplace(text, run) {
    if (!state.index) { run(); return; }
    pending = run;
    $('confirm-text').textContent = `${text}(当前索引:${nf(state.index.stats.fileCount)} 个文件,来源 ${state.index.source || '未知'};确认前保持原状)`;
    $('confirm').hidden = false;
    $('confirm-no').focus();
  }
  function relPath(f) {
    const r = f.webkitRelativePath;
    return r && r.includes('/') ? r.slice(r.indexOf('/') + 1) : f.name;
  }
  function uniquePaths(files) {
    const seen = new Map();
    return files.map(f => {
      const base = relPath(f);
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      if (n === 1) return base;
      const i = base.lastIndexOf('.');
      return i > 0 ? `${base.slice(0, i)} (${n})${base.slice(i)}` : `${base} (${n})`;
    });
  }
  function startImport(fileList, label) {
    if (state.busy) return;
    const { exts, invalid } = C.normalizeExts($('ext-extra').value);
    const extNote = $('ext-note');
    extNote.hidden = !invalid.length;
    extNote.textContent = invalid.length ? `已忽略无效后缀:${invalid.join(' ')}` : '';
    const files = Array.from(fileList);
    const picked = files.filter(f => C.isNoteFile(f.name, exts));
    $('selection-note').textContent = `选中 ${nf(files.length)} 个文件,其中 ${nf(picked.length)} 个是笔记文件。`;
    if (!picked.length) {
      $('selection-note').textContent += '没有可读取的笔记文件,索引保持不变。';
      return;
    }
    requestReplace(`用「${label}」的 ${nf(picked.length)} 个笔记文件重建索引并替换当前索引?`, () => readAndBuild(picked, label));
  }
  // 空白笔记、非 UTF-8 笔记照样建索引,但单独提示:它们搜不到内容
  function showProblemNotes(text) {
    const el = $('note-problems');
    el.textContent = text;
    el.hidden = !text;
  }
  async function readAndBuild(files, label) {
    setBusy(true);
    const paths = uniquePaths(files);
    const docs = [];
    let failed = 0, chars = 0;
    $('progress-box').hidden = false;
    $('progress').max = files.length; $('progress').value = 0;
    for (let i = 0; i < files.length; i += BATCH) {
      const batch = files.slice(i, i + BATCH);
      const got = await Promise.all(batch.map(async (f, k) => {
        try { return { path: paths[i + k], text: await f.text(), mtime: f.lastModified }; }
        catch (e) { failed++; return null; }
      }));
      for (const d of got) if (d) { docs.push(d); chars += C.countChars(d.text); }
      $('progress').value = Math.min(files.length, i + batch.length);
      $('progress-text').textContent = `已读取 ${nf(Math.min(files.length, i + batch.length))} / ${nf(files.length)} 个文件 · 累计 ${nf(chars)} 字`;
      await tick();
    }
    if (!docs.length) {
      $('progress-text').textContent = '所有文件都读取失败,索引保持不变。';
      setBusy(false); return;
    }
    $('progress-text').textContent = `读取完成:${nf(docs.length)} 个文件 · ${nf(chars)} 字;正在建立索引…`;
    await tick();
    const idx = C.buildIndex(docs, { builtDate: TODAY, source: label });
    setIndex(idx);
    showProblemNotes(C.describeProblemNotes(C.findProblemNotes(docs)));
    $('progress-text').textContent = `索引完成:${nf(docs.length)} 个文件 · ${nf(chars)} 字${failed ? ` · ${failed} 个文件读取失败已跳过` : ''}`;
    if (failed) $('selection-note').textContent += ` 读取失败 ${failed} 个,已跳过。`;
    setBusy(false);
    await cacheIndex(idx);
  }
  async function loadSample() {
    setBusy(true);
    const idx = C.buildIndex(SAMPLE.docs, { builtDate: TODAY, source: SAMPLE.label });
    setIndex(idx);
    $('selection-note').textContent = '当前是合成示例库,不是你的真实笔记。';
    $('progress-box').hidden = true;
    setBusy(false);
    await cacheIndex(idx);
    toast('已载入合成示例。');
  }

  // ---------- 事件 ----------
  function bind() {
    $('load-sample').onclick = () => requestReplace('用合成示例库替换当前索引?', loadSample);
    $('confirm-yes').onclick = () => { const run = pending; pending = null; $('confirm').hidden = true; if (run) run(); };
    $('confirm-no').onclick = () => { pending = null; $('confirm').hidden = true; toast('已取消,当前索引保持不变。'); };

    $('btn-pick-folder').onclick = () => { if (!state.busy) $('pick-folder').click(); };
    $('btn-pick-files').onclick = () => { if (!state.busy) $('pick-files').click(); };
    $('pick-folder').onchange = e => {
      const files = Array.from(e.target.files); e.target.value = '';
      const root = files.length && files[0].webkitRelativePath ? files[0].webkitRelativePath.split('/')[0] : '所选文件夹';
      startImport(files, root);
    };
    $('pick-files').onchange = e => {
      const files = Array.from(e.target.files); e.target.value = '';
      startImport(files, `${files.length} 个所选文件`);
    };
    const dz = $('dropzone');
    dz.onclick = () => { if (!state.busy) $('pick-files').click(); };
    dz.onkeydown = e => { if ((e.key === 'Enter' || e.key === ' ') && !state.busy) { e.preventDefault(); $('pick-files').click(); } };
    dz.ondragover = e => { e.preventDefault(); dz.classList.add('over'); };
    dz.ondragleave = () => dz.classList.remove('over');
    dz.ondrop = e => {
      e.preventDefault(); dz.classList.remove('over');
      const files = Array.from(e.dataTransfer ? e.dataTransfer.files : []);
      startImport(files, `${files.length} 个拖入文件`);
    };
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', e => e.preventDefault());

    $('search-form').onsubmit = e => { e.preventDefault(); runSearch(); };
    $('q').oninput = syncExport;
    $('more').onclick = () => { state.shown += PAGE_SIZE; renderResults(); };
    $('export-md').onclick = () => {
      if ($('export-md').disabled) return;
      const md = C.toMarkdown(state.results, { query: state.lastQuery, date: TODAY, source: state.index.source });
      download(`搜索结果-${TODAY}.md`, md, 'text/markdown;charset=utf-8');
    };
    $('export-csv').onclick = () => {
      if (!state.index) return;
      download(`索引统计-${TODAY}.csv`, '\ufeff' + C.toCsv(state.index.stats), 'text/csv;charset=utf-8');
    };
    $('clear-cache').onclick = () => requestReplace('清除当前索引与 IndexedDB 缓存?', async () => {
      state.index = null;
      try { await idbRun('readwrite', s => s.delete(IDB_KEY)); clearWarn('cache'); }
      catch (e) { warn('cache', `缓存没有清除:${e && e.message ? e.message : '未知错误'}。`); }
      setIndex(null);
      $('selection-note').textContent = '';
      $('progress-box').hidden = true;
      toast('已清除索引。');
    });

    $('co-form').onsubmit = e => { e.preventDefault(); runCo(); };
    const applyStopwords = () => {
      const ok = saveSettings();
      $('stopwords').value = state.stopwords.join(' ');
      if (state.coTerm) $('co-term').value = state.coTerm;
      if (state.coTerm && state.index) runCo();
      if (ok) toast('停用词已保存。');
    };
    $('save-stop').onclick = () => { state.stopwords = C.parseStopwords($('stopwords').value); applyStopwords(); };
    $('reset-stop').onclick = () => { state.stopwords = C.DEFAULT_STOPWORDS.slice(); applyStopwords(); };
  }

  async function init() {
    bind();
    loadSettings();
    $('stopwords').value = state.stopwords.join(' ');
    renderLibrary(); renderRecent();
    await loadCached();
    document.body.dataset.ready = '1';
  }
  init();
})();
