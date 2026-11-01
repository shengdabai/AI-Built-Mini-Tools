'use strict';
/* 北极星提示词工厂浏览器端检查（Playwright，无头）。
 * 用法：node tests/ui.cjs
 *
 * 浏览器：默认 ~/.local/bin/chrome-headless-shell，可用环境变量 CHROME_HEADLESS_SHELL 覆盖。
 * Playwright：先找本项目/全局的 playwright、playwright-core，再找 Homebrew 与 Node 全局目录。
 * 页面以 file:// 打开，外部请求（Google 字体）一律拦掉，保证离线可重复。每个检查用独立浏览器上下文，localStorage 互不影响。 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

const INDEX_URL = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
const CHROME = process.env.CHROME_HEADLESS_SHELL || path.join(os.homedir(), '.local', 'bin', 'chrome-headless-shell');

function loadPlaywright() {
  for (const name of ['playwright', 'playwright-core']) {
    try { return require(name); } catch { /* 继续找下一个 */ }
  }
  const dirs = ['/opt/homebrew/lib/node_modules', '/usr/local/lib/node_modules', path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules')];
  for (const dir of dirs) {
    for (const name of ['playwright', 'playwright-core', path.join('@playwright', 'mcp', 'node_modules', 'playwright-core')]) {
      try { return require(path.join(dir, name)); } catch { /* 继续找下一个 */ }
    }
  }
  throw new Error('找不到 playwright / playwright-core');
}

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

async function openApp(browser, seed) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route(/^https?:\/\//, (route) => route.abort());
  if (seed) await context.addInitScript((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, seed);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto(INDEX_URL);
  await page.waitForSelector('#promptOut');
  return { context, page, errors };
}
const text = (page, sel) => page.locator(sel).first().innerText();
const preview = (page) => page.locator('#promptOut').textContent();

check('默认状态：预览含角色设定、默认范围说明，token 与字符数都有值', async (browser) => {
  const { context, page, errors } = await openApp(browser);
  try {
    const out = await preview(page);
    assert.match(out, /^# 角色设定\n/);
    assert.ok(out.includes('(未指定具体范围,按该领域通用情境处理)'), '空范围时应写入默认说明');
    assert.ok(!out.includes('{DOMAIN}'), '占位符未被替换');
    assert.ok(Number(await text(page, '#tokenNum')) > 0, 'token 估算应大于 0');
    assert.equal(await text(page, '#charCount'), '· ' + out.length + ' 字符');
    assert.equal(await text(page, '#consoleName'), '写作.prompt');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

check('领域范围原样写入预览：含 $$、$&、$`、$\' 等符号也不被改写', async (browser) => {
  const { context, page, errors } = await openApp(browser);
  try {
    const samples = ['美股 $$ 与港股', '仓位 $& 风险', "汇率 $` 和 $' 报价", '预算 $100 以内'];
    for (const s of samples) {
      await page.fill('#domainInput', s);
      const out = await preview(page);
      assert.ok(out.includes('对话:' + s + '。') || out.includes('范围:' + s + '。') || out.includes('协作:' + s + '。'), '预览没有原样包含输入「' + s + '」:\n' + out.split('\n')[2]);
      assert.ok(!out.includes('{DOMAIN}'), '输入「' + s + '」后预览里出现了 {DOMAIN}');
    }
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

check('切换领域与强度：标题、对抗强度段落随之变化', async (browser) => {
  const { context, page, errors } = await openApp(browser);
  try {
    await page.click('#domainSeg [data-domain="investing"]');
    assert.equal(await text(page, '#consoleName'), '投资.prompt');
    assert.match(await preview(page), /魔鬼代言人/);
    await page.click('#intensitySeg [data-intensity="ruthless"]');
    assert.match(await preview(page), /\n# 对抗强度【冷酷拷问】\n对抗强度【冷酷拷问】:/);
    assert.equal(await page.locator('#intensitySeg [data-intensity="ruthless"]').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

check('原则全部取消勾选时给出提醒；填写弱点后出现专门段落', async (browser) => {
  const { context, page, errors } = await openApp(browser);
  try {
    for (const p of ['independence', 'calibration', 'first_principle']) await page.uncheck(`#principleList [data-principle="${p}"]`);
    const out = await preview(page);
    assert.ok(out.includes('未勾选任何原则'), '应提醒至少保留一条原则');
    assert.ok(!/\n1\. /.test(out), '不应再有编号原则');
    await page.fill('#weaknessInput', '被夸两句就放松');
    assert.ok((await preview(page)).includes('我最容易被你顺着说的地方是:被夸两句就放松'));
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

check('存为 fork 后进入提示词库，刷新页面仍在', async (browser) => {
  const { context, page, errors } = await openApp(browser);
  try {
    await page.fill('#domainInput', '季度复盘');
    await page.click('#saveBtn');
    await page.click('.nav-btn[data-view="library"]');
    assert.equal(await text(page, '#libCount'), '1 个 fork');
    assert.equal(await page.locator('#forkList .fork-name').first().inputValue(), '季度复盘 · 对手陪练');
    await page.reload();
    await page.waitForSelector('#promptOut');
    await page.click('.nav-btn[data-view="library"]');
    assert.equal(await text(page, '#libCount'), '1 个 fork');
    assert.ok((await text(page, '#forkList .fork-prompt')).includes('季度复盘'));
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

check('存档含非对象记录时停止写入并显示恢复入口', async (browser) => {
  const dirty = JSON.stringify([
    { id: 'a', name: '坏领域', domain: 'nope', intensity: 'nope', principles: ['independence', 'bogus'], compiled: 'x', tokenEst: 1, ts: 1 },
    null,
    'string-item',
    { id: 'b', domain: 'coding', intensity: 'gentle', principles: 'not-array', ts: 2 }
  ]);
  const { context, page, errors } = await openApp(browser, { 'ppf:prompts': dirty, 'ppf:selfchecks': '{broken json' });
  try {
    await page.click('.nav-btn[data-view="library"]');
    assert.equal(await text(page, '#libCount'), '无法读取');
    assert.equal(await page.locator('#forkList .fork').count(), 0);
    assert.equal(await page.locator('.archive-recovery:visible').count(), 2);
    await page.click('.nav-btn[data-view="forge"]');
    await page.click('#saveBtn');
    assert.equal(await page.evaluate(() => localStorage.getItem('ppf:prompts')), dirty);
    await page.click('.nav-btn[data-view="trend"]');
    assert.deepEqual(errors.filter(e => e.startsWith('pageerror')), []);
  } finally { await context.close(); }
});

check('混合存档先下载全部原文，再只丢弃无效成员', async (browser) => {
  const valid = [
    { id: 'a', name: 'First', domain: 'writing', intensity: 'rival', principles: [], compiled: 'first', ts: 1 },
    { id: 'b', name: 'Second', domain: 'coding', intensity: 'gentle', principles: [], compiled: 'second', ts: 2 }
  ];
  const raw = JSON.stringify([valid[0], null, valid[1]]);
  const { context, page, errors } = await openApp(browser, { 'ppf:prompts': raw });
  try {
    const panel = page.getByRole('region', { name: '提示词库恢复', exact: true });
    const [download] = await Promise.all([
      page.waitForEvent('download'), panel.getByRole('button', { name: '只保留有效记录', exact: true }).click()
    ]);
    assert.equal(JSON.parse(fs.readFileSync(await download.path(), 'utf8')).raw, raw);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('ppf:prompts'))), valid);
    assert.match(await text(page, '#toast'), /保留 2 条.*丢弃 1 条/);
    assert.equal(await panel.isVisible(), false);
    await page.click('.nav-btn[data-view="library"]');
    assert.equal(await page.locator('#forkList .fork').count(), 2);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

check('下载提示在切换视图和重复渲染后保留，重新读取后更新', async (browser) => {
  const { context, page, errors } = await openApp(browser, { 'ppf:prompts': '{broken' });
  try {
    const panel = page.getByRole('region', { name: '提示词库恢复', exact: true });
    await Promise.all([
      page.waitForEvent('download'), panel.getByRole('button', { name: '导出原始文本' }).click()
    ]);
    const status = await panel.getByRole('status').innerText();
    assert.match(status, /已请求下载/);
    await page.click('.nav-btn[data-view="library"]');
    await page.click('.nav-btn[data-view="forge"]');
    await page.click('.nav-btn[data-view="library"]');
    assert.equal(await panel.getByRole('status').innerText(), status);
    await panel.getByRole('button', { name: '重新读取', exact: true }).click();
    assert.match(await panel.getByRole('status').innerText(), /无法读取/);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

check('损坏存档可下载原文，确认后只重置指定存档', async (browser) => {
  const raw = '{broken<&>\ud800';
  const { context, page, errors } = await openApp(browser, { 'ppf:prompts': raw, 'ppf:selfchecks': '{other broken' });
  try {
    const panel = page.getByRole('region', { name: '提示词库恢复', exact: true });
    const reset = panel.getByRole('button', { name: '重置提示词库', exact: true });
    assert.equal(await reset.isDisabled(), true);
    const [download] = await Promise.all([
      page.waitForEvent('download'), panel.getByRole('button', { name: '导出原始文本' }).click()
    ]);
    const bundle = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.equal(bundle.raw, raw);
    assert.equal(bundle.key, 'ppf:prompts');
    assert.equal(await reset.isDisabled(), true);
    await panel.getByRole('checkbox').check();
    page.once('dialog', dialog => dialog.dismiss());
    await reset.click();
    assert.equal(await page.evaluate(() => localStorage.getItem('ppf:prompts')), raw);
    page.once('dialog', dialog => dialog.accept());
    await reset.click();
    assert.equal(await panel.isVisible(), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('ppf:prompts')), '[]');
    assert.equal(await page.evaluate(() => localStorage.getItem('ppf:selfchecks')), '{other broken');
    await page.click('#saveBtn');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ppf:prompts')).length), 1);
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
