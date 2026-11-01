'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const sc = (o) => Object.assign({ id: 's1', name: 'a', r: 0.01, days: 365, restDaysPerWeek: 0, events: [] }, o);
const st = (o) => Object.assign(C.defaultState(), o);

test('simulate: r=0 恒为 1', () => {
  const s = C.simulate({ r: 0, days: 100 });
  assert.ok(s.series.every(p => p.value === 1));
  assert.equal(s.final, 1);
});

test('simulate: r=1% 365 天约 37.78', () => {
  const s = C.simulate({ r: 0.01, days: 365 });
  assert.equal(s.final, 37.783434);
});

test('series 长度 = days+1,首点为第 0 天 = 1', () => {
  const s = C.simulate({ r: 0.01, days: 30 });
  assert.equal(s.series.length, 31);
  assert.deepEqual(s.series[0], { day: 0, value: 1 });
  assert.equal(s.series[30].day, 30);
});

test('休息日跳过:每周休 2 天 = 每周只涨 5 天(第 6、7 天不涨)', () => {
  const s = C.simulate({ r: 0.1, days: 7, restDaysPerWeek: 2 });
  assert.equal(s.series[5].value, 1.61051);
  assert.equal(s.series[6].value, 1.61051);
  assert.equal(s.series[7].value, 1.61051);
  const t = C.simulate({ r: 0.1, days: 8, restDaysPerWeek: 2 });
  assert.equal(t.series[8].value, 1.771561);
});

test('事件回退:第 D 天乘以 k,且发生在当天增长之后', () => {
  const s = C.simulate({ r: 0.01, days: 10, events: [{ day: 5, factor: 0.5 }] });
  assert.equal(s.series[4].value, C.round6(1.01 ** 4));
  assert.equal(s.series[5].value, C.round6(1.01 ** 5 * 0.5));
  assert.equal(s.series[10].value, C.round6(1.01 ** 10 * 0.5));
});

test('同一天多个事件相乘', () => {
  const s = C.simulate({ r: 0, days: 3, events: [{ day: 2, factor: 0.5 }, { day: 2, factor: 0.5 }] });
  assert.equal(s.final, 0.25);
});

test('simulate 拒绝非法输入', () => {
  assert.throws(() => C.simulate({ r: NaN, days: 10 }), TypeError);
  assert.throws(() => C.simulate({ r: 0.01, days: 10.5 }), RangeError);
  assert.throws(() => C.simulate({ r: 0.01, days: 10, restDaysPerWeek: 7 }), RangeError);
});

test('linear 对照:每天 +r,休息日不加', () => {
  const l = C.linear(0.01, 365);
  assert.equal(l.final, 4.65);
  assert.equal(l.series.length, 366);
  assert.equal(C.linear(0.1, 7, 2).final, 1.5);
  assert.ok(C.simulate({ r: 0.01, days: 365 }).final > l.final);
});

test('daysToReach 可达:1% 到 2 倍需 70 天,与 simulate 一致', () => {
  const d = C.daysToReach(0.01, 2);
  assert.equal(d, 70);
  const s = C.simulate({ r: 0.01, days: 70 });
  assert.ok(s.series[70].value >= 2 && s.series[69].value < 2);
});

test('daysToReach 休息日更慢;事件回退更慢', () => {
  const rest = C.daysToReach(0.01, 2, 2);
  assert.ok(rest > 70);
  const s = C.simulate({ r: 0.01, days: rest, restDaysPerWeek: 2 });
  assert.ok(s.series[rest].value >= 2 && s.series[rest - 1].value < 2);
  assert.ok(C.daysToReach(0.01, 2, 0, [{ day: 30, factor: 0.5 }]) > 70);
});

test('daysToReach 不可达:r=0 → null;目标 ≤1 → 0;极小 r 仍给出有限天数', () => {
  assert.equal(C.daysToReach(0, 2), null);
  assert.equal(C.daysToReach(0.01, 1), 0);
  assert.equal(C.daysToReach(1e-7, 10), Math.ceil(Math.log(10) / Math.log1p(1e-7)));
  assert.equal(C.daysToReach(0, 2, 0, [{ day: 5, factor: 3 }]), 5);
});

test('weeklyEquivalent:(1+r)^7-1', () => {
  assert.equal(C.weeklyEquivalent(0.01), 0.072135352107);
  assert.equal(C.weeklyEquivalent(0), 0);
  const w = C.weeklyEquivalent(0.01);
  assert.ok(Math.abs(C.dailyEquivalent(w) - 0.01) < 1e-9);
});

test('周频模拟:每满 7 天乘一次', () => {
  const s = C.simulate({ r: 0.1, days: 14, frequency: 'weekly' });
  assert.equal(s.series[6].value, 1);
  assert.equal(s.series[7].value, 1.1);
  assert.equal(s.series[14].value, 1.21);
  const d = C.simulate({ r: C.dailyEquivalent(0.1), days: 14 });
  assert.ok(Math.abs(d.final - s.final) < 1e-5);
});

test('compare:按 T 天后倍数排序,给出差值与达到 2× 天数差', () => {
  const a = sc({ id: 'a', name: '慢', r: 0.003, restDaysPerWeek: 2 });
  const b = sc({ id: 'b', name: '快', r: 0.01 });
  const c = sc({ id: 'c', name: '回退', r: 0.01, events: [{ day: 200, factor: 0.7 }] });
  const res = C.compare([a, b, c]);
  assert.equal(res.T, 365);
  assert.deepEqual(res.rows.map(x => x.name), ['快', '回退', '慢']);
  assert.equal(res.rows[0].diffToBest, 0);
  assert.equal(res.rows[1].diffToBest, C.round6(res.rows[1].value - res.rows[0].value));
  assert.ok(res.rows[1].diffToBest < 0);
  assert.equal(res.rows[0].daysTo2, 70);
  assert.equal(res.rows[0].daysTo2Diff, 0);
  assert.equal(res.rows[2].daysTo2Diff, res.rows[2].daysTo2 - 70);
});

test('compare:T 默认取最小时长;可显式指定;r=0 的 daysTo2 为 null 且差为 null', () => {
  const res = C.compare([sc({ id: 'a', days: 100 }), sc({ id: 'b', days: 400, r: 0 })]);
  assert.equal(res.T, 100);
  const r0 = res.rows.find(x => x.id === 'b');
  assert.equal(r0.daysTo2, null);
  assert.equal(r0.daysTo2Diff, null);
  assert.equal(C.compare([sc({})], 30).T, 30);
  assert.throws(() => C.compare([]), RangeError);
});

test('validateImport:合法状态通过且不被修改', () => {
  const s = st({});
  const v = C.validateImport(JSON.parse(JSON.stringify(s)));
  assert.equal(v.ok, true);
  assert.deepEqual(v.value, s);
});

test('validateImport 拒绝 r>3%、负 r、T 非整数、T 越界', () => {
  const bad = (patch) => C.validateImport(st({ scenarios: [sc(patch)] }));
  assert.equal(bad({ r: 0.0301 }).ok, false);
  assert.equal(bad({ r: -0.001 }).ok, false);
  assert.equal(bad({ days: 365.5 }).ok, false);
  assert.equal(bad({ days: 29 }).ok, false);
  assert.equal(bad({ days: 3651 }).ok, false);
  assert.equal(bad({ r: 0.03, days: 3650 }).ok, true);
  assert.equal(bad({ restDaysPerWeek: 7 }).ok, false);
});

test('validateImport 拒绝事件日越界 / 乘数非正 / 事件日非整数', () => {
  const bad = (events, days) => C.validateImport(st({ scenarios: [sc({ days: days || 100, events })] }));
  assert.equal(bad([{ day: 101, factor: 0.7 }]).ok, false);
  assert.equal(bad([{ day: 0, factor: 0.7 }]).ok, false);
  assert.equal(bad([{ day: 5.5, factor: 0.7 }]).ok, false);
  assert.equal(bad([{ day: 5, factor: 0 }]).ok, false);
  assert.equal(bad([{ day: 100, factor: 0.7 }]).ok, true);
  const r = bad([{ day: 101, factor: 1 }]);
  assert.match(r.errors.join(''), /事件日不能超过时长/);
});

test('validateImport 拒绝重复 id、activeId 不存在、超过 3 个情景、错误枚举', () => {
  assert.equal(C.validateImport(st({ scenarios: [sc({ id: 'x' }), sc({ id: 'x' })], activeId: 'x' })).ok, false);
  assert.equal(C.validateImport(st({ activeId: 'nope' })).ok, false);
  const four = [1, 2, 3, 4].map(i => sc({ id: 's' + i }));
  assert.equal(C.validateImport(st({ scenarios: four, activeId: 's1' })).ok, false);
  assert.equal(C.validateImport(st({ yScale: 'sqrt' })).ok, false);
  assert.equal(C.validateImport(st({ app: 'other' })).ok, false);
  assert.equal(C.validateImport(null).ok, false);
  assert.equal(C.validateImport([]).ok, false);
});

test('validateImport:整份拒绝,不跳过坏情景', () => {
  const r = C.validateImport(st({ scenarios: [sc({ id: 'a' }), sc({ id: 'b', r: 0.5 })], activeId: 'a' }));
  assert.equal(r.ok, false);
  assert.equal(r.value, undefined);
});

test('CSV 公式防护:情景名以 = + - @ 开头加单引号,单独的 - + 不算', () => {
  assert.equal(C.csvText('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(C.csvText('+1'), "'+1");
  assert.equal(C.csvText('-2'), "'-2");
  assert.equal(C.csvText('@cmd'), "'@cmd");
  assert.equal(C.csvText('-'), '-');
  assert.equal(C.csvText('+'), '+');
  assert.equal(C.csvText('a,"b"'), '"a,""b"""');
  const csv = C.toCsv(sc({ name: '=HYPERLINK("x")' }));
  assert.ok(csv.split('\n')[0].startsWith(`情景,"'=HYPERLINK(""x"")"`));
});

test('toCsv:参数头 + 365 个数据点', () => {
  const lines = C.toCsv(sc({ name: '正常', events: [{ day: 10, factor: 0.5 }] })).trim().split('\n');
  const headerIdx = lines.indexOf('天,情景倍数,线性对照倍数');
  assert.ok(headerIdx > 0);
  assert.equal(lines.length - headerIdx - 1, 365);
  assert.equal(lines[headerIdx + 1], '1,1.01,1.01');
  assert.ok(lines.includes('倍率事件(第几天:乘数),10:0.5'));
  assert.ok(lines.some(l => l.startsWith('说明,') && l.includes('固定输出第 1–365 天') && l.includes('不覆盖完整时长 T')), '说明行写明固定 1–365 天、不覆盖完整 T');
});

test('浮点精度边界:极小 r 不产生 NaN,6 位小数仍有意义', () => {
  const s = C.simulate({ r: 1e-9, days: 3650 });
  assert.equal(s.final, 1.000004);
  assert.ok(s.series.every(p => Number.isFinite(p.value)));
  const m = C.simulate({ r: 0.03, days: 3650 });
  assert.ok(Number.isFinite(m.final) && m.final > 1e40);
  assert.equal(C.weeklyEquivalent(1e-9), 7e-9);
});

test('formatMultiple / formatPercent', () => {
  assert.equal(C.formatMultiple(37.783434), '37.78');
  assert.equal(C.formatMultiple(12345.6), '12,346');
  assert.equal(C.formatMultiple(1.5e46), '1.50×10^46');
  assert.equal(C.formatMultiple(null), '—');
  assert.equal(C.formatPercent(0.003), '0.3');
  assert.equal(C.formatPercent(0.01), '1');
});

test('defaultState 通过校验;nextId 不与现有冲突', () => {
  assert.equal(C.validateImport(C.defaultState()).ok, true);
  assert.equal(C.nextId([{ id: 's1' }, { id: 's3' }]), 's4');
  assert.equal(C.nextId([]), 's1');
});

test('P1 导入拒绝会让模拟溢出为 Infinity 的大倍率事件', () => {
  const evil = st({ scenarios: [sc({ r: 0.03, days: 365, events: [{ day: 1, factor: 1e308 }] })] });
  const res = C.validateImport(evil);
  assert.equal(res.ok, false);
  assert.match(res.errors.join(''), /溢出/);
  const fine = st({ scenarios: [sc({ r: 0.03, days: 3650, events: [{ day: 5, factor: 10 }] })] });
  assert.equal(C.validateImport(fine).ok, true);
  assert.equal(C.validateImport(st({ scenarios: [sc({ events: [{ day: 1, factor: 1e-320 }, { day: 2, factor: 1e-320 }] })] })).ok, false);
});

test('P2 daysToReach 用对数公式:极小 r 不被截断', () => {
  const d = C.daysToReach(1e-7, 2);
  assert.equal(d, Math.ceil(Math.log(2) / Math.log1p(1e-7)));
  assert.ok(d > 6900000 && d < 6940000);
  assert.equal(C.daysToReach(0, 2), null);
  assert.equal(C.daysToReach(0, 2, 3), null);
  const n = Math.ceil(Math.log(2) / Math.log1p(1e-7));
  assert.equal(C.daysToReach(1e-7, 2, 3), Math.floor((n - 1) / 4) * 7 + ((n - 1) % 4) + 1);
});

test('P2 daysToReach 公式解与逐日模拟一致(含休息日、事件)', () => {
  for (const r of [0.001, 0.003, 0.01, 0.03]) {
    for (const rest of [0, 1, 2, 3, 5, 6]) {
      for (const target of [1.5, 2, 10, 50]) {
        for (const events of [[], [{ day: 20, factor: 0.5 }], [{ day: 9, factor: 0.2 }, { day: 40, factor: 2 }]]) {
          const d = C.daysToReach(r, target, rest, events);
          const s = C.simulate({ r, days: 3650, restDaysPerWeek: rest, events }).series;
          let brute = null;
          for (let i = 1; i <= 3650; i++) if (s[i].value >= target * (1 - 1e-9)) { brute = i; break; }
          if (brute != null) assert.equal(d, brute, `r=${r} rest=${rest} target=${target} ev=${events.length}`);
          else assert.ok(d == null || d > 3650);
        }
      }
    }
  }
});
