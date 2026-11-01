'use strict';
/* 合成示例:全部为虚构内容,孩子名只用占位。 */
(function () {
  function e(n, date, who, event, chain, proposer, mood, tags, status, prevId) {
    return { id: 'sample-' + n, date: date, who: who, event: event, chain: chain, proposer: proposer, mood: mood, tags: tags, status: status, prevId: prevId || null };
  }
  const entries = [
    e(1, '2026-09-08', 'A 娃', '过马路时没看左右就跑', ['因为没看左右就跑', '所以差点被电动车碰到', '然后妈妈吓了一跳,手心出汗'], 'parent', 'calm', ['安全'], 'done'),
    e(2, '2026-09-15', 'B 娃', '周日晚上才开始写作业', ['因为玩到很晚才开始写', '所以写到十点还没写完', '然后第二天早上起不来'], 'child', 'calm', ['作业'], 'done'),
    e(3, '2026-09-22', 'A 娃', '忘带水杯去学校', ['因为出门前没检查书包', '所以上午口渴没有水喝'], 'parent', 'calm', ['其他'], 'done'),
    e(4, '2026-09-27', '自己', '晚上刷手机到很晚', ['因为睡前一直刷手机', '所以十二点才睡', '然后第二天上午没精神,事情拖到下午'], 'parent', 'calm', ['其他'], 'done'),
    e(5, '2026-10-01', 'A 娃', '作业本落在学校', ['因为放学时没有对照清单', '所以回家发现作业本没带', '然后只能打电话问同学,多花了二十分钟'], 'child', 'calm', ['作业'], 'done'),
    e(6, '2026-10-06', 'B 娃', '骑车不戴头盔', ['因为觉得头盔闷就没戴', '所以摔了一下膝盖破皮', '然后以后找不到工作'], 'parent', 'calm', ['安全'], 'done'),
    e(7, '2026-10-09', 'B 娃', '和同桌吵了一架', ['因为借橡皮没有说谢谢', '所以同桌不高兴,说话变冲', '然后两个人下课都没说话'], 'parent', 'calm', ['社交'], 'done'),
    e(8, '2026-10-13', 'A 娃', '又忘带水杯', ['因为早上赶时间没看书包', '所以中午只能喝学校的水', '然后下午有点头疼'], 'parent', 'calm', ['其他'], 'done', 'sample-3'),
    e(9, '2026-10-17', 'B 娃', '玩滑板不戴护具', ['因为觉得自己滑得稳', '所以转弯时摔倒,手肘擦伤', '然后这周不能滑板,约好的活动去不了'], 'child', 'calm', ['安全'], 'done'),
    e(10, '2026-10-20', 'A 娃', '因为玩具被抢大发脾气', ['因为玩具被弟弟拿走'], 'parent', 'upset', ['社交'], 'draft'),
  ];
  const state = { version: 1, entries: entries, config: {
    farWords: ['以后', '将来', '长大', '找不到工作', '未来', '一辈子', '成年后'],
    tags: ['安全', '作业', '社交', '其他'],
    slots: [{ label: '晚饭后', time: '19:30' }, { label: '睡前', time: '21:00' }],
  } };
  globalThis.CausalSample = function () { return JSON.parse(JSON.stringify(state)); };
  if (typeof module !== 'undefined') module.exports = globalThis.CausalSample;
})();
