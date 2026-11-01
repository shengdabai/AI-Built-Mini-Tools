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
  const expect = (cond, msg) => { asserts++; if (!cond) problems.push('断言失败:' + msg); };
  const watch = page => {
    page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
    page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  };

  // ---- 桌面 ----
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  watch(page);
  const noOverflow = async (label, p) => {
    const [sw, iw] = await (p || page).evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(`${label}: scrollWidth ${sw} <= innerWidth ${iw} -> ${sw <= iw ? 'OK' : 'FAIL'}`);
    expect(sw <= iw, `${label} 横向溢出 ${sw} > ${iw}`);
  };

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  expect(await page.isHidden('#result'), '空状态不应显示结果区');
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });
  await noOverflow('桌面-空状态');

  // 空输入点预检:有提示且不出结果
  await page.click('#run-check');
  expect((await page.textContent('#input-status')).includes('空'), '空输入应提示');
  expect((await page.getAttribute('#csv-input', 'aria-invalid')) === 'true' && (await page.evaluate(() => document.activeElement.id)) === 'csv-input', '空输入时错误标在输入框上并聚焦');
  expect((await page.getAttribute('#csv-input', 'aria-describedby')) === 'input-status', '输入框用 aria-describedby 关联提示');
  expect(await page.isHidden('#result'), '空输入不应出结果');

  // 核心流程:载入示例 → 预检 → 看统计 → 点问题定位
  await page.click('#load-sample');
  await page.waitForSelector('.issue');
  const stats = await page.$$eval('#stats .stat', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  console.log('统计:', stats.join(' | '));
  expect(stats[0].includes('17'), '数据行应为 17');
  expect(stats[1].includes('3'), '商品数应为 3');
  expect(stats[3].includes('9'), '阻断应为 9');
  expect(stats[4].includes('7'), '警告应为 7');
  expect((await page.textContent('#verdict')).includes('9 个阻断问题'), '结论应提示 9 个阻断');
  expect(await page.isEnabled('#export-csv'), '预检后导出应可用');

  // 点击「重复 SKU」,预览表格里对应单元格被聚焦
  await page.click('.issue:has-text("Variant SKU 重复")');
  const focusText = await page.textContent('.focus-cell');
  console.log('定位到单元格:', focusText);
  expect(focusText === 'TOTE-BK-L', '应定位到重复 SKU 单元格');
  // 阻断筛选
  await page.click('[data-filter="block"]');
  const blockItems = await page.$$eval('.issue', els => els.length);
  expect(blockItems === 9, `阻断筛选应有 9 条,实际 ${blockItems}`);
  await page.click('[data-filter="all"]');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png') });
  await noOverflow('桌面-核心流程');

  // 安全修复:显示将改动数 → 应用 → 重新预检
  const summary = await page.textContent('#fix-summary');
  console.log('修复前:', summary);
  expect(/将改动 \d+ 个单元格,删除 1 个空行/.test(summary), '修复摘要应含空行数');
  await page.click('#apply-fix');
  const after = await page.textContent('#fix-applied');
  console.log('修复后:', after);
  expect(after.includes('已应用'), '应显示已应用');
  const afterStats = await page.$$eval('#stats .stat', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  console.log('修复后统计:', afterStats.join(' | '));
  expect(afterStats[3].includes('5'), `修复后阻断应为 5(4 个 Handle 格式问题被修掉),实际 ${afterStats[3]}`);
  expect(!(await page.textContent('#preview')).includes('Ceramic-Mug-Set'), '修复后预览里不应再有大写 Handle');

  // 导出:修复后的 CSV 要对 =SUM 加前缀
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-csv')]);
  console.log('下载文件名:', dl.suggestedFilename());
  const csvText = fs.readFileSync(await dl.path(), 'utf8');
  expect(csvText.includes("\"'=SUM(1,2)\""), '导出 CSV 应对 =SUM 加单引号前缀');
  expect(csvText.includes('ceramic-mug-set'), '导出 CSV 应是修复后的小写 Handle');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#export-issues-md')]);
  const md = fs.readFileSync(await dl2.path(), 'utf8');
  expect(md.includes('## 阻断(5)'), '问题清单 Markdown 应含阻断分节');
  expect((await page.textContent('#md-preview')).includes('商品 CSV 预检报告'), 'Markdown 预览应显示');

  // 导出前状态与界面一致:改了输入框但没重新预检 → 导出停用
  await page.fill('#csv-input', (await page.inputValue('#csv-input')) + '\nextra-handle,新品');
  expect(await page.isDisabled('#export-csv'), '输入改动后导出应停用');
  expect(await page.isDisabled('#apply-fix'), '输入改动后安全修复应停用');
  expect((await page.textContent('#verdict')).includes('输入框已修改'), '应提示输入已修改');
  await page.click('#run-check');
  expect(await page.isEnabled('#export-csv'), '重新预检后导出应恢复');

  // 解析错误:未闭合引号
  await page.fill('#csv-input', 'Handle,Title\nok,好\nbad,"没有结束引号\nnext,行');
  await page.click('#run-check');
  expect((await page.textContent('#issue-list')).includes('引号未闭合'), '应报引号未闭合');
  expect(await page.isDisabled('#export-csv'), '有解析错误时不能导出 CSV');
  const incomplete = await page.textContent('#verdict');
  expect(/检查未完成：\d+ 处解析错误/.test(incomplete) && !incomplete.includes('没有发现'), '有解析错误时结论写「检查未完成」而不是「没有发现问题」');
  expect(await page.isHidden('#sample-badge'), '用户自己的输入不显示合成示例标记');
  // 载入示例前的替换确认:已有输入时先确认,确认前输入保持原样
  const mine = await page.inputValue('#csv-input');
  await page.click('#load-sample');
  expect(await page.isVisible('#confirm-sample'), '已有输入时点「载入合成示例」先出现替换确认');
  expect((await page.textContent('#confirm-sample-text')).includes(String(mine.length)), '确认文案写明将替换的字符数');
  expect((await page.inputValue('#csv-input')) === mine, '确认前输入框保持原样');
  await page.click('#sample-no');
  expect((await page.inputValue('#csv-input')) === mine && await page.isHidden('#confirm-sample'), '取消后输入保持原样');
  await page.click('#load-sample');
  await page.click('#sample-yes');
  await page.waitForSelector('.issue');
  expect(await page.isVisible('#sample-badge'), '载入示例后持续显示「合成示例」标记');
  expect((await page.textContent('#stat-notes')).includes('不同 Handle') && (await page.textContent('#stat-notes')).includes('SKU'), '统计旁写明商品数/变体数的计数条件');
  expect(await page.isHidden('#fix-unsaved'), '修复前不显示「修复结果尚未保存」');
  await page.click('#apply-fix');
  expect(await page.isVisible('#fix-unsaved') && (await page.textContent('#fix-unsaved')).includes('刷新后会恢复成原文'), '应用修复后明确提示修复结果尚未保存、刷新后恢复原文');
  expect((await page.textContent('#save-state')).includes('原始输入已保存'), '保存提示限定为「原始输入已保存」');
  await page.click('#load-sample');
  expect(await page.isVisible('#confirm-sample') && (await page.textContent('#confirm-sample-text')).includes('安全修复结果'), '已应用修复时,替换确认提示修复结果会丢');
  await page.click('#sample-no');
  const [dlSample] = await Promise.all([page.waitForEvent('download'), page.click('#export-issues-md')]);
  const sampleMd = fs.readFileSync(await dlSample.path(), 'utf8');
  expect(sampleMd.includes('数据来源：合成示例') && dlSample.suggestedFilename().includes('合成示例'), '示例的问题清单 Markdown 与文件名标注合成示例');
  const [dlSampleCsv] = await Promise.all([page.waitForEvent('download'), page.click('#export-issues-csv')]);
  const sampleCsv = fs.readFileSync(await dlSampleCsv.path(), 'utf8');
  expect(sampleCsv.includes('数据来源') && sampleCsv.includes('合成示例'), '示例的问题清单 CSV 含「数据来源」列');
  const [dlSampleProd] = await Promise.all([page.waitForEvent('download'), page.click('#export-csv')]);
  expect(dlSampleProd.suggestedFilename().includes('合成示例'), '示例的商品 CSV 文件名带「合成示例」');
  await page.evaluate(() => document.querySelector('#fix-title').scrollIntoView());
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png') });

  // 存储失败:setItem 抛 QuotaExceededError → 「未保存」横幅持续可见
  const quota = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  watch(quota);
  await quota.addInitScript(() => {
    Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
  });
  await quota.goto(URL);
  await quota.click('#load-sample');
  await quota.waitForSelector('.issue');
  expect(await quota.isVisible('#save-warn'), '存储失败时应显示未保存横幅');
  expect(!(await quota.textContent('#save-state')).includes('已保存'), '存储失败时不能显示已保存');
  await quota.waitForTimeout(800);
  expect(await quota.isVisible('#save-warn'), '横幅应持续可见');
  console.log('存储失败提示:', (await quota.textContent('#save-warn')).replace(/\s+/g, ' ').trim());
  await quota.close();

  // 刷新恢复 + 清空需确认
  await page.reload();
  await page.waitForSelector('.issue');
  expect((await page.inputValue('#csv-input')).startsWith('Handle,Title,Body'), '刷新后应恢复上次输入');
  expect(await page.isVisible('#sample-badge'), '刷新后「合成示例」标记仍在');
  await page.click('#clear-all');
  expect(await page.isVisible('#confirm-clear'), '清空前应出现确认区');
  await page.click('#confirm-yes');
  expect(await page.isHidden('#result') && (await page.inputValue('#csv-input')) === '', '确认后应清空');
  expect(await page.isHidden('#sample-badge'), '清空后合成示例标记消失');

  // ---- 手机 ----
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('#load-sample');
  await page.waitForSelector('.issue');
  await page.waitForTimeout(200);
  await noOverflow('手机');
  const smallBtns = await page.evaluate(() => Array.from(document.querySelectorAll('button, summary')).filter(n => n.offsetParent && n.getBoundingClientRect().height < 36).map(n => n.id || n.textContent.slice(0, 10)));
  expect(smallBtns.length === 0, '手机端可见按钮高度均 >= 36px(不足:' + smallBtns.join(',') + ')');
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
  await page.close();

  // ---- 展示图 ----
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  watch(show);
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(400);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();

  console.log(`断言 ${asserts} 条`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
