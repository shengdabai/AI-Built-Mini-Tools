'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const URL_INDEX = 'file://' + encodeURI(path.join(__dirname, 'index.html')) + '?today=2026-10-20';
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
async function tab(page, name) { await page.click(`.tab[data-view="${name}"]`); }
async function readDownload(page, clickSelector, tmpName) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(clickSelector)]);
  const p = path.join(SHOTS, tmpName);
  await dl.saveAs(p);
  const text = fs.readFileSync(p, 'utf8');
  fs.unlinkSync(p);
  return { name: dl.suggestedFilename(), text };
}
async function rowCount(page, sel) { return page.locator(sel + ' tbody tr').count(); }

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  let browser;
  try {
    browser = await chromium.launch();
  } catch (e) {
    const fallback = fs.existsSync(process.env.CHROME_PATH || undefined) ? process.env.CHROME_PATH || undefined : EXE;
    browser = await chromium.launch({ executablePath: fallback });
  }
  try {
    /* ---------- 桌面 ---------- */
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    const page = await ctx.newPage();
    watch(page, 'desktop');
    await page.goto(URL_INDEX);
    check(await page.isVisible('#empty-guide'), '空状态显示引导');
    check((await page.textContent('#today-label')) === '2026-10-20', '?today 固定基准日为 2026-10-20');
    check(await page.isDisabled('#btn-aging-md'), '无账单时导出按钮禁用');
    check((await page.textContent('.today-bar')).replace(/\s+/g, '').includes('基准日2026-10-20(由地址参数固定)'), '基准日持续显示并写明由地址参数固定');
    // 没有账单、但改了提醒模板与跟进间隔时,载入示例也要先确认
    await page.click('.tab[data-view="follow"]');
    await page.fill('#fu-n', '3');
    await page.dispatchEvent('#fu-n', 'change');
    await page.click('.tab[data-view="aging"]');
    await page.click('#btn-sample-2');
    check(await page.isVisible('#sample-confirm') && (await page.textContent('#sample-scope')).includes('自定义的提醒模板或跟进间隔'), '没有账单但改过设置时,载入示例先确认并写明会覆盖设置: ' + await page.textContent('#sample-scope'));
    await page.click('#btn-sample-no');
    await page.click('.tab[data-view="follow"]');
    check(await page.inputValue('#fu-n') === '3', '取消后跟进间隔保持 3');
    await page.fill('#fu-n', '7');
    await page.dispatchEvent('#fu-n', 'change');
    await page.click('.tab[data-view="aging"]');
    await overflow(page, '桌面-空状态');
    await page.screenshot({ path: path.join(SHOTS, '01-空状态-桌面.png') });

    // 载入示例与账龄
    await page.click('#btn-sample-2');
    check((await page.textContent('#flash')).includes('合成示例'), '载入示例后提示合成示例');
    check((await page.textContent('#bill-count')) === '10', '示例共 10 张账单');
    check(await page.isVisible('#sample-badge'), '载入示例后持续显示合成示例标记');
    const agingText = await page.textContent('#aging-out');
    check(agingText.includes('CNY') && agingText.includes('USD'), '账龄按 CNY / USD 分开汇总');
    check(agingText.includes('12,000.00') && agingText.includes('逾期 90 天以上'), '逾期 95 天的 12,000.00 落在 90 天以上档');
    check(agingText.includes('CNY 67,600.00(6 笔)'), 'CNY 余额合计 67,600.00 共 6 笔(已结清的 BC-0087 不入账龄)');
    const bars = await page.$$eval('.aging-row__bar', (els) => els.map((e) => e.style.width));
    check(bars.length === 10 && bars.every((w) => /%$/.test(w)), '两个币种各 5 条账龄条');
    await overflow(page, '桌面-账龄');

    // 跟进清单
    await tab(page, 'follow');
    check((await page.textContent('#follow-count')) === '4', '今天要跟 4 条(争议 BC-0092 与近期已跟进 BC-0101 不算)');
    const firstRows = await page.$$eval('#follow-out tbody tr', (rs) => rs.map((r) => r.children[1].textContent));
    check(firstRows.join(',') === 'XH-2026-001,BC-0092,H-322,XH-2026-014,H-311,BC-0101', `按逾期天数降序:${firstRows.join(',')}`);
    const disputedRow = await page.locator('#follow-out tbody tr', { hasText: 'BC-0092' }).textContent();
    check(disputedRow.includes('有争议,人工处理'), '争议账单单独标记');
    await page.check('#fu-only-today');
    check((await rowCount(page, '#follow-out')) === 4, '只看今天要跟:4 行');
    check(!(await page.textContent('#follow-out')).includes('BC-0092'), '争议账单被排除出今天要跟');
    await page.uncheck('#fu-only-today');

    // 打开第一条:提醒草稿、复制、记录跟进、收款
    await page.locator('#follow-out tbody tr', { hasText: 'XH-2026-001' }).locator('button', { hasText: '处理' }).click();
    check(await page.isVisible('#work-panel'), '打开账单详情面板');
    const draft = await page.inputValue('#w-draft');
    check(draft.includes('星河设计工作室') && draft.includes('XH-2026-001') && draft.includes('CNY 12,000.00') && draft.includes('逾期 95 天'), '提醒草稿替换了客户/账单号/金额/逾期天数');
    await page.click('#btn-copy-draft');
    await page.waitForFunction(() => /已复制|已选中/.test(document.getElementById('flash').textContent));
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
    check(clip === null || clip === draft, '复制到剪贴板的内容与草稿一致(或浏览器拒绝读取)');

    await page.fill('#w-follow-note', '微信提醒,对方说本周财务审批');
    await page.click('#btn-follow-save');
    check((await page.textContent('#flash')).includes('已记录跟进'), '记录跟进后提示成功');
    check((await page.textContent('#follow-count')) === '3', '记录跟进后今天要跟减为 3');
    check((await page.textContent('#work-panel')).includes('跟进 2026-10-20:微信提醒'), '历史里出现这次跟进');

    await page.fill('#w-pay-amount', '99999');
    await page.click('#btn-pay-save');
    check((await page.textContent('#w-pay-error')).includes('超过应收'), '收款超额被拒绝并说明');
    check(await page.getAttribute('#w-pay-amount', 'aria-invalid') === 'true' && await page.evaluate(() => document.activeElement.id) === 'w-pay-amount', '收款错误出现在收款区并聚焦、标记金额控件');
    check(await page.getAttribute('#w-pay-amount', 'aria-describedby') === 'w-pay-error', '金额控件用 aria-describedby 关联错误行');
    check(await page.isHidden('#w-follow-error') && await page.isHidden('#w-dispute-error'), '收款错误不会出现在跟进区和争议区');
    await page.fill('#w-follow-date', '');
    await page.click('#btn-follow-save');
    check((await page.textContent('#w-follow-error')).includes('跟进日期') && await page.evaluate(() => document.activeElement.id) === 'w-follow-date' && await page.isHidden('#w-pay-error'), '跟进错误出现在跟进区并聚焦日期控件,收款错误行收起');
    await page.fill('#w-follow-date', '2026-10-20');
    await page.fill('#w-pay-amount', '2,000');
    await page.click('#btn-pay-save');
    check((await page.textContent('#work-panel')).includes('CNY 10,000.00'), '登记收款 2,000 后余额重算为 10,000.00');
    await page.fill('#w-dispute', '对方称发票抬头有误');
    await page.click('#btn-dispute-save');
    check((await page.textContent('#follow-out')).includes('有争议,人工处理'), '保存争议备注后该账单标为争议');
    check((await page.textContent('#follow-count')) === '3', '争议账单不计入今天要跟(仍为 3)');
    await page.fill('#w-dispute', '');
    await page.click('#btn-dispute-save');

    // 模板可改
    await page.fill('#fu-template', '【催款】{客户} 的 {账单号} 还有 {金额} 没付,逾期 {逾期天数} 天');
    const d2 = await page.inputValue('#w-draft');
    check(d2.startsWith('【催款】星河设计工作室 的 XH-2026-001 还有 CNY 10,000.00'), '改模板后草稿实时更新');
    await page.fill('#fu-n', '3');
    await page.dispatchEvent('#fu-n', 'change');
    check((await page.textContent('#follow-count')) === '4', '把间隔改为 3 天后,BC-0101 也进入今天要跟(共 4)');
    await page.fill('#fu-n', '7');
    await page.dispatchEvent('#fu-n', 'change');
    await overflow(page, '桌面-跟进清单');
    await page.screenshot({ path: path.join(SHOTS, '02-核心流程-桌面.png'), fullPage: true });

    // 录入:单条、重复、批量、CSV
    await tab(page, 'entry');
    await page.fill('#f-client', '=HYPERLINK("http://x")');
    await page.fill('#f-no', 'EV-1');
    await page.fill('#f-due', '2026-09-01');
    await page.fill('#f-amount', '1200.50');
    await page.click('#btn-bill-save');
    check((await page.textContent('#flash')).includes('已保存账单 EV-1'), '单条表单保存成功');
    await page.fill('#f-client', '=HYPERLINK("http://x")');
    await page.fill('#f-no', 'EV-1');
    await page.fill('#f-due', '2026-09-01');
    await page.fill('#f-amount', '10');
    await page.click('#btn-bill-save');
    check(await page.isVisible('#bill-form-error') && (await page.textContent('#bill-form-error')).includes('已经有账单号'), '重复的客户+账单号被拒绝');
    await page.fill('#f-amount', '-3');
    await page.click('#btn-bill-save');
    check((await page.textContent('#bill-form-error')).includes('应收金额'), '非法金额被拒绝');
    check(await page.getAttribute('#f-amount', 'aria-invalid') === 'true' && await page.evaluate(() => document.activeElement.id) === 'f-amount', '录入表单错误聚焦并标记出错的金额控件');
    await page.fill('#f-client', '');
    await page.fill('#f-no', '');
    await page.fill('#f-due', '');
    await page.fill('#f-amount', '');

    await page.fill('#batch-text', '丙公司｜P-1｜2026/09/10｜5,000｜1,000\n丁公司 | D-1 | 2026-08-01 | 3000\n坏行 | 只有两列');
    const prev = await page.textContent('#batch-preview');
    check(prev.includes('识别成功 2 行') && prev.includes('有问题 1 行') && prev.includes('第 3 行'), '批量预览:成功 2 行、错误 1 行并指出行号');
    const before = Number(await page.textContent('#bill-count'));
    await page.click('#btn-batch-add');
    check(Number(await page.textContent('#bill-count')) === before + 2, '批量加入后账单数 +2');

    await page.fill('#csv-text', '公司,发票号,Due,金额,Cur,备注\n戊公司,W-1,2026-07-01,800,usd,对方要求重开发票\n戊公司,W-2,2026-13-40,50,usd,\n己公司,J-1,2026-10-05,900,,');
    check((await page.inputValue('#map-client')) === '0' && (await page.inputValue('#map-dueDate')) === '2', 'CSV 表头自动猜出列映射');
    check((await page.textContent('#csv-preview')).includes('识别成功 2 行') && (await page.textContent('#csv-preview')).includes('有问题 1 行'), 'CSV 预览:成功 2 行、错误 1 行');
    check(await page.isDisabled('#btn-csv-add'), 'CSV 有任何错误行时禁用导入(整份拒绝)');
    await page.selectOption('#map-dueDate', '-1');
    check(await page.isDisabled('#btn-csv-add') && (await page.textContent('#csv-preview')).includes('必须为以下字段选择列'), '缺少必选列映射时不能导入');
    await page.selectOption('#map-dueDate', '2');
    await page.fill('#csv-text', '公司,发票号,Due,金额,Cur,备注\n戊公司,W-1,2026-07-01,800,usd,对方要求重开发票\n己公司,J-1,2026-10-05,900,,"20');
    check(await page.isDisabled('#btn-csv-add') && (await page.textContent('#csv-preview')).includes('引号没有闭合'), 'CSV 引号未闭合时整份拒绝');
    await page.fill('#csv-text', '公司,发票号,Due,金额,Cur,备注\n戊公司,W-1,2026-07-01,800,usd,对方要求重开发票\n己公司,J-1,2026-10-05,900,,');
    await page.selectOption('#map-dispute', '5');
    check(await page.isEnabled('#btn-csv-add'), '改正后全部合法,导入按钮可用');
    await page.click('#btn-csv-add');
    check((await page.textContent('#flash')).includes('CSV 导入'), 'CSV 导入成功');
    await overflow(page, '桌面-录入');

    // 全部账单:编辑 / 删除确认
    await tab(page, 'bills');
    check((await page.textContent('#bills-out')).includes('已结清'), '全部账单里已结清的账单标为已结清');
    await page.locator('#bills-out tbody tr', { hasText: 'W-1' }).locator('button', { hasText: '编辑' }).click();
    check((await page.inputValue('#f-dispute')) === '对方要求重开发票', '编辑时带出争议备注');
    check(await page.getAttribute('#f-paid', 'readonly') !== null && await page.getAttribute('#f-lastfollow', 'readonly') !== null, '编辑时已收与最近跟进为只读派生汇总');
    check((await page.textContent('#f-paid-help')).includes('收款记录'), '编辑页说明新收款应在账单详情登记');
    await page.click('#btn-bill-save');
    check((await page.textContent('#flash')).includes('已保存修改'), '编辑保存成功');
    await tab(page, 'bills');
    await page.locator('#bills-out tbody tr', { hasText: 'J-1' }).locator('button', { hasText: '删除' }).click();
    check(await page.isVisible('#delete-confirm'), '删除前出现页内确认区');
    await page.click('#btn-delete-yes');
    check(!(await page.textContent('#bills-out')).includes('J-1'), '确认后账单被删除');
    await overflow(page, '桌面-全部账单');

    // 结果与导出
    await tab(page, 'aging');
    // 录入页有未保存草稿时,导出暂停
    await tab(page, 'entry');
    await page.fill('#batch-text', '临时 | T-1 | 2026-09-01 | 100');
    await tab(page, 'aging');
    check(await page.isDisabled('#btn-aging-md') && await page.isVisible('#export-pending'), '批量粘贴有未保存内容时账龄导出禁用并提示');
    await tab(page, 'entry');
    await page.fill('#batch-text', '');
    await tab(page, 'aging');
    check(await page.isEnabled('#btn-aging-md') && await page.isHidden('#export-pending'), '清掉草稿后导出恢复');
    const md = await readDownload(page, '#btn-aging-md', '.tmp-aging.md');
    check(md.name.endsWith('.md') && md.text.includes('## CNY') && md.text.includes('## USD') && md.text.includes('基准日:2026-10-20'), '账龄表 Markdown 含币种分节与基准日');
    check(md.name.includes('合成示例') && md.text.includes('合成示例数据,不是真实账单'), '导出文件名与内容带合成示例标注: ' + md.name);
    check(md.text.includes("'=HYPERLINK"), 'Markdown 里公式开头的客户名被加单引号');
    const sum = await readDownload(page, '#btn-aging-csv', '.tmp-sum.csv');
    check(sum.text.includes('币种,账龄,笔数,金额') && sum.text.includes('CNY,合计,'), '账龄汇总 CSV 含表头与合计');
    const det = await readDownload(page, '#btn-aging-detail-csv', '.tmp-det.csv');
    check(det.text.includes("\"'=HYPERLINK(") , '账龄明细 CSV 公式防护生效');
    await tab(page, 'follow');
    const fu = await readDownload(page, '#btn-follow-csv', '.tmp-fu.csv');
    check(fu.text.includes('提醒草稿') && fu.text.includes('有争议,人工处理') && fu.text.includes('【催款】'), '跟进清单 CSV 含状态与提醒草稿');
    await tab(page, 'aging');

    // 备份与导入
    const bk = await readDownload(page, '#btn-export-json', '.tmp-backup.json');
    const parsed = JSON.parse(bk.text);
    check(parsed.version === 2 && parsed.bills.length >= 12 && parsed.settings.n === 7, 'JSON v2 备份含 version / 账单 / 设置');
    const goodPath = path.join(SHOTS, '.tmp-good.json');
    fs.writeFileSync(goodPath, bk.text);
    const badObj = JSON.parse(bk.text);
    badObj.bills[1].id = badObj.bills[0].id;
    const badPath = path.join(SHOTS, '.tmp-bad.json');
    fs.writeFileSync(badPath, JSON.stringify(badObj));
    const countBefore = await page.textContent('#bill-count');
    await page.setInputFiles('#file-import', badPath);
    await page.waitForSelector('#import-error:not([hidden])');
    check((await page.textContent('#import-error-text')).includes('id 重复') && (await page.textContent('#bill-count')) === countBefore, '含重复 id 的备份被整份拒绝,现有数据不变');
    await page.setInputFiles('#file-import', goodPath);
    await page.waitForSelector('#import-confirm:not([hidden])');
    const impText = await page.textContent('#import-summary');
    check(/现有 \d+ 张账单、\d+ 笔收款、\d+ 条跟进记录.*备份文件 \d+ 张账单/.test(impText), '导入前预览现有与备份的账单、收款、跟进数量:' + impText);
    check((await page.textContent('#bill-count')) === countBefore, '确认前现有数据不变');
    await page.click('#btn-import-no');
    check(await page.isHidden('#import-confirm') && (await page.textContent('#bill-count')) === countBefore, '取消导入后现有数据不变');
    await page.setInputFiles('#file-import', goodPath);
    await page.waitForSelector('#import-confirm:not([hidden])');
    await page.click('#btn-import-yes');
    await page.waitForFunction(() => document.getElementById('flash').textContent.includes('已导入'));
    check(await page.isHidden('#import-error'), '合法备份导入成功并隐藏错误提示');
    fs.unlinkSync(goodPath); fs.unlinkSync(badPath);

    // 回到干净的示例数据再截结果图
    const keep = await page.textContent('#bill-count');
    await page.click('#btn-sample');
    check(await page.isVisible('#sample-confirm') && (await page.textContent('#bill-count')) === keep, '已有数据时载入示例先出现页内替换确认,数据未动');
    await page.click('#btn-sample-no');
    check(await page.isHidden('#sample-confirm') && (await page.textContent('#bill-count')) === keep, '取消替换后数据保持不变');
    await page.click('#btn-sample');
    await page.click('#btn-sample-yes');
    check((await page.textContent('#bill-count')) === '10', '确认后才替换为 10 张示例账单');
    await tab(page, 'aging');
    await page.evaluate(() => window.scrollTo(0, 0));
    await overflow(page, '桌面-账龄与导出');
    await page.screenshot({ path: path.join(SHOTS, '03-结果与导出-桌面.png'), fullPage: true });
    await page.reload();
    check((await page.textContent('#bill-count')) === '10', '刷新后数据仍在(localStorage),示例共 10 张');
    check(await page.isVisible('#sample-badge'), '刷新后合成示例标记仍在');
    // 超长模板不能毁掉存档
    await tab(page, 'follow');
    const tplBefore = await page.inputValue('#fu-template');
    await page.fill('#fu-template', 'x'.repeat(2001));
    await page.dispatchEvent('#fu-template', 'change');
    check((await page.textContent('#flash')).includes('模板没有保存') && (await page.inputValue('#fu-template')) === tplBefore, '2001 字模板被拒绝,输入框回到原模板');
    await page.reload();
    check((await page.textContent('#bill-count')) === '10', '输入 2001 字模板并刷新后,10 张账单仍在');
    // 持久化与清空
    await page.click('#btn-clear');
    check(await page.isVisible('#clear-confirm'), '清空前出现页内确认区');
    await page.click('#btn-clear-yes');
    check(await page.isVisible('#empty-guide') && await page.isHidden('#sample-badge'), '清空后回到空状态且合成示例标记消失');
    await ctx.close();

    /* ---------- ?today 非法回退 ---------- */
    const tctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const tp = await tctx.newPage();
    watch(tp, 'today-fallback');
    await tp.goto('file://' + encodeURI(path.join(__dirname, 'index.html')) + '?today=2026-02-30');
    const lbl = await tp.textContent('#today-label');
    check(/^\d{4}-\d{2}-\d{2}$/.test(lbl) && lbl !== '2026-02-30', `非法 ?today 回退到真实今天(${lbl})`);
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
    await fctx.close();

    /* ---------- 平板 ---------- */
    const pctx = await browser.newContext({ viewport: { width: 768, height: 900 } });
    const p = await pctx.newPage();
    watch(p, 'tablet');
    await p.goto(URL_INDEX);
    await p.click('#btn-sample-2');
    for (const v of ['aging', 'follow', 'bills', 'entry']) { await tab(p, v); await overflow(p, '平板-' + v); }
    await pctx.close();

    /* ---------- 手机 ---------- */
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const m = await mctx.newPage();
    watch(m, 'mobile');
    await m.goto(URL_INDEX);
    await m.click('#btn-sample-2');
    await overflow(m, '手机-账龄');
    await tab(m, 'follow');
    await overflow(m, '手机-跟进清单');
    const stacked = await m.evaluate(() => {
      const th = document.querySelector('.data-table thead');
      const td = document.querySelector('.data-table tbody td');
      return { head: getComputedStyle(th).display, cell: getComputedStyle(td).display };
    });
    check(stacked.head === 'none' && stacked.cell === 'grid', `手机端表格堆叠成卡片(thead=${stacked.head}, td=${stacked.cell})`);
    await m.locator('#follow-out tbody tr').first().locator('button', { hasText: '处理' }).click();
    await overflow(m, '手机-详情面板');
    await m.evaluate(() => window.scrollTo(0, 0));
    await m.screenshot({ path: path.join(SHOTS, '04-手机.png'), fullPage: true });
    for (const v of ['bills', 'entry']) { await tab(m, v); await overflow(m, '手机-' + v); }
    await mctx.close();

    /* ---------- 展示图 ---------- */
    const sctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    const s = await sctx.newPage();
    watch(s, 'showcase');
    await s.goto(URL_SHOWCASE);
    await s.waitForLoadState('load');
    await s.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await s.waitForFunction(() => Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0));
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
  console.log('\n断言数:' + assertions);
  if (problems.length) {
    console.error('\n共 ' + problems.length + ' 个问题:\n' + problems.join('\n'));
    process.exit(1);
  }
  console.log('\n全部通过');
})();
