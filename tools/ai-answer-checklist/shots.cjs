'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const URL = 'file://' + encodeURI(path.join(__dirname, 'index.html'));
const OUT = path.join(__dirname, 'screenshots');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });
  const problems = [];
  let asserts = 0;
  const check = (cond, msg) => { asserts += 1; if (!cond) problems.push('断言失败:' + msg); else console.log('  ok  ' + msg); };
  const watch = (page, tag) => {
    page.on('console', m => { if (m.type() === 'error') problems.push(`${tag} console: ${m.text()}`); });
    page.on('pageerror', e => problems.push(`${tag} pageerror: ${e.message}`));
  };
  const read = async dl => fs.readFileSync(await dl.path(), 'utf8');

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  watch(page, '主页面');
  const noOverflow = async label => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(`${label}: scrollWidth ${sw} <= innerWidth ${iw} → ${sw <= iw ? 'OK' : 'FAIL'}`);
    check(sw <= iw, `${label} 无横向溢出 (${sw} <= ${iw})`);
  };
  const status = () => page.textContent('#answer-status');
  const taskCount = () => page.$$eval('.task-item', x => x.length);

  // A 空状态
  await page.goto(URL + '?today=2026-10-20');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  check(await page.isVisible('#empty-guide'), '空状态显示引导');
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

  // B 新建任务 → 拆断言 → 状态规则
  await page.click('#new-task');
  check((await page.inputValue('#t-date')) === '2026-10-20', '新任务日期取 ?today');
  await page.fill('#t-question', '甲公司的基本情况');
  await page.fill('#t-model', '模型X');
  await page.fill('#t-answer', '甲公司成立于1999年。=1+1是它的口号。建议立即采购');
  await page.click('#split-btn');
  check((await page.$$('.claim')).length === 3, '粗拆出 3 条断言');
  check((await status()) === '不可引用', '未核实的事实类 → 不可引用');
  await page.selectOption('.claim:nth-child(2) [data-f=type]', '引用');
  await page.selectOption('.claim:nth-child(3) [data-f=type]', '建议');
  await page.selectOption('.claim:nth-child(1) [data-f=status]', '已核实');
  check((await status()) === '不可引用', '仍有未核的引用类 → 不可引用');
  await page.selectOption('.claim:nth-child(2) [data-f=checkability]', '无法核实');
  check((await status()) === '核实中', '无法核实不计入;建议类未核 → 核实中');
  await page.selectOption('.claim:nth-child(3) [data-f=status]', '已核实');
  check((await status()) === '可引用', '全部可查已核实 → 可引用');
  await page.selectOption('.claim:nth-child(1) [data-f=status]', '有误');
  check((await status()) === '需修正', '有误 → 需修正');
  await page.selectOption('.claim:nth-child(1) [data-f=status]', '已核实');
  // 证据链接:javascript: 被拒,http(s) 通过
  await page.fill('.claim:nth-child(1) [data-f=evidenceUrl]', 'javascript:alert(1)');
  check(await page.isVisible('.claim:nth-child(1) [data-role=url-err]'), 'javascript: 链接显示错误且不保存');
  await page.fill('.claim:nth-child(1) [data-f=evidenceUrl]', 'https://example.com/a');
  check(!(await page.isVisible('.claim:nth-child(1) [data-role=url-err]')), 'https 链接通过');
  // 证据链接改动后,「打开证据链接」立即跟着变
  const link1 = page.locator('.claim:nth-child(1) [data-role=open-link]');
  check(await link1.isVisible() && (await link1.getAttribute('href')) === 'https://example.com/a', '有效链接:出现「打开证据链接」并指向该地址');
  await page.fill('.claim:nth-child(1) [data-f=evidenceUrl]', 'https://example.com/b');
  check((await link1.getAttribute('href')) === 'https://example.com/b', '改了证据链接:按钮立即指向新地址,不再指向旧地址');
  await page.fill('.claim:nth-child(1) [data-f=evidenceUrl]', 'ftp://bad');
  check(await link1.isHidden(), '输入非法链接:按钮隐藏,不再指向旧地址');
  await page.fill('.claim:nth-child(1) [data-f=evidenceUrl]', '');
  check(await link1.isHidden(), '清空链接:按钮隐藏');
  await page.fill('.claim:nth-child(1) [data-f=evidenceUrl]', 'https://example.com/a');
  check(await link1.isVisible() && (await link1.getAttribute('href')) === 'https://example.com/a', '改回有效链接:按钮重新出现');
  // 已核实的断言改文字 → 重置为未核并标注「待重新核实」,保留旧证据
  await page.fill('.claim:nth-child(1) [data-f=evidenceText]', '示例来源');
  check((await status()) === '可引用', '改文字前:全部可查已核实 → 可引用');
  const origText = await page.inputValue('.claim:nth-child(1) [data-f=text]');
  await page.fill('.claim:nth-child(1) [data-f=text]', '乙公司成立于2001年');
  check((await page.inputValue('.claim:nth-child(1) [data-f=status]')) === '未核', '已核实的断言改成另一条事实后,状态自动重置为「未核」');
  check(await page.isVisible('.claim:nth-child(1) [data-role=stale]') && (await page.textContent('.claim:nth-child(1) [data-role=stale-from]')) === origText, '显示「待重新核实」并写出被核实过的原文');
  check((await page.inputValue('.claim:nth-child(1) [data-f=evidenceText]')) === '示例来源' && (await page.inputValue('.claim:nth-child(1) [data-f=evidenceUrl]')) === 'https://example.com/a', '旧证据(文本与链接)保留供对照');
  check((await status()) !== '可引用', '改文字后整份答案不再是「可引用」(当前:' + (await status()) + ')');
  check((await page.textContent('#status-panel')).includes('重新核实'), '结论原因里写明有断言需要重新核实');
  await page.fill('.claim:nth-child(1) [data-f=text]', origText);
  await page.selectOption('.claim:nth-child(1) [data-f=status]', '已核实');
  check(await page.isHidden('.claim:nth-child(1) [data-role=stale]'), '重新选择状态后「待重新核实」提示消失');
  await page.fill('.claim:nth-child(1) [data-f=evidenceText]', '示例来源');
  await page.waitForTimeout(500);
  // 合并第 3 条进第 2 条(两条都带证据链接,合并后不得丢失)
  await page.fill('.claim:nth-child(2) [data-f=evidenceUrl]', 'https://example.com/second');
  await page.fill('.claim:nth-child(3) [data-f=evidenceUrl]', 'https://example.com/third');
  await page.click('.claim:nth-child(3) [data-act=merge]');
  check((await page.$$('.claim')).length === 2, '合并后剩 2 条');
  check((await page.inputValue('.claim:nth-child(2) [data-f=text]')).includes('，建议立即采购'), '合并后文本拼接');
  check((await page.inputValue('.claim:nth-child(2) [data-f=evidenceUrl]')) === 'https://example.com/second' && (await page.inputValue('.claim:nth-child(2) [data-f=evidenceText]')).includes('https://example.com/third'), '合并后两个证据链接都保留');

  // C 拷问
  await page.click('[data-tab=probe]');
  await page.selectOption('#p-kind', 'self'); await page.click('#p-gen');
  check((await page.inputValue('#p-out')).includes('最可能错的三处') && (await page.inputValue('#p-out')).includes('甲公司的基本情况'), '自我批判模板含上下文');
  await page.selectOption('#p-kind', 'improve');
  await page.selectOption('#p-claim', { index: 0 }); await page.click('#p-gen');
  check((await page.inputValue('#p-out')).includes('保留结论,只修正第 1 条断言'), '改进模板含条号');
  await page.selectOption('#p-kind', 'cross'); await page.fill('#p-other', '另一个模型的答案XYZ'); await page.click('#p-gen');
  check((await page.inputValue('#p-out')).includes('另一个模型的答案XYZ') && (await page.inputValue('#p-out')).includes('模型X'), '交叉模板含对方答案与模型名');
  check(!(await page.isDisabled('#p-copy')), '生成后复制按钮可用');
  await page.fill('#p-other', '改动后的对方答案');
  check((await page.isDisabled('#p-copy')) && (await page.inputValue('#p-out')) === '', '修改输入后提示词作废且复制禁用');
  await page.click('#p-gen');
  await page.selectOption('#p-kind', 'self');
  check((await page.isDisabled('#p-copy')) && (await page.inputValue('#p-out')) === '', '切换模板后提示词作废且复制禁用');
  await page.click('#p-gen');
  await page.click('[data-tab=verify]'); await page.fill('#t-answer', '改过的答案。第二句'); await page.click('[data-tab=probe]');
  check(await page.isDisabled('#p-copy'), '修改答案/切换页面后复制禁用');
  // 答案文字在拆断言之后被改过:提示旧断言需要重新对应
  await page.click('[data-tab=verify]');
  check(await page.isVisible('#answer-changed') && (await page.textContent('#answer-changed-text')).includes('2 条断言'), '答案改动后提示:已有断言可能不再对应当前答案');
  await page.click('#confirm-claims');
  check(await page.isHidden('#answer-changed'), '点「确认断言仍对应当前答案」后提示消失');
  await page.click('[data-tab=probe]');
  await page.fill('#r-n', '1'); await page.selectOption('#r-kind', 'self'); await page.fill('#r-fixed', '2'); await page.fill('#r-summary', '改了两处');
  await page.click('#round-form button[type=submit]');
  await page.fill('#r-n', '2'); await page.fill('#r-fixed', '99999999'); await page.fill('#r-summary', '边界值');
  await page.click('#round-form button[type=submit]');
  check((await page.$$('.round')).length === 2, '记录了 2 轮');
  await page.fill('#r-fixed', '-1'); await page.click('#round-form button[type=submit]');
  check(await page.isVisible('#round-error'), '非法修正数被拒并提示');

  // D 导出
  await page.click('[data-tab=data]');
  let [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-md')]);
  let md = await read(dl);
  check(md.includes('## 断言表') && md.includes('## 拷问轮次') && md.includes("'=1+1是它的口号"), 'Markdown 含断言表/拷问轮次且公式被加引号');
  [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-csv')]);
  const csv = await read(dl);
  check(csv.includes("'=1+1是它的口号"), 'CSV 公式防护');
  [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-json')]);
  const json = await read(dl);
  check(JSON.parse(json).app === 'answer-check', 'JSON 备份可解析');

  // E 边界值保存后 reload 仍在
  await page.click('[data-tab=verify]');
  await page.fill('#t-answer', '长'.repeat(100000));
  await page.click('#t-model'); await page.waitForTimeout(600);
  await page.reload();
  check((await page.inputValue('#t-answer')).length === 100000, '10 万字答案保存并 reload 后仍在');
  check((await taskCount()) === 1 && (await page.$$('.claim')).length === 2, 'reload 后任务与断言还在');
  check(await page.isVisible('#answer-changed'), '答案改动提示 reload 后仍在(已保存)');
  await page.click('[data-tab=probe]');
  check((await page.textContent('#rounds')).includes('修正 99999999 条'), '超大修正数 reload 后仍在');

  // F 导入:非法整份拒绝;合法需确认
  await page.click('[data-tab=data]');
  const bad = JSON.parse(json); bad.tasks[0].claims[0].evidenceUrl = 'javascript:alert(1)';
  await page.setInputFiles('#import-file', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
  await page.waitForSelector('#import-error:not([hidden])');
  check((await page.textContent('#import-error')).includes('被拒绝') && (await taskCount()) === 1, '含 javascript: 的备份整份拒绝,原数据不变');
  await page.setInputFiles('#import-file', { name: 'good.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await page.waitForSelector('#confirm-bar:not([hidden])');
  await page.click('#confirm-no');
  check(!(await page.isVisible('#confirm-bar')), '导入替换可取消');
  await page.setInputFiles('#import-file', { name: 'good.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await page.waitForSelector('#confirm-bar:not([hidden])');
  await page.click('#confirm-yes');
  check((await taskCount()) === 1, '合法备份确认后导入');

  // G 载入示例:已有数据先确认
  const titleBefore = await page.textContent('.task-item-title');
  await page.click('#load-sample');
  check(await page.isVisible('#confirm-bar'), '已有数据时载入示例先出现替换确认');
  check((await page.textContent('.task-item-title')) === titleBefore, '确认前原状态保留');
  await page.click('#confirm-no');
  check((await taskCount()) === 1 && (await page.textContent('.task-item-title')) === titleBefore, '取消后原任务仍在');
  await page.click('#load-sample'); await page.click('#confirm-yes');
  await page.waitForSelector('.claim');
  check((await taskCount()) === 2, '确认后载入 2 个示例任务');
  check((await status()) === '需修正', '示例任务 1 状态为需修正');
  const rateNote = await page.textContent('#rate-note');
  const rm = rateNote.match(/(\d+) ÷ (\d+)/);
  check(rm && Number(rm[1]) <= Number(rm[2]) && rateNote.includes('已核实的可查/需实验断言 ÷ 全部可查/需实验断言'), '核实率旁写出分子分母与口径:' + (rm ? rm[0] : rateNote));
  check(rateNote.includes('无法核实') && rateNote.includes('不计入'), '口径里说明无法核实类不计入');
  await page.evaluate(() => document.getElementById('status-panel').scrollIntoView());
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png') });
  await noOverflow('桌面');

  // H 示例的统计与导出
  await page.click('[data-tab=probe]');
  await page.selectOption('#p-kind', 'self'); await page.click('#p-gen');
  await page.click('[data-tab=data]');
  [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-md')]);
  md = await read(dl);
  check(md.includes('结论状态:需修正') && md.includes('无法核实的断言'), '示例报告含结论状态与无法核实单列');
  const modelRows = await page.$$eval('#model-stats tbody tr', r => r.length);
  check(modelRows === 2, '按模型汇总 2 行');
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png') });

  // I 手机
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('[data-tab=verify]');
  await page.waitForTimeout(200);
  await noOverflow('手机');
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
  await page.click('[data-tab=data]'); await noOverflow('手机-统计页');
  await page.close();

  // J 存储失败不能静默
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(() => {
    Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
  });
  const p2 = await ctx.newPage(); watch(p2, '存储失败页');
  await p2.goto(URL);
  await p2.click('#new-task');
  check(await p2.isVisible('#save-warning'), '存储写入失败时显示持续可见的「未保存」提示');
  check(!(await p2.textContent('#toast')).includes('已'), '失败时不显示成功提示');
  await p2.close(); await ctx.close();

  // K ?today 非法回退(不自动进位)
  const p3 = await browser.newPage({ viewport: { width: 1440, height: 900 } }); watch(p3, 'today页');
  await p3.goto(URL + '?today=2026-02-30');
  await p3.click('#new-task');
  const d = await p3.inputValue('#t-date');
  check(/^\d{4}-\d{2}-\d{2}$/.test(d) && d !== '2026-02-30' && d !== '2026-03-02', `?today=2026-02-30 回退真实今天 (${d})`);
  await p3.close();

  // L 展示图
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  watch(show, 'showcase');
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(300);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();

  console.log(`断言数:${asserts}`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
