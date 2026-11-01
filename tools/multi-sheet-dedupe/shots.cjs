'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const URL = 'file://' + encodeURI(path.join(__dirname, 'index.html')) + '?today=2026-10-20';
const OUT = path.join(__dirname, 'screenshots');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });
  const problems = [];
  let assertions = 0;
  const check = (cond, msg) => { assertions++; if (!cond) problems.push('断言失败:' + msg); };
  const watch = (page, tag) => {
    page.on('console', m => { if (m.type() === 'error') problems.push(`${tag} console: ${m.text()}`); });
    page.on('pageerror', e => problems.push(`${tag} pageerror: ${e.message}`));
  };
  const noOverflow = async (page, label) => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(`${label}: scrollWidth ${sw} <= innerWidth ${iw} -> ${sw <= iw ? 'OK' : 'FAIL'}`);
    check(sw <= iw, `${label} 横向溢出 ${sw} > ${iw}`);
  };
  const stat = async (page, i) => (await page.$$eval('.stat b', els => els.map(e => e.textContent.trim())))[i];

  // ---------- 主流程 ----------
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  watch(page, '主流程');
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  check(await page.isDisabled('#export-merged'), '空状态下导出应禁用');
  check((await page.textContent('#today-note')).includes('基准日 2026-10-20(由地址参数固定)'), '?today 生效时持续显示基准日说明');
  check(await page.isHidden('#sample-badge'), '空状态不显示合成示例标记');
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

  await page.click('#load-sample');
  await page.waitForSelector('.cluster');
  check((await page.$$('.tcard')).length === 3, '应有 3 张表');
  check(await stat(page, 0) === '40', '记录数应为 40');
  const clusters0 = await page.$$eval('.stat span', els => els[0].textContent);
  check(clusters0.includes('28 个记录组'), '记录组数应为 28,实际:' + clusters0);
  check(await stat(page, 3) === '2', '待确认疑似应为 2');
  check(await stat(page, 2) === '1', '冲突簇应为 1');
  const zhaoText = await page.$$eval('.cluster', els => els.map(e => e.textContent).find(t => t.includes('赵立')) || '');
  check(zhaoText.includes('冲突:手机、公司'), '赵立簇应标出冲突:手机、公司');
  check((await page.$$('.field.conflict')).length >= 4, '冲突字段应高亮');
  check(await page.isVisible('#sample-badge'), '载入示例后持续显示「合成示例」标记');
  const whyTexts = await page.$$eval('.cluster .why', els => els.map(e => ({ n: e.querySelectorAll('li').length, t: e.textContent })));
  check(whyTexts.length === 8 && whyTexts.every(w => w.n >= 1 && /第\d+行 与 .+ 第\d+行:.+(标准化后相同)/.test(w.t)), `8 个重复记录组都显示归组依据(规则 + 两端来源表与行号),实际 ${whyTexts.length} 个`);
  check(whyTexts.some(w => w.n >= 2), '三条记录的记录组显示多条连接(传递合并的连接关系)');
  check(await page.$$eval('.cluster', els => !els.some(e => e.textContent.includes('簇'))), '界面不再出现「簇」');

  // 规则变化 → 结果过期 → 导出禁用,重新核对后恢复
  await page.uncheck('#rule-email');
  check(await page.isDisabled('#export-merged'), '改规则后导出应禁用');
  check((await page.textContent('#export-hint')).includes('过期'), '应提示结果过期');
  check(await page.isVisible('.stale'), '结果区应显示过期提示');
  await page.check('#rule-email');
  await page.click('#run');
  check(await page.isEnabled('#export-merged'), '重新核对后导出应可用');
  check((await page.textContent('#export-hint')).includes('不受上面「显示」筛选影响') && (await page.textContent('#export-hint')).includes('合并结果 CSV 28 行'), '导出提示写明导出全部结果与行数');

  // 疑似并入:陈思远 / 陈思源
  const sBefore = await page.$$eval('.suspect', els => els.length);
  check(sBefore === 2, '疑似条目应为 2');
  await page.click('.suspect:has-text("陈思远") [data-confirm]');
  check((await page.$$eval('.stat span', els => els[0].textContent)).includes('27 个记录组'), '确认后记录组数应为 27');
  check(await stat(page, 3) === '1', '确认后待确认疑似应为 1');
  check((await page.textContent('.cluster:has-text("陈思远")')).includes('含人工确认的疑似并入'), '应标注含人工确认的疑似并入');
  check((await page.textContent('.cluster:has-text("陈思远") .why')).includes('人工确认为同一人'), '人工确认并入的连接也写进归组依据');
  check(await page.evaluate(() => document.activeElement.hasAttribute('data-confirm')), '确认疑似并入后焦点转到下一个待确认按钮');
  check((await page.textContent('#export-hint')).includes('合并结果 CSV 27 行') && (await page.textContent('#export-hint')).includes('原始记录 CSV 40 行'), '确认后导出提示的行数同步为 27 / 40');

  // 选主记录:赵立簇改选微信群那条,合并结果手机顺序随之变化
  const zhao = page.locator('.cluster', { hasText: '赵立' });
  const phonesBefore = await zhao.locator('.merged .field:has(dt:text-matches("手机")) dd').textContent();
  await zhao.locator('.rec:has-text("微信群导出") input[data-master]').check();
  const phonesAfter = await page.locator('.cluster', { hasText: '赵立' }).locator('.merged .field:has(dt:text-matches("手机")) dd').textContent();
  console.log('赵立手机合并值:', phonesBefore, '->', phonesAfter);
  check(phonesBefore !== phonesAfter && phonesAfter.startsWith('138 0000 0005'), '改选主记录后手机排序应变化');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png') });
  await noOverflow(page, '桌面');

  // 导出三种文件(导出始终是全部结果,即使界面勾了「只看有冲突」)
  await page.check('#only-conflict');
  const [dl1] = await Promise.all([page.waitForEvent('download'), page.click('#export-merged')]);
  const merged = fs.readFileSync(await dl1.path(), 'utf8');
  console.log('下载:', dl1.suggestedFilename());
  check(dl1.suggestedFilename().startsWith('合成示例-合并结果-2026-10-20'), '示例导出的文件名带「合成示例」:' + dl1.suggestedFilename());
  check(merged.includes(',数据来源') && merged.includes(',合成示例'), '合并 CSV 带数据来源列');
  check(merged.startsWith('\ufeff组号'), '合并 CSV 带 BOM 且首列为组号');
  check(merged.split('\r\n').length === 1 + 27, '合并 CSV 应为表头 + 27 行');
  check(merged.includes('138 0000 0005 / 138 0000 0004 / 138 0000 0016') || merged.includes('138 0000 0005 / 138 0000 0004'), '合并 CSV 应按主记录排序保留冲突手机');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#export-report')]);
  const report = fs.readFileSync(await dl2.path(), 'utf8');
  check(report.includes('## 记录组') && report.includes('数据来源:合成示例') && report.includes('| 手机 |'), '冲突报告应含簇与手机冲突行');
  const [dl3] = await Promise.all([page.waitForEvent('download'), page.click('#export-orig')]);
  const orig = fs.readFileSync(await dl3.path(), 'utf8');
  check(orig.split('\r\n').length === 1 + 40, '原始记录 CSV 应为表头 + 40 行');
  await page.uncheck('#only-conflict');
  check((await page.textContent('#report-preview')).includes('冲突报告'), '预览应显示冲突报告');
  await page.locator('#h-export').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png') });

  // 刷新后恢复(存储写入成功的证据)
  await page.reload();
  await page.waitForSelector('.cluster');
  check((await page.$$eval('.stat span', els => els[0].textContent)).includes('27 个记录组'), '刷新后应从 localStorage 恢复并保留确认');

  check(await page.isVisible('#sample-badge'), '刷新后「合成示例」标记仍在');

  // 已有确认记录时载入示例要先确认
  await page.click('#load-sample');
  const scope = await page.textContent('#sample-confirm-scope');
  check(await page.isVisible('#sample-confirm') && scope.includes('3 张表') && scope.includes('人工确认并入') && scope.includes('手选主记录'), `载入示例前出现页内确认并写明替换范围(${scope})`);
  await page.click('#sample-confirm-no');
  check(await page.isHidden('#sample-confirm') && (await page.$$('.tcard')).length === 3 && (await page.$$eval('.stat span', els => els[0].textContent)).includes('27 个记录组'), '取消后表格、确认记录保持不变');

  // 清空需页内确认
  await page.click('#clear-data');
  check(await page.isVisible('#clear-confirm'), '应出现页内确认区');
  await page.click('#clear-confirm-no');
  check((await page.$$('.tcard')).length === 3, '取消清空后数据仍在');

  // 手机
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  await noOverflow(page, '手机');
  const sz = await page.evaluate(() => {
    const r = e => { const b = e.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; };
    return { cb: r(document.getElementById('rule-email')), lab: r(document.querySelector('label.check')), radio: r(document.querySelector('input[data-master]')), mlab: r(document.querySelector('label.master-pick')) };
  });
  check(sz.cb[0] >= 24 && sz.cb[1] >= 24 && sz.lab[1] >= 32 && sz.radio[0] >= 24 && sz.radio[1] >= 24 && sz.mlab[1] >= 32, `手机端触控尺寸 checkbox ${sz.cb} label ${sz.lab} radio ${sz.radio} label ${sz.mlab}`);
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
  await page.close();

  // ---------- 存储失败必须可见 ----------
  const failPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(failPage, '存储失败');
  await failPage.addInitScript(() => {
    Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
  });
  await failPage.goto(URL);
  await failPage.click('#load-sample');
  await failPage.waitForSelector('.cluster');
  check(await failPage.isVisible('#save-alert'), '存储失败时应显示持续可见的未保存提示');
  check((await failPage.textContent('#save-alert')).includes('未保存'), '提示文字应含「未保存」');
  const toastText = (await failPage.isVisible('#toast')) ? await failPage.textContent('#toast') : '';
  check(!toastText.includes('已载入'), '写入失败时不能显示成功提示');
  await failPage.waitForTimeout(4000);
  check(await failPage.isVisible('#save-alert'), '未保存提示不应自动消失');
  await failPage.close();

  // ---------- 导入拒绝 + 公式防护 ----------
  const p3 = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  watch(p3, '导入与防护');
  await p3.goto(URL);
  await p3.evaluate(() => localStorage.clear());
  await p3.reload();
  await p3.fill('#add-text', '姓名,邮箱\n"未闭合,a@example.com');
  await p3.click('#add-form button[type=submit]');
  check(await p3.isVisible('#add-error') && (await p3.textContent('#add-error')).includes('引号'), '未闭合引号应被拒绝并说明原因');
  check((await p3.$$('.tcard')).length === 0, '被拒绝的表不应加入');
  check((await p3.evaluate(() => document.activeElement.id)) === 'add-text' && (await p3.getAttribute('#add-text', 'aria-invalid')) === 'true' && (await p3.getAttribute('#add-text', 'aria-describedby')) === 'add-error', '添加失败后焦点回到出错输入,并用 aria-describedby 关联错误')
  await p3.fill('#add-text', '姓名,邮箱\n甲,a@example.com,多出一列');
  await p3.click('#add-form button[type=submit]');
  check((await p3.textContent('#add-error')).includes('列'), '列数超出应被拒绝');
  await p3.fill('#add-name', '注入测试');
  await p3.fill('#add-text', '姓名,邮箱,备注\n=HYPERLINK("http://example.com"),evil@example.com,+86 138\n=HYPERLINK("http://example.com"),evil@example.com,<b>x</b>');
  await p3.click('#add-form button[type=submit]');
  await p3.waitForSelector('.tcard');
  await p3.click('#run');
  await p3.waitForSelector('.cluster');
  check(!(await p3.$('.cluster b')), '用户输入里的 HTML 不应被渲染成标签');
  const [d] = await Promise.all([p3.waitForEvent('download'), p3.click('#export-merged')]);
  const csv = fs.readFileSync(await d.path(), 'utf8');
  check(csv.includes(`'=HYPERLINK(""http://example.com"")`), '合并 CSV 应对公式开头加单引号:' + csv);
  check(csv.includes("'+86 138"), '以 + 开头的备注应加单引号');
  // 已有自己的表时载入示例:一次页内确认,确认后示例标记出现;添加自己的表后标记消失
  await p3.click('#load-sample');
  check(await p3.isVisible('#sample-confirm') && (await p3.textContent('#sample-confirm-scope')).includes('1 张表'), '已有自己的表时载入示例先确认(不再要求先清空)');
  await p3.click('#sample-confirm-yes');
  await p3.waitForSelector('.cluster');
  check((await p3.$$('.tcard')).length === 3 && await p3.isVisible('#sample-badge'), '确认后替换为 3 张示例表并显示示例标记');
  await p3.click('[data-remove]');
  await p3.click('[data-remove]');
  check(await p3.evaluate(() => document.activeElement.hasAttribute('data-remove')), '移除表后焦点转到下一张表的移除按钮');
  await p3.fill('#add-text', '姓名,邮箱\n甲,a@example.com');
  await p3.click('#add-form button[type=submit]');
  check(await p3.isHidden('#sample-badge'), '添加自己的表后示例标记消失');
  await p3.close();

  // ---------- ?today 非法日期回退 ----------
  const p4 = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  watch(p4, 'today 校验');
  await p4.goto(URL.replace('2026-10-20', '2026-02-30'));
  await p4.click('#load-sample');
  await p4.waitForSelector('.cluster');
  const [d4] = await Promise.all([p4.waitForEvent('download'), p4.click('#export-merged')]);
  check(!d4.suggestedFilename().includes('2026-02-30') && /\d{4}-\d{2}-\d{2}/.test(d4.suggestedFilename()), '非法 today 应回退真实今天:' + d4.suggestedFilename());
  await p4.close();

  // ---------- 展示图 ----------
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  watch(show, '展示页');
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(300);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();

  console.log(`断言 ${assertions} 条`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
