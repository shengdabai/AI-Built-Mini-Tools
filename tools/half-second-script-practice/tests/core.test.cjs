'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const mk = () => {
  const s = C.emptyState();
  s.name = '小林';
  s.scripts.push({ id: 's1', text: '我从不刷短视频', identity: '', situation: '', reason: '', emotion: '', loud: false });
  s.scripts.push({ id: 's2', text: '当孩子大声说话时,我先看着她的眼睛再回答', identity: '', situation: '', reason: '', emotion: '', loud: false });
  return s;
};
const at = (d, t) => `${d}T${t || '08:00:00'}`;
const codes = r => r.issues.map(i => i.code);

test('缺少动作动词时给出警告', () => {
  assert.ok(codes(C.checkScript('我很平静的人')).includes('no-verb'));
  assert.ok(!codes(C.checkScript('我深呼吸三次')).includes('no-verb'));
  assert.deepEqual(codes(C.checkScript('')), ['empty']);
});

test('情绪词作为目标时警告「动作目标,不是情绪目标」', () => {
  const r = C.checkScript('我要保持平静');
  assert.ok(codes(r).includes('emotion-goal'));
  assert.match(r.issues.find(i => i.code === 'emotion-goal').message, /动作目标,不是情绪目标/);
  assert.ok(!codes(C.checkScript('我回应,不反应')).includes('emotion-goal'));
});

test('词表可配置:自定义动词与情绪词生效', () => {
  const cfg = { actionVerbs: ['摸'], emotionWords: ['烦'] };
  assert.ok(!codes(C.checkScript('我摸一下桌子', cfg)).includes('no-verb'));
  assert.ok(codes(C.checkScript('我做点什么', cfg)).includes('no-verb'));
  assert.ok(codes(C.checkScript('我不烦', cfg)).includes('emotion-goal'));
});

test('含「如果/当」判为情境型,否则通用型', () => {
  assert.equal(C.checkScript('当孩子大声说话时,我先看着她').type, 'situational');
  assert.equal(C.checkScript('如果想抽烟,我喝水').type, 'situational');
  assert.equal(C.checkScript('我从不抽烟').type, 'universal');
});

test('超过 40 字提示脊干要短,恰好 40 字不提示', () => {
  assert.ok(codes(C.checkScript('我' + '做'.repeat(40))).includes('too-long'));
  assert.ok(!codes(C.checkScript('做'.repeat(40))).includes('too-long'));
});

test('thirdPerson:我 → 名字;空名字退回「你」;自我 不替换', () => {
  assert.equal(C.thirdPerson('我从不刷短视频', '小林'), '小林从不刷短视频');
  assert.equal(C.thirdPerson('我先看着她,我再回答', '小林'), '小林先看着她,小林再回答');
  assert.equal(C.thirdPerson('我从不抽烟', '  '), '你从不抽烟');
  assert.equal(C.thirdPerson('自我暂停,我深呼吸', '小林'), '自我暂停,小林深呼吸');
  assert.equal(C.secondPerson('我的手放下'), '你的手放下');
});

test('不足 5 秒不计入,state 原样;恰好 5 秒计入', () => {
  const s = mk();
  const a = C.recordPractice(s, 's1', 4.99, at('2026-10-20'));
  assert.equal(a.ok, true); assert.equal(a.counted, false); assert.equal(a.state, s);
  assert.match(a.message, /不计入/);
  const b = C.recordPractice(s, 's1', 5, at('2026-10-20'));
  assert.equal(b.counted, true);
  assert.equal(b.state.practices.length, 1);
  assert.equal(s.practices.length, 0, '不修改入参');
});

test('recordPractice 拒绝负数、NaN、未知脚本与坏时间', () => {
  const s = mk();
  for (const sec of [-1, NaN, Infinity, '6', 86401]) assert.equal(C.recordPractice(s, 's1', sec, at('2026-10-20')).ok, false);
  assert.equal(C.recordPractice(s, 'nope', 6, at('2026-10-20')).ok, false);
  assert.equal(C.recordPractice(s, 's1', 6, '2026-10-20').ok, false);
  assert.equal(C.recordPractice(s, 's1', 6, '2026-02-30T08:00:00').ok, false);
});

test('多脚本独立计数', () => {
  let s = mk();
  s = C.recordPractice(s, 's1', 6, at('2026-10-20')).state;
  s = C.recordPractice(s, 's1', 7, at('2026-10-20', '09:00:00')).state;
  s = C.recordPractice(s, 's2', 8, at('2026-10-20')).state;
  assert.deepEqual(C.stats(s, 's1', '2026-10-20'), { today: 2, total: 2, streak: 1 });
  assert.deepEqual(C.stats(s, 's2', '2026-10-20'), { today: 1, total: 1, streak: 1 });
  assert.equal(new Set(s.practices.map(p => p.id)).size, 3);
});

test('streak:断档归零;今天未练保留昨天为止的连续;今天练了则含今天', () => {
  const d = (...days) => days.map(x => ({ at: at(x) }));
  const today = '2026-10-20';
  assert.equal(C.streak(d('2026-10-19', '2026-10-18', '2026-10-17'), today), 3, '今天没练,保留昨日连续');
  assert.equal(C.streak(d('2026-10-20', '2026-10-19', '2026-10-18'), today), 3);
  assert.equal(C.streak(d('2026-10-18', '2026-10-17'), today), 0, '昨天也没练 → 归零');
  assert.equal(C.streak(d('2026-10-20', '2026-10-19', '2026-10-17'), today), 2, '中间断一天只算后段');
  assert.equal(C.streak([], today), 0);
  assert.equal(C.streak(d('2026-10-31', '2026-11-01'), '2026-11-01'), 2, '跨月');
});

test('heatmap 天数、顺序与计数', () => {
  const recs = [{ at: at('2026-10-20') }, { at: at('2026-10-20', '10:00:00') }, { at: at('2026-10-18') }, { at: at('2026-09-01') }];
  const h = C.heatmap(recs, 7, '2026-10-20');
  assert.equal(h.length, 7);
  assert.equal(h[0].date, '2026-10-14');
  assert.equal(h[6].date, '2026-10-20');
  assert.equal(h[6].count, 2); assert.equal(h[6].level, 2);
  assert.equal(h[4].count, 1);
  assert.equal(h.reduce((n, c) => n + c.count, 0), 3, '窗口外的记录不计');
  assert.equal(C.heatmap(Array(9).fill({ at: at('2026-10-20') }), 1, '2026-10-20')[0].level, 4);
  assert.throws(() => C.heatmap([], 0, '2026-10-20'));
});

test('weeklyCounts 按周一起算,本周只数到今天', () => {
  const recs = [at('2026-10-19'), at('2026-10-20'), at('2026-10-12'), at('2026-10-18')].map(x => ({ at: x }));
  const w = C.weeklyCounts(recs, 3, '2026-10-20'); // 2026-10-20 是周二
  assert.deepEqual(w.map(x => x.start), ['2026-10-05', '2026-10-12', '2026-10-19']);
  assert.deepEqual(w.map(x => x.count), [0, 2, 2]);
});

test('executionRate:除零返回 null;窗口边界;前一窗口', () => {
  const t = (date, executed) => ({ date, executed });
  assert.deepEqual(C.executionRate([], 7, '2026-10-20'), { total: 0, executed: 0, rate: null });
  const list = [t('2026-10-20', true), t('2026-10-14', false), t('2026-10-13', true), t('2026-10-10', true)];
  const r7 = C.executionRate(list, 7, '2026-10-20');
  assert.deepEqual([r7.total, r7.executed, r7.rate], [2, 1, 0.5], '10-14 在窗口内,10-13 在窗口外');
  assert.equal(C.executionRate(list, 7, '2026-10-20', 7).total, 2, '前 7 天窗口');
  assert.equal(C.executionRate(list, 30, '2026-10-20').total, 4);
});

test('?today:合法生效,非法与进位日期回退', () => {
  assert.equal(C.resolveToday('?today=2026-10-20', 'F'), '2026-10-20');
  assert.equal(C.resolveToday('?today=2026-02-30', 'F'), 'F');
  assert.equal(C.resolveToday('?today=2026-13-01', 'F'), 'F');
  assert.equal(C.resolveToday('?today=abc', 'F'), 'F');
  assert.equal(C.resolveToday('', 'F'), 'F');
  assert.equal(C.resolveToday('?today=2024-02-29', 'F'), '2024-02-29');
  assert.equal(C.resolveToday('?today=2026-02-29', 'F'), 'F');
});

test('CSV 公式防护:以 = + - @ 开头加单引号;单独 - + 不加;引号与逗号转义', () => {
  const s = mk();
  s.scripts[0].text = '=SUM(A1)';
  s.scripts[1].text = '-"x",y';
  s.scripts.push({ id: 's3', text: '-', identity: '', situation: '', reason: '', emotion: '', loud: false });
  s.scripts.push({ id: 's4', text: '@cmd', identity: '', situation: '', reason: '', emotion: '', loud: false });
  s.practices = ['s1', 's2', 's3', 's4'].map((id, i) => ({ id: 'p' + (i + 1), scriptId: id, seconds: 6, at: at('2026-10-20') }));
  const lines = C.toCsv(s).trim().split('\r\n');
  assert.equal(lines[0], '脚本,日期,时间,秒数');
  assert.equal(lines[1], "'=SUM(A1),2026-10-20,08:00:00,6.0");
  assert.equal(lines[2], '"\'-""x"",y",2026-10-20,08:00:00,6.0');
  assert.equal(lines[3], '-,2026-10-20,08:00:00,6.0');
  assert.equal(lines[4], "'@cmd,2026-10-20,08:00:00,6.0");
  assert.equal(C.guardCell('+1'), "'+1");
  assert.equal(C.guardCell('普通'), '普通');
});

test('Markdown 表格单元格防公式与竖线', () => {
  const s = mk();
  s.scripts[0].text = '=cmd|x\n第二行';
  const md = C.toMarkdown(s, '2026-10-20');
  assert.ok(md.includes("| '=cmd\\|x 第二行 |"));
  assert.ok(md.includes('不是治疗'));
});

test('validateImport:秒数非负、类型、枚举、ID 唯一、外键、非法 JSON 一律整份拒绝', () => {
  const good = mk();
  good.practices.push({ id: 'p1', scriptId: 's1', seconds: 6, at: at('2026-10-20') });
  good.triggers.push({ id: 't1', scriptId: 's2', date: '2026-10-20', situation: 'a', reaction: 'b', executed: true });
  assert.equal(C.validateImport(JSON.stringify(good)).ok, true);
  const bad = fn => { const c = JSON.parse(JSON.stringify(good)); fn(c); return C.validateImport(c); };
  assert.equal(bad(c => { c.practices[0].seconds = -1; }).ok, false);
  assert.equal(bad(c => { c.practices[0].seconds = '6'; }).ok, false);
  assert.equal(bad(c => { c.practices[0].id = 's1'; }).ok, false, 'ID 在全部集合内唯一');
  assert.equal(bad(c => { c.practices[0].scriptId = 'zzz'; }).ok, false);
  assert.equal(bad(c => { c.practices[0].at = '2026-02-30T08:00:00'; }).ok, false);
  assert.equal(bad(c => { c.triggers[0].executed = 'yes'; }).ok, false);
  assert.equal(bad(c => { c.triggers[0].date = '2026-13-01'; }).ok, false);
  assert.equal(bad(c => { c.version = 2; }).ok, false);
  assert.equal(bad(c => { c.scripts[0].loud = 1; }).ok, false);
  assert.equal(bad(c => { c.config.actionVerbs = [''];} ).ok, false);
  assert.equal(bad(c => { for (let i = 0; i < 4; i++) c.scripts.push({ id: 'x' + i, text: 'a', identity: '', situation: '', reason: '', emotion: '', loud: false }); }).ok, false, '最多 5 条');
  assert.equal(C.validateImport('{oops').ok, false);
  assert.equal(C.validateImport('[]').ok, false);
  assert.ok(bad(c => { c.practices[0].seconds = -1; }).errors.some(e => /seconds/.test(e)));
});

test('写读校验同源:超长文本(SPEC 无上限)通过 JSON 往返后仍通过 validateState', () => {
  const s = mk();
  s.name = '名'.repeat(500);
  s.scripts[0].text = '做'.repeat(5000);
  s.scripts[0].reason = '理'.repeat(5000);
  s.triggers.push({ id: 't1', scriptId: 's1', date: '2026-10-20', situation: '情'.repeat(3000), reaction: '应'.repeat(3000), executed: true });
  s.practices.push({ id: 'p1', scriptId: 's1', seconds: C.LIMITS.maxSeconds, at: at('2026-10-20', '23:59:59') });
  assert.equal(C.validateState(s).ok, true);
  assert.equal(C.validateState(JSON.parse(JSON.stringify(s))).ok, true);
  assert.deepEqual(C.checkScript(s.scripts[0].text).issues.map(i => i.code).includes('too-long'), true, '只给提示,不拒绝');
});

test('导入拒绝 < 5 秒的练习记录,避免统计被不合格记录抬高', () => {
  const s = mk();
  s.practices.push({ id: 'p1', scriptId: 's1', seconds: 0, at: at('2026-10-20') });
  assert.equal(C.validateImport(s).ok, false);
  s.practices[0].seconds = 4.9;
  assert.equal(C.validateImport(s).ok, false);
  s.practices[0].seconds = 5;
  assert.equal(C.validateImport(s).ok, true);
  assert.deepEqual(C.stats(s, 's1', '2026-10-20'), { today: 1, total: 1, streak: 1 });
});

test('__proto__ 之类脚本文字不会污染分组', () => {
  const s = mk();
  s.scripts[0].text = '__proto__';
  s.practices.push({ id: 'p1', scriptId: 's1', seconds: 6, at: at('2026-10-20') });
  const csv = C.toCsv(s);
  assert.ok(csv.includes('__proto__'));
  assert.equal(({}).polluted, undefined);
  assert.equal(C.stats(s, 's1', '2026-10-20').total, 1);
});

test('addDays 在 UTC 轴上跨月跨年', () => {
  assert.equal(C.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(C.addDays('2024-03-01', -1), '2024-02-29');
  assert.throws(() => C.addDays('2026-02-30', 1));
});

test('合成示例在 CSV 与 Markdown 导出里标注,真实数据不标', () => {
  const s = mk();
  s.practices.push({ id: 'p1', scriptId: 's1', at: at('2026-10-20'), seconds: 6 });
  assert.ok(!C.toCsv(s).includes('合成示例'));
  assert.ok(!C.toMarkdown(s, '2026-10-20').includes('合成示例'));
  s.sample = true;
  const lines = C.toCsv(s).trim().split('\r\n');
  assert.match(lines[0], /数据性质$/);
  assert.ok(lines.slice(1).every(l => l.endsWith('合成示例')));
  assert.match(C.toMarkdown(s, '2026-10-20'), /合成示例/);
});

test('超长提示对“脊干”给出解释;大声版在 Markdown 中写明只改显示文字', () => {
  const long = C.checkScript('我' + '做'.repeat(45));
  const msg = long.issues.find(i => i.code === 'too-long').message;
  assert.match(msg, /脊干\(脚本的主干句\)/);
  const s = mk(); s.scripts[0].loud = true;
  assert.match(C.toMarkdown(s, '2026-10-20'), /姓名\/你版本\(只改显示文字/);
});
