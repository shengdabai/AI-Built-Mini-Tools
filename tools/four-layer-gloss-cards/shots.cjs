'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const URL = 'file://' + encodeURI(path.join(__dirname, 'index.html')) + '?today=2026-10-20';
const OUT = path.join(__dirname, 'screenshots');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });
  const problems = [];
  const check = (cond, msg) => { console.log((cond ? 'OK   ' : 'FAIL ') + msg); if (!cond) problems.push(msg); };
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  const noOverflow = async label => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    check(sw <= iw, `${label}: scrollWidth ${sw} <= innerWidth ${iw}`);
  };
  const cellTexts = ci => page.$$eval(`[data-card="${ci}"] .zh-cell`, bs => bs.map(b => b.textContent));

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.screenshot({ path: path.join(OUT, '01-空状态-桌面.png') });
  check(await page.isVisible('#empty-import'), '空状态下「导入词典 JSON」入口可见');
  await page.click('#generate');
  check(await page.isVisible('#input-error') && (await page.getAttribute('#input', 'aria-invalid')) === 'true', '空输入时错误显示在输入框旁并标记 aria-invalid');
  check((await page.evaluate(() => document.activeElement.id)) === 'input', '空输入时焦点回到输入框');

  // 载入示例 → 生成
  await page.click('#load-sample');
  await page.waitForSelector('.card');
  await page.click('#generate');
  check((await page.$$('.card')).length === 3, '生成 3 张卡');
  check(await page.isVisible('#sample-badge'), '示例带「合成示例」标记');
  check((await page.$$eval('.from-dict:not([hidden])', n => n.length)) > 0, '词典预填并标「来自词典」');

  // 填一个 gloss(「买」不在示例词典里)→ 自动记入个人词典
  const glBuy = page.locator('[data-card="0"] .gl-input[aria-label="英文词义:买"]');
  await glBuy.fill('buy');
  await glBuy.blur();
  await page.fill('[data-card="0"] .en-input', 'Today I want to go to the shop to buy a book.');
  await page.fill('[data-card="1"] .en-input', 'He likes coffee, but does not like tea.');
  const learned = await page.evaluate(() => JSON.parse(localStorage.getItem('fourlayer.glossary.v1'))['买']);
  check(learned && learned.gloss === 'buy' && learned.count === 1, '填 gloss 后写入 fourlayer.glossary.v1:' + JSON.stringify(learned));

  // 合并两个格子:第 1 句「一」+「本」
  const before = await cellTexts(0);
  await page.click('[data-card="0"] .zh-cell[data-cell="6"]');
  await page.click('[data-card="0"] .zh-cell[data-cell="7"]');
  check(!(await page.locator('[data-card="0"] [data-act="merge"]').isDisabled()), '选中相邻两格后「合并所选」可用');
  await page.click('[data-card="0"] [data-act="merge"]');
  const afterMerge = await cellTexts(0);
  check(afterMerge.length === before.length - 1 && afterMerge[6] === '一本', `合并:${before.length} → ${afterMerge.length} 格,得到「${afterMerge[6]}」`);

  // 拆分一个格子:第 2 句「咖啡」
  const before2 = await cellTexts(1);
  const idx = before2.indexOf('咖啡');
  await page.click(`[data-card="1"] .zh-cell[data-cell="${idx}"]`);
  await page.click('[data-card="1"] [data-act="split"]');
  const after2 = await cellTexts(1);
  check(after2.length === before2.length + 1 && after2[idx] === '咖' && after2[idx + 1] === '啡', `拆分:${before2.length} → ${after2.length} 格`);
  const pys = await page.$$eval('[data-card="1"] .py-input', ins => ins.map(i => i.value));
  check(pys[idx] === 'kā' && pys[idx + 1] === 'fēi', `拆分后拼音逐字:${pys[idx]} ${pys[idx + 1]}`);
  await page.screenshot({ path: path.join(OUT, '02-核心流程-桌面.png') });
  await noOverflow('桌面');

  // 导出 Markdown
  const [mdDl] = await Promise.all([page.waitForEvent('download'), page.click('#export-md')]);
  const mdPath = await mdDl.path();
  const md = fs.readFileSync(mdPath, 'utf8');
  check(mdDl.suggestedFilename() === 'four-layer-cards-合成示例.md' && md.includes('| Chinese |') && md.includes('| Word-by-Word |') && md.includes('buy'), 'Markdown 下载:' + mdDl.suggestedFilename());
  check(md.startsWith('> 合成示例'), '示例的 Markdown 导出开头标注「合成示例」');
  // 输入框有未生成的改动时,导出禁用并提示
  await page.fill('#input', (await page.inputValue('#input')) + '\n多一句。');
  check((await page.getAttribute('#export-md', 'aria-disabled')) === 'true' && (await page.getAttribute('[data-card="0"] [data-act="png"]', 'aria-disabled')) === 'true', '输入框有未生成的改动时导出 Markdown 与 PNG 禁用');
  check(await page.isVisible('#draft-hint'), '同时显示「先点生成」提示');
  await page.click('#export-md', { force: true });
  check((await page.textContent('#status')).includes('尚未生成'), '点被禁用的导出给出原因');
  await page.fill('#input', (await page.inputValue('#input')).replace('\n多一句。', ''));
  check((await page.getAttribute('#export-md', 'aria-disabled')) === 'false' && !(await page.isVisible('#draft-hint')), '输入框恢复一致后导出恢复');
  // 导出 PNG(第 1 张卡)
  const [pngDl] = await Promise.all([page.waitForEvent('download'), page.click('[data-card="0"] [data-act="png"]')]);
  const png = fs.readFileSync(await pngDl.path());
  check(png.slice(0, 8).toString('hex') === '89504e470d0a1a0a' && png.length > 2000, `PNG 下载:${pngDl.suggestedFilename()} ${png.length} 字节`);
  await page.waitForSelector('#png-preview[src]');
  await page.waitForTimeout(200);
  const dims = await page.evaluate(() => { const i = document.getElementById('png-preview'); return [i.naturalWidth, i.naturalHeight, i.width]; });
  check(Math.abs(dims[0] - dims[2] * 2) <= 1 && dims[1] > 0, `PNG 像素密度 2x:自然宽 ${dims[0]},显示宽 ${dims[2]}`);
  await page.locator('#preview').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, '03-结果与导出-桌面.png') });

  // PNG 英文超长无空格串(URL)必须换行,画布变高而不是被裁掉
  const pngH = async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-card="0"] [data-act="png"]')]);
    await dl.path();
    await page.waitForTimeout(250);
    return page.evaluate(() => { const i = document.getElementById('png-preview'); return [i.naturalWidth, i.naturalHeight]; });
  };
  const [w1, h1] = await pngH();
  await page.fill('[data-card="0"] .en-input', 'https://example.com/' + 'a'.repeat(300));
  const [w2, h2] = await pngH();
  check(h2 > h1 && w2 === w1, `超长 URL 换行:PNG 高度 ${h1} → ${h2},宽度 ${w1} → ${w2} 不变`);
  await page.fill('[data-card="0"] .en-input', 'Today I want to go to the shop to buy a book.');

  // 删除卡片:先行内确认
  const nCards = (await page.$$('.card')).length;
  await page.click('[data-card="2"] [data-act="delete"]');
  check(await page.isVisible('[data-card="2"] .confirm-inline') && (await page.$$('.card')).length === nCards, '点「删除此卡」出现行内确认,确认前卡片数不变');
  check((await page.evaluate(() => document.activeElement.getAttribute('data-act'))) === 'delete-no', '确认出现后焦点落在「取消」');
  await page.click('[data-card="2"] [data-act="delete-no"]');
  check((await page.$$('.card')).length === nCards && !(await page.isVisible('.confirm-inline')), '取消后卡片仍在');
  await page.click('[data-card="2"] [data-act="delete"]');
  check((await page.textContent('[data-card="2"] .confirm-inline')).includes('手改的拼音'), '确认文案写明会一并删除手改内容');
  await page.click('[data-card="2"] [data-act="delete-yes"]');
  check((await page.$$('.card')).length === nCards - 1, '确认后卡片减少 1 张');
  // 载入示例前的替换确认(此时已有卡片与手填内容)
  const enBefore = await page.inputValue('[data-card="0"] .en-input');
  await page.click('#load-sample');
  check(await page.isVisible('#confirm-replace'), '已有卡片时点「载入合成示例」先出现替换确认');
  const rtxt = await page.textContent('#replace-text');
  check(rtxt.includes('手改') && rtxt.includes('个人词典现有 7 条全部保留'), '确认文案写明替换范围与保留的词典数量:' + rtxt.slice(0, 60));
  check((await page.inputValue('[data-card="0"] .en-input')) === enBefore, '确认前手填的整句英文保持不变');
  await page.click('#replace-no');
  check((await page.inputValue('[data-card="0"] .en-input')) === enBefore && !(await page.isVisible('#confirm-replace')), '取消后卡片与整句英文保持不变');
  await page.click('#load-sample');
  await page.click('#replace-yes');
  check((await page.$$('.card')).length === 3 && (await page.inputValue('[data-card="0"] .en-input')) === '', '确认后替换为 3 张示例卡');

  // 个人词典页
  await page.click('#tab-glossary');
  const glRows = await page.$$eval('#gl-body tr', r => r.length);
  check(glRows === 7, `个人词典 7 条(示例 6 + 买):${glRows}`);
  const heads = await page.$$eval('#gl-table th', ths => ths.map(t => t.textContent));
  check(heads.includes('英文词义(gloss)') && heads.includes('卡片学习次数'), '词典表头:' + heads.join(' / '));
  // 词典页改释义不增加次数
  const rowShu = page.locator('#gl-body tr', { hasText: '书' });
  const cntBefore = await rowShu.locator('td').nth(2).textContent();
  await rowShu.locator('input').fill('book (noun)');
  await rowShu.locator('input').blur();
  check((await page.locator('#gl-body tr', { hasText: '书' }).locator('td').nth(2).textContent()) === cntBefore, '词典页改英文词义后次数不变(' + cntBefore + ')');
  // 删除词条:先行内确认
  await page.locator('#gl-body tr', { hasText: '商店' }).locator('[data-gl="del"]').click();
  check((await page.textContent('#gl-body .confirm-inline')).includes('商店'), '删除词条前在该行出现确认');
  check((await page.$$eval('#gl-body tr', r => r.length)) === 7, '确认前词条数不变');
  await page.click('#gl-body [data-gl="no"]');
  check((await page.$$eval('#gl-body tr', r => r.length)) === 7, '取消后词条仍在');
  await page.locator('#gl-body tr', { hasText: '商店' }).locator('[data-gl="del"]').click();
  await page.click('#gl-body [data-gl="yes"]');
  check((await page.$$eval('#gl-body tr', r => r.length)) === 6, '确认后词条减少 1 条');
  // 导入词典:校验 → 预览 → 确认 → 合并
  const badGl = path.join(OUT, '.tmp-bad-glossary.json');
  const goodGl = path.join(OUT, '.tmp-good-glossary.json');
  fs.writeFileSync(badGl, JSON.stringify({ 苹果: { gloss: '' } }));
  fs.writeFileSync(goodGl, JSON.stringify({ 苹果: { gloss: 'apple', count: 2 }, 书: { gloss: 'volume', count: 1 } }));
  await page.setInputFiles('#gl-file', badGl);
  await page.waitForFunction(() => document.getElementById('gl-msg').textContent.includes('导入失败'));
  check((await page.textContent('#gl-msg')).includes('现有词典没有改动'), '非法词典文件整份拒绝并说明');
  await page.setInputFiles('#gl-file', goodGl);
  await page.waitForSelector('#gl-confirm:not([hidden])');
  const gtxt = await page.textContent('#gl-confirm-text');
  check(gtxt.includes('新增 1 条') && gtxt.includes('覆盖现有英文词义 1 条'), '导入确认写明新增与覆盖数量:' + gtxt.slice(0, 70));
  await page.click('#gl-confirm-no');
  check((await page.$$eval('#gl-body tr', r => r.length)) === 6, '取消导入后词典不变');
  await page.setInputFiles('#gl-file', goodGl);
  await page.waitForSelector('#gl-confirm:not([hidden])');
  await page.click('#gl-confirm-yes');
  check((await page.$$eval('#gl-body tr', r => r.length)) === 7, '确认后合并写入(6 + 1 条新增)');
  fs.unlinkSync(badGl); fs.unlinkSync(goodGl);
  await page.click('#tab-cards');

  // 手机
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await noOverflow('手机');
  const smallBtn = await page.evaluate(() => Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent && b.getBoundingClientRect().height < 36).map(b => b.id || b.textContent));
  check(smallBtn.length === 0, '手机端可见按钮高度均 >= 36px(不足:' + smallBtn.join(',') + ')');
  await page.screenshot({ path: path.join(OUT, '04-手机.png'), fullPage: true });
  await page.close();

  // 存储写入失败:提示持续可见,且不能说「已记入」
  {
    const bad = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    bad.on('console', m => { if (m.type() === 'error') problems.push('storage-fail console: ' + m.text()); });
    bad.on('pageerror', e => problems.push('storage-fail pageerror: ' + e.message));
    await bad.addInitScript(() => {
      Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
    });
    await bad.goto(URL);
    await bad.click('#load-sample');
    await bad.waitForSelector('.card');
    const gl = bad.locator('[data-card="0"] .gl-input[aria-label="英文词义:买"]');
    await gl.fill('buy'); await gl.blur();
    check(await bad.isVisible('#storage-warning'), '存储失败:「未保存」提示可见');
    const st = await bad.textContent('#status');
    check(!st.includes('已记入') && st.includes('尚未保存'), '存储失败:状态不再说「已记入」:' + st);
    await bad.close();
  }

  // 只有词典写入失败:之后卡片写入成功,「未保存」提示也不能被解除
  {
    const half = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    half.on('console', m => { if (m.type() === 'error') problems.push('half-fail console: ' + m.text()); });
    half.on('pageerror', e => problems.push('half-fail pageerror: ' + e.message));
    await half.addInitScript(() => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (k.indexOf('glossary') >= 0) throw new DOMException('quota', 'QuotaExceededError'); return orig.call(this, k, v); };
    });
    await half.goto(URL);
    await half.click('#load-sample');
    await half.waitForSelector('.card');
    check(await half.isVisible('#storage-warning'), '词典写入失败、卡片写入成功:警告仍然可见');
    const wt = await half.textContent('#storage-warning-text');
    check(wt.includes('个人词典') && !wt.includes('对照卡'), '警告只点名未保存的个人词典:' + wt.slice(0, 30));
    check((await half.textContent('#storage-warning')).includes('导出词典 JSON') && (await half.textContent('#storage-warning')).includes('导出全部卡片 Markdown'), '备份提示同时覆盖词典与卡片');
    await half.close();
  }

  // 缓存损坏:cells 里有 null 不能让页面崩,「清空数据」仍可用
  {
    const cor = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    cor.on('console', m => { if (m.type() === 'error') problems.push('corrupt console: ' + m.text()); });
    cor.on('pageerror', e => problems.push('corrupt pageerror: ' + e.message));
    await cor.goto(URL);
    await cor.evaluate(() => {
      localStorage.setItem('fourlayer.cards.v1', JSON.stringify({ text: '我去', cards: [
        { sentence: '坏', cells: [null] },
        { sentence: '我去', english: '', cells: [{ t: '我', kind: 'word', pinyin: 'wǒ', gloss: '', fromGlossary: false }] }
      ] }));
    });
    await cor.reload();
    check((await cor.$$('.card')).length === 1, '损坏缓存:跳过坏卡,保留 1 张好卡');
    check((await cor.textContent('#status')).includes('已跳过 1 张'), '损坏缓存:有跳过提示');
    await cor.click('#clear-data');
    check(await cor.isVisible('#confirm-clear'), '损坏缓存:「清空数据」可用');
    await cor.close();
  }

  // 展示图
  const show = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  show.on('pageerror', e => problems.push('showcase pageerror: ' + e.message));
  show.on('console', m => { if (m.type() === 'error') problems.push('showcase console: ' + m.text()); });
  await show.goto('file://' + encodeURI(path.join(__dirname, 'showcase.html')));
  await show.waitForTimeout(400);
  await show.screenshot({ path: path.join(__dirname, 'showcase.png'), fullPage: true });
  await browser.close();

  if (problems.length) { console.error('问题:', problems); process.exit(1); }
  console.log('全部通过;截图已写入 screenshots/ 与 showcase.png');
})().catch(e => { console.error(e); process.exit(1); });
