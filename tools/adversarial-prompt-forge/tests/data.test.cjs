'use strict';
/* app.js 内嵌数据测试（无需浏览器）。
 * 用法：node --test tests/data.test.cjs
 *
 * app.js 是一个整体 IIFE，模板数据不对外导出。这里从源码里取出 TEMPLATES / INTENSITY /
 * PRINCIPLE_ORDER 三个字面量，放进 vm 沙箱求值，再检查页面运行时依赖的数据约定。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

function literal(name, closer) {
  const m = src.match(new RegExp('const ' + name + ' = ([\\[{][\\s\\S]*?\\n  ' + closer + ');'));
  assert.ok(m, 'app.js 中找不到 ' + name + ' 字面量');
  return vm.runInNewContext('(' + m[1] + ')');
}
const TEMPLATES = literal('TEMPLATES', '\\}');
const INTENSITY = literal('INTENSITY', '\\}');
const PRINCIPLE_ORDER = vm.runInNewContext('(' + src.match(/const PRINCIPLE_ORDER = (\[[^\]]*\]);/)[1] + ')');
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates.json'), 'utf8'));

test('每个领域模板：有标签、baseText 恰好含一个 {DOMAIN}、三条原则片段齐全', () => {
  assert.deepEqual(Object.keys(TEMPLATES), ['writing', 'coding', 'investing', 'research']);
  for (const [key, tpl] of Object.entries(TEMPLATES)) {
    assert.ok(tpl.label, key + ' 缺 label');
    assert.equal(tpl.baseText.split('{DOMAIN}').length - 1, 1, key + ' 的 baseText 应恰好含一个 {DOMAIN}');
    assert.deepEqual(Object.keys(tpl.principleSnippets).sort(), [...PRINCIPLE_ORDER].sort(), key + ' 原则片段不全');
    for (const p of PRINCIPLE_ORDER) assert.ok(tpl.principleSnippets[p].length > 10, key + '.' + p + ' 片段为空');
  }
});

test('每档对抗强度：含【档位名】且有半角冒号（标题与存档命名都靠它们拆分）', () => {
  assert.deepEqual(Object.keys(INTENSITY), ['gentle', 'rival', 'ruthless']);
  for (const [key, text] of Object.entries(INTENSITY)) {
    assert.match(text, /【.+?】/, key + ' 缺【档位名】，saveFork 会抛错');
    assert.ok(text.includes(':'), key + ' 缺半角冒号，compile 的标题会变成整段话');
    assert.match(text.split(':')[0], /^对抗强度【.+】$/, key);
  }
});

test('templates.json 数据规格与 app.js 内嵌模板内容一致（只允许全角/半角标点不同）', () => {
  const norm = s => String(s).replace(/，/g, ',').replace(/：/g, ':').replace(/；/g, ';').replace(/（/g, '(').replace(/）/g, ')');
  assert.deepEqual(Object.keys(SPEC), Object.keys(TEMPLATES));
  for (const key of Object.keys(TEMPLATES)) {
    assert.equal(norm(SPEC[key].label), norm(TEMPLATES[key].label), key + '.label');
    assert.equal(norm(SPEC[key].baseText), norm(TEMPLATES[key].baseText), key + '.baseText');
    assert.deepEqual(Object.keys(SPEC[key].principleSnippets), Object.keys(TEMPLATES[key].principleSnippets), key + ' 原则顺序');
    for (const p of PRINCIPLE_ORDER) {
      assert.equal(norm(SPEC[key].principleSnippets[p]), norm(TEMPLATES[key].principleSnippets[p]), key + '.' + p);
    }
  }
});
