# SPEC · 04 四层对照卡


## 核心任务(必须跑通)

1. 输入 1 句或多句中文(每行一句)。点「生成」:每句自动分词并给每个词块拼音(词典拼音优先,字表回退)。
2. 每句一张卡,四行:
   - Chinese:词块横排(每个词块一个格子)。
   - Pinyin:每格对应拼音,可点击编辑。
   - Word-by-Word:每格一个英文 gloss 输入框(手工填);填过的「词 → gloss」自动记入个人词典(localStorage 键 `fourlayer.glossary.v1`),下次同词自动预填并标「来自词典」。
   - English:整句英文,手工填,一个输入框。
3. 调整词块:选中相邻两个格子点「合并」;选中一个格子点「拆分」成单字;合并/拆分后拼音按 `CnSegment.merge / split` 重算,gloss 清空等待重填。
4. 个人词典页:列表(词 / gloss / 使用次数),可改可删;导出/导入 JSON。
5. 导出:单张卡 PNG(canvas 绘制四行表格,中文用系统字体栈,2x 像素密度);全部卡 Markdown(每句一个四行表格);复制为纯文本(四行,制表符分隔)。

## 不做

- 不自动生成英文 gloss 或整句翻译(无本地词典;不编造);不调 AI;不做繁体。

## 数据与算法

- 分词与拼音用 `../_shared/cn-segment.js` + `../_data/hsk-words.js` + `../_data/pinyin-map.js`。
- `core.js` 暴露:`buildCard(sentence, dict, charMap, glossary)` → `{cells:[{t, pinyin, gloss, fromGlossary, level?}], english:''}`;`mergeCells(card, i, dict, charMap)`;`splitCell(card, i, charMap)`;`learn(glossary, word, gloss)`(次数 +1,空 gloss 不记);`toMarkdown(cards)`;`toText(cards)`;`validateGlossary(json)`。
- PNG 绘制在 app.js 用 canvas;其宽度按格子数自适应,最小字号由 token 决定。

## 示例(载入示例)

3 句合成例句(HSK 2–3 水平,含一个多字词和一个词典外字),示例自带 6 条 gloss 词典预填;标注「合成示例」。

## 测试点(≥ 10)

分词与拼音回退;词典预填与 fromGlossary 标记;learn 次数累加与空 gloss 忽略;merge 后词典命中恢复拼音;split 后拼音逐字;merge 清空 gloss;Markdown 表格列数与格子数一致;toText 四行制表符;多句输入每行一卡且忽略空行;validateGlossary 拒绝非对象。

## 视觉方向

教学卡片感:白底卡片 + 深墨字,四行用左侧小标签区分(文字标签,不是编号);拼音行用稍小字号但 ≥ 16px;手机端卡片可横向滚动(卡片本身在 `overflow-x:auto` 容器里),页面不横向溢出。

## 已知限制(写进 README)

gloss 全靠教师手填并由词典记忆;多音字用词典读音或最常用读音,可能需手改;PNG 导出字体随系统。
