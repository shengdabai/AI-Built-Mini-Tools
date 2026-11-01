'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const URL = 'file://' + encodeURI(path.join(__dirname, 'index.html'));
const OUT = path.join(__dirname, 'screenshots');

const SAMPLE_DIFF_FOR_TEST = require('./sample-data.js').diff;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });
  const problems = [];
  let asserts = 0;
  const check = (cond, msg) => { asserts++; if (!cond) problems.push(msg); };
  const watch = (page, tag) => {
    page.on('console', m => { if (m.type() === 'error') problems.push(`${tag} console: ${m.text()}`); });
    page.on('pageerror', e => problems.push(`${tag} pageerror: ${e.message}`));
  };

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  watch(page, '主页面');
  const noOverflow = async (p, label) => {
    const [sw, iw] = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(`${label}: scrollWidth ${sw} <= innerWidth ${iw} -> ${sw <= iw ? 'OK' : 'FAIL'}`);
    check(sw <= iw, `${label} 横向溢出 ${sw} > ${iw}`);
  };

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });
  check(await page.isHidden('#results'), '空状态不应显示结果');
  check(await page.isDisabled('#analyze') === false, '分析按钮应可点');

  // 错误路径:乱输入与坏 JSON
  await page.fill('#input', '随便一句话');
  await page.click('#analyze');
  check(await page.isVisible('#error-box'), '未识别输入应显示错误');
  await page.fill('#input', '{"dependencies": {"a": "1.0.0"}}\n{\n "dependencies": {\n  "a": "2.0.0",\n }\n}');
  await page.click('#analyze');
  const errText = await page.textContent('#error-text');
  console.log('JSON 错误提示:', errText);
  check(/新 package\.json/.test(errText) && /第 \d+ 行第 \d+ 列/.test(errText), '坏 JSON 应定位到新文件的行列');

  // 核心流程:载入示例(两份 package.json)
  await page.click('#load-sample');
  check(await page.isVisible('#replace-confirm'), '输入框有内容时载入示例应先确认');
  await page.click('#replace-yes');
  await page.waitForSelector('#changes-body tr');
  check(await page.isHidden('#error-box'), '成功分析后错误提示应隐藏');
  const rows = await page.$$eval('#changes-body tr', r => r.length);
  console.log('示例变更行数:', rows);
  check(rows === 16, `示例应有 16 行变更,实际 ${rows}`);
  const majorRows = await page.$$eval('#changes-body tr.row-danger', r => r.length);
  check(majorRows === 2, `major 行应为 2,实际 ${majorRows}`);
  const detected = await page.textContent('#detected');
  check(detected.includes('两份 package.json'), '识别结果应为两份 package.json');
  check(await page.isVisible('#save-status') && /已保存/.test(await page.textContent('#save-status')), '写入成功后应显示已保存');
  check(await page.isHidden('#save-warning'), '正常存储不应出现未保存提示');
  await page.evaluate(() => document.getElementById('sum-h').scrollIntoView());
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png') });
  await noOverflow(page, '桌面');

  // 输入改动后导出被禁用,重新分析后恢复
  await page.fill('#input', (await page.inputValue('#input')) + ' ');
  check(await page.isDisabled('#export-md') && await page.isDisabled('#export-csv') && await page.isDisabled('#copy-md'), '输入改动后导出应禁用');
  check(await page.isVisible('#stale-note'), '应提示结果过期');
  await page.click('#analyze');
  check(await page.isEnabled('#export-md'), '重新分析后导出应恢复');

  // 导出
  await page.evaluate(() => document.getElementById('export-panel').scrollIntoView());
  const [mdDl] = await Promise.all([page.waitForEvent('download'), page.click('#export-md')]);
  const mdPath = await mdDl.path();
  const md = fs.readFileSync(mdPath, 'utf8');
  console.log('下载:', mdDl.suggestedFilename());
  check(md.startsWith('## 依赖更新影响说明'), 'Markdown 标题');
  check(md.includes('| `react` | dependencies | Major |'), 'Markdown 含 react major 行');
  check((await page.inputValue('#md-preview')) === md, '预览与下载内容应一致');
  const [csvDl] = await Promise.all([page.waitForEvent('download'), page.click('#export-csv')]);
  const csv = fs.readFileSync(await csvDl.path(), 'utf8');
  console.log('下载:', csvDl.suggestedFilename());
  check(csv.includes('包名,区块,变化') && csv.split('\r\n').filter(Boolean).length === 17, 'CSV 应含表头和 16 行');
  await page.evaluate(() => document.getElementById('check-h').scrollIntoView());
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png') });

  // 示例按钮在输入非空时必须先页内确认
  const beforeInput = await page.inputValue('#input');
  await page.click('#load-sample-diff');
  check(await page.isVisible('#replace-confirm'), '输入非空时点示例应出现替换确认');
  check((await page.inputValue('#input')) === beforeInput, '确认前不得覆盖输入');
  await page.click('#replace-no');
  check(await page.isHidden('#replace-confirm') && (await page.inputValue('#input')) === beforeInput, '取消后输入保持不变');
  await page.click('#load-sample-diff');
  await page.click('#replace-yes');
  check(await page.isHidden('#replace-confirm') && (await page.textContent('#detected')).includes('git diff'), '确认后应载入示例');
  // 另外两种输入
  await page.click('#load-sample-diff');
  if (await page.isVisible('#replace-confirm')) await page.click('#replace-yes');
  await page.waitForSelector('#changes-body tr');
  check((await page.textContent('#detected')).includes('git diff'), 'diff 识别');
  check((await page.textContent('#changes-body')).includes('moment'), 'diff 结果含移除的 moment');
  await page.click('#load-sample-outdated');
  await page.click('#replace-yes');
  await page.waitForSelector('#changes-body tr');
  check((await page.textContent('#detected')).includes('npm outdated'), 'outdated 识别');
  check((await page.textContent('#changes-body')).includes('express'), 'outdated 结果含 express');

  // 清空需页内确认
  await page.click('#clear-btn');
  check(await page.isVisible('#clear-confirm'), '应出现页内确认区');
  await page.click('#clear-no');
  check((await page.inputValue('#input')).length > 0, '取消后数据仍在');
  await page.click('#clear-btn');
  await page.click('#clear-yes');
  check((await page.inputValue('#input')) === '' && await page.isHidden('#results'), '确认后应清空');

  // ---- 第五轮新增断言 ----
  await page.click('#load-sample-outdated');
  await page.waitForSelector('#changes-body tr');
  check((await page.textContent('#basis-note')).includes('Current → Latest') && (await page.textContent('#basis-note')).includes('Wanted'), '结果上方写明比较基准 Current → Latest 并解释 Wanted');
  check(await page.isVisible('#sample-badge'), '载入示例后持续显示「合成示例」');
  const latestBody = await page.textContent('#changes-body');
  await page.check('#target-wanted');
  check(await page.isDisabled('#export-md') && await page.isVisible('#stale-note'), '切换目标列后旧结果过期,导出禁用');
  await page.click('#analyze');
  const wantedBody = await page.textContent('#changes-body');
  check((await page.textContent('#basis-note')).includes('Current → Wanted') && wantedBody !== latestBody, '切到 Wanted 重新分析后基准与结果都变了');
  await page.reload();
  check(await page.isChecked('#target-wanted') && await page.isVisible('#sample-badge'), '刷新后目标列设置与示例标记仍在');
  await page.evaluate(() => document.getElementById('export-panel').scrollIntoView());
  const [sMd] = await Promise.all([page.waitForEvent('download'), page.click('#export-md')]);
  const sMdText = fs.readFileSync(await sMd.path(), 'utf8');
  check(sMdText.includes('数据来源:合成示例') && sMdText.includes('比较基准:Current → Wanted'), '导出的 Markdown 标注合成示例和比较基准');
  const [sCsv] = await Promise.all([page.waitForEvent('download'), page.click('#export-csv')]);
  const sCsvText = fs.readFileSync(await sCsv.path(), 'utf8');
  check(sCsvText.split('\r\n')[0].endsWith('数据来源') && sCsvText.split('\r\n')[1].endsWith('合成示例'), '导出的 CSV 带「数据来源」列');
  await page.fill('#input', (await page.inputValue('#input')) + '\n');
  check(await page.isHidden('#sample-badge'), '修改输入后合成示例标记消失');

  // 仅偏离默认的目标列设置、输入为空时载入示例也要确认
  await page.click('#clear-btn');
  check((await page.textContent('#clear-q')).includes('Wanted'), '清空确认写明会恢复目标列设置');
  await page.click('#clear-yes');
  check(await page.isChecked('#target-latest'), '清空后目标列恢复默认 Latest');
  await page.check('#target-wanted');
  await page.click('#load-sample');
  check(await page.isVisible('#replace-confirm') && (await page.textContent('#replace-q')).includes('目标列设置'), '只改了目标列设置也要先确认,并列明会被替换');
  await page.click('#replace-no');
  check(await page.isChecked('#target-wanted') && (await page.inputValue('#input')) === '', '取消后设置保持');
  await page.check('#target-latest');

  // 错误贴近输入框
  await page.fill('#input', '随便一句话');
  await page.click('#analyze');
  check(await page.getAttribute('#input', 'aria-describedby') === 'error-box' && await page.evaluate(() => document.activeElement.id) === 'input', '识别失败时错误关联输入框并聚焦它');

  // 没有 major 时的说明文案
  await page.fill('#input', '{"dependencies":{"a":"1.0.0"}}\n{"dependencies":{"a":"1.0.1"}}');
  await page.click('#analyze');
  const chk = await page.textContent('#checklist');
  check(chk.includes('本工具仅为 major 升级生成逐包清单') && !chk.includes('不需要逐包检查'), '没有 major 时不再说「不需要检查」');

  // 从 TXT 文件载入:先检查,有输入时先确认
  const good = path.join(__dirname, '.omc', 'load-test.txt');
  fs.writeFileSync(good, SAMPLE_DIFF_FOR_TEST);
  await page.setInputFiles('#load-file', good);
  await page.waitForSelector('#replace-confirm:not([hidden])');
  check(await page.isVisible('#replace-confirm') && (await page.textContent('#replace-q')).includes('load-test.txt'), '载入文件前先确认并写明文件名与替换范围');
  check((await page.inputValue('#input')).startsWith('{"dependencies"'), '确认前输入框不变');
  await page.click('#replace-yes');
  check((await page.inputValue('#input')) === SAMPLE_DIFF_FOR_TEST, '确认后输入框是文件内容');
  fs.writeFileSync(good, '   \n  ');
  await page.setInputFiles('#load-file', good);
  await page.waitForSelector('#file-error:not([hidden])');
  check(await page.isVisible('#file-error') && (await page.inputValue('#input')) === SAMPLE_DIFF_FOR_TEST, '空白文件被拒绝,输入框不变');
  fs.unlinkSync(good);

  // 手机
  await page.click('#load-sample');
  await page.waitForSelector('#changes-body tr');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  await noOverflow(page, '手机');
  const hit = await page.evaluate(() => [...document.querySelectorAll('input[type="radio"]')].map(el => { const r = el.getBoundingClientRect(); return [r.width, r.height, el.closest('label').getBoundingClientRect().height]; }));
  check(hit.length === 2 && hit.every(x => x[0] >= 24 && x[1] >= 24 && x[2] >= 32), '手机端 radio 视觉 >= 24px,label 点击区高度 >= 32px');
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
  await page.close();

  // 存储失败:setItem 抛 QuotaExceededError
  const bad = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  watch(bad, '存储失败页');
  await bad.addInitScript(() => {
    Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
  });
  await bad.goto(URL);
  await bad.click('#load-sample');
  await bad.waitForSelector('#changes-body tr');
  check(await bad.isVisible('#save-warning'), '存储失败应显示持续可见的未保存提示');
  check(/未保存/.test(await bad.textContent('#save-warning')) && /导出/.test(await bad.textContent('#save-warning')), '提示应含「未保存」并引导导出');
  check(!/已保存/.test(await bad.textContent('#save-status')), '失败时不得显示已保存');
  await bad.fill('#input', (await bad.inputValue('#input')) + '\n');
  check(await bad.isVisible('#save-warning'), '继续输入后提示仍可见');
  const [rawDl] = await Promise.all([bad.waitForEvent('download'), bad.click('#download-input-warn')]);
  check(fs.readFileSync(await rawDl.path(), 'utf8') === await bad.inputValue('#input') && rawDl.suggestedFilename().endsWith('.txt'), '保存失败面板里始终可下载原始输入 TXT,内容与输入框一致');
  await bad.close();

  // 展示图
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  watch(show, '展示页');
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(300);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();

  console.log(`断言数:${asserts}`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
