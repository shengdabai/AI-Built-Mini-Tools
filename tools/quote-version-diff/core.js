'use strict';
/* 报价版本差异说明 · 纯逻辑(无 DOM)。 */
(function () {
  var FIELD_LABEL = { name: '名称', qty: '数量', unit: '单位', price: '单价' };
  var MAPPING_KEYS = ['code', 'name', 'qty', 'unit', 'price', 'note'];
  var HEADER_HINTS = {
    code: ['项目编码', '编码', '编号', '项目编号', '代码', 'code', 'sku', 'item', 'id'],
    name: ['项目名称', '名称', '项目', '品名', '内容', 'name', 'description', 'desc'],
    qty: ['数量', '工程量', '数目', 'qty', 'quantity', 'count'],
    unit: ['单位', 'unit', 'uom'],
    price: ['单价', '价格', '综合单价', 'price', 'unit price', 'rate'],
    note: ['备注', '说明', '附注', 'note', 'notes', 'remark', 'remarks']
  };

  function roundCents(x) {
    var s = x < 0 ? -1 : 1;
    return s * Math.round((Math.abs(x) + Number.EPSILON) * 100) / 100;
  }

  /* ---- 解析 ---- */
  function detectDelimiter(text) {
    var firstLine = '', inQ = false, i, c;
    for (i = 0; i < text.length; i++) {
      c = text[i];
      if (c === '"') inQ = !inQ;
      if ((c === '\n' || c === '\r') && !inQ) break;
      firstLine += c;
    }
    var tabs = (firstLine.match(/\t/g) || []).length;
    var commas = (firstLine.match(/,/g) || []).length;
    return tabs > 0 && tabs >= commas ? '\t' : ',';
  }

  /* 返回 {headers, rows, lines, delimiter};lines[i] 是 rows[i] 起始的物理行号(从 1 计,表头为 1)。 */
  function parseTable(text) {
    text = String(text == null ? '' : text).replace(/^﻿/, '');
    var out = { headers: [], rows: [], lines: [], delimiter: ',', unclosedQuote: false, unclosedQuoteLine: 0 };
    if (!text.trim()) return out;
    var d = detectDelimiter(text);
    out.delimiter = d;
    var records = [], starts = [];
    var cur = [], field = '', inQ = false, line = 1, startLine = 1, quoteLine = 0, i = 0, c;
    function endField() { cur.push(field); field = ''; }
    function endRecord() {
      endField();
      records.push(cur); starts.push(startLine);
      cur = [];
    }
    while (i < text.length) {
      c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        if (c === '\n') line++;
        field += c; i++; continue;
      }
      if (c === '"' && field === '') { inQ = true; quoteLine = line; i++; continue; }
      if (c === d) { endField(); i++; continue; }
      if (c === '\r' || c === '\n') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        endRecord(); line++; startLine = line; i++; continue;
      }
      field += c; i++;
    }
    if (inQ) { out.unclosedQuote = true; out.unclosedQuoteLine = quoteLine; }
    if (field !== '' || cur.length) endRecord();
    var kept = [], keptLines = [];
    records.forEach(function (r, idx) {
      var blank = r.every(function (v) { return String(v).trim() === ''; });
      if (!blank) { kept.push(r.map(function (v) { return String(v).trim(); })); keptLines.push(starts[idx]); }
    });
    if (!kept.length) return out;
    out.headers = kept[0];
    out.rows = kept.slice(1);
    out.lines = keptLines.slice(1);
    return out;
  }

  function guessMapping(headers) {
    var m = { code: -1, name: -1, qty: -1, unit: -1, price: -1, note: -1 };
    var used = {};
    var norm = (headers || []).map(function (h) { return String(h).trim().toLowerCase(); });
    MAPPING_KEYS.forEach(function (key) {
      var hints = HEADER_HINTS[key], idx = -1, h, j;
      for (h = 0; h < hints.length && idx < 0; h++) {
        for (j = 0; j < norm.length; j++) {
          if (!used[j] && norm[j] === hints[h]) { idx = j; break; }
        }
      }
      if (idx < 0) {
        for (h = 0; h < hints.length && idx < 0; h++) {
          for (j = 0; j < norm.length; j++) {
            if (!used[j] && norm[j] && norm[j].indexOf(hints[h]) >= 0) { idx = j; break; }
          }
        }
      }
      if (idx >= 0) { m[key] = idx; used[idx] = true; }
    });
    return m;
  }

  /* 空串/无法识别 → null;支持 ¥ $ 元、千分位、全角、括号负数。 */
  function normalizeNumber(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (v == null) return null;
    var s = String(v).normalize('NFKC').trim();
    if (!s) return null;
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
    s = s.replace(/^[¥$]\s*/, '').replace(/\s*元$/, '').trim();
    if (s[0] === '-' || s[0] === '+') { if (s[0] === '-') neg = !neg; s = s.slice(1).replace(/^[¥$]\s*/, ''); }
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
    if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
    var n = parseFloat(s);
    if (!isFinite(n)) return null;
    return neg ? -n : n;
  }

  /* ---- 差异 ---- */
  function asTable(rows) {
    if (Array.isArray(rows)) return { unclosed: 0, rows: rows, lines: rows.map(function (_, i) { return i + 2; }) };
    return { unclosed: rows && rows.unclosedQuote ? rows.unclosedQuoteLine : 0, rows: (rows && rows.rows) || [], lines: (rows && rows.lines) || ((rows && rows.rows) || []).map(function (_, i) { return i + 2; }) };
  }
  function pick(mapping, side) {
    var m = (mapping && mapping[side]) || mapping || {};
    return m;
  }
  function cell(row, idx) { return idx >= 0 && idx < row.length ? String(row[idx]).trim() : ''; }
  function normCode(c) { return String(c).normalize('NFKC').trim().toLowerCase(); }

  function extract(rows, mapping, side, errors, warnings) {
    var t = asTable(rows), items = [], seen = new Map();
    var sideName = side === 'old' ? '旧版' : '新版';
    if (t.unclosed) {
      errors.push({ side: side, line: t.unclosed, code: '', type: 'unclosed-quote', message: sideName + '第 ' + t.unclosed + ' 行:引号未闭合,整份表格无法可靠解析,请补全引号。' });
      return items;
    }
    if (!mapping || typeof mapping.code !== 'number' || mapping.code < 0) {
      errors.push({ side: side, line: 0, code: '', type: 'no-code-column', message: sideName + ':未指定「项目编码」列,无法匹配。' });
      return items;
    }
    t.rows.forEach(function (r, i) {
      if (r.every(function (v) { return String(v).trim() === ''; })) return;
      var line = t.lines[i], code = cell(r, mapping.code);
      if (!code) {
        errors.push({ side: side, line: line, code: '', type: 'missing-code', message: sideName + '第 ' + line + ' 行:项目编码为空。' });
        return;
      }
      var key = normCode(code);
      if (seen.has(key)) {
        errors.push({ side: side, line: line, code: code, type: 'duplicate', message: sideName + '第 ' + line + ' 行:项目编码「' + code + '」重复(与第 ' + seen.get(key) + ' 行相同)。' });
        return;
      }
      seen.set(key, line);
      var qtyRaw = cell(r, mapping.qty), priceRaw = cell(r, mapping.price);
      var qty = normalizeNumber(qtyRaw), price = normalizeNumber(priceRaw);
      if (qty === null && qtyRaw !== '') errors.push({ side: side, line: line, code: code, type: 'bad-number', message: sideName + '第 ' + line + ' 行:数量「' + qtyRaw + '」不是有效数字。' });
      if (price === null && priceRaw !== '') errors.push({ side: side, line: line, code: code, type: 'bad-number', message: sideName + '第 ' + line + ' 行:单价「' + priceRaw + '」不是有效数字。' });
      if (qty === null && qtyRaw === '') warnings.push(sideName + '第 ' + line + ' 行(' + code + '):数量为空,按 0 计。');
      if (price === null && priceRaw === '') warnings.push(sideName + '第 ' + line + ' 行(' + code + '):单价为空,按 0 计。');
      qty = qty === null ? 0 : qty; price = price === null ? 0 : price;
      items.push({
        key: key, code: code, name: cell(r, mapping.name), qty: qty, unit: cell(r, mapping.unit),
        price: price, note: cell(r, mapping.note), line: line, amount: roundCents(qty * price)
      });
    });
    return items;
  }

  function diffQuotes(oldRows, newRows, mapping) {
    var errors = [], warnings = [];
    var oldItems = extract(oldRows, pick(mapping, 'old'), 'old', errors, warnings);
    var newItems = extract(newRows, pick(mapping, 'new'), 'new', errors, warnings);
    if (errors.length) {
      return { ok: false, errors: errors, warnings: warnings, added: [], removed: [], changed: [], unchanged: 0, totals: null };
    }
    var oldMap = new Map(), newMap = new Map();
    oldItems.forEach(function (it) { oldMap.set(it.key, it); });
    newItems.forEach(function (it) { newMap.set(it.key, it); });
    var added = [], removed = [], changed = [], unchanged = 0;
    newItems.forEach(function (n) {
      var o = oldMap.get(n.key);
      if (!o) { added.push(strip(n)); return; }
      var fields = [];
      if (o.name !== n.name) fields.push({ field: 'name', from: o.name, to: n.name });
      if (o.qty !== n.qty) fields.push({ field: 'qty', from: o.qty, to: n.qty });
      if (o.unit !== n.unit) fields.push({ field: 'unit', from: o.unit, to: n.unit });
      if (o.price !== n.price) fields.push({ field: 'price', from: o.price, to: n.price });
      if (!fields.length) { unchanged++; return; }
      changed.push({
        code: n.code, name: n.name, oldName: o.name, fields: fields,
        nameOnly: fields.length === 1 && fields[0].field === 'name',
        oldQty: o.qty, newQty: n.qty, oldUnit: o.unit, newUnit: n.unit, oldPrice: o.price, newPrice: n.price,
        oldAmount: o.amount, newAmount: n.amount, deltaAmount: roundCents(n.amount - o.amount), line: n.line
      });
    });
    oldItems.forEach(function (o) { if (!newMap.has(o.key)) removed.push(strip(o)); });
    var oldTotal = roundCents(oldItems.reduce(function (s, it) { return s + it.amount; }, 0));
    var newTotal = roundCents(newItems.reduce(function (s, it) { return s + it.amount; }, 0));
    var delta = roundCents(newTotal - oldTotal);
    var percent = oldTotal === 0 ? null : roundCents(delta / oldTotal * 100);
    return {
      ok: true, errors: [], warnings: warnings, added: added, removed: removed, changed: changed,
      unchanged: unchanged, totals: { oldTotal: oldTotal, newTotal: newTotal, delta: delta, percent: percent }
    };
  }
  function strip(it) {
    return { code: it.code, name: it.name, qty: it.qty, unit: it.unit, price: it.price, note: it.note, amount: it.amount, line: it.line };
  }

  /* ---- 文案 ---- */
  function fmtNum(n) {
    if (n === null || n === undefined || n === '') return '';
    var s = String(Math.round(n * 10000) / 10000);
    return s;
  }
  function fmtMoney(n) {
    var neg = n < 0, a = Math.abs(roundCents(n));
    var parts = a.toFixed(2).split('.');
    var int = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    var frac = parts[1] === '00' ? '' : '.' + parts[1];
    return (neg ? '-' : '') + '¥' + int + frac;
  }
  function moneyChange(d) {
    if (d > 0) return '增加 ' + fmtMoney(d);
    if (d < 0) return '减少 ' + fmtMoney(-d);
    return '金额不变';
  }
  function label(name, code) { return name || code; }

  function sentenceChanged(c) {
    var f = {}; c.fields.forEach(function (x) { f[x.field] = x; });
    var title = label(c.name, c.code);
    if (c.nameOnly) return title + ':名称由「' + c.oldName + '」改为「' + c.name + '」,仅改名称,金额不变';
    var parts = [], unitNow = c.newUnit ? ' ' + c.newUnit : '';
    if (f.qty) parts.push('数量 ' + fmtNum(f.qty.from) + ' → ' + fmtNum(f.qty.to) + (f.unit ? '' : unitNow));
    else if (f.price) parts.push('数量不变');
    if (f.unit) parts.push('单位 ' + (f.unit.from || '(空)') + ' → ' + (f.unit.to || '(空)'));
    if (f.price) parts.push('单价 ' + fmtMoney(f.price.from) + ' → ' + fmtMoney(f.price.to));
    else if (f.qty) parts.push('单价不变');
    if (f.name) parts.push('名称由「' + c.oldName + '」改为「' + c.name + '」');
    parts.push(moneyChange(c.deltaAmount));
    return title + ':' + parts.join(',');
  }

  function explain(diff, options) {
    options = options || {};
    if (!diff || !diff.ok) return '';
    var onlyAmount = !!options.onlyAmount;
    var added = diff.added, removed = diff.removed, changed = diff.changed;
    if (onlyAmount) {
      added = added.filter(function (x) { return x.amount !== 0; });
      removed = removed.filter(function (x) { return x.amount !== 0; });
      changed = changed.filter(function (x) { return x.deltaAmount !== 0; });
    }
    var lines = [];
    if (options.title) lines.push('# ' + options.title, '');
    var any = false;
    function section(title, arr, fn) {
      if (!arr.length) return;
      any = true;
      lines.push('## ' + title, '');
      arr.forEach(function (x) { lines.push('- ' + fn(x)); });
      lines.push('');
    }
    section('新增', added, function (a) {
      return label(a.name, a.code) + ':新增 ' + fmtNum(a.qty) + (a.unit ? ' ' + a.unit : '') + ',单价 ' + fmtMoney(a.price) + ',' + moneyChange(a.amount);
    });
    section('删除', removed, function (r) {
      return label(r.name, r.code) + ':删除(原 ' + fmtNum(r.qty) + (r.unit ? ' ' + r.unit : '') + ',单价 ' + fmtMoney(r.price) + '),' + moneyChange(-r.amount);
    });
    section('调整', changed, sentenceChanged);
    if (!any) lines.push(onlyAmount ? '没有影响金额的变更。' : '两版报价没有差异。', '');
    var t = diff.totals;
    var pct = t.percent === null ? '(旧版合计为 0,不计算百分比)' : '(' + (t.percent > 0 ? '+' : '') + t.percent + '%)';
    lines.push('## 总额', '', '- 旧版合计 ' + fmtMoney(t.oldTotal) + ',新版合计 ' + fmtMoney(t.newTotal) + ',' + moneyChange(t.delta) + pct);
    return lines.join('\n') + '\n';
  }

  /* ---- CSV ---- */
  function guardCell(v) {
    if (typeof v !== 'string') return v;
    return /^[=+\-@\t\r]/.test(v) && !/^[+\-]$/.test(v) ? "'" + v : v;
  }
  function csvCell(v) {
    if (v === null || v === undefined) return '';
    var s = String(guardCell(v));
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(table) {
    return table.map(function (row) { return row.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }
  function describeFields(c) {
    return c.fields.map(function (f) {
      var a = f.from, b = f.to;
      if (f.field === 'price') { a = fmtMoney(a); b = fmtMoney(b); }
      else if (f.field === 'qty') { a = fmtNum(a); b = fmtNum(b); }
      return FIELD_LABEL[f.field] + ' ' + (a === '' ? '(空)' : a) + ' → ' + (b === '' ? '(空)' : b);
    }).join(';');
  }
  function diffRows(diff) {
    var rows = [['类型', '项目编码', '项目名称', '变更内容', '旧金额', '新金额', '金额影响']];
    if (!diff || !diff.ok) return rows;
    diff.added.forEach(function (a) { rows.push(['新增', a.code, a.name, '数量 ' + fmtNum(a.qty) + ' ' + a.unit + ',单价 ' + fmtMoney(a.price), 0, a.amount, a.amount]); });
    diff.removed.forEach(function (r) { rows.push(['删除', r.code, r.name, '数量 ' + fmtNum(r.qty) + ' ' + r.unit + ',单价 ' + fmtMoney(r.price), r.amount, 0, roundCents(-r.amount)]); });
    diff.changed.forEach(function (c) { rows.push([c.nameOnly ? '改名(仅提示)' : '调整', c.code, c.name, describeFields(c), c.oldAmount, c.newAmount, c.deltaAmount]); });
    rows.push(['合计', '', '', '', diff.totals.oldTotal, diff.totals.newTotal, diff.totals.delta]);
    return rows;
  }
  function diffToCsv(diff) { return toCsv(diffRows(diff)); }

  /* ---- 确认记录 ---- */
  function isValidDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var p = s.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  }
  function resolveToday(search, realToday) {
    try {
      var v = new URLSearchParams(search || '').get('today');
      if (v && isValidDate(v)) return v;
    } catch (e) { /* 回退真实今天 */ }
    return realToday;
  }
  function sortRecords(records) {
    return records.slice().sort(function (a, b) {
      var ta = Date.parse(a.createdAt), tb = Date.parse(b.createdAt);
      if (ta !== tb) return ta < tb ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  /* 用同一个时区生成完整时间:先按偏移分钟平移,再读 UTC 分量,避免「本地日期 + UTC 时分秒」混拼。
     fixedDate(合法的 ?today)只替换日期部分,并标记为模拟日期 */
  function stampFromDate(date, opts) {
    var o = opts || {};
    var off = Number.isFinite(o.offsetMinutes) ? o.offsetMinutes : 0;
    var sh = new Date(date.getTime() + off * 60000);
    var day = sh.getUTCFullYear() + '-' + pad2(sh.getUTCMonth() + 1) + '-' + pad2(sh.getUTCDate());
    var simulated = false;
    if (o.fixedDate && isValidDate(o.fixedDate)) { day = o.fixedDate; simulated = true; }
    var sign = off < 0 ? '-' : '+', a = Math.abs(off);
    var zone = off === 0 ? '+00:00' : sign + pad2(Math.floor(a / 60)) + ':' + pad2(a % 60);
    return { createdAt: day + 'T' + pad2(sh.getUTCHours()) + ':' + pad2(sh.getUTCMinutes()) + ':' + pad2(sh.getUTCSeconds()) + zone, simulated: simulated };
  }
  /* 历史记录里的保存时间:写明时区偏移;旧记录(无偏移)标注未记录时区;模拟日期另行标注 */
  function describeStamp(rec) {
    var t = String((rec && rec.createdAt) || '');
    var head = t.slice(0, 10) + ' ' + t.slice(11, 16);
    var m = /(Z|[+-]\d{2}:\d{2})$/.exec(t);
    if (!m) return head + '(旧记录,未记录时区)';
    var zone = m[1] === 'Z' ? 'UTC' : 'UTC' + m[1];
    var tail = rec.simulated ? ';日期由地址参数固定,为模拟日期' : (rec.createdTz ? ',' + rec.createdTz : '');
    return head + '(' + zone + tail + ')';
  }
  var EXPLAIN_MAX = 50000;
  /* 导入确认前的预览文字 */
  function importSummary(current, incoming) {
    var a = current && Array.isArray(current.records) ? current.records.length : 0;
    var b = incoming && Array.isArray(incoming.records) ? incoming.records.length : 0;
    function hasDraft(d) { return !!(d && ((d.oldText || '').trim() || (d.newText || '').trim() || (d.versionName || '').trim() || (d.explainText || '').trim())); }
    var replaced = hasDraft(current && current.draft);
    return { currentRecords: a, incomingRecords: b, draftReplaced: replaced,
      text: '现有 ' + a + ' 条确认记录将被替换为备份文件 ' + b + ' 条' + (replaced ? ';编辑区里的旧版/新版文本、版本名和说明草稿也会被备份里的草稿替换' : '') + '。' };
  }
  function makeRecord(input) {
    var d = input.diff;
    if (!d || !d.ok) return { ok: false, error: '没有可保存的对比结果。' };
    var name = String(input.versionName || '').trim();
    if (!name) return { ok: false, error: '请填写版本名。' };
    var confirmed = !!input.confirmed, date = confirmed ? String(input.confirmedDate || '') : '';
    if (confirmed && !isValidDate(date)) return { ok: false, error: '已向客户确认时,需要填写有效的确认日期。' };
    return {
      ok: true,
      record: {
        id: String(input.id), createdAt: String(input.now), createdTz: String(input.tz || ''), simulated: !!input.simulated, versionName: name,
        oldTotal: d.totals.oldTotal, newTotal: d.totals.newTotal, delta: d.totals.delta, percent: d.totals.percent,
        counts: { added: d.added.length, removed: d.removed.length, changed: d.changed.length },
        confirmed: confirmed, confirmedDate: date, note: String(input.note || '').trim(), explainText: String(input.explainText || '')
      }
    };
  }

  /* ---- 备份校验:不合法整份拒绝 ---- */
  function validateImport(data) {
    var errors = [];
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, errors: ['备份文件顶层必须是对象。'] };
    if (data.app !== 'quote-diff') errors.push('app 字段必须是 "quote-diff"。');
    if (data.version !== 1) errors.push('version 必须是 1。');
    if (!Array.isArray(data.records)) { errors.push('records 必须是数组。'); return { ok: false, errors: errors }; }
    var ids = new Set();
    data.records.forEach(function (r, i) {
      var p = '第 ' + (i + 1) + ' 条记录:';
      if (!r || typeof r !== 'object' || Array.isArray(r)) { errors.push(p + '必须是对象。'); return; }
      if (typeof r.id !== 'string' || !r.id) errors.push(p + 'id 必须是非空字符串。');
      else if (ids.has(r.id)) errors.push(p + 'id「' + r.id + '」重复。');
      else ids.add(r.id);
      if (typeof r.createdAt !== 'string' || isNaN(Date.parse(r.createdAt))) errors.push(p + 'createdAt 必须是可解析的时间字符串。');
      if (r.createdTz !== undefined && typeof r.createdTz !== 'string') errors.push(p + 'createdTz 必须是字符串。');
      if (r.simulated !== undefined && typeof r.simulated !== 'boolean') errors.push(p + 'simulated 必须是布尔值。');
      if (typeof r.versionName !== 'string' || !r.versionName.trim()) errors.push(p + 'versionName 必须是非空字符串。');
      ['oldTotal', 'newTotal', 'delta'].forEach(function (k) {
        if (typeof r[k] !== 'number' || !isFinite(r[k])) errors.push(p + k + ' 必须是有限数字。');
      });
      if (r.percent !== null && (typeof r.percent !== 'number' || !isFinite(r.percent))) errors.push(p + 'percent 必须是数字或 null。');
      if (typeof r.confirmed !== 'boolean') errors.push(p + 'confirmed 必须是布尔值。');
      else if (r.confirmed && !isValidDate(r.confirmedDate)) errors.push(p + '已确认的记录需要 YYYY-MM-DD 格式的有效 confirmedDate。');
      else if (!r.confirmed && r.confirmedDate !== '') errors.push(p + '未确认的记录 confirmedDate 必须为空字符串。');
      if (typeof r.note !== 'string') errors.push(p + 'note 必须是字符串。');
      if (typeof r.explainText !== 'string') errors.push(p + 'explainText 必须是字符串。');
      var c = r.counts;
      if (!c || typeof c !== 'object') errors.push(p + 'counts 必须是对象。');
      else ['added', 'removed', 'changed'].forEach(function (k) {
        if (!Number.isInteger(c[k]) || c[k] < 0) errors.push(p + 'counts.' + k + ' 必须是非负整数。');
      });
    });
    if (data.draft !== undefined && data.draft !== null) {
      var dr = data.draft;
      if (typeof dr !== 'object' || Array.isArray(dr)) errors.push('draft 必须是对象。');
      else ['oldText', 'newText', 'versionName'].forEach(function (k) {
        if (typeof dr[k] !== 'string') errors.push('draft.' + k + ' 必须是字符串。');
      });
      if (dr.explainText !== undefined && (typeof dr.explainText !== 'string' || dr.explainText.length > EXPLAIN_MAX)) errors.push('draft.explainText 必须是不超过 ' + EXPLAIN_MAX + ' 字的字符串。');
      if (dr.explainEdited !== undefined && typeof dr.explainEdited !== 'boolean') errors.push('draft.explainEdited 必须是布尔值。');
      if (dr.sample !== undefined && typeof dr.sample !== 'boolean') errors.push('draft.sample 必须是布尔值。');
    }
    if (errors.length) return { ok: false, errors: errors };
    return { ok: true, errors: [], value: { records: data.records, draft: data.draft || null } };
  }

  /* 选文件后、写入旧版/新版输入框前的检查:空文件、无法按 UTF-8 解码的文件(出现替换字符 U+FFFD)不能覆盖输入框里已有的内容 */
  function checkTextFile(text) {
    var s = String(text == null ? '' : text);
    if (s.trim() === '') return { ok: false, code: 'empty', message: '文件是空的,没有读到内容。' };
    if (s.indexOf('\uFFFD') !== -1) return { ok: false, code: 'encoding', message: '文件含无法识别的字符,可能不是 UTF-8 编码。请在表格软件里另存为「CSV UTF-8」后再试。' };
    return { ok: true, code: '', message: '' };
  }

  var api = {
    checkTextFile: checkTextFile,
    parseTable: parseTable, guessMapping: guessMapping, normalizeNumber: normalizeNumber,
    diffQuotes: diffQuotes, explain: explain, toCsv: toCsv, diffRows: diffRows, diffToCsv: diffToCsv,
    validateImport: validateImport, sortRecords: sortRecords, stampFromDate: stampFromDate, describeStamp: describeStamp, importSummary: importSummary, EXPLAIN_MAX: EXPLAIN_MAX, makeRecord: makeRecord, isValidDate: isValidDate,
    resolveToday: resolveToday, fmtMoney: fmtMoney, fmtNum: fmtNum, roundCents: roundCents, MAPPING_KEYS: MAPPING_KEYS
  };
  globalThis.QuoteDiffCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
