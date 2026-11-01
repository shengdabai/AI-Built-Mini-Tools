'use strict';
// 合成示例:3 句 HSK 2–3 水平的例句(含多字词「商店」「喜欢」「朋友」和词典外字「卫」),
// 外加 6 条词典预填。全部为演示用合成数据,不是真实教学记录。
globalThis.FOURLAYER_SAMPLE = {
  label: '合成示例',
  text: '我今天想去商店买一本书。\n他喜欢喝咖啡,可是不喜欢喝茶。\n我的朋友叫大卫。',
  glossary: {
    '我': { gloss: 'I / me', count: 3 },
    '今天': { gloss: 'today', count: 2 },
    '想': { gloss: 'want to', count: 2 },
    '去': { gloss: 'go', count: 2 },
    '商店': { gloss: 'shop', count: 1 },
    '书': { gloss: 'book', count: 1 }
  }
};
