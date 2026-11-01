'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const URL = 'file://' + encodeURI(path.join(__dirname, 'index.html')) + '?today=2026-10-20';
const OUT = path.join(__dirname, 'screenshots');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'resale-shots-'));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let browser;
  try { browser = await chromium.launch(); }
  catch (e) { browser = await chromium.launch({ executablePath: EXE }); }
  const problems = [];
  let asserts = 0;
  const ok = (cond, msg) => { asserts += 1; if (!cond) problems.push('断言失败:' + msg); else console.log('  ✓ ' + msg); };
  const watch = (page, tag) => {
    page.on('console', m => { if (m.type() === 'error') problems.push(`${tag} console: ${m.text()}`); });
    page.on('pageerror', e => problems.push(`${tag} pageerror: ${e.message}`));
    page.on('dialog', d => { problems.push(`${tag} 出现原生对话框:${d.message()}`); d.dismiss(); });
  };
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  watch(page, '主页面');
  const noOverflow = async label => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(`${label}: scrollWidth ${sw} <= innerWidth ${iw} → ${sw <= iw ? 'OK' : 'FAIL'}`);
    ok(sw <= iw, `${label} 无横向溢出 (${sw} <= ${iw})`);
  };
  const text = sel => page.textContent(sel).then(t => t.trim());
  const rows = () => page.$$eval('#works-body tr[data-work]', r => r.length);
  const rowText = (id, cls) => page.textContent(`#works-body tr[data-work="${id}"] td.${cls}`).then(t => t.trim());
  const heatCount = (w, m) => page.getAttribute(`.heat-cell[data-work="${w}"][data-month="${m}"]`, 'data-count');
  const circle = w => page.$eval(`#scatter circle[data-work="${w}"]`, c => ['cx', 'cy', 'r'].map(a => c.getAttribute(a)).join('|'));
  const circles = () => page.$$eval('#scatter circle.dot', c => c.length);
  const barCount = ch => page.textContent(`.bar-row[data-channel="${ch}"] .bar-meta`).then(t => Number(t.trim().split(' ')[0]));

  // ---- 1 空状态 ----
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  ok(await page.isVisible('#empty'), '空状态显示引导');
  ok((await rows()) === 0, '空状态没有作品行');
  ok(await page.isVisible('#import-btn-top'), '空状态下「导入 JSON 备份」入口始终可见');
  ok((await text('#today-note')).includes('基准日 2026-10-20(由地址参数固定)'), '?today 生效时页面持续显示基准日');
  ok((await text('#empty')).includes('点击下面的「新增作品」'), '空状态引导不再依赖左右位置');
  await page.click('#empty-add');
  ok(await page.evaluate(() => document.activeElement.id === 'w-title'), '空状态按钮直接聚焦标题输入框');
  ok((await text('header.topbar')).includes('不代表有人付款'), '首屏说明:再售次数不代表有人付款');
  await page.fill('#w-hours', '3');
  await page.click('#work-form button[type=submit]');
  ok((await page.getAttribute('#w-title', 'aria-invalid')) === 'true' && await page.evaluate(() => document.activeElement.id === 'w-title') && (await page.getAttribute('#w-title', 'aria-describedby')) === 'work-error', '标题为空:原因贴近输入框、聚焦并用 aria-describedby 关联');
  await page.fill('#w-hours', '');
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

  // ---- 2 载入示例 ----
  await page.click('#load-sample');
  await page.waitForSelector('#works-body tr[data-work]');
  ok((await rows()) === 7, '示例 7 部作品');
  ok(await page.isVisible('#sample-banner') && (await text('#sample-banner')).includes('金额虚构'), '载入示例后持续显示「合成示例,金额虚构」');
  ok((await circles()) === 7, '散点 7 个圆');
  const totalRecs = await page.$$eval('#works-body td.count', t => t.reduce((a, x) => a + Number(x.textContent), 0));
  ok(totalRecs === 31, '示例共 31 条再售');
  ok((await page.$$eval('#hints li[data-kind]', l => l.map(x => x.dataset.kind).sort().join(','))) === 'duplicate,redo,rewrite', '三类规则提示各 1 条');
  ok((await rowText('w3', 'rev-hour')) === '无收入记录', '无收入作品不输出每小时收入');

  // ---- 3 载入示例不得无确认覆盖 ----
  await page.click('#load-sample');
  ok(await page.isVisible('#confirm'), '已有数据时载入示例先出现页内确认');
  ok((await rows()) === 7 && (await rowText('w2', 'count')) === '5', '确认前原状态保持');
  await page.click('#confirm-no');
  ok(!(await page.isVisible('#confirm')), '取消后确认区关闭');

  // ---- 3b 只有自定义渠道、没有作品时,载入示例也要确认 ----
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.fill('#c-name', '微博'); await page.click('#channel-form button');
  await page.waitForTimeout(100);
  await page.click('#load-sample');
  ok(await page.isVisible('#confirm'), '无作品但有自定义渠道时,载入示例先出现页内确认');
  ok((await page.$$eval('#r-channel option', o => o.some(x => x.value === '微博'))) && (await rows()) === 0, '确认前自定义渠道仍在、没有被示例替换');
  await page.click('#confirm-yes');
  await page.waitForSelector('#works-body tr[data-work]');
  ok((await rows()) === 7, '确认后载入示例');
  ok(!(await page.$$eval('#r-channel option', o => o.some(x => x.value === '微博'))), '确认后渠道列表被示例替换');

  // ---- 4 核心流程:真实新增一条再售 ----
  const before = {
    count: await rowText('w2', 'count'), cell: await heatCount('w2', '2026-10'), total: await page.getAttribute('.heat-total[data-month="2026-10"]', 'data-total'),
    circle: await circle('w2'), circles: await circles(), x: await barCount('X')
  };
  await page.selectOption('#r-work', 'w2');
  await page.fill('#r-date', '2026-10-18');
  await page.selectOption('#r-form', '改写');
  await page.selectOption('#r-channel', 'X');
  await page.fill('#r-extra', '1');
  await page.fill('#r-reach', '5000');
  await page.fill('#r-revenue', '12.5');
  await page.fill('#r-sale-ref', ' Order-A ');
  await page.click('#r-submit');
  await page.waitForTimeout(200);
  const after = {
    count: await rowText('w2', 'count'), cell: await heatCount('w2', '2026-10'), total: await page.getAttribute('.heat-total[data-month="2026-10"]', 'data-total'),
    circle: await circle('w2'), circles: await circles(), x: await barCount('X')
  };
  console.log('前:', JSON.stringify(before), '\n后:', JSON.stringify(after));
  ok(Number(after.count) === Number(before.count) + 1, `作品被售次数 ${before.count} → ${after.count}`);
  ok(Number(after.cell) === Number(before.cell) + 1, `热力格 w2×2026-10 计数 ${before.cell} → ${after.cell}`);
  ok(Number(after.total) === Number(before.total) + 1, `热力格 10 月合计 ${before.total} → ${after.total}`);
  ok(after.circles === before.circles, `散点圆数量不变 (${after.circles})`);
  ok(after.circle !== before.circle, `散点圆位置/半径变化 ${before.circle} → ${after.circle}`);
  ok(after.x === before.x + 1, `渠道条形 X 次数 ${before.x} → ${after.x}`);
  ok((await rowText('w2', 'rev-hour')) === '8.94 元', '有收入时每小时收入 = 7150 分 ÷ 8 小时 = 8.94 元');
  ok((await text('#toast')).includes('已保存'), '真正写入后才出现「已保存」');
  ok(!(await page.isVisible('#save-warning')), '保存成功时没有未保存警告');
  await page.fill('#r-date', '2026-11-18');
  await page.selectOption('#r-channel', 'X');
  await page.fill('#r-sale-ref', 'order-a');
  await page.click('#r-submit');
  ok(await page.isVisible('#resale-error') && (await text('#resale-error')).includes('交易引用重复'), '同一作品同一渠道的交易引用忽略大小写后冲突,保存被阻止');
  ok((await rowText('w2', 'count')) === '6', '交易引用冲突没有覆盖或新增记录');
  await page.fill('#r-sale-ref', '订单-一');
  await page.click('#r-submit');
  ok(await page.isVisible('#resale-error') && (await text('#resale-error')).includes('可打印 ASCII') && (await rowText('w2', 'count')) === '6', '非 ASCII 交易引用显示明确错误且没有入账');
  await page.fill('#r-sale-ref', '');
  await page.reload();
  ok((await rowText('w2', 'count')) === '6', '刷新后新增的再售记录仍在');
  ok(await page.isVisible('#sample-banner'), '刷新后「合成示例」标记仍在');
  ok((await text('#works-table')).length > 0 && (await text('main')).includes('每条计 1 次,含原发;不代表有人付费成交'), '作品表上方写明被售次数口径');
  // 编辑作品:改标题和首次耗时,再售记录与 id 保留
  const idsBefore = await page.$$eval('#works-body tr[data-work]', r => r.map(x => x.dataset.work).join());
  await page.click('#works-body tr[data-work="w2"] [data-act="edit"]');
  ok((await page.inputValue('#w-title')).length > 0 && (await text('#w-submit')) === '保存修改', '点「编辑」把作品载入表单,按钮变为「保存修改」');
  await page.fill('#w-title', '改过标题的作品');
  ok(await page.isDisabled('#export-json'), '编辑作品有未保存修改时导出暂停');
  await page.fill('#w-hours', '9');
  await page.click('#w-submit');
  await page.waitForTimeout(150);
  ok((await rowText('w2', 'count')) === '6' && (await page.textContent('#works-body tr[data-work="w2"] td')).includes('改过标题'), '编辑后作品标题已改且再售记录数不变(6 条)');
  ok((await page.$$eval('#works-body tr[data-work]', r => r.map(x => x.dataset.work).join())) === idsBefore, '编辑后作品 id 不变、没有重建');
  ok((await rowText('w2', 'hours')) !== '' && Number(await rowText('w2', 'hours')) > 9, '累计耗时随首次耗时更新');
  // 编辑一条再售记录
  await page.click('#works-body tr[data-work="w2"] [data-act="records"]');
  const firstRid = await page.getAttribute('#records [data-resale-row]', 'data-resale-row');
  await page.click('#records [data-resale-row] [data-edit-resale] >> nth=0');
  ok(await page.isDisabled('#r-work') && (await text('#r-submit')) === '保存修改', '点「编辑这条」把记录载入再售表单');
  await page.fill('#r-extra', '2.5');
  await page.click('#r-submit');
  await page.waitForTimeout(150);
  ok((await rowText('w2', 'count')) === '6' && (await page.textContent('#records')).includes('额外 2.5 小时'), '编辑再售记录后条数不变、额外耗时已更新');
  // 删除再售记录先确认
  await page.click('#records [data-resale] >> nth=0');
  ok(await page.isVisible('#confirm') && (await text('#confirm-text')).includes('确认前数据不变') && (await rowText('w2', 'count')) === '6', '删除再售记录先页内确认,确认前次数不变');
  await page.click('#confirm-no');
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png'), fullPage: true });
  await noOverflow('桌面');

  // ---- 5 导出 ----
  await page.click('[data-tab="export"]');
  const save = async (btn, name) => {
    const [d] = await Promise.all([page.waitForEvent('download'), page.click(btn)]);
    const p = path.join(TMP, name); await d.saveAs(p); return { name: d.suggestedFilename(), body: fs.readFileSync(p, 'utf8'), path: p };
  };
  const csv = await save('#export-csv', 'a.csv');
  ok(csv.name === '作品表.csv' && csv.body.split('\r\n').filter(Boolean).length === 8, 'CSV 下载:表头 + 7 部作品');
  const md = await save('#export-md', 'a.md');
  ok(md.body.includes('# 写作复售月报 2026-10') && md.body.includes('这不是复售'), 'Markdown 月报含标题与重做提示');
  ok((await text('#md-preview')).includes('| 复售次数 |'), '月报预览已渲染');
  ok(csv.body.split('\r\n')[0].endsWith('数据性质') && csv.body.includes('合成示例') && md.body.includes('合成示例,金额虚构'), '示例数据的 CSV 与月报都标注合成示例');
  // 月份共用:账本页改月份,导出页同步,按钮写明月份
  await page.click('[data-tab="ledger"]');
  await page.fill('#report-month', '2026-09');
  await page.click('[data-tab="export"]');
  ok((await page.inputValue('#export-month')) === '2026-09' && (await text('#export-md')).includes('2026-09'), '账本页与导出页共用月份,下载按钮写明将导出的月份');
  const md09 = await save('#export-md', 'b.md');
  ok(md09.body.includes('# 写作复售月报 2026-09') && md09.name === '月报-2026-09.md', '导出的月报就是页面选中的月份');
  await page.fill('#export-month', '2026-10');
  // 表单有未保存内容时导出暂停
  await page.click('[data-tab="ledger"]');
  await page.fill('#w-title', '还没提交的作品');
  await page.click('[data-tab="export"]');
  ok(await page.isDisabled('#export-csv') && await page.isDisabled('#export-md') && await page.isDisabled('#export-json') && await page.isVisible('#export-lock'), '有未提交的表单内容时三种导出暂停并说明');
  await page.click('[data-tab="ledger"]');
  await page.fill('#w-title', '');
  await page.click('[data-tab="export"]');
  ok(await page.isEnabled('#export-csv') && await page.isHidden('#export-lock'), '清空草稿后导出恢复');
  const js = await save('#export-json', 'a.json');
  ok(JSON.parse(js.body).works.length === 7, 'JSON 备份含 7 部作品');
  ok(JSON.parse(js.body).works.find(w => w.id === 'w2').resales.some(r => r.saleRef === 'Order-A'), 'JSON 备份保留去除首尾空格后的交易引用');
  ok(csv.body.includes('交易引用') && csv.body.includes('Order-A') && md.body.includes('Order-A'), 'CSV 与 Markdown 都导出交易引用');
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png'), fullPage: true });

  // ---- 6 导入:拒绝与接受 ----
  const bad = JSON.parse(js.body); bad.works[0].type = '播客';
  await page.setInputFiles('#import-file', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
  await page.waitForSelector('#import-error:not([hidden])');
  ok((await text('#import-error')).includes('被拒绝'), '含非法类型的备份整份被拒绝');
  await page.click('[data-tab="ledger"]');
  ok((await rows()) === 7, '拒绝导入后当前数据不变');
  await page.click('[data-tab="export"]');
  await page.setInputFiles('#import-file', js.path);
  await page.waitForSelector('#confirm:not([hidden])');
  await page.click('#confirm-no');
  await page.click('[data-tab="ledger"]');
  ok((await rows()) === 7 && (await rowText('w2', 'count')) === '6', '取消合法导入后当前数据不变');
  await page.click('[data-tab="export"]');
  await page.setInputFiles('#import-file', js.path);
  await page.waitForSelector('#confirm:not([hidden])');
  await page.click('#confirm-yes');
  await page.waitForSelector('#import-ok:not([hidden])');
  await page.click('[data-tab="ledger"]');
  ok((await rows()) === 7 && (await rowText('w2', 'count')) === '6', '合法备份确认后导入成功且数据一致');

  // ---- 7 中屏与手机 ----
  await page.setViewportSize({ width: 768, height: 900 });
  await page.waitForTimeout(250);
  await noOverflow('中屏');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await noOverflow('手机');
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });

  // ---- 8 边界值:最长标题 / 最大小时 / 最大触达与金额,保存后 reload 仍在 ----
  const longTitle = 'W'.repeat(500);
  await page.fill('#w-title', longTitle); await page.fill('#w-hours', '1000000'); await page.click('#work-form button[type=submit]');
  await page.waitForTimeout(150);
  await page.selectOption('#r-work', { label: longTitle });
  await page.fill('#r-extra', '1000000'); await page.fill('#r-reach', '1000000000000'); await page.fill('#r-revenue', '10000000000');
  await page.click('#r-submit');
  await page.waitForTimeout(150);
  ok(!(await page.isVisible('#save-warning')), '边界值保存成功(写入校验通过)');
  await page.reload();
  await page.waitForTimeout(300);
  ok((await rows()) === 8, '边界值 reload 后整份数据仍在(读取校验与写入同源)');
  ok((await page.$$eval('#works-body tr[data-work] td:first-child', t => t.some(x => x.textContent === 'W'.repeat(500)))), '500 字标题(无长度上限)完整保留');
  ok(!(await page.isVisible('#save-warning')), '边界值 reload 后没有「数据被忽略」警告');
  await noOverflow('手机(含超长标题)');
  await page.fill('#w-title', '坏输入'); await page.fill('#w-hours', 'abc'); await page.click('#work-form button[type=submit]');
  ok(await page.isVisible('#work-error'), '非数字的小时被表单拒绝');
  ok((await rows()) === 8, '被拒绝的输入没有入账');

  // ---- 9 CSV 公式防护(真实录入再下载) ----
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.fill('#w-title', "=HYPERLINK(\"http://x\")"); await page.fill('#w-hours', '1'); await page.click('#work-form button[type=submit]');
  await page.click('[data-tab="export"]');
  const csv2 = await save('#export-csv', 'b.csv');
  ok(csv2.body.includes('"\'=HYPERLINK(""http://x"")"'), 'CSV 中 = 开头的标题加了单引号前缀');
  await page.close();

  // ---- 10 存储失败不静默 ----
  const failPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(failPage, '存储失败页');
  await failPage.addInitScript(() => { Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); }; });
  await failPage.goto(URL);
  await failPage.click('#load-sample');
  await failPage.waitForSelector('#save-warning:not([hidden])');
  const warn = await failPage.textContent('#save-warning');
  ok(warn.includes('未保存') && warn.includes('导出'), '写入抛 QuotaExceededError 时显示持续可见的「未保存」并引导导出');
  ok(!(await failPage.isVisible('#toast')) || !(await failPage.textContent('#toast')).includes('已保存'), '写入失败时没有「已保存」成功提示');
  const [bk] = await Promise.all([failPage.waitForEvent('download'), failPage.click('#warn-export')]);
  const bkBody = fs.readFileSync(await bk.path(), 'utf8');
  ok(JSON.parse(bkBody).works.length === 7 && JSON.parse(bkBody).sample === true, '未保存提示里的「导出当前内存中的全部账本 JSON 备份」导出内存中全部 7 部作品并带示例标记');
  await failPage.close();

  // ---- 展示图 ----
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  watch(show, '展示页');
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(400);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });

  console.log(`断言数:${asserts}`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
