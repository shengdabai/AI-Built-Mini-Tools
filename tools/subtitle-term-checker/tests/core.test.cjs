'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const SRT = '1\n00:00:01,000 --> 00:00:03,000\n第一行\n第二行\n\n2\n00:00:03,500 --> 00:00:05,250\nHello\n';
const mk = (index, start, end, lines) => ({ index, start, end, lines, raw: lines.join('\n') });
const gl = text => C.parseGlossary(text);

test('SRT 解析:多行文本与毫秒', () => {
  const r = C.parseSubtitles(SRT);
  assert.equal(r.format, 'srt');
  assert.equal(r.errors.length, 0);
  assert.equal(r.cues.length, 2);
  assert.deepEqual(r.cues[0].lines, ['第一行', '第二行']);
  assert.equal(r.cues[0].start, 1000);
  assert.equal(r.cues[1].end, 5250);
});

test('SRT 解析:Windows 换行 CRLF 与多余空行', () => {
  const r = C.parseSubtitles(SRT.replace(/\n/g, '\r\n') + '\r\n\r\n');
  assert.equal(r.errors.length, 0);
  assert.equal(r.cues.length, 2);
  assert.deepEqual(r.cues[0].lines, ['第一行', '第二行']);
});

test('VTT 解析:头、NOTE、点号毫秒、短时间码与设置', () => {
  const vtt = 'WEBVTT\n\nNOTE 这是注释\n还有一行\n\nintro\n00:01.500 --> 00:03.000 align:start\nHi\n\n7\n01:00:00.250 --> 01:00:01.000\nBye\n';
  const r = C.parseSubtitles(vtt);
  assert.equal(r.format, 'vtt');
  assert.equal(r.errors.length, 0);
  assert.equal(r.cues.length, 2);
  assert.equal(r.cues[0].start, 1500);
  assert.equal(r.cues[0].id, 'intro');
  assert.equal(r.cues[0].settings, 'align:start');
  assert.equal(r.cues[0].index, 1);
  assert.equal(r.cues[1].index, 7);
  assert.equal(r.cues[1].start, 3600250);
});

test('非法时间轴报行号,其余字幕仍被解析', () => {
  const bad = '1\n00:00:01,000 --> 00:00:03,000\nA\n\n2\n00:00:0x,000 --> 00:00:05,000\nB\n\n3\n00:00:06,000 --> 00:00:07,000\nC\n';
  const r = C.parseSubtitles(bad);
  assert.equal(r.cues.length, 2);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].line, 6);
  assert.match(r.errors[0].message, /时间轴/);
});

test('解析错误:缺少时间轴、序号非整数、缺空行、分钟超范围', () => {
  assert.equal(C.parseSubtitles('1\n只有文字\n').errors[0].line, 1);
  assert.equal(C.parseSubtitles('abc\n00:00:01,000 --> 00:00:02,000\nA\n').errors[0].line, 1);
  const merged = C.parseSubtitles('1\n00:00:01,000 --> 00:00:02,000\nA\n2\n00:00:03,000 --> 00:00:04,000\nB\n');
  assert.equal(merged.errors[0].line, 5);
  assert.equal(C.parseSubtitles('1\n00:75:01,000 --> 00:76:02,000\nA\n').errors.length, 1);
});

test('毫秒位数不足时右补零(1 位 = 百毫秒)', () => {
  const r = C.parseSubtitles('1\n00:00:01,5 --> 00:00:02,25\nA\n');
  assert.equal(r.cues[0].start, 1500);
  assert.equal(r.cues[0].end, 2250);
});

test('术语表:全角竖线与全角逗号、只写标准写法、注释行', () => {
  const g = gl('# 注释\n拼音｜拼因，拼英\nGitHub\n  \n｜无标准写法\n');
  assert.equal(g.entries.length, 2);
  assert.deepEqual(g.entries[0].wrongs, ['拼因', '拼英']);
  assert.deepEqual(g.entries[1].wrongs, []);
  assert.equal(g.errors.length, 1);
  assert.equal(g.errors[0].line, 5);
});

test('术语错误写法命中并给出位置', () => {
  const cues = [mk(1, 0, 2000, ['大家好', '今天学拼因'])];
  const issues = C.checkTerms(cues, gl('拼音 | 拼因'));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, 'wrong-term');
  assert.equal(issues[0].found, '拼因');
  assert.equal(issues[0].replacement, '拼音');
  assert.equal(issues[0].lineNo, 1);
  assert.equal(issues[0].col, 3);
});

test('全角逗号分隔的多个错误写法都能命中', () => {
  const cues = [mk(1, 0, 2000, ['拼因和拼英'])];
  const issues = C.checkTerms(cues, gl('拼音｜拼因，拼英'));
  assert.deepEqual(issues.map(i => i.found), ['拼因', '拼英']);
});

test('大小写变体:默认不敏感会命中,敏感时不命中', () => {
  const cues = [mk(1, 0, 2000, ['open github and Github'])];
  const g = gl('GitHub');
  const loose = C.checkTerms(cues, g);
  assert.deepEqual(loose.map(i => i.found), ['github', 'Github']);
  assert.ok(loose.every(i => i.code === 'case-variant'));
  assert.equal(C.checkTerms(cues, g, { caseSensitive: true }).length, 0);
});

test('标准写法本身出现不报;嵌在更长英文词里不报;中文词无变体检查', () => {
  const cues = [mk(1, 0, 2000, ['GitHub 与 githubusercontent 与 拼音'])];
  assert.equal(C.checkTerms(cues, gl('GitHub\n拼音')).length, 0);
});

test('全角英文被识别为变体', () => {
  const cues = [mk(1, 0, 2000, ['用ＧｉｔＨｕｂ吧'])];
  const issues = C.checkTerms(cues, gl('GitHub'));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].found, 'ＧｉｔＨｕｂ');
  assert.equal(issues[0].replacement, 'GitHub');
});

test('区分大小写时错误写法只按字面命中', () => {
  const cues = [mk(1, 0, 2000, ['hsk 和 HSK 和 Hsk'])];
  const g = gl('HSK | hsk');
  assert.deepEqual(C.checkTerms(cues, g, { caseSensitive: true }).map(i => i.found), ['hsk']);
});

test('时间轴:重叠、开始不早于结束', () => {
  const cues = [mk(1, 0, 3000, ['甲甲甲甲甲']), mk(2, 2500, 4500, ['乙乙乙乙乙']), mk(3, 6000, 6000, ['丙丙丙丙丙'])];
  const issues = C.checkTiming(cues);
  const overlap = issues.find(i => i.code === 'overlap');
  assert.equal(overlap.cueIndex, 1);
  assert.match(overlap.message, /500 毫秒/);
  assert.ok(issues.some(i => i.code === 'start-after-end' && i.cueIndex === 3));
  assert.ok(!issues.some(i => i.code === 'overlap' && i.cueIndex === 2));
});

test('时间轴:时长过短、过长及边界值', () => {
  const codes = (s, e) => C.checkTiming([mk(1, s, e, ['文'])]).map(i => i.code);
  assert.ok(codes(0, 400).includes('too-short'));
  assert.ok(!codes(0, 700).includes('too-short'));
  assert.ok(codes(0, 7001).includes('too-long'));
  assert.ok(!codes(0, 7000).includes('too-long'));
});

test('CPS:中文一字一字符,英文按字符数,标签不计', () => {
  assert.equal(C.cps(mk(1, 0, 2000, ['一二三四五六七八九十'])), 5);
  assert.equal(C.cps(mk(1, 0, 2000, ['Hello world'])), 5.5);
  assert.equal(C.cps(mk(1, 0, 1000, ['<i>你好</i>', '{\\an8}世界'])), 4);
  assert.equal(C.cps(mk(1, 1000, 1000, ['你好'])), Infinity);
  assert.equal(C.cps(mk(1, 0, 1000, [])), 0);
});

test('CPS 超过阈值才报,阈值可改', () => {
  const cue = mk(1, 0, 1000, ['一二三四五六七八九十', '一二三四五六七八九十1']); // 21 字符/秒
  assert.ok(C.checkTiming([cue]).some(i => i.code === 'cps'));
  assert.ok(!C.checkTiming([cue], { cpsMax: 25 }).some(i => i.code === 'cps'));
  const ok = mk(1, 0, 1000, ['一二三四五六七八九十', '一二三四五六七八九十']); // 刚好 20
  assert.ok(!C.checkTiming([ok]).some(i => i.code === 'cps'));
});

test('行数与单行字数:中文 20 / 其他 42,超过 2 行', () => {
  const zh21 = '一'.repeat(21), zh20 = '一'.repeat(20);
  const en43 = 'a'.repeat(43), en42 = 'a'.repeat(42);
  const has = (lines, code) => C.checkTiming([mk(1, 0, 6000, lines)]).some(i => i.code === code);
  assert.ok(has([zh21], 'line-long'));
  assert.ok(!has([zh20], 'line-long'));
  assert.ok(has([en43], 'line-long'));
  assert.ok(!has([en42], 'line-long'));
  assert.ok(has(['甲', '乙', '丙'], 'too-many-lines'));
  assert.ok(!has(['甲', '乙'], 'too-many-lines'));
});

test('序号不连续与空文本', () => {
  const issues = C.checkTiming([mk(1, 0, 1000, ['甲']), mk(3, 1000, 2000, ['乙']), mk(4, 2000, 3000, [])]);
  const gap = issues.filter(i => i.code === 'seq-gap');
  assert.equal(gap.length, 1);
  assert.equal(gap[0].cueIndex, 3);
  assert.ok(issues.some(i => i.code === 'empty-text' && i.cueIndex === 4));
});

test('applyFixes 只改文本,时间轴与序号原样,且不改动入参', () => {
  const parsed = C.parseSubtitles('1\n00:00:01,000 --> 00:00:03,000\n学拼因和Github\n\n2\n00:00:03,500 --> 00:00:05,250\nok\n');
  const before = JSON.stringify(parsed.cues);
  const issues = C.checkTerms(parsed.cues, gl('拼音 | 拼因\nGitHub'));
  assert.equal(issues.length, 2);
  const fixed = C.applyFixes(parsed.cues, issues);
  assert.deepEqual(fixed[0].lines, ['学拼音和GitHub']);
  for (let i = 0; i < fixed.length; i++) {
    assert.equal(fixed[i].start, parsed.cues[i].start);
    assert.equal(fixed[i].end, parsed.cues[i].end);
    assert.equal(fixed[i].index, parsed.cues[i].index);
  }
  assert.equal(JSON.stringify(parsed.cues), before);
  const out = C.serialize(fixed, 'srt');
  assert.match(out, /00:00:01,000 --> 00:00:03,000\n学拼音和GitHub/);
});

test('applyFixes 同一行多处替换且长度变化时位置不错位;只应用已接受的', () => {
  const cues = [mk(1, 0, 2000, ['拼因,拼因,hsk'])];
  const issues = C.checkTerms(cues, gl('拼音 | 拼因\nHSK | hsk'));
  assert.equal(issues.length, 3);
  const fixed = C.applyFixes(cues, [issues[0], issues[2]]);
  assert.deepEqual(fixed[0].lines, ['拼音,拼因,HSK']);
});

test('serialize 往返:parse → serialize → parse 相等(SRT 与 VTT)', () => {
  const same = (a, b) => assert.deepEqual(
    a.cues.map(c => [c.index, c.start, c.end, c.lines, c.id, c.settings]),
    b.cues.map(c => [c.index, c.start, c.end, c.lines, c.id, c.settings]));
  const s1 = C.parseSubtitles(SRT);
  const s2 = C.parseSubtitles(C.serialize(s1.cues, 'srt'));
  same(s1, s2);
  const vtt = 'WEBVTT\n\nNOTE x\n\na\n00:00:01.005 --> 00:00:02.000 line:0\n甲\n\n00:00:02.500 --> 00:00:03.000\n乙\n';
  const v1 = C.parseSubtitles(vtt);
  const out = C.serialize(v1.cues, 'vtt');
  assert.ok(out.startsWith('WEBVTT\n\n'));
  assert.match(out, /00:00:01\.005 --> 00:00:02\.000 line:0/);
  same(v1, C.parseSubtitles(out));
});

test('serialize 毫秒补零且小时至少两位', () => {
  assert.equal(C.formatTime(61005, ','), '00:01:01,005');
  assert.equal(C.formatTime(3600000, '.'), '01:00:00.000');
  const out = C.serialize([mk(1, 5, 7, ['x'])], 'srt');
  assert.match(out, /00:00:00,005 --> 00:00:00,007/);
});

test('公式防护:CSV 与 Markdown 对 = + - @ 开头的字段加单引号,单独的 - + 不算', () => {
  assert.equal(C.guard('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(C.guard('@cmd'), "'@cmd");
  assert.equal(C.guard('+1'), "'+1");
  assert.equal(C.guard('- 对话'), "'- 对话");
  assert.equal(C.guard('-'), '-');
  assert.equal(C.guard('+'), '+');
  assert.equal(C.guard('普通'), '普通');
  const cues = [mk(1, 0, 300, ['=HYPERLINK("x")'])];
  const issues = C.checkTiming(cues);
  const csv = C.toCsv(issues);
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'));
  const md = C.toMarkdown(issues);
  assert.ok(md.includes("| '=HYPERLINK"));
});

test('Markdown 表格转义竖线并把多行原文压成一行;无问题时有明确文案', () => {
  const issues = C.checkTiming([mk(1, 0, 300, ['a|b', 'c'])]);
  const md = C.toMarkdown(issues);
  assert.ok(md.includes('a\\|b / c'));
  assert.match(C.toMarkdown([]), /未发现问题/);
});

test('summarize 用 Map 分组,__proto__ / constructor 之类的值不污染', () => {
  const s = C.summarize([{ code: '__proto__' }, { code: 'constructor' }, { code: '__proto__' }]);
  assert.deepEqual(s.map(x => [x.code, x.count]), [['__proto__', 2], ['constructor', 1]]);
  assert.equal(({}).polluted, undefined);
});

test('选项:非法阈值回退默认值', () => {
  const o = C.normalizeOptions({ cpsMax: 'abc', lineMaxCjk: -3, maxLines: 0, minMs: 500 });
  assert.equal(o.cpsMax, 20);
  assert.equal(o.lineMaxCjk, 20);
  assert.equal(o.maxLines, 2);
  assert.equal(o.minMs, 500);
});

test('空输入不抛错', () => {
  assert.deepEqual(C.parseSubtitles('').cues, []);
  assert.deepEqual(C.parseSubtitles(null).cues, []);
  assert.deepEqual(C.parseGlossary(undefined).entries, []);
  assert.equal(C.serialize([], 'srt'), '');
});

test('[P0] 解析错误(字幕与术语表,含行号)进入 Markdown 与 CSV 报告', () => {
  const sub = C.parseSubtitles('1\n00:00:0x,000 --> 00:00:05,000\n坏\n');
  const g = C.parseGlossary('｜缺标准写法');
  const errs = sub.errors.map(e => ({ source: '字幕', line: e.line, message: e.message }))
    .concat(g.errors.map(e => ({ source: '术语表', line: e.line, message: e.message })));
  assert.equal(errs.length, 2);
  const md = C.toMarkdown([], errs);
  assert.ok(!md.includes('未发现问题。'));
  assert.match(md, /解析错误/);
  assert.match(md, /\| 字幕 \| 2 \|/);
  assert.match(md, /\| 术语表 \| 1 \|/);
  const csv = C.toCsv([], errs);
  assert.match(csv, /字幕第 2 行,解析错误/);
  assert.match(csv, /术语表第 1 行,解析错误/);
  assert.ok(C.toMarkdown([{ code: 'cps', kind: 'timing', severity: 'warn', cueIndex: 1, time: 't', original: 'x', message: 'm', suggestion: 's' }], errs).includes('另有 2 处解析错误'));
});

test('[P0] 术语只匹配可见文本:标签与 {\\an8} 不被改动', () => {
  const g = gl('斜体 | i\n定位 | an8\n拼音 | 拼因');
  const cues = [mk(1, 0, 2000, ['<i>你好</i>', '{\\an8}拼因和<b class="i">好</b>'])];
  const issues = C.checkTerms(cues, g);
  assert.deepEqual(issues.map(i => i.found), ['拼因']);
  const fixed = C.applyFixes(cues, issues);
  assert.deepEqual(fixed[0].lines, ['<i>你好</i>', '{\\an8}拼音和<b class="i">好</b>']);
  // 标签紧挨术语时仍能替换并保留标签;跨标签的匹配不改
  const c2 = [mk(1, 0, 2000, ['<i>拼因</i>', 'Git<b>hub</b> github'])];
  const i2 = C.checkTerms(c2, gl('拼音 | 拼因\nGitHub'));
  assert.deepEqual(i2.map(i => i.found), ['拼因', 'github']);
  assert.deepEqual(C.applyFixes(c2, i2)[0].lines, ['<i>拼音</i>', 'Git<b>hub</b> GitHub']);
});

test('[P1] 正文里的 "-->" 不算时间轴,也不阻止解析', () => {
  const r = C.parseSubtitles('1\n00:00:01,000 --> 00:00:03,000\nA --> B\n箭头 --> 表示流向\n\n2\n00:00:04,000 --> 00:00:05,000\nok\n');
  assert.equal(r.errors.length, 0);
  assert.deepEqual(r.cues[0].lines, ['A --> B', '箭头 --> 表示流向']);
  assert.equal(r.cues.length, 2);
  const v = C.parseSubtitles('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nx --> y\n');
  assert.equal(v.errors.length, 0);
  assert.deepEqual(v.cues[0].lines, ['x --> y']);
  // 往返不变
  assert.deepEqual(C.parseSubtitles(C.serialize(r.cues, 'srt')).cues.map(c => c.lines), r.cues.map(c => c.lines));
});

test('[第五轮] validateOptions 拒绝 0、负数、非数字和空值,而不是静默回退默认值', () => {
  const ok = C.validateOptions({ caseSensitive: true, cpsMax: '18', lineMaxCjk: 16, lineMaxOther: '30.5' });
  assert.equal(ok.errors.length, 0);
  assert.equal(ok.options.cpsMax, 18);
  assert.equal(ok.options.lineMaxOther, 30.5);
  assert.equal(ok.options.caseSensitive, true);
  for (const bad of ['0', '-3', 'abc', '', '  ', 'Infinity', '1e999']) {
    const r = C.validateOptions({ cpsMax: bad, lineMaxCjk: 20, lineMaxOther: 42 });
    assert.deepEqual(r.errors.map(e => e.field), ['cpsMax'], `cpsMax=${JSON.stringify(bad)}`);
    assert.ok(r.errors[0].message.length > 0);
  }
  const multi = C.validateOptions({ cpsMax: 0, lineMaxCjk: -1, lineMaxOther: 42 });
  assert.deepEqual(multi.errors.map(e => e.field), ['cpsMax', 'lineMaxCjk']);
});

test('[第五轮] checkStatus:有解析错误时不得给出「没有发现问题」', () => {
  assert.deepEqual(C.checkStatus(0, 0), { complete: true, passed: true, label: '没有发现问题' });
  assert.deepEqual(C.checkStatus(0, 3), { complete: true, passed: false, label: '3 个问题' });
  const bad = C.checkStatus(2, 0);
  assert.equal(bad.complete, false);
  assert.equal(bad.passed, false);
  assert.equal(bad.label, '检查未完成:2 处解析错误');
  assert.equal(C.checkStatus(1, 5).passed, false);
});

test('[第五轮] 合成示例的报告标注数据来源,真实数据不标', () => {
  const issues = C.checkTerms([mk(1, 0, 2000, ['拼因'])], gl('拼音 | 拼因'));
  assert.ok(C.toMarkdown(issues, [], { sample: true }).includes('数据来源:合成示例'));
  assert.ok(!C.toMarkdown(issues, []).includes('合成示例'));
  const rows = C.toCsv(issues, [], { sample: true }).split('\n');
  assert.ok(rows[0].endsWith(',数据来源'));
  assert.ok(rows[1].endsWith(',合成示例'));
  assert.ok(!C.toCsv(issues, []).includes('数据来源'));
  assert.ok(C.toMarkdown([], [], { sample: true }).includes('数据来源:合成示例'));
});
