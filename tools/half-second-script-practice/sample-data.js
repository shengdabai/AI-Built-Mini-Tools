'use strict';
/* 合成示例:全部为虚构,不是真实记录。依赖 core.js 的日期函数。 */
(function () {
  function build(today) {
    const C = globalThis.HalfsecCore;
    const day = off => C.addDays(today, -off);
    const hms = k => ['07:30:00', '12:40:00', '21:15:00', '22:05:00'][k];
    const s = C.emptyState();
    s.name = '小林';
    s.sample = true;
    s.scripts = [
      { id: 's1', text: '我从不刷短视频', identity: '我是把睡前时间留给自己的人', situation: '', reason: '想把睡前一小时用来读书', emotion: '清楚、平稳', loud: false },
      { id: 's2', text: '当孩子大声说话时,我先看着她的眼睛再回答', identity: '我是先听完再说话的家长', situation: '孩子在饭桌上提高音量', reason: '不想把吼叫当成回应', emotion: '', loud: false }
    ];
    // 脚本 1:最近 30 天(含今天共 30 格)每天 1-3 次,中间断 3 天,今天还没练
    for (let off = 29; off >= 1; off--) {
      if (off >= 14 && off <= 16) continue;
      const n = (off % 3) + 1;
      for (let k = 0; k < n; k++) {
        s.practices.push({ id: 'p' + (s.practices.length + 1), scriptId: 's1', seconds: Math.round((5.5 + ((off + k) % 7) * 0.8) * 10) / 10, at: `${day(off)}T${hms(k)}` });
      }
    }
    // 脚本 2:近一周练过 5 次
    for (const off of [6, 5, 3, 2, 1]) {
      s.practices.push({ id: 'p' + (s.practices.length + 1), scriptId: 's2', seconds: 7.2, at: `${day(off)}T18:20:00` });
    }
    // 脚本 2:12 条触发记录
    const offs = [27, 24, 21, 19, 16, 13, 11, 9, 6, 4, 2, 1];
    const done = [false, false, true, false, true, false, true, true, true, false, true, true];
    const sit = ['饭桌上她抢着说话', '作业没写完她大喊', '睡前不肯刷牙', '弟弟抢玩具她尖叫'];
    const rea = ['我想吼回去', '我提高了音量', '我先深呼吸', '我转身走开'];
    offs.forEach((off, i) => {
      s.triggers.push({ id: 't' + (i + 1), scriptId: 's2', date: day(off), situation: sit[i % 4], reaction: rea[(i + 1) % 4], executed: done[i] });
    });
    return s;
  }
  globalThis.HalfsecSample = { build };
})();
