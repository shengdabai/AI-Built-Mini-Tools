/* 承诺跟进提取器 · DOM 与交互（只调用 CommitCore，所有用户文本经 textContent 渲染） */
(function () {
  'use strict';
  const C = globalThis.CommitCore;
  const KEY = 'cfx:state:v1';
  const $ = (id) => document.getElementById(id);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const el = {
    input: $('src-input'), view: $('src-view'), base: $('base-date'),
    run: $('btn-run'), sample: $('btn-sample'), clear: $('btn-clear'),
    vEdit: $('view-edit'), vMap: $('view-map'), sampleFlag: $('sample-flag'),
    stats: $('stats'), fOwner: $('f-owner'), fStatus: $('f-status'), fClarity: $('f-clarity'),
    empty: $('empty-state'), tableWrap: $('table-wrap'), tbody: $('tbody'), filterEmpty: $('filter-empty'),
    clarify: $('clarify'), qList: $('q-list'), copy: $('btn-copy'),
    exportBar: $('export'), csv: $('btn-csv'), md: $('btn-md'), ics: $('btn-ics'), icsNote: $('ics-note'),
    toast: $('toast'), storeAlert: $('store-alert'),
  };

  const blank = () => ({
    text: '', baseDate: C.localToday(), items: [], extractedText: '', extractBase: '',
    view: 'edit', isSample: false, filters: { owner: '', status: '', clarity: '' },
  });
  // 存储提示：load = 读取时发现坏数据；save = 最近一次写入失败。常驻显示，不自动消失。
  const alerts = { load: '', save: '' };
  let saveBlocked = false; // 坏数据没能备份时禁止写入，避免覆盖唯一的原始副本
  let state = load();
  let messages = [];
  let activeId = '';

  function setAlert(kind, msg) {
    alerts[kind] = msg;
    const lines = [alerts.load, alerts.save].filter(Boolean);
    el.storeAlert.textContent = '';
    for (const l of lines) el.storeAlert.append(node('p', 'store-alert-line', l));
    el.storeAlert.hidden = lines.length === 0;
  }

  /** 读取并深度校验本机数据；坏数据先把原文备份到 KEY.corrupt-<时间戳>，启动阶段绝不写回 KEY。 */
  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) {
      alerts.load = '无法读取本机存储（浏览器可能禁用了 localStorage），本次修改不会保存。';
      saveBlocked = true;
      return blank();
    }
    if (raw == null) return blank();
    let parsed;
    let issues = [];
    let result = null;
    try {
      parsed = JSON.parse(raw);
      result = C.normalizeState(parsed, blank());
      issues = result.issues;
    } catch (e) {
      issues = ['无法解析为 JSON'];
    }
    if (!issues.length) return result.state;
    const backupKey = KEY + '.corrupt-' + Date.now();
    try {
      localStorage.setItem(backupKey, raw);
      alerts.load = '本机保存的数据有损坏（' + issues.slice(0, 3).join('；') + (issues.length > 3 ? ' 等 ' + issues.length + ' 处' : '')
        + '），原始内容已备份到 localStorage 键「' + backupKey + '」。' + (result ? '已载入能读出的部分；' : '当前为空白状态；')
        + '你下次修改时才会覆盖正式数据。';
    } catch (e) {
      saveBlocked = true;
      alerts.load = '本机保存的数据有损坏，且备份失败（存储已满或被禁用）。为避免覆盖原始数据，本页的修改不会保存；'
        + '可先导出需要的内容，或点「清空数据」放弃旧数据后恢复保存。';
    }
    return result ? result.state : blank();
  }
  /** 写入本机；成功返回 true，失败时显示常驻「未保存」提示并返回 false */
  function save() {
    if (saveBlocked) {
      setAlert('save', '未保存：旧数据未能备份，已暂停写入本机存储。');
      return false;
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      if (alerts.save) setAlert('save', '');
      return true;
    } catch (e) {
      setAlert('save', '未保存：本机存储已满或被禁用，刚才的修改只在当前页面有效，关闭前请先导出备份。');
      return false;
    }
  }

  let toastTimer = 0;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2600);
  }

  function node(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ---------- 识别 ---------- */
  function runExtract(opts) {
    const text = el.input.value;
    if (!text.trim()) { toast('先在左侧粘贴群聊记录或会议纪要'); el.input.focus(); return; }
    if (!C.isValidISO(el.base.value)) { toast('基准日期格式不对，请重新选择'); el.base.focus(); return; }
    const res = C.extract(text, { baseDate: el.base.value });
    state.items = C.mergeEdits(res.items, state.items);
    state.text = text;
    state.extractedText = text;
    state.extractBase = el.base.value;
    state.baseDate = el.base.value;
    messages = res.messages;
    setView('map', { persist: false });
    const saved = save();
    render();
    if (saved && !(opts && opts.quiet)) {
      const unclear = state.items.filter(C.isUnclear).length;
      toast('识别出 ' + state.items.length + ' 条承诺，其中 ' + unclear + ' 条待澄清');
    }
    return saved;
  }

  function setView(v, opts) {
    state.view = v;
    const map = v === 'map' && !!state.extractedText;
    el.input.hidden = map;
    el.view.hidden = !map;
    el.vEdit.setAttribute('aria-pressed', String(!map));
    el.vMap.setAttribute('aria-pressed', String(map));
    if (!opts || opts.persist !== false) save();
  }

  /* ---------- 渲染 ---------- */
  function render() {
    const today = C.localToday();
    el.sampleFlag.hidden = !state.isSample;
    renderStats(today);
    renderOwnerFilter();
    renderTable(today);
    renderQuestions();
    renderSource();
    const has = state.items.length > 0;
    el.empty.hidden = has;
    el.tableWrap.hidden = !has;
    el.exportBar.hidden = !has;
    const dated = state.items.filter((it) => it.due && it.status !== 'cancelled').length;
    el.icsNote.textContent = '.ics 只收有明确日期的 ' + dated + ' 条（全天事件）';
    if (state.extractedText && !has) {
      el.empty.querySelector('.empty-title').textContent = '这段文字里没识别出承诺';
    } else {
      el.empty.querySelector('.empty-title').textContent = '还没有承诺';
    }
  }

  function renderStats(today) {
    el.stats.textContent = '';
    if (!state.items.length) return;
    const n = state.items.length;
    const unclear = state.items.filter((it) => it.status !== 'cancelled' && C.isUnclear(it)).length;
    const overdue = state.items.filter((it) => C.isOverdue(it, today)).length;
    const done = state.items.filter((it) => it.status === 'done').length;
    [['承诺', n, 'stat-commit'], ['待澄清', unclear, 'stat-unclear'], ['逾期', overdue, 'stat-overdue'], ['已完成', done, '']]
      .forEach(([label, num, cls]) => {
        const s = node('span', 'stat ' + cls);
        s.append(node('span', 'stat-num', String(num)), node('span', '', label));
        el.stats.append(s);
      });
  }

  function renderOwnerFilter() {
    const owners = Array.from(new Set(state.items.map((it) => it.owner).filter(Boolean))).sort();
    const cur = state.filters.owner;
    el.fOwner.textContent = '';
    const opts = [['', '全部']].concat(owners.map((o) => [o, o]));
    if (state.items.some((it) => !it.owner)) opts.push(['__none__', '（未定负责人）']);
    for (const [v, t] of opts) {
      const o = node('option', '', t);
      o.value = v;
      el.fOwner.append(o);
    }
    el.fOwner.value = opts.some(([v]) => v === cur) ? cur : '';
    state.filters.owner = el.fOwner.value;
    el.fStatus.value = state.filters.status;
    el.fClarity.value = state.filters.clarity;
  }

  function renderTable(today) {
    el.tbody.textContent = '';
    const rows = C.filterItems(state.items, state.filters);
    el.filterEmpty.hidden = rows.length > 0 || !state.items.length;
    for (const it of rows) el.tbody.append(buildRow(it, today));
  }

  function buildRow(it, today) {
    const unclear = C.isUnclear(it);
    const overdue = C.isOverdue(it, today);
    const tr = node('tr', 'crow');
    tr.dataset.id = it.id;
    if (overdue) tr.classList.add('is-overdue');
    if (it.status !== 'todo') tr.classList.add('is-closed');
    if (it.status === 'cancelled') tr.classList.add('is-cancelled');
    if (it.id === activeId) tr.classList.add('is-active');

    // 识别
    const tdMark = node('td', 'cell-mark');
    tdMark.append(node('span', 'tag ' + (unclear ? 'tag-unclear' : 'tag-commit'), unclear ? '？待澄清' : '承诺'));
    if (unclear) {
      tdMark.append(node('div', 'cell-sub flags', C.clarityFlags(it).map((f) => C.FLAG_LABEL[f]).join(' · ')));
    }
    const loc = node('button', 'link-btn', '第 ' + it.lineNo + ' 行');
    loc.type = 'button';
    loc.setAttribute('aria-label', '在原文中定位第 ' + it.lineNo + ' 行');
    loc.addEventListener('click', (e) => { e.stopPropagation(); locate(it.id); });
    const locWrap = node('div', 'cell-sub');
    locWrap.append(loc);
    tdMark.append(locWrap);

    // 负责人
    const tdOwner = node('td', 'cell-owner');
    tdOwner.dataset.label = '负责人';
    const owner = node('input', 'input');
    owner.value = it.owner || '';
    owner.placeholder = '未定';
    owner.setAttribute('aria-label', '负责人');
    owner.addEventListener('change', () => update(it.id, { owner: owner.value.trim() }));
    tdOwner.append(owner);

    // 事项
    const tdTask = node('td', 'cell-task');
    tdTask.dataset.label = '事项';
    const task = node('input', 'input');
    task.value = it.task || '';
    task.setAttribute('aria-label', '事项');
    task.addEventListener('change', () => update(it.id, { task: task.value.trim() || it.originalTask }));
    tdTask.append(task, node('div', 'cell-sub', '原话：' + it.sentence));

    // 期限
    const tdDue = node('td', 'cell-due');
    tdDue.dataset.label = '期限';
    const due = node('input', 'input');
    due.type = 'date';
    due.value = it.due || '';
    due.setAttribute('aria-label', '期限');
    due.addEventListener('change', () => update(it.id, { due: C.isValidISO(due.value) ? due.value : '' }));
    tdDue.append(due);
    const sub = node('div', 'cell-sub');
    if (overdue) sub.append(node('span', 'tag tag-overdue', '逾期'), document.createTextNode(' '));
    if (it.dueText) sub.append(document.createTextNode('原话「' + it.dueText + '」'));
    else if (it.vagueTimeWord && !it.due) sub.append(document.createTextNode('原话「' + it.vagueTimeWord + '」无期限'));
    else if (it.vagueTimeWord) sub.append(document.createTextNode('原话「' + it.vagueTimeWord + '」，期限为手动补填'));
    else if (!it.due) sub.append(document.createTextNode('原话没提期限'));
    if (sub.childNodes.length) tdDue.append(sub);

    // 状态
    const tdStatus = node('td', 'cell-status');
    tdStatus.dataset.label = '状态';
    const sel = node('select', 'input');
    sel.setAttribute('aria-label', '状态');
    for (const [v, t] of Object.entries(C.STATUS_LABEL)) {
      const o = node('option', '', t);
      o.value = v;
      sel.append(o);
    }
    sel.value = it.status;
    sel.addEventListener('change', () => update(it.id, { status: sel.value }));
    tdStatus.append(sel);

    tr.append(tdMark, tdOwner, tdTask, tdDue, tdStatus);
    tr.addEventListener('click', (e) => {
      if (e.target.closest('input, select, button')) return;
      locate(it.id);
    });
    return tr;
  }

  /** 只把本次改动的字段标成人工编辑：改状态不会冻结期限，基准日期变化后期限仍会重算 */
  function update(id, patch) {
    state.items = state.items.map((it) => {
      if (it.id !== id) return it;
      const dirty = C.dirtyOf(it);
      for (const f of Object.keys(patch)) dirty[f] = true;
      const next = Object.assign({}, it, patch, { dirty });
      delete next.edited;
      return next;
    });
    save();
    render();
  }

  function openQuestions() {
    return state.items
      .filter((it) => it.status === 'todo')
      .map((it) => ({ it, qs: C.buildQuestions(it) }))
      .filter((x) => x.qs.length);
  }

  function renderQuestions() {
    el.qList.textContent = '';
    const groups = openQuestions();
    el.clarify.hidden = groups.length === 0;
    for (const { it, qs } of groups) {
      for (const q of qs) {
        const li = node('li', '', q);
        li.append(node('span', 'q-src', '（第 ' + it.lineNo + ' 行' + (it.speaker ? ' · ' + it.speaker + ' 说' : '') + '）'));
        el.qList.append(li);
      }
    }
  }

  function renderSource() {
    el.view.textContent = '';
    if (!state.extractedText) return;
    if (!messages.length) messages = C.extract(state.extractedText, { baseDate: state.extractBase || state.baseDate }).messages;
    const byId = new Map(state.items.map((it) => [it.id, it]));
    for (const m of messages) {
      const row = node('div', 'msg');
      row.append(node('span', 'msg-ln', String(m.lineNo)));
      const main = node('div', 'msg-main');
      if (m.speaker) main.append(node('span', 'msg-who', m.speaker));
      if (m.time) main.append(node('span', 'msg-time', m.time));
      let pos = 0;
      const body = m.body;
      const hasItem = (m.sentences || []).some((s) => s.itemId && byId.has(s.itemId));
      for (const s of m.sentences || []) {
        const it = s.itemId && byId.get(s.itemId);
        if (!it) continue;
        if (s.start > pos) main.append(document.createTextNode(body.slice(pos, s.start)));
        const unclear = C.isUnclear(it);
        const mark = node('mark', 'hl ' + (unclear ? 'hl-unclear' : 'hl-commit'));
        mark.id = 'hl-' + it.id;
        mark.tabIndex = -1;
        mark.append(node('span', 'hl-tag', unclear ? '？待澄清' : '承诺'), document.createTextNode(body.slice(s.start, s.end)));
        main.append(mark);
        pos = s.end;
      }
      if (pos < body.length) {
        const rest = node('span', hasItem ? '' : 'msg-plain', body.slice(pos));
        main.append(rest);
      }
      row.append(main);
      el.view.append(row);
    }
  }

  function locate(id) {
    activeId = id;
    if (state.view !== 'map') setView('map');
    render();
    const target = document.getElementById('hl-' + id);
    if (!target) return;
    target.classList.remove('is-target');
    void target.offsetWidth; // 重新触发闪烁动画
    target.classList.add('is-target');
    target.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
    target.focus({ preventScroll: true });
  }

  /* ---------- 导出与复制 ---------- */
  function download(name, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = node('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const stamp = () => C.localToday();

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    }
    return Promise.resolve(fallbackCopy(text));
  }
  function fallbackCopy(text) {
    const ta = node('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.className = 'sr-only';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    if (!ok) throw new Error('copy failed');
  }

  /* ---------- 事件 ---------- */
  el.run.addEventListener('click', () => runExtract());
  el.vEdit.addEventListener('click', () => { setView('edit'); el.input.focus(); });
  el.vMap.addEventListener('click', () => {
    if (!state.extractedText) { toast('先点「识别承诺」，才有原文对照'); return; }
    if (el.input.value !== state.extractedText) { runExtract({ quiet: true }); return; }
    setView('map');
    render();
  });
  let typingTimer = 0;
  el.input.addEventListener('input', () => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => { state.text = el.input.value; state.isSample = false; save(); render(); }, 300);
  });
  el.base.addEventListener('change', () => {
    if (!C.isValidISO(el.base.value)) return;
    state.baseDate = el.base.value;
    if (state.extractedText && el.input.value.trim()) {
      if (runExtract({ quiet: true })) toast('已按新的基准日期重新换算期限（手动改过的期限保持不变）');
    } else {
      save();
    }
  });
  el.sample.addEventListener('click', () => {
    const S = globalThis.CommitSample;
    const hasWork = el.input.value.trim() || state.text.trim() || state.extractedText.trim() || state.items.length;
    if (hasWork && !window.confirm('载入示例会替换当前原文，已识别和编辑的清单也会被示例覆盖。继续吗？')) return;
    el.input.value = S.text;
    el.base.value = C.addDays(C.localToday(), S.baseOffsetDays || 0);
    state.items = [];
    state.isSample = true;
    runExtract();
  });
  el.clear.addEventListener('click', () => {
    if (!window.confirm('清空原文、承诺清单和本机保存的数据？此操作不能撤销。')) return;
    let removed = true;
    try { localStorage.removeItem(KEY); } catch (e) { removed = false; }
    saveBlocked = false; // 用户已确认放弃旧数据，恢复保存
    setAlert('load', '');
    state = blank();
    messages = [];
    activeId = '';
    el.input.value = '';
    el.base.value = state.baseDate;
    setView('edit', { persist: false });
    render();
    if (removed && save()) toast('已清空');
  });
  el.fOwner.addEventListener('change', () => { state.filters.owner = el.fOwner.value; save(); render(); });  el.fStatus.addEventListener('change', () => { state.filters.status = el.fStatus.value; save(); render(); });
  el.fClarity.addEventListener('change', () => { state.filters.clarity = el.fClarity.value; save(); render(); });
  el.copy.addEventListener('click', () => {
    const lines = openQuestions().flatMap((g) => g.qs);
    const text = lines.map((q, i) => (i + 1) + '. ' + q).join('\n');
    copyText(text).then(() => toast('已复制 ' + lines.length + ' 个追问问题')).catch(() => toast('浏览器不允许复制，请手动选择文字'));
  });
  el.csv.addEventListener('click', () => {
    download('承诺清单-' + stamp() + '.csv', C.toCSV(state.items, C.localToday()), 'text/csv;charset=utf-8');
  });
  el.md.addEventListener('click', () => {
    download('跟进纪要-' + stamp() + '.md', C.toMarkdown(state.items, { baseDate: state.extractBase, today: C.localToday() }), 'text/markdown;charset=utf-8');
  });
  el.ics.addEventListener('click', () => {
    const n = state.items.filter((it) => it.due && it.status !== 'cancelled').length;
    if (!n) { toast('没有带明确日期的承诺，先在清单里补上期限'); return; }
    download('承诺日历-' + stamp() + '.ics', C.toICS(state.items, { now: new Date() }), 'text/calendar;charset=utf-8');
    toast('已导出 ' + n + ' 个全天日历事件');
  });

  /* ---------- 启动 ---------- */
  el.input.value = state.text || '';
  el.base.value = state.baseDate;
  setView(state.view, { persist: false }); // 启动阶段不写存储
  render();
  setAlert('load', alerts.load);
})();
