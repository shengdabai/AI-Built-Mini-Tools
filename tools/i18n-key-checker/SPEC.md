# SPEC · 37 多语言文案键核对

目标用户:独立开发者、小团队前端。付款人:技术负责人。

## 核心任务(必须跑通)

1. 导入:多份语言文件(JSON 嵌套对象 / 扁平 `a.b.c` / `.properties` `key=value` / CSV `key, zh, en, …`),每份标语言代码;指定「源语言」。
2. 核对(每条带键名、语言、级别):
   - 阻断:目标语言缺键;目标语言多出源没有的键;值为空;占位符集合不一致(`{name}`、`{{count}}`、`%s`、`%1$d`、`$t(...)`)、HTML 标签不一致;
   - 警告:值与源语言完全相同(疑似未翻译;可配「允许相同」键模式,如品牌名);长度比异常(> 3 或 < 0.3);键名不符合约定(可配正则);复数形式键不完整(`_one/_other`、`zero/one/few/many`);同源文本在不同键下译法不同;
3. 统计:每种语言的覆盖率、未译率、问题数;整体进度条。
4. 修复辅助:生成「待翻译表」CSV(键、源文本、目标语言空列),译完可再导入合并,合并时只填空键,不覆盖已有值(可选覆盖)。
5. 导出:核对报告 Markdown/CSV;合并后的各语言 JSON(保持嵌套结构与键顺序);待翻译表。

## 不做

不翻译、不读代码引用、不处理 .po 的 msgctxt 之外的高级特性(.po 不支持,README 写明)。

## core.js 暴露

`detectFormat(text)`;`parseJson/flatten/unflatten`;`parseProperties`;`parseCsv`;`placeholders(s)`;`check(files, sourceLang, options)` → `{issues, stats}`;`todoTable(files, sourceLang)`;`merge(files, todoCsv, options)`;`toJson(flat, nested)`;`toCsv`;`reportToMarkdown`。

## 示例

合成 zh(源)/en/ja 三份 JSON,各 ~60 键,含缺键、多键、空值、占位符缺失、未译、复数不全、键名不规范;标注「合成示例」。

## 测试点(≥ 14)

格式识别;flatten/unflatten 往返与键顺序;缺键/多键;空值;占位符各类型与 HTML 标签;未译与允许相同;长度比;键名正则;复数集合;同源不同译;覆盖率计算;todoTable 列;merge 不覆盖/可覆盖;CSV 公式防护;空文件。

## 视觉方向

开发工具感:深色主题(炭灰底,AA);语言列横向表;手机端按语言分段。

## 已知限制(写进 README)

不支持 .po/.xliff;嵌套 JSON 中数组按索引键处理。
