'use strict';
/* 库存异常检查 · 纯逻辑(无 DOM)。Node 与浏览器共用。 */
(function () {
  var FIELDS = ['code', 'name', 'open', 'in', 'out', 'close', 'unit', 'safety', 'price'];
  var FIELD_LABELS = { code: '商品编码', name: '商品名', open: '期初', in: '入库', out: '出库', close: '期末', unit: '单位', safety: '安全库存', price: '单价' };
  var NUM_FIELDS = ['open', 'in', 'out', 'close', 'safety', 'price'];
  var FLOW_FIELDS = ['open', 'in', 'out', 'close'];

  var RULES = [
    { id: 'EMPTY_CODE', level: 'block', label: '编码为空' },
    { id: 'BAD_NUMBER', level: 'block', label: '数字非法' },
    { id: 'FORMULA', level: 'block', label: '期初+入库−出库≠期末' },
    { id: 'NEGATIVE', level: 'block', label: '期末为负' },
    { id: 'DUP_CODE', level: 'block', label: '编码重复' },
    { id: 'UNIT_MISMATCH', level: 'warn', label: '同编码单位不一致' },
    { id: 'BELOW_SAFETY', level: 'warn', label: '期末低于安全库存' },
    { id: 'ZERO_WITH_IN', level: 'warn', label: '期末为 0 但本期有入库' },
    { id: 'OUT_BEFORE_IN', level: 'warn', label: '出库大于期初+入库(先出后入)' },
    { id: 'NAME_DUP', level: 'warn', label: '名称相同编码不同' },
    { id: 'NO_PRICE', level: 'warn', label: '单价为空但有出库' },
    { id: 'EMPTY_AS_ZERO', level: 'warn', label: '空值按 0' }
  ];
  var RULE_BY_ID = Object.create(null);
  RULES.forEach(function (r) { RULE_BY_ID[r.id] = r; });

  var DEFAULT_UNIT_MAP_TEXT = '个=件=pcs\n箱\nkg=千克\ng=克';

  function round6(x) { return Math.round(x * 1e6) / 1e6; }
  function fmt(x) {
    if (x === null || x === undefined || !isFinite(x)) return '';
    return String(round6(x));
  }
  function key(s) { return String(s == null ? '' : s).normalize('NFKC').trim().toLowerCase(); }

  /* ---------- 解析 ---------- */
  function detectDelimiter(src) {
    var tabs = 0, commas = 0, semis = 0, q = false, i, c;
    for (i = 0; i < src.length; i++) {
      c = src[i];
      if (c === '"') q = !q;
      else if (!q) {
        if (c === '\n') break;
        if (c === '\t') tabs++;
        else if (c === ',' || c === '，') commas++;
        else if (c === ';') semis++;
      }
    }
    if (tabs > 0 && tabs >= commas && tabs >= semis) return '\t';
    if (semis > commas) return ';';
    return ',';
  }

  function parseTable(text) {
    var src = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    if (!src.trim()) return { headers: [], rows: [], lines: [], delimiter: ',' };
    var delim = detectDelimiter(src);
    var records = [];
    var cell = '', row = [], inQ = false, quoteLine = 1, line = 1, startLine = 1, i, c;
    function endCell() { row.push(cell); cell = ''; }
    function endRow() {
      endCell();
      var blank = row.length === 1 && row[0].trim() === '';
      if (!blank) records.push({ cells: row, line: startLine });
      row = [];
    }
    for (i = 0; i < src.length; i++) {
      c = src[i];
      if (inQ) {
        if (c === '"') {
          if (src[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
        } else { if (c === '\n') line++; cell += c; }
      } else if (c === '"' && cell === '') {
        inQ = true; quoteLine = line;
      } else if (c === delim || (delim === ',' && c === '，')) {
        endCell();
      } else if (c === '\r') {
        if (src[i + 1] === '\n') i++;
        endRow(); line++; startLine = line;
      } else if (c === '\n') {
        endRow(); line++; startLine = line;
      } else {
        cell += c;
      }
    }
    if (inQ) return { headers: [], rows: [], lines: [], delimiter: delim, error: '第 ' + quoteLine + ' 行起有引号没有闭合,整份表格已拒绝。请补全引号后重试。' };
    if (cell !== '' || row.length) endRow();
    if (!records.length) return { headers: [], rows: [], lines: [], delimiter: delim };
    var headers = records[0].cells.map(function (h) { return h.trim(); });
    return {
      headers: headers,
      rows: records.slice(1).map(function (r) { return r.cells; }),
      lines: records.slice(1).map(function (r) { return r.line; }),
      delimiter: delim
    };
  }

  var GUESS = [
    ['safety', /安全库存|最低库存|库存预警|预警|safety|min[_ ]?stock/i],
    ['price', /单价|价格|成本|price|cost/i],
    ['open', /期初|月初|上期|开始|open|begin/i],
    ['in', /入库|进货|收货|^in$|inbound|receive/i],
    ['out', /出库|销售|发货|出货|^out$|outbound|sold/i],
    ['close', /期末|月末|结存|结余|余额|^库存$|库存数|close|ending|balance/i],
    ['unit', /单位|unit|uom/i],
    ['code', /编码|编号|货号|sku|代码|code|条码|barcode|^id$/i],
    ['name', /商品名|名称|品名|名字|name|^商品$|^产品$/i]
  ];
  function guessMapping(headers) {
    var m = {}, used = {};
    FIELDS.forEach(function (f) { m[f] = -1; });
    GUESS.forEach(function (g) {
      var f = g[0], re = g[1], i;
      for (i = 0; i < (headers || []).length; i++) {
        if (!used[i] && re.test(String(headers[i]))) { m[f] = i; used[i] = true; break; }
      }
    });
    return m;
  }

  /* ---------- 标准化 ---------- */
  /* 精确十进制:{n: BigInt, s: 小数位数}。零容差比较不经过浮点数 */
  function mkDec(sign, ip, fp) { return { n: BigInt((sign === '-' ? '-' : '') + ip + fp), s: fp.length }; }
  function align(a, b) {
    var sc = Math.max(a.s, b.s);
    return [a.n * (10n ** BigInt(sc - a.s)), b.n * (10n ** BigInt(sc - b.s)), sc];
  }
  function decAdd(a, b) { var x = align(a, b); return { n: x[0] + x[1], s: x[2] }; }
  function decSub(a, b) { var x = align(a, b); return { n: x[0] - x[1], s: x[2] }; }
  function decCmp(a, b) { var x = align(a, b); return x[0] < x[1] ? -1 : x[0] > x[1] ? 1 : 0; }
  function fmtD(d) {
    if (!d) return '';
    var neg = d.n < 0n;
    var abs = (neg ? -d.n : d.n).toString().padStart(d.s + 1, '0');
    var ip = abs.slice(0, abs.length - d.s);
    var fp = abs.slice(abs.length - d.s).replace(/0+$/, '');
    return (neg ? '-' : '') + ip + (fp ? '.' + fp : '');
  }

  function normalizeNumber(v) {
    var ZERO = { n: 0n, s: 0 };
    var s;
    if (typeof v === 'number') {
      if (!isFinite(v)) return { value: null, dec: null, empty: false, invalid: true };
      s = String(Number(v.toPrecision(15)));
      if (/e/i.test(s)) s = v.toFixed(15).replace(/0+$/, '').replace(/\.$/, '');
    } else if (v === null || v === undefined) {
      return { value: 0, dec: ZERO, empty: true, invalid: false };
    } else {
      s = String(v).normalize('NFKC').replace(/[−–—]/g, '-').replace(/\s+/g, '');
      s = s.replace(/^([+-]?)[¥$]/, '$1');
    }
    if (s === '' || s === '-') return { value: 0, dec: ZERO, empty: true, invalid: false };
    var m = /^([+-]?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/.exec(s);
    var m2 = /^([+-]?)\.(\d+)$/.exec(s);
    var d;
    if (m) d = mkDec(m[1], m[2].replace(/,/g, ''), m[3] || '');
    else if (m2) d = mkDec(m2[1], '0', m2[2]);
    else return { value: null, dec: null, empty: false, invalid: true };
    return { value: Number(fmtD(d)), dec: d, empty: false, invalid: false };
  }

  function parseUnitMap(text) {
    var map = new Map();
    if (text instanceof Map) return text;
    String(text == null ? '' : text).split(/\r?\n/).forEach(function (line) {
      var parts = line.split('=').map(function (p) { return p.normalize('NFKC').trim(); }).filter(Boolean);
      if (!parts.length) return;
      parts.forEach(function (p) { if (!map.has(key(p))) map.set(key(p), parts[0]); });
    });
    return map;
  }
  function normalizeUnit(u, map) {
    var s = String(u == null ? '' : u).normalize('NFKC').trim();
    if (!s) return '';
    var m = parseUnitMap(map);
    return m.has(key(s)) ? m.get(key(s)) : s;
  }

  /* ---------- 行结构 ---------- */
  function cellOf(r, mapping, f) {
    var idx = mapping ? mapping[f] : -1;
    if (typeof idx !== 'number' || idx < 0) return undefined;
    var v = r[idx];
    return v == null ? '' : String(v).trim();
  }
  /* 把解析表转成规范行:各字段为字符串,未映射的列为 undefined */
  function toRows(table, mapping) {
    var rows = (table && table.rows) || [];
    return rows.map(function (r, i) {
      var o = { line: table.lines && table.lines[i] ? table.lines[i] : i + 2 };
      FIELDS.forEach(function (f) { o[f] = cellOf(r, mapping, f); });
      return o;
    });
  }
  function canon(r, i, mapping, lines) {
    var o;
    if (Array.isArray(r)) {
      o = { line: lines && lines[i] ? lines[i] : i + 2 };
      FIELDS.forEach(function (f) { o[f] = cellOf(r, mapping, f); });
    } else {
      o = { line: r && r.line ? r.line : i + 2 };
      FIELDS.forEach(function (f) { o[f] = r && r[f] !== undefined && r[f] !== null ? String(r[f]).trim() : undefined; });
      if (r && r.edited) { o.edited = true; o.closeOrig = r.closeOrig; }
    }
    return o;
  }
  function strip(r) {
    var o = { line: r.line };
    FIELDS.forEach(function (f) { o[f] = r[f]; });
    if (r.edited) { o.edited = true; o.closeOrig = r.closeOrig; }
    return o;
  }
  function formulaOf(o) {
    if (o.open === undefined || o.in === undefined || o.out === undefined || o.close === undefined) return null;
    var a = normalizeNumber(o.open), b = normalizeNumber(o.in), c = normalizeNumber(o.out);
    if (a.invalid || b.invalid || c.invalid) return null;
    return decSub(decAdd(a.dec, b.dec), c.dec);
  }

  /* ---------- 检查 ---------- */
  function check(rows, mapping, options) {
    options = options || {};
    var unitMap = parseUnitMap(options.unitMap == null ? DEFAULT_UNIT_MAP_TEXT : options.unitMap);
    var list = Array.isArray(rows) ? rows : [];
    var issues = [];
    var out = list.map(function (r, i) {
      var o = canon(r, i, mapping, options.lines);
      o.index = i;
      o.num = {};
      o.d = {};
      NUM_FIELDS.forEach(function (f) {
        if (o[f] === undefined) { o.num[f] = undefined; o.d[f] = undefined; return; }
        var n = normalizeNumber(o[f]);
        o.num[f] = n.invalid ? null : n.value;
        o.d[f] = n.invalid ? null : n.dec;
        o['_empty_' + f] = n.empty;
        o['_invalid_' + f] = n.invalid;
      });
      o.unitNorm = o.unit === undefined ? '' : normalizeUnit(o.unit, unitMap);
      var F = formulaOf(o);
      if (F !== null && o.d.close === null) F = null;
      o.formulaD = F;
      o.formula = F === null ? null : Number(fmtD(F));
      o.formulaStr = F === null ? '' : fmtD(F);
      o.issues = [];
      return o;
    });

    function add(o, rule, message, field) {
      var it = { rule: rule, level: RULE_BY_ID[rule].level, label: RULE_BY_ID[rule].label, line: o.line, index: o.index, code: o.code === undefined ? '' : o.code, message: message };
      if (field) it.field = field;
      issues.push(it);
      o.issues.push(it);
    }

    var codeGroups = new Map(), nameGroups = new Map();
    out.forEach(function (o) {
      var ck = key(o.code);
      if (ck) { if (!codeGroups.has(ck)) codeGroups.set(ck, []); codeGroups.get(ck).push(o); }
      var nk = key(o.name);
      if (nk) { if (!nameGroups.has(nk)) nameGroups.set(nk, []); nameGroups.get(nk).push(o); }
    });

    out.forEach(function (o) {
      var n = o.num, d = o.d;
      function t(f) { return fmtD(d[f]); }
      if (key(o.code) === '') add(o, 'EMPTY_CODE', '商品编码为空,无法定位商品');
      NUM_FIELDS.forEach(function (f) {
        if (o['_invalid_' + f]) add(o, 'BAD_NUMBER', '「' + FIELD_LABELS[f] + '」值「' + o[f] + '」不是合法数字', f);
      });
      FLOW_FIELDS.forEach(function (f) {
        if (o['_empty_' + f]) add(o, 'EMPTY_AS_ZERO', '「' + FIELD_LABELS[f] + '」为空,已按 0 计算', f);
      });
      if (o.formulaD !== null && d.close != null && decCmp(o.formulaD, d.close) !== 0) {
        add(o, 'FORMULA', '期初 ' + t('open') + ' + 入库 ' + t('in') + ' − 出库 ' + t('out') + ' = ' + o.formulaStr + ',表中期末为 ' + t('close') + '(差 ' + fmtD(decSub(d.close, o.formulaD)) + ')', 'close');
      }
      if (d.close != null && d.close.n < 0n) add(o, 'NEGATIVE', '期末为负数 ' + t('close'), 'close');
      if (d.open != null && d.in != null && d.out != null && decCmp(d.out, decAdd(d.open, d.in)) > 0) {
        add(o, 'OUT_BEFORE_IN', '出库 ' + t('out') + ' 大于期初 + 入库 ' + fmtD(decAdd(d.open, d.in)) + ',可能先出后入或漏记入库', 'out');
      }
      if (d.close != null && d.close.n === 0n && d.in != null && d.in.n > 0n) {
        add(o, 'ZERO_WITH_IN', '期末为 0' + (o._empty_close ? '(空值按 0)' : '') + ',但本期入库 ' + t('in'), 'close');
      }
      if (d.safety != null && !o._empty_safety && d.close != null && decCmp(d.close, d.safety) < 0) {
        add(o, 'BELOW_SAFETY', '期末 ' + t('close') + ' 低于安全库存 ' + t('safety'), 'close');
      }
      if (o.price !== undefined && o._empty_price && n.out != null && n.out > 0) {
        add(o, 'NO_PRICE', '单价为空,但本期出库 ' + t('out'), 'price');
      }
    });

    codeGroups.forEach(function (g, ck) {
      if (g.length > 1) {
        g.forEach(function (o) {
          var others = g.filter(function (x) { return x !== o; }).map(function (x) { return '第 ' + x.line + ' 行'; }).join('、');
          add(o, 'DUP_CODE', '编码「' + o.code + '」重复,另见' + others);
        });
        var units = new Map();
        g.forEach(function (o) {
          if (o.unit !== undefined && o.unitNorm) { var uk = key(o.unitNorm); if (!units.has(uk)) units.set(uk, o.unitNorm); }
        });
        if (units.size > 1) {
          var names = Array.from(units.values()).join('、');
          g.forEach(function (o) { add(o, 'UNIT_MISMATCH', '同编码「' + o.code + '」出现多个单位:' + names, 'unit'); });
        }
      }
    });
    nameGroups.forEach(function (g) {
      var codes = new Map();
      g.forEach(function (o) { if (key(o.code)) codes.set(key(o.code), o.code); });
      if (codes.size > 1) {
        var cs = Array.from(codes.values()).join('、');
        g.forEach(function (o) { add(o, 'NAME_DUP', '名称「' + o.name + '」对应多个编码:' + cs, 'name'); });
      }
    });

    var order = {};
    RULES.forEach(function (r, i) { order[r.id] = i; });
    issues.sort(function (a, b) { return a.line - b.line || order[a.rule] - order[b.rule]; });
    out.forEach(function (o) {
      o.issues.sort(function (a, b) { return order[a.rule] - order[b.rule]; });
      o.level = o.issues.some(function (i) { return i.level === 'block'; }) ? 'block' : (o.issues.length ? 'warn' : '');
    });

    var byRule = Object.create(null);
    RULES.forEach(function (r) { byRule[r.id] = 0; });
    issues.forEach(function (i) { byRule[i.rule]++; });

    var units = new Map();
    var value = null;
    var hasPrice = out.some(function (o) { return o.price !== undefined; });
    if (hasPrice) value = { total: 0, rows: 0, skipped: 0 };
    out.forEach(function (o) {
      if (o.num.close != null) {
        var u = o.unitNorm || '(无单位)';
        if (!units.has(u)) units.set(u, { unit: u, close: 0, rows: 0 });
        var e = units.get(u);
        e.close = round6(e.close + o.num.close);
        e.rows++;
      }
      if (value) {
        if (o.num.close != null && o.num.price != null && !o._empty_price && o.num.close >= 0) {
          value.total = round6(value.total + o.num.close * o.num.price);
          value.rows++;
        } else value.skipped++;
      }
    });

    var stats = {
      rows: out.length,
      issues: issues.length,
      issueRows: out.filter(function (o) { return o.issues.length; }).length,
      blockRows: out.filter(function (o) { return o.level === 'block'; }).length,
      blocks: issues.filter(function (i) { return i.level === 'block'; }).length,
      warns: issues.filter(function (i) { return i.level === 'warn'; }).length,
      byRule: byRule,
      unitTotals: Array.from(units.values()).sort(function (a, b) { return a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0; }),
      value: value
    };
    return { issues: issues, stats: stats, rows: out };
  }

  /* 只改选中行:期末 := 期初+入库−出库;其余行原样返回 */
  function applyFormula(rows, indexes) {
    var sel = new Set(indexes || []);
    return (rows || []).map(function (r, i) {
      var o = strip(r);
      if (sel.has(i)) {
        var f = formulaOf(o);
        if (f !== null) {
          if (!o.edited) o.closeOrig = o.close;
          o.close = fmtD(f);
          o.edited = true;
        }
      }
      return o;
    });
  }

  /* ---------- 导出 ---------- */
  function guard(s) {
    s = String(s);
    if (/^[=+\-@\t\r]/.test(s) && s !== '-' && s !== '+') return "'" + s;
    return s;
  }
  function csvCell(v) {
    if (v === null || v === undefined) return '';
    var s = typeof v === 'number' ? String(v) : (typeof v === 'object' ? v.n : guard(v));
    return /[",\n\r]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(headers, rows) {
    var lines = [(headers || []).map(csvCell).join(',')];
    (rows || []).forEach(function (r) { lines.push(r.map(csvCell).join(',')); });
    return lines.join('\n') + '\n';
  }
  function issuesToCsv(issues, opts) {
    var sample = !!(opts && opts.sample);
    var head = ['行号', '级别', '规则', '商品编码', '说明'];
    if (sample) head.push('数据来源');
    return toCsv(head, (issues || []).map(function (i) {
      var row = [i.line, i.level === 'block' ? '阻断' : '警告', i.label, i.code, i.message];
      if (sample) row.push('合成示例');
      return row;
    }));
  }
  function mdCell(s) { return guard(String(s == null ? '' : s)).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' '); }
  function issuesToMarkdown(issues, stats, opts) {
    var o = opts || {};
    var L = ['# 库存异常清单', ''];
    if (o.sample) L.push('> 数据来源:合成示例,不是真实库存。', '');
    if (stats) {
      L.push('共 ' + stats.rows + ' 行,异常 ' + stats.issueRows + ' 行(阻断 ' + stats.blocks + ' 条,警告 ' + stats.warns + ' 条)。', '');
      if (stats.value) L.push('库存金额币种:' + currencyLabel(o.currency) + '(单价列须统一币种,工具不做币种换算)。', '');
    }
    L.push('| 行号 | 级别 | 规则 | 商品编码 | 说明 |', '| --- | --- | --- | --- | --- |');
    (issues || []).forEach(function (i) {
      L.push('| ' + i.line + ' | ' + (i.level === 'block' ? '阻断' : '警告') + ' | ' + mdCell(i.label) + ' | ' + mdCell(i.code) + ' | ' + mdCell(i.message) + ' |');
    });
    L.push('', '规则只核对表内数字,不替代实物盘点。', '');
    return L.join('\n');
  }
  /* ---------- 币种、用户数据范围、规则覆盖与结论 ---------- */
  function normalizeCurrency(v) {
    var s = String(v == null ? '' : v).trim();
    if (s.length > 12) return { ok: false, value: '', error: '币种标注最长 12 个字符。' };
    if (/[\u0000-\u001f\u007f]/.test(s)) return { ok: false, value: '', error: '币种标注不能含换行或控制字符。' };
    return { ok: true, value: s, error: null };
  }
  function currencyLabel(c) { return c ? String(c) : '原表统一货币单位(工具不识别币种)'; }

  /* 载入示例 / 导入文件 / 清空会替换什么。draftText 是输入框里还没解析的内容(与已解析文本相同则传空) */
  function replaceScope(st, draftText) {
    var s = st || {};
    var rows = s.table ? (s.rows || []) : [];
    var draft = String(draftText == null ? '' : draftText);
    var draftChars = draft.trim() ? draft.length : 0;
    var mappingChanged = false;
    if (s.table && s.mapping) {
      var g = guessMapping(s.table.headers);
      mappingChanged = FIELDS.some(function (f) { return g[f] !== s.mapping[f]; });
    }
    var unitMapChanged = typeof s.unitMapText === 'string' && s.unitMapText !== DEFAULT_UNIT_MAP_TEXT;
    var currency = s.currency ? String(s.currency) : '';
    var edited = rows.filter(function (r) { return r.edited; }).length;
    return {
      rows: rows.length, edited: edited, draftChars: draftChars, mappingChanged: mappingChanged, unitMapChanged: unitMapChanged, currency: currency,
      any: rows.length > 0 || draftChars > 0 || mappingChanged || unitMapChanged || !!currency
    };
  }
  function describeScope(sc) {
    var p = [];
    if (sc.rows) p.push(sc.rows + ' 行库存数据');
    if (sc.edited) p.push(sc.edited + ' 行已采用的公式期末');
    if (sc.draftChars) p.push('输入框里还没解析的内容(' + sc.draftChars + ' 个字符)');
    if (sc.mappingChanged) p.push('手动改过的列映射');
    if (sc.unitMapChanged) p.push('改过的单位同义表');
    if (sc.currency) p.push('币种标注「' + sc.currency + '」');
    return p.join('、');
  }

  var RULE_NEEDS = {
    EMPTY_CODE: ['code'], BAD_NUMBER: { anyOf: NUM_FIELDS }, FORMULA: ['open', 'in', 'out', 'close'], NEGATIVE: ['close'],
    DUP_CODE: ['code'], UNIT_MISMATCH: ['unit'], BELOW_SAFETY: ['close', 'safety'], ZERO_WITH_IN: ['close', 'in'],
    OUT_BEFORE_IN: ['open', 'in', 'out'], NAME_DUP: ['name'], NO_PRICE: ['price', 'out'], EMPTY_AS_ZERO: { anyOf: FLOW_FIELDS }
  };
  function mapped(mapping, f) { return !!mapping && typeof mapping[f] === 'number' && mapping[f] >= 0; }
  /* 因缺列而没有运行的规则 */
  function ruleCoverage(mapping) {
    var skipped = [];
    RULES.forEach(function (r) {
      var need = RULE_NEEDS[r.id];
      var missing;
      if (Array.isArray(need)) missing = need.filter(function (f) { return !mapped(mapping, f); });
      else missing = need.anyOf.some(function (f) { return mapped(mapping, f); }) ? [] : need.anyOf.slice(0, 1);
      if (missing.length) skipped.push({ id: r.id, label: r.label, missing: missing.map(function (f) { return FIELD_LABELS[f]; }) });
    });
    return { skipped: skipped };
  }
  /* 「没有发现问题」只在检查完整完成时出现 */
  function checkVerdict(result, mapping, parseError) {
    if (parseError) return { state: 'incomplete', text: '检查未完成:1 处错误。' + parseError };
    if (!result) return { state: 'incomplete', text: '检查未完成:还没有可检查的数据。' };
    var st = result.stats;
    var cov = ruleCoverage(mapping).skipped;
    var covText = cov.length ? ' 另有 ' + cov.length + ' 条规则因缺少列没有运行:' + cov.map(function (c) { return c.label + '(缺' + c.missing.join('、') + ')'; }).join(';') + '。' : '';
    if (st.rows === 0) return { state: 'empty', text: '表里没有数据行,没有可检查的内容。' };
    if (st.issues > 0) return { state: 'issues', text: '共检查 ' + st.rows + ' 行,发现 ' + st.issues + ' 条异常(涉及 ' + st.issueRows + ' 行)。' + covText };
    if (cov.length) return { state: 'incomplete', text: '检查未完成:已运行的规则未命中任何异常,但' + cov.length + ' 条规则因缺少列没有运行:' + cov.map(function (c) { return c.label + '(缺' + c.missing.join('、') + ')'; }).join(';') + '。' };
    return { state: 'clean', text: '共检查 ' + st.rows + ' 行,已运行全部 ' + RULES.length + ' 条规则,没有发现问题。' };
  }

  /* 修正后库存表:只含已映射的列;数字列输出为规范数字 */
  function correctedTable(rows, opts) {
    var sample = !!(opts && opts.sample);
    var list = rows || [];
    var fields = FIELDS.filter(function (f) { return list.some(function (r) { return r[f] !== undefined; }); });
    var edited = list.some(function (r) { return r.edited; });
    var headers = fields.map(function (f) { return FIELD_LABELS[f]; });
    if (edited) headers.push('修正说明');
    if (sample) headers.push('数据来源');
    var body = list.map(function (r) {
      var cells = fields.map(function (f) {
        var v = r[f];
        if (v === undefined) return '';
        if (NUM_FIELDS.indexOf(f) >= 0) {
          var n = normalizeNumber(v);
          return n.empty ? '' : (n.invalid ? v : { n: fmtD(n.dec) });
        }
        return v;
      });
      if (edited) cells.push(r.edited ? '期末由 ' + (r.closeOrig === '' ? '空' : r.closeOrig) + ' 改为按公式 ' + r.close : '');
      if (sample) cells.push('合成示例');
      return cells;
    });
    return { headers: headers, rows: body };
  }

  /* 选文件后、解析前的检查:空文件、无法按 UTF-8 解码的文件(出现替换字符 U+FFFD)直接拒绝,不进入「替换现有数据」确认 */
  function checkTextFile(text) {
    var s = String(text == null ? '' : text);
    if (s.trim() === '') return { ok: false, code: 'empty', message: '文件是空的,没有读到内容。' };
    if (s.indexOf('\uFFFD') !== -1) return { ok: false, code: 'encoding', message: '文件含无法识别的字符,可能不是 UTF-8 编码。请在表格软件里另存为「CSV UTF-8」或「TSV」后再试。' };
    return { ok: true, code: '', message: '' };
  }

  var api = {
    checkTextFile: checkTextFile,
    FIELDS: FIELDS, FIELD_LABELS: FIELD_LABELS, RULES: RULES, DEFAULT_UNIT_MAP_TEXT: DEFAULT_UNIT_MAP_TEXT,
    parseTable: parseTable, guessMapping: guessMapping, normalizeNumber: normalizeNumber, normalizeUnit: normalizeUnit,
    parseUnitMap: parseUnitMap, fmtD: fmtD, toRows: toRows, check: check, applyFormula: applyFormula, fmt: fmt,
    normalizeCurrency: normalizeCurrency, currencyLabel: currencyLabel, replaceScope: replaceScope, describeScope: describeScope,
    ruleCoverage: ruleCoverage, checkVerdict: checkVerdict,
    toCsv: toCsv, issuesToCsv: issuesToCsv, issuesToMarkdown: issuesToMarkdown, correctedTable: correctedTable
  };
  globalThis.InventoryCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
