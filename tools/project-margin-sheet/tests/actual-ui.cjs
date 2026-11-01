'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const C = require('../core.js');

const ROOT = path.join(__dirname, '..');
const URL = 'file://' + encodeURI(path.join(ROOT, 'index.html')) + '?today=2026-10-29';
const OUT = path.join(ROOT, 'screenshots');
const TMP = path.join(ROOT, '.omc');
const FALLBACK = process.env.CHROME_PATH || undefined;
let count = 0;
const problems = [];
function check(value, message) {
  count += 1;
  if (value) console.log('  ok ', message);
  else problems.push('断言失败:' + message);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });
  let browser;
  try { browser = await chromium.launch(); }
  catch (error) {
    console.log('默认 Chromium 不可用,回退 chrome-headless-shell:', error.message.split('\n')[0]);
    browser = await chromium.launch({ executablePath: FALLBACK });
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', error => problems.push('pageerror:' + error.message));
  page.on('console', message => { if (message.type() === 'error') problems.push('console:' + message.text()); });
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.click('#load-sample');
  await page.click('.project-item:has-text("展会物料")');

  const resultValue = key => page.locator('#result .stat', { has: page.locator('.k', { hasText: new RegExp('^' + key + '$') }) }).locator('.v');
  check((await resultValue('实际毛利偏差').textContent()) === '未知', '没有实际记录时偏差是未知,不是 0');
  await page.click('#lock-baseline');
  check((await page.textContent('#baseline-summary')).includes('v1') && (await page.textContent('#baseline-summary')).includes('已锁定'), '锁定当前估算为 v1');
  const firstQuote = await page.evaluate(() => JSON.parse(localStorage.getItem('margin.v1')).projects.find(p => p.id === 'sample-p5').baselineVersions[0].estimate.quote);

  await page.evaluate(() => { window.__actualXss = false; });
  await page.fill('#work-form input[name="minutes"]', '90');
  await page.fill('#work-form input[name="rate"]', '120');
  await page.fill('#work-form input[name="source"]', '<img src=x onerror="window.__actualXss=true">');
  await page.fill('#work-form input[name="note"]', '<b>核对</b>');
  await page.click('#work-form button[type="submit"]');
  check((await page.textContent('#actual-entries')).includes('90 分钟'), '实际工时以整数分钟记录');
  check(!(await page.evaluate(() => window.__actualXss)), '实际来源和备注未执行 XSS');
  check((await resultValue('实际毛利偏差').textContent()) === '未知', '只有部分实际记录时偏差仍未知');

  await page.fill('#expense-form input[name="amount"]', '25');
  await page.fill('#expense-form input[name="currency"]', 'usd');
  await page.fill('#expense-form input[name="source"]', '收据');
  await page.click('#expense-form button[type="submit"]');
  await page.check('#completeness-form input[name="asserted"]');
  await page.click('#completeness-form button[type="submit"]');
  check((await resultValue('实际毛利偏差').textContent()) === '未知', '不同币种即使声明完整也不合并计算偏差');
  await page.locator('.actual-row', { hasText: 'USD' }).locator('[data-actual-del]').click();

  await page.fill('#expense-form input[name="amount"]', '80');
  await page.fill('#expense-form input[name="source"]', 'CNY 收据');
  await page.click('#expense-form button[type="submit"]');
  await page.fill('#revenue-form input[name="amount"]', '1000');
  await page.fill('#revenue-form input[name="source"]', '本人核对的收款记录');
  await page.click('#revenue-form button[type="submit"]');
  check((await resultValue('实际毛利偏差').textContent()) === '未知', '新增实际记录后自动撤销完整性声明');
  await page.check('#completeness-form input[name="asserted"]');
  await page.click('#completeness-form button[type="submit"]');
  check((await resultValue('实际毛利偏差').textContent()) !== '未知', '币种一致且用户声明完整后显示偏差');
  const varianceAtCutoff = await resultValue('实际毛利偏差').textContent();
  await page.fill('#revenue-form input[name="date"]', '2026-11-01');
  await page.fill('#revenue-form input[name="amount"]', '999');
  await page.fill('#revenue-form input[name="source"]', '截至日后收款');
  await page.click('#revenue-form button[type="submit"]');
  await page.check('#completeness-form input[name="asserted"]');
  await page.click('#completeness-form button[type="submit"]');
  check((await resultValue('实际毛利偏差').textContent()) === varianceAtCutoff, '截至日后的收款保留明细但不进入截至日合计和偏差');

  await page.fill('#f-quote', '9999');
  check(await page.evaluate(q => JSON.parse(localStorage.getItem('margin.v1')).projects.find(p => p.id === 'sample-p5').baselineVersions[0].estimate.quote === q, firstQuote), '编辑当前报价不改写锁定基线');
  await page.click('#reopen-baseline');
  check((await page.textContent('#baseline-summary')).includes('草稿') && (await page.textContent('#baseline-summary')).includes('历史版本 2 个'), '显式重开创建 v2 草稿并保留 v1');
  await page.fill('#f-quote', '12000');
  await page.click('#lock-baseline');
  check((await page.textContent('#baseline-summary')).includes('v2') && (await page.textContent('#baseline-summary')).includes('已锁定'), 'v2 可独立锁定');

  await page.click('[data-tab="export"]');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-json')]);
  const backup = path.join(TMP, 'actual-ui-backup.json');
  await download.saveAs(backup);
  const imported = C.validateImport(fs.readFileSync(backup, 'utf8'));
  check(imported.ok && imported.state.projects.find(p => p.id === 'sample-p5').baselineVersions.length === 2, 'JSON 导出保留两个基线版本');
  const exportedProject = imported.state.projects.find(p => p.id === 'sample-p5');
  check(exportedProject.actualWork.length === 1 && exportedProject.actualExpenses.length === 1 && exportedProject.actualRevenue.length === 2, 'JSON 导出保留三类实际记录及截至日后明细');
  check(exportedProject.actualCompleteness.asserted === true, 'JSON 导出保留完整性声明');

  for (const [width, height, name] of [[1280, 900, '05-实际流程-1280.png'], [768, 900, '06-实际流程-768.png'], [390, 844, '07-实际流程-390.png']]) {
    await page.setViewportSize({ width, height });
    await page.click('[data-tab="projects"]');
    await page.waitForTimeout(80);
    const [scrollWidth, innerWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    check(scrollWidth <= innerWidth, `${width}px 项目页无横向溢出`);
    await page.screenshot({ path: path.join(OUT, name), fullPage: true });
  }
  await browser.close();
  console.log(`实际流程断言共 ${count} 条`);
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  console.log('实际流程浏览器验收全部通过');
})().catch(error => { console.error(error); process.exit(1); });
