'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const URL_INDEX = 'file://' + encodeURI(path.join(__dirname, 'index.html')) + '?today=2026-10-20';
const URL_SHOWCASE = 'file://' + encodeURI(path.join(__dirname, 'showcase.html'));
const SHOTS = path.join(__dirname, 'screenshots');

const problems = [];
const results = [];
let asserted = 0;
function check(cond, msg) {
  asserted++;
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
async function tab(page, name) { await page.click(`.tab[data-view="${name}"]`); }
async function tiles(page) { return page.locator('#card-grid .tile').count(); }
async function download(page, clickSel, tmpName) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(clickSel)]);
  const p = path.join(SHOTS, tmpName);
  await dl.saveAs(p);
  const text = fs.readFileSync(p, 'utf8');
  fs.unlinkSync(p);
  return { name: dl.suggestedFilename(), text };
}
async function cancelEdit(page) {
  await page.click('#btn-edit-cancel');
  if (await page.isVisible('#leave-confirm')) await page.click('#btn-leave-yes');
}
async function fillCard(page, o) {
  await page.click('#btn-new');
  await page.fill('#f-name', o.name);
  await page.fill('#f-def', o.def);
  await page.fill('#f-notnot', o.notNot);
  await page.fill('#f-questions', o.questions);
  if (o.status) await page.selectOption('#f-status', o.status);
  for (const l of o.links || []) { await page.fill('#f-link-input', l); await page.click('#btn-link-add'); }
  await page.click('#btn-edit-save');
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });
  try {
    /* ---------- 桌面 ---------- */
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
    const page = await ctx.newPage();
    watch(page, 'desktop');
    await page.goto(URL_INDEX);
    check(await page.isVisible('#empty-guide'), '空状态显示引导');
    await overflow(page, '桌面-空状态');
    await page.screenshot({ path: path.join(SHOTS, '01-空状态-桌面.png') });

    await page.click('#btn-sample-2');
    check((await page.textContent('#flash')).includes('合成示例'), '载入示例后提示合成示例');
    check((await page.textContent('#sample-note')).includes('合成示例卡片') && await page.isVisible('#sample-note'), '卡片库内持续标注合成示例卡片');
    check((await page.textContent('#today-fixed')).includes('基准日 2026-10-20(由地址参数固定)'), '?today 生效时页头持续显示基准日');
    check((await tiles(page)) === 18, '示例载入 18 张卡');
    const statText = await page.textContent('#stat-grid');
    check(statText.includes('草稿') && statText.includes('孤岛'), '统计条显示草稿与孤岛');
    const tileText = await page.textContent('#card-grid');
    check(tileText.includes('依赖未定义概念') && tileText.includes('超 60') && tileText.includes('孤岛') && tileText.includes('枢纽'), '卡片上有依赖未定义概念、超长、孤岛、枢纽标记');

    // 搜索
    await page.fill('#search-q', '匀速');
    check((await tiles(page)) === 1 && (await page.textContent('#card-grid')).includes('复利'), '搜索反例文字「匀速」只命中 复利');
    await page.fill('#search-q', '');
    await page.selectOption('#filter-status', '草稿');
    check((await tiles(page)) === 3, '状态筛选 草稿 = 3 张');
    await page.selectOption('#filter-status', '');

    // 新建:边界值 = 500 字的定义,保存后 reload 仍在
    const longDef = '长'.repeat(500);
    await fillCard(page, { name: '边界卡', def: longDef, notNot: '不是短定义\n不是随便写', questions: '超长文本能保存吗?', links: ['注意力'] });
    check((await page.textContent('#detail-body h2')) === '边界卡', '新建卡片后进入详情');
    check((await page.textContent('#detail-body')).includes('定义 500 字'), '详情提示定义超 60 字(警告,不阻止保存)');
    check((await page.textContent('#flash')).includes('已保存'), '成功提示在真正写入后出现');
    await page.click('#btn-detail-back');
    check((await tiles(page)) === 19, '新建后 19 张');
    await page.reload();
    check((await tiles(page)) === 19, 'reload 后仍是 19 张(写入校验 = 读取校验)');
    await page.fill('#search-q', '边界卡');
    const longBack = await page.evaluate(() => document.querySelector('#card-grid .tile__def').textContent.length);
    check(longBack === 500, `reload 后 500 字定义完整保留(${longBack})`);
    await page.fill('#search-q', '');

    // 关联双向:注意力 的详情里能看到「边界卡」
    await page.fill('#search-q', '有限心智资源');
    await page.click('#card-grid .tile__name .link-btn');
    check((await page.textContent('#detail-body')).includes('边界卡'), '关联双向:注意力 的邻居里出现 边界卡');
    await page.click('#btn-detail-back');
    await page.fill('#search-q', '');

    // 质量门:草稿引用 + 想设为可用 -> 拒绝
    await fillCard(page, { name: '待定卡', def: '建立在心智模型之上的判断方式', notNot: '不是直觉', questions: '我该用什么模型?', status: '可用' });
    const errs = await page.textContent('#edit-errors');
    check(errs.includes('依赖未定义概念') && errs.includes('心智模型'), '引用草稿概念时不能设为可用,并说明原因');
    check(await page.isVisible('#view-edit'), '被拒后停留在编辑页,输入不丢');
    await page.selectOption('#f-status', '草稿');
    await page.click('#btn-edit-save');
    check((await page.textContent('#detail-body h2')) === '待定卡', '改成草稿后可以保存');
    // 自引用 / 重名
    await page.click('text=编辑');
    await page.fill('#f-link-input', '待定卡');
    await page.click('#btn-link-add');
    await page.click('#btn-edit-save');
    check((await page.textContent('#edit-errors')).includes('不能关联自己'), '自引用被拒绝');
    await cancelEdit(page);
    await fillCard(page, { name: '注意力', def: '重名', notNot: 'x', questions: 'y' });
    check((await page.textContent('#edit-errors')).includes('同名'), '重名被拒绝');
    check((await page.getAttribute('#f-name', 'aria-invalid')) === 'true' && (await page.textContent('#err-name')).includes('同名') && (await page.getAttribute('#f-name', 'aria-describedby')) === 'err-name', '重名错误显示在「概念名」旁并用 aria-describedby 关联');
    check((await page.evaluate(() => document.activeElement.id)) === 'f-name', '提交失败后焦点移到第一个出错控件');
    // 表单有未保存修改:导出停用,离开与替换先确认
    check(await page.isDisabled('#btn-export-json') && await page.isDisabled('#btn-export-md') && await page.isDisabled('#btn-export-csv') && await page.isVisible('#export-block'), '编辑表单有未保存修改时导出按钮停用并提示');
    await page.click('.tab[data-view="graph"]');
    check(await page.isVisible('#leave-confirm') && await page.isVisible('#view-edit'), '未保存修改时切换分区先出现页内确认,仍停留在表单');
    await page.click('#btn-leave-no');
    check(await page.isVisible('#view-edit') && !(await page.isVisible('#leave-confirm')), '选择继续编辑后表单与输入保留');
    check((await page.inputValue('#f-def')) === '重名', '继续编辑后表单草稿未被覆盖');
    await page.click('#btn-new');
    check(await page.isVisible('#leave-confirm'), '编辑中再点「新建卡片」不会静默覆盖表单草稿');
    await page.click('#btn-leave-no');
    await page.click('#btn-sample');
    check(await page.isVisible('#leave-confirm'), '编辑中点「载入示例」先确认放弃草稿');
    await page.click('#btn-leave-no');
    await cancelEdit(page);
    check(!(await page.isDisabled('#btn-export-json')) && !(await page.isVisible('#export-block')), '放弃草稿离开后导出恢复可用');
    // CSV 公式防护用的卡
    await fillCard(page, { name: '=HYPERLINK("x")', def: '+开头的定义', notNot: '-不是什么', questions: '@谁?' });
    await page.click('#btn-detail-back');
    check((await tiles(page)) === 21, '现有 21 张卡(含 3 张用户新建)');

    // 普通编辑改定义 -> 走重写逻辑:旧定义进历史、记录日期
    await page.fill('#search-q', '收益再投入');
    await page.click('#card-grid .tile__name .link-btn');
    await page.click('text=编辑');
    await page.fill('#f-def', '收益再投入后继续产生收益,所以增长会随时间加速。');
    await page.click('#btn-edit-save');
    const edited = await page.textContent('#detail-body');
    check(edited.includes('历史版本') && edited.includes('使增长随时间加速。') && edited.includes('最近重写 2026-10-20') && edited.includes('已重写'), '普通编辑改定义:旧定义进历史版本、记录重写日期、状态变已重写');
    check((await page.textContent('#flash')).includes('旧定义已存入历史版本'), '编辑改定义后提示旧定义已存入历史');
    await page.click('#btn-detail-back');
    await page.fill('#search-q', '');

    // 载入示例不能无确认覆盖
    await page.click('#btn-sample');
    check(await page.isVisible('#replace-confirm'), '已有数据时载入示例先出现页内替换确认');
    check((await tiles(page)) === 21, '确认前保留原状态(仍 21 张)');
    await page.click('#btn-replace-no');
    check(!(await page.isVisible('#replace-confirm')) && (await tiles(page)) === 21, '取消后原数据不变');
    await page.fill('#search-q', '边界卡');
    check((await tiles(page)) === 1, '用户卡片仍在');
    await page.fill('#search-q', '');

    // 详情页:设为可用 / 质量门展示
    await page.fill('#search-q', '最少必要知识');
    await page.click('#card-grid .tile__name .link-btn');
    const detailText = await page.textContent('#detail-body');
    check(detailText.includes('依赖未定义概念:心智模型') && detailText.includes('未通过'), '详情页质量门显示「依赖未定义概念:心智模型」');
    await overflow(page, '桌面-详情');
    await page.screenshot({ path: path.join(SHOTS, '02-核心流程-桌面.png'), fullPage: true });
    await page.click('#btn-detail-back');
    await page.fill('#search-q', '杠杆');
    await page.click('#card-grid .tile__name .link-btn');
    await page.click('text=设为可用');
    check((await page.textContent('#detail-body')).includes('可用'), '质量门全过的草稿(杠杆)可以设为可用');
    await page.click('#btn-detail-back');
    await page.fill('#search-q', '');

    // 关系图
    await tab(page, 'graph');
    await page.selectOption('#graph-select', { label: '概念' });
    const nodes = await page.locator('#adj .node').count();
    check(nodes >= 5, `概念 的一跳邻居 >= 5(实际 ${nodes})`);
    check((await page.textContent('#hub-list')).includes('概念'), '枢纽列表含 概念');
    const isl = await page.textContent('#island-list');
    check(isl.includes('刚需') && isl.includes('机会成本'), '孤岛列表含 刚需、机会成本');
    await page.click('#adj .node >> nth=0');
    check((await page.locator('#adj .adj__center h3').textContent()) !== '概念', '点邻居后中心卡片切换');
    await overflow(page, '桌面-关系图');

    // 复习
    await tab(page, 'review');
    const rq = await page.textContent('#review-box');
    check(rq.includes('最久没有重写的 5 张'), '复习页列出 5 张');
    await page.click('text=开始复习');
    check((await page.textContent('#review-box')).includes('第 1 / 5 张'), '复习第 1/5 张');
    const firstName = await page.textContent('#review-box h2');
    await page.click('text=还清晰');
    check((await page.textContent('#review-box')).includes('第 2 / 5 张'), '点「还清晰」进入第 2 张');
    const secondName = await page.textContent('#review-box h2');
    await page.click('text=要重写');
    await page.fill('#review-rewrite-text', '改写后的更清楚的定义。');
    await page.click('text=保存重写并下一张');
    check((await page.textContent('#review-box')).includes('第 3 / 5 张'), '重写后进入第 3 张');
    await overflow(page, '桌面-复习');
    for (let i = 0; i < 3; i++) await page.click('text=还清晰');
    check((await page.textContent('#review-box')).includes('这一轮完成') && (await page.textContent('#review-box')).includes('重写 1 张'), '5 张复习完成并汇总');
    await page.click('text=回到卡片库');
    await page.fill('#search-q', secondName);
    await page.click('#card-grid .tile__name .link-btn');
    const rewritten = await page.textContent('#detail-body');
    check(rewritten.includes('改写后的更清楚的定义') && rewritten.includes('历史版本') && rewritten.includes('最近重写 2026-10-20'), `重写后详情显示新定义、历史版本与日期(${secondName};第一张 ${firstName} 只标记已复习)`);
    await page.click('#btn-detail-back');
    await page.fill('#search-q', '');

    // 导出
    await tab(page, 'library');
    const md = await download(page, '#btn-export-md', '.tmp.md');
    check(md.name.endsWith('.md') && md.text.startsWith('# 概念卡片库(21 张)') && md.text.includes('[[注意力]]'), '导出全部 Markdown');
    const csv = await download(page, '#btn-export-csv', '.tmp.csv');
    check(csv.text.includes("'=HYPERLINK") && csv.text.includes("'+开头的定义") && csv.text.includes("'-不是什么") && csv.text.includes("'@谁?"), 'CSV 公式防护');
    const json = await download(page, '#btn-export-json', '.tmp.json');
    check(JSON.parse(json.text).cards.length === 21, 'JSON 备份含 21 张');
    await page.fill('#search-q', '复利');
    await page.click('#card-grid .tile__name .link-btn');
    const one = await download(page, 'text=导出这张 Markdown', '.tmp1.md');
    check(one.text.startsWith('## 复利') && !one.text.includes('## 注意力'), '单张 Markdown 只含这一张');
    await page.click('#btn-detail-back');
    await page.fill('#search-q', '');

    // 导入:坏文件整份拒绝;好文件需确认替换
    const badBackup = JSON.parse(json.text);
    badBackup.cards[3].status = '完成';
    fs.writeFileSync(path.join(SHOTS, '.bad.json'), JSON.stringify(badBackup));
    await page.setInputFiles('#file-import', path.join(SHOTS, '.bad.json'));
    await page.waitForSelector('#import-error:not([hidden])');
    check((await page.textContent('#import-error')).includes('状态必须是') && (await tiles(page)) === 21, '导入含非法状态的备份:整份拒绝,现有数据不变');
    await page.click('#btn-import-error-close');
    const dupBackup = JSON.parse(json.text);
    dupBackup.cards[1].name = dupBackup.cards[0].name;
    fs.writeFileSync(path.join(SHOTS, '.bad.json'), JSON.stringify(dupBackup));
    await page.setInputFiles('#file-import', path.join(SHOTS, '.bad.json'));
    await page.waitForSelector('#import-error:not([hidden])');
    check((await page.textContent('#import-error')).includes('概念名重复'), '导入重名备份被拒绝并说明原因');
    await page.click('#btn-import-error-close');
    const gateBackup = JSON.parse(json.text);
    const clearCard = gateBackup.cards.find((c) => c.name === '清晰');
    clearCard.def = '用心智模型判断是否清晰';
    clearCard.status = '可用';
    fs.writeFileSync(path.join(SHOTS, '.bad.json'), JSON.stringify(gateBackup));
    await page.setInputFiles('#file-import', path.join(SHOTS, '.bad.json'));
    await page.waitForSelector('#import-error:not([hidden])');
    const gateMsg = await page.textContent('#import-error');
    check(gateMsg.includes('质量门') && gateMsg.includes('依赖未定义概念:心智模型') && (await tiles(page)) === 21, '导入「可用」但引用草稿概念的备份:整份拒绝并说明质量门原因');
    await page.click('#btn-import-error-close');
    const smaller = JSON.parse(json.text);
    smaller.cards = smaller.cards.slice(0, 5).map((c) => Object.assign({}, c, { links: [] }));
    fs.writeFileSync(path.join(SHOTS, '.good.json'), JSON.stringify(smaller));
    await page.setInputFiles('#file-import', path.join(SHOTS, '.good.json'));
    await page.waitForSelector('#replace-confirm:not([hidden])');
    check((await tiles(page)) === 21, '导入合法备份:确认前保留原状态');
    await page.click('#btn-replace-yes');
    check((await tiles(page)) === 5, '确认后替换为备份里的 5 张');
    fs.unlinkSync(path.join(SHOTS, '.bad.json'));
    fs.unlinkSync(path.join(SHOTS, '.good.json'));

    // 03:恢复示例后的关系图 + 导出结果
    await page.click('#btn-sample');
    await page.click('#btn-replace-yes');
    await tab(page, 'graph');
    await page.selectOption('#graph-select', { label: '概念' });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(SHOTS, '03-结果与导出-桌面.png'), fullPage: true });

    // 清空确认
    await page.click('#btn-clear');
    check(await page.isVisible('#clear-confirm'), '清空前出现页内确认区');
    await page.click('#btn-clear-yes');
    await tab(page, 'library');
    check(await page.isVisible('#empty-guide'), '清空后回到空状态');
    await ctx.close();

    /* ---------- 日期:非法 today 回退 ---------- */
    const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const d = await dctx.newPage();
    watch(d, 'today');
    await d.goto('file://' + encodeURI(path.join(__dirname, 'index.html')) + '?today=2026-02-30');
    await d.click('#btn-sample-2');
    await d.click('#card-grid .tile__name .link-btn >> nth=0');
    const detailDates = await d.textContent('#detail-body');
    check(!detailDates.includes('2026-02-30') && detailDates.includes('天前'), '?today=2026-02-30 被拒绝,回退真实今天');
    await dctx.close();

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
    await fctx.close();

    /* ---------- 手机 ---------- */
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const m = await mctx.newPage();
    watch(m, 'mobile');
    await m.goto(URL_INDEX);
    await m.click('#btn-sample-2');
    await overflow(m, '手机-卡片库');
    const cols = await m.evaluate(() => getComputedStyle(document.getElementById('card-grid')).gridTemplateColumns.split(' ').length);
    check(cols === 1, `手机端卡片网格单列(${cols} 列)`);
    const tiny = await m.evaluate(() => [...document.querySelectorAll('button, select, input[type="search"]')].filter((e) => e.offsetParent && !e.classList.contains('visually-hidden')).filter((e) => e.getBoundingClientRect().height < 32).length);
    check(tiny === 0, `手机端卡片库没有高度小于 32px 的可点元素(${tiny})`);
    await m.screenshot({ path: path.join(SHOTS, '04-手机.png'), fullPage: true });
    await m.click('#card-grid .tile__name .link-btn >> nth=0');
    await overflow(m, '手机-详情');
    await m.click('#btn-detail-back');
    await tab(m, 'graph');
    await overflow(m, '手机-关系图');
    await tab(m, 'review');
    await m.click('text=开始复习');
    await overflow(m, '手机-复习');
    await m.click('#btn-new');
    await overflow(m, '手机-编辑');
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
  console.log('断言数:' + asserted);
  if (problems.length) {
    console.error('\n共 ' + problems.length + ' 个问题:\n' + problems.join('\n'));
    process.exit(1);
  }
  console.log('\n全部通过');
})();
