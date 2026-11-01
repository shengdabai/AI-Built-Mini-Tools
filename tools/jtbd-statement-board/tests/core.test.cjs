'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');
const SAMPLE = require('../sample-data.js');

const clone = o => JSON.parse(JSON.stringify(o));
const item = (id, text, evidence) => ({ id, text, evidence: evidence || [] });
const ev = (id, type, extra) => Object.assign({ id, type, text: '证据', source: '来源', date: '2026-10-01' }, extra || {});
function job(over) {
  const j = C.blankJob('j1', '测试任务');
  Object.assign(j, { situation: '周日晚上', motivation: '整理一周笔记', outcome: '10 分钟内找到任何笔记' }, over || {});
  return j;
}
const state = jobs => ({ version: 1, jobs, currentId: jobs.length ? jobs[0].id : null });

test('句式任一为空则阻断,全空白也算空', () => {
  const r = C.validateJob(job({ situation: '   ', motivation: '', outcome: '能 10 分钟找到' }));
  const blocks = r.issues.filter(i => i.level === 'block').map(i => i.code).sort();
  assert.deepEqual(blocks, ['empty-motivation', 'empty-situation']);
  assert.equal(C.validateJob(job()).issues.some(i => i.level === 'block'), false);
});

test('方案词检测:默认词表、大小写、可配、空词表', () => {
  assert.deepEqual(C.solutionWords('我想要一个 app 自动归类', undefined), ['APP']);
  assert.deepEqual(C.solutionWords('一个工具加一个按钮'), ['工具', '按钮']);
  assert.deepEqual(C.solutionWords('我想要一个小程序', ['小程序', '  ', '']), ['小程序']);
  assert.deepEqual(C.solutionWords('我想要一个 APP', []), []);
  const w = C.validateJob(job({ motivation: '做个 APP 管理笔记' })).issues.find(i => i.code === 'solution-in-motivation');
  assert.ok(w && w.level === 'warn' && w.message.includes('写的是方案不是任务'));
  assert.equal(C.validateJob(job({ motivation: '做个 APP', words: [] })).issues.some(i => i.code === 'solution-in-motivation'), false);
});

test('可观察检测:数字、时间、能/不再;空泛描述不通过', () => {
  assert.equal(C.observable('3 分钟内写完'), true);
  assert.equal(C.observable('每周一次'), true);
  assert.equal(C.observable('家长不再追问'), true);
  assert.equal(C.observable('能找到旧笔记'), true);
  assert.equal(C.observable('三天内完成'), true);
  assert.equal(C.observable('笔记变得更有条理'), false);
  assert.equal(C.observable(''), false);
  assert.equal(C.validateJob(job({ outcome: '笔记变得更有条理' })).issues.some(i => i.code === 'outcome-not-observable'), true);
});

test('力平衡:推力+拉力 <= 惯性+焦虑 时提示,多于时不提示', () => {
  const j = job();
  j.forces.push.push(item('a', '不满'));
  j.forces.inertia.push(item('b', '习惯'));
  assert.deepEqual(C.forceBalance(j), { drive: 1, resist: 1, blocked: true });
  assert.ok(C.validateJob(j).issues.some(i => i.code === 'resistance-ge-drive'));
  j.forces.pull.push(item('c', '吸引'));
  assert.equal(C.forceBalance(j).blocked, false);
  assert.equal(C.validateJob(j).issues.some(i => i.code === 'resistance-ge-drive'), false);
  j.forces.pull.push(item('d', '   '));
  assert.equal(C.forceBalance(j).drive, 2, '空白条目不计数');
});

test('替代方案为空时警告;名称为空白也算没有', () => {
  assert.ok(C.validateJob(job()).issues.some(i => i.code === 'no-alternatives' && i.level === 'warn'));
  const j = job({ alternatives: [{ id: 'a', name: ' ', cost: '', time: '', pain: '' }] });
  assert.ok(C.validateJob(j).issues.some(i => i.code === 'no-alternatives'));
  j.alternatives[0].name = '手打';
  assert.equal(C.validateJob(j).issues.some(i => i.code === 'no-alternatives'), false);
});

function coverageJob() {
  const j = job();
  j.forces.push = [item('p1', '推1'), item('p2', '推2')];
  j.forces.pull = [item('l1', '拉1')];
  j.forces.anxiety = [item('x1', '焦1'), item('x2', '焦2')];
  j.forces.inertia = [item('i1', '惯1')];
  j.candidates = [
    { id: 'c1', name: '方案甲', solves: ['p1', 'l1'], eases: ['x2'] },
    { id: 'c2', name: '方案乙', solves: [], eases: [] }
  ];
  return j;
}
test('coverage 矩阵与计数;惯性不进矩阵;无总分字段', () => {
  const m = C.coverage(coverageJob());
  assert.deepEqual(m.columns.map(c => c.id), ['p1', 'p2', 'l1', 'x1', 'x2']);
  assert.deepEqual(m.rows[0].cells, [true, false, true, false, true]);
  assert.equal(m.rows[0].solved, 2);
  assert.equal(m.rows[0].eased, 1);
  assert.equal(m.rows[1].solved + m.rows[1].eased, 0);
  assert.equal(m.drivingTotal, 3);
  assert.equal(m.anxietyTotal, 2);
  assert.equal('score' in m.rows[0] || 'total' in m.rows[0], false);
});

test('coverage 忽略已不存在的引用,且不把焦虑当推力计数', () => {
  const j = coverageJob();
  j.candidates[0].solves.push('ghost', 'x1');
  const r = C.coverage(j).rows[0];
  assert.equal(r.solved, 2, '幽灵 id 与放在 solves 里的焦虑条目都不计数');
  assert.equal(r.eased, 1);
  assert.deepEqual(C.coverage(job()).rows, []);
});

test('evidenceStats 假设占比;无条目时除零返回 null;自己猜单独计', () => {
  assert.equal(C.evidenceStats(job()).ratio, null);
  const j = job();
  j.forces.push = [item('p1', 'a', [ev('e1', 'interview')]), item('p2', 'b')];
  j.forces.pull = [item('l1', 'c', [ev('e2', 'guess')]), item('l2', 'd')];
  j.forces.inertia = [item('i1', '不计入')];
  const s = C.evidenceStats(j);
  assert.equal(s.total, 4);
  assert.equal(s.withEvidence, 2);
  assert.equal(s.assumptions, 2);
  assert.equal(s.ratio, 0.5);
  assert.equal(s.guessOnly, 1);
  assert.equal(s.byType.interview, 1);
  assert.equal(s.byType.guess, 1);
});

test('证据类型枚举:四种合法,其它整份拒绝', () => {
  assert.deepEqual(Object.keys(C.EVIDENCE_TYPES), ['interview', 'post', 'data', 'guess']);
  const j = job();
  j.forces.push = [item('p1', 'a', [ev('e1', 'rumor')])];
  const r = C.validateState(state([j]));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('rumor')));
  j.forces.push[0].evidence[0].type = 'data';
  assert.equal(C.validateState(state([j])).ok, true);
});

test('Markdown 一页结构:标题、句式、四力、替代方案、覆盖、证据、检查', () => {
  const j = coverageJob();
  j.title = '课后反馈';
  j.alternatives = [{ id: 'a1', name: '手打', cost: '0', time: '40 分钟', pain: '漏发' }];
  const md = C.toMarkdown(j);
  const heads = md.split('\n').filter(l => l.startsWith('#'));
  assert.deepEqual(heads, ['# 任务陈述卡:课后反馈', '## 四力', '## 当前替代方案', '## 候选方案覆盖', '## 证据情况', '## 规则检查']);
  assert.ok(md.includes('> 当 周日晚上,我想 整理一周笔记,以便 10 分钟内找到任何笔记。'));
  assert.ok(md.includes('〔假设〕'));
  assert.ok(md.includes('| 方案甲 | 推1;拉1 | 焦2 | 2/3 · 1/2 |'));
  assert.ok(md.includes('| 手打 | 0 | 40 分钟 | 漏发 |'));
});

test('公式防护:= + - @ 开头加单引号,单独的 - + 不加;CSV 与 Markdown 表格都生效', () => {
  assert.equal(C.guardCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(C.guardCell('+1'), "'+1");
  assert.equal(C.guardCell('-2'), "'-2");
  assert.equal(C.guardCell('@x'), "'@x");
  assert.equal(C.guardCell('-'), '-');
  assert.equal(C.guardCell('+'), '+');
  assert.equal(C.guardCell('普通'), '普通');
  const j = coverageJob();
  j.candidates[0].name = '=HYPERLINK("x")';
  j.alternatives = [{ id: 'a1', name: '@cmd', cost: '-', time: '', pain: '' }];
  const csv = C.toCsv(j);
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'));
  const md = C.toMarkdown(j);
  assert.ok(md.includes("| '@cmd | - |"));
  assert.ok(md.includes("'=HYPERLINK"));
});

test('CSV:表头、行数、逗号与引号转义、换行符', () => {
  const j = coverageJob();
  j.forces.push[0].text = '含,逗号和"引号"';
  const lines = C.toCsv(j).split('\r\n');
  assert.equal(lines.length, 4);
  assert.ok(lines[0].startsWith('候选方案,"推力:含,逗号和""引号"""'));
  assert.ok(lines[1].startsWith('方案甲,是,,是,,是,2,1'));
  assert.equal(lines[3], '');
});

test('validateImport:整份拒绝非法字段、重复 id、悬空引用、非 http 链接', () => {
  const good = clone(SAMPLE);
  assert.equal(C.validateImport(good).ok, true);
  assert.equal(C.validateImport(null).ok, false);
  assert.equal(C.validateImport({ app: 'other', version: 1, jobs: [] }).ok, false);
  const bad1 = clone(SAMPLE); bad1.jobs[0].situation = 123;
  assert.equal(C.validateImport(bad1).ok, false);
  const bad2 = clone(SAMPLE); bad2.jobs[1].id = bad2.jobs[0].id;
  assert.ok(C.validateImport(bad2).errors.some(e => e.includes('重复')));
  const bad3 = clone(SAMPLE); bad3.jobs[0].candidates[0].solves.push('nope');
  assert.ok(C.validateImport(bad3).errors.some(e => e.includes('nope')));
  const bad4 = clone(SAMPLE); bad4.jobs[0].forces.push[0].evidence[0].source = 'javascript:alert(1)';
  assert.ok(C.validateImport(bad4).errors.some(e => e.includes('http')));
  const ok5 = clone(SAMPLE); ok5.jobs[0].forces.push[0].evidence[0].source = 'https://example.com/a';
  assert.equal(C.validateImport(ok5).ok, true);
  const bad6 = clone(SAMPLE); bad6.jobs[0].forces.push[0].evidence[0].date = '2026-02-30';
  assert.equal(C.validateImport(bad6).ok, false);
  const bad7 = clone(SAMPLE); bad7.jobs[0].forces.inertia[0].evidence = [ev('z', 'data')];
  assert.equal(C.validateImport(bad7).ok, false);
  const bad8 = clone(SAMPLE); bad8.version = 2;
  assert.equal(C.validateImport(bad8).ok, false);
  const bad9 = clone(SAMPLE); bad9.currentId = 'ghost';
  assert.equal(C.validateImport(bad9).ok, false);
});

test('导出再导入往返不变;示例数据自身合法', () => {
  const s = clone(SAMPLE);
  const back = JSON.parse(C.exportJson(s));
  assert.equal(C.validateImport(back).ok, true);
  assert.deepEqual(back.jobs, s.jobs);
});

test('半成品与超长输入同样通过校验(写入校验 = 读取校验)', () => {
  const j = job({ situation: 'x'.repeat(300000), motivation: '' });
  j.forces.push = [item('p1', ''), item('p2', '半句')];
  j.alternatives = [{ id: 'a1', name: '', cost: '', time: '', pain: '' }];
  const st = state([j]);
  const reread = JSON.parse(JSON.stringify(st));
  assert.equal(C.validateState(st).ok, true);
  assert.equal(C.validateState(reread).ok, true);
});

test('多任务独立:改一个任务的数据不影响另一个', () => {
  const s = clone(SAMPLE);
  const [a, b] = s.jobs;
  const before = JSON.stringify(C.validateJob(b)) + JSON.stringify(C.evidenceStats(b)) + C.toCsv(b);
  a.forces.push.push(item('new1', '新增推力'));
  a.motivation = '';
  a.candidates = [];
  const after = JSON.stringify(C.validateJob(b)) + JSON.stringify(C.evidenceStats(b)) + C.toCsv(b);
  assert.equal(before, after);
  assert.equal(C.blankJob().forces.push !== C.blankJob().forces.push, true, '新任务不共享数组');
  assert.equal(C.validateJob(a).issues.some(i => i.code === 'empty-motivation'), true);
  assert.equal(C.validateJob(b).issues.some(i => i.code === 'empty-motivation'), false);
});

test('示例:任务二演示"动机写成方案"与阻力大于动力,任务一无阻断', () => {
  const [a, b] = SAMPLE.jobs;
  assert.equal(C.validateJob(a).issues.some(i => i.level === 'block'), false);
  assert.ok(C.validateJob(b).issues.some(i => i.code === 'solution-in-motivation'));
  assert.ok(C.validateJob(b).issues.some(i => i.code === 'resistance-ge-drive'));
  assert.ok(C.validateJob(b).issues.some(i => i.code === 'no-alternatives'));
});

test('resolveToday:合法日期通过,2026-02-30 与乱码回退真实今天', () => {
  const now = new Date(2026, 9, 5);
  assert.equal(C.resolveToday('?today=2026-10-20', now), '2026-10-20');
  assert.equal(C.resolveToday('?today=2024-02-29', now), '2024-02-29');
  for (const bad of ['?today=2026-02-30', '?today=2026-13-01', '?today=abc', '?today=2026-1-5', '', '?today=']) {
    assert.equal(C.resolveToday(bad, now), '2026-10-05', bad);
  }
  assert.equal(C.resolveToday(undefined, now), '2026-10-05');
});

test('原型键名不污染:任务标题为 __proto__ 也能校验和导出', () => {
  const j = job({ title: '__proto__' });
  j.forces.push = [item('constructor', 'c')];
  j.candidates = [{ id: 'k1', name: '__proto__', solves: ['constructor'], eases: [] }];
  assert.equal(C.validateState(state([j])).ok, true);
  const m = C.coverage(j);
  assert.equal(m.rows[0].solved, 1);
  assert.equal({}.polluted, undefined);
});

test('导入拒绝含特殊字符的 ID(双引号、括号、空格、空串、过长)', () => {
  for (const badId of ['"', 'a"]', 'a b', '', 'x'.repeat(101), '中文']) {
    const a = clone(SAMPLE); a.jobs[0].candidates[0].id = badId;
    assert.equal(C.validateImport(a).ok, false, 'candidate id ' + JSON.stringify(badId));
    const b = clone(SAMPLE); b.jobs[0].id = badId; b.currentId = badId;
    assert.equal(C.validateImport(b).ok, false, 'job id ' + JSON.stringify(badId));
  }
  const ok = clone(SAMPLE); ok.jobs[0].candidates[0].id = 'c-1_A';
  assert.equal(C.validateImport(ok).ok, true);
  assert.equal(C.validateState({ version: 1, jobs: [Object.assign(job(), { id: C.newId('j') })], currentId: null }).ok, true, 'newId 生成的 ID 合法');
});

test('导入拒绝正文为空的证据,空证据不能减少假设数量', () => {
  for (const text of ['', '   ', '\n\t']) {
    const s = clone(SAMPLE);
    s.jobs[0].forces.push[1].evidence = [{ id: 'ee1', type: 'data', text, source: '', date: '' }];
    const r = C.validateImport(s);
    assert.equal(r.ok, false, JSON.stringify(text));
    assert.ok(r.errors.some(e => e.includes('正文')));
  }
  const j = job();
  j.forces.push = [item('p1', 'a', [ev('e1', 'data', { text: ' ', source: '', date: '' })])];
  assert.equal(C.evidenceStats(j).assumptions, 1, '统计层也不把空证据算作有证据');
  assert.equal(C.isAssumption(j.forces.push[0]), true);
});

test('第五轮:forceRemovalImpact 列出条目内容、证据数与受影响候选数', () => {
  const j = job({
    forces: {
      push: [item('p1', '每周都漏发反馈', [ev('e1', 'interview'), ev('e2', 'data')]), item('p2', '另一条')],
      pull: [], inertia: [item('i1', '懒得改')], anxiety: [item('a1', '怕家长不回')]
    },
    candidates: [
      { id: 'c1', name: '模板', solves: ['p1'], eases: ['a1'] },
      { id: 'c2', name: '群发', solves: ['p1', 'p2'], eases: [] },
      { id: 'c3', name: '手写', solves: ['p2'], eases: [] }
    ]
  });
  const r = C.forceRemovalImpact(j, 'p1');
  assert.deepEqual(r, { kind: 'push', text: '每周都漏发反馈', evidence: 2, candidates: 2 });
  assert.deepEqual(C.forceRemovalImpact(j, 'a1'), { kind: 'anxiety', text: '怕家长不回', evidence: 0, candidates: 1 });
  assert.deepEqual(C.forceRemovalImpact(j, 'i1'), { kind: 'inertia', text: '懒得改', evidence: 0, candidates: 0 });
  assert.equal(C.forceRemovalImpact(j, 'nope'), null);
});

test('页签面板能被 hidden 真正隐藏:带 display 的面板类必须有 [hidden] 覆盖(否则切到别的页签后旧面板仍显示)', () => {
  const fs = require('node:fs'), path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].split(',').map(s => s.trim()), body: m[2] }));
  const setsDisplay = cls => rules.some(r => r.sel.includes('.' + cls) && /(^|[;\s])display\s*:\s*(?!none)/.test(r.body));
  const hideable = cls => rules.some(r => r.sel.some(s => s === '.' + cls + '[hidden]' || s === '[hidden]') && /display\s*:\s*none/.test(r.body));
  const panelClasses = [...html.matchAll(/<[a-z]+\b[^>]*\brole="tabpanel"[^>]*>/g)]
    .map(m => (m[0].match(/\bclass="([^"]*)"/) || [, ''])[1].split(/\s+/).filter(Boolean));
  assert.equal(panelClasses.length, 3, '应有 3 个页签面板(陈述/对比/导出)');
  const leaks = [...new Set(panelClasses.flat())].filter(c => setsDisplay(c) && !hideable(c));
  assert.deepEqual(leaks, [], '这些面板类设置了 display 却没有 .类[hidden]{display:none}:' + leaks.join(','));
});
