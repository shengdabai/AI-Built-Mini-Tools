'use strict';
/* 采购单位比价 · 纯逻辑(无 DOM)。基准单位:质量 kg、体积 L、计数 件。 */
(function () {
  var UNITS = {
    'kg': { f: 1, d: 'mass', label: 'kg' },
    'g': { f: 0.001, d: 'mass', label: 'g' },
    'l': { f: 1, d: 'volume', label: 'L' },
    'ml': { f: 0.001, d: 'volume', label: 'mL' },
    '件': { f: 1, d: 'count', label: '件' }
  };
  var BASE_LABEL = { mass: 'kg', volume: 'L', count: '件' };
  var DIM_NAME = { mass: '质量', volume: '体积', count: '计数' };
  var UNIT_LIST = ['kg', 'g', 'L', 'mL', '件'];
  var CURRENCIES = ['CNY', 'USD', 'EUR', 'HKD', 'JPY', 'GBP'];

  function round(x, n) {
    var p = Math.pow(10, n);
    return Math.round((x + (x < 0 ? -1 : 1) * 1e-12) * p) / p;
  }
  function isPos(x) { return typeof x === 'number' && isFinite(x) && x > 0; }
  function unitKey(unit) {
    return typeof unit === 'string' ? unit.trim().toLowerCase() : '';
  }

  /* 数量 + 单位 → 基准量。未知单位或非正数量返回 null。 */
  function toBase(qty, unit) {
    var u = UNITS[unitKey(unit)];
    if (!u || !Object.prototype.hasOwnProperty.call(UNITS, unitKey(unit))) return null;
    if (!isPos(qty)) return null;
    return { value: round(qty * u.f, 10), dimension: u.d };
  }

  /* 单位价 = 包装价 ÷ (每包件数 × 每件净含量 → 基准)。缺参数返回 {ok:false, reason}。 */
  function unitPrice(q) {
    if (!q || !isPos(q.packPrice)) return { ok: false, reason: '缺包装价', field: 'price' };
    if (!isPos(q.packCount)) return { ok: false, reason: '缺每包件数', field: 'count' };
    if (!isPos(q.unitQty)) return { ok: false, reason: '缺每件净含量', field: 'qty' };
    if (typeof q.unit !== 'string' || !q.unit.trim()) return { ok: false, reason: '缺含量单位', field: 'unit' };
    var b = toBase(q.unitQty, q.unit);
    if (!b) return { ok: false, reason: '含量单位无法识别', field: 'unit' };
    var total = q.packCount * b.value;
    if (!(total > 0)) return { ok: false, reason: '总含量为 0', field: 'qty' };
    return {
      ok: true,
      value: round(q.packPrice / total, 4),
      raw: q.packPrice / total,
      dimension: b.dimension,
      baseUnit: BASE_LABEL[b.dimension],
      totalBase: round(total, 10)
    };
  }

  /* 每家(供应商+品名)在每个「币种 × 量纲」分区内各取最近一条有效报价;
     缺参数的报价只在比同币种有效报价更新(或没有有效报价)时单独列出。 */
  function latestEntries(list) {
    var valid = new Map(), invalid = new Map(), newestValid = new Map();
    list.forEach(function (q, i) {
      var up = unitPrice(q);
      var base = q.supplier + '\u0000' + q.item + '\u0000' + q.currency;
      if (up.ok) {
        var k = base + '\u0000' + up.dimension;
        var cur = valid.get(k);
        if (!cur || q.date >= cur.q.date) valid.set(k, { q: q, i: i, up: up });
        var nv = newestValid.get(base);
        if (nv === undefined || q.date > nv) newestValid.set(base, q.date);
      } else {
        var c2 = invalid.get(base);
        if (!c2 || q.date >= c2.q.date) invalid.set(base, { q: q, i: i, up: up });
      }
    });
    var out = Array.from(valid.values());
    invalid.forEach(function (e, base) {
      var nv = newestValid.get(base);
      if (nv === undefined || e.q.date > nv) out.push(e);
    });
    return out.sort(function (a, b) { return a.i - b.i; });
  }

  /* 规格组比价:每家(供应商+品名)取最近一条;同币种同量纲分区,区内按单位价升序。 */
  function rank(quotes, group) {
    var inGroup = (quotes || []).filter(function (q) { return q.group === group; });
    var latest = latestEntries(inGroup);
    var parts = new Map();
    var missing = [];
    latest.forEach(function (e) {
      var q = e.q, up = e.up;
      if (!up.ok) { missing.push({ quote: q, reason: up.reason, field: up.field }); return; }
      var key = q.currency + '|' + up.dimension;
      if (!parts.has(key)) parts.set(key, { currency: q.currency, dimension: up.dimension, baseUnit: up.baseUnit, rows: [] });
      parts.get(key).rows.push({ quote: q, unitPrice: up.value, rawPrice: up.raw });
    });
    var partitions = Array.from(parts.values()).sort(function (a, b) {
      return a.currency === b.currency ? (a.dimension < b.dimension ? -1 : 1) : (a.currency < b.currency ? -1 : 1);
    });
    partitions.forEach(function (p) {
      p.rows.sort(function (a, b) {
        if (a.rawPrice !== b.rawPrice) return a.rawPrice - b.rawPrice;
        return a.quote.supplier < b.quote.supplier ? -1 : (a.quote.supplier > b.quote.supplier ? 1 : 0);
      });
      var rawMin = p.rows[0].rawPrice;
      p.min = p.rows[0].unitPrice;
      p.rows.forEach(function (r, i) {
        r.rank = i + 1;
        r.pctOfMin = rawMin > 0 ? round(r.rawPrice / rawMin * 100, 1) : null;
        r.overMinPct = r.pctOfMin === null ? null : round(r.pctOfMin - 100, 1);
        r.isMin = r.unitPrice === p.min;
        r.currency = p.currency;
        r.baseUnit = p.baseUnit;
        r.dimension = p.dimension;
      });
    });
    return { group: group, partitions: partitions, missing: missing };
  }

  /* 同供应商同品名历次报价,按日期升序;涨跌幅相对上一条同币种同量纲的有效报价。 */
  function priceHistory(quotes, supplier, item, thresholdPct) {
    var th = typeof thresholdPct === 'number' && isFinite(thresholdPct) ? thresholdPct : 10;
    var list = (quotes || [])
      .map(function (q, i) { return { q: q, i: i }; })
      .filter(function (e) { return e.q.supplier === supplier && e.q.item === item; })
      .sort(function (a, b) { return a.q.date < b.q.date ? -1 : (a.q.date > b.q.date ? 1 : a.i - b.i); });
    var prevBy = new Map();
    return list.map(function (e) {
      var up = unitPrice(e.q);
      var entry = { quote: e.q, unitPrice: up.ok ? up.value : null, baseUnit: up.ok ? up.baseUnit : null,
        reason: up.ok ? '' : up.reason, changePct: null, warn: false, prevUnitPrice: null, prevQuote: null };
      if (up.ok) {
        var k = e.q.currency + '|' + up.dimension;
        var prev = prevBy.get(k);
        if (prev !== undefined) {
          var raw = (up.raw - prev.raw) / prev.raw * 100;
          entry.changePct = round(raw, 1);
          entry.warn = raw > th;
          entry.prevUnitPrice = prev.value;
          entry.prevQuote = prev.q;
        }
        prevBy.set(k, { raw: up.raw, value: up.value, q: e.q });
      }
      return entry;
    });
  }

  /* 列出所有出现过的 供应商+品名 组合(Map 分组,避免 __proto__ 等键)。 */
  function historyKeys(quotes) {
    var m = new Map();
    (quotes || []).forEach(function (q) {
      var k = q.supplier + '\u0000' + q.item;
      if (!m.has(k)) m.set(k, { supplier: q.supplier, item: q.item, count: 0 });
      m.get(k).count++;
    });
    return Array.from(m.values());
  }

  function groupNames(quotes) {
    var s = new Set();
    (quotes || []).forEach(function (q) { s.add(q.group); });
    return Array.from(s);
  }

  /* ---------- 批量粘贴 ---------- */
  function parseNum(s) {
    var t = String(s).trim();
    if (!/^\d+(\.\d+)?$/.test(t)) return NaN;
    return Number(t);
  }
  /* 行格式:供应商 | 品名 | 包装价 | 每包件数 | 每件净含量 | 单位 [| 规格组]
     后三项可留空(记为缺参数)。defaults:{group,currency,date}。 */
  function parseBatch(text, defaults) {
    var d = defaults || {};
    var rows = [], errors = [];
    String(text || '').split(/\r?\n/).forEach(function (raw, idx) {
      var line = raw.trim();
      if (!line) return;
      var n = idx + 1;
      var parts = line.split(/\s*[|｜\t]\s*/);
      if (parts.length < 6 || parts.length > 7) {
        errors.push({ line: n, text: raw, message: '需要 6 或 7 列(供应商 | 品名 | 包装价 | 每包件数 | 每件净含量 | 单位 [| 规格组]),实际 ' + parts.length + ' 列' });
        return;
      }
      var supplier = parts[0].trim(), item = parts[1].trim();
      if (!supplier || !item) { errors.push({ line: n, text: raw, message: '供应商和品名不能为空' }); return; }
      var price = parseNum(parts[2]);
      if (!isPos(price)) { errors.push({ line: n, text: raw, message: '包装价必须是大于 0 的数字' }); return; }
      var cnt = null, qty = null, unit = null;
      if (parts[3].trim() !== '') { cnt = parseNum(parts[3]); if (!isPos(cnt)) { errors.push({ line: n, text: raw, message: '每包件数必须是大于 0 的数字或留空' }); return; } }
      if (parts[4].trim() !== '') { qty = parseNum(parts[4]); if (!isPos(qty)) { errors.push({ line: n, text: raw, message: '每件净含量必须是大于 0 的数字或留空' }); return; } }
      if (parts[5].trim() !== '') {
        unit = parts[5].trim();
        var uk = unitKey(unit);
        if (!Object.prototype.hasOwnProperty.call(UNITS, uk)) { errors.push({ line: n, text: raw, message: '单位「' + unit + '」无法识别,可用:' + UNIT_LIST.join('、') }); return; }
        unit = UNITS[uk].label;
      }
      var group = parts.length === 7 && parts[6].trim() ? parts[6].trim() : (d.group || '');
      if (!group) { errors.push({ line: n, text: raw, message: '没有规格组:请先填写默认规格组,或在第 7 列写明' }); return; }
      rows.push({ supplier: supplier, item: item, group: group, currency: d.currency || 'CNY',
        packPrice: price, packCount: cnt, unitQty: qty, unit: unit, note: '', date: d.date || '' });
    });
    return { rows: rows, errors: errors };
  }

  /* 整批接受:任一行有错就一行都不接受。 */
  function batchAccept(text, defaults) {
    var r = parseBatch(text, defaults);
    if (r.errors.length) return { ok: false, rows: [], errors: r.errors };
    return { ok: r.rows.length > 0, rows: r.rows, errors: r.rows.length ? [] : [{ line: 0, text: '', message: '没有可导入的内容' }] };
  }

  /* ---------- 导出 ---------- */
  function guard(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return String(v);
    var s = String(v);
    if (s.length > 1 && /^[=+\-@\t\r]/.test(s)) return "'" + s;
    if (s === '=' || s === '@') return "'" + s;
    return s;
  }
  function csvCell(v) {
    var s = guard(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(headers, rows) {
    return [headers].concat(rows).map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }
  function mdCell(v) { return guard(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' '); }
  function toMarkdown(headers, rows, title, note) {
    var out = [];
    if (title) out.push('# ' + title, '');
    if (note) out.push('> ' + note, '');
    out.push('| ' + headers.map(mdCell).join(' | ') + ' |');
    out.push('| ' + headers.map(function () { return '---'; }).join(' | ') + ' |');
    rows.forEach(function (r) { out.push('| ' + r.map(mdCell).join(' | ') + ' |'); });
    return out.join('\n') + '\n';
  }
  function fmtMoney(x) {
    if (typeof x !== 'number' || !isFinite(x)) return '';
    var s = x.toFixed(2);
    if (s === '0.00' && x > 0) s = x.toFixed(4);
    return s;
  }
  var RANK_HEADERS = ['规格组', '币种', '排名', '供应商', '品名', '单位价', '基准单位', '占最低价的百分比%(最低价=100)', '包装价', '日期', '状态', '比最低价贵%'];
  function rankTable(results, opts) {
    var sample = !!(opts && opts.sample);
    var rows = [];
    results.forEach(function (res) {
      res.partitions.forEach(function (p) {
        p.rows.forEach(function (r) {
          var q = r.quote;
          rows.push([res.group, p.currency, r.rank, q.supplier, q.item, fmtMoney(r.unitPrice), '每 ' + p.baseUnit,
            r.pctOfMin, fmtMoney(q.packPrice), q.date, r.isMin ? '最低价' : '', r.overMinPct]);
        });
      });
      res.missing.forEach(function (m) {
        var q = m.quote;
        rows.push([res.group, q.currency, '', q.supplier, q.item, '', '', '', fmtMoney(q.packPrice), q.date, '缺参数:' + m.reason, '']);
      });
    });
    var headers = RANK_HEADERS.slice();
    if (sample) { headers.push('数据来源'); rows.forEach(function (r) { r.push('合成示例'); }); }
    return { headers: headers, rows: rows };
  }
  var QUOTE_HEADERS = ['日期', '规格组', '供应商', '品名', '币种', '包装价', '每包件数', '每件净含量', '含量单位', '单位价', '基准单位', '备注'];
  function quotesTable(quotes, opts) {
    var sample = !!(opts && opts.sample);
    var sorted = (quotes || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
    var headers = QUOTE_HEADERS.slice();
    if (sample) headers.push('数据来源');
    return { headers: headers, rows: sorted.map(function (q) {
      var up = unitPrice(q);
      var row = [q.date, q.group, q.supplier, q.item, q.currency, q.packPrice, q.packCount, q.unitQty, q.unit,
        up.ok ? fmtMoney(up.value) : '', up.ok ? '每 ' + up.baseUnit : '缺参数:' + up.reason, q.note];
      if (sample) row.push('合成示例');
      return row;
    }) };
  }

  /* ---------- 导入校验:不合法就整份拒绝 ---------- */
  function validDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var d = new Date(s + 'T00:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }
  function validateImport(obj) {
    var errors = [];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, errors: ['顶层必须是对象'] };
    if (obj.version !== 1) errors.push('version 必须是 1');
    if (obj.sample !== undefined && typeof obj.sample !== 'boolean') errors.push('sample 必须是 true 或 false');
    var threshold = 10;
    if (obj.threshold !== undefined) {
      if (typeof obj.threshold !== 'number' || !isFinite(obj.threshold) || obj.threshold < 0 || obj.threshold > 1000) errors.push('threshold 必须是 0 到 1000 的数字');
      else threshold = obj.threshold;
    }
    if (!Array.isArray(obj.quotes)) { errors.push('quotes 必须是数组'); return { ok: false, errors: errors }; }
    var ids = new Set(), out = [];
    obj.quotes.forEach(function (q, i) {
      var p = '第 ' + (i + 1) + ' 条报价:';
      if (!q || typeof q !== 'object' || Array.isArray(q)) { errors.push(p + '不是对象'); return; }
      if (typeof q.id !== 'string' || !q.id) errors.push(p + 'id 必须是非空字符串');
      else if (ids.has(q.id)) errors.push(p + 'id「' + q.id + '」重复');
      else ids.add(q.id);
      ['supplier', 'item', 'group'].forEach(function (k) {
        if (typeof q[k] !== 'string' || !q[k].trim()) errors.push(p + k + ' 必须是非空字符串');
      });
      if (CURRENCIES.indexOf(q.currency) < 0) errors.push(p + 'currency 必须是 ' + CURRENCIES.join('/') + ' 之一');
      if (!isPos(q.packPrice)) errors.push(p + 'packPrice 必须是大于 0 的数字');
      ['packCount', 'unitQty'].forEach(function (k) {
        if (q[k] !== null && !isPos(q[k])) errors.push(p + k + ' 必须是大于 0 的数字或 null');
      });
      if (q.unit !== null && UNIT_LIST.indexOf(q.unit) < 0) errors.push(p + 'unit 必须是 ' + UNIT_LIST.join('/') + ' 或 null');
      if (typeof q.note !== 'string') errors.push(p + 'note 必须是字符串');
      if (!validDate(q.date)) errors.push(p + 'date 必须是真实存在的 YYYY-MM-DD');
      out.push({ id: q.id, supplier: q.supplier, item: q.item, group: q.group, currency: q.currency,
        packPrice: q.packPrice, packCount: q.packCount, unitQty: q.unitQty, unit: q.unit, note: q.note, date: q.date });
    });
    if (errors.length) return { ok: false, errors: errors };
    return { ok: true, errors: [], data: { version: 1, sample: obj.sample === true, threshold: threshold, quotes: out } };
  }

  /* ---------- 日期 ---------- */
  function localToday(now) {
    var d = now || new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function resolveToday(search, now) {
    var v = null;
    try { v = new URLSearchParams(search || '').get('today'); } catch (e) { v = null; }
    return validDate(v) ? v : localToday(now);
  }
  function fixedToday(search) {
    var v = null;
    try { v = new URLSearchParams(search || '').get('today'); } catch (e) { v = null; }
    return validDate(v) ? v : null;
  }

  /* 载入示例 / 导入 / 清空会替换什么:报价、偏离默认的涨幅阈值、表单草稿、批量粘贴草稿、正在编辑 */
  function replaceScope(st, drafts) {
    var s = st || {}, d = drafts || {};
    var n = (s.quotes || []).length;
    var thr = typeof s.threshold === 'number' ? s.threshold : 10;
    var thresholdChanged = thr !== 10;
    return {
      quotes: n, threshold: thr, thresholdChanged: thresholdChanged,
      formDraft: !!d.formDraft, batchDraft: !!d.batchDraft,
      any: n > 0 || thresholdChanged || !!d.formDraft || !!d.batchDraft
    };
  }
  function describeScope(sc) {
    var p = [];
    if (sc.quotes) p.push(sc.quotes + ' 条报价');
    if (sc.thresholdChanged) p.push('改过的涨幅阈值 ' + sc.threshold + '%(会恢复为 10%)');
    if (sc.formDraft) p.push('表单草稿(录入表单里没保存的内容)');
    if (sc.batchDraft) p.push('批量粘贴框里没导入的内容');
    return p.join('、');
  }

  /* 删除一条报价会连带改变什么 */
  function deleteImpact(quotes, id) {
    var list = quotes || [];
    var t = list.filter(function (x) { return x.id === id; })[0];
    if (!t) return null;
    var inGroup = list.filter(function (x) { return x.group === t.group; });
    var affectsRank = latestEntries(inGroup).some(function (e) { return e.q.id === id; });
    var sameKey = list.filter(function (x) { return x.id !== id && x.supplier === t.supplier && x.item === t.item; });
    var up = unitPrice(t);
    var laterShift = 0;
    if (up.ok) {
      var nextOne = sameKey.filter(function (x) {
        var u2 = unitPrice(x);
        return u2.ok && x.currency === t.currency && u2.dimension === up.dimension && x.date > t.date;
      }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; })[0];
      laterShift = nextOne ? 1 : 0;
    }
    return { quote: t, affectsRank: affectsRank, sameKeyOthers: sameKey.length, laterShift: laterShift };
  }
  function describeDelete(imp) {
    var p = [];
    if (imp.affectsRank) p.push('它会从「' + imp.quote.group + '」的比价排名里消失' + (imp.sameKeyOthers ? ',该供应商同品名更早的报价会顶上来参与排名' : ',该供应商这个品名不再出现在排名里'));
    if (imp.laterShift) p.push('它后面一条报价的「相对上次」涨跌幅会改为对比更早的一条');
    if (!imp.sameKeyOthers) p.push('该供应商这个品名的历史价格记录不再出现');
    if (!p.length) p.push('不影响当前的比价排名');
    return p.join(';') + '。删除后不能撤销。';
  }

  var idCounter = 0;
  /* 不依赖数值递增:时间戳 + 计数器 + 随机串,并在现有 ID 集合中确认唯一。 */
  function newId(quotes) {
    var used = new Set((quotes || []).map(function (q) { return q.id; }));
    var id;
    do {
      idCounter++;
      id = 'q' + Date.now().toString(36) + idCounter.toString(36) + Math.random().toString(36).slice(2, 8);
    } while (used.has(id));
    return id;
  }

  var api = {
    UNIT_LIST: UNIT_LIST, CURRENCIES: CURRENCIES, BASE_LABEL: BASE_LABEL, DIM_NAME: DIM_NAME,
    toBase: toBase, unitPrice: unitPrice, rank: rank, priceHistory: priceHistory, historyKeys: historyKeys,
    groupNames: groupNames, parseBatch: parseBatch, batchAccept: batchAccept, toCsv: toCsv, toMarkdown: toMarkdown, rankTable: rankTable,
    quotesTable: quotesTable, fmtMoney: fmtMoney, validateImport: validateImport, validDate: validDate,
    resolveToday: resolveToday, fixedToday: fixedToday, localToday: localToday, replaceScope: replaceScope, describeScope: describeScope, deleteImpact: deleteImpact, describeDelete: describeDelete, newId: newId, guard: guard
  };
  globalThis.ProcureCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
