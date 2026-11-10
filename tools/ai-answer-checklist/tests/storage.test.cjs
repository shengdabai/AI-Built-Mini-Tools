'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../core.js');

// Run the real storage boundary without DOM/layout or browser dependencies.
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const storageFunctions = source.slice(source.indexOf('  function load()'), source.indexOf('  function scheduleSave()'));
function start(raw, denyArchive) {
  const key = 'answercheck.v1', stored = new Map([[key, raw]]), warnings = [];
  const context = {
    C: core, KEY: key, state: { tasks: [], currentId: null },
    pendingRecoveryRaw: null, saveTimer: null, clearTimeout() {},
    showSaveWarning: text => warnings.push(text), toast() {},
    $: () => ({ hidden: true }),
    localStorage: {
      getItem: name => stored.get(name) ?? null,
      setItem(name, value) {
        if (denyArchive && name === key + '.rejected') throw new Error('archive quota');
        stored.set(name, value);
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(storageFunctions + '\nload();', context);
  return {
    stored, warnings, key,
    save: () => vm.runInContext('save()', context),
    allowArchive() { denyArchive = false; }
  };
}

test('failed recovery archive prevents overwriting the only raw copy', () => {
  const app = start('original damaged JSON', true);
  assert.equal(app.save(), false);
  assert.equal(app.stored.get(app.key), 'original damaged JSON');
  assert.equal(app.stored.has(app.key + '.rejected'), false);
  assert.ok(app.warnings.length > 0);
});

test('a later save retries the archive before writing the new state', () => {
  const app = start('original damaged JSON', true);
  app.allowArchive();
  assert.equal(app.save(), true);
  assert.equal(app.stored.get(app.key + '.rejected'), 'original damaged JSON');
  assert.deepEqual(JSON.parse(app.stored.get(app.key)), { tasks: [], currentId: null });
});

test('successful initial archive permits normal saves', () => {
  const app = start('original damaged JSON', false);
  assert.equal(app.stored.get(app.key + '.rejected'), 'original damaged JSON');
  assert.equal(app.save(), true);
});
