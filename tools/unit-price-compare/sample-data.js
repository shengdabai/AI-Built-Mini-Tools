/* 合成示例:供应商、价格均为虚构,仅用于演示,不代表任何真实报价。 */
globalThis.PROCURE_SAMPLE = {
  version: 1,
  sample: true,
  threshold: 10,
  quotes: [
    { id: 'q1', supplier: '老李批发', item: '鲜鸡蛋(30枚盘装)', group: '鸡蛋', currency: 'CNY', packPrice: 24, packCount: 1, unitQty: 30, unit: '件', note: '合成示例', date: '2026-09-05' },
    { id: 'q2', supplier: '老李批发', item: '鲜鸡蛋(30枚盘装)', group: '鸡蛋', currency: 'CNY', packPrice: 27.6, packCount: 1, unitQty: 30, unit: '件', note: '合成示例:较上次涨 15%', date: '2026-10-10' },
    { id: 'q3', supplier: '绿源供应', item: '土鸡蛋(2盘)', group: '鸡蛋', currency: 'CNY', packPrice: 52, packCount: 2, unitQty: 30, unit: '件', note: '合成示例', date: '2026-10-08' },
    { id: 'q4', supplier: '城东菜场', item: '鲜鸡蛋(30枚盘装)', group: '鸡蛋', currency: 'CNY', packPrice: 26.5, packCount: 1, unitQty: 30, unit: '件', note: '合成示例', date: '2026-10-12' },
    { id: 'q5', supplier: '鲜达配送', item: '鲜鸡蛋(10枚盒装)', group: '鸡蛋', currency: 'CNY', packPrice: 31.5, packCount: 3, unitQty: 10, unit: '件', note: '合成示例', date: '2026-10-15' },
    { id: 'q6', supplier: '老李批发', item: '高筋面粉(25kg 袋)', group: '面粉', currency: 'CNY', packPrice: 118, packCount: 1, unitQty: 25, unit: 'kg', note: '合成示例', date: '2026-09-05' },
    { id: 'q7', supplier: '老李批发', item: '高筋面粉(25kg 袋)', group: '面粉', currency: 'CNY', packPrice: 120, packCount: 1, unitQty: 25, unit: 'kg', note: '合成示例', date: '2026-10-10' },
    { id: 'q8', supplier: '绿源供应', item: '高筋面粉(500g 小包)', group: '面粉', currency: 'CNY', packPrice: 66, packCount: 10, unitQty: 500, unit: 'g', note: '合成示例:g 与 kg 混用', date: '2026-10-08' },
    { id: 'q9', supplier: '城东菜场', item: '低筋面粉(1000g 包)', group: '面粉', currency: 'CNY', packPrice: 54, packCount: 5, unitQty: 1000, unit: 'g', note: '合成示例', date: '2026-10-12' },
    { id: 'q10', supplier: '鲜达配送', item: '进口高筋面粉(5kg)', group: '面粉', currency: 'USD', packPrice: 22.5, packCount: 1, unitQty: 5, unit: 'kg', note: '合成示例:币种不同,单独排名', date: '2026-10-15' },
    { id: 'q11', supplier: '城东菜场', item: '面粉(散装袋)', group: '面粉', currency: 'CNY', packPrice: 40, packCount: 1, unitQty: null, unit: 'kg', note: '合成示例:缺每件净含量', date: '2026-10-12' },
    { id: 'q12', supplier: '老李批发', item: '菜籽油(5L 桶)', group: '食用油', currency: 'CNY', packPrice: 68, packCount: 1, unitQty: 5, unit: 'L', note: '合成示例', date: '2026-09-05' },
    { id: 'q13', supplier: '老李批发', item: '菜籽油(5L 桶)', group: '食用油', currency: 'CNY', packPrice: 69, packCount: 1, unitQty: 5, unit: 'L', note: '合成示例', date: '2026-10-10' },
    { id: 'q14', supplier: '绿源供应', item: '菜籽油(900mL 瓶)', group: '食用油', currency: 'CNY', packPrice: 90, packCount: 6, unitQty: 900, unit: 'mL', note: '合成示例:mL 与 L 混用', date: '2026-09-20' },
    { id: 'q15', supplier: '绿源供应', item: '菜籽油(900mL 瓶)', group: '食用油', currency: 'CNY', packPrice: 92, packCount: 6, unitQty: 900, unit: 'mL', note: '合成示例', date: '2026-10-08' },
    { id: 'q16', supplier: '城东菜场', item: '菜籽油(5000mL 桶)', group: '食用油', currency: 'CNY', packPrice: 72, packCount: 1, unitQty: 5000, unit: 'mL', note: '合成示例', date: '2026-10-12' },
    { id: 'q17', supplier: '鲜达配送', item: '菜籽油(1.8L 瓶)', group: '食用油', currency: 'CNY', packPrice: 49, packCount: 2, unitQty: 1.8, unit: 'L', note: '合成示例', date: '2026-10-15' },
    { id: 'q18', supplier: '鲜达配送', item: '花生油(1.8L 瓶)', group: '食用油', currency: 'CNY', packPrice: 98, packCount: 2, unitQty: 1.8, unit: 'L', note: '合成示例', date: '2026-10-15' }
  ]
};
