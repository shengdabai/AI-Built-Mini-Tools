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
function check(cond, msg) {
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
    check(await page.isVisible('#btn-import') && await page.isVisible('#btn-import-2'), '空状态下「导入 JSON 备份」入口可见');
    check((await page.textContent('#today-note')).includes('基准日 2026-10-20(由地址参数固定)'), '固定日期生效时页面显示基准日');
    await overflow(page, '桌面-空状态');
    await page.screenshot({ path: path.join(SHOTS, '01-空状态-桌面.png') });

    await page.click('#btn-sample-2');
    check((await page.textContent('#flash')).includes('合成示例'), '载入示例后提示合成示例');
    check(await page.isVisible('#sample-badge'), '载入示例后数据区持续显示「合成示例」标记');
    const cnt = Number(await page.textContent('#anomaly-count'));
    check(cnt >= 5, `异常数 >= 5(实际 ${cnt})`);
    await tab(page, 'anomalies');
    const anomalyText = await page.textContent('#anomaly-list');
    for (const k of ['课时间重叠', '课包余额为负', '状态缺失', '学员未建档', '收款币种不一致']) {
      check(anomalyText.includes(k), `异常列表含「${k}」`);
    }
    await overflow(page, '桌面-异常列表');
    await page.screenshot({ path: path.join(SHOTS, '02-核心流程-桌面.png') });

    // 批量粘贴
    await tab(page, 'lessons');
    await page.fill('#batch-text', '10-19 09:00 ｜ Ben ｜ 45\n2026/10/19 | 林悦 | 60 | 已上\n坏行');
    const prev = await page.textContent('#batch-preview');
    check(prev.includes('识别成功 2 行') && prev.includes('有问题 1 行'), '批量预览识别 2 行成功 1 行错误');
    const before = await page.locator('#lessons-table tbody tr').count();
    await page.click('#btn-batch-add');
    const after = await page.locator('#lessons-table tbody tr').count();
    check(after === before + 2, `批量加入后课记录 +2(${before} -> ${after})`);
    await overflow(page, '桌面-课记录');

    // 对账单
    await tab(page, 'statement');
    await page.selectOption('#st-student', '林悦');
    await page.fill('#st-month', '2026-10');
    const stText = await page.textContent('#statement-out');
    check(stText.includes('5.50 小时') && stText.includes('1100.00 CNY'), '林悦 10 月应计 5.50 小时 / 1100.00 CNY(含批量加入的 10-19 一节)');
    check(stText.includes('2.00 课时'), '林悦课包余额 2.00 课时(9 月 2.5 + 10 月 5.5 = 8 已消耗)');
    check(stText.includes('300.00 CNY,待收') || stText.includes('累计应收 1600.00,累计已收 1300.00,待收'), '林悦差额 300.00 CNY(应收 1600 - 已收 1300)');
    check(stText.includes('提前 3 小时取消,不足 24 小时,计费'), '3 小时取消计费原因展示');
    await overflow(page, '桌面-对账单');
    check(stText.includes('不受所选月份影响'), '课包余额旁注明不受所选月份影响');
    check(stText.includes('累计至 2026-10 月底'), '差额旁注明累计至所选月份月底');

    await page.selectOption('#st-student', 'Ben');
    const benText = await page.textContent('#statement-out');
    check(benText.includes('按次结算'), 'Ben 显示按次结算');
    await page.selectOption('#st-student', '林悦');

    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.click("text=下载对账单 Markdown")
    ]);
    const mdPath = path.join(SHOTS, '.tmp-statement.md');
    await dl.saveAs(mdPath);
    const md = fs.readFileSync(mdPath, 'utf8');
    fs.unlinkSync(mdPath);
    check(dl.suggestedFilename().endsWith('.md') && md.includes('计费规则说明') && md.includes('林悦'), '导出 Markdown 含规则说明');

    const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export-csv')]);
    const csvPath = path.join(SHOTS, '.tmp-lessons.csv');
    await dl2.saveAs(csvPath);
    const csv = fs.readFileSync(csvPath, 'utf8');
    fs.unlinkSync(csvPath);
    check(csv.includes('日期,开始时间,学员') && csv.split('\n').length > 15, '导出 CSV 含表头与记录');

    check(md.includes('数据来源:合成示例') && dl.suggestedFilename().includes('合成示例'), '示例的对账单 Markdown 与文件名标注合成示例');
    check(csv.includes('数据来源') && csv.includes('合成示例'), '示例的课记录 CSV 含「数据来源」列');
    const [dlj] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export-json')]);
    const jsonPath = path.join(SHOTS, '.tmp-backup.json');
    await dlj.saveAs(jsonPath);
    const jsonText = fs.readFileSync(jsonPath, 'utf8');
    check(JSON.parse(jsonText).sample === true, '示例的 JSON 备份带 sample 标记');

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(SHOTS, '03-结果与导出-桌面.png'), fullPage: true });

    // 刷新后示例标记仍在
    await page.reload();
    check(await page.isVisible('#sample-badge'), '刷新后「合成示例」标记仍在');

    // 删除先页内确认:课记录
    await tab(page, 'lessons');
    const nL = await page.locator('#lessons-table tbody tr').count();
    await page.locator('#lessons-table [data-del]').first().click();
    check(await page.locator('#lessons-table .confirm-inline').count() === 1, '点「删除」课记录后出现行内确认');
    check(await page.locator('#lessons-table tbody tr').count() === nL, '确认前课记录条数不变');
    check(await page.evaluate(() => document.activeElement.textContent) === '取消', '出现确认后焦点落在「取消」');
    await page.click('#lessons-table [data-del-no]');
    check(await page.locator('#lessons-table .confirm-inline').count() === 0 && await page.locator('#lessons-table tbody tr').count() === nL, '取消后课记录仍在');
    await page.locator('#lessons-table [data-del]').first().click();
    await page.click('#lessons-table .confirm-inline .btn--danger');
    check(await page.locator('#lessons-table tbody tr').count() === nL - 1, '确认后课记录减少 1 条');
    check(await page.evaluate(() => !!document.activeElement.closest('#lessons-table')), '删除后焦点留在课记录表内');
    // 收款
    await tab(page, 'payments');
    const nP = await page.locator('#payments-table tbody tr').count();
    await page.locator('#payments-table [data-del]').first().click();
    check(await page.locator('#payments-table tbody tr').count() === nP, '确认前收款条数不变');
    await page.click('#payments-table .confirm-inline .btn--danger');
    check(await page.locator('#payments-table tbody tr').count() === nP - 1, '确认后收款减少 1 条');
    // 学员:说明保留关联
    await tab(page, 'students');
    await page.locator('#students-table tbody tr', { hasText: '林悦' }).locator('[data-del]').click();
    const delText = await page.locator('#students-table .confirm-inline').innerText();
    check(delText.includes('课记录') && delText.includes('收款') && delText.includes('保留'), '删除学员的确认文案写明课记录和收款会保留');
    check(await page.locator('#students-table tbody tr').count() === 3, '确认前学员仍为 3 位');
    await page.click('#students-table .confirm-inline .btn--secondary');
    // 编辑学员:姓名只读
    await page.locator('#students-table tbody tr', { hasText: '林悦' }).locator('text=编辑').click();
    check(await page.locator('#s-name').getAttribute('readonly') !== null, '编辑学员时姓名为只读');
    check(await page.isVisible('#s-name-hint'), '姓名旁说明为什么不能改');
    await page.click('#btn-student-reset');
    check(await page.locator('#s-name').getAttribute('readonly') === null, '重置表单后姓名可编辑');
    // 其他币种错误贴近控件
    await page.fill('#s-name', '测试学员');
    await page.fill('#s-rate', '100');
    await page.selectOption('#s-currency', '其他');
    await page.fill('#s-currency-other', '1');
    await page.click('#form-student button[type="submit"]');
    check(await page.isVisible('#s-currency-other-error'), '其他币种错误显示在输入框旁');
    check((await page.getAttribute('#s-currency-other', 'aria-describedby')) === 's-currency-other-error', '币种输入框用 aria-describedby 关联错误');
    check(await page.evaluate(() => document.activeElement.id) === 's-currency-other', '提交失败后焦点回到出错的币种输入框');
    await page.waitForTimeout(6500);
    check(await page.isVisible('#s-currency-other-error'), '顶部提示消失后字段错误仍在');
    await page.fill('#s-currency-other', 'jpy');
    check(await page.locator('#s-currency-other-error').count() === 0, '修正输入后字段错误清除');
    await page.click('#btn-student-reset');

    // 载入示例前的替换确认 + 导入走「校验 → 预览数量 → 确认 → 写入」
    await page.click('#btn-sample');
    check(await page.isVisible('#replace-confirm'), '已有数据时点「载入合成示例」先出现替换确认');
    check((await page.textContent('#replace-title')).includes('3 位学员'), '替换确认写明数量');
    const keep = await page.locator('#students-table tbody tr').count();
    await page.click('#btn-replace-no');
    check(await page.isHidden('#replace-confirm') && await page.locator('#students-table tbody tr').count() === keep, '取消后原数据不变');
    const badFile = path.join(SHOTS, '.tmp-bad.json');
    fs.writeFileSync(badFile, '{"students":[{"name":"A"}],"lessons":[],"payments":[]}');
    await page.setInputFiles('#file-import', badFile);
    await page.waitForSelector('#import-error:not([hidden])');
    check((await page.textContent('#import-error')).includes('现有数据没有改动'), '非法备份被整份拒绝并说明原因');
    check(await page.isHidden('#replace-confirm'), '非法备份不进入替换确认');
    await page.setInputFiles('#file-import', jsonPath);
    await page.waitForSelector('#replace-confirm:not([hidden])');
    check((await page.textContent('#replace-title')).includes('备份文件') && (await page.textContent('#replace-title')).includes('位学员'), '合法备份先预览数量再确认');
    await page.click('#btn-replace-yes');
    check(await page.isHidden('#replace-confirm') && await page.isVisible('#sample-badge'), '确认后写入,备份里的示例标记保留');
    fs.unlinkSync(badFile); fs.unlinkSync(jsonPath);
    // 清空后示例标记消失
    await page.click('#btn-clear');
    await page.click('#btn-clear-yes');
    check(await page.isHidden('#sample-badge'), '清空后合成示例标记消失');
    await page.click('#btn-sample');
    check(await page.isHidden('#replace-confirm'), '没有任何数据时载入示例不需要确认');

    // 其余视图溢出检查 + 清空确认
    for (const v of ['students', 'payments']) { await tab(page, v); await overflow(page, '桌面-' + v); }
    await page.click('#btn-clear');
    check(await page.isVisible('#clear-confirm'), '清空前出现页内确认区');
    await page.click('#btn-clear-yes');
    await tab(page, 'statement');
    check(await page.isVisible('#empty-guide'), '清空后回到空状态');
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
    await fctx.close();

    /* ---------- 手机 ---------- */
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const m = await mctx.newPage();
    watch(m, 'mobile');
    await m.goto(URL_INDEX);
    await m.click('#btn-sample-2');
    await m.selectOption('#st-student', '林悦');
    await overflow(m, '手机-对账单');
    const smallM = await m.evaluate(() => Array.from(document.querySelectorAll('button')).filter((b) => b.offsetParent && b.getBoundingClientRect().height < 36).map((b) => b.id || b.textContent));
    check(smallM.length === 0, '手机端可见按钮高度均 >= 36px(不足:' + smallM.join(',') + ')');
    const stacked = await m.evaluate(() => {
      const th = document.querySelector('.data-table thead');
      const td = document.querySelector('.data-table tbody td');
      return { head: getComputedStyle(th).display, cell: getComputedStyle(td).display };
    });
    check(stacked.head === 'none' && stacked.cell === 'grid', `手机端表格堆叠成卡片(thead=${stacked.head}, td=${stacked.cell})`);
    await m.screenshot({ path: path.join(SHOTS, '04-手机.png'), fullPage: true });
    for (const v of ['lessons', 'students', 'payments', 'anomalies']) { await tab(m, v); await overflow(m, '手机-' + v); }
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
  if (problems.length) {
    console.error('\n共 ' + problems.length + ' 个问题:\n' + problems.join('\n'));
    process.exit(1);
  }
  console.log('\n全部通过');
})();
