(function (root) {
  'use strict';
  root.TaskEffortSample = {
    version: 1, synthetic: true, tasks: [
      { id:'sample_html_1', synthetic:true, name:'合成示例：响应式 HTML 验收', type:'HTML 交付', date:'2026-10-27', model:'示例模型 A', acceptance:'桌面、平板和 390px 手机无横向溢出，交互断网可用。', outcome:'passed', workMinutes:85, reworkMinutes:20, api:null,
        subscriptionUsage:{unit:'percentage_points',unitLabel:'',before:62,after:57,windowLabel:'同一周额度窗口',comparable:true,reset:false}, wage:{currency:'CNY',centsPerHour:20000}, notes:'虚构数据，用于演示“未知费用不按 0 处理”。' },
      { id:'sample_copy_1', synthetic:true, name:'合成示例：短文校对', type:'内容校对', date:'2026-10-28', model:'示例模型 B', acceptance:'检查清单中的 12 项均给出证据，未发现项也标注检查范围。', outcome:'passed', workMinutes:30, reworkMinutes:5, api:{currency:'USD',amountCents:42},
        subscriptionUsage:{unit:'requests',unitLabel:'',before:100,after:94,windowLabel:'当日请求窗口',comparable:false,reset:true}, wage:null, notes:'额度在观察期间重置，因此前后值不比较。' },
      { id:'sample_debug_1', synthetic:true, name:'合成示例：脚本故障排查', type:'故障排查', date:'2026-10-29', model:'示例模型 A', acceptance:'复现失败用例通过，旧用例保持通过。', outcome:'pending', workMinutes:55, reworkMinutes:0, api:{currency:'USD',amountCents:18}, subscriptionUsage:null, wage:{currency:'CNY',centsPerHour:20000}, notes:'仍待最终验收，不进入通过样本的耗时中位数。' }
    ]
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
