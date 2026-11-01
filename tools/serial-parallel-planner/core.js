'use strict';
/* 串并联统筹板 · 纯逻辑。时间单位:分钟整数。无 DOM 依赖。 */
(function () {
  const APP = 'tongbingban';
  const VERSION = 1;
  const TYPES = ['present', 'auto'];
  const TYPE_LABEL = { present: '需要我在场', auto: '放着跑' };
  // 仅供“导出 SVG”在未传入调色板时兜底(文件需自带颜色);界面导出时由 app.js 从 CSS token 读取并传入。
  const DEFAULT_PALETTE = { present: '#3a3f47', auto: '#f08a24', text: '#1d2127', grid: '#d5d9df', bg: '#ffffff' };

  function fmtMin(m) {
    if (m < 60) return m + '分钟';
    const h = Math.floor(m / 60), r = m % 60;
    return h + '小时' + (r ? r + '分钟' : '');
  }

  function idMap(tasks) {
    const m = new Map();
    tasks.forEach((t, i) => m.set(t.id, i));
    return m;
  }
  function nameOf(tasks, id) {
    const t = tasks.find(x => x.id === id);
    return t ? t.name : id;
  }

  /* 拓扑排序:以数组顺序为优先级(稳定)。返回 {order} | {cycle,members} | {missing} */
  function topoSort(tasks) {
    const idx = idMap(tasks);
    const missing = [];
    tasks.forEach(t => (t.deps || []).forEach(d => { if (!idx.has(d)) missing.push({ id: t.id, dep: d }); }));
    if (missing.length) return { missing };
    const done = new Set();
    const order = [];
    for (let n = 0; n < tasks.length; n++) {
      const next = tasks.find(t => !done.has(t.id) && (t.deps || []).every(d => done.has(d)));
      if (!next) break;
      done.add(next.id);
      order.push(next.id);
    }
    if (order.length === tasks.length) return { order };
    // 强连通分量(Tarjan):大小 > 1 或自依赖的分量才是真正的环
    const byId = new Map(tasks.map(t => [t.id, t]));
    const index = new Map(), low = new Map(), onStack = new Set(), stack = [];
    const comps = [];
    let counter = 0;
    const strong = id => {
      index.set(id, counter); low.set(id, counter); counter++;
      stack.push(id); onStack.add(id);
      for (const d of byId.get(id).deps) {
        if (!index.has(d)) { strong(d); low.set(id, Math.min(low.get(id), low.get(d))); }
        else if (onStack.has(d)) low.set(id, Math.min(low.get(id), index.get(d)));
      }
      if (low.get(id) === index.get(id)) {
        const comp = [];
        let w;
        do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== id);
        comps.push(comp);
      }
    };
    tasks.forEach(t => { if (!index.has(t.id)) strong(t.id); });
    const cyclic = comps.filter(c => c.length > 1 || byId.get(c[0]).deps.includes(c[0]));
    const memberSet = new Set([].concat.apply([], cyclic));
    const members = tasks.filter(t => memberSet.has(t.id)).map(t => t.id);
    const first = members[0];
    const comp = new Set(cyclic.find(c => c.includes(first)));
    const seen = new Map();
    const path = [];
    let cur = first;
    while (!seen.has(cur)) {
      seen.set(cur, path.length);
      path.push(cur);
      cur = byId.get(cur).deps.find(d => comp.has(d));
    }
    return { cycle: path.slice(seen.get(cur)), members };
  }

  /* 校验任务数组顺序:order 为任务 id 的排列,每个任务必须排在其所有前置之后 */
  function validateOrder(tasks, order) {
    const ids = tasks.map(t => t.id);
    if (!Array.isArray(order) || order.length !== ids.length || new Set(order).size !== ids.length || !order.every(id => ids.includes(id))) {
      return { ok: false, reason: '顺序必须恰好包含全部任务各一次' };
    }
    const pos = new Map(order.map((id, i) => [id, i]));
    for (const t of tasks) {
      for (const d of t.deps || []) {
        if (!pos.has(d)) return { ok: false, reason: '前置任务不存在', id: t.id, dep: d };
        if (pos.get(d) > pos.get(t.id)) {
          return { ok: false, id: t.id, dep: d, reason: '「' + t.name + '」必须排在前置任务「' + nameOf(tasks, d) + '」之后' };
        }
      }
    }
    return { ok: true };
  }

  /* 上移/下移一格;违反前置则拒绝 */
  function moveTask(tasks, id, dir) {
    const i = tasks.findIndex(t => t.id === id);
    if (i < 0) return { ok: false, reason: '任务不存在' };
    const j = i + (dir < 0 ? -1 : 1);
    if (j < 0 || j >= tasks.length) return { ok: false, reason: dir < 0 ? '已经是第一项' : '已经是最后一项' };
    const next = tasks.slice();
    [next[i], next[j]] = [next[j], next[i]];
    const v = validateOrder(next, next.map(t => t.id));
    if (!v.ok) return v;
    return { ok: true, tasks: next };
  }

  /* 按拓扑序(数组顺序为优先级)重排;图非法返回 null */
  function normalizeOrder(tasks) {
    const g = topoSort(tasks);
    if (!g.order) return null;
    const byId = new Map(tasks.map(t => [t.id, t]));
    return g.order.map(id => byId.get(id));
  }

  function nextId(tasks) {
    let max = 0;
    tasks.forEach(t => { const m = /^t(\d+)$/.exec(t.id); if (m) max = Math.max(max, Number(m[1])); });
    return 't' + (max + 1);
  }

  /* 排程:放着跑任务前置完成即开始(并联,不占在场);在场任务一次只做一件,
     在场空闲时从“已就绪”的在场任务里按数组顺序挑第一个。 */
  function schedule(tasks) {
    const empty = { slots: [], total: 0, serialTotal: 0, saved: 0, savedPct: 0 };
    const g = topoSort(tasks);
    if (g.cycle) return Object.assign(empty, { error: 'cycle', cycle: g.cycle, members: g.members });
    if (g.missing) return Object.assign(empty, { error: 'missing', missing: g.missing });
    const end = new Map();
    const slots = [];
    let unscheduled = tasks.map((t, i) => i);
    let presentFree = 0;
    const depsDone = t => t.deps.every(d => end.has(d));
    const readyAt = t => t.deps.reduce((m, d) => Math.max(m, end.get(d)), t.earliest || 0);
    const place = (i, start) => {
      const t = tasks[i];
      end.set(t.id, start + t.dur);
      slots.push({ id: t.id, name: t.name, type: t.type, dur: t.dur, index: i, start, end: start + t.dur, lane: t.type, row: 0 });
      unscheduled = unscheduled.filter(x => x !== i);
    };
    while (unscheduled.length) {
      let progressed = true;
      while (progressed) {
        progressed = false;
        for (const i of unscheduled.slice()) {
          const t = tasks[i];
          if (t.type === 'auto' && depsDone(t)) { place(i, readyAt(t)); progressed = true; }
        }
      }
      const cands = unscheduled.filter(i => tasks[i].type === 'present' && depsDone(tasks[i]));
      if (!cands.length) break;
      const now = cands.filter(i => readyAt(tasks[i]) <= presentFree);
      let pick, start;
      if (now.length) { pick = now[0]; start = presentFree; }
      else {
        pick = cands.reduce((a, b) => (readyAt(tasks[b]) < readyAt(tasks[a]) ? b : a));
        start = readyAt(tasks[pick]);
      }
      place(pick, start);
      presentFree = start + tasks[pick].dur;
    }
    // 放着跑任务之间若时间重叠,分到不同行,界面上不重叠
    const rowEnds = [];
    slots.filter(s => s.lane === 'auto').sort((a, b) => a.start - b.start || a.index - b.index).forEach(s => {
      let r = rowEnds.findIndex(e => e <= s.start);
      if (r < 0) { r = rowEnds.length; rowEnds.push(0); }
      rowEnds[r] = s.end;
      s.row = r;
    });
    slots.sort((a, b) => (a.lane === b.lane ? 0 : a.lane === 'present' ? -1 : 1) || a.start - b.start || a.index - b.index);
    const total = slots.reduce((m, s) => Math.max(m, s.end), 0);
    const serialTotal = tasks.reduce((s, t) => s + t.dur, 0);
    const saved = serialTotal - total;
    return { slots, total, serialTotal, saved, savedPct: serialTotal > 0 ? Math.round((saved / serialTotal) * 100) : 0 };
  }

  /* “再多想一步”提示。“可拆”按口径:需要我在场的任务可拆,放着跑的不可拆。 */
  function hints(sched) {
    const out = [];
    const slots = (sched && sched.slots) || [];
    const total = (sched && sched.total) || 0;
    slots.forEach(s => {
      if (s.type === 'present' && total > 0 && s.dur > total * 0.3) {
        out.push({ kind: 'split', ids: [s.id], text: '「' + s.name + '」占总时长的 ' + Math.round((s.dur / total) * 100) + '%,考虑拆成两段。' });
      }
    });
    const pres = slots.filter(s => s.lane === 'present').sort((a, b) => a.start - b.start);
    let lastEmitted = -3;
    for (let i = 0; i + 2 < pres.length; i++) {
      const w = pres.slice(i, i + 3);
      const contiguous = w[1].start === w[0].end && w[2].start === w[1].end;
      const sum = w[0].dur + w[1].dur + w[2].dur;
      if (contiguous && sum > 90 && i >= lastEmitted + 3) {
        lastEmitted = i;
        out.push({ kind: 'break', ids: w.map(s => s.id), text: '连续 3 个在场任务(' + w.map(s => '「' + s.name + '」').join('、') + ')共 ' + sum + ' 分钟,超过 90 分钟,插入放着跑任务或休息。' });
      }
    }
    return out;
  }

  const MAX_TICKS = 24;
  function axisTicks(total) {
    if (!(total > 0)) return [0];
    const steps = [5, 10, 15, 20, 30, 60, 120, 240, 480, 960];
    let step = steps.find(s => total / s <= 8);
    if (!step) {
      // 超大总时长:取 1/2/5 × 10^k 中使刻度不超过 8 段的最小值
      const raw = total / 8;
      const p = Math.pow(10, Math.ceil(Math.log10(raw)));
      step = [p / 10, p / 5, p / 2, p].find(x => x >= raw) || p;
    }
    const t = [];
    for (let i = 0; i <= MAX_TICKS && i * step <= total; i++) t.push(i * step);
    return t;
  }

  function xmlEsc(s) {
    return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  function toSvg(sched, palette, opts) {
    const sample = !!(opts && opts.sample);
    const P = Object.assign({}, DEFAULT_PALETTE, palette || {});
    const slots = sched.slots;
    const labelW = 200, trackW = 720, rowH = 32, top = 40, pad = 16;
    const W = pad * 2 + labelW + trackW, H = top + slots.length * rowH + pad * 2;
    const total = sched.total || 1;
    const parts = [];
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="14">');
    parts.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="' + P.bg + '"/>');
    parts.push('<text x="' + pad + '" y="24" fill="' + P.text + '">串联 ' + xmlEsc(fmtMin(sched.serialTotal)) + ' → 统筹后 ' + xmlEsc(fmtMin(sched.total)) + '(节省 ' + sched.savedPct + '%)' + (sample ? ' · 合成示例' : '') + '</text>');
    axisTicks(sched.total).forEach(m => {
      const x = pad + labelW + (m / total) * trackW;
      parts.push('<line x1="' + x.toFixed(1) + '" y1="' + (top - 6) + '" x2="' + x.toFixed(1) + '" y2="' + (H - pad) + '" stroke="' + P.grid + '"/>');
      parts.push('<text x="' + x.toFixed(1) + '" y="' + (top - 10) + '" fill="' + P.text + '" font-size="12">' + m + '</text>');
    });
    slots.forEach((s, i) => {
      const y = top + pad + i * rowH;
      const x = pad + labelW + (s.start / total) * trackW;
      const w = Math.max((s.dur / total) * trackW, 2);
      parts.push('<text x="' + pad + '" y="' + (y + 16) + '" fill="' + P.text + '">' + xmlEsc(s.name) + '(' + (s.lane === 'auto' ? '放着跑' : '在场') + ')</text>');
      parts.push('<rect data-task="' + xmlEsc(s.id) + '" x="' + x.toFixed(1) + '" y="' + y + '" width="' + w.toFixed(1) + '" height="22" fill="' + (s.lane === 'auto' ? P.auto : P.present) + '"><title>' + xmlEsc(s.name + ' ' + s.start + '–' + s.end + ' 分钟') + '</title></rect>');
    });
    parts.push('</svg>');
    return parts.join('\n');
  }

  function guardCell(v) {
    const s = String(v);
    if (/^[=@\t\r]/.test(s)) return "'" + s;
    if (/^[+-]/.test(s) && s.length > 1) return "'" + s;
    return s;
  }
  function csvCell(v) {
    const s = guardCell(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(tasks, sched, opts) {
    const sample = !!(opts && opts.sample);
    const slot = new Map(((sched && sched.slots) || []).map(s => [s.id, s]));
    const rows = [['序号', '名称', '类型', '耗时(分钟)', '前置任务', '最早开始(分钟)', '开始(分钟)', '结束(分钟)'].concat(sample ? ['数据性质'] : [])];
    tasks.forEach((t, i) => {
      const s = slot.get(t.id);
      rows.push([i + 1, t.name, TYPE_LABEL[t.type], t.dur, t.deps.map(d => nameOf(tasks, d)).join('、'), t.earliest || 0, s ? s.start : '', s ? s.end : ''].concat(sample ? ['合成示例'] : []));
    });
    return rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  /* ---- 校验:写入前与读取后共用同一个 validateState ---- */
  function isInt(n) { return typeof n === 'number' && Number.isSafeInteger(n); }
  function validateTasks(tasks, where) {
    const errors = [];
    if (!Array.isArray(tasks)) return [where + '必须是数组'];
    const ids = new Set();
    tasks.forEach((t, i) => {
      const p = where + '第 ' + (i + 1) + ' 项';
      if (!t || typeof t !== 'object' || Array.isArray(t)) { errors.push(p + '不是对象'); return; }
      if (typeof t.id !== 'string' || !t.id) errors.push(p + ':id 必须是非空文字');
      else if (ids.has(t.id)) errors.push(p + ':id「' + t.id + '」重复');
      else ids.add(t.id);
      if (typeof t.name !== 'string' || !t.name.trim()) errors.push(p + ':名称必须是非空文字');
      if (!isInt(t.dur) || t.dur <= 0) errors.push(p + ':耗时必须是正整数(分钟)');
      if (!TYPES.includes(t.type)) errors.push(p + ':类型必须是 present 或 auto');
      if (t.earliest !== undefined && (!isInt(t.earliest) || t.earliest < 0)) errors.push(p + ':最早开始必须是非负整数(分钟)');
      if (!Array.isArray(t.deps) || t.deps.some(d => typeof d !== 'string')) errors.push(p + ':前置必须是 id 文字数组');
      else if (new Set(t.deps).size !== t.deps.length) errors.push(p + ':前置有重复');
    });
    if (errors.length) return errors;
    const g = topoSort(tasks);
    if (g.missing) g.missing.forEach(m => errors.push(where + ':任务「' + nameOf(tasks, m.id) + '」的前置「' + m.dep + '」不存在'));
    if (g.cycle) errors.push(where + ':存在循环依赖:' + g.cycle.map(id => '「' + nameOf(tasks, id) + '」').join(' → ') + ' → 「' + nameOf(tasks, g.cycle[0]) + '」');
    return errors;
  }
  function cleanTask(t) {
    return { id: t.id, name: t.name, dur: t.dur, type: t.type, deps: t.deps.slice(), earliest: t.earliest || 0 };
  }
  function validateState(obj) {
    const errors = [];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, errors: ['内容不是对象'] };
    if (obj.app !== APP) errors.push('app 必须是 ' + APP);
    if (obj.version !== VERSION) errors.push('version 必须是 ' + VERSION);
    const te = validateTasks(obj.tasks, '任务');
    errors.push.apply(errors, te);
    const templates = [];
    if (!Array.isArray(obj.templates)) errors.push('templates 必须是数组');
    else {
      const tids = new Set();
      obj.templates.forEach((tp, i) => {
        const p = '模板第 ' + (i + 1) + ' 项';
        if (!tp || typeof tp !== 'object' || Array.isArray(tp)) { errors.push(p + '不是对象'); return; }
        if (typeof tp.id !== 'string' || !tp.id) errors.push(p + ':id 必须是非空文字');
        else if (tids.has(tp.id)) errors.push(p + ':id「' + tp.id + '」重复');
        else tids.add(tp.id);
        if (typeof tp.name !== 'string' || !tp.name.trim()) errors.push(p + ':名称必须是非空文字');
        if (typeof tp.savedAt !== 'string') errors.push(p + ':savedAt 必须是文字');
        if (tp.sample !== undefined && typeof tp.sample !== 'boolean') errors.push(p + ':sample 必须是布尔值');
        errors.push.apply(errors, validateTasks(tp.tasks, p + '的任务'));
      });
    }
    if (obj.sample !== undefined && typeof obj.sample !== 'boolean') errors.push('sample 必须是布尔值');
    if (errors.length) return { ok: false, errors };
    obj.templates.forEach(tp => templates.push({ id: tp.id, name: tp.name, savedAt: tp.savedAt, sample: tp.sample === true, tasks: tp.tasks.map(cleanTask) }));
    return { ok: true, errors: [], state: { app: APP, version: VERSION, tasks: obj.tasks.map(cleanTask), templates, sample: obj.sample === true } };
  }
  const validateImport = validateState;

  function emptyState() { return { app: APP, version: VERSION, tasks: [], templates: [], sample: false }; }
  function dependentsOf(tasks, id) { return tasks.filter(t => t.deps.includes(id)); }
  function toJson(state) { return JSON.stringify(state, null, 2); }
  function parseState(text) {
    let obj;
    try { obj = JSON.parse(text); } catch (e) { return { ok: false, errors: ['不是合法的 JSON'] }; }
    return validateState(obj);
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function parseToday(search, fallback) {
    try {
      const v = new URLSearchParams(search || '').get('today');
      if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
        const [y, m, d] = v.split('-').map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d));
        const back = dt.getUTCFullYear().toString().padStart(4, '0') + '-' + pad2(dt.getUTCMonth() + 1) + '-' + pad2(dt.getUTCDate());
        if (back === v) return v;
      }
    } catch (e) { /* 回退 */ }
    return fallback;
  }

  const api = { APP, VERSION, TYPES, TYPE_LABEL, DEFAULT_PALETTE, fmtMin, topoSort, schedule, validateOrder, moveTask, normalizeOrder, nextId, hints, axisTicks, toSvg, toCsv, guardCell, validateState, validateImport, emptyState, toJson, parseState, parseToday, dependentsOf };
  globalThis.TongbingCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
