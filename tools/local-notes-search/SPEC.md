# SPEC · 39 本机笔记全文检索

目标用户:有大量本地 .md/.txt 笔记的人(Obsidian / Logseq / 纯文本用户)。付款人:本人。

## 核心任务(必须跑通)

1. 导入:`<input type=file webkitdirectory>` 选一个文件夹,只读 `.md/.txt/.markdown`(可加后缀),显示文件数与总字数;大文件夹分批读取并显示进度;也可拖入多个文件。
2. 建索引(纯内存 + 可选缓存到 IndexedDB):中文按字二元组(bigram)+ 英文按词(小写、去标点)建倒排索引;记录文件路径、段落号、段落文本。
3. 搜索:多关键词 AND(空格分隔)、短语(引号)、排除(`-词`)、路径前缀筛选(`path:日记/`);结果按命中密度 + 标题命中排序;高亮片段(前后各 60 字);显示文件路径、段落号;点击展开整段与上下段。
4. 工具:关键词的「共现词」(同段落里出现最多的其他词前 20,按 bigram/词统计,停用词可配);「最近修改」文件列表(来自 File.lastModified)。
5. 导出:搜索结果 Markdown(带路径与段落号,可贴回笔记做索引页);索引统计 CSV。缓存:索引存 IndexedDB,下次打开可直接搜(文件变更需重建,显示索引日期)。

## 不做

不改写文件、不同步、不做语义/向量检索、不联网。

## core.js 暴露

`tokenize(text)` → tokens(中文 bigram + 英文词);`buildIndex(docs)` → `{postings, docs, stats}`;`parseQuery(q)` → `{must, phrases, not, path}`;`search(index, query, options)` → 结果数组;`snippet(text, terms, radius)`;`cooccur(index, term, n, stopwords)`;`toMarkdown(results)`;`toCsv(stats)`。IndexedDB 读写在 app.js,失败时降级为仅内存并提示。

## 示例

内置 15 篇合成笔记(中英混合,含日记/读书/项目三个子目录路径)作为「示例库」,一键载入,不需要真实选文件夹;标注「合成示例」。

## 测试点(≥ 12)

tokenize 中英混合与标点;buildIndex 统计;parseQuery 各语法;AND 语义;短语精确匹配(跨 bigram 验证原文);排除;路径筛选;排序稳定性;snippet 边界与高亮位置;cooccur 停用词;空查询;CSV 公式防护;Markdown 输出。

## 视觉方向

检索工具感:白 + 深青灰;结果列表等宽路径;手机端单列。

## 已知限制(写进 README)

文件夹选择依赖 webkitdirectory;超大库(> 2 万文件)可能慢;IndexedDB 缓存可能被浏览器清理。
