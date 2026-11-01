'use strict';
// 商品 CSV 上架预检 · 纯逻辑(无 DOM)。
// 规则来自 Shopify 公开帮助文档里常见的商品导入问题,不是官方校验器,不保证通过平台导入。
(function () {
  const BLOCK = 'block';
  const WARN = 'warn';
  const LEVEL_LABEL = Object.freeze({ block: '阻断', warn: '警告' });

  // 规则表:集中定义。message 是通用说明;具体问题的说明在 check 里按单元格补充。
  const RULES = Object.freeze([
    { id: 'missing-column', level: BLOCK, title: '缺少必需列', message: '表头必须包含 Handle 和 Title 两列。' },
    { id: 'unclosed-quote', level: BLOCK, title: '引号未闭合', message: '有一个单元格以引号开头却没有结束引号,后面的内容被吞进了同一个单元格。' },
    { id: 'bad-quote', level: BLOCK, title: '引号位置不合法', message: '引号只能包住整个单元格;单元格内部的引号要写成两个连续引号。' },
    { id: 'col-count', level: BLOCK, title: '列数与表头不一致', message: '该行的列数与表头不同,平台无法对齐字段。' },
    { id: 'bad-encoding', level: BLOCK, title: '编码损坏', message: '单元格含替换字符 U+FFFD,说明文件不是 UTF-8 或已损坏;请用 UTF-8 重新导出。' },
    { id: 'handle-empty', level: BLOCK, title: 'Handle 为空', message: '每一行都必须有 Handle,同一商品的多个变体行用相同 Handle 关联。' },
    { id: 'handle-format', level: BLOCK, title: 'Handle 格式不合法', message: 'Handle 只能包含小写字母 a-z、数字 0-9 和连字符 -,不能有空格或大写。' },
    { id: 'title-missing', level: BLOCK, title: '商品首行缺 Title', message: '同一 Handle 的第一行必须填写 Title。' },
    { id: 'price-invalid', level: BLOCK, title: 'Variant Price 不合法', message: 'Variant Price 必须是不小于 0 的数字。' },
    { id: 'qty-invalid', level: BLOCK, title: 'Variant Inventory Qty 不是整数', message: 'Variant Inventory Qty 必须是整数。' },
    { id: 'published-invalid', level: BLOCK, title: 'Published 取值不合法', message: 'Published 只能是 TRUE 或 FALSE(不区分大小写)。' },
    { id: 'option-dup', level: BLOCK, title: '变体选项组合重复', message: '同一 Handle 下,Option1/2/3 Value 的组合不能重复。' },
    { id: 'sku-dup', level: WARN, title: 'Variant SKU 重复', message: '同一文件里 SKU 重复,库存与订单可能对不上。' },
    { id: 'image-url', level: WARN, title: 'Image Src 不是 http(s) 地址', message: '图片地址必须以 http:// 或 https:// 开头。' },
    { id: 'body-script', level: WARN, title: 'Body (HTML) 含 script 标签', message: '商品描述里的 <script> 通常会被平台移除或拒绝。' },
    { id: 'tags-space', level: WARN, title: 'Tags 前后有空格', message: 'Tags 整个单元格的开头或结尾有空格。' },
    { id: 'meta-mismatch', level: WARN, title: '同一 Handle 的 Title/Vendor 不一致', message: '同一商品的多行里,Title 或 Vendor 写法不同,平台只会取其中一个。' },
    { id: 'price-outlier', level: WARN, title: '价格比其他变体高 10 倍以上', message: '可能多写了一位数或小数点位置错误。' },
    { id: 'grams-invalid', level: WARN, title: 'Variant Grams 不是数字', message: 'Variant Grams 应为数字。' },
    { id: 'empty-row', level: WARN, title: '空行', message: '整行没有任何内容。' },
  ].map(r => Object.freeze(r)));
  const RULE_BY_ID = new Map(RULES.map(r => [r.id, r]));

  const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;
  const INTEGER = /^[+-]?\d+$/;
  const HANDLE = /^[a-z0-9-]+$/;
  const isHttpUrl = v => {
    try { const u = new URL(v); return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== ''; }
    catch (e) { return false; }
  };

  // ---------- RFC 4180 解析 ----------
  // 返回 {headers, rows, rowLines, errors}。行号约定:表头是第 1 行,第一条数据记录是第 2 行;
  // 引号内的换行不增加行号。rowLines[i] 是第 i 条数据记录在文件里的起始物理行。
  function parseCsv(input) {
    let text = input == null ? '' : String(input);
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const empty = { headers: [], rows: [], rowLines: [], errors: [] };
    if (text.trim() === '') return empty;

    const records = [];
    const lines = [];
    const errors = [];
    let rec = [];
    let field = '';
    let inQuote = false;
    let afterQuote = false;
    let flagged = false;
    let line = 1;
    let recLine = 1;

    const flagBadQuote = () => {
      if (flagged) return;
      flagged = true;
      const row = records.length + 1;
      errors.push({ row, line, ruleId: 'bad-quote', message: `第 ${row} 行(文件第 ${line} 行)引号位置不合法:引号只能包住整个单元格,单元格内的引号要写成两个 ""。` });
    };

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuote) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else { inQuote = false; afterQuote = true; }
        } else {
          field += c;
          if (c === '\n' || (c === '\r' && text[i + 1] !== '\n')) line++;
        }
        continue;
      }
      if (c === ',') { rec.push(field); field = ''; afterQuote = false; continue; }
      if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        rec.push(field);
        records.push(rec);
        lines.push(recLine);
        rec = []; field = ''; afterQuote = false; flagged = false;
        line++; recLine = line;
        continue;
      }
      if (c === '"') {
        if (field === '' && !afterQuote) { inQuote = true; continue; }
        flagBadQuote();
        field += c;
        continue;
      }
      if (afterQuote) flagBadQuote();
      field += c;
    }

    if (inQuote) {
      const row = records.length + 1;
      errors.push({ row, line: recLine, ruleId: 'unclosed-quote', message: `第 ${row} 行(文件第 ${recLine} 行)的引号没有闭合,该行及之后的内容未被解析。` });
    } else if (field !== '' || rec.length > 0 || afterQuote) {
      rec.push(field);
      records.push(rec);
      lines.push(recLine);
    }
    if (records.length === 0) return { headers: [], rows: [], rowLines: [], errors };
    return { headers: records[0], rows: records.slice(1), rowLines: lines.slice(1), errors };
  }

  // ---------- 预检 ----------
  const isBlankRow = row => row.every(c => c.trim() === '');
  const numberOrNull = v => (NUMBER.test(v) ? Number(v) : null);

  function check(parsed, options) {
    const opts = options || {};
    const disabled = new Set(opts.disabledRules || []);
    const headers = (parsed && parsed.headers) || [];
    const rows = (parsed && parsed.rows) || [];
    const errors = (parsed && parsed.errors) || [];
    const issues = [];

    const add = (ruleId, index, colIndex, value, detail) => {
      if (disabled.has(ruleId)) return;
      const rule = RULE_BY_ID.get(ruleId);
      issues.push({
        row: index + 2,
        index,
        colIndex,
        col: colIndex >= 0 && colIndex < headers.length ? headers[colIndex].trim() : '',
        value: value == null ? '' : String(value),
        ruleId,
        level: rule.level,
        message: detail || rule.message,
      });
    };

    const colOf = new Map();
    headers.forEach((h, i) => { const k = h.trim().toLowerCase(); if (!colOf.has(k)) colOf.set(k, i); });
    const col = name => (colOf.has(name) ? colOf.get(name) : -1);
    const H = col('handle'), T = col('title'), V = col('vendor');
    const BODY = col('body (html)'), TAGS = col('tags'), PUB = col('published');
    const OPT = [col('option1 value'), col('option2 value'), col('option3 value')].filter(i => i >= 0);
    const SKU = col('variant sku'), GRAMS = col('variant grams'), QTY = col('variant inventory qty');
    const PRICE = col('variant price'), IMG = col('image src');

    for (const [name, i] of [['Handle', H], ['Title', T]]) {
      if (i < 0) add('missing-column', -1, -1, '', `缺少必需列 "${name}"(列名不区分大小写)。`);
    }
    headers.forEach((h, i) => { if (h.includes('\uFFFD')) add('bad-encoding', -1, i, h, '表头含替换字符 U+FFFD,文件不是 UTF-8 或已损坏。'); });
    for (const e of errors) add(e.ruleId, e.row - 2, -1, '', e.message);

    const groups = new Map(); // handle -> 数据行下标(升序)
    const skuSeen = new Map(); // sku -> 首次出现的下标
    const valid = []; // 列数正确的非空行

    rows.forEach((row, i) => {
      if (isBlankRow(row)) { add('empty-row', i, -1, ''); return; }
      row.forEach((cell, c) => { if (cell.includes('\uFFFD')) add('bad-encoding', i, c, cell); });
      if (row.length !== headers.length) {
        add('col-count', i, -1, '', `第 ${i + 2} 行有 ${row.length} 列,表头有 ${headers.length} 列。`);
        return;
      }
      valid.push(i);
      const cell = c => (c >= 0 ? row[c] : '');

      if (H >= 0) {
        const raw = row[H];
        if (raw.trim() === '') add('handle-empty', i, H, raw);
        else {
          if (!HANDLE.test(raw)) add('handle-format', i, H, raw, `Handle "${raw}" 含空格、大写或不允许的字符。`);
          const key = raw.trim();
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(i);
        }
      }
      if (PRICE >= 0) {
        const v = cell(PRICE).trim();
        if (v !== '') {
          if (!NUMBER.test(v)) add('price-invalid', i, PRICE, cell(PRICE), `Variant Price "${v}" 不是数字。`);
          else if (Number(v) < 0) add('price-invalid', i, PRICE, cell(PRICE), `Variant Price "${v}" 小于 0。`);
        }
      }
      if (QTY >= 0) {
        const v = cell(QTY).trim();
        if (v !== '' && !INTEGER.test(v)) add('qty-invalid', i, QTY, cell(QTY), `Variant Inventory Qty "${v}" 不是整数。`);
      }
      if (PUB >= 0) {
        const v = cell(PUB).trim();
        if (!/^(true|false)$/i.test(v)) add('published-invalid', i, PUB, cell(PUB), v === '' ? 'Published 为空,必须填 TRUE 或 FALSE。' : `Published "${v}" 不是 TRUE 或 FALSE。`);
      }
      if (GRAMS >= 0) {
        const v = cell(GRAMS).trim();
        if (v !== '' && !NUMBER.test(v)) add('grams-invalid', i, GRAMS, cell(GRAMS), `Variant Grams "${v}" 不是数字。`);
      }
      if (IMG >= 0) {
        const v = cell(IMG).trim();
        if (v !== '' && !isHttpUrl(v)) add('image-url', i, IMG, cell(IMG), `Image Src "${v}" 不是 http(s) 地址。`);
      }
      if (BODY >= 0 && /<script/i.test(cell(BODY))) add('body-script', i, BODY, cell(BODY));
      if (TAGS >= 0 && cell(TAGS) !== '' && cell(TAGS) !== cell(TAGS).trim()) add('tags-space', i, TAGS, cell(TAGS));
      if (SKU >= 0) {
        const v = cell(SKU).trim();
        if (v !== '') {
          if (skuSeen.has(v)) add('sku-dup', i, SKU, cell(SKU), `Variant SKU "${v}" 与第 ${skuSeen.get(v) + 2} 行重复。`);
          else skuSeen.set(v, i);
        }
      }
    });

    for (const [handle, idxs] of groups) {
      if (T >= 0 && rows[idxs[0]][T].trim() === '') {
        add('title-missing', idxs[0], T, '', `Handle "${handle}" 的第一行(第 ${idxs[0] + 2} 行)没有 Title。`);
      }
      for (const [c, name] of [[T, 'Title'], [V, 'Vendor']]) {
        if (c < 0) continue;
        let ref = null;
        for (const i of idxs) {
          const v = rows[i][c].trim();
          if (v === '') continue;
          if (ref === null) ref = { v, i };
          else if (v !== ref.v) add('meta-mismatch', i, c, rows[i][c], `Handle "${handle}" 的 ${name} 与第 ${ref.i + 2} 行不一致("${ref.v}" 与 "${v}")。`);
        }
      }
      if (OPT.length || SKU >= 0 || PRICE >= 0 || QTY >= 0) {
        const seen = new Map();
        for (const i of idxs) {
          const vals = OPT.map(c => rows[i][c].trim().toLowerCase());
          // 纯图片行(选项、SKU、价格、库存都空)不是变体;其余行即使选项全空也参与重复检查
          const isVariant = vals.some(v => v !== '') || [SKU, PRICE, QTY].some(c => c >= 0 && rows[i][c].trim() !== '');
          if (!isVariant) continue;
          const key = JSON.stringify(vals);
          if (seen.has(key)) add('option-dup', i, OPT.length ? OPT[0] : -1, OPT.length ? rows[i][OPT[0]] : '', `Handle "${handle}" 的选项组合与第 ${seen.get(key) + 2} 行重复。`);
          else seen.set(key, i);
        }
      }
      if (PRICE >= 0) {
        const priced = idxs.map(i => ({ i, p: numberOrNull(rows[i][PRICE].trim()) })).filter(x => x.p !== null && x.p >= 0);
        for (const x of priced) {
          const others = priced.filter(y => y !== x).map(y => y.p);
          const max = others.length ? Math.max(...others) : 0;
          if (max > 0 && x.p >= max * 10) {
            add('price-outlier', x.i, PRICE, rows[x.i][PRICE], `Variant Price ${x.p} 是同一 Handle 其他变体最高价 ${max} 的 ${Math.floor(x.p / max)} 倍以上。`);
          }
        }
      }
    }

    issues.sort((a, b) => a.index - b.index || a.colIndex - b.colIndex);
    const variantCols = [SKU, PRICE, QTY, ...OPT].filter(i => i >= 0);
    const stats = {
      rows: rows.length,
      products: groups.size,
      variants: valid.filter(i => variantCols.some(c => rows[i][c].trim() !== '')).length,
      blocks: issues.filter(x => x.level === BLOCK).length,
      warns: issues.filter(x => x.level === WARN).length,
    };
    return { issues, stats };
  }

  // ---------- 安全修复 ----------
  // 只做无歧义修复:去首尾空白;Handle 转小写并把空白换成连字符;Published 的 true/false 规范成大写;删除空行。
  // 列数与表头不一致的行无法对齐,原样保留。changed 是被改动的单元格数,removedRows 是删除的空行数。
  function safeFix(parsed) {
    const srcHeaders = (parsed && parsed.headers) || [];
    const srcRows = (parsed && parsed.rows) || [];
    const srcLines = (parsed && parsed.rowLines) || [];
    let changed = 0;
    let removedRows = 0;
    const headers = srcHeaders.map(h => { const n = h.trim(); if (n !== h) changed++; return n; });
    const lower = headers.map(h => h.toLowerCase());
    const H = lower.indexOf('handle');
    const PUB = lower.indexOf('published');
    const rows = [];
    const rowLines = [];
    srcRows.forEach((row, i) => {
      if (isBlankRow(row)) { removedRows++; return; }
      rowLines.push(srcLines[i]);
      if (row.length !== headers.length) { rows.push(row.slice()); return; }
      rows.push(row.map((cell, c) => {
        let v = cell.trim();
        if (c === H) v = v.toLowerCase().replace(/\s+/g, '-');
        if (c === PUB && /^(true|false)$/i.test(v)) v = v.toUpperCase();
        if (v !== cell) changed++;
        return v;
      }));
    });
    return { parsed: { headers, rows, rowLines, errors: ((parsed && parsed.errors) || []).slice() }, changed, removedRows };
  }

  // ---------- 导出 ----------
  // 以 = @ 开头,或以 + - 开头且长度大于 1 的单元格,前面加单引号,防止表格软件当公式执行。
  // 来自用户输入的字符串一律按此规则处理,包括 +0012、-3 这类数字样式的字符串。
  function neutralizeFormula(value) {
    const v = value == null ? '' : String(value);
    if (/^[=@]/.test(v)) return "'" + v;
    if (/^[+-]./s.test(v)) return "'" + v;
    return v;
  }
  const csvCell = value => {
    const v = neutralizeFormula(value);
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  const csvLine = cells => cells.map(csvCell).join(',');

  function toCsv(parsed) {
    const headers = (parsed && parsed.headers) || [];
    if (headers.length === 0) return '';
    const rows = parsed.rows || [];
    return [headers, ...rows].map(csvLine).join('\r\n') + '\r\n';
  }

  function issuesToCsv(issues, opts) {
    const sample = !!(opts && opts.sample);
    const lines = [['行号', '列名', '级别', '规则', '说明', '原值'].concat(sample ? ['数据来源'] : [])];
    for (const x of issues) {
      const rule = RULE_BY_ID.get(x.ruleId);
      lines.push([x.row, x.col, LEVEL_LABEL[x.level], `${rule.title}(${x.ruleId})`, x.message, x.value].concat(sample ? ['合成示例'] : []));
    }
    return lines.map(csvLine).join('\r\n') + '\r\n';
  }

  const mdCell = (value, max) => {
    let v = value == null ? '' : String(value).replace(/\s+/g, ' ');
    if (v.length > max) v = v.slice(0, max) + '…';
    return neutralizeFormula(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '\\|');
  };

  function issuesToMarkdown(issues, stats, opts) {
    const out = ['# 商品 CSV 预检报告', ''];
    if (opts && opts.sample) out.push('数据来源：合成示例（虚构商品，不是真实店铺数据）。', '');
    if (opts && opts.parseErrors > 0) out.push(`> 检查未完成：${opts.parseErrors} 处解析错误，出错之后的行可能没有被检查，下面的清单只是已发现的问题。`, '');
    if (stats) {
      out.push(`- 数据行:${stats.rows};商品数:${stats.products};变体数:${stats.variants}`);
      out.push(`- 阻断:${stats.blocks};警告:${stats.warns}`, '');
    }
    out.push('说明:规则来自 Shopify 公开帮助文档中的常见导入问题,不是官方校验器,通过预检不代表一定能导入成功。行号以表头为第 1 行。', '');
    for (const level of [BLOCK, WARN]) {
      const list = issues.filter(x => x.level === level);
      out.push(`## ${LEVEL_LABEL[level]}(${list.length})`, '');
      if (list.length === 0) { out.push('无。', ''); continue; }
      out.push('| 行 | 列 | 规则 | 原值 | 说明 |', '| --- | --- | --- | --- | --- |');
      for (const x of list) {
        out.push(`| ${x.row} | ${mdCell(x.col, 40)} | ${mdCell(RULE_BY_ID.get(x.ruleId).title, 40)} | ${mdCell(x.value, 60)} | ${mdCell(x.message, 160)} |`);
      }
      out.push('');
    }
    return out.join('\n');
  }

  // 统计数字的计数条件(界面就近引用)
  const STAT_NOTES = {
    rows: '数据行:表头之后的每一行(含空行);行号以表头为第 1 行。',
    products: '商品数按不同 Handle(商品在店铺里的唯一网址名)计。',
    variants: '变体数(同一商品的不同规格)按含 SKU(库存单位编号)、价格、库存或选项值的数据行计。',
    blocks: '阻断:按问题条数计,同一个单元格触发多条规则会各算一条;出现任意一条,导入前都必须处理。',
    warns: '警告:同样按问题条数计;建议处理,但不一定导致导入失败。',
  };

  // 结论:只有检查完整完成(没有解析错误、有表头)且没有任何问题时才说「没有发现问题」
  function verdict(result, parsed) {
    const s = result.stats;
    const errs = (parsed && parsed.errors ? parsed.errors.length : 0);
    const noHeaders = !parsed || !parsed.headers || parsed.headers.length === 0;
    if (errs > 0 || noHeaders) {
      const why = errs > 0 ? `${errs} 处解析错误` : '没有读到表头';
      return { kind: 'incomplete', text: `检查未完成：${why}。已发现 ${s.blocks} 个阻断问题、${s.warns} 条警告，但出错位置之后的内容可能没有被检查。` };
    }
    if (s.blocks > 0) return { kind: 'block', text: `发现 ${s.blocks} 个阻断问题:导入前必须处理。另有 ${s.warns} 条警告。` };
    if (s.warns > 0) return { kind: 'warn', text: `没有阻断问题,但有 ${s.warns} 条警告,建议处理后再导入。` };
    return { kind: 'ok', text: '没有发现阻断问题,也没有警告(检查已完整完成)。' };
  }

  /* 选文件后、写入输入框前的检查:空文件、无法按 UTF-8 解码的文件(出现替换字符 U+FFFD)不能覆盖输入框里已有的内容 */
  function checkTextFile(text) {
    const s = String(text == null ? '' : text);
    if (s.trim() === '') return { ok: false, code: 'empty', message: '文件是空的,没有读到内容。' };
    if (s.indexOf('\uFFFD') !== -1) return { ok: false, code: 'encoding', message: '文件含无法识别的字符,可能不是 UTF-8 编码。请在表格软件里另存为「CSV UTF-8」后再试。' };
    return { ok: true, code: '', message: '' };
  }

  const api = { STAT_NOTES, verdict, RULES, LEVEL_LABEL, parseCsv, check, safeFix, toCsv, issuesToCsv, issuesToMarkdown, neutralizeFormula, checkTextFile };
  globalThis.CsvCheckCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
