'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../core.js');

const recipe = (text, extra) => Object.assign({ id: 'r1', name: '测试', yieldAmount: 4, yieldUnit: '份', baseName: '', notes: '', ingredients: C.parseIngredients(text).items }, extra || {});
const factor = v => C.factorFromServings(1, v).factor;

test('parseQuantity:整数、小数、分数、混合数', () => {
  assert.strictEqual(C.parseQuantity('250').value, 250);
  assert.strictEqual(C.parseQuantity('0.75').value, 0.75);
  assert.strictEqual(C.parseQuantity('1/2').value, 0.5);
  const m = C.parseQuantity('1 1/2');
  assert.strictEqual(m.kind, 'number');
  assert.strictEqual(m.value, 1.5);
});

test('parseQuantity:全角数字、全角斜杠、中文半与一半、Unicode 分数', () => {
  assert.strictEqual(C.parseQuantity('２５０').value, 250);
  assert.strictEqual(C.parseQuantity('１／２').value, 0.5);
  assert.strictEqual(C.parseQuantity('半').value, 0.5);
  assert.strictEqual(C.parseQuantity('一半').value, 0.5);
  assert.strictEqual(C.parseQuantity('1½').value, 1.5);
});

test('parseQuantity:范围与非数值', () => {
  const r = C.parseQuantity('2-3');
  assert.deepStrictEqual([r.kind, r.min, r.max], ['range', 2, 3]);
  assert.strictEqual(C.parseQuantity('２～３').kind, 'range');
  assert.strictEqual(C.parseQuantity('3-2').kind, 'text', '反向范围不当作数值');
  assert.deepStrictEqual(C.parseQuantity('适量'), { kind: 'text', display: '适量' });
  assert.strictEqual(C.parseQuantity('1/0').kind, 'text');
  assert.strictEqual(C.parseQuantity('').kind, 'text');
});

test('parseIngredients:管道格式、自由格式、未知单位警告、空输入', () => {
  const r = C.parseIngredients('面粉 | 500 | g | 高筋\n水 250ml\n500 g 糖\n盐 适量\n奶油 | 1 | 桶');
  assert.deepStrictEqual(r.items[0], { name: '面粉', qtyText: '500', unit: 'g', note: '高筋' });
  assert.deepStrictEqual([r.items[1].name, r.items[1].qtyText, r.items[1].unit], ['水', '250', 'mL']);
  assert.strictEqual(r.items[2].name, '糖');
  assert.strictEqual(r.items[3].qtyText, '适量');
  assert.strictEqual(r.items[4].unit, '');
  assert.match(r.items[4].note, /桶/);
  assert.strictEqual(r.warnings.length, 1);
  assert.deepStrictEqual(C.parseIngredients('').items, []);
});

test('factorFromServings 与 factorFromIngredient 的倍数和除零保护', () => {
  assert.strictEqual(C.factorFromServings(8, 12).factor.value, 1.5);
  assert.strictEqual(C.factorFromServings(0, 12).ok, false);
  assert.strictEqual(C.factorFromServings(8, 0).ok, false);
  const rc = recipe('面粉 500 g\n水 300 mL\n盐 适量\n糖 0 g\n酵母 2-3 g');
  assert.strictEqual(C.factorFromIngredient(rc, '面粉', 350, 'g').factor.value, 0.7);
  assert.strictEqual(C.factorFromIngredient(rc, '面粉', 0.35, 'kg').factor.value, 0.7);
  assert.strictEqual(C.factorFromIngredient(rc, '糖', 10, 'g').ok, false, '原始为 0 不能除');
  assert.strictEqual(C.factorFromIngredient(rc, '盐', 10, 'g').ok, false);
  assert.strictEqual(C.factorFromIngredient(rc, '酵母', 5, 'g').ok, false, '范围不能反推');
  assert.strictEqual(C.factorFromIngredient(rc, '水', 300, 'g').ok, false, '容积与质量不互换');
  assert.strictEqual(C.factorFromIngredient(rc, '没有', 1, 'g').ok, false);
});

test('scale:数值乘倍数,范围两端分别缩放,文本原样保留', () => {
  const rc = recipe('糖 2-3 汤匙\n盐 适量\n面粉 200 g');
  const s = C.scale(rc, factor(2), { autoUnit: false });
  assert.strictEqual(s.items[0].text, '4–6 汤匙');
  assert.strictEqual(s.items[1].scaled, false);
  assert.strictEqual(s.items[1].text, '适量');
  assert.strictEqual(s.items[2].text, '400 g');
  assert.strictEqual(s.yieldText, '8 份');
});

test('scale:分数精确运算,1/3 的三倍还是 1', () => {
  const rc = recipe('牛奶 1/3 杯\n黄油 1 1/2 杯');
  const s = C.scale(rc, factor(3), { format: 'fraction' });
  assert.strictEqual(s.items[0].text, '1 杯');
  assert.strictEqual(s.items[1].text, '4 1/2 杯');
  const d = C.scale(rc, factor(1), { format: 'decimal' });
  assert.strictEqual(d.items[0].text, '0.33 杯');
  assert.strictEqual(d.items[1].text, '1.5 杯');
});

test('分数显示:分母超过 16 时回退为小数', () => {
  const r = C.parseQuantity('1/20').r;
  assert.strictEqual(C.formatRat(r, 'fraction'), '0.05');
  assert.strictEqual(C.formatRat(C.parseQuantity('3/4').r, 'fraction'), '3/4');
});

test('autoUnit:升降单位并可关闭', () => {
  assert.deepStrictEqual([C.autoUnit(1500, 'g').value, C.autoUnit(1500, 'g').unit], [1.5, 'kg']);
  assert.deepStrictEqual([C.autoUnit(0.25, 'L').value, C.autoUnit(0.25, 'L').unit], [250, 'mL']);
  assert.deepStrictEqual([C.autoUnit(0.5, 'kg').value, C.autoUnit(0.5, 'kg').unit], [500, 'g']);
  assert.strictEqual(C.autoUnit(999, 'g').unit, 'g');
  assert.strictEqual(C.autoUnit(2500, 'mL').unit, 'L');
  assert.strictEqual(C.autoUnit(3, '杯').unit, '杯', '杯不换算');
  const rc = recipe('面粉 500 g\n牛奶 0.5 L');
  const on = C.scale(rc, factor(3));
  assert.strictEqual(on.items[0].text, '1.5 kg');
  const off = C.scale(rc, factor(3), { autoUnit: false });
  assert.strictEqual(off.items[0].text, '1500 g');
  assert.strictEqual(off.items[1].text, '1.5 L');
  assert.strictEqual(C.scale(recipe('糖 1 kg'), factor(0.25)).items[0].text, '250 g');
});

test('计数单位:同时给精确值与取整值', () => {
  const s = C.scale(recipe('鸡蛋 1 个\n苹果 2 个'), factor(2.5));
  assert.strictEqual(s.items[0].text, '2.5 个');
  assert.strictEqual(s.items[0].roundedText, '3 个');
  assert.strictEqual(s.items[1].text, '5 个');
  assert.strictEqual(s.items[1].roundedText, null);
});

test('杯/勺只在同单位内缩放,不会被换算', () => {
  const s = C.scale(recipe('面粉 1 杯\n糖 2 汤匙'), factor(2));
  assert.deepStrictEqual(s.items.map(i => i.text), ['2 杯', '4 汤匙']);
});

test('bakersPercent:基准、容积与文本、基准为 0 的保护', () => {
  const rc = recipe('面粉 500 g\n水 350 g\n盐 10 g\n牛奶 100 mL\n鸡蛋 1 个\n黄油 适量');
  const b = C.bakersPercent(rc, '面粉');
  assert.strictEqual(b.ok, true);
  assert.deepStrictEqual(b.rows.map(r => r.percent), [100, 70, 2, null, null, null]);
  assert.match(b.rows[3].reason, /容积/);
  assert.strictEqual(C.bakersPercent(recipe('面粉 0 g\n水 10 g'), '面粉').ok, false);
  assert.strictEqual(C.bakersPercent(recipe('面粉 2 杯'), '面粉').ok, false);
  assert.strictEqual(C.bakersPercent(rc, '').ok, false);
  const kg = C.bakersPercent(recipe('面粉 1 kg\n水 700 g'), '面粉');
  assert.strictEqual(kg.rows[1].percent, 70);
});

test('fromPercent:往返一致,并校验输入', () => {
  const rc = recipe('面粉 500 g\n水 330 g\n盐 10 g');
  const b = C.bakersPercent(rc, '面粉');
  const back = C.fromPercent(b.rows.map(r => ({ name: r.name, percent: r.percent })), b.base.grams);
  assert.strictEqual(back.ok, true);
  assert.deepStrictEqual(back.items.map(i => [i.name, i.qtyText, i.unit]), [['面粉', '500', 'g'], ['水', '330', 'g'], ['盐', '10', 'g']]);
  assert.strictEqual(back.baseName, '面粉');
  assert.strictEqual(C.fromPercent([{ name: '面粉', percent: 100 }], 0).ok, false);
  assert.strictEqual(C.fromPercent([{ name: '水', percent: 70 }], 500).ok, false, '没有 100% 基准');
  assert.strictEqual(C.fromPercent([], 500).ok, false);
  const p = C.parsePercentLines('面粉 100%\n水 | 72.5\n盐 2');
  assert.deepStrictEqual(p.items.map(i => i.percent), [100, 72.5, 2]);
  assert.strictEqual(C.fromPercent(p.items, 400).items[1].qtyText, '290');
});

test('CSV 与 Markdown 公式防护', () => {
  const rc = recipe('=cmd 1 个\n+SUM 2 个\n-x | 3 | g\n@a | 1 | g\n- | 1 | g\n普通 | 1 | g | =1+1');
  const s = C.scale(rc, factor(1));
  const csv = C.toCsv(s);
  const lines = csv.trim().split('\r\n');
  assert.ok(lines[1].startsWith("'=cmd"));
  assert.ok(lines[2].startsWith("'+SUM"));
  assert.ok(lines[3].startsWith("'-x"));
  assert.ok(lines[4].startsWith("'@a"));
  assert.ok(lines[5].startsWith('-,'), '单独的 - 不加前缀');
  assert.ok(lines[6].includes("'=1+1"));
  const md = C.toMarkdown(s);
  assert.ok(md.includes("| '=cmd |"));
  assert.ok(!/^\| =/m.test(md));
});

test('CSV 引号转义与 Markdown 管道转义', () => {
  const rc = recipe('甲,乙 | 1 | g | 说"好"');
  rc.ingredients.push({ name: '丙', qtyText: '2', unit: 'g', note: 'a|b' });
  const s = C.scale(rc, factor(1));
  assert.ok(C.toCsv(s).includes('"甲,乙"'));
  assert.ok(C.toCsv(s).includes('"说""好"""'));
  assert.ok(C.toMarkdown(s).includes('a\\|b'));
});

test('toMarkdown 含倍数、产量、不缩放标注与时间温度提示', () => {
  const md = C.toMarkdown(C.scale(recipe('面粉 100 g\n盐 适量'), factor(2)));
  assert.match(md, /^# 测试\(×2\)/);
  assert.match(md, /原 4 份 → 现 8 份/);
  assert.match(md, /不缩放/);
  assert.match(md, /烘焙时间和温度不会随份数/);
});

test('空配方:解析、缩放、导出都不报错', () => {
  const rc = recipe('');
  const s = C.scale(rc, factor(2));
  assert.strictEqual(s.ok, true);
  assert.deepStrictEqual(s.items, []);
  assert.ok(C.toMarkdown(s).includes('没有配料'));
  assert.strictEqual(C.toCsv(s).trim().split('\r\n').length, 1);
  assert.strictEqual(C.scale(rc, 0).ok, false);
});

const good = () => ({ app: 'recipe-scaler', version: 1, recipes: [{ id: 'a', name: '吐司', yieldAmount: 2, yieldUnit: '份', baseName: '面粉', notes: '', ingredients: [{ name: '面粉', qtyText: '500', unit: 'g', note: '' }] }] });

test('validateImport:合法数据通过,往返一致', () => {
  const v = C.validateImport(JSON.stringify(good()));
  assert.strictEqual(v.ok, true);
  assert.deepStrictEqual(v.value.recipes, good().recipes);
  assert.strictEqual(C.validateImport(C.makeBackup([])).ok, true);
});

test('validateImport:单位枚举、ID 唯一、类型、基准名都会整份拒绝', () => {
  const badUnit = good(); badUnit.recipes[0].ingredients[0].unit = '桶';
  const r1 = C.validateImport(badUnit);
  assert.strictEqual(r1.ok, false);
  assert.match(r1.errors.join(' '), /单位/);
  const dup = good(); dup.recipes.push(JSON.parse(JSON.stringify(dup.recipes[0])));
  assert.match(C.validateImport(dup).errors.join(' '), /重复/);
  const yu = good(); yu.recipes[0].yieldUnit = '桶';
  assert.strictEqual(C.validateImport(yu).ok, false);
  const ya = good(); ya.recipes[0].yieldAmount = '2';
  assert.strictEqual(C.validateImport(ya).ok, false);
  const bn = good(); bn.recipes[0].baseName = '不存在';
  assert.strictEqual(C.validateImport(bn).ok, false);
  const app = good(); app.app = 'x';
  assert.strictEqual(C.validateImport(app).ok, false);
  assert.strictEqual(C.validateImport('{坏').ok, false);
  assert.strictEqual(C.validateImport([]).ok, false);
  const proto = JSON.parse('{"app":"recipe-scaler","version":1,"recipes":[{"id":"__proto__","name":"x","yieldAmount":1,"yieldUnit":"份","baseName":"","ingredients":[]}]}');
  assert.strictEqual(C.validateImport(proto).ok, true);
});

test('unit 别名:克、毫升、cup 都归一', () => {
  assert.strictEqual(C.normalizeUnit('克'), 'g');
  assert.strictEqual(C.normalizeUnit('ml'), 'mL');
  assert.strictEqual(C.normalizeUnit('Cup'), '杯');
  assert.strictEqual(C.normalizeUnit('constructor'), null);
  assert.strictEqual(C.normalizeUnit(''), '');
});

test('validateImport 草稿:名称可空的配方在自动保存、备份导入两条路径上都能恢复', () => {
  const d = good(); d.recipes[0].name = '';
  assert.strictEqual(C.validateImport(d).ok, true, '备份导入与草稿共用契约,允许空名称');
  const draft = C.validateImport(d, { draft: true });
  assert.strictEqual(draft.ok, true);
  assert.strictEqual(draft.value.recipes[0].name, '');
  const badUnit = good(); badUnit.recipes[0].name = ''; badUnit.recipes[0].ingredients[0].unit = '桶';
  assert.strictEqual(C.validateImport(badUnit, { draft: true }).ok, false, '草稿模式不放宽其他校验');
});

test('parseYield:0、负数、非法文本、范围都给出原因而不是静默', () => {
  assert.deepStrictEqual([C.parseYield('12').ok, C.parseYield('12').value], [true, 12]);
  assert.strictEqual(C.parseYield('1/2').value, 0.5);
  ['0', '-3', 'abc', '', '2-3', '1/0'].forEach(t => {
    const r = C.parseYield(t);
    assert.strictEqual(r.ok, false, t);
    assert.ok(r.reason.length > 0);
  });
});

test('备份往返:含空名称草稿的备份导出后可直接正式导入(同一份数据契约)', () => {
  const draft = C.emptyRecipe();
  const named = recipe('面粉 | 500 | g');
  const backup = JSON.stringify(C.makeBackup([draft, named]));
  const back = C.validateImport(backup);
  assert.strictEqual(back.ok, true, back.errors && back.errors.join(';'));
  assert.strictEqual(back.value.recipes.length, 2);
  assert.strictEqual(back.value.recipes[0].name, '');
  const tooLong = C.makeBackup([Object.assign(C.emptyRecipe(), { name: 'x'.repeat(121) })]);
  assert.strictEqual(C.validateImport(tooLong).ok, false, '超长名称仍拒绝');
  const notStr = C.makeBackup([Object.assign(C.emptyRecipe(), { name: 5 })]);
  assert.strictEqual(C.validateImport(notStr).ok, false, '非字符串名称仍拒绝');
});

test('importPlan:预览新增与覆盖的数量和名称,不修改原数组', () => {
  const existing = [recipe('面粉 | 1 | kg', { id: 'a', name: '旧A' }), recipe('糖 | 1 | kg', { id: 'b', name: '旧B' })];
  const incoming = [recipe('面粉 | 2 | kg', { id: 'a', name: '新A' }), recipe('盐 | 1 | g', { id: 'c', name: '新C' })];
  const snapshot = JSON.stringify(existing);
  const plan = C.importPlan(existing, incoming);
  assert.strictEqual(plan.added.length, 1);
  assert.strictEqual(plan.replaced.length, 1);
  assert.strictEqual(plan.added[0].name, '新C');
  assert.strictEqual(plan.replaced[0].oldName, '旧A');
  assert.strictEqual(plan.replaced[0].newName, '新A');
  assert.strictEqual(JSON.stringify(existing), snapshot, '预览不修改现有数据');
  assert.deepStrictEqual(C.importPlan([], []).added, []);
});
