'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const URL = 'file://' + encodeURI(path.join(__dirname, '..', 'index.html'));
const FALLBACK = process.env.CHROME_PATH || undefined;
const KEY = 'tplfill.v1';

async function launch() {
  try { return await chromium.launch(); }
  catch (first) {
    if (!fs.existsSync(FALLBACK)) throw first;
    return chromium.launch({ executablePath: FALLBACK });
  }
}

async function open(browser, raw, mode, width = 1440) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(({ key, value, failure }) => {
    const nativeSet = Storage.prototype.setItem;
    if (value !== null) nativeSet.call(localStorage, key, value);
    if (failure === 'archive') {
      Storage.prototype.setItem = function (k, v) {
        if (String(k).startsWith(key + '.corrupt.')) throw new DOMException('denied', 'QuotaExceededError');
        return nativeSet.call(this, k, v);
      };
    } else if (failure === 'main') {
      Storage.prototype.setItem = function (k, v) {
        if (k === key) throw new DOMException('quota', 'QuotaExceededError');
        return nativeSet.call(this, k, v);
      };
    } else if (failure === 'all') {
      Storage.prototype.getItem = function () { throw new DOMException('denied', 'SecurityError'); };
      Storage.prototype.setItem = function () { throw new DOMException('denied', 'SecurityError'); };
    } else if (failure === 'main-read') {
      globalThis.__tplfillNativeGet = Storage.prototype.getItem;
      Storage.prototype.getItem = function (k) {
        if (k === key) throw new DOMException('denied', 'SecurityError');
        return globalThis.__tplfillNativeGet.call(this, k);
      };
    }
  }, { key: KEY, value: raw, failure: mode || '' });
  const page = await ctx.newPage();
  await page.goto(URL);
  return { ctx, page };
}

(async () => {
  const browser = await launch();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tplfill-recovery-'));
  let count = 0;
  const ok = (condition, name) => { count++; assert.ok(condition, name); console.log('OK  ' + name); };

  // 非法 JSON：不部分载入；第一次覆盖前，原文必须先逐字归档并读回一致。
  {
    const raw = '{"version":1,"template":"旧内容"';
    const { ctx, page } = await open(browser, raw, '');
    ok(await page.inputValue('#tpl') === '', '非法 JSON 不载入任何模板字段');
    ok(await page.isVisible('#recovery-warning'), '非法 JSON 显示持续恢复提示');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-raw-download')]);
    const file = path.join(temp, 'raw.txt'); await download.saveAs(file);
    ok(fs.readFileSync(file, 'utf8') === raw, '损坏存档下载逐字一致');
    await page.fill('#tpl', '当前有效草稿 {{姓名}}');
    const saved = await page.evaluate(key => {
      const archives = Object.keys(localStorage).filter(k => k.startsWith(key + '.corrupt.'));
      return { main: localStorage.getItem(key), archives: archives.map(k => localStorage.getItem(k)) };
    }, KEY);
    ok(saved.archives.length === 1 && saved.archives[0] === raw, '首次覆盖前归档原文并读回一致');
    ok(JSON.parse(saved.main).template === '当前有效草稿 {{姓名}}', '归档成功后才写入有效新状态');
    await ctx.close();
  }

  // JSON 可解析但字段混合非法：整份拒绝，不能把合法 template 部分载入。
  {
    const raw = JSON.stringify({ version: 1, template: '不得部分载入', data: [{ name: '混合行' }], filePattern: 7 });
    const { ctx, page } = await open(browser, raw, '');
    ok(await page.inputValue('#tpl') === '' && await page.inputValue('#data') === '', '字段类型混合非法时原子拒绝且无部分载入');
    ok((await page.textContent('#recovery-warning')).includes('data 必须是字符串'), '结构错误原因持续可见');
    await ctx.close();
  }

  // 已存在的 0 字节主键不是“无存档”：仍要提示、下载和先归档。
  {
    const raw = '';
    const { ctx, page } = await open(browser, raw, '');
    ok(await page.isVisible('#recovery-warning'), '0 字节主键按损坏存档处理,不是按不存在处理');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-raw-download')]);
    const file = path.join(temp, 'empty-raw.txt'); await download.saveAs(file);
    ok(fs.readFileSync(file, 'utf8') === raw, '0 字节损坏原文下载仍逐字一致');
    await page.fill('#tpl', '空原文后的有效草稿');
    const archived = await page.evaluate(key => Object.keys(localStorage).filter(k => k.startsWith(key + '.corrupt.')).map(k => localStorage.getItem(k)), KEY);
    ok(archived.length === 1 && archived[0] === '', '覆盖 0 字节主键前先归档 0 字节原文');
    await ctx.close();
  }

  // 固定时钟下归档键发生碰撞：保留旧归档，使用唯一后缀，不覆盖已有值。
  {
    const raw = '{fixed clock collision';
    const { ctx, page } = await open(browser, raw, '');
    const base = KEY + '.corrupt.2026-10-29T00-00-00-000Z';
    await page.evaluate(({ archiveKey }) => {
      Date.prototype.toISOString = function () { return '2026-10-29T00:00:00.000Z'; };
      localStorage.setItem(archiveKey, '较早的归档');
    }, { archiveKey: base });
    await page.fill('#tpl', '碰撞后的有效草稿');
    const collision = await page.evaluate(({ oldKey, key }) => ({
      old: localStorage.getItem(oldKey),
      matches: Object.keys(localStorage).filter(k => k.startsWith(oldKey + '-')).map(k => localStorage.getItem(k)),
      main: localStorage.getItem(key)
    }), { oldKey: base, key: KEY });
    ok(collision.old === '较早的归档', '固定时钟碰撞不覆盖已有归档');
    ok(collision.matches.length === 1 && collision.matches[0] === raw, '固定时钟碰撞使用唯一后缀保存新原文');
    ok(JSON.parse(collision.main).template === '碰撞后的有效草稿', '唯一归档读回一致后才覆盖主键');
    await ctx.close();
  }

  // 归档被拒绝：主键原文不变，当前有效状态保留在内存恢复 JSON 中。
  {
    const raw = '{bad archive denied';
    const { ctx, page } = await open(browser, raw, 'archive');
    await page.fill('#tpl', '内存草稿');
    ok(await page.evaluate(key => localStorage.getItem(key), KEY) === raw, '归档失败时旧主键完全不变');
    ok((await page.textContent('#save-warning')).includes('只在内存里'), '归档失败明确说明只在内存里');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-recovery-export')]);
    const file = path.join(temp, 'memory.json'); await download.saveAs(file);
    const recovered = JSON.parse(fs.readFileSync(file, 'utf8'));
    ok(recovered.template === '内存草稿' && recovered.recoveryScope.includes('template'), '恢复 JSON 包含当前有效草稿并明确范围');
    ok(recovered.recoveryNote.includes('不包含损坏存档原文'), '恢复 JSON 不虚称包含全部数据');
    await ctx.close();
  }

  // 归档成功但主键写入遇到 quota：原主键不变，归档仍逐字保留。
  {
    const raw = '{bad main quota';
    const { ctx, page } = await open(browser, raw, 'main');
    await page.fill('#tpl', 'quota 后的内存草稿');
    const state = await page.evaluate(key => ({
      main: localStorage.getItem(key),
      archived: Object.keys(localStorage).filter(k => k.startsWith(key + '.corrupt.')).map(k => localStorage.getItem(k))
    }), KEY);
    ok(state.main === raw, '主键写入 quota 时损坏原文仍未覆盖');
    ok(state.archived.length === 1 && state.archived[0] === raw, '主键写入失败前归档已逐字保留');
    ok((await page.textContent('#save-warning')).includes('只在内存里'), '主键写入 quota 不显示已保存');
    await ctx.close();
  }

  // 第一次归档后主键写入失败，随后归档被外部清除：第二次覆盖前必须重新归档。
  {
    const raw = '{archive disappears';
    const { ctx, page } = await open(browser, raw, 'main');
    await page.fill('#tpl', '第一次内存草稿');
    const removed = await page.evaluate(key => {
      const archive = Object.keys(localStorage).find(k => k.startsWith(key + '.corrupt.'));
      localStorage.removeItem(archive);
      return archive;
    }, KEY);
    ok(!!removed, '第一次主键写入失败前已建立归档');
    await page.fill('#tpl', '第二次内存草稿');
    const second = await page.evaluate(key => Object.keys(localStorage).filter(k => k.startsWith(key + '.corrupt.')).map(k => localStorage.getItem(k)), KEY);
    ok(second.length === 1 && second[0] === raw, '归档消失后第二次覆盖前重新归档并读回原文');
    ok(await page.evaluate(key => localStorage.getItem(key), KEY) === raw, '第二次主键写入仍失败时旧主键继续不变');
    await ctx.close();
  }

  // 浏览器完全拒绝存储：只报告内存状态；同时检查中窄屏无横向溢出。
  {
    const { ctx, page } = await open(browser, null, 'all', 768);
    ok((await page.textContent('#recovery-warning')).includes('只在内存里'), '读取存储被拒绝时只报告内存状态');
    await page.fill('#tpl', '仅内存');
    ok((await page.textContent('#save-warning')).includes('只在内存里'), '写入存储被拒绝时不称为已保存');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    ok(!overflow, '768 宽度无横向溢出');
    await ctx.close();
  }

  // 只拒绝首次主键读取、仍允许写入：本次页面必须封锁输入和清空产生的所有存储写入。
  {
    const raw = JSON.stringify({ version: 1, template: '旧主键内容', data: '姓名\n旧数据', filePattern: '{{姓名}}.txt', separator: '---', sample: false });
    const { ctx, page } = await open(browser, raw, 'main-read');
    ok((await page.textContent('#recovery-warning')).includes('只在内存里'), '主键读取失败后持续提示只使用内存');
    await page.fill('#tpl', '本次页面的新草稿');
    const afterInput = await page.evaluate(key => globalThis.__tplfillNativeGet.call(localStorage, key), KEY);
    ok(afterInput === raw, '主键读取失败后输入不会覆盖未知旧字节');
    ok(await page.isVisible('#save-warning') && (await page.textContent('#save-warning')).includes('不会写入或清除'), '输入后持续说明本次页面封锁存储写入');
    await page.click('#btn-clear');
    await page.click('#btn-clear-yes');
    const afterClear = await page.evaluate(key => globalThis.__tplfillNativeGet.call(localStorage, key), KEY);
    ok(afterClear === raw, '主键读取失败后清空界面也不会清除或覆盖旧字节');
    ok(await page.isVisible('#save-warning') && (await page.textContent('#save-warning')).includes('只在内存里'), '清空后未保存警告仍持续可见');
    await ctx.close();
  }

  await browser.close();
  console.log('恢复测试全部通过;断言数:' + count);
})().catch(error => { console.error(error); process.exit(1); });
