'use strict';
// 合成示例：内容为虚构,URL 全部指向 example.com,仅用于演示台账规则。
globalThis.EVIDENCE_SAMPLE = {
  version: 1,
  projects: [{
    id: 'sample-project',
    sample: true,
    title: '合成示例 · 某教学工具是否值得做',
    question: '独立中文教师会不会为「课时账单核对」付费？',
    date: '2026-10-20',
    claims: [
      {
        id: 'sample-c1', text: '独立教师每月都要手工核对课时与收款（合成示例）', note: '来自示例,不是真实访谈。',
        evidence: [
          { id: 'sample-e1', type: 'primary', stance: 'support', strength: 'medium', title: '示例：3 位教师的访谈记录', url: 'https://example.com/interviews', excerpt: '三位受访者都说月底要对一次课时。', date: '2026-10-01', limit: '样本只有 3 人,全部来自同一社群。' },
          { id: 'sample-e2', type: 'secondary', stance: 'support', strength: 'weak', title: '示例：某教师论坛帖子', url: 'https://example.com/forum/123', excerpt: '楼主抱怨对账花了一个晚上。', date: '2026-09-12', limit: '单个帖子,无法代表群体。' }
        ]
      },
      {
        id: 'sample-c2', text: '教师愿意每月付 5 美元用核对工具（合成示例）', note: '',
        evidence: [
          { id: 'sample-e3', type: 'ai', stance: 'support', strength: 'strong', title: '示例：AI 生成的市场分析', url: 'https://example.com/ai-report', excerpt: '模型认为教师付费意愿较高。', date: '2026-10-05', limit: 'AI 生成,没有引用一手来源。' }
        ]
      },
      {
        id: 'sample-c3', text: '现有记账软件已经完全解决教师对账（合成示例）', note: '',
        evidence: [
          { id: 'sample-e4', type: 'official', stance: 'support', strength: 'medium', title: '示例：某记账软件官方功能页', url: 'https://example.com/features', excerpt: '支持按客户生成账单。', date: '2026-08-20', limit: '官方页面只证明功能存在,不证明教师在用。' },
          { id: 'sample-e5', type: 'primary', stance: 'oppose', strength: 'strong', title: '示例：教师自述', url: 'https://example.com/notes/7', excerpt: '受访者说软件没有「学员取消是否计费」的规则,所以不用。', date: '2026-10-03', limit: '一人自述。' }
        ]
      },
      {
        id: 'sample-c4', text: '同行教师会把工具推荐给其他教师（合成示例）', note: '尚未找人问过。',
        evidence: []
      },
      {
        id: 'sample-c5', text: '课包余额错误是常见争议（合成示例）', note: '',
        evidence: [
          { id: 'sample-e6', type: 'observation', stance: 'support', strength: 'weak', title: '示例：自己的课堂观察', url: '', excerpt: '本月有一次学员记得的课时与我记的不同。', date: '2026-10-10', limit: '个人单次观察。' },
          { id: 'sample-e7', type: 'secondary', stance: 'oppose', strength: 'weak', title: '示例：一篇二手文章', url: '', excerpt: '文章说争议主要来自迟到,不是余额。', date: '2026-07-01', limit: '转述,且 URL 遗失。' }
        ]
      }
    ]
  }]
};
