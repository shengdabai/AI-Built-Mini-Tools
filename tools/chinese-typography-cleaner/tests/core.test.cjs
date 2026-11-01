'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const only = (id, extra) => {
  const rules = {};
  C.RULE_IDS.forEach(r => { rules[r] = r === id; });
  return Object.assign({ rules }, extra || {});
};
const run = (text, id, extra) => C.clean(text, only(id, extra)).result;

test('中英文之间加一个半角空格', () => {
  assert.equal(run('中文English中文', 'spacing'), '中文 English 中文');
  assert.equal(run('中文 English', 'spacing'), '中文 English'); // 已有空格不重复加
});

test('中文与数字之间加空格,数字与单位不加', () => {
  assert.equal(run('共123人', 'spacing'), '共 123 人');
  assert.equal(run('重量5kg', 'spacing'), '重量 5kg');
  assert.equal(run('5kg', 'spacing'), '5kg');
  assert.equal(run('增长5%了', 'spacing'), '增长 5% 了');
});

test('百分号紧跟数字', () => {
  assert.equal(run('增长 5 %。', 'percent'), '增长 5%。');
  assert.equal(run('5   %', 'percent'), '5%');
  assert.equal(run('100%', 'percent'), '100%');
});

test('中文语境半角标点换全角', () => {
  assert.equal(run('你好,世界?真的!注意:看;好', 'punct'), '你好，世界？真的！注意：看；好');
  assert.equal(run('你好.', 'punct'), '你好。');
  assert.equal(run('中文(English)', 'punct'), '中文（English）');
  assert.equal(run('(注意)', 'punct'), '（注意）');
});

test('英文语境的半角标点保留', () => {
  const s = 'Hello, world. See (a) and 12:30; ok? yes!';
  assert.equal(run(s, 'punct'), s);
  assert.equal(run('例如 Node.js 与 example.com', 'punct'), '例如 Node.js 与 example.com');
});

test('小数点与版本号不替换', () => {
  assert.equal(run('圆周率3.14,版本2.1.0。', 'punct'), '圆周率3.14，版本2.1.0。');
  assert.equal(run('第3.5章结束.', 'punct'), '第3.5章结束。');
});

test('全角标点后的空格删除', () => {
  assert.equal(run('你好, 世界', 'punct'), '你好，世界');
  assert.equal(run('你好，  世界', 'punct'), '你好，世界');
});

test('Markdown 图片与 HTML 实体里的标点不被破坏', () => {
  assert.equal(run('看图![图](a.png)', 'punct'), '看图![图](a.png)');
  assert.equal(run('A&amp;好', 'punct'), 'A&amp;好');
});

test('省略号', () => {
  assert.equal(run('等等...然后', 'ellipsis'), '等等……然后');
  assert.equal(run('等等......然后', 'ellipsis'), '等等……然后');
  assert.equal(run('a..b', 'ellipsis'), 'a..b');
});

test('破折号,表格分隔行与命令行参数不动', () => {
  assert.equal(run('你好--世界', 'dash'), '你好——世界');
  assert.equal(run('|--|--|', 'dash'), '|--|--|');
  assert.equal(run('---', 'dash'), '---');
  assert.equal(run('运行 --help 查看', 'dash'), '运行 --help 查看');
});

test('引号两种模式', () => {
  assert.equal(run('他说"好"', 'quotes'), '他说「好」');
  assert.equal(run('他说"好"', 'quotes', { quoteStyle: 'curly' }), '他说“好”');
  assert.equal(run('他说“好”', 'quotes', { quoteStyle: 'corner' }), '他说「好」');
  assert.equal(run('他说「好」', 'quotes', { quoteStyle: 'curly' }), '他说“好”');
  assert.equal(run('孤零零的"一个', 'quotes'), '孤零零的"一个'); // 不成对不动
});

test('全角字母数字转半角', () => {
  assert.equal(run('ＡＢＣ１２３ａｂｃ', 'fullwidth'), 'ABC123abc');
  assert.equal(run('中文，。', 'fullwidth'), '中文，。');
});

test('连续空格合并、行尾空格删除、连续空行最多一个', () => {
  assert.equal(run('a  b   c', 'whitespace'), 'a b c');
  assert.equal(run('行尾有空格   \n下一行', 'whitespace'), '行尾有空格\n下一行');
  assert.equal(run('第一段\n\n\n\n第二段', 'whitespace'), '第一段\n\n第二段');
  assert.equal(run('    缩进保留  内部合并', 'whitespace'), '    缩进保留 内部合并');
  assert.equal(run('a\n   \n   \nb', 'whitespace'), 'a\n\nb');
});

test('代码块、行内代码、URL、HTML 标签内部不处理', () => {
  const src = '前文English\n```js\nconst a  =  "x,y";   \n\n\n\n```\n行内`a,b  c`和链接[文档](https://a.com/x?y=1,2)和<a href="x,y">标签</a>';
  const r = C.clean(src).result;
  assert.ok(r.includes('```js\nconst a  =  "x,y";   \n\n\n\n```'), '代码块应原样保留');
  assert.ok(r.includes('`a,b  c`'));
  assert.ok(r.includes('(https://a.com/x?y=1,2)'));
  assert.ok(r.includes('<a href="x,y">'));
  assert.ok(r.startsWith('前文 English'));
});

test('protectRegions 分段类型,拼接后等于原文', () => {
  const src = '文`c`字\n~~~\nx\n~~~\n见[a](http://b.com "t")和http://c.com/p.<b>x</b><!-- n -->';
  const segs = C.protectRegions(src);
  assert.equal(segs.map(s => s.value).join(''), src);
  const types = segs.map(s => s.type);
  ['text', 'inline', 'code', 'url', 'html'].forEach(t => assert.ok(types.includes(t), '缺少类型 ' + t));
  assert.equal(segs.find(s => s.type === 'code').value, '~~~\nx\n~~~');
  assert.ok(segs.some(s => s.type === 'url' && s.value === 'http://c.com/p'), '裸 URL 末尾句点不属于 URL');
});

test('未闭合的代码围栏保护到文末', () => {
  const r = C.clean('中文abc\n```\n未闭合,a  b').result;
  assert.equal(r, '中文 abc\n```\n未闭合,a  b');
});

test('汉字与链接、行内代码之间加空格', () => {
  assert.equal(run('见[文档](https://a.com)和`code`吧', 'linkspace'), '见 [文档](https://a.com) 和 `code` 吧');
  assert.equal(run('访问https://a.com 了解', 'linkspace'), '访问 https://a.com 了解');
  assert.equal(run('图![图](a.png)后', 'linkspace'), '图 ![图](a.png) 后');
  const all = C.clean('见[文档](https://a.com/中文,x)好').result;
  assert.equal(all, '见 [文档](https://a.com/中文,x) 好');
});

test('保护词:内部不改,两侧不自动加空格', () => {
  const withWord = C.clean('听QQ音乐吧', { protectedWords: ['QQ音乐'] }).result;
  assert.equal(withWord, '听QQ音乐吧');
  assert.equal(C.clean('听QQ音乐吧').result, '听 QQ 音乐吧');
  const brand = C.clean('用 iPhone15,还是 B站,好', { protectedWords: ['B站', 'iPhone15'] }).result;
  assert.equal(brand, '用 iPhone15，还是 B站，好');
});

test('保护词中的正则特殊字符按字面匹配', () => {
  assert.equal(C.clean('用C++写', { protectedWords: ['C++'] }).result, '用C++写');
  assert.equal(C.clean('a.b中文', { protectedWords: ['a.b'] }).result, 'a.b中文');
});

test('clean 幂等:示例与边界文本跑两次结果相同', () => {
  const samples = [
    '# 标题:说明(演示)\n\n在B站发布APP,增长了 35 %.\n他说:"好"...\n破折号--再见\n\n\n```\n  x  \n```\n',
    'a,b,,中,,c\n"""\n((中))\n5 % 中5 %中\n&amp;好;\n',
    '见[文档](http://a.com)中文`x`中文<b>中</b>中文http://x.com中文',
    '你好 ,  世界 .   English  ,中文'
  ];
  for (const s of samples) {
    const once = C.clean(s, { protectedWords: ['B站'] }).result;
    const twice = C.clean(once, { protectedWords: ['B站'] }).result;
    assert.equal(twice, once, '不幂等:' + JSON.stringify(s));
  }
});

test('clean 幂等:随机拼接 600 条', () => {
  const vocab = ['中文', '汉', 'English', 'abc', '123', '5', ' ', '  ', ',', '.', '。', '，', '(', ')', '（', '）', '"', '“', '”', '「', '」', '...', '--', '-', '%', ' %', '\n', '\n\n', '\n\n\n', '`x`', '`', '```', '[a](http://x.com)', '[', ']', '<b>', '</b>', 'ＡＢ', '１', '!', '?', ':', ';', '&amp;', 'kg', 'http://u.com', '|', '\t'];
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let n = 0; n < 600; n++) {
    let s = '';
    const len = 1 + Math.floor(rnd() * 14);
    for (let i = 0; i < len; i++) s += vocab[Math.floor(rnd() * vocab.length)];
    for (const style of ['corner', 'curly']) {
      const o = { quoteStyle: style, protectedWords: ['abc'] };
      const once = C.clean(s, o).result;
      const twice = C.clean(once, o).result;
      assert.equal(twice, once, `不幂等(${style}):${JSON.stringify(s)} → ${JSON.stringify(once)} → ${JSON.stringify(twice)}`);
    }
  }
});

test('changes 按规则计数,diff 只含改动行', () => {
  const r = C.clean('中文abc,好\n不变的行\n等待...\n');
  const get = id => (r.changes.find(c => c.rule === id) || {}).count;
  assert.equal(get('spacing'), 1);
  assert.equal(get('punct'), 1);
  assert.equal(get('ellipsis'), 1);
  assert.equal(get('dash'), undefined);
  assert.deepEqual(r.diff.map(d => d.line), [1, 3]);
  assert.equal(r.diff[0].before, '中文abc,好');
  assert.equal(r.diff[0].after, '中文 abc，好');
});

test('关闭规则后该规则不执行也不计数', () => {
  const rules = { punct: false };
  const r = C.clean('你好,World', { rules });
  assert.equal(r.result, '你好,World');
  assert.ok(!r.changes.some(c => c.rule === 'punct'));
  const r2 = C.clean('你好World', { rules: { spacing: false } });
  assert.equal(r2.result, '你好World');
});

test('空输入与非字符串输入', () => {
  assert.deepEqual(C.clean(''), { result: '', changes: [], diff: [] });
  assert.deepEqual(C.clean(null), { result: '', changes: [], diff: [] });
  assert.deepEqual(C.clean(undefined), { result: '', changes: [], diff: [] });
  assert.equal(C.clean('   ').result, '');
  assert.deepEqual(C.protectRegions(''), []);
});

test('CRLF 统一为 LF,无改动时 diff 为空', () => {
  const r = C.clean('第一行\r\n第二行\r\n');
  assert.equal(r.result, '第一行\n第二行\n');
  assert.equal(r.diff.length, 0);
  assert.equal(r.changes.length, 0);
});

test('输入里本来就有的私有区字符原样保留,不被当成占位符', () => {
  const r = C.clean('中文\uE000abc\uE004,好\uE001').result;
  assert.equal(r, '中文\uE000abc\uE004，好\uE001');
});

test('diffLine 字符级差异可还原两侧', () => {
  const ops = C.diffLine('中文abc,好', '中文 abc，好');
  assert.equal(ops.filter(o => o.type !== 'ins').map(o => o.text).join(''), '中文abc,好');
  assert.equal(ops.filter(o => o.type !== 'del').map(o => o.text).join(''), '中文 abc，好');
  assert.ok(ops.some(o => o.type === 'ins' && o.text === ' '));
  assert.deepEqual(C.diffLine('相同', '相同'), [{ type: 'eq', text: '相同' }]);
  assert.deepEqual(C.diffLine('', ''), []);
});

test('diff 记录被合并掉的空行', () => {
  const r = C.clean('a\n\n\n\nb');
  assert.equal(r.result, 'a\n\nb');
  assert.equal(r.diff.length, 2);
  assert.ok(r.diff.every(d => d.removed));
  assert.deepEqual(r.diff.map(d => d.line), [3, 4]);
});

test('规则说明里的示例与实际输出一致', () => {
  C.RULES.forEach(rule => {
    assert.equal(run(rule.before, rule.id), rule.after, `规则 ${rule.id} 的示例不符`);
  });
});

test('validateState 拒绝非法状态而不是修正', () => {
  const ok = C.defaultState();
  assert.equal(C.validateState(ok).ok, true);
  const bad = [
    null, [], 'x', Object.assign({}, ok, { v: 2 }), Object.assign({}, ok, { text: 5 }),
    Object.assign({}, ok, { quoteStyle: 'x' }), Object.assign({}, ok, { extra: 1 }),
    Object.assign({}, ok, { rules: Object.assign({}, ok.rules, { punct: 'yes' }) }),
    Object.assign({}, ok, { rules: Object.assign({}, ok.rules, { nope: true }) }),
    Object.assign({}, ok, { protectedWords: ['a', 'a'] }),
    Object.assign({}, ok, { protectedWords: [' a'] }),
    Object.assign({}, ok, { protectedWords: [''] }),
    Object.assign({}, ok, { protectedWords: 'a' })
  ];
  bad.forEach((s, i) => assert.equal(C.validateState(s).ok, false, '第 ' + i + ' 个非法状态被接受'));
  const missing = C.defaultState(); delete missing.rules.dash;
  assert.equal(C.validateState(missing).ok, false);
});

test('保存与读取用同一校验:往返与超长文本', () => {
  const s = C.defaultState();
  s.text = '中文abc,'.repeat(40000);
  s.protectedWords = ['B站'];
  const ser = C.serializeState(s);
  assert.equal(ser.ok, true);
  const back = C.parseState(ser.json);
  assert.equal(back.ok, true);
  assert.equal(back.state.text.length, s.text.length);
  assert.equal(C.serializeState(Object.assign({}, s, { v: 9 })).ok, false);
  assert.equal(C.parseState('{坏').ok, false);
  assert.equal(C.parseState('{"v":1}').ok, false);
});

test('大文本清洁耗时在可接受范围内', () => {
  const big = '中文abc,好 5 %...\n\n\n'.repeat(15000);
  const t0 = Date.now();
  const r = C.clean(big);
  assert.ok(Date.now() - t0 < 8000, '清洁 30 万字符超过 8 秒');
  assert.ok(r.result.length > 0);
});

test('HTML 标签属性引号内的 > 不会提前结束保护', () => {
  const src = '前<span title="a>b,中文abc" data-x=\'1>2,好\'>正文abc</span>后';
  const r = C.clean(src).result;
  assert.equal(r, '前<span title="a>b,中文abc" data-x=\'1>2,好\'>正文 abc</span>后');
  const segs = C.protectRegions(src).filter(s => s.type === 'html');
  assert.equal(segs[0].value, '<span title="a>b,中文abc" data-x=\'1>2,好\'>');
});

test('含中文的 URL 整体保护,到空白或中文标点为止', () => {
  assert.equal(C.clean('见 https://example.com/中文abc 了解').result, '见 https://example.com/中文abc 了解');
  assert.equal(C.clean('网址https://example.com/中文abc,再见').result, '网址 https://example.com/中文abc,再见'); // ASCII 逗号属于 URL
  assert.equal(C.clean('网址https://example.com/中文abc，再见').result, '网址 https://example.com/中文abc，再见');
  const u = C.protectRegions('x https://example.com/中文abc。').find(s => s.type === 'url');
  assert.equal(u.value, 'https://example.com/中文abc');
});

test('删除纯空格行中的空格计入 whitespace', () => {
  const r = C.clean('甲\n   \n乙');
  assert.equal(r.result, '甲\n\n乙');
  assert.deepEqual(r.changes, [{ rule: 'whitespace', count: 1 }]);
  assert.equal(r.diff.length, 1);
  assert.equal(C.ruleWhitespace('a\n  \nb').count, 1);
});

test('保留强制换行选项:默认删除行尾两空格;开启后保留,但段尾、空行前、最后一行仍清理', () => {
  assert.equal(run('第一行  \n第二行', 'whitespace'), '第一行\n第二行', '默认仍按 SPEC 删除');
  const keep = { keepHardBreak: true };
  assert.equal(run('第一行  \n第二行', 'whitespace', keep), '第一行  \n第二行');
  assert.equal(run('第一行     \n第二行', 'whitespace', keep), '第一行  \n第二行', '多于两个空格规整为两个');
  assert.equal(run('段尾  \n\n下一段', 'whitespace', keep), '段尾\n\n下一段', '空行前的行尾空格不是强制换行');
  assert.equal(run('最后一行  ', 'whitespace', keep), '最后一行', '最后一行没有下一行可换');
  assert.equal(run('单个空格 \n第二行', 'whitespace', keep), '单个空格\n第二行', '只有一个空格不是强制换行');
  const r = C.clean('第一行     \n第二行', Object.assign(only('whitespace'), keep));
  assert.equal(r.changes[0].count, 1, '规整空格记 1 处');
  const same = C.clean('第一行  \n第二行', Object.assign(only('whitespace'), keep));
  assert.equal(same.changes.length, 0, '已是两个空格时不记改动');
  assert.equal(C.clean(same.result, Object.assign(only('whitespace'), keep)).result, same.result, '幂等');
});

test('状态:keepHardBreak 默认 false,旧存档缺该字段仍可读,非布尔值被拒', () => {
  const d = C.defaultState();
  assert.equal(d.keepHardBreak, false);
  assert.equal(C.parseState(JSON.stringify(d)).ok, true);
  const old = Object.assign({}, d); delete old.keepHardBreak;
  assert.equal(C.parseState(JSON.stringify(old)).ok, true, '旧存档(没有该字段)继续可读');
  assert.equal(C.parseState(JSON.stringify(Object.assign({}, d, { keepHardBreak: 'yes' }))).ok, false);
  const on = Object.assign({}, d, { keepHardBreak: true });
  const s = C.serializeState(on);
  assert.equal(s.ok, true);
  assert.equal(C.parseState(s.json).state.keepHardBreak, true, '保存与读取同一份校验');
});

test('Markdown 尖括号链接地址内的空格、中文与全角字符原样保留', () => {
  const src = '下载[报告](<./中文 reportＡ１.md>)然后中文abc';
  const result = C.clean(src).result;
  assert.equal(result, '下载 [报告](<./中文 reportＡ１.md>) 然后中文 abc');
  assert.equal(C.clean(result).result, result, '再次清洁不改变链接');
  assert.ok(C.protectRegions(src).some(s => s.type === 'url' && s.value === '](<./中文 reportＡ１.md>)'));
});

test('Markdown 尖括号链接同时保留标题,图片地址也不被改写', () => {
  const link = '[中文English](<./中文 report.md> "中文English标题")';
  assert.equal(C.clean(link).result, '[中文 English](<./中文 report.md> "中文English标题")');
  const image = '看![图](<./中文 image.png> \'中文caption\')后';
  assert.equal(C.clean(image).result, '看 ![图](<./中文 image.png> \'中文caption\') 后');
});

test('连续半角标点超过 10 个时一次清洁完成,左右中文语境都幂等', () => {
  for (const size of [24, 5000]) {
    for (const [src, expected] of [
      ['你好' + '?'.repeat(size), '你好' + '？'.repeat(size)],
      ['!'.repeat(size) + '你好', '！'.repeat(size) + '你好'],
      ['你好' + ', '.repeat(size) + 'world', '你好' + '，'.repeat(size) + 'world'],
    ]) {
      const first = C.clean(src).result;
      assert.equal(first, expected);
      assert.equal(C.clean(first).result, first);
    }
  }
});

test('标点语境传播不跨过 HTML 实体或 Markdown 图片标记', () => {
  assert.equal(run('a&amp;' + '?'.repeat(24) + '中文', 'punct'), 'a&amp;' + '？'.repeat(24) + '中文');
  assert.equal(run('中文![图](a.png)', 'punct'), '中文![图](a.png)');
  assert.equal(run('a??!!,,b', 'punct'), 'a??!!,,b', '纯英文语境不转换');
});

test('引用式链接保留定义、目标标签和路径,只清洁完整引用的显示文字', () => {
  const definition = '[中文ID]: ./中文EnglishＡ１.md "中文English标题"';
  const src = '见[中文English][中文ID]和![图English][中文ID]后\n\n' + definition;
  const expected = '见 [中文 English][中文ID] 和 ![图 English][中文ID] 后\n\n' + definition;
  assert.equal(C.clean(src).result, expected);
  assert.equal(C.clean(expected).result, expected);
  assert.equal(C.protectRegions(src).map(s => s.value).join(''), src);
});

test('折叠与快捷引用的显示文字兼作标签,不能被排版规则改名', () => {
  const src = '看[中文English][]和[中文English]后\n\n[中文English]: <./中文 reportＡ１.md>';
  const expected = '看 [中文English][] 和 [中文English] 后\n\n[中文English]: <./中文 reportＡ１.md>';
  assert.equal(C.clean(src).result, expected);
  assert.equal(C.clean(expected).result, expected);
});

test('引用标签匹配忽略大小写及连续空白,保留原标签拼写', () => {
  const src = '[显示English][中A  b]\n\n[中a b]: ./中文Ａ１.md';
  assert.equal(C.clean(src).result, '[显示 English][中A  b]\n\n[中a b]: ./中文Ａ１.md');
});

test('引用定义支持下一行目标与标题,定义里的反引号不截断保护区', () => {
  for (const definition of [
    '[中文ID]:\n  <./中文 report.md>\n  "中文English标题"',
    '   [中文ID]: ./中文English.md (中文English标题)',
    '[中文ID]: ./中文`English`.md',
    '[中文ID]: ./中文(a).md \'中文English标题\'',
  ]) {
    const src = '[显示English][中文ID]\n\n' + definition;
    assert.equal(C.clean(src).result, '[显示 English][中文ID]\n\n' + definition);
    assert.equal(C.protectRegions(src).map(s => s.value).join(''), src);
  }
});

test('代码或行内链接里的伪引用定义不应让普通方括号变成保护区', () => {
  const code = '```md\n[中文English]: ./中文English.md\n```';
  assert.equal(C.clean('[中文English]\n\n' + code).result, '[中文 English]\n\n' + code);
  const inline = '[中文English](./中文English.md)\n\n[中文English]: ./中文English.md';
  assert.equal(C.clean(inline).result, '[中文 English](./中文English.md)\n\n[中文English]: ./中文English.md');
  assert.equal(C.clean('[中文English]').result, '[中文 English]', '未定义标签仍当作普通文本');
  const comment = '<!--\n[中文English]: ./中文English.md\n-->';
  assert.equal(C.clean('[中文English]\n\n' + comment).result, '[中文 English]\n\n' + comment);
});

test('转义的方括号不是引用,转义标签能正确匹配', () => {
  const definition = '[中文ID]: ./中文English.md';
  assert.equal(C.clean('\\[中文English][中文ID]\n\n' + definition).result,
    '\\[中文 English][中文ID]\n\n' + definition);
  const escaped = '[显示English][中文\\]ID]\n\n[中文\\]ID]: ./中文English.md';
  assert.equal(C.clean(escaped).result, '[显示 English][中文\\]ID]\n\n[中文\\]ID]: ./中文English.md');
});

test('引用保护只影响有定义的标签,所有规则关闭时字节与分段均保持', () => {
  const src = '[中文English][未定义English]\n\n[中文ID]: ./中文English.md';
  assert.equal(C.clean(src).result, '[中文 English][未定义 English]\n\n[中文ID]: ./中文English.md');
  const rules = Object.fromEntries(C.RULE_IDS.map(id => [id, false]));
  for (const s of [src, '[显示English][中文ID]\n\n[中文ID]: ./中文English.md', '[中文ID][]\n\n[中文ID]: ./中文English.md']) {
    assert.equal(C.clean(s, { rules }).result, s);
    assert.equal(C.protectRegions(s).map(p => p.value).join(''), s);
  }
});

test('长而无效的引用定义不触发嵌套量词的指数回溯', { timeout: 1000 }, () => {
  const src = '[id]: ' + 'a'.repeat(20000) + ' 这不是标题English';
  assert.equal(C.clean(src).result, '[id]: ' + 'a'.repeat(20000) + ' 这不是标题 English');
});
