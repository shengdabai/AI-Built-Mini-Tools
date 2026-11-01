'use strict';
/* 合成示例:全部是为演示生成的虚构记录,年化 6% 只是用户假设,不是预测。 */
globalThis.DcaSample = function (today) {
  const C = globalThis.DcaCore;
  const t = C.dayOf(today);
  const day = n => C.fromDay(n);

  /* 1. 每日写作 500 字(数量型):开始 60 天前,今天尚未记录,中间有几段缺勤 */
  const writeStart = t - 60;
  const writeMiss = new Set([4, 5, 6, 19, 27, 28, 36, 44, 52]);
  const write = [];
  for (let i = 0; i < 60; i++) {
    if (writeMiss.has(i)) continue;
    write.push({ date: day(writeStart + i), value: i % 9 === 8 ? 800 : 500 });
  }

  /* 2. 每周 3 次锻炼(次数型):开始于约 9 周前的周一,有两周没达标 */
  const monday = d => d - (((d + 3) % 7) + 7) % 7;
  const gymStart = monday(t) - 63;
  const gym = [];
  for (let w = 0; w < 10; w++) {
    const mon = gymStart + w * 7;
    const picks = w === 3 ? [0] : w === 6 ? [2, 4] : [0, 2, 4];
    for (const off of picks) {
      if (mon + off <= t - 1) gym.push({ date: day(mon + off), value: 1 });
    }
  }

  /* 3. 每月 1 日定投 1000(金额型):12 期,年化假设默认 0,可切到 6% */
  const td = new Date(t * 86400000);
  let y = td.getUTCFullYear(), m = td.getUTCMonth() + 1 - 11;
  while (m < 1) { m += 12; y -= 1; }
  const invest = [];
  const investStart = y + '-' + String(m).padStart(2, '0') + '-01';
  for (let k = 0; k < 12; k++) {
    const mm = ((m - 1 + k) % 12) + 1, yy = y + Math.floor((m - 1 + k) / 12);
    invest.push({ date: yy + '-' + String(mm).padStart(2, '0') + '-01', value: 1000 });
  }

  return [
    { id: 'sample-write', name: '每日写作 500 字', type: 'quantity', unit: '字', rule: { kind: 'daily' }, amount: 500,
      start: day(writeStart), stopLoss: '示例:连续 3 天没写,先把目标降到 100 字,但不停止记录。', ended: null, annualRate: 0, records: write, sample: true },
    { id: 'sample-gym', name: '每周 3 次锻炼', type: 'count', unit: '次', rule: { kind: 'weekly', n: 3 }, amount: 1,
      start: day(gymStart), stopLoss: '', ended: null, annualRate: 0, records: gym, sample: true },
    { id: 'sample-dca', name: '每月 1 日定投 1000(合成示例)', type: 'amount', unit: '元', rule: { kind: 'monthly', day: 1 }, amount: 1000,
      start: investStart, stopLoss: '示例:只记录,不执行。', ended: null, annualRate: 0, records: invest, sample: true }
  ];
};
