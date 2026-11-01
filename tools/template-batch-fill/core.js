'use strict';
/* 模板批量填充 · 纯逻辑(无 DOM)。 */
(function () {
  var ILLEGAL_NAME = /[{}|#\/\\<>"'\u0000-\u001f\u007f]/;

  function lineOf(text, index) {
    var n = 1;
    for (var i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
    return n;
  }

  function checkName(name) {
    if (!name) return '字段名为空';
    if (ILLEGAL_NAME.test(name)) return '字段名「' + name + '」含非法字符(不能含 { } | # / \\ < > 引号或控制字符)';
    return '';
  }

  /* 独占一行的 if / endif 标签:连同行尾换行一起吃掉,避免多出空行 */
  function trimTagLines(tokens) {
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (t.type !== 'if' && t.type !== 'endif') continue;
      var prev = tokens[i - 1], next = tokens[i + 1];
      var atStart = !prev || (prev.type === 'text' && /(^|\n)[ \t]*$/.test(prev.value));
      if (!atStart || !next || next.type !== 'text' || !/^[ \t]*\r?\n/.test(next.value)) continue;
      next.value = next.value.replace(/^[ \t]*\r?\n/, '');
      if (prev) prev.value = prev.value.replace(/[ \t]+$/, '');
    }
  }

  /* ---------- 模板解析 ---------- */
  function parseTemplate(text) {
    text = String(text == null ? '' : text);
    var tokens = [], errors = [], fields = [], seen = new Set();
    var pos = 0, open = null;
    function addField(n) { if (!seen.has(n)) { seen.add(n); fields.push(n); } }
    function pushText(s) { if (s) tokens.push({ type: 'text', value: s }); }
    while (pos < text.length) {
      var start = text.indexOf('{{', pos);
      if (start === -1) { pushText(text.slice(pos)); break; }
      pushText(text.slice(pos, start));
      var end = text.indexOf('}}', start + 2);
      var line = lineOf(text, start);
      if (end === -1) {
        errors.push({ line: line, message: '占位符未闭合:第 ' + line + ' 行的「{{」后面找不到「}}」' });
        break;
      }
      var inner = text.slice(start + 2, end).trim();
      var raw = text.slice(start, end + 2);
      pos = end + 2;
      if (inner === '/if') {
        if (!open) errors.push({ line: line, message: '第 ' + line + ' 行的 {{/if}} 前面没有对应的 {{#if 字段}}' });
        else { tokens.push({ type: 'endif', line: line, raw: raw }); open = null; }
        continue;
      }
      if (inner.charAt(0) === '#') {
        var m = /^#if\s+(.+)$/.exec(inner);
        if (!m) { errors.push({ line: line, message: '第 ' + line + ' 行的「' + raw + '」不是支持的语法(只支持 {{#if 字段}}…{{/if}})' }); continue; }
        var cn = m[1].trim(), cerr = checkName(cn);
        if (cerr) { errors.push({ line: line, message: '第 ' + line + ' 行:' + cerr }); continue; }
        if (open) { errors.push({ line: line, message: '第 ' + line + ' 行:不支持嵌套条件块(第 ' + open.line + ' 行的 {{#if}} 还没有 {{/if}})' }); continue; }
        open = { line: line, name: cn };
        addField(cn);
        tokens.push({ type: 'if', name: cn, line: line, raw: raw });
        continue;
      }
      var bar = inner.indexOf('|');
      var name = (bar === -1 ? inner : inner.slice(0, bar)).trim();
      var def = bar === -1 ? null : inner.slice(bar + 1).trim();
      var nerr = checkName(name);
      if (nerr) { errors.push({ line: line, message: '第 ' + line + ' 行:' + nerr }); continue; }
      addField(name);
      tokens.push({ type: 'var', name: name, def: def, line: line, raw: raw });
    }
    if (open) errors.push({ line: open.line, message: '条件块不配对:第 ' + open.line + ' 行的 {{#if ' + open.name + '}} 没有 {{/if}}' });
    errors.sort(function (a, b) { return a.line - b.line; });
    trimTagLines(tokens);
    return { tokens: tokens, fields: fields, errors: errors };
  }

  /* ---------- 数据解析 ---------- */
  function detectDelimiter(text) {
    var first = '', inQ = false, i, ch;
    for (i = 0; i < text.length; i++) {
      ch = text[i];
      if (ch === '"') inQ = !inQ;
      if (!inQ && (ch === '\n' || ch === '\r')) { if (first.trim()) break; first = ''; continue; }
      first += ch;
    }
    var counts = { '\t': 0, ',': 0, ';': 0 };
    inQ = false;
    for (i = 0; i < first.length; i++) {
      ch = first[i];
      if (ch === '"') inQ = !inQ;
      else if (!inQ && ch in counts) counts[ch]++;
    }
    var best = ',', max = 0;
    ['\t', ',', ';'].forEach(function (d) { if (counts[d] > max) { max = counts[d]; best = d; } });
    return best;
  }

  function splitRecords(text, delim, errors) {
    var recs = [], cur = [], field = '', inQ = false, line = 1, recLine = 1, i = 0, n = text.length, wasQuoted = false;
    function endField() { cur.push(field); field = ''; wasQuoted = false; }
    function endRec() {
      endField();
      var blank = cur.length === 1 && cur[0].trim() === '';
      if (!blank) recs.push({ cells: cur, line: recLine });
      cur = [];
    }
    while (i < n) {
      var ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        if (ch === '\n') line++;
        field += ch; i++; continue;
      }
      if (ch === '"' && field === '' && !wasQuoted) { inQ = true; wasQuoted = true; i++; continue; }
      if (ch === delim) { endField(); i++; continue; }
      if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        i++; endRec(); line++; recLine = line; continue;
      }
      field += ch; i++;
    }
    if (inQ) errors.push({ line: recLine, message: '第 ' + recLine + ' 行:引号没有闭合' });
    if (field !== '' || cur.length) endRec();
    return recs;
  }

  function parseData(text) {
    text = String(text == null ? '' : text).replace(/^﻿/, '');
    var out = { headers: [], rows: [], errors: [], delimiter: ',' };
    if (!text.trim()) return out;
    var delim = detectDelimiter(text);
    out.delimiter = delim;
    var recs = splitRecords(text, delim, out.errors);
    if (!recs.length) return out;
    var head = recs[0];
    var headers = head.cells.map(function (h) { return h.trim(); });
    var seen = new Set();
    headers.forEach(function (h, idx) {
      var e = checkName(h);
      if (e) out.errors.push({ line: head.line, message: '第 ' + head.line + ' 行(表头第 ' + (idx + 1) + ' 列):' + e });
      else if (seen.has(h)) out.errors.push({ line: head.line, message: '第 ' + head.line + ' 行:表头字段「' + h + '」重复' });
      seen.add(h);
    });
    out.headers = headers;
    for (var r = 1; r < recs.length; r++) {
      var rec = recs[r], row = Object.create(null);
      var bad = rec.cells.length !== headers.length;
      if (bad) out.errors.push({ line: rec.line, kind: 'cols', extra: rec.cells.length - headers.length, message: '第 ' + rec.line + ' 行:有 ' + rec.cells.length + ' 列,表头有 ' + headers.length + ' 列' });
      headers.forEach(function (h, idx) { row[h] = idx < rec.cells.length ? rec.cells[idx].trim() : ''; });
      out.rows.push({ values: row, line: rec.line, bad: bad });
    }
    out.errors.sort(function (a, b) { return a.line - b.line; });
    return out;
  }

  /* ---------- 渲染 ---------- */
  function render(tokens, row) {
    row = row || Object.create(null);
    var parts = [], missing = [], active = true;
    function val(name) { var v = row[name]; return v == null ? '' : String(v).trim(); }
    tokens.forEach(function (t) {
      if (t.type === 'text') { if (active) parts.push({ k: 'text', v: t.value }); }
      else if (t.type === 'if') active = val(t.name) !== '';
      else if (t.type === 'endif') active = true;
      else if (t.type === 'var' && active) {
        var v = val(t.name);
        if (v !== '') parts.push({ k: 'val', v: v, name: t.name });
        else if (t.def !== null && t.def !== '') parts.push({ k: 'def', v: t.def, name: t.name });
        else { parts.push({ k: 'miss', v: t.raw, name: t.name }); missing.push(t.name); }
      }
    });
    return { text: parts.map(function (p) { return p.v; }).join(''), missing: missing, parts: parts };
  }

  function sanitizeName(s) {
    s = String(s).replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\/\\:*?"<>|]/g, '_');
    s = s.replace(/\.{2,}/g, '_').replace(/^[.\s]+/, '').replace(/[\s.]+$/, '');
    if (s.length > 120) s = s.slice(0, 120);
    return s || 'untitled';
  }

  function fileNameInfo(pattern, row) {
    var p = parseTemplate(pattern);
    var r = render(p.tokens, row);
    var s = r.text.replace(/\{\{[^}]*\}\}?/g, '');
    return { name: sanitizeName(s), missing: r.missing };
  }
  function fileName(pattern, row) { return fileNameInfo(pattern, row).name; }

  function uniqueNames(names) {
    var used = new Set(), out = [];
    names.forEach(function (n) {
      var c = n, k = 2, dot = n.lastIndexOf('.');
      var base = dot > 0 ? n.slice(0, dot) : n, ext = dot > 0 ? n.slice(dot) : '';
      while (used.has(c.toLowerCase())) { c = base + '-' + k + ext; k++; }
      used.add(c.toLowerCase()); out.push(c);
    });
    return out;
  }

  function fieldDiff(templateFields, headers) {
    var h = new Set(headers), t = new Set(templateFields);
    return {
      missingInData: templateFields.filter(function (f) { return !h.has(f); }),
      unusedInTemplate: headers.filter(function (x) { return !t.has(x); })
    };
  }

  function renderAll(templateText, dataText, opts) {
    opts = opts || {};
    var tpl = parseTemplate(templateText), data = parseData(dataText);
    var pattern = opts.filePattern == null ? '{{姓名}}-通知.txt' : opts.filePattern;
    var diff = fieldDiff(tpl.fields, data.headers);
    var fileTpl = parseTemplate(pattern);
    var fileDiff = fieldDiff(fileTpl.fields, data.headers);
    var res = {
      fileErrors: fileTpl.errors, fileDiff: fileDiff, fileFields: fileTpl.fields, fileMissingTotal: 0,
      fileBlocked: fileTpl.errors.length > 0 || (data.headers.length > 0 && fileDiff.missingInData.length > 0),
      templateErrors: tpl.errors, dataErrors: data.errors, fields: tpl.fields, headers: data.headers,
      diff: diff, delimiter: data.delimiter, results: [], missingTotal: 0,
      templateEmpty: !String(templateText || '').trim(), dataEmpty: data.rows.length === 0
    };
    if (tpl.errors.length || data.errors.length) return res; // 任一模板或数据解析错误都阻断整批生成
    var names = [];
    data.rows.forEach(function (row, i) {
      var r = render(tpl.tokens, row.values);
      res.missingTotal += r.missing.length;
      var fi = fileNameInfo(pattern, row.values);
      res.fileMissingTotal += fi.missing.length;
      res.results.push({ index: i, line: row.line, bad: row.bad, values: row.values, text: r.text, parts: r.parts, missing: r.missing, fileMissing: fi.missing });
      names.push(fi.name);
    });
    uniqueNames(names).forEach(function (n, i) { res.results[i].file = n; });
    return res;
  }

  /* 文件名模板的检查提示(语法错误、数据里没有的字段、逐条为空) */
  function fileCheckMessages(res) {
    var out = [];
    (res.fileErrors || []).forEach(function (e) { out.push('文件名模板 · ' + e.message); });
    if (res.headers && res.headers.length && res.fileDiff && res.fileDiff.missingInData.length) {
      out.push('文件名模板用到、数据里没有的字段:' + res.fileDiff.missingInData.join('、') + '(这些部分不会出现在文件名里)');
    }
    if (res.fileMissingTotal) {
      var rows = (res.results || []).filter(function (r) { return r.fileMissing && r.fileMissing.length; });
      out.push('有 ' + rows.length + ' 条的文件名里有字段是空的(第 ' + rows.slice(0, 5).map(function (r) { return r.line; }).join('、') + (rows.length > 5 ? ' 等' : '') + ' 行),空的部分会被省略,全空时文件名为 untitled;重名自动加序号');
    }
    return out;
  }

  /* 把表头之外多出的末尾列删掉(只处理列数多于表头的行),返回新文本与被改的行号;其余格式按分隔符重新整理 */
  function removeExtraColumns(text) {
    var raw = String(text == null ? '' : text).replace(/^﻿/, '');
    if (!raw.trim()) return { text: raw, changed: false, fixedLines: [] };
    var delim = detectDelimiter(raw);
    var errs = [];
    var recs = splitRecords(raw, delim, errs);
    if (errs.length || !recs.length) return { text: raw, changed: false, fixedLines: [] };
    var n = recs[0].cells.length, fixed = [];
    var lines = recs.map(function (rec, i) {
      var cells = rec.cells;
      if (i > 0 && cells.length > n) { cells = cells.slice(0, n); fixed.push(rec.line); }
      return cells.map(function (c) { return /[",\r\n]/.test(c) || c.indexOf(delim) >= 0 ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(delim);
    });
    if (!fixed.length) return { text: raw, changed: false, fixedLines: [] };
    return { text: lines.join('\n') + '\n', changed: true, fixedLines: fixed };
  }

  /* 第 N 行(物理行)在文本里的 [起, 止) 位置;不存在返回 null */
  function lineRange(text, line) {
    var s = String(text == null ? '' : text);
    var start = 0, n = 1;
    while (n < line) {
      var nl = s.indexOf('\n', start);
      if (nl === -1) return null;
      start = nl + 1; n++;
    }
    if (start > s.length) return null;
    var end = s.indexOf('\n', start);
    if (end === -1) end = s.length;
    if (end > start && s.charAt(end - 1) === '\r') end--;
    if (start === s.length && line > 1 && s.charAt(s.length - 1) === '\n') return null;
    return [start, end];
  }

  var DEFAULT_FILE_PATTERN = '{{姓名}}-通知.txt';
  var DEFAULT_SEPARATOR = '----------';
  /* 载入示例 / 导入 / 清空会替换什么:模板、数据、文件名模板、分隔线(后两项偏离默认值才算) */
  function replaceScope(st) {
    var s = st || {};
    var tpl = String(s.template == null ? '' : s.template);
    var dataText = String(s.data == null ? '' : s.data);
    var pat = s.filePattern == null ? DEFAULT_FILE_PATTERN : String(s.filePattern);
    var sep = s.separator == null ? DEFAULT_SEPARATOR : String(s.separator);
    var hasTpl = tpl.trim() !== '', hasData = dataText.trim() !== '';
    var rows = hasData ? parseData(dataText).rows.length : 0;
    var patChanged = pat !== DEFAULT_FILE_PATTERN, sepChanged = sep !== DEFAULT_SEPARATOR;
    return {
      hasTemplate: hasTpl, templateChars: hasTpl ? tpl.length : 0, hasData: hasData, dataRows: rows,
      filePattern: pat, filePatternChanged: patChanged, separator: sep, separatorChanged: sepChanged,
      any: hasTpl || hasData || patChanged || sepChanged
    };
  }
  function describeScope(sc) {
    var p = [];
    if (sc.hasTemplate) p.push('模板(' + sc.templateChars + ' 个字符)');
    if (sc.hasData) p.push('数据 ' + sc.dataRows + ' 行');
    if (sc.filePatternChanged) p.push('文件名模板「' + sc.filePattern + '」(会恢复默认)');
    if (sc.separatorChanged) p.push('分隔线「' + sc.separator + '」(会恢复默认)');
    return p.join('、');
  }

  /* 检查结论:模板、数据、文件名模板任一处有错都是「检查未完成」 */
  function checkSummary(res) {
    var fileMiss = res.headers && res.headers.length && res.fileDiff ? res.fileDiff.missingInData.length : 0;
    var tn = res.templateErrors.length, dn = res.dataErrors.length, fn = (res.fileErrors || []).length + fileMiss;
    var n = tn + dn + fn;
    if (res.templateEmpty && res.dataEmpty) return { state: 'empty', errorCount: 0, text: '模板和数据都是空的,没有可检查的内容。' };
    if (n) return { state: 'errors', errorCount: n, text: '检查未完成:' + n + ' 处错误(模板 ' + tn + '、数据 ' + dn + '、文件名模板 ' + fn + '),修好之前不能预览' + (tn || dn ? '和输出' : ' ZIP') + '。' };
    if (res.templateEmpty) return { state: 'incomplete', errorCount: 0, text: '检查未完成:模板是空的。' };
    if (res.dataEmpty) return { state: 'incomplete', errorCount: 0, text: '检查未完成:数据里没有数据行(首行是字段名,下面至少要有一行)。' };
    return { state: 'ok', errorCount: 0, text: '模板、数据、文件名模板的格式都没有发现错误。' };
  }

  function mergeTexts(texts, sep) {
    return texts.join('\n' + (sep == null ? '' : sep) + '\n');
  }

  /* ---------- CSV ---------- */
  function guard(s) {
    s = String(s == null ? '' : s);
    if (/^[=@]/.test(s) || /^[+\-]./.test(s)) return "'" + s;
    return s;
  }
  function csvCell(s) {
    s = guard(s);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(headers, results, opts) {
    var sample = !!(opts && opts.sample);
    var lines = [headers.concat(['渲染文本', '未填数']).concat(sample ? ['数据来源'] : []).map(csvCell).join(',')];
    results.forEach(function (r) {
      var cells = headers.map(function (h) { return csvCell(r.values[h]); });
      cells.push(csvCell(r.text)); cells.push(String(r.missing.length));
      if (sample) cells.push('合成示例');
      lines.push(cells.join(','));
    });
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  /* ---------- 备份导入 ---------- */
  var LIMITS = { template: 200000, data: 2000000 };

  /* 保存与读取共用:只查类型与大小,不要求模板无语法错误(允许半成品) */
  function validateImport(raw) {
    var obj, errors = [];
    try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; }
    catch (e) { return { ok: false, errors: ['不是合法的 JSON'] }; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, errors: ['顶层必须是对象'] };
    if (obj.version !== 1) errors.push('version 必须是 1');
    if (typeof obj.template !== 'string') errors.push('template 必须是字符串');
    else if (obj.template.length > LIMITS.template) errors.push('template 超过 ' + LIMITS.template + ' 个字符');
    if (typeof obj.data !== 'string') errors.push('data 必须是字符串');
    else if (obj.data.length > LIMITS.data) errors.push('data 超过 ' + LIMITS.data + ' 个字符');
    if (obj.filePattern !== undefined && typeof obj.filePattern !== 'string') errors.push('filePattern 必须是字符串');
    if (obj.separator !== undefined && typeof obj.separator !== 'string') errors.push('separator 必须是字符串');
    if (obj.sample !== undefined && typeof obj.sample !== 'boolean') errors.push('sample 必须是 true 或 false');
    if (errors.length) return { ok: false, errors: errors };
    return { ok: true, errors: [], value: {
      template: obj.template, data: obj.data, sample: obj.sample === true,
      filePattern: obj.filePattern === undefined ? '{{姓名}}-通知.txt' : obj.filePattern,
      separator: obj.separator === undefined ? '----------' : obj.separator
    } };
  }

  /* ---------- zip(store,无压缩) ---------- */
  var CRC_TABLE = null;
  function crc32(bytes) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Uint32Array(256);
      for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); CRC_TABLE[n] = c >>> 0; }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function utf8(s) { return new TextEncoder().encode(s); }
  function makeZip(files, when) {
    var d = when || new Date(2026, 9, 20, 12, 0, 0);
    var dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    var dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    var chunks = [], central = [], offset = 0;
    function u16(v) { return [v & 255, (v >>> 8) & 255]; }
    function u32(v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }
    files.forEach(function (f) {
      var nameB = utf8(f.name), data = utf8(f.content), crc = crc32(data);
      var local = [0x50, 0x4b, 0x03, 0x04].concat(u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate), u32(crc), u32(data.length), u32(data.length), u16(nameB.length), u16(0));
      chunks.push(Uint8Array.from(local), nameB, data);
      var cen = [0x50, 0x4b, 0x01, 0x02].concat(u16(20), u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate), u32(crc), u32(data.length), u32(data.length), u16(nameB.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset));
      central.push(Uint8Array.from(cen), nameB);
      offset += local.length + nameB.length + data.length;
    });
    var cenSize = 0; central.forEach(function (c) { cenSize += c.length; });
    var end = [0x50, 0x4b, 0x05, 0x06].concat(u16(0), u16(0), u16(files.length), u16(files.length), u32(cenSize), u32(offset), u16(0));
    var all = chunks.concat(central, [Uint8Array.from(end)]);
    var total = 0; all.forEach(function (c) { total += c.length; });
    var out = new Uint8Array(total), p = 0;
    all.forEach(function (c) { out.set(c, p); p += c.length; });
    return out;
  }

  var api = {
    parseTemplate: parseTemplate, parseData: parseData, render: render, renderAll: renderAll,
    fieldDiff: fieldDiff, fileName: fileName, fileNameInfo: fileNameInfo, fileCheckMessages: fileCheckMessages,
    removeExtraColumns: removeExtraColumns, lineRange: lineRange, replaceScope: replaceScope, describeScope: describeScope, checkSummary: checkSummary,
    DEFAULT_FILE_PATTERN: DEFAULT_FILE_PATTERN, DEFAULT_SEPARATOR: DEFAULT_SEPARATOR, uniqueNames: uniqueNames, mergeTexts: mergeTexts,
    toCsv: toCsv, validateImport: validateImport, LIMITS: LIMITS, makeZip: makeZip, crc32: crc32, detectDelimiter: detectDelimiter
  };
  globalThis.TplFillCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
