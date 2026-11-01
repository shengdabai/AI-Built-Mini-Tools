'use strict';
(function () {
  const TYPES = ['文章', '课', '书', '视频', '代码库'];
  const FORMS = ['原发', '改写', '合集', '翻译', '口播'];
  const DEFAULT_CHANNELS = ['公众号', 'X', '邮件', '书', '课', '演讲', '其他'];
  // 只做数值有效性(有限、非负、安全整数范围),不设业务上限
  const MAXN = Number.MAX_SAFE_INTEGER;
  const REWRITE_ADVICE = {
    文章: '可改写成短帖或邮件,也可以合进一本合集。',
    课: '可拆成单讲文章,做成合集,或翻译成其他语言。',
    书: '可摘章节改写,做成合集,或出翻译。',
    视频: '可口播改写成文章,剪成合集,或加字幕翻译。',
    代码库: '可把 README 改写成文章,做成教程合集,或翻译文档。'
  };

  // ---------- 日期 ----------
  function dateParts(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const y = Number(s.slice(0, 4)), m = Number(s.slice(5, 7)), d = Number(s.slice(8, 10));
    const t = new Date(0); t.setUTCFullYear(y, m - 1, d);
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
    return { y, m, d, ms: t.getTime() };
  }
  const isDate = s => dateParts(s) !== null;
  const daysBetween = (a, b) => Math.round((dateParts(b).ms - dateParts(a).ms) / 86400000);
  const monthOf = s => s.slice(0, 7);
  const isMonth = s => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
  function shiftMonth(month, delta) {
    const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7)) - 1 + delta;
    const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12 + 1;
    return String(yy).padStart(4, '0') + '-' + String(mm).padStart(2, '0');
  }
  function localToday(now) {
    const d = now || new Date();
    return `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function resolveToday(search, now) {
    try {
      const q = new URLSearchParams(search || '').get('today');
      if (q && isDate(q)) return q;
    } catch (e) { /* 回退真实今天 */ }
    return localToday(now);
  }
  function monthRange(endMonth, n) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) out.push(shiftMonth(endMonth, -i));
    return out;
  }

  // ---------- 数字与金额 ----------
  const round2 = x => Math.round(x * 100) / 100;
  function parseHours(str) {
    const s = String(str ?? '').trim();
    if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false, error: '小时需要是不小于 0 的数字' };
    const n = Number(s);
    if (!Number.isFinite(n) || n > MAXN) return { ok: false, error: '小时数字过大,无法可靠计算' };
    return { ok: true, value: n };
  }
  function parseReach(str) {
    const s = String(str ?? '').trim();
    if (s === '') return { ok: true, value: null };
    if (!/^\d+$/.test(s)) return { ok: false, error: '触达需要是不小于 0 的整数,或留空' };
    const n = Number(s);
    if (!Number.isSafeInteger(n)) return { ok: false, error: '触达数字过大,无法可靠计算' };
    return { ok: true, value: n };
  }
  function parseYuan(str) {
    const s = String(str ?? '').trim();
    if (s === '') return { ok: true, value: null };
    const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
    if (!m) return { ok: false, error: '收入填元,最多两位小数,或留空' };
    const cents = Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0') || 0);
    if (!Number.isSafeInteger(cents)) return { ok: false, error: '收入金额过大,无法可靠计算' };
    return { ok: true, value: cents };
  }
  function fmtCents(c) {
    const neg = c < 0; const a = Math.abs(c);
    return (neg ? '-' : '') + Math.floor(a / 100) + '.' + String(a % 100).padStart(2, '0');
  }

  // ---------- 校验(写入与读取共用) ----------
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const okNum = (v, max) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
  const okInt = (v, max) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
  const okStr = v => typeof v === 'string' && v.trim().length > 0;
  const normalizeSaleRef = v => String(v ?? '').trim();
  const saleRefKey = v => normalizeSaleRef(v).toLowerCase();

  function validateResale(r, channels) {
    if (!isObj(r)) return '再售记录不是对象';
    if (!okStr(r.id)) return '再售记录缺少合法 id';
    if (!isDate(r.date)) return `再售日期不合法:${String(r.date)}`;
    if (typeof r.channel !== 'string' || !channels.includes(r.channel)) return `渠道不在渠道列表里:${String(r.channel)}`;
    if (!FORMS.includes(r.form)) return `形式不在枚举内:${String(r.form)}`;
    if (!okNum(r.extraHours, MAXN)) return '额外耗时需要是非负有限数字';
    if (!(r.reach === null || okInt(r.reach, MAXN))) return '触达需要是非负整数或空';
    if (!(r.revenueCents === null || okInt(r.revenueCents, MAXN))) return '收入需要是整数分或空';
    if (r.saleRef !== undefined && typeof r.saleRef !== 'string') return '交易引用需要是文字或留空';
    if (r.saleRef !== undefined && /[^\x20-\x7E]/.test(normalizeSaleRef(r.saleRef))) return '交易引用只接受可打印 ASCII 订单代号,不能含中文、重音字符或控制字符';
    return null;
  }
  function validateWork(w, channels) {
    if (!isObj(w)) return '作品不是对象';
    if (!okStr(w.id)) return '作品缺少合法 id';
    if (!okStr(w.title)) return '作品标题不能为空';
    if (!TYPES.includes(w.type)) return `作品类型不在枚举内:${String(w.type)}`;
    if (!isDate(w.createdOn)) return `创作日期不合法:${String(w.createdOn)}`;
    if (!okNum(w.hours, MAXN)) return '首次耗时需要是非负有限数字';
    if (!Array.isArray(w.resales)) return '作品缺少 resales 数组';
    for (const r of w.resales) { const e = validateResale(r, channels); if (e) return `「${w.title}」:${e}`; }
    return null;
  }
  function validateState(s) {
    if (!isObj(s)) return { ok: false, error: '数据不是对象' };
    if (!Array.isArray(s.channels)) return { ok: false, error: '缺少渠道列表 channels' };
    if (s.channels.length < 1) return { ok: false, error: '至少需要一个渠道' };
    const seenC = new Set();
    for (const c of s.channels) {
      if (!okStr(c) || c !== c.trim()) return { ok: false, error: '渠道名需要是非空、首尾无空格的文字' };
      if (seenC.has(c)) return { ok: false, error: `渠道重复:${c}` };
      seenC.add(c);
    }
    if (!Array.isArray(s.works)) return { ok: false, error: '缺少作品列表 works' };
    if (s.sample !== undefined && typeof s.sample !== 'boolean') return { ok: false, error: 'sample 必须是布尔值' };
    const ids = new Set();
    for (const w of s.works) {
      const e = validateWork(w, s.channels);
      if (e) return { ok: false, error: e };
      for (const id of [w.id, ...w.resales.map(r => r.id)]) {
        if (ids.has(id)) return { ok: false, error: `ID 重复:${id}` };
        ids.add(id);
      }
      const refs = new Set();
      for (const r of w.resales) {
        const ref = saleRefKey(r.saleRef);
        if (!ref) continue;
        const key = r.channel + '\u0000' + ref;
        if (refs.has(key)) return { ok: false, error: `「${w.title}」在渠道「${r.channel}」的交易引用重复:${normalizeSaleRef(r.saleRef)}` };
        refs.add(key);
      }
    }
    const state = {
      sample: s.sample === true,
      channels: s.channels.slice(),
      works: s.works.map(w => ({
        id: w.id, title: w.title, type: w.type, createdOn: w.createdOn, hours: w.hours,
        resales: w.resales.map(r => ({ id: r.id, date: r.date, channel: r.channel, form: r.form, extraHours: r.extraHours, reach: r.reach, revenueCents: r.revenueCents, saleRef: normalizeSaleRef(r.saleRef) }))
      }))
    };
    return { ok: true, state };
  }
  function validateImport(input) {
    let obj = input;
    if (typeof input === 'string') {
      try { obj = JSON.parse(input); } catch (e) { return { ok: false, error: 'JSON 解析失败:' + e.message }; }
    }
    if (!isObj(obj)) return { ok: false, error: '备份文件顶层需要是对象' };
    if (obj.app !== 'resale-ledger' || obj.version !== 1) return { ok: false, error: '不是本工具的备份文件(app 或 version 不符)' };
    return validateState(obj);
  }
  function toBackup(state) {
    const v = validateState(state);
    const clean = v.ok ? v.state : state;
    return JSON.stringify({ app: 'resale-ledger', version: 1, sample: clean.sample === true, channels: clean.channels, works: clean.works }, null, 2);
  }

  /* 修改作品/再售记录:保留 id 与其余记录;返回新 state,不改原对象 */
  function updateWork(state, id, fields) {
    const i = state.works.findIndex(w => w.id === id);
    if (i < 0) return { ok: false, error: '作品不存在' };
    const merged = Object.assign({}, state.works[i], fields, { id, resales: state.works[i].resales });
    const e = validateWork(merged, state.channels);
    if (e) return { ok: false, error: e };
    const works = state.works.slice();
    works[i] = merged;
    return { ok: true, state: Object.assign({}, state, { works }) };
  }
  function updateResale(state, workId, rid, fields) {
    const i = state.works.findIndex(w => w.id === workId);
    if (i < 0) return { ok: false, error: '作品不存在' };
    const j = state.works[i].resales.findIndex(r => r.id === rid);
    if (j < 0) return { ok: false, error: '再售记录不存在' };
    const merged = Object.assign({}, state.works[i].resales[j], fields, { id: rid });
    const e = validateResale(merged, state.channels);
    if (e) return { ok: false, error: e };
    const resales = state.works[i].resales.slice();
    resales[j] = merged;
    const works = state.works.slice();
    works[i] = Object.assign({}, state.works[i], { resales });
    const next = Object.assign({}, state, { works });
    const valid = validateState(next);
    return valid.ok ? { ok: true, state: valid.state } : valid;
  }

  let idSeq = 0;
  function newId(prefix) { idSeq += 1; return `${prefix}-${Date.now().toString(36)}${idSeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`; }

  // ---------- 指标 ----------
  const resaleCount = w => w.resales.length;
  const hoursTotal = w => w.hours + w.resales.reduce((a, r) => a + r.extraHours, 0);
  function perHour(w) { const h = hoursTotal(w); return h > 0 ? resaleCount(w) / h : null; }
  function revenueCents(w) {
    let any = false, sum = 0;
    for (const r of w.resales) if (r.revenueCents !== null) { any = true; sum += r.revenueCents; }
    return any ? sum : null;
  }
  function revenuePerHour(w) {
    const rev = revenueCents(w), h = hoursTotal(w);
    if (rev === null || !(h > 0)) return null;
    return Math.round(rev / h); // 整数分/小时
  }
  // 「无收入」与「耗时为 0 无法计算」是两种情况,文案不同
  function revenueLabel(w) {
    if (revenueCents(w) === null) return '无收入记录';
    const p = revenuePerHour(w);
    return p === null ? '耗时为 0,无法计算' : fmtCents(p);
  }
  // 账本是否还是初始状态(没有作品,渠道也是默认列表)
  function isPristine(state) {
    return state.works.length === 0 && state.channels.length === DEFAULT_CHANNELS.length && state.channels.every((c, i) => c === DEFAULT_CHANNELS[i]);
  }
  const reachTotal = w => w.resales.reduce((a, r) => a + (r.reach || 0), 0);

  // ---------- 可视化数据 ----------
  function heatmap(works, months) {
    const idx = new Map(months.map((m, i) => [m, i]));
    let max = 0;
    const rows = works.map(w => {
      const cells = months.map(() => 0);
      for (const r of w.resales) { const i = idx.get(monthOf(r.date)); if (i !== undefined) cells[i] += 1; }
      for (const c of cells) if (c > max) max = c;
      return { workId: w.id, title: w.title, cells };
    });
    const totals = months.map((_, i) => rows.reduce((a, row) => a + row.cells[i], 0));
    return { months: months.slice(), rows, max, totals };
  }
  function scatter(works) {
    return works.map(w => ({ id: w.id, title: w.title, type: w.type, hours: hoursTotal(w), count: resaleCount(w), reach: reachTotal(w) }));
  }
  function channelStats(works) {
    const map = new Map();
    let total = 0;
    for (const w of works) for (const r of w.resales) {
      total += 1;
      const e = map.get(r.channel) || { channel: r.channel, count: 0, reach: 0, revenueCents: null };
      e.count += 1; e.reach += r.reach || 0;
      if (r.revenueCents !== null) e.revenueCents = (e.revenueCents || 0) + r.revenueCents;
      map.set(r.channel, e);
    }
    return [...map.values()].map(e => ({ ...e, share: total ? e.count / total : 0 })).sort((a, b) => b.count - a.count || (a.channel < b.channel ? -1 : 1));
  }

  // ---------- 规则提示 ----------
  function hints(works, today) {
    const out = [];
    const haveToday = isDate(today);
    for (const w of works) {
      if (haveToday && resaleCount(w) === 1) {
        const days = daysBetween(w.createdOn, today);
        if (days > 90) out.push({ kind: 'rewrite', workId: w.id, title: w.title, days, text: `创作已 ${days} 天,只售过 1 次。${REWRITE_ADVICE[w.type]}` });
      }
      const seen = new Map();
      for (const r of w.resales) {
        if (normalizeSaleRef(r.saleRef)) continue;
        const key = [r.date, r.channel, r.form, r.extraHours, r.reach === null ? 'null' : r.reach, r.revenueCents === null ? 'null' : r.revenueCents].join('\u0000');
        const item = seen.get(key) || { n: 0, r };
        item.n += 1; seen.set(key, item);
      }
      for (const { n, r } of seen.values()) {
        if (n > 1) {
          out.push({ kind: 'duplicate', workId: w.id, title: w.title, channel: r.channel, date: r.date, n, text: `${r.date} 在「${r.channel}」有 ${n} 条完整字段相同且没有交易引用的记录,请检查是不是同一条记了两遍。` });
        }
      }
      for (const r of w.resales) {
        if (r.extraHours > w.hours) out.push({ kind: 'redo', workId: w.id, title: w.title, resaleId: r.id, date: r.date, text: `${r.date} 这条额外耗时 ${round2(r.extraHours)} 小时,超过首次的 ${round2(w.hours)} 小时:这不是复售,是重做。` });
      }
    }
    return out;
  }

  // ---------- 月报 ----------
  function monthly(works, month) {
    let newWorks = 0, resales = 0, hours = 0;
    for (const w of works) {
      if (monthOf(w.createdOn) === month) { newWorks += 1; hours += w.hours; }
      for (const r of w.resales) if (monthOf(r.date) === month) { resales += 1; hours += r.extraHours; }
    }
    return { month, newWorks, resales, hours, perHour: hours > 0 ? resales / hours : null };
  }
  function compare(a, b) {
    const d = (x, y) => (x === null || y === null ? null : x - y);
    return {
      newWorks: { a: a.newWorks, b: b.newWorks, delta: a.newWorks - b.newWorks },
      resales: { a: a.resales, b: b.resales, delta: a.resales - b.resales },
      perHour: { a: a.perHour, b: b.perHour, delta: d(a.perHour, b.perHour) }
    };
  }

  // ---------- 导出 ----------
  function guard(v) {
    const s = String(v ?? '');
    return s.length > 1 && /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  }
  function csvCell(v) {
    const s = guard(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(works, opts) {
    const sample = !!(opts && opts.sample);
    const head = ['标题', '类型', '创作日期', '首次耗时(小时)', '被售次数', '累计耗时(小时)', '每小时被售次数', '收入合计(元)', '每小时收入(元)', '交易引用'].concat(sample ? ['数据性质'] : []);
    const rows = works.map(w => {
      const ph = perHour(w), rev = revenueCents(w), rph = revenuePerHour(w);
      const refs = w.resales.map(r => normalizeSaleRef(r.saleRef)).filter(Boolean).join(' | ');
      return [w.title, w.type, w.createdOn, round2(w.hours), resaleCount(w), round2(hoursTotal(w)), ph === null ? '' : round2(ph), rev === null ? '' : fmtCents(rev), rph === null ? '' : fmtCents(rph), refs].concat(sample ? ['合成示例'] : []);
    });
    return [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
  const mdCell = v => guard(v).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const fmtPh = v => (v === null ? '无(本月没有耗时)' : round2(v).toString());
  function toMarkdown(works, month, today, opts) {
    const cur = monthly(works, month), prev = monthly(works, shiftMonth(month, -1)), cmp = compare(cur, prev);
    const sign = x => (x === null ? '无法比较' : (x > 0 ? '+' : '') + round2(x));
    const lines = [];
    lines.push(`# 写作复售月报 ${month}`, '', `生成日期:${today}。「被售」只是记录次数,不证明有人付费。`, '');
    if (opts && opts.sample) lines.push('> 合成示例,金额虚构:下面的作品、次数和金额都是演示数据,不是真实记录。', '');
    lines.push('| 指标 | 本月 | 上月 | 变化 |', '| --- | --- | --- | --- |');
    lines.push(`| 新作品数 | ${cmp.newWorks.a} | ${cmp.newWorks.b} | ${sign(cmp.newWorks.delta)} |`);
    lines.push(`| 复售次数 | ${cmp.resales.a} | ${cmp.resales.b} | ${sign(cmp.resales.delta)} |`);
    lines.push(`| 每小时被售次数 | ${fmtPh(cmp.perHour.a)} | ${fmtPh(cmp.perHour.b)} | ${sign(cmp.perHour.delta)} |`, '');
    lines.push('## 作品', '', '| 标题 | 类型 | 被售次数 | 累计耗时(小时) | 每小时被售次数 | 每小时收入(元) |', '| --- | --- | --- | --- | --- | --- |');
    for (const w of works) {
      const ph = perHour(w), rph = revenuePerHour(w);
      lines.push(`| ${mdCell(w.title)} | ${w.type} | ${resaleCount(w)} | ${round2(hoursTotal(w))} | ${ph === null ? '无' : round2(ph)} | ${revenueLabel(w)} |`);
    }
    lines.push('', '## 再售明细', '', '| 作品 | 日期 | 渠道 | 形式 | 交易引用 | 收入(元) |', '| --- | --- | --- | --- | --- | --- |');
    for (const w of works) for (const r of w.resales) {
      lines.push(`| ${mdCell(w.title)} | ${r.date} | ${mdCell(r.channel)} | ${r.form} | ${mdCell(normalizeSaleRef(r.saleRef)) || '未填'} | ${r.revenueCents === null ? '未填' : fmtCents(r.revenueCents)} |`);
    }
    lines.push('', '## 提示', '');
    const hs = hints(works, today);
    if (!hs.length) lines.push('- 暂无提示。');
    for (const h of hs) lines.push(`- 「${mdCell(h.title)}」${h.text}`);
    return lines.join('\n') + '\n';
  }

  const api = {
    TYPES, FORMS, DEFAULT_CHANNELS, REWRITE_ADVICE,
    isDate, daysBetween, monthOf, isMonth, shiftMonth, monthRange, resolveToday, localToday,
    parseHours, parseReach, parseYuan, fmtCents, round2, normalizeSaleRef, saleRefKey,
    validateState, validateImport, validateWork, validateResale, toBackup, newId, updateWork, updateResale,
    resaleCount, hoursTotal, perHour, revenueCents, revenuePerHour, revenueLabel, isPristine, reachTotal,
    heatmap, scatter, channelStats, hints, monthly, compare, toCsv, toMarkdown, guard
  };
  globalThis.ResaleCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
