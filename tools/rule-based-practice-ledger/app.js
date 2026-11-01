'use strict';
(function () {
  const C = globalThis.DcaCore;
  const KEY = 'dcaledger.v1';
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const pad2 = n => String(n).padStart(2, '0');
  const now = new Date();
  const REAL_TODAY = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
  const TODAY = C.resolveToday(location.search, REAL_TODAY);
  const DEFAULT_UNIT = { amount: '元', count: '次', quantity: '字' };
  const DEFAULT_PERIODS = { daily: 90, weekly: 26, monthly: 12 };

  const state = { practices: [], selectedId: null };
  const ui = { tab: 'log', confirmEnd: false, confirmDel: null, pendingWrite: null, pending: null, periods: Object.create(null), recFormFor: null, ctlFor: null, lastDefaultUnit: DEFAULT_UNIT.quantity };

  /* ---------- 存储 ---------- */
  function loadState() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (!raw) return;
    try {
      const obj = JSON.parse(raw);
      const r = C.validateImport(obj);
      if (!r.ok) throw new Error(r.errors[0]);
      state.practices = r.data.practices;
      if (typeof obj.selectedId === 'string' && state.practices.some(p => p.id === obj.selectedId)) state.selectedId = obj.selectedId;
    } catch (e) {
      const w = $('load-warning');
      w.textContent = '本机存档无法读取(' + e.message + '),已忽略。在你下一次改动时它会被新数据覆盖;如需保留旧存档,请先不要做任何改动。';
      w.hidden = false;
    }
  }
  function save() {
    const payload = JSON.stringify({ app: C.FORMAT_ID, version: C.FORMAT_VERSION, selectedId: state.selectedId, practices: state.practices });
    try {
      localStorage.setItem(KEY, payload);
      $('save-warning').hidden = true;
      return true;
    } catch (e) {
      $('save-warning').hidden = false;
      return false;
    }
  }
  function setStatus(msg) { $('status').textContent = msg; }
  function commit(msg) {
    const ok = save();
    setStatus(ok ? msg + '(已保存到本机浏览器)' : msg + '——但没有保存成功,关闭页面会丢失,请看上方红色提示并导出备份。');
    render();
    return ok;
  }

  /* ---------- 工具 ---------- */
  const sel = () => state.practices.find(p => p.id === state.selectedId) || null;
  function fmtNum(v) {
    if (!isFinite(v)) return '—';
    if (Math.abs(v) >= 1e9) return v.toExponential(3);
    return v.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  }
  function fmtAxis(v) { return v >= 10000 ? Math.round(v / 100) / 100 + '万' : fmtNum(Math.round(v)); }
  function pct(r) { return r === null ? '无应执行' : Math.round(r * 1000) / 10 + '%'; }
  function effEnd(p) { return p.ended && p.ended < TODAY ? p.ended : TODAY; }
  function typeLabel(p) { return C.TYPE_LABEL[p.type]; }
  function label(p, per) {
    if (p.rule.kind === 'daily') return per.from.slice(5);
    if (p.rule.kind === 'weekly') return per.from.slice(5) + ' 起的一周(' + per.done + '/' + per.quota + ')';
    return per.key;
  }
  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------- 渲染 ---------- */
  function focusSelector(el) {
    if (!el || el === document.body) return null;
    if (el.id) return '#' + el.id;
    for (const a of ['data-id', 'data-del', 'data-fill', 'data-tab']) if (el.hasAttribute(a)) return '[' + a + '="' + CSS.escape(el.getAttribute(a)) + '"]';
    return null;
  }
  function render() {
    const fk = focusSelector(document.activeElement);
    renderAll();
    if (fk) { const n = document.querySelector(fk); if (n && n !== document.activeElement && !n.disabled) n.focus(); }
  }
  function renderAll() {
    renderList();
    const p = sel();
    $('empty-state').hidden = !!p;
    $('detail').hidden = !p;
    $('sample-note').hidden = !state.practices.some(x => x.sample);
    $('list-empty').hidden = state.practices.length > 0;
    if (!p) return;
    renderHead(p);
    document.querySelectorAll('.tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === ui.tab)));
    ['log', 'grow', 'export'].forEach(t => { $('panel-' + t).hidden = ui.tab !== t; });
    renderGuard(p); renderRecordForm(p); renderStats(p); renderHeat(p); renderMissed(p); renderRecent(p); renderEnd(p);
    renderGrowTab(p);
    renderExport(p);
  }
  function renderList() {
    $('practice-list').innerHTML = state.practices.map(p => {
      const cur = p.id === state.selectedId;
      const er = C.executionRate(p.records, p.rule, p.start, TODAY, p.ended);
      return '<li><button type="button" class="practice-item" data-id="' + esc(p.id) + '" aria-current="' + cur + '">' +
        '<span class="name">' + esc(p.name) + '</span>' +
        '<span class="meta">' + typeLabel(p) + ' · ' + esc(C.ruleText(p.rule)) + ' · 执行率 ' + pct(er.rate) + (p.ended ? ' · 已结束' : '') + (p.sample ? ' · 合成示例' : '') + '</span></button></li>';
    }).join('');
  }
  function renderHead(p) {
    $('detail-head').innerHTML =
      '<h2>' + esc(p.name) + '</h2><p><span class="tag">' + typeLabel(p) + '</span>' +
      (p.sample ? '<span class="tag tag-warn">合成示例</span>' : '') +
      (p.ended ? '<span class="tag tag-end">已于 ' + esc(p.ended) + ' 结束</span>' : '') + '</p>' +
      '<dl class="facts"><div><dt>固定规则</dt><dd>' + esc(C.ruleText(p.rule)) + '</dd></div>' +
      '<div><dt>每次定额</dt><dd>' + esc(fmtNum(p.amount)) + ' ' + esc(p.unit) + '</dd></div>' +
      '<div><dt>开始日期</dt><dd>' + esc(p.start) + '</dd></div>' +
      '<div><dt>止损规则(只记录,不执行)</dt><dd>' + (p.stopLoss ? esc(p.stopLoss) : '(未填写)') + '</dd></div></dl>';
  }
  function renderGuard(p) {
    const g = C.guardStatus(p.records, p.rule, p.start, TODAY, p.ended);
    const scopeWord = g.scope === 'month' ? '本月' : '本周';
    let html;
    if (p.ended) html = '<p class="guard-line">已结束践行</p><p class="muted">记录保留,不再计入应执行。结束后不能重启,想继续请新建一个践行。</p>';
    else if (TODAY < p.start) html = '<p class="guard-line">还没到开始日期 ' + esc(p.start) + '</p>';
    else if (g.remaining > 0) html = '<p class="guard-line guard-need">' + scopeWord + '还需执行 ' + g.remaining + ' 次</p><p class="muted">' + scopeWord + '定额 ' + g.quota + ' 次,已完成 ' + g.done + ' 次。</p>';
    else html = '<p class="guard-line guard-ok">' + scopeWord + '定额已完成(' + g.done + '/' + g.quota + ')</p>';
    html += '<p class="muted">这里没有「暂停」按钮,只有页面底部的「结束践行」——用规则替代意志,是刻意的设计。</p>';
    $('guard').innerHTML = html;
  }
  function clampRecDate(p, d) {
    const max = effEnd(p);
    if (d < p.start) return p.start;
    return d > max ? max : d;
  }
  function renderRecordForm(p) {
    $('today-label').textContent = TODAY;
    const dis = !!p.ended || TODAY < p.start;
    $('rec-date').min = p.start;
    $('rec-date').max = effEnd(p);
    if (ui.recFormFor !== p.id) {
      ui.recFormFor = p.id;
      $('rec-date').value = clampRecDate(p, TODAY);
      $('rec-value').value = p.amount;
      $('rec-msg').hidden = true;
    }
    $('rec-value').step = 'any';
    ['do-today', 'rec-submit', 'rec-date', 'rec-value'].forEach(id => { $(id).disabled = dis; });
    const todayRec = p.records.find(r => r.date === TODAY);
    $('do-today').textContent = todayRec ? '查看/修改今日记录(已记 ' + fmtNum(todayRec.value) + ' ' + p.unit + ')' : '按规则完成(' + fmtNum(p.amount) + ' ' + p.unit + ')';
    if (ui.pendingWrite && ui.pendingWrite.pid !== p.id) ui.pendingWrite = null;
    $('overwrite-confirm').hidden = !ui.pendingWrite;
  }
  function renderStats(p) {
    const er = C.executionRate(p.records, p.rule, p.start, TODAY, p.ended);
    const st = C.streak(p.records, p.rule, TODAY, { start: p.start, ended: p.ended });
    const total = p.records.reduce((a, r) => a + r.value, 0);
    $('stats').innerHTML = '<h3>对账</h3><div class="stat-grid">' +
      '<div class="stat"><div class="k">连续</div><div class="v">' + st + ' ' + C.streakUnit(p.rule) + '</div><div class="s">' + (p.rule.kind === 'daily' ? '今天还没做不算断' : '当期未完成不算断') + '</div></div>' +
      '<div class="stat"><div class="k">' + (p.type === 'amount' ? '累计投入' : '累计量') + '</div><div class="v">' + esc(fmtNum(total)) + ' ' + esc(p.unit) + '</div><div class="s">共 ' + p.records.length + ' 次记录</div></div>' +
      '<div class="stat"><div class="k">执行率</div><div class="v">' + pct(er.rate) + '</div><div class="s">实际 ' + er.actual + ' 次 / 应执行 ' + er.expected + ' 次</div></div>' +
      '</div><p class="muted">口径:执行率 = 有记录的次数 ÷ 应执行次数。只要当天有一条大于 0 的记录就算执行一次,不看是否达到每次定额(定额 500 字、只写 1 字也算一次),所以它不表示完成定额的比例;下面热力条的颜色才区分「达到定额」和「低于定额」。</p>';
  }
  function renderHeat(p) {
    const weeks = C.weeklyHeat(p.records, TODAY, { weeks: 12, start: p.start, ended: p.ended });
    const head = ['一', '二', '三', '四', '五', '六', '日'].map(d => '<th scope="col">' + d + '</th>').join('');
    const rows = weeks.map(w => '<tr><th scope="row">' + w.weekStart.slice(5) + '</th>' + w.cells.map(c => {
      let cls, txt;
      if (c.outside || c.future) { cls = 'cell-off'; txt = '不在区间'; }
      else if (c.value !== null) { cls = c.value >= p.amount ? 'cell-full' : 'cell-part'; txt = '已完成 ' + fmtNum(c.value) + ' ' + p.unit; }
      else if (p.rule.kind === 'daily') { cls = 'cell-miss'; txt = '未执行'; }
      else { cls = 'cell-none'; txt = '无记录'; }
      return '<td class="' + cls + '" title="' + esc(c.date + ' ' + txt) + '"><span class="sr-only">' + esc(c.date + ' ' + txt) + '</span></td>';
    }).join('') + '</tr>').join('');
    $('heat').innerHTML = '<h3>按周热力条(每周一行、每天一格)</h3><div class="heat-wrap"><table class="heat"><caption>最近 12 周(行首为该周周一)</caption><thead><tr><th></th>' + head + '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<ul class="legend"><li><span class="sw sw-full"></span>达到定额</li><li><span class="sw sw-part"></span>低于定额</li>' +
      (p.rule.kind === 'daily' ? '<li><span class="sw sw-miss"></span>未执行</li>' : '') + '<li><span class="sw sw-none"></span>无记录</li></ul>';
  }
  function renderMissed(p) {
    const missed = C.periods(p.records, p.rule, p.start, TODAY, p.ended).filter(x => x.status === 'missed');
    const unit = C.streakUnit(p.rule);
    const shown = missed.slice(-12).reverse();
    $('missed').innerHTML = '<h3>未执行:' + missed.length + ' ' + unit + '</h3>' + (missed.length
      ? '<p class="muted">缺勤是自动算出来的,不用手动标记。点一项可补录那一天。</p><ul class="chips">' + shown.map(x =>
        '<li><button type="button" class="chip-missed" data-fill="' + esc(x.from) + '">' + esc(label(p, x)) + '</button></li>').join('') + '</ul>' +
        (missed.length > shown.length ? '<p class="muted">仅显示最近 ' + shown.length + ' 项。</p>' : '')
      : '<p class="muted">没有缺勤。</p>');
  }
  function renderRecent(p) {
    const rows = p.records.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 8);
    const cd = ui.confirmDel && ui.confirmDel.pid === p.id ? ui.confirmDel.date : null;
    $('recent').innerHTML = '<h3>最近记录</h3>' + (rows.length ? '<ul class="rec-list">' + rows.map(r => r.date === cd
      ? '<li class="rec-confirm"><span>确认删除 ' + esc(r.date) + ' 的记录(' + esc(fmtNum(r.value)) + ' ' + esc(p.unit) + ')?删除后连续、累计和执行率会重新计算。</span><span class="row-actions"><button type="button" class="btn btn-danger" id="del-yes" data-del-yes="' + esc(r.date) + '">确认删除</button><button type="button" class="btn btn-quiet" id="del-no">取消</button></span></li>'
      : '<li><span>' + esc(r.date) + ' · ' + esc(fmtNum(r.value)) + ' ' + esc(p.unit) + '</span><button type="button" class="btn-text" data-del="' + esc(r.date) + '" aria-label="删除 ' + esc(r.date) + ' 的记录">删除</button></li>').join('') + '</ul>'
      : '<p class="muted">还没有记录。点上方「按规则完成」开始。</p>');
  }
  function renderEnd(p) {
    if (p.ended) { $('end-area').innerHTML = '<h3>结束践行</h3><p class="muted">已于 ' + esc(p.ended) + ' 结束。</p>'; return; }
    $('end-area').innerHTML = '<h3>结束践行</h3><p class="muted">不提供「暂停」。如果真的要停,只能结束:结束后记录保留,但不再计入应执行,也不能重启。</p>' +
      (ui.confirmEnd
        ? '<div class="banner banner-warn" role="alertdialog" aria-label="确认结束"><span>确认从 ' + esc(TODAY) + ' 起结束「' + esc(p.name) + '」?</span><span class="row-actions"><button type="button" class="btn btn-danger" id="end-yes">确认结束</button><button type="button" class="btn btn-quiet" id="end-no">取消</button></span></div>'
        : '<button type="button" class="btn btn-quiet" id="end-btn">结束践行</button>');
  }

  /* ---------- 复利 Tab ---------- */
  function syncControls(p) {
    if (ui.ctlFor === p.id) return;
    ui.ctlFor = p.id;
    $('rate-input').value = String(Number((p.annualRate * 100).toFixed(6)));
    $('periods-input').value = ui.periods[p.id] || DEFAULT_PERIODS[p.rule.kind];
  }
  function renderGrowTab(p) {
    const isAmount = p.type === 'amount';
    $('compound-controls').hidden = !isAmount;
    if (isAmount) renderPeriodsUi(p);
    if (isAmount) { syncControls(p); renderCompound(p); }
    else $('compound-out').innerHTML = '<p class="muted">复利曲线只用于金额型。当前是' + typeLabel(p) + ',请在「记录」页看连续天数、累计量、执行率和热力条;下面的「每天进步一点点」对所有类型都可用。</p>';
    renderGrowth();
  }
  function renderPeriodsUi(p) {
    const w = C.periodWord(p.rule, Number($('periods-input').value));
    $('periods-label').textContent = w.label + '(一期 = 1 ' + w.unit + ')';
    $('periods-hint').textContent = w.note;
  }
  function renderCompound(p) {
    const out = $('compound-out');
    renderPeriodsUi(p);
    const n = Number($('periods-input').value);
    const ratePct = Number($('rate-input').value);
    if ($('rate-input').value === '' || !isFinite(ratePct) || ratePct <= -100 || ratePct > 1000) { out.innerHTML = '<p class="form-error" role="alert">年化假设需要在 -99 到 1000 之间。</p>'; return; }
    if (!Number.isInteger(n) || n < 1 || n > 600) { out.innerHTML = '<p class="form-error" role="alert">推算期数需要是 1 到 600 的整数。</p>'; return; }
    const rate = Number((ratePct / 100).toFixed(8));
    const pr = C.project(p.rule, p.amount, n, rate);
    const cur = pr.curve, lump = pr.lump;
    if (!cur.length) { out.innerHTML = '<p class="form-error" role="alert">推算的执行次数(' + pr.executions + ')超过上限 ' + 5000 + ',请减少期数。</p>'; return; }
    const act = C.assumedValue(p.records, rate, TODAY);
    const last = cur[cur.length - 1], lastLump = lump[lump.length - 1];
    const periodWord = C.periodWord(p.rule, n).unit;
    out.innerHTML =
      '<h4>已发生的实际记录</h4><div class="kv">' +
      '<div class="kv-item"><div class="k">累计投入</div><div class="v">' + esc(fmtNum(act.invested)) + ' ' + esc(p.unit) + '</div></div>' +
      '<div class="kv-item"><div class="k">按假设(年化 ' + esc(String(ratePct)) + '%)的账面值</div><div class="v">' + esc(fmtNum(act.value)) + ' ' + esc(p.unit) + '</div></div></div>' +
      '<h4>未来新增投入的独立推算(假设,不是预测)</h4><p class="muted">假设从今天起按规则再坚持 ' + n + ' ' + periodWord + ',共 ' + pr.executions + ' 次执行。这里只算这部分新投入,不含上面「已发生的实际记录」里的本金和增长,两部分不要直接相加。</p><div class="kv">' +
      '<div class="kv-item"><div class="k">推算累计投入</div><div class="v">' + esc(fmtNum(last.invested)) + ' ' + esc(p.unit) + '</div></div>' +
      '<div class="kv-item"><div class="k">假设终值</div><div class="v">' + esc(fmtNum(last.value)) + ' ' + esc(p.unit) + '</div></div>' +
      '<div class="kv-item"><div class="k">一次性投入同额(算术对照)</div><div class="v">' + esc(fmtNum(lastLump.value)) + ' ' + esc(p.unit) + '</div></div></div>' +
      '<p class="muted">一次性对照只是算术:同样的总额在第 0 期一次投入,按同一个假设年化滚动。它不说明哪种方式更好,也不是建议。</p>' +
      chartSvg(cur, pr.executions, p.unit) +
      '<ul class="legend"><li><span class="sw sw-line-assume"></span>假设线(按年化假设)</li><li><span class="sw sw-line-invest"></span>投入线(累计投入,虚线)</li>' + (rate === 0 ? '<li>年化为 0 时两条线重合</li>' : '') + '</ul>';
  }
  function chartSvg(cur, n, unit) {
    const W = 720, H = 300, L = 88, R = 16, T = 16, B = 44;
    const pts = [{ period: 0, invested: 0, value: 0 }].concat(cur);
    let ymax = 0;
    pts.forEach(p => { ymax = Math.max(ymax, p.invested, p.value); });
    if (ymax <= 0) ymax = 1;
    const x = k => L + (k / n) * (W - L - R);
    const y = v => T + (1 - v / ymax) * (H - T - B);
    const path = key => pts.map((p, i) => (i ? 'L' : 'M') + x(p.period).toFixed(1) + ' ' + y(p[key]).toFixed(1)).join(' ');
    const grid = [0, 0.5, 1].map(f => {
      const v = ymax * f;
      return '<line class="grid-line" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>' +
        '<text class="axis-label" x="' + (L - 8) + '" y="' + (y(v) + 5).toFixed(1) + '" text-anchor="end">' + esc(fmtAxis(v)) + '</text>';
    }).join('');
    const xl = [[0, 'start'], [n / 2, 'middle'], [n, 'end']].map(([k, anchor]) =>
      '<text class="axis-label" x="' + x(k).toFixed(1) + '" y="' + (H - 12) + '" text-anchor="' + anchor + '">第 ' + Math.round(k * 10) / 10 + ' 次</text>').join('');
    return '<div class="chart-scroll" tabindex="0" role="region" aria-label="复利曲线,可横向滑动"><svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="投入线与假设线,共 ' + n + ' 期,单位 ' + esc(unit) + '">' +
      grid + xl + '<path class="ln ln-assume" d="' + path('value') + '"/><path class="ln ln-invest" d="' + path('invested') + '"/></svg></div>';
  }
  function renderGrowth() {
    const out = $('g-out');
    const r = $('g-rate').value === '' ? NaN : Number($('g-rate').value);
    const d = $('g-days').value === '' ? NaN : Number($('g-days').value);
    if (!isFinite(r) || r < -50 || r > 20 || !Number.isInteger(d) || d < 0 || d > 3650) {
      out.innerHTML = '<p class="form-error" role="alert">每日进步率需在 -50 到 20 之间,天数需是 0 到 3650 的整数。</p>';
      return;
    }
    const cmp = C.compareGrowth(r / 100, d);
    const maxv = Math.max(cmp.steady, cmp.alternate);
    out.innerHTML = '<div class="kv">' +
      '<div class="kv-item"><div class="k">稳定每天做(' + d + ' 次)</div><div class="v">× ' + esc(fmtNum(cmp.steady)) + '</div></div>' +
      '<div class="kv-item"><div class="k">隔天做(' + cmp.alternateTimes + ' 次)</div><div class="v">× ' + esc(fmtNum(cmp.alternate)) + '</div></div>' +
      '<div class="kv-item"><div class="k">稳定 ÷ 隔天</div><div class="v">' + (cmp.ratio === null ? '—' : esc(fmtNum(cmp.ratio)) + ' 倍') + '</div></div></div>' +
      '<div class="bars"><div class="bar-row"><span>稳定每天做</span><div class="bar-track"><div class="bar-fill" data-w="' + (cmp.steady / maxv * 100) + '"></div></div></div>' +
      '<div class="bar-row"><span>隔天做</span><div class="bar-track"><div class="bar-fill alt" data-w="' + (cmp.alternate / maxv * 100) + '"></div></div></div></div>' +
      '<p class="muted">纯算术:(1+r)<sup>n</sup>。现实里进步率不会恒定,这只展示「规则稳定」对结果的放大作用,不是预测。</p>';
    out.querySelectorAll('.bar-fill').forEach(el => { el.style.width = el.dataset.w + '%'; });
  }

  /* ---------- 导出 Tab ---------- */
  function mdMonthOk() { return C.monthBounds($('md-month').value) !== null; }
  function renderExport(p) {
    if (!ui.mdInit) { ui.mdInit = true; $('md-month').value = TODAY.slice(0, 7); }
    const ok = mdMonthOk();
    $('md-hint').hidden = ok;
    $('export-md').disabled = !ok;
    $('md-preview').textContent = ok ? C.toMarkdown(p, $('md-month').value, TODAY) : '';
  }
  function showImportResult(html) { $('import-out').innerHTML = html; }

  /* ---------- 行为 ---------- */
  function recFail(text, fieldId) {
    const msg = $('rec-msg');
    msg.textContent = text; msg.hidden = false;
    for (const id of ['rec-date', 'rec-value']) $(id).removeAttribute('aria-invalid');
    if (fieldId) { $(fieldId).setAttribute('aria-invalid', 'true'); $(fieldId).focus(); }
    return false;
  }
  function upsertRecord(p, date, value, fromToday, confirmed) {
    const msg = $('rec-msg');
    if (p.ended) return recFail('这个践行已经结束,不能再记录。');
    if (!C.isValidDate(date)) return recFail('请选择有效的日期。', 'rec-date');
    if (date < p.start) return recFail('日期不能早于开始日期 ' + p.start + '。', 'rec-date');
    if (date > TODAY) return recFail('不能记录未来的日期。', 'rec-date');
    if (typeof value !== 'number' || !isFinite(value) || value <= 0) return recFail('实际值必须大于 0。没做就不用记录,系统会自动显示为「未执行」。', 'rec-value');
    msg.hidden = true;
    for (const id of ['rec-date', 'rec-value']) $(id).removeAttribute('aria-invalid');
    const res = C.withRecord(p, date, value);
    if (!res.ok) return recFail('这条记录不合法,没有写入:' + res.errors[0], 'rec-value');
    const ch = C.recordChange(p, date, value);
    if (ch.kind === 'same') { ui.pendingWrite = null; $('overwrite-confirm').hidden = true; setStatus(date + ' 已经记录为 ' + fmtNum(value) + ' ' + p.unit + ',没有改动。'); return true; }
    if (ch.kind === 'overwrite' && !confirmed) {
      ui.pendingWrite = { pid: p.id, date, value, fromToday };
      $('overwrite-text').textContent = date + ' 已记录 ' + fmtNum(ch.existing) + ' ' + p.unit + ',确认改为 ' + fmtNum(value) + ' ' + p.unit + '?旧值会被覆盖。';
      $('overwrite-confirm').hidden = false;
      $('ow-no').focus();
      return false;
    }
    ui.pendingWrite = null; $('overwrite-confirm').hidden = true;
    p.records = res.practice.records;
    commit((ch.kind === 'overwrite' ? '已更新 ' : '已记录 ') + date + (fromToday ? ' 按规则完成' : ' 的 ' + fmtNum(value) + ' ' + p.unit));
    return true;
  }
  function openNew(open) {
    $('new-panel').hidden = !open;
    $('new-btn').setAttribute('aria-expanded', String(open));
    if (open) { if (!$('f-start').value) $('f-start').value = TODAY; $('f-name').focus(); }
  }
  function syncKindFields() {
    const k = $('f-kind').value;
    $('f-n-wrap').hidden = k !== 'weekly';
    $('f-day-wrap').hidden = k !== 'monthly';
  }
  function createPractice(ev) {
    ev.preventDefault();
    const err = $('f-error');
    const fail = (t, id) => {
      err.textContent = t; err.hidden = false;
      ['f-name', 'f-unit', 'f-amount', 'f-start'].forEach(x => $(x).removeAttribute('aria-invalid'));
      if (id) { $(id).setAttribute('aria-invalid', 'true'); $(id).focus(); }
    };
    const name = $('f-name').value.trim();
    const type = $('f-type').value, kind = $('f-kind').value;
    const amount = $('f-amount').value === '' ? NaN : Number($('f-amount').value);
    const unit = $('f-unit').value.trim();
    if (!name) return fail('请填写名称。', 'f-name');
    if (!unit) return fail('请填写单位。', 'f-unit');
    if (!isFinite(amount) || amount <= 0) return fail('每次定额必须是大于 0 的数字。', 'f-amount');
    if (!C.isValidDate($('f-start').value)) return fail('请选择有效的开始日期。', 'f-start');
    const rule = kind === 'weekly' ? { kind, n: Number($('f-n').value) } : kind === 'monthly' ? { kind, day: Number($('f-day').value) } : { kind };
    const p = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, type, unit, rule, amount,
      start: $('f-start').value, stopLoss: $('f-stop').value.trim(), ended: null, annualRate: 0, records: [] };
    const res = C.validatePractice(p, '新建');
    if (res.errors.length) return fail(res.errors[0], /名称|name/.test(res.errors[0]) ? 'f-name' : /单位|unit/.test(res.errors[0]) ? 'f-unit' : /定额|amount/.test(res.errors[0]) ? 'f-amount' : null);
    err.hidden = true;
    ['f-name', 'f-unit', 'f-amount', 'f-start'].forEach(x => $(x).removeAttribute('aria-invalid'));
    state.practices.push(res.clean);
    state.selectedId = res.clean.id;
    ui.tab = 'log'; ui.confirmEnd = false;
    $('new-form').reset(); $('f-start').value = TODAY; syncKindFields();
    openNew(false);
    commit('已新建「' + name + '」');
  }

  function bind() {
    $('practice-list').addEventListener('click', e => {
      const b = e.target.closest('[data-id]');
      if (!b) return;
      state.selectedId = b.dataset.id; ui.confirmEnd = false; ui.tab = 'log';
      save(); render();
    });
    $('new-btn').addEventListener('click', () => openNew($('new-panel').hidden));
    $('f-cancel').addEventListener('click', () => openNew(false));
    $('f-kind').addEventListener('change', syncKindFields);
    $('f-type').addEventListener('change', () => {
      const t = $('f-type').value;
      if ($('f-unit').value === ui.lastDefaultUnit) $('f-unit').value = DEFAULT_UNIT[t];
      ui.lastDefaultUnit = DEFAULT_UNIT[t];
      if (t === 'count') $('f-amount').value = 1;
    });
    $('new-form').addEventListener('submit', createPractice);
    $('load-sample').addEventListener('click', () => {
      const have = new Set(state.practices.map(p => p.id));
      const add = globalThis.DcaSample(TODAY).filter(p => !have.has(p.id));
      if (!add.length) { setStatus('示例已经载入过了。'); return; }
      state.practices.push(...add);
      state.selectedId = add[0].id; ui.tab = 'log';
      commit('已载入 ' + add.length + ' 条合成示例');
    });
    $('clear-btn').addEventListener('click', () => { $('clear-confirm').hidden = false; $('clear-no').focus(); });
    $('clear-no').addEventListener('click', () => { $('clear-confirm').hidden = true; });
    $('clear-yes').addEventListener('click', () => {
      state.practices = []; state.selectedId = null; ui.confirmDel = null; ui.pendingWrite = null; ui.recFormFor = null; ui.ctlFor = null; ui.periods = Object.create(null);
      $('clear-confirm').hidden = true;
      commit('已清空全部数据');
    });
    const pickBackup = () => $('import-file').click();
    $('import-btn').addEventListener('click', pickBackup);
    $('empty-import').addEventListener('click', pickBackup);
    $('warn-export').addEventListener('click', () => {
      if (!state.practices.length) { setStatus('当前没有可导出的数据。'); return; }
      if (!sel()) state.selectedId = state.practices[0].id;
      ui.tab = 'export'; render(); $('export-json').focus();
    });
    document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => { ui.tab = b.dataset.tab; render(); }));

    $('do-today').addEventListener('click', () => {
      const p = sel(); if (!p) return;
      const ex = p.records.find(r => r.date === TODAY);
      if (ex) {
        $('rec-msg').hidden = true;
        $('rec-date').value = TODAY; $('rec-value').value = ex.value;
        $('rec-value').focus(); $('rec-value').select();
        setStatus('今天已经记录了 ' + fmtNum(ex.value) + ' ' + p.unit + ',按钮没有覆盖它。要修改就改「实际值」再点「记录这一天」,覆盖前会让你确认。');
        return;
      }
      upsertRecord(p, TODAY, p.amount, true);
    });
    $('ow-yes').addEventListener('click', () => {
      const p = sel(); const w = ui.pendingWrite;
      if (!p || !w || w.pid !== p.id) { $('overwrite-confirm').hidden = true; return; }
      upsertRecord(p, w.date, w.value, w.fromToday, true);
      $('rec-value').focus();
    });
    $('ow-no').addEventListener('click', () => { ui.pendingWrite = null; $('overwrite-confirm').hidden = true; $('rec-value').focus(); });
    $('rec-form').addEventListener('submit', e => {
      e.preventDefault();
      const p = sel(); if (!p) return;
      upsertRecord(p, $('rec-date').value, $('rec-value').value === '' ? NaN : Number($('rec-value').value), false);
    });
    $('missed').addEventListener('click', e => {
      const b = e.target.closest('[data-fill]'); const p = sel();
      if (!b || !p) return;
      $('rec-date').value = clampRecDate(p, b.dataset.fill);
      $('rec-value').value = p.amount;
      $('rec-date').focus();
      setStatus('已把 ' + $('rec-date').value + ' 填进补录日期,确认后点「记录这一天」。');
    });
    $('recent').addEventListener('click', e => {
      const p = sel(); if (!p) return;
      const b = e.target.closest('[data-del]');
      if (b) { ui.confirmDel = { pid: p.id, date: b.dataset.del }; renderRecent(p); $('del-no').focus(); return; }
      if (e.target.closest('#del-no')) {
        const d = ui.confirmDel && ui.confirmDel.date; ui.confirmDel = null; renderRecent(p);
        const back = document.querySelector('[data-del="' + CSS.escape(d || '') + '"]'); if (back) back.focus();
        return;
      }
      const y = e.target.closest('[data-del-yes]');
      if (y) {
        const d = y.dataset.delYes; ui.confirmDel = null;
        p.records = p.records.filter(r => r.date !== d);
        commit('已删除 ' + d + ' 的记录');
        (document.querySelector('#recent [data-del]') || $('do-today')).focus();
      }
    });
    $('end-area').addEventListener('click', e => {
      const p = sel(); if (!p) return;
      const id = e.target.id;
      if (id === 'end-btn') { ui.confirmEnd = true; renderEnd(p); $('end-no').focus(); }
      else if (id === 'end-no') { ui.confirmEnd = false; renderEnd(p); }
      else if (id === 'end-yes') { ui.confirmEnd = false; p.ended = TODAY < p.start ? p.start : TODAY; commit('已结束「' + p.name + '」'); }
    });

    /* 复利 */
    $('rate-input').addEventListener('input', () => {
      const p = sel(); if (!p) return;
      const v = Number($('rate-input').value);
      if ($('rate-input').value !== '' && isFinite(v) && v > -100 && v <= 1000) { p.annualRate = Number((v / 100).toFixed(8)); save(); }
      renderCompound(p);
    });
    const setRate = v => {
      const p = sel(); if (!p) return;
      $('rate-input').value = String(v); p.annualRate = v / 100; save(); renderCompound(p);
    };
    $('rate0').addEventListener('click', () => setRate(0));
    $('rate6').addEventListener('click', () => setRate(6));
    $('periods-input').addEventListener('input', () => {
      const p = sel(); if (!p) return;
      const n = Number($('periods-input').value);
      if (Number.isInteger(n) && n >= 1 && n <= 600) ui.periods[p.id] = n;
      renderCompound(p);
    });
    $('g-rate').addEventListener('input', renderGrowth);
    $('g-days').addEventListener('input', renderGrowth);

    /* 导出 */
    $('export-csv').addEventListener('click', () => { download('dca-ledger-records.csv', '\uFEFF' + C.toCsv(state.practices), 'text/csv'); setStatus('已生成 CSV 下载。'); });
    $('md-month').addEventListener('input', () => { const p = sel(); if (p) renderExport(p); });
    $('export-md').addEventListener('click', () => {
      const p = sel(); if (!p || !mdMonthOk()) return;
      download('dca-ledger-' + $('md-month').value + '.md', C.toMarkdown(p, $('md-month').value, TODAY), 'text/markdown');
      setStatus('已生成月度总结下载。');
    });
    $('export-json').addEventListener('click', () => { download('dca-ledger-backup-' + TODAY + '.json', C.exportJson(state.practices), 'application/json'); setStatus('已生成 JSON 备份下载。'); });
    $('import-file').addEventListener('change', ev => {
      const f = ev.target.files && ev.target.files[0];
      ui.pending = null;
      if (!f) return;
      const reject = list => showImportResult('<p class="form-error">整份文件已拒绝,当前数据没有改动。原因:</p><ul class="err-list">' +
        list.slice(0, 10).map(x => '<li>' + esc(x) + '</li>').join('') + (list.length > 10 ? '<li>……另有 ' + (list.length - 10) + ' 条</li>' : '') + '</ul>');
      if (f.size > 5 * 1024 * 1024) { reject(['文件超过 5MB']); ev.target.value = ''; return; }
      const reader = new FileReader();
      reader.onerror = () => reject(['文件读取失败']);
      reader.onload = () => {
        let obj;
        try { obj = JSON.parse(String(reader.result)); } catch (e) { reject(['不是有效的 JSON:' + e.message]); return; }
        const r = C.validateImport(obj);
        if (!r.ok) { reject(r.errors); return; }
        ui.pending = r.data;
        const recs = r.data.practices.reduce((a, p) => a + p.records.length, 0);
        showImportResult('<p>文件有效:' + r.data.practices.length + ' 条践行、' + recs + ' 条记录。导入会<strong>替换</strong>当前全部数据。</p>' +
          '<div class="row-actions"><button type="button" class="btn btn-danger" id="import-yes">确认替换</button><button type="button" class="btn btn-quiet" id="import-no">取消</button></div>');
      };
      reader.readAsText(f);
      ev.target.value = '';
    });
    $('import-out').addEventListener('click', e => {
      if (e.target.id === 'import-no') { ui.pending = null; showImportResult(''); }
      else if (e.target.id === 'import-yes' && ui.pending) {
        state.practices = ui.pending.practices;
        state.selectedId = state.practices.length ? state.practices[0].id : null;
        ui.pending = null; ui.recFormFor = null; ui.ctlFor = null;
        showImportResult('');
        commit('已导入 ' + state.practices.length + ' 条践行');
      }
    });
  }

  loadState();
  if (!state.selectedId && state.practices.length) state.selectedId = state.practices[0].id;
  $('f-start').value = TODAY;
  syncKindFields();
  bind();
  render();
  if (C.isValidDate(new URLSearchParams(location.search).get('today') || '')) { const tn = $('today-note'); tn.textContent = '基准日 ' + TODAY + '(由地址参数固定)'; tn.hidden = false; }
})();
