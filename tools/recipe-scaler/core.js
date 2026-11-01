'use strict';
/* 配方缩放器核心逻辑:纯函数,无 DOM。有理数用 BigInt 精确计算。 */
(function () {
  // ---------- 有理数 ----------
  function bgcd(a, b) { if (a < 0n) a = -a; if (b < 0n) b = -b; while (b) { const t = a % b; a = b; b = t; } return a; }
  function mk(n, d) {
    if (d === 0n) return null;
    if (d < 0n) { n = -n; d = -d; }
    const g = bgcd(n, d) || 1n;
    return { n: n / g, d: d / g };
  }
  const rmul = (a, b) => mk(a.n * b.n, a.d * b.d);
  const rdiv = (a, b) => (b.n === 0n ? null : mk(a.n * b.d, a.d * b.n));
  const rnum = r => Number(r.n) / Number(r.d);
  const rge = (r, k) => r.n >= BigInt(k) * r.d;
  const rlt = (r, k) => r.n < BigInt(k) * r.d;
  const ONE = mk(1n, 1n);

  function decRat(str) {
    const parts = str.split('.');
    const frac = (parts[1] || '').slice(0, 6);
    const scale = 10n ** BigInt(frac.length);
    return mk(BigInt(parts[0] || '0') * scale + BigInt(frac || '0'), scale);
  }
  function numToRat(x) {
    if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1e12) return null;
    return decRat(x.toFixed(6));
  }

  // ---------- 单位 ----------
  const UNIT_INFO = Object.create(null);
  UNIT_INFO.g = { dim: 'mass', f: mk(1n, 1n) };
  UNIT_INFO.kg = { dim: 'mass', f: mk(1000n, 1n) };
  UNIT_INFO.mg = { dim: 'mass', f: mk(1n, 1000n) };
  UNIT_INFO.mL = { dim: 'volume', f: mk(1n, 1n) };
  UNIT_INFO.L = { dim: 'volume', f: mk(1000n, 1n) };
  ['个', '片', '颗', '只', '根', '条', '块', '包', '袋', '粒', '瓣'].forEach(u => { UNIT_INFO[u] = { dim: 'count' }; });
  ['杯', '汤匙', '茶匙', '勺', '撮', '滴'].forEach(u => { UNIT_INFO[u] = { dim: 'measure' }; });
  const UNITS = Object.keys(UNIT_INFO).concat(['']);
  const YIELD_UNITS = ['份', '个', '片', '块', '条', 'g', 'kg', 'mL', 'L'];
  const ALIAS = Object.create(null);
  Object.entries({
    '克': 'g', 'g': 'g', '千克': 'kg', '公斤': 'kg', 'kg': 'kg', '毫克': 'mg', 'mg': 'mg',
    '毫升': 'mL', 'ml': 'mL', 'cc': 'mL', '升': 'L', '公升': 'L', 'l': 'L',
    '個': '个', '汤匙': '汤匙', '大勺': '汤匙', '大匙': '汤匙', 'tbsp': '汤匙', '茶匙': '茶匙', '小勺': '茶匙', '小匙': '茶匙', 'tsp': '茶匙',
    'cup': '杯', 'cups': '杯'
  }).forEach(([k, v]) => { ALIAS[k] = v; });
  function normalizeUnit(u) {
    const s = String(u == null ? '' : u).trim();
    if (s === '') return '';
    if (UNIT_INFO[s]) return s;
    const a = ALIAS[s.toLowerCase()];
    return a === undefined ? null : a;
  }
  const dimOf = u => (UNIT_INFO[u] ? UNIT_INFO[u].dim : 'other');

  // ---------- 文本规范化与数量解析 ----------
  const VULGAR = { '½': '1/2', '¼': '1/4', '¾': '3/4', '⅓': '1/3', '⅔': '2/3', '⅛': '1/8' };
  const CN = { '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
  function normalize(t) {
    let s = String(t == null ? '' : t).replace(/[½¼¾⅓⅔⅛]/g, m => ' ' + VULGAR[m] + ' ');
    s = s.normalize('NFKC').replace(/⁄/g, '/').replace(/\s+/g, ' ').trim();
    return s;
  }
  function parseNum(s) {
    s = s.trim();
    if (!s || s.length > 30) return null;
    if (s === '半' || s === '一半') return mk(1n, 2n);
    if (Object.prototype.hasOwnProperty.call(CN, s)) return mk(BigInt(CN[s]), 1n);
    let m = /^(\d{1,12})\s+(\d{1,6})\/(\d{1,6})$/.exec(s);
    if (m) { const d = BigInt(m[3]); return d === 0n ? null : mk(BigInt(m[1]) * d + BigInt(m[2]), d); }
    m = /^(\d{1,12})\/(\d{1,6})$/.exec(s);
    if (m) { const d = BigInt(m[2]); return d === 0n ? null : mk(BigInt(m[1]), d); }
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
    if (/^(?:\d{1,12}(?:\.\d{1,9})?|\.\d{1,9})$/.test(s)) return decRat(s);
    return null;
  }
  const RANGE_SPLIT = /\s*(?:[-–—~]|到|至)\s*/;

  function formatRat(r, format, maxDec) {
    if (!r) return '';
    maxDec = maxDec == null ? 2 : maxDec;
    const whole = r.n / r.d;
    const rem = r.n % r.d;
    if (rem === 0n) return whole.toString();
    if (format === 'fraction' && r.d <= 16n) return whole === 0n ? rem + '/' + r.d : whole + ' ' + rem + '/' + r.d;
    const v = rnum(r);
    let s = v.toFixed(maxDec);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    if (s === '0' || s === '') return v > 0 ? '<0.01' : '0';
    return s;
  }

  function parseQuantity(text) {
    const raw = String(text == null ? '' : text).trim();
    const s = normalize(raw);
    if (!s) return { kind: 'text', display: '' };
    const parts = s.split(RANGE_SPLIT);
    if (parts.length === 2) {
      const lo = parseNum(parts[0]);
      const hi = parseNum(parts[1]);
      if (lo && hi && rnum(lo) <= rnum(hi)) {
        return { kind: 'range', min: rnum(lo), max: rnum(hi), rmin: lo, rmax: hi, display: formatRat(lo) + '–' + formatRat(hi) };
      }
    }
    const one = parseNum(s);
    if (one) return { kind: 'number', value: rnum(one), r: one, display: formatRat(one) };
    return { kind: 'text', display: raw };
  }

  // ---------- 配料行解析 ----------
  const TEXT_QTY = ['适量', '少许', '若干', '按需', '适当', '一小撮', '一点', '少量'];
  const NUMPAT = '(?:\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d+(?:\\.\\d+)?|\\.\\d+|一半|半)';
  const QTYPAT = NUMPAT + '(?:\\s*(?:[-–—~]|到|至)\\s*' + NUMPAT + ')?';
  const unitNames = Array.from(new Set(Object.keys(UNIT_INFO).concat(Object.keys(ALIAS)))).sort((a, b) => b.length - a.length)
    .map(u => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const RE_TAIL = new RegExp('^(.+?)\\s*[:：]?\\s*(' + QTYPAT + ')\\s*(' + unitNames + ')?\\s*$', 'i');
  const RE_HEAD = new RegExp('^(' + QTYPAT + ')\\s*(' + unitNames + ')?\\s+(.+)$', 'i');
  const RE_SPLIT = new RegExp('^(' + QTYPAT + ')\\s*(.*)$');

  function parseIngredients(text) {
    const items = [];
    const warnings = [];
    const lines = String(text == null ? '' : text).split(/\r?\n/);
    let count = 0;
    lines.forEach((line, idx) => {
      const lineNo = idx + 1;
      const t = line.replace(/｜/g, '|').trim();
      if (!t) return;
      if (count >= 200) { if (count === 200) warnings.push({ line: lineNo, reason: '最多 200 行配料,之后的行已忽略' }); count++; return; }
      let name = '', qtyText = '', unitRaw = '', note = '';
      if (/[|\t]/.test(t)) {
        const p = t.split(/[|\t]/).map(x => x.trim());
        name = p[0]; qtyText = p[1] || ''; unitRaw = p[2] || ''; note = p.slice(3).filter(Boolean).join(' / ');
        if (!unitRaw && qtyText) {
          const m = RE_SPLIT.exec(normalize(qtyText));
          if (m && m[2]) { qtyText = m[1]; unitRaw = m[2]; }
        }
      } else {
        const n = normalize(t);
        let m = RE_TAIL.exec(n);
        if (m) { name = m[1]; qtyText = m[2]; unitRaw = m[3] || ''; }
        else if ((m = RE_HEAD.exec(n))) { qtyText = m[1]; unitRaw = m[2] || ''; name = m[3]; }
        else {
          const sp = n.lastIndexOf(' ');
          const tail = sp > 0 ? n.slice(sp + 1) : '';
          if (TEXT_QTY.indexOf(tail) >= 0) { name = n.slice(0, sp).trim(); qtyText = tail; }
          else { name = n; }
        }
      }
      name = name.trim();
      if (!name) { warnings.push({ line: lineNo, reason: '缺少配料名称,已忽略这一行' }); return; }
      const unit = normalizeUnit(unitRaw);
      let finalUnit = unit;
      if (unit === null) {
        finalUnit = '';
        warnings.push({ line: lineNo, reason: '单位「' + unitRaw + '」未识别,已记入备注并按无单位处理' });
        note = ('单位:' + unitRaw + (note ? ' / ' + note : ''));
      }
      if (!qtyText) warnings.push({ line: lineNo, reason: '「' + name + '」没有数量,按「不缩放」处理' });
      items.push({ name: name.slice(0, 80), qtyText: qtyText.slice(0, 40), unit: finalUnit, note: note.slice(0, 200) });
      count++;
    });
    return { items, warnings };
  }

  function ingredientsToText(items) {
    return (items || []).map(i => [i.name, i.qtyText, i.unit, i.note].join(' | ').replace(/( \| )+$/, '')).join('\n');
  }

  // ---------- 因子 ----------
  function toRatInput(x) {
    if (x && typeof x === 'object' && typeof x.n === 'bigint') return x;
    if (typeof x === 'number') return numToRat(x);
    if (typeof x === 'string') { const q = parseQuantity(x); return q.kind === 'number' ? q.r : null; }
    return null;
  }
  function makeFactor(r) {
    if (!r || r.n <= 0n) return { ok: false, reason: '倍数必须大于 0' };
    if (rnum(r) > 1e6) return { ok: false, reason: '倍数过大(超过 100 万倍)' };
    return { ok: true, factor: { n: r.n, d: r.d, value: rnum(r), text: formatRat(r, 'decimal', 3) } };
  }
  function factorFromServings(orig, target) {
    const o = toRatInput(orig), t = toRatInput(target);
    if (!o || o.n === 0n) return { ok: false, reason: '原始份数必须大于 0' };
    if (!t || t.n === 0n) return { ok: false, reason: '目标份数必须大于 0' };
    return makeFactor(rdiv(t, o));
  }
  function factorFromIngredient(recipe, name, target, targetUnit) {
    const ing = ((recipe && recipe.ingredients) || []).find(i => i.name === name);
    if (!ing) return { ok: false, reason: '找不到配料「' + name + '」' };
    const q = parseQuantity(ing.qtyText);
    if (q.kind !== 'number') return { ok: false, reason: '「' + name + '」不是单一数值,不能用来反推倍数' };
    if (q.r.n === 0n) return { ok: false, reason: '「' + name + '」的原始数量为 0,无法反推倍数' };
    const t = toRatInput(target);
    if (!t || t.n === 0n) return { ok: false, reason: '目标数量必须大于 0' };
    const iu = normalizeUnit(ing.unit);
    const tu = targetUnit == null || targetUnit === '' ? iu : normalizeUnit(targetUnit);
    if (tu === null || iu === null) return { ok: false, reason: '单位无法识别' };
    let tv = t;
    if (tu !== iu) {
      const a = UNIT_INFO[tu], b = UNIT_INFO[iu];
      if (!a || !b || a.dim !== b.dim || !a.f || !b.f) return { ok: false, reason: '目标单位「' + tu + '」与原配料单位「' + iu + '」不能互换(本版不做容积与质量换算)' };
      tv = rdiv(rmul(t, a.f), b.f);
    }
    return makeFactor(rdiv(tv, q.r));
  }

  // ---------- 单位升降 ----------
  function autoUnitPlan(v, unit) {
    let u = unit, mult = ONE;
    if (v.n === 0n) return { unit: u, mult };
    const step = (to, f) => { v = rmul(v, f); mult = rmul(mult, f); u = to; };
    const down = mk(1n, 1000n), up = mk(1000n, 1n);
    if (u === 'mg' && rge(v, 1000)) step('g', down);
    if (u === 'g' && rge(v, 1000)) step('kg', down);
    else if (u === 'kg' && rlt(v, 1)) step('g', up);
    if (u === 'mL' && rge(v, 1000)) step('L', down);
    else if (u === 'L' && rlt(v, 1)) step('mL', up);
    return { unit: u, mult };
  }
  function autoUnit(value, unit) {
    const r = toRatInput(value);
    const u = normalizeUnit(unit);
    if (!r || u === null) return { value, unit };
    const plan = autoUnitPlan(r, u);
    const out = rmul(r, plan.mult);
    return { value: rnum(out), unit: plan.unit, converted: plan.unit !== u };
  }

  // ---------- 缩放 ----------
  const roundRat = r => mk((2n * r.n + r.d) / (2n * r.d), 1n);

  function scaleQty(q, unit, factor, opts) {
    let a = rmul(q.kind === 'number' ? q.r : q.rmin, factor);
    let b = q.kind === 'range' ? rmul(q.rmax, factor) : null;
    let u = unit;
    if (opts.autoUnit) {
      const plan = autoUnitPlan(b || a, u);
      if (plan.unit !== u) { a = rmul(a, plan.mult); if (b) b = rmul(b, plan.mult); u = plan.unit; }
    }
    return { a, b, unit: u };
  }
  const fmtPair = (a, b, fmt) => (b ? formatRat(a, fmt) + '–' + formatRat(b, fmt) : formatRat(a, fmt));
  const join = (qty, unit) => (unit ? qty + ' ' + unit : qty);

  function scale(recipe, factorIn, options) {
    const opts = Object.assign({ autoUnit: true, format: 'decimal' }, options || {});
    const fr = factorIn && factorIn.ok !== undefined ? factorIn : makeFactor(toRatInput(factorIn && factorIn.factor ? factorIn.factor : factorIn));
    if (!fr.ok) return { ok: false, reason: fr.reason };
    const f = fr.factor;
    const fmt = opts.format === 'fraction' ? 'fraction' : 'decimal';
    const items = ((recipe && recipe.ingredients) || []).map(ing => {
      const q = parseQuantity(ing.qtyText);
      const unit = normalizeUnit(ing.unit) || '';
      const base = { name: ing.name, note: ing.note || '', origText: join(q.display, unit) };
      if (q.kind === 'text') {
        return Object.assign(base, { kind: 'text', scaled: false, qtyText: q.display, unit: '', text: q.display, roundedText: null });
      }
      const s = scaleQty(q, unit, f, opts);
      const qtyText = fmtPair(s.a, s.b, fmt);
      let roundedText = null;
      if (dimOf(s.unit) === 'count') {
        const ra = roundRat(s.a), rb = s.b ? roundRat(s.b) : null;
        const rt = fmtPair(ra, rb, 'decimal');
        if (rt !== fmtPair(s.a, s.b, 'decimal')) roundedText = join(rt, s.unit);
      }
      return Object.assign(base, { kind: q.kind, scaled: true, qtyText, unit: s.unit, text: join(qtyText, s.unit), roundedText });
    });
    const yq = { kind: 'number', r: numToRat(recipe && recipe.yieldAmount) || ONE };
    const yu = (recipe && recipe.yieldUnit) || '份';
    const ys = scaleQty(yq, yu, f, opts);
    return {
      ok: true,
      name: (recipe && recipe.name) || '',
      factor: f,
      yieldOrig: join(formatRat(yq.r, fmt), yu),
      yieldText: join(formatRat(ys.a, fmt), ys.unit),
      notes: (recipe && recipe.notes) || '',
      items
    };
  }

  // ---------- 烘焙百分比 ----------
  function massGrams(q, unit) {
    const info = UNIT_INFO[unit];
    if (!info || info.dim !== 'mass') return null;
    return {
      a: rmul(q.kind === 'number' ? q.r : q.rmin, info.f),
      b: q.kind === 'range' ? rmul(q.rmax, info.f) : null
    };
  }
  const pctText = (v, digits) => {
    const s = v.toFixed(digits);
    return (s.indexOf('.') >= 0 ? s.replace(/0+$/, '').replace(/\.$/, '') : s) + '%';
  };
  function bakersPercent(recipe, baseName) {
    const list = (recipe && recipe.ingredients) || [];
    const baseIng = list.find(i => i.name === baseName);
    if (!baseName || !baseIng) return { ok: false, reason: '请先选择基准配料(通常是面粉)', rows: [] };
    const bq = parseQuantity(baseIng.qtyText);
    const bu = normalizeUnit(baseIng.unit);
    if (bq.kind !== 'number') return { ok: false, reason: '基准配料必须是单一数值', rows: [] };
    const bg = massGrams(bq, bu);
    if (!bg) return { ok: false, reason: '基准配料必须使用质量单位(g、kg、mg)', rows: [] };
    if (bg.a.n === 0n) return { ok: false, reason: '基准配料的重量为 0,无法计算百分比', rows: [] };
    const rows = list.map(ing => {
      const q = parseQuantity(ing.qtyText);
      const u = normalizeUnit(ing.unit);
      const row = { name: ing.name, percent: null, min: null, max: null, text: '—', reason: '' };
      if (q.kind === 'text') { row.reason = '不缩放的配料,无百分比'; return row; }
      const g = massGrams(q, u);
      if (!g) { row.reason = dimOf(u) === 'volume' ? '容积单位不换算成质量' : '非质量单位,无百分比'; return row; }
      const p = rmul(rdiv(g.a, bg.a), mk(100n, 1n));
      if (g.b) {
        const p2 = rmul(rdiv(g.b, bg.a), mk(100n, 1n));
        row.min = rnum(p); row.max = rnum(p2);
        row.text = pctText(row.min, 1).replace('%', '') + '–' + pctText(row.max, 1);
      } else {
        row.percent = rnum(p);
        row.text = pctText(row.percent, 1);
      }
      return row;
    });
    return { ok: true, base: { name: baseName, grams: rnum(bg.a) }, rows };
  }

  function parsePercentLines(text) {
    const items = [], errors = [];
    String(text == null ? '' : text).split(/\r?\n/).forEach((line, idx) => {
      const t = line.replace(/｜/g, '|').trim();
      if (!t) return;
      let name, num;
      if (/[|\t]/.test(t)) { const p = t.split(/[|\t]/).map(x => x.trim()); name = p[0]; num = p[1] || ''; }
      else { const sp = t.lastIndexOf(' '); name = sp > 0 ? t.slice(0, sp).trim() : t; num = sp > 0 ? t.slice(sp + 1) : ''; }
      const q = parseQuantity(String(num).replace(/[%％]\s*$/, ''));
      if (!name) { errors.push('第 ' + (idx + 1) + ' 行缺少名称'); return; }
      if (q.kind !== 'number') { errors.push('第 ' + (idx + 1) + ' 行「' + name + '」的百分比无法识别'); return; }
      items.push({ name: name.slice(0, 80), percent: q.value });
    });
    return { items, errors };
  }

  function fromPercent(percents, baseWeight) {
    const errors = [];
    const bw = toRatInput(baseWeight);
    if (!bw || bw.n === 0n) errors.push('基准重量必须大于 0');
    if (!Array.isArray(percents) || percents.length === 0) errors.push('至少需要一行配料和百分比');
    let baseName = '';
    (percents || []).forEach(p => {
      if (!p || typeof p.name !== 'string' || !p.name.trim()) errors.push('存在没有名称的行');
      else if (typeof p.percent !== 'number' || !Number.isFinite(p.percent) || p.percent < 0) errors.push('「' + p.name + '」的百分比不合法');
      else if (!baseName && p.percent === 100) baseName = p.name;
    });
    if (!baseName && errors.length === 0) errors.push('需要有一行百分比为 100 的基准配料');
    if (errors.length) return { ok: false, errors, items: [], baseName: '' };
    const items = percents.map(p => {
      const pr = numToRat(p.percent);
      const g = rdiv(rmul(pr, bw), mk(100n, 1n));
      return { name: p.name.trim().slice(0, 80), qtyText: formatRat(g, 'decimal', 2), unit: 'g', note: '' };
    });
    return { ok: true, errors: [], items, baseName };
  }

  // ---------- 导出 ----------
  function guardCell(s) {
    s = String(s == null ? '' : s);
    return /^[=+\-@]/.test(s) && s !== '-' && s !== '+' ? "'" + s : s;
  }
  function csvCell(s) {
    s = guardCell(s);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(scaled) {
    const rows = [['名称', '数量', '单位', '取整数量', '备注', '是否缩放']];
    ((scaled && scaled.items) || []).forEach(i => {
      rows.push([i.name, i.qtyText, i.unit, i.roundedText || '', i.note, i.scaled ? '是' : '否(原样保留)']);
    });
    return rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
  const mdCell = s => guardCell(String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' '));
  function toMarkdown(scaled) {
    if (!scaled || !scaled.ok) return '';
    const head = String(scaled.name || '未命名配方').replace(/\r?\n/g, ' ');
    const out = ['# ' + head + '(×' + scaled.factor.text + ')', '', '- 产量:原 ' + scaled.yieldOrig + ' → 现 ' + scaled.yieldText, '', '## 配料', ''];
    if (scaled.items.length === 0) out.push('(没有配料)');
    else {
      out.push('| 配料 | 数量 | 备注 |', '|---|---|---|');
      scaled.items.forEach(i => {
        const qty = i.roundedText ? i.text + '(取整 ' + i.roundedText + ')' : (i.text || '—');
        const note = (i.note || '') + (i.scaled ? '' : (i.note ? ';' : '') + '不缩放');
        out.push('| ' + mdCell(i.name) + ' | ' + mdCell(qty) + ' | ' + mdCell(note) + ' |');
      });
    }
    if (scaled.notes) out.push('', '## 备注', '', String(scaled.notes).replace(/\r?\n/g, '\n'));
    out.push('', '> 提示:烘焙时间和温度不会随份数自动缩放,请按实际的模具、锅具和烤箱调整。');
    return out.join('\n') + '\n';
  }

  // ---------- 备份与校验 ----------
  let seq = 0;
  function newId() { seq += 1; return 'r' + Date.now().toString(36) + seq.toString(36) + Math.random().toString(36).slice(2, 6); }
  function emptyRecipe() { return { id: newId(), name: '', yieldAmount: 1, yieldUnit: '份', baseName: '', notes: '', ingredients: [] }; }
  function makeBackup(recipes) { return { app: 'recipe-scaler', version: 1, exportedAt: new Date().toISOString().slice(0, 10), recipes }; }

  function parseYield(text) {
    const q = parseQuantity(text);
    if (q.kind !== 'number' || q.r.n === 0n) return { ok: false, reason: '原始产量必须是大于 0 的数字(可写 8、1/2、1 1/2)' };
    return { ok: true, value: q.value };
  }

  // 自动保存、导出备份、导入备份共用同一份契约:名称可以为空(草稿),类型和长度仍严格校验。
  // opts 参数仅为兼容旧调用,不再改变行为。
  function validateImport(input) {
    let data = input;
    if (typeof input === 'string') {
      try { data = JSON.parse(input); } catch (e) { return { ok: false, errors: ['不是合法的 JSON 文件'] }; }
    }
    const errors = [];
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, errors: ['文件顶层必须是对象'] };
    if (data.app !== 'recipe-scaler') errors.push('app 字段必须是 recipe-scaler');
    if (data.version !== 1) errors.push('version 必须是 1');
    if (!Array.isArray(data.recipes)) { errors.push('recipes 必须是数组'); return { ok: false, errors }; }
    if (data.recipes.length > 500) errors.push('配方数量超过 500');
    const ids = new Set();
    const recipes = [];
    const isStr = (v, max, allowEmpty) => typeof v === 'string' && v.length <= max && (allowEmpty || v.trim().length > 0);
    data.recipes.forEach((r, idx) => {
      const tag = '配方 #' + (idx + 1);
      if (!r || typeof r !== 'object' || Array.isArray(r)) { errors.push(tag + ':必须是对象'); return; }
      if (!isStr(r.id, 80)) errors.push(tag + ':id 必须是 1-80 字的字符串');
      else if (ids.has(r.id)) errors.push(tag + ':id「' + r.id + '」重复');
      else ids.add(r.id);
      if (!isStr(r.name, 120, true)) errors.push(tag + ':name 必须是不超过 120 字的字符串(可为空)');
      if (typeof r.yieldAmount !== 'number' || !Number.isFinite(r.yieldAmount) || r.yieldAmount <= 0 || r.yieldAmount > 1e9) errors.push(tag + ':yieldAmount 必须是大于 0 的数字');
      if (YIELD_UNITS.indexOf(r.yieldUnit) < 0) errors.push(tag + ':yieldUnit 必须是 ' + YIELD_UNITS.join('、') + ' 之一');
      if (!isStr(r.baseName, 80, true)) errors.push(tag + ':baseName 必须是字符串');
      if (r.notes !== undefined && !isStr(r.notes, 2000, true)) errors.push(tag + ':notes 必须是不超过 2000 字的字符串');
      if (!Array.isArray(r.ingredients) || r.ingredients.length > 200) { errors.push(tag + ':ingredients 必须是不超过 200 项的数组'); return; }
      const clean = [];
      r.ingredients.forEach((g, gi) => {
        const gt = tag + ' 第 ' + (gi + 1) + ' 项配料';
        if (!g || typeof g !== 'object' || Array.isArray(g)) { errors.push(gt + ':必须是对象'); return; }
        if (!isStr(g.name, 80)) errors.push(gt + ':name 必须是 1-80 字的字符串');
        if (!isStr(g.qtyText, 40, true)) errors.push(gt + ':qtyText 必须是不超过 40 字的字符串');
        if (typeof g.unit !== 'string' || UNITS.indexOf(g.unit) < 0) errors.push(gt + ':单位「' + String(g.unit) + '」不在允许的单位列表中');
        if (!isStr(g.note, 200, true)) errors.push(gt + ':note 必须是不超过 200 字的字符串');
        clean.push({ name: g.name, qtyText: g.qtyText, unit: g.unit, note: g.note });
      });
      if (isStr(r.baseName, 80, true) && r.baseName !== '' && !clean.some(g => g.name === r.baseName)) errors.push(tag + ':baseName「' + r.baseName + '」不在配料中');
      recipes.push({ id: r.id, name: r.name, yieldAmount: r.yieldAmount, yieldUnit: r.yieldUnit, baseName: r.baseName, notes: r.notes || '', ingredients: clean });
    });
    if (errors.length) return { ok: false, errors: errors.slice(0, 12) };
    return { ok: true, errors: [], value: { recipes } };
  }

  // 导入预览:只计算新增与覆盖,不修改现有数据
  function importPlan(existing, incoming) {
    const byId = new Map(existing.map(r => [r.id, r]));
    const added = [], replaced = [];
    incoming.forEach(r => {
      const old = byId.get(r.id);
      if (old) replaced.push({ id: r.id, oldName: old.name, newName: r.name }); else added.push({ id: r.id, name: r.name });
    });
    return { added, replaced };
  }

  const api = {
    UNITS, YIELD_UNITS, normalizeUnit, formatRat, parseQuantity, parseIngredients, ingredientsToText,
    scale, factorFromServings, factorFromIngredient, autoUnit, bakersPercent, parsePercentLines, fromPercent,
    toMarkdown, toCsv, guardCell, parseYield, validateImport, importPlan, makeBackup, emptyRecipe, newId
  };
  globalThis.RecipeCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
