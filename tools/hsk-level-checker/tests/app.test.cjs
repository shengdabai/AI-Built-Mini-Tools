'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
require('../../_shared/cn-segment.js');
const core = require('../core.js');

// Exercise the real event handlers without starting a browser. This small DOM
// implements only the APIs used here; layout and downloads still need browser QA.
function startApp(options = {}) {
  class Element {
    constructor() {
      this.value = '';
      this.children = [];
      this.dataset = {};
      this.attributes = new Map();
      this.handlers = new Map();
      this.hidden = false;
      this.disabled = false;
      this.classList = { toggle() {} };
      this.text = '';
    }
    set textContent(value) { this.text = String(value); this.children = []; }
    get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
    appendChild(child) { this.children.push(child); return child; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    addEventListener(name, fn) { this.handlers.set(name, fn); }
    querySelectorAll() { return []; }
    focus() {}
    remove() {}
    click() { if (!this.disabled) this.handlers.get('click')?.(); }
  }
  const nodes = new Map();
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const node = new Element();
    node.hidden = /\shidden(?:\s|>)/.test(match[0]);
    node.disabled = /\sdisabled(?:\s|>)/.test(match[0]);
    nodes.set(match[1], node);
  }
  nodes.get('target').value = '3';
  const stored = new Map();
  const document = {
    getElementById(id) {
      assert.ok(nodes.has(id), 'Unexpected element: ' + id);
      return nodes.get(id);
    },
    createElement: () => new Element(),
    createDocumentFragment: () => new Element(),
    createTextNode(text) { const node = new Element(); node.textContent = text; return node; },
    body: new Element(),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8'), {
    document, HskCore: core,
    HSK_WORDS: { 我: { l: 1, p: 'wǒ' }, 效率: { l: 5, p: 'xiàolǜ' } },
    PINYIN_MAP: {}, HskSample: { text: '合成示例', target: 3 },
    localStorage: {
      getItem: key => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
      removeItem(key) {
        if (options.removeFails) throw new Error('Storage unavailable');
        stored.delete(key);
      },
    },
    location: { search: '?today=2026-10-29' },
    Blob, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    setTimeout: fn => fn(),
  });
  return {
    node: id => nodes.get(id),
    click: id => nodes.get(id).click(),
    input(id, value) {
      const node = nodes.get(id);
      node.value = value;
      node.handlers.get('input')?.();
    },
  };
}

test('检查原文后,副本可导出且报告与原文一致', () => {
  const app = startApp();
  app.input('src', '我效率');
  app.click('btn-check');
  assert.equal(app.node('rew').value, '我效率');
  assert.equal(app.node('btn-md').getAttribute('aria-disabled'), 'false');
  app.click('btn-md');
  assert.match(app.node('export-text').value, /\| 效率 \| HSK 5 \|/);
  assert.match(app.node('export-text').value, /## 改写后全文\s+我效率/);
});

test('编辑改写文后再检查原文,保留草稿但禁止导出未检查的改写文', () => {
  const app = startApp();
  app.input('src', '我效率');
  app.click('btn-check');
  app.input('rew', '我');
  app.click('btn-check');
  assert.equal(app.node('rew').value, '我', '保留用户草稿');
  for (const id of ['btn-md', 'btn-csv']) {
    assert.equal(app.node(id).getAttribute('aria-disabled'), 'true');
    app.click(id);
  }
  assert.equal(app.node('export-preview').hidden, true);
  app.click('btn-recheck');
  assert.equal(app.node('btn-md').getAttribute('aria-disabled'), 'false');
  app.click('btn-md');
  assert.match(app.node('export-text').value, /超纲词数:1 → 0\(-1\)/);
  assert.match(app.node('export-text').value, /## 改写后全文\s+我\s*$/);
});

test('已有改写结果时再次检查原文,不能把已清除的改写结果当成有效结果', () => {
  const app = startApp();
  app.input('src', '我效率');
  app.click('btn-check');
  app.input('rew', '我');
  app.click('btn-recheck');
  assert.equal(app.node('btn-md').getAttribute('aria-disabled'), 'false');
  app.click('btn-check');
  assert.equal(app.node('view-after').disabled, true);
  assert.equal(app.node('btn-md').getAttribute('aria-disabled'), 'true');
});

test('原文有未检查改动时,重新检查改写文仍不能导出旧原文统计', () => {
  const app = startApp();
  app.input('src', '我效率');
  app.click('btn-check');
  app.input('src', '我');
  app.input('rew', '我我');
  app.click('btn-recheck');
  assert.equal(app.node('btn-md').getAttribute('aria-disabled'), 'true');
  app.click('btn-md');
  assert.equal(app.node('export-preview').hidden, true);
});

test('浏览器拒绝删除存档时,清空操作保留当前内容和结果并提示失败', () => {
  const app = startApp({ removeFails: true });
  app.input('src', '我效率');
  app.click('btn-check');
  app.input('rew', '我');
  app.click('btn-recheck');
  app.click('btn-clear');
  app.click('btn-clear-yes');
  assert.equal(app.node('src').value, '我效率');
  assert.equal(app.node('rew').value, '我');
  assert.equal(app.node('result').hidden, false);
  assert.equal(app.node('btn-md').getAttribute('aria-disabled'), 'false');
  assert.match(app.node('src-status').textContent, /清空失败/);
  assert.doesNotMatch(app.node('src-status').textContent, /数据已清空/);
});

test('浏览器成功删除存档时,清空操作重置内容、级别和结果', () => {
  const app = startApp();
  app.input('src', '我效率');
  app.node('target').value = '5';
  app.click('btn-check');
  app.click('btn-clear');
  app.click('btn-clear-yes');
  assert.equal(app.node('src').value, '');
  assert.equal(app.node('rew').value, '');
  assert.equal(app.node('target').value, '3');
  assert.equal(app.node('result').hidden, true);
  assert.match(app.node('src-status').textContent, /数据已清空/);
});
