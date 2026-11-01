'use strict';
// 合成示例:不是真实访谈或真实数据,只用来演示填写方式与规则提示。
(function () {
  const ev = (id, type, date, source, text) => ({ id, type, date, source, text });
  const sample = {
    version: 1,
    currentId: 'demo_j1',
    jobs: [
      {
        id: 'demo_j1', title: '课后给家长发反馈(合成示例)',
        situation: '一节课刚结束,我要在当晚给每位家长发一条学习反馈',
        motivation: '用一两句话说清孩子这节课学了什么、哪里要练',
        outcome: '每条反馈 3 分钟内写完,家长不再追问"今天学了啥"',
        user: '一对一和小班的中文老师', buyer: '老师本人(个体或小机构负责人)',
        trigger: '下课后、晚饭前,家长群里有人开始问进度',
        success: '一周内家长追问次数下降;每位学生每节课都有一条反馈',
        words: ['APP', '工具', '功能', '按钮'],
        forces: {
          push: [
            { id: 'demo_f1', text: '每晚凑反馈要花 40 分钟,挤占备课时间', evidence: [ev('demo_e1', 'interview', '2026-10-08', '合成示例:老师 A 的口述', '她说一周有三个晚上都在写反馈')] },
            { id: 'demo_f2', text: '写得太短家长觉得敷衍,写得长又来不及', evidence: [] },
            { id: 'demo_f3', text: '忘了发某位家长,第二天被追问', evidence: [ev('demo_e2', 'post', '2026-10-10', '合成示例:教师社群帖子', '"又漏了一个家长"')] }
          ],
          pull: [
            { id: 'demo_f4', text: '有一份可以直接改的结构,不用每次从零写', evidence: [ev('demo_e3', 'guess', '2026-10-12', '自己猜', '我觉得有模板会快很多')] },
            { id: 'demo_f5', text: '家长看到固定格式更有信任感', evidence: [] }
          ],
          inertia: [
            { id: 'demo_f6', text: '现在微信里手打,已经习惯了', evidence: [] },
            { id: 'demo_f7', text: '家长群里的老格式大家都看得懂', evidence: [] }
          ],
          anxiety: [
            { id: 'demo_f8', text: '担心套模板显得不走心', evidence: [] },
            { id: 'demo_f9', text: '担心学生隐私被存到别处', evidence: [] }
          ]
        },
        alternatives: [
          { id: 'demo_a1', name: '微信里手打', cost: '0 元', time: '每晚约 40 分钟', pain: '容易漏发,措辞不稳定' },
          { id: 'demo_a2', name: '手机备忘录存常用句', cost: '0 元', time: '每条约 8 分钟', pain: '要翻找,改起来麻烦' }
        ],
        candidates: [
          { id: 'demo_c1', name: '固定三段模板(纸或文档)', solves: ['demo_f1', 'demo_f2', 'demo_f4'], eases: ['demo_f9'] },
          { id: 'demo_c2', name: '上课时随手记要点,下课拼成反馈', solves: ['demo_f1', 'demo_f3'], eases: ['demo_f8'] }
        ]
      },
      {
        id: 'demo_j2', title: '每周整理读书笔记(合成示例,动机写成了方案)',
        situation: '周日晚上,这一周读的书和随手记散在各处',
        motivation: '我想要一个 APP 自动把笔记归类',
        outcome: '笔记变得更有条理',
        user: '业余读书的上班族', buyer: '自己',
        trigger: '周日晚上翻手机时发现笔记找不到',
        success: '',
        words: ['APP', '工具', '功能', '按钮'],
        forces: {
          push: [{ id: 'demo_g1', text: '想引用上周的笔记时找不到', evidence: [] }],
          pull: [{ id: 'demo_g2', text: '每周留出一次清爽的回顾', evidence: [ev('demo_ge1', 'guess', '', '自己猜', '想象中会很舒服')] }],
          inertia: [
            { id: 'demo_g3', text: '笔记散在三个软件里已经很多年', evidence: [] },
            { id: 'demo_g4', text: '整理要先花一个周末', evidence: [] }
          ],
          anxiety: [{ id: 'demo_g5', text: '怕迁移之后旧笔记丢失', evidence: [] }]
        },
        alternatives: [],
        candidates: []
      }
    ]
  };
  globalThis.JtbdSample = sample;
  if (typeof module !== 'undefined') module.exports = sample;
})();
