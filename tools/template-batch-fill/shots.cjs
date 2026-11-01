'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const FALLBACK = process.env.CHROME_PATH || undefined;
const URL = 'file://' + encodeURI(path.join(__dirname, 'index.html')) + '?today=2026-10-20';
const OUT = path.join(__dirname, 'screenshots');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tplshots-'));
  let browser;
  try { browser = await chromium.launch(); }
  catch (first) {
    if (!fs.existsSync(FALLBACK)) throw first;
    browser = await chromium.launch({ executablePath: FALLBACK });
  }
  const problems = [];
  let asserts = 0;
  const check = (cond, msg) => { asserts++; if (!cond) problems.push('断言失败:' + msg); else console.log('OK  ' + msg); };

  // ---- 存储失败:setItem 抛 QuotaExceededError ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => {
      Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
    });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(URL);
    check(await p.isHidden('#save-warning'), '空状态不显示未保存提示');
    await p.click('#load-sample');
    check(await p.isVisible('#save-warning'), '存储写入失败时显示持续可见的「未保存」提示');
    check((await p.textContent('#save-warning')).includes('未保存'), '未保存提示文案');
    check(!(await p.textContent('#flash')).includes('已载入合成示例'), '失败时不显示成功提示');
    if (errs.length) problems.push('存储失败场景 pageerror: ' + errs.join(';'));
    await ctx.close();
  }

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  const noOverflow = async label => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(`${label}: scrollWidth ${sw} <= innerWidth ${iw} → ${sw <= iw ? 'OK' : 'FAIL'}`);
    asserts++;
    if (sw > iw) problems.push(`${label} 横向溢出 ${sw} > ${iw}`);
  };

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  check(await page.isVisible('#empty-guide'), '空状态显示引导');
  check(await page.isDisabled('#btn-zip'), '空状态导出按钮禁用');
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

  // ---- 核心流程 ----
  await page.click('#load-sample');
  await page.waitForSelector('#check-panel .issues--bad');
  check((await page.textContent('#check-panel')).includes('第 12 行:有 10 列,表头有 9 列'), '列数不等带行号报错');
  check((await page.$$('#row-list tr')).length === 0, '数据有解析错误时不生成任何结果');
  check(await page.isDisabled('#btn-zip') && await page.isDisabled('#btn-merged') && await page.isDisabled('#btn-csv'), '数据有解析错误时三种导出都禁用');
  const dataBroken = await page.inputValue('#data');
  await page.fill('#data', dataBroken.replace(',多出来的一列', ''));
  await page.waitForSelector('#row-list tr');
  check((await page.$$('#row-list tr')).length === 12, '修正数据后输出清单 12 条');
  await page.fill('#data', dataBroken.replace('林小禾,林妈妈', '林小禾,"林妈妈'));
  check((await page.textContent('#check-panel')).includes('引号没有闭合') && await page.isDisabled('#btn-zip'), '引号未闭合报错并禁用导出');
  await page.fill('#data', dataBroken.replace(',多出来的一列', ''));
  await page.waitForSelector('#row-list tr');
  check((await page.textContent('#check-panel')).includes('未填占位符合计 3 处'), '未填合计 3 处');
  check((await page.textContent('#check-panel')).includes('电话'), '数据有、模板没用的字段:电话');
  check((await page.textContent('#preview')).includes('林妈妈您好'), '预览逐行渲染第 1 条');
  check((await page.textContent('#preview')).includes('周六 9:00'), '条件块为真时输出补课时间');
  await page.click('#next');
  check(!(await page.textContent('#preview')).includes('另外,'), '条件块为假时整段不输出(第 2 条)');
  check((await page.textContent('#pos')).trim() === '2 / 12', '左右切换位置 2 / 12');
  await page.click('#next-miss');
  check((await page.$$eval('#preview .miss', n => n.length)) >= 1, '未填占位符高亮');
  check((await page.textContent('#preview-status')).includes('未填'), '预览状态说明未填');
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png') });
  await noOverflow('桌面');

  // 模板用到而数据缺的字段
  const tplOriginal = await page.inputValue('#tpl');
  await page.fill('#tpl', tplOriginal + '\n联系人:{{联系方式}}');
  check((await page.textContent('#check-panel')).includes('联系方式'), '模板用到、数据缺的字段列出「联系方式」');
  // 未闭合
  await page.fill('#tpl', '你好 {{姓名\n第二行');
  check((await page.textContent('#check-panel')).includes('第 1 行'), '未闭合占位符带行号报错');
  check(await page.isDisabled('#btn-zip'), '模板有错时 zip 导出禁用');
  await page.fill('#tpl', tplOriginal);
  check(await page.isEnabled('#btn-zip'), '修正后 zip 导出恢复');

  // ---- 导出 ----
  await page.fill('#separator', '=====');
  let [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-merged')]);
  let text = fs.readFileSync(await dl.path(), 'utf8');
  check(text.includes('\n=====\n') && text.includes('林小禾') && text.includes('韩晓雯'), '合并文本含分隔线与全部条目 (' + dl.suggestedFilename() + ')');
  check(text.includes('沈嘉树'), '合并文本含修正后的第 11 条');

  [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-zip')]);
  const zp = path.join(tmp, 'out.zip');
  await dl.saveAs(zp);
  const py = 'import zipfile,sys,json;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps(sorted(z.namelist()),ensure_ascii=False))';
  const names = JSON.parse(execFileSync('python3', ['-I', '-c', py, zp], { encoding: 'utf8' }));
  check(names.length === 12 && names.includes('林小禾-通知.txt'), 'zip 校验通过,12 个文件,文件名模板生效');

  [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-csv')]);
  text = fs.readFileSync(await dl.path(), 'utf8');
  check(text.includes('渲染文本') && text.split('\r\n').length === 14, 'CSV 含「渲染文本」列,12 行 + 表头');

  [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-json')]);
  const backupPath = path.join(tmp, 'backup.json');
  await dl.saveAs(backupPath);
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  check(backup.version === 1 && backup.template.includes('{{#if 补课时间}}'), '备份 JSON 含模板与数据');

  // ---- 导入:先拒绝,再接受 ----
  await page.fill('#tpl', '改过的模板 {{姓名}}');
  fs.writeFileSync(path.join(tmp, 'bad.json'), JSON.stringify({ version: 1, template: 5, data: '' }));
  await page.setInputFiles('#import-file', path.join(tmp, 'bad.json'));
  await page.waitForFunction(() => document.getElementById('import-msg').textContent.includes('拒绝'));
  check((await page.inputValue('#tpl')) === '改过的模板 {{姓名}}', '非法备份整份拒绝,当前内容不变');
  await page.setInputFiles('#import-file', backupPath);
  await page.waitForSelector('#import-confirm:not([hidden])');
  const impText = await page.textContent('#import-scope');
  check(impText.includes('数据 12 行') && impText.includes('替换你现有的') && (await page.inputValue('#tpl')) === '改过的模板 {{姓名}}', '合法备份先预览模板字数与数据行数,确认前内容不变');
  await page.click('#btn-import-no');
  check((await page.inputValue('#tpl')) === '改过的模板 {{姓名}}' && await page.isHidden('#import-confirm'), '取消导入后内容不变');
  await page.setInputFiles('#import-file', backupPath);
  await page.waitForSelector('#import-confirm:not([hidden])');
  await page.click('#btn-import-yes');
  await page.waitForFunction(() => document.getElementById('import-msg').textContent.includes('已导入'));
  check((await page.inputValue('#tpl')).includes('{{#if 补课时间}}'), '合法备份导入后恢复模板');

  await page.evaluate(() => document.getElementById('row-list').scrollIntoView());
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png') });

  // ---- 刷新后内容仍在(保存与读取共用校验) ----
  const saved = await page.inputValue('#tpl');
  await page.fill('#tpl', saved + '\n补一行 {{半成品');
  await page.reload();
  check((await page.inputValue('#tpl')).endsWith('补一行 {{半成品'), 'reload 后含语法错误的半成品模板仍在');
  await page.fill('#tpl', saved);
  // ---- 超长内容:保存前拒绝,保留原模板 ----
  await page.fill('#tpl', 'x'.repeat(200001));
  check(await page.isVisible('#save-warning') && (await page.textContent('#save-warning-text')).includes('template 超过 200000'), '超过上限时保存前拒绝并提示');
  await page.reload();
  check((await page.inputValue('#tpl')) === saved, '超限后刷新,保留上次保存的模板');
  check(await page.isHidden('#save-warning'), '刷新后未保存提示消失');
  // ---- 载入示例前的替换确认 ----
  await page.fill('#tpl', '我的模板 {{姓名}}');
  await page.click('#load-sample');
  check(await page.isVisible('#sample-confirm'), '已有内容时载入示例先出现页内确认区');
  check((await page.inputValue('#tpl')) === '我的模板 {{姓名}}', '确认前模板保持原状');
  await page.click('#btn-sample-no');
  check((await page.inputValue('#tpl')) === '我的模板 {{姓名}}' && await page.isHidden('#sample-confirm'), '取消后内容不变');
  await page.reload();
  check((await page.inputValue('#tpl')) === '我的模板 {{姓名}}', '取消后存储也不变');
  await page.click('#load-sample');
  await page.click('#btn-sample-yes');
  check((await page.inputValue('#tpl')).includes('{{#if 补课时间}}'), '确认后才替换为示例');

  // ---- 清空确认 ----
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('#btn-clear');
  check(await page.isVisible('#clear-confirm'), '清空前出现页内确认区');
  await page.click('#btn-clear-yes');
  check(await page.isVisible('#empty-guide'), '清空后回到空状态');
  await page.click('#load-sample');
  await page.fill('#data', dataBroken.replace(',多出来的一列', ''));

  // ---- 第五轮新增断言 ----
  const p6 = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  p6.on('console', m => { if (m.type() === 'error') problems.push('console(p6): ' + m.text()); });
  p6.on('pageerror', e => problems.push('pageerror(p6): ' + e.message));
  await p6.goto(URL);
  await p6.evaluate(() => localStorage.clear());
  await p6.reload();
  check(await p6.isVisible('#btn-import') && await p6.isVisible('#btn-import-2'), '空状态下「导入 JSON 备份」入口可见');
  check(await p6.isHidden('#sample-badge'), '空状态没有合成示例标记');
  await p6.click('#load-sample');
  check(await p6.isVisible('#sample-badge'), '载入示例后持续显示「合成示例」标记');
  const noteText = await p6.textContent('#check-panel');
  check(noteText.includes('这是示例里预设的错误') && noteText.includes('第 12 行'), '报错旁明确说明「这是预设错误」并指出第 12 行');
  check(await p6.isVisible('#btn-locate') && await p6.isVisible('#btn-fix-cols'), '提供「定位」和「移除多出的末尾列并继续」两个操作');
  check(await p6.isVisible('#err-data') && (await p6.textContent('#err-data')).includes('第 12 行') && await p6.getAttribute('#data', 'aria-describedby') === 'err-data', '数据错误同时显示在数据输入框下方并关联');
  await p6.click('#btn-locate');
  const sel = await p6.evaluate(() => { const t = document.getElementById('data'); return [document.activeElement.id, t.value.slice(t.selectionStart, t.selectionEnd)]; });
  check(sel[0] === 'data' && sel[1].startsWith('沈嘉树') && !sel[1].includes('\n'), '「定位」把光标选中数据第 12 行');
  await p6.click('#btn-fix-cols');
  await p6.waitForSelector('#row-list tr');
  check((await p6.$$('#row-list tr')).length === 12 && await p6.isEnabled('#btn-zip'), '移除多余列后输出清单 12 条,导出恢复');
  check(await p6.isVisible('#sample-badge') && (await p6.textContent('#check-panel')).includes('没有发现错误'), '修复后仍是合成示例,检查通过');
  await p6.reload();
  check(await p6.isVisible('#sample-badge'), '刷新后示例标记仍在');
  const dl6 = async sel2 => { const [d] = await Promise.all([p6.waitForEvent('download'), p6.click(sel2)]); const pth = path.join(tmp, 'p6-' + d.suggestedFilename()); await d.saveAs(pth); return [d.suggestedFilename(), pth]; };
  const [zn] = await dl6('#btn-zip');
  const [mn] = await dl6('#btn-merged');
  check(zn.startsWith('合成示例-') && mn.startsWith('合成示例-'), 'ZIP 与合并文本的文件名带「合成示例」前缀');
  const [, cp] = await dl6('#btn-csv');
  const csvLines = fs.readFileSync(cp, 'utf8').replace(/^﻿/, '').split('\r\n');
  check(csvLines[0].endsWith(',数据来源') && csvLines[1].endsWith(',合成示例'), '渲染结果 CSV 带「数据来源=合成示例」');
  const [, jp] = await dl6('#btn-json');
  check(JSON.parse(fs.readFileSync(jp, 'utf8')).sample === true, 'JSON 备份带 sample:true');
  // 文件名模板纳入检查
  await p6.fill('#file-pattern', '{{学号}}-通知.txt');
  check(await p6.isDisabled('#btn-zip') && await p6.isEnabled('#btn-merged') && await p6.isEnabled('#btn-csv'), '文件名模板用了数据里没有的字段时只禁用 ZIP');
  check(await p6.isVisible('#err-file-pattern') && (await p6.textContent('#err-file-pattern')).includes('学号') && await p6.getAttribute('#file-pattern', 'aria-describedby') === 'err-file-pattern', '错误显示在文件名输入框下方并关联');
  check((await p6.textContent('#check-panel')).includes('检查未完成') && !(await p6.textContent('#check-panel')).includes('都没有发现错误'), '文件名模板有错时检查结论是「检查未完成」');
  await p6.fill('#file-pattern', '{{姓名-通知.txt');
  check(await p6.isDisabled('#btn-zip') && (await p6.textContent('#err-file-pattern')).includes('未闭合'), '文件名模板占位符未闭合:报错并禁用 ZIP');
  await p6.fill('#file-pattern', '{{家长称呼}}-通知.txt');
  check(await p6.isEnabled('#btn-zip') && (await p6.textContent('#export-hint')).includes('文件名字段为空'), '逐条空字段只提示不拦截');
  check((await p6.textContent('#row-list')).includes('家长称呼 为空'), '输出清单逐条标出文件名里的空字段');
  await p6.fill('#file-pattern', '{{姓名}}-通知.txt');
  // 焦点保持
  await p6.click('#jump-3');
  check(await p6.evaluate(() => document.activeElement.id) === 'jump-3', '点清单条目重绘后焦点仍在该条目');
  // 只自定义了文件名 / 分隔线也要确认
  await p6.click('#btn-clear'); await p6.click('#btn-clear-yes');
  await p6.fill('#file-pattern', 'x-{{姓名}}.txt');
  await p6.click('#load-sample');
  check(await p6.isVisible('#sample-confirm') && (await p6.textContent('#sample-scope')).includes('文件名模板「x-{{姓名}}.txt」'), '仅自定义文件名模板时载入示例也先确认,并列出该项');
  await p6.click('#btn-sample-no');
  check(await p6.inputValue('#file-pattern') === 'x-{{姓名}}.txt', '取消后文件名模板保持');
  await p6.fill('#file-pattern', '{{姓名}}-通知.txt');
  await p6.fill('#separator', '=====');
  await p6.click('#load-sample');
  check(await p6.isVisible('#sample-confirm') && (await p6.textContent('#sample-scope')).includes('分隔线「=====」'), '仅自定义分隔线时载入示例也先确认');
  await p6.click('#btn-sample-yes');
  check(await p6.inputValue('#separator') === '----------', '确认后分隔线恢复默认');
  // 手机端按钮高度
  await p6.setViewportSize({ width: 390, height: 844 });
  await p6.waitForTimeout(150);
  const hs = await p6.evaluate(() => [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null && !b.disabled).map(b => b.getBoundingClientRect().height));
  check(hs.length > 5 && hs.every(h => h >= 36), '手机端可点按钮高度 >= 36px');
  await p6.close();

  // ---- 手机 ----
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  await noOverflow('手机');
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
  await page.close();

  // ---- 展示图 ----
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  show.on('pageerror', e => problems.push('showcase pageerror: ' + e.message));
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(300);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();

  console.log('断言总数:' + asserts);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
