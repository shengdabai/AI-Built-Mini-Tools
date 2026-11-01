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
  const check = (cond, msg) => { asserts++; if (!cond) problems.push('断言失败:' + msg); else console.log('ok  ' + msg); };
  const watch = p => {
    p.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
    p.on('pageerror', e => problems.push('pageerror: ' + e.message));
  };

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  const page = await ctx.newPage(); watch(page);
  const noOverflow = async label => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(`${label}: scrollWidth ${sw} <= innerWidth ${iw}`);
    check(sw <= iw, `${label} 无横向溢出`);
  };
  const text = sel => page.textContent(sel);
  const pick = (i, n) => page.click(`#g-dims .dim:nth-child(${i}) .level[data-level="${n}"]`);

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  check(await page.isVisible('#g-empty'), '空状态显示引导');
  check((await text('.tagline')).includes('量规（按评分项目、权重和等级组成的评分表）'), '首屏首次出现「量规」时附带中文解释');
  check(await page.isVisible('#top-import'), '空状态下导入 JSON 备份入口始终可见');
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

  // 载入示例
  await page.click('#load-sample');
  await page.waitForSelector('#g-dims .dim');
  check((await page.$$('#g-dims .dim')).length === 4, '示例量规 4 个维度');
  check(await page.inputValue('#g-date') === '2026-10-20', '?today 固定默认日期');
  check((await text('#g-base')).includes('基准日 2026-10-20（由地址参数固定）'), '日期旁持续显示基准日由地址参数固定');
  check(await page.isVisible('#sample-badge'), '载入示例后持续显示合成示例标记');
  const rule = await text('#g-rule');
  check(rule.includes('总分＝Σ（权重×等级）×25÷Σ权重') && rule.includes('等级 1、2、3、4 分别对应 25、50、75、100 分') && rule.includes('A：总分 ≥ 85；B：70 至 84.9；C：55 至 69.9；D：< 55'), '预览旁写明总分公式、等级对应分数和 A/B/C/D 边界');
  const radioSize = await page.evaluate(() => { const r = document.querySelector('#g-dims input[type=radio]').getBoundingClientRect(); const l = document.querySelector('#g-dims .level').getBoundingClientRect(); return [r.width, r.height, l.height]; });
  check(radioSize[0] >= 24 && radioSize[1] >= 24 && radioSize[2] >= 32, `单选按钮视觉 ≥24 且标签点击区 ≥32(${radioSize.join('x')})`);
  check(await page.isDisabled('#g-save') && await page.isDisabled('#g-copy-md') && await page.isDisabled('#g-dl-md'), '未完成时保存与导出被禁用');

  // 批改
  await page.fill('#g-student', 'S04');
  await page.fill('#g-title', '点餐对话');
  await pick(1, 4); await pick(2, 3); await pick(3, 2); await pick(4, 1);
  await page.fill('#g-dims .dim:nth-child(3) .extras textarea', '我要一个<b>鸡蛋</b>饭');
  await page.fill('#g-dims .dim:nth-child(4) .extras input', '多练「了」');
  // (4*30+3*25+2*20+1*25)*25/100 = 65
  check((await text('#g-total')) === '65', '加权总分 65');
  check((await text('#g-grade')) === '合格', '总分 65 为合格');
  const fb = await text('#g-feedback');
  check(fb.includes('S04 你好') && fb.includes('### 词汇') && fb.includes('老师补充:多练「了」'), '反馈含称呼、维度、教师补充');
  check(fb.includes('\\<b\\>鸡蛋\\</b\\>'), '引用中的 HTML 被转义');
  const next = fb.split('### 下次重点')[1];
  check(next.includes('语法') && next.includes('词汇') && !next.includes('发音'), '下次重点取等级最低的两个维度');
  check(await page.isEnabled('#g-save'), '信息齐全后可保存');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png') });
  await noOverflow('桌面-批改');

  // 导出单次反馈
  const [dlMd] = await Promise.all([page.waitForEvent('download'), page.click('#g-dl-md')]);
  const mdFile = path.join(os.tmpdir(), 'rubricfb-' + dlMd.suggestedFilename());
  await dlMd.saveAs(mdFile);
  check(fs.readFileSync(mdFile, 'utf8').includes('### 下次重点'), '下载的 .md 含下次重点');
  await page.click('#g-copy-md');
  await page.waitForFunction(() => /已复制|不允许复制/.test(document.getElementById('toast').textContent), null, { timeout: 5000 });
  check(true, '复制按钮给出明确结果提示:' + await text('#toast'));
  // 切到英文
  await page.selectOption('#g-lang', 'en');
  check((await text('#g-feedback')).includes('Hi S04,'), '英文模板生效');
  await page.selectOption('#g-lang', 'zh');
  check(await page.getAttribute('#g-save', 'form') === 'g-form' && await page.getAttribute('#g-save', 'type') === 'submit', '保存按钮是关联批改表单的提交按钮');
  await page.click('#g-save');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('已保存'));
  check(await page.isDisabled('#g-save'), '保存后表单重置、保存按钮再次禁用');
  // 在输入框里按 Enter 与点按钮走同一套保存校验
  await page.fill('#g-student', 'S05');
  await page.fill('#g-title', '回车保存');
  await page.press('#g-title', 'Enter');
  check((await text('#g-status')).includes('还差：1 个维度未选等级') === false && (await text('#g-status')).includes('4 个维度未选等级'), '未选等级时按 Enter 不保存并说明还差什么: ' + await text('#g-status'));
  await pick(1, 3); await pick(2, 3); await pick(3, 3); await pick(4, 3);
  await page.press('#g-title', 'Enter');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('S05'));
  check(await page.isDisabled('#g-save'), '输入框里按 Enter 保存成功并重置表单');
  await page.click('[data-tab="students"]');
  await page.click('.student-btn >> text=S05');
  await page.click('#s-records li:first-child button:has-text("删除")');
  await page.click('#s-confirm-yes');
  await page.waitForFunction(() => !document.querySelector('.student-btn') || !Array.from(document.querySelectorAll('.student-btn')).some(b => b.textContent.startsWith('S05')));
  await page.click('[data-tab="grade"]');

  // 学员页
  await page.click('[data-tab="students"]');
  const names = await page.$$eval('.student-btn', els => els.map(e => e.textContent));
  check(names.length === 4 && names.some(n => n.startsWith('S04')), '学员列表含新增的 S04');
  await page.click('.student-btn >> text=S01');
  check((await page.$$('#s-table tbody tr')).length === 2, 'S01 趋势表 2 行');
  const changes = await page.$$eval('#s-table tfoot td', els => els.map(e => e.textContent));
  console.log('S01 变化:', changes.join(' | '));
  check(changes[0] === '+1' && changes[1] === '+1' && changes[2] === '0' && changes[3] === '+1', 'S01 各维度变化 +1 +1 0 +1');
  await page.click('#s-records li:first-child button:has-text("查看反馈")');
  check((await text('#s-view-text')).includes('S01 你好'), '回看历史反馈');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png') });
  await noOverflow('桌面-学员');
  const [dlCsv] = await Promise.all([page.waitForEvent('download'), page.click('#s-csv')]);
  const csvFile = path.join(os.tmpdir(), 'rubricfb-s01.csv'); await dlCsv.saveAs(csvFile);
  const csv = fs.readFileSync(csvFile, 'utf8').replace(/^\uFEFF/, '').split('\r\n');
  check(csv.length === 4 && csv[0].startsWith('日期,学员,作业标题,量规,总分,等级,发音,流利,词汇,语法') && csv[3] === '含合成示例数据,不是真实学员' && dlCsv.suggestedFilename().includes('含合成示例'), '学员 CSV 表头与 2 行数据,示例数据导出带合成示例标注');
  // 删除记录(页内确认)
  await page.click('#s-records li:first-child button:has-text("删除")');
  check(await page.isVisible('#s-confirm'), '删除前出现页内确认区');
  await page.click('#s-confirm-no');
  check((await page.$$('#s-records li')).length === 2, '取消后记录仍在');

  // 量规编辑
  await page.click('[data-tab="rubric"]');
  await page.fill('#r-dims .dim:nth-child(1) input[type=number]', '-5');
  await page.click('#r-save');
  check((await text('#r-errors')).includes('负数'), '负权重被拒绝并说明原因');
  await page.fill('#r-dims .dim:nth-child(1) input[type=number]', '40');
  check((await text('#r-weights')).includes('权重合计 110'), '权重之和 110 时提示按比例归一');
  await page.click('#r-add-dim');
  check((await page.$$('#r-dims .dim')).length === 5, '可添加维度');
  await page.click('#r-new');
  check((await text('#r-errors')).includes('未保存'), '有未保存修改时不允许切换量规');
  await page.click('#r-discard');
  await page.click('#r-new');
  check((await page.$$('#r-select option')).length === 2, '可新建第二套量规');
  await page.fill('#r-name', '写作作业');
  await page.fill('#r-dims .dim:nth-child(1) input:not([type=number])', '结构');
  await page.click('#r-save');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('量规已保存'));
  await noOverflow('桌面-量规');
  await page.click('#r-delete');
  check(await page.isVisible('#r-confirm'), '删除量规前出现页内确认区');
  await page.click('#r-confirm-yes');
  check((await page.$$('#r-select option')).length === 1, '确认后删除第二套量规');

  // P0 回归:60 字量规名复制后保存、刷新仍能读取
  await page.fill('#r-name', '长'.repeat(60));
  await page.click('#r-save');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('量规已保存'));
  await page.click('#r-copy');
  await page.waitForFunction(() => document.querySelectorAll('#r-select option').length === 2);
  const copyNm = await page.inputValue('#r-name');
  check(copyNm.length <= 60 && copyNm.endsWith('(副本)'), '复制 60 字量规名:截断后加后缀仍 ≤60 字');
  check(!(await page.isVisible('#save-warn')), '复制量规后保存成功,无未保存提示');
  await page.reload();
  check(!(await page.isVisible('#save-warn')), '刷新后存储仍通过完整校验(无「数据不合法」提示)');
  await page.click('[data-tab="rubric"]');
  check((await page.$$('#r-select option')).length === 2, '刷新后两套量规都在');
  await page.selectOption('#r-select', { index: 1 });
  await page.click('#r-delete'); await page.click('#r-confirm-yes');
  check((await page.$$('#r-select option')).length === 1, '删除副本');
  // P0 回归:再次载入示例,覆盖已修改的同名量规前必须页内确认
  await page.click('#load-sample');
  check(await page.isVisible('#sample-confirm'), '覆盖已修改的示例前出现页内确认区');
  check((await text('#sample-confirm-text')).includes('量规'), '确认区说明将覆盖的内容');
  await page.click('#sample-confirm-no');
  check((await page.$$eval('#g-rubric option', o => o.map(x => x.textContent.length)))[0] === 60 || (await page.$$eval('#r-select option', o => o[0].textContent.length)) === 60, '取消后用户修改的量规名保留');
  await page.click('#load-sample');
  await page.click('#sample-confirm-yes');
  await page.waitForSelector('#g-dims .dim');
  check((await page.$$eval('#g-rubric option', o => o[0].textContent)) === '中文口语作业(合成示例)', '确认后示例量规被还原');
  check(!(await page.isVisible('#sample-confirm')), '确认后确认区关闭');

  // 措辞模板
  await page.click('[data-tab="phrases"]');
  await page.fill('#t-fields [data-key="greeting"]', '亲爱的 {name}:');
  check((await text('#t-dirty')).includes('未保存') && (await text('#t-dirty')).includes('中文 1 项'), '修改措辞后显示「未保存」及项数');
  await page.selectOption('#t-lang', 'en');
  await page.selectOption('#t-lang', 'zh');
  check(await page.inputValue('#t-fields [data-key="greeting"]') === '亲爱的 {name}:', '切换语言再切回,未保存的措辞草稿仍在');
  await page.click('[data-tab="grade"]');
  check(await page.isVisible('#t-leave') && !(await page.isVisible('#g-work')), '有未保存措辞时离开页签先出现保存/放弃选择');
  await page.click('#t-leave-stay');
  check(await page.inputValue('#t-fields [data-key="greeting"]') === '亲爱的 {name}:' && !(await page.isVisible('#t-leave')), '选择留在本页后草稿保留');
  await page.click('[data-tab="grade"]');
  await page.click('#t-leave-discard');
  await page.click('[data-tab="phrases"]');
  check(await page.inputValue('#t-fields [data-key="greeting"]') !== '亲爱的 {name}:', '放弃修改后恢复已保存的措辞');
  await page.fill('#t-fields [data-key="greeting"]', '亲爱的 {name}:');
  await page.click('[data-tab="grade"]');
  await page.click('#t-leave-save');
  await page.waitForSelector('#g-work');
  await page.click('[data-tab="phrases"]');
  check(await page.inputValue('#t-fields [data-key="greeting"]') === '亲爱的 {name}:' && (await text('#t-dirty')) === '', '选择保存并离开后措辞已保存');
  await page.click('#t-save');
  await page.click('[data-tab="grade"]');
  await page.fill('#g-student', 'S09'); await page.fill('#g-title', 'x');
  await pick(1, 3); await pick(2, 3); await pick(3, 3); await pick(4, 3);
  check((await text('#g-feedback')).includes('亲爱的 S09:'), '自定义措辞模板生效');
  await noOverflow('桌面-批改2');
  await page.click('[data-tab="phrases"]'); await noOverflow('桌面-模板');

  // 数据:导出备份 / 非法导入整份拒绝 / 合法导入
  await page.click('[data-tab="data"]');
  const [dlJson] = await Promise.all([page.waitForEvent('download'), page.click('#d-backup')]);
  const jsonFile = path.join(os.tmpdir(), 'rubricfb-backup.json'); await dlJson.saveAs(jsonFile);
  const backup = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  check(backup.version === 1 && backup.records.length === 7 && backup.rubrics.length === 1, 'JSON 备份含 7 条记录');
  const bad = JSON.parse(JSON.stringify(backup)); bad.records[0].dims[0].level = 9; bad.records[1].date = '2026-99-99';
  const badFile = path.join(os.tmpdir(), 'rubricfb-bad.json'); fs.writeFileSync(badFile, JSON.stringify(bad));
  await page.setInputFiles('#d-file', badFile);
  await page.waitForSelector('#d-result .err');
  check((await text('#d-result')).includes('整份拒绝'), '非法备份被整份拒绝');
  await page.click('[data-tab="students"]');
  check((await page.$$('.student-btn')).length === 4, '拒绝后现有数据不变');
  await page.click('[data-tab="data"]');
  await page.click('#d-clear'); check(await page.isVisible('#d-confirm'), '清空前出现页内确认区');
  await page.click('#d-confirm-yes');
  await page.click('[data-tab="grade"]');
  check(await page.isVisible('#g-empty'), '清空后回到空状态');
  await page.click('[data-tab="data"]');
  check(!(await page.isVisible('#sample-badge')), '清空后合成示例标记消失');
  await page.setInputFiles('#d-file', jsonFile);
  await page.waitForSelector('#d-import-confirm:not([hidden])');
  check(/新增 1 套量规、替换 0 套量规；新增 7 条记录、替换 0 条记录/.test(await text('#d-import-text')), '导入前预览新增与替换数量:' + await text('#d-import-text'));
  await page.click('#d-import-no');
  check(!(await page.isVisible('#d-import-confirm')) && (await text('#d-result')) === '', '取消导入后不写入任何数据');
  await page.setInputFiles('#d-file', jsonFile);
  await page.waitForSelector('#d-import-confirm:not([hidden])');
  await page.click('#d-import-yes');
  await page.waitForFunction(() => document.getElementById('d-result').textContent.includes('导入成功'));
  await page.click('[data-tab="students"]');
  check((await page.$$('.student-btn')).length === 4, '合法备份导入后学员恢复');
  await noOverflow('桌面-学员2');
  await page.click('[data-tab="data"]'); await noOverflow('桌面-数据');

  // 手机
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('[data-tab="grade"]');
  await page.waitForSelector('#g-dims .dim');
  await page.fill('#g-student', 'S05'); await page.fill('#g-title', '手机演示');
  await pick(1, 3); await pick(2, 2);
  await page.waitForTimeout(150);
  await noOverflow('手机-批改');
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
  for (const t of ['rubric', 'students', 'phrases', 'data']) {
    await page.click(`[data-tab="${t}"]`); await page.waitForTimeout(80); await noOverflow('手机-' + t);
  }
  await page.close();

  // P0 回归:维度 id 为 __proto__ 的合法备份,批改保存后刷新仍可读取
  const pctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const pp = await pctx.newPage(); watch(pp);
  await pp.goto(URL);
  const lv = () => [1, 2, 3, 4].map(n => ({ desc: '描述' + n, fb: '反馈' + n }));
  const protoBackup = { version: 1, records: [], rubrics: [{ id: 'proto-r', name: '原型量规', dims: [
    { id: '__proto__', name: '原型维', weight: 50, levels: lv() }, { id: 'b', name: '乙', weight: 50, levels: lv() }] }] };
  const protoFile = path.join(os.tmpdir(), 'rubricfb-proto.json'); fs.writeFileSync(protoFile, JSON.stringify(protoBackup));
  await pp.click('[data-tab="data"]');
  await pp.setInputFiles('#d-file', protoFile);
  await pp.waitForSelector('#d-import-confirm:not([hidden])');
  await pp.click('#d-import-yes');
  await pp.waitForFunction(() => document.getElementById('d-result').textContent.includes('导入成功'));
  await pp.click('[data-tab="grade"]');
  await pp.fill('#g-student', 'P1'); await pp.fill('#g-title', '原型');
  const ppick = (i, n) => pp.click(`#g-dims .dim:nth-child(${i}) .level[data-level="${n}"]`);
  check(await pp.isDisabled('#g-save'), '__proto__ 维度未评分时不能保存');
  await ppick(2, 3);
  check(await pp.isDisabled('#g-save'), '只评了另一维度时仍不能保存');
  await ppick(1, 4); await ppick(2, 3);
  check((await pp.textContent('#g-total')) === '87.5', '__proto__ 维度评分后总分 87.5');
  await pp.click('#g-save');
  await pp.waitForFunction(() => document.getElementById('toast').textContent.includes('已保存'));
  await pp.reload();
  check(!(await pp.isVisible('#save-warn')), '含 __proto__ 维度的记录刷新后仍通过校验');
  await pp.click('[data-tab="students"]');
  check((await pp.$$eval('.student-btn', e => e.map(x => x.textContent))).some(t => t.startsWith('P1')), '刷新后 __proto__ 维度的记录仍在');
  await pctx.close();

  // 存储失败必须可见
  const fctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await fctx.addInitScript(() => {
    Storage.prototype.setItem = function () { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; };
  });
  const fp = await fctx.newPage(); watch(fp);
  await fp.goto(URL);
  await fp.click('#load-sample');
  await fp.waitForSelector('#g-dims .dim');
  check(await fp.isVisible('#save-warn'), '写入失败时显示持续的「未保存」提示');
  check((await fp.textContent('#save-warn')).includes('QuotaExceededError'), '提示包含失败原因');
  const toastTxt = await fp.evaluate(() => (document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent));
  check(!toastTxt.includes('已载入'), '写入失败时不显示成功提示');
  await fp.waitForTimeout(4200);
  check(await fp.isVisible('#save-warn'), '未保存提示不会自动消失');
  await fctx.close();

  // 展示图
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  watch(show);
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(400);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();

  console.log(`断言数:${asserts}`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
