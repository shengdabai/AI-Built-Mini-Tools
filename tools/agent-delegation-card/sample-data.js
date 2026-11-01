/* 委托契约卡 sample-data.js — 合成示例：全部为虚构任务与虚构分钟数，不是实测数据，仅用于演示「载入示例」。 */
(function () {
  'use strict';

  function actions(zones, custom) {
    var base = [
      ['read', '读文件', false, true], ['search', '联网检索', false, true], ['edit', '改文件', false, false],
      ['exec', '执行命令', false, false], ['install', '安装依赖', false, false], ['send', '发消息 / 外发', true, false],
      ['pay', '付款 / 花钱', true, false], ['deploy', '发布 / 部署', true, false], ['delete', '删除数据', true, false],
      ['creds', '改权限 / 凭据', true, false]
    ];
    var list = base.map(function (b) {
      return { id: b[0], label: b[1], high: b[2], readOnly: b[3], custom: false, zone: zones[b[0]] || 'ask' };
    });
    return list.concat(custom || []);
  }

  function rec(id, name, type, level, created, done, t, qualified, zones) {
    return {
      id: 'sample-' + id, sample: true, status: 'done', createdAt: created, doneAt: done, qualified: qualified,
      timing: { baseline: t[0], humanExec: t[1], supervision: t[2], rework: t[3], authMaintenance: t[4], learning: t[5] },
      contract: {
        id: 'sample-k' + id, taskName: name, taskType: type, trustLevel: level,
        goal: '（合成示例）' + name, inputs: '（合成示例）虚构的输入材料', criteria: ['合成示例的验收标准'], deadline: '当天完成', stuckProtocol: '先停下汇总问题再问我',
        actions: actions(zones || { read: 'auto', search: 'auto' })
      }
    };
  }

  var records = [
    rec(1, '客户周会纪要整理', '资料整理', 2, '2026-09-08', '2026-09-08', [90, 15, 10, 5, 0, 0], true),
    rec(2, '竞品定价资料汇编', '资料整理', 2, '2026-09-12', '2026-09-12', [180, 30, 25, 20, 10, 15], true),
    rec(3, '行业报告要点摘录', '资料整理', 3, '2026-09-19', '2026-09-19', [60, 10, 15, 10, 0, 0], true, { read: 'auto', search: 'auto', edit: 'auto' }),
    rec(4, '修复导出按钮样式', '代码修改', 2, '2026-09-10', '2026-09-10', [40, 10, 20, 25, 5, 0], false),
    rec(5, '给同步脚本加日志', '代码修改', 2, '2026-09-16', '2026-09-16', [60, 10, 15, 10, 0, 10], true),
    rec(6, '升级前端依赖版本', '代码修改', 2, '2026-09-24', '2026-09-24', [90, 20, 40, 45, 10, 5], false),
    rec(7, '新品发布文案初稿', '文案起草', 1, '2026-09-26', '2026-09-26', [45, 10, 15, 25, 0, 5], false)
  ];

  var draft = {
    id: 'sample-draft',
    taskName: '整理 9 月差旅报销材料',
    taskType: '报销材料',
    goal: '按公司报销模板生成一份待提交清单：每笔费用对应票据、金额、日期；缺票据的单独列出。只生成清单，不提交申请。',
    inputs: '「9月差旅」文件夹里的发票 PDF 副本（14 张）\n公司报销模板（xlsx）\n行程单截图 3 张',
    criteria: [
      '每笔金额与票据一致，清单合计与票据总额相差 0 元',
      '缺项清单写明缺什么、去哪补',
      '不改动原始文件，产出放在新建的「报销草稿」文件夹'
    ],
    deadline: '今天 17:00 前交草稿；处理超过 40 分钟仍未完成就停下，汇报进度。',
    stuckProtocol: '遇到看不清的票据或模板里没有的费用类型，先汇总成一条消息，每个问题给 2 个可选处理方式，等我回复，不要自己猜。',
    trustLevel: 2,
    actions: actions(
      { read: 'auto', search: 'deny', edit: 'ask', exec: 'deny', install: 'deny', send: 'deny', pay: 'deny', deploy: 'deny', delete: 'deny', creds: 'deny' },
      [{ id: 'sample-submit', label: '提交报销申请', high: true, readOnly: false, custom: true, zone: 'deny' }]
    )
  };

  globalThis.ContractSample = { label: '合成示例', records: records, draft: draft };
})();
