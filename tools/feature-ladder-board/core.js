'use strict';
/* 功能阶梯取舍板 · 纯逻辑(无 DOM)。规则来自作者自用的「三道门」开发流程,不是通用方法论。 */

const GATES = [1, 2, 3];
const MOSCOW = ['must', 'should', 'could', 'wont'];
const LAYERS = ['unit', 'integration', 'e2e', 'screenshot', 'real'];
const STATUSES = ['todo', 'doing', 'done', 'cut'];
const MUST_LIMIT = 7;
const HOURS_LIMIT = 16;
const DEFAULT_KEYWORDS = ['登录', '支付', '数据库', '服务端'];
const FORMAT = 'ladder-board';
const VERSION = 1;

const LABELS = {
  gate: { 1: '门 1 自用', 2: '门 2 他人可用', 3: '门 3 付费' },
  moscow: { must: 'Must', should: 'Should', could: 'Could', wont: "Won't" },
  layer: { unit: '单测', integration: '集成', e2e: 'E2E', screenshot: '截图', real: '真实依赖' },
  status: { todo: '未做', doing: '做中', done: '已做', cut: '已砍' },
};
const CRITERIA = {
  1: '门 1 过门证据:usage-log 至少 3 条真实使用记录',
  2: '门 2 过门证据:1 个非本人用户完成了任务 + 1 条反馈',
  3: '门 3 过门证据:有人说出愿意付多少钱买',
};

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = v => (typeof v === 'string' ? v : '');

function newProject() {
  return { name: '', keywords: DEFAULT_KEYWORDS.slice(), evidence: { 1: '', 2: '', 3: '' }, features: [], synthetic: false };
}

/* ---------- 校验(保存、读取、导入共用同一套) ---------- */

function validateFeature(f) {
  const errors = [];
  if (!isObj(f)) return { ok: false, errors: ['功能不是对象'] };
  if (typeof f.id !== 'string' || f.id.trim() === '') errors.push('id 必须是非空字符串');
  if (typeof f.name !== 'string' || f.name.trim() === '') errors.push('功能名不能为空');
  if (typeof f.task !== 'string') errors.push('用户任务必须是字符串');
  if (!Number.isInteger(f.gate) || !GATES.includes(f.gate)) errors.push('所属门必须是 1、2、3');
  if (!MOSCOW.includes(f.moscow)) errors.push('MoSCoW 必须是 must/should/could/wont');
  if (typeof f.hours !== 'number' || !Number.isFinite(f.hours) || f.hours < 0) errors.push('预计小时必须是不小于 0 的有限数字');
  if (!Array.isArray(f.deps) || f.deps.some(d => typeof d !== 'string')) errors.push('依赖必须是功能 id 的数组');
  if (f.layer !== '' && !LAYERS.includes(f.layer)) errors.push('验证层必须为空或 unit/integration/e2e/screenshot/real');
  if (!STATUSES.includes(f.status)) errors.push('状态必须是 todo/doing/done/cut');
  return { ok: errors.length === 0, errors };
}

function validateProject(p) {
  const errors = [];
  if (!isObj(p)) return { ok: false, errors: ['项目不是对象'] };
  if (typeof p.name !== 'string') errors.push('项目名必须是字符串');
  if (!Array.isArray(p.keywords) || p.keywords.some(k => typeof k !== 'string')) errors.push('关键词表必须是字符串数组');
  if (!isObj(p.evidence) || [1, 2, 3].some(g => typeof p.evidence[g] !== 'string')) errors.push('过门证据必须包含 1、2、3 三个字符串字段');
  if (p.synthetic !== undefined && typeof p.synthetic !== 'boolean') errors.push('synthetic 必须是布尔值');
  if (!Array.isArray(p.features)) { errors.push('features 必须是数组'); return { ok: false, errors }; }
  const ids = new Set();
  p.features.forEach((f, i) => {
    const r = validateFeature(f);
    const label = `第 ${i + 1} 个功能${isObj(f) && typeof f.name === 'string' && f.name ? `「${f.name}」` : ''}`;
    r.errors.forEach(e => errors.push(`${label}:${e}`));
    if (isObj(f) && typeof f.id === 'string') {
      if (ids.has(f.id)) errors.push(`${label}:id「${f.id}」重复`);
      ids.add(f.id);
    }
  });
  p.features.forEach((f, i) => {
    if (isObj(f) && Array.isArray(f.deps)) {
      f.deps.forEach(d => { if (typeof d === 'string' && !ids.has(d)) errors.push(`第 ${i + 1} 个功能:依赖的 id「${d}」不存在`); });
    }
  });
  return { ok: errors.length === 0, errors };
}
const validateState = validateProject;

function toJson(project) {
  return JSON.stringify({ format: FORMAT, version: VERSION, project }, null, 2);
}

function validateImport(input) {
  let obj = input;
  if (typeof input === 'string') {
    try { obj = JSON.parse(input); } catch (e) { return { ok: false, error: 'JSON 解析失败:' + e.message, errors: ['JSON 解析失败'] }; }
  }
  if (!isObj(obj)) return fail(['文件内容不是对象']);
  if (obj.format !== FORMAT) return fail([`format 必须是「${FORMAT}」`]);
  if (obj.version !== VERSION) return fail([`version 必须是 ${VERSION}`]);
  const r = validateProject(obj.project);
  if (!r.ok) return fail(r.errors);
  return { ok: true, error: '', errors: [], project: JSON.parse(JSON.stringify(obj.project)) };
  function fail(errors) {
    const shown = errors.slice(0, 5).join(';');
    return { ok: false, errors, error: errors.length > 5 ? `${shown};另有 ${errors.length - 5} 条问题` : shown };
  }
}

function parseKeywords(text) {
  const seen = new Set();
  const out = [];
  String(text).split(/[,，、;；\n\r]+/).map(s => s.trim()).filter(Boolean).forEach(k => { if (!seen.has(k)) { seen.add(k); out.push(k); } });
  return out;
}

function nextId(features) {
  const used = new Set(features.map(f => f.id));
  let n = features.length + 1;
  while (used.has('f' + n)) n++;
  return 'f' + n;
}

/* ---------- 依赖环(Tarjan 强连通分量,迭代实现) ---------- */

function detectCycle(features) {
  const order = new Map();
  features.forEach((f, i) => order.set(f.id, i));
  const adj = new Map();
  features.forEach(f => adj.set(f.id, (f.deps || []).filter(d => order.has(d))));
  const idx = new Map(); const low = new Map(); const onStack = new Set();
  const stack = []; const result = [];
  let counter = 0;
  features.forEach(root => {
    if (idx.has(root.id)) return;
    const work = [];
    const open = v => { idx.set(v, counter); low.set(v, counter); counter++; stack.push(v); onStack.add(v); work.push({ v, i: 0 }); };
    open(root.id);
    while (work.length) {
      const fr = work[work.length - 1];
      const ws = adj.get(fr.v);
      if (fr.i < ws.length) {
        const w = ws[fr.i++];
        if (!idx.has(w)) open(w);
        else if (onStack.has(w)) low.set(fr.v, Math.min(low.get(fr.v), idx.get(w)));
      } else {
        work.pop();
        if (low.get(fr.v) === idx.get(fr.v)) {
          const comp = [];
          let w;
          do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== fr.v);
          if (comp.length > 1 || adj.get(fr.v).includes(fr.v)) result.push(comp.sort((a, b) => order.get(a) - order.get(b)));
        }
        if (work.length) { const p = work[work.length - 1]; low.set(p.v, Math.min(low.get(p.v), low.get(fr.v))); }
      }
    }
  });
  return result.sort((a, b) => order.get(a[0]) - order.get(b[0]));
}

/* ---------- 规则检查 ---------- */

const isLive = f => f.status !== 'cut';
const isActive = f => f.status !== 'cut' && f.moscow !== 'wont';

function check(project) {
  const features = (project && project.features) || [];
  const keywords = ((project && project.keywords) || []).map(k => k.trim().toLowerCase()).filter(Boolean);
  const byId = new Map(features.map(f => [f.id, f]));
  const issues = [];
  const add = (level, code, ids, message) => issues.push({ level, code, ids, feature: ids.map(id => byId.get(id).name).join('、'), message });

  const musts = features.filter(f => f.moscow === 'must' && isLive(f));
  if (musts.length > MUST_LIMIT) add('block', 'must_limit', musts.map(f => f.id), `Must 有 ${musts.length} 个,超过上限 ${MUST_LIMIT}:${musts.map(f => `「${f.name}」`).join('')}`);
  musts.filter(f => f.layer === '').forEach(f => add('block', 'must_no_layer', [f.id], `Must 功能「${f.name}」没有验证层`));
  features.filter(f => f.gate === 1 && isActive(f)).forEach(f => {
    const text = (f.name + ' ' + f.task).toLowerCase();
    const hit = keywords.filter(k => text.includes(k));
    if (hit.length) add('block', 'gate1_keyword', [f.id], `门 1 功能「${f.name}」含关键词「${hit.join('」「')}」,门 1 不应出现`);
  });
  detectCycle(features).forEach(c => add('block', 'cycle', c, c.length === 1 ? `功能「${byId.get(c[0]).name}」依赖了自己` : `依赖环:${c.map(id => `「${byId.get(id).name}」`).join('')}互相依赖`));
  features.filter(isActive).forEach(f => {
    f.deps.forEach(d => {
      const t = byId.get(d);
      if (t && (t.status === 'cut' || t.moscow === 'wont')) add('block', 'dep_cut', [f.id, t.id], `功能「${f.name}」依赖了${t.status === 'cut' ? '已砍' : "Won't"}功能「${t.name}」`);
    });
  });

  if (features.length > 0 && !features.some(f => f.moscow === 'wont')) add('warn', 'no_wont', [], "Won't 为空:没有写下任何明确不做的功能,等于没有真实取舍");
  const shoulds = features.filter(f => f.moscow === 'should' && isLive(f));
  const coulds = features.filter(f => f.moscow === 'could' && isLive(f));
  if (coulds.length > musts.length + shoulds.length) add('warn', 'could_many', coulds.map(f => f.id), `Could 有 ${coulds.length} 个,多于 Must + Should(${musts.length + shoulds.length} 个)`);
  features.filter(f => isLive(f) && f.hours > HOURS_LIMIT).forEach(f => add('warn', 'big_hours', [f.id], `功能「${f.name}」预计 ${f.hours} 小时,超过 ${HOURS_LIMIT} 小时,建议拆分`));
  features.filter(f => isActive(f) && f.gate === 2).forEach(f => {
    f.deps.forEach(d => {
      const t = byId.get(d);
      if (t && t.gate === 3 && isActive(t)) add('warn', 'gate_order', [f.id, t.id], `门 2 功能「${f.name}」依赖门 3 功能「${t.name}」,门 3 被迫排在门 2 之前`);
    });
  });
  const openGate2 = features.filter(f => f.gate === 2 && isActive(f) && f.status !== 'done');
  if (openGate2.length) {
    features.filter(f => f.gate === 3 && isActive(f) && (f.status === 'doing' || f.status === 'done')).forEach(f => {
      add('warn', 'gate_order', [f.id], `门 3 功能「${f.name}」已${f.status === 'done' ? '做完' : '开工'},但门 2 还有 ${openGate2.length} 个功能未完成`);
    });
  }

  const hoursByGate = { 1: 0, 2: 0, 3: 0 };
  features.filter(isActive).forEach(f => { hoursByGate[f.gate] += f.hours; });
  const counts = { must: 0, should: 0, could: 0, wont: 0 };
  features.filter(isLive).forEach(f => { counts[f.moscow]++; });
  const stats = {
    total: features.length, counts, hoursByGate,
    totalHours: hoursByGate[1] + hoursByGate[2] + hoursByGate[3],
    block: issues.filter(i => i.level === 'block').length,
    warn: issues.filter(i => i.level === 'warn').length,
  };
  return { issues, stats };
}

/* ---------- 表单草稿预览(提交前即时重算,不改动已保存数据) ---------- */

function parseHours(text) {
  const t = String(text).trim();
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return NaN;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function applyDraft(project, feature) {
  const next = JSON.parse(JSON.stringify(project));
  const i = next.features.findIndex(f => f.id === feature.id);
  if (i >= 0) next.features[i] = JSON.parse(JSON.stringify(feature));
  else next.features.push(JSON.parse(JSON.stringify(feature)));
  return next;
}

/* ---------- 阶梯视图、过门、移动 ---------- */

function ladder(features) {
  return GATES.map(gate => {
    const groups = { must: [], should: [], could: [], wont: [] };
    let hours = 0; let count = 0;
    features.filter(f => f.gate === gate).forEach(f => {
      groups[f.moscow].push(f);
      count++;
      if (isActive(f)) hours += f.hours;
    });
    return { gate, groups, hours, count };
  });
}

function gateStatus(project) {
  const ev = (project && project.evidence) || {};
  const out = [];
  GATES.forEach(gate => {
    const text = str(ev[gate]).trim();
    const passed = text !== '';
    const blocker = out.find(g => !g.passed);
    out.push({
      gate, passed, evidence: text, criteria: CRITERIA[gate],
      locked: Boolean(blocker),
      hint: blocker ? `先拿证据:${LABELS.gate[blocker.gate]}还没有过门证据` : '',
    });
  });
  return out;
}

function move(feature, gate, moscow) {
  const g = gate === undefined || gate === null ? feature.gate : gate;
  const m = moscow === undefined || moscow === null ? feature.moscow : moscow;
  if (!Number.isInteger(g) || !GATES.includes(g)) throw new RangeError('门必须是 1、2、3');
  if (!MOSCOW.includes(m)) throw new RangeError('MoSCoW 必须是 must/should/could/wont');
  return Object.assign({}, feature, { gate: g, moscow: m });
}

/* ---------- 导出 ---------- */

const FORMULA = /^[=+\-@\t\r]./s;
function guard(v) {
  const s = String(v);
  return FORMULA.test(s) ? "'" + s : s;
}
function mdCell(v) {
  return guard(String(v).replace(/\r\n|\r|\n/g, ' ')).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}
function csvCell(v) {
  const s = guard(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv(project) {
  const byId = new Map(project.features.map(f => [f.id, f]));
  const head = ['ID', '功能名', '用户任务', '所属门', 'MoSCoW', '预计小时', '依赖', '验证层', '状态'];
  const rows = project.features.map(f => [
    f.id, f.name, f.task, LABELS.gate[f.gate], LABELS.moscow[f.moscow], f.hours,
    f.deps.map(d => (byId.has(d) ? byId.get(d).name : d)).join('; '),
    f.layer ? LABELS.layer[f.layer] : '', LABELS.status[f.status],
  ]);
  return [head].concat(rows).map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function toPrdMarkdown(project) {
  const { issues, stats } = check(project);
  const features = project.features;
  const musts = features.filter(f => f.moscow === 'must' && isLive(f));
  const wonts = features.filter(f => f.moscow === 'wont');
  const title = (project.name || '未命名项目').replace(/\r\n|\r|\n/g, ' ');
  const L = [];
  L.push(`# ${title} · PRD 片段`, '');
  L.push(`> 由功能阶梯取舍板生成。规则检查:阻断 ${stats.block} 条,警告 ${stats.warn} 条。${stats.block ? '阻断未清零,Must 清单还不能当作定稿。' : ''}`.trim(), '');
  L.push(`## Must 清单(${musts.length} 个,上限 ${MUST_LIMIT})`, '');
  if (musts.length === 0) L.push('(暂无 Must 功能)');
  else {
    L.push('| 功能 | 用户任务 | 所属门 | 验证层 | 预计小时 | 状态 |', '| --- | --- | --- | --- | --- | --- |');
    musts.forEach(f => L.push(`| ${[f.name, f.task, LABELS.gate[f.gate], f.layer ? LABELS.layer[f.layer] : '未定', f.hours, LABELS.status[f.status]].map(mdCell).join(' | ')} |`));
  }
  L.push('', '## 验证层分布', '');
  const byLayer = new Map();
  musts.forEach(f => { const k = f.layer || ''; if (!byLayer.has(k)) byLayer.set(k, []); byLayer.get(k).push(f.name); });
  if (byLayer.size === 0) L.push('(暂无)');
  LAYERS.concat(['']).forEach(k => {
    if (byLayer.has(k)) L.push(`- ${k ? LABELS.layer[k] : '未定'}:${byLayer.get(k).map(n => n.replace(/\r\n|\r|\n/g, ' ')).join('、')}`);
  });
  L.push('', `## ${LABELS.moscow.wont}(明确不做,${wonts.length} 个)`, '');
  if (wonts.length === 0) L.push('(空:还没有写下任何明确不做的功能)');
  else wonts.forEach(f => L.push(`- ${f.name.replace(/\r\n|\r|\n/g, ' ')}${f.task ? ':' + f.task.replace(/\r\n|\r|\n/g, ' ') : ''}`));
  if (issues.some(i => i.level === 'block')) {
    L.push('', '## 未解决的阻断', '');
    issues.filter(i => i.level === 'block').forEach(i => L.push(`- ${i.message.replace(/\r\n|\r|\n/g, ' ')}`));
  }
  return L.join('\n') + '\n';
}

const api = {
  GATES, MOSCOW, LAYERS, STATUSES, MUST_LIMIT, HOURS_LIMIT, DEFAULT_KEYWORDS, LABELS, CRITERIA, FORMAT, VERSION,
  newProject, nextId, parseKeywords,
  validateFeature, validateProject, validateState, validateImport, toJson,
  parseHours, applyDraft, detectCycle, check, ladder, gateStatus, move, toPrdMarkdown, toCsv,
};
globalThis.LadderCore = api;
if (typeof module !== 'undefined') module.exports = api;
