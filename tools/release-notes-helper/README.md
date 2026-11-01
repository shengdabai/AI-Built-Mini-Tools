# 版本发布说明助手

## 定位
粘贴 `git log`,按 Conventional Commits 整理成发布说明和 CHANGELOG 片段,并按 semver 建议下一个版本号。纯本地网页,不联网、无登录、无支付、无埋点。

## 目标用户
独立开发者、小型软件团队;付款人设想为技术负责人(见 SPEC.md)。

## 核心任务
1. 粘贴日志,自动识别 oneline / 自定义 pretty(`%h|%s|%an|%ad`)/ 原始 git log。
2. 解析 `type(scope)!: subject`;`!` 或正文 `BREAKING CHANGE:` 视为破坏性;Merge 提交默认过滤;不符合约定的归「其他」。
3. 分组:破坏性变更 → 新功能 → 修复 → 性能 → 其他(docs、chore 类、refactor 类可勾选加入);同 scope 聚合;去前缀、首字母大写、去句号、去 `Co-authored-by` 尾注;填仓库地址后 `#123` 变链接。
4. 版本建议:有破坏性 → major;否则有 feat → minor;否则有 fix/perf → patch;否则不变。**0.x 约定**:破坏性 → minor,其余 → patch(这是本工具的约定,不是 semver 规范)。
5. 手改 Markdown;每条可勾「需要用户操作」,导出时单独成节。
6. 导出 Release Notes(.md)、CHANGELOG 片段(Keep a Changelog 风格,`## [x.y.z] - YYYY-MM-DD`);复制到剪贴板,被拒时选中文本并提示手动复制。

## 如何打开
双击 `index.html`。固定日期:地址后加 `?today=2026-10-20`(非法值回退真实今天)。纯函数测试:`node --test tests/core.test.cjs`;存储恢复测试:`node --test tests/storage-recovery.test.cjs`;截图与完整浏览器流程:`node shots.cjs`。

## 数据与导出一致性
数据存 localStorage(主键 `releasenotes.v1`)。加载时会先解析并校验整份状态。主键若不是合法 JSON 或字段不合法,页面会保留原始字符串,并从空白内存草稿开始。第一次保存新草稿前,页面必须把原始字符串逐字写入一个未占用的 `releasenotes.v1.recovery-raw.<时间戳>[.<冲突序号>]` 键,再回读确认完全一致;确认失败时不会覆盖主键。每次重试主键写入前都会再次读取恢复副本;副本缺失或变化时会新建另一个唯一归档。历史归档不会自动覆盖或清理。恢复横幅持续提供「下载原始坏数据」和「导出当前内存草稿」。如果主键读取失败,页面会在当前生命周期内阻止所有主键写入和清空,但仍允许导出当前内存草稿。普通写入或回读失败也会显示持续可见的「未保存」横幅。手改后若再改输入,导出会被禁用,直到你选择「重新生成」或「保留手改」。CHANGELOG 永远由条目生成,不含手改。

## 口径
- 「条目」数 = 通过过滤的提交数,界面写明来自多少条提交、过滤了多少条;Merge 提交默认过滤,docs / chore 类 / refactor 类按勾选加入。
- 版本建议按本 README「核心任务」第 4 条的规则,0.x 版本的规则是本工具的约定,不是 semver 规范。
- 载入示例前,只要有日志、任一版本字段、「需要用户操作」勾选、改过的「包含」选项或手改的 Markdown,就先在页内确认,确认文字写明替换范围。「恢复为自动生成」在有手改时也先确认。
- 合成示例状态存进 localStorage,刷新后仍在:日志区与预览区持续显示「合成示例,非真实仓库」,导出的 Markdown 与更新日志片段首行带一行 HTML 注释标注;改动日志文本或清空后标记消失。
- 地址里带合法 `?today=` 时,页面顶部持续显示「基准日 …(由地址参数固定)」。
- 渲染预览用 `renderMarkdown`(core.js):先转义全部文本,只放行 http(s) 链接;app.js 其余位置用 `textContent`,没有未转义的 innerHTML 插值。

## 已知限制
- 只认 Conventional Commits;不读代码,「用户影响」靠人勾选。
- oneline / pretty 格式不含正文,正文里的 BREAKING CHANGE 识别不到(界面会提示)。
- 剪贴板在 file:// 下可能被拒。
- 不连 GitHub API、不读本机仓库;`#123` 链接按 `仓库地址/issues/123` 拼接。
- 没有通用导入功能;本机草稿类型或枚举不合法时不会载入业务界面,但原始字符串会保留到恢复副本或下载文件;版本号等半成品文本照常恢复,格式校验推迟到生成与导出。
- 示例为 22 条合成提交,不来自真实仓库。

## 验证记录
- 核验日期 2026-10-29。`node --test tests/core.test.cjs`:36 项通过。
- `node --test tests/storage-recovery.test.cjs`:7 项通过,覆盖 malformed JSON、JSON 合法但字段错误、主键读取被拒、恢复副本写入被拒、主键写入被拒、固定时钟键冲突、主键重试前恢复副本被删除、成功归档后刷新、当前内存草稿导出和原始文本逐字下载。
- `node shots.cjs`:退出码 0,58 条断言;桌面 1440、平板 768 与手机 390 的 scrollWidth 均 ≤ innerWidth;Playwright 默认 Chromium 不可用时按约定回退 `~/.local/bin/chrome-headless-shell`;展示页图片全部等待加载并成功解码。
