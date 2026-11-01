/* 合成示例:4 份规格,全部为演示用的虚构内容,不代表任何真实任务或结论。 */
(function () {
  'use strict';
  var D = '2026-10-20';
  globalThis.SPEC_SAMPLES = [
    {
      id: 'sample-complete', title: '合成示例 · 完整规格(竞品对比)', tags: ['合成示例', '调研'],
      task: '我是独立开发者,要对比三款笔记工具的导出能力,给准备选型的小团队负责人看。',
      constraints: [
        { kind: '范围', text: '只比较导出格式、批量导出、导出是否保留附件三项' },
        { kind: '禁止项', text: '不要引用没有链接的评测文章' },
        { kind: '长度', text: '不超过 800 字' },
        { kind: '语言', text: '简体中文,产品名保留英文原名' },
        { kind: '受众', text: '不懂技术细节的团队负责人' },
        { kind: '已有材料', text: '我已试用过其中两款,试用记录附在后面' }
      ],
      criteria: [
        { text: '三款工具在三项能力上各有一个明确的「支持 / 不支持 / 未查到」结论', check: '对照表格数一遍,共 9 格且无空格' },
        { text: '每个结论后附一个官方文档链接', check: '逐个点开,确认页面存在且写到了对应能力' },
        { text: '未查到的内容单独列在末尾', check: '末尾有「未查到」小节' }
      ],
      output: '一句话结论 / 对比表(工具 x 三项能力) / 未查到清单', role: '谨慎的选型顾问', tone: '平实、不夸张',
      createdAt: D, updatedAt: D
    },
    {
      id: 'sample-vague', title: '合成示例 · 含模糊词的规格', tags: ['合成示例', '写稿'],
      task: '写一篇关于时间管理的文章。',
      constraints: [
        { kind: '长度', text: '1000 字左右' }
      ],
      criteria: [
        { text: '文章要专业', check: '' },
        { text: '内容高质量,读起来很好', check: '' }
      ],
      output: '', role: '', tone: '',
      createdAt: D, updatedAt: D
    },
    {
      id: 'sample-conflict', title: '合成示例 · 限定与验收冲突', tags: ['合成示例', '数据分析'],
      task: '请分析附上的月度销量表,把结果给销售经理在周会上讲解用。',
      constraints: [
        { kind: '禁止项', text: '不要使用表格' },
        { kind: '格式', text: '先给一句话结论,再分点说明' }
      ],
      criteria: [
        { text: '用表格列出各产品的环比变化', check: '检查输出里是否有表格' },
        { text: '每个数字标注所在的月份', check: '抽查三个数字' }
      ],
      output: '结论 / 分点说明', role: '', tone: '',
      createdAt: D, updatedAt: D
    },
    {
      id: 'sample-draft', title: '合成示例 · 只写了一半', tags: ['合成示例', '翻译'],
      task: '把这段英文说明翻译成中文',
      constraints: [
        { kind: '语言', text: '简体中文' },
        { kind: '已知事实', text: '' }
      ],
      criteria: [],
      output: '', role: '', tone: '',
      createdAt: D, updatedAt: D
    }
  ];
})();
