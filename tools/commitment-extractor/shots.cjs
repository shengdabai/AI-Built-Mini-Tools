/* 截图与端到端冒烟：真实点击界面走完核心路径，产出 4 张截图 + showcase.png。
 * 运行：node shots.cjs   任何 console error / pageerror / 断言失败都以非零退出。 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;

const DIR = __dirname;
const SHOTS = path.join(DIR, 'screenshots');
const URL = 'file://' + encodeURI(path.join(DIR, 'index.html'));
const errors = [];

function check(cond, msg) {
  if (!cond) throw new Error('断言失败：' + msg);
  console.log('  ✓ ' + msg);
}
function watch(page, tag) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(tag + ' console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push(tag + ' pageerror: ' + e.message));
  page.on('dialog', (d) => d.accept());
}
async function noOverflow(page, label) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  check(r.sw <= r.iw, label + ' 无横向溢出（scrollWidth ' + r.sw + ' <= innerWidth ' + r.iw + '）');
}
async function download(page, selector) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(selector)]);
  const file = await dl.path();
  return { name: dl.suggestedFilename(), buf: fs.readFileSync(file) };
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });
  try {
    /* ---------- 桌面 1440×900 ---------- */
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'zh-CN' });
    watch(page, 'desktop');
    await page.goto(URL);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    check(await page.isVisible('#empty-state'), '空状态可见');
    await noOverflow(page, '桌面空状态');
    await page.screenshot({ path: path.join(SHOTS, '01-空状态-桌面.png') });

    // 核心路径：载入示例 → 自动识别 → 点击清单行定位原文 → 编辑
    await page.click('#btn-sample');
    await page.waitForSelector('#tbody tr');
    const rows = await page.locator('#tbody tr').count();
    check(rows >= 10, '示例识别出 ' + rows + ' 条承诺');
    check(await page.isVisible('#src-view'), '识别后切到原文对照视图');
    check(await page.isVisible('#sample-flag'), '标注「当前为合成示例」');
    const marks = await page.evaluate(() => ({
      commit: document.querySelectorAll('#src-view .hl-commit').length,
      unclear: document.querySelectorAll('#src-view .hl-unclear').length,
    }));
    check(marks.commit > 0 && marks.unclear > 0, '原文同时有「承诺」与「？待澄清」标记（' + marks.commit + '/' + marks.unclear + '）');

    // 找「那个色卡」那一行：补负责人不需要，补日期
    const colorRow = page.locator('#tbody tr', { hasText: '那个色卡' });
    check(await colorRow.count() === 1, '「那个色卡回头发你」进入清单');
    await colorRow.locator('td.cell-task').click({ position: { x: 4, y: 40 } });
    const targetOk = await page.evaluate(() => {
      const t = document.querySelector('#src-view .hl.is-target');
      return !!t && t.textContent.includes('那个色卡');
    });
    check(targetOk, '点击清单行定位到原文句子');
    const colorId = await colorRow.getAttribute('data-id');
    await page.fill('#tbody tr[data-id="' + colorId + '"] .cell-due input', '2026-10-09');
    await page.locator('#tbody tr[data-id="' + colorId + '"] .cell-due input').dispatchEvent('change');
    await page.fill('#tbody tr[data-id="' + colorId + '"] .cell-task input', '把 A3 色卡寄给林晓');
    await page.locator('#tbody tr[data-id="' + colorId + '"] .cell-task input').dispatchEvent('change');
    const stillUnclear = await page.locator('#tbody tr[data-id="' + colorId + '"] .tag-unclear').count();
    check(stillUnclear === 0, '补齐期限并改写指代后，该条不再待澄清');

    // 状态改为已完成
    const firstId = await page.locator('#tbody tr').first().getAttribute('data-id');
    await page.selectOption('#tbody tr[data-id="' + firstId + '"] .cell-status select', 'done');
    // 再点一条待澄清行，让截图里有定位高亮
    const oliverRow = page.locator('#tbody tr', { hasText: 'revised sample' });
    await oliverRow.locator('.link-btn').click();
    await page.waitForTimeout(1600);
    await noOverflow(page, '桌面核心流程');
    await page.screenshot({ path: path.join(SHOTS, '02-核心流程-桌面.png') });

    // 持久化：刷新后编辑仍在
    await page.reload();
    await page.waitForSelector('#tbody tr');
    const persisted = await page.inputValue('#tbody tr[data-id="' + colorId + '"] .cell-due input');
    check(persisted === '2026-10-09', 'localStorage 刷新后保留编辑');

    // 筛选
    await page.selectOption('#f-clarity', 'unclear');
    const unclearRows = await page.locator('#tbody tr').count();
    const unclearTags = await page.locator('#tbody tr .tag-unclear').count();
    check(unclearRows > 0 && unclearRows === unclearTags, '「待澄清」筛选只剩待澄清行（' + unclearRows + '）');
    await page.selectOption('#f-clarity', '');
    await page.selectOption('#f-owner', 'Minh Tran');
    const ownerOk = await page.evaluate(() => Array.from(document.querySelectorAll('#tbody .cell-owner input')).every((i) => i.value === 'Minh Tran'));
    check(ownerOk, '负责人筛选生效');
    await page.selectOption('#f-owner', '');

    // 追问问题 + 复制
    const qs = await page.locator('#q-list li').allTextContents();
    check(qs.some((q) => q.startsWith('Which revision of the sample should we confirm, and what date can you commit to?')), '英文模糊句生成英文追问');
    check(qs.some((q) => /[一-龥]/.test(q) && q.includes('验厂报告')), '中文模糊句生成中文追问');
    await page.click('#btn-copy');
    await page.waitForSelector('#toast:not([hidden])');
    check((await page.textContent('#toast')).includes('已复制'), '复制全部问题成功');

    // 导出三种格式并校验内容
    const csv = await download(page, '#btn-csv');
    check(csv.buf[0] === 0xef && csv.buf[1] === 0xbb && csv.buf[2] === 0xbf, 'CSV 带 UTF-8 BOM（' + csv.name + '）');
    check(csv.buf.toString('utf8').includes('把 A3 色卡寄给林晓'), 'CSV 含用户编辑后的事项');
    const md = await download(page, '#btn-md');
    check(md.buf.toString('utf8').includes('待澄清'), 'Markdown 纪要含待澄清段落（' + md.name + '）');
    const ics = await download(page, '#btn-ics');
    const icsText = ics.buf.toString('utf8');
    check(icsText.startsWith('BEGIN:VCALENDAR\r\n') && icsText.trimEnd().endsWith('END:VCALENDAR'), 'ICS 结构完整且用 CRLF（' + ics.name + '）');
    check(!/[^\r]\n/.test(icsText), 'ICS 没有裸 LF');
    check(/DTSTART;VALUE=DATE:20261009/.test(icsText), 'ICS 含编辑后日期的全天事件');
    const vevents = (icsText.match(/BEGIN:VEVENT/g) || []).length;
    check(vevents === (icsText.match(/UID:/g) || []).length && vevents === (icsText.match(/DTSTAMP:/g) || []).length, 'ICS 每个事件都有 UID 与 DTSTAMP（' + vevents + ' 个）');

    // 结果与导出截图：右栏滚到追问与导出区
    await page.evaluate(() => {
      const pane = document.querySelector('.pane-list');
      pane.scrollTop = pane.scrollHeight;
    });
    await page.waitForTimeout(300);
    await noOverflow(page, '桌面结果与导出');
    await page.screenshot({ path: path.join(SHOTS, '03-结果与导出-桌面.png') });

    // 清空数据（confirm 自动接受）
    await page.click('#btn-clear');
    check(await page.isVisible('#empty-state'), '清空后回到空状态');
    check(await page.evaluate(() => localStorage.getItem('cfx:state:v1') === null || JSON.parse(localStorage.getItem('cfx:state:v1')).items.length === 0), '清空后本机存储无承诺');
    await page.close();

    /* ---------- 手机 390×844 ---------- */
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-CN' });
    watch(mobile, 'mobile');
    await mobile.goto(URL);
    await mobile.evaluate(() => localStorage.clear());
    await mobile.reload();
    await mobile.click('#btn-sample');
    await mobile.waitForSelector('#tbody tr');
    await mobile.waitForSelector('#toast', { state: 'hidden', timeout: 5000 }); // 固定定位的提示会盖住整页截图中段
    await noOverflow(mobile, '手机');
    await mobile.screenshot({ path: path.join(SHOTS, '04-手机.png'), fullPage: true });
    await mobile.close();

    /* ---------- 展示图 1600×1000 ---------- */
    const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    watch(show, 'showcase');
    await show.goto('file://' + encodeURI(path.join(DIR, 'showcase.html')));
    await show.waitForLoadState('load');
    const broken = await show.evaluate(() => Array.from(document.images).filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src));
    check(broken.length === 0, 'showcase 内嵌截图全部加载');
    await noOverflow(show, 'showcase');
    await show.screenshot({ path: path.join(DIR, 'showcase.png'), fullPage: true });
    await show.close();
  } finally {
    await browser.close();
  }

  if (errors.length) {
    console.error('发现 ' + errors.length + ' 条页面错误：\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('完成：4 张截图 + showcase.png，0 条 console error / pageerror');
})().catch((e) => {
  console.error(e.message);
  if (errors.length) console.error(errors.join('\n'));
  process.exit(1);
});
