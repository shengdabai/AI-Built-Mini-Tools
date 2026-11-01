'use strict';
/* 合成示例:三组演示参数,不是任何真实数据。 */
globalThis.COMPOUND_SAMPLE = {
  app: 'compound-curve',
  version: 1,
  scenarios: [
    { id: 's1', name: '每天 1%', r: 0.01, days: 365, restDaysPerWeek: 0, events: [] },
    { id: 's2', name: '每天 0.3% 休两天', r: 0.003, days: 365, restDaysPerWeek: 2, events: [] },
    { id: 's3', name: '每天 1% 第 200 天回退 ×0.7', r: 0.01, days: 365, restDaysPerWeek: 0, events: [{ day: 200, factor: 0.7 }] }
  ],
  activeId: 's1',
  target: 10,
  yScale: 'log',
  weekly: { show: false, r7: 0.01 },
  sample: true
};
