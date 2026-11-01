'use strict';
(function () {
  const C = globalThis.ReaderCore;
  const SAMPLE = globalThis.READER_SAMPLE;
  const KEY = 'reader.v1';
  const PERSIST_MS = 15000;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => C.todayFrom(location.search);
  const round1 = n => Math.round(n * 10) / 10;

  let state = C.emptyState();
  let tab = 'read';
  let pendingYes = null;
  let toastTimer = null;
  let lastTick = Date.now();
  let lastPersist = Date.now();
  const warnings = { load: '', save: '' };
  const ixCache = new Map();

  // ---------- 存储 ----------
  function settleActive() { // 刷新或导入后,上一次还在计时的会话停在它最后一个事件的时刻
    const a = state.active;
    if (a && a.events.length && C.sessionStats(a.events).running) a.events.push({ t: a.events[a.events.length - 1].t, type: 'pause' });
  }
  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { warnings.load = '浏览器禁用了本地存储,这次的改动不会被保存。请随时到「导出与数据」导出备份。'; return; }
    if (!raw) return;
    let parsed = null, reason = '';
    try { parsed = JSON.parse(raw); } catch (e) { reason = '不是合法的 JSON'; }
    const v = reason ? null : C.validateState(parsed);
    if (v && v.ok) { state = v.state; settleActive(); return; }
    reason = reason || v.error;
    try { localStorage.setItem(KEY + '.rejected', raw); } catch (e) { /* 另存失败也只能提示 */ }
    warnings.load = `浏览器里保存的数据读不出来(${reason})。原文已另存到 ${KEY}.rejected,当前从空白开始;下一次保存会覆盖 ${KEY}。`;
  }
  // 返回是否真正写入。写入前用与读取相同的校验;失败时显示持续可见的提示
  function save() {
    const v = C.validateState(state);
    if (!v.ok) { warnings.save = `未保存:当前数据没有通过校验(${v.error})。请先导出 JSON 备份。`; return false; }
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      warnings.save = '';
      return true;
    } catch (e) {
      warnings.save = '未保存:浏览器存储不可用或已满,这次改动只在内存里。请立刻到「导出与数据」导出 JSON 备份,关掉页面前不要刷新。';
      return false;
    }
  }
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }
  // 保存 + 重绘;成功提示只在真正写入之后显示
  function commit(msg) {
    const ok = save();
    render();
    if (ok && msg) toast(msg);
    return ok;
  }

  // ---------- 取值 ----------
  const curText = () => state.texts.find(t => t.id === state.currentTextId) || null;
  function getIx(t) {
    const hit = ixCache.get(t.id);
    if (hit && hit.body === t.body) return hit.ix;
    const ix = C.indexText(t.body);
    ixCache.set(t.id, { body: t.body, ix });
    return ix;
  }
  const modeKey = () => (state.settings.mode === 'sent' ? 's' : 'p');
  const unitName = () => (state.settings.mode === 'sent' ? '句' : '段');
  function unitsOf(t) { const ix = getIx(t); return state.settings.mode === 'sent' ? ix.sents.map(s => s.t) : ix.paras; }
  const idxOf = t => (state.settings.mode === 'sent' ? t.pos.sent : t.pos.para);
  const unitKey = t => modeKey() + idxOf(t);
  const running = () => !!(state.active && C.sessionStats(state.active.events).running);
  const hasUserData = () => !!(state.texts.length || state.vocab.length || state.notes.length || state.sessions.length || state.active);
  function pushEv(type, extra) { if (state.active) state.active.events.push({ t: Date.now(), type, ...(extra || {}) }); }
  function startOrResume() {
    if (!state.active) {
      const t = curText();
      state.active = { textId: t ? t.id : null, title: t ? t.title : '', date: today(), breakAck: 0, events: [{ t: Date.now(), type: 'start' }] };
    } else if (!running()) pushEv('resume');
    lastTick = Date.now();
  }

  // ---------- 确认区 ----------
  function askConfirm(title, detail, yes) {
    pendingYes = yes;
    $('confirm-title').textContent = title;
    $('confirm-detail').textContent = detail;
    $('confirm-box').hidden = false;
    $('confirm-no').focus();
    $('confirm-box').scrollIntoView({ block: 'nearest' });
  }
  function closeConfirm() { pendingYes = null; $('confirm-box').hidden = true; }
  $('confirm-yes').addEventListener('click', () => { const f = pendingYes; closeConfirm(); if (f) f(); });
  $('confirm-no').addEventListener('click', () => { closeConfirm(); toast('已取消,数据保持原样。'); });
  const summary = () => `当前有 ${state.texts.length} 篇文本、${state.vocab.length} 个生词、${state.notes.length} 条批注、${state.sessions.length} 条阅读记录。`;

  function applyState(next, msg) {
    state = next; settleActive(); ixCache.clear();
    tab = curText() ? 'read' : 'library';
    lastTick = Date.now(); lastPersist = Date.now();
    commit(msg);
  }

  // ---------- 渲染 ----------
  function renderChrome() {
    document.documentElement.dataset.theme = state.settings.theme;
    $('theme-toggle').setAttribute('aria-pressed', String(state.settings.theme === 'dark'));
    $('theme-toggle').textContent = state.settings.theme === 'dark' ? '浅色模式' : '深色模式';
    const w = [warnings.load, warnings.save].filter(Boolean).join(' ');
    $('save-warning').textContent = w; $('save-warning').hidden = !w;
    $('sample-note').hidden = !state.sample;
    for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    for (const name of ['read', 'library', 'vocab', 'stats', 'export']) $('tab-' + name).hidden = name !== tab;
  }

  function renderReader() {
    const t = curText();
    $('read-empty').hidden = !!t; $('reader').hidden = !t;
    if (!t) return;
    const units = unitsOf(t), idx = idxOf(t), total = units.length, done = idx >= total;
    $('read-title').textContent = t.title;
    $('read-progress').textContent = done ? `已读完(共 ${total} ${unitName()})` : `第 ${idx + 1} / ${total} ${unitName()}`;
    $('mode-para').setAttribute('aria-pressed', String(state.settings.mode === 'para'));
    $('mode-sent').setAttribute('aria-pressed', String(state.settings.mode === 'sent'));
    $('unit-card').hidden = done; $('finished').hidden = !done;
    $('prev').textContent = '上一' + unitName(); $('next').textContent = '下一' + unitName();
    $('prev').disabled = idx <= 0; $('next').disabled = done; $('skip').disabled = done;
    $('add-vocab').disabled = done; $('add-doubt').disabled = done;
    if (!done) {
      const c = C.countChars(units[idx]);
      const parts = [];
      if (c.cjk) parts.push(`${c.cjk} 字`);
      if (c.words) parts.push(`${c.words} 词`);
      $('unit-meta').innerHTML = `<span>${esc(parts.join(' · ') || '无文字')}</span><span id="unit-stay"></span>` + (t.skips.includes(unitKey(t)) ? '<span class="tag">已标记:先读过去</span>' : '');
      $('unit-text').textContent = units[idx];
    }
    renderSession();
  }

  function renderSession() {
    const a = state.active;
    const t = curText();
    const live = a ? C.sessionStats(a.events.concat(running() ? [{ t: Date.now(), type: 'tick' }] : [])) : { seconds: 0, minutes: 0, chars: 0, marks: 0, cpm: 0, running: false };
    $('clock').textContent = C.fmtClock(live.seconds);
    $('sess-state').textContent = !a ? '未开始' : live.running ? '计时中' : '已暂停';
    $('sess-toggle').textContent = !a ? '开始计时' : live.running ? '暂停' : '继续';
    $('sess-end').disabled = !a;
    $('st-chars').textContent = String(live.chars);
    $('st-min').textContent = String(live.minutes);
    $('st-cpm').textContent = String(live.cpm);
    $('st-marks').textContent = String(live.marks);
    const due = !!a && live.running && C.breakDue(live.seconds, a.breakAck, state.settings.breakMin);
    $('break-note').hidden = !due;
    if (due) $('break-text').textContent = `这一轮已经连续读了 ${C.fmtClock(live.seconds - a.breakAck)}(设定每 ${state.settings.breakMin} 分钟休息一次)。站起来走一走,让眼睛离开屏幕。`;
    const stay = $('unit-stay');
    if (stay && t && idxOf(t) < unitsOf(t).length) stay.textContent = `本${unitName()}已停留 ${C.fmtClock(t.times[unitKey(t)] || 0)}`;
  }

  function textStats(t) { const c = C.countChars(t.body); const ix = getIx(t); return { c, ix }; }
  function renderLibrary() {
    $('text-count').textContent = state.texts.length ? `${state.texts.length} 篇` : '';
    if (!state.texts.length) { $('text-list').innerHTML = '<div class="empty"><p>还没有文本。在左边粘贴正文,或点右上角「载入示例」。</p></div>'; return; }
    $('text-list').innerHTML = state.texts.map(t => {
      const { c, ix } = textStats(t);
      const pct = ix.paras.length ? Math.round((t.pos.para / ix.paras.length) * 100) : 0;
      return `<div class="item ${t.id === state.currentTextId ? 'current' : ''}">
        <div class="head"><span class="word">${esc(t.title)}</span>${t.sample ? '<span class="badge sample">合成示例</span>' : ''}</div>
        <div class="muted">中文 ${c.cjk} 字 · 英文 ${c.words} 词 · ${ix.paras.length} 段 · ${ix.sents.length} 句 · 添加于 ${esc(t.addedAt)}</div>
        <div class="muted">${t.pos.para >= ix.paras.length ? '已读完' : `读到第 ${t.pos.para + 1} / ${ix.paras.length} 段`}(${pct}%)</div>
        <div class="row"><button type="button" class="primary" data-act="open" data-id="${esc(t.id)}">${t.id === state.currentTextId ? '回到阅读' : '打开阅读'}</button><button type="button" class="danger" data-act="del-text" data-id="${esc(t.id)}">删除</button></div>
      </div>`;
    }).join('');
  }

  function renderVocab() {
    $('vocab-count').textContent = String(state.vocab.length);
    $('note-count').textContent = String(state.notes.length);
    const list = C.sortVocab(state.vocab, $('vocab-sort').value);
    $('vocab-list').innerHTML = list.length ? list.map(v => `<div class="item">
      <div class="head"><span class="word">${esc(v.word)}</span><span class="badge">出现 ${v.count} 次</span></div>
      <div class="ctx">${esc(v.context || '（没有记录上下文）')}</div>
      ${v.extra.length ? `<div class="muted">另有 ${v.extra.length} 条不同的上下文</div>` : ''}
      <div class="head"><span class="muted">来源:${esc(v.source)} · 添加 ${esc(v.date)}${v.lastDate !== v.date ? ` · 最近 ${esc(v.lastDate)}` : ''}</span><button type="button" class="link" data-act="del-vocab" data-id="${esc(v.id)}">删除</button></div>
    </div>`).join('') : '<div class="empty"><p>生词表是空的。阅读时选中一个词,点「加入生词表」。</p></div>';
    const notes = state.notes.slice().reverse();
    $('note-list').innerHTML = notes.length ? notes.map(n => `<div class="item">
      <div class="head"><span class="badge ${n.kind}">${n.kind === 'skip' ? '先读过去' : '不同意 / 存疑'}</span><span class="muted">${esc(n.date)}</span></div>
      <div class="quote">${esc(n.quote)}</div>
      ${n.note ? `<div class="ctx">批注:${esc(n.note)}</div>` : ''}
      <div class="head"><span class="muted">来源:${esc(n.source)}</span><button type="button" class="link" data-act="del-note" data-id="${esc(n.id)}">删除</button></div>
    </div>`).join('') : '<div class="empty"><p>批注清单是空的。读到不同意或存疑的话,选中后点「不同意 / 存疑」。</p></div>';
  }

  function renderStats() {
    const s = state.settings, td = today();
    if (document.activeElement !== $('goal-min')) $('goal-min').value = String(s.goalMin);
    if (document.activeElement !== $('break-min')) $('break-min').value = String(s.breakMin);
    const days = C.dailyStats(state.sessions);
    const todayD = days.find(d => d.date === td);
    const todaySec = todayD ? todayD.seconds : 0;
    const goalSec = s.goalMin * 60;
    const st = C.streak(days, s.goalMin, td);
    const wk = C.weekCompare(state.sessions, td);
    const gr = C.goalRate(days, s.goalMin, td);
    const longest = state.sessions.reduce((m, x) => Math.max(m, x.seconds), 0);
    const totalSec = state.sessions.reduce((m, x) => m + x.seconds, 0);
    const totalChars = state.sessions.reduce((m, x) => m + x.chars, 0);
    const pct = Math.round((todaySec / goalSec) * 100);
    const sign = wk.deltaMinutes > 0 ? '+' : '';
    let rows = '';
    for (let i = 0; i < 14; i++) {
      const date = C.addDays(td, -i);
      const d = days.find(x => x.date === date);
      const sec = d ? d.seconds : 0;
      const met = sec >= goalSec;
      rows += `<div class="daily-row"><span>${esc(date)}</span><div class="bar ${met ? 'met' : ''}" role="img" aria-label="${esc(date)} 完成目标的 ${Math.min(100, Math.round((sec / goalSec) * 100))}%"><i style="--w:${Math.min(100, (sec / goalSec) * 100)}%"></i></div><span class="num">${d ? d.minutes : 0} 分钟 · 阅读量 ${d ? d.chars : 0} ${met ? '<span class="met-text">达标</span>' : ''}</span></div>`;
    }
    $('stats-body').innerHTML = `
      <div class="tiles">
        <div class="tile"><span class="label">今天</span><span class="value">${round1(todaySec / 60)} 分钟</span><span class="sub">目标 ${s.goalMin} 分钟 · 完成 ${pct}%</span><div class="bar ${todaySec >= goalSec ? 'met' : ''}"><i style="--w:${Math.min(100, (todaySec / goalSec) * 100)}%"></i></div></div>
        <div class="tile"><span class="label">连续达标</span><span class="value">${st.current} 天</span><span class="sub">历史最长 ${st.best} 天</span></div>
        <div class="tile"><span class="label">最长单次会话</span><span class="value">${round1(longest / 60)} 分钟</span><span class="sub">共 ${state.sessions.length} 次会话</span></div>
        <div class="tile"><span class="label">近 7 天目标完成率</span><span class="value">${gr.met} / ${gr.of}</span><span class="sub">${Math.round(gr.rate * 100)}%</span></div>
        <div class="tile"><span class="label">本周(周一起)</span><span class="value">${wk.thisWeek.minutes} 分钟</span><span class="sub">${wk.thisWeek.chars} 字 · ${wk.thisWeek.activeDays} 天有阅读</span></div>
        <div class="tile"><span class="label">上周</span><span class="value">${wk.lastWeek.minutes} 分钟</span><span class="sub">${wk.lastWeek.chars} 字 · ${wk.lastWeek.activeDays} 天有阅读</span></div>
        <div class="tile"><span class="label">本周比上周</span><span class="value">${sign}${wk.deltaMinutes} 分钟</span><span class="sub">${wk.pct === null ? '上周没有记录' : `${wk.pct > 0 ? '+' : ''}${wk.pct}%`}</span></div>
        <div class="tile"><span class="label">累计</span><span class="value">${round1(totalSec / 3600)} 小时</span><span class="sub">${totalChars} 字</span></div>
      </div>
      <div class="panel"><h2>最近 14 天</h2><p class="muted">每行:当天阅读分钟和阅读量(中文按字、英文按词,合计);只统计已「结束并记录」的会话;达标 = 当天分钟 ≥ 每天目标。</p>${state.active ? '<p class="muted">进行中的会话点「结束并记录」之后才计入这里。</p>' : ''}<div class="daily">${rows}</div></div>`;
  }

  function notesMd() { return C.toMarkdown(state.notes, today()); }
  function renderExport() {
    $('export-vocab').disabled = !state.vocab.length;
    $('export-notes').disabled = !state.notes.length;
    $('export-sessions').disabled = !state.sessions.length;
    $('notes-preview').textContent = state.notes.length ? notesMd() : '（还没有批注）';
    $('export-note').textContent = (state.active ? '有一个进行中的会话,它还没有记入阅读记录;先点「结束并记录」再导出。' : '导出内容就是下方各列表当前显示的数据。') + ' 生词、阅读记录的 CSV 会给以 = + - @ 开头的内容加单引号,防止表格软件当成公式执行。';
  }

  function render() {
    renderChrome(); renderReader(); renderLibrary(); renderVocab(); renderStats(); renderExport();
  }

  // ---------- 阅读动作 ----------
  function clearSel() { $('sel-text').value = ''; $('sel-note').value = ''; }
  function go(delta, msg) {
    const t = curText(); if (!t) return;
    const ix = getIx(t), units = unitsOf(t), idx = idxOf(t);
    let note = msg;
    if (delta > 0) {
      if (idx >= units.length) return;
      if (!running()) { startOrResume(); note = note || '已自动开始计时。'; }
      pushEv('read', { chars: C.countChars(units[idx]).total });
    } else if (idx <= 0) return;
    t.pos = C.advance(ix, t.pos, state.settings.mode, delta);
    clearSel();
    commit(note);
  }
  function skipOver() {
    const t = curText(); if (!t) return;
    const units = unitsOf(t), idx = idxOf(t);
    if (idx >= units.length) return;
    const key = unitKey(t);
    if (!t.skips.includes(key)) t.skips.push(key);
    state.notes.push({ id: C.newId('n'), textId: t.id, source: t.title, kind: 'skip', quote: units[idx], note: $('sel-note').value.trim(), date: today() });
    if (!running()) startOrResume();
    pushEv('mark');
    go(1, '已标记「先读过去」,继续往下读。');
  }
  function addVocabAction() {
    const t = curText(); if (!t) return;
    const units = unitsOf(t), idx = idxOf(t);
    const word = C.normWord($('sel-text').value);
    if (idx >= units.length) { toast('这篇已读完,回到上一段再标记。'); return; }
    if (!word) { toast('先在正文里选中一个词,或在「选中的词或句」里输入。'); return; }
    const r = C.addVocab(state.vocab, word, C.contextOf(units[idx], word), t.title, today());
    state.vocab = r.list;
    pushEv('mark');
    clearSel();
    commit(r.isNew ? `已加入生词表:${word}` : `「${word}」已在生词表里,出现次数记为 ${r.entry.count}。`);
  }
  function addDoubtAction() {
    const t = curText(); if (!t) return;
    const units = unitsOf(t), idx = idxOf(t);
    const quote = C.normWord($('sel-text').value);
    if (idx >= units.length) { toast('这篇已读完,回到上一段再标记。'); return; }
    if (!quote) { toast('先在正文里选中存疑的那句话,或在「选中的词或句」里输入。'); return; }
    state.notes.push({ id: C.newId('n'), textId: t.id, source: t.title, kind: 'doubt', quote, note: $('sel-note').value.trim(), date: today() });
    pushEv('mark');
    clearSel();
    commit('已加入批注清单。');
  }
  function toggleSession() {
    if (running()) { pushEv('pause'); commit('已暂停计时。'); return; }
    startOrResume(); commit(state.active.events.length === 1 ? '开始计时。' : '继续计时。');
  }
  function endSession() {
    const a = state.active; if (!a) return;
    const rec = C.finalizeSession(a, Date.now());
    state.active = null;
    if (!rec) { commit('这次会话没有读到内容,已丢弃。'); return; }
    state.sessions.push(rec);
    commit(`已记录:${C.fmtClock(rec.seconds)},${rec.chars} 字,${rec.marks} 个标记。`);
  }
  function setMode(mode) { if (state.settings.mode !== mode) { state.settings.mode = mode; clearSel(); commit(); } }

  // ---------- 事件 ----------
  $('prev').addEventListener('click', () => go(-1));
  $('next').addEventListener('click', () => go(1));
  $('skip').addEventListener('click', skipOver);
  $('reread').addEventListener('click', () => { const t = curText(); if (t) { t.pos = C.posAt(getIx(t), state.settings.mode, 0); commit('已回到开头。'); } });
  $('mode-para').addEventListener('click', () => setMode('para'));
  $('mode-sent').addEventListener('click', () => setMode('sent'));
  $('add-vocab').addEventListener('click', addVocabAction);
  $('add-doubt').addEventListener('click', addDoubtAction);
  $('sel-clear').addEventListener('click', clearSel);
  $('sess-toggle').addEventListener('click', toggleSession);
  $('sess-end').addEventListener('click', endSession);
  $('break-ack').addEventListener('click', () => {
    if (!state.active) return;
    state.active.breakAck = C.sessionStats(state.active.events.concat([{ t: Date.now(), type: 'tick' }])).seconds;
    commit('好,重新计时,下一次休息提示在一个间隔之后。');
  });
  $('goto-library').addEventListener('click', () => { tab = 'library'; render(); });
  $('theme-toggle').addEventListener('click', () => { state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark'; commit(); });
  for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => { tab = b.dataset.tab; render(); });
  $('vocab-sort').addEventListener('change', renderVocab);

  document.addEventListener('selectionchange', () => {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed) return;
    const card = $('unit-text');
    if (!card.contains(sel.anchorNode) || !card.contains(sel.focusNode)) return;
    const s = sel.toString().replace(/\s+/g, ' ').trim();
    if (s) $('sel-text').value = s;
  });

  // 文本库
  $('add-form').addEventListener('submit', e => {
    e.preventDefault();
    const r = C.makeText($('text-title').value, $('text-body').value, today());
    if (!r.ok) { $('add-error').textContent = r.error; $('add-error').hidden = false; return; }
    $('add-error').hidden = true;
    state.texts.push(r.text); const rec = C.switchText(state, r.text.id, Date.now()); tab = 'read';
    $('text-title').value = ''; $('text-body').value = ''; $('text-file').value = '';
    commit(rec ? '已加入文本库;上一篇的阅读会话已结束并记录。' : '已加入文本库,可以开始读了。');
  });
  $('text-file').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const txt = await f.text();
      if (txt.trim() === '') { $('add-error').textContent = `文件「${f.name}」是空的,没有读到内容,正文框里的内容没有改动。`; $('add-error').hidden = false; return; }
      $('text-body').value = txt;
      if (!$('text-title').value.trim()) $('text-title').value = f.name.replace(/\.(txt|md|markdown)$/i, '');
      const bad = txt.includes('�');
      $('add-error').textContent = bad ? '文件里有无法识别的字符,它可能不是 UTF-8 编码,请核对正文后再加入。' : '';
      $('add-error').hidden = !bad;
    } catch (err) { $('add-error').textContent = '读取文件失败:' + err.message; $('add-error').hidden = false; }
  });
  $('text-list').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const t = state.texts.find(x => x.id === b.dataset.id); if (!t) return;
    if (b.dataset.act === 'open') { const rec = C.switchText(state, t.id, Date.now()); tab = 'read'; commit(rec ? '已结束上一篇的阅读会话并记录,新会话从这篇开始。' : ''); return; }
    if (b.dataset.act === 'del-text') {
      askConfirm(`删除《${t.title}》?`, '文本和它的阅读进度会删除;已记下的生词、批注和阅读记录保留。建议先导出 JSON 备份。', () => {
        state.texts = state.texts.filter(x => x.id !== t.id);
        if (state.currentTextId === t.id) C.switchText(state, null, Date.now());
        ixCache.delete(t.id);
        commit('已删除文本。');
      });
    }
  });
  // 列表重绘后把焦点放回相邻条目的删除按钮(没有条目时放到标签页按钮)
  function focusNear(sel, i) {
    const all = document.querySelectorAll(sel);
    const target = all[Math.min(i, all.length - 1)] || document.querySelector('[data-tab="vocab"]');
    if (target) target.focus();
  }
  $('vocab-list').addEventListener('click', e => {
    const b = e.target.closest('[data-act="del-vocab"]'); if (!b) return;
    const v = state.vocab.find(x => x.id === b.dataset.id); if (!v) return;
    askConfirm(`删除生词「${C.snippet(v.word, 30)}」?`, `将删除这个词和它记录的 ${(v.context ? 1 : 0) + v.extra.length} 条上下文(出现 ${v.count} 次),此操作不能撤销;确认前数据不变。建议先导出生词 CSV。`, () => {
      const at = state.vocab.findIndex(x => x.id === v.id);
      state.vocab = state.vocab.filter(x => x.id !== v.id);
      commit('已删除这个生词。');
      focusNear('[data-act="del-vocab"]', at);
    });
  });
  $('note-list').addEventListener('click', e => {
    const b = e.target.closest('[data-act="del-note"]'); if (!b) return;
    const n = state.notes.find(x => x.id === b.dataset.id); if (!n) return;
    askConfirm(`删除这条${n.kind === 'skip' ? '「先读过去」' : '「不同意 / 存疑」'}批注?`, `原文摘要:「${C.snippet(n.quote, 40)}」${n.note ? `;批注:「${C.snippet(n.note, 40)}」` : ''}。此操作不能撤销;确认前数据不变。建议先导出批注 Markdown。`, () => {
      state.notes = state.notes.filter(x => x.id !== n.id);
      commit('已删除这条批注。');
      focusNear('[data-act="del-note"]', 0);
    });
  });

  // 设置
  $('settings-form').addEventListener('submit', e => {
    e.preventDefault();
    const goal = Number($('goal-min').value), brk = Number($('break-min').value);
    const err = $('settings-error');
    if ($('goal-min').value.trim() === '' || !Number.isFinite(goal) || goal <= 0) { err.textContent = '每天目标必须是大于 0 的数字(分钟)。'; err.hidden = false; return; }
    if ($('break-min').value.trim() === '' || !Number.isFinite(brk) || brk <= 0) { err.textContent = '休息间隔必须是大于 0 的数字(分钟)。'; err.hidden = false; return; }
    err.hidden = true;
    state.settings.goalMin = goal; state.settings.breakMin = brk;
    commit('已保存设置。');
  });

  // 示例、导入、导出、清空
  function loadSample() {
    const b = SAMPLE.build(today(), C);
    const s = C.emptyState();
    s.settings = { ...state.settings };
    Object.assign(s, { texts: b.texts, vocab: b.vocab, notes: b.notes, sessions: b.sessions, currentTextId: b.texts[0].id, sample: true });
    const v = C.validateState(s);
    if (!v.ok) { toast('示例数据没有通过校验:' + v.error); return; }
    applyState(s, '已载入合成示例。');
  }
  $('load-sample').addEventListener('click', () => {
    if (!hasUserData()) { loadSample(); return; }
    askConfirm('载入示例会替换当前全部数据', summary() + '确认后这些内容全部被示例替换;取消则保持原样。建议先导出 JSON 备份。', loadSample);
  });
  $('clear-data').addEventListener('click', () => {
    askConfirm('清空全部数据?', summary() + '清空后无法恢复,建议先导出 JSON 备份。', () => {
      const s = C.emptyState(); s.settings = { ...state.settings };
      applyState(s, '已清空。');
    });
  });
  $('import-file').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    const msg = $('import-msg');
    let text = '';
    try { text = await f.text(); } catch (err) { msg.textContent = '导入被拒绝:读取文件失败。'; msg.hidden = false; e.target.value = ''; return; }
    e.target.value = '';
    const v = C.validateImport(text);
    if (!v.ok) { msg.textContent = '导入被拒绝,当前数据没有改动。原因:' + v.error; msg.hidden = false; return; }
    msg.hidden = true;
    const next = v.state;
    if (!hasUserData()) { applyState(next, '已导入备份。'); return; }
    askConfirm('导入会替换当前全部数据', summary() + `备份里有 ${next.texts.length} 篇文本、${next.vocab.length} 个生词。确认后替换;取消则保持原样。`, () => applyState(next, '已导入备份。'));
  });
  function download(name, text, type) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(new Blob([text], { type: type || 'text/plain;charset=utf-8' }));
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $('export-vocab').addEventListener('click', () => download(`精读-生词-${today()}.csv`, '\uFEFF' + C.vocabCsv(C.sortVocab(state.vocab, $('vocab-sort').value)), 'text/csv;charset=utf-8'));
  $('export-notes').addEventListener('click', () => download(`精读-批注-${today()}.md`, notesMd(), 'text/markdown;charset=utf-8'));
  $('export-sessions').addEventListener('click', () => download(`精读-阅读记录-${today()}.csv`, '\uFEFF' + C.sessionsCsv(state.sessions), 'text/csv;charset=utf-8'));
  $('export-json').addEventListener('click', () => download(`精读-备份-${today()}.json`, JSON.stringify(state, null, 2), 'application/json'));

  // ---------- 计时器 ----------
  setInterval(() => {
    const now = Date.now();
    if (running()) {
      const t = curText();
      if (t && idxOf(t) < unitsOf(t).length) { const k = unitKey(t); t.times[k] = round1((t.times[k] || 0) + Math.min(5, (now - lastTick) / 1000)); }
      if (now - lastPersist >= PERSIST_MS) { pushEv('tick'); save(); renderChrome(); lastPersist = now; }
    }
    lastTick = now;
    if (tab === 'read') renderSession();
  }, 1000);
  window.addEventListener('pagehide', () => { if (running()) { pushEv('tick'); save(); } });

  load();
  tab = curText() ? 'read' : 'library';
  render();
})();
