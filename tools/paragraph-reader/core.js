'use strict';
/* 逐段精读器 · 纯逻辑(无 DOM)。浏览器里挂在 globalThis.ReaderCore,Node 里 module.exports。 */
(function () {
  // ---------- 日期(全部在 UTC 时间轴上做加减,避免时区/夏令时进位错误) ----------
  const DAY_MS = 86400000;
  function parseYmd(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const ms = Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
    return fmtYmd(ms) === s ? ms : null; // 2026-02-30 这类会被进位,格式化回来与原串不等 → 拒绝
  }
  function fmtYmd(ms) {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '';
    return `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  const isDate = s => parseYmd(s) !== null;
  function addDays(s, n) { return fmtYmd(parseYmd(s) + n * DAY_MS); }
  function weekStart(s) { // 周一为一周起点
    const ms = parseYmd(s);
    return fmtYmd(ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY_MS);
  }
  // ?today=YYYY-MM-DD;非法或会被进位的日期回退到 now(本地日历日)
  function todayFrom(search, now) {
    let q = null;
    try { q = new URLSearchParams(search || '').get('today'); } catch (e) { q = null; }
    if (q && isDate(q)) return q;
    const d = now instanceof Date ? now : new Date();
    return `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ---------- 分段与分句 ----------
  const OPEN_Q = new Set(['“', '「', '『']);
  const CLOSE_Q = new Set(['”', '」', '』']);
  const EXTRA_CLOSERS = new Set(['’', '‘', ')', '）', ']', '】', '»', "'"]);
  const TERM_CHARS = new Set(['。', '！', '？', '!', '?', '…', '.']);
  const ABBR = new Set(['e.g', 'i.e', 'mr', 'mrs', 'ms', 'dr', 'prof', 'vs', 'fig', 'cf', 'al', 'u.s', 'u.k', 'a.m', 'p.m', 'sr', 'jr']);
  const isCjk = ch => /[\p{Script=Han}　-〿＀-￯]/u.test(ch);
  const isSpace = ch => /\s/.test(ch);

  function skipClosers(p, j) {
    while (j < p.length && (CLOSE_Q.has(p[j]) || EXTRA_CLOSERS.has(p[j]) || p[j] === '"')) j++;
    return j;
  }
  function boundaryAfter(p, j) { // 终止符之后是否像句子边界
    if (j >= p.length) return true;
    const ch = p[j];
    return isSpace(ch) || CLOSE_Q.has(ch) || EXTRA_CLOSERS.has(ch) || ch === '"' || isCjk(ch);
  }
  function precedingToken(p, i) {
    let k = i;
    while (k > 0 && /[A-Za-z.]/.test(p[k - 1])) k--;
    return p.slice(k, i).toLowerCase();
  }

  function splitParagraph(p) {
    const out = [];
    const n = p.length;
    let start = 0, i = 0, depth = 0, straight = false;
    const flush = end => { const s = p.slice(start, end).trim(); if (s) out.push(s); start = end; };
    while (i < n) {
      const ch = p[i];
      if (OPEN_Q.has(ch)) { depth++; i++; continue; }
      if (CLOSE_Q.has(ch)) { depth = Math.max(0, depth - 1); i++; continue; }
      if (ch === '"') { straight = !straight; i++; continue; }
      if (!TERM_CHARS.has(ch)) { i++; continue; }
      let j = i;
      while (j < n && TERM_CHARS.has(p[j])) j++;
      const group = p.slice(i, j);
      let isEnd;
      if (/[。！？]/.test(group)) isEnd = true;
      else if (/[!?]/.test(group)) isEnd = boundaryAfter(p, j);
      else if (group.includes('…') || group.length >= 2) { // 省略号:后面紧跟小写英文 → 句子没完
        let k = skipClosers(p, j);
        while (k < n && isSpace(p[k])) k++;
        isEnd = k >= n || !/[a-z]/.test(p[k]);
      } else { // 单个英文句点
        const tok = precedingToken(p, i);
        const nextCh = p[j];
        const decimal = /\d/.test(p[i - 1] || '') && /\d/.test(nextCh || '');
        let abbr = ABBR.has(tok) || /^[a-z]$/.test(tok);
        if (tok === 'etc') { let k = j; while (k < n && isSpace(p[k])) k++; abbr = /[a-z0-9]/.test(p[k] || ''); }
        isEnd = boundaryAfter(p, j) && !decimal && !abbr;
      }
      if (!isEnd) { i = j; continue; }
      while (j < n && (CLOSE_Q.has(p[j]) || EXTRA_CLOSERS.has(p[j]) || (p[j] === '"' && straight))) {
        if (CLOSE_Q.has(p[j])) depth = Math.max(0, depth - 1);
        else if (p[j] === '"') straight = false;
        j++;
      }
      if (depth === 0 && !straight) flush(j);
      i = j;
    }
    flush(n);
    return out;
  }

  function splitParagraphs(text) {
    if (typeof text !== 'string') return [];
    return text.replace(/\r\n?/g, '\n').split(/\n[ \t\f\v]*\n/).map(s => s.trim()).filter(Boolean);
  }
  // 建立索引:段数组、句数组(带所属段)、每段第一句的下标
  function indexText(text) {
    const paras = splitParagraphs(text);
    const sents = [], firstSent = [];
    paras.forEach((p, pi) => {
      firstSent.push(sents.length);
      for (const s of splitParagraph(p)) sents.push({ t: s, p: pi });
    });
    return { paras, sents, firstSent };
  }
  function segment(text, mode) {
    const ix = indexText(text);
    return mode === 'sent' ? ix.sents.map(s => s.t) : ix.paras;
  }
  // 位置:{para, sent}。para/sent 取值 0..总数(等于总数表示已读完)
  function posAt(ix, mode, idx) {
    const total = mode === 'sent' ? ix.sents.length : ix.paras.length;
    const i = Math.max(0, Math.min(total, Math.trunc(idx)));
    if (mode === 'sent') return { para: i >= ix.sents.length ? ix.paras.length : ix.sents[i].p, sent: i };
    return { para: i, sent: i >= ix.paras.length ? ix.sents.length : ix.firstSent[i] };
  }
  function advance(ix, pos, mode, delta) {
    const cur = mode === 'sent' ? pos.sent : pos.para;
    return posAt(ix, mode, cur + delta);
  }

  // ---------- 字数 ----------
  // cjk:汉字个数;words:英文词(含内部连字符/撇号)与数字串个数;total = cjk + words
  function countChars(text) {
    const s = typeof text === 'string' ? text : '';
    const cjk = (s.match(/\p{Script=Han}/gu) || []).length;
    const words = (s.match(/\p{Script=Latin}+(?:['’\-]\p{Script=Latin}+)*|\d+(?:[.,]\d+)*/gu) || []).length;
    return { cjk, words, total: cjk + words };
  }

  // ---------- 会话 ----------
  // events: {t(ms), type: start|resume|pause|end|tick|read|mark, chars?}
  function sessionStats(events) {
    let running = false, last = 0, activeMs = 0, chars = 0, marks = 0;
    for (const ev of Array.isArray(events) ? events : []) {
      if (running) activeMs += Math.max(0, ev.t - last);
      last = ev.t;
      if (ev.type === 'start' || ev.type === 'resume') running = true;
      else if (ev.type === 'pause' || ev.type === 'end') running = false;
      else if (ev.type === 'read') chars += Math.max(0, Number(ev.chars) || 0);
      else if (ev.type === 'mark') marks += 1;
    }
    const seconds = Math.round(activeMs / 1000);
    const cpm = seconds > 0 ? Math.round((chars / (seconds / 60)) * 10) / 10 : 0;
    return { seconds, minutes: Math.round(seconds / 6) / 10, chars, marks, cpm, running };
  }
  // 把进行中的会话结算成一条记录(没读到内容返回 null)
  function finalizeSession(active, now) {
    if (!active) return null;
    const s = sessionStats(active.events.concat([{ t: now, type: 'end' }]));
    if (s.seconds === 0 && s.chars === 0 && s.marks === 0) return null;
    return { id: newId('s'), textId: active.textId, title: active.title, date: active.date, seconds: s.seconds, chars: s.chars, marks: s.marks };
  }
  // 切换当前文本:先结束原文本的会话并记入阅读记录,新会话之后归属新文本。返回被结算的记录或 null
  function switchText(st, textId, now) {
    let rec = null;
    if (st.currentTextId !== textId) {
      rec = finalizeSession(st.active, now);
      if (rec) st.sessions.push(rec);
      st.active = null;
    }
    st.currentTextId = textId;
    return rec;
  }
  function breakDue(activeSeconds, ackSeconds, breakMin) {
    if (!(breakMin > 0)) return false;
    return activeSeconds - (ackSeconds || 0) >= breakMin * 60;
  }
  function fmtClock(sec) {
    const s = Math.max(0, Math.round(sec));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    const mm = String(m).padStart(2, '0'), rr = String(r).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${rr}` : `${mm}:${rr}`;
  }

  // ---------- 耐力 ----------
  // sessions: {date, seconds, chars};一次会话归入开始当天
  function dailyStats(sessions) {
    const map = new Map();
    for (const s of Array.isArray(sessions) ? sessions : []) {
      const d = map.get(s.date) || { date: s.date, seconds: 0, chars: 0, sessions: 0, longest: 0 };
      d.seconds += s.seconds; d.chars += s.chars; d.sessions += 1; d.longest = Math.max(d.longest, s.seconds);
      map.set(s.date, d);
    }
    return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .map(d => ({ ...d, minutes: Math.round(d.seconds / 6) / 10 }));
  }
  function streak(days, goalMin, today) {
    const met = new Set();
    for (const d of days) if (d.seconds >= goalMin * 60) met.add(d.date);
    let current = 0;
    let cur = met.has(today) ? today : addDays(today, -1); // 今天还没达标时,连续天数从昨天往回数
    while (met.has(cur)) { current++; cur = addDays(cur, -1); }
    let best = 0, run = 0, prev = null;
    for (const d of [...met].sort()) {
      run = prev !== null && addDays(prev, 1) === d ? run + 1 : 1;
      if (run > best) best = run;
      prev = d;
    }
    return { current, best };
  }
  function sumRange(sessions, from, to) {
    let seconds = 0, chars = 0, sessionsN = 0;
    const days = new Set();
    for (const s of sessions) if (s.date >= from && s.date <= to) { seconds += s.seconds; chars += s.chars; sessionsN++; days.add(s.date); }
    return { seconds, minutes: Math.round(seconds / 6) / 10, chars, sessions: sessionsN, activeDays: days.size };
  }
  function weekCompare(sessions, today) { // 周一到周日;本周截至周日,上周为完整一周
    const ws = weekStart(today);
    const thisWeek = sumRange(sessions, ws, addDays(ws, 6));
    const lastWeek = sumRange(sessions, addDays(ws, -7), addDays(ws, -1));
    const deltaMinutes = Math.round((thisWeek.minutes - lastWeek.minutes) * 10) / 10;
    const pct = lastWeek.seconds > 0 ? Math.round(((thisWeek.seconds - lastWeek.seconds) / lastWeek.seconds) * 100) : null;
    return { thisWeek, lastWeek, deltaMinutes, pct, weekStart: ws };
  }
  function goalRate(days, goalMin, today) { // 含今天的最近 7 天里达标的天数
    const map = new Map(days.map(d => [d.date, d]));
    let met = 0;
    for (let i = 0; i < 7; i++) { const d = map.get(addDays(today, -i)); if (d && d.seconds >= goalMin * 60) met++; }
    return { met, of: 7, rate: met / 7 };
  }

  // ---------- 生词 ----------
  let idSeq = 0;
  function newId(prefix) { idSeq += 1; return `${prefix}${Date.now().toString(36)}${idSeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`; }
  const normWord = w => String(w == null ? '' : w).normalize('NFKC').replace(/\s+/g, ' ').trim();
  const wordKey = w => normWord(w).toLowerCase();
  // 返回 {list, entry, isNew};空词原样返回 list 且 entry=null
  function addVocab(list, word, context, source, today) {
    const w = normWord(word);
    if (!w) return { list, entry: null, isNew: false };
    const key = wordKey(w);
    const ctx = String(context == null ? '' : context).trim();
    const src = String(source == null ? '' : source);
    const idx = list.findIndex(v => wordKey(v.word) === key);
    if (idx < 0) {
      const entry = { id: newId('v'), word: w, context: ctx, source: src, date: today, lastDate: today, count: 1, extra: [] };
      return { list: list.concat([entry]), entry, isNew: true };
    }
    const old = list[idx];
    const seen = old.context === ctx || old.extra.some(e => e.context === ctx);
    const entry = { ...old, count: old.count + 1, lastDate: today, extra: seen || !ctx ? old.extra : old.extra.concat([{ context: ctx, source: src, date: today }]) };
    const next = list.slice(); next[idx] = entry;
    return { list: next, entry, isNew: false };
  }
  function sortVocab(list, by) { // 'recent':添加日期新→旧,同日后加的在前;'count':出现次数多→少,同次数按最近
    const withPos = list.map((v, i) => ({ v, i }));
    withPos.sort((a, b) => {
      if (by === 'count' && b.v.count !== a.v.count) return b.v.count - a.v.count;
      if (a.v.date !== b.v.date) return a.v.date < b.v.date ? 1 : -1;
      return b.i - a.i;
    });
    return withPos.map(x => x.v);
  }
  // 在单元文字里找包含该词的那一句,找不到就返回整个单元
  function contextOf(unit, word) {
    const u = String(unit || '');
    const w = normWord(word);
    if (!w) return u.trim();
    const hit = splitParagraph(u).find(s => s.toLowerCase().includes(w.toLowerCase()));
    return (hit || u).trim();
  }

  // ---------- 导出 ----------
  function protect(v) { // CSV/TSV/Markdown 表格:以 = + - @ 开头的用户字段加单引号前缀(单独的 - 或 + 不算)
    const s = v == null ? '' : String(v);
    if (s === '-' || s === '+') return s;
    return /^[=+\-@]/.test(s) ? "'" + s : s;
  }
  function csvCell(v) {
    const s = protect(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  // columns: [{key, label}];行结束用 CRLF
  function toCsv(rows, columns) {
    const lines = [columns.map(c => csvCell(c.label)).join(',')];
    for (const r of rows) lines.push(columns.map(c => csvCell(r[c.key])).join(','));
    return lines.join('\r\n') + '\r\n';
  }
  const VOCAB_COLS = [{ key: 'word', label: '词' }, { key: 'context', label: '上下文' }, { key: 'source', label: '来源' }, { key: 'date', label: '添加日期' }, { key: 'lastDate', label: '最近出现' }, { key: 'count', label: '出现次数' }];
  const SESSION_COLS = [{ key: 'date', label: '日期' }, { key: 'title', label: '文本' }, { key: 'minutes', label: '分钟' }, { key: 'chars', label: '字数' }, { key: 'cpm', label: '字每分钟' }, { key: 'marks', label: '标记数' }];
  function vocabCsv(list) { return toCsv(list, VOCAB_COLS); }
  function sessionsCsv(sessions) {
    const rows = sessions.map(s => ({ ...s, minutes: Math.round(s.seconds / 6) / 10, cpm: s.seconds > 0 ? Math.round((s.chars / (s.seconds / 60)) * 10) / 10 : 0 }));
    return toCsv(rows, SESSION_COLS);
  }
  const oneLine = s => String(s == null ? '' : s).replace(/\s*\n\s*/g, ' ').trim();
  // notes: {source, kind, quote, note, date};按来源文本分组(Map,不会被 __proto__ 之类的名字污染)
  function toMarkdown(notes, exportDate) {
    const groups = new Map();
    for (const n of notes) { if (!groups.has(n.source)) groups.set(n.source, []); groups.get(n.source).push(n); }
    const out = ['# 批注清单', '', `导出日期:${exportDate || ''}　共 ${notes.length} 条`, ''];
    for (const [source, items] of groups) {
      out.push(`## ${oneLine(source) || '（未命名文本）'}`, '');
      for (const n of items) {
        out.push(`- ${n.date}　${n.kind === 'skip' ? '先读过去' : '不同意/存疑'}`);
        out.push(`  > ${oneLine(n.quote)}`);
        if (oneLine(n.note)) out.push(`  批注:${oneLine(n.note)}`);
      }
      out.push('');
    }
    return out.join('\n');
  }

  // ---------- 状态与校验 ----------
  const MODES = ['para', 'sent'];
  const THEMES = ['light', 'dark'];
  const EVENT_TYPES = ['start', 'resume', 'pause', 'end', 'tick', 'read', 'mark'];
  const NOTE_KINDS = ['doubt', 'skip'];
  function emptyState() {
    return { version: 1, settings: { goalMin: 30, breakMin: 25, mode: 'para', theme: 'light' }, texts: [], currentTextId: null, vocab: [], notes: [], sessions: [], active: null, sample: false };
  }
  function makeText(title, body, today) {
    const b = typeof body === 'string' ? body.replace(/\r\n?/g, '\n') : '';
    if (!b.trim()) return { ok: false, error: '文本是空的,没有可读的内容。' };
    const t = String(title == null ? '' : title).trim() || '未命名文本';
    return { ok: true, text: { id: newId('t'), title: t, body: b, addedAt: today, pos: { para: 0, sent: 0 }, times: {}, skips: [], sample: false } };
  }

  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isStr = v => typeof v === 'string';
  const isIdStr = v => isStr(v) && v.length > 0;
  const isNonNeg = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  const isNonNegInt = v => Number.isInteger(v) && v >= 0;
  const isPos = v => typeof v === 'number' && Number.isFinite(v) && v > 0;
  function uniqueIds(arr, label) {
    const seen = new Set();
    for (const x of arr) { if (seen.has(x.id)) return `${label} 的 ID 重复:${x.id}`; seen.add(x.id); }
    return null;
  }

  // 保存前与读取后都用这一个函数。不合法 → {ok:false,error},绝不静默修正
  function validateState(s) {
    const bad = m => ({ ok: false, error: m });
    if (!isObj(s)) return bad('备份不是一个对象。');
    if (s.version !== 1) return bad('版本号不是 1。');
    const st = s.settings;
    if (!isObj(st)) return bad('缺少 settings。');
    if (!isPos(st.goalMin)) return bad('每日目标分钟必须是大于 0 的数字。');
    if (!isPos(st.breakMin)) return bad('休息间隔分钟必须是大于 0 的数字。');
    if (!MODES.includes(st.mode)) return bad('settings.mode 必须是 para 或 sent。');
    if (!THEMES.includes(st.theme)) return bad('settings.theme 必须是 light 或 dark。');
    for (const k of ['texts', 'vocab', 'notes', 'sessions']) if (!Array.isArray(s[k])) return bad(`${k} 必须是数组。`);
    if (typeof s.sample !== 'boolean') return bad('sample 必须是布尔值。');
    for (const t of s.texts) {
      if (!isObj(t) || !isIdStr(t.id)) return bad('texts 里有条目缺少 id。');
      if (!isStr(t.title) || !isStr(t.body)) return bad(`文本 ${t.id} 的 title/body 必须是字符串。`);
      if (!t.body.trim()) return bad(`文本 ${t.id} 的正文是空的。`);
      if (!isDate(t.addedAt)) return bad(`文本 ${t.id} 的 addedAt 不是有效日期。`);
      if (!isObj(t.pos) || !isNonNegInt(t.pos.para) || !isNonNegInt(t.pos.sent)) return bad(`文本 ${t.id} 的进度位置不合法。`);
      const ix = indexText(t.body);
      if (t.pos.para > ix.paras.length || t.pos.sent > ix.sents.length) return bad(`文本 ${t.id} 的进度位置超出范围。`);
      if (!isObj(t.times)) return bad(`文本 ${t.id} 的 times 必须是对象。`);
      for (const k of Object.keys(t.times)) {
        if (!/^[ps]\d+$/.test(k) || !isNonNeg(t.times[k])) return bad(`文本 ${t.id} 的停留时间记录不合法:${k}`);
      }
      if (!Array.isArray(t.skips) || t.skips.some(k => !isStr(k) || !/^[ps]\d+$/.test(k))) return bad(`文本 ${t.id} 的 skips 不合法。`);
      if (typeof t.sample !== 'boolean') return bad(`文本 ${t.id} 的 sample 必须是布尔值。`);
    }
    let e = uniqueIds(s.texts, 'texts');
    if (e) return bad(e);
    if (s.currentTextId !== null && !s.texts.some(t => t.id === s.currentTextId)) return bad('currentTextId 指向不存在的文本。');
    for (const v of s.vocab) {
      if (!isObj(v) || !isIdStr(v.id)) return bad('vocab 里有条目缺少 id。');
      if (!isStr(v.word) || !normWord(v.word)) return bad(`生词 ${v.id} 的词是空的。`);
      if (!isStr(v.context) || !isStr(v.source)) return bad(`生词 ${v.id} 的 context/source 必须是字符串。`);
      if (!isDate(v.date) || !isDate(v.lastDate)) return bad(`生词 ${v.id} 的日期不合法。`);
      if (!Number.isInteger(v.count) || v.count < 1) return bad(`生词 ${v.id} 的出现次数必须是 ≥1 的整数。`);
      if (!Array.isArray(v.extra) || v.extra.some(x => !isObj(x) || !isStr(x.context) || !isStr(x.source) || !isDate(x.date))) return bad(`生词 ${v.id} 的 extra 不合法。`);
    }
    e = uniqueIds(s.vocab, 'vocab');
    if (e) return bad(e);
    const keys = new Set();
    for (const v of s.vocab) { const k = wordKey(v.word); if (keys.has(k)) return bad(`生词重复:${v.word}`); keys.add(k); }
    for (const n of s.notes) {
      if (!isObj(n) || !isIdStr(n.id)) return bad('notes 里有条目缺少 id。');
      if (!NOTE_KINDS.includes(n.kind)) return bad(`批注 ${n.id} 的类型必须是 doubt 或 skip。`);
      if (!isStr(n.source) || !isStr(n.quote) || !isStr(n.note)) return bad(`批注 ${n.id} 的 source/quote/note 必须是字符串。`);
      if (!n.quote.trim()) return bad(`批注 ${n.id} 的引用是空的。`);
      if (!isDate(n.date)) return bad(`批注 ${n.id} 的日期不合法。`);
      if (n.textId !== null && !isStr(n.textId)) return bad(`批注 ${n.id} 的 textId 不合法。`);
    }
    e = uniqueIds(s.notes, 'notes');
    if (e) return bad(e);
    for (const x of s.sessions) {
      if (!isObj(x) || !isIdStr(x.id)) return bad('sessions 里有条目缺少 id。');
      if (!isDate(x.date)) return bad(`会话 ${x.id} 的日期不合法。`);
      if (!isStr(x.title)) return bad(`会话 ${x.id} 的 title 必须是字符串。`);
      if (!isNonNeg(x.seconds) || !isNonNegInt(x.chars) || !isNonNegInt(x.marks)) return bad(`会话 ${x.id} 的 seconds/chars/marks 不合法。`);
      if (x.textId !== null && !isStr(x.textId)) return bad(`会话 ${x.id} 的 textId 不合法。`);
    }
    e = uniqueIds(s.sessions, 'sessions');
    if (e) return bad(e);
    if (s.active !== null) {
      const a = s.active;
      if (!isObj(a) || !isDate(a.date) || !isStr(a.title) || (a.textId !== null && !isStr(a.textId))) return bad('active 会话不合法。');
      if (!isNonNeg(a.breakAck)) return bad('active.breakAck 不合法。');
      if (!Array.isArray(a.events) || a.events.some(ev => !isObj(ev) || !Number.isFinite(ev.t) || !EVENT_TYPES.includes(ev.type) || (ev.type === 'read' && !isNonNeg(ev.chars)))) return bad('active.events 不合法。');
    }
    return { ok: true, state: s };
  }
  // 导入:接受 JSON 字符串或已解析对象
  function validateImport(input) {
    let obj = input;
    if (typeof input === 'string') {
      try { obj = JSON.parse(input); } catch (err) { return { ok: false, error: '不是合法的 JSON 文件。' }; }
    }
    return validateState(obj);
  }

  function snippet(s, max = 40) {
    const t = String(s ?? '').replace(/\s+/g, ' ').trim();
    const chars = [...t];
    return chars.length > max ? chars.slice(0, max).join('') + '…' : t;
  }
  const api = {
    snippet, segment, finalizeSession, switchText, indexText, splitParagraph, posAt, advance, countChars, sessionStats, breakDue, fmtClock,
    dailyStats, streak, weekCompare, goalRate, addVocab, sortVocab, contextOf, normWord, wordKey,
    protect, toCsv, vocabCsv, sessionsCsv, toMarkdown, validateState, validateImport, emptyState, makeText,
    todayFrom, parseYmd, isDate, addDays, weekStart, newId,
  };
  globalThis.ReaderCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
