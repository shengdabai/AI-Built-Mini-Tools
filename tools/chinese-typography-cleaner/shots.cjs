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
  const check = (cond, msg) => { asserts++; if (!cond) problems.push('断言失败:' + msg); else console.log('OK  ' + msg); };

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  let clipboardGranted = true;
  try { await ctx.grantPermissions(['clipboard-read', 'clipboard-write']); } catch (e) { clipboardGranted = false; }
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  const noOverflow = async label => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(`${label}: scrollWidth ${sw} <= innerWidth ${iw} → ${sw <= iw ? 'OK' : 'FAIL'}`);
    check(sw <= iw, `${label}无横向溢出 (${sw} <= ${iw})`);
  };
  const val = sel => page.inputValue(sel);

  // 1. 空状态
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  check(await page.isVisible('#empty-guide'), '空状态显示引导');
  check(await page.isDisabled('#btn-copy') && await page.isDisabled('#btn-export'), '空状态下复制与导出禁用');
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

  // 2. 载入示例(空状态无需确认)
  await page.click('#btn-sample');
  check(!(await page.isVisible('#confirm-sample')), '空状态载入示例不弹确认');
  const input = await val('#input');
  check(input.split('\n').length === 25, '示例共 25 行');
  check(await page.isVisible('#sample-tag'), '示例有「合成示例」标注');
  let out = await val('#output');
  check(out.includes('增长了 35%，很稳定。'), '百分号、逗号、句号处理');
  check(out.includes('在B站发布') && out.includes('B站团队'), '保护词 B站 不加空格');
  check(out.includes('const msg = "hello,world";   // 代码块内部不处理...'), '代码块原样保留');
  check(out.includes('[官方文档](https://example.com/docs?a=1&b=2)'), 'URL 原样保留');
  check(out.includes('“') === false && out.includes('「这个功能很好用」'), '默认直角引号');
  const rows = await page.$$eval('.diff-row', r => r.length);
  check(rows >= 10, `差异行数 ${rows}`);
  const delCount = await page.$$eval('.diff-row .chg-del', r => r.length);
  const insCount = await page.$$eval('.diff-row .chg-ins', r => r.length);
  check(delCount > 0 && insCount > 0, '差异里有删除与新增高亮');
  const total = await page.textContent('.summary__total');
  check(/共 \d+ 处/.test(total), '改动统计:' + total);
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png') });

  // 3. 规则开关与引号风格
  await page.uncheck('#rule-punct');
  out = await val('#output');
  check(out.includes('新版 APP,支持') && !out.includes('新版 APP，'), '关闭标点规则后保留半角逗号');
  check((await page.textContent('#count-punct')).trim() === '0 处', '关闭规则后计数为 0');
  await page.check('#rule-punct');
  await page.check('#quote-curly');
  out = await val('#output');
  check(out.includes('“这个功能很好用”') && !out.includes('「这个功能很好用」'), '切换为弯引号');
  await page.check('#quote-corner');

  // 4. 保护词
  await page.fill('#word-input', 'iOS');
  await page.click('#word-form button[type=submit]');
  out = await val('#output');
  check(out.includes('支持iOS和 Android'), '添加保护词 iOS 后两侧不再加空格');
  await page.fill('#word-input', 'iOS');
  await page.click('#word-form button[type=submit]');
  check(await page.isVisible('#word-msg'), '重复保护词被拒绝并提示');
  await page.click('[aria-label="移除保护词 iOS"]');
  out = await val('#output');
  check(out.includes('支持 iOS 和 Android'), '移除保护词后恢复');

  // 4b. 保留 Markdown 强制换行 + 原文框有可访问名称
  check((await page.getAttribute('#input', 'aria-labelledby')) === 'in-title', '原文输入框有可访问名称(aria-labelledby)');
  check((await page.textContent('[data-rule="whitespace"] .rule__desc')).includes('强制换行'), '空白规则旁明确写出会删除 Markdown 强制换行');
  check((await page.textContent('[data-rule="linkspace"] .rule__desc')).includes('链接的显示文字仍按各条排版规则处理'), '链接规则说明写明显示文字仍会处理');
  await page.fill('#input', '甲  \n乙');
  check((await val('#output')) === '甲\n乙', '默认会删除行尾两个空格');
  await page.check('#opt-keepbreak');
  check((await val('#output')) === '甲  \n乙', '勾选「保留强制换行」后保留行尾两个空格');
  await page.reload();
  check(await page.isChecked('#opt-keepbreak'), '保留强制换行选项刷新后仍在');
  await page.uncheck('#opt-keepbreak');

  // 5. 载入示例不能无确认覆盖
  await page.fill('#input', '我自己的文字abc');
  await page.click('#btn-sample');
  check(await page.isVisible('#confirm-sample'), '已有内容时载入示例先弹出页内确认');
  check((await val('#input')) === '我自己的文字abc', '确认前保留原内容');
  await page.click('#sample-no');
  check((await val('#input')) === '我自己的文字abc' && !(await page.isVisible('#confirm-sample')), '取消后内容不变');
  await page.click('#btn-sample');
  await page.click('#sample-yes');
  check((await val('#input')).split('\n').length === 25, '确认后才替换为示例');

  // 6. 复制
  await page.click('#btn-copy');
  await page.waitForTimeout(200);
  const st = await page.textContent('#status');
  check(st.includes('已复制'), '复制成功提示:' + st);
  if (clipboardGranted) {
    try {
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      check(clip === (await val('#output')), '剪贴板内容等于结果');
    } catch (e) { console.log('剪贴板读回不可用,已跳过:' + e.message); }
  }

  // 7. 导出
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export')]);
  const file = await download.path();
  check(download.suggestedFilename() === '清洁结果.md', '导出文件名 ' + download.suggestedFilename());
  check(fs.readFileSync(file, 'utf8') === (await val('#output')), '导出内容等于结果');

  // 8. 边界:超长文本保存后刷新仍在
  const big = '中文abc,好 5 %...\n'.repeat(15000);
  // 用脚本一次性写入模拟粘贴(page.fill 对 30 万字符的 textarea 太慢)
  await page.evaluate(t => { const i = document.getElementById('input'); i.value = t; i.dispatchEvent(new Event('input', { bubbles: true })); }, big);
  await page.waitForTimeout(800);
  check((await page.textContent('#status')).includes('已保存'), '超长文本保存成功提示');
  await page.reload();
  check((await val('#input')).length === big.length, `超长文本(${big.length} 字符)刷新后仍在`);
  // 恢复示例用于截图
  await page.click('#btn-sample');
  await page.click('#sample-yes');
  await page.waitForTimeout(500);
  await page.reload();
  check((await val('#input')).split('\n').length === 25, '示例刷新后仍在');

  // 结果与导出截图(整页)
  await page.click('#btn-export').catch(() => {});
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png'), fullPage: true });
  await noOverflow('桌面');

  // 9. 手机
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  await noOverflow('手机');
  const touch = await page.evaluate(() => [...document.querySelectorAll('input[type=checkbox],input[type=radio]')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); const l = e.closest('label').getBoundingClientRect(); return [r.width, r.height, l.height]; }));
  check(touch.length >= 10 && touch.every(x => x[0] >= 24 && x[1] >= 24 && x[2] >= 32), '手机端复选框/单选框 >= 24px,标签点击区高度 >= 32px');
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });

  // 10. 存储失败不能静默
  const bad = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  bad.on('pageerror', e => problems.push('存储失败页 pageerror: ' + e.message));
  await bad.addInitScript(() => {
    Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
  });
  await bad.goto(URL);
  await bad.fill('#input', '会保存失败的文字abc');
  await bad.waitForTimeout(700);
  check(await bad.isVisible('#save-warning'), '存储失败时显示持续可见的「未保存」提示');
  check(!(await bad.textContent('#status')).includes('已保存'), '存储失败时不显示「已保存」');
  check((await bad.textContent('#status')).includes('当前改动未保存'), '存储失败时结果区状态位置写明「当前改动未保存」');
  check(!(await bad.isDisabled('#btn-export')), '存储失败时仍可导出');
  await bad.close();

  // 11. 本机存的数据不合法:提示而不是静默
  const inv = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  inv.on('pageerror', e => problems.push('非法数据页 pageerror: ' + e.message));
  await inv.goto(URL);
  await inv.evaluate(() => localStorage.setItem('zhclean.v1', JSON.stringify({ v: 1, text: 5 })));
  await inv.reload();
  check(await inv.isVisible('#load-warning'), '读到不合法数据时显示提示');
  check((await inv.inputValue('#input')) === '', '不合法数据不被采用');
  await inv.close();

  // 12. 清空需确认
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.click('#btn-clear');
  check(await page.isVisible('#confirm-clear') && (await val('#input')) !== '', '清空先弹确认,确认前内容仍在');
  await page.click('#clear-yes');
  check((await val('#input')) === '' && await page.isVisible('#empty-guide'), '确认后清空并回到空状态');
  // 仅设置偏离默认值(没有原文)时,载入示例也先确认
  await page.check('#quote-curly');
  await page.click('#btn-sample');
  check(await page.isVisible('#confirm-sample') && (await page.textContent('#sample-scope')).includes('规则设置'), '只有设置偏离默认值时载入示例也先确认,并写明替换范围');
  await page.click('#sample-no');
  check((await val('#input')) === '' && await page.isChecked('#quote-curly'), '取消后设置保持不变');
  await page.check('#quote-corner');
  await page.close();

  // 展示图
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  show.on('pageerror', e => problems.push('showcase pageerror: ' + e.message));
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(300);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();

  console.log(`断言共 ${asserts} 条`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
