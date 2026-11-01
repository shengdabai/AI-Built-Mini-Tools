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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobmatch-'));
  const browser = await chromium.launch({ executablePath: EXE });
  const problems = [];
  let asserts = 0;
  const check = (cond, msg) => { asserts++; if (!cond) problems.push(msg); else console.log('OK  ' + msg); };

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  const noOverflow = async label => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(`${label}: scrollWidth ${sw} <= innerWidth ${iw} -> ${sw <= iw ? 'OK' : 'FAIL'}`);
    asserts++;
    if (sw > iw) problems.push(`${label} 横向溢出 ${sw} > ${iw}`);
  };
  const statNum = async n => (await page.$$eval('#stats .num', els => els.map(e => e.textContent)))[n];

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  check(await page.isVisible('#empty'), '空状态显示引导');
  check(await page.isVisible('#import-btn') && await page.isVisible('#empty-import'), '空状态下「导入 JSON 备份」与「从 JSON 备份恢复」入口都可见');
  check((await page.textContent('#today-note')).includes('基准日 2026-10-20(由地址参数固定)'), '?today 生效时持续显示基准日说明');
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

  // 载入示例 → 对照
  await page.click('#empty-sample');
  await page.waitForSelector('.chip');
  check((await page.$$('.chip')).length >= 15, '示例岗位提取出关键词 chip');
  const cov0 = await statNum(0);
  check(cov0 === '50%', `教师岗位初始总覆盖率 50%(实际 ${cov0})`);
  check((await page.$$eval('#chips .chip.hit', e => e.length)) > 0 && (await page.$$eval('#chips .chip.miss', e => e.length)) > 0, 'chip 同时有命中与缺失');

  // 改简历 → 覆盖率变化
  const resume = await page.inputValue('#resume');
  await page.fill('#resume', resume + '\n使用 Canva 制作课件制作模板,沟通顺畅');
  const cov1 = await statNum(0);
  check(parseFloat(cov1) > parseFloat(cov0), `补充简历后覆盖率上升 ${cov0} -> ${cov1}`);

  // 同义词:去掉后 HSK 变缺失
  const syn = await page.inputValue('#synonyms');
  await page.fill('#synonyms', '');
  check(await page.$eval('#chips', root => Array.from(root.querySelectorAll('.chip.miss')).some(c => c.textContent.includes('HSK'))), '清掉同义词后 HSK 变为缺失');
  await page.fill('#synonyms', syn);
  check(await page.$eval('#chips', root => Array.from(root.querySelectorAll('.chip.hit')).some(c => c.textContent.includes('HSK'))), '恢复同义词后 HSK 命中');

  // 手动添加与重复拒绝
  await page.fill('#kw-input', 'Figma');
  await page.click('#kw-form button[type=submit]');
  check(await page.$eval('#chips', r => r.textContent.includes('Figma')), '手动添加关键词');
  await page.fill('#kw-input', 'figma');
  await page.click('#kw-form button[type=submit]');
  check((await page.textContent('#kw-msg')).includes('已经在列表里'), '重复关键词被拒绝并提示');

  // 岗位描述改动 → 关键词过期 → 导出禁用
  await page.fill('#jd', (await page.inputValue('#jd')) + '\n7. 熟悉 Notion');
  check(await page.isVisible('#stale-note'), '改岗位描述后出现关键词过期提示');
  await page.click('[data-tab=export]');
  check(await page.isDisabled('#export-md'), '关键词过期时 Markdown 导出被禁用');
  check((await page.textContent('#export-block')).includes('重新提取'), '禁用原因可见');
  await page.click('#re-extract');
  check(await page.isVisible('#extract-choice') && (await page.textContent('#extract-choice-text')).includes('手动添加 1 个'), '有手动调整时重新提取前出现页内选择并写明调整数量');
  check(await page.$eval('#chips', r => r.textContent.includes('Figma')), '选择前手动添加的 Figma 仍在');
  await page.click('#choice-cancel');
  check(await page.isHidden('#extract-choice') && await page.isVisible('#stale-note'), '取消后关键词列表不变、过期提示仍在');
  await page.click('#re-extract');
  await page.click('#choice-keep');
  check(!(await page.isVisible('#stale-note')) && !(await page.isDisabled('#export-md')), '保留调整重新提取后提示消失、导出可用');
  check(await page.$eval('#chips', r => r.textContent.includes('Notion') && r.textContent.includes('Figma')), '保留调整:补入新增的 Notion,手动添加的 Figma 仍在');
  // 选「替换」时丢弃调整
  await page.fill('#kw-input', 'Zzz词');
  await page.click('#kw-form button[type=submit]');
  await page.fill('#jd', (await page.inputValue('#jd')) + '\n8. 熟悉 Obsidian');
  await page.click('#re-extract');
  await page.click('#choice-replace');
  check(await page.$eval('#chips', r => r.textContent.includes('Obsidian') && !r.textContent.includes('Zzz词') && !r.textContent.includes('Figma')), '替换:新词进入列表,手动添加的词被丢弃');
  await page.click('[data-tab=result]');

  // 键盘焦点:改关键词后重绘,焦点仍在同一关键词的同一控件;删除后转到相邻关键词
  const firstKw = await page.getAttribute('#chips .chip:nth-child(1) input', 'data-kw');
  await page.focus('#chips .chip:nth-child(1) input');
  await page.keyboard.press('Space');
  const f1 = await page.evaluate(() => ({ kw: document.activeElement.dataset.kw, kind: document.activeElement.dataset.kind }));
  check(f1.kw === firstKw && f1.kind === 'toggle', '勾选关键词后焦点仍在同一个勾选框');
  await page.keyboard.press('Space');
  const secondKw = await page.getAttribute('#chips .chip:nth-child(2) input', 'data-kw');
  await page.click('#chips .chip:nth-child(1) button[data-kind=delete]');
  const f2 = await page.evaluate(() => ({ kw: document.activeElement.dataset.kw, kind: document.activeElement.dataset.kind }));
  check(f2.kw === secondKw && f2.kind === 'delete', '删除关键词后焦点转到相邻关键词的删除按钮');

  // 事实核验
  await page.click('[data-tab=facts]');
  const factCount = (await page.$$('#fact-list li')).length;
  check(factCount >= 1, `抽出 ${factCount} 条事实句`);
  check((await page.textContent('#fact-list')).includes('300%'), '抽到「提升 300%」');
  await page.click('#fact-list li >> nth=0 >> text=需修改');
  check(await page.$eval('#fact-list li', li => li.classList.contains('fix')), '标记「需修改」后样式变化');
  check((await page.textContent('#fact-summary')).includes('需修改 1'), '核验汇总更新');

  // 版本
  await page.click('[data-tab=versions]');
  check((await page.$$('#ver-list .ver-item')).length === 2, '示例带两个版本');
  await page.fill('#ver-title', '投递版');
  await page.click('#ver-form button[type=submit]');
  check((await page.$$('#ver-list .ver-item')).length === 3, '保存新版本后共 3 个');
  check((await page.$$('#trend .trend-row')).length === 3, '趋势条 3 行');
  check((await page.textContent('#diff-b')).includes('当前草稿(尚未存为版本)') && !(await page.textContent('#diff-b')).includes('未保存'), '对比选项叫「当前草稿(尚未存为版本)」,不再说未保存');
  const sum0 = await page.textContent('#diff-summary');
  check(/新增 [1-9]\d* 行/.test(sum0), `默认对比最近两个版本(应有新增行):${sum0}`);
  await page.selectOption('#diff-a', { index: 0 });
  await page.selectOption('#diff-b', { index: 1 });
  const sum = await page.textContent('#diff-summary');
  check(/新增 \d+ 行,删除 \d+ 行/.test(sum), `初稿对比补充版的摘要:${sum}`);
  check((await page.$$('#diff-out .diff-line.add')).length > 0 && (await page.$$('#diff-out .diff-line.del')).length > 0, 'diff 同时有新增与删除行');
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png'), fullPage: true });
  await noOverflow('桌面');

  // 导出与导入
  await page.click('[data-tab=export]');
  const preview = await page.textContent('#md-preview');
  check(preview.includes('总覆盖率') && preview.includes('事实核验清单') && preview.includes('需修改'), 'Markdown 预览含覆盖率与核验表');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-md')]);
  const mdPath = path.join(tmp, dl.suggestedFilename());
  await dl.saveAs(mdPath);
  const mdText = fs.readFileSync(mdPath, 'utf8');
  check(dl.suggestedFilename().endsWith('.md') && mdText === preview, `下载的 Markdown 与预览一致(${dl.suggestedFilename()})`);
  const [dj] = await Promise.all([page.waitForEvent('download'), page.click('#export-json')]);
  const jsonPath = path.join(tmp, 'backup.json');
  await dj.saveAs(jsonPath);
  const backup = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  check(backup.app === 'jobmatch' && backup.jobs.length === 2, 'JSON 备份含 2 个岗位');

  const badPath = path.join(tmp, 'bad.json');
  const bad = JSON.parse(JSON.stringify(backup));
  bad.jobs[1].id = bad.jobs[0].id;
  fs.writeFileSync(badPath, JSON.stringify(bad));
  await page.setInputFiles('#import-file', badPath);
  await page.waitForFunction(() => document.getElementById('import-msg').textContent.includes('拒绝'));
  check((await page.textContent('#import-msg')).includes('id 重复'), '重复 ID 的备份整份被拒绝并说明原因');
  check(await page.isHidden('#confirm-bar'), '被拒绝的导入没有进入确认步骤');

  await page.click('#clear-all');
  check(await page.isVisible('#confirm-bar'), '清空前出现页内确认区');
  await page.click('#confirm-yes');
  check(await page.isVisible('#empty'), '清空后回到空状态');
  check(await page.isVisible('#empty-import'), '清空后空状态里有「从 JSON 备份恢复」');
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#empty-import')]);
  await fc.setFiles(jsonPath);
  await page.waitForSelector('#confirm-bar:not([hidden])');
  await page.click('#confirm-yes');
  await page.waitForSelector('#job-area:not([hidden])');
  check((await page.$$eval('#job-select option', o => o.length)) === 2, '导入合法备份后恢复 2 个岗位');
  check((await page.textContent('#job-select')).includes('合成示例'), '导入后的岗位标题保留');
  await page.click('[data-tab=export]');
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png') });

  // 刷新后数据仍在
  await page.reload();
  check((await page.$$eval('#job-select option', o => o.length)) === 2, '刷新后数据保留');

  // 再次载入示例:已存在同 ID 岗位时先确认,确认前保持原状
  const edited = await page.inputValue('#resume');
  check(edited.includes('使用 Canva 制作课件制作模板'), '刷新后仍是用户改过的简历');
  await page.click('#load-sample');
  check(await page.isVisible('#confirm-bar') && (await page.textContent('#confirm-text')).includes('覆盖'), '载入示例遇到同 ID 岗位时出现覆盖确认');
  check((await page.inputValue('#resume')) === edited, '确认前简历保持原状');
  await page.click('#confirm-no');
  await page.reload();
  check((await page.inputValue('#resume')) === edited, '取消后刷新,存档里的简历仍是改过的版本');
  await page.click('#load-sample');
  await page.click('#confirm-yes');
  check(!(await page.inputValue('#resume')).includes('使用 Canva 制作课件制作模板'), '确认后示例才被恢复');
  check((await page.$$eval('#job-select option', o => o.length)) === 2, '确认覆盖后仍是 2 个岗位');

  // 切到前端岗位验证 CI/CD、全半角
  await page.selectOption('#job-select', 'sample-frontend');
  await page.click('[data-tab=result]');
  const fe = await page.textContent('#hit-table');
  check(fe.includes('SQL') && fe.includes('TypeScript'), '全角 ＳＱＬ/ＴｙｐｅＳｃｒｉｐｔ 被命中');
  check(fe.includes('JavaScript'), '同义词 JS = JavaScript 命中');

  // 手机
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('[data-tab=result]');
  const sz = await page.evaluate(() => {
    const r = e => { const b = e.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; };
    return { cb: r(document.querySelector('.chip input')), lab: r(document.querySelector('.chip label')) };
  });
  check(sz.cb[0] >= 24 && sz.cb[1] >= 24 && sz.lab[1] >= 32, `手机端触控尺寸 chip 勾选框 ${sz.cb} label ${sz.lab}`);
  for (const t of ['result', 'facts', 'versions', 'export']) {
    await page.click(`[data-tab=${t}]`);
    await noOverflow('手机 ' + t);
  }
  await page.click('[data-tab=result]');
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
  await page.close();

  // 存储失败:setItem 抛 QuotaExceededError
  const bp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await bp.addInitScript(() => {
    Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
  });
  bp.on('pageerror', e => problems.push('pageerror(存储失败页): ' + e.message));
  await bp.goto(URL);
  await bp.click('#empty-sample');
  await bp.waitForSelector('.chip');
  check(await bp.isVisible('#save-warning'), '写入失败时显示持续可见的「未保存」提示');
  check(!(await bp.isVisible('#toast')), '写入失败时不显示成功提示');
  check((await bp.textContent('#save-warning')).includes('JSON 备份'), '未保存提示引导导出备份');
  await bp.close();

  // 简历框为空时存版本:错误贴近控件并聚焦出错输入
  const ep = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  ep.on('pageerror', e => problems.push('pageerror(空简历): ' + e.message));
  await ep.goto(URL);
  await ep.click('#empty-new');
  await ep.click('[data-tab=versions]');
  await ep.click('#ver-form button[type=submit]');
  check(await ep.isVisible('#ver-msg') && (await ep.getAttribute('#resume', 'aria-invalid')) === 'true' && (await ep.evaluate(() => document.activeElement.id)) === 'resume', '简历为空存版本时在表单旁显示原因并聚焦简历框');
  await ep.close();

  // ?today 非法值不抛错
  const tp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  tp.on('pageerror', e => problems.push('pageerror(today): ' + e.message));
  await tp.goto('file://' + encodeURI(path.join(__dirname, 'index.html')) + '?today=2026-13-45');
  check(await tp.isVisible('#job-select'), '非法 ?today 回退真实日期,页面正常');
  await tp.close();

  // 展示图
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  show.on('pageerror', e => problems.push('showcase pageerror: ' + e.message));
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(300);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(`断言数:${asserts}`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
