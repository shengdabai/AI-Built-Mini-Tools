# SPEC · 09 版本发布说明助手

目标用户:独立开发者、小型软件团队。付款人:技术负责人。

## 核心任务(必须跑通)

1. 粘贴 `git log` 输出。支持三种格式自动识别:`git log --oneline`(`abc1234 subject`);`git log --pretty=format:"%h|%s|%an|%ad"`(四段竖线);原始 `git log`(`commit <sha>` / `Author:` / `Date:` / 缩进正文,正文里可含 `BREAKING CHANGE:` 脚注)。
2. 按 Conventional Commits 解析:`type(scope)!: subject`;type 识别 feat / fix / perf / refactor / docs / test / build / ci / chore / style / revert;`!` 或正文 `BREAKING CHANGE:` 视为破坏性;Merge 提交(`Merge branch` / `Merge pull request`)默认过滤;不符合约定的提交归「其他」。
3. 分组输出:破坏性变更 → 新功能 → 修复 → 性能 → 其他(可勾选是否包含 docs/chore/refactor);组内按 scope 聚合;每条自动做「用户可读化」:去掉 type 前缀、首字母大写(英文)、句尾去句号、`#123` 变链接(用户填仓库 URL 时)、`Co-authored-by` 等尾注去掉。
4. 版本建议:输入当前版本(semver `x.y.z`),按规则给下一版:有破坏性 → major;否则有 feat → minor;否则有 fix/perf → patch;否则不变。0.x 版本按「破坏性 → minor,其余 → patch」(README 写明这是约定)。
5. 编辑区:生成的 Markdown 可手改;「用户影响」勾选框(每条可标「需要用户操作」,导出时单独一节)。
6. 导出:Release Notes Markdown;CHANGELOG 片段(Keep a Changelog 风格:`## [x.y.z] - YYYY-MM-DD` + Added/Changed/Fixed/Removed);复制到剪贴板(失败则提示手动复制)。
7. 本机草稿恢复:加载 `releasenotes.v1` 时先完成 JSON 解析和整份字段校验。若状态损坏,保留主键原始字符串并显示持续恢复横幅。保存任何新状态前,先把原始字符串逐字写入未占用的 `releasenotes.v1.recovery-raw.<时间戳>[.<冲突序号>]` 键并回读比较;不得覆盖或自动清理旧归档。每次重试主键写入前必须重新回读当前恢复副本;副本缺失或不一致时必须创建并验证新的唯一归档。归档失败时不覆盖主键,但保留当前合法状态在内存并允许分别导出原始坏数据和当前内存草稿。主键读取失败时,当前页面生命周期内禁止主键写入和清空,但允许导出内存草稿。主键写入后也要回读比较,只有一致才报告保存成功。空白默认状态不能描述为已恢复旧数据。

## 不做

不连 GitHub API、不读本机仓库、不生成「变更原因」之类需要理解代码的内容。

## core.js 暴露

`detectFormat(text)`;`parseLog(text)` → `[{sha, subject, body, author, date, isMerge}]`;`parseConventional(commit)` → `{type, scope, breaking, subject, refs:[...]}`;`group(commits, options)`;`humanize(subject, options)`;`nextVersion(current, groups)`;`toReleaseNotes(groups, options)`;`toChangelog(groups, version, date, options)`。

## 示例

合成 22 条提交(三种格式各一份可切换),含 feat/fix/perf/docs/chore、一个 `!`、一个正文 BREAKING CHANGE、两个 Merge、三个带 `#123` 的、两个不符合约定的;标注「合成示例」。

## 测试点(≥ 14)

三种格式识别与解析;scope 与 `!` 解析;正文 BREAKING CHANGE;Merge 过滤;非约定提交归其他;分组顺序;humanize 各规则;refs 链接化(有/无仓库 URL);nextVersion 四种情况 + 0.x 约定 + 非法版本报错;CHANGELOG 日期格式;空输入;`?today` 固定日期;malformed JSON;JSON 合法但字段错误;主键读取失败;恢复归档写入失败;主键写入失败;固定时钟归档键冲突;主键重试前归档被删除;成功归档与刷新;原始字符串逐字下载。

## 视觉方向

开发工具感:深蓝灰 + 白,左输入右输出,输出区像渲染后的 Release 页;手机端上下堆叠。

## 已知限制(写进 README)

只认 Conventional Commits;不读代码,「用户影响」靠人勾;剪贴板在 file:// 下可能被拒。
