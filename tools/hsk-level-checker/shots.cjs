'use strict';
// 真实操作界面并截图:载入示例 → 检查 → 定位超纲词 → 改写 → 重新检查 → 导出 → 清空。
// 任何断言失败、console error、pageerror 都以非零退出。
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;

const REWRITE =
  '周末我常常和朋友琪琪去公园锻炼。运动可以让人不累，也能让工作更快。' +
  '我们每天坚持半小时，慢慢有了好习惯。' +
  '公园里很轻松，大家一边走路一边聊天，也越来越好。' +
  '下次我想找一个老师，认真学习新的运动。';

const problems = [];
const checks = [];
function assert(cond, msg) {
  if (!cond) problems.push('断言失败:' + msg);
  else checks.push('通过:' + msg);
}
function watch(page, tag) {
  page.on('console', (m) => { if (m.type() === 'error') problems.push(tag + ' console error: ' + m.text()); });
  page.on('pageerror', (e) => problems.push(tag + ' pageerror: ' + e.message));
}
const url = 'file://' + encodeURI(path.join(__dirname, 'index.html')) + '?today=2026-10-20';
const shot = (page, name, opts) => page.screenshot(Object.assign({ path: path.join(__dirname, 'screenshots', name) }, opts || {}));
async function noOverflow(page, label) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert(r.sw <= r.iw, label + ' scrollWidth(' + r.sw + ') <= innerWidth(' + r.iw + ')');
}
async function readDownload(dl) {
  const p = await dl.path();
  return { name: dl.suggestedFilename(), text: fs.readFileSync(p, 'utf8') };
}

(async () => {
  fs.mkdirSync(path.join(__dirname, 'screenshots'), { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });

  // ---------- 桌面 ----------
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page, '桌面');
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  assert(await page.locator('#empty').isVisible(), '空状态可见');
  assert(await page.locator('#result').isHidden(), '空状态下结果区隐藏');
  await shot(page, '01-空状态-桌面.png');
  await noOverflow(page, '桌面(空状态)');

  // 空输入点检查要有提示
  await page.click('#btn-check');
  assert((await page.locator('#src-status').innerText()).includes('请先贴入'), '空输入点「检查」给出提示');
  assert((await page.locator('#src').getAttribute('aria-invalid')) === 'true', '空输入时原文框标记为出错(aria-invalid)');
  assert((await page.evaluate(() => document.activeElement.id)) === 'src', '空输入时焦点回到原文框');
  assert((await page.locator('#src').getAttribute('aria-describedby')) === 'src-status', '原文框用 aria-describedby 关联错误提示');
  assert(await page.locator('#today-note').isVisible() && (await page.locator('#today-note').innerText()).includes('基准日 2026-10-20(由地址参数固定)'), '固定日期生效时页面持续显示基准日');

  await page.click('#btn-sample');
  await page.waitForSelector('#result:not([hidden])');
  const overBefore = await page.locator('#over-body tr').count();
  assert(overBefore === 11, '示例原文在 HSK 3 下有 11 个不同超纲词(实际 ' + overBefore + ')');
  assert((await page.locator('.tk-over2, .tk-over3').count()) > 0, '正文里有高出 2 级以上的着色');
  assert((await page.locator('.tk-out').count()) === 2, '词表外汉字「琪琪」被标记(2 个字)');
  assert((await page.locator('#out-list li').innerText()).includes('琪琪'), '词表外清单含「琪琪」');
  assert((await page.locator('#rew').inputValue()).startsWith('周末我常常'), '改写区初始为原文副本');
  assert(await page.locator('#sample-badge').isVisible(), '载入示例后数据区持续显示「合成示例」标记');
  assert((await page.locator('#stats-note').count()) === 1 && (await page.locator('#stats-note').innerText()).includes('统计口径'), '统计旁有口径说明');
  await page.locator('#stats-note summary').click();
  assert((await page.locator('#stats-note').innerText()).includes('目标级内词占比 = 目标级内词数 ÷ 词数'), '口径说明写出占比公式');
  assert((await page.locator('#stats-note').innerText()).includes('按出现次数累计'), '口径说明写明超纲词数按出现次数累计');
  // 首次改写后未重新检查:导出禁用并持续提示
  await page.fill('#rew', REWRITE);
  assert((await page.locator('#btn-md').getAttribute('aria-disabled')) === 'true' && (await page.locator('#btn-csv').getAttribute('aria-disabled')) === 'true', '首次改写后未重新检查:两个导出按钮禁用');
  assert((await page.locator('#export-status').innerText()).includes('请先点'), '首次改写后未重新检查:持续显示原因');
  await page.click('#btn-md', { force: true });
  assert((await page.locator('#export-preview').isHidden()), '首次改写后未重新检查:点导出不产生预览');

  // 点超纲词定位
  await page.locator('#over-body .word-btn', { hasText: '氛围' }).click();
  assert((await page.locator('.tk.is-focus').count()) === 1, '点清单里的「氛围」后正文中高亮 1 处');
  assert((await page.locator('.tk.is-focus').innerText()) === '氛围', '高亮的是「氛围」');

  // 改写并重新检查
  await page.fill('#rew', REWRITE);
  await page.click('#btn-recheck');
  await page.waitForSelector('#compare:not([hidden])');
  const cmp = await page.locator('#compare-grid').innerText();
  assert(/11\s*→\s*1/.test(cmp), '对比条显示超纲词数 11 → 1(实际:' + cmp.replace(/\s+/g, ' ') + ')');
  assert(cmp.includes('减少 10 个'), '对比条显示减少 10 个');
  assert((await page.locator('#view-after').getAttribute('aria-pressed')) === 'true', '重新检查后切到改写后视图');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, '02-核心流程-桌面.png');

  // 切回原文再切回改写后
  await page.click('#view-before');
  assert((await page.locator('#over-body tr').count()) === 11, '切回原文视图,超纲词清单恢复 11 项');
  await page.click('#view-after');

  // 导出
  const [dlMd] = await Promise.all([page.waitForEvent('download'), page.click('#btn-md')]);
  const md = await readDownload(dlMd);
  assert(md.name.endsWith('.md') && md.name.includes('2026-10-20'), 'Markdown 文件名带日期(' + md.name + ')');
  assert(md.text.includes('### 改写前') && md.text.includes('### 改写后') && md.text.includes('## 改写后全文'), 'Markdown 含两版统计与改写后全文');
  assert(md.text.includes('认真学习新的运动'), 'Markdown 含改写后全文内容');
  const [dlCsv] = await Promise.all([page.waitForEvent('download'), page.click('#btn-csv')]);
  const csv = await readDownload(dlCsv);
  assert(csv.name.endsWith('.csv'), 'CSV 文件名(' + csv.name + ')');
  assert(csv.text.replace(/^﻿/, '').startsWith('词,级别,拼音,出现次数'), 'CSV 表头正确');
  await page.locator('#export-preview').scrollIntoViewIfNeeded();
  await shot(page, '03-结果与导出-桌面.png');
  await noOverflow(page, '桌面(结果与导出)');

  // P0:改写文改动后未重新检查,导出必须被拒绝,不能拼出旧统计 + 新全文
  await page.fill('#rew', REWRITE + '氛围');
  await page.click('#btn-md', { force: true });
  assert((await page.locator('#export-status').innerText()).includes('请先点'), '改写文改动未重新检查时导出被拒绝并提示');
  assert(await page.locator('#export-status.is-error').count() === 1, '拒绝提示以错误样式显示');
  await page.click('#btn-recheck');
  await page.click('#btn-md');
  assert(!(await page.locator('#export-status').innerText()).includes('请先点'), '重新检查后可以导出');
  assert((await page.locator('#export-text').inputValue()).includes('| 氛围 | HSK 6 |'), '导出的超纲词表包含新增的「氛围」');
  await page.fill('#rew', REWRITE);
  await page.click('#btn-recheck');

  // 刷新后恢复
  await page.reload();
  assert((await page.locator('#rew').inputValue()) === REWRITE, '刷新后改写文从 localStorage 恢复');
  assert(await page.locator('#compare').isVisible(), '刷新后对比条恢复');

  // 改目标级别会重算
  await page.selectOption('#target', '5');
  const over5 = await page.locator('#stats .stat').nth(3).locator('dd').innerText();
  assert(over5 === '0', 'HSK 5 下改写文超纲词数为 0(实际 ' + over5 + ')');
  await page.selectOption('#target', '3');

  // P0:存储写入失败时,持续显示「未保存」提示,且不被「已完成」类提示覆盖
  await page.evaluate(() => {
    window.__origSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); };
  });
  await page.fill('#src', (await page.locator('#src').inputValue()) + '。');
  assert(await page.locator('#save-warning').isVisible(), '存储写入失败时出现「未保存」提示');
  await page.click('#btn-check');
  await page.click('#btn-recheck');
  assert(await page.locator('#save-warning').isVisible(), '检查/重新检查后「未保存」提示仍然可见');
  assert((await page.locator('#save-warning').innerText()).includes('导出'), '提示引导用户导出');
  await page.evaluate(() => { Storage.prototype.setItem = window.__origSet; });
  await page.fill('#src', (await page.locator('#src').inputValue()) + '。');
  assert(await page.locator('#save-warning').isHidden(), '存储恢复后提示收起');

  // 载入示例前的替换确认 + 示例标记
  await page.fill('#src', '自己的材料。');
  assert(await page.locator('#sample-badge').isHidden(), '原文改动后示例标记消失');
  await page.click('#btn-sample');
  assert(await page.locator('#sample-confirm').isVisible(), '已有用户数据时点「载入示例」先出现页内替换确认');
  assert((await page.locator('#sample-confirm-text').innerText()).includes('替换'), '确认文案写明替换范围');
  assert((await page.locator('#src').inputValue()) === '自己的材料。', '确认前原文保持不变');
  await page.click('#btn-sample-no');
  assert((await page.locator('#src').inputValue()) === '自己的材料。' && (await page.locator('#sample-confirm').isHidden()), '取消后原文仍在');
  await page.click('#btn-sample');
  await page.click('#btn-sample-yes');
  assert((await page.locator('#src').inputValue()).startsWith('周末我常常'), '确认后载入示例');
  await page.reload();
  assert(await page.locator('#sample-badge').isVisible(), '刷新后「合成示例」标记仍在');
  const [dlS] = await Promise.all([page.waitForEvent('download'), page.click('#btn-md')]);
  const sMd = await readDownload(dlS);
  assert(sMd.text.includes('数据来源:合成示例') && sMd.name.includes('合成示例'), '示例的 Markdown 导出文件内与文件名标注合成示例');
  const [dlS2] = await Promise.all([page.waitForEvent('download'), page.click('#btn-csv')]);
  const sCsv = await readDownload(dlS2);
  assert(sCsv.text.includes('数据来源') && sCsv.text.includes('合成示例'), '示例的 CSV 导出含「数据来源」列');

  // 清空:页内确认
  await page.click('#btn-clear');
  assert(await page.locator('#clear-confirm').isVisible(), '点「清空数据」出现页内确认区');
  await page.click('#btn-clear-no');
  assert((await page.locator('#src').inputValue()).length > 0, '取消后数据仍在');
  await page.click('#btn-clear');
  await page.click('#btn-clear-yes');
  assert((await page.locator('#src').inputValue()) === '' && (await page.locator('#empty').isVisible()), '确认清空后回到空状态');
  const stored = await page.evaluate(() => localStorage.getItem('hskcheck.v1'));
  assert(stored === null, '清空后 localStorage 键已删除');

  // XSS:输入 HTML 必须当文本
  await page.fill('#src', '<img src=x onerror="window.__xss=1">学生<script>window.__xss=2</script>');
  await page.click('#btn-check');
  assert((await page.evaluate(() => window.__xss)) === undefined, '输入的 HTML 没有被执行');
  assert((await page.locator('#colored img').count()) === 0, '输入的 HTML 没有变成元素');
  // 非法的 ?today 回退真实今天且不显示基准日
  const bad = await ctx.newPage();
  watch(bad, '桌面(非法today)');
  await bad.goto('file://' + encodeURI(path.join(__dirname, 'index.html')) + '?today=2026-02-30');
  assert(await bad.locator('#today-note').isHidden(), '?today=2026-02-30 被拒绝,不显示基准日');
  await bad.close();
  await ctx.close();

  // ---------- 手机 ----------
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true });
  const mp = await mctx.newPage();
  watch(mp, '手机');
  await mp.goto(url);
  await mp.evaluate(() => localStorage.clear());
  await mp.reload();
  await noOverflow(mp, '手机(空状态)');
  await mp.click('#btn-sample');
  await mp.waitForSelector('#result:not([hidden])');
  await mp.fill('#rew', REWRITE);
  await mp.click('#btn-recheck');
  await mp.waitForSelector('#compare:not([hidden])');
  await mp.click('#btn-md');
  await mp.waitForSelector('#export-preview:not([hidden])');
  await noOverflow(mp, '手机(结果与导出)');
  const smallBtns = await mp.evaluate(() => Array.from(document.querySelectorAll('button')).filter((b) => b.offsetParent && b.getBoundingClientRect().height < 36).map((b) => b.id || b.textContent));
  assert(smallBtns.length === 0, '手机端可见按钮高度均 >= 36px(不足:' + smallBtns.join(',') + ')');
  await shot(mp, '04-手机.png', { fullPage: true });
  await mctx.close();

  // ---------- 展示图 ----------
  const sctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const sp = await sctx.newPage();
  watch(sp, '展示页');
  await sp.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await sp.waitForLoadState('load');
  const broken = await sp.evaluate(() => Array.from(document.images).filter((i) => !i.complete || i.naturalWidth === 0).length);
  assert(broken === 0, '展示页内嵌截图全部加载');
  await sp.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await sctx.close();
  await browser.close();

  checks.forEach((c) => console.log(c));
  if (problems.length) {
    console.error('\n失败项:');
    problems.forEach((p) => console.error(' - ' + p));
    process.exit(1);
  }
  console.log('\n全部通过(' + checks.length + ' 项断言,0 条 console error / pageerror)。');
})().catch((e) => { console.error(e); process.exit(2); });
