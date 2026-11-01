'use strict';
/* 正则样例验收 · 纯逻辑(无 DOM)。 */

const FLAG_CHARS = 'gimsu';
const TIMEOUT_MS = 2000;
const DEFAULT_MAX_INPUT = 10000;
const MAX_INPUT_LIMIT = 10000000;
const UNCAPTURED = '(未捕获)';
const APP_ID = 'regex-acceptance';
const STATE_VERSION = 1;

/* ---------- 标志与编译 ---------- */

function checkFlags(flags) {
  if (typeof flags !== 'string') return { ok: false, error: '标志必须是文字' };
  const seen = new Set();
  for (const ch of flags) {
    if (FLAG_CHARS.indexOf(ch) < 0) return { ok: false, error: '不支持的标志「' + ch + '」,只支持 g i m s u' };
    if (seen.has(ch)) return { ok: false, error: '标志「' + ch + '」重复' };
    seen.add(ch);
  }
  return { ok: true };
}

const MSG = {
  group: '括号 ( 没有对应的右括号 )',
  unmatched: '多余的右括号 ),前面没有对应的 (',
  nothing: '量词(* + ? {})前面没有可重复的内容',
  cls: '字符类 [ 没有对应的 ]',
  backslash: '反斜杠 \\ 出现在末尾,后面缺少字符',
  order: '{m,n} 中 m 大于 n',
  range: '字符类里的范围起止顺序颠倒',
  badGroup: '无法识别的分组写法(?…)',
  incomplete: 'u 标志下 { 必须是完整的量词'
};

/* 编译失败后,自己扫一遍定位出错字符(0 起始)。找不到就返回 null。 */
function diagnose(p, flags) {
  const u = flags.indexOf('u') >= 0;
  const stack = [];
  let canRepeat = false, afterQuant = false, lazyDone = false;
  let i = 0;
  const atom = () => { canRepeat = true; afterQuant = false; lazyDone = false; };
  const nonAtom = () => { canRepeat = false; afterQuant = false; lazyDone = false; };
  while (i < p.length) {
    const c = p[i];
    if (c === '\\') {
      if (i + 1 >= p.length) return { pos: i, message: MSG.backslash };
      i += 2; atom(); continue;
    }
    if (c === '[') {
      let j = i + 1;
      if (p[j] === '^') j++;
      const bodyStart = j;
      let closed = false;
      while (j < p.length) {
        if (p[j] === '\\') { j += 2; continue; }
        if (p[j] === ']') { closed = true; break; }
        j++;
      }
      if (!closed) return { pos: i, message: MSG.cls };
      for (let k = bodyStart + 1; k < j - 1; k++) {
        if (p[k] === '-' && p[k - 1] !== '\\' && p[k + 1] !== '\\' && p[k - 1] > p[k + 1] && (k - 2 < bodyStart || p[k - 2] !== '\\')) {
          return { pos: k - 1, message: MSG.range };
        }
      }
      i = j + 1; atom(); continue;
    }
    if (c === '(') {
      stack.push(i); i++;
      if (p[i] === '?') {
        const n = p[i + 1];
        if (n === ':' || n === '=' || n === '!') i += 2;
        else if (n === '<' && (p[i + 2] === '=' || p[i + 2] === '!')) i += 3;
        else if (n === '<') {
          const e = p.indexOf('>', i);
          if (e < 0) return { pos: i - 1, message: MSG.badGroup };
          i = e + 1;
        } else return { pos: i - 1, message: MSG.badGroup };
      }
      nonAtom(); continue;
    }
    if (c === ')') {
      if (!stack.length) return { pos: i, message: MSG.unmatched };
      stack.pop(); i++; atom(); continue;
    }
    if (c === '|') { i++; nonAtom(); continue; }
    if (c === '^' || c === '$') { i++; nonAtom(); continue; }
    if (c === '*' || c === '+' || c === '?') {
      if (afterQuant && c === '?' && !lazyDone) { lazyDone = true; i++; continue; }
      if (!canRepeat || afterQuant) return { pos: i, message: MSG.nothing };
      afterQuant = true; lazyDone = false; i++; continue;
    }
    if (c === '{') {
      const m = /^\{(\d+)(?:,(\d*))?\}/.exec(p.slice(i));
      if (m) {
        if (!canRepeat || afterQuant) return { pos: i, message: MSG.nothing };
        if (m[2] !== undefined && m[2] !== '' && Number(m[2]) < Number(m[1])) return { pos: i, message: MSG.order };
        afterQuant = true; lazyDone = false; i += m[0].length; continue;
      }
      if (u) return { pos: i, message: MSG.incomplete };
    }
    i++; atom();
  }
  if (stack.length) return { pos: stack[stack.length - 1], message: MSG.group };
  return null;
}

function translateEngineMessage(msg) {
  const table = [
    [/Unterminated group/, MSG.group], [/Unmatched '\)'/, MSG.unmatched], [/Nothing to repeat/, MSG.nothing],
    [/Unterminated character class/, MSG.cls], [/\\ at end of pattern/, MSG.backslash],
    [/numbers out of order/, MSG.order], [/Range out of order/, MSG.range], [/Invalid group/, MSG.badGroup],
    [/Invalid escape|Invalid Unicode escape|Invalid unicode escape/, '无效的转义写法'],
    [/Invalid property name/, '无效的 Unicode 属性名'], [/Invalid named reference|Invalid named capture/, '命名组引用无效'],
    [/Duplicate capture group name/, '命名组名称重复'], [/Incomplete quantifier/, MSG.incomplete],
    [/Lone quantifier brackets/, '孤立的 { 或 },u 标志下需要转义'], [/Invalid flags/, '标志无效']
  ];
  for (const [re, zh] of table) if (re.test(msg)) return zh;
  return '语法错误(' + msg + ')';
}

function compile(pattern, flags) {
  if (typeof pattern !== 'string') return { ok: false, error: '正则必须是文字', pos: null };
  const f = flags == null ? '' : flags;
  const fc = checkFlags(f);
  if (!fc.ok) return { ok: false, error: fc.error, pos: null };
  try {
    return { ok: true, re: new RegExp(pattern, f) };
  } catch (e) {
    const d = diagnose(pattern, f);
    const detail = String(e && e.message || e);
    if (d) return { ok: false, error: d.message, pos: d.pos, detail };
    return { ok: false, error: translateEngineMessage(detail), pos: null, detail };
  }
}

/* ---------- 单条执行(自包含:会被序列化进 Worker,不能引用外部变量) ---------- */

function execCaseImpl(re, input, spec, maxLen) {
  if (typeof maxLen === 'number' && input.length > maxLen) {
    return { pass: false, actual: null, code: 'toolong', reason: '输入过长', detail: '输入有 ' + input.length + ' 个字符,超过上限 ' + maxLen };
  }
  re.lastIndex = 0;
  const m = re.exec(input);
  let actual;
  if (!m) {
    actual = { matched: false, index: -1, end: -1, match: null, groups: [], named: [], count: 0 };
  } else {
    const named = [];
    if (m.groups) for (const k of Object.keys(m.groups)) named.push([k, m.groups[k]]);
    actual = { matched: true, index: m.index, end: m.index + m[0].length, match: m[0], groups: Array.prototype.slice.call(m, 1), named: named, count: 1 };
    if (re.global) {
      re.lastIndex = 0;
      let n = 0, mm;
      while ((mm = re.exec(input)) !== null) {
        n++;
        if (mm[0] === '') {
          const hi = input.charCodeAt(re.lastIndex), lo = input.charCodeAt(re.lastIndex + 1);
          re.lastIndex += (re.unicode && hi >= 0xD800 && hi <= 0xDBFF && lo >= 0xDC00 && lo <= 0xDFFF) ? 2 : 1;
        }
        if (n >= 10000) break;
      }
      actual.count = n;
    }
  }
  re.lastIndex = 0;
  const want = typeof spec === 'string' ? spec : spec.expect;
  const caps = (typeof spec === 'object' && spec && spec.captures) || [];
  if (want === 'match' && !actual.matched) return { pass: false, actual: actual, code: 'missed', reason: '应匹配但未匹配', detail: '' };
  if (want === 'nomatch' && actual.matched) return { pass: false, actual: actual, code: 'unexpected', reason: '不应匹配却匹配', detail: '匹配到「' + actual.match + '」,位置 ' + actual.index + '–' + actual.end };
  if (want === 'match' && caps.length) {
    const diffs = [];
    const show = v => (v === null || v === undefined) ? '未捕获' : '「' + v + '」';
    for (let k = 0; k < caps.length; k++) {
      if (k >= actual.groups.length) { diffs.push('第' + (k + 1) + '组:正则只有 ' + actual.groups.length + ' 个捕获组'); continue; }
      const act = actual.groups[k] === undefined ? null : actual.groups[k];
      if (caps[k] !== act) diffs.push('第' + (k + 1) + '组:期望' + show(caps[k]) + ',实际' + show(act));
    }
    if (diffs.length) return { pass: false, actual: actual, code: 'capture', reason: '捕获不符', detail: diffs.join(';') };
  }
  return { pass: true, actual: actual, code: 'ok', reason: '', detail: '' };
}

function runCase(re, input, expect, opts) {
  const maxLen = opts && typeof opts.maxInput === 'number' ? opts.maxInput : undefined;
  return execCaseImpl(re, input, expect, maxLen);
}

function makeResult(index, c, r) {
  return Object.assign({ index: index, input: c.input, expect: c.expect, captures: c.captures || [] }, r);
}

function makeTimeoutResult(index, c, ms) {
  return makeResult(index, c, { pass: false, actual: null, code: 'timeout', reason: '疑似灾难性回溯', detail: '超过 ' + (ms / 1000) + ' 秒仍未完成,已中止' });
}

function makeSkippedResult(index, c) {
  return makeResult(index, c, { pass: false, actual: null, code: 'skipped', reason: '未运行(已手动停止验收)', detail: '' });
}

/* 未运行(skipped)不算通过也不算失败;通过率的分母是「已运行」条数 */
function buildStats(results) {
  const byCode = Object.create(null);
  for (const k of ['missed', 'unexpected', 'capture', 'timeout', 'toolong']) byCode[k] = 0;
  let passed = 0, skipped = 0;
  for (const r of results) {
    if (r.pass) passed++;
    else if (r.code === 'skipped') skipped++;
    else byCode[r.code] = (byCode[r.code] || 0) + 1;
  }
  const total = results.length;
  const ran = total - skipped;
  return { total: total, ran: ran, skipped: skipped, passed: passed, failed: ran - passed, rate: ran ? passed / ran : null, byCode: byCode };
}

function runAll(pattern, flags, cases, opts) {
  const c = compile(pattern, flags);
  if (!c.ok) return { ok: false, error: c.error, pos: c.pos, results: [], stats: buildStats([]) };
  const o = opts || {};
  const maxInput = typeof o.maxInput === 'number' ? o.maxInput : DEFAULT_MAX_INPUT;
  const results = cases.map((cs, i) => makeResult(i, cs, runCase(c.re, cs.input, cs, { maxInput: maxInput })));
  return { ok: true, results: results, stats: buildStats(results) };
}

/* Worker 脚本:用 execCaseImpl 的源码拼出自包含脚本。 */
function workerBody(execFn) {
  self.onmessage = function (e) {
    const d = e.data;
    let re;
    try { re = new RegExp(d.pattern, d.flags); } catch (err) { self.postMessage({ type: 'error', message: String(err && err.message) }); return; }
    for (let i = d.start; i < d.cases.length; i++) {
      const r = execFn(re, d.cases[i].input, d.cases[i], d.maxInput);
      self.postMessage({ type: 'result', index: i, result: r });
    }
    self.postMessage({ type: 'done' });
  };
}

function workerSource() {
  return 'const execCaseImpl = ' + execCaseImpl.toString() + ';\n(' + workerBody.toString() + ')(execCaseImpl);';
}

/* ---------- 样例表解析与格式化 ---------- */

const EXPECT_WORD = { match: '匹配', nomatch: '不匹配' };

function splitUnescaped(line) {
  const fields = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && line[i + 1] === '|') { cur += '|'; i++; continue; }
    if (ch === '|') { fields.push(cur); cur = ''; continue; }
    cur += ch;
  }
  fields.push(cur);
  return fields;
}

function decodeCaptureFields(fields, firstIsFirst) {
  return fields.map((f, idx) => {
    let v = f;
    if (!(firstIsFirst && idx === 0) && v.startsWith(' ')) v = v.slice(1);
    if (idx < fields.length - 1 && v.endsWith(' ')) v = v.slice(0, -1);
    return v === UNCAPTURED ? null : v;
  });
}

function parseCases(text) {
  const cases = [];
  const errors = [];
  if (typeof text !== 'string') return { ok: false, cases: [], errors: [{ line: 0, message: '样例表必须是文字' }] };
  const lines = text.split(/\r\n|\r|\n/);
  lines.forEach((line, idx) => {
    if (line.trim() === '') return;
    const n = idx + 1;
    const fields = splitUnescaped(line);
    if (fields.length < 2) { errors.push({ line: n, message: '第 ' + n + ' 行缺少「|」和期望(匹配 或 不匹配)' }); return; }
    const word = fields[1].trim();
    let expect = null;
    if (word === '匹配') expect = 'match'; else if (word === '不匹配') expect = 'nomatch';
    if (!expect) { errors.push({ line: n, message: '第 ' + n + ' 行期望必须是「匹配」或「不匹配」,而不是「' + word + '」' }); return; }
    let input = fields[0];
    if (input.endsWith(' ')) input = input.slice(0, -1);
    const capFields = fields.slice(2);
    let captures = [];
    if (capFields.length) {
      const dec = capFields.map((f, k) => {
        let v = f;
        if (v.startsWith(' ')) v = v.slice(1);
        if (k < capFields.length - 1 && v.endsWith(' ')) v = v.slice(0, -1);
        return v === UNCAPTURED ? null : v;
      });
      captures = expect === 'match' ? dec : [];
    }
    cases.push({ input: input, expect: expect, captures: captures });
  });
  return { ok: errors.length === 0, cases: cases, errors: errors };
}

function escPipe(s) { return s.replace(/\|/g, '\\|'); }
function encodeCaptures(caps) { return caps.map(c => c === null ? UNCAPTURED : escPipe(c)).join(' | '); }

/* CSV 单元格:未指定捕获 = 空单元格;指定了(含 [""])= JSON 数组串,二者可区分。 */
function encodeCaptureCell(caps) { return caps.length ? JSON.stringify(caps) : ''; }
function decodeCaptureCell(text) {
  if (text === '') return { ok: true, captures: [] };
  let v;
  try { v = JSON.parse(text); } catch (e) { return { ok: false }; }
  if (!Array.isArray(v) || !v.length || v.some(x => x !== null && typeof x !== 'string')) return { ok: false };
  return { ok: true, captures: v };
}

function formatCases(cases) {
  return cases.map(c => escPipe(c.input) + ' | ' + EXPECT_WORD[c.expect] + (c.captures && c.captures.length ? ' | ' + encodeCaptures(c.captures) : '')).join('\n');
}

/* ---------- 解释器 ---------- */

const ESC_EXPLAIN = {
  d: '数字 0-9', D: '任意非数字字符', w: '字母、数字或下划线', W: '任意非字母数字下划线的字符',
  s: '空白字符(空格、制表符、换行等)', S: '任意非空白字符', n: '换行符', r: '回车符', t: '制表符', f: '换页符', v: '垂直制表符', '0': '空字符 NUL'
};

function describeQuant(raw) {
  const lazy = raw.length > 1 && raw[raw.length - 1] === '?' && raw !== '??';
  const body = lazy ? raw.slice(0, -1) : raw;
  let t;
  if (body === '*') t = '重复 0 次或多次';
  else if (body === '+') t = '重复 1 次或多次';
  else if (body === '?') t = '出现 0 次或 1 次(可选)';
  else {
    const m = /^\{(\d+)(?:(,)(\d*))?\}$/.exec(body);
    if (!m) return null;
    if (!m[2]) t = '正好重复 ' + m[1] + ' 次';
    else if (m[3] === '') t = '至少重复 ' + m[1] + ' 次';
    else t = '重复 ' + m[1] + ' 到 ' + m[3] + ' 次';
  }
  return t + (lazy ? '(懒惰:尽量少匹配)' : '(贪婪:尽量多匹配)');
}

function quantAt(p, i) {
  const c = p[i];
  let m;
  if (c === '*' || c === '+' || c === '?') m = c;
  else if (c === '{') { const r = /^\{\d+(?:,\d*)?\}/.exec(p.slice(i)); if (!r) return null; m = r[0]; }
  else return null;
  if (p[i + m.length] === '?') m += '?';
  return m;
}

function describeClass(body, negated) {
  const parts = [];
  let i = 0;
  const one = () => {
    if (body[i] === '\\' && i + 1 < body.length) {
      const n = body[i + 1];
      i += 2;
      return { text: ESC_EXPLAIN[n] || n, simple: ESC_EXPLAIN[n] === undefined ? n : null };
    }
    const ch = body[i++];
    return { text: ch, simple: ch };
  };
  while (i < body.length) {
    const a = one();
    if (a.simple !== null && body[i] === '-' && i + 1 < body.length) {
      i++;
      const b = one();
      parts.push(a.text + ' 到 ' + b.text);
    } else parts.push(a.text);
  }
  return '字符类:匹配' + (negated ? '除以下之外的任意字符 ' : '以下任一字符 ') + (parts.length ? parts.join('、') : '(空)');
}

function tokenize(p) {
  const tokens = [];
  const open = [];
  let groupNo = 0;
  let i = 0;
  const push = (type, raw, explain) => tokens.push({ type: type, raw: raw, explain: explain });
  const SPECIAL = '\\[()|^$.*+?';
  const canQuantify = () => {
    const last = tokens[tokens.length - 1];
    return !!last && ['literal', 'escape', 'class', 'any'].indexOf(last.type) >= 0 || (!!last && last.type === 'group' && last.raw === ')');
  };
  while (i < p.length) {
    const c = p[i];
    const rest = p.slice(i);
    if (c === '\\') {
      const n = p[i + 1];
      let m;
      if (n === undefined) { push('unparsed', '\\', '未解析:末尾的反斜杠'); i++; continue; }
      if (n === 'u' && (m = /^\\u(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]+\})/.exec(rest))) { push('escape', m[0], 'Unicode 字符 ' + m[0].slice(2)); i += m[0].length; continue; }
      if (n === 'x' && (m = /^\\x[0-9a-fA-F]{2}/.exec(rest))) { push('escape', m[0], '十六进制字符 ' + m[0].slice(2)); i += m[0].length; continue; }
      if (n === 'k' && (m = /^\\k<([^>]+)>/.exec(rest))) { push('escape', m[0], '反向引用命名组「' + m[1] + '」'); i += m[0].length; continue; }
      if ((n === 'p' || n === 'P') && (m = /^\\[pP]\{[^}]+\}/.exec(rest))) { push('escape', m[0], (n === 'p' ? '属于' : '不属于') + ' Unicode 属性 ' + m[0].slice(3, -1) + '(需要 u 标志)'); i += m[0].length; continue; }
      if (/[1-9]/.test(n)) { m = /^\\[1-9]\d*/.exec(rest); push('escape', m[0], '反向引用第 ' + m[0].slice(1) + ' 组捕获的内容'); i += m[0].length; continue; }
      if (n === 'b') { push('anchor', '\\b', '单词边界(锚点)'); i += 2; continue; }
      if (n === 'B') { push('anchor', '\\B', '非单词边界(锚点)'); i += 2; continue; }
      if (ESC_EXPLAIN[n] !== undefined) { push('escape', '\\' + n, ESC_EXPLAIN[n]); i += 2; continue; }
      if (/[A-Za-z]/.test(n)) { push('unparsed', '\\' + n, '未解析:不常见的转义 \\' + n); i += 2; continue; }
      push('escape', '\\' + n, '转义后的字面字符 ' + n); i += 2; continue;
    }
    if (c === '[') {
      let j = i + 1;
      let negated = false;
      if (p[j] === '^') { negated = true; j++; }
      const bodyStart = j;
      let closed = false;
      while (j < p.length) {
        if (p[j] === '\\') { j += 2; continue; }
        if (p[j] === ']') { closed = true; break; }
        j++;
      }
      if (!closed) { push('unparsed', p.slice(i), '未解析:字符类缺少结尾的 ]'); i = p.length; continue; }
      push('class', p.slice(i, j + 1), describeClass(p.slice(bodyStart, j), negated));
      i = j + 1; continue;
    }
    if (c === '(') {
      let raw = '(', explain, capturing = false;
      if (p[i + 1] === '?') {
        let m;
        if (p.startsWith('(?:', i)) { raw = '(?:'; explain = '非捕获分组开始'; }
        else if (p.startsWith('(?=', i)) { raw = '(?='; explain = '正向先行断言开始(后面必须是……)'; }
        else if (p.startsWith('(?!', i)) { raw = '(?!'; explain = '负向先行断言开始(后面不能是……)'; }
        else if (p.startsWith('(?<=', i)) { raw = '(?<='; explain = '正向后行断言开始(前面必须是……)'; }
        else if (p.startsWith('(?<!', i)) { raw = '(?<!'; explain = '负向后行断言开始(前面不能是……)'; }
        else if ((m = /^\(\?<([A-Za-z_$][\w$]*)>/.exec(rest))) { raw = m[0]; capturing = true; groupNo++; explain = '命名捕获组开始,名称「' + m[1] + '」(第 ' + groupNo + ' 组)'; }
        else { push('unparsed', '(?', '未解析:不常见的分组写法'); open.push({ label: null }); i += 2; continue; }
      } else { capturing = true; groupNo++; explain = '捕获组开始(第 ' + groupNo + ' 组)'; }
      open.push({ label: capturing ? groupNo : null });
      push('group', raw, explain); i += raw.length; continue;
    }
    if (c === ')') {
      if (!open.length) { push('unparsed', ')', '未解析:多余的右括号'); i++; continue; }
      const o = open.pop();
      push('group', ')', o.label ? '分组结束(第 ' + o.label + ' 组)' : '分组结束');
      i++; continue;
    }
    if (c === '|') { push('alternation', '|', '或:匹配左边或右边的写法'); i++; continue; }
    if (c === '^') { push('anchor', '^', '开头锚点(开启 m 标志时是每行开头)'); i++; continue; }
    if (c === '$') { push('anchor', '$', '结尾锚点(开启 m 标志时是每行结尾)'); i++; continue; }
    if (c === '.') { push('any', '.', '任意一个字符(默认不含换行,开启 s 标志后含换行)'); i++; continue; }
    const q = quantAt(p, i);
    if (q !== null) {
      if (!canQuantify()) { push('unparsed', q, '未解析:量词前面没有可重复的内容'); }
      else push('quantifier', q, describeQuant(q));
      i += q.length; continue;
    }
    let j = i;
    while (j < p.length && SPECIAL.indexOf(p[j]) < 0 && !(p[j] === '{' && quantAt(p, j) !== null)) j++;
    if (j === i) j = i + 1;
    let run = p.slice(i, j);
    if (run.length > 1 && j < p.length && quantAt(p, j) !== null) { run = p.slice(i, j - 1); j = j - 1; }
    push('literal', run, /^ +$/.test(run) ? '空格 ' + run.length + ' 个' : (run.length === 1 ? '字面字符 ' : '字面文字 ') + run);
    i = j;
  }
  for (let k = 0; k < open.length; k++) {
    tokens.push({ type: 'unparsed', raw: '', explain: '未解析:有分组没有闭合' });
  }
  return tokens;
}

/* ---------- CSV ---------- */

function needsFormulaGuard(s) {
  return /^'*[=+@-]/.test(s) && s !== '-' && s !== '+';
}
function guardCell(v) {
  const s = String(v);
  return needsFormulaGuard(s) ? "'" + s : s;
}
function unguardCell(s) {
  return /^'+[=+@-]/.test(s) ? s.slice(1) : s;
}
function csvQuote(s) {
  return /[",\r\n]/.test(s) || s !== s.trim() ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function actualSummary(r) {
  if (!r.actual) return r.code === 'timeout' ? '已中止' : (r.code === 'skipped' ? '未运行' : '未执行');
  if (!r.actual.matched) return '未匹配';
  return '匹配「' + r.actual.match + '」位置 ' + r.actual.index + '–' + r.actual.end +
    (r.actual.groups.length ? ';捕获 ' + r.actual.groups.map((g, k) => (k + 1) + '=' + (g === undefined ? '未捕获' : '「' + g + '」')).join(' ') : '');
}

function toCsv(cases, results) {
  const withResults = Array.isArray(results) && results.length === cases.length && cases.length > 0;
  const head = ['输入', '期望', '期望捕获'].concat(withResults ? ['结果', '实际', '失败原因'] : []);
  const rows = [head.join(',')];
  cases.forEach((c, i) => {
    const cells = [guardCell(c.input), EXPECT_WORD[c.expect], guardCell(encodeCaptureCell(c.captures || []))];
    if (withResults) {
      const r = results[i];
      cells.push(r.pass ? '通过' : (r.code === 'skipped' ? '未运行' : '失败'), guardCell(actualSummary(r)), guardCell(r.pass ? '' : r.reason + (r.detail ? ':' + r.detail : '')));
    }
    rows.push(cells.map(csvQuote).join(','));
  });
  return '﻿' + rows.join('\r\n') + '\r\n';
}

function parseCsv(text) {
  let s = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  const rows = [];
  let row = [], field = '';
  let i = 0, line = 1, inQuotes = false, justClosed = false, fieldStarted = false;
  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; justClosed = true; i++; continue;
      }
      if (ch === '\n') line++;
      field += ch; i++; continue;
    }
    if (ch === '"') {
      if (fieldStarted || justClosed) return { ok: false, error: '第 ' + line + ' 行的引号位置不合规(引号只能包住整个单元格)' };
      inQuotes = true; fieldStarted = true; i++; continue;
    }
    if (justClosed && ch !== ',' && ch !== '\r' && ch !== '\n') return { ok: false, error: '第 ' + line + ' 行引号结束后还有多余字符' };
    if (ch === ',') { row.push(field); field = ''; justClosed = false; fieldStarted = false; i++; continue; }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = ''; justClosed = false; fieldStarted = false; line++; i++; continue;
    }
    field += ch; fieldStarted = true; i++;
  }
  if (inQuotes) return { ok: false, error: '引号没有闭合(从第 ' + line + ' 行附近开始)' };
  if (field !== '' || row.length || justClosed || fieldStarted) { row.push(field); rows.push(row); }
  return { ok: true, rows: rows };
}

function csvToCases(text) {
  if (typeof text !== 'string') return { ok: false, errors: ['内容必须是文字'] };
  const p = parseCsv(text);
  if (!p.ok) return { ok: false, errors: [p.error] };
  const rows = p.rows;
  if (!rows.length || rows[0][0] !== '输入' || rows[0][1] !== '期望') return { ok: false, errors: ['缺少表头:第一行必须以「输入,期望」开头(用本工具导出的 CSV)'] };
  const cases = [];
  const errors = [];
  for (let k = 1; k < rows.length; k++) {
    const r = rows[k];
    const n = k + 1;
    if (r.length === 1 && r[0] === '') continue;
    if (r.length < 2) { errors.push('第 ' + n + ' 行列数不足'); continue; }
    const input = unguardCell(r[0]);
    const expect = r[1] === '匹配' ? 'match' : r[1] === '不匹配' ? 'nomatch' : null;
    if (!expect) { errors.push('第 ' + n + ' 行期望必须是「匹配」或「不匹配」,而不是「' + r[1] + '」'); continue; }
    if (/[\r\n]/.test(input)) { errors.push('第 ' + n + ' 行输入含换行,样例表不支持'); continue; }
    let captures = [];
    const capText = r.length > 2 ? unguardCell(r[2]) : '';
    if (capText !== '') {
      const d = decodeCaptureCell(capText);
      if (!d.ok) { errors.push('第 ' + n + ' 行期望捕获必须是空,或 JSON 数组(元素为文字或 null),例如 ["a",null,""]'); continue; }
      if (d.captures.some(x => x !== null && /[\r\n]/.test(x))) { errors.push('第 ' + n + ' 行期望捕获含换行,样例表不支持'); continue; }
      captures = expect === 'match' ? d.captures : [];
    }
    cases.push({ input: input, expect: expect, captures: captures });
  }
  if (errors.length) return { ok: false, errors: errors };
  return { ok: true, cases: cases, errors: [] };
}

/* ---------- Markdown 报告 ---------- */

function mdCell(v) {
  return guardCell(String(v)).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r\n|\r|\n/g, ' ');
}

function formatRate(stats) {
  if (stats.skipped) {
    return '已运行 ' + stats.ran + '/' + stats.total + ' 条:' + (stats.ran ? '通过 ' + stats.passed + '(' + (stats.rate * 100).toFixed(1) + '%)' : '尚无结果') + ',另有 ' + stats.skipped + ' 条未运行';
  }
  return stats.total ? stats.passed + '/' + stats.total + '(' + (stats.rate * 100).toFixed(1) + '%)' : '没有样例';
}

function reportToMarkdown(data) {
  const stats = data.stats || buildStats(data.results || []);
  const results = data.results || [];
  const pattern = String(data.pattern == null ? '' : data.pattern);
  const runs = pattern.match(/`+/g) || [];
  const fence = '`'.repeat(Math.max(3, runs.reduce((m, r) => Math.max(m, r.length), 0) + 1));
  const out = ['# 正则样例验收报告', ''];
  if (data.name) out.push('- 名称:' + String(data.name).replace(/\r\n|\r|\n/g, ' '));
  out.push('- 标志:' + (data.flags ? data.flags : '(无)'));
  out.push('- 通过率:' + formatRate(stats));
  if (stats.skipped) out.push('- 未运行:' + stats.skipped + ' 条(已手动停止验收,这些样例没有结果;通过率只统计已运行的样例)');
  out.push('- 失败:' + stats.failed + ' 条' + (stats.failed ? '(应匹配未匹配 ' + stats.byCode.missed + ',不应匹配却匹配 ' + stats.byCode.unexpected + ',捕获不符 ' + stats.byCode.capture + ',疑似回溯 ' + stats.byCode.timeout + ',输入过长 ' + stats.byCode.toolong + ')' : ''));
  out.push('', '## 正则', '', fence, pattern, fence, '', '## 失败清单', '');
  const fails = results.filter(r => !r.pass && r.code !== 'skipped');
  if (!stats.total) out.push('没有样例。');
  else if (!fails.length) out.push(stats.skipped ? '已运行的样例全部通过(另有 ' + stats.skipped + ' 条未运行)。' : '全部通过。');
  else {
    out.push('| 序号 | 输入 | 期望 | 实际 | 原因 |', '| --- | --- | --- | --- | --- |');
    for (const r of fails) {
      const exp = EXPECT_WORD[r.expect] + (r.captures && r.captures.length ? ' [' + r.captures.map(c => c === null ? '未捕获' : c).join(' / ') + ']' : '');
      out.push('| ' + [r.index + 1, mdCell(r.input), mdCell(exp), mdCell(actualSummary(r)), mdCell(r.reason + (r.detail ? ':' + r.detail : ''))].join(' | ') + ' |');
    }
  }
  out.push('', '以上由「正则样例验收」本机生成;结果只证明这些样例,不证明正则在其他输入上正确。', '');
  return out.join('\n');
}

/* ---------- 状态校验与导入 ---------- */

function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function bad(error) { return { ok: false, error: error }; }
function validMaxInput(n) { return Number.isInteger(n) && n >= 1 && n <= MAX_INPUT_LIMIT; }

function validateCaseObj(c, where) {
  if (!isObj(c)) return where + ':样例不是对象';
  if (typeof c.input !== 'string') return where + ':input 必须是文字';
  if (/[\r\n]/.test(c.input)) return where + ':input 不能含换行';
  if (c.expect !== 'match' && c.expect !== 'nomatch') return where + ':expect 必须是 match 或 nomatch';
  if (!Array.isArray(c.captures)) return where + ':captures 必须是数组';
  for (const v of c.captures) {
    if (v !== null && typeof v !== 'string') return where + ':captures 里只能是文字或 null';
    if (typeof v === 'string' && /[\r\n]/.test(v)) return where + ':captures 不能含换行';
  }
  return null;
}

function validateState(s) {
  if (!isObj(s)) return bad('数据不是对象');
  if (s.version !== STATE_VERSION) return bad('version 必须是 ' + STATE_VERSION);
  const d = s.draft;
  if (!isObj(d)) return bad('draft 必须是对象');
  if (typeof d.name !== 'string') return bad('draft.name 必须是文字');
  if (typeof d.pattern !== 'string') return bad('draft.pattern 必须是文字');
  if (typeof d.cases !== 'string') return bad('draft.cases 必须是文字');
  const fc = checkFlags(d.flags);
  if (!fc.ok) return bad('draft.flags:' + fc.error);
  if (!validMaxInput(d.maxInput)) return bad('draft.maxInput 必须是 1 到 ' + MAX_INPUT_LIMIT + ' 的整数');
  if (!Array.isArray(s.library)) return bad('library 必须是数组');
  const ids = new Set();
  for (let k = 0; k < s.library.length; k++) {
    const e = s.library[k];
    const w = 'library[' + k + ']';
    if (!isObj(e)) return bad(w + ' 不是对象');
    if (typeof e.id !== 'string' || e.id === '') return bad(w + '.id 必须是非空文字');
    if (ids.has(e.id)) return bad(w + '.id「' + e.id + '」重复');
    ids.add(e.id);
    if (typeof e.name !== 'string' || e.name.trim() === '') return bad(w + '.name 必须是非空文字');
    if (typeof e.pattern !== 'string') return bad(w + '.pattern 必须是文字');
    const f2 = checkFlags(e.flags);
    if (!f2.ok) return bad(w + '.flags:' + f2.error);
    if (!validMaxInput(e.maxInput)) return bad(w + '.maxInput 必须是 1 到 ' + MAX_INPUT_LIMIT + ' 的整数');
    if (!Array.isArray(e.cases)) return bad(w + '.cases 必须是数组');
    for (let j = 0; j < e.cases.length; j++) {
      const err = validateCaseObj(e.cases[j], w + '.cases[' + j + ']');
      if (err) return bad(err);
    }
  }
  if (s.currentId !== null && (typeof s.currentId !== 'string' || !ids.has(s.currentId))) return bad('currentId 必须是 null 或样例库里存在的 id');
  return { ok: true };
}

function hasUserData(state) {
  const d = state.draft;
  return Boolean(d.name || d.pattern || d.cases.trim() || d.flags !== '' || d.maxInput !== DEFAULT_MAX_INPUT || state.library.length > 0);
}

function defaultState() {
  return { version: STATE_VERSION, draft: { name: '', pattern: '', flags: '', cases: '', maxInput: DEFAULT_MAX_INPUT }, library: [], currentId: null };
}

function exportBackup(state) {
  return JSON.stringify(Object.assign({ app: APP_ID }, state), null, 2);
}

function validateImport(input) {
  let obj = input;
  if (typeof input === 'string') {
    try { obj = JSON.parse(input); } catch (e) { return bad('不是合法 JSON:' + e.message); }
  }
  if (!isObj(obj)) return bad('备份内容不是对象');
  if (obj.app !== APP_ID) return bad('这不是本工具导出的备份(缺少 app: "' + APP_ID + '")');
  const state = { version: obj.version, draft: obj.draft, library: obj.library, currentId: obj.currentId === undefined ? null : obj.currentId };
  const v = validateState(state);
  if (!v.ok) return v;
  return { ok: true, state: state };
}

function newId() {
  return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function searchLibrary(library, q) {
  const k = String(q || '').trim().toLowerCase();
  if (!k) return library.slice();
  return library.filter(e => (e.name + '\n' + e.pattern).toLowerCase().indexOf(k) >= 0);
}

const api = {
  FLAG_CHARS, TIMEOUT_MS, DEFAULT_MAX_INPUT, MAX_INPUT_LIMIT, UNCAPTURED, STATE_VERSION,
  checkFlags, compile, runCase, runAll, makeResult, makeTimeoutResult, makeSkippedResult, hasUserData, buildStats, workerSource,
  parseCases, formatCases, tokenize, toCsv, csvToCases, parseCsv, reportToMarkdown, formatRate, actualSummary,
  validateState, validateImport, defaultState, exportBackup, newId, searchLibrary, validMaxInput
};
globalThis.RegexCore = api;
if (typeof module !== 'undefined') module.exports = api;
