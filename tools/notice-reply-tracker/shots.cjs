'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const Core = require('./core.js');
const EXE = process.env.CHROME_PATH || undefined;
const URL = 'file://' + encodeURI(path.join(__dirname, 'index.html'));
const OUT = path.join(__dirname, 'screenshots');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });
  const problems = [];
  let asserts = 0;
  const check = (cond, msg) => { asserts++; if (!cond) problems.push('断言失败:' + msg); };
  const watch = (page, tag) => {
    page.on('console', m => { if (m.type() === 'error') problems.push(`${tag} console: ${m.text()}`); });
    page.on('pageerror', e => problems.push(`${tag} pageerror: ${e.message}`));
  };

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page, '主页面');
  const noOverflow = async label => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(`${label}: scrollWidth ${sw} <= innerWidth ${iw} → ${sw <= iw ? 'OK' : 'FAIL'}`);
    check(sw <= iw, `${label} 横向溢出 ${sw} > ${iw}`);
  };
  const nums = async () => page.$$eval('#summary .stat__n', n => n.map(x => Number(x.textContent)));

  // ---- 空状态
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  check(await page.isVisible('#empty-guide'), '空状态应显示引导');
  check(await page.isDisabled('#export-csv'), '名单为空时回执表 CSV 应禁用');
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

  // ---- 载入示例(无数据时直接载入)
  await page.click('#load-sample');
  await page.waitForSelector('.cat');
  let n = await nums();
  console.log('示例统计 [名单,已回,未回,无法识别]:', n.join(','));
  check(n.join(',') === '30,20,10,3', '示例统计应为 30,20,10,3,实际 ' + n.join(','));
  check(await page.locator('.cat').count() === 5, '示例应出现 5 个分类分组');
  check(!(await page.isVisible('#empty-guide')), '载入示例后引导应隐藏');
  check((await page.textContent('#roster-info')).includes('已识别 30 人'), '名单提示');

  // ---- 每条结果旁的匹配依据与人工确认提示
  const basisCount = await page.locator('#replied-list .entry__basis').count();
  check(basisCount === 20 && (await page.locator('#replied-list .entry__basis').first().textContent()).includes('姓名匹配:'), '已回列表每一条都显示姓名匹配方式和分类依据(共 ' + basisCount + ' 条)');
  const decl = await page.locator('.cat--decline').textContent();
  check(decl.includes('命中关键词「') && decl.includes('请人工确认'), '「不参加」分组显示命中关键词并提示请人工确认');
  check(await page.locator('#replied-list .entry__review', { hasText: '昵称里包含姓名' }).count() > 0, '包含匹配的条目提示请人工确认是否本人');

  // ---- 「载入示例」不能无确认覆盖
  await page.fill('#title', '我改过的标题');
  await page.click('#load-sample');
  check(await page.isVisible('#confirm-box'), '已有数据时载入示例应先出现替换确认');
  check((await page.inputValue('#title')) === '我改过的标题', '确认前应保留原状态');
  await page.click('#confirm-no');
  check(!(await page.isVisible('#confirm-box')), '取消后确认区应关闭');
  check((await page.inputValue('#title')) === '我改过的标题', '取消后标题仍为原值');
  await page.click('#load-sample');
  await page.click('#confirm-yes');
  check((await page.inputValue('#title')).startsWith('合成示例'), '确认后应替换为示例');

  // ---- 多轮:追加第三批,最后一次优先
  await page.click('#add-batch');
  check(await page.locator('[data-batch-text]').count() === 3, '应有 3 个批次');
  await page.fill('[data-batch-text="b3"]', '郑浩宇: 同意\n谢雨欣 21:30\n收到\n\n=cmd|calc: 收到');
  n = await nums();
  check(n.join(',') === '30,22,8,4', '追加第三批后应为 30,22,8,4,实际 ' + n.join(','));
  console.log('追加第三批后:', n.join(','));
  // 微信导出里陈雅琪(请假→改了参加):最终应为同意
  const agreeText = await page.textContent('.cat--agree');
  check(agreeText.includes('陈雅琪') && agreeText.includes('回复了 2 次'), '陈雅琪最后一次应归「同意」且标注回复 2 次');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png') });

  // ---- 边界:超长文本 + 半成品输入,保存后 reload 仍在
  const big = Array.from({ length: 8000 }, (_, i) => `压测${i % 50}: 收到`).join('\n') + '\n半成品没有分隔符\n';
  // 超长文本用 evaluate 写入并派发 input 事件(Playwright 的 fill 对 ~100KB 文本过慢)
  await page.evaluate(t => { const ta = document.querySelector('[data-batch-text="b3"]'); ta.value = t; ta.dispatchEvent(new Event('input', { bubbles: true })); }, big + '=cmd|calc: 收到');
  await page.reload();
  check(!(await page.isVisible('#load-error')), 'reload 后不应出现读取失败');
  check((await page.inputValue('[data-batch-text="b3"]')).length === (big + '=cmd|calc: 收到').length, 'reload 后超长文本应完整保留');
  check((await page.textContent('[data-batch-info="b3"]')).includes('无法解析'), '半成品行应被提示');
  await page.fill('[data-batch-text="b3"]', '郑浩宇: 同意\n谢雨欣 21:30\n收到\n\n=cmd|calc: 收到');
  await page.reload();
  n = await nums();
  check(n.join(',') === '30,22,8,4', 'reload 后统计应保持 30,22,8,4,实际 ' + n.join(','));
  check((await page.textContent('#save-status')) === '' , '刚 reload 未写入时不应显示「已保存」');

  // ---- 导出
  const dl = async sel => { const [d] = await Promise.all([page.waitForEvent('download'), page.click(sel)]); return d; };
  let d = await dl('#export-csv');
  const csv = fs.readFileSync(await d.path(), 'utf8');
  console.log('CSV 文件名:', d.suggestedFilename());
  check(csv.charCodeAt(0) === 0xFEFF, 'CSV 应带 BOM');
  check(csv.includes("'=cmd|calc"), 'CSV 公式注入应加单引号前缀');
  check(csv.split('\r\n').length === 1 + 30 + 4, 'CSV 行数应为 表头 + 30 人 + 4 条无法识别');
  d = await dl('#export-txt');
  const txt = fs.readFileSync(await d.path(), 'utf8');
  check(txt === await page.inputValue('#remind-text') && txt.startsWith('@'), '催回文本应与界面一致');
  check(txt.split('\n').length === 8, '催回文本应为 8 行');
  d = await dl('#export-json');
  const bak = Core.validateImport(fs.readFileSync(await d.path(), 'utf8'));
  check(bak.ok && bak.state.batches.length === 3, 'JSON 备份应能通过 validateImport');

  // ---- 导入校验:拒绝坏文件,当前数据不变
  await page.setInputFiles('#import-file', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ app: 'notice-receipts', version: 1, title: 1 })) });
  await page.waitForSelector('#load-error:not([hidden])');
  check((await page.textContent('#load-error-text')).includes('title'), '导入被拒绝应写明原因');
  n = await nums();
  check(n.join(',') === '30,22,8,4', '导入被拒绝后当前数据不变');
  // 合法备份在已有数据时先确认
  await page.setInputFiles('#import-file', { name: 'ok.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(Core.createState())) });
  await page.waitForSelector('#confirm-box:not([hidden])');
  n = await nums();
  check(n[0] === 30, '导入确认前保留原状态');
  await page.click('#confirm-no');

  // ---- 结果与导出截图
  await page.locator('#h-export').scrollIntoViewIfNeeded();
  await noOverflow('桌面');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png'), fullPage: true });

  // ---- 清空
  await page.click('#clear-all');
  check(await page.isVisible('#confirm-box'), '清空前应出现页内确认');
  await page.click('#confirm-yes');
  n = await nums();
  check(n.join(',') === '0,0,0,0', '清空后统计归零');
  check(await page.isVisible('#empty-guide'), '清空后回到空状态引导');

  // ---- 名单 CSV 引号与整份拒绝
  await page.fill('#roster', '"张三","一班"\n"李,四"');
  check((await page.textContent('#roster-info')).includes('已识别 2 人'), '引号包裹的名单应识别 2 人');
  await page.fill('#roster', '张三\n"李四');
  check((await page.textContent('#roster-info')).includes('整份拒绝') && (await nums())[0] === 0, '引号未闭合应整份拒绝名单');
  await page.fill('#roster', '姓名, 备注\n张三, 一班\n李四, 二班');
  check((await page.textContent('#roster-info')).includes('已识别为表头') && (await page.textContent('#roster-info')).includes('已识别 2 人') && (await nums())[0] === 2, '首行「姓名, 备注」识别为表头:名单 2 人且有提示');
  await page.fill('#roster', '姓名\n张三');
  check((await nums())[0] === 1, '单列表头「姓名」不计入名单');
  await page.fill('#roster', '');

  // ---- 替换确认:只改了模板 / 只改了关键词 也要确认
  await page.fill('#template', '@{姓名} 今晚前回复');
  await page.click('#load-sample');
  check(await page.isVisible('#confirm-box'), '只改了催回模板时载入示例应先确认');
  check((await page.inputValue('#template')) === '@{姓名} 今晚前回复', '确认前保留自定义模板');
  await page.click('#confirm-no');
  await page.fill('#template', '@{姓名} 请回复收到');
  check(!(await page.evaluate(() => document.querySelector('#kw-read').value === '')), '关键词输入框有默认值');
  await page.click('summary');
  await page.fill('#kw-read', '已阅');
  await page.click('#load-sample');
  check(await page.isVisible('#confirm-box'), '只改了关键词时载入示例应先确认');
  check((await page.inputValue('#kw-read')) === '已阅', '确认前保留自定义关键词');
  await page.click('#confirm-yes');
  check((await page.inputValue('#kw-read')) === '收到, 好的, ok, 1', '确认后关键词恢复默认');

  // ---- 手机
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  check(await page.isVisible('#pane-tabs'), '手机端应显示分段切换');
  check(await page.isVisible('#h-input') && !(await page.isVisible('#h-replied')), '手机端默认只显示「输入」');
  await noOverflow('手机-输入');
  for (const p of ['replied', 'unreplied', 'unknown', 'export']) {
    await page.click(`#pane-tabs [data-pane="${p}"]`);
    await noOverflow('手机-' + p);
  }
  await page.click('#pane-tabs [data-pane="replied"]');
  check(await page.isVisible('#h-replied') && !(await page.isVisible('#h-unreplied')), '手机端切到「已回」后只显示它');
  await noOverflow('手机');
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
  await ctx.close();

  // ---- 存储失败:setItem 抛 QuotaExceededError
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx2.addInitScript(() => {
    Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
  });
  const q = await ctx2.newPage();
  watch(q, '存储失败页');
  await q.goto(URL);
  await q.fill('#roster', '张三\n李四');
  check(await q.isVisible('#save-warning'), '写入失败时应显示持续可见的「未保存」提示');
  check((await q.textContent('#save-status')) === '未保存', '状态应为「未保存」');
  check(!(await q.textContent('#save-status')).includes('已保存'), '失败时不得显示「已保存」');
  await q.click('#load-sample');
  await q.click('#confirm-yes');
  check(await q.isVisible('#save-warning'), '载入示例后写入仍失败,提示仍在');
  check((await q.textContent('#flash')).includes('没有写入本机存储'), '失败时提示条要说明没有写入');
  const [d2] = await Promise.all([q.waitForEvent('download'), q.click('#save-warning-export')]);
  check(Core.validateImport(fs.readFileSync(await d2.path(), 'utf8')).ok, '未保存提示里的导出按钮可用');
  await ctx2.close();

  // ---- 损坏存档:另存成功 / 另存失败要如实说明,失败时可下载原始存档
  const RAW = '{"app":"notice-receipts","version":1,"title":5}';
  const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx3.addInitScript(raw => { if (!localStorage.getItem('noticereceipt.v1')) localStorage.setItem('noticereceipt.v1', raw); }, RAW);
  const c3 = await ctx3.newPage();
  watch(c3, '损坏存档页');
  await c3.goto(URL);
  const okText = await c3.textContent('#load-error-text');
  check(okText.includes('已另存在浏览器存储键') && !okText.includes('另存失败'), '另存成功时说明已另存');
  check(await c3.locator('#load-error-download').isHidden(), '另存成功时不显示下载原始存档按钮');
  await ctx3.close();
  const ctx4 = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx4.addInitScript(raw => {
    const orig = Storage.prototype.setItem;
    if (!localStorage.getItem('noticereceipt.v1')) localStorage.setItem('noticereceipt.v1', raw);
    Storage.prototype.setItem = function (k, v) { if (k === 'noticereceipt.v1.rejected') throw new DOMException('quota', 'QuotaExceededError'); return orig.call(this, k, v); };
  }, RAW);
  const c4 = await ctx4.newPage();
  watch(c4, '另存失败页');
  await c4.goto(URL);
  const badText = await c4.textContent('#load-error-text');
  check(badText.includes('另存失败') && !badText.includes('原数据已另存'), '另存失败时如实写「另存失败」,不再声称已另存');
  check(await c4.locator('#load-error-download').isVisible(), '另存失败时显示「下载原始存档」按钮');
  const [d4] = await Promise.all([c4.waitForEvent('download'), c4.click('#load-error-download')]);
  check(fs.readFileSync(await d4.path(), 'utf8') === RAW, '下载的原始存档与损坏数据逐字一致');
  await ctx4.close();

  // ---- 展示图
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  watch(show, '展示页');
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(300);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();

  console.log(`断言共 ${asserts} 条`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
