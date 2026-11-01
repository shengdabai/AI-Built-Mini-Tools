// 错题回环 — Playwright 截图与端到端冒烟：真实点击界面走完核心路径。
// 运行：node shots.cjs   任何 console error / pageerror / 横向溢出 / 断言失败都会以非零退出。
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;

const DIR = __dirname;
const SHOTS = path.join(DIR, 'screenshots');
const TODAY = '2026-09-30';
const URL = 'file://' + encodeURI(path.join(DIR, 'index.html')) + '?today=' + TODAY;
const problems = [];

function watch(page, name) {
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`[${name}] console.error: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[${name}] pageerror: ${e.message}`));
  page.on('dialog', (d) => d.accept());
}
function check(cond, msg) { if (!cond) throw new Error('断言失败：' + msg); }
async function noOverflow(page, label) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  check(r.sw <= r.iw, `${label} 横向溢出 scrollWidth=${r.sw} innerWidth=${r.iw}`);
}
async function calm(page) {
  // 截图前收起提示条，避免遮挡内容
  await page.evaluate(() => { document.querySelector('#toast').classList.remove('is-visible'); if (document.activeElement) document.activeElement.blur(); window.scrollTo(0, 0); });
  await page.mouse.move(0, 0).catch(() => {});
  await page.waitForTimeout(250);
}
async function go(page, hash) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForSelector(`#view-${hash}:not([hidden])`);
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });
  try {
    // ---------- 桌面 ----------
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
    const page = await ctx.newPage();
    watch(page, 'desktop');
    await page.goto(URL);
    await page.waitForSelector('.empty__title');
    check((await page.textContent('.empty__title')).includes('还没有错题'), '空状态标题');
    await noOverflow(page, '桌面空状态');
    await page.screenshot({ path: path.join(SHOTS, '01-空状态-桌面.png') });

    // 载入示例
    await page.click('#btn-sample');
    check((await page.textContent('#tab-total-count')) === '14', '示例 14 条');

    // 单条录入（规则识别为「多字」）
    await go(page, 'add');
    await page.fill('#in-wrong', '我比他很高。');
    await page.fill('#in-correct', '我比他高。');
    check((await page.textContent('#auto-tag')).includes('多字'), '单条录入自动识别多字');
    await page.fill('input[name="english"]', 'I am taller than him.');
    await page.fill('input[name="note"]', '比较句里不用「很」');
    await page.click('#form-single button[type="submit"]');
    check((await page.textContent('#tab-total-count')) === '15', '单条录入后 15 条');

    // 批量粘贴 + 一行错误格式
    await page.fill('#in-bulk', '这书很有意思 | 这本书很有意思 | This book is interesting.\n我去过了北京 | 我去过北京 | I have been to Beijing.\n这一行没有分隔符');
    const bulkText = await page.textContent('#bulk-preview');
    check(bulkText.includes('量词错误') && bulkText.includes('体标记') && bulkText.includes('第 3 行未识别'), '批量预览识别类型与错误行');
    await page.click('#btn-bulk');
    check((await page.textContent('#tab-total-count')) === '17', '批量导入后 17 条');
    await noOverflow(page, '桌面录入页');

    // 复习：写答案 → 检查 → 看差异 → 自评
    await go(page, 'review');
    const dueBefore = Number(await page.textContent('#tab-due-count'));
    check(dueBefore === 11, `今日到期应为 11（7 条示例 + 3 条新录入 + 逾期 1），实际 ${dueBefore}`);
    check((await page.textContent('.study-card__wrong')) === '他跑步跑的很快。', '逾期题排第一');
    await page.fill('#answer-input', '他跑步跑地很快');
    await page.click('.answer button[type="submit"]');
    await page.waitForSelector('.compare');
    check((await page.textContent('.verdict')).includes('还差一点'), '错误答案提示');
    check((await page.textContent('.compare__row del')) === '地' && (await page.textContent('.compare__row ins')) === '得', '逐字差异高亮');
    await noOverflow(page, '桌面复习页');
    await calm(page);
    await page.screenshot({ path: path.join(SHOTS, '02-核心流程-桌面.png') });
    await page.click('.grade--hard');
    check(Number(await page.textContent('#tab-due-count')) === dueBefore - 1, '自评后出队');

    // 第二题：显示答案 → 键盘 4（很熟）
    await page.click('.answer .btn--secondary');
    await page.waitForSelector('.grades');
    await page.keyboard.press('4');
    check(Number(await page.textContent('#tab-due-count')) === dueBefore - 2, '键盘自评出队');

    // 第三题：答对
    const third = await page.evaluate(() => {
      const w = document.querySelector('.study-card__wrong').textContent;
      return JSON.parse(localStorage.getItem('cuotihuihuan.v1')).cards.find((c) => c.wrong === w).correct;
    });
    await page.fill('#answer-input', third);
    await page.keyboard.press('Enter');
    check((await page.textContent('.verdict')).includes('完全正确'), '正确答案判定');
    await page.click('.grade--good');

    // 错题本：手动改标签
    await go(page, 'list');
    await page.selectOption('#filter-tag', 'other');
    const sel = page.locator('#list-root .item .select').first();
    await sel.selectOption('order');
    await page.selectOption('#filter-tag', '');
    check((await page.locator('#list-root .item').count()) === 17, '错题本 17 条');
    await noOverflow(page, '桌面错题本');

    // 统计 + 导出
    await go(page, 'stats');
    check((await page.textContent('.tile--due .tile__value')) === String(dueBefore - 3), '统计：今日到期');
    check((await page.locator('.tile__value').nth(3).textContent()) === '3', '统计：今日已复习 3');
    const [anki] = await Promise.all([page.waitForEvent('download'), page.click('#btn-anki')]);
    const ankiPath = path.join(os.tmpdir(), 'cuoti-anki-test.csv');
    await anki.saveAs(ankiPath);
    const csv = fs.readFileSync(ankiPath, 'utf8');
    check(csv.startsWith('#separator:comma') && csv.includes('我有三个书。<br>I have three books.,我有三本书。<br>错误类型：量词错误'), 'Anki CSV 内容');
    check(csv.trim().split('\n').length === 3 + 17, 'Anki CSV 行数');
    const [json] = await Promise.all([page.waitForEvent('download'), page.click('#btn-json')]);
    const jsonPath = path.join(os.tmpdir(), 'cuoti-backup-test.json');
    await json.saveAs(jsonPath);
    const backup = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    check(backup.app === 'cuoti-huihuan' && backup.cards.length === 17 && backup.log.length === 3, 'JSON 备份内容');
    await noOverflow(page, '桌面统计页');
    await calm(page);
    await page.screenshot({ path: path.join(SHOTS, '03-结果与导出-桌面.png'), fullPage: true });

    // 清空（确认框自动接受）→ 再从 JSON 备份恢复
    await page.click('#btn-clear');
    check((await page.textContent('#tab-total-count')) === '0', '清空数据');
    await page.setInputFiles('#in-import', jsonPath);
    await page.waitForFunction(() => document.querySelector('#tab-total-count').textContent === '17');
    await ctx.close();

    // ---------- 手机 ----------
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const m = await mctx.newPage();
    watch(m, 'mobile');
    await m.goto(URL);
    await noOverflow(m, '手机空状态');
    await m.click('.empty .btn--primary');
    await m.fill('#answer-input', '他跑步跑地很快');
    await m.click('.answer button[type="submit"]');
    await m.waitForSelector('.grades');
    await noOverflow(m, '手机复习页');
    await calm(m);
    await m.screenshot({ path: path.join(SHOTS, '04-手机.png'), fullPage: true });
    for (const v of ['add', 'list', 'stats']) { await go(m, v); await noOverflow(m, '手机 ' + v); }
    await mctx.close();

    // ---------- 展示图 ----------
    const sctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    const s = await sctx.newPage();
    watch(s, 'showcase');
    await s.goto('file://' + encodeURI(path.join(DIR, 'showcase.html')));
    await s.waitForLoadState('load');
    await noOverflow(s, '展示页');
    await s.screenshot({ path: path.join(DIR, 'showcase.png'), fullPage: true });
    await sctx.close();
  } catch (e) {
    problems.push(e.message);
  } finally {
    await browser.close();
  }
  if (problems.length) {
    console.error('失败：\n' + problems.join('\n'));
    process.exit(1);
  }
  console.log('OK：4 张截图 + showcase.png，零 console error，桌面/手机无横向溢出，核心路径断言全部通过');
})();
