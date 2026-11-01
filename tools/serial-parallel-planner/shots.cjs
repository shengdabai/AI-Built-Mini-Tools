'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const URL = 'file://' + encodeURI(path.join(__dirname, 'index.html')) + '?today=2026-10-20';
const OUT = path.join(__dirname, 'screenshots');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });
  const problems = [];
  let asserts = 0;
  const check = (cond, msg) => { asserts++; if (!cond) problems.push('断言失败:' + msg); else console.log('OK  ' + msg); };
  const watch = (page, tag) => {
    page.on('console', m => { if (m.type() === 'error') problems.push(tag + ' console: ' + m.text()); });
    page.on('pageerror', e => problems.push(tag + ' pageerror: ' + e.message));
  };

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page, '主页面');
  const noOverflow = async label => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(`${label}: scrollWidth ${sw} <= innerWidth ${iw}`);
    check(sw <= iw, `${label} scrollWidth ${sw} <= innerWidth ${iw}`);
  };
  const pct = async () => Number((await page.textContent('#saved-pct')).replace('%', ''));
  const bars = () => page.$$eval('#gantt .bar', b => b.length);
  const rows = () => page.$$eval('#task-list .task-item', b => b.length);
  const pick = async name => { // 勾选前置里名称以 name 开头的任务
    await page.$$eval('#f-deps .dep-opt', (els, n) => els.forEach(l => { if (l.textContent.startsWith(n)) l.querySelector('input').click(); }), name);
  };

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  check(await bars() === 0 && await page.isVisible('#empty-guide'), '空状态:无泳道块,显示引导');
  check(await page.isDisabled('#export-svg'), '空状态:导出按钮禁用');
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

  // 载入示例
  await page.click('#load-sample');
  await page.waitForSelector('#gantt .bar');
  const n0 = await bars();
  const p0 = await pct();
  check(n0 === 8 && await rows() === 8, `载入示例后泳道块 ${n0} = 8`);
  check(p0 > 0, `示例节省 ${p0}% > 0`);
  check(await page.textContent('#sum-serial') === '1小时47分钟', '串联总时长 107 分钟');
  check(await page.$$eval('.lane-auto .bar', b => b.length) === 3 && await page.$$eval('.lane-present .bar', b => b.length) === 5, '在场 5 块 / 放着跑 3 块');

  // 载入示例不能无确认覆盖
  await page.click('#load-sample');
  check(await page.isVisible('#confirm-box'), '已有数据时载入示例先出现页内确认');
  check(await rows() === 8, '确认前原状态保留');
  await page.click('#confirm-no');
  check(!(await page.isVisible('#confirm-box')) && await rows() === 8, '取消后原状态保留');

  // 错误贴近控件:空名称提交 → 聚焦名称框并显示原因
  await page.fill('#f-dur', '5');
  await page.click('#f-submit');
  check((await page.getAttribute('#f-name', 'aria-invalid')) === 'true' && (await page.textContent('#form-error')).includes('任务名称'), '提交失败在出错输入旁显示原因并标红');
  check(await page.evaluate(() => document.activeElement.id === 'f-name') && (await page.getAttribute('#f-name', 'aria-describedby')) === 'form-error', '提交失败聚焦第一个出错控件并用 aria-describedby 关联');
  await page.click('#f-cancel');
  const cbSize = await page.evaluate(() => { const r = document.querySelector('#f-deps input').getBoundingClientRect(); return [r.width, r.height]; });
  check(cbSize[0] >= 24 && cbSize[1] >= 24, `前置复选框视觉尺寸 ≥ 24×24 (${cbSize.join('×')})`);
  // 新增任务(在场 30 分钟,无前置)→ 块数 +1,节省百分比变化
  await page.fill('#f-name', '写周报');
  await page.fill('#f-dur', '30');
  await page.selectOption('#f-type', 'present');
  await page.waitForTimeout(80);
  check(await bars() === 9 && await pct() < p0, `点“添加任务”之前,控件改动已即时重排预览(块 9,节省 ${await pct()}%)`);
  check(await page.isVisible('#preview-flag') && await rows() === 8, '预览有“未保存”标记且任务列表尚未落盘');
  await page.click('#f-submit');
  await page.waitForFunction(() => document.querySelectorAll('#gantt .bar').length === 9);
  check(!(await page.isVisible('#preview-flag')), '提交后预览标记消失');
  const p1 = await pct();
  check(await bars() === 9 && await rows() === 9, `新增后泳道块 9`);
  check(p1 < p0, `新增在场任务后节省 ${p0}% → ${p1}% 下降`);
  const hintsText = await page.textContent('#hints');
  console.log('提示:' + hintsText.trim());

  // 改为放着跑 → 并联,节省上升(改类型)
  await page.click('#task-list .task-item:last-child [data-act=edit]');
  await page.selectOption('#f-type', 'auto');
  await page.waitForTimeout(80);
  const p2pre = await pct();
  check(p2pre > p1, `改类型后未点保存,节省已预览 ${p1}% → ${p2pre}%`);
  await page.click('#f-submit');
  await page.waitForTimeout(100);
  const p2 = await pct();
  check(p2 === p2pre, '保存后与预览一致');
  check(p2 > p1, `改为放着跑后节省 ${p1}% → ${p2}% 上升`);
  check(await page.$$eval('.lane-auto .bar', b => b.length) === 4, '放着跑泳道 4 块');

  // 改前置:让写周报排在“打电话”(最后的在场任务)之后 → 总时长变长,节省下降
  await page.click('#task-list .task-item:last-child [data-act=edit]');
  await pick('打电话');
  await page.waitForTimeout(80);
  const p3pre = await pct();
  check(p3pre < p2, `勾选前置后未点保存,节省已预览 ${p2}% → ${p3pre}%`);
  await page.click('#f-submit');
  await page.waitForTimeout(100);
  const p3 = await pct();
  check(p3 === p3pre, '保存后与预览一致(前置)');
  check(p3 < p2, `改前置后节省 ${p2}% → ${p3}% 下降`);
  check(await page.textContent('#task-list .task-item:last-child .task-meta').then(t => t.includes('前置:打电话')), '任务行显示新前置');

  // 环检测:让“烧水”依赖“泡茶”(泡茶已依赖烧水)
  const orderBefore = await page.$$eval('#task-list .task-name', e => e.map(x => x.textContent).join('|'));
  await page.click('#task-list .task-item:first-child [data-act=edit]');
  await pick('泡茶');
  await page.waitForTimeout(80);
  check(await page.isVisible('#cycle-box') && await page.$$eval('#task-list .task-item.is-cycle', e => e.length) === 2, '勾选形成环的前置后,点保存前即高亮环成员');
  await page.click('#f-submit');
  await page.waitForTimeout(100);
  const cyc = await page.$$eval('#task-list .task-item.is-cycle', e => e.map(x => x.querySelector('.task-name').textContent));
  check(cyc.length === 2 && cyc.some(t => t.includes('烧水')) && cyc.some(t => t.includes('泡茶')), `环成员高亮:${cyc.join(' / ')}`);
  const cycText = await page.textContent('#cycle-box');
  check(cycText.includes('循环依赖') && cycText.includes('烧水') && cycText.includes('泡茶'), '环提示文字指出环上任务');
  check(await page.$$eval('#f-deps .dep-opt.is-cycle', e => e.length) >= 1, '前置选项里的环成员也高亮');
  check(await page.$$eval('#task-list .task-name', e => e.map(x => x.textContent).join('|')) === orderBefore, '有环时修改被阻断,数据未变');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png') });
  await page.click('#f-cancel');
  check(!(await page.isVisible('#cycle-box')), '取消修改后环提示消失');
  check(await pct() === p3, '取消修改后甘特回到已保存状态');

  // 上下移动:合法移动 / 违反前置被拒
  const firstName = () => page.textContent('#task-list .task-item:first-child .task-name');
  await page.click('#task-list .task-item:nth-child(3) [data-act=up]'); // 回邮件上移到泡茶之前
  await page.waitForTimeout(80);
  check((await page.textContent('#task-list .task-item:nth-child(2) .task-name')).includes('回邮件'), '合法上移生效');
  await page.click('#task-list .task-item:nth-child(2) [data-act=down]'); // 回邮件下移,泡茶回到第 2
  await page.click('#task-list .task-item:nth-child(2) [data-act=up]'); // 泡茶上移到烧水之前 → 违反前置
  await page.waitForTimeout(80);
  check((await page.textContent('#notice')).includes('必须排在前置任务'), '违反前置的移动给出原因');
  check(await page.$$eval('#task-list .task-item.is-rejected', e => e.length) === 1, '被拒任务高亮');
  check((await firstName()).includes('烧水'), '被拒后顺序不变');

  // 页内确认:模板与导出
  await page.fill('#tpl-name', '周二上午');
  await page.click('#tpl-save');
  check(await page.$$eval('#tpl-list .tpl-item', e => e.length) === 1, '模板已保存');
  const tplTaskCount = await rows();

  // 边界值:超长名称 + 超大耗时 → 保存后 reload 仍在
  const longName = '长'.repeat(3000);
  await page.fill('#f-name', longName);
  await page.fill('#f-dur', '9999999');
  await page.selectOption('#f-type', 'auto');
  await page.click('#f-submit');
  await page.waitForTimeout(100);
  const beforeReload = await rows();
  await page.reload();
  check(await rows() === beforeReload && await rows() === tplTaskCount + 1, `边界值(3000 字名称 + 9999999 分钟)保存后 reload 仍在,共 ${beforeReload} 项`);
  check(await page.textContent('#save-state') === '已保存到本机浏览器', '保存成功提示在真实写入后显示');

  // 删除边界值任务(最后一项),并走载入模板路径
  await page.click('#task-list .task-item:last-child [data-act=del]');
  check(await page.isVisible('#confirm-box') && await rows() === tplTaskCount + 1, '删除任务先出现页内确认,确认前任务数不变');
  await page.click('#confirm-yes');
  check(await rows() === tplTaskCount, '确认后删除任务');
  await page.click('#clear-data');
  check(await page.isVisible('#confirm-box'), '清空先页内确认');
  await page.click('#confirm-yes');
  check(await rows() === 0 && await page.$$eval('#tpl-list .tpl-item', e => e.length) === 0, '确认后已清空');
  // 导入:先造一份含模板的 JSON 再清空,验证导入
  await page.click('#load-sample');
  await page.fill('#tpl-name', '合成模板');
  await page.click('#tpl-save');
  await page.click('#task-list .task-item:first-child [data-act=del]');
  const delText = await page.textContent('#confirm-box');
  check(delText.includes('烧水') && delText.includes('泡茶') && delText.includes('从这些任务的前置里移除'), '删除前确认列出受影响的依赖任务');
  check(await rows() === 8, '确认前依赖关系与任务数不变');
  await page.click('#confirm-no');
  check(await rows() === 8 && (await page.textContent('#task-list .task-item:nth-child(2) .task-meta')).includes('前置:烧水'), '取消删除后原任务与依赖保留');
  await page.click('#task-list .task-item:first-child [data-act=del]');
  await page.click('#confirm-yes');
  check(await rows() === 7 && !(await page.textContent('#task-list .task-item:first-child .task-meta')).includes('前置'), '确认后才删除任务并移除依赖');
  check(await page.evaluate(() => document.activeElement && document.activeElement.dataset.act === 'edit'), '删除后焦点落在相邻任务的修改按钮');
  await page.click('[data-act=tpl-load]');
  check(await page.isVisible('#confirm-box'), '载入模板在已有数据时先确认');
  await page.click('#confirm-yes');
  check(await rows() === 8, '载入模板后恢复 8 项');

  // 导出
  const dl = async sel => { const [d] = await Promise.all([page.waitForEvent('download'), page.click(sel)]); const p = await d.path(); return { name: d.suggestedFilename(), text: fs.readFileSync(p, 'utf8') }; };
  check((await page.textContent('#sum-note')).includes('不保证最短时间'), '汇总旁写明排程口径:不保证最短时间');
  check((await page.textContent('.stat:nth-child(2) .stat-label')) === '当前顺序下的总时长', '总时长标签改为“当前顺序下的总时长”');
  check((await page.textContent('#today-note')).includes('基准日 2026-10-20(由地址参数固定)'), '?today 生效时持续显示基准日');
  check(await page.isVisible('#sample-badge'), '由示例存成的模板载入后仍带「合成示例」标记');
  // 预览期间导出与保存模板被禁用
  await page.fill('#f-name', '预览中任务');
  await page.fill('#f-dur', '12');
  await page.waitForTimeout(80);
  check(await page.isVisible('#preview-flag'), '表单有改动时显示预览标记');
  check(await page.isDisabled('#export-svg') && await page.isDisabled('#export-csv') && await page.isDisabled('#export-json') && await page.isDisabled('#tpl-save'), '预览期间 SVG/CSV/JSON 导出与保存模板全部禁用');
  check(await page.isVisible('#export-note'), '预览期间显示先保存或取消的提示');
  check((await page.textContent('#f-cancel')) === '清空表单', '新增模式下可用「清空表单」放弃草稿');
  await page.click('#f-cancel');
  check(!(await page.isDisabled('#export-svg')) && !(await page.isDisabled('#tpl-save')) && !(await page.isVisible('#export-note')), '放弃草稿后导出与模板恢复');
  const svg = await dl('#export-svg');
  check(svg.name.endsWith('.svg') && (svg.text.match(/data-task=/g) || []).length === 8, `SVG 导出 8 个任务块(${svg.name})`);
  check(/fill="#[0-9a-f]{6}"/i.test(svg.text) && !svg.text.includes('fill=""'), 'SVG 颜色来自界面 token(非空)');
  const csv = await dl('#export-csv');
  check(csv.text.startsWith('\uFEFF序号,名称') && csv.text.trim().split('\r\n').length === 9, 'CSV 导出表头 + 8 行');
  const json = await dl('#export-json');
  const parsed = JSON.parse(json.text);
  check(parsed.tasks.length === 8 && parsed.templates.length === 1, 'JSON 导出任务与模板');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png') });

  // 导入校验:非法 → 整份拒绝;合法 → 确认后替换
  const bad = JSON.parse(json.text); bad.tasks[0].dur = 0;
  await page.setInputFiles('#import-file', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
  await page.waitForSelector('#import-error:not([hidden])');
  check((await page.textContent('#import-error')).includes('整份拒绝') && await rows() === 8, '非法导入(耗时 0)整份拒绝且数据未改');
  const good = JSON.parse(json.text); good.sample = false; good.tasks = good.tasks.slice(0, 3).map(t => Object.assign({}, t, { deps: [] }));
  await page.setInputFiles('#import-file', { name: 'ok.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(good)) });
  await page.waitForSelector('#confirm-yes');
  check(await rows() === 8, '合法导入在确认前不替换');
  await page.click('#confirm-yes');
  check(await rows() === 3, '确认后导入 3 项');
  check(!(await page.isVisible('#sample-badge')), '导入真实数据后「合成示例」标记消失');
  await noOverflow('桌面');

  // 手机
  await page.click('#load-sample');
  await page.click('#confirm-yes');
  check(await page.isVisible('#sample-badge'), '载入合成示例后任务区持续标注「合成示例」');
  await page.reload();
  check(await page.isVisible('#sample-badge'), '刷新后「合成示例」标注仍在');
  const sampleCsv = await dl('#export-csv');
  check(sampleCsv.text.includes('数据性质') && sampleCsv.text.includes('合成示例'), '示例数据导出的 CSV 带「合成示例」');
  const sampleSvg = await dl('#export-svg');
  check(sampleSvg.text.includes('合成示例'), '示例数据导出的 SVG 带「合成示例」');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  await noOverflow('手机');
  const lanes = await page.$$eval('.lane', ls => ls.map(l => { const r = l.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }));
  check(lanes.length === 2 && lanes[1].top >= lanes[0].bottom, '手机端两条泳道纵向堆叠');
  check(await page.$$eval('.g-row', rs => rs.every(r => { const l = r.children[0].getBoundingClientRect(), t = r.children[1].getBoundingClientRect(); return t.top >= l.bottom - 1; })), '手机端任务名在上、条在下');
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
  await page.close();
  await ctx.close();

  // 存储失败:setItem 抛 QuotaExceededError
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const sp = await ctx2.newPage();
  watch(sp, '存储失败页');
  await sp.addInitScript(() => { Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); }; });
  await sp.goto(URL);
  await sp.click('#load-sample');
  await sp.waitForSelector('#gantt .bar');
  check(await sp.isVisible('#save-warning') && (await sp.textContent('#save-warning')).includes('未保存'), '写入抛 QuotaExceededError 时显示持续可见的“未保存”提示');
  check(await sp.textContent('#save-state') === '未保存', '状态栏显示“未保存”而非“已保存”');
  await sp.fill('#f-name', '再加一条'); await sp.fill('#f-dur', '5'); await sp.click('#f-submit');
  check(await sp.isVisible('#save-warning'), '后续操作仍然持续提示未保存');
  await ctx2.close();

  // 展示图
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  watch(show, '展示页');
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(400);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();

  console.log(`断言共 ${asserts} 条`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
