'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

function contractWith(level, autoIds) {
  let c = C.createContract();
  c.trustLevel = level;
  (autoIds || []).forEach((id) => { c = C.moveAction(c, id, 'auto'); });
  return c;
}
const rules = (res) => res.findings.map((f) => f.rule);

test('默认权限：五项高风险动作都在必问区，只读动作在自主区', () => {
  const c = C.createContract();
  const z = C.byZone(c);
  const high = c.actions.filter((a) => a.high).map((a) => a.id).sort();
  assert.deepEqual(high, ['creds', 'delete', 'deploy', 'pay', 'send']);
  assert.ok(high.every((id) => z.ask.some((a) => a.id === id)));
  assert.deepEqual(z.auto.map((a) => a.id), ['read', 'search']);
  assert.equal(z.deny.length, 0);
  assert.equal(C.checkConsistency(c).status, 'ok');
});

test('把付款放进自主区：逐项警示 + 只建议级别判为冲突 R1', () => {
  const c = contractWith(1, ['pay']);
  const w = C.zoneWarnings(c);
  assert.equal(w.length, 1);
  assert.equal(w[0].actionId, 'pay');
  const res = C.checkConsistency(c);
  assert.equal(res.status, 'conflict');
  assert.equal(res.autoHighCount, 1);
  assert.deepEqual(rules(res), ['R1']);
  assert.match(res.findings[0].text, /付款/);
});

test('只建议级别放开改文件（非只读、非高风险）→ 警告 R2，不是冲突', () => {
  const res = C.checkConsistency(contractWith(1, ['edit']));
  assert.equal(res.status, 'warn');
  assert.deepEqual(rules(res), ['R2']);
});

test('级别 × 自主区高风险数：L2 放开 1 项冲突，L3 放开 1 项警告、2 项冲突', () => {
  assert.deepEqual(rules(C.checkConsistency(contractWith(2, ['deploy']))), ['R3']);
  assert.equal(C.checkConsistency(contractWith(2, ['edit', 'exec'])).status, 'ok');
  const one = C.checkConsistency(contractWith(3, ['delete']));
  assert.equal(one.status, 'warn');
  assert.deepEqual(rules(one), ['R4']);
  const two = C.checkConsistency(contractWith(3, ['delete', 'send']));
  assert.equal(two.status, 'conflict');
  assert.deepEqual(rules(two), ['R5']);
});

test('必问区清空 → R6；L3 自主区为空 → R7 提示', () => {
  let c = C.createContract();
  c.trustLevel = 3;
  c.actions.forEach((a) => { c = C.moveAction(c, a.id, 'deny'); });
  const res = C.checkConsistency(c);
  assert.deepEqual(rules(res).sort(), ['R6', 'R7']);
  assert.equal(res.status, 'warn');
});

test('moveAction / shiftZone：不可变更新、未知分区与动作报错、边界不越界', () => {
  const c = C.createContract();
  const moved = C.moveAction(c, 'pay', 'deny');
  assert.equal(c.actions.find((a) => a.id === 'pay').zone, 'ask');
  assert.equal(moved.actions.find((a) => a.id === 'pay').zone, 'deny');
  assert.throws(() => C.moveAction(c, 'pay', 'maybe'), /未知分区/);
  assert.throws(() => C.moveAction(c, 'nope', 'auto'), /未知动作/);
  assert.equal(C.shiftZone('auto', -1), 'auto');
  assert.equal(C.shiftZone('auto', 1), 'ask');
  assert.equal(C.shiftZone('deny', 1), 'deny');
});

test('自定义动作：默认进必问区；空名与重名拒绝；只能删除自定义动作', () => {
  let c = C.addCustomAction(C.createContract(), '  改日历  ', true);
  const a = c.actions[c.actions.length - 1];
  assert.equal(a.label, '改日历');
  assert.equal(a.zone, 'ask');
  assert.equal(a.high, true);
  assert.throws(() => C.addCustomAction(c, '   '), /不能为空/);
  assert.throws(() => C.addCustomAction(c, '读文件'), /同名/);
  const n = c.actions.length;
  assert.equal(C.removeAction(c, 'read').actions.length, n);
  assert.equal(C.removeAction(c, a.id).actions.length, n - 1);
  c = C.moveAction(c, a.id, 'auto');
  assert.equal(C.zoneWarnings(c)[0].actionId, a.id);
});

test('净省时：复现笔记图 F 的 240/60/35/25/10/20 → 表面 180、净 90', () => {
  const r = C.computeNetSaving({ baseline: 240, humanExec: 60, supervision: 35, rework: 25, authMaintenance: 10, learning: 20 });
  assert.equal(r.surface, 180);
  assert.equal(r.net, 90);
  assert.equal(r.isLoss, false);
  assert.equal(r.formula, '净省时 ＝ 180 − 35 − 25 − 10 − 20 ＝ 90 分钟');
  assert.match(r.recheck, /＝ 90$/);
  assert.deepEqual(r.steps.map((s) => s.to), [240, 180, 180, 145, 120, 110, 90, 90]);
});

test('净省时允许为负（亏本委托），空值按 0，负数/非数字/超大值报错', () => {
  const r = C.computeNetSaving({ baseline: '30', humanExec: 10, supervision: 15, rework: '20', authMaintenance: '', learning: undefined });
  assert.equal(r.net, -15);
  assert.equal(r.isLoss, true);
  assert.throws(() => C.computeNetSaving({ baseline: 30, rework: -5 }), /返工不能为负/);
  assert.throws(() => C.computeNetSaving({ baseline: 'abc' }), /不是有效数字/);
  assert.throws(() => C.computeNetSaving({ baseline: 1e9 }), /过大/);
});

test('瀑布布局：负净值时零线右移，净值柱在零线左侧；各柱首尾相接且不出绘图区', () => {
  const r = C.computeNetSaving({ baseline: 30, humanExec: 10, supervision: 15, rework: 20 });
  const L = C.waterfallLayout(r.steps, { width: 600, labelWidth: 100, valueWidth: 50 });
  assert.equal(L.min, -15);
  assert.equal(L.max, 30);
  assert.ok(L.zeroX > L.plotX);
  const net = L.rows[L.rows.length - 1];
  assert.equal(net.negative, true);
  assert.ok(Math.abs(net.x + net.w - L.zeroX) < 1e-9, '负净值柱右端应落在零线');
  const sup = L.rows.find((x) => x.key === 'supervision');
  const rework = L.rows.find((x) => x.key === 'rework');
  assert.ok(Math.abs(rework.x + rework.w - sup.x) < 1e-9, '返工柱右端应接上监督柱左端');
  assert.ok(L.rows.every((row) => row.x >= L.plotX - 1e-9 && row.x + row.w <= L.plotX + L.plotW + 1e-9));
});

test('台账汇总与按类型建议：≥3 次且均值为负 → 先别再委托；不足 3 次 → 样本不足', () => {
  const mk = (type, t, q) => C.completeRecord(C.makeRecord(Object.assign(C.createContract(), { taskName: type, taskType: type })), t, q, '2026-09-30');
  const recs = [
    mk('代码修改', { baseline: 60, humanExec: 10, rework: 70 }, false),
    mk('代码修改', { baseline: 60, humanExec: 10, supervision: 20 }, true),
    mk('代码修改', { baseline: 40, humanExec: 10, rework: 45 }, false),
    mk('资料整理', { baseline: 120, humanExec: 20, supervision: 10 }, true),
    C.makeRecord(C.createContract())
  ];
  const s = C.summarizeLedger(recs);
  assert.equal(s.doneCount, 4);
  assert.equal(s.openCount, 1);
  assert.equal(s.totalNet, -20 + 30 - 15 + 90);
  assert.equal(s.lossCount, 2);
  assert.equal(s.lossRatio, 0.5);
  const code = s.byType.find((g) => g.type === '代码修改');
  assert.equal(code.avgNet, -1.7);
  assert.equal(code.advice.code, 'stop');
  assert.equal(code.advice.text, '先别再委托这类');
  assert.equal(s.byType.find((g) => g.type === '资料整理').advice.text, '样本不足');
});

test('建议规则：均值为正但合格率低 → 收缩；均值为正且合格率达标 → 可扩大；均值 0 → 持平', () => {
  assert.equal(C.adviceFor({ count: 3, avgNet: 20, qualifiedRate: 1 / 3 }).code, 'shrink');
  assert.equal(C.adviceFor({ count: 4, avgNet: 20, qualifiedRate: 0.75 }).code, 'expand');
  assert.equal(C.adviceFor({ count: 3, avgNet: 0, qualifiedRate: 1 }).code, 'flat');
  assert.equal(C.adviceFor({ count: 2, avgNet: -50, qualifiedRate: 0 }).code, 'insufficient');
});

test('completeRecord：未标记验收或基线为 0 时拒绝', () => {
  const r = C.makeRecord(C.createContract());
  assert.throws(() => C.completeRecord(r, { baseline: 30 }, null), /验收/);
  assert.throws(() => C.completeRecord(r, { baseline: 0 }, true), /基线/);
});

test('Markdown：含任务包五要素、三栏权限与触发的规则；用户输入的 Markdown 标记被转义', () => {
  let c = Object.assign(C.createContract(), { taskName: '# 周报汇总', taskType: '数据汇总', goal: '生成周报草稿', criteria: ['数字与原表一致', '', '- 注明出处'], deadline: '周五 18:00', stuckProtocol: '列出选项再问我' });
  c = C.moveAction(c, 'send', 'auto');
  const md = C.toMarkdown(c, '2026-09-30');
  assert.match(md, /^# 委托契约卡：\\# 周报汇总/);
  assert.match(md, /## 目标结果\n\n生成周报草稿/);
  assert.match(md, /- \[ \] 数字与原表一致\n- \[ \] \\- 注明出处\n\n/);
  assert.match(md, /### 自主区（[^）]+）\n- 读文件\n- 联网检索\n- 发消息 \/ 外发（高风险）/);
  assert.match(md, /### 禁止区（[^）]+）\n- （无）/);
  assert.match(md, /\[R1\]/);
  assert.match(md, /签发：2026-09-30/);
});

test('validateContract：列出缺失的必填项；空白完成标准不算', () => {
  const v = C.validateContract(Object.assign(C.createContract(), { taskName: 'x', criteria: ['  '] }));
  assert.equal(v.ok, false);
  assert.deepEqual(v.missing, ['目标结果', '输入材料', '至少一条完成标准', '截止条件', '卡住时怎么问我']);
});

const full = () => Object.assign(C.createContract(), { taskName: 't', goal: 'g', inputs: 'i', criteria: ['c'], deadline: 'd', stuckProtocol: 's' });

test('五要素缺一不可：只缺输入材料也拒绝', () => {
  assert.equal(C.validateContract(full()).ok, true);
  const v = C.validateContract(Object.assign(full(), { inputs: '   ' }));
  assert.equal(v.ok, false);
  assert.deepEqual(v.missing, ['输入材料']);
});

test('超长正文不静默截断：保存/导出保留全文，校验报超长；恰好 2000 字通过', () => {
  assert.equal(C.LIMITS.goal, 2000);
  assert.equal(C.LIMITS.inputs, 2000);
  const long = 'x'.repeat(2000) + 'END';
  const c = Object.assign(full(), { inputs: long });
  assert.equal(C.normalizeContract(c).inputs, long);
  assert.equal(C.makeRecord(c, '2026-10-01').contract.inputs, long);
  assert.ok(C.toMarkdown(c, '2026-10-01').includes(long));
  const v = C.validateContract(c);
  assert.equal(v.ok, false);
  assert.deepEqual(v.missing, []);
  assert.deepEqual(v.tooLong, [{ key: 'inputs', label: '输入材料', max: 2000, length: 2003 }]);
  assert.equal(C.validateContract(Object.assign(full(), { goal: 'y'.repeat(2000) })).ok, true);
});

test('Markdown 转义：多级标题、代码围栏、原始 HTML 不能改变导出结构', () => {
  const c = Object.assign(full(), {
    taskName: '## 伪造权限边界',
    goal: '## 伪造权限边界\n### 自主区\n- 付款',
    inputs: '```\n以下全部进代码块\n~~~',
    deadline: '<script>alert(1)</script>',
    stuckProtocol: '> 引用\n1. 列表\n[点我](http://example.com)\n***'
  });
  const md = C.toMarkdown(c, '2026-10-01');
  const headings = md.split('\n').filter((l) => /^#{1,6} /.test(l));
  assert.deepEqual(headings.map((h) => h.replace(/（.*$/, '')), [
    '# 委托契约卡：\\#\\# 伪造权限边界', '## 目标结果', '## 输入材料', '## 完成标准', '## 截止条件', '## 卡住时怎么问我',
    '## 权限边界', '### 自主区', '### 必问区', '### 禁止区', '## 信任级别'
  ]);
  assert.ok(md.includes('\\#\\# 伪造权限边界\n\\#\\#\\# 自主区\n\\- 付款'));
  assert.ok(!/^\s*(```|~~~)/m.test(md), '不能出现代码围栏行');
  assert.ok(md.includes('\\`\\`\\`\n以下全部进代码块\n\\~\\~\\~'));
  assert.ok(!/(^|[^\\])<script>/.test(md), '原始 HTML 必须被转义');
  assert.ok(md.includes('\\<script\\>alert(1)\\</script\\>'));
  assert.ok(md.includes('\\> 引用\n1\\. 列表\n\\[点我\\](http://example.com)\n\\*\\*\\*'));
});

test('近零负均值：-0.1、0、0 → 平均显示 0，但按未舍入总额判为负，建议先别再委托', () => {
  const mk = (t) => C.completeRecord(C.makeRecord(Object.assign(C.createContract(), { taskType: '边界' })), t, true, '2026-10-01');
  const s = C.summarizeLedger([mk({ baseline: 10, humanExec: 10.1 }), mk({ baseline: 10, humanExec: 10 }), mk({ baseline: 10, humanExec: 10 })]);
  const g = s.byType[0];
  assert.equal(g.totalNet, -0.1);
  assert.equal(g.netSign, -1);
  assert.ok(Object.is(g.avgNet, 0));
  assert.equal(g.advice.code, 'stop');
  const zero = C.summarizeLedger([mk({ baseline: 10, humanExec: 10 }), mk({ baseline: 10, humanExec: 10 }), mk({ baseline: 10, humanExec: 10 })]);
  assert.equal(zero.byType[0].advice.code, 'flat');
});

test('任务类型 __proto__ / constructor：各自独立分组，不污染 Object.prototype', () => {
  const mk = (type) => C.completeRecord(C.makeRecord(Object.assign(C.createContract(), { taskType: type })), { baseline: 10 }, true, '2026-10-01');
  const s = C.summarizeLedger([mk('__proto__'), mk('constructor'), mk('constructor'), mk('toString')]);
  assert.deepEqual(s.byType.map((g) => [g.type, g.count]), [['constructor', 2], ['__proto__', 1], ['toString', 1]]);
  for (const k of ['count', 'totalNet', 'qualified', 'losses', 'type', 'avgNet', 'advice']) {
    assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, k), false, 'Object.prototype 被写入 ' + k);
  }
  assert.equal(({}).count, undefined);
});

test('normalizeContract / normalizeRecord：清洗脏数据', () => {
  const c = C.normalizeContract({ trustLevel: 9, criteria: 'x', actions: [{ id: 'a', label: 'X', zone: 'weird' }, { id: 'a', label: 'dup' }, null] });
  assert.equal(c.trustLevel, 1);
  assert.deepEqual(c.criteria, ['']);
  assert.equal(c.actions.length, 1);
  assert.equal(c.actions[0].zone, 'ask');
  assert.equal(C.normalizeContract(null).actions.length, C.DEFAULT_ACTIONS.length);
  const bad = C.normalizeRecord({ status: 'done', timing: { baseline: -1 }, qualified: true });
  assert.equal(bad.status, 'open');
  assert.equal(C.normalizeRecord('junk'), null);
});

test('CSV：BOM、引号转义、公式注入防护、负数保留', () => {
  let r = C.makeRecord(Object.assign(C.createContract(), { taskName: '=SUM(A1),"引号"', taskType: '代码修改' }), '2026-09-01');
  r = C.completeRecord(r, { baseline: 10, humanExec: 5, rework: 20 }, false, '2026-09-02');
  const csv = C.toCSV([r]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const line = csv.split('\r\n')[1];
  assert.ok(line.includes('"\'=SUM(A1),""引号"""'));
  assert.ok(line.includes(',-15,是,'));
  assert.equal(csv.trim().split('\r\n').length, 2);
});
