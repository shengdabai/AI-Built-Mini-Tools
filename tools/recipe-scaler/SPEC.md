# SPEC · 27 配方缩放器

目标用户:烘焙爱好者、小餐饮、手作工作室。付款人:本人。

## 核心任务(必须跑通)

1. 录入配方:名称、原始份数(或原始总重)、配料行(`名称 | 数量 | 单位 | 备注`,支持批量粘贴,支持分数 `1/2`、混合数 `1 1/2`、范围 `2-3`(按两端分别缩放)、「适量」等非数值按原样保留并标「不缩放」)。
2. 缩放:按目标份数或按某一配料的目标数量(如「我只有 350g 面粉」)反推倍数;所有数值配料乘以倍数。
3. 单位智能:同量纲内自动升降单位(1500 g → 1.5 kg;0.25 L → 250 mL),可关;计数单位(个、片)缩放后给「四舍五入到整数」与「精确值」两种;杯/勺等容积单位只在同单位内缩放,不转质量(除非用户给密度,本版不做)。
4. 烘焙百分比:若配方含「面粉」类配料(用户标记基准配料),显示每种配料相对基准的百分比;可反向:给百分比与基准重量生成配方。
5. 导出:缩放后配方 Markdown(打印友好)/CSV;JSON 备份。
6. 配方库:本机保存多份,搜索。

## 不做

不做营养计算、不做容积↔质量换算、不联网搜菜谱。

## core.js 暴露

`parseQuantity(text)` → `{kind: 'number'|'range'|'text', value|min,max, display}`;`parseIngredients(text)`;`scale(recipe, factor, options)`;`factorFromServings`;`factorFromIngredient`;`autoUnit(value, unit)`;`bakersPercent(recipe, baseName)`;`fromPercent(percents, baseWeight)`;`toMarkdown`;`toCsv`;`validateImport`。分数运算用有理数(自写 gcd),显示时保留最多 2 位小数或分数形式(用户可选)。

## 示例

合成 3 份配方(吐司、曲奇、拿铁糖浆),含分数、范围、「适量」、g/kg/mL/个/杯;标注「合成示例」。

## 测试点(≥ 12)

parseQuantity 各形式(含全角数字、中文「半」→ 0.5);范围缩放两端;文本不缩放;factorFromIngredient 除零;autoUnit 升降与关闭;计数整数化;bakersPercent 基准为 0 保护;fromPercent 往返;分数显示;CSV 公式防护;validateImport 单位枚举;空配方。

## 视觉方向

厨房卡片感:米白禁用,改用白底 + 深赤陶色强调;大号数字;手机端单列。

## 已知限制(写进 README)

不做容积↔质量;烘焙时间温度不随份数缩放,页面提示。
