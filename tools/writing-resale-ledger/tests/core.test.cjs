'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');
const S = require('../sample-data.js');

const R = (o) => Object.assign({ id: 'r' + Math.random(), date: '2026-10-01', channel: '公众号', form: '原发', extraHours: 0, reach: null, revenueCents: null, saleRef: '' }, o);
const W = (o) => Object.assign({ id: 'w' + Math.random(), title: 'T', type: '文章', createdOn: '2026-10-01', hours: 2, resales: [] }, o);
const CH = C.DEFAULT_CHANNELS;

test('resaleCount 数记录条数', () => {
  assert.equal(C.resaleCount(W({})), 0);
  assert.equal(C.resaleCount(W({ resales: [R({ id: 'a' }), R({ id: 'b' })] })), 2);
});

test('hoursTotal 含额外耗时', () => {
  const w = W({ hours: 3, resales: [R({ id: 'a', extraHours: 1.5 }), R({ id: 'b', extraHours: 0.5 })] });
  assert.equal(C.hoursTotal(w), 5);
});

test('perHour = 次数 ÷ (首次 + 额外)', () => {
  const w = W({ hours: 3, resales: [R({ id: 'a', extraHours: 1 }), R({ id: 'b' })] });
  assert.equal(C.perHour(w), 2 / 4);
});

test('perHour 耗时为 0 返回 null,不是 Infinity/NaN', () => {
  assert.equal(C.perHour(W({ hours: 0, resales: [R({ id: 'a' })] })), null);
  assert.equal(C.perHour(W({ hours: 0 })), null);
});

test('无收入记录时每小时收入为 null;有收入才算,整数分', () => {
  const none = W({ hours: 2, resales: [R({ id: 'a' })] });
  assert.equal(C.revenueCents(none), null);
  assert.equal(C.revenuePerHour(none), null);
  const some = W({ hours: 3, resales: [R({ id: 'a', revenueCents: 1000 }), R({ id: 'b', revenueCents: 1 })] });
  assert.equal(C.revenueCents(some), 1001);
  assert.equal(C.revenuePerHour(some), Math.round(1001 / 3));
  assert.ok(Number.isInteger(C.revenuePerHour(some)));
  // 收入记 0 分是「有记录」,与「没填」不同
  assert.equal(C.revenuePerHour(W({ hours: 2, resales: [R({ id: 'a', revenueCents: 0 })] })), 0);
  assert.equal(C.revenuePerHour(W({ hours: 0, resales: [R({ id: 'a', revenueCents: 500 })] })), null);
});

test('heatmap 月序升序、跨年、范围外记录不计', () => {
  const months = C.monthRange('2027-02', 4);
  assert.deepEqual(months, ['2026-11', '2026-12', '2027-01', '2027-02']);
  const w = W({ resales: [R({ id: 'a', date: '2026-12-31' }), R({ id: 'b', date: '2026-12-01' }), R({ id: 'c', date: '2027-02-10' }), R({ id: 'd', date: '2026-01-01' })] });
  const h = C.heatmap([w], months);
  assert.deepEqual(h.rows[0].cells, [0, 2, 0, 1]);
  assert.equal(h.max, 2);
  assert.deepEqual(h.totals, [0, 2, 0, 1]);
});

test('scatter 每部作品一个点,含零次作品;x=累计耗时,y=次数,reach=触达合计', () => {
  const ws = [W({ id: 'x', hours: 2, resales: [R({ id: 'a', extraHours: 1, reach: 100 }), R({ id: 'b', reach: 50 })] }), W({ id: 'y', hours: 5 })];
  const pts = C.scatter(ws);
  assert.equal(pts.length, 2);
  assert.deepEqual([pts[0].hours, pts[0].count, pts[0].reach], [3, 2, 150]);
  assert.deepEqual([pts[1].hours, pts[1].count, pts[1].reach], [5, 0, 0]);
});

test('channelStats 按次数降序,占比之和为 1,__proto__ 渠道不污染', () => {
  const ch = ['公众号', 'X', '__proto__'];
  const w = W({ resales: [R({ id: 'a', channel: 'X', reach: 10 }), R({ id: 'b', channel: 'X', revenueCents: 300 }), R({ id: 'c', channel: '公众号' }), R({ id: 'd', channel: '__proto__' })] });
  assert.equal(C.validateState({ channels: ch, works: [w] }).ok, true);
  const st = C.channelStats([w]);
  assert.equal(st[0].channel, 'X');
  assert.equal(st[0].count, 2);
  assert.equal(st[0].reach, 10);
  assert.equal(st[0].revenueCents, 300);
  assert.equal(st.find(e => e.channel === '公众号').revenueCents, null);
  assert.ok(Math.abs(st.reduce((a, e) => a + e.share, 0) - 1) < 1e-9);
  assert.equal(st.length, 3);
  assert.equal({}.polluted, undefined);
});

test('规则 1:创作超过 90 天且仅售 1 次 → 可改写候选,按类型给固定文案', () => {
  const old = W({ id: 'old', type: '书', createdOn: '2026-07-01', resales: [R({ id: 'a' })] });
  const edge = W({ id: 'edge', createdOn: '2026-07-22', resales: [R({ id: 'b' })] }); // 恰好 90 天,不算
  const edge91 = W({ id: 'edge91', createdOn: '2026-07-21', resales: [R({ id: 'c' })] });
  const twice = W({ id: 'twice', createdOn: '2026-01-01', resales: [R({ id: 'd', date: '2026-01-02' }), R({ id: 'e', date: '2026-02-02' })] });
  const hs = C.hints([old, edge, edge91, twice], '2026-10-20').filter(h => h.kind === 'rewrite');
  assert.deepEqual(hs.map(h => h.workId), ['old', 'edge91']);
  assert.ok(hs[0].text.includes(C.REWRITE_ADVICE['书']));
  assert.equal(C.daysBetween('2026-07-22', '2026-10-20'), 90);
});

test('规则 2:无引用仅完整指纹相同才提示;同渠道同月不同字段不提示', () => {
  const dup = W({ id: 'd', resales: [R({ id: 'a', date: '2026-09-01' }), R({ id: 'b', date: '2026-09-01' })] });
  const ok = W({ id: 'o', resales: [R({ id: 'c', date: '2026-09-01' }), R({ id: 'e', date: '2026-10-01' }), R({ id: 'f', date: '2026-09-02', channel: 'X' })] });
  const hs = C.hints([dup, ok], '2026-10-20').filter(h => h.kind === 'duplicate');
  assert.equal(hs.length, 1);
  assert.deepEqual([hs[0].workId, hs[0].channel, hs[0].date, hs[0].n], ['d', '公众号', '2026-09-01', 2]);
});

test('交易引用:首尾空格去除、大小写不敏感;唯一范围是同一作品同一渠道', () => {
  assert.equal(C.normalizeSaleRef('  Ord-1  '), 'Ord-1');
  const collision = { channels: CH, works: [W({ id: 'w1', resales: [R({ id: 'a', saleRef: ' Ord-1 ' }), R({ id: 'b', saleRef: 'ord-1', date: '2026-11-01' })] })] };
  assert.equal(C.validateState(collision).ok, false);
  const scoped = { channels: CH, works: [W({ id: 'w1', resales: [R({ id: 'a', saleRef: 'X' }), R({ id: 'b', saleRef: 'X', channel: 'X' })] }), W({ id: 'w2', resales: [R({ id: 'c', saleRef: 'X' })] })] };
  assert.equal(C.validateState(scoped).ok, true);
});

test('交易引用仅接受可打印 ASCII;拒绝 Unicode、组合重音和控制字符', () => {
  for (const saleRef of ['Straße', 'É-1', 'E\u0301-1', 'A\u0000B', 'A\nB', 'A\tB']) {
    const v = C.validateState({ channels: CH, works: [W({ id: 'w', resales: [R({ id: 'r', saleRef })] })] });
    assert.equal(v.ok, false, JSON.stringify(saleRef));
    assert.match(v.error, /可打印 ASCII/);
  }
  assert.equal(C.validateState({ channels: CH, works: [W({ id: 'w', resales: [R({ id: 'r', saleRef: 'ORD_2026-01 / A' })] })] }).ok, true);
});

test('交易引用不同则同作品同渠道同月不提示;空引用指纹区分未知收入、0 元和不同月份', () => {
  const w = W({ resales: [R({ id: 'a', saleRef: 'A' }), R({ id: 'b', saleRef: 'B' }), R({ id: 'c', date: '2026-09-01' }), R({ id: 'd', date: '2026-09-01', revenueCents: 0 }), R({ id: 'e', date: '2026-10-01' })] });
  assert.equal(C.hints([w], '2026-10-20').filter(h => h.kind === 'duplicate').length, 0);
});

test('规则 3:额外耗时 > 首次耗时 → 这不是复售是重做;等于不提示', () => {
  const w = W({ id: 'w', hours: 3, resales: [R({ id: 'a', extraHours: 3, date: '2026-09-01' }), R({ id: 'b', extraHours: 3.5, date: '2026-10-01' })] });
  const hs = C.hints([w], '2026-10-20').filter(h => h.kind === 'redo');
  assert.equal(hs.length, 1);
  assert.equal(hs[0].resaleId, 'b');
  assert.ok(hs[0].text.includes('这不是复售'));
});

test('示例数据:7 部、31 条,三条规则各 1 例,且通过校验', () => {
  assert.equal(S.works.length, 7);
  assert.equal(S.works.reduce((a, w) => a + w.resales.length, 0), 31);
  const count = t => S.works.filter(w => w.type === t).length;
  assert.deepEqual([count('文章'), count('课'), count('书'), count('代码库')], [4, 1, 1, 1]);
  const hs = C.hints(S.works, '2026-10-20');
  for (const k of ['rewrite', 'duplicate', 'redo']) assert.equal(hs.filter(h => h.kind === k).length, 1, k);
  assert.equal(C.validateState({ channels: S.channels, works: S.works }).ok, true);
});

test('monthly 与 compare:月内耗时 = 当月新作首次耗时 + 当月再售额外耗时', () => {
  const a = W({ id: 'a', createdOn: '2026-10-02', hours: 4, resales: [R({ id: 'a1', date: '2026-10-03', extraHours: 1 }), R({ id: 'a2', date: '2026-10-09', extraHours: 0 })] });
  const b = W({ id: 'b', createdOn: '2026-08-01', hours: 9, resales: [R({ id: 'b1', date: '2026-09-05', extraHours: 2 }), R({ id: 'b2', date: '2026-10-20', extraHours: 0 })] });
  const oct = C.monthly([a, b], '2026-10'), sep = C.monthly([a, b], '2026-09');
  assert.deepEqual([oct.newWorks, oct.resales, oct.hours, oct.perHour], [1, 3, 5, 3 / 5]);
  assert.deepEqual([sep.newWorks, sep.resales, sep.hours, sep.perHour], [0, 1, 2, 1 / 2]);
  const cmp = C.compare(oct, sep);
  assert.equal(cmp.resales.delta, 2);
  assert.equal(cmp.newWorks.delta, 1);
  assert.ok(Math.abs(cmp.perHour.delta - 0.1) < 1e-9);
  // 上月没有耗时 → 不编造对比
  const aug = C.monthly([], '2026-08');
  assert.equal(aug.perHour, null);
  assert.equal(C.compare(oct, aug).perHour.delta, null);
  assert.equal(C.shiftMonth('2026-01', -1), '2025-12');
});

test('?today:合法采用;非法/自动进位/缺失回退真实今天且不抛错', () => {
  const now = new Date(2030, 4, 7);
  assert.equal(C.resolveToday('?today=2026-10-20', now), '2026-10-20');
  assert.equal(C.resolveToday('?today=2026-02-30', now), '2030-05-07');
  assert.equal(C.resolveToday('?today=2026-13-01', now), '2030-05-07');
  assert.equal(C.resolveToday('?today=abc', now), '2030-05-07');
  assert.equal(C.resolveToday('', now), '2030-05-07');
  assert.equal(C.resolveToday(undefined, now), '2030-05-07');
  assert.equal(C.resolveToday('?today=2024-02-29', now), '2024-02-29');
});

test('CSV 公式防护:= + - @ 开头加单引号;单独的 - + 不加;逗号引号正确转义', () => {
  const ws = [W({ title: '=HYPERLINK("x")' }), W({ title: '+1' }), W({ title: '-' }), W({ title: '+' }), W({ title: '@a' }), W({ title: '-5,a' }), W({ title: '普通,"题"' })];
  const rows = C.toCsv(ws).trimEnd().split('\r\n');
  assert.ok(rows[1].startsWith('"\'=HYPERLINK(""x"")"'));
  assert.ok(rows[2].startsWith("'+1,"));
  assert.ok(rows[3].startsWith('-,'));
  assert.ok(rows[4].startsWith('+,'));
  assert.ok(rows[5].startsWith("'@a,"));
  assert.ok(rows[6].startsWith('"\'-5,a"'));
  assert.ok(rows[7].startsWith('"普通,""题"""'));
});

test('CSV 无收入留空,不编造每小时收入;有收入单位为元两位小数', () => {
  const none = W({ title: 'n', hours: 2, resales: [R({ id: 'a' })] });
  const some = W({ title: 's', hours: 2, resales: [R({ id: 'b', revenueCents: 1050 })] });
  const [, r1, r2] = C.toCsv([none, some]).trimEnd().split('\r\n');
  assert.deepEqual(r1.split(',').slice(7, 9), ['', '']);
  assert.deepEqual(r2.split(',').slice(7, 9), ['10.50', '5.25']);
});

test('Markdown 月报:表格单元转义 | 与公式前缀,含对比与提示', () => {
  const w = W({ title: '=A|B', createdOn: '2026-10-02', hours: 2, resales: [R({ id: 'a', date: '2026-10-03' })] });
  const md = C.toMarkdown([w], '2026-10', '2026-10-20');
  assert.ok(md.includes("'=A\\|B"));
  assert.ok(md.includes('| 新作品数 | 1 | 0 | +1 |'));
  assert.ok(md.includes('不证明有人付费'));
  assert.ok(md.includes('无收入记录'));
});

test('枚举与取值校验:类型/渠道/形式/小时/金额/日期/ID 重复/URL 外字段', () => {
  const base = () => ({ channels: CH.slice(), works: [W({ id: 'w1', resales: [R({ id: 'r1' })] })] });
  assert.equal(C.validateState(base()).ok, true);
  const bad = (mut) => { const s = base(); mut(s); const v = C.validateState(s); assert.equal(v.ok, false); return v.error; };
  bad(s => { s.works[0].type = '播客'; });
  bad(s => { s.works[0].resales[0].channel = '微博'; });
  bad(s => { s.works[0].resales[0].form = '转载'; });
  bad(s => { s.works[0].hours = -1; });
  bad(s => { s.works[0].hours = '2'; });
  bad(s => { s.works[0].resales[0].extraHours = -0.5; });
  bad(s => { s.works[0].resales[0].revenueCents = 12.5; });
  bad(s => { s.works[0].resales[0].revenueCents = -1; });
  bad(s => { s.works[0].resales[0].reach = 1.5; });
  bad(s => { s.works[0].createdOn = '2026-02-30'; });
  bad(s => { s.works[0].title = '   '; });
  bad(s => { s.works.push(W({ id: 'w1' })); });
  bad(s => { s.works[0].resales.push(R({ id: 'w1' })); });
  bad(s => { s.channels.push('X'); });
  bad(s => { s.works[0].hours = NaN; });
  bad(s => { s.works = {}; });
  // 一条坏记录 → 整份拒绝,不是跳过
  const mixed = base(); mixed.works.push(W({ id: 'w2', type: '坏' }));
  assert.equal(C.validateState(mixed).ok, false);
});

test('写读校验同源:validateState 通过的数据 → 备份 → validateImport 读回完全一致', () => {
  const state = { channels: S.channels, works: S.works };
  const w = C.validateState(state);
  assert.equal(w.ok, true);
  const back = C.validateImport(C.toBackup(w.state));
  assert.equal(back.ok, true);
  assert.deepEqual(back.state, w.state);
  // 边界值:最大标题、最大小时、最大金额、0 值
  const edge = { channels: ['a'], works: [W({ id: 'e', title: '长'.repeat(5000), hours: 1e9, resales: [R({ id: 'x', channel: 'a', extraHours: 0, reach: 1e12, revenueCents: 1e12 })] })] };
  const ev = C.validateState(edge);
  assert.equal(ev.ok, true);
  assert.deepEqual(C.validateImport(C.toBackup(ev.state)).state, ev.state);
});

test('validateImport 拒绝非备份、坏 JSON、版本不符', () => {
  assert.equal(C.validateImport('{').ok, false);
  assert.equal(C.validateImport('[]').ok, false);
  assert.equal(C.validateImport({ app: 'other', version: 1, channels: CH, works: [] }).ok, false);
  assert.equal(C.validateImport({ app: 'resale-ledger', version: 2, channels: CH, works: [] }).ok, false);
  assert.equal(C.validateImport({ app: 'resale-ledger', version: 1, channels: CH, works: [] }).ok, true);
});

test('表单解析:小时、触达、收入(元→整数分,无浮点误差)', () => {
  assert.deepEqual(C.parseHours('1.5'), { ok: true, value: 1.5 });
  assert.equal(C.parseHours('-1').ok, false);
  assert.equal(C.parseHours('').ok, false);
  assert.equal(C.parseHours('100001').ok, true);
  assert.equal(C.parseHours('1e400').ok, false);
  assert.equal(C.parseHours('9'.repeat(400)).ok, false);
  assert.deepEqual(C.parseReach(''), { ok: true, value: null });
  assert.equal(C.parseReach('1.5').ok, false);
  assert.equal(C.parseYuan('19.9').value, 1990);
  assert.equal(C.parseYuan('0.07').value, 7);
  assert.equal(C.parseYuan('1.005').ok, false);
  assert.equal(C.parseYuan('-3').ok, false);
  assert.equal(C.parseYuan('').value, null);
  assert.equal(C.fmtCents(5), '0.05');
  assert.equal(C.fmtCents(123456), '1234.56');
});

test('无业务上限:超长标题、超过 30 个渠道、小时超过 10 万都通过写读同源校验', () => {
  const channels = Array.from({ length: 45 }, (_, i) => '渠道' + i);
  const w = W({ id: 'big', title: 'T'.repeat(1000), hours: 250000, resales: [R({ id: 'x', channel: '渠道44', extraHours: 123456 })] });
  const v = C.validateState({ channels, works: [w] });
  assert.equal(v.ok, true);
  const back = C.validateImport(C.toBackup(v.state));
  assert.equal(back.ok, true);
  assert.deepEqual(back.state, v.state);
  // 数值有效性仍然拒绝
  assert.equal(C.validateState({ channels, works: [W({ id: 'b', hours: Infinity })] }).ok, false);
  assert.equal(C.validateState({ channels, works: [W({ id: 'b2', resales: [R({ id: 'q', channel: '渠道1', reach: 2 ** 60 })] })] }).ok, false);
  assert.equal(C.validateState({ channels: [], works: [] }).ok, false);
});

test('isPristine:只有「无作品且渠道为默认列表」才算初始;自定义渠道也要确认覆盖', () => {
  assert.equal(C.isPristine({ channels: C.DEFAULT_CHANNELS.slice(), works: [] }), true);
  assert.equal(C.isPristine({ channels: [...C.DEFAULT_CHANNELS, '微博'], works: [] }), false);
  assert.equal(C.isPristine({ channels: C.DEFAULT_CHANNELS.slice().reverse(), works: [] }), false);
  assert.equal(C.isPristine({ channels: C.DEFAULT_CHANNELS.slice(), works: [W({})] }), false);
});

test('revenueLabel:「无收入」与「耗时为 0 无法计算」文案不同;Markdown 同步', () => {
  const none = W({ title: 'none', hours: 2, resales: [R({ id: 'a' })] });
  const zero = W({ title: 'zero', hours: 0, resales: [R({ id: 'b', revenueCents: 500 })] });
  const ok = W({ title: 'ok', hours: 2, resales: [R({ id: 'c', revenueCents: 500 })] });
  const noneZero = W({ title: 'nz', hours: 0, resales: [R({ id: 'd' })] });
  assert.equal(C.revenueLabel(none), '无收入记录');
  assert.equal(C.revenueLabel(noneZero), '无收入记录');
  assert.equal(C.revenueLabel(zero), '耗时为 0,无法计算');
  assert.equal(C.revenueLabel(ok), '2.50');
  const md = C.toMarkdown([none, zero, ok], '2026-10', '2026-10-20');
  assert.ok(md.includes('| none | 文章 | 1 | 2 | 0.5 | 无收入记录 |'));
  assert.ok(md.includes('耗时为 0,无法计算 |'));
  assert.ok(md.includes('| 2.50 |'));
});

test('updateWork:修改作品字段时保留 id 与全部再售记录,非法修改整次拒绝且原状态不变', () => {
  const st = C.validateState(JSON.parse(JSON.stringify({ channels: S.channels, works: S.works }))).state;
  const w0 = st.works[0];
  const r = C.updateWork(st, w0.id, { title: '改过的标题', type: '书', createdOn: '2026-01-02', hours: 9.5 });
  assert.equal(r.ok, true);
  const w1 = r.state.works[0];
  assert.equal(w1.id, w0.id);
  assert.equal(w1.title, '改过的标题');
  assert.equal(w1.hours, 9.5);
  assert.equal(w1.resales.length, w0.resales.length);
  assert.deepEqual(w1.resales.map(x => x.id), w0.resales.map(x => x.id));
  assert.equal(w0.title === '改过的标题', false); // 不改原对象
  for (const bad of [{ title: '  ' }, { type: '漫画' }, { createdOn: '2026-02-30' }, { hours: -1 }, { hours: NaN }]) {
    const e = C.updateWork(st, w0.id, bad);
    assert.equal(e.ok, false, JSON.stringify(bad));
    assert.ok(e.error);
  }
  assert.equal(C.updateWork(st, 'nope', { title: 'x' }).ok, false);
});

test('updateResale:修改一条再售记录时保留 id 与其他记录,渠道和形式按枚举校验', () => {
  const st = C.validateState(JSON.parse(JSON.stringify({ channels: S.channels, works: S.works }))).state;
  const w = st.works[0], rid = w.resales[0].id;
  const r = C.updateResale(st, w.id, rid, { date: '2026-01-05', channel: st.channels[1], form: '改写', extraHours: 1.5, reach: 10, revenueCents: null });
  assert.equal(r.ok, true);
  const rr = r.state.works[0].resales.find(x => x.id === rid);
  assert.equal(rr.extraHours, 1.5);
  assert.equal(rr.form, '改写');
  assert.equal(r.state.works[0].resales.length, w.resales.length);
  assert.equal(C.updateResale(st, w.id, rid, { channel: '不存在的渠道' }).ok, false);
  assert.equal(C.updateResale(st, w.id, rid, { form: '乱写' }).ok, false);
  assert.equal(C.updateResale(st, w.id, rid, { revenueCents: 1.5 }).ok, false);
  assert.equal(C.updateResale(st, w.id, 'nope', { form: '改写' }).ok, false);
});

test('updateResale:未显式修改时保留交易引用;引用冲突整次拒绝且不覆盖原记录', () => {
  const st = C.validateState({ channels: CH, works: [W({ id: 'w', resales: [R({ id: 'a', saleRef: 'A-1' }), R({ id: 'b', saleRef: 'B-1', date: '2026-11-01' })] })] }).state;
  const kept = C.updateResale(st, 'w', 'a', { reach: 9 });
  assert.equal(kept.ok, true);
  assert.equal(kept.state.works[0].resales[0].saleRef, 'A-1');
  const conflict = C.updateResale(st, 'w', 'a', { saleRef: ' b-1 ', date: '2026-12-01' });
  assert.equal(conflict.ok, false);
  assert.equal(st.works[0].resales[0].saleRef, 'A-1');
  assert.equal(st.works[0].resales[0].date, '2026-10-01');
});

test('sample 标记:必须是布尔值,往返保留;CSV 与 Markdown 对示例标注', () => {
  const base = { channels: S.channels, works: S.works };
  assert.equal(C.validateState(Object.assign({}, base, { sample: 'x' })).ok, false);
  assert.equal(C.validateState(base).state.sample, false);
  const s = C.validateState(Object.assign({}, base, { sample: true })).state;
  assert.equal(s.sample, true);
  assert.equal(JSON.parse(C.toBackup(s)).sample, true);
  assert.equal(C.validateImport(C.toBackup(s)).state.sample, true);
  const csv = C.toCsv(s.works, { sample: true }).trim().split('\r\n');
  assert.match(csv[0], /数据性质$/);
  assert.ok(csv.slice(1).every(l => l.endsWith('合成示例')));
  assert.ok(!C.toCsv(s.works).includes('合成示例'));
  assert.match(C.toMarkdown(s.works, '2026-10', '2026-10-20', { sample: true }), /合成示例,金额虚构/);
  assert.ok(!C.toMarkdown(s.works, '2026-10', '2026-10-20').includes('合成示例'));
});
