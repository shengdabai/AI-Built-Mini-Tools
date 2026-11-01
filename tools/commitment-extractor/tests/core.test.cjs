'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

// 2026-09-30 是周三；2026-10-04 是周日
test('相对日期：今天/明天/后天/大后天/下班前/EOD', () => {
  const b = '2026-09-30';
  assert.equal(C.parseDate('今天下班前给你', b), '2026-09-30');
  assert.equal(C.parseDate('下班前发', b), '2026-09-30');
  assert.equal(C.parseDate('明天发你', b), '2026-10-01');
  assert.equal(C.parseDate('后天', b), '2026-10-02');
  assert.equal(C.parseDate('大后天', b), '2026-10-03');
  assert.equal(C.parseDate('I will send it EOD', b), '2026-09-30');
  assert.equal(C.parseDate('by tomorrow', b), '2026-10-01');
  assert.equal(C.parseDate('the day after tomorrow', b), '2026-10-02');
});

test('周X：最近一次（含今天）、本周X、下周X、跨周', () => {
  const wed = '2026-09-30';
  assert.equal(C.parseDate('周五前', wed), '2026-10-02');
  assert.equal(C.parseDate('周三', wed), '2026-09-30', '当天说当天的星期即今天');
  assert.equal(C.parseDate('周一', wed), '2026-10-05', '已过的周X顺延到下周');
  assert.equal(C.parseDate('本周一', wed), '2026-09-28', '本周X 可以在过去');
  assert.equal(C.parseDate('下周一', wed), '2026-10-05');
  assert.equal(C.parseDate('下周三', wed), '2026-10-07');
  assert.equal(C.parseDate('下下周二', wed), '2026-10-13');
  assert.equal(C.parseDate('星期天', wed), '2026-10-04');
  const fri = '2026-10-02';
  assert.equal(C.parseDate('下周一前', fri), '2026-10-05', '周五说下周一，跨周');
  assert.equal(C.parseDate('next Monday', fri), '2026-10-05');
  assert.equal(C.parseDate('by Friday', fri), '2026-10-02');
  assert.equal(C.parseDate('this Monday', fri), '2026-09-28');
});

test('周日当天：周日=今天，下周日=+7，下周一=明天，本周一=6 天前', () => {
  const sun = '2026-10-04';
  assert.equal(C.weekday(sun), 7);
  assert.equal(C.parseDate('周日前', sun), '2026-10-04');
  assert.equal(C.parseDate('本周日', sun), '2026-10-04');
  assert.equal(C.parseDate('下周日', sun), '2026-10-11');
  assert.equal(C.parseDate('下周一', sun), '2026-10-05');
  assert.equal(C.parseDate('本周一', sun), '2026-09-28');
  assert.equal(C.parseDate('by Sunday', sun), '2026-10-04');
  assert.equal(C.parseDate('周末', sun), '2026-10-04');
});

test('跨月：X号、月底、下个月底、闰年二月', () => {
  assert.equal(C.parseDate('5号前交', '2026-09-20'), '2026-10-05', '本月 5 号已过 → 下月');
  assert.equal(C.parseDate('25号', '2026-09-20'), '2026-09-25');
  assert.equal(C.parseDate('30号', '2027-01-31'), '2027-03-30', '二月没有 30 号，顺延到三月');
  assert.equal(C.parseDate('月底', '2026-09-30'), '2026-09-30');
  assert.equal(C.parseDate('下个月底', '2026-09-15'), '2026-10-31');
  assert.equal(C.parseDate('月底前', '2028-02-10'), '2028-02-29', '闰年');
  assert.equal(C.parseDate('end of the month', '2026-02-03'), '2026-02-28');
  assert.equal(C.parseDate('周五', '2026-09-29'), '2026-10-02', '周五落在下个月');
  assert.equal(C.parseDate('3号楼开会', '2026-09-20'), null, '「3号楼」不是日期');
});

test('跨年：明天、X月X日、X号、Oct 3 年份推断', () => {
  assert.equal(C.parseDate('明天', '2026-12-31'), '2027-01-01');
  assert.equal(C.parseDate('1月3日前', '2026-12-28'), '2027-01-03');
  assert.equal(C.parseDate('5号', '2026-12-20'), '2027-01-05');
  assert.equal(C.parseDate('下周一', '2026-12-30'), '2027-01-04');
  assert.equal(C.parseDate('Jan 5th', '2026-12-28'), '2027-01-05');
  assert.equal(C.parseDate('12月1日', '2026-12-20'), '2026-12-01', '近期的过去日期不推到明年');
  assert.equal(C.parseDate('2027-02-30', '2026-12-20'), null, '不存在的日期留空');
  assert.equal(C.parseDate('10月9日前', '2026-09-28'), '2026-10-09');
  assert.equal(C.parseDate('3 Oct', '2026-09-28'), '2026-10-03');
});

test('解析不了的期限留空，基准日期无效时报错', () => {
  assert.equal(C.parseDate('尽快发你', '2026-09-30'), null);
  assert.equal(C.parseDate('I will send it soon', '2026-09-30'), null);
  assert.equal(C.parseDate('', '2026-09-30'), null);
  assert.throws(() => C.parseDate('明天', '2026-13-01'), /基准日期无效/);
  assert.throws(() => C.extract('张三：我来', { baseDate: 'not-a-date' }), /基准日期无效/);
});

test('比例上下文与带空格百分号不作为无年份日期', () => {
  for (const text of ['比分3/2', '比分：3/2', '比例 1/2', '占比=3/5', '进度 1/2', '完成了1/2', 'ratio: 1/2', 'Score 3/2', 'progress=1/2', '良率 3/5 %', '良率 3/5 ％']) {
    assert.equal(C.parseDate(text, '2026-09-30'), null, text);
    assert.equal(C.findDate(text, '2026-09-30'), null, text);
  }
});

test('跳过比例后仍识别同句后续日期，并保留原文位置', () => {
  const text = '进度 1/2，比例 3/5，我会在10/9前交付';
  assert.deepEqual(C.findDate(text, '2026-09-30'), {
    date: '2026-10-09', text: '10/9', index: text.indexOf('10/9'),
  });
  assert.equal(C.parseDate('比分3/2，我明天发报告', '2026-09-30'), '2026-10-01');
  assert.equal(C.parseDate('我会在10/9前报告比分3/2', '2026-09-30'), '2026-10-09');
  assert.equal(C.parseDate('交付日期：10/9', '2026-09-30'), '2026-10-09');
});

test('比例不生成承诺期限或日历事件，真实日期仍导出', () => {
  const result = C.extract('张三：我会报告比分3/2\n李四：进度1/2，我会在10/9前交付', { baseDate: '2026-09-30' });
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].due, '');
  assert.equal(result.items[1].due, '2026-10-09');
  const ics = C.toICS(result.items, { now: new Date('2026-09-30T00:00:00Z') });
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261009'));
});

test('进度标签后的明确交付日期保留，比例和比分仍排除', () => {
  const base = '2026-09-30';
  for (const text of ['进度：10/9 前交', '进度:10/9前提交', 'progress: 10/9前交付']) {
    assert.deepEqual(C.findDate(text, base), {
      date: '2026-10-09', text: '10/9', index: text.indexOf('10/9'),
    }, text);
  }
  for (const text of ['进度：1/2', 'progress: 3/5', '进度1/2，前交的已完成', '比分3/2前交叉跑位', '比例3/5前交']) {
    assert.equal(C.findDate(text, base), null, text);
  }
});

test('半角冒号后的日期可识别，时间片段不误作日期', () => {
  for (const text of ['交付日期:10/9', 'deadline:10/9', '交付日期: 10/9', '交付日期：10/9']) {
    assert.equal(C.parseDate(text, '2026-09-30'), '2026-10-09', text);
  }
  for (const text of ['12:10/9', '12: 10/9', '12：10/9', '版本1.10/9', '%3/5前交']) {
    assert.equal(C.parseDate(text, '2026-09-30'), null, text);
  }
});

test('进度交付日期从承诺提取贯通到日历导出', () => {
  const { items } = C.extract('示例甲：我会按这个进度：10/9 前交方案', { baseDate: '2026-09-30' });
  assert.equal(items.length, 1);
  assert.equal(items[0].due, '2026-10-09');
  assert.equal(items[0].task.includes('10/9'), false);
  const ics = C.toICS(items, { now: new Date('2026-09-30T00:00:00Z') });
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261009'));
});

test('年末无年份闰日按跨年规则校验目标年，不丢失或改写日期', () => {
  for (const text of ['2/29前交', '2月29日前交', 'Feb 29']) {
    assert.equal(C.parseDate(text, '2027-12-28'), '2028-02-29', text);
    assert.equal(C.parseDate(text, '2028-12-28'), null, text + '：下一年无闰日');
    assert.equal(C.parseDate(text, '2027-02-01'), null, text + '：不猜远期闰年');
  }
  assert.equal(C.parseDate('2/30', '2027-12-28'), null);
  assert.equal(C.parseDate('2027-02-29', '2027-12-28'), null);
  assert.equal(C.parseDate('2028-02-29', '2027-12-28'), '2028-02-29');
});

test('ICS 的外部事项 id 不能注入属性或事件，普通 id 保持兼容', () => {
  const defaults = { baseDate: '2026-09-30', filters: {}, items: [] };
  const state = C.normalizeState({ items: [{
    id: 'fixture\r\nBEGIN:VEVENT\r\nSUMMARY:injected', sentence: '合成测试',
    owner: '示例甲', task: '提交方案', due: '2026-10-09', status: 'todo',
  }] }, defaults).state;
  const opts = { now: new Date('2026-09-30T00:00:00Z') };
  const ics = C.toICS(state.items, opts);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.equal((ics.match(/^SUMMARY:/gm) || []).length, 1);
  assert.equal((ics.match(/^UID:/gm) || []).length, 1);
  const unfolded = ics.replace(/\r\n /g, '');
  assert.equal(/^SUMMARY:injected$/m.test(unfolded), false);
  assert.equal(C.toICS(state.items, opts), ics, '同一事项的 UID 稳定');
  const normal = C.toICS([{ ...state.items[0], id: 'fixture1' }], opts);
  assert.ok(normal.includes('UID:fixture1-20261009@commit-extractor.local\r\n'));
  const ids = ['\n', '%000a', 'a,b;c:d', '合成事项', '\ud800'];
  const uids = ids.map((id) => {
    const output = C.toICS([{ ...state.items[0], id }], opts).replace(/\r\n /g, '');
    assert.equal((output.match(/^BEGIN:VEVENT$/gm) || []).length, 1);
    return output.match(/^UID:([^\r\n]+)$/m)[1];
  });
  assert.equal(new Set(uids).size, ids.length, '不同 id 编码后仍保持区分');
});

test('原文解析：四种格式都能拿到说话人和正文', () => {
  const msgs = C.parseTranscript([
    '张三：周五前我把报价发你',
    '[10:32] 李四: 我来跟进',
    '王五 10:35',
    '合同我明天看',
    '第二行也算王五的',
    '',
    '- 供应商会在下周一前寄样',
    'Action items:',
    'Mia Chen: I will send the invoice by Friday.',
  ].join('\n'));
  const pick = (m) => [m.speaker, m.body];
  assert.deepEqual(pick(msgs[0]), ['张三', '周五前我把报价发你']);
  assert.deepEqual(pick(msgs[1]), ['李四', '我来跟进']);
  assert.equal(msgs[1].time, '10:32');
  assert.deepEqual(pick(msgs[3]), ['王五', '合同我明天看']);
  assert.deepEqual(pick(msgs[4]), ['王五', '第二行也算王五的']);
  assert.deepEqual(pick(msgs[5]), ['', '- 供应商会在下周一前寄样'], '空行后不再继承说话人');
  assert.equal(msgs[6].speaker, '', '「Action items:」不是说话人');
  assert.deepEqual(pick(msgs[7]), ['Mia Chen', 'I will send the invoice by Friday.']);
});

test('承诺识别：负责人来自说话人 / @指派 / 请某人 / 纪要中的第三方', () => {
  const text = [
    '张三：周五前我把报价发你',
    '李四：@王五 你来对接物流，下周一前给我方案',
    '李四：请张三明天下班前更新产品图',
    '- 供应商会在下周一前寄出第二版样品',
    'Mia Chen: Sure. I will send the invoice by Friday.',
    '王五：好的',
  ].join('\n');
  const r = C.extract(text, { baseDate: '2026-09-30' });
  const view = r.items.map((it) => [it.owner, it.due, it.ownerSource]);
  assert.deepEqual(view, [
    ['张三', '2026-10-02', 'speaker'],
    ['王五', '2026-10-05', 'assigned'],
    ['张三', '2026-10-01', 'assigned'],
    ['供应商', '2026-10-05', 'named'],
    ['Mia Chen', '2026-10-02', 'speaker'],
  ]);
  assert.equal(r.items[0].task, '报价发你');
  assert.equal(r.items[4].task, 'send the invoice');
});

test('非承诺闲聊与提问不进清单', () => {
  const r = C.extract([
    '林晓：大家中午吃什么？',
    '苏蔓：我去吃个饭，回来再说',
    'Minh: Thanks! The weather here is great today.',
    'Oliver: Can you send the invoice by Friday?',
    '周启：收到',
  ].join('\n'), { baseDate: '2026-09-30' });
  assert.equal(r.items.length, 0, JSON.stringify(r.items.map((i) => i.sentence)));
});

test('模糊检测：笔记里的 revised sample 例子生成对应英文澄清问题', () => {
  const r = C.extract('Oliver: We need the revised sample soon.', { baseDate: '2026-09-30' });
  assert.equal(r.items.length, 1);
  const it = r.items[0];
  assert.equal(it.kind, 'request');
  assert.deepEqual(C.clarityFlags(it), ['noOwner', 'vagueTime', 'vagueRef']);
  const qs = C.buildQuestions(it);
  assert.equal(qs[0], 'Which revision of the sample should we confirm, and what date can you commit to?');
  assert.match(qs[1], /^Who will own "the revised sample"\?$/);
});

test('模糊检测：中文「回头」「那个」、缺期限；补上信息后不再待澄清', () => {
  const r = C.extract('苏蔓：那个色卡回头发你\n周启：验厂报告我来跟进', { baseDate: '2026-09-30' });
  const [a, b] = r.items;
  assert.deepEqual(C.clarityFlags(a), ['vagueTime', 'vagueRef']);
  const qa = C.buildQuestions(a);
  assert.match(qa[0], /^苏蔓，「那个色卡发你」能给一个具体日期吗？原话「回头」没有期限。$/);
  assert.match(qa[1], /「那个色卡」具体指哪一份/);
  assert.deepEqual(C.clarityFlags(b), ['noDue']);
  assert.equal(C.buildQuestions(b)[0], '周启，「验厂报告跟进」预计哪天完成？');
  const fixed = Object.assign({}, a, { due: '2026-10-02', task: 'B 款灰色色卡发你' });
  assert.deepEqual(C.clarityFlags(fixed), []);
  assert.equal(C.isUnclear(fixed), false);
  assert.deepEqual(C.buildQuestions(fixed), []);
});

test('有明确日期时「尽快」不算含糊；「大家」不算负责人', () => {
  const r = C.extract('张三：尽快，最晚周五前我发你\n李四：大家会在周五前提交', { baseDate: '2026-09-30' });
  assert.deepEqual(C.clarityFlags(r.items[0]), []);
  assert.equal(r.items[1].owner, '');
  assert.ok(C.clarityFlags(r.items[1]).includes('noOwner'));
});

test('逾期判断与筛选', () => {
  const items = [
    { id: 'a', owner: '张三', due: '2026-09-29', status: 'todo', task: 'x' },
    { id: 'b', owner: '张三', due: '2026-09-29', status: 'done', task: 'y' },
    { id: 'c', owner: '李四', due: '2026-09-30', status: 'todo', task: 'z' },
    { id: 'd', owner: '', due: '', status: 'todo', task: 'w' },
  ];
  assert.equal(C.isOverdue(items[0], '2026-09-30'), true);
  assert.equal(C.isOverdue(items[1], '2026-09-30'), false, '已完成不算逾期');
  assert.equal(C.isOverdue(items[2], '2026-09-30'), false, '今天到期不算逾期');
  assert.equal(C.isOverdue(items[3], '2026-09-30'), false);
  assert.deepEqual(C.filterItems(items, { owner: '张三' }).map((i) => i.id), ['a', 'b']);
  assert.deepEqual(C.filterItems(items, { status: 'todo' }).map((i) => i.id), ['a', 'c', 'd']);
  assert.deepEqual(C.filterItems(items, { owner: '__none__' }).map((i) => i.id), ['d']);
  assert.deepEqual(C.filterItems(items, { clarity: 'unclear' }).map((i) => i.id), ['d']);
});

test('重新识别时保留人工编辑', () => {
  const t = '张三：周五前我把报价发你';
  const first = C.extract(t, { baseDate: '2026-09-30' }).items;
  first[0] = Object.assign({}, first[0], { status: 'done', owner: '张三丰', edited: true });
  const again = C.mergeEdits(C.extract(t, { baseDate: '2026-09-30' }).items, first);
  assert.equal(again[0].status, 'done');
  assert.equal(again[0].owner, '张三丰');
});

test('CSV：BOM、引号转义、换行、防公式注入', () => {
  const csv = C.toCSV([
    { owner: '张三', task: '报价 "A,B"', due: '2026-10-02', status: 'todo', lineNo: 1, sentence: '=HYPERLINK("x")', id: 'a' },
  ], '2026-09-30');
  assert.ok(csv.startsWith('﻿负责人,事项,期限'));
  const row = csv.split('\r\n')[1];
  assert.ok(row.includes('"报价 ""A,B"""'));
  assert.ok(row.includes('"\'=HYPERLINK(""x"")"'));
  assert.ok(csv.endsWith('\r\n'));
});

test('Markdown：表格竖线转义，含澄清问题', () => {
  const r = C.extract('Oliver: We need the revised sample soon.\n张三：周五前我把A|B报价发你', { baseDate: '2026-09-30' });
  const md = C.toMarkdown(r.items, { baseDate: '2026-09-30', today: '2026-09-30' });
  assert.match(md, /^# 跟进纪要/);
  assert.ok(md.includes('A\\|B报价发你'));
  assert.ok(md.includes('1. Which revision of the sample should we confirm'));
  assert.ok(md.includes('| （未定） | the revised sample |'));
});

test('ICS：RFC 5545 结构、CRLF、全天事件、转义、折行、跳过无日期与已取消', () => {
  const items = [
    { id: 'a1', owner: '张三', task: '报价, 含税; 版本\\B', due: '2026-12-31', status: 'todo', sentence: '第一行\n第二行' },
    { id: 'b2', owner: '李四', task: '无日期', due: '', status: 'todo', sentence: 's' },
    { id: 'c3', owner: '王五', task: '取消的', due: '2026-10-01', status: 'cancelled', sentence: 's' },
    { id: 'd4', owner: 'Mia', task: '很长的事项'.repeat(12), due: '2026-10-02', status: 'done', sentence: 's' },
  ];
  const ics = C.toICS(items, { now: new Date(Date.UTC(2026, 8, 30, 1, 2, 3)) });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal(ics.replace(/\r\n/g, '').includes('\n'), false, '只允许 CRLF 换行');
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.ok(ics.includes('DTSTAMP:20260930T010203Z'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101'), '全天事件结束日为次日（跨年）');
  assert.ok(ics.includes('UID:a1-20261231@commit-extractor.local'));
  assert.ok(ics.includes('SUMMARY:张三：报价\\, 含税\\; 版本\\\\B'));
  assert.ok(ics.includes('原话：第一行\\n第二行'));
  for (const line of ics.split('\r\n')) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75, '行超过 75 字节：' + line);
  }
  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('SUMMARY:Mia：' + '很长的事项'.repeat(12)), '折行后可无损还原');
});

test('负责人别名：纪要里只写名，归并到唯一的发言人全名；同名多人时不归并', () => {
  const text = 'Minh Tran: hi all\n- Minh to share the QC checklist next Monday';
  const r = C.extract(text, { baseDate: '2026-09-30' });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].owner, 'Minh Tran');
  const two = C.extract('Minh Tran: hi\nMinh Le: hello\n- Minh to share the QC checklist next Monday', { baseDate: '2026-09-30' });
  assert.equal(two.items[0].owner, 'Minh', '有两个 Minh 时保持原文，不猜');
});

test('无年份 M/D：合法、非法、跨年、比例不当日期', () => {
  assert.equal(C.parseDate('10/9 前交', '2026-09-30'), '2026-10-09');
  assert.equal(C.parseDate('10/09前交', '2026-09-30'), '2026-10-09');
  assert.equal(C.parseDate('1/5前交', '2026-12-28'), '2027-01-05', '跨年：离基准日 180 天以上的过去日期推到明年');
  assert.equal(C.parseDate('12/1', '2026-12-20'), '2026-12-01', '近期的过去日期不推到明年，与 X月X日 规则一致');
  assert.equal(C.parseDate('2/29前', '2027-02-01'), null, '平年没有 2/29');
  assert.equal(C.parseDate('2/29前', '2028-02-01'), '2028-02-29');
  assert.equal(C.parseDate('2/30前交', '2026-09-30'), null);
  assert.equal(C.parseDate('13/1前交', '2026-09-30'), null);
  assert.equal(C.parseDate('0/5', '2026-09-30'), null);
  assert.equal(C.parseDate('完成了3/5家', '2026-09-30'), null, '「3/5家」是比例');
  assert.equal(C.parseDate('进度 1/2 页', '2026-09-30'), null);
  assert.equal(C.parseDate('良率 3/5%', '2026-09-30'), null);
  assert.equal(C.parseDate('%3/5前交', '2026-09-30'), null, '前接百分号不算日期');
  assert.equal(C.parseDate('％3/5前交', '2026-09-30'), null, '前接全角百分号不算日期');
  assert.equal(C.parseDate('版本 1.10/9', '2026-09-30'), null, '紧挨小数点不算日期');
  assert.equal(C.parseDate('2026/10/9', '2026-09-30'), '2026-10-09', '带年份仍走完整日期规则');
  const r = C.extract('周启：我 10/9 前把运费方案发你', { baseDate: '2026-09-30' });
  assert.equal(r.items[0].due, '2026-10-09');
  assert.equal(r.items[0].task.includes('10/9'), false, '事项里去掉期限短语');
});

test('指派：问句先排除；「请 + 2–3 字人名 + 动作/日期」不依赖已知说话人；请问 / 请大家 / 请尽快 不误报', () => {
  const b = '2026-09-30';
  assert.equal(C.extract('李四：@周启 你来处理吗？', { baseDate: b }).items.length, 0, '@指派的问句不进清单');
  const r = C.extract('李四：请苏蔓明天下班前更新产品图', { baseDate: b });
  assert.equal(r.items.length, 1);
  assert.deepEqual([r.items[0].owner, r.items[0].ownerSource, r.items[0].due, r.items[0].task], ['苏蔓', 'assigned', '2026-10-01', '更新产品图']);
  const three = C.extract('李四：麻烦欧阳娜周五前提交报销单', { baseDate: b }).items[0];
  assert.deepEqual([three.owner, three.due], ['欧阳娜', '2026-10-02']);
  for (const t of ['请问明天谁有空', '请大家明天提交周报', '请尽快发一下', '请各位周五前确认', '麻烦确认一下报价', '请你明天发我', '申请张三明天处理']) {
    const it = C.analyzeSentence(t, '李四', [], b);
    assert.ok(!it || it.ownerSource !== 'assigned', t + ' 不应识别为指派给某人');
  }
});

test('英文指代：按完整短语判断，改写成 sample v2 后不再指代不明', () => {
  const r = C.extract('Oliver: We need the revised sample soon.', { baseDate: '2026-09-30' });
  const it = r.items[0];
  assert.equal(it.refWord, 'the revised sample');
  const fixed = Object.assign({}, it, { owner: 'Oliver', due: '2026-10-02', task: 'sample v2' });
  assert.deepEqual(C.clarityFlags(fixed), []);
  const partial = Object.assign({}, it, { owner: 'Oliver', due: '2026-10-02' });
  assert.deepEqual(C.clarityFlags(partial), ['vagueRef'], '事项仍是 the revised sample 时保留标记');
  const by = C.extract('Oliver: I will send the updated deck by Friday.', { baseDate: '2026-09-30' }).items[0];
  assert.equal(by.refWord, 'the updated deck', '短语不含 by 等介词');
  assert.deepEqual(C.clarityFlags(by), ['vagueRef']);
});

test('重新识别：原文前插一行时按「说话人 + 原句」回退匹配，重复句不猜', () => {
  const b = '2026-09-30';
  const t = '张三：周五前我把报价发你\n李四：周一前我来发验厂报告';
  const first = C.extract(t, { baseDate: b }).items;
  first[0] = Object.assign({}, first[0], { owner: '张三丰', status: 'done', dirty: { owner: true, status: true } });
  const again = C.mergeEdits(C.extract('背景：本周供应商会议\n' + t, { baseDate: b }).items, first);
  assert.equal(again[0].owner, '张三丰');
  assert.equal(again[0].status, 'done');
  assert.equal(again[1].owner, '李四');
  const dup = '张三：我明天发报价\n张三：我明天发报价';
  const d1 = C.extract(dup, { baseDate: b }).items;
  d1[0] = Object.assign({}, d1[0], { owner: '王五', dirty: { owner: true } });
  const d2 = C.mergeEdits(C.extract('插入\n' + dup, { baseDate: b }).items, d1);
  assert.deepEqual(d2.map((i) => i.owner), ['张三', '张三'], '重复原句不猜是哪一条');
});

test('字段级脏标记：只改状态时期限仍随基准日期重算；手动改过期限则保留；兼容旧 edited:true', () => {
  const t = '张三：我明天发报价';
  const first = C.extract(t, { baseDate: '2026-09-30' }).items;
  assert.equal(first[0].due, '2026-10-01');
  const statusOnly = [Object.assign({}, first[0], { status: 'done', dirty: { status: true } })];
  const r1 = C.mergeEdits(C.extract(t, { baseDate: '2026-10-01' }).items, statusOnly)[0];
  assert.deepEqual([r1.due, r1.status], ['2026-10-02', 'done']);
  const dueEdited = [Object.assign({}, first[0], { due: '2026-10-09', dirty: { due: true } })];
  assert.equal(C.mergeEdits(C.extract(t, { baseDate: '2026-10-01' }).items, dueEdited)[0].due, '2026-10-09');
  const legacy = [Object.assign({}, first[0], { status: 'done', edited: true })];
  const r3 = C.mergeEdits(C.extract(t, { baseDate: '2026-10-01' }).items, legacy)[0];
  assert.deepEqual([r3.due, r3.status], ['2026-10-01', 'done'], '旧数据不知道改过哪个字段，四个字段都保留');
  assert.deepEqual(C.dirtyOf({ edited: true }), { owner: true, task: true, due: true, status: true });
  assert.deepEqual(C.dirtyOf({ dirty: { due: true } }), { owner: false, task: false, due: true, status: false });
});

test('存储深度校验：坏结构记入 issues 并补默认值，合法旧数据无 issues', () => {
  const def = { text: '', baseDate: '2026-09-30', items: [], extractedText: '', extractBase: '', view: 'edit', isSample: false, filters: { owner: '', status: '', clarity: '' } };
  const a = C.normalizeState({ items: [null, { id: 'x', sentence: 's', status: 'weird', due: '2026-02-30', owner: 3 }], filters: null }, def);
  assert.equal(a.state.items.length, 1);
  assert.deepEqual([a.state.items[0].status, a.state.items[0].due, a.state.items[0].owner, a.state.items[0].task], ['todo', '', '', 's']);
  assert.deepEqual(a.state.filters, { owner: '', status: '', clarity: '' });
  assert.ok(a.issues.length >= 4, a.issues.join('|'));
  assert.deepEqual(C.normalizeState([], def).issues, ['顶层不是对象']);
  assert.ok(C.normalizeState({ items: null }, def).issues.length >= 1, 'items 显式 null 视为损坏，走备份');
  assert.ok(C.normalizeState({ filters: null }, def).issues.length >= 1, 'filters 显式 null 视为损坏');
  assert.deepEqual(C.normalizeState({}, def).issues, [], '字段缺失仍按旧版本静默补默认');
  assert.ok(C.normalizeState({ filters: { status: 'x' } }, def).issues.includes('filters.status 无效'));
  const ok = C.normalizeState({ baseDate: '2026-10-01', items: [{ id: 'c1', sentence: '我来', owner: '张三', edited: true, lineNo: 2 }] }, def);
  assert.deepEqual(ok.issues, []);
  assert.equal(ok.state.baseDate, '2026-10-01');
  assert.equal(ok.state.items[0].dirty.owner, true, '旧 edited:true 迁移为全字段脏标记');
  assert.equal(def.items.length, 0, '不改动默认值对象');
});

test('CSV 防公式：换行、空格、制表符、全角符号前缀后再出现公式字符也加前缀', () => {
  const row = (task) => C.toCSV([{ owner: 'a', task, due: '', status: 'todo', lineNo: 1, sentence: 's', id: 'x' }], '2026-09-30').split('\r\n').slice(1).join('\r\n');
  assert.ok(row('\n=1+1').startsWith('a,"\'\n=1+1"'), 'LF 前缀');
  assert.ok(row('  +SUM(A1)').startsWith("a,'  +SUM(A1)"), '空格前缀');
  assert.ok(row('　@cmd').startsWith("a,'　@cmd"), '全角空格前缀');
  assert.ok(row('-2+3').startsWith("a,'-2+3"));
  assert.ok(row('正常 = 文本').startsWith('a,正常 = 文本'), '中间的等号不处理');
});

test('Markdown 导出编码 & < >：负责人、事项、追问文本都不保留原始 HTML', () => {
  const items = [{ id: 'a', owner: '<img src=x onerror=alert(1)>', task: '<svg onload=alert(2)> & co', due: '', status: 'todo', sentence: 's', lang: 'zh', vagueTimeWord: '' }];
  const md = C.toMarkdown(items, { baseDate: '2026-09-30', today: '2026-09-30' });
  assert.equal(/<img|<svg/.test(md), false);
  assert.ok(md.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(md.includes('&lt;svg onload=alert(2)&gt; &amp; co'));
  assert.ok(md.includes('「&lt;svg onload=alert(2)&gt; &amp; co」预计哪天完成？'), '追问文本也编码');
});

test('负责人：「我来跟进 / 我会负责」取说话人；周姓名字不被星期词误拦', () => {
  const own = (t) => C.extract(t, { baseDate: '2026-09-30' }).items.map((i) => i.owner);
  assert.deepEqual(own('张三：我来跟进报价，明天给你'), ['张三']);
  assert.deepEqual(own('李四：我会负责周五前改完样稿'), ['李四']);
  assert.deepEqual(own('赵六：周启负责明天出图'), ['周启']);
  assert.deepEqual(own('赵六：周五会发出来吗'), [], '星期词问句不成条');
});
