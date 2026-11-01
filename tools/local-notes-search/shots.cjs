'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const BASE = 'file://' + encodeURI(path.join(__dirname, 'index.html'));
const URL = BASE + '?today=2026-10-20';
const OUT = path.join(__dirname, 'screenshots');
const FIX = path.join(__dirname, '.omc', 'shots-fixtures', '笔记库');

let asserts = 0;
const problems = [];
function check(cond, msg) { asserts++; if (!cond) problems.push('断言失败:' + msg); else console.log('  ok  ' + msg); }

function makeFixtures() {
  fs.rmSync(path.dirname(FIX), { recursive: true, force: true });
  const w = (rel, text) => { const f = path.join(FIX, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  w('日记/a.md', '# 日记A\n\n今天复习了卡片。\n\n第二段没有关键词。');
  w('读书/b.txt', '间隔重复的读书笔记。\n\n复习要在快忘记的时候。');
  w('项目/c.markdown', '# 项目C\n\n复习清单\n\n- 一\n- 二');
  w('空.md', '');
  w('big.md', '间隔重复是一种复习方法,'.repeat(16000)); // 单个超长段落,约 19 万字
  w('笔记.org', '复习 org 文件');
  fs.writeFileSync(path.join(FIX, 'cover.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  makeFixtures();
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  const ready = async () => { await page.waitForSelector('body[data-ready="1"]'); };
  const noOverflow = async label => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(`${label}: scrollWidth ${sw} <= innerWidth ${iw} → ${sw <= iw ? 'OK' : 'FAIL'}`);
    check(sw <= iw, `${label}无横向溢出 (${sw} <= ${iw})`);
  };
  const txt = sel => page.textContent(sel).then(s => s.trim());
  const search = async q => { await page.fill('#q', q); await page.click('#do-search'); };

  // ---- 空状态 ----
  await page.goto(URL); await ready();
  check(await page.isDisabled('#q'), '空状态:搜索框禁用');
  check(await page.isDisabled('#export-md') && await page.isDisabled('#export-csv'), '空状态:导出按钮禁用');
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

  // 文件选择入口是可聚焦按钮,键盘 Enter 可打开文件选择
  check((await page.$eval('#btn-pick-folder', e => e.tagName)) === 'BUTTON', '选择文件夹入口是 button');
  await page.focus('#btn-pick-folder');
  check(await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0; }), '键盘聚焦选择按钮时有可见焦点环');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Enter')]);
  check(!!chooser, '按 Enter 打开文件夹选择');

  // ---- 选文件夹:大文件夹分批读取、空文件、超长段落 ----
  await page.setInputFiles('#pick-folder', FIX);
  await page.waitForFunction(() => document.getElementById('s-files').textContent.trim() === '5');
  check((await txt('#selection-note')).includes('选中 7 个文件,其中 5 个是笔记文件'), '选中 7 个文件,过滤出 5 个笔记文件(png 与 org 不读)');
  check((await page.textContent('#progress-text')).includes('索引完成'), '显示读取/索引进度完成');
  const chars = Number((await txt('#s-chars')).replace(/,/g, ''));
  check(chars > 190000, `总字数 ${chars} 含超长段落`);
  await page.waitForFunction(() => document.getElementById('cache-status').textContent.includes('已缓存'));
  check(true, 'IndexedDB 缓存写入成功');

  // ---- reload:写入校验 = 读取校验(超长段落 + 空文件) ----
  await page.reload(); await ready();
  check((await txt('#s-files')) === '5', 'reload 后缓存索引仍在(含空文件与超长段落)');
  check((await txt('#cache-status')).includes('已从 IndexedDB 缓存载入'), 'reload 后显示来自缓存与索引日期');
  check((await txt('#lib-meta')).includes('索引日期 2026-10-20'), '?today 固定索引日期');
  check(await page.locator('.warning').count() === 0, 'reload 后无警告');
  await search('间隔重复 path:big.md');
  check((await page.locator('.hit').count()) === 1, '超长段落可被搜到');
  const snLen = (await page.textContent('.hit .snippet')).length;
  check(snLen < 200, `超长段落只显示窗口片段 (${snLen} 字)`);
  await search('复习 path:日记/');
  check((await page.locator('.hit').count()) === 1, 'path: 前缀相对所选文件夹(日记/)');

  // ---- 重建需确认;额外后缀 ----
  await page.fill('#ext-extra', '.org');
  await page.setInputFiles('#pick-folder', FIX);
  await page.waitForSelector('#confirm:not([hidden])');
  check((await txt('#s-files')) === '5', '确认前保留原索引');
  await page.click('#confirm-yes');
  await page.waitForFunction(() => document.getElementById('s-files').textContent.trim() === '6');
  check(true, '加 .org 后重建为 6 个文件');

  // ---- 载入示例不能无确认覆盖 ----
  await page.click('#load-sample');
  await page.waitForSelector('#confirm:not([hidden])');
  check((await txt('#s-files')) === '6', '点「载入示例」后确认前仍是原索引(6 个文件)');
  await page.click('#confirm-no');
  check(await page.isHidden('#confirm') && (await txt('#s-files')) === '6', '取消后索引不变');
  await page.click('#load-sample');
  await page.click('#confirm-yes');
  await page.waitForFunction(() => document.getElementById('s-files').textContent.trim() === '15');
  check((await txt('#lib-meta')).includes('合成示例'), '确认后载入 15 篇合成示例并标注');

  // ---- 核心流程:AND + 短语 + 排除 + path ----
  await search('复习 "间隔重复" -咖啡 path:读书/');
  const n = await page.locator('.hit').count();
  const paths = await page.$$eval('.hit .path', els => els.map(e => e.textContent));
  const bodies = await page.$$eval('.hit .snippet', els => els.map(e => e.textContent));
  check(n >= 1 && paths.every(p => p.startsWith('读书/')), `path: 筛选生效 (${n} 条,均在 读书/)`);
  check(bodies.every(b => !b.includes('咖啡')), '排除词生效');
  check((await page.locator('.hit mark').count()) >= 2, '片段内高亮命中词');
  check((await txt('#result-meta')).includes('按命中密度排序,标题或文件名命中加权'), '结果数量旁写明排序依据');
  await page.click('#rank-box summary');
  check((await txt('#rank-box')).includes('max(段落字数, 40)') && (await txt('#rank-box')).includes('再加 5 分'), '展开说明写出排序公式与标题加权');
  check((await page.textContent('.hit-head')).includes('第 3 段'), '显示路径与段落号');
  await page.click('.hit button.link');
  check((await page.locator('.hit .ctx-para').count()) === 3, '展开后显示本段与上下段');
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png') });

  // ---- 导出与界面一致 ----
  check(!(await page.isDisabled('#export-md')), '有结果且查询未改动时可导出');
  await page.fill('#q', '复习 "间隔重复" -咖啡 path:读书/ x');
  check(await page.isDisabled('#export-md') && await page.isVisible('#export-hint'), '查询改动后禁用导出并提示');
  await page.fill('#q', '复习 "间隔重复" -咖啡 path:读书/');
  check(!(await page.isDisabled('#export-md')), '改回原查询后恢复导出');

  await search('复习');
  const total = await page.locator('.hit').count();
  check(total >= 5, `「复习」命中 ${total} 条`);
  const [dlMd] = await Promise.all([page.waitForEvent('download'), page.click('#export-md')]);
  const md = fs.readFileSync(await dlMd.path(), 'utf8');
  check(dlMd.suggestedFilename() === '搜索结果-2026-10-20.md', 'Markdown 文件名带日期');
  check(md.startsWith('# 搜索结果') && md.includes('第 ') && /## `[^`]+` · 第 \d+ 段/.test(md), 'Markdown 含路径与段落号');
  const [dlCsv] = await Promise.all([page.waitForEvent('download'), page.click('#export-csv')]);
  const csv = fs.readFileSync(await dlCsv.path(), 'utf8');
  check(csv.startsWith('﻿"路径","段落数","字数","最近修改"') && csv.trim().split('\r\n').length === 16, '统计 CSV 含表头与 15 行文件');

  // ---- 共现词、最近修改 ----
  await page.fill('#co-term', '复习');
  await page.click('#co-go');
  const chips = await page.locator('.chip').count();
  check(chips >= 5 && chips <= 20, `共现词 ${chips} 个(≤20)`);
  check((await txt('.chip')).includes('共同出现于') && /共同出现于 \d+ 个段落/.test(await txt('.chip')), '共现词旁写「共同出现于 N 个段落」');
  const coNote = await txt('#co-note');
  check(coNote.includes('同一段里重复出现只计 1 次') && coNote.includes('相邻两个字'), '共现词说明:计段落数、同段只计一次、中文按相邻两字');
  check((await page.$$eval('.chip', els => els.map(e => e.textContent.trim().split(' ')[0]))).every(t => t !== '复习'), '共现词不含关键词自身');
  const recent = await page.$$eval('.recent-item .path', els => els.map(e => e.textContent));
  check(recent.length === 15 && recent[0] === '项目/想法/杂项.txt', '最近修改按时间倒序,最新的在前');
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png') });
  await page.click('.chip >> nth=0');
  check((await page.inputValue('#q')) !== '复习' && (await page.locator('.hit').count()) >= 1, '点共现词会搜索该词');

  // ---- 停用词:大量设置保存后 reload 仍在 ----
  const many = Array.from({ length: 3000 }, (_, i) => '词' + i).join(' ');
  await page.click('.stop-box summary');
  check((await txt('.stop-box')).includes('停用词是不参与统计的词'), '停用词设置先解释什么是停用词');
  await page.fill('#stopwords', many);
  await page.click('#save-stop');
  await page.waitForSelector('#toast:not([hidden])');
  check((await txt('#toast')).includes('已保存') && await page.locator('.warning').count() === 0, '停用词保存成功才提示已保存');
  await page.reload(); await ready();
  check((await page.inputValue('#stopwords')).includes('词2999'), '3000 条停用词 reload 后仍在');
  check((await txt('#s-files')) === '15', '示例索引 reload 后仍从缓存载入');

  // ---- 手机 ----
  await page.setViewportSize({ width: 390, height: 844 });
  await search('复习 -咖啡');
  await page.click('.hit button.link >> nth=0');
  await page.waitForTimeout(150);
  await noOverflow('手机');
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await noOverflow('桌面');
  await ctx.close();

  // ---- 存储失败:localStorage 写入抛 QuotaExceededError ----
  {
    const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await c2.addInitScript(() => {
      Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
    });
    const p2 = await c2.newPage();
    p2.on('pageerror', e => problems.push('pageerror(存储失败页): ' + e.message));
    await p2.goto(URL); await p2.waitForSelector('body[data-ready="1"]');
    await p2.click('.stop-box summary');
    await p2.fill('#stopwords', '甲 乙 丙');
    await p2.click('#save-stop');
    await p2.waitForSelector('.warning[data-key="settings"]');
    const w = await p2.textContent('.warning[data-key="settings"]');
    check(w.includes('未保存'), '设置写入失败:持续可见「未保存」警告');
    check(await p2.isHidden('#toast'), '设置写入失败:没有显示「已保存」');
    await c2.close();
  }
  // ---- 存储失败:IndexedDB 不可用,降级为仅内存 ----
  {
    const c3 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await c3.addInitScript(() => { indexedDB.open = function () { throw new DOMException('denied', 'SecurityError'); }; });
    const p3 = await c3.newPage();
    p3.on('pageerror', e => problems.push('pageerror(IDB 失败页): ' + e.message));
    await p3.goto(BASE + '?today=2026-02-30'); await p3.waitForSelector('body[data-ready="1"]');
    check(await p3.isVisible('.warning[data-key="cache"]'), 'IndexedDB 不可用:启动即提示仅内存');
    await p3.click('#load-sample');
    await p3.waitForFunction(() => document.getElementById('s-files').textContent.trim() === '15');
    await p3.fill('#q', '咖啡'); await p3.click('#do-search');
    check((await p3.locator('.hit').count()) >= 2, 'IndexedDB 不可用:内存索引仍可搜索');
    check((await p3.textContent('.warning[data-key="cache"]')).includes('内存'), '警告持续可见并说明后果');
    const meta = await p3.textContent('#lib-meta');
    check(!meta.includes('2026-02-30') && /索引日期 \d{4}-\d{2}-\d{2}/.test(meta), '?today=2026-02-30 被拒绝,回退真实今天');
    await c3.close();
  }

  // ---- 展示图 ----
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  show.on('pageerror', e => problems.push('showcase pageerror: ' + e.message));
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(300);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();
  fs.rmSync(path.dirname(FIX), { recursive: true, force: true });

  console.log(`断言共 ${asserts} 条`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
