/* 合成示例:服务名、金额、产出全部虚构,仅用于演示界面。日期相对「今天」生成,保证提醒可复现。 */
(function () {
  'use strict';
  var C = globalThis.LedgerCore;

  function build(today) {
    var m0 = today.slice(0, 7);
    function m(n) { return C.addMonths(m0, n); }
    function sub(id, name, tier, currency, amount, period, startMonthsAgo, renewInDays, status, tag, who, headcount, extra) {
      var s = {
        id: 'sample-' + id, name: name, tier: tier, currency: currency, amountCents: amount, period: period,
        startDate: m(-startMonthsAgo) + '-05', renewDate: renewInDays === null ? '' : C.addDays(today, renewInDays),
        status: status, tag: tag, who: who, headcount: headcount, amortMonths: 12, usageBills: {}
      };
      Object.keys(extra || {}).forEach(function (k) { s[k] = extra[k]; });
      return s;
    }
    var bills = {};
    [3200, 2850, 4100, 3900, 3600, 4250].forEach(function (c, i) { bills[m(i - 5)] = c; });

    var subs = [
      sub('1', '示例·编码助手 Pro', '专业档', 'USD', 10000, 'monthly', 8, 7, 'active', '编码', 'self', 1),
      sub('2', '示例·代码补全 Plus', '个人档', 'USD', 2000, 'monthly', 8, 9, 'active', '编码', 'self', 1),
      sub('3', '示例·终端智能体', '高用量档', 'USD', 20000, 'monthly', 4, 20, 'active', '编码', 'self', 1),
      sub('4', '示例·长文写作助手', '年付档', 'CNY', 168000, 'yearly', 6, 3, 'active', '写作', 'self', 1),
      sub('5', '示例·调研检索 Pro', '个人档', 'USD', 2000, 'monthly', 8, null, 'paused', '调研', 'self', 1),
      sub('6', '示例·图像生成', '基础档', 'USD', 1000, 'monthly', 8, 25, 'active', '图像', 'self', 1),
      sub('7', '示例·云端接口(按量)', '按调用计费', 'USD', 0, 'usage', 8, null, 'active', '其他', 'self', 1, { usageBills: bills }),
      sub('8', '示例·团队协作助手', '团队年付', 'USD', 60000, 'yearly', 6, 120, 'active', '调研', 'team', 5),
      sub('9', '示例·离线语音工具(买断)', '终身授权', 'CNY', 59900, 'once', 4, null, 'active', '其他', 'self', 1, { amortMonths: 12 })
    ];

    var hours = {
      '编码': [48, 55, 52, 58, 60, 62],
      '写作': [12, 15, 14, 16, 17, 18],
      '调研': [6, 7, 8, 8, 9, 9.5],
      '图像': [3, 4, 2, 1, 0, 0],
      '其他': [4, 5, 5, 6, 3, 1.5]
    };
    var evidence = {
      '编码': ['合并 6 个功能分支', '重构账单模块并补测试', '上线 2 个小工具', '迁移旧脚本到新框架', '修复 14 个缺陷', '交付 3 个原型并写好测试'],
      '写作': ['3 篇公众号草稿', '课程大纲 1 份', '4 篇文章初稿', '电子书第 2 章', '5 篇短文', '周报与课程文案'],
      '调研': ['竞品对比表', '行业报告摘要', '用户访谈整理', '定价调研', '两份选型报告', '需求证据汇总'],
      '图像': ['封面图 4 张', '海报 3 张', '头图 2 张', '1 张插图', '本月没有出图', '本月没有出图'],
      '其他': ['语音转写 6 小时', '会议纪要 5 份', '字幕整理', '批量改名脚本', '数据清洗', '转写与整理']
    };
    var outputs = [];
    C.TAGS.forEach(function (tag) {
      for (var i = 0; i < 6; i++) {
        outputs.push({ id: 'sample-o-' + tag + '-' + i, month: m(i - 5), tag: tag, hours: hours[tag][i], evidence: evidence[tag][i] });
      }
    });
    return {
      version: C.VERSION, subs: subs, outputs: outputs, snapshots: [],
      settings: { fx: { from: 'USD', to: 'CNY', rate: 7.2 }, wage: { cents: 20000, currency: 'CNY' } }
    };
  }
  globalThis.LedgerSample = { build: build, NOTE: '合成示例,金额虚构' };
})();
