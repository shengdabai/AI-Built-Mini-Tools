# SPEC · 25 文件完整校验

目标用户:需要交付或接收一批文件的人(设计交付、课程资料包、客户资料)。付款人:交付方。

## 核心任务(必须跑通)

1. 生成清单:用 `<input type=file webkitdirectory multiple>` 或拖入多个文件,读取相对路径、大小、最后修改时间,并用 Web Crypto `SHA-256` 计算哈希(大文件分块读取,显示进度);输出清单 JSON/CSV(`路径, 大小, sha256, 修改时间`)。
2. 核对清单:导入一份清单 + 再选一批文件,对比:缺失(清单有文件无)、多出(文件有清单无)、哈希不一致、大小不一致但哈希一致(不可能,报内部错误)、路径大小写差异(警告)。
3. 规则:清单路径用 `/` 统一;忽略 `.DS_Store`、`Thumbs.db`、`__MACOSX/`(可配置忽略列表);文件名含非法字符(`<>:"|?*`、控制字符)或超长(> 255 字节)时警告(跨平台交付常见问题)。
4. 汇总:文件数、总大小、各状态数;可筛选。
5. 导出:核对报告 Markdown/CSV;清单 JSON。

## 不做

不上传、不比较文件内容差异、不做目录同步。

## core.js 暴露

`normalizePath(p)`;`shouldIgnore(path, patterns)`;`checkName(path)`;`buildManifest(entries)`;`parseStoredState(raw)`;`compare(manifest, entries)` → `{missing, extra, mismatched, caseDiff, ok, stats}`;`parseManifest(text)`(JSON 或 CSV);`toCsv`;`reportToMarkdown`。哈希计算在 app.js(需 File API),core.js 只接收 `{path, size, sha256}` 结构。

## 存档恢复不变式

1. `filecheck.v1` 顶层对象和内部清单必须全部通过类型与语义校验,才能一次性进入页面状态。
2. 非法 JSON、有效 JSON 但结构错误、读取存储失败和确认无存档是四种不同状态。
3. 损坏原文保持原始字符串。每次主键覆盖前,必须重新回读恢复副本;副本丢失或改动时重新归档。恢复键必须唯一,不覆盖已存在的键。
4. 主键 `setItem` 后必须回读并与序列化文本逐字一致,才能清除恢复状态或显示保存成功。
5. 页面始终可导出当前有效内存状态;只在已读到损坏原文时提供原文下载。
6. 存档读取失败时,任何保存或清空操作都不得写入或删除存储,也不得改动当前内存状态。

## 示例

合成清单 15 条 + 合成「再选文件」列表(core 层用对象模拟):2 缺失、1 多出、1 哈希不一致、1 大小写差异、1 非法文件名、含 `.DS_Store`;页面上提供「载入示例对比」按钮(不需要真实文件)。标注「合成示例」。

## 测试点(≥ 12)

normalizePath(反斜杠、前导 `./`);忽略规则;checkName 各类非法与超长;buildManifest 排序;compare 五种状态;大小写差异不计入缺失;parseManifest JSON 与 CSV;CSV 公式防护;空清单;重复路径报错;stats 合计。

## 视觉方向

校验工具感:浅灰 + 深青;状态用图标 + 文字(不只靠颜色);手机端卡片。

## 已知限制(写进 README)

浏览器选目录依赖 webkitdirectory;超大文件哈希慢;不校验权限与符号链接。
