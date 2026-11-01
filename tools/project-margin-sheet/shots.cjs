'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const C = require('./core.js');
require('./sample-data.js');
const SAMPLE = globalThis.MARGIN_SAMPLE;
const FALLBACK_EXE = process.env.CHROME_PATH || undefined;
const URL = 'file://' + encodeURI(path.join(__dirname, 'index.html'));
const TODAY = '2026-10-20';
const OUT = path.join(__dirname, 'screenshots');
const TMP = path.join(__dirname, '.omc');

let asserts = 0;
const problems = [];
const check = (cond, msg) => { asserts += 1; if (!cond) problems.push('断言失败:' + msg); else console.log('  ok  ' + msg); };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });
  let browser;
  try { browser = await chromium.launch(); }
  catch (firstError) {
    console.log('Playwright 默认 Chromium 不可用,改用 chrome-headless-shell:', firstError.message.split('\n')[0]);
    browser = await chromium.launch({ executablePath: FALLBACK_EXE });
  }
  const watch = page => {
    page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
    page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  };
  const noOverflow = async (page, label) => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(`${label}: scrollWidth ${sw} <= innerWidth ${iw}`);
    check(sw <= iw, `${label}无横向溢出(${sw} <= ${iw})`);
  };
  const statV = (page, key) => page.locator('#result .stat', { has: page.locator('.k', { hasText: new RegExp('^' + key + '$') }) }).locator('.v');

  // ---------- 0. 存储失败不能静默 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage(); watch(page);
    await page.addInitScript(() => { Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); }; });
    await page.goto(URL + '?today=' + TODAY);
    await page.click('#new-project');
    await page.fill('#f-name', '存储失败测试');
    const banner = await page.locator('#save-banner');
    check(await banner.isVisible(), '存储写入抛 QuotaExceededError 时「未保存」提示可见');
    check((await banner.textContent()).includes('未保存') && (await banner.textContent()).includes('导出'), '提示文字含「未保存」并引导导出');
    check((await page.textContent('#save-state')).includes('未保存') && !(await page.textContent('#save-state')).includes('已保存'), '状态栏显示未保存,没有成功提示');
    await page.fill('#f-client', '客户甲');
    check(await banner.isVisible(), '继续编辑后提示仍然可见(持续)');
    await ctx.close();
  }

  // ---------- 1. 空状态 ----------
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  const page = await ctx.newPage(); watch(page);
  await page.goto(URL + '?today=' + TODAY);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  check(await page.locator('#empty-guide').isVisible(), '空状态显示引导');
  const editorDisplay = () => page.evaluate(() => getComputedStyle(document.getElementById('editor')).display);
  check((await editorDisplay()) === 'none' && await page.locator('#delete-project').isHidden(), '空状态下 #editor 的 computed display 为 none,「删除这个项目」不可见(hidden 属性生效)');
  check((await page.textContent('#today-fixed')).includes('基准日 ' + TODAY + '(由地址参数固定)') && await page.locator('#today-fixed').isVisible(), '?today 生效时页头持续显示基准日');
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

  // ?today 非法(2026-02-30 会自动进位)必须回退真实今天
  {
    const p2 = await ctx.newPage(); watch(p2);
    await p2.goto(URL + '?today=2026-02-30');
    await p2.click('[data-tab="export"]');
    const label = await p2.textContent('#today-label');
    const real = C.localDateString(new Date());
    check(label === real, `?today=2026-02-30 回退真实今天(${label})`);
    await p2.close();
  }

  // ---------- 2. 载入示例 + 覆盖确认 ----------
  await page.click('#load-sample');
  await page.waitForSelector('.project-item');
  check((await page.locator('.project-item').count()) === 9, '载入示例得到 9 个项目');
  await page.click('.project-item:has-text("官网改版")');
  check((await editorDisplay()) === 'grid' && await page.locator('#delete-project').isVisible(), '载入示例并选中项目后 #editor 的 computed display 为 grid');
  await page.fill('#f-name', '我改过的名字');
  await page.click('#load-sample');
  check(await page.locator('#sample-confirm').isVisible(), '已有数据时载入示例先出现页内替换确认');
  check((await page.locator('.project-item:has-text("我改过的名字")').count()) === 1, '确认前保留原状态');
  await page.click('#sample-confirm-no');
  check((await page.locator('.project-item:has-text("我改过的名字")').count()) === 1 && !(await page.locator('#sample-confirm').isVisible()), '取消后数据仍是用户改过的');
  await page.click('#load-sample');
  await page.click('#sample-confirm-yes');
  check((await page.locator('.project-item:has-text("官网改版")').count()) === 1 && (await page.locator('.project-item:has-text("我改过的名字")').count()) === 0, '确认后才替换为示例');

  // ---------- 3. 核心路径:选项目 → 加成本行 → 毛利率变化 ----------
  const p6 = SAMPLE.projects.find(p => p.id === 'sample-p6');
  await page.click('.project-item:has-text("课程视频")');
  check((await statV(page, '毛利率').textContent()) === C.formatPct(C.margin(p6).rate), `界面毛利率与 core 一致(${C.formatPct(C.margin(p6).rate)})`);
  await page.click('[data-add="travel"]');
  await page.fill('#lines .line:last-child [data-f="amount"]', '1200');
  const p6b = JSON.parse(JSON.stringify(p6)); p6b.lines.push({ id: 'x', type: 'travel', note: '', amount: 120000 });
  check((await statV(page, '毛利率').textContent()) === C.formatPct(C.margin(p6b).rate), `加差旅 1200 元后毛利率变为 ${C.formatPct(C.margin(p6b).rate)}`);
  await page.fill('#lines .line:last-child [data-f="amount"]', 'abc');
  check((await page.locator('#lines .line:last-child .field-error').first().isVisible()), '非法金额显示行内错误');
  await page.fill('#lines .line:last-child [data-f="amount"]', '1200');
  // 成本行删除先确认
  const rateBeforeDel = await statV(page, '毛利率').textContent();
  const linesBefore = await page.locator('#lines .line').count();
  await page.locator('#lines .line:last-child [data-del]').click();
  check(await page.locator('#lines .line:last-child .line-confirm').isVisible() && (await page.locator('#lines .line:last-child .line-confirm').textContent()).includes('直接成本'), '删除成本行前先在该行出现确认,写明对直接成本的影响');
  check((await page.locator('#lines .line').count()) === linesBefore && (await statV(page, '毛利率').textContent()) === rateBeforeDel, '确认前成本行与毛利率不变');
  await page.locator('#lines .line:last-child [data-del-no]').click();
  check((await page.locator('#lines .line').count()) === linesBefore && await page.locator('#lines .line:last-child [data-del]').isVisible(), '取消后成本行保留');
  await page.locator('#lines .line:last-child [data-del]').click();
  await page.locator('#lines .line:last-child [data-del-yes]').click();
  check((await page.locator('#lines .line').count()) === linesBefore - 1 && (await statV(page, '毛利率').textContent()) !== rateBeforeDel, '确认后成本行被删除,毛利率随之变化');
  check(await page.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-del') || document.activeElement.hasAttribute('data-add')), '删除后焦点落在相邻删除按钮或添加按钮上');
  check((await page.textContent('#result')).includes('不是你的实际时薪'), '结果区写明毛利、每小时毛利公式与机会成本时薪的用途');
  // 状态:已收款后不再逾期
  await page.click('.project-item:has-text("品牌手册")');
  check(await page.locator('#result .flag-bad').count() === 1, '品牌手册显示逾期');
  await page.selectOption('#f-status', '已收款');
  check(await page.locator('#result .flag-bad').count() === 0, '改为已收款后不再逾期');
  await page.selectOption('#f-status', '已交付');
  check(await page.locator('#result .flag-bad').count() === 1, '改回已交付又逾期');
  await page.click('.project-item:has-text("展会物料")');
  check(await page.locator('#result .flag-warn').count() === 1, '展会物料显示低于机会成本警示');
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png') });
  await noOverflow(page, '桌面(项目页)');

  // 边界值:新建项目填超长文本 + 最大金额,reload 后仍在
  await page.click('#new-project');
  check((await editorDisplay()) === 'grid', '新建项目后 #editor 的 computed display 为 grid');
  const longName = '长'.repeat(3000);
  await page.fill('#f-name', longName);
  await page.fill('#f-quote', '9999999999.99');
  await page.click('[data-add="tool"]');
  await page.reload();
  await page.click('.project-item:has-text("长长长")');
  check((await page.inputValue('#f-name')).length === 3000, 'reload 后 3000 字名称仍在');
  check((await page.inputValue('#f-quote')) === '9999999999.99', 'reload 后最大金额报价仍在');
  check((await page.locator('.project-item').count()) === 10 && (await page.locator('#save-banner').isHidden()), 'reload 后 10 个项目,没有存档损坏提示');
  await page.fill('#f-quote', '99999999999');
  check(await page.locator('#f-quote').getAttribute('aria-invalid') === 'true', '超过上限的金额被拒绝并标红');
  await page.click('#delete-project');
  check(await page.locator('#delete-confirm').isVisible(), '删除先出页内确认');
  await page.click('#delete-yes');
  check((await page.locator('.project-item').count()) === 9, '确认删除后回到 9 个项目');

  // ---------- 4. 组合 ----------
  await page.click('[data-tab="portfolio"]');
  const r = C.portfolio(SAMPLE.projects, TODAY);
  const body = await page.textContent('#portfolio-body');
  check(body.includes('逾期项目') && (await page.locator('#portfolio-body .stat', { hasText: '逾期项目' }).locator('.v').textContent()) === '2 个', '组合页逾期项目为 2 个');
  const firstRow = await page.locator('#portfolio-body table.fin >> nth=0').locator('tbody tr >> nth=0').textContent();
  check(firstRow.includes(C.nameOf(r.items[0].project)), `排序第一名是 ${C.nameOf(r.items[0].project)}`);
  check(body.includes('最差 3 个项目') && body.includes('展会物料') && body.includes('都有「外包」成本行'), '最差 3 个与共同特征出现');
  check(body.includes('本季度') && body.includes('2026 年第 4 季度') && body.includes('2026 年第 3 季度'), '本季度与上季度对比出现');

  // ---------- 5. 情景 ----------
  await page.click('[data-tab="scenario"]');
  await page.selectOption('#sc-project', 'sample-p2');
  const rate0 = await page.locator('#sc-out .bar-row >> nth=1').locator('.bar-val').textContent();
  await page.evaluate(() => { const el = document.getElementById('sc-discount'); el.value = '20'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  const rate1 = await page.locator('#sc-out .bar-row >> nth=1').locator('.bar-val').textContent();
  const p2 = SAMPLE.projects.find(p => p.id === 'sample-p2');
  check(rate1 === C.formatPct(C.scenario(p2, { discount: 20 }).scenario.rate) && rate0 !== rate1, `折扣 20% 后试算毛利率 ${rate0} → ${rate1}`);
  await page.evaluate(() => { const el = document.getElementById('sc-hourly'); el.value = '200'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  const rate2 = await page.locator('#sc-out .bar-row >> nth=1').locator('.bar-val').textContent();
  check(rate2 === C.formatPct(C.scenario(p2, { discount: 20, hourly: 20000 }).scenario.rate), `时薪 200 元 + 折扣 20% 后试算毛利率 ${rate2}`);
  check((await page.locator('#sc-out .bar-fill >> nth=1').getAttribute('style')).includes('width'), '条形宽度来自运行时数据');
  check(C.formatPct(C.margin(p2).rate) === (await page.locator('#sc-out .bar-row >> nth=0').locator('.bar-val').textContent()), '试算不改动项目(当前毛利率不变)');

  // ---------- 6. 导出与数据 ----------
  // 非法输入守卫:报价输入非法文本 → 导出禁用并提示 → 修正后恢复
  await page.click('[data-tab="projects"]');
  await page.fill('#f-quote', 'abc');
  await page.click('[data-tab="export"]');
  check(await page.locator('#export-csv').isDisabled() && await page.locator('#export-md').isDisabled() && await page.locator('#export-json').isDisabled(), '报价输入非法时三个导出按钮都禁用');
  check(await page.locator('#export-block').isVisible(), '导出页显示未通过校验的提示');
  await page.click('[data-tab="projects"]');
  await page.fill('#f-quote', '18000');
  await page.click('[data-tab="export"]');
  check(await page.locator('#export-csv').isEnabled() && await page.locator('#export-block').isHidden(), '改正后导出恢复');
  await page.click('[data-tab="projects"]');
  await page.fill('#f-quote', 'abc');
  await page.click('.project-item:has-text("官网改版")');
  await page.click('[data-tab="export"]');
  check(await page.locator('#export-csv').isEnabled(), '切换项目撤销该输入后导出恢复');

  const [dl1] = await Promise.all([page.waitForEvent('download'), page.click('#export-csv')]);
  const csvPath = path.join(TMP, 'out.csv'); await dl1.saveAs(csvPath);
  const csv = fs.readFileSync(csvPath, 'utf8').replace(/^\ufeff/, '');
  check(dl1.suggestedFilename().endsWith('.csv') && csv.split('\r\n').filter(Boolean).length === 10 && csv.startsWith('项目,客户,状态'), 'CSV 下载:表头 + 9 行');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#export-md')]);
  const mdPath = path.join(TMP, 'out.md'); await dl2.saveAs(mdPath);
  check(fs.readFileSync(mdPath, 'utf8').startsWith('# 项目毛利说明:'), 'Markdown 下载内容正确');
  const [dl3] = await Promise.all([page.waitForEvent('download'), page.click('#export-json')]);
  const jsonPath = path.join(TMP, 'backup.json'); await dl3.saveAs(jsonPath);
  check(C.validateImport(fs.readFileSync(jsonPath, 'utf8')).ok, 'JSON 备份通过 validateImport');
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png'), fullPage: false });

  // 导入:非法文件整份拒绝
  const bad = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); bad.projects[1].status = '完成了';
  const badPath = path.join(TMP, 'bad.json'); fs.writeFileSync(badPath, JSON.stringify(bad));
  await page.setInputFiles('#import-file', badPath);
  await page.waitForSelector('#import-msg:not([hidden])');
  check((await page.textContent('#import-msg')).includes('拒绝') && (await page.textContent('#import-msg')).includes('完成了'), '非法状态枚举被整份拒绝并给原因');
  check(!(await page.locator('#import-confirm').isVisible()), '拒绝后不出现替换确认');
  // 合法文件:有数据时要先确认
  await page.setInputFiles('#import-file', jsonPath);
  await page.waitForSelector('#import-confirm:not([hidden])');
  check(true, '合法文件导入前出现页内替换确认');
  await page.click('#import-no');
  check((await page.textContent('#import-msg')).includes('取消'), '取消导入保持原状');
  await page.setInputFiles('#import-file', jsonPath);
  await page.waitForSelector('#import-confirm:not([hidden])');
  await page.click('#import-yes');
  check((await page.textContent('#import-msg')).includes('已替换'), '确认后导入成功');

  // 清空
  await page.click('#clear-data');
  check(await page.locator('#clear-confirm').isVisible(), '清空前先页内确认');
  await page.click('#clear-no');
  await page.click('[data-tab="projects"]');
  check((await page.locator('.project-item').count()) === 9, '取消清空后数据还在');

  // ---------- 7. 手机 ----------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  await page.click('.project-item:has-text("官网改版")');
  await noOverflow(page, '手机(项目页)');
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
  await page.click('[data-tab="portfolio"]');
  await noOverflow(page, '手机(组合页)');
  await page.click('[data-tab="scenario"]');
  await noOverflow(page, '手机(情景页)');
  await page.click('[data-tab="export"]');
  await noOverflow(page, '手机(导出页)');
  await page.close();

  // ---------- 8. 展示图 ----------
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  watch(show);
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(400);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();

  for (const f of ['01-空状态-桌面.png', '02-核心流程-桌面.png', '03-结果与导出-桌面.png', '04-手机.png']) check(fs.existsSync(path.join(OUT, f)), '截图存在 ' + f);
  check(fs.existsSync(path.join(__dirname, 'showcase.png')), 'showcase.png 存在');
  console.log(`断言共 ${asserts} 条`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
