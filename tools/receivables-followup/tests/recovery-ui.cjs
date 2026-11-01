'use strict';
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const C = require('../core.js');
const url = 'file://' + encodeURI(path.resolve(__dirname, '../index.html')) + '?today=2026-10-20';
(async () => {
  let browser;
  try { browser = await chromium.launch(); }
  catch (_) { browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined }); }
  let cases = 0;
  try {
    for (const fixture of ['empty', 'legacy-limit', 'read-denied', 'aggregate']) {
      const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      let raw = '';
      if (fixture === 'legacy-limit') raw = JSON.stringify({ version: 1, bills: [{ id:'legacy', client:'合成测试', no:'L', issueDate:'', dueDate:'2026-10-20', amount:90000000000000, paid:0, currency:'CNY', dispute:'', lastFollow:'', payments:[], follows:[] }], settings:{ n:7, template:C.DEFAULT_TEMPLATE } });
      if (fixture === 'read-denied') raw = '{unknown-old}';
      if (fixture === 'aggregate') raw = C.exportJson([4500000000000.01,4500000000000].map((amount,i)=>({ ...C.buildBill({client:'合成测试',no:'A'+i,dueDate:'2026-10-20',amount:String(amount),currency:'CNY'}).bill, id:'id'+i })), {n:7,template:C.DEFAULT_TEMPLATE}, false);
      await page.addInitScript(({raw,denied}) => {
        localStorage.setItem('receivables.v1', raw);
        if (denied) {
          const get = Storage.prototype.getItem;
          Storage.prototype.getItem = function(key) { if (key === 'receivables.v1') throw new Error('synthetic read denied'); return get.call(this,key); };
          window.inspectRaw = () => get.call(localStorage,'receivables.v1');
        }
      }, {raw, denied:fixture==='read-denied'});
      await page.goto(url);
      if (fixture === 'aggregate') {
        assert.match(await page.textContent('#aging-out'), /超过/);
        let downloads = 0; page.on('download',()=>downloads++);
        for (const selector of ['#btn-aging-md','#btn-aging-csv','#btn-aging-detail-csv']) { await page.click(selector); assert.match(await page.textContent('#flash'), /超过/); }
        assert.equal(downloads,0);
      } else {
        assert.equal(await page.isVisible('#storage-recovery'),true);
        if (fixture !== 'read-denied') {
          const [download] = await Promise.all([page.waitForEvent('download'),page.click('#btn-storage-raw')]);
          assert.equal(await fs.readFile(await download.path(),'utf8'), raw);
          await page.click('.tab[data-view="follow"]');
          await page.fill('#fu-template','仅改内存');
          await page.dispatchEvent('#fu-template','change');
          assert.equal(await page.evaluate(()=>localStorage.getItem('receivables.v1')),raw);
        } else {
          await page.click('#btn-sample-2');
          assert.equal(await page.evaluate(()=>window.inspectRaw()),raw);
          await page.click('#btn-clear'); await page.click('#btn-clear-yes');
          assert.equal(await page.evaluate(()=>window.inspectRaw()),raw);
          assert.equal(await page.textContent('#bill-count'),'10');
          assert.equal(await page.isVisible('#save-warning'),true);
        }
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await context.close(); cases++;
    }
    console.log('recovery-ui: '+cases+'/4 synthetic scenarios PASS');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
