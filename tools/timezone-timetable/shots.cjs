'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const URL_INDEX = 'file://' + encodeURI(path.join(__dirname, 'index.html')) + '?today=2026-10-26';
const URL_SHOWCASE = 'file://' + encodeURI(path.join(__dirname, 'showcase.html'));
const SHOTS = path.join(__dirname, 'screenshots');

const problems = [];
const results = [];
let asserts = 0;
function check(cond, msg) {
  asserts++;
  if (!cond) { problems.push('断言失败:' + msg); console.error('FAIL', msg); } else { console.log('ok  ', msg); }
}
function watch(page, tag) {
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`[${tag}] console error: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[${tag}] pageerror: ${e.message}`));
}
async function overflow(page, label) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  results.push(`${label}: scrollWidth=${r.sw} innerWidth=${r.iw}`);
  check(r.sw <= r.iw, `${label} scrollWidth(${r.sw}) <= innerWidth(${r.iw})`);
}
async function readDownload(page, clickSel) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(clickSel)]);
  return { name: dl.suggestedFilename(), text: fs.readFileSync(await dl.path(), 'utf8') };
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });
  try {
    /* ---------- 桌面 ---------- */
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
    const page = await ctx.newPage();
    watch(page, 'desktop');
    await page.goto(URL_INDEX);
    check(await page.isVisible('#empty-guide'), '空状态显示引导');
    check(await page.isDisabled('#btn-md') && await page.isDisabled('#btn-ics'), '未生成时 Markdown/ICS 导出禁用');
    await overflow(page, '桌面-空状态');
    await page.screenshot({ path: path.join(SHOTS, '01-空状态-桌面.png') });

    await page.click('#btn-sample-2');
    check(await page.locator('#student-list .item').count() === 4, '示例载入 4 位学员');
    check(await page.locator('#rule-list .item').count() === 6, '示例载入 6 节课');
    check(!(await page.isVisible('#empty-guide')), '载入后引导隐藏');
    await page.click('#btn-generate');
    check(await page.locator('#result .card').count() === 4, '生成 4 张学员卡');
    const tags = await page.locator('#result .tag-warn').allTextContents();
    check(tags.some((t) => t.includes('下周切换') && t.includes('09:00') && t.includes('08:00')), '美东学员显示下周切换 09:00 变 08:00: ' + tags.join(' | '));
    check(tags.some((t) => t.includes('本周已切换')), '伦敦学员显示本周已切换');
    const dst = await page.locator('#dst-list .item').allTextContents();
    check(dst.some((t) => t.includes('2026-11-01') && t.includes('America/New_York')), '60 天列表含美东 11-01');
    check(!dst.some((t) => t.includes('Europe/London')), '伦敦 10-25 已过,60 天内无切换(下一次在 2027-03)');
    check(await page.locator('#result .tag-off').count() === 1, '取消的课显示已取消标签');
    const rt = await page.locator('#result').innerText();
    check(rt.includes('(次日)') && rt.includes('(前一日)'), '结果中出现跨日标注 次日 与 前一日');
    await page.screenshot({ path: path.join(SHOTS, '02-核心流程-桌面.png') });

    check((await page.textContent('#base-date')).includes('基准日 2026-10-26(由地址参数固定)'), '地址参数固定日期时持续显示基准日');
    check(await page.isVisible('#sample-badge'), '载入示例后持续显示合成示例标记');

    /* 删除课节:先页内确认,写明连带删除的例外数 */
    const exBefore = await page.locator('#ex-list .item').count();
    await page.click('#rule-list .item:has-text("周六 18:00") >> text=删除');
    check((await page.textContent('#confirm-text')).includes('1 条例外'), '删除课节确认文案列明连带删除 1 条例外: ' + await page.textContent('#confirm-text'));
    check(await page.locator('#rule-list .item').count() === 6 && await page.locator('#ex-list .item').count() === exBefore, '确认前课节与例外都不变');
    await page.click('#confirm-no');
    check(await page.locator('#rule-list .item').count() === 6, '取消删除后课节仍在');
    await page.click('#rule-list .item:has-text("周六 18:00") >> text=删除');
    await page.click('#confirm-yes');
    check(await page.locator('#rule-list .item').count() === 5 && await page.locator('#ex-list .item').count() === exBefore - 1, '确认后课节与其例外一并删除');
    /* 删除例外:先页内确认 */
    await page.click('#ex-list .item >> text=删除 >> nth=0');
    check(await page.isVisible('#confirm-area') && (await page.textContent('#confirm-text')).includes('按每周固定课表上课'), '删除例外先出现页内确认');
    await page.click('#confirm-no');
    check(await page.locator('#ex-list .item').count() === exBefore - 1, '取消删除例外后仍在');
    await page.click('#btn-generate');

    /* 编辑学员:保留 ID 与关联课表,结果标为过期 */
    check(!(await page.isVisible('#stale-note')), '生成后无过期提示');
    await page.click('#edit-demo-s1');
    check(await page.inputValue('#stu-name') === '示例学员 Alice' && await page.isDisabled('#btn-md'), '进入编辑:表单带出原值,编辑中导出禁用');
    await page.fill('#stu-name', '   ');
    await page.click('#stu-submit');
    check(await page.getAttribute('#stu-name', 'aria-invalid') === 'true' && (await page.textContent('#msg-student')).includes('请填写姓名'), '编辑校验失败:原因在表单旁并标记出错控件');
    check(await page.evaluate(() => document.activeElement.id) === 'stu-name', '编辑校验失败后焦点回到姓名');
    await page.fill('#stu-name', '示例学员 Alice B');
    await page.selectOption('#stu-tz', 'America/Chicago');
    await page.click('#stu-submit');
    check(await page.locator('#student-list .item:has-text("示例学员 Alice B")').count() === 1 && await page.locator('#student-list .item').count() === 4, '编辑后姓名更新且学员数不变');
    check(await page.locator('#rule-list .item:has-text("示例学员 Alice B")').count() === 2, '关联的 2 节课随学员保留');
    check(await page.isVisible('#stale-note'), '编辑学员后已有对照结果标为过期');
    check(await page.evaluate(() => document.activeElement.id) === 'edit-demo-s1', '保存后焦点回到该学员的编辑按钮');
    await page.click('#btn-generate');
    check((await page.textContent('#result')).includes('America/Chicago'), '重新生成后对照表使用新时区');
    await page.click('#btn-sample');
    check((await page.textContent('#confirm-text')).includes('4 位学员'), '载入示例确认文案写明替换数量: ' + await page.textContent('#confirm-text'));
    await page.click('#confirm-no');

    /* 手动录入:学员(公式前缀姓名)、课节、取消例外 */
    await page.fill('#stu-name', '=HYPERLINK("x")');
    await page.selectOption('#stu-tz', 'Asia/Kolkata');
    await page.click('#form-student button[type=submit]');
    check(await page.locator('#student-list .item').count() === 5, '手动添加学员');
    await page.selectOption('#rule-student', { label: '=HYPERLINK("x")' });
    await page.selectOption('#rule-weekday', '1');
    await page.fill('#rule-start', '23:30');
    await page.fill('#rule-dur', '60');
    await page.click('#form-rule button[type=submit]');
    check(await page.locator('#rule-list .item').count() === 6, '手动添加课节');
    check(await page.isVisible('#stale-note'), '改动后显示过期提示');
    check(await page.isDisabled('#btn-md') && await page.isDisabled('#btn-ics'), '改动后导出禁用');
    await page.selectOption('#ex-rule', { label: '周一 23:30 · =HYPERLINK("x")' });
    await page.fill('#ex-date', '2026-10-28');
    await page.click('#form-ex button[type=submit]');
    check((await page.textContent('#msg-ex')).includes('周三'), '例外日期星期不符被拒绝并说明原因');
    await page.fill('#ex-date', '2026-10-26');
    await page.selectOption('#ex-type', 'move');
    await page.fill('#ex-start', '20:00');
    await page.click('#form-ex button[type=submit]');
    check(await page.locator('#ex-list .item').count() === exBefore, '添加改时间例外');
    await page.click('#btn-generate');
    check(await page.isEnabled('#btn-md') && await page.isEnabled('#btn-ics'), '重新生成后导出可用');

    const md = await readDownload(page, '#btn-md');
    check(md.name.endsWith('.md') && md.text.includes("## '=HYPERLINK") && md.text.includes('夏令时提醒'), 'Markdown 导出:公式前缀与提醒: ' + md.name);
    check((md.text.match(/^## /gm) || []).length === 5, 'Markdown 每位学员一段');
    const ics = await readDownload(page, '#btn-ics');
    check(ics.text.includes('BEGIN:VCALENDAR') && /DTSTART;TZID=[A-Za-z_\/]+:\d{8}T\d{6}/.test(ics.text), 'ICS 导出含 TZID 与本地 DTSTART');
    const js = await readDownload(page, '#btn-json');
    check(JSON.parse(js.text).students.length === 5, 'JSON 备份含 5 位学员');

    /* 导入:非法被拒 */
    await page.setInputFiles('#file-import', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, teacherTz: 'Asia/Shanghai', students: [{ id: 'a', name: 'X', tz: 'Mars/Base' }], rules: [], exceptions: [] })) });
    await page.waitForFunction(() => document.getElementById('msg-import').textContent.includes('导入被拒绝'));
    check((await page.textContent('#msg-import')).includes('时区'), '非法时区导入被拒并给原因');
    check(await page.locator('#student-list .item').count() === 5, '被拒后原数据不变');
    /* 导入合法:需确认 */
    await page.setInputFiles('#file-import', { name: 'ok.json', mimeType: 'application/json', buffer: Buffer.from(js.text) });
    await page.waitForSelector('#confirm-area:not([hidden])');
    await page.click('#confirm-yes');
    check(await page.locator('#student-list .item').count() === 5, '合法导入后数据恢复');
    await page.click('#btn-generate');
    await page.locator('#export-note').scrollIntoViewIfNeeded();
    await overflow(page, '桌面-结果');
    await page.screenshot({ path: path.join(SHOTS, '03-结果与导出-桌面.png'), fullPage: true });
    await ctx.close();

    /* ---------- 演示周按钮:基准日不是 2026-10-26 时 ---------- */
    const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const dp = await dctx.newPage();
    watch(dp, 'demo-week');
    await dp.goto('file://' + encodeURI(path.join(__dirname, 'index.html')) + '?today=2026-10-20');
    await dp.click('#btn-sample-2');
    check(!(await dp.textContent('#btn-sample-2')).includes('今天固定'), '示例按钮不再声称今天固定为 2026-10-26');
    check(await dp.isVisible('#btn-demo-week'), '载入示例后出现「查看 2026-10-26 所在周」按钮');
    await dp.click('#btn-generate');
    check(!(await dp.locator('#result .tag-warn').allTextContents()).some((t) => t.includes('本周已切换')), '基准周(2026-10-20)还没有「本周已切换」提醒');
    await dp.click('#btn-demo-week');
    check(await dp.inputValue('#week-date') === '2026-10-26', '点按钮后所选周切到 2026-10-26');
    await dp.click('#btn-generate');
    check((await dp.locator('#result .tag-warn').allTextContents()).some((t) => t.includes('本周已切换')), '演示周显示伦敦「本周已切换」提醒');
    await dp.reload();
    check(await dp.isVisible('#sample-badge'), '刷新后合成示例标记仍在');
    await dctx.close();

    /* ---------- 存储失败 ---------- */
    const ctxF = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctxF.addInitScript(() => { Storage.prototype.setItem = function () { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }; });
    const pf = await ctxF.newPage();
    watch(pf, 'storage-fail');
    await pf.goto(URL_INDEX);
    check(!(await pf.isVisible('#storage-warning')), '存储失败场景:初始无警告');
    await pf.click('#btn-sample-2');
    check(await pf.isVisible('#storage-warning'), '存储写入抛 QuotaExceededError 时显示「未保存」提示');
    check(!(await pf.isVisible('#toast')), '写入失败时不显示成功提示');
    await ctxF.close();

    /* ---------- 手机 ---------- */
    const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
    const pm = await ctxM.newPage();
    watch(pm, 'mobile');
    await pm.goto(URL_INDEX);
    await pm.click('#btn-sample-2');
    await pm.click('#btn-generate');
    check(await pm.locator('#result .card').count() === 4, '手机端生成对照卡');
    await overflow(pm, '手机');
    await pm.screenshot({ path: path.join(SHOTS, '04-手机.png'), fullPage: true });
    await ctxM.close();

    /* ---------- 展示图 ---------- */
    const ctxS = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const ps = await ctxS.newPage();
    watch(ps, 'showcase');
    await ps.goto(URL_SHOWCASE);
    await ps.waitForLoadState('load');
    await ps.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
    await ctxS.close();
  } finally {
    await browser.close();
  }
  console.log(results.join('\n'));
  console.log('断言数:' + asserts);
  if (problems.length) { console.error('问题:\n' + problems.join('\n')); process.exit(1); }
  console.log('全部通过');
})().catch((e) => { console.error(e); process.exit(1); });
