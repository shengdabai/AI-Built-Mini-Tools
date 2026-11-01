'use strict';
(function () {
  const C = globalThis.DupCore;
  const KEY = 'dupcheck.v1';
  const $ = id => document.getElementById(id);
  const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => {
    const q = new URLSearchParams(location.search).get('today');
    if (q && C.isValidDate(q)) return q;
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const DELIM = { '\t': 'Tab', ',': '逗号', ';': '分号' };
  const IDENTITY = ['name', 'phone', 'email', 'wechat'];

  let state = { tables: [], rules: Object.assign({}, C.DEFAULT_RULES), confirmed: [], masters: [], sample: false };
  const parsed = new Map(); // 表 id → parseTable 结果
  let run = null; // {records, rules, sig}
  let armedRemove = null, armTimer = null, toastTimer = null;

  // ---------------------------------------------------------------- 存储
  const uid = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  function validateSaved(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return '根不是对象';
    if (!Array.isArray(o.tables) || o.tables.length > C.MAX_TABLES) return 'tables 不是数组或超过上限';
    const ids = new Set();
    let total = 0;
    for (const t of o.tables) {
      if (!t || typeof t !== 'object') return '表条目不是对象';
      if (typeof t.id !== 'string' || !/^[A-Za-z0-9]+$/.test(t.id) || ids.has(t.id)) return '表 id 缺失或重复';
      ids.add(t.id);
      if (typeof t.name !== 'string' || typeof t.text !== 'string') return '表名或内容不是字符串';
      const p = C.parseTable(t.text);
      if (!p.ok) return '表内容无法解析:' + p.error;
      total += p.rows.length;
      if (!Array.isArray(t.mapping) || t.mapping.length !== p.headers.length || t.mapping.some(r => !C.ROLES.includes(r))) return '列映射与表头不一致或含未知角色';
    }
    if (total > C.MAX_ROWS) return '总行数超过上限';
    if (!o.rules || typeof o.rules !== 'object' || Object.keys(C.DEFAULT_RULES).some(k => typeof o.rules[k] !== 'boolean')) return '规则字段不合法';
    for (const k of ['confirmed', 'masters']) if (!Array.isArray(o[k]) || o[k].some(x => typeof x !== 'string')) return k + ' 不合法';
    if (o.sample !== undefined && typeof o.sample !== 'boolean') return 'sample 不合法';
    return '';
  }
  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { return; }
    if (!raw) return;
    let obj = null, err = '';
    try { obj = JSON.parse(raw); err = validateSaved(obj); } catch (e) { err = '保存的内容不是合法 JSON'; }
    if (err) { toast('浏览器里保存的数据未能读取,已忽略(' + err + ')。', true); return; }
    state = { tables: obj.tables.map(t => ({ id: t.id, name: t.name, text: t.text, mapping: t.mapping.slice() })), rules: Object.assign({}, obj.rules), confirmed: obj.confirmed.slice(), masters: obj.masters.slice(), sample: obj.sample === true };
    for (const t of state.tables) parsed.set(t.id, C.parseTable(t.text));
  }
  // 返回是否真正写入。失败时给出持续可见的提示,成功才清除。
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      $('save-alert').hidden = true;
      return true;
    } catch (e) {
      const a = $('save-alert');
      a.textContent = '未保存:浏览器存储不可用或已满。刷新或关闭页面后,这些表格会丢失。请保留原始文件,并尽快用下面的「导出」把结果存下来。';
      a.hidden = false;
      return false;
    }
  }
  function toast(msg, sticky) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    if (!sticky) toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }
  function download(name, text, type) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(new Blob([text], { type }));
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------------------------------------------------------------- 状态派生
  const signature = () => JSON.stringify([state.tables.map(t => [t.id, t.name, t.text, t.mapping]), state.rules]);
  const isStale = () => !!run && run.sig !== signature();
  const totalRows = () => state.tables.reduce((n, t) => n + (parsed.get(t.id) ? parsed.get(t.id).rows.length : 0), 0);
  const computed = () => (run ? C.cluster(run.records, run.rules, state.confirmed) : null);
  const canExport = () => !!run && !isStale();

  // ---------------------------------------------------------------- 添加表
  function showAddError(msg) {
    const e = $('add-error'); e.textContent = msg; e.hidden = !msg;
    const t = $('add-text');
    if (msg) { t.setAttribute('aria-invalid', 'true'); t.focus(); } else t.removeAttribute('aria-invalid');
  }
  function addTable(name, text) {
    showAddError('');
    if (state.tables.length >= C.MAX_TABLES) return showAddError(`最多 ${C.MAX_TABLES} 张表。请先移除一张。`);
    if (!String(text).trim()) return showAddError('没有内容。请粘贴带表头的 CSV / TSV,或选择文件。');
    if (String(text).includes('\ufffd')) return showAddError('文件含无法识别的字符,可能不是 UTF-8 编码。请在表格软件里另存为「CSV UTF-8」后再试。');
    const p = C.parseTable(text);
    if (!p.ok) return showAddError('无法解析:' + p.error);
    if (!p.headers.length) return showAddError('没有找到表头。第一行必须是列名。');
    if (!p.rows.length) return showAddError('只有表头,没有数据行。');
    if (totalRows() + p.rows.length > C.MAX_ROWS) return showAddError(`合计行数会超过 ${C.MAX_ROWS}。`);
    const t = { id: uid(), name: (name || '').trim() || `表${state.tables.length + 1}`, text: String(text), mapping: C.guessMapping(p.headers) };
    state.tables.push(t); parsed.set(t.id, p);
    state.sample = false;
    $('add-name').value = ''; $('add-text').value = ''; $('add-file').value = '';
    const ok = save();
    renderAll();
    if (ok) toast(`已添加「${t.name}」:${p.rows.length} 行。`);
  }

  // ---------------------------------------------------------------- 渲染:表与规则
  function renderTables() {
    const box = $('table-list');
    if (!state.tables.length) { box.innerHTML = '<div class="empty">还没有表。粘贴上面的文本、选择文件,或点右上角「载入示例」。</div>'; return; }
    box.innerHTML = state.tables.map(t => {
      const p = parsed.get(t.id);
      const rows = p.rows;
      const opts = r => C.ROLES.map(x => `<option value="${x}"${x === r ? ' selected' : ''}>${esc(C.ROLE_LABEL[x])}</option>`).join('');
      const items = p.headers.map((h, i) => {
        const sample = rows.slice(0, 2).map(r => r[i]).filter(Boolean).join(' · ');
        return `<div class="map-item"><span class="col-name">${esc(h || '列' + (i + 1))}</span>
          <select aria-label="列「${esc(h || '列' + (i + 1))}」的含义" data-table="${esc(t.id)}" data-col="${esc(i)}">${opts(t.mapping[i])}</select>
          <span class="col-sample">${sample ? '例:' + esc(sample) : '(前两行为空)'}</span></div>`;
      }).join('');
      const armed = armedRemove === t.id;
      return `<article class="tcard">
        <div class="tcard-head"><span class="tcard-title">${esc(t.name)}</span><span class="tcard-meta">${esc(rows.length)} 行 · ${esc(DELIM[p.delimiter] || p.delimiter)}分隔</span></div>
        <div class="map-grid">${items}</div>
        <div class="row"><button type="button" class="${armed ? 'danger' : ''}" data-remove="${esc(t.id)}">${armed ? '再点一次确认移除这张表(' + rows.length + ' 行)' : '移除这张表'}</button></div>
      </article>`;
    }).join('');
  }
  function renderRules() {
    for (const k of Object.keys(C.DEFAULT_RULES)) $('rule-' + k).checked = state.rules[k] !== false;
  }
  function renderRunState() {
    const el = $('run-state');
    if (!state.tables.length) el.textContent = '';
    else if (!run) el.textContent = '尚未核对。';
    else if (isStale()) el.textContent = '表格、列映射或规则已改动,请重新核对。';
    else el.textContent = '结果与当前设置一致。';
    $('run').disabled = !state.tables.length;
  }

  // ---------------------------------------------------------------- 核对
  function showRunError(msg) { const e = $('run-error'); e.textContent = msg; e.hidden = !msg; }
  function doRun() {
    showRunError('');
    const bad = state.tables.filter(t => !t.mapping.some(r => IDENTITY.includes(r)));
    if (bad.length) return showRunError(`「${bad.map(t => t.name).join('」「')}」没有任何列被映射为姓名、手机、邮箱或微信号,无法核对。请先设置列的含义。`);
    const records = [];
    state.tables.forEach((t, i) => {
      const p = parsed.get(t.id);
      records.push(...C.buildRecords({ id: t.id, name: t.name, headers: p.headers, rows: p.rows, mapping: t.mapping }, i));
    });
    run = { records, rules: Object.assign({}, state.rules), sig: signature() };
    renderAll();
  }

  // ---------------------------------------------------------------- 渲染:结果
  const fieldsOf = (m) => C.FIELDS.map(f => ({ key: f, label: C.FIELD_LABEL[f], value: m[f] }))
    .concat(m.extras.map(e => ({ key: 'x:' + e.k, label: e.k, value: e.v })));
  function fieldHtml(f, conflictSet) {
    const cls = conflictSet.has(f.key) ? ' conflict' : '';
    return `<div class="field${cls}"><dt>${esc(f.label)}${cls ? '(冲突)' : ''}</dt><dd class="${f.value ? '' : 'none'}">${f.value ? esc(f.value) : '—'}</dd></div>`;
  }
  const recLine = r => `${esc(r.name || '(无姓名)')} · ${esc(r.table)} 第${esc(r.row)}行`;
  const recContact = r => `手机:${esc(r.phone || '—')}<br>邮箱:${esc(r.email || '—')}`;

  function renderResults() {
    const summary = $('summary'), list = $('cluster-list'), box = $('suspect-box');
    box.hidden = true;
    $('sample-badge').hidden = !state.sample;
    if (!state.tables.length) {
      summary.innerHTML = '';
      list.innerHTML = '<div class="empty"><strong>先放进要核对的表</strong>左边粘贴 CSV / TSV 或选文件,每张表设置好哪一列是姓名、手机、邮箱。想先看看效果,点右上角「载入示例」。</div>';
      return;
    }
    const res = computed();
    if (!res) {
      summary.innerHTML = '';
      list.innerHTML = `<div class="empty"><strong>已放入 ${state.tables.length} 张表</strong>检查每列的含义后,点左边的「开始核对」。</div>`;
      return;
    }
    const clusters = res.clusters;
    const multi = clusters.filter(c => c.size > 1);
    const conflicted = clusters.filter(c => c.conflicts.length);
    summary.innerHTML =
      (isStale() ? '<p class="stale" role="alert">输入已改动,下面仍是上一次核对的结果。重新核对之前不能导出。</p>' : '') +
      `<div class="stat"><b>${esc(run.records.length)}</b><span>条记录 → ${clusters.length} 个记录组</span></div>` +
      `<div class="stat"><b>${esc(multi.length)}</b><span>个记录组含重复记录</span></div>` +
      `<div class="stat${conflicted.length ? ' warn' : ''}"><b>${esc(conflicted.length)}</b><span>个记录组有冲突字段</span></div>` +
      `<div class="stat${res.suspects.length ? ' warn' : ''}"><b>${esc(res.suspects.length)}</b><span>对疑似重复待确认</span></div>`;

    if (res.suspects.length) {
      box.hidden = false;
      $('suspect-list').innerHTML = res.suspects.map(s => `<div class="suspect">
        <div class="pair"><p><b>${recLine(s.recordA)}</b><br>${recContact(s.recordA)}</p><p><b>${recLine(s.recordB)}</b><br>${recContact(s.recordB)}</p></div>
        <div class="row"><span class="muted">${s.distance === 0 ? '姓名相同,但手机或邮箱有缺项,没有可核对的重合。' : '姓名相差 1 个字,且手机或邮箱有缺项。'}</span>
        <button type="button" class="primary" data-confirm="${esc(s.key)}">确认是同一个人,并入</button></div></div>`).join('');
    }

    const showSingles = $('show-singles').checked, onlyConflict = $('only-conflict').checked;
    let shown = clusters.filter(c => showSingles || c.size > 1);
    if (onlyConflict) shown = shown.filter(c => c.conflicts.length);
    if (!shown.length) {
      list.innerHTML = `<div class="empty">${multi.length ? '没有符合筛选的记录组。' : '没有发现重复记录。'}</div>`;
      return;
    }
    list.innerHTML = shown.map(cl => {
      const mi = C.masterIndexFor(cl, state.masters);
      const cset = new Set(cl.conflicts);
      const ids = new Set(cl.members.map(m => m.id));
      const undo = state.confirmed.filter(k => k.split('~').every(id => ids.has(id)));
      const badges = [`<span class="badge">${esc(cl.size)} 条记录</span>`];
      if (cl.conflicts.length) badges.push(`<span class="badge conflict">冲突:${esc(cl.conflicts.map(C.conflictLabel).join('、'))}</span>`);
      if (cl.viaSuspect) badges.push('<span class="badge info">含人工确认的疑似并入</span>');
      if (cl.pending.length) badges.push('<span class="badge conflict">另有疑似待确认</span>');
      const recs = cl.members.map((m, i) => `<div class="rec${i === mi ? ' is-master' : ''}">
        <div class="rec-head"><span class="src">${esc(m.table)} 第${esc(m.row)}行</span>
        ${cl.size > 1 ? `<label class="master-pick"><input type="radio" name="master-${esc(cl.id)}" data-master="${esc(m.id)}"${i === mi ? ' checked' : ''}>主记录</label>` : ''}</div>
        <dl class="fields">${fieldsOf(m).filter(f => f.key.startsWith('x:') ? f.value : true).map(f => fieldHtml(f, cset)).join('')}</dl></div>`).join('');
      let merged = '';
      if (cl.size > 1) {
        const mg = C.merge(cl, mi);
        const mf = C.FIELDS.map(f => ({ key: f, label: C.FIELD_LABEL[f], value: mg.fields[f] })).concat(mg.extras.map(e => ({ key: 'x:' + e.k, label: e.k, value: e.v }))).filter(f => f.value);
        merged = `<div class="merged"><h4>合并结果(冲突值用 / 连接,全部保留)</h4><dl class="fields">${mf.map(f => fieldHtml(f, cset)).join('')}</dl></div>`;
      }
      let why = '';
      if (cl.size > 1) {
        const shownLinks = cl.links.slice(0, 10);
        why = `<div class="why"><h4>归组依据(${esc(cl.links.length)} 条连接)</h4><ul>${shownLinks.map(l => `<li>${esc(l.text)}</li>`).join('')}</ul>${cl.links.length > shownLinks.length ? `<p>另有 ${esc(cl.links.length - shownLinks.length)} 条连接未列出,同样来自上述规则。</p>` : ''}</div>`;
      }
      return `<article class="cluster${cl.conflicts.length ? ' has-conflict' : ''}" data-cluster="${esc(cl.id)}">
        <div class="cluster-head"><h3>记录组 ${esc(cl.id)}</h3>${badges.join('')}
        ${undo.map(k => `<button type="button" class="link" data-undo="${esc(k)}">撤销一处并入</button>`).join('')}</div>
        ${why}<div class="recs">${recs}</div>${merged}</article>`;
    }).join('');
  }

  // ---------------------------------------------------------------- 渲染:导出
  const meta = () => ({ sample: state.sample });
  function renderExport() {
    const ok = canExport();
    for (const id of ['export-merged', 'export-report', 'export-orig']) $(id).disabled = !ok;
    $('export-hint').textContent = !state.tables.length ? '放入表格并核对后才能导出。'
      : !run ? '还没有核对结果,先点「开始核对」。'
        : isStale() ? '输入已改动,结果已过期。重新核对后才能导出,以免导出与界面不一致的内容。'
          : (() => {
            const n = C.exportCounts(computed().clusters);
            return `导出的是全部核对结果,不受上面「显示」筛选影响(含你手选的主记录和确认过的疑似并入):合并结果 CSV ${n.mergedRows} 行(每个记录组一行,共 ${n.groups} 组),原始记录 CSV ${n.originalRows} 行,冲突报告 ${n.conflictGroups} 个有冲突的记录组。${state.sample ? '当前是合成示例,导出文件会标注「合成示例」。' : ''}`;
          })();
    $('report-preview').textContent = ok ? C.conflictsToMarkdown(computed().clusters, meta()) : '(核对后在这里预览冲突报告)';
  }
  function renderAll() { renderTables(); renderRules(); renderRunState(); renderResults(); renderExport(); }

  // ---------------------------------------------------------------- 事件
  function bind() {
    $('add-form').onsubmit = e => { e.preventDefault(); addTable($('add-name').value, $('add-text').value); };
    $('add-file').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = () => addTable($('add-name').value || f.name.replace(/\.[^.]+$/, ''), String(reader.result));
      reader.onerror = () => showAddError('读取文件失败。');
      reader.readAsText(f, 'utf-8');
    };
    $('table-list').addEventListener('change', e => {
      const s = e.target.closest('select[data-table]'); if (!s) return;
      const t = state.tables.find(x => x.id === s.dataset.table); if (!t) return;
      t.mapping[Number(s.dataset.col)] = s.value;
      save(); renderRunState(); renderResults(); renderExport();
    });
    $('table-list').addEventListener('click', e => {
      const b = e.target.closest('[data-remove]'); if (!b) return;
      const id = b.dataset.remove;
      if (armedRemove !== id) {
        armedRemove = id; clearTimeout(armTimer);
        armTimer = setTimeout(() => { armedRemove = null; renderTables(); }, 4000);
        renderTables();
        const nb = document.querySelector(`[data-remove="${id}"]`); if (nb) nb.focus();
        return;
      }
      armedRemove = null; clearTimeout(armTimer);
      state.tables = state.tables.filter(t => t.id !== id); parsed.delete(id);
      const ok = save(); renderAll();
      const nextBtn = document.querySelector('[data-remove]');
      (nextBtn || $('add-text')).focus();
      if (ok) toast('已移除。');
    });
    document.querySelectorAll('[data-rule]').forEach(cb => cb.addEventListener('change', () => {
      state.rules[cb.dataset.rule] = cb.checked; save(); renderRunState(); renderResults(); renderExport();
    }));
    $('run').onclick = doRun;
    for (const id of ['show-singles', 'only-conflict']) $(id).addEventListener('change', renderResults);
    $('suspect-list').addEventListener('click', e => {
      const b = e.target.closest('[data-confirm]'); if (!b) return;
      if (!state.confirmed.includes(b.dataset.confirm)) state.confirmed.push(b.dataset.confirm);
      const ok = save(); renderResults(); renderExport();
      (document.querySelector('#suspect-list [data-confirm]') || $('h-results')).focus();
      if (ok) toast('已并入。');
    });
    $('cluster-list').addEventListener('click', e => {
      const b = e.target.closest('[data-undo]'); if (!b) return;
      state.confirmed = state.confirmed.filter(k => k !== b.dataset.undo);
      const ok = save(); renderResults(); renderExport();
      (document.querySelector('#cluster-list [data-undo]') || $('h-results')).focus();
      if (ok) toast('已撤销并入。');
    });
    $('cluster-list').addEventListener('change', e => {
      const r = e.target.closest('input[data-master]'); if (!r) return;
      const cl = computed().clusters.find(c => String(c.id) === r.closest('[data-cluster]').dataset.cluster); if (!cl) return;
      const ids = new Set(cl.members.map(m => m.id));
      state.masters = state.masters.filter(id => !ids.has(id)).concat(r.dataset.master);
      save(); renderResults(); renderExport();
      const nr = document.querySelector(`input[data-master="${r.dataset.master}"]`); if (nr) nr.focus();
    });
    $('export-merged').onclick = () => { if (!canExport()) return; download(`${state.sample ? '合成示例-' : ''}合并结果-${today()}.csv`, '\ufeff' + C.toCsv(C.mergedRows(computed().clusters, state.masters, meta())), 'text/csv;charset=utf-8'); };
    $('export-orig').onclick = () => { if (!canExport()) return; download(`${state.sample ? '合成示例-' : ''}原始记录加组号-${today()}.csv`, '\ufeff' + C.toCsv(C.originalRows(computed().clusters, meta())), 'text/csv;charset=utf-8'); };
    $('export-report').onclick = () => { if (!canExport()) return; download(`${state.sample ? '合成示例-' : ''}冲突报告-${today()}.md`, C.conflictsToMarkdown(computed().clusters, meta()), 'text/markdown;charset=utf-8'); };
    const defaultRules = () => Object.keys(C.DEFAULT_RULES).every(k => state.rules[k] === C.DEFAULT_RULES[k]);
    const hasUserData = () => {
      const S = globalThis.DUP_SAMPLE;
      const draft = $('add-name').value.trim() !== '' || $('add-text').value.trim() !== '';
      const pristine = state.sample && defaultRules() && !state.confirmed.length && !state.masters.length && !draft &&
        state.tables.length === S.tables.length && state.tables.every((t, i) => t.text === S.tables[i].text);
      if (pristine) return false;
      return state.tables.length > 0 || state.confirmed.length > 0 || state.masters.length > 0 || !defaultRules() || draft;
    };
    const describeData = () => {
      const parts = [];
      if (state.tables.length) parts.push(`${state.tables.length} 张表(共 ${totalRows()} 行)`);
      if (state.confirmed.length) parts.push(`${state.confirmed.length} 条人工确认并入`);
      if (state.masters.length) parts.push(`${state.masters.length} 个手选主记录`);
      if (!defaultRules()) parts.push('已改动的匹配规则');
      if ($('add-name').value.trim() !== '' || $('add-text').value.trim() !== '') parts.push('还没添加的表名或粘贴内容');
      return parts.join('、');
    };
    const loadSample = () => {
      $('sample-confirm').hidden = true;
      state = { tables: [], rules: Object.assign({}, C.DEFAULT_RULES), confirmed: [], masters: [], sample: true };
      parsed.clear(); run = null;
      $('add-name').value = ''; $('add-text').value = ''; $('add-file').value = ''; showAddError(''); showRunError('');
      for (const s of globalThis.DUP_SAMPLE.tables) {
        const p = C.parseTable(s.text);
        const t = { id: uid(), name: s.name, text: s.text, mapping: C.guessMapping(p.headers) };
        state.tables.push(t); parsed.set(t.id, p);
      }
      const ok = save();
      doRun();
      if (ok) toast('已载入合成示例:3 张表共 40 条,全部为虚构数据。');
    };
    $('load-sample').onclick = () => {
      $('clear-confirm').hidden = true;
      if (!hasUserData()) return loadSample();
      $('sample-confirm-scope').textContent = `当前的${describeData()}会被合成示例替换,匹配规则会重置为默认;此操作无法撤销。`;
      $('sample-confirm').hidden = false;
      $('sample-confirm-no').focus();
    };
    $('sample-confirm-yes').onclick = loadSample;
    $('sample-confirm-no').onclick = () => { $('sample-confirm').hidden = true; $('load-sample').focus(); };
    $('clear-data').onclick = () => {
      $('sample-confirm').hidden = true;
      const d = describeData();
      $('clear-confirm-scope').textContent = d ? `清空会删除当前的${d},浏览器里的保存也会一并清除。导出过的文件不受影响。` : '清空会删除已添加的全部表格、规则和人工确认记录,浏览器里的保存也会一并清除。导出过的文件不受影响。';
      $('clear-confirm').hidden = false; $('clear-confirm-no').focus();
    };
    $('clear-confirm-no').onclick = () => { $('clear-confirm').hidden = true; };
    $('clear-confirm-yes').onclick = () => {
      state = { tables: [], rules: Object.assign({}, C.DEFAULT_RULES), confirmed: [], masters: [], sample: false };
      parsed.clear(); run = null;
      let ok = true;
      try { localStorage.removeItem(KEY); } catch (e) { ok = false; }
      $('clear-confirm').hidden = true; $('save-alert').hidden = true;
      renderAll();
      toast(ok ? '已清空。' : '页面内数据已清空,但浏览器存储无法访问,保存的内容可能还在。', !ok);
    };
  }

  load(); bind();
  { const q = new URLSearchParams(location.search).get('today'); const n = $('today-note'); if (q && C.isValidDate(q)) { n.textContent = `基准日 ${q}(由地址参数固定)`; n.hidden = false; } }
  if (state.tables.length) doRun(); else renderAll();
})();
