'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const T = '2026-10-20';
test('联系更正拒绝重复 ID、分支、循环和畸形事件，拒绝时原对象保持不变', () => {
  const fields = (id) => ({ id, date: T, type: 'detailed', channel: '微信', summary: '说明', outcome: '待回复', nextStep: '', provenance: 'user' });
  let item = lead();
  item = C.addContactEvent(item, fields('a'));
  item = C.addContactEvent(item, fields('b'));
  const before = JSON.stringify(item);
  assert.throws(() => C.correctContactEvent(item, 'a', fields('b')), /id 重复/);
  assert.throws(() => C.addContactEvent(item, { ...fields('c'), supersedes: 'a' }), /更正操作/);
  assert.equal(JSON.stringify(item), before);
  const valid = C.correctContactEvent(item, 'a', fields('c'));
  assert.equal(C.validateImport(C.toBackup([valid], 7)).ok, true);
  const chain = C.correctContactEvent(valid, 'c', fields('d'));
  assert.equal(C.validateImport(C.toBackup([chain], 7)).ok, true);
  const badCases = [
    { ...valid, contactEvents: valid.contactEvents.concat([{ ...fields('d'), supersedes: 'a' }]) },
    { ...valid, contactEvents: [{ ...fields('a'), supersedes: 'b' }, { ...fields('b'), supersedes: 'a' }], archivedContactEventIds: ['a', 'b'] },
    { ...item, contactEvents: [null] },
    { ...item, contactEvents: 'wrong array' },
    { ...item, contactEvents: [1] }
  ];
  for (const candidate of badCases) {
    const snapshot = JSON.stringify(candidate);
    const checked = C.validateImport({ version: 3, n: 7, leads: [candidate] });
    assert.equal(checked.ok, false);
    assert.deepEqual(checked.leads, []);
    assert.equal(JSON.stringify(candidate), snapshot);
  }
});
function lead(over) {
  return C.newLead(Object.assign({ name: '测试', channel: '社群', firstContact: '2026-10-01' }, over || {}), T, 'id-' + Math.random());
}
/* 构造带历史的线索 */
function withHistory(stage, hist, over) {
  return Object.assign(lead({ stage: stage }), { stageHistory: hist.map(function (h) { return { stage: h[0], date: h[1] }; }) }, over || {});
}

test('advance 只写 stageHistory，不伪造联系事件，且不改原对象', () => {
  const a = lead();
  const b = C.advance(a, '已约试课', '2026-10-05');
  assert.equal(b.stage, '已约试课');
  assert.equal(b.lastContact, '2026-10-01');
  assert.deepEqual(b.contactEvents, []);
  assert.deepEqual(b.stageHistory.map((h) => h.stage), ['咨询中', '已约试课']);
  assert.equal(a.stage, '咨询中');
  assert.equal(a.stageHistory.length, 1);
});

test('advance 不能回退,allowBack 显式允许', () => {
  const a = C.advance(lead(), '已试课', '2026-10-06');
  assert.throws(() => C.advance(a, '咨询中', '2026-10-07'), /回退/);
  const b = C.advance(a, '咨询中', '2026-10-07', undefined, { allowBack: true });
  assert.equal(b.stage, '咨询中');
  assert.equal(b.stageHistory.length, 3);
});

test('advance 到相同阶段、未知阶段或坏日期抛错', () => {
  assert.throws(() => C.advance(lead(), '咨询中', T), /已在/);
  assert.throws(() => C.advance(lead(), '火星', T), /未知阶段/);
  assert.throws(() => C.advance(lead(), '已约试课', '2026-13-40'), /日期/);
});

test('流失必须带有效原因,恢复需要 allowBack', () => {
  assert.throws(() => C.advance(lead(), '流失', T), /原因/);
  assert.throws(() => C.advance(lead(), '流失', T, '随便'), /原因/);
  const lost = C.advance(lead(), '流失', T, '价格');
  assert.equal(lost.stage, '流失');
  assert.equal(lost.lossReason, '价格');
  assert.throws(() => C.advance(lost, '咨询中', T), /回退/);
  const back = C.advance(lost, '咨询中', T, undefined, { allowBack: true });
  assert.equal(back.lossReason, '');
});

test('超期:距最近联系超过 N 天(恰好 N 天不算)', () => {
  const edge = lead({ lastContact: '2026-10-17' }); // 3 天
  const over = lead({ lastContact: '2026-10-16' }); // 4 天
  const r = C.overdue([edge, over], T, 3);
  assert.equal(r.length, 1);
  assert.equal(r[0].lead, over);
  assert.equal(r[0].overdueDays, 1);
  assert.equal(C.overdue([edge], T, 2).length, 1, 'N 可调');
});

test('超期:下一步日期已过(当天不算),并按逾期天数降序', () => {
  const planned = lead({ lastContact: T, nextDate: '2026-10-15' }); // 逾期 5
  const today = lead({ lastContact: T, nextDate: T });
  const contact = lead({ lastContact: '2026-10-10' }); // 10 天,逾期 7
  const r = C.overdue([planned, today, contact], T, 3);
  assert.deepEqual(r.map((x) => x.lead), [contact, planned]);
  assert.deepEqual(r[1].reasons, ['planned']);
});

test('已付款、已开课、流失不算超期', () => {
  const old = { lastContact: '2026-09-01', nextDate: '2026-09-02' };
  const list = ['已付款', '已开课', '流失'].map((s) => lead(Object.assign({ stage: s, lossReason: '价格' }, old)));
  assert.equal(C.overdue(list, T, 3).length, 0);
  assert.equal(C.overdue([lead(Object.assign({ stage: '已报价' }, old))], T, 3).length, 1);
});

test('转化率按 stageHistory 而不是当前阶段', () => {
  // 当前已流失,但曾到达已试课
  const a = withHistory('流失', [['咨询中', '2026-10-01'], ['已试课', '2026-10-05'], ['流失', '2026-10-08']], { lossReason: '价格' });
  const b = withHistory('已开课', [['咨询中', '2026-10-01'], ['已试课', '2026-10-04'], ['已付款', '2026-10-06'], ['已开课', '2026-10-09']]);
  const c = withHistory('咨询中', [['咨询中', '2026-10-10']]);
  const d = withHistory('流失', [['咨询中', '2026-10-02'], ['流失', '2026-10-03']], { lossReason: '没回复' });
  const f = C.funnel([a, b, c, d]);
  assert.equal(f.reached['咨询中'], 4);
  assert.equal(f.reached['已试课'], 2);
  assert.equal(f.reached['已付款'], 1);
  assert.equal(f.consultToTrial, 0.5);
  assert.equal(f.trialToPaid, 0.5);
  assert.equal(f.overall, 0.25);
  assert.equal(f.counts['流失'], 2);
  assert.equal(f.counts['已试课'], 0, '当前阶段计数不等于曾到达');
});

test('跳级线索视为经过中间阶段', () => {
  const x = withHistory('已付款', [['已付款', '2026-10-05']]);
  const f = C.funnel([x]);
  assert.equal(f.reached['咨询中'], 1);
  assert.equal(f.reached['已试课'], 1);
  assert.equal(f.overall, 1);
});

test('空列表统计不除零', () => {
  const f = C.funnel([]);
  assert.equal(f.total, 0);
  assert.equal(f.consultToTrial, null);
  assert.equal(f.trialToPaid, null);
  assert.equal(f.overall, null);
  assert.deepEqual(C.byChannel([]), []);
  assert.deepEqual(C.lossReasons([]), []);
  assert.equal(C.weeklyReport([], T).newLeads.length, 0);
});

test('按渠道统计线索数与付款数', () => {
  const l1 = lead({ channel: '社群' });
  const l2 = withHistory('已付款', [['咨询中', '2026-10-01'], ['已付款', '2026-10-09']], { channel: '社群' });
  const l3 = lead({ channel: '网站' });
  const r = C.byChannel([l1, l2, l3]);
  assert.deepEqual(r[0], { channel: '社群', leads: 2, paid: 1 });
  assert.deepEqual(r[1], { channel: '网站', leads: 1, paid: 0 });
});

test('流失原因分布只统计流失线索并降序', () => {
  const mk = (r) => lead({ stage: '流失', lossReason: r });
  const r = C.lossReasons([mk('价格'), mk('没回复'), mk('价格'), lead()]);
  assert.deepEqual(r, [{ reason: '价格', count: 2 }, { reason: '没回复', count: 1 }]);
});

test('周报 7 天边界:第 7 天算、第 8 天不算', () => {
  const day7 = lead({ name: '第七天', firstContact: '2026-10-13' });
  const day8 = lead({ name: '第八天', firstContact: '2026-10-12' });
  const future = lead({ name: '未来', firstContact: '2026-10-21' });
  const r = C.weeklyReport([day7, day8, future], T);
  assert.deepEqual(r.newLeads.map((l) => l.name), ['第七天']);
  assert.equal(r.from, '2026-10-13');
  const trial = withHistory('已试课', [['咨询中', '2026-09-01'], ['已试课', '2026-10-13']], { name: '试课边界' });
  const trialOld = withHistory('已试课', [['咨询中', '2026-09-01'], ['已试课', '2026-10-12']], { name: '试课过期' });
  const paid = withHistory('已付款', [['咨询中', '2026-09-01'], ['已付款', T]], { name: '付款今天' });
  const r2 = C.weeklyReport([trial, trialOld, paid], T);
  assert.deepEqual(r2.trials.map((l) => l.name), ['试课边界']);
  assert.deepEqual(r2.paid.map((l) => l.name), ['付款今天']);
  assert.match(r2.markdown, /## 本周付款\(1\)/);
  assert.match(r2.markdown, /## 待跟进清单/);
});

test('CSV 转义逗号、引号、换行,并中和公式前缀', () => {
  const l = lead({ name: '王,"小"明', note: '第一行\n第二行', nextAction: '=HYPERLINK("x")' });
  const csv = C.toCsv([l]);
  assert.equal(csv.split('\n')[0].split(',')[0], '姓名');
  assert.ok(csv.includes('"王,""小""明"'));
  assert.ok(csv.includes('"第一行\n第二行"'));
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'));
  assert.equal(C.toCsv([]).split('\n').length, 2);
});

test('导入校验:合法通过,非法给出逐条错误', () => {
  const good = lead({ name: '甲' });
  const ok = C.validateImport(JSON.stringify({ leads: [good] }));
  assert.equal(ok.ok, true);
  assert.equal(ok.leads[0].name, '甲');
  const bad = C.validateImport({ leads: [Object.assign({}, good, { stage: '乱写' }), Object.assign({}, good, { id: 'x2', name: '', lastContact: '2026-02-30' })] });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.length >= 3);
  assert.deepEqual(bad.leads, []);
  assert.equal(C.validateImport('{坏的').ok, false);
  assert.equal(C.validateImport({ foo: 1 }).ok, false);
  const lostNoReason = Object.assign({}, good, { stage: '流失', lossReason: '' });
  assert.equal(C.validateImport([lostNoReason]).ok, false);
});

test('?today 固定「今天」;非法值回退到 now', () => {
  const now = new Date(2026, 0, 5, 12, 0, 0);
  assert.equal(C.resolveToday('?today=2026-10-20', now), '2026-10-20');
  assert.equal(C.resolveToday('?a=1&today=2026-02-31', now), '2026-01-05');
  assert.equal(C.resolveToday('', now), '2026-01-05');
});

test('日期整数天差跨月跨年正确', () => {
  assert.equal(C.diffDays('2026-03-01', '2026-02-28'), 1);
  assert.equal(C.diffDays('2027-01-01', '2026-12-31'), 1);
  assert.equal(C.addDays('2026-10-20', -7), '2026-10-13');
});

test('[审核P1] 导入拒绝非字符串渠道与非字符串/重复/空 id', () => {
  const base = lead({ name: '乙', id: 'ok1' });
  assert.equal(C.validateImport([Object.assign({}, base, { channel: { a: 1 } })]).ok, false);
  assert.equal(C.validateImport([Object.assign({}, base, { channel: '' })]).ok, false);
  assert.equal(C.validateImport([Object.assign({}, base, { id: 5 })]).ok, false);
  assert.equal(C.validateImport([Object.assign({}, base, { id: '  ' })]).ok, false);
  assert.equal(C.validateImport([base, Object.assign({}, base)]).ok, false, '重复 id 整份拒绝');
  assert.equal(C.validateImport([Object.assign({}, base, { id: '__proto__' }), Object.assign({}, base, { id: 'constructor' })]).ok, true);
  assert.equal(C.byChannel(C.validateImport([base]).leads).length, 1);
});

test('[审核P1] 渠道名为 __proto__ / constructor 时渠道统计不丢线索', () => {
  const a = lead({ channel: '__proto__' });
  const b = lead({ channel: 'constructor' });
  const r = C.byChannel([a, b, lead({ channel: '__proto__' })]);
  assert.equal(r.reduce((n, x) => n + x.leads, 0), 3);
  assert.deepEqual(r.find((x) => x.channel === '__proto__'), { channel: '__proto__', leads: 2, paid: 0 });
  const lr = C.lossReasons([lead({ stage: '流失', lossReason: '价格' })]);
  assert.equal(lr.length, 1);
});

test('[审核P2] ?today 含非法百分号编码时不抛错并回退', () => {
  const now = new Date(2026, 0, 5, 12, 0, 0);
  assert.equal(C.resolveToday('?today=%', now), '2026-01-05');
  assert.equal(C.resolveToday('?today=%E0%A4%A', now), '2026-01-05');
  assert.equal(C.resolveToday('?today=2026-10-20%', now), '2026-01-05');
  assert.equal(C.resolveToday('?today=2026%2D10%2D20', now), '2026-10-20');
});

test('[第五轮] 备份包含超期天数 n 与示例标记,导入校验并还原', () => {
  const l = lead({ name: '丙', id: 'b1' });
  const b = C.toBackup([l], 7, { sample: true });
  assert.equal(b.n, 7);
  assert.equal(b.sample, true);
  assert.equal(b.leads.length, 1);
  const back = C.validateImport(JSON.stringify(b));
  assert.equal(back.ok, true);
  assert.equal(back.n, 7);
  assert.equal(back.sample, true);
  assert.equal(C.validateImport({ leads: [l] }).n, null, '旧备份没有 n 时返回 null');
  assert.equal(C.validateImport({ leads: [l] }).sample, false);
});

test('[第五轮] 导入拒绝非法 n(越界、小数、非数字)', () => {
  const l = lead({ name: '丁', id: 'b2' });
  [0, 61, 2.5, '3', null, -1].forEach((n) => {
    const r = C.validateImport({ leads: [l], n });
    if (n === null) assert.equal(r.ok, true);
    else assert.equal(r.ok, false, 'n=' + n + ' 应被拒绝');
  });
});

test('[第五轮] resolveTodayInfo:真实日期才算固定,2026-02-30 回退', () => {
  const now = new Date(2026, 0, 5, 12, 0, 0);
  assert.deepEqual(C.resolveTodayInfo('?today=2026-10-20', now), { date: '2026-10-20', fixed: true });
  assert.deepEqual(C.resolveTodayInfo('?today=2026-02-30', now), { date: '2026-01-05', fixed: false });
  assert.deepEqual(C.resolveTodayInfo('', now), { date: '2026-01-05', fixed: false });
});

test('[第五轮] 示例标记写入周报与 CSV;describeCounts 给出数量文案', () => {
  const l = lead({ name: '戊', id: 'b3' });
  assert.match(C.weeklyReport([l], '2026-10-20', 3, { sample: true }).markdown, /数据来源:合成示例/);
  assert.doesNotMatch(C.weeklyReport([l], '2026-10-20', 3).markdown, /合成示例/);
  const csv = C.toCsv([l], { sample: true }).split('\n');
  assert.ok(csv[0].endsWith(',数据来源') && csv[1].endsWith(',合成示例'));
  assert.ok(!C.toCsv([l]).split('\n')[0].includes('数据来源'));
  assert.equal(C.describeCounts([l, l], 5), '2 条线索、超期阈值 5 天');
});

test('[第五轮] 周报写明口径(本周范围与超期阈值)', () => {
  const md = C.weeklyReport([lead({ name: '己', id: 'b4' })], '2026-10-20', 5).markdown;
  assert.match(md, /口径/);
  assert.match(md, /超过 5 天未联系/);
  assert.match(md, /2026-10-13 至 2026-10-20/);
});

test('validateImport:空列表是合法备份(清空后导出的就是它),整份接受、0 条线索', () => {
  for (const input of ['[]', ' [ ] ', [], { leads: [] }, JSON.stringify(C.toBackup([], 9))]) {
    const v = C.validateImport(input);
    assert.equal(v.ok, true, JSON.stringify(input));
    assert.deepEqual(v.errors, []);
    assert.deepEqual(v.leads, []);
  }
  assert.equal(C.validateImport(JSON.stringify(C.toBackup([], 9))).n, 9, '空备份里的阈值照样带回');
  assert.equal(C.validateImport('{"leads": null}').ok, false, 'leads 不是数组仍然拒绝');
  assert.equal(C.validateImport('').ok, false, '空字符串不是空列表');
});

test('旧 lastContact 迁移为未核实锚点，不生成伪联系事件', () => {
  const old = C.newLead({ name: '旧数据', channel: '社群', firstContact: '2026-10-01', lastContact: '2026-10-06' }, T, 'legacy-1');
  assert.deepEqual(old.contactEvents, []);
  assert.deepEqual(old.legacyContactAnchor, { date: '2026-10-06', verification: 'unverified', source: 'legacy_last_contact' });
  assert.equal(C.effectiveLastContact(old), '2026-10-06');
});

test('追加多个联系事件；回填较早日期不让最近联系倒退', () => {
  let x = lead({ lastContact: '2026-10-05' });
  x = C.addContactEvent(x, { id: 'ev-new', type: 'detailed', date: '2026-10-18', channel: '微信', summary: '确认需求', outcome: '同意试课', nextStep: '发课表', provenance: 'user' });
  x = C.addContactEvent(x, { id: 'ev-old', type: 'detailed', date: '2026-10-10', channel: '电话', summary: '补录历史', outcome: '已接通', nextStep: '', provenance: 'user' });
  assert.equal(x.contactEvents.length, 2);
  assert.equal(x.lastContact, '2026-10-18');
  assert.equal(C.daysSinceContact(x, T), 2);
});

test('快速联系只生成日期事件，不虚构摘要；更正和归档保留原历史', () => {
  let x = C.addContactEvent(lead(), { id: 'quick-1', type: 'quick_date_only', date: '2026-10-19', provenance: 'user' });
  assert.deepEqual(x.contactEvents[0], { id: 'quick-1', type: 'quick_date_only', date: '2026-10-19', channel: '', summary: '', outcome: '', nextStep: '', provenance: 'user', supersedes: '' });
  x = C.correctContactEvent(x, 'quick-1', { id: 'detail-1', type: 'detailed', date: '2026-10-19', channel: '微信', summary: '询问时间', outcome: '周六可试课', nextStep: '确认时区', provenance: 'user' });
  assert.equal(x.contactEvents.length, 2);
  assert.deepEqual(x.archivedContactEventIds, ['quick-1']);
  assert.equal(x.contactEvents[1].supersedes, 'quick-1');
  x = C.archiveContactEvent(x, 'detail-1');
  assert.deepEqual(x.archivedContactEventIds, ['quick-1', 'detail-1']);
  assert.equal(x.lastContact, '2026-10-01', '全部事件归档后回到旧锚点');
});

test('七天联系统计只算有效 detailed 事件，边界含第 7 天，不算第 8 天和仅日期标记', () => {
  let x = lead({ name: '边界' });
  x = C.addContactEvent(x, { id: 'd7', type: 'detailed', date: '2026-10-13', channel: '邮件', summary: '第七天', outcome: '回复', nextStep: '', provenance: 'user' });
  x = C.addContactEvent(x, { id: 'd8', type: 'detailed', date: '2026-10-12', channel: '邮件', summary: '第八天', outcome: '回复', nextStep: '', provenance: 'user' });
  x = C.addContactEvent(x, { id: 'q1', type: 'quick_date_only', date: '2026-10-20', provenance: 'user' });
  const r = C.weeklyReport([x], T);
  assert.deepEqual(r.contacts.map((v) => v.event.id), ['d7']);
  assert.deepEqual(r.quickContacts.map((v) => v.event.id), ['q1']);
  assert.match(r.markdown, /旧最近联系锚点和 quick_date_only.*不计入/);
});

test('JSON/CSV 保留事件和来源；导入对事件 id、日期、类型执行整份原子拒绝', () => {
  const x = C.addContactEvent(lead(), { id: 'export-1', type: 'detailed', date: '2026-10-18', channel: '视频会议', summary: '<img src=x onerror=alert(1)>', outcome: '继续', nextStep: '报价', provenance: 'sample' });
  const backup = C.toBackup([x], 4, { sample: true });
  const roundtrip = C.validateImport(JSON.stringify(backup));
  assert.equal(roundtrip.ok, true);
  assert.equal(roundtrip.leads[0].contactEvents[0].provenance, 'sample');
  assert.match(C.toCsv([x]), /联系事件\(JSON\)/);
  assert.match(C.toCsv([x]), /export-1/);
  const duplicate = JSON.parse(JSON.stringify(backup));
  duplicate.leads.push(Object.assign({}, duplicate.leads[0], { id: 'second' }));
  assert.equal(C.validateImport(duplicate).ok, false, '跨线索重复事件 id 拒绝');
  for (const bad of [{ date: '2026-02-30' }, { type: 'unknown' }, { provenance: 'unknown' }]) {
    const copy = JSON.parse(JSON.stringify(backup));
    Object.assign(copy.leads[0].contactEvents[0], bad);
    const result = C.validateImport(copy);
    assert.equal(result.ok, false);
    assert.deepEqual(result.leads, [], '任一事件非法时整份不导入');
  }
});
