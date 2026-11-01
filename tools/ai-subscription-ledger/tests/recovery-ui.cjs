'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');
const C = require('../core.js');
globalThis.LedgerCore = C;
require('../sample-data.js');
const legacy = globalThis.LedgerSample.build('2026-10-20');
legacy.version = 1;
delete legacy.snapshots;
const url = 'file://' + encodeURI(path.resolve(__dirname, '../index.html')) + '?today=2026-10-20';
(async () => {
  let browser;
  try { browser = await chromium.launch(); }
  catch { browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined }); }
  try {
    for (const mode of ['fallback', 'both-invalid', 'archive-failure']) {
      const context = await browser.newContext();
      await context.addInitScript(({ mode, legacy }) => {
        localStorage.clear();
        localStorage.setItem('aiLedger.v2', '{broken-v2');
        localStorage.setItem('aiLedger.v1', mode === 'fallback' ? JSON.stringify(legacy) : '{broken-v1');
        if (mode === 'archive-failure') {
          const original = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key, value) {
            if (key.endsWith(':corrupt-backup')) throw new DOMException('archive denied', 'QuotaExceededError');
            return original.call(this, key, value);
          };
        }
      }, { mode, legacy });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(url);
      assert.equal(await page.locator('#btn-export-raw-recovery').isVisible(), true);
      if (mode === 'fallback') assert.match(await page.locator('#load-notice-text').textContent(), /已从有效 v1 恢复/);
      const downloading = page.waitForEvent('download');
      await page.locator('#btn-export-raw-recovery').click();
      const download = await downloading;
      const raw = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
      assert.equal(raw.entries[0].raw, '{broken-v2');
      assert.equal(raw.entries.length, mode === 'fallback' ? 1 : 2);
      await page.locator('#btn-sample').click();
      if (await page.locator('#confirm-box').isVisible()) await page.locator('#btn-confirm-yes').click();
      const saved = await page.evaluate(() => ({ main: localStorage.getItem('aiLedger.v2'), old: localStorage.getItem('aiLedger.v1'), backup: localStorage.getItem('aiLedger.v2:corrupt-backup') }));
      if (mode === 'archive-failure') {
        assert.equal(saved.main, '{broken-v2');
        assert.equal(await page.locator('#save-warning').isVisible(), true);
        const current = page.waitForEvent('download');
        await page.locator('#btn-save-warning-export').click();
        assert.equal(C.validateImport(await fs.readFile(await (await current).path(), 'utf8'), '2026-10-20').ok, true);
      } else {
        assert.equal(saved.backup, '{broken-v2');
        assert.equal(C.validateImport(saved.main, '2026-10-20').ok, true);
        assert.equal(saved.old, mode === 'fallback' ? JSON.stringify(legacy) : '{broken-v1');
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('PASS: v2 损坏回退 v1、双损坏原文下载、归档失败保留原值、有效内存备份');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
