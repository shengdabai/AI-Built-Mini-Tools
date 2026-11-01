'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const BASE = 'file://' + encodeURI(path.join(__dirname, 'index.html'));
const URL = BASE + '?today=2026-10-20';
const OUT = path.join(__dirname, 'screenshots');

let backupJson = '';
let asserts = 0;
const problems = [];
function check(cond, msg) {
  asserts++;
  console.log((cond ? 'ok   ' : 'FAIL ') + msg);
  if (!cond) problems.push(msg);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  const noOverflow = async label => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    check(sw <= iw, `${label}: scrollWidth ${sw} <= innerWidth ${iw}`);
  };
  const text = sel => page.textContent(sel);

  // 1. 空状态
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  check((await text('#empty-state')).includes('先有规则'), '空状态显示引导');
  check(await page.isVisible('#import-btn') && await page.isVisible('#empty-import'), '空状态下顶部「导入 JSON 备份」与引导里「从 JSON 备份恢复」都可见');
  check((await text('#today-note')).includes('基准日 2026-10-20(由地址参数固定)') && await page.isVisible('#today-note'), '?today 生效时持续显示基准日说明');
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

  // 2. 载入示例,核心流程
  await page.click('#load-sample');
  await page.waitForSelector('.practice-item');
  check((await page.$$('.practice-item')).length === 3, '示例载入 3 条践行');
  check((await text('#status')).includes('已保存到本机浏览器'), '写入成功后才显示已保存');
  check((await text('#detail-head')).includes('合成示例'), '详情标注合成示例');

  // 每日写作:选中 → 缺勤 → 按规则完成今天
  await page.click('.practice-item >> nth=1');
  check(await page.evaluate(() => document.activeElement.classList.contains('practice-item') && document.activeElement.getAttribute('aria-current') === 'true'), '选中践行后列表重绘,焦点仍在该践行按钮上');
  await page.click('.practice-item >> nth=0');
  const missedBefore = Number((await text('#missed h3')).match(/(\d+)/)[1]);
  check(missedBefore === 9, `写作缺勤自动显示为 9 天(实际 ${missedBefore})`);
  const streakBefore = (await text('#stats .stat >> nth=0')).replace(/\s+/g, '');
  const guardBefore = await text('#guard .guard-line');
  check(guardBefore.includes('本周还需执行'), '规则守卫显示:' + guardBefore);
  check((await page.$$('[data-tab] , .tab')).length === 3, '三个标签页');
  const hasPause = await page.evaluate(() => /暂停/.test(Array.from(document.querySelectorAll('button')).map(b => b.textContent).join('')));
  check(!hasPause, '界面上没有任何「暂停」按钮');
  await page.click('#do-today');
  await page.waitForTimeout(100);
  const guardAfter = await text('#guard .guard-line');
  check(guardAfter !== guardBefore, `按规则完成后守卫变化:${guardBefore} → ${guardAfter}`);
  check((await text('#recent')).includes('2026-10-20'), '最近记录出现今天');
  const streakAfter = (await text('#stats .stat >> nth=0')).replace(/\s+/g, '');
  check(streakAfter.includes('连续8天') || streakAfter.includes('连续9天'), '连续天数已重新计算:' + streakAfter + '(之前 ' + streakBefore + ')');

  // 今天已有记录:按钮改为「查看/修改」,不直接覆盖;改值要先确认新旧数值
  check((await text('#do-today')).includes('查看/修改今日记录(已记 500 字)'), '已有今日记录时按钮改名并显示当前值:' + (await text('#do-today')));
  const recCount0 = (await page.$$('#recent .rec-list li')).length;
  await page.click('#do-today');
  check((await page.inputValue('#rec-value')) === '500' && (await page.evaluate(() => document.activeElement.id)) === 'rec-value' && (await text('#status')).includes('没有覆盖'), '点「查看/修改」只带出当前值并聚焦,不改记录');
  await page.fill('#rec-value', '300');
  await page.click('#rec-submit');
  const owText = await text('#overwrite-text');
  check(await page.isVisible('#overwrite-confirm') && owText.includes('已记录 500 字') && owText.includes('改为 300 字'), '覆盖已有记录前页内确认并写明新旧数值:' + owText);
  check((await text('#recent')).includes('2026-10-20 · 500 字'), '确认前旧值仍在最近记录里');
  await page.click('#ow-no');
  check(await page.isHidden('#overwrite-confirm') && (await text('#recent')).includes('2026-10-20 · 500 字'), '取消覆盖后记录不变');
  await page.click('#rec-submit');
  await page.click('#ow-yes');
  check((await text('#recent')).includes('2026-10-20 · 300 字') && (await page.$$('#recent .rec-list li')).length === recCount0, '确认覆盖后才更新为 300,记录条数不变');
  await page.fill('#rec-value', '300');
  await page.click('#rec-submit');
  check(await page.isHidden('#overwrite-confirm') && (await text('#status')).includes('没有改动'), '提交相同的值不弹确认,提示没有改动');

  // 执行率口径与热力条标题
  check((await text('#stats')).includes('不表示完成定额的比例') && (await text('#heat')).includes('每周一行、每天一格'), '统计旁写明执行率口径(有记录即算一次、不看定额)');

  // 删除记录先在记录旁确认,确认前统计不变
  const statsBeforeDel = await text('#stats');
  const delDate = await page.getAttribute('#recent [data-del] >> nth=1', 'data-del');
  await page.click('#recent [data-del] >> nth=1');
  check(await page.isVisible('#del-yes') && (await text('#recent .rec-confirm')).includes(delDate) && (await text('#stats')) === statsBeforeDel, '删除记录先出现页内确认(写明日期),确认前统计不变');
  await page.click('#del-no');
  check((await page.$$('#recent .rec-confirm')).length === 0 && (await text('#recent')).includes(delDate) && (await text('#stats')) === statsBeforeDel, '取消删除后记录与统计不变');
  await page.click('#recent [data-del] >> nth=1');
  await page.click('#del-yes');
  check(!(await text('#recent')).includes(delDate) && (await text('#stats')) !== statsBeforeDel, '确认删除后记录消失、统计重新计算');
  check(await page.evaluate(() => document.activeElement.hasAttribute('data-del') || document.activeElement.id === 'do-today'), '删除后焦点落在下一条记录的删除按钮上');

  // 补录一个缺勤日(点未执行 chip)
  const missedPre = Number((await text('#missed h3')).match(/(\d+)/)[1]);
  check(missedPre === missedBefore + 1, `删除一条记录后缺勤 ${missedBefore} → ${missedPre}(统计随之重新计算)`);
  await page.click('#missed .chip-missed >> nth=0');
  await page.fill('#rec-value', '300');
  await page.click('#rec-submit');
  await page.waitForTimeout(100);
  const missedAfter = Number((await text('#missed h3')).match(/(\d+)/)[1]);
  check(missedAfter === missedPre - 1, `补录后缺勤 ${missedPre} → ${missedAfter}`);
  // 非法记录被拒绝
  await page.fill('#rec-value', '0');
  await page.click('#rec-submit');
  check(!(await page.$eval('#rec-msg', e => e.hidden)), '值为 0 时给出提示而不是写入');
  check((await page.getAttribute('#rec-value', 'aria-invalid')) === 'true' && (await page.getAttribute('#rec-value', 'aria-describedby')) === 'rec-msg' && (await page.evaluate(() => document.activeElement.id)) === 'rec-value', '值为 0 时错误贴近「实际值」输入:aria-invalid + aria-describedby + 聚焦');
  // 超限值:拒绝写入,刷新后数据仍在
  const countBefore = (await page.$$('#recent .rec-list li')).length;
  const totalBefore = await text('#stats');
  await page.fill('#rec-value', '10000000000000');
  await page.fill('#rec-date', '2026-10-19');
  await page.click('#rec-submit');
  check((await text('#rec-msg')).includes('没有写入'), '超限值(1e13)被拒绝:' + (await text('#rec-msg')));
  check((await text('#stats')) === totalBefore, '拒绝后统计不变');
  await page.reload();
  check((await page.$$('.practice-item')).length === 3, '超限输入后 reload,3 条践行仍在');
  await page.click('.practice-item >> nth=0');
  check((await page.$$('#recent .rec-list li')).length === countBefore, '最近记录数不变');
  await page.fill('#rec-value', '500');
  await noOverflow('桌面(记录页)');

  // 新建一个践行并走完「结束」确认
  await page.click('#new-btn');
  await page.click('#new-form button[type=submit]');
  check((await text('#f-error')).includes('名称') && (await page.getAttribute('#f-name', 'aria-invalid')) === 'true' && (await page.evaluate(() => document.activeElement.id)) === 'f-name', '新建时名称为空:错误显示并聚焦名称输入');
  await page.fill('#f-name', '=每日阅读');
  await page.selectOption('#f-kind', 'weekly');
  await page.fill('#f-n', '4');
  await page.fill('#f-amount', '30');
  await page.fill('#f-unit', '分钟');
  await page.fill('#f-start', '2026-10-12');
  await page.fill('#f-stop', '连续两周不达标就降到每周 3 次');
  await page.click('#new-form button[type=submit]');
  await page.waitForSelector('.practice-item >> nth=3');
  check((await text('#detail-head')).includes('每周 4 次'), '新建每周 4 次的践行');
  await page.click('#do-today');
  await page.waitForTimeout(80);
  check((await text('#guard .guard-line')).includes('还需执行 3 次'), '每周 4 次完成 1 次后还需 3 次');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png') });
  await page.click('#end-btn');
  check(await page.isVisible('#end-yes'), '结束践行出现页内确认区');
  await page.click('#end-yes');
  await page.waitForTimeout(80);
  check((await text('#detail-head')).includes('已于 2026-10-20 结束'), '结束后标记已结束');
  check(await page.$eval('#do-today', e => e.disabled), '结束后不能再记录');

  // 3. 复利视图:金额型
  await page.click('.practice-item >> nth=2');
  await page.click('[data-tab="grow"]');
  const v0 = await text('#compound-out');
  check(v0.includes('12,000') , '年化 0%:累计投入 12,000(含 12 期)');
  check(v0.includes('未来新增投入的独立推算') && v0.includes('不含上面「已发生的实际记录」里的本金和增长'), '推算标题改为「未来新增投入的独立推算」并写明不含已有本金和增长');
  check((await text('#periods-label')).includes('推算月数'), '每月规则的期数标签为「推算月数」:' + (await text('#periods-label')));
  await page.click('#rate6');
  await page.waitForTimeout(50);
  const v6 = await text('#compound-out');
  check(v6 !== v0 && v6.includes('年化 6%'), '切到年化 6% 后账面值变化');
  check((await page.$$('svg.chart path')).length === 2, '曲线 SVG 含投入线与假设线');
  check((await text('#compound-card')).includes('不是预测'), '年化标注「假设,不是预测」');
  // 每周 3 次的金额型:每次 100,推算 4 周 = 1200
  await page.click('#new-btn');
  await page.fill('#f-name', '每周三次定投');
  await page.selectOption('#f-type', 'amount');
  await page.selectOption('#f-kind', 'weekly');
  await page.fill('#f-n', '3');
  await page.fill('#f-amount', '100');
  await page.click('#new-form button[type=submit]');
  await page.click('[data-tab="grow"]');
  await page.fill('#periods-input', '4');
  await page.click('#rate0');
  const w3 = await text('#compound-out');
  check((await text('#periods-label')).includes('推算周数') && (await text('#periods-hint')).includes('每周 3 次') && (await text('#periods-hint')).includes('12 次'), '每周 3 次的期数标签为「推算周数」并提示总执行次数');
  check(w3.includes('推算累计投入') && w3.includes('1,200 元') && w3.includes('共 12 次执行'), '每周 3 次、每次 100、推算 4 周:累计投入 1,200');
  await page.click('.practice-item >> nth=2');
  await page.click('[data-tab="grow"]');
  // 进步计算器
  await page.fill('#g-rate', '1');
  await page.fill('#g-days', '365');
  const g = await text('#g-out');
  check(g.includes('37.78'), '每天进步 1%、365 天 ≈ 37.78');
  check(g.includes('6.18'), '隔天做(183 次)≈ 6.18');
  await page.screenshot({ path: path.join(OUT, '05-复利曲线-桌面.png'), fullPage: true });
  await noOverflow('桌面(复利页)');

  // 4. 导出
  await page.click('[data-tab="export"]');
  const [dl1] = await Promise.all([page.waitForEvent('download'), page.click('#export-csv')]);
  const csv = fs.readFileSync(await dl1.path(), 'utf8');
  check(dl1.suggestedFilename() === 'dca-ledger-records.csv', 'CSV 文件名:' + dl1.suggestedFilename());
  check(csv.includes('践行,类型,规则') && csv.includes(',数据来源') && csv.includes(',合成示例') && csv.includes(',真实数据'), 'CSV 含表头与「数据来源」列(合成示例/真实数据)');
  await page.click('.practice-item >> nth=0');
  await page.click('[data-tab="export"]');
  await page.fill('#md-month', '2026-10');
  const prev = await text('#md-preview');
  check(prev.includes('执行率') && prev.includes('月度总结 2026-10') && prev.includes('数据来源:合成示例'), 'Markdown 预览含执行率并标注合成示例');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#export-md')]);
  const md = fs.readFileSync(await dl2.path(), 'utf8');
  check(md === prev + '' || md.trim() === prev.trim(), '下载的 Markdown 与预览一致');
  await page.fill('#md-month', '');
  check(await page.$eval('#export-md', e => e.disabled), '月份无效时禁用 Markdown 导出');
  await page.fill('#md-month', '2026-10');
  const [dl3] = await Promise.all([page.waitForEvent('download'), page.click('#export-json')]);
  const json = fs.readFileSync(await dl3.path(), 'utf8');
  check(JSON.parse(json).practices.length === 5, 'JSON 备份含 5 条践行');
  backupJson = json;
  // 非法导入:整份拒绝
  const bad = JSON.parse(json); bad.practices[0].type = 'money';
  await page.setInputFiles('#import-file', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
  await page.waitForSelector('#import-out .err-list');
  check((await text('#import-out')).includes('整份文件已拒绝'), '非法类型的 JSON 被整份拒绝并给出原因');
  check((await page.$$('.practice-item')).length === 5, '拒绝后当前数据未改动');
  await page.setInputFiles('#import-file', { name: 'junk.json', mimeType: 'application/json', buffer: Buffer.from('{not json') });
  await page.waitForSelector('#import-out .err-list');
  check((await text('#import-out')).includes('不是有效的 JSON'), '损坏的 JSON 被拒绝');
  // 合法导入:确认后替换
  const small = JSON.parse(json); small.practices = small.practices.slice(0, 2);
  await page.setInputFiles('#import-file', { name: 'ok.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(small)) });
  await page.waitForSelector('#import-yes');
  await page.click('#import-yes');
  await page.waitForTimeout(80);
  check((await page.$$('.practice-item')).length === 2, '合法 JSON 经确认后替换为 2 条践行');
  // 回到完整数据用于截图
  await page.click('#load-sample');
  await page.waitForTimeout(80);
  await page.click('.practice-item >> nth=0');
  await page.click('[data-tab="export"]');
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png'), fullPage: true });
  await noOverflow('桌面(导出页)');

  // 刷新后数据仍在
  await page.reload();
  check((await page.$$('.practice-item')).length >= 3, '刷新后数据仍在(localStorage)');

  // 清空需先确认
  await page.click('#clear-btn');
  check(await page.isVisible('#clear-yes'), '清空先出现页内确认区');
  await page.click('#clear-no');

  // 手机
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('[data-tab="log"]');
  await page.waitForTimeout(150);
  await noOverflow('手机(记录页)');
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
  await page.click('.practice-item >> nth=2');
  await page.click('[data-tab="grow"]');
  await page.waitForTimeout(100);
  await noOverflow('手机(复利页)');
  await page.click('[data-tab="export"]');
  await noOverflow('手机(导出页)');
  await page.close();

  // 存储写入失败:必须持续可见提示,且不显示「已保存」
  const failPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  failPage.on('pageerror', e => problems.push('failPage pageerror: ' + e.message));
  await failPage.addInitScript(() => {
    Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
  });
  await failPage.goto(URL);
  await failPage.click('#load-sample');
  await failPage.waitForSelector('.practice-item');
  check(await failPage.isVisible('#save-warning'), '写入失败时显示「未保存」横幅');
  check((await failPage.textContent('#save-warning')).includes('未保存'), '横幅文案含「未保存」');
  const st = await failPage.textContent('#status');
  check(!st.includes('已保存'), '写入失败时状态栏不显示「已保存」:' + st);
  await failPage.click('#do-today');
  await failPage.waitForTimeout(80);
  check(await failPage.isVisible('#save-warning'), '再次写入失败后横幅仍可见');
  await failPage.close();

  // 空状态直接恢复备份:不需要先有任何践行
  const rp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  rp.on('pageerror', e => problems.push('restore pageerror: ' + e.message));
  await rp.goto(URL);
  check(await rp.isVisible('#empty-state') && await rp.isVisible('#empty-import'), '全新浏览器:空状态里有「从 JSON 备份恢复」');
  const [fc] = await Promise.all([rp.waitForEvent('filechooser'), rp.click('#empty-import')]);
  await fc.setFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(backupJson) });
  await rp.waitForSelector('#import-yes');
  check((await rp.textContent('#import-out')).includes('5 条践行'), '空状态选备份文件后出现确认:' + (await rp.textContent('#import-out')));
  await rp.click('#import-yes');
  await rp.waitForSelector('.practice-item');
  check((await rp.$$('.practice-item')).length === 5, '空状态确认后恢复 5 条践行');
  await rp.close();

  // ?today 非法值回退不抛错
  const badToday = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  badToday.on('pageerror', e => problems.push('badToday pageerror: ' + e.message));
  badToday.on('console', m => { if (m.type() === 'error') problems.push('badToday console: ' + m.text()); });
  await badToday.goto(BASE + '?today=2026-13-45');
  await badToday.waitForSelector('#load-sample');
  check(await badToday.isVisible('#empty-state'), '?today 非法时回退真实今天,页面正常');
  await badToday.close();

  // 展示图
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  show.on('pageerror', e => problems.push('showcase pageerror: ' + e.message));
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(400);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();

  console.log(`断言共 ${asserts} 条`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
