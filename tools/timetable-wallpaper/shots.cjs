/*
 * 截图与冒烟脚本：真实驱动界面，任何 console error / pageerror / 横向溢出都以非零码退出。
 * 用法：node shots.cjs
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const EXE = process.env.CHROME_PATH || undefined;
const ROOT = __dirname;
const OUT = path.join(ROOT, 'screenshots');
const url = (f) => 'file://' + encodeURI(path.join(ROOT, f));
fs.mkdirSync(OUT, { recursive: true });

const problems = [];
function watch(page, tag) {
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`[${tag}] console.error: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[${tag}] pageerror: ${e.message}`));
}
function check(cond, msg) { if (!cond) problems.push(msg); }

async function noOverflow(page, tag) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  check(r.sw <= r.iw, `[${tag}] 横向溢出 scrollWidth=${r.sw} innerWidth=${r.iw}`);
  return r;
}

async function saveDataURL(page, file) {
  const data = await page.evaluate(() => globalThis.ScheduleWallpaperApp.exportDataURL());
  fs.writeFileSync(path.join(OUT, file), Buffer.from(data.split(',')[1], 'base64'));
}

async function pick(page, kind, value) {
  await page.click(`[data-${kind}="${value}"]`);
  await page.waitForTimeout(150);
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  try {
    /* ---------- 桌面 ---------- */
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true, locale: 'zh-CN' });
    const page = await ctx.newPage();
    watch(page, 'desktop');
    page.on('dialog', (d) => d.accept());
    await page.goto(url('index.html'));
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForTimeout(300);

    // 01 空状态
    check(await page.isVisible('#empty-hint'), '空状态提示没有显示');
    check((await page.textContent('#filled-count')).includes('0'), '初始计数不是 0');
    await noOverflow(page, 'desktop-empty');
    await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

    // 02 核心流程：载入示例 → 改一格（长课程名）→ 批量粘贴 → 换模板
    await page.click('#btn-sample-inline');
    await page.waitForTimeout(200);
    check(!(await page.isVisible('#empty-hint')), '载入示例后空状态仍显示');
    check((await page.textContent('#filled-count')).includes('40'), '示例应填 40 格');
    const cell = page.locator('.slot[data-day="thu"][data-period="p8"] .slot-course');
    await cell.fill('研究性学习与社会实践活动');
    const room = page.locator('.slot[data-day="thu"][data-period="p8"] .slot-room');
    await room.fill('报告厅');
    await page.fill('#bulk-input', '周二,8,心理健康,302\n周八,1,语文');
    await page.click('#btn-bulk');
    await page.waitForTimeout(200);
    const bulkMsg = await page.textContent('#bulk-result');
    check(bulkMsg.includes('填入 1 格') && bulkMsg.includes('1 行'), `批量结果异常：${bulkMsg}`);
    check((await page.locator('#bulk-errors li').count()) === 1, '批量错误行应为 1');
    await pick(page, 'template', 'fresh');
    const st = await page.evaluate(() => globalThis.ScheduleWallpaperApp.getState());
    check(st.cells['tue|p8'] && st.cells['tue|p8'].course === '心理健康', '批量粘贴未写入周二第 8 节');
    check(st.cells['thu|p8'].course === '研究性学习与社会实践活动', '单格输入未写入');
    await page.evaluate(() => window.scrollTo(0, 0));
    await noOverflow(page, 'desktop-flow');
    await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png') });

    // 03 结果与导出：切电脑尺寸 + 黑板风，导出 PNG 与 JSON
    await pick(page, 'size', 'desktop');
    await pick(page, 'template', 'chalk');
    const [png] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export-png')]);
    const pngName = png.suggestedFilename();
    check(/^课表壁纸-电脑-2560x1440-\d{8}\.png$/.test(pngName), `PNG 文件名异常：${pngName}`);
    const pngPath = path.join(require('os').tmpdir(), 'kbwp-' + Date.now() + '.png');
    await png.saveAs(pngPath);
    const head = fs.readFileSync(pngPath);
    check(head.slice(1, 4).toString() === 'PNG' && head.readUInt32BE(16) === 2560 && head.readUInt32BE(20) === 1440, 'PNG 下载内容或尺寸不对');
    fs.unlinkSync(pngPath);
    const [json] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export-json')]);
    const jsonPath = path.join(require('os').tmpdir(), 'kbwp-' + Date.now() + '.json');
    await json.saveAs(jsonPath);
    const jsonText = fs.readFileSync(jsonPath, 'utf8');
    fs.unlinkSync(jsonPath);
    check(JSON.parse(jsonText).cells['thu|p8'].course === '研究性学习与社会实践活动', 'JSON 导出内容不对');
    await page.waitForTimeout(200);
    await noOverflow(page, 'desktop-export');
    await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png') });

    // 刷新后持久化仍在
    await page.waitForTimeout(400);
    await page.reload();
    await page.waitForTimeout(300);
    const persisted = await page.evaluate(() => globalThis.ScheduleWallpaperApp.getState());
    check(persisted.templateId === 'chalk' && persisted.sizeKey === 'desktop' && Object.keys(persisted.cells).length === 40, '刷新后本地数据未恢复');

    // 05/06 壁纸成品（与下载按钮同一绘制函数）
    await saveDataURL(page, '06-壁纸成品-电脑.png');
    await pick(page, 'size', 'phone');
    await pick(page, 'template', 'midnight');
    await saveDataURL(page, '05-壁纸成品-手机.png');
    // 其余模板的手机成品，供 showcase 展示
    for (const [id, file] of [['fresh', '07-模板-清爽网格.png'], ['blocks', '08-模板-撞色色块.png'], ['chalk', '09-模板-黑板风.png']]) {
      await pick(page, 'template', id);
      await saveDataURL(page, file);
    }
    // 平板尺寸也画一次，确保不报错
    await pick(page, 'size', 'tablet');
    await saveDataURL(page, '10-壁纸成品-平板.png');

    // JSON 导入回环
    await page.click('#btn-clear');
    await page.waitForTimeout(200);
    check(await page.isVisible('#empty-hint'), '清空后空状态未出现');
    await page.setInputFiles('#file-import', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(jsonText) });
    await page.waitForTimeout(300);
    check((await page.textContent('#filled-count')).includes('40'), 'JSON 导入后格数不对');
    // 坏 JSON 不应崩
    await page.setInputFiles('#file-import', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{oops') });
    await page.waitForTimeout(200);
    check((await page.textContent('#toast')).includes('导入失败'), '坏 JSON 没有提示');
    // XSS：课程名里的标签只能作为文本出现
    await page.locator('.slot[data-day="mon"][data-period="p1"] .slot-course').fill('<img src=x onerror=alert(1)>');
    await page.waitForTimeout(100);
    check((await page.locator('img').count()) === 0, '用户输入被当成 HTML 插入');
    // 节次时间：非法值被拒绝，合法值写入
    const startInput = page.locator('#period-list input[data-field="start"]').first();
    await startInput.fill('25:99');
    await startInput.press('Tab');
    check((await startInput.inputValue()) === '08:00', '非法时间没有被回退');
    await startInput.fill('7:50');
    await startInput.press('Tab');
    await page.waitForTimeout(100);
    const st2 = await page.evaluate(() => globalThis.ScheduleWallpaperApp.getState());
    check(st2.periods[0].start === '07:50', '合法时间未写入');
    await ctx.close();

    /* ---------- 手机 ---------- */
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'zh-CN' });
    const mpage = await mctx.newPage();
    watch(mpage, 'mobile');
    mpage.on('dialog', (d) => d.accept());
    await mpage.goto(url('index.html'));
    await mpage.evaluate(() => localStorage.clear());
    await mpage.reload();
    await mpage.click('#btn-sample-inline');
    await mpage.waitForTimeout(3200); // 等提示条消失，避免遮挡截图
    await noOverflow(mpage, 'mobile');
    await mpage.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
    await mctx.close();

    /* ---------- showcase ---------- */
    const sctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
    const spage = await sctx.newPage();
    watch(spage, 'showcase');
    await spage.goto(url('showcase.html'));
    await spage.waitForTimeout(400);
    const broken = await spage.evaluate(() => Array.from(document.images).filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src')));
    check(broken.length === 0, `showcase 图片加载失败：${broken.join(', ')}`);
    await noOverflow(spage, 'showcase');
    await spage.screenshot({ path: path.join(ROOT, 'showcase.png'), fullPage: true });
    await sctx.close();
  } finally {
    await browser.close();
  }

  if (problems.length) {
    console.error('失败：\n' + problems.join('\n'));
    process.exit(1);
  }
  console.log('全部通过：screenshots/01–10 与 showcase.png 已生成');
})().catch((e) => { console.error(e); process.exit(1); });
