'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const URL = 'file://' + encodeURI(path.join(__dirname, 'index.html'));
const OUT = path.join(__dirname, 'screenshots');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });
  const problems = [];
  let asserts = 0;
  const ok = (cond, msg) => { asserts++; if (!cond) problems.push('断言失败:' + msg); else console.log('  ✓ ' + msg); };

  const watch = page => {
    page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
    page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  };
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  watch(page);

  const noOverflow = async (p, label) => {
    const [sw, iw] = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(`${label}: scrollWidth ${sw} <= innerWidth ${iw} → ${sw <= iw ? 'OK' : 'FAIL'}`);
    ok(sw <= iw, `${label} 无横向溢出`);
  };
  const statVal = async label => (await page.locator('#stats .stat').filter({ hasText: label }).locator('.stat-value').textContent()).trim();
  const cards = () => page.locator('.card').count();
  const card = name => page.locator('.card').filter({ has: page.locator('.card-name', { hasText: name }) });
  const inZone = (gate, moscow, name) => page.locator(`.group-zone[data-gate="${gate}"][data-moscow="${moscow}"] .card`).filter({ hasText: name }).count();

  // ---- 空状态 ----
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  ok(await page.locator('.empty').isVisible(), '空状态显示引导');
  ok(await page.locator('#export-md').isDisabled(), '空状态下导出被禁用');
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

  // ---- 载入示例 ----
  await page.click('#load-sample');
  await page.waitForSelector('.card');
  ok((await cards()) === 16, '示例载入 16 个功能');
  ok((await statVal('阻断')) === '3', '示例触发 3 条阻断(Must 超限 / 门 1 登录 / 依赖环)');
  ok((await statVal('警告')) === '2', '示例触发 2 条警告(Won\'t 为空 / 24 小时功能)');
  ok((await page.locator('.gate-locked').count()) === 1 && (await page.locator('.gate-locked').getAttribute('data-gate')) === '3', '门 2 无证据 → 门 3 标灰');
  ok((await page.locator('.gate[data-gate="3"] .gate-hint').textContent()).includes('先拿证据'), '标灰的门显示「先拿证据」');
  ok((await page.textContent('#notice')).includes('已保存'), '写入成功后才显示已保存');
  await noOverflow(page, '桌面(载入示例后)');

  // ---- 核心流程:按提示修规则 ----
  await card('微信登录').locator('[data-act="gate-next"]').click();
  ok((await inZone(2, 'must', '微信登录')) === 1, '「微信登录」用按钮从门 1 移到门 2');
  ok((await statVal('阻断')) === '2', '移走微信登录后阻断 3 → 2(门 1 关键词消失)');
  await card('情绪标签统计').locator('[data-act="lvl-down"]').click();
  ok((await inZone(1, 'should', '情绪标签统计')) === 1, '「情绪标签统计」降为 Should');
  ok((await statVal('阻断')) === '1', 'Must 降到 7 后阻断 2 → 1(只剩依赖环)');
  ok((await page.locator('#issues .issue-block').count()) === 1, '规则检查只剩一条阻断');

  // 拖拽:把「反馈关键词云」拖到门 3 的 Won't
  await page.dragAndDrop('.card:has(.card-name:text("反馈关键词云"))', '.group-zone[data-gate="3"][data-moscow="wont"]');
  ok((await inZone(3, 'wont', '反馈关键词云')) === 1, '拖拽「反馈关键词云」到门 3 / Won\'t');
  ok((await statVal('警告')) === '1', "有了 Won't 后警告 2 → 1");

  // 表单添加一个 Won't
  await page.fill('#f-name', '社区广场');
  await page.fill('#f-task', '学员之间互相点赞');
  await page.selectOption('#f-gate', '3');
  await page.selectOption('#f-moscow', 'wont');
  await page.fill('#f-hours', '6');
  await page.click('#f-submit');
  ok((await inZone(3, 'wont', '社区广场')) === 1, '表单添加功能「社区广场」');
  // 非法工时被拒
  await page.fill('#f-name', '坏数据');
  await page.fill('#f-hours', 'abc');
  await page.click('#f-submit');
  ok(await page.locator('#form-error').isVisible(), '非法工时给出表单错误');
  ok((await card('坏数据').count()) === 0, '非法工时没有新增功能');
  await page.fill('#f-name', '');
  await page.fill('#f-hours', '');

  // ---- 第五轮:草稿预览 / 导出停用 / 错误贴近控件 ----
  const hoursBefore = Number(await statVal('预计总小时'));
  const cardsBefore = await cards();
  const savedCount = () => page.evaluate(() => JSON.parse(localStorage.getItem('ladderboard.v1')).features.length);
  const savedBefore = await savedCount();
  await page.fill('#f-name', '预览功能');
  await page.selectOption('#f-gate', '1');
  await page.selectOption('#f-moscow', 'should');
  await page.fill('#f-hours', '5');
  ok((await cards()) === cardsBefore + 1 && (await page.locator('.card .chip-ok', { hasText: '预览(未保存)' }).count()) === 1, '提交前:看板即时出现带「预览(未保存)」标记的卡片');
  ok(Number(await statVal('预计总小时')) === hoursBefore + 5, '提交前:预计总小时按草稿重算(+5)');
  await page.fill('#f-hours', '7');
  ok(Number(await statVal('预计总小时')) === hoursBefore + 7, '继续修改工时,统计同步变化(+7)');
  ok((await page.textContent('#stats .stat')).includes('预览'), '统计标签标明「预览」');
  ok((await savedCount()) === savedBefore, '预览期间本机存储没有被改写');
  ok((await page.locator('#export-md').isDisabled()) && (await page.locator('#export-csv').isDisabled()) && (await page.locator('#export-json').isDisabled()), '有未保存草稿时三个导出按钮全部停用');
  ok((await page.textContent('#export-note')).includes('导出已停用'), '导出区说明停用原因');
  ok((await page.textContent('#draft-note')).includes('预览中'), '表单旁显示预览说明');
  ok((await page.textContent('#storage-banner')).length > 0 && (await page.locator('#banner-export').textContent()).includes('全部已保存功能'), '备份按钮名写明范围');
  await page.click('#f-cancel');
  ok((await cards()) === cardsBefore && Number(await statVal('预计总小时')) === hoursBefore, '清空表单后看板与统计回到已保存状态');
  ok(await page.locator('#export-md').isEnabled(), '草稿放弃后导出恢复');
  // 编辑已有功能:门与工时变化即时反映在列合计
  const g3Before = await page.locator('.gate[data-gate="3"] .gate-hours').textContent();
  await card('微信登录').locator('[data-act="edit"]').click();
  await page.selectOption('#f-gate', '3');
  const g3After = await page.locator('.gate[data-gate="3"] .gate-hours').textContent();
  ok(g3After !== g3Before, '编辑中改所属门:门 3 合计在保存前即变化(' + g3Before + ' → ' + g3After + ')');
  ok((await page.locator('#export-json').isDisabled()), '编辑未保存时导出停用');
  await page.click('#f-cancel');
  ok((await page.locator('.gate[data-gate="3"] .gate-hours').textContent()) === g3Before, '取消编辑后列合计还原');
  // 错误贴近控件
  await page.fill('#f-name', '坏数据2');
  await page.fill('#f-hours', 'abc');
  await page.click('#f-submit');
  ok((await page.getAttribute('#f-hours', 'aria-describedby')) === 'err-f-hours' && (await page.locator('#err-f-hours').isVisible()), '非法工时:错误显示在输入框旁并用 aria-describedby 关联');
  ok((await page.evaluate(() => document.activeElement.id)) === 'f-hours', '提交失败后焦点回到出错的输入框');
  await page.click('#f-cancel');
  ok((await page.locator('.field-error').count()) === 0, '放弃后错误提示消失');
  ok((await page.textContent('label[for="f-moscow"]')).includes('四级法') && (await page.locator('#f-moscow option').first().textContent()).includes('必须做'), '优先级选项为中文并保留英文对照');
  ok((await page.locator('#f-layer option[value="e2e"]').textContent()).includes('模拟用户'), '端到端验证层带中文解释');

  // 过门证据
  await page.fill('#ev-2', '(演示)一位非本人老师完成了提交;她反馈入口太深。');
  await page.press('#ev-2', 'Tab');
  ok((await page.locator('.gate-locked').count()) === 0, '填了门 2 证据后门 3 解除标灰');
  ok((await page.textContent('#evchip-2')) === '已过门', '门 2 证据芯片显示已过门');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png') });

  // ---- 替换确认 ----
  const before = await cards();
  await page.click('#load-sample');
  ok(await page.locator('#confirm-area').isVisible(), '已有数据时「载入示例」先显示页内确认');
  ok((await cards()) === before, '确认前保留原状态');
  await page.click('#confirm-no');
  ok((await cards()) === before && !(await page.locator('#confirm-area').isVisible()), '取消后数据不变');

  // ---- 边界值保存后 reload 仍在 ----
  const longName = '长'.repeat(3000);
  await page.fill('#f-name', longName);
  await page.fill('#f-hours', '99999999999');
  await page.selectOption('#f-moscow', 'could');
  await page.click('#f-submit');
  await page.fill('#f-name', '半成品想法');
  await page.fill('#f-hours', '0');
  await page.click('#f-submit');
  const countAfterAdd = await cards();
  await page.reload();
  await page.waitForSelector('.card');
  ok((await cards()) === countAfterAdd, '超长名称 + 超大工时 + 半成品保存后 reload 仍全部在');
  ok((await page.evaluate(() => [...document.querySelectorAll('.card-name')].some(n => n.textContent.length === 3000))) , '3000 字名称完整保留');
  ok(!(await page.locator('#notice.notice-error').isVisible()), 'reload 后没有读取校验错误');
  ok(await page.locator('#storage-banner').isHidden(), 'reload 后没有未保存横幅');

  // 删掉超长名称演示项(也验证删除确认),保持导出截图可读
  await card('长长长').locator('[data-act="delete"]').click();
  ok(await page.locator('#confirm-area').isVisible(), '删除功能先显示页内确认');
  await page.click('#confirm-yes');
  ok((await cards()) === countAfterAdd - 1, '确认后功能被删除');

  // ---- 导出 ----
  await page.fill('#f-name', "=cmd|' /C calc'!A0");
  await page.fill('#f-hours', '1');
  await page.click('#f-submit');
  await page.evaluate(() => document.getElementById('check-title').scrollIntoView());
  const [dMd] = await Promise.all([page.waitForEvent('download'), page.click('#export-md')]);
  const md = fs.readFileSync(await dMd.path(), 'utf8');
  console.log('PRD 下载:', dMd.suggestedFilename());
  ok(md.includes('## Must 清单') && md.includes("## Won't") && md.includes('## 验证层分布'), 'PRD 片段含 Must / 验证层 / Won\'t 小节');
  ok((await page.textContent('#md-preview')) === md, '预览与下载内容一致');
  const [dCsv] = await Promise.all([page.waitForEvent('download'), page.click('#export-csv')]);
  const csv = fs.readFileSync(await dCsv.path(), 'utf8');
  ok(csv.charCodeAt(0) === 0xFEFF && csv.includes("'=cmd|"), 'CSV 带 BOM 且公式被单引号前缀');
  ok(csv.split('\r\n')[0].includes('功能名'), 'CSV 表头存在');
  const [dJson] = await Promise.all([page.waitForEvent('download'), page.click('#export-json')]);
  const jsonText = fs.readFileSync(await dJson.path(), 'utf8');
  ok(JSON.parse(jsonText).format === 'ladder-board', 'JSON 备份格式正确');
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png') });

  // ---- 导入:坏文件整份拒绝;好文件替换前确认 ----
  const total = await cards();
  const bad = JSON.parse(jsonText); bad.project.features[0].moscow = 'urgent';
  await page.setInputFiles('#import-file', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
  await page.waitForSelector('#notice.notice-error');
  ok((await page.textContent('#notice')).includes('导入被拒绝'), '非法枚举的导入被拒绝并说明原因');
  ok((await cards()) === total, '拒绝后数据不变');
  await page.setInputFiles('#import-file', { name: 'good.json', mimeType: 'application/json', buffer: Buffer.from(jsonText) });
  await page.waitForSelector('#confirm-area:not([hidden])');
  await page.click('#confirm-yes');
  ok((await cards()) === total, '合法备份确认后导入,功能数一致');

  // ---- 清空 ----
  await page.click('#clear-data');
  ok(await page.locator('#confirm-area').isVisible(), '清空先显示页内确认');
  await page.click('#confirm-yes');
  ok(await page.locator('.empty').isVisible() && (await cards()) === 0, '清空后回到空状态');

  // ---- 只改关键词也算有数据 ----
  await page.evaluate(() => document.getElementById('kw').closest('details').open = true);
  await page.fill('#kw', '云同步、短信');
  await page.press('#kw', 'Tab');
  await page.click('#load-sample');
  ok(await page.locator('#confirm-area').isVisible(), '只改了关键词时「载入示例」也先显示页内确认');
  await page.click('#confirm-no');
  ok((await page.inputValue('#kw')) === '云同步、短信', '取消后自定义关键词保留');
  await page.click('#clear-data');
  ok(await page.locator('#confirm-area').isVisible(), '只改了关键词时「清空数据」可执行(出现确认)');
  await page.click('#confirm-yes');
  ok((await page.inputValue('#kw')) === '登录、支付、数据库、服务端', '清空后关键词表恢复默认');

  // ---- 存储失败 ----
  const bp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(bp);
  await bp.addInitScript(() => {
    Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
  });
  await bp.goto(URL);
  await bp.click('#load-sample');
  await bp.waitForSelector('.card');
  ok(await bp.locator('#storage-banner').isVisible(), '写入抛 QuotaExceededError 时显示持续可见的未保存横幅');
  ok((await bp.textContent('#save-state')) === '未保存', '顶栏状态为「未保存」');
  const bn = await bp.textContent('#notice');
  ok(!bn.includes('已保存。') && bn.includes('尚未保存'), '失败时不显示「已保存」成功提示');
  const [bd] = await Promise.all([bp.waitForEvent('download'), bp.click('#banner-export')]);
  ok(bd.suggestedFilename().endsWith('.json'), '横幅可直接导出 JSON 备份');
  await bp.close();

  // ---- 手机 ----
  await page.click('#load-sample');
  await page.waitForSelector('.card');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  await noOverflow(page, '手机');
  const stacked = await page.evaluate(() => {
    const g = [...document.querySelectorAll('.gate')].map(e => e.getBoundingClientRect());
    return g.every((r, i) => i === 0 || r.top > g[i - 1].top);
  });
  ok(stacked, '手机端三个门纵向分段');
  const touch = await page.evaluate(() => {
    const cbs = [...document.querySelectorAll('#f-deps input')].map(i => i.getBoundingClientRect());
    const labs = [...document.querySelectorAll('#f-deps label')].map(l => l.getBoundingClientRect().height);
    return { n: cbs.length, minBox: Math.min(...cbs.map(r => Math.min(r.width, r.height))), minLabel: Math.min(...labs) };
  });
  ok(touch.n > 0 && touch.minBox >= 24 && touch.minLabel >= 32, '手机:依赖勾选框 ≥24px,label 点击区 ≥32px(' + touch.minBox + '/' + touch.minLabel + ')');
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
  await page.close();

  // ---- 展示图 ----
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  watch(show);
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(400);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();

  console.log(`断言总数:${asserts}`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
