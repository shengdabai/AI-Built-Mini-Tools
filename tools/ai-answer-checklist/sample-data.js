'use strict';
/* 合成示例:内容为示意,人物、事件、数字、链接均为虚构,不是真实核实结果。 */
globalThis.ANSWERCHECK_SAMPLE = {
  currentId: 'demo-t1',
  tasks: [
    {
      id: 'demo-t1',
      question: '【合成示例】请介绍虚构的「青河铁路」的建成年份、长度和投资额。',
      answer: '青河铁路于 1887 年建成通车。全长约 412 公里。总投资 3.2 亿银元。它是该地区第一条跨省铁路。设计者认为这条线路会长期带动沿线经济。',
      model: '模型甲(示例)',
      date: '2026-10-12',
      claims: [
        { id: 'demo-c1', text: '青河铁路于 1887 年建成通车', type: '数字', checkability: '可查', status: '有误', evidenceText: '示例线路志记载 1892 年通车(虚构来源)', evidenceUrl: 'https://example.com/demo/qinghe-gazetteer', note: '年份差 5 年,需整句修正' },
        { id: 'demo-c2', text: '青河铁路全长约 412 公里', type: '数字', checkability: '可查', status: '已核实', evidenceText: '示例年鉴:全长 412.3 公里(虚构来源)', evidenceUrl: 'https://example.com/demo/yearbook', note: '' },
        { id: 'demo-c3', text: '总投资 3.2 亿银元', type: '数字', checkability: '可查', status: '有误', evidenceText: '示例档案:预算 0.32 亿银元(虚构来源)', evidenceUrl: '', note: '数量级差 10 倍' },
        { id: 'demo-c4', text: '它是该地区第一条跨省铁路', type: '事实', checkability: '可查', status: '存疑', evidenceText: '', evidenceUrl: '', note: '只找到一条二手说法' },
        { id: 'demo-c5', text: '设计者认为这条线路会长期带动沿线经济', type: '推断', checkability: '无法核实', status: '未核', evidenceText: '', evidenceUrl: '', note: '无设计者原话可查' },
      ],
      rounds: [
        { id: 'demo-r1', n: 1, kind: 'self', summary: '模型自己指出年份与投资额最可能错,与我核出的两处一致', fixed: 2 },
        { id: 'demo-r2', n: 2, kind: 'cross', summary: '拿给另一个模型逐条挑错,多挑出「第一条跨省铁路」存疑', fixed: 1 },
      ],
    },
    {
      id: 'demo-t2',
      question: '【合成示例】一个 10 万行的 Node.js 服务,要不要整体改用 Rust?',
      answer: 'Node.js 的事件循环是单线程的。Rust 的内存安全不依赖垃圾回收。重写通常会让团队前三个月交付变慢。建议先只重写最耗 CPU 的模块。',
      model: '模型乙(示例)',
      date: '2026-10-15',
      claims: [
        { id: 'demo-c6', text: 'Node.js 的事件循环是单线程的', type: '事实', checkability: '可查', status: '已核实', evidenceText: '示例文档:JavaScript 代码在单个主线程上执行(合成摘录)', evidenceUrl: 'https://example.com/demo/node-docs', note: '' },
        { id: 'demo-c7', text: 'Rust 的内存安全不依赖垃圾回收', type: '事实', checkability: '可查', status: '未核', evidenceText: '', evidenceUrl: '', note: '' },
        { id: 'demo-c8', text: '重写通常会让团队前三个月交付变慢', type: '推断', checkability: '需实验', status: '未核', evidenceText: '', evidenceUrl: '', note: '需要在自己团队里小范围试' },
        { id: 'demo-c9', text: '建议先只重写最耗 CPU 的模块', type: '建议', checkability: '需实验', status: '未核', evidenceText: '', evidenceUrl: '', note: '' },
      ],
      rounds: [
        { id: 'demo-r3', n: 1, kind: 'improve', summary: '只让它修正「交付变慢」那条,补了两个团队规模的限定条件', fixed: 1 },
      ],
    },
  ],
};
