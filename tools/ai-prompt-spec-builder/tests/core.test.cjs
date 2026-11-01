'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

function full() {
  return {
    id: 'a1', title: '周报', tags: ['写作'], task: '我要写一份项目周报,给不了解细节的老板看',
    constraints: [{ kind: '长度', text: '不超过 500 字' }, { kind: '禁止项', text: '不要使用行话' }],
    criteria: [{ text: '每个结论附一个数字', check: '逐条数一遍' }],
    output: '标题 / 进展 / 风险', role: '项目经理', tone: '平实',
    createdAt: '2026-10-20', updatedAt: '2026-10-20'
  };
}
const codes = (s) => C.validateSpec(s).issues.map((i) => i.code);

test('任务句缺「给谁用」给出提示,写了就没有', () => {
  const s = full(); s.task = '写一份项目周报';
  assert.ok(codes(s).includes('task-no-audience'));
  assert.ok(!codes(full()).includes('task-no-audience'));
});

test('空规格:任务为空是 error,验收为空是 warn,不抛错', () => {
  const r = C.validateSpec(C.blankSpec('x', '2026-10-20'));
  const c = r.issues.map((i) => i.code);
  assert.ok(c.includes('task-empty') && c.includes('criteria-empty'));
  assert.equal(r.issues.find((i) => i.code === 'task-empty').level, 'error');
  assert.doesNotThrow(() => C.validateSpec(undefined));
  assert.doesNotThrow(() => C.buildPrompt(undefined));
});

test('模糊词检测:默认词表与自定义词表', () => {
  assert.deepEqual(C.vagueWords('要专业、高质量'), ['高质量', '专业']);
  assert.deepEqual(C.vagueWords('每段不超过 120 字'), []);
  assert.deepEqual(C.vagueWords('要接地气', ['接地气']), ['接地气']);
  assert.deepEqual(C.vagueWords('要专业', []), []);
});

test('验收标准含模糊词 => warn 且给改写示例;可观察标准则无', () => {
  const s = full(); s.criteria = [{ text: '回答要专业', check: '' }];
  const i = C.validateSpec(s).issues.find((x) => x.code === 'criteria-vague');
  assert.ok(i && i.level === 'warn' && i.suggestion.includes('例如'));
  assert.ok(!codes(full()).includes('criteria-vague'));
});

test('缺「如何检验」只是 info', () => {
  const s = full(); s.criteria = [{ text: '每段不超过 120 字', check: '' }];
  const i = C.validateSpec(s).issues.find((x) => x.code === 'criteria-no-check');
  assert.equal(i.level, 'info');
});

test('冲突检测:同一关键词既禁止又要求', () => {
  const cons = [{ kind: '禁止项', text: '不要使用表格' }, { kind: '格式', text: '输出一个汇总' }];
  const crit = [{ text: '用表格列出三个选项', check: '' }];
  const r = C.conflicts(cons, crit);
  assert.equal(r.length, 1);
  assert.equal(r[0].keyword, '表格');
  assert.equal(r[0].source, '验收标准');
  assert.ok(codes({ ...full(), constraints: cons, criteria: crit }).includes('conflict'));
});

test('冲突检测:无关词、以及自己也是禁止语气的验收,不误报', () => {
  assert.deepEqual(C.conflicts([{ kind: '禁止项', text: '不要使用表格' }], [{ text: '不出现表格', check: '' }]), []);
  assert.deepEqual(C.conflicts([{ kind: '禁止项', text: '行话' }], [{ text: '每段不超过 120 字', check: '' }]), []);
  assert.deepEqual(C.conflicts([], []), []);
});

test('总字数超过 1500 建议精简,恰好 1500 不提示', () => {
  const s = full(); s.task = '给老板看的' + 'a'.repeat(1495);
  assert.equal(C.totalChars({ ...s, constraints: [], criteria: [], output: '', role: '', tone: '' }), 1500);
  s.constraints = []; s.criteria = [{ text: '每段不超过 120 字', check: '' }]; s.output = ''; s.role = ''; s.tone = '';
  assert.ok(codes(s).includes('too-long'));
  s.criteria = []; assert.ok(!codes(s).includes('too-long'));
});

test('buildPrompt 分节与顺序', () => {
  const p = C.buildPrompt(full());
  const heads = p.split('\n').filter((l) => l.startsWith('## '));
  assert.deepEqual(heads, ['## 角色与语气', '## 任务', '## 限定', '## 验收', '## 输出格式', '## 交付前自检清单']);
  assert.ok(p.indexOf('不超过 500 字') > p.indexOf('## 限定') && p.indexOf('逐条数一遍') > p.indexOf('## 验收'));
  const noRole = full(); noRole.role = ''; noRole.tone = '';
  assert.equal(C.buildPrompt(noRole).split('\n')[0], '## 任务');
});

test('自检清单来自验收与禁止项', () => {
  const p = C.buildPrompt(full());
  const tail = p.slice(p.indexOf('## 交付前自检清单'));
  assert.ok(tail.includes('- [ ] 每个结论附一个数字') && tail.includes('没有触犯禁止项:不要使用行话'));
});

test('buildFirstRound 只含任务,不含限定与验收内容', () => {
  const f = C.buildFirstRound(full());
  assert.ok(f.includes('我要写一份项目周报'));
  for (const leak of ['不超过 500 字', '不要使用行话', '每个结论附一个数字', '标题 / 进展 / 风险', '项目经理']) assert.ok(!f.includes(leak), leak);
  assert.ok(f.includes('限定条件') && f.includes('验收标准') && f.includes('先不要给答案'));
});

test('模板:6 个,id 唯一,结构完整且互不共享引用', () => {
  const t = C.templates();
  assert.equal(t.length, 6);
  assert.deepEqual(t.map((x) => x.name), ['调研', '写稿', '代码评审', '数据分析', '翻译', '学习计划']);
  assert.equal(new Set(t.map((x) => x.id)).size, 6);
  for (const x of t) {
    assert.ok(x.spec.task && x.spec.constraints.length >= 3 && x.spec.criteria.length >= 3 && x.spec.output);
    assert.ok(x.spec.constraints.every((c) => C.KINDS.includes(c.kind)));
  }
  C.templates()[0].spec.constraints.push({ kind: '范围', text: 'x' });
  assert.equal(C.templates()[0].spec.constraints.length, t[0].spec.constraints.length);
});

test('search:多词 AND、标签、验收内容、大小写、空查询', () => {
  const a = full();
  const b = { ...full(), id: 'b', title: '翻译', tags: ['English'], task: 'translate this', criteria: [{ text: '术语统一', check: '' }] };
  const all = [a, b];
  assert.deepEqual(C.search(all, '').map((s) => s.id), ['a1', 'b']);
  assert.deepEqual(C.search(all, 'english').map((s) => s.id), ['b']);
  assert.deepEqual(C.search(all, '术语 翻译').map((s) => s.id), ['b']);
  assert.deepEqual(C.search(all, '术语 周报').map((s) => s.id), []);
  assert.deepEqual(C.search(all, '写作').map((s) => s.id), ['a1']);
});

test('标签分组用 Map,__proto__ 标签不出错', () => {
  const m = C.tagCounts([{ tags: ['__proto__', 'constructor'] }, { tags: ['__proto__'] }]);
  assert.equal(m.get('__proto__'), 2);
  assert.equal(m.get('constructor'), 1);
  assert.deepEqual(C.parseTags('a, b，a、 c\n'), ['a', 'b', 'c']);
});

test('CSV 公式防护:= + - @ 开头加单引号,单独的 - 或 + 不加', () => {
  const s = { ...full(), title: '=SUM(A1)', task: '@cmd', tags: ['-1+1'], output: '-', role: '+', tone: '+x' };
  s.constraints = [{ kind: '范围', text: '=1+1' }];
  s.criteria = [{ text: '-5 度', check: '' }];
  const csv = C.toCsv([s]);
  assert.ok(csv.includes("'=SUM(A1)") && csv.includes("'@cmd") && csv.includes("'-1+1") && csv.includes("'+x"));
  assert.ok(csv.includes("范围:'=1+1") && csv.includes("'-5 度"));
  assert.ok(!csv.includes("'-,") && !csv.includes("'+,"));
  assert.ok(C.guardFormula('-') === '-' && C.guardFormula('+') === '+' && C.guardFormula('正常') === '正常');
});

test('CSV 引号、逗号、换行正确转义', () => {
  const s = { ...full(), task: '他说"好",然后\n换行' };
  const csv = C.toCsv([s]);
  assert.ok(csv.includes('"他说""好"",然后\n换行"'));
  assert.equal(csv.split('\r\n')[0], '标题,标签,任务,限定条件,验收标准,输出结构,角色,语气,创建,更新');
});

test('特殊字符不破坏 Markdown:行首 # > 、围栏、分隔线被转义', () => {
  const s = full();
  s.task = '正常开头\n# 假标题\n> 引用\n```js\nalert(1)\n```\n---';
  s.constraints = [{ kind: '范围', text: '第一行\n## 假二级标题' }];
  s.title = '# 标题';
  const md = C.toMarkdown(s);
  const lines = md.split('\n');
  assert.equal(lines.filter((l) => l.startsWith('# ')).length, 1);
  assert.deepEqual(lines.filter((l) => l.startsWith('## ')), ['## 角色与语气', '## 任务', '## 限定', '## 验收', '## 输出格式', '## 交付前自检清单']);
  assert.ok(!lines.some((l) => l.startsWith('```') || l.startsWith('>') || l === '---'));
  assert.ok(md.includes('# 假标题') && md.includes('alert(1)'));
});

test('validateImport:合法、非法 JSON、类型、枚举、重复 ID、缺字段都按整份处理', () => {
  const ok = C.validateImport(C.toJson([full()]));
  assert.ok(ok.ok && ok.data.specs.length === 1);
  assert.ok(!C.validateImport('{bad').ok);
  assert.ok(!C.validateImport('[]').ok);
  assert.ok(!C.validateImport({ specs: 'x' }).ok);
  const dup = C.validateImport({ specs: [full(), full()] });
  assert.ok(!dup.ok && dup.errors.some((e) => e.includes('重复')));
  const badKind = full(); badKind.constraints = [{ kind: '随便', text: 'x' }];
  assert.ok(!C.validateImport({ specs: [full(), { ...badKind, id: 'z' }] }).ok);
  const badType = { ...full(), id: 'q', task: 5 };
  const r = C.validateImport({ specs: [badType] });
  assert.ok(!r.ok && r.errors.some((e) => e.includes('task')));
  assert.ok(!C.validateImport({ specs: [{ ...full(), tags: [1] }] }).ok);
  assert.ok(!C.validateImport({ specs: [{ ...full(), id: '' }] }).ok);
  assert.ok(!C.validateImport({ app: 'other', specs: [] }).ok);
  assert.ok(C.validateImport({ specs: [] }).ok);
});

test('写入校验 = 读取校验:半成品、超长、特殊字符保存后再读取仍通过', () => {
  const half = C.blankSpec('h', '2026-10-20');
  half.constraints = [{ kind: '范围', text: '' }];
  half.criteria = [{ text: '', check: '' }];
  const big = { ...full(), id: 'big', task: '长'.repeat(50000), title: '__proto__' };
  const stored = JSON.stringify({ specs: [half, big] });
  assert.ok(C.validateState({ specs: [half, big] }).ok);
  const back = C.validateImport(stored);
  assert.ok(back.ok && back.data.specs[1].task.length === 50000);
});

test('parseToday 严格校验,拒绝自动进位', () => {
  assert.equal(C.parseToday('2026-10-20'), '2026-10-20');
  assert.equal(C.parseToday('2026-02-30'), null);
  assert.equal(C.parseToday('2026-13-01'), null);
  assert.equal(C.parseToday('2026-1-1'), null);
  assert.equal(C.parseToday(null), null);
  assert.equal(C.parseToday('2024-02-29'), '2024-02-29');
});

test('导入拒绝非法日期,不再让公式字符串通过 createdAt/updatedAt', () => {
  for (const bad of ['=1+1', '', '2026-02-30', '2026-1-1', '@x']) {
    const r = C.validateImport({ specs: [{ ...full(), createdAt: bad }] });
    assert.ok(!r.ok && r.errors.some((e) => e.includes('createdAt')), 'createdAt=' + bad);
    const r2 = C.validateImport({ specs: [{ ...full(), updatedAt: bad }] });
    assert.ok(!r2.ok && r2.errors.some((e) => e.includes('updatedAt')), 'updatedAt=' + bad);
  }
  assert.ok(C.validateImport({ specs: [{ ...full(), createdAt: '2024-02-29' }] }).ok);
});

test('CSV 所有单元格统一做公式防护(含日期列)', () => {
  const csv = C.toCsv([{ ...full(), createdAt: '=1+1', updatedAt: '@x' }]);
  assert.ok(csv.includes("'=1+1") && csv.includes("'@x"));
  assert.ok(!/(^|,)=1\+1/.test(csv));
});

/* ---- 第五轮:按版本导出、外部备份严格校验 ---- */
test('toMarkdown 按版本导出:第一轮先问只含任务与先问说明,完整版含限定与验收', () => {
  const s = full();
  const fullMd = C.toMarkdown(s);
  const firstMd = C.toMarkdown(s, 'first');
  assert.equal(C.toMarkdown(s, 'full'), fullMd);
  assert.ok(fullMd.includes('## 限定') && fullMd.includes('## 验收'));
  assert.ok(firstMd.startsWith('# 周报'));
  assert.ok(firstMd.includes('这一轮先不要给答案') && firstMd.includes('## 任务'));
  assert.ok(!firstMd.includes('## 限定') && !firstMd.includes('## 验收') && !firstMd.includes('不超过 500 字'));
  assert.ok(firstMd.includes(C.buildFirstRound(s)));
});

test('validateImport 严格模式:外部备份必须带 app=ai-spec 与 version=1;内部存储格式仍可只含 specs', () => {
  const strict = { strict: true };
  assert.ok(C.validateImport(C.toJson([full()]), strict).ok);
  const noApp = C.validateImport({ version: 1, specs: [full()] }, strict);
  assert.ok(!noApp.ok && noApp.errors.some((e) => e.includes('app')));
  const noVer = C.validateImport({ app: 'ai-spec', specs: [full()] }, strict);
  assert.ok(!noVer.ok && noVer.errors.some((e) => e.includes('version')));
  assert.ok(!C.validateImport({ app: 'ai-spec', version: 2, specs: [] }, strict).ok);
  assert.ok(!C.validateImport({ specs: [] }, strict).ok);
  // 宽松模式(本机存档的内部格式)保持不变
  assert.ok(C.validateImport({ specs: [full()] }).ok);
  assert.ok(C.validateImport(JSON.stringify({ specs: [] })).ok);
});
