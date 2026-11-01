'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const URL = 'file://' + encodeURI(path.join(ROOT, 'index.html')) + '?today=2026-10-20';
const KEY = 'releasenotes.v1';
const RECOVERY_PREFIX = KEY + '.recovery-raw.';
const FALLBACK_EXE = process.env.CHROME_PATH || undefined;

let browser;
test.before(async () => {
  try { browser = await chromium.launch(); }
  catch (e) {
    if (!fs.existsSync(FALLBACK_EXE)) throw e;
    browser = await chromium.launch({ executablePath: FALLBACK_EXE });
  }
});
test.after(async () => { if (browser) await browser.close(); });

async function seededPage(raw, deny, options = {}) {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(({ rawValue, deniedWrite, key, recoveryPrefix, fixedNow, existingArchives }) => {
    const originalSet = Storage.prototype.setItem;
    const originalGet = Storage.prototype.getItem;
    if (!sessionStorage.getItem('recovery-test-seeded')) {
      sessionStorage.setItem('recovery-test-seeded', '1');
      originalSet.call(localStorage, key, rawValue);
      for (const [archiveKey, archiveRaw] of existingArchives) originalSet.call(localStorage, archiveKey, archiveRaw);
    }
    globalThis.__testOriginalGet = originalGet;
    if (fixedNow !== null) Date.now = () => fixedNow;
    Storage.prototype.getItem = function (name) {
      if (deniedWrite === 'read-main' && name === key) throw new DOMException('main read denied', 'SecurityError');
      return originalGet.call(this, name);
    };
    let deniedMainOnce = false;
    Storage.prototype.setItem = function (name, value) {
      if (deniedWrite === 'archive' && name.startsWith(recoveryPrefix)) throw new DOMException('archive denied', 'QuotaExceededError');
      if (deniedWrite === 'main' && name === key) throw new DOMException('main denied', 'QuotaExceededError');
      if (deniedWrite === 'main-once' && name === key && !deniedMainOnce) {
        deniedMainOnce = true;
        throw new DOMException('main denied once', 'QuotaExceededError');
      }
      return originalSet.call(this, name, value);
    };
  }, {
    rawValue: raw,
    deniedWrite: deny || '',
    key: KEY,
    recoveryPrefix: RECOVERY_PREFIX,
    fixedNow: options.fixedNow ?? null,
    existingArchives: options.existingArchives || []
  });
  await page.goto(URL);
  return { context, page };
}

async function archives(page) {
  return page.evaluate(prefix => {
    const out = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) out.push([key, localStorage.getItem(key)]);
    }
    return out.sort((a, b) => a[0].localeCompare(b[0]));
  }, RECOVERY_PREFIX);
}

test('malformed JSON: archive exact raw before main overwrite, download exact raw, refresh valid state', async () => {
  const raw = '{\r\n  "log": "坏值", trailing\r\n}';
  const { context, page } = await seededPage(raw);
  assert.equal(await page.isVisible('#load-note'), true);
  assert.match(await page.textContent('#load-note-text'), /不是合法 JSON/);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), KEY), raw);

  const downloadPromise = page.waitForEvent('download');
  await page.click('#download-raw');
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'releasenotes-recovery-raw.txt');
  assert.equal(fs.readFileSync(await download.path(), 'utf8'), raw);

  await page.fill('#current', '1.2.3');
  assert.deepEqual((await archives(page)).map(item => item[1]), [raw]);
  const saved = await page.evaluate(key => localStorage.getItem(key), KEY);
  assert.equal(JSON.parse(saved).current, '1.2.3');
  assert.equal(await page.isHidden('#save-warn'), true);
  assert.match(await page.textContent('#load-note-text'), /逐字归档并回读确认/);

  await page.reload();
  assert.equal(await page.inputValue('#current'), '1.2.3');
  assert.equal(await page.isVisible('#load-note'), true);
  assert.match(await page.textContent('#load-note-text'), /正常恢复/);
  assert.deepEqual((await archives(page)).map(item => item[1]), [raw]);
  await context.close();
});

test('JSON-valid bad fields are rejected without changing exact main value', async () => {
  const raw = '{"log":5,"repoUrl":"","current":"","release":"","date":"","opts":{}}';
  const { context, page } = await seededPage(raw);
  assert.match(await page.textContent('#load-note-text'), /字段不合法/);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), KEY), raw);
  assert.equal(await page.inputValue('#log'), '');
  await context.close();
});

test('archive denied: preserve old main and valid new state in memory with recovery exports', async () => {
  const raw = '{not-json:archive-denied}';
  const { context, page } = await seededPage(raw, 'archive');
  await page.fill('#current', '3.4.5');
  assert.equal(await page.inputValue('#current'), '3.4.5');
  assert.equal(await page.evaluate(key => localStorage.getItem(key), KEY), raw);
  assert.deepEqual(await archives(page), []);
  assert.equal(await page.isVisible('#save-warn'), true);
  assert.match(await page.textContent('#load-note-text'), /主草稿没有被覆盖/);

  const currentPromise = page.waitForEvent('download');
  await page.click('#download-current');
  const currentDownload = await currentPromise;
  const exported = JSON.parse(fs.readFileSync(await currentDownload.path(), 'utf8'));
  assert.equal(exported.current, '3.4.5');
  await context.close();
});

test('main setItem denied after successful archive: preserve old main and expose valid memory state', async () => {
  const raw = '{not-json:main-denied}';
  const { context, page } = await seededPage(raw, 'main');
  await page.fill('#current', '7.8.9');
  assert.deepEqual((await archives(page)).map(item => item[1]), [raw]);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), KEY), raw);
  assert.equal(await page.inputValue('#current'), '7.8.9');
  assert.equal(await page.isVisible('#save-warn'), true);
  assert.match(await page.textContent('#load-note-text'), /拒绝写入或回读新草稿/);
  await context.close();
});

test('main read denied: block every main write and clear while preserving unknown old bytes; memory export remains available', async () => {
  const raw = '{"old":"must-stay-byte-exact"}\r\n';
  const { context, page } = await seededPage(raw, 'read-main');
  assert.match(await page.textContent('#load-note-text'), /阻止保存和清空/);
  assert.equal(await page.isVisible('#download-current'), true);
  await page.fill('#current', '4.5.6');
  assert.equal(await page.inputValue('#current'), '4.5.6');
  assert.equal(await page.isVisible('#save-warn'), true);
  assert.equal(await page.evaluate(key => __testOriginalGet.call(localStorage, key), KEY), raw);
  assert.deepEqual(await archives(page), []);

  const currentPromise = page.waitForEvent('download');
  await page.click('#download-current');
  const exported = JSON.parse(fs.readFileSync(await (await currentPromise).path(), 'utf8'));
  assert.equal(exported.current, '4.5.6');

  await page.click('#clear-data');
  await page.click('#clear-yes');
  assert.equal(await page.inputValue('#current'), '4.5.6');
  assert.equal(await page.evaluate(key => __testOriginalGet.call(localStorage, key), KEY), raw);
  assert.match(await page.textContent('#load-note-text'), /清空已被阻止/);
  await context.close();
});

test('fixed-clock archive collision: preserve older archive and select a unique suffix', async () => {
  const now = 1700000000000;
  const oldKey = RECOVERY_PREFIX + now;
  const oldRaw = '{older-archive}';
  const raw = '{new-invalid-main}';
  const { context, page } = await seededPage(raw, '', { fixedNow: now, existingArchives: [[oldKey, oldRaw]] });
  await page.fill('#current', '1.0.0');
  assert.deepEqual(await archives(page), [[oldKey, oldRaw], [oldKey + '.1', raw]]);
  assert.equal(JSON.parse(await page.evaluate(key => localStorage.getItem(key), KEY)).current, '1.0.0');
  await context.close();
});

test('retry after main write failure: missing archive is re-created and re-read before the second main write', async () => {
  const raw = '{invalid-main-retry}';
  const { context, page } = await seededPage(raw, 'main-once');
  await page.fill('#current', '8.0.0');
  const firstArchives = await archives(page);
  assert.equal(firstArchives.length, 1);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), KEY), raw);
  await page.evaluate(key => localStorage.removeItem(key), firstArchives[0][0]);

  await page.fill('#current', '8.0.1');
  assert.deepEqual((await archives(page)).map(item => item[1]), [raw]);
  assert.equal(JSON.parse(await page.evaluate(key => localStorage.getItem(key), KEY)).current, '8.0.1');
  assert.equal(await page.isHidden('#save-warn'), true);
  await context.close();
});
