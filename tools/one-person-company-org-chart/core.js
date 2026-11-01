'use strict';
/* 一人公司组织图 · 纯逻辑(无 DOM)。浏览器里挂 globalThis.OrgChartCore,Node 里 module.exports。 */
(function () {
  const VERSION = 1;
  const STATUSES = ['idea', 'configured', 'running', 'disabled'];
  const STATUS_LABEL = { idea: '设想', configured: '已配置', running: '在跑', disabled: '停用' };
  const INTERVENTIONS = ['approve', 'proofread', 'pay', 'none'];
  const INTERVENTION_LABEL = { approve: '审批', proofread: '校对', pay: '付款', none: '无' };
  const TRIGGERS = ['manual', 'cron', 'event'];
  const TRIGGER_LABEL = { manual: '手动', cron: '定时', event: '事件' };
  const WEEKLY_MAX = 100000;
  const REMOVE_AFTER_DAYS = 30;
  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  /* 运行时布局度量(坐标计算用,不是视觉 token) */
  const METRICS = { nodeW: 148, nodeH: 96, gapX: 12, gapY: 48, pad: 16 };

  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const label = (map, k) => (has(map, k) ? map[k] : String(k));
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

  /* ---------- 日期 ---------- */
  function dayNumber(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return NaN;
    const y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
    const dt = new Date(0);
    dt.setUTCFullYear(y, m - 1, d);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return NaN;
    return Math.round(dt.getTime() / 86400000);
  }
  const isValidDate = s => !Number.isNaN(dayNumber(s));
  const daysBetween = (a, b) => dayNumber(b) - dayNumber(a);
  function localDateString(date) {
    const p = n => String(n).padStart(2, '0');
    return `${String(date.getFullYear()).padStart(4, '0')}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  }
  function resolveToday(search, fallback) {
    let v = null;
    try { v = new URLSearchParams(search || '').get('today'); } catch (e) { v = null; }
    return isValidDate(v) ? v : fallback;
  }

  /* ---------- 树 ---------- */
  function buildTree(nodes) {
    if (!Array.isArray(nodes) || nodes.length === 0) return { error: '没有节点' };
    const byId = new Map();
    for (const n of nodes) {
      if (!isObj(n) || typeof n.id !== 'string') return { error: '节点缺少 id' };
      if (byId.has(n.id)) return { error: `节点 id 重复:${n.id}` };
      byId.set(n.id, n);
    }
    const roots = nodes.filter(n => n.parentId === null || n.parentId === undefined);
    if (roots.length === 0) return { error: '没有根节点(必须有且仅有一个无上级的节点)' };
    if (roots.length > 1) return { error: `根节点必须唯一,发现 ${roots.length} 个` };
    const wrap = new Map();
    for (const n of nodes) wrap.set(n.id, { id: n.id, node: n, children: [], depth: 0 });
    for (const n of nodes) {
      if (n.parentId === null || n.parentId === undefined) continue;
      if (n.parentId === n.id) return { error: `节点「${n.name}」的上级指向自己` };
      if (!byId.has(n.parentId)) return { error: `节点「${n.name}」的上级不存在` };
      wrap.get(n.parentId).children.push(wrap.get(n.id));
    }
    const root = wrap.get(roots[0].id);
    let seen = 0;
    const stack = [root];
    while (stack.length) {
      const t = stack.pop();
      seen++;
      for (const c of t.children) { c.depth = t.depth + 1; stack.push(c); }
    }
    if (seen < nodes.length) return { error: '上级关系存在环路,有节点接不到根节点' };
    return root;
  }

  /* 先序展开整棵树;vis=false 表示被折叠的祖先隐藏 */
  function preorder(tree, collapsedSet) {
    const out = [];
    const stack = [{ t: tree, vis: true }];
    while (stack.length) {
      const { t, vis } = stack.pop();
      out.push({ t, vis });
      const childVis = vis && !collapsedSet.has(t.id);
      for (let i = t.children.length - 1; i >= 0; i--) stack.push({ t: t.children[i], vis: childVis });
    }
    return out;
  }
  const toSet = c => (c instanceof Set ? c : new Set(Array.isArray(c) ? c : []));

  function descendantCounts(order) {
    const cnt = new Map();
    for (let i = order.length - 1; i >= 0; i--) {
      const t = order[i].t;
      let s = 0;
      for (const c of t.children) s += 1 + cnt.get(c.id);
      cnt.set(t.id, s);
    }
    return cnt;
  }

  function layout(tree, collapsed, metrics) {
    const M = Object.assign({}, METRICS, metrics || {});
    const cs = toSet(collapsed);
    const order = preorder(tree, cs);
    const counts = descendantCounts(order);
    const vis = order.filter(o => o.vis).map(o => o.t);
    const pos = new Map();
    let slot = 0;
    const visibleKids = t => (cs.has(t.id) ? [] : t.children);
    for (const t of vis) {
      if (visibleKids(t).length === 0) { pos.set(t.id, slot * (M.nodeW + M.gapX)); slot++; }
    }
    for (let i = vis.length - 1; i >= 0; i--) {
      const t = vis[i];
      const ks = visibleKids(t);
      if (ks.length) pos.set(t.id, (pos.get(ks[0].id) + pos.get(ks[ks.length - 1].id)) / 2);
    }
    const nodes = vis.map(t => ({
      id: t.id, node: t.node, depth: t.depth,
      x: pos.get(t.id), y: t.depth * (M.nodeH + M.gapY), w: M.nodeW, h: M.nodeH,
      hasChildren: t.children.length > 0, collapsed: cs.has(t.id) && t.children.length > 0, hidden: cs.has(t.id) ? counts.get(t.id) : 0
    }));
    const byId = new Map(nodes.map(n => [n.id, n]));
    const links = [];
    for (const t of vis) {
      const p = byId.get(t.id);
      for (const c of visibleKids(t)) {
        const q = byId.get(c.id);
        const x1 = p.x + M.nodeW / 2, y1 = p.y + M.nodeH, x2 = q.x + M.nodeW / 2, y2 = q.y;
        const ym = y1 + M.gapY / 2;
        links.push({ from: p.id, to: q.id, d: `M${x1} ${y1}V${ym}H${x2}V${y2}` });
      }
    }
    const maxDepth = nodes.reduce((m, n) => Math.max(m, n.depth), 0);
    return {
      nodes, links,
      width: Math.max(slot, 1) * (M.nodeW + M.gapX) - M.gapX,
      height: (maxDepth + 1) * M.nodeH + maxDepth * M.gapY
    };
  }

  /* 手机端缩进列表:可见节点的先序序列 */
  function visibleList(tree, collapsed) {
    const cs = toSet(collapsed);
    const order = preorder(tree, cs);
    const counts = descendantCounts(order);
    return order.filter(o => o.vis).map(o => ({
      id: o.t.id, node: o.t.node, depth: o.t.depth,
      hasChildren: o.t.children.length > 0, collapsed: cs.has(o.t.id) && o.t.children.length > 0,
      hidden: cs.has(o.t.id) ? counts.get(o.t.id) : 0
    }));
  }

  /* ---------- 节点操作 ---------- */
  function nextId(nodes) {
    let max = 0;
    for (const n of nodes) { const m = /^n(\d+)$/.exec(n.id); if (m) max = Math.max(max, +m[1]); }
    return 'n' + (max + 1);
  }
  function descendantIds(nodes, id) {
    const kids = new Map();
    for (const n of nodes) {
      if (n.parentId == null) continue;
      if (!kids.has(n.parentId)) kids.set(n.parentId, []);
      kids.get(n.parentId).push(n.id);
    }
    const out = new Set();
    const stack = [id];
    while (stack.length) for (const c of kids.get(stack.pop()) || []) if (!out.has(c)) { out.add(c); stack.push(c); }
    return out;
  }
  function removeNode(nodes, id) {
    const target = nodes.find(n => n.id === id);
    if (!target) return { error: '节点不存在' };
    if (nodes.some(n => n.parentId === id)) return { error: '这个节点还有下级,请先删除或移走下级' };
    if (target.parentId == null && nodes.length > 1) return { error: '根节点下还有其他节点,不能删除根节点' };
    let scrubbed = 0;
    const out = [];
    for (const n of nodes) {
      if (n.id === id) continue;
      const a = (n.inputFrom || []).filter(x => x !== id), b = (n.outputTo || []).filter(x => x !== id);
      const changed = a.length !== (n.inputFrom || []).length || b.length !== (n.outputTo || []).length;
      if (changed) { scrubbed += ((n.inputFrom || []).length - a.length) + ((n.outputTo || []).length - b.length); out.push(Object.assign({}, n, { inputFrom: a, outputTo: b })); } else out.push(n);
    }
    return { nodes: out, scrubbed };
  }

  /* ---------- 校验(写入与读取共用) ---------- */
  function validateNode(n, idx) {
    const tag = isObj(n) && typeof n.name === 'string' && n.name.trim() ? `节点「${n.name}」` : `第 ${idx + 1} 个节点`;
    if (!isObj(n)) return `第 ${idx + 1} 个节点不是对象`;
    if (typeof n.id !== 'string' || !ID_RE.test(n.id)) return `${tag}:id 必须是 1 到 64 位字母、数字、下划线或短横线`;
    if (typeof n.name !== 'string' || !n.name.trim()) return `${tag}:岗位名不能为空`;
    if (typeof n.duty !== 'string') return `${tag}:职责必须是文本`;
    if (!isObj(n.trigger) || !TRIGGERS.includes(n.trigger.kind) || typeof n.trigger.text !== 'string') return `${tag}:触发方式必须是 手动 / 定时 / 事件,并带文本`;
    if (!STATUSES.includes(n.status)) return `${tag}:状态必须是 设想 / 已配置 / 在跑 / 停用`;
    if (!Array.isArray(n.interventions) || n.interventions.length === 0 || n.interventions.some(x => !INTERVENTIONS.includes(x))) return `${tag}:人工干预点必须从 审批 / 校对 / 付款 / 无 中至少选一项`;
    if (new Set(n.interventions).size !== n.interventions.length) return `${tag}:人工干预点有重复`;
    if (n.interventions.includes('none') && n.interventions.length > 1) return `${tag}:选了「无」就不能同时选其他干预点`;
    if (n.parentId !== null && (typeof n.parentId !== 'string' || !ID_RE.test(n.parentId))) return `${tag}:上级必须是节点 id 或 null`;
    if (n.parentId === n.id) return `${tag}:上级不能指向自己`;
    for (const key of ['inputFrom', 'outputTo']) {
      const a = n[key];
      const name = key === 'inputFrom' ? '输入来源' : '输出对象';
      if (!Array.isArray(a) || a.some(x => typeof x !== 'string')) return `${tag}:${name}必须是节点 id 列表`;
      if (new Set(a).size !== a.length) return `${tag}:${name}有重复`;
      if (a.includes(n.id)) return `${tag}:${name}不能是自己`;
    }
    if (typeof n.runningSince !== 'string' || (n.runningSince !== '' && !isValidDate(n.runningSince))) return `${tag}:在跑起始日必须是真实存在的 YYYY-MM-DD 日期或留空`;
    if (!Number.isInteger(n.weekly) || n.weekly < 0 || n.weekly > WEEKLY_MAX) return `${tag}:每周人工干预次数必须是 0 到 ${WEEKLY_MAX} 的整数`;
    return null;
  }

  function validateState(s) {
    if (!isObj(s)) return { ok: false, error: '数据不是对象' };
    if (s.version !== VERSION) return { ok: false, error: `不支持的数据版本:${String(s.version)}(需要 ${VERSION})` };
    if (!Array.isArray(s.nodes)) return { ok: false, error: 'nodes 必须是数组' };
    if (!Array.isArray(s.collapsed) || s.collapsed.some(x => typeof x !== 'string')) return { ok: false, error: 'collapsed 必须是节点 id 数组' };
    if (s.sample !== undefined && typeof s.sample !== 'boolean') return { ok: false, error: 'sample 必须是布尔值' };
    const seen = new Set();
    for (let i = 0; i < s.nodes.length; i++) {
      const err = validateNode(s.nodes[i], i);
      if (err) return { ok: false, error: err };
      if (seen.has(s.nodes[i].id)) return { ok: false, error: `节点 id 重复:${s.nodes[i].id}` };
      seen.add(s.nodes[i].id);
    }
    if (s.nodes.length) {
      const t = buildTree(s.nodes);
      if (t.error) return { ok: false, error: t.error };
    }
    return { ok: true, state: s };
  }

  function validateImport(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { return { ok: false, error: '不是合法的 JSON 文件' }; }
    return validateState(data);
  }
  const emptyState = () => ({ version: VERSION, nodes: [], collapsed: [], sample: false });
  const serialize = s => JSON.stringify({ app: 'orgchart', version: s.version, nodes: s.nodes, collapsed: s.collapsed, sample: s.sample === true }, null, 2);

  /* ---------- 数据流 ---------- */
  function flowEdges(nodes) {
    const byId = new Map(nodes.map(n => [n.id, n]));
    const edges = [];
    const keys = new Set();
    const missing = [];
    const add = (a, b) => { const k = a + '\u0000' + b; if (!keys.has(k)) { keys.add(k); edges.push([a, b]); } };
    for (const n of nodes) {
      for (const t of n.outputTo || []) { if (byId.has(t)) add(n.id, t); else missing.push({ kind: 'missing-target', node: n, ref: t }); }
      for (const f of n.inputFrom || []) { if (byId.has(f)) add(f, n.id); else missing.push({ kind: 'missing-source', node: n, ref: f }); }
    }
    return { byId, edges, missing };
  }

  function sccs(ids, adj) {
    let index = 0;
    const idx = new Map(), low = new Map(), on = new Set(), st = [], out = [];
    for (const s of ids) {
      if (idx.has(s)) continue;
      const call = [[s, 0]];
      idx.set(s, index); low.set(s, index); index++; st.push(s); on.add(s);
      while (call.length) {
        const top = call[call.length - 1];
        const v = top[0];
        const ws = adj.get(v) || [];
        if (top[1] < ws.length) {
          const w = ws[top[1]++];
          if (!idx.has(w)) { idx.set(w, index); low.set(w, index); index++; st.push(w); on.add(w); call.push([w, 0]); }
          else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
        } else {
          call.pop();
          if (call.length) { const p = call[call.length - 1][0]; low.set(p, Math.min(low.get(p), low.get(v))); }
          if (low.get(v) === idx.get(v)) {
            const comp = [];
            let w;
            do { w = st.pop(); on.delete(w); comp.push(w); } while (w !== v);
            out.push(comp);
          }
        }
      }
    }
    return out;
  }

  /* level: block 阻断 / warn 警告 / info 提示(允许) */
  function flowIssues(nodes) {
    const { byId, edges, missing } = flowEdges(nodes);
    const issues = [];
    for (const m of missing) {
      if (m.kind === 'missing-source') issues.push({ level: 'block', kind: 'missing-source', nodeIds: [m.node.id], message: `「${m.node.name}」的输入来源不存在(引用了 ${m.ref}),先改掉或删除这条输入` });
      else issues.push({ level: 'block', kind: 'missing-target', nodeIds: [m.node.id], message: `「${m.node.name}」的输出对象不存在(引用了 ${m.ref}),先改掉或删除这条输出` });
    }
    const hasChild = new Set(nodes.filter(n => n.parentId != null).map(n => n.parentId));
    const outgoing = new Set(edges.map(e => e[0]));
    for (const n of nodes) {
      if (n.parentId == null || hasChild.has(n.id)) continue;
      if (!outgoing.has(n.id)) issues.push({ level: 'warn', kind: 'no-receiver', nodeIds: [n.id], message: `「${n.name}」的产出没人用:没有任何节点接收它的输出` });
    }
    const adj = new Map();
    for (const [a, b] of edges) { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); }
    const order = nodes.map(n => n.id);
    const pos = new Map(order.map((id, i) => [id, i]));
    for (const comp of sccs(order, adj)) {
      if (comp.length < 2) continue;
      comp.sort((x, y) => pos.get(x) - pos.get(y));
      const names = comp.map(id => `「${byId.get(id).name}」`);
      issues.push({ level: 'info', kind: 'cycle', nodeIds: comp, message: `数据流环路:${names.join(' ↔ ')}(提示,允许保留)` });
    }
    const rank = { block: 0, warn: 1, info: 2 };
    return issues.sort((a, b) => rank[a.level] - rank[b.level]);
  }
  /* 节点引用里指向不存在节点的 id(导入的备份可能带来) */
  function missingRefs(nodes, node) {
    const ids = new Set(nodes.map(n => n.id));
    return { inputFrom: (node.inputFrom || []).filter(x => !ids.has(x)), outputTo: (node.outputTo || []).filter(x => !ids.has(x)) };
  }
  const hasBlock = issues => issues.some(i => i.level === 'block');

  /* ---------- 自动化度 ---------- */
  function automationStats(nodes) {
    const list = nodes.filter(n => n.parentId != null);
    const total = list.length;
    const byStatus = { idea: 0, configured: 0, running: 0, disabled: 0 };
    let withIntervention = 0, weeklyTotal = 0;
    for (const n of list) {
      if (has(byStatus, n.status)) byStatus[n.status]++;
      if (!(n.interventions || []).includes('none') && (n.interventions || []).length) withIntervention++;
      weeklyTotal += Number.isFinite(n.weekly) ? n.weekly : 0;
    }
    return {
      total, running: byStatus.running, byStatus, withIntervention, weeklyTotal,
      runningRatio: total ? byStatus.running / total : 0,
      interventionRatio: total ? withIntervention / total : 0
    };
  }

  /* 候选:在跑 + 干预点含「校对」+ 起始日已填且已跑 ≥ 30 天;取跑得最久的 */
  function nextInterventionToRemove(nodes, today) {
    if (!isValidDate(today)) return null;
    let best = null;
    for (const n of nodes) {
      if (n.status !== 'running' || !(n.interventions || []).includes('proofread') || !isValidDate(n.runningSince)) continue;
      const days = daysBetween(n.runningSince, today);
      if (days < REMOVE_AFTER_DAYS) continue;
      const weekly = Number.isFinite(n.weekly) ? n.weekly : 0;
      if (!best || days > best.days || (days === best.days && weekly > best.weekly)) best = { id: n.id, name: n.name, days, weekly };
    }
    return best;
  }

  /* ---------- 文本导出 ---------- */
  const oneLine = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const guard = s => { s = String(s == null ? '' : s); return s === '-' || s === '+' ? s : (/^[=+\-@\t\r]/.test(s) ? "'" + s : s); };
  const csvCell = s => { const g = guard(s); return /[",\r\n]/.test(g) ? '"' + g.replace(/"/g, '""') + '"' : g; };

  function toCsv(nodes, opts) {
    const sample = !!(opts && opts.sample);
    const byId = new Map(nodes.map(n => [n.id, n]));
    const nm = id => (byId.has(id) ? byId.get(id).name : id);
    const head = ['id', '岗位', '上级', '职责', '输入来自', '输出给', '触发方式', '触发说明', '状态', '人工干预点', '在跑起始日', '每周干预次数'].concat(sample ? ['数据性质'] : []);
    const rows = nodes.map(n => [
      n.id, n.name, n.parentId == null ? '' : nm(n.parentId), n.duty,
      (n.inputFrom || []).map(nm).join('；'), (n.outputTo || []).map(nm).join('；'),
      label(TRIGGER_LABEL, n.trigger && n.trigger.kind), n.trigger ? n.trigger.text : '',
      label(STATUS_LABEL, n.status), (n.interventions || []).map(k => label(INTERVENTION_LABEL, k)).join('；'),
      n.runningSince, String(n.weekly)
    ].concat(sample ? ['合成示例'] : []));
    return [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  const fenceFor = text => {
    let longest = 0;
    for (const m of String(text).matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
    return '`'.repeat(Math.max(3, longest + 1));
  };
  const safeSegment = s => (oneLine(s).replace(/[\\/:*?"<>|]/g, '_') || '未命名');

  function agentFile(n, ctx) {
    const nameOf = id => oneLine(ctx.byId.get(id).name);
    const ins = ctx.edges.filter(e => e[1] === n.id).map(e => nameOf(e[0]));
    const outs = ctx.edges.filter(e => e[0] === n.id).map(e => nameOf(e[1]));
    const ints = n.interventions.filter(k => k !== 'none').map(k => label(INTERVENTION_LABEL, k));
    const trig = n.trigger.kind === 'manual' ? '手动' : `${label(TRIGGER_LABEL, n.trigger.kind)}(${oneLine(n.trigger.text) || '未填'})`;
    const lines = [
      `# ${oneLine(n.name)}`, '',
      `- 职责:${oneLine(n.duty) || '(待补)'}`,
      `- 输入:${ins.length ? ins.map(x => `来自「${x}」`).join('、') : '无'}`,
      `- 输出:${outs.length ? outs.map(x => `给「${x}」`).join('、') : '无'}`,
      `- 触发:${trig}`,
      `- 人工干预点:${ints.length ? ints.join('、') : '无'}`,
      `- 当前状态:${label(STATUS_LABEL, n.status)}`, '',
      '## 验收', ''
    ];
    if (outs.length) for (const o of outs) lines.push(`- [ ] 输出已交给「${o}」,对方能直接读取`);
    else lines.push('- [ ] 确认这个岗位不需要输出,或补上接收方');
    if (ints.length) for (const i of ints) lines.push(`- [ ] 人工干预点「${i}」有明确的通过 / 退回标准`);
    else lines.push('- [ ] 全程无需人工介入,出错时有通知');
    lines.push(n.trigger.kind === 'manual' ? '- [ ] 手动触发一次,结果符合预期' : `- [ ] 触发方式「${trig}」连续运行 3 次,结果符合预期`);
    return lines.join('\n');
  }

  function toAgentMarkdown(nodes, opts) {
    const tree = buildTree(nodes);
    if (tree.error) return '';
    const ctx = flowEdges(nodes);
    // 迭代版先序,避免极深树爆栈;根节点也导出
    const uniq = (used, base) => {
      let seg = base, n = 2;
      while (used.has(seg)) seg = `${base}-${n++}`;
      used.add(seg);
      return seg;
    };
    const stack = [{ t: tree, segs: [safeSegment(tree.node.name)] }];
    const ordered = [];
    while (stack.length) {
      const { t, segs } = stack.pop();
      ordered.push({ t, segs });
      const used = new Set();
      const kids = t.children.map(c => ({ t: c, segs: segs.concat(uniq(used, safeSegment(c.node.name))) }));
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    }
    const out = [`# ${oneLine(tree.node.name)} · 组织骨架`, '', '每个节点一个文件夹,里面放一个 AGENT.md。下面先给目录树,再给每个 AGENT.md 的内容。', ''];
    if (opts && opts.sample) out.push('> 合成示例:这份骨架来自虚构的演示数据,不是真实配置。', '');
    out.push('## 目录树', '');
    for (const o of ordered) out.push(`${'  '.repeat(o.t.depth)}- ${o.segs[o.segs.length - 1]}/AGENT.md`);
    out.push('');
    for (const o of ordered) {
      const body = agentFile(o.t.node, ctx);
      const fence = fenceFor(body);
      out.push(`${'#'.repeat(Math.min(6, o.t.depth + 2))} ${o.segs.join('/')}/AGENT.md`, '', fence + 'markdown', body, fence, '');
    }
    return out.join('\n');
  }

  /* ---------- SVG ---------- */
  const DEFAULT_PALETTE = {
    bg: '#ffffff', ink: '#1f2933', line: '#3e4c59', rootFill: '#1f2933', rootInk: '#ffffff',
    status: {
      idea: { fill: '#eef0f3', stroke: '#7b8794' }, configured: { fill: '#e1edfb', stroke: '#1f5aa6' },
      running: { fill: '#e0f3e6', stroke: '#1d7042' }, disabled: { fill: '#fbe9d9', stroke: '#a5500c' }
    }
  };
  const xmlEsc = s => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const clip = (s, n) => { const a = Array.from(oneLine(s)); return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join(''); };

  function toSvg(nodes, opts) {
    const o = opts || {};
    const tree = buildTree(nodes);
    if (tree.error) return '';
    const P = Object.assign({}, DEFAULT_PALETTE, o.palette || {});
    P.status = Object.assign({}, DEFAULT_PALETTE.status, (o.palette && o.palette.status) || {});
    const L = layout(tree, o.collapsed);
    const pad = METRICS.pad;
    const W = L.width + pad * 2, H = L.height + pad * 2;
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif">`,
      `<rect width="${W}" height="${H}" fill="${xmlEsc(P.bg)}"/>`, `<g transform="translate(${pad} ${pad})">`];
    if (o.sample) parts.splice(1, 0, '<title>合成示例:一人公司组织图</title>');
    if (o.sample) parts.push(`<text x="0" y="${H - pad * 2}" font-size="14" fill="${xmlEsc(P.ink)}">合成示例,不是真实配置</text>`);
    for (const l of L.links) parts.push(`<path class="org-link" d="${l.d}" fill="none" stroke="${xmlEsc(P.line)}" stroke-width="2"/>`);
    for (const n of L.nodes) {
      const root = n.node.parentId == null;
      const st = P.status[n.node.status] || P.status.idea;
      const fill = root ? P.rootFill : st.fill, stroke = root ? P.rootFill : st.stroke, ink = root ? P.rootInk : P.ink;
      const dash = n.node.status === 'idea' && !root ? ' stroke-dasharray="6 4"' : '';
      const cx = n.x + n.w / 2;
      parts.push(`<g class="org-node"><title>${xmlEsc(oneLine(n.node.duty) || oneLine(n.node.name))}</title>` +
        `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="6" fill="${xmlEsc(fill)}" stroke="${xmlEsc(stroke)}" stroke-width="3"${dash}/>` +
        `<text x="${cx}" y="${n.y + n.h / 2 - 4}" text-anchor="middle" font-size="18" font-weight="700" fill="${xmlEsc(ink)}">${xmlEsc(clip(n.node.name, 9))}</text>` +
        `<text x="${cx}" y="${n.y + n.h / 2 + 24}" text-anchor="middle" font-size="16" fill="${xmlEsc(ink)}">${xmlEsc(label(STATUS_LABEL, n.node.status))}${n.collapsed ? `(+${n.hidden})` : ''}</text></g>`);
    }
    parts.push('</g></svg>');
    return parts.join('');
  }

  function referencesTo(nodes, id) {
    const out = [];
    for (const n of nodes) {
      if (n.id === id) continue;
      const count = (n.inputFrom || []).filter(x => x === id).length + (n.outputTo || []).filter(x => x === id).length;
      if (count) out.push({ id: n.id, name: n.name, count });
    }
    return out;
  }

  const api = {
    VERSION, STATUSES, STATUS_LABEL, INTERVENTIONS, INTERVENTION_LABEL, TRIGGERS, TRIGGER_LABEL, WEEKLY_MAX, REMOVE_AFTER_DAYS, METRICS, DEFAULT_PALETTE,
    isValidDate, daysBetween, localDateString, resolveToday,
    buildTree, layout, visibleList, nextId, descendantIds, removeNode, referencesTo,
    validateNode, validateState, validateImport, emptyState, serialize,
    flowEdges, flowIssues, hasBlock, missingRefs, automationStats, nextInterventionToRemove,
    toCsv, toAgentMarkdown, toSvg, guard
  };
  globalThis.OrgChartCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
