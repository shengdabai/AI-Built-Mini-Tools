# SPEC · 06 商品 CSV 上架预检

目标用户:用 Shopify 一类平台批量上架的中小商家 / 电商运营。付款人:商家或运营负责人。

## 核心任务(必须跑通)

1. 粘贴或选择本地 CSV 文件(FileReader,不上传)。用 core 里自写的 RFC 4180 解析器(支持引号、引号内逗号与换行、`""` 转义),解析失败的行要定位到行号。
2. 按「Shopify 商品 CSV」格式做预检(规则表在 core 里集中定义,每条有 id、级别、说明):
   - 阻断:缺少 `Handle` 或 `Title` 列;某行列数与表头不一致;Handle 为空;Handle 含空格或大写或非 `[a-z0-9-]` 字符;同一 Handle 的首行缺 Title;`Variant Price` 非数字或 < 0;`Variant Inventory Qty` 非整数;`Published` 不是 TRUE/FALSE(大小写不敏感);同一 Handle 下 Option1/2/3 Value 组合重复;含替换字符 U+FFFD(编码损坏)。
   - 警告:`Variant SKU` 重复;`Image Src` 非 http(s) URL;`Body (HTML)` 含 `<script`;Tags 含前后空格;同一 Handle 下 Title/Vendor 不一致;Variant Price 高于同 Handle 其他变体 10 倍以上;`Variant Grams` 非数字;空行。
3. 结果面板:按级别分组的问题清单(行号、列名、原值、规则说明),点击定位到预览表格该单元格;统计(行数、商品数=不同 Handle 数、变体数、阻断数、警告数)。
4. 「应用安全修复」:只做无歧义修复——Handle 转小写并把空格换成连字符;TRUE/FALSE 规范化;去除首尾空白;删除空行。修复前显示将改动的单元格数;修复后重新预检。
5. 导出:修复后的 CSV(保留原列顺序,按 RFC 4180 加引号;以 `=`/`+`/`-`/`@` 开头的单元格加单引号前缀防公式注入);问题清单 CSV / Markdown。

## 不做

不连平台 API、不校验类目或图片可达、不做字段映射到其他平台(那是 p014)。不保证通过平台导入,README 要写明。

## core.js 暴露

`parseCsv(text)` → `{headers, rows, errors}`;`check(parsed, options)` → `{issues:[{row, col, value, ruleId, level, message}], stats}`;`safeFix(parsed)` → `{parsed, changed}`;`toCsv(parsed)`;`issuesToCsv(issues)`;`issuesToMarkdown(issues, stats)`;`RULES` 常量。

## 示例

一份 18 行合成商品 CSV(3 个商品、多变体),刻意含:一个大写 Handle、一个列数不对的行、重复 SKU、非法价格、非 http 图片、重复 Option 组合、一个 `=SUM()` 开头的 Tags;标注「合成示例」。

## 测试点(≥ 14)

RFC 4180:引号内逗号、引号内换行、`""` 转义、未闭合引号报行号;列数不一致;Handle 规则(大写、空格、合法);首行缺 Title;价格非法/负数;库存非整数;Published 规范化;Option 组合重复;SKU 重复为警告;U+FFFD;safeFix 只改安全项且 changed 计数正确;toCsv 对含逗号/引号/换行的值正确加引号;公式前缀防护;空输入。

## 视觉方向

电商后台感:深灰蓝导航 + 白表格;阻断用深红、警告用琥珀(均 AA);预览表格在 `overflow-x:auto` 容器里横滑,页面不溢出;手机端问题清单单列。

## 已知限制(写进 README)

规则来自 Shopify 公开帮助文档的常见导入问题,不是官方校验器;列名以英文官方模板为准;大文件(>5MB)未优化。
