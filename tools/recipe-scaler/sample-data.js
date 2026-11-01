/* 合成示例:仅用于演示功能,不是推荐配比,也不是任何真实店铺的配方。 */
globalThis.RECIPE_SAMPLES = [
  {
    id: 'sample-toast',
    name: '吐司(合成示例)',
    yieldAmount: 2,
    yieldUnit: '条',
    baseName: '面粉',
    notes: '合成示例:仅演示缩放与烘焙百分比。',
    ingredientsText: [
      '面粉 | 500 | g | 高筋',
      '水 | 250 | g',
      '牛奶 | 100 | g',
      '白砂糖 | 40 | g',
      '盐 | 8 | g',
      '酵母 | 5 | g',
      '黄油 | 30 | g | 室温软化',
      '鸡蛋 | 1 | 个',
      '防粘油 | 适量 | | 刷模具'
    ].join('\n')
  },
  {
    id: 'sample-cookie',
    name: '巧克力曲奇(合成示例)',
    yieldAmount: 24,
    yieldUnit: '个',
    baseName: '',
    notes: '合成示例:含分数、混合数、范围和「半」。杯与勺只在同单位内缩放。',
    ingredientsText: [
      '低筋面粉 | 1 1/2 | 杯',
      '黄油 | 1/2 | 杯 | 软化',
      '红糖 | 2-3 | 汤匙 | 按甜度',
      '鸡蛋 | 1 | 个',
      '巧克力豆 | 150 | g',
      '小苏打 | 半 | 茶匙',
      '盐 | 适量'
    ].join('\n')
  },
  {
    id: 'sample-syrup',
    name: '拿铁糖浆(合成示例)',
    yieldAmount: 500,
    yieldUnit: 'mL',
    baseName: '',
    notes: '合成示例:含 mL 与 L、计数单位和「适量」。',
    ingredientsText: [
      '水 | 250 | mL',
      '白砂糖 | 200 | g',
      '浓缩咖啡 | 0.25 | L',
      '香草荚 | 1/2 | 个',
      '肉桂棒 | 1 | 根',
      '海盐 | 适量'
    ].join('\n')
  }
];
