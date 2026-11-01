'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const URL = 'file://' + encodeURI(path.join(__dirname, 'index.html')) + '?today=2026-10-20';
const OUT = path.join(__dirname, 'screenshots');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-shots-'));

const problems = [];
let asserts = 0;
function check(cond, msg) {
  asserts += 1;
  if (!cond) problems.push('断言失败:' + msg);
  else console.log('  ok  ' + msg);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));

  const noOverflow = async label => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(`${label}: scrollWidth ${sw} <= innerWidth ${iw} → ${sw <= iw ? 'OK' : 'FAIL'}`);
    check(sw <= iw, `${label} 无横向溢出 (${sw} <= ${iw})`);
  };
  const polyPoints = () => page.getAttribute('polygon[data-layer="current"]', 'points');
  const areaNum = async () => Number(await page.textContent('#area-value'));

  // ---- 空状态 ----
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  check(await page.isVisible('#empty-state'), '空状态可见');
  check(await page.isHidden('#workspace'), '空状态下工作区隐藏');
  check(await page.isDisabled('#export-json'), '无档案时导出禁用');
  check(await page.isVisible('#import-btn'), '空状态下「导入 JSON 备份」入口可见');
  check((await page.textContent('#today-note')).includes('基准日 2026-10-20(由地址参数固定)'), '?today 生效时页面持续显示基准日');
  check((await page.textContent('#export-json')).includes('全部档案'), '导出按钮名写明范围');
  await noOverflow('桌面(空状态)');
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

  // ---- 核心流程:载入示例 → 改分 → 多边形与面积变化 ----
  await page.click('#load-sample');
  await page.waitForSelector('.dim-card');
  check((await page.$$('.dim-card')).length === 6, '示例载入 6 个维度');
  check((await page.textContent('#profile-tabs')).includes('合成示例'), '示例标注合成');
  check(await page.isVisible('#synthetic-badge'), '合成示例徽标可见');
  const boxSize = await page.evaluate(() => { const r = document.querySelector('#show-target').getBoundingClientRect(); return [r.width, r.height]; });
  check(boxSize[0] >= 24 && boxSize[1] >= 24, `checkbox 视觉尺寸 ≥ 24×24 (${boxSize.join('×')})`);
  check((await page.textContent('#best-dim')).includes('未计算提分耗时'), '边际面积提示说明未计算提分耗时');
  check((await page.textContent('#area-explain')).includes('顺序保持一致'), '面积说明提示维度顺序影响比较');
  check(await page.getAttribute('#d0-current', 'aria-describedby') === 'd0-err', '分数输入框用 aria-describedby 关联错误位置');
  const pts0 = await polyPoints();
  const area0 = await areaNum();
  check(pts0.split(' ').length === 6, '多边形有 6 个顶点');
  await page.fill('#d4-current', '85'); // 编程 35 → 85
  const pts1 = await polyPoints();
  const area1 = await areaNum();
  check(pts1 !== pts0, `polygon points 属性随分数变化`);
  check(area1 > area0, `面积数字变化 ${area0} → ${area1}`);
  check((await page.inputValue('#d4-range')) === '85', '滑块与数字框同步');
  await page.fill('#d4-range', '60');
  check((await page.inputValue('#d4-current')) === '60', '拖动滑块反向同步数字框');
  const area2 = await areaNum();
  check(area2 < area1 && area2 > area0, `滑块改到 60 后面积再次变化 → ${area2}`);

  // 悬停顶点:分数与证据
  await page.hover('.vtx[data-layer="current"][data-i="4"]');
  const tip = await page.textContent('#radar-tip');
  check(await page.isVisible('#radar-tip'), '悬停顶点显示提示框');
  check(tip.includes('编程') && tip.includes('60 分') && tip.includes('没有独立上线的项目'), `提示含维度、分数、证据:${tip}`);
  await page.hover('.vtx[data-layer="current"][data-i="0"]');
  check((await page.textContent('#radar-tip')).includes('82 分'), '换一个顶点提示随之更新');
  await page.focus('.vtx[data-layer="current"][data-i="1"]');
  check((await page.textContent('#radar-tip')).includes('62 分'), '键盘聚焦顶点同样显示提示');
  await page.hover('.vtx[data-layer="current"][data-i="4"]');

  // 非法输入:不改状态、导出禁用、可恢复
  const ptsBefore = await polyPoints();
  await page.fill('#d0-current', '150');
  check(await page.isVisible('#d0-err') && (await page.textContent('#d0-err')).includes('0–100'), '越界原因显示在出错输入旁');
  check((await page.getAttribute('#d0-current', 'aria-invalid')) === 'true', '越界输入被标红');
  check((await polyPoints()) === ptsBefore, '越界输入不改变多边形');
  check(await page.isDisabled('#export-csv'), '有非法输入时导出禁用');
  check(await page.isVisible('#export-note'), '显示导出禁用原因');
  await page.fill('#d0-current', '82');
  check(!(await page.isDisabled('#export-csv')), '改正后导出恢复');
  await page.fill('#d1-name', '教学');
  check((await page.textContent('.dim-card:nth-child(2) .dim-err')).includes('重复'), '重名被拒绝并提示');
  await page.fill('#d1-name', '写作');

  // 维度数变化 → 轴重排
  await page.click('#add-dim');
  check((await page.$$('.axis-label')).length === 7, '添加维度后轴标签变为 7 个');
  check((await polyPoints()).split(' ').length === 7, '添加维度后多边形 7 个顶点');
  await page.fill('#d6-name', '领导力');
  await page.fill('#d6-current', '40');
  await page.fill('#d6-target', '70');
  await page.click('.dim-card:nth-child(7) [data-act="remove"]');
  check(await page.isVisible('#confirm-box'), '删除维度先出现页内确认');
  await page.click('#confirm-yes');
  check((await polyPoints()).split(' ').length === 6, '删除后回到 6 个顶点');
  check(await page.evaluate(() => document.activeElement && document.activeElement.id === 'd5-name'), '删除维度后焦点回到相邻维度名');

  // 叠加对标档案 + 单维提示
  await page.selectOption('#compare-select', 'p-single-master');
  check(await page.isVisible('polygon[data-layer="compare"]'), '叠加对标档案后出现第三个多边形');
  await page.click('.tab >> nth=1');
  check((await page.textContent('#hints')).includes('单维竞争'), '切到单维高手档案显示「单维竞争」提示');
  await page.click('.tab >> nth=0');
  check((await page.textContent('#hints')).includes('多维面积已成型'), '切回示例档案显示「多维面积已成型」');
  check(await page.isVisible('#best-dim'), '显示边际面积最大的维度');

  // 投入建议
  await page.fill('#weekly-hours', '7.25');
  const sug = await page.$$eval('#alloc-body [data-role="sug"]', els => els.map(e => Number(e.textContent)));
  check(Math.round(sug.reduce((a, b) => a + b, 0) * 100) === 725, `建议小时合计等于每周小时 (${sug.join('+')})`);
  const w5 = sug[5];
  await page.fill('#weekly-hours', '0.001');
  const tiny = await page.$$eval('#alloc-body [data-role="sug"]', els => els.map(e => Number(e.textContent)));
  check(Math.round(tiny.reduce((a, b) => a + b, 0) * 1000) === 1, `每周 0.001 小时也能分配 (${tiny.join('+')})`);
  check((await page.textContent('#area-sectors')).includes('面积是 0'), '界面展示单维满分的退化面积为 0');
  await page.fill('#weekly-hours', '7.25');
  await page.fill('#alloc-body tr:nth-child(6) input', '6');
  const sug2 = await page.$$eval('#alloc-body [data-role="sug"]', els => els.map(e => Number(e.textContent)));
  check(sug2[5] > w5, `提高权重后该维度建议小时增加 ${w5} → ${sug2[5]}`);
  check(Math.round(sug2.reduce((a, b) => a + b, 0) * 100) === 725, '改权重后合计仍等于每周小时');

  // 时间线
  const rows0 = (await page.$$('#snap-body tr')).length;
  await page.click('#snap-add');
  check((await page.$$('#snap-body tr')).length === rows0 + 1, '记录快照后表格多一行');
  check((await page.textContent('#month-compare')).includes('2026-10-20'), '本月对比使用最新的本月快照');
  check((await page.$$('.tl-dot')).length === rows0 + 1, '折线图点数与快照数一致');
  check((await page.textContent('#tl-caption')).includes('名称、数量和顺序一致'), '时间线说明比较前需维度名称与顺序一致');
  // 删除快照先页内确认,确认前数据不变
  await page.click('#snap-body [data-act="del-snap"] >> nth=0');
  check(await page.isVisible('#confirm-box'), '删除快照先出现页内确认');
  check((await page.$$('#snap-body tr')).length === rows0 + 1, '确认前快照条数不变');
  await page.click('#confirm-no');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.hover('.vtx[data-layer="current"][data-i="4"]');
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png') });
  await noOverflow('桌面(核心流程)');

  // ---- 边界值写读同源:超长证据保存后刷新仍在 ----
  const longText = '长'.repeat(5000);
  await page.fill('#d2-evidence', longText);
  await page.fill('#weekly-hours', '100000');
  await page.waitForTimeout(100);
  await page.reload();
  await page.waitForSelector('.dim-card');
  check((await page.inputValue('#d2-evidence')).length === 5000, '5000 字证据保存后刷新仍在');
  check((await page.inputValue('#weekly-hours')) === '100000', '极大每周小时保存后刷新仍在');
  check((await page.$$('.dim-card')).length === 6 && (await page.$$('.tab')).length === 2, '刷新后档案与维度完整');
  await page.fill('#weekly-hours', '10');

  // ---- 载入示例不得无确认覆盖 ----
  await page.fill('#d0-current', '77');
  await page.click('#load-sample');
  check(await page.isVisible('#confirm-box'), '已有数据时载入示例先出现页内确认');
  check(/个档案.*个快照/.test(await page.textContent('#confirm-text')), '确认文案写明替换的档案与快照数量');
  check((await page.inputValue('#d0-current')) === '77', '确认前保留原状态');
  await page.click('#confirm-no');
  check((await page.inputValue('#d0-current')) === '77', '取消后原数据不变');
  await page.fill('#d0-current', '82');

  // ---- 导出 ----
  const dl = async sel => { const [d] = await Promise.all([page.waitForEvent('download'), page.click(sel)]); const p = path.join(TMP, d.suggestedFilename()); await d.saveAs(p); return { name: d.suggestedFilename(), text: fs.readFileSync(p, 'utf8') }; };
  const csv = await dl('#export-csv');
  check(csv.name.endsWith('.csv') && csv.text.includes('档案,数据性质,维度,当前分,目标分') && csv.text.includes('合成示例,教学,82,90,8'), `CSV 下载:${csv.name}`);
  const svg = await dl('#export-svg');
  check(svg.name.endsWith('.svg') && svg.text.startsWith('<svg xmlns=') && svg.text.includes('<polygon class="poly poly-current"') && svg.text.includes('<style>'), `SVG 下载:${svg.name}`);
  check(!/var\(--/.test(svg.text), '导出 SVG 不含未解析的 CSS 变量');
  const json = await dl('#export-json');
  const parsed = JSON.parse(json.text);
  check(parsed.profiles.length === 2 && parsed.v === 1, `JSON 备份:${json.name}`);

  // ---- 导入:非法拒绝,合法需确认 ----
  const bad = JSON.parse(json.text);
  bad.profiles[0].dims = bad.profiles[0].dims.slice(0, 2);
  const badPath = path.join(TMP, 'bad.json');
  fs.writeFileSync(badPath, JSON.stringify(bad));
  await page.setInputFiles('#import-file', badPath);
  await page.waitForSelector('#message.notice-error');
  check((await page.textContent('#message')).includes('导入被拒绝') && (await page.textContent('#message')).includes('维度数'), '维度数不足的备份被整份拒绝并给原因');
  check((await page.$$('.dim-card')).length === 6, '拒绝后原数据不变');
  const good = JSON.parse(json.text);
  good.profiles[0].name = '导入后的档案';
  const goodPath = path.join(TMP, 'good.json');
  fs.writeFileSync(goodPath, JSON.stringify(good));
  await page.setInputFiles('#import-file', goodPath);
  await page.waitForSelector('#confirm-box:not([hidden])');
  check((await page.inputValue('#profile-name')) !== '导入后的档案', '导入确认前保持原状态');
  await page.click('#confirm-yes');
  check((await page.inputValue('#profile-name')) === '导入后的档案', '确认后导入生效');

  // 结果页截图
  await page.click('.tab >> nth=0');
  await page.hover('.vtx[data-layer="current"][data-i="3"]');
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png'), fullPage: true });
  await noOverflow('桌面(结果与导出)');

  // ---- 手机 ----
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  await noOverflow('手机');
  const plotW = await page.$eval('.radar-svg', e => e.getBoundingClientRect().width);
  check(plotW > 150 && plotW <= 390, `手机端雷达图宽度 ${Math.round(plotW)}px 未溢出`);
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
  await page.close();

  // ---- 存储失败:持续提示,不显示成功 ----
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    Storage.prototype.setItem = function () { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; };
  });
  const fp = await ctx.newPage();
  fp.on('pageerror', e => problems.push('pageerror(存储失败页): ' + e.message));
  fp.on('console', m => { if (m.type() === 'error') problems.push('console(存储失败页): ' + m.text()); });
  await fp.goto(URL);
  await fp.click('#load-sample');
  await fp.waitForSelector('.dim-card');
  check(await fp.isVisible('#save-alert'), '写入抛 QuotaExceededError 时显示持续的未保存提示');
  check((await fp.textContent('#save-alert-text')).includes('未保存') && (await fp.textContent('#save-alert-text')).includes('导出'), '提示引导导出备份');
  check(!(await fp.textContent('#save-status')).includes('已保存'), '失败时不显示「已保存」');
  await fp.fill('#d0-current', '70');
  check(await fp.isVisible('#save-alert'), '继续编辑后提示仍在');
  await fp.fill('#d0-current', '999');
  check(await fp.isDisabled('#export-csv') && await fp.isDisabled('#export-json'), '保存失败且有非法输入时普通导出禁用');
  const [bk] = await Promise.all([fp.waitForEvent('download'), fp.click('#save-alert-export')]);
  check(bk.suggestedFilename() === 'radar-backup.json', '未保存提示里的备份按钮仍可下载 JSON');
  check(await fp.isDisabled('#export-csv') && await fp.isDisabled('#export-json'), '备份后普通导出仍禁用(未清空非法输入状态)');
  check((await fp.getAttribute('#d0-current', 'aria-invalid')) === 'true', '备份后非法输入仍标红');
  await ctx.close();

  // ---- 展示图 ----
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  show.on('pageerror', e => problems.push('showcase pageerror: ' + e.message));
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(300);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });

  console.log(`断言总数:${asserts}`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
