'use strict';
(function () {
  const C = globalThis.MarginCore;
  const KEY = 'margin.v1';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = C.resolveToday(location.search, C.localDateString(new Date()));
  const DEFAULT_OPP = 15000; // 新数据的默认机会成本时薪:150 元/小时,用户可改

  let state = { version: 2, settings: { opportunityHourly: DEFAULT_OPP }, projects: [] };
  const ui = { currentId: null, tab: 'projects', mdId: null, scen: { id: null, hourly: 0, discount: 0 }, pendingImport: null, blocked: false };

  // ---------- 存储 ----------
  function showBanner(text, discardButton) {
    const b = $('save-banner');
    b.textContent = text;
    if (discardButton) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'btn btn-danger'; btn.id = 'discard-store'; btn.textContent = '丢弃本机存档,从空白开始';
      btn.addEventListener('click', () => {
        try { localStorage.removeItem(KEY); } catch (e) { /* 仍会在 save() 里报告 */ }
        ui.blocked = false; save(); renderAll();
      });
      b.append(' ', btn);
    }
    b.hidden = false;
    setSaveLabel('未保存', true);
  }
  function setSaveLabel(text, bad) {
    const s = $('save-state');
    s.textContent = text; s.classList.toggle('is-bad', !!bad);
  }
  // 返回是否真正写入;失败时提示一直可见,直到之后某次写入成功
  function save() {
    if (ui.blocked) return false;
    const v = C.validateState(state);
    if (!v.ok) { showBanner('未保存:当前数据没有通过校验(' + v.error + ')。请先下载 JSON 备份再检查。'); return false; }
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { showBanner('未保存:浏览器存储不可用或已满,本次改动只在当前页面里,刷新会丢失。请立刻到「导出与数据」下载 JSON 备份。'); return false; }
    $('save-banner').hidden = true;
    setSaveLabel('已保存到本机 ' + new Date().toTimeString().slice(0, 8), false);
    return true;
  }
  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { showBanner('本机存储不可用:数据无法保存。请随时到「导出与数据」下载 JSON 备份。'); return; }
    if (!raw) return;
    let v;
    try { v = C.validateImport(raw); } catch (e) { v = { ok: false, error: String(e.message) }; }
    if (v.ok) { state = v.state; ui.currentId = state.projects.length ? state.projects[0].id : null; }
    else { ui.blocked = true; showBanner('本机存档无法读取(' + v.error + '),为了不覆盖它,暂时不会保存新改动。', true); }
  }

  // ---------- 通用 ----------
  const project = () => state.projects.find(p => p.id === ui.currentId) || null;
  const money = c => C.formatMoney(c);
  const inputMoney = c => (c % 100 === 0 ? String(c / 100) : C.moneyPlain(c));
  const negCls = n => (n !== null && n < 0 ? ' neg' : '');
  const STATUS_CLS = { 报价中: '', 进行中: 'badge-progress', 已交付: 'badge-warn', 已收款: 'badge-done', 已取消: 'badge-bad' };
  const badge = st => `<span class="badge ${STATUS_CLS[st] || ''}">${esc(st)}</span>`;
  const safeName = s => (String(s || '').trim() || '未命名').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 60);
  function download(name, text, type) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(new Blob([text], { type: type || 'text/plain;charset=utf-8' }));
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  // 尝试修改一个字段:改后整份状态仍须通过校验,否则回滚并返回原因
  function setField(obj, key, val) {
    const old = obj[key];
    obj[key] = val;
    const v = C.validateState(state);
    if (!v.ok) { obj[key] = old; return v.error; }
    return null;
  }
  function showErr(input, msg) {
    const label = input.closest('label') || input.parentElement;
    let span = label.querySelector('.field-error');
    if (!span) { span = document.createElement('span'); span.className = 'field-error'; label.appendChild(span); }
    span.textContent = msg || ''; span.hidden = !msg;
    if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    updateExportGuard();
  }
  // 任一输入框有未通过校验的文本时,界面上的值与已保存的值不一致,此时禁止导出
  const hasInvalidInput = () => !!document.querySelector('[aria-invalid="true"]');
  function updateExportGuard() {
    const bad = hasInvalidInput();
    const has = state.projects.length > 0;
    for (const id of ['export-csv', 'export-md', 'export-json']) $(id).disabled = bad || !has;
    const note = $('export-block');
    note.hidden = !bad;
    note.textContent = bad ? '有输入框的内容没有通过校验(已标红),项目里保留的还是修改前的旧值。请先改正标红的输入,或切换项目撤销该输入,再导出。' : '';
  }
  // 解析 + 落盘。kind: money | num | text
  function applyInput(input, obj, key, kind, opts) {
    let val;
    if (kind === 'money') { val = C.parseMoney(input.value); if (Number.isNaN(val)) return showErr(input, '请输入不超过 100 亿的非负金额,最多两位小数'); }
    else if (kind === 'num') {
      val = C.parseNumber(input.value, opts);
      if (Number.isNaN(val)) return showErr(input, `请输入 0 到 ${opts.max} 的数字` + (opts.dp ? `,最多 ${opts.dp} 位小数` : '(整数)'));
    } else val = input.value;
    const err = setField(obj, key, val);
    if (err) return showErr(input, err);
    showErr(input, '');
    save();
    return true;
  }

  // ---------- 项目列表 ----------
  function renderList() {
    const box = $('project-list');
    $('empty-guide').hidden = state.projects.length > 0;
    box.innerHTML = state.projects.map(p => {
      const m = C.margin(p);
      const od = C.isOverdue(p, today);
      return `<button type="button" class="project-item" data-id="${esc(p.id)}" ${p.id === ui.currentId ? 'aria-current="true"' : ''}>
        <span class="pi-top"><span>${esc(C.nameOf(p))}</span><span class="${negCls(m.rate)}">${esc(C.formatPct(m.rate))}</span></span>
        <span class="pi-sub">${esc(C.clientOf(p))} ${badge(p.status)}${od ? ' <span class="badge badge-bad">逾期</span>' : ''}${m.belowOpportunity ? ' <span class="badge badge-warn">低于机会成本</span>' : ''}</span>
      </button>`;
    }).join('');
  }

  // ---------- 编辑区 ----------
  function fillForm() {
    const p = project();
    $('editor').hidden = !p;
    if (!p) return;
    $('f-name').value = p.name; $('f-client').value = p.client; $('f-status').value = p.status;
    $('f-quote').value = inputMoney(p.quote);
    $('f-tax-included').value = p.taxIncluded ? 'yes' : 'no';
    $('f-tax-rate').value = String(p.taxRate); $('f-tax-rate').disabled = !p.taxIncluded;
    $('f-start').value = p.startDate; $('f-deliver').value = p.deliverDate;
    $('f-prepaid').value = String(p.prepaidPct); $('f-term').value = String(p.termDays);
    $('f-opp').value = inputMoney(p.opportunityHourly);
    for (const el of document.querySelectorAll('.form-grid input, .form-grid select')) showErr(el, '');
    $('delete-confirm').hidden = true;
    renderLines();
    renderActual();
  }

  function lineHtml(l) {
    const num = (f, label, val) => `<label class="field">${label}<input type="text" inputmode="decimal" data-f="${f}" value="${esc(val)}" autocomplete="off"></label>`;
    let fields = '';
    if (l.type === 'labor') fields = num('hours', '小时', l.hours) + num('rate', '时薪(元/小时)', inputMoney(l.rate));
    else if (l.type === 'tool') fields = num('monthlyFee', '月费(元)', inputMoney(l.monthlyFee)) + num('months', '占用月数', l.months) + num('share', '分摊比例(%)', l.share);
    else fields = num('amount', '金额(元)', inputMoney(l.amount));
    const opts = C.TYPES.map(t => `<option value="${t.id}" ${t.id === l.type ? 'selected' : ''}>${esc(t.label)}</option>`).join('');
    return `<div class="line" data-line="${esc(l.id)}">
      <label class="field">类型<select data-f="type">${opts}</select></label>
      ${fields}
      <label class="field">备注<input type="text" data-f="note" value="${esc(l.note)}" autocomplete="off"></label>
      <div class="field">小计<span class="line-amount" data-amount>${esc(money(C.lineAmount(l)))}</span></div>
      <div class="line-actions"><button type="button" class="btn btn-small btn-quiet-danger" data-del="${esc(l.id)}">删除</button></div>
    </div>`;
  }
  function renderLines() {
    const p = project();
    $('lines').innerHTML = p && p.lines.length ? p.lines.map(lineHtml).join('') : '<p class="muted">还没有成本行。点下面的类型按钮添加。</p>';
  }
  const LINE_PARSE = {
    hours: ['num', { max: 1000000, dp: 2 }], months: ['num', { max: 1200, dp: 2 }], share: ['num', { max: 100, dp: 2 }],
    rate: ['money'], monthlyFee: ['money'], amount: ['money'], note: ['text']
  };

  function renderResult() {
    const p = project();
    const box = $('result');
    if (!p) { box.innerHTML = ''; return; }
    const m = C.margin(p), due = C.dueDate(p), od = C.isOverdue(p, today), a = C.actualComparison(p);
    const flags = [];
    if (m.rate === null) flags.push('<span class="flag">报价为 0,无法计算毛利率</span>');
    if (m.belowOpportunity) flags.push(`<span class="flag flag-warn">每小时毛利低于机会成本时薪(${esc(money(p.opportunityHourly))} 元/小时)</span>`);
    else if (m.perHour !== null) flags.push('<span class="flag flag-ok">每小时毛利不低于机会成本时薪</span>');
    if (m.perHour === null) flags.push('<span class="flag">没有人工小时,不计算每小时毛利</span>');
    if (od) flags.push('<span class="flag flag-bad">回款已逾期</span>');
    else if (p.status === '已收款') flags.push('<span class="flag flag-ok">已收款</span>');
    const stat = (k, v, cls, main) => `<div class="stat${main ? ' stat-main' : ''}"><span class="k">${k}</span><span class="v${cls || ''}">${esc(v)}</span></div>`;
    box.innerHTML = `<div class="flags">${flags.join('')}</div>
      <div class="stats">
        ${stat('不含税收入(元)', money(m.revenue))}
        ${stat('直接成本(元)', money(m.cost))}
        ${stat('毛利(元)', money(m.gross), negCls(m.gross), true)}
        ${stat('毛利率', C.formatPct(m.rate), negCls(m.rate), true)}
        ${stat('总人工小时', String(m.hours))}
        ${stat('每小时毛利(元)', m.perHour === null ? '—' : money(m.perHour), negCls(m.perHour))}
        ${stat('预计回款日', due || '缺日期')}
        ${stat('尾款金额(元)', money(C.tailAmount(p)))}
      </div>
      <p class="muted">毛利 = 不含税收入 − 直接成本(直接成本已含人工费)。每小时毛利 = 毛利 ÷ 总人工小时,它是「扣掉人工费之后」每个人工小时还剩多少,不是你的实际时薪;用它和「机会成本时薪」(你把这些小时花在别处能赚的钱)比较,低于后者就说明这个项目不如把时间花在别处。</p>
      <p class="muted">预计回款日 = 交付日期 + 尾款账期天数(预付 100% 时取开始日期)。回款日早于今天(${esc(today)})且状态不是「已收款」「已取消」算逾期。</p>
      <h3>估算与实际</h3>
      <div class="stats">
        ${stat('已知实际工时', a.known.minutes + ' 分钟')}
        ${stat('已知实际成本', money(a.known.cost) + ' ' + (p.currency || 'CNY'))}
        ${stat('已知实收', money(a.known.collected) + ' ' + (p.currency || 'CNY'))}
        ${stat('实际毛利偏差', a.variance ? money(a.variance.gross) : '未知', a.variance ? negCls(a.variance.gross) : '')}
      </div>
      <p class="muted">${a.variance ? `已按锁定基线 v${a.baseline.version} 比较。收入偏差 ${esc(money(a.variance.revenue))}，成本偏差 ${esc(money(a.variance.cost))}。` : '偏差未显示。必须先锁定基线、保证所有记录币种一致，并明确声明实际记录完整。报价不是实收；只有“实际收款”记录计入已知实收。'}</p>`;
  }

  function renderActual() {
    const p = project();
    if (!p) return;
    const versions = p.baselineVersions || [], active = versions.find(x => x.id === p.activeBaselineId), a = C.actualComparison(p);
    $('baseline-summary').innerHTML = versions.length
      ? `<p><strong>活动版本:</strong> ${active ? `v${active.version} · ${active.lockedAt ? `已锁定 ${esc(active.lockedAt)}` : '草稿，等待锁定'}` : '无'}。历史版本 ${versions.length} 个。</p>`
      : '<p><strong>还没有估算基线。</strong>当前报价和成本仍可编辑；锁定后才有可比较的估算快照。</p>';
    $('lock-baseline').textContent = active && !active.lockedAt ? `锁定估算 v${active.version}` : '锁定当前估算';
    $('reopen-baseline').disabled = !versions.some(x => x.lockedAt);
    for (const form of [$('work-form'), $('expense-form'), $('revenue-form')]) {
      form.elements.date.value ||= today;
      form.elements.currency.value = p.currency || 'CNY';
    }
    $('completeness-form').elements.asOf.value = (p.actualCompleteness || {}).asOf || today;
    $('completeness-form').elements.asserted.checked = !!((p.actualCompleteness || {}).asserted);
    const rows = [];
    for (const x of p.actualWork || []) rows.push(`<div class="actual-row"><span>${esc(x.date)} · 工时 ${x.minutes} 分钟 × ${esc(money(x.hourlyRate))} ${esc(x.currency)}/小时 · ${esc(x.source)} · ${esc(x.note)}</span><button class="btn btn-small btn-quiet-danger" data-actual-del="${esc(x.id)}">删除</button></div>`);
    for (const x of p.actualExpenses || []) rows.push(`<div class="actual-row"><span>${esc(x.date)} · 费用 ${esc(money(x.amount))} ${esc(x.currency)} · ${esc(x.source)} · ${esc(x.note)}</span><button class="btn btn-small btn-quiet-danger" data-actual-del="${esc(x.id)}">删除</button></div>`);
    for (const x of p.actualRevenue || []) rows.push(`<div class="actual-row"><span>${esc(x.date)} · 实收 ${esc(money(x.amount))} ${esc(x.currency)} · ${esc(x.source)} · ${esc(x.note)}</span><button class="btn btn-small btn-quiet-danger" data-actual-del="${esc(x.id)}">删除</button></div>`);
    const currencyTotals = a.knownByCurrency.map(x => `${esc(x.currency)}：${x.minutes} 分钟，成本 ${esc(money(x.cost))}，实收 ${esc(money(x.collected))}`).join('；');
    $('actual-entries').innerHTML = rows.length ? `<div class="actual-rows">${rows.join('')}</div><p class="muted">按币种原值：${currencyTotals}。不同币种只记录，不自动换算。</p>` : '<p class="muted">还没有实际记录。</p>';
  }
  function updateLineAmounts() {
    const p = project();
    if (!p) return;
    for (const el of $('lines').querySelectorAll('[data-line]')) {
      const l = p.lines.find(x => x.id === el.dataset.line);
      if (l) el.querySelector('[data-amount]').textContent = money(C.lineAmount(l));
    }
  }
  function refreshDerived() {
    renderList(); renderResult(); renderActual(); updateLineAmounts();
    if (ui.tab !== 'projects') renderTab();
  }

  // ---------- 组合 ----------
  const td = (label, html, cls) => `<td data-label="${label}"${cls ? ` class="${cls}"` : ''}>${html}</td>`;
  function renderPortfolio() {
    const box = $('portfolio-body');
    if (!state.projects.length) { box.innerHTML = '<div class="panel empty"><p><strong>还没有项目。</strong>点右上角「载入示例」,或先到「项目」页新建。</p></div>'; return; }
    const r = C.portfolio(state.projects, today);
    const clients = C.byClient(state.projects);
    const q = C.quarterCompare(state.projects, today);
    const t = r.totals;
    const stat = (k, v, cls, main) => `<div class="stat${main ? ' stat-main' : ''}"><span class="k">${k}</span><span class="v${cls || ''}">${esc(v)}</span></div>`;
    const rows = r.items.map((i, idx) => {
      const p = i.project, m = i.m;
      const tips = [m.belowOpportunity ? '<span class="badge badge-warn">低于机会成本</span>' : '', i.overdue ? '<span class="badge badge-bad">逾期</span>' : ''].join(' ');
      return `<tr>${td('排名', idx + 1)}${td('项目', esc(C.nameOf(p)))}${td('客户', esc(C.clientOf(p)))}${td('状态', badge(p.status))}
        ${td('收入(元)', money(m.revenue), 'num')}${td('毛利(元)', money(m.gross), 'num' + negCls(m.gross))}${td('毛利率', C.formatPct(m.rate), 'num' + negCls(m.rate))}
        ${td('每小时毛利', m.perHour === null ? '—' : money(m.perHour), 'num' + negCls(m.perHour))}${td('预计回款日', i.due || '缺日期')}${td('提示', tips || '—')}
        ${td('操作', `<button type="button" class="btn btn-small" data-open="${esc(p.id)}">查看</button>`)}</tr>`;
    }).join('');
    const clientRows = clients.map(c => `<tr>${td('客户', esc(c.client))}${td('项目数', c.count, 'num')}${td('总收入(元)', money(c.revenue), 'num')}${td('总毛利(元)', money(c.gross), 'num' + negCls(c.gross))}${td('平均毛利率', C.formatPct(c.avgRate), 'num' + negCls(c.avgRate))}${td('加权毛利率', C.formatPct(c.weightedRate), 'num' + negCls(c.weightedRate))}</tr>`).join('');
    const qCard = (title, x) => `<div class="stat"><span class="k">${esc(title)}:${esc(x.label)}(${esc(x.start)} 至 ${esc(x.end)})</span><span class="v${negCls(x.rate)}">${esc(C.formatPct(x.rate))}</span><span class="k">${x.count} 个项目 · 收入 ${esc(money(x.revenue))} 元 · 毛利 ${esc(money(x.gross))} 元</span></div>`;
    const delta = C.quarterDeltaNote(q);
    const tr = r.traits;
    const worstList = r.worst3.map(i => `<li>${esc(C.nameOf(i.project))}:毛利率 <span class="${negCls(i.m.rate).trim()}">${esc(C.formatPct(i.m.rate))}</span>,客户 ${esc(C.clientOf(i.project))}</li>`).join('');
    const hourly = tr.laborRates.map(x => `${esc(x.name)} ${esc(money(x.hourly))} 元/小时`).join(';') || '无人工行';
    const traitsHtml = r.worst3.length ? `<ul class="traits">
        <li>客户分布:${tr.clients.map(([c, n]) => `${esc(c)} ${n} 个`).join('、')}</li>
        <li>成本类型(含该类型成本行的项目数):${tr.costTypes.map(x => `${esc(x.label)} ${x.count}/${tr.count}`).join('、') || '无'}</li>
        <li>人工成本时薪:${hourly}</li>
        <li>报价口径:含税 ${tr.taxIncluded} 个、不含税 ${tr.taxExcluded} 个</li>
        <li>${tr.common.length ? '共同点:' + tr.common.map(esc).join(';') : '没有所有项目都满足的共同字段。'}</li></ul>
        <p class="muted">只列客观字段,不推断原因;样本只有 ${tr.count} 个,请自行判断。</p>` : '<p class="muted">有毛利率的项目不足,暂无可比较的项目。</p>';
    box.innerHTML = `<div class="stack">
      <div class="panel"><h2>总览(不含已取消)</h2><div class="stats">
        ${stat('项目数', String(t.count))}${stat('总收入(元)', money(t.revenue))}${stat('总毛利(元)', money(t.gross), negCls(t.gross), true)}${stat('综合毛利率', C.formatPct(t.rate), negCls(t.rate), true)}
        ${stat('逾期项目', r.overdue.length + ' 个')}${stat('逾期尾款(元)', money(r.overdueAmount), r.overdue.length ? ' neg' : '')}</div>
        ${r.overdue.length ? `<p>逾期:${r.overdue.map(i => `${esc(C.nameOf(i.project))}(应回款 ${esc(i.due)})`).join('、')}。逾期金额 = 报价 ×(1 − 预付比例),假设预付款已收到。</p>` : ''}
        ${r.cancelled.length ? `<p class="muted">另有 ${r.cancelled.length} 个已取消项目没有计入下面任何汇总。</p>` : ''}</div>
      <div class="panel"><h2>全部项目毛利率排序(高到低)</h2><div class="table-wrap"><table class="fin"><thead><tr><th>排名</th><th>项目</th><th>客户</th><th>状态</th><th class="num">收入(元)</th><th class="num">毛利(元)</th><th class="num">毛利率</th><th class="num">每小时毛利</th><th>预计回款日</th><th>提示</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div></div>
      <div class="grid-2">
        <div class="panel"><h2>按客户汇总</h2><div class="table-wrap"><table class="fin"><thead><tr><th>客户</th><th class="num">项目数</th><th class="num">总收入(元)</th><th class="num">总毛利(元)</th><th class="num">平均毛利率</th><th class="num">加权毛利率</th></tr></thead><tbody>${clientRows}</tbody></table></div>
          <p class="muted">平均毛利率 = 各项目毛利率的算术平均;加权毛利率 = 总毛利 ÷ 总收入。</p></div>
        <div class="panel"><h2>本季度与上季度(按交付日期)</h2><div class="stats">${qCard('本季度', q.current)}${qCard('上季度', q.previous)}</div><p>${esc(delta)}</p>${q.noDate ? `<p class="muted">${q.noDate} 个项目没有交付日期,未计入。</p>` : ''}</div>
      </div>
      <div class="panel"><h2>最差 3 个项目与共同特征</h2><ul class="traits">${worstList}</ul>${traitsHtml}</div>
    </div>`;
  }

  // ---------- 情景 ----------
  function laborHourlyOf(p) {
    let h100 = 0, cost = 0;
    for (const l of p.lines) if (l.type === 'labor') { h100 += Math.round(l.hours * 100); cost += C.lineAmount(l); }
    return h100 > 0 ? Math.round((cost * 100) / h100) : null;
  }
  function renderScenario() {
    const box = $('scenario-body');
    if (!state.projects.length) { box.innerHTML = '<div class="panel empty"><p><strong>还没有项目。</strong>点右上角「载入示例」,或先到「项目」页新建。</p></div>'; return; }
    if (!state.projects.some(p => p.id === ui.scen.id)) ui.scen.id = ui.currentId && state.projects.some(p => p.id === ui.currentId) ? ui.currentId : state.projects[0].id;
    const p = state.projects.find(x => x.id === ui.scen.id);
    const avg = laborHourlyOf(p);
    if (ui.scen.initFor !== p.id) { ui.scen.initFor = p.id; ui.scen.hourly = Math.round((avg === null ? p.opportunityHourly : avg) / 100); ui.scen.discount = 0; }
    const max = Math.max(500, Math.ceil((Math.max(ui.scen.hourly, p.opportunityHourly / 100) * 3) / 50) * 50);
    const opts = state.projects.map(x => `<option value="${esc(x.id)}" ${x.id === p.id ? 'selected' : ''}>${esc(C.nameOf(x))}(${esc(C.clientOf(x))})</option>`).join('');
    box.innerHTML = `<div class="panel"><h2>情景试算</h2>
      <p class="muted">拖动滑块试算,只在这里计算,不会改动项目数据。时薪滑块会把该项目所有人工行的时薪换成滑块的值。</p>
      <label class="field">选择项目<select id="sc-project">${opts}</select></label>
      <div class="sliders">
        <div class="slider"><div class="slider-top"><label for="sc-hourly">人工时薪(元/小时)</label><span id="sc-hourly-val"></span></div>
          <input type="range" id="sc-hourly" min="0" max="${max}" step="1" value="${ui.scen.hourly}" ${avg === null ? 'disabled' : ''}>
          ${avg === null ? '<span class="muted">这个项目没有人工行,时薪滑块不起作用。</span>' : ''}</div>
        <div class="slider"><div class="slider-top"><label for="sc-discount">报价折扣(%)</label><span id="sc-discount-val"></span></div>
          <input type="range" id="sc-discount" min="0" max="50" step="1" value="${ui.scen.discount}"></div>
      </div>
      <div class="btn-row"><button type="button" class="btn" id="sc-reset">还原为当前值</button></div>
      <div id="sc-out"></div></div>`;
    updateScenarioOut();
  }
  function updateScenarioOut() {
    const p = state.projects.find(x => x.id === ui.scen.id);
    if (!p || !$('sc-out')) return;
    const avg = laborHourlyOf(p);
    const hourly = avg === null ? null : ui.scen.hourly * 100;
    const r = C.scenario(p, { hourly, discount: ui.scen.discount });
    $('sc-hourly-val').textContent = avg === null ? '—' : ui.scen.hourly + ' 元';
    $('sc-discount-val').textContent = ui.scen.discount + '%';
    const barW = x => Math.max(0, Math.min(100, (x === null ? 0 : x) * 100));
    const bar = (label, m, cls) => `<div class="bar-row"><span>${label}</span><div class="bar-track"><div class="bar-fill ${cls}${m.rate !== null && m.rate < 0 ? ' is-neg' : ''}" style="width:${barW(m.rate)}%"></div></div><span class="bar-val${negCls(m.rate)}">${esc(C.formatPct(m.rate))}</span></div>`;
    const b = r.base, s = r.scenario;
    const delta = r.rateDelta === null ? '收入为 0,无法比较毛利率。' : `毛利率${r.rateDelta >= 0 ? '提高' : '下降'} ${Math.abs(r.rateDelta * 100).toFixed(1)} 个百分点,毛利${r.grossDelta >= 0 ? '增加' : '减少'} ${money(Math.abs(r.grossDelta))} 元。`;
    const row = (k, a, c, cls) => `<tr>${td('指标', k)}${td('当前', esc(a), 'num' + (cls || ''))}${td('试算', esc(c), 'num')}</tr>`;
    $('sc-out').innerHTML = `<div class="bars">${bar('当前毛利率', b, 'is-base')}${bar('试算毛利率', s, '')}</div><p><strong>${esc(delta)}</strong></p>
      <div class="table-wrap"><table class="fin"><thead><tr><th>指标</th><th class="num">当前</th><th class="num">试算</th></tr></thead><tbody>
        ${row('报价(元)', money(p.quote), money(r.quote))}${row('不含税收入(元)', money(b.revenue), money(s.revenue))}${row('直接成本(元)', money(b.cost), money(s.cost))}
        ${row('毛利(元)', money(b.gross), money(s.gross))}${row('每小时毛利(元)', b.perHour === null ? '—' : money(b.perHour), s.perHour === null ? '—' : money(s.perHour))}
        ${row('低于机会成本时薪', b.belowOpportunity ? '是' : '否', s.belowOpportunity ? '是' : '否')}</tbody></table></div>`;
  }

  // ---------- 导出 ----------
  function renderExport() {
    const has = state.projects.length > 0;
    $('today-label').textContent = today;
    const sel = $('md-project');
    if (!state.projects.some(p => p.id === ui.mdId)) ui.mdId = has ? (state.projects.some(p => p.id === ui.currentId) ? ui.currentId : state.projects[0].id) : null;
    sel.innerHTML = has ? state.projects.map(p => `<option value="${esc(p.id)}" ${p.id === ui.mdId ? 'selected' : ''}>${esc(C.nameOf(p))}</option>`).join('') : '<option value="">(没有项目)</option>';
    sel.disabled = !has;
    const p = state.projects.find(x => x.id === ui.mdId);
    updateExportGuard();
    $('md-preview').textContent = p ? C.toMarkdown(p, today) : '没有项目可导出。先载入示例或新建项目。';
  }

  // ---------- 渲染调度 ----------
  function renderTab() {
    if (ui.tab === 'portfolio') renderPortfolio();
    else if (ui.tab === 'scenario') renderScenario();
    else if (ui.tab === 'export') renderExport();
  }
  function showTab(name) {
    ui.tab = name;
    for (const t of document.querySelectorAll('.tab')) t.setAttribute('aria-selected', String(t.dataset.tab === name));
    for (const p of document.querySelectorAll('.pane')) p.hidden = p.dataset.pane !== name;
    renderTab();
  }
  function renderAll() {
    if (state.projects.length && !project()) ui.currentId = state.projects[0].id;
    if (!state.projects.length) ui.currentId = null;
    $('default-opp').value = inputMoney(state.settings.opportunityHourly);
    renderList(); fillForm(); renderResult(); renderTab();
  }

  // ---------- 操作 ----------
  function replaceState(next) {
    const v = C.validateState(JSON.parse(JSON.stringify(next)));
    if (!v.ok) return showBanner('替换失败:' + v.error);
    state = v.state;
    ui.currentId = state.projects.length ? state.projects[0].id : null;
    ui.scen.initFor = null; ui.scen.id = null;
    save(); renderAll();
  }
  function loadSample() {
    if (state.projects.length) {
      $('sample-confirm-text').textContent = `现在已有 ${state.projects.length} 个项目。载入示例会替换全部现有项目和设置,无法撤销。确认替换吗?`;
      $('sample-confirm').hidden = false;
      $('sample-confirm-no').focus();
      return;
    }
    replaceState(globalThis.MARGIN_SAMPLE);
  }
  function newProject() {
    const p = C.newProject(state.settings.opportunityHourly, today);
    state.projects.unshift(p);
    ui.currentId = p.id;
    save(); showTab('projects'); renderAll();
    $('f-name').focus();
  }

  function bind() {
    $('load-sample').addEventListener('click', loadSample);
    $('sample-confirm-yes').addEventListener('click', () => { $('sample-confirm').hidden = true; replaceState(globalThis.MARGIN_SAMPLE); });
    $('sample-confirm-no').addEventListener('click', () => { $('sample-confirm').hidden = true; });
    $('new-project').addEventListener('click', newProject);
    for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => showTab(t.dataset.tab));

    $('default-opp').addEventListener('input', e => {
      if (applyInput(e.target, state.settings, 'opportunityHourly', 'money')) { renderResult(); }
    });
    $('project-list').addEventListener('click', e => {
      const b = e.target.closest('[data-id]');
      if (!b) return;
      ui.currentId = b.dataset.id; renderList(); fillForm(); renderResult();
    });

    const F = [
      ['f-name', 'name', 'text'], ['f-client', 'client', 'text'], ['f-quote', 'quote', 'money'],
      ['f-tax-rate', 'taxRate', 'num', { max: 100, dp: 2 }], ['f-prepaid', 'prepaidPct', 'num', { max: 100, dp: 2 }],
      ['f-term', 'termDays', 'num', { max: 3650, dp: 0 }], ['f-opp', 'opportunityHourly', 'money']
    ];
    for (const [id, key, kind, opts] of F) {
      $(id).addEventListener('input', e => { const p = project(); if (p && applyInput(e.target, p, key, kind, opts)) refreshDerived(); });
    }
    for (const [id, key] of [['f-status', 'status'], ['f-start', 'startDate'], ['f-deliver', 'deliverDate']]) {
      $(id).addEventListener('change', e => { const p = project(); if (p && applyInput(e.target, p, key, 'text')) refreshDerived(); });
    }
    $('f-tax-included').addEventListener('change', e => {
      const p = project(); if (!p) return;
      if (!setField(p, 'taxIncluded', e.target.value === 'yes')) { $('f-tax-rate').disabled = !p.taxIncluded; save(); refreshDerived(); }
    });

    $('delete-project').addEventListener('click', () => { $('delete-confirm').hidden = false; $('delete-no').focus(); });
    $('delete-no').addEventListener('click', () => { $('delete-confirm').hidden = true; });
    $('delete-yes').addEventListener('click', () => {
      state.projects = state.projects.filter(p => p.id !== ui.currentId);
      ui.currentId = state.projects.length ? state.projects[0].id : null;
      save(); renderAll();
    });

    // 成本行
    $('lines').addEventListener('input', e => {
      const p = project(), el = e.target.closest('[data-line]');
      const f = e.target.dataset.f;
      if (!p || !el || !f || f === 'type') return;
      const l = p.lines.find(x => x.id === el.dataset.line);
      const [kind, opts] = LINE_PARSE[f];
      if (l && applyInput(e.target, l, f, kind, opts)) refreshDerived();
    });
    $('lines').addEventListener('change', e => {
      const p = project(), el = e.target.closest('[data-line]');
      if (!p || !el || e.target.dataset.f !== 'type') return;
      const idx = p.lines.findIndex(x => x.id === el.dataset.line);
      const nl = C.newLine(e.target.value, p.opportunityHourly);
      nl.id = p.lines[idx].id; nl.note = p.lines[idx].note;
      p.lines[idx] = nl;
      save(); renderLines(); refreshDerived();
    });
    $('lines').addEventListener('click', e => {
      const p = project();
      if (!p) return;
      const del = e.target.closest('[data-del]');
      if (del) {
        const l = p.lines.find(x => x.id === del.dataset.del);
        const row = del.closest('.line');
        if (!l || !row || row.querySelector('.line-confirm')) return;
        const box = document.createElement('div');
        box.className = 'line-confirm'; box.setAttribute('role', 'alert');
        box.innerHTML = `<span>删除这一行?它的小计 ${esc(money(C.lineAmount(l)))} 元会从直接成本里扣除,无法撤销。</span>
          <button type="button" class="btn btn-small btn-danger" data-del-yes="${esc(l.id)}">确认删除</button>
          <button type="button" class="btn btn-small" data-del-no="${esc(l.id)}">取消</button>`;
        row.appendChild(box);
        box.querySelector('[data-del-no]').focus();
        return;
      }
      const no = e.target.closest('[data-del-no]');
      if (no) {
        const row = no.closest('.line');
        row.querySelector('.line-confirm').remove();
        row.querySelector('[data-del]').focus();
        return;
      }
      const yes = e.target.closest('[data-del-yes]');
      if (yes) {
        const idx = p.lines.findIndex(x => x.id === yes.dataset.delYes);
        p.lines = p.lines.filter(x => x.id !== yes.dataset.delYes);
        save(); renderLines(); refreshDerived();
        const rows = $('lines').querySelectorAll('[data-del]');
        const nextBtn = rows[Math.min(idx, rows.length - 1)];
        (nextBtn || document.querySelector('[data-add]')).focus();
      }
    });
    for (const b of document.querySelectorAll('[data-add]')) {
      b.addEventListener('click', () => {
        const p = project(); if (!p) return;
        p.lines.push(C.newLine(b.dataset.add, p.opportunityHourly));
        save(); renderLines(); refreshDerived();
        const last = $('lines').lastElementChild.querySelector('input'); if (last) last.focus();
      });
    }

    // 估算基线与实际记录
    $('lock-baseline').addEventListener('click', () => {
      const p = project(); if (!p) return;
      const next = C.lockEstimate(p, today);
      state.projects[state.projects.findIndex(x => x.id === p.id)] = next;
      save(); fillForm(); refreshDerived();
    });
    $('reopen-baseline').addEventListener('click', () => {
      const p = project(); if (!p) return;
      const locked = [...(p.baselineVersions || [])].reverse().find(x => x.lockedAt); if (!locked) return;
      const next = C.reopenEstimate(p, locked.id, today);
      state.projects[state.projects.findIndex(x => x.id === p.id)] = next;
      save(); fillForm(); refreshDerived();
    });
    const actualSay = (text, bad) => { const m = $('actual-msg'); m.textContent = text; m.className = 'msg' + (bad ? ' msg-bad' : ''); m.hidden = false; };
    const currencyOf = form => String(form.elements.currency.value || '').trim().toUpperCase();
    function addActual(form, kind) {
      const p = project(); if (!p) return;
      const date = form.elements.date.value, currency = currencyOf(form), source = form.elements.source.value.trim(), note = form.elements.note.value;
      if (!C.isRealDate(date) || !/^[A-Z]{3}$/.test(currency) || !source) return actualSay('请填写真实日期、3 位大写币种代码和来源。', true);
      let entry = { id: C.newId(), date, currency, source, note };
      if (kind === 'work') {
        const minutes = C.parseNumber(form.elements.minutes.value, { max: 10000000, dp: 0 }), hourlyRate = C.parseMoney(form.elements.rate.value);
        if (!Number.isSafeInteger(minutes) || minutes < 1 || Number.isNaN(hourlyRate)) return actualSay('工时分钟必须是正整数，时薪必须是有效非负金额。', true);
        entry = Object.assign(entry, { minutes, hourlyRate }); (p.actualWork || (p.actualWork = [])).push(entry);
      } else {
        const amount = C.parseMoney(form.elements.amount.value);
        if (!Number.isSafeInteger(amount) || amount < 1) return actualSay('金额必须大于 0，最多两位小数。', true);
        entry.amount = amount; (kind === 'expense' ? (p.actualExpenses || (p.actualExpenses = [])) : (p.actualRevenue || (p.actualRevenue = []))).push(entry);
      }
      const v = C.validateState(state);
      if (!v.ok) { if (kind === 'work') p.actualWork.pop(); else if (kind === 'expense') p.actualExpenses.pop(); else p.actualRevenue.pop(); return actualSay('记录被拒绝:' + v.error, true); }
      p.actualCompleteness = { asserted: false, asOf: (p.actualCompleteness || {}).asOf || '', assertedAt: '' };
      save(); form.reset(); form.elements.date.value = today; form.elements.currency.value = p.currency || 'CNY'; renderActual(); renderResult(); renderExport(); actualSay('实际记录已添加；完整性声明已重置为未确认。', false);
    }
    $('work-form').addEventListener('submit', e => { e.preventDefault(); addActual(e.currentTarget, 'work'); });
    $('expense-form').addEventListener('submit', e => { e.preventDefault(); addActual(e.currentTarget, 'expense'); });
    $('revenue-form').addEventListener('submit', e => { e.preventDefault(); addActual(e.currentTarget, 'revenue'); });
    $('actual-entries').addEventListener('click', e => {
      const b = e.target.closest('[data-actual-del]'); if (!b) return;
      const p = project(), id = b.dataset.actualDel;
      p.actualWork = (p.actualWork || []).filter(x => x.id !== id); p.actualExpenses = (p.actualExpenses || []).filter(x => x.id !== id); p.actualRevenue = (p.actualRevenue || []).filter(x => x.id !== id);
      p.actualCompleteness = { asserted: false, asOf: (p.actualCompleteness || {}).asOf || '', assertedAt: '' };
      save(); renderActual(); renderResult(); renderExport();
    });
    $('completeness-form').addEventListener('submit', e => {
      e.preventDefault(); const p = project(), asOf = e.currentTarget.elements.asOf.value, asserted = e.currentTarget.elements.asserted.checked;
      if (!C.isRealDate(asOf)) return actualSay('请选择真实的实际记录截至日。', true);
      const old = p.actualCompleteness;
      p.actualCompleteness = { asserted, asOf, assertedAt: asserted ? today : '' };
      const v = C.validateState(state);
      if (!v.ok) { p.actualCompleteness = old; return actualSay('完整性声明被拒绝:' + v.error, true); }
      save(); renderActual(); renderResult(); renderExport(); actualSay(asserted ? '已保存完整性声明；满足币种一致等条件时会显示偏差。' : '已保存为“未声明完整”；偏差保持未知。', false);
    });

    // 组合 / 情景
    $('portfolio-body').addEventListener('click', e => {
      const b = e.target.closest('[data-open]');
      if (b) { ui.currentId = b.dataset.open; showTab('projects'); renderList(); fillForm(); renderResult(); }
    });
    $('scenario-body').addEventListener('input', e => {
      if (e.target.id === 'sc-hourly') ui.scen.hourly = Number(e.target.value);
      else if (e.target.id === 'sc-discount') ui.scen.discount = Number(e.target.value);
      else return;
      updateScenarioOut();
    });
    $('scenario-body').addEventListener('change', e => { if (e.target.id === 'sc-project') { ui.scen.id = e.target.value; ui.scen.initFor = null; renderScenario(); } });
    $('scenario-body').addEventListener('click', e => { if (e.target.id === 'sc-reset') { ui.scen.initFor = null; renderScenario(); } });

    // 导出
    $('md-project').addEventListener('change', e => { ui.mdId = e.target.value; renderExport(); });
    $('export-csv').addEventListener('click', () => hasInvalidInput() || download(`项目毛利表-${today}.csv`, '\ufeff' + C.toCsv(state.projects, today), 'text/csv;charset=utf-8'));
    $('export-md').addEventListener('click', () => {
      const p = state.projects.find(x => x.id === ui.mdId);
      if (p && !hasInvalidInput()) download(`毛利说明-${safeName(p.name)}.md`, C.toMarkdown(p, today), 'text/markdown;charset=utf-8');
    });
    $('export-json').addEventListener('click', () => hasInvalidInput() || download(`项目毛利表-备份-${today}.json`, JSON.stringify(state, null, 2), 'application/json;charset=utf-8'));

    const msg = $('import-msg');
    const say = (text, bad) => { msg.textContent = text; msg.className = 'msg' + (bad ? ' msg-bad' : ''); msg.hidden = false; };
    $('import-file').addEventListener('change', async e => {
      const f = e.target.files[0];
      e.target.value = '';
      $('import-confirm').hidden = true; ui.pendingImport = null;
      if (!f) return;
      let text;
      try { text = await f.text(); } catch (err) { say('读取文件失败:' + err.message, true); return; }
      const v = C.validateImport(text);
      if (!v.ok) { say('导入被拒绝,现有数据没有改动。原因:' + v.error, true); return; }
      if (state.projects.length) {
        ui.pendingImport = v.state;
        say(`文件通过校验:${v.state.projects.length} 个项目。`);
        $('import-confirm-text').textContent = `现在已有 ${state.projects.length} 个项目。导入会替换全部现有项目和设置,无法撤销。确认替换吗?`;
        $('import-confirm').hidden = false; $('import-no').focus();
      } else { replaceState(v.state); say(`已导入 ${v.state.projects.length} 个项目。`); }
    });
    $('import-no').addEventListener('click', () => { ui.pendingImport = null; $('import-confirm').hidden = true; say('已取消导入,现有数据保持原状。'); });
    $('import-yes').addEventListener('click', () => {
      const next = ui.pendingImport; ui.pendingImport = null; $('import-confirm').hidden = true;
      if (next) { replaceState(next); say(`已替换为导入的 ${next.projects.length} 个项目。`); }
    });

    $('clear-data').addEventListener('click', () => { $('clear-confirm').hidden = false; $('clear-no').focus(); });
    $('clear-no').addEventListener('click', () => { $('clear-confirm').hidden = true; });
    $('clear-yes').addEventListener('click', () => {
      $('clear-confirm').hidden = true;
      replaceState({ version: 2, settings: { opportunityHourly: DEFAULT_OPP }, projects: [] });
      say('已清空全部数据。', false);
    });
  }

  if (C.resolveToday(location.search, '')) { const n = $('today-fixed'); n.textContent = '基准日 ' + today + '(由地址参数固定)'; n.hidden = false; }
  $('f-status').innerHTML = C.STATUSES.map(x => `<option value="${x}">${x}</option>`).join('');
  load();
  bind();
  renderAll();
  showTab('projects');
  if (!$('save-banner').hidden) { /* 载入阶段的存储告警保持可见 */ } else if (state.projects.length) setSaveLabel('已从本机载入', false);
})();
