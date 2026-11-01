'use strict';
/* js/stats.js 计算层测试。
 * 用法：node --test tests/stats.test.cjs
 *
 * stats.js 是依赖 window.CW 的经典脚本，store.js 又是一个带存储副作用的 IIFE，
 * 所以这里不整体加载 store.js：只取它开头的 dateKey / parseKey / addDays 三个日期工具，
 * 与 stats.js 一起放进 vm 沙箱，并把沙箱里的 Date 固定在指定的“今天”。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const storeSrc = fs.readFileSync(path.join(ROOT, 'js', 'store.js'), 'utf8');
const statsSrc = fs.readFileSync(path.join(ROOT, 'js', 'stats.js'), 'utf8');

const dateUtilsMatch = storeSrc.match(/function dateKey[\s\S]*?(?=\nfunction diffDays)/);
assert.ok(dateUtilsMatch, 'store.js 开头应有 dateKey/parseKey/addDays，且后面紧跟 diffDays');
const dateUtilsSrc = dateUtilsMatch[0];
for (const name of ['dateKey', 'parseKey', 'addDays']) {
  assert.match(dateUtilsSrc, new RegExp('function ' + name + '\\('), 'store.js 缺少 ' + name);
}

/** 载入 stats.js，沙箱里的 `new Date()` 固定为 now（本地时间）。 */
function loadStats(now) {
  const RealDate = Date;
  const fixedMs = now.getTime();
  class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixedMs);
      else super(...args);
    }
    static now() { return fixedMs; }
  }
  const sandbox = { window: {}, Date: FixedDate };
  vm.createContext(sandbox);
  vm.runInContext(dateUtilsSrc + '\nwindow.CW = { dateKey, parseKey, addDays };', sandbox);
  vm.runInContext(statsSrc, sandbox);
  const CW = sandbox.window.CW;
  CW.now = () => new FixedDate(); // 测试侧取“今天”也要用沙箱的固定 Date，不能用外面的真 Date
  return CW;
}

/** 以 CW.now()（固定的“今天”）为基准，生成相对今天偏移 offsets 天的日志。 */
function logsAt(CW, offsets, value = 5) {
  const logs = {};
  const today = CW.now();
  for (const off of offsets) {
    logs[CW.dateKey(CW.addDays(today, off))] = { value, note: '', ts: 0 };
  }
  return logs;
}

const noon = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0);
const plain = (x) => JSON.parse(JSON.stringify(x)); // 抹掉 vm 跨 realm 的原型差异

function withTZ(tz, fn) {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  try { return fn(); }
  finally {
    if (prev === undefined) delete process.env.TZ;
    else process.env.TZ = prev;
  }
}

test('固定 Date 生效：沙箱里的“今天”就是指定日期', () => {
  const CW = loadStats(noon(2026, 6, 15));
  assert.equal(CW.dateKey(CW.now()), '2026-06-15');
  assert.equal(CW.dateKey(CW.addDays(CW.now(), -15)), '2026-05-31');
});

test('连续：今天起往回连续 3 天', () => {
  const CW = loadStats(noon(2026, 6, 15));
  const r = plain(CW.computeStreaks(logsAt(CW, [0, -1, -2])));
  assert.deepEqual(r, { current: 3, best: 3, total: 3, sum: 15 });
});

test('今天未打卡的宽限：昨天打了仍计入当前连续', () => {
  const CW = loadStats(noon(2026, 6, 15));
  const r = plain(CW.computeStreaks(logsAt(CW, [-1, -2])));
  assert.equal(r.current, 2);
  assert.equal(r.best, 2);
});

test('今天和昨天都没打卡：当前连续清零，历史最长保留', () => {
  const CW = loadStats(noon(2026, 6, 15));
  const r = plain(CW.computeStreaks(logsAt(CW, [-2, -3])));
  assert.equal(r.current, 0);
  assert.equal(r.best, 2);
  assert.equal(r.total, 2);
});

test('断签后最长保留：旧的 5 连比新的 2 连长', () => {
  const CW = loadStats(noon(2026, 6, 15));
  const r = plain(CW.computeStreaks(logsAt(CW, [-14, -13, -12, -11, -10, -1, 0])));
  assert.equal(r.current, 2);
  assert.equal(r.best, 5);
  assert.equal(r.total, 7);
});

test('storedLongest 比实际更长时，best 取已存的历史峰值', () => {
  const CW = loadStats(noon(2026, 6, 15));
  const r = plain(CW.computeStreaks(logsAt(CW, [0, -1]), 9));
  assert.equal(r.current, 2);
  assert.equal(r.best, 9);
});

test('跨月：5/30 到 6/2 连续 4 天', () => {
  const CW = loadStats(noon(2026, 6, 2));
  const logs = {};
  for (const k of ['2026-05-30', '2026-05-31', '2026-06-01', '2026-06-02']) logs[k] = { value: 3, note: '', ts: 0 };
  const r = plain(CW.computeStreaks(logs));
  assert.equal(r.current, 4);
  assert.equal(r.best, 4);
});

test('跨年和闰日：12/31 到 1/1，2/28 到 3/1（闰年有 2/29）', () => {
  const year = loadStats(noon(2026, 1, 1));
  const y = plain(year.computeStreaks({
    '2025-12-31': { value: 1, note: '', ts: 0 },
    '2026-01-01': { value: 1, note: '', ts: 0 },
  }));
  assert.equal(y.current, 2);

  const leap = loadStats(noon(2028, 3, 1));
  const l = plain(leap.computeStreaks({
    '2028-02-28': { value: 1, note: '', ts: 0 },
    '2028-02-29': { value: 1, note: '', ts: 0 },
    '2028-03-01': { value: 1, note: '', ts: 0 },
  }));
  assert.equal(l.current, 3);
  assert.equal(l.best, 3);
});

test('夏令时切换日：美东春季跳时（3/8）和秋季回拨（11/1）不拆开连续天数', () => {
  withTZ('America/New_York', () => {
    const spring = loadStats(noon(2026, 3, 9));
    const s = plain(spring.computeStreaks(logsAt(spring, [-2, -1, 0])));
    assert.equal(s.current, 3, '3/7、3/8、3/9 应连续');
    assert.equal(s.best, 3);

    const fall = loadStats(noon(2026, 11, 2));
    const f = plain(fall.computeStreaks(logsAt(fall, [-2, -1, 0])));
    assert.equal(f.current, 3, '10/31、11/1、11/2 应连续');
    assert.equal(f.best, 3);
  });
});

test('夏令时切换日：欧洲（Europe/Berlin）同样不拆开', () => {
  withTZ('Europe/Berlin', () => {
    const spring = loadStats(noon(2026, 3, 30));
    const s = plain(spring.computeStreaks(logsAt(spring, [-2, -1, 0])));
    assert.equal(s.current, 3, '3/28、3/29（跳时）、3/30 应连续');

    const fall = loadStats(noon(2026, 10, 26));
    const f = plain(fall.computeStreaks(logsAt(fall, [-2, -1, 0])));
    assert.equal(f.current, 3, '10/24、10/25（回拨）、10/26 应连续');
  });
});

test('0 值不算打卡：只有今天填 0，当前连续为 0、累计为 0', () => {
  const CW = loadStats(noon(2026, 6, 15));
  const r = plain(CW.computeStreaks(logsAt(CW, [0], 0)));
  assert.deepEqual(r, { current: 0, best: 0, total: 0, sum: 0 });
});

test('0 值不算打卡：今天填 0 时，昨天的真实打卡仍享受宽限', () => {
  const CW = loadStats(noon(2026, 6, 15));
  const logs = { ...logsAt(CW, [-1], 5), ...logsAt(CW, [0], 0) };
  const r = plain(CW.computeStreaks(logs));
  assert.equal(r.current, 1);
  assert.equal(r.total, 1);
});

test('0 值会断开连续：中间一天是 0，当前连续和最长都按 0 切断', () => {
  const CW = loadStats(noon(2026, 6, 15));
  const logs = { ...logsAt(CW, [-3, -2, 0], 5), ...logsAt(CW, [-1], 0) };
  const r = plain(CW.computeStreaks(logs));
  assert.equal(r.current, 1);
  assert.equal(r.best, 2);
  assert.equal(r.total, 3);
  assert.equal(r.sum, 15);
});

test('0 值不会撑高历史最长：一串全是 0 的记录 best 仍为 0', () => {
  const CW = loadStats(noon(2026, 6, 15));
  const r = plain(CW.computeStreaks(logsAt(CW, [0, -1, -2, -3, -4], 0)));
  assert.equal(r.best, 0);
  assert.equal(r.total, 0);
});

test('异常值不算打卡：NaN、空字符串、负数、缺 value', () => {
  const CW = loadStats(noon(2026, 6, 15));
  const k = (off) => CW.dateKey(CW.addDays(CW.now(), off));
  const logs = {
    [k(0)]: { value: NaN, note: '', ts: 0 },
    [k(-1)]: { value: '', note: '', ts: 0 },
    [k(-2)]: { value: -3, note: '', ts: 0 },
    [k(-3)]: { note: '', ts: 0 },
  };
  const r = plain(CW.computeStreaks(logs));
  assert.equal(r.current, 0);
  assert.equal(r.best, 0);
  assert.equal(r.total, 0);
});

test('数字字符串按数值判断：旧数据里的 "3" 算打卡，"0" 不算', () => {
  const CW = loadStats(noon(2026, 6, 15));
  const k = (off) => CW.dateKey(CW.addDays(CW.now(), off));
  const r = plain(CW.computeStreaks({
    [k(0)]: { value: '3', note: '', ts: 0 },
    [k(-1)]: { value: '0', note: '', ts: 0 },
  }));
  assert.equal(r.current, 1);
  assert.equal(r.total, 1);
});

test('空数据：全部为 0；storedLongest 仍然保留', () => {
  const CW = loadStats(noon(2026, 6, 15));
  assert.deepEqual(plain(CW.computeStreaks({})), { current: 0, best: 0, total: 0, sum: 0 });
  assert.equal(plain(CW.computeStreaks({}, 4)).best, 4);
});

test('分级阈值：1..10 的四分位阈值为 3 / 6 / 9', () => {
  const CW = loadStats(noon(2026, 6, 15));
  const logs = {};
  for (let i = 1; i <= 10; i++) logs['2026-05-' + String(i).padStart(2, '0')] = { value: i, note: '', ts: 0 };
  const level = CW.buildLeveler(logs);
  assert.deepEqual([0, 1, 3, 4, 6, 7, 9, 10, 99].map(level), [0, 1, 1, 2, 2, 3, 3, 4, 4]);
});

test('分级阈值：0 值不进入分位计算，所以加上 0 记录阈值不变', () => {
  const CW = loadStats(noon(2026, 6, 15));
  const base = {};
  for (let i = 1; i <= 10; i++) base['2026-05-' + String(i).padStart(2, '0')] = { value: i, note: '', ts: 0 };
  const withZeros = { ...base };
  for (let i = 11; i <= 20; i++) withZeros['2026-05-' + String(i)] = { value: 0, note: '', ts: 0 };
  const a = CW.buildLeveler(base), b = CW.buildLeveler(withZeros);
  for (const v of [0, 1, 3, 4, 6, 7, 9, 10]) assert.equal(b(v), a(v), '值 ' + v);
});

test('分级阈值：空数据恒为 0；单个值落在 1 级；0、负数、NaN、空值为 0 级', () => {
  const CW = loadStats(noon(2026, 6, 15));
  const empty = CW.buildLeveler({});
  assert.deepEqual([0, 5, 100].map(empty), [0, 0, 0]);

  const single = CW.buildLeveler({ '2026-05-01': { value: 7, note: '', ts: 0 } });
  assert.equal(single(7), 1);
  assert.deepEqual([0, -1, NaN, null, undefined].map(single), [0, 0, 0, 0, 0]);
});
