'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const URL_INDEX = 'file://' + encodeURI(path.join(__dirname, 'index.html'));
const URL_SHOWCASE = 'file://' + encodeURI(path.join(__dirname, 'showcase.html'));
const SHOTS = path.join(__dirname, 'screenshots');

const problems = [];
const results = [];
let assertions = 0;
function check(cond, msg) {
  assertions += 1;
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
async function stat(page, label) {
  return (await page.locator('#summary .stat').filter({ hasText: label }).first().locator('.stat__value').textContent()).trim();
}
async function download(page, selector) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(selector)]);
  const p = path.join(SHOTS, '.tmp-' + Date.now());
  await dl.saveAs(p);
  const text = fs.readFileSync(p, 'utf8');
  fs.unlinkSync(p);
  return { name: dl.suggestedFilename(), text };
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
    check(await page.isHidden('#results'), '空状态不显示结果区');
    await overflow(page, '桌面-空状态');
    await page.screenshot({ path: path.join(SHOTS, '01-空状态-桌面.png') });

    check(await page.isVisible('#sample-badge') === false, '空状态不显示合成示例标记');
    await page.click('#btn-sample-2');
    check(await page.isVisible('#sample-badge'), '载入示例后持续显示「合成示例」标记');
    check((await page.textContent('#summary-note')).includes('同一订单号有多行时每行分别计数') && (await page.textContent('#summary')).includes('订单金额合计(元)'), '汇总旁写明行数口径与金额单位(元)');
    check((await page.textContent('#flash')).includes('合成示例'), '载入示例后提示合成示例');
    check(await page.isHidden('#empty-guide'), '载入示例后引导隐藏');
    check((await page.inputValue('#invoices-col-orderNo')) === '1', '发票表订单号列自动猜为第 2 列');
    check((await page.inputValue('#invoices-col-amount')) === '6', '发票表「不含税金额」猜为金额列');
    check((await page.textContent('#orders-info')).includes('制表符') && (await page.textContent('#invoices-info')).includes('逗号'), '订单表识别为制表符、发票表识别为逗号');
    check((await stat(page, '订单行数')) === '12' && (await stat(page, '发票行数')) === '13', '订单 12 行、发票 13 行');
    check((await stat(page, '已配对')) === '11', '已配对 11 对');
    check((await stat(page, '阻断')) === '6', '阻断 6 条');
    check((await stat(page, '警告')) === '4', '警告 4 条');
    check((await stat(page, '差额')).includes('4,497.96'), '差额 -4,497.96');
    const issueText = await page.textContent('#issue-list');
    for (const k of ['金额差超容差', '数量不一致', '单价不一致', '发票号重复', '订单表中不存在该订单号', '发票行多于订单行', '税额偏差超容差', '订单无对应发票', '品名不一致', '发票与订单金额合计不等']) {
      check(issueText.includes(k), `待复核清单含「${k}」`);
    }
    check(!issueText.includes('USB键盘'), '半角/全角品名差异不被误报');
    check(await page.locator('#ok-list').isHidden(), '一致配对默认折叠');
    await overflow(page, '桌面-核对结果');
    await page.evaluate(() => document.getElementById('results').scrollIntoView());
    await page.screenshot({ path: path.join(SHOTS, '02-核心流程-桌面.png') });

    // 过滤与折叠
    await page.selectOption('#issue-filter', 'block');
    check((await page.locator('#issue-list tbody tr').count()) === 6, '只看阻断显示 6 行');
    await page.selectOption('#issue-filter', 'warn');
    check((await page.locator('#issue-list tbody tr').count()) === 4, '只看警告显示 4 行');
    await page.selectOption('#issue-filter', 'all');
    await page.click('#ok-summary');
    check(await page.isVisible('#ok-list'), '展开后显示一致配对');
    check((await page.locator('#ok-list tbody tr').count()) === 5, '一致配对 5 对(11 对 - 6 对有问题)');

    // 改参数:导出前状态与界面一致
    await page.fill('#p-tolabs', '5');
    check((await stat(page, '阻断')) === '5', '金额容差改为 5 后金额差一条消失(阻断 5)');
    await page.fill('#p-tax', '');
    check((await stat(page, '警告')) === '3', '税率留空后税额警告消失(警告 3)');
    await page.fill('#p-tolabs', 'abc');
    check(await page.isVisible('#param-error') && (await page.getAttribute('#p-tolabs', 'aria-invalid')) === 'true' && (await page.getAttribute('#p-tolabs', 'aria-describedby')) === 'param-error', '非法容差显示参数错误,并在出错输入上标记 aria-invalid 且 aria-describedby 关联');
    check(await page.isDisabled('#btn-export-review-csv') && await page.isDisabled('#btn-export-pairs-csv') && await page.isDisabled('#btn-export-review-md'), '参数非法时三个导出按钮禁用');
    await page.fill('#p-tolabs', '0.01');
    await page.fill('#p-tax', '13');
    check((await stat(page, '阻断')) === '6' && (await stat(page, '警告')) === '4', '参数还原后结果还原');

    // 改列映射
    await page.selectOption('#invoices-col-amount', '-1');
    check((await page.textContent('#result-error')).includes('必选列') && await page.isDisabled('#btn-export-review-md'), '取消必选列后提示并禁用导出');
    await page.selectOption('#invoices-col-amount', '6');
    check(await page.isEnabled('#btn-export-review-md'), '恢复必选列后导出可用');

    // 严格匹配
    await page.check('#p-byname');
    check(Number(await stat(page, '已配对')) === 10, '严格按订单号+品名:无线鼠标/鼠标不再配对,已配对 10');
    await page.uncheck('#p-byname');
    check((await stat(page, '已配对')) === '11', '取消严格匹配后恢复 11');

    // 导出
    const d1 = await download(page, '#btn-export-review-csv');
    check(d1.name.endsWith('.csv') && d1.text.includes('级别,类别,订单号,发票号,订单表行号,发票表行号,说明,金额容差(元),百分比容差(%),税率期望值(%),匹配模式,数据来源') && d1.text.includes('合成示例') && d1.text.includes(',0.01,0.5,13,订单号,合成示例') && d1.text.includes('发票号重复') && d1.text.split('\n').length >= 11, '待复核清单 CSV 含表头与 10 条问题');
    const d2 = await download(page, '#btn-export-review-md');
    check(d2.name.endsWith('.md') && d2.text.includes('数据来源:合成示例') && d2.text.includes('## 核对参数') && d2.text.includes('金额容差(绝对值):0.01') && d2.text.includes('## 阻断(6)') && d2.text.includes('## 警告(4)'), '待复核清单 Markdown 含参数与阻断/警告');
    const d3 = await download(page, '#btn-export-pairs-csv');
    check(d3.name.endsWith('.csv') && d3.text.includes('状态,订单号,发票号') && d3.text.split('\n').filter(Boolean).length === 1 + 11 + 1 + 2, '全部配对结果 CSV = 表头 + 11 配对 + 1 无发票订单 + 2 无订单发票');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(SHOTS, '03-结果与导出-桌面.png'), fullPage: true });

    // 公式注入防护 + 文件选择
    const csvFile = '订单号,金额\n=EVIL(1),10\n@sum,5\n';
    await page.setInputFiles('#orders-file', { name: 'orders.csv', mimeType: 'text/csv', buffer: Buffer.from(csvFile, 'utf8') });
    await page.waitForFunction(() => document.getElementById('orders-info').textContent.includes('已识别 2 行'));
    check(true, '通过文件选择读取订单表');
    await page.fill('#invoices-text', '发票号,订单号,金额\nI-1,=EVIL(1),10\nI-2,@sum,9');
    check(await page.isHidden('#sample-badge'), '改动表格后合成示例标记消失');
    check((await stat(page, '已配对')) === '2', '自定义两张小表配对 2 对');
    const d4 = await download(page, '#btn-export-pairs-csv');
    check(d4.text.includes("'=EVIL(1)") && d4.text.includes("'@sum") && !/(^|,)=EVIL/m.test(d4.text), '导出 CSV 对 = 和 @ 开头字段加单引号前缀');
    const d5 = await download(page, '#btn-export-review-md');
    check(d5.text.includes("'@sum") && !/\| @sum/.test(d5.text), 'Markdown 对 @ 开头字段加单引号前缀');

    // 解析错误:拒绝核对并禁用导出
    await page.fill('#orders-text', '订单号,金额\nPO1,1,234');
    check((await page.textContent('#result-error')).includes('第 2 行有 3 列') && await page.isDisabled('#btn-export-review-csv') && await page.isDisabled('#btn-export-pairs-csv'), '列数不一致时拒绝核对并禁用导出');
    await page.fill('#orders-text', '订单号,金额\nPO1,"100');
    await page.fill('#invoices-text', '发票号,订单号,金额\nI1,PO1,100');
    check((await page.textContent('#result-error')).includes('解析错误') && await page.isDisabled('#btn-export-review-md'), '引号未闭合时拒绝核对并禁用导出');
    // 其余:窄输入的溢出、清空确认
    await overflow(page, '桌面-自定义表');
    // 载入示例前先确认:已有数据时给出替换范围,取消后原数据不变
    await page.click('#btn-sample');
    check(await page.isVisible('#sample-confirm') && (await page.textContent('#sample-scope')).includes('订单表') && (await page.textContent('#sample-scope')).includes('发票表'), '已有数据时载入示例先出现页内确认并写明替换范围');
    check((await page.inputValue('#invoices-text')).includes('I1,PO1'), '确认前原数据不变');
    await page.click('#btn-sample-no');
    check(await page.isHidden('#sample-confirm') && (await page.inputValue('#invoices-text')).includes('I1,PO1'), '取消载入示例后保留原数据');
    await page.fill('#p-tolabs', '0.5');
    await page.click('#btn-clear');
    check(await page.isVisible('#clear-confirm') && (await page.textContent('#btn-clear')) === '清空数据' && (await page.textContent('#clear-scope')).includes('核对参数'), '清空前出现页内确认区,按钮叫「清空数据」并写明含核对参数');
    await page.click('#btn-clear-yes');
    check(await page.isVisible('#empty-guide') && (await page.inputValue('#orders-text')) === '', '清空后回到空状态');
    await ctx.close();

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
    check((await stat(f, '阻断')) === '6', '存储失败时核对功能仍可用');
    await fctx.close();

    /* ---------- 重新打开页面:参数与示例状态来自 localStorage ---------- */
    const pctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pp = await pctx.newPage();
    watch(pp, 'persist');
    await pp.goto(URL_INDEX);
    await pp.click('#btn-sample-2');
    await pp.fill('#p-tolabs', '0.5');
    await pp.reload();
    check((await pp.inputValue('#p-tolabs')) === '0.5' && (await stat(pp, '订单行数')) === '12' && await pp.isVisible('#sample-badge'), '刷新后恢复参数、示例与「合成示例」标记');
    // 仅改了参数也算用户数据:载入示例前要确认
    await pp.click('#btn-sample');
    check(await pp.isVisible('#sample-confirm') && (await pp.textContent('#sample-scope')).includes('已修改的核对参数'), '只改了参数时载入示例也要确认');
    await pp.click('#btn-sample-yes');
    check((await pp.inputValue('#p-tolabs')) === '0.01', '确认后参数重置为默认');
    await pctx.close();

    /* ---------- 手机 ---------- */
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const m = await mctx.newPage();
    watch(m, 'mobile');
    await m.goto(URL_INDEX);
    await overflow(m, '手机-空状态');
    const cb = await m.evaluate(() => { const r = document.getElementById('p-byname').getBoundingClientRect(); return { w: r.width, h: r.height }; });
    check(cb.w >= 24 && cb.h >= 24, `手机端 checkbox 视觉尺寸 >= 24(${cb.w}x${cb.h})`);
    await m.click('#btn-sample-2');
    await overflow(m, '手机-核对结果');
    await m.click('#ok-summary');
    await overflow(m, '手机-展开一致配对');
    const stacked = await m.evaluate(() => {
      const th = document.querySelector('#issue-list .data-table thead');
      const td = document.querySelector('#issue-list .data-table tbody td');
      return { head: getComputedStyle(th).display, cell: getComputedStyle(td).display };
    });
    check(stacked.head === 'none' && stacked.cell === 'grid', `手机端表格堆叠成卡片(thead=${stacked.head}, td=${stacked.cell})`);
    await m.screenshot({ path: path.join(SHOTS, '04-手机.png'), fullPage: true });
    await mctx.close();

    /* ---------- 展示图 ---------- */
    const sctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    const s = await sctx.newPage();
    watch(s, 'showcase');
    await s.goto(URL_SHOWCASE);
    await s.waitForLoadState('load');
    const imgs = await s.evaluate(() => Array.from(document.images).map((i) => i.complete && i.naturalWidth > 0));
    check(imgs.length >= 3 && imgs.every(Boolean), `展示页 ${imgs.length} 张截图全部加载`);
    await overflow(s, '展示页');
    await s.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
    await sctx.close();
  } catch (e) {
    problems.push('脚本异常:' + (e && e.stack || e));
  } finally {
    await browser.close();
  }
  console.log('\n' + results.join('\n'));
  console.log(`\n断言总数:${assertions}`);
  if (problems.length) {
    console.error('\n共 ' + problems.length + ' 个问题:\n' + problems.join('\n'));
    process.exit(1);
  }
  console.log('\n全部通过');
})();
