'use strict';
/* 中文排版清洁器 · 纯逻辑(无 DOM)。
 * 受保护区域(代码块 / 行内代码 / URL / HTML 标签 / 保护词)先换成私有区占位符,
 * 规则只作用于占位后的文本,最后按顺序还原。 */
(function () {
  var HAN = '\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff';
  var RE_HAN = new RegExp('[' + HAN + ']');
  var ZH_PUNCT = '，。？！：；、（）「」『』《》【】…—';
  var CLOSERS = '）」』》】';

  // 占位符(Unicode 私有区)。CODE/URL 与汉字相邻时加空格;HTML/WORD 视为中性。
  var S_CODE = '\uE000';
  var S_HTML = '\uE001';
  var S_URL = '\uE002';
  var S_WORD = '\uE003';
  var S_LINK = '\uE004';

  var QUOTE_STYLES = ['corner', 'curly'];

  // 展示顺序(与 SPEC 一致);before/after 是该规则单独开启时的示例
  var RULES = [
    { id: 'spacing', name: '中英文、中数字之间加空格', desc: '汉字与英文字母、数字相邻时加一个半角空格;数字与单位(5kg)不加。', before: '中文English中文123', after: '中文 English 中文 123' },
    { id: 'punct', name: '中文语境用全角标点', desc: '中文语境里的 , ? ! : ; () 换成全角,句末的 . 换成 。;全角标点后的空格删除。前后都是英文或数字的半角标点(如 3.14、12:30)保留。', before: '你好, 世界.(见附录)', after: '你好，世界。（见附录）' },
    { id: 'whitespace', name: '空格与空行整理', desc: '连续空格合并为一个(行首缩进保留),行尾空格删除,连续空行最多保留一个。注意:Markdown 行尾的两个空格(强制换行)默认也会被删除;勾选下方「保留强制换行」可保留。', before: '这  一行   有多余空格  ', after: '这 一行 有多余空格' },
    { id: 'quotes', name: '引号统一', desc: '成对的 "…" 以及另一种风格的双引号,统一为所选的 「…」 或 “…”。', before: '他说"好"', after: '他说「好」' },
    { id: 'ellipsis', name: '省略号', desc: '三个及以上的 ... 换成 ……。', before: '等等...然后', after: '等等……然后' },
    { id: 'dash', name: '破折号', desc: '连续两个短横线 -- 换成 ——(表格分隔行、分隔线、命令行参数不动)。', before: '你好--世界', after: '你好——世界' },
    { id: 'percent', name: '百分号紧跟数字', desc: '数字与百分号之间的空格删除:5 % 变成 5%。', before: '增长5 %', after: '增长5%' },
    { id: 'fullwidth', name: '全角字母数字转半角', desc: '全角的 A–Z、a–z、0–9 换成半角。', before: 'ＡＢＣ１２３', after: 'ABC123' },
    { id: 'linkspace', name: '汉字与链接、行内代码之间加空格', desc: '汉字紧挨 Markdown 链接、裸 URL、行内代码时加一个空格。链接地址和行内代码的内容不处理;链接的显示文字仍按各条排版规则处理。', before: '见[文档](https://a.com)和`code`吧', after: '见 [文档](https://a.com) 和 `code` 吧' }
  ];
  var RULE_IDS = RULES.map(function (r) { return r.id; });
  // 执行顺序:先转换字符,再依赖上下文的标点,最后空格与空行
  var PIPELINE = ['fullwidth', 'ellipsis', 'dash', 'quotes', 'punct', 'percent', 'spacing', 'linkspace', 'whitespace'];

  function isHan(ch) { return !!ch && RE_HAN.test(ch); }
  function isZh(ch) { return !!ch && (RE_HAN.test(ch) || ZH_PUNCT.indexOf(ch) >= 0); }

  /* ---------------- 保护区 ---------------- */

  var RE_PROT = new RegExp(
    '[\\uE000-\\uE004]' +
    '|<!--[\\s\\S]*?-->' +
    '|<\\/?[A-Za-z](?:"[^"]*"|\'[^\']*\'|[^<>"\'\\n])*>' +
    '|<![A-Za-z](?:"[^"]*"|\'[^\']*\'|[^<>"\'\\n])*>' +
    '|\\]\\((?:<[^<>\\n]*>|(?:[^()\\s]|\\([^()\\s]*\\))*)(?:[ \\t]+(?:"[^"\\n]*"|\'[^\'\\n]*\'))?[ \\t]*\\)' +
    '|\\bhttps?:\\/\\/[^\\s\\uE000-\\uE004<>"`「」『』《》【】（），。、；：？！“”‘’]+', 'g');

  function trimUrlEnd(u) {
    for (;;) {
      var last = u.charAt(u.length - 1);
      if ('.,;:!?\'"'.indexOf(last) >= 0) { u = u.slice(0, -1); continue; }
      if (last === ')' && count(u, ')') > count(u, '(')) { u = u.slice(0, -1); continue; }
      if (last === ']' && count(u, ']') > count(u, '[')) { u = u.slice(0, -1); continue; }
      return u;
    }
  }
  function count(s, ch) { return s.split(ch).length - 1; }

  function splitInlineCode(s) {
    var out = [];
    var i = 0, start = 0;
    while (i < s.length) {
      if (s.charAt(i) === '`') {
        var j = i;
        while (s.charAt(j) === '`') j++;
        var n = j - i;
        var k = j, found = -1;
        while (k < s.length && s.charAt(k) !== '\n') {
          if (s.charAt(k) === '`') {
            var l = k;
            while (s.charAt(l) === '`') l++;
            if (l - k === n) { found = l; break; }
            k = l;
          } else k++;
        }
        if (found > 0) {
          if (i > start) out.push({ type: 'text', value: s.slice(start, i) });
          out.push({ type: 'inline', value: s.slice(i, found) });
          i = found; start = found;
        } else i = j;
      } else i++;
    }
    if (start < s.length) out.push({ type: 'text', value: s.slice(start) });
    return out;
  }

  function splitMarkup(s) {
    var out = [];
    var re = new RegExp(RE_PROT.source, 'g');
    var last = 0, m;
    while ((m = re.exec(s))) {
      var val = m[0];
      var type = 'html';
      if (val.charAt(0) === ']') type = 'url';
      else if (val.charAt(0) === 'h') {
        val = trimUrlEnd(val);
        type = 'url';
        re.lastIndex = m.index + val.length;
      }
      if (m.index > last) out.push({ type: 'text', value: s.slice(last, m.index) });
      out.push({ type: type, value: val });
      last = m.index + val.length;
    }
    if (last < s.length) out.push({ type: 'text', value: s.slice(last) });
    return out;
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function referenceKey(label) {
    return label.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, '$1')
      .trim().replace(/[ \t\n]+/g, ' ').toLowerCase();
  }

  // Protect the whole definition, including labels, destinations and titles.
  // Definitions must be collected before uses: Markdown allows forward references.
  function splitDefinitions(text, labels) {
    var re = /^ {0,3}\[((?:\\.|[^\[\]\\\n])+)\]:[ \t]*(?:\n[ \t]*)?(?:<[^<>\n]*>|(?:\\.|[^\s<>\\()]|\((?:\\.|[^\\()\s])*\))+)(?:(?:[ \t]+|[ \t]*\n[ \t]+)(?:"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\((?:\\.|[^)\\\n])*\)))?[ \t]*(?=\n|$)/gm;
    var comments = [], commentRe = /<!--[\s\S]*?-->/g, m;
    while ((m = commentRe.exec(text))) comments.push([m.index, commentRe.lastIndex]);
    var out = [], last = 0;
    while ((m = re.exec(text))) {
      if (comments.some(function (span) { return m.index >= span[0] && m.index < span[1]; })) continue;
      var key = referenceKey(m[1]);
      if (!key) continue;
      labels[key] = true;
      if (m.index > last) out.push({ type: 'text', value: text.slice(last, m.index) });
      out.push({ type: 'html', value: m[0] });
      last = re.lastIndex;
    }
    if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
    return out;
  }

  function splitReferences(text, labels) {
    var re = /!?\[((?:\\.|[^\[\]\\\n])+)\](?:\[((?:\\.|[^\[\]\\\n])*)\])?/g;
    var out = [], last = 0, m;
    while ((m = re.exec(text))) {
      var backslashes = 0;
      for (var i = m.index - 1; i >= 0 && text[i] === '\\'; i--) backslashes++;
      if (backslashes % 2) {
        // An escaped first bracket does not consume a following shortcut reference.
        if (m[2] !== undefined) re.lastIndex -= m[2].length + 2;
        continue;
      }
      if (text[re.lastIndex] === '(') continue;
      var label = m[2] || m[1];
      if (!labels[referenceKey(label)]) continue;
      if (m.index > last) out.push({ type: 'text', value: text.slice(last, m.index) });
      if (m[2]) {
        // Full references have independent display text; only their suffix is an ID.
        var close = m[0].length - m[2].length - 3;
        out.push({ type: 'text', value: m[0].slice(0, close) });
        out.push({ type: 'link', value: m[0].slice(close) });
      } else {
        // Shortcut/collapsed display text is also the ID. Renaming it breaks the link.
        out.push({ type: 'url', value: m[0] });
      }
      last = re.lastIndex;
    }
    if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
    return out;
  }

  function splitWords(s, words) {
    if (!words.length) return [{ type: 'text', value: s }];
    var re = new RegExp(words.map(escapeRe).join('|'), 'g');
    var out = [], last = 0, m;
    while ((m = re.exec(s))) {
      if (m[0] === '') { re.lastIndex++; continue; }
      if (m.index > last) out.push({ type: 'text', value: s.slice(last, m.index) });
      out.push({ type: 'word', value: m[0] });
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push({ type: 'text', value: s.slice(last) });
    return out;
  }

  function cleanWords(words) {
    var seen = Object.create(null), out = [];
    (Array.isArray(words) ? words : []).forEach(function (w) {
      if (typeof w !== 'string') return;
      var t = w.trim();
      if (!t || t.indexOf('\n') >= 0 || seen[t]) return;
      seen[t] = true; out.push(t);
    });
    return out.sort(function (a, b) { return b.length - a.length; });
  }

  // 返回 [{type:'text'|'code'|'inline'|'url'|'link'|'html'|'word', value}],各段拼接等于原文
  function protectRegions(text, protectedWords) {
    var src = typeof text === 'string' ? text : '';
    var words = cleanWords(protectedWords);
    var raw = [];
    var len = src.length, pos = 0, textStart = 0;
    while (pos < len) {
      var eol = src.indexOf('\n', pos);
      if (eol < 0) eol = len;
      var line = src.slice(pos, eol);
      var m = /^[ \t]*(`{3,}|~{3,})/.exec(line);
      if (m && !(m[1].charAt(0) === '`' && line.slice(m[0].length).indexOf('`') >= 0)) {
        var fch = m[1].charAt(0) === '`' ? '`' : '~';
        var closeRe = new RegExp('^[ \\t]*' + fch + '{' + m[1].length + ',}[ \\t]*$');
        var end = len, scan = eol + 1;
        while (scan < len) {
          var e2 = src.indexOf('\n', scan);
          if (e2 < 0) e2 = len;
          if (closeRe.test(src.slice(scan, e2))) { end = e2; break; }
          scan = e2 + 1;
        }
        if (pos > textStart) raw.push({ type: 'text', value: src.slice(textStart, pos) });
        raw.push({ type: 'code', value: src.slice(pos, end) });
        textStart = end;
        pos = end + 1;
      } else {
        pos = eol + 1;
      }
    }
    if (textStart < len) raw.push({ type: 'text', value: src.slice(textStart) });

    var labels = Object.create(null), withDefinitions = [];
    raw.forEach(function (seg) {
      if (seg.type !== 'text') withDefinitions.push(seg);
      else splitDefinitions(seg.value, labels).forEach(function (s) { withDefinitions.push(s); });
    });
    var out = [];
    withDefinitions.forEach(function (seg) {
      if (seg.type !== 'text') { out.push(seg); return; }
      splitInlineCode(seg.value).forEach(function (a) {
        if (a.type !== 'text') { out.push(a); return; }
        splitMarkup(a.value).forEach(function (b) {
          if (b.type !== 'text') { out.push(b); return; }
          splitReferences(b.value, labels).forEach(function (c) {
            if (c.type !== 'text') out.push(c);
            else splitWords(c.value, words).forEach(function (d) { out.push(d); });
          });
        });
      });
    });
    return out;
  }

  /* ---------------- 规则 ---------------- */

  function ruleFullwidthAlnum(text) {
    var c = 0;
    var t = String(text).replace(/[\uFF21-\uFF3A\uFF41-\uFF5A\uFF10-\uFF19]+/g, function (m) {
      c++;
      return m.replace(/[\uFF01-\uFF5E]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); });
    });
    return { text: t, count: c };
  }

  function ruleEllipsis(text) {
    var c = 0;
    var t = String(text).replace(/\.{3,}/g, function () { c++; return '……'; });
    return { text: t, count: c };
  }

  function ruleDash(text) {
    var c = 0;
    var lines = String(text).split('\n').map(function (line) {
      if (/^[\s|:\-=+]*$/.test(line)) return line; // 表格分隔行、分隔线、setext 下划线
      return line.replace(/(?<!-)--(?!-)/g, function (m, offset, str) {
        var before = str.charAt(offset - 1);
        var after = str.charAt(offset + 2);
        if (/[A-Za-z0-9]/.test(after) && (offset === 0 || /\s/.test(before))) return m; // 命令行参数 --help
        c++;
        return '——';
      });
    });
    return { text: lines.join('\n'), count: c };
  }

  function ruleQuotes(text, style) {
    var curly = style === 'curly';
    var src = String(text);
    var lines = src.split('\n').map(function (line) {
      var chars = line.split('');
      var idx = [];
      chars.forEach(function (ch, i) { if (ch === '"') idx.push(i); });
      for (var k = 0; k + 1 < idx.length; k += 2) {
        chars[idx[k]] = curly ? '“' : '「';
        chars[idx[k + 1]] = curly ? '”' : '」';
      }
      return chars.map(function (ch) {
        if (curly) return ch === '「' ? '“' : ch === '」' ? '”' : ch;
        return ch === '“' ? '「' : ch === '”' ? '」' : ch;
      }).join('');
    });
    var out = lines.join('\n');
    return { text: out, count: countQuoteChanges(src, out) };
  }
  function countQuoteChanges(before, after) {
    var n = 0;
    for (var i = 0; i < before.length; i++) if (before.charAt(i) !== after.charAt(i)) n++;
    return n;
  }

  var FULL = { ',': '，', '?': '？', '!': '！', ':': '：', ';': '；' };

  function prevSig(line, i) {
    var j = i - 1;
    while (j >= 0 && (line[j] === ' ' || line[j] === '\t')) j--;
    return j >= 0 ? line[j] : '';
  }
  function nextSig(line, i) {
    var j = i + 1;
    while (j < line.length && (line[j] === ' ' || line[j] === '\t')) j++;
    return j < line.length ? line[j] : '';
  }

  function punctPass(line) {
    var c = 0;
    // 括号:成对处理
    var chars = line.split('');
    var stack = [], pairs = [], i;
    for (i = 0; i < chars.length; i++) {
      if (chars[i] === '(') stack.push(i);
      else if (chars[i] === ')' && stack.length) pairs.push([stack.pop(), i]);
    }
    pairs.forEach(function (p) {
      var inner = line.slice(p[0] + 1, p[1]);
      if (RE_HAN.test(inner) || isHan(line.charAt(p[0] - 1)) || isHan(line.charAt(p[1] + 1))) {
        chars[p[0]] = '（'; chars[p[1]] = '）'; c += 2;
      }
    });
    line = chars.join('');
    var entityEnds = new Set();
    line.replace(/&[#A-Za-z0-9]+;/g, function (m, offset) { entityEnds.add(offset + m.length - 1); return m; });
    for (i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (ch === '.') {
        var p = line.charAt(i - 1), n = line.charAt(i + 1);
        if ((isHan(p) || CLOSERS.indexOf(p) >= 0) && !/[A-Za-z0-9.]/.test(n)) { chars[i] = '。'; c++; }
      }
    }
    // 从左右各扫描一次,让中文语境沿连续标点传播。固定 10 轮会留下长标点串,
    // 按字符数反复重扫则会使长输入退化为平方耗时。
    for (var pass = 0; pass < 2; pass++) {
      for (var step = 0; step < chars.length; step++) {
        i = pass === 0 ? step : chars.length - 1 - step;
        ch = chars[i];
        if (!FULL[ch]) continue;
        if (ch === ';' && entityEnds.has(i)) continue;
        if (ch === '!' && chars[i + 1] === '[') continue;
        if (isZh(prevSig(chars, i)) || isZh(nextSig(chars, i))) { chars[i] = FULL[ch]; c++; }
      }
    }
    line = chars.join('');
    line = line.replace(/([，。？！：；、])[ \t]+(?=\S)/g, function (m, p1) { c++; return p1; });
    return { line: line, count: c };
  }

  function punctLine(line) {
    return punctPass(line);
  }

  function rulePunct(text) {
    var c = 0;
    var lines = String(text).split('\n').map(function (line) {
      var r = punctLine(line); c += r.count; return r.line;
    });
    return { text: lines.join('\n'), count: c };
  }

  function rulePercent(text) {
    var c = 0;
    var t = String(text).replace(/(\d)[ \t]+%/g, function (m, d) { c++; return d + '%'; });
    return { text: t, count: c };
  }

  function ruleSpacing(text) {
    var c = 0;
    var t = String(text);
    t = t.replace(new RegExp('([' + HAN + '])([A-Za-z0-9])', 'g'), function (m, a, b) { c++; return a + ' ' + b; });
    t = t.replace(new RegExp('(\\d%|[A-Za-z0-9])([' + HAN + '])', 'g'), function (m, a, b) { c++; return a + ' ' + b; });
    return { text: t, count: c };
  }

  function ruleLinkSpacing(text) {
    var c = 0;
    var t = String(text);
    var tick = function (m, a, b) { c++; return a + ' ' + b; };
    t = t.replace(new RegExp('([' + HAN + '])(!?\\[[^\\[\\]\\n' + S_LINK + ']*' + S_LINK + ')', 'g'), tick);
    t = t.replace(new RegExp('(' + S_LINK + ')([' + HAN + '])', 'g'), tick);
    t = t.replace(new RegExp('([' + HAN + '])([' + S_CODE + S_URL + '])', 'g'), tick);
    t = t.replace(new RegExp('([' + S_CODE + S_URL + '])([' + HAN + '])', 'g'), tick);
    return { text: t, count: c };
  }

  function ruleWhitespace(text, opts) {
    var keepBreak = !!(opts && opts.keepHardBreak);
    var c = 0;
    var src = String(text).split('\n');
    var lines = src.map(function (line, idx) {
      var lead = /^[ \t]*/.exec(line)[0];
      var rest = line.slice(lead.length);
      // Markdown 强制换行:有正文、行尾恰好是 2 个以上空格、下一行不是空行(规整为恰好 2 个空格)
      var hard = null;
      if (keepBreak) {
        hard = / {2,}$/.exec(rest);
        var nextOk = idx + 1 < src.length && src[idx + 1].trim() !== '';
        if (hard && (hard.index === 0 || !nextOk)) hard = null;
        if (hard) rest = rest.slice(0, hard.index);
      }
      rest = rest.replace(/ {2,}/g, function () { c++; return ' '; });
      var trimmed = rest.replace(/[ \t\u3000]+$/, '');
      if (trimmed !== rest) c++;
      if (hard) {
        if (hard[0] !== '  ') c++;
        return lead + trimmed + '  ';
      }
      if (trimmed === '' && lead !== '') { c++; return ''; }
      return lead + trimmed;
    });
    var out = [];
    lines.forEach(function (line, i) {
      if (line === '' && i > 0 && out.length && out[out.length - 1] === '') { c++; return; }
      out.push(line);
    });
    return { text: out.join('\n'), count: c };
  }

  /* ---------------- 选项与清洁 ---------------- */

  function defaultOptions() {
    var rules = {};
    RULE_IDS.forEach(function (id) { rules[id] = true; });
    return { rules: rules, quoteStyle: 'corner', protectedWords: [], keepHardBreak: false };
  }

  function normalizeOptions(options) {
    var d = defaultOptions();
    var o = options && typeof options === 'object' ? options : {};
    if (o.rules && typeof o.rules === 'object') {
      RULE_IDS.forEach(function (id) { if (typeof o.rules[id] === 'boolean') d.rules[id] = o.rules[id]; });
    }
    if (QUOTE_STYLES.indexOf(o.quoteStyle) >= 0) d.quoteStyle = o.quoteStyle;
    d.protectedWords = cleanWords(o.protectedWords);
    d.keepHardBreak = o.keepHardBreak === true;
    return d;
  }

  function placeholderFor(seg) {
    if (seg.type === 'code' || seg.type === 'inline') return S_CODE;
    if (seg.type === 'html') return S_HTML;
    if (seg.type === 'word') return S_WORD;
    if (seg.type === 'link') return S_LINK;
    return seg.value.indexOf('](') === 0 ? S_LINK : S_URL;
  }

  var RUNNERS = {
    fullwidth: function (t) { return ruleFullwidthAlnum(t); },
    ellipsis: function (t) { return ruleEllipsis(t); },
    dash: function (t) { return ruleDash(t); },
    quotes: function (t, o) { return ruleQuotes(t, o.quoteStyle); },
    punct: function (t) { return rulePunct(t); },
    percent: function (t) { return rulePercent(t); },
    spacing: function (t) { return ruleSpacing(t); },
    linkspace: function (t) { return ruleLinkSpacing(t); },
    whitespace: function (t, o) { return ruleWhitespace(t, o); }
  };

  // 最长公共子序列的字符级差异;返回 [{type:'eq'|'del'|'ins', text}]
  function diffLine(a, b) {
    var A = Array.from(String(a == null ? '' : a));
    var B = Array.from(String(b == null ? '' : b));
    var p = 0;
    while (p < A.length && p < B.length && A[p] === B[p]) p++;
    var s = 0;
    while (s < A.length - p && s < B.length - p && A[A.length - 1 - s] === B[B.length - 1 - s]) s++;
    var a2 = A.slice(p, A.length - s), b2 = B.slice(p, B.length - s);
    var ops = [];
    var push = function (type, ch) {
      if (!ch.length) return;
      var text = ch.join('');
      var last = ops[ops.length - 1];
      if (last && last.type === type) last.text += text; else ops.push({ type: type, text: text });
    };
    push('eq', A.slice(0, p));
    var n = a2.length, m = b2.length;
    if (n && m && n * m <= 4000000) {
      var w = m + 1;
      var dp = new Uint32Array((n + 1) * w);
      for (var i = n - 1; i >= 0; i--) {
        for (var j = m - 1; j >= 0; j--) {
          dp[i * w + j] = a2[i] === b2[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
        }
      }
      var x = 0, y = 0;
      while (x < n && y < m) {
        if (a2[x] === b2[y]) { push('eq', [a2[x]]); x++; y++; }
        else if (dp[(x + 1) * w + y] >= dp[x * w + y + 1]) { push('del', [a2[x]]); x++; }
        else { push('ins', [b2[y]]); y++; }
      }
      while (x < n) { push('del', [a2[x++]]); }
      while (y < m) { push('ins', [b2[y++]]); }
    } else {
      push('del', a2); push('ins', b2);
    }
    push('eq', A.slice(A.length - s));
    return ops;
  }

  // 清洁只会改动行内容并删除空行,所以按顺序对齐即可
  function computeLineDiff(before, after) {
    var A = before.split('\n'), B = after.split('\n');
    var out = [];
    var i = 0, j = 0;
    var blank = function (s) { return s.trim() === ''; };
    while (i < A.length && j < B.length) {
      if (A[i] === B[j]) { i++; j++; continue; }
      if (blank(A[i]) && !blank(B[j]) && A.length - i > B.length - j) {
        out.push({ line: i + 1, before: A[i], after: '', removed: true });
        i++; continue;
      }
      out.push({ line: i + 1, before: A[i], after: B[j] });
      i++; j++;
    }
    while (i < A.length) { out.push({ line: i + 1, before: A[i], after: '', removed: true }); i++; }
    while (j < B.length) { out.push({ line: A.length, before: '', after: B[j], added: true }); j++; }
    return out;
  }

  function clean(text, options) {
    var opts = normalizeOptions(options);
    var src = (typeof text === 'string' ? text : '').replace(/\r\n?/g, '\n');
    if (src === '') return { result: '', changes: [], diff: [] };
    var segs = protectRegions(src, opts.protectedWords);
    var kept = [];
    var ph = segs.map(function (seg) {
      if (seg.type === 'text') return seg.value;
      kept.push(seg.value);
      return placeholderFor(seg);
    }).join('');
    var counts = Object.create(null);
    PIPELINE.forEach(function (id) {
      if (!opts.rules[id]) return;
      var r = RUNNERS[id](ph, opts);
      ph = r.text;
      counts[id] = r.count;
    });
    var k = 0;
    var result = ph.replace(/[\uE000-\uE004]/g, function () { return kept[k++]; });
    var changes = [];
    RULE_IDS.forEach(function (id) { if (counts[id] > 0) changes.push({ rule: id, count: counts[id] }); });
    return { result: result, changes: changes, diff: computeLineDiff(src, result) };
  }

  /* ---------------- 持久化状态校验(保存前与读取后共用) ---------------- */

  function defaultState() {
    var d = defaultOptions();
    return { v: 1, text: '', rules: d.rules, quoteStyle: d.quoteStyle, protectedWords: [], keepHardBreak: false };
  }

  function isPlain(o) { return o !== null && typeof o === 'object' && !Array.isArray(o); }

  function validateState(s) {
    if (!isPlain(s)) return { ok: false, error: '数据不是对象' };
    var topKeys = ['v', 'text', 'rules', 'quoteStyle', 'protectedWords', 'keepHardBreak'];
    var extra = Object.keys(s).filter(function (k) { return topKeys.indexOf(k) < 0; });
    if (extra.length) return { ok: false, error: '含有未知字段:' + extra.join(',') };
    if (s.v !== 1) return { ok: false, error: '版本号必须是 1' };
    if (typeof s.text !== 'string') return { ok: false, error: '原文必须是字符串' };
    if (!isPlain(s.rules)) return { ok: false, error: '规则开关必须是对象' };
    var ruleKeys = Object.keys(s.rules);
    for (var i = 0; i < ruleKeys.length; i++) {
      if (RULE_IDS.indexOf(ruleKeys[i]) < 0) return { ok: false, error: '未知规则:' + ruleKeys[i] };
    }
    for (var j = 0; j < RULE_IDS.length; j++) {
      if (typeof s.rules[RULE_IDS[j]] !== 'boolean') return { ok: false, error: '规则 ' + RULE_IDS[j] + ' 必须是布尔值' };
    }
    if (s.keepHardBreak !== undefined && typeof s.keepHardBreak !== 'boolean') return { ok: false, error: '保留强制换行必须是布尔值' };
    if (QUOTE_STYLES.indexOf(s.quoteStyle) < 0) return { ok: false, error: '引号风格只能是 corner 或 curly' };
    if (!Array.isArray(s.protectedWords)) return { ok: false, error: '保护词必须是数组' };
    var seen = Object.create(null);
    for (var k = 0; k < s.protectedWords.length; k++) {
      var w = s.protectedWords[k];
      if (typeof w !== 'string' || w === '' || w !== w.trim() || w.indexOf('\n') >= 0) return { ok: false, error: '保护词必须是不含首尾空白、不含换行的非空字符串' };
      if (seen[w]) return { ok: false, error: '保护词重复:' + w };
      seen[w] = true;
    }
    return { ok: true };
  }

  function serializeState(s) {
    var v = validateState(s);
    if (!v.ok) return { ok: false, error: v.error };
    return { ok: true, json: JSON.stringify(s) };
  }

  function parseState(json) {
    var obj;
    try { obj = JSON.parse(json); } catch (e) { return { ok: false, error: '不是合法的 JSON' }; }
    var v = validateState(obj);
    return v.ok ? { ok: true, state: obj } : { ok: false, error: v.error };
  }

  var api = {
    RULES: RULES, RULE_IDS: RULE_IDS, PIPELINE: PIPELINE, QUOTE_STYLES: QUOTE_STYLES,
    protectRegions: protectRegions,
    ruleSpacing: ruleSpacing, rulePunct: rulePunct, ruleQuotes: ruleQuotes, ruleEllipsis: ruleEllipsis,
    ruleDash: ruleDash, ruleFullwidthAlnum: ruleFullwidthAlnum, ruleWhitespace: ruleWhitespace,
    rulePercent: rulePercent, ruleLinkSpacing: ruleLinkSpacing,
    defaultOptions: defaultOptions, normalizeOptions: normalizeOptions,
    clean: clean, diffLine: diffLine, computeLineDiff: computeLineDiff,
    defaultState: defaultState, validateState: validateState, serializeState: serializeState, parseState: parseState
  };
  globalThis.ZhCleanCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
