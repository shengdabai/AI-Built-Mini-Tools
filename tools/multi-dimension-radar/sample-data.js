'use strict';
/* 合成示例:人物与分数均为虚构,仅用于演示,不是任何真实人物的评估。 */
(function () {
  var names = ['教学', '写作', '产品', '英语', '编程', '分发'];
  function snap(date, arr) {
    return { date: date, scores: names.map(function (n, i) { return { name: n, score: arr[i] }; }) };
  }
  function dim(id, name, cur, tgt, ev, hours, weight) {
    return { id: id, name: name, current: cur, target: tgt, evidence: ev, hours: hours, weight: weight };
  }
  globalThis.RADAR_SAMPLE = {
    v: 1,
    activeId: 'p-teacher-2026',
    compareId: null,
    profiles: [
      {
        id: 'p-teacher-2026',
        name: '某英语教师 2026(合成示例)',
        synthetic: true,
        weeklyHours: 10,
        dims: [
          dim('d1', '教学', 82, 90, '示例:连续 3 年带班,学员续报率高于同校均值。', 12, 1),
          dim('d2', '写作', 62, 75, '示例:每周 1 篇公开文章,累计 40 篇。', 3, 1),
          dim('d3', '产品', 48, 70, '示例:做过 1 个练习册小工具,10 人试用。', 2, 1),
          dim('d4', '英语', 78, 85, '示例:雅思 7.5,日常口译无障碍。', 4, 0.5),
          dim('d5', '编程', 35, 60, '示例:能写简单脚本,没有独立上线的项目。', 1, 1),
          dim('d6', '分发', 30, 65, '示例:公众号 300 关注,没做过付费推广。', 1, 2)
        ],
        snapshots: [
          snap('2026-08-20', [80, 52, 40, 77, 28, 22]),
          snap('2026-09-18', [81, 58, 44, 78, 31, 26]),
          snap('2026-10-02', [82, 61, 47, 78, 34, 29])
        ]
      },
      {
        id: 'p-single-master',
        name: '单维高手(合成示例)',
        synthetic: true,
        weeklyHours: 10,
        dims: [
          dim('s1', '教学', 95, 95, '示例:行业内公认的名师。', 30, 1),
          dim('s2', '写作', 20, 20, '示例:几乎不写。', 0, 1),
          dim('s3', '产品', 20, 20, '示例:没做过产品。', 0, 1),
          dim('s4', '英语', 20, 20, '示例:够用而已。', 0, 1),
          dim('s5', '编程', 20, 20, '示例:不会。', 0, 1),
          dim('s6', '分发', 20, 20, '示例:靠口碑,没有渠道。', 0, 1)
        ],
        snapshots: []
      }
    ]
  };
})();
