/* 概念卡片库 · 纯逻辑(无 DOM,Node 下可 require)。
   卡片:{id, name, def, notNot[], questions[], links[], source, status, created, rewritten, reviewed, versions[]} */
(function () {
  'use strict';

  var STATUSES = ['草稿', '可用', '已重写'];
  var DEF_LIMIT = 60;
  var VERSION_LIMIT = 3;
  var APP_ID = 'conceptcards';
  var APP_VERSION = 1;

  /* ---------- 日期 ---------- */
  /* 严格 YYYY-MM-DD:解析后重新格式化再与原串比较,2026-02-30 之类返回 null */
  function parseDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var t = Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
    if (isNaN(t)) return null;
    return new Date(t).toISOString().slice(0, 10) === s ? s : null;
  }
  function resolveToday(search, fallback) {
    var raw = null;
    try { raw = new URLSearchParams(search || '').get('today'); } catch (e) { raw = null; }
    return parseDate(raw || '') || fallback;
  }
  function daysBetween(a, b) {
    return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  }

  /* ---------- 小工具 ---------- */
  function len(s) { return Array.from(String(s)).length; }
  function isStr(v) { return typeof v === 'string'; }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function strList(v) { return Array.isArray(v) && v.every(isStr); }
  function trimList(v) {
    return (Array.isArray(v) ? v : []).map(function (x) { return String(x).trim(); }).filter(Boolean);
  }
  function uniq(list) {
    var seen = new Set();
    var out = [];
    list.forEach(function (x) { if (!seen.has(x)) { seen.add(x); out.push(x); } });
    return out;
  }
  function lastTouch(card) { return card.rewritten || card.created; }
  /* 来源是文本;只要出现非 http(s) 的「协议://」就整份拒绝 */
  function badUrlScheme(text) {
    var re = /([a-z][a-z0-9+.\-]*):\/\//gi;
    var m;
    while ((m = re.exec(text)) !== null) {
      var p = m[1].toLowerCase();
      if (p !== 'http' && p !== 'https') return p;
    }
    return /^\s*(javascript|data|vbscript):/i.test(text) ? 'javascript' : '';
  }

  /* ---------- 卡片校验 ----------
     allNames:库内所有卡片名(含本卡)。errors 让卡片无效;warnings 只提示。 */
  function validateCard(card, allNames) {
    var errors = [];
    var warnings = [];
    if (!isObj(card)) return { ok: false, errors: ['卡片必须是对象'], warnings: warnings };
    var names = new Set(Array.isArray(allNames) ? allNames : []);

    if (!isStr(card.id) || !card.id.trim()) errors.push('id 必须是非空字符串');
    if (!isStr(card.name) || !card.name.trim()) errors.push('概念名不能为空');
    if (!isStr(card.def) || !card.def.trim()) errors.push('一句话定义不能为空');
    else if (len(card.def.trim()) > DEF_LIMIT) warnings.push('定义有 ' + len(card.def.trim()) + ' 字,超过 ' + DEF_LIMIT + ' 字,建议压缩');

    if (!strList(card.notNot)) errors.push('「不是什么」必须是字符串列表');
    else if (trimList(card.notNot).length < 1) errors.push('「不是什么」至少要有 1 条反例');
    else if (card.notNot.some(function (x) { return !x.trim(); })) errors.push('「不是什么」不能含空条目');

    if (!strList(card.questions)) errors.push('「能回答的问题」必须是字符串列表');
    else if (trimList(card.questions).length < 1) errors.push('「能回答的问题」至少要有 1 条');
    else if (card.questions.some(function (x) { return !x.trim(); })) errors.push('「能回答的问题」不能含空条目');

    if (!strList(card.links)) errors.push('关联概念必须是字符串列表');
    else {
      var own = isStr(card.name) ? card.name.trim() : '';
      if (card.links.some(function (x) { return !x.trim(); })) errors.push('关联概念不能含空条目');
      card.links.forEach(function (l, i) {
        var t = l.trim();
        if (!t) return;
        if (t === own) errors.push('不能关联自己:' + t);
        else if (!names.has(t)) warnings.push('关联的概念「' + t + '」还没有对应的卡片');
        if (card.links.findIndex(function (x) { return x.trim() === t; }) !== i) errors.push('关联概念重复:' + t);
      });
    }

    if (!isStr(card.source)) errors.push('来源必须是文本');
    else {
      var bad = badUrlScheme(card.source);
      if (bad) errors.push('来源里的网址只接受 http(s),发现「' + bad + '」');
    }
    if (STATUSES.indexOf(card.status) < 0) errors.push('状态必须是:' + STATUSES.join('、'));

    if (parseDate(card.created) === null) errors.push('创建日期必须是有效的 YYYY-MM-DD');
    ['rewritten', 'reviewed'].forEach(function (k) {
      if (card[k] === undefined || card[k] === '') return;
      if (parseDate(card[k]) === null) errors.push((k === 'rewritten' ? '最近重写日期' : '最近复习日期') + '必须为空或有效的 YYYY-MM-DD');
    });

    if (card.versions !== undefined) {
      if (!Array.isArray(card.versions)) errors.push('历史版本必须是列表');
      else {
        if (card.versions.length > VERSION_LIMIT) errors.push('历史版本最多保留 ' + VERSION_LIMIT + ' 条');
        card.versions.forEach(function (v) {
          if (!isObj(v) || !isStr(v.def) || parseDate(v.date) === null) errors.push('历史版本必须是 {def, date}');
        });
      }
    }
    return { ok: errors.length === 0, errors: errors, warnings: warnings };
  }

  /* ---------- 整库校验(保存前与读取后共用) ---------- */
  function validateState(cards) {
    var errors = [];
    var warnings = [];
    if (!Array.isArray(cards)) return { ok: false, errors: ['cards 必须是数组'], warnings: warnings };
    var ids = new Set();
    var nameSet = new Set();
    cards.forEach(function (c) { if (isObj(c) && isStr(c.name)) nameSet.add(c.name.trim()); });
    var allNames = Array.from(nameSet);
    var seenNames = new Set();
    cards.forEach(function (c, i) {
      var label = '第 ' + (i + 1) + ' 张' + (isObj(c) && isStr(c.name) && c.name.trim() ? '「' + c.name.trim() + '」' : '');
      var r = validateCard(c, allNames);
      r.errors.forEach(function (e) { errors.push(label + ':' + e); });
      r.warnings.forEach(function (w) { warnings.push(label + ':' + w); });
      if (isObj(c) && isStr(c.id)) {
        if (ids.has(c.id)) errors.push(label + ':id 重复(' + c.id + ')');
        ids.add(c.id);
      }
      if (isObj(c) && isStr(c.name) && c.name.trim()) {
        var n = c.name.trim();
        if (seenNames.has(n)) errors.push(label + ':概念名重复(' + n + ')');
        seenNames.add(n);
      }
    });
    return { ok: errors.length === 0, errors: errors, warnings: warnings };
  }

  function serialize(cards) {
    return JSON.stringify({ app: APP_ID, version: APP_VERSION, cards: cards }, null, 2);
  }

  /* 导入:任何一处不合法就整份拒绝并说明原因,不静默修正 */
  function validateImport(input) {
    var data = input;
    if (isStr(input)) {
      try { data = JSON.parse(input); } catch (e) { return { ok: false, errors: ['不是有效的 JSON:' + e.message], warnings: [] }; }
    }
    if (!isObj(data)) return { ok: false, errors: ['备份文件的最外层必须是对象'], warnings: [] };
    if (data.app !== APP_ID) return { ok: false, errors: ['不是概念卡片库的备份(app 字段应为 ' + APP_ID + ')'], warnings: [] };
    if (data.version !== APP_VERSION) return { ok: false, errors: ['不支持的备份版本:' + String(data.version)], warnings: [] };
    var r = validateState(data.cards);
    if (!r.ok) return { ok: false, errors: r.errors, warnings: r.warnings };
    var cards = data.cards.map(normalizeCard);
    /* 状态「可用」的卡必须仍然通过质量门,否则备份能绕过界面上的门 */
    var gateErrors = [];
    cards.forEach(function (c) {
      if (c.status !== '可用') return;
      var g = qualityGate(c, cards);
      if (!(g.clear && g.accurate && g.necessary)) {
        gateErrors.push('「' + c.name + '」状态为可用,但没有通过质量门(' + g.reasons.join(';') + ');请先在原端把它降为草稿或补全后再导出');
      }
    });
    if (gateErrors.length) return { ok: false, errors: gateErrors, warnings: r.warnings };
    return { ok: true, cards: cards, errors: [], warnings: r.warnings };
  }

  /* 只做格式整理(去首尾空白、补默认字段),不改变含义;校验通过后才调用 */
  function normalizeCard(c) {
    return {
      id: c.id,
      name: c.name.trim(),
      def: c.def.trim(),
      notNot: trimList(c.notNot),
      questions: trimList(c.questions),
      links: uniq(trimList(c.links)),
      source: c.source.trim(),
      status: c.status,
      created: c.created,
      rewritten: c.rewritten || '',
      reviewed: c.reviewed || '',
      versions: (c.versions || []).map(function (v) { return { def: v.def, date: v.date }; })
    };
  }

  /* ---------- 质量门:清晰、准确、必要 ---------- */
  /* 在定义里找其他卡片名:长名优先匹配并遮住已匹配片段,避免「复利效应」同时命中「复利」 */
  function mentionedNames(card, cards) {
    var others = cards.filter(function (c) { return c.name !== card.name; });
    others.sort(function (a, b) { return len(b.name) - len(a.name); });
    var text = String(card.def);
    var hit = [];
    others.forEach(function (o) {
      if (!o.name) return;
      if (text.indexOf(o.name) >= 0) {
        hit.push(o);
        text = text.split(o.name).join('\u0000');
      }
    });
    return hit;
  }
  function qualityGate(card, cards) {
    var reasons = [];
    var drafts = mentionedNames(card, cards || []).filter(function (c) { return c.status === '草稿'; });
    var clear = drafts.length === 0;
    if (!clear) reasons.push('依赖未定义概念:' + drafts.map(function (c) { return c.name; }).join('、'));
    var accurate = trimList(card.notNot).length >= 1;
    if (!accurate) reasons.push('缺少反例(不是什么)');
    var necessary = trimList(card.questions).length >= 1;
    if (!necessary) reasons.push('缺少它能回答的问题');
    return { clear: clear, accurate: accurate, necessary: necessary, reasons: reasons };
  }
  /* 把校验 / 质量门的错误文字对应到编辑表单里的控件(name/def/notNot/questions/links/source/status);对应不到返回 null */
  function errorField(msg) {
    var m = String(msg);
    if (/不能设为可用/.test(m)) return 'status';
    if (/反例|不是什么/.test(m)) return 'notNot';
    if (/能回答|问题/.test(m)) return 'questions';
    if (/依赖/.test(m)) return 'def';
    if (/关联/.test(m)) return 'links';
    if (/来源/.test(m)) return 'source';
    if (/状态/.test(m)) return 'status';
    if (/概念名|同名/.test(m)) return 'name';
    if (/定义/.test(m)) return 'def';
    return null;
  }
  function canBeUsable(card, cards) {
    var g = qualityGate(card, cards);
    return g.clear && g.accurate && g.necessary;
  }

  /* ---------- 关系图 ---------- */
  /* 关联自动双向:A 列了 B,B 的邻居里就有 A。不存在的名字忽略。用无原型对象,__proto__ 也能当卡片名 */
  function linkGraph(cards) {
    var names = new Set(cards.map(function (c) { return c.name; }));
    var sets = new Map();
    cards.forEach(function (c) { sets.set(c.name, new Set()); });
    cards.forEach(function (c) {
      (c.links || []).forEach(function (l) {
        if (l === c.name || !names.has(l)) return;
        sets.get(c.name).add(l);
        sets.get(l).add(c.name);
      });
    });
    var adjacency = Object.create(null);
    var islands = [];
    var ranked = [];
    cards.forEach(function (c) {
      var arr = Array.from(sets.get(c.name)).sort();
      adjacency[c.name] = arr;
      if (arr.length === 0) islands.push(c.name);
      else ranked.push({ name: c.name, degree: arr.length });
    });
    /* 枢纽:关联数最多的前 3 名(第 3 名并列的一并列出),关联数至少为 1 */
    ranked.sort(function (a, b) { return b.degree - a.degree || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); });
    var hubs = [];
    if (ranked.length) {
      var cut = ranked[Math.min(2, ranked.length - 1)].degree;
      hubs = ranked.filter(function (r) { return r.degree >= cut; });
    }
    return { adjacency: adjacency, islands: islands, hubs: hubs };
  }

  /* 写入一张卡:校验 → 重名检查 → 改名时同步别处的关联 → 关联双向 */
  function upsertCard(cards, card, today) {
    var idx = cards.findIndex(function (c) { return c.id === card.id; });
    var cand = isObj(card) && isStr(card.name) && isStr(card.def) && strList(card.notNot) && strList(card.questions) && strList(card.links) && isStr(card.source)
      ? Object.assign({}, card, {
        name: card.name.trim(), def: card.def.trim(), notNot: trimList(card.notNot), questions: trimList(card.questions),
        links: uniq(trimList(card.links)), source: card.source.trim()
      }) : card;
    var oldName = idx >= 0 ? cards[idx].name : null;
    var others = cards.filter(function (c) { return c.id !== (cand && cand.id); });
    var allNames = others.map(function (c) { return c.name; }).concat(isObj(cand) && isStr(cand.name) ? [cand.name] : []);
    var r = validateCard(cand, allNames);
    var errors = r.errors.slice();
    if (isObj(cand) && isStr(cand.name) && others.some(function (c) { return c.name === cand.name; })) errors.push('已有同名卡片:' + cand.name);
    if (errors.length) return { ok: false, errors: errors, warnings: r.warnings, cards: cards };
    /* 已有卡片的定义变了:统一走重写逻辑(旧定义进历史、最多 3 版、记录日期);
       传入的 rewritten/versions 一律以库里的旧卡为准。明确改了状态则保留所选状态 */
    if (idx >= 0 && cards[idx].def !== cand.def && parseDate(today) !== null) {
      var rw = rewrite(cards[idx], cand.def, today);
      cand = Object.assign({}, cand, {
        def: rw.def, rewritten: rw.rewritten, versions: rw.versions,
        status: cand.status !== cards[idx].status ? cand.status : rw.status
      });
    }
    var next = cards.map(function (c) {
      var copy = Object.assign({}, c, { links: (c.links || []).slice() });
      if (oldName !== null && oldName !== cand.name) {
        copy.links = uniq(copy.links.map(function (l) { return l === oldName ? cand.name : l; }));
      }
      return copy;
    });
    if (idx >= 0) next[idx] = cand; else next.push(cand);
    next = syncLinks(next, cand.name);
    if (cand.status === '可用') {
      var self = next.find(function (c) { return c.id === cand.id; });
      var g = qualityGate(self, next);
      if (!(g.clear && g.accurate && g.necessary)) {
        return { ok: false, errors: ['质量门没有全过,不能设为可用:' + g.reasons.join(';')], warnings: r.warnings, cards: cards, demoted: [] };
      }
    }
    var settled = settleGate(next);
    return { ok: true, errors: [], warnings: r.warnings, cards: settled.cards, demoted: settled.demoted };
  }
  /* 让每张「可用」卡保持通过质量门:不通过的退回草稿(可能级联,循环到稳定)。返回 {cards, demoted} */
  function settleGate(cards) {
    var list = cards;
    var demoted = [];
    var changed = true;
    while (changed) {
      changed = false;
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.status === '可用' && !canBeUsable(c, list)) {
          list = list.map(function (x, j) { return j === i ? Object.assign({}, x, { status: '草稿' }) : x; });
          demoted.push(c.name);
          changed = true;
          break;
        }
      }
    }
    return { cards: list, demoted: demoted };
  }
  /* 以 anchorName 这张卡的关联为准,让其他卡与它双向一致:它列了的补上它,没列的去掉它 */
  function syncLinks(cards, anchorName) {
    var anchor = cards.find(function (c) { return c.name === anchorName; });
    if (!anchor) return cards;
    var want = new Set(anchor.links);
    return cards.map(function (c) {
      if (c.name === anchorName) return c;
      var has = c.links.indexOf(anchorName) >= 0;
      if (want.has(c.name) && !has) return Object.assign({}, c, { links: c.links.concat([anchorName]) });
      if (!want.has(c.name) && has) return Object.assign({}, c, { links: c.links.filter(function (l) { return l !== anchorName; }) });
      return c;
    });
  }
  function removeCard(cards, id) {
    var gone = cards.find(function (c) { return c.id === id; });
    if (!gone) return cards;
    return cards.filter(function (c) { return c.id !== id; }).map(function (c) {
      return c.links.indexOf(gone.name) >= 0 ? Object.assign({}, c, { links: c.links.filter(function (l) { return l !== gone.name; }) }) : c;
    });
  }

  /* ---------- 复习 ---------- */
  /* 按「最久未重写」升序(没重写过的按创建日期),同日按创建日期再按名字,取前 n 张 */
  function reviewQueue(cards, n, today) {
    var count = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 5;
    var list = cards.slice().sort(function (a, b) {
      var ka = lastTouch(a);
      var kb = lastTouch(b);
      if (ka !== kb) return ka < kb ? -1 : 1;
      if (a.created !== b.created) return a.created < b.created ? -1 : 1;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    void today;
    return list.slice(0, count);
  }

  /* 重写:旧定义进历史(新的在前,最多 3 版),记录日期,状态变为已重写;返回新对象 */
  function rewrite(card, newDef, today) {
    if (!isStr(newDef) || !newDef.trim()) throw new TypeError('新定义不能为空');
    if (parseDate(today) === null) throw new TypeError('今天的日期格式不对');
    var versions = [{ def: card.def, date: lastTouch(card) }].concat(card.versions || []).slice(0, VERSION_LIMIT);
    return Object.assign({}, card, { def: newDef.trim(), rewritten: today, status: '已重写', versions: versions });
  }

  /* ---------- 搜索 ---------- */
  /* 名、定义、反例;空格分隔的多个词需要都出现(各自可在任一字段);不区分大小写 */
  function search(cards, q) {
    var terms = String(q == null ? '' : q).toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return cards.slice();
    return cards.filter(function (c) {
      var hay = [c.name, c.def].concat(c.notNot || []).join('\n').toLowerCase();
      return terms.every(function (t) { return hay.indexOf(t) >= 0; });
    });
  }

  /* ---------- 导出 ---------- */
  /* 公式防护:以 = + - @ 开头的字段加单引号(单独的 - 或 + 不算) */
  function guardCell(v) {
    var s = String(v == null ? '' : v);
    return /^[=+\-@\t\r]/.test(s) && !/^[+\-]$/.test(s) ? "'" + s : s;
  }
  function csvCell(v) {
    var s = guardCell(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(cards) {
    var head = ['概念名', '一句话定义', '不是什么', '能回答的问题', '关联概念', '来源', '状态', '创建日期', '最近重写日期'];
    var rows = cards.map(function (c) {
      return [c.name, c.def, (c.notNot || []).join(' ; '), (c.questions || []).join(' ; '), (c.links || []).join(' ; '), c.source, c.status, c.created, c.rewritten || ''];
    });
    return [head].concat(rows).map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }
  function oneLine(s) { return String(s).replace(/\s*[\r\n]+\s*/g, ' ').trim(); }
  function cardMarkdown(c) {
    var out = ['## ' + oneLine(c.name), '', '> ' + oneLine(c.def), '', '- 状态:' + c.status];
    out.push('- 不是什么:');
    (c.notNot || []).forEach(function (x) { out.push('  - ' + oneLine(x)); });
    out.push('- 能回答的问题:');
    (c.questions || []).forEach(function (x) { out.push('  - ' + oneLine(x)); });
    if ((c.links || []).length) out.push('- 关联概念:' + c.links.map(function (l) { return '[[' + oneLine(l) + ']]'; }).join('、'));
    if (c.source) out.push('- 来源:' + oneLine(c.source));
    out.push('- 创建:' + c.created + (c.rewritten ? ';最近重写:' + c.rewritten : ''));
    return out.join('\n');
  }
  /* 单张(传对象)或全部(传数组);全部时带总标题 */
  function toMarkdown(input) {
    if (!Array.isArray(input)) return cardMarkdown(input) + '\n';
    return '# 概念卡片库(' + input.length + ' 张)\n\n' + input.map(cardMarkdown).join('\n\n') + '\n';
  }

  var api = {
    STATUSES: STATUSES, DEF_LIMIT: DEF_LIMIT, VERSION_LIMIT: VERSION_LIMIT, APP_ID: APP_ID,
    parseDate: parseDate, resolveToday: resolveToday, daysBetween: daysBetween, len: len,
    validateCard: validateCard, validateState: validateState, validateImport: validateImport, serialize: serialize,
    qualityGate: qualityGate, errorField: errorField, canBeUsable: canBeUsable, mentionedNames: mentionedNames,
    linkGraph: linkGraph, settleGate: settleGate, upsertCard: upsertCard, removeCard: removeCard, syncLinks: syncLinks,
    reviewQueue: reviewQueue, rewrite: rewrite, search: search,
    toMarkdown: toMarkdown, toCsv: toCsv, guardCell: guardCell, trimList: trimList
  };
  globalThis.CardCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
