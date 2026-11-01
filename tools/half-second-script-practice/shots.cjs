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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'halfsec-'));
  const browser = await chromium.launch({ executablePath: EXE });
  const problems = [];
  let asserts = 0;
  const check = (cond, msg) => { asserts++; console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`); if (!cond) problems.push(msg); };

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  const num = async id => Number(await page.textContent(id));
  const overflow = async label => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    check(sw <= iw, `${label}: scrollWidth ${sw} <= innerWidth ${iw}`);
  };
  const tabTo = async name => { await page.click(`[data-tab="${name}"]`); await page.waitForTimeout(60); };

  // ---- 空状态 ----
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  check(await page.isVisible('#tab-script'), '空状态默认进入「脚本」页');
  check(await page.locator('.script-item').count() === 0, '空状态没有脚本');
  check(await page.isVisible('#import-btn-top'), '空状态下「导入 JSON 备份」入口始终可见');
  check((await page.textContent('#today-note')).includes('基准日 2026-10-20(由地址参数固定)'), '?today 生效时页面持续显示基准日');
  check((await page.textContent('#tab-script')).includes('描述动作的现在时句子'), '编辑器提示改为「描述动作的现在时句子」,允许情境型');
  // 错误贴近控件:空脚本提交 → 原因显示在输入框旁并聚焦
  await page.click('#save-script');
  check(await page.isVisible('#f-text-err') && (await page.getAttribute('#f-text', 'aria-invalid')) === 'true', '空脚本:原因显示在输入框旁并标红');
  check(await page.evaluate(() => document.activeElement.id === 'f-text') && (await page.getAttribute('#f-text', 'aria-describedby')) === 'f-text-err', '空脚本:聚焦出错控件并用 aria-describedby 关联');
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

  // ---- 脚本规则检查(真实输入) ----
  await page.fill('#f-text', '我要保持平静');
  let chk = await page.textContent('#check-result');
  check(chk.includes('动作目标,不是情绪目标') && chk.includes('没有找到动作词'), '规则检查:情绪目标与缺动作词警告');
  await page.fill('#f-text', '当孩子大声说话时,我先看着她的眼睛再回答');
  check((await page.textContent('#check-result')).includes('情境型'), '规则检查:含「当」判情境型');
  await page.fill('#f-text', '我从不刷短视频');
  check((await page.textContent('#check-result')).includes('通用型'), '规则检查:通用型');
  // 草稿期间导出被暂停(导出的是已保存数据)
  check(await page.isDisabled('#export-json') && await page.isDisabled('#export-csv'), '脚本编辑器有未保存内容时普通导出禁用');
  await page.click('#save-script');
  await page.waitForSelector('.script-item');
  check(await page.isEnabled('#export-json'), '保存后导出恢复');
  check(await page.locator('.script-item').count() === 1, '保存脚本后列表出现 1 条');
  await tabTo('practice');
  check(await page.isVisible('#practice-main') && (await page.textContent('#stage-text')) === '我从不刷短视频', '首条脚本保存后练习区显示它');
  await tabTo('script');

  // ---- 边界值保存后 reload 仍在 ----
  await page.click('#new-script');
  await page.fill('#f-text', '做'.repeat(1000));
  await page.fill('#f-reason', '理'.repeat(1000));
  await page.click('#save-script');
  await tabTo('practice');
  check((await page.textContent('#stage-text')) === '做'.repeat(1000), '新增脚本后练习区显示新脚本(不是旧脚本)');
  await tabTo('script');
  await page.fill('#name', '名'.repeat(40));
  await page.press('#name', 'Tab');
  await page.waitForTimeout(100);
  await page.reload();
  check(await page.locator('.script-item').count() === 2, '边界值(1000 字脚本 + 40 字名字)保存后 reload 仍有 2 条脚本');
  check((await page.inputValue('#name')).length === 40, 'reload 后 40 字名字仍在');

  // ---- 载入示例要先确认 ----
  await page.click('#load-sample');
  check(await page.isVisible('#confirm'), '已有数据时「载入示例」先显示页内确认');
  check(/\d+ 条脚本、\d+ 条练习、\d+ 条触发记录/.test(await page.textContent('#confirm-msg')), '载入示例确认写明将替换的数量');
  check(await page.locator('.script-item').count() === 2, '确认前保留原状态');
  await page.click('#confirm-no');
  check(await page.locator('.script-item').count() === 2, '取消后原数据不变');
  await page.click('#load-sample');
  await page.click('#confirm-yes');
  await page.waitForSelector('#stat-streak');
  check(await page.locator('.script-item').count() === 2 && (await page.textContent('#stage-text')) === '我从不刷短视频', '确认后换成合成示例(2 条脚本)');
  check(await page.isVisible('#sample-banner'), '示例带「合成示例」提示条');

  // ---- 练习计时 ----
  check(await num('#stat-today') === 0, '示例中今天尚未练习:今日 0');
  const streak0 = await num('#stat-streak'), total0 = await num('#stat-total');
  check(streak0 === 13, `示例断档后连续天数为 13(实际 ${streak0})`);
  const cells = await page.locator('#heatmap .cell').count();
  check(cells === 11 * 7 + 1 + 1, `热力日历格子数 = 12 周到今天(周二)共 ${11 * 7 + 2}(实际 ${cells})`);
  check(await page.locator('#weekly .week').count() === 8, '每周柱状 8 根');
  // 热力格:button、可 Tab 聚焦、方向键切换、点击显示持久读数、图例标出次数
  check(await page.locator('#heatmap button.cell').count() === cells, '热力格是 button(可聚焦)');
  check(await page.locator('#heatmap button.cell[tabindex="0"]').count() === 1, '热力格为单一 Tab 停靠点(roving tabindex)');
  const cellBox = await page.$eval('#heatmap .cell.today', e => { const r = e.getBoundingClientRect(); return [r.width, r.height]; });
  check(cellBox[0] >= 24 && cellBox[1] >= 24, `热力格视觉尺寸 ≥ 24×24 (${cellBox.join('×')})`);
  await page.focus('#heatmap .cell.today');
  const ro0 = await page.textContent('#heat-readout');
  check(ro0.includes('2026-10-20') && ro0.includes('今天') && /\d+ 次/.test(ro0), `读数区默认显示今天日期与次数:${ro0}`);
  await page.keyboard.press('ArrowLeft');
  const ro1 = await page.textContent('#heat-readout');
  check(ro1.includes('2026-10-13') && ro1 !== ro0, `方向键切到上一周同一天,读数更新:${ro1}`);
  check(await page.evaluate(() => document.activeElement.classList.contains('cell') && document.activeElement.dataset.date === '2026-10-13'), '方向键后焦点停在新格子上');
  await page.click('#heatmap .cell[data-date="2026-10-02"]');
  check((await page.textContent('#heat-readout')).includes('2026-10-02'), '点击格子显示该日日期与次数(手机无悬停也可用)');
  check((await page.textContent('.legend')).includes('≥4 次') && (await page.textContent('.legend')).includes('0 次'), '图例标出 0、1、2、3、≥4 次');
  check((await page.textContent('#stat-note')).includes('只统计所选脚本'), '统计旁写明口径');
  check((await page.textContent('#loud-toggle')).includes('姓名/你版本'), '“大声版”按钮改称“姓名/你版本”');
  await page.click('#start');
  check(await page.isDisabled('#start') && await page.isEnabled('#stop'), '计时中:开始禁用、结束可用');
  await page.waitForTimeout(1000);
  await page.click('#stop');
  check((await page.textContent('#practice-msg')).includes('不计入'), '< 5 秒:提示不计入');
  check(await num('#stat-today') === 0 && await num('#stat-total') === total0, '< 5 秒:今日与累计不变');
  const snap = () => page.evaluate(() => ({
    today: document.querySelector('#heatmap .cell.today').className,
    bars: [...document.querySelectorAll('#weekly .bar')].map(b => b.style.height),
    last: document.querySelector('#weekly .week:last-child .n').textContent
  }));
  const snapBefore = await snap();
  await page.click('#start');
  await page.waitForTimeout(5100);
  await page.click('#stop');
  check((await page.textContent('#practice-msg')).includes('已计入'), '≥ 5 秒:提示已计入');
  check(await num('#stat-today') === 1, '≥ 5 秒:今日次数 +1');
  check(await num('#stat-total') === total0 + 1, '累计次数 +1');
  check(await num('#stat-streak') === streak0 + 1, '今天练了,连续天数 +1');
  check((await page.locator('#heatmap .cell.today').getAttribute('title')).includes('1 次'), '热力日历今天格子计 1 次');
  const snapAfter = await snap();
  check(snapBefore.today.includes('lv0') && snapAfter.today.includes('lv1'), `热力格色阶 class 变化:${snapBefore.today} → ${snapAfter.today}`);
  check(Number(snapAfter.last) === Number(snapBefore.last) + 1, `本周柱子计数 ${snapBefore.last} → ${snapAfter.last}`);
  check(JSON.stringify(snapBefore.bars) !== JSON.stringify(snapAfter.bars), `柱高变化:${snapBefore.bars.join('/')} → ${snapAfter.bars.join('/')}`);
  await page.reload();
  check(await num('#stat-today') === 1, 'reload 后今日次数仍为 1(已写入 localStorage)');
  await page.click('#loud-toggle');
  check((await page.textContent('#stage-text')).startsWith('小林'), '大声版:我 → 名字(小林从不刷短视频)');
  await page.click('#loud-toggle');
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png') });
  await overflow('桌面·练习');

  // ---- 多脚本独立计数、触发记录 ----
  await page.click('.script-item >> nth=1');
  check(await num('#stat-today') === 0, '脚本 2 独立计数:今日仍为 0');
  await tabTo('trigger');
  const before = await page.locator('.trigger').count();
  check(before === 12, `示例脚本 2 有 12 条触发记录(实际 ${before})`);
  await page.fill('#t-situation', '饭桌上她抢着说话');
  await page.fill('#t-reaction', '我想吼回去');
  await page.selectOption('#t-executed', 'yes');
  await page.fill('#t-situation', '');
  await page.click('#add-trigger');
  check(await page.isVisible('#t-situation-err') && (await page.getAttribute('#t-situation', 'aria-invalid')) === 'true' && await page.evaluate(() => document.activeElement.id === 't-situation'), '触发记录缺情境:原因贴近输入框并聚焦该框');
  await page.fill('#t-situation', '饭桌上她抢着说话');
  await page.click('#add-trigger');
  await page.waitForTimeout(100);
  check(await page.locator('.trigger').count() === 13, '添加触发记录后为 13 条');
  check((await page.textContent('#rate-box')).includes('近 7 天'), '显示近 7 天 / 近 30 天执行率');
  // 删除触发记录先确认,确认前数量不变
  await page.click('#trigger-list [data-del] >> nth=0');
  check(await page.isVisible('#confirm') && (await page.textContent('#confirm-msg')).includes('确认前执行率不变') && await page.locator('.trigger').count() === 13, '删除触发记录先页内确认,确认前条数不变');
  await page.click('#confirm-no');
  check(await page.locator('.trigger').count() === 13, '取消后记录保留');
  await overflow('桌面·触发记录');

  // ---- 导出 / 导入 ----
  await tabTo('export');
  const [dCsv] = await Promise.all([page.waitForEvent('download'), page.click('#export-csv')]);
  const csv = fs.readFileSync(await dCsv.path(), 'utf8');
  check(csv.includes('脚本,日期,时间,秒数') && csv.includes('2026-10-20'), 'CSV 含表头与今天的练习记录');
  const [dMd] = await Promise.all([page.waitForEvent('download'), page.click('#export-md')]);
  const md = fs.readFileSync(await dMd.path(), 'utf8');
  check(md.includes('不是治疗') && md.includes('我从不刷短视频'), 'Markdown 脚本卡含免责声明与脚本');
  const [dJson] = await Promise.all([page.waitForEvent('download'), page.click('#export-json')]);
  const jsonPath = path.join(tmp, 'backup.json');
  fs.copyFileSync(await dJson.path(), jsonPath);
  const backup = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  backup.practices[0].seconds = -3;
  const badPath = path.join(tmp, 'bad.json');
  fs.writeFileSync(badPath, JSON.stringify(backup));
  await page.setInputFiles('#import-file', badPath);
  await page.waitForTimeout(200);
  check((await page.textContent('#import-msg')).includes('拒绝') && (await page.textContent('#import-msg')).includes('seconds'), '坏备份(秒数为负):整份拒绝并给原因');
  check(!(await page.isVisible('#confirm')), '被拒绝的导入不会弹出替换确认');
  await page.setInputFiles('#import-file', jsonPath);
  await page.waitForSelector('#confirm:not([hidden])');
  await page.click('#confirm-yes');
  await page.waitForTimeout(100);
  check((await page.textContent('#import-msg')).includes('已导入'), '合法备份:确认后导入成功');
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png') });
  await overflow('桌面·导出');
  await tabTo('script');
  await overflow('桌面·脚本');

  // ---- 手机 ----
  await page.setViewportSize({ width: 390, height: 844 });
  await tabTo('practice');
  await overflow('手机·练习');
  const btnW = await page.$eval('#start', b => b.getBoundingClientRect().width);
  const winW = await page.evaluate(() => window.innerWidth);
  check(btnW > winW * 0.8, `手机端练习按钮占满宽(${Math.round(btnW)} / ${winW})`);
  for (const t of ['script', 'trigger', 'export']) { await tabTo(t); await overflow('手机·' + t); }
  await tabTo('practice');
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
  await page.close();

  // ---- 存储失败不能静默 ----
  const bad = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  bad.on('pageerror', e => problems.push('storage-page pageerror: ' + e.message));
  await bad.addInitScript(() => { Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); }; });
  await bad.goto(URL);
  await bad.fill('#f-text', '我从不抽烟');
  await bad.click('#save-script');
  await bad.waitForTimeout(150);
  check(await bad.isVisible('#save-warning') && (await bad.textContent('#save-warning')).includes('未保存'), '存储写入抛 QuotaExceededError:显示持续的「未保存」提示');
  check(!(await bad.textContent('#toast')).includes('已保存') || await bad.isHidden('#toast'), '写入失败时不显示「已保存」成功提示');
  const [bk] = await Promise.all([bad.waitForEvent('download'), bad.click('#warn-export')]);
  check(bk.suggestedFilename() === '半秒-备份.json', '存储失败条里的「导出当前内存中的全部数据 JSON 备份」可下载');
  await bad.close();

  // ---- 展示图 ----
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  show.on('pageerror', e => problems.push('showcase pageerror: ' + e.message));
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(300);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(`断言 ${asserts} 条`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
