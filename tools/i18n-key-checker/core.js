'use strict';
/* 多语言文案键核对 · 纯逻辑(无 DOM)。
   文件模型:{ lang, name, format: 'json'|'properties'|'csv', nested: boolean, entries: [[key, value], ...] }
   entries 是有序数组,不用普通对象做键值表,避免 __proto__ / constructor 键问题,也保持键顺序。 */
(function () {
  var LANG_RE = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/;
  var DEFAULT_KEY_PATTERN = '^[a-z0-9][A-Za-z0-9_]*(\\.[a-z0-9][A-Za-z0-9_]*)*$';
  var FORMATS = ['json', 'properties', 'csv'];
  var FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'];
  /* 简化的 CLDR 复数类别表:只列各语言必需的类别,未列出的语言只要求 other。 */
  var PLURAL_REQ = {
    en: ['one', 'other'], de: ['one', 'other'], nl: ['one', 'other'], sv: ['one', 'other'],
    es: ['one', 'other'], it: ['one', 'other'], pt: ['one', 'other'], fr: ['one', 'other'],
    ru: ['one', 'few', 'many', 'other'], uk: ['one', 'few', 'many', 'other'], pl: ['one', 'few', 'many', 'other'],
    ar: ['zero', 'one', 'two', 'few', 'many', 'other'],
    ja: ['other'], zh: ['other'], ko: ['other'], vi: ['other'], th: ['other'], id: ['other']
  };
  var KNOWN_LANGS = ('ar bg bn ca cs da de el en es et fa fi fil fr he hi hr hu id it ja ko lt lv ms nb nl no pl pt ro ru sk sl sr sv sw ta th tr uk ur vi zh yue').split(' ');
  var TYPE_LABELS = {
    missing: '缺键', extra: '多键', empty: '值为空', placeholder: '占位符不一致', html: 'HTML 标签不一致',
    emptyfile: '文件没有任何键', same: '疑似未翻译', ratio: '长度比异常', keyname: '键名不规范',
    plural: '复数形式不完整', inconsistent: '同源异译'
  };
  var BLOCK_TYPES = ['missing', 'extra', 'empty', 'placeholder', 'html', 'emptyfile'];

  var hasOwn = Object.prototype.hasOwnProperty;

  function stripBom(s) { return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s; }
  function isStr(v) { return typeof v === 'string'; }
  function isBlank(v) { return !isStr(v) || v.trim() === ''; }
  function toMap(entries) { var m = new Map(); entries.forEach(function (e) { m.set(e[0], e[1]); }); return m; }
  function define(obj, key, value) {
    Object.defineProperty(obj, key, { value: value, enumerable: true, writable: true, configurable: true });
  }
  function primary(lang) { return String(lang).toLowerCase().split(/[-_]/)[0]; }
  function isValidLang(lang) { return isStr(lang) && LANG_RE.test(lang); }

  /* ---------- 格式识别 ---------- */
  function detectFormat(text) {
    if (!isStr(text)) return 'unknown';
    var t = stripBom(text).trim();
    if (t === '') return 'empty';
    if (t[0] === '{' || t[0] === '[') return 'json';
    var lines = t.split(/\r\n|\n|\r/);
    var first = '';
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].trim();
      if (l !== '' && l[0] !== '#' && l[0] !== '!') { first = l; break; }
    }
    if (/^"?key"?\s*,/i.test(first)) return 'csv';
    for (var j = 0; j < lines.length; j++) {
      var s = lines[j].trim();
      if (s === '' || s[0] === '#' || s[0] === '!') continue;
      if (/^[^\s=:][^=:]*[=:]/.test(s)) return 'properties';
    }
    return 'unknown';
  }

  /* ---------- JSON ---------- */
  function typeName(v) { return v === null ? 'null' : Array.isArray(v) ? '数组' : typeof v; }

  function flatten(obj) {
    if (obj === null || typeof obj !== 'object') throw new Error('flatten 需要对象');
    var out = [];
    var seen = new Set();
    function walk(node, prefix) {
      Object.keys(node).forEach(function (k) {
        if (k === '') throw new Error('出现空键名(位于 ' + (prefix || '顶层') + ')');
        var path = prefix ? prefix + '.' + k : k;
        var v = node[k];
        if (isStr(v)) {
          if (seen.has(path)) throw new Error('键重复:' + path + '(扁平键与嵌套路径冲突)');
          seen.add(path);
          out.push([path, v]);
        } else if (v !== null && typeof v === 'object') {
          if (Object.keys(v).length === 0) throw new Error('键 "' + path + '" 是空' + (Array.isArray(v) ? '数组' : '对象') + ',无法保留');
          walk(v, path);
        } else {
          throw new Error('键 "' + path + '" 的值不是字符串(' + typeName(v) + ')');
        }
      });
    }
    walk(obj, '');
    return out;
  }

  function unflatten(entries) {
    var root = Object.create(null);
    entries.forEach(function (e) {
      var parts = e[0].split('.');
      var cur = root;
      parts.forEach(function (p) { if (p === '') throw new Error('键 "' + e[0] + '" 含空段,无法还原为嵌套结构'); });
      for (var i = 0; i < parts.length - 1; i++) {
        var p = parts[i];
        var nx = hasOwn.call(cur, p) ? cur[p] : undefined;
        if (nx === undefined) { nx = Object.create(null); define(cur, p, nx); }
        else if (isStr(nx)) throw new Error('键冲突:"' + parts.slice(0, i + 1).join('.') + '" 既是文本又有子键,无法还原为嵌套结构');
        cur = nx;
      }
      var last = parts[parts.length - 1];
      if (hasOwn.call(cur, last)) throw new Error('键冲突:"' + e[0] + '" 与其他键路径重叠,无法还原为嵌套结构');
      define(cur, last, e[1]);
    });
    return root;
  }

  /* 数组按索引键处理:比较结构时把数组换成以索引为键的对象 */
  function normalizeArrays(node) {
    if (node === null || typeof node !== 'object') return node;
    var out = Object.create(null);
    Object.keys(node).forEach(function (k) { define(out, k, normalizeArrays(node[k])); });
    return out;
  }

  function parseJson(text) {
    var data;
    try { data = JSON.parse(stripBom(String(text))); }
    catch (e) { throw new Error('JSON 解析失败:' + e.message); }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('JSON 顶层必须是对象');
    var entries = flatten(data);
    var nested = Object.keys(data).some(function (k) { return data[k] !== null && typeof data[k] === 'object'; });
    if (nested) {
      var back;
      try { back = JSON.stringify(unflatten(entries)); } catch (e) { back = null; }
      if (back !== JSON.stringify(normalizeArrays(data))) {
        throw new Error('JSON 结构无法无损还原:键名含点号(如 "a.b")与嵌套对象混用,导出会改变结构。请改成纯扁平或纯嵌套的写法');
      }
    }
    return { entries: entries, nested: nested };
  }

  /* ---------- .properties ---------- */
  function unescapeProp(s, lineNo) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c !== '\\') { out += c; continue; }
      i++;
      if (i >= s.length) { out += '\\'; break; }
      var n = s[i];
      if (n === 'u') {
        var hex = s.slice(i + 1, i + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error('第 ' + lineNo + ' 行:\\u 转义不是 4 位十六进制');
        out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
      } else if (n === 'n') out += '\n';
      else if (n === 't') out += '\t';
      else if (n === 'r') out += '\r';
      else if (n === 'f') out += '\f';
      else out += n;
    }
    return out;
  }

  function parseProperties(text) {
    var raw = stripBom(String(text)).split(/\r\n|\n|\r/);
    var entries = [];
    var seen = new Set();
    for (var i = 0; i < raw.length; i++) {
      var startLine = i + 1;
      var line = raw[i].replace(/^[ \t\f]+/, '');
      if (line === '' || line[0] === '#' || line[0] === '!') continue;
      while (/(?:^|[^\\])(?:\\\\)*\\$/.test(line) && i + 1 < raw.length) {
        line = line.slice(0, -1) + raw[++i].replace(/^[ \t\f]+/, '');
      }
      var k = 0;
      var keyRaw = '';
      while (k < line.length) {
        var ch = line[k];
        if (ch === '\\') { keyRaw += ch + (line[k + 1] || ''); k += 2; continue; }
        if (ch === '=' || ch === ':' || ch === ' ' || ch === '\t' || ch === '\f') break;
        keyRaw += ch; k++;
      }
      while (k < line.length && /[ \t\f]/.test(line[k])) k++;
      if (k < line.length && (line[k] === '=' || line[k] === ':')) k++;
      while (k < line.length && /[ \t\f]/.test(line[k])) k++;
      var key = unescapeProp(keyRaw, startLine);
      if (key === '') throw new Error('第 ' + startLine + ' 行:键名为空');
      var value = unescapeProp(line.slice(k), startLine);
      if (seen.has(key)) throw new Error('第 ' + startLine + ' 行:键重复 ' + key);
      seen.add(key);
      entries.push([key, value]);
    }
    return { entries: entries };
  }

  /* ---------- CSV ---------- */
  function parseCsv(text) {
    var s = stripBom(String(text));
    var rows = [];
    var row = [];
    var cell = '';
    var i = 0;
    var line = 1;
    var n = s.length;
    var afterQuote = false;
    var hasCell = false;
    while (i < n) {
      var c = s[i];
      if (c === '"' && cell === '' && !afterQuote && !hasCell) {
        var startLine = line;
        var j = i + 1;
        var closed = false;
        var buf = '';
        while (j < n) {
          if (s[j] === '"') {
            if (s[j + 1] === '"') { buf += '"'; j += 2; continue; }
            closed = true; j++; break;
          }
          if (s[j] === '\n') line++;
          buf += s[j]; j++;
        }
        if (!closed) throw new Error('CSV 引号未闭合(从第 ' + startLine + ' 行开始)');
        cell = buf; i = j; afterQuote = true; hasCell = true;
        continue;
      }
      if (c === ',' || c === '\n' || c === '\r') {
        row.push(cell); cell = ''; afterQuote = false; hasCell = false;
        if (c !== ',') {
          if (c === '\r' && s[i + 1] === '\n') i++;
          rows.push(row); row = []; line++;
        }
        i++;
        continue;
      }
      if (afterQuote) throw new Error('CSV 第 ' + line + ' 行:引号结束后出现多余字符');
      if (c === '"') throw new Error('CSV 第 ' + line + ' 行:未加引号的字段里出现裸双引号,请把整个字段用引号包住并把 " 写成 ""');
      cell += c; hasCell = true; i++;
    }
    if (hasCell || cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
    return rows;
  }

  function parseCsvTranslations(text) {
    var rows = parseCsv(text);
    if (rows.length === 0) throw new Error('CSV 为空');
    var header = rows[0].map(function (h) { return h.trim(); });
    if (header[0].toLowerCase() !== 'key') throw new Error('CSV 第一列表头必须是 key');
    var langs = header.slice(1);
    if (langs.length === 0) throw new Error('CSV 至少需要一个语言列');
    var low = new Set();
    langs.forEach(function (l) {
      if (!isValidLang(l)) throw new Error('CSV 表头 "' + l + '" 不是有效的语言代码');
      if (low.has(l.toLowerCase())) throw new Error('CSV 表头语言重复:' + l);
      low.add(l.toLowerCase());
    });
    var files = langs.map(function (l) { return { lang: l, format: 'csv', nested: false, entries: [] }; });
    var seen = new Set();
    for (var r = 1; r < rows.length; r++) {
      var cells = rows[r];
      if (cells.every(function (c) { return c === ''; })) continue;
      if (cells.length !== header.length) throw new Error('CSV 第 ' + (r + 1) + ' 行有 ' + cells.length + ' 列,表头有 ' + header.length + ' 列');
      var key = cells[0].trim();
      if (key === '') throw new Error('CSV 第 ' + (r + 1) + ' 行键名为空');
      if (seen.has(key)) throw new Error('CSV 第 ' + (r + 1) + ' 行键重复:' + key);
      seen.add(key);
      for (var c = 0; c < files.length; c++) files[c].entries.push([key, cells[c + 1]]);
    }
    if (seen.size === 0) throw new Error('CSV 没有任何键');
    return files;
  }

  /* 通用入口:返回文件数组(CSV 可含多个语言)。无法识别或不合法时抛出带原因的 Error。 */
  function importText(text, lang, name) {
    var fmt = detectFormat(text);
    if (fmt === 'empty') throw new Error('文件为空');
    if (fmt === 'unknown') throw new Error('无法识别格式(支持 JSON、.properties、CSV)');
    if (fmt === 'csv') {
      return parseCsvTranslations(text).map(function (f) { f.name = name || 'CSV'; return f; });
    }
    if (!isValidLang(lang)) throw new Error('请填写有效的语言代码,例如 zh、en、zh-CN');
    var parsed = fmt === 'json' ? parseJson(text) : parseProperties(text);
    return [{ lang: lang, name: name || '', format: fmt, nested: fmt === 'json' ? parsed.nested : false, entries: parsed.entries }];
  }

  function guessLang(filename) {
    if (!isStr(filename)) return null;
    var base = filename.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');
    function ok(c) { return isValidLang(c) && KNOWN_LANGS.indexOf(primary(c)) >= 0; }
    if (ok(base)) return base;
    var m = /[._-]([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})?)$/.exec(base);
    return m && ok(m[1]) ? m[1] : null;
  }

  /* ---------- 占位符与 HTML ---------- */
  var PH_RE = /\{\{\s*([^{}]+?)\s*\}\}|\$t\(([^()]*)\)|%(?:\d+\$)?[-+0#]*\d*(?:\.\d+)?[sdfiuxXeEgGcb@]|\{\s*([A-Za-z0-9_][\w.\-]*)\s*(?:,[^{}]*)?\}/g;
  function placeholders(s) {
    if (!isStr(s)) return [];
    var text = s.replace(/%%/g, '');
    var out = [];
    var seen = new Set();
    var m;
    PH_RE.lastIndex = 0;
    while ((m = PH_RE.exec(text)) !== null) {
      var tok = m[1] !== undefined ? '{{' + m[1] + '}}' : m[2] !== undefined ? '$t(' + m[2].trim() + ')' : m[3] !== undefined ? '{' + m[3] + '}' : m[0];
      if (!seen.has(tok)) { seen.add(tok); out.push(tok); }
    }
    return out;
  }

  var VOID_TAGS = { br: 1, hr: 1, img: 1, input: 1, wbr: 1 };
  function htmlTags(s) {
    if (!isStr(s)) return [];
    var re = /<(\/?)([A-Za-z][A-Za-z0-9:-]*)(?:\s[^<>]*?)?(\/?)>/g;
    var out = [];
    var seen = new Set();
    var m;
    while ((m = re.exec(s)) !== null) {
      var name = m[2];
      var tok;
      if (m[1]) tok = '</' + name + '>';
      else if (m[3] && !VOID_TAGS[name.toLowerCase()]) tok = '<' + name + '/>';
      else tok = '<' + name + '>';
      if (!seen.has(tok)) { seen.add(tok); out.push(tok); }
    }
    return out;
  }

  function diffSets(a, b) {
    var sb = new Set(b), sa = new Set(a);
    return { missing: a.filter(function (x) { return !sb.has(x); }), extra: b.filter(function (x) { return !sa.has(x); }) };
  }

  /* ---------- 复数 ---------- */
  function pluralParts(key) {
    var m = /^(.+)([_.])(zero|one|two|few|many|other)$/.exec(key);
    return m ? { base: m[1], sep: m[2], form: m[3], gid: m[1] + m[2] } : null;
  }
  function requiredForms(lang) { return PLURAL_REQ[primary(lang)] || ['other']; }

  /* ---------- 选项与校验 ---------- */
  function globToRegex(g) {
    return new RegExp('^' + g.split('*').map(function (p) { return p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'); }).join('.*') + '$');
  }
  function normalizeOptions(o) {
    o = o || {};
    var allow = Array.isArray(o.allowSame) ? o.allowSame.filter(function (x) { return isStr(x) && x.trim() !== ''; }).map(function (x) { return x.trim(); }) : [];
    var kp = o.keyPattern === undefined ? DEFAULT_KEY_PATTERN : o.keyPattern;
    var keyRe = null;
    if (kp !== '') {
      if (!isStr(kp)) throw new Error('键名正则必须是字符串');
      try { keyRe = new RegExp(kp); } catch (e) { throw new Error('键名正则无效:' + e.message); }
    }
    var hi = o.ratioHigh === undefined ? 3 : o.ratioHigh;
    var lo = o.ratioLow === undefined ? 0.3 : o.ratioLow;
    if (typeof hi !== 'number' || typeof lo !== 'number' || !(hi > 0) || !(lo > 0)) throw new Error('长度比阈值必须是正数');
    return { allowRe: allow.map(globToRegex), keyRe: keyRe, hi: hi, lo: lo };
  }

  function checkFiles(files, sourceLang) {
    if (!Array.isArray(files)) throw new Error('files 必须是数组');
    var seen = new Set();
    files.forEach(function (f) {
      if (!f || !isValidLang(f.lang) || !Array.isArray(f.entries)) throw new Error('文件缺少有效的语言代码或键值表');
      var l = f.lang.toLowerCase();
      if (seen.has(l)) throw new Error('语言重复:' + f.lang);
      seen.add(l);
    });
    var src = files.filter(function (f) { return f.lang === sourceLang; })[0];
    if (!src) throw new Error('源语言 ' + sourceLang + ' 没有对应的文件');
    return src;
  }

  /* 显示宽度:CJK / 假名 / 谚文 / 全角字符算 2,其余算 1。SPEC 的长度比阈值用它计算,
     否则中文源文本对拉丁语系译文几乎每条都会超过 3 倍。 */
  function len(s) {
    var w = 0;
    Array.from(s.trim()).forEach(function (ch) {
      var c = ch.codePointAt(0);
      var wide = (c >= 0x1100 && c <= 0x115F) || (c >= 0x2E80 && c <= 0x303E) || (c >= 0x3041 && c <= 0x33FF) ||
        (c >= 0x3400 && c <= 0x4DBF) || (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0xA000 && c <= 0xA4CF) ||
        (c >= 0xAC00 && c <= 0xD7A3) || (c >= 0xF900 && c <= 0xFAFF) || (c >= 0xFE30 && c <= 0xFE4F) ||
        (c >= 0xFF00 && c <= 0xFF60) || (c >= 0xFFE0 && c <= 0xFFE6) || (c >= 0x20000 && c <= 0x3FFFD);
      w += wide ? 2 : 1;
    });
    return w;
  }

  /* ---------- 核对 ---------- */
  function check(files, sourceLang, options) {
    var opt = normalizeOptions(options);
    var src = checkFiles(files, sourceLang);
    var maps = new Map();
    files.forEach(function (f) { maps.set(f.lang, toMap(f.entries)); });
    var srcMap = maps.get(src.lang);
    var srcKeys = src.entries.map(function (e) { return e[0]; });
    var targets = files.filter(function (f) { return f !== src; });
    var issues = [];
    function add(level, type, lang, key, message, extra) {
      var it = { level: level, type: type, lang: lang, key: key, message: message };
      if (extra) Object.keys(extra).forEach(function (k) { it[k] = extra[k]; });
      issues.push(it);
    }
    function allowed(key) { return opt.allowRe.some(function (re) { return re.test(key); }); }

    /* 复数分组:任一文件里出现 base_other / base.other / base_one 才视为复数组 */
    var pluralGids = new Set();
    files.forEach(function (f) {
      f.entries.forEach(function (e) {
        var p = pluralParts(e[0]);
        if (p && (p.form === 'other' || (p.form === 'one' && p.sep === '_'))) pluralGids.add(p.gid);
      });
    });
    function groupsOf(f) {
      var g = new Map();
      f.entries.forEach(function (e) {
        var p = pluralParts(e[0]);
        if (!p || !pluralGids.has(p.gid)) return;
        if (!g.has(p.gid)) g.set(p.gid, new Map());
        g.get(p.gid).set(p.form, { key: e[0], value: e[1] });
      });
      return g;
    }
    var groups = new Map();
    files.forEach(function (f) { groups.set(f.lang, groupsOf(f)); });
    function pluralGidOf(key) { var p = pluralParts(key); return p && pluralGids.has(p.gid) ? p.gid : null; }
    /* 复数形式键:该形式是否是 lang 需要的类别 */
    function formRequired(lang, key) {
      var p = pluralParts(key);
      return !(p && pluralGids.has(p.gid)) || requiredForms(lang).indexOf(p.form) >= 0;
    }

    /* 按实际键计算;只有「该语言不需要的复数形式」缺失时算不适用(视为已覆盖) */
    function covered(lang, key) {
      var v = maps.get(lang).get(key);
      if (v !== undefined) return !isBlank(v);
      return !formRequired(lang, key);
    }

    /* 空文件 */
    files.forEach(function (f) {
      if (f.entries.length === 0) add('block', 'emptyfile', f.lang, '', '文件里没有任何键');
    });

    var suspectSame = new Map();
    files.forEach(function (f) { suspectSame.set(f.lang, new Set()); });

    /* 目标语言逐键 */
    targets.forEach(function (t) {
      var tm = maps.get(t.lang);
      src.entries.forEach(function (e) {
        var key = e[0], sv = e[1];
        var tv = tm.get(key);
        if (tv === undefined) {
          if (!formRequired(t.lang, key)) return;
          add('block', 'missing', t.lang, key, '源语言有这个键,' + t.lang + ' 没有', { source: sv });
          return;
        }
        if (isBlank(tv)) { add('block', 'empty', t.lang, key, '值为空', { source: sv, value: tv }); return; }
        if (isBlank(sv)) return;
        var pd = diffSets(placeholders(sv), placeholders(tv));
        if (pd.missing.length || pd.extra.length) {
          add('block', 'placeholder', t.lang, key, '占位符不一致:' + (pd.missing.length ? '缺 ' + pd.missing.join('、') : '') + (pd.missing.length && pd.extra.length ? ';' : '') + (pd.extra.length ? '多 ' + pd.extra.join('、') : ''), { source: sv, value: tv });
        }
        var hd = diffSets(htmlTags(sv), htmlTags(tv));
        if (hd.missing.length || hd.extra.length) {
          add('block', 'html', t.lang, key, 'HTML 标签不一致:' + (hd.missing.length ? '缺 ' + hd.missing.join('、') : '') + (hd.missing.length && hd.extra.length ? ';' : '') + (hd.extra.length ? '多 ' + hd.extra.join('、') : ''), { source: sv, value: tv });
        }
        if (tv.trim() === sv.trim()) {
          if (!allowed(key)) { suspectSame.get(t.lang).add(key); add('warn', 'same', t.lang, key, '译文与源语言完全相同,疑似未翻译', { source: sv, value: tv }); }
        } else {
          var ls = len(sv), lt = len(tv);
          if (ls > 0) {
            var r = lt / ls;
            if (r > opt.hi || r < opt.lo) add('warn', 'ratio', t.lang, key, '长度比 ' + r.toFixed(2) + '(显示宽度:源 ' + ls + ',译 ' + lt + ')', { source: sv, value: tv });
          }
        }
      });
      t.entries.forEach(function (e) {
        if (srcMap.has(e[0])) return;
        if (pluralGidOf(e[0]) !== null && formRequired(t.lang, e[0])) return;
        add('block', 'extra', t.lang, e[0], '源语言没有这个键', { value: e[1] });
      });
    });

    /* 源语言空值 */
    src.entries.forEach(function (e) {
      if (isBlank(e[1])) add('block', 'empty', src.lang, e[0], '值为空', { value: e[1] });
    });

    /* 键名约定:每个键只报一次 */
    if (opt.keyRe) {
      var reported = new Set();
      [src].concat(targets).forEach(function (f) {
        f.entries.forEach(function (e) {
          if (reported.has(e[0])) return;
          if (!opt.keyRe.test(e[0])) { reported.add(e[0]); add('warn', 'keyname', f.lang, e[0], '键名不符合约定'); }
        });
      });
    }

    /* 复数形式 */
    files.forEach(function (f) {
      var req = requiredForms(f.lang);
      groups.get(f.lang).forEach(function (forms, gid) {
        var absent = req.filter(function (x) { return !forms.has(x) || isBlank(forms.get(x).value); });
        if (absent.length === 0) return;
        var firstKey = forms.values().next().value.key;
        var sep = gid[gid.length - 1];
        add('warn', 'plural', f.lang, firstKey, '复数形式不完整:' + f.lang + ' 需要 ' + req.join('/') + ',缺 ' + absent.map(function (x) { return sep + x; }).join('、'));
      });
    });

    /* 同源文本不同译法 */
    var bySrc = new Map();
    src.entries.forEach(function (e) {
      var t = e[1].trim();
      if (t === '') return;
      if (!bySrc.has(t)) bySrc.set(t, []);
      bySrc.get(t).push(e[0]);
    });
    targets.forEach(function (t) {
      var tm = maps.get(t.lang);
      bySrc.forEach(function (keys, text) {
        if (keys.length < 2) return;
        var vals = new Map();
        keys.forEach(function (k) {
          var v = tm.get(k);
          if (v === undefined || isBlank(v)) return;
          var tv = v.trim();
          if (!vals.has(tv)) vals.set(tv, []);
          vals.get(tv).push(k);
        });
        if (vals.size < 2) return;
        var variants = Array.from(vals.keys());
        add('warn', 'inconsistent', t.lang, keys[0], '源文本「' + text + '」在 ' + keys.join('、') + ' 下有 ' + vals.size + ' 种译法:' + variants.join(' / '), { source: text, related: keys.slice() });
      });
    });

    /* 统计 */
    var total = srcKeys.length;
    var langStats = files.map(function (f) {
      var isSrc = f === src;
      var cov = 0, unt = 0;
      srcKeys.forEach(function (k) {
        var c = covered(f.lang, k);
        if (c) cov++;
        if (!isSrc && (!c || suspectSame.get(f.lang).has(k))) unt++;
      });
      var li = issues.filter(function (i) { return i.lang === f.lang; });
      return {
        lang: f.lang, isSource: isSrc, keys: f.entries.length, total: total, covered: cov,
        coverage: total ? cov / total : 0, untranslated: unt, untranslatedRate: total ? unt / total : 0,
        missing: li.filter(function (i) { return i.type === 'missing'; }).length,
        extra: li.filter(function (i) { return i.type === 'extra'; }).length,
        empty: li.filter(function (i) { return i.type === 'empty'; }).length,
        blockers: li.filter(function (i) { return i.level === 'block'; }).length,
        warnings: li.filter(function (i) { return i.level === 'warn'; }).length,
        issues: li.length
      };
    });
    var tStats = langStats.filter(function (s) { return !s.isSource; });
    var denom = total * tStats.length;
    var sumCov = tStats.reduce(function (a, s) { return a + s.covered; }, 0);
    var sumUnt = tStats.reduce(function (a, s) { return a + s.untranslated; }, 0);
    var stats = {
      sourceLang: src.lang, total: total, langs: langStats,
      overall: {
        coverage: denom ? sumCov / denom : 0, untranslatedRate: denom ? sumUnt / denom : 0,
        targetCount: tStats.length, keyCount: total,
        blockers: issues.filter(function (i) { return i.level === 'block'; }).length,
        warnings: issues.filter(function (i) { return i.level === 'warn'; }).length,
        issues: issues.length
      }
    };
    return { issues: issues, stats: stats };
  }

  /* ---------- CSV 输出与公式防护 ---------- */
  function protectCell(s) {
    s = s === null || s === undefined ? '' : String(s);
    if (s === '-' || s === '+') return s;
    return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  }
  function csvCell(v) {
    var s = protectCell(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(rows) {
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\n') + '\n';
  }
  /* 还原本工具加的公式防护前缀(仅当去掉前缀后以公式字符开头) */
  function unprotectCell(s) { return /^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s; }

  /* ---------- 待翻译表与合并 ---------- */
  function pluralKeyIn(files, gid) {
    return files.some(function (f) {
      return f.entries.some(function (e) {
        var q = pluralParts(e[0]);
        return q && q.gid === gid && (q.form === 'other' || (q.form === 'one' && q.sep === '_'));
      });
    });
  }

  function todoTable(files, sourceLang, options) {
    options = options || {};
    var src = checkFiles(files, sourceLang);
    var res = check(files, sourceLang, options);
    var targets = files.filter(function (f) { return f !== src; });
    var sameSet = new Set();
    if (options.includeSame) {
      res.issues.forEach(function (i) { if (i.type === 'same') sameSet.add(i.lang + '\u0000' + i.key); });
    }
    var needs = new Map();
    targets.forEach(function (t) {
      var tm = toMap(t.entries);
      var pl = new Set();
      src.entries.forEach(function (e) {
        var key = e[0];
        if (isBlank(e[1])) return;
        var v = tm.get(key);
        var need = false;
        if (v === undefined) {
          var p = pluralParts(key);
          need = !p || !pluralKeyIn(files, p.gid) || requiredForms(t.lang).indexOf(p.form) >= 0;
        } else if (isBlank(v)) need = true;
        else if (sameSet.has(t.lang + '\u0000' + key)) need = true;
        if (need) pl.add(key);
      });
      needs.set(t.lang, pl);
    });
    var rows = [['key', 'source:' + src.lang].concat(targets.map(function (t) { return t.lang; }))];
    var count = 0;
    src.entries.forEach(function (e) {
      var any = targets.some(function (t) { return needs.get(t.lang).has(e[0]); });
      if (!any) return;
      count++;
      rows.push([e[0], e[1]].concat(targets.map(function () { return ''; })));
    });
    return { csv: toCsv(rows), rows: count, rowsData: rows };
  }

  function merge(files, todoCsv, options) {
    options = options || {};
    var overwrite = !!options.overwrite;
    var rows = parseCsv(todoCsv);
    if (rows.length === 0) throw new Error('待翻译表为空');
    var header = rows[0].map(function (h) { return h.trim(); });
    if (header[0].toLowerCase() !== 'key') throw new Error('第一列表头必须是 key');
    var byLang = new Map();
    files.forEach(function (f) { byLang.set(f.lang.toLowerCase(), f); });
    var cols = [];
    var seenCols = new Set();
    for (var c = 1; c < header.length; c++) {
      var h = header[c];
      if (/^source:/i.test(h)) continue;
      var f = byLang.get(h.toLowerCase());
      if (!f) throw new Error('列 "' + h + '" 不是已导入的语言');
      if (seenCols.has(f.lang)) throw new Error('语言列重复:' + h);
      seenCols.add(f.lang);
      cols.push({ idx: c, file: f });
    }
    if (cols.length === 0) throw new Error('没有可合并的语言列');
    var known = new Set();
    files.forEach(function (f) { f.entries.forEach(function (e) { known.add(e[0]); }); });
    var order = [];
    files.forEach(function (f) { f.entries.forEach(function (e) { if (order.indexOf(e[0]) < 0) order.push(e[0]); }); });
    var fills = new Map();
    cols.forEach(function (col) { fills.set(col.file.lang, new Map()); });
    var seenKeys = new Set();
    var unknown = [];
    for (var r = 1; r < rows.length; r++) {
      var cells = rows[r];
      if (cells.every(function (x) { return x === ''; })) continue;
      if (cells.length !== header.length) throw new Error('第 ' + (r + 1) + ' 行有 ' + cells.length + ' 列,表头有 ' + header.length + ' 列');
      var rawKey = cells[0].trim();
      var key = known.has(rawKey) ? rawKey : unprotectCell(rawKey);
      if (key === '') throw new Error('第 ' + (r + 1) + ' 行键名为空');
      if (seenKeys.has(key)) throw new Error('第 ' + (r + 1) + ' 行键重复:' + key);
      seenKeys.add(key);
      if (!known.has(key)) { unknown.push(key); continue; }
      cols.forEach(function (col) {
        var v = cells[col.idx];
        if (v.trim() === '') return;
        fills.get(col.file.lang).set(key, unprotectCell(v));
      });
    }
    if (unknown.length) throw new Error('待翻译表里有 ' + unknown.length + ' 个键不在任何已导入文件中:' + unknown.slice(0, 5).join('、') + (unknown.length > 5 ? ' 等' : ''));

    var summary = { filled: 0, overwritten: 0, keptExisting: 0, unchanged: 0, changes: [] };
    var out = files.map(function (f) {
      var fm = fills.get(f.lang);
      if (!fm) return f;
      var entries = f.entries.map(function (e) { return [e[0], e[1]]; });
      var idxOf = new Map();
      entries.forEach(function (e, i) { idxOf.set(e[0], i); });
      order.forEach(function (key, oi) {
        if (!fm.has(key)) return;
        var nv = fm.get(key);
        if (idxOf.has(key)) {
          var i = idxOf.get(key);
          if (isBlank(entries[i][1])) { entries[i][1] = nv; summary.filled++; summary.changes.push({ lang: f.lang, key: key, kind: 'fill' }); }
          else if (overwrite) {
            if (entries[i][1] === nv) summary.unchanged++;
            else { entries[i][1] = nv; summary.overwritten++; summary.changes.push({ lang: f.lang, key: key, kind: 'overwrite' }); }
          } else summary.keptExisting++;
        } else {
          var pos = 0;
          for (var p = oi - 1; p >= 0; p--) {
            if (idxOf.has(order[p])) { pos = idxOf.get(order[p]) + 1; break; }
          }
          entries.splice(pos, 0, [key, nv]);
          idxOf = new Map();
          entries.forEach(function (e, ii) { idxOf.set(e[0], ii); });
          summary.filled++; summary.changes.push({ lang: f.lang, key: key, kind: 'fill' });
        }
      });
      var copy = {};
      Object.keys(f).forEach(function (k) { copy[k] = f[k]; });
      copy.entries = entries;
      return copy;
    });
    return { files: out, summary: summary };
  }

  /* ---------- 导出 ---------- */
  function toJson(entries, nested) {
    var obj;
    if (nested) obj = unflatten(entries);
    else {
      obj = Object.create(null);
      entries.forEach(function (e) { define(obj, e[0], e[1]); });
    }
    return JSON.stringify(obj, null, 2) + '\n';
  }

  function mdCell(v) {
    var s = protectCell(v === undefined || v === null ? '' : v);
    return s.replace(/\r?\n|\r/g, '\\n').replace(/\|/g, '\\|').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function pct(x) { return (x * 100).toFixed(1) + '%'; }
  function levelLabel(l) { return l === 'block' ? '阻断' : '警告'; }

  function reportToMarkdown(result) {
    var st = result.stats;
    var o = st.overall;
    var lines = [];
    lines.push('# 多语言文案键核对报告', '');
    lines.push('- 源语言:' + mdCell(st.sourceLang) + '(' + st.total + ' 个键)');
    lines.push('- 目标语言:' + o.targetCount + ' 种,整体覆盖率 ' + pct(o.coverage) + ',未译率 ' + pct(o.untranslatedRate));
    lines.push('- 阻断 ' + o.blockers + ' 条,警告 ' + o.warnings + ' 条', '');
    lines.push('## 各语言统计', '');
    lines.push('| 语言 | 键数 | 覆盖率 | 未译率 | 阻断 | 警告 |', '| --- | --- | --- | --- | --- | --- |');
    st.langs.forEach(function (s) {
      lines.push('| ' + mdCell(s.lang) + (s.isSource ? '(源)' : '') + ' | ' + s.keys + ' | ' + pct(s.coverage) + ' | ' + (s.isSource ? '-' : pct(s.untranslatedRate)) + ' | ' + s.blockers + ' | ' + s.warnings + ' |');
    });
    lines.push('');
    ['block', 'warn'].forEach(function (lv) {
      var list = result.issues.filter(function (i) { return i.level === lv; });
      lines.push('## ' + levelLabel(lv) + '(' + list.length + ')', '');
      if (!list.length) { lines.push('无。', ''); return; }
      lines.push('| 语言 | 键 | 类型 | 说明 |', '| --- | --- | --- | --- |');
      list.forEach(function (i) {
        lines.push('| ' + mdCell(i.lang) + ' | ' + mdCell(i.key) + ' | ' + TYPE_LABELS[i.type] + ' | ' + mdCell(i.message) + ' |');
      });
      lines.push('');
    });
    return lines.join('\n');
  }

  function reportToCsv(result) {
    var rows = [['级别', '语言', '键', '类型', '说明', '源文本', '当前译文']];
    result.issues.forEach(function (i) {
      rows.push([levelLabel(i.level), i.lang, i.key, TYPE_LABELS[i.type], i.message, i.source || '', i.value || '']);
    });
    return toCsv(rows);
  }

  /* ---------- 持久化状态校验(保存前与读取后共用) ---------- */
  function validateState(state) {
    function bad(msg) { return { ok: false, error: msg }; }
    if (!state || typeof state !== 'object' || Array.isArray(state)) return bad('状态不是对象');
    if (state.v !== 1) return bad('版本号不是 1');
    if (!Array.isArray(state.files)) return bad('files 不是数组');
    var langs = new Set();
    var files = [];
    for (var i = 0; i < state.files.length; i++) {
      var f = state.files[i];
      if (!f || typeof f !== 'object') return bad('第 ' + (i + 1) + ' 个文件不是对象');
      if (!isValidLang(f.lang)) return bad('第 ' + (i + 1) + ' 个文件的语言代码无效');
      var low = f.lang.toLowerCase();
      if (langs.has(low)) return bad('语言重复:' + f.lang);
      langs.add(low);
      if (FORMATS.indexOf(f.format) < 0) return bad(f.lang + ' 的格式不在 json/properties/csv 之内');
      if (typeof f.nested !== 'boolean') return bad(f.lang + ' 的 nested 不是布尔值');
      if (f.name !== undefined && !isStr(f.name)) return bad(f.lang + ' 的 name 不是字符串');
      if (!Array.isArray(f.entries)) return bad(f.lang + ' 的 entries 不是数组');
      var keys = new Set();
      var entries = [];
      for (var j = 0; j < f.entries.length; j++) {
        var e = f.entries[j];
        if (!Array.isArray(e) || e.length !== 2 || !isStr(e[0]) || !isStr(e[1])) return bad(f.lang + ' 第 ' + (j + 1) + ' 条不是 [键, 值] 字符串对');
        if (e[0] === '') return bad(f.lang + ' 第 ' + (j + 1) + ' 条键名为空');
        if (keys.has(e[0])) return bad(f.lang + ' 键重复:' + e[0]);
        keys.add(e[0]);
        entries.push([e[0], e[1]]);
      }
      files.push({ lang: f.lang, name: f.name || '', format: f.format, nested: f.nested, entries: entries });
    }
    if (!isStr(state.source)) return bad('source 不是字符串');
    if (files.length === 0 && state.source !== '') return bad('没有文件时 source 必须为空');
    if (files.length > 0 && !files.some(function (f) { return f.lang === state.source; })) return bad('源语言不在已导入的文件里');
    var o = state.options;
    if (!o || typeof o !== 'object') return bad('options 缺失');
    if (!Array.isArray(o.allowSame) || !o.allowSame.every(function (x) { return isStr(x) && x.trim() !== ''; })) return bad('allowSame 必须是非空字符串数组');
    if (!isStr(o.keyPattern)) return bad('keyPattern 必须是字符串');
    if (o.keyPattern !== '') { try { new RegExp(o.keyPattern); } catch (err) { return bad('keyPattern 不是有效正则'); } }
    return { ok: true, data: { v: 1, source: state.source, files: files, options: { allowSame: o.allowSame.slice(), keyPattern: o.keyPattern } } };
  }

  function emptyState() {
    return { v: 1, source: '', files: [], options: { allowSame: [], keyPattern: DEFAULT_KEY_PATTERN } };
  }

  /* 设置是否偏离默认值(用于「载入示例 / 导入备份」是否需要确认) */
  function hasCustomOptions(o) {
    if (!o || typeof o !== 'object') return false;
    return (Array.isArray(o.allowSame) && o.allowSame.length > 0) || (typeof o.keyPattern === 'string' && o.keyPattern !== DEFAULT_KEY_PATTERN);
  }

  /* 移除一份语言文件前的说明:键数、是否源语言、移除后会选用哪个源语言 */
  function describeRemoval(files, source, lang) {
    var f = files.filter(function (x) { return x.lang === lang; })[0];
    if (!f) return null;
    var rest = files.filter(function (x) { return x.lang !== lang; });
    var wasSource = lang === source;
    return { lang: lang, keys: f.entries.length, wasSource: wasSource, nextSource: wasSource ? (rest.length ? rest[0].lang : '') : source };
  }

  var api = {
    hasCustomOptions: hasCustomOptions, describeRemoval: describeRemoval,
    DEFAULT_KEY_PATTERN: DEFAULT_KEY_PATTERN, TYPE_LABELS: TYPE_LABELS, BLOCK_TYPES: BLOCK_TYPES, FORMS: FORMS,
    detectFormat: detectFormat, parseJson: parseJson, flatten: flatten, unflatten: unflatten,
    parseProperties: parseProperties, parseCsv: parseCsv, parseCsvTranslations: parseCsvTranslations,
    importText: importText, guessLang: guessLang, isValidLang: isValidLang,
    placeholders: placeholders, htmlTags: htmlTags, check: check, todoTable: todoTable, merge: merge,
    toJson: toJson, toCsv: toCsv, protectCell: protectCell, reportToMarkdown: reportToMarkdown, reportToCsv: reportToCsv,
    validateState: validateState, emptyState: emptyState
  };
  globalThis.I18nKeyCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
