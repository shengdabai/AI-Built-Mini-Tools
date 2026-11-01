'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const BASE = 'file://' + encodeURI(path.join(__dirname, 'index.html'));
const URL = BASE + '?today=2026-10-20';
const OUT = path.join(__dirname, 'screenshots');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });
  const problems = [];
  let asserts = 0;
  const ok = (cond, msg) => { asserts++; if (!cond) problems.push('断言失败:' + msg); };
  const watch = (p, tagName) => {
    p.on('console', m => { if (m.type() === 'error') problems.push(tagName + ' console: ' + m.text()); });
    p.on('pageerror', e => problems.push(tagName + ' pageerror: ' + e.message));
  };

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  watch(page, '主页');
  const noOverflow = async (label) => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(`${label}: scrollWidth ${sw} <= innerWidth ${iw} -> ${sw <= iw ? 'OK' : 'FAIL'}`);
    ok(sw <= iw, `${label} 横向溢出 ${sw} > ${iw}`);
  };

  // 1 空状态
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  ok(await page.isVisible('#empty-guide'), '空状态引导可见');
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

  // 2 载入示例,看面粉组(g/kg 混用、双币种、缺参数)
  await page.click('#btn-sample');
  await page.waitForSelector('.chip');
  ok((await page.$$('.chip')).length === 3, '示例应有 3 个规格组');
  await page.click('.chip >> text=鸡蛋');
  let firstBest = await page.textContent('#rank-out tr.is-best td:nth-child(2)');
  ok(firstBest.includes('绿源供应'), '鸡蛋最低价应为绿源供应,实际 ' + firstBest);
  await page.click('.chip >> text=面粉');
  ok((await page.$$('#rank-out .part-title')).length === 2, '面粉应分 CNY 与 USD 两个排名表');
  ok((await page.$$('#rank-out tr.is-best')).length === 2, '每个排名表各有一个最低价行');
  ok((await page.textContent('#rank-out')).includes('缺参数,未参与排名'), '应显示缺参数区');
  const cnyFirst = await page.textContent('#rank-out .card:nth-of-type(1) tbody tr:first-child');
  ok(cnyFirst.includes('老李批发') && cnyFirst.includes('4.80'), '面粉 CNY 最低应为老李批发 4.80/kg,实际 ' + cnyFirst);
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png') });

  // 3 手动录入一条更便宜的报价(含公式字符的品名),预览换算
  await page.click('[data-view="entry"]');
  await page.fill('#f-supplier', '东升粮油');
  await page.fill('#f-item', '=高筋面粉(25kg)');
  await page.fill('#f-group', '面粉');
  await page.fill('#f-price', '100');
  await page.fill('#f-count', '1');
  await page.fill('#f-qty', '25');
  await page.selectOption('#f-unit', 'kg');
  const prev = await page.textContent('#form-preview');
  ok(prev.includes('4.00'), '换算预览应为 4.00,实际 ' + prev);
  await page.click('#form-submit');
  await page.click('[data-view="compare"]');
  const best2 = await page.textContent('#rank-out tr.is-best td:nth-child(2)');
  ok(best2.includes('东升粮油'), '新增后东升粮油应成为面粉最低价,实际 ' + best2);
  // 表单错误:包装价为 0
  await page.click('[data-view="entry"]');
  await page.fill('#f-supplier', 'X'); await page.fill('#f-item', 'Y'); await page.fill('#f-group', '面粉'); await page.fill('#f-price', '0');
  await page.click('#form-submit');
  ok(await page.isVisible('#form-error'), '包装价 0 应显示错误');
  await page.click('#form-cancel').catch(() => {});

  // 4 批量粘贴:一行错误,一行缺参数,一行正常
  await page.fill('#b-group', '糖');
  await page.fill('#batch-text', '老李批发 | 白砂糖 | 95 | 1 | 25 | kg\n绿源供应 | 白砂糖 | abc | 1 | 1 | kg\n城东菜场 | 白砂糖 | 40 | | | ');
  await page.click('#batch-submit');
  ok((await page.$$('#batch-errors li')).length === 2, '批量粘贴应显示整批拒绝提示 + 1 个错误行');
  ok((await page.textContent('#batch-errors')).includes('第 2 行'), '错误应指向第 2 行');
    await page.click('[data-view="compare"]');
  ok((await page.$$('.chip >> text=糖')).length === 0, '批量有错误行时整批不应写入(无「糖」规格组)');
  await page.click('[data-view="entry"]');
  await page.fill('#batch-text', '老李批发 | 白砂糖 | 95 | 1 | 25 | kg\n绿源供应 | 白砂糖 | 99 | 1 | 25 | kg\n城东菜场 | 白砂糖 | 40 | | | ');
  await page.click('#batch-submit');
  await page.click('[data-view="compare"]');
  await page.click('.chip >> text=糖');
  ok((await page.$$('#rank-out tbody tr.is-best')).length === 1, '糖组应有 1 个最低价');
  ok((await page.textContent('#rank-out')).includes('缺每包件数'), '糖组缺参数行应显示原因');

  // 5 历史价格:老李批发鸡蛋涨 15%
  await page.click('[data-view="history"]');
  await page.selectOption('#hist-key', { label: '老李批发 · 鲜鸡蛋(30枚盘装)(2 次)' });
  const hist = await page.textContent('#hist-out');
  ok(hist.includes('+15%') && hist.includes('警示'), '历史应显示 +15% 警示,实际 ' + hist);
  ok((await page.textContent('#warn-out')).includes('老李批发'), '涨价清单应含老李批发');
  await page.fill('#threshold', '20');
  await page.dispatchEvent('#threshold', 'change');
  ok(!(await page.textContent('#hist-out')).includes('警示'), '阈值 20% 后不应再警示');
  await page.fill('#threshold', '10');
  await page.dispatchEvent('#threshold', 'change');

  // 6 导出
  await page.click('[data-view="export"]');
  const readDl = async (d) => fs.readFileSync(await d.path(), 'utf8');
  let [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-rank-csv')]);
  const csv = await readDl(dl);
  console.log('下载:', dl.suggestedFilename());
  ok(csv.charCodeAt(0) === 0xFEFF, 'CSV 应带 BOM');
  ok(csv.includes('最低价') && csv.includes('缺参数'), '比价 CSV 应含最低价与缺参数');
  ok(csv.includes("'=高筋面粉(25kg)"), 'CSV 公式字符应加单引号前缀');
  ok(!/(^|,)=高筋/m.test(csv), 'CSV 不应出现未转义的公式');
  [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-rank-md')]);
  const md = await readDl(dl);
  ok(md.includes('| 规格组 |') && md.includes("'=高筋面粉"), 'Markdown 导出内容');
  [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-all-csv')]);
  ok((await readDl(dl)).split('\n').length > 19, '全部报价 CSV 行数');
  [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-json')]);
  const json = JSON.parse(await readDl(dl));
  ok(json.version === 1 && json.quotes.length === 22, 'JSON 备份应含 22 条报价(18 示例 + 1 表单 + 3 批量),实际 ' + json.quotes.length);
  ok((await page.textContent('#md-preview')).includes('东升粮油'), 'Markdown 预览与数据一致');
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png') });
  await noOverflow('桌面');

  // 7 刷新后持久化
  await page.reload();
  ok((await page.$$('.chip')).length === 4, '刷新后数据应保留(4 个规格组)');

  // 8 导入非法 JSON 被整份拒绝
  await page.setInputFiles('#file-import', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, quotes: [{ id: 'a', supplier: 's', item: 'i', group: 'g', currency: 'ZZZ', packPrice: 1, packCount: 1, unitQty: 1, unit: 'kg', note: '', date: '2026-10-01' }] })) });
  await page.waitForSelector('#import-error:not([hidden])');
  ok((await page.textContent('#import-error')).includes('currency'), '非法币种应被拒绝并说明原因');
  ok((await page.$$('.chip')).length === 4, '拒绝导入后原数据不变');

  // 9 清空要先确认
  await page.click('#btn-clear');
  ok(await page.isVisible('#confirm-box'), '清空前应出现确认区');
  await page.click('#btn-confirm-no');
  ok((await page.$$('.chip')).length === 4, '取消后数据仍在');

  // 10 非法 ?today 不抛错
  await page.goto(BASE + '?today=2026-99-99');
  ok(await page.isVisible('.tabs'), '非法 today 页面仍可用');
  await page.goto(URL);

  // ---- 第五轮新增断言 ----
  ok((await page.textContent('#today-banner')).includes('基准日 2026-10-20(由地址参数固定)'), '?today 生效时页面持续显示基准日');
  ok(await page.isVisible('#sample-badge'), '数据含合成示例时持续显示标记(刷新后仍在)');
  await page.click('[data-view="export"]');
  const [sj] = await Promise.all([page.waitForEvent('download'), page.click('#export-json')]);
  ok(JSON.parse(await readDl(sj)).sample === true, '导出的 JSON 备份带 sample:true');
  const [sc] = await Promise.all([page.waitForEvent('download'), page.click('#export-rank-csv')]);
  const scText = await readDl(sc);
  ok(scText.split('\r\n')[0].endsWith('数据来源') && scText.split('\r\n')[1].endsWith('合成示例'), '比价表 CSV 带「数据来源=合成示例」列');
  const [sm] = await Promise.all([page.waitForEvent('download'), page.click('#export-rank-md')]);
  ok((await readDl(sm)).includes('数据来源:合成示例'), '比价表 Markdown 标注合成示例');

  // 币种/量纲混合时的涨价摘要、相对最低价文案、补齐参数、行内删除
  const mk = (id, sup, cur, price, date, extra) => Object.assign({ id, supplier: sup, item: '糖浆', group: '糖浆', currency: cur, packPrice: price, packCount: 1, unitQty: 1, unit: 'kg', note: '', date }, extra || {});
  const seed = { version: 1, threshold: 10, quotes: [
    mk('a1', 'A', 'CNY', 10, '2026-10-01'), mk('a2', 'A', 'USD', 2, '2026-10-05'), mk('a3', 'A', 'CNY', 12, '2026-10-10'),
    mk('b1', 'B', 'CNY', 10, '2026-10-09'), mk('c1', 'C', 'CNY', 15, '2026-10-11', { unitQty: null })
  ] };
  const p6 = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  watch(p6, '混合币种页');
  await p6.addInitScript(d => { if (!localStorage.getItem('procure.v1')) localStorage.setItem('procure.v1', JSON.stringify(d)); }, seed);
  await p6.goto(URL);
  const cmp = await p6.textContent('#rank-out');
  ok(cmp.includes('120%') && cmp.includes('比最低价贵 20%') && cmp.includes('最低价 = 100%'), '相对最低价写明「占最低价的百分比」并给出「比最低价贵 20%」');
  await p6.click('[data-view="history"]');
  await p6.selectOption('#hist-key', { label: 'A · 糖浆(3 次)' });
  const warnText = await p6.textContent('#warn-out');
  ok(warnText.includes('10.00 → 12.00 CNY / kg') && !warnText.includes('2.00 → 12.00') && warnText.includes('+20%'), '涨价摘要用同币种上一条:10.00 → 12.00 CNY,+20%(不是 USD 2.00)');
  await p6.click('[data-view="compare"]');
  ok((await p6.textContent('#rank-out')).includes('缺参数,未参与排名'), '缺参数行出现');
  await p6.click('button:has-text("补齐参数")');
  ok(await p6.isVisible('#view-entry') && await p6.inputValue('#f-supplier') === 'C', '点「补齐参数」打开编辑表单并带入该行');
  ok(await p6.evaluate(() => document.activeElement.id) === 'f-qty', '焦点直接落到缺失的「每件净含量」');
  await p6.fill('#f-qty', '3');
  await p6.click('#form-submit');
  ok(await p6.isVisible('#view-compare') && !(await p6.textContent('#rank-out')).includes('缺参数,未参与排名'), '保存后返回比价页的当前规格组,缺参数区消失');
  ok((await p6.textContent('#rank-out')).includes('5.00'), '补齐后 C 以 5.00/kg 参与排名');
  // 行内删除确认
  await p6.click('[data-view="all"]');
  const rowsBefore = (await p6.$$('#all-out tbody tr')).length;
  await p6.click('button[aria-label="删除 A 糖浆 2026-10-10"]');
  const confirmRowText = await p6.textContent('#all-out');
  ok(confirmRowText.includes('删除 2026-10-10') && confirmRowText.includes('A · 糖浆'), '删除前在该条旁显示日期、事项');
  ok((await p6.$$('#all-out tbody tr')).length === rowsBefore, '确认前报价条数不变');
  ok(confirmRowText.includes('比价排名') && confirmRowText.includes('不能撤销'), '确认文案写明会影响比价排名且不能撤销');
  await p6.click('button[aria-label="取消删除 A 糖浆 2026-10-10"]');
  ok((await p6.$$('#all-out tbody tr')).length === rowsBefore && await p6.evaluate(() => document.activeElement.getAttribute('aria-label')) === '删除 A 糖浆 2026-10-10', '取消后条数不变,焦点回到该条删除按钮');
  await p6.click('button[aria-label="删除 A 糖浆 2026-10-10"]');
  await p6.click('button[aria-label="确认删除 A 糖浆 2026-10-10"]');
  ok((await p6.$$('#all-out tbody tr')).length === rowsBefore - 1, '确认后才删除');
  ok((await p6.evaluate(() => document.activeElement.id)).startsWith('edit-'), '删除后焦点落到相邻条目的编辑按钮');
  // 表单草稿时导出暂停;错误贴近控件
  await p6.click('[data-view="entry"]');
  await p6.fill('#f-supplier', '草稿供应商');
  ok(await p6.isDisabled('#btn-export-json-top') && await p6.isVisible('#export-block'), '表单有未保存草稿时普通备份禁用并提示原因');
  await p6.click('[data-view="export"]');
  ok(await p6.isDisabled('#export-rank-csv') && await p6.isDisabled('#export-all-csv') && await p6.isDisabled('#export-json'), '草稿存在时各导出按钮都禁用');
  await p6.click('[data-view="entry"]');
  await p6.click('#form-cancel');
  ok(await p6.isEnabled('#btn-export-json-top'), '清空草稿后导出恢复');
  await p6.click('#form-submit');
  ok(await p6.isVisible('#err-supplier') && await p6.getAttribute('#f-supplier', 'aria-describedby') === 'err-supplier' && await p6.evaluate(() => document.activeElement.id) === 'f-supplier', '必填错误显示在出错输入旁并聚焦第一个出错控件');
  await p6.click('[data-view="history"]');
  await p6.fill('#threshold', '-5');
  await p6.dispatchEvent('#threshold', 'change');
  ok(await p6.isVisible('#threshold-error') && await p6.evaluate(() => document.activeElement.id) === 'threshold', '阈值非法时原因显示在阈值输入旁');
  await p6.close();

  // 空状态可导入;草稿也要确认;导入先预览再确认
  const p7 = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  watch(p7, '空状态页');
  await p7.goto(URL);
  await p7.evaluate(() => localStorage.clear());
  await p7.reload();
  ok(await p7.isVisible('#btn-import') && await p7.isVisible('#btn-import-2'), '空状态下「导入 JSON 备份」入口可见');
  await p7.click('[data-view="entry"]');
  await p7.fill('#f-supplier', '草稿供应商');
  await p7.click('#btn-sample');
  ok(await p7.isVisible('#confirm-box') && (await p7.textContent('#confirm-text')).includes('表单草稿'), '只有表单草稿时载入示例也先确认');
  await p7.click('#btn-confirm-no');
  ok(await p7.inputValue('#f-supplier') === '草稿供应商' && await p7.isHidden('#sample-badge'), '取消后草稿仍在、没有载入示例');
  await p7.click('#form-cancel');
  const goodJson = { version: 1, sample: false, threshold: 15, quotes: [mk('z1', 'Z', 'CNY', 9, '2026-10-02')] };
  await p7.setInputFiles('#file-import', { name: 'ok.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(goodJson)) });
  await p7.waitForSelector('#confirm-box:not([hidden])');
  ok((await p7.textContent('#confirm-text')).includes('1 条报价') && (await p7.textContent('#confirm-text')).includes('阈值 15%'), '导入先预览条数与阈值再确认');
  await p7.click('#btn-confirm-yes');
  await p7.click('[data-view="all"]');
  ok((await p7.$$('#all-out tbody tr')).length === 1, '确认后才写入');
  await p7.click('#btn-sample');
  ok((await p7.textContent('#confirm-text')).includes('改过的涨幅阈值 15%'), '阈值偏离默认也算用户数据并列入确认');
  await p7.close();

  // 11 手机
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('[data-view="compare"]');
  await page.click('.chip >> text=面粉');
  await page.waitForTimeout(150);
  await noOverflow('手机');
  for (const v of ['entry', 'all', 'history', 'export']) {
    await page.click(`[data-view="${v}"]`);
    await noOverflow('手机-' + v);
  }
  await page.click('[data-view="compare"]');
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
  await page.close();

  // 12 存储写入失败不能静默
  const bad = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(bad, '存储失败页');
  await bad.addInitScript(() => {
    Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
  });
  await bad.goto(URL);
  await bad.click('#btn-sample');
  await bad.waitForSelector('.chip');
  ok(await bad.isVisible('#save-warning'), '写入失败时应显示持续可见的未保存提示');
  ok(!(await bad.isVisible('#flash')), '写入失败时不应出现成功提示');
  await bad.close();

  // 展示图
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  watch(show, '展示页');
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(300);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();

  console.log(`断言 ${asserts} 条`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
