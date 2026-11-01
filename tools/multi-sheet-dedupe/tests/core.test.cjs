'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');
const SAMPLE = require('../sample-data.js');

let seq = 0;
const rec = (o) => Object.assign({ id: 'r' + (++seq), table: 'T', tableId: 't', tableIndex: 0, row: seq, name: '', phone: '', email: '', company: '', wechat: '', extras: [] }, o);

test('parseTable:逗号 CSV,引号内逗号与换行与 "" 转义', () => {
  const p = C.parseTable('姓名,备注\r\n"张, 三","第一行\n第二行 ""引用"""\r\n李四,\r\n');
  assert.equal(p.ok, true);
  assert.deepEqual(p.headers, ['姓名', '备注']);
  assert.equal(p.rows.length, 2);
  assert.equal(p.rows[0][0], '张, 三');
  assert.equal(p.rows[0][1], '第一行\n第二行 "引用"');
  assert.deepEqual(p.rows[1], ['李四', '']);
});

test('parseTable:自动识别 Tab / 分号 / 逗号分隔符,BOM 被去掉', () => {
  assert.equal(C.parseTable('a\tb\tc\n1\t2\t3').delimiter, '\t');
  assert.equal(C.parseTable('a;b;c\n1;2;3').delimiter, ';');
  const p = C.parseTable('\uFEFFa,b\n1,2');
  assert.equal(p.delimiter, ',');
  assert.equal(p.headers[0], 'a');
  // 引号里的 Tab 不能影响判断
  assert.equal(C.parseTable('"x\ty",b,c\n1,2,3').delimiter, ',');
});

test('parseTable:空文本、只有表头、跳过空行都不报错', () => {
  assert.deepEqual(C.parseTable(''), { ok: true, delimiter: ',', headers: [], rows: [] });
  assert.deepEqual(C.parseTable('   \n  ').rows, []);
  const p = C.parseTable('a,b\n\n1,2\n,\n3,4');
  assert.equal(p.rows.length, 2);
  assert.equal(C.parseTable('a,b').rows.length, 0);
});

test('parseTable:拒绝而不是修正(未闭合引号、列数超出、表头重复、引号后多余字符)', () => {
  assert.equal(C.parseTable('a,b\n"1,2').ok, false);
  const wide = C.parseTable('a,b\n1,2,3');
  assert.equal(wide.ok, false);
  assert.match(wide.error, /3 列/);
  assert.equal(C.parseTable('a,a\n1,2').ok, false);
  assert.equal(C.parseTable('a,b\n"x"y,2').ok, false);
  // 较短的行视为尾部留空,补齐
  assert.deepEqual(C.parseTable('a,b,c\n1').rows[0], ['1', '', '']);
});

test('guessMapping:中英文列名,每个角色只猜一次,其余为其他', () => {
  assert.deepEqual(C.guessMapping(['姓名', '手机号', '邮箱', '公司', '微信号', '备注']), ['name', 'phone', 'email', 'company', 'wechat', 'other']);
  assert.deepEqual(C.guessMapping(['Name', 'Mobile', 'E-mail', 'Company', 'WeChat', 'City']), ['name', 'phone', 'email', 'company', 'wechat', 'other']);
  assert.deepEqual(C.guessMapping(['手机', '电话']), ['phone', 'other']);
});

test('normalize.phone:空格 - 括号、+86 / 0086、全角数字', () => {
  const p = C.normalize.phone;
  assert.equal(p('138 0000-0001'), '13800000001');
  assert.equal(p('(138) 0000 0001'), '13800000001');
  assert.equal(p('+86 138-0000-0001'), '13800000001');
  assert.equal(p('0086 138 0000 0001'), '13800000001');
  assert.equal(p('８６13800000001'), '13800000001');
  assert.equal(p('１３８０００００００１'), '13800000001');
  assert.equal(p('+1 415 555 0100'), '14155550100');
  assert.equal(p(''), '');
  assert.equal(p(null), '');
  assert.equal(p('暂无'), '');
  assert.equal(p('86123'), '86123'); // 不是 13 位,不当作国家码
});

test('normalize.email:小写、去空格,空值安全', () => {
  assert.equal(C.normalize.email('  Wang.Xm @Example.COM '), 'wang.xm@example.com');
  assert.equal(C.normalize.email(undefined), '');
});

test('normalize.name:中文去所有空格含全角,英文首字母大写并合并空格', () => {
  const n = C.normalize.name;
  assert.equal(n('  李　娜 '), '李娜');
  assert.equal(n('王 小 明'), '王小明');
  assert.equal(n('JOHN   smith'), 'John Smith');
  assert.equal(n('john smith'), 'John Smith');
  assert.equal(n(''), '');
  assert.equal(n('　'), '');
});

test('normalize.company:去有限公司 / 股份有限公司 / Ltd. / Inc. 与空格,原值不动', () => {
  const c = C.normalize.company;
  assert.equal(c('星河科技有限公司'), '星河科技');
  assert.equal(c('远山传媒 股份有限公司'), '远山传媒');
  assert.equal(c('Acme Ltd.'), 'acme');
  assert.equal(c('ACME Inc.'), 'acme');
  assert.equal(c('星河科技 Co., Ltd.'), '星河科技');
  assert.equal(c(''), '');
  assert.equal(c('有限公司'), '');
});

test('editDistance:中文按字、英文按字母,空串与 Unicode 码点', () => {
  assert.equal(C.editDistance('陈思远', '陈思源'), 1);
  assert.equal(C.editDistance('陈思远', '陈思远'), 0);
  assert.equal(C.editDistance('kitten', 'sitting'), 3);
  assert.equal(C.editDistance('', '张'), 1);
  assert.equal(C.editDistance('', ''), 0);
  assert.equal(C.editDistance('𠮷野', '吉野'), 1); // 代理对算一个字
});

test('强规则:邮箱 / 手机 / 微信号 / 姓名+公司 各自能合并,空值不互相匹配', () => {
  const byEmail = C.cluster([rec({ name: 'A', email: 'X@a.com' }), rec({ name: 'B', email: 'x@A.com' })]);
  assert.equal(byEmail.clusters.length, 1);
  const byPhone = C.cluster([rec({ name: 'A1', phone: '+86 138 0000 0001' }), rec({ name: 'B1', phone: '13800000001' })]);
  assert.equal(byPhone.clusters.length, 1);
  const byWx = C.cluster([rec({ name: 'A2', wechat: 'Wx_1' }), rec({ name: 'B2', wechat: 'wx_1 ' })]);
  assert.equal(byWx.clusters.length, 1);
  const byNc = C.cluster([rec({ name: '李 娜', company: '明远教育有限公司' }), rec({ name: '李娜', company: '明远教育' })]);
  assert.equal(byNc.clusters.length, 1);
  const none = C.cluster([rec({ name: 'P' }), rec({ name: 'Q' }), rec({ name: 'R', email: '' }), rec({ name: 'S', phone: '暂无' })]);
  assert.equal(none.clusters.length, 4);
  // 只有姓名一致、公司缺失:强规则不合并
  const nameOnly = C.cluster([rec({ name: '周青', company: '甲' }), rec({ name: '周青' })], { suspect: false });
  assert.equal(nameOnly.clusters.length, 2);
});

test('规则可关闭:关掉邮箱规则后同邮箱不再合并', () => {
  const rs = [rec({ name: 'A', email: 'x@a.com' }), rec({ name: 'B', email: 'x@a.com' })];
  assert.equal(C.cluster(rs, { email: false, suspect: false }).clusters.length, 2);
  assert.equal(C.cluster(rs, { email: true }).clusters.length, 1);
});

test('并查集传递合并:A~B(邮箱)、B~C(手机) → 同簇,且顺序稳定', () => {
  const a = rec({ name: 'A', email: 'x@a.com' });
  const b = rec({ name: 'B', email: 'x@a.com', phone: '13800000009' });
  const c = rec({ name: 'C', phone: '138 0000 0009' });
  const d = rec({ name: 'D', email: 'other@a.com' });
  const { clusters } = C.cluster([c, d, b, a], { suspect: false });
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].members.length, 3);
  assert.deepEqual(clusters[0].members.map(m => m.name), ['C', 'B', 'A']);
  assert.deepEqual(clusters.map(x => x.id), [1, 2]);
});

test('疑似规则:姓名差一字且手机或邮箱缺失 → 待确认,不自动并入;双方联系方式齐全则不算', () => {
  const a = rec({ name: '陈思远', email: 'c@a.com' });
  const b = rec({ name: '陈思源', phone: '13800000003' });
  const r = C.cluster([a, b]);
  assert.equal(r.clusters.length, 2);
  assert.equal(r.suspects.length, 1);
  assert.equal(r.suspects[0].distance, 1);
  assert.equal(r.clusters[0].suspect, true);
  assert.equal(r.clusters[0].viaSuspect, false);
  const full1 = rec({ name: '陈思远', email: 'c1@a.com', phone: '13800000001' });
  const full2 = rec({ name: '陈思源', email: 'c2@a.com', phone: '13800000002' });
  assert.equal(C.cluster([full1, full2]).suspects.length, 0);
  // 差两个字不算
  assert.equal(C.cluster([rec({ name: '陈思远' }), rec({ name: '陈小源' })]).suspects.length, 0);
  // SPEC 没有最短姓名限制:单字名相差一个字也列为疑似
  assert.equal(C.cluster([rec({ name: '凯' }), rec({ name: '楷' })]).suspects.length, 1);
  assert.equal(C.cluster([rec({ name: '' }), rec({ name: '' })]).suspects.length, 0);
  // 关闭疑似规则
  assert.equal(C.cluster([a, b], { suspect: false }).suspects.length, 0);
});

test('疑似确认:confirmed 里的键才并入,并标记 viaSuspect;其他键不影响', () => {
  const a = rec({ name: '陈思远', email: 'c@a.com' });
  const b = rec({ name: '陈思源', phone: '13800000003' });
  const key = C.cluster([a, b]).suspects[0].key;
  const merged = C.cluster([a, b], {}, [key]);
  assert.equal(merged.clusters.length, 1);
  assert.equal(merged.clusters[0].viaSuspect, true);
  assert.equal(merged.suspects.length, 0);
  assert.equal(C.cluster([a, b], {}, ['不存在~的键']).clusters.length, 2);
});

test('冲突字段:同字段不同非空值才算;只有一方有值、写法不同但标准化后相同都不算', () => {
  const same = C.cluster([
    rec({ name: '王小明', phone: '138 0000 0001', email: 'a@a.com', company: '星河科技有限公司' }),
    rec({ name: '王 小明', phone: '+86 13800000001', email: 'A@a.com', company: '星河科技' })
  ]);
  assert.deepEqual(same.clusters[0].conflicts, []);
  const oneSide = C.cluster([rec({ email: 'a@a.com', phone: '13800000001' }), rec({ email: 'a@a.com' })]);
  assert.deepEqual(oneSide.clusters[0].conflicts, []);
  const diff = C.cluster([
    rec({ name: '赵立', email: 'z@a.com', phone: '13800000004', company: '云帆教育', extras: [{ k: '城市', v: '北京' }] }),
    rec({ name: '赵立', email: 'z@a.com', phone: '13800000005', company: '云帆文化', extras: [{ k: '城市', v: '上海' }] }),
    rec({ name: '赵立', email: 'z@a.com', phone: '13800000016' })
  ]);
  assert.deepEqual(diff.clusters[0].conflicts, ['phone', 'company', 'x:城市']);
  const det = C.conflictDetails(diff.clusters[0]);
  assert.equal(det[0].values.length, 3);
  assert.equal(det[1].label, '公司');
});

test('pickMaster:非空字段最多者,并列取靠前,空簇返回 -1', () => {
  const cl = { members: [rec({ name: 'A' }), rec({ name: 'B', email: 'b@a.com', extras: [{ k: 'x', v: '1' }] }), rec({ name: 'C', email: 'c@a.com', phone: '1' })] };
  assert.equal(C.pickMaster(cl), 1);
  const tie = { members: [rec({ name: 'A', email: 'a@a.com' }), rec({ name: 'B', email: 'b@a.com' })] };
  assert.equal(C.pickMaster(tie), 0);
  assert.equal(C.pickMaster({ members: [] }), -1);
});

test('merge:主记录优先、缺项由其他记录补充、冲突值用 " / " 全部保留并列入冲突列', () => {
  const m0 = rec({ name: '赵立', email: 'z@a.com', phone: '138 0000 0004', company: '云帆教育', extras: [{ k: '备注', v: '素食' }] });
  const m1 = rec({ name: '赵立', phone: '138 0000 0005', wechat: 'zl', company: '云帆教育有限公司', extras: [{ k: '城市', v: '北京' }] });
  const cl = { id: 7, members: [m0, m1], conflicts: [] };
  const out = C.merge(cl, 0);
  assert.equal(out.fields.name, '赵立');
  assert.equal(out.fields.phone, '138 0000 0004 / 138 0000 0005');
  assert.equal(out.fields.company, '云帆教育'); // 标准化后相同,不重复列出
  assert.equal(out.fields.wechat, 'zl'); // 补充
  assert.deepEqual(out.conflicts, ['phone']);
  assert.deepEqual(out.conflictLabels, ['手机']);
  assert.deepEqual(out.extras.map(e => e.k), ['备注', '城市']);
  // 换主记录:主记录的值排在前面
  assert.equal(C.merge(cl, 1).fields.phone, '138 0000 0005 / 138 0000 0004');
  // 非法下标回退到默认主记录
  assert.equal(C.merge(cl, 99).master, m0.id);
  assert.equal(out.sources.length, 2);
});

test('buildRecords:按列映射取值,重复角色的后一列与「其他」列进入保留字段,skip 列丢弃', () => {
  const table = { id: 'a', name: '表A', headers: ['姓名', '手机', '座机', '备注', '内部ID'], rows: [['  张三 ', '138', '021', '素食', '9'], ['', '', '', '', '']],
    mapping: ['name', 'phone', 'phone', 'other', 'skip'] };
  const rs = C.buildRecords(table, 2);
  assert.equal(rs.length, 2);
  assert.equal(rs[0].name, '张三');
  assert.equal(rs[0].phone, '138');
  assert.deepEqual(rs[0].extras, [{ k: '座机', v: '021' }, { k: '备注', v: '素食' }]);
  assert.equal(rs[0].id, 'a#1');
  assert.equal(rs[0].tableIndex, 2);
  assert.deepEqual(rs[1].extras, []);
});

test('toCsv:逗号 / 引号 / 换行转义;公式前缀加单引号,单独的 - 或 + 不算', () => {
  assert.equal(C.toCsv([['a', 'b,c', 'd"e', 'f\ng']]), 'a,"b,c","d""e","f\ng"');
  assert.equal(C.csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(C.csvCell('+86 138'), "'+86 138");
  assert.equal(C.csvCell('-5'), "'-5");
  assert.equal(C.csvCell('@x'), "'@x");
  assert.equal(C.csvCell('-'), '-');
  assert.equal(C.csvCell('+'), '+');
  assert.equal(C.csvCell('a=b'), 'a=b');
  assert.equal(C.toCsv([['=1+1', '正常']]), "'=1+1,正常");
  assert.equal(C.toCsv([]), '');
});

test('合并 CSV 与原始记录 CSV:每组一行,含冲突列与组号,用户字段带公式前缀', () => {
  const a = rec({ name: '=HYPERLINK("x")', email: 'e@a.com', phone: '13800000001' });
  const b = rec({ name: '=HYPERLINK("x")', email: 'e@a.com', phone: '13800000002', extras: [{ k: '城市', v: '上海' }] });
  const c = rec({ name: '孤立', phone: '13900000000' });
  const { clusters } = C.cluster([a, b, c]);
  const rows = C.mergedRows(clusters, []);
  assert.deepEqual(rows[0], ['组号', '姓名', '手机', '邮箱', '公司', '微信号', '城市', '合并条数', '来源', '冲突字段', '备注']);
  assert.equal(rows.length, 3);
  // b 有「城市」,非空字段更多,默认成为主记录,它的手机排在前面
  assert.equal(rows[1][2], '13800000002 / 13800000001');
  assert.equal(rows[1][9], '手机');
  assert.equal(rows[2][9], '');
  const csv = C.toCsv(rows);
  assert.ok(csv.includes('\'=HYPERLINK(""x"")'), csv);
  const orig = C.originalRows(clusters);
  assert.equal(orig.length, 4);
  assert.deepEqual(orig[0].slice(0, 3), ['组号', '来源表', '行号']);
  assert.equal(orig[1][0], 1);
  assert.equal(orig[3][0], 2);
  // 手选主记录
  assert.equal(C.mergedRows(clusters, [a.id])[1][2], '13800000001 / 13800000002');
});

test('冲突报告 Markdown:转义竖线与换行,公式前缀;无冲突给出明确说明', () => {
  const a = rec({ table: '表|A', name: '赵立', email: 'z@a.com', company: '=cmd|x' });
  const b = rec({ table: '表B', name: '赵立', email: 'z@a.com', company: '云帆\n文化' });
  const md = C.conflictsToMarkdown(C.cluster([a, b]).clusters);
  assert.ok(md.includes('## 记录组 1(2 条记录)'));
  assert.ok(md.includes("'=cmd\\|x"), md);
  assert.ok(md.includes('云帆 文化'));
  assert.ok(md.includes('表\\|A 第'));
  assert.match(C.conflictsToMarkdown(C.cluster([rec({ name: '独个' })]).clusters), /没有发现冲突字段/);
  assert.match(C.conflictsToMarkdown([]), /没有发现冲突字段/);
});

test('空输入与单表不报错', () => {
  assert.deepEqual(C.cluster([]).clusters, []);
  assert.deepEqual(C.cluster(undefined).suspects, []);
  const one = C.cluster([rec({ name: '独个', email: 'a@a.com' })]);
  assert.equal(one.clusters.length, 1);
  assert.equal(one.clusters[0].size, 1);
  assert.deepEqual(C.mergedRows([], []).length, 1);
});

test('按名分组不受 __proto__ / constructor 影响', () => {
  const a = rec({ name: '甲', extras: [{ k: '__proto__', v: 'x' }, { k: 'constructor', v: '1' }], email: 'p@a.com' });
  const b = rec({ name: '甲', extras: [{ k: '__proto__', v: 'y' }, { k: 'constructor', v: '1' }], email: 'p@a.com' });
  const { clusters } = C.cluster([a, b]);
  assert.deepEqual(clusters[0].conflicts, ['x:__proto__']);
  const m = C.merge(clusters[0]);
  assert.deepEqual(m.extras.map(e => e.k), ['__proto__', 'constructor']);
  assert.equal(m.extras[0].v, 'x / y');
  assert.equal(({}).x, undefined);
});

test('合成示例:3 张表共 40 条,簇结构与设计一致', () => {
  assert.equal(SAMPLE.tables.length, 3);
  let recs = [];
  SAMPLE.tables.forEach((t, i) => {
    const p = C.parseTable(t.text);
    assert.equal(p.ok, true, t.name);
    recs = recs.concat(C.buildRecords({ id: 't' + i, name: t.name, headers: p.headers, rows: p.rows, mapping: C.guessMapping(p.headers) }, i));
  });
  assert.equal(recs.length, 40);
  const r = C.cluster(recs);
  const multi = r.clusters.filter(c => c.size > 1);
  assert.equal(multi.length, 8);
  assert.equal(multi.filter(c => c.size === 3).length, 4);
  const zhao = multi.find(c => c.members.some(m => m.name === '赵立'));
  assert.deepEqual(zhao.conflicts, ['phone', 'company']);
  assert.equal(r.suspects.length, 2);
  assert.ok(r.suspects.some(s => s.recordA.name === '陈思远' && s.recordB.name === '陈思源'));
  assert.equal(r.clusters.length, 40 - (3 - 1) * 4 - (2 - 1) * 4);
  // 示例里没有真实域名与真实手机号段以外的数据
  for (const t of SAMPLE.tables) assert.ok(!/@(?!example\.com)/i.test(t.text), t.name);
});

test('疑似:增字、删字(张三 / 张小三)、英文增字都能找到,差两个字不算', () => {
  const ins = C.cluster([rec({ name: '张三' }), rec({ name: '张小三' })]);
  assert.equal(ins.suspects.length, 1);
  assert.equal(ins.suspects[0].distance, 1);
  assert.equal(C.cluster([rec({ name: '张小三' }), rec({ name: '张三' })]).suspects.length, 1);
  assert.equal(C.cluster([rec({ name: 'Anna' }), rec({ name: 'Annal' })]).suspects.length, 1);
  assert.equal(C.cluster([rec({ name: '张三' }), rec({ name: '张小大三' })]).suspects.length, 0);
});

test('其他字段区分大小写:AbC 与 abc 视为冲突并都保留', () => {
  const a = rec({ name: '甲', email: 'p@a.com', extras: [{ k: '编码', v: 'AbC' }] });
  const b = rec({ name: '甲', email: 'p@a.com', extras: [{ k: '编码', v: 'abc' }] });
  const { clusters } = C.cluster([a, b]);
  assert.deepEqual(clusters[0].conflicts, ['x:编码']);
  assert.equal(C.merge(clusters[0]).extras[0].v, 'AbC / abc');
  assert.equal(C.conflictDetails(clusters[0])[0].values.length, 2);
  // 完全相同的值不算冲突
  const c = rec({ name: '甲', email: 'p@a.com', extras: [{ k: '编码', v: 'AbC' }] });
  assert.deepEqual(C.cluster([a, c]).clusters[0].conflicts, []);
});

test('isValidDate:拒绝不存在的日期与自动进位', () => {
  assert.equal(C.isValidDate('2026-10-20'), true);
  assert.equal(C.isValidDate('2024-02-29'), true);
  assert.equal(C.isValidDate('2026-02-30'), false);
  assert.equal(C.isValidDate('2026-02-29'), false);
  assert.equal(C.isValidDate('2026-13-01'), false);
  assert.equal(C.isValidDate('2026-1-1'), false);
  assert.equal(C.isValidDate(null), false);
});

test('[第五轮] 记录组带归组依据:每条连接写明规则、两端来源表与行号、标准化后的值', () => {
  const a = rec({ table: '报名表', row: 2, name: '甲', phone: '+86 138-0000-0001' });
  const b = rec({ table: '群导出', row: 8, name: '乙', phone: '13800000001', email: 'X@a.com' });
  const c = rec({ table: '旧CRM', row: 5, name: '丙', email: 'x@A.com' });
  const d = rec({ table: '旧CRM', row: 9, name: '丁' });
  const { clusters } = C.cluster([a, b, c, d]);
  const g = clusters.find(x => x.size === 3);
  assert.equal(g.links.length, 2);
  const ph = g.links.find(l => l.rule === 'phone');
  assert.equal(ph.value, '13800000001');
  assert.equal(ph.text, '报名表 第2行 与 群导出 第8行:手机标准化后相同(13800000001)');
  const em = g.links.find(l => l.rule === 'email');
  assert.equal(em.text, '群导出 第8行 与 旧CRM 第5行:邮箱标准化后相同(x@a.com)');
  assert.deepEqual(clusters.find(x => x.size === 1).links, []);
});

test('[第五轮] 归组依据:姓名加公司、微信号、人工确认的疑似并入都写出规则', () => {
  const a = rec({ table: 'A', row: 1, name: '李 娜', company: '明远教育有限公司' });
  const b = rec({ table: 'B', row: 4, name: '李娜', company: '明远教育' });
  const nc = C.cluster([a, b]).clusters[0];
  assert.equal(nc.links.length, 1);
  assert.equal(nc.links[0].rule, 'nameCompany');
  assert.ok(nc.links[0].text.includes('姓名与公司标准化后相同'), nc.links[0].text);
  const w1 = rec({ table: 'A', row: 1, name: '甲', wechat: 'Wx_1' });
  const w2 = rec({ table: 'B', row: 2, name: '乙', wechat: 'wx_1' });
  assert.equal(C.cluster([w1, w2]).clusters[0].links[0].rule, 'wechat');
  const s1 = rec({ table: 'A', row: 3, name: '陈思远', phone: '13800000009' });
  const s2 = rec({ table: 'B', row: 6, name: '陈思源', email: 'c@a.com' });
  const pending = C.cluster([s1, s2]);
  assert.equal(pending.suspects.length, 1);
  assert.equal(pending.clusters.every(c => c.links.length === 0), true);
  const done = C.cluster([s1, s2], undefined, [pending.suspects[0].key]);
  const link = done.clusters[0].links[0];
  assert.equal(link.rule, 'suspect');
  assert.ok(link.text.includes('人工确认') && link.text.includes('相差 1 个字'), link.text);
});

test('[第五轮] 关闭规则后不再产生对应归组依据', () => {
  const a = rec({ name: '甲', email: 'e@a.com' });
  const b = rec({ name: '乙', email: 'e@a.com' });
  const off = C.cluster([a, b], { email: false });
  assert.equal(off.clusters.length, 2);
  assert.ok(off.clusters.every(c => c.links.length === 0));
});

test('[第五轮] 示例数据下导出文件标注「合成示例」:合并 CSV 与原始 CSV 加数据来源列,Markdown 写明', () => {
  const a = rec({ name: '赵立', email: 'z@a.com', company: 'A' });
  const b = rec({ name: '赵立', email: 'z@a.com', company: 'B' });
  const { clusters } = C.cluster([a, b]);
  const m = C.mergedRows(clusters, [], { sample: true });
  assert.equal(m[0][m[0].length - 1], '数据来源');
  assert.equal(m[1][m[1].length - 1], '合成示例');
  const o = C.originalRows(clusters, { sample: true });
  assert.equal(o[0][o[0].length - 1], '数据来源');
  assert.equal(o[2][o[2].length - 1], '合成示例');
  assert.ok(C.conflictsToMarkdown(clusters, { sample: true }).includes('数据来源:合成示例'));
  assert.ok(!C.mergedRows(clusters, [])[0].includes('数据来源'));
  assert.ok(!C.originalRows(clusters)[0].includes('数据来源'));
  assert.ok(!C.conflictsToMarkdown(clusters).includes('合成示例'));
  assert.ok(C.conflictsToMarkdown([], { sample: true }).includes('数据来源:合成示例'));
});

test('[第五轮] exportCounts:导出行数与记录组数口径(不受显示筛选影响)', () => {
  const a = rec({ name: '甲', email: 'e@a.com', phone: '13800000001' });
  const b = rec({ name: '甲', email: 'e@a.com', phone: '13800000002' });
  const c = rec({ name: '丙', phone: '13900000000' });
  const { clusters } = C.cluster([a, b, c]);
  assert.deepEqual(C.exportCounts(clusters), { groups: 2, records: 3, conflictGroups: 1, mergedRows: 2, originalRows: 3 });
  assert.deepEqual(C.exportCounts([]), { groups: 0, records: 0, conflictGroups: 0, mergedRows: 0, originalRows: 0 });
});
