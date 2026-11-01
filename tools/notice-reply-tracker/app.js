'use strict';
(function () {
  var Core = globalThis.NoticeCore;
  var KEY = 'noticereceipt.v1';
  var REJECTED_KEY = 'noticereceipt.v1.rejected';
  var state = Core.createState();
  var pendingAction = null;
  var flashTimer = null;
  var rejectedRaw = null;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ---------- 提示 ---------- */
  function flash(msg) {
    var f = $('flash');
    f.textContent = msg; f.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { f.hidden = true; }, 6000);
  }
  function showLoadError(msg, offerRaw) {
    $('load-error-text').textContent = msg;
    $('load-error-download').hidden = !(offerRaw && rejectedRaw != null);
    $('load-error').hidden = false;
  }
  function askConfirm(message, yesLabel, action) {
    pendingAction = action;
    $('confirm-text').textContent = message;
    $('confirm-yes').textContent = yesLabel;
    $('confirm-box').hidden = false;
    $('confirm-no').focus();
  }
  function closeConfirm() { pendingAction = null; $('confirm-box').hidden = true; }

  /* ---------- 存储 ---------- */
  function setStatus(text) { $('save-status').textContent = text; }
  function save() {
    try {
      var v = Core.validateState(state);
      if (!v.ok) throw new Error(v.error);
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      $('save-warning').hidden = false;
      setStatus('未保存');
      return false;
    }
    $('save-warning').hidden = true;
    var d = new Date();
    setStatus('已保存到本机浏览器 ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'));
    return true;
  }
  function loadSaved() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { return; }
    if (raw == null) return;
    var r = Core.validateImport(raw);
    if (r.ok) { state = r.state; return; }
    var backedUp = false;
    try { localStorage.setItem(REJECTED_KEY, raw); backedUp = localStorage.getItem(REJECTED_KEY) === raw; } catch (e) { backedUp = false; }
    rejectedRaw = raw;
    showLoadError('本机保存的数据读取失败(' + r.error + '),已按空白状态打开。' + (backedUp
      ? '原数据已另存在浏览器存储键 ' + REJECTED_KEY + ' 里,没有被删除。'
      : '另存失败:浏览器没有允许写入备份键。原数据仍在原存储键里,但下次保存会覆盖它,请先点下方「下载原始存档」。'), !backedUp);
  }

  /* ---------- 下载 ---------- */
  function safeName(s) {
    var t = String(s || '').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    return t || '通知';
  }
  function download(name, text, mime, bom) {
    var blob = new Blob([bom ? '\uFEFF' + text : text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---------- 渲染:输入区 ---------- */
  function nextBatchId() {
    var max = 0;
    state.batches.forEach(function (b) { var n = parseInt(b.id.replace(/\D/g, ''), 10); if (n > max) max = n; });
    var id = 'b' + (max + 1);
    while (state.batches.some(function (b) { return b.id === id; })) id += 'x';
    return id;
  }

  function renderBatches() {
    var box = $('batches');
    box.textContent = '';
    state.batches.forEach(function (b, i) {
      var card = el('div', 'batch');
      var head = el('div', 'batch__head');
      var lab = el('label', null, '批次名称');
      var inp = el('input'); inp.type = 'text'; inp.value = b.label; inp.autocomplete = 'off';
      inp.setAttribute('data-batch-label', b.id);
      inp.addEventListener('input', function () { b.label = inp.value; save(); renderResults(); });
      lab.appendChild(inp);
      var del = el('button', 'btn btn--danger btn--small', '删除'); del.type = 'button';
      del.disabled = state.batches.length <= 1;
      del.setAttribute('data-batch-del', b.id);
      del.addEventListener('click', function () {
        if (!b.text.trim()) { removeBatch(b.id); return; }
        askConfirm('删除「' + (b.label || '未命名批次') + '」及其回执文本?', '确认删除', function () { removeBatch(b.id); });
      });
      head.appendChild(lab); head.appendChild(del);
      var tl = el('label', null, '回执(群聊导出文本,或逐行「昵称: 内容」)');
      var ta = el('textarea', 'field-batch'); ta.value = b.text; ta.spellcheck = false;
      ta.setAttribute('data-batch-text', b.id);
      ta.addEventListener('input', function () { b.text = ta.value; save(); renderResults(); });
      tl.appendChild(ta);
      var info = el('p', 'batch__info'); info.setAttribute('data-batch-info', b.id);
      card.appendChild(head); card.appendChild(tl); card.appendChild(info);
      box.appendChild(card);
    });
  }
  function removeBatch(id) {
    state.batches = state.batches.filter(function (b) { return b.id !== id; });
    if (!state.batches.length) state.batches.push({ id: 'b1', label: '第 1 批', text: '' });
    save(); renderBatches(); renderResults();
    flash('已删除一批回执。');
  }

  function renderInputs() {
    $('title').value = state.title;
    $('roster').value = state.rosterText;
    $('template').value = state.template;
    Core.RULE_KEYS.forEach(function (k) { $('kw-' + k).value = state.rules[k].join(', '); });
    renderBatches();
    renderResults();
  }

  /* ---------- 渲染:结果区 ---------- */
  function stat(label, n, cls) {
    var d = el('div', 'stat' + (cls ? ' stat--' + cls : ''));
    d.appendChild(el('span', 'stat__n', String(n)));
    d.appendChild(el('span', null, label));
    return d;
  }

  function replyMeta(g) {
    var parts = [];
    if (g.reply.nick && g.reply.nick !== g.member.name) parts.push('昵称:' + g.reply.nick);
    if (g.reply.time) parts.push(g.reply.time);
    if (g.count > 1) parts.push('回复了 ' + g.count + ' 次,按最后一次计');
    return parts.join(' · ');
  }

  function renderResults() {
    var a = Core.analyze(state);
    var c = a.counts;

    // 汇总
    var sum = $('summary');
    sum.textContent = '';
    sum.appendChild(stat('名单人数', c.total));
    sum.appendChild(stat('已回', c.replied, 'ok'));
    sum.appendChild(stat('未回', c.unreplied, c.unreplied ? 'warn' : 'ok'));
    sum.appendChild(stat('无法识别', c.unknown, c.unknown ? 'danger' : ''));
    $('empty-guide').hidden = c.total > 0 || state.batches.some(function (b) { return b.text.trim(); });

    // 名单提示
    var ri = $('roster-info');
    ri.textContent = '';
    a.rosterErrors.forEach(function (e) { ri.appendChild(el('p', 'roster-error', '名单被整份拒绝:' + e.message)); });
    if (a.rosterHeader) ri.appendChild(el('p', 'muted', '首行「' + a.rosterHeader.join(', ') + '」已识别为表头,不计入名单。'));
    ri.appendChild(el('p', 'muted', '已识别 ' + c.total + ' 人' + (a.rosterSkipped.length ? ',跳过 ' + a.rosterSkipped.length + ' 行(没有姓名)' : '')));
    a.warnings.forEach(function (w) { ri.appendChild(el('p', null, w)); });

    // 批次信息
    a.batchInfo.forEach(function (bi) {
      var p = document.querySelector('[data-batch-info="' + bi.id + '"]');
      if (!p) return;
      var t = '解析出 ' + bi.replies + ' 条回复';
      if (bi.unknown) t += ',其中 ' + bi.unknown + ' 条无法识别';
      if (bi.skipped.length) t += ';' + bi.skipped.length + ' 行无法解析(缺少分隔符),已忽略:' + bi.skipped.slice(0, 3).map(function (s) { return '「' + s.text + '」'; }).join('');
      p.textContent = t;
    });

    // 已回
    $('replied-count').textContent = c.replied + ' 人';
    var rl = $('replied-list');
    rl.textContent = '';
    if (!c.replied) rl.appendChild(el('p', 'none', '还没有匹配到任何人的回执。'));
    Core.CATS.forEach(function (cat) {
      var list = a.groups[cat];
      if (!list.length) return;
      var sec = el('div', 'cat cat--' + cat);
      sec.setAttribute('data-cat', cat);
      var head = el('div', 'cat__head');
      head.appendChild(el('span', null, Core.CAT_LABEL[cat]));
      head.appendChild(el('span', null, list.length + ' 人'));
      sec.appendChild(head);
      var ul = el('ul', 'entries');
      list.forEach(function (g) {
        var li = el('li', 'entry');
        li.appendChild(el('span', 'entry__name', g.member.name + (g.member.note ? '(' + g.member.note + ')' : '')));
        li.appendChild(el('span', 'entry__reply', g.reply.content || '(空)'));
        var meta = replyMeta(g);
        if (meta) li.appendChild(el('span', 'entry__meta', meta));
        li.appendChild(el('span', 'entry__basis', '姓名匹配:' + Core.VIA_LABEL[g.via] + ' · 分类依据:' + (g.hit ? '命中关键词「' + g.hit + '」' : '没有命中任何关键词,归「其他」,请人工看')));
        g.review.forEach(function (note) { li.appendChild(el('span', 'entry__review', '请人工确认:' + note)); });
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      rl.appendChild(sec);
    });

    // 未回
    $('unreplied-count').textContent = c.unreplied + ' 人';
    var ul2 = $('unreplied-list');
    ul2.textContent = '';
    if (!c.unreplied) ul2.appendChild(el('li', 'none', c.total ? '名单里的人都回了。' : '名单为空。'));
    a.unmatched.forEach(function (m) {
      var li = el('li', 'entry');
      li.appendChild(el('span', 'entry__name', m.name));
      if (m.note) li.appendChild(el('span', 'entry__meta', m.note));
      ul2.appendChild(li);
    });
    var remind = Core.reminderText(a.unmatched, state.template);
    $('remind-text').value = remind;
    $('copy-remind').disabled = !remind;

    // 无法识别
    $('unknown-count').textContent = c.unknown + ' 条';
    var ul3 = $('unknown-list');
    ul3.textContent = '';
    if (!c.unknown) ul3.appendChild(el('li', 'none', '没有无法识别的昵称。'));
    var UNKNOWN_SHOW = 200;
    a.unknown.slice(0, UNKNOWN_SHOW).forEach(function (u) {
      var li = el('li', 'entry entry--unknown');
      li.appendChild(el('span', 'entry__name', u.nick));
      li.appendChild(el('span', 'entry__reply', u.content || '(空)'));
      li.appendChild(el('span', 'entry__meta', u.reason + (u.batch ? ' · ' + u.batch : '') + (u.time ? ' · ' + u.time : '')));
      ul3.appendChild(li);
    });
    if (a.unknown.length > UNKNOWN_SHOW) ul3.appendChild(el('li', 'none', '只显示前 ' + UNKNOWN_SHOW + ' 条,其余 ' + (a.unknown.length - UNKNOWN_SHOW) + ' 条在导出的回执表 CSV 里。'));

    // 导出
    var hasRoster = c.total > 0;
    $('export-csv').disabled = !hasRoster;
    $('export-txt').disabled = !remind;
    $('export-hint').textContent = hasRoster
      ? '导出内容与上面显示的结果一致(当前:已回 ' + c.replied + '、未回 ' + c.unreplied + '、无法识别 ' + c.unknown + ')。CSV 里以 = + - @ 开头的内容会加单引号前缀。'
      : '名单为空,先粘贴名单才能导出回执表。JSON 备份随时可导出。';
  }

  /* ---------- 动作 ---------- */
  function applyState(next, msg) {
    state = next;
    renderInputs();
    var ok = save();
    flash(ok ? msg : msg + '(但没有写入本机存储,请导出备份)');
  }

  function setPane(name) {
    document.body.setAttribute('data-pane', name);
    Array.prototype.forEach.call(document.querySelectorAll('#pane-tabs button'), function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-pane') === name ? 'true' : 'false');
    });
  }

  function exportJson() {
    download('通知回执备份-' + safeName(state.title) + '.json', JSON.stringify(state, null, 2), 'application/json');
  }

  function copyRemind() {
    var text = $('remind-text').value;
    function fallback() {
      var ta = $('remind-text');
      ta.focus(); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      flash(ok ? '催回名单已复制。' : '浏览器不允许自动复制,文字已选中,请按 Ctrl/Cmd+C。');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { flash('催回名单已复制。'); }, fallback);
    } else fallback();
  }

  function init() {
    loadSaved();
    renderInputs();

    $('title').addEventListener('input', function () { state.title = $('title').value; save(); });
    $('roster').addEventListener('input', function () { state.rosterText = $('roster').value; save(); renderResults(); });
    $('template').addEventListener('input', function () { state.template = $('template').value; save(); renderResults(); });
    Core.RULE_KEYS.forEach(function (k) {
      $('kw-' + k).addEventListener('input', function () { state.rules[k] = Core.parseKeywords($('kw-' + k).value); save(); renderResults(); });
    });
    $('kw-reset').addEventListener('click', function () {
      state.rules = Core.cloneRules(Core.DEFAULT_RULES);
      Core.RULE_KEYS.forEach(function (k) { $('kw-' + k).value = state.rules[k].join(', '); });
      save(); renderResults(); flash('已恢复默认关键词。');
    });
    $('add-batch').addEventListener('click', function () {
      state.batches.push({ id: nextBatchId(), label: '第 ' + (state.batches.length + 1) + ' 批', text: '' });
      save(); renderBatches(); renderResults();
      var tas = document.querySelectorAll('[data-batch-text]');
      tas[tas.length - 1].focus();
    });

    $('load-sample').addEventListener('click', function () {
      var sample = globalThis.NoticeSample.build();
      if (Core.hasUserData(state)) {
        askConfirm('载入示例会替换当前已填写的名单和回执。确认替换?(替换前可先导出 JSON 备份)', '确认替换', function () { applyState(sample, '已载入合成示例,姓名均为虚构。'); });
      } else applyState(sample, '已载入合成示例,姓名均为虚构。');
    });
    $('clear-all').addEventListener('click', function () {
      askConfirm('清空名单、所有回执批次和关键词设置?此操作不能撤销。', '确认清空', function () { applyState(Core.createState(), '已清空。'); });
    });
    $('import-btn').addEventListener('click', function () { $('import-file').click(); });
    $('import-file').addEventListener('change', function () {
      var f = $('import-file').files[0];
      $('import-file').value = '';
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var r = Core.validateImport(String(reader.result));
        if (!r.ok) { showLoadError('导入被拒绝,当前数据没有改动:' + r.error); return; }
        $('load-error').hidden = true;
        if (Core.hasUserData(state)) {
          askConfirm('导入会替换当前已填写的内容。确认替换?', '确认替换', function () { applyState(r.state, '已导入备份。'); });
        } else applyState(r.state, '已导入备份。');
      };
      reader.onerror = function () { showLoadError('读取文件失败,当前数据没有改动。'); };
      reader.readAsText(f);
    });

    $('confirm-yes').addEventListener('click', function () { var fn = pendingAction; closeConfirm(); if (fn) fn(); });
    $('confirm-no').addEventListener('click', closeConfirm);
    $('save-warning-export').addEventListener('click', exportJson);
    $('load-error-download').addEventListener('click', function () {
      if (rejectedRaw != null) download('通知回执-原始存档.json', rejectedRaw, 'application/json');
    });
    $('pane-tabs').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-pane]');
      if (b) setPane(b.getAttribute('data-pane'));
    });

    $('copy-remind').addEventListener('click', copyRemind);
    $('export-csv').addEventListener('click', function () {
      download('回执表-' + safeName(state.title) + '.csv', Core.toCsv(Core.receiptRows(Core.analyze(state))), 'text/csv', true);
    });
    $('export-txt').addEventListener('click', function () {
      download('催回名单-' + safeName(state.title) + '.txt', $('remind-text').value, 'text/plain');
    });
    $('export-json').addEventListener('click', exportJson);
  }

  init();
})();
