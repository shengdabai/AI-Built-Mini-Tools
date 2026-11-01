'use strict';
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

async function launch() {
  try { return await chromium.launch({ headless: true }); }
  catch (first) {
    process.stderr.write(`默认 Chromium 不可用，改用本机无头入口：${first.message.split('\n')[0]}\n`);
    return chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined });
  }
}

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  const url = `file://${encodeURI(path.join(__dirname, 'index.html'))}?today=2026-10-29`;
  await page.goto(url);
  await page.evaluate(() => localStorage.removeItem('decisionReviewWorkbench.v2'));
  await page.reload();
  assert.match(await page.locator('#todayBadge').innerText(), /由地址参数固定/);
  assert.equal(await page.locator('#totalMetric').innerText(), '0');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  fs.mkdirSync(path.join(__dirname, 'screenshots'), { recursive: true });
  await page.screenshot({ path: path.join(__dirname, 'screenshots/01-空状态-桌面.png'), fullPage: true });

  await page.getByRole('button', { name: '载入合成示例' }).click();
  assert.equal(await page.locator('#sampleBadge').isVisible(), true);
  assert.equal(await page.locator('.decision-card').count(), 2);
  await page.screenshot({ path: path.join(__dirname, 'screenshots/02-合成示例-桌面.png'), fullPage: true });

  await page.locator('#title').fill('真实记录：验收来源隔离');
  await page.locator('#question').fill('新增真实记录后，合成示例是否仍保持来源标记？');
  await page.locator('#probability').fill('100');
  await page.locator('#dueDate').fill('2026-10-29');
  await page.locator('#reasons').fill('通过界面断言检查来源和校准分母');
  await page.getByRole('button', { name: '保存事前预测' }).click();
  assert.equal(await page.locator('.decision-card').count(), 3);
  assert.equal(await page.locator('#sampleBadge').isVisible(), true);
  assert.match(await page.locator('.decision-card').filter({ hasText: '两周内完成三次真实访谈' }).innerText(), /合成示例（不进入真实校准）/);

  const openCard = page.locator('.decision-card').filter({ hasText: '两周内完成三次真实访谈' });
  await openCard.getByRole('button', { name: '追加实际结果' }).click();
  await openCard.locator('[name=outcome]').selectOption('0');
  await openCard.locator('[name=summary]').fill('合成示例在浏览器测试中记录为未发生。');
  await openCard.locator('[name=bias]').selectOption('执行偏差');
  await openCard.getByRole('button', { name: '保存实际结果' }).click();
  assert.equal(await page.locator('#resolvedMetric').innerText(), '2');
  assert.equal(await page.locator('#brierMetric').innerText(), '—');
  assert.equal(await page.locator('#sampleBadge').isVisible(), true);

  const realCard = page.locator('.decision-card').filter({ hasText: '真实记录：验收来源隔离' });
  await realCard.getByRole('button', { name: '追加实际结果' }).click();
  await realCard.locator('[name=outcome]').selectOption('1');
  await realCard.locator('[name=summary]').fill('界面保留了逐条来源。');
  await realCard.locator('[name=bias]').selectOption('未判断');
  await realCard.getByRole('button', { name: '保存实际结果' }).click();
  assert.equal(await page.locator('#resolvedMetric').innerText(), '3');
  assert.equal(await page.locator('#brierMetric').innerText(), '0.000');
  assert.match(await page.locator('#brierHelp').innerText(), /分母：1 条/);

  await page.reload();
  assert.equal(await page.locator('#resolvedMetric').innerText(), '3');
  assert.equal(await page.locator('.decision-card').count(), 3);

  await page.locator('#importFile').setInputFiles({ name: 'malformed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 2, isSample: false, legacyNotes: [], decisions: [null] })) });
  await page.waitForFunction(() => document.getElementById('storageStatus').textContent.includes('导入检查失败'));
  assert.match(await page.locator('#storageStatus').innerText(), /导入检查失败/);
  assert.equal(await page.locator('#totalMetric').innerText(), '3');
  assert.equal(errors.length, 0);
  const futurePayload = await page.evaluate(() => { const value = JSON.parse(localStorage.getItem('decisionReviewWorkbench.v2')); value.decisions.find((item) => item.review).review.reviewedAt = '2099-01-01T00:00:00.000Z'; return JSON.stringify(value); });
  await page.locator('#importFile').setInputFiles({ name: 'future-review.json', mimeType: 'application/json', buffer: Buffer.from(futurePayload) });
  await page.waitForFunction(() => document.getElementById('storageStatus').textContent.includes('导入检查失败'));
  assert.match(await page.locator('#storageStatus').innerText(), /导入检查失败/);
  assert.equal(await page.locator('#totalMetric').innerText(), '3');

  await page.setViewportSize({ width: 768, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: path.join(__dirname, 'screenshots/03-复查结果-平板.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: path.join(__dirname, 'screenshots/04-复查结果-手机.png'), fullPage: true });

  await page.getByRole('button', { name: '清空全部本机数据' }).click();
  assert.equal(await page.locator('#totalMetric').innerText(), '3');
  await page.getByRole('button', { name: '确认清空全部数据' }).click();
  assert.equal(await page.locator('#totalMetric').innerText(), '0');

  await page.evaluate(() => localStorage.setItem('decision-lab-20261026-v1', JSON.stringify({ before: '旧版事前原文', after: '旧版事后原文' })));
  await page.reload();
  assert.equal(await page.locator('#legacyPanel').isVisible(), true);
  await page.getByRole('button', { name: '导入旧版原文' }).click();
  assert.equal(await page.locator('#totalMetric').innerText(), '0');
  assert.equal(await page.locator('.legacy-note').count(), 1);
  assert.match(await page.locator('.legacy-note').innerText(), /旧版事前原文/);

  await page.getByRole('button', { name: '清空全部本机数据' }).click();
  await page.getByRole('button', { name: '确认清空全部数据' }).click();

  await page.locator('#title').fill('<img src=x onerror=alert(1)>');
  await page.locator('#question').fill('用户文本会不会按普通文字呈现？');
  await page.locator('#probability').fill('50');
  await page.locator('#dueDate').fill('2026-11-01');
  await page.locator('#reasons').fill('测试 textContent 渲染');
  await page.getByRole('button', { name: '保存事前预测' }).click();
  assert.equal(await page.locator('.decision-card img').count(), 0);
  assert.match(await page.locator('.decision-card h3').innerText(), /<img/);
  assert.deepEqual(errors, []);

  const failedContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await failedContext.addInitScript(() => {
    Object.defineProperty(Storage.prototype, 'setItem', { configurable: true, value() { throw new DOMException('blocked', 'QuotaExceededError'); } });
  });
  const failedPage = await failedContext.newPage();
  await failedPage.goto(url);
  await failedPage.locator('#title').fill('保存失败恢复测试');
  await failedPage.locator('#question').fill('存储不可用时，内存数据是否仍可导出？');
  await failedPage.locator('#probability').fill('50');
  await failedPage.locator('#dueDate').fill('2026-11-01');
  await failedPage.locator('#reasons').fill('浏览器禁止写入存储');
  await failedPage.getByRole('button', { name: '保存事前预测' }).click();
  assert.match(await failedPage.locator('#storageStatus').innerText(), /本地保存失败/);
  assert.equal(await failedPage.locator('#totalMetric').innerText(), '1');
  assert.equal(await failedPage.getByRole('button', { name: '导出已提交的当前内存记录 JSON' }).isEnabled(), true);
  await failedPage.locator('#title').fill('尚未保存的草稿');
  assert.equal(await failedPage.getByRole('button', { name: '导出已提交的当前内存记录 JSON' }).isDisabled(), true);
  await failedContext.close();
  await browser.close();
  process.stdout.write('browser assertions: 1440/768/390, persistence, chronology import rejection, review, legacy migration, storage failure draft gate, confirmation, XSS text, console all PASS\n');
})().catch((error) => { console.error(error); process.exit(1); });
