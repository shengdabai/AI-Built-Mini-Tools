'use strict';
/* 真实操作界面并截图:空状态 → 载入示例 → 今天要跟 → 推进阶段 → 流失 → 统计 → 导出周报/CSV。
   有任何断言失败、console error 或 pageerror 即非零退出。 */
const path = require('path');
const fs = require('fs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const DIR = __dirname;
const URL_INDEX = 'file://' + encodeURI(path.join(DIR, 'index.html')) + '?today=2026-10-20';
const URL_SHOWCASE = 'file://' + encodeURI(path.join(DIR, 'showcase.html'));
const SHOT = (name) => path.join(DIR, 'screenshots', name);
const problems = [];
const results = [];

function watch(page, label) {
  page.on('console', (m) => { if (m.type() === 'error') problems.push(label + ' console error: ' + m.text()); });
  page.on('pageerror', (e) => problems.push(label + ' pageerror: ' + e.message));
}
async function noOverflow(page, label) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  results.push(label + ' scrollWidth=' + r.sw + ' innerWidth=' + r.iw);
  assert.ok(r.sw <= r.iw, label + ' 横向溢出: scrollWidth ' + r.sw + ' > innerWidth ' + r.iw);
}
async function launchBrowser() {
  try { return await chromium.launch(); }
  catch (firstError) {
    try { return await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined }); }
    catch (fallbackError) { throw new Error('Chromium 默认启动失败：' + firstError.message + '；备用启动也失败：' + fallbackError.message); }
  }
}

(async () => {
  fs.mkdirSync(path.join(DIR, 'screenshots'), { recursive: true });
  const browser = await launchBrowser();
  try {
    /* ---------- 桌面 ---------- */
    const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const page = await dctx.newPage();
    watch(page, '桌面');
    await page.goto(URL_INDEX);
    assert.equal(await page.textContent('#today-label'), '2026-10-20');
    assert.equal(await page.isVisible('#empty'), true, '空状态应显示引导');
    assert.equal(await page.isVisible('#btn-import') && await page.isVisible('#empty-import'), true, '空状态下「导入 JSON 备份」入口可见');
    assert.match(await page.textContent('#today-fixed'), /基准日由地址参数固定/);
    const badToday = await dctx.newPage();
    watch(badToday, '桌面(非法today)');
    await badToday.goto('file://' + encodeURI(path.join(DIR, 'index.html')) + '?today=2026-02-30');
    assert.equal(await badToday.isVisible('#today-fixed'), false, '?today=2026-02-30 被拒绝,不显示固定提示');
    assert.notEqual(await badToday.textContent('#today-label'), '2026-02-30');
    await badToday.close();
    await noOverflow(page, '桌面-空状态');
    await page.screenshot({ path: SHOT('01-空状态-桌面.png') });

    // 载入示例 → 今天要跟
    await page.click('#btn-sample');
    assert.equal(await page.locator('.card').count(), 14, '示例应渲染 14 张卡片');
    const todayCount = Number(await page.textContent('#today-count'));
    assert.ok(todayCount >= 3, '示例至少 3 条超期,实际 ' + todayCount);
    const firstTodayName = await page.locator('.today-item strong').first().textContent();
    assert.equal(firstTodayName, '学员辛', '逾期最久(5+3)应排第一');
    await noOverflow(page, '桌面-载入示例后');
    assert.equal(await page.isVisible('#sample-badge'), true, '载入示例后持续显示「合成示例」标记');
    const statsNote = await page.textContent('#stats');
    assert.match(statsNote, /跳级[\s\S]*计入被跳过的中间阶段/, '转化率旁写明跳级计入中间阶段');
    assert.match(statsNote, /按历史阶段统计/, '渠道付款旁写明按历史阶段统计');

    // 推进一条线索:学员庚 已试课 → 已报价
    const gengCard = page.locator('details[data-stage="已试课"] .card', { hasText: '学员庚' });
    assert.equal(await gengCard.count(), 1);
    await gengCard.locator('select[data-act="advance"]').selectOption('已报价');
    assert.equal(await page.locator('details[data-stage="已报价"] .card', { hasText: '学员庚' }).count(), 1, '学员庚应出现在「已报价」列');
    assert.equal(await page.locator('details[data-stage="已试课"] .card', { hasText: '学员庚' }).count(), 0);

    // 今天已联系:学员乙从今天要跟中移除
    const before = Number(await page.textContent('#today-count'));
    await page.locator('.today-item', { hasText: '学员乙' }).locator('[data-act="touch"]').click();
    assert.equal(Number(await page.textContent('#today-count')), before - 1, '记录联系后超期数应减 1');

    // 完整跟进事件:先页内复核,再追加；输入按纯文本显示
    const jiaCard = page.locator('details[data-stage="咨询中"] .card', { hasText: '学员甲' });
    await jiaCard.locator('[data-act="contact"]').click();
    await page.fill('#c-date', '2026-10-13');
    await page.selectOption('#c-channel', '微信');
    await page.fill('#c-summary', '<img src=x onerror=alert(1)>');
    await page.fill('#c-outcome', '确认周末试课');
    await page.fill('#c-next', '发送课表');
    await page.click('#contact-review');
    assert.equal(await page.isVisible('#contact-confirm'), true, '完整跟进必须经过页内确认');
    assert.match(await page.textContent('#contact-confirm-text'), /确认追加联系记录/);
    await page.click('#contact-yes');
    assert.equal(await page.isVisible('#contact-panel'), false);
    await page.locator('details[data-stage="咨询中"] .card', { hasText: '学员甲' }).locator('[data-act="contact"]').click();
    assert.match(await page.textContent('#contact-timeline'), /<img src=x onerror=alert\(1\)>/, '用户文本应原样显示');
    assert.equal(await page.locator('#contact-timeline img').count(), 0, '用户文本不得生成 HTML 元素');
    assert.match(await page.textContent('#contact-timeline'), /来源：sample/, '合成示例内新增事件继续标注示例来源');
    await page.locator('#contact-timeline [data-act="correct-event"]').click();
    await page.fill('#c-summary', '确认学习目标');
    await page.click('#contact-review');
    assert.match(await page.textContent('#contact-confirm-text'), /确认追加更正记录/);
    await page.click('#contact-yes');
    await page.locator('details[data-stage="咨询中"] .card', { hasText: '学员甲' }).locator('[data-act="contact"]').click();
    assert.match(await page.textContent('#contact-timeline'), /已归档/, '更正后旧事件保留为归档历史');
    assert.match(await page.textContent('#contact-timeline'), /更正自：/, '新事件明确指向被更正事件');
    await page.screenshot({ path: SHOT('05-联系时间线-桌面.png'), fullPage: true });
    await page.click('#contact-cancel');

    // 流失必须选原因:学员丙 → 流失(价格)
    await page.locator('details[data-stage="咨询中"] .card', { hasText: '学员丙' }).locator('select[data-act="advance"]').selectOption('流失');
    assert.equal(await page.locator('.loss-chooser').count(), 1, '应出现流失原因选择');
    await page.locator('.loss-chooser select').selectOption('价格');
    await page.click('[data-act="loss-yes"]');
    assert.equal(await page.locator('details[data-stage="流失"] .card', { hasText: '学员丙' }).count(), 1);

    // 截图 02:核心流程(今天要跟 + 看板)
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: SHOT('02-核心流程-桌面.png') });

    // 统计:价格流失应为 2;整体转化率有数
    const statsText = await page.textContent('#stats');
    assert.match(statsText, /流失原因分布/);
    assert.match(statsText, /价格[\s\S]*2 条/);
    assert.match(statsText, /咨询 → 试课[\s\S]*%/);

    // 导出周报
    await page.click('#btn-report');
    const report = await page.textContent('#report-text');
    assert.match(report, /# 试课跟进周报 2026-10-13 至 2026-10-20/);
    assert.match(report, /## 待跟进清单/);
    assert.match(report, /## 本周已核实联系事件\(1\)/, '周报按真实 detailed 事件计数');
    assert.match(report, /## 本周仅日期标记\(1,不计入已核实联系\)/, '快速联系单列且不冒充已核实联系');
    assert.match(report, /学员辛/);
    // CSV 下载
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-csv')]);
    const csvText = fs.readFileSync(await dl.path(), 'utf8');
    assert.match(csvText, /姓名,渠道/);
    assert.match(csvText, /学员甲/);
    // 刷新后数据仍在(localStorage)
    await page.reload();
    assert.equal(await page.locator('.card').count(), 14, '刷新后应保留数据');
    await page.click('#btn-report');
    await noOverflow(page, '桌面-统计与周报');
    await page.screenshot({ path: SHOT('03-结果与导出-桌面.png'), fullPage: true });

    /* 第五轮:周报预览随数据重生成;表单打开时导出禁用 */
    assert.equal(await page.isVisible('#sample-badge'), true, '刷新后「合成示例」标记仍在');
    assert.match(await page.textContent('#report-text'), /数据来源:合成示例/, '示例周报内标注合成示例');
    assert.match(await page.textContent('#report-text'), /超过 3 天未联系/, '周报写明超期阈值口径');
    await page.fill('#n-input', '9');
    await page.locator('#n-input').dispatchEvent('change');
    assert.match(await page.textContent('#report-text'), /超过 9 天未联系/, '改超期天数后周报预览自动更新');
    await page.fill('#n-input', '99');
    await page.locator('#n-input').dispatchEvent('change');
    assert.equal(await page.isVisible('#n-error'), true, '超期天数非法时错误显示在输入框旁');
    assert.equal(await page.getAttribute('#n-input', 'aria-invalid'), 'true');
    await page.fill('#n-input', '9');
    await page.locator('#n-input').dispatchEvent('change');
    const nBefore = await page.textContent('#report-text');
    const todayBefore = Number(await page.textContent('#today-count'));
    await page.locator('.today-item').first().locator('[data-act="touch"]').click();
    assert.notEqual(await page.textContent('#report-text'), nBefore, '记录联系后周报预览自动更新');
    assert.equal(Number(await page.textContent('#today-count')), todayBefore - 1, '改超期天数后立即点按钮,一次点击就生效');
    const [dlJ] = await Promise.all([page.waitForEvent('download'), page.click('#btn-json')]);
    const jsonPath = path.join(DIR, 'screenshots', '.tmp-backup.json');
    await dlJ.saveAs(jsonPath);
    const backup = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    assert.equal(backup.n, 9, 'JSON 备份包含超期天数 n');
    assert.equal(backup.sample, true, 'JSON 备份带示例标记');
    assert.match(dlJ.suggestedFilename(), /合成示例/);
    await page.locator('details[data-stage="咨询中"] .card').first().locator('[data-act="edit"]').click();
    assert.equal(await page.getAttribute('#btn-csv', 'aria-disabled'), 'true', '表单打开时 CSV 导出禁用');
    assert.equal(await page.getAttribute('#report-download', 'aria-disabled'), 'true', '表单打开时周报下载禁用');
    assert.equal(await page.isVisible('#export-hint'), true, '表单打开时提示先保存或取消');
    await page.click('#form-cancel');
    assert.equal(await page.getAttribute('#btn-csv', 'aria-disabled'), 'false', '关闭表单后 CSV 导出恢复');
    assert.equal(await page.isVisible('#export-hint'), false);
    // 字段错误贴近控件
    await page.click('#btn-new');
    await page.fill('#f-first', '');
    await page.click('#form-save');
    assert.equal(await page.isVisible('#f-name-error'), true, '姓名为空时错误显示在姓名框旁');
    assert.equal(await page.getAttribute('#f-name', 'aria-describedby'), 'f-name-error');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'f-name', '提交失败后焦点回到第一个出错控件');
    assert.equal(await page.isVisible('#f-first-error'), true, '日期为空时错误显示在日期框旁');
    await page.click('#form-cancel');
    // 删除线索确认写明关联
    await page.locator('details[data-stage="已报价"] .card').first().locator('[data-act="edit"]').click();
    await page.click('#form-delete');
    assert.match(await page.textContent('#delete-text'), /阶段记录和 \d+ 条联系事件会一并删除/, '删除确认写明阶段记录与联系事件一并删除');
    const cardsBeforeDel = await page.locator('.card').count();
    await page.click('#delete-no');
    await page.click('#form-cancel');
    assert.equal(await page.locator('.card').count(), cardsBeforeDel, '取消删除后线索数不变');
    // 替换确认 + 导入
    await page.click('#btn-sample');
    assert.equal(await page.isVisible('#replace-confirm'), true, '已有数据时点「载入合成示例」先出现替换确认');
    assert.match(await page.textContent('#replace-text'), /14 条线索/, '替换确认写明数量');
    await page.click('#replace-no');
    assert.equal(await page.locator('.card').count(), cardsBeforeDel, '取消替换后数据不变');
    const badFile = path.join(DIR, 'screenshots', '.tmp-bad.json');
    fs.writeFileSync(badFile, JSON.stringify({ leads: [], n: 99 }));
    await page.setInputFiles('#file-import', badFile);
    await page.waitForSelector('#import-error:not([hidden])');
    assert.match(await page.textContent('#import-error'), /现有数据没有改动/, '非法备份整份拒绝并说明');
    assert.equal(await page.isVisible('#replace-confirm'), false);
    await page.fill('#n-input', '4');
    await page.locator('#n-input').dispatchEvent('change');
    await page.setInputFiles('#file-import', jsonPath);
    await page.waitForSelector('#replace-confirm:not([hidden])');
    assert.match(await page.textContent('#replace-text'), /超期阈值 9 天/, '导入确认预览备份里的数量与阈值');
    await page.click('#replace-yes');
    assert.equal(await page.inputValue('#n-input'), '9', '导入后恢复备份里的超期天数');
    assert.equal(await page.isVisible('#sample-badge'), true, '备份里的示例标记被保留');
    fs.unlinkSync(badFile); fs.unlinkSync(jsonPath);
    // 清空后示例标记消失
    await page.click('#btn-clear');
    await page.click('#clear-yes');
    assert.equal(await page.isVisible('#sample-badge'), false, '清空后合成示例标记消失');
    await page.click('#btn-sample');
    assert.equal(await page.isVisible('#replace-confirm'), true, '没有线索但超期天数偏离默认值时,载入示例仍需确认');
    assert.match(await page.textContent('#replace-text'), /0 条线索、超期阈值 9 天/, '确认文案写明将替换的阈值设置');
    await page.click('#replace-yes');
    assert.equal(await page.inputValue('#n-input'), '3', '确认后载入示例并重置阈值为默认 3 天');
    await dctx.close();

    /* ---------- 存储失败:必须出现持续可见的未保存提示 ---------- */
    const fctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const fp = await fctx.newPage();
    watch(fp, '存储失败');
    await fp.addInitScript(() => { Storage.prototype.setItem = function () { throw new Error('quota'); }; });
    await fp.goto(URL_INDEX + '&x=1');
    assert.equal(await fp.isVisible('#save-warning'), false, '写入前不应显示未保存提示');
    await fp.click('#btn-sample');
    assert.equal(await fp.isVisible('#save-warning'), true, '存储失败时应显示未保存提示');
    assert.match(await fp.textContent('#status'), /尚未写入浏览器存储/);
    assert.match(await fp.textContent('#save-warning'), /JSON 备份/);
    await fctx.close();
    results.push('存储失败提示 OK');

    /* ---------- 平板窄屏 ---------- */
    const tctx = await browser.newContext({ viewport: { width: 768, height: 900 }, deviceScaleFactor: 1 });
    const tp = await tctx.newPage();
    watch(tp, '平板窄屏');
    await tp.goto(URL_INDEX + '&tablet=1');
    await tp.click('#empty-sample');
    await noOverflow(tp, '平板-768');
    await tp.locator('details[data-stage="咨询中"] .card').first().locator('[data-act="contact"]').click();
    assert.equal(await tp.isVisible('#contact-panel'), true);
    await noOverflow(tp, '平板-联系表单');
    await tctx.close();

    /* ---------- 手机 ---------- */
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const m = await mctx.newPage();
    watch(m, '手机');
    await m.goto(URL_INDEX);
    await m.click('#empty-sample');
    assert.equal(await m.locator('.card').count(), 14);
    const lefts = await m.evaluate(() => Array.from(document.querySelectorAll('#board > details')).map((d) => Math.round(d.getBoundingClientRect().left)));
    assert.ok(lefts.every((x) => x === lefts[0]), '手机端各阶段列应纵向堆叠,left 值: ' + lefts.join(','));
    await m.click('#btn-report');
    await noOverflow(m, '手机');
    const smallBtns = await m.evaluate(() => Array.from(document.querySelectorAll('button')).filter((b) => b.offsetParent && b.getBoundingClientRect().height < 36).map((b) => b.id || b.textContent));
    assert.equal(smallBtns.length, 0, '手机端可见按钮高度均 >= 36px,不足:' + smallBtns.join(','));
    await m.evaluate(() => window.scrollTo(0, 0));
    await m.screenshot({ path: SHOT('04-手机.png'), fullPage: true });
    await mctx.close();

    /* ---------- 展示图 ---------- */
    const sctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    const s = await sctx.newPage();
    watch(s, '展示页');
    await s.goto(URL_SHOWCASE);
    await s.waitForLoadState('load');
    await s.screenshot({ path: path.join(DIR, 'showcase.png'), fullPage: true });
    await sctx.close();
  } catch (e) {
    problems.push('断言/流程失败: ' + (e && e.message ? e.message : e));
  } finally {
    await browser.close();
  }
  results.forEach((r) => console.log(r));
  if (problems.length) {
    problems.forEach((p) => console.error('PROBLEM: ' + p));
    process.exit(1);
  }
  console.log('shots OK');
})();
