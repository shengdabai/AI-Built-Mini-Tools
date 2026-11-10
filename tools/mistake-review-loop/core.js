/* 错题回环 core.js — 纯逻辑，无 DOM。
 * 包含：错误类型规则分类、逐字差异、SM-2 排期、到期队列、统计、批量解析、Anki CSV 与 JSON 备份。
 * 所有日期均为 'YYYY-MM-DD' 字符串，涉及「今天」的函数都显式接收 today 参数。
 */
(function () {
  'use strict';

  // ---------- 错误类型 ----------
  var TAGS = [
    { id: 'measure', label: '量词错误' },
    { id: 'order', label: '语序' },
    { id: 'aspect', label: '了/过/着 体标记' },
    { id: 'de', label: '的/地/得 混用' },
    { id: 'missing', label: '缺字' },
    { id: 'extra', label: '多字' },
    { id: 'typo', label: '错别字' },
    { id: 'other', label: '其他' }
  ];
  var TAG_IDS = TAGS.map(function (t) { return t.id; });

  var MEASURE_WORDS = new Set(Array.from(
    '个本张条只位件把支辆台块杯瓶双顶头匹棵朵座间家封部首篇口名场次片份碗节对套盒包枝根颗粒层所架艘副幅辆趟遍顿斤里米'
  ));
  // 量词前常见的数词/指示词（用于判断「漏写/多写的是量词」）
  var MEASURE_CONTEXT = new Set(Array.from('一二三四五六七八九十百千万两几这那每哪半整'));
  var ASPECT = new Set(Array.from('了过着'));
  var DE = new Set(Array.from('的地得'));

  var PUNCT_RE = /[\s，。、！？；：“”‘’「」『』（）《》【】…—·,.!?;:'"()\[\]<>\-~`]/g;

  function tagLabel(id) {
    for (var i = 0; i < TAGS.length; i++) if (TAGS[i].id === id) return TAGS[i].label;
    return '其他';
  }

  function isTag(id) { return TAG_IDS.indexOf(id) !== -1; }

  function normalize(s) {
    return String(s == null ? '' : s).replace(PUNCT_RE, '');
  }

  // ---------- 逐字差异（LCS） ----------
  var MAX_DIFF_LEN = 400;

  function charDiff(a, b) {
    var A = Array.from(String(a == null ? '' : a));
    var B = Array.from(String(b == null ? '' : b));
    if (A.length > MAX_DIFF_LEN || B.length > MAX_DIFF_LEN) {
      return [{ type: 'del', text: A.join('') }, { type: 'ins', text: B.join('') }].filter(function (p) { return p.text; });
    }
    var n = A.length, m = B.length;
    var dp = [];
    for (var i = 0; i <= n; i++) { dp.push(new Array(m + 1).fill(0)); }
    for (i = n - 1; i >= 0; i--) {
      for (var j = m - 1; j >= 0; j--) {
        dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    var ops = [];
    function push(type, ch) {
      var last = ops[ops.length - 1];
      if (last && last.type === type) last.text += ch; else ops.push({ type: type, text: ch });
    }
    i = 0; j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { push('eq', A[i]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', A[i]); i++; }
      else { push('ins', B[j]); j++; }
    }
    while (i < n) { push('del', A[i]); i++; }
    while (j < m) { push('ins', B[j]); j++; }
    return ops;
  }

  // 把连续的非相等片段合并为一次「编辑」，并记录其前一个字符（上下文）
  function edits(a, b) {
    var ops = charDiff(a, b);
    var out = [];
    var cur = null;
    var prevChar = '';
    ops.forEach(function (op) {
      if (op.type === 'eq') {
        if (cur) { out.push(cur); cur = null; }
        var chars = Array.from(op.text);
        prevChar = chars[chars.length - 1];
      } else {
        if (!cur) cur = { del: '', ins: '', before: prevChar };
        cur[op.type] += op.text;
      }
    });
    if (cur) out.push(cur);
    return out;
  }

  function sortedChars(s) { return Array.from(s).sort().join(''); }
  function allIn(s, set) { return Array.from(s).every(function (c) { return set.has(c); }); }

  function isMeasureEdit(e) {
    var d = Array.from(e.del), n = Array.from(e.ins);
    if (d.length === 1 && n.length === 1) return MEASURE_WORDS.has(d[0]) && MEASURE_WORDS.has(n[0]);
    var only = d.length === 0 && n.length === 1 ? n[0] : (n.length === 0 && d.length === 1 ? d[0] : null);
    return !!only && MEASURE_WORDS.has(only) && MEASURE_CONTEXT.has(e.before);
  }

  /** 对比错句与正确句，返回错误类型 id（确定性规则）。 */
  function classify(wrong, correct) {
    var w = normalize(wrong), c = normalize(correct);
    if (!w || !c || w === c) return 'other';
    if (sortedChars(w) === sortedChars(c)) return 'order';
    var es = edits(w, c);
    if (es.every(function (e) { return e.del.length === 1 && e.ins.length === 1 && DE.has(e.del) && DE.has(e.ins); })) return 'de';
    if (es.every(function (e) { return allIn(e.del, ASPECT) && allIn(e.ins, ASPECT); })) return 'aspect';
    if (es.every(isMeasureEdit)) return 'measure';
    if (es.every(function (e) { return Array.from(e.del).length === 1 && Array.from(e.ins).length === 1; })) return 'typo';
    if (es.every(function (e) { return !e.del && e.ins; })) return 'missing';
    if (es.every(function (e) { return e.del && !e.ins; })) return 'extra';
    return 'other';
  }

  /** 片段是否只含标点/空白（复习对比时不把漏写句号算作错误）。 */
  function isPunctOnly(s) { return String(s || '').length > 0 && normalize(s) === ''; }

  function isCorrectAnswer(answer, correct) {
    var a = normalize(answer);
    return a.length > 0 && a === normalize(correct);
  }

  // ---------- 日期 ----------
  var ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  function parseISO(iso) {
    var m = ISO_RE.exec(String(iso));
    if (!m) throw new Error('日期格式应为 YYYY-MM-DD：' + iso);
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    var d = new Date(t);
    if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw new Error('无效日期：' + iso);
    return t;
  }

  function formatISO(t) { return new Date(t).toISOString().slice(0, 10); }

  function addDays(iso, n) { return formatISO(parseISO(iso) + n * 86400000); }

  function daysBetween(fromIso, toIso) { return Math.round((parseISO(toIso) - parseISO(fromIso)) / 86400000); }

  /** 本地时区的今天（仅 app 使用；core 其余函数都接收注入的 today）。 */
  function localToday(date) {
    var d = date || new Date();
    var p = function (x) { return String(x).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  // ---------- SM-2 ----------
  var GRADES = [
    { id: 'again', label: '忘了', quality: 1 },
    { id: 'hard', label: '吃力', quality: 3 },
    { id: 'good', label: '想起', quality: 4 },
    { id: 'easy', label: '很熟', quality: 5 }
  ];
  var MIN_EF = 1.3;
  var MASTERED_INTERVAL = 21;

  function qualityOf(grade) {
    for (var i = 0; i < GRADES.length; i++) if (GRADES[i].id === grade) return GRADES[i].quality;
    throw new Error('未知的自评档位：' + grade);
  }

  /** SM-2：返回新的排期字段 { ef, reps, interval, due }。先用旧 EF 算间隔，再更新 EF。 */
  function sm2(state, quality, today) {
    parseISO(today);
    if (!(quality >= 0 && quality <= 5)) throw new Error('quality 必须在 0–5 之间');
    var ef = typeof state.ef === 'number' && state.ef >= MIN_EF ? state.ef : 2.5;
    var reps = state.reps > 0 ? Math.floor(state.reps) : 0;
    var prev = state.interval > 0 ? state.interval : 0;
    var interval;
    if (quality < 3) {
      reps = 0;
      interval = 1;
    } else {
      if (reps === 0) interval = 1;
      else if (reps === 1) interval = 6;
      else interval = Math.max(1, Math.round(prev * ef));
      reps += 1;
    }
    var q = 5 - quality;
    ef = Math.max(MIN_EF, Math.round((ef + (0.1 - q * (0.08 + q * 0.02))) * 1000) / 1000);
    return { ef: ef, reps: reps, interval: interval, due: addDays(today, interval) };
  }

  function review(card, grade, today) {
    var q = qualityOf(grade);
    var next = sm2(card, q, today);
    return Object.assign({}, card, next, {
      lastReviewed: today,
      lapses: (card.lapses || 0) + (q < 3 ? 1 : 0),
      reviews: (card.reviews || 0) + 1
    });
  }

  function previewIntervals(card, today) {
    var out = {};
    GRADES.forEach(function (g) { out[g.id] = sm2(card, g.quality, today).interval; });
    return out;
  }

  // ---------- 卡片 ----------
  function makeCard(input, today, id) {
    parseISO(today);
    var wrong = String(input.wrong || '').trim();
    var correct = String(input.correct || '').trim();
    if (!wrong) throw new Error('错句不能为空');
    if (!correct) throw new Error('正确句不能为空');
    if (normalize(wrong) === normalize(correct)) throw new Error('错句与正确句相同');
    var auto = classify(wrong, correct);
    var tag = input.tag && isTag(input.tag) ? input.tag : auto;
    return {
      id: String(id),
      wrong: wrong,
      correct: correct,
      english: String(input.english || '').trim(),
      note: String(input.note || '').trim(),
      tag: tag,
      tagManual: tag !== auto,
      createdAt: today,
      ef: 2.5, reps: 0, interval: 0, due: today,
      lapses: 0, reviews: 0, lastReviewed: null
    };
  }

  function setTag(card, tag) {
    if (!isTag(tag)) throw new Error('未知的错误类型：' + tag);
    return Object.assign({}, card, { tag: tag, tagManual: tag !== classify(card.wrong, card.correct) });
  }

  function isDue(card, today) { return card.due <= today; }
  function isMastered(card) { return card.interval >= MASTERED_INTERVAL; }

  function dueQueue(cards, today) {
    parseISO(today);
    return cards
      .filter(function (c) { return isDue(c, today); })
      .slice()
      .sort(function (a, b) {
        if (a.due !== b.due) return a.due < b.due ? -1 : 1;
        if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
  }

  function nextDueDate(cards, today) {
    var future = cards.filter(function (c) { return c.due > today; }).map(function (c) { return c.due; }).sort();
    return future[0] || null;
  }

  function stats(cards, today, log) {
    var byTag = {};
    TAG_IDS.forEach(function (id) { byTag[id] = { count: 0, lapses: 0 }; });
    cards.forEach(function (c) {
      var k = isTag(c.tag) ? c.tag : 'other';
      byTag[k].count += 1;
      byTag[k].lapses += c.lapses || 0;
    });
    var tagRows = TAGS.map(function (t) {
      return { id: t.id, label: t.label, count: byTag[t.id].count, lapses: byTag[t.id].lapses };
    }).sort(function (a, b) { return b.count - a.count || b.lapses - a.lapses || TAG_IDS.indexOf(a.id) - TAG_IDS.indexOf(b.id); });
    return {
      total: cards.length,
      due: cards.filter(function (c) { return isDue(c, today); }).length,
      mastered: cards.filter(isMastered).length,
      reviewedToday: (log || []).filter(function (e) { return e.date === today; }).length,
      byTag: tagRows,
      maxCount: tagRows.reduce(function (m, r) { return Math.max(m, r.count); }, 0)
    };
  }

  // ---------- 批量粘贴 ----------
  function parseBulk(text) {
    var items = [], errors = [];
    String(text || '').split(/\r?\n/).forEach(function (line, idx) {
      if (!line.trim()) return;
      var parts = line.split(/[|｜]/).map(function (s) { return s.trim(); });
      if (parts.length < 2 || !parts[0] || !parts[1]) {
        errors.push({ line: idx + 1, text: line, reason: '至少需要「错句 | 正确句」两段' });
        return;
      }
      if (normalize(parts[0]) === normalize(parts[1])) {
        errors.push({ line: idx + 1, text: line, reason: '错句与正确句相同' });
        return;
      }
      items.push({ wrong: parts[0], correct: parts[1], english: parts.slice(2).join(' | ').trim() });
    });
    return { items: items, errors: errors };
  }

  // ---------- 导出 / 导入 ----------
  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function csvField(s) {
    var v = String(s == null ? '' : s);
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  /** 公式或控制字符前缀改写为 HTML 实体：Anki（#html:true）显示不变，电子表格不会当公式执行。 */
  function guardFormula(v) {
    var ent = { '=': '&#61;', '+': '&#43;', '-': '&#45;', '@': '&#64;', '\t': '&#9;', '\r': '&#13;' };
    return ent[v.charAt(0)] ? ent[v.charAt(0)] + v.slice(1) : v;
  }

  /** Anki 可导入 CSV：正面=错句+英文，背面=正确句+错误类型，第三列为标签。 */
  function toAnkiCSV(cards) {
    var lines = ['#separator:comma', '#html:true', '#columns:正面,背面,标签'];
    cards.forEach(function (c) {
      var front = escapeHTML(c.wrong) + (c.english ? '<br>' + escapeHTML(c.english) : '');
      var back = escapeHTML(c.correct) + '<br>错误类型：' + escapeHTML(tagLabel(c.tag));
      lines.push([csvField(guardFormula(front)), csvField(guardFormula(back)), csvField('错题回环 ' + c.tag)].join(','));
    });
    return lines.join('\n') + '\n';
  }

  var BACKUP_APP = 'cuoti-huihuan';

  function exportJSON(state, now) {
    return JSON.stringify({
      app: BACKUP_APP, version: 1, exportedAt: now || null,
      cards: state.cards || [], log: state.log || []
    }, null, 2);
  }

  function sanitizeCard(raw, today) {
    if (!raw || typeof raw !== 'object') throw new Error('卡片格式错误');
    var base = makeCard(raw, today, raw.id != null ? raw.id : 'x');
    var dateOr = function (v, d) { try { parseISO(v); return v; } catch (e) { return d; } };
    return Object.assign(base, {
      tag: isTag(raw.tag) ? raw.tag : base.tag,
      tagManual: !!raw.tagManual,
      createdAt: dateOr(raw.createdAt, today),
      ef: typeof raw.ef === 'number' && raw.ef >= MIN_EF ? raw.ef : 2.5,
      reps: Number.isInteger(raw.reps) && raw.reps >= 0 ? raw.reps : 0,
      interval: Number.isInteger(raw.interval) && raw.interval >= 0 ? raw.interval : 0,
      due: dateOr(raw.due, today),
      lapses: Number.isInteger(raw.lapses) && raw.lapses >= 0 ? raw.lapses : 0,
      reviews: Number.isInteger(raw.reviews) && raw.reviews >= 0 ? raw.reviews : 0,
      lastReviewed: raw.lastReviewed ? dateOr(raw.lastReviewed, null) : null
    });
  }

  /** 按内容生成的稳定 ID：同一张无 ID 卡片重复导入得到同一 ID（幂等），不同内容不相撞。 */
  function contentId(raw) {
    var s = String(raw.wrong || '') + '\u0001' + String(raw.correct || '');
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return 'imp-' + (h >>> 0).toString(36);
  }

  /**
   * 逐张清洗卡片数组：跳过无法修复的条目，缺失 / 非标量 / 重复的 ID 改为唯一 ID。
   * 返回 { cards, dropped, reIded }。
   */
  function sanitizeCards(list, today) {
    var seen = new Set(), cards = [], dropped = 0, reIded = 0;
    (Array.isArray(list) ? list : []).forEach(function (raw) {
      if (!raw || typeof raw !== 'object') { dropped += 1; return; }
      var id = (typeof raw.id === 'string' || typeof raw.id === 'number') && String(raw.id).trim() ? String(raw.id) : null;
      if (id === null || seen.has(id)) {
        var baseId = contentId(raw), n = 1;
        id = baseId;
        while (seen.has(id)) { n += 1; id = baseId + '-' + n; }
        reIded += 1;
      }
      var card;
      try { card = sanitizeCard(Object.assign({}, raw, { id: id }), today); } catch (e) { dropped += 1; return; }
      seen.add(id);
      cards.push(card);
    });
    return { cards: cards, dropped: dropped, reIded: reIded };
  }

  function sanitizeLog(list) {
    return Array.isArray(list) ? list.filter(function (e) {
      return e && typeof e.id === 'string' && typeof e.grade === 'string' && ISO_RE.test(e.date);
    }).map(function (e) { return { date: e.date, id: e.id, grade: e.grade }; }) : [];
  }

  /** 合并复习日志并按 date+id+grade 去重（同一张卡同一天只会复习一次），保留原顺序，最多 max 条。 */
  function mergeLog(existing, incoming, max) {
    var seen = new Set(), out = [];
    existing.concat(incoming).forEach(function (e) {
      var k = e.date + '\u0001' + e.id + '\u0001' + e.grade;
      if (seen.has(k)) return;
      seen.add(k);
      out.push(e);
    });
    return max ? out.slice(-max) : out;
  }

  /** 清洗 localStorage 里读出的状态对象，返回 { cards, log, dropped, reIded }。 */
  function sanitizeState(data, today) {
    var d = data && typeof data === 'object' ? data : {};
    var r = sanitizeCards(d.cards, today);
    return { cards: r.cards, log: sanitizeLog(d.log), dropped: r.dropped, reIded: r.reIded };
  }

  /** 解析 JSON 备份，返回 { cards, log, dropped, reIded }；格式不对抛错。 */
  function importJSON(text, today) {
    var data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('不是有效的 JSON 文件'); }
    if (!data || data.app !== BACKUP_APP || !Array.isArray(data.cards)) throw new Error('不是错题回环的备份文件');
    var r = sanitizeCards(data.cards, today);
    return { cards: r.cards, log: sanitizeLog(data.log), dropped: r.dropped, reIded: r.reIded };
  }

  function mergeCards(existing, incoming) {
    var map = new Map();
    existing.forEach(function (c) { map.set(c.id, c); });
    incoming.forEach(function (c) { map.set(c.id, c); });
    return Array.from(map.values());
  }

  var api = {
    TAGS: TAGS, GRADES: GRADES, MASTERED_INTERVAL: MASTERED_INTERVAL,
    tagLabel: tagLabel, isTag: isTag, normalize: normalize,
    charDiff: charDiff, isPunctOnly: isPunctOnly, classify: classify, isCorrectAnswer: isCorrectAnswer,
    parseISO: parseISO, addDays: addDays, daysBetween: daysBetween, localToday: localToday,
    qualityOf: qualityOf, sm2: sm2, review: review, previewIntervals: previewIntervals,
    makeCard: makeCard, setTag: setTag, isDue: isDue, isMastered: isMastered,
    dueQueue: dueQueue, nextDueDate: nextDueDate, stats: stats,
    parseBulk: parseBulk, escapeHTML: escapeHTML, toAnkiCSV: toAnkiCSV,
    exportJSON: exportJSON, importJSON: importJSON, mergeCards: mergeCards,
    sanitizeCards: sanitizeCards, sanitizeState: sanitizeState, mergeLog: mergeLog
  };

  globalThis.CuotiCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
