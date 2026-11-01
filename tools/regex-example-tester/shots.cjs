'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');
const Core = require('./core.js');
const EXE = process.env.CHROME_PATH || undefined;
const URL = 'file://' + encodeURI(path.join(__dirname, 'index.html'));
const OUT = path.join(__dirname, 'screenshots');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'regex-shots-'));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });
  const problems = [];
  let asserts = 0;
  const check = (cond, msg) => { asserts++; if (!cond) problems.push('断言失败:' + msg); else console.log('OK   ' + msg); };
  const watch = (page, tag) => {
    page.on('console', m => { if (m.type() === 'error') problems.push(tag + ' console: ' + m.text()); });
    page.on('pageerror', e => problems.push(tag + ' pageerror: ' + e.message));
  };

  /* ---- A. 存储写入失败:必须持续可见的「未保存」,且不弹成功提示 ---- */
  {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    watch(p, 'quota');
    await p.addInitScript(() => {
      Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
    });
    await p.goto(URL);
    await p.fill('#pattern', 'abc');
    check(await p.isVisible('#save-warning'), '存储失败:出现持续可见的未保存提示');
    check((await p.textContent('#save-warning')).includes('未保存'), '存储失败:提示文字含「未保存」');
    check((await p.textContent('#save-state')).trim() === '未保存', '存储失败:状态标记为未保存');
    await p.click('#load-sample');
    check(await p.isHidden('#toast'), '存储失败:载入示例后不显示「已载入」成功提示');
    check(await p.isVisible('#save-warning'), '存储失败:载入示例后警告仍在');
    await p.close();
  }

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  watch(page, 'main');
  const noOverflow = async label => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(`${label}: scrollWidth ${sw} <= innerWidth ${iw} → ${sw <= iw ? 'OK' : 'FAIL'}`);
    check(sw <= iw, `${label}无横向溢出(${sw} <= ${iw})`);
  };
  const waitRate = async txt => {
    await page.waitForFunction(() => /^完成/.test(document.getElementById('run-status').textContent), null, { timeout: 20000 });
    const got = await page.textContent('#rate-num');
    check(got === txt, `运行完成,通过率显示 ${txt}(实际 ${got})`);
  };
  const prep = () => page.evaluate(() => { document.getElementById('toast').hidden = true; window.scrollTo(0, 0); });
  const val = id => page.inputValue('#' + id);

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  check(await page.isHidden('#save-warning'), '正常存储:没有未保存警告');
  await prep();
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

  /* ---- B. 载入示例并运行 ---- */
  await page.click('#load-sample');
  check((await val('pattern')) === '^1[3-9]\\d{9}$', '空状态载入示例:直接载入,无确认');
  check((await page.textContent('#save-state')).trim() === '已保存到本机', '真正写入后显示已保存');
  await page.click('#run');
  await waitRate('80.0%');
  check((await page.$$('#results-table tbody tr')).length === 10, '手机号示例共 10 行结果');
  check((await page.$$('#results-table tbody tr.fail')).length === 2, '手机号示例 2 条故意失败');
  const failText = await page.textContent('#results-table tbody');
  check(failText.includes('应匹配但未匹配') && failText.includes('不应匹配却匹配'), '失败原因显示「应匹配但未匹配」与「不应匹配却匹配」');
  await page.fill('#pattern', 'ab(cd');
  const cs = await page.textContent('#compile-status');
  check(cs.includes('第 3 个字符') && cs.includes('右括号'), '编译错误给出位置与原因:' + cs.replace(/\s+/g, ' ').trim());
  check(await page.isVisible('#stale-note'), '改动正则后结果标记为过期');
  check(await page.isDisabled('#export-md'), '过期后禁用报告导出');
  await page.fill('#pattern', '^1[3-9]\\d{9}$');
  check(await page.isHidden('#stale-note'), '改回原样后不再过期');
  await prep();
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png') });
  await noOverflow('桌面');

  /* ---- C. 解释 ---- */
  await page.click('[data-tab="explain"]');
  const explain = await page.textContent('#explain-body');
  check(explain.includes('{9}') && explain.includes('正好重复 9 次') && explain.includes('3 到 9'), '解释页列出量词与字符类说明');

  /* ---- D. 样例库搜索 / 载入 / 邮箱捕获 ---- */
  await page.click('[data-tab="library"]');
  await page.fill('#lib-search', '邮箱');
  check((await page.$$('#lib-list .lib-item')).length === 1, '样例库搜索「邮箱」只剩 1 条');
  await page.click('#lib-list button[data-act="load"]');
  check((await val('pattern')).startsWith('^([\\w.+-]+)@'), '载入样例库条目(草稿未改,无确认)');
  await page.click('#run');
  await waitRate('80.0%');
  check((await page.textContent('#results-table tbody')).includes('捕获不符'), '邮箱示例出现「捕获不符」');

  check(await page.evaluate(() => ![...document.querySelectorAll('#results-table td *, #results-table td')].some(e => /monospace/.test(getComputedStyle(e).fontFamily) && /^(捕获|命名|期望捕获):/.test(e.textContent.trim()))), '结果表里「捕获:」这类标签不用等宽字体,只有捕获到的值用');
  check(await page.evaluate(() => [...document.querySelectorAll('#results-table .cell-code')].length > 0), '输入与捕获值仍用等宽字体(机器文本)');
  check((await page.textContent('.flags-note')).includes('单行') && (await page.textContent('.editor .hint:not(.flags-note)')).includes('单行'), '标志旁和样例表旁都说明样例只能是单行、验证不了跨行');

  /* ---- E. 疑似回溯:Worker 2 秒中止 ---- */
  await page.fill('#lib-search', '回溯');
  await page.click('#lib-list button[data-act="load"]');
  await page.click('#run');
  await page.waitForFunction(() => /^完成/.test(document.getElementById('run-status').textContent), null, { timeout: 20000 });
  const bt = await page.textContent('#results-table tbody');
  check(bt.includes('疑似灾难性回溯') && bt.includes('已中止'), '回溯示例被 Worker 中止并标注');
  check((await page.$$('#results-table tbody tr.pass')).length === 3, '回溯示例其余 3 条正常通过');
  check(await page.isEnabled('#run'), '中止后界面仍可操作');

  /* ---- E2. 停止验收:终止当前 Worker,未跑完的样例标为未运行 ---- */
  await page.fill('#pattern', '(a+)+$');
  await page.fill('#cases', Array.from({ length: 6 }, () => 'a'.repeat(34) + '! | 匹配').join('\n'));
  check(await page.isHidden('#stop'), '没有在运行时,停止按钮不显示');
  const tStart = Date.now();
  await page.click('#run');
  check(await page.isVisible('#stop'), '运行中显示「停止验收」');
  await page.waitForTimeout(500);
  await page.click('#stop');
  await page.waitForFunction(() => /^已停止/.test(document.getElementById('run-status').textContent), null, { timeout: 5000 });
  check(Date.now() - tStart < 6000, '点停止后立即结束,不再等 6 条各 2 秒(用时 ' + (Date.now() - tStart) + ' ms)');
  const skipped = await page.$$eval('#results-table tbody tr.skip', rows => rows.length);
  check(skipped >= 4 && (await page.textContent('#rate-detail')).includes('未运行 ' + skipped), '未跑完的 ' + skipped + ' 条标为「未运行」,统计里单列');
  check((await page.textContent('#results-table tbody')).includes('未运行(已手动停止验收)'), '结果表里写明未运行原因');
  check(await page.isHidden('#stop') && await page.isEnabled('#run'), '停止后按钮复位,可再次运行');
  await page.click('[data-tab="export"]');
  check((await page.textContent('#md-preview')).includes('未运行:'), '停止后的报告预览写明未运行条数');
  await page.click('[data-tab="results"]');

  /* ---- F. 载入示例的替换确认 ---- */
  await page.fill('#pattern', 'my-own-pattern');
  await page.click('#load-sample');
  check(await page.isVisible('#confirm'), '已有数据时点载入示例:出现页内确认');
  check((await val('pattern')) === 'my-own-pattern', '确认前保留原草稿');
  await page.click('#confirm-no');
  check((await val('pattern')) === 'my-own-pattern' && await page.isHidden('#confirm'), '取消后仍保留原草稿');
  await page.click('#load-sample');
  await page.click('#confirm-yes');
  check((await val('pattern')) === '^1[3-9]\\d{9}$', '确认后才替换为示例');
  const libCount = (await page.textContent('#lib-hint'));
  check(libCount.includes('5'), '样例库含 5 套示例:' + libCount);

  /* ---- F2. 只改了标志或输入长度上限,也算已有数据 ---- */
  await page.click('#clear-data');
  await page.click('#confirm-yes');
  check(!(await page.evaluate(() => document.getElementById('flag-i').checked)) && (await val('max-input')) === '10000', '清空后标志与长度上限回到默认');
  await page.click('#flag-i');
  await page.click('#load-sample');
  check(await page.isVisible('#confirm') && (await page.textContent('#confirm-text')).includes('标志「i」'), '只改了标志:载入示例先确认,并写明标志');
  await page.click('#confirm-no');
  check(await page.evaluate(() => document.getElementById('flag-i').checked) && (await val('pattern')) === '', '取消后标志保持,未被示例覆盖');
  await page.click('#flag-i');
  await page.fill('#max-input', '500');
  await page.click('#load-sample');
  check(await page.isVisible('#confirm') && (await page.textContent('#confirm-text')).includes('输入长度上限 500'), '只改了输入长度上限:载入示例先确认,并写明上限');
  await page.click('#confirm-no');
  check((await val('max-input')) === '500', '取消后长度上限保持 500');
  await page.fill('#max-input', '10000');
  await page.click('#load-sample');
  check(await page.isHidden('#confirm') && (await val('pattern')) === '^1[3-9]\\d{9}$', '恢复默认后载入示例不再确认');

  /* ---- G. 导出 / 再导入 ---- */
  await page.click('#run');
  await waitRate('80.0%');
  await page.click('[data-tab="export"]');
  check(await page.isEnabled('#export-md') && await page.isEnabled('#export-csv'), '运行后可导出');
  const casesBefore = await val('cases');
  const [dCsv] = await Promise.all([page.waitForEvent('download'), page.click('#export-csv')]);
  const csvPath = path.join(TMP, 'cases.csv');
  await dCsv.saveAs(csvPath);
  const csvText = fs.readFileSync(csvPath, 'utf8');
  check(csvText.charCodeAt(0) === 0xFEFF && csvText.includes('输入,期望,期望捕获,结果,实际,失败原因'), 'CSV 下载含表头与结果列:' + dCsv.suggestedFilename());
  const [dMd] = await Promise.all([page.waitForEvent('download'), page.click('#export-md')]);
  const mdPath = path.join(TMP, 'report.md');
  await dMd.saveAs(mdPath);
  const md = fs.readFileSync(mdPath, 'utf8');
  check(md.includes('通过率:8/10(80.0%)') && md.includes('## 失败清单'), 'Markdown 报告含通过率与失败清单');
  const [dJson] = await Promise.all([page.waitForEvent('download'), page.click('#export-json')]);
  const jsonPath = path.join(TMP, 'backup.json');
  await dJson.saveAs(jsonPath);
  const jsonText = fs.readFileSync(jsonPath, 'utf8');
  check(Core.validateImport(jsonText).ok, 'JSON 备份能通过 validateImport');
  await prep();
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png') });

  await page.fill('#cases', '');
  await page.setInputFiles('#import-csv', csvPath);
  await page.waitForFunction(() => document.getElementById('cases').value !== '');
  check((await val('cases')) === casesBefore, 'CSV 导出后再导入,样例表与原来逐字一致');
  const badCsv = path.join(TMP, 'bad.csv');
  fs.writeFileSync(badCsv, '输入,期望,期望捕获\r\n"没闭合,匹配,\r\n');
  await page.setInputFiles('#import-csv', badCsv);
  await page.waitForFunction(() => /拒绝/.test(document.getElementById('data-msg').textContent));
  check(await page.isVisible('#data-msg') && (await val('cases')) === casesBefore, '引号未闭合的 CSV 整份拒绝,样例表不变');
  const badJson = path.join(TMP, 'bad.json');
  const obj = JSON.parse(jsonText); obj.library[0].cases[0].expect = 'maybe';
  fs.writeFileSync(badJson, JSON.stringify(obj));
  await page.setInputFiles('#import-json', badJson);
  await page.waitForFunction(() => /整份拒绝/.test(document.getElementById('data-msg').textContent));
  check((await val('pattern')) === '^1[3-9]\\d{9}$', '非法 JSON 备份整份拒绝,当前数据不变');
  await page.setInputFiles('#import-json', jsonPath);
  await page.click('#confirm-yes');
  await page.waitForFunction(() => /已导入备份/.test(document.getElementById('data-msg').textContent));
  check(true, '合法 JSON 备份经确认后导入');

  /* ---- H. 边界值保存后 reload 仍在(半成品 + 超长 + 超大数字) ---- */
  const longPattern = '(' + 'x'.repeat(5000);
  const longCases = 'q'.repeat(3000);
  await page.click('[data-tab="results"]');
  await page.fill('#pattern', longPattern);
  await page.fill('#cases', longCases);
  await page.fill('#max-input', '9999999');
  await page.reload();
  check((await val('pattern')) === longPattern, 'reload 后 5001 字符的半成品正则仍在');
  check((await val('cases')) === longCases, 'reload 后非法样例行(3000 字符)仍在');
  check((await val('max-input')) === '9999999', 'reload 后超大上限 9999999 仍在');
  check(await page.isHidden('#load-notice'), 'reload 后没有「数据被拒绝」提示');
  await page.fill('#max-input', '0');
  check((await page.textContent('#max-error')).includes('1 到'), '非法上限给出提示,不静默修正');
  await page.fill('#max-input', '10000');

  /* ---- I. 手机 ---- */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('#load-sample');
  await page.click('#confirm-yes');
  await page.click('#run');
  await waitRate('80.0%');
  const touch = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('fieldset.flags input[type=checkbox]')].map(i => i.getBoundingClientRect());
    const labels = [...document.querySelectorAll('fieldset.flags label.check')].map(l => l.getBoundingClientRect().height);
    return { n: boxes.length, minBox: Math.min(...boxes.map(r => Math.min(r.width, r.height))), minLabel: Math.min(...labels) };
  });
  check(touch.n === 5 && touch.minBox >= 24 && touch.minLabel >= 32, '手机:标志勾选框 ≥24px,label 点击区 ≥32px(' + touch.minBox + '/' + touch.minLabel + ')');
  await noOverflow('手机');
  await prep();
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
  await page.close();

  /* ---- showcase ---- */
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  watch(show, 'showcase');
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(400);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });

  console.log(`断言共 ${asserts} 条`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
