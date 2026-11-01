'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const URL_INDEX = 'file://' + encodeURI(path.join(__dirname, 'index.html'));
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
async function tab(page, name) { await page.click(`.tab[data-view="${name}"]`); }
async function saveDownload(page, clickSel, name) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(clickSel)]);
  const p = path.join(SHOTS, '.tmp-' + name);
  await dl.saveAs(p);
  const text = fs.readFileSync(p, 'utf8');
  fs.unlinkSync(p);
  return { text, name: dl.suggestedFilename() };
}
async function stored(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('i18nkeys.v1') || 'null'));
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

    // 导入被拒绝:坏 JSON / 引号未闭合 CSV / 空文件 / 缺语言代码 / 非字符串叶子
    await page.fill('#paste-lang', 'xx');
    await page.fill('#paste-text', '{"a": ');
    await page.click('#btn-add-paste');
    check((await page.textContent('#add-error')).includes('JSON 解析失败'), '坏 JSON 被拒绝并说明原因');
    await page.fill('#paste-text', 'key,zh,en\na,"未闭合,b');
    await page.click('#btn-add-paste');
    check((await page.textContent('#add-error')).includes('引号未闭合'), 'CSV 引号未闭合整份拒绝');
    await page.fill('#paste-text', '   ');
    await page.click('#btn-add-paste');
    check((await page.textContent('#add-error')).includes('文件为空'), '空文件被拒绝');
    await page.fill('#paste-lang', '');
    await page.fill('#paste-text', '{"a":"b"}');
    await page.click('#btn-add-paste');
    check((await page.textContent('#add-error')).includes('语言代码'), '缺语言代码被拒绝');
    await page.fill('#paste-lang', 'xx');
    await page.fill('#paste-text', '{"a": 1}');
    await page.click('#btn-add-paste');
    check((await page.textContent('#add-error')).includes('不是字符串'), '非字符串叶子被拒绝');
    check((await stored(page)) === null || (await stored(page)).files.length === 0, '被拒绝的导入没有写入状态');

    // 空库里改了设置 / 有未提交草稿时,载入示例也要先确认
    await page.fill('#opt-allow-same', 'brand.*');
    await page.click('#btn-sample');
    check(await page.isVisible('#replace-confirm') && (await page.textContent('#replace-title')).includes('核对设置'), '空库但设置已修改时,载入示例先确认并写明设置');
    await page.click('#btn-replace-no');
    check((await stored(page)).options.allowSame.length === 1, '取消后保留已修改的设置');
    await page.click('#btn-opt-reset');
    await page.fill('#paste-text', '{"draft":"x"}');
    await page.click('#btn-sample');
    check(await page.isVisible('#replace-confirm') && (await page.textContent('#replace-title')).includes('草稿'), '有未提交粘贴草稿时,载入示例先确认并写明草稿');
    await page.click('#btn-replace-no');
    check((await page.inputValue('#paste-text')) === '{"draft":"x"}', '取消后草稿保留');
    await page.fill('#paste-text', '');
    // 文件选择入口是可聚焦按钮,键盘可达
    const pickInfo = await page.evaluate(() => ['btn-pick-add', 'btn-pick-backup'].map((id) => document.getElementById(id).tagName));
    check(pickInfo.every((t) => t === 'BUTTON'), '文件选择入口是 button(可聚焦)');
    await page.focus('#btn-pick-add');
    const ring = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0; });
    check(ring, '键盘聚焦「选择语言文件」按钮时有可见焦点环');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Enter')]);
    check(!!chooser, '在按钮上按 Enter 打开文件选择');

    // 手动粘贴一个小流程:properties + 嵌套 JSON
    await page.fill('#paste-lang', 'zh');
    await page.fill('#paste-text', '# 源\nnav.home=首页\nnav.back=返回\nmsg.hello=你好 {name}\n');
    await page.click('#btn-add-paste');
    check((await page.textContent('#file-list')).includes('.properties'), 'properties 文件已导入');
    await page.fill('#paste-lang', 'en');
    await page.fill('#paste-text', '{"nav":{"home":"Home"},"msg":{"hello":"Hello"}}');
    await page.click('#btn-add-paste');
    await tab(page, 'issues');
    const t0 = await page.textContent('#issues-table');
    check(t0.includes('nav.back') && t0.includes('缺键') && t0.includes('占位符不一致'), '小流程查出缺键与占位符不一致');

    // 载入示例前有数据:出现替换确认,取消保留原状态
    await page.click('#btn-sample');
    check(await page.isVisible('#replace-confirm'), '已有数据时载入示例先出现页内替换确认');
    check((await stored(page)).files.length === 2, '确认之前保留原状态(2 份文件)');
    await page.click('#btn-replace-no');
    check(!(await page.isVisible('#replace-confirm')) && (await stored(page)).files.length === 2, '取消后保留原状态');
    await page.click('#btn-sample');
    await page.click('#btn-replace-yes');
    check((await page.textContent('#flash')).includes('合成示例'), '确认替换后载入示例并提示合成示例');
    check((await stored(page)).files.length === 3, '示例已写入 3 份文件');

    // 核对结果
    await tab(page, 'issues');
    const issueText = await page.textContent('#issues-table');
    for (const k of ['缺键', '多键', '值为空', '占位符不一致', 'HTML 标签不一致', '疑似未翻译', '长度比异常', '键名不规范', '复数形式不完整', '同源异译']) {
      check(issueText.includes(k), `问题列表含「${k}」`);
    }
    const basisTxt = await page.textContent('#sum-basis');
    check(basisTxt.includes('不是互补关系') && basisTxt.includes('源语言键数') && basisTxt.includes('复数'), '覆盖率与未译率旁写明口径、非互补关系与复数处理');
    check(await page.isVisible('#sum-basis'), '口径说明可见');
    const statsText = await page.textContent('#lang-stats');
    check(statsText.includes('en') && statsText.includes('ja') && statsText.includes('覆盖率'), '语言统计表含 en / ja 与覆盖率');
    check((await page.textContent('#sum-coverage')).includes('%'), '整体覆盖率显示');
    check(Number(await page.getAttribute('#sum-bar', 'aria-valuenow')) > 50, '整体进度条有数值');
    await page.selectOption('#f-level', 'block');
    await page.selectOption('#f-lang', 'ja');
    const blockJa = await page.textContent('#issues-table');
    check(blockJa.includes('HTML 标签不一致') && !blockJa.includes('长度比异常'), '按级别与语言筛选');
    await page.selectOption('#f-level', '');
    await page.selectOption('#f-lang', '');
    await overflow(page, '桌面-问题');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(SHOTS, '02-核心流程-桌面.png') });

    // 键矩阵
    await tab(page, 'matrix');
    await page.check('#m-only-issues');
    const matrixText = await page.textContent('#matrix-table');
    check(matrixText.includes('缺键') && matrixText.includes('notes.tags.limit'), '键矩阵显示缺键');
    await page.fill('#m-filter', 'billing');
    const mrows = await page.locator('#matrix-table tbody tr').count();
    check(mrows >= 1 && mrows <= 6, `键矩阵按键名筛选(${mrows} 行)`);
    await page.fill('#m-filter', '');
    await page.uncheck('#m-only-issues');
    await overflow(page, '桌面-键矩阵');

    // 设置:允许相同键、键名正则
    await tab(page, 'files');
    const sameBefore = Number((await page.textContent('#issue-count')));
    await page.fill('#opt-allow-same', 'brand.*\napp.tagline\nsettings.themeDark');
    const sameAfter = Number((await page.textContent('#issue-count')));
    check(sameAfter === sameBefore - 2, `允许相同键后问题数 -2(${sameBefore} -> ${sameAfter})`);
    await page.fill('#opt-key-pattern', '(');
    check(await page.isVisible('#opt-error'), '非法正则显示错误且不应用');
    check((await stored(page)).options.keyPattern.length > 1, '非法正则没有写入状态');
    await page.fill('#opt-key-pattern', '');
    check((await stored(page)).options.keyPattern === '', '清空正则后关闭键名检查');
    await page.click('#btn-opt-reset');

    // 边界值:超长文本 + __proto__ 键,保存后 reload 仍在
    const longVal = 'é'.repeat(60000);
    await page.fill('#paste-lang', 'de');
    await page.fill('#paste-text', JSON.stringify({ __proto__: undefined, nav: { home: 'Startseite' } }).replace('{"nav"', '{"__proto__":{"x":"y"},"long":' + JSON.stringify(longVal) + ',"nav"'));
    await page.click('#btn-add-paste');
    check(!(await page.isVisible('#save-warning')), '超长文本保存成功,无未保存提示');
    await page.reload();
    check((await page.textContent('#file-list')).includes('de'), 'reload 后超长文本的 de 文件仍在');
    const st = await stored(page);
    const de = st.files.find((f) => f.lang === 'de');
    check(de && de.entries.some((e) => e[0] === '__proto__.x') && de.entries.find((e) => e[0] === 'long')[1].length === 60000, 'reload 后 __proto__ 键与 60000 字符的值完整');
    // 移除 de,避免影响后面统计
    await page.click('[data-remove="de"]');
    const delTxt = await page.textContent('.file-card__confirm');
    check(delTxt.includes('de') && /\d+ 个键/.test(delTxt), '移除前页内确认写明语言与键数');
    check((await stored(page)).files.length === 4, '确认移除之前数据不变(4 份文件)');
    await page.click('[data-remove-yes="de"]');
    check((await stored(page)).files.length === 3, '确认后移除 de,回到 3 份文件');
    // 移除源语言:确认文案写明新的源语言;取消则不变
    await page.click('[data-remove="zh"]');
    check((await page.textContent('.file-card__confirm')).includes('源语言会改为 en'), '移除源语言的确认写明之后选用的源语言(en)');
    check(await page.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-remove-yes')), '打开移除确认后焦点落在确认按钮');
    await page.click('.file-card__confirm >> text=取消');
    check((await stored(page)).source === 'zh' && (await stored(page)).files.length === 3, '取消移除后源语言与文件不变');
    check(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-remove') === 'zh'), '取消后焦点回到该文件的移除按钮');

    // 修复与导出
    await tab(page, 'export');
    const todoInfo = await page.textContent('#todo-info');
    check(/需要翻译/.test(todoInfo), '待翻译表提示需要翻译的键数');
    const todo = await saveDownload(page, '#btn-todo', 'todo.csv');
    const todoLines = todo.text.replace(/^﻿/, '').split('\n');
    check(todoLines[0] === 'key,source:zh,en,ja', `待翻译表表头(${todoLines[0]})`);
    check(todo.text.includes('notes.tags.limit') && todo.text.includes('auth.login.forgot') && todo.text.includes('billing.failed'), '待翻译表含缺键与空值键');

    // 合并:en 填 notes.tags.limit(缺键)与 auth.login.forgot(空值),同时试图改已有的 nav.home
    const mergeCsv = 'key,source:zh,en\nnotes.tags.limit,x,Up to {max} tags\nauth.login.forgot,x,Forgot password?\nnav.home,x,SHOULD-NOT-WIN\n';
    await page.fill('#merge-text', mergeCsv);
    await page.click('#btn-merge-preview');
    const prev1 = await page.textContent('#merge-preview');
    check(prev1.includes('将填入 2') && prev1.includes('保留 1'), '默认合并预览:填入 2 个,保留 1 个已有值');
    // 改了文本后预览必须失效
    await page.fill('#merge-text', mergeCsv + '\n');
    check(!(await page.isVisible('#merge-preview')), '合并文本改动后预览失效');
    await page.click('#btn-merge-preview');
    // 选择新的 CSV 文件后旧预览必须立即失效
    const other = path.join(SHOTS, '.tmp-merge2.csv');
    fs.writeFileSync(other, 'key,en\nnav.back,Back2\n');
    await page.setInputFiles('#file-merge', other);
    await page.waitForFunction(() => document.getElementById('merge-text').value.includes('Back2'));
    check(!(await page.isVisible('#merge-preview')) && (await page.locator('text=应用合并').count()) === 0, '选择新合并文件后旧预览失效且无「应用合并」按钮');
    fs.unlinkSync(other);
    await page.fill('#merge-text', mergeCsv);
    await page.click('#btn-merge-preview');
    await page.click('text=应用合并');
    const en = (await stored(page)).files.find((f) => f.lang === 'en');
    const enMap = Object.fromEntries(en.entries);
    check(enMap['notes.tags.limit'] === 'Up to {max} tags' && enMap['auth.login.forgot'] === 'Forgot password?', '合并填入缺键与空值');
    check(enMap['nav.home'] === 'Home', '默认合并不覆盖已有值');
    const keysOrder = en.entries.map((e) => e[0]);
    check(keysOrder.indexOf('notes.tags.limit') > keysOrder.indexOf('notes.delete.done') && keysOrder.indexOf('notes.tags.limit') < keysOrder.indexOf('notes.share.title'), '新键按源语言顺序插入');
    // 合并后 en 的缺键/空值消失
    const cnt = await page.textContent('#issue-count');
    check(Number(cnt) > 0, `合并后问题数更新(${cnt})`);
    // 非法合并整份拒绝
    await page.fill('#merge-text', 'key,fr\na,b');
    await page.click('#btn-merge-preview');
    check((await page.textContent('#merge-error')).includes('不是已导入的语言'), '未知语言列的合并整份拒绝');
    await page.fill('#merge-text', 'key,en\nnav.home,"未闭合');
    await page.click('#btn-merge-preview');
    check((await page.textContent('#merge-error')).includes('引号未闭合'), '合并 CSV 引号未闭合整份拒绝');
    await page.fill('#merge-text', '');

    // 覆盖模式
    await page.fill('#merge-text', 'key,en\nnav.home,Homepage\n');
    await page.check('#merge-overwrite');
    await page.click('#btn-merge-preview');
    check((await page.textContent('#merge-preview')).includes('覆盖 1'), '覆盖模式预览显示覆盖 1 个');
    await page.click('text=应用合并');
    check(Object.fromEntries((await stored(page)).files.find((f) => f.lang === 'en').entries)['nav.home'] === 'Homepage', '覆盖模式覆盖已有值');
    await page.uncheck('#merge-overwrite');

    // 报告与 JSON 导出
    const md = await saveDownload(page, '#btn-report-md', 'report.md');
    check(md.name.endsWith('.md') && md.text.includes('## 各语言统计') && md.text.includes('## 阻断'), '导出 Markdown 报告');
    const rcsv = await saveDownload(page, '#btn-report-csv', 'report.csv');
    check(rcsv.text.replace(/^﻿/, '').startsWith('级别,语言,键,类型,说明,源文本,当前译文'), '导出 CSV 报告表头');
    const enJson = await saveDownload(page, 'text=下载 en.json', 'en.json');
    const enObj = JSON.parse(enJson.text);
    check(enObj.nav && enObj.nav.home === 'Homepage' && Object.keys(enObj)[0] === 'app', '导出 en.json 保持嵌套结构与键顺序');
    check(Object.keys(enObj.notes).indexOf('create') < Object.keys(enObj.notes).indexOf('tags'), '导出的嵌套键顺序与源一致(create 在 tags 前)');
    await overflow(page, '桌面-导出');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(SHOTS, '03-结果与导出-桌面.png'), fullPage: true });

    // 公式防护:译文以 = 开头
    await tab(page, 'files');
    await page.fill('#paste-lang', 'fr');
    await page.fill('#paste-text', '{"nav":{"home":"=HYPERLINK(\\"http://x\\")","back":"+1 retour"}}');
    await page.click('#btn-add-paste');
    await tab(page, 'export');
    const rcsv2 = await saveDownload(page, '#btn-report-csv', 'report2.csv');
    check(rcsv2.text.includes("'=HYPERLINK") && !/(^|,|\n)"?=HYPERLINK/.test(rcsv2.text), '报告 CSV 对 = 开头的译文加单引号前缀');
    const todoSameBox = page.locator('#todo-same');
    await todoSameBox.check();
    const todo2 = await saveDownload(page, '#btn-todo', 'todo2.csv');
    check(todo2.text.split('\n')[0].replace(/^﻿/, '') === 'key,source:zh,en,ja,fr', '加入 fr 后待翻译表多一列');

    // 备份导入:非法被拒绝;合法且已有数据时先确认
    const bad = path.join(SHOTS, '.tmp-bad.json');
    fs.writeFileSync(bad, JSON.stringify({ v: 1, source: 'zh', files: [{ lang: 'zh', format: 'xml', nested: false, entries: [] }], options: { allowSame: [], keyPattern: '' } }));
    await page.setInputFiles('#file-backup', bad);
    await page.waitForFunction(() => document.getElementById('flash').textContent.includes('备份导入被拒绝'));
    check((await page.textContent('#flash')).includes('备份导入被拒绝'), '非法备份(枚举值错)被整份拒绝');
    check((await stored(page)).files.length === 4, '被拒绝的备份没有改动现有状态');
    fs.unlinkSync(bad);
    // 合法备份:已有数据时先确认,取消后保留
    const bk = await saveDownload(page, '#btn-backup', 'backup.json');
    const bkPath = path.join(SHOTS, '.tmp-backup.json');
    fs.writeFileSync(bkPath, bk.text);
    await page.setInputFiles('#file-backup', bkPath);
    await page.waitForSelector('#replace-confirm:not([hidden])');
    check((await page.textContent('#replace-title')).includes('导入备份会替换'), '导入合法备份时已有数据先出现替换确认');
    await page.click('#btn-replace-no');
    check((await stored(page)).files.length === 4, '取消后保留现有 4 份文件');
    fs.unlinkSync(bkPath);

    // 清空
    await page.click('#btn-clear');
    check(await page.isVisible('#clear-confirm'), '清空前出现页内确认区');
    await page.click('#btn-clear-yes');
    await tab(page, 'files');
    check(await page.isVisible('#empty-guide'), '清空后回到空状态');
    await ctx.close();

    /* ---------- 文件选择导入(多文件,语言从文件名推断) ---------- */
    const fctx0 = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const fp = await fctx0.newPage();
    watch(fp, 'file-import');
    await fp.goto(URL_INDEX);
    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'i18n-shots-'));
    fs.writeFileSync(path.join(tmpDir, 'zh.json'), '{"a":"甲","b":"乙 {n}"}');
    fs.writeFileSync(path.join(tmpDir, 'messages_en.properties'), 'a=A\nb=B\n');
    await fp.setInputFiles('#file-add', [path.join(tmpDir, 'zh.json'), path.join(tmpDir, 'messages_en.properties')]);
    await fp.waitForSelector('.file-card');
    check((await fp.locator('.file-card').count()) === 2, '多文件选择导入 2 份(zh / en 由文件名推断)');
    await tab(fp, 'issues');
    check((await fp.textContent('#issues-table')).includes('占位符不一致'), '文件导入后核对出占位符不一致');
    fs.writeFileSync(path.join(tmpDir, 'my-app.json'), '{"a":"b"}');
    await tab(fp, 'files');
    await fp.setInputFiles('#file-add', [path.join(tmpDir, 'my-app.json')]);
    await fp.waitForSelector('#add-error:not([hidden])');
    check((await fp.textContent('#add-error')).includes('无法从文件名'), '无法推断语言时整批拒绝并提示');
    fs.writeFileSync(path.join(tmpDir, 'multi.csv'), 'key,zh,fr\nnav.home,首页,Accueil\n');
    await fp.setInputFiles('#file-add', [path.join(tmpDir, 'multi.csv')]);
    await fp.waitForTimeout(200);
    check((await fp.textContent('#add-error')).includes('已存在'), 'CSV 语言列与已有语言冲突时整份拒绝');
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await fctx0.close();

    /* ---------- 存储写入失败 ---------- */
    const sctx0 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await sctx0.addInitScript(() => {
      Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
    });
    const f = await sctx0.newPage();
    watch(f, 'storage-fail');
    await f.goto(URL_INDEX);
    await f.click('#btn-sample');
    check(await f.isVisible('#save-warning'), '存储写入失败时显示持续可见的「未保存」提示');
    check(!(await f.isVisible('#flash')), '存储写入失败时不显示成功提示');
    await sctx0.close();

    /* ---------- 手机 ---------- */
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const m = await mctx.newPage();
    watch(m, 'mobile');
    await m.goto(URL_INDEX);
    await overflow(m, '手机-空状态');
    await m.click('#btn-sample-2');
    await overflow(m, '手机-问题');
    const stacked = await m.evaluate(() => {
      const th = document.querySelector('.data-table thead');
      const td = document.querySelector('.data-table tbody td');
      return { head: getComputedStyle(th).display, cell: getComputedStyle(td).display };
    });
    check(stacked.head === 'none' && stacked.cell === 'grid', `手机端表格堆叠(thead=${stacked.head}, td=${stacked.cell})`);
    await m.screenshot({ path: path.join(SHOTS, '04-手机.png'), fullPage: true });
    for (const v of ['matrix', 'export', 'files']) { await tab(m, v); await overflow(m, '手机-' + v); }
    await tab(m, 'matrix');
    const label = await m.evaluate(() => document.querySelector('#matrix-table tbody td:nth-child(2)').getAttribute('data-label'));
    check(label === 'zh', `手机端键矩阵单元格带语言标签(${label})`);
    await mctx.close();

    /* ---------- 展示图 ---------- */
    const hctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    const s = await hctx.newPage();
    watch(s, 'showcase');
    await s.goto(URL_SHOWCASE);
    await s.waitForLoadState('load');
    const imgs = await s.evaluate(() => Array.from(document.images).map((i) => i.complete && i.naturalWidth > 0));
    check(imgs.length >= 3 && imgs.every(Boolean), `展示页 ${imgs.length} 张截图全部加载`);
    await overflow(s, '展示页');
    await s.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
    await hctx.close();
  } catch (e) {
    problems.push('脚本异常:' + (e && e.stack || e));
  } finally {
    await browser.close();
  }
  console.log('\n' + results.join('\n'));
  console.log('断言数:' + asserts);
  if (problems.length) {
    console.error('\n共 ' + problems.length + ' 个问题:\n' + problems.join('\n'));
    process.exit(1);
  }
  console.log('\n全部通过');
})();
