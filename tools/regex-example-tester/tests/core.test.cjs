'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const C = require('../core.js');

const m = (input, captures) => ({ input, expect: 'match', captures: captures || [] });
const n = input => ({ input, expect: 'nomatch', captures: [] });

test('compile:成功返回 re;非法标志被拒绝', () => {
  const ok = C.compile('a+b', 'gi');
  assert.equal(ok.ok, true);
  assert.equal(ok.re.flags, 'gi');
  assert.equal(C.compile('a', 'x').ok, false);
  assert.equal(C.compile('a', 'gg').ok, false);
  assert.equal(C.compile('a', 'y').ok, false);
});

test('compile 错误给出位置与中文原因', () => {
  let r = C.compile('ab(cd', '');
  assert.deepEqual([r.ok, r.pos], [false, 2]);
  assert.match(r.error, /右括号/);
  r = C.compile('ab)', '');
  assert.deepEqual([r.ok, r.pos], [false, 2]);
  r = C.compile('a**', '');
  assert.deepEqual([r.ok, r.pos], [false, 2]);
  assert.match(r.error, /量词/);
  r = C.compile('*a', '');
  assert.equal(r.pos, 0);
  r = C.compile('x[a-z', '');
  assert.deepEqual([r.ok, r.pos], [false, 1]);
  r = C.compile('abc\\', '');
  assert.deepEqual([r.ok, r.pos], [false, 3]);
  r = C.compile('ok{3,1}', '');
  assert.deepEqual([r.ok, r.pos], [false, 2]);
  r = C.compile('[z-a]', '');
  assert.equal(r.ok, false);
  assert.equal(r.pos, 1);
});

test('compile:合法但相似的写法不被误判(懒惰量词、字面 { 、命名组)', () => {
  for (const p of ['a+?', 'a{,3}', 'x{', '(?<y>\\d{4})', '(?:a|b)*', '[]]', '(?=a)b']) {
    assert.equal(C.compile(p, '').ok, true, p);
  }
  assert.equal(C.compile('x{', 'u').ok, false);
});

test('runCase 三种失败原因 + 通过', () => {
  const re = /^\d{3}$/;
  assert.equal(C.runCase(re, '123', { expect: 'match', captures: [] }).pass, true);
  const missed = C.runCase(re, '12', { expect: 'match', captures: [] });
  assert.deepEqual([missed.pass, missed.code, missed.reason], [false, 'missed', '应匹配但未匹配']);
  const extra = C.runCase(re, '123', { expect: 'nomatch', captures: [] });
  assert.deepEqual([extra.pass, extra.code, extra.reason], [false, 'unexpected', '不应匹配却匹配']);
  const cap = C.runCase(/^(\d)(\d)/, '12', { expect: 'match', captures: ['1', '3'] });
  assert.deepEqual([cap.pass, cap.code, cap.reason], [false, 'capture', '捕获不符']);
  assert.match(cap.detail, /第2组/);
});

test('actual 含匹配位置与捕获', () => {
  const r = C.runCase(/(\d+)-(\d+)/, 'tel 12-345 end', { expect: 'match', captures: [] });
  assert.equal(r.actual.index, 4);
  assert.equal(r.actual.end, 10);
  assert.equal(r.actual.match, '12-345');
  assert.deepEqual(r.actual.groups, ['12', '345']);
});

test('捕获对比:未捕获(undefined)与空字符串不同', () => {
  const re = /^(a)?(b*)$/;
  const rUn = C.runCase(re, 'bb', { expect: 'match', captures: [null, 'bb'] });
  assert.equal(rUn.pass, true);
  assert.equal(C.runCase(re, 'bb', { expect: 'match', captures: ['', 'bb'] }).pass, false);
  const rEmpty = C.runCase(re, 'a', { expect: 'match', captures: ['a', ''] });
  assert.equal(rEmpty.pass, true);
  assert.equal(C.runCase(re, 'a', { expect: 'match', captures: ['a', null] }).pass, false);
  const tooMany = C.runCase(/(a)/, 'a', { expect: 'match', captures: ['a', 'b'] });
  assert.equal(tooMany.pass, false);
  assert.match(tooMany.detail, /只有 1 个捕获组/);
});

test('标志 g:lastIndex 先复位,执行后也复位,重复运行结果一致', () => {
  const re = /a(\d)/g;
  re.lastIndex = 5;
  const spec = { expect: 'match', captures: ['1'] };
  const r1 = C.runCase(re, 'a1 a2 a3', spec);
  assert.equal(r1.pass, true);
  assert.equal(re.lastIndex, 0);
  const r2 = C.runCase(re, 'a1 a2 a3', spec);
  assert.deepEqual(r2.actual, r1.actual);
  assert.equal(r1.actual.count, 3);
  const z = C.runCase(/x*/g, 'abc', { expect: 'match', captures: [] });
  assert.equal(z.actual.count, 4);
});

test('超长输入被拒绝(同步版),恰好等于上限则放行', () => {
  const re = /a+/;
  const r = C.runCase(re, 'a'.repeat(11), { expect: 'match', captures: [] }, { maxInput: 10 });
  assert.deepEqual([r.pass, r.code, r.reason], [false, 'toolong', '输入过长']);
  assert.match(r.detail, /11/);
  assert.equal(C.runCase(re, 'a'.repeat(10), { expect: 'match', captures: [] }, { maxInput: 10 }).pass, true);
});

test('parseCases:非法期望整份拒绝并给行号', () => {
  const r = C.parseCases('ok | 匹配\nbad | maybe\nnoseparator');
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 2);
  assert.equal(r.errors[0].line, 2);
  assert.equal(r.errors[1].line, 3);
});

test('parseCases:正常行的字段内容', () => {
  const r = C.parseCases('a\\|b | 匹配 | x\\|y | (未捕获) | \n 13800000000 | 不匹配 | ignored\n | 匹配');
  assert.equal(r.ok, true);
  assert.deepEqual(r.cases, [
    { input: 'a|b', expect: 'match', captures: ['x|y', null, ''] },
    { input: ' 13800000000', expect: 'nomatch', captures: [] },
    { input: '', expect: 'match', captures: [] }
  ]);
});

test('formatCases 与 parseCases 互为逆运算(含空格、竖线、未捕获)', () => {
  const cases = [
    { input: '  a | b  ', expect: 'match', captures: ['x ', null, '', 'p|q'] },
    { input: '', expect: 'nomatch', captures: [] },
    { input: 'C:\\new\\|', expect: 'match', captures: ['\\'] }
  ];
  const back = C.parseCases(C.formatCases(cases));
  assert.equal(back.ok, true);
  assert.deepEqual(back.cases, cases);
});

test('空样例:parseCases 与 runAll 都不报错,通过率为 null', () => {
  assert.deepEqual(C.parseCases('  \n\n'), { ok: true, cases: [], errors: [] });
  const r = C.runAll('a', '', []);
  assert.equal(r.ok, true);
  assert.equal(r.stats.total, 0);
  assert.equal(r.stats.rate, null);
  assert.equal(C.formatRate(r.stats), '没有样例');
});

test('runAll:stats 通过率与按原因计数;编译失败不执行', () => {
  const r = C.runAll('^1\\d{2}$', '', [m('123'), m('12'), n('123'), n('abc'), m('1ab')]);
  assert.equal(r.ok, true);
  assert.equal(r.stats.total, 5);
  assert.equal(r.stats.passed, 2);
  assert.equal(r.stats.failed, 3);
  assert.equal(r.stats.rate, 0.4);
  assert.deepEqual([r.stats.byCode.missed, r.stats.byCode.unexpected, r.stats.byCode.capture], [2, 1, 0]);
  assert.equal(C.formatRate(r.stats), '2/5(40.0%)');
  const bad = C.runAll('(', '', [m('x')]);
  assert.equal(bad.ok, false);
  assert.equal(bad.results.length, 0);
});

test('runAll:maxInput 默认值生效,超长样例判失败而不是执行', () => {
  const r = C.runAll('a', '', [m('a'.repeat(C.DEFAULT_MAX_INPUT + 1))]);
  assert.equal(r.results[0].code, 'toolong');
  assert.equal(r.stats.byCode.toolong, 1);
});

test('tokenize:字符类、量词 {m,n}、分组、命名组、锚点、转义', () => {
  const t = C.tokenize('^(?<year>\\d{4})-([a-z0-9_]+)(?:x|y)?$');
  const sig = t.map(x => x.type + ':' + x.raw);
  assert.deepEqual(sig, [
    'anchor:^', 'group:(?<year>', 'escape:\\d', 'quantifier:{4}', 'group:)', 'literal:-',
    'group:(', 'class:[a-z0-9_]', 'quantifier:+', 'group:)', 'group:(?:', 'literal:x', 'alternation:|', 'literal:y', 'group:)', 'quantifier:?', 'anchor:$'
  ]);
  assert.match(t[1].explain, /year/);
  assert.match(t[1].explain, /第 1 组/);
  assert.match(t[3].explain, /正好重复 4 次/);
  assert.match(t[7].explain, /a 到 z/);
  assert.match(t[6].explain, /第 2 组/);
  assert.equal(t.some(x => x.type === 'unparsed'), false);
});

test('tokenize:量词只作用于最后一个字符;懒惰与区间量词说明', () => {
  const t = C.tokenize('abc+x{2,}y{1,3}?');
  assert.deepEqual(t.map(x => x.raw), ['ab', 'c', '+', 'x', '{2,}', 'y', '{1,3}?']);
  assert.match(t[4].explain, /至少重复 2 次/);
  assert.match(t[6].explain, /重复 1 到 3 次.*懒惰/);
});

test('tokenize:不支持的写法标「未解析」,不抛错', () => {
  const t = C.tokenize('\\cJ(?i:a)[abc*(');
  const un = t.filter(x => x.type === 'unparsed');
  assert.ok(un.length >= 3);
  assert.ok(un.every(x => x.explain.startsWith('未解析')));
  assert.equal(C.tokenize('').length, 0);
  assert.equal(C.tokenize('*a')[0].type, 'unparsed');
  assert.equal(C.tokenize('\\')[0].type, 'unparsed');
});

test('tokenize:反向引用、Unicode、断言', () => {
  const t = C.tokenize('(a)\\1\\u00e9\\p{L}(?=b)(?<!c)');
  assert.match(t.find(x => x.raw === '\\1').explain, /第 1 组/);
  assert.equal(t.find(x => x.raw === '\\u00e9').type, 'escape');
  assert.match(t.find(x => x.raw === '\\p{L}').explain, /u 标志/);
  assert.match(t.find(x => x.raw === '(?=').explain, /先行断言/);
  assert.match(t.find(x => x.raw === '(?<!').explain, /后行断言/);
});

test('CSV 公式防护:= + - @ 开头加单引号,单独的 - 或 + 不加', () => {
  const cases = [m('=1+1'), m('+49'), m('-5'), m('@SUM(A1)'), m('-'), m('+'), m('plain'), m("'=x")];
  const csv = C.toCsv(cases);
  const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines[1], "'=1+1,匹配,");
  assert.equal(lines[2], "'+49,匹配,");
  assert.equal(lines[3], "'-5,匹配,");
  assert.equal(lines[4], "'@SUM(A1),匹配,");
  assert.equal(lines[5], '-,匹配,');
  assert.equal(lines[6], '+,匹配,');
  assert.equal(lines[7], 'plain,匹配,');
  assert.equal(lines[8], "''=x,匹配,");
});

test('CSV 往返:引号、逗号、换行之外的字符、公式前缀、捕获都能还原', () => {
  const cases = [
    { input: 'a,"b"', expect: 'match', captures: ['1', null, 'x|y'] },
    { input: '=cmd', expect: 'nomatch', captures: [] },
    { input: "'=cmd", expect: 'match', captures: ['-5'] },
    { input: '  pad  ', expect: 'match', captures: [] },
    { input: '-', expect: 'match', captures: ['@a'] }
  ];
  const back = C.csvToCases(C.toCsv(cases));
  assert.equal(back.ok, true, JSON.stringify(back.errors));
  assert.deepEqual(back.cases, cases);
});

test('CSV 导出带结果列后仍可再导入(多余列被忽略)', () => {
  const cases = [m('123', ['1']), n('x')];
  const run = C.runAll('^(\\d)\\d+$', '', cases);
  const csv = C.toCsv(cases, run.results);
  assert.match(csv, /结果,实际,失败原因/);
  const back = C.csvToCases(csv);
  assert.equal(back.ok, true);
  assert.deepEqual(back.cases, cases);
});

test('CSV 导入:引号未闭合、非法期望、缺表头都整份拒绝', () => {
  assert.equal(C.csvToCases('输入,期望,期望捕获\r\n"abc,匹配,\r\n').ok, false);
  const e = C.csvToCases('输入,期望,期望捕获\r\na,匹配,\r\nb,也许,\r\nc,不匹配,');
  assert.equal(e.ok, false);
  assert.match(e.errors[0], /第 3 行/);
  assert.equal(C.csvToCases('a,匹配\r\n').ok, false);
  assert.equal(C.csvToCases('输入,期望\r\n"a"x,匹配\r\n').ok, false);
  assert.equal(C.csvToCases('输入,期望\r\n"a\nb",匹配\r\n').ok, false);
  const okWithQuotes = C.csvToCases('输入,期望\r\n"a ""q"" b",匹配\r\n');
  assert.equal(okWithQuotes.ok, true);
  assert.equal(okWithQuotes.cases[0].input, 'a "q" b');
});

test('reportToMarkdown:通过率、失败清单、竖线转义与公式防护', () => {
  const cases = [m('ok'), m('=A|B'), n('ok')];
  const run = C.runAll('^ok$', 'i', cases);
  const md = C.reportToMarkdown({ name: '测试', pattern: '^ok$', flags: 'i', results: run.results, stats: run.stats });
  assert.match(md, /通过率:1\/3\(33\.3%\)/);
  assert.match(md, /应匹配但未匹配/);
  assert.match(md, /不应匹配却匹配/);
  assert.ok(md.includes("'=A\\|B"));
  const clean = C.runAll('a', '', [m('a')]);
  assert.match(C.reportToMarkdown({ pattern: 'a', flags: '', results: clean.results, stats: clean.stats }), /全部通过/);
});

test('reportToMarkdown:正则含反引号时围栏更长', () => {
  const md = C.reportToMarkdown({ pattern: 'a```b', flags: '', results: [], stats: C.buildStats([]) });
  assert.ok(md.includes('````\na```b\n````'));
  assert.match(md, /没有样例/);
});

function goodState() {
  return {
    version: 1,
    draft: { name: 'n', pattern: '(', flags: 'gi', cases: 'half baked line', maxInput: 5 },
    library: [{ id: 'a', name: '手机号', pattern: '^1\\d{10}$', flags: '', maxInput: 100, cases: [m('13800000000'), { input: 'x', expect: 'match', captures: ['1', null] }] }],
    currentId: 'a'
  };
}

test('validateState:半成品草稿(非法正则、非法样例行)合法,与读取校验一致', () => {
  assert.equal(C.validateState(goodState()).ok, true);
  assert.equal(C.validateState(C.defaultState()).ok, true);
  const big = goodState();
  big.draft.pattern = 'a'.repeat(50000);
  big.draft.cases = 'x | 匹配\n'.repeat(5000);
  big.draft.maxInput = C.MAX_INPUT_LIMIT;
  assert.equal(C.validateState(JSON.parse(JSON.stringify(big))).ok, true);
});

test('validateImport:拒绝坏类型、坏枚举、重复 ID、坏标志、悬空 currentId,不静默修正', () => {
  const mutate = f => { const s = JSON.parse(C.exportBackup(goodState())); f(s); return C.validateImport(s); };
  assert.equal(C.validateImport(C.exportBackup(goodState())).ok, true);
  assert.equal(mutate(s => { s.app = 'other'; }).ok, false);
  assert.equal(mutate(s => { s.version = 2; }).ok, false);
  assert.equal(mutate(s => { s.draft.maxInput = '5'; }).ok, false);
  assert.equal(mutate(s => { s.draft.maxInput = 0; }).ok, false);
  assert.equal(mutate(s => { s.draft.flags = 'gx'; }).ok, false);
  assert.equal(mutate(s => { s.library[0].cases[0].expect = 'maybe'; }).ok, false);
  assert.equal(mutate(s => { s.library[0].cases[0].input = 5; }).ok, false);
  assert.equal(mutate(s => { s.library[0].cases[1].captures = ['a', 3]; }).ok, false);
  assert.equal(mutate(s => { s.library.push(JSON.parse(JSON.stringify(s.library[0]))); }).ok, false);
  assert.equal(mutate(s => { s.library[0].name = '  '; }).ok, false);
  assert.equal(mutate(s => { s.currentId = 'zzz'; }).ok, false);
  assert.equal(mutate(s => { s.library = {}; }).ok, false);
  const r = C.validateImport('{not json');
  assert.equal(r.ok, false);
  assert.match(r.error, /JSON/);
  assert.equal(C.validateImport('[]').ok, false);
});

test('validateImport:原型污染键不会污染对象,也不被当成合法数据', () => {
  const r = C.validateImport('{"app":"regex-acceptance","version":1,"__proto__":{"x":1},"draft":{"name":"","pattern":"","flags":"","cases":"","maxInput":10},"library":[],"currentId":null}');
  assert.equal(r.ok, true);
  assert.equal({}.x, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(r.state, 'x'), false);
});

test('searchLibrary:按名称或正则不区分大小写搜索', () => {
  const lib = [{ name: '手机号', pattern: '^1\\d{10}$' }, { name: 'Email', pattern: '@' }];
  assert.equal(C.searchLibrary(lib, 'email').length, 1);
  assert.equal(C.searchLibrary(lib, '手机').length, 1);
  assert.equal(C.searchLibrary(lib, '\\d').length, 1);
  assert.equal(C.searchLibrary(lib, '').length, 2);
  assert.equal(C.searchLibrary(lib, '__proto__').length, 0);
});

test('workerSource:自包含,可在隔离环境执行并产出与同步版相同的结果', () => {
  const posted = [];
  const ctx = { self: { postMessage: x => posted.push(x) }, RegExp, Object, Array };
  vm.createContext(ctx);
  vm.runInContext(C.workerSource(), ctx);
  const cases = [m('123'), n('123'), m('12', ['1'])];
  ctx.self.onmessage({ data: { pattern: '^(\\d)\\d+$', flags: '', cases, maxInput: 10, start: 1 } });
  assert.deepEqual(posted.map(p => p.type), ['result', 'result', 'done']);
  assert.equal(posted[0].index, 1);
  const sync = C.runAll('^(\\d)\\d+$', '', cases, { maxInput: 10 });
  assert.equal(posted[0].result.code, sync.results[1].code);
  assert.equal(posted[1].result.pass, sync.results[2].pass);
  posted.length = 0;
  ctx.self.onmessage({ data: { pattern: '(', flags: '', cases, maxInput: 10, start: 0 } });
  assert.equal(posted[0].type, 'error');
});

test('同步版执行灾难性正则的前提:短输入快速完成(超时保护只在 Worker 里)', () => {
  const t0 = Date.now();
  const r = C.runAll('(a+)+$', '', [m('aaaa'), n('aaaa!')]);
  assert.equal(r.stats.passed, 2);
  assert.ok(Date.now() - t0 < 1000);
  const to = C.makeTimeoutResult(3, m('x'), C.TIMEOUT_MS);
  assert.deepEqual([to.pass, to.code, to.reason, to.index], [false, 'timeout', '疑似灾难性回溯', 3]);
});

test('CSV 往返:期望一个空捕获 [""] 不会变成「不检查捕获」[]', () => {
  const cases = [{ input: 'ab', expect: 'match', captures: [''] }, { input: 'ab', expect: 'match', captures: [] }, { input: 'ab', expect: 'match', captures: [null, ''] }];
  const back = C.csvToCases(C.toCsv(cases));
  assert.equal(back.ok, true);
  assert.deepEqual(back.cases, cases);
  const before = C.runAll('^(a)b$', '', [cases[0]]);
  const after = C.runAll('^(a)b$', '', [back.cases[0]]);
  assert.equal(before.results[0].pass, false);
  assert.equal(after.results[0].pass, false);
  assert.equal(C.csvToCases('输入,期望,期望捕获\r\na,匹配,not-json\r\n').ok, false);
  assert.equal(C.csvToCases('输入,期望,期望捕获\r\na,匹配,"[1]"\r\n').ok, false);
});

test('g+u 零长度匹配按完整码点推进:😀 只有 2 个位置,非 u 模式按 UTF-16 单元为 3', () => {
  const spec = { expect: 'match', captures: [] };
  assert.equal(C.runCase(/(?:)/gu, '😀', spec).actual.count, 2);
  assert.equal(C.runCase(/(?:)/g, '😀', spec).actual.count, 3);
  assert.equal(C.runCase(/(?:)/gu, 'a😀b', spec).actual.count, 4);
});

/* ---- 第五轮:停止验收的未运行标记、已有数据判断 ---- */
test('makeSkippedResult:未运行样例不算通过也不算失败,统计分开列出', () => {
  const done = C.makeResult(0, m('a'), { pass: true, actual: null, code: 'ok', reason: '', detail: '' });
  const bad = C.makeResult(1, m('b'), { pass: false, actual: null, code: 'missed', reason: '应匹配但未匹配', detail: '' });
  const sk = C.makeSkippedResult(2, m('c'));
  assert.equal(sk.pass, false);
  assert.equal(sk.code, 'skipped');
  assert.match(sk.reason, /未运行/);
  const st = C.buildStats([done, bad, sk, C.makeSkippedResult(3, m('d'))]);
  assert.equal(st.total, 4);
  assert.equal(st.skipped, 2);
  assert.equal(st.passed, 1);
  assert.equal(st.failed, 1);
  assert.equal(st.rate, 0.5);
  assert.equal(C.formatRate(st), '已运行 2/4 条:通过 1(50.0%),另有 2 条未运行');
});

test('停止后的报告:单独写明未运行条数,失败清单不含未运行', () => {
  const ok = C.makeResult(0, m('a'), { pass: true, actual: null, code: 'ok', reason: '', detail: '' });
  const results = [ok, C.makeSkippedResult(1, m('b'))];
  const md = C.reportToMarkdown({ name: 'x', pattern: 'a', flags: '', results, stats: C.buildStats(results) });
  assert.match(md, /未运行:1 条/);
  assert.match(md, /已手动停止/);
  assert.match(md, /全部通过|失败:0/);
  assert.ok(!/\| 2 \|/.test(md.split('## 失败清单')[1] || ''));
});

test('hasUserData:非默认标志或输入长度上限也算用户数据,默认状态不算', () => {
  assert.equal(C.hasUserData(C.defaultState()), false);
  const f = C.defaultState(); f.draft.flags = 'i';
  assert.equal(C.hasUserData(f), true);
  const mx = C.defaultState(); mx.draft.maxInput = 500;
  assert.equal(C.hasUserData(mx), true);
  const nm = C.defaultState(); nm.draft.name = 'x';
  assert.equal(C.hasUserData(nm), true);
  const lib = C.defaultState(); lib.library.push({ id: 'a' });
  assert.equal(C.hasUserData(lib), true);
});

test('CSV 带结果列时,未运行的样例写「未运行」而不是「失败」', () => {
  const cases = [m('a'), m('b')];
  const results = [C.makeResult(0, cases[0], { pass: true, actual: null, code: 'ok', reason: '', detail: '' }), C.makeSkippedResult(1, cases[1])];
  const rows = C.toCsv(cases, results).trim().split('\r\n');
  assert.match(rows[1], /,通过,/);
  assert.match(rows[2], /,未运行,未运行,/);
  assert.ok(!rows[2].includes('失败'));
});
