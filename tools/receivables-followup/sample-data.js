/* 合成示例:全部是虚构的客户与账单,按"今天"的偏移量生成,所以任何基准日下桶分布都一致。 */
(function () {
  'use strict';
  var C = globalThis.ReceivablesCore;

  /* [客户, 账单号, 币种, 应收, 已收, 到期日相对今天的偏移(天,负数=已逾期), 开票日提前天数, 争议备注, 最近跟进偏移(null=从未)] */
  var ROWS = [
    ['星河设计工作室', 'XH-2026-001', 'CNY', 12000, 0, -95, 125, '', null],
    ['星河设计工作室', 'XH-2026-014', 'CNY', 8000, 3000, -45, 75, '', -10],
    ['星河设计工作室', 'XH-2026-021', 'CNY', 5600, 0, 0, 30, '', null],
    ['北辰科技有限公司', 'BC-0087', 'CNY', 30000, 30000, -20, 50, '', -25],
    ['北辰科技有限公司', 'BC-0092', 'CNY', 18000, 0, -62, 92, '对方称第二版交付物未验收,等项目负责人确认后再谈付款', -15],
    ['北辰科技有限公司', 'BC-0101', 'CNY', 9000, 4000, -12, 42, '', -3],
    ['北辰科技有限公司', 'BC-0110', 'CNY', 22000, 0, 15, 15, '', null],
    ['Harbor Studio', 'H-311', 'USD', 1500, 0, -30, 60, '', -9],
    ['Harbor Studio', 'H-322', 'USD', 2400, 0, -61, 91, '', null],
    ['Harbor Studio', 'H-330', 'USD', 800, 300, 30, 0, '', null]
  ];

  function sampleState(today) {
    var bills = ROWS.map(function (r, i) {
      var last = r[8] === null ? '' : C.addDays(today, r[8]);
      var payments = r[4] > 0 ? [{ date: C.addDays(today, Math.min(r[5] + 5, -1)), amount: r[4] }] : [];
      return {
        id: 'b' + (i + 1), client: r[0], no: r[1], issueDate: C.addDays(today, r[5] - r[6]), dueDate: C.addDays(today, r[5]),
        amount: r[3], currency: r[2], paid: r[4], openingPaid: 0, dispute: r[7], lastFollow: last, openingLastFollow: '',
        payments: payments,
        follows: last ? [{ date: last, note: '合成示例:电话提醒' }] : []
      };
    });
    return { bills: bills, settings: { template: C.DEFAULT_TEMPLATE, n: C.DEFAULT_N } };
  }

  globalThis.ReceivablesSample = { sampleState: sampleState, LABEL: '合成示例' };
})();
