'use strict';
/* 本机笔记全文检索 · 纯逻辑(不访问 DOM)。
   中文按字二元组(bigram)、英文按词建倒排索引;查询支持 AND、"短语"、-排除、path: 前缀。 */
(function () {
  const INDEX_VERSION = 1;
  const PARA_BASE = 100000000; // 倒排键 = 文档号 * PARA_BASE + 段落序号(0 起)
  const TITLE_BONUS = 5;
  const DEFAULT_RADIUS = 60;
  const BASE_EXTS = ['md', 'txt', 'markdown'];
  const DEFAULT_STOPWORDS = [
    '的', '了', '是', '在', '和', '与', '及', '也', '都', '就', '有', '不', '我', '你', '他', '她', '它',
    '这', '那', '个', '之', '而', '并', '但', '或', '对', '为', '从', '以', '把', '被', '着', '过', '等',
    '我们', '你们', '他们', '这个', '那个', '一个', '没有', '可以', '因为', '所以', '如果', '什么',
    'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was', 'were', 'be', 'it', 'this', 'that', 'with', 'as', 'at', 'by', 'i', 'we', 'you'
  ];

  // 汉字连续串 → bigram;其余字母数字连续串 → 词
  const TOKEN_RE = /(\p{Script=Han}+)|((?:(?!\p{Script=Han})[\p{L}\p{N}])+)/gu;
  const HAN_RE = /\p{Script=Han}/u;

  function tokenize(text, opts) {
    const queryMode = !!(opts && opts.query);
    const out = [];
    const s = String(text == null ? '' : text).toLowerCase();
    for (const m of s.matchAll(TOKEN_RE)) {
      if (m[1]) {
        const chars = Array.from(m[1]);
        if (chars.length === 1) { if (!queryMode) out.push(chars[0]); } // 单字 run 只在建索引时保留
        else for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i] + chars[i + 1]);
      } else out.push(m[2]);
    }
    return out;
  }

  function splitParagraphs(text) {
    return String(text == null ? '' : text).replace(/\r\n?/g, '\n').split(/\n[ \t]*\n+/).map(s => s.trim()).filter(Boolean);
  }
  const countChars = text => String(text == null ? '' : text).replace(/\s+/g, '').length;
  function basename(path) { const i = path.lastIndexOf('/'); return i >= 0 ? path.slice(i + 1) : path; }
  function stripExt(name) { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(0, i) : name; }
  function titleOf(path, text) {
    const m = /^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(String(text).replace(/\r\n?/g, '\n'));
    return m && m[1].trim() ? m[1].trim() : stripExt(basename(path));
  }

  // ---------- 文件类型 ----------
  function normalizeExts(str) {
    const exts = []; const invalid = [];
    for (const raw of String(str == null ? '' : str).split(/[\s,，、;；]+/)) {
      if (!raw) continue;
      const e = raw.replace(/^\./, '').toLowerCase();
      if (/^[a-z0-9_+-]{1,16}$/.test(e)) { if (!exts.includes(e) && !BASE_EXTS.includes(e)) exts.push(e); } else invalid.push(raw);
    }
    return { exts, invalid };
  }
  function isNoteFile(name, extra) {
    const s = String(name == null ? '' : name);
    const i = s.lastIndexOf('.');
    if (i <= 0 || i === s.length - 1) return false;
    const ext = s.slice(i + 1).toLowerCase();
    return BASE_EXTS.includes(ext) || (Array.isArray(extra) && extra.includes(ext));
  }

  // ---------- 建索引 ----------
  function buildIndex(docs, options) {
    const opts = options || {};
    const postings = new Map();
    const outDocs = [];
    let paraCount = 0, charCount = 0, tokenCount = 0;
    (Array.isArray(docs) ? docs : []).forEach((d, id) => {
      const path = String((d && d.path) == null ? '' : d.path);
      const text = String((d && d.text) == null ? '' : d.text);
      const paras = splitParagraphs(text);
      const mtime = d && Number.isFinite(d.mtime) ? d.mtime : null;
      outDocs.push({ id, path, title: titleOf(path, text), mtime, chars: countChars(text), paras });
      paraCount += paras.length; charCount += countChars(text);
      paras.forEach((p, pi) => {
        const key = id * PARA_BASE + pi;
        const toks = tokenize(p);
        tokenCount += toks.length;
        for (const t of new Set(toks)) {
          const arr = postings.get(t);
          if (arr) arr.push(key); else postings.set(t, [key]);
        }
      });
    });
    return {
      version: INDEX_VERSION,
      builtDate: String(opts.builtDate || ''),
      source: String(opts.source || ''),
      docs: outDocs,
      postings,
      stats: {
        fileCount: outDocs.length, paraCount, charCount, tokenCount, termCount: postings.size,
        files: outDocs.map(d => ({ path: d.path, paras: d.paras.length, chars: d.chars, mtime: d.mtime }))
      }
    };
  }

  // 写入缓存前与读取缓存后共用
  function validateIndex(idx) {
    const bad = msg => ({ ok: false, error: msg });
    if (!idx || typeof idx !== 'object') return bad('索引不是对象');
    if (idx.version !== INDEX_VERSION) return bad('索引版本不匹配');
    if (typeof idx.builtDate !== 'string' || typeof idx.source !== 'string') return bad('索引日期或来源类型错误');
    if (!Array.isArray(idx.docs)) return bad('docs 不是数组');
    if (!(idx.postings instanceof Map)) return bad('postings 不是 Map');
    const st = idx.stats;
    if (!st || typeof st !== 'object') return bad('缺少统计');
    for (const k of ['fileCount', 'paraCount', 'charCount', 'tokenCount', 'termCount']) {
      if (!Number.isInteger(st[k]) || st[k] < 0) return bad(`统计字段 ${k} 不合法`);
    }
    if (!Array.isArray(st.files) || st.files.length !== idx.docs.length || st.fileCount !== idx.docs.length) return bad('统计与文档数不一致');
    let paras = 0;
    for (let i = 0; i < idx.docs.length; i++) {
      const d = idx.docs[i];
      if (!d || typeof d !== 'object') return bad(`文档 ${i} 不是对象`);
      if (d.id !== i) return bad(`文档 ${i} 的 id 不连续`);
      if (typeof d.path !== 'string' || typeof d.title !== 'string') return bad(`文档 ${i} 路径或标题类型错误`);
      if (!(d.mtime === null || Number.isFinite(d.mtime))) return bad(`文档 ${i} 的修改时间不合法`);
      if (!Number.isInteger(d.chars) || d.chars < 0) return bad(`文档 ${i} 的字数不合法`);
      if (!Array.isArray(d.paras) || d.paras.some(p => typeof p !== 'string')) return bad(`文档 ${i} 的段落不合法`);
      paras += d.paras.length;
    }
    if (paras !== st.paraCount) return bad('段落总数与统计不一致');
    if (st.termCount !== idx.postings.size) return bad('词项数与统计不一致');
    for (const [term, arr] of idx.postings) {
      if (typeof term !== 'string' || !Array.isArray(arr)) return bad('倒排项类型错误');
      let prev = -1;
      for (const k of arr) {
        if (!Number.isInteger(k) || k <= prev) return bad(`词项「${term}」的倒排表未升序`);
        prev = k;
        const doc = idx.docs[Math.floor(k / PARA_BASE)];
        if (!doc || (k % PARA_BASE) >= doc.paras.length) return bad(`词项「${term}」指向不存在的段落`);
      }
    }
    return { ok: true };
  }

  // ---------- 查询解析 ----------
  function parseQuery(q) {
    const res = { must: [], phrases: [], not: [], notPhrases: [], path: '', warnings: [] };
    const s = String(q == null ? '' : q);
    const n = s.length;
    const closeOf = c => (c === '"' ? '"' : c === '“' ? '”' : '');
    const readQuoted = i => { // s[i] 是开引号;返回 [内容, 下一位置]
      const close = closeOf(s[i]);
      const j = s.indexOf(close, i + 1);
      if (j < 0) { res.warnings.push('引号没有闭合,按短语读到末尾'); return [s.slice(i + 1), n]; }
      return [s.slice(i + 1, j), j + 1];
    };
    let i = 0;
    while (i < n) {
      if (/\s/.test(s[i])) { i++; continue; }
      let neg = false;
      if (s[i] === '-') {
        if (i + 1 < n && !/\s/.test(s[i + 1])) { neg = true; i++; } else { i++; continue; } // 单独的 - 忽略
      }
      if (closeOf(s[i])) {
        const [content, next] = readQuoted(i); i = next;
        const t = content.trim().toLowerCase();
        if (t) { if (neg) { res.not.push(t); res.notPhrases.push(t); } else res.phrases.push(t); }
        continue;
      }
      let j = i;
      while (j < n && !/\s/.test(s[j])) j++;
      const word = s.slice(i, j);
      if (!neg && /^path:/i.test(word)) {
        let val = word.slice(5);
        if (closeOf(val[0] || '')) { const [content, next] = readQuoted(i + 5); val = content; j = next; }
        else if (!val && j < n && closeOf(s[j])) { const [content, next] = readQuoted(j); val = content; j = next; }
        res.path = val.trim().replace(/\\/g, '/');
        i = j; continue;
      }
      i = j;
      if (word) (neg ? res.not : res.must).push(word.toLowerCase());
    }
    return res;
  }

  // ---------- 匹配 ----------
  const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function termRegex(term, flags) {
    const pieces = String(term).trim().split(/\s+/).filter(Boolean).map(escapeRe);
    return new RegExp(pieces.join('\\s+'), flags || 'iu');
  }
  function termInfo(term) {
    return { term, tokens: tokenize(term, { query: true }), hasCjk: HAN_RE.test(term), re: termRegex(term, 'iu'), reG: termRegex(term, 'giu') };
  }
  function intersect(a, b) {
    const out = []; let i = 0, j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { out.push(a[i]); i++; j++; } else if (a[i] < b[j]) i++; else j++;
    }
    return out;
  }
  const docOf = (index, key) => index.docs[Math.floor(key / PARA_BASE)];
  const paraNo = key => key % PARA_BASE;

  // 返回满足查询的段落键与命中信息(未排序)
  function collect(index, parsed) {
    const musts = parsed.must.map(termInfo);
    const phrases = parsed.phrases.map(termInfo);
    const notPhrases = new Set(parsed.notPhrases || []);
    const nots = parsed.not.map(t => Object.assign(termInfo(t), { phrase: notPhrases.has(t) }));
    const required = musts.concat(phrases);
    if (!required.length) return [];
    let cand = null; // null = 全部段落
    for (const info of required) {
      if (!info.tokens.length) continue;
      for (const tk of info.tokens) {
        const arr = index.postings.get(tk) || [];
        cand = cand === null ? arr : intersect(cand, arr);
        if (!cand.length) return [];
      }
    }
    const pathLower = parsed.path.toLowerCase();
    const pathOk = d => !pathLower || d.path.toLowerCase().startsWith(pathLower);
    if (cand === null) {
      cand = [];
      for (const d of index.docs) if (pathOk(d)) for (let p = 0; p < d.paras.length; p++) cand.push(d.id * PARA_BASE + p);
    }
    const hitsOut = [];
    for (const key of cand) {
      const doc = docOf(index, key);
      if (!doc || !pathOk(doc)) continue;
      const text = doc.paras[paraNo(key)];
      let ok = true;
      for (const info of musts) { if ((info.hasCjk || !info.tokens.length) && !info.re.test(text)) { ok = false; break; } }
      if (ok) for (const info of phrases) { if (!info.re.test(text)) { ok = false; break; } }
      if (!ok) continue;
      if (nots.length) {
        let tokSet = null;
        for (const info of nots) {
          let hit;
          if (info.phrase || info.hasCjk || !info.tokens.length) hit = info.re.test(text);
          else { if (!tokSet) tokSet = new Set(tokenize(text)); hit = info.tokens.every(t => tokSet.has(t)); }
          if (hit) { ok = false; break; }
        }
        if (!ok) continue;
      }
      hitsOut.push({ key, doc, text, required });
    }
    return hitsOut;
  }

  function search(index, query, options) {
    const opts = options || {};
    const parsed = typeof query === 'string' ? parseQuery(query) : query;
    if (!index || !parsed) return [];
    const radius = Number.isInteger(opts.radius) ? opts.radius : DEFAULT_RADIUS;
    const out = collect(index, parsed).map(h => {
      let hits = 0;
      for (const info of h.required) hits += Math.max(1, (h.text.match(info.reG) || []).length);
      const density = hits / Math.max(Array.from(h.text).length, 40) * 100;
      const heading = h.doc.title + '\n' + basename(h.doc.path);
      const titleHit = h.required.some(info => info.re.test(heading));
      const terms = h.required.map(i => i.term);
      return {
        docId: h.doc.id, path: h.doc.path, title: h.doc.title, para: paraNo(h.key) + 1, text: h.text,
        hits, titleHit, score: density + (titleHit ? TITLE_BONUS : 0), terms,
        snippet: snippet(h.text, terms, radius)
      };
    });
    out.sort((a, b) => (b.score - a.score) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || (a.para - b.para));
    return out;
  }

  // ---------- 片段与高亮 ----------
  function highlights(text, terms) {
    const t = String(text == null ? '' : text);
    const uniq = Array.from(new Set((terms || []).map(x => String(x).trim()).filter(Boolean))).sort((a, b) => b.length - a.length);
    if (!uniq.length) return [];
    const re = new RegExp(uniq.map(x => x.split(/\s+/).map(escapeRe).join('\\s+')).join('|'), 'giu');
    const ranges = [];
    for (const m of t.matchAll(re)) {
      if (!m[0].length) continue;
      const s = m.index, e = m.index + m[0].length;
      const last = ranges[ranges.length - 1];
      if (last && s <= last[1]) last[1] = Math.max(last[1], e); else ranges.push([s, e]);
    }
    return ranges;
  }
  const isLowSurrogate = c => c >= 0xdc00 && c <= 0xdfff;
  function snippet(text, terms, radius) {
    const t = String(text == null ? '' : text);
    const r = Number.isInteger(radius) && radius >= 0 ? radius : DEFAULT_RADIUS;
    const all = highlights(t, terms);
    let start, end;
    if (!all.length) { start = 0; end = Math.min(t.length, r * 2); }
    else { start = Math.max(0, all[0][0] - r); end = Math.min(t.length, all[0][1] + r); }
    if (start > 0 && isLowSurrogate(t.charCodeAt(start))) start--;
    if (end < t.length && isLowSurrogate(t.charCodeAt(end))) end++;
    const hl = [];
    for (const [s, e] of all) {
      if (e <= start || s >= end) continue;
      hl.push([Math.max(s, start) - start, Math.min(e, end) - start]);
    }
    return { text: t.slice(start, end), highlights: hl, head: start > 0, tail: end < t.length };
  }

  // ---------- 共现词 ----------
  function stopwordSet(stopwords) {
    const list = stopwords === undefined ? DEFAULT_STOPWORDS : stopwords;
    return new Set(Array.from(list || []).map(w => String(w).toLowerCase()));
  }
  function cooccur(index, term, n, stopwords) {
    const limit = Number.isInteger(n) && n > 0 ? n : 20;
    const stop = stopwordSet(stopwords);
    const parsed = parseQuery(term);
    parsed.path = ''; parsed.not = []; parsed.notPhrases = [];
    const own = new Set();
    for (const x of parsed.must.concat(parsed.phrases)) for (const tk of tokenize(x)) own.add(tk);
    const stopChars = new Set(Array.from(stop).filter(w => Array.from(w).length === 1));
    const drop = tk => {
      if (own.has(tk) || stop.has(tk)) return true;
      const cs = Array.from(tk);
      return HAN_RE.test(tk) && cs.length === 2 && (stopChars.has(cs[0]) || stopChars.has(cs[1]));
    };
    const counts = new Map();
    for (const h of collect(index, parsed)) {
      for (const tk of new Set(tokenize(h.text))) {
        if (drop(tk)) continue;
        counts.set(tk, (counts.get(tk) || 0) + 1);
      }
    }
    return Array.from(counts, ([word, count]) => ({ term: word, count }))
      .sort((a, b) => (b.count - a.count) || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))
      .slice(0, limit);
  }

  function recentFiles(index, n) {
    const limit = Number.isInteger(n) && n > 0 ? n : 20;
    return index.docs.filter(d => Number.isFinite(d.mtime))
      .map(d => ({ path: d.path, mtime: d.mtime, paras: d.paras.length, chars: d.chars }))
      .sort((a, b) => (b.mtime - a.mtime) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .slice(0, limit);
  }

  // ---------- 导出 ----------
  function guardCell(v) {
    const s = String(v == null ? '' : v);
    return s.length > 1 && /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  }
  function csvCell(v) { return '"' + guardCell(v).replace(/"/g, '""') + '"'; }
  function toCsv(stats) {
    const rows = [['路径', '段落数', '字数', '最近修改'].map(csvCell).join(',')];
    for (const f of (stats && stats.files) || []) {
      const when = Number.isFinite(f.mtime) ? new Date(f.mtime).toISOString() : '';
      rows.push([csvCell(f.path), Number(f.paras) || 0, Number(f.chars) || 0, csvCell(when)].join(','));
    }
    return rows.join('\r\n') + '\r\n';
  }
  function codeSpan(s) {
    const str = String(s);
    const runs = str.match(/`+/g) || [];
    const fence = '`'.repeat(runs.reduce((m, r) => Math.max(m, r.length), 0) + 1);
    return fence + (str.startsWith('`') || str.endsWith('`') ? ' ' + str + ' ' : str) + fence;
  }
  function toMarkdown(results, meta) {
    const m = meta || {};
    const list = Array.isArray(results) ? results : [];
    const lines = ['# 搜索结果', ''];
    if (m.query != null) lines.push(`- 查询:${codeSpan(String(m.query).replace(/\s+/g, ' '))}`);
    if (m.date) lines.push(`- 日期:${m.date}`);
    if (m.source) lines.push(`- 索引来源:${String(m.source).replace(/\s+/g, ' ')}`);
    lines.push(`- 命中段落:${list.length}`, '');
    for (const r of list) {
      lines.push(`## ${codeSpan(r.path)} · 第 ${r.para} 段`, '');
      let body = String(r.text || '');
      const sn = r.snippet;
      if (sn) {
        let out = '';
        let pos = 0;
        for (const [s, e] of sn.highlights) { out += sn.text.slice(pos, s) + '**' + sn.text.slice(s, e) + '**'; pos = e; }
        out += sn.text.slice(pos);
        body = (sn.head ? '…' : '') + out + (sn.tail ? '…' : '');
      }
      for (const ln of body.replace(/\r\n?/g, '\n').split('\n')) lines.push('> ' + ln);
      lines.push('');
    }
    return lines.join('\n');
  }

  // ---------- 设置与日期 ----------
  function parseStopwords(text) {
    return Array.from(new Set(String(text == null ? '' : text).split(/[\s,，、;；]+/).map(s => s.trim()).filter(Boolean)));
  }
  function validateSettings(obj) {
    const bad = msg => ({ ok: false, error: msg });
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return bad('设置不是对象');
    if (obj.version !== 1) return bad('设置版本不匹配');
    if (!Array.isArray(obj.stopwords)) return bad('stopwords 不是数组');
    if (obj.stopwords.some(w => typeof w !== 'string' || !w)) return bad('stopwords 含有空项或非文本');
    return { ok: true };
  }
  const pad2 = n => String(n).padStart(2, '0');
  function localIso(d) { return `${String(d.getFullYear()).padStart(4, '0')}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
  function parseToday(search, now) {
    const real = localIso(now instanceof Date ? now : new Date());
    try {
      const v = new URLSearchParams(search || '').get('today');
      if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
        const [y, m, d] = v.split('-').map(Number);
        const dt = new Date(0); dt.setUTCFullYear(y, m - 1, d);
        if (Number.isFinite(dt.getTime()) && dt.toISOString().slice(0, 10) === v) return v;
      }
    } catch (e) { /* 回退真实今天 */ }
    return real;
  }

  /* 读到的笔记里,空白文件和含 U+FFFD 的文件(多半不是 UTF-8 编码)搜不到正常内容,单独列出来提示 */
  function findProblemNotes(docs) {
    const empty = [], encoding = [];
    for (const d of docs || []) {
      const t = String(d && d.text != null ? d.text : '');
      if (t.trim() === '') empty.push(d.path);
      else if (t.indexOf('\uFFFD') !== -1) encoding.push(d.path);
    }
    return { empty, encoding };
  }
  function describeProblemNotes(p, max) {
    const limit = max || 5;
    const names = list => list.length > limit ? `${list.slice(0, limit).join('、')} 等 ${list.length} 个` : list.join('、');
    const parts = [];
    if (p && p.empty && p.empty.length) parts.push(`${p.empty.length} 个笔记是空的,没有可搜索的文字:${names(p.empty)}。`);
    if (p && p.encoding && p.encoding.length) parts.push(`${p.encoding.length} 个笔记含无法识别的字符,可能不是 UTF-8 编码,里面的中文搜不到:${names(p.encoding)}。请用编辑器另存为 UTF-8 后重新选择。`);
    return parts.join(' ');
  }

  const api = {
    findProblemNotes, describeProblemNotes,
    tokenize, splitParagraphs, countChars, normalizeExts, isNoteFile,
    buildIndex, validateIndex, parseQuery, search, snippet, highlights, cooccur, recentFiles,
    toMarkdown, toCsv, guardCell, parseStopwords, validateSettings, parseToday,
    DEFAULT_STOPWORDS, PARA_BASE, TITLE_BONUS, DEFAULT_RADIUS
  };
  globalThis.NoteSearchCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
