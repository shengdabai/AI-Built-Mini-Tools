# SPEC · 20 依赖更新影响说明

目标用户:小型开发团队、独立开发者。付款人:技术负责人。

## 核心任务(必须跑通)

1. 粘贴两份 `package.json`(旧/新)或一份 `git diff package.json`,或 `npm outdated` 的表格输出;自动识别。
2. 解析依赖变化:新增、移除、升级、降级;对每个升级按 semver 分类:major / minor / patch / 预发布 / 非 semver(如 `latest`、git URL、`workspace:`)。范围符号(`^`、`~`、`>=`)按「范围变化」单独列出并解释含义。
3. 影响说明(确定性模板):major → 「可能有破坏性变更,必须读 CHANGELOG,建议跑全部测试与类型检查」;minor → 「新增功能,建议跑测试」;patch → 「修复,建议跑冒烟」;降级 → 「确认是否有意为之」;依赖出现在 `dependencies` 与 `devDependencies` 两处 → 警告;版本写死 vs 范围的变化 → 提示。
4. 测试建议清单:按 major 包列出「需要检查的方面」(接口签名、配置项、Node 版本要求),内容为通用模板,不编造具体包的变更。
5. 导出:影响说明 Markdown(可贴进 PR 描述);变更表 CSV。

## 不做

不联网查 registry/CHANGELOG;不分析代码引用。

## core.js 暴露

`detectInput(text)`;`parsePackageJson(text)`;`parseDiff(text)`;`parseOutdated(text)`;`compareDeps(oldDeps, newDeps)`;`semverDelta(from, to)` → `{kind, from, to, rangeChange}`;`advice(change)`;`toMarkdown(changes)`;`toCsv`。semver 解析自写(主.次.补 + 预发布 + 范围前缀),不引入库。

## 示例

合成两份 package.json(22 个依赖),含:2 major、3 minor、4 patch、1 降级、1 新增、1 移除、1 `^`→固定、1 预发布、1 git URL、1 同时在 dev 与 prod;标注「合成示例」。

## 测试点(≥ 12)

三种输入识别;JSON 解析错误定位;semverDelta 各类(含 0.x、预发布、非 semver);范围变化识别;新增/移除/降级;重复出现警告;advice 模板;Markdown 结构;CSV;空依赖;非法 JSON 不崩。

## 视觉方向

开发工具感:深色主题(炭灰底,AA),major 红、minor 琥珀、patch 绿;手机端单列。

## 已知限制(写进 README)

不读 CHANGELOG,建议是通用模板;只支持 npm 的 package.json。
