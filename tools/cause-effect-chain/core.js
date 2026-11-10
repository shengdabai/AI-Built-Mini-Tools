'use strict';
/* 因果复盘链 · 纯逻辑(无 DOM)。 */
(function () {
  const VERSION = 1;
  const SELF = '自己';
  const PROPOSERS = ['child', 'parent'];
  const MOODS = ['calm', 'upset'];
  const STATUSES = ['done', 'draft'];
  const LEVEL_LABELS = ['因为', '所以', '然后', '接着', '再然后', '最后'];
  const MIN_LEVELS = 2;
  const MAX_LEVELS = 6;
  const PROPOSER_NAME = { child: '孩子', parent: '家长' };
  const MOOD_NAME = { calm: '平静', upset: '有情绪' };
  const STATUS_NAME = { done: '已复盘', draft: '草稿' };

  function defaultConfig() {
    return {
      farWords: ['以后', '将来', '长大', '找不到工作', '未来', '一辈子', '成年后'],
      tags: ['安全', '作业', '社交', '其他'],
      slots: [{ label: '晚饭后', time: '19:30' }, { label: '睡前', time: '21:00' }],
    };
  }
  function hasUserData(state) {
    return state.entries.length > 0 || JSON.stringify(state.config) !== JSON.stringify(defaultConfig());
  }
  function newState() { return { version: VERSION, entries: [], config: defaultConfig() }; }

  /* ---------- 日期 ---------- */
  function parseISO(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const t = Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
    if (!isFinite(t)) return null;
    return fmt(t) === s ? t : null; // 拒绝 2026-02-30 这类自动进位
  }
  function fmt(t) {
    const d = new Date(t);
    const p = (n, w) => String(n).padStart(w, '0');
    return p(d.getUTCFullYear(), 4) + '-' + p(d.getUTCMonth() + 1, 2) + '-' + p(d.getUTCDate(), 2);
  }
  function addDays(iso, n) {
    const t = parseISO(iso);
    return t === null ? null : fmt(t + n * 86400000);
  }
  function resolveToday(search, realToday) {
    try {
      const v = new URLSearchParams(search || '').get('today');
      if (v !== null && parseISO(v) !== null) return v;
    } catch (e) { /* 回退 */ }
    return realToday;
  }
  function validTime(s) {
    if (typeof s !== 'string' || !/^\d{2}:\d{2}$/.test(s)) return false;
    return +s.slice(0, 2) <= 23 && +s.slice(3) <= 59;
  }

  /* ---------- 校验(写入与读取共用) ---------- */
  const nonBlank = v => typeof v === 'string' && v.trim() !== '';

  function validateConfig(c) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return { ok: false, error: '设置不是对象' };
    if (!Array.isArray(c.farWords) || !c.farWords.every(nonBlank)) return { ok: false, error: '远期词必须是非空文字列表' };
    if (!Array.isArray(c.tags) || !c.tags.every(nonBlank)) return { ok: false, error: '标签必须是非空文字列表' };
    if (new Set(c.tags).size !== c.tags.length) return { ok: false, error: '标签不能重复' };
    if (!Array.isArray(c.slots) || c.slots.length !== 2) return { ok: false, error: '复盘时段必须正好两个' };
    for (const s of c.slots) {
      if (!s || typeof s !== 'object' || !nonBlank(s.label)) return { ok: false, error: '复盘时段名称不能为空' };
      if (!validTime(s.time)) return { ok: false, error: '复盘时段时间必须是 HH:MM' };
    }
    return { ok: true };
  }

  function validateEntry(e) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return { ok: false, error: '条目不是对象' };
    if (!nonBlank(e.id)) return { ok: false, error: 'id 不能为空' };
    if (parseISO(e.date) === null) return { ok: false, error: '日期必须是真实存在的 YYYY-MM-DD' };
    if (!nonBlank(e.who)) return { ok: false, error: '“谁”不能为空' };
    if (!nonBlank(e.event)) return { ok: false, error: '事件不能为空' };
    if (!PROPOSERS.includes(e.proposer)) return { ok: false, error: '谁提出必须是 child 或 parent' };
    if (!MOODS.includes(e.mood)) return { ok: false, error: '情绪必须是 calm 或 upset' };
    if (!STATUSES.includes(e.status)) return { ok: false, error: '状态必须是 done 或 draft' };
    if (!Array.isArray(e.chain) || !e.chain.every(nonBlank)) return { ok: false, error: '链条每一级必须是非空文字' };
    const n = e.chain.length;
    if (n > MAX_LEVELS) return { ok: false, error: '链条最多 ' + MAX_LEVELS + ' 级,现在 ' + n + ' 级' };
    if (e.status === 'done' && n < MIN_LEVELS) return { ok: false, error: '已复盘条目的链条至少 ' + MIN_LEVELS + ' 级,现在 ' + n + ' 级' };
    if (!Array.isArray(e.tags) || !e.tags.every(nonBlank)) return { ok: false, error: '标签必须是非空文字列表' };
    if (e.prevId !== null && !nonBlank(e.prevId)) return { ok: false, error: 'prevId 必须是 null 或条目 id' };
    return { ok: true };
  }

  function validateState(s) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return { ok: false, error: '数据不是对象' };
    if (s.version !== VERSION) return { ok: false, error: '版本必须是 ' + VERSION };
    if (!Array.isArray(s.entries)) return { ok: false, error: 'entries 必须是列表' };
    const cfg = validateConfig(s.config);
    if (!cfg.ok) return cfg;
    const ids = new Set();
    for (let i = 0; i < s.entries.length; i++) {
      const r = validateEntry(s.entries[i]);
      if (!r.ok) return { ok: false, error: '第 ' + (i + 1) + ' 条:' + r.error };
      if (ids.has(s.entries[i].id)) return { ok: false, error: '第 ' + (i + 1) + ' 条:id 重复(' + s.entries[i].id + ')' };
      ids.add(s.entries[i].id);
    }
    const byId = new Map(s.entries.map(e => [e.id, e]));
    // 先校验全部引用存在,再查环,避免遍历时碰到不存在的条目
    for (let i = 0; i < s.entries.length; i++) {
      const e = s.entries[i];
      if (e.prevId === null) continue;
      if (e.prevId === e.id) return { ok: false, error: '第 ' + (i + 1) + ' 条:不能关联自己' };
      if (!byId.has(e.prevId)) return { ok: false, error: '第 ' + (i + 1) + ' 条:关联的旧条目不存在' };
    }
    for (let i = 0; i < s.entries.length; i++) {
      const seen = new Set([s.entries[i].id]);
      let cur = s.entries[i].prevId;
      while (cur !== null) {
        if (seen.has(cur)) return { ok: false, error: '第 ' + (i + 1) + ' 条:关联形成了环' };
        seen.add(cur);
        cur = byId.get(cur).prevId;
      }
    }
    return { ok: true };
  }

  function validateImport(input) {
    let data = input;
    if (typeof input === 'string') {
      try { data = JSON.parse(input); } catch (e) { return { ok: false, error: '不是合法的 JSON:' + e.message }; }
    }
    const r = validateState(data);
    if (!r.ok) return r;
    return { ok: true, state: data };
  }

  /* ---------- 规则提示 ---------- */
  function cleanChain(entry) {
    return (Array.isArray(entry && entry.chain) ? entry.chain : []).map(x => String(x).trim()).filter(Boolean);
  }
  function checkChain(entry, config) {
    const cfg = config || defaultConfig();
    const chain = cleanChain(entry);
    const issues = [];
    const hit = [];
    for (const w of cfg.farWords || []) {
      if (w && chain.some(t => t.includes(w)) && !hit.includes(w)) hit.push(w);
    }
    if (hit.length) issues.push({ code: 'far', words: hit, message: '空泛因果,换成今天看得见的(出现:' + hit.join('、') + ')' });
    if (entry && entry.mood === 'upset') issues.push({ code: 'emotion', message: '先冷静,复盘时再谈;可以先保存为草稿' });
    if (chain.length === 1) issues.push({ code: 'short', message: '再推一步' });
    if (chain.length === 0) issues.push({ code: 'empty', message: '链条还是空的,先写第一级“因为”' });
    return { issues };
  }

  /* ---------- 统计 ---------- */
  function counted(e) { return e.status === 'done' && e.who !== SELF; }

  function childRatio(entries, days, today) {
    const end = parseISO(today) === null ? null : today;
    const out = { child: 0, total: 0, ratio: null };
    if (end === null || !(days > 0)) return out;
    const from = addDays(end, -(days - 1));
    for (const e of entries) {
      if (!counted(e) || e.date < from || e.date > end) continue;
      out.total++;
      if (e.proposer === 'child') out.child++;
    }
    out.ratio = out.total === 0 ? null : out.child / out.total;
    return out;
  }

  function ratioSeries(entries, today, weeks) {
    const res = [];
    for (let i = 0; i < weeks; i++) {
      const end = addDays(today, -7 * (weeks - 1 - i));
      const r = childRatio(entries, 7, end);
      res.push({ start: addDays(end, -6), end: end, child: r.child, total: r.total, ratio: r.ratio });
    }
    return res;
  }

  /* 连续有数据的周分成一段;中间没有记录的周断开,孤立的一周单独成段 */
  function ratioSegments(series) {
    const segs = [];
    let cur = null;
    series.forEach((p, i) => {
      if (p.ratio === null) { cur = null; return; }
      if (!cur) { cur = []; segs.push(cur); }
      cur.push(i);
    });
    return segs;
  }
  const isSample = e => typeof e.id === 'string' && e.id.indexOf('sample-') === 0;

  function tagStats(entries) {
    const m = new Map();
    for (const e of entries) for (const t of new Set(e.tags)) m.set(t, (m.get(t) || 0) + 1);
    return Array.from(m, ([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  }

  function todayPending(entries, today) {
    return entries.filter(e => e.date === today && e.status === 'draft');
  }

  function currentSlot(slots, hhmm) {
    let cur = null;
    for (const s of slots) if (s.time <= hhmm && (cur === null || s.time > cur.time)) cur = s;
    return cur;
  }

  /* ---------- 检索与关联 ---------- */
  function search(entries, q) {
    const needle = String(q || '').trim().toLowerCase();
    if (!needle) return entries.slice();
    return entries.filter(e => [e.event, e.who].concat(e.chain, e.tags).some(t => t.toLowerCase().includes(needle)));
  }
  function filterEntries(entries, f) {
    const o = f || {};
    return search(entries, o.q).filter(e => (!o.who || e.who === o.who) && (!o.tag || e.tags.includes(o.tag)) && (!o.status || e.status === o.status));
  }

  function link(entries, id, prevId) {
    const byId = new Map(entries.map(e => [e.id, e]));
    if (!byId.has(id)) return { ok: false, error: '条目不存在' };
    if (prevId !== null) {
      if (prevId === id) return { ok: false, error: '不能关联自己' };
      if (!byId.has(prevId)) return { ok: false, error: '要关联的旧条目不存在' };
      let cur = prevId;
      const seen = new Set();
      while (cur !== null && !seen.has(cur)) {
        if (cur === id) return { ok: false, error: '关联会形成环' };
        seen.add(cur);
        const nx = byId.get(cur);
        cur = nx ? nx.prevId : null;
      }
    }
    return { ok: true, entries: entries.map(e => (e.id === id ? Object.assign({}, e, { prevId }) : e)) };
  }

  /* ---------- 导出 ---------- */
  function guard(s) {
    const v = String(s);
    if (v === '-' || v === '+') return v;
    return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
  }
  function csvCell(s) {
    const v = guard(s);
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function sortAsc(entries) {
    return entries.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  function toMarkdown(entries) {
    const byId = new Map(entries.map(e => [e.id, e]));
    const months = new Map();
    for (const e of sortAsc(entries)) {
      const k = e.date.slice(0, 7);
      if (!months.has(k)) months.set(k, []);
      months.get(k).push(e);
    }
    const out = ['# 因果复盘册', ''];
    if (entries.some(isSample)) out.push('> 含合成示例:标注为“合成示例”的条目是虚构的演示数据,不是真实记录。', '');
    if (months.size === 0) out.push('(没有条目)', '');
    for (const [k, list] of months) {
      out.push('## ' + k, '');
      for (const e of list) {
        out.push('### ' + e.date + ' · ' + guard(e.who) + ' · ' + guard(e.event) + (isSample(e) ? ' 【合成示例】' : ''), '');
        e.chain.forEach((t, i) => out.push('- ' + LEVEL_LABELS[i] + ':' + guard(t)));
        out.push('- 谁提出:' + PROPOSER_NAME[e.proposer] + ' · 录入时情绪:' + MOOD_NAME[e.mood] + ' · 状态:' + STATUS_NAME[e.status]);
        if (e.tags.length) out.push('- 标签:' + e.tags.map(guard).join('、'));
        const prev = e.prevId !== null ? byId.get(e.prevId) : null;
        if (prev) out.push('- 关联上次:' + prev.date + ' ' + guard(prev.event) + '(' + prev.chain.map(guard).join(' → ') + ')');
        out.push('');
      }
    }
    return out.join('\n');
  }

  function toCsv(entries) {
    const head = ['id', '日期', '谁', '事件'];
    for (let i = 0; i < MAX_LEVELS; i++) head.push('第' + (i + 1) + '级');
    head.push('谁提出', '录入时情绪', '状态', '标签', '关联旧条目');
    const anySample = entries.some(isSample);
    if (anySample) head.push('数据性质');
    const rows = [head.map(csvCell).join(',')];
    for (const e of sortAsc(entries)) {
      const row = [e.id, e.date, e.who, e.event];
      for (let i = 0; i < MAX_LEVELS; i++) row.push(e.chain[i] || '');
      row.push(PROPOSER_NAME[e.proposer], MOOD_NAME[e.mood], STATUS_NAME[e.status], e.tags.join(';'), e.prevId || '');
      if (anySample) row.push(isSample(e) ? '合成示例' : '');
      rows.push(row.map(csvCell).join(','));
    }
    return rows.join('\r\n') + '\r\n';
  }

  function toJson(state) { return JSON.stringify(state, null, 2); }

  const api = {
    VERSION, SELF, PROPOSERS, MOODS, STATUSES, LEVEL_LABELS, MIN_LEVELS, MAX_LEVELS, PROPOSER_NAME, MOOD_NAME, STATUS_NAME,
    defaultConfig, newState, hasUserData, parseISO, addDays, resolveToday, validTime,
    validateConfig, validateEntry, validateState, validateImport,
    cleanChain, checkChain, childRatio, ratioSeries, ratioSegments, isSample, tagStats, todayPending, currentSlot,
    search, filterEntries, link, guard, toMarkdown, toCsv, toJson,
  };
  globalThis.CausalCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
