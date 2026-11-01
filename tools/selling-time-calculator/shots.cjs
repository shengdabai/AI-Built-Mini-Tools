'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const URL_INDEX = 'file://' + encodeURI(path.join(__dirname, 'index.html')) + '?today=2026-10-20';
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
const field = (g, k) => `input[data-g="${g}"][data-k="${k}"]`;

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'timesell-'));
  const browser = await chromium.launch({ executablePath: EXE });
  try {
    /* ---------- 桌面 ---------- */
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
    const page = await ctx.newPage();
    watch(page, 'desktop');
    await page.goto(URL_INDEX);
    check(await page.isVisible('#empty-guide'), '空状态显示引导');
    check(await page.isDisabled('#btn-export-md'), '没有情景时导出按钮禁用');
    await overflow(page, '桌面-空状态');
    await page.screenshot({ path: path.join(SHOTS, '01-空状态-桌面.png') });

    await page.click('#btn-sample-2');
    check((await page.textContent('#flash')).includes('合成示例'), '载入示例后提示合成示例');
    check(!(await page.isVisible('#empty-guide')), '载入示例后引导消失');
    const m1 = await page.textContent('#m1-result');
    check(m1.includes('387.00'), '模式一最低时薪 387.00(20000 ÷ 64 ÷ 0.85 ÷ 0.95)');
    check(await page.locator('#sens-table tbody tr').count() === 6, '敏感性表 6 行(20% 到 70%)');
    const ex = await page.textContent('#m2-explain');
    check(ex.includes('税费 5% 继承自「现状」') && ex.includes('299 × (1−10%) × (1−5%) × (1−5%)') && ex.includes('向上取整'), '模式二结果旁写明单份到手公式、继承的税费与回本公式');
    check(await page.isVisible('#sample-badge'), '载入示例后持续显示合成示例标记');
    await page.reload();
    check(await page.isVisible('#sample-badge'), '刷新后合成示例标记仍在');
    check((await page.textContent('h3 >> nth=0')).includes('空置率每增加 10 个百分点'), '敏感性标题改为百分点口径');

    // 已有数据时再点载入示例:先确认,取消不改原状态
    await page.fill(field('one', 'target'), '21000');
    await page.click('#btn-sample');
    check(await page.isVisible('#sample-confirm'), '已有数据时载入示例先出现页内替换确认');
    await page.click('#btn-sample-no');
    check(await page.inputValue(field('one', 'target')) === '21000' && !(await page.isVisible('#sample-confirm')), '取消替换后原输入保留');
    await page.click('#btn-sample');
    await page.click('#btn-sample-yes');
    check(await page.inputValue(field('one', 'target')) === '20000', '确认替换后载入示例');

    // 外包工时超过基准总工时被拒绝
    await page.fill(field('three', 'hours'), '300');
    check((await page.textContent('#m3-result')).includes('不能超过模式一的总工时'), '外包涉及工时超过总工时时显示错误');
    check(await page.isDisabled('#slot-buttons button:has-text("覆盖情景 1")'), '该情景不能保存');
    await page.fill(field('three', 'hours'), '0');

    // 真实填表:空置率 20 -> 30,时薪应上涨
    await page.fill(field('one', 'vacancy'), '30');
    const m1b = await page.textContent('#m1-result');
    check(m1b.includes('引用') === false && m1b.includes('442.28'), '空置率 30% 时最低时薪 442.28');
    await page.fill(field('one', 'vacancy'), '150');
    check(await page.isVisible('#input-error'), '空置率 150 显示输入错误');
    check((await page.textContent('#m1-result')).includes('442.28'), '无效输入不改变计算(沿用上一个有效值)');
    await page.fill(field('one', 'vacancy'), '20');
    check(!(await page.isVisible('#input-error')), '改回有效值后错误消失');

    // 模式二、三
    const m2 = await page.textContent('#m2-result');
    check(m2.includes('回本销量') && /回本销量\s*\d+ 份/.test(m2), '模式二显示回本销量');
    await page.fill(field('two', 'units'), '40');
    check((await page.textContent('#m2-result')).includes('月净收入'), '改月销量后重算');
    check(await page.locator('#curve-table tbody tr').count() >= 10, '曲线表至少 10 行');
    const m3 = await page.textContent('#m3-result');
    check(m3.includes('+3744.00') || m3.includes('3744.00'), '模式三净增 3744.00');
    await page.fill(field('three', 'yourRate'), '50');
    check((await page.textContent('#m3-result')).includes('不划算'), '你的时薪低于外包时薪时提示不划算');
    await page.fill(field('three', 'yourRate'), '300');
    await page.fill(field('two', 'units'), '30');
    await page.screenshot({ path: path.join(SHOTS, '02-核心流程-桌面.png') });

    // 情景:改名并覆盖情景 3
    await page.fill('#scn-name', '=HYPERLINK("x")情景');
    check(await page.isVisible('#dirty-hint'), '输入与已存情景不一致时提示');
    check(await page.isDisabled('#btn-export-md') && await page.isDisabled('#btn-export-csv'), '编辑区有未保存改动时情景表导出禁用');
    await page.click('#slot-buttons button:has-text("覆盖情景 3")');
    check(!(await page.isVisible('#dirty-hint')), '保存后不一致提示消失');
    check(await page.locator('#cmp-table tbody tr').count() === 9, '情景比较表 3 情景 × 3 模式 = 9 行');
    check((await page.textContent('#scn-list')).includes('=HYPERLINK'), '情景列表显示名称(textContent 渲染)');
    check(await page.locator('#cmp-table tbody .bar__fill').count() === 9, '每行都有条形');

    // 导出
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export-md')]);
    const mdPath = path.join(tmp, 'a.md'); await dl.saveAs(mdPath);
    const md = fs.readFileSync(mdPath, 'utf8');
    check(dl.suggestedFilename().endsWith('.md') && md.includes('# 时间出售三模式试算') && md.includes("| '=HYPERLINK"), 'Markdown 导出含标题且公式字段加单引号');
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export-csv')]);
    const csvPath = path.join(tmp, 'a.csv'); await dl2.saveAs(csvPath);
    const csv = fs.readFileSync(csvPath, 'utf8');
    check(csv.startsWith('情景,模式,月收入,工时,等效时薪') && csv.trim().split('\n').length === 10 && csv.includes("\"'=HYPERLINK"), 'CSV 导出 1 表头 + 9 行且公式防护');
    const [dl3] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export-json')]);
    const jsonPath = path.join(tmp, 'a.json'); await dl3.saveAs(jsonPath);
    const backup = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    check(backup.version === 1 && backup.scenarios.length === 3, 'JSON 备份含 3 个情景');

    // 导入:合法与非法
    await page.setInputFiles('#file-import', jsonPath);
    await page.waitForSelector('#import-confirm:not([hidden])');
    const sumText = await page.textContent('#import-summary');
    check(/当前 3 个情景.*备份文件 3 个情景/.test(sumText), '导入前先预览情景数量:' + sumText);
    await page.click('#btn-import-no');
    check(!(await page.isVisible('#import-confirm')) && await page.locator('#cmp-table tbody tr').count() === 9, '取消导入后现有数据不变');
    await page.setInputFiles('#file-import', jsonPath);
    await page.waitForSelector('#import-confirm:not([hidden])');
    await page.click('#btn-import-yes');
    await page.waitForFunction(() => !document.getElementById('flash').hidden && document.getElementById('flash').textContent.includes('导入'));
    check((await page.textContent('#flash')).includes('已导入'), '确认后备份导入成功');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(SHOTS, '03-结果与导出-桌面.png'), fullPage: true });
    await overflow(page, '桌面-结果与导出');
    const bad = JSON.parse(JSON.stringify(backup)); bad.current.one.vacancy = 150;
    const badPath = path.join(tmp, 'bad.json'); fs.writeFileSync(badPath, JSON.stringify(bad));
    await page.setInputFiles('#file-import', badPath);
    await page.waitForSelector('#import-error:not([hidden])');
    const ie = await page.textContent('#import-error');
    check(ie.includes('导入被拒绝') && ie.includes('vacancy'), '非法备份整份拒绝并说明原因');
    check(await page.locator('#cmp-table tbody tr').count() === 9, '拒绝后现有数据未改动');


    // 清空确认
    await page.click('#btn-clear');
    check(await page.isVisible('#clear-confirm'), '清空前出现页内确认区');
    await page.click('#btn-clear-yes');
    check(await page.isVisible('#empty-guide'), '清空后回到空状态');
    check(!(await page.isVisible('#sample-badge')), '清空后合成示例标记消失');
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
    await overflow(m, '手机-空状态');
    await m.click('#btn-sample-2');
    await overflow(m, '手机-示例');
    const cols = await m.evaluate(() => getComputedStyle(document.querySelector('.modes')).gridTemplateColumns.split(' ').length);
    check(cols === 1, `手机端三模式卡片纵向堆叠(列数 ${cols})`);
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
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log('\n' + results.join('\n'));
  console.log(`断言总数 ${asserts}`);
  if (problems.length) {
    console.error('\n共 ' + problems.length + ' 个问题:\n' + problems.join('\n'));
    process.exit(1);
  }
  console.log('\n全部通过');
})();
