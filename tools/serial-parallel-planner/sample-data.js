'use strict';
/* 合成示例:“上午 8 件事”。不是真实用户数据。 */
globalThis.TONGBING_SAMPLE = {
  label: '合成示例:上午 8 件事',
  tasks: [
    { id: 't1', name: '烧水', dur: 5, type: 'auto', deps: [], earliest: 0 },
    { id: 't2', name: '泡茶', dur: 2, type: 'present', deps: ['t1'], earliest: 0 },
    { id: 't3', name: '回邮件', dur: 20, type: 'present', deps: [], earliest: 0 },
    { id: 't4', name: '跑测试', dur: 15, type: 'auto', deps: [], earliest: 0 },
    { id: 't5', name: '看测试结果', dur: 10, type: 'present', deps: ['t4'], earliest: 0 },
    { id: 't6', name: '备课', dur: 40, type: 'present', deps: [], earliest: 0 },
    { id: 't7', name: '打印', dur: 5, type: 'auto', deps: ['t6'], earliest: 0 },
    { id: 't8', name: '打电话', dur: 10, type: 'present', deps: [], earliest: 0 }
  ]
};
