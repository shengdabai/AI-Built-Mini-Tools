'use strict';
/* 复利墙浏览器端检查（Playwright，无头）。
 * 用法：node tests/ui.cjs
 *
 * 浏览器：默认 ~/.local/bin/chrome-headless-shell，可用环境变量 CHROME_HEADLESS_SHELL 覆盖。
 * Playwright：先找本项目/全局的 playwright、playwright-core，再找 Node 全局目录里 @playwright/mcp 自带的 playwright-core。
 * 页面以 file:// 打开，外部请求（Google 字体）一律拦掉，保证离线可重复。每个检查用独立浏览器上下文，localStorage 互不影响。 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

const INDEX_URL = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
const CHROME = process.env.CHROME_HEADLESS_SHELL || path.join(os.homedir(), '.local', 'bin', 'chrome-headless-shell');
const SNAPSHOT_KEY = 'cw:snapshot:v2';

function loadPlaywright() {
  for (const name of ['playwright', 'playwright-core']) {
    try { return require(name); } catch { /* 继续找下一个 */ }
  }
  const globalModules = path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules');
  return require(path.join(globalModules, '@playwright', 'mcp', 'node_modules', 'playwright-core'));
}

/* ---------- 测试数据 ---------- */
const pad = (n) => String(n).padStart(2, '0');
function keyOffset(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** entries: { 相对今天的天数偏移: 数值 }，例如 { 0: 0, '-1': 5 } */
function snapshot(entries) {
  const logs = {};
  for (const [offset, value] of Object.entries(entries)) logs[keyOffset(Number(offset))] = { value, note: '', ts: 1 };
  return {
    version: 2,
    revision: 1,
    habits: [{ id: 'h_seed', name: '读书', unit: '页', color: '#6b8e23', createdAt: 1 }],
    logs: { h_seed: logs },
    meta: { longestStreak: 0, lastExport: null },
    active: 'h_seed',
  };
}

/* ---------- 页面辅助 ---------- */
async function openApp(browser, seed) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route((url) => url.protocol !== 'file:', (route) => route.abort());
  if (seed) {
    await context.addInitScript(({ key, value }) => {
      try { if (!localStorage.getItem(key)) localStorage.setItem(key, value); } catch { /* 无存储时由页面自己报错 */ }
    }, { key: SNAPSHOT_KEY, value: JSON.stringify(seed) });
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(INDEX_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('#wall .cell').length > 0);
  return { context, page, errors };
}
const text = (page, sel) => page.locator(sel).first().textContent().then((t) => t.trim());
async function storedLogs(page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const snap = JSON.parse(raw);
    return snap.logs[snap.active] || {};
  }, SNAPSHOT_KEY);
}
const settle = (page) => page.waitForTimeout(300); // 等异步保存和重渲染落地

/* ---------- 检查项 ---------- */
const checks = [];
const check = (name, fn) => checks.push({ name, fn });

check('今日打卡弹窗：数值框旁有“需大于 0”的内联提示', async (browser) => {
  const { context, page, errors } = await openApp(browser);
  try {
    await page.click('#todayCheckBtn');
    assert.equal(await page.locator('#checkValueHint').isVisible(), true, '输入框旁应有内联提示');
    assert.match(await text(page, '#checkValueHint'), /大于 0/);
    assert.equal(await page.getAttribute('#checkValue', 'aria-describedby'), 'checkValueHint');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

check('今日打卡填 0 提交：当前连续保持 0 天，表单被拦下', async (browser) => {
  const { context, page, errors } = await openApp(browser);
  try {
    await page.click('#todayCheckBtn');
    await page.fill('#checkValue', '0');
    await page.click('#checkForm button[type="submit"]');
    await settle(page);

    assert.equal(await page.locator('#checkModal').isVisible(), true, '填 0 不应保存，弹窗应保持打开');
    assert.equal(await page.evaluate(() => document.querySelector('#checkValue').validity.rangeUnderflow), true);
    assert.equal(await text(page, '#curStreak'), '0', '当前连续应保持 0 天');
    assert.equal(await text(page, '#totalDays'), '0', '累计打卡应保持 0 天');
    assert.deepEqual(Object.keys(await storedLogs(page)), [], '不应写入任何记录');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

check('今日打卡填正数：当前连续变为 1 天', async (browser) => {
  const { context, page, errors } = await openApp(browser);
  try {
    await page.click('#todayCheckBtn');
    await page.fill('#checkValue', '5');
    await page.click('#checkForm button[type="submit"]');
    await page.waitForFunction(() => document.querySelector('#checkModal').hidden);
    await settle(page);

    assert.equal(await text(page, '#curStreak'), '1');
    assert.equal(await text(page, '#totalDays'), '1');
    assert.match(await text(page, '#curStreakHint'), /已连续 1 天/);
    assert.equal(Object.keys(await storedLogs(page)).length, 1);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

check('已存在的 0 值记录：保留不删除，但不计入连续、最长和累计天数', async (browser) => {
  // 今天、昨天、前天都是 0；10 天前有 1 次真实打卡 5 页
  const { context, page, errors } = await openApp(browser, snapshot({ 0: 0, '-1': 0, '-2': 0, '-10': 5 }));
  try {
    await settle(page);
    assert.equal(await text(page, '#curStreak'), '0', '3 天 0 值不应算连续');
    assert.equal(await text(page, '#bestStreak'), '1', '历史最长只数那 1 次真实打卡');
    assert.equal(await text(page, '#totalDays'), '1');
    assert.match(await text(page, '#totalSumHint'), /累计 5 页/);
    assert.match(await text(page, '#curStreakHint'), /从今天开始/);

    assert.equal(Object.keys(await storedLogs(page)).length, 4, '4 条记录（含 3 条 0 值）都应保留');

    await page.click('.topnav__btn[data-view="habits"]');
    assert.match(await text(page, '.habit-item__meta'), /累计打卡 1 天/, '习惯列表口径与面板一致');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

check('新增习惯弹窗：删除按钮真的不可见（computed display 为 none）', async (browser) => {
  const { context, page, errors } = await openApp(browser);
  try {
    await page.click('.topnav__btn[data-view="habits"]');
    await page.click('#addHabitBtn');
    assert.equal(await page.locator('#habitModal').isVisible(), true);
    assert.equal(await text(page, '#habitModalTitle'), '新增习惯');

    const display = await page.evaluate(() => getComputedStyle(document.querySelector('#deleteHabitBtn')).display);
    assert.equal(display, 'none', '新增习惯时不应出现“删除此习惯”');
    assert.equal(await page.locator('#deleteHabitBtn').isVisible(), false);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

check('编辑已有习惯弹窗：删除按钮仍然可见', async (browser) => {
  const { context, page, errors } = await openApp(browser);
  try {
    await page.click('.topnav__btn[data-view="habits"]');
    await page.click('.habit-item [data-act="edit"]');
    assert.equal(await text(page, '#habitModalTitle'), '编辑习惯');

    const display = await page.evaluate(() => getComputedStyle(document.querySelector('#deleteHabitBtn')).display);
    assert.notEqual(display, 'none');
    assert.equal(await page.locator('#deleteHabitBtn').isVisible(), true);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

/* ---------- 运行 ---------- */
(async () => {
  assert.ok(fs.existsSync(CHROME), `找不到无头浏览器：${CHROME}（可设置 CHROME_HEADLESS_SHELL）`);
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  let failed = 0;
  try {
    for (const { name, fn } of checks) {
      try {
        await fn(browser);
        console.log('PASS  ' + name);
      } catch (e) {
        failed++;
        console.log('FAIL  ' + name);
        console.log('      ' + String(e.message).split('\n').join('\n      '));
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`\n${checks.length - failed}/${checks.length} 通过`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
