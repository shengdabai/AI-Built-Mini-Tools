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
  const check = (cond, msg) => { asserts++; if (!cond) problems.push('断言失败:' + msg); };
  const watch = (page, tag) => {
    page.on('console', m => { if (m.type() === 'error') problems.push(tag + ' console: ' + m.text()); });
    page.on('pageerror', e => problems.push(tag + ' pageerror: ' + e.message));
  };

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true, timezoneId: 'Asia/Shanghai' });
  const page = await ctx.newPage();
  watch(page, '桌面');
  const noOverflow = async (p, label) => {
    const [sw, iw] = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(`${label}: scrollWidth ${sw} <= innerWidth ${iw} → ${sw <= iw ? 'OK' : 'FAIL'}`);
    check(sw <= iw, `${label} 横向溢出 ${sw} > ${iw}`);
  };
  const loadSample = async (p, sel) => { await p.click(sel); if (await p.isVisible('#sample-confirm')) await p.click('#btn-sample-yes'); };
  const readDownload = async dl => fs.readFileSync(await dl.path(), 'utf8');

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  check(await page.isVisible('#empty-guide'), '空状态引导可见');
  check(await page.isDisabled('#btn-export-csv'), '无结果时 CSV 导出禁用');
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

  // 核心流程:载入示例 → 对比 → 结果
  await page.click('#btn-sample');
  check(await page.isHidden('#sample-confirm'), '空白状态载入示例不需要确认');
  check(await page.isVisible('#sample-badge'), '载入示例后持续显示合成示例标记');
  check(await page.inputValue('#old-text') !== '', '载入示例后旧版文本非空');
  await page.click('#btn-compare');
  await page.waitForSelector('#diff-body tr');
  check(await page.locator('.row-added').count() === 2, '新增 2 行');
  check(await page.locator('.row-removed').count() === 1, '删除 1 行');
  check(await page.locator('.row-changed').count() === 5, '调整 5 行(3 数量 + 1 单价 + 1 单位)');
  check(await page.locator('.row-note').count() === 1, '仅改名 1 行');
  const totalsText = await page.textContent('#totals');
  check(totalsText.includes('+¥8,466'), '差额 +¥8,466:' + totalsText);
  check(await page.isEnabled('#btn-export-csv'), '对比后 CSV 导出可用');
  await page.evaluate(() => document.getElementById('result').scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png') });
  await noOverflow(page, '桌面');

  // P0:已有输入时,示例按钮先要求页内确认,确认前保留原状态
  const marker = '项目编码,项目名称,数量,单位,单价,备注\nZ1,我的草稿,1,项,1,';
  await page.fill('#old-text', marker);
  await page.evaluate(() => { const i = document.getElementById('rec-name'); i.value = '我的版本名'; i.dispatchEvent(new Event('input')); });
  await page.click('#btn-sample');
  check(await page.isVisible('#sample-confirm'), '已有输入时出现替换确认区');
  check(await page.inputValue('#old-text') === marker, '确认前旧版草稿不变');
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('quotediff.v1')).draft.versionName === '我的版本名' && document.getElementById('rec-name').value === '我的版本名'), '确认前版本名不变');
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('quotediff.v1')).draft.oldText.includes('Z1')), '确认前已保存的草稿不变');
  await page.click('#btn-sample-no');
  check(await page.isHidden('#sample-confirm') && await page.inputValue('#old-text') === marker, '取消后保持原状');
  await page.click('#btn-sample-error');
  check(await page.isVisible('#sample-confirm') && await page.inputValue('#old-text') === marker, '错误示例同样先确认');
  await page.click('#btn-sample-no');
  await page.click('#btn-sample');
  await page.click('#btn-sample-yes');
  check((await page.inputValue('#old-text')).includes('A01') && await page.isHidden('#sample-confirm'), '确认后才替换为示例');
  await page.click('#btn-compare');

  // P1:引号未闭合整份拒绝
  await page.fill('#old-text', '项目编码,项目名称,数量,单位,单价,备注\nA1,甲,1,项,"2\nA2,乙,1,项,5,');
  await page.click('#btn-compare');
  check((await page.textContent('#errors-box')).includes('引号未闭合') && await page.isHidden('#result'), '引号未闭合被拒绝');
  await page.click('#btn-sample-error'); await page.click('#btn-sample-yes');
  await page.click('#btn-sample'); await page.click('#btn-sample-yes');
  await page.click('#btn-compare');

  // 输入改动后结果过期:导出禁用
  await page.fill('#new-text', (await page.inputValue('#new-text')) + '\nB03,临时项,1,项,100,');
  check(await page.isDisabled('#btn-export-csv'), '输入改动后 CSV 导出禁用');
  check((await page.textContent('#stale-note')).includes('过期'), '显示过期提示');
  await page.click('[data-view="explain"]');
  check(await page.isDisabled('#btn-export-md'), '过期时 Markdown 导出禁用');
  check(await page.isVisible('#explain-stale'), '说明页显示过期提示');
  await page.click('[data-view="compare"]');
  await loadSample(page, '#btn-sample');
  await page.click('#btn-compare');
  check(await page.isEnabled('#btn-export-csv'), '重新对比后导出恢复');

  // CSV 下载
  let [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export-csv')]);
  const csv = await readDownload(dl);
  console.log('下载文件名:', dl.suggestedFilename());
  check(dl.suggestedFilename() === '合成示例-报价差异表.csv' && csv.includes('合成示例数据,不是真实报价'), '示例数据导出的文件名与内容带合成示例标注');
  check(csv.includes('合计,,,,') && csv.includes('地砖铺贴') && csv.includes('1800'), 'CSV 内容');

  // 变更说明
  await page.click('[data-view="explain"]');
  const md = await page.inputValue('#explain-text');
  check(md.includes('- 地砖铺贴:数量 80 → 95 ㎡,单价不变,增加 ¥1,800'), '示例句:' + md.slice(0, 120));
  check(md.includes('仅改名称'), '默认含仅改名项');
  await page.check('#only-amount');
  const md2 = await page.inputValue('#explain-text');
  check(!md2.includes('仅改名称') && !md2.includes('延米'), '只列影响金额的项过滤');
  await page.uncheck('#only-amount');
  await page.fill('#explain-text', (await page.inputValue('#explain-text')) + '\n补充:以上以客户确认为准。\n');
  [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export-md')]);
  const mdFile = await readDownload(dl);
  check(mdFile.includes('补充:以上以客户确认为准。'), '导出的 Markdown 含手动编辑');
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png') });

  // 确认记录
  await page.click('[data-view="records"]');
  await page.fill('#rec-name', '装修报价 V2');
  await page.check('#rec-confirmed');
  check(await page.inputValue('#rec-date') === '2026-10-20', '确认日期默认 ?today');
  await page.fill('#rec-note', '客户电话确认');
  await page.click('#record-form button[type=submit]');
  check(await page.locator('.chain__item').count() === 1, '保存 1 条记录');
  await page.uncheck('#rec-confirmed');
  await page.fill('#rec-name', '装修报价 V3');
  await page.click('#record-form button[type=submit]');
  check(await page.locator('.chain__item').count() === 2, '保存第 2 条记录');
  const chainText = await page.textContent('#chain');
  check(chainText.includes('已向客户确认:2026-10-20') && chainText.includes('尚未向客户确认'), '确认状态展示');
  await page.click('.chain__item--pending button:has-text("标记已向客户确认")');
  check(await page.locator('.chain__item--confirmed').count() === 2, '标记确认后两条均已确认');
  // 重新加载后保留
  await page.reload();
  await page.click('[data-view="records"]');
  check(await page.locator('.chain__item').count() === 2, '刷新后记录仍在');
  check(await page.inputValue('#old-text') !== '', '刷新后输入草稿仍在');
  check(await page.isDisabled('#btn-export-csv'), '刷新后未对比,导出禁用');
  check(await page.isVisible('#sample-badge'), '刷新后合成示例标记仍在');
  const chainNow = await page.textContent('#chain');
  check(/保存于 2026-10-20 \d{2}:\d{2}\(UTC\+08:00;日期由地址参数固定,为模拟日期\)/.test(chainNow), '记录保存时间带时区偏移,并标注 ?today 模拟日期:' + chainNow.slice(0, 120));
  await page.click('[data-view="explain"]');
  check((await page.inputValue('#explain-text')).includes('补充:以上以客户确认为准。'), '刷新后手动编辑的说明草稿仍在');
  check(await page.isVisible('#explain-saved-only') && await page.isDisabled('#btn-export-md'), '刷新后说明草稿标为「尚未对应最新对比」,导出禁用');
  check((await page.textContent('#explain-status')).includes('已自动保存'), '编辑区显示说明草稿的保存状态');
  await page.click('[data-view="compare"]');
  await page.click('#btn-compare');
  await page.click('[data-view="explain"]');
  check(await page.isVisible('#explain-kept') && (await page.inputValue('#explain-text')).includes('补充:以上以客户确认为准。'), '重新对比不悄悄覆盖手动编辑,并提示可重新生成');
  await page.click('[data-view="records"]');
  check((await page.textContent('#base-date')).includes('业务基准日:2026-10-20(由地址参数固定)'), '确认记录表单旁持续显示业务基准日');

  // JSON 备份 + 非法导入被拒绝 + 合法导入
  [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export-json')]);
  const backupText = await readDownload(dl);
  const backup = JSON.parse(backupText);
  check(backup.records.length === 2 && backup.app === 'quote-diff', 'JSON 备份内容');
  check(backup.draft.explainText.includes('补充:以上以客户确认为准。') && backup.draft.explainEdited === true, 'JSON 备份包含手动编辑的说明草稿');
  check(backup.records.every((x) => /[+-]\d{2}:\d{2}$/.test(x.createdAt) && x.simulated === true), '备份里的 createdAt 带时区偏移并记录 simulated');
  const bad = JSON.parse(backupText); bad.records[1].id = bad.records[0].id;
  await page.setInputFiles('#file-import-json', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
  await page.waitForSelector('#import-error:not([hidden])');
  check((await page.textContent('#import-error')).includes('重复'), '重复 id 被拒绝并说明原因');
  check(await page.locator('.chain__item').count() === 2, '拒绝后现有记录未变');
  await page.setInputFiles('#file-import-json', { name: 'bad2.json', mimeType: 'application/json', buffer: Buffer.from('{not json') });
  await page.waitForFunction(() => document.getElementById('import-error').textContent.includes('不是有效的 JSON'));
  const good = JSON.parse(backupText); good.records.pop();
  await page.setInputFiles('#file-import-json', { name: 'good.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(good)) });
  await page.waitForSelector('#import-confirm:not([hidden])');
  const impText = await page.textContent('#import-summary');
  check(/现有 2 条确认记录.*备份文件 1 条.*草稿/.test(impText), '导入前预览记录数与草稿替换范围:' + impText);
  check(await page.locator('.chain__item').count() === 2, '确认前现有记录不变');
  await page.click('#btn-import-no');
  check(await page.isHidden('#import-confirm') && await page.locator('.chain__item').count() === 2, '取消导入后现有记录不变');
  await page.setInputFiles('#file-import-json', { name: 'good.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(good)) });
  await page.waitForSelector('#import-confirm:not([hidden])');
  await page.click('#btn-import-yes');
  await page.waitForFunction(() => document.querySelectorAll('.chain__item').length === 1);
  check(await page.isHidden('#import-error'), '合法导入后错误提示收起');

  // 删除记录(页内确认)
  await page.click('.chain__item button:has-text("删除")');
  check(await page.isVisible('#delete-confirm'), '删除前出现页内确认区');
  await page.click('#btn-del-yes');
  check(await page.locator('.chain__item').count() === 0, '确认后删除');

  // 错误示例:重复编码阻止计算
  await page.click('[data-view="compare"]');
  await loadSample(page, '#btn-sample-error');
  await page.click('#btn-compare');
  const errText = await page.textContent('#errors-box');
  check(/新版第 17 行.*A03.*重复.*第 4 行/.test(errText), '重复编码报行号:' + errText);
  check(await page.isHidden('#result'), '重复编码时不显示结果');
  check(await page.isDisabled('#btn-export-csv'), '重复编码时导出禁用');

  // 清空(页内确认)
  await page.click('#btn-clear');
  check(await page.isVisible('#clear-confirm'), '清空前出现页内确认区');
  await page.click('#btn-clear-yes');
  check(await page.inputValue('#old-text') === '', '清空后输入为空');
  check(await page.isVisible('#empty-guide') && await page.isHidden('#sample-badge'), '清空后回到空状态且合成示例标记消失');

  // 手机
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('#btn-sample');
  await page.click('#btn-compare');
  await page.waitForSelector('#diff-body tr');
  await noOverflow(page, '手机');
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
  await page.close();
  await ctx.close();

  // 存储失败:持续可见的「未保存」提示
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx2.addInitScript(() => {
    Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
  });
  const p2 = await ctx2.newPage();
  watch(p2, '存储失败');
  await p2.goto(URL);
  check(await p2.isHidden('#save-warning'), '未写入前无未保存提示');
  await p2.click('#btn-sample');
  check(await p2.isVisible('#save-warning'), '写入失败时显示未保存提示');
  check(await p2.isHidden('#flash') || !(await p2.textContent('#flash')).includes('已载入示例'), '失败时不显示成功提示');
  await p2.click('#btn-compare');
  await p2.waitForTimeout(300);
  check(await p2.isVisible('#save-warning'), '提示持续可见');
  await p2.click('[data-view="explain"]');
  await p2.fill('#explain-text', '失败场景下的说明草稿');
  check((await p2.textContent('#explain-status')).includes('未保存'), '存储失败时编辑区显示说明草稿未保存');
  const [dlf] = await Promise.all([p2.waitForEvent('download'), p2.click('#btn-save-warning-export')]);
  check(JSON.parse(await readDownload(dlf)).draft.explainText === '失败场景下的说明草稿', '存储失败时备份按钮导出当前内存里的说明草稿');
  await p2.close(); await ctx2.close();

  // 展示图
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  watch(show, '展示页');
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(300);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();

  console.log(`断言 ${asserts} 条`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
