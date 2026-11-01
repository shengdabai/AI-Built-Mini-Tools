/* 错题回环 sample-data.js — 合成示例（非真实学员数据）。
 * 由开发者按英语母语者常见的中文错误类型编写，用于演示「载入示例」。
 * expectTag：规则分类应得到的类型（测试会核对）。
 * dueOffset / interval / reps / ef / lapses：模拟已复习过一段时间的排期状态，dueOffset 相对「今天」。
 */
(function () {
  var CuotiSample = {
    label: '合成示例',
    cards: [
      { wrong: '我有三个书。', correct: '我有三本书。', english: 'I have three books.', note: '书用「本」', expectTag: 'measure', dueOffset: 0, interval: 1, reps: 1, ef: 2.36, lapses: 1 },
      { wrong: '我学习中文在北京。', correct: '我在北京学习中文。', english: 'I study Chinese in Beijing.', note: '地点状语放在动词前', expectTag: 'order', dueOffset: 0, interval: 6, reps: 2, ef: 2.5, lapses: 0 },
      { wrong: '我昨天看一个电影。', correct: '我昨天看了一个电影。', english: 'I watched a movie yesterday.', note: '完成的具体动作加「了」', expectTag: 'aspect', dueOffset: 0, interval: 1, reps: 0, ef: 2.18, lapses: 2 },
      { wrong: '他跑步跑的很快。', correct: '他跑步跑得很快。', english: 'He runs very fast.', note: '动词后补语用「得」', expectTag: 'de', dueOffset: -1, interval: 6, reps: 2, ef: 2.36, lapses: 0 },
      { wrong: '她高兴的说。', correct: '她高兴地说。', english: 'She said happily.', note: '修饰动词用「地」', expectTag: 'de', dueOffset: 3, interval: 6, reps: 2, ef: 2.5, lapses: 0 },
      { wrong: '我很喜欢这只衣服。', correct: '我很喜欢这件衣服。', english: 'I really like this piece of clothing.', note: '衣服用「件」', expectTag: 'measure', dueOffset: 0, interval: 1, reps: 1, ef: 2.5, lapses: 0 },
      { wrong: '我是很累。', correct: '我很累。', english: 'I am very tired.', note: '形容词谓语前不加「是」', expectTag: 'extra', dueOffset: 12, interval: 25, reps: 4, ef: 2.6, lapses: 0 },
      { wrong: '我起床七点每天。', correct: '我每天七点起床。', english: 'I get up at seven every day.', note: '时间词放在动词前', expectTag: 'order', dueOffset: 2, interval: 6, reps: 2, ef: 2.36, lapses: 1 },
      { wrong: '我对中国文化很兴趣。', correct: '我对中国文化很感兴趣。', english: "I'm very interested in Chinese culture.", note: '「感兴趣」是固定搭配', expectTag: 'missing', dueOffset: 0, interval: 1, reps: 1, ef: 2.36, lapses: 1 },
      { wrong: '我在等公共气车。', correct: '我在等公共汽车。', english: "I'm waiting for the bus.", note: '汽 / 气 形近', expectTag: 'typo', dueOffset: 20, interval: 30, reps: 5, ef: 2.7, lapses: 0 },
      { wrong: '我己经吃饭了。', correct: '我已经吃饭了。', english: 'I have already eaten.', note: '己 / 已 形近', expectTag: 'typo', dueOffset: 0, interval: 6, reps: 2, ef: 2.22, lapses: 1 },
      { wrong: '我没去了上海。', correct: '我没去过上海。', english: 'I have never been to Shanghai.', note: '「没……过」表示没有经历', expectTag: 'aspect', dueOffset: 5, interval: 6, reps: 2, ef: 2.5, lapses: 0 },
      { wrong: '我打电话我的朋友。', correct: '我给我的朋友打电话。', english: 'I called my friend.', note: '「给某人打电话」', expectTag: 'other', dueOffset: 0, interval: 1, reps: 0, ef: 2.18, lapses: 2 },
      { wrong: '我家有一个狗。', correct: '我家有一只狗。', english: 'My family has a dog.', note: '狗用「只」或「条」', expectTag: 'measure', dueOffset: 9, interval: 22, reps: 4, ef: 2.5, lapses: 0 }
    ]
  };
  globalThis.CuotiSample = CuotiSample;
  if (typeof module !== 'undefined') module.exports = CuotiSample;
})();
