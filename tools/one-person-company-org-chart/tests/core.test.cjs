'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');
const SAMPLE = require('../sample-data.js');

const mk = (id, name, parentId, o) => Object.assign({
  id, name, duty: '', inputFrom: [], outputTo: [], trigger: { kind: 'manual', text: '' }, status: 'idea',
  interventions: ['none'], parentId, runningSince: '', weekly: 0
}, o);
const st = nodes => ({ version: 1, nodes, collapsed: [] });
const clone = o => JSON.parse(JSON.stringify(o));

test('buildTree:根唯一,示例树 12 个节点且根是「我」', () => {
  const t = C.buildTree(SAMPLE.nodes);
  assert.equal(t.error, undefined);
  assert.equal(t.node.name, '我');
  assert.equal(t.children.length, 4);
  assert.equal(C.buildTree([mk('a', 'A', null), mk('b', 'B', null)]).error.includes('唯一'), true);
  assert.match(C.buildTree([mk('a', 'A', 'b'), mk('b', 'B', 'a')]).error, /没有根节点/);
});

test('buildTree:上级不存在、自指、环路、id 重复都拒绝', () => {
  assert.match(C.buildTree([mk('a', 'A', null), mk('b', 'B', 'zzz')]).error, /上级不存在/);
  assert.match(C.buildTree([mk('a', 'A', null), mk('b', 'B', 'b')]).error, /指向自己/);
  assert.match(C.buildTree([mk('a', 'A', null), mk('b', 'B', 'c'), mk('c', 'C', 'b')]).error, /环路/);
  assert.match(C.buildTree([mk('a', 'A', null), mk('a', 'A2', 'a')]).error, /重复/);
  assert.ok(C.buildTree([]).error);
});

test('layout:同层 x 递增、任意两节点矩形不重叠、父节点居中于子节点', () => {
  const t = C.buildTree(SAMPLE.nodes);
  const L = C.layout(t, []);
  assert.equal(L.nodes.length, 12);
  assert.equal(L.links.length, 11);
  const byDepth = new Map();
  for (const n of L.nodes) { if (!byDepth.has(n.depth)) byDepth.set(n.depth, []); byDepth.get(n.depth).push(n.x); }
  for (const xs of byDepth.values()) for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1] + C.METRICS.nodeW - 1);
  for (let i = 0; i < L.nodes.length; i++) for (let j = i + 1; j < L.nodes.length; j++) {
    const a = L.nodes[i], b = L.nodes[j];
    const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    assert.equal(overlap, false, `${a.id} 与 ${b.id} 重叠`);
  }
  const root = L.nodes.find(n => n.depth === 0);
  const kids = L.nodes.filter(n => n.depth === 1);
  assert.equal(root.x, (kids[0].x + kids[kids.length - 1].x) / 2);
  assert.ok(L.width >= 7 * C.METRICS.nodeW);
});

test('layout:折叠子树后可见节点和连线都减少,并报告隐藏数量', () => {
  const t = C.buildTree(SAMPLE.nodes);
  const L = C.layout(t, ['n2']);
  assert.equal(L.nodes.length, 9);
  assert.equal(L.links.length, 8);
  const n2 = L.nodes.find(n => n.id === 'n2');
  assert.equal(n2.collapsed, true);
  assert.equal(n2.hidden, 3);
  assert.equal(C.visibleList(t, ['n2']).length, 9);
  assert.equal(C.layout(t, ['n1']).nodes.length, 1);
});

test('automationStats:在跑数、含干预点占比、每周干预合计(不含根)', () => {
  const s = C.automationStats(SAMPLE.nodes);
  assert.equal(s.total, 11);
  assert.equal(s.running, 7);
  assert.equal(s.withIntervention, 6);
  assert.ok(Math.abs(s.interventionRatio - 6 / 11) < 1e-9);
  assert.equal(s.weeklyTotal, 2 + 5 + 1 + 12 + 1 + 1);
  assert.deepEqual(C.automationStats([mk('a', '我', null)]), { total: 0, running: 0, byStatus: { idea: 0, configured: 0, running: 0, disabled: 0 }, withIntervention: 0, weeklyTotal: 0, runningRatio: 0, interventionRatio: 0 });
});

test('nextInterventionToRemove:校对 + 在跑 + 满 30 天才算,取最久的', () => {
  const r = C.nextInterventionToRemove(SAMPLE.nodes, '2026-10-20');
  assert.equal(r.name, '校对 Agent');
  assert.equal(r.days, 66);
  // 回复 Agent 只跑了 15 天,不是候选
  assert.equal(C.nextInterventionToRemove(SAMPLE.nodes.filter(n => n.id !== 'n4'), '2026-10-20'), null);
  const base = [mk('r', '我', null), mk('a', 'A', 'r', { status: 'running', interventions: ['proofread'], runningSince: '2026-09-20' })];
  assert.equal(C.nextInterventionToRemove(base, '2026-10-19'), null);           // 29 天
  assert.equal(C.nextInterventionToRemove(base, '2026-10-20').days, 30);         // 恰好 30 天
  base[1].interventions = ['approve'];
  assert.equal(C.nextInterventionToRemove(base, '2026-12-01'), null);            // 不是校对
  base[1].interventions = ['proofread']; base[1].status = 'configured';
  assert.equal(C.nextInterventionToRemove(base, '2026-12-01'), null);            // 没在跑
  base[1].status = 'running'; base[1].runningSince = '';
  assert.equal(C.nextInterventionToRemove(base, '2026-12-01'), null);            // 没填起始日
  assert.equal(C.nextInterventionToRemove(base, 'bad'), null);
});

test('flowIssues:示例恰有一个「产出没人用」和一个环路,没有阻断', () => {
  const is = C.flowIssues(SAMPLE.nodes);
  assert.equal(is.filter(i => i.kind === 'no-receiver').length, 1);
  assert.match(is.find(i => i.kind === 'no-receiver').message, /记账 Agent.*产出没人用/);
  const cyc = is.filter(i => i.kind === 'cycle');
  assert.equal(cyc.length, 1);
  assert.deepEqual(cyc[0].nodeIds.sort(), ['n7', 'n8']);
  assert.equal(cyc[0].level, 'info');
  assert.equal(C.hasBlock(is), false);
});

test('flowIssues:输入来源 / 输出对象不存在 → 阻断且排在最前', () => {
  const nodes = clone(SAMPLE.nodes);
  nodes.find(n => n.id === 'n4').inputFrom.push('ghost');
  nodes.find(n => n.id === 'n5').outputTo.push('ghost2');
  const is = C.flowIssues(nodes);
  assert.equal(is[0].level, 'block');
  assert.equal(is.filter(i => i.kind === 'missing-source').length, 1);
  assert.equal(is.filter(i => i.kind === 'missing-target').length, 1);
  assert.equal(C.hasBlock(is), true);
});

test('flowIssues:只在一侧声明的连线也算接收;部门(有下级)不要求输出;长环也能找到', () => {
  const nodes = [mk('r', '我', null), mk('d', '部门', 'r'), mk('a', 'A', 'd', { outputTo: ['b'] }), mk('b', 'B', 'd'), mk('c', 'C', 'd', { inputFrom: ['b'] })];
  // a->b(a 声明), b->c(c 声明), c 无出口
  const is = C.flowIssues(nodes);
  assert.deepEqual(is.map(i => i.kind), ['no-receiver']);
  assert.deepEqual(is[0].nodeIds, ['c']);
  const ring = [mk('r', '我', null), mk('a', 'A', 'r', { outputTo: ['b'] }), mk('b', 'B', 'r', { outputTo: ['c'] }), mk('c', 'C', 'r', { outputTo: ['a'] })];
  const cyc = C.flowIssues(ring).filter(i => i.kind === 'cycle');
  assert.equal(cyc.length, 1);
  assert.equal(cyc[0].nodeIds.length, 3);
});

test('toAgentMarkdown:每个节点(含根)恰好一段 AGENT.md,目录树按层级缩进', () => {
  const md = C.toAgentMarkdown(SAMPLE.nodes);
  const heads = md.split('\n').filter(l => /^#{2,6} .*\/AGENT\.md$/.test(l));
  assert.equal(heads.length, SAMPLE.nodes.length);   // 每个节点(含根)一段
  assert.ok(heads.includes('## 我/AGENT.md'));
  assert.ok(heads.includes('### 我/内容部/AGENT.md'));
  assert.ok(heads.includes('#### 我/内容部/写作 Agent/AGENT.md'));
  const lines = md.split('\n');
  const indent = name => lines.find(l => l.trim() === `- ${name}`)?.search(/\S/);
  assert.equal(indent('我/AGENT.md'), 0);
  assert.equal(indent('内容部/AGENT.md'), 2);
  assert.equal(indent('写作 Agent/AGENT.md'), 4);
  assert.match(md, /- 输入:来自「写作 Agent」/);
  assert.match(md, /- 人工干预点:付款/);
  assert.match(md, /定时\(每天 8:00\(0 8 \* \* \*\)\)/);
  assert.equal(C.toAgentMarkdown([]), '');
});

test('toAgentMarkdown:名字里的斜杠、换行、反引号不会破坏结构;同级重名加后缀', () => {
  const nodes = [mk('r', '我', null), mk('a', 'x/y\n## 假标题', 'r', { duty: '含 ``` 围栏\n第二行' }), mk('b', 'dup', 'r'), mk('c', 'dup', 'r')];
  const md = C.toAgentMarkdown(nodes);
  assert.ok(md.includes('我/x_y ## 假标题/AGENT.md'));
  assert.ok(md.includes('我/dup/AGENT.md') && md.includes('我/dup-2/AGENT.md'));
  assert.ok(md.includes('````markdown'), '正文含三个反引号时外层围栏要更长');
  assert.equal(/^## 假标题/m.test(md), false);
});

test('toSvg:节点数和连线数与布局一致,折叠后减少,用户文本被转义', () => {
  const count = (s, re) => (s.match(re) || []).length;
  const all = C.toSvg(SAMPLE.nodes);
  assert.equal(count(all, /class="org-node"/g), 12);
  assert.equal(count(all, /class="org-link"/g), 11);
  const folded = C.toSvg(SAMPLE.nodes, { collapsed: ['n2'] });
  assert.equal(count(folded, /class="org-node"/g), 9);
  assert.ok(folded.includes('(+3)'));
  const evil = [mk('r', '我', null), mk('a', '<b>&"x', 'r', { duty: '</title><b>' })];
  const svg = C.toSvg(evil);
  assert.equal(svg.includes('<b>&'), false);
  assert.ok(svg.includes('&lt;b&gt;&amp;&quot;x'));
  assert.ok(C.toSvg([mk('r', '我', null), mk('a', '一二三四五六七八九十甲乙', 'r')]).includes('一二三四五六七八…'));
  assert.equal(svg.includes('</title><b>'), false);
  assert.equal(C.toSvg([]), '');
});

test('toCsv:公式防护(= + - @ 开头加单引号,单独的 - + 不加),逗号引号换行转义', () => {
  const nodes = [mk('r', '我', null), mk('a', '=cmd|x', 'r', { duty: '+1+1' }), mk('b', '-', 'r', { duty: '@SUM(A1)' }), mk('c', '+', 'r', { duty: 'say "hi", ok\nnext' }), mk('d', '-5', 'r')];
  const csv = C.toCsv(nodes);
  const rows = csv.trim().split('\r\n');
  assert.equal(rows[0].split(',')[1], '岗位');
  assert.ok(rows[2].startsWith("a,'=cmd|x,我,'+1+1,"));
  assert.ok(rows[3].startsWith('b,-,我,\'@SUM(A1),'));
  assert.ok(csv.includes('c,+,我,"say ""hi"", ok\nnext"'));
  assert.ok(rows.some(r => r.startsWith("d,'-5,")));
  assert.equal(C.guard('-'), '-');
  assert.equal(C.guard('-a'), "'-a");
  assert.equal(C.guard('普通'), '普通');
});

test('validateState:示例通过;状态枚举 / 干预点 / 日期 / 数字 / 类型各自被拒', () => {
  assert.equal(C.validateState(SAMPLE).ok, true);
  assert.equal(C.validateState(C.emptyState()).ok, true);
  const bad = fn => { const s = clone(SAMPLE); fn(s); return C.validateState(s); };
  assert.match(bad(s => { s.nodes[2].status = 'broken'; }).error, /状态/);
  assert.match(bad(s => { s.nodes[2].interventions = ['none', 'pay']; }).error, /无/);
  assert.match(bad(s => { s.nodes[2].interventions = []; }).error, /至少选一项/);
  assert.match(bad(s => { s.nodes[2].interventions = ['x']; }).error, /干预点/);
  assert.match(bad(s => { s.nodes[2].runningSince = '2026-02-30'; }).error, /日期/);
  assert.match(bad(s => { s.nodes[2].weekly = -1; }).error, /整数/);
  assert.match(bad(s => { s.nodes[2].weekly = 1.5; }).error, /整数/);
  assert.match(bad(s => { s.nodes[2].weekly = C.WEEKLY_MAX + 1; }).error, /整数/);
  assert.match(bad(s => { s.nodes[2].weekly = '3'; }).error, /整数/);
  assert.match(bad(s => { s.nodes[2].parentId = 'nope'; }).error, /上级不存在/);
  assert.match(bad(s => { s.nodes[2].parentId = s.nodes[2].id; }).error, /自己/);
  assert.match(bad(s => { s.nodes[8].id = s.nodes[6].id; }).error, /重复/);
  assert.match(bad(s => { s.nodes[2].id = 'bad id!'; }).error, /id/);
  assert.match(bad(s => { s.nodes[2].name = '   '; }).error, /岗位名/);
  assert.match(bad(s => { s.nodes[2].trigger = { kind: 'weekly', text: '' }; }).error, /触发/);
  assert.match(bad(s => { s.nodes[2].inputFrom = [s.nodes[2].id]; }).error, /不能是自己/);
  assert.match(bad(s => { s.nodes[2].url = 1; s.collapsed = [1]; }).error, /collapsed/);
  assert.match(bad(s => { s.version = 2; }).error, /版本/);
  assert.match(bad(s => { s.nodes.push(clone(s.nodes[0])); s.nodes[12].id = 'n99'; }).error, /根节点必须唯一/);
  assert.equal(C.validateState(null).ok, false);
  assert.equal(C.validateState([]).ok, false);
});

test('写读校验同源:serialize → validateImport 往返相同;非法 JSON 与非法内容整份拒绝', () => {
  const s = clone(SAMPLE);
  s.nodes[4].duty = 'x'.repeat(5000);       // 超长文本
  s.nodes[4].weekly = C.WEEKLY_MAX;          // 边界值
  s.collapsed = ['n2'];
  const w = C.validateState(s);
  const r = C.validateImport(C.serialize(s));
  assert.equal(w.ok, true);
  assert.equal(r.ok, true);
  assert.deepEqual(r.state.nodes, s.nodes);
  assert.deepEqual(r.state.collapsed, ['n2']);
  const broken = clone(s); broken.nodes[1].status = 'zzz';
  assert.deepEqual(C.validateImport(JSON.stringify(broken)).ok, C.validateState(broken).ok);
  assert.equal(C.validateImport(JSON.stringify(broken)).ok, false);
  assert.equal(C.validateImport('{oops').ok, false);
  assert.equal(C.validateImport('[]').ok, false);
});

test('?today:合法日期通过,非法 / 自动进位 / 缺失回退', () => {
  assert.equal(C.resolveToday('?today=2026-10-20', '2000-01-01'), '2026-10-20');
  assert.equal(C.resolveToday('?x=1&today=2026-02-30', '2000-01-01'), '2000-01-01');
  assert.equal(C.resolveToday('?today=2026-13-01', '2000-01-01'), '2000-01-01');
  assert.equal(C.resolveToday('?today=abc', '2000-01-01'), '2000-01-01');
  assert.equal(C.resolveToday('', '2000-01-01'), '2000-01-01');
  assert.equal(C.resolveToday('?today=2024-02-29', 'f'), '2024-02-29');
  assert.equal(C.resolveToday('?today=2025-02-29', 'f'), 'f');
  assert.equal(C.daysBetween('2026-02-28', '2026-03-01'), 1);
});

test('removeNode:有下级拒绝;删除后清理其他节点对它的引用并计数;根节点只能最后删', () => {
  assert.match(C.removeNode(SAMPLE.nodes, 'n2').error, /下级/);
  assert.match(C.removeNode(SAMPLE.nodes, 'n1').error, /下级/);
  const r = C.removeNode(SAMPLE.nodes, 'n4');
  assert.equal(r.nodes.length, 11);
  assert.equal(r.scrubbed, 2);   // 写作.outputTo 与 发布.inputFrom
  assert.deepEqual(r.nodes.find(n => n.id === 'n3').outputTo, []);
  assert.equal(C.removeNode([mk('r', '我', null)], 'r').nodes.length, 0);
  assert.match(C.removeNode([mk('r', '我', null), mk('a', 'A', 'r')], 'r').error, /下级/);
  assert.equal(C.nextId(SAMPLE.nodes), 'n13');
  assert.ok(C.descendantIds(SAMPLE.nodes, 'n2').has('n3'));
  assert.equal(C.descendantIds(SAMPLE.nodes, 'n2').has('n6'), false);
});

test('toAgentMarkdown:同级 dup、dup、dup-2、dup 的最终路径全部唯一', () => {
  const nodes = [mk('r', '我', null), mk('a', 'dup', 'r'), mk('b', 'dup', 'r'), mk('c', 'dup-2', 'r'), mk('d', 'dup', 'r')];
  const paths = C.toAgentMarkdown(nodes).split('\n').filter(l => /^#{2,6} .*\/AGENT\.md$/.test(l));
  assert.equal(paths.length, 5);
  assert.equal(new Set(paths).size, 5, paths.join(' | '));
  assert.ok(paths.some(p => p.endsWith('/dup-3/AGENT.md')));
});

test('missingRefs:找出节点里指向不存在节点的引用,用于让界面显示并可删除', () => {
  const nodes = clone(SAMPLE.nodes);
  nodes[3].inputFrom.push('ghost');
  nodes[3].outputTo.push('ghost2');
  assert.deepEqual(C.missingRefs(nodes, nodes[3]), { inputFrom: ['ghost'], outputTo: ['ghost2'] });
  nodes[3].inputFrom = nodes[3].inputFrom.filter(x => x !== 'ghost');
  nodes[3].outputTo = nodes[3].outputTo.filter(x => x !== 'ghost2');
  assert.equal(C.hasBlock(C.flowIssues(nodes)), false);
  assert.equal(C.toAgentMarkdown(nodes) !== '', true);
});

test('referencesTo:列出引用某节点的其他节点及引用处数,删除确认用', () => {
  const nodes = [mk('a', 'A', null, { outputTo: ['b'] }), mk('b', 'B', 'a', { inputFrom: ['a'], outputTo: ['c'] }), mk('c', 'C', 'a', { inputFrom: ['b', 'a'] })];
  assert.deepEqual(C.referencesTo(nodes, 'b'), [{ id: 'a', name: 'A', count: 1 }, { id: 'c', name: 'C', count: 1 }]);
  assert.deepEqual(C.referencesTo(nodes, 'c'), [{ id: 'b', name: 'B', count: 1 }]);
  assert.deepEqual(C.referencesTo(nodes, 'zzz'), []);
  assert.equal(C.referencesTo(nodes, 'a').reduce((s, r) => s + r.count, 0), 2);
});

test('sample 标记:必须是布尔值,往返保留,缺省为 false', () => {
  assert.equal(C.emptyState().sample, false);
  assert.equal(C.validateState({ version: 1, nodes: [], collapsed: [], sample: 'yes' }).ok, false);
  assert.equal(C.validateState({ version: 1, nodes: [], collapsed: [], sample: true }).ok, true);
  const s = Object.assign(clone(SAMPLE), { sample: true });
  assert.equal(JSON.parse(C.serialize(s)).sample, true);
  assert.equal(C.validateImport(C.serialize(s)).state.sample, true);
  assert.equal(JSON.parse(C.serialize(Object.assign(clone(SAMPLE), { sample: undefined }))).sample, false);
});

test('合成示例在 CSV、Markdown 骨架、SVG 导出里标注,真实数据不标', () => {
  const nodes = clone(SAMPLE.nodes);
  const csv = C.toCsv(nodes, { sample: true }).trim().split('\r\n');
  assert.match(csv[0], /数据性质$/);
  assert.ok(csv.slice(1).every(l => l.endsWith('合成示例')));
  assert.ok(!C.toCsv(nodes).includes('合成示例'));
  assert.match(C.toAgentMarkdown(nodes, { sample: true }), /合成示例/);
  assert.ok(!C.toAgentMarkdown(nodes).includes('合成示例'));
  assert.match(C.toSvg(nodes, { sample: true }), /合成示例/);
  assert.ok(!C.toSvg(nodes).includes('合成示例'));
});
