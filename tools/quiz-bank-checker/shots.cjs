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
  let assertions = 0;
  const expect = (cond, msg) => { assertions++; console.log((cond ? 'OK   ' : 'FAIL ') + msg); if (!cond) problems.push(msg); };
  const watch = (page, tag) => {
    page.on('console', m => { if (m.type() === 'error') problems.push(`${tag} console: ${m.text()}`); });
    page.on('pageerror', e => problems.push(`${tag} pageerror: ${e.message}`));
  };

  // ---------- 存储失败:不能静默 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    await p.addInitScript(() => {
      Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
    });
    p.on('pageerror', e => problems.push('storage-fail pageerror: ' + e.message));
    await p.goto(URL);
    await p.click('#load-sample');
    await p.waitForSelector('.card');
    expect(await p.isVisible('#save-alert'), '存储写入失败时「未保存」提示可见');
    expect((await p.textContent('#save-alert')).includes('未保存'), '提示文字含「未保存」并引导导出');
    expect(!(await p.isVisible('#toast')), '写入失败时不显示「已导入并保存」成功提示');
    expect((await p.$$('.card')).length === 16, '写入失败时内存里的题库仍可用');
    await ctx.close();
  }

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  watch(page, 'main');
  const noOverflow = async label => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(`${label}: scrollWidth ${sw} <= innerWidth ${iw} → ${sw <= iw ? 'OK' : 'FAIL'}`);
    expect(sw <= iw, `${label} 无横向溢出 (${sw} <= ${iw})`);
  };

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });
  expect(await page.isVisible('#empty'), '空状态引导可见');
  expect(await page.isDisabled('#export-exam'), '无题库时导出按钮禁用');

  // 纯文本块导入
  await page.check('input[name=fmt][value=text]');
  await page.fill('#import-text', ['1. 多行题干第一行', '第二行', 'A. 甲', 'B. 乙', '答案:C', '', '2. 第二题', 'A. 甲', 'B. 乙', '答案:B', '知识点:测试'].join('\n'));
  await page.click('#parse-btn');
  await page.waitForSelector('#import-preview:not([hidden])');
  expect((await page.textContent('#import-preview-text')).includes('解析出 2 题') && (await page.textContent('#import-preview-text')).includes('现有题库为空'), '纯文本块先预览:' + await page.textContent('#import-preview-text'));
  expect((await page.$$('.card')).length === 0, '确认前纯文本块没有写入题库');
  await page.click('#import-confirm-yes');
  await page.waitForSelector('.card');
  expect((await page.$$('.card')).length === 2, '确认后纯文本块导入得到 2 题');
  expect((await page.textContent('#issues')).includes('答案越界'), '文本块中答案 C 越界被检出');

  // 列映射不合法 → 整份拒绝
  await page.click('#import-details > summary');
  await page.check('input[name=fmt][value=csv]');
  await page.fill('#import-text', '题干,A,B,答案\n题,x,y,A');
  await page.click('#parse-btn');
  await page.waitForSelector('#mapping:not([hidden])');
  await page.uncheck('#map-options input[value="1"]');
  await page.click('#import-btn');
  expect(await page.isVisible('#import-errors') && await page.isHidden('#import-preview'), '选项列不足时导入被拒绝并显示原因,没有预览');
  expect((await page.$$('.card')).length === 2, '被拒绝的导入没有改动现有题库');

  // 未闭合引号 → 拒绝,不改动题库
  await page.fill('#import-text', '题干,A,B,答案\n题,x,y,"A');
  await page.click('#parse-btn');
  expect((await page.textContent('#import-errors')).includes('引号'), '未闭合引号被拒绝并给出原因');
  expect(await page.isHidden('#mapping') && (await page.$$('.card')).length === 2, '引号错误时不出现映射区且题库不变');

  // 解析后修改输入框 → 缓存失效,不能导入旧内容
  await page.fill('#import-text', '题干,A,B,答案\n旧内容题,x,y,A');
  await page.click('#parse-btn');
  await page.waitForSelector('#mapping:not([hidden])');
  await page.fill('#import-text', '题干,A,B,答案\n新内容题,x,y,A');
  expect(await page.isHidden('#mapping'), '输入变化后映射区收起,需重新解析');
  expect((await page.$$('.card')).length === 2 && !(await page.textContent('#cards')).includes('旧内容题'), '未重新解析时旧内容没有被导入');

  // 已有题库时 CSV 与纯文本都是「解析预览 → 确认导入」,预览写明替换数量;选 TXT 文件也只预览
  await page.fill('#import-text', '题干,A,B,答案\n预览题,x,y,A');
  await page.click('#parse-btn');
  await page.waitForSelector('#mapping:not([hidden])');
  await page.click('#import-btn');
  await page.waitForSelector('#import-preview:not([hidden])');
  expect((await page.textContent('#import-preview-text')).includes('替换现有 2 题'), 'CSV 预览写明将替换现有 2 题:' + await page.textContent('#import-preview-text'));
  expect((await page.$$('.card')).length === 2 && !(await page.textContent('#cards')).includes('预览题'), '确认前现有题库不变');
  await page.click('#import-confirm-no');
  expect(await page.isHidden('#import-preview') && (await page.$$('.card')).length === 2, '取消导入后题库不变');
  await page.setInputFiles('#import-file', { name: 'q.txt', mimeType: 'text/plain', buffer: Buffer.from('1. 文件题\nA. 甲\nB. 乙\n答案:A\n') });
  await page.waitForSelector('#import-preview:not([hidden])');
  expect((await page.$$('.card')).length === 2 && !(await page.textContent('#cards')).includes('文件题'), '选择 TXT 文件只出现预览,不直接替换题库');
  await page.click('#import-confirm-no');

  // 载入示例:已有题库时先页内确认
  await page.click('#load-sample');
  expect(await page.isVisible('#sample-confirm') && (await page.textContent('#sample-msg')).includes('现有 2 题'), '已有题库时载入示例先出现页内确认并写明替换数量:' + await page.textContent('#sample-msg'));
  expect((await page.$$('.card')).length === 2, '确认前题库未被替换');
  await page.click('#sample-no');
  expect((await page.$$('.card')).length === 2 && await page.isHidden('#sample-confirm'), '取消后题库保留');

  // 核心流程:载入示例 → 检查 → 定位问题
  await page.click('#load-sample');
  await page.click('#sample-yes');
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 16);
  const blocks = await page.$$eval('#issues .issue-group:first-child .issue-list li', l => l.length);
  expect(blocks === 4, `示例阻断问题 4 条(实际 ${blocks})`);
  const issuesText = await page.textContent('#issues');
  for (const k of ['答案越界', '题号重复', '选项文字重复', '答案长度异常', '答案字母失衡', '题干重复'])
    expect(issuesText.includes(k), `问题清单含「${k}」`);
  expect(await page.isVisible('#toast'), '写入成功后才显示成功提示');
  expect(await page.isVisible('#sample-badge'), '载入示例后持续显示合成示例标记');
  const sum0 = await page.textContent('#export-summary');
  expect(sum0.includes('4 个阻断问题') && sum0.includes('打乱选项不会修复答案越界'), '导出区持续显示阻断问题数量与打乱不修复的说明:' + sum0);
  const boxes = await page.evaluate(() => { const i = document.querySelector('input[name=fmt]').getBoundingClientRect(); const l = document.querySelector('input[name=fmt]').closest('label').getBoundingClientRect(); return [i.width, i.height, l.height]; });
  expect(boxes[0] >= 24 && boxes[1] >= 24 && boxes[2] >= 32, `单选框视觉 ≥24、标签点击区 ≥32(${boxes.join('x')})`);
  await page.click('#issues button[data-goto="12"]');
  expect(await page.evaluate(() => document.activeElement.id) === 'card-12', '点击问题定位到对应题卡');
  await page.check('#only-issues');
  const filtered = await page.$$eval('.card', c => c.length);
  expect(filtered > 0 && filtered < 16, `只看有问题的题:${filtered} 题`);
  await page.uncheck('#only-issues');
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png') });
  await noOverflow('桌面');

  // 打乱:同种子可复现、答案同步、分布改善
  await page.fill('#seed', '期中');
  await page.click('#shuffle-btn');
  await page.waitForSelector('#view-switch:not([hidden])');
  const snap = () => page.$$eval('.card', cs => cs.map(c => c.textContent.replace(/\s+/g, ' ')).join('|'));
  const first = await snap();
  await page.click('#view-original');
  const orig = await snap();
  await page.click('#shuffle-btn');
  const second = await snap();
  expect(first === second, '同种子再次打乱结果完全相同');
  expect(orig !== second, '打乱后与原题库不同');
  const answers = await page.$$eval('.card', cs => cs.map(c => c.querySelector('.opt--answer') && c.querySelector('.opt--answer span:last-child').textContent.replace(' (答案)', '')));
  const origAnswers = await (async () => { await page.click('#view-original'); return page.$$eval('.card', cs => cs.map(c => c.querySelector('.opt--answer') && c.querySelector('.opt--answer span:last-child').textContent.replace(' (答案)', ''))); })();
  expect(JSON.stringify(answers) === JSON.stringify(origAnswers), '打乱后每题的正确答案文字不变(答案已同步)');
  await page.click('#view-shuffled');
  const skewShown = (await page.textContent('#issues')).includes('答案字母失衡');
  expect(!skewShown, '打乱后答案字母失衡警告消失');

  // 导出
  await page.click('#only-issues'); await page.uncheck('#only-issues');
  const [dMd] = await Promise.all([page.waitForEvent('download'), page.click('#export-issues-md')]);
  expect(dMd.suggestedFilename().endsWith('.md'), '问题清单 Markdown 下载:' + dMd.suggestedFilename());
  await page.click('#export-shuffled-csv');
  expect(await page.isVisible('#export-confirm') && (await page.textContent('#export-confirm-text')).includes('阻断问题'), '带阻断问题导出打乱后题库先出现页内确认');
  await page.click('#export-confirm-no');
  expect(await page.isHidden('#export-confirm'), '选择「先去修复」后不导出');
  await page.click('#export-shuffled-csv');
  const [dCsv] = await Promise.all([page.waitForEvent('download'), page.click('#export-confirm-yes')]);
  expect(dCsv.suggestedFilename().startsWith('合成示例-'), '示例数据导出的文件名带合成示例标注:' + dCsv.suggestedFilename());
  const csvText = fs.readFileSync(await dCsv.path(), 'utf8');
  expect(csvText.includes('题号,题干,选项A') && csvText.trim().split('\n').length >= 17, '打乱后题库 CSV 含表头与 16 题');
  await page.click('#export-exam');
  expect(await page.isVisible('#export-confirm'), '带阻断问题导出试卷先出现页内确认');
  const [dExam] = await Promise.all([page.waitForEvent('download'), page.click('#export-confirm-yes')]);
  const examText = fs.readFileSync(await dExam.path(), 'utf8');
  expect(examText.indexOf('参考答案') > examText.indexOf('page-break-before'), '试卷 Markdown 答案在分页之后');
  expect(examText.includes('合成示例数据,不是真实题目'), '试卷内容带合成示例标注');
  // 导出原题库 CSV:无需先打乱,保留知识点与难度
  await page.click('#view-original');
  await page.click('#export-bank-csv');
  const [dBank] = await Promise.all([page.waitForEvent('download'), page.click('#export-confirm-yes')]);
  const bankText = fs.readFileSync(await dBank.path(), 'utf8');
  expect(bankText.includes('知识点') && bankText.includes('难度') && bankText.includes('合成示例数据,不是真实题目'), '原题库 CSV 含知识点、难度与示例标注');
  await page.click('#view-shuffled');
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png') });

  // 刷新后仍在(localStorage 成功路径)
  await page.reload();
  expect((await page.$$('.card')).length === 16 && await page.isVisible('#view-switch'), '刷新后题库与打乱结果保留');
  expect(await page.isVisible('#sample-badge'), '刷新后合成示例标记仍在');

  // 清空需页内确认
  await page.click('#clear-open');
  expect(await page.isVisible('#clear-confirm'), '清空前出现页内确认区');
  await page.click('#clear-no');
  expect((await page.$$('.card')).length === 16, '取消后题库保留');
  await page.click('#clear-open');
  await page.click('#clear-yes');
  expect(await page.isHidden('#sample-badge') && await page.isVisible('#empty'), '清空后合成示例标记消失');
  await page.click('#load-sample');
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 16);

  // 手机
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  await noOverflow('手机');
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
  await page.close();

  // 展示图
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  watch(show, 'showcase');
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(300);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();

  console.log(`断言 ${assertions} 条`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
