'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const URL_ = 'file://' + encodeURI(path.join(__dirname, 'index.html'));
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
    console.log(`${label}: scrollWidth ${sw} <= innerWidth ${iw} → ${sw <= iw ? 'OK' : 'FAIL'}`);
    expect(sw <= iw, `${label} 横向溢出 ${sw} > ${iw}`);
  };

  await page.goto(URL_);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  expect(await page.isVisible('#empty-guide'), '空状态引导可见');
  expect(await page.isDisabled('#export-csv'), '空状态导出禁用');
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

  // 核心流程:载入示例 → 检查结果 → 采用单条建议 → 修改后结果过期
  await page.click('#btn-sample');
  await page.waitForSelector('.result');
  const stats = await page.$$eval('#summary .stat', els => els.map(e => e.textContent));
  console.log('统计:', stats.join(' | '));
  expect(stats[0] === '共 16 条链接', '示例共 16 条');
  expect(stats[1] === '阻断 6 条', '示例阻断 6 条,实际 ' + stats[1]);
  expect(stats[2] === '仅警告 6 条', '示例仅警告 6 条,实际 ' + stats[2]);
  expect(stats[3] === '通过 4 条', '示例通过 4 条,实际 ' + stats[3]);
  expect(await page.isVisible('#sample-tag-check') && await page.isVisible('#sample-tag-result'), '载入示例后输入区与结果标题旁显示「合成示例」');
  await page.selectOption('#filter', 'issues');
  const shown = await page.$$eval('#results .result', e => e.length);
  expect(shown === 12, '仅有问题的应为 12 张卡片,实际 ' + shown);
  // 第 6 行:utm_Source 大小写 → 采用建议
  const card6 = page.locator('#results .result', { hasText: '第 6 行' });
  await card6.locator('button', { hasText: '采用这条建议' }).click();
  await page.waitForTimeout(150);
  const text = await page.inputValue('#links-text');
  expect(text.split('\n')[5].includes('utm_campaign=spring_sale&utm_medium=social&utm_source=weibo'), '第 6 行已被规范化');
  await page.selectOption('#filter', 'all');
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png') });
  await noOverflow('桌面');

  // 过期保护:编辑后导出禁用,重新检查后恢复
  await page.fill('#links-text', text + '\nhttps://shop.example.com/new?utm_source=x');
  expect(await page.isVisible('#stale-note'), '修改后显示过期提示');
  expect(await page.isDisabled('#export-csv'), '修改后导出禁用');
  await page.click('#btn-check');
  expect(await page.isEnabled('#export-csv'), '重新检查后导出可用');
  expect((await page.textContent('#summary')).includes('共 17 条'), '17 条');

  // 非法设置:拒绝并提示
  await page.evaluate(() => { document.getElementById('settings').open = true; });
  await page.fill('#set-pattern', '([');
  expect(await page.isVisible('#settings-error'), '非法正则显示错误');
  await page.fill('#set-pattern', '^[a-z0-9_-]+$');
  await page.click('#btn-check');

  // 导出
  const [dl1] = await Promise.all([page.waitForEvent('download'), page.click('#export-csv')]);
  const csv = fs.readFileSync(await dl1.path(), 'utf8');
  console.log('下载:', dl1.suggestedFilename());
  expect(csv.includes('必填参数缺失'), 'CSV 含规则名');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#export-md')]);
  console.log('下载:', dl2.suggestedFilename());
  const [dl3] = await Promise.all([page.waitForEvent('download'), page.click('#export-norm-txt')]);
  const txt = fs.readFileSync(await dl3.path(), 'utf8');
  expect(txt.split('\n').filter(Boolean).length === 15, '规范化列表应有 15 条可解析链接(14 条示例 + 1 条新增),实际 ' + txt.split('\n').filter(Boolean).length);
  expect((await page.inputValue('#md-preview')).includes('| 行号 | 级别 |'), 'Markdown 预览含表格');
  await page.locator('#export-csv').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png') });

  // 批量构建
  await page.click('[data-view="build"]');
  expect(await page.isVisible('#settings'), '规则设置在构建页同样可见');
  expect(await page.isHidden('#sample-tag-check'), '用户编辑链接后合成示例标识消失');
  await page.click('#btn-build');
  const count = await page.textContent('#build-summary');
  console.log('构建:', count);
  expect(count.includes('6 条'), '构建 3×2 共 6 条,实际 ' + count);
  const [dl4] = await Promise.all([page.waitForEvent('download'), page.click('#export-build-csv')]);
  const bcsv = fs.readFileSync(await dl4.path(), 'utf8');
  expect(bcsv.trim().split('\n').length === 7, '构建 CSV 7 行(含表头)');
  await page.click('[data-view="check"]');

  // 共享规则:正则填错后在构建页点生成,就地显示错误并聚焦出错输入
  await page.click('[data-view="build"]');
  await page.fill('#set-pattern', '[');
  await page.click('#btn-build');
  expect(await page.isVisible('#settings-error'), '构建页规则非法时就地显示错误');
  expect(await page.evaluate(() => document.activeElement && document.activeElement.id) === 'set-pattern', '规则非法时焦点移到出错输入');
  expect((await page.getAttribute('#set-pattern', 'aria-describedby')) === 'settings-error', '出错输入关联 aria-describedby');
  await page.fill('#set-pattern', '^[a-z0-9_-]+$');
  await page.click('[data-view="check"]');
  // 手机
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  await noOverflow('手机');
  const small = await page.evaluate(() => [...document.querySelectorAll('.check input, .check')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return [e.tagName === 'INPUT' ? 'cb' : 'label', r.width, r.height]; }));
  expect(small.filter(x => x[0] === 'cb').every(x => x[1] >= 24 && x[2] >= 24) && small.filter(x => x[0] === 'label').every(x => x[2] >= 32), '手机端复选框 >= 24px,标签点击区高度 >= 32px');
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });

  // 清空确认
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.click('#btn-clear');
  expect(await page.isVisible('#clear-confirm'), '清空前出现页内确认');
  await page.click('#btn-clear-yes');
  expect((await page.inputValue('#links-text')) === '', '清空后文本为空');
  await page.close();

  // 存储失败:写入抛 QuotaExceededError → 持续可见的未保存提示
  const bad = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  bad.on('console', m => { if (m.type() === 'error') problems.push('quota页 console: ' + m.text()); });
  bad.on('pageerror', e => problems.push('quota页 pageerror: ' + e.message));
  await bad.addInitScript(() => {
    Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
  });
  await bad.goto(URL_);
  await bad.click('#btn-sample');
  await bad.waitForSelector('.result');
  expect(await bad.isVisible('#save-warning'), '存储失败时显示未保存提示');
  expect((await bad.textContent('#flash')).includes('未能保存'), '存储失败时不显示成功保存');
  expect(!(await bad.textContent('#flash')).includes('已保存到本机'), '不能谎报已保存');
  await bad.close();

  // 本地存储里是不合法设置:整份忽略并提示
  const inv = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  inv.on('pageerror', e => problems.push('invalid页 pageerror: ' + e.message));
  await inv.addInitScript(() => { localStorage.setItem('urlcheck.v1', JSON.stringify({ text: 'x', buildBase: '', buildTable: '', settings: { required: 'bad' } })); });
  await inv.goto(URL_);
  expect(await inv.isVisible('#load-warning'), '不合法存储显示提示');
  expect((await inv.inputValue('#links-text')) === '', '不合法存储不被采用');
  await inv.close();

  // 示例标记刷新后仍在;清空后消失;清空时存档删除失败要持续提示
  const smp = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  smp.on('pageerror', e => problems.push('sample页 pageerror: ' + e.message));
  await smp.goto(URL_);
  await smp.evaluate(() => localStorage.clear());
  await smp.reload();
  await smp.click('#btn-sample');
  await smp.waitForSelector('#results .result');
  await smp.reload();
  expect(await smp.isVisible('#sample-tag-check'), '刷新后输入区仍标注「合成示例」');
  await smp.click('#btn-check');
  const [dlS] = await Promise.all([smp.waitForEvent('download'), smp.click('#export-csv')]);
  expect(dlS.suggestedFilename().includes('合成示例'), '示例的导出文件名带「合成示例」');
  await smp.evaluate(() => { Storage.prototype.removeItem = function () { throw new DOMException('denied', 'SecurityError'); }; });
  await smp.click('#btn-clear'); await smp.click('#btn-clear-yes');
  expect(await smp.isVisible('#clear-warning') && (await smp.textContent('#clear-warning')).includes('未能删除'), '本机存档删除失败时持续提示,不说已清空');
  expect(!(await smp.textContent('#flash')).includes('都已清空'), '删除失败时不显示"都已清空"');
  expect(await smp.isHidden('#sample-tag-check'), '清空后合成示例标识消失');
  await smp.close();

  // 示例按钮:有用户内容时必须先页内确认
  const rep = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  rep.on('pageerror', e => problems.push('replace页 pageerror: ' + e.message));
  await rep.goto(URL_);
  await rep.evaluate(() => localStorage.clear());
  await rep.reload();
  await rep.fill('#links-text', 'https://mine.example.org/page?utm_source=mine');
  await rep.click('#btn-sample');
  expect(await rep.isVisible('#sample-confirm'), '有内容时点载入示例先出现替换确认');
  expect((await rep.inputValue('#links-text')).includes('mine.example.org'), '确认前用户内容未被替换');
  await rep.click('#btn-sample-no');
  expect((await rep.inputValue('#links-text')).includes('mine.example.org'), '取消后用户内容保留');
  await rep.click('#btn-sample-2').catch(() => {});
  await rep.click('#btn-sample');
  await rep.click('#btn-sample-yes');
  await rep.waitForSelector('#results .result');
  expect(!(await rep.inputValue('#links-text')).includes('mine.example.org'), '确认后才替换为示例');
  // 参数表引号未闭合:拒绝整份,不出结果
  await rep.click('[data-view="build"]');
  await rep.fill('#build-table', 'source,medium,campaign\na,"m,c\n');
  await rep.click('#btn-build');
  expect((await rep.textContent('#build-summary')).includes('引号'), '引号未闭合时拒绝并说明');
  expect(await rep.isDisabled('#export-build-csv'), '拒绝时构建导出禁用');
  await rep.close();

  // 展示图
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  show.on('pageerror', e => problems.push('showcase pageerror: ' + e.message));
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(300);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();

  console.log(`断言数:${asserts}`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
