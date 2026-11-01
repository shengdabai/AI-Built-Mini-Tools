'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../core.js');

const HEAD = 'Handle,Title,Vendor,Tags,Published,Option1 Value,Option2 Value,Variant SKU,Variant Grams,Variant Inventory Qty,Variant Price,Image Src,Body (HTML)';
const csv = (...rows) => [HEAD, ...rows].join('\n');
// 构造一行:按 HEAD 顺序给出覆盖值
const COLS = HEAD.split(',');
const row = (over = {}) => {
  const base = { Handle: 'mug', Title: '马克杯', Vendor: '甲', Tags: '', Published: 'TRUE', 'Option1 Value': '', 'Option2 Value': '', 'Variant SKU': '', 'Variant Grams': '', 'Variant Inventory Qty': '', 'Variant Price': '', 'Image Src': '', 'Body (HTML)': '' };
  return COLS.map(c => { const v = c in over ? over[c] : base[c]; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',');
};
const run = (text, opts) => C.check(C.parseCsv(text), opts);
const ids = r => r.issues.map(i => i.ruleId);
const find = (r, id) => r.issues.filter(i => i.ruleId === id);

test('RFC 4180:引号内逗号保留在同一单元格', () => {
  const p = C.parseCsv('a,b\n"x,y",z');
  assert.deepStrictEqual(p.headers, ['a', 'b']);
  assert.deepStrictEqual(p.rows, [['x,y', 'z']]);
});

test('RFC 4180:引号内换行保留,且不增加行号', () => {
  const p = C.parseCsv('a,b\n"line1\nline2",z\nq,w');
  assert.deepStrictEqual(p.rows, [['line1\nline2', 'z'], ['q', 'w']]);
  assert.deepStrictEqual(p.rowLines, [2, 4]);
});

test('RFC 4180:"" 转义成一个引号;CRLF 与 BOM 被正确处理', () => {
  const p = C.parseCsv('\uFEFFa,b\r\n"he said ""hi""",2\r\n');
  assert.deepStrictEqual(p.headers, ['a', 'b']);
  assert.deepStrictEqual(p.rows, [['he said "hi"', '2']]);
  assert.strictEqual(p.errors.length, 0);
});

test('未闭合引号:报出所在行号,且该行不进入 rows', () => {
  const p = C.parseCsv('a,b\n1,2\n3,"oops\n4,5');
  assert.strictEqual(p.errors.length, 1);
  assert.strictEqual(p.errors[0].ruleId, 'unclosed-quote');
  assert.strictEqual(p.errors[0].row, 3);
  assert.strictEqual(p.errors[0].line, 3);
  assert.deepStrictEqual(p.rows, [['1', '2']]);
  const r = C.check(p);
  const hit = find(r, 'unclosed-quote');
  assert.strictEqual(hit.length, 1);
  assert.strictEqual(hit[0].row, 3);
  assert.strictEqual(hit[0].level, 'block');
});

test('单元格中间出现裸引号:标记为 bad-quote', () => {
  const p = C.parseCsv('a,b\n5" pipe,2');
  assert.strictEqual(p.errors.length, 1);
  assert.strictEqual(p.errors[0].ruleId, 'bad-quote');
  assert.strictEqual(p.errors[0].row, 2);
});

test('空输入与纯空白输入:不抛错,表头为空并报缺少必需列', () => {
  for (const t of ['', '   \n\n', null, undefined]) {
    const p = C.parseCsv(t);
    assert.deepStrictEqual(p.rows, []);
    const r = C.check(p);
    assert.strictEqual(find(r, 'missing-column').length, 2);
    assert.strictEqual(r.stats.rows, 0);
    assert.strictEqual(C.toCsv(p), '');
  }
});

test('缺少 Handle 或 Title 列:各报一条阻断', () => {
  const r = run('Vendor,Variant Price\n甲,1');
  const miss = find(r, 'missing-column');
  assert.strictEqual(miss.length, 2);
  assert.ok(miss.some(x => x.message.includes('"Handle"')));
  assert.ok(miss.some(x => x.message.includes('"Title"')));
  const r2 = run('handle,TITLE\nmug,杯');
  assert.strictEqual(find(r2, 'missing-column').length, 0, '列名不区分大小写');
});

test('列数与表头不一致:阻断并带行号,该行不参与其他规则', () => {
  const r = run(csv(row(), 'mug,标题'));
  const hit = find(r, 'col-count');
  assert.strictEqual(hit.length, 1);
  assert.strictEqual(hit[0].row, 3);
  assert.strictEqual(hit[0].level, 'block');
  assert.strictEqual(r.issues.filter(i => i.row === 3).length, 1);
});

test('Handle 规则:大写、空格、非法字符报错;小写字母数字连字符合法;空 Handle 单独报', () => {
  const r = run(csv(
    row({ Handle: 'Blue-Mug' }),
    row({ Handle: 'blue mug' }),
    row({ Handle: 'blue_mug' }),
    row({ Handle: 'blue-mug-2' }),
    row({ Handle: '' }),
  ));
  const bad = find(r, 'handle-format').map(x => x.row);
  assert.deepStrictEqual(bad, [2, 3, 4]);
  assert.deepStrictEqual(find(r, 'handle-empty').map(x => x.row), [6]);
  assert.ok(find(r, 'handle-format').every(x => x.level === 'block'));
});

test('同一 Handle 首行缺 Title 阻断;后续变体行 Title 为空是正常的', () => {
  const ok = run(csv(row(), row({ Title: '', 'Option1 Value': 'A' })));
  assert.strictEqual(find(ok, 'title-missing').length, 0);
  const bad = run(csv(row({ Title: '' }), row({ Title: '杯', 'Option1 Value': 'A' })));
  const hit = find(bad, 'title-missing');
  assert.strictEqual(hit.length, 1);
  assert.strictEqual(hit[0].row, 2);
});

test('Variant Price:非数字与负数阻断,0 与小数合法,空值不报', () => {
  const r = run(csv(
    row({ 'Variant Price': 'abc' }),
    row({ 'Variant Price': '-5' }),
    row({ 'Variant Price': '0' }),
    row({ 'Variant Price': '12.50' }),
    row({ 'Variant Price': '128,00' }),
    row({ 'Variant Price': '' }),
  ));
  assert.deepStrictEqual(find(r, 'price-invalid').map(x => x.row), [2, 3, 6]);
  assert.ok(find(r, 'price-invalid')[1].message.includes('小于 0'));
});

test('Variant Inventory Qty:必须是整数(允许负整数)', () => {
  const r = run(csv(
    row({ 'Variant Inventory Qty': '3.5' }),
    row({ 'Variant Inventory Qty': '-2' }),
    row({ 'Variant Inventory Qty': '12' }),
    row({ 'Variant Inventory Qty': '十' }),
  ));
  assert.deepStrictEqual(find(r, 'qty-invalid').map(x => x.row), [2, 5]);
});

test('Published:true/false 不区分大小写合法;yes 阻断;safeFix 规范为大写', () => {
  const text = csv(row({ Published: 'true' }), row({ Published: 'False' }), row({ Published: 'yes' }));
  const r = run(text);
  assert.deepStrictEqual(find(r, 'published-invalid').map(x => x.row), [4]);
  const fixed = C.safeFix(C.parseCsv(text));
  const pub = fixed.parsed.rows.map(x => x[COLS.indexOf('Published')]);
  assert.deepStrictEqual(pub, ['TRUE', 'FALSE', 'yes']);
  assert.strictEqual(fixed.changed, 2);
});

test('同一 Handle 下 Option 组合重复阻断(忽略大小写与空白);不同 Handle 同组合合法', () => {
  const r = run(csv(
    row({ 'Option1 Value': '黑', 'Option2 Value': '大' }),
    row({ Title: '', 'Option1 Value': '黑', 'Option2 Value': '小' }),
    row({ Title: '', 'Option1 Value': ' 黑 ', 'Option2 Value': '大' }),
    row({ Handle: 'other', Title: '别的', 'Option1 Value': '黑', 'Option2 Value': '大' }),
  ));
  const hit = find(r, 'option-dup');
  assert.strictEqual(hit.length, 1);
  assert.strictEqual(hit[0].row, 4);
  assert.ok(hit[0].message.includes('第 2 行'));
});

test('只有图片行(选项全空)不会被当成重复变体', () => {
  const r = run(csv(row({ 'Option1 Value': 'A' }), row({ Title: '', 'Image Src': 'https://example.com/a.jpg' }), row({ Title: '', 'Image Src': 'https://example.com/b.jpg' })));
  assert.strictEqual(find(r, 'option-dup').length, 0);
});

test('Variant SKU 重复是警告而不是阻断', () => {
  const r = run(csv(row({ 'Variant SKU': 'A1' }), row({ Title: '', 'Option1 Value': 'x', 'Variant SKU': 'A1' })));
  const hit = find(r, 'sku-dup');
  assert.strictEqual(hit.length, 1);
  assert.strictEqual(hit[0].level, 'warn');
  assert.strictEqual(hit[0].row, 3);
  assert.strictEqual(r.stats.blocks, 0);
  assert.strictEqual(r.stats.warns, 1);
});

test('含 U+FFFD 的单元格阻断,并定位到列', () => {
  const r = run(csv(row({ Title: '杯�' })));
  const hit = find(r, 'bad-encoding');
  assert.strictEqual(hit.length, 1);
  assert.strictEqual(hit[0].col, 'Title');
  assert.strictEqual(hit[0].level, 'block');
});

test('警告规则:非 http 图片、script、Tags 空格、Grams、空行', () => {
  const r = run(csv(
    row({ 'Image Src': 'ftp://example.com/a.jpg', 'Body (HTML)': '<p>x</p><SCRIPT>1</SCRIPT>', Tags: ' a,b', 'Variant Grams': '重' }),
    '',
    row({ Title: '', 'Image Src': 'https://example.com/ok.jpg', Tags: 'a, b' }),
  ));
  for (const id of ['image-url', 'body-script', 'tags-space', 'grams-invalid']) {
    const hit = find(r, id);
    assert.strictEqual(hit.length, 1, id);
    assert.strictEqual(hit[0].level, 'warn', id);
    assert.strictEqual(hit[0].row, 2, id);
  }
  assert.strictEqual(find(r, 'empty-row').length, 1);
  assert.strictEqual(find(r, 'empty-row')[0].row, 3);
});

test('Title/Vendor 在同一 Handle 下不一致是警告,指向后出现的那行', () => {
  const r = run(csv(row(), row({ Title: '', Vendor: '乙', 'Option1 Value': 'x' }), row({ Title: '另一个名字', 'Option1 Value': 'y' })));
  const hit = find(r, 'meta-mismatch');
  assert.deepStrictEqual(hit.map(x => [x.row, x.col]), [[3, 'Vendor'], [4, 'Title']]);
});

test('价格比同 Handle 其他变体高 10 倍以上:警告;低于 10 倍不报', () => {
  const r = run(csv(
    row({ 'Variant Price': '45', 'Option1 Value': 'a' }),
    row({ Title: '', 'Variant Price': '4500', 'Option1 Value': 'b' }),
    row({ Handle: 'solo', Title: '单品', 'Variant Price': '9999' }),
    row({ Handle: 'near', Title: '近', 'Variant Price': '10', 'Option1 Value': 'a' }),
    row({ Handle: 'near', Title: '', 'Variant Price': '99', 'Option1 Value': 'b' }),
  ));
  const hit = find(r, 'price-outlier');
  assert.strictEqual(hit.length, 1);
  assert.strictEqual(hit[0].row, 3);
});

test('统计:行数、商品数(不同 Handle)、变体数、阻断数、警告数', () => {
  const r = run(csv(
    row({ 'Variant Price': '1', 'Variant SKU': 'a' }),
    row({ Title: '', 'Variant Price': '2', 'Variant SKU': 'b', 'Option1 Value': 'x' }),
    row({ Handle: 'other', Title: '别的', 'Variant Price': 'bad', 'Variant SKU': 'c' }),
    '',
    row({ Handle: 'img', Title: '', 'Image Src': 'https://example.com/i.jpg' }),
  ));
  assert.strictEqual(r.stats.rows, 5);
  assert.strictEqual(r.stats.products, 3);
  assert.strictEqual(r.stats.variants, 3);
  assert.strictEqual(r.stats.blocks, find(r, 'price-invalid').length + find(r, 'title-missing').length);
  assert.strictEqual(r.stats.warns, 1);
});

test('按 Handle 分组使用 Map:__proto__ 与 constructor 当 Handle 不会出错', () => {
  const r = run(csv(row({ Handle: '__proto__' }), row({ Handle: 'constructor', Title: 'c' })));
  assert.strictEqual(r.stats.products, 2);
  assert.strictEqual(find(r, 'handle-format').length, 1, '__proto__ 含下划线不合法,constructor 合法');
});

test('disabledRules 选项可以关闭指定规则', () => {
  const text = csv(row({ 'Variant SKU': 'A' }), row({ Title: '', 'Option1 Value': 'x', 'Variant SKU': 'A' }));
  assert.strictEqual(find(run(text), 'sku-dup').length, 1);
  assert.strictEqual(find(run(text, { disabledRules: ['sku-dup'] }), 'sku-dup').length, 0);
});

test('safeFix:只改安全项并正确计数,不改变其他单元格,不改动输入对象', () => {
  const text = csv(
    row({ Handle: 'Blue Mug', Title: ' 杯 ', Published: 'true', 'Variant Price': 'abc' }),
    ',,,,,,,,,,,,',
    row({ Handle: 'blue mug', Title: '', 'Option1 Value': 'x', Published: 'FALSE' }),
  );
  const parsed = C.parseCsv(text);
  const snapshot = JSON.stringify(parsed);
  const fixed = C.safeFix(parsed);
  assert.strictEqual(JSON.stringify(parsed), snapshot, '输入不被修改');
  assert.strictEqual(fixed.removedRows, 1);
  assert.strictEqual(fixed.parsed.rows.length, 2);
  const H = COLS.indexOf('Handle'), T = COLS.indexOf('Title'), P = COLS.indexOf('Published'), PR = COLS.indexOf('Variant Price');
  assert.strictEqual(fixed.parsed.rows[0][H], 'blue-mug');
  assert.strictEqual(fixed.parsed.rows[0][T], '杯');
  assert.strictEqual(fixed.parsed.rows[0][P], 'TRUE');
  assert.strictEqual(fixed.parsed.rows[0][PR], 'abc', '非法价格不属于安全修复');
  assert.strictEqual(fixed.parsed.rows[1][H], 'blue-mug');
  // 第 1 行:Handle、Title、Published 三格;第 3 行:Handle 一格 = 4
  assert.strictEqual(fixed.changed, 4);
  const after = C.check(fixed.parsed);
  assert.strictEqual(find(after, 'handle-format').length, 0);
  assert.strictEqual(find(after, 'empty-row').length, 0);
  assert.strictEqual(find(after, 'price-invalid').length, 1);
});

test('safeFix:已干净的数据 changed 为 0;列数不对的行原样保留', () => {
  const clean = C.safeFix(C.parseCsv(csv(row())));
  assert.strictEqual(clean.changed, 0);
  assert.strictEqual(clean.removedRows, 0);
  const odd = C.safeFix(C.parseCsv(csv(row(), ' Bad Handle ,x')));
  assert.deepStrictEqual(odd.parsed.rows[1], [' Bad Handle ', 'x']);
  assert.strictEqual(odd.changed, 0);
});

test('toCsv:含逗号、引号、换行的值按 RFC 4180 加引号,并可被 parseCsv 还原', () => {
  const parsed = { headers: ['a', 'b', 'c'], rows: [['x,y', 'say "hi"', 'l1\nl2'], ['plain', '', 'z']] };
  const text = C.toCsv(parsed);
  assert.strictEqual(text, 'a,b,c\r\n"x,y","say ""hi""","l1\nl2"\r\nplain,,z\r\n');
  const back = C.parseCsv(text);
  assert.deepStrictEqual(back.rows, parsed.rows);
});

test('toCsv 防公式注入:任何以 = @ 开头、或以 + - 开头且长度大于 1 的字符串都加单引号(含 -3、+0012);单独的 - + 不加', () => {
  const parsed = { headers: ['v'], rows: [['=SUM(1,2)'], ['@cmd'], ['+1+1'], ['-1+1'], ['-'], ['+'], ['-3'], ['+0012'], ['-0123'], ['12.5'], ['a=b']] };
  const lines = C.toCsv(parsed).trim().split('\r\n').slice(1);
  assert.deepStrictEqual(lines, ['"\'=SUM(1,2)"', "'@cmd", "'+1+1", "'-1+1", '-', '+', "'-3", "'+0012", "'-0123", '12.5', 'a=b']);
  assert.strictEqual(C.neutralizeFormula('=1'), "'=1");
  assert.strictEqual(C.neutralizeFormula('+0012'), "'+0012");
  assert.strictEqual(C.neutralizeFormula(null), '');
});

test('选项值全空的两条变体行(都有 SKU)互相重复,阻断;纯图片行不算变体', () => {
  const r = run(csv(
    row({ 'Variant SKU': 'A1', 'Variant Price': '10' }),
    row({ Title: '', 'Variant SKU': 'A2', 'Variant Price': '12' }),
    row({ Title: '', 'Image Src': 'https://example.com/a.jpg' }),
    row({ Title: '', 'Image Src': 'https://example.com/b.jpg' }),
  ));
  const hit = find(r, 'option-dup');
  assert.strictEqual(hit.length, 1);
  assert.strictEqual(hit[0].row, 3);
  assert.strictEqual(r.stats.blocks, 1);
});

test('Published 列存在但值为空:阻断', () => {
  const r = run(csv(row({ Published: '' }), row({ Published: '  ' }), row({ Published: 'TRUE' })));
  assert.deepStrictEqual(find(r, 'published-invalid').map(x => x.row), [2, 3]);
  assert.ok(find(r, 'published-invalid')[0].message.includes('为空'));
  assert.strictEqual(find(run('Handle,Title\nmug,杯'), 'published-invalid').length, 0, '没有 Published 列时不报');
});

test('Image Src 用 URL 解析验证结构:https://[bad、https://、无协议、javascript: 都警告;合法 http(s) 不报', () => {
  const bad = ['https://[bad', 'https://', 'example.com/a.jpg', 'javascript:alert(1)', 'ftp://example.com/a.jpg', 'http://'];
  const good = ['https://example.com/a.jpg', 'HTTP://example.com/a b.jpg', 'http://localhost:8080/x?y=1#z'];
  const r = run(csv(...bad.map(v => row({ 'Image Src': v })), ...good.map(v => row({ Title: '', 'Image Src': v }))));
  assert.deepStrictEqual(find(r, 'image-url').map(x => x.row), bad.map((_, i) => i + 2));
});

test('问题清单 CSV:包含行号/列/级别/规则/原值,原值同样防公式注入', () => {
  const r = run(csv(row({ Handle: '=BAD()', 'Variant Price': '-x' })));
  const text = C.issuesToCsv(r.issues);
  const back = C.parseCsv(text);
  assert.deepStrictEqual(back.headers, ['行号', '列名', '级别', '规则', '说明', '原值']);
  const handleRow = back.rows.find(x => x[1] === 'Handle');
  assert.strictEqual(handleRow[2], '阻断');
  assert.strictEqual(handleRow[5], "'=BAD()");
  const priceRow = back.rows.find(x => x[1] === 'Variant Price');
  assert.strictEqual(priceRow[5], "'-x");
});

test('问题清单 Markdown:分级列出、转义竖线与尖括号、防公式前缀、含统计', () => {
  const r = run(csv(row({ 'Body (HTML)': '<script>a|b</script>', Tags: ' =x' }), row({ Handle: 'Bad' })));
  const md = C.issuesToMarkdown(r.issues, r.stats);
  assert.ok(md.includes('## 阻断(1)'));
  assert.ok(md.includes('## 警告(2)'));
  assert.ok(md.includes(`阻断:${r.stats.blocks};警告:${r.stats.warns}`));
  assert.ok(md.includes('&lt;script&gt;a\\|b&lt;/script&gt;'));
  assert.ok(!md.includes('<script>'));
  assert.ok(md.includes("'=x") === false, '前导空格的 " =x" 不以 = 开头,不加前缀');
  const md2 = C.issuesToMarkdown(run(csv(row({ Handle: 'Bad' }))).issues);
  assert.ok(md2.includes('## 警告(0)') && md2.includes('无。'));
});

test('RULES:每条有 id、级别、说明,id 不重复,且 check 产出的 ruleId 都在表里', () => {
  assert.ok(Array.isArray(C.RULES) && C.RULES.length >= 19);
  const seen = new Set();
  for (const r of C.RULES) {
    assert.ok(r.id && r.message && r.title);
    assert.ok(r.level === 'block' || r.level === 'warn');
    assert.ok(!seen.has(r.id));
    seen.add(r.id);
  }
  const r = run(csv(row({ Handle: 'A B', 'Variant Price': 'x', 'Image Src': 'x' })));
  assert.ok(ids(r).every(id => seen.has(id)));
  assert.throws(() => { 'use strict'; C.RULES[0].level = 'warn'; }, TypeError);
});

test('一份干净的文件:无阻断无警告', () => {
  const r = run(csv(
    row({ 'Variant Price': '19.90', 'Variant SKU': 'S1', 'Variant Inventory Qty': '5', 'Image Src': 'https://example.com/a.jpg' }),
    row({ Title: '', 'Option1 Value': 'x', 'Variant Price': '29.90', 'Variant SKU': 'S2' }),
  ));
  assert.deepStrictEqual(r.issues, []);
  assert.strictEqual(r.stats.products, 1);
});

test('[第五轮] verdict:只有检查完整完成且无问题才说「没有发现问题」', () => {
  const clean = C.parseCsv(csv(row()));
  const r = C.check(clean);
  const v = C.verdict(r, clean);
  assert.strictEqual(v.kind, 'ok');
  assert.match(v.text, /没有发现阻断问题/);
  const broken = C.parseCsv('Handle,Title\n"abc,def\n');
  const vb = C.verdict(C.check(broken), broken);
  assert.strictEqual(vb.kind, 'incomplete');
  assert.match(vb.text, /检查未完成：\d+ 处解析错误/);
  assert.doesNotMatch(vb.text, /没有发现/);
  const empty = C.parseCsv('');
  assert.strictEqual(C.verdict(C.check(empty), empty).kind, 'incomplete');
});

test('[第五轮] verdict:有阻断/只有警告时分别给出数量', () => {
  const p = C.parseCsv(csv(row({ Handle: 'Bad Handle' })));
  const v = C.verdict(C.check(p), p);
  assert.strictEqual(v.kind, 'block');
  assert.match(v.text, /阻断问题/);
  const w = C.parseCsv(csv(row({ Handle: 'a', 'Variant SKU': 'S1' }), row({ Handle: 'b', 'Variant SKU': 'S1' })));
  const vw = C.verdict(C.check(w), w);
  assert.strictEqual(vw.kind, 'warn');
});

test('[第五轮] 合成示例标记写进问题清单 Markdown 与 CSV', () => {
  const p = C.parseCsv(csv(row({ Handle: 'Bad Handle' })));
  const r = C.check(p);
  assert.match(C.issuesToMarkdown(r.issues, r.stats, { sample: true }), /数据来源：合成示例/);
  assert.doesNotMatch(C.issuesToMarkdown(r.issues, r.stats), /合成示例/);
  const withCol = C.issuesToCsv(r.issues, { sample: true }).split('\r\n');
  assert.ok(withCol[0].endsWith(',数据来源') && withCol[1].endsWith(',合成示例'));
  assert.ok(!C.issuesToCsv(r.issues).split('\r\n')[0].includes('数据来源'));
});

test('[第五轮] 解析有错误时问题清单 Markdown 标注「检查未完成」', () => {
  const broken = C.parseCsv('Handle,Title\n"abc,def\n');
  const r = C.check(broken);
  assert.match(C.issuesToMarkdown(r.issues, r.stats, { parseErrors: broken.errors.length }), /检查未完成：\d+ 处解析错误/);
});

test('[第五轮] STAT_NOTES:商品数与变体数的计数条件写在核心里,界面直接引用', () => {
  assert.match(C.STAT_NOTES.products, /不同 Handle/);
  assert.match(C.STAT_NOTES.variants, /SKU.*价格、库存或选项值/);
});

test('[W6 导入] checkTextFile:空文件与无法按 UTF-8 解码的文件被拒绝并给出原因,正常文本放行', () => {
  const empty = C.checkTextFile('');
  assert.strictEqual(empty.ok, false);
  assert.strictEqual(empty.code, 'empty');
  assert.match(empty.message, /空/);
  assert.strictEqual(C.checkTextFile(' \r\n\t').code, 'empty');
  assert.strictEqual(C.checkTextFile('\uFEFF').code, 'empty');
  assert.strictEqual(C.checkTextFile(null).code, 'empty');
  const enc = C.checkTextFile('abc,def\n\u0007\uFFFD\uFFFD,x');
  assert.strictEqual(enc.ok, false);
  assert.strictEqual(enc.code, 'encoding');
  assert.match(enc.message, /UTF-8/);
  // 只有表头、不像表格的普通文本不在这里拦:交给各产品自己的解析规则报错
  assert.deepStrictEqual(C.checkTextFile('a,b'), { ok: true, code: '', message: '' });
  assert.strictEqual(C.checkTextFile('{broken json').ok, true);
});
