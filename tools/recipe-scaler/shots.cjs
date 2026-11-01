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
  const check = (cond, msg) => { asserts++; if (!cond) problems.push('断言失败:' + msg); else console.log('OK  ' + msg); };
  const watch = (page, tag) => {
    page.on('console', m => { if (m.type() === 'error') problems.push(tag + ' console: ' + m.text()); });
    page.on('pageerror', e => problems.push(tag + ' pageerror: ' + e.message));
  };

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page, '主页面');
  const noOverflow = async label => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(`${label}: scrollWidth ${sw} <= innerWidth ${iw}`);
    check(sw <= iw, `${label}无横向溢出 (${sw} <= ${iw})`);
  };
  const text = sel => page.textContent(sel);

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  check(await page.isVisible('#empty'), '空状态显示引导');
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

  // 载入示例 → 按面粉 350 g 反推
  await page.click('#load-sample');
  await page.waitForSelector('.recipe-item');
  check((await page.$$('.recipe-item')).length === 3, '示例载入 3 份配方');
  await page.click('#mode-ingredient');
  await page.selectOption('#target-ingredient', '面粉');
  await page.fill('#target-amount', '350');
  check((await text('#factor-out')).trim() === '×0.7', '面粉 500 g → 350 g 倍数 ×0.7');
  const body1 = await text('#result-body');
  check(body1.includes('3.5') && body1.includes('0.7'), '酵母 3.5 g、鸡蛋 0.7 个');
  check(body1.includes('不缩放') && body1.includes('适量'), '「适量」标不缩放');
  check((await text('#result-body')).includes('1 个'), '鸡蛋 0.7 个给出取整 1 个');
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png') });

  // 单位:按产量 ×4,面粉 2 kg;关闭自动升降
  await page.click('#mode-servings');
  await page.fill('#target-servings', '8');
  check((await text('#factor-out')).trim() === '×4', '产量 2 → 8 倍数 ×4');
  check((await text('#result-body')).includes('2 kg'), '2000 g 自动显示为 2 kg');
  await page.uncheck('#opt-auto');
  check((await text('#result-body')).includes('2000 g'), '关闭自动升降后显示 2000 g');
  await page.check('#opt-auto');

  // 曲奇:分数、范围
  await page.click('.recipe-item >> nth=1');
  await page.fill('#target-servings', '36');
  await page.selectOption('#opt-format', 'fraction');
  const body2 = await text('#result-body');
  check(body2.includes('2 1/4'), '1 1/2 杯 ×1.5 分数显示 2 1/4 杯');
  check(body2.includes('3–4 1/2') || body2.includes('3–4.5'), '范围 2-3 汤匙两端分别缩放');
  check(body2.includes('1.5 个') || body2.includes('1 1/2 个'), '鸡蛋 1.5 个');
  await page.selectOption('#opt-format', 'decimal');

  // 烘焙百分比与反向生成
  await page.click('.recipe-item >> nth=0');
  const bp = await text('#bp-box');
  check(bp.includes('50%') && bp.includes('100%') && bp.includes('容积') === false, '烘焙百分比显示水 50%');
  await page.fill('#pct-lines', '面粉 | 100\n水 | 70\n盐 | 2');
  await page.fill('#pct-base', '400');
  await page.fill('#pct-name', '百分比生成(合成示例)');
  await page.click('#pct-make');
  check((await page.inputValue('#r-lines')).includes('水 | 280 | g'), '按百分比反向生成水 280 g');
  await page.fill('#pct-lines', '水 | 70');
  await page.click('#pct-make');
  check(await page.isVisible('#pct-error'), '缺少 100% 基准时给出错误');


  // 修复回归:清空名称 → reload → 配方库仍在
  await page.click('[data-id="sample-toast"]');
  await page.fill('#r-name', '');
  await page.reload();
  check((await page.$$('.recipe-item')).length >= 3, '清空配方名称后刷新,配方库仍在');
  await page.fill('#r-name', '吐司(合成示例)');

  // 修复回归:原始产量非法 → 显示错误并停用导出
  await page.fill('#r-yield', '0');
  check(await page.isVisible('#yield-error') && await page.isDisabled('#export-md') && await page.isDisabled('#export-csv'), '原始产量为 0 时显示错误并停用导出');
  check((await text('#factor-out')).trim() === '—', '原始产量非法时不显示倍数');
  await page.fill('#r-yield', 'abc');
  check(await page.isVisible('#yield-error') && await page.isDisabled('#export-md'), '原始产量为非法文本时显示错误并停用导出');
  await page.fill('#r-yield', '2');
  check(!(await page.isVisible('#yield-error')) && !(await page.isDisabled('#export-md')), '产量改回合法值后恢复');

  // 修复回归:再次载入示例先确认覆盖
  await page.fill('#r-name', '我改过的吐司');
  await page.click('#load-sample');
  check(await page.isVisible('#sample-confirm'), '再次载入示例时先出现覆盖确认');
  await page.click('#sample-no');
  check((await page.inputValue('#r-name')) === '我改过的吐司', '取消覆盖后用户修改保留');
  await page.click('#load-sample');
  await page.click('#sample-yes');
  check((await page.inputValue('#r-name')).includes('吐司(合成示例)'), '确认后示例被恢复');
  await page.click('#mode-ingredient');
  await page.selectOption('#target-ingredient', '面粉');
  await page.fill('#target-amount', '350');

  // 回到吐司,导出
  await page.fill('#search', '吐司');
  check((await page.$$('.recipe-item')).length === 1, '搜索「吐司」只剩 1 份');
  await page.fill('#search', '');
  await page.click('.recipe-item >> nth=1');
  check((await page.inputValue('#r-name')).includes('吐司'), '回到吐司配方');
  await page.click('#mode-ingredient');
  await page.selectOption('#target-ingredient', '面粉');
  await page.fill('#target-amount', '350');
  const [dlMd] = await Promise.all([page.waitForEvent('download'), page.click('#export-md')]);
  const md = fs.readFileSync(await dlMd.path(), 'utf8');
  check(dlMd.suggestedFilename().endsWith('.md') && md.includes('(×0.7)') && md.includes('烘焙时间和温度'), 'Markdown 下载含倍数与时间温度提示');
  const [dlCsv] = await Promise.all([page.waitForEvent('download'), page.click('#export-csv')]);
  const csv = fs.readFileSync(await dlCsv.path(), 'utf8');
  check(csv.includes('名称,数量,单位') && csv.includes('面粉,350,g'), 'CSV 下载内容与界面一致');
  await page.evaluate(() => document.getElementById('h-result').scrollIntoView());
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png') });

  // 倍数无效时禁用导出
  await page.fill('#target-amount', '0');
  check(await page.isDisabled('#export-md') && await page.isDisabled('#export-csv'), '倍数无效时导出按钮停用');
  check((await text('#factor-out')).trim() === '—', '倍数无效时不显示旧倍数');
  await page.fill('#target-amount', '350');

  // 导入:非法单位整份拒绝;合法备份可导入
  const before = (await page.$$('.recipe-item')).length;
  const bad = JSON.stringify({ app: 'recipe-scaler', version: 1, recipes: [{ id: 'x1', name: '坏数据', yieldAmount: 1, yieldUnit: '份', baseName: '', ingredients: [{ name: '面', qtyText: '1', unit: '桶', note: '' }] }] });
  await page.setInputFiles('#import-file', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(bad) });
  await page.waitForSelector('#import-error:not([hidden])');
  check((await text('#import-error')).includes('单位') && (await page.$$('.recipe-item')).length === before, '非法单位导入被拒绝且不改动数据');
  const [dlJson] = await Promise.all([page.waitForEvent('download'), page.click('#export-json')]);
  const jsonText = fs.readFileSync(await dlJson.path(), 'utf8');
  await page.setInputFiles('#import-file', { name: 'ok.json', mimeType: 'application/json', buffer: Buffer.from(jsonText) });
  await page.waitForSelector('#import-confirm:not([hidden])');
  const confirmTitle = await text('#import-confirm-title');
  check(confirmTitle.includes('新增 0 份') && confirmTitle.includes('覆盖 ' + before + ' 份'), '导入前先显示新增与覆盖数量:' + confirmTitle);
  check((await text('#import-confirm-list')).includes('覆盖:'), '导入确认区列出被覆盖的配方名');
  await page.fill('#r-name', '导入前的临时改名');
  await page.click('#import-no');
  check((await page.inputValue('#r-name')) === '导入前的临时改名' && await page.isHidden('#import-confirm'), '取消导入后现有数据不变');
  await page.setInputFiles('#import-file', { name: 'ok.json', mimeType: 'application/json', buffer: Buffer.from(jsonText) });
  await page.waitForSelector('#import-confirm:not([hidden])');
  await page.click('#import-yes');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('导入完成'), null, { timeout: 5000 }).catch(() => {});
  check((await text('#toast')).includes('导入完成'), '确认后合法备份导入成功');
  check((await page.$$('.recipe-item')).length === before, '同 ID 导入按替换处理,数量不变');
  check((await page.inputValue('#r-name')) !== '导入前的临时改名', '确认覆盖后同 ID 配方被备份内容替换');

  // 修复回归:含空名称草稿的备份导出后可再导入
  await page.click('#new-recipe');
  await page.fill('#r-name', '');
  const [dlDraft] = await Promise.all([page.waitForEvent('download'), page.click('#export-json')]);
  const draftBackup = fs.readFileSync(await dlDraft.path(), 'utf8');
  check(JSON.parse(draftBackup).recipes.some(r => r.name === ''), '备份里包含空名称草稿');
  await page.setInputFiles('#import-file', { name: 'draft.json', mimeType: 'application/json', buffer: Buffer.from(draftBackup) });
  await page.waitForSelector('#import-confirm:not([hidden])');
  check(await page.isHidden('#import-error'), '含空名称草稿的备份可通过导入校验');
  await page.click('#import-no');

  // 删除先确认:确认区写明配方名与关联,确认前数据不变
  const nBefore = (await page.$$('.recipe-item')).length;
  await page.click('#delete-recipe');
  check(await page.isVisible('#delete-confirm') && (await text('#delete-detail')).includes('种配料'), '删除前先出现确认,并写明会一并删除的配料');
  check((await page.$$('.recipe-item')).length === nBefore, '确认前配方数量不变');
  await page.click('#delete-no');
  // 键盘:导入入口可聚焦;列表重绘后焦点保留
  await page.focus('#import-btn');
  check(await page.evaluate(() => document.activeElement.id) === 'import-btn', '导入入口是可聚焦按钮');
  await page.focus('.recipe-item >> nth=0');
  await page.keyboard.press('Enter');
  check(await page.evaluate(() => document.activeElement.classList.contains('recipe-item')), '选择配方后列表重绘,焦点仍在配方列表项上');
  await page.click('.recipe-item:has-text("吐司")');

  // 清空前先确认
  await page.click('#clear-data');
  check(await page.isVisible('#clear-confirm'), '清空前先出现页内确认区');
  await page.click('#clear-no');
  await noOverflow('桌面');
  await page.click('#mode-ingredient');
  await page.selectOption('#target-ingredient', '面粉');
  await page.fill('#target-amount', '350');

  // 手机
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await noOverflow('手机');
  const sizes = await page.evaluate(() => [...document.querySelectorAll('input[type=checkbox],input[type=radio]')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); const l = e.closest('label').getBoundingClientRect(); return [r.width, r.height, l.height]; }));
  check(sizes.length >= 3 && sizes.every(x => x[0] >= 24 && x[1] >= 24 && x[2] >= 32), '手机端复选框/单选框 >= 24px,标签点击区高度 >= 32px');
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
  await page.close();

  // 存储失败:持续提示,且不假称已保存
  const bad2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(bad2, '存储失败页');
  await bad2.addInitScript(() => {
    Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
  });
  await bad2.goto(URL);
  await bad2.click('#load-sample');
  await bad2.waitForSelector('.recipe-item');
  check(await bad2.isVisible('#save-warning') && (await bad2.textContent('#save-warning')).includes('导出 JSON'), '存储写入失败时出现持续的「未保存」提示并引导导出');
  const toastHidden = await bad2.evaluate(() => document.getElementById('toast').hidden || !document.getElementById('toast').textContent.includes('已载入'));
  check(toastHidden, '写入失败时不显示「已载入」成功提示');
  await bad2.close();

  // 展示图
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
