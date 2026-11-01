'use strict';
// 合成示例:9 个项目、4 个客户,客户名与金额均为虚构,不对应任何真实业务。金额单位为「分」。
(function () {
  const Y = yuan => Math.round(yuan * 100);
  let n = 0;
  const L = (type, note, fields) => Object.assign({ id: 'sample-l' + (++n), type, note }, fields);
  const labor = (note, hours, rateYuan) => L('labor', note, { hours, rate: Y(rateYuan) });
  const money = (type, note, yuan) => L(type, note, { amount: Y(yuan) });
  const tool = (note, feeYuan, months, share) => L('tool', note, { monthlyFee: Y(feeYuan), months, share });
  const P = (id, o) => Object.assign({
    id: 'sample-' + id, taxIncluded: false, taxRate: 6, startDate: '', deliverDate: '', prepaidPct: 0, termDays: 30, opportunityHourly: Y(150), lines: []
  }, o);

  const projects = [
    P('p1', { name: '官网改版(合成示例)', client: '云帆科技', quote: Y(48000), taxIncluded: true, taxRate: 6, status: '已收款', startDate: '2026-07-05', deliverDate: '2026-08-20', prepaidPct: 30, termDays: 30,
      lines: [labor('设计与前端', 120, 80), money('outsource', '文案外包', 6000), tool('设计工具订阅', 300, 2.5, 50)] }),
    P('p2', { name: '小程序开发(合成示例)', client: '云帆科技', quote: Y(90000), status: '已交付', startDate: '2026-08-10', deliverDate: '2026-09-25', prepaidPct: 40, termDays: 30,
      lines: [labor('开发', 260, 80), money('outsource', '后端外包', 18000), money('travel', '驻场差旅', 2400), tool('云服务', 500, 3, 40)] }),
    P('p3', { name: '运维包年(合成示例)', client: '云帆科技', quote: Y(24000), taxIncluded: true, taxRate: 6, status: '进行中', startDate: '2026-09-15', deliverDate: '2026-11-30', prepaidPct: 50, termDays: 15,
      lines: [labor('巡检与响应', 90, 80), tool('监控订阅', 200, 3, 100)] }),
    P('p4', { name: '品牌手册(合成示例)', client: '木槿设计', quote: Y(36000), status: '已交付', startDate: '2026-07-20', deliverDate: '2026-09-10', prepaidPct: 0, termDays: 30,
      lines: [labor('版式设计', 100, 80), money('outsource', '印刷打样', 4000), money('other', '素材授权', 800)] }),
    P('p5', { name: '展会物料(合成示例)', client: '木槿设计', quote: Y(18000), taxIncluded: true, taxRate: 13, status: '已交付', startDate: '2026-09-01', deliverDate: '2026-09-28', prepaidPct: 0, termDays: 14,
      lines: [labor('物料设计', 60, 80), money('outsource', '制作外包', 7000), money('travel', '现场布展差旅', 1500)] }),
    P('p6', { name: '课程视频制作(合成示例)', client: '北辰教育', quote: Y(60000), status: '进行中', startDate: '2026-09-20', deliverDate: '2026-12-10', prepaidPct: 50, termDays: 30,
      lines: [labor('脚本与统筹', 80, 80), money('outsource', '剪辑外包', 30000), tool('素材库订阅', 400, 3, 60)] }),
    P('p7', { name: '题库整理(合成示例)', client: '北辰教育', quote: Y(15000), taxIncluded: true, taxRate: 6, status: '已收款', startDate: '2026-04-10', deliverDate: '2026-05-30', prepaidPct: 50, termDays: 7,
      lines: [labor('整理与校对', 40, 80), money('other', '版权咨询', 300)] }),
    P('p8', { name: '个人网站(合成示例)', client: '林先生(合成)', quote: Y(8000), status: '已交付', startDate: '2026-09-25', deliverDate: '2026-10-08', prepaidPct: 30, termDays: 30,
      lines: [labor('搭建', 20, 80), tool('域名与托管', 100, 1, 100)] }),
    P('p9', { name: '小改动(合成示例)', client: '林先生(合成)', quote: Y(5000), status: '已取消', startDate: '2026-10-01', deliverDate: '2026-10-15', prepaidPct: 0, termDays: 7,
      lines: [labor('沟通与初稿', 6, 80)] })
  ];

  globalThis.MARGIN_SAMPLE = { version: 1, settings: { opportunityHourly: Y(150) }, projects };
})();
