'use strict';
// 合成示例:商品、品牌、价格、SKU 全部是虚构的,图片地址指向 example.com,仅用于演示预检规则。
// 刻意埋入的问题:大写 Handle、列数不对的行、重复 SKU、非法价格、非 http 图片、重复 Option 组合、=SUM() 开头的 Tags,以及其他几类常见错误。
globalThis.CSVCHECK_SAMPLE = {
  note: '合成示例:虚构商品,仅用于演示预检规则',
  csv: [
    "Handle,Title,Body (HTML),Vendor,Type,Tags,Published,Option1 Name,Option1 Value,Option2 Name,Option2 Value,Variant SKU,Variant Grams,Variant Inventory Qty,Variant Price,Image Src",
    "canvas-tote-bag,帆布托特包,\"<p>厚帆布,可放 A4 文件</p>\",云岸工坊,包袋,\"帆布,通勤\",TRUE,颜色,黑色,尺寸,大,TOTE-BK-L,420,25,89.00,https://example.com/img/tote-black.jpg",
    "canvas-tote-bag,,,,,,TRUE,,黑色,,小,TOTE-BK-S,380,30,79.00,",
    "canvas-tote-bag,,,,,,TRUE,,米白,,大,TOTE-BK-L,420,12,89.00,",
    "canvas-tote-bag,,,,,,TRUE,,米白,,小,TOTE-WH-S,380,18,79.00,",
    "canvas-tote-bag,,,,,,TRUE,,黑色,,大,TOTE-BK-X,420,8,89.00,",
    "canvas-tote-bag,,,,,,TRUE,,,,,,,,,ftp://example.com/img/tote-side.jpg",
    "Ceramic-Mug-Set,陶瓷马克杯两件套,\"<p>釉面光滑,可进洗碗机</p>\",山间陶坊,家居,\"=SUM(1,2)\",true,规格,标准装,,,MUG-SET-01,900,40,128.00,https://example.com/img/mug.jpg",
    "Ceramic-Mug-Set,,,,,,TRUE,,礼盒装,,,MUG-SET-02,1100,15,\"128,00\",https://example.com/img/mug-box.jpg",
    "Ceramic-Mug-Set,,,,,,TRUE,,单只,,,MUG-ONE-01,450,3.5,68.00,",
    "linen-throw-pillow,亚麻抱枕,<p>亚麻面料</p><script>track()</script>,云岸工坊,家居,\" 亚麻, 抱枕\",FALSE,颜色,灰色,,,PIL-GR,350,60,45.00,https://example.com/img/pillow-grey.jpg",
    "linen-throw-pillow,,,云岸工房,,,TRUE,,蓝色,,,PIL-BL,350,20,4500.00,https://example.com/img/pillow-blue.jpg",
    "linen-throw-pillow,,,,,,TRUE,颜色,绿色",
    "linen-throw-pillow,,,,,,yes,,红色,,,PIL-RD,350,10,45.00,",
    "",
    "linen-throw-pillow,,,,,,TRUE,,黄色,,,PIL-YL,350,5,45.00,",
    "linen-throw-pillow,,,,,,TRUE,,,,,,,,,https://example.com/img/pillow-2.jpg",
    "Ceramic-Mug-Set,,,,,,TRUE,,,,,,,,,https://example.com/img/mug-side.jpg",
  ].join('\n'),
};
