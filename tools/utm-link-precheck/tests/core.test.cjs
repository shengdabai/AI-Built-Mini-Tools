'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const OK = 'https://a.example.com/p?utm_source=x&utm_medium=y&utm_campaign=z';
const codes = (urls, opt) => C.check(urls, opt).issues.map(i => i.code);

test('无协议:补 https 并给警告', () => {
  const p = C.parseUrl('a.example.com/p?utm_source=x');
  assert.equal(p.ok, true);
  assert.equal(p.scheme, 'https');
  assert.ok(codes(['a.example.com/p?utm_source=x&utm_medium=y&utm_campaign=z']).includes('no-protocol'));
  assert.equal(C.normalize('a.example.com/p').url, 'https://a.example.com/p');
});

test('非法 URL 与非 http(s) 协议阻断', () => {
  assert.equal(C.parseUrl('not a url').ok, false);
  assert.equal(C.parseUrl('hello').ok, false);
  assert.equal(C.parseUrl('https://exa mple.com/x').ok, false);
  assert.equal(C.parseUrl('ftp://a.example.com/x').code, 'scheme');
  assert.equal(C.parseUrl('javascript:alert(1)').code, 'scheme');
  const r = C.check(['not a url', 'ftp://a.example.com/x']);
  assert.deepEqual(r.issues.map(i => [i.row, i.level, i.code]), [[1, 'block', 'unparseable'], [2, 'block', 'scheme']]);
  assert.equal(r.stats.blocked, 2);
});

test('必填缺失,且可配置', () => {
  const u = 'https://a.example.com/p?utm_medium=y&utm_campaign=z';
  const miss = C.check([u]).issues.filter(i => i.code === 'missing-required');
  assert.equal(miss.length, 1);
  assert.match(miss[0].message, /utm_source/);
  assert.equal(codes([u], { required: ['utm_medium'] }).includes('missing-required'), false);
  assert.ok(codes([OK], { required: ['utm_source', 'utm_content'] }).includes('missing-required'));
  assert.ok(codes(['https://a.example.com/p?utm_source='], { required: ['utm_source'] }).includes('missing-required'));
});

test('重复参数:值不同阻断,值相同仅警告', () => {
  const diff = C.check(['https://a.example.com/p?utm_source=a&utm_source=b&utm_medium=y&utm_campaign=z']);
  const d = diff.issues.find(i => i.code === 'dup-conflict');
  assert.equal(d.level, 'block');
  assert.match(d.message, /a、b/);
  const same = C.check(['https://a.example.com/p?utm_source=a&utm_source=a&utm_medium=y&utm_campaign=z']);
  assert.equal(same.issues.some(i => i.code === 'dup-conflict'), false);
  assert.equal(same.issues.find(i => i.code === 'dup-same').level, 'warn');
  // 冲突的参数不被静默丢弃
  assert.equal(C.normalize('https://a.example.com/p?utm_source=a&utm_source=b').url, 'https://a.example.com/p?utm_source=a&utm_source=b');
});

test('未编码中文与空格:阻断并给编码后值', () => {
  const r = C.check(['https://a.example.com/p?utm_source=微博&utm_medium=y&utm_campaign=spring sale']);
  const enc = r.issues.filter(i => i.code === 'needs-encoding');
  assert.equal(enc.length, 2);
  assert.equal(enc[0].fix, '%E5%BE%AE%E5%8D%9A');
  assert.equal(enc[1].fix, 'spring%20sale');
  assert.equal(codes([OK]).includes('needs-encoding'), false);
  // 已编码的值(含小写十六进制)不误报
  assert.equal(codes(['https://a.example.com/p?utm_source=%e5%be%ae&utm_medium=y&utm_campaign=z']).includes('needs-encoding'), false);
  assert.equal(C.normalize('https://a.example.com/p?q=a b&r=100%').url, 'https://a.example.com/p?q=a%20b&r=100%25');
});

test('参数名与值的大小写', () => {
  const r = C.check(['https://a.example.com/p?utm_Source=Weibo&utm_medium=y&utm_campaign=z']);
  assert.deepEqual(r.issues.map(i => i.code).sort(), ['key-case', 'value-upper']);
  assert.equal(r.issues.find(i => i.code === 'key-case').fix, 'utm_source');
  // 关闭「值小写」后不再警告
  assert.equal(codes(['https://a.example.com/p?utm_source=Weibo&utm_medium=y&utm_campaign=z'], { lowercaseValues: false }).includes('value-upper'), false);
  // utm_Source 仍满足必填
  assert.equal(r.issues.some(i => i.code === 'missing-required'), false);
});

test('campaign 命名正则:默认、自定义、非法回退', () => {
  const u = 'https://a.example.com/p?utm_source=x&utm_medium=y&utm_campaign=spring.sale';
  assert.ok(codes([u]).includes('campaign-pattern'));
  assert.equal(codes([u], { campaignPattern: '^[a-z.]+$' }).includes('campaign-pattern'), false);
  const r = C.check([u], { campaignPattern: '([' });
  assert.ok(r.issues.some(i => i.code === 'campaign-pattern'));
  assert.equal(r.stats.notes.length, 1);
  assert.equal(codes([OK]).includes('campaign-pattern'), false);
});

test('片段位置:# 在参数之前时警告并在规范化时移到最后', () => {
  const u = 'https://a.example.com/p#pricing?utm_source=x&utm_medium=y&utm_campaign=z';
  const r = C.check([u]);
  assert.deepEqual(r.issues.map(i => i.code), ['fragment-position']);
  assert.equal(C.normalize(u).url, 'https://a.example.com/p?utm_campaign=z&utm_medium=y&utm_source=x#pricing');
  assert.equal(codes([OK + '#top']).includes('fragment-position'), false);
});

test('重复链接:规范化后相同即算重复,并指出首次出现的行', () => {
  const a = 'https://a.example.com/p?utm_source=x&utm_medium=y&utm_campaign=z';
  const b = 'https://A.example.com/p?utm_campaign=z&utm_medium=y&utm_source=x';
  const r = C.check([a, 'https://a.example.com/other?utm_source=x&utm_medium=y&utm_campaign=z', b]);
  const d = r.issues.filter(i => i.code === 'duplicate-link');
  assert.equal(d.length, 1);
  assert.equal(d[0].row, 3);
  assert.match(d[0].message, /第 1 行/);
});

test('域名允许列表:精确与子域,留空则不检查', () => {
  const u = 'https://sub.shop.com/p?utm_source=x&utm_medium=y&utm_campaign=z';
  assert.equal(codes([u], { allowedDomains: ['shop.com'] }).includes('domain'), false);
  assert.ok(codes([u], { allowedDomains: ['other.com'] }).includes('domain'));
  assert.ok(codes(['https://notshop.com/p?utm_source=x&utm_medium=y&utm_campaign=z'], { allowedDomains: ['shop.com'] }).includes('domain'));
  assert.equal(codes([u]).includes('domain'), false);
});

test('参数顺序:同域名多数顺序为准,缺项不算不一致,可关闭', () => {
  const o = (...k) => 'https://a.example.com/p?' + k.map(x => x + '=v').join('&');
  const list = [o('utm_source', 'utm_medium', 'utm_campaign'), o('utm_source', 'utm_medium', 'utm_campaign'),
    o('utm_campaign', 'utm_medium', 'utm_source'), o('utm_medium', 'utm_campaign'),
    'https://b.example.com/p?utm_campaign=v&utm_source=v'];
  const r = C.check(list, { required: [] }).issues.filter(i => i.code === 'param-order');
  assert.deepEqual(r.map(i => i.row), [3]);
  assert.equal(C.check(list, { required: [], checkOrder: false }).issues.some(i => i.code === 'param-order'), false);
});

test('normalize:小写键、编码值、去重、排序,非 UTM 参数保持原样,且幂等', () => {
  const cases = [
    'https://A.Example.com/p?z=Keep&utm_Source=Weibo&utm_medium=a b&utm_source=weibo&utm_campaign=Spring',
    'a.example.com/x#frag?utm_source=A',
    'https://a.example.com/?q=%e4%b8%ad&utm_term=%E4%B8%AD文',
    'http://a.example.com:8080/a b?x'
  ];
  cases.forEach(c => {
    const once = C.normalize(c);
    assert.equal(once.ok, true);
    assert.equal(C.normalize(once.url).url, once.url, '不幂等:' + c);
    assert.equal(C.normalize(once.url).changed, false);
  });
  assert.equal(C.normalize(cases[0]).url,
    'https://a.example.com/p?utm_campaign=spring&utm_medium=a%20b&utm_source=weibo&z=Keep');
  assert.equal(C.normalize(cases[2]).url, 'https://a.example.com/?q=%E4%B8%AD&utm_term=%E4%B8%AD%E6%96%87');
  assert.equal(C.normalize('bad url').ok, false);
});

test('build:组合数 = 各行取值的笛卡尔积之和,覆盖基础链接里的 UTM', () => {
  const rows = C.parseTable('source,medium,campaign,content,term\nnewsletter,email|social,spring,,\nwechat,social|cpc,spring,banner_a|banner_b,\n').rows;
  const r = C.build('https://a.example.com/p?ref=home&utm_source=old', rows);
  assert.equal(r.ok, true);
  assert.equal(r.count, 2 + 4);
  assert.equal(new Set(r.links.map(l => l.url)).size, 6);
  assert.equal(r.links[0].url, 'https://a.example.com/p?ref=home&utm_campaign=spring&utm_medium=email&utm_source=newsletter');
  assert.ok(r.links.every(l => !l.url.includes('utm_source=old')));
  // 生成的链接自己通过检查
  assert.equal(C.check(r.links.map(l => l.url)).stats.blocked, 0);
});

test('build:任一行缺必填即整份拒绝,不给部分结果;基础链接非法或组合过多也拒绝', () => {
  const r = C.build('https://a.example.com/p', [{ source: 'a', medium: '', campaign: 'c' }, { source: 'a', medium: 'm', campaign: 'c' }]);
  assert.equal(r.ok, false);
  assert.equal(r.count, 0);
  assert.deepEqual(r.links, []);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /utm_medium/);
  assert.equal(C.build('nope nope', []).ok, false);
  const many = Array.from({ length: 80 }, (_, i) => 'v' + i).join('|');
  const big = C.build('https://a.example.com/p', [{ source: many, medium: many, campaign: 'c' }]);
  assert.equal(big.ok, false);
  assert.match(big.error, /6400/);
  assert.equal(C.build('https://a.example.com/p', [{ source: '微博', medium: 'm', campaign: 'c' }]).links[0].url.includes('%E5%BE%AE%E5%8D%9A'), true);
});

test('build:表格里的字面 + 与 % 按原始值编码(%2B / %25),解析回来与单元格一致', () => {
  const r = C.build('https://a.example.com/p', [{ source: 'a+b', medium: '100%', campaign: 'c d' }]);
  assert.equal(r.ok, true);
  assert.equal(r.links[0].url, 'https://a.example.com/p?utm_campaign=c%20d&utm_medium=100%25&utm_source=a%2Bb');
  const q = new URL(r.links[0].url).searchParams;
  assert.equal(q.get('utm_source'), 'a+b');
  assert.equal(q.get('utm_medium'), '100%');
  assert.equal(C.normalize(r.links[0].url).url, r.links[0].url);
});

test('parseTable / parseBatch:引号未闭合时拒绝整份输入', () => {
  const t = C.parseTable('source,medium,campaign\na,"m,c\nb,m2,c2\n');
  assert.deepEqual(t.rows, []);
  assert.equal(t.errors.length, 1);
  assert.match(t.errors[0], /第 2 行.*引号/);
  assert.equal(C.parseTable('source,medium,campaign\na,m,c\n').errors.length, 0);
  const b = C.parseBatch('url,name\n"https://a.example.com/x,1\nhttps://a.example.com/y,2\n');
  assert.equal(b.length, 0);
  assert.match(b.error, /引号/);
  assert.equal(C.parseBatch('url,name\nhttps://a.example.com/x,1\n').error, undefined);
});

test('参数名先解码再检查必填与重复:%75tm_source 等同 utm_source', () => {
  const dup = C.check(['https://a.example.com/p?utm_source=a&%75tm_source=b&utm_medium=y&utm_campaign=z']);
  const d = dup.issues.find(i => i.code === 'dup-conflict');
  assert.ok(d, '应触发重复冲突');
  assert.match(d.message, /utm_source/);
  const req = C.check(['https://a.example.com/p?%75tm_source=a&utm_medium=y&utm_campaign=z']);
  assert.equal(req.issues.some(i => i.code === 'missing-required'), false);
  const up = C.check(['https://a.example.com/p?%55tm_source=a&utm_medium=y&utm_campaign=z']);
  assert.ok(up.issues.some(i => i.code === 'key-case'));
  assert.equal(C.normalize('https://a.example.com/p?%75tm_source=a').url, 'https://a.example.com/p?utm_source=a');
});

test('CSV 与 Markdown 导出:公式防护,单独的 - 与 + 不加前缀', () => {
  const csv = C.toCsv(['a', 'b'], [['=HYPERLINK("x")', '+1'], ['-', '+'], ['@cmd', '-5'], ['a,b', 'q"r']]);
  assert.equal(csv, 'a,b\n"\'=HYPERLINK(""x"")",\'+1\n-,+\n\'@cmd,\'-5\n"a,b","q""r"\n');
  const md = C.issuesToMarkdown([{ row: 1, level: 'block', code: 'unparseable', message: 'x|y', raw: '=cmd|bad' }], { total: 1, blocked: 1, warned: 0, clean: 0 });
  assert.match(md, /\| 1 \| 阻断 \| 无法解析 \| x\\\|y \| '=cmd\\\|bad \|/);
  assert.match(md, /阻断 1 条/);
  assert.equal(C.issuesToMarkdown([], { total: 2, blocked: 0, warned: 0, clean: 2 }).includes('没有发现问题'), true);
});

test('空输入与空白行', () => {
  assert.deepEqual(C.parseBatch(''), []);
  assert.deepEqual(C.parseBatch('  \n\n \r\n'), []);
  const r = C.check([]);
  assert.deepEqual(r.issues, []);
  assert.equal(r.stats.total, 0);
  assert.equal(C.check(['', '   ']).stats.total, 0);
  assert.equal(C.parseUrl('').ok, false);
  assert.equal(C.parseUrl(null).ok, false);
  assert.deepEqual(C.build('https://a.example.com', []).links, []);
});

test('parseBatch:按行、跳过空行、保留行号;CSV 取链接列', () => {
  const plain = C.parseBatch('https://a.example.com/1\n\n  https://a.example.com/2  \r\n');
  assert.deepEqual(plain.map(e => [e.row, e.raw]), [[1, 'https://a.example.com/1'], [3, 'https://a.example.com/2']]);
  const csv = C.parseBatch('name,链接\nA,"https://a.example.com/p?x=1,2"\nB,https://a.example.com/q\n,\n');
  assert.deepEqual(csv.map(e => [e.row, e.raw]), [[2, 'https://a.example.com/p?x=1,2'], [3, 'https://a.example.com/q']]);
});

test('applyAdoptions:按行替换,CSV 里含逗号的链接加引号,其余列不动', () => {
  const t1 = 'u1\n\n  u2  \nu3';
  const e1 = C.parseBatch(t1);
  assert.equal(C.applyAdoptions(t1, e1, new Map([[1, 'N1'], [3, 'N3']])), 'N1\n\n  N3  \nu3');
  const t2 = 'name,url\nA,x\nB,"y"\n';
  const e2 = C.parseBatch(t2);
  assert.equal(C.applyAdoptions(t2, e2, { 2: 'https://h/p?a=1,2', 3: 'z' }), 'name,url\nA,"https://h/p?a=1,2"\nB,z\n');
});

test('validateSettings:非法设置整份拒绝', () => {
  const good = { required: ['utm_source'], lowercaseValues: true, campaignPattern: '^a$', allowedDomains: ['x.com'], checkOrder: false };
  assert.equal(C.validateSettings(good).ok, true);
  [null, [], { ...good, required: 'utm_source' }, { ...good, lowercaseValues: 'yes' }, { ...good, campaignPattern: '(' },
    { ...good, allowedDomains: ['a b'] }, { ...good, extra: 1 }, { required: [] }, { ...good, required: ['bad key'] }]
    .forEach(bad => assert.equal(C.validateSettings(bad).ok, false));
});

test('按名分组不受 __proto__ / constructor 影响', () => {
  const r = C.check(['https://a.example.com/p?__proto__=1&__proto__=2&constructor=a&utm_source=x&utm_medium=y&utm_campaign=z']);
  assert.equal(r.issues.find(i => i.code === 'dup-conflict').message.includes('__proto__'), true);
  assert.equal(Object.keys(r.stats.byCode).includes('dup-conflict'), true);
  assert.equal(C.check(['https://__proto__.example.com/a?utm_source=1&utm_medium=2', 'https://constructor.example.com/a?utm_source=1&utm_medium=2']).stats.total, 2);
});
