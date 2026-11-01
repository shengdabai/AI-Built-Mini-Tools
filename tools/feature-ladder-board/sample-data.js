'use strict';
/* 合成示例:「课后反馈工具」项目。所有功能与证据均为虚构演示,不是真实数据。 */
globalThis.LADDER_SAMPLE = {
  name: '课后反馈工具(合成示例)',
  synthetic: true,
  keywords: ['登录', '支付', '数据库', '服务端'],
  evidence: {
    1: '(合成示例)usage-log 3 条:周二课后自己填了一次;周四用列表复盘;周六导出 CSV。',
    2: '',
    3: '',
  },
  features: [
    { id: 'f1', name: '课后一句话反馈表单', task: '学员下课后在手机上用一句话说出本节课最大的困惑', gate: 1, moscow: 'must', hours: 4, deps: [], layer: 'unit', status: 'done' },
    { id: 'f2', name: '反馈按课时分组列表', task: '老师打开页面就能按课时看到所有反馈', gate: 1, moscow: 'must', hours: 5, deps: ['f1'], layer: 'unit', status: 'doing' },
    { id: 'f3', name: '本地保存与导出 CSV', task: '老师把一学期的反馈导出到表格里复盘', gate: 1, moscow: 'must', hours: 3, deps: ['f1'], layer: 'integration', status: 'todo' },
    { id: 'f4', name: '微信登录', task: '学员用微信登录后提交反馈,老师能区分是谁', gate: 1, moscow: 'must', hours: 6, deps: [], layer: 'e2e', status: 'todo' },
    { id: 'f5', name: '情绪标签统计', task: '老师看到每节课「听懂了/一般/没听懂」的比例', gate: 1, moscow: 'must', hours: 4, deps: ['f1'], layer: 'unit', status: 'todo' },
    { id: 'f6', name: '老师端汇总页', task: '老师在一页上看到本周所有班级的反馈摘要', gate: 2, moscow: 'must', hours: 8, deps: ['f2', 'f5'], layer: 'screenshot', status: 'todo' },
    { id: 'f7', name: '学员扫码入口', task: '学员扫课堂大屏上的码直接进入反馈页', gate: 2, moscow: 'must', hours: 6, deps: ['f8'], layer: 'e2e', status: 'todo' },
    { id: 'f8', name: '课堂二维码生成', task: '老师为每节课生成一个带课时信息的二维码', gate: 2, moscow: 'must', hours: 5, deps: ['f7'], layer: 'integration', status: 'todo' },
    { id: 'f9', name: '匿名提交选项', task: '学员选择匿名后,老师看不到提交者', gate: 2, moscow: 'should', hours: 3, deps: ['f1'], layer: 'unit', status: 'todo' },
    { id: 'f10', name: '反馈邮件提醒与周报', task: '老师每周收到一封汇总反馈的邮件,不用主动打开页面', gate: 2, moscow: 'should', hours: 24, deps: ['f6'], layer: 'real', status: 'todo' },
    { id: 'f11', name: '反馈关键词云', task: '老师一眼看到本期反复出现的词', gate: 2, moscow: 'could', hours: 5, deps: ['f2'], layer: '', status: 'todo' },
    { id: 'f12', name: '多班级对比视图', task: '教研组长对比不同班级同一节课的反馈差异', gate: 3, moscow: 'should', hours: 10, deps: ['f6'], layer: 'screenshot', status: 'todo' },
    { id: 'f13', name: '付费版导出 PDF 报告', task: '老师把一学期反馈生成可交给学校的 PDF 报告', gate: 3, moscow: 'could', hours: 6, deps: ['f3'], layer: '', status: 'todo' },
    { id: 'f14', name: '自定义主题色', task: '机构给反馈页换成自己的品牌颜色', gate: 3, moscow: 'could', hours: 4, deps: [], layer: '', status: 'todo' },
    { id: 'f15', name: 'AI 总结一学期反馈', task: '老师一键得到一段反馈趋势的文字总结', gate: 3, moscow: 'could', hours: 12, deps: ['f6'], layer: '', status: 'todo' },
    { id: 'f16', name: '团队评论与@同事', task: '同一门课的几位老师在反馈下互相评论', gate: 3, moscow: 'could', hours: 9, deps: ['f6'], layer: '', status: 'todo' },
  ],
};
