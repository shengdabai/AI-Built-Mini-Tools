'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const BASE = 'file://' + encodeURI(path.join(__dirname, 'index.html'));
const URL_INDEX = BASE + '?today=2026-10-20';
const URL_SHOWCASE = 'file://' + encodeURI(path.join(__dirname, 'showcase.html'));
const SHOTS = path.join(__dirname, 'screenshots');

const problems = [];
const results = [];
let asserts = 0;
function check(cond, msg) {
  asserts++;
  if (!cond) { problems.push('断言失败:' + msg); console.error('FAIL', msg); } else { console.log('ok  ', msg); }
}
function watch(page, tagName) {
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`[${tagName}] console error: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[${tagName}] pageerror: ${e.message}`));
}
async function overflow(page, label) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  results.push(`${label}: scrollWidth=${r.sw} innerWidth=${r.iw}`);
  check(r.sw <= r.iw, `${label} scrollWidth(${r.sw}) <= innerWidth(${r.iw})`);
}
async function pickSpec(page, titlePart) {
  await page.locator('.spec-item', { hasText: titlePart }).first().click();
}
async function step(page, n) { await page.click(`#steps-nav .step-tab:nth-child(${n})`); }
async function readDownload(page, clickSel) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(clickSel)]);
  const p = path.join(SHOTS, '.tmp-' + Date.now());
  await dl.saveAs(p);
  const text = fs.readFileSync(p, 'utf8');
  fs.unlinkSync(p);
  return { name: dl.suggestedFilename(), text };
}
const countSpecs = (page) => page.locator('#spec-list .spec-item').count();

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });
  try {
    /* ---------- 桌面 ---------- */
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    const page = await ctx.newPage();
    watch(page, 'desktop');
    await page.goto(URL_INDEX);
    check(await page.isVisible('#empty-guide'), '空状态显示引导');
    check(!(await page.isVisible('#editor')), '空状态不显示编辑器');
    await overflow(page, '桌面-空状态');
    await page.screenshot({ path: path.join(SHOTS, '01-空状态-桌面.png') });

    await page.click('#btn-sample-2');
    check((await page.textContent('#flash')).includes('合成示例'), '载入示例后提示合成示例');
    check((await countSpecs(page)) === 4, '库里有 4 份示例规格');

    // 质量检查:冲突 / 模糊词 / 完整
    await pickSpec(page, '限定与验收冲突');
    let checks = await page.textContent('#check-list');
    check(checks.includes('既出现在禁止项') && checks.includes('表格'), '冲突示例提示「表格」既禁止又要求');
    await pickSpec(page, '含模糊词');
    checks = await page.textContent('#check-list');
    check(checks.includes('不可观察') && checks.includes('专业') && checks.includes('例如'), '模糊词示例警告并给改写示例');
    check(checks.includes('给谁用'), '模糊词示例任务句缺「给谁用」提示');
    await pickSpec(page, '完整规格');
    checks = await page.textContent('#check-list');
    check(checks.includes('没有发现问题'), '完整示例没有质量问题');

    // 向导:逐步切换,进度条宽度随步骤变化
    const w1 = await page.evaluate(() => document.getElementById('progress-bar').style.width);
    await page.click('#btn-next');
    await page.click('#btn-next');
    const w3 = await page.evaluate(() => document.getElementById('progress-bar').style.width);
    check(w1 === '20%' && w3 === '60%', `进度条随步骤变化(${w1} -> ${w3})`);
    check(await page.isVisible('#step-3') && !(await page.isVisible('#step-1')), '第 3 步只显示验收标准');
    await overflow(page, '桌面-向导');
    await page.screenshot({ path: path.join(SHOTS, '02-核心流程-桌面.png') });

    // 载入示例不能无确认覆盖
    await page.fill('#f-title', '我改过的标题');
    await page.click('#btn-sample');
    check(await page.isVisible('#confirm'), '已有数据时载入示例先出现页内确认');
    check((await page.inputValue('#f-title')) === '我改过的标题', '确认前保留原状态');
    await page.click('#btn-confirm-no');
    check((await page.locator('.spec-item', { hasText: '我改过的标题' }).count()) === 1, '取消后原数据仍在');
    await page.click('#btn-sample');
    await page.click('#btn-confirm-yes');
    check((await page.locator('.spec-item', { hasText: '我改过的标题' }).count()) === 0, '确认后才替换为示例');

    // 搜索与标签
    await page.fill('#search', '表格');
    const found = await page.locator('#spec-list .spec-item').allTextContents();
    check(found.length === 2 && found.some((t) => t.includes('冲突')) && !found.some((t) => t.includes('只写了一半')), `搜索「表格」命中含该词的 2 份(${found.length})`);
    await page.fill('#search', '没有这个词xyz');
    check(await page.isVisible('#spec-list-empty'), '无匹配时显示提示');
    await page.fill('#search', '');
    await page.click('#tag-filter .chip:has-text("翻译")');
    check((await countSpecs(page)) === 1, '标签筛选「翻译」得到 1 份');
    await page.click('#tag-filter .chip:has-text("翻译")');
    check((await countSpecs(page)) === 4, '再点标签取消筛选');

    // 从模板新建
    await page.selectOption('#tpl-select', 'code-review');
    await page.click('#btn-from-tpl');
    check((await countSpecs(page)) === 5, '从模板新建后共 5 份');
    check((await page.inputValue('#f-task')).includes('【'), '模板内容是带【】占位的结构');

    // 新建空白并真实填写 + 边界值
    await page.click('#btn-new');
    await page.fill('#f-title', '=冒烟测试规格');
    await page.fill('#f-tags', '测试, 边界, __proto__');
    const longTask = '我要整理资料,给团队看。' + '长'.repeat(5000);
    await page.fill('#f-task', longTask);
    await step(page, 2);
    await page.click('#btn-add-constraint');
    await page.selectOption('#constraint-rows select', '禁止项');
    await page.fill('#constraint-rows .rowline input', '不要使用表格');
    await page.click('#btn-add-constraint');   // 半成品:空白行
    await step(page, 3);
    await page.click('#btn-add-criterion');
    await page.locator('#criteria-rows .rowline input').nth(0).fill('用表格列出三项');
    await page.locator('#criteria-rows .rowline input').nth(1).fill('检查输出里有表格');
    await step(page, 4);
    await page.fill('#f-output', '标题\n# 不是标题的一行\n结论');
    await step(page, 5);
    await page.fill('#f-role', '谨慎的整理者');
    checks = await page.textContent('#check-list');
    check(checks.includes('既出现在禁止项'), '手填的冲突被检出');

    // 保存后 reload 仍在(写入校验 = 读取校验)
    await page.reload();
    check((await countSpecs(page)) === 6, 'reload 后 6 份规格仍在');
    check((await page.inputValue('#f-title')) === '=冒烟测试规格', 'reload 后当前规格是刚编辑的');
    check((await page.inputValue('#f-task')).length === longTask.length, `reload 后超长任务(${longTask.length} 字)完整保留`);
    await step(page, 2);
    check((await page.locator('#constraint-rows .rowline').count()) === 2, 'reload 后半成品(空白限定行)仍在');
    check(await page.locator('#save-warning').isHidden(), '正常写入时没有未保存警告');

    // 删除条目:空白行直接删,非空条目先页内确认并列出内容
    await page.click('#constraint-rows .rowline:nth-child(2) button');
    check((await page.locator('#constraint-rows .rowline').count()) === 1 && await page.isHidden('#confirm'), '空白限定行直接删除,不弹确认');
    await page.click('#constraint-rows .rowline:nth-child(1) button');
    check(await page.isVisible('#confirm') && (await page.textContent('#confirm-text')).includes('不要使用表格') && (await page.textContent('#confirm-text')).includes('禁止项'), '非空限定条件删除前先确认,并列出类别与内容');
    check((await page.locator('#constraint-rows .rowline').count()) === 1, '确认前该条仍在');
    await page.click('#btn-confirm-no');
    check((await page.locator('#constraint-rows .rowline').count()) === 1 && (await page.inputValue('#constraint-rows .rowline input')) === '不要使用表格', '取消后限定条件保留');
    await page.click('#btn-add-constraint');
    await page.locator('#constraint-rows .rowline input').nth(1).fill('临时一条');
    await page.click('#constraint-rows .rowline:nth-child(2) button');
    await page.click('#btn-confirm-yes');
    check((await page.locator('#constraint-rows .rowline').count()) === 1, '确认后才删除「临时一条」');
    await step(page, 3);
    await page.click('#criteria-rows .rowline:nth-child(1) button');
    check(await page.isVisible('#confirm') && (await page.textContent('#confirm-text')).includes('用表格列出三项') && (await page.textContent('#confirm-text')).includes('检查输出里有表格'), '非空验收标准删除前先确认,并列出标准与检验方式');
    await page.click('#btn-confirm-no');
    check((await page.locator('#criteria-rows .rowline').count()) === 1, '取消后验收标准保留');

    // 输出:完整 / 第一轮先问
    const full = await page.inputValue('#out-text');
    const heads = full.split('\n').filter((l) => l.startsWith('## '));
    check(heads.join('|') === '## 角色与语气|## 任务|## 限定|## 验收|## 输出格式|## 交付前自检清单', '完整提示词分节与顺序正确');
    check(!full.split('\n').includes('# 不是标题的一行'), '输出里用户的 # 行被转义');
    await page.click('#tab-first');
    const first = await page.inputValue('#out-text');
    check(first.includes('先不要给答案') && first.includes('我要整理资料') && !first.includes('不要使用表格') && !first.includes('检查输出里有表格'), '第一轮先问只含任务');
    check((await page.textContent('#btn-dl-md')).includes('第一轮先问') && (await page.textContent('#btn-copy')).includes('第一轮先问'), '切到「第一轮先问」后,复制与下载按钮名都写明版本');
    const mdFirst = await readDownload(page, '#btn-dl-md');
    check(mdFirst.name.includes('第一轮先问') && mdFirst.text.includes('这一轮先不要给答案') && !mdFirst.text.includes('## 限定') && !mdFirst.text.includes('## 验收') && mdFirst.text.includes(first.split('\n')[1]), '下载按当前版本导出:文件名含「第一轮先问」,内容只有任务与先问说明');
    await page.click('#tab-full');
    check((await page.textContent('#btn-dl-md')).includes('完整提示词'), '切回完整版后按钮名写明「完整提示词」');

    // 复制
    await page.click('#btn-copy');
    await page.waitForTimeout(300);
    const flashText = await page.textContent('#flash');
    let clip = null;
    try { clip = await page.evaluate(() => navigator.clipboard.readText()); } catch (e) { clip = null; }
    if (clip !== null) check(clip === full, '剪贴板内容等于完整提示词');
    check(flashText.includes('已复制') || flashText.includes('已选中'), `复制有明确反馈(${flashText})`);

    // 导出
    const md = await readDownload(page, '#btn-dl-md');
    check(md.name.endsWith('.md') && md.name.includes('完整提示词') && md.text.startsWith('# ') && md.text.includes('## 交付前自检清单'), '提示词 Markdown 导出(完整版,文件名含「完整提示词」)');
    const js = await readDownload(page, '#btn-dl-json');
    const parsed = JSON.parse(js.text);
    check(parsed.specs.length === 1 && parsed.specs[0].task === longTask, '规格 JSON 导出当前一份且内容完整');
    const csv = await readDownload(page, '#btn-dl-csv');
    check(csv.text.includes("'=冒烟测试规格") && csv.text.split('\r\n')[0].includes('标题'), 'CSV 导出且标题公式前缀加了单引号');
    await page.evaluate(() => window.scrollTo(0, 0));
    await overflow(page, '桌面-结果与导出');
    await page.screenshot({ path: path.join(SHOTS, '03-结果与导出-桌面.png'), fullPage: true });

    // 导入:非法整份拒绝
    const before = await countSpecs(page);
    const bad = JSON.stringify({ specs: [{ id: 'x', title: 't', tags: [], task: 't', constraints: [{ kind: '乱写', text: '' }], criteria: [], output: '', role: '', tone: '', createdAt: '', updatedAt: '' }] });
    await page.setInputFiles('#file-import', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(bad) });
    await page.waitForSelector('#import-error:not([hidden])');
    check((await page.textContent('#import-error-list')).includes('kind'), '非法枚举导入被拒绝并给出原因');
    check((await countSpecs(page)) === before, '被拒绝后现有数据未改动');
    await page.click('#btn-import-error-close');
    await page.setInputFiles('#file-import', { name: 'dup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ specs: [parsed.specs[0], parsed.specs[0]] })) });
    await page.waitForSelector('#import-error:not([hidden])');
    check((await page.textContent('#import-error-list')).includes('重复'), '重复 ID 导入被拒绝');
    await page.click('#btn-import-error-close');
    await page.setInputFiles('#file-import', { name: 'noheader.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ specs: parsed.specs })) });
    await page.waitForSelector('#import-error:not([hidden])');
    const hdrErr = await page.textContent('#import-error-list');
    check(hdrErr.includes('app') && hdrErr.includes('version') && (await countSpecs(page)) === before, '外部备份缺少 app 与 version 时整份拒绝并说明,现有数据不变');
    await page.click('#btn-import-error-close');
    // 合法导入(先确认)
    await page.setInputFiles('#file-import', { name: 'ok.json', mimeType: 'application/json', buffer: Buffer.from(js.text) });
    await page.waitForSelector('#confirm:not([hidden])');
    check((await countSpecs(page)) === before, '合法导入在确认前不改动现有数据');
    await page.click('#btn-confirm-yes');
    check((await countSpecs(page)) === 1, '确认后导入替换为 1 份');

    // ?today 非法值回退不抛错
    const p2 = await ctx.newPage();
    watch(p2, 'today-invalid');
    await p2.goto(BASE + '?today=2026-02-30');
    check(await p2.isVisible('#editor'), '?today=2026-02-30 被拒绝回退真实今天,页面正常');
    await p2.close();

    // 清空确认
    await page.click('#btn-clear');
    check(await page.isVisible('#confirm'), '清空前出现页内确认区');
    await page.click('#btn-confirm-yes');
    check(await page.isVisible('#empty-guide'), '清空后回到空状态');
    await ctx.close();

    /* ---------- 本机存档读取失败:持续提示、可下载原始数据、放弃前不覆盖 ---------- */
    const RAW = JSON.stringify({ specs: [{ id: 'x', title: '旧数据' }] });
    const cctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    await cctx.addInitScript((raw) => { if (!localStorage.getItem('aispec.v1')) localStorage.setItem('aispec.v1', raw); }, RAW);
    const c = await cctx.newPage();
    watch(c, 'corrupt');
    await c.goto(URL_INDEX);
    check(await c.isVisible('#load-error') && (await c.textContent('#load-error-list')).length > 0, '本机存档读取失败:页面持续显示失败原因');
    check(await c.isVisible('#btn-raw-download') && await c.isVisible('#btn-raw-discard'), '提供「下载原始存档」与「放弃旧存档」两个入口');
    const rawDl = await readDownload(c, '#btn-raw-download');
    check(rawDl.text === RAW, '下载的原始存档与浏览器里的旧数据逐字一致');
    await c.click('#btn-new-2');
    check(await c.isVisible('#save-warning') && (await c.textContent('#save-warning-text')).includes('未保存') && (await c.textContent('#save-warning-text')).includes('旧存档'), '放弃之前新建规格不写入,并提示「未保存」与原因');
    check((await c.evaluate(() => localStorage.getItem('aispec.v1'))) === RAW, '旧存档在用户放弃之前原样保留');
    await c.click('#btn-raw-discard');
    check(await c.isVisible('#confirm') && (await c.evaluate(() => localStorage.getItem('aispec.v1'))) === RAW, '放弃旧存档先页内确认,确认前旧存档不动');
    await c.click('#btn-confirm-yes');
    check(await c.isHidden('#load-error') && (await c.evaluate(() => localStorage.getItem('aispec.v1'))) !== RAW, '确认放弃后提示消失,新库开始写入');
    await c.click('#btn-new-2').catch(() => {});
    await c.fill('#f-title', '放弃后新建');
    check(await c.isHidden('#save-warning'), '放弃旧存档后正常保存,没有未保存警告');
    await cctx.close();

    /* ---------- 存储写入失败 ---------- */
    const fctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await fctx.addInitScript(() => {
      Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
    });
    const f = await fctx.newPage();
    watch(f, 'storage-fail');
    await f.goto(URL_INDEX);
    await f.click('#btn-sample-2');
    check(await f.isVisible('#save-warning'), '存储写入失败时显示持续可见的「未保存」提示');
    check(!(await f.isVisible('#flash')), '存储写入失败时不显示成功提示');
    await f.fill('#f-task', '继续输入,给自己看');
    check(await f.isVisible('#save-warning'), '继续编辑时「未保存」提示仍在');
    await fctx.close();

    /* ---------- 手机 ---------- */
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const m = await mctx.newPage();
    watch(m, 'mobile');
    await m.goto(URL_INDEX);
    await overflow(m, '手机-空状态');
    await m.click('#btn-sample-2');
    await pickSpec(m, '限定与验收冲突');
    await overflow(m, '手机-第1步');
    for (let i = 2; i <= 5; i++) { await step(m, i); await overflow(m, '手机-第' + i + '步'); }
    const cols = await m.evaluate(() => getComputedStyle(document.querySelector('.layout')).gridTemplateColumns.split(' ').length);
    check(cols === 1, `手机端规格库与编辑区单列(列数 ${cols})`);
    await m.screenshot({ path: path.join(SHOTS, '04-手机.png'), fullPage: true });
    await mctx.close();

    /* ---------- 展示图 ---------- */
    const sctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    const s = await sctx.newPage();
    watch(s, 'showcase');
    await s.goto(URL_SHOWCASE);
    await s.waitForLoadState('load');
    const imgs = await s.evaluate(() => Array.from(document.images).map((i) => i.complete && i.naturalWidth > 0));
    check(imgs.length >= 3 && imgs.every(Boolean), `展示页 ${imgs.length} 张截图全部加载`);
    await overflow(s, '展示页');
    await s.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
    await sctx.close();
  } catch (e) {
    problems.push('脚本异常:' + (e && e.stack || e));
  } finally {
    await browser.close();
  }
  console.log('\n' + results.join('\n'));
  console.log('\n断言总数:' + asserts);
  if (problems.length) {
    console.error('\n共 ' + problems.length + ' 个问题:\n' + problems.join('\n'));
    process.exit(1);
  }
  console.log('\n全部通过');
})();
