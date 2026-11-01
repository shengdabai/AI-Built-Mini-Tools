'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const cl = (o = {}) => ({ id: 'c' + Math.random(), text: '断言', type: '事实', checkability: '可查', status: '未核', evidenceText: '', evidenceUrl: '', note: '', ...o });
const task = (o = {}) => ({ id: 't1', question: '问', answer: '答', model: 'M', date: '2026-10-20', claims: [], rounds: [], ...o });

test('splitClaims 按句号/换行粗拆,不拆小数点,不丢短句', () => {
  assert.deepEqual(C.splitClaims('甲在1990年成立。圆周率约3.14!乙\n丙; 丁'), ['甲在1990年成立', '圆周率约3.14', '乙', '丙', '丁']);
  assert.deepEqual(C.splitClaims('Hello world. Next one'), ['Hello world', 'Next one']);
  assert.deepEqual(C.splitClaims('是。'), ['是']);
  assert.deepEqual(C.splitClaims(' \n 。。 '), []);
  assert.deepEqual(C.splitClaims(null), []);
});

test('枚举:类型/可核实性/状态', () => {
  assert.deepEqual(C.TYPES, ['事实', '数字', '引用', '推断', '建议']);
  assert.deepEqual(C.CHECKS, ['可查', '需实验', '无法核实']);
  assert.deepEqual(C.STATUSES, ['未核', '已核实', '有误', '存疑']);
  assert.equal(C.validateClaim(cl()).ok, true);
  for (const bad of [{ type: '观点' }, { checkability: '随便' }, { status: 'verified' }, { text: 5 }, { id: '' }]) {
    assert.equal(C.validateClaim(cl(bad)).ok, false, JSON.stringify(bad));
  }
  assert.equal(C.validateClaim(null).ok, false);
});

test('answerStatus:未核实的事实类 → 不可引用', () => {
  const r = C.answerStatus([cl({ status: '已核实' }), cl({ type: '数字', status: '存疑' })]);
  assert.equal(r.status, '不可引用');
  assert.equal(r.verifyRate, 0.5);
});

test('answerStatus:有误 ≥ 1 → 需修正(优先于不可引用)', () => {
  const r = C.answerStatus([cl({ status: '有误' }), cl({ type: '引用' })]);
  assert.equal(r.status, '需修正');
  assert.ok(r.reasons.some(x => x.includes('尚未核实')));
});

test('answerStatus:全部可查断言已核实 → 可引用;推断类未核实只到核实中', () => {
  assert.equal(C.answerStatus([cl({ status: '已核实' }), cl({ type: '建议', checkability: '需实验', status: '已核实' })]).status, '可引用');
  assert.equal(C.answerStatus([cl({ status: '已核实' }), cl({ type: '推断', status: '未核' })]).status, '核实中');
});

test('answerStatus:无法核实不计入分母,但在 reasons 与计数里单列', () => {
  const r = C.answerStatus([cl({ status: '已核实' }), cl({ checkability: '无法核实', type: '事实', status: '未核' })]);
  assert.equal(r.status, '可引用');
  assert.equal(r.verifyRate, 1);
  assert.equal(r.counts.unverifiable, 1);
  assert.ok(r.reasons.some(x => x.includes('无法核实')));
});

test('answerStatus:核实率除零与空任务', () => {
  const e = C.answerStatus([]);
  assert.equal(e.status, '待拆断言');
  assert.equal(e.verifyRate, null);
  const only = C.answerStatus([cl({ checkability: '无法核实' })]);
  assert.equal(only.verifyRate, null);
  assert.equal(only.status, '核实中');
  assert.equal(C.answerStatus(undefined).status, '待拆断言');
});

test('probePrompt:三模板均含上下文', () => {
  const ctx = { question: '谁发明了X', answer: 'Y 在 1990 年发明', model: '模型Z', claimIndex: 2, claimText: 'Y 在 1990 年发明', otherAnswer: '另一个答案文本' };
  const a = C.probePrompt('self', ctx);
  assert.ok(a.includes('最可能错的三处') && a.includes('谁发明了X') && a.includes('Y 在 1990 年发明'));
  const b = C.probePrompt('improve', ctx);
  assert.ok(b.includes('保留结论,只修正第 2 条断言') && b.includes('Y 在 1990 年发明'));
  const c = C.probePrompt('cross', ctx);
  assert.ok(c.includes('模型 A(模型Z)') && c.includes('逐条指出错误并给来源') && c.includes('另一个答案文本'));
  assert.throws(() => C.probePrompt('nope', ctx));
  assert.ok(C.probePrompt('improve', {}).includes('第 N 条断言'));
});

test('roundStats:按轮次排序、汇总修正数与各模板次数', () => {
  const s = C.roundStats([
    { id: 'b', n: 2, kind: 'cross', summary: '', fixed: 1 },
    { id: 'a', n: 1, kind: 'self', summary: '', fixed: 3 },
    { id: 'c', n: 3, kind: 'self', summary: '', fixed: 0 },
  ]);
  assert.equal(s.count, 3);
  assert.equal(s.totalFixed, 4);
  assert.deepEqual(s.perRound.map(r => r.n), [1, 2, 3]);
  assert.deepEqual(s.byKind.self, { rounds: 2, fixed: 3 });
  assert.deepEqual(s.byKind.improve, { rounds: 0, fixed: 0 });
  assert.equal(C.roundStats([]).count, 0);
});

test('modelStats:跨任务按模型汇总错误率;__proto__ 模型名安全', () => {
  const ts = [
    task({ model: 'A', claims: [cl({ status: '有误' }), cl({ status: '已核实' }), cl({ status: '未核' })] }),
    task({ id: 't2', model: ' A ', claims: [cl({ status: '已核实' }), cl({ status: '已核实' })] }),
    task({ id: 't3', model: '__proto__', claims: [cl({ status: '有误' })] }),
    task({ id: 't4', model: '', claims: [cl({ status: '未核' })] }),
  ];
  const s = C.modelStats(ts);
  const a = s.find(x => x.model === 'A');
  assert.equal(a.tasks, 2); assert.equal(a.claims, 5);
  assert.equal(a.errorRate, 1 / 4);
  assert.equal(s.find(x => x.model === '__proto__').errorRate, 1);
  assert.equal(s.find(x => x.model === C.NO_MODEL).errorRate, null);
  assert.equal(s[0].model, '__proto__');
  assert.deepEqual(C.modelStats([]), []);
});

test('URL 校验:拒绝 javascript:/data:,接受 http(s)', () => {
  assert.equal(C.isHttpUrl('https://example.com/a?b=1'), true);
  assert.equal(C.isHttpUrl('http://example.com'), true);
  for (const u of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x.com', 'example.com', 'https://a b.com', '']) assert.equal(C.isHttpUrl(u), false, u);
  assert.equal(C.validateClaim(cl({ evidenceUrl: 'javascript:alert(1)' })).ok, false);
  assert.equal(C.validateClaim(cl({ evidenceUrl: 'https://example.com' })).ok, true);
});

test('toMarkdown:结构、无法核实单列、管道符转义、轮次表', () => {
  const t = task({
    claims: [cl({ text: 'a|b', status: '已核实', evidenceText: '来源', evidenceUrl: 'https://example.com' }), cl({ text: '不可知', checkability: '无法核实' })],
    rounds: [{ id: 'r1', n: 1, kind: 'self', summary: '改了两处', fixed: 2 }],
  });
  const md = C.toMarkdown(t);
  assert.match(md, /^# AI 答案核实报告/);
  assert.ok(md.includes('## 结论状态:可引用'));
  assert.ok(md.includes('| # | 断言 | 类型 | 可核实性 | 状态 | 证据 | 备注 |'));
  assert.ok(md.includes('a\\|b'));
  assert.ok(md.includes('来源 https://example.com'));
  assert.ok(/## 无法核实的断言[\s\S]*第 2 条:不可知/.test(md));
  assert.ok(md.includes('| 第 1 轮 | 自我批判 | 2 | 改了两处 |'));
  assert.ok(md.includes('核实率:100%'));
});

test('公式防护:CSV 与 Markdown 对 = + - @ 开头加单引号,单独 - / + 不算', () => {
  assert.equal(C.guard('=1+1'), "'=1+1");
  assert.equal(C.guard('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(C.guard('-5'), "'-5");
  assert.equal(C.guard('+cmd'), "'+cmd");
  assert.equal(C.guard('-'), '-');
  assert.equal(C.guard('+'), '+');
  assert.equal(C.guard('正常'), '正常');
  const t = task({ question: '=HYPERLINK("x")', claims: [cl({ text: '-2+3', note: '@a' })] });
  const csv = C.toCsv([t]);
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(csv.includes("'-2+3") && csv.includes("'@a"));
  assert.ok(C.toMarkdown(t).includes("| 1 | '-2+3 |"));
});

test('toCsv:表头、引号/逗号/换行转义、空任务只有表头', () => {
  const csv = C.toCsv([task({ claims: [cl({ text: 'a,"b"\nc' })] })]);
  const lines = csv.split('\r\n');
  assert.ok(lines[0].startsWith('任务ID,问题,模型'));
  assert.ok(csv.includes('"a,""b""\nc"'));
  assert.equal(C.toCsv([task()]).trim().split('\r\n').length, 1);
});

test('validateImport:合法备份通过;类型/枚举/重复 id/坏 URL 整份拒绝', () => {
  const good = { app: 'answer-check', version: 1, currentId: 't1', tasks: [task({ claims: [cl({ id: 'c1' })], rounds: [{ id: 'r1', n: 1, kind: 'self', summary: 's', fixed: 0 }] })] };
  const ok = C.validateImport(JSON.stringify(good));
  assert.equal(ok.ok, true);
  assert.equal(ok.tasks[0].claims.length, 1);
  const mut = fn => { const g = JSON.parse(JSON.stringify(good)); fn(g); return C.validateImport(g); };
  assert.equal(mut(g => { g.tasks[0].claims[0].type = '观点'; }).ok, false);
  assert.equal(mut(g => { g.tasks[0].claims[0].evidenceUrl = 'javascript:alert(1)'; }).ok, false);
  assert.equal(mut(g => { g.tasks.push(JSON.parse(JSON.stringify(g.tasks[0]))); }).ok, false);
  assert.equal(mut(g => { g.tasks[0].claims.push({ ...g.tasks[0].claims[0] }); }).ok, false);
  assert.equal(mut(g => { g.tasks[0].rounds[0].fixed = -1; }).ok, false);
  assert.equal(mut(g => { g.tasks[0].rounds[0].kind = 'x'; }).ok, false);
  assert.equal(mut(g => { g.tasks[0].date = '2026-02-30'; }).ok, false);
  assert.equal(mut(g => { g.currentId = 'nope'; }).ok, false);
  assert.equal(mut(g => { g.app = 'other'; }).ok, false);
  assert.equal(C.validateImport('{bad').ok, false);
  assert.equal(C.validateImport(null).ok, false);
  // 坏数据只在一个任务里也要整份拒绝
  const two = { ...good, tasks: [good.tasks[0], { ...task({ id: 't2' }), claims: [cl({ id: 'c9', status: 'x' })] }] };
  const r = C.validateImport(two);
  assert.equal(r.ok, false);
  assert.equal(r.tasks, undefined);
});

test('写入校验 = 读取校验:半成品与超长/超大边界值经 JSON 往返仍通过', () => {
  const big = 'x'.repeat(200000);
  const st = { currentId: 't1', tasks: [task({ question: '', answer: big, model: '', date: '', claims: [cl({ id: 'c1', text: '' , note: big })], rounds: [{ id: 'r1', n: 9007199254740991, kind: 'cross', summary: '', fixed: 99999999 }] })] };
  const v = C.validateState(st);
  assert.equal(v.ok, true);
  const back = C.validateState(JSON.parse(JSON.stringify(v.state)));
  assert.equal(back.ok, true);
  assert.equal(back.state.tasks[0].answer.length, 200000);
  assert.equal(C.validateState({ tasks: [], currentId: null }).ok, true);
});

test('isValidDate / resolveToday:拒绝自动进位,非法回退', () => {
  assert.equal(C.isValidDate('2026-02-28'), true);
  assert.equal(C.isValidDate('2024-02-29'), true);
  for (const d of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-1-1', '', null]) assert.equal(C.isValidDate(d), false, String(d));
  assert.equal(C.resolveToday('?today=2026-10-20', '2000-01-01'), '2026-10-20');
  assert.equal(C.resolveToday('?today=2026-02-30', '2000-01-01'), '2000-01-01');
  assert.equal(C.resolveToday('?today=%E0%A4%A', '2000-01-01'), '2000-01-01');
  assert.equal(C.resolveToday('', '2000-01-01'), '2000-01-01');
});

test('core.js 不依赖 DOM', () => {
  assert.equal(typeof document, 'undefined');
  assert.equal(typeof window, 'undefined');
});

test('mergeClaims:两条各有证据链接时都保留,不丢证据', () => {
  const a = cl({ text: '甲', evidenceText: '来源1', evidenceUrl: 'https://a.example/1', status: '已核实', note: 'n1' });
  const b = cl({ text: '乙', evidenceText: '来源2', evidenceUrl: 'https://b.example/2', status: '有误', note: 'n2' });
  const m = C.mergeClaims(a, b);
  assert.equal(m.text, '甲，乙');
  assert.equal(m.evidenceUrl, 'https://a.example/1');
  assert.ok(m.evidenceText.includes('来源1') && m.evidenceText.includes('来源2') && m.evidenceText.includes('https://b.example/2'));
  assert.equal(m.note, 'n1；n2');
  assert.equal(m.status, '未核');
  assert.equal(C.validateClaim(m).ok, true);
  assert.equal(C.mergeClaims(cl({ evidenceUrl: '' }), cl({ evidenceUrl: 'https://b.example/2' })).evidenceUrl, 'https://b.example/2');
  assert.equal(C.mergeClaims(cl({ status: '已核实', evidenceUrl: 'https://x.example' }), cl({ status: '已核实', evidenceUrl: 'https://x.example' })).evidenceText, '');
  assert.equal(C.mergeClaims(cl({ status: '已核实' }), cl({ status: '已核实' })).status, '已核实');
});

/* ---- 第五轮:改文字后重新核实、答案变更提示、核实率口径 ---- */
test('editClaimText:已核实的断言改文字后重置为未核并标记待重新核实,保留旧证据', () => {
  const c = cl({ text: '甲成立于 1990 年', status: '已核实', evidenceText: '年鉴 p.3', evidenceUrl: 'https://example.com/a' });
  const e = C.editClaimText(c, '乙成立于 2001 年');
  assert.equal(e.text, '乙成立于 2001 年');
  assert.equal(e.status, '未核');
  assert.equal(e.staleFrom, '甲成立于 1990 年');
  assert.equal(e.evidenceText, '年鉴 p.3');
  assert.equal(e.evidenceUrl, 'https://example.com/a');
  assert.equal(c.status, '已核实'); // 不改原对象
  // 继续输入:仍记录最初被核实的那句话
  assert.equal(C.editClaimText(e, '乙成立于 2001 年前后').staleFrom, '甲成立于 1990 年');
  // 有误 / 存疑 同样重置;未核的不标记;文字没变不动
  assert.equal(C.editClaimText(cl({ status: '有误' }), '改了').status, '未核');
  assert.equal(C.editClaimText(cl({ status: '存疑' }), '改了').staleFrom, '断言');
  assert.equal(C.editClaimText(cl({ status: '未核' }), '改了').staleFrom, undefined);
  assert.equal(C.editClaimText(c, c.text), c);
});

test('staleFrom / claimsAnswer 可保存并通过校验,类型不对整份拒绝', () => {
  const t = task({ claimsAnswer: '旧答案', claims: [cl({ id: 'c1', staleFrom: '旧断言' })] });
  const v = C.validateState({ currentId: 't1', tasks: [t] });
  assert.equal(v.ok, true);
  assert.equal(v.state.tasks[0].claims[0].staleFrom, '旧断言');
  assert.equal(v.state.tasks[0].claimsAnswer, '旧答案');
  assert.equal(C.validateState({ tasks: [task({ claims: [cl({ staleFrom: 5 })] })] }).ok, false);
  assert.equal(C.validateState({ tasks: [task({ claimsAnswer: 5 })] }).ok, false);
  const round = C.validateImport(C.exportJson({ currentId: 't1', tasks: v.state.tasks }));
  assert.equal(round.ok, true);
  assert.equal(round.tasks[0].claims[0].staleFrom, '旧断言');
});

test('answerStatus:待重新核实的断言单独计数并写进原因', () => {
  const r = C.answerStatus([cl({ staleFrom: '旧' }), cl({ status: '已核实' })]);
  assert.equal(r.counts.stale, 1);
  assert.ok(r.reasons.some(x => /1 条断言.*重新核实/.test(x)));
  assert.equal(C.answerStatus([cl({ status: '已核实' })]).counts.stale, 0);
});

test('answerChanged:断言拆分后答案文字变了才提示;确认后消失', () => {
  assert.equal(C.answerChanged(task({ claims: [cl()] })), false);
  assert.equal(C.answerChanged(task({ claims: [cl()], claimsAnswer: '答' })), false);
  assert.equal(C.answerChanged(task({ claims: [cl()], claimsAnswer: '旧答案' })), true);
  assert.equal(C.answerChanged(task({ claims: [], claimsAnswer: '旧答案' })), false);
});

test('rateText:核实率写出分子分母,分子只含可查/需实验里已核实的', () => {
  const claims = [
    cl({ status: '已核实' }), cl({ status: '已核实', checkability: '需实验' }), cl({ status: '未核' }),
    cl({ status: '已核实', checkability: '无法核实' }), cl({ checkability: '无法核实' }),
  ];
  const r = C.answerStatus(claims);
  assert.equal(r.counts.已核实, 3);
  assert.equal(r.counts.verified, 2);
  assert.equal(r.counts.checkable, 3);
  assert.equal(C.rateText(r), '66.7%(2 ÷ 3:已核实的可查/需实验断言 ÷ 全部可查/需实验断言;另有 2 条无法核实,不计入)');
  assert.match(C.rateText(C.answerStatus([cl({ checkability: '无法核实' })])), /^—\(.*分母为 0/);
});

test('Markdown 报告:核实率带分子分母,待重新核实的断言有标记', () => {
  const t = task({ claims: [cl({ status: '已核实' }), cl({ staleFrom: '旧句' })] });
  const md = C.toMarkdown(t);
  assert.match(md, /核实率:50%\(.*1 ÷ 2/s);
  assert.match(md, /未核\(待重新核实\)/);
  assert.match(md, /旧句/);
});
