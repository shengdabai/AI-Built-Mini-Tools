'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const regex = require('../../regex-example-tester/core.js');

function cell(csv, row = 0, column = 0) {
  const parsed = regex.parseCsv(csv);
  assert.equal(parsed.ok, true, parsed.error);
  return parsed.rows[row][column];
}

const guards = {
  'multi-dimension-radar': (c, v) => cell(c.csvCell(v)),
  'cause-effect-chain': (c, v) => c.guard(v),
  'concept-card-library': (c, v) => c.guardCell(v),
  'jtbd-statement-board': (c, v) => c.guardCell(v),
  'quote-version-diff': (c, v) => cell(c.toCsv([[v]])),
  'recipe-scaler': (c, v) => c.guardCell(v),
  'receivables-followup': (c, v) => cell(c.csvCell(v)),
  'invoice-order-diff': (c, v) => c.guardFormula(v),
  'half-second-script-practice': (c, v) => c.guardCell(v),
  'paragraph-reader': (c, v) => c.protect(v),
  'template-batch-fill': (c, v) => cell(c.toCsv(['value'], [
    { values: { value: v }, text: '', missing: [] }
  ]), 1),
  'regex-example-tester': (c, v) => cell(c.toCsv([
    { input: v, expect: 'match', captures: [] }
  ]), 1),
  'multi-sheet-dedupe': (c, v) => cell(c.csvCell(v)),
  'feature-ladder-board': (c, v) => cell(c.toCsv({ features: [
    { id: 'f1', name: v, task: '', gate: 'self', moscow: 'must', hours: 1,
      deps: [], layer: '', status: 'todo' }
  ] }), 1, 1),
  'file-integrity-manifest': (c, v) => cell(c.toCsv({ files: [
    { path: v, size: 0, sha256: 'a'.repeat(64), mtime: '' }
  ] }), 1)
};

for (const [name, guard] of Object.entries(guards)) {
  const core = require('../../' + name + '/core.js');
  test(name + ': CSV control prefixes cannot expose spreadsheet formulas', () => {
    for (const prefix of ['\t', '\r', '\t\r']) {
      for (const formula of ['=1+1', '+1+1', '-1+1', '@SUM(1)']) {
        const input = prefix + formula;
        assert.equal(guard(core, input), "'" + input, JSON.stringify(input));
      }
    }
    for (const text of ['普通文字', 'a\tb', 'a\rb', '+', '-']) {
      assert.equal(guard(core, text), text, JSON.stringify(text));
    }
  });
}

test('regex CSV imports restore exactly one protection prefix', () => {
  for (const input of ['\t=1+1', "'\t=1+1", "''\t=1+1", 'a\tb']) {
    const cases = [{ input, expect: 'match', captures: [] }];
    const imported = regex.csvToCases(regex.toCsv(cases));
    assert.equal(imported.ok, true);
    assert.deepEqual(imported.cases, cases);
  }
});

test('manifest CSV imports preserve control characters and existing apostrophes', () => {
  const core = require('../../file-integrity-manifest/core.js');
  for (const path of ['\t=1+1', '\r=1+1', "'\t=1+1", "''\r=1+1", '=\n1', "'=\n1"]) {
    const files = [{ path, size: 0, sha256: 'a'.repeat(64), mtime: '' }];
    assert.equal(core.parseManifest(core.toCsv({ files })).files[0].path, path);
  }
});

test('legacy CSV imports retain literal apostrophes before controls', () => {
  const input = "'\t=1+1";
  const imported = regex.csvToCases('输入,期望,期望捕获\r\n' + input + ',匹配,\r\n');
  assert.equal(imported.ok, true);
  assert.equal(imported.cases[0].input, input);
  const core = require('../../file-integrity-manifest/core.js');
  const csv = '路径,大小,sha256,修改时间\n' + input + ',0,' + 'a'.repeat(64) + ',\n';
  assert.equal(core.parseManifest(csv).files[0].path, input);
});

test('Anki CSV encodes leading controls as HTML entities on both card sides', () => {
  const core = require('../../mistake-review-loop/core.js');
  for (const [prefix, entity] of [['\t', '&#9;'], ['\r', '&#13;']]) {
    const csv = core.toAnkiCSV([{ wrong: prefix + '=1+1', correct: prefix + '@SUM(1)', tag: 'other' }]);
    assert.equal(cell(csv, 3), entity + '=1+1');
    assert.ok(cell(csv, 3, 1).startsWith(entity + '@SUM(1)<br>'));
    assert.ok(csv.includes('#html:true'));
  }
});
