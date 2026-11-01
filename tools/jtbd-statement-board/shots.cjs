'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const URL = 'file://' + encodeURI(path.join(__dirname, 'index.html')) + '?today=2026-10-20';
const OUT = path.join(__dirname, 'screenshots');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jtbd-shots-'));
  const browser = await chromium.launch({ executablePath: EXE });
  const problems = [];
  let asserts = 0;
  const check = (cond, msg) => { asserts += 1; if (!cond) problems.push('断言失败:' + msg); else console.log('OK  ' + msg); };

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  const noOverflow = async label => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(`${label}: scrollWidth ${sw} <= innerWidth ${iw} -> ${sw <= iw ? 'OK' : 'FAIL'}`);
    asserts += 1; if (sw > iw) problems.push(`${label} 横向溢出 ${sw} > ${iw}`);
  };
  const jobCount = () => page.$$eval('#job-select option', o => o.length);

  // ---- 空状态 ----
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  check(await page.isVisible('#empty') && !(await page.isVisible('#work')), '空状态显示引导,工作区隐藏');
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

  // ---- 载入示例,看第二个任务的规则警告 ----
  await page.click('#empty-sample');
  await page.waitForSelector('#work:not([hidden])');
  check((await jobCount()) === 2, '示例载入 2 个任务');
  const j1 = await page.$eval('#job-select', s => s.value);
  const j2 = await page.$$eval('#job-select option', o => o[1].value);
  await page.selectOption('#job-select', j2);
  const issues2 = await page.textContent('#issues');
  check(issues2.includes('写的是方案不是任务') && issues2.includes('切换阻力大于动力') && issues2.includes('没有替代方案'), '任务二显示方案词警告、阻力提示、无替代方案警告');
  await page.selectOption('#job-select', j1);
  check(!(await page.textContent('#issues')).includes('阻断'), '任务一没有阻断项');

  // ---- 核心流程:新增推力 → 挂证据 → 假设占比变化 → 候选覆盖 ----
  const statsBefore = await page.textContent('#stats');
  await page.click('#force-push >> text=添加推力');
  await page.fill('#force-push .item >> nth=-1 >> textarea', '一周有三个晚上在补发漏掉的反馈');
  const statsMid = await page.textContent('#stats');
  check(statsMid !== statsBefore && statsMid.includes('共 6 条'), '新增推力后统计变为共 6 条');
  await page.click('#force-push .item >> nth=-1 >> text=挂证据');
  await page.selectOption('#force-push .item >> nth=-1 >> select', 'interview');
  await page.fill('#force-push .item >> nth=-1 >> .ev-form textarea', '合成示例:老师 B 说上周漏发了两位家长');
  await page.fill('#force-push .item >> nth=-1 >> .ev-form input[type=text]', 'javascript:alert(1)');
  await page.click('#force-push .item >> nth=-1 >> text=添加这条证据');
  check((await page.textContent('#force-push .item >> nth=-1 >> .field-msg')).includes('http'), '非 http(s) 链接来源被拒绝并给出原因');
  await page.fill('#force-push .item >> nth=-1 >> .ev-form input[type=text]', 'https://example.com/synthetic');
  await page.click('#force-push .item >> nth=-1 >> text=添加这条证据');
  check((await page.textContent('#force-push .item >> nth=-1 >> .tag')).includes('证据 1 条'), '挂证据后标签由「假设」变为「证据 1 条」');
  const statsAfter = await page.textContent('#stats');
  check(statsAfter !== statsMid, '挂证据后假设占比文字变化:' + statsAfter.replace(/\s+/g, ' ').slice(0, 40));

  await page.click('[data-tab=compare]');
  await page.click('#add-candidate');
  await page.fill('.cand >> nth=-1 >> .cand-head input', '=测试候选(含公式开头)');
  await page.check('.cand >> nth=-1 >> fieldset >> nth=0 >> input[type=checkbox] >> nth=0');
  await page.check('.cand >> nth=-1 >> fieldset >> nth=1 >> input[type=checkbox] >> nth=0');
  check(/推力\/拉力 1\/\d+ · 焦虑 1\/\d+/.test(await page.textContent('.cand >> nth=-1 >> .cand-count')), '新候选的覆盖数 1 + 1');
  check((await page.$$('#matrix td.hit')).length >= 2, '覆盖矩阵出现覆盖单元格');
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png') });
  await noOverflow('桌面·候选对比');

  // ---- 载入示例不能无确认覆盖 ----
  await page.click('[data-tab=statement]');
  await page.click('#load-sample');
  check(await page.isVisible('#confirm'), '已有数据时点载入示例先出现页内确认');
  check((await page.$$('#force-push .item')).length === 4, '确认前原状态保留(推力仍为 4 条)');
  await page.click('#confirm-no');
  check(!(await page.isVisible('#confirm')) && (await page.$$('#force-push .item')).length === 4, '取消后原数据不变');

  // ---- 边界值:超长文本 + 半成品条目,保存后刷新仍在 ----
  const longText = '长'.repeat(100000);
  await page.fill('#f-situation', longText);
  await page.fill('#f-motivation', '');
  await page.click('#force-anxiety >> text=添加焦虑'); // 空白条目 = 半成品
  await page.reload();
  await page.waitForSelector('#work:not([hidden])');
  check((await page.$eval('#f-situation', e => e.value.length)) === 100000, '10 万字情境保存后刷新仍在');
  check((await page.$$('#force-anxiety .item')).length === 3, '刷新后空白焦虑条目仍在(半成品没被整份拒绝)');
  check((await page.$$('#force-push .item')).length === 4, '刷新后新增的推力与证据仍在');

  // ---- 导出 ----
  await page.click('[data-tab=export]');
  check(await page.isDisabled('#export-md'), '动机为空(有阻断项)时禁用任务陈述卡导出');
  check((await page.textContent('#export-note')).includes('动机'), '禁用时给出原因');
  await page.click('[data-tab=statement]');
  await page.fill('#f-situation', '一节课刚结束,我要在当晚给每位家长发一条学习反馈');
  await page.fill('#f-motivation', '说清孩子这节课学了什么、哪里要练');
  await page.click('[data-tab=export]');
  check(!(await page.isDisabled('#export-md')), '补全三段后任务陈述卡可导出');
  const [dMd] = await Promise.all([page.waitForEvent('download'), page.click('#export-md')]);
  const mdText = fs.readFileSync(await dMd.path(), 'utf8');
  check(mdText.startsWith('# 任务陈述卡:课后给家长发反馈') && mdText.includes('## 候选方案覆盖'), 'Markdown 下载内容正确:' + dMd.suggestedFilename());
  check(mdText.includes("'=测试候选"), 'Markdown 表格里以 = 开头的候选名带单引号前缀');
  const [dCsv] = await Promise.all([page.waitForEvent('download'), page.click('#export-csv')]);
  const csvText = fs.readFileSync(await dCsv.path(), 'utf8');
  check(csvText.includes("'=测试候选") && csvText.split('\r\n')[0].startsWith('﻿候选方案'), 'CSV 下载内容正确且带公式防护:' + dCsv.suggestedFilename());
  const [dJson] = await Promise.all([page.waitForEvent('download'), page.click('#export-json')]);
  const jsonPath = path.join(tmp, 'backup.json');
  fs.copyFileSync(await dJson.path(), jsonPath);
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png') });
  await noOverflow('桌面·导出');

  // ---- 导入:坏文件整份拒绝,好文件需确认替换 ----
  const bad = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  bad.jobs[0].forces.push[0].evidence[0].type = 'rumor';
  const badPath = path.join(tmp, 'bad.json');
  fs.writeFileSync(badPath, JSON.stringify(bad));
  await page.setInputFiles('#import-file', badPath);
  await page.waitForSelector('#import-errors:not([hidden])');
  check((await page.textContent('#import-error-list')).includes('rumor') && (await jobCount()) === 2, '坏备份被整份拒绝并说明原因,当前数据未变');
  const badId = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  badId.jobs[0].candidates[0].id = '"';
  const badIdPath = path.join(tmp, 'badid.json');
  fs.writeFileSync(badIdPath, JSON.stringify(badId));
  await page.setInputFiles('#import-file', badIdPath);
  await page.waitForSelector('#import-errors:not([hidden])');
  check((await page.textContent('#import-error-list')).includes('id') && (await jobCount()) === 2, '候选 id 为双引号的备份被拒绝,页面不抛错');
  const emptyEv = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  emptyEv.jobs[0].forces.pull[1].evidence = [{ id: 'ev_blank', type: 'data', text: '  ', source: '', date: '' }];
  const emptyEvPath = path.join(tmp, 'emptyev.json');
  fs.writeFileSync(emptyEvPath, JSON.stringify(emptyEv));
  await page.setInputFiles('#import-file', emptyEvPath);
  await page.waitForSelector('#import-errors:not([hidden])');
  check((await page.textContent('#import-error-list')).includes('正文') && (await jobCount()) === 2, '正文为空的证据备份被拒绝');
  const good = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  good.jobs = good.jobs.slice(0, 1);
  good.currentId = good.jobs[0].id;
  const goodPath = path.join(tmp, 'good.json');
  fs.writeFileSync(goodPath, JSON.stringify(good));
  await page.setInputFiles('#import-file', goodPath);
  await page.waitForSelector('#confirm:not([hidden])');
  check((await jobCount()) === 2, '导入确认前原数据保留');
  await page.click('#confirm-yes');
  check((await jobCount()) === 1, '确认后替换为备份里的 1 个任务');

  // ---- 空库也能导入备份;删除四力条目先确认 ----
  const ectx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const epage = await ectx.newPage();
  epage.on('console', m => { if (m.type() === 'error') problems.push('[empty-import] console error: ' + m.text()); });
  epage.on('pageerror', e => problems.push('[empty-import] pageerror: ' + e.message));
  await epage.goto(URL);
  await epage.evaluate(() => localStorage.clear());
  await epage.reload();
  check(await epage.isVisible('#empty') && await epage.isVisible('#import-backup') && await epage.isVisible('#empty-import'), '空状态下顶部与引导里都能看到「导入 JSON 备份」入口');
  await epage.focus('#empty-import');
  const [chooser] = await Promise.all([epage.waitForEvent('filechooser'), epage.keyboard.press('Enter')]);
  check(!!chooser, '空状态下按 Enter 可打开备份文件选择');
  await chooser.setFiles(goodPath);
  await epage.waitForSelector('#work:not([hidden])');
  check(!(await epage.isVisible('#confirm')) && (await epage.$$eval('#job-select option', o => o.length)) === 1, '空库导入备份直接生效,不需要确认');
  const nPush = (await epage.$$('#force-push .item')).length;
  const withEv = epage.locator('#force-push .item', { has: epage.locator('.tag-ok') }).first();
  const targetText = await withEv.locator('textarea').first().inputValue();
  await withEv.getByRole('button', { name: /^删除这条推力$/ }).click();
  const cText = await epage.textContent('#confirm-text');
  check(await epage.isVisible('#confirm') && cText.includes(targetText.slice(0, 10)) && /\d+ 条证据/.test(cText) && /\d+ 个候选方案/.test(cText), '删除四力条目先出现页内确认,写明内容、证据数、受影响候选数');
  check((await epage.$$('#force-push .item')).length === nPush, '确认之前条目数不变');
  await epage.click('#confirm-no');
  check((await epage.$$('#force-push .item')).length === nPush, '取消后条目仍在');
  check(await epage.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label') === '删除这条推力'), '取消后焦点回到原删除按钮');
  const evBefore = (await epage.evaluate(() => JSON.parse(localStorage.getItem('jtbd.v1')))).jobs[0].forces.push.length;
  await epage.locator('#force-push .item', { has: epage.locator('.tag-ok') }).first().getByRole('button', { name: /^删除这条推力$/ }).click();
  await epage.click('#confirm-yes');
  check((await epage.$$('#force-push .item')).length === nPush - 1, '确认后条目减少 1 条');
  check((await epage.evaluate(() => JSON.parse(localStorage.getItem('jtbd.v1')))).jobs[0].forces.push.length === evBefore - 1, '确认后已写入存储');
  await ectx.close();

  // ---- 手机 ----
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('[data-tab=statement]');
  await page.waitForTimeout(200);
  await noOverflow('手机·陈述与四力');
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
  await page.click('[data-tab=compare]');
  await noOverflow('手机·候选对比');
  await page.click('[data-tab=export]');
  await noOverflow('手机·导出');
  await page.close();

  // ---- 存储失败:持续可见的未保存提示 ----
  const bctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const bpage = await bctx.newPage();
  await bpage.addInitScript(() => {
    Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
  });
  bpage.on('pageerror', e => problems.push('storage-fail pageerror: ' + e.message));
  await bpage.goto(URL);
  await bpage.click('#empty-sample');
  await bpage.waitForSelector('#work:not([hidden])');
  const bannerText = await bpage.textContent('#save-banner');
  check(await bpage.isVisible('#save-banner') && bannerText.includes('未保存'), 'setItem 抛 QuotaExceededError 时显示「未保存」提示');
  check(!(await bpage.textContent('#save-status')).includes('已保存'), '写入失败时不显示「已保存」');
  await bpage.fill('#f-user', '继续编辑');
  check(await bpage.isVisible('#save-banner'), '继续编辑后未保存提示仍然可见');
  await bctx.close();

  // ---- 展示图 ----
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  show.on('pageerror', e => problems.push('showcase pageerror: ' + e.message));
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(300);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(`断言共 ${asserts} 条`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
