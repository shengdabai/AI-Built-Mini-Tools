'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const Core = require('./core.js');
const EXE = process.env.CHROME_PATH || undefined;
const URL = 'file://' + encodeURI(path.join(__dirname, 'index.html')) + '?today=2026-10-20';
const OUT = path.join(__dirname, 'screenshots');

let passed = 0;
const problems = [];
function check(cond, msg) {
  if (cond) { passed += 1; console.log('  通过:' + msg); } else { problems.push('断言失败:' + msg); console.error('  失败:' + msg); }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  const noOverflow = async label => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(`${label}: scrollWidth ${sw} <= innerWidth ${iw} -> ${sw <= iw ? 'OK' : 'FAIL'}`);
    check(sw <= iw, `${label} 无横向溢出(${sw} <= ${iw})`);
  };
  const pathD = id => page.getAttribute('#' + id, 'd');
  const setField = async (sel, v) => { await page.fill(sel, v); };

  // ---------- 空状态 ----------
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  check(await page.isVisible('.disclaimer'), '顶部免责声明可见');
  check((await page.textContent('.disclaimer')).includes('合成价格序列 · 数学演示 · 不是投资建议'), '免责声明文字完整');
  check(await page.isVisible('#empty-state') && !(await page.isVisible('#compare-out')), '空状态显示引导,没有结果');
  check(await page.isDisabled('#export-csv') && await page.isDisabled('#export-md'), '空状态下序列导出被禁用');
  check(await page.isVisible('#goto-import'), '空状态下导入入口(导入价格 CSV / 记录 JSON)始终可见');
  check((await page.textContent('#today-note')).includes('基准日 2026-10-20(由地址参数固定)'), '?today 生效时页面持续显示基准日');
  check((await page.textContent('#empty-state')).includes('年数、漂移、波动、崩盘设置和种子全部相同时'), '空状态说明可复现条件');
  check((await page.textContent('#settings-form')).includes('不等于最终实际年收益') && (await page.textContent('#settings-form')).includes('控制随机涨跌的幅度'), '漂移与波动旁有解释');
  const radioBox = await page.$eval('#f-source-synthetic', e => { const r = e.getBoundingClientRect(); const l = e.closest('label').getBoundingClientRect(); return [r.width, r.height, l.height]; });
  check(radioBox[0] >= 24 && radioBox[1] >= 24 && radioBox[2] >= 32, `单选框视觉 ≥ 24×24 且 label 高度 ≥ 32 (${radioBox.map(Math.round).join('/')})`);
  // 错误贴近控件:非法年数点生成 → 聚焦出错输入
  await setField('#f-years', '0');
  await page.click('#generate');
  check((await page.getAttribute('#f-years', 'aria-invalid')) === 'true' && await page.evaluate(() => document.activeElement.id === 'f-years') && (await page.getAttribute('#f-years', 'aria-describedby')).includes('form-errors'), '生成失败聚焦出错的年数输入框,并用 aria-describedby 关联错误列表');
  await page.reload();
  // 只有尚未生成的自定义参数时,载入示例也要先确认
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await setField('#f-years', '12');
  await page.click('#sample-a');
  check(await page.isVisible('#confirm-zone') && (await page.textContent('#confirm-msg')).includes('尚未生成的参数'), '只有尚未生成的自定义参数时,载入示例先出现页内确认并说明');
  await page.click('#confirm-no');
  check((await page.inputValue('#f-years')) === '12', '取消后自定义参数保留');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

  // ---------- 载入示例 A,换种子,曲线路径必须变化 ----------
  await page.click('#sample-a');
  await page.waitForSelector('#path-never');
  check(!(await page.isVisible('#confirm-zone')), '无用户数据时载入示例不弹确认');
  const dNever = await pathD('path-never'), dStop = await pathD('path-stop'), dSell = await pathD('path-sell'), dPrice = await pathD('path-price');
  check(dNever && dStop && dSell && new Set([dNever, dStop, dSell]).size === 3, '三条资金曲线路径存在且互不相同');
  const finals = await page.$$eval('#compare-table [data-key$="-value"]', els => els.map(e => Number(e.dataset.value)));
  check(finals.length === 3 && new Set(finals).size === 3, `三条规则终值互不相同:${finals.join(' / ')}`);
  check((await page.textContent('#sample-banner')).includes('合成示例:') && await page.isVisible('#sample-banner'), '载入示例后持续显示「合成示例」提示');
  await page.reload();
  check(await page.isVisible('#sample-banner'), '刷新后「合成示例」标记仍在');
  await setField('#f-seed', '8');
  await page.waitForTimeout(100);
  check(!(await page.isVisible('#sample-banner')), '改动设定后示例标记消失');
  const dNever8 = await pathD('path-never'), dPrice8 = await pathD('path-price');
  check(dNever8 !== dNever && dPrice8 !== dPrice, '改种子后价格与资金曲线路径都变化');
  await setField('#f-seed', '7');
  await page.waitForTimeout(100);
  check((await pathD('path-never')) === dNever && (await pathD('path-price')) === dPrice, '种子改回 7 后路径与原来逐字符一致(可复现)');
  check((await page.textContent('#compare-table thead')).includes('最大资产回撤') && (await page.textContent('#dd-note')).includes('相对资产历史高点的最大跌幅') && (await page.textContent('#dd-note')).includes('连续未回到历史高点的最长月数'), '结果表头为“最大资产回撤”并解释口径与最长水下');
  const sideText = await page.textContent('#sideline');
  check(/空仓/.test(sideText), '清仓后空仓月数已显示:' + sideText.slice(0, 40));
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png') });
  await noOverflow('桌面(情景对照)');

  // ---------- 存储失败不静默 ----------
  {
    const bad = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    bad.on('pageerror', e => problems.push('pageerror(存储失败页): ' + e.message));
    await bad.addInitScript(() => { Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); }; });
    await bad.goto(URL);
    await bad.click('#sample-a');
    await bad.waitForSelector('#path-never');
    check(await bad.isVisible('#save-warning'), '写入抛 QuotaExceededError 时显示持续可见的“未保存”提示');
    check((await bad.textContent('#save-warning')).includes('未保存'), '提示文字含“未保存”并引导导出');
    check(!(await bad.textContent('#save-status')).includes('已保存'), '失败时状态栏不显示“已保存”');
    const [bkp] = await Promise.all([bad.waitForEvent('download'), bad.click('#warn-export')]);
    check(bkp.suggestedFilename().endsWith('.json'), '未保存提示里的「导出当前内存中的全部测验记录 JSON 备份」可直接下载');
    await bad.close();
  }

  // ---------- 示例替换确认 ----------
  await page.click('#sample-b');
  check(await page.isVisible('#confirm-zone'), '已有数据时载入示例先弹页内确认');
  check((await page.inputValue('#f-seed')) === '7', '确认前保留原状态(种子仍为 7)');
  await page.click('#confirm-no');
  check(!(await page.isVisible('#confirm-zone')) && (await page.inputValue('#f-seed')) === '7', '取消后状态不变');

  // ---------- 边界值:保存后 reload 仍在;半成品输入 ----------
  await setField('#f-years', '30');
  await setField('#f-seed', '4294967295');
  await setField('#f-amount', '99999999.99');
  await setField('#f-startMonth', '12');
  await page.waitForTimeout(100);
  check(await page.isVisible('#path-never'), '边界值(30 年 / 最大种子 / 近上限金额)仍可模拟');
  await page.reload();
  check((await page.inputValue('#f-years')) === '30' && (await page.inputValue('#f-seed')) === '4294967295' && (await page.inputValue('#f-amount')) === '99999999.99', '边界值保存后 reload 仍在');
  check(await page.isVisible('#path-never'), 'reload 后存档被接受并重新算出曲线');
  await setField('#f-drift', '6.');
  await page.waitForTimeout(100);
  check(await page.isVisible('#form-errors') && await page.isDisabled('#export-csv'), '半成品输入(6.)报错且序列导出被禁用');
  await page.reload();
  check((await page.inputValue('#f-drift')) === '6.' && await page.isVisible('#form-errors'), '半成品输入保存后 reload 仍在,存档未被整份拒绝');
  check(!(await page.isVisible('#load-warning')), 'reload 没有出现“存档被拒绝”提示');
  // 回到示例 A(经确认)
  await page.click('#sample-a');
  check(await page.isVisible('#confirm-zone'), '再次载入示例 A 需要确认');
  await page.click('#confirm-yes');
  await page.waitForSelector('#path-never');
  check((await page.inputValue('#f-seed')) === '7' && (await page.inputValue('#f-drift')) === '7', '确认后示例 A 替换了设定');

  // ---------- 三个规则下拉:改规则后结果变化 ----------
  const mainBefore = await page.textContent('#main-stats');
  await page.selectOption('#f-ruleType', 'sell');
  await page.waitForTimeout(100);
  const mainAfter = await page.textContent('#main-stats');
  check(mainBefore !== mainAfter && mainAfter.includes('触发清仓'), '把中断规则改成“清仓”后当前规则结果随之变化');
  await page.selectOption('#f-ruleType', 'never');

  // ---------- 耐力测验:逐月前进、遇回撤选择、走完 ----------
  await page.click('#tab-quiz');
  const recordsBefore = Number(await page.getAttribute('#record-count', 'data-count'));
  await page.click('#quiz-start');
  await page.waitForSelector('#quiz-next');
  check(await page.isVisible('#quiz-bar'), '测验开始后出现控制条');
  await page.click('#quiz-next');
  check((await page.textContent('#quiz-month')) === '1', '点“前进一月”后进度为第 1 月');
  let prompts = 0, continued = 0, sold = 0;
  for (let guard = 0; guard < 400; guard++) {
    if (await page.isVisible('#quiz-result')) break;
    if (await page.isVisible('#quiz-prompt')) {
      prompts += 1;
      check(await page.isDisabled('#quiz-next') || !(await page.isVisible('#quiz-next')), '弹出选择时“前进一月”不可用');
      if (prompts === 1) { await page.screenshot({ path: path.join(OUT, '02b-测验选择区-桌面.png') }); await page.click('#quiz-continue'); continued += 1; }
      else { await page.click('#quiz-sell'); sold += 1; }
    } else await page.click('#quiz-next');
  }
  await page.waitForSelector('#quiz-result');
  check(prompts >= 1 && continued === 1, `回撤超阈值时弹出页内选择区(共 ${prompts} 次),并做出一次“继续”`);
  const recordsAfter = Number(await page.getAttribute('#record-count', 'data-count'));
  check(recordsAfter === recordsBefore + 1, `走完测验后记录数 ${recordsBefore} -> ${recordsAfter}(+1)`);
  check(await page.isVisible('#path-behavior') && await page.isVisible('#path-rule'), '结束后显示行为曲线与规则曲线');
  check(!(await page.isVisible('#quiz-bar')), '测验结束后控制条收起');
  await page.screenshot({ path: path.join(OUT, '02c-测验结果-桌面.png') });
  // 自动播放按钮可用(不依赖计时断言结果)
  await page.click('#quiz-start');
  await page.click('#quiz-auto');
  check((await page.getAttribute('#quiz-auto', 'aria-pressed')) === 'true', '自动播放可开启');
  await page.click('#quiz-auto');
  check((await page.getAttribute('#quiz-auto', 'aria-pressed')) === 'false', '自动播放可暂停');
  await page.click('#quiz-reset');
  check(await page.isVisible('#quiz-start'), '放弃重来回到测验起点');

  // ---------- 全部押上 ----------
  await page.click('#tab-lump');
  await page.waitForSelector('#path-lump');
  const lumpNote = await page.textContent('#lump-note');
  check(/全投更深/.test(lumpNote), '示例 A 上全投回撤更深:' + lumpNote.slice(0, 30));
  await noOverflow('桌面(全部押上)');

  // ---------- 导出与导入 ----------
  await page.click('#tab-data');
  const dl = async sel => { const [d] = await Promise.all([page.waitForEvent('download'), page.click(sel)]); return { name: d.suggestedFilename(), text: fs.readFileSync(await d.path(), 'utf8') }; };
  const csv = await dl('#export-csv');
  const csvLines = csv.text.replace(/^﻿/, '').trim().split('\n');
  check(csv.name.endsWith('.csv') && csvLines[0] === '月,价格,从不停止(分),跌30%停投(分),跌30%清仓(分)' && csvLines.length === 121, `CSV 下载:${csv.name},${csvLines.length} 行`);
  const md = await dl('#export-md');
  check(md.text.includes('合成价格序列 · 数学演示 · 不是投资建议') && md.text.includes('## 情景对照') && md.text.includes('耐力测验记录'), `Markdown 下载含免责声明与对照:${md.name}`);
  const js = await dl('#export-json');
  const parsed = Core.validateImport(js.text);
  check(parsed.ok && parsed.records.length === recordsAfter, `记录 JSON 下载可被 validateImport 接受(${parsed.records ? parsed.records.length : 0} 条)`);
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png') });
  await noOverflow('桌面(导出与记录)');

  await page.fill('#import-text', '月,价格\n1,100\n2,0');
  await page.click('#import-apply');
  check((await page.textContent('#import-msg')).includes('拒绝'), '非正价格 CSV 整份拒绝:' + (await page.textContent('#import-msg')).slice(0, 40));
  await page.fill('#import-text', js.text);
  await page.click('#import-apply');
  check((await page.textContent('#import-msg')).includes('新增 0 条'), '重复导入相同记录被跳过');
  const tampered = JSON.parse(js.text); tampered.records[0].behaviorValue += 1;
  await page.fill('#import-text', JSON.stringify(tampered));
  await page.click('#import-apply');
  check((await page.textContent('#import-msg')).includes('冲突'), '同 id 内容不同的记录整份拒绝');
  check(Number(await page.getAttribute('#record-count', 'data-count')) === recordsAfter, '拒绝后记录数不变');
  const badJson = JSON.parse(js.text); badJson.records[0].choices = [{ month: 3, drawdown: 0.3, choice: 'hodl' }];
  await page.fill('#import-text', JSON.stringify(badJson));
  await page.click('#import-apply');
  check((await page.textContent('#import-msg')).includes('拒绝'), '枚举值非法的记录整份拒绝');
  await page.fill('#import-text', '月,价格\n1,100\n2,95\n3,90\n4,96');
  const pricesBefore = await page.inputValue('#f-seed');
  await page.click('#import-apply');
  check(await page.isVisible('#confirm-zone') && (await page.textContent('#confirm-msg')).includes('替换') && (await page.textContent('#confirm-msg')).includes('测验记录保留'), '已有价格时导入价格 CSV 先页内确认,写明替换与记录保留');
  check((await page.inputValue('#f-seed')) === pricesBefore && (await page.inputValue('#f-source-csv')) !== undefined && await page.isChecked('#f-source-synthetic'), '确认前价格来源与设定不变');
  await page.click('#confirm-no');
  check(await page.isChecked('#f-source-synthetic'), '取消后仍是原来的合成序列');
  await page.click('#import-apply');
  await page.click('#confirm-yes');
  check((await page.textContent('#import-msg')).includes('已导入 4 个月'), '合法价格 CSV 确认后导入成功');

  // ---------- 审核修复的界面验证:长年数抽样绘图、非法 CSV 拒绝 ----------
  await page.click('#tab-compare');
  await page.check('#f-source-synthetic');
  await page.waitForTimeout(100);
  await setField('#f-startMonth', '1');
  await setField('#f-years', '100');
  await page.waitForTimeout(200);
  check(await page.isVisible('#path-never'), '100 年(1200 个月)仍可模拟并绘图');
  const pts = (await pathD('path-never')).split(' L').length;
  check(pts <= 602, `长序列绘线被抽样(路径点数 ${pts} <= 602)`);
  await setField('#f-years', '7');
  await setField('#f-years', '10');
  await page.click('#tab-data');
  await page.fill('#import-text', '-1\n100\n101');
  await page.click('#import-apply');
  check((await page.textContent('#import-msg')).includes('拒绝'), '首行为负价格的 CSV 整份拒绝(不当作表头)');
  await page.fill('#import-text', '"1"2\n3');
  await page.click('#import-apply');
  check((await page.textContent('#import-msg')).includes('拒绝'), '引号后有多余字符的 CSV 整份拒绝');
  await page.fill('#import-text', '1e-320\n1');
  await page.click('#import-apply');
  check((await page.textContent('#import-msg')).includes('拒绝'), '过小价格(1e-320)的 CSV 整份拒绝');
  check(await page.isDisabled('#export-csv') === false, '拒绝后原有序列仍可导出');
  await page.click('#tab-compare');

  // ---------- 手机 ----------
  await page.click('#sample-a');
  await page.click('#confirm-yes');
  await page.click('#tab-compare');
  check((await page.textContent('#md-preview')).includes('合成示例:') && (await page.textContent('#md-preview')).includes('最大资产回撤'), '示例数据的 Markdown 小结标注合成示例并使用“最大资产回撤”');
  await page.waitForSelector('#path-never');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  for (const t of ['compare', 'quiz', 'lump', 'data']) {
    await page.click('#tab-' + t);
    await page.waitForTimeout(80);
    await noOverflow('手机(' + t + ')');
  }
  await page.click('#tab-quiz');
  await page.click('#quiz-start');
  for (let i = 0; i < 3; i++) await page.click('#quiz-next');
  const bar = await page.evaluate(() => {
    const b = document.getElementById('quiz-bar');
    const cs = getComputedStyle(b), r = b.getBoundingClientRect();
    return { position: cs.position, padBottom: parseFloat(cs.paddingBottom), bottom: r.bottom, vh: window.innerHeight };
  });
  check(bar.position === 'fixed' && Math.abs(bar.bottom - bar.vh) < 1, `手机端控制条固定在底部(position ${bar.position}, bottom ${bar.bottom} / ${bar.vh})`);
  check(bar.padBottom >= 12, `控制条底部内边距含安全区基准(${bar.padBottom}px)`);
  await noOverflow('手机(测验进行中)');
  await page.click('#quiz-reset');
  await page.click('#tab-compare');
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });

  // ---------- 清空数据 ----------
  await page.click('#tab-data');
  await page.click('#clear-all');
  check(await page.isVisible('#confirm-zone'), '清空前先出现页内确认');
  await page.click('#confirm-yes');
  check(Number(await page.getAttribute('#record-count', 'data-count')) === 0, '确认后记录清零');
  await page.reload();
  check(await page.isVisible('#empty-state'), '清空后 reload 回到空状态');
  await page.close();

  // ---------- 展示图 ----------
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  show.on('pageerror', e => problems.push('showcase pageerror: ' + e.message));
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(400);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();

  console.log(`断言通过 ${passed} 条`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
