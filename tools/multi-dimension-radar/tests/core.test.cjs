'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');
require('../sample-data.js');

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !≈ ${b}`);
const clone = o => JSON.parse(JSON.stringify(o));
const theme = {
  bg: '#fff', text: '#111', muted: '#666', grid: '#ccc', font: '"PingFang SC",sans-serif',
  current: '#0a0', currentFill: 'rgba(0,160,0,0.2)', target: '#555', targetFill: 'rgba(0,0,0,0.05)',
  compare: '#b50', compareFill: 'rgba(180,80,0,0.1)', strokeThin: '1', strokeSeries: '2', dash: '6 4', vertexR: '4', labelSize: '14'
};

test('polygonPoints:点数等于维度数,第 0 维在正上方,半径随分数', () => {
  const pts = C.polygonPoints([100, 100, 100, 100], 200).split(' ');
  assert.equal(pts.length, 4);
  assert.equal(pts[0], '100,0');
  assert.equal(pts[1], '200,100');
  assert.equal(C.polygonPoints([50, 50, 50], 200).split(' ')[0], '100,50');
  assert.equal(C.polygonPoints([0, 0, 0], 200).split(' ').every(p => p === '100,100'), true);
});

test('polygonPoints:所有点落在 size 方框内且自然闭合(SVG polygon 不重复首点)', () => {
  const pts = C.vertices([100, 0, 55, 100, 30, 80, 10], 300);
  assert.equal(pts.length, 7);
  pts.forEach(p => { assert.ok(p.x >= 0 && p.x <= 300 && p.y >= 0 && p.y <= 300); });
});

test('area:全 50 与全 100 面积比例为 1/4,且与维度数无关', () => {
  for (const n of [3, 4, 6, 10]) {
    near(C.area(new Array(n).fill(50)) / C.area(new Array(n).fill(100)), 0.25);
  }
});

test('area:正六边形公式、旋转不变、不足 3 维为 0', () => {
  near(C.area(new Array(6).fill(100)), 1.5 * Math.sqrt(3) * 10000, 1e-6);
  near(C.area([10, 40, 70, 20]), C.area([40, 70, 20, 10]));
  assert.equal(C.area([100, 100]), 0);
  assert.ok(C.area([90, 10, 10, 10, 10, 10]) < C.area([50, 50, 50, 50, 50, 50]));
});

test('单维满分对照:用同一多边形公式,[100,0,0] 面积为 0(退化)', () => {
  assert.equal(C.area([100, 0, 0]), 0);
  for (const n of [3, 6, 10]) assert.equal(C.singleDimFullArea(n), 0);
  assert.ok(C.area([100, 1, 0]) > 0); // 只要有第二个维度,面积立刻大于 0
  near(C.areaRatio(new Array(5).fill(100)), 1);
  near(C.areaRatio(new Array(5).fill(50)), 0.25);
});

test('compareSingleVsMulti:单维竞争提示', () => {
  const h = C.compareSingleVsMulti([95, 20, 20, 20, 20, 20]);
  assert.equal(h.length, 1);
  assert.equal(h[0].kind, 'single');
  assert.match(h[0].text, /只有第一名有意义/);
});

test('compareSingleVsMulti:多维面积提示,且恰好 30 / 59 分的边界不误触发', () => {
  const m = C.compareSingleVsMulti([82, 78, 62, 30, 20, 10]);
  assert.deepEqual(m.map(x => x.kind), ['multi']);
  assert.deepEqual(C.compareSingleVsMulti([95, 30, 20, 20]).map(x => x.kind), []); // 30 不算 < 30
  assert.deepEqual(C.compareSingleVsMulti([60, 60, 59, 10]).map(x => x.kind), []);
  assert.deepEqual(C.compareSingleVsMulti([90, 85, 20, 20]).map(x => x.kind), []); // 两个 ≥80
});

test('allocate:总和严格等于 hours,差距 0 的维度得 0,按差距×权重比例', () => {
  const dims = [
    { name: 'a', current: 50, target: 50 },
    { name: 'b', current: 20, target: 60 },
    { name: 'c', current: 40, target: 60 }
  ];
  const r = C.allocate(dims, 6, [1, 1, 1]);
  assert.equal(r.rows[0].hours, 0);
  near(r.rows[1].hours, 4); near(r.rows[2].hours, 2);
  const sum = r.rows.reduce((s, x) => s + x.hours, 0);
  assert.equal(Math.round(sum * 100), 600);
  // 权重加倍改变分配
  const r2 = C.allocate(dims, 6, [1, 1, 4]);
  assert.ok(r2.rows[2].hours > r2.rows[1].hours);
});

test('allocate:难除尽的小时数用最大余数法仍然总和精确,全部无差距时不分配', () => {
  const dims = [1, 2, 3].map(i => ({ name: 'd' + i, current: 10, target: 10 + i * 7 }));
  for (const h of [7.25, 10, 0.07, 3.33]) {
    const r = C.allocate(dims, h, [1, 1, 1]);
    assert.equal(Math.round(r.rows.reduce((s, x) => s + x.hours, 0) * 100), Math.round(h * 100));
  }
  const none = C.allocate([{ name: 'x', current: 90, target: 80 }, { name: 'y', current: 5, target: 5 }, { name: 'z', current: 1, target: 1 }], 5, [1, 1, 1]);
  assert.equal(none.allocated, false);
  assert.ok(none.rows.every(r => r.hours === 0));
  assert.throws(() => C.allocate(dims, -1, [1, 1, 1]), RangeError);
  // 权重 0 的维度不分到时间
  assert.equal(C.allocate(dims, 5, [0, 1, 1]).rows[0].hours, 0);
});

test('allocate:三位以上小数的小时数不被舍入,合计精确等于 hours', () => {
  const dims = [1, 2, 3].map(i => ({ name: 'd' + i, current: 10, target: 10 + i * 7 }));
  for (const h of [0.001, 0.0005, 1.234, 2.0004, 12.3456789]) {
    const r = C.allocate(dims, h, [1, 1, 1]);
    const sc = Math.pow(10, C.decimalsOf(h));
    assert.equal(Math.round(r.rows.reduce((s, x) => s + x.hours, 0) * sc), Math.round(h * sc), String(h));
    assert.ok(r.rows.some(x => x.hours > 0), '不应全为 0:' + h);
    assert.equal(r.allocated, true);
  }
  assert.equal(C.decimalsOf(7.25), 2);
  assert.equal(C.decimalsOf(0.001), 3);
});

test('marginalArea:取相邻两维之和最大的维度', () => {
  const scores = [10, 90, 10, 80, 5, 5];
  // i=2 的邻居是 90 与 80;i=0 的邻居是 5 与 90
  const vals = scores.map((_, i) => C.marginalArea(scores, i));
  assert.equal(vals.indexOf(Math.max(...vals)), 2);
  near(C.marginalArea(scores, 2), 0.5 * Math.sin(Math.PI / 3) * 170);
  // 数值验证:+1 分的面积增量等于边际值(线性)
  const bumped = scores.slice(); bumped[2] += 1;
  near(C.area(bumped) - C.area(scores), C.marginalArea(scores, 2), 1e-9);
});

test('bestMarginal:只在有差距的维度中选,并列取靠前', () => {
  const dims = [
    { name: 'a', current: 10, target: 10 },
    { name: 'b', current: 90, target: 95 },
    { name: 'c', current: 10, target: 30 },
    { name: 'd', current: 80, target: 80 }
  ];
  // c 邻居是 90 与 80(最大),但 a/d 无差距不参与
  assert.equal(C.bestMarginal(dims).index, 2);
  assert.equal(C.bestMarginal([{ name: 'a', current: 5, target: 5 }, { name: 'b', current: 5, target: 5 }, { name: 'c', current: 5, target: 5 }]), null);
  const tie = C.bestMarginal([20, 20, 20, 20].map((v, i) => ({ name: 'n' + i, current: v, target: 50 })));
  assert.equal(tie.index, 0);
});

test('timeline:按日期升序,面积按各快照自己的分数计算', () => {
  const t = C.timeline([
    { date: '2026-10-02', scores: [{ name: 'a', score: 50 }, { name: 'b', score: 50 }, { name: 'c', score: 50 }] },
    { date: '2026-08-20', scores: [{ name: 'a', score: 10 }, { name: 'b', score: 10 }, { name: 'c', score: 10 }] },
    { date: '2026-09-18', scores: [{ name: 'a', score: 30 }, { name: 'b', score: 30 }, { name: 'c', score: 30 }] }
  ]);
  assert.deepEqual(t.map(p => p.date), ['2026-08-20', '2026-09-18', '2026-10-02']);
  assert.ok(t[0].area < t[1].area && t[1].area < t[2].area);
  near(t[2].area, C.area([50, 50, 50]));
});

test('monthCompare:本月取最新一条,上月跨年也能找到,缺失时不比较', () => {
  const pts = C.timeline(C.validateImport(globalThis.RADAR_SAMPLE).state.profiles[0].snapshots);
  const m = C.monthCompare(pts, '2026-10-20');
  assert.equal(m.thisPoint.date, '2026-10-02');
  assert.equal(m.lastPoint.date, '2026-09-18');
  assert.ok(m.comparable && m.delta > 0 && m.pct > 0);
  const jan = C.monthCompare([{ date: '2025-12-30', n: 3, area: 100 }, { date: '2026-01-05', n: 3, area: 150 }], '2026-01-31');
  assert.equal(jan.lastKey, '2025-12');
  near(jan.pct, 50);
  assert.equal(C.monthCompare(pts, '2026-12-01').comparable, false);
});

test('validateImport:维度数 <3 或 >10 拒绝,3 与 10 接受', () => {
  const mk = n => { const s = clone(globalThis.RADAR_SAMPLE); const p = s.profiles[0]; p.dims = Array.from({ length: n }, (_, i) => C.newDim('维' + i, 10, 20)); p.snapshots = []; return s; };
  assert.equal(C.validateImport(mk(2)).ok, false);
  assert.equal(C.validateImport(mk(11)).ok, false);
  assert.equal(C.validateImport(mk(3)).ok, true);
  assert.equal(C.validateImport(mk(10)).ok, true);
  assert.match(C.validateImport(mk(2)).errors.join(' '), /维度数/);
});

test('validateImport:分数越界、非数字、NaN 一律拒绝而不是修正', () => {
  for (const bad of [101, -1, '50', NaN, null, Infinity]) {
    const s = clone(globalThis.RADAR_SAMPLE); s.profiles[0].dims[0].current = bad;
    const r = C.validateImport(s);
    assert.equal(r.ok, false, String(bad));
  }
  const t = clone(globalThis.RADAR_SAMPLE); t.profiles[0].dims[1].target = 100.5;
  assert.equal(C.validateImport(t).ok, false);
  const edge = clone(globalThis.RADAR_SAMPLE); edge.profiles[0].dims[1].target = 100; edge.profiles[0].dims[1].current = 0;
  assert.equal(C.validateImport(edge).ok, true);
});

test('validateImport:名称重复(含首尾空白)、id 重复、非法快照日期、非法 JSON 拒绝', () => {
  const dup = clone(globalThis.RADAR_SAMPLE); dup.profiles[0].dims[1].name = ' 教学 ';
  assert.match(C.validateImport(dup).errors.join(' '), /重复/);
  const did = clone(globalThis.RADAR_SAMPLE); did.profiles[0].dims[1].id = did.profiles[0].dims[0].id;
  assert.equal(C.validateImport(did).ok, false);
  const pid = clone(globalThis.RADAR_SAMPLE); pid.profiles[1].id = pid.profiles[0].id;
  assert.equal(C.validateImport(pid).ok, false);
  const date = clone(globalThis.RADAR_SAMPLE); date.profiles[0].snapshots[0].date = '2026-02-30';
  assert.equal(C.validateImport(date).ok, false);
  assert.equal(C.validateImport('{oops').ok, false);
  const act = clone(globalThis.RADAR_SAMPLE); act.activeId = 'nope';
  assert.equal(C.validateImport(act).ok, false);
});

test('写读校验同源:合法状态经 JSON 往返后仍通过,包含边界值', () => {
  const s = clone(globalThis.RADAR_SAMPLE);
  s.profiles[0].dims[0].evidence = '长'.repeat(20000);
  s.profiles[0].dims[0].hours = 168;
  s.profiles[0].weeklyHours = 100000;
  s.profiles[0].dims[2].weight = 0;
  assert.equal(C.validateState(s).ok, true);
  const back = JSON.parse(JSON.stringify(s));
  assert.equal(C.validateState(back).ok, true);
  assert.equal(C.validateImport(JSON.stringify(s)).ok, true);
  assert.equal(C.validateState(C.emptyState()).ok, true);
  const fresh = C.emptyState(); const p = C.newProfile('新档案'); fresh.profiles.push(p); fresh.activeId = p.id;
  assert.equal(C.validateState(fresh).ok, true);
});

test('示例数据本身通过校验,且触发多维提示', () => {
  const r = C.validateImport(globalThis.RADAR_SAMPLE);
  assert.equal(r.ok, true, r.errors.join(';'));
  const p = r.state.profiles[0];
  assert.equal(p.dims.length, 6);
  assert.equal(p.snapshots.length, 3);
  assert.deepEqual(C.compareSingleVsMulti(p.dims.map(d => d.current)).map(h => h.kind), ['multi']);
  assert.deepEqual(C.compareSingleVsMulti(r.state.profiles[1].dims.map(d => d.current)).map(h => h.kind), ['single']);
});

test('toSvg:含 polygon 与图层标记,维度名与标签被转义,不能注入标签', () => {
  const evil = '<script>alert(1)</script>&"\'';
  const names = [evil, 'B', 'C'];
  const svg = C.toSvg({ names, layers: [{ key: 'current', label: '当前', scores: [80, 40, 60] }], size: 400 });
  assert.match(svg, /<polygon class="poly poly-current" data-layer="current" points="/);
  assert.equal(svg.includes('<script>'), false);
  assert.ok(svg.includes('&lt;script&gt;alert(1)&lt;/script&gt;&amp;&quot;&#39;'));
  assert.equal((svg.match(/class="vtx /g) || []).length, 3);
  const std = C.toSvg({ names, layers: [{ key: 'current', label: '当前', scores: [80, 40, 60] }, { key: 'target', label: '目标', scores: [90, 70, 80] }], standalone: true, theme, title: evil });
  assert.match(std, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.equal(std.includes('<script>'), false);
  assert.match(std, /<style>/);
  assert.ok((std.match(/<polygon class="poly /g) || []).length === 2);
  assert.throws(() => C.toSvg({ names, layers: [{ key: 'a" onload="x', label: 'x', scores: [1, 2, 3] }] }));
  assert.throws(() => C.toSvg({ names, layers: [{ key: 'current', label: 'x', scores: [1, 2] }] }));
  assert.throws(() => C.toSvg({ names, layers: [], standalone: true, theme: { ...theme, bg: 'red;}</style><script>' } }));
});

test('toCsv:公式防护只前缀 = + - @ 开头的用户字段,单独的 - 或 + 不加,含逗号引号换行被正确引用', () => {
  const p = { name: '=档案', dims: [
    { name: '+SUM(A1)', current: 10, target: 20, evidence: '@cmd', hours: 2, weight: 1 },
    { name: '-', current: 0, target: 0, evidence: '- 条目', hours: null, weight: 1 },
    { name: '带,逗号', current: 5, target: 5, evidence: '他说"好"\n第二行', hours: 0, weight: 0.5 }
  ] };
  const csv = C.toCsv(p);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], '档案,数据性质,维度,当前分,目标分,差距,每周小时,权重,证据');
  assert.ok(lines[1].startsWith("'=档案,自评,'+SUM(A1),10,20,10,2,1,'@cmd"));
  assert.ok(lines[2].startsWith("'=档案,自评,-,0,0,0,,1,'- 条目"));
  assert.ok(csv.includes('"带,逗号"') && csv.includes('"他说""好""\n第二行"'));
  assert.equal(C.csvCell('+'), '+');
  assert.equal(C.csvCell('@'), "'@");
});

test('todayFromSearch:合法日期采用,2026-02-30 / 乱码 / 缺失回退真实今天且不抛错', () => {
  const now = new Date(2030, 4, 6);
  assert.equal(C.todayFromSearch('?today=2026-10-20', now), '2026-10-20');
  assert.equal(C.todayFromSearch('?today=2024-02-29', now), '2024-02-29');
  for (const q of ['?today=2026-02-30', '?today=abc', '', '?x=1', '?today=2026-13-01', '?today=2025-02-29']) {
    assert.equal(C.todayFromSearch(q, now), '2030-05-06', q);
  }
});

test('timelineSvg:点数与折线,单点不画折线,空数组返回空串', () => {
  const pts = C.timeline(globalThis.RADAR_SAMPLE.profiles[0].snapshots);
  const svg = C.timelineSvg(pts);
  assert.equal((svg.match(/class="tl-dot"/g) || []).length, 3);
  assert.match(svg, /<polyline class="tl-line"/);
  assert.equal(C.timelineSvg([pts[0]]).includes('polyline'), false);
  assert.equal(C.timelineSvg([]), '');
});

test('cloneProfile 生成新 id、改名且不影响原档案;uniqueName 避让', () => {
  const src = globalThis.RADAR_SAMPLE.profiles[0];
  const c = C.cloneProfile(src, '副本');
  assert.notEqual(c.id, src.id);
  assert.notEqual(c.dims[0].id, src.dims[0].id);
  assert.equal(c.synthetic, false);
  c.dims[0].current = 1;
  assert.equal(src.dims[0].current, 82);
  assert.equal(C.uniqueName('教学', ['教学', '教学 2']), '教学 3');
  assert.equal(C.uniqueName('新', ['教学']), '新');
});

test('monthCompare:维度数相同但名称或顺序不同时不直接比较,并给出原因', () => {
  const sc = names => names.map((n, i) => ({ name: n, score: 40 + i }));
  const a = { date: '2026-09-10', n: 3, area: 100, scores: sc(['甲', '乙', '丙']) };
  const sameOrder = { date: '2026-10-10', n: 3, area: 120, scores: sc(['甲', '乙', '丙']) };
  const swapped = { date: '2026-10-10', n: 3, area: 120, scores: sc(['乙', '甲', '丙']) };
  const renamed = { date: '2026-10-10', n: 3, area: 120, scores: sc(['甲', '乙', '丁']) };
  assert.equal(C.monthCompare([a, sameOrder], '2026-10-20').comparable, true);
  const m1 = C.monthCompare([a, swapped], '2026-10-20');
  assert.equal(m1.comparable, false);
  assert.match(m1.reason, /顺序|名称/);
  assert.equal(C.monthCompare([a, renamed], '2026-10-20').comparable, false);
});

test('toCsv:合成示例档案在每一行标注数据性质,真实档案不标', () => {
  const syn = clone(globalThis.RADAR_SAMPLE).profiles[0];
  assert.equal(syn.synthetic, true);
  const lines = C.toCsv(syn).trim().split('\r\n');
  assert.match(lines[0], /数据性质/);
  assert.ok(lines.slice(1).every(l => l.includes('合成示例')));
  const real = C.newProfile('我自己');
  assert.ok(!C.toCsv(real).split('\r\n').slice(1).join('').includes('合成示例'));
});
