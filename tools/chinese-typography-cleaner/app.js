'use strict';
(function () {
  var Core = globalThis.ZhCleanCore;
  var SAMPLE = globalThis.ZH_SAMPLE;
  var STORAGE_KEY = 'zhclean.v1';
  var MAX_DIFF_ROWS = 300;

  var $ = function (id) { return document.getElementById(id); };
  var state = Core.defaultState();
  var last = { result: '', changes: [], diff: [] };
  var saveTimer = null;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ---------- 存储 ---------- */

  // 返回布尔:只有真正写入成功才返回 true
  function save(candidate) {
    var ser = Core.serializeState(candidate || state);
    if (!ser.ok) { showSaveWarning(true); return false; }
    try {
      localStorage.setItem(STORAGE_KEY, ser.json);
    } catch (e) {
      showSaveWarning(true);
      return false;
    }
    showSaveWarning(false);
    return true;
  }
  function showSaveWarning(on) { $('save-warning').hidden = !on; }
  // 每次保存尝试都更新同一个状态位置:成功显示已保存,失败显示当前改动未保存
  function persist() {
    var saved = save();
    if (saved) setStatus('已保存到本机浏览器。', false);
    else setStatus('当前改动未保存:浏览器拒绝写入本机存储。请先复制或导出清洁结果,原文请自行另存。', true);
    return saved;
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 300);
  }
  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { raw = null; }
    if (raw == null) return;
    var parsed = Core.parseState(raw);
    if (parsed.ok) { state = parsed.state; state.keepHardBreak = state.keepHardBreak === true; return; }
    var box = $('load-warning');
    box.textContent = '本机保存的数据不合法(' + parsed.error + '),已忽略并从空白开始;旧数据保留在浏览器里,直到你下一次编辑时被覆盖。';
    box.hidden = false;
  }

  /* ---------- 状态提示 ---------- */

  function setStatus(msg, isError) {
    var s = $('status');
    s.textContent = msg;
    s.className = isError ? 'status status--error' : 'status';
  }

  /* ---------- 规则面板 ---------- */

  function buildRules() {
    var list = $('rule-list');
    list.textContent = '';
    Core.RULES.forEach(function (rule) {
      var li = el('li', 'rule');
      li.dataset.rule = rule.id;
      var head = el('div', 'rule__head');
      var label = el('label', 'rule__label');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = 'rule-' + rule.id;
      cb.checked = !!state.rules[rule.id];
      cb.addEventListener('change', function () {
        state.rules[rule.id] = cb.checked;
        render(); saveNow();
      });
      label.appendChild(cb);
      label.appendChild(el('span', null, rule.name));
      head.appendChild(label);
      var count = el('span', 'rule__count', '0 处');
      count.id = 'count-' + rule.id;
      head.appendChild(count);
      li.appendChild(head);
      li.appendChild(el('p', 'rule__desc', rule.desc));
      var ex = el('p', 'rule__example');
      ex.appendChild(el('span', null, rule.before));
      ex.appendChild(el('span', 'rule__arrow', '→'));
      ex.appendChild(el('span', null, rule.after));
      li.appendChild(ex);
      if (rule.id === 'whitespace') {
        var wopts = el('div', 'rule__options');
        var wl = el('label');
        var kb = document.createElement('input');
        kb.type = 'checkbox'; kb.id = 'opt-keepbreak';
        kb.checked = state.keepHardBreak === true;
        kb.addEventListener('change', function () { state.keepHardBreak = kb.checked; render(); saveNow(); });
        wl.appendChild(kb);
        wl.appendChild(el('span', null, '保留 Markdown 强制换行(行尾两个空格)'));
        wopts.appendChild(wl);
        li.appendChild(wopts);
      }
      if (rule.id === 'quotes') {
        var opts = el('div', 'rule__options');
        opts.setAttribute('role', 'radiogroup');
        opts.setAttribute('aria-label', '引号风格');
        [['corner', '「…」 直角引号'], ['curly', '“…” 弯引号']].forEach(function (o) {
          var l = el('label');
          var r = document.createElement('input');
          r.type = 'radio'; r.name = 'quote-style'; r.value = o[0]; r.id = 'quote-' + o[0];
          r.checked = state.quoteStyle === o[0];
          r.addEventListener('change', function () {
            if (r.checked) { state.quoteStyle = o[0]; render(); saveNow(); }
          });
          l.appendChild(r);
          l.appendChild(el('span', null, o[1]));
          opts.appendChild(l);
        });
        li.appendChild(opts);
      }
      list.appendChild(li);
    });
  }

  function syncControls() {
    Core.RULES.forEach(function (rule) { $('rule-' + rule.id).checked = !!state.rules[rule.id]; });
    ['corner', 'curly'].forEach(function (v) {
      var r = $('quote-' + v);
      r.checked = state.quoteStyle === v;
      r.disabled = !state.rules.quotes;
    });
    $('opt-keepbreak').checked = state.keepHardBreak === true;
    $('opt-keepbreak').disabled = !state.rules.whitespace;
    if ($('input').value !== state.text) $('input').value = state.text;
    renderWords();
  }

  /* ---------- 保护词 ---------- */

  function renderWords() {
    var ul = $('word-list');
    ul.textContent = '';
    state.protectedWords.forEach(function (w) {
      var li = el('li', 'word-item');
      li.appendChild(el('span', null, w));
      var b = el('button', null, '移除');
      b.type = 'button';
      b.setAttribute('aria-label', '移除保护词 ' + w);
      b.addEventListener('click', function () {
        state.protectedWords = state.protectedWords.filter(function (x) { return x !== w; });
        renderWords(); render(); saveNow();
      });
      li.appendChild(b);
      ul.appendChild(li);
    });
  }
  function wordMsg(msg) {
    var m = $('word-msg');
    m.textContent = msg || '';
    m.hidden = !msg;
  }
  function addWord(e) {
    e.preventDefault();
    var v = $('word-input').value.trim();
    if (!v) { wordMsg('请先输入一个保护词。'); return; }
    if (state.protectedWords.indexOf(v) >= 0) { wordMsg('「' + v + '」已经在保护词里了。'); return; }
    state.protectedWords.push(v);
    $('word-input').value = '';
    wordMsg('');
    renderWords(); render(); saveNow();
  }

  /* ---------- 渲染 ---------- */

  function ruleName(id) {
    for (var i = 0; i < Core.RULES.length; i++) if (Core.RULES[i].id === id) return Core.RULES[i].name;
    return id;
  }

  function appendRuns(parent, ops, drop) {
    ops.forEach(function (op) {
      if (op.type === drop) return;
      if (op.type === 'eq') parent.appendChild(document.createTextNode(op.text));
      else parent.appendChild(el(op.type === 'del' ? 'del' : 'ins', op.type === 'del' ? 'chg-del' : 'chg-ins', op.text));
    });
  }

  function renderDiff() {
    var list = $('diff-list');
    list.textContent = '';
    var rows = last.diff;
    var empty = $('diff-empty');
    var note = $('diff-note');
    note.hidden = true;
    if (!rows.length) {
      empty.textContent = state.text === '' ? '有内容后,这里会列出每一处改动。' : '没有需要改动的地方。';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    rows.slice(0, MAX_DIFF_ROWS).forEach(function (d) {
      var li = el('li', 'diff-row');
      li.appendChild(el('span', 'diff-no', '第 ' + d.line + ' 行'));
      var left = el('div', 'diff-cell');
      left.appendChild(el('span', 'diff-label', '原'));
      var lt = el('span', 'diff-text');
      var right = el('div', 'diff-cell');
      right.appendChild(el('span', 'diff-label', '新'));
      var rt = el('span', 'diff-text');
      if (d.added) {
        lt.className += ' diff-text--empty'; lt.textContent = '(原文没有这一行)';
        rt.appendChild(el('ins', 'chg-ins', d.after));
      } else if (d.removed) {
        lt.appendChild(el('del', 'chg-del', d.before === '' ? '(空行)' : d.before));
        rt.className += ' diff-text--empty'; rt.textContent = '(已删除)';
      } else {
        var ops = Core.diffLine(d.before, d.after);
        appendRuns(lt, ops, 'ins');
        appendRuns(rt, ops, 'del');
      }
      left.appendChild(lt); right.appendChild(rt);
      li.appendChild(left); li.appendChild(right);
      list.appendChild(li);
    });
    if (rows.length > MAX_DIFF_ROWS) {
      note.textContent = '共 ' + rows.length + ' 行有改动,这里只显示前 ' + MAX_DIFF_ROWS + ' 行;完整结果在上方「清洁结果」里。';
      note.hidden = false;
    }
  }

  function render() {
    last = Core.clean(state.text, state);
    $('output').value = last.result;
    $('input-count').textContent = state.text.length + ' 字符';
    var has = state.text.trim() !== '';
    $('empty-guide').hidden = has;
    $('btn-copy').disabled = last.result === '';
    $('btn-export').disabled = last.result === '';
    $('sample-tag').hidden = !(SAMPLE && state.text === SAMPLE.text);
    var byRule = Object.create(null);
    var total = 0;
    last.changes.forEach(function (c) { byRule[c.rule] = c.count; total += c.count; });
    Core.RULES.forEach(function (rule) {
      var n = byRule[rule.id] || 0;
      $('count-' + rule.id).textContent = n + ' 处';
    });
    $('opt-keepbreak').disabled = !state.rules.whitespace;
    $('quote-corner').disabled = !state.rules.quotes;
    $('quote-curly').disabled = !state.rules.quotes;
    var sum = $('summary');
    sum.textContent = '';
    if (!total) {
      sum.textContent = has ? '没有需要改动的地方。' : '暂无改动。';
    } else {
      sum.appendChild(el('span', 'summary__total', '共 ' + total + ' 处'));
      last.changes.forEach(function (c) { sum.appendChild(el('span', 'summary__item', ruleName(c.rule) + ' ' + c.count)); });
    }
    renderDiff();
  }

  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    return persist();
  }

  /* ---------- 复制与导出 ---------- */

  function copyResult() {
    var text = last.result;
    if (!text) return;
    var fallback = function () {
      var out = $('output');
      out.focus(); out.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      setStatus(ok ? '已复制结果。' : '复制失败:浏览器不允许自动复制,请在结果框里全选后手动复制。', !ok);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { setStatus('已复制结果。', false); }, fallback);
    } else fallback();
  }

  function exportMarkdown() {
    if (!last.result) return;
    var blob = new Blob([last.result], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = '清洁结果.md';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    setStatus('已导出 清洁结果.md(文件由浏览器保存到下载位置)。', false);
  }

  /* ---------- 示例与清空 ---------- */

  function sameAsSample() {
    return state.text === SAMPLE.text && state.protectedWords.join('\n') === SAMPLE.protectedWords.join('\n');
  }
  function settingsChanged() {
    var d = Core.defaultState();
    if (state.quoteStyle !== d.quoteStyle || state.keepHardBreak === true) return true;
    return Core.RULE_IDS.some(function (id) { return state.rules[id] !== d.rules[id]; });
  }
  function applySample() {
    var d = Core.defaultState();
    state.text = SAMPLE.text;
    state.protectedWords = SAMPLE.protectedWords.slice();
    state.rules = d.rules; state.quoteStyle = d.quoteStyle; state.keepHardBreak = false;
    syncControls(); render();
    if (saveNow()) setStatus('已载入合成示例。', false);
  }
  function askSample() {
    $('confirm-clear').hidden = true;
    var hasData = state.text !== '' || state.protectedWords.length > 0 || settingsChanged();
    if (hasData && !(sameAsSample() && !settingsChanged())) {
      $('sample-scope').textContent = '载入示例会替换现在的原文(' + state.text.length + ' 字符)和保护词(' + state.protectedWords.length + ' 个),并把规则设置恢复为默认' + (settingsChanged() ? '(当前设置与默认不同)' : '') + ',此操作不能撤销。';
      $('confirm-sample').hidden = false; $('sample-yes').focus();
    }
    else applySample();
  }
  function clearAll() {
    clearTimeout(saveTimer);
    saveTimer = null;
    var next = Core.defaultState();
    if (!save(next)) {
      setStatus('清空失败:浏览器拒绝写入本机存储。当前原文、保护词和规则设置均已保留,请先另存内容后重试。', true);
      scheduleSave();
      return;
    }
    state = next;
    syncControls(); render();
    setStatus('已清空。', false);
  }

  /* ---------- 启动 ---------- */

  function init() {
    load();
    buildRules();
    syncControls();
    render();
    $('input').addEventListener('input', function () {
      state.text = $('input').value;
      render(); scheduleSave();
    });
    $('word-form').addEventListener('submit', addWord);
    $('btn-copy').addEventListener('click', copyResult);
    $('btn-export').addEventListener('click', exportMarkdown);
    $('btn-warning-export').addEventListener('click', exportMarkdown);
    $('btn-sample').addEventListener('click', askSample);
    $('sample-yes').addEventListener('click', function () { $('confirm-sample').hidden = true; applySample(); });
    $('sample-no').addEventListener('click', function () { $('confirm-sample').hidden = true; });
    $('btn-clear').addEventListener('click', function () { $('confirm-sample').hidden = true; $('confirm-clear').hidden = false; $('clear-no').focus(); });
    $('clear-yes').addEventListener('click', function () { $('confirm-clear').hidden = true; clearAll(); });
    $('clear-no').addEventListener('click', function () { $('confirm-clear').hidden = true; });
    window.addEventListener('pagehide', function () { if (saveTimer) saveNow(); });
  }
  init();
})();
