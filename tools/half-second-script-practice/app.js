'use strict';
(function () {
  const C = globalThis.HalfsecCore;
  const KEY = 'halfsec.v1';
  const HEAT_WEEKS = 12;
  const BAR_WEEKS = 8;
  const $ = id => document.getElementById(id);

  const pad = n => String(n).padStart(2, '0');
  const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const todayStr = () => C.resolveToday(location.search, localDate());
  const nowStr = () => { const d = new Date(); return `${todayStr()}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  let state = C.emptyState();
  let sel = null;          // 当前选中的脚本 id
  let formId = null;       // 脚本表单正在编辑的脚本 id(null = 新建)
  let tab = 'practice';
  let running = null;      // { scriptId, t0, timer }
  let pendingConfirm = null;
  let toastTimer = null;
  let heatSel = null;      // 热力日历当前选中的日期

  // ---------- 存储 ----------
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch (e) { return false; }
  }
  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { return; }
    if (!raw) return;
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
    const v = C.validateState(parsed);
    if (v.ok) { state = v.state; return; }
    try { localStorage.setItem(KEY + '.rejected', raw); } catch (e) { /* 备份失败不影响提示 */ }
    toast('本机保存的数据未通过校验,已不载入(原文另存为 halfsec.v1.rejected)。原因:' + (parsed ? v.errors[0] : '不是有效的 JSON') + '。下一次保存会覆盖当前键。', true);
  }
  // 返回 true = 新状态合法并已应用(是否写入见 persist 结果与警示条)
  function commit(next, okMsg) {
    const v = C.validateState(next);
    if (!v.ok) { toast('未保存:' + v.errors[0], true); return false; }
    state = next;
    const saved = persist();
    $('save-warning').hidden = saved;
    renderAll();
    if (saved && okMsg) toast(okMsg);
    return true;
  }
  function toast(msg, isError) {
    const t = $('toast');
    t.textContent = msg; t.className = 'toast' + (isError ? ' error' : ''); t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 9000 : 3500);
  }
  function ask(msg, fn) {
    pendingConfirm = fn;
    $('confirm-msg').textContent = msg;
    $('confirm').hidden = false;
    $('confirm-yes').focus();
  }
  function closeConfirm() { pendingConfirm = null; $('confirm').hidden = true; }
  function download(name, text, type) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(new Blob([text], { type: type || 'text/plain;charset=utf-8' }));
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const script = () => state.scripts.find(s => s.id === sel) || null;
  const hasData = () => state.scripts.length > 0 || state.practices.length > 0 || state.triggers.length > 0;
  const percent = r => Math.round(r * 100);

  // ---------- 草稿与设置(确认与导出判据) ----------
  const SCRIPT_FIELDS = [['text', 'f-text'], ['identity', 'f-identity'], ['situation', 'f-situation'], ['reason', 'f-reason'], ['emotion', 'f-emotion']];
  function scriptDraft() {
    const s = state.scripts.find(x => x.id === formId) || null;
    return SCRIPT_FIELDS.some(([k, id]) => $(id).value.trim() !== (s ? s[k] : ''));
  }
  function wordsDraft() {
    return parseWords($('verbs').value).join(',') !== state.config.actionVerbs.join(',') || parseWords($('emotions').value).join(',') !== state.config.emotionWords.join(',');
  }
  function drafts() {
    const d = [];
    if (scriptDraft()) d.push('脚本编辑器里未保存的内容');
    if ($('t-situation').value.trim() || $('t-reaction').value.trim()) d.push('触发记录表单里未提交的内容');
    if (wordsDraft()) d.push('词表里未保存的修改');
    if ($('name').value.trim() !== state.name) d.push('名字框里未保存的修改');
    return d;
  }
  function customSettings() {
    const def = C.emptyState().config;
    return !!state.name || state.config.actionVerbs.join(',') !== def.actionVerbs.join(',') || state.config.emotionWords.join(',') !== def.emotionWords.join(',');
  }
  const hasUserData = () => hasData() || customSettings() || drafts().length > 0;
  function scopeText() {
    const d = drafts();
    return `${state.scripts.length} 条脚本、${state.practices.length} 条练习、${state.triggers.length} 条触发记录` +
      (customSettings() ? '、你的名字与词表设置' : '') + (d.length ? '以及' + d.join('、') : '');
  }
  /* 有未保存草稿时,普通导出暂停(导出的是已保存数据,与界面不一致);存储失败条里的备份按钮不受影响 */
  function syncExport() {
    const d = drafts();
    for (const id of ['export-csv', 'export-md', 'export-json']) $(id).disabled = d.length > 0;
    const n = $('export-note');
    n.hidden = d.length === 0;
    n.textContent = d.length ? '导出已暂停:' + d.join('、') + '。请先保存或清掉这些内容,再导出。' : '';
  }
  function fieldError(id, msg) {
    const e = $(id + '-err');
    e.textContent = msg; e.hidden = false;
    $(id).setAttribute('aria-invalid', 'true');
  }
  function clearFieldErrors(ids) {
    for (const id of ids) { $(id + '-err').hidden = true; $(id).removeAttribute('aria-invalid'); }
  }

  // ---------- 渲染 ----------
  function renderTabs() {
    for (const b of document.querySelectorAll('.tabs [data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    for (const t of ['practice', 'script', 'trigger', 'export']) $('tab-' + t).hidden = t !== tab;
  }
  function renderSide() {
    const list = $('script-list');
    list.textContent = '';
    const today = todayStr();
    const keepFocus = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.id : null;
    let refocus = null;
    for (const s of state.scripts) {
      const st = C.stats(state, s.id, today);
      const b = el('button', 'script-item');
      b.type = 'button'; b.dataset.id = s.id; b.disabled = !!running;
      if (s.id === sel) b.setAttribute('aria-current', 'true');
      if (s.id === keepFocus) refocus = b;
      b.append(el('span', 't', s.text), el('span', 'm', `今日 ${st.today} · 累计 ${st.total} · 连续 ${st.streak} 天`));
      list.append(b);
    }
    if (refocus && !refocus.disabled) refocus.focus();
    $('script-count').textContent = `${state.scripts.length} / ${C.MAX_SCRIPTS}`;
    $('new-script').disabled = state.scripts.length >= C.MAX_SCRIPTS || !!running;
    $('new-script').title = state.scripts.length >= C.MAX_SCRIPTS ? `最多 ${C.MAX_SCRIPTS} 条脚本` : '';
    if (document.activeElement !== $('name')) $('name').value = state.name;
    $('verbs').value = state.config.actionVerbs.join(',');
    $('emotions').value = state.config.emotionWords.join(',');
    $('sample-banner').hidden = !state.sample;
    const tn = $('today-note');
    let fixed = null;
    try { fixed = new URLSearchParams(location.search).get('today'); } catch (e) { fixed = null; }
    tn.hidden = !(fixed && fixed === today);
    if (!tn.hidden) tn.textContent = `基准日 ${today}(由地址参数固定)`;
  }
  function renderPractice() {
    const s = script();
    $('practice-empty').hidden = !!s;
    $('practice-main').hidden = !s;
    if (!s) return;
    const loud = s.loud;
    $('stage-text').textContent = loud ? C.thirdPerson(s.text, state.name) : s.text;
    const second = $('stage-second');
    second.hidden = !(loud && state.name.trim());
    second.textContent = loud ? '也可以对自己说:' + C.secondPerson(s.text) : '';
    $('stage').classList.toggle('running', !!running);
    $('start').disabled = !!running;
    $('stop').disabled = !running;
    const lt = $('loud-toggle');
    lt.textContent = '姓名/你版本:' + (loud ? '开' : '关');
    lt.setAttribute('aria-pressed', String(loud));
    lt.disabled = !!running;
    const today = todayStr();
    const st = C.stats(state, s.id, today);
    $('stat-today').textContent = st.today;
    $('stat-total').textContent = st.total;
    $('stat-streak').textContent = st.streak;
    $('stat-note').textContent = `以上三项只统计所选脚本「${s.text}」里满 ${C.MIN_SECONDS} 秒的练习。今日次数 = 基准日 ${today} 当天的次数;累计次数 = 全部合格练习;连续天数 = 以今天(今天未练则从昨天)往前每天都有练习的天数,昨天也没练则为 0。` +
      (st.total === 0 ? '目前没有合格练习,所以三项都是 0。' : '');
    updateTimer();
    renderHeat(s, today);
    renderWeekly(s, today);
  }
  function renderHeat(s, today) {
    const recs = state.practices.filter(r => r.scriptId === s.id);
    const days = (HEAT_WEEKS - 1) * 7 + C.dow(today) + 1; // 第一格正好是周一
    const cells = C.heatmap(recs, days, today);
    const box = $('heatmap');
    box.textContent = '';
    const focusDate = heatSel && cells.some(c => c.date === heatSel) ? heatSel : today;
    for (const c of cells) {
      const d = el('button', `cell lv${c.level}` + (c.date === today ? ' today' : ''));
      d.type = 'button';
      d.dataset.date = c.date; d.dataset.count = String(c.count);
      d.tabIndex = c.date === focusDate ? 0 : -1;
      d.setAttribute('aria-label', `${c.date}:${c.count} 次`);
      d.title = `${c.date}:${c.count} 次`;
      box.append(d);
    }
    showHeat(focusDate, false);
    const wrap = box.parentElement;
    wrap.scrollLeft = wrap.scrollWidth;
  }
  function showHeat(date, focus) {
    const cells = Array.from($('heatmap').children);
    const target = cells.find(c => c.dataset.date === date);
    if (!target) return;
    heatSel = date;
    for (const c of cells) c.tabIndex = c === target ? 0 : -1;
    $('heat-readout').textContent = `${date}${date === todayStr() ? '(今天)' : ''}:${target.dataset.count} 次(满 ${C.MIN_SECONDS} 秒的练习)。`;
    if (focus) target.focus();
  }
  function onHeatKey(e) {
    const b = e.target.closest('.cell'); if (!b) return;
    const cells = Array.from($('heatmap').children);
    const i = cells.indexOf(b);
    const step = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[e.key];
    let j = null;
    if (step !== undefined) j = i + step; else if (e.key === 'Home') j = 0; else if (e.key === 'End') j = cells.length - 1;
    if (j === null) return;
    e.preventDefault();
    if (j >= 0 && j < cells.length) showHeat(cells[j].dataset.date, true);
  }
  function renderWeekly(s, today) {
    const recs = state.practices.filter(r => r.scriptId === s.id);
    const weeks = C.weeklyCounts(recs, BAR_WEEKS, today);
    const max = Math.max(1, ...weeks.map(w => w.count));
    const box = $('weekly');
    box.textContent = '';
    for (const w of weeks) {
      const col = el('div', 'week');
      col.title = `${w.start} 起一周:${w.count} 次`;
      const bar = el('div', 'bar');
      bar.style.height = (w.count / max * 100) + '%'; // 运行时数据高度
      const holder = el('div', 'col'); holder.append(bar);
      col.append(el('span', 'n', String(w.count)), holder, el('span', 'l', w.start.slice(5).replace('-', '/')));
      box.append(col);
    }
  }
  function updateTimer() {
    const secs = running ? (performance.now() - running.t0) / 1000 : 0;
    $('timer').textContent = running ? `${secs.toFixed(1)} 秒 · 满 ${C.MIN_SECONDS} 秒后点「结束」才会计入` : `按「开始」后朗读脚本,满 ${C.MIN_SECONDS} 秒再点「结束」`;
    $('meter-fill').style.width = Math.min(100, secs / C.MIN_SECONDS * 100) + '%'; // 运行时进度
  }
  function renderCheck() {
    const box = $('check-result');
    box.textContent = '';
    const text = $('f-text').value;
    if (!text.trim()) return;
    const r = C.checkScript(text, state.config);
    box.append(el('span', 'badge', r.type === 'situational' ? '情境型(含“如果/当”,只在某个情境下用)' : '通用型(任何时候都适用)'));
    if (!r.issues.length) { box.append(el('p', 'muted', '规则检查通过:有动作词,没有情绪目标,长度合适。')); return; }
    const ul = el('ul');
    for (const i of r.issues) ul.append(el('li', i.level === 'warn' ? 'warn' : '', i.message));
    box.append(ul);
  }
  function fillForm() {
    const s = state.scripts.find(x => x.id === formId) || null;
    $('form-title').textContent = s ? '编辑脚本' : '新建脚本';
    $('f-text').value = s ? s.text : '';
    $('f-identity').value = s ? s.identity : '';
    $('f-situation').value = s ? s.situation : '';
    $('f-reason').value = s ? s.reason : '';
    $('f-emotion').value = s ? s.emotion : '';
    $('delete-script').hidden = !s;
    clearFieldErrors(['f-text']);
    renderCheck();
    syncExport();
  }
  function renderTriggers() {
    const s = script();
    $('trigger-empty').hidden = !!s;
    $('trigger-main').hidden = !s;
    if (!s) return;
    const today = todayStr();
    const mine = state.triggers.filter(t => t.scriptId === s.id);
    $('rate-title').textContent = '执行率:' + s.text;
    const box = $('rate-box');
    box.textContent = '';
    const row = (label, r) => {
      const d = el('div', 'rate');
      const m = el('div', 'meter'); const f = el('div', 'meter-fill');
      f.style.width = r.rate === null ? '0' : percent(r.rate) + '%'; // 运行时数据
      m.append(f);
      d.append(el('span', null, label), m, el('span', null, r.rate === null ? '暂无记录' : `${r.executed} / ${r.total} 次 · ${percent(r.rate)}%`));
      return d;
    };
    const r7 = C.executionRate(mine, 7, today), p7 = C.executionRate(mine, 7, today, 7), r30 = C.executionRate(mine, 30, today);
    box.append(row('近 7 天', r7), row('前 7 天', p7), row('近 30 天', r30));
    if (r7.rate !== null && p7.rate !== null) {
      const diff = percent(r7.rate) - percent(p7.rate);
      box.append(el('p', 'muted', diff === 0 ? '近 7 天与前 7 天持平。' : `近 7 天比前 7 天${diff > 0 ? '高' : '低'} ${Math.abs(diff)} 个百分点。`));
    }
    if (!$('t-date').value) $('t-date').value = today;
    const list = $('trigger-list');
    list.textContent = '';
    if (!mine.length) list.append(el('p', 'muted', '还没有触发记录。'));
    for (const t of mine.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 30)) {
      const d = el('div', 'trigger ' + (t.executed ? 'done' : 'miss'));
      const head = el('div', 'head');
      head.append(el('span', null, `${t.date} · ${t.executed ? '执行了脚本' : '没有执行'}`));
      const del = el('button', 'danger', '删除'); del.type = 'button'; del.dataset.del = t.id;
      head.append(del);
      d.append(head, el('div', 'body', `情境:${t.situation || '(未写)'}`), el('div', 'body', `第一反应:${t.reaction || '(未写)'}`));
      list.append(d);
    }
  }
  function renderExport() {
    $('md-preview').textContent = C.toMarkdown(state, todayStr());
  }
  function renderAll() { renderTabs(); renderSide(); renderPractice(); renderTriggers(); renderExport(); syncExport(); }

  // ---------- 练习 ----------
  function startPractice() {
    const s = script(); if (!s || running) return;
    running = { scriptId: s.id, t0: performance.now(), timer: setInterval(updateTimer, 100) };
    $('practice-msg').textContent = ''; $('practice-msg').className = 'practice-msg';
    renderAll();
    $('stop').focus();
  }
  function stopPractice() {
    if (!running) return;
    const secs = (performance.now() - running.t0) / 1000;
    const id = running.scriptId;
    clearInterval(running.timer); running = null;
    const r = C.recordPractice(state, id, secs, nowStr());
    const msg = $('practice-msg');
    if (!r.ok) { renderAll(); msg.className = 'practice-msg warn'; msg.textContent = r.error; return; }
    if (!r.counted) { renderAll(); msg.className = 'practice-msg warn'; msg.textContent = r.message; return; }
    const applied = commit(r.state, null);
    msg.className = 'practice-msg';
    msg.textContent = !applied ? '本次没有保存。' : $('save-warning').hidden ? r.message + '已保存。' : r.message + '但没能写入浏览器存储,见上方「未保存」提示。';
  }

  // ---------- 脚本 ----------
  function selectScript(id) {
    sel = id; formId = id; fillForm(); renderAll();
  }
  function saveScript(e) {
    e.preventDefault();
    const text = $('f-text').value.trim();
    clearFieldErrors(['f-text']);
    if (!text) { fieldError('f-text', '先写一句脚本。'); toast('脚本还没写,见输入框下方的提示。', true); $('f-text').focus(); return; }
    const fields = { text, identity: $('f-identity').value.trim(), situation: $('f-situation').value.trim(), reason: $('f-reason').value.trim(), emotion: $('f-emotion').value.trim() };
    let next, id = formId;
    if (formId) {
      next = Object.assign({}, state, { scripts: state.scripts.map(s => s.id === formId ? Object.assign({}, s, fields) : s) });
    } else {
      if (state.scripts.length >= C.MAX_SCRIPTS) { toast(`最多 ${C.MAX_SCRIPTS} 条脚本。`, true); return; }
      id = C.nextId('s', state.scripts);
      next = Object.assign({}, state, { scripts: state.scripts.concat([Object.assign({ id, loud: false }, fields)]) });
    }
    const prevSel = sel;
    sel = id; formId = id; // 先确定选中脚本,commit 内的渲染才会显示它
    if (commit(next, '脚本已保存。')) fillForm(); else { sel = prevSel; formId = prevSel === id ? id : formId; }
  }
  function deleteScript() {
    const s = state.scripts.find(x => x.id === formId); if (!s) return;
    ask(`删除脚本「${s.text}」及它的 ${state.practices.filter(x => x.scriptId === s.id).length} 条练习和 ${state.triggers.filter(x => x.scriptId === s.id).length} 条触发记录?确认前数据与统计不变;删除后无法恢复,建议先导出备份。`, () => {
      const next = Object.assign({}, state, {
        scripts: state.scripts.filter(x => x.id !== s.id),
        practices: state.practices.filter(x => x.scriptId !== s.id),
        triggers: state.triggers.filter(x => x.scriptId !== s.id)
      });
      sel = next.scripts.length ? next.scripts[0].id : null; formId = sel;
      if (commit(next, '脚本已删除。')) fillForm();
    });
  }
  function toggleLoud() {
    const s = script(); if (!s) return;
    const next = Object.assign({}, state, { scripts: state.scripts.map(x => x.id === s.id ? Object.assign({}, x, { loud: !x.loud }) : x) });
    commit(next, null);
    if (!s.loud && !state.name.trim()) $('practice-msg').textContent = '在左侧填上你的名字,姓名/你版本会换成第三人称;现在先用“你”。只改屏幕上的文字,请自己大声朗读。';
  }
  function saveName() {
    const next = Object.assign({}, state, { name: $('name').value.trim() });
    if (!commit(next, '名字已保存。')) $('name').value = state.name;
  }
  function parseWords(s) { return s.split(/[,，、\n]/).map(x => x.trim()).filter(Boolean); }
  function saveWords() {
    const next = Object.assign({}, state, { config: { actionVerbs: parseWords($('verbs').value), emotionWords: parseWords($('emotions').value) } });
    if (commit(next, '词表已保存。')) renderCheck();
  }
  function resetWords() {
    const d = C.emptyState().config;
    if (commit(Object.assign({}, state, { config: d }), '已恢复默认词表。')) renderCheck();
  }

  // ---------- 触发记录 ----------
  function addTrigger(e) {
    e.preventDefault();
    const s = script(); if (!s) return;
    const situation = $('t-situation').value.trim(), reaction = $('t-reaction').value.trim(), date = $('t-date').value;
    clearFieldErrors(['t-situation', 't-reaction', 't-date']);
    let first = null;
    if (!situation) { fieldError('t-situation', '请写一句刚才的情境。'); first = first || 't-situation'; }
    if (!reaction) { fieldError('t-reaction', '请写一句第一反应。'); first = first || 't-reaction'; }
    if (C.parseYmd(date) === null) { fieldError('t-date', '请选择有效的日期。'); first = first || 't-date'; }
    if (first) { toast('触发记录没有保存,见输入框下方的提示。', true); $(first).focus(); return; }
    const t = { id: C.nextId('t', state.triggers), scriptId: s.id, date, situation, reaction, executed: $('t-executed').value === 'yes' };
    if (commit(Object.assign({}, state, { triggers: state.triggers.concat([t]) }), '触发记录已保存。')) { $('t-situation').value = ''; $('t-reaction').value = ''; syncExport(); }
  }

  // ---------- 导出与导入 ----------
  function importFile(file) {
    const msg = $('import-msg');
    msg.className = 'import-msg'; msg.textContent = '';
    file.text().then(text => {
      const v = C.validateImport(text);
      if (!v.ok) {
        msg.className = 'import-msg error';
        msg.append(el('p', null, '导入被拒绝,当前数据没有改动。原因:'));
        const ul = el('ul'); for (const x of v.errors.slice(0, 8)) ul.append(el('li', null, x)); msg.append(ul);
        msg.scrollIntoView({ block: 'nearest' }); /* 提示在页面下方,窄屏要滚到可见处 */
        return;
      }
      const apply = () => {
        sel = v.state.scripts.length ? v.state.scripts[0].id : null; formId = sel;
        if (commit(v.state, null)) { fillForm(); msg.textContent = `已导入:${v.state.scripts.length} 条脚本、${v.state.practices.length} 条练习、${v.state.triggers.length} 条触发记录。`; msg.scrollIntoView({ block: 'nearest' }); }
      };
      if (hasUserData()) ask(`导入将用备份里的 ${v.state.scripts.length} 条脚本、${v.state.practices.length} 条练习、${v.state.triggers.length} 条触发记录,替换当前的 ${scopeText()}。确认前原数据不变,建议先导出备份。`, apply); else apply();
    }).catch(() => { msg.className = 'import-msg error'; msg.textContent = '读取文件失败。'; msg.scrollIntoView({ block: 'nearest' }); });
  }
  function loadSample() {
    const apply = () => {
      state = C.validateState(globalThis.HalfsecSample.build(todayStr())).state;
      const saved = persist(); $('save-warning').hidden = saved;
      sel = state.scripts[0].id; formId = sel; tab = 'practice'; fillForm(); renderAll();
      if (saved) toast('已载入合成示例。');
    };
    if (hasUserData()) ask(`载入示例会替换当前的 ${scopeText()}。确认前原数据不变,建议先导出备份。`, apply); else apply();
  }

  // ---------- 事件 ----------
  document.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; renderTabs(); } });
  $('script-list').addEventListener('click', e => { const b = e.target.closest('[data-id]'); if (b) selectScript(b.dataset.id); });
  $('new-script').addEventListener('click', () => { formId = null; fillForm(); tab = 'script'; renderTabs(); $('f-text').focus(); });
  $('name').addEventListener('change', saveName);
  $('save-words').addEventListener('click', saveWords);
  $('reset-words').addEventListener('click', resetWords);
  $('f-text').addEventListener('input', renderCheck);
  $('script-form').addEventListener('submit', saveScript);
  $('delete-script').addEventListener('click', deleteScript);
  $('start').addEventListener('click', startPractice);
  $('stop').addEventListener('click', stopPractice);
  $('loud-toggle').addEventListener('click', toggleLoud);
  $('trigger-form').addEventListener('submit', addTrigger);
  $('trigger-list').addEventListener('click', e => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    const tr = state.triggers.find(t => t.id === b.dataset.del);
    ask(`删除 ${tr ? tr.date + ' 的触发记录「' + (tr.situation || '未写情境') + '」' : '这条触发记录'}?确认前执行率不变;删除后无法恢复。`, () => {
      commit(Object.assign({}, state, { triggers: state.triggers.filter(t => t.id !== b.dataset.del) }), '已删除。');
      const nb = $('trigger-list').querySelector('[data-del]');
      (nb || $('t-situation')).focus();
    });
  });
  $('load-sample').addEventListener('click', loadSample);
  $('import-btn').addEventListener('click', () => $('import-file').click());
  $('import-btn-top').addEventListener('click', () => $('import-file').click());
  $('warn-export').addEventListener('click', () => download('半秒-备份.json', JSON.stringify(state, null, 2), 'application/json;charset=utf-8'));
  document.addEventListener('input', syncExport);
  document.addEventListener('change', syncExport);
  $('f-text').addEventListener('input', () => clearFieldErrors(['f-text']));
  $('heatmap').addEventListener('click', e => { const b = e.target.closest('.cell'); if (b) showHeat(b.dataset.date, true); });
  $('heatmap').addEventListener('keydown', onHeatKey);
  $('export-csv').addEventListener('click', () => download('半秒-练习记录.csv', '\ufeff' + C.toCsv(state), 'text/csv;charset=utf-8'));
  $('export-md').addEventListener('click', () => download('半秒-脚本卡.md', C.toMarkdown(state, todayStr()), 'text/markdown;charset=utf-8'));
  $('export-json').addEventListener('click', () => download('半秒-备份.json', JSON.stringify(state, null, 2), 'application/json;charset=utf-8'));
  /* 导入结果(拒绝原因、导入数量)写在「导出与数据」页的 #import-msg 里:选了文件后先切到该页,否则从顶部按钮导入时看不到任何反馈 */
  $('import-file').addEventListener('change', e => { const f = e.target.files[0]; if (f) { tab = 'export'; renderTabs(); importFile(f); } e.target.value = ''; });
  $('clear-all').addEventListener('click', () => ask(`清空会删除 ${scopeText()}(含名字与词表设置),无法恢复,建议先导出备份。`, () => {
    sel = null; formId = null; fillForm();
    commit(C.emptyState(), '已清空。');
  }));
  $('confirm-yes').addEventListener('click', () => { const f = pendingConfirm; closeConfirm(); if (f) f(); });
  $('confirm-no').addEventListener('click', closeConfirm);

  load();
  sel = state.scripts.length ? state.scripts[0].id : null;
  formId = sel;
  tab = sel ? 'practice' : 'script';
  fillForm();
  renderAll();
})();
