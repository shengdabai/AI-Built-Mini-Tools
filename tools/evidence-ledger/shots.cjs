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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  const check = (cond, msg) => { console.log((cond ? 'OK   ' : 'FAIL ') + msg); if (!cond) problems.push('断言失败:' + msg); };
  const noOverflow = async label => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(`${label}: scrollWidth ${sw} <= innerWidth ${iw} → ${sw <= iw ? 'OK' : 'FAIL'}`);
    if (sw > iw) problems.push(`${label} 横向溢出 ${sw} > ${iw}`);
  };

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });
  check(await page.isVisible('#import-btn'), '空状态下「导入 JSON 备份」入口可见');
  check((await page.textContent('#today-note')).includes('基准日 2026-10-20(由地址参数固定)'), '固定日期生效时页面显示基准日');
  {
    const bad = await browser.newPage();
    bad.on('pageerror', e => problems.push('badtoday pageerror: ' + e.message));
    await bad.goto('file://' + encodeURI(path.join(__dirname, 'index.html')) + '?today=2026-02-30');
    check(await bad.isHidden('#today-note'), '?today=2026-02-30 被拒绝,不显示基准日');
    await bad.close();
  }
  // 空项目的检查页:写「暂无主张可检查」而不是「规则生效」
  await page.click('#new-project');
  await page.click('[data-tab="audit"]');
  const emptyAudit = await page.textContent('#audit-body');
  check(emptyAudit.includes('暂无主张可检查') && !emptyAudit.includes('规则生效'), '空项目检查页写「暂无主张可检查」');
  await page.click('[data-tab="claims"]');
  // 空主张:错误贴近输入框
  await page.click('#claim-form button[type=submit]');
  check(await page.isVisible('#claim-text-error') && (await page.getAttribute('#claim-text', 'aria-invalid')) === 'true', '空主张时错误显示在输入框旁并标记 aria-invalid');
  check((await page.evaluate(() => document.activeElement.id)) === 'claim-text', '空主张时焦点回到输入框');
  await page.click('#delete-project');
  check((await page.textContent('#project-confirm-text')).includes('0 条主张'), '删除项目确认写明主张与证据数量');
  await page.click('#project-confirm-yes');

  // 核心流程:载入示例 → 看主张 → 添加一条证据 → 状态变化
  await page.click('#load-sample');
  await page.waitForSelector('.claim-item');
  await page.click('.claim-item >> nth=3'); // 「同行推荐」:无证据 → 待验证
  const before = await page.textContent('#detail-status');
  await page.selectOption('#ev-type', 'primary');
  await page.selectOption('#ev-stance', 'support');
  await page.selectOption('#ev-strength', 'medium');
  await page.fill('#ev-title', '示例:两位同行的回复');
  await page.fill('#ev-url', 'https://example.com/replies');
  await page.fill('#ev-excerpt', '两位老师都说愿意转发给同事试试。');
  await page.fill('#ev-limit', '口头意向,不是行为。');
  await page.click('#evidence-form button[type=submit]');
  await page.waitForTimeout(150);
  const after = await page.textContent('#detail-status');
  console.log(`状态变化:${before} → ${after}`);
  if (before !== '待验证' || after !== '已支持') problems.push(`状态规则未按预期变化:${before} → ${after}`);
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png') });
  await noOverflow('桌面');

  // ---------- 第五轮:未保存提示 / 删除确认 / 替换确认 ----------
  check(await page.isVisible('#sample-badge'), '示例项目持续显示「合成示例」标记');
  check((await page.textContent('#project-select')).includes('合成示例'), '项目下拉里的示例项目带「合成示例」');
  // 删除证据:先行内确认并预告状态变化
  const evBefore = await page.$$eval('.evidence', n => n.length);
  await page.click('[data-remove] >> nth=0');
  const confTxt = await page.textContent('.evidence .confirm');
  check(confTxt.includes('状态') && (await page.$$eval('.evidence', n => n.length)) === evBefore, '删除证据前出现行内确认并预告状态,确认前条数不变');
  check((await page.textContent('#detail-status')) === '已支持', '确认前主张状态不变');
  await page.click('[data-remove-no]');
  check((await page.$$eval('.evidence', n => n.length)) === evBefore, '取消后证据仍在');
  await page.click('[data-remove] >> nth=0');
  await page.click('[data-remove-yes]');
  check((await page.$$eval('.evidence', n => n.length)) === evBefore - 1 && (await page.textContent('#detail-status')) === '待验证', '确认后证据减少且状态重算为待验证');
  // 未保存的主张修改:切换前提示
  const firstText = await page.inputValue('#detail-text');
  await page.fill('#detail-text', firstText + '(改)');
  check(await page.isVisible('#dirty-note'), '修改主张文字后显示「尚未保存」');
  await page.click('.claim-item >> nth=0');
  check(await page.isVisible('#dirty-confirm') && (await page.inputValue('#detail-text')) === firstText + '(改)', '切换主张前出现 保存/放弃/取消,输入没有丢');
  await page.click('#dirty-cancel');
  check((await page.inputValue('#detail-text')) === firstText + '(改)', '取消后留在原主张且修改仍在');
  // 加证据不能吞掉未保存的修改
  await page.fill('#ev-title', '示例:再加一条');
  await page.click('#evidence-form button[type=submit]');
  check((await page.inputValue('#detail-text')) === firstText + '(改)' && (await page.isVisible('#dirty-note')), '加证据后未保存的主张修改保留');
  // 导出在有未保存修改时禁用
  await page.click('[data-tab="export"]');
  check((await page.getAttribute('#export-json', 'aria-disabled')) === 'true' && await page.isVisible('#export-hint'), '有未保存修改时导出禁用并提示');
  await page.click('[data-tab="claims"]');
  await page.click('.claim-item >> nth=0');
  await page.click('#dirty-discard');
  check((await page.inputValue('#detail-text')) !== firstText + '(改)', '放弃修改后切到另一条主张');
  await page.fill('#detail-note', '新备注');
  await page.click('.claim-item >> nth=1');
  await page.click('#dirty-save');
  const savedNote = await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('evidence.v1'))).includes('新备注'));
  check(savedNote, '保存并继续:备注已写入 localStorage');
  // 证据表单错误贴近控件
  await page.click('#evidence-form button[type=submit]');
  check((await page.textContent('#ev-error')).includes('至少填一项') && (await page.evaluate(() => document.activeElement.id)) === 'ev-title' && (await page.getAttribute('#ev-title', 'aria-describedby')) === 'ev-error', '证据为空时错误关联到来源标题并聚焦');
  // 再次载入示例:会替换同 ID 项目,先确认
  await page.fill('#detail-text', '手改后的主张');
  await page.click('#save-claim');
  await page.click('#load-sample');
  check(await page.isVisible('#import-confirm') && (await page.textContent('#import-confirm-body')).includes('替换 1 个同 ID 项目'), '再次载入示例前列出会被替换的项目');
  check((await page.textContent('#import-confirm-body')).includes('合成示例 · 某教学工具是否值得做'), '确认区写出被替换的项目名');
  await page.click('#import-confirm-no');
  check((await page.$$eval('.claim-item .text', n => n.map(x => x.textContent))).includes('手改后的主张'), '取消后人工修改仍在');
  await page.click('#load-sample');
  await page.click('#import-confirm-yes');
  check(!(await page.$$eval('.claim-item .text', n => n.map(x => x.textContent))).includes('手改后的主张'), '确认后示例被还原');
  // 导入:非法文件整份拒绝;合法文件先预览
  const [dlj] = await Promise.all([page.waitForEvent('download'), (async () => { await page.click('[data-tab="export"]'); await page.click('#export-json'); })()]);
  const jsonPath = path.join(OUT, '.tmp-backup.json');
  await dlj.saveAs(jsonPath);
  const backup = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  check(backup.projects.every(p => p.sample === true), 'JSON 备份里的示例项目带 sample 标记');
  const badPath = path.join(OUT, '.tmp-bad.json');
  fs.writeFileSync(badPath, JSON.stringify({ version: 1, projects: [{ title: 'x' }] }));
  await page.setInputFiles('#import-json', badPath);
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('导入停止'));
  check((await page.textContent('#toast')).includes('现有数据没有改动') && await page.isHidden('#import-confirm'), '非法备份被拒绝并说明现有数据没有改动');
  await page.setInputFiles('#import-json', jsonPath);
  await page.waitForSelector('#import-confirm:not([hidden])');
  check((await page.textContent('#import-confirm-body')).includes('替换 1 个同 ID 项目'), '合法备份先预览新增与替换');
  await page.click('#import-confirm-yes');
  check(await page.isVisible('#sample-badge'), '导入含示例标记的备份后标记保留');
  fs.unlinkSync(jsonPath); fs.unlinkSync(badPath);
  // 清空确认写明数量
  await page.click('[data-tab="export"]');
  await page.click('#clear-data');
  check((await page.textContent('#clear-confirm-text')).includes('1 个项目'), '清空确认写明项目/主张/证据数量');
  await page.click('#clear-confirm-no');
  await page.click('[data-tab="claims"]');

  // 检查页 + 导出页
  await page.click('[data-tab="audit"]');
  await page.waitForTimeout(100);
  const aiOnlyCount = await page.$$eval('.audit-group', g => g[1].querySelector('.count').textContent.trim());
  console.log(`检查页「仅 AI」数量:${aiOnlyCount}`);
  if (aiOnlyCount !== '1') problems.push('检查页仅 AI 计数不为 1');
  check((await page.textContent('#audit-body')).includes('本项目未发现状态冲突') && !(await page.textContent('#audit-body')).includes('规则生效'), '「强反对却仍已支持」为 0 时写「本项目未发现状态冲突」');
  await page.click('[data-tab="export"]');
  await page.waitForTimeout(100);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-md')]);
  console.log('下载文件名:', download.suggestedFilename());
  const preview = await page.textContent('#md-preview');
  if (!preview.includes('状态：**已反驳**')) problems.push('Markdown 预览缺少已反驳主张');
  check(preview.includes('数据来源：合成示例'), '示例的 Markdown 预览标注合成示例');
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png') });

  // 手机
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('[data-tab="claims"]');
  await page.waitForTimeout(200);
  await noOverflow('手机');
  const smalls = await page.evaluate(() => Array.from(document.querySelectorAll('button, a')).filter(n => n.offsetParent && n.getBoundingClientRect().height < 32).map(n => (n.id || n.textContent).slice(0, 12)));
  check(smalls.length === 0, '手机端可点元素高度均 >= 32px(不足:' + smalls.join(',') + ')');
  const smallBtns = await page.evaluate(() => Array.from(document.querySelectorAll('button')).filter(n => n.offsetParent && n.getBoundingClientRect().height < 36).map(n => (n.id || n.textContent).slice(0, 12)));
  check(smallBtns.length === 0, '手机端可见按钮高度均 >= 36px(不足:' + smallBtns.join(',') + ')');
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
  await page.close();

  // 保存失败后恢复:警告条持续可见,恢复写入后解除并说明
  {
    const rec = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    rec.on('console', m => { if (m.type() === 'error') problems.push('recover console: ' + m.text()); });
    rec.on('pageerror', e => problems.push('recover pageerror: ' + e.message));
    await rec.goto(URL);
    await rec.evaluate(() => { window.__orig = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); }; });
    await rec.click('#new-project');
    check(await rec.isVisible('#save-warning') && (await rec.textContent('#save-warning')).includes('导出 JSON 备份'), '存储失败:持续显示警告条并带备份按钮');
    await rec.fill('#claim-text', '失败状态下加主张');
    await rec.click('#claim-form button[type=submit]');
    check(await rec.isVisible('#save-warning'), '继续失败时警告条仍在,不出现「已添加」');
    check(!(await rec.textContent('#toast')).includes('已添加主张'), '写入失败时不弹成功提示');
    const [dlw] = await Promise.all([rec.waitForEvent('download'), rec.click('#warning-export')]);
    const wp = path.join(OUT, '.tmp-warn.json');
    await dlw.saveAs(wp);
    check(JSON.stringify(JSON.parse(fs.readFileSync(wp, 'utf8'))).includes('失败状态下加主张'), '警告条上的备份包含内存里刚加的主张');
    fs.unlinkSync(wp);
    await rec.evaluate(() => { Storage.prototype.setItem = window.__orig; });
    await rec.fill('#claim-text', '恢复后加主张');
    await rec.click('#claim-form button[type=submit]');
    check(await rec.isHidden('#save-warning'), '存储恢复且写入成功后警告条解除');
    check((await rec.textContent('#toast')).includes('已恢复保存'), '解除时说明当前保存结果');
    await rec.close();
  }

  // 展示图
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  show.on('pageerror', e => problems.push('showcase pageerror: ' + e.message));
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(300);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();

  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
