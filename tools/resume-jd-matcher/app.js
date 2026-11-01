'use strict';
(function () {
  const C = globalThis.JobMatchCore;
  const KEY = 'jobmatch.v1';
  const $ = id => document.getElementById(id);
  const TODAY = C.resolveToday(location.search, C.localDateString(new Date()));

  const state = { jobs: [], currentId: null };
  const ui = { tab: 'result', diffA: null, diffB: null, pendingImport: null, focusKw: null, pendingExtract: null };
  let confirmAction = null;
  let toastTimer = null;

  /* ---------- DOM 小工具(全部走 textContent,不拼 innerHTML) ---------- */
  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) n.addEventListener(ev, fn);
      else if (k === 'style') for (const [sk, sv] of Object.entries(v)) n.style.setProperty(sk, sv);
      else if (v === true) n.setAttribute(k, '');
      else if (v !== false && v != null) n.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid);
    return n;
  }
  function clear(n) { n.replaceChildren(); }

  /* ---------- 存储 ---------- */
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(C.exportData(state)));
      $('save-warning').hidden = true;
      return true;
    } catch (e) {
      $('save-warning').hidden = false;
      return false;
    }
  }
  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (!raw) return;
    const r = C.validateImport(raw);
    if (r.ok) { state.jobs = r.data.jobs; state.currentId = r.data.currentId; return; }
    try { localStorage.setItem(KEY + '.corrupt', raw); } catch (e) { /* 备份失败不影响继续使用 */ }
    toast('本地存档无法读取(' + r.error + '),已另存为 ' + KEY + '.corrupt,本次从空白开始。', true);
  }
  function toast(msg, sticky) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    if (!sticky) toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
  }
  function saved(msg) { if (save()) toast(msg); }

  /* ---------- 当前岗位 ---------- */
  const job = () => state.jobs.find(j => j.id === state.currentId) || null;
  function uid(prefix) {
    const used = new Set(state.jobs.flatMap(j => [j.id, ...j.versions.map(v => v.id)]));
    let id;
    do { id = prefix + '-' + Math.random().toString(36).slice(2, 9); } while (used.has(id));
    return id;
  }
  const activeKeywords = j => j.keywords.filter(k => k.on).map(k => ({ term: k.term, must: k.must }));
  const isStale = j => j.keywords.length > 0 && j.kwFrom !== null && j.kwFrom !== j.jd;
  function computeResult(j) { return C.match(activeKeywords(j), j.resume, j.synonyms); }

  /* ---------- 渲染 ---------- */
  function renderAll() {
    renderJobBar();
    const j = job();
    $('empty').hidden = !!j;
    $('job-area').hidden = !j;
    if (!j) return;
    $('job-title').value = j.title;
    $('jd').value = j.jd;
    $('resume').value = j.resume;
    $('synonyms').value = j.synonyms;
    $('ver-title').value = '版本 ' + (j.versions.length + 1);
    renderDerived();
  }
  function renderJobBar() {
    const sel = $('job-select');
    clear(sel);
    if (!state.jobs.length) sel.append(el('option', { value: '', text: '(还没有岗位)' }));
    for (const j of state.jobs) sel.append(el('option', { value: j.id, text: j.title || '未命名岗位', selected: j.id === state.currentId }));
    sel.disabled = !state.jobs.length;
    $('delete-job').disabled = !job();
    $('clear-all').disabled = !state.jobs.length;
  }
  function renderDerived() {
    const j = job();
    if (!j) return;
    const res = computeResult(j);
    renderInputsHint(j);
    renderChips(j, res);
    renderResult(j, res);
    renderFacts(j);
    renderVersions(j, res);
    renderExport(j, res);
    setTab(ui.tab);
  }
  function renderInputsHint(j) {
    const lines = C.extractRequirementLines(j.jd).length;
    $('extract-hint').textContent = j.jd.trim() ? '识别到 ' + lines + ' 行要求' : '先贴上岗位描述';
    $('extract').disabled = !j.jd.trim();
    const n = j.resume ? j.resume.split(/\r?\n/).length : 0;
    $('resume-hint').textContent = n ? '共 ' + n + ' 行(命中位置按这里的行号)' : '';
  }

  function renderChips(j, res) {
    const box = $('chips');
    clear(box);
    $('kw-empty').hidden = j.keywords.length > 0;
    $('stale-note').hidden = !isStale(j);
    const byTerm = new Map(res.items.map(i => [C.normalize(i.term) + '|' + i.must, i]));
    j.keywords.forEach((k, idx) => {
      const info = k.on ? byTerm.get(C.normalize(k.term) + '|' + k.must) : null;
      const cls = 'chip' + (!k.on ? ' off' : info && info.hit ? ' hit' : ' miss');
      const kwKey = C.normalize(k.term);
      const cb = el('input', { type: 'checkbox', checked: k.on, 'aria-label': '计入对照:' + k.term, 'data-kw': kwKey, 'data-kind': 'toggle' });
      cb.addEventListener('change', () => { k.on = cb.checked; ui.focusKw = { key: kwKey, kind: 'toggle' }; saved('已更新关键词。'); renderDerived(); });
      const chip = el('div', { class: cls },
        el('label', {}, cb, el('span', { text: k.term })),
        k.on ? el('span', { class: 'state', text: info && info.hit ? '命中' : '缺失' }) : el('span', { class: 'state', text: '不计入' }),
        el('button', { type: 'button', 'data-kw': kwKey, 'data-kind': 'must', 'aria-label': k.term + ' 当前为' + (k.must ? '必须' : '加分') + ',点击切换', text: k.must ? '必须' : '加分', on: { click: () => { k.must = !k.must; ui.focusKw = { key: kwKey, kind: 'must' }; saved('已切换类型。'); renderDerived(); } } }),
        el('button', { type: 'button', 'data-kw': kwKey, 'data-kind': 'delete', 'aria-label': '删除关键词 ' + k.term, text: '删除', on: { click: () => {
          const near = j.keywords[idx + 1] || j.keywords[idx - 1];
          ui.focusKw = near ? { key: C.normalize(near.term), kind: 'delete' } : { id: 'kw-input' };
          j.keywords.splice(idx, 1); saved('已删除关键词。'); renderDerived();
        } } })
      );
      box.append(chip);
    });
    restoreKwFocus();
  }
  /* 重绘后把键盘焦点放回同一关键词的同一控件;删除后转到相邻关键词 */
  function restoreKwFocus() {
    const f = ui.focusKw;
    ui.focusKw = null;
    if (!f) return;
    let target = null;
    if (f.id) target = $(f.id);
    else for (const n of $('chips').querySelectorAll('[data-kw]')) if (n.dataset.kw === f.key && n.dataset.kind === f.kind) { target = n; break; }
    if (target) target.focus();
  }

  const pct = C.pct;
  function renderResult(j, res) {
    const stats = $('stats');
    clear(stats);
    const g = res.byGroup;
    const stat = (title, cov, hit, total) => el('div', { class: 'stat' },
      el('div', { text: title }),
      el('div', { class: 'num', text: total ? pct(cov) : '—' }),
      el('div', { class: 'sub', text: total ? hit + ' / ' + total + ' 个关键词命中' : '没有这一类关键词' }));
    stats.append(stat('总覆盖率', res.coverage, res.hitCount, res.total), stat('必须项', res.mustCoverage, g.must.hit, g.must.total), stat('加分项', res.bonusCoverage, g.bonus.hit, g.bonus.total));

    const miss = $('missing');
    clear(miss);
    if (!res.total) miss.append(el('p', { class: 'hint', text: '先提取或添加关键词。' }));
    else if (!res.items.some(i => !i.hit)) miss.append(el('p', { class: 'ok-note', text: '所有关键词都在简历里出现了。' }));
    else {
      const ul = el('ul', { class: 'miss-list' });
      for (const i of res.items.filter(x => !x.hit && x.must)) ul.append(el('li', { text: i.term + '(必须)' }));
      for (const i of res.items.filter(x => !x.hit && !x.must)) ul.append(el('li', { text: i.term + '(加分)' }));
      miss.append(ul);
    }

    const body = $('hit-table').tBodies[0];
    clear(body);
    const resumeLines = j.resume.split(/\r?\n/);
    if (!res.hits.length) body.append(el('tr', {}, el('td', { colspan: 4, class: 'hint', text: '还没有命中。' })));
    for (const h of res.hits) {
      const first = h.lines[0];
      body.append(el('tr', {},
        el('td', { text: h.term }),
        el('td', {}, el('span', { class: 'tag' + (h.must ? ' must' : ''), text: h.must ? '必须' : '加分' })),
        el('td', { text: '第 ' + h.lines.join('、') + ' 行' }),
        el('td', { text: (resumeLines[first - 1] || '').trim() })));
    }
  }

  function currentFacts(j) {
    return C.extractFacts(j.resume).map(f => ({ line: f.line, text: f.text, key: f.key, status: j.factChecks[f.key] }));
  }
  function renderFacts(j) {
    const facts = currentFacts(j);
    const list = $('fact-list');
    clear(list);
    const ok = facts.filter(f => f.status === 'ok').length;
    const fix = facts.filter(f => f.status === 'fix').length;
    $('fact-summary').textContent = facts.length ? '共 ' + facts.length + ' 条:有证据 ' + ok + ',需修改 ' + fix + ',未核验 ' + (facts.length - ok - fix) + '。' : '简历里没有抽到含数字的句子。';
    for (const f of facts) {
      const set = status => { if (j.factChecks[f.key] === status) delete j.factChecks[f.key]; else j.factChecks[f.key] = status; saved('已记录核验结果。'); renderFacts(j); renderExport(j, computeResult(j)); };
      list.append(el('li', { class: f.status || '' },
        el('span', { class: 'fact-line', text: '第 ' + f.line + ' 行' }),
        el('span', { text: f.text }),
        el('span', { class: 'fact-btns' },
          el('button', { type: 'button', text: '有证据', 'aria-pressed': String(f.status === 'ok'), 'aria-label': '标记为有证据:' + f.text, on: { click: () => set('ok') } }),
          el('button', { type: 'button', text: '需修改', 'aria-pressed': String(f.status === 'fix'), 'aria-label': '标记为需修改:' + f.text, on: { click: () => set('fix') } }))));
    }
  }

  function fmtTime(t) { return String(t).replace('T', ' '); }
  function renderVersions(j, res) {
    const trendBox = $('trend');
    clear(trendBox);
    const tr = C.versionTrend(j.versions);
    if (!tr.length) trendBox.append(el('p', { class: 'hint', text: '还没有保存过版本。改完简历后点「把当前简历存为新版本」。' }));
    for (const t of tr) {
      const cov = t.coverage;
      let delta = '';
      let dcls = '';
      if (t.delta !== null) {
        const d = Math.round(t.delta * 1000) / 10;
        delta = d > 0 ? '+' + d + ' 个百分点' : d < 0 ? d + ' 个百分点' : '持平';
        dcls = d > 0 ? 'delta-up' : d < 0 ? 'delta-down' : '';
      }
      trendBox.append(el('div', { class: 'trend-row' },
        el('div', { class: 'trend-name' }, el('span', { text: t.title }), el('small', { text: fmtTime(t.time) })),
        el('div', { class: 'bar', role: 'img', 'aria-label': t.title + ' 覆盖率 ' + (cov === null ? '未记录' : pct(cov)) }, el('span', { style: { '--pct': cov === null ? '0%' : pct(cov) } })),
        el('div', {}, el('strong', { text: cov === null ? '—' : pct(cov) }), ' ', el('span', { class: dcls, text: delta }))));
    }
    const list = $('ver-list');
    clear(list);
    for (const v of j.versions.slice().sort((a, b) => Date.parse(a.time) - Date.parse(b.time))) {
      list.append(el('div', { class: 'ver-item' },
        el('div', {}, el('strong', { text: v.title }), el('div', { class: 'hint', text: fmtTime(v.time) + ' · 覆盖率 ' + (v.coverage === null ? '未记录' : pct(v.coverage) + '(' + v.hits + '/' + v.total + ')') })),
        el('div', { class: 'btns' },
          el('button', { type: 'button', text: '载入到简历框', 'aria-label': '载入版本 ' + v.title + ' 到简历框', on: { click: () => ask('把「' + v.title + '」载入简历框会覆盖当前简历框里的文字(没存成版本的改动会丢)。继续?', () => { j.resume = v.text; saved('已载入版本。'); renderAll(); setTab('versions'); }) } }),
          el('button', { type: 'button', class: 'danger', text: '删除', 'aria-label': '删除版本 ' + v.title, on: { click: () => ask('删除版本「' + v.title + '」?此操作不能撤销。', () => { j.versions = j.versions.filter(x => x.id !== v.id); saved('已删除版本。'); renderDerived(); }) } }))));
    }
    renderDiff(j);
  }
  function diffOptions(j) {
    const opts = j.versions.slice().sort((a, b) => Date.parse(a.time) - Date.parse(b.time)).map(v => ({ value: v.id, label: v.title + '(' + fmtTime(v.time) + ')', text: v.text }));
    opts.push({ value: 'current', label: '当前草稿(尚未存为版本)', text: j.resume });
    return opts;
  }
  function renderDiff(j) {
    const opts = diffOptions(j);
    const values = opts.map(o => o.value);
    if (!values.includes(ui.diffA) || !values.includes(ui.diffB)) {
      const nv = values.length - 1; // 最后一项是「当前简历框」
      ui.diffB = nv >= 2 ? values[nv - 1] : values[nv];
      ui.diffA = nv >= 2 ? values[nv - 2] : values[Math.max(nv - 1, 0)];
    }
    for (const [id, cur] of [['diff-a', ui.diffA], ['diff-b', ui.diffB]]) {
      const s = $(id);
      clear(s);
      for (const o of opts) s.append(el('option', { value: o.value, text: o.label, selected: o.value === cur }));
    }
    const a = opts.find(o => o.value === ui.diffA);
    const b = opts.find(o => o.value === ui.diffB);
    const out = $('diff-out');
    clear(out);
    const d = C.diffLines(a.text, b.text);
    const n = t => d.filter(x => x.type === t).length;
    $('diff-summary').textContent = ui.diffA === ui.diffB ? '两边选了同一份,没有差异。' : '新增 ' + n('add') + ' 行,删除 ' + n('del') + ' 行,不变 ' + n('same') + ' 行。';
    const marks = { add: '+', del: '−', same: '' };
    const names = { add: '新增', del: '删除', same: '不变' };
    for (const x of d) out.append(el('div', { class: 'diff-line ' + x.type, 'aria-label': names[x.type] }, el('span', { class: 'mark', 'aria-hidden': 'true', text: marks[x.type] }), el('span', { text: x.text === '' ? '(空行)' : x.text })));
    if (!d.length) out.append(el('p', { class: 'hint', text: '两边都是空的。' }));
  }

  function buildReport(j, res) {
    return { jobTitle: j.title, date: TODAY, resumeLabel: '当前简历框', result: res, facts: currentFacts(j) };
  }
  function exportBlockReason(j, res) {
    if (!res.total) return '还没有可计入的关键词,先提取或添加关键词再导出报告。';
    if (isStale(j)) return '岗位描述改过,关键词还没重新提取。请先「重新提取」或「保留当前关键词」,再导出报告。';
    return '';
  }
  function renderExport(j, res) {
    const reason = exportBlockReason(j, res);
    $('export-block').hidden = !reason;
    $('export-block').textContent = reason;
    $('export-md').disabled = !!reason;
    $('md-preview').textContent = reason ? '(' + reason + ')' : C.toMarkdown(buildReport(j, res));
  }

  function setTab(name) {
    ui.tab = name;
    for (const b of document.querySelectorAll('.tabs button')) {
      const on = b.dataset.tab === name;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      $('tab-' + b.dataset.tab).hidden = !on;
    }
  }

  /* ---------- 页内确认 ---------- */
  function ask(text, fn) {
    confirmAction = fn;
    $('confirm-text').textContent = text;
    $('confirm-bar').hidden = false;
    $('confirm-yes').focus();
  }
  function closeConfirm() { confirmAction = null; $('confirm-bar').hidden = true; }

  /* ---------- 下载 ---------- */
  function download(name, mime, content) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const safeName = s => String(s).replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40) || '岗位';

  /* ---------- 事件 ---------- */
  function newJob(title) {
    const j = C.emptyJob(uid('job'), title);
    state.jobs.push(j);
    state.currentId = j.id;
    return j;
  }
  function loadSamples() {
    const clash = globalThis.JOBMATCH_SAMPLES.filter(s => state.jobs.some(j => j.id === s.id));
    if (clash.length) {
      ask('已有示例岗位「' + clash.map(s => s.title).join('」「') + '」。载入示例会覆盖它们的简历、版本和核验记录(你的改动会丢)。继续?', applySamples);
      return;
    }
    applySamples();
  }
  function applySamples() {
    for (const s of globalThis.JOBMATCH_SAMPLES) {
      const kws = C.extractKeywords(C.extractRequirementLines(s.jd)).map(k => ({ term: k.term, must: k.must, on: true }));
      const versions = s.versions.map(v => {
        const r = C.match(kws, v.text, s.synonyms);
        return { id: v.id, title: v.title, time: v.time, text: v.text, coverage: r.coverage, mustCoverage: r.mustCoverage, hits: r.hitCount, total: r.total };
      });
      const j = { id: s.id, title: s.title, jd: s.jd, resume: s.resume, synonyms: s.synonyms, keywords: kws, kwFrom: s.jd, factChecks: Object.create(null), versions };
      const at = state.jobs.findIndex(x => x.id === s.id);
      if (at >= 0) state.jobs[at] = j; else state.jobs.push(j);
    }
    state.currentId = globalThis.JOBMATCH_SAMPLES[0].id;
    ui.tab = 'result';
    ui.diffA = ui.diffB = null;
    renderAll();
    saved('已载入两个合成示例岗位(含各两版简历)。');
  }

  function bind() {
    $('new-job').onclick = () => { newJob('新岗位'); renderAll(); saved('已新建岗位。'); $('job-title').focus(); $('job-title').select(); };
    $('empty-new').onclick = $('new-job').onclick;
    const pickBackup = () => $('import-file').click();
    $('import-btn').onclick = pickBackup;
    $('empty-import').onclick = pickBackup;
    $('load-sample').onclick = loadSamples;
    $('empty-sample').onclick = loadSamples;
    $('job-select').onchange = e => { state.currentId = e.target.value || null; ui.diffA = ui.diffB = null; save(); renderAll(); };
    $('delete-job').onclick = () => { const j = job(); if (j) ask('删除岗位「' + j.title + '」及它的全部版本?此操作不能撤销。', () => { state.jobs = state.jobs.filter(x => x.id !== j.id); state.currentId = state.jobs.length ? state.jobs[0].id : null; saved('已删除岗位。'); renderAll(); }); };
    $('clear-all').onclick = () => ask('清空全部 ' + state.jobs.length + ' 个岗位的数据?建议先在「导出与数据」下载 JSON 备份。此操作不能撤销。', () => { state.jobs = []; state.currentId = null; saved('已清空全部数据。'); renderAll(); });
    $('confirm-yes').onclick = () => { const fn = confirmAction; closeConfirm(); if (fn) fn(); };
    $('confirm-no').onclick = closeConfirm;

    $('job-title').oninput = e => { const j = job(); j.title = e.target.value; save(); renderJobBar(); renderExport(j, computeResult(j)); };
    $('jd').oninput = e => { const j = job(); j.jd = e.target.value; save(); renderDerived(); };
    $('resume').oninput = e => { const j = job(); j.resume = e.target.value; $('resume').removeAttribute('aria-invalid'); $('ver-msg').hidden = true; save(); renderDerived(); };
    $('synonyms').oninput = e => { const j = job(); j.synonyms = e.target.value; save(); renderDerived(); };

    const closeChoice = () => { ui.pendingExtract = null; $('extract-choice').hidden = true; };
    const applyExtract = mode => {
      const j = job();
      const p = ui.pendingExtract;
      closeChoice();
      const found = p ? p.found : C.extractKeywords(C.extractRequirementLines(j.jd));
      const base = p ? p.base : [];
      j.keywords = C.mergeKeywords(j.keywords, base, found, mode);
      j.kwFrom = j.jd;
      saved(mode === 'keep' ? '已保留你的调整,并补入新提取的词(现在共 ' + j.keywords.length + ' 个关键词)。' : '已用新提取结果替换整个列表(' + j.keywords.length + ' 个关键词)。');
      renderDerived();
    };
    const extract = () => {
      const j = job();
      const found = C.extractKeywords(C.extractRequirementLines(j.jd));
      const base = j.kwFrom === null ? [] : C.extractKeywords(C.extractRequirementLines(j.kwFrom));
      const adj = C.keywordAdjustments(j.keywords, base);
      if (!adj.count) { ui.pendingExtract = { found, base }; applyExtract('replace'); return; }
      ui.pendingExtract = { found, base };
      const parts = [];
      if (adj.added.length) parts.push('手动添加 ' + adj.added.length + ' 个');
      if (adj.retyped.length) parts.push('改过必须/加分 ' + adj.retyped.length + ' 个');
      if (adj.deleted.length) parts.push('删除 ' + adj.deleted.length + ' 个');
      if (adj.off.length) parts.push('取消勾选 ' + adj.off.length + ' 个');
      $('extract-choice-text').textContent = '你调整过关键词列表(' + parts.join('、') + ')。重新提取时:保留调整并补入新词,还是用新提取结果替换整个列表(调整全部丢弃)?';
      $('extract-choice').hidden = false;
      $('choice-keep').focus();
    };
    $('choice-keep').onclick = () => applyExtract('keep');
    $('choice-replace').onclick = () => applyExtract('replace');
    $('choice-cancel').onclick = () => { closeChoice(); $('extract').focus(); };
    $('extract').onclick = extract;
    $('re-extract').onclick = extract;
    $('keep-kw').onclick = () => { const j = job(); j.kwFrom = j.jd; saved('已保留当前关键词。'); renderDerived(); };

    $('kw-form').onsubmit = e => {
      e.preventDefault();
      const j = job();
      const term = $('kw-input').value.trim();
      const msg = $('kw-msg');
      const input = $('kw-input');
      input.removeAttribute('aria-invalid');
      if (!term) { msg.textContent = '请先输入关键词。'; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
      if (j.keywords.some(k => C.normalize(k.term) === C.normalize(term))) { msg.textContent = '「' + term + '」已经在列表里。'; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
      j.keywords.push({ term, must: $('kw-kind').value === 'must', on: true });
      if (j.kwFrom === null) j.kwFrom = j.jd;
      $('kw-input').value = '';
      msg.textContent = '';
      saved('已添加关键词。');
      renderDerived();
      $('kw-input').focus();
    };

    for (const b of document.querySelectorAll('.tabs button')) {
      b.onclick = () => setTab(b.dataset.tab);
      b.onkeydown = e => {
        const all = Array.from(document.querySelectorAll('.tabs button'));
        const i = all.indexOf(b);
        let n = null;
        if (e.key === 'ArrowRight') n = all[(i + 1) % all.length];
        if (e.key === 'ArrowLeft') n = all[(i + all.length - 1) % all.length];
        if (n) { e.preventDefault(); setTab(n.dataset.tab); n.focus(); }
      };
    }

    $('ver-form').onsubmit = e => {
      e.preventDefault();
      const j = job();
      const vm = $('ver-msg');
      if (!j.resume.trim()) { vm.textContent = '简历框是空的,先贴上简历再存版本。'; vm.hidden = false; $('resume').setAttribute('aria-invalid', 'true'); $('resume').focus(); return; }
      vm.hidden = true; $('resume').removeAttribute('aria-invalid');
      const res = computeResult(j);
      const title = $('ver-title').value.trim() || '版本 ' + (j.versions.length + 1);
      j.versions.push({ id: uid('ver'), title, time: C.stamp(TODAY, new Date()), text: j.resume, coverage: res.total ? res.coverage : null, mustCoverage: res.total ? res.mustCoverage : null, hits: res.hitCount, total: res.total });
      ui.diffA = ui.diffB = null;
      $('ver-title').value = '版本 ' + (j.versions.length + 1);
      saved('已保存「' + title + '」。');
      renderDerived();
    };
    $('diff-a').onchange = e => { ui.diffA = e.target.value; renderDiff(job()); };
    $('diff-b').onchange = e => { ui.diffB = e.target.value; renderDiff(job()); };

    $('export-md').onclick = () => {
      const j = job();
      const res = computeResult(j);
      if (exportBlockReason(j, res)) { renderExport(j, res); return; }
      download('对照报告-' + safeName(j.title) + '-' + TODAY + '.md', 'text/markdown;charset=utf-8', C.toMarkdown(buildReport(j, res)));
      toast('已生成 Markdown 报告。');
    };
    $('export-json').onclick = () => {
      download('求职材料对照备份-' + TODAY + '.json', 'application/json;charset=utf-8', JSON.stringify(C.exportData(state), null, 2));
      toast('已生成 JSON 备份。');
    };
    $('import-file').onchange = async e => {
      const f = e.target.files[0];
      e.target.value = '';
      const msg = $('import-msg');
      const showMsg = t => { msg.textContent = t; msg.hidden = !t; };
      if (!f) return;
      let text;
      try { text = await f.text(); } catch (err) { showMsg('读不了这个文件。'); return; }
      const r = C.validateImport(text);
      if (!r.ok) { showMsg('导入被拒绝,整份未导入:' + r.error); return; }
      showMsg('');
      ask('备份里有 ' + r.data.jobs.length + ' 个岗位。导入会替换当前全部数据,继续?', () => {
        state.jobs = r.data.jobs;
        state.currentId = r.data.currentId || (r.data.jobs[0] && r.data.jobs[0].id) || null;
        ui.diffA = ui.diffB = null;
        renderAll();
        saved('已导入 ' + r.data.jobs.length + ' 个岗位。');
        setTab('export');
      });
    };
  }

  { const q = new URLSearchParams(location.search).get('today'); const n = $('today-note'); if (q && q === TODAY) { n.textContent = '基准日 ' + TODAY + '(由地址参数固定)'; n.hidden = false; } }
  load();
  if (!state.currentId && state.jobs.length) state.currentId = state.jobs[0].id;
  bind();
  renderAll();
})();
