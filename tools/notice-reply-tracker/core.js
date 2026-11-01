'use strict';
/* 通知回执核对 · 纯逻辑(无 DOM)。浏览器下挂到 globalThis.NoticeCore,Node 下 module.exports。 */
(function () {
  var CATS = ['read', 'agree', 'decline', 'question', 'other'];
  var CAT_LABEL = { read: '已读/收到', agree: '同意', decline: '不参加', question: '有问题', other: '其他' };
  var RULE_KEYS = ['read', 'agree', 'decline', 'question'];
  var DEFAULT_RULES = {
    read: ['收到', '好的', 'ok', '1'],
    agree: ['同意', '参加', '报名'],
    decline: ['不', '请假', '不参加'],
    question: ['?', '\uFF1F', '吗']
  };
  var DEFAULT_TEMPLATE = '@{姓名} 请回复收到';
  var STATE_KEY_APP = 'notice-receipts';

  function str(v) { return v == null ? '' : String(v); }
  function splitLines(t) { return str(t).split(/\r\n|\r|\n/); }

  /* ---------- 归一化 ---------- */
  function normalizeName(s) {
    return str(s).normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\s+/g, '').toLowerCase();
  }

  /* ---------- 名单 ---------- */
  function splitList(s) {
    var seen = Object.create(null), out = [];
    s.split(/[,，、;；]/).forEach(function (x) {
      var t = x.trim();
      if (t && !seen[t]) { seen[t] = true; out.push(t); }
    });
    return out;
  }

  /* 名单按 CSV 解析:支持双引号包裹、"" 转义、引号内逗号/换行;引号未闭合返回 error */
  function csvRecords(text) {
    var src = str(text), recs = [], fields = [], buf = '', quoted = false, inQ = false, afterQ = false;
    var line = 1, recLine = 1, started = false;
    function endField() {
      fields.push({ text: quoted ? buf : buf.trim(), quoted: quoted });
      buf = ''; quoted = false; afterQ = false; started = true;
    }
    function endRec() {
      endField();
      var blank = fields.length === 1 && !fields[0].quoted && fields[0].text === '';
      if (!blank) recs.push({ line: recLine, fields: fields });
      fields = []; started = false;
    }
    for (var i = 0; i < src.length; i++) {
      var ch = src.charAt(i);
      if (inQ) {
        if (ch === '"') {
          if (src.charAt(i + 1) === '"') { buf += '"'; i++; } else { inQ = false; afterQ = true; }
        } else { buf += ch; if (ch === '\n') line++; }
        continue;
      }
      if (afterQ) {
        if (/[,\uFF0C\t]/.test(ch)) { endField(); continue; }
        if (ch === '\r' || ch === '\n') { if (ch === '\r' && src.charAt(i + 1) === '\n') i++; line++; endRec(); recLine = line; continue; }
        if (/\s/.test(ch)) continue;
        return { error: { line: recLine, message: '第 ' + recLine + ' 行:引号结束后还有多余字符' } };
      }
      if (ch === '"' && buf.trim() === '' && !quoted) { buf = ''; quoted = true; inQ = true; continue; }
      if (/[,\uFF0C\t]/.test(ch)) { endField(); continue; }
      if (ch === '\r' || ch === '\n') { if (ch === '\r' && src.charAt(i + 1) === '\n') i++; line++; endRec(); recLine = line; continue; }
      buf += ch;
    }
    if (inQ) return { error: { line: recLine, message: '第 ' + recLine + ' 行:引号没有闭合' } };
    if (buf !== '' || quoted || fields.length || started) endRec();
    return { records: recs };
  }

  /* 首行同时满足「第一列是姓名类表头词」且「没有第二列或第二列是备注类表头词」才当表头 */
  var HEADER_NAMES = ['姓名', '名字', '学生姓名', '成员', '成员姓名', 'name'];
  var HEADER_NOTES = ['备注', '说明', '班级', '年级', '别名', 'note', 'notes', 'remark'];

  function parseRosterEx(text) {
    var members = [], skipped = [];
    var cr = csvRecords(text);
    if (cr.error) return { members: [], skipped: [], errors: [cr.error], header: null };
    var errors = [];
    var seen = [];
    var header = null;
    var recs = cr.records;
    if (recs.length) {
      var h0 = recs[0].fields;
      var isHeadName = !h0[0].quoted && HEADER_NAMES.indexOf(h0[0].text.toLowerCase()) >= 0;
      var isHeadNote = h0.length === 1 || (h0.length === 2 && !h0[1].quoted && HEADER_NOTES.indexOf(h0[1].text.toLowerCase()) >= 0);
      if (isHeadName && isHeadNote) { header = h0.map(function (f) { return f.text; }); recs = recs.slice(1); }
    }
    recs.forEach(function (rec) {
      var f = rec.fields, first = f[0];
      var eq = first.quoted ? -1 : first.text.search(/[=＝]/);
      var name, note = '', aliases = [];
      if (eq >= 0) {
        name = first.text.slice(0, eq).trim();
        var parts = [{ text: first.text.slice(eq + 1), quoted: false }].concat(f.slice(1));
        var dup = Object.create(null);
        parts.forEach(function (p) {
          (p.quoted ? [p.text.trim()] : splitList(p.text)).forEach(function (a) {
            if (a && !dup[a]) { dup[a] = true; aliases.push(a); }
          });
        });
      } else {
        if (f.length > 2) { errors.push({ line: rec.line, message: '第 ' + rec.line + ' 行有 ' + f.length + ' 列,名单只允许「姓名」或「姓名, 备注」两列(别名请写成 姓名=别名)' }); return; }
        name = first.text.trim();
        note = f.length > 1 ? f[1].text.trim() : '';
      }
      if (!name) { skipped.push({ line: rec.line, text: f.map(function (x) { return x.text; }).join(',') }); return; }
      seen.push({ name: name, note: note, aliases: aliases });
    });
    if (errors.length) return { members: [], skipped: [], errors: errors, header: null };
    seen.forEach(function (m, idx) { members.push({ id: 'm' + (idx + 1), idx: idx, name: m.name, note: m.note, aliases: m.aliases }); });
    return { members: members, skipped: skipped, errors: [], header: header };
  }
  function parseRoster(text) { return parseRosterEx(text).members; }

  /* ---------- 回执解析 ---------- */
  var HEADER_RE = /^(.+?)\s+((?:\d{4}[-\/.年]\d{1,2}[-\/.月]\d{1,2}日?\s*)?\d{1,2}:\d{2}(?::\d{2})?)\s*$/;

  function headerOf(t) {
    var m = HEADER_RE.exec(t.replace(/：/g, ':'));
    if (!m) return null;
    var nick = t.slice(0, m[1].length).trim();
    if (!nick || /[:：]$/.test(nick)) return null;
    return { nick: nick, time: m[2].trim() };
  }

  function inlineOf(t) {
    // 找第一个「不是时间冒号」的冒号;没有则按第一段空白切分
    for (var i = 0; i < t.length; i++) {
      var ch = t.charAt(i);
      if (ch === ':' || ch === '：') {
        var prevDigit = i > 0 && /\d/.test(t.charAt(i - 1));
        var nextDigit = i + 1 < t.length && /\d/.test(t.charAt(i + 1));
        if (prevDigit && nextDigit) continue;
        var nick = t.slice(0, i).trim();
        if (nick) return { nick: nick, content: t.slice(i + 1).trim() };
        break;
      }
    }
    var m = /^(\S+)\s+([\s\S]+)$/.exec(t);
    if (m) return { nick: m[1], content: m[2].trim() };
    return null;
  }

  function explicitColon(t) {
    var p = inlineOf(t);
    if (!p) return null;
    for (var i = 0; i < t.length; i++) {
      var ch = t.charAt(i);
      if (ch === ':' || ch === '：') {
        var pd = i > 0 && /\d/.test(t.charAt(i - 1)), nd = /\d/.test(t.charAt(i + 1));
        if (pd && nd) continue;
        return t.slice(0, i).trim() === p.nick ? p : null;
      }
    }
    return null;
  }

  function parseRepliesEx(text) {
    var lines = splitLines(text), replies = [], skipped = [], cur = null;
    function flush() {
      if (!cur) return;
      var r = { nick: cur.nick, content: cur.lines.join('\n').trim() };
      if (cur.time) r.time = cur.time;
      replies.push(r);
      cur = null;
    }
    function nextIsContent(i) {
      for (var j = i + 1; j < lines.length; j++) {
        var t = lines[j].trim();
        if (!t) return false;
        return !headerOf(t);
      }
      return false;
    }
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (!t) { flush(); continue; }
      var h = headerOf(t);
      if (h && (cur || nextIsContent(i))) {
        flush();
        cur = { nick: h.nick, time: h.time, lines: [] };
        continue;
      }
      if (cur && cur.lines.length) {
        // 微信格式正文之后紧接的「昵称: 内容」(有明确冒号)视为新的一条回执
        var nb = explicitColon(t);
        if (nb) { flush(); replies.push(nb); continue; }
      }
      if (cur) { cur.lines.push(t); continue; }
      var p = inlineOf(t);
      if (p) replies.push(p); else skipped.push({ line: i + 1, text: t });
    }
    flush();
    return { replies: replies, skipped: skipped };
  }
  function parseReplies(text) { return parseRepliesEx(text).replies; }

  /* ---------- 匹配 ---------- */
  function keysOf(roster) {
    var keys = [];
    roster.forEach(function (m) {
      [m.name].concat(m.aliases || []).forEach(function (k) {
        var raw = str(k).trim(), norm = normalizeName(k);
        if (norm) keys.push({ raw: raw, norm: norm, member: m });
      });
    });
    return keys;
  }
  function distinct(hits) {
    var seen = new Map();
    hits.forEach(function (k) { if (!seen.has(k.member.id)) seen.set(k.member.id, k.member); });
    return Array.from(seen.values());
  }

  function resolve(keys, nickRaw) {
    var nick = str(nickRaw).trim(), nn = normalizeName(nick);
    if (!nn) return { reason: '昵称为空' };
    var stages = [
      function (k) { return k.raw === nick; },
      function (k) { return k.norm === nn; },
      function (k) { return nn.indexOf(k.norm) >= 0; }
    ];
    for (var s = 0; s < stages.length; s++) {
      var ms = distinct(keys.filter(stages[s]));
      if (ms.length === 1) return { member: ms[0], via: ['exact', 'normalized', 'contains'][s] };
      if (ms.length > 1) return { reason: '同时匹配到多人:' + ms.map(function (m) { return m.name; }).join('、') };
    }
    return { reason: '名单里没有匹配的姓名或别名' };
  }

  function match(roster, replies) {
    roster = roster || [];
    var keys = keysOf(roster), ent = new Map(), unknown = [];
    (replies || []).forEach(function (r) {
      var res = resolve(keys, r.nick);
      if (!res.member) {
        var u = { nick: str(r.nick), content: str(r.content), reason: res.reason };
        if (r.time) u.time = r.time;
        unknown.push(u);
        return;
      }
      var e = ent.get(res.member.id);
      if (e) { e.reply = r; e.count += 1; e.via = res.via; e.history.push(r); }
      else ent.set(res.member.id, { member: res.member, reply: r, count: 1, via: res.via, history: [r] });
    });
    var matched = [], unmatched = [];
    roster.forEach(function (m) { if (ent.has(m.id)) matched.push(ent.get(m.id)); else unmatched.push(m); });
    return { matched: matched, unmatched: unmatched, unknown: unknown };
  }

  /* 把后一批的结果累加到前一批:同一人以后一批为准,次数和历史累加 */
  function merge(prev, next) {
    prev = prev || { matched: [], unmatched: [], unknown: [] };
    next = next || { matched: [], unmatched: [], unknown: [] };
    var all = new Map(), ent = new Map();
    function add(m) { if (!all.has(m.id)) all.set(m.id, m); }
    prev.matched.forEach(function (e) { add(e.member); });
    prev.unmatched.forEach(add);
    next.matched.forEach(function (e) { add(e.member); });
    next.unmatched.forEach(add);
    prev.matched.forEach(function (e) { ent.set(e.member.id, e); });
    next.matched.forEach(function (e) {
      var p = ent.get(e.member.id);
      if (!p) { ent.set(e.member.id, e); return; }
      ent.set(e.member.id, {
        member: e.member, reply: e.reply, via: e.via,
        count: p.count + e.count, history: p.history.concat(e.history)
      });
    });
    var members = Array.from(all.values()).sort(function (a, b) { return a.idx - b.idx; });
    var matched = [], unmatched = [];
    members.forEach(function (m) { if (ent.has(m.id)) matched.push(ent.get(m.id)); else unmatched.push(m); });
    return { matched: matched, unmatched: unmatched, unknown: prev.unknown.concat(next.unknown) };
  }

  /* ---------- 分类 ---------- */
  function parseKeywords(text) {
    var seen = Object.create(null), out = [];
    str(text).split(/[,，、;；\r\n]+/).forEach(function (x) {
      var t = x.trim();
      if (t && !seen[t]) { seen[t] = true; out.push(t); }
    });
    return out;
  }
  function isWordish(k) { return /^[a-z0-9]+$/.test(k); }
  function findKeyword(c, kws) {
    for (var i = 0; i < (kws || []).length; i++) {
      var k = str(kws[i]).normalize('NFKC').toLowerCase().trim();
      if (!k) continue;
      if (isWordish(k)) {
        var from = 0, at;
        while ((at = c.indexOf(k, from)) >= 0) {
          var before = at > 0 ? c.charAt(at - 1) : '', after = c.charAt(at + k.length);
          if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return str(kws[i]).trim();
          from = at + 1;
        }
      } else if (c.indexOf(k) >= 0) return str(kws[i]).trim();
    }
    return '';
  }
  function classifyEx(content, rules) {
    rules = rules || DEFAULT_RULES;
    var c = str(content).normalize('NFKC').toLowerCase();
    var order = ['question', 'decline', 'agree', 'read'];
    for (var i = 0; i < order.length; i++) {
      var hit = findKeyword(c, rules[order[i]]);
      if (hit) return { cat: order[i], hit: hit };
    }
    return { cat: 'other', hit: '' };
  }
  function classify(content, rules) { return classifyEx(content, rules).cat; }

  var VIA_LABEL = { exact: '姓名或别名完全一致', normalized: '全角半角/空白归一后一致', contains: '昵称里包含姓名' };
  function reviewNotes(via, cat, hit) {
    var notes = [];
    if (via === 'contains') notes.push('姓名是按「昵称里包含姓名」匹配的,请人工确认确实是本人');
    if (cat === 'decline') notes.push('按关键词「' + hit + '」归为「不参加」,请人工确认(例如「不用担心」这类并不是拒绝)');
    return notes;
  }

  /* ---------- 催回文本 ---------- */
  function reminderText(unreplied, template) {
    var names = (unreplied || []).map(function (u) { return typeof u === 'string' ? u : u.name; }).filter(Boolean);
    if (!names.length) return '';
    var tpl = template == null || template === '' ? DEFAULT_TEMPLATE : String(template);
    var hasOne = tpl.indexOf('{姓名}') >= 0, hasAll = tpl.indexOf('{名单}') >= 0;
    var all = names.map(function (n) { return '@' + n; }).join(' ');
    if (hasOne) return names.map(function (n) { return tpl.split('{姓名}').join(n).split('{名单}').join(all); }).join('\n');
    if (hasAll) return tpl.split('{名单}').join(all);
    return all + ' ' + tpl;
  }

  /* ---------- 状态与校验 ---------- */
  function cloneRules(r) {
    var o = {};
    RULE_KEYS.forEach(function (k) { o[k] = r[k].slice(); });
    return o;
  }
  function createState() {
    return {
      app: STATE_KEY_APP, version: 1, title: '', rosterText: '',
      template: DEFAULT_TEMPLATE, rules: cloneRules(DEFAULT_RULES),
      batches: [{ id: 'b1', label: '第 1 批', text: '' }]
    };
  }

  function validateState(s) {
    function bad(msg) { return { ok: false, error: msg }; }
    if (!s || typeof s !== 'object' || Array.isArray(s)) return bad('顶层不是对象');
    if (s.app !== STATE_KEY_APP) return bad('app 字段不是 ' + STATE_KEY_APP + ',不是本工具的备份');
    if (s.version !== 1) return bad('version 必须是 1');
    var strs = ['title', 'rosterText', 'template'];
    for (var i = 0; i < strs.length; i++) if (typeof s[strs[i]] !== 'string') return bad('字段 ' + strs[i] + ' 必须是字符串');
    if (!s.rules || typeof s.rules !== 'object' || Array.isArray(s.rules)) return bad('rules 必须是对象');
    var rk = Object.keys(s.rules);
    for (var j = 0; j < rk.length; j++) if (RULE_KEYS.indexOf(rk[j]) < 0) return bad('rules 里有未知分类:' + rk[j]);
    for (var k = 0; k < RULE_KEYS.length; k++) {
      var list = s.rules[RULE_KEYS[k]];
      if (!Array.isArray(list)) return bad('rules.' + RULE_KEYS[k] + ' 必须是数组');
      for (var q = 0; q < list.length; q++) if (typeof list[q] !== 'string') return bad('rules.' + RULE_KEYS[k] + ' 的第 ' + (q + 1) + ' 项不是字符串');
    }
    if (!Array.isArray(s.batches)) return bad('batches 必须是数组');
    var ids = new Set();
    for (var b = 0; b < s.batches.length; b++) {
      var x = s.batches[b], n = '第 ' + (b + 1) + ' 批';
      if (!x || typeof x !== 'object' || Array.isArray(x)) return bad(n + '不是对象');
      if (typeof x.id !== 'string' || !x.id) return bad(n + '的 id 必须是非空字符串');
      if (ids.has(x.id)) return bad('批次 id 重复:' + x.id);
      ids.add(x.id);
      if (typeof x.label !== 'string') return bad(n + '的 label 必须是字符串');
      if (typeof x.text !== 'string') return bad(n + '的 text 必须是字符串');
    }
    return { ok: true };
  }

  function validateImport(input) {
    var obj = input;
    if (typeof input === 'string') {
      try { obj = JSON.parse(input); } catch (e) { return { ok: false, error: '不是有效的 JSON:' + e.message }; }
    }
    var v = validateState(obj);
    if (!v.ok) return v;
    var state = {
      app: STATE_KEY_APP, version: 1, title: obj.title, rosterText: obj.rosterText, template: obj.template,
      rules: cloneRules(obj.rules),
      batches: obj.batches.map(function (b) { return { id: b.id, label: b.label, text: b.text }; })
    };
    return { ok: true, state: state };
  }

  function hasUserData(s) {
    if (!s) return false;
    if (s.title.trim() || s.rosterText.trim()) return true;
    if (s.template !== DEFAULT_TEMPLATE) return true;
    for (var i = 0; i < RULE_KEYS.length; i++) {
      var k = RULE_KEYS[i];
      if (JSON.stringify(s.rules[k]) !== JSON.stringify(DEFAULT_RULES[k])) return true;
    }
    if (s.batches.length !== 1) return true;
    return s.batches.some(function (b, idx) { return b.text.trim() !== '' || b.label !== '第 ' + (idx + 1) + ' 批'; });
  }

  /* ---------- 汇总 ---------- */
  function rosterWarnings(roster) {
    var map = new Map(), out = [];
    roster.forEach(function (m) {
      var mine = new Set();
      [m.name].concat(m.aliases).forEach(function (k) {
        var n = normalizeName(k);
        if (!n || mine.has(n)) return;
        mine.add(n);
        if (!map.has(n)) map.set(n, { label: k, members: [] });
        map.get(n).members.push(m.name);
      });
    });
    map.forEach(function (v) {
      if (v.members.length > 1) out.push('「' + v.label + '」同时属于 ' + v.members.join('、') + ',带这个名字的回执会进入「无法识别」');
    });
    return out;
  }

  function analyze(state) {
    var rp = parseRosterEx(state.rosterText), roster = rp.members;
    var acc = { matched: [], unmatched: roster.slice(), unknown: [] };
    var batchInfo = [];
    state.batches.forEach(function (b) {
      var pr = parseRepliesEx(b.text);
      var res = match(roster, pr.replies);
      res.unknown = res.unknown.map(function (u) {
        var o = { batchId: b.id, batch: b.label };
        Object.keys(u).forEach(function (k) { o[k] = u[k]; });
        return o;
      });
      batchInfo.push({ id: b.id, label: b.label, replies: pr.replies.length, skipped: pr.skipped, unknown: res.unknown.length });
      acc = merge(acc, res);
    });
    var groups = {}, perCat = {};
    CATS.forEach(function (c) { groups[c] = []; });
    acc.matched.forEach(function (e) {
      var cl = classifyEx(e.reply.content, state.rules);
      var cat = cl.cat;
      groups[cat].push({ member: e.member, reply: e.reply, count: e.count, category: cat, via: e.via, hit: cl.hit, review: reviewNotes(e.via, cat, cl.hit) });
    });
    CATS.forEach(function (c) { perCat[c] = groups[c].length; });
    return {
      roster: roster, rosterHeader: rp.header, rosterSkipped: rp.skipped, rosterErrors: rp.errors, warnings: rosterWarnings(roster), batchInfo: batchInfo,
      matched: acc.matched, unmatched: acc.unmatched, unknown: acc.unknown, groups: groups,
      counts: { total: roster.length, replied: acc.matched.length, unreplied: acc.unmatched.length, unknown: acc.unknown.length, perCat: perCat }
    };
  }

  /* ---------- CSV ---------- */
  function guardCell(v) {
    var s = str(v);
    return /^[=+\-@\t\r]/.test(s) && !/^[+\-]$/.test(s) ? "'" + s : s;
  }
  function csvCell(v) {
    var s = guardCell(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(rows) {
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  }
  function receiptRows(a) {
    var rows = [['姓名', '备注', '状态', '分类', '回复内容', '回复昵称', '回复时间', '回复次数']];
    var byId = new Map();
    a.matched.forEach(function (e) { byId.set(e.member.id, e); });
    var catOf = new Map();
    CATS.forEach(function (c) { a.groups[c].forEach(function (g) { catOf.set(g.member.id, c); }); });
    a.roster.forEach(function (m) {
      var e = byId.get(m.id);
      if (e) rows.push([m.name, m.note, '已回', CAT_LABEL[catOf.get(m.id)], e.reply.content, e.reply.nick, e.reply.time || '', String(e.count)]);
      else rows.push([m.name, m.note, '未回', '', '', '', '', '0']);
    });
    a.unknown.forEach(function (u) {
      rows.push(['', u.reason + (u.batch ? '(' + u.batch + ')' : ''), '无法识别', '', u.content, u.nick, u.time || '', '1']);
    });
    return rows;
  }

  var api = {
    CATS: CATS, CAT_LABEL: CAT_LABEL, RULE_KEYS: RULE_KEYS, DEFAULT_RULES: DEFAULT_RULES, DEFAULT_TEMPLATE: DEFAULT_TEMPLATE,
    normalizeName: normalizeName, parseRoster: parseRoster, parseRosterEx: parseRosterEx,
    parseReplies: parseReplies, parseRepliesEx: parseRepliesEx, match: match, merge: merge,
    classify: classify, classifyEx: classifyEx, VIA_LABEL: VIA_LABEL, parseKeywords: parseKeywords, reminderText: reminderText,
    createState: createState, cloneRules: cloneRules, validateState: validateState, validateImport: validateImport,
    hasUserData: hasUserData, rosterWarnings: rosterWarnings, analyze: analyze,
    csvCell: csvCell, toCsv: toCsv, receiptRows: receiptRows
  };
  globalThis.NoticeCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
