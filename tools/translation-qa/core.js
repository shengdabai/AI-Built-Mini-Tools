'use strict';
/* 译稿机械检查 · 纯逻辑(无 DOM)。只做机械一致性检查,不判断译文是否准确。 */

var DEFAULTS = { caseSensitive: false, ratioHigh: 3, ratioLow: 0.3 };

var LEVEL_LABEL = { block: '阻断', warn: '警告' };
var TYPE_LABEL = {
  missing: '漏译', extra: '原文为空', placeholder: '占位符', number: '数字',
  glossary: '术语', ratio: '长度比', punct: '末尾标点', untranslated: '疑似未译', inconsistent: '同原文不同译'
};

function splitLines(text) {
  var lines = String(text == null ? '' : text).replace(/^﻿/, '').split(/\r\n|\r|\n/);
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  return lines;
}

/* 两个纯文本按行对齐。行数不等时 mismatch=true,短的一侧补空串。 */
function alignText(src, tgt) {
  var a = splitLines(src), b = splitLines(tgt);
  var total = Math.max(a.length, b.length);
  var pairs = [];
  for (var i = 0; i < total; i++) {
    pairs.push({ n: String(i + 1), src: i < a.length ? a[i] : '', tgt: i < b.length ? b[i] : '' });
  }
  var mismatch = a.length !== b.length;
  var note = '';
  if (mismatch) {
    note = '原文 ' + a.length + ' 行,译文 ' + b.length + ' 行,行数不等。按行号对齐,多出的 ' +
      Math.abs(a.length - b.length) + ' 行会被当作' + (a.length > b.length ? '漏译' : '原文为空') + '处理。';
  }
  return { pairs: pairs, srcCount: a.length, tgtCount: b.length, mismatch: mismatch, note: note };
}

/* RFC4180 风格解析,支持引号内换行与 "" 转义。返回行数组;引号未闭合时返回 null。 */
function parseDelimited(text, delim) {
  var rows = [], row = [], cell = '', inQ = false, i = 0, s = String(text).replace(/^﻿/, '');
  while (i < s.length) {
    var c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      cell += c; i++; continue;
    }
    if (c === '"' && cell === '') { inQ = true; i++; continue; }
    if (c === delim) { row.push(cell); cell = ''; i++; continue; }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = ''; i++; continue;
    }
    cell += c; i++;
  }
  if (inQ) return null;
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/* 导入双语表(段落号、原文、译文)。不合法就整份拒绝并说明原因,不静默修正。 */
function parseTable(text) {
  var raw = String(text == null ? '' : text);
  if (raw.trim() === '') return { ok: false, error: '表格是空的。' };
  var firstLine = raw.replace(/^﻿/, '').split(/\r\n|\r|\n/).find(function (l) { return l.trim() !== ''; }) || '';
  var delim = firstLine.indexOf('\t') >= 0 ? '\t' : ',';
  var rows = parseDelimited(raw, delim);
  if (rows === null) return { ok: false, error: '引号没有闭合,表格被拒绝导入。' };
  rows = rows.filter(function (r) { return !(r.length === 1 && r[0].trim() === ''); });
  if (!rows.length) return { ok: false, error: '表格是空的。' };
  var head = rows[0].map(function (c) { return c.trim().toLowerCase(); });
  var isHeader = ['原文', 'source', 'src'].indexOf(head[1]) >= 0 || ['译文', 'target', 'tgt', 'translation'].indexOf(head[2]) >= 0;
  var offset = isHeader ? 2 : 1;
  if (isHeader) rows = rows.slice(1);
  var pairs = [], seen = new Map();
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i], line = i + offset;
    if (r.length < 3) return { ok: false, error: '第 ' + line + ' 行只有 ' + r.length + ' 列,需要 3 列(段落号、原文、译文)。整份表格被拒绝导入。' };
    for (var k = 3; k < r.length; k++) {
      if (r[k].trim() !== '') return { ok: false, error: '第 ' + line + ' 行超过 3 列。多余内容不会被忽略,整份表格被拒绝导入。' };
    }
    var n = r[0].trim();
    if (n === '') return { ok: false, error: '第 ' + line + ' 行的段落号是空的。整份表格被拒绝导入。' };
    if (seen.has(n)) return { ok: false, error: '段落号「' + n + '」在第 ' + seen.get(n) + ' 行和第 ' + line + ' 行重复。整份表格被拒绝导入。' };
    seen.set(n, line);
    pairs.push({ n: n, src: r[1], tgt: r[2] });
  }
  return { ok: true, pairs: pairs };
}

/* 术语表:每行 `原文术语 | 译法1, 译法2`。支持全角 ｜ 与 ，、；;。空行与 # 开头的行忽略。 */
function parseGlossary(text) {
  var entries = [], errors = [];
  var lines = String(text == null ? '' : text).split(/\r\n|\r|\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line === '' || line[0] === '#') continue;
    var m = line.match(/^([^|｜]*)[|｜](.*)$/);
    if (!m) { errors.push({ line: i + 1, reason: '缺少分隔符「|」', text: line }); continue; }
    var term = m[1].trim();
    var allowed = m[2].split(/[,，、;；]/).map(function (x) { return x.trim(); }).filter(Boolean);
    if (!term) { errors.push({ line: i + 1, reason: '原文术语是空的', text: line }); continue; }
    if (!allowed.length) { errors.push({ line: i + 1, reason: '没有写允许的译法', text: line }); continue; }
    entries.push({ term: term, allowed: allowed, line: i + 1 });
  }
  return { entries: entries, errors: errors };
}

var RE_TAG = /<\/?[A-Za-z][^<>]*>/g;
var RE_BRACE = /\{[A-Za-z0-9_.]*\}/g;
var RE_PERCENT = /(?<![\d%])%(?:\d+\$)?[-+0#]*(?:\d+|\*)?(?:\.\d+)?[sdiufxXoeEgGc]/g;
var RE_NEWLINE = /\\n|\r\n|\r|\n/g;

/* 占位符多重集合(排序后的数组):{0}/{name}、%s/%d、HTML 标签、换行(字面 \n 与真实换行都记为 \n)。 */
function placeholders(s) {
  var str = String(s == null ? '' : s), out = [];
  [RE_BRACE, RE_PERCENT, RE_TAG].forEach(function (re) {
    var m = str.match(re);
    if (m) out = out.concat(m);
  });
  var nl = str.match(RE_NEWLINE);
  if (nl) nl.forEach(function () { out.push('\\n'); });
  return out.sort();
}

function stripPlaceholders(s) {
  return String(s).replace(RE_TAG, ' ').replace(RE_BRACE, ' ').replace(RE_PERCENT, ' ');
}

/* 数字集合(去重排序):全角转半角,千分位逗号去掉,占位符与标签里的数字不算。 */
function numbers(s) {
  var str = stripPlaceholders(String(s == null ? '' : s).normalize('NFKC'));
  str = str.replace(/(?<=\d),(?=\d{3}(?!\d))/g, '');
  var m = str.match(/\d+(?:\.\d+)?/g) || [];
  var set = new Set(m);
  return Array.from(set).sort();
}

function countMap(arr) {
  var m = new Map();
  arr.forEach(function (x) { m.set(x, (m.get(x) || 0) + 1); });
  return m;
}

function multisetDiff(a, b) {
  var ca = countMap(a), cb = countMap(b), missing = [], extra = [];
  ca.forEach(function (v, k) { var d = v - (cb.get(k) || 0); for (var i = 0; i < d; i++) missing.push(k); });
  cb.forEach(function (v, k) { var d = v - (ca.get(k) || 0); for (var i = 0; i < d; i++) extra.push(k); });
  return { missing: missing, extra: extra };
}

function show(t) { return t === '\\n' ? '换行' : t; }
function cut(s, n) { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; }
function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }
function charLen(s) { return Array.from(String(s)).length; }

/* 末尾标点类型:q 问号 / e 感叹 / p 句号(含省略号) / n 其他或没有。结尾的引号与括号先跳过。 */
function endType(s) {
  var t = String(s).replace(/[\s"'”’」』)）\]】>》]+$/, '');
  var c = t.slice(-1);
  if (c === '?' || c === '？') return 'q';
  if (c === '!' || c === '！') return 'e';
  if (c === '.' || c === '。' || c === '…' || c === '．') return 'p';
  return 'n';
}
var END_LABEL = { q: '问号', e: '感叹号', p: '句号', n: '无句末标点' };

function validateOptions(o) {
  if (!o || typeof o !== 'object') return '选项缺失。';
  if (typeof o.caseSensitive !== 'boolean') return '「大小写敏感」必须是开或关。';
  if (typeof o.ratioHigh !== 'number' || !isFinite(o.ratioHigh) || o.ratioHigh <= 0) return '长度比上限必须是大于 0 的数字。';
  if (typeof o.ratioLow !== 'number' || !isFinite(o.ratioLow) || o.ratioLow <= 0) return '长度比下限必须是大于 0 的数字。';
  if (o.ratioLow >= o.ratioHigh) return '长度比下限必须小于上限。';
  return null;
}

function includesText(hay, needle, cs) {
  return cs ? hay.indexOf(needle) >= 0 : hay.toLowerCase().indexOf(needle.toLowerCase()) >= 0;
}

/* 主检查。pairs: [{n, src, tgt}];glossary: parseGlossary().entries;返回 {issues, stats}。 */
function check(pairs, glossary, options) {
  var opt = Object.assign({}, DEFAULTS, options || {});
  var err = validateOptions(opt);
  if (err) throw new TypeError(err);
  var list = Array.isArray(pairs) ? pairs : [];
  var gl = Array.isArray(glossary) ? glossary : [];
  var issues = [];
  var add = function (p, level, type, message) { issues.push({ n: p.n, level: level, type: type, message: message }); };

  list.forEach(function (p) {
    var src = String(p.src == null ? '' : p.src), tgt = String(p.tgt == null ? '' : p.tgt);
    var sEmpty = src.trim() === '', tEmpty = tgt.trim() === '';
    if (sEmpty && tEmpty) return;
    if (tEmpty) { add(p, 'block', 'missing', '漏译:原文有内容,译文是空的。'); return; }
    if (sEmpty) { add(p, 'block', 'extra', '原文是空的,译文却有内容。'); return; }

    var dp = multisetDiff(placeholders(src), placeholders(tgt));
    if (dp.missing.length || dp.extra.length) {
      var parts = [];
      if (dp.missing.length) parts.push('译文缺少 ' + dp.missing.map(show).join('、'));
      if (dp.extra.length) parts.push('译文多出 ' + dp.extra.map(show).join('、'));
      add(p, 'block', 'placeholder', '占位符不一致:' + parts.join(';') + '。');
    }
    var ns = numbers(src), nt = numbers(tgt);
    var nMissing = ns.filter(function (x) { return nt.indexOf(x) < 0; });
    var nExtra = nt.filter(function (x) { return ns.indexOf(x) < 0; });
    if (nMissing.length || nExtra.length) {
      var np = [];
      if (nMissing.length) np.push('译文没有 ' + nMissing.join('、'));
      if (nExtra.length) np.push('译文多出 ' + nExtra.join('、'));
      add(p, 'block', 'number', '数字不一致:' + np.join(';') + '。');
    }

    gl.forEach(function (g) {
      if (!includesText(src, g.term, opt.caseSensitive)) return;
      var ok = g.allowed.some(function (a) { return includesText(tgt, a, opt.caseSensitive); });
      if (!ok) add(p, 'warn', 'glossary', '术语「' + g.term + '」的译文不含允许的译法(' + g.allowed.join('、') + ')。');
    });

    var sl = charLen(src.trim()), tl = charLen(tgt.trim());
    var ratio = tl / sl;
    if (ratio > opt.ratioHigh || ratio < opt.ratioLow) {
      add(p, 'warn', 'ratio', '译文与原文长度比为 ' + (Math.round(ratio * 100) / 100) + '(译文 ' + tl + ' 字符,原文 ' + sl + ' 字符),超出 ' + opt.ratioLow + ' 到 ' + opt.ratioHigh + ' 的范围。');
    }

    var es = endType(src), et = endType(tgt);
    if (es !== et) {
      add(p, 'warn', 'punct', '末尾标点类型不一致:原文是' + END_LABEL[es] + ',译文是' + END_LABEL[et] + '。');
    }

    if (src.trim() === tgt.trim()) {
      add(p, 'warn', 'untranslated', '原文与译文完全相同,疑似没有翻译。');
    }
  });

  var groups = new Map();
  list.forEach(function (p) {
    var s = norm(p.src == null ? '' : p.src), t = norm(p.tgt == null ? '' : p.tgt);
    if (!s || !t) return;
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push({ p: p, t: t });
  });
  groups.forEach(function (members) {
    if (members.length < 2) return;
    var distinct = new Set(members.map(function (m) { return m.t; }));
    if (distinct.size < 2) return;
    members.forEach(function (m) {
      var others = members.filter(function (o) { return o !== m && o.t !== m.t; });
      if (!others.length) {
        others = members.filter(function (o) { return o !== m; });
      }
      add(m.p, 'warn', 'inconsistent', '同一原文在其他段落译法不同:' +
        others.map(function (o) { return '第 ' + o.p.n + ' 段「' + cut(o.t, 24) + '」'; }).join('、') + '。');
    });
  });

  var order = new Map();
  list.forEach(function (p, i) { order.set(p.n, i); });
  issues = issues.map(function (x, i) { x._i = i; return x; }).sort(function (a, b) {
    var d = order.get(a.n) - order.get(b.n);
    if (d) return d;
    if (a.level !== b.level) return a.level === 'block' ? -1 : 1;
    return a._i - b._i;
  }).map(function (x) { delete x._i; return x; });

  var count = function (type) { return issues.filter(function (x) { return x.type === type; }).length; };
  var flagged = new Set(issues.map(function (x) { return x.n; }));
  var stats = {
    segments: list.length,
    missing: count('missing'), extra: count('extra'),
    glossary: count('glossary'), placeholder: count('placeholder'), number: count('number'),
    ratio: count('ratio'), punct: count('punct'), untranslated: count('untranslated'), inconsistent: count('inconsistent'),
    blocking: issues.filter(function (x) { return x.level === 'block'; }).length,
    warnings: issues.filter(function (x) { return x.level === 'warn'; }).length,
    flaggedSegments: flagged.size
  };
  return { issues: issues, stats: stats };
}

/* ---- 导出 ---- */

/* 防公式注入:字符串以 = + - @(或制表/回车)开头时加单引号前缀;单独的 - 或 + 不算。 */
function guardCell(v) {
  if (typeof v !== 'string') return v == null ? '' : String(v);
  if (v === '-' || v === '+') return v;
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}

function csvCell(v) {
  var s = guardCell(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/* rows: 二维数组,第一行通常是表头。 */
function toCsv(rows) {
  return (rows || []).map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
}

function issuesToCsv(issues, opts) {
  var sample = !!(opts && opts.sample);
  var rows = [['段落号', '级别', '类型', '说明'].concat(sample ? ['数据来源'] : [])];
  issues.forEach(function (x) { rows.push([x.n, LEVEL_LABEL[x.level], TYPE_LABEL[x.type], x.message].concat(sample ? ['合成示例'] : [])); });
  return toCsv(rows);
}

function annotatedCsv(pairs, issues, opts) {
  var sample = !!(opts && opts.sample);
  var by = new Map();
  issues.forEach(function (x) {
    if (!by.has(x.n)) by.set(x.n, []);
    by.get(x.n).push('[' + LEVEL_LABEL[x.level] + '] ' + x.message);
  });
  var rows = [['段落号', '原文', '译文', '问题'].concat(sample ? ['数据来源'] : [])];
  pairs.forEach(function (p) { rows.push([p.n, p.src, p.tgt, (by.get(p.n) || []).join(' ')].concat(sample ? ['合成示例'] : [])); });
  return toCsv(rows);
}

function mdCell(v) {
  return guardCell(v == null ? '' : String(v)).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r\n|\r|\n/g, ' ');
}

function issuesToMarkdown(issues, stats, meta) {
  var m = meta || {}, pairs = m.pairs || [];
  var by = new Map();
  pairs.forEach(function (p) { by.set(p.n, p); });
  var out = ['# 译稿机械检查报告', ''];
  out.push('只做机械一致性检查,不判断译文是否准确。', '');
  if (m.sample) out.push('> 数据来源:合成示例,不是真实稿件。', '');
  if (m.alignNote) out.push('> 对齐提示:' + m.alignNote, '');
  if (stats) {
    out.push('- 段数:' + stats.segments);
    out.push('- 漏译:' + stats.missing);
    out.push('- 术语不一致:' + stats.glossary);
    out.push('- 占位符问题:' + stats.placeholder);
    out.push('- 数字不一致:' + stats.number);
    out.push('- 阻断:' + stats.blocking + ',警告:' + stats.warnings, '');
  }
  if (!issues.length) { out.push('没有发现问题。'); return out.join('\n') + '\n'; }
  out.push('| 段落号 | 级别 | 类型 | 说明 | 原文摘录 | 译文摘录 |');
  out.push('|---|---|---|---|---|---|');
  issues.forEach(function (x) {
    var p = by.get(x.n) || { src: '', tgt: '' };
    out.push('| ' + [mdCell(x.n), LEVEL_LABEL[x.level], TYPE_LABEL[x.type], mdCell(x.message), mdCell(cut(p.src, 60)), mdCell(cut(p.tgt, 60))].join(' | ') + ' |');
  });
  return out.join('\n') + '\n';
}

/* ---------- 状态校验、运行前检查、范围与结论 ---------- */
var MAX_TEXT_CHARS = 1000000;
function validState(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  if (o.mode !== 'table' && o.mode !== 'two') return false;
  var strs = ['tableText', 'srcText', 'tgtText', 'glossaryText', 'ratioHigh', 'ratioLow'];
  for (var i = 0; i < strs.length; i++) if (typeof o[strs[i]] !== 'string' || o[strs[i]].length > MAX_TEXT_CHARS) return false;
  return typeof o.caseSensitive === 'boolean';
}
function pickState(o) {
  return { mode: o.mode, tableText: o.tableText, srcText: o.srcText, tgtText: o.tgtText, glossaryText: o.glossaryText,
    caseSensitive: o.caseSensitive, ratioHigh: o.ratioHigh, ratioLow: o.ratioLow };
}
function backupObject(st) { return { app: 'transcheck', version: 1, state: pickState(st) }; }
function validateBackup(raw) {
  var o = raw;
  if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch (e) { return { ok: false, error: '不是合法的 JSON 文件。' }; } }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, error: '顶层必须是对象。' };
  if (o.app !== 'transcheck' || o.version !== 1) return { ok: false, error: '不是译稿机械检查的 v1 备份(app 或 version 不符)。' };
  if (!validState(o.state)) return { ok: false, error: 'state 字段不合法:模式只能是 table / two,文本须是不超过 ' + MAX_TEXT_CHARS + ' 个字符的字符串,大小写敏感须是 true / false。' };
  return { ok: true, state: pickState(o.state) };
}

function nonBlankLines(t) { return String(t == null ? '' : t).split(/\r\n|\r|\n/).filter(function (l) { return l.trim() !== ''; }).length; }
function replaceScope(st, hasResult) {
  var s = st || {};
  var tableLines = nonBlankLines(s.tableText);
  var twoLines = Math.max(nonBlankLines(s.srcText), nonBlankLines(s.tgtText));
  var glossaryLines = nonBlankLines(s.glossaryText);
  var optionsChanged = !!s.caseSensitive || String(s.ratioHigh == null ? '' : s.ratioHigh).trim() !== String(DEFAULTS.ratioHigh) || String(s.ratioLow == null ? '' : s.ratioLow).trim() !== String(DEFAULTS.ratioLow);
  return {
    tableLines: tableLines, twoLines: twoLines, glossaryLines: glossaryLines, optionsChanged: optionsChanged, hasResult: !!hasResult,
    any: tableLines > 0 || twoLines > 0 || glossaryLines > 0 || optionsChanged || !!hasResult
  };
}
function describeScope(sc) {
  var p = [];
  if (sc.tableLines) p.push('双语表 ' + sc.tableLines + ' 行');
  if (sc.twoLines) p.push('两个文本框里 ' + sc.twoLines + ' 行');
  if (sc.glossaryLines) p.push('术语表 ' + sc.glossaryLines + ' 行');
  if (sc.optionsChanged) p.push('改过的选项(大小写敏感或长度比,会恢复默认)');
  if (sc.hasResult) p.push('当前检查结果');
  return p.join('、');
}

/* 运行检查前的输入校验:所有错误都带字段名(table / src / glossary / ratioHigh / ratioLow),供界面贴近控件显示 */
function prepareRun(st) {
  var s = st || {};
  var errors = [];
  var pairs = [], alignNote = '';
  if (s.mode === 'two') {
    var a = alignText(s.srcText, s.tgtText);
    pairs = a.pairs; alignNote = a.note;
    if (!pairs.length) errors.push({ field: 'src', message: '没有可检查的内容。请在「原文」和「译文」框里各粘贴每段一行的文字,或载入合成示例。' });
  } else {
    var t = parseTable(s.tableText);
    if (!t.ok) errors.push({ field: 'table', message: t.error === '表格是空的。' ? '没有可检查的内容。请粘贴双语表,或载入合成示例。' : '双语表被拒绝:' + t.error });
    else pairs = t.pairs;
  }
  var g = parseGlossary(s.glossaryText);
  if (g.errors.length) {
    errors.push({ field: 'glossary', message: '术语表有 ' + g.errors.length + ' 行不合法:' + g.errors.slice(0, 3).map(function (x) { return '第 ' + x.line + ' 行' + x.reason; }).join(';') + (g.errors.length > 3 ? ' 等' : '') + '。' });
  }
  var hiS = String(s.ratioHigh == null ? '' : s.ratioHigh).trim(), loS = String(s.ratioLow == null ? '' : s.ratioLow).trim();
  var hi = Number(hiS), lo = Number(loS);
  var hiOk = hiS !== '' && isFinite(hi) && hi > 0, loOk = loS !== '' && isFinite(lo) && lo > 0;
  if (!hiOk) errors.push({ field: 'ratioHigh', message: hiS === '' ? '长度比上限要填。' : '长度比上限必须是大于 0 的数字。' });
  if (!loOk) errors.push({ field: 'ratioLow', message: loS === '' ? '长度比下限要填。' : '长度比下限必须是大于 0 的数字。' });
  if (hiOk && loOk && lo >= hi) errors.push({ field: 'ratioLow', message: '长度比下限必须小于上限。' });
  if (errors.length) return { ok: false, errors: errors };
  return { ok: true, errors: [], pairs: pairs, alignNote: alignNote, glossary: g.entries, options: { caseSensitive: !!s.caseSensitive, ratioHigh: hi, ratioLow: lo } };
}

/* 「没有发现问题」只在检查完整完成时出现 */
function checkVerdict(result, errors) {
  var errs = errors || [];
  if (errs.length) return { state: 'incomplete', text: '检查未完成:' + errs.length + ' 处错误,见标红的输入框。' + (result ? '下面显示的是上一次检查的结果。' : '') };
  if (!result) return { state: 'incomplete', text: '检查未完成:还没有运行检查。' };
  var st = result.stats;
  if (!result.issues.length) return { state: 'clean', text: '共检查 ' + st.segments + ' 段,没有发现问题(阻断 0 条,警告 0 条)。' };
  return { state: 'issues', text: '共检查 ' + st.segments + ' 段,发现 ' + result.issues.length + ' 条问题(阻断 ' + st.blocking + ' 条,警告 ' + st.warnings + ' 条)。' };
}

var api = {
  MAX_TEXT_CHARS: MAX_TEXT_CHARS, validState: validState, backupObject: backupObject, validateBackup: validateBackup,
  replaceScope: replaceScope, describeScope: describeScope, prepareRun: prepareRun, checkVerdict: checkVerdict,
  DEFAULTS: DEFAULTS, LEVEL_LABEL: LEVEL_LABEL, TYPE_LABEL: TYPE_LABEL,
  alignText: alignText, parseTable: parseTable, parseGlossary: parseGlossary,
  placeholders: placeholders, numbers: numbers, endType: endType, validateOptions: validateOptions,
  check: check, toCsv: toCsv, issuesToCsv: issuesToCsv, annotatedCsv: annotatedCsv,
  issuesToMarkdown: issuesToMarkdown, guardCell: guardCell
};
globalThis.TransCheckCore = api;
if (typeof module !== 'undefined') module.exports = api;
