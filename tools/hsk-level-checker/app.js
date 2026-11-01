'use strict';
// DOM 与交互。逻辑全部来自 core.js;所有用户文本只用 textContent 渲染。
(function () {
  const core = globalThis.HskCore;
  const DICT = globalThis.HSK_WORDS;
  const CHARS = globalThis.PINYIN_MAP;
  const STORE_KEY = 'hskcheck.v1';
  const $ = (id) => document.getElementById(id);

  const state = { before: null, after: null, view: 'before', focusWord: null, lastCheckedSrc: '', checkedRew: '' };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // ---------- 存取 ----------
  // 返回是否写入成功;失败时显示持续可见的「未保存」提示(save-warning),成功时收起。
  function save() {
    let ok = true;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ src: $('src').value, rew: $('rew').value, target: $('target').value }));
    } catch (e) { ok = false; }
    $('save-warning').hidden = ok;
    return ok;
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      return o && typeof o === 'object' ? o : null;
    } catch (e) { return null; }
  }
  function wipe() {
    try { localStorage.removeItem(STORE_KEY); return true; } catch (e) { return false; }
  }

  function realToday() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  const TODAY = core.parseToday(location.search, realToday());
  function todayStr() { return TODAY.date; }

  // 当前原文是否就是合成示例(按文本比较,刷新后仍然成立;改动原文或清空后消失)。
  function isSampleNow() { return $('src').value === globalThis.HskSample.text; }
  function renderSampleBadge() { $('sample-badge').hidden = !isSampleNow(); }

  // 有任何用户数据(原文、改写文、非默认级别)时,载入示例前要确认。
  function hasUserData() {
    return !!($('src').value.trim() || $('rew').value.trim() || $('target').value !== '3') && !(isSampleNow() && $('rew').value === $('src').value && $('target').value === '3');
  }
  function invalid(id, on) { $(id).setAttribute('aria-invalid', on ? 'true' : 'false'); }

  function target() { return core.normalizeTarget($('target').value); }
  function setStatus(id, msg, isError) {
    const n = $(id);
    n.textContent = msg || '';
    n.classList.toggle('is-error', !!isError);
  }

  // ---------- 检查 ----------
  function runCheck() {
    const text = $('src').value;
    if (!text.trim()) {
      setStatus('src-status', '请先贴入要检查的中文材料。', true);
      invalid('src', true);
      $('src').focus();
      return;
    }
    invalid('src', false);
    state.before = core.analyze(text, target(), DICT, CHARS);
    state.after = null;
    state.view = 'before';
    state.focusWord = null;
    const rew = $('rew');
    if (!rew.value.trim() || rew.value === state.lastCheckedSrc) rew.value = text;
    state.lastCheckedSrc = text;
    // 本次只检查原文。保留的改写草稿若与原文不同,必须重新检查后才能导出。
    state.checkedRew = text;
    setStatus('src-status', '已检查:' + state.before.stats.overCount + ' 个超纲词。');
    setStatus('rew-status', '');
    $('btn-recheck').disabled = false;
    save();
    render();
  }

  function runRecheck() {
    const text = $('rew').value;
    if (!state.before) { setStatus('rew-status', '请先在左上点「检查」。', true); return; }
    if (!text.trim()) {
      setStatus('rew-status', '改写区是空的,请先写入改写后的文本。', true);
      invalid('rew', true);
      $('rew').focus();
      return;
    }
    invalid('rew', false);
    state.after = core.analyze(text, target(), DICT, CHARS);
    state.checkedRew = text;
    state.view = 'after';
    state.focusWord = null;
    setStatus('rew-status', '已重新检查:' + state.after.stats.overCount + ' 个超纲词。');
    save();
    render();
  }

  // ---------- 渲染 ----------
  function current() { return state.view === 'after' && state.after ? state.after : state.before; }

  function render() {
    renderSampleBadge();
    const has = !!state.before;
    $('empty').hidden = has;
    $('result').hidden = !has;
    if (!has) return;
    const res = current();
    $('view-after').disabled = !state.after;
    $('view-before').setAttribute('aria-pressed', String(state.view === 'before'));
    $('view-after').setAttribute('aria-pressed', String(state.view === 'after'));
    renderColored(res);
    renderCompare();
    renderStats(res);
    renderOver(res);
    renderOut(res);
    renderExportState();
  }

  function renderColored(res) {
    const box = $('colored');
    box.textContent = '';
    const frag = document.createDocumentFragment();
    for (const t of res.tokens) {
      if (t.tier === 'other') { frag.appendChild(document.createTextNode(t.t)); continue; }
      if (t.tier === 'in') { frag.appendChild(document.createTextNode(t.t)); continue; }
      const s = el('span', 'tk tk-' + t.tier, t.t);
      if (t.tier === 'out') {
        s.title = '词表外汉字' + (t.pinyin ? ' · ' + t.pinyin : '');
      } else {
        s.dataset.word = t.t;
        s.title = core.levelLabel(t.level) + (t.pinyin ? ' · ' + t.pinyin : '');
      }
      frag.appendChild(s);
    }
    box.appendChild(frag);
    applyFocus(false);
  }

  function statEntry(dt, dd) {
    const w = el('div', 'stat');
    w.appendChild(el('dt', null, dt));
    w.appendChild(el('dd', null, dd));
    return w;
  }

  function renderStats(res) {
    const s = res.stats;
    $('stats-which').textContent = state.view === 'after' ? '改写后 · ' + core.levelLabel(s.target) : '原文 · ' + core.levelLabel(s.target);
    const box = $('stats');
    box.textContent = '';
    box.appendChild(statEntry('汉字数', String(s.charCount)));
    box.appendChild(statEntry('词数', String(s.wordCount)));
    box.appendChild(statEntry('目标级内词占比', core.pct(s.inLevelRatio)));
    box.appendChild(statEntry('超纲词数', String(s.overCount)));
    box.appendChild(statEntry('词表外词数', String(s.outOfListCount)));
    box.appendChild(statEntry('句数', String(s.sentenceCount)));
    box.appendChild(statEntry('平均句长(字)', String(s.avgSentenceLen)));
  }

  function deltaBadge(text, kind) {
    return el('span', 'compare-delta is-' + kind, text);
  }

  function renderCompare() {
    const wrap = $('compare');
    if (!state.after) { wrap.hidden = true; return; }
    wrap.hidden = false;
    const c = core.compare(state.before, state.after);
    const grid = $('compare-grid');
    grid.textContent = '';

    const c1 = el('div', 'compare-cell');
    c1.appendChild(el('p', 'compare-name', '超纲词数'));
    c1.appendChild(el('p', 'compare-values', c.overBefore + ' → ' + c.overAfter));
    const d1 = c.overDelta;
    c1.appendChild(
      d1 < 0 ? deltaBadge('减少 ' + -d1 + ' 个', 'good') : d1 > 0 ? deltaBadge('增加 ' + d1 + ' 个', 'bad') : deltaBadge('没有变化', 'flat')
    );

    const c2 = el('div', 'compare-cell');
    c2.appendChild(el('p', 'compare-name', '目标级内词占比'));
    c2.appendChild(el('p', 'compare-values', core.pct(c.ratioBefore) + ' → ' + core.pct(c.ratioAfter)));
    const pts = Math.round(Math.abs(c.ratioDelta) * 1000) / 10;
    c2.appendChild(
      c.ratioDelta > 0 && pts > 0 ? deltaBadge('提高 ' + pts + ' 个百分点', 'good')
        : c.ratioDelta < 0 && pts > 0 ? deltaBadge('降低 ' + pts + ' 个百分点', 'bad')
        : deltaBadge('没有变化', 'flat')
    );
    grid.appendChild(c1);
    grid.appendChild(c2);
  }

  function renderOver(res) {
    const body = $('over-body');
    body.textContent = '';
    $('over-wrap').hidden = res.overLevel.length === 0;
    $('over-empty').hidden = res.overLevel.length !== 0;
    for (const r of res.overLevel) {
      const tr = document.createElement('tr');
      const td0 = document.createElement('td');
      const b = el('button', 'word-btn', r.word);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(state.focusWord === r.word));
      b.addEventListener('click', () => focusWord(r.word));
      td0.appendChild(b);
      tr.appendChild(td0);
      tr.appendChild(el('td', null, core.levelLabel(r.level)));
      tr.appendChild(el('td', null, r.pinyin || '—'));
      tr.appendChild(el('td', null, String(r.count)));
      body.appendChild(tr);
    }
  }

  function renderOut(res) {
    const ul = $('out-list');
    ul.textContent = '';
    $('out-empty').hidden = res.outOfList.length !== 0;
    for (const r of res.outOfList) {
      const li = el('li', 'chip', r.text);
      li.appendChild(el('span', 'chip-note', (r.pinyin ? ' ' + r.pinyin : '') + ' ×' + r.count));
      ul.appendChild(li);
    }
  }

  function applyFocus(scroll) {
    const spans = $('colored').querySelectorAll('.tk');
    let first = null;
    for (const s of spans) {
      const on = !!state.focusWord && s.dataset.word === state.focusWord;
      s.classList.toggle('is-focus', on);
      if (on && !first) first = s;
    }
    if (scroll && first) {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      first.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    }
  }

  function focusWord(w) {
    state.focusWord = state.focusWord === w ? null : w;
    for (const b of $('over-body').querySelectorAll('.word-btn')) {
      b.setAttribute('aria-pressed', String(b.textContent === state.focusWord));
    }
    applyFocus(true);
  }

  // ---------- 导出 ----------
  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function showPreview(label, text) {
    $('export-preview').hidden = false;
    $('export-label').textContent = label;
    $('export-text').value = text;
  }

  // 结果与当前文本不一致时拒绝导出,避免旧统计拼上新全文。
  function isStaleNow() {
    if (!state.before) return true;
    return core.isStale({
      srcNow: $('src').value, srcChecked: state.lastCheckedSrc,
      rewNow: $('rew').value, rewChecked: state.checkedRew, hasAfter: !!state.after,
    });
  }
  const STALE_MSG = '文本已修改但结果还没更新,请先点「检查」或「重新检查」再导出。';
  // 过期时两个导出按钮置为禁用(aria-disabled,点击只给提示),并持续显示原因。
  function renderExportState() {
    const stale = isStaleNow();
    for (const id of ['btn-md', 'btn-csv']) $(id).setAttribute('aria-disabled', String(stale));
    if (stale) setStatus('export-status', STALE_MSG, true);
    else if ($('export-status').textContent === STALE_MSG) setStatus('export-status', '');
  }
  function exportBlocked() {
    renderExportState();
    return isStaleNow();
  }

  function exportMarkdown() {
    if (exportBlocked()) return;
    const md = core.toMarkdown({
      target: target(),
      before: state.before,
      after: state.after,
      rewriteText: state.after ? state.checkedRew : $('rew').value,
      date: todayStr(),
      sample: isSampleNow(),
    });
    download('hsk-检查报告-' + (isSampleNow() ? '合成示例-' : '') + todayStr() + '.md', md, 'text/markdown;charset=utf-8');
    showPreview('检查报告 Markdown(已下载,也可在这里复制)', md);
    setStatus('export-status', state.after ? '已导出两版统计的 Markdown 报告。' : '已导出 Markdown 报告(尚未改写,只含原文统计)。');
  }

  function exportCsv() {
    if (exportBlocked()) return;
    const res = current();
    if (!res) return;
    const csv = core.toCsv(res.overLevel, { sample: isSampleNow() });
    download('hsk-超纲词-' + (isSampleNow() ? '合成示例-' : '') + todayStr() + '.csv', '\ufeff' + csv, 'text/csv;charset=utf-8');
    showPreview('超纲词清单 CSV(已下载,也可在这里复制)', csv);
    setStatus('export-status', '已导出 ' + res.overLevel.length + ' 个超纲词。');
  }

  // ---------- 清空 ----------
  function clearAll() {
    if (!wipe()) {
      setStatus('src-status', '清空失败:浏览器未能删除本机存档。当前内容和检查结果已保留,请稍后重试。', true);
      $('btn-clear-no').focus();
      return;
    }
    $('src').value = '';
    $('rew').value = '';
    $('target').value = '3';
    $('export-text').value = '';
    $('export-preview').hidden = true;
    state.before = null;
    state.after = null;
    state.view = 'before';
    state.focusWord = null;
    state.lastCheckedSrc = '';
    state.checkedRew = '';
    $('save-warning').hidden = true;
    $('btn-recheck').disabled = true;
    setStatus('src-status', '数据已清空。');
    setStatus('rew-status', '');
    setStatus('export-status', '');
    $('clear-confirm').hidden = true;
    $('sample-confirm').hidden = true;
    invalid('src', false);
    invalid('rew', false);
    render();
  }

  function askSample() {
    if (!hasUserData()) { loadSample(); return; }
    $('sample-confirm-text').textContent = '载入合成示例会替换现有的原文(' + $('src').value.length + ' 字符)、改写文(' + $('rew').value.length + ' 字符)和目标级别(现为 ' + core.levelLabel(target()) + '),未导出的内容会丢失。确定替换吗?';
    $('sample-confirm').hidden = false;
    $('btn-sample-no').focus();
  }

  function loadSample() {
    $('sample-confirm').hidden = true;
    const s = globalThis.HskSample;
    $('src').value = s.text;
    $('rew').value = s.text;
    $('target').value = String(s.target);
    state.lastCheckedSrc = s.text;
    invalid('src', false);
    invalid('rew', false);
    runCheck();
    setStatus('src-status', '已载入' + s.label + ',并完成检查:' + state.before.stats.overCount + ' 个超纲词。');
  }

  // ---------- 事件 ----------
  $('btn-check').addEventListener('click', runCheck);
  $('btn-recheck').addEventListener('click', runRecheck);
  $('btn-sample').addEventListener('click', askSample);
  $('btn-sample-yes').addEventListener('click', loadSample);
  $('btn-sample-no').addEventListener('click', () => { $('sample-confirm').hidden = true; $('btn-sample').focus(); });
  $('btn-clear').addEventListener('click', () => { $('clear-confirm').hidden = false; $('btn-clear-no').focus(); });
  $('btn-clear-no').addEventListener('click', () => { $('clear-confirm').hidden = true; $('btn-clear').focus(); });
  $('btn-clear-yes').addEventListener('click', clearAll);
  $('btn-md').addEventListener('click', exportMarkdown);
  $('btn-csv').addEventListener('click', exportCsv);
  $('view-before').addEventListener('click', () => { state.view = 'before'; state.focusWord = null; render(); });
  $('view-after').addEventListener('click', () => { if (state.after) { state.view = 'after'; state.focusWord = null; render(); } });
  $('src').addEventListener('input', () => {
    invalid('src', false);
    if (state.before) setStatus('src-status', '原文已修改,点「检查」更新结果。');
    renderSampleBadge();
    renderExportState();
    save();
  });
  $('rew').addEventListener('input', () => {
    invalid('rew', false);
    if (state.before) setStatus('rew-status', '改写文已修改,点「重新检查」更新结果。');
    renderExportState();
    save();
  });
  $('target').addEventListener('change', () => {
    save();
    if (state.before) {
      state.before = core.analyze(state.lastCheckedSrc, target(), DICT, CHARS);
      if (state.after) state.after = core.analyze(state.checkedRew, target(), DICT, CHARS);
      render();
      setStatus('src-status', '目标级别已改为 ' + core.levelLabel(target()) + ',结果已更新。');
    }
  });

  // ---------- 启动:恢复上次内容 ----------
  const saved = load();
  if (saved) {
    $('src').value = typeof saved.src === 'string' ? saved.src : '';
    $('rew').value = typeof saved.rew === 'string' ? saved.rew : '';
    if (core.LEVELS.includes(Number(saved.target))) $('target').value = String(saved.target);
    if ($('src').value.trim()) {
      state.lastCheckedSrc = $('src').value;
      state.checkedRew = $('rew').value;
      state.before = core.analyze($('src').value, target(), DICT, CHARS);
      $('btn-recheck').disabled = false;
      if ($('rew').value.trim() && $('rew').value !== $('src').value) {
        state.after = core.analyze($('rew').value, target(), DICT, CHARS);
        state.checkedRew = $('rew').value;
        state.view = 'after';
      }
      setStatus('src-status', '已恢复上次保存的内容。');
    }
  }
  if (TODAY.fixed) {
    $('today-note').hidden = false;
    $('today-note').textContent = '基准日 ' + TODAY.date + '(由地址参数固定)';
  }
  render();
})();
