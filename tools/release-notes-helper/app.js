'use strict';
(function () {
  const C = globalThis.ReleaseCore;
  const SAMPLE = globalThis.RELEASE_SAMPLE;
  const KEY = 'releasenotes.v1';
  const RECOVERY_PREFIX = KEY + '.recovery-raw.';
  const $ = id => document.getElementById(id);
  const today = () => C.resolveToday(location.search);
  const FORMAT_LABEL = { oneline: 'git log --oneline', pretty: '自定义 pretty(sha|标题|作者|日期)', raw: '原始 git log' };
  const SKIP_LABEL = { merge: 'Merge 提交', docs: 'docs(未勾选)', chore: 'chore/build/ci/test/style(未勾选)', refactor: 'refactor/revert(未勾选)', empty: '标题为空' };

  let state = C.defaultState();
  let view = null; // 最近一次 compute() 的结果,导出只用它,保证与界面一致
  let toastTimer = null;
  let recoveryRaw = null;
  let recoveryArchived = false;
  let recoveryArchiveKey = null;
  let recoveryReason = '';
  let storageReadBlocked = false;

  // ---------- 存储 ----------
  function loadState() {
    let raw = null;
    let archives = [];
    try {
      raw = localStorage.getItem(KEY);
      archives = readArchives();
    } catch (e) {
      storageReadBlocked = true;
      return noteLoad('无法安全读取本机主草稿。为避免覆盖未知旧值，本页生命周期内已阻止保存和清空；当前改动只保留在内存中，请先导出当前内存草稿。', false, true);
    }
    if (raw === null) {
      const archived = archives.at(-1);
      if (archived) {
        recoveryRaw = archived.raw;
        recoveryArchived = true;
        recoveryArchiveKey = archived.key;
        noteLoad('本机保留了一份以前归档的原始坏数据。当前草稿为空白；你可以下载归档核对。', true);
      }
      return;
    }
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return rememberInvalid(raw, archives, '本机草稿不是合法 JSON。'); }
    const v = C.validateState(parsed);
    if (!v.ok) return rememberInvalid(raw, archives, '本机草稿字段不合法：' + v.error + '。');
    state = v.state;
    const archived = archives.at(-1);
    if (archived) {
      recoveryRaw = archived.raw;
      recoveryArchived = true;
      recoveryArchiveKey = archived.key;
      noteLoad('当前草稿已正常恢复。本机还保留了一份以前归档的原始坏数据，可下载核对。', true);
    }
  }
  function readArchives() {
    const out = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(RECOVERY_PREFIX)) out.push({ key, raw: localStorage.getItem(key) });
    }
    return out.sort((a, b) => a.key.localeCompare(b.key));
  }
  function rememberInvalid(raw, archives, reason) {
    const archived = [...archives].reverse().find(item => item.raw === raw) || null;
    recoveryRaw = raw;
    recoveryArchived = !!archived;
    recoveryArchiveKey = archived ? archived.key : null;
    recoveryReason = reason;
    noteLoad(reason + ' 当前使用空白草稿。保存新草稿前，系统必须先逐字归档并回读确认原始值。', true);
  }
  function noteLoad(msg, canDownload, canExportCurrent) {
    $('load-note-title').textContent = recoveryArchived ? '原始坏数据已有恢复副本' : '本机草稿需要恢复';
    $('load-note-text').textContent = msg;
    $('download-raw').hidden = !canDownload || recoveryRaw === null;
    $('download-current').hidden = !canExportCurrent && recoveryRaw === null;
    $('load-note').hidden = false;
  }
  function refreshRecoveryNote(msg) {
    if (recoveryRaw === null) return;
    noteLoad(msg || (recoveryArchived
      ? '原始坏数据已经逐字归档并回读确认。当前内存草稿可以继续保存；恢复副本仍可下载。'
      : recoveryReason + ' 原始值尚未安全归档，因此主草稿没有被覆盖。'), true);
  }
  function archiveRecovery() {
    if (recoveryRaw === null) return true;
    try {
      if (recoveryArchiveKey && localStorage.getItem(recoveryArchiveKey) === recoveryRaw) {
        recoveryArchived = true;
        return true;
      }
      recoveryArchived = false;
      recoveryArchiveKey = null;
      const base = RECOVERY_PREFIX + Date.now();
      let candidate = base;
      let suffix = 0;
      while (localStorage.getItem(candidate) !== null) {
        suffix += 1;
        candidate = base + '.' + suffix;
      }
      localStorage.setItem(candidate, recoveryRaw);
      if (localStorage.getItem(candidate) !== recoveryRaw) throw new Error('恢复副本回读不一致');
      recoveryArchiveKey = candidate;
      recoveryArchived = true;
      refreshRecoveryNote();
      return true;
    } catch (e) {
      refreshRecoveryNote('无法写入或回读恢复副本。原始坏数据仍保留在主存储键和本页内存中；主草稿没有被覆盖。请先下载原始坏数据和当前内存草稿。');
      return false;
    }
  }
  // 返回是否真正写入;失败时「未保存」横幅持续可见,直到下一次写入成功
  function persist() {
    const valid = C.validateState(state);
    if (storageReadBlocked) { $('save-warn').hidden = false; return false; }
    if (!valid.ok || !archiveRecovery()) { $('save-warn').hidden = false; return false; }
    const serialized = JSON.stringify(valid.state);
    try {
      localStorage.setItem(KEY, serialized);
      if (localStorage.getItem(KEY) !== serialized) throw new Error('主草稿回读不一致');
      $('save-warn').hidden = true;
      if (recoveryRaw !== null) refreshRecoveryNote();
      return true;
    } catch (e) {
      $('save-warn').hidden = false;
      if (recoveryRaw !== null) refreshRecoveryNote('原始坏数据已有恢复副本，但浏览器拒绝写入或回读新草稿。当前改动只在内存中；刷新前请导出当前内存草稿。');
      return false;
    }
  }
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }

  // ---------- 计算(纯函数式,读 state,产出 view) ----------
  const stripLinks = s => s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  function compute() {
    const commits = C.parseLog(state.log);
    const fmt = C.detectFormat(state.log);
    const baseOpt = { includeDocs: state.opts.docs, includeChore: state.opts.chore, includeRefactor: state.opts.refactor, includeMerges: state.opts.merges, repoUrl: state.repoUrl };
    const first = C.group(commits, baseOpt);
    const ids = new Set(first.groups.flatMap(g => g.items.map(i => i.id)));
    const actions = state.actions.filter(id => ids.has(id));
    const res = C.group(commits, Object.assign({}, baseOpt, { userActions: actions }));

    let suggestion = null, sugError = null;
    if (state.current.trim()) { try { suggestion = C.nextVersion(state.current, res.groups); } catch (e) { sugError = e.message; } }
    let version = null, versionError = null;
    if (state.release.trim()) {
      const p = C.parseSemver(state.release);
      if (p) version = `${p.major}.${p.minor}.${p.patch}`; else versionError = '发布版本号格式应为 x.y.z(例如 2.0.0)';
    } else if (suggestion) version = suggestion.next;

    const date = state.date;
    const dateOk = C.isValidDate(date);
    const generated = C.toReleaseNotes(res.groups, { version, date: dateOk ? date : '' });
    const changelog = version && dateOk ? C.toChangelog(res.groups, version, date) : null;
    const sig = JSON.stringify([state.log, state.repoUrl, state.current, state.release, state.date, state.opts, actions]);
    const stale = state.edited !== null && state.editedSig !== sig;
    const md = state.edited !== null ? state.edited : generated;

    let blocker = null;
    if (!commits.length) blocker = '先粘贴 git log,或点「载入示例」。';
    else if (!res.groups.length) blocker = '所有提交都被过滤了,没有可导出的条目。可以在左侧勾选包含更多类型。';
    else if (versionError) blocker = versionError;
    else if (sugError && !version) blocker = sugError;
    else if (!version) blocker = '需要版本号:填写「当前版本」得到建议,或直接填「发布版本」。';
    else if (!dateOk) blocker = '发布日期为空或不合法,请重新选择。';
    else if (stale) blocker = '输入已变化,先在上方处理你的手改内容。';
    return { commits, fmt, res, actions, suggestion, sugError, version, versionError, dateOk, generated, changelog, sig, stale, md, blocker };
  }

  // ---------- 渲染 ----------
  function renderFields() {
    $('log').value = state.log;
    $('repo').value = state.repoUrl;
    $('current').value = state.current;
    $('release').value = state.release;
    $('date').value = state.date;
    $('opt-docs').checked = state.opts.docs;
    $('opt-chore').checked = state.opts.chore;
    $('opt-refactor').checked = state.opts.refactor;
    $('opt-merges').checked = state.opts.merges;
  }
  function renderStatus() {
    const s = $('log-status');
    s.classList.remove('bad');
    s.textContent = '';
    if (view.fmt === 'empty') { s.textContent = '还没有内容。支持 oneline、自定义 pretty、原始 git log 三种格式。'; return; }
    if (view.fmt === 'unknown' || !view.commits.length) { s.classList.add('bad'); s.textContent = '没有识别到提交。请检查是不是 git log 的输出(每条以 7 位以上的 sha 开头)。'; return; }
    const strong = document.createElement('strong');
    strong.textContent = FORMAT_LABEL[view.fmt];
    s.append('识别为 ', strong, `,共 ${view.commits.length} 条提交,已过滤 ${view.res.skipped.length} 条。`);
    if (view.fmt !== 'raw') s.append(' 该格式不含提交正文,正文里的 BREAKING CHANGE 无法识别。');
  }
  function renderItems() {
    const box = $('items');
    box.textContent = '';
    const items = view.res.groups.flatMap(g => g.items.map(it => ({ g, it })));
    $('items-count').textContent = items.length ? `${items.length} 条(来自 ${view.commits.length} 条提交,已过滤 ${view.res.skipped.length} 条)` : '';
    if (!items.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = '还没有条目。';
      box.appendChild(p);
    }
    for (const { g, it } of items) {
      const label = document.createElement('label');
      label.className = 'item-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.dataset.id = it.id; cb.checked = it.userAction;
      cb.setAttribute('aria-label', '需要用户操作:' + stripLinks(it.text));
      const span = document.createElement('span');
      span.className = 'txt';
      const tag = document.createElement('span');
      tag.className = 'tag ' + g.key; tag.textContent = g.title;
      span.append(tag, (it.scope ? it.scope + ': ' : '') + stripLinks(it.text));
      label.append(cb, span);
      box.appendChild(label);
    }
    const sk = view.res.skipped;
    $('skipped-box').hidden = !sk.length;
    $('skipped-summary').textContent = `已过滤的提交(${sk.length})`;
    const ul = $('skipped');
    ul.textContent = '';
    for (const x of sk) {
      const li = document.createElement('li');
      li.textContent = `${x.subject || '(空标题)'} — ${SKIP_LABEL[x.reason] || x.reason}`;
      ul.appendChild(li);
    }
  }
  function renderVersion() {
    const card = $('version-card');
    card.textContent = '';
    card.classList.remove('bad');
    const add = (cls, text) => { const s = document.createElement('span'); if (cls) s.className = cls; s.textContent = text; card.appendChild(s); };
    if (view.suggestion) {
      add('', `当前 ${view.suggestion.current}`);
      add('arrow', '→');
      add('next', view.suggestion.next);
      add('muted', `建议:${view.suggestion.bump === 'none' ? '不升级' : view.suggestion.bump}(${view.suggestion.reason})`);
      if (state.release.trim() && view.version && view.version !== view.suggestion.next) add('muted', `你填写的发布版本 ${view.version} 优先。`);
    } else if (view.sugError) { card.classList.add('bad'); add('', view.sugError); }
    else if (view.versionError) { card.classList.add('bad'); add('', view.versionError); }
    else if (view.version) add('', `发布版本 ${view.version}`);
    else add('muted', '填写「当前版本」后,这里会按提交类型给出下一版建议。');
  }
  function setFieldError(inputId, errId, msg) {
    const box = $(errId);
    box.hidden = !msg;
    box.textContent = msg || '';
    if (msg) $(inputId).setAttribute('aria-invalid', 'true'); else $(inputId).removeAttribute('aria-invalid');
  }
  function renderFieldErrors() {
    setFieldError('current', 'err-current', state.current.trim() && view.sugError ? view.sugError : '');
    setFieldError('release', 'err-release', view.versionError || '');
    setFieldError('date', 'err-date', view.dateOk ? '' : '发布日期为空或不合法,请重新选择。');
  }
  function renderOutput() {
    $('stale').hidden = !view.stale;
    $('sample-badge-in').hidden = !state.sample;
    $('sample-badge-out').hidden = !state.sample;
    if (state.edited === null) $('reset-confirm').hidden = true;
    renderFieldErrors();
    const prev = $('preview');
    if (view.commits.length) prev.innerHTML = C.renderMarkdown(view.md); // renderMarkdown 先转义,只放行 http(s) 链接
    else { prev.textContent = ''; const d = document.createElement('div'); d.className = 'empty'; d.textContent = '这里会显示渲染后的发布说明。先在左侧粘贴 git log,或点「载入示例」。'; prev.appendChild(d); }
    const ed = $('md-edit');
    if (document.activeElement !== ed) ed.value = view.md;
    $('changelog').value = view.changelog || '需要有效的版本号和日期后才会生成 CHANGELOG 片段。';
    $('reset-edit').disabled = state.edited === null;
    const ok = !view.blocker;
    for (const id of ['dl-notes', 'dl-changelog', 'copy-notes', 'copy-changelog']) $(id).disabled = !ok;
    const hint = $('export-hint');
    hint.classList.toggle('bad', !ok);
    hint.textContent = ok ? (state.edited !== null ? '发布说明使用你手改后的内容;更新日志片段由条目自动生成,不含手改。' : '导出内容与当前界面一致。') + (state.sample ? ' 当前是合成示例,导出文件首行会加一行注释标注。' : '') : '暂不能导出:' + view.blocker;
  }
  function renderTabs() {
    for (const t of C.TAB_VALUES) {
      $('pane-' + t).hidden = state.tab !== t;
      $('tab-' + t).setAttribute('aria-selected', String(state.tab === t));
    }
  }
  function update(opts) {
    view = compute();
    renderStatus();
    if (!opts || !opts.keepItems) renderItems();
    renderVersion();
    renderOutput();
    renderTabs();
  }
  function commit(opts) { persist(); update(opts); }

  // ---------- 导出 ----------
  function download(name, text) {
    text = C.markSample(text, state.sample);
    const a = document.createElement('a');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('已生成下载文件:' + name);
  }
  function downloadExact(name, text, type) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(new Blob([text], { type: type || 'application/octet-stream' }));
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('已生成下载文件:' + name);
  }
  async function copy(text, tab, areaId) {
    text = C.markSample(text, state.sample);
    const msg = $('copy-msg');
    try {
      await navigator.clipboard.writeText(text);
      msg.textContent = '已复制到剪贴板。';
      toast('已复制到剪贴板');
    } catch (e) {
      state.tab = tab; persist(); renderTabs();
      const ta = $(areaId);
      ta.focus(); ta.select();
      msg.textContent = '浏览器拒绝了剪贴板访问(file:// 下常见)。文本已选中,请按 Cmd/Ctrl+C 手动复制。';
    }
  }
  function guardedExport(fn) { if (!view || view.blocker) return; fn(); }

  // ---------- 事件 ----------
  function isPristineSample() {
    const d = C.defaultState();
    return state.sample && state.release === '' && state.repoUrl === SAMPLE.repoUrl && state.current === SAMPLE.current &&
      state.date === today() && !state.actions.length && state.edited === null &&
      ['docs', 'chore', 'refactor', 'merges'].every(k => state.opts[k] === d.opts[k]);
  }
  function describeDraft() {
    const parts = [];
    if (state.log.trim()) parts.push(`git log(${state.log.split('\n').filter(l => l.trim()).length} 行,识别到 ${view ? view.commits.length : 0} 条提交)`);
    const fields = [state.repoUrl && '仓库地址', state.current && '当前版本', state.release && '发布版本', state.date && state.date !== today() && '发布日期'].filter(Boolean);
    if (fields.length) parts.push(fields.join('、'));
    if (state.actions.length) parts.push(`${state.actions.length} 条「需要用户操作」勾选`);
    if (state.edited !== null) parts.push('手改的 Markdown');
    if (['docs', 'chore', 'refactor', 'merges'].some(k => state.opts[k])) parts.push('已改动的「包含」选项');
    return parts.join('、');
  }
  let pendingKind = null;
  function requestSample(kind) {
    $('clear-confirm').hidden = true;
    if (!C.hasDraft(state, today()) || isPristineSample()) { loadSample(kind); return; }
    pendingKind = kind;
    $('replace-scope').textContent = `当前的${describeDraft()}会被合成示例替换,「包含」选项会重置;此操作无法撤销。`;
    $('replace-confirm').hidden = false;
    $('replace-no').focus();
  }
  function loadSample(kind) {
    $('replace-confirm').hidden = true;
    pendingKind = null;
    const next = C.defaultState();
    next.log = SAMPLE.texts[kind];
    next.repoUrl = SAMPLE.repoUrl;
    next.current = SAMPLE.current;
    next.date = today();
    next.sample = true;
    state = next;
    $('reset-confirm').hidden = true;
    renderFields();
    const ok = persist();
    update();
    if (ok) toast('已载入合成示例(非真实仓库),共 ' + SAMPLE.count + ' 条提交。');
  }
  function bindText(id, key) {
    $(id).addEventListener('input', e => { state[key] = e.target.value; if (key === 'log') state.sample = false; commit(); });
  }
  function init() {
    loadState();
    const fixedDay = C.todayFromParam(location.search);
    const tn = $('today-note');
    tn.hidden = !fixedDay;
    if (fixedDay) tn.textContent = `基准日 ${fixedDay}(由地址参数固定)`;
    if (!state.date) state.date = today();
    renderFields();
    bindText('log', 'log'); bindText('repo', 'repoUrl'); bindText('current', 'current'); bindText('release', 'release'); bindText('date', 'date');
    for (const [id, k] of [['opt-docs', 'docs'], ['opt-chore', 'chore'], ['opt-refactor', 'refactor'], ['opt-merges', 'merges']]) {
      $(id).addEventListener('change', e => { state.opts[k] = e.target.checked; commit(); });
    }
    $('items').addEventListener('change', e => {
      const id = e.target && e.target.dataset && e.target.dataset.id;
      if (!id) return;
      const set = new Set(state.actions);
      if (e.target.checked) set.add(id); else set.delete(id);
      state.actions = [...set];
      commit({ keepItems: true });
    });
    $('load-sample').addEventListener('click', () => requestSample('raw'));
    $('load-oneline').addEventListener('click', () => requestSample('oneline'));
    $('load-pretty').addEventListener('click', () => requestSample('pretty'));
    $('replace-yes').addEventListener('click', () => loadSample(pendingKind || 'raw'));
    $('replace-no').addEventListener('click', () => { $('replace-confirm').hidden = true; pendingKind = null; $('load-sample').focus(); });

    $('md-edit').addEventListener('input', e => {
      state.edited = e.target.value; state.editedSig = view.sig;
      commit();
    });
    $('reset-edit').addEventListener('click', () => {
      if (state.edited === null) return;
      $('reset-confirm').hidden = false;
      $('reset-no').focus();
    });
    $('reset-no').addEventListener('click', () => { $('reset-confirm').hidden = true; $('reset-edit').focus(); });
    $('reset-yes').addEventListener('click', () => {
      $('reset-confirm').hidden = true;
      state.edited = null; state.editedSig = null; renderFields(); commit(); toast('已恢复为自动生成的内容。');
      $('md-edit').focus();
    });
    $('stale-regen').addEventListener('click', () => { state.edited = null; state.editedSig = null; commit(); $('md-edit').value = view.md; });
    $('stale-keep').addEventListener('click', () => { state.editedSig = view.sig; commit(); });

    document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { state.tab = b.dataset.tab; persist(); renderTabs(); }));

    $('dl-notes').addEventListener('click', () => guardedExport(() => download(`release-notes-${view.version}.md`, view.md)));
    $('dl-changelog').addEventListener('click', () => guardedExport(() => download(`CHANGELOG-${view.version}.md`, view.changelog)));
    $('copy-notes').addEventListener('click', () => guardedExport(() => copy(view.md, 'edit', 'md-edit')));
    $('copy-changelog').addEventListener('click', () => guardedExport(() => copy(view.changelog, 'changelog', 'changelog')));
    $('goto-export').addEventListener('click', () => $('dl-notes').scrollIntoView({ block: 'center' }));
    $('download-raw').addEventListener('click', () => {
      if (recoveryRaw !== null) downloadExact('releasenotes-recovery-raw.txt', recoveryRaw);
    });
    $('download-current').addEventListener('click', () => {
      const valid = C.validateState(state);
      if (valid.ok) downloadExact('releasenotes-current-memory.json', JSON.stringify(valid.state, null, 2) + '\n', 'application/json;charset=utf-8');
    });

    $('clear-data').addEventListener('click', () => {
      $('replace-confirm').hidden = true;
      const d = describeDraft();
      $('clear-scope').textContent = d ? `当前的${d}都会从本机删除,无法恢复。` : '本机保存的内容会被删除,无法恢复。';
      $('clear-confirm').hidden = false; $('clear-no').focus();
    });
    $('clear-no').addEventListener('click', () => { $('clear-confirm').hidden = true; $('clear-data').focus(); });
    $('clear-yes').addEventListener('click', () => {
      $('clear-confirm').hidden = true;
      if (storageReadBlocked) {
        $('save-warn').hidden = false;
        noteLoad('本页无法确认主草稿的原值，因此清空已被阻止。当前内存草稿仍保留；请先导出，再刷新页面重试读取。', false, true);
        return;
      }
      state = C.defaultState(); state.date = today();
      if (!archiveRecovery()) {
        $('save-warn').hidden = false;
        renderFields(); update();
        return;
      }
      let removed = true;
      try { localStorage.removeItem(KEY); } catch (e) { removed = false; }
      $('save-warn').hidden = removed;
      renderFields(); update();
      if (removed) toast('本机数据已清空。');
    });
    update();
  }
  init();
})();
