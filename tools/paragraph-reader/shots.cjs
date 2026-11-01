'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const BASE = 'file://' + encodeURI(path.join(__dirname, 'index.html'));
const URL = BASE + '?today=2026-10-20';
const OUT = path.join(__dirname, 'screenshots');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-shots-'));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });
  const problems = [];
  let asserts = 0;
  const check = (cond, msg) => { asserts++; console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`); if (!cond) problems.push(msg); };
  const hook = (page, tag) => {
    page.on('console', m => { if (m.type() === 'error') problems.push(`${tag} console: ${m.text()}`); });
    page.on('pageerror', e => problems.push(`${tag} pageerror: ${e.message}`));
  };

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  hook(page, 'main');
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('reader.v1')));
  const noOverflow = async label => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    check(sw <= iw, `${label}: scrollWidth ${sw} <= innerWidth ${iw}`);
  };
  const tab = async name => { await page.click(`[data-tab="${name}"]`); await page.waitForTimeout(80); };
  const selectInUnit = async needle => {
    const ok = await page.evaluate(n => {
      const el = document.getElementById('unit-text'); const tn = el.firstChild;
      const i = tn.textContent.indexOf(n); if (i < 0) return false;
      const r = document.createRange(); r.setStart(tn, i); r.setEnd(tn, i + n.length);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true;
    }, needle);
    check(ok, `正文里能选中「${needle}」`);
    await page.waitForFunction(v => document.getElementById('sel-text').value === v, needle);
  };

  // ---- 空状态 ----
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  check(await page.isVisible('#tab-library'), '空状态首屏是文本库(可直接粘贴或载入示例)');
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

  // ---- 边界值:超长文本、超长标题、超大目标数字,保存后 reload 仍在 ----
  const longBody = '很长的一句话。'.repeat(30000) + '\n\n' + 'tail words here.';
  const longTitle = '题'.repeat(3000);
  await page.fill('#text-title', longTitle);
  await page.fill('#text-body', longBody);
  await page.click('#add-text');
  await page.waitForSelector('#reader:not([hidden])');
  check((await stored()).texts[0].body.length === longBody.length, '超长正文已写入 localStorage');
  await page.reload();
  check((await page.textContent('#read-title')).length === 3000, 'reload 后超长标题与文本仍在');
  await tab('stats');
  await page.fill('#goal-min', '99999999');
  await page.fill('#break-min', '0.5');
  await page.click('#save-settings');
  await page.reload();
  await tab('stats');
  check((await page.inputValue('#goal-min')) === '99999999', '超大目标数字保存后 reload 仍在');
  // 空文本被拒绝
  await tab('library');
  await page.fill('#text-body', '   \n  ');
  await page.click('#add-text');
  check(await page.isVisible('#add-error'), '空文本被拒绝并给出原因');
  await tab('stats');
  await page.fill('#goal-min', '0');
  await page.click('#save-settings');
  check(await page.isVisible('#settings-error'), '非法目标(0)被拒绝');
  await page.fill('#goal-min', '30');
  await page.fill('#break-min', '25');
  await page.click('#save-settings');
  check((await stored()).settings.goalMin === 30, '目标改回 30');

  // ---- 载入示例不能无确认覆盖 ----
  await page.click('#load-sample');
  check(await page.isVisible('#confirm-box'), '已有用户数据时,载入示例先显示页内确认');
  check((await stored()).texts.length === 1 && !(await stored()).sample, '确认前原状态保持不变');
  await page.click('#confirm-no');
  check(!(await page.isVisible('#confirm-box')) && (await stored()).texts.length === 1, '取消后数据仍是原来的 1 篇');
  await page.click('#load-sample');
  await page.click('#confirm-yes');
  await page.waitForSelector('#reader:not([hidden])');
  const afterSample = await stored();
  check(afterSample.texts.length === 2 && afterSample.sample === true, '确认后被示例替换(2 篇文本,标注合成示例)');
  check(await page.isVisible('#sample-note'), '页面标注「合成示例」');
  check(afterSample.vocab.length === 20 && afterSample.sessions.length >= 12, `示例含 20 个生词与阅读记录(${afterSample.sessions.length} 次会话)`);

  // ---- 核心流程:计时、选词、存疑、先读过去、推进 ----
  const progress0 = await page.textContent('#read-progress');
  check(/第 5 \/ \d+ 段/.test(progress0), `示例进度位置被记住:${progress0}`);
  await page.click('#sess-toggle');
  await page.waitForTimeout(1300);
  check((await page.textContent('#sess-state')) === '计时中', '会话计时中');
  await selectInUnit('保险');
  await page.click('#add-vocab');
  await page.waitForTimeout(100);
  check((await stored()).vocab.some(v => v.word === '保险' && v.count === 1 && v.context.includes('保险')), '选中的词带上下文句加入生词表');
  await page.fill('#sel-text', '“可能”和“一定”');
  await page.fill('#sel-note', '这里的措辞是否过强?');
  await page.click('#add-doubt');
  check((await stored()).notes.some(n => n.kind === 'doubt' && n.note.includes('过强')), '存疑批注已加入');
  await page.click('#skip');
  await page.waitForTimeout(150);
  const afterSkip = await stored();
  check(afterSkip.texts[0].skips.includes('p4') && afterSkip.texts[0].pos.para === 5, '「先读过去」打标并前进到下一段');
  await page.click('#prev');
  check((await page.textContent('#unit-meta')).includes('先读过去'), '回到该段时显示「已标记:先读过去」');
  await page.waitForTimeout(1100);
  check((await page.textContent('#unit-stay')).includes('已停留'), '显示本段停留秒数');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(3500);
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png') });
  await noOverflow('桌面·阅读');
  await page.click('#next'); await page.click('#next');
  const s2 = await stored();
  check(s2.active && s2.active.events.filter(e => e.type === 'read').length === 3, '三次推进产生三条阅读事件');
  check(s2.texts[0].times.p4 > 0, `段停留时间已累计(p4=${s2.texts[0].times.p4}s)`);
  const chars = Number(await page.textContent('#st-chars')), marks = Number(await page.textContent('#st-marks'));
  check((await page.textContent('#count-rule')).includes('回退后再次推进') && (await page.textContent('.mini-stats')).includes('阅读量(中文字+英文词)'), '会话指标旁写明计数规则,单位改称「阅读量(中文字+英文词)」');
  check(chars > 0 && marks === 3, `会话字数 ${chars} > 0,标记数 ${marks} = 3`);

  // 按句模式
  await page.click('#mode-sent');
  check((await page.textContent('#read-progress')).includes('句'), '切到按句,位置换算为句');
  await page.click('#next');
  await page.click('#mode-para');
  check((await page.textContent('#read-progress')).includes('段'), '切回按段');

  // 休息提示
  await tab('stats');
  await page.fill('#break-min', '0.02');
  await page.click('#save-settings');
  await tab('read');
  await page.waitForFunction(() => !document.getElementById('break-note').hidden, null, { timeout: 5000 });
  check(true, '到点出现休息提示');
  await page.click('#break-ack');
  check(!(await page.isVisible('#break-note')), '确认后提示收起');
  await tab('stats');
  await page.fill('#break-min', '25');
  await page.click('#save-settings');

  // 结束会话
  await tab('read');
  const sessionsBefore = (await stored()).sessions.length;
  await page.click('#sess-end');
  const s3 = await stored();
  check(s3.sessions.length === sessionsBefore + 1 && s3.active === null, '结束会话后记入阅读记录');

  // 阅读中切换文章:原会话先结束并归属原文章,新会话归属新文章
  await tab('read');
  await page.click('#sess-toggle');
  await page.click('#next');
  await page.waitForTimeout(1100);
  const firstId = (await stored()).currentTextId;
  const nBefore = (await stored()).sessions.length;
  await tab('library');
  await page.click('#text-list .item:not(.current) [data-act="open"]');
  await page.waitForSelector('#reader:not([hidden])');
  const sw = await stored();
  check(sw.currentTextId !== firstId && sw.active === null && sw.sessions.length === nBefore + 1, '切换文章时原会话先结束并记录');
  const recSw = sw.sessions[sw.sessions.length - 1];
  check(recSw.textId === firstId && recSw.chars > 0, `该会话归属原文章(字数 ${recSw.chars})`);
  await page.click('#sess-toggle');
  await page.click('#next');
  await page.click('#sess-end');
  const sw2 = await stored();
  const recNew = sw2.sessions[sw2.sessions.length - 1];
  check(recNew.textId === sw2.currentTextId && recNew.textId !== firstId, '新会话归属新文章');
  await tab('library');
  await page.click(`#text-list [data-id="${firstId}"][data-act="open"]`);
  await page.waitForSelector('#reader:not([hidden])');

  // 刷新后进度与会话状态
  const p = await page.textContent('#read-progress');
  await page.reload();
  check((await page.textContent('#read-progress')) === p, `reload 后阅读进度保持:${p}`);

  // 耐力记录
  await tab('stats');
  const tiles = await page.textContent('.tiles');
  check(/连续达标\s*6 天/.test(tiles.replace(/\s+/g, ' ')) || tiles.includes('6 天'), '连续达标天数按目标 30 分钟计为 6 天');
  check((await page.$$('.daily-row')).length === 14, '最近 14 天明细');
  const dailyTxt = await page.textContent('.daily');
  check(/阅读量 \d+/.test(dailyTxt) && !/阅读量 0\s*分钟/.test(dailyTxt), '最近 14 天每行同时显示分钟和阅读量');
  check((await page.textContent('#tab-stats')).includes('中文按字、英文按词'), '最近 14 天旁写明阅读量口径');
  await noOverflow('桌面·耐力');

  // 生词表排序
  await tab('vocab');
  await page.selectOption('#vocab-sort', 'count');
  const firstWord = await page.textContent('#vocab-list .word');
  check(firstWord === '耐力', `按出现次数排序,第一个是「${firstWord}」`);
  await page.selectOption('#vocab-sort', 'recent');
  await noOverflow('桌面·生词');

  // 删除生词 / 批注:先页内确认,确认前数据不变
  const vBefore = (await stored()).vocab.length, nBefore2 = (await stored()).notes.length;
  const firstWordTxt = await page.textContent('#vocab-list .word');
  await page.click('#vocab-list [data-act="del-vocab"]');
  check(await page.isVisible('#confirm-box') && (await page.textContent('#confirm-title')).includes(firstWordTxt), '删除生词先出现页内确认并写明词');
  check((await stored()).vocab.length === vBefore, '确认之前生词数不变');
  await page.click('#confirm-no');
  check((await stored()).vocab.length === vBefore, '取消后生词保留');
  await page.click('#vocab-list [data-act="del-vocab"]');
  await page.click('#confirm-yes');
  check((await stored()).vocab.length === vBefore - 1, '确认后生词减少 1 个');
  check(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-act') === 'del-vocab'), '删除生词后焦点落在相邻条目的删除按钮');
  await page.click('#note-list [data-act="del-note"]');
  const noteConfirm = await page.textContent('#confirm-detail');
  check(await page.isVisible('#confirm-box') && noteConfirm.includes('原文摘要'), '删除批注先出现页内确认并写明摘要');
  check((await stored()).notes.length === nBefore2, '确认之前批注数不变');
  await page.click('#confirm-no');
  check((await stored()).notes.length === nBefore2, '取消后批注保留');
  await page.click('#note-list [data-act="del-note"]');
  await page.click('#confirm-yes');
  check((await stored()).notes.length === nBefore2 - 1, '确认后批注减少 1 条');

  // 公式防护:生词以 = 开头
  await tab('read');
  await page.fill('#sel-text', '=SUM(1)');
  await page.click('#add-vocab');
  await tab('export');
  const [dl1] = await Promise.all([page.waitForEvent('download'), page.click('#export-vocab')]);
  const csvPath = path.join(TMP, 'vocab.csv'); await dl1.saveAs(csvPath);
  const csv = fs.readFileSync(csvPath, 'utf8');
  check(csv.startsWith('\uFEFF词,上下文,来源,添加日期,最近出现,出现次数') && csv.includes("'=SUM(1)"), `生词 CSV 已防公式注入:${dl1.suggestedFilename()}`);
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#export-notes')]);
  const mdPath = path.join(TMP, 'notes.md'); await dl2.saveAs(mdPath);
  check(fs.readFileSync(mdPath, 'utf8').includes('这里的措辞是否过强'), `批注 Markdown 已导出:${dl2.suggestedFilename()}`);
  const [dl3] = await Promise.all([page.waitForEvent('download'), page.click('#export-sessions')]);
  const sPath = path.join(TMP, 'sessions.csv'); await dl3.saveAs(sPath);
  check(fs.readFileSync(sPath, 'utf8').split('\r\n')[0].includes('字每分钟'), `阅读记录 CSV 已导出:${dl3.suggestedFilename()}`);
  const [dl4] = await Promise.all([page.waitForEvent('download'), page.click('#export-json')]);
  const jPath = path.join(TMP, 'backup.json'); await dl4.saveAs(jPath);
  check(JSON.parse(fs.readFileSync(jPath, 'utf8')).version === 1, `JSON 备份已导出:${dl4.suggestedFilename()}`);
  check((await page.textContent('#notes-preview')).includes('批注清单'), '批注 Markdown 预览与导出一致');
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png') });
  await noOverflow('桌面·导出');

  // 导入:坏文件被拒绝且不改动;好文件需确认
  const badPath = path.join(TMP, 'bad.json');
  fs.writeFileSync(badPath, JSON.stringify({ version: 2 }));
  const before = JSON.stringify(await stored());
  await page.setInputFiles('#import-file', badPath);
  await page.waitForSelector('#import-msg:not([hidden])');
  check((await page.textContent('#import-msg')).includes('导入被拒绝') && JSON.stringify(await stored()) === before, '非法备份整份拒绝并给原因,数据未改动');
  const dupPath = path.join(TMP, 'dup.json');
  const dup = JSON.parse(fs.readFileSync(jPath, 'utf8')); dup.vocab.push({ ...dup.vocab[0], word: '另一个词' });
  fs.writeFileSync(dupPath, JSON.stringify(dup));
  await page.setInputFiles('#import-file', dupPath);
  await page.waitForFunction(() => document.getElementById('import-msg').textContent.includes('重复'));
  check(true, 'ID 重复的备份被拒绝');
  await page.setInputFiles('#import-file', jPath);
  await page.waitForSelector('#confirm-box:not([hidden])');
  check(JSON.stringify(await stored()) === before, '合法备份在确认前不改动现有数据');
  await page.click('#confirm-no');
  await page.setInputFiles('#import-file', jPath);
  await page.click('#confirm-yes');
  await page.waitForTimeout(150);
  check((await stored()).texts.length === 2, '确认后导入备份');

  // 手机
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ['library', 'vocab', 'stats', 'export']) { await tab(name); await noOverflow('手机·' + name); }
  await tab('read');
  await page.waitForTimeout(150);
  await noOverflow('手机·阅读');
  await page.waitForTimeout(3700);
  await page.addStyleTag({ content: '.reader-nav { position: static !important; }' }); // 整页截图时取消底部固定,避免浮在页面中间
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });

  // 深色模式
  await page.click('#theme-toggle');
  check((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', '深色模式可切换');
  await page.click('#theme-toggle');
  await page.close();

  // ---- ?today:合法固定,进位日期回退真实今天 ----
  const realToday = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const tp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  hook(tp, 'today');
  for (const [q, want] of [['?today=2026-10-20', '2026-10-20'], ['?today=2026-02-30', realToday], ['?today=garbage', realToday]]) {
    await tp.goto(BASE + q);
    await tp.click('[data-tab="stats"]');
    const first = await tp.textContent('.daily-row span');
    check(first === want, `${q} → 今天=${first}`);
  }
  await tp.close();

  // ---- 存储失败不能静默 ----
  const fp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  hook(fp, 'quota');
  await fp.addInitScript(() => { Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); }; });
  await fp.goto(URL);
  await fp.click('#load-sample');
  await fp.waitForSelector('#reader:not([hidden])');
  const warn = await fp.textContent('#save-warning');
  check(await fp.isVisible('#save-warning') && warn.includes('未保存'), '写入抛 QuotaExceededError → 显示「未保存」提示');
  const toastText = (await fp.isVisible('#toast')) ? await fp.textContent('#toast') : '';
  check(!toastText.includes('已载入'), '写入失败时不显示成功提示');
  await fp.click('#next');
  await fp.waitForTimeout(4200);
  check(await fp.isVisible('#save-warning'), '未保存提示持续可见(4 秒后仍在)');
  await fp.close();

  // ---- 展示图 ----
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  hook(show, 'showcase');
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(400);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();

  console.log(`断言 ${asserts} 条,问题 ${problems.length} 条`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
