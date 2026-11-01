'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { chromium } = require('playwright');
const FALLBACK_EXE = process.env.CHROME_PATH || undefined;
const URL = 'file://' + encodeURI(path.join(__dirname, 'index.html')) + '?today=2026-10-20';
const OUT = path.join(__dirname, 'screenshots');

let assertions = 0;
const problems = [];
function check(cond, msg) { assertions++; console.log((cond ? '通过 ' : '失败 ') + msg); if (!cond) problems.push(msg); }

async function launchBrowser() {
  try { return await chromium.launch(); }
  catch (first) {
    console.log('Playwright 内置 Chromium 启动失败,改用 chrome-headless-shell:' + first.message.split('\n')[0]);
    return chromium.launch({ executablePath: FALLBACK_EXE });
  }
}

// 在系统临时目录造一份真实文件夹(不写进产品目录)
function makeFixtures() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filecheck-'));
  const a = path.join(root, '项目交付包'); const b = path.join(root, '收到的包');
  const w = (dir, rel, data) => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); };
  const big = crypto.randomBytes(40 * 1024 * 1024); // 超过 32MB,走分块哈希路径
  const png = crypto.randomBytes(200000);
  w(a, 'README.md', '# 交付说明\n'); w(a, '素材/logo.png', png); w(a, '素材/说明.txt', '第一版'); w(a, '视频/大文件.bin', big);
  w(a, '图标:最终版.txt', 'x'); w(a, '=公式.txt', 'y'); w(a, '.DS_Store', 'junk');
  // 收到的包:README 缺失,说明.txt 被改,多一个 额外.txt,大文件完整
  w(b, '素材/logo.png', png); w(b, '素材/说明.txt', '第二版(被改动)'); w(b, '视频/大文件.bin', big);
  w(b, '图标:最终版.txt', 'x'); w(b, '=公式.txt', 'y'); w(b, '额外.txt', 'extra'); w(b, '.DS_Store', 'junk2');
  fs.cpSync(b, path.join(root, '收到的包2'), { recursive: true });
  return { root, a, b, b2: path.join(root, '收到的包2'), bigHash: crypto.createHash('sha256').update(big).digest('hex') };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const fx = makeFixtures();
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  const noOverflow = async label => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(`${label}: scrollWidth ${sw} <= innerWidth ${iw}`);
    check(sw <= iw, `${label} 无横向溢出 (${sw} <= ${iw})`);
  };

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

  // 1. 生成清单:真实选择文件夹
  await page.setInputFiles('#gen-dir', fx.a);
  await page.waitForSelector('#gen-result:not([hidden])', { timeout: 120000 });
  const genCount = await page.$$eval('#gen-list li', l => l.length);
  check(genCount === 6, `生成清单列出 6 个文件(.DS_Store 被忽略),实际 ${genCount}`);
  const warnCount = await page.$$eval('#gen-warnings .warn-list li', l => l.length);
  check(warnCount === 1, `跨平台文件名警告 1 条,实际 ${warnCount}`);
  check(await page.isVisible('#gen-unsaved'), '生成结果旁提示「尚未保存」');
  check((await page.textContent('#today-note')).includes('基准日 2026-10-20(由地址参数固定)'), '?today 生效时页面显示基准日');
  await page.focus('#gen-drop');
  const dirChooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  const fc = await dirChooser;
  check(!!fc, '拖放区聚焦后按 Enter 打开文件选择器');
  check((await page.getAttribute('#gen-drop', 'aria-label')) === '选择文件夹或拖入文件', '拖放区可访问名称为「选择文件夹或拖入文件」');
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png'), fullPage: true });

  const [dlJson] = await Promise.all([page.waitForEvent('download'), page.click('#export-json')]);
  const jsonPath = path.join(fx.root, dlJson.suggestedFilename()); await dlJson.saveAs(jsonPath);
  const manifest = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const bigEntry = manifest.files.find(f => f.path === '视频/大文件.bin');
  check(bigEntry && bigEntry.sha256 === fx.bigHash, '40MB 文件的 sha256 与 node:crypto 一致(分块路径)');
  check(manifest.files.every(f => !f.path.startsWith('项目交付包')), '路径不含所选文件夹名');
  const [dlCsv] = await Promise.all([page.waitForEvent('download'), page.click('#export-csv')]);
  const csvPath = path.join(fx.root, dlCsv.suggestedFilename()); await dlCsv.saveAs(csvPath);
  check(fs.readFileSync(csvPath, 'utf8').includes("'=公式.txt"), 'CSV 中以 = 开头的路径加了单引号防护');

  // 2. 核对:导入清单 + 选收到的文件夹
  await page.click('[data-tab="check"]');
  check(await page.isDisabled('#export-current'), '未导入清单时「导出当前清单 JSON」禁用');
  await page.setInputFiles('#man-file', jsonPath);
  await page.waitForFunction(() => document.getElementById('man-summary').textContent.includes('6 个文件'));
  check(await page.isDisabled('#run-check'), '未选收到的文件夹时「开始核对」禁用');
  const [dlCur] = await Promise.all([page.waitForEvent('download'), page.click('#export-current')]);
  const curPath = path.join(fx.root, 'cur-' + dlCur.suggestedFilename()); await dlCur.saveAs(curPath);
  check(JSON.parse(fs.readFileSync(curPath, 'utf8')).files.length === 6, '「导出当前清单 JSON」导出刚导入的 6 个文件');
  await page.setInputFiles('#act-dir', fx.b);
  await page.waitForFunction(() => !document.getElementById('run-check').disabled, null, { timeout: 120000 });
  await page.click('#run-check');
  await page.waitForSelector('#result:not([hidden])');
  const kinds = await page.$$eval('#rows li', l => l.map(x => x.className.replace('st-', '')));
  const count = k => kinds.filter(x => x === k).length;
  check(count('missing') === 1 && count('extra') === 1 && count('mismatch') === 1 && count('name') === 1, `真实核对:缺失 1、多出 1、不一致 1、名称警告 1(实际 ${JSON.stringify(kinds)})`);
  check(!kinds.includes('ok'), '默认筛选「需要处理」不显示一致项');
  await page.selectOption('#filter-status', 'ok');
  check((await page.$$eval('#rows li', l => l.length)) === 4, '筛选「一致」显示 4 个文件');
  await page.selectOption('#filter-status', 'attention');
  await page.fill('#filter-text', '额外');
  check((await page.$$eval('#rows li', l => l.length)) === 1, '路径搜索「额外」得到 1 条');
  await page.fill('#filter-text', '');
  const [dlMd] = await Promise.all([page.waitForEvent('download'), page.click('#export-md')]);
  const mdPath = path.join(fx.root, dlMd.suggestedFilename()); await dlMd.saveAs(mdPath);
  const md = fs.readFileSync(mdPath, 'utf8');
  check(md.includes('发现差异') && md.includes('| 缺失 | 1 |') && md.includes('README.md'), 'Markdown 报告含差异结论与缺失文件');
  const [dlRc] = await Promise.all([page.waitForEvent('download'), page.click('#export-report-csv')]);
  check(/核对报告-2026-10-20\.csv/.test(dlRc.suggestedFilename()), 'CSV 报告文件名带 ?today 固定日期');
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png'), fullPage: true });
  await noOverflow('桌面');
  await page.setViewportSize({ width: 768, height: 900 });
  await noOverflow('768px');
  await page.screenshot({ path: path.join(OUT, '03b-768px.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });

  // 2b. 重新选择文件:开始读取即作废旧结果,处理期间不能导出旧报告
  await page.setInputFiles('#act-dir', fx.b2);
  check(await page.isHidden('#result') && await page.isHidden('#export-md'), '重新选择文件后立即隐藏旧结果与报告导出按钮');
  check(await page.isDisabled('#run-check'), '重新选择文件处理中「开始核对」禁用');
  await page.waitForFunction(() => !document.getElementById('run-check').disabled, null, { timeout: 120000 });
  check(await page.isHidden('#result'), '读取完成但未重新核对前仍无旧结果');
  await page.click('#run-check');
  await page.waitForSelector('#result:not([hidden])');

  // 3. 导出前状态与界面一致:改忽略列表 → 结果作废、导出不可见
  await page.fill('#ignore-list', '.DS_Store\nThumbs.db\n__MACOSX/\n*.txt');
  await page.dispatchEvent('#ignore-list', 'change');
  check(await page.isHidden('#result'), '忽略列表改动后旧结果与导出按钮一并隐藏');
  check(await page.isVisible('#stale-note'), '显示「结果已作废」提示');
  check(await page.isDisabled('#run-check'), '收到的文件需按新规则重新读取,核对按钮禁用');
  await page.click('#ignore-reset');

  // 4. 示例:已有清单时先在页内确认
  await page.click('#load-sample');
  check(await page.isVisible('#sample-confirm'), '已有清单时点「载入示例」先出现页内替换确认');
  check((await page.textContent('#man-summary')).includes('文件清单-2026-10-20.json'), '确认前当前清单未被覆盖');
  await page.click('#sample-no');
  check((await page.textContent('#man-summary')).includes('文件清单-2026-10-20.json') && await page.isHidden('#sample-confirm'), '点取消后清单保持不变');
  await page.click('#load-sample');
  await page.click('#sample-yes');
  await page.waitForSelector('#result:not([hidden])');
  check(await page.isVisible('#sample-badge'), '示例结果带「合成示例」标识');
  check(await page.isVisible('#man-sample-badge'), '清单区带「合成示例」标识');
  await page.reload();
  await page.click('[data-tab="check"]');
  check(await page.isVisible('#man-sample-badge'), '刷新后清单区仍带「合成示例」标识');
  await page.fill('#ignore-list', '.DS_Store\n*.tmp');
  await page.dispatchEvent('#ignore-list', 'change');
  await page.click('#load-sample');
  check(await page.isVisible('#sample-confirm'), '仅忽略列表偏离默认值时,载入示例也先确认');
  await page.click('#sample-no');
  await page.click('#ignore-reset');
  await page.click('#load-sample');
  await page.click('#sample-yes');
  await page.waitForSelector('#result:not([hidden])');
  const sampleKinds = await page.$$eval('#rows li', l => l.map(x => x.className.replace('st-', '')));
  check(sampleKinds.filter(k => k === 'missing').length === 2 && sampleKinds.filter(k => k === 'extra').length === 1 && sampleKinds.filter(k => k === 'mismatch').length === 1 && sampleKinds.filter(k => k === 'case').length === 1 && sampleKinds.filter(k => k === 'name').length === 1, '示例:2 缺失 / 1 多出 / 1 不一致 / 1 大小写 / 1 非法名');

  // 5. 手机
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  await noOverflow('手机');
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });

  // 6. 导入校验:非法清单整份拒绝
  await page.fill('#man-text', '{"files":[{"path":"a","size":"1","sha256":"zz"}]}');
  await page.click('#man-parse');
  check((await page.textContent('#man-error')).includes('被拒绝'), '非法清单被拒绝并给出原因');
  check((await page.textContent('#man-summary')).includes('示例清单'), '拒绝后原清单保持不变');
  await page.close();

  // 7. 损坏存档:整份拒绝、原文下载、存入前归档并回读
  const corruptRaw = '{"ignore":["*.tmp"],"manifest":{"files":[{"path":"a","size":1,"sha256":"bad"}]},"manifestName":"旧清单","manifestIsSample":false}';
  const corruptCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await corruptCtx.addInitScript(raw => localStorage.setItem('filecheck.v1', raw), corruptRaw);
  const corruptPage = await corruptCtx.newPage();
  corruptPage.on('pageerror', e => problems.push('pageerror(corrupt): ' + e.message));
  await corruptPage.goto(URL);
  check(await corruptPage.isVisible('#recovery-warning'), '有效忽略规则+损坏清单时显示恢复提示');
  check((await corruptPage.inputValue('#ignore-list')) === '.DS_Store\nThumbs.db\n__MACOSX/', '整份存档拒绝,未部分加载其中的忽略规则');
  check((await corruptPage.textContent('#man-summary')).includes('尚未导入'), '损坏存档未加载清单');
  const [rawDl] = await Promise.all([corruptPage.waitForEvent('download'), corruptPage.click('#download-raw')]);
  const rawPath = path.join(fx.root, 'raw-' + rawDl.suggestedFilename()); await rawDl.saveAs(rawPath);
  check(fs.readFileSync(rawPath, 'utf8') === corruptRaw, '下载的损坏存档原文逐字节一致');
  const [memoryDl] = await Promise.all([corruptPage.waitForEvent('download'), corruptPage.click('#export-memory')]);
  const memoryPath = path.join(fx.root, 'memory-' + memoryDl.suggestedFilename()); await memoryDl.saveAs(memoryPath);
  const memory = JSON.parse(fs.readFileSync(memoryPath, 'utf8'));
  check(Array.isArray(memory.ignore) && memory.manifest === null && typeof memory.manifestName === 'string' && memory.manifestIsSample === false, '当前有效内存 JSON 可解析且字段完整');
  check(await corruptPage.evaluate(text => {
    const back = FileCheckCore.parseStoredState(text);
    return back.manifest === null && back.ignore.join('|') === FileCheckCore.DEFAULT_IGNORE.join('|');
  }, fs.readFileSync(memoryPath, 'utf8')), '导出的有效内存 JSON 可由页面校验器往返读取');
  await corruptPage.click('#load-sample');
  await corruptPage.waitForSelector('#result:not([hidden])');
  const archiveState = await corruptPage.evaluate(raw => {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('filecheck.v1.recovery.'));
    return { keys, exact: keys.length === 1 && localStorage.getItem(keys[0]) === raw, mainChanged: localStorage.getItem('filecheck.v1') !== raw };
  }, corruptRaw);
  check(archiveState.exact && archiveState.mainChanged, '覆盖前已归档原文并回读,然后才写入新存档');
  await corruptCtx.close();

  // 8. 非法 JSON 与错误类型均不当作空状态
  for (const [label, raw, needle] of [
    ['非法 JSON', '{bad', '不是有效 JSON'],
    ['错误类型', '{"ignore":"*.tmp","manifest":null,"manifestName":"","manifestIsSample":false}', 'ignore 必须']
  ]) {
    const c = await browser.newContext();
    await c.addInitScript(value => localStorage.setItem('filecheck.v1', value), raw);
    const p = await c.newPage(); await p.goto(URL);
    check(await p.isVisible('#recovery-warning') && (await p.textContent('#recovery-message')).includes(needle), `${label}明确报错,未伪装成无存档`);
    await c.close();
  }

  // 9. 归档失败:主键原文不变,新状态只留内存
  const archiveFailCtx = await browser.newContext({ acceptDownloads: true });
  await archiveFailCtx.addInitScript(raw => {
    localStorage.setItem('filecheck.v1', raw);
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (String(key).startsWith('filecheck.v1.recovery.')) throw new DOMException('archive blocked', 'QuotaExceededError');
      return originalSet.call(this, key, value);
    };
  }, corruptRaw);
  const archiveFailPage = await archiveFailCtx.newPage(); await archiveFailPage.goto(URL);
  await archiveFailPage.click('#load-sample'); await archiveFailPage.waitForSelector('#result:not([hidden])');
  check(await archiveFailPage.isVisible('#save-warning'), '归档失败时明确提示当前状态未保存');
  check(await archiveFailPage.evaluate(raw => localStorage.getItem('filecheck.v1') === raw, corruptRaw), '归档失败时主键保留原始损坏文本');
  check((await archiveFailPage.textContent('#man-summary')).includes('示例清单'), '归档失败后新有效清单仍在内存可用');
  await archiveFailCtx.close();

  // 10. 主键 setItem 无效时,回读不一致必须保持未保存和恢复入口
  const mainNoopCtx = await browser.newContext();
  await mainNoopCtx.addInitScript(raw => {
    localStorage.setItem('filecheck.v1', raw);
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'filecheck.v1') return;
      return originalSet.call(this, key, value);
    };
  }, corruptRaw);
  const mainNoopPage = await mainNoopCtx.newPage(); await mainNoopPage.goto(URL);
  await mainNoopPage.click('#load-sample'); await mainNoopPage.waitForSelector('#result:not([hidden])');
  check(await mainNoopPage.isVisible('#save-warning'), '主键 setItem 无效时回读检出未保存');
  check(await mainNoopPage.isVisible('#download-raw') && await mainNoopPage.isVisible('#export-memory-unsaved'), '主键回读不一致时原文和有效内存均可导出');
  check(await mainNoopPage.evaluate(raw => localStorage.getItem('filecheck.v1') === raw, corruptRaw), '主键 setItem 无效时未误报保存成功');
  await mainNoopCtx.close();

  // 11. 首次主键写失败后,恢复副本被删除或篡改时,重试必须重新归档
  for (const mode of ['delete', 'corrupt']) {
    const retryCtx = await browser.newContext();
    await retryCtx.addInitScript(raw => {
      localStorage.setItem('filecheck.v1', raw);
      const originalSet = Storage.prototype.setItem; let failMainOnce = true;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'filecheck.v1' && failMainOnce) { failMainOnce = false; throw new DOMException('first main write blocked', 'QuotaExceededError'); }
        return originalSet.call(this, key, value);
      };
    }, corruptRaw);
    const retryPage = await retryCtx.newPage(); await retryPage.goto(URL);
    await retryPage.click('#load-sample'); await retryPage.waitForSelector('#result:not([hidden])');
    const firstKey = await retryPage.evaluate(() => Object.keys(localStorage).find(k => k.startsWith('filecheck.v1.recovery.')));
    check(!!firstKey && await retryPage.isVisible('#save-warning'), `${mode} 场景首次主键写失败后恢复副本已存在`);
    await retryPage.evaluate(({ key, action }) => {
      if (action === 'delete') localStorage.removeItem(key); else localStorage.setItem(key, 'tampered');
    }, { key: firstKey, action: mode });
    await retryPage.fill('#ignore-list', '.DS_Store\nThumbs.db\n__MACOSX/\n*.retry');
    await retryPage.dispatchEvent('#ignore-list', 'change');
    const retried = await retryPage.evaluate(raw => {
      const keys = Object.keys(localStorage).filter(k => k.startsWith('filecheck.v1.recovery.'));
      return { mainChanged: localStorage.getItem('filecheck.v1') !== raw, exactCopies: keys.filter(k => localStorage.getItem(k) === raw).length };
    }, corruptRaw);
    check(retried.mainChanged && retried.exactCopies === 1 && await retryPage.isHidden('#save-warning'), `${mode} 后重试重新验证归档,再保存主键`);
    await retryCtx.close();
  }

  // 12. 固定时钟撞上旧恢复键时,保留旧值并使用唯一后缀
  const collisionCtx = await browser.newContext();
  await collisionCtx.addInitScript(raw => {
    localStorage.setItem('filecheck.v1', raw);
    localStorage.setItem('filecheck.v1.recovery.1700000000000', 'older recovery');
    Date.now = () => 1700000000000;
  }, corruptRaw);
  const collisionPage = await collisionCtx.newPage(); await collisionPage.goto(URL);
  await collisionPage.click('#load-sample'); await collisionPage.waitForSelector('#result:not([hidden])');
  const collision = await collisionPage.evaluate(raw => ({
    old: localStorage.getItem('filecheck.v1.recovery.1700000000000'),
    fresh: localStorage.getItem('filecheck.v1.recovery.1700000000000.1'),
    raw
  }), corruptRaw);
  check(collision.old === 'older recovery' && collision.fresh === corruptRaw, '固定时钟碰撞不覆盖旧恢复键,改用 .1');
  await collisionCtx.close();

  // 13. 读取失败与“没有存档”分开呈现
  const readFailCtx = await browser.newContext();
  await readFailCtx.addInitScript(() => {
    globalThis.__removeCalls = 0;
    const originalRemove = Storage.prototype.removeItem;
    Storage.prototype.getItem = function () { throw new DOMException('read blocked', 'SecurityError'); };
    Storage.prototype.removeItem = function (key) { globalThis.__removeCalls++; return originalRemove.call(this, key); };
  });
  const readFailPage = await readFailCtx.newPage(); await readFailPage.goto(URL);
  check(await readFailPage.isVisible('#recovery-warning') && (await readFailPage.textContent('#recovery-message')).includes('不等于“没有存档”'), '读取失败有独立提示');
  check(await readFailPage.isHidden('#download-raw'), '读取失败时不伪造可下载的原文');
  await readFailPage.click('#load-sample'); await readFailPage.waitForSelector('#result:not([hidden])');
  await readFailPage.fill('#ignore-list', '.DS_Store\n*.keep'); await readFailPage.dispatchEvent('#ignore-list', 'change');
  const beforeClear = { ignore: await readFailPage.inputValue('#ignore-list'), summary: await readFailPage.textContent('#man-summary') };
  await readFailPage.click('#clear-data'); await readFailPage.click('#clear-yes');
  check(await readFailPage.evaluate(() => globalThis.__removeCalls) === 0, '读取失败时确认清空也不调用 removeItem');
  check((await readFailPage.inputValue('#ignore-list')) === beforeClear.ignore && (await readFailPage.textContent('#man-summary')) === beforeClear.summary, '读取失败时确认清空不改动当前内存状态');
  check(await readFailPage.isVisible('#save-warning') && (await readFailPage.textContent('#toast')).includes('未清空任何数据'), '读取失败时清空操作显示准确拦截提示');
  await readFailCtx.close();

  // 14. 存储配额失败不静默
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); }; });
  const p2 = await ctx.newPage();
  p2.on('pageerror', e => problems.push('pageerror(storage): ' + e.message));
  await p2.goto(URL);
  await p2.click('#load-sample');
  await p2.waitForSelector('#result:not([hidden])');
  check(await p2.isVisible('#save-warning'), 'setItem 抛 QuotaExceededError 时「未保存」提示持续可见');
  check(await p2.isVisible('#export-memory-unsaved'), '配额失败时当前有效内存状态仍可导出');
  check(await p2.isHidden('#toast'), '写入失败时不出现成功提示');
  await ctx.close();

  // 展示图
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  show.on('pageerror', e => problems.push('showcase pageerror: ' + e.message));
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(300);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();
  fs.rmSync(fx.root, { recursive: true, force: true });

  console.log(`断言共 ${assertions} 条`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
