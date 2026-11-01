'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const URL = 'file://' + encodeURI(path.join(__dirname, 'index.html')) + '?today=2026-10-20';
const OUT = path.join(__dirname, 'screenshots');
const TMP = path.join(__dirname, '.omc', 'shots-tmp');

let asserts = 0;
const problems = [];
function check(cond, msg) { asserts++; if (!cond) { problems.push(msg); console.log('FAIL: ' + msg); } else console.log('ok   ' + msg); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));

  const noOverflow = async label => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(`${label}: scrollWidth ${sw} <= innerWidth ${iw}`);
    check(sw <= iw, `${label} 无横向溢出 (${sw} <= ${iw})`);
  };
  const visCount = sel => page.locator(sel).evaluateAll(els => els.filter(e => e.offsetParent !== null || getComputedStyle(e).position === 'fixed').length);
  const nodeCount = () => visCount('.org-node');
  const linkCount = () => page.locator('.org-link').count();
  const tab = name => page.click(`[data-tab="${name}"]`);

  /* ---- 空状态 ---- */
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  check(await page.isVisible('#empty-guide'), '空状态显示引导');
  check(await page.isVisible('#import-btn-top'), '空状态下「导入 JSON 备份」入口始终可见');
  check((await page.textContent('#today-note')).includes('基准日 2026-10-20(由地址参数固定)'), '?today 生效时页面持续显示基准日');
  check((await page.textContent('header.topbar')).includes('不创建或运行 Agent'), '首屏说明改为“页面只保存设计,不创建或运行 Agent”');
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

  /* ---- 载入示例 + 组织图 ---- */
  await page.click('#load-sample');
  await page.waitForSelector('.org-node');
  check(await nodeCount() === 12, '示例 12 个节点');
  check(await page.isVisible('#sample-banner'), '载入示例后持续显示「合成示例」提示');
  const boxes = await page.$eval('#f-int input', e => { const r = e.getBoundingClientRect(); const l = e.closest('label').getBoundingClientRect(); return [r.width, r.height, l.height]; });
  check(boxes[0] >= 24 && boxes[1] >= 24 && boxes[2] >= 32, `复选框视觉 ≥ 24×24 且 label 点击区高度 ≥ 32 (${boxes.map(Math.round).join('/')})`);
  check(await linkCount() === 11, '示例 11 条连线');
  check(await page.locator('.org-node.is-root').count() === 1, '根节点唯一且突出');
  check(await page.locator('.org-node.s-idea').count() >= 1 && await page.locator('.org-node.s-configured').count() >= 1 && await page.locator('.org-node.s-running').count() >= 1 && await page.locator('.org-node.s-disabled').count() >= 1, '四种状态都有节点');
  const bgs = await page.$$eval('.org-node:not(.is-root)', els => new Set(els.map(e => getComputedStyle(e).backgroundColor)).size);
  check(bgs >= 4, `四种状态底色互不相同 (${bgs})`);

  // 悬停显示职责与干预点
  await page.locator('.org-node:has-text("记账 Agent") .node-main').scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  await page.hover('.org-node:has-text("记账 Agent") .node-main');
  await page.waitForSelector('#tip:not([hidden])');
  const tipText = await page.textContent('#tip');
  check(tipText.includes('整理流水') && tipText.includes('付款') && tipText.includes('记账 Agent'), '悬停提示含职责与干预点: ' + tipText.replace(/\s+/g, ' ').slice(0, 60));
  await page.mouse.move(5, 5);
  check(await page.isHidden('#tip'), '移开后提示隐藏');

  // 点节点 → 快速改状态即时换色
  await page.click('.org-node:has-text("周报 Agent") .node-main');
  check((await page.textContent('#form-title')).includes('周报 Agent'), '点节点进入编辑');
  const bgBefore = await page.$eval('.org-node:has-text("周报 Agent")', e => getComputedStyle(e).backgroundColor);
  await page.click('#quick-status [data-status="running"]');
  const bgAfter = await page.$eval('.org-node:has-text("周报 Agent")', e => getComputedStyle(e).backgroundColor);
  const clsAfter = await page.$eval('.org-node:has-text("周报 Agent")', e => e.className);
  check(bgBefore !== bgAfter && clsAfter.includes('s-running'), `状态改变即时换色 (${bgBefore} -> ${bgAfter})`);
  check(await page.inputValue('#f-status') === 'running', '快速改状态同步到表单');
  await page.click('#quick-status [data-status="idea"]');

  // 新增节点挂到某上级:节点数与连线数 +1
  const n0 = await nodeCount(), l0 = await linkCount();
  await page.click('#mode-new');
  await page.fill('#f-name', '客服 Agent');
  await page.fill('#f-duty', '回答读者的常见问题');
  await page.selectOption('#f-parent', { label: '运营部' });
  await page.selectOption('#f-trigger-kind', 'event');
  await page.fill('#f-trigger-text', '收到私信');
  await page.selectOption('#f-status', 'configured');
  await page.check('#f-int input[value="approve"]');
  check(!(await page.isChecked('#f-int input[value="none"]')), '勾选审批后「无」自动取消');
  await page.check('#f-inputs input >> nth=6');   // 随便挂一个输入来源
  await page.fill('#f-weekly', '4');
  await page.click('#btn-add');
  await page.waitForSelector('.org-node:has-text("客服 Agent")');
  const n1 = await nodeCount(), l1 = await linkCount();
  check(n1 === n0 + 1, `新增节点后节点数 +1 (${n0} -> ${n1})`);
  check(l1 === l0 + 1, `新增节点后连线数 +1 (${l0} -> ${l1})`);
  const kidTop = await page.$eval('.org-node:has-text("客服 Agent")', e => e.offsetTop);
  const parentTop = await page.$eval('.org-node:has-text("运营部")', e => e.offsetTop);
  check(kidTop > parentTop, '新节点画在上级下方');
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png'), fullPage: true });
  await noOverflow('桌面(组织图)');

  // 表单即时预览:提交前图就变(文字、颜色、位置),取消后恢复
  await page.click('.org-node:has-text("周报 Agent") .node-main');
  const pos0 = await page.$eval('.org-node:has-text("周报 Agent")', e => [e.offsetLeft, e.offsetTop, getComputedStyle(e).backgroundColor]);
  await page.fill('#f-name', '周报改名 Agent');
  check(await page.locator('.org-node:has-text("周报改名 Agent")').count() === 1, '提交前改岗位名,图上文字即时变化');
  await page.selectOption('#f-status', 'disabled');
  const pos1 = await page.$eval('.org-node:has-text("周报改名 Agent")', e => [e.offsetLeft, e.offsetTop, getComputedStyle(e).backgroundColor]);
  check(pos1[2] !== pos0[2], `提交前改状态,图上颜色即时变化 (${pos0[2]} -> ${pos1[2]})`);
  await page.selectOption('#f-parent', { label: '研发' });
  const pos2 = await page.$eval('.org-node:has-text("周报改名 Agent")', e => [e.offsetLeft, e.offsetTop]);
  check(pos2[0] !== pos1[0], `提交前改上级,图上位置即时变化 (x ${pos1[0]} -> ${pos2[0]})`);
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('orgchart.v1')).nodes.some(n => n.name === '周报 Agent')), '预览阶段没有落盘');
  check((await page.textContent('#chart-note')).includes('预览'), '预览有「尚未保存」标识');
  // 预览期间切到导出页:所有导出与复制被禁用并说明原因
  await tab('export');
  check(await page.isDisabled('#dl-svg') && await page.isDisabled('#dl-csv') && await page.isDisabled('#dl-json') && await page.isDisabled('#dl-md') && await page.isDisabled('#copy-md'), '预览期间 SVG/CSV/JSON/骨架下载与复制全部禁用');
  check(await page.isVisible('#export-lock') && (await page.textContent('#export-lock')).includes('尚未保存'), '导出页写明先保存或取消');
  await tab('chart');
  await page.click('#btn-cancel');
  await tab('export');
  check(await page.isEnabled('#dl-svg') && await page.isEnabled('#dl-json') && await page.isHidden('#export-lock'), '取消修改后导出恢复');
  await tab('chart');
  await page.click('.org-node:has-text("周报 Agent") .node-main');
  await page.click('#btn-cancel');
  check(await page.locator('.org-node:has-text("周报 Agent")').count() === 1 && await page.locator('.org-node:has-text("周报改名")').count() === 0, '取消后图恢复为已保存状态');
  await page.click('#mode-new');
  await page.fill('#f-name', '预览新岗');
  check(await nodeCount() === n1 + 1, '新建模式输入岗位名,提交前图上就出现新节点');
  await page.click('#btn-cancel').catch(() => {});
  await page.click('#mode-new');
  await page.fill('#f-name', '');
  check(await nodeCount() === n1, '清空名称后预览消失');

  // 非法输入被拒绝(不保存)
  await page.click('#mode-new');
  await page.fill('#f-name', '   ');
  await page.click('#btn-add');
  check(await page.isVisible('#form-msg') && (await page.textContent('#form-msg')).includes('岗位名'), '空岗位名被拒绝并说明原因');
  check(await page.evaluate(() => document.activeElement.id === 'f-name') && (await page.getAttribute('#f-name', 'aria-invalid')) === 'true' && (await page.getAttribute('#f-name', 'aria-describedby')) === 'form-msg', '提交失败聚焦出错的岗位名输入框并用 aria-describedby 关联原因');
  check(await nodeCount() === n1, '被拒绝后节点数不变');

  // 折叠 / 展开即时重排
  const beforeFold = await nodeCount(), linksBefore = await linkCount();
  await page.click('.org-node:has-text("内容部") .fold-btn');
  const afterFold = await nodeCount(), linksAfter = await linkCount();
  check(afterFold === beforeFold - 3, `折叠内容部后可见节点减少 3 (${beforeFold} -> ${afterFold})`);
  check(linksAfter === linksBefore - 3, `折叠后连线同步减少 (${linksBefore} -> ${linksAfter})`);
  check((await page.textContent('.org-node:has-text("内容部") .fold-btn')).includes('展开 3'), '折叠按钮显示隐藏数量');
  check(await page.evaluate(() => document.activeElement.classList.contains('fold-btn')), '折叠重绘后焦点留在折叠按钮上');
  const rows = await visCount('.tree-row');
  check(rows === 0, '桌面端不显示手机列表');
  await page.click('#fold-all');
  check(await nodeCount() === 5, `全部折叠后只剩根和 4 个部门 (${await nodeCount()})`);
  await page.click('#unfold-all');
  check(await nodeCount() === beforeFold, '全部展开后恢复');

  // 边界值:超长文本 + 最大数字,保存后 reload 仍在;超限被拒
  await page.click('.org-node:has-text("客服 Agent") .node-main');
  const longDuty = '长'.repeat(2000);
  await page.fill('#f-duty', longDuty);
  await page.fill('#f-weekly', '100001');
  await page.click('#btn-save');
  check((await page.textContent('#form-msg')).includes('整数'), '每周干预次数超上限被拒绝');
  await page.fill('#f-weekly', '100000');
  await page.click('#btn-save');
  await page.waitForTimeout(100);
  await page.reload();
  await page.waitForSelector('.org-node');
  check(await nodeCount() === n1, `reload 后节点数仍为 ${n1}`);
  await page.click('.org-node:has-text("客服 Agent") .node-main');
  check(await page.inputValue('#f-duty') === longDuty && await page.inputValue('#f-weekly') === '100000', '超长文本与最大数字保存后 reload 仍在');

  // 删除要页内确认,并清理引用
  await page.click('.org-node:has-text("周报 Agent") .node-main');
  await page.click('#btn-delete');
  check((await page.textContent('#delete-detail')).includes('引用会一并移除') && /\d+ 处/.test(await page.textContent('#delete-detail')), '删除前确认列出引用它的节点和处数');
  const refNodes = await nodeCount();
  await page.click('#delete-no');
  check(await nodeCount() === refNodes && await page.locator('.org-node:has-text("周报 Agent")').count() === 1, '取消删除后节点与引用保留');
  await page.click('.org-node:has-text("客服 Agent") .node-main');
  await page.click('#btn-delete');
  check(await page.isVisible('#delete-confirm'), '删除前页内确认');
  await page.click('#delete-yes');
  check(await nodeCount() === n1 - 1, '确认后节点被删除');

  /* ---- 载入示例要先确认 ---- */
  await page.click('#load-sample');
  check(await page.isVisible('#sample-confirm'), '已有数据时载入示例先出现确认');
  check(await nodeCount() === n1 - 1, '确认前保留原数据');
  await page.click('#sample-confirm-no');
  check(await nodeCount() === n1 - 1 && await page.isHidden('#sample-confirm'), '取消后原数据仍在');
  await page.click('#load-sample');
  await page.click('#sample-confirm-yes');
  check(await nodeCount() === 12, '确认后替换为示例 12 个节点');

  /* ---- 自动化度与检查 ---- */
  await tab('stats');
  check((await page.textContent('#stat-running')).trim() === '7', '在跑节点数 7');
  check((await page.textContent('#stat-ratio')).trim() === '55%', '含干预点占比 55%');
  check((await page.textContent('#stat-weekly')).trim() === '22', '每周干预合计 22');
  check((await page.textContent('#next-candidate')).includes('校对 Agent') && (await page.textContent('#next-candidate')).includes('66 天'), '下一个可去掉的干预点 = 校对 Agent(66 天)');
  check((await page.textContent('#next-candidate')).includes('符合复核条件的校对环节') && (await page.textContent('#next-candidate')).includes('核对实际的错误记录'), '候选文案改为“符合复核条件”并要求核对错误记录');
  check((await page.textContent('#tab-stats')).includes('没有质量或错误率数据'), '规则说明写明没有质量数据');
  const flow = await page.textContent('#flow-list');
  check(flow.includes('产出没人用') && flow.includes('记账 Agent'), '数据流检查:产出没人用');
  check(flow.includes('数据流环路') && flow.includes('回复 Agent') && flow.includes('周报 Agent'), '数据流检查:环路提示');
  check(await page.locator('.level-block').count() === 0, '示例没有阻断项');
  await noOverflow('桌面(自动化度)');

  /* ---- 骨架与导出 ---- */
  await tab('export');
  const preview = await page.textContent('#md-preview');
  check((preview.match(/^#{2,6} .*\/AGENT\.md$/gm) || []).length === 12 && preview.includes('## 我/AGENT.md'), '预览里 12 个 AGENT.md 段落(含根节点)');
  const [dMd] = await Promise.all([page.waitForEvent('download'), page.click('#dl-md')]);
  const mdText = fs.readFileSync(await dMd.path(), 'utf8');
  check(dMd.suggestedFilename() === 'org-skeleton.md' && mdText === preview, 'Markdown 下载内容 = 预览');
  const [dSvg] = await Promise.all([page.waitForEvent('download'), page.click('#dl-svg')]);
  const svgText = fs.readFileSync(await dSvg.path(), 'utf8');
  check((svgText.match(/class="org-node"/g) || []).length === 12 && (svgText.match(/class="org-link"/g) || []).length === 11, 'SVG 下载含 12 个节点 11 条连线');
  const [dCsv] = await Promise.all([page.waitForEvent('download'), page.click('#dl-csv')]);
  const csvText = fs.readFileSync(await dCsv.path(), 'utf8');
  check(csvText.includes('岗位') && csvText.includes('记账 Agent'), 'CSV 下载含表头与数据');
  check(csvText.includes('数据性质') && csvText.includes('合成示例') && svgText.includes('合成示例') && mdText.includes('合成示例'), '示例数据的 CSV / SVG / 骨架都标注「合成示例」'); 
  const [dJson] = await Promise.all([page.waitForEvent('download'), page.click('#dl-json')]);
  const jsonPath = path.join(TMP, 'backup.json');
  await dJson.saveAs(jsonPath);
  check(JSON.parse(fs.readFileSync(jsonPath, 'utf8')).nodes.length === 12, 'JSON 备份含 12 个节点');
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png'), fullPage: true });
  await noOverflow('桌面(骨架与导出)');

  // 导入:非法整份拒绝;合法(含悬空引用)需确认后替换,骨架被阻断
  const bad = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  bad.nodes[3].status = 'broken';
  const badPath = path.join(TMP, 'bad.json');
  fs.writeFileSync(badPath, JSON.stringify(bad));
  await page.setInputFiles('#import-file', badPath);
  await page.waitForSelector('#import-msg:not([hidden])');
  check((await page.textContent('#import-msg')).includes('整份被拒绝'), '非法状态枚举整份拒绝: ' + (await page.textContent('#import-msg')).slice(0, 50));
  const dangling = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  dangling.nodes.find(n => n.name === '校对 Agent').inputFrom.push('ghost');
  const dangPath = path.join(TMP, 'dangling.json');
  fs.writeFileSync(dangPath, JSON.stringify(dangling));
  await page.setInputFiles('#import-file', dangPath);
  await page.waitForSelector('#import-confirm:not([hidden])');
  check((await page.textContent('#import-confirm')).includes('12 个节点') && await page.evaluate(() => JSON.parse(localStorage.getItem('orgchart.v1')).nodes.length) === 12 && !(await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('orgchart.v1'))).includes('ghost'))), '导入前先确认,确认前保留原数据');
  await page.click('#import-yes');
  await page.waitForTimeout(100);
  check(await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('orgchart.v1'))).includes('ghost')), '确认后才替换为备份内容');
  check(await page.isDisabled('#dl-md') && await page.isDisabled('#copy-md'), '输入来源不存在 → 骨架导出被禁用');
  check((await page.textContent('#md-blocked')).includes('阻断'), '禁用时给出原因');
  await tab('stats');
  check(await page.locator('.level-block').count() === 1 && (await page.textContent('#flow-list')).includes('输入来源不存在'), '数据流检查出现「阻断」');
  // 悬空引用可在编辑里看到并删除,保存后骨架恢复可导出
  await tab('chart');
  await page.click('.org-node:has-text("校对 Agent") .node-main');
  check(await page.locator('#f-inputs input[data-missing="1"]').count() === 1, '编辑表单把不存在的输入来源显示为可删除项');
  await page.uncheck('#f-inputs input[data-missing="1"]');
  await page.click('#btn-save');
  await page.waitForTimeout(100);
  check(!(await page.evaluate(() => localStorage.getItem('orgchart.v1').includes('ghost'))), '取消勾选后保存,悬空引用被移除');
  await tab('export');
  check(await page.isEnabled('#dl-md') && await page.isEnabled('#copy-md'), '移除悬空引用后骨架导出恢复可用');
  // 还原示例
  await tab('chart');
  await page.click('#load-sample');
  await page.click('#sample-confirm-yes');

  /* ---- 手机端 ---- */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  check(await page.isHidden('#chart-wrap') && await page.isVisible('#tree-list'), '手机端改为纵向缩进列表');
  const rowsM = await visCount('.tree-row');
  check(rowsM === 12, `手机列表 12 行 (${rowsM})`);
  const indents = await page.$$eval('.tree-row', rs => rs.map(r => parseFloat(getComputedStyle(r).marginInlineStart)));
  check(indents[0] === 0 && indents[1] > 0 && indents[2] > indents[1], '列表按层级缩进');
  await page.click('.tree-row:has-text("内容部") .fold-btn');
  check(await visCount('.tree-row') === 9, '手机端折叠后行数减少 3');
  await page.click('#unfold-all');
  await noOverflow('手机(组织图)');
  await page.click('.tree-row:has-text("记账 Agent") .row-main');
  check((await page.textContent('#form-title')).includes('记账 Agent'), '手机端点行进入编辑');
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
  await tab('stats'); await noOverflow('手机(自动化度)');
  await tab('export'); await noOverflow('手机(骨架与导出)');
  await tab('chart');

  /* ---- 存储失败不能静默 ---- */
  const failCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await failCtx.addInitScript(() => {
    Storage.prototype.setItem = function () { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; };
  });
  const fp = await failCtx.newPage();
  fp.on('pageerror', e => problems.push('pageerror(存储失败页): ' + e.message));
  await fp.goto(URL);
  await fp.click('#load-sample');
  await fp.waitForSelector('.org-node');
  check(await fp.isVisible('#save-warning') && (await fp.textContent('#save-warning')).includes('未保存') && (await fp.textContent('#save-warning')).includes('导出'), '写入失败时持续显示「未保存」并引导导出');
  const toastTxt = (await fp.isVisible('#toast')) ? await fp.textContent('#toast') : '';
  check(!toastTxt.includes('已载入'), '写入失败时不显示成功提示');
  const [fd] = await Promise.all([fp.waitForEvent('download'), fp.click('#save-warning-export')]);
  check(fd.suggestedFilename() === 'org-backup.json', '未保存提示里的导出按钮可用');
  await failCtx.close();

  await ctx.close();

  /* ---- 展示图 ---- */
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  show.on('pageerror', e => problems.push('showcase pageerror: ' + e.message));
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(300);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });

  console.log(`断言 ${asserts} 条`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
