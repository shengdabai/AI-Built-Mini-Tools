'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const BASE = 'file://' + encodeURI(path.join(__dirname, 'index.html'));
const URL = BASE + '?today=2026-10-20';
const OUT = path.join(__dirname, 'screenshots');

let asserts = 0;
const problems = [];
function check(cond, msg) { asserts++; if (!cond) problems.push('断言失败:' + msg); else console.log('OK  ' + msg); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });
  const watch = page => {
    page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
    page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  };
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  watch(page);
  const noOverflow = async (p, label) => {
    const [sw, iw] = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(`${label}: scrollWidth ${sw} <= innerWidth ${iw}`);
    check(sw <= iw, `${label} 无横向溢出(${sw} <= ${iw})`);
  };
  const txt = (sel) => page.textContent(sel).then(s => s.trim());

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  check(await page.isVisible('#empty-guide'), '空状态显示引导');
  check((await page.inputValue('#date-input')) === '2026-10-20', '?today 固定今天');
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

  // 核心流程:载入示例 → 看汇总与待确认 → 改一人回复 → 配费用
  await page.click('#btn-sample');
  await page.waitForSelector('#dish-table tbody tr td.num');
  check((await page.$$eval('#dish-table tbody tr', r => r.length)) >= 8, '示例汇总出多行');
  check((await page.inputValue('#replies-text')).split('\n').length === 16, '示例有 16 条回复');
  check(Number(await txt('#pending-count')) === 2, '待确认 2 条(螺蛳粉、鸡)');
  const pend = await txt('#pending-list');
  check(pend.includes('螺蛳粉') && pend.includes('可乐鸡翅'), '待确认列出未识别菜与歧义候选');
  const pers = await txt('#person-table');
  check(/吴桐[\s\S]*麻婆豆腐 不辣 ×1/.test(pers), '「同上」生效');
  check(/郑好[\s\S]*不点/.test(pers), '「不吃」记为不点');
  check(/周北\s*红烧肉 ×1/.test(pers) && !/周北\s*鱼香/.test(pers), '同一人改单取最后一次');
  const order = await page.inputValue('#order-text');
  check(order.includes('宫保鸡丁 微辣 ×3,不辣 ×3'), '下单文本按规格合并:' + order.split('\n')[0]);
  const feeBefore = await page.inputValue('#pay-text');
  await page.fill('#fee-input', '8');
  await page.selectOption('#fee-mode', 'amount');
  const pay = await page.inputValue('#pay-text');
  check(pay !== feeBefore && pay.includes('合计'), '改费用与分摊方式后收款文本变化');
  const sumPay = await page.$$eval('#person-table tbody tr td:last-child', tds => tds.reduce((s, t) => s + parseFloat(t.textContent), 0));
  const total = parseFloat(await txt('#total-amount'));
  check(Math.abs(sumPay - (total + 8)) < 0.001, `应付合计 ${sumPay} = 餐费 ${total} + 费用 8`);
  await page.fill('#fee-input', 'abc');
  check(await page.isVisible('#fee-error'), '非法费用显示错误且不覆盖');
  check(await page.isDisabled('#btn-copy-order') && await page.isDisabled('#btn-copy-pay') && await page.isDisabled('#btn-csv-dish') && await page.isDisabled('#btn-csv-person'), '费用非法时复制与 CSV 导出全部停用');
  check((await txt('#export-hint')).includes('费用输入无效') && (await txt('#export-hint')).includes('上一次保存的费用'), '输出区说明结果仍按上一次保存的费用');
  check((await page.getAttribute('#fee-input', 'aria-invalid')) === 'true' && (await page.getAttribute('#fee-input', 'aria-describedby')) === 'fee-error', '费用输入框标记无效并关联错误文字');
  await page.fill('#fee-input', '8');
  check(await page.isEnabled('#btn-copy-order') && await page.isEnabled('#btn-csv-dish') && await page.isHidden('#fee-error'), '改回有效费用后复制与导出恢复');
  check((await txt('#fee-note')).includes('余数较大') && !(await txt('#fee-note')).includes('按名单顺序先给前面'), '按金额分摊时零头说明写「小数余数较大的人」');
  await page.selectOption('#fee-mode', 'head');
  check((await txt('#fee-note')).includes('名单顺序'), '按人头平分时零头说明写「名单顺序」');
  await page.selectOption('#fee-mode', 'amount');
  await page.fill('#fee-input', 'abc');
  await page.fill('#fee-input', '8');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png') });
  await noOverflow(page, '桌面');

  // 载入示例不能无确认覆盖
  await page.fill('#replies-text', '林小满: 红烧肉\n周北: 米饭');
  await page.click('#btn-sample');
  check(await page.isVisible('#confirm-area'), '已有数据时载入示例先弹页内确认');
  check((await page.inputValue('#replies-text')) === '林小满: 红烧肉\n周北: 米饭', '确认前保留原状态');
  await page.click('#btn-confirm-no');
  check((await page.inputValue('#replies-text')).startsWith('林小满: 红烧肉'), '取消后仍是原数据');
  await page.click('#btn-sample');
  await page.click('#btn-confirm-yes');
  check((await page.inputValue('#replies-text')).split('\n').length === 16, '确认后才替换为示例');
  await page.fill('#fee-input', '8');

  // 历史日期用当日菜单快照:改今天的菜价不改变昨天金额
  const yBefore = await page.textContent('#history-list');
  await page.fill('#menu-text', (await page.inputValue('#menu-text')).replace('红烧肉 | 28', '红烧肉 | 40'));
  await page.click('#btn-menu-apply');
  const yAfter = await page.textContent('#history-list');
  check(/2026-10-19 · 6 人 · 合计 145 元/.test(yAfter) && yAfter.includes('2026-10-19') && yBefore.match(/2026-10-19[^\n]*?元/)[0] === yAfter.match(/2026-10-19[^\n]*?元/)[0], '改菜价后 10-19 历史金额不变:' + yAfter.match(/2026-10-19[^\n]*?元/)[0]);
  check(/红烧肉 ×3/.test(await page.inputValue('#order-text')), '今天的订单仍正常');
  const todayTotal = parseFloat(await txt('#total-amount'));
  check(todayTotal === 404 + 3 * 12, `今天按新价 40 元计:${todayTotal}`);
  // 打开历史日期:菜单框显示当天快照(只读),当前菜单另设编辑入口
  await page.click('#history-list li:has-text("2026-10-19") button');
  const snapText = await page.inputValue('#menu-text');
  check(await page.evaluate(() => document.getElementById('menu-text').readOnly) && snapText.includes('红烧肉 | 28') && !snapText.includes('红烧肉 | 40'), '历史日期:菜单框显示当天快照(红烧肉 28 元),不是当前菜单(40 元)');
  check((await txt('#menu-mode-text')).includes('2026-10-19') && (await txt('#menu-mode-text')).includes('快照'), '标明是哪一天的菜单快照');
  check(await page.isDisabled('#btn-menu-apply') && await page.isDisabled('#dish-name'), '查看快照时不能应用菜单或加菜');
  const histPay = await page.inputValue('#pay-text');
  await page.click('#btn-menu-mode');
  check((await page.inputValue('#menu-text')).includes('红烧肉 | 40') && !(await page.evaluate(() => document.getElementById('menu-text').readOnly)), '点「编辑当前菜单」后显示并可编辑当前菜单(40 元)');
  check((await txt('#menu-mode-text')).includes('仍按当天保存的菜单快照') && (await page.inputValue('#pay-text')) === histPay, '编辑当前菜单时说明这一天仍按快照计价,收款文本不变');
  await page.click('#btn-menu-mode');
  check((await page.inputValue('#menu-text')).includes('红烧肉 | 28'), '再点一次回到快照视图');
  await page.click('#history-list li:has-text("2026-10-20") button');
  check(!(await page.evaluate(() => document.getElementById('menu-text').readOnly)) && (await page.inputValue('#menu-text')).includes('红烧肉 | 40') && await page.isHidden('#menu-mode-note'), '回到今天:显示当前菜单且可编辑');
  await page.click('#btn-sample');
  await page.click('#btn-confirm-yes');
  await page.fill('#fee-input', '8');

  // 未应用的菜单草稿、手动加菜表单也算用户数据
  await page.click('#btn-clear');
  await page.click('#btn-confirm-yes');
  check(await page.isVisible('#empty-guide'), '清空后回到空状态');
  await page.fill('#menu-text', '红烧肉 | 28');
  await page.click('#btn-sample');
  check(await page.isVisible('#confirm-area') && (await txt('#confirm-text')).includes('尚未应用的菜单修改'), '只粘贴了菜单还没应用:载入示例先确认,并写明会丢掉菜单草稿');
  check((await page.inputValue('#menu-text')) === '红烧肉 | 28', '确认前保留菜单草稿');
  await page.click('#btn-confirm-no');
  await page.fill('#menu-text', '');
  await page.fill('#dish-name', '手填菜');
  await page.click('#btn-sample');
  check(await page.isVisible('#confirm-area') && (await txt('#confirm-text')).includes('手动加一道菜'), '手动加菜表单有内容:载入示例先确认');
  await page.click('#btn-confirm-no');
  check((await page.inputValue('#dish-name')) === '手填菜', '取消后手动加菜表单保留');
  await page.fill('#dish-name', '');
  await page.click('#btn-sample');
  await page.fill('#fee-input', '8');

  // 最后一条回复无效:该人变待确认,不按旧订单收费
  await page.fill('#replies-text', '甲: 米饭 x2\n乙: 红烧肉\n甲:');
  check((await txt('#pending-list')).includes('甲'), '最后回复无效的人列入待确认');
  check(/甲\s*—\(另有 1 项待确认\)\s*0\s*0/.test((await txt('#person-table')).replace(/\n/g, '')) || (await txt('#person-table')).includes('另有 1 项待确认'), '甲不再按旧订单计费');
  await page.click('#btn-sample');
  await page.click('#btn-confirm-yes');
  await page.fill('#fee-input', '8');

  // 一周统计与上次同款
  const week = await txt('#week-table');
  check(/林小满[\s\S]*2/.test(week), '本周统计每人次数');
  await page.fill('#date-input', '2026-10-21');
  await page.dispatchEvent('#date-input', 'change');
  check((await page.inputValue('#replies-text')) === '', '切到新的一天为空');
  check(!(await page.isDisabled('#btn-last-same')), '「上次同款」可用');
  await page.click('#btn-last-same');
  check((await page.inputValue('#replies-text')).split('\n').length === 16, '上次同款复制了前一天点单');
  await page.fill('#date-input', '2026-10-20');
  await page.dispatchEvent('#date-input', 'change');

  // 边界值保存后 reload 仍在:超长回复 + 最大费用 + 半成品输入
  const long = '边界甲: 红烧肉 x2\n' + ('边界乙: 米饭, 半成品 x\n'.repeat(5000));
  // 超长文本用「粘贴」方式一次写入(逐字填充 7 万字符会让 Playwright 本身很慢)
  await page.evaluate(t => { const ta = document.getElementById('replies-text'); ta.value = t; ta.dispatchEvent(new Event('input', { bubbles: true })); }, long);
  await page.fill('#fee-input', '1000000');
  await page.fill('#menu-text', (await page.inputValue('#menu-text')) + '\n半成品菜 | 100000');
  await page.click('#btn-menu-apply');
  await page.reload();
  check((await page.inputValue('#replies-text')) === long, '超长回复 reload 后仍在');
  check((await page.inputValue('#fee-input')) === '1000000', '最大费用 reload 后仍在');
  check((await page.inputValue('#menu-text')).includes('半成品菜 | 100000'), '最大单价 reload 后仍在');
  check(await page.isHidden('#save-warning'), 'reload 后无「未保存」警告');
  // 恢复示例,生成结果页
  await page.click('#btn-sample');
  await page.click('#btn-confirm-yes');
  await page.fill('#fee-input', '8');

  // 导出
  const [dl1] = await Promise.all([page.waitForEvent('download'), page.click('#btn-csv-dish')]);
  const csvPath = path.join(os.tmpdir(), 'tuancan-' + Date.now() + '.csv');
  await dl1.saveAs(csvPath);
  const csv = fs.readFileSync(csvPath, 'utf8');
  check(dl1.suggestedFilename().endsWith('.csv') && csv.includes('宫保鸡丁,微辣,3,22,66') && csv.includes('合计'), 'CSV 下载内容正确:' + dl1.suggestedFilename());
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#btn-json')]);
  const jsonPath = path.join(os.tmpdir(), 'tuancan-' + Date.now() + '.json');
  await dl2.saveAs(jsonPath);
  const backup = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  check(backup.version === 1 && backup.menu.length === 12 && backup.days.length === 3, 'JSON 备份含 12 道菜、3 天');
  await page.click('#btn-copy-order');
  await page.waitForFunction(() => document.getElementById('flash').textContent.includes('复制'));
  check((await txt('#flash')).length > 0, '复制给出明确反馈:' + await txt('#flash'));
  await page.evaluate(() => document.getElementById('h-output').scrollIntoView());
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png') });

  // 导入校验:坏文件整份拒绝;好文件(经确认)导入
  const badPath = path.join(os.tmpdir(), 'tuancan-bad-' + Date.now() + '.json');
  const bad = JSON.parse(JSON.stringify(backup));
  bad.days[0].date = '2026-02-30';
  fs.writeFileSync(badPath, JSON.stringify(bad));
  await page.setInputFiles('#file-import', badPath);
  await page.waitForFunction(() => document.getElementById('flash').textContent.includes('拒绝'));
  check((await page.inputValue('#replies-text')).split('\n').length === 16, '非法备份被拒绝,现有数据不变');
  await page.setInputFiles('#file-import', jsonPath);
  await page.waitForSelector('#confirm-area:not([hidden])');
  await page.click('#btn-confirm-yes');
  check((await page.inputValue('#replies-text')).split('\n').length === 16, '合法备份导入成功');

  // 手机
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await noOverflow(page, '手机');
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });

  // ?today 非法值回退到真实今天,不抛错、不进位
  const realToday = await page.evaluate(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
  for (const bad of ['2026-02-30', 'abc', '']) {
    await page.goto(BASE + '?today=' + bad);
    check((await page.inputValue('#date-input')) === realToday, `?today=${bad} 回退真实今天`);
  }
  await page.close();

  // 存储失败:setItem 抛 QuotaExceededError → 持续可见的未保存提示
  const q = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(q);
  await q.addInitScript(() => {
    Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
  });
  await q.goto(URL);
  await q.fill('#replies-text', '张三: 红烧肉');
  check(await q.isVisible('#save-warning'), '存储写入失败时显示「未保存」提示');
  check((await q.textContent('#save-warning')).includes('QuotaExceededError'), '提示包含失败原因');
  check(!(await q.textContent('#save-status')).startsWith('已保存'), '失败时不显示「已保存」');
  await q.fill('#replies-text', '张三: 红烧肉\n李四: 米饭');
  check(await q.isVisible('#save-warning'), '继续编辑后提示仍可见');
  await q.close();

  // 读取到损坏数据:不覆盖,提示原因
  const c = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(c);
  await c.goto(URL);
  await c.evaluate(() => localStorage.setItem('tuancan.v1', JSON.stringify({ version: 1, menu: [], days: [{ date: '2026-02-30', replies: '', fee: 0, feeMode: 'head' }] })));
  await c.reload();
  check(await c.isVisible('#save-warning'), '损坏数据显示警告');
  await c.fill('#replies-text', '张三: 红烧肉');
  const kept = await c.evaluate(() => localStorage.getItem('tuancan.v1'));
  check(kept.includes('2026-02-30'), '损坏数据未被新输入覆盖');
  await c.close();

  // 展示图
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  watch(show);
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(400);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();

  console.log(`断言共 ${asserts} 条`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
