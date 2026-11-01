'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const C = require('./core.js');
globalThis.LedgerCore = C;
require('./sample-data.js');

const FALLBACK_EXE = process.env.CHROME_PATH || undefined;
const BASE = 'file://' + encodeURI(path.join(__dirname, 'index.html'));
const URL_INDEX = BASE + '?today=2026-10-20';
const URL_SHOWCASE = 'file://' + encodeURI(path.join(__dirname, 'showcase.html'));
const SHOTS = path.join(__dirname, 'screenshots');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ledger-shots-'));

const problems = [];
const results = [];
let asserts = 0;
function check(cond, msg) {
  asserts++;
  if (!cond) { problems.push('断言失败:' + msg); console.error('FAIL', msg); } else { console.log('ok  ', msg); }
}
function watch(page, tagName) {
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`[${tagName}] console error: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[${tagName}] pageerror: ${e.message}`));
}
async function overflow(page, label) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  results.push(`${label}: scrollWidth=${r.sw} innerWidth=${r.iw}`);
  check(r.sw <= r.iw, `${label} scrollWidth(${r.sw}) <= innerWidth(${r.iw})`);
}
async function tab(page, name) { await page.click(`.tab[data-view="${name}"]`); }
async function text(page, sel) { return (await page.textContent(sel)) || ''; }
async function download(page, sel, name) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(sel)]);
  const p = path.join(TMP, name);
  await dl.saveAs(p);
  return { name: dl.suggestedFilename(), body: fs.readFileSync(p, 'utf8'), path: p };
}
async function stored(page) {
  return page.evaluate(() => { const r = localStorage.getItem('aiLedger.v2') || localStorage.getItem('aiLedger.v1'); return r ? JSON.parse(r) : null; });
}
function localToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
async function addSub(page, o) {
  await tab(page, 'subs');
  await page.fill('#f-name', o.name);
  await page.fill('#f-tier', o.tier || '');
  await page.selectOption('#f-currency', o.currency || 'USD');
  await page.fill('#f-amount', o.amount);
  await page.selectOption('#f-period', o.period || 'monthly');
  await page.fill('#f-start', o.start || '2026-10-01');
  await page.selectOption('#f-tag', o.tag || '编码');
  await page.click('#btn-sub-save');
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  let browser;
  try { browser = await chromium.launch(); }
  catch (e) { browser = await chromium.launch({ executablePath: FALLBACK_EXE }); }
  try {
    const expected = globalThis.LedgerSample.build('2026-10-20');
    const sm = C.summarizeMonth(expected.subs, expected.outputs, '2026-10', expected.settings.fx, expected.settings.wage);

    /* ---------- 桌面主流程 ---------- */
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
    const page = await ctx.newPage();
    watch(page, 'desktop');
    await page.goto(URL_INDEX);
    check(await page.isVisible('#empty-guide'), '空状态显示引导');
    check((await text(page, '#today-label')) === '2026-10-20', '?today=2026-10-20 生效');
    await overflow(page, '桌面-空状态');
    await page.screenshot({ path: path.join(SHOTS, '01-空状态-桌面.png') });

    await page.click('#btn-sample-2');
    check(!(await page.isVisible('#confirm-box')), '空账本载入示例不需要确认');
    check((await text(page, '#flash')).includes('合成示例'), '载入示例后提示合成示例');
    check(await page.isVisible('#sample-badge'), '示例数据显示「合成示例,金额虚构」横幅');
    const ov = await text(page, '#ov-body');
    check(ov.includes('USD 月成本') && ov.includes('422.50'), '总览 USD 月成本 422.50');
    check(ov.includes('CNY 月成本') && ov.includes('189.92'), '总览 CNY 月成本 189.92(年付折月 140.00 + 买断摊销 49.92)');
    check(ov.includes('估算合计(估算)') && ov.includes('3,231.92'), '总览估算合计 CNY 3,231.92 并标注估算');
    check(ov.includes('小时当量(自估)') && ov.includes('91'), '总览小时当量 91');
    check(ov.includes('每小时当量成本(估算)') && ov.includes(C.formatMoney(sm.perHourEstimate.cents, true)) && ov.includes('低于机会成本时薪'), '多币种时给估算的每小时当量成本并与时薪比较');
    const alertText = await text(page, '.alert-list');
    check((await page.locator('.alert-item').count()) === 4, '提醒共 4 条(2 续费 + 1 暂停 + 1 重叠)');
    check(alertText.includes('3 天后续费') && alertText.includes('7 天后续费'), '续费提醒含 3 天与恰好 7 天');
    check(alertText.includes('考虑暂停') && alertText.includes('图像'), '连续 2 个月产出为 0 -> 考虑暂停');
    check(alertText.includes('可能重叠') && alertText.includes('编码'), '同用途 3 个订阅 -> 重叠');
    const tagTable = await text(page, '#ov-body .data-table');
    check(tagTable.includes('产出为 0') && tagTable.includes('高于时薪') && tagTable.includes('低于时薪'), '各用途表含 产出为 0 / 高于时薪 / 低于时薪');
    check((await text(page, '#ov-body')).includes('本月 vs 上月'), '总览含本月 vs 上月');
    await overflow(page, '桌面-总览');
    await page.screenshot({ path: path.join(SHOTS, '02-核心流程-桌面.png'), fullPage: true });

    // 设置未应用时月报导出禁用
    await page.fill('#fx-rate', '8');
    check(await page.isVisible('#settings-dirty'), '汇率改动未应用时显示提示');
    await tab(page, 'export');
    check(await page.isDisabled('#btn-export-md') && await page.isVisible('#export-hint'), '设置未应用时月报导出被禁用并提示');
    await tab(page, 'overview');
    await page.click('#form-settings button[type="submit"]');
    check(!(await page.isVisible('#settings-dirty')), '应用设置后提示消失');
    check((await text(page, '#ov-body')).includes('3,569.92'), '汇率 8 应用后估算合计 3,569.92(189.92 + 422.50 x 8)');
    await page.fill('#fx-rate', '7.2');
    await page.click('#form-settings button[type="submit"]');
    check((await text(page, '#ov-body')).includes('3,231.92'), '汇率改回 7.2 后估算合计恢复');

    // 汇率未覆盖的币种:不给总体每小时成本与时薪结论
    await page.fill('#fx-from', 'GBP');
    await page.click('#form-settings button[type="submit"]');
    const ovMiss = await text(page, '#ov-body');
    check(ovMiss.includes('没有折算汇率') && ovMiss.includes('USD') && !ovMiss.includes('每小时当量成本(估算)') && !ovMiss.includes('低于机会成本时薪'), '汇率未覆盖 USD 时不输出总体每小时成本与时薪结论,并显示缺失币种');
    await page.fill('#fx-from', 'USD');
    await page.click('#form-settings button[type="submit"]');
    check((await text(page, '#ov-body')).includes('每小时当量成本(估算)'), '恢复汇率后重新给出估算比值');

    // 订阅:非法与合法录入
    await tab(page, 'subs');
    check((await page.locator('#subs-table tbody tr').count()) === 9, '订阅表 9 行');
    check((await page.locator('#subs-table tr.is-muted').count()) === 1, '暂停订阅行置灰');
    await page.fill('#f-name', '半成品');
    await page.fill('#f-amount', 'abc');
    await page.click('#btn-sub-save');
    check(await page.isVisible('#sub-error') && (await page.locator('#subs-table tbody tr').count()) === 9, '金额非法时给出错误且不新增');
    await page.click('#btn-sub-reset');
    await addSub(page, { name: '测试按量', period: 'usage', amount: '0', start: '2026-01-01', tag: '其他' });
    check((await page.locator('#subs-table tbody tr').count()) === 10, '添加按量订阅后 10 行');
    check((await text(page, '#flash')).includes('已添加订阅'), '保存成功后才显示成功提示');
    await tab(page, 'overview');
    check((await text(page, '#ov-body')).includes('测试按量'), '总览提示按量订阅本月未记账单');
    await tab(page, 'subs');
    await page.selectOption('#b-sub', { label: '测试按量(USD)' });
    await page.fill('#b-month', '2026-10');
    await page.fill('#b-amount', '10');
    await page.click('#btn-bill-save');
    check((await text(page, '#bills-table')).includes('USD 10.00'), '按量账单记入后出现在账单表');
    await tab(page, 'overview');
    check((await text(page, '#ov-body')).includes('432.50'), '按量账单计入当月 USD 成本 432.50');

    // 产出:同月同用途更新
    await tab(page, 'outputs');
    const before = await page.locator('#outputs-table tbody tr').count();
    await page.fill('#o-month', '2026-10');
    await page.selectOption('#o-tag', '写作');
    await page.fill('#o-hours', '20');
    await page.fill('#o-evidence', '更新后的证据');
    await page.click('#btn-out-save');
    check((await text(page, '#flash')).includes('已更新') && (await page.locator('#outputs-table tbody tr').count()) === before, '同月同用途再提交是更新而不是新增');
    // 编辑产出:按原记录 ID 更新,冲突时页内提示不覆盖
    const rowOf = () => page.locator('#outputs-table tbody tr', { hasText: '2026-10' }).filter({ hasText: '写作' });
    await rowOf().getByRole('button', { name: '编辑' }).click();
    await page.fill('#o-month', '2026-09');
    await page.click('#btn-out-save');
    check(await page.isVisible('#output-error') && (await text(page, '#output-error')).includes('已有另一条记录'), '编辑后的月份+用途与已有记录冲突时页内提示');
    check((await page.locator('#outputs-table tbody tr').count()) === before && (await stored(page)).outputs.filter((o) => o.month === '2026-09' && o.tag === '写作')[0].hours === 17, '冲突时没有覆盖目标记录,也没有新增');
    await page.fill('#o-month', '2026-11');
    await page.click('#btn-out-save');
    const outs = (await stored(page)).outputs;
    check(outs.length === before && outs.some((o) => o.month === '2026-11' && o.tag === '写作') && !outs.some((o) => o.month === '2026-10' && o.tag === '写作'), '编辑改月份后按原 ID 更新:总数不变且原月份记录不再残留');
    await page.fill('#o-month', '2026-10');
    await page.selectOption('#o-tag', '写作');
    await page.fill('#o-hours', '20');
    await page.click('#btn-out-save');
    await page.fill('#o-hours', '-3');
    await page.click('#btn-out-save');
    check(await page.isVisible('#output-error'), '负的小时当量被拒绝');
    await tab(page, 'overview');
    check((await text(page, '#ov-body')).includes('93'), '总览小时当量为 93(编辑改月份后又补回 2026-10 写作 20 小时)');

    // 月度摊销成本快照：主动确认后冻结；后续暂停订阅不改历史
    await tab(page, 'snapshots');
    await page.fill('#snap-month', '2026-10');
    await page.fill('#snap-date', '2026-10-20');
    await page.fill('#snap-source', '合成示例账单逐项核对');
    await page.fill('#snap-note', '浏览器验收用合成快照');
    check((await text(page, '#snapshot-preview')).includes('432.50'), '保存前预览待确认成本 USD 432.50');
    await page.click('#btn-snapshot-save');
    const frozen = await stored(page);
    check(frozen.version === 2 && frozen.snapshots.length === 1 && frozen.snapshots[0].items.length > 0, '快照保存到 v2 备份，包含订阅身份明细');
    check((await text(page, '#snapshots-table')).includes('合成示例账单逐项核对'), '历史快照表显示确认来源');
    await page.screenshot({ path: path.join(SHOTS, '05-成本快照-桌面.png'), fullPage: true });
    const frozenUsd = C.snapshotTotals(frozen.snapshots[0]).byCurrency.find((x) => x.currency === 'USD').cents;
    await tab(page, 'subs');
    const usageRow = page.locator('#subs-table tbody tr', { hasText: '测试按量' });
    await usageRow.getByRole('button', { name: '编辑' }).click();
    await page.selectOption('#f-status', 'paused');
    await page.click('#btn-sub-save');
    const afterPause = await stored(page);
    check(C.snapshotTotals(afterPause.snapshots[0]).byCurrency.find((x) => x.currency === 'USD').cents === frozenUsd, '暂停订阅后已确认快照金额保持不变');
    await tab(page, 'overview');
    check((await text(page, '#ov-body')).includes('用户确认的月度成本快照') && (await text(page, '#ov-body')).includes('432.50'), '总览优先显示已确认快照，不随当前状态改写');

    // 趋势
    await tab(page, 'trend');
    check((await page.locator('.chart__bar').count()) === 12, '趋势图 12 根柱');
    const heights = await page.$$eval('.chart__bar', (els) => els.map((e) => e.style.height));
    check(heights.some((h) => parseFloat(h) > 0), '柱高度来自运行时数据');
    check((await page.locator('.chart__dot').count()) >= 6 && (await page.locator('.chart__segment').count()) >= 5, '折线有点和线段');
    check((await page.locator('#chart-cur option').allTextContents()).some((t) => t.includes('估算')), '币种选择含估算合计');
    await page.selectOption('#chart-cur', 'CNY');
    check((await text(page, '.chart__legend')).includes('CNY'), '切换柱子币种');
    await overflow(page, '桌面-趋势');

    // 导出
    await tab(page, 'export');
    check((await page.inputValue('#md-preview')).includes('# AI 订阅成本月报 2026-10'), '月报预览含标题');
    const md = await download(page, '#btn-export-md', 'report.md');
    check(md.name.endsWith('.md') && md.body.includes('估算') && md.body.includes('用户确认的月度成本快照') && md.body.includes('不是实付账单') && md.body.includes('合成示例账单逐项核对') && md.body.includes('考虑暂停'), '月报 Markdown 含快照口径、确认来源、估算与提醒');
    const csv = await download(page, '#btn-export-csv', 'subs.csv');
    check(csv.body.includes('服务名,档位,币种,金额,周期') && csv.body.split('\n').length >= 11, '订阅表 CSV 含表头与 10 条订阅');
    const js = await download(page, '#btn-export-json', 'backup.json');
    const jsCheck = C.validateImport(js.body);
    check(jsCheck.ok && jsCheck.data.subs.length === 10 && jsCheck.data.snapshots.length === 1, 'JSON 备份能通过 validateImport，含 10 个订阅和 1 份快照');
    await overflow(page, '桌面-导出');
    await page.screenshot({ path: path.join(SHOTS, '03-结果与导出-桌面.png'), fullPage: true });

    // 载入示例不得无确认覆盖
    await page.click('#btn-sample');
    check(await page.isVisible('#confirm-box') && (await text(page, '#confirm-text')).includes('替换'), '已有数据时载入示例先出现页内替换确认');
    check((await stored(page)).subs.length === 10, '确认前原数据保持不变(10 个订阅)');
    await page.click('#btn-confirm-no');
    check(!(await page.isVisible('#confirm-box')) && (await stored(page)).subs.length === 10, '取消后原数据仍在');
    await page.click('#btn-sample');
    await page.click('#btn-confirm-yes');
    await tab(page, 'subs');
    check((await page.locator('#subs-table tbody tr').count()) === 9 && (await stored(page)).subs.length === 9, '确认后才替换为 9 个示例订阅');

    // 导入:非法整份拒绝,合法需确认
    const bad = { version: 1, subs: [Object.assign({}, expected.subs[0], { period: 'weekly' })], outputs: [] };
    await page.setInputFiles('#file-import', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
    await page.waitForSelector('#import-error:not([hidden])');
    check((await text(page, '#import-error-text')).includes('周期') && (await stored(page)).subs.length === 9, '周期枚举非法时整份拒绝并给原因,数据未变');
    const dup = { version: 1, subs: [expected.subs[0], expected.subs[0]], outputs: [] };
    await page.setInputFiles('#file-import', { name: 'dup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(dup)) });
    await page.waitForFunction(() => document.getElementById('import-error-text').textContent.includes('重复'));
    check(true, 'ID 重复时整份拒绝');
    const url = { version: 1, subs: [Object.assign({}, expected.subs[0], { startDate: '2026-02-30' })], outputs: [] };
    await page.setInputFiles('#file-import', { name: 'date.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(url)) });
    await page.waitForFunction(() => document.getElementById('import-error-text').textContent.includes('日期'));
    check((await stored(page)).subs.length === 9, '不存在的日期整份拒绝,数据未变');
    await page.click('#btn-import-error-close');
    await page.setInputFiles('#file-import', js.path);
    await page.waitForSelector('#confirm-box:not([hidden])');
    check((await stored(page)).subs.length === 9, '导入合法文件前先确认,确认前数据不变');
    await page.click('#btn-confirm-yes');
    check((await stored(page)).subs.length === 10, '确认后导入 10 个订阅');

    // 第五轮:删除月账单 / 产出先页内确认;状态与趋势旁说明历史成本口径;导入入口是按钮
    await tab(page, 'subs');
    check((await text(page, '#f-status-hint')).includes('没有快照的月份按当前状态重算') && (await text(page, '#f-status-hint')).includes('快照不会变化') && await page.isVisible('#f-status-hint'), '状态控件旁区分当前状态推算与冻结快照');
    const billRows = await page.locator('#bills-table tbody tr').count();
    check(billRows >= 1, `按量订阅有月账单(${billRows} 条)`);
    const billsBefore = (await stored(page)).subs.reduce((n, x) => n + Object.keys(x.usageBills || {}).length, 0);
    await page.locator('#bills-table button:has-text("删除")').first().click();
    const bt = await text(page, '#confirm-text');
    check(await page.isVisible('#confirm-box') && bt.includes('月账单') && /\d{4}-\d{2}/.test(bt), '删除月账单先出现页内确认并写明订阅、月份和金额');
    check((await stored(page)).subs.reduce((n, x) => n + Object.keys(x.usageBills || {}).length, 0) === billsBefore, '确认之前账单数不变');
    await page.click('#btn-confirm-no');
    check(await page.evaluate(() => document.activeElement && document.activeElement.textContent === '删除'), '取消后焦点回到原删除按钮');
    await page.locator('#bills-table button:has-text("删除")').first().click();
    await page.click('#btn-confirm-yes');
    check((await stored(page)).subs.reduce((n, x) => n + Object.keys(x.usageBills || {}).length, 0) === billsBefore - 1, '确认后账单减少 1 条');
    await tab(page, 'outputs');
    const outBefore = (await stored(page)).outputs.length;
    await page.locator('#outputs-table button:has-text("删除")').first().click();
    const ot = await text(page, '#confirm-text');
    check(await page.isVisible('#confirm-box') && ot.includes('产出记录') && ot.includes('小时当量'), '删除产出先出现页内确认并写明月份、用途和小时');
    check((await stored(page)).outputs.length === outBefore, '确认之前产出数不变');
    await page.click('#btn-confirm-no');
    check((await stored(page)).outputs.length === outBefore, '取消后产出仍在');
    await page.locator('#outputs-table button:has-text("删除")').first().click();
    await page.click('#btn-confirm-yes');
    check((await stored(page)).outputs.length === outBefore - 1, '确认后产出减少 1 条');
    check((await text(page, '#view-outputs')).includes('记录 AI 完成的工作') && !(await text(page, '#view-outputs')).includes('硅基') && (await text(page, '#view-outputs')).includes('不是你使用 AI 的时长'), '产出页用「AI 完成的工作」并说明小时当量是折合人工小时');
    await tab(page, 'trend');
    check((await text(page, '#view-trend')).includes('已有快照的月份使用已确认成本') && (await text(page, '#trend-table')).includes('成本口径'), '趋势逐月区分快照与当前状态推算');
    await tab(page, 'overview');
    check((await text(page, '#ov-body')).includes('月成本 ÷ 折合人工小时'), '每小时当量成本旁写明「月成本 ÷ 折合人工小时」');
    check((await page.$eval('#btn-pick-import', e => e.tagName)) === 'BUTTON', '导入 JSON 备份入口是 button(可聚焦)');
    await page.focus('#btn-pick-import');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Enter')]);
    check(!!chooser, '按 Enter 可打开备份文件选择');

    // 平板宽度
    await page.setViewportSize({ width: 768, height: 900 });
    for (const v of ['overview', 'subs', 'outputs', 'snapshots', 'trend', 'export']) { await tab(page, v); await overflow(page, '平板-' + v); }
    await page.setViewportSize({ width: 1440, height: 900 });

    // 清空
    await page.click('#btn-clear');
    check(await page.isVisible('#confirm-box'), '清空前出现页内确认区');
    await page.click('#btn-confirm-yes');
    await tab(page, 'overview');
    check(await page.isVisible('#empty-guide') && (await stored(page)).subs.length === 0, '清空后回到空状态');
    await ctx.close();

    /* ---------- ?today 非法值回退 ---------- */
    const tctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const t = await tctx.newPage();
    watch(t, 'today');
    for (const bad2 of ['2026-02-30', 'garbage', '2026-13-01']) {
      await t.goto(BASE + '?today=' + bad2);
      check((await text(t, '#today-label')) === localToday(), `?today=${bad2} 回退真实今天且不报错`);
    }
    await tctx.close();

    /* ---------- 存储写入失败 ---------- */
    const fctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await fctx.addInitScript(() => {
      Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
    });
    const f = await fctx.newPage();
    watch(f, 'storage-fail');
    await f.goto(URL_INDEX);
    await f.click('#btn-sample-2');
    check(await f.isVisible('#save-warning'), '存储写入失败时显示持续可见的「未保存」提示');
    check(!(await f.isVisible('#flash')), '存储写入失败时不显示成功提示');
    check((await text(f, '#save-warning-text')).includes('未保存'), '未保存提示文字明确');
    await fctx.close();

    /* ---------- 边界值保存后 reload 仍在 ---------- */
    const bctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const b = await bctx.newPage();
    watch(b, 'boundary');
    await b.goto(URL_INDEX);
    await b.click('#btn-sample-2');
    const longName = '边'.repeat(C.MAX_TEXT);
    await addSub(b, { name: longName, amount: '9999999999.99', tag: '写作' });
    check((await b.locator('#subs-table tbody tr').count()) === 10 && (await stored(b)).subs.length === 10, '200 字服务名 + 9999999999.99 金额可保存');
    await tab(b, 'outputs');
    await b.fill('#o-month', '2026-08');
    await b.selectOption('#o-tag', '图像');
    await b.fill('#o-hours', '100000');
    await b.fill('#o-evidence', '证'.repeat(C.MAX_EVIDENCE));
    await b.click('#btn-out-save');
    check((await stored(b)).outputs.some((o) => o.hours === 100000 && o.evidence.length === C.MAX_EVIDENCE), '100000 小时与 1000 字证据可保存');
    await b.reload();
    check(!(await b.isVisible('#load-notice')), 'reload 后没有存档校验失败提示');
    await tab(b, 'subs');
    check((await b.locator('#subs-table tbody tr').count()) === 10 && (await text(b, '#subs-table')).includes(longName), 'reload 后边界订阅仍在');
    await tab(b, 'outputs');
    check((await text(b, '#outputs-table')).includes('100000'), 'reload 后边界产出仍在');
    await bctx.close();

    /* ---------- 手机 ---------- */
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const m = await mctx.newPage();
    watch(m, 'mobile');
    await m.goto(URL_INDEX);
    await m.click('#btn-sample-2');
    await overflow(m, '手机-总览');
    const stacked = await m.evaluate(() => {
      const th = document.querySelector('.data-table thead');
      const td = document.querySelector('.data-table tbody td');
      return { head: getComputedStyle(th).display, cell: getComputedStyle(td).display };
    });
    check(stacked.head === 'none' && stacked.cell === 'grid', `手机端表格堆叠成卡片(thead=${stacked.head}, td=${stacked.cell})`);
    const fonts = await m.evaluate(() => Math.min.apply(null, Array.from(document.querySelectorAll('main p, main td, main label, main button')).filter((e) => e.offsetParent).map((e) => parseFloat(getComputedStyle(e).fontSize))));
    check(fonts >= 16, `正文最小字号 >= 16px(实际 ${fonts})`);
    await m.screenshot({ path: path.join(SHOTS, '04-手机.png'), fullPage: true });
    for (const v of ['subs', 'outputs', 'snapshots', 'trend', 'export']) {
      await tab(m, v); await overflow(m, '手机-' + v);
      if (v === 'snapshots') await m.screenshot({ path: path.join(SHOTS, '06-成本快照-手机.png'), fullPage: true });
    }
    await mctx.close();

    /* ---------- 展示图 ---------- */
    if (fs.existsSync(path.join(__dirname, 'showcase.html'))) {
      const sctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
      const s = await sctx.newPage();
      watch(s, 'showcase');
      await s.goto(URL_SHOWCASE);
      await s.waitForLoadState('load');
      await s.locator('img').evaluateAll(images => Promise.all(images.map(image => { image.loading = 'eager'; return image.decode().catch(() => {}); })));
      const imgs = await s.evaluate(() => Array.from(document.images).map((i) => i.complete && i.naturalWidth > 0));
      check(imgs.length >= 3 && imgs.every(Boolean), `展示页 ${imgs.length} 张截图全部加载`);
      await overflow(s, '展示页');
      await s.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
      await sctx.close();
    } else {
      results.push('展示页:隔离工作副本未包含 showcase.html，未运行展示图检查');
    }
  } catch (e) {
    problems.push('脚本异常:' + (e && e.stack || e));
  } finally {
    await browser.close();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  console.log('\n' + results.join('\n'));
  console.log('断言数:' + asserts);
  if (problems.length) {
    console.error('\n共 ' + problems.length + ' 个问题:\n' + problems.join('\n'));
    process.exit(1);
  }
  console.log('\n全部通过');
})();
