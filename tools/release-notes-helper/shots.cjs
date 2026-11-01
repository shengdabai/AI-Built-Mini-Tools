'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const FALLBACK_EXE = process.env.CHROME_PATH || undefined;
const URL = 'file://' + encodeURI(path.join(__dirname, 'index.html')) + '?today=2026-10-20';
const OUT = path.join(__dirname, 'screenshots');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let browser;
  try { browser = await chromium.launch(); }
  catch (e) {
    if (!fs.existsSync(FALLBACK_EXE)) throw e;
    console.log('Playwright bundled Chromium unavailable; using chrome-headless-shell fallback.');
    browser = await chromium.launch({ executablePath: FALLBACK_EXE });
  }
  const problems = [];
  let passed = 0;
  const check = (cond, msg) => { if (cond) passed += 1; else problems.push('断言失败:' + msg); };
  const watch = (page, tag) => {
    page.on('console', m => { if (m.type() === 'error') problems.push(`${tag} console: ${m.text()}`); });
    page.on('pageerror', e => problems.push(`${tag} pageerror: ${e.message}`));
  };
  const noOverflow = async (page, label) => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(`${label}: scrollWidth ${sw} <= innerWidth ${iw} -> ${sw <= iw ? 'OK' : 'FAIL'}`);
    check(sw <= iw, `${label} 横向溢出 ${sw} > ${iw}`);
  };

  const quiet = pg => pg.waitForSelector('#toast', { state: 'hidden', timeout: 8000 });

  // ---------- 桌面主流程 ----------
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  watch(page, '桌面');
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  check(await page.inputValue('#date') === '2026-10-20', '?today 固定日期未生效');
  check((await page.textContent('#today-note')).includes('基准日 2026-10-20(由地址参数固定)') && await page.isVisible('#today-note'), '?today 生效时持续显示「基准日 …(由地址参数固定)」');
  check(await page.isHidden('#sample-badge-in'), '空状态不显示合成示例标记');
  check(await page.isDisabled('#dl-notes'), '空状态下导出按钮应禁用');
  check((await page.textContent('#export-hint')).includes('暂不能导出'), '空状态应给出禁用原因');
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

  await page.click('#load-sample');
  await page.waitForSelector('.item-row');
  check(await page.isVisible('#sample-badge-in') && await page.isVisible('#sample-badge-out'), '载入示例后日志区与预览区都持续显示「合成示例,非真实仓库」');
  check((await page.textContent('#log-status')).includes('22 条提交'), '示例应识别 22 条提交');
  check((await page.textContent('#log-status')).includes('原始 git log'), '示例应识别为原始 git log');
  check((await page.textContent('#version-card')).includes('2.0.0'), '版本建议应为 2.0.0');
  check(await page.locator('.item-row').count() === 13, '默认条目数应为 13');
  await page.locator('.item-row', { hasText: 'Rename config file' }).locator('input').check();
  await page.locator('.item-row', { hasText: 'Add dark theme toggle' }).locator('input').check();
  let preview = await page.textContent('#preview');
  check(preview.includes('升级时需要你操作'), '勾选用户操作后预览应出现该节');
  check(await page.locator('#preview a[href="https://github.com/example/demo-app/issues/142"]').count() === 1, '#142 应链接到示例仓库');
  await quiet(page);
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png'), fullPage: true });
  await noOverflow(page, '桌面');

  // 已有勾选等草稿时,载入另一个示例先页内确认;取消后原状态不变
  await page.click('#load-oneline');
  const rs = await page.textContent('#replace-scope');
  check(await page.isVisible('#replace-confirm') && rs.includes('2 条「需要用户操作」勾选') && rs.includes('git log'), `载入示例前出现页内确认并写明替换范围(${rs})`);
  check((await page.textContent('#log-status')).includes('原始 git log') && await page.locator('.item-row', { hasText: 'Rename config file' }).locator('input').isChecked(), '确认前原日志与勾选不变');
  await page.click('#replace-no');
  check(await page.isHidden('#replace-confirm') && (await page.textContent('#log-status')).includes('原始 git log'), '取消后保持原状态');

  // 勾选 docs 后条目增加,取消后恢复
  await page.check('#opt-docs');
  check(await page.locator('.item-row').count() === 15, '勾选 docs 后应有 15 条');
  await page.uncheck('#opt-docs');
  check(await page.locator('.item-row').count() === 13, '取消 docs 后应回到 13 条');

  // 手改 → 改输入 → 过期禁用 → 处理后恢复
  await page.click('#tab-edit');
  await page.fill('#md-edit', (await page.inputValue('#md-edit')) + '\n升级前请先备份配置目录。\n');
  check(await page.isEnabled('#dl-notes'), '手改后(输入未变)应仍可导出');
  await page.click('#reset-edit');
  check(await page.isVisible('#reset-confirm') && (await page.inputValue('#md-edit')).includes('升级前请先备份配置目录'), '有手改时「恢复为自动生成」先出现页内确认,确认前手改仍在');
  await page.click('#reset-no');
  check(await page.isHidden('#reset-confirm') && (await page.inputValue('#md-edit')).includes('升级前请先备份配置目录'), '取消后手改保留');
  await page.fill('#repo', 'https://github.com/example/other-app');
  check(await page.isVisible('#stale'), '改输入后应出现过期提示');
  check(await page.isDisabled('#dl-notes') && await page.isDisabled('#copy-changelog'), '过期时导出按钮应全部禁用');
  await page.click('#stale-regen');
  check(!(await page.inputValue('#md-edit')).includes('升级前请先备份配置目录'), '丢弃手改后应恢复自动生成');
  check((await page.inputValue('#md-edit')).includes('other-app/issues/142'), '重新生成应使用新仓库地址');
  check(await page.isEnabled('#dl-notes'), '处理后应恢复导出');
  await page.fill('#repo', 'https://github.com/example/demo-app');
  await page.fill('#md-edit', (await page.inputValue('#md-edit')) + '\n升级前请先备份配置目录。\n');

  // 发布版本非法 → 禁用
  await page.fill('#release', '2.0');
  check(await page.isDisabled('#dl-notes'), '非法发布版本应禁用导出');
  check(await page.isVisible('#err-release') && (await page.getAttribute('#release', 'aria-invalid')) === 'true' && (await page.getAttribute('#release', 'aria-describedby')) === 'err-release', '发布版本错误显示在输入旁并用 aria-describedby 关联');
  await page.fill('#release', '');
  check(await page.isEnabled('#dl-notes'), '清空发布版本后应回到建议版本并可导出');

  // 导出与复制
  await page.click('#tab-preview');
  const [d1] = await Promise.all([page.waitForEvent('download'), page.click('#dl-notes')]);
  check(d1.suggestedFilename() === 'release-notes-2.0.0.md', '下载文件名应为 release-notes-2.0.0.md,实际 ' + d1.suggestedFilename());
  const notes = fs.readFileSync(await d1.path(), 'utf8');
  check(notes.startsWith('<!-- 合成示例') && notes.includes('\n## 2.0.0 (2026-10-20)'), '合成示例的发布说明首行标注,标题仍在');
  check(notes.includes('升级前请先备份配置目录。') && notes.includes('### 升级时需要你操作'), 'Release Notes 应含手改与用户操作节');
  const [d2] = await Promise.all([page.waitForEvent('download'), page.click('#dl-changelog')]);
  const cl = fs.readFileSync(await d2.path(), 'utf8');
  check(cl.startsWith('<!-- 合成示例') && cl.includes('\n## [2.0.0] - 2026-10-20') && cl.includes('### Added') && cl.includes('### Fixed'), 'CHANGELOG 片段结构');
  check(!cl.includes('升级前请先备份配置目录'), 'CHANGELOG 不应含手改');
  await page.click('#copy-notes');
  await page.waitForFunction(() => document.getElementById('copy-msg').textContent.length > 0);
  console.log('复制结果:', await page.textContent('#copy-msg'));
  check((await page.textContent('#copy-msg')).length > 0, '复制后应给出结果提示');
  await page.click('#tab-preview');
  await quiet(page);
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png'), fullPage: true });

  // 刷新后数据仍在(localStorage)
  await page.reload();
  check((await page.inputValue('#log')).includes('commit '), '刷新后日志应保留');
  check(await page.isVisible('#sample-badge-in') && await page.isVisible('#sample-badge-out') && await page.isVisible('#today-note'), '刷新后「合成示例」标记与基准日说明仍在');
  check((await page.inputValue('#md-edit')).includes('升级前请先备份配置目录'), '刷新后手改应保留');

  // 草稿恢复:版本号输入到半成品 `1.` 后刷新,日志、勾选、手改都应还在
  await page.fill('#current', '1.');
  await page.reload();
  check(await page.inputValue('#current') === '1.', '半成品版本号刷新后应恢复');
  check((await page.inputValue('#log')).includes('commit '), '半成品版本号时刷新,日志应仍在');
  check(await page.locator('.item-row', { hasText: 'Rename config file' }).locator('input').isChecked(), '半成品版本号时刷新,勾选应仍在');
  check((await page.inputValue('#md-edit')).includes('升级前请先备份配置目录'), '半成品版本号时刷新,手改应仍在');
  check(await page.isDisabled('#dl-notes'), '半成品版本号时仍应禁用导出');
  check(await page.isVisible('#err-current') && (await page.getAttribute('#current', 'aria-invalid')) === 'true', '当前版本格式错误显示在输入旁');

  // 手改丢弃:确认后才真正恢复
  await page.click('#tab-edit');
  await page.click('#reset-edit');
  await page.click('#reset-yes');
  check(!(await page.inputValue('#md-edit')).includes('升级前请先备份配置目录'), '确认丢弃后恢复为自动生成');
  // 改日志后合成示例标记消失
  await page.fill('#log', (await page.inputValue('#log')) + '\n');
  check(await page.isHidden('#sample-badge-in') && await page.isHidden('#sample-badge-out'), '改动日志后合成示例标记消失');

  // 清空数据走页内确认
  await page.click('#clear-data');
  check(await page.isVisible('#clear-confirm') && (await page.textContent('#clear-scope')).includes('git log'), '清空前应出现页内确认区并写明范围');
  await page.click('#clear-yes');
  check((await page.inputValue('#log')) === '', '清空后日志应为空');
  check(await page.evaluate(() => localStorage.getItem('releasenotes.v1')) === null, '清空后本机存储应删除');
  await page.close();

  // ---------- 非法 ?today 与坏存储 ----------
  const p2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(p2, '非法today');
  await p2.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('releasenotes.v1', '{"log":5}'); } });
  await p2.goto('file://' + encodeURI(path.join(__dirname, 'index.html')) + '?today=2026-02-30');
  check(/^\d{4}-\d{2}-\d{2}$/.test(await p2.inputValue('#date')) && await p2.inputValue('#date') !== '2026-02-30', '非法 ?today 应回退真实今天');
  check(await p2.isVisible('#load-note'), '存储里的坏数据应被拒绝并提示');
  await p2.close();

  // ---------- 存储写入失败不能静默 ----------
  const p3 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(p3, '存储失败');
  await p3.addInitScript(() => { Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); }; });
  await p3.goto(URL);
  await p3.click('#load-sample');
  check(await p3.isVisible('#save-warn'), '写入失败时必须显示持续可见的「未保存」提示');
  check(!(await p3.textContent('#toast')).includes('已载入') || await p3.isHidden('#toast'), '写入失败时不能显示成功提示');
  await p3.fill('#current', '1.4.3');
  check(await p3.isVisible('#save-warn'), '继续编辑后「未保存」提示仍应可见');
  await p3.close();

  // ---------- 窄屏平板 ----------
  const tablet = await browser.newPage({ viewport: { width: 768, height: 1024 }, deviceScaleFactor: 1 });
  watch(tablet, '平板');
  await tablet.goto(URL);
  await tablet.evaluate(() => localStorage.clear());
  await tablet.reload();
  await tablet.click('#load-sample');
  await tablet.waitForSelector('.item-row');
  await noOverflow(tablet, '平板');
  await tablet.screenshot({ path: path.join(OUT, '05-平板-768.png'), fullPage: true });
  await tablet.close();

  // ---------- 手机 ----------
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  watch(m, '手机');
  await m.goto(URL);
  await m.evaluate(() => localStorage.clear());
  await m.reload();
  await m.click('#load-sample');
  await m.waitForSelector('.item-row');
  await m.locator('.item-row', { hasText: 'Rename config file' }).locator('input').check();
  await m.click('#tab-changelog');
  await noOverflow(m, '手机');
  const sizes = await m.evaluate(() => {
    const r = e => { const b = e.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; };
    return { cb: r(document.getElementById('opt-docs')), lab: r(document.querySelector('label.check')), item: r(document.querySelector('.item-row')), icb: r(document.querySelector('.item-row input')) };
  });
  check(sizes.cb[0] >= 24 && sizes.cb[1] >= 24 && sizes.icb[0] >= 24 && sizes.icb[1] >= 24 && sizes.lab[1] >= 32 && sizes.item[1] >= 32, `手机端触控尺寸 checkbox ${sizes.cb} 条目 checkbox ${sizes.icb} label ${sizes.lab} 条目行 ${sizes.item}`);
  await quiet(m);
  await m.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
  await m.close();

  // ---------- 展示图 ----------
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  watch(show, '展示页');
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForFunction(() => [...document.images].every(img => img.complete));
  const decoded = await show.locator('img').evaluateAll(images => Promise.all(images.map(img => img.decode().then(() => true, () => false))));
  check(decoded.every(Boolean), '展示页图片应全部成功解码');
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();

  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log(`全部通过(${passed} 条断言);截图已写入 screenshots/ 与 showcase.png`);
})().catch(e => { console.error(e); process.exit(1); });
