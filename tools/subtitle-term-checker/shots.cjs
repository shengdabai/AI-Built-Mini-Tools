'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const URL = 'file://' + encodeURI(path.join(__dirname, 'index.html'));
const OUT = path.join(__dirname, 'screenshots');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });
  const problems = [];
  let asserts = 0;
  const check = (cond, msg) => { asserts++; if (!cond) problems.push('断言失败:' + msg); };
  const watch = (page, tag) => {
    page.on('console', m => { if (m.type() === 'error') problems.push(`${tag} console: ${m.text()}`); });
    page.on('pageerror', e => problems.push(`${tag} pageerror: ${e.message}`));
  };
  const noOverflow = async (page, label) => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(`${label}: scrollWidth ${sw} <= innerWidth ${iw} -> ${sw <= iw ? 'OK' : 'FAIL'}`);
    check(sw <= iw, `${label} 横向溢出 ${sw} > ${iw}`);
  };
  const readDownload = async dl => fs.readFileSync(await dl.path(), 'utf8');

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  watch(page, '主页面');
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  check(await page.isVisible('#empty-guide'), '空状态引导可见');
  check(await page.isHidden('#results'), '空状态不显示结果');
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });

  // 核心流程:载入示例 → 检查 → 逐条接受/跳过
  await page.click('#load-sample');
  await page.waitForSelector('.issue');
  const total = await page.locator('.issue').count();
  const terms = await page.locator('.issue [data-act="accept"]').count();
  console.log(`问题总数 ${total},术语问题 ${terms}`);
  check(await page.isVisible('#sample-badge'), '载入示例后持续显示「合成示例」标记');
  check(total === 10, `示例应有 10 个问题,实际 ${total}`);
  check(terms === 6, `示例应有 6 个术语问题,实际 ${terms}`);
  check((await page.locator('.cue').count()) === 14, '预览应有 14 条字幕');
  for (const label of ['术语错写', '大小写/全半角变体', '与下一条重叠', '时长过短', '字速过快', '行数过多']) {
    check((await page.locator('#issue-list .badge', { hasText: label }).count()) > 0, `问题列表缺少「${label}」`);
  }
  const firstId = await page.locator('#issue-list [data-act="accept"]').nth(0).getAttribute('data-id');
  await page.locator('#issue-list [data-act="accept"]').nth(0).click();
  const foc1 = await page.evaluate(() => ({ id: document.activeElement.dataset.id, act: document.activeElement.dataset.act }));
  check(foc1.id === firstId && foc1.act === 'accept', `接受后重绘,焦点仍在同一问题的「接受」按钮(${JSON.stringify(foc1)})`);
  await page.locator('#issue-list [data-act="skip"]').nth(1).click();
  check((await page.locator('.cue span.fixed').count()) === 1, '预览应显示 1 处已接受替换');
  check((await page.locator('.cue mark.hit.is-skipped').count()) === 1, '预览应显示 1 处已跳过');
  await page.locator('#issue-list .goto').nth(3).click();
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png') });

  // 刷新后接受/跳过选择与「合成示例」标记仍在
  await page.reload();
  await page.waitForSelector('.issue');
  check((await page.locator('.cue span.fixed').count()) === 1 && (await page.locator('.cue mark.hit.is-skipped').count()) === 1, '刷新后接受/跳过选择仍在');
  check(await page.isVisible('#sample-badge'), '刷新后「合成示例」标记仍在');
  const [dlS] = await Promise.all([page.waitForEvent('download'), page.click('#export-md')]);
  check((await readDownload(dlS)).includes('数据来源:合成示例'), '合成示例的问题报告 Markdown 标注数据来源');
  const [dlSc] = await Promise.all([page.waitForEvent('download'), page.click('#export-csv')]);
  check((await readDownload(dlSc)).includes(',数据来源'), '合成示例的问题报告 CSV 带数据来源列');

  // 已有数据时载入示例要先确认,写明替换范围与接受/跳过记录
  await page.click('#load-sample');
  const sc = await page.textContent('#sample-confirm-scope');
  check(await page.isVisible('#sample-confirm') && sc.includes('接受/跳过') , `有接受/跳过记录时载入示例先确认(${sc})`);
  await page.click('#sample-confirm-no');
  check(await page.isHidden('#sample-confirm') && (await page.locator('.cue span.fixed').count()) === 1, '取消后接受/跳过记录不变');
  await noOverflow(page, '桌面');

  // 改动输入后结果过期:导出禁用并提示
  await page.fill('#glossary-text', (await page.inputValue('#glossary-text')) + '\n字幕');
  check(await page.isHidden('#sample-badge'), '改动术语表后「合成示例」标记消失');
  check(await page.isVisible('#stale-note'), '输入改动后应显示过期提示');
  check(await page.isDisabled('#export-fixed') && await page.isDisabled('#export-md') && await page.isDisabled('#export-csv'), '过期时三个导出应禁用');
  check((await page.textContent('#export-note')).includes('请先点「检查字幕」'), '过期时导出区应提示重新检查');
  await page.click('#run-check');
  check(await page.isHidden('#stale-note'), '重新检查后过期提示消失');
  check(await page.isEnabled('#export-fixed'), '重新检查后可导出');

  // 选项不合法:错误显示在输入旁,不检查,不静默使用默认值
  const summaryBefore = await page.textContent('#summary');
  await page.fill('#opt-cps', '0');
  await page.click('#run-check');
  check(await page.isVisible('#opt-cps-err') && (await page.textContent('#opt-cps-err')).includes('大于 0'), '字速上限填 0 时在输入旁显示错误');
  check((await page.getAttribute('#opt-cps', 'aria-invalid')) === 'true' && (await page.getAttribute('#opt-cps', 'aria-describedby')) === 'opt-cps-err', '出错输入标记 aria-invalid 并用 aria-describedby 关联错误');
  check((await page.evaluate(() => document.activeElement.id)) === 'opt-cps', '提交失败后焦点移到第一个出错输入');
  check((await page.textContent('#status')).includes('没有开始检查') && (await page.textContent('#summary')) === summaryBefore, '选项不合法时停止检查,结果保持上一次');
  await page.fill('#opt-cps', '-5');
  check((await page.textContent('#opt-cps-err')).includes('-5'), '负数同样报错');
  await page.fill('#opt-cps', '20');
  check(await page.isHidden('#opt-cps-err'), '改回合法值后错误消失');
  await page.click('#run-check');

  // 「未处理」筛选下接受一条,焦点转到下一条待处理问题
  await page.selectOption('#issue-filter', 'pending');
  const pendBefore = await page.locator('#issue-list [data-act="accept"]').count();
  const pendId = await page.locator('#issue-list [data-act="accept"]').nth(0).getAttribute('data-id');
  await page.locator('#issue-list [data-act="accept"]').nth(0).click();
  const foc2 = await page.evaluate(() => ({ id: document.activeElement.dataset.id, act: document.activeElement.dataset.act }));
  check((await page.locator('#issue-list [data-act="accept"]').count()) === pendBefore - 1 && foc2.id && foc2.id !== pendId && foc2.act === 'accept', `「未处理」筛选下接受后焦点转到下一条待处理问题(${JSON.stringify(foc2)})`);
  await page.selectOption('#issue-filter', 'all');

  // 一键接受全部 → 导出修正后的 SRT、Markdown、CSV
  await page.click('#accept-all');
  const [dlSrt] = await Promise.all([page.waitForEvent('download'), page.click('#export-fixed')]);
  const srt = await readDownload(dlSrt);
  console.log('下载:', dlSrt.suggestedFilename());
  check(dlSrt.suggestedFilename().endsWith('.srt'), 'SRT 输入应导出 .srt');
  check(!srt.includes('拼因') && srt.includes('拼音入门课'), '导出应已替换拼因');
  check(srt.includes('GitHub 管理') && srt.includes('your GitHub account') && srt.includes('写成 Markdown') && srt.includes('HSK 一级') && srt.includes('声调符号'), '导出应含全部接受的替换');
  check(srt.includes('00:00:15,200 --> 00:00:19,000') && srt.includes('00:00:18,500 --> 00:00:21,000'), '重叠的时间轴必须原样保留');
  check(srt.includes('\n8\n00:00:21,200 --> 00:00:21,600\n'), '序号与 0.4 秒时间轴必须原样保留');
  const [dlMd] = await Promise.all([page.waitForEvent('download'), page.click('#export-md')]);
  const md = await readDownload(dlMd);
  check(md.includes('| 序号 | 时间 | 类型 | 原文 | 建议 |') && md.includes('共 10 条问题'), 'Markdown 报告结构');
  const [dlCsv] = await Promise.all([page.waitForEvent('download'), page.click('#export-csv')]);
  const csv = await readDownload(dlCsv);
  check(csv.split('\n').length >= 11 && csv.includes('术语错写'), 'CSV 报告行数');
  await page.locator('.export').scrollIntoViewIfNeeded();
  await page.evaluate(() => document.querySelector('.export').scrollIntoView({ block: 'end' }));
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png') });

  // VTT 文件上传 → 导出保持 VTT
  const vtt = 'WEBVTT\n\nNOTE 合成\n\nintro\n00:00:01.000 --> 00:00:03.000\n今天学拼因\n\n00:00:03.500 --> 00:00:05.000\nok\n';
  await page.setInputFiles('#subtitle-file', { name: 'demo.vtt', mimeType: 'text/vtt', buffer: Buffer.from(vtt, 'utf8') });
  await page.waitForSelector('#summary :text("WebVTT")');
  await page.click('#accept-all');
  const [dlVtt] = await Promise.all([page.waitForEvent('download'), page.click('#export-fixed')]);
  const vttOut = await readDownload(dlVtt);
  check(dlVtt.suggestedFilename() === 'demo-已校对.vtt', `VTT 文件名 ${dlVtt.suggestedFilename()}`);
  check(vttOut.startsWith('WEBVTT\n\n') && vttOut.includes('intro\n00:00:01.000 --> 00:00:03.000\n今天学拼音'), 'VTT 导出保持格式、标识与点号毫秒');

  // 解析错误:定位行号,导出修正后的字幕被禁用
  await page.fill('#subtitle-text', '1\n00:00:01,000 --> 00:00:03,000\n好\n\n2\n00:00:0x,000 --> 00:00:05,000\n坏\n');
  await page.click('#run-check');
  const errText = await page.textContent('#parse-errors');
  check(errText.includes('字幕第 6 行'), `解析错误应定位到第 6 行,实际:${errText}`);
  check((await page.textContent('#summary')).includes('检查未完成:1 处解析错误') && !(await page.textContent('#summary')).includes('没有发现问题'), '部分解析错误时汇总显示「检查未完成:1 处解析错误」'); 
  check(await page.isDisabled('#export-fixed'), '有解析错误时导出修正后的字幕应禁用');
  check(await page.isEnabled('#export-md'), '有解析错误时报告仍可导出');
  const [dlErr] = await Promise.all([page.waitForEvent('download'), page.click('#export-md')]);
  const errMd = await readDownload(dlErr);
  check(errMd.includes('解析错误') && errMd.includes('| 字幕 | 6 |') && !errMd.includes('未发现问题。'), '报告应含解析错误与行号');
  const [dlErrCsv] = await Promise.all([page.waitForEvent('download'), page.click('#export-csv')]);
  check((await readDownload(dlErrCsv)).includes('字幕第 6 行'), 'CSV 应含解析错误与行号');
  await page.fill('#subtitle-text', '1\n00:00:0x,000 --> 00:00:03,000\n全坏\n');
  await page.click('#run-check');
  const failSummary = await page.textContent('#summary');
  check(failSummary.includes('检查未完成') && !failSummary.includes('没有发现问题') && (await page.textContent('#issue-list')).includes('检查未完成'), `全部解析失败时显示「检查未完成」而不是「没有发现问题」(${failSummary})`);
  await page.fill('#subtitle-text', '1\n00:00:01,000 --> 00:00:03,000\n流程 A --> B\n<i>你好</i>\n');
  await page.fill('#glossary-text', '斜体 | i');
  await page.click('#run-check');
  check((await page.locator('#parse-errors:visible').count()) === 0 && (await page.locator('.issue').count()) === 0, '正文箭头与标签不应产生问题');

  // 载入示例前确认(仅有字幕与术语表时同样要确认)
  await page.click('#load-sample');
  check(await page.isVisible('#sample-confirm') && (await page.textContent('#sample-confirm-scope')).includes('字幕') && (await page.textContent('#sample-confirm-scope')).includes('术语表'), '已有字幕和术语表时载入示例先确认并写明范围');
  check((await page.inputValue('#glossary-text')) === '斜体 | i', '确认前原数据不变');
  await page.click('#sample-confirm-no');

  // 清空要先确认
  await page.click('#clear-data');
  check(await page.isVisible('#clear-confirm') && (await page.textContent('#clear-confirm-scope')).includes('字幕') , '清空前应出现确认区并写明范围');
  await page.click('#clear-confirm-yes');
  check((await page.inputValue('#subtitle-text')) === '' && await page.isVisible('#empty-guide'), '清空后回到空状态');

  // 存储失败:提示持续可见,不出现「已保存」
  const bad = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(bad, '存储失败页');
  await bad.addInitScript(() => {
    Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
  });
  await bad.goto(URL);
  await bad.fill('#subtitle-text', '1\n00:00:01,000 --> 00:00:03,000\n测试\n');
  check(await bad.isVisible('#save-warning'), '存储写入失败时应显示「未保存」提示');
  check(!(await bad.textContent('#status')).includes('已保存'), '存储失败时不得显示「已保存」');
  await bad.click('#load-sample');
  await bad.click('#sample-confirm-yes');
  await bad.waitForSelector('.issue');
  check(await bad.isVisible('#save-warning'), '载入示例后失败提示仍可见');
  check(!(await bad.textContent('#status')).includes('已保存'), '载入示例后不得显示「已保存」');
  await bad.close();

  // 手机
  await page.click('#load-sample');
  await page.waitForSelector('.issue');
  await page.locator('#issue-list [data-act="accept"]').nth(0).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await noOverflow(page, '手机');
  const touch = await page.evaluate(() => {
    const r = e => { const b = e.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; };
    return { cb: r(document.getElementById('opt-case')), lab: r(document.querySelector('label.check')), goto: r(document.querySelector('.goto')) };
  });
  check(touch.cb[0] >= 24 && touch.cb[1] >= 24 && touch.lab[1] >= 32 && touch.goto[0] >= 24 && touch.goto[1] >= 32, `手机端触控尺寸:checkbox ${touch.cb} label ${touch.lab} 序号按钮 ${touch.goto}`);
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
  await page.close();

  // 展示图
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  watch(show, '展示页');
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(300);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();

  console.log(`断言 ${asserts} 条`);
  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
