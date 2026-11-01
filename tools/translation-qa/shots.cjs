'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const URL = 'file://' + encodeURI(path.join(__dirname, 'index.html'));
const OUT = path.join(__dirname, 'screenshots');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'transcheck-'));
  const browser = await chromium.launch({ executablePath: EXE });
  const problems = [];
  let asserts = 0;
  const check = (cond, msg) => { asserts++; console.log((cond ? 'OK   ' : 'FAIL ') + msg); if (!cond) problems.push(msg); };
  const watch = (page, tag) => {
    page.on('console', m => { if (m.type() === 'error') problems.push(`${tag} console: ${m.text()}`); });
    page.on('pageerror', e => problems.push(`${tag} pageerror: ${e.message}`));
  };

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  watch(page, 'main');
  const noOverflow = async label => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(`${label}: scrollWidth ${sw} <= innerWidth ${iw} → ${sw <= iw ? 'OK' : 'FAIL'}`);
    asserts++;
    if (sw > iw) problems.push(`${label} 横向溢出 ${sw} > ${iw}`);
  };
  const stat = k => page.textContent(`[data-stat="${k}"] .stat__value`);

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  check(await page.isVisible('#empty-guide'), '空状态显示引导');
  check(await page.isHidden('#results'), '空状态不显示结果');
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

  // 核心流程:载入示例 → 运行检查 → 看结果
  await page.click('#load-sample');
  check((await page.inputValue('#table-text')).includes('Hello, world!'), '载入示例后双语表有内容');
  check(await page.isHidden('#results'), '载入示例后未检查前不显示结果');
  await page.click('#run-check');
  await page.waitForSelector('.seg');
  const expected = { segments: '20', missing: '1', glossary: '2', placeholder: '1', number: '1', blocking: '3', warnings: '6' };
  for (const [k, v] of Object.entries(expected)) check((await stat(k)) === v, `统计 ${k} = ${v}`);
  const segNs = await page.$$eval('.seg', s => s.map(x => x.getAttribute('data-n')));
  check(JSON.stringify(segNs) === JSON.stringify(['5', '6', '7', '8', '9', '10', '11', '12', '17']), '有问题段落为 5,6,7,8,9,10,11,12,17:' + segNs.join(','));
  await page.selectOption('#filter', 'block');
  const blockNs = await page.$$eval('.seg', s => s.map(x => x.getAttribute('data-n')));
  check(JSON.stringify(blockNs) === JSON.stringify(['5', '6', '9']), '只看阻断为 5,6,9');
  await page.selectOption('#filter', 'all');
  check((await page.$$('.seg')).length === 20, '全部段落 20 段');
  await page.selectOption('#filter', 'issues');
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png'), fullPage: true });
  await noOverflow('桌面');

  // 导出
  const exportsOn = async () => (await Promise.all(['#export-issues-csv', '#export-issues-md', '#export-annotated'].map(s => page.isEnabled(s)))).every(Boolean);
  check(await exportsOn(), '检查后三个导出按钮可用');
  const dl = async sel => { const [d] = await Promise.all([page.waitForEvent('download'), page.click(sel)]); const p = path.join(tmp, d.suggestedFilename()); await d.saveAs(p); return [d.suggestedFilename(), fs.readFileSync(p, 'utf8')]; };
  const [n1, csv1] = await dl('#export-issues-csv');
  check(n1.endsWith('.csv') && csv1.includes('段落号,级别,类型,说明') && csv1.includes('漏译'), '问题清单 CSV 内容:' + n1);
  const [n2, md] = await dl('#export-issues-md');
  check(n2.endsWith('.md') && md.includes('# 译稿机械检查报告') && md.includes('| 9 | 阻断 | 漏译 |'), '问题清单 Markdown 内容:' + n2);
  const [n3, csv3] = await dl('#export-annotated');
  check(n3.endsWith('.csv') && csv3.includes('段落号,原文,译文,问题') && csv3.split('\r\n').length === 22, '带问题列双语表 CSV 共 20 行数据:' + n3);

  // 导出前状态必须与界面一致:改动输入后禁用导出
  await page.fill('#glossary-text', 'variable | 变量\nloop | 循环');
  check(!(await page.isEnabled('#export-issues-csv')) && !(await page.isEnabled('#export-annotated')), '改动术语表后导出禁用');
  check(await page.isVisible('#stale-note'), '改动后显示「结果已过期」提示');
  await page.click('#run-check');
  await page.waitForTimeout(100);
  check(await exportsOn(), '重新运行检查后导出恢复');
  check((await stat('glossary')) === '1', '术语表只剩 variable/loop 后术语不一致数为 1(循环,第 7 段)');
  // 载入示例前的页内确认:有现有输入时,确认前保留原状态
  const before = await page.inputValue('#glossary-text');
  await page.click('#load-sample');
  check(await page.isVisible('#sample-confirm'), '有现有输入时载入示例先显示页内确认');
  check((await page.inputValue('#glossary-text')) === before && (await page.inputValue('#table-text')).includes('Hello, world!'), '确认前双语稿与术语表保持原样');
  await page.click('#btn-sample-no');
  check(await page.isHidden('#sample-confirm') && (await page.inputValue('#glossary-text')) === before, '选择保留后内容不变');
  check(await page.isVisible('#results'), '选择保留后结果仍在');
  await page.click('#load-sample');
  await page.click('#btn-sample-yes');
  check((await page.inputValue('#glossary-text')).includes('syntax error') && await page.isHidden('#results') && await page.isHidden('#sample-confirm'), '确认替换后载入示例并清除旧结果');
  await page.click('#run-check');
  await page.waitForSelector('.seg');
  await page.evaluate(() => document.getElementById('results').scrollIntoView());
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png') });

  // 大小写开关
  await page.fill('#glossary-text', 'API | 接口');
  await page.fill('#table-text', '1\tThe api works.\t这个东西可用。\n2\tThe API works.\t这个东西可用。');
  await page.click('#run-check');
  await page.waitForSelector('.seg');
  check((await stat('glossary')) === '2', '大小写不敏感:api/API 都命中术语,共 2 条');
  await page.check('#opt-case');
  await page.click('#run-check');
  await page.waitForTimeout(100);
  check((await stat('glossary')) === '1', '开启大小写敏感后只剩 1 条');
  await page.uncheck('#opt-case');

  // 导入校验:重复段落号整份拒绝,且不显示新结果
  await page.fill('#table-text', '1\ta\t甲\n1\tb\t乙');
  await page.click('#run-check');
  check(await page.isVisible('#input-error') && (await page.textContent('#input-error')).includes('重复'), '重复段落号被拒绝并说明原因');
  await page.fill('#table-text', '1\tonly two');
  await page.click('#run-check');
  check((await page.textContent('#input-error')).includes('只有 2 列'), '列数不足被拒绝');
  // 术语表坏行拒绝
  await page.fill('#table-text', '1\ta\t甲');
  await page.fill('#glossary-text', 'no separator');
  await page.click('#run-check');
  check((await page.textContent('#input-error')).includes('术语表有 1 行不合法'), '术语表坏行阻止检查');
  await page.fill('#glossary-text', '');
  // 选项非法
  await page.fill('#opt-lo', '5');
  await page.click('#run-check');
  check((await page.textContent('#input-error')).includes('下限必须小于上限'), '长度比选项非法被拒绝');
  await page.fill('#opt-lo', '0.3');

  // 两个文本框按行对齐,行数不等
  await page.check('#mode-two');
  await page.fill('#src-text', 'Hello {0}.\nGoodbye.\nThird line.');
  await page.fill('#tgt-text', '你好 {0}。\n再见。');
  await page.click('#run-check');
  await page.waitForSelector('.seg');
  check(await page.isVisible('#align-note') && (await page.textContent('#align-note')).includes('原文 3 行,译文 2 行'), '行数不等时显示差异提示');
  check((await stat('missing')) === '1', '多出的一行按漏译计');

  // 文件导入
  await page.check('#mode-table');
  const f = path.join(tmp, 'in.csv');
  fs.writeFileSync(f, '段落号,原文,译文\n1,"Hello, you",你好\n2,Bye,再见\n');
  await page.setInputFiles('#file-import', f);
  await page.waitForSelector('#sample-confirm:not([hidden])');
  check((await page.textContent('#sample-lead')).includes('in.csv') && (await page.textContent('#sample-lead')).includes('2 段') && !(await page.inputValue('#table-text')).includes('Hello, you'), '文件导入先预览段数并确认,确认前双语表不变');
  await page.click('#btn-sample-yes');
  await page.waitForTimeout(100);
  check((await page.inputValue('#table-text')).includes('Hello, you'), '文件导入填入双语表');
  const bad = path.join(tmp, 'bad.csv');
  fs.writeFileSync(bad, '1,a,b\n1,c,d\n');
  await page.setInputFiles('#file-import', bad);
  await page.waitForTimeout(200);
  check((await page.textContent('#input-error')).includes('文件被拒绝导入'), '不合法文件被拒绝且不覆盖现有内容');
  check((await page.inputValue('#table-text')).includes('Hello, you'), '被拒绝后原内容保留');

  // 清空数据:页内确认
  await page.click('#btn-clear');
  check(await page.isVisible('#clear-confirm'), '清空前显示页内确认区');
  await page.click('#btn-clear-yes');
  check((await page.inputValue('#table-text')) === '' && await page.isHidden('#results'), '确认后清空');

  // ---- 第五轮新增断言 ----
  check(await page.isVisible('#btn-import') && await page.isVisible('#btn-import-2'), '空状态下「导入 JSON 备份」入口可见');
  check(await page.isHidden('#sample-badge'), '清空后没有合成示例标记');
  // 示例身份持续可见,并写进三种导出
  await page.click('#load-sample');
  check(await page.isVisible('#sample-badge'), '载入示例后数据区显示「合成示例」标记');
  await page.reload();
  check(await page.isVisible('#sample-badge'), '刷新后示例标记仍在');
  await page.click('#run-check');
  await page.waitForSelector('.seg');
  const [m1, c1] = await dl('#export-issues-csv');
  check(c1.split('\r\n')[0].endsWith('数据来源') && c1.split('\r\n')[1].endsWith('合成示例'), '问题清单 CSV 带「数据来源=合成示例」');
  const [m2, md2] = await dl('#export-issues-md');
  check(md2.includes('数据来源:合成示例'), '问题清单 Markdown 标注合成示例');
  const [m3, c3] = await dl('#export-annotated');
  check(c3.split('\r\n')[0].endsWith('数据来源'), '带问题列的双语表 CSV 带「数据来源」列');
  check((await page.textContent('#rows')).includes('字符') && !/\d 字[,)]/.test(await page.textContent('#rows')), '长度比说明用「字符」');
  await page.fill('#table-text', (await page.inputValue('#table-text')) + '\n');
  check(await page.isHidden('#sample-badge'), '改动双语表后示例标记消失');
  await page.click('#btn-clear');
  await page.click('#btn-clear-yes');

  // 只改了选项也要先确认
  await page.check('#opt-case');
  await page.click('#load-sample');
  check(await page.isVisible('#sample-confirm') && (await page.textContent('#sample-scope')).includes('改过的选项'), '仅改了选项时载入示例也先确认,并列明选项会恢复默认');
  await page.click('#btn-sample-no');
  check(await page.isChecked('#opt-case') && (await page.inputValue('#table-text')) === '', '取消后选项保持、没有载入');
  await page.uncheck('#opt-case');
  await page.fill('#opt-hi', '5');
  await page.click('#load-sample');
  check(await page.isVisible('#sample-confirm'), '仅改了长度比上限时载入示例也先确认');
  await page.click('#btn-sample-yes');
  check(await page.inputValue('#opt-hi') === '3', '确认后长度比恢复默认');
  await page.click('#btn-clear');
  await page.click('#btn-clear-yes');

  // 错误贴近控件
  await page.fill('#table-text', '1\thello\t你好');
  await page.fill('#glossary-text', 'no separator');
  await page.click('#run-check');
  check(await page.isVisible('#err-glossary') && (await page.textContent('#err-glossary')).includes('术语表有 1 行不合法'), '术语表错误显示在术语表输入框下方');
  check(await page.getAttribute('#glossary-text', 'aria-describedby') === 'err-glossary' && await page.evaluate(() => document.activeElement.id) === 'glossary-text', '术语表输入框关联错误并获得焦点');
  await page.fill('#glossary-text', '');
  check(await page.isHidden('#err-glossary'), '改动出错的输入框后,旁边的旧错误消失');
  await page.fill('#opt-hi', '');
  await page.fill('#table-text', '1\ta\n2\tb\tc');
  await page.click('#run-check');
  check(await page.isVisible('#err-table') && await page.isVisible('#err-ratioHigh'), '多处错误各自显示在对应输入框旁');
  check(await page.evaluate(() => document.activeElement.id) === 'table-text', '焦点落到第一个出错的输入框(DOM 顺序)');
  await page.fill('#opt-hi', '3');
  await page.fill('#opt-lo', '5');
  await page.fill('#table-text', '1\thello\t你好');
  await page.click('#run-check');
  check(await page.isVisible('#err-ratioLow') && (await page.textContent('#err-ratioLow')).includes('下限必须小于上限') && await page.evaluate(() => document.activeElement.id) === 'opt-lo', '长度比下限错误显示在下限输入旁并聚焦');
  await page.fill('#opt-lo', '0.3');
  await page.click('#run-check');
  await page.waitForSelector('.seg', { state: 'attached' }).catch(() => {});
  check((await page.textContent('#verdict')).includes('没有发现问题'), '检查完整完成且无问题时才显示「没有发现问题」');
  await page.fill('#opt-hi', '');
  await page.click('#run-check');
  check((await page.textContent('#verdict')).includes('检查未完成:1 处错误') && !(await page.textContent('#verdict')).includes('没有发现问题'), '出现输入错误时结论写「检查未完成」');
  await page.fill('#opt-hi', '3');

  // 键盘:文件选择是可聚焦按钮,Tab 到它有可见焦点样式
  await page.focus('#mode-table');
  await page.keyboard.press('Tab');
  const fileFocus = await page.evaluate(() => ({ id: document.activeElement.id, outline: getComputedStyle(document.activeElement).outlineStyle, tag: document.activeElement.tagName }));
  check(fileFocus.id === 'btn-file' && fileFocus.tag === 'BUTTON' && fileFocus.outline !== 'none', 'Tab 可到达「选择文件」按钮且有可见焦点样式');

  // JSON 备份:导出 → 非法拒绝 → 合法先预览再确认
  await page.fill('#table-text', '1\tbackup\t备份');
  const [bn, bt] = await dl('#btn-backup');
  const bj = JSON.parse(bt);
  check(bj.app === 'transcheck' && bj.version === 1 && bj.state.tableText.includes('backup'), '导出输入 JSON 备份内容正确');
  const badB = path.join(tmp, 'bad-backup.json');
  fs.writeFileSync(badB, JSON.stringify({ app: 'transcheck', version: 1, state: { mode: 'x' } }));
  await page.setInputFiles('#file-backup', badB);
  await page.waitForSelector('#import-error:not([hidden])');
  check((await page.textContent('#import-error')).includes('导入被拒绝') && (await page.inputValue('#table-text')).includes('backup'), '非法备份整份拒绝,现有内容不变');
  const goodB = path.join(tmp, 'good-backup.json');
  fs.writeFileSync(goodB, JSON.stringify({ app: 'transcheck', version: 1, state: Object.assign({}, bj.state, { tableText: '1\tfrom backup\t来自备份\n2\tsecond\t第二', glossaryText: 'a | b' }) }));
  await page.setInputFiles('#file-backup', goodB);
  await page.waitForSelector('#sample-confirm:not([hidden])');
  check((await page.textContent('#sample-lead')).includes('双语表 2 行') && (await page.textContent('#sample-scope')).includes('双语表 1 行') && (await page.inputValue('#table-text')).includes('backup') && !(await page.inputValue('#table-text')).includes('from backup'), '导入先预览行数与替换范围,确认前内容不变');
  await page.click('#btn-sample-yes');
  check((await page.inputValue('#table-text')).includes('from backup') && await page.inputValue('#glossary-text') === 'a | b', '确认后才写入备份内容');
  await page.fill('#table-text', '');
  await page.click('#btn-clear');
  await page.click('#btn-clear-yes');

  // 手机
  await page.click('#load-sample');
  await page.click('#run-check');
  await page.waitForSelector('.seg');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  await noOverflow('手机');
  const hit = await page.evaluate(() => [...document.querySelectorAll('input[type="radio"], input[type="checkbox"]')].map(el => { const r = el.getBoundingClientRect(); return [r.width, r.height, el.closest('label').getBoundingClientRect().height]; }));
  check(hit.length === 3 && hit.every(x => x[0] >= 24 && x[1] >= 24 && x[2] >= 32), '手机端 radio / checkbox 视觉 >= 24px,label 点击区高度 >= 32px');
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
  await page.close();

  // 存储失败不能静默
  const p2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(p2, 'storage');
  await p2.addInitScript(() => {
    Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
  });
  await p2.goto(URL);
  await p2.click('#load-sample');
  check(await p2.isVisible('#save-warning'), '存储写入失败时显示持续可见的「未保存」提示');
  check(await p2.isHidden('#flash'), '写入失败时不显示成功提示');
  await p2.fill('#table-text', '1\tHi\t你好');
  check(await p2.isVisible('#save-warning'), '继续输入后「未保存」提示仍在');
  await p2.close();

  // 本地数据格式不对时明说
  const p3 = await browser.newPage();
  watch(p3, 'badstate');
  await p3.goto(URL);
  await p3.evaluate(() => localStorage.setItem('transcheck.v1', JSON.stringify({ mode: 'bogus', tableText: 1 })));
  await p3.reload();
  check((await p3.textContent('#flash')).includes('格式不对'), '损坏的本地数据被拒绝并提示');
  await p3.close();

  // 展示图
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  watch(show, 'showcase');
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(400);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(`断言数:${asserts}`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
