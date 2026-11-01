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
  let asserts = 0;
  const check = (cond, msg) => { asserts++; if (!cond) problems.push(msg); else console.log('OK  ' + msg); };

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  const noOverflow = async label => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(`${label}: scrollWidth ${sw} <= innerWidth ${iw} -> ${sw <= iw ? 'OK' : 'FAIL'}`);
    asserts++;
    if (sw > iw) problems.push(`${label} 横向溢出 ${sw} > ${iw}`);
  };

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  check(await page.isVisible('#empty-guide'), '空状态显示引导');
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

  // 已有数据时载入示例必须先确认(此时仍是空状态,先放一条记录)
  await page.fill('#f-what', '先有一条自己的记录');
  await page.fill('#f-start', '08:00'); await page.fill('#f-end', '08:30');
  await page.click('#f-submit');
  await page.waitForTimeout(100);
  await page.click('#load-sample');
  check(await page.isVisible('#replace-confirm'), '已有数据时载入示例先出现替换确认');
  check((await page.$$('#entry-table tbody tr')).length === 1, '确认前原记录保持不变');
  await page.click('#btn-replace-no');
  check(await page.isHidden('#replace-confirm') && (await page.$$('#entry-table tbody tr')).length === 1, '取消后数据仍是原样');
  await page.click('#load-sample');
  await page.click('#btn-replace-yes');
  await page.waitForTimeout(100);
  // 核心流程:载入示例 -> 看黄金时段 -> 录入新段 -> 重叠被阻止 -> 修正后保存 -> 跨午夜拆分
  await page.waitForSelector('#entry-table tbody tr');
  check((await page.$$('#entry-table tbody tr')).length === 6, '10-20 示例显示 6 段');
  check((await page.textContent('#golden-text')).includes('写作'.slice(0, 0) + '生产 120 分钟'), '黄金时段文字:生产 120 分钟');
  // 选中 10-10:黄金时段被消费占满
  await page.fill('#view-date', '2026-10-10');
  await page.dispatchEvent('#view-date', 'change');
  check((await page.textContent('#golden-text')).includes('消费 150 分钟'), '10-10 黄金时段被消费占满(消费 150 分钟)');
  await page.fill('#view-date', '2026-10-20');
  await page.dispatchEvent('#view-date', 'change');

  // 错误示例:重叠被阻止
  await page.click('#f-error-demo');
  await page.click('#f-submit');
  const errText = await page.textContent('#form-errors');
  check(/时间相交/.test(errText), '重叠记录被阻止并给出原因');
  check((await page.$$('#entry-table tbody tr')).length === 6, '被阻止后记录数不变');
  // 结束早于开始
  await page.fill('#f-start', '16:00'); await page.fill('#f-end', '15:00');
  await page.click('#f-submit');
  check(/晚于开始/.test(await page.textContent('#form-errors')), '结束早于开始被拒绝');
  // 正常保存
  await page.fill('#f-start', '16:00'); await page.fill('#f-end', '17:00');
  await page.fill('#f-what', '写稿收尾');
  await page.selectOption('#f-group', 'prod');
  await page.fill('#f-label', '写作');
  await page.click('#f-submit');
  await page.waitForTimeout(150);
  check((await page.$$('#entry-table tbody tr')).length === 7, '保存后 10-20 有 7 段');
  check(await page.isHidden('#form-errors'), '成功保存后错误框消失');
  // 跨午夜
  await page.fill('#f-start', '23:00'); await page.fill('#f-end', '01:00');
  await page.fill('#f-what', '刷短视频');
  await page.selectOption('#f-group', 'consume');
  await page.check('#f-overnight');
  await page.click('#f-submit');
  await page.waitForTimeout(150);
  check((await page.textContent('#flash')).includes('拆成'), '跨午夜提示已拆成两段');
  await page.fill('#view-date', '2026-10-21');
  await page.dispatchEvent('#view-date', 'change');
  check((await page.textContent('#entry-table tbody')).includes('00:00–01:00'), '次日出现 00:00–01:00 的后半段');
  await page.fill('#view-date', '2026-10-20');
  await page.dispatchEvent('#view-date', 'change');
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png'), fullPage: true });
  await noOverflow('桌面');

  // 编辑一条结束于午夜 24:00 的记录(10-13 22:30–24:00)并保存
  await page.fill('#view-date', '2026-10-13');
  await page.dispatchEvent('#view-date', 'change');
  await page.click('button[aria-label="编辑 刷短视频(跨午夜,前半段)"]');
  check(await page.isChecked('#f-midnight'), '编辑午夜结束的记录时勾选「结束于午夜 24:00」');
  await page.fill('#f-what', '刷短视频(前半段,已改)');
  await page.click('#f-submit');
  await page.waitForTimeout(150);
  check(await page.isHidden('#form-errors'), '编辑午夜结束的记录保存成功,无错误');
  check((await page.textContent('#entry-table tbody')).includes('22:30–24:00') && (await page.textContent('#entry-table tbody')).includes('已改'), '保存后仍是 22:30–24:00 且内容已改');
  await page.fill('#view-date', '2026-10-20');
  await page.dispatchEvent('#view-date', 'change');

  // 周月
  await page.click('[data-view="range"]');
  await page.waitForTimeout(100);
  const streakText = await page.textContent('#range-metrics');
  check(streakText.includes('5 天'), '连续黄金时段利用率 ≥ 60% 为 5 天');
  check((await page.$$('#daily-table tbody tr')).length === 7, '周视图 7 行');
  await page.click('[data-range="30"]');
  check((await page.$$('#daily-table tbody tr')).length === 30, '月视图 30 行');
  await page.click('[data-range="7"]');

  // 复盘与导出
  await page.click('[data-view="review"]');
  await page.fill('#note-input', '=HYPERLINK("http://x")先上课再写稿');
  check(await page.isDisabled('#export-md'), '备注未保存时禁用周报导出');
  await page.click('#note-save');
  await page.waitForTimeout(100);
  check(await page.isEnabled('#export-md'), '保存备注后可导出周报');
  const [dMd] = await Promise.all([page.waitForEvent('download'), page.click('#export-md')]);
  const mdText = fs.readFileSync(await dMd.path(), 'utf8');
  check(mdText.includes("'=HYPERLINK") && mdText.includes('最长的 7 段'), '周报 Markdown 含公式防护与最长 7 段');
  const [dCsv] = await Promise.all([page.waitForEvent('download'), page.click('#export-csv')]);
  const csvText = fs.readFileSync(await dCsv.path(), 'utf8');
  check(csvText.includes('日期,开始,结束') && csvText.split('\r\n').length > 80, 'CSV 含表头与全部记录');
  const [dJson] = await Promise.all([page.waitForEvent('download'), page.click('#export-json')]);
  const j = JSON.parse(fs.readFileSync(await dJson.path(), 'utf8'));
  check(j.version === 1 && j.entries.length > 80, 'JSON 备份可解析');
  check(dMd.suggestedFilename().endsWith('.md') && dCsv.suggestedFilename().endsWith('.csv'), '下载文件名后缀正确');
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png'), fullPage: true });

  // ---- 第五轮新增断言 ----
  check(await page.isVisible('#sample-badge'), '示例身份持续可见(数据区标注合成示例)');
  check((await page.textContent('#today-banner')).includes('基准日 2026-10-20(由地址参数固定)'), '?today 生效时页面持续显示基准日');
  check(j.sample === true, '导出的 JSON 备份带 sample:true');
  check(csvText.split('\r\n')[0].endsWith('数据来源') && csvText.split('\r\n')[1].endsWith('合成示例'), '导出的 CSV 带「数据来源=合成示例」列');
  check(mdText.includes('合成示例'), '导出的周报标注合成示例');

  // 备注有未保存改动时切换日期:页内三选一
  await page.fill('#note-input', 'abc草稿');
  await page.fill('#view-date', '2026-10-19');
  await page.dispatchEvent('#view-date', 'change');
  check(await page.isVisible('#note-switch-confirm'), '备注未保存时切换日期出现页内选择');
  check(await page.inputValue('#view-date') === '2026-10-20' && await page.inputValue('#note-input') === 'abc草稿', '选择前日期与备注草稿都保持原样');
  await page.click('#btn-note-switch-cancel');
  check(await page.isHidden('#note-switch-confirm') && await page.inputValue('#note-input') === 'abc草稿', '取消后留在当前日期且草稿还在');
  await page.fill('#view-date', '2026-10-19');
  await page.dispatchEvent('#view-date', 'change');
  await page.click('#btn-note-switch-discard');
  check(await page.inputValue('#view-date') === '2026-10-19' && await page.inputValue('#note-input') === '', '放弃修改并切换后显示新日期的备注');
  await page.fill('#note-input', '十九号备注');
  await page.fill('#view-date', '2026-10-20');
  await page.dispatchEvent('#view-date', 'change');
  await page.click('#btn-note-switch-save');
  check(await page.inputValue('#view-date') === '2026-10-20', '保存后切换到新日期');
  await page.fill('#view-date', '2026-10-19');
  await page.dispatchEvent('#view-date', 'change');
  check(await page.inputValue('#note-input') === '十九号备注', '保存后再回到旧日期,备注已保存');
  await page.fill('#view-date', '2026-10-20');
  await page.dispatchEvent('#view-date', 'change');

  // 提交前预览:合法输入先以草稿样式进入时间轴和统计
  await page.click('[data-view="day"]');
  await page.reload();
  check(await page.isVisible('#sample-badge'), '刷新后示例标记仍在');
  const segSig = () => page.$$eval('.timeline__seg', els => els.map(e => e.style.getPropertyValue('--seg-start') + '/' + e.style.getPropertyValue('--seg-len')));
  const segsBefore = await segSig();
  const metricsBefore = await page.textContent('#day-metrics');
  const goldenBefore = await page.textContent('#golden-text');
  await page.fill('#f-start', '09:00'); await page.fill('#f-end', '09:00');
  await page.fill('#f-what', '预览用草稿');
  await page.fill('#f-start', '17:00'); await page.fill('#f-end', '18:30');
  const segsAfter = await segSig();
  check(segsAfter.length === segsBefore.length + 1 && (await page.$$('.timeline__seg--draft')).length === 1, '保存前:时间轴多出一段虚线草稿');
  check(!segsBefore.includes(segsAfter.filter(x => !segsBefore.includes(x))[0]) && segsAfter.some(x => x.endsWith('/6.25')), '草稿段的位置与长度(90 分钟 = 6.25%)来自表单');
  check((await page.textContent('#day-metrics')) !== metricsBefore, '保存前:统计数字随草稿变化');
  check((await page.textContent('#entry-table tbody')).includes('草稿,未保存'), '保存前:列表出现草稿行');
  check(await page.isDisabled('#btn-backup') && await page.isVisible('#export-block'), '预览时普通备份被禁用并提示原因');
  await page.click('[data-view="review"]');
  check(await page.isDisabled('#export-md') && await page.isDisabled('#export-csv') && await page.isDisabled('#export-json'), '预览时周报、CSV、JSON 导出全部禁用');
  await page.click('[data-view="day"]');
  await page.selectOption('#f-group', 'learn');
  await page.fill('#f-end', '19:00');
  check((await segSig()).some(x => x.endsWith('/8.333')), '改结束时间后草稿长度即时重绘');
  await page.fill('#f-what', '');
  check((await page.$$('.timeline__seg--draft')).length === 0 && JSON.stringify(await segSig()) === JSON.stringify(segsBefore) && (await page.textContent('#golden-text')) === goldenBefore, '清掉草稿后时间轴与统计回到保存状态');
  check(await page.isEnabled('#btn-backup'), '草稿清掉后导出恢复可用');

  // 错误贴近控件
  await page.fill('#f-what', '错误贴近控件');
  await page.fill('#f-start', '16:00'); await page.fill('#f-end', '15:00');
  await page.click('#f-submit');
  check(await page.isVisible('#err-end') && (await page.textContent('#err-end')).includes('晚于开始'), '结束早于开始的原因显示在结束时间旁');
  check(await page.getAttribute('#f-end', 'aria-describedby') === 'err-end' && await page.evaluate(() => document.activeElement.id) === 'f-end', '出错控件关联 aria-describedby 并获得焦点');
  await page.fill('#f-what', '');
  await page.fill('#f-start', '16:00'); await page.fill('#f-end', '17:00');

  // 删除先页内确认
  const nBefore = (await page.$$('#entry-table tbody tr')).length;
  const statBefore = await page.textContent('#day-metrics');
  await page.click('button[aria-label="删除 读书笔记"]');
  check((await page.textContent('#entry-table tbody')).includes('删除 2026-10-20 14:00–15:30「读书笔记」'), '删除前在该条旁显示日期、时间和事项');
  check((await page.$$('#entry-table tbody tr')).length === nBefore && (await page.textContent('#day-metrics')) === statBefore, '确认前记录与统计不变');
  await page.click('button[aria-label="取消删除 读书笔记"]');
  check((await page.$$('#entry-table tbody tr')).length === nBefore && await page.evaluate(() => document.activeElement.getAttribute('aria-label')) === '删除 读书笔记', '取消后记录还在,焦点回到该条删除按钮');
  await page.click('button[aria-label="删除 读书笔记"]');
  await page.click('button[aria-label="确认删除 读书笔记"]');
  await page.waitForTimeout(100);
  check((await page.$$('#entry-table tbody tr')).length === nBefore - 1, '确认后才删除');
  check((await page.evaluate(() => document.activeElement.id)).startsWith('edit-'), '删除后焦点落到相邻条目的编辑按钮');

  // 新页:示例标记 / 仅改黄金时段也要确认 / 导入预览确认 / 空状态可导入
  const p4 = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  p4.on('console', m => { if (m.type() === 'error') problems.push('console(p4): ' + m.text()); });
  p4.on('pageerror', e => problems.push('pageerror(p4): ' + e.message));
  await p4.goto(URL);
  await p4.evaluate(() => localStorage.clear());
  await p4.reload();
  check(await p4.isVisible('#btn-import') && await p4.isVisible('#btn-import-2'), '空状态下「导入 JSON 备份」入口可见');
  await p4.fill('#golden-start', '10:00');
  await p4.dispatchEvent('#golden-start', 'change');
  await p4.click('#load-sample');
  check(await p4.isVisible('#replace-confirm') && (await p4.textContent('#replace-scope')).includes('黄金时段'), '仅改了黄金时段也要先确认,并列明设置会被替换');
  await p4.click('#btn-replace-no');
  check(await p4.inputValue('#golden-start') === '10:00', '取消后黄金时段设置保持');
  await p4.click('#load-sample');
  await p4.click('#btn-replace-yes');
  await p4.waitForTimeout(100);
  check(await p4.inputValue('#golden-start') === '09:00' && await p4.isVisible('#sample-badge'), '确认后设置恢复默认且示例标记出现');
  const real = path.join(__dirname, '.omc', 'real-import.json');
  fs.writeFileSync(real, JSON.stringify({ app: 'attention-ledger', version: 1, golden: { start: 540, end: 720 }, entries: [{ id: 'r1', date: '2026-10-20', start: 540, end: 600, what: '真实一段', group: 'prod', label: '' }], notes: {} }));
  await p4.setInputFiles('#file-import', real);
  await p4.waitForSelector('#import-confirm:not([hidden])');
  const impText = await p4.textContent('#import-scope');
  check(impText.includes('1 段记录') && impText.includes('替换') && await p4.isVisible('#sample-badge'), '导入先预览数量并等待确认,确认前示例数据不变');
  await p4.click('#btn-import-no');
  check((await p4.$$('#entry-table tbody tr')).length === 6, '取消导入后现有数据不变');
  await p4.setInputFiles('#file-import', real);
  await p4.waitForSelector('#import-confirm:not([hidden])');
  await p4.click('#btn-import-yes');
  await p4.waitForTimeout(100);
  check((await p4.$$('#entry-table tbody tr')).length === 1 && await p4.isHidden('#sample-badge'), '确认导入真实数据后示例标记消失');
  fs.unlinkSync(real);
  await p4.close();

  // 导入校验:非法文件整份拒绝
  const bad = path.join(__dirname, '.omc', 'bad-import.json');
  fs.writeFileSync(bad, JSON.stringify({ app: 'attention-ledger', version: 1, golden: { start: 540, end: 720 }, entries: [{ id: 'a', date: '2026-10-20', start: 540, end: 600, what: 'x', group: '娱乐' }], notes: {} }));
  const before = await page.evaluate(() => localStorage.getItem('attledger.v1'));
  await page.setInputFiles('#file-import', bad);
  await page.waitForSelector('#import-error:not([hidden])');
  check((await page.textContent('#import-error-text')).includes('拒绝'), '非法大类的导入被整份拒绝');
  check(before === await page.evaluate(() => localStorage.getItem('attledger.v1')), '拒绝后已保存数据未被改动');
  fs.unlinkSync(bad);
  await page.click('#btn-import-error-close');

  // 清空:页内确认
  await page.click('#btn-clear');
  check(await page.isVisible('#clear-confirm'), '清空前出现页内确认区');
  await page.click('#btn-clear-no');

  // 手机
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('[data-view="day"]');
  await page.waitForTimeout(250);
  await noOverflow('手机');
  const vertical = await page.evaluate(() => { const t = document.querySelector('.timeline__track').getBoundingClientRect(); return t.height > t.width; });
  check(vertical, '手机端时间轴为纵向');
  const hit = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('input[type="checkbox"]').forEach(el => { const r = el.getBoundingClientRect(); const l = el.closest('label').getBoundingClientRect(); out.push([r.width, r.height, l.height]); });
    return out;
  });
  check(hit.length >= 2 && hit.every(x => x[0] >= 24 && x[1] >= 24 && x[2] >= 32), '手机端 checkbox 视觉 >= 24px,label 点击区高度 >= 32px');
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
  await page.close();

  // 存储失败提示
  const p2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  p2.on('pageerror', e => problems.push('pageerror(存储): ' + e.message));
  await p2.addInitScript(() => {
    Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
  });
  await p2.goto(URL);
  await p2.click('#load-sample');
  await p2.waitForTimeout(150);
  check(await p2.isVisible('#save-warning'), '存储写入失败时显示持续可见的「未保存」提示');
  check(await p2.isHidden('#flash'), '写入失败时不显示成功提示');
  await p2.close();

  // 非法 ?today 不抛错
  const p3 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  p3.on('pageerror', e => problems.push('pageerror(today): ' + e.message));
  await p3.goto('file://' + encodeURI(path.join(__dirname, 'index.html')) + '?today=2026-99-99');
  check(/^\d{4}-\d{2}-\d{2}$/.test(await p3.inputValue('#view-date')), '非法 ?today 回退真实今天');
  await p3.close();

  // 展示图
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  show.on('pageerror', e => problems.push('showcase pageerror: ' + e.message));
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(300);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();

  console.log(`断言 ${asserts} 条`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
