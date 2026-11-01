'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../core.js');

// Real app event handlers with synthetic storage/timers/DOM; no browser or accounts.
function startApp() {
  const nodes = new Map(), timers = new Map(), stored = new Map(), events = new Map();
  const downloads = [], copied = [];
  let id = 0, failWrites = false;
  class Element {
    constructor() {
      this.children = []; this.handlers = new Map(); this.dataset = {};
      this.value = ''; this.hidden = false; this.disabled = false; this.text = '';
    }
    set id(value) { nodes.set(value, this); }
    set textContent(value) { this.text = String(value); this.children = []; }
    get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
    appendChild(child) { this.children.push(child); return child; }
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
    setAttribute() {}
    addEventListener(name, fn) { this.handlers.set(name, fn); }
    focus() {}
    select() {}
    click() { if (!this.disabled) this.handlers.get('click')?.(); }
  }
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const node = new Element(); node.id = match[1];
    node.hidden = /\shidden(?:\s|>)/.test(match[0]);
  }
  const context = {
    ZhCleanCore: core,
    ZH_SAMPLE: { text: '合成示例English', protectedWords: ['示例English'] },
    document: {
      getElementById(key) { assert.ok(nodes.has(key), key); return nodes.get(key); },
      createElement: () => new Element(), body: new Element(),
      createTextNode(text) { const e = new Element(); e.textContent = text; return e; },
    },
    localStorage: {
      getItem: key => stored.get(key) ?? null,
      setItem(key, value) {
        if (failWrites) throw new Error('Synthetic storage failure');
        stored.set(key, value);
      },
    },
    setTimeout(fn) { timers.set(++id, fn); return id; },
    clearTimeout: key => timers.delete(key),
    window: { addEventListener: (name, fn) => events.set(name, fn) },
    navigator: { clipboard: { writeText(text) { copied.push(text); return Promise.resolve(); } } },
    Blob, URL: { createObjectURL(blob) { downloads.push(blob); return 'blob:test'; }, revokeObjectURL() {} },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8'), context);
  return {
    node: key => nodes.get(key), click: key => nodes.get(key).click(),
    input(text) { nodes.get('input').value = text; nodes.get('input').handlers.get('input')(); },
    flush() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); },
    fail() { failWrites = true; }, recover() { failWrites = false; },
    saved: () => stored.get('zhclean.v1'), pagehide: () => events.get('pagehide')(),
    downloads, copied,
  };
}

test('清空保存失败保留原文、规则、保护词、结果及原存档', () => {
  const app = startApp();
  app.click('btn-sample');
  const saved = app.saved(), text = app.node('input').value, result = app.node('output').value;
  app.fail(); app.click('btn-clear'); app.click('clear-yes');
  assert.equal(app.node('input').value, text);
  assert.equal(app.node('output').value, result);
  assert.equal(app.node('word-list').children.length, 1);
  assert.equal(app.saved(), saved);
  assert.equal(app.node('save-warning').hidden, false);
  assert.match(app.node('status').textContent, /清空失败/);
  assert.equal(app.node('status').className, 'status status--error');
});

test('尚未保存的原文在清空失败后仍可复制和导出', async () => {
  const app = startApp();
  app.input('未保存English'); app.fail();
  app.click('btn-clear'); app.click('clear-yes');
  assert.equal(app.node('input').value, '未保存English');
  assert.match(app.node('status').textContent, /清空失败/);
  app.flush();
  app.click('btn-copy'); app.click('btn-warning-export');
  assert.equal(app.copied[0], '未保存 English');
  assert.equal(await app.downloads[0].text(), '未保存 English');
});

for (const retryFails of [false, true]) {
  test('清空失败后关页保存最后编辑' + (retryFails ? '(延时重试也失败)' : '(延时重试前)'), () => {
    const app = startApp();
    app.click('btn-sample');
    const saved = app.saved();
    app.input('最后编辑English'); app.fail();
    app.click('btn-clear'); app.click('clear-yes');
    if (retryFails) app.flush();
    assert.equal(app.saved(), saved);
    assert.equal(app.node('input').value, '最后编辑English');
    assert.equal(app.node('save-warning').hidden, false);
    app.recover(); app.pagehide();
    const expected = core.defaultState();
    expected.text = '最后编辑English';
    expected.protectedWords = ['示例English'];
    assert.deepEqual(JSON.parse(app.saved()), expected);
    assert.equal(app.node('save-warning').hidden, true);
    assert.equal(app.node('status').textContent, '已保存到本机浏览器。');
    app.flush();
    assert.deepEqual(JSON.parse(app.saved()), expected);
  });
}

test('清空成功只写空白状态,关闭页面和待执行计时器不恢复旧内容', () => {
  const app = startApp();
  app.input('原文English');
  app.click('btn-clear'); app.click('clear-yes'); app.pagehide(); app.flush();
  assert.equal(app.node('input').value, '');
  assert.deepEqual(JSON.parse(app.saved()), core.defaultState());
  assert.equal(app.node('save-warning').hidden, true);
  assert.equal(app.node('status').textContent, '已清空。');
});

test('清空失败后恢复存储,可重试清空成功', () => {
  const app = startApp();
  app.input('原文English'); app.fail(); app.click('btn-clear'); app.click('clear-yes');
  assert.equal(app.node('input').value, '原文English');
  app.recover(); app.click('btn-clear'); app.click('clear-yes');
  assert.equal(app.node('input').value, '');
  assert.equal(app.node('save-warning').hidden, true);
  assert.deepEqual(JSON.parse(app.saved()), core.defaultState());
});

test('载入示例保存失败时持续显示未保存,不改成成功提示', () => {
  const app = startApp(); app.fail(); app.click('btn-sample');
  assert.equal(app.node('input').value, '合成示例English');
  assert.equal(app.saved(), undefined);
  assert.equal(app.node('save-warning').hidden, false);
  assert.match(app.node('status').textContent, /当前改动未保存/);
  assert.equal(app.node('status').className, 'status status--error');
});

test('引用式链接在结果、复制和下载中一致保留', async () => {
  const app = startApp();
  app.input('看[中文English][中文ID]\n\n[中文ID]: ./中文English.md');
  const expected = '看 [中文 English][中文ID]\n\n[中文ID]: ./中文English.md';
  assert.equal(app.node('output').value, expected);
  app.click('btn-copy'); app.click('btn-export');
  assert.equal(app.copied[0], expected);
  assert.equal(await app.downloads[0].text(), expected);
});
