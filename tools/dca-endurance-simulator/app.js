'use strict';
/* DOM 与交互。所有计算委托给 core.js(DcaCore);用户输入渲染前一律转义。 */
(function () {
  const C = globalThis.DcaCore;
  const KEY = 'dcaendure.v1';
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const today = C.resolveToday(location.search);
  const CHART_W = 800, CHART_H = 320, MAX_DRAW_POINTS = 600;

  const S = { state: C.defaultState(), computed: null, errors: [], tab: 'compare', quiz: null, quizSaved: null, auto: null, confirmYes: null };

  /* ---------- 存档 ---------- */
  function showSaveWarning(text) {
    $('save-warning-text').textContent = text;
    $('save-warning').hidden = false;
    $('save-status').textContent = '未保存';
  }
  function save() {
    const v = C.validateState(S.state);
    if (!v.ok) { showSaveWarning('未保存:当前状态没有通过校验(' + v.error + ')。请先用“导出”备份。'); return false; }
    try {
      localStorage.setItem(KEY, JSON.stringify(S.state));
    } catch (e) {
      showSaveWarning('未保存:浏览器拒绝写入(存储已满或被禁用)。刷新后本次改动会丢失,请用“导出与记录”页备份测验记录 JSON。');
      return false;
    }
    $('save-warning').hidden = true;
    $('save-status').textContent = '已保存到本机浏览器';
    return true;
  }
  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) {
      warnLoad('浏览器不允许读取本地存档,本次使用默认设置。');
      return;
    }
    if (raw === null) return;
    let obj;
    try { obj = JSON.parse(raw); } catch (e) { warnLoad('本地存档不是合法 JSON,已使用默认设置;原存档保持不变,直到你下一次修改。'); return; }
    const v = C.validateState(obj);
    if (!v.ok) { warnLoad('本地存档被拒绝:' + v.error + '。已使用默认设置;原存档保持不变,直到你下一次修改。'); return; }
    S.state = obj;
    $('save-status').textContent = '已读取本机存档';
  }
  function warnLoad(text) { const el = $('load-warning'); el.textContent = text; el.hidden = false; }

  /* ---------- 计算 ---------- */
  function recompute() {
    S.computed = null; S.errors = [];
    const st = S.state;
    if (!st.generated) return;
    const r = C.parseForm(st.form, st.csvPrices);
    if (!r.ok) { S.errors = r.errors; return; }
    const s = r.settings, prices = s.prices;
    try {
      const main = C.dca(prices, { amount: s.amount, startMonth: s.startMonth, rule: s.rule });
      const cmp = C.compareRules(prices, s.amount, { startMonth: s.startMonth, threshold: s.threshold });
      const lump = C.lumpVsDca(prices, { amount: s.amount, startMonth: s.startMonth });
      S.computed = { s, prices, main, cmp, lump };
    } catch (e) {
      S.errors = [{ field: 'calc', msg: '数值无法安全计算,已停止绘制、导出与记录:' + e.message }];
    }
  }

  /* ---------- 图表 ---------- */
  function chartSvg(o) {
    const padX = 8, padY = 10, w = CHART_W, h = CHART_H;
    const pw = w - 2 * padX, ph = h - 2 * padY;
    const n = o.n;
    const x = i => padX + (n > 1 ? i / (n - 1) : 0) * pw;
    const y = v => padY + ph - (o.ymax > 0 ? Math.min(v / o.ymax, 1) : 0) * ph;
    const step = n > 1 ? pw / (n - 1) : pw;
    let g = '';
    for (let k = 0; k <= 4; k++) { const gy = (padY + ph * k / 4).toFixed(1); g += `<line class="grid" x1="${padX}" x2="${w - padX}" y1="${gy}" y2="${gy}"/>`; }
    (o.zones || []).forEach(z => {
      const x0 = Math.max(0, x(z[0]) - step / 2), x1 = Math.min(w, x(z[1]) + step / 2);
      g += `<rect class="zone" x="${x0.toFixed(1)}" y="${padY}" width="${(x1 - x0).toFixed(1)}" height="${ph}"/>`;
    });
    o.series.forEach(s => {
      const pts = [];
      const from = s.from || 0, len = s.values.length;
      const stride = Math.max(1, Math.ceil((len - from) / MAX_DRAW_POINTS)); // 点数过多时只抽样绘线,计算与导出仍用全部数据
      for (let i = from; i < len; i += stride) pts.push((pts.length ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(s.values[i]).toFixed(1));
      if (len > from && (len - 1 - from) % stride !== 0) pts.push('L' + x(len - 1).toFixed(1) + ' ' + y(s.values[len - 1]).toFixed(1));
      g += `<path id="${s.id}" class="curve ${s.cls}" d="${pts.join(' ')}"/>`;
    });
    if (o.marker !== undefined && o.marker >= 0) g += `<line class="marker" x1="${x(o.marker).toFixed(1)}" x2="${x(o.marker).toFixed(1)}" y1="${padY}" y2="${h - padY}"/>`;
    return `<svg class="chart" id="${o.id}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(o.label)}"><title>${esc(o.label)}</title>${g}</svg>`;
  }
  const maxOf = arrs => arrs.reduce((m, a) => a.reduce((mm, v) => Math.max(mm, v), m), 0);
  const legendItem = (cls, text) => `<span><i class="swatch ${cls}"></i>${esc(text)}</span>`;
  const stat = (k, v) => `<div class="stat"><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
  const yuan = c => C.fmtYuan(c) + ' 元';
  const mult = m => m === null ? '-' : m.toFixed(2) + ' 倍';

  /* ---------- 情景对照 ---------- */
  function ruleName(r) { return r.type === 'never' ? '从不停止' : (r.type === 'stop' ? `跌 ${r.threshold}% 停投` : `跌 ${r.threshold}% 清仓`); }
  function renderCompare() {
    const out = $('compare-out'), empty = $('empty-state');
    const cp = S.computed;
    if (!cp) {
      out.hidden = true; empty.hidden = false;
      $('empty-guide').hidden = S.errors.length > 0;
      $('empty-invalid').hidden = S.errors.length === 0;
      return;
    }
    empty.hidden = true; out.hidden = false;
    const { s, prices, main, cmp } = cp;
    const n = prices.length;
    const zones = C.drawdownZones(prices, s.startMonth, s.threshold);
    const pmax = Math.max.apply(null, prices);
    const priceChart = chartSvg({ id: 'chart-price', label: `价格序列,共 ${n} 个月,最低 ${Math.min.apply(null, prices).toFixed(2)},最高 ${pmax.toFixed(2)};浅红色背景为回撤达到 ${s.threshold}% 的月份`, n, ymax: pmax, zones, series: [{ id: 'path-price', cls: 's-price', values: prices }] });
    const R = cmp.rules;
    const vmax = maxOf([R.never.curve, R.stop.curve, R.sell.curve]);
    const curves = chartSvg({ id: 'chart-compare', label: `三条资金曲线:${ruleName({ type: 'never' })}、跌 ${s.threshold}% 停投、跌 ${s.threshold}% 清仓;终值分别为 ${yuan(R.never.value)}、${yuan(R.stop.value)}、${yuan(R.sell.value)}`, n, ymax: vmax, zones, series: [
      { id: 'path-never', cls: 's-never', values: R.never.curve, from: s.startMonth - 1 },
      { id: 'path-stop', cls: 's-stop', values: R.stop.curve, from: s.startMonth - 1 },
      { id: 'path-sell', cls: 's-sell', values: R.sell.curve, from: s.startMonth - 1 }] });
    const rows = [['never', '从不停止', 0], ['stop', `跌 ${s.threshold}% 停投`, cmp.diff.stopVsNever], ['sell', `跌 ${s.threshold}% 清仓`, cmp.diff.sellVsNever]];
    const tbody = rows.map(([k, name, diff]) => {
      const r = R[k];
      return `<tr data-rule="${k}"><th scope="row">${esc(name)}</th><td class="num" data-key="${k}-value" data-value="${r.value}">${yuan(r.value)}</td><td class="num">${yuan(r.cost)}</td><td class="num">${mult(r.multiple)}</td><td class="num">${C.fmtPct(r.maxDrawdown)}</td><td class="num">${r.underwaterMonths}</td><td class="num ${diff > 0 ? 'neg' : ''}">${diff === 0 ? '基准' : '少 ' + yuan(diff)}</td></tr>`;
    }).join('');
    let side;
    if (cmp.sideline) side = `清仓发生在第 ${cmp.sideline.sellMonth} 月(价格 ${cmp.sideline.sellPrice.toFixed(2)}),此后空仓 <strong id="out-months">${cmp.sideline.outMonths}</strong> 个月;其中价格已回到清仓价以上、你却不在场的有 <strong id="above-months">${cmp.sideline.aboveMonths}</strong> 个月。`;
    else side = `在 ${s.threshold}% 的阈值下,这条序列没有触发清仓,三条曲线的差别只来自停投。`;
    const trig = main.haltMonth ? `第 ${main.haltMonth} 月触发${main.rule.type === 'stop' ? '停投' : '清仓'}` : '未触发';
    out.innerHTML = `
      <div class="panel"><h2>情景对照:同一条价格序列,三种应对</h2>${curves}
        <div class="legend">${legendItem('s-never', '从不停止')}${legendItem('s-stop', `跌 ${s.threshold}% 停投`)}${legendItem('s-sell', `跌 ${s.threshold}% 清仓`)}${legendItem('zone', '回撤区')}</div>
        <p class="muted">横轴:第 1 到第 ${n} 个月;纵轴:0 到 ${C.fmtYuan(vmax)} 元(资产含清仓后的现金,不含没有投入的钱)。</p>
        <div class="table-wrap"><table id="compare-table"><thead><tr><th>规则</th><th class="num">终值</th><th class="num">累计投入</th><th class="num">倍数</th><th class="num">最大资产回撤</th><th class="num">最长水下(月)</th><th class="num">相对“从不停止”</th></tr></thead><tbody>${tbody}</tbody></table></div>
        <p class="muted" id="dd-note">最大资产回撤 = 资产曲线(持仓市值 + 清仓后的现金)相对资产历史高点的最大跌幅;最长水下 = 资产连续未回到历史高点的最长月数;倍数 = 终值 ÷ 累计投入。它们与触发停投/清仓的价格回撤(价格相对起始月之后价格高点的跌幅)分开计算。</p>
        <p class="note-box" id="sideline">${side}</p></div>
      <div class="panel"><h2>当前规则:${esc(ruleName(main.rule))}</h2>
        <dl class="stats" id="main-stats">
          ${stat('累计投入', yuan(main.cost))}${stat('持有份额', main.shares.toFixed(4))}${stat('期末资产(含清仓现金)', yuan(main.value))}
          ${stat('最终倍数', mult(main.multiple))}${stat('最大资产回撤', C.fmtPct(main.maxDrawdown))}${stat('最长水下月数', main.underwaterMonths + ' 个月')}
          ${stat('最大浮亏(相对成本)', C.fmtPct(main.maxLoss))}${stat('规则触发', esc(trig))}
        </dl></div>
      <div class="panel"><h2>价格序列</h2>${priceChart}
        <div class="legend">${legendItem('s-price', '合成价格')}${legendItem('zone', `回撤达到 ${s.threshold}% 的月份`)}</div>
        <p class="muted">横轴:第 1 到第 ${n} 个月;纵轴:0 到 ${pmax.toFixed(2)}(起始价 ${prices[0]})。</p></div>`;
  }

  /* ---------- 全部押上 ---------- */
  function renderLump() {
    const out = $('lump-out');
    const cp = S.computed;
    if (!cp) { out.innerHTML = '<div class="empty"><p>先在左侧生成一条有效的价格序列。</p></div>'; return; }
    const { s, prices, lump } = cp;
    const d = lump.dca, l = lump.lump, n = prices.length;
    const vmax = maxOf([d.curve, l.curve]);
    const zones = C.drawdownZones(prices, s.startMonth, s.threshold);
    const chart = chartSvg({ id: 'chart-lump', label: `一次性全投与每月定投的资产曲线;全投最大资产回撤 ${C.fmtPct(l.maxDrawdown)},定投 ${C.fmtPct(d.maxDrawdown)}`, n, ymax: vmax, zones, series: [
      { id: 'path-dca', cls: 's-never', values: d.curve, from: s.startMonth - 1 },
      { id: 'path-lump', cls: 's-stop', values: l.curve, from: s.startMonth - 1 }] });
    const row = (name, r) => `<tr><th scope="row">${name}</th><td class="num">${yuan(r.cost)}</td><td class="num">${yuan(r.value)}</td><td class="num">${mult(r.multiple)}</td><td class="num">${C.fmtPct(r.maxDrawdown)}</td><td class="num">${C.fmtPct(r.maxLoss)}</td><td class="num">${r.underwaterMonths}</td></tr>`;
    const lessDd = l.maxDrawdown > d.maxDrawdown;
    out.innerHTML = `<div class="panel"><h2>全部押上 vs 每月定投</h2>
      <p>两种方式的总投入相同(= 定投累计投入 ${yuan(d.cost)});全投在第 ${s.startMonth} 月一次性买入。</p>
      ${chart}
      <div class="legend">${legendItem('s-never', '每月定投')}${legendItem('s-stop', '一次性全投')}${legendItem('zone', `回撤达到 ${s.threshold}% 的月份`)}</div>
      <div class="table-wrap"><table id="lump-table"><thead><tr><th>方式</th><th class="num">总投入</th><th class="num">终值</th><th class="num">倍数</th><th class="num">最大资产回撤</th><th class="num">最大浮亏</th><th class="num">最长水下(月)</th></tr></thead><tbody>${row('每月定投', d)}${row('一次性全投', l)}</tbody></table></div>
      <p class="note-box" id="lump-note">在这条序列上,全投的最大资产回撤为 ${C.fmtPct(l.maxDrawdown)},定投为 ${C.fmtPct(d.maxDrawdown)}${lessDd ? ',全投更深' : ',全投没有更深'};终值相差 ${yuan(Math.abs(lump.valueGap))}(${lump.valueGap >= 0 ? '全投更高' : '定投更高'})。这只是一条合成序列上的结果,换一个种子结论可能反过来。</p></div>`;
  }

  /* ---------- 耐力测验 ---------- */
  function stopAuto() { if (S.auto) { clearInterval(S.auto); S.auto = null; } $('quiz-auto').setAttribute('aria-pressed', 'false'); $('quiz-auto').textContent = '自动播放'; }
  function startQuiz() {
    S.quizError = null;
    const cp = S.computed; if (!cp) return;
    stopAuto();
    S.quiz = C.newReplay(cp.prices, { amount: cp.s.amount, startMonth: cp.s.startMonth, threshold: cp.s.quizThreshold });
    S.quizSaved = null;
    renderQuiz();
  }
  function quizStep(choice) {
    if (!S.quiz) return;
    try { S.quiz = C.replayStep(S.quiz, choice); } catch (e) { stopAuto(); S.quizError = e.message; renderQuiz(); return; }
    if (S.quiz.pending || S.quiz.done) stopAuto();
    if (S.quiz.done) finishQuiz();
    renderQuiz();
  }
  function finishQuiz() {
    const cp = S.computed, q = S.quiz;
    let res;
    try { res = C.replayResult(q, cp.s.rule); } catch (e) { S.quizSaved = '结果数值无法安全计算,没有写入历史记录:' + e.message; return; }
    const recs = S.state.records;
    let k = recs.length + 1;
    while (recs.some(r => r.id === `q-${today}-${k}`)) k += 1;
    const rec = {
      id: `q-${today}-${k}`, date: today, source: cp.s.source === 'csv' ? 'csv' : 'synthetic',
      seed: cp.s.source === 'csv' ? null : cp.s.gen.seed, months: cp.prices.length, amount: cp.s.amount, threshold: cp.s.quizThreshold,
      choices: q.choices.map(c => ({ month: c.month, drawdown: c.drawdown, choice: c.choice })),
      behaviorValue: res.behavior.value, ruleValue: res.rule.value, cost: res.behavior.cost,
      behaviorMaxDrawdown: res.behavior.maxDrawdown, ruleMaxDrawdown: res.rule.maxDrawdown
    };
    S.state.records = recs.concat([rec]);
    S.quizSaved = save() ? '本次测验已记入历史记录。' : '本次测验结果已显示,但没能写入本机存档。';
    renderData();
  }
  function renderQuiz() {
    const out = $('quiz-out'), bar = $('quiz-bar'), cp = S.computed, q = S.quiz;
    document.body.classList.remove('has-bar');
    if (!cp) { out.innerHTML = '<div class="empty"><p>先在左侧生成一条有效的价格序列,再开始测验。</p></div>'; bar.hidden = true; return; }
    const s = cp.s, n = cp.prices.length;
    if (!q) {
      bar.hidden = true;
      out.innerHTML = `<div class="panel"><h2>耐力测验</h2>
        <p>价格会按月逐月揭晓,每月你只需要点“前进一月”。当价格相对高点的回撤达到 <strong>${s.quizThreshold}%</strong> 时,会停下来让你选:继续、停投或清仓。结束后把“你的行为曲线”和“规则曲线(${esc(ruleName(s.rule))})”放在一起比较。</p>
        <p class="muted">共 ${n} 个月,每月 ${yuan(s.amount)},从第 ${s.startMonth} 月开始。同一个种子每次看到的价格完全相同;测验的目的是看你的反应,不是猜价格。</p>
        <div class="row"><button type="button" id="quiz-start" class="primary">开始测验</button></div></div>`;
      return;
    }
    const m = q.month;
    const shown = q.prices.slice(0, Math.max(m + 1, 0));
    const pmax = Math.max.apply(null, cp.prices);
    if (!q.done) {
      bar.hidden = false;
      document.body.classList.toggle('has-bar', S.tab === 'quiz');
      $('quiz-controls').hidden = !!q.pending;
      $('quiz-prompt').hidden = !q.pending;
      if (q.pending) $('quiz-prompt-text').textContent = `第 ${q.pending.month} 月:价格较高点已下跌 ${C.fmtPct(q.pending.drawdown)},达到提醒阈值 ${s.quizThreshold}%。你选择?`;
      const dd = m >= 0 && q.peak > 0 ? 1 - q.prices[m] / q.peak : 0;
      const value = q.curve.length ? q.curve[q.curve.length - 1] : 0;
      const chart = chartSvg({ id: 'chart-quiz', label: `已揭晓的价格,当前第 ${m + 1} 月`, n, ymax: pmax, marker: m >= 0 ? m : undefined, series: [{ id: 'path-quiz-price', cls: 's-price', values: shown }] });
      out.innerHTML = `<div class="panel"><h2>测验进行中</h2>
        <dl class="stats" id="quiz-stats">${stat('进度', `<span id="quiz-month">${Math.max(m + 1, 0)}</span> / ${n} 月`)}${stat('当前价格', m >= 0 ? q.prices[m].toFixed(2) : '-')}${stat('当前回撤', C.fmtPct(dd))}${stat('累计投入', yuan(q.cost))}${stat('资产', yuan(value))}${stat('状态', q.status === 'active' ? '正常定投' : (q.status === 'stopped' ? '已停投' : '已清仓'))}</dl>
        ${chart}
        ${S.quizError ? `<p class="note-box">${esc(S.quizError)}</p>` : ''}
        <p class="muted">已做出 ${q.choices.length} 次选择。回撤从起始月之后的价格高点算起;一次回撤只提醒一次,价格回到阈值以内再跌破才会再次提醒。</p></div>`;
      return;
    }
    bar.hidden = true;
    let res;
    try { res = C.replayResult(q, s.rule); } catch (e) {
      out.innerHTML = `<div class="panel"><h2>测验结果无法显示</h2><p class="note-box">${esc(S.quizSaved || e.message)}</p><div class="row"><button type="button" id="quiz-start" class="primary">再测一次</button></div></div>`;
      return;
    }
    const vmax = maxOf([res.behavior.curve, res.rule.curve]);
    const zones = C.drawdownZones(cp.prices, s.startMonth, s.quizThreshold);
    const chart = chartSvg({ id: 'chart-quiz-result', label: `你的行为曲线终值 ${yuan(res.behavior.value)},规则曲线终值 ${yuan(res.rule.value)}`, n, ymax: vmax, zones, series: [
      { id: 'path-rule', cls: 's-never', values: res.rule.curve, from: s.startMonth - 1 },
      { id: 'path-behavior', cls: 's-stop', values: res.behavior.curve, from: s.startMonth - 1 }] });
    const list = q.choices.length ? '<ul>' + q.choices.map(c => `<li>第 ${esc(c.month)} 月(价格回撤 ${C.fmtPct(c.drawdown)}):<strong>${esc(C.CHOICE_LABEL[c.choice])}</strong></li>`).join('') + '</ul>' : '<p>这次没有触发回撤提醒。</p>';
    out.innerHTML = `<div class="panel"><h2>测验结果</h2>
      ${chart}
      <div class="legend">${legendItem('s-stop', '你的行为曲线')}${legendItem('s-never', `规则曲线(${ruleName(s.rule)})`)}${legendItem('zone', `回撤达到 ${s.quizThreshold}% 的月份`)}</div>
      <dl class="stats" id="quiz-result">${stat('你的终值', yuan(res.behavior.value))}${stat('规则终值', yuan(res.rule.value))}${stat('差额(你 - 规则)', `<span class="${res.diff < 0 ? 'neg' : ''}">${res.diff < 0 ? '-' : ''}${yuan(Math.abs(res.diff))}</span>`)}${stat('你的最大资产回撤', C.fmtPct(res.behavior.maxDrawdown))}${stat('规则最大资产回撤', C.fmtPct(res.rule.maxDrawdown))}</dl>
      <h3>你的选择</h3>${list}
      <p class="muted" id="quiz-saved">${esc(S.quizSaved || '')}</p>
      <div class="row"><button type="button" id="quiz-start" class="primary">再测一次</button></div></div>`;
  }

  /* ---------- 导出与记录 ---------- */
  function paramRows() {
    const cp = S.computed, f = S.state.form, s = cp.s;
    const rows = [['数据来源', s.source === 'csv' ? `自备 CSV(${cp.prices.length} 个月)` : '合成生成']];
    if (s.source !== 'csv') {
      rows.push(['年数', String(s.gen.years)], ['年化漂移', s.gen.drift + '%'], ['年化波动', s.gen.vol + '%'], ['随机种子', String(s.gen.seed)]);
      rows.push(['崩盘', s.gen.crashes.length ? s.gen.crashes.map(c => `第${c.start}月起${c.months}个月跌${c.drop}%`).join(';') : '无']);
    }
    rows.push(['每月定投(元)', C.fmtYuan(s.amount)], ['起始月', '第 ' + s.startMonth + ' 月'], ['当前规则', ruleName(s.rule)], ['回撤阈值', s.threshold + '%'], ['测验提醒阈值', s.quizThreshold + '%']);
    return rows;
  }
  function buildMarkdown() {
    const cp = S.computed;
    return C.toMarkdown({ sample: S.state.sample, date: today, params: paramRows(), compare: cp.cmp, lump: cp.lump, records: S.state.records });
  }
  function renderData() {
    const has = !!S.computed;
    $('export-csv').disabled = !has; $('export-md').disabled = !has;
    $('export-note').textContent = has ? '导出内容与当前界面一致。' : '尚未生成有效的价格序列(或左侧输入有误),序列 CSV 与 Markdown 小结已禁用;测验记录 JSON 随时可导出。';
    $('md-preview').textContent = has ? buildMarkdown() : '(生成价格序列后,这里显示 Markdown 小结预览)';
    const recs = S.state.records;
    $('record-count').textContent = String(recs.length);
    $('record-count').dataset.count = String(recs.length);
    if (!recs.length) { $('records-out').innerHTML = '<p class="muted">还没有记录。去“耐力测验”走完一次,结果会自动记在这里。</p>'; return; }
    const tr = recs.slice().reverse().map(r => {
      const pick = r.choices.length ? r.choices.map(c => `第${esc(c.month)}月${esc(C.CHOICE_LABEL[c.choice])}`).join('、') : '未触发提醒';
      const diff = r.behaviorValue - r.ruleValue;
      return `<tr><td>${esc(r.date)}</td><td>${r.source === 'csv' ? '自备 CSV' : '种子 ' + esc(r.seed)}</td><td class="num">${esc(r.threshold)}%</td><td>${esc(pick)}</td><td class="num">${C.fmtYuan(r.behaviorValue)}</td><td class="num">${C.fmtYuan(r.ruleValue)}</td><td class="num ${diff < 0 ? 'neg' : ''}">${diff < 0 ? '-' : ''}${C.fmtYuan(Math.abs(diff))}</td></tr>`;
    }).join('');
    $('records-out').innerHTML = `<div class="table-wrap"><table id="records-table"><thead><tr><th>日期</th><th>序列</th><th class="num">提醒阈值</th><th>选择</th><th class="num">你的终值(元)</th><th class="num">规则终值(元)</th><th class="num">差额(元)</th></tr></thead><tbody>${tr}</tbody></table></div>`;
  }
  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function exportCsv() {
    if (!S.computed) return;
    const R = S.computed.cmp.rules;
    const csv = C.toCsv({ sample: S.state.sample, prices: S.computed.prices, series: [{ name: '从不停止', values: R.never.curve }, { name: `跌${S.computed.s.threshold}%停投`, values: R.stop.curve }, { name: `跌${S.computed.s.threshold}%清仓`, values: R.sell.curve }] });
    download(`定投耐力-序列与曲线-${today}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
  }
  function exportMd() { if (S.computed) download(`定投耐力-小结-${today}.md`, buildMarkdown(), 'text/markdown;charset=utf-8'); }
  function exportJson() { download(`定投耐力-测验记录-${today}.json`, C.recordsToJson(S.state.records, today), 'application/json'); }

  function applyImport(text, msgEl) {
    const r = C.validateImport(text);
    if (!r.ok) { msgEl.textContent = '导入被拒绝,现有数据没有改动:' + r.error; return false; }
    if (r.kind === 'prices') {
      const apply = () => {
        S.state.csvPrices = r.prices;
        S.state.form.source = 'csv';
        S.state.generated = true;
        S.state.sample = null;
        msgEl.textContent = `已导入 ${r.prices.length} 个月的价格。`;
        afterFormReplaced();
      };
      const quizOn = !!(S.quiz && !S.quiz.done);
      if (S.state.generated || S.state.csvPrices !== null || quizOn) {
        const cur = S.computed ? S.computed.prices.length + ' 个月' : (S.state.csvPrices ? S.state.csvPrices.length + ' 个月' : '当前设定');
        askConfirm(`导入会把当前价格序列(${cur})替换为这份 ${r.prices.length} 个月的价格${quizOn ? ',并丢弃未完成的耐力测验' : ''};已完成的 ${S.state.records.length} 条测验记录保留。确认前不会改动现有数据。`, apply);
        msgEl.textContent = '已通过校验(' + r.prices.length + ' 个月),等待你确认替换。';
        return true;
      }
      apply();
      return true;
    }
    const m = C.mergeRecords(S.state.records, r.records);
    if (!m.ok) { msgEl.textContent = '导入被拒绝,现有数据没有改动:' + m.error; return false; }
    S.state.records = m.records;
    save();
    renderData();
    msgEl.textContent = `已导入测验记录:新增 ${m.added} 条,重复且相同的已跳过。`;
    return true;
  }

  /* ---------- 页内确认 ---------- */
  function askConfirm(text, yes) {
    $('confirm-msg').textContent = text;
    S.confirmYes = yes;
    $('confirm-zone').hidden = false;
    $('confirm-yes').focus();
  }
  function closeConfirm() { S.confirmYes = null; $('confirm-zone').hidden = true; }
  const formCustom = () => JSON.stringify(S.state.form) !== JSON.stringify(C.defaultForm());
  const hasUserData = () => S.state.generated || S.state.csvPrices !== null || S.state.records.length > 0 || formCustom();

  function requestSample(id) {
    const smp = (globalThis.DCA_SAMPLES || []).find(x => x.id === id);
    if (!smp) return;
    if (hasUserData()) askConfirm(`载入“${smp.name}”会替换当前的设定${formCustom() ? '(含你已改动但尚未生成的参数)' : ''}${S.state.csvPrices ? '、导入的 ' + S.state.csvPrices.length + ' 个月价格' : ''}和价格序列;${S.state.records.length} 条测验记录会保留。确认前不会改动现有数据。确认替换?`, () => loadSample(smp));
    else loadSample(smp);
  }
  function loadSample(smp) {
    S.state.form = JSON.parse(JSON.stringify(smp.form));
    S.state.csvPrices = null;
    if (smp.csv) { const r = C.validateImport(smp.csv, 'prices'); if (r.ok) S.state.csvPrices = r.prices; }
    S.state.generated = true;
    S.state.sample = smp.name.slice(0, 40);
    $('csv-msg').textContent = smp.csv ? '已载入合成示例 CSV。' : '';
    afterFormReplaced();
  }
  function afterFormReplaced() {
    stopAuto(); S.quiz = null;
    renderForm(); recompute(); renderAll(); save();
  }

  /* ---------- 表单 ---------- */
  function renderForm() {
    const f = S.state.form;
    ['years', 'drift', 'vol', 'seed', 'amount', 'startMonth', 'threshold', 'quizThreshold'].forEach(k => { $('f-' + k).value = f[k]; });
    $('f-ruleType').value = f.ruleType;
    $('f-source-synthetic').checked = f.source === 'synthetic';
    $('f-source-csv').checked = f.source === 'csv';
    $('synthetic-fields').hidden = f.source !== 'synthetic';
    $('csv-fields').hidden = f.source !== 'csv';
    renderCrashes();
  }
  function renderCrashes() {
    const list = $('crash-list');
    const cr = S.state.form.crashes;
    list.innerHTML = cr.map((c, i) => `<div class="crash-row" data-i="${i}">
      <label>第几月起<input data-crash="start" inputmode="numeric" maxlength="40" value="${esc(c.start)}" aria-label="第 ${i + 1} 次崩盘起始月"></label>
      <label>持续月数<input data-crash="months" inputmode="numeric" maxlength="40" value="${esc(c.months)}" aria-label="第 ${i + 1} 次崩盘持续月数"></label>
      <label>累计跌(%)<input data-crash="drop" inputmode="decimal" maxlength="40" value="${esc(c.drop)}" aria-label="第 ${i + 1} 次崩盘跌幅"></label>
      <button type="button" data-remove="${i}" aria-label="删除第 ${i + 1} 次崩盘">删除</button></div>`).join('');
    $('crash-add').disabled = cr.length >= C.LIMITS.crashMax;
  }
  function formChanged() {
    stopAuto(); S.quiz = null; S.state.sample = null;
    recompute(); renderAll(); save();
  }
  function onField(e) {
    const t = e.target;
    const f = S.state.form;
    if (t.dataset.field) {
      if (t.type === 'radio') { if (!t.checked) return; f.source = t.value; $('synthetic-fields').hidden = t.value !== 'synthetic'; $('csv-fields').hidden = t.value !== 'csv'; }
      else f[t.dataset.field] = t.value;
      formChanged();
    } else if (t.dataset.crash) {
      const row = t.closest('.crash-row');
      f.crashes[Number(row.dataset.i)][t.dataset.crash] = t.value;
      formChanged();
    }
  }

  /* ---------- 总渲染 ---------- */
  function errorTarget(e) {
    if (e.field === 'gen') {
      const m = e.msg;
      return /崩盘/.test(m) ? document.querySelector('#crash-list input') : $(/年数/.test(m) ? 'f-years' : /漂移/.test(m) ? 'f-drift' : /波动/.test(m) ? 'f-vol' : /种子/.test(m) ? 'f-seed' : 'f-years');
    }
    if (e.field === 'csv') return $('csv-text');
    return $('f-' + e.field);
  }
  function renderErrors() {
    const el = $('form-errors');
    el.hidden = S.errors.length === 0;
    el.innerHTML = S.errors.map(e => `<li>${esc(e.msg)}</li>`).join('');
    document.querySelectorAll('#settings-form [aria-invalid]').forEach(n => n.removeAttribute('aria-invalid'));
    S.errors.forEach(e => { const t = errorTarget(e); if (t) { t.setAttribute('aria-invalid', 'true'); if (!t.getAttribute('aria-describedby')) t.setAttribute('aria-describedby', 'form-errors'); } });
  }
  function renderTabs() {
    document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === S.tab)));
    ['compare', 'quiz', 'lump', 'data'].forEach(k => { $('panel-' + k).hidden = k !== S.tab; });
  }
  function renderBanners() {
    const sb = $('sample-banner');
    sb.hidden = !S.state.sample;
    if (S.state.sample) sb.textContent = '合成示例:' + S.state.sample + '。当前价格与结果都来自合成示例,不是真实行情;修改任何设定后这条标记会消失。';
    const tn = $('today-note');
    let fixed = null;
    try { fixed = new URLSearchParams(location.search).get('today'); } catch (e) { fixed = null; }
    tn.hidden = !(fixed && fixed === today);
    if (!tn.hidden) tn.textContent = '基准日 ' + today + '(由地址参数固定):测验记录与导出文件使用这个日期。';
  }
  function renderAll() {
    renderBanners(); renderErrors(); renderTabs(); renderCompare(); renderLump(); renderQuiz(); renderData();
  }

  /* ---------- 事件 ---------- */
  function init() {
    load();
    renderForm(); recompute(); renderAll();
    const form = $('settings-form');
    form.addEventListener('input', onField);
    form.addEventListener('change', onField);
    form.addEventListener('submit', e => e.preventDefault());
    form.addEventListener('click', e => {
      const rm = e.target.closest('[data-remove]');
      if (rm) { S.state.form.crashes.splice(Number(rm.dataset.remove), 1); renderCrashes(); formChanged(); const nb = document.querySelector('#crash-list [data-remove]'); (nb || $('crash-add')).focus(); }
    });
    $('crash-add').addEventListener('click', () => {
      if (S.state.form.crashes.length >= C.LIMITS.crashMax) return;
      const last = S.state.form.crashes.length;
      S.state.form.crashes.push({ start: String(24 + last * 36), months: '6', drop: '40' });
      renderCrashes(); formChanged();
    });
    $('seed-random').addEventListener('click', () => {
      S.state.form.seed = String(Math.floor(Math.random() * 4294967296));
      $('f-seed').value = S.state.form.seed; formChanged();
    });
    $('generate').addEventListener('click', () => {
      S.state.generated = true; stopAuto(); S.quiz = null; recompute(); renderAll(); save();
      if (S.errors.length) { const t = errorTarget(S.errors[0]); if (t) t.focus(); }
    });
    ['a', 'b', 'c'].forEach(id => $('sample-' + id).addEventListener('click', () => requestSample(id)));
    $('confirm-yes').addEventListener('click', () => { const fn = S.confirmYes; closeConfirm(); if (fn) fn(); });
    $('confirm-no').addEventListener('click', closeConfirm);
    $('goto-import').addEventListener('click', () => { S.tab = 'data'; renderTabs(); renderQuiz(); $('import-text').focus(); });
    $('warn-export').addEventListener('click', exportJson);

    document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { S.tab = b.dataset.tab; renderTabs(); renderQuiz(); }));

    $('panel-quiz').addEventListener('click', e => {
      const id = e.target.id;
      if (id === 'quiz-start') startQuiz();
    });
    $('quiz-next').addEventListener('click', () => quizStep('next'));
    $('quiz-continue').addEventListener('click', () => quizStep('continue'));
    $('quiz-stop').addEventListener('click', () => quizStep('stop'));
    $('quiz-sell').addEventListener('click', () => quizStep('sell'));
    $('quiz-reset').addEventListener('click', () => { stopAuto(); S.quiz = null; renderQuiz(); });
    $('quiz-auto').addEventListener('click', () => {
      if (S.auto) { stopAuto(); return; }
      if (!S.quiz || S.quiz.done || S.quiz.pending) return;
      $('quiz-auto').setAttribute('aria-pressed', 'true'); $('quiz-auto').textContent = '暂停播放';
      S.auto = setInterval(() => quizStep('next'), 500);
    });

    $('export-csv').addEventListener('click', exportCsv);
    $('export-md').addEventListener('click', exportMd);
    $('export-json').addEventListener('click', exportJson);
    $('csv-apply').addEventListener('click', () => applyImport($('csv-text').value, $('csv-msg')) );
    const readFile = (input, target) => input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const rd = new FileReader();
      rd.onload = () => { target.value = String(rd.result); };
      rd.readAsText(file);
    });
    readFile($('csv-file'), $('csv-text'));
    readFile($('import-file'), $('import-text'));
    $('import-apply').addEventListener('click', () => applyImport($('import-text').value, $('import-msg')));
    $('clear-all').addEventListener('click', () => askConfirm(`清空会删除本机存档里的全部设定、${S.state.csvPrices ? '导入的 ' + S.state.csvPrices.length + ' 个月价格、' : ''}${S.state.records.length} 条测验记录,且无法恢复。建议先导出测验记录 JSON。确认清空?`, () => {
      try { localStorage.removeItem(KEY); } catch (e) { /* 读写失败时界面状态仍然清空 */ }
      S.state = C.defaultState();
      $('import-msg').textContent = ''; $('csv-msg').textContent = ''; $('csv-text').value = ''; $('import-text').value = '';
      $('save-status').textContent = '已清空,尚未保存';
      afterFormReplaced();
    }));
  }
  init();
})();
