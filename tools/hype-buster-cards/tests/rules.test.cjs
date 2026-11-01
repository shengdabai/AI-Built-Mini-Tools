'use strict';
/* rules-engine.js 规则引擎 + 案例数据测试。
 * 用法：node --test tests/rules.test.cjs
 *
 * rules-engine.js 是挂到 window.HBRules 的经典脚本；在 vm 沙箱里没有 window，
 * 它会挂到沙箱的全局对象上，所以这里直接从沙箱取 HBRules，无需浏览器。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function loadRules() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'rules-engine.js'), 'utf8'), ctx, { filename: 'rules-engine.js' });
  assert.ok(ctx.HBRules, 'rules-engine.js 应导出 HBRules');
  return ctx.HBRules;
}
const R = loadRules();

const SAFE = { q_strip_expertise: 'yes', q_one_sentence: 'yes', q_replaceable_tool: 'no', q_fear_marketing: 'no', q_survivor_proof: 'no' };
const DANGER = { q_strip_expertise: 'no', q_one_sentence: 'no', q_replaceable_tool: 'yes', q_fear_marketing: 'yes', q_survivor_proof: 'yes' };

/* ---------- 三维归一化 ---------- */
test('normalizeWeights：滑杆所有整数组合（0–100）三项都不为负、且相加恰好 100', () => {
  const bad = [];
  for (let e = 0; e <= 100; e++) {
    for (let t = 0; t <= 100; t++) {
      for (let k = 0; k <= 100; k++) {
        const w = R.normalizeWeights({ expertise: e, tool: t, trick: k });
        if (w.expertise < 0 || w.tool < 0 || w.trick < 0 || w.expertise + w.tool + w.trick !== 100) {
          if (bad.length < 5) bad.push([e, t, k, w.expertise, w.tool, w.trick]);
          else { bad.push('…'); break; }
        }
      }
      if (bad.length > 5) break;
    }
    if (bad.length > 5) break;
  }
  assert.deepEqual(bad, [], '出现负占比或总和不为 100 的组合（输入 e,t,k → 输出 e,t,k）');
});

test('normalizeWeights：技巧滑杆为 0、另两项都恰好 .5 时不显示 -1%（1/7/0 回归）', () => {
  const w = R.normalizeWeights({ expertise: 1, tool: 7, trick: 0 });
  assert.equal(w.trick, 0);
  assert.equal(w.expertise + w.tool, 100);
  assert.ok(Math.abs(w.expertise - 12.5) <= 0.5 && Math.abs(w.tool - 87.5) <= 0.5, JSON.stringify(w));
});

test('normalizeWeights：全 0 给中性默认值；非数字和负数按 0 处理', () => {
  assert.deepEqual({ ...R.normalizeWeights({ expertise: 0, tool: 0, trick: 0 }) }, { expertise: 34, tool: 33, trick: 33 });
  assert.deepEqual({ ...R.normalizeWeights({}) }, { expertise: 34, tool: 33, trick: 33 });
  assert.deepEqual({ ...R.normalizeWeights({ expertise: 'abc', tool: -5, trick: 10 }) }, { expertise: 0, tool: 0, trick: 100 });
  assert.deepEqual({ ...R.normalizeWeights({ expertise: '50', tool: 50, trick: 0 }) }, { expertise: 50, tool: 50, trick: 0 });
});

test('normalizeWeights：没有出现 .5 双进位的输入结果保持原样（修复不改变正常组合）', () => {
  assert.deepEqual({ ...R.normalizeWeights({ expertise: 34, tool: 33, trick: 33 }) }, { expertise: 34, tool: 33, trick: 33 });
  assert.deepEqual({ ...R.normalizeWeights({ expertise: 1, tool: 1, trick: 1 }) }, { expertise: 33, tool: 33, trick: 34 });
  assert.deepEqual({ ...R.normalizeWeights({ expertise: 2, tool: 1, trick: 0 }) }, { expertise: 67, tool: 33, trick: 0 });
});

/* ---------- 评分与判定 ---------- */
test('computeHealthScore：任一依附性追问未回答就报错', () => {
  assert.throws(() => R.computeHealthScore({ expertise: 34, tool: 33, trick: 33 }, {}), /请回答全部依附性追问/);
  const partial = { ...SAFE };
  delete partial.q_survivor_proof;
  assert.throws(() => R.computeHealthScore({ expertise: 34, tool: 33, trick: 33 }, partial), /请回答全部依附性追问/);
  assert.throws(() => R.computeHealthScore({ expertise: 34, tool: 33, trick: 33 }, { ...SAFE, q_one_sentence: 'maybe' }), /请回答全部依附性追问/);
});

test('computeHealthScore：默认滑杆 + 全部安全回答 = 50 分（基线）', () => {
  assert.equal(R.computeHealthScore({ expertise: 34, tool: 33, trick: 33 }, SAFE), 50);
});

test('computeHealthScore：每个危险回答扣掉题库里写的分数', () => {
  for (const q of R.DEPENDENCY_QUESTIONS) {
    const answers = { ...SAFE, [q.id]: q.dangerAnswer };
    const penalty = q.dangerAnswer === 'no' ? q.penaltyOnNo : q.penaltyOnYes;
    assert.ok(penalty > 0, q.id + ' 的危险回答应有扣分');
    assert.equal(R.computeHealthScore({ expertise: 34, tool: 33, trick: 33 }, answers), 50 - penalty, q.id);
  }
});

test('computeHealthScore：结果收口在 0–100', () => {
  assert.equal(R.computeHealthScore({ expertise: 34, tool: 33, trick: 33 }, DANGER), 0);
  assert.equal(R.computeHealthScore({ expertise: 100, tool: 0, trick: 0 }, SAFE), 100);
  for (const w of [{ expertise: 0, tool: 0, trick: 100 }, { expertise: 0, tool: 100, trick: 0 }, { expertise: 7, tool: 90, trick: 3 }]) {
    for (const ans of [SAFE, DANGER]) {
      const s = R.computeHealthScore(w, ans);
      assert.ok(Number.isInteger(s) && s >= 0 && s <= 100, JSON.stringify({ w, s }));
    }
  }
});

test('verdictFromScore：66 起为值得学，38–65 谨慎，37 及以下别交学费', () => {
  assert.equal(R.verdictFromScore(100), 'buy');
  assert.equal(R.verdictFromScore(66), 'buy');
  assert.equal(R.verdictFromScore(65), 'caution');
  assert.equal(R.verdictFromScore(38), 'caution');
  assert.equal(R.verdictFromScore(37), 'skip');
  assert.equal(R.verdictFromScore(0), 'skip');
  for (const v of ['buy', 'caution', 'skip']) assert.ok(R.VERDICT_META[v] && R.VERDICT_META[v].label, v + ' 应有展示文案');
});

test('DEPENDENCY_QUESTIONS：id 唯一，每题的危险回答都有对应扣分字段', () => {
  const ids = R.DEPENDENCY_QUESTIONS.map(q => q.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const q of R.DEPENDENCY_QUESTIONS) {
    assert.ok(['yes', 'no'].includes(q.dangerAnswer), q.id);
    assert.ok(q.text && q.hint, q.id + ' 缺题干或提示');
    assert.ok(q.dangerAnswer === 'no' ? q.penaltyOnNo > 0 : q.penaltyOnYes > 0, q.id);
  }
});

/* ---------- 理由与类比 ---------- */
test('buildReason：三种判定的理由都引用归一化后的占比', () => {
  const w = { expertise: 60, tool: 30, trick: 10 };
  assert.match(R.buildReason(w, SAFE, 'buy'), /底层专业占比 60%/);
  assert.match(R.buildReason(w, SAFE, 'caution'), /专业 60%/);
  assert.match(R.buildReason(w, SAFE, 'caution'), /合计 40%/);
  assert.match(R.buildReason(w, { ...SAFE, q_strip_expertise: 'no' }, 'skip'), /^抽掉真专业后它就立不住/);
  assert.match(R.buildReason(w, { ...SAFE, q_one_sentence: 'no' }, 'skip'), /^它连一句人话都说不清/);
  assert.match(R.buildReason({ expertise: 10, tool: 20, trick: 70 }, SAFE, 'skip'), /^技巧\/话术占了 70%/);
});

test('buildAnalogy：按技巧占比选模板，空概念用「这个概念」', () => {
  assert.match(R.buildAnalogy('提示工程师', { expertise: 10, tool: 10, trick: 80 }), /^把「提示工程师」当成一个独立职业/);
  assert.match(R.buildAnalogy('提示工程师', { expertise: 40, tool: 20, trick: 40 }), /^「提示工程师」之于真专业/);
  assert.match(R.buildAnalogy('提示工程师', { expertise: 80, tool: 10, trick: 10 }), /^如果「提示工程师」成立/);
  assert.match(R.buildAnalogy('   ', { expertise: 80, tool: 10, trick: 10 }), /「这个概念」/);
  assert.match(R.buildAnalogy(undefined, { expertise: 80, tool: 10, trick: 10 }), /「这个概念」/);
});

/* ---------- 主入口 ---------- */
test('evaluate：确定性；输出归一化权重、分数、判定、理由、类比', () => {
  const input = { concept: '  全栈增长黑客 ', weights: { expertise: 10, tool: 30, trick: 60 }, dependencyAnswers: { ...SAFE, q_fear_marketing: 'yes' } };
  const a = R.evaluate(input);
  const b = R.evaluate(input);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.equal(a.concept, '全栈增长黑客');
  assert.equal(a.weights.expertise + a.weights.tool + a.weights.trick, 100);
  assert.equal(a.verdict, R.verdictFromScore(a.score));
  assert.equal(a.reason, R.buildReason(a.weights, a.dependencyAnswers, a.verdict));
  assert.match(a.analogy, /全栈增长黑客/);
  assert.throws(() => R.evaluate({ concept: 'x', weights: {} }), /请回答全部依附性追问/);
});

/* ---------- 案例数据 ---------- */
function loadEmbeddedCases() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.includes('HB_EMBEDDED_CASES'));
  assert.equal(blocks.length, 1, 'index.html 应有且只有一段内嵌案例脚本');
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(blocks[0], ctx);
  return JSON.parse(JSON.stringify(ctx.window.HB_EMBEDDED_CASES));
}
const CASES = JSON.parse(fs.readFileSync(path.join(ROOT, 'cases.json'), 'utf8'));

test('cases.json：id 唯一，每题恰好一个正确选项，有讲解', () => {
  assert.ok(Array.isArray(CASES) && CASES.length > 0);
  const ids = CASES.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length, 'id 重复');
  for (const c of CASES) {
    assert.ok(c.title && c.prompt && c.explanation, c.id + ' 缺标题、题干或讲解');
    assert.ok(Array.isArray(c.options) && c.options.length >= 2, c.id + ' 选项不足');
    assert.equal(c.options.filter(o => o.correct === true).length, 1, c.id + ' 应恰好一个正确选项');
    const labels = c.options.map(o => o.label);
    assert.equal(new Set(labels).size, labels.length, c.id + ' 选项标签重复');
  }
});

test('内嵌兜底案例与 cases.json 内容一致（file:// 与 http 打开看到同一套题）', () => {
  // 两份文本只允许引号写法不同：内嵌版用弯引号“”，cases.json 用直引号 "。
  const norm = s => JSON.stringify(s).replace(/[“”]|\\"/g, '"');
  const embedded = loadEmbeddedCases();
  assert.equal(embedded.length, CASES.length, '案例数量不一致');
  for (let i = 0; i < CASES.length; i++) {
    assert.equal(norm(embedded[i]), norm(CASES[i]), '第 ' + (i + 1) + ' 题（' + CASES[i].id + '）内容不一致');
  }
});
