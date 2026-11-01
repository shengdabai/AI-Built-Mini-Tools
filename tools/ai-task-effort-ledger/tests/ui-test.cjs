const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
  let browser;
  try { browser = await chromium.launch(); }
  catch (first) {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
    console.log('默认 Chromium 不可用，已使用 chrome-headless-shell 回退。');
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href + '?today=2026-10-29';
  await page.goto(url);
  if (!await page.getByText('基准日 2026-10-29（由地址参数固定）').isVisible()) throw new Error('?today 标记未显示');

  await page.getByRole('button', {name:'载入合成示例'}).click();
  await page.getByRole('button', {name:'确认'}).click();
  if (await page.locator('.task').count() !== 3) throw new Error('示例没有载入 3 条');
  if (!await page.getByText(/账本中含合成示例/).isVisible()) throw new Error('示例身份未显示');

  await page.locator('#name').fill('<img src=x onerror=alert(1)>');
  await page.locator('#type').fill('HTML 交付');
  await page.locator('#model').fill('Model C');
  await page.locator('#acceptance').fill('390px 无横向溢出');
  await page.locator('#outcome').selectOption('passed');
  await page.locator('#work-minutes').fill('40');
  await page.locator('#rework-minutes').fill('8');
  await page.locator('#api-known').check();
  await page.locator('#api-amount').fill('0.25');
  await page.locator('#api-currency').fill('USD');
  await page.locator('#usage-known').check();
  await page.locator('#usage-unit').selectOption('percentage_points');
  await page.locator('#usage-before').fill('80');
  await page.locator('#usage-after').fill('75');
  await page.locator('#window-label').fill('同一周窗口');
  await page.getByRole('button', {name:'保存任务'}).click();
  if (await page.locator('.task').count() !== 4) throw new Error('新增任务未出现');
  if (await page.locator('img').count() !== 0) throw new Error('用户文本被解析为 HTML');
  if (!await page.getByText(/账本中含合成示例/).isVisible()) throw new Error('新增本人记录后其余示例身份被错误清除');
  if (await page.getByText('合成示例', {exact:true}).count() !== 3 || await page.getByText('本人记录', {exact:true}).count() !== 1) throw new Error('混合数据没有逐条保留身份');
  await page.locator('.task').filter({hasText:'合成示例：响应式 HTML 验收'}).getByRole('button',{name:'删除'}).click();
  await page.getByRole('button',{name:'确认'}).click();
  if (await page.getByText('合成示例',{exact:true}).count() !== 2 || await page.getByText('本人记录',{exact:true}).count() !== 1) throw new Error('删除一条示例后身份或本人记录被污染');
  if (await page.locator('#stat-tasks').textContent() !== '1 / 3' || await page.locator('#stat-passed').textContent() !== '1') throw new Error('合成示例进入了本人指标');
  await page.reload();
  if (await page.locator('.task').count() !== 3) throw new Error('刷新后数据未保留');
  await page.locator('#filter').selectOption('pending');
  if (await page.locator('.task').count() !== 1) throw new Error('结果筛选错误');
  await page.locator('#filter').selectOption('all');

  await page.locator('#import-file').setInputFiles(path.join(__dirname, 'invalid-import.json'));
  if (await page.locator('.task').count() !== 3) throw new Error('非法导入改变了当前数据');
  if (!await page.getByText(/导入失败/).isVisible()) throw new Error('非法导入没有给出错误');
  await page.locator('#import-file').setInputFiles(path.join(__dirname, 'valid-import.json'));
  if (!await page.getByText(/备份包含 1 条任务/).isVisible()) throw new Error('合法导入没有预览');
  if (await page.locator('.task').count() !== 3) throw new Error('确认前导入已改变数据');
  await page.getByRole('button', {name:'确认替换当前数据'}).click();
  if (await page.locator('.task').count() !== 1 || !await page.getByText('导入验收任务').isVisible()) throw new Error('确认导入后数据不正确');

  for (const viewport of [{width:1440,height:900},{width:768,height:900},{width:390,height:844}]) {
    await page.setViewportSize(viewport);
    const metrics = await page.evaluate(() => ({scroll:document.documentElement.scrollWidth,inner:window.innerWidth,minButton:Math.min(...Array.from(document.querySelectorAll('button')).filter(x=>x.offsetParent).map(x=>x.getBoundingClientRect().height))}));
    if (metrics.scroll > metrics.inner) throw new Error(`${viewport.width}px 横向溢出：${metrics.scroll}>${metrics.inner}`);
    if (metrics.minButton < 36) throw new Error(`${viewport.width}px 按钮触控高度小于 36px`);
    await page.screenshot({path:path.join(__dirname,'..','screenshots',`ledger-${viewport.width}.png`),fullPage:true});
    console.log(`viewport ${viewport.width}x${viewport.height}: scrollWidth=${metrics.scroll}, minButton=${metrics.minButton}`);
  }
  if (errors.length) throw new Error(errors.join('\n'));

  const brokenContext = await browser.newContext({acceptDownloads:true});
  await brokenContext.addInitScript(() => { Storage.prototype.setItem = function () { throw new Error('synthetic quota failure'); }; });
  const broken = await brokenContext.newPage();
  await broken.goto(url);
  await broken.locator('#name').fill('存储失败恢复测试');
  await broken.locator('#type').fill('测试');
  await broken.locator('#model').fill('Model');
  await broken.locator('#acceptance').fill('保存失败后仍能导出当前内存数据');
  await broken.locator('#work-minutes').fill('1');
  await broken.locator('#rework-minutes').fill('0');
  await broken.getByRole('button', {name:'保存任务'}).click();
  if (!await broken.locator('#storage-warning').isVisible()) throw new Error('存储失败未显示恢复提示');
  if (!await broken.getByText(/仅保留在当前页面内存/).isVisible()) throw new Error('存储失败仍错误宣称已保存到浏览器');
  await broken.locator('#name').fill('有效未提交草稿');
  await broken.locator('#type').fill('测试');
  await broken.locator('#model').fill('Model Draft');
  await broken.locator('#acceptance').fill('恢复备份包含这条草稿');
  await broken.locator('#work-minutes').fill('2');
  await broken.locator('#rework-minutes').fill('0');
  const download = await Promise.all([broken.waitForEvent('download'), broken.getByRole('button',{name:'导出当前内存与有效草稿 JSON 备份'}).click()]).then(x=>x[0]);
  const downloadedPath = await download.path();
  const fs = require('node:fs');
  const backup = JSON.parse(fs.readFileSync(downloadedPath,'utf8'));
  if (backup.tasks.length !== 2 || !backup.tasks.some(t=>t.name==='存储失败恢复测试') || !backup.tasks.some(t=>t.name==='有效未提交草稿')) throw new Error('存储失败后的备份未包含已保存内存数据和有效草稿');
  await brokenContext.close();

  const corruptContext = await browser.newContext();
  await corruptContext.addInitScript(() => localStorage.setItem('taskEffortLedger.v1','{broken-original'));
  const corrupt = await corruptContext.newPage(); await corrupt.goto(url);
  if (!await corrupt.getByRole('button',{name:'下载损坏的原始存储文本'}).isVisible()) throw new Error('损坏存储没有暴露原始文本恢复入口');
  await corrupt.locator('#name').fill('损坏存储后的新任务'); await corrupt.locator('#type').fill('恢复测试'); await corrupt.locator('#model').fill('Model'); await corrupt.locator('#acceptance').fill('先归档原始损坏文本再写入');
  await corrupt.getByRole('button',{name:'保存任务'}).click();
  if (!await corrupt.getByText(/已保存到浏览器/).isVisible()) throw new Error('成功归档损坏原文后未正常保存');
  const archived = await corrupt.evaluate(() => ({main:localStorage.getItem('taskEffortLedger.v1'), backups:Object.keys(localStorage).filter(k=>k.startsWith('taskEffortLedger.corruptBackup.v1.')).map(k=>localStorage.getItem(k))}));
  if (!archived.backups.includes('{broken-original') || !JSON.parse(archived.main).tasks.length) throw new Error('损坏原文未先归档或有效状态未写入');
  await corruptContext.close();

  const failArchiveContext = await browser.newContext({acceptDownloads:true});
  await failArchiveContext.addInitScript(() => { localStorage.setItem('taskEffortLedger.v1','{broken-must-stay'); const original=Storage.prototype.setItem; Storage.prototype.setItem=function(k,v){if(String(k).startsWith('taskEffortLedger.corruptBackup.v1.')) throw new Error('archive blocked'); return original.call(this,k,v);}; });
  const failArchive = await failArchiveContext.newPage(); await failArchive.goto(url);
  await failArchive.locator('#name').fill('只能留在内存'); await failArchive.locator('#type').fill('恢复测试'); await failArchive.locator('#model').fill('Model'); await failArchive.locator('#acceptance').fill('归档失败不得覆盖原始损坏值');
  await failArchive.getByRole('button',{name:'保存任务'}).click();
  if (!await failArchive.getByText(/仅保留在当前页面内存/).isVisible()) throw new Error('归档失败没有内存提示');
  const originalStillThere=await failArchive.evaluate(() => localStorage.getItem('taskEffortLedger.v1'));
  if (originalStillThere!=='{broken-must-stay') throw new Error('归档失败后覆盖了原始损坏值');
  const rawDownload=await Promise.all([failArchive.waitForEvent('download'),failArchive.getByRole('button',{name:'下载损坏的原始存储文本'}).click()]).then(x=>x[0]);
  if (fs.readFileSync(await rawDownload.path(),'utf8')!=='{broken-must-stay') throw new Error('原始损坏文本下载不精确');
  const memoryDownload=await Promise.all([failArchive.waitForEvent('download'),failArchive.getByRole('button',{name:'导出当前内存与有效草稿 JSON 备份'}).click()]).then(x=>x[0]);
  if (JSON.parse(fs.readFileSync(await memoryDownload.path(),'utf8')).tasks.length!==1) throw new Error('归档失败后当前有效内存备份缺失');
  await failArchiveContext.close();
  await browser.close();
  console.log('UI flow PASS: 示例、录入、XSS 文本、刷新、筛选、原子导入、存储失败恢复、三视口。');
})().catch(e => { console.error(e.stack || e); process.exit(1); });
