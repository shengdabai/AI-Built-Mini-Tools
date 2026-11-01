'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const URL = 'file://' + encodeURI(path.join(__dirname, 'index.html')) + '?today=2026-10-20';
const OUT = path.join(__dirname, 'screenshots');

let asserts = 0;
const problems = [];
function check(cond, msg) { asserts++; if (!cond) problems.push('断言失败:' + msg); else console.log('ok  ' + msg); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));

  const noOverflow = async label => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    check(sw <= iw, `${label}: scrollWidth ${sw} <= innerWidth ${iw}`);
  };
  const nodes = () => page.locator('#preview-chain .node').count();
  const levels = () => page.locator('#levels .level-input');
  const tab = async n => { await page.click(`[data-tab="${n}"]`); await page.waitForTimeout(80); };
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('causalchain.v1')));

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });
  check((await page.textContent('#today-label')).includes('基准日 2026-10-20(由地址参数固定)'), '?today 固定今天并持续显示基准日');
  check(await page.isVisible('#import-btn-top'), '空状态下「导入 JSON 备份」入口始终可见');
  const radioBox = await page.$eval('input[name="f-mood"]', e => { const r = e.getBoundingClientRect(); const l = e.closest('label').getBoundingClientRect(); return [r.width, r.height, l.height]; });
  check(radioBox[0] >= 24 && radioBox[1] >= 24 && radioBox[2] >= 32, `单选框视觉 ≥ 24×24 且 label 高度 ≥ 32 (${radioBox.map(Math.round).join('/')})`);
  check((await page.textContent('legend:has-text("链条")')).includes('草稿可以暂不填写链条'), '链条说明区分正式复盘与草稿');
  // 错误贴近控件:缺事件时聚焦事件框
  await page.fill('#f-who', 'A 娃');
  await levels().nth(0).fill('因为甲');
  await levels().nth(1).fill('所以乙');
  await page.click('#save-btn');
  check((await page.getAttribute('#f-event', 'aria-invalid')) === 'true' && await page.evaluate(() => document.activeElement.id === 'f-event') && (await page.getAttribute('#f-event', 'aria-describedby')) === 'form-error', '缺事件:原因显示并聚焦事件输入框,用 aria-describedby 关联');
  await levels().nth(0).fill('');
  await levels().nth(1).fill('');
  await page.fill('#f-who', '');
  check(await page.locator('#pending-empty').isVisible(), '空状态显示「今天没有待复盘」');

  // ---- 录入一条含远期词的复盘 ----
  await page.fill('#f-who', 'A 娃');
  await page.fill('#f-event', '骑车不戴头盔');
  await levels().nth(0).fill('因为骑车没戴头盔');
  check((await page.textContent('#issues')).includes('再推一步'), '只写 1 级时提示「再推一步」');
  await levels().nth(1).fill('所以以后找不到工作');
  check((await page.textContent('#issues')).includes('空泛因果,换成今天看得见的'), '含远期词时出现「空泛因果」提示');
  const n2 = await nodes();
  await page.click('#add-level');
  const n3 = await nodes();
  check(n2 === 2 && n3 === n2 + 1, `增加一级后链条节点数 ${n2} → ${n3}(+1)`);
  await levels().nth(2).fill('然后戴上头盔就安全了');
  check((await page.locator('#preview-chain .node').nth(2).textContent()).includes('然后戴上头盔就安全了'), '编辑第 3 级即时重绘到预览');
  await page.check('#f-tags input[value="安全"]');
  await page.check('input[name="f-proposer"][value="child"]');
  check(await page.locator('#preview-chain .chain-child').count() === 1, '孩子提出时链条使用孩子配色类');
  // 有情绪:保存按钮禁用 + 提示
  await page.check('input[name="f-mood"][value="upset"]');
  check((await page.textContent('#issues')).includes('先冷静,复盘时再谈') && await page.locator('#save-btn').isEnabled() && await page.locator('#save-draft-btn').isEnabled(), '有情绪时只提示「先冷静」,保存复盘与存草稿两个按钮都可用');
  await page.check('input[name="f-mood"][value="calm"]');
  // 删除最后一级:有内容先确认,空白直接删
  const lv0 = await nodes();
  await page.click('#remove-level');
  check(await page.isVisible('#confirm-box') && (await page.textContent('#confirm-text')).includes('然后戴上头盔就安全了') && await nodes() === lv0, '删除已填写的最后一级先页内确认,确认前链条不变');
  await page.click('#confirm-no');
  check(await nodes() === lv0 && (await levels().nth(2).inputValue()) === '然后戴上头盔就安全了', '取消后内容保留');
  // 表单有未保存内容时导出暂停
  await tab('export');
  check(await page.isDisabled('#export-md') && await page.isDisabled('#export-json') && (await page.textContent('#export-hint')).includes('尚未保存'), '表单有未保存内容时 Markdown/CSV/JSON 导出禁用并说明');
  await tab('review');
  // 边界:超长文本保存后 reload 仍在
  const LONG = '长'.repeat(3000);
  await page.fill('#f-event', '骑车不戴头盔' + LONG);
  await page.click('#save-btn');
  await page.waitForTimeout(100);
  check((await page.textContent('#status-msg')).includes('已保存'), '保存成功后才出现「已保存」');
  check(await page.locator('#save-alert').isHidden(), '正常保存时无「未保存」提示');
  await page.reload();
  const st1 = await stored();
  check(st1.entries.length === 1 && st1.entries[0].event.length === 6 + 3000, '3000 字超长事件保存后 reload 仍在');
  await tab('browse');
  check((await page.textContent('#browse-count')).includes('共 1 条'), 'reload 后回看页仍有 1 条');
  await tab('review');

  // ---- 载入示例:已有数据必须先确认 ----
  await page.click('#load-sample');
  check(await page.locator('#confirm-box').isVisible(), '已有数据时载入示例先出现页内确认');
  check((await stored()).entries.length === 1, '确认前原数据保持不变');
  await page.click('#confirm-no');
  check((await stored()).entries.length === 1, '取消后原数据仍在');
  await page.click('#load-sample');
  await page.click('#confirm-yes');
  await page.waitForSelector('.pending-item');
  check((await stored()).entries.length === 10, '确认后替换为 10 条合成示例');
  check(await page.locator('#sample-note').isVisible(), '显示「合成示例」提示');
  check(await page.locator('.pending-item').count() === 1, '今天的事只列当天未复盘的 1 条草稿');

  // ---- 继续复盘草稿 ----
  await page.click('.pending-item button');
  check((await page.textContent('#form-h')) === '编辑复盘' && await nodes() === 1, '点「继续复盘」载入草稿,1 级时链条 1 个节点');
  await page.click('#cancel-edit');

  // ---- 新条目 + 关联旧条目 + 即时重绘 ----
  await page.fill('#f-who', 'A 娃');
  await page.fill('#f-event', '又忘带水杯');
  await page.selectOption('#f-prev', 'sample-3');
  check(await page.locator('#preview-prev').isVisible() && (await page.textContent('#preview-prev')).includes('上次链条'), '选择关联后显示「上次链条」');
  const lv = ['因为早上没看书包', '所以中午没水喝', '然后下午头疼', '接着约好明早先检查书包'];
  await levels().nth(0).fill(lv[0]); await levels().nth(1).fill(lv[1]);
  await page.click('#add-level'); await levels().nth(2).fill(lv[2]);
  const before = await nodes();
  await page.click('#add-level'); await levels().nth(3).fill(lv[3]);
  check(await nodes() === before + 1, `再增加一级后链条节点数 ${before} → ${before + 1}`);
  await page.check('#f-tags input[value="其他"]');
  await page.check('input[name="f-proposer"][value="child"]');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png') });
  await noOverflow('桌面·复盘页');
  await page.click('#save-btn');
  await page.waitForTimeout(100);
  check((await stored()).entries.length === 11, '保存第 11 条');
  check((await stored()).entries[10].prevId === 'sample-3', '新条目 prevId 指向 sample-3');

  // ---- 回看 ----
  await tab('browse');
  await page.fill('#q-text', '水杯');
  check((await page.textContent('#browse-count')).includes('共 3 条'), '关键词「水杯」命中 3 条(中文子串)');
  check(await page.locator('.entry .prev-box').count() >= 2, '关联条目显示上次链条');
  await page.fill('#q-text', '');
  await page.selectOption('#q-who', 'B 娃');
  await page.selectOption('#q-tag', '安全');
  check((await page.textContent('#browse-count')).includes('共 2 条'), '按孩子 + 标签筛选得 2 条');
  await page.selectOption('#q-who', '');
  await page.selectOption('#q-tag', '');
  check(await page.locator('.entry .issue-far').count() === 1, '示例中的远期词条目在回看页带提示');
  const entriesBefore = (await stored()).entries.length;
  await page.click('.entry .btn-quiet >> nth=0');
  check(await page.isVisible('#confirm-box') && (await page.textContent('#confirm-text')).includes('确认前数据不变') && (await stored()).entries.length === entriesBefore, '删除条目先页内确认,确认前条数不变');
  await page.click('#confirm-no');
  check((await stored()).entries.length === entriesBefore, '取消删除后条目保留');
  await noOverflow('桌面·回看页');

  // ---- 统计 ----
  await tab('stats');
  check(await page.locator('#ratio-chart circle').count() >= 3, '比例折线有 ≥3 个数据点(运行时 SVG)');
  check(await page.locator('#ratio-chart polyline').count() === 2, '示例有两周无记录:折线分成 2 段(不跨空周连线)');
  check(await page.locator('#ratio-chart .gap-label').count() === 2 && (await page.textContent('#ratio-chart .gap-label >> nth=0')) === '无记录', '无记录的周在图上标「无记录」');
  check((await page.textContent('#tab-stats')).includes('含草稿和「自己」的条目') && (await page.textContent('.bar-count >> nth=0')).endsWith(' 条'), '标签分布写明统计范围,数量带单位“条”');
  check(await page.locator('.bar-row').count() === 4, '标签条形 4 行');
  await page.screenshot({ path: path.join(OUT, '05-统计-桌面.png') });
  await noOverflow('桌面·统计页');

  // ---- 导出 / 导入 ----
  await tab('export');
  const dl = async sel => { const [d] = await Promise.all([page.waitForEvent('download'), page.click(sel)]); return [d.suggestedFilename(), fs.readFileSync(await d.path(), 'utf8')]; };
  const [mdName, md] = await dl('#export-md');
  check(md.includes('合成示例'), '示例数据的 Markdown 复盘册标注合成示例');
  check(mdName.endsWith('.md') && md.includes('## 2026-09') && md.includes('## 2026-10') && md.includes('关联上次:'), 'Markdown 按月分组且含关联');
  const [csvName, csv] = await dl('#export-csv');
  check(csv.split('\r\n')[0].endsWith('数据性质') && csv.includes('合成示例'), '示例数据的 CSV 带「数据性质」列');
  check(csvName.endsWith('.csv') && csv.split('\r\n').length === 13, 'CSV 表头 + 11 行');
  const [jsonName, json] = await dl('#export-json');
  check(jsonName.endsWith('.json') && JSON.parse(json).entries.length === 11, 'JSON 备份含 11 条');
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png') });
  await noOverflow('桌面·导出页');

  const bad = JSON.parse(json); bad.entries[0].chain = ['只有一级'];
  await page.setInputFiles('#import-file', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
  await page.waitForFunction(() => document.getElementById('import-msg').textContent.includes('拒绝'));
  check((await page.textContent('#import-msg')).includes('至少 2 级') && (await stored()).entries.length === 11, '级数不足的备份整份被拒并说明原因,现有数据未改');
  const bad2 = JSON.parse(json); bad2.entries[1].proposer = 'teacher';
  await page.setInputFiles('#import-file', { name: 'bad2.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad2)) });
  await page.waitForFunction(() => document.getElementById('import-msg').textContent.includes('谁提出'));
  check((await stored()).entries.length === 11, '枚举非法的备份被拒');
  await page.setInputFiles('#import-file', { name: 'ok.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await page.waitForSelector('#confirm-box:not([hidden])');
  check(await page.locator('#confirm-box').isVisible() && (await page.textContent('#confirm-text')).includes('替换'), '合法备份导入前先出现页内替换确认');
  await page.click('#confirm-yes');
  await page.waitForTimeout(100);
  check((await stored()).entries.length === 11, '确认后导入成功');

  // 设置:改远期词
  await page.fill('#c-far', '以后、下辈子');
  await page.click('#config-form button[type=submit]');
  check((await stored()).config.farWords.join() === '以后,下辈子', '设置保存后写入存储');

  // ---- 清空 ----
  await page.click('#clear-all');
  check((await stored()).entries.length === 11, '清空确认前数据仍在');
  await page.click('#confirm-yes');
  await page.waitForTimeout(100);
  check((await stored()).entries.length === 0, '确认后清空');

  // ---- 只有自定义设置、没有条目:载入示例也要确认 ----
  await tab('export');
  await page.fill('#c-far', '下辈子');
  await page.click('#config-form button[type=submit]');
  check((await stored()).entries.length === 0 && (await stored()).config.farWords.join() === '下辈子', '无条目但有自定义设置');
  await page.click('#load-sample');
  check(await page.locator('#confirm-box').isVisible() && (await page.textContent('#confirm-text')).includes('自定义设置'), '只有自定义设置时载入示例先出现页内确认');
  await page.click('#confirm-no');
  check((await stored()).config.farWords.join() === '下辈子' && (await stored()).entries.length === 0, '取消后自定义设置保持不变');
  await page.click('#load-sample');
  await page.click('#confirm-yes');
  await page.waitForTimeout(100);
  check((await stored()).entries.length === 10 && (await stored()).config.farWords.includes('以后'), '确认后才替换为示例与示例设置');
  await page.click('#clear-all');
  await page.click('#confirm-yes');
  await page.waitForTimeout(100);
  check((await stored()).entries.length === 0, '再次清空以进入手机端检查');

  // ---- 手机 ----
  await page.setViewportSize({ width: 390, height: 844 });
  await tab('review');
  await page.click('#load-sample');
  await page.waitForSelector('.pending-item');
  await page.fill('#f-who', 'B 娃');
  await page.fill('#f-event', '玩滑板不戴护具');
  await levels().nth(0).fill('因为觉得自己滑得稳');
  await levels().nth(1).fill('所以转弯时摔倒');
  await page.click('#add-level'); await levels().nth(2).fill('然后手肘擦伤');
  await page.click('#add-level'); await levels().nth(3).fill('接着这周不能滑板');
  check(await page.evaluate(() => getComputedStyle(document.querySelector('#preview-chain .chain')).flexDirection) === 'column', '手机端链条纵向排列');
  await page.waitForTimeout(150);
  await noOverflow('手机·复盘页');
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
  for (const [n, label] of [['browse', '回看页'], ['stats', '统计页'], ['export', '导出页']]) { await tab(n); await noOverflow('手机·' + label); }
  check(await page.locator('#ratio-chart svg').count() === 1, '手机端统计折线正常绘制');
  await page.close();

  // ---- 存储失败不能静默 ----
  const p2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  p2.on('pageerror', e => problems.push('pageerror(存储失败页): ' + e.message));
  await p2.addInitScript(() => {
    Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
  });
  await p2.goto(URL);
  await p2.click('#load-sample');
  await p2.waitForTimeout(100);
  check(await p2.locator('#save-alert').isVisible() && (await p2.textContent('#save-alert')).includes('未保存'), '写入抛 QuotaExceededError 时显示持续可见的「未保存」');
  check(!(await p2.textContent('#status-msg')).includes('已'), '写入失败时不显示成功提示');
  const [bk] = await Promise.all([p2.waitForEvent('download'), p2.click('#save-alert-export')]);
  check(bk.suggestedFilename().endsWith('.json'), '未保存提示里的「导出当前内存中的全部复盘 JSON 备份」可直接下载');
  await p2.click('#save-alert [data-go-export]');
  check(await p2.locator('#export-json').isEnabled(), '提示中的按钮可跳转导出并能导出备份');
  await p2.close();

  // ---- 展示图 ----
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  show.on('pageerror', e => problems.push('showcase pageerror: ' + e.message));
  if (fs.existsSync(path.join(__dirname, 'showcase.html'))) {
    await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
    await show.waitForTimeout(400);
    await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  } else problems.push('缺少 showcase.html');
  await browser.close();

  console.log(`断言共 ${asserts} 条`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
