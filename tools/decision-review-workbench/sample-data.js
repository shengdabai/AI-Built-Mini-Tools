'use strict';
globalThis.DECISION_REVIEW_SAMPLE = {
  version: 2,
  isSample: true,
  legacyNotes: [],
  decisions: [
    {
      id: 'sample-forecast-1', origin: 'synthetic', title: '合成示例：两周内完成三次真实访谈', question: '在 2026-11-12 前，是否完成至少三次目标用户访谈？', createdAt: '2026-10-29T08:00:00.000Z',
      forecastVersions: [{ probability: 70, dueDate: '2026-11-12', reasons: '已列出五位可联系对象，并预留三个时段。', evidence: '合成示例：联系人和日程均为虚构。', createdAt: '2026-10-29T08:00:00.000Z' }], review: null
    },
    {
      id: 'sample-resolved-1', origin: 'synthetic', title: '合成示例：本周完成原型验收', question: '在 2026-10-27 前，是否完成手机与桌面两种视口验收？', createdAt: '2026-10-20T08:00:00.000Z',
      forecastVersions: [{ probability: 80, dueDate: '2026-10-27', reasons: '功能已完成，只剩浏览器检查。', evidence: '合成示例：测试记录为虚构。', createdAt: '2026-10-20T08:00:00.000Z' }],
      review: { outcome: 1, reviewedOn: '2026-10-27', reviewedAt: '2026-10-27T12:00:00.000Z', summary: '合成示例：两种视口均完成检查。', bias: '未判断', nextTest: '下次事前写明错误态验收。' }
    }
  ]
};
