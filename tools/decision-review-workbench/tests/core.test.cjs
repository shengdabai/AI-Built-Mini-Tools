'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../core.js');

const baseInput = { title: '是否完成测试', question: '到期前是否完成全部测试？', probability: 70, dueDate: '2026-11-01', reasons: '已有测试清单', evidence: '本机记录' };
function decision(overrides = {}) { const result = core.createDecision({ ...baseInput, ...overrides }, '2026-10-29T00:00:00.000Z', 'x'); assert.equal(result.ok, true); return result.value; }
function resolve(item, input = {}) { return core.resolveDecision(item, { outcome: 1, reviewedOn: '2026-11-01', summary: '完成', bias: '未判断', nextTest: '', ...input }, '2026-11-02', '2026-11-02T00:00:00.000Z'); }

test('0% 与 100% 概率都有效', () => {
  assert.equal(core.createDecision({ ...baseInput, probability: 0 }, '2026-10-29T00:00:00Z', 'a').ok, true);
  assert.equal(core.createDecision({ ...baseInput, probability: 100 }, '2026-10-29T00:00:00Z', 'b').ok, true);
});
test('小数、越界概率被拒绝', () => {
  assert.equal(core.createDecision({ ...baseInput, probability: 50.5 }).ok, false);
  assert.equal(core.createDecision({ ...baseInput, probability: 101 }).ok, false);
});
test('不存在的日期被拒绝', () => assert.equal(core.createDecision({ ...baseInput, dueDate: '2026-02-30' }).ok, false));
test('上海日历日处理 UTC 次日边界', () => assert.equal(core.calendarDay('2026-10-29T16:30:00.000Z'), '2026-10-30'));
test('修改预测新增版本并保留原预测', () => {
  const first = decision(); const changed = core.reviseForecast(first, { ...baseInput, probability: 40 }, '2026-10-30T00:00:00Z');
  assert.equal(changed.ok, true); assert.equal(changed.value.forecastVersions.length, 2); assert.equal(changed.value.forecastVersions[0].probability, 70);
});
test('记录结果后不能修改预测', () => {
  const resolved = resolve(decision()).value;
  assert.equal(core.reviseForecast(resolved, baseInput).ok, false);
});
test('实际结果只接受二元值', () => assert.equal(resolve(decision(), { outcome: 2 }).ok, false));
test('到期前、到期当天、到期后和已复查状态分开', () => {
  const past = decision({ dueDate: '2026-10-28' }); const today = decision({ dueDate: '2026-10-29' }); const future = decision({ dueDate: '2026-10-30' });
  const resolved = core.resolveDecision(future, { outcome: 0, reviewedOn: '2026-10-29', summary: '未完成', bias: '执行偏差', nextTest: '' }, '2026-10-29', '2026-10-29T12:00:00.000Z').value;
  assert.equal(core.statusOf(past, '2026-10-29'), 'overdue'); assert.equal(core.statusOf(today, '2026-10-29'), 'overdue'); assert.equal(core.statusOf(future, '2026-10-29'), 'open'); assert.equal(core.statusOf(resolved, '2026-10-29'), 'resolved');
});
test('Brier 分数只统计已复查记录', () => {
  const d1 = resolve(decision({ probability: 100 })).value;
  const d2 = resolve(decision({ probability: 0 }), { summary: '发生' }).value;
  const stats = core.calibration([d1, d2, decision()]); assert.equal(stats.count, 2); assert.equal(stats.brier, 0.5);
});
test('合成示例与真实记录共存时，真实校准排除合成记录', () => {
  const synthetic = resolve({ ...decision({ probability: 0 }), origin: 'synthetic' }, { summary: '合成结果' }).value;
  const user = resolve(decision({ probability: 100 }), { summary: '真实结果' }).value;
  const stats = core.calibration([synthetic, user]);
  assert.equal(stats.count, 1); assert.equal(stats.brier, 0);
  assert.equal(core.calibration([synthetic]).count, 0);
});
test('无已复查记录时不伪造 Brier 分数', () => assert.deepEqual(core.calibration([decision()]), { count: 0, brier: null, averageProbability: null, outcomeRate: null }));
test('重复决策编号使整份备份失败', () => {
  const item = decision(); const state = { version: 2, isSample: false, legacyNotes: [], decisions: [item, item] };
  assert.equal(core.validateState(state).ok, false);
});
test('备份导入不执行用户 HTML', () => {
  const item = decision({ title: '<img src=x onerror=alert(1)>' }); const parsed = core.parseBackup(JSON.stringify({ version: 2, isSample: false, legacyNotes: [], decisions: [item] }));
  assert.equal(parsed.ok, true); assert.equal(parsed.value.decisions[0].title, '<img src=x onerror=alert(1)>');
});
test('无效 JSON 原子拒绝', () => assert.equal(core.parseBackup('{bad').ok, false));
test('宽松日期字符串不能冒充 ISO 时间戳', () => {
  for (const invalid of ['1', '2', '2026-10-29']) {
    const state = { version: 2, isSample: false, legacyNotes: [], decisions: [{ ...decision(), createdAt: invalid }] };
    assert.equal(core.validateState(state, '2026-11-02', '2026-11-02T00:00:00.000Z').ok, false);
  }
});
test('预测版本必须按时间排序', () => {
  const revised = core.reviseForecast(decision(), { ...baseInput, probability: 60 }, '2026-10-30T00:00:00.000Z').value;
  revised.forecastVersions[0].createdAt = '2026-10-31T00:00:00.000Z';
  assert.equal(core.validateState({ version: 2, isSample: false, legacyNotes: [], decisions: [revised] }, '2026-11-02', '2026-11-02T00:00:00.000Z').ok, false);
});
test('复查写入时间不能早于最后预测版本', () => {
  const item = decision();
  item.review = { outcome: 1, reviewedOn: '2026-11-01', reviewedAt: '2026-10-28T00:00:00.000Z', summary: '发生', bias: '未判断', nextTest: '' };
  assert.equal(core.validateState({ version: 2, isSample: false, legacyNotes: [], decisions: [item] }, '2026-11-02', '2026-11-02T00:00:00.000Z').ok, false);
});
test('未来复查日期和未来写入时间都被直接与导入校验拒绝', () => {
  assert.equal(core.resolveDecision(decision(), { outcome: 1, reviewedOn: '2099-01-01', summary: '未来', bias: '未判断', nextTest: '' }, '2026-11-02', '2026-11-02T00:00:00.000Z').ok, false);
  const item = resolve(decision()).value; item.review.reviewedAt = '2099-01-01T00:00:00.000Z';
  const payload = JSON.stringify({ version: 2, isSample: false, legacyNotes: [], decisions: [item] });
  assert.equal(core.parseBackup(payload, '2026-11-02', '2026-11-02T00:00:00.000Z').ok, false);
});
test('解析结果自动写入不可由输入覆盖的 reviewedAt', () => {
  const result = core.resolveDecision(decision(), { outcome: 1, reviewedOn: '2026-11-01', reviewedAt: '2099-01-01T00:00:00.000Z', summary: '完成', bias: '未判断', nextTest: '' }, '2026-11-02', '2026-11-02T03:04:05.000Z');
  assert.equal(result.ok, true); assert.equal(result.value.review.reviewedAt, '2026-11-02T03:04:05.000Z');
});
test('自报复查日期早于最后预测的上海日历日时直接拒绝', () => {
  const item = core.createDecision({ ...baseInput, dueDate: '2026-10-30' }, '2026-10-29T16:30:00.000Z', 'sh').value;
  const early = core.resolveDecision(item, { outcome: 1, reviewedOn: '2026-10-29', summary: '过早', bias: '未判断', nextTest: '' }, '2026-10-30', '2026-10-30T01:00:00.000Z');
  assert.equal(early.ok, false);
});
test('自报复查日期与最后预测的上海日历日相同可保存', () => {
  const item = core.createDecision({ ...baseInput, dueDate: '2026-10-30' }, '2026-10-29T16:30:00.000Z', 'sh').value;
  const sameDay = core.resolveDecision(item, { outcome: 1, reviewedOn: '2026-10-30', summary: '同日自报', bias: '未判断', nextTest: '' }, '2026-10-30', '2026-10-30T01:00:00.000Z');
  assert.equal(sameDay.ok, true);
});
test('导入拒绝早于最后预测上海日历日的自报复查日期', () => {
  const item = core.createDecision({ ...baseInput, dueDate: '2026-10-30' }, '2026-10-29T16:30:00.000Z', 'sh').value;
  item.review = { outcome: 1, reviewedOn: '2026-10-29', reviewedAt: '2026-10-30T01:00:00.000Z', summary: '过早', bias: '未判断', nextTest: '' };
  const payload = JSON.stringify({ version: 2, isSample: false, legacyNotes: [], decisions: [item] });
  assert.equal(core.parseBackup(payload, '2026-10-30', '2026-10-30T01:00:00.000Z').ok, false);
});
test('决策数组中的 null、字符串和数组均被安全拒绝', () => {
  for (const invalid of [null, 'record', []]) {
    const parsed = core.parseBackup(JSON.stringify({ version: 2, isSample: false, legacyNotes: [], decisions: [invalid] }));
    assert.equal(parsed.ok, false);
  }
});
test('旧版原文数组中的 null、字符串和数组均被安全拒绝', () => {
  for (const invalid of [null, 'record', []]) {
    const parsed = core.parseBackup(JSON.stringify({ version: 2, isSample: false, legacyNotes: [invalid], decisions: [] }));
    assert.equal(parsed.ok, false);
  }
});
test('混合有效与 null 的导入失败且原状态不变', () => {
  const original = { version: 2, isSample: false, legacyNotes: [], decisions: [decision()] };
  const before = JSON.stringify(original);
  const malformed = { ...original, decisions: [original.decisions[0], null] };
  assert.equal(core.parseBackup(JSON.stringify(malformed)).ok, false);
  assert.equal(JSON.stringify(original), before);
});
test('旧版原文迁移不制造概率和结果', () => {
  const migrated = core.parseLegacy(JSON.stringify({ before: '原始事前文本', after: '原始事后文本' }), '2026-10-29T00:00:00Z', 'legacy');
  assert.equal(migrated.ok, true); assert.equal(migrated.value.before, '原始事前文本'); assert.equal('probability' in migrated.value, false);
});
test('空旧版记录被拒绝', () => assert.equal(core.parseLegacy(JSON.stringify({ before: '', after: '' })).ok, false));
test('JSON 往返保留预测历史和复查', () => {
  const first = decision(); const revised = core.reviseForecast(first, { ...baseInput, probability: 55 }, '2026-10-30T00:00:00Z').value;
  const resolved = resolve(revised, { outcome: 0, summary: '未完成', bias: '过度自信', nextTest: '缩小范围' }).value;
  const state = { version: 2, isSample: false, legacyNotes: [], decisions: [resolved] }; const parsed = core.parseBackup(JSON.stringify(state), '2026-11-02', '2026-11-02T00:00:00.000Z');
  assert.equal(parsed.ok, true); assert.deepEqual(parsed.value, state);
});
test('Markdown 明示合成示例与统计边界', () => {
  const synthetic = { ...decision(), origin: 'synthetic' };
  const md = core.exportMarkdown({ version: 2, isSample: true, decisions: [synthetic, decision()], legacyNotes: [{ id: 'l', importedAt: '2026-10-29T00:00:00Z', before: 'a', after: 'b' }] });
  assert.match(md, /来源：合成示例/); assert.match(md, /来源：用户录入/); assert.match(md, /不进入校准统计/);
});
test('Markdown 展开全部预测版本及复查时间', () => {
  const revised = core.reviseForecast(decision(), { ...baseInput, probability: 55 }, '2026-10-30T00:00:00.000Z').value;
  const resolved = resolve(revised, { outcome: 0 }).value;
  const md = core.exportMarkdown({ version: 2, isSample: false, decisions: [resolved], legacyNotes: [] });
  assert.match(md, /预测版本 1/); assert.match(md, /预测版本 2/); assert.match(md, /2026-10-29T00:00:00.000Z/); assert.match(md, /自报复查日期：2026-11-01/); assert.match(md, /复查写入时间：2026-11-02T00:00:00.000Z/);
});
