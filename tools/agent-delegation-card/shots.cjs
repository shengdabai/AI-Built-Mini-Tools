// 委托契约卡 — Playwright 截图与端到端冒烟：真实点击/键盘/拖拽走完「起草 → 导出 → 存入台账 → 回填 → 台账 → 清空」。
// 运行：node shots.cjs   任何 console error / pageerror / 横向溢出 / 断言失败都会以非零退出。
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;

const DIR = __dirname;
const SHOTS = path.join(DIR, 'screenshots');
const TODAY = '2026-09-30';
const URL = 'file://' + encodeURI(path.join(DIR, 'index.html')) + '?today=' + TODAY;
const KEY = 'weituoqiyueka.v1'; // gitleaks:allow (localStorage key name)
const problems = [];

function watch(page, name) {
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`[${name}] console.error: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[${name}] pageerror: ${e.message}`));
  page.on('dialog', (d) => d.accept());
}
function check(cond, msg) { if (!cond) throw new Error('断言失败：' + msg); }
async function noOverflow(page, label) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  check(r.sw <= r.iw, `${label} 横向溢出 scrollWidth=${r.sw} innerWidth=${r.iw}`);
}
async function calm(page) {
  await page.evaluate(() => { document.querySelector('#toast').classList.remove('is-visible'); if (document.activeElement) document.activeElement.blur(); window.scrollTo(0, 0); });
  await page.mouse.move(0, 0).catch(() => {});
  await page.waitForTimeout(300);
}
async function go(page, hash) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForSelector(`#view-${hash}:not([hidden])`);
}
const zoneOf = (page, id) => page.evaluate(([k, i]) => JSON.parse(localStorage.getItem(k)).draft.actions.find((a) => a.id === i).zone, [KEY, id]);
async function saveDownload(page, clickSel, name) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(clickSel)]);
  const p = path.join(os.tmpdir(), name);
  await dl.saveAs(p);
  return { file: dl.suggestedFilename(), text: fs.readFileSync(p, 'utf8') };
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });
  try {
    // ---------- 桌面 ----------
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
    const page = await ctx.newPage();
    watch(page, 'desktop');
    await page.goto(URL);
    await page.waitForSelector('#preview .empty__title');
    check((await page.textContent('#preview .empty__title')).includes('还没有契约内容'), '空状态引导');
    check((await page.locator('.zone--ask .action').count()) === 8, '默认 8 项在必问区');
    check((await page.textContent('#check-panel .check-panel__status')) === '一致', '默认检查为一致');
    await noOverflow(page, '桌面空状态');
    await calm(page);
    await page.screenshot({ path: path.join(SHOTS, '01-空状态-桌面.png') });

    // 手工填写任务包
    await page.fill('input[name="taskName"]', '整理 5 场客户访谈要点');
    await page.fill('input[name="taskType"]', '资料整理');
    await page.fill('textarea[name="goal"]', '每场访谈一页要点：痛点、原话引用、提到的替代方案；末尾汇总共性问题。');
    await page.fill('textarea[name="inputs"]', '访谈转写稿 5 份（共享盘「访谈」文件夹）\n访谈提纲 1 份');
    await page.fill('#criteria-list input >> nth=0', '每条原话引用都能在转写稿中找到出处');
    await page.click('#btn-add-criterion');
    await page.keyboard.type('共性问题至少被 2 场访谈提到才列入');
    await page.fill('textarea[name="deadline"]', '周四 12:00 前；超过 60 分钟未完成就停下汇报');
    await page.fill('textarea[name="stuckProtocol"]', '转写看不懂的地方先标注，最后一次性列给我，每条附你的猜测。');
    check((await page.textContent('.doc__title')) === '整理 5 场客户访谈要点', '预览实时显示任务名');
    check((await page.locator('.doc__criteria li').count()) === 2, '预览两条完成标准');

    // 点击：把付款放进自主区 → 警示 + R1 冲突（默认级别 L1 只建议）
    await page.click('.action[data-id="pay"] .seg--auto');
    check((await zoneOf(page, 'pay')) === 'auto', '付款进自主区');
    check((await page.textContent('#zone-warnings')).includes('付款 / 花钱'), '高风险进自主区显式警示');
    check(await page.locator('.action[data-id="pay"].is-danger').count() === 1, '付款卡片标红');
    check((await page.getAttribute('#check-panel', 'class')).includes('check-panel--conflict'), '检查结果为冲突');
    check((await page.textContent('#check-panel')).includes('规则 R1'), '显示触发规则 R1');

    // 键盘：聚焦「改文件」→ 右移到禁止区 → 左移回必问区
    await page.focus('.action[data-id="edit"] .action__name');
    await page.keyboard.press('ArrowRight');
    check((await zoneOf(page, 'edit')) === 'deny', '键盘右移到禁止区');
    check(await page.evaluate(() => document.activeElement.closest('.action').dataset.id === 'edit'), '移动后焦点仍在该动作');
    await page.keyboard.press('ArrowLeft');
    check((await zoneOf(page, 'edit')) === 'ask', '键盘左移回必问区');

    // 拖拽：安装依赖 → 禁止区
    await page.locator('#board').scrollIntoViewIfNeeded();
    const src = await page.locator('.action[data-id="install"]').boundingBox();
    const dst = await page.locator('.zone--deny .zone__list').boundingBox();
    await page.mouse.move(src.x + 4, src.y + 4);
    await page.mouse.down();
    await page.mouse.move(src.x + 30, src.y + 20, { steps: 5 });
    await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 10 });
    await page.mouse.up();
    check((await zoneOf(page, 'install')) === 'deny', '拖拽到禁止区');

    // 自定义高风险动作
    await page.fill('#custom-label', '在 CRM 里改客户状态');
    await page.check('#custom-high');
    await page.click('#custom-form button[type="submit"]');
    check((await page.locator('.zone--ask .action', { hasText: '在 CRM 里改客户状态' }).count()) === 1, '自定义动作进入必问区');

    // 升到 L2：R1 → R3（仍冲突）
    await page.click('.ladder__step--2');
    check((await page.textContent('#check-panel')).includes('规则 R3'), 'L2 触发 R3');
    check((await page.textContent('.stamp__value')) === '不一致', '预览印章为不一致');
    await noOverflow(page, '桌面起草');
    await calm(page);
    await page.screenshot({ path: path.join(SHOTS, '02-核心流程-桌面.png'), fullPage: true });

    await page.fill('#custom-label', '读文件');
    await page.click('#custom-form button[type="submit"]');
    check((await page.textContent('#toast')).includes('同名'), '重名自定义动作被拒');
    await page.fill('#custom-label', '');

    // 导出 Markdown
    const md = await saveDownload(page, '#btn-download', 'weituo-test.md');
    check(md.file === '委托契约卡-整理-5-场客户访谈要点.md', 'md 文件名：' + md.file);
    check(md.text.startsWith('# 委托契约卡：整理 5 场客户访谈要点'), 'md 标题');
    check(/### 自主区（[^）]+）\n- 读文件\n- 联网检索\n- 付款 \/ 花钱（高风险）/.test(md.text), 'md 自主区含付款');
    check(md.text.includes('- 在 CRM 里改客户状态（高风险）') && md.text.includes('- [ ] 共性问题至少被 2 场访谈提到才列入'), 'md 自定义动作与完成标准');
    check(md.text.includes('[R3]'), 'md 含触发规则');

    // 把付款放回必问区 → 一致
    await page.click('.action[data-id="pay"] .seg--ask');
    check((await page.textContent('.stamp__value')) === '一致', '修正后一致');

    // 必填校验：清空截止条件后存入被拒
    await page.fill('textarea[name="deadline"]', '');
    await page.click('#btn-commit');
    check((await page.textContent('#commit-msg')).includes('截止条件'), '缺必填项时拒绝存入');
    await page.fill('textarea[name="deadline"]', '周四 12:00 前；超过 60 分钟未完成就停下汇报');
    await page.click('#btn-commit');
    await page.waitForSelector('#view-score:not([hidden])');
    check((await page.textContent('#tab-count')) === '1', '台账 1 条');
    check(await page.evaluate(() => document.querySelector('#rec-select').selectedOptions[0].textContent.includes('待回填')), '新记录待回填');

    // 回填：亏本委托
    const vals = { baseline: 60, humanExec: 15, supervision: 20, rework: 25, authMaintenance: 10, learning: 5 };
    for (const [k, v] of Object.entries(vals)) await page.fill(`#fill-root input[name="${k}"]`, String(v));
    check((await page.textContent('.result__value')).startsWith('−15'), '净省时 −15');
    check((await page.textContent('.loss-banner')).includes('这次委托是亏的'), '亏损标记');
    check((await page.textContent('.formula')).includes('净省时 ＝ 45 − 20 − 25 − 10 − 5 ＝ -15 分钟'), '公式展示');
    check((await page.locator('.wf__svg rect').count()) === 8, '瀑布 8 根柱');
    await page.click('#fill-root button[type="submit"]');
    check((await page.textContent('#fill-msg')).includes('验收'), '未标记验收时拒绝');
    await page.check('#fill-root input[name="qualified"][value="false"]');
    await page.click('#fill-root button[type="submit"]');
    check((await page.textContent('.tile__value >> nth=0')) === '−15 分钟', '累计净省时 −15');

    // 载入示例（草稿已清空，无需确认）→ 台账 8 条
    await page.click('#btn-sample');
    check((await page.textContent('#tab-count')) === '8', '示例后 8 条');
    const tiles = await page.locator('.tile__value').allTextContents();
    check(tiles[0] === '+105 分钟' && tiles[1] === '50%' && tiles[2] === '8', 'KPI：' + tiles.join(' / '));
    const advice = await page.locator('.advice').allTextContents();
    check(advice.includes('先别再委托这类') && advice.includes('样本不足') && advice.includes('可继续委托，一次只扩大一个维度'), '按类型建议：' + advice.join(' / '));
    check((await page.locator('.tag--sample').count()) === 7, '7 条标注合成示例');
    check(await page.evaluate(() => document.querySelector('#rec-select').selectedOptions[0].textContent.includes('整理 5 场客户访谈要点')), '仍选中自己的记录');

    const csv = await saveDownload(page, '#btn-csv', 'weituo-test.csv');
    check(csv.text.charCodeAt(0) === 0xfeff, 'CSV BOM');
    const lines = csv.text.trim().split('\r\n');
    check(lines.length === 9, 'CSV 行数 ' + lines.length);
    check(lines[0].endsWith('净省时,是否亏损,合成示例') && csv.text.includes('整理 5 场客户访谈要点,资料整理,L2 确认后执行,已完成,不合格,60,15,20,25,10,5,45,-15,是,'), 'CSV 内容');
    await noOverflow(page, '桌面记分台账');
    await calm(page);
    await page.screenshot({ path: path.join(SHOTS, '03-结果与导出-桌面.png'), fullPage: true });

    // 起草页载入示例后的样子也不能溢出
    await go(page, 'draft');
    check((await page.textContent('.doc__title')) === '整理 9 月差旅报销材料', '示例草稿');
    await noOverflow(page, '桌面示例草稿');

    // 清空（确认框自动接受）
    await page.click('#btn-clear');
    check((await page.textContent('#tab-count')) === '0', '清空台账');
    check(await page.evaluate((k) => localStorage.getItem(k) === null, KEY), '清空 localStorage');
    await page.waitForSelector('#preview .empty__title');
    await ctx.close();

    // ---------- 手机 ----------
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const m = await mctx.newPage();
    watch(m, 'mobile');
    await m.goto(URL);
    await noOverflow(m, '手机空状态');
    await m.click('#preview .empty .btn--primary');
    await m.waitForSelector('.doc__title');
    await noOverflow(m, '手机起草');
    await go(m, 'score');
    await m.waitForSelector('.wf__svg');
    check((await m.textContent('.loss-banner')).includes('这次委托是亏的'), '手机：最近一条示例为亏损');
    await noOverflow(m, '手机记分');
    await calm(m);
    await m.screenshot({ path: path.join(SHOTS, '04-手机.png'), fullPage: true });
    await mctx.close();

    // ---------- 展示图 ----------
    const sctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    const s = await sctx.newPage();
    watch(s, 'showcase');
    await s.goto('file://' + encodeURI(path.join(DIR, 'showcase.html')));
    await s.waitForLoadState('load');
    check(await s.evaluate(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0)), '展示页截图全部加载');
    await noOverflow(s, '展示页');
    await s.screenshot({ path: path.join(DIR, 'showcase.png'), fullPage: true });
    await sctx.close();
  } catch (e) {
    problems.push(e.message);
  } finally {
    await browser.close();
  }
  if (problems.length) {
    console.error('失败：\n' + problems.join('\n'));
    process.exit(1);
  }
  console.log('OK：4 张截图 + showcase.png，零 console error，桌面/手机无横向溢出，核心路径断言全部通过');
})();
