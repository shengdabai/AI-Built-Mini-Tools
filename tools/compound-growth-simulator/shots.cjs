'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const URL = 'file://' + encodeURI(path.join(__dirname, 'index.html')) + '?today=2026-10-20';
const OUT = path.join(__dirname, 'screenshots');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });
  const problems = [];
  let asserts = 0;
  const ok = (cond, msg) => { asserts++; console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) problems.push(msg); };
  const watch = (page, tag) => {
    page.on('console', m => { if (m.type() === 'error') problems.push(tag + ' console: ' + m.text()); });
    page.on('pageerror', e => problems.push(tag + ' pageerror: ' + e.message));
  };

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  watch(page, 'main');
  const pathD = (sel) => page.getAttribute(sel, 'd');
  const setRange = async (sel, v) => {
    await page.$eval(sel, (e, val) => { e.value = String(val); }, v);
    await page.dispatchEvent(sel, 'input');
  };
  const val = (sel) => page.inputValue(sel);
  const noOverflow = async (label) => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    ok(sw <= iw, `${label} scrollWidth ${sw} <= innerWidth ${iw}`);
  };

  // ---- 空状态
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('#chart .series');
  ok(await page.isVisible('#empty-guide'), '空状态引导可见');
  ok(await page.$$eval('#chart .series', n => n.length) === 1, '空状态画出 1 条情景曲线');
  ok(await page.$$eval('#chart .series-linear', n => n.length) === 1, '线性对照线存在');
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

  // ---- 滑杆 / 数字输入双向联动 + 图表重绘
  let d0 = await pathD('#chart .series.s0');
  const n0 = await page.$$eval('#chart .series.s0', e => e[0].getAttribute('d').length);
  await setRange('#r-range', 2);
  let d1 = await pathD('#chart .series.s0');
  ok(d1 !== d0, 'r 滑杆拖动后曲线 path d 改变');
  ok(await val('#r-num') === '2', 'r 滑杆 → 数字输入联动 (2)');
  await page.fill('#r-num', '0.5');
  let d2 = await pathD('#chart .series.s0');
  ok(d2 !== d1, 'r 数字输入后曲线 path d 改变');
  ok(await val('#r-range') === '0.5', 'r 数字输入 → 滑杆联动 (0.5)');
  const finalText = await page.textContent('#stats li');
  ok(/365 天后 ×6\.17/.test(finalText), `统计卡随 r=0.5% 更新:${finalText.replace(/\s+/g, ' ').trim()}`);

  // 半成品 / 越界输入:不应用,保留上一个有效值
  await page.fill('#r-num', '5');
  ok(await page.isVisible('#param-error'), 'r=5 越界显示错误');
  ok(await pathD('#chart .series.s0') === d2, 'r=5 越界时曲线保持不变');
  await page.fill('#r-num', '');
  ok(await page.isVisible('#param-error'), 'r 清空显示错误');
  ok(await pathD('#chart .series.s0') === d2, 'r 为空时曲线保持不变');
  await page.fill('#r-num', '1');
  ok(!(await page.isVisible('#param-error')), '改回有效值后错误消失');
  d1 = await pathD('#chart .series.s0');

  // 时长 T:轴刻度与曲线都变
  const ticksBefore = await page.$$eval('#chart .tick', e => e.map(x => x.textContent).join('|'));
  await page.fill('#t-num', '1000');
  ok(await val('#t-range') === '1000', 'T 数字 → 滑杆联动 (1000)');
  const ticksAfter = await page.$$eval('#chart .tick', e => e.map(x => x.textContent).join('|'));
  ok(ticksBefore !== ticksAfter, 'T 改变后 X 轴刻度重绘');
  await setRange('#t-range', 500);
  ok(await val('#t-num') === '500', 'T 滑杆 → 数字联动 (500)');
  await page.fill('#t-num', '100.5');
  ok(await page.isVisible('#param-error'), 'T 非整数被拒绝');
  await page.fill('#t-num', '365');
  d1 = await pathD('#chart .series.s0');

  // 休息日
  await setRange('#rest-range', 2);
  ok(await val('#rest-num') === '2', '休息天数滑杆 → 数字联动');
  ok(await pathD('#chart .series.s0') !== d1, '休息 2 天后曲线改变');
  await page.fill('#rest-num', '0');
  ok(await pathD('#chart .series.s0') === d1, '休息改回 0 曲线还原');

  // 回退事件
  await page.click('#add-event');
  ok(await page.$$eval('.event-row', n => n.length) === 1, '添加回退事件出现一行');
  const withEv = await pathD('#chart .series.s0');
  ok(withEv !== d1, '回退事件使曲线改变');
  await page.fill('#ev-fac-0', '0.5');
  ok(await pathD('#chart .series.s0') !== withEv, '改回退乘数后曲线再变');
  await page.fill('#ev-day-0', '9999');
  ok(await page.isVisible('#param-error'), '事件日越界被拒绝');
  await page.fill('#ev-day-0', '200');
  await page.fill('#t-num', '150');
  ok(await val('#ev-day-0') === '150', 'T 缩小后事件日自动不超过 T');
  // 倍率事件的日期与倍率 k 都有滑杆,与数字输入双向联动
  ok(await page.isVisible('#ev-day-0-range') && await page.isVisible('#ev-fac-0-range'), '倍率事件的日期与倍率 k 各有一个滑杆');
  const dBeforeEvRange = await pathD('#chart .series.s0');
  await setRange('#ev-day-0-range', 60);
  ok(await val('#ev-day-0') === '60' && await pathD('#chart .series.s0') !== dBeforeEvRange, '事件日滑杆 → 数字输入联动,曲线改变');
  await page.fill('#ev-day-0', '90');
  ok(await val('#ev-day-0-range') === '90', '事件日数字输入 → 滑杆联动');
  const dBeforeFac = await pathD('#chart .series.s0');
  await setRange('#ev-fac-0-range', 2);
  ok(await val('#ev-fac-0') === '2' && await pathD('#chart .series.s0') !== dBeforeFac, '倍率 k 滑杆 → 数字输入联动,曲线改变(k 大于 1 表示增长)');
  await page.fill('#ev-fac-0', '0.5');
  ok(await val('#ev-fac-0-range') === '0.5', '倍率 k 数字输入 → 滑杆联动');
  ok((await page.textContent('#params')).includes('小于 1 表示回退,大于 1 表示增长') && (await page.textContent('#params')).includes('添加倍率事件'), '事件改称「倍率事件」并注明小于 1 回退、大于 1 增长');
  ok((await page.textContent('.scale-note')).includes('相同高度差表示相同倍数变化') && (await page.textContent('.scale-note')).includes('相同高度差表示相同数值变化'), '刻度选择旁说明对数 / 线性怎么读');
  ok((await page.textContent('#export-csv')) === '导出第 1–365 天 CSV' && (await page.textContent('.card:has(#export-csv)')).includes('不覆盖完整时长 T'), 'CSV 按钮改名为第 1–365 天并说明不覆盖完整 T');
  await page.fill('#t-num', '365');
  await page.click('.event-row button');
  ok(await page.$$eval('.event-row', n => n.length) === 0, '删除事件');

  // Y 轴刻度切换
  const dLog = await pathD('#chart .series.s0');
  await page.selectOption('#y-scale', 'linear');
  ok(await pathD('#chart .series.s0') !== dLog, '切换线性刻度后曲线重绘');
  await page.selectOption('#y-scale', 'log');

  // 悬停 tooltip
  const box = await page.locator('#chart .hit-area').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  ok(await page.isVisible('#tooltip'), '悬停显示 tooltip');
  const tip = await page.textContent('#tooltip');
  ok(/第 \d+ 天/.test(tip) && /×/.test(tip), `tooltip 内容:${tip.trim().slice(0, 40)}`);
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2);
  const tip2 = await page.textContent('#tooltip');
  ok(tip2 !== tip, '移动鼠标后 tooltip 随天数变化');
  await page.mouse.move(2, 2);

  // 目标反算
  await page.fill('#target-num', '10');
  ok((await page.textContent('#target-result')).includes('232'), '目标 10× 反算为 232 天');
  const rows = await page.$$eval('#ref-table tbody tr', r => r.length);
  ok(rows === 4, '对照表 4 行 (100/365/1000/3650)');

  // 周频
  await page.check('#weekly-show');
  ok(await page.$$eval('#chart .series-weekly', n => n.length) === 1, '叠加周频曲线');
  await page.fill('#r7-num', '5');
  ok(await val('#r7-range') === '5', '周频 r₇ 数字 → 滑杆联动');
  ok((await page.textContent('#weekly-info')).includes('7.2135'), '周频等效换算:r=1% 每周 7.2135%');
  await page.uncheck('#weekly-show');

  // ---- 示例载入需确认
  const nameBefore = await val('#p-name');
  await page.click('#load-sample');
  ok(await page.isVisible('#confirm-box'), '已有数据时载入示例先出现替换确认');
  ok(await val('#p-name') === nameBefore && await page.$$eval('#chart .series', n => n.length) === 1, '确认前保留原状态');
  await page.click('#confirm-no');
  ok(!(await page.isVisible('#confirm-box')) && await val('#p-name') === nameBefore, '取消后原状态不变');
  await page.click('#load-sample');
  await page.click('#confirm-yes');
  ok(await page.$$eval('#chart .series', n => n.length) === 3, '确认后载入 3 组情景(3 条曲线)');
  ok(await page.isVisible('#sample-badge'), '显示「合成示例」标注');
  const rowsCmp = await page.$$eval('#compare-table tbody tr', r => r.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  ok(rowsCmp.length === 3 && rowsCmp[0].includes('每天 1%') && !rowsCmp[0].includes('回退'), `情景比较 3 行,第 1 名为「每天 1%」:${rowsCmp[0]}`);
  ok(rowsCmp[0].includes('最快'), '最快情景标注');
  await page.click('.scenario-btn >> nth=1');
  ok(await val('#p-name') === '每天 0.3% 休两天' && await val('#rest-num') === '2', '切换到情景 2 后参数面板同步');
  await page.click('.scenario-btn >> nth=2');
  ok(await val('#ev-day-0') === '200', '情景 3 的回退事件载入');
  await page.click('.scenario-btn >> nth=0');
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png') });
  await noOverflow('桌面');

  // ---- 导出 / 导入
  const [dlCsv] = await Promise.all([page.waitForEvent('download'), page.click('#export-csv')]);
  const csvText = fs.readFileSync(await dlCsv.path(), 'utf8');
  ok(csvText.split('\n').filter(l => /^\d+,/.test(l)).length === 365, 'CSV 含 365 个数据点');
  ok(dlCsv.suggestedFilename().endsWith('.csv'), 'CSV 文件名:' + dlCsv.suggestedFilename());
  const [dlJson] = await Promise.all([page.waitForEvent('download'), page.click('#export-json')]);
  const exported = JSON.parse(fs.readFileSync(await dlJson.path(), 'utf8'));
  ok(exported.scenarios.length === 3, 'JSON 备份含 3 组情景');

  const badImport = JSON.parse(JSON.stringify(exported));
  badImport.scenarios[1].r = 0.05;
  await page.setInputFiles('#import-file', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(badImport)) });
  await page.waitForSelector('#import-error:not([hidden])');
  ok((await page.textContent('#import-error')).includes('日成长率'), 'r>3% 的导入被整份拒绝并说明原因');
  ok(await page.$$eval('.scenario-btn', n => n.length) === 3, '拒绝后原状态不变');
  const badEv = JSON.parse(JSON.stringify(exported));
  badEv.scenarios[2].events[0].day = 999;
  await page.setInputFiles('#import-file', { name: 'bad2.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(badEv)) });
  await page.waitForFunction(() => document.querySelector('#import-error').textContent.includes('事件日'));
  ok(true, '事件日越界的导入被拒绝');
  const badT = JSON.parse(JSON.stringify(exported));
  badT.scenarios[0].days = 365.5;
  await page.setInputFiles('#import-file', { name: 'bad3.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(badT)) });
  await page.waitForFunction(() => document.querySelector('#import-error').textContent.includes('整数'));
  ok(true, 'T 非整数的导入被拒绝');

  const good = JSON.parse(JSON.stringify(exported));
  good.scenarios = [good.scenarios[0]];
  good.activeId = good.scenarios[0].id;
  good.scenarios[0].name = '=HYPERLINK("http://x")';
  await page.setInputFiles('#import-file', { name: 'good.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(good)) });
  ok(await page.isVisible('#confirm-box'), '合法导入先出现替换确认');
  await page.click('#confirm-yes');
  ok(await page.$$eval('.scenario-btn', n => n.length) === 1 && !(await page.isVisible('#import-error')), '合法导入替换为 1 组情景');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#export-csv')]);
  const csv2 = fs.readFileSync(await dl2.path(), 'utf8');
  ok(csv2.includes(`"'=HYPERLINK(""http://x"")"`), 'CSV 公式防护:情景名以单引号前缀');
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png') });

  // ---- 边界值保存后 reload 仍在
  const long = '超长名称'.repeat(15);
  await page.fill('#p-name', long);
  await page.fill('#r-num', '3');
  await page.fill('#t-num', '3650');
  await page.click('#add-event');
  await page.fill('#ev-day-0', '3650');
  await page.fill('#ev-fac-0', '0.01');
  ok((await page.textContent('#save-status')).includes('已保存'), '写入成功后才显示已保存');
  await page.reload();
  await page.waitForSelector('#chart .series');
  ok(await val('#p-name') === long && await val('#t-num') === '3650' && await val('#r-num') === '3' && await val('#ev-day-0') === '3650' && await val('#ev-fac-0') === '0.01', '边界值(60 字名称 / r=3% / T=3650 / 事件日=T / k=0.01)reload 后仍在');
  ok(!(await page.isVisible('#load-notice')), 'reload 后没有“数据被拒绝”提示');
  ok(await page.isHidden('#empty-guide'), '已有保存数据时不再显示空状态引导');

  // ---- 删除情景先确认;导入入口是可聚焦按钮
  await page.click('#add-scenario');
  const nScen = await page.$$eval('.scenario-btn', n => n.length);
  await page.click('#delete-scenario');
  ok(await page.isVisible('#confirm-box') && (await page.textContent('#confirm-text')).includes('确认删除情景') && (await page.textContent('#confirm-text')).includes('倍率事件'), '删除情景先出现页内确认并写明情景、r、T、事件数');
  ok(await page.$$eval('.scenario-btn', n => n.length) === nScen, '确认之前情景数不变');
  await page.click('#confirm-no');
  ok(await page.$$eval('.scenario-btn', n => n.length) === nScen && await page.evaluate(() => document.activeElement && document.activeElement.id === 'delete-scenario'), '取消后情景保留,焦点回到「删除当前情景」');
  await page.click('#delete-scenario');
  await page.click('#confirm-yes');
  ok(await page.$$eval('.scenario-btn', n => n.length) === nScen - 1, '确认后删除 1 组情景');
  ok((await page.$eval('#pick-import', e => e.tagName)) === 'BUTTON', '导入 JSON 备份入口是 button(可聚焦)');
  await page.focus('#pick-import');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Enter')]);
  ok(!!chooser, '按 Enter 可打开备份文件选择');

  // ---- 清空需确认
  await page.click('#clear-data');
  ok(await page.isVisible('#confirm-box'), '清空前出现页内确认');
  await page.click('#confirm-no');
  ok(await val('#t-num') === '3650', '取消清空后数据仍在');
  await page.click('#clear-data');
  await page.click('#confirm-yes');
  ok(await val('#t-num') === '365' && await page.isVisible('#empty-guide'), '确认清空后回到默认并显示引导');

  // ---- 手机
  await page.click('#load-sample');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const mw = await page.$eval('#chart', s => Number(s.getAttribute('viewBox').split(' ')[2]));
  ok(mw <= 390, `手机图表宽度 ${mw} <= 390`);
  const mPath = await pathD('#chart .series.s0');
  await setRange('#r-range', 2);
  ok(await pathD('#chart .series.s0') !== mPath, '手机端滑杆同样即时重绘');
  await noOverflow('手机');
  await page.click('#add-event');
  ok(await page.isVisible('#ev-day-0-range') && await page.isVisible('#ev-fac-0-range'), '手机端倍率事件两个滑杆可见');
  await noOverflow('手机-含倍率事件');
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
  await page.close();

  // ---- 存储失败不能静默
  const bad = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(bad, 'quota');
  await bad.addInitScript(() => {
    Storage.prototype.setItem = function () { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; };
  });
  await bad.goto(URL);
  await bad.fill('#r-num', '1.5');
  ok(await bad.isVisible('#save-warning') && (await bad.textContent('#save-warning')).includes('未保存'), 'setItem 抛 QuotaExceededError 时显示持续可见的「未保存」提示');
  ok(!(await bad.textContent('#save-status')).includes('已保存'), '写入失败时不显示「已保存」');
  ok(await bad.$eval('#chart .series.s0', e => e.getAttribute('d').length > 0), '写入失败时界面仍可继续使用');
  await bad.click('#load-sample');
  ok(await bad.isVisible('#confirm-box'), '配额失败后载入示例仍先弹出替换确认');
  await bad.click('#confirm-no');
  ok(await bad.inputValue('#r-num') === '1.5', '配额失败后取消载入,内存中的修改保留');
  await bad.close();

  // ---- 展示图
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  watch(show, 'showcase');
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(400);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();

  console.log(`断言总数:${asserts}`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
