'use strict';
/* 半秒脚本练习器 · 纯逻辑(无 DOM)。日期一律按 UTC 时间轴做加减,再格式化回 YYYY-MM-DD。 */
(function () {
  const VERSION = 1;
  const MAX_SCRIPTS = 5;
  const MIN_SECONDS = 5;
  const LIMITS = { maxSeconds: 86400 };

  const DEFAULT_CONFIG = {
    actionVerbs: ['做', '说', '看', '深呼吸', '停', '写', '走', '回应', '不', '喝', '吃', '拿', '放下', '打开', '关', '站', '坐', '笑', '问', '听', '读', '数', '去', '离开', '拒绝', '选', '起身', '洗'],
    emotionWords: ['平静', '开心', '快乐', '高兴', '放松', '冷静', '焦虑', '愤怒', '生气', '难过', '幸福', '满足', '安心', '自信', '轻松', '紧张']
  };
  const SHORT_LEN = 40;

  // ---------- 日期(UTC) ----------
  function parseYmd(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const ms = Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
    return fmtYmd(ms) === s ? ms : null; // 2026-02-30 之类会进位,往返比较后拒绝
  }
  function fmtYmd(ms) {
    const d = new Date(ms);
    return `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  function addDays(s, n) {
    const ms = parseYmd(s);
    if (ms === null) throw new RangeError('非法日期:' + s);
    return fmtYmd(ms + n * 86400000);
  }
  function diffDays(a, b) { return Math.round((parseYmd(a) - parseYmd(b)) / 86400000); }
  function dow(s) { return (new Date(parseYmd(s)).getUTCDay() + 6) % 7; } // 周一=0
  function resolveToday(search, fallback) {
    let q = null;
    try { q = new URLSearchParams(search || '').get('today'); } catch (e) { q = null; }
    return parseYmd(q) !== null ? q : fallback;
  }
  function parseAt(s) {
    if (typeof s !== 'string') return null;
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(s);
    if (!m || parseYmd(m[1]) === null || +m[2] > 23 || +m[3] > 59 || +m[4] > 59) return null;
    return { date: m[1], time: `${m[2]}:${m[3]}:${m[4]}` };
  }

  // ---------- 规则检查 ----------
  function configOf(config) {
    const c = config || {};
    return {
      actionVerbs: Array.isArray(c.actionVerbs) ? c.actionVerbs : DEFAULT_CONFIG.actionVerbs,
      emotionWords: Array.isArray(c.emotionWords) ? c.emotionWords : DEFAULT_CONFIG.emotionWords
    };
  }
  function checkScript(text, config) {
    const t = String(text == null ? '' : text).trim();
    const cfg = configOf(config);
    const issues = [];
    if (!t) return { type: 'universal', issues: [{ code: 'empty', level: 'warn', message: '还没有写脚本。写一句无条件的现在时动作,例如「我从不抽烟」。' }] };
    const type = /如果|当/.test(t) ? 'situational' : 'universal';
    if (!cfg.actionVerbs.some(v => v && t.includes(v))) {
      issues.push({ code: 'no-verb', level: 'warn', message: '没有找到动作词。脚本要写你做什么,例如「看着」「深呼吸」「不」。' });
    }
    if (cfg.emotionWords.some(w => w && t.includes(w))) {
      issues.push({ code: 'emotion-goal', level: 'warn', message: '动作目标,不是情绪目标。把“我要平静”改成“我深呼吸三次”这类能做的动作。' });
    }
    if ([...t].length > SHORT_LEN) {
      issues.push({ code: 'too-long', level: 'info', message: `超过 ${SHORT_LEN} 字。脊干(脚本的主干句)要短:只留一个动作。` });
    }
    return { type, issues };
  }

  // 「我」→ 名字;名字留空时退回「你」。自我/忘我/无我 里的「我」不替换。
  function thirdPerson(text, name) {
    const n = String(name == null ? '' : name).trim() || '你';
    return String(text == null ? '' : text).replace(/(?<![自忘无])我/g, n);
  }
  function secondPerson(text) { return thirdPerson(text, '你'); }

  // ---------- 记录 ----------
  function nextId(prefix, items) {
    let max = 0;
    for (const it of items) {
      const m = new RegExp('^' + prefix + '(\\d+)$').exec(it && it.id);
      if (m) max = Math.max(max, +m[1]);
    }
    return prefix + (max + 1);
  }
  function emptyState() { return { version: VERSION, name: '', config: { actionVerbs: DEFAULT_CONFIG.actionVerbs.slice(), emotionWords: DEFAULT_CONFIG.emotionWords.slice() }, scripts: [], practices: [], triggers: [] }; }

  // seconds 由界面计时后传入;< MIN_SECONDS 不计入,state 原样返回
  function recordPractice(state, scriptId, seconds, now) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0 || seconds > LIMITS.maxSeconds) return { ok: false, counted: false, state, error: '秒数必须是 0 到 86400 之间的数字' };
    if (!state.scripts.some(s => s.id === scriptId)) return { ok: false, counted: false, state, error: '找不到这条脚本' };
    if (!parseAt(now)) return { ok: false, counted: false, state, error: '时间格式应为 YYYY-MM-DDTHH:MM:SS' };
    if (seconds < MIN_SECONDS) return { ok: true, counted: false, state, message: `本次 ${seconds.toFixed(1)} 秒,不足 ${MIN_SECONDS} 秒,不计入。说得慢一点、清楚一点再试一次。` };
    const rec = { id: nextId('p', state.practices), scriptId, seconds: Math.round(seconds * 10) / 10, at: now };
    return { ok: true, counted: true, state: Object.assign({}, state, { practices: state.practices.concat([rec]) }), record: rec, message: `已计入一次(${rec.seconds.toFixed(1)} 秒)。` };
  }
  const dateOf = r => r.at.slice(0, 10);
  function countsByDate(records) {
    const m = new Map();
    for (const r of records) m.set(dateOf(r), (m.get(dateOf(r)) || 0) + 1);
    return m;
  }
  function streak(records, today) {
    const m = countsByDate(records);
    let day = m.has(today) ? today : addDays(today, -1); // 今天还没练,保留到昨天为止的连续
    let n = 0;
    while (m.has(day)) { n++; day = addDays(day, -1); }
    return n;
  }
  function levelOf(count) { return count <= 0 ? 0 : count >= 4 ? 4 : count; }
  function heatmap(records, days, today) {
    if (!Number.isInteger(days) || days < 1) throw new RangeError('days 必须是正整数');
    const m = countsByDate(records);
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = addDays(today, -i);
      const count = m.get(date) || 0;
      out.push({ date, count, level: levelOf(count), dow: dow(date) });
    }
    return out;
  }
  function weeklyCounts(records, weeks, today) {
    const m = countsByDate(records);
    const thisMonday = addDays(today, -dow(today));
    const out = [];
    for (let w = weeks - 1; w >= 0; w--) {
      const start = addDays(thisMonday, -7 * w);
      let count = 0;
      for (let d = 0; d < 7; d++) { const day = addDays(start, d); if (day <= today) count += m.get(day) || 0; }
      out.push({ start, count });
    }
    return out;
  }
  function stats(state, scriptId, today) {
    const recs = state.practices.filter(r => r.scriptId === scriptId);
    return { today: recs.filter(r => dateOf(r) === today).length, total: recs.length, streak: streak(recs, today) };
  }
  // 窗口 = [today-days+1, today-offset...];offset 用于取「前一个窗口」
  function executionRate(triggers, days, today, offset) {
    if (!Number.isInteger(days) || days < 1) throw new RangeError('days 必须是正整数');
    const end = addDays(today, -(offset || 0));
    const start = addDays(end, -(days - 1));
    const inWin = triggers.filter(t => t.date >= start && t.date <= end);
    const executed = inWin.filter(t => t.executed).length;
    return { total: inWin.length, executed, rate: inWin.length ? executed / inWin.length : null };
  }

  // ---------- 校验(保存前、读取后、导入时共用) ----------
  const isStr = (v, min) => typeof v === 'string' && v.length >= (min || 0);
  function validateState(s) {
    const errs = [];
    const add = m => { if (errs.length < 20) errs.push(m); };
    if (!s || typeof s !== 'object' || Array.isArray(s)) return { ok: false, errors: ['数据不是对象'] };
    if (s.version !== VERSION) add(`version 必须是 ${VERSION}`);
    if (!isStr(s.name)) add('name 必须是文本');
    const cfg = s.config;
    if (!cfg || typeof cfg !== 'object') add('config 缺失');
    else for (const k of ['actionVerbs', 'emotionWords']) {
      if (!Array.isArray(cfg[k]) || !cfg[k].every(w => isStr(w, 1))) add(`config.${k} 必须是非空文本组成的数组`);
    }
    for (const k of ['scripts', 'practices', 'triggers']) if (!Array.isArray(s[k])) add(`${k} 必须是数组`);
    if (s.sample !== undefined && typeof s.sample !== 'boolean') add('sample 必须是布尔值');
    if (errs.length) return { ok: false, errors: errs };
    if (s.scripts.length > MAX_SCRIPTS) add(`脚本最多 ${MAX_SCRIPTS} 条`);
    const ids = new Set();
    const uniq = (kind, i, id) => {
      if (!isStr(id, 1)) { add(`${kind}[${i}].id 必须是非空文本`); return; }
      if (ids.has(id)) add(`id 重复:${id}`);
      ids.add(id);
    };
    const scriptIds = new Set();
    s.scripts.forEach((x, i) => {
      if (!x || typeof x !== 'object') return add(`scripts[${i}] 不是对象`);
      uniq('scripts', i, x.id); scriptIds.add(x.id);
      if (!isStr(x.text, 1)) add(`scripts[${i}].text 必须是非空文本`);
      for (const k of ['identity', 'situation', 'reason', 'emotion']) if (!isStr(x[k])) add(`scripts[${i}].${k} 必须是文本`);
      if (typeof x.loud !== 'boolean') add(`scripts[${i}].loud 必须是布尔值`);
    });
    s.practices.forEach((x, i) => {
      if (!x || typeof x !== 'object') return add(`practices[${i}] 不是对象`);
      uniq('practices', i, x.id);
      if (!scriptIds.has(x.scriptId)) add(`practices[${i}].scriptId 找不到对应脚本`);
      if (typeof x.seconds !== 'number' || !Number.isFinite(x.seconds) || x.seconds < MIN_SECONDS || x.seconds > LIMITS.maxSeconds) add(`practices[${i}].seconds 必须是 ${MIN_SECONDS}-${LIMITS.maxSeconds} 的数字(只有满 ${MIN_SECONDS} 秒的练习才会被记录)`);
      if (!parseAt(x.at)) add(`practices[${i}].at 必须是有效的 YYYY-MM-DDTHH:MM:SS`);
    });
    s.triggers.forEach((x, i) => {
      if (!x || typeof x !== 'object') return add(`triggers[${i}] 不是对象`);
      uniq('triggers', i, x.id);
      if (!scriptIds.has(x.scriptId)) add(`triggers[${i}].scriptId 找不到对应脚本`);
      if (parseYmd(x.date) === null) add(`triggers[${i}].date 必须是有效的 YYYY-MM-DD`);
      if (!isStr(x.situation)) add(`triggers[${i}].situation 必须是文本`);
      if (!isStr(x.reaction)) add(`triggers[${i}].reaction 必须是文本`);
      if (typeof x.executed !== 'boolean') add(`triggers[${i}].executed 必须是布尔值`);
    });
    return errs.length ? { ok: false, errors: errs } : { ok: true, errors: [], state: s };
  }
  function validateImport(input) {
    let obj = input;
    if (typeof input === 'string') {
      try { obj = JSON.parse(input); } catch (e) { return { ok: false, errors: ['不是有效的 JSON 文件'] }; }
    }
    return validateState(obj);
  }

  // ---------- 导出 ----------
  function guardCell(v) {
    const s = String(v == null ? '' : v);
    if (s === '-' || s === '+') return s; // 单独的 - / + 不是公式
    return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  }
  function csvCell(v) {
    const s = guardCell(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(state) {
    const byId = new Map(state.scripts.map(s => [s.id, s]));
    const rows = [['脚本', '日期', '时间', '秒数'].concat(state.sample ? ['数据性质'] : [])];
    for (const r of state.practices) {
      const at = parseAt(r.at);
      rows.push([byId.has(r.scriptId) ? byId.get(r.scriptId).text : '', at.date, at.time, r.seconds.toFixed(1)].concat(state.sample ? ['合成示例'] : []));
    }
    return rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
  const oneLine = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  const mdCell = v => guardCell(oneLine(v)).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
  const TYPE_LABEL = { universal: '通用型', situational: '情境型' };
  function toMarkdown(state, today) {
    const cfg = state.config;
    const out = ['# 半秒脚本卡', '', `导出日期:${today}`, '来自公开书稿的方法,不是治疗。', ''];
    if (state.sample) out.push('> 合成示例:本卡数据是虚构的演示数据,不是真实记录。', '');
    if (!state.scripts.length) out.push('(还没有脚本)', '');
    state.scripts.forEach((s, i) => {
      const chk = checkScript(s.text, cfg);
      const st = stats(state, s.id, today);
      out.push(`## 脚本 ${i + 1}`, '', `> ${oneLine(s.text)}`, '', `- 类型:${TYPE_LABEL[chk.type]}`);
      for (const [k, label] of [['identity', '身份'], ['situation', '情境'], ['reason', '理由'], ['emotion', '情绪']]) if (s[k]) out.push(`- ${label}:${oneLine(s[k])}`);
      out.push(`- 今日 ${st.today} 次,累计 ${st.total} 次,连续 ${st.streak} 天`);
      for (const is of chk.issues) out.push(`- 提示:${is.message}`);
      if (s.loud) out.push(`- 姓名/你版本(只改显示文字,请自行朗读):${oneLine(thirdPerson(s.text, state.name))}`);
      out.push('');
    });
    if (state.scripts.length) {
      out.push('## 汇总', '', '| 脚本 | 类型 | 今日 | 累计 | 连续天数 |', '| --- | --- | --- | --- | --- |');
      for (const s of state.scripts) {
        const st = stats(state, s.id, today);
        out.push(`| ${mdCell(s.text)} | ${TYPE_LABEL[checkScript(s.text, cfg).type]} | ${st.today} | ${st.total} | ${st.streak} |`);
      }
      out.push('');
    }
    return out.join('\n');
  }

  const api = { VERSION, MAX_SCRIPTS, MIN_SECONDS, LIMITS, DEFAULT_CONFIG, parseYmd, addDays, diffDays, dow, resolveToday, parseAt, checkScript, thirdPerson, secondPerson, nextId, emptyState, recordPractice, streak, heatmap, weeklyCounts, stats, executionRate, validateState, validateImport, guardCell, toCsv, toMarkdown };
  globalThis.HalfsecCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
