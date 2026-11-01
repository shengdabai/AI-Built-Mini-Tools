/* 发票与订单差异核对 · 纯逻辑(无 DOM)。浏览器与 Node 共用。 */
(function () {
  'use strict';

  var DEFAULTS = { tolAbs: 0.01, tolPct: 0.5, taxRate: 13, matchByName: false };
  var LEVEL_LABEL = { block: '阻断', warn: '警告', ok: '正常' };

  function str(x) { return x == null ? '' : String(x).trim(); }
  function r6(x) { return Math.round(x * 1e6) / 1e6; }
  function r2(x) { return Math.round((x + Number.EPSILON) * 100) / 100; }
  function fmt(n) { return r2(n).toFixed(2); }
  function isIdx(i) { return typeof i === 'number' && Number.isInteger(i) && i >= 0; }

  /* ---------- 表格解析(RFC 4180) ---------- */
  function detectDelimiter(text) {
    var counts = { '\t': 0, ',': 0, ';': 0 };
    var inQ = false, atStart = true;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQ) {
        if (ch === '"') { if (text[i + 1] === '"') i++; else inQ = false; }
        continue;
      }
      if (ch === '"' && atStart) { inQ = true; atStart = false; continue; }
      if (ch === '\n' || ch === '\r') { if (/\S/.test(text.slice(0, i))) break; atStart = true; continue; }
      if (ch === '\t' || ch === ',' || ch === ';') { counts[ch]++; atStart = true; continue; }
      atStart = false;
    }
    if (counts['\t'] > 0) return '\t';
    if (counts[';'] > counts[',']) return ';';
    return ',';
  }

  function parseRecords(text, delim) {
    var records = [], rec = [], field = '', inQ = false, atStart = true, unclosed = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else { inQ = false; }
        } else field += ch;
        continue;
      }
      if (ch === '"' && atStart) { inQ = true; atStart = false; continue; }
      if (ch === delim) { rec.push(field); field = ''; atStart = true; continue; }
      if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        rec.push(field); records.push(rec); rec = []; field = ''; atStart = true;
        continue;
      }
      field += ch; atStart = false;
    }
    if (inQ) unclosed = true;
    if (field !== '' || rec.length > 0) { rec.push(field); records.push(rec); }
    return { records: records, unclosed: unclosed };
  }

  /* 返回 {delimiter, headers, rows:[{row, cells}], error}。row 是表格行号(表头为第 1 行)。 */
  function parseTable(text) {
    var s = text == null ? '' : String(text);
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    var out = { delimiter: ',', headers: [], rows: [], error: '' };
    if (!/\S/.test(s)) return out;
    out.delimiter = detectDelimiter(s);
    var p = parseRecords(s, out.delimiter);
    if (p.unclosed) out.error = '引号没有闭合,最后一个字段可能被吞并';
    var headerFound = false;
    var badCols = [];
    p.records.forEach(function (rec, idx) {
      var blank = rec.every(function (c) { return !/\S/.test(c); });
      if (blank) return;
      var cells = rec.map(function (c) { return c.trim(); });
      if (!headerFound) { out.headers = cells; headerFound = true; return; }
      out.rows.push({ row: idx + 1, cells: cells });
      if (cells.length !== out.headers.length) badCols.push('第 ' + (idx + 1) + ' 行有 ' + cells.length + ' 列');
    });
    if (badCols.length) {
      var shown = badCols.slice(0, 5).join('、') + (badCols.length > 5 ? ' 等 ' + badCols.length + ' 行' : '');
      var msg = '列数与表头(' + out.headers.length + ' 列)不一致:' + shown + '(带逗号的金额请用引号包起来)';
      out.error = out.error ? out.error + ';' + msg : msg;
    }
    return out;
  }

  /* ---------- 数字 ---------- */
  function normalizeNumber(input) {
    if (typeof input === 'number') return Number.isFinite(input) ? input : null;
    var s = str(input);
    if (!s) return null;
    s = s.replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[，]/g, ',').replace(/[．。]/g, '.').replace(/[－−–]/g, '-').replace(/[＋]/g, '+')
      .replace(/[¥￥]/g, '').replace(/元$/, '').replace(/\s+/g, '');
    var neg = false;
    var m = /^\((.*)\)$/.exec(s);
    if (m) { neg = true; s = m[1]; }
    var sign = 1;
    if (s[0] === '-') { sign = -1; s = s.slice(1); } else if (s[0] === '+') { s = s.slice(1); }
    if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$|^\.\d+$/.test(s)) return null;
    var v = Number(s.replace(/,/g, ''));
    if (!Number.isFinite(v)) return null;
    v = v * sign;
    return neg ? -Math.abs(v) : v;
  }

  /* ---------- 列映射猜测 ---------- */
  var TAX_RE = /(税额|税金|tax)/i;
  var TAX_EXCLUDE = /(不含税|未税|含税|价税)/;
  function isTax(h) { return TAX_RE.test(h) && !TAX_EXCLUDE.test(h); }
  var ROLE_TESTS = {
    invoiceNo: function (h) { return /(发票.*(号|编号|号码|代码))|invoice/i.test(h); },
    orderNo: function (h) { return /(订单|采购单|\bPO\b|order)/i.test(h) && !/(金额|数量|单价|品名|日期|名称)/.test(h); },
    name: function (h) { return /(品名|名称|商品|产品|货物|项目|item|name|description)/i.test(h) && !/(订单|发票|单位)/.test(h); },
    qty: function (h) { return /(数量|qty|quantity)/i.test(h); },
    price: function (h) { return /(单价|price)/i.test(h); },
    tax: isTax,
    amount: function (h) { return /(金额|合计|总价|amount|total)/i.test(h) && !isTax(h); }
  };

  /* 返回列下标;未命中返回 -1。role: orderNo / invoiceNo / name / qty / price / tax / amount */
  function guessMapping(headers, role) {
    var test = Object.prototype.hasOwnProperty.call(ROLE_TESTS, role) ? ROLE_TESTS[role] : null;
    if (!test || !Array.isArray(headers)) return -1;
    for (var i = 0; i < headers.length; i++) if (test(str(headers[i]))) return i;
    return -1;
  }

  /* ---------- 对账 ---------- */
  function mergeOptions(o) {
    var x = o || {};
    var tolAbs = typeof x.tolAbs === 'number' && Number.isFinite(x.tolAbs) && x.tolAbs >= 0 ? x.tolAbs : DEFAULTS.tolAbs;
    var tolPct = typeof x.tolPct === 'number' && Number.isFinite(x.tolPct) && x.tolPct >= 0 ? x.tolPct : DEFAULTS.tolPct;
    var taxRate;
    if (x.taxRate === undefined) taxRate = DEFAULTS.taxRate;
    else if (typeof x.taxRate === 'number' && Number.isFinite(x.taxRate) && x.taxRate >= 0) taxRate = x.taxRate;
    else taxRate = null;
    return { tolAbs: tolAbs, tolPct: tolPct, taxRate: taxRate, matchByName: !!x.matchByName };
  }

  function within(a, b, o) {
    var d = r6(Math.abs(a - b));
    if (d <= r6(o.tolAbs)) return true;
    return d <= r6(Math.abs(b) * o.tolPct / 100);
  }

  function keyOf(s) { return str(s).normalize('NFKC').replace(/\s+/g, '').toUpperCase(); }
  function nameKey(s) { return str(s).normalize('NFKC').replace(/\s+/g, '').toLowerCase(); }

  function emptySummary() {
    return { orderCount: 0, invoiceCount: 0, paired: 0, blockCount: 0, warnCount: 0, orderTotal: 0, invoiceTotal: 0, diff: 0 };
  }

  function cellAt(row, idx) { return isIdx(idx) && row.cells[idx] != null ? str(row.cells[idx]) : ''; }
  function numField(row, idx) {
    var raw = cellAt(row, idx);
    if (!raw) return { present: false, ok: false, value: null, raw: '' };
    var v = normalizeNumber(raw);
    return { present: true, ok: v !== null, value: v, raw: raw };
  }

  function rowsText(side, rows) {
    return rows.length ? side + '表第 ' + rows.join('、') + ' 行' : '';
  }

  function reconcile(orderTable, invoiceTable, mapping, options) {
    var o = mergeOptions(options);
    var ot = orderTable || { rows: [] }, it = invoiceTable || { rows: [] };
    var mo = (mapping && mapping.orders) || {}, mi = (mapping && mapping.invoices) || {};
    var missing = [];
    var emptyRes = { pairs: [], unmatchedOrders: [], unmatchedInvoices: [], issues: [], summary: emptySummary(), options: o, error: '' };
    if (ot.error || it.error) {
      emptyRes.error = '输入表有解析错误,已拒绝核对:' + [ot.error ? '订单表' + ot.error : '', it.error ? '发票表' + it.error : ''].filter(Boolean).join(';');
      return emptyRes;
    }
    if (!isIdx(mo.orderNo)) missing.push('订单表的「订单号」');
    if (!isIdx(mo.amount)) missing.push('订单表的「金额」');
    if (!isIdx(mi.invoiceNo)) missing.push('发票表的「发票号」');
    if (!isIdx(mi.orderNo)) missing.push('发票表的「订单号」');
    if (!isIdx(mi.amount)) missing.push('发票表的「金额」');
    var result = { pairs: [], unmatchedOrders: [], unmatchedInvoices: [], issues: [], summary: emptySummary(), options: o, error: '' };
    if (missing.length) { result.error = '请先选择必选列:' + missing.join('、'); return result; }

    var issues = result.issues;
    var seq = 0;
    function addIssue(level, code, title, detail, ctx) {
      seq += 1;
      var c = ctx || {};
      var orderRows = c.orderRows || [], invoiceRows = c.invoiceRows || [];
      var loc = [rowsText('订单', orderRows), rowsText('发票', invoiceRows)].filter(Boolean).join(';');
      var issue = {
        id: seq, level: level, code: code, title: title, detail: detail,
        orderNo: c.orderNo || '', invoiceNo: c.invoiceNo || '',
        orderRows: orderRows, invoiceRows: invoiceRows, location: loc || '汇总'
      };
      issues.push(issue);
      return issue;
    }

    /* 抽取行 */
    var orders = [], invoices = [];
    ot.rows.forEach(function (r) {
      var line = {
        row: r.row, orderNo: cellAt(r, mo.orderNo), name: cellAt(r, mo.name),
        qty: numField(r, mo.qty), price: numField(r, mo.price), amount: numField(r, mo.amount)
      };
      if (!line.orderNo) {
        addIssue('warn', 'blankOrderNo', '订单号为空', '订单表第 ' + r.row + ' 行没有订单号,无法配对;金额仍计入订单合计。', { orderRows: [r.row] });
      }
      orders.push(line);
    });
    it.rows.forEach(function (r) {
      invoices.push({
        row: r.row, invoiceNo: cellAt(r, mi.invoiceNo), orderNo: cellAt(r, mi.orderNo), name: cellAt(r, mi.name),
        qty: numField(r, mi.qty), price: numField(r, mi.price), tax: numField(r, mi.tax), amount: numField(r, mi.amount)
      });
    });

    /* 分组(Map,避免 __proto__ 等键) */
    var orderGroups = new Map(), invGroups = new Map();
    orders.forEach(function (l) {
      var k = keyOf(l.orderNo);
      if (!k) return;
      if (!orderGroups.has(k)) orderGroups.set(k, []);
      orderGroups.get(k).push(l);
    });
    var invNoOrder = [];
    invoices.forEach(function (l) {
      var k = keyOf(l.orderNo);
      if (!k) { invNoOrder.push(l); return; }
      if (!invGroups.has(k)) invGroups.set(k, []);
      invGroups.get(k).push(l);
    });

    var pairByInvoiceRow = new Map();
    var pairs = result.pairs;
    var matchedOrderRows = new Set();

    function newPair(ol, il) {
      var p = {
        orderRow: ol.row, invoiceRow: il.row, orderNo: ol.orderNo, invoiceNo: il.invoiceNo,
        name: il.name || ol.name, orderName: ol.name, invoiceName: il.name,
        orderAmount: ol.amount.value, invoiceAmount: il.amount.value,
        diff: ol.amount.ok && il.amount.ok ? r2(il.amount.value - ol.amount.value) : null,
        status: 'ok', issueIds: [], notes: []
      };
      pairs.push(p);
      pairByInvoiceRow.set(il.row, p);
      matchedOrderRows.add(ol.row);
      return p;
    }
    function attach(p, issue) {
      if (!p) return;
      p.issueIds.push(issue.id);
      p.notes.push(issue.title);
      if (issue.level === 'block') p.status = 'block';
      else if (p.status !== 'block') p.status = 'warn';
    }

    function ctxOf(ol, il) {
      return { orderNo: il.orderNo || ol.orderNo, invoiceNo: il.invoiceNo, orderRows: [ol.row], invoiceRows: [il.row] };
    }

    function checkPair(ol, il) {
      var p = newPair(ol, il);
      var ctx = ctxOf(ol, il);
      if (!ol.amount.ok || !il.amount.ok) {
        attach(p, addIssue('block', 'badAmount', '金额无法识别',
          '订单金额「' + ol.amount.raw + '」或发票金额「' + il.amount.raw + '」不是有效数字,无法比较。', ctx));
      } else if (!within(il.amount.value, ol.amount.value, o)) {
        attach(p, addIssue('block', 'amountDiff', '金额差超容差',
          '订单 ' + fmt(ol.amount.value) + ',发票 ' + fmt(il.amount.value) + ',差 ' + fmt(il.amount.value - ol.amount.value) + '。', ctx));
      }
      if (ol.qty.present && il.qty.present) {
        if (!ol.qty.ok || !il.qty.ok) {
          attach(p, addIssue('warn', 'badNumber', '数量无法识别', '订单数量「' + ol.qty.raw + '」或发票数量「' + il.qty.raw + '」不是有效数字,未比较。', ctx));
        } else if (r6(ol.qty.value) !== r6(il.qty.value)) {
          attach(p, addIssue('block', 'qtyDiff', '数量不一致', '订单数量 ' + ol.qty.value + ',发票数量 ' + il.qty.value + '。', ctx));
        }
      }
      if (ol.price.present && il.price.present) {
        if (!ol.price.ok || !il.price.ok) {
          attach(p, addIssue('warn', 'badNumber', '单价无法识别', '订单单价「' + ol.price.raw + '」或发票单价「' + il.price.raw + '」不是有效数字,未比较。', ctx));
        } else if (r6(il.price.value) !== r6(ol.price.value)) {
          attach(p, addIssue('block', 'priceDiff', '单价不一致', '订单单价 ' + fmt(ol.price.value) + ',发票单价 ' + fmt(il.price.value) + '。', ctx));
        }
      }
      if (ol.name && il.name && nameKey(ol.name) !== nameKey(il.name)) {
        attach(p, addIssue('warn', 'nameDiff', '品名不一致', '订单品名「' + ol.name + '」,发票品名「' + il.name + '」。', ctx));
      }
    }

    function matchGroup(ols, ils) {
      var usedO = new Set(), usedI = new Set();
      ils.forEach(function (il) {
        var nk = nameKey(il.name);
        if (!nk) return;
        for (var j = 0; j < ols.length; j++) {
          if (!usedO.has(j) && nameKey(ols[j].name) === nk) {
            usedO.add(j); usedI.add(il.row); checkPair(ols[j], il); return;
          }
        }
      });
      if (!o.matchByName) {
        ils.forEach(function (il) {
          if (usedI.has(il.row)) return;
          for (var j = 0; j < ols.length; j++) {
            if (!usedO.has(j)) { usedO.add(j); usedI.add(il.row); checkPair(ols[j], il); return; }
          }
        });
      }
      var leftInv = ils.filter(function (il) { return !usedI.has(il.row); });
      if (leftInv.length) {
        leftInv.forEach(function (il) {
          result.unmatchedInvoices.push(il);
          var detail = o.matchByName
            ? '订单号 ' + il.orderNo + ' 下没有品名为「' + il.name + '」的订单行。'
            : '订单号 ' + il.orderNo + ' 下发票行(' + ils.length + ')多于订单行(' + ols.length + '),这一行没有订单可对。';
          addIssue('block', o.matchByName ? 'noOrderLine' : 'extraInvoice',
            o.matchByName ? '订单号下无同名订单行' : '发票行多于订单行', detail,
            { orderNo: il.orderNo, invoiceNo: il.invoiceNo, invoiceRows: [il.row] });
        });
      }
    }

    invGroups.forEach(function (ils, k) {
      var ols = orderGroups.get(k);
      if (!ols) {
        ils.forEach(function (il) {
          result.unmatchedInvoices.push(il);
          addIssue('block', 'noOrder', '订单表中不存在该订单号',
            '发票 ' + (il.invoiceNo || '(无发票号)') + ' 引用的订单号 ' + il.orderNo + ' 不在订单表里。',
            { orderNo: il.orderNo, invoiceNo: il.invoiceNo, invoiceRows: [il.row] });
        });
        return;
      }
      matchGroup(ols, ils);
    });
    invNoOrder.forEach(function (il) {
      result.unmatchedInvoices.push(il);
      addIssue('block', 'noOrder', '发票没有订单号', '发票 ' + (il.invoiceNo || '(无发票号)') + ' 没有填订单号,无法配对。',
        { invoiceNo: il.invoiceNo, invoiceRows: [il.row] });
    });

    /* 订单无发票 */
    orders.forEach(function (ol) {
      if (matchedOrderRows.has(ol.row)) return;
      result.unmatchedOrders.push(ol);
      if (!ol.orderNo) return;
      addIssue('warn', 'noInvoice', '订单无对应发票',
        '订单 ' + ol.orderNo + (ol.name ? '(' + ol.name + ')' : '') + ' 没有找到可配对的发票行。',
        { orderNo: ol.orderNo, orderRows: [ol.row] });
    });

    /* 重复发票号 */
    var byInvNo = new Map();
    invoices.forEach(function (il) {
      var k = keyOf(il.invoiceNo);
      if (!k) return;
      if (!byInvNo.has(k)) byInvNo.set(k, []);
      byInvNo.get(k).push(il);
    });
    byInvNo.forEach(function (ls) {
      if (ls.length < 2) return;
      var orderNos = [];
      ls.forEach(function (l) { if (orderNos.indexOf(l.orderNo) < 0) orderNos.push(l.orderNo); });
      var issue = addIssue('block', 'dupInvoice', '发票号重复',
        '发票号 ' + ls[0].invoiceNo + ' 出现 ' + ls.length + ' 次(涉及订单 ' + orderNos.join('、') + ')。',
        { orderNo: orderNos.join('、'), invoiceNo: ls[0].invoiceNo, invoiceRows: ls.map(function (l) { return l.row; }) });
      ls.forEach(function (l) { attach(pairByInvoiceRow.get(l.row), issue); });
    });

    /* 税额检查(逐张发票行,与是否配对无关) */
    if (o.taxRate !== null) {
      invoices.forEach(function (il) {
        if (!isIdx(mi.tax) || !il.tax.present) return;
        var ctx = { orderNo: il.orderNo, invoiceNo: il.invoiceNo, invoiceRows: [il.row] };
        if (!il.tax.ok || !il.amount.ok) {
          attach(pairByInvoiceRow.get(il.row), addIssue('warn', 'badNumber', '税额无法检查', '税额「' + il.tax.raw + '」或金额「' + il.amount.raw + '」不是有效数字。', ctx));
          return;
        }
        var expected = il.amount.value * o.taxRate / 100;
        if (!within(il.tax.value, expected, o)) {
          attach(pairByInvoiceRow.get(il.row), addIssue('warn', 'taxDiff', '税额偏差超容差',
            '税额 ' + fmt(il.tax.value) + ',按税率 ' + o.taxRate + '% 应为 ' + fmt(expected) + ',差 ' + fmt(il.tax.value - expected) + '。', ctx));
        }
      });
    }

    /* 汇总 */
    var s = result.summary;
    s.orderCount = orders.length;
    s.invoiceCount = invoices.length;
    s.paired = pairs.length;
    orders.forEach(function (l) { if (l.amount.ok) s.orderTotal += l.amount.value; });
    invoices.forEach(function (l) { if (l.amount.ok) s.invoiceTotal += l.amount.value; });
    s.orderTotal = r2(s.orderTotal);
    s.invoiceTotal = r2(s.invoiceTotal);
    s.diff = r2(s.invoiceTotal - s.orderTotal);
    if ((orders.length || invoices.length) && s.diff !== 0) {
      addIssue('warn', 'totalDiff', '发票与订单金额合计不等',
        '订单合计 ' + fmt(s.orderTotal) + ',发票合计 ' + fmt(s.invoiceTotal) + ',差额 ' + fmt(s.diff) + '。', {});
    }

    var order = { block: 0, warn: 1 };
    function firstRow(i) { return i.invoiceRows.length ? i.invoiceRows[0] : (i.orderRows.length ? i.orderRows[0] : Infinity); }
    issues.sort(function (a, b) {
      if (order[a.level] !== order[b.level]) return order[a.level] - order[b.level];
      var fa = firstRow(a), fb = firstRow(b);
      if (fa !== fb) return fa - fb;
      return a.id - b.id;
    });
    s.blockCount = issues.filter(function (i) { return i.level === 'block'; }).length;
    s.warnCount = issues.filter(function (i) { return i.level === 'warn'; }).length;
    pairs.sort(function (a, b) { return a.orderRow - b.orderRow || a.invoiceRow - b.invoiceRow; });
    return result;
  }

  /* ---------- 导出 ---------- */
  /* 以 = + - @ 开头的字符串加单引号前缀;单独的 - 或 + 不算 */
  function guardFormula(v) {
    if (typeof v !== 'string') return v;
    if (v === '-' || v === '+') return v;
    return /^[=+\-@]/.test(v) ? "'" + v : v;
  }
  function csvCell(v) {
    var s = v == null ? '' : typeof v === 'number' ? String(v) : guardFormula(String(v));
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(rows) {
    return (rows || []).map(function (r) { return r.map(csvCell).join(','); }).join('\n') + '\n';
  }

  function paramCells(result) {
    var o = (result && result.options) || mergeOptions();
    return [o.tolAbs, o.tolPct, o.taxRate === null ? '不检查' : o.taxRate, o.matchByName ? '订单号 + 品名' : '订单号'];
  }
  var PARAM_HEAD = ['金额容差(元)', '百分比容差(%)', '税率期望值(%)', '匹配模式'];

  /* meta.sample 为真时每行追加「数据来源:合成示例」,导出文件脱离界面后仍能看出是演示数据 */
  function reviewRows(result, meta) {
    var sample = !!(meta && meta.sample);
    var head = ['级别', '类别', '订单号', '发票号', '订单表行号', '发票表行号', '说明'].concat(PARAM_HEAD);
    if (sample) head.push('数据来源');
    var rows = [head];
    var pc = paramCells(result);
    (result.issues || []).forEach(function (i) {
      var row = [LEVEL_LABEL[i.level], i.title, i.orderNo, i.invoiceNo, i.orderRows.join('、'), i.invoiceRows.join('、'), i.detail].concat(pc);
      if (sample) row.push('合成示例');
      rows.push(row);
    });
    return rows;
  }

  function pairRows(result) {
    var rows = [['状态', '订单号', '发票号', '品名', '订单表行号', '发票表行号', '订单金额', '发票金额', '差额', '提示']];
    (result.pairs || []).forEach(function (p) {
      rows.push([LEVEL_LABEL[p.status], p.orderNo, p.invoiceNo, p.name, p.orderRow, p.invoiceRow,
        p.orderAmount == null ? '' : p.orderAmount, p.invoiceAmount == null ? '' : p.invoiceAmount,
        p.diff == null ? '' : p.diff, p.notes.join(';')]);
    });
    (result.unmatchedOrders || []).forEach(function (l) {
      rows.push(['警告', l.orderNo, '', l.name, l.row, '', l.amount.ok ? l.amount.value : '', '', '', '订单无对应发票']);
    });
    (result.unmatchedInvoices || []).forEach(function (l) {
      rows.push(['阻断', l.orderNo, l.invoiceNo, l.name, '', l.row, '', l.amount.ok ? l.amount.value : '', '', '发票未能配对订单']);
    });
    return rows;
  }

  function mdCell(v) {
    return guardFormula(v == null ? '' : String(v)).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
  }
  function mdTable(head, rows) {
    var lines = ['| ' + head.join(' | ') + ' |', '| ' + head.map(function () { return '---'; }).join(' | ') + ' |'];
    rows.forEach(function (r) { lines.push('| ' + r.map(mdCell).join(' | ') + ' |'); });
    return lines.join('\n');
  }

  /* 待复核清单 Markdown(含参数)。只列阻断与警告,不含一致配对。 */
  function toMarkdown(result, options, meta) {
    var o = (result && result.options) || mergeOptions(options);
    var s = (result && result.summary) || emptySummary();
    var out = [];
    out.push('# 发票与订单差异核对 · 待复核清单', '');
    out.push('本清单只供人工复核,不触发付款,也不用于申报。', '');
    if (meta && meta.sample) out.push('数据来源:合成示例(虚构数据,仅用于演示)。', '');
    out.push('## 核对参数', '');
    out.push('- 金额容差(绝对值):' + o.tolAbs);
    out.push('- 百分比容差:' + o.tolPct + '%(与绝对值容差满足其一即视为一致)');
    out.push('- 税率期望值:' + (o.taxRate === null ? '未设置,不检查税额' : o.taxRate + '%'));
    out.push('- 匹配方式:' + (o.matchByName ? '订单号 + 品名' : '订单号(同订单多行时先按品名,再按顺序)'), '');
    out.push('## 汇总', '');
    out.push(mdTable(['项目', '数值'], [
      ['订单行数', s.orderCount], ['发票行数', s.invoiceCount], ['已配对行数', s.paired],
      ['阻断数', s.blockCount], ['警告数', s.warnCount],
      ['订单金额合计(元)', fmt(s.orderTotal)], ['发票金额合计(元)', fmt(s.invoiceTotal)], ['差额(发票 - 订单,元)', fmt(s.diff)]
    ]), '');
    ['block', 'warn'].forEach(function (lv) {
      var list = (result.issues || []).filter(function (i) { return i.level === lv; });
      out.push('## ' + LEVEL_LABEL[lv] + '(' + list.length + ')', '');
      if (!list.length) { out.push('无。', ''); return; }
      out.push(mdTable(['类别', '订单号', '发票号', '位置', '说明'],
        list.map(function (i) { return [i.title, i.orderNo, i.invoiceNo, i.location, i.detail]; })), '');
    });
    return out.join('\n');
  }

  var api = {
    DEFAULTS: DEFAULTS, parseTable: parseTable, normalizeNumber: normalizeNumber, guessMapping: guessMapping,
    reconcile: reconcile, toCsv: toCsv, toMarkdown: toMarkdown, reviewRows: reviewRows, pairRows: pairRows,
    guardFormula: guardFormula, fmt: fmt
  };
  globalThis.InvoiceCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
