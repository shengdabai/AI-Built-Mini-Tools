'use strict';
/* 合成示例,不是真实配置。12 个节点:根「我」+ 4 个部门 + 7 个 Agent。
   内含一个「产出没人用」(记账 Agent)和一个环路(回复 Agent <-> 周报 Agent)。 */
(function () {
  const t = (kind, text) => ({ kind, text });
  const n = (id, name, parentId, o) => Object.assign({
    id, name, duty: '', inputFrom: [], outputTo: [], trigger: t('manual', ''), status: 'idea',
    interventions: ['none'], parentId, runningSince: '', weekly: 0
  }, o);
  const nodes = [
    n('n1', '我', null, { duty: '定方向、做最终决定', status: 'running' }),
    n('n2', '内容部', 'n1', { duty: '负责文章从选题到发布', status: 'running' }),
    n('n3', '写作 Agent', 'n2', { duty: '按选题写出初稿', trigger: t('event', '收到新选题'), status: 'running', interventions: ['approve'], runningSince: '2026-07-01', weekly: 2, outputTo: ['n4'] }),
    n('n4', '校对 Agent', 'n2', { duty: '检查事实、错别字和引用', status: 'running', interventions: ['proofread'], runningSince: '2026-08-15', weekly: 5, inputFrom: ['n3'], outputTo: ['n5'] }),
    n('n5', '发布 Agent', 'n2', { duty: '把定稿发到各个平台', trigger: t('manual', ''), status: 'configured', interventions: ['approve'], weekly: 1, inputFrom: ['n4'], outputTo: ['n1'] }),
    n('n6', '运营部', 'n1', { duty: '负责读者互动和复盘', status: 'configured' }),
    n('n7', '回复 Agent', 'n6', { duty: '起草评论和私信的回复', trigger: t('event', '收到评论'), status: 'running', interventions: ['proofread'], runningSince: '2026-10-05', weekly: 12, outputTo: ['n8'] }),
    n('n8', '周报 Agent', 'n6', { duty: '汇总本周互动,给回复口径提建议', trigger: t('cron', '每周日 20:00(0 20 * * 0)'), status: 'idea', interventions: ['proofread'], weekly: 1, outputTo: ['n7'] }),
    n('n9', '财务', 'n1', { duty: '负责收支记录', status: 'running' }),
    n('n10', '记账 Agent', 'n9', { duty: '整理流水并生成月度账目', trigger: t('cron', '每月 1 日 9:00(0 9 1 * *)'), status: 'running', interventions: ['pay'], runningSince: '2026-09-01', weekly: 1 }),
    n('n11', '研发', 'n1', { duty: '负责工具和自动化的维护', status: 'running' }),
    n('n12', '更新检查 Agent', 'n11', { duty: '检查依赖和工具有没有新版本,把结果告诉我', trigger: t('cron', '每天 8:00(0 8 * * *)'), status: 'disabled', outputTo: ['n1'] })
  ];
  globalThis.ORGCHART_SAMPLE = { version: 1, nodes, collapsed: [], sample: true };
  if (typeof module !== 'undefined') module.exports = globalThis.ORGCHART_SAMPLE;
})();
