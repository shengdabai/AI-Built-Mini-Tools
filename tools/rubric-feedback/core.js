'use strict';
/* 作业量规反馈 · 纯逻辑(无 DOM)。
   总分 = Σ(权重 × 等级) × 25 ÷ Σ权重,等级 1–4 → 25/50/75/100 分,权重按比例归一。 */

const LEVELS = [1, 2, 3, 4];
const GRADE_CUTS = [['A', 85], ['B', 70], ['C', 55], ['D', 0]];
const MAX_DIMS = 12;

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = v => typeof v === 'string';
const isLevel = v => Number.isInteger(v) && v >= 1 && v <= 4;
const round1 = x => Math.round(x * 10) / 10;

function validDate(s) {
  if (!isStr(s) || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function resolveToday(search, fallback) {
  let v = null;
  try { v = new URLSearchParams(isStr(search) ? search : '').get('today'); } catch (e) { v = null; }
  if (validDate(v)) return v;
  if (validDate(fallback)) return fallback;
  const n = new Date();
  const p = x => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
}

/* ---------- 默认措辞模板 ---------- */
const TEMPLATE_KEYS = ['greeting', 'titleLine', 'scoreLabel', 'overallA', 'overallB', 'overallC', 'overallD',
  'dimTitle', 'quoteLabel', 'noteLabel', 'nextTitle', 'nextItem', 'closing',
  'gradeA', 'gradeB', 'gradeC', 'gradeD', 'levelName1', 'levelName2', 'levelName3', 'levelName4'];

function defaultTemplates() {
  return {
    zh: {
      greeting: '{name} 你好,',
      titleLine: '作业:{title}',
      scoreLabel: '总分',
      overallA: '这次作业完成得很好,各方面都达到了较高水平,请保持。',
      overallB: '这次作业整体不错,大部分维度已经到位,个别地方还可以再打磨。',
      overallC: '这次作业基本达到要求,但有几个维度还需要明确地练习。',
      overallD: '这次作业还有较大的提升空间,建议先把下面的重点逐项补上再重做一次。',
      dimTitle: '{dim}({weight}%):{levelName}',
      quoteLabel: '你的原句',
      noteLabel: '老师补充',
      nextTitle: '下次重点',
      nextItem: '{dim}:{fb}',
      closing: '期待你下一次的作业。',
      gradeA: '优秀', gradeB: '良好', gradeC: '合格', gradeD: '待提高',
      levelName1: '需重点改进', levelName2: '接近要求', levelName3: '达到要求', levelName4: '表现突出'
    },
    en: {
      greeting: 'Hi {name},',
      titleLine: 'Assignment: {title}',
      scoreLabel: 'Total score',
      overallA: 'Excellent work. You reached a high standard in every area. Keep it up.',
      overallB: 'Good work overall. Most areas are in place and a few can be polished further.',
      overallC: 'This meets the basic requirements, but a few areas need deliberate practice.',
      overallD: 'There is plenty of room to improve. Work through the focus points below and try again.',
      dimTitle: '{dim} ({weight}%): {levelName}',
      quoteLabel: 'Your sentence',
      noteLabel: 'Teacher note',
      nextTitle: 'Focus for next time',
      nextItem: '{dim}: {fb}',
      closing: 'Looking forward to your next submission.',
      gradeA: 'Excellent', gradeB: 'Good', gradeC: 'Fair', gradeD: 'Needs work',
      levelName1: 'Needs major work', levelName2: 'Almost there', levelName3: 'Meets the goal', levelName4: 'Outstanding'
    }
  };
}

function validateTemplates(t) {
  const errors = [];
  if (!isObj(t)) return { ok: false, errors: ['措辞模板必须是对象'] };
  for (const lang of ['zh', 'en']) {
    const o = t[lang];
    if (!isObj(o)) { errors.push(`缺少 ${lang} 模板`); continue; }
    for (const k of TEMPLATE_KEYS) {
      if (!isStr(o[k])) errors.push(`${lang}.${k} 必须是字符串`);
      else if (o[k].length > 400) errors.push(`${lang}.${k} 超过 400 字`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/* ---------- 量规 ---------- */
function newRubric(id, name) {
  const lv = () => [1, 2, 3, 4].map(() => ({ desc: '', fb: '' }));
  return { id, name: name || '新量规', dims: [{ id: id + '-d1', name: '维度 1', weight: 100, levels: lv() }] };
}

function validateRubric(j) {
  const errors = [];
  if (!isObj(j)) return { ok: false, errors: ['量规必须是对象'], rubric: null };
  if (!isStr(j.id) || !j.id.trim() || j.id.length > 80) errors.push('量规 id 必须是 1–80 字的字符串');
  if (!isStr(j.name) || !j.name.trim()) errors.push('量规名称不能为空');
  else if (j.name.length > 60) errors.push('量规名称超过 60 字');
  if (!Array.isArray(j.dims) || j.dims.length < 1) errors.push('量规至少需要 1 个维度');
  else if (j.dims.length > MAX_DIMS) errors.push(`维度最多 ${MAX_DIMS} 个`);
  else {
    const ids = new Set(); const names = new Set(); let sum = 0;
    j.dims.forEach((d, i) => {
      const at = `维度 ${i + 1}`;
      if (!isObj(d)) { errors.push(`${at} 必须是对象`); return; }
      if (!isStr(d.id) || !d.id.trim()) errors.push(`${at} 缺少 id`);
      else if (ids.has(d.id)) errors.push(`${at} 的 id 重复:${d.id}`);
      else ids.add(d.id);
      if (!isStr(d.name) || !d.name.trim()) errors.push(`${at} 名称不能为空`);
      else if (d.name.length > 40) errors.push(`${at} 名称超过 40 字`);
      else if (names.has(d.name.trim())) errors.push(`${at} 名称重复:${d.name}`);
      else names.add(d.name.trim());
      if (typeof d.weight !== 'number' || !Number.isFinite(d.weight)) errors.push(`${at} 权重必须是数字`);
      else if (d.weight < 0) errors.push(`${at} 权重不能为负数`);
      else if (d.weight > 1000) errors.push(`${at} 权重过大`);
      else sum += d.weight;
      if (!Array.isArray(d.levels) || d.levels.length !== 4) errors.push(`${at} 必须正好有 4 个等级`);
      else d.levels.forEach((l, k) => {
        if (!isObj(l) || !isStr(l.desc) || !isStr(l.fb)) errors.push(`${at} 等级 ${k + 1} 需要字符串 desc 与 fb`);
        else if (l.desc.length > 500 || l.fb.length > 500) errors.push(`${at} 等级 ${k + 1} 文字超过 500 字`);
      });
    });
    if (errors.length === 0 && !(sum > 0)) errors.push('权重之和必须大于 0');
  }
  return { ok: errors.length === 0, errors, rubric: errors.length === 0 ? j : null };
}

const NAME_MAX = 60;
/* 复制量规的命名:加后缀后仍不超过 60 字(超出则截断原名) */
function copyName(name, suffix) {
  const suf = suffix == null ? '(副本)' : suffix;
  const base = String(name).slice(0, Math.max(0, NAME_MAX - suf.length));
  return base + suf;
}

/* ---------- 打分 ---------- */
function gradeList(grades) {
  if (Array.isArray(grades)) return grades.map(g => [g && g.id, g && g.level]);
  if (isObj(grades)) return Object.keys(grades).map(k => [k, grades[k]]);
  return [];
}
function gradeMap(grades) {
  const m = new Map();
  gradeList(grades).forEach(([k, v]) => m.set(k, v));
  return m;
}

function levelOf(total) {
  if (typeof total !== 'number' || !Number.isFinite(total)) return null;
  for (const [code, min] of GRADE_CUTS) if (total >= min) return code;
  return 'D';
}

function weights(rubric) {
  const sum = rubric.dims.reduce((a, d) => a + d.weight, 0);
  return rubric.dims.map(d => (sum > 0 ? round1(d.weight / sum * 100) : 0));
}

function score(rubric, grades) {
  if (!rubric || !Array.isArray(rubric.dims) || rubric.dims.length === 0) return { total: null, level: null };
  const gm = gradeMap(grades);
  let sumW = 0; let acc = 0;
  for (const d of rubric.dims) {
    const lv = gm.get(d.id);
    if (!isLevel(lv)) return { total: null, level: null };
    sumW += d.weight; acc += d.weight * lv;
  }
  if (!(sumW > 0)) return { total: null, level: null };
  const total = round1(acc * 25 / sumW);
  return { total, level: levelOf(total) };
}

/* items: [{id,name,level}];等级低者优先,并列时保持量规原有顺序 */
function weakest(items, n) {
  const arr = (Array.isArray(items) ? items : []).map((it, idx) => ({ it, idx }));
  arr.sort((a, b) => a.it.level - b.it.level || a.idx - b.idx);
  return arr.slice(0, Math.max(0, n | 0)).map(x => x.it);
}

/* ---------- 反馈 ---------- */
function mdEscape(s) {
  return String(s).replace(/[\\`*_\[\]<>|~#]/g, '\\$&');
}
function oneLine(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

function fill(tpl, vars) {
  return String(tpl).replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : m));
}

function dimItems(rubric, rec) {
  const gm = gradeMap(rec.dims);
  const extra = new Map((Array.isArray(rec.dims) ? rec.dims : []).map(d => [d && d.id, d]));
  return rubric.dims.map(d => ({ id: d.id, name: d.name, level: gm.get(d.id), dim: d, extra: extra.get(d.id) || {} }));
}

function feedback(rubric, rec, lang, opts) {
  const o = opts || {};
  const md = o.format !== 'text';
  const tpls = o.templates || defaultTemplates();
  const T = (tpls && tpls[lang === 'en' ? 'en' : 'zh']) || defaultTemplates().zh;
  const esc = md ? mdEscape : (s => String(s));
  const sc = score(rubric, rec.dims);
  const items = dimItems(rubric, rec);
  const ws = weights(rubric);
  const lines = [];
  const levelName = l => T['levelName' + l];
  const gradeName = T['grade' + sc.level] || '';

  lines.push(fill(T.greeting, { name: esc(oneLine(rec.student)) }));
  lines.push('');
  lines.push(fill(T.titleLine, { title: esc(oneLine(rec.title)) }));
  const totalTxt = sc.total == null ? '-' : String(sc.total);
  lines.push(`${T.scoreLabel}:${totalTxt} / 100(${gradeName})`);
  lines.push(sc.level ? T['overall' + sc.level] : '');
  lines.push('');

  items.forEach((x, i) => {
    const lv = x.level;
    const lvObj = isLevel(lv) ? x.dim.levels[lv - 1] : { desc: '', fb: '' };
    const title = fill(T.dimTitle, { dim: x.name, weight: ws[i], level: lv, levelName: isLevel(lv) ? levelName(lv) : '-' });
    lines.push(md ? `### ${title}` : `【${title}】`);
    if (lvObj.desc) lines.push(lvObj.desc);
    if (lvObj.fb) lines.push(lvObj.fb);
    const q = String(x.extra.quote == null ? '' : x.extra.quote).replace(/\r\n?/g, '\n').trim();
    if (q) {
      lines.push(`${T.quoteLabel}:`);
      q.split('\n').forEach(l => lines.push(md ? `> ${esc(l.trim())}` : `  「${l.trim()}」`));
    }
    const note = oneLine(x.extra.note);
    if (note) lines.push(`${T.noteLabel}:${esc(note)}`);
    lines.push('');
  });

  lines.push(md ? `### ${T.nextTitle}` : `【${T.nextTitle}】`);
  const weak = weakest(items.filter(x => isLevel(x.level)), 2);
  weak.forEach(x => {
    const fb = x.dim.levels[x.level - 1].fb;
    lines.push((md ? '- ' : '· ') + fill(T.nextItem, { dim: x.name, fb }));
  });
  lines.push('');
  lines.push(T.closing);
  return lines.join('\n');
}

/* ---------- 记录 ---------- */
const own = (o, k) => (o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

function makeRecord(rubric, input, id) {
  const dims = rubric.dims.map(d => ({
    id: d.id,
    level: own(input.grades, d.id),
    quote: String(own(input.quotes, d.id) || '').trim(),
    note: oneLine(own(input.notes, d.id))
  }));
  const sc = score(rubric, dims);
  return {
    id,
    date: input.date,
    student: oneLine(input.student),
    title: oneLine(input.title),
    lang: input.lang === 'en' ? 'en' : 'zh',
    rubric: JSON.parse(JSON.stringify(rubric)),
    dims,
    total: sc.total,
    levelCode: sc.level
  };
}

function studentsOf(records) {
  const m = new Map();
  (records || []).forEach(r => m.set(r.student, (m.get(r.student) || 0) + 1));
  return Array.from(m, ([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, 'zh'));
}

function trend(records, student) {
  const mine = (records || []).map((r, idx) => ({ r, idx })).filter(x => x.r.student === student);
  mine.sort((a, b) => (a.r.date < b.r.date ? -1 : a.r.date > b.r.date ? 1 : a.idx - b.idx));
  const dims = [];
  const seen = new Set();
  mine.forEach(({ r }) => r.rubric.dims.forEach(d => { if (!seen.has(d.name)) { seen.add(d.name); dims.push(d.name); } }));
  const rows = mine.map(({ r }) => {
    const byName = new Map();
    r.rubric.dims.forEach((d, i) => byName.set(d.name, r.dims[i] ? r.dims[i].level : null));
    return {
      id: r.id, date: r.date, title: r.title, total: r.total, levelCode: r.levelCode,
      cells: dims.map(n => (byName.has(n) ? byName.get(n) : null))
    };
  });
  const change = dims.map((n, i) => {
    const vals = rows.map(x => x.cells[i]).filter(v => v != null);
    return vals.length >= 2 ? vals[vals.length - 1] - vals[0] : null;
  });
  return { student, dims, rows, change };
}

/* ---------- CSV ---------- */
function safeCell(v) {
  const s = v == null ? '' : String(v);
  if (/^[\t\r]/.test(s)) return "'" + s;
  return s.length > 1 && /^[=+\-@]/.test(s) ? "'" + s : s;
}
function csvField(v) {
  const s = safeCell(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv(records, student) {
  const recs = (records || []).map((r, idx) => ({ r, idx }))
    .filter(x => student == null || x.r.student === student);
  recs.sort((a, b) => (a.r.student.localeCompare(b.r.student, 'zh') || (a.r.date < b.r.date ? -1 : a.r.date > b.r.date ? 1 : a.idx - b.idx)));
  const dims = []; const seen = new Set();
  recs.forEach(({ r }) => r.rubric.dims.forEach(d => { if (!seen.has(d.name)) { seen.add(d.name); dims.push(d.name); } }));
  const head = ['日期', '学员', '作业标题', '量规', '总分', '等级', ...dims, '下次重点'];
  const rows = [head.map(csvField).join(',')];
  recs.forEach(({ r }) => {
    const byName = new Map();
    r.rubric.dims.forEach((d, i) => byName.set(d.name, r.dims[i]));
    const items = r.rubric.dims.map((d, i) => ({ id: d.id, name: d.name, level: r.dims[i].level }));
    const weak = weakest(items, 2).map(x => x.name).join('、');
    const cells = [r.date, r.student, r.title, r.rubric.name, r.total, r.levelCode,
      ...dims.map(n => (byName.has(n) ? byName.get(n).level : '')), weak];
    rows.push(cells.map(csvField).join(','));
  });
  return rows.join('\r\n');
}

/* ---------- 备份与导入 ---------- */
function backup(state) {
  return { version: 1, rubrics: state.rubrics, records: state.records, templates: state.templates };
}

function recordErrors(r, at) {
  const errors = [];
  if (!isObj(r)) return [`${at} 必须是对象`];
  if (!isStr(r.id) || !r.id.trim()) errors.push(`${at} 缺少 id`);
  if (!isStr(r.student) || !r.student.trim() || r.student.length > 40) errors.push(`${at} 学员代号需为 1–40 字`);
  if (!isStr(r.title) || !r.title.trim() || r.title.length > 100) errors.push(`${at} 作业标题需为 1–100 字`);
  if (!validDate(r.date)) errors.push(`${at} 日期必须是有效的 YYYY-MM-DD`);
  if (r.lang !== 'zh' && r.lang !== 'en') errors.push(`${at} lang 必须是 zh 或 en`);
  const rv = validateRubric(r.rubric);
  if (!rv.ok) { rv.errors.forEach(e => errors.push(`${at} 量规快照:${e}`)); return errors; }
  if (!Array.isArray(r.dims) || r.dims.length !== r.rubric.dims.length) { errors.push(`${at} dims 数量与量规不一致`); return errors; }
  let dimOk = true;
  r.dims.forEach((d, k) => {
    if (!isObj(d) || d.id !== r.rubric.dims[k].id) { errors.push(`${at} 维度 ${k + 1} 的 id 与量规不一致`); dimOk = false; return; }
    if (!isLevel(d.level)) { errors.push(`${at} 维度 ${k + 1} 等级必须是 1–4 的整数`); dimOk = false; }
    if (!isStr(d.quote) || !isStr(d.note)) { errors.push(`${at} 维度 ${k + 1} 的 quote/note 必须是字符串`); dimOk = false; }
  });
  if (dimOk) {
    const sc = score(r.rubric, r.dims);
    if (typeof r.total !== 'number' || Math.abs(r.total - sc.total) > 0.05) errors.push(`${at} 总分与等级不匹配(应为 ${sc.total})`);
    if (r.levelCode !== sc.level) errors.push(`${at} 等级代码应为 ${sc.level}`);
  }
  return errors;
}

function validateRecord(r) {
  const errors = recordErrors(r, '记录');
  return { ok: errors.length === 0, errors };
}

/* 示例等内置内容与现有数据中同 id 但内容不同的项(覆盖前需确认) */
function overwriteConflicts(state, rubrics, records) {
  const out = [];
  rubrics.forEach(r => {
    const old = state.rubrics.find(x => x.id === r.id);
    if (old && JSON.stringify(old) !== JSON.stringify(r)) out.push('量规:' + old.name);
  });
  records.forEach(r => {
    const old = state.records.find(x => x.id === r.id);
    if (old && JSON.stringify(old) !== JSON.stringify(r)) out.push('记录:' + old.student + ' ' + old.date);
  });
  return out;
}

function validateImport(j) {
  const errors = [];
  if (!isObj(j)) return { ok: false, errors: ['备份必须是 JSON 对象'], data: null };
  if (j.version !== 1) errors.push('version 必须是 1');
  if (!Array.isArray(j.rubrics)) errors.push('rubrics 必须是数组');
  if (!Array.isArray(j.records)) errors.push('records 必须是数组');
  if (errors.length) return { ok: false, errors, data: null };

  const rids = new Set();
  j.rubrics.forEach((r, i) => {
    const v = validateRubric(r);
    v.errors.forEach(e => errors.push(`量规 ${i + 1}:${e}`));
    if (isObj(r) && isStr(r.id)) { if (rids.has(r.id)) errors.push(`量规 id 重复:${r.id}`); rids.add(r.id); }
  });

  const recIds = new Set();
  j.records.forEach((r, i) => {
    recordErrors(r, `记录 ${i + 1}`).forEach(e => errors.push(e));
    if (isObj(r) && isStr(r.id) && r.id.trim()) {
      if (recIds.has(r.id)) errors.push(`记录 ${i + 1} id 重复:${r.id}`);
      recIds.add(r.id);
    }
  });

  if (j.templates !== undefined) {
    const tv = validateTemplates(j.templates);
    tv.errors.forEach(e => errors.push('措辞模板:' + e));
  }
  if (errors.length) return { ok: false, errors, data: null };
  return { ok: true, errors: [], data: { rubrics: j.rubrics, records: j.records, templates: j.templates || null } };
}

/* ---------- 口径说明、导入预览、模板草稿、示例标记 ---------- */
function scoringRule() {
  const formula = '总分＝Σ（权重×等级）×25÷Σ权重';
  const levelPoints = '等级 1、2、3、4 分别对应 25、50、75、100 分';
  const [A, B, Cc] = GRADE_CUTS;
  const grades = `A：总分 ≥ ${A[1]}；B：${B[1]} 至 ${A[1] - 0.1}；C：${Cc[1]} 至 ${B[1] - 0.1}；D：< ${Cc[1]}`;
  return { formula, levelPoints, grades, text: `${formula}（${levelPoints}）。等级边界：${grades}。` };
}

function importPlan(state, data) {
  const same = (list, x) => list.some(y => y.id === x.id);
  const count = (cur, inc) => {
    let added = 0; let replaced = 0;
    inc.forEach(x => { if (same(cur, x)) replaced++; else added++; });
    return [added, replaced];
  };
  const [addedRubrics, replacedRubrics] = count(state.rubrics, data.rubrics);
  const [addedRecords, replacedRecords] = count(state.records, data.records);
  const templatesReplaced = !!data.templates && JSON.stringify(data.templates) !== JSON.stringify(state.templates);
  return {
    addedRubrics, replacedRubrics, addedRecords, replacedRecords, templatesReplaced,
    text: `新增 ${addedRubrics} 套量规、替换 ${replacedRubrics} 套量规；新增 ${addedRecords} 条记录、替换 ${replacedRecords} 条记录` +
      (templatesReplaced ? '；措辞模板会被备份里的模板替换' : '；措辞模板不变') + '。同 id 的内容会被备份里的版本替换。'
  };
}

function changedTemplateKeys(saved, draft) {
  if (!isObj(saved) || !isObj(draft)) return [];
  return TEMPLATE_KEYS.filter(k => saved[k] !== draft[k]);
}

function hasSample(state) {
  return (state.rubrics || []).some(r => r && r.id === 'sample-oral') || (state.records || []).some(r => r && /^sample-rec-/.test(String(r.id)));
}

const api = {
  LEVELS, GRADE_CUTS, TEMPLATE_KEYS, validDate, resolveToday, defaultTemplates, validateTemplates,
  newRubric, copyName, validateRubric, validateRecord, overwriteConflicts, levelOf, weights, score, weakest, mdEscape, feedback, makeRecord,
  studentsOf, trend, safeCell, toCsv, backup, validateImport, scoringRule, importPlan, changedTemplateKeys, hasSample
};
globalThis.RubricCore = api;
if (typeof module !== 'undefined') module.exports = api;
