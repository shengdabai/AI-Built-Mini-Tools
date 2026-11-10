'use strict';
(function () {
  const VERSION = 1;
  const EVIDENCE_TYPES = { interview: '访谈', post: '帖子', data: '数据', guess: '自己猜' };
  const FORCE_KINDS = ['push', 'pull', 'inertia', 'anxiety'];
  const FORCE_LABELS = { push: '推力', pull: '拉力', inertia: '惯性', anxiety: '焦虑' };
  const DEFAULT_WORDS = ['APP', '工具', '功能', '按钮'];

  let idCounter = 0;
  function newId(prefix) {
    idCounter += 1;
    return `${prefix || 'x'}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  function blankJob(id, title) {
    return {
      id: id || newId('j'), title: title || '未命名任务',
      situation: '', motivation: '', outcome: '',
      user: '', buyer: '', trigger: '', success: '',
      words: DEFAULT_WORDS.slice(),
      forces: { push: [], pull: [], inertia: [], anxiety: [] },
      alternatives: [], candidates: []
    };
  }

  // ---------- 日期 ----------
  function isRealDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    if (y < 100) t.setUTCFullYear(y);
    const back = `${String(t.getUTCFullYear()).padStart(4, '0')}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
    return back === s;
  }
  function formatLocal(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  // ?today=YYYY-MM-DD;非法或会被自动进位的日期(2026-02-30)回退真实今天
  function resolveToday(search, now) {
    let q = null;
    try { q = new URLSearchParams(search || '').get('today'); } catch (e) { q = null; }
    if (q !== null && isRealDate(q)) return q;
    return formatLocal(now instanceof Date ? now : new Date());
  }

  // ---------- 规则 ----------
  const text = v => (typeof v === 'string' ? v : '');
  const blank = v => text(v).trim() === '';

  function solutionWords(t, words) {
    const list = Array.isArray(words) ? words : DEFAULT_WORDS;
    const hay = text(t).toLowerCase();
    const found = [];
    for (const w of list) {
      const word = text(w).trim();
      if (word && hay.includes(word.toLowerCase()) && !found.includes(word)) found.push(word);
    }
    return found;
  }

  const CN_NUM_UNIT = /[一二三四五六七八九十百千万两半]+\s*(?:秒|分钟|分|小时|天|日|周|个月|月|年|次|条|个|成|%)/;
  const TIME_WORDS = /(?:秒|分钟|小时|每天|每周|每月|当天|当日|当晚|立刻|立即|以内|之内|之前|之后|内)/;
  function observable(t) {
    const s = text(t);
    if (/[0-9０-９]/.test(s)) return true;
    if (CN_NUM_UNIT.test(s)) return true;
    if (TIME_WORDS.test(s)) return true;
    return s.includes('能') || s.includes('不再');
  }

  const filled = arr => (Array.isArray(arr) ? arr.filter(x => x && !blank(x.text)).length : 0);
  function forceBalance(job) {
    const f = (job && job.forces) || {};
    const drive = filled(f.push) + filled(f.pull);
    const resist = filled(f.inertia) + filled(f.anxiety);
    return { drive, resist, blocked: drive <= resist };
  }

  function validateJob(job) {
    const issues = [];
    const add = (level, code, message) => issues.push({ level, code, message });
    const j = job || {};
    for (const [key, label] of [['situation', '情境'], ['motivation', '动机'], ['outcome', '期望结果']]) {
      if (blank(j[key])) add('block', 'empty-' + key, `句式「${label}」为空,三段都填完才能导出任务陈述卡`);
    }
    const hit = blank(j.motivation) ? [] : solutionWords(j.motivation, j.words);
    if (hit.length) add('warn', 'solution-in-motivation', `动机里出现「${hit.join('、')}」:写的是方案不是任务`);
    if (!blank(j.outcome) && !observable(j.outcome)) {
      add('hint', 'outcome-not-observable', '期望结果里没有数字、时间或「能/不再」,别人很难判断有没有做到');
    }
    const bal = forceBalance(j);
    if (bal.blocked) {
      add('hint', 'resistance-ge-drive', `切换阻力大于动力:推力+拉力 ${bal.drive} 条,惯性+焦虑 ${bal.resist} 条`);
    }
    const alts = Array.isArray(j.alternatives) ? j.alternatives.filter(a => a && !blank(a.name)) : [];
    if (!alts.length) add('warn', 'no-alternatives', '没有替代方案通常意味着没有需求或没调研');
    return { issues };
  }

  function evidenceStats(job) {
    const f = (job && job.forces) || {};
    const items = [].concat(Array.isArray(f.push) ? f.push : [], Array.isArray(f.pull) ? f.pull : []).filter(x => x && !blank(x.text));
    const byType = { interview: 0, post: 0, data: 0, guess: 0 };
    let withEvidence = 0, guessOnly = 0;
    for (const it of items) {
      const ev = Array.isArray(it.evidence) ? it.evidence.filter(e => e && !blank(e.text)) : [];
      if (ev.length) {
        withEvidence += 1;
        if (ev.every(e => e.type === 'guess')) guessOnly += 1;
      }
      for (const e of ev) if (e && Object.prototype.hasOwnProperty.call(byType, e.type)) byType[e.type] += 1;
    }
    const total = items.length;
    const assumptions = total - withEvidence;
    return { total, withEvidence, assumptions, guessOnly, byType, ratio: total === 0 ? null : assumptions / total };
  }
  function isAssumption(item) {
    return !(item && Array.isArray(item.evidence) && item.evidence.some(e => e && !blank(e.text)));
  }

  // 覆盖矩阵:列 = 推力/拉力/焦虑(非空),行 = 候选;不做总分
  function coverage(job, candidates) {
    const f = (job && job.forces) || {};
    const cols = [];
    for (const kind of ['push', 'pull', 'anxiety']) {
      for (const it of Array.isArray(f[kind]) ? f[kind] : []) {
        if (it && !blank(it.text)) cols.push({ id: it.id, kind, text: it.text });
      }
    }
    const drivingIds = new Set(cols.filter(c => c.kind !== 'anxiety').map(c => c.id));
    const anxietyIds = new Set(cols.filter(c => c.kind === 'anxiety').map(c => c.id));
    const list = Array.isArray(candidates) ? candidates : (Array.isArray(job && job.candidates) ? job.candidates : []);
    const rows = list.map(c => {
      const solves = new Set(Array.isArray(c.solves) ? c.solves : []);
      const eases = new Set(Array.isArray(c.eases) ? c.eases : []);
      const cells = cols.map(col => (col.kind === 'anxiety' ? eases.has(col.id) : solves.has(col.id)));
      let solved = 0, eased = 0;
      cols.forEach((col, i) => { if (cells[i]) { if (col.kind === 'anxiety') eased += 1; else solved += 1; } });
      return { id: c.id, name: text(c.name), cells, solved, eased };
    });
    return { columns: cols, rows, drivingTotal: drivingIds.size, anxietyTotal: anxietyIds.size };
  }

  // ---------- 导出 ----------
  function guardCell(v) {
    const s = String(v == null ? '' : v);
    return /^[=+\-@\t\r]/.test(s) && s !== '-' && s !== '+' ? "'" + s : s;
  }
  function csvCell(v) {
    const s = guardCell(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  const oneLine = v => String(v == null ? '' : v).replace(/\r\n|\r|\n/g, ' ').trim();
  const mdCell = v => guardCell(oneLine(v)).replace(/\|/g, '\\|');

  function toCsv(job) {
    const cov = coverage(job);
    const head = ['候选方案'].concat(cov.columns.map(c => `${FORCE_LABELS[c.kind]}:${c.text}`), [`解决推力/拉力(共${cov.drivingTotal})`, `缓解焦虑(共${cov.anxietyTotal})`]);
    const lines = [head.map(csvCell).join(',')];
    for (const r of cov.rows) {
      lines.push([r.name].concat(r.cells.map(x => (x ? '是' : '')), [String(r.solved), String(r.eased)]).map(csvCell).join(','));
    }
    return lines.join('\r\n') + '\r\n';
  }

  function evidenceTag(item) {
    const ev = Array.isArray(item.evidence) ? item.evidence : [];
    if (!ev.length) return '〔假设〕';
    return '〔' + ev.map(e => [EVIDENCE_TYPES[e.type], e.date, e.source].filter(Boolean).join(' ')).join(';') + '〕';
  }
  function toMarkdown(job) {
    const j = job || {};
    const v = k => oneLine(j[k]) || '(未填)';
    const L = [];
    L.push(`# 任务陈述卡:${oneLine(j.title) || '未命名任务'}`, '');
    L.push(`> 当 ${v('situation')},我想 ${v('motivation')},以便 ${v('outcome')}。`, '');
    L.push(`- 使用者:${v('user')}`, `- 购买者:${v('buyer')}`, `- 触发时刻:${v('trigger')}`, `- 成功的可观察结果:${v('success')}`, '');
    L.push('## 四力', '');
    for (const kind of FORCE_KINDS) {
      L.push(`**${FORCE_LABELS[kind]}**`);
      const items = ((j.forces || {})[kind] || []).filter(x => !blank(x.text));
      if (!items.length) L.push('- (无)');
      for (const it of items) L.push(`- ${oneLine(it.text)}${kind === 'push' || kind === 'pull' ? ' ' + oneLine(evidenceTag(it)) : ''}`);
      L.push('');
    }
    const bal = forceBalance(j);
    L.push(`动力(推力+拉力)${bal.drive} 条 / 阻力(惯性+焦虑)${bal.resist} 条`, '');
    L.push('## 当前替代方案', '');
    const alts = (j.alternatives || []).filter(a => !blank(a.name));
    if (!alts.length) L.push('(没有替代方案)');
    else {
      L.push('| 名称 | 费用 | 耗时 | 不满点 |', '| --- | --- | --- | --- |');
      for (const a of alts) L.push(`| ${mdCell(a.name)} | ${mdCell(a.cost)} | ${mdCell(a.time)} | ${mdCell(a.pain)} |`);
    }
    L.push('', '## 候选方案覆盖', '');
    const cov = coverage(j);
    if (!cov.rows.length) L.push('(没有候选方案)');
    else {
      L.push('| 候选 | 解决的推力/拉力 | 缓解的焦虑 | 覆盖数 |', '| --- | --- | --- | --- |');
      for (const r of cov.rows) {
        const solved = cov.columns.filter((c, i) => c.kind !== 'anxiety' && r.cells[i]).map(c => c.text).join(';');
        const eased = cov.columns.filter((c, i) => c.kind === 'anxiety' && r.cells[i]).map(c => c.text).join(';');
        L.push(`| ${mdCell(r.name)} | ${mdCell(solved)} | ${mdCell(eased)} | ${r.solved}/${cov.drivingTotal} · ${r.eased}/${cov.anxietyTotal} |`);
      }
    }
    const st = evidenceStats(j);
    L.push('', '## 证据情况', '');
    L.push(st.total === 0 ? '没有推力/拉力条目。' : `推力/拉力共 ${st.total} 条,其中假设 ${st.assumptions} 条(${Math.round(st.ratio * 100)}%),只有「自己猜」证据的 ${st.guessOnly} 条。`);
    L.push('', '## 规则检查', '');
    const issues = validateJob(j).issues;
    const lv = { block: '阻断', warn: '警告', hint: '提示' };
    if (!issues.length) L.push('- 无');
    for (const i of issues) L.push(`- ${lv[i.level]}:${oneLine(i.message)}`);
    return L.join('\n') + '\n';
  }

  // ---------- 校验(保存前、读取后、导入共用) ----------
  const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
  const goodId = id => typeof id === 'string' && ID_RE.test(id);
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  function validateEvidence(ev, where, errs, ids) {
    if (!isObj(ev)) return errs.push(`${where}:证据不是对象`);
    if (!goodId(ev.id)) errs.push(`${where}:证据 id 只能用字母、数字、下划线、连字符(1-100 位)`);
    else if (ids.has(ev.id)) errs.push(`${where}:id 重复「${ev.id}」`); else ids.add(ev.id);
    if (typeof ev.source !== 'string') errs.push(`${where}:证据字段 source 必须是文本`);
    if (typeof ev.text !== 'string') errs.push(`${where}:证据正文必须是文本`);
    else if (ev.text.trim() === '') errs.push(`${where}:证据正文不能为空`);
    if (typeof ev.type !== 'string' || !Object.prototype.hasOwnProperty.call(EVIDENCE_TYPES, ev.type)) errs.push(`${where}:证据类型「${ev.type}」不在 访谈/帖子/数据/自己猜 之内`);
    if (typeof ev.date !== 'string' || (ev.date !== '' && !isRealDate(ev.date))) errs.push(`${where}:证据日期必须是真实存在的 YYYY-MM-DD 或留空`);
    if (typeof ev.source === 'string' && /^\s*(?:javascript|data|vbscript|file|ftp|blob):|^\s*(?!https?:)[a-z][a-z0-9+.-]*:\/\//i.test(ev.source)) errs.push(`${where}:来源如果是链接,只接受 http(s)`);
  }
  function validateJobShape(j, idx, errs, jobIds) {
    const w = `任务 ${idx + 1}`;
    if (!isObj(j)) return errs.push(`${w}:不是对象`);
    if (!goodId(j.id)) errs.push(`${w}:任务 id 只能用字母、数字、下划线、连字符(1-100 位)`);
    else if (jobIds.has(j.id)) errs.push(`${w}:任务 id 重复「${j.id}」`); else jobIds.add(j.id);
    for (const k of ['title', 'situation', 'motivation', 'outcome', 'user', 'buyer', 'trigger', 'success']) {
      if (typeof j[k] !== 'string') errs.push(`${w}:字段 ${k} 必须是文本`);
    }
    if (!Array.isArray(j.words) || j.words.some(x => typeof x !== 'string')) errs.push(`${w}:方案词表必须是文本数组`);
    const ids = new Set();
    const useId = (id, label) => {
      if (!goodId(id)) errs.push(`${w}:${label}的 id 只能用字母、数字、下划线、连字符(1-100 位)`);
      else if (ids.has(id)) errs.push(`${w}:id 重复「${id}」`); else ids.add(id);
    };
    const kindOf = new Map();
    if (!isObj(j.forces)) errs.push(`${w}:forces 必须是对象`);
    else {
      for (const kind of FORCE_KINDS) {
        const arr = j.forces[kind];
        if (!Array.isArray(arr)) { errs.push(`${w}:${FORCE_LABELS[kind]}必须是数组`); continue; }
        arr.forEach((it, n) => {
          const ww = `${w}·${FORCE_LABELS[kind]} ${n + 1}`;
          if (!isObj(it)) return errs.push(`${ww}:不是对象`);
          useId(it.id, ww);
          if (typeof it.id === 'string') kindOf.set(it.id, kind);
          if (typeof it.text !== 'string') errs.push(`${ww}:text 必须是文本`);
          if (!Array.isArray(it.evidence)) errs.push(`${ww}:evidence 必须是数组`);
          else if (kind === 'inertia' || kind === 'anxiety') { if (it.evidence.length) errs.push(`${ww}:惯性和焦虑不挂证据`); }
          else it.evidence.forEach(ev => validateEvidence(ev, ww, errs, ids));
        });
      }
    }
    if (!Array.isArray(j.alternatives)) errs.push(`${w}:alternatives 必须是数组`);
    else j.alternatives.forEach((a, n) => {
      const ww = `${w}·替代方案 ${n + 1}`;
      if (!isObj(a)) return errs.push(`${ww}:不是对象`);
      useId(a.id, ww);
      for (const k of ['name', 'cost', 'time', 'pain']) if (typeof a[k] !== 'string') errs.push(`${ww}:字段 ${k} 必须是文本`);
    });
    if (!Array.isArray(j.candidates)) errs.push(`${w}:candidates 必须是数组`);
    else j.candidates.forEach((c, n) => {
      const ww = `${w}·候选 ${n + 1}`;
      if (!isObj(c)) return errs.push(`${ww}:不是对象`);
      useId(c.id, ww);
      if (typeof c.name !== 'string') errs.push(`${ww}:name 必须是文本`);
      for (const [k, allowed, label] of [['solves', ['push', 'pull'], '推力/拉力'], ['eases', ['anxiety'], '焦虑']]) {
        if (!Array.isArray(c[k])) { errs.push(`${ww}:${k} 必须是数组`); continue; }
        const seen = new Set();
        for (const ref of c[k]) {
          if (typeof ref !== 'string' || !allowed.includes(kindOf.get(ref))) errs.push(`${ww}:${k} 引用了不存在的${label}条目「${ref}」`);
          else if (seen.has(ref)) errs.push(`${ww}:${k} 重复引用「${ref}」`); else seen.add(ref);
        }
      }
    });
  }
  // state = { version, jobs, currentId };任何一处不合法即整份拒绝,不修正
  function validateState(state) {
    const errors = [];
    if (!isObj(state)) return { ok: false, errors: ['内容不是对象'] };
    if (state.version !== VERSION) errors.push(`version 必须是 ${VERSION}`);
    if (!Array.isArray(state.jobs)) errors.push('jobs 必须是数组');
    else {
      const jobIds = new Set();
      state.jobs.forEach((j, i) => validateJobShape(j, i, errors, jobIds));
      if (state.currentId !== null && state.currentId !== undefined) {
        if (typeof state.currentId !== 'string' || !state.jobs.some(j => isObj(j) && j.id === state.currentId)) errors.push('currentId 指向不存在的任务');
      }
    }
    return errors.length ? { ok: false, errors } : { ok: true, errors: [], jobs: state.jobs, currentId: state.currentId == null ? null : state.currentId };
  }
  function validateImport(data) {
    if (!isObj(data)) return { ok: false, errors: ['备份文件不是 JSON 对象'] };
    if (data.app !== undefined && data.app !== 'jtbd-board') return { ok: false, errors: ['这不是 JTBD 任务陈述板的备份'] };
    return validateState(data);
  }
  function exportJson(state) {
    return JSON.stringify({ app: 'jtbd-board', version: VERSION, jobs: state.jobs, currentId: state.currentId == null ? null : state.currentId }, null, 2);
  }

  // 删除一条四力条目会连带删除它的证据,并从候选方案里摘掉它;返回确认文案需要的数字
  function forceRemovalImpact(job, id) {
    for (const kind of FORCE_KINDS) {
      const it = job.forces[kind].find(x => x.id === id);
      if (!it) continue;
      const candidates = job.candidates.filter(c => c.solves.includes(id) || c.eases.includes(id)).length;
      return { kind, text: it.text, evidence: it.evidence.length, candidates };
    }
    return null;
  }

  const api = {
    forceRemovalImpact,
    VERSION, EVIDENCE_TYPES, FORCE_KINDS, FORCE_LABELS, DEFAULT_WORDS,
    newId, blankJob, isRealDate, resolveToday,
    solutionWords, observable, forceBalance, validateJob, evidenceStats, isAssumption, coverage,
    guardCell, toMarkdown, toCsv, validateState, validateImport, exportJson
  };
  globalThis.JtbdCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
