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
  const expect = (cond, msg) => { asserts++; if (!cond) problems.push('断言失败:' + msg); };
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  const noOverflow = async label => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(`${label}: scrollWidth ${sw} <= innerWidth ${iw} -> ${sw <= iw ? 'OK' : 'FAIL'}`);
    expect(sw <= iw, `${label} 横向溢出 ${sw} > ${iw}`);
  };

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  expect(await page.isDisabled('#export-issues-csv'), '空状态下导出应禁用');
  expect(await page.isHidden('#sample-tag'), '空状态下不显示合成示例标记');
  expect(await page.isVisible('#btn-file'), '空状态下文件导入入口可见');
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

  // 载入示例 -> 核对统计
  await page.click('#btn-sample');
  await page.waitForSelector('#grid-body tr');
  const stats = await page.$$eval('#stat-grid .stat', els => els.map(e => e.textContent));
  console.log('统计卡:', stats.join(' | '));
  expect(stats[0].startsWith('25'), '数据行数应为 25');
  expect(await page.isVisible('#sample-tag'), '应显示合成示例标记');
  const formulaCount = await page.$eval('#rule-list li:nth-child(3) b', e => e.textContent);
  expect(formulaCount === '3', `期末不等应命中 3 行,实际 ${formulaCount}`);

  // 核心流程:选中全部期末不等行 -> 采用公式期末 -> 命中数归零
  await page.click('#btn-select-formula');
  const selTxt = await page.textContent('#sel-count');
  expect(selTxt.includes('3'), `应选中 3 行,实际「${selTxt}」`);
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png') });
  await noOverflow('桌面');
  await page.click('#btn-apply');
  await page.waitForTimeout(100);
  const after = await page.$eval('#rule-list li:nth-child(3) b', e => e.textContent);
  expect(after === '0', `采用公式后期末不等应为 0,实际 ${after}`);
  expect((await page.textContent('#flash')).includes('3 行'), '应出现成功提示');
  expect(await page.evaluate(() => document.activeElement.id) === 'filter', '采用公式期末重绘后焦点回到「显示」筛选框');

  // 载入示例前的覆盖确认:取消后已采用的修正必须保留
  await page.click('#btn-sample');
  expect(await page.isVisible('#replace-confirm'), '已有修正时载入示例应先确认');
  await page.click('#btn-replace-no');
  expect(!(await page.isVisible('#replace-confirm')), '取消后确认区应关闭');
  await page.selectOption('#filter', 'all');
  expect((await page.textContent('#grid-body')).includes('已采用公式'), '取消覆盖后,已采用的公式期末应保留');
  await page.selectOption('#filter', 'issues');

  // 过滤 + 导出
  await page.selectOption('#filter', 'NEGATIVE');
  expect((await page.$$('#grid-body tr')).length === 1, '负库存过滤应只剩 1 行');
  await page.selectOption('#filter', 'issues');
  const dl1 = await Promise.all([page.waitForEvent('download'), page.click('#export-issues-csv')]);
  console.log('下载:', dl1[0].suggestedFilename());
  const csvPath = await dl1[0].path();
  const csv = fs.readFileSync(csvPath, 'utf8');
  expect(csv.includes('行号,级别,规则,商品编码,说明'), '异常清单 CSV 缺表头');
  const dl2 = await Promise.all([page.waitForEvent('download'), page.click('#export-fixed-csv')]);
  const fixed = fs.readFileSync(await dl2[0].path(), 'utf8');
  expect(fixed.includes('修正说明') && fixed.includes('B003'), '修正表应含修正说明');
  const dl3 = await Promise.all([page.waitForEvent('download'), page.click('#export-issues-md')]);
  console.log('下载:', dl2[0].suggestedFilename(), dl3[0].suggestedFilename());
  expect((await page.inputValue('#md-preview')).includes('| 行号 | 级别 |'), 'Markdown 预览缺表格');

  // 输入框改动 -> 导出禁用,重新解析后恢复
  await page.fill('#src', '商品编码\t期初\t入库\t出库\t期末\nX1\t1\t1\t1\t2\n');
  expect(await page.isDisabled('#export-issues-csv'), '输入改动后导出应禁用');
  expect(await page.isVisible('#stale-note'), '应提示需重新解析');
  await page.click('#btn-parse');
  expect(await page.isVisible('#replace-confirm') && (await page.textContent('#replace-scope')).includes('3 行已采用的公式期末'), '重新解析会放弃已采用的公式期末,先页内确认并写明数量');
  await page.click('#btn-replace-yes');
  await page.waitForTimeout(100);
  expect(!(await page.isDisabled('#export-issues-csv')), '重新解析后导出应恢复');
  const rowsNow = await page.$eval('#stat-grid .stat', e => e.textContent);
  expect(rowsNow.startsWith('1'), `自定义表应为 1 行,实际 ${rowsNow}`);

  // 恢复示例并截图结果与导出
  await page.click('#btn-sample');
  expect(await page.isVisible('#replace-confirm'), '有数据时载入示例应先出现覆盖确认');
  await page.click('#btn-replace-yes');
  await page.waitForSelector('#grid-body tr');
  await page.click('#btn-select-formula');
  await page.click('#btn-apply');
  await page.waitForTimeout(100);
  await page.evaluate(() => document.getElementById('result-panel').scrollIntoView());
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png'), fullPage: false });

  // 存储失败提示
  const bad = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  bad.on('pageerror', e => problems.push('pageerror(存储失败页): ' + e.message));
  await bad.addInitScript(() => {
    Storage.prototype.setItem = function () { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; };
  });
  await bad.goto(URL);
  await bad.click('#btn-sample');
  await bad.waitForSelector('#grid-body tr');
  expect(await bad.isVisible('#save-warning'), '存储失败时应显示「未保存」');
  expect(!(await bad.isVisible('#flash')), '存储失败时不应显示成功提示');
  await bad.close();

  // 引号未闭合:整份拒绝,现有数据不变
  await page.fill('#src', '商品编码,期末\nA1,"1\nA2,2\n');
  await page.click('#btn-parse');
  expect((await page.textContent('#flash')).includes('引号没有闭合'), '引号未闭合应拒绝并提示原因');
  expect(await page.isVisible('#result'), '拒绝后原结果应保留');
  const keepRows = await page.$eval('#stat-grid .stat', e => e.textContent);
  expect(keepRows.startsWith('25'), `拒绝后应仍是 25 行,实际 ${keepRows}`);

  // ---- 第五轮新增断言 ----
  // 解析错误持续显示在输入框下方,不随临时提示消失
  expect(await page.isVisible('#parse-error') && (await page.textContent('#parse-error')).includes('引号没有闭合'), '解析错误持续显示在输入框下方');
  expect(await page.getAttribute('#src', 'aria-describedby') === 'parse-error' && await page.evaluate(() => document.activeElement.id) === 'src', '输入框关联错误说明并获得焦点');
  expect((await page.textContent('#verdict')).includes('检查未完成:1 处错误') && !(await page.textContent('#verdict')).includes('没有发现问题'), '有解析错误时结论写「检查未完成」而不是「没有发现问题」');
  await page.waitForTimeout(6300);
  expect(await page.isHidden('#flash') && await page.isVisible('#parse-error'), '临时提示消失后解析错误仍在');
  await page.fill('#src', '商品编码,期末\nA1,2\n');
  await page.click('#btn-parse');
  await page.click('#btn-replace-yes');
  await page.waitForTimeout(100);
  expect(await page.isHidden('#parse-error'), '重新解析成功后错误清除');
  expect((await page.textContent('#verdict')).includes('检查未完成') && !(await page.textContent('#verdict')).includes('没有发现问题'), '缺列时检查未完成,不说没有发现问题');
  await page.fill('#src', '商品编码\t商品名\t期初\t入库\t出库\t期末\t单位\t安全库存\t单价\nA1\t苹果\t1\t1\t1\t1\t个\t0\t2\n');
  await page.click('#btn-parse');
  await page.waitForTimeout(100);
  expect((await page.textContent('#verdict')).includes('没有发现问题'), '检查完整完成且无异常时才显示「没有发现问题」');
  expect((await page.textContent('#stale-note')).includes('导出已暂停') || await page.isHidden('#stale-note'), '过期提示与导出状态一致');

  // 新页:输入框草稿也要确认 / 币种 / 示例标注 / 文件导入先确认
  const p5 = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  p5.on('console', m => { if (m.type() === 'error') problems.push('console(p5): ' + m.text()); });
  p5.on('pageerror', e => problems.push('pageerror(p5): ' + e.message));
  await p5.goto(URL);
  await p5.evaluate(() => localStorage.clear());
  await p5.reload();
  await p5.fill('#src', '商品编码,期末\nZ9,3\n');
  await p5.click('#btn-sample');
  expect(await p5.isVisible('#replace-confirm') && (await p5.textContent('#replace-scope')).includes('输入框里还没解析的内容'), '只有未解析的输入框草稿时,载入示例也先确认');
  expect(await p5.inputValue('#src') === '商品编码,期末\nZ9,3\n', '确认前保留原文');
  await p5.click('#btn-replace-no');
  expect(await p5.inputValue('#src') === '商品编码,期末\nZ9,3\n' && await p5.isHidden('#result'), '取消后原文仍在且没有载入');
  await p5.click('#btn-sample');
  await p5.click('#btn-replace-yes');
  await p5.waitForSelector('#grid-body tr');
  expect((await p5.textContent('#stat-grid')).includes('原表统一货币单位'), '金额旁写明「原表统一货币单位」');
  await p5.fill('#currency', 'CNY');
  expect((await p5.textContent('#stat-grid')).includes('CNY') && (await p5.textContent('#value-note')).includes('CNY'), '填写币种后金额旁显示币种');
  expect((await p5.inputValue('#md-preview')).includes('库存金额币种:CNY') && (await p5.inputValue('#md-preview')).includes('数据来源:合成示例'), '导出预览带币种与合成示例标注');
  const [d1] = await Promise.all([p5.waitForEvent('download'), p5.click('#export-issues-csv')]);
  const c1 = fs.readFileSync(await d1.path(), 'utf8').split('\n');
  expect(c1[0].endsWith('数据来源') && c1[1].endsWith('合成示例'), '异常清单 CSV 带「数据来源=合成示例」列');
  const [d2] = await Promise.all([p5.waitForEvent('download'), p5.click('#export-fixed-csv')]);
  const c2 = fs.readFileSync(await d2.path(), 'utf8').split('\n');
  expect(c2[0].endsWith('数据来源') && c2[1].endsWith('合成示例'), '修正后库存表 CSV 带「数据来源=合成示例」列');
  await p5.reload();
  expect(await p5.isVisible('#sample-tag') && await p5.inputValue('#currency') === 'CNY', '刷新后示例标记与币种仍在');
  // 文件导入:校验 → 预览行数 → 确认
  const f1 = path.join(__dirname, '.omc', 'import-test.csv');
  fs.writeFileSync(f1, '商品编码,期末\nQ1,5\nQ2,6\n');
  await p5.setInputFiles('#file-import', f1);
  await p5.waitForSelector('#replace-confirm:not([hidden])');
  expect((await p5.textContent('#replace-lead')).includes('import-test.csv') && (await p5.textContent('#replace-lead')).includes('2 行数据'), '文件导入先预览行数并确认');
  expect((await p5.textContent('#stat-grid')).startsWith('25'), '确认前现有数据不变');
  await p5.click('#btn-replace-yes');
  await p5.waitForTimeout(100);
  expect((await p5.textContent('#stat-grid')).startsWith('2') && await p5.isHidden('#sample-tag'), '确认导入后写入并清除示例标记');
  fs.writeFileSync(f1, '商品编码,期末\nQ1,"5\n');
  await p5.setInputFiles('#file-import', f1);
  await p5.waitForSelector('#parse-error:not([hidden])');
  expect(await p5.isHidden('#replace-confirm') && (await p5.textContent('#parse-error')).includes('import-test.csv'), '坏文件整份拒绝并持续显示原因');
  fs.unlinkSync(f1);
  await p5.close();

  // 清空需页内确认
  await page.click('#btn-clear');
  expect(await page.isVisible('#clear-confirm'), '应出现页内确认区');
  await page.click('#btn-clear-yes');
  expect(await page.isVisible('#empty-state'), '清空后应回到空状态');

  // 手机
  await page.click('#btn-sample');
  await page.waitForSelector('#grid-body tr');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  await noOverflow('手机');
  const hit = await page.evaluate(() => [...document.querySelectorAll('#grid-body input[type="checkbox"]')].slice(0, 5).map(el => { const r = el.getBoundingClientRect(); const l = el.closest('label').getBoundingClientRect(); return [r.width, r.height, l.height]; }));
  expect(hit.length > 0 && hit.every(x => x[0] >= 24 && x[1] >= 24 && x[2] >= 32), '手机端 checkbox 视觉 >= 24px,label 点击区高度 >= 32px');
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
  await page.close();

  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  show.on('pageerror', e => problems.push('showcase pageerror: ' + e.message));
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(300);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();

  console.log(`断言 ${asserts} 条`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
